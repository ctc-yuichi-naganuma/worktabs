const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createWorktreeRemoval } = require('../src/repos/worktree-removal');
const { mergedAtHead } = require('../src/repos/github');

const repo = path.resolve('test-repos', 'repo');
const folder = path.resolve('test-repos', 'repo-task');
const head = 'a'.repeat(40);
const target = { repo, branch: 'task', head, locked: false, missing: false };
function setup(overrides = {}) {
  const calls = [];
  const dialogs = [];
  const tabs = new Map();
  const removing = new Set();
  const controller = createWorktreeRemoval({
    tabs, removing, tabIdFor: () => 'target', stopRisks: async () => [], conversations: () => [],
    messageBox: async (options) => { dialogs.push(options); return { response: 1, checkboxChecked: false }; },
    openTab: (dir) => calls.push(['open', dir]),
    closeTab: async (id, options) => { calls.push(['close', id, options]); tabs.delete(id); },
    pushState: () => calls.push(['push']), refreshGit: (...args) => calls.push(['refresh', ...args]),
    serversFor: () => ({ removeInstanceData: (id) => calls.push(['instance', id]) }),
    clearPortStorage: (ports) => calls.push(['storage', ports]),
    forgetPort: (id) => { calls.push(['forget', id]); return [5000]; },
    saveTabs: () => calls.push(['save']), notifyBranchDeleted: (...args) => calls.push(['notify', ...args]),
    removableWorktree: async () => target,
    worktreeChanges: async () => { calls.push(['changes']); return 0; },
    unsharedCommits: async (...args) => { calls.push(['commits', ...args]); return 0; },
    ignoredOnlyHere: async () => { calls.push(['ignored']); return []; },
    githubRepo: async () => null, branchLinks: async () => new Map(), branchPulls: async () => ({ pulls: new Map() }),
    mergedAtHead, removeWorktree: async (...args) => calls.push(['remove', ...args]),
    deleteBranch: async (...args) => { calls.push(['delete', ...args]); return 'a123456'; },
    gitMessage: (error) => error.message, ...overrides,
  });
  return { controller, calls, dialogs, tabs, removing };
}

test('another tab working or waiting inside the target blocks removal without reading ignored files or PRs', async () => {
  for (const state of ['working', 'waiting']) {
    const { controller, tabs, calls, dialogs } = setup({
      conversations: () => [{ state, cwd: path.join(folder, 'src'), title: 'Task' }],
    });
    tabs.set('other', { id: 'other', name: 'Another tab' });
    await controller.confirmRemoveWorktree(folder);
    assert.match(dialogs[0].detail, /Another tab/);
    assert.match(dialogs[0].detail, state === 'working' ? /is working/ : /waiting for approval/);
    assert.equal(calls.some(([kind]) => ['remove', 'ignored'].includes(kind)), false);
  }
});

test('a neighboring folder with a similar prefix and idle conversations do not block the target', async () => {
  const { controller, tabs } = setup({ conversations: () => [
    { state: 'working', cwd: `${folder}-other` }, { state: 'idle', cwd: folder },
  ] });
  tabs.set('other', { id: 'other', name: 'Other' });
  assert.deepEqual((await controller.removalCheck(folder)).blockers, []);
});

test('unsaved edits, Git locks, and uncommitted changes stay removal blockers', async () => {
  const { controller, tabs, calls, dialogs } = setup({
    stopRisks: async () => ['Unsaved editor'], removableWorktree: async () => ({ ...target, locked: true }),
    worktreeChanges: async () => 2,
  });
  tabs.set('target', { id: 'target', name: 'Task' });
  await controller.confirmRemoveWorktree(folder);
  assert.match(dialogs[0].detail, /Unsaved editor/);
  assert.match(dialogs[0].detail, /git worktree lock/);
  assert.match(dialogs[0].detail, /2 changes not committed/);
  assert.equal(calls.some(([kind]) => ['remove', 'ignored'].includes(kind)), false);
});

test('missing folders still count commits from the primary and keep the bounded linked-PR query', async () => {
  const queries = [];
  const pull = { state: 'merged', number: 42, head };
  const { controller, calls } = setup({
    removableWorktree: async () => ({ ...target, missing: true }),
    githubRepo: async () => ({ url: 'https://github.com/example/repo', defaultBranch: 'main' }),
    branchLinks: async () => new Map([['task', { pull: { number: 42 } }]]),
    branchPulls: async (...args) => { queries.push(args); return { pulls: new Map([['task', pull]]) }; },
  });
  const check = await controller.removalCheck(folder, repo);
  assert.equal(check.held, true);
  assert.deepEqual(check.ignored, []);
  assert.equal(calls.some(([kind]) => ['changes', 'ignored'].includes(kind)), false);
  assert.deepEqual(calls.find(([kind]) => kind === 'commits'), ['commits', repo, 'task', head]);
  assert.equal(queries[0][2].timeout, 5000);
  assert.deepEqual(queries[0][2].numbers, { task: 42 });
});

