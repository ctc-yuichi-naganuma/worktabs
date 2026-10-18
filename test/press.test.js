const assert = require('node:assert/strict');
const test = require('node:test');
const { PRESS_HOLD, pressHold } = require('../src/sidebar/press');

// A hold whose renders are counted, with the clock and the frames under the test's control.
// The asks a test makes outside a frame are rendered by `request`, which runs the next frame.
function counted(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const frames = [];
  const hold = { renders: 0, frames };
  hold.frame = () => { for (const fn of frames.splice(0)) fn(); };
  const inner = pressHold(() => hold.renders++, PRESS_HOLD, (fn) => frames.push(fn));
  return Object.assign(hold, inner, { request() { inner.request(); hold.frame(); }, ask: inner.request });
}

test('pressHold renders once a frame however often it is asked', (t) => {
  const hold = counted(t);
  hold.ask();
  hold.ask();
  hold.ask();
  assert.equal(hold.renders, 0);
  assert.equal(hold.frames.length, 1);
  hold.frame();
  assert.equal(hold.renders, 1);
  hold.ask();
  hold.frame();
  assert.equal(hold.renders, 2);
});

test('pressHold flush renders an asked render at once, and its frame then renders nothing', (t) => {
  const hold = counted(t);
  hold.flush();
  assert.equal(hold.renders, 0);
  hold.ask();
  hold.flush();
  assert.equal(hold.renders, 1);
  hold.frame();
  assert.equal(hold.renders, 1);
});

test('pressHold holds a render asked before a press whose frame comes during it', (t) => {
  const hold = counted(t);
  hold.ask();
  hold.press();
  hold.frame();
  hold.flush();
  assert.equal(hold.renders, 0);
  hold.release();
  t.mock.timers.tick(0);
  assert.equal(hold.renders, 1);
});

test('pressHold renders when asked while nothing is pressed', (t) => {
  const hold = counted(t);
  hold.request();
  hold.request();
  assert.equal(hold.renders, 2);
});

test('pressHold holds the renders of a press, and renders once after its click', (t) => {
  const hold = counted(t);
  hold.press();
  hold.request();
  hold.request();
  assert.equal(hold.renders, 0);
  hold.release();
  // The click comes in the same task as the release, and may ask for a render of its own.
  hold.request();
  assert.equal(hold.renders, 0);
  t.mock.timers.tick(0);
  assert.equal(hold.renders, 1);
  hold.request();
  assert.equal(hold.renders, 2);
});

test('pressHold does not render after a press that nothing asked to render during', (t) => {
  const hold = counted(t);
  hold.press();
  hold.release();
  t.mock.timers.tick(PRESS_HOLD);
  assert.equal(hold.renders, 0);
});

test('pressHold renders after a while when the release never comes', (t) => {
  const hold = counted(t);
  hold.press();
  hold.request();
  t.mock.timers.tick(PRESS_HOLD - 1);
  assert.equal(hold.renders, 0);
  t.mock.timers.tick(1);
  assert.equal(hold.renders, 1);
  hold.request();
  assert.equal(hold.renders, 2);
  // The release that comes late changes nothing.
  hold.release();
  t.mock.timers.tick(PRESS_HOLD);
  assert.equal(hold.renders, 2);
});

test('pressHold holds on through the second press of a double click', (t) => {
  const hold = counted(t);
  hold.press();
  hold.request();
  hold.release();
  hold.press();
  t.mock.timers.tick(PRESS_HOLD - 1);
  assert.equal(hold.renders, 0);
  hold.release();
  t.mock.timers.tick(0);
  assert.equal(hold.renders, 1);
});

test('pressHold takes a release without a press (the window losing the focus) as nothing', (t) => {
  const hold = counted(t);
  hold.release();
  t.mock.timers.tick(0);
  hold.request();
  assert.equal(hold.renders, 1);
});

test('pressHold waits as long as it is told at most', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let renders = 0;
  const hold = pressHold(() => renders++, 100, (fn) => fn());
  hold.press();
  hold.request();
  t.mock.timers.tick(100);
  assert.equal(renders, 1);
});
