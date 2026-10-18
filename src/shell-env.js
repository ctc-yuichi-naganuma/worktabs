// The user's shell environment, for an app started from Finder, the Dock or Launchpad on macOS.
// Such an app gets launchd's bare PATH (/usr/bin:/bin:/usr/sbin:/sbin), without what the shell's
// start-up files add (Homebrew's /opt/homebrew/bin, ~/go/bin, nvm): ghq, gh and claude are not
// found, and ghq missing lists no repositories at all. VS Code resolves its environment the same
// way.
const { spawn } = require('child_process');
const crypto = require('crypto');

// Set by the shell or by the way the environment is read, not part of what the app should take.
const SKIPPED = new Set(['_', 'PWD', 'OLDPWD', 'SHLVL', 'ELECTRON_RUN_AS_NODE', 'VSCODE_RESOLVING_ENVIRONMENT']);

// The environment `shell` sets up as an interactive login shell, read by running `execPath` (an
// Electron as node) in it. Output the start-up files print is left out by marks around the JSON.
// null when the shell fails or does not answer within `timeout`.
function readShellEnv({ shell = process.env.SHELL || '/bin/zsh', execPath = process.execPath, env = process.env, timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    const mark = crypto.randomBytes(8).toString('hex');
    const code = `process.stdout.write("${mark}" + JSON.stringify(process.env) + "${mark}")`;
    const script = `'${execPath.replace(/'/g, `'\\''`)}' -e '${code}'`;
    let child;
    try {
      child = spawn(shell, ['-i', '-l', '-c', script], {
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...env, ELECTRON_RUN_AS_NODE: '1', VSCODE_RESOLVING_ENVIRONMENT: '1' },
      });
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    // The shell's group: a start-up file may have started something that holds the pipe.
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }, timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (text) => (out += text));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(parseShellEnv(out, mark));
    });
  });
}

// The environment between the marks in `out`; null when it is not there.
function parseShellEnv(out, mark) {
  const match = new RegExp(`${mark}(.*)${mark}`, 's').exec(out);
  if (!match) return null;
  try {
    const env = JSON.parse(match[1]);
    return env && typeof env === 'object' ? env : null;
  } catch {
    return null;
  }
}

// Takes the shell's environment into `target`, but for what the shell itself sets. The shell's
// PATH goes first, then the folders only the app's own had.
function applyShellEnv(target, env) {
  if (!env) return;
  const appPath = target.PATH;
  for (const [key, value] of Object.entries(env)) {
    if (!SKIPPED.has(key) && typeof value === 'string') target[key] = value;
  }
  if (appPath && env.PATH) {
    const dirs = env.PATH.split(':');
    for (const dir of appPath.split(':')) if (dir && !dirs.includes(dir)) dirs.push(dir);
    target.PATH = dirs.join(':');
  }
}

module.exports = { applyShellEnv, parseShellEnv, readShellEnv };
