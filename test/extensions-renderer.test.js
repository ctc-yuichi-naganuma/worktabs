const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class Element {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.value = '';
    this.checked = false;
    this.listeners = {};
    this.classes = new Set();
    this.classList = { add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name), toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
    this.attributes = {};
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.textContent = ''; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  querySelectorAll() {
    return this.children.flatMap((child) => child.children).filter((child) => child.tag === 'input' && child.checked);
  }
}

function setup(overrides = {}, translate = null) {
  const elements = new Map();
  const calls = [];
  const data = {
    target: 'win32-x64', targets: ['win32-x64', 'linux-x64'], codeServerVersion: '4.141.0', errors: [], update: { status: 'none' },
    rows: [{ id: 'acme.agent', name: 'Agent', source: 'VS Code', version: '1.0.0', newer: '2.0.0', previous: true }],
    candidates: [{ key: 'opaque', id: 'acme.agent', name: '<script>not HTML</script>', version: '2.0.0', targetPlatform: 'universal', location: 'C:\\source' }],
  };
  const document = {
    getElementById: (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement: (tag) => new Element(tag),
  };
  const context = vm.createContext({ document, settingsDialog: { id: 'settings-1' },
    t: translate || ((text, args = {}) => text.replace(/\{(\w+)\}/g, (_, key) => args[key])),
    window: { host: {
      answer: (...args) => calls.push(['answer', ...args]),
      extensions: {
        list: async () => data, check: async () => data,
        import: async (...args) => { calls.push(['import', ...args]); return { queued: true }; },
        rollback: async (...args) => { calls.push(['rollback', ...args]); return { queued: true }; },
        page: async () => {}, openCode: async () => {}, update: async () => ({ queued: true }), browse: async () => ({ candidates: [] }), ...overrides,
      },
    } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'dialog', 'extensions.js'), 'utf8'), context);
  return { data, calls, context, element: document.getElementById, run: (js) => vm.runInContext(js, context) };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('extension UI shows sources and versions as text, and requires selection and permission', async () => {
  const ui = setup();
  ui.run('showExtensionManager()');
  await tick();
  const cells = ui.element('extension-installed').children[0].children;
  assert.equal(cells[1].textContent, 'VS Code');
  assert.equal(cells[2].textContent, '1.0.0');
  const label = ui.element('extension-candidates').children[0];
  assert.equal(label.children[1].textContent, '<script>not HTML</script>');
  assert.equal(ui.element('extension-import').disabled, true);
  label.children[0].checked = true;
  ui.run('extensionControls()');
  assert.equal(ui.element('extension-import').disabled, true);
  ui.element('extension-permission').checked = true;
  ui.run('extensionControls()');
  assert.equal(ui.element('extension-import').disabled, false);
  await ui.run('extensionAction(() => window.host.extensions.import(extensionSelection(), extensionTargetEl.value))');
  assert.equal(ui.calls[0][1][0], 'opaque');
  assert.equal(ui.calls[0][2], 'win32-x64');
  assert.deepEqual(ui.calls[1], ['answer', 'settings-1', 1, false]);
});

test('an import error stays visible without closing the settings dialog', async () => {
  const ui = setup({ import: async () => ({ error: 'Wrong platform' }) });
  ui.run('showExtensionManager()');
  await tick();
  await ui.run('extensionAction(() => window.host.extensions.import([], "linux-x64"))');
  assert.equal(ui.element('extension-status').textContent, 'Wrong platform');
  assert.equal(ui.element('extension-status').classes.has('error'), true);
  assert.deepEqual(ui.calls, []);
});

test('the pane shows that an action is still running until it finishes', async () => {
  let finish;
  const ui = setup({ import: () => new Promise((resolve) => { finish = resolve; }) });
  ui.run('showExtensionManager()');
  await tick();
  const progress = ui.element('extension-progress');
  assert.equal(progress.classes.has('busy'), false);
  const action = ui.run('extensionAction(() => window.host.extensions.import(["opaque"], "win32-x64"))');
  assert.equal(progress.classes.has('busy'), true);
  assert.equal(progress.attributes['aria-hidden'], 'false');
  finish({ error: 'Wrong platform' });
  await action;
  assert.equal(progress.classes.has('busy'), false);
  assert.equal(progress.attributes['aria-hidden'], 'true');
});

test('a slow old read cannot replace the list after the manager is reopened', async () => {
  const pending = [];
  const ui = setup({ list: () => new Promise((resolve) => pending.push(resolve)) });
  ui.run('showExtensionManager(); hideExtensionManager(); showExtensionManager()');
  assert.equal(pending.length, 2);
  pending[1]({ ...ui.data, candidates: [] });
  await tick();
  pending[0](ui.data);
  await tick();
  assert.equal(ui.element('extension-candidates').children.length, 1);
  assert.equal(ui.element('extension-candidates').children[0].textContent, 'No local extension source found.');
});

test('Linux versions are labeled prepared rather than installed', async () => {
  const ui = setup();
  ui.data.rows[0].prepared = true;
  ui.run('showExtensionManager()');
  await tick();
  assert.equal(ui.element('extension-installed').children[0].children[2].textContent, 'Prepared: 1.0.0');
});

test('re-import requires permission and previous-version restoration passes the target', async () => {
  const ui = setup();
  ui.run('showExtensionManager()');
  await tick();
  const actions = ui.element('extension-installed').children[0].children[3].children;
  actions[0].listeners.click();
  await tick();
  assert.equal(ui.element('extension-status').textContent, 'Confirm permission before importing.');
  assert.deepEqual(ui.calls, []);
  ui.element('extension-target').value = 'linux-x64';
  actions[1].listeners.click();
  await tick();
  assert.deepEqual(ui.calls[0], ['rollback', 'acme.agent', 'linux-x64']);
});

test('manual checks report configured-source results without claiming worldwide freshness', async () => {
  const ui = setup();
  ui.run('showExtensionManager()');
  await tick();
  await ui.run('refreshExtensions(true)');
  assert.equal(ui.element('extension-status').textContent, 'No updates found in the configured sources.');
});

test('Japanese extension management translates target, versions, actions, permission, and status', async () => {
  const { translator } = require('../src/i18n/translate');
  const ui = setup({}, translator(require('../src/i18n/ja.json')));
  ui.data.rows[0].prepared = true;
  ui.run('showExtensionManager()');
  await tick();
  assert.equal(ui.element('extension-target').children[0].textContent, 'このコンピュータ（win32-x64）');
  assert.equal(ui.element('extension-target').children[1].textContent, 'WSL（linux-x64）');
  const cells = ui.element('extension-installed').children[0].children;
  assert.equal(cells[0].textContent, 'Agent');
  assert.equal(cells[1].textContent, 'VS Code');
  assert.equal(cells[2].textContent, '準備済み: 1.0.0');
  assert.equal(cells[2].children[0].textContent, '利用可能: 2.0.0');
  assert.deepEqual(cells[3].children.map((element) => element.textContent), ['再インポート', '以前のバージョンに戻す', '公式ページ']);
  cells[3].children[0].listeners.click();
  await tick();
  assert.equal(ui.element('extension-status').textContent, 'インポートする前に利用権限を確認してください。');
  await ui.run('refreshExtensions(true)');
  assert.equal(ui.element('extension-status').textContent, '設定した入手元に更新は見つかりませんでした。');
});