test('a failed PR read preserves the confirmation fallback and cancellation changes nothing', async () => {
  const { controller, dialogs, calls } = setup({ githubRepo: async () => { throw new Error('offline'); } });
  await controller.confirmRemoveWorktree(folder);
  assert.equal(dialogs.length, 1);
  assert.equal(calls.some(([kind]) => ['open', 'remove', 'delete', 'instance', 'forget'].includes(kind)), false);
});

test('confirmation deduplicates requests and releases ownership after cancellation or a failed check', async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  let reads = 0;
  const { controller } = setup({ removableWorktree: async () => { reads++; return pending; } });
  const first = controller.confirmRemoveWorktree(folder);
  await controller.confirmRemoveWorktree(folder.toUpperCase());
  assert.equal(reads, 1);
  resolve(target);
  await first;
  await controller.confirmRemoveWorktree(folder);
  assert.equal(reads, 2);
  let failedReads = 0;
  const failure = setup({ removableWorktree: async () => { failedReads++; throw new Error('Git failed'); } }).controller;
  await assert.rejects(failure.confirmRemoveWorktree(folder), /Git failed/);
  await assert.rejects(failure.confirmRemoveWorktree(folder), /Git failed/);
  assert.equal(failedReads, 2);
});

test('removal opens the primary, closes the tab, removes the worktree, then clears storage and deletes the branch', async () => {
  const { controller, calls, tabs, removing } = setup();
  tabs.set('target', { id: 'target' });
  assert.equal(await controller.removeWorktreeNow(repo, folder, { branch: 'task', unshared: 3 }), null);
  assert.deepEqual(calls.map(([kind]) => kind), ['open', 'push', 'close', 'remove', 'push', 'refresh', 'instance', 'forget', 'storage', 'save', 'delete', 'notify']);
  assert.deepEqual(calls[0], ['open', repo]);
  assert.deepEqual(calls.find(([kind]) => kind === 'close'), ['close', 'target', { force: true }]);
  assert.deepEqual(calls.find(([kind]) => kind === 'notify'), ['notify', 'task', 'a123456']);
  assert.equal(removing.size, 0);
});

test('removal failure clears activity and refreshes without discarding storage or deleting the branch', async () => {
  const { controller, calls, dialogs, removing } = setup({ removeWorktree: async () => { throw new Error('folder in use'); }, platform: 'darwin' });
  const result = await controller.removeWorktreeNow(repo, folder, { branch: 'task' });
  assert.match(result, /Could not remove/);
  assert.match(dialogs[0].detail, /Finder/);
  assert.equal(removing.size, 0);
  assert.deepEqual(calls.map(([kind]) => kind), ['open', 'push', 'push', 'refresh']);
});

test('branch deletion failure reports the partial result after the worktree and storage are removed', async () => {
  const { controller, calls, dialogs } = setup({ deleteBranch: async () => { throw new Error('branch locked'); } });
  const result = await controller.removeWorktreeNow(repo, folder, { branch: 'task', unshared: 1 });
  assert.match(result, /Removed .*but could not delete the branch task/);
  assert.match(dialogs[0].detail, /branch locked/);
  assert.ok(calls.some(([kind]) => kind === 'save'));
  assert.equal(calls.some(([kind]) => kind === 'notify'), false);
});

test('a merged PR holding the exact head allows branch deletion without a lost-commit notification', async () => {
  const { controller, calls } = setup({
    messageBox: async () => ({ response: 0, checkboxChecked: true }), unsharedCommits: async () => 2,
    githubRepo: async () => ({ defaultBranch: 'main' }),
    branchPulls: async () => ({ pulls: new Map([['task', { state: 'merged', number: 42, head }]]) }),
  });
  await controller.confirmRemoveWorktree(folder);
  assert.equal(calls.some(([kind]) => kind === 'delete'), true);
  assert.equal(calls.some(([kind]) => kind === 'notify'), false);
});

test('quiet removal keeps failure results and activity updates without dialogs or recovery notifications', async () => {
  const { controller, dialogs, calls } = setup();
  await controller.removeWorktreeNow(repo, folder, { branch: 'task', unshared: 1, quiet: true });
  assert.deepEqual(dialogs, []);
  assert.equal(calls.some(([kind]) => kind === 'notify'), false);
  const failing = setup({ removeWorktree: async () => { throw new Error('busy'); } });
  assert.match(await failing.controller.removeWorktreeNow(repo, folder, { quiet: true }), /busy/);
  assert.deepEqual(failing.dialogs, []);
});
