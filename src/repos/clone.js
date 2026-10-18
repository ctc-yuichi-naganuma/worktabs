// The repositories of the accounts gh is signed in to that are not cloned (readOwnedRepos in
// github.js), for the side bar's section of them, and cloning one: with ghq where ghq is, else
// with git into a folder the dialog asks for (src/dialog/clone.js). Runs no Electron code, so
// the tests can load it.
const fs = require('fs');
const path = require('path');
const { t } = require('../i18n');
const { capped } = require('../window/message-box');
const { localPath, runAt } = require('../commands');
const { parseWslPath, windowsPath } = require('../wsl/wsl');

// A clone of a large repository takes a while.
const CLONE_TIMEOUT = 10 * 60 * 1000;
// Without a terminal to ask in, git would wait on a prompt for a user name until the time runs
// out. Git Credential Manager still asks in its own window.
const CLONE_ENV = { GIT_TERMINAL_PROMPT: '0' };
// A folder named as a host is (github.com, ghe.example.com), as ghq names the first folder under
// its root.
const HOST_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

// ---- Which are cloned ----------------------------------------------------------------------

// What a repository on GitHub is told by: host/owner/name of its address, lowercase (GitHub's
// names do not tell case apart); null for an address of another form. The host without a port,
// as ghq names its folder.
function repoKey(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const [owner, name, ...more] = parsed.pathname.split('/').filter(Boolean);
  return owner && name && !more.length ? `${parsed.hostname}/${owner}/${name.replace(/\.git$/i, '')}`.toLowerCase() : null;
}

// The same for a folder, were it where ghq puts the repository (<root>/<host>/<owner>/<name>):
// its last three names; null for a folder less deep.
function folderKey(folder) {
  const names = String(folder).split(/[\\/]/).filter(Boolean);
  return names.length >= 3 ? names.slice(-3).join('/').toLowerCase() : null;
}

// The keys of the repositories cloned (repoKey, folderKey): those of the listed repositories'
// remotes (`urls`, with the address GitHub has a renamed or moved one at now), and of their
// folders, for one whose remote is not read yet or could not be (a distribution that does not
// answer, a repository cloned outside the app a moment ago). Windows' and WSL's alike.
function clonedKeys({ urls = [], folders = [] } = {}) {
  const keys = new Set();
  for (const url of urls) keys.add(repoKey(url));
  for (const folder of folders) keys.add(folderKey(folder));
  keys.delete(null);
  return keys;
}

// The repositories of the accounts as the last read of each host left them: `found` (host ->
// readOwnedRepos's list, or null when gh failed for it) for the hosts gh is signed in to
// (`hosts`); a host that failed keeps what `previous` had of it, as GitHub may only be out of
// reach for a moment. A host gh is no longer signed in to has none.
function mergeOwned(previous, hosts, found) {
  return hosts.flatMap((host) => found.get(host) || previous.filter((repo) => repo.host === host));
}

// How hiddenGithubOwners names an owner: <owner> on github.com, <host>/<owner> elsewhere.
function hiddenOwnerName(host, owner) {
  return host === 'github.com' ? owner : `${host}/${owner}`;
}

// Whether `hidden` (hiddenGithubOwners in config.json) names the owner: as <owner> on any host,
// or as <host>/<owner>; case does not matter.
function isHiddenOwner(hidden, host, owner) {
  const names = new Set((Array.isArray(hidden) ? hidden : []).filter((name) => typeof name === 'string').map((name) => name.trim().toLowerCase()));
  return names.has(owner.toLowerCase()) || names.has(`${host}/${owner}`.toLowerCase());
}

const byName = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });

// The repositories of `owned` that are not `cloned` (clonedKeys), by owner, for the side bar:
// [{ key: host/owner (lowercase), host, owner, type: 'user' | 'org', hidden: the name
// hiddenGithubOwners takes for it, repos: [{ key, url, name, fork, visibility, description,
// pushedAt }] }]. The account's own first (github.com before the others), then the
// organizations by name; in each, the repositories pushed to most recently first. The owners
// that `hidden` names are left out.
function unclonedGroups(owned, cloned, hidden = []) {
  const groups = new Map();
  for (const repo of owned) {
    const key = repoKey(repo.url);
    if (!key || cloned.has(key) || isHiddenOwner(hidden, repo.host, repo.owner)) continue;
    const id = `${repo.host}/${repo.owner}`.toLowerCase();
    if (!groups.has(id)) {
      groups.set(id, { key: id, host: repo.host, owner: repo.owner, type: repo.type, hidden: hiddenOwnerName(repo.host, repo.owner), repos: [] });
    }
    const { url, name, fork, visibility, description, pushedAt } = repo;
    groups.get(id).repos.push({ key, url, name, fork, visibility, description, pushedAt });
  }
  const list = [...groups.values()];
  for (const group of list) group.repos.sort((a, b) => (b.pushedAt || 0) - (a.pushedAt || 0) || byName(a.name, b.name));
  const rank = (group) => (group.type === 'user' ? 0 : 1);
  const home = (group) => (group.host === 'github.com' ? 0 : 1);
  return list.sort(
    (a, b) => rank(a) - rank(b) || (a.type === 'user' ? home(a) - home(b) || byName(a.host, b.host) : byName(a.owner, b.owner) || home(a) - home(b) || byName(a.host, b.host)),
  );
}

