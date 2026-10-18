// Runs inside a WSL distribution for Worktabs, with code-server's node. The app starts one per
// distribution through wsl.exe and talks to it over standard input and output, one JSON message
// per line. It spares each command the half second wsl.exe takes, and does in the distribution
// what the app cannot do from Windows:
//   - runs commands (exec), with the user's shell environment when asked;
//   - reads, writes, lists and removes files, and watches folders (the tabs' VS Code settings,
//     which the tabs of a repository share);
//   - starts code-server instances (start) and stops each with everything under it (stop).
//     Stopping wsl.exe from Windows leaves the processes in the distribution running, so the
//     agent also stops them all when its standard input closes: when the app stops it, quits,
//     or is gone;
//   - receives the Claude Code hooks and the helper extension's requests on 127.0.0.1 and passes
//     them on to the app (with WSL's default NAT networking, Windows' 127.0.0.1 cannot be
//     reached from here), and tells the app when a claude process that sent hooks has ended.
//
//   node wsl-agent.js hook
//     Command hook for SessionStart, which cannot use an http hook: posts standard input to
//     WORKTABS_HOOK_URL with the headers the http hooks send. Prints nothing and always exits 0,
//     so it never blocks or decides anything.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const readline = require('readline');

const ROUTES = new Set(['/hook', '/codex', '/helper', '/explore', '/theme']);
// code-server reads these as its own login secret; the app gives each instance its own.
const DROP_ENV = new Set(['PASSWORD', 'HASHED_PASSWORD']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

// ---- Processes ------------------------------------------------------------------------------

// Every process: pid -> { ppid, state }.
function processTable() {
  const table = new Map();
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
      // "pid (name) state ppid ...": the name may hold spaces and parentheses.
      const [state, ppid] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      table.set(Number(entry), { ppid: Number(ppid), state });
    } catch {
      // Gone meanwhile.
    }
  }
  return table;
}

function descendants(pid, table = processTable()) {
  const found = [];
  const pending = [pid];
  while (pending.length) {
    const parent = pending.pop();
    for (const [child, { ppid }] of table) {
      if (ppid !== parent) continue;
      found.push(child);
      pending.push(child);
    }
  }
  return found;
}

// Whether the process runs: a zombie has ended, and only waits for its parent to notice.
function alive(pid) {
  try {
    return !/^Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').pop());
  } catch {
    return false;
  }
}

function signal(pids, name) {
  for (const pid of pids) {
    try {
      process.kill(pid, name);
    } catch {
      // Gone.
    }
  }
}

// Stops a process and everything under it. The tree is read first, since the processes under
// it move to init once their parent is gone; whatever is left after 3 seconds is killed.
async function killTree(pid) {
  const pids = [pid, ...descendants(pid)];
  signal(pids, 'SIGTERM');
  for (let i = 0; i < 30 && pids.some(alive); i++) await sleep(100);
  signal([...pids, ...descendants(pid)].filter(alive), 'SIGKILL');
}

// ---- Commands -------------------------------------------------------------------------------

let shellEnv = null;

// The environment the user's shell sets up as an interactive login shell, as VS Code's server
// resolves it for its extension host: commands installed in places that only the shell's start-up
// files put on PATH (by nvm, say) are found. Resolved once; the plain environment if the shell
// does not answer within 10 seconds.
function userShellEnv() {
  shellEnv ||= new Promise((resolve) => {
    const mark = crypto.randomBytes(8).toString('hex');
    const script = `'${process.execPath}' -e 'process.stdout.write("${mark}" + JSON.stringify(process.env) + "${mark}")'`;
    let out = '';
    let child;
    try {
      child = spawn(process.env.SHELL || '/bin/sh', ['-i', '-l', '-c', script], {
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, VSCODE_RESOLVING_ENVIRONMENT: '1' },
      });
    } catch {
      resolve(process.env);
      return;
    }
    const timer = setTimeout(() => signal([-child.pid], 'SIGKILL'), 10000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (text) => (out += text));
    child.on('error', () => resolve(process.env));
    child.on('close', () => {
      clearTimeout(timer);
      const match = new RegExp(`${mark}(.*)${mark}`, 's').exec(out);
      try {
        const env = JSON.parse(match[1]);
        delete env.VSCODE_RESOLVING_ENVIRONMENT;
        resolve(env);
      } catch {
        resolve(process.env);
      }
    });
  });
  return shellEnv;
}

