const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { pickPort } = require('../src/code-server/code-server');
const { CodexObserver } = require('../src/codex/codex-events');

const root = path.resolve(__dirname, '..');
const codeServerDir = process.env.WORKTABS_TEST_CODE_SERVER_DIR;
const helperVersion = require('../helper-extension/package.json').version;
const helper = path.join(root, 'native', `worktabs.worktabs-helper-${helperVersion}.vsix`);
const electron = process.platform === 'darwin'
  ? path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const skip = !codeServerDir || !fs.existsSync(electron) || !fs.existsSync(helper)
  ? 'needs a local Electron install, built helper, and WORKTABS_TEST_CODE_SERVER_DIR' : false;

test('Codex row navigation stays in the sidebar across restart and suspension', { skip, timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktabs-codex-nav-'));
  const extensionsDir = path.join(dir, 'extensions');
  const extension = path.join(extensionsDir, 'openai.chatgpt-1.0.0');
  const folder = path.join(dir, 'folder');
  const data = path.join(dir, 'data');
  const configFile = path.join(dir, 'config.json');
  const controlPort = await pickPort();
  const controlToken = crypto.randomBytes(24).toString('hex');
  let app;
  const call = async (action, body = {}) => {
    const response = await fetch(`http://127.0.0.1:${controlPort}/${action}`, {
      method: 'POST', headers: { 'x-worktabs-control-token': controlToken }, body: JSON.stringify(body), signal: AbortSignal.timeout(action === 'reveal' ? 25000 : 10000),
    });
    const answer = await response.json();
    if (!answer.ok) throw new Error(answer.error);
    return answer.result;
  };
  const until = async (what, read) => {
    const deadline = Date.now() + 30000;
    do {
      try { const value = await read(); if (value) return value; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${what}`);
  };
  const launch = () => {
    const env = { ...process.env, WORKTABS_DATA_DIR: data, WORKTABS_CONFIG: configFile, WORKTABS_HIDDEN: '1',
      WORKTABS_CONTROL_PORT: String(controlPort), WORKTABS_CONTROL_TOKEN: controlToken,
      CODEX_HOME: path.join(dir, 'codex'), CLAUDE_CONFIG_DIR: path.join(dir, 'claude') };
    delete env.ELECTRON_RUN_AS_NODE;
    for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[name];
    app = spawn(electron, ['.'], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  };
  const stop = async () => {
    if (!app || app.exitCode !== null || app.signalCode !== null) return;
    const exiting = new Promise((resolve) => app.once('exit', resolve));
    await call('quit').catch(() => app.kill());
    let timer;
    await Promise.race([exiting, new Promise((resolve) => { timer = setTimeout(resolve, 8000); })]);
    clearTimeout(timer);
    if (app.exitCode === null && app.signalCode === null) { app.kill('SIGKILL'); await exiting; }
  };
  t.after(async () => {
    try {
      // A failed assertion can leave a live turn; never let its quit dialog hold cleanup.
      if (app?.exitCode === null && app?.signalCode === null) {
        try { for (const tab of (await call('state')).tabs) await call('close', { id: tab.id, force: true }); } catch {}
      }
      await stop();
    } finally {
      // Removing data still locked by a running app would also hide the useful failure logs.
      if (!app || app.exitCode !== null || app.signalCode !== null) fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  fs.mkdirSync(folder, { recursive: true });
  fs.cpSync(path.join(__dirname, 'fixtures/codex-sidebar'), extension, { recursive: true });
  const location = pathToFileURL(extension);
  fs.writeFileSync(path.join(extensionsDir, 'extensions.json'), JSON.stringify([{ identifier: { id: 'openai.chatgpt' },
    version: '1.0.0', relativeLocation: path.basename(extension), metadata: { source: 'vsix' },
    location: { $mid: 1, scheme: 'file', path: decodeURIComponent(location.pathname) } }]));
  fs.writeFileSync(configFile, JSON.stringify({ repos: [], repoSources: [], unclonedRepos: false,
    codeServerDir, extensionsDir, agents: ['codex'], defaultAgent: 'codex', branchAgent: 'codex',
    locale: 'en', updateCheck: false, idleSuspendMinutes: 0 }));
  const navigation = () => JSON.parse(fs.readFileSync(path.join(extension, 'navigation.json'), 'utf8'));
  const click = async (id, threadId) => {
    const before = navigation();
    await call('reveal', { id, session: `codex:${id}:${threadId}` });
    await until(`sidebar thread ${threadId}`, () => {
      const current = navigation();
      return current.uri === `${current.scheme}://openai.chatgpt/local/${threadId}`
        && (current.pid !== before.pid || current.serial > before.serial);
    });
    const editors = await call('eval', { id, js: "document.querySelectorAll('.tabs-container .tab').length" });
    assert.equal(editors, 0, 'Navigation must not create an editor tab');
  };
  launch();
  await until('control port', () => call('state'));
  const id = await call('open', { folder });
  await until('helper registration', () => call('helper', { id, route: '/settings' }));
  for (const task of [{ kind: 'issue', number: 20, title: 'Make worktrees' },
    { kind: 'pull', number: 71, title: 'Review changes' }, { kind: 'text', text: '日本語 task' }]) {
    const prompt = require('../src/repos/task').firstPrompt(task);
    await call('firstConversation', { id, task });
    await until('editable task draft', () => navigation().draft === prompt);
    assert.equal((await call('state')).tabs[0].conversations.length, 0, 'Drafts do not start a turn');
  }
  for (const threadId of ['one', 'two']) await call('codex', { id, input: { threadId, turnId: `turn-${threadId}`,
    state: 'idle', conversation: true, title: threadId, prompt: `Prompt ${threadId}`, cwd: folder } });
  assert.equal((await call('state')).tabs[0].conversations.length, 2);
  for (const threadId of ['one', 'two', 'one']) await click(id, threadId);
  let delivery = Promise.resolve();
  const observer = new CodexObserver((input) => { delivery = delivery.then(() => call('codex', { id, input })); });
  const event = (method, params) => observer.server({ method, params });
  event('thread/started', { thread: { id: 'child', parentThreadId: 'one', agentNickname: 'Locke', agentRole: 'reviewer' } });
  event('turn/started', { threadId: 'child', turn: { id: 'child-turn' } });
  await delivery;
  await click(id, 'child');
  event('turn/started', { threadId: 'one', turn: { id: 'parent-turn' } });
  const item = { id: 'wait', type: 'collabAgentToolCall', tool: 'wait', senderThreadId: 'one',
    receiverThreadIds: ['child'], status: 'inProgress', agentsStates: {} };
  event('item/started', { threadId: 'one', item });
  // The parent's target status must recover a child whose own completion never arrived.
  event('item/completed', { threadId: 'one', item: { ...item, status: 'completed', agentsStates: { child: { status: 'completed' } } } });
  event('thread/status/changed', { threadId: 'child', status: { type: 'active', activeFlags: [] } });
  event('turn/completed', { threadId: 'one', turn: { id: 'parent-turn', status: 'interrupted' } });
  await delivery;
  const completed = (await call('state')).tabs[0].conversations.find((c) => c.threadId === 'child');
  assert.equal(completed.state, 'done');
  assert.equal(completed.unread, false);
  assert.equal((await call('state')).counts.working, 0);
  const row = await until('subagent row', () => call('eval', { id: 'sidebar', js: `(() => {
    const row = [...document.querySelectorAll('.row.conversation')].find((row) => row.querySelector('.name').textContent === 'Locke');
    return row?.querySelector('.dot').className === 'dot idle'
      && { tag: row.querySelector('.tag')?.textContent, badge: row.querySelector('.dot').className };
  })()` }));
  assert.deepEqual(row, { tag: 'Subagent', badge: 'dot idle' });
  await click(id, 'child');
  await call('archive', { id, session: `codex:${id}:child` });
  await call('archive', { id, session: `codex:${id}:two` });
  await stop();
  const saved = JSON.parse(fs.readFileSync(path.join(data, 'tabs.json'), 'utf8'));
  assert.equal(saved.tabs[0].conversations.length, 3);
  assert.equal(saved.tabs[0].conversations[1].archived, true);
  assert.equal(saved.tabs[0].conversations[2].parentThreadId, 'one');
  assert.equal(saved.tabs[0].conversations[2].agentNickname, 'Locke');
  launch();
  const restored = await until('restored rows', async () => {
    const state = await call('state');
    return state.tabs[0]?.conversations.length === 1 ? state : null;
  });
  assert.equal(restored.tabs[0].conversations[0].threadId, 'one');
  assert.equal(restored.tabs[0].conversations[0].prompt, 'Prompt one');
  assert.equal(restored.tabs[0].conversations[0].state, 'idle');
  await click(id, 'one');
  await call('suspend', { id });
  assert.equal((await call('state')).tabs[0].conversations.length, 1);
  await click(id, 'one');
  await call('codex', { id, input: { threadId: 'one', ended: true, reason: 'archived' } });
  assert.equal((await call('state')).tabs[0].conversations.length, 0);
  // The offline fixture deliberately has no bundled CLI. Its startup setup warning
  // must not queue ahead of the navigation warning this integration check exercises.
  await call('eval', { id: 'dialog', js: "window.host.ready().then(({ dialog }) => dialog?.message === 'Codex setup needs attention' ? window.host.answer(dialog.id, 0, false) : null)" });
  await call('codex', { id, input: { threadId: 'unavailable', conversation: true, state: 'idle', title: 'Unavailable' } });
  const failedReveal = call('reveal', { id, session: `codex:${id}:unavailable` }).then(() => null, (error) => error);
  const warning = await until('unconfirmed thread warning', () => call('eval', { id: 'dialog',
    js: "window.host.ready().then(({ dialog }) => dialog?.message)" }));
  assert.equal(warning, 'The Codex conversation could not be opened.');
  assert.match(await call('eval', { id: 'dialog', js: "document.getElementById('detail').textContent" }), /Select the conversation from its history/);
  await call('eval', { id: 'dialog', js: "document.querySelector('#buttons button').click()" });
  assert.equal(await failedReveal, null);
  assert.equal((await call('state')).tabs[0].conversations[0].threadId, 'unavailable', 'A failed reveal keeps the saved row');
  await stop();
});