// ---- Where to ------------------------------------------------------------------------------

// The path functions for a path as the app keeps it: Windows' for a drive or a UNC path (a folder
// in WSL), else POSIX (macOS).
function pathApi(p) {
  return /^[a-z]:[\\/]|^[\\/]{2}[^\\/]/i.test(p) || String(p).includes('\\') ? path.win32 : path.posix;
}

// Where a folder is: the lowercase name of its WSL distribution, or '' here.
function placeOf(folder) {
  const wsl = parseWslPath(folder);
  return wsl ? wsl.distro.toLowerCase() : '';
}

// The folder runAt runs a command at for the place of `distro`: its root in WSL, or null here.
function placeFolder(distro) {
  return distro ? windowsPath(distro, '/') : null;
}

// Where the listed repositories at one place are (`repos`: [{ path, url: their remote's address
// on GitHub, or null }]), as the dialog's choices of where to clone: [{ root, ghq, count }], the
// places with the most first. A repository where ghq would put it (<root>/<host>/<owner>/<name>:
// the folders are its remote's, or look so when its remote is not on GitHub or not read) gives
// its ghq root, a new one going in the same order; any other gives its parent folder, a new one
// going there by its name.
function cloneRoots(repos) {
  const roots = new Map();
  for (const { path: folder, url } of repos) {
    const api = pathApi(folder);
    const names = folder.split(/[\\/]/).filter(Boolean);
    const ghq = names.length >= 4 && (url ? repoKey(url) === folderKey(folder) : HOST_NAME.test(names[names.length - 3]));
    const root = ghq ? api.dirname(api.dirname(api.dirname(folder))) : api.dirname(folder);
    const id = `${ghq}\n${root.toLowerCase()}`;
    const entry = roots.get(id) || { root, ghq, count: 0 };
    entry.count += 1;
    roots.set(id, entry);
  }
  return [...roots.values()].sort((a, b) => b.count - a.count || byName(a.root, b.root));
}

// The folder `repo` (an entry of readOwnedRepos) is cloned into under `root`: as ghq would put it
// (<root>/<host>/<owner>/<name>), or by its name.
function cloneDestination(root, ghq, repo) {
  const api = pathApi(root);
  return ghq ? api.join(root, new URL(repo.url).hostname, repo.owner, repo.name) : api.join(root, repo.name);
}

const rootKey = (p) => p.toLowerCase().replace(/[\\/]+$/, '');

// Where `repo` goes under a folder that was chosen (or the one cloned into last): as the choice
// of `roots` (cloneRoots) at that folder does, else in ghq's order when the folder has one of a
// host already (a ghq root), else by its name.
function destinationIn(root, roots, repo, exists = fs.existsSync) {
  const known = roots.find((choice) => rootKey(choice.root) === rootKey(root));
  const ghq = known ? known.ghq : exists(pathApi(root).join(root, new URL(repo.url).hostname));
  return cloneDestination(root, ghq, repo);
}

// The folder a clone into `dest` went under, to start from next time (cloneRoot in config.json):
// the root of ghq's order when `dest` is in it, else its parent.
function rootOf(dest, repo) {
  const api = pathApi(dest);
  return folderKey(dest) === repoKey(repo.url) ? api.dirname(api.dirname(api.dirname(dest))) : api.dirname(dest);
}

// What the dialog starts with: under the folder cloned into last (`remembered`, when it is at the
// same place), else the first of `roots`; '' when there is neither.
function defaultDestination(roots, remembered, repo, exists = fs.existsSync) {
  if (remembered) return destinationIn(remembered, roots, repo, exists);
  return roots.length ? cloneDestination(roots[0].root, roots[0].ghq, repo) : '';
}

// Whether a repository can be cloned into the folder written in the dialog: { dest (trimmed),
// error: what is wrong with it, or null }. git makes the folders on the way; the folder itself
// must not be there yet.
function checkDestination(text, { exists = fs.existsSync, platform = process.platform } = {}) {
  const dest = String(text || '').trim();
  if (!dest) return { dest, error: t('Enter the folder to clone into') };
  const absolute = platform === 'win32' ? /^[a-z]:[\\/]|^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/i.test(dest) : dest.startsWith('/');
  if (!absolute) return { dest, error: t('Enter a full path') };
  if (exists(dest)) return { dest, error: t('This folder already exists. Choose another place') };
  return { dest, error: null };
}

