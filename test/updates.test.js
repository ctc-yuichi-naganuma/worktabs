const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('gallery checks skip locked imports while continuing to offer Claude updates', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktabs-updates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'lib', 'vscode'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'vscode', 'package.json'), JSON.stringify({ version: '1.141.0' }));
  fs.writeFileSync(path.join(root, 'extensions.json'), JSON.stringify(['openai.chatgpt', 'acme.imported', 'anthropic.claude-code'].map((id) => ({ identifier: { id }, version: '1.0.0', metadata: { targetPlatform: 'win32-x64' } }))));
  const requests = [];
  const context = vm.createContext({ module: { exports: {} }, AbortSignal, require: (id) => {
    if (id === 'electron') return { net: { fetch: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => ({ extensions: [{ version: '2.0.0', engines: { vscode: '^1.90.0' } }] }) };
    } } };
    if (id.startsWith('.')) return require(path.join(__dirname, '..', 'src', 'code-server', id));
    return require(id);
  } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'code-server', 'updates.js'), 'utf8'), context);
  const { updates, errors } = await context.module.exports.findUpdates({ codeServerVersion: null, codeServerDir: root, extensionsDir: root,
    extensions: ['openai.chatgpt', 'acme.imported', 'anthropic.claude-code'], lockedExtensions: ['openai.chatgpt', 'acme.imported'],
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0], /extensionId=anthropic.claude-code/);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 'anthropic.claude-code');
  assert.equal(updates[0].to, '2.0.0');
  assert.deepEqual([...errors], []);
});

test('code-server releases come through gh, and a GitHub limit does not hide extension updates', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktabs-updates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'lib', 'vscode'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'vscode', 'package.json'), JSON.stringify({ version: '1.141.0' }));
  fs.writeFileSync(path.join(root, 'extensions.json'), JSON.stringify([{ identifier: { id: 'anthropic.claude-code' }, version: '1.0.0', metadata: { targetPlatform: 'win32-x64' } }]));
  const releases = [{ tag_name: 'v4.142.0', draft: false, prerelease: false, assets: [{ name: 'code-server-4.142.0-windows-amd64.tar.gz' }] }];
  const requests = [];
  const limited = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) };
  const context = vm.createContext({ module: { exports: {} }, AbortSignal, require: (id) => {
    if (id === 'electron') return { net: { fetch: async (url) => {
      requests.push(url);
      if (url.startsWith('https://api.github.com/')) return { ok: false, status: 403, headers: { get: (name) => limited[name] ?? null } };
      return { ok: true, json: async () => ({ extensions: [{ version: '2.0.0', engines: { vscode: '^1.90.0' } }] }) };
    } } };
    // The app has release builds for Windows and macOS only; check as on Windows wherever this runs.
    if (id === './install') return { releaseName: (version) => `code-server-${version}-windows-amd64` };
    if (id.startsWith('.')) return require(path.join(__dirname, '..', 'src', 'code-server', id));
    return require(id);
  } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'code-server', 'updates.js'), 'utf8'), context);
  const check =(runGh) => context.module.exports.findUpdates({ codeServerVersion: '4.141.0', codeServerDir: root, extensionsDir: root,
    extensions: ['anthropic.claude-code'], runGh });

  const signedIn = await check(async (args) => {
    assert.deepEqual([...args], ['api', 'repos/coder/code-server/releases?per_page=20']);
    return JSON.stringify(releases);
  });
  assert.deepEqual([...signedIn.updates].map((item) => `${item.id} ${item.from} -> ${item.to}`), ['code-server 4.141.0 -> 4.142.0', 'anthropic.claude-code 1.0.0 -> 2.0.0']);
  assert.deepEqual([...signedIn.errors], []);
  assert.equal(requests.some((url) => url.startsWith('https://api.github.com/')), false);

  const signedOut = await check(async () => { throw new Error('gh: To get started with GitHub CLI, please run: gh auth login'); });
  assert.deepEqual([...signedOut.updates].map((item) => item.id), ['anthropic.claude-code']);
  assert.equal(signedOut.errors.length, 1);
  assert.match(signedOut.errors[0], /GitHub limits requests from this network until .+\. To check sooner, run gh auth login/);
});

test('startup activation follows the active inventory after update and restore', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktabs-activation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [folder, activationEvents] of [['old', ['*']], ['new', ['onStartupFinished']], ['lazy', ['onCommand:test']]]) {
    fs.mkdirSync(path.join(root, folder));
    fs.writeFileSync(path.join(root, folder, 'package.json'), JSON.stringify({ activationEvents }));
  }
  const context = vm.createContext({ module: { exports: {} }, require: (id) => {
    if (id === 'electron') return { net: {} };
    return id.startsWith('.') ? require(path.join(__dirname, '..', 'src', 'code-server', id)) : require(id);
  } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'code-server', 'updates.js'), 'utf8'), context);
  for (const folder of ['old', 'new', 'lazy', 'old']) {
    fs.writeFileSync(path.join(root, 'extensions.json'), JSON.stringify([{ identifier: { id: 'Acme.Extension' }, version: '1.0.0', relativeLocation: folder }]));
    assert.deepEqual([...context.module.exports.startupExtensions(root, ['ACME.EXTENSION'])], folder === 'lazy' ? [] : ['acme.extension']);
  }
  fs.writeFileSync(path.join(root, 'extensions.json'), 'broken');
  assert.deepEqual([...context.module.exports.startupExtensions(root, ['acme.extension'])], []);
});
