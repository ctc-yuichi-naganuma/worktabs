const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createCloneCoordinator } = require('../src/repos/clone-coordinator');
const { repoKey } = require('../src/repos/clone');

const repo = { url: 'https://github.com/octo/hello', host: 'github.com', owner: 'octo', name: 'hello', visibility: 'private' };
const root = path.resolve('test-clones');
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)); };

function setup(overrides = {}, { config: configOverrides = {}, list = [], ghqDistros = [] } = {}) {
  const calls = [];
  const opened = [];
  let current = null;
  const config = { repoSources: ['ghq'], repos: [], hiddenGithubOwners: [], cloneRoot: '', ...configOverrides };
  const repositories = {
    owned: [repo],
    ghqDistros: new Map(ghqDistros),
    list,
    remotes: new Map(),
    add: (...args) => calls.push(['add', ...args]),
  };
  const cloning = new Set();
  const dialogs = {
    get current() { return current; },
    has: (test) => Boolean(current) && test(current),
    open: (options) => { opened.push(options); current = options; },
    close: () => { current = null; },
  };
  const coordinator = createCloneCoordinator({
    config, repositories, cloning, dialogs,
    saveConfig: (_config, keys) => calls.push(['save', keys]),
    messageBox: async (options) => { calls.push(['message', options.message]); return { response: 0 }; },
    pushState: () => calls.push(['push', [...cloning]]),
    sendRepos: () => calls.push(['send']),
    refreshRepos: () => calls.push(['refresh']),
    cloned: (folder) => calls.push(['cloned', folder]),
    log: (line) => calls.push(['log', line]),
    pickFolder: async () => null,
    windowOpen: () => true,
    hasGhq: async () => false,
    gitProtocol: async () => 'https',
    cloneRepo: async (_repo, { dest }) => dest || path.join(root, 'github.com', 'octo', 'hello'),
    placeFolder: (distro) => (distro ? `\\\\wsl.localhost\\${distro}\\` : null),
    platform: 'linux',
    exists: () => false,
    homedir: () => root,
    ...overrides,
  });
  return { coordinator, calls, opened, config, cloning, dialogs };
}

test('ownedRepo finds the account repository by its address, in any spelling', () => {
  const { coordinator } = setup();
  assert.equal(coordinator.ownedRepo('https://github.com/Octo/Hello.git'), repo);
  assert.equal(coordinator.ownedRepo('https://github.com/octo/other'), null);
  assert.equal(coordinator.ownedRepo('not a url'), null);
});

test('clonePlaces is only here outside Windows', () => {
  const { coordinator } = setup({}, { ghqDistros: [['ubuntu', 'Ubuntu']] });
  assert.deepEqual(coordinator.clonePlaces(), [{ label: '', distro: null }]);
});

test('clonePlaces on Windows adds the distributions the list reads, from ghq and the listed repositories', () => {
  const list = [{ path: '\\\\wsl.localhost\\Arch\\home\\me\\a' }, { path: '\\\\wsl.localhost\\Ubuntu\\home\\me\\b' }];
  const named = setup({ platform: 'win32' }, { config: { repoSources: ['ghq', 'wsl:ubuntu'] }, list, ghqDistros: [['debian', 'Debian']] });
  assert.deepEqual(named.coordinator.clonePlaces(), [{ label: 'Windows', distro: null }, { label: 'WSL: Ubuntu', distro: 'Ubuntu' }]);
  const every = setup({ platform: 'win32' }, { config: { repoSources: ['wsl'] }, list, ghqDistros: [['debian', 'Debian']] });
  assert.deepEqual(every.coordinator.clonePlaces().map((place) => place.distro), [null, 'Arch', 'Debian', 'Ubuntu']);
});

test('startClone clones with ghq where it is installed, and the repository joins the list from ghq', async () => {
  const { coordinator, calls, cloning } = setup({ hasGhq: async () => true });
  await coordinator.startClone(repo, { label: '', distro: null });
  await settle();
  const folder = path.join(root, 'github.com', 'octo', 'hello');
  assert.deepEqual(calls.find((call) => call[0] === 'add'), ['add', folder, 'ghq', { provider: 'github', url: repo.url, visibility: 'private', current: null }]);
  assert.ok(calls.some((call) => call[0] === 'cloned' && call[1] === folder));
  assert.ok(!calls.some((call) => call[0] === 'save'));
  assert.equal(cloning.size, 0);
  assert.deepEqual(calls.find((call) => call[0] === 'push'), ['push', [repoKey(repo.url)]]);
});

