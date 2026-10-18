// Probe for the unsaved-edit guard: types into the README.md editor and samples the editor
// tab's classes and the file on disk right after, to tell "saved at once" from "not detected".
// usage: node scripts/dev-dirty-probe.js <tab name> <path to README.md>
const fs = require('fs');
const { call, log, run, sleep, tabNamed } = require('./dev-lib');

const [NAME, FILE] = process.argv.slice(2);

run(async () => {
  const tab = await tabNamed(NAME);
  const sample = async (label) => {
    const tabs = await call('eval', {
      id: tab.id,
      js: `[...document.querySelectorAll('.tabs-container .tab')].map((t) => (t.getAttribute('aria-label') || '').slice(0, 30) + ' {' + t.className + '}')`,
    });
    const firstLine = fs.readFileSync(FILE, 'utf8').split(/\r?\n/)[0];
    log(label, JSON.stringify({ tabs, disk: firstLine }));
  };
  const focused = await call('eval', {
    id: tab.id,
    js: `(() => {
      const input = document.querySelector('.editor-group-container.active .native-edit-context');
      if (!input) return false;
      input.focus();
      return true;
    })()`,
  });
  log('editor focused:', focused);
  await sample('before');
  await call('insertText', { id: tab.id, text: 'probe ' });
  await sleep(150);
  await sample('150ms');
  await sleep(2000);
  await sample('2s');
  const settings = await call('eval', { id: tab.id, js: `document.title` });
  log('title', settings);
});
