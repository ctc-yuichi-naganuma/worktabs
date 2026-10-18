// claude-wrap.exe, built from native/ClaudeWrap.cs with the C# compiler that comes with Windows.
// Runs on Windows only.
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { HookServer } = require('../src/conversations/hooks');
const { tempDir } = require('./support');
const { EXPECTED_CODE, EXPECTED_ERR, EXPECTED_OUT, REORDERED, USAGE, runWrapper, writeChild } = require('./wrap-fixture');

const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const skip = process.platform !== 'win32' || !fs.existsSync(CSC) ? 'needs Windows and its C# compiler' : false;

function buildWrapper(dir) {
  const exe = path.join(dir, 'claude-wrap.exe');
  execFileSync(CSC, ['-nologo', '-target:exe', '-platform:x64', `-out:${exe}`, path.join(__dirname, '..', 'native', 'ClaudeWrap.cs')]);
  return exe;
}

test('claude-wrap.exe passes claude\'s output through as it comes, and posts the rate_limit_event lines', { skip, timeout: 60000 }, async (t) => {
  const dir = tempDir(t);
  const exe = buildWrapper(dir);
  const claude = writeChild(dir);

  const server = new HookServer();
  await server.listen();
  t.after(() => server.close());
  const usage = [];
  const hooks = [];
  server.on('usage', (input) => usage.push(input));
  server.on('hook', (...args) => hooks.push(args));

  const env = { ...process.env, WORKTABS_HOOK_URL: server.url, WORKTABS_HOOK_TOKEN: server.token, WORKTABS_TAB_ID: 'tab1' };
  delete env.WORKTABS_CLAUDE_SETTINGS;
  const { code, out, err } = await runWrapper(exe, claude, env);

  assert.equal(code, EXPECTED_CODE);
  assert.equal(out, EXPECTED_OUT);
  assert.equal(err, EXPECTED_ERR);
  // Posted in order, before the wrapper exits.
  assert.deepEqual(usage, [JSON.parse(USAGE), JSON.parse(REORDERED)]);
  assert.deepEqual(hooks, []);
});
