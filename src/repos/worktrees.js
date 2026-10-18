// Repositories and worktrees shown in the side bar. The repository list and its cache are in
// repo-catalog.js, and the files a new worktree gets in worktree-include.js; this module exports
// them too.
const fs = require('fs');
const path = require('path');
const { t } = require('../i18n');
const { parseWslPath } = require('../wsl/wsl');
const { run, runAt, runGit, hostPath, localPath, gitMessage } = require('../commands');
const { samePath, sleep } = require('../util');
const {
  addToCatalog, isGitFolder, isIssue, readRepoCache, repoCatalog, usableSources, writeRepoCache, wslGhqRepos,
} = require('./repo-catalog');
const { copyFiles, includedFiles } = require('./worktree-include');

// Worktrees of one repository, from `git worktree list --porcelain`.
async function gitWorktrees(repo) {
  const out = await runGit(repo, ['worktree', 'list', '--porcelain']);
  const worktrees = [];
  for (const [index, block] of out.split(/\r?\n\r?\n/).entries()) {
    const entry = {};
    for (const line of block.split(/\r?\n/)) {
      const [key, ...rest] = line.split(' ');
      entry[key] = rest.join(' ') || true;
    }
    if (!entry.worktree || entry.bare) continue;
    worktrees.push({
      path: localPath(repo, entry.worktree),
      branch: typeof entry.branch === 'string' ? entry.branch.replace(/^refs\/heads\//, '') : null,
      // The commit it has checked out, which git knows even when its folder is gone.
      head: typeof entry.HEAD === 'string' ? entry.HEAD : null,
      // git lists the main worktree first.
      main: index === 0,
      // `git worktree lock`: git refuses to remove it.
      locked: Boolean(entry.locked),
    });
  }
  return worktrees;
}

// The main worktree of the repository containing `folder` (where the shared .git lives).
async function mainWorktree(folder) {
  try {
    const common = (await runGit(folder, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
    if (!common) return null;
    const resolved = localPath(folder, common);
    return path.basename(resolved).toLowerCase() === '.git' ? path.dirname(resolved) : resolved;
  } catch {
    return null;
  }
}

// Top-level directory of the git worktree containing `folder`, or null outside git.
async function repoRoot(folder) {
  try {
    const top = (await runGit(folder, ['rev-parse', '--show-toplevel'])).trim();
    return top ? localPath(folder, top) : null;
  } catch {
    return null;
  }
}

// The branch checked out in the worktree at `folder`, as `git rev-parse --abbrev-ref HEAD` says
// it ("HEAD" when detached), or null outside git. This runs for every tab each time the window
// comes to the front, and starting git is slow on Windows and slower in WSL, so a worktree's own
// HEAD file is read where it can be; git answers the rest (a folder inside a worktree, say).
async function currentBranch(folder) {
  const read = await headBranch(folder).catch(() => undefined);
  if (read !== undefined) return read;
  try {
    return (await runGit(folder, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || null;
  } catch {
    return null;
  }
}

// The branch in HEAD of the worktree whose top is `folder`, or undefined when git should be asked.
// A linked worktree's .git is a file naming its git directory, in WSL by its Linux path.
async function headBranch(folder) {
  let gitDir = path.join(folder, '.git');
  if ((await fs.promises.stat(gitDir)).isFile()) {
    const link = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(await fs.promises.readFile(gitDir, 'utf8'));
    if (!link) return undefined;
    gitDir = parseWslPath(folder) && link[1].startsWith('/') ? localPath(folder, link[1]) : path.resolve(folder, link[1]);
  }
  const head = (await fs.promises.readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
  const ref = /^ref: refs\/heads\/(.+)$/.exec(head);
  if (ref) return ref[1];
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(head) ? 'HEAD' : undefined;
}

// Of these remotes, the one a repository is taken to come from: origin, else the first.
const preferredRemote = (names) => (names.includes('origin') ? 'origin' : names[0] || null);

async function remoteNames(folder, timeout) {
  return (await runGit(folder, ['remote'], timeout)).split(/\r?\n/).filter(Boolean);
}

// The remote the repository at `folder` is taken to come from (preferredRemote); null without
// one. Rejects when git fails.
async function mainRemote(folder, timeout) {
  return preferredRemote(await remoteNames(folder, timeout));
}

// The remote's default branch: what <remote>/HEAD points to (main), as `git clone` or
// `git remote set-head` recorded it; null when it is not recorded (a remote added after
// `git init`). The branch it names may since have been pruned.
async function defaultBranch(folder, remote, timeout) {
  try {
    const ref = (await runGit(folder, ['symbolic-ref', `refs/remotes/${remote}/HEAD`], timeout)).trim();
    const prefix = `refs/remotes/${remote}/`;
    return ref.startsWith(prefix) ? ref.slice(prefix.length) || null : null;
  } catch {
    return null;
  }
}

// ---- Adding and removing worktrees ---------------------------------------------------------

async function succeeds(folder, args) {
  try {
    await runGit(folder, args);
    return true;
  } catch {
    return false;
  }
}

// Where a new worktree goes: next to the repository, named <repository>-<branch> with the
// branch's slashes as dashes (worktabs-feat-x), where `git worktree add ../hotfix` would put it.
function worktreeFolder(repo, branch) {
  return path.join(path.dirname(repo), `${path.basename(repo)}-${branch.replace(/\//g, '-')}`);
}

// What adding a worktree for the branch `name` would do: { branch, folder, from, base, copies,
// error }. `from` is 'local' (an existing branch, checked out as it is), 'remote' (a new branch
// that tracks `base`, a remote branch of the same name), 'new' (a new branch from `base`, the
// default branch; see newBranchBase) or, with a pull request to check out (`pull`: { number,
// head, cross, open }, see checkedTask in task.js), 'pull' (a new branch from the pull request,
// fetched first; see pullPlan). `copies` is how many files .worktreeinclude brings along. Only
// `error` is set when it cannot be done.
async function planWorktree(repo, name, pull = null) {
  const plan = await planCheckout(repo, name, pull);
  if (!plan.branch) return plan;
  return { ...plan, copies: (await includedFiles(repo).catch(() => [])).length };
}

/**
 * @typedef {object} CheckoutPlan
 * @property {string} [branch]
 * @property {string} [folder]
 * @property {string} [from] 'local', 'remote', 'new' or 'pull'.
 * @property {string | null} [base]
 * @property {string} [remote] With `from: 'pull'` only, as are `ref`, `number` and `track`.
 * @property {string} [ref]
 * @property {number} [number]
 * @property {boolean} [track]
 * @property {string | null} [error]
 */

/** @returns {Promise<CheckoutPlan>} */
async function planCheckout(repo, name, pull = null) {
  const wanted = name.trim();
  if (!wanted) return { error: null };
  let branch;
  try {
    if (wanted.startsWith('-')) throw new Error('leading dash');
    branch = (await runGit(repo, ['check-ref-format', '--branch', wanted])).trim();
  } catch {
    return { error: t('{name} cannot be a branch name', { name: wanted }) };
  }
  const folder = worktreeFolder(repo, branch);
  if (fs.existsSync(folder)) return { error: t('{folder} already exists', { folder: path.basename(folder) }) };
  const holder = (await gitWorktrees(repo)).find((worktree) => worktree.branch === branch);
  if (holder) return { error: t('{branch} is in use in {folder}', { branch, folder: path.basename(holder.path) }) };
  if (await succeeds(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) {
    return { branch, folder, from: 'local', base: branch };
  }
  const remotes = await remoteNames(repo);
  if (pull) return pullPlan(branch, folder, preferredRemote(remotes), pull);
  const refs = new Set((await runGit(repo, ['for-each-ref', '--format=%(refname)', 'refs/remotes'])).split(/\r?\n/));
  const tracked = remotes.filter((remote) => refs.has(`refs/remotes/${remote}/${branch}`));
  if (tracked.length) return { branch, folder, from: 'remote', base: `${preferredRemote(tracked)}/${branch}` };
  return { branch, folder, from: 'new', base: await newBranchBase(repo, preferredRemote(remotes), refs) };
}

// How a new branch gets a pull request of the repository on `remote` (its main remote, where gh
// read the pull request): { from: 'pull', base, remote, ref, number, track }, fetching `ref` from
// the remote first, since someone else's branch is often not fetched yet, or behind.
//  - An open one from a branch of the repository itself: a branch that tracks it (track: true,
//    from `base`, origin/<branch>), as one that only the remote has, so that pushing adds to the
//    pull request.
//  - One from a fork, or one closed or merged (whose branch may be deleted): from the ref GitHub
//    keeps for each pull request (refs/pull/<number>/head), which pulling brings again when more
//    is pushed to it, as gh pr checkout sets it up. Not tracked as a remote branch: pushing has
//    nowhere to go.
function pullPlan(branch, folder, remote, { number, head, cross, open }) {
  if (!remote) return { error: t('There is no remote') };
  const plan = { branch, folder, from: 'pull', remote, number };
  if (!cross && open) return { ...plan, base: `${remote}/${head}`, ref: `refs/heads/${head}`, track: true };
  return { ...plan, base: null, ref: `refs/pull/${number}/head`, track: false };
}

// Fetches what pullPlan's plan checks out: into the remote-tracking branch to track, or into the
// new branch itself, with the pull request's ref as what it pulls from. Not forced into the
// branch: it is new, and git refuses to overwrite one that came meanwhile.
async function fetchPull(repo, plan) {
  if (plan.track) {
    await runGit(repo, ['fetch', plan.remote, `+${plan.ref}:refs/remotes/${plan.base}`], 5 * 60 * 1000);
    return;
  }
  await runGit(repo, ['fetch', plan.remote, `${plan.ref}:refs/heads/${plan.branch}`], 5 * 60 * 1000);
  await runGit(repo, ['config', `branch.${plan.branch}.remote`, plan.remote]);
  await runGit(repo, ['config', `branch.${plan.branch}.merge`, plan.ref]);
}

// Where a new branch starts: the remote's default branch (origin/main), where new work usually
// starts, rather than whatever the main worktree has checked out (a feature branch, often). The
// remote-tracking branch, not the local main: while the main worktree is on another branch,
// nobody pulls main, so it is often behind. Not fetched first, so that the plan shows at once
// while the name is typed and a worktree can be added offline; VS Code's autofetch and pulls in
// other worktrees keep it fresh. Without <remote>/HEAD: the local main or master, else what the
// main worktree has checked out. `remote`: the repository's main remote (mainRemote); `refs`: the
// remote-tracking refs there are.
async function newBranchBase(repo, remote, refs) {
  const head = remote && (await defaultBranch(repo, remote));
  if (head && refs.has(`refs/remotes/${remote}/${head}`)) return `${remote}/${head}`;
  for (const name of ['main', 'master']) {
    if (await succeeds(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])) return name;
  }
  return (await currentBranch(repo)) || 'HEAD';
}

// Adds the worktree that planWorktree describes, with the files .worktreeinclude names copied
// into it. Resolves { folder, branch, copied, failed }: the files copied, and those that could
// not be ({ file, message }), which do not undo the worktree. Throws with git's error.
async function addWorktree(repo, name, pull = null) {
  const plan = await planCheckout(repo, name, pull);
  if (!plan.branch) throw new Error(plan.error || t('Enter a branch name'));
  const folder = hostPath(plan.folder);
  if (plan.from === 'pull') await fetchPull(repo, plan);
  const args = {
    local: [folder, plan.branch],
    remote: ['--track', '-b', plan.branch, folder, plan.base],
    // From origin/main, git would make it track origin/main (branch.autoSetupMerge): pushing it
    // would then go to main, or be refused under push.default=simple. Publishing the branch sets
    // the upstream to its own name instead.
    new: ['--no-track', '-b', plan.branch, folder, plan.base],
    // From the pull request's own ref, fetchPull has made the branch already.
    pull: plan.track ? ['--track', '-b', plan.branch, folder, plan.base] : [folder, plan.branch],
  }[plan.from];
  // Checking out a large repository takes a while.
  await runGit(repo, ['worktree', 'add', ...args], 5 * 60 * 1000);
  const added = { folder: plan.folder, branch: plan.branch };
  let files;
  try {
    files = await includedFiles(repo);
  } catch (error) {
    return { ...added, copied: [], failed: [{ file: '.worktreeinclude', message: gitMessage(error) }] };
  }
  const failed = copyFiles(repo, plan.folder, files);
  const missed = new Set(failed.map((f) => f.file));
  return { ...added, copied: files.filter((file) => !missed.has(file)), failed };
}

// The names of the branches committed to most recently, local and remote (without the remote's
// name), newest first and each once: how the repository names its branches.
async function recentBranches(folder, count = 15) {
  const out = await runGit(folder, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)', 'refs/heads', 'refs/remotes']);
  const names = [];
  for (const ref of out.split(/\r?\n/)) {
    const name = ref.replace(/^refs\/(heads|remotes\/[^/]+)\//, '');
    if (!name || name === ref || name === 'HEAD' || names.includes(name)) continue;
    names.push(name);
    if (names.length >= count) break;
  }
  return names;
}

// ---- Issues and pull requests of branches --------------------------------------------------

// A branch made for a GitHub issue, or from a pull request, keeps its number and title among its
// own git settings (branch.<name>.worktabs-issue or branch.<name>.worktabs-pull, and the same
// with -title; as gh keeps branch.<name>.gh-merge-base), so the link lasts as long as the branch:
// deleting the branch deletes them. `kind`: 'issue' or 'pull'.
async function setBranchLink(folder, branch, kind, { number, title }) {
  await runGit(folder, ['config', `branch.${branch}.worktabs-${kind}`, String(number)]);
  await runGit(folder, ['config', `branch.${branch}.worktabs-${kind}-title`, title]);
}

// The issues and pull requests of the repository's branches: branch -> { issue, pull }, with
// each ({ number, title }) the branch has.
async function branchLinks(folder) {
  let out;
  try {
    out = await runGit(folder, ['config', '-z', '--get-regexp', '^branch\\..+\\.worktabs-(issue|pull)(-title)?$']);
  } catch (error) {
    // Nothing matches.
    if (error.code === 1) return new Map();
    throw error;
  }
  const found = new Map();
  // Each entry is the key (the section and the name in lowercase, the branch as it is), a
  // newline and the value.
  for (const entry of out.split('\0')) {
    const at = entry.indexOf('\n');
    const match = at > 0 && /^branch\.(.+)\.worktabs-(issue|pull)(-title)?$/.exec(entry.slice(0, at));
    if (!match) continue;
    const [, branch, kind, title] = match;
    if (!found.has(branch)) found.set(branch, {});
    const links = found.get(branch);
    links[kind] = links[kind] || { number: null, title: '' };
    if (title) links[kind].title = entry.slice(at + 1);
    else links[kind].number = Number(entry.slice(at + 1));
  }
  // A title without its number names nothing.
  for (const [branch, links] of found) {
    for (const kind of Object.keys(links)) if (!isIssue(links[kind]) || links[kind].number <= 0) delete links[kind];
    if (!Object.keys(links).length) found.delete(branch);
  }
  return found;
}

// The worktrees of a repository as the side bar lists them: those of gitWorktrees, with the
// issue and the pull request of the branch of each ({ number, title }) when it has them.
async function listWorktrees(repo) {
  const [worktrees, links] = await Promise.all([gitWorktrees(repo), branchLinks(repo).catch(() => new Map())]);
  return worktrees.map((worktree) => (links.has(worktree.branch) ? { ...worktree, ...links.get(worktree.branch) } : worktree));
}

// Files a worktree has changed or added (not ignored) since its last commit.
async function worktreeChanges(folder) {
  const out = await runGit(folder, ['status', '--porcelain']);
  return out.split(/\r?\n/).filter(Boolean).length;
}

// Reads into `buffer` until it is full or the file ends, and resolves the bytes read: a read
// through \\wsl.localhost may stop short.
async function readFull(file, buffer) {
  let filled = 0;
  while (filled < buffer.length) {
    const { bytesRead } = await file.read(buffer, filled, buffer.length - filled, null);
    if (!bytesRead) break;
    filled += bytesRead;
  }
  return filled;
}

// Whether the file at `a` has the content of the one at `b` (false when `b` is missing),
// compared a piece at a time, as an ignored file may be large.
async function sameContent(a, b) {
  const fb = await fs.promises.open(b).catch(() => null);
  if (!fb) return false;
  try {
    const fa = await fs.promises.open(a);
    try {
      const [ba, bb] = [Buffer.alloc(64 * 1024), Buffer.alloc(64 * 1024)];
      for (;;) {
        const [na, nb] = await Promise.all([readFull(fa, ba), readFull(fb, bb)]);
        if (na !== nb || !ba.subarray(0, na).equals(bb.subarray(0, nb))) return false;
        if (na < ba.length) return true;
      }
    } finally {
      await fa.close();
    }
  } finally {
    await fb.close();
  }
}

// The ignored files of a worktree (relative, with /) that the main worktree `repo` lacks or has
// with other content: removing the worktree loses them, and git does not count them as changes
// (a .env changed there, notes put there by hand). One that .worktreeinclude copied and nobody
// changed is the main worktree's too. A folder ignored as a whole (node_modules, dist) is not
// looked into: what it holds can mostly be made again, and listing it on every removal would
// teach to skip the list.
async function ignoredOnlyHere(folder, repo) {
  // matching: a folder that an ignore pattern names shows as the folder alone; the ignored files
  // of other folders show one by one (traditional would show a folder that holds only ignored
  // files as the folder).
  const out = await runGit(folder, ['status', '--porcelain', '-z', '--ignored=matching']);
  const files = out
    .split('\0')
    .filter((entry) => entry.startsWith('!! ') && !entry.endsWith('/'))
    .map((entry) => entry.slice(3));
  const lost = [];
  // A few at a time: through \\wsl.localhost, each file is a round trip.
  for (let i = 0; i < files.length; i += 16) {
    await Promise.all(
      files.slice(i, i + 16).map(async (file) => {
        const here = path.join(folder, ...file.split('/'));
        const stat = await fs.promises.lstat(here).catch(() => null);
        // A link goes as a link (see removeWorktree): what it points to stays.
        if (!stat || !stat.isFile()) return;
        if (!(await sameContent(here, path.join(repo, ...file.split('/'))).catch(() => false))) lost.push(file);
      }),
    );
  }
  return lost.sort();
}

// Commits that only `branch` (or, without one, only the detached HEAD) holds: those lost with
// it, since no other branch, remote branch or tag has them. `head`: the worktree's commit, for
// counting from the repository when the worktree's folder is gone.
async function unsharedCommits(folder, branch, head = 'HEAD') {
  const exclude = branch ? [`--exclude=${branch}`] : [];
  const out = await runGit(folder, ['rev-list', '--count', head, '--not', ...exclude, '--branches', '--remotes', '--tags']);
  return Number(out.trim()) || 0;
}

// The repository and branch of `folder` when it is a worktree that can be removed (a linked
// one, not the main worktree or a folder inside a worktree), else null: { repo, branch, head,
// locked, missing }. A worktree whose folder was deleted by hand stays in git's list (as
// prunable), and in the side bar, until it is removed; without the folder to ask, `repo` (the
// side bar's row says it) has to name its repository (missing: true). Only when nothing is
// there: a folder that git does not take for a worktree is not deleted on the row's word.
async function removableWorktree(folder, repo = null) {
  let main = await mainWorktree(folder);
  const missing = !main && typeof repo === 'string' && !fs.existsSync(folder);
  if (missing) main = repo;
  if (!main || samePath(main, folder)) return null;
  const worktree = (await gitWorktrees(main).catch(() => [])).find((w) => !w.main && samePath(w.path, folder));
  return worktree ? { repo: main, branch: worktree.branch, head: worktree.head, locked: worktree.locked, missing } : null;
}

// Windows refuses to delete a folder that a process still has open (as its working folder, say)
// for a moment after the process was told to stop.
const IN_USE = /permission denied|being used|resource busy|directory not empty|EBUSY|EPERM|ENOTEMPTY/i;

// Junctions and symbolic links under `folder`, without going into them. A worktree may link a
// folder of another one (node_modules, say) instead of installing it again.
function linksIn(folder) {
  const links = [];
  const pending = [folder];
  while (pending.length) {
    const dir = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) links.push(full);
      else if (entry.isDirectory()) pending.push(full);
    }
  }
  return links;
}

// Removes a linked worktree and its folder, trying again for a while when the folder is in use.
// git unregisters the worktree even when the folder itself stays, so what stays after that is
// deleted directly. Throws with git's (or the file system's) error.
async function removeWorktree(repo, folder, { attempts = 10 } = {}) {
  const listed = async () => (await gitWorktrees(repo)).some((worktree) => samePath(worktree.path, folder));
  if (samePath(repo, folder)) throw new Error(t('The main worktree cannot be removed'));
  // Only a folder git knows as a worktree of `repo` is ever deleted.
  if (!(await listed())) throw new Error(t('{folder} is not a worktree of {repo}', { folder, repo: path.basename(repo) }));
  const wsl = parseWslPath(folder);
  // Git for Windows deletes what a junction points to instead of the junction: removing a
  // worktree whose node_modules linked to the main worktree's emptied that one. So the links go
  // first, as links (fs.rmSync below does not follow them either). The git in WSL removes links
  // as links.
  if (!wsl) for (const link of linksIn(folder)) fs.unlinkSync(link);
  for (let attempt = 1; ; attempt += 1) {
    try {
      if (await listed()) await runGit(repo, ['worktree', 'remove', hostPath(folder)], 5 * 60 * 1000);
      if (!fs.existsSync(folder)) return;
      // Through \\wsl.localhost, deleting goes a file at a time; rm in WSL is much faster.
      if (wsl) await runAt(folder, 'rm', ['-rf', '--', wsl.path], 5 * 60 * 1000);
      else fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
      return;
    } catch (error) {
      if (attempt >= attempts || !IN_USE.test(`${error.message}\n${error.stderr || ''}`)) throw error;
      await sleep(1000);
    }
  }
}

// Deletes the branch and resolves the commit it pointed to (abbreviated), with which
// `git branch <branch> <commit>` brings it back until git collects the commits nothing holds.
// The worktree's own reflog, which would also lead to them, goes with the worktree.
async function deleteBranch(repo, branch) {
  const tip = (await runGit(repo, ['rev-parse', '--verify', '--short', `refs/heads/${branch}`])).trim();
  await runGit(repo, ['branch', '-D', branch]);
  return tip;
}

module.exports = {
  addToCatalog,
  addWorktree,
  branchLinks,
  currentBranch,
  defaultBranch,
  deleteBranch,
  gitMessage,
  gitWorktrees,
  hostPath,
  ignoredOnlyHere,
  includedFiles,
  isGitFolder,
  listWorktrees,
  localPath,
  mainRemote,
  mainWorktree,
  planWorktree,
  readRepoCache,
  recentBranches,
  removableWorktree,
  removeWorktree,
  repoCatalog,
  repoRoot,
  run,
  runAt,
  runGit,
  setBranchLink,
  unsharedCommits,
  usableSources,
  worktreeChanges,
  writeRepoCache,
  wslGhqRepos,
};
