// The WSL agent runs in Linux (it reads /proc), so most of these run on Linux only: in CI, or
// inside WSL by hand.
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const test = require('node:test');
const { tempDir } = require('./support');

const AGENT = path.join(__dirname, '..', 'src', 'wsl', 'wsl-agent.js');
const linux = { skip: process.platform !== 'linux' && 'the agent runs in Linux only' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Starts the agent and returns { request, next, close }: request sends an op and resolves its
// answer; next resolves the next event that `match` accepts.
function startAgent(t) {
  const proc = spawn(process.execPath, [AGENT], { stdio: ['pipe', 'pipe', 'inherit'] });
  t.after(() => proc.kill('SIGKILL'));
  const answers = new Map();
  const events = [];
  const waiting = [];
  let id = 0;
  readline.createInterface({ input: proc.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.id) {
      answers.get(message.id)(message);
      return;
    }
    const at = waiting.findIndex((w) => w.match(message));
    if (at >= 0) waiting.splice(at, 1)[0].resolve(message);
    else events.push(message);
  });
  return {
    proc,
    request: (message) => new Promise((resolve) => {
      answers.set(++id, resolve);
      proc.stdin.write(`${JSON.stringify({ id, ...message })}\n`);
    }),
    next: (match) => new Promise((resolve) => {
      const at = events.findIndex(match);
      if (at >= 0) resolve(events.splice(at, 1)[0]);
      else waiting.push({ match, resolve });
    }),
    exited: new Promise((resolve) => proc.on('exit', resolve)),
  };
}

const alive = (pid) => {
  try {
    return !/^Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').pop());
  } catch {
    return false;
  }
};

async function waitFor(check, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await sleep(50);
  }
}

// A stand-in for code-server: starts a child that starts a grandchild of its own (as the
// extension host starts claude), writes their pids to a file, and waits.
function fakeServer(file) {
  const grandchild = "require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })";
  const script = `
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(`const g = ${grandchild}; console.log(g.pid); setInterval(() => {}, 1000)`)}], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.once('data', (d) => require('fs').writeFileSync(${JSON.stringify(file)}, [process.pid, child.pid, String(d).trim()].join(' ')));
    console.log('listening', process.env.WORKTABS_TEST);
    setInterval(() => {}, 1000);
  `;
  return { command: process.execPath, args: ['-e', script] };
}

async function pidsOf(file) {
  await waitFor(() => fs.existsSync(file) && fs.readFileSync(file, 'utf8').split(' ').length === 3);
  return fs.readFileSync(file, 'utf8').split(' ').map(Number);
}

test('the agent runs commands, and reads and writes files', linux, async (t) => {
  const agent = startAgent(t);
  const dir = tempDir(t);
  const echo = await agent.request({ op: 'exec', command: 'printf', args: ['%s|', 'a b', "it's"] });
  assert.deepEqual([echo.ok, echo.code, echo.stdout], [true, 0, "a b|it's|"]);
  const failed = await agent.request({ op: 'exec', command: 'sh', args: ['-c', 'echo oops >&2; exit 3'] });
  assert.deepEqual([failed.code, failed.stderr], [3, 'oops\n']);
  assert.equal((await agent.request({ op: 'exec', command: 'no-such-command-here' })).code, 127);
  const piped = await agent.request({ op: 'exec', command: 'cat', input: 'a\0b\n' });
  assert.equal(piped.stdout, 'a\0b\n');

  const file = path.join(dir, 'sub', 'settings.json');
  const wrote = await agent.request({ op: 'write', path: file, data: Buffer.from('{"a":1}\n').toString('base64'), mode: 0o755 });
  assert.equal(wrote.ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}\n');
  assert.equal(fs.statSync(file).mode & 0o777, 0o755);
  const read = await agent.request({ op: 'read', path: file });
  assert.equal(Buffer.from(read.data, 'base64').toString('utf8'), '{"a":1}\n');
  const missing = await agent.request({ op: 'read', path: path.join(dir, 'none') });
  assert.deepEqual([missing.ok, missing.code], [false, 'ENOENT']);
});

