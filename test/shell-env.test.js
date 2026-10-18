const assert = require('node:assert/strict');
const { test } = require('node:test');
const { applyShellEnv, parseShellEnv, readShellEnv } = require('../src/shell-env');

test('parseShellEnv reads the JSON between the marks, past what start-up files print', () => {
  const out = 'Welcome!\nabc{"PATH":"/opt/homebrew/bin:/usr/bin"}abc\nbye';
  assert.deepEqual(parseShellEnv(out, 'abc'), { PATH: '/opt/homebrew/bin:/usr/bin' });
});

test('parseShellEnv is null without the marks or with broken JSON', () => {
  assert.equal(parseShellEnv('nothing here', 'abc'), null);
  assert.equal(parseShellEnv('abc{broken abc', 'abc'), null);
});

test("applyShellEnv puts the shell's PATH first and keeps folders only the app had", () => {
  const target = { PATH: '/usr/bin:/bin:/app/bin', HOME: '/Users/me' };
  applyShellEnv(target, { PATH: '/opt/homebrew/bin:/usr/bin:/bin', GOPATH: '/Users/me/go', SHLVL: '2', PWD: '/' });
  assert.equal(target.PATH, '/opt/homebrew/bin:/usr/bin:/bin:/app/bin');
  assert.equal(target.GOPATH, '/Users/me/go');
  assert.equal(target.HOME, '/Users/me');
  assert.equal(target.SHLVL, undefined);
  assert.equal(target.PWD, undefined);
});

test('applyShellEnv leaves the environment as it is without the shell environment', () => {
  const target = { PATH: '/usr/bin' };
  applyShellEnv(target, null);
  assert.deepEqual(target, { PATH: '/usr/bin' });
});

test('readShellEnv reads what the shell exports', { skip: process.platform === 'win32' }, async () => {
  const env = await readShellEnv({ shell: '/bin/sh', env: { ...process.env, WORKTABS_TEST_VALUE: 'x y' } });
  assert.equal(env.WORKTABS_TEST_VALUE, 'x y');
});

test('readShellEnv is null when the shell does not start', { skip: process.platform === 'win32' }, async () => {
  assert.equal(await readShellEnv({ shell: '/no/such/shell' }), null);
});
