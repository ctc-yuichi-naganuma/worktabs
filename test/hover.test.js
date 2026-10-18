const assert = require('node:assert/strict');
const test = require('node:test');
const { HIDE_DELAY, SHOW_DELAY, hoverIntent } = require('../src/sidebar/hover');

// A bar whose comings and goings are logged, with the clock under the test's control.
function logged(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const log = [];
  const intent = hoverIntent({ show: (key) => log.push(`show ${key}`), hide: (key) => log.push(`hide ${key}`) });
  return { intent, log };
}

test('hoverIntent shows the bar once the mouse has rested on the anchor', (t) => {
  const { intent, log } = logged(t);
  intent.enter('a');
  t.mock.timers.tick(SHOW_DELAY - 1);
  assert.deepEqual(log, []);
  t.mock.timers.tick(1);
  assert.deepEqual(log, ['show a']);
  assert.equal(intent.shown, 'a');
});

test('hoverIntent shows nothing for the mouse passing over the anchor', (t) => {
  const { intent, log } = logged(t);
  intent.enter('a');
  t.mock.timers.tick(SHOW_DELAY - 1);
  intent.leave();
  t.mock.timers.tick(SHOW_DELAY + HIDE_DELAY);
  assert.deepEqual(log, []);
  assert.equal(intent.shown, null);
});

test('hoverIntent keeps the bar while the mouse goes from the anchor onto it, and back', (t) => {
  const { intent, log } = logged(t);
  intent.enter('a');
  t.mock.timers.tick(SHOW_DELAY);
  intent.leave();
  t.mock.timers.tick(HIDE_DELAY - 1);
  intent.enterBar();
  t.mock.timers.tick(HIDE_DELAY);
  intent.leave();
  t.mock.timers.tick(HIDE_DELAY - 1);
  intent.enter('a');
  t.mock.timers.tick(SHOW_DELAY + HIDE_DELAY);
  assert.deepEqual(log, ['show a']);
});

test('hoverIntent takes the bar away once the mouse has been off the anchor and the bar', (t) => {
  const { intent, log } = logged(t);
  intent.enter('a');
  t.mock.timers.tick(SHOW_DELAY);
  intent.leave();
  t.mock.timers.tick(HIDE_DELAY);
  assert.deepEqual(log, ['show a', 'hide a']);
  assert.equal(intent.shown, null);
});

test('hoverIntent keeps one bar until the mouse rests on another anchor', (t) => {
  const { intent, log } = logged(t);
  intent.enter('a');
  t.mock.timers.tick(SHOW_DELAY);
  intent.leave();
  intent.enter('b');
  t.mock.timers.tick(SHOW_DELAY - 1);
  assert.deepEqual(log, ['show a']);
  t.mock.timers.tick(1);
  assert.deepEqual(log, ['show a', 'hide a', 'show b']);
  assert.equal(intent.shown, 'b');
});

test('hoverIntent takes the bar away at once when closed', (t) => {
  const { intent, log } = logged(t);
  intent.enter('a');
  t.mock.timers.tick(SHOW_DELAY);
  intent.close();
  assert.deepEqual(log, ['show a', 'hide a']);
  // And a bar about to come does not.
  intent.enter('b');
  intent.close();
  t.mock.timers.tick(SHOW_DELAY);
  assert.deepEqual(log, ['show a', 'hide a']);
});
