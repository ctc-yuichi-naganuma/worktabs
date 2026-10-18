const assert = require('node:assert/strict');
const test = require('node:test');
const { TabPorts } = require('../src/tabs/tab-ports');

// Tabs named by their folders, as main.js names them by a hash of the lowercase folder.
function makePorts({ open = [], limit } = {}) {
  const openIds = new Set(open);
  const ports = new TabPorts({ idOf: (folder) => folder.toLowerCase(), isOpen: (id) => openIds.has(id), limit });
  return { ports, openIds };
}

test('a closed tab keeps its port for when it opens again', () => {
  const { ports, openIds } = makePorts({ open: ['a'] });
  assert.deepEqual(ports.use('a', 'A', 5001), []);
  openIds.delete('a');
  assert.deepEqual(ports.close('a'), []);
  assert.equal(ports.port('a'), 5001);
  assert.deepEqual(ports.closed(), { A: 5001 });
});

test('a tab never started has no port, and goes on any', () => {
  const { ports } = makePorts();
  assert.equal(ports.port('a'), 0);
  assert.deepEqual(ports.close('a'), []);
  assert.deepEqual(ports.closed(), {});
});

test('the ports other tabs keep, open or closed, are reserved', () => {
  const { ports } = makePorts({ open: ['a'] });
  ports.use('a', 'A', 5001);
  ports.use('b', 'B', 5002);
  ports.close('b');
  assert.deepEqual(ports.reserved('a'), new Set([5002]));
  assert.deepEqual(ports.reserved('b'), new Set([5001]));
  assert.deepEqual(ports.reserved('c'), new Set([5001, 5002]));
});

test('a tab that had to take another port lets the old one go', () => {
  const { ports } = makePorts({ open: ['a'] });
  ports.use('a', 'A', 5001);
  assert.deepEqual(ports.use('a', 'A', 5001), []);
  assert.deepEqual(ports.use('a', 'A', 5009), [5001]);
  assert.equal(ports.port('a'), 5009);
  assert.deepEqual(ports.reserved('b'), new Set([5009]));
});

test('a port another tab got all the same moves to that tab', () => {
  const { ports } = makePorts();
  ports.use('a', 'A', 5001);
  assert.deepEqual(ports.use('b', 'B', 5001), []);
  assert.equal(ports.port('a'), 0);
  assert.equal(ports.port('b'), 5001);
});

test('a removed worktree lets its port go', () => {
  const { ports } = makePorts();
  ports.use('a', 'A', 5001);
  ports.close('a');
  assert.deepEqual(ports.forget('a'), [5001]);
  assert.equal(ports.port('a'), 0);
  assert.deepEqual(ports.reserved('b'), new Set());
  assert.deepEqual(ports.forget('a'), []);
});

test('beyond the limit, the closed tabs used longest ago let their ports go', () => {
  const { ports, openIds } = makePorts({ open: ['open'], limit: 2 });
  ports.use('open', 'Open', 5000);
  for (const [id, port] of [['a', 5001], ['b', 5002]]) {
    ports.use(id, id.toUpperCase(), port);
    assert.deepEqual(ports.close(id), []);
  }
  // Used again: it is the one used last now.
  openIds.add('a');
  ports.use('a', 'A', 5001);
  openIds.delete('a');
  ports.close('a');
  ports.use('c', 'C', 5003);
  assert.deepEqual(ports.close('c'), [5002]);
  assert.deepEqual(ports.closed(), { A: 5001, C: 5003 });
  // An open tab keeps its port whatever the limit.
  assert.equal(ports.port('open'), 5000);
});

test('tabs.json gives the closed tabs their ports and the open ones theirs', () => {
  const { ports } = makePorts({ open: ['a'] });
  const saved = { tabs: [{ folder: 'A', port: 5001 }], ports: { B: 5002, C: 5003 } };
  assert.deepEqual(ports.load(saved), []);
  assert.equal(ports.port('a'), 5001);
  assert.equal(ports.port('b'), 5002);
  assert.deepEqual(ports.closed(), { B: 5002, C: 5003 });
  assert.deepEqual(ports.reserved('a'), new Set([5002, 5003]));
});

test('a tabs.json from before closed tabs kept their ports has the open tabs only', () => {
  const { ports } = makePorts();
  assert.deepEqual(ports.load({ tabs: ['A', { folder: 'B', port: 5002 }, { folder: 'C', port: 0 }] }), []);
  assert.equal(ports.port('a'), 0);
  assert.equal(ports.port('b'), 5002);
  assert.equal(ports.port('c'), 0);
  assert.deepEqual(ports.load({}), []);
});

test('a port two tabs had in tabs.json stays with the first', () => {
  const { ports } = makePorts();
  assert.deepEqual(ports.load({ tabs: [{ folder: 'A', port: 5001 }, { folder: 'B', port: 5001 }] }), []);
  assert.equal(ports.port('a'), 5001);
  assert.equal(ports.port('b'), 0);
});

test('a folder gone from tabs.json lets its port go', () => {
  const { ports } = makePorts();
  const saved = { tabs: [{ folder: 'A', port: 5001 }], ports: { B: 5002, C: 5003 } };
  assert.deepEqual(ports.load(saved, (folder) => folder !== 'A' && folder !== 'B').sort(), [5001, 5002]);
  assert.equal(ports.port('a'), 0);
  assert.equal(ports.port('b'), 0);
  assert.equal(ports.port('c'), 5003);
});

test('a gone folder whose port another tab keeps leaves it to that tab', () => {
  const { ports } = makePorts();
  assert.deepEqual(ports.load({ tabs: [{ folder: 'A', port: 5001 }], ports: { B: 5001 } }, (folder) => folder !== 'B'), []);
  assert.equal(ports.port('a'), 5001);
});

test('what is not a port in tabs.json is left out', () => {
  const { ports } = makePorts();
  const saved = { tabs: [null, { folder: 'A', port: '5001' }], ports: { B: 70000, C: 1.5, D: -1, E: 5005 } };
  assert.deepEqual(ports.load(saved), []);
  assert.deepEqual([...ports.reserved('x')], [5005]);
  for (const bad of [{ ports: 'nope', tabs: 'nope' }, { ports: [5001], tabs: {} }]) {
    const other = new TabPorts({ idOf: String, isOpen: () => false });
    assert.deepEqual(other.load(bad), []);
    assert.deepEqual(other.closed(), {});
  }
});
