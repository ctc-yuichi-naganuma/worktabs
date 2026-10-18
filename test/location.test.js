const assert = require('node:assert/strict');
const test = require('node:test');
const { sidebarLocation } = require('../helper-extension/location');

test('sidebarLocation writes nothing when the setting reads sidebar already', () => {
  assert.deepEqual(sidebarLocation({ defaultValue: 'panel', globalValue: 'sidebar' }), { write: false });
  assert.deepEqual(sidebarLocation({ defaultValue: 'panel', globalValue: 'panel', workspaceValue: 'sidebar' }), { write: false });
});

test('sidebarLocation writes the user setting and puts back what it held', () => {
  assert.deepEqual(sidebarLocation({ defaultValue: 'panel', globalValue: 'panel' }), { write: true, restore: 'panel' });
  // Not in the user settings: it goes out again.
  assert.deepEqual(sidebarLocation({ defaultValue: 'panel' }), { write: true, restore: undefined });
  // Anything but 'sidebar' reads as 'panel' to the extension.
  assert.deepEqual(sidebarLocation({ defaultValue: 'panel', globalValue: 'other' }), { write: true, restore: 'other' });
});

test('sidebarLocation leaves the workspace settings alone', () => {
  assert.equal(sidebarLocation({ defaultValue: 'panel', globalValue: 'sidebar', workspaceValue: 'panel' }), null);
});

test('sidebarLocation takes a setting the extension has not declared', () => {
  assert.deepEqual(sidebarLocation(undefined), { write: true, restore: undefined });
});
