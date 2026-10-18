const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { setLanguage } = require('../src/i18n');
const { DialogQueue, canceled, capped, cloneDialog, dialogOptions, removalDialog, settingsDialog, worktreeDialog } = require('../src/window/message-box');

test('dialogOptions fills in what showMessageBox would', () => {
  assert.deepEqual(dialogOptions({ message: 'This is not a git repository.' }), {
    kind: 'message',
    type: 'none',
    message: 'This is not a git repository.',
    detail: '',
    buttons: ['OK'],
    defaultId: 0,
    cancelId: 0,
    checkboxLabel: '',
    checkboxChecked: false,
  });
  const options = dialogOptions({
    type: 'question',
    buttons: ['Remove', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Remove the worktree a?',
    detail: 'C:\\repos\\a',
    checkboxLabel: 'Also delete the branch a',
    checkboxChecked: true,
  });
  assert.equal(options.type, 'question');
  assert.equal(options.defaultId, 0);
  assert.equal(options.cancelId, 1);
  assert.equal(options.checkboxChecked, true);
});

test('dialogOptions finds the cancel button by its label, and drops what does not fit', () => {
  assert.equal(dialogOptions({ buttons: ['Close', 'Cancel'] }).cancelId, 1);
  assert.equal(dialogOptions({ buttons: ['Yes', 'No'] }).cancelId, 1);
  assert.equal(dialogOptions({ buttons: ['Close', 'Suspend'] }).cancelId, 0);
  const options = dialogOptions({ type: 'fatal', buttons: ['a', 'b'], defaultId: 2, cancelId: -1, message: 3, checkboxChecked: true });
  assert.equal(options.type, 'none');
  assert.equal(options.defaultId, 0);
  assert.equal(options.cancelId, 0);
  assert.equal(options.message, '3');
  // No checkbox, nothing checked.
  assert.equal(options.checkboxChecked, false);
});

test('settingsDialog carries the agent choices', () => {
  assert.deepEqual(settingsDialog({ agents: ['claude', 'codex'], defaultAgent: 'codex', branchAgent: 'default' }), {
    kind: 'settings',
    agents: ['claude', 'codex'],
    defaultAgent: 'codex',
    branchAgent: 'default',
    codexApprovalMode: 'auto-review',
    buttons: ['Save', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: '',
    checkboxChecked: false,
  });
});

// A queue whose show and hide calls are recorded.
function recordedQueue() {
  const calls = [];
  const queue = new DialogQueue({ show: (dialog) => calls.push(`show ${dialog.message}`), hide: () => calls.push('hide') });
  return { queue, calls };
}

test('DialogQueue shows one dialog at a time, in order', async () => {
  const { queue, calls } = recordedQueue();
  const first = queue.open({ message: 'first', buttons: ['Remove', 'Cancel'], checkboxLabel: 'branch', checkboxChecked: true });
  const second = queue.open({ message: 'second' });
  assert.deepEqual(calls, ['show first']);
  assert.equal(queue.current.message, 'first');

  assert.equal(queue.answer(queue.current.id, 0, false), true);
  assert.deepEqual(await first, { response: 0, checkboxChecked: false });
  assert.deepEqual(calls, ['show first', 'show second']);

  queue.answer(queue.current.id, 0, true);
  // No checkbox: never checked.
  assert.deepEqual(await second, { response: 0, checkboxChecked: false });
  assert.deepEqual(calls, ['show first', 'show second', 'hide']);
  assert.equal(queue.current, null);
});

test('DialogQueue drops an answer for another dialog, and cancels on one that is not a button', async () => {
  const { queue } = recordedQueue();
  const asked = queue.open({ message: 'a', buttons: ['Close', 'Cancel'], defaultId: 0, cancelId: 1 });
  const { id } = queue.current;
  assert.equal(queue.answer(id + 1, 0), false);
  assert.equal(queue.current.id, id);
  queue.answer(id, 5);
  assert.deepEqual(await asked, { response: 1, checkboxChecked: false });
  assert.equal(queue.answer(id, 0), false);
});

test('DialogQueue.cancelAll cancels the dialog in front and those waiting', async () => {
  const { queue, calls } = recordedQueue();
  const first = queue.open({ message: 'first', buttons: ['Remove', 'Cancel'], cancelId: 1, checkboxLabel: 'branch', checkboxChecked: true });
  const second = queue.open({ message: 'second', buttons: ['OK'] });
  queue.cancelAll();
  assert.deepEqual(await first, { response: 1, checkboxChecked: true });
  assert.deepEqual(await second, { response: 0, checkboxChecked: false });
  assert.deepEqual(calls, ['show first', 'hide']);
  // Nothing up: nothing to hide.
  queue.cancelAll();
  assert.deepEqual(calls, ['show first', 'hide']);
  // The next one shows as usual.
  queue.open({ message: 'third' });
  assert.deepEqual(calls, ['show first', 'hide', 'show third']);
});

test('the dialog that adds a worktree waits its turn, and answers 0 once made or 1 when closed', async () => {
  const { queue, calls } = recordedQueue();
  const message = queue.open({ message: 'first' });
  const adding = queue.open({ kind: 'worktree', repo: 'C:\\repos\\a', name: 'a' });
  assert.equal(queue.has((dialog) => dialog.kind === 'worktree'), true);
  assert.equal(queue.has((dialog) => dialog.message === 'none'), false);
  queue.answer(queue.current.id, 0);
  await message;
  assert.deepEqual(
    { ...queue.current, id: 0 },
    { id: 0, kind: 'worktree', repo: 'C:\\repos\\a', name: 'a', github: true, buttons: ['Create', 'Cancel'], defaultId: 0, cancelId: 1, checkboxLabel: '', checkboxChecked: false },
  );
  queue.answer(queue.current.id, 0);
  assert.deepEqual(await adding, { response: 0, checkboxChecked: false });
  assert.equal(queue.has((dialog) => dialog.kind === 'worktree'), false);

  const closed = queue.open({ kind: 'worktree', repo: 'C:\\repos\\a', name: 'a' });
  queue.cancelAll();
  assert.deepEqual(await closed, { response: 1, checkboxChecked: false });
  assert.equal(calls.at(-1), 'hide');
});

test('the dialog that adds a worktree offers issues only for a repository on GitHub', () => {
  assert.equal(worktreeDialog({ repo: 'C:\\repos\\a', name: 'a' }).github, true);
  assert.equal(worktreeDialog({ repo: 'C:\\repos\\a', name: 'a', github: true }).github, true);
  assert.equal(worktreeDialog({ repo: 'C:\\repos\\a', name: 'a', github: false }).github, false);
});

test('the dialog that asks where to clone waits its turn, with its folder and choices', async () => {
  const { queue } = recordedQueue();
  const message = queue.open({ message: 'first' });
  const cloning = queue.open({
    kind: 'clone',
    url: 'https://github.com/o/app',
    slug: 'o/app',
    place: 'WSL: Ubuntu',
    dest: '\\\\wsl.localhost\\Ubuntu\\home\\me\\ghq\\github.com\\o\\app',
    choices: [{ dest: '\\\\wsl.localhost\\Ubuntu\\home\\me\\ghq\\github.com\\o\\app', count: 12 }, { dest: 'x', count: '2' }, null],
  });
  queue.answer(queue.current.id, 0);
  await message;
  assert.deepEqual(
    { ...queue.current, id: 0 },
    {
      id: 0,
      kind: 'clone',
      url: 'https://github.com/o/app',
      slug: 'o/app',
      place: 'WSL: Ubuntu',
      dest: '\\\\wsl.localhost\\Ubuntu\\home\\me\\ghq\\github.com\\o\\app',
      choices: [
        { dest: '\\\\wsl.localhost\\Ubuntu\\home\\me\\ghq\\github.com\\o\\app', count: 12 },
        { dest: 'x', count: 2 },
        { dest: '', count: 0 },
      ],
      buttons: ['Clone', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      checkboxLabel: '',
      checkboxChecked: false,
    },
  );
  assert.equal(queue.has((dialog) => dialog.kind === 'clone'), true);
  queue.cancelAll();
  assert.deepEqual(await cloning, { response: 1, checkboxChecked: false });
  assert.deepEqual(cloneDialog().choices, []);
});

test('canceled answers with the cancel button and the checkbox as it was', () => {
  const dialog = dialogOptions({ buttons: ['Remove', 'Cancel'], checkboxLabel: 'branch', checkboxChecked: true });
  assert.deepEqual(canceled(dialog), { response: 1, checkboxChecked: true });
});

test('capped lists 20 lines and counts the rest', () => {
  const lines = Array.from({ length: 23 }, (_, i) => `f${i}`);
  assert.deepEqual(capped(lines), [...lines.slice(0, 20), 'and 3 more']);
  assert.deepEqual(capped(lines.slice(0, 20)), lines.slice(0, 20));
});

// The confirmation of removing a worktree on the branch feat/x.
const folder = path.join('repos', 'r-feat-x');
const removal = (options) => removalDialog({ folder, branch: 'feat/x', ...options });
const merged = { number: 12, state: 'merged', head: 'a'.repeat(40) };
const paragraphs = (dialog) => dialog.detail.split('\n\n');

test('removalDialog asks, with the branch deleted too, when no commit would be lost', () => {
  const dialog = removal({});
  assert.deepEqual(dialog, {
    type: 'question',
    buttons: ['Remove', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Remove the worktree r-feat-x?',
    detail: `${folder}\nBranch: feat/x`,
    checkboxLabel: 'Also delete the branch feat/x',
    checkboxChecked: true,
  });
});

test('removalDialog warns of commits only the branch holds, and leaves the branch alone', () => {
  const dialog = removal({ unshared: 3 });
  assert.equal(dialog.type, 'warning');
  assert.equal(dialog.defaultId, 1);
  assert.equal(dialog.checkboxChecked, false);
  assert.deepEqual(paragraphs(dialog).slice(1), ['feat/x has 3 commits that no other branch, remote, or tag has. Deleting the branch too loses them.']);
});

test('removalDialog does not warn of commits that the pull request merged at the tip holds', () => {
  const dialog = removal({ unshared: 3, pull: merged, held: true });
  assert.equal(dialog.type, 'question');
  assert.equal(dialog.defaultId, 0);
  assert.equal(dialog.checkboxChecked, true);
  assert.deepEqual(paragraphs(dialog).slice(1), ['PR #12 is merged.\nfeat/x has 3 commits that no other branch, remote, or tag has, but all of them are in PR #12.']);
  // Without such commits, it only says the pull request was merged.
  assert.deepEqual(paragraphs(removal({ pull: merged, held: true })).slice(1), ['PR #12 is merged.']);
});

test('removalDialog warns as before when the tip is not what the pull request merged', () => {
  const dialog = removal({ unshared: 1, pull: merged, held: false });
  assert.equal(dialog.type, 'warning');
  assert.equal(dialog.defaultId, 1);
  assert.equal(dialog.checkboxChecked, false);
  assert.deepEqual(paragraphs(dialog).slice(1), [
    'PR #12 is merged, but the tip of the branch is not the last commit of the PR.',
    'feat/x has 1 commit that no other branch, remote, or tag has. Deleting the branch too loses it.',
  ]);
});

test('removalDialog says when the pull request is not merged', () => {
  const line = (state) => paragraphs(removal({ pull: { number: 7, state, head: null } }))[1];
  assert.equal(line('open'), 'PR #7 is not merged yet (open).');
  assert.equal(line('draft'), 'PR #7 is not merged yet (draft).');
  assert.equal(line('closed'), 'PR #7 was closed without merging.');
});

test('removalDialog warns of ignored files only the worktree has, merged or not', () => {
  const ignored = Array.from({ length: 21 }, (_, i) => `notes/${i}.md`);
  const dialog = removal({ unshared: 2, ignored, pull: merged, held: true });
  assert.equal(dialog.type, 'warning');
  assert.equal(dialog.defaultId, 1);
  // The commits are in the pull request all the same.
  assert.equal(dialog.checkboxChecked, true);
  const last = paragraphs(dialog).at(-1).split('\n');
  assert.equal(last[0], '21 gitignored files are not in the primary or differ from it there. Removing the worktree loses them.');
  assert.deepEqual(last.slice(1), [...ignored.slice(0, 20), 'and 1 more']);
});

test('removalDialog of a detached HEAD, a folder that is gone and a worktree with a tab', () => {
  const dialog = removalDialog({ folder, unshared: 2, missing: true, open: true });
  assert.equal(dialog.checkboxLabel, undefined);
  assert.equal(dialog.type, 'warning');
  assert.deepEqual(paragraphs(dialog), [
    folder,
    'The folder is gone. This removes the record of the worktree that git still keeps.',
    '2 commits are on no branch. Removing the worktree loses them.',
    'Its tab closes before it is removed.',
  ]);
});

test('in Japanese, the dialogs say what they said before the UI was in English', (t) => {
  setLanguage('ja');
  t.after(() => setLanguage('en'));
  assert.deepEqual(removal({}), {
    type: 'question',
    buttons: ['削除', 'キャンセル'],
    defaultId: 0,
    cancelId: 1,
    message: 'worktree r-feat-x を削除しますか？',
    detail: `${folder}\nブランチ: feat/x`,
    checkboxLabel: 'ブランチ feat/x も削除する',
    checkboxChecked: true,
  });
  assert.deepEqual(paragraphs(removal({ unshared: 3, pull: merged, held: true })).slice(1), [
    'PR #12 はマージ済みです。\nfeat/x には、ほかのブランチ・リモート・タグにないコミットが 3 個ありますが、どれも PR #12 に残っています。',
  ]);
  assert.deepEqual(capped(Array.from({ length: 23 }, (_, i) => `f${i}`)).at(-1), 'ほか 3 個');
  // The cancel button is found by its Japanese label.
  assert.equal(dialogOptions({ buttons: ['閉じる', 'キャンセル'] }).cancelId, 1);
});
