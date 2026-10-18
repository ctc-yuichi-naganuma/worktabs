// Folders in WSL (\\wsl.localhost\<distribution>\...) and the commands the app runs in their
// distributions. The app keeps such a folder as its UNC path; git, ghq, gh and code-server run
// inside the distribution, where the same folder has its Linux path. Runs no Electron code, so
// the tests can load it.
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const path = require('path');
const readline = require('readline');
const { Readable } = require('stream');
const { t } = require('../i18n');

// \\wsl.localhost\<distribution>\<path> and the older \\wsl$\..., with either slash.
const UNC = /^[\\/]{2}(?:wsl\.localhost|wsl\$)[\\/]+([^\\/]+)(?:[\\/]+(.*))?$/i;

// { distro, path } for a folder in WSL, with its Linux path; null for any other path.
function parseWslPath(p) {
  const match = typeof p === 'string' ? UNC.exec(p) : null;
  if (!match) return null;
  return { distro: match[1], path: path.posix.normalize(`/${(match[2] || '').replace(/\\/g, '/')}`).replace(/(.)\/$/, '$1') };
}

// The Windows path of a Linux path of `distro`: under /mnt/<letter> the Windows drive (as
// `wslpath -w` gives it), elsewhere the distribution's UNC path.
function windowsPath(distro, linuxPath) {
  const parts = path.posix.normalize(linuxPath).split('/').filter(Boolean);
  if (parts[0] === 'mnt' && /^[a-z]$/i.test(parts[1] || '')) return `${parts[1].toUpperCase()}:\\${parts.slice(2).join('\\')}`;
  return `\\\\wsl.localhost\\${distro}\\${parts.join('\\')}`;
}

// One spelling for a folder, so that it names one tab: a WSL folder as \\wsl.localhost\... (a
// drive under /mnt as that drive), anything else resolved.
function normalizeFolder(folder) {
  const wsl = parseWslPath(folder);
  return wsl ? windowsPath(wsl.distro, wsl.path) : path.resolve(folder);
}

