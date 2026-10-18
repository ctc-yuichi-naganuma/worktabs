const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createThemeState } = require('../src/window/theme-state');
const { sidebarTheme } = require('../src/window/theme');

const dirs = [];
test.after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });

const READ = { kind: 'vs-dark', colors: { 'sideBar.background': '#181818', foreground: '#cccccc' } };

function setup({ saved } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktabs-theme-'));
  dirs.push(dir);
  const file = path.join(dir, 'theme.json');
  if (saved !== undefined) fs.writeFileSync(file, saved);
  const calls = [];
  const win = { setBackgroundColor: (color) => calls.push(['background', color]) };
  const dialogView = { webContents: { isDestroyed: () => false, send: (...args) => calls.push(args) } };
  const tabs = new Map();
  const state = { active: 't1' };
  const theme = createThemeState({
    file, views: () => ({ win, dialogView }), tabs, activeId: () => state.active, changed: () => calls.push(['changed']),
  });
  const tab = (id, read = READ) => {
    const made = { id, server: 'running', view: { webContents: { executeJavaScript: async () => read } } };
    tabs.set(id, made);
    return made;
  };
  return { theme, calls, file, tab, tabs, state };
}

test('the theme starts as the last run saved it, or null', () => {
  assert.equal(setup().theme.current(), null);
  assert.equal(setup({ saved: '{ not json' }).theme.current(), null);
  const saved = sidebarTheme(READ);
  assert.deepEqual(setup({ saved: JSON.stringify(saved) }).theme.current(), saved);
});

test('reading the tab in front sets the theme, saves it and tells the window and the dialog', async () => {
  const { theme, calls, file, tab } = setup();
  const front = tab('t1');
  await theme.read(front);
  const colors = sidebarTheme(READ);
  assert.deepEqual(front.theme, colors);
  assert.deepEqual(theme.current(), colors);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), colors);
  assert.deepEqual(calls.map(([kind]) => kind), ['background', 'dialog:theme', 'changed']);
  // The same colors again change nothing.
  calls.length = 0;
  theme.set(colors);
  assert.deepEqual(calls, []);
});

test('a tab behind keeps its colors for later, and a stopped or closed tab is not read', async () => {
  const { theme, calls, tab, tabs } = setup();
  const behind = tab('t2');
  await theme.read(behind);
  assert.ok(behind.theme);
  assert.equal(theme.current(), null);
  const stopped = { ...tab('t3'), server: 'stopped' };
  await theme.read(stopped);
  assert.equal(stopped.theme, undefined);
  const closed = tab('t1');
  tabs.delete('t1');
  await theme.read(closed);
  assert.equal(closed.theme, undefined);
  const unreadable = tab('t1', null);
  await theme.read(unreadable);
  assert.equal(unreadable.theme, undefined);
  assert.deepEqual(calls, []);
});
