// Update check: run against a data folder with older versions (codeServerVersion set to an
// earlier release, older extensions installed with --install-extension <id>@<version>). Makes
// the tab busy the way its hooks would, starts the offered update, confirms it waits, ends the
// turn, and follows the update to its end. With --idle the tab stays idle.
// With WORKTABS_DATA_DIR set, also reports the installed extensions and code-server folders.
//
// usage: node scripts/dev-update-check.js <tab name> [--idle]
const fs = require('fs');
const path = require('path');
const { call, log, run, sleep, tabNamed, until } = require('./dev-lib');

const NAME = process.argv[2];
const BUSY = !process.argv.includes('--idle');
const DATA = process.env.WORKTABS_DATA_DIR;

const banner = () => call('eval', { id: 'sidebar', js: 'document.getElementById("update").innerText' });

function installed() {
  if (!DATA) return null;
  const extensions = JSON.parse(fs.readFileSync(path.join(DATA, 'extensions', 'extensions.json'), 'utf8'));
  return {
    extensions: extensions.map((e) => `${e.identifier.id}@${e.version}`),
    codeServer: fs.readdirSync(path.join(DATA, 'code-server')),
  };
}

run(async () => {
  const tab = await tabNamed(NAME);
  await until('an update to be offered', async () => (await call('state')).update.status === 'available', 60000, 1000);
  log('offered:', JSON.stringify((await call('state')).update.items.map((i) => `${i.name} ${i.from} -> ${i.to}`)));
  log('installed:', JSON.stringify(installed()));

  const turn = (event) => call('hook', { id: tab.id, input: { session_id: 'dev-update-check', hook_event_name: event } });
  if (BUSY) await turn('UserPromptSubmit');
  // Not awaited: startUpdate resolves only when the update is over.
  await call('eval', { id: 'sidebar', js: 'window.host.startUpdate(); true' });

  let last = '';
  let ended = !BUSY;
  for (const started = Date.now(); ; ) {
    const { update } = await call('state');
    const line = [update.status, update.busy && `busy=${update.busy.join(',')}`, update.detail].filter(Boolean).join(' | ');
    if (line !== last) log((last = line));
    if (update.status === 'waiting' && !ended && Date.now() - started > 5000) {
      log('banner:', JSON.stringify(await banner()));
      await turn('Stop');
      ended = true;
      log('the turn ended');
    }
    if (['done', 'failed'].includes(update.status)) break;
    await sleep(500);
  }
  await until('the tab to run again', async () => (await tabNamed(NAME)).server === 'running', 60000, 500);
  log('banner:', JSON.stringify(await banner()));
  log('installed:', JSON.stringify(installed()));
});
