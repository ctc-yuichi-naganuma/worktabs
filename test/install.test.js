// Which code-server release the app downloads for the machine it runs on, and how it unpacks it.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { serverNode } = require('../src/code-server/code-server');
const { downloadRelease, ensureCodeServer, releaseName, removeOldCodeServers, tarCommand } = require('../src/code-server/install');
const { tempDir } = require('./support');

test('releaseName names the release for the platform and the architecture', () => {
  assert.equal(releaseName('4.139.1', null, { platform: 'win32', arch: 'x64' }), 'code-server-4.139.1-windows-amd64');
  assert.equal(releaseName('4.139.1', null, { platform: 'darwin', arch: 'arm64' }), 'code-server-4.139.1-macos-arm64');
  assert.equal(releaseName('4.139.1', null, { platform: 'darwin', arch: 'x64' }), 'code-server-4.139.1-macos-amd64');
  // Nothing to download: the app then asks for a code-server in the settings. There is no
  // Windows release for arm64, and the app does not run on Linux itself (WSL is below).
  assert.equal(releaseName('4.139.1', null, { platform: 'win32', arch: 'arm64' }), null);
  assert.equal(releaseName('4.139.1', null, { platform: 'linux', arch: 'x64' }), null);
  assert.equal(releaseName('4.139.1', null, { platform: 'darwin', arch: 'ia32' }), null);
  // A tab in WSL takes the Linux release, whatever this machine is.
  assert.equal(releaseName('4.139.1', 'amd64', { platform: 'darwin', arch: 'arm64' }), 'code-server-4.139.1-linux-amd64');
});

test('tarCommand takes the tar that comes with Windows, and the one on PATH elsewhere', () => {
  assert.equal(tarCommand('darwin'), 'tar');
  assert.match(tarCommand('win32'), /System32[\\/]tar\.exe$/);
});

test('serverNode names the node of an extracted release', () => {
  assert.equal(serverNode(path.join('r', 'code-server'), 'win32'), path.join('r', 'code-server', 'lib', 'node.exe'));
  assert.equal(serverNode(path.join('r', 'code-server'), 'darwin'), path.join('r', 'code-server', 'lib', 'node'));
});

test('downloadRelease keeps an archive downloaded before, without going to the network', async (t) => {
  const dataDir = tempDir(t);
  const archive = path.join(dataDir, 'code-server', 'code-server-4.139.1-linux-amd64.tar.gz');
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.writeFileSync(archive, 'kept');
  // Electron is not loaded here: reaching net.fetch would throw.
  assert.equal(await downloadRelease({ dataDir, version: '4.139.1', name: 'code-server-4.139.1-linux-amd64' }), archive);
  assert.equal(fs.readFileSync(archive, 'utf8'), 'kept');
});

test('ensureCodeServer uses an extracted release and refuses a machine with no release', async (t) => {
  const dataDir = tempDir(t);
  const name = releaseName('4.139.1');
  if (!name) {
    // Linux, where the tests run in CI: there is no release to download for the app itself.
    await assert.rejects(ensureCodeServer({ dataDir, version: '4.139.1' }), /codeServerDir/);
    return;
  }
  const dir = path.join(dataDir, 'code-server', name);
  fs.mkdirSync(path.dirname(serverNode(dir)), { recursive: true });
  fs.writeFileSync(serverNode(dir), '');
  assert.equal(await ensureCodeServer({ dataDir, version: '4.139.1' }), dir);
});

test('removeOldCodeServers removes the releases it is not told to keep, and nothing else', (t) => {
  const dataDir = tempDir(t);
  const root = path.join(dataDir, 'code-server');
  for (const name of ['code-server-4.138.0-linux-amd64', 'code-server-4.139.1-linux-amd64', 'other']) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'code-server-4.139.1-linux-amd64.tar.gz'), '');
  removeOldCodeServers(dataDir, [path.join(root, 'code-server-4.139.1-linux-amd64')]);
  assert.deepEqual(fs.readdirSync(root).sort(), ['code-server-4.139.1-linux-amd64', 'code-server-4.139.1-linux-amd64.tar.gz', 'other']);
  // No code-server folder yet: nothing to do.
  removeOldCodeServers(path.join(dataDir, 'missing'), []);
});
