const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createSettingsActions } = require('../src/window/settings-actions');

function setup(overrides = {}) {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  const config = { agents: ['claude'], defaultAgent: 'claude', branchAgent: 'default', codexApprovalMode: 'ask',
    repos: [], resolvedExtensions: ['a.b'], resolvedExtensionsDir: '/ext', file: '/cfg/config.json' };
  const frame = { executeJavaScript: async (script) => calls.push(['frame', script]) };
  const codexHost = { url: 'http://h/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt' };
  const codexFrame = { ...frame, url: 'http://h/contrib/webview/browser/pre/fake.html', parent: codexHost };
  const tab = { view: { webContents: { mainFrame: { framesInSubtree: [codexHost, codexFrame] } } } };
  const local = { ensureExtensions: async (specs) => calls.push(['ensure', specs]) };
  const wsl = { name: 'Ubuntu' };
  const actions = createSettingsActions({
    config, saveConfig: (c, keys) => calls.push(['save', keys]), tabs: new Map([['t1', tab]]),
    servers: () => local, wslServers: new Map([['ubuntu', wsl]]), managedSettings: () => ({ managed: true }),
    extensionSpecs: () => ['spec'], helperExtensions: () => ['helper.vsix'],
    extensionListForAgents: (agents) => agents.map((agent) => `${agent}.ext`),
    refreshResolvedExtensions: record('refreshResolved'), usagePolling: { refresh: record('usage') },
    pushState: record('push'), messageBox: record('messageBox'),
    showOpenDialog: async () => ({ canceled: false, filePaths: [path.resolve('picked')] }),
    openPath: async (target) => { calls.push(['openPath', target]); return ''; },
    repositories: { add: record('addRepo') }, refreshRepos: record('refreshRepos'),
    repoRoot: async (folder) => folder,
    rememberCandidate: (item) => ({ key: 'k', id: item.id }), readVsix: (file) => ({ id: path.basename(file) }),
    localExtensions: () => [{ id: 'x.y' }],
    exists: () => false, schedule: () => {}, platform: 'win32', env: {},
    ...overrides,
  });
  return { actions, calls, config, local, wsl };
}

test('saving settings takes the agents, tells open Codex chats, and updates the servers', async () => {
  const { actions, calls, config, local, wsl } = setup();
  assert.deepEqual(await actions.saveSettings({ agents: ['claude', 'codex'], defaultAgent: 'codex', codexApprovalMode: 'auto' }), { ok: true });
  assert.deepEqual(config.agents, ['claude', 'codex']);
  assert.equal(config.defaultAgent, 'codex');
  assert.deepEqual(config.extensions, ['claude.ext', 'codex.ext']);
  assert.deepEqual(calls.find((call) => call[0] === 'save'), ['save', ['agents', 'defaultAgent', 'branchAgent', 'codexApprovalMode']]);
  const told = calls.filter((call) => call[0] === 'frame');
  assert.equal(told.length, 1);
  assert.match(told[0][1], new RegExp(`setPreference\\(${JSON.stringify(config.codexApprovalMode)}\\)`));
  assert.deepEqual(local.managedSettings, { managed: true });
  assert.deepEqual(wsl.extensions, ['a.b', 'helper.vsix']);
  assert.deepEqual(calls.filter((call) => call[0] === 'usage').map((call) => call[1]), ['claude', 'codex']);
});

test('a repository is added once, and a folder outside git is refused', async () => {
  const { actions, calls, config } = setup();
  await actions.addRepository();
  await actions.addRepository();
  assert.deepEqual(config.repos, [path.resolve('picked')]);
  assert.equal(calls.filter((call) => call[0] === 'save').length, 1);
  assert.equal(calls.filter((call) => call[0] === 'addRepo').length, 2);
  const outside = setup({ repoRoot: async () => null });
  await outside.actions.addRepository();
  assert.equal(outside.calls[0][0], 'messageBox');
  assert.deepEqual(outside.config.repos, []);
});

test('the settings file is written before it is opened when it is not there', () => {
  const { actions, calls } = setup();
  actions.openConfigFile();
  assert.deepEqual(calls, [['save', undefined], ['openPath', '/cfg/config.json']]);
});

test('extensions picked from VSIX files or a folder become candidates', async () => {
  const { actions } = setup();
  assert.deepEqual(await actions.browseExtensionSource('vsix'), { candidates: [{ key: 'k', id: 'picked' }] });
  assert.deepEqual(await actions.browseExtensionSource('folder'), { candidates: [{ key: 'k', id: 'x.y' }] });
  const canceled = setup({ showOpenDialog: async () => ({ canceled: true, filePaths: [] }) });
  assert.deepEqual(await canceled.actions.browseExtensionSource('vsix'), { candidates: [] });
  assert.deepEqual(await canceled.actions.openDesktopCode(), { canceled: true });
});
