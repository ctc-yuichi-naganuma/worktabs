const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { localFiles } = require('../src/code-server/code-server');
const { editJsonc, parseJsonc } = require('../src/code-server/jsonc');
const { SettingsSync, changedSettings, mergeSettings, repoIdFor } = require('../src/code-server/settings-sync');
const { tempDir } = require('./support');

const DEFAULTS = { 'workbench.startupEditor': 'none', 'window.autoDetectColorScheme': true };
const MANAGED = { 'claudeCode.claudeProcessWrapper': 'C:\\app\\claude-wrap.exe', 'claudeCode.initialPermissionMode': 'auto' };
const THEME = 'workbench.preferredDarkColorTheme';

// A SettingsSync on temporary folders. Its watchers are stand-ins: change() writes a file of a
// tab as its VS Code would, tells the tab's watcher, and waits until the change has gone
// everywhere.
function setup(t) {
  const root = tempDir(t);
  const watchers = new Set();
  const files = {
    ...localFiles,
    async watch(folders, onChange) {
      const watcher = { folders, onChange };
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },
  };
  const logs = [];
  const sync = new SettingsSync({ dir: path.join(root, 'repos'), defaults: DEFAULTS, delay: 0, log: (line) => logs.push(line) });
  const userDir = (id) => path.join(root, 'instances', id, 'User');
  const fileOf = (id, rel) => path.join(userDir(id), ...rel.split('/'));
  const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (text === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, text);
  };
  const env = {
    root,
    sync,
    logs,
    watchers,
    files,
    start: (tabId, { repo = 'C:\\repos\\app', managed = MANAGED, unshared = [], worktrees = [], using = files, apply } = {}) =>
      sync.attach({ tabId, repo, files: using, userDir, managed, unshared, worktreeTabs: async () => worktrees, apply }),
    // A stand-in for a tab's running VS Code, which sets settings itself (and writes them to its
    // file), except those in `refuse`.
    vscode: (tabId, refuse = []) => {
      const calls = [];
      const apply = async (changes) => {
        calls.push(changes);
        const taken = Object.fromEntries(Object.entries(changes).filter(([key]) => !refuse.includes(key)));
        env.write(tabId, 'settings.json', editJsonc(env.file(tabId), taken));
        return true;
      };
      return { apply, calls };
    },
    // A tab's file (relative to its User folder), and one of its settings.
    file: (tabId, rel = 'settings.json') => read(fileOf(tabId, rel)),
    settings: (tabId) => parseJsonc(read(fileOf(tabId, 'settings.json'))),
    // The file as the tab's VS Code writes it, before the tab's watcher has seen it.
    write: (tabId, rel, text) => write(fileOf(tabId, rel), text),
    seen: async (tabId, rel = 'settings.json') => {
      const file = fileOf(tabId, rel);
      for (const watcher of [...watchers]) {
        const folder = watcher.folders.find((f) => f === path.dirname(file));
        if (folder) watcher.onChange(folder, path.basename(file));
      }
      await sync.settled();
    },
    change: async (tabId, rel, text) => {
      env.write(tabId, rel, text);
      await env.seen(tabId, rel);
    },
    setSettings: (tabId, changes) => {
      const next = { ...env.settings(tabId), ...changes };
      for (const [key, value] of Object.entries(changes)) if (value === undefined) delete next[key];
      return env.change(tabId, 'settings.json', `${JSON.stringify(next, null, 2)}\n`);
    },
    store: (rel, repo = 'C:\\repos\\app') => read(path.join(root, 'repos', repoIdFor(repo), ...rel.split('/'))),
  };
  return env;
}

// A tab's User folder as an earlier version of the app left it, last written at `time` (s).
function oldTab(env, tabId, time, settings, other = {}) {
  env.write(tabId, 'settings.json', `${JSON.stringify(settings, null, 2)}\n`);
  for (const [rel, text] of Object.entries(other)) env.write(tabId, rel, text);
  for (const rel of ['settings.json', ...Object.keys(other)]) {
    fs.utimesSync(path.join(env.root, 'instances', tabId, 'User', ...rel.split('/')), time, time);
  }
}