// ---- Cloning -------------------------------------------------------------------------------

// The command that clones `repo`: `ghq get` (-p for SSH; ghq decides where), or `git clone` into
// `dest` (as the commands see it: its Linux path in WSL). `ssh`: over SSH, else https.
function cloneCommand(repo, { ghq, ssh, dest = null }) {
  const at = new URL(repo.url);
  if (ghq) return { command: 'ghq', args: ['get', ...(ssh ? ['-p'] : []), `${at.host}/${repo.owner}/${repo.name}`] };
  const remote = ssh ? `git@${at.hostname}:${repo.owner}/${repo.name}.git` : `https://${at.host}/${repo.owner}/${repo.name}.git`;
  const wsl = parseWslPath(dest);
  return { command: 'git', args: ['clone', '--', remote, wsl ? wsl.path : dest] };
}

// Whether ghq is installed where `folder` is (its root in WSL, or null here): `ghq root` works.
async function hasGhq(folder) {
  try {
    await runAt(folder, 'ghq', ['root'], 30000, { shellEnv: true });
    return true;
  } catch {
    return false;
  }
}

// The folder that ghq cloned `repo` into where `folder` is (as the app keeps it): ghq's own
// list, as ghq.<url>.root may put it under another root than `ghq root`. Rejects when ghq does
// not list it.
async function ghqFolder(folder, repo) {
  const out = await runAt(folder, 'ghq', ['list', '--full-path'], 30000, { shellEnv: true });
  const key = repoKey(repo.url);
  const found = out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && folderKey(line) === key);
  if (!found) throw new Error(t('ghq list does not have {repo}', { repo: `${repo.owner}/${repo.name}` }));
  return localPath(folder, found);
}

// Clones `repo` where `folder` is (see hasGhq) with ghq, or into `dest` with git (where `dest`
// is: in its distribution for a folder in WSL). Resolves the folder it is in. Rejects with the
// output of the command that failed.
async function cloneRepo(repo, { folder = null, ghq, ssh, dest = null }) {
  const { command, args } = cloneCommand(repo, { ghq, ssh, dest });
  const at = ghq ? folder : placeFolder(parseWslPath(dest)?.distro);
  // ghq is often on PATH only through the shell's start-up files in WSL (see wslGhqRepos).
  await runAt(at, command, args, CLONE_TIMEOUT, { shellEnv: ghq, env: CLONE_ENV });
  return ghq ? ghqFolder(folder, repo) : dest;
}

// What failing to clone `repo` says (options of showMessageBox): what ghq or git wrote, and when
// it reads as a refusal of the credentials, how to give git some. `ssh`: whether it went over SSH.
function cloneFailure(error, repo, { ssh = false, ghq = false } = {}) {
  const command = ghq ? 'ghq' : 'git';
  // ghq indents the lines of its log.
  const output = `${error.stderr || ''}\n${error.stdout || ''}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let said = output.length ? capped(output.slice(-20)) : [String(error.message || error)];
  if (error.code === 'ENOENT') said = [t('{command} is not found.', { command })];
  else if (error.killed) said = [t('Stopped it, as it had not finished in {minutes} minutes.', { minutes: CLONE_TIMEOUT / 60000 }), ...said];
  const text = output.join('\n');
  const hints = [];
  if (!ssh && /authentication failed|could not read (username|password)|terminal prompts disabled|repository not found|invalid username or password|error: 40[13]/i.test(text)) {
    hints.push(
      t('Could not authenticate over https. Give git your GitHub credentials: use Git Credential Manager (it comes with Git for Windows), or run gh auth setup-git in a terminal (in WSL, inside WSL).'),
    );
  }
  if (ssh && /permission denied \(publickey|host key verification failed|could not read from remote repository/i.test(text)) {
    hints.push(
      t('Could not connect over SSH. Check that your SSH key is registered on GitHub. For a host not connected to before, run ssh -T git@{host} once in a terminal to accept its host key.', {
        host: new URL(repo.url).hostname,
      }),
    );
  }
  return {
    type: 'error',
    message: t('Could not clone {repo}.', { repo: `${repo.owner}/${repo.name}` }),
    detail: [...said, ...(hints.length ? ['', ...hints] : [])].join('\n'),
  };
}

module.exports = {
  CLONE_TIMEOUT,
  checkDestination,
  cloneCommand,
  cloneDestination,
  cloneFailure,
  cloneRepo,
  cloneRoots,
  clonedKeys,
  defaultDestination,
  destinationIn,
  folderKey,
  hasGhq,
  hiddenOwnerName,
  isHiddenOwner,
  mergeOwned,
  pathApi,
  placeFolder,
  placeOf,
  repoKey,
  rootOf,
  unclonedGroups,
};
