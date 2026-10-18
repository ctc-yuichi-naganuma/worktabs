// Every view the app makes keeps Electron's isolation on, whatever else it asks for.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { SECURE, viewPreferences } = require('../src/window/web-preferences');

test('viewPreferences adds the isolation settings, and options cannot loosen them', () => {
  assert.deepEqual(SECURE, { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true });
  assert.deepEqual(viewPreferences(), SECURE);
  assert.deepEqual(viewPreferences({ partition: 'persist:x', sandbox: false, nodeIntegration: true }), { partition: 'persist:x', ...SECURE });
});

test('main.js makes every view with viewPreferences', () => {
  // main.js cannot be loaded without Electron, so this reads its source.
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const views = source.match(/new WebContentsView\([^\n]*/g);
  assert.ok(views.length >= 4);
  for (const view of views) assert.match(view, /^new WebContentsView\(\{ webPreferences: viewPreferences\(/);
  assert.doesNotMatch(source, /new BrowserWindow\(/);
});
