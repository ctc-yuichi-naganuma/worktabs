// The window's views (the side bar, the tabs, the page shown without tabs, the dialogs) laid out
// side by side, the side bar's width as its edge is dragged, and the window's place and size kept
// in window.json for the next start. The window, its views and the displays are injected.
const fs = require('fs');
const { fitSidebarWidth, savedSidebarWidth, sidebarLimits } = require('./sidebar-width');

const DEFAULT_WINDOW_SIZE = { width: 1500, height: 950 };

// The window's bounds in its normal (not maximized) state, and whether it was maximized, as of
// the last close or move (Electron works in DIPs, so this holds across displays of different
// scaling). The position is dropped when no display shows enough of the window any more (a
// monitor was unplugged, say): it then opens centered. The size is kept within the display.
// With them, the width the side bar was dragged to. `screen`: Electron's.
function restoredWindowState(saved, screen) {
  const valid = saved && ['x', 'y', 'width', 'height'].every((key) => Number.isInteger(saved[key])) && saved.width > 0 && saved.height > 0;
  const wanted = valid ? saved : DEFAULT_WINDOW_SIZE;
  // The display the window overlaps most, when it shows enough of the window to grab.
  let shown = null;
  if (valid) {
    const display = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: saved.width, height: saved.height });
    const area = display.workArea;
    const overlapX = Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x);
    const overlapY = Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y);
    if (overlapX >= 100 && overlapY >= 50) shown = display;
  }
  const area = (shown || screen.getPrimaryDisplay()).workArea;
  const size = { width: Math.min(wanted.width, area.width), height: Math.min(wanted.height, area.height) };
  return {
    bounds: shown ? { x: saved.x, y: saved.y, ...size } : size,
    maximized: Boolean(valid && saved.maximized),
    sidebarWidth: savedSidebarWidth(saved?.sidebarWidth),
  };
}

// `views()`: { win, sidebar, emptyView, dialogView }, once the window is made. `configured()`:
// the side bar's width in the settings.
function createWindowLayout({ file, screen, views, tabs, configured }) {
  // Whether the window was maximized the last time it was saved; a minimized window cannot tell.
  let maximized = false;
  // The width the side bar's edge was dragged to, or null for the configured one, which a double
  // click on the edge goes back to.
  let sidebarWidth = null;
  // While the side bar's edge is dragged: the width it is dragged to.
  let drag = null;

  // Where the window opens, from window.json (the default size, centered, on the first start).
  function restore() {
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // First start.
    }
    const restored = restoredWindowState(saved, screen);
    maximized = restored.maximized;
    sidebarWidth = restored.sidebarWidth;
    return restored;
  }

  function save() {
    const { win } = views();
    if (!win || win.isDestroyed()) return;
    if (!win.isMinimized()) maximized = win.isMaximized();
    const { x, y, width, height } = win.getNormalBounds();
    const state = { x, y, width, height, maximized, ...(sidebarWidth === null ? {} : { sidebarWidth }) };
    fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  }

  function shownWidth(windowWidth) {
    return fitSidebarWidth(drag ?? sidebarWidth ?? configured(), windowWidth);
  }

  function layout() {
    const { win, sidebar, emptyView, dialogView } = views();
    const { width, height } = win.getContentBounds();
    const side = shownWidth(width);
    const content = { x: side, y: 0, width: Math.max(0, width - side), height };
    // While its edge is dragged, the side bar covers the window: see startResize.
    sidebar.setBounds({ x: 0, y: 0, width: drag === null ? side : width, height });
    emptyView.setBounds(content);
    // The hidden tabs follow once the drag ends: each is a VS Code to lay out again.
    for (const tab of tabs.values()) if (drag === null || tab.view.getVisible()) tab.view.setBounds(content);
    dialogView.setBounds({ x: 0, y: 0, width, height });
  }

  // The side bar's right edge drags (sidebar.js). The side bar and the tabs are separate views,
  // so the mouse, once it goes past the edge onto a tab, may move on that tab's page instead.
  // While the edge is dragged, the side bar covers the whole window: its page takes the mouse
  // wherever it goes, and draws itself at the width dragged to, transparent beyond it. The tab in
  // front follows as the width changes, as it does when the window is resized.
  function startResize() {
    const { width } = views().win.getContentBounds();
    drag = shownWidth(width);
    layout();
    return { width: drag, ...sidebarLimits(width) };
  }

  function resize(width) {
    if (drag === null || !Number.isFinite(width)) return;
    drag = width;
    layout();
  }

  // `width` is null when the edge was only clicked: the width stays as it was. Dragged back to
  // the configured width, the side bar follows the setting again. Resolves the width it now shows
  // at.
  function endResize(width) {
    const { win } = views();
    if (!win) return null;
    const windowWidth = win.getContentBounds().width;
    if (drag === null) return shownWidth(windowWidth);
    if (Number.isFinite(width)) {
      const fitted = fitSidebarWidth(width, windowWidth);
      sidebarWidth = fitted === fitSidebarWidth(configured(), windowWidth) ? null : fitted;
    }
    drag = null;
    layout();
    save();
    return shownWidth(windowWidth);
  }

  // A double click on the edge. Resolves the width the side bar now shows at.
  function resetWidth() {
    sidebarWidth = null;
    layout();
    save();
    return shownWidth(views().win.getContentBounds().width);
  }

  // For the development control port.
  function snapshot() {
    const { win } = views();
    return { sidebarWidth, configured: fitSidebarWidth(configured(), win.getContentBounds().width), dragging: drag !== null };
  }

  return { restore, save, layout, startResize, resize, endResize, resetWidth, snapshot };
}

module.exports = { DEFAULT_WINDOW_SIZE, createWindowLayout, restoredWindowState };
