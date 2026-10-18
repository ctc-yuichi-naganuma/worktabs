const assert = require('node:assert/strict');
const test = require('node:test');
const { registerIpc, stringList, stringOrNull, withEvent } = require('../src/window/ipc-routes');

function fakeIpc() {
  const handled = new Map();
  const listened = new Map();
  return {
    handled, listened,
    handle: (channel, listener) => {
      assert.ok(!handled.has(channel), `${channel} twice`);
      handled.set(channel, listener);
    },
    on: (channel, listener) => listened.set(channel, listener),
  };
}

test('registerIpc passes the arguments without the event, unless the handler asks for it', async () => {
  const ipc = fakeIpc();
  const event = { sender: 'page' };
  registerIpc(ipc, {
    handle: {
      'a:plain': (...args) => args,
      'a:event': withEvent((e, ...args) => [e.sender, ...args]),
    },
  });
  assert.deepEqual(await ipc.handled.get('a:plain')(event, 1, 'two'), [1, 'two']);
  assert.deepEqual(await ipc.handled.get('a:event')(event, 3), ['page', 3]);
});

test('registerIpc registers sent and synchronous channels', () => {
  const ipc = fakeIpc();
  const got = [];
  registerIpc(ipc, {
    on: { 'b:sent': (width) => got.push(width) },
    sync: { 'b:sync': () => ({ language: 'en' }) },
  });
  ipc.listened.get('b:sent')({}, 300);
  assert.deepEqual(got, [300]);
  const event = {};
  ipc.listened.get('b:sync')(event);
  assert.deepEqual(event.returnValue, { language: 'en' });
  assert.equal(ipc.handled.size, 0);
});

test('a wrapped handler keeps the default of a missing argument', async () => {
  const ipc = fakeIpc();
  const guard = (handler) => (repo, ...args) => (repo === 'open' ? handler(repo, ...args) : { error: 'closed' });
  registerIpc(ipc, { handle: { 'c:plan': guard((repo, name, task = null) => ({ repo, name, task })) } });
  assert.deepEqual(await ipc.handled.get('c:plan')({}, 'open', 'feature'), { repo: 'open', name: 'feature', task: null });
  assert.deepEqual(await ipc.handled.get('c:plan')({}, 'other', 'feature'), { error: 'closed' });
});

test('stringOrNull and stringList keep only strings', () => {
  assert.equal(stringOrNull('repo'), 'repo');
  assert.equal(stringOrNull(3), null);
  assert.equal(stringOrNull(undefined), null);
  assert.deepEqual(stringList(['a', 1, null, 'b']), ['a', 'b']);
  assert.deepEqual(stringList('a'), []);
});
