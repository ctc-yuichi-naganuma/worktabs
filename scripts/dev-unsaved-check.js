// Unsaved-edit guard check: types into README.md without saving, then asks the app what
// stopping the tab would lose (the same check that suspend, close and idle suspend use).
// Reverts the edit afterwards.
//
// usage: node scripts/dev-unsaved-check.js <tab name>
const { call, log, run, sleep, tabNamed, until } = require('./dev-lib');

const NAME = process.argv[2];

run(async () => {
  const tab = await tabNamed(NAME);
  await call('activate', { id: tab.id });
  log('risks before editing:', JSON.stringify(await call('risks', { id: tab.id })));

  // The side bar may be showing the Claude Session Manager; switch it to the Explorer.
  await until('README.md in the Explorer', () => call('eval', {
    id: tab.id,
    js: `(() => {
      const row = [...document.querySelectorAll('.explorer-folders-view .monaco-list-row')].find((r) => r.innerText.trim() === 'README.md');
      if (row) {
        row.click();
        return true;
      }
      const explorer = [...document.querySelectorAll('.activitybar .action-item a')].find((a) => (a.getAttribute('aria-label') || '').startsWith('Explorer'));
      if (explorer && !explorer.closest('.action-item').classList.contains('checked')) explorer.click();
      return false;
    })()`,
  }), 20000, 1000);
  // The editor takes input through the EditContext API, so focus its input element and type
  // through Electron (execCommand does not reach it).
  const focusEditor = `(() => {
    const active = document.querySelector('.editor-group-container.active .tab.active');
    if (!active || !/README\\.md/.test(active.getAttribute('aria-label') || '')) return false;
    const input = document.querySelector('.editor-group-container.active .native-edit-context, .editor-group-container.active textarea.inputarea');
    if (!input) return false;
    input.focus();
    return true;
  })()`;
  await until('README editor', () => call('eval', { id: tab.id, js: focusEditor }), 20000, 500);
  await call('insertText', { id: tab.id, text: 'unsaved-edit ' });
  await sleep(800);
  log('risks after typing without saving:', JSON.stringify(await call('risks', { id: tab.id })));

  // Close the editor and discard the edit so the file is clean again.
  await call('eval', {
    id: tab.id,
    js: `document.querySelector('.editor-group-container.active .tab.active .tab-actions .action-label')?.click()`,
  });
  await sleep(800);
  const dialogText = await call('eval', { id: tab.id, js: `(document.querySelector('.monaco-dialog-box') || {}).innerText || null` });
  log('close dialog:', JSON.stringify(dialogText));
  // Choose "Don't Save" so the edit is discarded.
  await call('eval', {
    id: tab.id,
    js: `(() => {
      const button = [...document.querySelectorAll('.monaco-dialog-box .monaco-button')].find((b) => /Don't Save|保存しない/.test(b.innerText));
      if (button) button.click();
      return !!button;
    })()`,
  });
  await sleep(800);
  log('risks after discarding:', JSON.stringify(await call('risks', { id: tab.id })));
});
