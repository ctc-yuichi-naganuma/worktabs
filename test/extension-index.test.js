const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseExtensionIndex, readExtensionIndex, readExtensionIndexSync, validRelativeLocation } = require('../src/code-server/extension-index');
const { writeLanguagePacks, localFiles, CodeServerManager } = require('../src/code-server/code-server');
const { installedVersions } = require('../src/code-server/code-server-wsl');
const { extensionBinary } = require('../src/agents/agent-cli');
const { tempDir } = require('./support');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'extension-index.json'), 'utf8');

test('inventory normalizes IDs and exposes targets, versions, original identifiers and invalid locations', () => {
  const inventory = parseExtensionIndex(fixture);
  assert.equal(inventory.byId.get('openai.chatgpt').originalId, 'OpenAI.ChatGPT');
  assert.equal(inventory.byId.get('openai.chatgpt').version, '1.0.0');
  assert.equal(inventory.byId.get('anthropic.claude-code').targetPlatform, 'darwin-universal');
  assert.equal(inventory.byId.get('acme.universal').targetPlatform, 'universal');
  assert.equal(inventory.byId.get('acme.universal').declaredTargetPlatform, undefined);
  assert.equal(inventory.byId.get('acme.legacy').targetPlatform, 'undefined');
  assert.equal(inventory.byId.get('acme.escaping').validLocation, false);
  assert.equal(inventory.byId.size, 5);
  assert.deepEqual(installedVersions(fixture), inventory.versions);
});

test('corrupt lists fail at the parser boundary while callers can tolerate malformed entries', () => {
  assert.throws(() => parseExtensionIndex('broken'), SyntaxError);
  for (const text of ['{}', 'null', '123']) assert.throws(() => parseExtensionIndex(text), { code: 'INVALID_EXTENSION_INDEX' });
  assert.equal(parseExtensionIndex('[null, [], 123]').entries.length, 0);
  assert.throws(() => parseExtensionIndex('[null]', { strict: true }), { code: 'INVALID_EXTENSION_INDEX' });
  assert.equal(installedVersions('broken').size, 0);
  assert.equal(parseExtensionIndex(null).available, false);
  assert.equal(parseExtensionIndex('[]').available, true);
  for (const location of ['', '../escape', 'x/../escape', '..\\escape', '/root', '\\root', 'C:relative', 'C:\\absolute']) assert.equal(validRelativeLocation(location), false);
  assert.equal(validRelativeLocation('extension/subfolder'), true);
});

test('local and injected WSL readers take fresh snapshots after an active-index replacement', async (t) => {
  const root = tempDir(t); const index = path.join(root, 'extensions.json');
  assert.equal(readExtensionIndexSync(root).available, false);
  fs.writeFileSync(index, fixture);
  assert.equal(readExtensionIndexSync(root).byId.get('openai.chatgpt').relativeLocation, 'codex-current');
  let data = fixture; let reads = 0;
  const files = { join: path.posix.join, read: async (file) => { assert.equal(file, '/extensions/extensions.json'); reads++; return data; } };
  assert.equal((await readExtensionIndex(files, '/extensions')).versions.get('openai.chatgpt'), '1.0.0');
  data = JSON.stringify([{ identifier: { id: 'OpenAI.ChatGPT' }, version: '0.9.0', relativeLocation: 'restored' }]);
  fs.writeFileSync(index, data);
  assert.equal(readExtensionIndexSync(root).byId.get('openai.chatgpt').relativeLocation, 'restored');
  assert.equal((await readExtensionIndex(files, '/extensions')).versions.get('openai.chatgpt'), '0.9.0');
  assert.equal(reads, 2);
});

test('language packs and installation checks use the same active snapshot and skip escaping locations', async (t) => {
  const root = tempDir(t); const user = path.join(root, 'user'); const extensions = path.join(root, 'extensions');
  fs.mkdirSync(extensions); const location = path.join(extensions, 'pack-current'); fs.mkdirSync(location);
  fs.writeFileSync(path.join(extensions, 'extensions.json'), JSON.stringify([
    { identifier: { id: 'MS-CEINTL.Vscode-language-pack-ja' }, version: '1.2.3', relativeLocation: 'pack-current' },
    { identifier: { id: 'Acme.Escape' }, relativeLocation: '../outside' }, null,
  ]));
  fs.writeFileSync(path.join(location, 'package.json'), JSON.stringify({ version: '1.2.3', contributes: { localizations: [{ languageId: 'ja', localizedLanguageName: '日本語', translations: [{ id: 'vscode', path: 'translations/main.json' }] }] } }));
  await writeLanguagePacks(localFiles, user, extensions);
  const pack = JSON.parse(fs.readFileSync(path.join(user, 'languagepacks.json'))).ja;
  assert.equal(pack.extensions[0].extensionIdentifier.id, 'MS-CEINTL.Vscode-language-pack-ja');
  assert.equal(pack.translations.vscode, path.join(location, 'translations', 'main.json'));
  const installed = [];
  await CodeServerManager.prototype.ensureExtensions.call({ extensionsDir: extensions, installExtension: async (id) => installed.push(id) }, ['ms-ceintl.vscode-language-pack-ja', 'new.extension']);
  assert.deepEqual(installed, ['new.extension']);
});

test('CLI and language-pack boundaries distinguish bad data from transport failures', async (t) => {
  const root = tempDir(t); let reads = 0;
  const files = { join: path.join, read: async () => { reads++; throw Object.assign(new Error('denied'), { code: 'EACCES' }); }, write: async () => assert.fail('must not write') };
  await assert.rejects(extensionBinary({ files, extensionsDir: root, agent: 'codex' }), { code: 'EACCES' });
  await assert.rejects(writeLanguagePacks(files, root, root), { code: 'EACCES' });
  assert.equal(reads, 2);
  for (const text of [null, '{}', 'broken']) await writeLanguagePacks({ ...files, read: async () => text }, root, root);
});
