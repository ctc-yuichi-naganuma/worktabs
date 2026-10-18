const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { UPDATE_PROBE_ID, createUpdateProbe, waitForActivation, waitForWorkbench } = require('../src/code-server/update-probe');

// A clock that moves on as the waits sleep.
function clock() {
  let at = 0;
  return { now: () => at, sleep: async (ms) => { at += ms; } };
}

const pageOf = (answers) => {
  let i = 0;
  return { executeJavaScript: async () => answers[Math.min(i++, answers.length - 1)] };
};

test('the workbench is ready once it shows the folder, in the display language', async () => {
  const workbench = { workbench: true, title: 'probe - Visual Studio Code', explorer: 'エクスプローラー' };
  await waitForWorkbench(pageOf([null, { workbench: false, title: '' }, workbench]), 'probe', { locale: 'ja', ...clock() });
  await assert.rejects(waitForWorkbench(pageOf([{ login: true }]), 'probe', { locale: 'en', ...clock() }), /login page/);
  await assert.rejects(waitForWorkbench(pageOf([{ ...workbench, explorer: 'Explorer' }]), 'probe', { locale: 'ja', ...clock() }), /did not become ja/);
  await assert.rejects(waitForWorkbench(pageOf([{ ...workbench, title: 'Welcome' }]), 'probe', { locale: 'en', ...clock() }), /did not open/);
  await assert.rejects(waitForWorkbench(pageOf([null]), 'probe', { locale: 'en', ...clock() }), /did not appear/);
});

test('the startup extensions must activate, and one that fails says which', async () => {
  const log = (activated, failed = []) => ({ extensionActivation: () => ({ activated: new Set(activated), failed: new Set(failed) }) });
  await waitForActivation(log(['a.b', 'c.d']), 'id', 0, ['a.b'], clock());
  await assert.rejects(waitForActivation(log([], ['a.b']), 'id', 0, ['a.b'], clock()), /a\.b failed to start/);
  await assert.rejects(waitForActivation(log(['a.b']), 'id', 0, ['a.b', 'c.d'], clock()), /c\.d did not start/);
});

test('the probe runs off the tabs\' ports and cleans up after itself, also when it fails', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktabs-probe-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const calls = [];
  const manager = {
    start: async (id, folder, port, options) => { calls.push(['start', id, path.basename(folder), options.avoid]); return { port: 4100, cookie: { name: 'key' } }; },
    stop: (id) => calls.push(['stop', id]),
    extensionActivation: () => ({ activated: new Set(['a.b']), failed: new Set() }),
  };
  const probe = createUpdateProbe({
    dataDir, config: { resolvedLocale: 'en', resolvedExtensions: ['a.b'], resolvedExtensionsDir: '/ext' },
    servers: () => manager, reserved: () => [4000], startupExtensions: (dir, ids) => ids,
    timing: clock(),
    connect: async (port, cookie) => calls.push(['connect', port, cookie.name]),
    clearPortStorage: async (ports) => calls.push(['clear', ports]),
    hiddenView: () => ({
      webContents: {
        loadURL: async (url) => calls.push(['load', new URL(url).port]),
        executeJavaScript: async () => ({ workbench: true, title: `${UPDATE_PROBE_ID} - VS Code`, explorer: 'Explorer' }),
      },
      close: () => calls.push(['close']),
    }),
  });
  await probe();
  assert.deepEqual(calls, [['start', UPDATE_PROBE_ID, UPDATE_PROBE_ID, [4000]], ['connect', 4100, 'key'], ['load', '4100'], ['close'], ['clear', [4100]], ['stop', UPDATE_PROBE_ID]]);
  calls.length = 0;
  await assert.rejects(probe(['x.y']), /x\.y did not start/);
  assert.deepEqual(calls.slice(-3), [['close'], ['clear', [4100]], ['stop', UPDATE_PROBE_ID]]);
});
