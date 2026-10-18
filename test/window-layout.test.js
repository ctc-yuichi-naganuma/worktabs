const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_WINDOW_SIZE, createWindowLayout, restoredWindowState } = require('../src/window/window-layout');

const display = (x, y, width, height) => ({ workArea: { x, y, width, height } });
const screenOf = (displays) => ({
  getPrimaryDisplay: () => displays[0],
  // The display a rectangle overlaps most; enough for these tests: the one its corner is on.
  getDisplayMatching: (rect) => displays.find((d) => rect.x >= d.workArea.x && rect.x < d.workArea.x + d.workArea.width) || displays[0],
});

test('a saved window comes back where it was, on a display that still shows it', () => {
  const screen = screenOf([display(0, 0, 1920, 1040), display(1920, 0, 1280, 1000)]);
  const saved = { x: 2000, y: 10, width: 1000, height: 800, maximized: true, sidebarWidth: 300 };
  assert.deepEqual(restoredWindowState(saved, screen), { bounds: { x: 2000, y: 10, width: 1000, height: 800 }, maximized: true, sidebarWidth: 300 });
  // The second display is gone: centered on the primary, within its size.
  const one = screenOf([display(0, 0, 1280, 700)]);
  assert.deepEqual(restoredWindowState({ ...saved, x: 5000 }, one), { bounds: { width: 1000, height: 700 }, maximized: true, sidebarWidth: 300 });
  // The first start, or a file that makes no sense.
  assert.deepEqual(restoredWindowState(null, screen), { bounds: DEFAULT_WINDOW_SIZE, maximized: false, sidebarWidth: null });
  assert.deepEqual(restoredWindowState({ x: 'a', maximized: true }, screen).maximized, false);
});

function setup(t, { width = 1200 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktabs-window-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'window.json');
  const bounds = {};
  const view = (name, visible = true) => ({ setBounds: (b) => { bounds[name] = b; }, getVisible: () => visible });
  const win = {
    isDestroyed: () => false, isMinimized: () => false, isMaximized: () => false,
    getContentBounds: () => ({ width, height: 800 }), getNormalBounds: () => ({ x: 1, y: 2, width, height: 800 }),
  };
  const views = { win, sidebar: view('sidebar'), emptyView: view('empty'), dialogView: view('dialog') };
  const tabs = new Map([['shown', { view: view('shown') }], ['hidden', { view: view('hidden', false) }]]);
  const layout = createWindowLayout({ file, screen: screenOf([display(0, 0, 1920, 1040)]), views: () => views, tabs, configured: () => 260 });
  return { layout, bounds, file };
}

test('the side bar takes the configured width, and the tabs the rest', (t) => {
  const { layout, bounds } = setup(t);
  layout.layout();
  assert.deepEqual(bounds.sidebar, { x: 0, y: 0, width: 260, height: 800 });
  assert.deepEqual(bounds.shown, { x: 260, y: 0, width: 940, height: 800 });
  assert.deepEqual(bounds.dialog, { x: 0, y: 0, width: 1200, height: 800 });
});

test('a drag covers the window, lays out only the tab in view, and is kept once it ends', (t) => {
  const { layout, bounds, file } = setup(t);
  assert.deepEqual(layout.startResize(), { width: 260, min: 180, max: 600 });
  delete bounds.hidden;
  layout.resize(400);
  assert.equal(bounds.sidebar.width, 1200);
  assert.equal(bounds.shown.x, 400);
  assert.equal(bounds.hidden, undefined);
  assert.equal(layout.endResize(400), 400);
  assert.equal(bounds.hidden.x, 400);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { x: 1, y: 2, width: 1200, height: 800, maximized: false, sidebarWidth: 400 });
  assert.deepEqual(layout.snapshot(), { sidebarWidth: 400, configured: 260, dragging: false });
  // A resize without a drag does nothing; a double click goes back to the configured width.
  layout.resize(500);
  assert.equal(bounds.shown.x, 400);
  assert.equal(layout.resetWidth(), 260);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).sidebarWidth, undefined);
});

test('a drag back to the configured width follows the setting again, and a click keeps the width', (t) => {
  const { layout } = setup(t);
  layout.startResize();
  layout.endResize(260);
  assert.equal(layout.snapshot().sidebarWidth, null);
  layout.startResize();
  assert.equal(layout.endResize(null), 260);
});

test('the width and maximized state saved come back at the next start', (t) => {
  const { layout, file } = setup(t);
  fs.writeFileSync(file, JSON.stringify({ x: 10, y: 10, width: 900, height: 700, maximized: true, sidebarWidth: 320 }));
  const restored = layout.restore();
  assert.equal(restored.maximized, true);
  assert.equal(layout.snapshot().sidebarWidth, 320);
});
