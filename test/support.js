// Temporary folders and git repositories for the tests.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A new empty folder, removed after the test. The real path (on Windows, without 8.3 short
// names such as RUNNER~1): git prints resolved paths.
function tempDir(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'worktabs-test-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// Runs git with a fixed identity, so commits work on a machine without one configured.
function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

// A repository with one commit on main, at <dir>/<name>: its worktrees go next to it in <dir>.
function makeRepo(dir, name = 'repo') {
  const repo = path.join(dir, name);
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'first');
  return repo;
}

module.exports = { git, makeRepo, tempDir };
