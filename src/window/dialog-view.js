// The app's dialogs on the page laid over the whole window (src/dialog/), one at a time, and the
// focus given back when they go. The window, its views and the focused contents are injected, so
// fakes test it.
const { DialogQueue, canceled, dialogOptions } = require('./message-box');

// `views()`: { win, sidebar, dialogView }, once the window is made (win is null once it has
// gone). `focused()`: the web contents with the keyboard focus. `activeTab()`: the tab in front.
// `theme()`: the colors the dialogs take. `refreshSeen()`: a dialog covers the conversations in
// view (seen-conversations.js).
function createDialogView({ views, focused, activeTab, theme, refreshSeen }) {
  // Where the focus was when the dialogs came up, to go back to.
  let focusBefore = null;
  const dialogs = new DialogQueue({ show, hide });

  // Asks as dialog.showMessageBox(win, options) does, and resolves the same: { response,
  // checkboxChecked }. Once the window has gone, there is no one to ask: canceled.
  function messageBox(options) {
    if (!views().win) return Promise.resolve(canceled(dialogOptions(options)));
    return dialogs.open(options);
  }

  function show(dialog) {
    const { win, dialogView } = views();
    if (!dialogView.getVisible()) {
      const contents = focused();
      focusBefore = contents === dialogView.webContents ? null : contents;
      dialogView.setVisible(true);
    }
    dialogView.webContents.send('dialog:show', dialog, theme());
    dialogView.webContents.focus();
    refreshSeen();
    if (!win.isFocused()) win.flashFrame(true);
  }

  // The focus goes back to the side bar if it had it, else to the tab in front: the one that had
  // it, or another that came to the front meanwhile (a hidden one must not take the focus).
  function hide() {
    const { win, sidebar, dialogView } = views();
    if (!win) return;
    dialogView.setVisible(false);
    const tab = activeTab();
    const back = focusBefore === sidebar.webContents || !tab ? sidebar.webContents : tab.view.webContents;
    focusBefore = null;
    back.focus();
    refreshSeen();
  }

  // A dialog that opened a tab hands the focus to it as it closes, not back to where it was.
  function forgetFocus() {
    focusBefore = null;
  }

  // The text of the dialog in front, as Ctrl+C copies it; null without one.
  function currentText() {
    const current = dialogs.current;
    return current ? [current.message, current.detail].filter(Boolean).join('\n\n') : null;
  }

  // Whether `sender` is the dialog page while it shows the settings dialog.
  function fromSettingsDialog(sender) {
    return sender === views().dialogView?.webContents && dialogs.current?.kind === 'settings';
  }

  return { dialogs, messageBox, forgetFocus, currentText, fromSettingsDialog };
}

module.exports = { createDialogView };
