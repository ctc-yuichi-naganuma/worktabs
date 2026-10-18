// GitHub buttons check: asks the main process for each folder's GitHub repository, the pull
// request of its branch and the checks of its HEAD, opens the folder as a tab, and reports the
// GitHub buttons its repository's icon brings up and the pull request on its row (or the button
// that makes one, or the checks of its HEAD). Nothing is opened in the browser.
// usage: node scripts/dev-github-check.js <folder> [<folder> ...]
const { execFileSync } = require('child_process');
const path = require('path');
const { call, log, run, sleep, until } = require('./dev-lib');

const FOLDERS = process.argv.slice(2);

// The mouse coming onto the icon of the row's repository, as far as the page hears of it: the
// buttons come up once it has rested there (SHOW_DELAY in hover.js).
const buttons = (key) => `(async () => {
  const row = [...document.querySelectorAll('#repos .row.worktree')].find((r) => r.dataset.folder.toLowerCase() === ${JSON.stringify(key)});
  let repoRow = row?.previousElementSibling;
  while (repoRow && !repoRow.classList.contains('repo')) repoRow = repoRow.previousElementSibling;
  const mark = repoRow?.querySelector('.gh-mark');
  const bar = document.getElementById('gh-bar');
  let shown = null;
  if (mark) {
    mark.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    shown = bar.hidden ? null : [...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    mark.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
  }
  return {
    bar: shown,
    pull: row?.querySelector('.pull')?.title ?? null,
    headChecks: row?.querySelector('.head-checks')?.title ?? null,
    pullRequest: row?.querySelector('.gh')?.title ?? null,
  };
})()`;

run(async () => {
  for (const folder of FOLDERS) {
    const repo = await call('eval', { id: 'sidebar', js: `window.host.github(${JSON.stringify(folder)})` });
    log('github:', folder, JSON.stringify(repo));
    if (repo) {
      const head = execFileSync('git', ['-C', folder, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const branches = repo.branchPage ? [repo.branch] : [];
      const js = `window.host.pullRequests(${JSON.stringify(folder)}, ${JSON.stringify(branches)}, [], [${JSON.stringify(head)}])`;
      log('pull request and checks:', repo.branch, head, JSON.stringify(await call('eval', { id: 'sidebar', js })));
    }
    await call('open', { folder });
    const key = path.resolve(folder).toLowerCase();
    await until(
      `${folder} to be the active tab with its branch`,
      async () => (await call('state')).tabs.find((t) => t.active && t.folder.toLowerCase() === key && t.branch),
      10000,
      300,
    );
    await sleep(1000);
    log('buttons:', JSON.stringify(await call('eval', { id: 'sidebar', js: buttons(key) })));
  }
});
