const assert = require('node:assert/strict');
const test = require('node:test');
const { appIpcRoutes } = require('../src/window/ipc-table');
const { registerIpc } = require('../src/window/ipc-routes');

// The channels as a page calls them: through registerIpc, with an event.
function setup(overrides = {}) {
  const calls = [];
  const app = new Proxy({ addingTo: () => true, fromSettingsDialog: () => true, groupName: (repo) => repo || 'Other folders', ...overrides }, {
    get: (target, name) => (name in target ? target[name] : (...args) => {
      calls.push([name, ...args]);
      return `${String(name)} done`;
    }),
  });
  const handlers = {};
  const ipcMain = {
    handle: (channel, handler) => { handlers[channel] = handler; },
    on: (channel, handler) => { handlers[channel] = handler; },
  };
  registerIpc(ipcMain, appIpcRoutes(app));
  const call = (channel, ...args) => handlers[channel]({ sender: 'page', returnValue: undefined }, ...args);
  return { call, calls, handlers };
}

test('what a page sends is taken only with the expected types', () => {
  const { call, calls } = setup();
  call('repos:menu', 42, ['t1', 3, 't2']);
  call('tabs:close-together', null, 'not a list');
  call('sessions:next', 'waiting');
  call('sessions:next', 'done');
  call('worktrees:remove', 7);
  call('uncloned:owner-menu', {});
  assert.deepEqual(calls, [['showRepoMenu', null, ['t1', 't2']], ['closeTabsTogether', [], 'Other folders'], ['revealNext', 'waiting']]);
});

test('the pull requests of the worktree rows need lists of strings', () => {
  const { call, calls } = setup();
  assert.equal(call('github:pulls', '/src/app', 'main'), null);
  assert.equal(call('github:pulls', '/src/app', ['main'], [], [1]), null);
  call('github:pulls', '/src/app', ['a', 'b'], [['a', 3], ['b', 0], 'x', [4, 4]], ['abc']);
  assert.deepEqual(calls, [['pullRequests', '/src/app', ['a', 'b'], new Map([['a', 3]]), ['abc']]]);
});

test('the add-worktree dialog answers only for its repository', async () => {
  const closed = setup({ addingTo: () => false });
  assert.deepEqual(await closed.call('worktree:create', '/src/app', 'fix'), { error: 'The dialog that adds a worktree is closed' });
  assert.deepEqual(closed.calls, []);
  const open = setup();
  assert.deepEqual(await open.call('worktree:suggest', '/src/app', null), { error: 'Enter an issue, a PR, or what to do' });
});

test('the Extensions pane answers only from Settings, and a failure resolves an error', async () => {
  const elsewhere = setup({ fromSettingsDialog: () => false });
  assert.deepEqual(await elsewhere.call('extensions:list', 'local'), { error: 'Open Settings first.' });
  const settings = setup({ updateAvailable: () => false });
  assert.deepEqual(await settings.call('extensions:page', 'not an id'), { error: 'Invalid extension ID.' });
  assert.deepEqual(await settings.call('extensions:update'), { error: 'No updates are available.' });
  await settings.call('extensions:page', 'openai.chatgpt');
  assert.deepEqual(settings.calls, [['openExternal', 'https://marketplace.visualstudio.com/items?itemName=openai.chatgpt']]);
});

test('a worktree list that cannot be read resolves what git said', async () => {
  const failing = setup({ listWorktrees: async () => { throw new Error('fatal: not a git repository'); }, gitMessage: (error) => error.message });
  assert.deepEqual(await failing.call('repos:worktrees', '/src/app'), { error: 'fatal: not a git repository' });
  const reading = setup({ listWorktrees: async () => [{ path: '/src/app' }] });
  assert.deepEqual(await reading.call('repos:worktrees', '/src/app'), [{ path: '/src/app' }]);
  assert.deepEqual(reading.calls, [['rememberWorktrees', '/src/app', [{ path: '/src/app' }]]]);
});
