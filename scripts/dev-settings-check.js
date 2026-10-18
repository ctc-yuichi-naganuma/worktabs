// VS Code settings shared by a repository's worktree tabs: changes settings in one
// tab's VS Code, and checks that another running tab of the repository takes them at once (its
// VS Code and the side bar switch theme), that a suspended one gets them when it starts again,
// that a worktree added from the side bar starts with them, and that a removed setting goes from
// every tab. Adds a worktree to the repository and removes it again, so use a repository made
// for the check.
//
// usage: node scripts/dev-settings-check.js <main worktree> <another worktree of it>
// with WORKTABS_DATA_DIR set as for the app.
const fs = require('fs');
const path = require('path');
const { parseJsonc } = require('../src/code-server/jsonc');
const { repoIdFor } = require('../src/code-server/settings-sync');
const { call, log, run, sleep, until } = require('./dev-lib');

const DATA_DIR = process.env.WORKTABS_DATA_DIR || path.join(process.env.APPDATA, 'Worktabs');
const [REPO, OTHER] = process.argv.slice(2).map((folder) => path.resolve(folder));

const settingsFile = (id) => path.join(DATA_DIR, 'instances', id, 'User', 'settings.json');
const settingsOf = (id) => parseJsonc(fs.readFileSync(settingsFile(id), 'utf8'));
const sharedSettings = () => parseJsonc(fs.readFileSync(path.join(DATA_DIR, 'repos', repoIdFor(REPO), 'settings.json'), 'utf8'));

// Settings changed in the tab's VS Code (key -> value, undefined removes one), as its Settings
// editor changes them: through the configuration API, which the helper extension calls.
function change(id, changes) {
  const set = {};
  const remove = [];
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) remove.push(key);
    else set[key] = value;
  }
  return until(`${id}'s helper extension to set ${Object.keys(changes).join(', ')}`, () =>
    call('helper', { id, route: '/settings', body: { set, remove } }),
  );
}

// The kind of theme the tab's VS Code shows: 'vs' (light), 'vs-dark', 'hc-light' or 'hc-black'.
const themeKind = (id) =>
  call('eval', { id, js: "['vs', 'vs-dark', 'hc-light', 'hc-black'].find((c) => document.querySelector('.monaco-workbench')?.classList.contains(c)) || null" });

// Waits until the tab's VS Code is up and shows the theme of its settings: it first shows the
// default theme, for a moment.
async function running(id) {
  await until(`${id} to run`, async () => (await call('state')).tabs.find((t) => t.id === id)?.server === 'running');
  let last = null;
  await until(`${id} to settle on a theme`, async () => {
    const kind = await themeKind(id);
    const settled = kind && kind === last;
    last = kind;
    return settled;
  }, 60000, 2000);
  // Its helper extension has told the app where it listens.
  await until(`${id}'s helper extension`, () => call('helper', { id, route: '/settings', body: {} }));
  return id;
}

run(async () => {
  const a = await running(await call('open', { folder: REPO }));
  const b = await running(await call('open', { folder: OTHER }));
  const before = await themeKind(b);
  const [kind, theme, scheme] = before === 'vs' ? ['vs-dark', 'Default Dark Modern', 'dark'] : ['vs', 'Default Light Modern', 'light'];

  log(`${b} shows ${before}; setting ${theme} in ${a}`);
  const changed = Date.now();
  await change(a, { 'window.autoDetectColorScheme': false, 'workbench.colorTheme': theme, 'editor.fontSize': 17 });
  await until(`${b} to show ${kind}`, async () => (await themeKind(b)) === kind, 20000, 200);
  log(`${b} shows ${kind} after ${Date.now() - changed} ms`);
  await until(`the side bar to be ${scheme}`, async () => (await call('state')).theme?.scheme === scheme, 10000, 300);
  log(`the side bar is ${scheme}`);
  await until(`${b} to have editor.fontSize 17`, async () => settingsOf(b)['editor.fontSize'] === 17, 10000, 200);

  await call('suspend', { id: b });
  await change(a, { 'editor.fontSize': 18 });
  await sleep(1500);
  log(`${b} suspended; its file has editor.fontSize ${settingsOf(b)['editor.fontSize']}`);
  await call('activate', { id: b });
  await running(b);
  if (settingsOf(b)['editor.fontSize'] !== 18) throw new Error(`${b} restarted with editor.fontSize ${settingsOf(b)['editor.fontSize']}`);
  log(`${b} restarted with editor.fontSize 18`);

  const added = await call('addWorktree', { repo: REPO, name: `settings-check-${Date.now()}` });
  if (added.error) throw new Error(added.error);
  const c = (await call('state')).tabs.find((t) => t.folder.toLowerCase() === added.folder.toLowerCase()).id;
  await running(c);
  if ((await themeKind(c)) !== kind || settingsOf(c)['editor.fontSize'] !== 18) {
    throw new Error(`the new worktree's tab shows ${await themeKind(c)} with editor.fontSize ${settingsOf(c)['editor.fontSize']}`);
  }
  log(`the new worktree's tab ${c} starts with ${kind} and editor.fontSize 18`);

  await change(a, { 'editor.fontSize': undefined });
  await until('editor.fontSize to go from every tab', async () => [b, c].every((id) => !Object.hasOwn(settingsOf(id), 'editor.fontSize')), 10000, 200);
  log('editor.fontSize removed everywhere');

  const failed = await call('removeWorktree', { folder: added.folder, deleteBranch: true });
  if (failed) throw new Error(failed);
  // VS Code writes the theme's id as it names it now ('Default Dark Modern' becomes 'Dark Modern').
  const shown = settingsOf(b)['workbench.colorTheme'];
  if (!shown || sharedSettings()['workbench.colorTheme'] !== shown) throw new Error('the shared settings lost the theme with the worktree');
  log('removed the new worktree; the repository keeps its settings');

  await change(a, { 'window.autoDetectColorScheme': true, 'workbench.colorTheme': undefined });
  await until(`${b} to follow the OS's theme again`, async () => {
    const settings = settingsOf(b);
    return settings['window.autoDetectColorScheme'] === true && !Object.hasOwn(settings, 'workbench.colorTheme');
  }, 10000, 200);
  log(`${b} follows the OS's theme again: it shows ${await themeKind(b)}`);
  log('OK');
});
