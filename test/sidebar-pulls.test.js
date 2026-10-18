const assert = require('node:assert/strict');
const test = require('node:test');
const model = require('../src/sidebar/model');
const checks = require('../src/sidebar/checks');
const { createPullSelectors } = require('../src/sidebar/pulls');

const HOUR = 60 * 60 * 1000;
const NOW = 100 * HOUR;

function setup(extra = {}) {
  const state = {
    repos: [], tabs: [], worktrees: new Map(), savedWorktrees: new Map(),
    github: new Map([['/r', { defaultBranch: 'main' }]]), pulls: new Map(), approved: {}, ...extra,
  };
  return { state, select: createPullSelectors({ state, model, checks, clock: () => NOW }) };
}

const run = (state, at = NOW, ref = null) => ({ state, at, total: 1, runs: [{ name: 'CI', state, at, ref }] });

test('a branch may have a pull request on GitHub, but not the default branch nor a detached HEAD', () => {
  const { select } = setup();
  assert.equal(select.hasBranchPage('/R', 'topic'), true);
  assert.equal(select.hasBranchPage('/r', 'main'), false);
  assert.equal(select.hasBranchPage('/r', 'HEAD'), false);
  assert.equal(select.hasBranchPage('/r', null), false);
  assert.equal(select.hasBranchPage(null, 'topic'), false);
  assert.equal(select.hasBranchPage('/elsewhere', 'topic'), false);
});

test('the read for a repository lists its pull request branches, the numbers they were made from, and every HEAD', () => {
  const items = [
    { path: '/r', branch: 'main', main: true, head: 'c' },
    { path: '/r-b', branch: 'b', head: 'a', pull: { number: 4 } },
    { path: '/r-a', branch: 'a', head: 'b' },
    // Switched to another branch in its tab: the number it was made from no longer applies.
    { path: '/r-x', branch: 'x', head: 'a', pull: { number: 9 } },
  ];
  const { state, select } = setup({ worktrees: new Map([['/r', { status: 'ready', items }]]), tabs: [{ id: 't', folder: '/r-x', repo: '/r', branch: 'y' }] });
  const group = { key: '/r', path: '/r', git: true, tabs: state.tabs };
  assert.deepEqual(select.pullBranches(group), { branches: ['a', 'b', 'y'], numbers: [['b', 4]], heads: ['a', 'b', 'c'] });
  assert.equal(select.madeFrom({ ...items[1], tab: null }), items[1].pull);
  assert.equal(select.madeFrom({ ...items[3], tab: state.tabs[0] }), null);
});

test('a pull request is unknown until its branch is read, and null for a branch without one', () => {
  const pull = { number: 3, state: 'open', checks: run('pending') };
  const result = { branches: new Set(['a', 'b']), pulls: new Map([['a', pull]]), heads: new Map() };
  const { select } = setup({ pulls: new Map([['/r', { result }]]) });
  assert.equal(select.pullOf('/R', 'a'), pull);
  assert.equal(select.pullOf('/r', 'b'), null);
  assert.equal(select.pullOf('/r', 'c'), undefined);
  assert.equal(select.pullOf(null, 'a'), undefined);
});

test('approved pull requests leave the dot once the rows have seen them merged, closed, or made a draft', () => {
  const approved = [{ number: 1 }, { number: 2 }, { number: 3 }];
  const pulls = new Map([['x', { number: 1, state: 'merged' }], ['y', { number: 2, state: 'open' }], ['z', { number: 3, state: 'draft' }]]);
  const { state, select } = setup({ approved: { '/r': approved } });
  const group = { key: '/r', git: true };
  assert.equal(select.approvedOf(group), approved);
  state.pulls.set('/r', { result: { branches: new Set(), pulls, heads: new Map() } });
  assert.deepEqual(select.approvedOf(group), [{ number: 2 }]);
  assert.deepEqual(select.approvedOf({ key: '/r', git: false }), []);
});

test('a merged pull request shows its checks while they are recent, an open one always', () => {
  const { select } = setup();
  const old = run('success', NOW - 2 * HOUR);
  assert.equal(select.pullChecks({ state: 'open', checks: old }, NOW), old);
  assert.equal(select.pullChecks({ state: 'merged', checks: old }, NOW), null);
  const recent = run('success', NOW - HOUR / 2);
  assert.equal(select.pullChecks({ state: 'merged', checks: recent }, NOW), recent);
});

test('a worktree shows its HEAD\'s own recent checks only without a pull request', () => {
  const own = run('failure', NOW, 'refs/heads/main');
  const other = run('success', NOW, 'refs/heads/elsewhere');
  const result = { branches: new Set(['topic']), pulls: new Map(), heads: new Map([['h', own], ['o', other]]) };
  const { select } = setup({ pulls: new Map([['/r', { result }]]) });
  const folder = { repo: '/r', head: 'h' };
  assert.equal(select.headChecks(folder, 'main', null), own);
  assert.equal(select.headChecks(folder, 'main', { number: 1 }), null);
  // Its branch's pull request is not known yet.
  assert.equal(select.headChecks(folder, 'topic', undefined), null);
  assert.equal(select.headChecks({ repo: '/r', head: 'o' }, 'main', null), null);
  assert.equal(select.headChecks({ repo: '/r', head: 'o' }, 'HEAD', null), other);
  assert.equal(select.headChecks({ repo: null, head: 'h' }, 'main', null), null);
});

test('checks count as running only while the rows may show them', () => {
  const { select } = setup();
  const result = (pull, head) => ({ branches: new Set(), pulls: new Map(pull ? [['a', pull]] : []), heads: new Map(head ? [['h', head]] : []) });
  assert.equal(select.checksRunning(result({ state: 'open', checks: run('pending') })), true);
  assert.equal(select.checksRunning(result(null, run('pending'))), true);
  assert.equal(select.checksRunning(result(null, run('pending', NOW - 25 * HOUR))), false);
  assert.equal(select.checksRunning(result({ state: 'merged', checks: run('pending', NOW - 25 * HOUR) })), false);
  assert.equal(select.checksRunning(result({ state: 'open', checks: null }, run('success'))), false);
});
