// Width of the chat in the secondary side bar of a tab opened for the first time.
// Makes a repository the app has not opened in <folder>, and checks that:
// - its primary's chat takes a third of the width it shares with the editor, the focus left alone;
// - a worktree added from the side bar (/new-conversation) takes the width of the primary's chat,
//   read from its running tab, once that was changed;
// - with the primary closed, the app keeps that width (tabs.json), and a worktree made with git
//   and opened then (/show-chat) takes it;
// - a width changed in a worktree's tab stays when the tab opens again.
// Removes the worktrees and closes the tabs at the end; the repository stays in <folder>.
//
// usage: node scripts/dev-chat-width-check.js <folder> with WORKTABS_DATA_DIR set as for the app
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { CHAT_WIDTH_SCRIPT, SECONDARY_VIEW_SCRIPT, chatWidth, resizeScript } = require('../src/conversations/secondary-sidebar');
const { call, log, run, sleep, until } = require('./dev-lib');

const DATA_DIR = process.env.WORKTABS_DATA_DIR || path.join(process.env.APPDATA, 'Worktabs');
const PARENT = path.resolve(process.argv[2]);
const CLAUDE = 'workbench.view.extension.claude-sidebar-secondary';
const stamp = Date.now();

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=Check', '-c', 'user.email=check@example.com', ...args], { cwd, encoding: 'utf8' }).trim();

function makeRepo() {
  const repo = path.join(PARENT, `chat-width-${stamp}`);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'chat width check\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'first');
  return repo;
}

const tabOf = async (folder) => (await call('state')).tabs.find((t) => t.folder.toLowerCase() === folder.toLowerCase());
const widthOf = (id) => call('eval', { id, js: CHAT_WIDTH_SCRIPT }).catch(() => null);
const focusInSideBar = (id) => call('eval', { id, js: `!!document.activeElement?.closest('.part.auxiliarybar')` });
const keptWidth = (repo) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'tabs.json'), 'utf8')).chatWidths?.[repo.toLowerCase()] ?? null;

// Waits until the tab runs, its secondary side bar shows the Claude chat, and the chat's width has
// stayed the same for a few seconds (the app sizes it once the chat shows). Resolves { chat, shared }.
async function settled(id) {
  await until(`${id} to run`, async () => (await call('state')).tabs.find((t) => t.id === id)?.server === 'running');
  await until(`the Claude chat in ${id}`, async () => (await call('eval', { id, js: SECONDARY_VIEW_SCRIPT })) === CLAUDE, 90000, 500);
  let last = null;
  let since = Date.now();
  return until(`the chat's width in ${id} to settle`, async () => {
    const now = await widthOf(id);
    if (!now || now.chat !== last?.chat) {
      last = now;
      since = Date.now();
      return false;
    }
    return Date.now() - since >= 4000 && now;
  }, 30000, 500);
}

function expectWidth(what, got, want) {
  log(`${what}: ${got.chat} of ${got.shared} (want ${want})`);
  if (Math.abs(got.chat - want) > 2) throw new Error(`${what}: the chat is ${got.chat} wide, not ${want}`);
}

run(async () => {
  const repo = makeRepo();
  log(`made ${repo}`);
  const primary = await call('open', { folder: repo });
  const first = await settled(primary);
  expectWidth('the primary, opened for the first time', first, chatWidth({ shared: first.shared }));
  if (await focusInSideBar(primary)) throw new Error('the focus moved to the secondary side bar of the primary');
  const key = (await tabOf(repo)).repo;

  // A width of the person's own on the primary, as a drag of the sash would leave it.
  const own = chatWidth({ shared: first.shared, primary: first.chat + 120 });
  expectWidth('the primary, resized', await call('eval', { id: primary, js: resizeScript(own) }), own);

  const added = await call('addWorktree', { repo, name: `chat-width-${stamp}` });
  if (added.error) throw new Error(added.error);
  const fromSideBar = await settled((await tabOf(added.folder)).id);
  expectWidth('a worktree added from the side bar, the primary running', fromSideBar, chatWidth({ shared: fromSideBar.shared, primary: own }));

  await call('close', { id: primary });
  if (Math.abs((keptWidth(key) ?? 0) - own) > 2) throw new Error(`tabs.json keeps ${keptWidth(key)} for the primary, not ${own}`);
  log(`closed the primary; tabs.json keeps ${keptWidth(key)}`);

  const other = path.join(PARENT, `chat-width-${stamp}-other`);
  git(repo, 'worktree', 'add', '-q', '-b', `other-${stamp}`, other);
  const otherId = await call('open', { folder: other });
  const opened = await settled(otherId);
  expectWidth('a worktree opened with the primary closed', opened, chatWidth({ shared: opened.shared, primary: own }));
  if (await focusInSideBar(otherId)) throw new Error('the focus moved to the secondary side bar of the worktree');

  const mine = chatWidth({ shared: opened.shared, primary: opened.chat - 60 });
  expectWidth('the worktree, resized', await call('eval', { id: otherId, js: resizeScript(mine) }), mine);
  // Let the workbench save its layout, as it does when the page goes away.
  await sleep(2000);
  await call('close', { id: otherId });
  const again = await settled(await call('open', { folder: other }));
  expectWidth('the worktree opened again', again, mine);

  for (const folder of [added.folder, other]) {
    const failed = await call('removeWorktree', { folder, deleteBranch: true });
    if (failed) throw new Error(failed);
  }
  // Removing a worktree brings its primary to the front.
  const back = await tabOf(repo);
  if (back) await call('close', { id: back.id });
  log('removed the worktrees and closed the tabs');
  log('OK');
});
