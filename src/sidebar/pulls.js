// Which pull requests and checks the side bar's rows show, from what the page has read (data.js
// reads them; the state is sidebar.js's). Apart from the page so they can be tested without a DOM.
// The page loads this as a plain script; the tests require it.

// The pull requests of a repository's branches, and the checks of its worktrees' HEADs, come
// with one call to gh (branchPulls in github.js), read when the repository's rows first show,
// when its branches or HEADs change, and when its worktrees are read again. The window coming to
// the front reads them only once they are 15 seconds old, so switching windows does not ask
// GitHub each time (gh may ask 5000 times an hour); something done in the repository (a Claude
// turn ends, which may have made one; a push, a moment later: see onToolUsed in main.js) reads
// them at once. While checks that show run, they are read again after 60 seconds.

/**
 * @typedef {object} PullSelectorsOptions
 * @property {any} state the page's state (sidebar.js)
 * @property {Pick<typeof import('./model.js'), 'keyOf' | 'branchOf' | 'foldersOf'>} model
 * @property {Pick<typeof import('./checks.js'), 'recentChecks' | 'ownChecks'>} checks
 * @property {() => number} [clock]
 */

/** @param {PullSelectorsOptions} options */
function createPullSelectors({ state, model, checks, clock = Date.now }) {
  const { keyOf, branchOf } = model;
  const { recentChecks, ownChecks } = checks;

  // The pull requests of one's own approved and not merged in a repository, from the main process,
  // but for those its worktree rows have seen merged or closed (or made a draft) since: the main
  // process reads them every few minutes, the rows as soon as something is done in the repository
  // (see loadPulls in sidebar.js).
  function approvedOf(group) {
    const approved = (group.git && state.approved[group.key]) || [];
    const known = state.pulls.get(group.key)?.result?.pulls;
    if (!known || !approved.length) return approved;
    const done = new Set([...known.values()].filter((pull) => pull.state !== 'open').map((pull) => pull.number));
    return approved.filter((pull) => !done.has(pull.number));
  }

  // Whether a branch of the repository at `repo` (null outside git) may have a pull request: the
  // repository is on GitHub and the branch is not its default one nor a detached HEAD (hasBranchPage
  // in github.js).
  function hasBranchPage(repo, branch) {
    const github = repo && state.github.get(keyOf(repo));
    return Boolean(github) && Boolean(branch) && branch !== 'HEAD' && branch !== github.defaultBranch;
  }

  // The pull request a worktree's branch was made from (see setBranchLink in worktrees.js), while
  // the branch is the one listed: an open tab may have switched to another.
  function madeFrom(folder) {
    return folder.pull && branchOf(folder) === folder.branch ? folder.pull : null;
  }

  // What to read for a repository's worktrees: the branches that may have a pull request, sorted,
  // with the pull request of each branch made from one, and the commits checked out (sorted):
  // { branches, numbers: [[branch, number]], heads }. The HEADs of all of them, since whether a
  // branch has a pull request is only known from the answer.
  function pullBranches(group) {
    const branches = new Set();
    const numbers = new Map();
    const heads = new Set();
    for (const folder of model.foldersOf(state, group)) {
      if (folder.head) heads.add(folder.head);
      const branch = branchOf(folder);
      if (!hasBranchPage(group.path, branch)) continue;
      branches.add(branch);
      const made = madeFrom(folder);
      if (made) numbers.set(branch, made.number);
    }
    return { branches: [...branches].sort(), numbers: [...numbers].sort(), heads: [...heads].sort() };
  }

  // The pull request of a branch of the repository at `repo` (null outside git): undefined
  // while it is not known, null when the branch has none.
  function pullOf(repo, branch) {
    const result = repo && state.pulls.get(keyOf(repo))?.result;
    if (!result || !result.branches.has(branch)) return undefined;
    return result.pulls.get(branch) || null;
  }

  // The checks a pull request shows: an open one's always, as they are its current state; a merged
  // one's (those of its merge commit) while they are recent (recentChecks in checks.js); a closed
  // one has none.
  function pullChecks(pull, now) {
    return pull.state === 'merged' ? recentChecks(pull.checks, now) : pull.checks;
  }

  // The checks of a worktree's HEAD that its row shows: when its branch has no pull request, is the
  // default branch, or it has no branch (a detached HEAD, "HEAD" for an open tab). Those of its own
  // branch (ownChecks in checks.js) while they are recent. Null otherwise, and while its branch's
  // pull request is not known yet.
  function headChecks(folder, branch, pull) {
    if (pull || !folder.repo || !folder.head || (pull === undefined && hasBranchPage(folder.repo, branch))) return null;
    const key = keyOf(folder.repo);
    const checks = state.pulls.get(key)?.result?.heads.get(folder.head);
    const own = ownChecks(checks, branch !== 'HEAD' ? branch : null, state.github.get(key)?.defaultBranch);
    return recentChecks(own, clock());
  }

  // Whether checks that the rows may show are running.
  function checksRunning(result, now = clock()) {
    const shown = [...[...result.pulls.values()].map((pull) => pullChecks(pull, now)), ...[...result.heads.values()].map((checks) => recentChecks(checks, now))];
    return shown.some((checks) => checks && checks.state === 'pending');
  }

  return { approvedOf, hasBranchPage, madeFrom, pullBranches, pullOf, pullChecks, headChecks, checksRunning };
}

if (typeof module === 'object') module.exports = { createPullSelectors };