test('repoIdFor names one folder for each spelling of a repository', () => {
  const [spelled, respelled] = process.platform === 'win32' ? ['C:\\repos\\App', 'c:/repos/app/'] : ['/repos/App', '/repos/app/'];
  assert.equal(repoIdFor(spelled), repoIdFor(respelled));
  assert.equal(repoIdFor('\\\\wsl$\\Ubuntu\\home\\me\\app'), repoIdFor('\\\\wsl.localhost\\Ubuntu\\home\\me\\app'));
  assert.notEqual(repoIdFor('C:\\repos\\app'), repoIdFor('C:\\repos\\app2'));
  assert.match(repoIdFor('C:\\repos\\app'), /^r[0-9a-f]{10}$/);
});

test('changedSettings lists what differs, removed keys too, and leaves the ignored keys out', () => {
  const from = { a: 1, b: { x: [1, 2], y: 'z' }, c: true, managed: 1 };
  const to = { b: { y: 'z', x: [1, 2] }, c: false, d: null, managed: 2 };
  assert.deepEqual(changedSettings(from, to, new Set(['managed'])), { a: undefined, c: false, d: null });
});

test('mergeSettings fills the defaults and sets the managed settings, keeping comments', async (t) => {
  const file = path.join(tempDir(t), 'User', 'settings.json');
  assert.equal(await mergeSettings(localFiles, file, DEFAULTS, MANAGED), true);
  assert.deepEqual(parseJsonc(fs.readFileSync(file, 'utf8')), { ...DEFAULTS, ...MANAGED });

  fs.writeFileSync(file, '{\n  // mine\n  "window.autoDetectColorScheme": false,\n  "claudeCode.initialPermissionMode": "plan",\n}\n');
  await mergeSettings(localFiles, file, DEFAULTS, { ...MANAGED, 'claudeCode.initialPermissionMode': undefined });
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /\/\/ mine/);
  assert.deepEqual(parseJsonc(text), {
    'window.autoDetectColorScheme': false,
    'workbench.startupEditor': 'none',
    'claudeCode.claudeProcessWrapper': MANAGED['claudeCode.claudeProcessWrapper'],
  });

  fs.writeFileSync(file, '{ "broken": ');
  assert.equal(await mergeSettings(localFiles, file, DEFAULTS, MANAGED), false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ "broken": ');
});

test('the first tab to start makes the shared settings from the worktrees\' tabs', async (t) => {
  const env = setup(t);
  oldTab(env, 'ta', 1000, { [THEME]: 'One Dark Pro', 'editor.fontSize': 14, ...MANAGED }, {
    'keybindings.json': '[{"key": "a"}]',
    'snippets/js.json': '{"a": {}}',
  });
  oldTab(env, 'tb', 2000, { 'editor.fontSize': 16, 'claudeCode.hideOnboarding': true, 'claudeCode.initialPermissionMode': 'plan' }, {
    'keybindings.json': '[{"key": "b"}]',
    'snippets/notes.txt': 'not a snippet file',
  });
  await env.start('tc', { worktrees: ['ta', 'tb', 'tc', 'never-opened'] });

  const shared = {
    [THEME]: 'One Dark Pro',
    'editor.fontSize': 16,
    'claudeCode.hideOnboarding': true,
    ...DEFAULTS,
  };
  assert.deepEqual(parseJsonc(env.store('settings.json')), shared);
  assert.deepEqual(env.settings('tc'), { ...shared, ...MANAGED });
  assert.equal(env.file('tc', 'keybindings.json'), '[{"key": "b"}]');
  assert.equal(env.file('tc', 'snippets/js.json'), '{"a": {}}');
  assert.equal(env.file('tc', 'snippets/notes.txt'), null);
  assert.deepEqual(JSON.parse(env.store('repo.json')), { repo: 'C:\\repos\\app', tabs: ['ta', 'tb', 'tc', 'never-opened'] });

  // The other tabs get them when they start.
  await env.start('ta');
  assert.deepEqual(env.settings('ta'), { ...shared, ...MANAGED });
  assert.equal(env.file('ta', 'keybindings.json'), '[{"key": "b"}]');
});

