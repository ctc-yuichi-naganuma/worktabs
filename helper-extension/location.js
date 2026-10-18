// Where the Claude Code extension opens a conversation. Apart from extension.js, which needs VS
// Code, so that the tests can load it.

// How to have claudeCode.preferredLocation read 'sidebar' for a moment, from what
// WorkspaceConfiguration.inspect says of it. The extension takes anything else for 'panel'.
// { write: false } when it reads 'sidebar' already; { write: true, restore } to set it in the
// user settings and put `restore` back there after (undefined takes it out again); null when
// the workspace's settings decide it: those are the repository's own (.vscode/settings.json),
// which are left alone.
function sidebarLocation({ defaultValue, globalValue, workspaceValue } = {}) {
  if ((workspaceValue ?? globalValue ?? defaultValue) === 'sidebar') return { write: false };
  if (workspaceValue !== undefined) return null;
  return { write: true, restore: globalValue };
}

module.exports = { sidebarLocation };
