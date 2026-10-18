const assert = require('node:assert/strict');
const test = require('node:test');
const { VISIBLE_CHAT_FRAMES_SCRIPT } = require('../src/conversations/seen-conversations');
const { chatAgent, codexChatFrames, isClaudeChatFrame, isCodexChatFrame, shownConversations, visibleCodexFrames } = require('../src/conversations/chat-frames');

const host = (extensionId, n = 1) => ({ url: `http://127.0.0.1:1/stable/x/static/out/vs/workbench/contrib/webview/browser/pre/index.html?id=${n}&extensionId=${extensionId}` });
const chat = (parent, conversation) => ({
  parent,
  url: 'http://127.0.0.1:1/stable/x/static/out/vs/workbench/contrib/webview/browser/pre/fake.html',
  executeJavaScript: async () => conversation,
});

function page(frames, visible) {
  let asked = 0;
  return {
    mainFrame: { framesInSubtree: frames },
    executeJavaScript: async (script) => {
      assert.equal(script, VISIBLE_CHAT_FRAMES_SCRIPT);
      return typeof visible === 'function' ? visible(asked++) : visible;
    },
  };
}

test('a chat frame is known by the extension its host frame names', () => {
  const claude = chat(host('Anthropic.claude-code'));
  const codex = chat(host('openai.chatgpt'));
  assert.equal(isClaudeChatFrame(claude), true);
  assert.equal(isCodexChatFrame(codex), true);
  assert.equal(chatAgent(claude), 'claude');
  assert.equal(chatAgent(codex), 'codex');
  assert.equal(chatAgent(chat(host('other.extension'))), null);
  // The host frame itself, a frame outside webviews, and a host whose URL cannot be read.
  assert.equal(chatAgent({ ...host('openai.chatgpt'), parent: null }), null);
  assert.equal(chatAgent({ url: 'http://127.0.0.1:1/', parent: host('openai.chatgpt') }), null);
  assert.equal(chatAgent(chat({ url: 'not a url /contrib/webview/browser/pre/' })), null);
});

test('only the Codex chats in view are found', async () => {
  const shownHost = host('openai.chatgpt', 1);
  const hiddenHost = host('openai.chatgpt', 2);
  const shown = chat(shownHost);
  const hidden = chat(hiddenHost);
  const claude = chat(host('anthropic.claude-code', 3));
  const contents = page([shownHost, shown, hiddenHost, hidden, claude], [shownHost.url, claude.parent.url]);
  assert.deepEqual(await visibleCodexFrames(contents), [shown]);
  assert.deepEqual(codexChatFrames(contents), [shown, hidden]);
});

test('the conversations shown leave out a chat that left the view while it was asked', async () => {
  const claudeHost = host('anthropic.claude-code', 1);
  const codexHost = host('openai.chatgpt', 2);
  const claude = chat(claudeHost, { agent: 'claude', id: 'a' });
  const codex = chat(codexHost, { agent: 'codex', id: 'b' });
  const both = [claudeHost.url, codexHost.url];
  assert.deepEqual(await shownConversations(page([claude, codex], both)), [{ agent: 'claude', id: 'a' }, { agent: 'codex', id: 'b' }]);
  const left = page([claude, codex], (asked) => (asked === 0 ? both : [codexHost.url]));
  assert.deepEqual(await shownConversations(left), [{ agent: 'codex', id: 'b' }]);
  // A chat that cannot be asked shows no conversation.
  const failing = { ...claude, executeJavaScript: async () => { throw new Error('gone'); } };
  assert.deepEqual(await shownConversations(page([failing], both)), [null]);
});
