const assert = require('node:assert/strict');
const test = require('node:test');
const { applySettings } = require('../helper-extension/settings');

test('applySettings sets and removes each setting, and lists those VS Code refused', async () => {
  const calls = [];
  const update = async (key, value) => {
    calls.push([key, value]);
    if (key === 'not.registered') throw new Error('Unable to write to User Settings because not.registered is not a registered configuration.');
  };
  const failed = await applySettings({ set: { 'editor.fontSize': 15, 'not.registered': true }, remove: ['editor.wordWrap'] }, update);
  assert.deepEqual(calls, [['editor.fontSize', 15], ['not.registered', true], ['editor.wordWrap', undefined]]);
  assert.deepEqual(failed, ['not.registered']);
  assert.deepEqual(await applySettings({}, update), []);
});
