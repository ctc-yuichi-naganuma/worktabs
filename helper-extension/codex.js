// Route through the extension's URI handler, which navigates its sidebar rather than
// opening a conversation editor. Keep the command boundary testable without VS Code.
async function revealCodexThread(api, threadId) {
  const extension = api.extensions.getExtension('openai.chatgpt');
  if (!extension) return { opened: false, reason: 'missing-extension' };
  try {
    await extension.activate();
    await api.commands.executeCommand('chatgpt.openSidebar');
    if (typeof threadId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(threadId)) {
      return { opened: false, reason: 'invalid-thread' };
    }
    const uri = api.Uri.from({ scheme: api.env.uriScheme, authority: 'openai.chatgpt', path: `/local/${threadId}` });
    // vscode.open's compatibility command does not await the opener in some VS Code builds.
    await api.commands.executeCommand('_workbench.open', uri);
    return { opened: true };
  } catch {
    await api.commands.executeCommand('chatgpt.openSidebar').catch(() => {});
    return { opened: false, reason: 'open-failed' };
  }
}

// Whether the Codex extension has started in this window. Before an update, a tab whose Codex
// started but whose proxy never reported in may be working where Worktabs cannot see it.
function codexActive(api) {
  return { active: Boolean(api.extensions.getExtension('openai.chatgpt')?.isActive) };
}

async function newCodexConversation(api) {
  const extension = api.extensions.getExtension('openai.chatgpt');
  if (!extension) return { opened: false, reason: 'missing-extension' };
  try {
    await extension.activate();
    await api.commands.executeCommand('chatgpt.newChat');
    return { opened: true };
  } catch {
    await api.commands.executeCommand('chatgpt.openSidebar').catch(() => {});
    return { opened: false, reason: 'open-failed' };
  }
}

module.exports = { codexActive, revealCodexThread, newCodexConversation };