test('a change in a running tab goes to the other running tabs, which keep their comments', async (t) => {
  const env = setup(t);
  await env.start('ta');
  await env.start('tb');
  await env.change('tb', 'settings.json', env.file('tb').replace('{', '{\n  // my comment'));

  await env.setSettings('ta', { [THEME]: 'Tokyo Night', 'editor.fontSize': 15 });
  assert.equal(env.settings('tb')[THEME], 'Tokyo Night');
  assert.equal(env.settings('tb')['editor.fontSize'], 15);
  assert.match(env.file('tb'), /\/\/ my comment/);
  assert.equal(parseJsonc(env.store('settings.json'))[THEME], 'Tokyo Night');

  // Back to the default: the key goes from every tab.
  await env.setSettings('ta', { 'editor.fontSize': undefined });
  assert.equal(Object.hasOwn(env.settings('tb'), 'editor.fontSize'), false);
  assert.equal(Object.hasOwn(parseJsonc(env.store('settings.json')), 'editor.fontSize'), false);

  // A repository's settings do not reach another's tabs.
  await env.start('tz', { repo: 'C:\\repos\\other' });
  await env.setSettings('ta', { [THEME]: 'Monokai' });
  assert.equal(env.settings('tz')[THEME], undefined);
});

test('a running tab\'s VS Code sets the settings itself, and what it refuses goes into its file', async (t) => {
  const env = setup(t);
  const b = env.vscode('tb', ['unknown.setting']);
  await env.start('tb', { apply: b.apply });
  // Not while it starts: its VS Code reads the file then.
  assert.deepEqual(b.calls, []);
  await env.start('ta');
  assert.deepEqual(b.calls, []);

  await env.setSettings('ta', { [THEME]: 'Tokyo Night', 'unknown.setting': 1, 'editor.fontSize': undefined });
  assert.deepEqual(b.calls, [{ [THEME]: 'Tokyo Night', 'unknown.setting': 1 }]);
  assert.equal(env.settings('tb')[THEME], 'Tokyo Night');
  assert.equal(env.settings('tb')['unknown.setting'], 1);

  // Its own write, once seen, goes nowhere.
  const store = env.store('settings.json');
  await env.seen('tb');
  assert.equal(env.store('settings.json'), store);
  assert.equal(b.calls.length, 1);

  await env.setSettings('ta', { [THEME]: undefined });
  assert.deepEqual(b.calls[1], { [THEME]: undefined });
  assert.equal(Object.hasOwn(env.settings('tb'), THEME), false);
});

test('two tabs changing different settings at once keep both', async (t) => {
  const env = setup(t);
  await env.start('ta');
  await env.start('tb');
  env.write('ta', 'settings.json', JSON.stringify({ ...env.settings('ta'), 'editor.fontSize': 18 }));
  env.write('tb', 'settings.json', JSON.stringify({ ...env.settings('tb'), 'editor.wordWrap': 'on' }));
  await env.seen('ta');
  await env.seen('tb');
  for (const id of ['ta', 'tb']) {
    assert.equal(env.settings(id)['editor.fontSize'], 18);
    assert.equal(env.settings(id)['editor.wordWrap'], 'on');
  }
});

test('a change the tab has made but that has not been seen yet is not overwritten', async (t) => {
  const env = setup(t);
  await env.start('ta');
  await env.start('tb');
  env.write('tb', 'settings.json', JSON.stringify({ ...env.settings('tb'), 'editor.fontSize': 20 }));
  await env.setSettings('ta', { 'editor.fontSize': 10, 'editor.wordWrap': 'on' });
  assert.equal(env.settings('tb')['editor.fontSize'], 20);
  assert.equal(env.settings('tb')['editor.wordWrap'], 'on');
  // Once seen, the later change wins everywhere.
  await env.seen('tb');
  assert.equal(env.settings('ta')['editor.fontSize'], 20);
  assert.equal(parseJsonc(env.store('settings.json'))['editor.fontSize'], 20);
});

