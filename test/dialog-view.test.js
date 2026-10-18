const assert = require('node:assert/strict');
const test = require('node:test');
const { createDialogView } = require('../src/window/dialog-view');

function contents(name, calls) {
  return { name, sent: [], send(...args) { this.sent.push(args); }, focus: () => calls.push(['focus', name]) };
}

function setup({ focusedName = 'sidebar', windowFocused = true, active = true } = {}) {
  const calls = [];
  const sidebar = { webContents: contents('sidebar', calls) };
  const tab = { view: { webContents: contents('tab', calls) } };
  let visible = false;
  const dialogView = {
    webContents: contents('dialog', calls),
    getVisible: () => visible,
    setVisible: (on) => { visible = on; calls.push(['visible', on]); },
  };
  const win = { isFocused: () => windowFocused, flashFrame: (on) => calls.push(['flash', on]) };
  const state = { win, sidebar, dialogView, focused: focusedName === 'tab' ? tab.view.webContents : sidebar.webContents };
  const view = createDialogView({
    views: () => ({ win: state.win, sidebar, dialogView }),
    focused: () => state.focused,
    activeTab: () => (active ? tab : undefined),
    theme: () => ({ scheme: 'dark' }),
    refreshSeen: () => calls.push(['seen']),
  });
  return { view, calls, dialogView, state };
}

test('a dialog shows on the dialog page with the theme, and the focus goes back to the side bar that had it', async () => {
  const { view, calls, dialogView } = setup({ windowFocused: false });
  const answer = view.messageBox({ message: 'Hello', buttons: ['OK', 'Cancel'] });
  const [channel, dialog, theme] = dialogView.webContents.sent[0];
  assert.equal(channel, 'dialog:show');
  assert.equal(dialog.message, 'Hello');
  assert.deepEqual(theme, { scheme: 'dark' });
  assert.deepEqual(calls.slice(0, 4), [['visible', true], ['focus', 'dialog'], ['seen'], ['flash', true]]);
  view.dialogs.answer(dialog.id, 0, false);
  assert.deepEqual(await answer, { response: 0, checkboxChecked: false });
  assert.deepEqual(calls.slice(-3), [['visible', false], ['focus', 'sidebar'], ['seen']]);
});

test('the focus goes to the tab in front unless the side bar had it', async () => {
  const { view, calls, dialogView } = setup({ focusedName: 'tab' });
  view.messageBox({ message: 'One' });
  view.dialogs.answer(dialogView.webContents.sent[0][1].id, 0);
  assert.deepEqual(calls.at(-2), ['focus', 'tab']);

  const opened = setup({ focusedName: 'sidebar' });
  opened.view.messageBox({ message: 'Two' });
  // A dialog that opened a tab hands the focus to it.
  opened.view.forgetFocus();
  opened.view.dialogs.answer(opened.dialogView.webContents.sent[0][1].id, 0);
  assert.deepEqual(opened.calls.at(-2), ['focus', 'tab']);

  const empty = setup({ focusedName: 'tab', active: false });
  empty.view.messageBox({ message: 'Three' });
  empty.view.dialogs.answer(empty.dialogView.webContents.sent[0][1].id, 0);
  assert.deepEqual(empty.calls.at(-2), ['focus', 'sidebar']);
});

test('without a window a dialog is canceled at once', async () => {
  const { view, state, dialogView } = setup();
  state.win = null;
  assert.deepEqual(await view.messageBox({ buttons: ['Yes', 'No'], cancelId: 1 }), { response: 1, checkboxChecked: false });
  assert.equal(dialogView.webContents.sent.length, 0);
});

test('the text of the dialog in front, and whether a sender is the settings dialog', () => {
  const { view, dialogView } = setup();
  assert.equal(view.currentText(), null);
  view.messageBox({ message: 'Message', detail: 'Detail' });
  assert.equal(view.currentText(), 'Message\n\nDetail');
  assert.equal(view.fromSettingsDialog(dialogView.webContents), false);
  view.dialogs.cancelAll();
  view.messageBox({ kind: 'settings', agents: ['claude'] });
  assert.equal(view.fromSettingsDialog(dialogView.webContents), true);
  assert.equal(view.fromSettingsDialog({}), false);
});