// Runs a command and answers its output and exit code; `input` goes to its standard input.
async function exec({ command, args = [], timeout = 15000, shellEnv: withShellEnv = false, input = null }) {
  const env = withShellEnv ? await userShellEnv() : process.env;
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(command, args, { env, cwd: os.homedir(), stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    if (input !== null) {
      // A command that exits before reading it all breaks the pipe; its exit says what happened.
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    const timer = timeout ? setTimeout(() => child.kill('SIGKILL'), timeout) : null;
    child.on('error', (error) => done({ code: 127, stdout: '', stderr: error.message }));
    child.on('close', (code, signalName) => done({
      code: code ?? signalName,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

function readFile({ path: file }) {
  return { data: fs.readFileSync(file).toString('base64') };
}

// Writes whole or not at all: to a temporary file first, then renamed over the file.
function writeFile({ path: file, data, mode = 0o644 }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, Buffer.from(data, 'base64'), { mode });
  fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, file);
  return {};
}

function removeFile({ path: file }) {
  fs.rmSync(file, { force: true });
  return {};
}

// The files (not folders) in a folder; none when it does not exist.
function listFiles({ path: dir }) {
  try {
    return { names: fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name) };
  } catch (error) {
    if (error.code === 'ENOENT') return { names: [] };
    throw error;
  }
}

function statFile({ path: file }) {
  return { mtimeMs: fs.statSync(file).mtimeMs };
}

const watches = new Map(); // name -> [FSWatcher]

// Watches folders (creating them), and tells each change in one as a 'change' event.
function watch({ name, folders }) {
  unwatch({ name });
  const watchers = [];
  try {
    for (const folder of folders) {
      fs.mkdirSync(folder, { recursive: true });
      const watcher = fs.watch(folder, (_event, file) => send({ event: 'change', name, folder, file: file || '' }));
      watcher.on('error', () => {});
      watchers.push(watcher);
    }
  } catch (error) {
    for (const watcher of watchers) watcher.close();
    throw error;
  }
  watches.set(name, watchers);
  return {};
}

function unwatch({ name }) {
  for (const watcher of watches.get(name) || []) watcher.close();
  watches.delete(name);
  return {};
}

// ---- Instances ------------------------------------------------------------------------------

const instances = new Map(); // name -> child process

function baseEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!DROP_ENV.has(key)) env[key] = value;
  return env;
}

// Starts a process (a code-server) in a process group of its own, with its output passed on
// as 'output' events and its end as an 'exit' event.
function start({ name, command, args = [], env = {} }) {
  if (instances.has(name)) throw new Error(`${name} is running`);
  const child = spawn(command, args, { env: { ...baseEnv(), ...env }, cwd: os.homedir(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  instances.set(name, child);
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (text) => send({ event: 'output', name, text }));
  }
  let ended = false;
  const end = (code) => {
    if (ended) return;
    ended = true;
    if (instances.get(name) === child) instances.delete(name);
    send({ event: 'exit', name, code });
  };
  child.on('error', (error) => {
    send({ event: 'output', name, text: `${error.message}\n` });
    end(127);
  });
  child.on('exit', (code, signalName) => end(code ?? signalName));
  return { pid: child.pid };
}

async function stop({ name }) {
  const child = instances.get(name);
  if (child?.pid) await killTree(child.pid);
  return {};
}

// ---- Requests from the tabs -----------------------------------------------------------------

let token = null;
let server = null;
// The claude processes that sent hooks, watched so the app hears when one ends.
const watched = new Set();

function listen({ token: given }) {
  token = given;
  if (server) return { hookPort: server.address().port };
  server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !ROUTES.has(req.url) || req.headers['x-wrapper-token'] !== token) {
      res.writeHead(404);
      res.end();
      return;
    }
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      // Empty 2xx: no decision, so permission prompts stay with the extension's UI.
      res.writeHead(200);
      res.end();
      // Node joins repeated custom headers into one string, so only set-cookie is an array.
      const proc = /^\d+$/.test(/** @type {string} */ (req.headers['x-wrapper-proc'] || '')) ? Number(req.headers['x-wrapper-proc']) : null;
      if ((req.url === '/hook' || req.url === '/codex') && proc) watched.add(proc);
      send({ event: 'request', route: req.url.slice(1), tab: req.headers['x-wrapper-tab'] || '', proc, body: raw });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ hookPort: server.address().port }));
  });
}

setInterval(() => {
  for (const pid of watched) {
    if (alive(pid)) continue;
    watched.delete(pid);
    send({ event: 'proc-exit', proc: pid });
  }
}, 2000).unref();

// ---- Main -----------------------------------------------------------------------------------

const OPS = {
  init: listen,
  exec,
  read: readFile,
  write: writeFile,
  remove: removeFile,
  list: listFiles,
  stat: statFile,
  watch,
  unwatch,
  start,
  stop,
};

let stopping = false;

// Stops every instance with everything under it, then exits.
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  server?.close();
  await Promise.all([...instances.values()].map((child) => killTree(child.pid)));
  process.exit(code);
}

async function handle(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, op, ...params } = message;
  try {
    if (!Object.hasOwn(OPS, op)) throw new Error(`unknown op ${op}`);
    send({ id, ok: true, ...(await OPS[op](params)) });
  } catch (error) {
    send({ id, ok: false, error: error.message, code: error.code });
  }
}

function serve() {
  // The app being gone must not end the agent before it has stopped what it started.
  process.stdout.on('error', () => {});
  readline.createInterface({ input: process.stdin }).on('line', handle).on('close', () => shutdown());
  for (const name of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(name, () => shutdown());
  process.on('uncaughtException', (error) => {
    process.stderr.write(`${error.stack}\n`);
    shutdown(1);
  });
}

function postHook() {
  const chunks = [];
  // The session must never wait on the app.
  setTimeout(() => process.exit(0), 3000).unref();
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => {
    const { WORKTABS_HOOK_URL: url, WORKTABS_HOOK_TOKEN, WORKTABS_TAB_ID, WORKTABS_PROC_ID } = process.env;
    if (!url) process.exit(0);
    const body = Buffer.concat(chunks);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        'X-Wrapper-Token': WORKTABS_HOOK_TOKEN || '',
        'X-Wrapper-Tab': WORKTABS_TAB_ID || '',
        'X-Wrapper-Proc': WORKTABS_PROC_ID || '',
      },
    }, (res) => {
      res.resume();
      res.on('end', () => process.exit(0));
    });
    req.on('error', () => process.exit(0));
    req.end(body);
  });
}

if (process.argv[2] === 'hook') postHook();
else serve();
