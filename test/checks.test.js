const assert = require('node:assert/strict');
const test = require('node:test');
const { setLanguage } = require('../src/i18n');
const { checksLines, ownChecks, recentChecks } = require('../src/sidebar/checks');

const NOW = Date.parse('2026-10-01T12:00:00Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const checks = (state, at, runs = [], total = runs.length) => ({ oid: 'a'.repeat(40), state, runs, total, at });

test('recentChecks shows passed checks for an hour, failed and running ones for a day', () => {
  assert.ok(recentChecks(checks('success', NOW - 59 * MINUTE), NOW));
  assert.equal(recentChecks(checks('success', NOW - 61 * MINUTE), NOW), null);
  for (const state of ['failure', 'pending']) {
    assert.ok(recentChecks(checks(state, NOW - 23 * HOUR), NOW), state);
    assert.equal(recentChecks(checks(state, NOW - 25 * HOUR), NOW), null, state);
  }
});

test('recentChecks shows checks that do not say when they ran, and nothing without checks', () => {
  assert.ok(recentChecks(checks('success', null), NOW));
  assert.equal(recentChecks(null, NOW), null);
  assert.equal(recentChecks(undefined, NOW), null);
});

test('checksLines names each check with its outcome, failed ones first', () => {
  const runs = [
    { name: 'CI / Test (ubuntu-latest)', state: 'success' },
    { name: 'Release / Release (Windows)', state: 'pending' },
    { name: 'CI / Test (windows-latest)', state: 'failure' },
    { name: 'CI / Lint', state: 'skipped' },
    { name: 'CI / Build (Windows)', state: 'cancelled' },
  ];
  assert.deepEqual(checksLines(checks('failure', NOW, runs)), [
    'CI / Test (windows-latest): Failed',
    'CI / Build (Windows): Cancelled',
    'Release / Release (Windows): In progress',
    'CI / Test (ubuntu-latest): Successful',
    'CI / Lint: Skipped',
  ]);
});

test('checksLines names ten checks at most, and says how many more there are', () => {
  const runs = Array.from({ length: 12 }, (_, i) => ({ name: `job ${i + 1}`, state: 'success' }));
  const lines = checksLines(checks('success', NOW, runs, 40));
  assert.equal(lines.length, 11);
  assert.equal(lines[9], 'job 10: Successful');
  assert.equal(lines[10], 'and 30 more checks');
  // More than were read.
  assert.deepEqual(checksLines(checks('success', NOW, runs.slice(0, 1), 3)), ['job 1: Successful', 'and 2 more checks']);
  assert.deepEqual(checksLines(checks('success', NOW, [], 0)), []);
});

test('in Japanese, checksLines reads as it did before the UI was in English', (t) => {
  setLanguage('ja');
  t.after(() => setLanguage('en'));
  const runs = [
    { name: 'CI / Test', state: 'failure' },
    { name: 'CI / Lint', state: 'cancelled' },
  ];
  assert.deepEqual(checksLines(checks('failure', NOW, runs, 5)), ['CI / Test: 失敗', 'CI / Lint: キャンセル', 'ほか 3 件']);
});

// v0.2.0's release commit: main's push ran CI, its tag Release.
const run = (name, state, at, ref) => ({ name, state, at, ref });
const RELEASE = checks('pending', NOW - 5 * MINUTE, [
  run('CI / Test (ubuntu-latest)', 'success', NOW - 9 * MINUTE, 'refs/heads/main'),
  run('Release / Release (Windows)', 'pending', NOW - 10 * MINUTE, 'refs/tags/v0.2.0'),
  run('CI / Build (Windows)', 'failure', NOW - 5 * MINUTE, 'refs/heads/main'),
  run('ci/circleci', 'success', NOW - 8 * MINUTE, null),
]);

test('ownChecks keeps on the default branch the checks of its push, of a tag, and of another service', () => {
  assert.equal(ownChecks(RELEASE, 'main', 'main'), RELEASE);
  // A detached HEAD has no branch to tell them apart.
  assert.equal(ownChecks(RELEASE, null, 'main'), RELEASE);
});

test('ownChecks leaves out the checks that ran for another branch, and works out what the rest came to', () => {
  // A branch just made from main, before its first push: the tag is main's release.
  assert.deepEqual(ownChecks(RELEASE, 'feat/x', 'main'), { ...RELEASE, state: 'success', runs: [RELEASE.runs[3]], total: 1, at: NOW - 8 * MINUTE });
  // Without the default branch known, a tag is no branch's.
  assert.deepEqual(ownChecks(RELEASE, 'main', null).runs, [RELEASE.runs[0], RELEASE.runs[2], RELEASE.runs[3]]);
  assert.equal(ownChecks(RELEASE, 'main', null).state, 'failure');
  const main = checks('success', NOW, [run('CI / Test', 'success', NOW, 'refs/heads/main')]);
  assert.equal(ownChecks(main, 'feat/x', 'main'), null);
  const mixed = (...states) => checks('failure', NOW, [run('CI / Test', 'failure', NOW, 'refs/heads/main'), ...states.map((state, i) => run(`job ${i}`, state, null, 'refs/heads/feat/x'))], 40);
  assert.equal(ownChecks(mixed('success', 'skipped'), 'feat/x', 'main').state, 'success');
  assert.equal(ownChecks(mixed('success', 'cancelled'), 'feat/x', 'main').state, 'failure');
  assert.equal(ownChecks(mixed('success', 'pending'), 'feat/x', 'main').state, 'pending');
  assert.equal(ownChecks(mixed('pending', 'failure'), 'feat/x', 'main').state, 'failure');
  // None of its own says when: they show as long as they do not say.
  assert.equal(ownChecks(mixed('success'), 'feat/x', 'main').at, null);
  // Those past the ones read may be its own.
  assert.equal(ownChecks(mixed('success'), 'feat/x', 'main').total, 39);
  assert.equal(ownChecks(null, 'main', 'main'), null);
});
