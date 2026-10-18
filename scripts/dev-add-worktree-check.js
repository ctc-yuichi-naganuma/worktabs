// Check of the dialog that adds a worktree, with the keyboard as a person would: the issue's
// title read with gh, Enter with no branch name asking claude for one, Enter making the
// worktree, the new conversation in the chat in the side bar (not on an editor tab) with its
// input holding the issue's prompt without sending it, claudeCode.preferredLocation as it was
// in the tab and in the repository's shared settings, and the issue's number on the worktree's
// row. With a pull request's number: its title and branch read with gh, Enter putting its
// branch's name without claude, Enter fetching it into the new worktree, the prompt to review
// it, and its number on the row. The worktree and its branch are removed at the end.
// usage: node scripts/dev-add-worktree-check.js <main worktree> <issue or pull request number>
// with WORKTABS_DATA_DIR set as for the app.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseJsonc } = require('../src/code-server/jsonc');
const { repoIdFor } = require('../src/code-server/settings-sync');
const { appText, call, log, run, sleep, until } = require('./dev-lib');

const [REPO, ISSUE] = process.argv.slice(2);
const DATA_DIR = process.env.WORKTABS_DATA_DIR || path.join(process.env.APPDATA, 'Worktabs');

// claudeCode.preferredLocation in a settings.json (undefined when absent, or with no file).
function preferredLocation(file) {
  try {
    return parseJsonc(fs.readFileSync(file, 'utf8'))['claudeCode.preferredLocation'];
  } catch {
    return undefined;
  }
}
const sharedLocation = () => preferredLocation(path.join(DATA_DIR, 'repos', repoIdFor(REPO), 'settings.json'));
const tabLocation = (id) => preferredLocation(path.join(DATA_DIR, 'instances', id, 'User', 'settings.json'));

// Runs `js` in the Claude chats of the tab that have an input: those in the side bar
// (window.IS_SIDEBAR) when `sidebar`, those on editor tabs when not. Undefined until there is one.
async function inChat(id, sidebar, js) {
  const results = await call('eval', {
    id,
    target: 'webviews',
    js: `${sidebar ? '' : '!'}window.IS_SIDEBAR && document.querySelector('[aria-label="Message input"]') ? (${js}) : undefined`,
  });
  return results.find((r) => r !== undefined && r !== null);
}

// What the form shows, null while it is not up.
const FORM = `(() => {
  if (document.getElementById('backdrop').hidden || document.getElementById('add').hidden) return null;
  const text = (id) => document.getElementById(id).textContent;
  return {
    task: document.getElementById('add-task').value,
    taskHint: text('add-task-hint'),
    taskError: document.getElementById('add-task-hint').classList.contains('error'),
    branch: document.getElementById('add-branch').value,
    branchHint: text('add-branch-hint'),
    branchError: document.getElementById('add-branch-hint').classList.contains('error'),
    suggesting: text('add-suggest') === t('Thinking…'),
    focused: document.activeElement.id,
  };
})()`;

const form = () => call('eval', { id: 'dialog', js: FORM });
const press = (keyCode) => call('key', { id: 'dialog', keyCode });

run(async () => {
  assert.ok(REPO && /^\d+$/.test(ISSUE || ''), 'usage: node scripts/dev-add-worktree-check.js <main worktree> <issue or pull request number>');
  await call('addWorktreeDialog', { repo: REPO });
  await until('the form', form, 10000, 200);
  assert.equal((await form()).focused, 'add-task');

  await call('insertText', { id: 'dialog', text: `#${ISSUE}` });
  const read = await until('the issue read', async () => {
    const f = await form();
    return f && !f.taskHint.endsWith('…') && f.taskHint !== '' ? f : null;
  }, 20000, 300);
  assert.equal(read.taskError, false, read.taskHint);
  const pull = read.taskHint.startsWith(`PR #${ISSUE} `);
  assert.ok(pull || read.taskHint.startsWith(`#${ISSUE} `), read.taskHint);
  log(pull ? 'pull request:' : 'issue:', read.taskHint);

  // What the new tab's settings start with: the repository's shared ones.
  const locationBefore = sharedLocation();
  log('claudeCode.preferredLocation before:', locationBefore);

  const started = Date.now();
  await press('Enter');
  const named = await until(pull ? 'the branch of the pull request' : 'a name from claude', async () => {
    const f = await form();
    return f && !f.suggesting && f.branch ? f : null;
  }, 90000, 500);
  assert.equal(named.focused, 'add-branch');
  const planned = await until('the plan', async () => {
    const f = await form();
    return f && !f.branchHint.endsWith('…') ? f : null;
  }, 15000, 200);
  assert.equal(planned.branchError, false, planned.branchHint);
  if (pull) assert.match(planned.branchHint, /fetch|existing branch|既存のブランチ/i, planned.branchHint);
  log(`name (${((Date.now() - started) / 1000).toFixed(1)}s):`, named.branch, '/', planned.branchHint);

  await press('Enter');
  await until('the dialog to close', async () => (await form()) === null, 5 * 60 * 1000, 500);
  const tab = await until('the new tab', async () => (await call('state')).tabs.find((t) => t.branch === named.branch), 30000, 500);
  log('tab:', tab.folder);

  const input = `document.querySelector('[aria-label="Message input"]').innerText.trim()`;
  const prompt = await until('the prompt in the chat in the side bar', () => inChat(tab.id, true, `${input} || undefined`), 90000, 1000);
  // The prompt up to the title, in the app's language.
  const asked = (await appText())(pull ? 'Review GitHub PR #{number} "{title}"' : 'Implement GitHub issue #{number} "{title}"', { number: ISSUE });
  assert.ok(prompt.startsWith(asked.split('{title}')[0]), prompt);
  // Not sent: it stays in the input, and no turn starts.
  await sleep(3000);
  assert.equal(await inChat(tab.id, true, input), prompt);
  assert.notEqual((await call('state')).tabs.find((t) => t.id === tab.id).agent, 'working');
  log('prompt:', prompt);
  assert.equal(await inChat(tab.id, false, 'true'), undefined, 'a conversation opened on an editor tab');
  log('no conversation on an editor tab');

  // The helper extension puts the setting back once the conversation has opened; the app takes
  // that to the shared settings.
  await until('claudeCode.preferredLocation put back', async () => tabLocation(tab.id) === locationBefore && sharedLocation() === locationBefore, 10000, 300);
  log('claudeCode.preferredLocation after:', tabLocation(tab.id), '(tab),', sharedLocation(), '(shared)');

  // A pull request shows by its number until its state is read, then in its state's color.
  const selector = pull ? '.pull' : '.issue';
  const row = await until(`the ${pull ? 'pull request' : 'issue'} on the row`, () =>
    call('eval', {
      id: 'sidebar',
      js: `(() => { const row = [...document.querySelectorAll('.row.worktree')].find((r) => r.dataset.folder === ${JSON.stringify(tab.folder)}); const number = row && row.querySelector(${JSON.stringify(selector)}); return number ? number.textContent : null; })()`,
    }), 30000, 500);
  assert.equal(row, `#${ISSUE}`);
  log('row:', row);

  await call('removeWorktree', { folder: tab.folder, deleteBranch: true });
  log('removed', tab.folder, 'and', named.branch);
  log('OK');
});
