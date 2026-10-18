// Suspend/resume check: makes sure a Claude conversation tab is open, suspends the tab (its
// code-server and claude processes stop), selects it again, and reports whether the
// conversation tab comes back.
//
// usage: node scripts/dev-suspend-check.js <tab name>
const { call, inPanel, log, openClaudePanel, run, sleep, tabNamed } = require('./dev-lib');

const NAME = process.argv[2];
const panelText = (id) => inPanel(id, 'document.body.innerText.slice(0, 160)');

run(async () => {
  const tab = await tabNamed(NAME);
  await call('activate', { id: tab.id });
  for (let i = 0; i < 60 && (await tabNamed(NAME)).server !== 'running'; i++) await sleep(1000);
  await openClaudePanel(tab.id);
  await sleep(2000); // let VS Code persist the editor layout
  log(`before suspend (port ${(await tabNamed(NAME)).port}):`, JSON.stringify(await panelText(tab.id)));

  await call('suspend', { id: tab.id });
  await sleep(1500);
  log('after suspend:', (await tabNamed(NAME)).server);

  await call('activate', { id: tab.id });
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const state = await tabNamed(NAME);
    const text = state.server === 'running' ? await panelText(tab.id).catch(() => undefined) : undefined;
    if (text) {
      log(`resumed after ${i + 1}s (port ${state.port}):`, JSON.stringify(text));
      return;
    }
  }
  const editors = await call('eval', { id: tab.id, js: `[...document.querySelectorAll('.tab')].map((t) => t.getAttribute('aria-label'))` });
  log('conversation tab did not come back within 60s; editor tabs:', JSON.stringify(editors));
});
