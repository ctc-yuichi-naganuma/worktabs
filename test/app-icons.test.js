const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { appIconPath, attachAppIcons } = require('../src/window/app-icons');

test('OS icon follows the system appearance even when app appearance differs on Windows', () => {
  assert.equal(path.basename(appIconPath({ shouldUseDarkColorsForSystemIntegratedUI: false, shouldUseDarkColors: true })), 'icon-light.png');
  assert.equal(path.basename(appIconPath({ shouldUseDarkColorsForSystemIntegratedUI: true, shouldUseDarkColors: false })), 'icon.png');
  assert.equal(path.basename(appIconPath({ shouldUseDarkColors: true })), 'icon.png');
});

for (const platform of ['darwin', 'win32']) {
  test(`${platform} applies the initial icon, follows changes, and stops on close`, () => {
    const theme = Object.assign(new EventEmitter(), { shouldUseDarkColorsForSystemIntegratedUI: true });
    const window = new EventEmitter();
    let destroyed = false;
    window.isDestroyed = () => destroyed;
    const calls = [];
    window.setIcon = (icon) => calls.push(['window', path.basename(icon)]);
    const app = { dock: { setIcon: (icon) => calls.push(['dock', path.basename(icon)]) } };
    const target = platform === 'darwin' ? 'dock' : 'window';
    attachAppIcons({ app, nativeTheme: theme, window, platform });
    assert.deepEqual(calls, [[target, 'icon.png']]);
    theme.emit('updated');
    assert.equal(calls.length, 1);
    theme.shouldUseDarkColorsForSystemIntegratedUI = false;
    theme.emit('updated');
    assert.deepEqual(calls, [[target, 'icon.png'], [target, 'icon-light.png']]);
    destroyed = true;
    theme.shouldUseDarkColorsForSystemIntegratedUI = true;
    theme.emit('updated');
    assert.equal(calls.length, 2);
    window.emit('closed');
    assert.equal(theme.listenerCount('updated'), 0);
  });
}
