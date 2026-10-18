const assert = require('node:assert/strict');
const test = require('node:test');
const { InstanceManager } = require('../src/code-server/code-server-instances');

class FakeManager extends InstanceManager {
  constructor() {
    super();
    this.ended = [];
  }

  endInstance(instance) {
    this.ended.push(instance.port);
  }
}

function instance(port, extra = {}) {
  const shared = { stops: 0, stop() { this.stops += 1; } };
  return { port, started: true, stopping: false, shared, owner: { port }, ...extra };
}

test('stop ends the tab\'s instance once, and its shared settings with it', () => {
  const manager = new FakeManager();
  const a = instance(4100);
  manager.instances.set('a', a);
  manager.instances.set('b', instance(4200));
  assert.deepEqual(manager.ports(), [4100, 4200]);
  manager.stop('a');
  manager.stop('a');
  manager.stop('missing');
  assert.deepEqual(manager.ended, [4100]);
  assert.equal(a.shared.stops, 1);
  assert.deepEqual(manager.ports(), [4200]);
  manager.stopAll();
  assert.deepEqual(manager.ended, [4100, 4200]);
  assert.equal(manager.instances.size, 0);
});

test('stopping an instance a later start replaced leaves the newer one', () => {
  const manager = new FakeManager();
  const old = instance(4100);
  const newer = instance(4101);
  manager.instances.set('a', newer);
  manager.stop('a', old);
  assert.deepEqual(manager.ended, [4100]);
  assert.equal(manager.instances.get('a'), newer);
});

test('an exit counts only for a started instance that was not stopped, with its start\'s owner', () => {
  const manager = new FakeManager();
  const exits = [];
  manager.on('exit', (...args) => exits.push(args));
  const starting = instance(4100, { started: false });
  manager.instances.set('a', starting);
  manager.instanceEnded('a', starting, 1);
  assert.deepEqual(exits, []);
  assert.equal(manager.instances.size, 0);
  assert.equal(starting.shared.stops, 1);

  const stopped = instance(4101);
  manager.instances.set('b', stopped);
  manager.stop('b');
  manager.instanceEnded('b', stopped, 0);
  assert.deepEqual(exits, []);
  assert.equal(stopped.shared.stops, 1);

  const old = instance(4102);
  const newer = instance(4103);
  manager.instances.set('c', newer);
  manager.instanceEnded('c', old, 9);
  assert.deepEqual(exits, [['c', 9, old.owner]]);
  assert.equal(manager.instances.get('c'), newer);
});

test('a failed instance leaves without an exit', () => {
  const manager = new FakeManager();
  const exits = [];
  manager.on('exit', (...args) => exits.push(args));
  const failed = instance(4100, { started: false });
  manager.instances.set('a', failed);
  manager.instanceFailed('a', failed);
  assert.equal(manager.instances.size, 0);
  assert.equal(failed.shared.stops, 1);
  assert.deepEqual(exits, []);
  assert.throws(() => new InstanceManager().endInstance({}), /not implemented/);
});
