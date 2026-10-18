const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('node:vm');
const { mountReact } = require('./fixtures/react-tree');
const { mainWorktree, repoRoot } = require('../src/repos/worktrees');
const { ONBOARDING_SETTINGS, isOtherWorktree, onboardingSettings, codexOnboardingSnapshot,
  watchCodexOnboarding, codexOnboardingScript } = require('../src/agents/agent-onboarding');
const { git, makeRepo, tempDir } = require('./support');

test('only linked worktrees and their subfolders skip onboarding, even before primary opens', async (t) => {
  const dir = tempDir(t), primary = makeRepo(dir), linked = path.join(dir, 'linked');
  git(primary, 'worktree', 'add', '-b', 'feature', linked);
  for (const [folder, expected] of [[linked, true], [primary, false], [dir, false]]) {
    const subfolder = path.join(folder, 'subfolder');
    fs.mkdirSync(subfolder);
    for (const location of [folder, subfolder]) {
      assert.equal(isOtherWorktree(await repoRoot(location), await mainWorktree(location)), expected);
    }
  }
  assert.deepEqual(onboardingSettings(false), {});
  assert.deepEqual(onboardingSettings(true), { 'claudeCode.hideOnboarding': true });
  assert.deepEqual(ONBOARDING_SETTINGS, ['claudeCode.hideOnboarding']);
});

// Semantic props from OpenAI.chatgpt 26.1007.21434's FirstRunPage. The callback
// belongs to the whole walkthrough; the button callback only advances one slide.
function firstRun({ complete = () => {}, initialStep = 0, hasCloudAccess = true, id = 'codex.legal.step.intro.title' } = {}) {
  const element = {};
  mountReact(element, [{ children: { props: { id, defaultMessage: 'Localized introduction' } } },
    { initialStep, hasCloudAccess, isUsingCopilotAuth: false, onAccept: complete }]);
  return element;
}

function environment(elements = []) {
  const timers = [];
  let mutation, disconnected = false;
  const env = {
    document: { documentElement: {}, querySelectorAll: () => env.elements },
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} disconnect() { disconnected = true; } },
    setTimeout: (callback) => { timers.push(callback); return callback; },
    clearTimeout: (callback) => { const index = timers.indexOf(callback); if (index >= 0) timers.splice(index, 1); },
    elements,
  };
  return { env, mutate: () => mutation(), disconnected: () => disconnected,
    tick: async () => { for (const callback of timers.splice(0)) await callback(); } };
}

test('the adapter completes the known walkthrough independently of localized labels and auth type', async () => {
  for (const options of [{}, { initialStep: 3, hasCloudAccess: false, id: 'codex.legal.continue.apikey' }]) {
    let calls = 0;
    const fixture = environment([firstRun({ ...options, complete: () => { calls++; } })]);
    watchCodexOnboarding(codexOnboardingSnapshot, fixture.env);
    await fixture.tick(); await fixture.tick(); fixture.mutate(); await fixture.tick();
    assert.equal(calls, 1);
    assert.equal(fixture.env.worktabsCodexOnboarding.result, 'completed');
  }
});

test('late first-run rendering, completed-state routing, and reopening a panel still return to chat', async () => {
  const fixture = environment();
  watchCodexOnboarding(codexOnboardingSnapshot, fixture.env);
  await fixture.tick();
  let calls = 0;
  fixture.env.elements = [firstRun({ complete: async () => { calls++; fixture.env.elements = []; } })];
  fixture.mutate(); await fixture.tick();
  // A new first-run instance can appear after state hydration or reopening. Its callback
  // still navigates home even when the extension's onboarding hook returns `none`.
  fixture.env.elements = [firstRun({ complete: () => { calls++; } })];
  fixture.mutate(); await fixture.tick();
  assert.equal(calls, 2);
});

test('chat, authentication, permissions, and unknown walkthrough shapes are untouched', async () => {
  const complete = () => assert.fail('must leave unrelated or unsupported UI alone');
  for (const elements of [[], [{}], [firstRun({ complete, id: 'login.title' })],
    [firstRun({ complete, initialStep: 'intro' })], [firstRun({ complete, hasCloudAccess: null })]]) {
    const fixture = environment(elements);
    watchCodexOnboarding(codexOnboardingSnapshot, fixture.env);
    await fixture.tick();
  }
});

test('a failed completion leaves the original UI available and avoids retrying the same callback', async () => {
  let calls = 0;
  const fixture = environment([firstRun({ complete: () => { calls++; throw new Error('unsupported'); } })]);
  watchCodexOnboarding(codexOnboardingSnapshot, fixture.env);
  await fixture.tick(); await fixture.tick(); fixture.mutate(); await fixture.tick();
  assert.equal(calls, 1);
  assert.equal(fixture.env.worktabsCodexOnboarding.result, 'unavailable');
});

test('the injected script needs no Node APIs and disposes observers when replaced', () => {
  const fixture = environment();
  const context = vm.createContext({ window: fixture.env });
  assert.equal(vm.runInContext(codexOnboardingScript(), context), true);
  const previous = fixture.env.worktabsCodexOnboarding;
  assert.equal(vm.runInContext(codexOnboardingScript(), context), true);
  assert.notEqual(previous, fixture.env.worktabsCodexOnboarding);
  assert.equal(fixture.disconnected(), true);
});

test('a disposed or replaced onboarding watcher ignores late completion and failure', async () => {
  for (const failed of [false, true]) {
    let resolve, reject; const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    const fixture = environment([firstRun({ complete: () => pending })]);
    watchCodexOnboarding(codexOnboardingSnapshot, fixture.env);
    const previous = fixture.env.worktabsCodexOnboarding; const tick = fixture.tick();
    watchCodexOnboarding(codexOnboardingSnapshot, fixture.env);
    if (failed) reject(new Error('late failure')); else resolve();
    await tick;
    assert.equal(previous.result, 'waiting'); assert.equal(fixture.env.worktabsCodexOnboarding.result, 'waiting');
    fixture.env.worktabsCodexOnboarding.dispose(); assert.equal(fixture.disconnected(), true);
  }
});
