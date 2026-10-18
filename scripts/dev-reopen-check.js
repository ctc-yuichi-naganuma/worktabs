// Reopen check: opens files in a tab's VS Code, closes the tab at once, and opens it again.
// Reports whether it starts on the same port and the files are open again. With another folder,
// that folder's tab opens while the first is closed, and must not get its port.
//
// usage: node scripts/dev-reopen-check.js <folder> [<another folder>]
// (with WORKTABS_DATA_DIR as the app has it, also shows the ports in tabs.json)
const fs = require('fs');
const path = require('path');
const { call, log, run, sleep, until } = require('./dev-lib');

const [FOLDER, OTHER] = process.argv.slice(2).map((folder) => folder && path.resolve(folder));
const FILES = ['package.json', 'README.md'];

const tabFor = async (folder) => (await call('state')).tabs.find((t) => t.folder.toLowerCase() === folder.toLowerCase());
const editors = (id) =>
  call('eval', { id, js: `[...document.querySelectorAll('.tabs-container .tab')].map((t) => t.getAttribute('aria-label'))` });

async function openRunning(folder) {
  const id = await call('open', { folder });
  await until(`${folder} running`, async () => (await tabFor(folder))?.server === 'running', 120000);
  await until('workbench', () => call('eval', { id, js: `!!document.querySelector('.monaco-workbench .part.editor')` }), 60000);
  return { id, port: (await tabFor(folder)).port };
}

// A double click on its row in the Explorer, which opens it pinned. Not through Quick Open:
// keys do not reach the page of a hidden window (WORKTABS_HIDDEN).
async function openFile(id, name) {
  await until(`${name} open`, async () => {
    await call('eval', {
      id,
      js: `(() => {
        if (!document.querySelector('.explorer-folders-view')) {
          const item = [...document.querySelectorAll('.activitybar .action-item a')].find((a) => /^(Explorer|エクスプローラー)/.test(a.getAttribute('aria-label') || ''));
          if (item) item.click();
          return;
        }
        const row = [...document.querySelectorAll('.explorer-folders-view .monaco-list-row')].find((r) => (r.getAttribute('aria-label') || '').startsWith(${JSON.stringify(name)}));
        row?.querySelector('.monaco-icon-label')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
      })()`,
    });
    await sleep(800);
    return (await editors(id)).some((label) => label?.startsWith(name));
  }, 30000, 500);
}

function savedPorts() {
  if (!process.env.WORKTABS_DATA_DIR) return '(WORKTABS_DATA_DIR not set)';
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.WORKTABS_DATA_DIR, 'tabs.json'), 'utf8'));
  return JSON.stringify({ tabs: saved.tabs, ports: saved.ports });
}

run(async () => {
  const first = await openRunning(FOLDER);
  // Let the workbench settle, as a tab in use would have.
  await sleep(3000);
  for (const name of FILES) await openFile(first.id, name);
  const before = await editors(first.id);
  log(`port ${first.port}, editors:`, JSON.stringify(before));

  await call('close', { id: first.id });
  log('closed; tabs.json:', savedPorts());

  if (OTHER) {
    const other = await openRunning(OTHER);
    log(`${path.basename(OTHER)} got port ${other.port}${other.port === first.port ? ' (THE CLOSED TAB’S PORT)' : ''}`);
  }

  const again = await openRunning(FOLDER);
  const after = await until('editors back', async () => {
    const labels = await editors(again.id);
    return FILES.every((name) => labels.some((label) => label?.startsWith(name))) ? labels : undefined;
  }, 30000).catch(() => null);
  log(`reopened on port ${again.port} (${again.port === first.port ? 'same' : 'DIFFERENT'})`);
  log(after ? `editors back: ${JSON.stringify(after)}` : `editors NOT back: ${JSON.stringify(await editors(again.id))}`);
  log('tabs.json:', savedPorts());
  if (again.port !== first.port || !after) process.exit(1);
});
