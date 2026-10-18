// Side bar check: filters the repository list, clicks a worktree to open it as a tab, and
// reports what the side bar shows at each step.
// usage: node scripts/dev-sidebar-check.js <filter text> <folder name of the worktree to click>
const { call, log, run, sleep, until } = require('./dev-lib');

const [FILTER, WORKTREE] = process.argv.slice(2);

const SNAPSHOT = `({
  open: [...document.querySelectorAll('#repos .row.worktree.open .name')].map((n) => n.textContent),
  tree: [...document.querySelectorAll('#repos .row')].map((r) => ({ repo: 'repo ', worktree: '  ', conversation: '    ' })[[...r.classList].find((c) => ['repo', 'worktree', 'conversation'].includes(c))] + r.querySelector('.name')?.textContent),
})`;

function typeFilter(text) {
  return call('eval', {
    id: 'sidebar',
    js: `(() => {
      const input = document.getElementById('filter');
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input'));
      return true;
    })()`,
  });
}

run(async () => {
  await typeFilter(FILTER);
  await sleep(300);
  log(`filter "${FILTER}":`, JSON.stringify(await call('eval', { id: 'sidebar', js: SNAPSHOT })));

  await typeFilter('');
  await sleep(300);
  const clicked = await call('eval', {
    id: 'sidebar',
    js: `(() => {
      const row = [...document.querySelectorAll('#repos .row.worktree')].find((r) => r.dataset.folder.split(/[\\\\/]/).pop() === ${JSON.stringify(WORKTREE)});
      if (row) row.click();
      return !!row;
    })()`,
  });
  log(`clicked worktree ${WORKTREE}:`, clicked);
  const tab = await until('tab to open', async () => (await call('state')).tabs.find((t) => t.name === WORKTREE), 10000, 300);
  log('tab:', JSON.stringify({ name: tab.name, active: tab.active, server: tab.server, repo: tab.repo }));
  await sleep(500);
  log('side bar:', JSON.stringify(await call('eval', { id: 'sidebar', js: SNAPSHOT })));
});
