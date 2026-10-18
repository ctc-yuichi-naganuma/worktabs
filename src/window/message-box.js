// The app's dialogs, which it draws itself (src/dialog/) instead of Electron's
// dialog.showMessageBox: that one is a Windows task dialog, white whatever the VS Code theme or
// Windows' dark mode (electron#22231). What is here is apart from Electron, to be tested.
const path = require('path');
const { t } = require('../i18n');

const TYPES = ['none', 'info', 'warning', 'error', 'question'];
// Labels of a button that cancels, when cancelId does not say which does (as Electron does),
// lowercase.
const cancelLabels = () => [t('Cancel'), t('No'), 'cancel', 'no'].map((label) => label.toLowerCase());

const text = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));

// The options of dialog.showMessageBox the app uses, filled in as Electron does: { kind:
// 'message', type, message, detail, buttons, defaultId, cancelId, checkboxLabel,
// checkboxChecked }.
function dialogOptions(options = {}) {
  const buttons = Array.isArray(options.buttons) && options.buttons.length ? options.buttons.map(text) : ['OK'];
  const index = (value) => (Number.isInteger(value) && value >= 0 && value < buttons.length ? value : null);
  const cancels = cancelLabels();
  const labeled = buttons.findIndex((label) => cancels.includes(label.trim().toLowerCase()));
  const checkboxLabel = text(options.checkboxLabel);
  return {
    kind: 'message',
    type: TYPES.includes(options.type) ? options.type : 'none',
    message: text(options.message),
    detail: text(options.detail),
    buttons,
    defaultId: index(options.defaultId) ?? 0,
    cancelId: index(options.cancelId) ?? (labeled >= 0 ? labeled : 0),
    checkboxLabel,
    checkboxChecked: Boolean(checkboxLabel && options.checkboxChecked),
  };
}

// The dialog that adds a worktree to the repository at `repo` (named `name`), with a form of its
// own (src/dialog/add-worktree.js) in place of a message. `github`: whether the repository is on
// GitHub, so that the form offers issues and pull requests; unless told it is not, it is. It
// waits its turn with the others. Its page answers 0 once it has made the worktree; closed
// without one, it answers 1.
/** @param {{ repo?: string, name?: string, github?: boolean }} [options] */
function worktreeDialog({ repo, name, github } = {}) {
  return {
    kind: 'worktree',
    repo: text(repo),
    name: text(name),
    github: github !== false,
    buttons: [t('Create'), t('Cancel')],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: '',
    checkboxChecked: false,
  };
}

// The dialog that asks where to clone a repository with git, where there is no ghq to decide (see
// openCloneDialog in main.js), with a form of its own (src/dialog/clone.js). `url`: the
// repository's address on GitHub; `slug`: owner/name; `place`: where it goes ('Windows', 'WSL:
// Ubuntu', or '' on macOS); `dest`: the folder it starts with; `choices`: other folders, from
// where the listed repositories are ([{ dest, count }]). Its page answers 0 once the clone has
// started; closed without one, it answers 1.
/** @param {{ url?: string, slug?: string, place?: string, dest?: string, choices?: { dest: string, count: number }[] }} [options] */
function cloneDialog({ url, slug, place, dest, choices } = {}) {
  return {
    kind: 'clone',
    url: text(url),
    slug: text(slug),
    place: text(place),
    dest: text(dest),
    choices: (Array.isArray(choices) ? choices : []).map((choice) => ({ dest: text(choice && choice.dest), count: Number(choice && choice.count) || 0 })),
    buttons: [t('Clone'), t('Cancel')],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: '',
    checkboxChecked: false,
  };
}

// The settings dialog edits the agent-related app settings. It returns 0 when saved and 1 when
// closed without saving.
/** @param {{ agents?: string[], defaultAgent?: string, branchAgent?: string, codexApprovalMode?: string, section?: string }} [options] */
function settingsDialog({ agents, defaultAgent, branchAgent, codexApprovalMode = 'auto-review', section } = {}) {
  return {
    kind: 'settings',
    ...(section ? { section } : {}),
    agents: Array.isArray(agents) ? agents.map(text) : [],
    defaultAgent: text(defaultAgent),
    branchAgent: text(branchAgent),
    codexApprovalMode: codexApprovalMode === 'manual' ? 'manual' : 'auto-review',
    buttons: [t('Save'), t('Cancel')],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: '',
    checkboxChecked: false,
  };
}

// A list for a dialog: its first 20 lines, and how many more there are.
function capped(lines, max = 20) {
  return [...lines.slice(0, max), ...(lines.length > max ? [t('and {count} more', { count: lines.length - max })] : [])];
}

// What the confirmation says of the branch's pull request (readPulls in github.js). `held`: it
// was merged at the branch's tip (mergedAtHead in github.js).
function pullLine(pull, held) {
  const { number } = pull;
  if (pull.state === 'merged') {
    return held
      ? t('PR #{number} is merged.', { number })
      : t('PR #{number} is merged, but the tip of the branch is not the last commit of the PR.', { number });
  }
  if (pull.state === 'closed') return t('PR #{number} was closed without merging.', { number });
  return pull.state === 'draft' ? t('PR #{number} is not merged yet (draft).', { number }) : t('PR #{number} is not merged yet (open).', { number });
}

