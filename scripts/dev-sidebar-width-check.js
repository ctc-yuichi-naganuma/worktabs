// Side bar width check: drags the side bar's right edge with mouse events sent to its page, as
// the mouse would, and checks where the side bar and the tabs are: while dragged (the side bar
// covers the window, the tab in front follows), after (the width is kept), past the limits, and
// after a double click on the edge (the configured width again). Leaves the configured width.
// With WORKTABS_DATA_DIR, it also reads the width back from window.json.
// usage: node scripts/dev-sidebar-width-check.js
const fs = require('fs');
const path = require('path');
const { call, log, run, sleep, until } = require('./dev-lib');

const Y = 300;
const mouse = (event) => call('mouse', { id: 'sidebar', event });
const down = (x, clickCount = 1) => mouse({ type: 'mouseDown', x, y: Y, button: 'left', clickCount });
const move = (x) => mouse({ type: 'mouseMove', x, y: Y, modifiers: ['leftButtonDown'] });
const up = (x, clickCount = 1) => mouse({ type: 'mouseUp', x, y: Y, button: 'left', clickCount });

const PAGE = `({
  resizing: document.documentElement.classList.contains('resizing'),
  body: document.body.getBoundingClientRect().width,
  page: window.innerWidth,
})`;

function check(ok, what, detail) {
  if (!ok) throw new Error(`${what}: ${JSON.stringify(detail)}`);
  log('ok:', what);
}

// Where the page shown in front is: the active tab's, else the page shown without tabs.
async function front(layout) {
  const active = (await call('state')).tabs.find((tab) => tab.active);
  return active ? layout.tabs[active.id] : layout.empty;
}

function savedWidth() {
  if (!process.env.WORKTABS_DATA_DIR) return undefined;
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.WORKTABS_DATA_DIR, 'window.json'), 'utf8'));
  return saved.sidebarWidth ?? null;
}

// Presses the edge at `from`, moves the mouse to each of `to`, and lets go at the last. Resolves
// the layout and the page while the mouse was at the last, before letting go.
async function drag(from, to) {
  await down(from);
  await until('drag to start', async () => (await call('layout')).dragging, 5000, 50);
  for (const x of to) {
    await move(x);
    await sleep(60);
  }
  await sleep(200);
  const during = { layout: await call('layout'), page: await call('eval', { id: 'sidebar', js: PAGE }) };
  await up(to.at(-1));
  await until('drag to end', async () => !(await call('layout')).dragging, 5000, 50);
  // The page lets go of the width it held once the side bar is back to it.
  await until('page to follow the side bar again', async () => !(await call('eval', { id: 'sidebar', js: PAGE })).resizing, 5000, 50);
  return during;
}

run(async () => {
  const start = await call('layout');
  log('start:', JSON.stringify(start));
  const width = start.sidebar.width;
  const windowWidth = start.window.width;
  check(start.sidebarWidth !== null || width === start.configured, 'the side bar starts at the configured width, or at the one dragged to', start);

  // A drag 80 to the right: the side bar covers the window while the page draws it at the width
  // dragged to, and the tab in front follows.
  const edge = width - 2;
  const wider = await drag(edge, [edge + 30, edge + 60, edge + 80]);
  log('while dragged:', JSON.stringify(wider));
  check(wider.layout.dragging && wider.layout.sidebar.width === windowWidth, 'the side bar covers the window while dragged', wider.layout);
  check(wider.page.resizing && wider.page.body === width + 80 && wider.page.page === windowWidth, 'the page draws the side bar at the width dragged to', wider.page);
  check((await front(wider.layout)).x === width + 80, 'the tab in front follows while dragged', wider.layout);

  const after = await call('layout');
  const page = await call('eval', { id: 'sidebar', js: PAGE });
  log('after:', JSON.stringify(after), JSON.stringify(page));
  check(after.sidebar.width === width + 80 && after.sidebarWidth === width + 80, 'the side bar keeps the width', after);
  check(Object.values(after.tabs).every((bounds) => bounds.x === width + 80) && (await front(after)).x === width + 80, 'every tab, hidden or not, is next to it', after);
  check(page.page === width + 80 && page.body === width + 80, 'the page is the side bar again', page);
  const saved = savedWidth();
  if (saved !== undefined) check(saved === width + 80, 'window.json keeps the width', saved);

  // A click on the edge leaves the width.
  await drag(width + 78, [width + 78]);
  check((await call('layout')).sidebarWidth === width + 80, 'a click on the edge leaves the width', await call('layout'));

  // Past the limits.
  const widest = await drag(width + 78, [windowWidth + 500]);
  log('past the right:', JSON.stringify(widest));
  const max = (await call('layout')).sidebar.width;
  check(max === Math.min(600, Math.max(180, windowWidth - 320)), 'the widest side bar', { max, windowWidth });
  await drag(max - 2, [-300]);
  check((await call('layout')).sidebar.width === 180, 'the narrowest side bar', await call('layout'));

  // A double click on the edge: the configured width again.
  await down(178, 1);
  await up(178, 1);
  await down(178, 2);
  await up(178, 2);
  await until('the configured width', async () => {
    const layout = await call('layout');
    return layout.sidebarWidth === null && layout.sidebar.width === layout.configured && !layout.dragging;
  }, 5000, 100);
  await until('page to follow the side bar again', async () => !(await call('eval', { id: 'sidebar', js: PAGE })).resizing, 5000, 50);
  const reset = await call('layout');
  const resetPage = await call('eval', { id: 'sidebar', js: PAGE });
  log('after a double click:', JSON.stringify(reset), JSON.stringify(resetPage));
  check((await front(reset)).x === reset.configured && resetPage.body === reset.configured, 'the tab in front and the page follow', { reset, resetPage });
  if (saved !== undefined) check(savedWidth() === null, 'window.json no longer has a width', savedWidth());

  log('done');
});