test('the managed settings are not shared, and a tab keeps its own while it runs', async (t) => {
  const env = setup(t);
  await env.start('ta');
  await env.start('tb', { managed: { ...MANAGED, 'claudeCode.claudeProcessWrapper': '/home/me/.worktabs/bin/claude-wrap' } });
  await env.setSettings('ta', { 'claudeCode.initialPermissionMode': 'plan', 'claudeCode.claudeProcessWrapper': 'x' });
  assert.equal(env.settings('ta')['claudeCode.initialPermissionMode'], 'plan');
  assert.equal(env.settings('tb')['claudeCode.initialPermissionMode'], 'auto');
  assert.equal(env.settings('tb')['claudeCode.claudeProcessWrapper'], '/home/me/.worktabs/bin/claude-wrap');
  assert.doesNotMatch(env.store('settings.json'), /claudeCode\.(initialPermissionMode|claudeProcessWrapper)/);
  // The next start sets them again.
  await env.start('ta');
  assert.equal(env.settings('ta')['claudeCode.initialPermissionMode'], 'auto');
  assert.equal(env.settings('ta')['claudeCode.claudeProcessWrapper'], MANAGED['claudeCode.claudeProcessWrapper']);
});

test('linked onboarding overrides stay isolated through migration, live changes, and restart', async (t) => {
  const { ONBOARDING_SETTINGS, onboardingSettings } = require('../src/agents/agent-onboarding');
  const key = ONBOARDING_SETTINGS[0];
  for (const first of ['primary', 'linked']) {
    const env = setup(t);
    oldTab(env, 'primary', 1000, { [key]: false, 'editor.fontSize': 14 });
    oldTab(env, 'linked', 2000, { [key]: true, 'editor.fontSize': 16 });
    const options = (id) => ({ unshared: ONBOARDING_SETTINGS, worktrees: ['primary', 'linked'],
      managed: { ...MANAGED, ...onboardingSettings(id !== 'primary') }, apply: env.vscode(id).apply });
    await env.start(first, options(first));
    await env.start(first === 'primary' ? 'linked' : 'primary', options(first === 'primary' ? 'linked' : 'primary'));
    assert.equal(env.settings('primary')[key], false);
    assert.equal(env.settings('linked')[key], true);
    assert.equal(parseJsonc(env.store('settings.json'))[key], undefined);
    await env.setSettings('primary', { [key]: true, 'editor.fontSize': 18 });
    await env.setSettings('linked', { [key]: false });
    assert.equal(env.settings('primary')[key], true);
    assert.equal(env.settings('linked')[key], false);
    assert.equal(env.settings('linked')['editor.fontSize'], 18);
    await env.start('linked', options('linked'));
    assert.equal(env.settings('linked')[key], true);
    assert.equal(env.settings('primary')[key], true);
    await env.start('another', options('another'));
    assert.equal(env.settings('another')[key], true);
  }
});

test('a stale shared onboarding preference is not copied into a new primary', async (t) => {
  const env = setup(t), key = 'claudeCode.hideOnboarding';
  await env.start('old');
  await env.setSettings('old', { [key]: true });
  await env.start('primary', { unshared: [key] });
  assert.equal(env.settings('primary')[key], undefined);
});

test('a tab that stops passes on its last change, and on its next start gets what changed meanwhile', async (t) => {
  const env = setup(t);
  await env.start('ta');
  const b = await env.start('tb');
  // Written just before it stopped; its watcher had not told yet.
  env.write('tb', 'settings.json', JSON.stringify({ ...env.settings('tb'), 'editor.wordWrap': 'on' }));
  b.stop();
  await env.sync.settled();
  assert.equal(env.settings('ta')['editor.wordWrap'], 'on');

  await env.setSettings('ta', { [THEME]: 'Tokyo Night', 'editor.wordWrap': undefined });
  assert.equal(env.settings('tb')[THEME], undefined);
  await env.start('tb');
  assert.equal(env.settings('tb')[THEME], 'Tokyo Night');
  assert.equal(Object.hasOwn(env.settings('tb'), 'editor.wordWrap'), false);
});

