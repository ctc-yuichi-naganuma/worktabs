const assert = require('node:assert/strict');
const test = require('node:test');
const { hostKeyAction } = require('../src/window/host-keys');

const key = (input) => ({ type: 'keyDown', control: false, alt: false, shift: false, meta: false, ...input });

test('Ctrl+Alt+PageDown and PageUp switch tabs, but not while a dialog is up', () => {
  assert.equal(hostKeyAction(key({ control: true, alt: true, key: 'PageDown' })), 'next');
  assert.equal(hostKeyAction(key({ control: true, alt: true, key: 'PageUp' })), 'previous');
  assert.equal(hostKeyAction(key({ control: true, alt: true, key: 'PageUp' }), { dialogOpen: true }), null);
  assert.equal(hostKeyAction(key({ control: true, alt: true, shift: true, key: 'PageUp' })), null);
  assert.equal(hostKeyAction({ ...key({ control: true, alt: true, key: 'PageUp' }), type: 'keyUp' }), null);
});

test('the paste fallback takes the platform modifier with V only when it is turned on', () => {
  const ctrlV = key({ control: true, code: 'KeyV' });
  const cmdV = key({ meta: true, code: 'KeyV' });
  assert.equal(hostKeyAction(ctrlV, { platform: 'win32' }), null);
  assert.equal(hostKeyAction(ctrlV, { pasteFallback: true, platform: 'win32' }), 'paste');
  assert.equal(hostKeyAction(cmdV, { pasteFallback: true, platform: 'win32' }), null);
  assert.equal(hostKeyAction(cmdV, { pasteFallback: true, platform: 'darwin' }), 'paste');
  assert.equal(hostKeyAction(key({ control: true, shift: true, code: 'KeyV' }), { pasteFallback: true, platform: 'win32' }), null);
});
