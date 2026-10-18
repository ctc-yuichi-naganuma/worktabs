const assert = require('node:assert/strict');
const test = require('node:test');
const { StartupGate } = require('../src/tabs/startup-gate');

test('startup waiters share readiness and late waiters complete immediately', async () => {
  const gate = new StartupGate();
  let ready = false;
  gate.wait().then(() => { ready = true; });
  assert.equal(gate.wait(), gate.wait());
  await Promise.resolve();
  assert.equal(ready, false);
  assert.equal(gate.status, 'pending');
  gate.complete();
  await gate.wait();
  assert.equal(ready, true);
  assert.equal(gate.status, 'ready');
  gate.fail(new Error('late failure'));
  await gate.wait();
  assert.equal(gate.status, 'ready');
});

test('startup failure reaches current and future waiters and cannot become ready', async () => {
  const gate = new StartupGate();
  const error = new Error('extensions failed');
  const waiting = assert.rejects(gate.wait(), error);
  gate.fail(error);
  await waiting;
  gate.complete();
  gate.fail(new Error('later failure'));
  await assert.rejects(gate.wait(), error);
  assert.equal(gate.status, 'failed');
});

test('startup can fail with no waiting tabs without an unhandled rejection', async () => {
  const gate = new StartupGate();
  gate.fail(new Error('download failed'));
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(gate.wait(), /download failed/);
});