test('a tab whose folder went with its worktree takes nothing away, and gets nothing', async (t) => {
  const env = setup(t);
  await env.start('ta');
  const b = await env.start('tb');
  await env.change('ta', 'snippets/js.json', '{"log": {}}');
  fs.rmSync(path.join(env.root, 'instances', 'tb'), { recursive: true });
  b.stop();
  await env.sync.settled();
  assert.equal(env.store('snippets/js.json'), '{"log": {}}');
  assert.ok(env.store('settings.json').includes('workbench.startupEditor'));
  await env.change('ta', 'keybindings.json', '[]');
  assert.equal(fs.existsSync(path.join(env.root, 'instances', 'tb')), false);
});

test('keybindings, snippets and prompts go whole, removals too', async (t) => {
  const env = setup(t);
  await env.start('ta');
  await env.start('tb');
  await env.change('ta', 'keybindings.json', '// mine\n[{"key": "ctrl+k"}]');
  await env.change('ta', 'snippets/js.json', '{"log": {}}');
  await env.change('tb', 'prompts/review.prompt.md', '# Review');
  assert.equal(env.file('tb', 'keybindings.json'), '// mine\n[{"key": "ctrl+k"}]');
  assert.equal(env.file('tb', 'snippets/js.json'), '{"log": {}}');
  assert.equal(env.file('ta', 'prompts/review.prompt.md'), '# Review');

  await env.change('tb', 'snippets/js.json', null);
  assert.equal(env.file('ta', 'snippets/js.json'), null);
  assert.equal(env.store('snippets/js.json'), null);

  // A tab starting later gets them.
  await env.start('tc');
  assert.equal(env.file('tc', 'keybindings.json'), '// mine\n[{"key": "ctrl+k"}]');
  assert.equal(env.file('tc', 'prompts/review.prompt.md'), '# Review');
});

test('a tab new to the repository adds the settings it alone has, and takes the rest', async (t) => {
  const env = setup(t);
  await env.start('ta');
  await env.setSettings('ta', { [THEME]: 'Tokyo Night' });
  // A folder inside the repository, say, opened before tabs shared their settings.
  oldTab(env, 'td', 5000, { [THEME]: 'One Dark Pro', 'editor.fontSize': 13 }, { 'keybindings.json': '[]' });
  await env.start('td');
  assert.equal(env.settings('td')[THEME], 'Tokyo Night');
  assert.equal(env.settings('ta')['editor.fontSize'], 13);
  assert.equal(env.file('ta', 'keybindings.json'), '[]');
  assert.ok(JSON.parse(env.store('repo.json')).tabs.includes('td'));
});

test('settings that cannot be read are left alone, and pass on what they changed once they can', async (t) => {
  const env = setup(t);
  await env.start('ta');
  await env.start('tb');
  const good = env.file('tb');
  await env.change('tb', 'settings.json', '{ "editor.fontSize": ');
  await env.setSettings('ta', { 'editor.wordWrap': 'on' });
  assert.equal(env.file('tb'), '{ "editor.fontSize": ');

  await env.change('tb', 'settings.json', good.replace('{', '{\n  "editor.fontSize": 12,'));
  assert.equal(env.settings('ta')['editor.fontSize'], 12);
  assert.equal(env.settings('tb')['editor.wordWrap'], 'on');
});

test('an empty or missing settings.json while the tab runs removes nothing', async (t) => {
  const env = setup(t);
  await env.start('ta');
  await env.start('tb');
  await env.setSettings('ta', { [THEME]: 'Tokyo Night' });
  await env.change('tb', 'settings.json', '');
  await env.change('tb', 'settings.json', null);
  assert.equal(env.settings('ta')[THEME], 'Tokyo Night');
  assert.equal(parseJsonc(env.store('settings.json'))[THEME], 'Tokyo Night');
});

test('a tab whose settings cannot be shared starts with its own', async (t) => {
  const env = setup(t);
  const broken = { ...env.files, watch: async () => { throw new Error('no watching here'); } };
  const handle = await env.start('ta', { using: broken });
  handle.stop();
  assert.deepEqual(env.settings('ta'), { ...DEFAULTS, ...MANAGED });
  assert.match(env.logs.join('\n'), /no watching here/);
  await env.start('tb');
  await env.setSettings('tb', { 'editor.fontSize': 11 });
  assert.equal(env.settings('ta')['editor.fontSize'], undefined);
});
