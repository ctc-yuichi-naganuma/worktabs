// The handlers of the development control port (control.js; scripts/dev-*-check.js drive them):
// handler name -> async ({ ...arguments }) => result. The app's operations and its views come in
// from main.js, so the table and its checks of the arguments do not need Electron.
const path = require('path');
const { stringList, stringOrNull } = require('./ipc-routes');

function createControlHandlers({
  tabs, views, focusedContents, viewState, sessionsSnapshot, sessions, language,
  openTab, activateTab, closeTab, closeTabsTogether, suspendTab, stopRisks, checkForUpdates,
  revealSession, archiveSession, windowState, setWindowBounds, layout,
  addWorktreeTab, addWorktreeDialog, checkedTask, uncloned, ownedRepo, openCloneDialog, startClone,
  startFirstConversation, firstPrompt, describeTask, suggestBranch, removalCheck, removeWorktreeNow,
  messageBox, callHelper, quit, closeWindow, screenshotDir, writeFile, webviewFrame,
}) {
  // The page `id` names: 'sidebar', 'dialog', or a tab's id.
  const contentsOf = (id) => {
    const contents = views()[id] || tabs.get(id)?.view.webContents;
    if (!contents) throw new Error(`no tab ${id}`);
    return contents;
  };
  const accountRepo = (url) => {
    const repo = ownedRepo(url);
    if (!repo) throw new Error(`not a repository of the account: ${url}`);
    return repo;
  };

  return {
    state: () => ({ ...viewState(), sessions: sessionsSnapshot() }),
    // The UI language, so that a check can expect the text in it.
    language: () => language(),
    open: ({ folder, activate = true }) => openTab(folder, { activate }),
    activate: ({ id }) => activateTab(id),
    close: ({ id, force = true }) => closeTab(id, { force }),
    // As the button on a repository's row does: asks first when one of them would lose something.
    closeTogether: ({ ids, repo = null }) => closeTabsTogether(stringList(ids), stringOrNull(repo)),
    suspend: ({ id }) => suspendTab(tabs.get(id), { force: true }),
    risks: ({ id }) => stopRisks(tabs.get(id)),
    checkUpdates: () => checkForUpdates(),
    // Feeds a Claude Code hook event to a tab, as if its session had sent it (from the
    // claude-wrap.exe with process id `proc`, if given).
    hook: ({ id, input, proc = null }) => sessions.handle(id, input, proc),
    codex: ({ id, input, proc = 'wsl:check:100' }) => sessions.handleCodex(id, input, proc),
    reveal: ({ id, session: sessionId }) => revealSession(id, sessionId),
    archive: ({ id, session: sessionId }) => archiveSession(id, sessionId),
    window: () => windowState(),
    setWindowBounds: ({ bounds }) => setWindowBounds(bounds),
    // Where the side bar and the tabs (and the page shown without one) are, the width the side
    // bar's edge was dragged to (null: the configured one), and the configured one.
    layout: () => layout(),
    // With a task as describeTask gives it ({ kind: 'issue', number, title }, { kind: 'pull',
    // number, title, head, cross, state } or { kind: 'text', text }), if any.
    addWorktree: ({ repo, name, task = null }) => addWorktreeTab(repo, name, checkedTask(task)),
    // Brings up the dialog that adds a worktree (its page is 'dialog' for eval and key).
    addWorktreeDialog: ({ repo }) => addWorktreeDialog(repo),
    // The repositories of the accounts not cloned, as the side bar gets them, and where one can be
    // cloned.
    uncloned: () => uncloned(),
    // Brings up the dialog that asks where to clone a repository of the account (its address on
    // GitHub) into the distribution `distro`, or here. `clone` clones it as its row's button does
    // there: with ghq if it is installed, else through that dialog.
    cloneDialog: ({ url, distro = null }) => {
      openCloneDialog(accountRepo(url), distro);
    },
    clone: ({ url, distro = null }) => startClone(accountRepo(url), { label: '', distro }),
    firstConversation: ({ id, task }) => startFirstConversation(tabs.get(id), firstPrompt(task)),
    describeTask: ({ repo, text }) => describeTask(repo, text),
    suggestBranch: ({ repo, task }) => suggestBranch(repo, checkedTask(task)),
    // What the confirmation would say, and the removal itself without asking.
    removalCheck: async ({ folder, repo = null }) => {
      const { target, blockers, unshared, ignored } = await removalCheck(folder, repo);
      return { removable: Boolean(target), branch: target?.branch ?? null, missing: Boolean(target?.missing), blockers, unshared, ignored };
    },
    removeWorktree: async ({ folder, repo = null, deleteBranch: withBranch = false }) => {
      const { target } = await removalCheck(folder, repo);
      if (!target) throw new Error(`not a removable worktree: ${folder}`);
      return removeWorktreeNow(target.repo, folder, { branch: withBranch ? target.branch : null, quiet: true });
    },
    // Shows a dialog (the options of dialog.showMessageBox) and resolves its answer.
    dialog: (options) => messageBox(options),
    // Which view has the focus: 'sidebar', 'dialog', a tab's id, or null.
    focused: () => {
      const focused = focusedContents();
      const view = Object.entries(views()).find(([, contents]) => contents === focused);
      return view ? view[0] : ([...tabs.values()].find((tab) => tab.view.webContents === focused)?.id ?? null);
    },
    // Types into the focused element as if committed by an IME (works with the editor's
    // EditContext input, which execCommand does not reach).
    insertText: ({ id, text }) => {
      const contents = contentsOf(id);
      contents.focus();
      return contents.insertText(text);
    },
    // Presses a key as the keyboard would, which VS Code's keybindings take (unlike a script's
    // events): keyCode as Electron names keys ('`', 'F1', 'Enter'), modifiers such as
    // ['control', 'shift'].
    key: ({ id, keyCode, modifiers = [] }) => {
      const contents = contentsOf(id);
      contents.focus();
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    },
    // Moves or presses the mouse on a page as the mouse would: `event` as Electron's
    // sendInputEvent takes it ({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }; a move
    // with the button held has modifiers ['leftButtonDown']).
    mouse: ({ id, event }) => {
      contentsOf(id).sendInputEvent(event);
    },
    quit: () => quit(),
    // As the window's close button does: the app may ask first.
    closeWindow: () => {
      closeWindow();
    },
    // Runs `js` in the page, or with another `target` in each of its VS Code webviews (`webviewFrame`
    // in their address: the agents' chat panels).
    eval: ({ id, js, target = 'main' }) => {
      const contents = contentsOf(id);
      if (target === 'main') return contents.executeJavaScript(js, true);
      const frames = contents.mainFrame.framesInSubtree.filter((f) => f.url.includes(webviewFrame));
      return Promise.all(frames.map((f) => f.executeJavaScript(js, true).catch((e) => `<error: ${e.message}>`)));
    },
    // Calls a route of the helper extension in the tab's VS Code (/reveal, /new-conversation,
    // /show-chat).
    helper: ({ id, route, body = {}, result = false }) => callHelper(id, route, body, { result }),
    shot: async ({ id }) => {
      const file = path.join(screenshotDir(), `shot-${id}-${Date.now()}.png`);
      writeFile(file, (await contentsOf(id).capturePage()).toPNG());
      return file;
    },
  };
}

module.exports = { createControlHandlers };
