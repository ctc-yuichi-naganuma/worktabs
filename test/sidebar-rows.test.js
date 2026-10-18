const assert = require('node:assert/strict');
const test = require('node:test');
const { createSidebarRows } = require('../src/sidebar/rows');
const model = require('../src/sidebar/model');
const { Document } = require('./support/sidebar-dom');

function setup({ select = {}, state = {} } = {}) {
  const document = new Document();
  const calls = [];
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className || '';
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const icon = (name) => el('span', `icon ${name}`);
  const rowButton = (name, title, click) => {
    const button = el('button', name);
    button.title = title;
    button.addEventListener('click', (event) => { event.stopPropagation(); click(); });
    return button;
  };
  const action = (name) => (...args) => calls.push([name, ...args]);
  const rows = createSidebarRows({
    state: { visibility: {}, approved: {}, removing: new Set(), ...state },
    host: Object.fromEntries(['addWorktree', 'showRepoMenu', 'open', 'activate', 'close',
      'showWorktreeMenu', 'showTabMenu', 'openIssue', 'openPull', 'openChecks', 'openGithub',
      'removeWorktree', 'archiveSession', 'revealSession'].map((name) => [name, action(name)])),
    dom: { el, icon, logo: icon, agentIcon: (agent) => icon(agent || 'claude'), rowButton },
    select: {
      keyOf: (value) => value.toLowerCase(), sourceLabel: (value) => value,
      providerOf: () => undefined, approvedOf: () => [], approvedLines: () => [],
      mostUrgent: model.mostUrgent, folderName: (folder) => folder.name,
      branchOf: (folder) => folder.branch, badgeOf: model.badgeOf,
      pullOf: () => null, madeFrom: () => null, headChecks: () => null,
      hasBranchPage: () => false, conversationBadge: model.conversationBadge,
      conversationName: (conversation) => model.conversationName(conversation, 'New conversation'),
      movedTo: () => null, pullChecks: (pull) => pull.checks,
      checkLabel: (value) => value, checksLines: () => [], sinceText: () => '',
      elapsedText: () => '1m', ...select,
    },
    actions: { closeAll: action('closeAll'), toggle: action('toggle'), unfoldOpenSection: action('unfold') },
    text: {
      LABELS: { waiting: 'Waiting for approval', done: 'Done', closed: 'Not open', idle: 'Idle' },
      WAITING_SHORT: 'Waiting', WSL_PATH: /^\\\\wsl\.localhost\\([^\\]+)/i,
      VISIBILITIES: { private: { icon: 'lock', label: 'Private' } },
      PULL_STATES: { merged: { icon: 'pullMerged', label: 'Merged' } },
      CHECK_ICONS: { success: 'checkPassed' }, AGENT_LABELS: { claude: 'Claude Code', codex: 'Codex' },
    },
    t: (text, values = {}) => text.replace(/\{(\w+)\}/g, (_match, key) => values[key]),
    clock: () => 1000,
  });
  return { rows, calls };
}

test('conversation rows keep provider labels and prevent archive clicks from revealing the thread', () => {
  const { rows, calls } = setup();
  const tab = { id: 'tab' };
  const conversation = { id: 'thread', agent: 'codex', title: 'Review', state: 'waiting', since: 0 };
  const waiting = rows.renderConversation(tab, conversation);
  assert.match(waiting.getAttribute('aria-label'), /Agent: Codex/);
  assert.equal(waiting.classList.contains('attention'), true);
  assert.equal(waiting.querySelector('button.archive'), null);
  waiting.click();
  assert.deepEqual(calls, [['revealSession', 'tab', 'thread']]);
  calls.length = 0;
  const done = rows.renderConversation(tab, { ...conversation, state: 'done' });
  done.querySelector('button.archive').click();
  assert.deepEqual(calls, [['archiveSession', 'tab', 'thread']]);
});

test('closed worktree actions use the represented folder and retain exact merged-head removal readiness', () => {
  const pull = { state: 'merged', number: 12, title: 'Change', head: 'same' };
  const { rows, calls } = setup({ select: { pullOf: () => pull } });
  const folder = { path: 'C:\\repo-task', repo: 'C:\\repo', name: 'task', branch: 'task', head: 'same' };
  const row = rows.renderFolder(folder);
  assert.equal(row.querySelector('button.trash').classList.contains('ready'), true);
  row.querySelector('button.pull').click();
  row.querySelector('button.trash').click();
  assert.deepEqual(calls, [['openPull', folder.path, 12], ['removeWorktree', folder.path, folder.repo]]);
  assert.equal(rows.renderFolder({ ...folder, head: 'other' }).querySelector('button.trash').classList.contains('ready'), false);
  calls.length = 0;
  row.click();
  assert.deepEqual(calls, [['unfold'], ['open', folder.path]]);
});

test('a removing worktree offers no open or removal actions while other rows remain interactive', () => {
  const folder = { path: 'C:\\repo-task', repo: 'C:\\repo', name: 'task', branch: 'task' };
  const { rows, calls } = setup({ state: { removing: new Set([folder.path.toLowerCase()]) } });
  const row = rows.renderFolder(folder);
  assert.equal(row.classList.contains('removing'), true);
  assert.equal(row.querySelector('button.trash'), null);
  row.click();
  assert.deepEqual(calls, []);
  rows.renderFolder({ ...folder, path: 'C:\\other-task' }).click();
  assert.deepEqual(calls, [['unfold'], ['open', 'C:\\other-task']]);
});

test('collapsed repositories preserve urgency, visibility accessibility, and distinct row actions', () => {
  const { rows, calls } = setup({ state: { visibility: { repo: 'private' } } });
  const group = { key: 'repo', path: 'C:\\repo', name: 'repo', git: true, sources: ['config'],
    tabs: [{ id: 'tab', server: 'running', agent: 'waiting' }] };
  const row = rows.renderGroup(group, false, true);
  assert.equal(row.getAttribute('aria-expanded'), 'false');
  assert.equal(row.classList.contains('attention'), true);
  assert.ok(row.querySelector('.dot.waiting'));
  assert.equal(row.querySelector('.visibility').getAttribute('aria-label'), 'Private');
  assert.equal(row.querySelector('.gh-mark').dataset.key, 'repo');
  row.querySelector('button.close-all').click();
  row.querySelector('button.add').click();
  row.click();
  assert.deepEqual(calls, [['closeAll', group], ['addWorktree', group.path], ['toggle', group]]);
});
