// Commands that desktop VS Code has and VS Code Web lacks, and the app's way into this VS Code.
// code-server runs on this machine (on Windows, or in WSL for a folder there), so its extension
// host can start Windows programs for the person at the screen.
const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const vscode = require('vscode');
const { sidebarLocation } = require('./location');
const { applySettings } = require('./settings');
const { codexActive, revealCodexThread, newCodexConversation } = require('./codex');

function activate(context) {
  context.subscriptions.push(
    // One command under two names, as desktop VS Code names it: the menu shows the one for the
    // OS of the window (isMac), which is where the file manager opens.
    vscode.commands.registerCommand('worktabs.revealInExplorer', revealInFileManager),
    vscode.commands.registerCommand('worktabs.revealInFinder', revealInFileManager),
    // The app's side bar takes the colors of the theme; it reads them from this window's page.
    vscode.window.onDidChangeActiveColorTheme(() => postToApp('/theme', {})),
  );
  startBridge(context);
}

async function revealInFileManager(uri) {
  if (!uri || uri.scheme !== 'file') return;
  // The app opens it as a tab of an open Explorer window and can bring that window to the
  // front. Without the app, it opens in a new window.
  if (await postToApp('/explore', { path: uri.fsPath })) return;
  revealWithExplorer(uri.fsPath);
}

