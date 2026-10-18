const assert = require('node:assert/strict');
const test = require('node:test');
const { afterMark, listDistros, parseDistroList, parseWslPath, shellQuote, shellScript, windowsPath } = require('../src/wsl/wsl');

test('parseWslPath reads the distribution and the Linux path of a WSL folder', () => {
  assert.deepEqual(parseWslPath('\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\repo'), { distro: 'Ubuntu-24.04', path: '/home/me/repo' });
  assert.deepEqual(parseWslPath('\\\\wsl$\\Ubuntu\\home\\me\\repo\\'), { distro: 'Ubuntu', path: '/home/me/repo' });
  assert.deepEqual(parseWslPath('//wsl.localhost/Ubuntu/home/me/a/../b'), { distro: 'Ubuntu', path: '/home/me/b' });
  assert.deepEqual(parseWslPath('\\\\WSL.LOCALHOST\\Ubuntu'), { distro: 'Ubuntu', path: '/' });
  assert.equal(parseWslPath('C:\\repos\\worktabs'), null);
  assert.equal(parseWslPath('\\\\server\\share\\repo'), null);
  assert.equal(parseWslPath('/home/me/repo'), null);
  assert.equal(parseWslPath(null), null);
});

test('windowsPath gives the UNC path, or the drive for /mnt/<letter>', () => {
  assert.equal(windowsPath('Ubuntu', '/home/me/repo'), '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo');
  assert.equal(windowsPath('Ubuntu', '/home/me/repo/'), '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo');
  assert.equal(windowsPath('Ubuntu', '/'), '\\\\wsl.localhost\\Ubuntu\\');
  assert.equal(windowsPath('Ubuntu', '/mnt/c/repos/x'), 'C:\\repos\\x');
  assert.equal(windowsPath('Ubuntu', '/mnt/d'), 'D:\\');
  assert.equal(windowsPath('Ubuntu', '/mnt/wsl/x'), '\\\\wsl.localhost\\Ubuntu\\mnt\\wsl\\x');
  // Round trip.
  const unc = windowsPath('Ubuntu-24.04', '/home/me/日本語 dir');
  assert.deepEqual(parseWslPath(unc), { distro: 'Ubuntu-24.04', path: '/home/me/日本語 dir' });
});

test('shellQuote quotes for a POSIX shell only what needs it', () => {
  assert.equal(shellQuote('ghq'), 'ghq');
  assert.equal(shellQuote('--full-path'), '--full-path');
  assert.equal(shellQuote('a b'), "'a b'");
  assert.equal(shellQuote("it's"), "'it'\\''s'");
  assert.equal(shellQuote('$HOME'), "'$HOME'");
});

test('shellScript runs the command in the user shell and afterMark keeps its output', () => {
  const [sh, c, script, name, line] = shellScript('gh', ['pr', 'view', 'feat/x'], 'MARK');
  assert.deepEqual([sh, c, name], ['sh', '-c', 'sh']);
  assert.match(script, /"\$\{SHELL:-\/bin\/sh\}" -i -l -c 'exec \/bin\/sh -c '"'"'eval "\$WORKTABS_EXEC"'"'"/);
  assert.equal(line, "unset WORKTABS_EXEC; printf '\\n%s\\n' MARK; exec gh pr view feat/x");
  assert.equal(afterMark('Welcome!\n\nMARK\nhttps://x\n', 'MARK'), 'https://x\n');
  assert.equal(afterMark('no mark\n', 'MARK'), 'no mark\n');
});