// These need no /proc, so they run everywhere.
test('the agent lists, stats and removes files, and watches folders', async (t) => {
  const agent = startAgent(t);
  const user = path.join(tempDir(t), 'User');
  const file = path.join(user, 'keybindings.json');
  fs.mkdirSync(path.join(user, 'History'), { recursive: true });
  fs.writeFileSync(file, '[]');
  assert.deepEqual((await agent.request({ op: 'list', path: user })).names, ['keybindings.json']);
  assert.deepEqual((await agent.request({ op: 'list', path: path.join(user, 'none') })).names, []);
  assert.equal((await agent.request({ op: 'stat', path: file })).mtimeMs, fs.statSync(file).mtimeMs);
  const missing = await agent.request({ op: 'stat', path: path.join(user, 'none') });
  assert.deepEqual([missing.ok, missing.code], [false, 'ENOENT']);
  assert.equal((await agent.request({ op: 'remove', path: file })).ok, true);
  assert.equal(fs.existsSync(file), false);
  assert.equal((await agent.request({ op: 'remove', path: file })).ok, true);

  const snippets = path.join(user, 'snippets');
  assert.equal((await agent.request({ op: 'watch', name: 'w1', folders: [user, snippets] })).ok, true);
  assert.ok(fs.statSync(snippets).isDirectory());
  const changed = agent.next((m) => m.event === 'change' && m.file === 'js.json');
  let observed = false;
  changed.then(() => { observed = true; });
  // On macOS a watcher of a newly created folder may not see its first write. Exercise the
  // watcher until it reports a real change, and fail within a bound if it never does.
  for (let attempt = 0; attempt < 50 && !observed; attempt++) {
    fs.writeFileSync(path.join(snippets, 'js.json'), JSON.stringify({ attempt }));
    await Promise.race([changed, sleep(50)]);
  }
  assert.ok(observed, 'the folder watcher must report a change within 2.5 seconds');
  assert.deepEqual(await changed, {
    event: 'change', name: 'w1', folder: snippets, file: 'js.json',
  });
  assert.equal((await agent.request({ op: 'unwatch', name: 'w1' })).ok, true);
});

test('the agent forwards authenticated Codex metadata without changing its body', async (t) => {
  const agent = startAgent(t);
  const { hookPort } = await agent.request({ op: 'init', token: 'secret' });
  const body = JSON.stringify({ threadId: 'thread', state: 'waiting', cwd: '/repo' });
  const post = (token) => fetch(`http://127.0.0.1:${hookPort}/codex`, {
    method: 'POST', headers: { 'X-Wrapper-Token': token, 'X-Wrapper-Tab': 'tab' }, body,
  });
  assert.equal((await post('wrong')).status, 404);
  assert.equal((await post('secret')).status, 200);
  assert.deepEqual(await agent.next((m) => m.event === 'request'), {
    event: 'request', route: 'codex', tab: 'tab', proc: null, body,
  });
});

test('the agent passes on hook requests with the token, and says when their process ends', linux, async (t) => {
  const agent = startAgent(t);
  const { hookPort } = await agent.request({ op: 'init', token: 'secret' });
  const claude = spawn('sleep', ['30']);
  t.after(() => claude.kill());
  const post = (token, route = '/hook') => fetch(`http://127.0.0.1:${hookPort}${route}`, {
    method: 'POST',
    headers: { 'X-Wrapper-Token': token, 'X-Wrapper-Tab': 't1', 'X-Wrapper-Proc': String(claude.pid) },
    body: '{"hook_event_name":"Stop"}',
  });

  assert.equal((await post('wrong')).status, 404);
  assert.equal((await post('secret', '/other')).status, 404);
  assert.equal((await post('secret')).status, 200);
  assert.deepEqual(await agent.next((m) => m.event === 'request'), {
    event: 'request', route: 'hook', tab: 't1', proc: claude.pid, body: '{"hook_event_name":"Stop"}',
  });
  assert.equal((await post('wrong', '/codex')).status, 404);
  assert.equal((await post('secret', '/codex')).status, 200);
  assert.equal((await agent.next((m) => m.event === 'request')).route, 'codex');

  // The command hook (SessionStart) posts the same way.
  const hook = spawn(process.execPath, [AGENT, 'hook'], {
    env: { ...process.env, WORKTABS_HOOK_URL: `http://127.0.0.1:${hookPort}/hook`, WORKTABS_HOOK_TOKEN: 'secret', WORKTABS_TAB_ID: 't1', WORKTABS_PROC_ID: String(claude.pid) },
  });
  hook.stdin.end('{"hook_event_name":"SessionStart"}');
  assert.equal(await new Promise((resolve) => hook.on('exit', resolve)), 0);
  assert.equal((await agent.next((m) => m.event === 'request')).body, '{"hook_event_name":"SessionStart"}');

  claude.kill();
  assert.deepEqual(await agent.next((m) => m.event === 'proc-exit'), { event: 'proc-exit', proc: claude.pid });
});

test('the agent stops an instance with everything under it', linux, async (t) => {
  const agent = startAgent(t);
  const file = path.join(tempDir(t), 'pids');
  const started = await agent.request({ op: 'start', name: 't1', ...fakeServer(file), env: { WORKTABS_TEST: 'yes' } });
  assert.equal(started.ok, true);
  assert.equal((await agent.next((m) => m.event === 'output')).text, 'listening yes\n');
  const pids = await pidsOf(file);
  assert.equal(pids[0], started.pid);
  assert.ok(pids.every(alive));

  assert.equal((await agent.request({ op: 'stop', name: 't1' })).ok, true);
  assert.equal((await agent.next((m) => m.event === 'exit')).name, 't1');
  await waitFor(() => !pids.some(alive));
});

test('the agent stops its instances and exits when its standard input closes', linux, async (t) => {
  const agent = startAgent(t);
  const file = path.join(tempDir(t), 'pids');
  await agent.request({ op: 'start', name: 't1', ...fakeServer(file) });
  const pids = await pidsOf(file);
  agent.proc.stdin.end();
  assert.equal(await agent.exited, 0);
  await waitFor(() => !pids.some(alive));
});
