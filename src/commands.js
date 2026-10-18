// Shared command execution for local and WSL callers, independent of repository discovery.
const childProcess = require('child_process');
const path = require('path');
const { parseWslPath, windowsPath, wslDistro } = require('./wsl/wsl');

function createCommandRunner({ execFile = childProcess.execFile, distro = wslDistro } = {}) {
  // Runs a command and resolves its output. `input`, when given, is written to its standard input;
  // `cwd`: the folder it runs in (the app's own when not given); `env`: variables to set besides
  // the app's own. When it fails, the error has its output too (error.stdout): gh writes GitHub's
  // answer even when the answer has errors.
  /**
   * @param {string} command
   * @param {string[]} args
   * @param {number} [timeout]
   * @param {{ input?: string | Buffer | null, cwd?: string, env?: Record<string, string> | null }} [options]
   * @returns {Promise<string>}
   */
  function run(command, args, timeout = 15000, { input = null, cwd, env = null } = {}) {
    const options = { cwd, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...(env ? { env: { ...process.env, ...env } } : {}) };
    return new Promise((resolve, reject) => {
      const child = execFile(command, args, options, (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      });
      if (input === null) return;
      // A command that exits before reading it all breaks the pipe; its exit says what happened.
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
  }

  // What git said went wrong (its last fatal:/error: line), else the error's own message.
  function gitMessage(error) {
    const lines = String(error.stderr || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const said = lines.filter((line) => /^(fatal|error):/.test(line)).pop() || lines.pop();
    return said ? said.replace(/^(fatal|error):\s*/, '') : error.message;
  }

  // Runs a command where `folder` is: in its distribution for a folder in WSL (the Windows git
  // cannot read a repository there: "detected dubious ownership"), else here. shellEnv: with the
  // user's shell environment in WSL, for commands that the shell's start-up files put on PATH.
  // input: written to its standard input. cwd: the folder it runs in here (in WSL, the home
  // folder). env: variables to set for it; in WSL through env(1), as none of the app's variables
  // cross into the distribution.
  /**
   * @param {string} folder
   * @param {string} command
   * @param {string[]} args
   * @param {number} [timeout]
   * @param {{ shellEnv?: boolean, input?: string | null, cwd?: string, env?: Record<string, string> | null }} [options]
   * @returns {Promise<string>}
   */
  function runAt(folder, command, args, timeout = 15000, { shellEnv = false, input = null, cwd, env = null } = {}) {
    const wsl = parseWslPath(folder);
    if (wsl) {
      const set = Object.entries(env || {}).map(([key, value]) => `${key}=${value}`);
      const [program, programArgs] = set.length ? ['env', [...set, command, ...args]] : [command, args];
      return distro(wsl.distro).exec(program, programArgs, { timeout, shellEnv, input });
    }
    return run(command, args, timeout, { input, cwd, env });
  }

  // A path as the commands that runAt starts for it see it: the Linux path of a folder in WSL.
  function hostPath(p) {
    const wsl = parseWslPath(p);
    return wsl ? wsl.path : p;
  }

  // A path that a command run for `folder` printed, as the app keeps it.
  function localPath(folder, p) {
    const wsl = parseWslPath(folder);
    return wsl ? windowsPath(wsl.distro, p) : path.resolve(p);
  }

  // git on the repository or worktree at `folder`, with `input` on its standard input if given.
  function runGit(folder, args, timeout, input = null) {
    return runAt(folder, 'git', ['-C', hostPath(folder), ...args], timeout, { input });
  }


  return { run, runAt, runGit, hostPath, localPath, gitMessage };
}

module.exports = { ...createCommandRunner(), createCommandRunner };
