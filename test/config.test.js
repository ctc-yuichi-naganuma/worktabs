const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadConfig, saveConfig } = require('../src/config');
const { tempDir } = require('./support');

function configFrom(t, user = {}) {
  const appDir = tempDir(t);
  const userDataDir = path.join(appDir, 'user');
  const previous = process.env.WORKTABS_CONFIG;
  delete process.env.WORKTABS_CONFIG;
  t.after(() => {
    if (previous === undefined) delete process.env.WORKTABS_CONFIG;
    else process.env.WORKTABS_CONFIG = previous;
  });
  if (Object.keys(user).length) fs.writeFileSync(path.join(appDir, 'config.local.json'), `${JSON.stringify(user)}\n`);
  return loadConfig(appDir, userDataDir, false);
}

test('config defaults to Claude Code as the only agent', (t) => {
  const config = configFrom(t);
  assert.deepEqual(config.agents, ['claude']);
  assert.equal(config.defaultAgent, 'claude');
  assert.equal(config.branchAgent, 'claude');
  assert.deepEqual(config.extensions, ['Anthropic.claude-code']);
});

test('config normalizes Codex-only agent settings and installs only its extension', (t) => {
  const config = configFrom(t, {
    agents: ['codex'],
    defaultAgent: 'claude',
    branchAgent: 'default',
    extensions: ['Anthropic.claude-code', 'publisher.extra'],
  });
  assert.deepEqual(config.agents, ['codex']);
  assert.equal(config.defaultAgent, 'codex');
  assert.equal(config.branchAgent, 'default');
  assert.deepEqual(config.extensions, ['OpenAI.chatgpt', 'publisher.extra']);
});

test('config can enable both agents and keep branch generation on one of them', (t) => {
  const config = configFrom(t, { agents: ['claude', 'codex'], defaultAgent: 'codex', branchAgent: 'claude' });
  assert.deepEqual(config.agents, ['claude', 'codex']);
  assert.equal(config.defaultAgent, 'codex');
  assert.equal(config.branchAgent, 'claude');
  assert.deepEqual(config.extensions, ['Anthropic.claude-code', 'OpenAI.chatgpt']);
});

test('Codex approval defaults to automatic review independently of Claude permissions', (t) => {
  const config = configFrom(t, { permissionMode: 'plan' });
  assert.equal(config.codexApprovalMode, 'auto-review');
  assert.equal(config.permissionMode, 'plan');
});

test('manual Codex approval persists across loading another tab or restarting', (t) => {
  const config = configFrom(t);
  config.codexApprovalMode = 'manual';
  config.permissionMode = 'acceptEdits';
  saveConfig(config);
  const loaded = loadConfig(path.dirname(config.file), path.join(path.dirname(config.file), 'user'), false);
  assert.equal(loaded.codexApprovalMode, 'manual');
  assert.equal(loaded.permissionMode, 'acceptEdits');
});

test('unknown Codex preferences normalize to the supported default', (t) => {
  assert.equal(configFrom(t, { codexApprovalMode: 'full-access' }).codexApprovalMode, 'auto-review');
});
