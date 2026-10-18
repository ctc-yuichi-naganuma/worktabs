const assert = require('node:assert/strict');
const test = require('node:test');
const { codexActive, revealCodexThread, newCodexConversation } = require('../helper-extension/codex');

function fixture({ missing = false, fail = null, scheme = 'code-oss' } = {}) {
  const calls = [];
  const api = {
    env: { uriScheme: scheme },
    Uri: { from: (value) => value },
    extensions: { getExtension: (id) => {
      assert.equal(id, 'openai.chatgpt');
      return missing ? null : { activate: async () => { calls.push(['activate']); } };
    } },
    commands: { executeCommand: async (...args) => {
      calls.push(args);
      if (args[0] === fail) throw new Error('Unavailable command');
    } },
  };
  return { api, calls };
}

test('a new Codex chat is acknowledged only when its own command succeeds', async () => {
  const good = fixture();
  assert.deepEqual(await newCodexConversation(good.api), { opened: true });
  assert.deepEqual(good.calls, [['activate'], ['chatgpt.newChat']]);
  const missing = fixture({ missing: true });
  assert.deepEqual(await newCodexConversation(missing.api), { opened: false, reason: 'missing-extension' });
  const failed = fixture({ fail: 'chatgpt.newChat' });
  assert.deepEqual(await newCodexConversation(failed.api), { opened: false, reason: 'open-failed' });
  assert.deepEqual(failed.calls.at(-1), ['chatgpt.openSidebar']);
});

test('Codex row clicks route different threads into the sidebar, never an editor', async () => {
  const { api, calls } = fixture();
  for (const id of ['thread-one', 'thread-two']) assert.deepEqual(await revealCodexThread(api, id), { opened: true });
  assert.deepEqual(calls, ['thread-one', 'thread-two'].flatMap((id) => [
    ['activate'], ['chatgpt.openSidebar'],
    ['_workbench.open', { scheme: 'code-oss', authority: 'openai.chatgpt', path: `/local/${id}` }],
  ]));
});

test('Codex deep links use the current workbench scheme on every platform', async () => {
  for (const scheme of ['vscode', 'vscode-insiders', 'code-oss']) {
    const { api, calls } = fixture({ scheme });
    await revealCodexThread(api, 'thr_123');
    assert.equal(calls.at(-1)[1].scheme, scheme);
  }
});

test('Unavailable extension, invalid thread, and rejected route give explicit fallbacks', async () => {
  const missing = fixture({ missing: true });
  assert.deepEqual(await revealCodexThread(missing.api, 'thread'), { opened: false, reason: 'missing-extension' });
  assert.deepEqual(missing.calls, []);
  for (const id of [null, '', '../other', 'thread?query', 'thread/path', 'thread#fragment', 'x'.repeat(201)]) {
    const { api, calls } = fixture();
    assert.deepEqual(await revealCodexThread(api, id), { opened: false, reason: 'invalid-thread' });
    assert.deepEqual(calls, [['activate'], ['chatgpt.openSidebar']]);
  }
  const rejected = fixture({ fail: '_workbench.open' });
  assert.deepEqual(await revealCodexThread(rejected.api, 'thread'), { opened: false, reason: 'open-failed' });
  assert.deepEqual(rejected.calls.at(-1), ['chatgpt.openSidebar']);
});

test('A sidebar failure never opens a new conversation or an editor as a fallback', async () => {
  const { api, calls } = fixture({ fail: 'chatgpt.openSidebar' });
  assert.deepEqual(await revealCodexThread(api, 'thread'), { opened: false, reason: 'open-failed' });
  assert.ok(!calls.some(([command]) => ['vscode.openWith', 'chatgpt.newChat', 'chatgpt.newCodexPanel'].includes(command)));
});

test('The helper says whether Codex has started in the window', () => {
  const api = (extension) => ({ extensions: { getExtension: (id) => (id === 'openai.chatgpt' ? extension : undefined) } });
  assert.deepEqual(codexActive(api({ isActive: true })), { active: true });
  assert.deepEqual(codexActive(api({ isActive: false })), { active: false });
  assert.deepEqual(codexActive(api(undefined)), { active: false });
});