// What the confirmation says of the commits that removing the worktree (and deleting its branch,
// when it has one) would lose.
function lostLine(branch, count) {
  if (branch) {
    return count === 1
      ? t('{branch} has 1 commit that no other branch, remote, or tag has. Deleting the branch too loses it.', { branch })
      : t('{branch} has {count} commits that no other branch, remote, or tag has. Deleting the branch too loses them.', { branch, count });
  }
  return count === 1
    ? t('1 commit is on no branch. Removing the worktree loses it.')
    : t('{count} commits are on no branch. Removing the worktree loses them.', { count });
}

// The confirmation of removing the worktree at `folder` (see askToRemoveWorktree in worktree-removal.js), as
// options of dialog.showMessageBox. `branch`: its branch, or null for a detached HEAD; deleting
// it too is offered. `missing`: its folder is gone. `unshared`: the commits only it holds
// (unsharedCommits in worktrees.js). `ignored`: the ignored files only the worktree has
// (ignoredOnlyHere). `pull`: the branch's pull request, or null when it has none or it could not
// be read. `held`: the pull request was merged at the branch's tip, so it holds those commits.
// `open`: the worktree has a tab. What would be lost (commits nothing else holds, the ignored
// files) makes it a warning that cancels on Enter, and leaves the branch alone.
function removalDialog({ folder, branch = null, missing = false, unshared = 0, ignored = [], pull = null, held = false, open = false }) {
  const lost = held ? 0 : unshared;
  const detail = [folder];
  if (branch) detail.push(t('Branch: {branch}', { branch }));
  if (missing) detail.push('', t('The folder is gone. This removes the record of the worktree that git still keeps.'));
  if (pull) detail.push('', pullLine(pull, held));
  if (unshared && held) {
    const words = { branch, count: unshared, number: pull.number };
    detail.push(
      unshared === 1
        ? t('{branch} has 1 commit that no other branch, remote, or tag has, but it is in PR #{number}.', words)
        : t('{branch} has {count} commits that no other branch, remote, or tag has, but all of them are in PR #{number}.', words),
    );
  }
  if (lost) detail.push('', lostLine(branch, lost));
  if (ignored.length) {
    detail.push(
      '',
      ignored.length === 1
        ? t('1 gitignored file is not in the primary or differs from it there. Removing the worktree loses it.')
        : t('{count} gitignored files are not in the primary or differ from it there. Removing the worktree loses them.', { count: ignored.length }),
      ...capped(ignored),
    );
  }
  if (open) detail.push('', t('Its tab closes before it is removed.'));
  const warn = Boolean(lost || ignored.length);
  return {
    type: warn ? 'warning' : 'question',
    buttons: [t('Remove'), t('Cancel')],
    defaultId: warn ? 1 : 0,
    cancelId: 1,
    message: t('Remove the worktree {name}?', { name: path.basename(folder) }),
    detail: detail.join('\n'),
    ...(branch ? { checkboxLabel: t('Also delete the branch {branch}', { branch }), checkboxChecked: !lost } : {}),
  };
}

// What a dialog resolves to when it is not answered with a button: its cancel button.
function canceled(dialog) {
  return { response: dialog.cancelId, checkboxChecked: dialog.checkboxChecked };
}

// Dialogs one at a time, in the order they were asked for: one that comes up while another is
// open waits for it. `show(dialog)` puts a dialog (with an id) in front, `hide()` is called once
// none is left.
class DialogQueue {
  constructor({ show, hide }) {
    this.show = show;
    this.hide = hide;
    this.front = null;
    this.waiting = [];
    this.lastId = 0;
  }

  // The dialog in front, or null.
  get current() {
    return this.front ? this.front.dialog : null;
  }

  // Resolves { response, checkboxChecked } as dialog.showMessageBox does. Options of kind
  // 'worktree' make the dialog that adds a worktree (worktreeDialog), of kind 'clone' the one
  // that asks where to clone (cloneDialog), and of kind 'settings' the app settings dialog.
  open(options) {
    const kind = options && options.kind;
    const dialog =
      kind === 'worktree' ? worktreeDialog(options) : kind === 'clone' ? cloneDialog(options) : kind === 'settings' ? settingsDialog(options) : dialogOptions(options);
    return new Promise((resolve) => {
      this.lastId += 1;
      this.waiting.push({ dialog: { id: this.lastId, ...dialog }, resolve });
      if (!this.front) this.next();
    });
  }

  // Whether a dialog in front or waiting is one for which `test` holds.
  has(test) {
    return [this.front, ...this.waiting].some((entry) => entry && test(entry.dialog));
  }

  // Answers the dialog in front with the button `response` and brings up the next one. An answer
  // for another dialog (one already canceled) is dropped; a response that is not a button
  // cancels. Returns whether it answered.
  answer(id, response, checkboxChecked) {
    if (!this.front || this.front.dialog.id !== id) return false;
    const { dialog, resolve } = this.front;
    const valid = Number.isInteger(response) && response >= 0 && response < dialog.buttons.length;
    resolve({
      response: valid ? response : dialog.cancelId,
      checkboxChecked: dialog.checkboxLabel ? Boolean(checkboxChecked) : false,
    });
    this.next();
    return true;
  }

  // Cancels the dialog in front and the ones waiting.
  cancelAll() {
    const entries = [this.front, ...this.waiting].filter(Boolean);
    if (!entries.length) return;
    this.front = null;
    this.waiting = [];
    for (const { dialog, resolve } of entries) resolve(canceled(dialog));
    this.hide();
  }

  next() {
    this.front = this.waiting.shift() || null;
    if (this.front) this.show(this.front.dialog);
    else this.hide();
  }
}

module.exports = { DialogQueue, canceled, capped, cloneDialog, dialogOptions, removalDialog, settingsDialog, worktreeDialog };
