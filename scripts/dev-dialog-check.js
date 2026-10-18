// Dialog check: shows the app's dialogs through the control port and presses keys in them as the
// keyboard would: the focus on the default button, Tab going round the dialog, the checkbox,
// Enter and Esc, one dialog waiting for another, the focus going back where it was, and closing
// the window with a dialog up (the tab gets a Claude turn in progress, so the app asks first;
// the check answers Cancel, and the app stays).
// usage: node scripts/dev-dialog-check.js <tab name>
const assert = require('node:assert/strict');
const { appText, call, log, run, sleep, tabNamed, until } = require('./dev-lib');

const NAME = process.argv[2];

// What the dialog page shows, null while it shows none.
const DIALOG = `(() => {
  if (document.getElementById('backdrop').hidden || document.getElementById('box').hidden) return null;
  const active = document.activeElement;
  return {
    type: document.getElementById('box').className.replace('box ', ''),
    message: document.getElementById('message').textContent,
    focused: active.classList.contains('button') ? active.textContent : active.id || active.tagName,
    checked: document.getElementById('checkbox').checked,
    buttons: [...document.querySelectorAll('#buttons .button')].map((b) => b.textContent + (b.classList.contains('primary') ? ' (primary)' : '')),
  };
})()`;

const dialogState = () => call('eval', { id: 'dialog', js: DIALOG });

function shown(message) {
  return until(`dialog "${message}"`, async () => {
    const dialog = await dialogState();
    return dialog && dialog.message === message ? dialog : null;
  }, 10000, 200);
}

const press = (keyCode, modifiers = []) => call('key', { id: 'dialog', keyCode, modifiers });
const focusedControl = async () => (await dialogState()).focused;

run(async () => {
  const tab = await tabNamed(NAME);
  await call('activate', { id: tab.id });
  await sleep(300);
  assert.equal(await call('focused'), tab.id);

  // The removal's confirmation, with Cancel the default.
  const removal = call('dialog', {
    type: 'question',
    buttons: ['Remove', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Remove the worktree a?',
    detail: 'C:\\repos\\a\nBranch: a',
    checkboxLabel: 'Also delete the branch a',
    checkboxChecked: true,
  });
  const dialog = await shown('Remove the worktree a?');
  log('shown:', JSON.stringify(dialog));
  assert.equal(await call('focused'), 'dialog');
  assert.equal(dialog.focused, 'Cancel');
  await press('Tab');
  assert.equal(await focusedControl(), 'checkbox');
  await press('Tab', ['shift']);
  assert.equal(await focusedControl(), 'Cancel');
  await press('Left');
  assert.equal(await focusedControl(), 'Remove');
  // The app's keys do nothing meanwhile.
  await press('PageDown', ['control', 'alt']);
  await press('Tab', ['shift']);
  await press('Space');
  assert.equal((await dialogState()).checked, false);
  await press('Escape');
  assert.deepEqual(await removal, { response: 1, checkboxChecked: false });
  log('Esc: canceled, the checkbox as it was left');
  await sleep(300);
  assert.equal(await call('focused'), tab.id);
  assert.equal((await call('state')).tabs.find((t) => t.active).id, tab.id);
  log('the focus is back in the tab');

  // Two at once: the second waits for the first.
  const first = call('dialog', { type: 'warning', message: 'first', buttons: ['Close', 'Cancel'], defaultId: 0, cancelId: 1 });
  const second = call('dialog', { type: 'error', message: 'second', detail: 'fatal: not a git repository' });
  await shown('first');
  await press('Enter');
  assert.deepEqual(await first, { response: 0, checkboxChecked: false });
  await shown('second');
  await press('Enter');
  assert.deepEqual(await second, { response: 0, checkboxChecked: false });
  log('one after the other');

  // Closing the window with a dialog up: canceled, then the app asks about the turn in progress.
  await call('hook', { id: tab.id, input: { session_id: 'dialog-check', hook_event_name: 'UserPromptSubmit', prompt: 'dialog check' } });
  const upWhenClosed = call('dialog', { type: 'info', message: 'up when closed', buttons: ['OK', 'Cancel'] });
  await shown('up when closed');
  await call('closeWindow');
  assert.deepEqual(await upWhenClosed, { response: 1, checkboxChecked: false });
  const quit = await shown((await appText())('Quitting will have these effects.'));
  log('closed with a dialog up: canceled, then', JSON.stringify(quit));
  await press('Escape');
  await sleep(300);
  assert.equal(await dialogState(), null);
  await call('hook', { id: tab.id, input: { session_id: 'dialog-check', hook_event_name: 'SessionEnd' } });
  log('still running after Cancel');
});