test('a clone with ghq that the list does not read is added to config.repos', async () => {
  const { coordinator, calls, config } = setup({ hasGhq: async () => true }, { config: { repoSources: [] } });
  await coordinator.startClone(repo, { label: '', distro: null });
  await settle();
  const folder = path.join(root, 'github.com', 'octo', 'hello');
  assert.deepEqual(config.repos, [folder]);
  assert.ok(calls.some((call) => call[0] === 'save' && call[1][0] === 'repos'));
  assert.equal(calls.find((call) => call[0] === 'add')[2], 'config');
});

test('startClone without ghq asks where in the dialog, from where the listed repositories are', async () => {
  const list = [{ path: path.join(root, 'work', 'one'), git: true }, { path: path.join(root, 'work', 'two'), git: true }];
  const { coordinator, opened, cloning } = setup({}, { list });
  await coordinator.startClone(repo, { label: '', distro: null });
  assert.equal(cloning.size, 0);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].kind, 'clone');
  assert.equal(opened[0].slug, 'octo/hello');
  assert.equal(opened[0].dest, path.join(root, 'work', 'hello'));
  assert.deepEqual(opened[0].choices, [{ dest: path.join(root, 'work', 'hello'), count: 2 }]);
  // While it is up, another clone does not start.
  await coordinator.startClone(repo, { label: '', distro: null });
  assert.equal(opened.length, 1);
});

test('a failed clone says what git said and is no longer marked as being cloned', async () => {
  const error = Object.assign(new Error('clone failed'), { stderr: 'fatal: repository not found\n' });
  const { coordinator, calls, cloning } = setup({ hasGhq: async () => true, cloneRepo: async () => { throw error; } });
  await coordinator.startClone(repo, { label: '', distro: null });
  await settle();
  assert.equal(cloning.size, 0);
  assert.ok(calls.some((call) => call[0] === 'log' && call[1] === `clone ${repo.url}: clone failed`));
  assert.ok(calls.some((call) => call[0] === 'message'));
  assert.ok(!calls.some((call) => call[0] === 'add'));
});

test('the dialog requests answer only while the clone dialog is in front', async () => {
  const { coordinator } = setup();
  const closed = { error: 'The dialog that asks where to clone is closed' };
  assert.deepEqual(coordinator.dialogRequests.check('/x'), closed);
  assert.deepEqual(coordinator.dialogRequests.start('/x'), closed);
  assert.deepEqual(await coordinator.dialogRequests.browse('/x'), closed);
});

test('Clone in the dialog checks the folder, remembers its root, and clones there once', async () => {
  const { coordinator, calls, config, dialogs } = setup();
  dialogs.open({ kind: 'clone', url: repo.url, slug: 'octo/hello' });
  assert.equal(coordinator.dialogRequests.check('').error, 'Enter the folder to clone into');
  assert.equal(coordinator.dialogRequests.check('relative').error, 'Enter a full path');
  const dest = path.join(root, 'work', 'hello');
  assert.deepEqual(coordinator.dialogRequests.check(dest), { dest, distro: null, linux: null, error: null });
  assert.deepEqual(coordinator.dialogRequests.start(dest), {});
  assert.equal(config.cloneRoot, path.join(root, 'work'));
  assert.deepEqual(coordinator.dialogRequests.start(dest), { error: 'This repository is being cloned' });
  await settle();
  assert.equal(calls.find((call) => call[0] === 'add')[1], dest);
  assert.equal(calls.find((call) => call[0] === 'add')[2], 'config');
});

test('Browse in the dialog opens near the folder written, and puts the repository under the one picked', async () => {
  const picked = [];
  const near = path.join(root, 'work');
  const { coordinator, dialogs } = setup({
    exists: (folder) => folder === near,
    pickFolder: async (options) => { picked.push(options); return picked.length === 1 ? path.join(root, 'elsewhere') : null; },
  });
  dialogs.open({ kind: 'clone', url: repo.url, slug: 'octo/hello' });
  assert.deepEqual(await coordinator.dialogRequests.browse(path.join(near, 'missing', 'hello')), { dest: path.join(root, 'elsewhere', 'hello') });
  assert.equal(picked[0].defaultPath, near);
  assert.equal(picked[0].title, 'Where to clone octo/hello');
  assert.deepEqual(await coordinator.dialogRequests.browse(''), { dest: null });
  assert.equal(picked[1].defaultPath, root);
});

test('hideOwner keeps the owner out once, and redraws the list', () => {
  const { coordinator, calls, config } = setup();
  coordinator.hideOwner('github.com', 'octo');
  coordinator.hideOwner('github.com', 'Octo');
  assert.deepEqual(config.hiddenGithubOwners, ['octo']);
  assert.equal(calls.filter((call) => call[0] === 'save').length, 1);
  assert.equal(calls.filter((call) => call[0] === 'send').length, 2);
});
