const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { spawn } = require('node:child_process');
const { pickPort } = require('../src/code-server/code-server');
const { SECONDARY_VIEW_SCRIPT } = require('../src/conversations/secondary-sidebar');
const { makeRepo } = require('./support');

const root = path.resolve(__dirname, '..');
const codeServerDir = process.env.WORKTABS_TEST_CODE_SERVER_DIR;
const helperVersion = require('../helper-extension/package.json').version;
const helper = path.join(root, 'native', `worktabs.worktabs-helper-${helperVersion}.vsix`);
const electron = process.platform === 'darwin'
  ? path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const skip = !codeServerDir || !fs.existsSync(electron) || !fs.existsSync(helper)
  ? 'needs a local Electron install, built helper, and WORKTABS_TEST_CODE_SERVER_DIR' : false;

for (const scenario of [{ locale: 'en' }, { locale: 'ja' }, { locale: 'en', failure: true }]) {
  const { locale, failure } = scenario;
  const languageSkip = locale === 'ja' && !process.env.WORKTABS_TEST_LANGUAGE_PACK_DIR
    ? 'needs WORKTABS_TEST_LANGUAGE_PACK_DIR for the Japanese VS Code language pack' : false;
  test(`startup preparation ${failure ? 'failure' : 'success'} (${locale})`, { skip: skip || languageSkip, timeout: 120000 }, async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktabs-startup-'));
    const data = path.join(dir, 'data');
    const extensionsDir = path.join(dir, 'extensions');
    const configFile = path.join(dir, 'config.json');
    const folders = ['saved-active', 'saved-background', 'early'].map((name) => makeRepo(dir, name));
    for (const folder of [data, extensionsDir]) fs.mkdirSync(folder, { recursive: true });
    const ports = [await pickPort(), await pickPort()];
    fs.writeFileSync(path.join(data, 'tabs.json'), JSON.stringify({ active: folders[0], ports: {},
      tabs: folders.slice(0, 2).map((folder, i) => ({ folder, port: ports[i], conversations: i ? [] : [
        { agent: 'codex', threadId: 'saved-thread', title: 'Saved history', archived: true },
      ] })) }));
    fs.writeFileSync(configFile, JSON.stringify({ repos: [], repoSources: [], unclonedRepos: false,
      codeServerDir, extensionsDir, agents: ['codex'], defaultAgent: 'codex', branchAgent: 'codex',
      locale, updateCheck: false, idleSuspendMinutes: 0 }));
    const controlPort = await pickPort();
    const controlToken = crypto.randomBytes(24).toString('hex');
    const env = { ...process.env, WORKTABS_DATA_DIR: data, WORKTABS_CONFIG: configFile,
      WORKTABS_HIDDEN: '1', WORKTABS_CONTROL_PORT: String(controlPort), WORKTABS_CONTROL_TOKEN: controlToken, WORKTABS_TEST_STARTUP_DIR: dir,
      CODEX_HOME: path.join(dir, 'codex'), CLAUDE_CONFIG_DIR: path.join(dir, 'claude') };
    for (const name of ['ELECTRON_RUN_AS_NODE', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[name];
    // These checks install only the local helper, an offline chat fixture, and a cached language pack.
    if (locale !== 'ja') delete env.WORKTABS_TEST_LANGUAGE_PACK_DIR;
    const app = spawn(electron, [path.join(__dirname, 'fixtures/startup-app.js')], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
    let spawnError;
    app.on('error', (error) => { spawnError = error; });
    const exited = new Promise((resolve) => app.once('exit', resolve));
    const call = async (action, body = {}) => {
      if (spawnError) throw spawnError;
      const response = await fetch(`http://127.0.0.1:${controlPort}/${action}`, {
        method: 'POST', headers: { 'x-worktabs-control-token': controlToken }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
      });
      const answer = await response.json();
      if (!answer.ok) throw new Error(answer.error);
      return answer.result;
    };
    const until = async (what, read) => {
      const deadline = Date.now() + 45000;
      do {
        try { const value = await read(); if (value) return value; } catch {}
        if (spawnError) throw spawnError;
        if (app.exitCode !== null || app.signalCode !== null) throw new Error(`App exited before ${what}; logs: ${dir}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      throw new Error(`Timed out waiting for ${what}; logs: ${dir}`);
    };
    t.after(async () => {
      if (app.exitCode === null && app.signalCode === null && !spawnError) {
        try {
          for (const tab of (await call('state')).tabs) await call('close', { id: tab.id, force: true });
          await call('quit');
        } catch {}
        let timer;
        await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(resolve, 8000); })]);
        clearTimeout(timer);
        if (app.exitCode === null && app.signalCode === null) { app.kill(); await exited; }
      }
      if (spawnError || app.exitCode !== null || app.signalCode !== null) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });
    const events = () => fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    await until('delayed extension installation', () => events().some((event) => event.event === 'install-begin'));
    const restored = await until('restored tabs', () => call('state'));
    assert.equal(restored.tabs.length, 2);
    assert.deepEqual(fs.readdirSync(extensionsDir), [], 'The extension directory starts empty');
    const first = restored.tabs.find((tab) => tab.folder === folders[0]);
    assert.equal(first.server, 'starting');
    assert.equal(restored.tabs.find((tab) => tab.folder === folders[1]).server, 'sleeping');
    const early = await call('open', { folder: folders[2] });
    await call('activate', { id: first.id });
    await call('close', { id: early });
    assert.equal(await call('open', { folder: folders[2] }), early);
    const text = await until('preparation placeholder', async () => {
      const value = await call('eval', { id: early, js: 'document.body.innerText' });
      return value.includes(locale === 'ja' ? '準備しています' : 'Preparing code-server and extensions') && value;
    });
    assert.ok(text);
    assert.equal(events().filter((event) => event.event === 'server-start').length, 0);
    const saved = JSON.parse(fs.readFileSync(path.join(data, 'tabs.json'), 'utf8'));
    assert.deepEqual(saved.tabs.map((tab) => tab.folder), folders);
    assert.equal(saved.active, folders[2]);
    assert.equal(saved.tabs[0].conversations[0].archived, true);
    if (failure) fs.writeFileSync(path.join(dir, 'fail'), '');
    fs.writeFileSync(path.join(dir, 'release'), '');
    if (failure) {
      await until('startup error', async () => (await call('state')).tabs.find((tab) => tab.id === early)?.server === 'error');
      await until('installation error message', async () => /Could not install the extensions: fixture extension installation failed/
        .test(await call('eval', { id: early, js: 'document.body.innerText' })));
      await call('activate', { id: restored.tabs.find((tab) => tab.folder === folders[1]).id });
      await until('later tab error', async () => (await call('state')).tabs.every((tab) => tab.server === 'error'));
      assert.equal(events().filter((event) => event.event === 'server-start').length, 0);
      return;
    }
    await until('helper registration', () => call('helper', { id: early, route: '/settings' }));
    const ready = events();
    assert.ok(ready.findIndex((event) => event.event === 'install-ready') < ready.findIndex((event) => event.event === 'server-start'));
    assert.equal(ready.filter((event) => event.event === 'server-start' && event.id === early).length, 1);
    const state = await call('state');
    assert.equal(state.tabs.find((tab) => tab.folder === folders[1]).server, 'sleeping');
    assert.equal(state.tabs.find((tab) => tab.id === early).active, true);
    assert.equal(state.tabs.find((tab) => tab.id === first.id).port, ports[0]);
    await until('localized VS Code explorer', async () => {
      const text = await call('eval', { id: early, js: 'document.body.innerText' });
      return text.includes(locale === 'ja' ? 'エクスプローラー' : 'Explorer');
    });
    await call('helper', { id: early, route: '/show-chat', body: { agent: 'codex' } });
    await until('chat sidebar', async () => (await call('eval', { id: early, js: SECONDARY_VIEW_SCRIPT }))
      === 'workbench.view.extension.codexSecondaryViewContainer');
  });
}
