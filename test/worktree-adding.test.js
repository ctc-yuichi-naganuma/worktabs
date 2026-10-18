const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createWorktreeAdding } = require('../src/repos/worktree-adding');
const { DialogQueue } = require('../src/window/message-box');

const repo = path.resolve('test-repos', 'app');
const folder = path.resolve('test-repos', 'app-task');

function setup(overrides = {}) {
  const calls = [];
  const boxes = [];
  const tabs = new Map();
  const dialogs = new DialogQueue({ show: () => {}, hide: () => {} });
  const state = { window: true, remotes: new Map() };
  const adding = createWorktreeAdding({
    dialogs, windowOpen: () => state.window, remotes: () => state.remotes,
    githubRepo: async () => { calls.push(['github']); return { owner: 'me', name: 'app' }; },
    addWorktree: async (...args) => { calls.push(['add', ...args]); return { folder, branch: 'task', copied: ['.env'], failed: [] }; },
    setBranchLink: async (...args) => calls.push(['link', ...args]),
    gitMessage: (error) => `git: ${error.message}`,
    firstPrompt: (task) => (task ? `Work on ${task.kind}` : ''),
    openTab: (dir) => { calls.push(['open', dir]); tabs.set('t1', { id: 't1' }); return 't1'; },
    tabs, forgetFocus: () => calls.push(['forget']),
    send: (...args) => calls.push(['send', ...args]),
    refreshGit: (...args) => calls.push(['refresh', ...args]),
    messageBox: async (options) => { boxes.push(options); return { response: 0 }; },
    ...overrides,
  });
  return { adding, calls, boxes, tabs, dialogs, state };
}

test('the dialog opens once, asking GitHub only for a repository whose remotes are not known', async () => {
  const { adding, calls, dialogs } = setup();
  await adding.addWorktreeDialog(repo);
  assert.deepEqual(dialogs.current && { kind: dialogs.current.kind, name: dialogs.current.name, github: dialogs.current.github },
    { kind: 'worktree', name: 'app', github: true });
  assert.deepEqual(calls, [['github']]);
  await adding.addWorktreeDialog(repo);
  assert.equal(dialogs.has((d) => d.id === 2), false);
  assert.equal(adding.addingTo(repo), true);
  assert.equal(adding.addingTo(folder), false);
  assert.equal(adding.addingTo(42), false);

  const known = setup();
  known.state.remotes.set(repo.toLowerCase(), { url: null });
  await known.adding.addWorktreeDialog(repo);
  assert.equal(known.dialogs.current.github, false);
  assert.deepEqual(known.calls, []);

  const closed = setup();
  closed.state.window = false;
  await closed.adding.addWorktreeDialog(repo);
  await closed.adding.addWorktreeDialog(7);
  assert.equal(closed.dialogs.current, null);
});

test('adding a worktree opens it with the first conversation and has the side bar read it', async () => {
  const { adding, calls, boxes, tabs } = setup();
  const task = { kind: 'issue', number: 3 };
  assert.deepEqual(await adding.addWorktreeTab(repo, 'task', task), { folder, copied: 1 });
  assert.deepEqual(calls, [
    ['add', repo, 'task', null], ['link', repo, 'task', 'issue', task], ['open', folder], ['forget'],
    ['send', 'worktrees:added', repo], ['refresh', [], [repo]],
  ]);
  assert.deepEqual(tabs.get('t1').newConversation, { prompt: 'Work on issue' });
  assert.deepEqual(boxes, []);
});

test('a pull request is what the branch checks out', async () => {
  const { adding, calls } = setup();
  const pull = { kind: 'pull', number: 9 };
  await adding.addWorktreeTab(repo, 'fix', pull);
  assert.deepEqual(calls[0], ['add', repo, 'fix', pull]);
});

test('git failing is answered with its message, and files not copied are warned about', async () => {
  const failing = setup({ addWorktree: async () => { throw new Error('exists'); } });
  assert.deepEqual(await failing.adding.addWorktreeTab(repo, 'task'), { error: 'git: exists' });
  assert.deepEqual(failing.calls, []);

  const partial = setup({ addWorktree: async () => ({ folder, branch: 'task', copied: [], failed: [{ file: '.env', message: 'denied' }] }) });
  assert.deepEqual(await partial.adding.addWorktreeTab(repo, 'task'), { folder, copied: 0 });
  assert.equal(partial.boxes[0].type, 'warning');
  assert.equal(partial.boxes[0].detail, '.env: denied');
  assert.equal(partial.calls.some(([kind]) => kind === 'link'), false);
});