// The user's shell (fish, say) may quote otherwise than sh: it must never parse the arguments.
test('shellScript passes arguments through any login shell unchanged', { skip: process.platform === 'win32' }, () => {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktabs-shell-'));
  try {
    const marker = path.join(dir, 'ran');
    const args = [`a\\'(touch ${marker})\\'`, `it's "q" $HOME \`id\` $(touch ${marker})`, 'one\ntwo', '-x', ''];
    const shells = ['/bin/sh', '/bin/bash', '/usr/bin/fish', '/bin/zsh', '/usr/bin/zsh'].filter((shell) => fs.existsSync(shell));
    for (const shell of shells) {
      const argv = shellScript(process.execPath, ['-e', 'console.log(JSON.stringify([process.argv.slice(1), process.env.WORKTABS_EXEC ?? null]))', ...args], 'MARK');
      const out = execFileSync(argv[0], argv.slice(1), { env: { ...process.env, SHELL: shell }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      assert.deepEqual(JSON.parse(afterMark(out, 'MARK')), [args, null], shell);
    }
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseDistroList reads UTF-8 and UTF-16LE, without the distributions that have no shell', () => {
  assert.deepEqual(parseDistroList(Buffer.from('Ubuntu-24.04\r\nDebian\r\n\r\n')), ['Ubuntu-24.04', 'Debian']);
  assert.deepEqual(parseDistroList(Buffer.from('﻿Ubuntu\r\ndocker-desktop\r\nDocker-Desktop-Data\r\n', 'utf16le')), ['Ubuntu']);
  assert.deepEqual(parseDistroList(Buffer.alloc(0)), []);
});

// listDistros runs node in place of wsl.exe, which it starts the same way.
const fakeWsl = (script, timeout = 5000) => listDistros({ command: process.execPath, args: ['-e', script], timeout });
const print = (text, encoding = 'utf8') => `process.stdout.write(Buffer.from(${JSON.stringify(text)}, '${encoding}'))`;

test('listDistros gives the names wsl.exe prints, in either encoding', async () => {
  assert.deepEqual(await fakeWsl(print('Ubuntu\r\nDebian\r\n')), { names: ['Ubuntu', 'Debian'], error: null });
  assert.deepEqual(await fakeWsl(print('Ubuntu\r\n', 'utf16le')), { names: ['Ubuntu'], error: null });
});

test('listDistros closes the standard input, so that a wsl.exe waiting for a key goes on', async () => {
  const { names } = await fakeWsl(`process.stdin.resume(); process.stdin.on('end', () => ${print('Ubuntu\n')})`);
  assert.deepEqual(names, ['Ubuntu']);
});

test('listDistros lists none without wsl.exe, or when it fails', async () => {
  const missing = await listDistros({ command: 'worktabs-no-such-command' });
  assert.deepEqual(missing.names, []);
  assert.equal(missing.error.code, 'ENOENT');
  // Without WSL or a distribution, wsl.exe explains and exits with an error.
  const failed = await fakeWsl(`${print('no installed distributions\n')}; process.exit(1)`);
  assert.deepEqual(failed.names, []);
  assert.equal(failed.error.code, 1);
});

test('listDistros gives up on a wsl.exe that does not answer, when the names are not known', async () => {
  const { names, error } = await fakeWsl('setTimeout(() => {}, 30000)', 500);
  assert.equal(names, null);
  assert.ok(error.killed);
});

// A distribution whose agent is a fake: what the app writes to it is kept, and the test answers
// as the agent would, one JSON line each.
function fakeAgent() {
  const { WslDistro } = require('../src/wsl/wsl');
  const distro = new WslDistro('Ubuntu');
  const sent = [];
  distro.agent = { proc: { stdin: { write: (line) => sent.push(JSON.parse(line)) } }, hookPort: 0 };
  const answer = (reply) => distro.onLine(JSON.stringify({ id: sent.at(-1).id, ...reply }));
  return { distro, sent, answer };
}

test('WslDistro sends requests to its agent and settles them with its answers', async () => {
  const { distro, sent, answer } = fakeAgent();
  const exec = distro.exec('git', ['status'], { timeout: 1000 });
  assert.deepEqual(sent.at(-1), { id: 1, op: 'exec', command: 'git', args: ['status'], timeout: 1000, shellEnv: false, input: null });
  answer({ ok: true, code: 0, stdout: 'clean\n' });
  assert.equal(await exec, 'clean\n');

  // A command that fails rejects with its exit code and what it wrote.
  const failing = distro.exec('git', ['bad']);
  answer({ ok: true, code: 1, stdout: 'out', stderr: 'no such command\n' });
  await assert.rejects(failing, (error) => error.code === 1 && error.stdout === 'out' && /no such command/.test(error.message));

  // Files: a missing one is null; other errors pass through.
  const missing = distro.readFile('/a');
  answer({ ok: false, code: 'ENOENT', error: 'missing' });
  assert.equal(await missing, null);
  const denied = distro.mtime('/b');
  answer({ ok: false, code: 'EACCES', error: 'denied' });
  await assert.rejects(denied, /denied/);
  const read = distro.readFile('/c');
  answer({ ok: true, data: Buffer.from('text').toString('base64') });
  assert.equal(await read, 'text');
  const written = distro.writeFile('/d', 'hi');
  assert.equal(Buffer.from(sent.at(-1).data, 'base64').toString(), 'hi');
  answer({ ok: true });
  await written;
  const listed = distro.listFiles('/e');
  answer({ ok: true, names: ['f'] });
  assert.deepEqual(await listed, ['f']);
  const removed = distro.removeFile('/g');
  assert.equal(sent.at(-1).op, 'remove');
  answer({ ok: true });
  await removed;
  const stat = distro.mtime('/h');
  answer({ ok: true, mtimeMs: 5 });
  assert.equal(await stat, 5);

  // Lines that are not JSON, and answers nobody waits for, are ignored.
  distro.onLine('not json');
  distro.onLine(JSON.stringify({ id: 999, ok: true }));
});

test('WslDistro passes on the events of its agent, and changes to the watch they belong to', async () => {
  const { distro, sent, answer } = fakeAgent();
  const events = [];
  for (const name of ['request', 'proc-exit', 'instance-exit', 'output']) distro.on(name, (...args) => events.push([name, ...args]));
  distro.onLine(JSON.stringify({ event: 'request', route: '/hook', tab: 't1', proc: 7, body: '{}' }));
  distro.onLine(JSON.stringify({ event: 'proc-exit', proc: 7 }));
  distro.onLine(JSON.stringify({ event: 'exit', name: 'cs', code: 0 }));
  distro.onLine(JSON.stringify({ event: 'output', name: 'cs', text: 'hi' }));
  distro.onLine(JSON.stringify({ event: 'unknown' }));
  assert.deepEqual(events, [['request', '/hook', 't1', 7, '{}'], ['proc-exit', 7], ['instance-exit', 'cs', 0], ['output', 'cs', 'hi']]);

  const changes = [];
  const watching = distro.watch(['/repo'], (folder, file) => changes.push([folder, file]));
  const name = sent.at(-1).name;
  answer({ ok: true });
  const stop = await watching;
  distro.onLine(JSON.stringify({ event: 'change', name, folder: '/repo', file: 'a' }));
  assert.deepEqual(changes, [['/repo', 'a']]);
  stop();
  assert.deepEqual(sent.at(-1), { id: sent.at(-1).id, op: 'unwatch', name });
  answer({ ok: true });
  distro.onLine(JSON.stringify({ event: 'change', name, folder: '/repo', file: 'b' }));
  assert.equal(changes.length, 1);

  // A watch the agent refuses is forgotten.
  const refused = distro.watch(['/x'], () => {});
  answer({ ok: false, error: 'no' });
  await assert.rejects(refused, /no/);
  assert.equal(distro.watchers.size, 0);
});

test('WslDistro rejects requests with no agent, and those its agent does not answer in time', async () => {
  const { WslDistro } = require('../src/wsl/wsl');
  await assert.rejects(new WslDistro('Ubuntu').request({ op: 'read' }), /not running/);
  await new WslDistro('Ubuntu').stopAgent();
  const { distro } = fakeAgent();
  await assert.rejects(distro.request({ op: 'read' }, 10), /does not answer \(read\)/);
  assert.equal(distro.pending.size, 0);
});

test('WslDistro.env turns on UTF-8 messages and passes no variables into the distribution', () => {
  const { WslDistro } = require('../src/wsl/wsl');
  const saved = process.env.WSLENV;
  process.env.WSLENV = 'FOO';
  try {
    const env = WslDistro.env();
    assert.equal(env.WSL_UTF8, '1');
    assert.equal(env.WSLENV, undefined);
  } finally {
    if (saved === undefined) delete process.env.WSLENV;
    else process.env.WSLENV = saved;
  }
});
