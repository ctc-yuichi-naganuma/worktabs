const assert = require('node:assert/strict');
const test = require('node:test');
const { DEFAULT_WIDTH, MAX_WIDTH, MIN_TAB_WIDTH, MIN_WIDTH, fitSidebarWidth, savedSidebarWidth, sidebarLimits } = require('../src/window/sidebar-width');

test('a wide window takes any width between the narrowest and the widest side bar', () => {
  assert.deepEqual(sidebarLimits(1500), { min: MIN_WIDTH, max: MAX_WIDTH });
  assert.equal(fitSidebarWidth(260, 1500), 260);
  assert.equal(fitSidebarWidth(100, 1500), MIN_WIDTH);
  assert.equal(fitSidebarWidth(900, 1500), MAX_WIDTH);
});

test('a narrow window keeps room for the tab, down to the narrowest side bar', () => {
  assert.deepEqual(sidebarLimits(700), { min: MIN_WIDTH, max: 700 - MIN_TAB_WIDTH });
  assert.equal(fitSidebarWidth(500, 700), 700 - MIN_TAB_WIDTH);
  assert.deepEqual(sidebarLimits(400), { min: MIN_WIDTH, max: MIN_WIDTH });
  assert.equal(fitSidebarWidth(500, 400), MIN_WIDTH);
});

test('a window narrower than the narrowest side bar is all side bar', () => {
  assert.deepEqual(sidebarLimits(120), { min: 120, max: 120 });
  assert.equal(fitSidebarWidth(260, 120), 120);
  assert.equal(fitSidebarWidth(260, 0), 0);
  assert.equal(fitSidebarWidth(260, -1), 0);
});

test('widths are whole DIPs, and one that is not a number is the default', () => {
  assert.equal(fitSidebarWidth(301.6, 1500), 302);
  assert.equal(fitSidebarWidth(undefined, 1500), DEFAULT_WIDTH);
  assert.equal(fitSidebarWidth(Number.NaN, 1500), DEFAULT_WIDTH);
  assert.equal(fitSidebarWidth('320', 1500), DEFAULT_WIDTH);
});

test('only a positive whole width is taken from window.json', () => {
  assert.equal(savedSidebarWidth(320), 320);
  for (const value of [undefined, null, 0, -5, 320.5, '320', Number.NaN]) assert.equal(savedSidebarWidth(value), null);
});
