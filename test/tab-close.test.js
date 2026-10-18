const assert = require('node:assert/strict');
const test = require('node:test');
const { nextActive, openAmong } = require('../src/tabs/tab-close');

test('openAmong keeps the open tabs, in the order they opened, once each', () => {
  assert.deepEqual(openAmong(['a', 'b', 'c', 'd'], ['d', 'b', 'x', 'b']), ['b', 'd']);
  assert.deepEqual(openAmong(['a'], []), []);
  assert.deepEqual(openAmong([], ['a']), []);
});

test('nextActive leaves the tab in front where it stays open', () => {
  assert.equal(nextActive(['a', 'b', 'c'], 'a', ['b', 'c']), 'a');
  assert.equal(nextActive(['a', 'b'], null, ['a']), null);
});

test('nextActive goes on to the first tab after the one in front that stays open', () => {
  // b and c are the repository's, d is not: c is never brought to the front on the way.
  assert.equal(nextActive(['a', 'b', 'c', 'd', 'e'], 'b', ['b', 'c']), 'd');
  assert.equal(nextActive(['a', 'b', 'c', 'd'], 'b', ['a', 'b', 'c']), 'd');
});

test('nextActive goes back to the last tab before it when none after it stays open', () => {
  assert.equal(nextActive(['a', 'b', 'c', 'd'], 'c', ['c', 'd']), 'b');
  assert.equal(nextActive(['a', 'b', 'c', 'd'], 'c', ['b', 'c', 'd']), 'a');
});

test('nextActive leaves no tab in front when all of them close', () => {
  assert.equal(nextActive(['a', 'b'], 'a', ['a', 'b']), null);
  assert.equal(nextActive(['a'], 'a', ['a']), null);
});

test('nextActive picks for one tab what the × of the tab in front always picked', () => {
  const order = ['a', 'b', 'c', 'd'];
  for (const [index, id] of order.entries()) {
    const rest = order.filter((other) => other !== id);
    assert.equal(nextActive(order, id, [id]), rest[Math.min(index, rest.length - 1)]);
  }
});
