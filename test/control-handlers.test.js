const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createControlHandlers } = require('../src/window/control-handlers');

function page(name, calls) {
  return {
    name,
    focus: () => calls.push(['focus', name]),
    insertText: (text) => calls.push(['text', name, text]),
    sendInputEvent: (event) => calls.push(['input', name, event]),
    executeJavaScript: async (js) => `${name}: ${js}`,
    capturePage: async () => ({ toPNG: () => `png of ${name}` }),
    mainFrame: {
      framesInSubtree: [
        { url: 'https://x/contrib/webview/browser/pre/index.html', executeJavaScript: async (js) => `webview: ${js}` },
        { url: 'https://x/other.html', executeJavaScript: async () => 'other' },
        { url: 'https://x/contrib/webview/browser/pre/fake.html', executeJavaScript: async () => { throw new Error('gone'); } },
      ],
    },
  };
}

function setup(overrides = {}) {
  const calls = [];
  const sidebar = page('sidebar', calls);
  const dialog = page('dialog', calls);
  const tab = { id: 't1', view: { webContents: page('t1', calls) } };
  const tabs = new Map([['t1', tab]]);
  let focused = null;
  const record = (name) => (...args) => { calls.push([name, ...args]); return name; };
  const handlers = createControlHandlers({
    tabs,
    views: () => ({ sidebar, dialog }),
    focusedContents: () => focused,
    viewState: () => ({ tabs: [] }), sessionsSnapshot: () => ['s'], sessions: { handle: record('hook'), handleCodex: record('codex') },
    language: () => 'en',
    openTab: record('open'), activateTab: record('activate'), closeTab: record('close'),
    closeTabsTogether: record('closeTogether'), suspendTab: record('suspend'), stopRisks: record('risks'),
    checkForUpdates: record('checkUpdates'), revealSession: record('reveal'), archiveSession: record('archive'),
    windowState: () => 'window', setWindowBounds: record('bounds'), layout: () => 'layout',
    addWorktreeTab: record('addWorktree'), addWorktreeDialog: record('addWorktreeDialog'), checkedTask: (task) => task && { checked: task },
    uncloned: () => 'uncloned',
    ownedRepo: (url) => (url === 'https://github.com/o/r' ? { url } : null),
    openCloneDialog: record('cloneDialog'), startClone: record('clone'),
    startFirstConversation: record('first'), firstPrompt: (task) => `prompt ${task}`,
    describeTask: record('describe'), suggestBranch: record('suggest'),
    removalCheck: async (folder) => (folder === 'gone'
      ? { target: null, blockers: [], unshared: 0, ignored: [] }
      : { target: { repo: 'main', branch: 'feature', missing: false }, blockers: ['busy'], unshared: 2, ignored: ['x'], pull: { number: 1 } }),
    removeWorktreeNow: record('remove'),
    messageBox: record('dialog'), callHelper: record('helper'), quit: record('quit'), closeWindow: record('closeWindow'),
    screenshotDir: () => 'logs', writeFile: record('write'),
    webviewFrame: '/contrib/webview/browser/pre/',
    ...overrides,
  });
  return { handlers, calls, tab, sidebar, setFocused: (contents) => { focused = contents; } };
}

test('the tab handlers pass their arguments on with the defaults the checks rely on', async () => {
  const { handlers, calls, tab } = setup();
  assert.deepEqual(handlers.state(), { tabs: [], sessions: ['s'] });
  handlers.open({ folder: 'f' });
  handlers.close({ id: 't1' });
  handlers.suspend({ id: 't1' });
  handlers.closeTogether({ ids: ['t1', 3, null], repo: 7 });
  handlers.codex({ id: 't1', input: {} });
  assert.deepEqual(calls, [
    ['open', 'f', { activate: true }],
    ['close', 't1', { force: true }],
    ['suspend', tab, { force: true }],
    ['closeTogether', ['t1'], null],
    ['codex', 't1', {}, 'wsl:check:100'],
  ]);
});

test('cloning through the control port needs a repository of the account', () => {
  const { handlers, calls } = setup();
  assert.throws(() => handlers.clone({ url: 'https://github.com/o/other' }), /not a repository of the account/);
  assert.throws(() => handlers.cloneDialog({ url: 'nope' }), /not a repository of the account/);
  handlers.clone({ url: 'https://github.com/o/r', distro: 'Ubuntu' });
  handlers.cloneDialog({ url: 'https://github.com/o/r' });
  assert.deepEqual(calls, [
    ['clone', { url: 'https://github.com/o/r' }, { label: '', distro: 'Ubuntu' }],
    ['cloneDialog', { url: 'https://github.com/o/r' }, null],
  ]);
});

test('removalCheck answers in the check scripts\' shape, and removeWorktree removes only a removable one', async () => {
  const { handlers, calls } = setup();
  assert.deepEqual(await handlers.removalCheck({ folder: 'wt' }), { removable: true, branch: 'feature', missing: false, blockers: ['busy'], unshared: 2, ignored: ['x'] });
  assert.deepEqual(await handlers.removalCheck({ folder: 'gone' }), { removable: false, branch: null, missing: false, blockers: [], unshared: 0, ignored: [] });
  await assert.rejects(handlers.removeWorktree({ folder: 'gone' }), /not a removable worktree: gone/);
  await handlers.removeWorktree({ folder: 'wt', deleteBranch: true });
  await handlers.removeWorktree({ folder: 'wt' });
  assert.deepEqual(calls, [
    ['remove', 'main', 'wt', { branch: 'feature', quiet: true }],
    ['remove', 'main', 'wt', { branch: null, quiet: true }],
  ]);
});

test('the page handlers find a page by its name or tab id', async () => {
  const { handlers, calls, sidebar, tab, setFocused } = setup();
  assert.throws(() => handlers.key({ id: 'nope', keyCode: 'Enter' }), /no tab nope/);
  handlers.key({ id: 'dialog', keyCode: 'Escape' });
  handlers.insertText({ id: 't1', text: 'hi' });
  assert.deepEqual(calls, [
    ['focus', 'dialog'],
    ['input', 'dialog', { type: 'keyDown', keyCode: 'Escape', modifiers: [] }],
    ['input', 'dialog', { type: 'keyUp', keyCode: 'Escape', modifiers: [] }],
    ['focus', 't1'],
    ['text', 't1', 'hi'],
  ]);
  setFocused(sidebar);
  assert.equal(handlers.focused(), 'sidebar');
  setFocused(tab.view.webContents);
  assert.equal(handlers.focused(), 't1');
  setFocused(null);
  assert.equal(handlers.focused(), null);
});

test('eval runs in the page, or in each of its webviews', async () => {
  const { handlers } = setup();
  assert.equal(await handlers.eval({ id: 'sidebar', js: '1' }), 'sidebar: 1');
  assert.deepEqual(await handlers.eval({ id: 't1', js: '2', target: 'webviews' }), ['webview: 2', '<error: gone>']);
});

test('shot writes the page\'s picture into the screenshot folder', async () => {
  const { handlers, calls } = setup();
  const file = await handlers.shot({ id: 't1' });
  assert.equal(path.dirname(file), 'logs');
  assert.match(path.basename(file), /^shot-t1-\d+\.png$/);
  assert.deepEqual(calls, [['write', file, 'png of t1']]);
});
