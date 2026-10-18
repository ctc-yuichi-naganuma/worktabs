// The colors of the VS Code theme in the tab in front (theme.js), which the window, the side bar,
// the dialogs and the placeholder pages take. The last one is kept in theme.json for the next
// start. The window and its views are injected, so fakes test it.
const fs = require('fs');
const { THEME_SCRIPT, savedTheme, sidebarTheme, windowBackground } = require('./theme');

// `views()`: { win, dialogView }, once the window is made. `tabs`: the open tabs by id;
// `activeId()`: the tab in front. `changed()`: the side bar is to be sent the new colors.
function createThemeState({ file, views, tabs, activeId, changed }) {
  // null until a tab's theme has been read, when the pages are light or dark as the system is.
  let theme = load();

  function load() {
    try {
      return savedTheme(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      return null;
    }
  }

  function set(next) {
    if (JSON.stringify(next) === JSON.stringify(theme)) return;
    theme = next;
    const { win, dialogView } = views();
    const background = windowBackground(theme);
    if (background && win) win.setBackgroundColor(background);
    if (dialogView && !dialogView.webContents.isDestroyed()) dialogView.webContents.send('dialog:theme', theme);
    fs.writeFileSync(file, `${JSON.stringify(theme, null, 2)}\n`);
  }

  // Reads the colors of the VS Code theme in a tab: once its VS Code is up (its helper extension
  // has said where it listens) and whenever its theme changes (the helper tells that too), in
  // front or not, so switching to it shows its theme at once.
  async function read(tab) {
    if (tab.server !== 'running') return;
    const result = await tab.view.webContents.executeJavaScript(THEME_SCRIPT).catch(() => null);
    const colors = sidebarTheme(result);
    if (!colors || tabs.get(tab.id) !== tab) return;
    tab.theme = colors;
    if (tab.id === activeId()) {
      set(colors);
      changed();
    }
  }

  return { current: () => theme, set, read };
}

module.exports = { createThemeState };
