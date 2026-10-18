// Adding a worktree from the dialog that asks for one (src/dialog/add-worktree.js), and opening it
// in a new tab with the first conversation. git, the dialogs and the tabs are injected, so fakes
// test it.
const path = require('path');
const { t } = require('../i18n');
const { capped } = require('../window/message-box');
const { samePath } = require('../util');

// `dialogs`: the DialogQueue. `windowOpen()`: whether there is a window to show a dialog in.
// `remotes()`: the remotes read for the side bar (lowercase path -> { url }). `forgetFocus()`:
// the new tab takes the focus as the dialog closes (dialog-view.js). `send(channel, ...args)`:
// to the side bar's page.
function createWorktreeAdding({ dialogs, windowOpen, remotes, githubRepo, addWorktree, setBranchLink, gitMessage,
  firstPrompt, openTab, tabs, forgetFocus, send, refreshGit, messageBox }) {
  // Asks for a new worktree of the repository in the dialog that adds one. One is enough:
  // clicking "+" again while it is up does not queue another. It offers issues and pull requests
  // only for a repository on GitHub: as the remotes read for the side bar say
  // (readVisibilities), else as the remote says now.
  async function addWorktreeDialog(repo) {
    const blocked = () => !windowOpen() || dialogs.has((dialog) => dialog.kind === 'worktree');
    if (typeof repo !== 'string' || blocked()) return;
    const known = remotes().get(repo.toLowerCase());
    const github = known ? Boolean(known.url) : Boolean(await githubRepo(repo));
    if (blocked()) return;
    dialogs.open({ kind: 'worktree', repo, name: path.basename(repo), github });
  }

  // Whether `repo` is the repository of the dialog that adds a worktree, which is in front: what
  // its page asks is done for that one only.
  function addingTo(repo) {
    const dialog = dialogs.current;
    return Boolean(dialog) && dialog.kind === 'worktree' && typeof repo === 'string' && samePath(dialog.repo, repo);
  }

  // Adds a worktree for the branch `name` next to the repository and opens it with a new
  // conversation: starting the conversation in the new worktree keeps it from being left behind
  // in another tab's VS Code. With a task (see task.js), the conversation has its prompt in its
  // input; a pull request is what the branch checks out; and a branch for an issue or from a pull
  // request keeps it for the worktree's row. Resolves { folder, copied } or { error }.
  async function addWorktreeTab(repo, name, task = null) {
    const kind = task && task.kind;
    let added;
    try {
      added = await addWorktree(repo, name, kind === 'pull' ? task : null);
    } catch (error) {
      return { error: gitMessage(error) };
    }
    const { folder, branch, copied, failed } = added;
    // The worktree is there all the same; its row only goes without the issue or pull request.
    if (kind === 'issue' || kind === 'pull') await setBranchLink(repo, branch, kind, task).catch(() => {});
    const id = openTab(folder);
    // From the dialog, the focus goes to the new tab as the dialog closes, not back to the side bar.
    forgetFocus();
    // Opened once the tab's helper extension has registered (see hooks.on('helper')).
    tabs.get(id).newConversation = { prompt: firstPrompt(task) };
    // The side bar shows the repository, and reads its worktrees again with the new one.
    send('worktrees:added', repo);
    refreshGit([], [repo]);
    // The worktree is there all the same; the files can be copied by hand.
    if (failed.length) {
      messageBox({
        type: 'warning',
        message: t('Some files in .worktreeinclude could not be copied.'),
        detail: capped(failed.map((f) => `${f.file}: ${f.message}`)).join('\n'),
      });
    }
    return { folder, copied: copied.length };
  }

  return { addWorktreeDialog, addingTo, addWorktreeTab };
}

module.exports = { createWorktreeAdding };
