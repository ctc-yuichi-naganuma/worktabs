// Worktree removal policy and sequencing are independent of Electron and native dialogs.
const path = require('path');
const { t } = require('../i18n');
const { removalDialog } = require('../window/message-box');

function createWorktreeRemoval({ tabs, removing, tabIdFor, stopRisks, conversations, messageBox,
  openTab, closeTab, pushState, refreshGit, serversFor, clearPortStorage, forgetPort, saveTabs,
  notifyBranchDeleted, removableWorktree, worktreeChanges, unsharedCommits, ignoredOnlyHere,
  githubRepo, branchLinks, branchPulls, mergedAtHead, removeWorktree, deleteBranch, gitMessage,
  platform = process.platform }) {
  const isInside = (p, folder) => {
    const relative = path.relative(folder, p);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  };

  // What stands in the way of removing the worktree: { target, blockers, unshared, ignored, pull,
  // held }. target is from removableWorktree (null: it cannot be removed at all). blockers say
  // what would be lost: a Claude turn in progress (in its tab, or in another tab whose
  // conversation moved into it), unsaved edits, and changes not committed. unshared counts the
  // commits only its branch holds; ignored lists the ignored files only it has (see
  // ignoredOnlyHere); pull is the branch's pull request (removalPull), and held whether it was
  // merged at the worktree's commit (mergedAtHead), so that it has those commits. ignored and pull
  // are read only when nothing blocks. `repo`: the repository its row in the side bar names, for a
  // worktree whose folder is gone (see removableWorktree).
  async function removalCheck(folder, repo = null) {
    const target = await removableWorktree(folder, repo);
    if (!target) return { target: null, blockers: [], unshared: 0, ignored: [], pull: null, held: false };
    const tab = tabs.get(tabIdFor(folder));
    const blockers = tab ? await stopRisks(tab) : [];
    if (target.locked) blockers.push(t('It is locked with git worktree lock (git worktree unlock unlocks it).'));
    for (const other of tabs.values()) {
      if (other === tab) continue;
      for (const c of conversations(other.id)) {
        if ((c.state === 'working' || c.state === 'waiting') && c.cwd && isInside(c.cwd, folder)) {
          const words = { tab: other.name, title: c.title || c.prompt || t('New conversation') };
          blockers.push(
            c.state === 'working'
              ? t('The conversation "{title}" in {tab} is working in this worktree.', words)
              : t('The conversation "{title}" in {tab} is waiting for approval in this worktree.', words),
          );
        }
      }
    }
    // A folder that is gone has nothing left to lose but its commits.
    const changes = target.missing ? 0 : await worktreeChanges(folder).catch(() => 0);
    if (changes === 1) blockers.push(t('There is 1 change not committed (new files included).'));
    else if (changes) blockers.push(t('There are {count} changes not committed (new files included).', { count: changes }));
    const [unshared, ignored, pull] = await Promise.all([
      // From the repository, with the worktree's commit, which works without its folder too.
      (target.head ? unsharedCommits(target.repo, target.branch, target.head) : unsharedCommits(folder, target.branch)).catch(() => 0),
      blockers.length || target.missing ? [] : ignoredOnlyHere(folder, target.repo).catch(() => []),
      blockers.length || !target.branch ? null : removalPull(target.repo, target.branch).catch(() => null),
    ]);
    return { target, blockers, unshared, ignored, pull, held: mergedAtHead(pull, target.head) };
  }

  // How long the confirmation waits for the pull request: without an answer by then, it asks as
  // it would without one.
  const REMOVAL_PULL_TIMEOUT = 5000;

  // The pull request of `branch` of the repository at `folder` (readPulls in github.js), as its
  // worktree's row picks it: the one a branch made from a pull request was made from, else by the
  // branch's name. Asked of the repository, as the worktree's folder may be gone. Null outside
  // GitHub, on the default branch, or when the branch has none; rejects without gh or without an
  // answer in REMOVAL_PULL_TIMEOUT.
  async function removalPull(folder, branch) {
    const [repo, links] = await Promise.all([githubRepo(folder), branchLinks(folder).catch(() => new Map())]);
    if (!repo || branch === repo.defaultBranch) return null;
    const made = links.get(branch);
    const numbers = made && made.pull ? { [branch]: made.pull.number } : {};
    const { pulls } = await branchPulls(repo, [branch], { folder, numbers, timeout: REMOVAL_PULL_TIMEOUT });
    return pulls.get(branch) || null;
  }

  // Worktrees whose removal is being checked or asked about (lowercase folder paths): a second
  // click on the trash button meanwhile does not ask again.
  const confirmingRemoval = new Set();

  // Asks, then removes the worktree. Nothing that would be lost is removed: the blockers have to
  // be dealt with first. Deleting the branch as well is offered, and checked when no commit would
  // be lost with it: none only it holds, or all of them in its merged pull request. What goes
  // without blocking (those commits, ignored files only the worktree has) makes the dialog a
  // warning that cancels on Enter (see removalDialog).
  async function confirmRemoveWorktree(folder, repo = null) {
    const key = folder.toLowerCase();
    if (confirmingRemoval.has(key) || removing.has(key)) return;
    confirmingRemoval.add(key);
    try {
      await askToRemoveWorktree(folder, repo);
    } finally {
      confirmingRemoval.delete(key);
    }
  }

  async function askToRemoveWorktree(folder, repo) {
    const { target, blockers, unshared, ignored, pull, held } = await removalCheck(folder, repo);
    if (!target) return;
    if (blockers.length) {
      messageBox({
        type: 'warning',
        message: t('{name} cannot be removed now.', { name: path.basename(folder) }),
        detail: [...blockers, '', t('Deal with these, then remove it again.')].join('\n'),
      });
      return;
    }
    const { branch } = target;
    const { response, checkboxChecked } = await messageBox(
      removalDialog({ folder, branch, missing: target.missing, unshared, ignored, pull, held, open: tabs.has(tabIdFor(folder)) }),
    );
    if (response !== 0) return;
    // Commits that the merged pull request holds can be fetched from it again: no notification.
    await removeWorktreeNow(target.repo, folder, { branch: branch && checkboxChecked ? branch : null, unshared: held ? 0 : unshared });
  }

  // Brings the repository's primary to the front (opening it if need be), closes the worktree's
  // tab (stopping its code-server), removes the worktree, and deletes `branch` if given. Work on
  // the repository goes on in its primary (merging, adding the next worktree), rather than in
  // whichever tab was in front or comes next: wherever the removal was asked from, whether or not
  // the worktree's tab was open, and even if the removal fails. A branch that held commits
  // nothing else has (`unshared`) is named in a notification with the commit that brings it back.
  // Resolves null, or the error it showed.
  async function removeWorktreeNow(repo, folder, { branch = null, unshared = 0, quiet = false } = {}) {
    const name = path.basename(folder);
    const id = tabIdFor(folder);
    const fail = (message, detail) => {
      if (!quiet) messageBox({ type: 'error', message, detail });
      return `${message} ${detail}`;
    };
    openTab(repo);
    removing.add(folder.toLowerCase());
    pushState();
    try {
      if (tabs.has(id)) await closeTab(id, { force: true });
      await removeWorktree(repo, folder);
    } catch (error) {
      return fail(
        t('Could not remove {name}.', { name }),
        `${gitMessage(error)}\n\n${
          platform === 'darwin'
            ? t('If Finder or a terminal has the folder open, close it and remove the worktree again.')
            : t('If File Explorer or a terminal has the folder open, close it and remove the worktree again.')
        }`,
      );
    } finally {
      removing.delete(folder.toLowerCase());
      pushState();
      refreshGit([], [repo]);
    }
    // The tab's VS Code state (open editors, Claude tabs) has no folder to go back to, and its
    // port is free for other tabs.
    serversFor(folder).removeInstanceData(id);
    clearPortStorage(forgetPort(id));
    saveTabs();
    if (branch) {
      let tip;
      try {
        tip = await deleteBranch(repo, branch);
      } catch (error) {
        return fail(t('Removed {name}, but could not delete the branch {branch}.', { name, branch }), gitMessage(error));
      }
      if (unshared && !quiet) notifyBranchDeleted(branch, tip);
    }
    return null;
  }

  return { removalCheck, confirmRemoveWorktree, removeWorktreeNow };
}

module.exports = { createWorktreeRemoval };