// Quotes an argument for a POSIX shell.
function shellQuote(arg) {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${String(arg).replace(/'/g, "'\\''")}'`;
}

// Runs a command with the environment of the user's shell (interactive and login, as the
// terminal and VS Code's extension host get their environment) from a plain sh. The shell's own
// start-up output goes before `mark`, the command's after it.
// The user's shell parses only fixed text: it may not quote as POSIX does (fish takes \' inside
// single quotes), and the arguments carry issue titles. The command line goes through the
// environment to a plain sh, which runs it.
function shellScript(command, args, mark) {
  const line = `unset WORKTABS_EXEC; printf '\\n%s\\n' ${mark}; exec ${[command, ...args].map(shellQuote).join(' ')}`;
  return [
    'sh',
    '-c',
    `WORKTABS_EXEC=$1; export WORKTABS_EXEC; exec "\${SHELL:-/bin/sh}" -i -l -c 'exec /bin/sh -c '"'"'eval "$WORKTABS_EXEC"'"'" </dev/null`,
    'sh',
    line,
  ];
}

// What the command wrote after `mark` (see shellScript).
function afterMark(stdout, mark) {
  const at = stdout.indexOf(`\n${mark}\n`);
  return at < 0 ? stdout : stdout.slice(at + mark.length + 2);
}

// A command that failed, with what it wrote: as `run` in worktrees.js rejects.
function commandError(command, code, stderr, stdout = '') {
  /** @type {Error & { code?: number | null, stdout?: string, stderr?: string }} */
  const error = new Error(`Command failed: ${command} (exit ${code})${stderr ? `\n${stderr.trim()}` : ''}`);
  error.code = code;
  error.stdout = stdout;
  error.stderr = stderr;
  return error;
}

// A WSL distribution. Commands go through its agent (wsl-agent.js, started by the code-server
// manager once code-server's node is there) and otherwise through wsl.exe, which costs half a
// second each. Events from the agent: 'request' (route, tabId, pid, raw) for a hook or the
// helper extension, 'proc-exit' (pid), 'instance-exit' (name, code), 'output' (name, text),
// 'agent-exit'.
class WslDistro extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.agent = null;
    this.nextId = 0;
    this.pending = new Map();
    this.watchers = new Map(); // name -> onChange(folder, file)
  }

  // The environment for wsl.exe, with its own messages in UTF-8. Only the variables that WSLENV
  // names cross into the distribution, and the app names none: what code-server there needs
  // goes over the agent's standard input.
  static env() {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env, WSL_UTF8: '1' };
    delete env.WSLENV;
    return env;
  }

  wslArgs(command, args) {
    return ['-d', this.name, '--cd', '~', '-e', command, ...args];
  }

  // Runs a command in the distribution and resolves its standard output; rejects with its
  // standard output and error (error.stdout, error.stderr) and exit code (error.code) when it
  // fails. shellEnv: with the user's shell environment (for commands installed where only the
  // shell's start-up files put them on PATH, such as ghq). input: text for its standard input,
  // without shellEnv.
  async exec(command, args = [], { timeout = 15000, shellEnv = false, input = null } = {}) {
    if (this.agent) {
      const result = await this.request({ op: 'exec', command, args, timeout, shellEnv, input });
      if (result.code !== 0) throw commandError(command, result.code, result.stderr, result.stdout);
      return result.stdout;
    }
    if (!shellEnv) return this.execDirect(command, args, { timeout, input: input === null ? null : Readable.from([Buffer.from(input)]) });
    const mark = crypto.randomBytes(8).toString('hex');
    const [program, ...programArgs] = shellScript(command, args, mark);
    try {
      return afterMark(await this.execDirect(program, programArgs, { timeout }), mark);
    } catch (error) {
      error.stdout = afterMark(error.stdout || '', mark);
      throw error;
    }
  }

  // Runs a command with wsl.exe; `input` goes to its standard input.
  execDirect(command, args, { timeout = 15000, input = null } = {}) {
    return new Promise((resolve, reject) => {
      const child = execFile(
        'wsl.exe',
        this.wslArgs(command, args),
        { env: WslDistro.env(), timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (!error) return resolve(stdout);
          reject(commandError(command, error.code, stderr || error.message, stdout));
        },
      );
      // A command that ends before reading all of its input closes the pipe; the error is its own.
      child.stdin.on('error', () => {});
      if (input) input.pipe(child.stdin);
      else child.stdin.end();
    });
  }

  // Writes a file of the distribution (creating its folder) through wsl.exe, from a stream or
  // a buffer: for the agent itself, before it runs.
  writeDirect(file, data, mode = '644') {
    const input = Buffer.isBuffer(data) || typeof data === 'string' ? Readable.from([Buffer.from(data)]) : data;
    const script = 'mkdir -p "$(dirname "$1")" && cat > "$1.tmp" && chmod "$2" "$1.tmp" && mv -f "$1.tmp" "$1"';
    return this.execDirect('sh', ['-c', script, 'sh', file, mode], { input, timeout: 5 * 60 * 1000 });
  }

  // Starts the agent with `node` (code-server's) and waits until its hook endpoint listens.
  // Resolves the endpoint's port.
  async startAgent(node, agentFile, token) {
    if (this.agent) return this.agent.hookPort;
    const proc = spawn('wsl.exe', this.wslArgs(node, [agentFile]), {
      env: WslDistro.env(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const agent = { proc, node, hookPort: 0, stderr: '' };
    this.agent = agent;
    // Writing to an agent that has just exited fails; its exit rejects what waits on it.
    proc.stdin.on('error', () => {});
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (text) => {
      agent.stderr = (agent.stderr + text).slice(-4000);
    });
    readline.createInterface({ input: proc.stdout }).on('line', (line) => this.onLine(line));
    const gone = (reason) => {
      if (this.agent !== agent) return;
      this.agent = null;
      for (const { reject } of this.pending.values()) reject(new Error(t('The WSL agent ended: {reason}', { reason })));
      this.pending.clear();
      // Its watches ended with it.
      this.watchers.clear();
      this.emit('agent-exit');
    };
    proc.on('exit', (code) => gone(`code ${code}${agent.stderr ? `: ${agent.stderr.trim()}` : ''}`));
    proc.on('error', (error) => gone(error.message));
    const { hookPort } = await this.request({ op: 'init', token });
    agent.hookPort = hookPort;
    return hookPort;
  }

  // Ends the agent: it stops what it started (code-server and everything under it) when its
  // standard input closes. Stopping wsl.exe alone would leave them running in the distribution.
  // Resolves once it has exited.
  /** @returns {Promise<void>} */
  stopAgent() {
    const agent = this.agent;
    if (!agent) return Promise.resolve();
    return new Promise((resolve) => {
      agent.proc.once('exit', () => resolve());
      agent.proc.stdin.end();
    });
  }

  request(message, timeout = 0) {
    const agent = this.agent;
    if (!agent) return Promise.reject(new Error(t('The WSL agent is not running')));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = timeout ? setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(t('The WSL agent does not answer ({op})', { op: message.op })));
      }, timeout) : null;
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      agent.proc.stdin.write(`${JSON.stringify({ id, ...message })}\n`);
    });
  }

  onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message);
      else pending.reject(Object.assign(new Error(message.error || 'failed'), { code: message.code }));
      return;
    }
    switch (message.event) {
      case 'request':
        this.emit('request', message.route, message.tab, message.proc, message.body);
        break;
      case 'proc-exit':
        this.emit('proc-exit', message.proc);
        break;
      case 'exit':
        this.emit('instance-exit', message.name, message.code);
        break;
      case 'output':
        this.emit('output', message.name, message.text);
        break;
      case 'change':
        this.watchers.get(message.name)?.(message.folder, message.file);
        break;
      default:
    }
  }

  // Reads a file through the agent; null when it does not exist.
  async readFile(file) {
    try {
      return Buffer.from((await this.request({ op: 'read', path: file })).data, 'base64').toString('utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  // Writes a file (text or a buffer) through the agent, creating its folder.
  async writeFile(file, data, mode = 0o644) {
    await this.request({ op: 'write', path: file, data: Buffer.from(data).toString('base64'), mode });
  }

  async removeFile(file) {
    await this.request({ op: 'remove', path: file });
  }

  // The files (not folders) in a folder, through the agent; none when it does not exist.
  async listFiles(dir) {
    return (await this.request({ op: 'list', path: dir })).names;
  }

  // When a file was last modified (ms), or null when it does not exist.
  async mtime(file) {
    try {
      return (await this.request({ op: 'stat', path: file })).mtimeMs;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  // Watches folders of the distribution (creating them) through the agent: onChange(folder,
  // name) for each change in one. Resolves a function that stops it.
  async watch(folders, onChange) {
    const name = `w${++this.nextId}`;
    this.watchers.set(name, onChange);
    try {
      await this.request({ op: 'watch', name, folders });
    } catch (error) {
      this.watchers.delete(name);
      throw error;
    }
    return () => {
      if (this.watchers.delete(name)) this.request({ op: 'unwatch', name }).catch(() => {});
    };
  }
}

// One WslDistro per distribution, by name (case-insensitive, as wsl.exe takes it).
const distros = new Map();

function wslDistro(name) {
  const key = name.toLowerCase();
  if (!distros.has(key)) distros.set(key, new WslDistro(name));
  return distros.get(key);
}

// Docker Desktop's distributions have no shell to run ghq in.
const NO_SHELL = new Set(['docker-desktop', 'docker-desktop-data']);

// The names in the output of `wsl.exe -l -q`, one per line. wsl.exe writes UTF-16LE unless
// WSL_UTF8 is set, which older versions ignore; UTF-16 text of these names has NUL bytes.
function parseDistroList(output) {
  const text = output.includes(0) ? output.toString('utf16le') : output.toString('utf8');
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((name) => name && !NO_SHELL.has(name.toLowerCase()));
}

// The distributions installed, from `wsl.exe -l -q`, which does not start WSL. Resolves
// { names, error }. Without wsl.exe, WSL or any distribution (wsl.exe then explains how to
// install one and exits with an error), names is empty; when wsl.exe did not answer in time,
// null: they are not known. Its standard input is closed, so that it cannot wait for a key.
// `command` and `args` are for the tests.
function listDistros({ command = 'wsl.exe', args = ['-l', '-q'], timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    const child = execFile(command, args, { env: WslDistro.env(), timeout, windowsHide: true, encoding: 'buffer' }, (error, stdout) => {
      if (!error) return resolve({ names: parseDistroList(stdout), error: null });
      resolve({ names: error.killed ? null : [], error });
    });
    child.stdin.on('error', () => {});
    child.stdin.end();
  });
}

module.exports = {
  WslDistro,
  afterMark,
  listDistros,
  normalizeFolder,
  parseDistroList,
  parseWslPath,
  shellQuote,
  shellScript,
  windowsPath,
  wslDistro,
};
