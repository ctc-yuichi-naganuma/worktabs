// Side bar press check: presses a repository row as the mouse would, with the rows
// made again between the press and the release, and checks that the click still folds or unfolds
// it. Made again by render() (what a tab's state changing does), then by the reload the window
// coming to the front makes the side bar do (the worktrees and pull requests of the expanded
// repositories). Then a press held on: the renders wait for it, 2 seconds at most.
//
// usage: node scripts/dev-press-check.js <repository name in the side bar>
const { call, log, run, sleep, until } = require('./dev-lib');

const [REPO] = process.argv.slice(2);

const sidebar = (js) => call('eval', { id: 'sidebar', js });

// The point to press on the repository row, and whether it is expanded.
const repoRow = () =>
  sidebar(`(() => {
    const row = [...document.querySelectorAll('#repos .row.repo')].find((r) => r.querySelector('.name')?.textContent === ${JSON.stringify(REPO)});
    if (!row) return null;
    const box = row.getBoundingClientRect();
    return { x: Math.round(box.left + 40), y: Math.round(box.top + box.height / 2), expanded: row.getAttribute('aria-expanded') === 'true' };
  })()`);

const mouse = (type, { x, y }) => call('mouse', { id: 'sidebar', event: { type, x, y, button: 'left', clickCount: 1 } });

// Presses the row, runs `between`, lets go: whether the row folded or unfolded.
async function pressRow(between = async () => {}) {
  const before = await repoRow();
  await mouse('mouseMove', before);
  await mouse('mouseDown', before);
  await between();
  await mouse('mouseUp', before);
  await sleep(300);
  return (await repoRow()).expanded !== before.expanded;
}

const repoNames = () => sidebar(`[...document.querySelectorAll('#repos .row.repo .name')].map((n) => n.textContent)`);

run(async () => {
  await until('control port', () => call('state'), 60000);
  await until(`repository ${REPO} in the side bar`, repoRow, 30000, 500);
  // Expanded, so that the reload reads its worktrees and pull requests.
  if (!(await repoRow()).expanded && !(await pressRow())) throw new Error('could not expand the repository');
  await sleep(2000);

  const cases = {
    'render()': () => sidebar('(render(), true)'),
    reload: async () => {
      await sidebar(`(loadExpandedWorktrees().then(() => { for (const group of expandedRepos()) loadPulls(group, 'now'); }), true)`);
      // Its first renders come within a few milliseconds.
      await sleep(60);
    },
  };
  for (const [label, between] of Object.entries(cases)) {
    if (!(await pressRow(between))) throw new Error(`the click was lost with ${label} between the press and the release`);
    log(`${label} between the press and the release: the click took`);
    // Back as it was.
    await pressRow();
    await sleep(1500);
  }

  // A press on the title, held: the rows stay as they are, until 2 seconds have passed.
  const title = await sidebar(`(() => { const box = document.querySelector('header .title').getBoundingClientRect(); return { x: Math.round(box.left + 5), y: Math.round(box.top + box.height / 2) }; })()`);
  const all = await repoNames();
  await mouse('mouseMove', title);
  await mouse('mouseDown', title);
  await sidebar(`(state.filter = ${JSON.stringify(REPO)}, render(), true)`);
  const during = await repoNames();
  await sleep(2300);
  const later = await repoNames();
  await mouse('mouseUp', title);
  await sidebar(`(state.filter = '', render(), true)`);
  log('held press: right after', JSON.stringify(during), 'after 2.3 s', JSON.stringify(later));
  if (during.length !== all.length) throw new Error('the rows were made again while the press was held');
  if (later.length === all.length && all.length > 1) throw new Error('the rows were not made again after 2 seconds');
  log('OK');
});
