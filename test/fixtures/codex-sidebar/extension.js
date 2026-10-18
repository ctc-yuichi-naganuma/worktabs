// An offline stand-in for the official extension's sidebar command and local-thread URI handler.
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

function activate(context) {
  let view;
  const state = { scheme: vscode.env.uriScheme, pid: process.pid, serial: 0 };
  const save = () => fs.writeFileSync(path.join(__dirname, 'navigation.json'), JSON.stringify(state));
  const render = () => {
    if (view) view.webview.html = `<!doctype html><html><body data-generation="${state.serial}"><main>${state.route || '/'}</main>
      <button data-composer-navigation-target="permissions">Permissions</button>
      <div contenteditable="true" role="textbox"></div><script>
      const api = acquireVsCodeApi();
      const picker = document.querySelector('button');
      const root = { memoizedProps: { conversationId: ${JSON.stringify(state.threadId || null)}, hostId: 'local' }, child: { stateNode: picker } };
      root.stateNode = { current: root }; picker.__reactFiber$fixture = { return: root };
      document.querySelector('[contenteditable]').addEventListener('input', (event) => api.postMessage({ draft: event.target.innerText }));
      </script></body></html>`;
  };
  const focus = async () => {
    await vscode.commands.executeCommand('workbench.view.extension.codexSecondaryViewContainer');
    await vscode.commands.executeCommand('chatgpt.sidebarSecondaryView.focus');
  };
  save();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('chatgpt.sidebarSecondaryView', {
      resolveWebviewView(value) {
        view = value;
        view.webview.options = { enableScripts: true };
        context.subscriptions.push(view.webview.onDidReceiveMessage((message) => {
          state.draft = message.draft; save();
        }));
        render();
      },
    }),
    vscode.commands.registerCommand('chatgpt.openSidebar', focus),
    vscode.commands.registerCommand('chatgpt.newChat', async () => {
      state.route = '/'; state.threadId = null; state.draft = ''; state.serial++; save(); await focus(); render();
    }),
    vscode.window.registerUriHandler({
      async handleUri(uri) {
        state.route = uri.path;
        state.threadId = uri.path.endsWith('/unavailable') ? null : uri.path.split('/').at(-1);
        state.uri = uri.toString();
        state.serial++;
        save();
        await focus();
        render();
      },
    }),
  );
}

module.exports = { activate };