// Opens a new window of the file manager with the item selected.
function revealWithExplorer(fsPath) {
  if (process.platform === 'win32') {
    // explorer.exe parses its own command line, so the path is quoted by hand.
    spawn('explorer.exe', [`/select,"${fsPath}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (process.platform === 'darwin') {
    spawn('open', ['-R', fsPath], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    return;
  }
  // In WSL, explorer.exe runs through WSL's interop and takes the item's Windows path.
  let target;
  try {
    target = execFileSync('wslpath', ['-w', fsPath], { encoding: 'utf8' }).trim();
  } catch {
    return;
  }
  spawn('explorer.exe', [`/select,${target}`], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

// Posts to the app's hook endpoint, whose URL and token come with the tab id in code-server's
// environment. Resolves false without the app (a code-server started by hand), or when the
// app does not take it.
function postToApp(route, body) {
  const { WORKTABS_HOOK_URL: hookUrl, WORKTABS_HOOK_TOKEN: hookToken, WORKTABS_TAB_ID: tabId } = process.env;
  if (!hookUrl || !hookToken || !tabId) return Promise.resolve(false);
  return new Promise((resolve) => {
    const request = http.request(
      new URL(route, hookUrl),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Wrapper-Token': hookToken, 'X-Wrapper-Tab': tabId },
        timeout: 5000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      },
    );
    request.on('error', () => resolve(false));
    request.on('timeout', () => request.destroy());
    request.end(JSON.stringify(body));
  });
}

// What the app can ask of this VS Code: bring a Claude conversation to the front, start the
// first conversation of a worktree the app has just added, show the Claude chat in the side bar
// in place of VS Code's own, and set the user settings that another tab of the repository
// changed.
const ROUTES = {
  '/reveal': revealConversation,
  '/new-conversation': newConversation,
  '/show-chat': showSidebarChat,
  '/settings': setUserSettings,
  '/codex-active': () => codexActive(vscode),
};

// A loopback endpoint the app calls for ROUTES. The extension tells the app its port and a
// token of its own. What a route resolves goes back as JSON.
function startBridge(context) {
  if (!process.env.WORKTABS_HOOK_URL) return;
  const token = crypto.randomBytes(24).toString('hex');
  const server = http.createServer((req, res) => {
    const route = Object.hasOwn(ROUTES, req.url) ? ROUTES[req.url] : null;
    if (req.method !== 'POST' || !route || req.headers['x-helper-token'] !== token) {
      res.writeHead(404);
      res.end();
      return;
    }
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      let answer;
      try {
        answer = await route(JSON.parse(raw || '{}'));
        res.writeHead(200, answer === undefined ? {} : { 'Content-Type': 'application/json' });
      } catch {
        res.writeHead(500);
      }
      res.end(answer === undefined ? undefined : JSON.stringify(answer));
    });
  });
  server.listen(0, '127.0.0.1', () => postToApp('/helper', { port: server.address().port, token }));
  context.subscriptions.push({ dispose: () => server.close() });
}

// The opening under way in the chat in the side bar: one at a time, or a second one would take
// the first one's 'sidebar' for the setting to put back.
let opening = Promise.resolve();

function oneAtATime(open) {
  const done = opening.then(open);
  opening = done.catch(() => {});
  return done;
}

function agentOf(body) {
  return body?.agent === 'codex' ? 'codex' : 'claude';
}

function revealConversation(body = {}) {
  if (agentOf(body) === 'codex') return oneAtATime(() => revealCodexThread(vscode, body.sessionId));
  return oneAtATime(() => openConversation(body.sessionId));
}

// Brings a conversation to the front the way the Claude Code extension's session list opens one
// (2.1.284). One on an editor tab comes forward on its tab. Any other goes to the chat in the
// side bar, which switches to it when it holds it (behind the conversation it shows), without
// starting another claude. On a new editor tab it would take a second claude. When the
// workspace's settings decide where, the side bar is only shown.
async function openConversation(sessionId) {
  const opened = await openInSidebar(sessionId);
  if (!opened) await focusSidebarChat();
  return { opened };
}

// Has the Claude Code extension open a conversation as it does itself:
// claude-vscode.editor.open with programmatic 'honor-preferred-location', which opens it where
// claudeCode.preferredLocation says (its side bar view, or a new editor tab) and leaves that
// setting as it is. The arguments are the session, the prompt its input starts with (not sent),
// the column, the group, whether in a full editor, and how it was asked.
function openWithExtension(sessionId, prompt) {
  return vscode.commands.executeCommand('claude-vscode.editor.open', sessionId, prompt, undefined, undefined, undefined, {
    programmatic: 'honor-preferred-location',
  });
}

// openWithExtension with the setting reading 'sidebar' for the call: the extension reads it
// when called, and takes 'panel' (its default, and what it writes when one opens a conversation
// on an editor tab) for a new editor tab. Resolves false, without calling it, when the
// workspace's settings decide where.
async function openInSidebar(sessionId, prompt) {
  const config = vscode.workspace.getConfiguration('claudeCode');
  const location = sidebarLocation(config.inspect('preferredLocation'));
  if (!location) return false;
  const target = vscode.ConfigurationTarget.Global;
  if (location.write) await config.update('preferredLocation', 'sidebar', target);
  try {
    await openWithExtension(sessionId, prompt);
  } finally {
    if (location.write) await config.update('preferredLocation', location.restore, target);
  }
  return true;
}

// Sets user settings: { set: { key: value }, remove: [key] }. The app has them from another tab
// of the repository; it cannot write them to this one's settings.json itself while it runs,
// since code-server does not see a change there that it did not make. Resolves { failed }: the
// keys that could not be set, which the app writes to the file for the next start.
async function setUserSettings(changes) {
  const config = vscode.workspace.getConfiguration();
  const failed = await applySettings(changes, (key, value) => config.update(key, value, vscode.ConfigurationTarget.Global));
  return { failed };
}

// The first conversation of a new worktree: { prompt }, the text its input starts with (not
// sent), if any. Without one, the chat in the side bar. With one, a new conversation there, as
// the extension's "New conversation tab" opens one with a prompt; the extension also shows the
// chat. The chat starts a conversation of its own when it first shows, so an empty one, with
// its claude, stays behind the prompt's; the extension has no way to stop it. When the
// workspace's settings decide where conversations open, there.
async function newConversation(body = {}) {
  const { prompt } = body;
  if (agentOf(body) === 'codex') {
    return oneAtATime(() => newCodexConversation(vscode));
  }
  if (typeof prompt !== 'string' || !prompt) {
    await focusSidebarChat();
    return;
  }
  await oneAtATime(async () => {
    if (!(await openInSidebar(undefined, prompt))) await openWithExtension(undefined, prompt);
  });
}

// Shows and focuses the Claude chat in the side bar, with the view's own focus command.
// claude-vscode.sidebar.open would also change where the extension opens new conversations
// (claudeCode.preferredLocation), and so would claude-vscode.editor.open, which opens one on an
// editor tab. The view is in the primary side bar on a VS Code without a secondary one.
async function focusSidebarChat() {
  try {
    await vscode.commands.executeCommand('claudeVSCodeSidebarSecondary.focus');
  } catch {
    await vscode.commands.executeCommand('claudeVSCodeSidebar.focus');
  }
}

// Shows the Claude chat in the side bar, in place of the view there, and leaves the focus where
// it is: the view's open command, which VS Code registers for every view, with preserveFocus.
// Having it shown has the Claude Code extension build the chat, which brings back the
// conversation it held. It opens the side bar when closed, so the app asks only when the side bar
// shows VS Code's own chat.
async function showSidebarChat(body = {}) {
  if (agentOf(body) === 'codex') {
    await focusCodexChat({ preserveFocus: true });
    return;
  }
  try {
    await vscode.commands.executeCommand('claudeVSCodeSidebarSecondary.open', { preserveFocus: true });
  } catch {
    await vscode.commands.executeCommand('claudeVSCodeSidebar.open', { preserveFocus: true });
  }
}

async function focusCodexChat(options = {}) {
  try {
    await vscode.commands.executeCommand('chatgpt.openSidebar', options);
  } catch {
    await vscode.commands.executeCommand('chatgpt.newChat');
  }
}

module.exports = { activate };
