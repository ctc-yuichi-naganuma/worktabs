const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const dir = path.join(__dirname, '..', 'helper-extension');
const manifest = require('../helper-extension/package.json');

test('every string the manifest names is there in English and Japanese', () => {
  const keys = [...JSON.stringify(manifest).matchAll(/"%([^%"]+)%"/g)].map((match) => match[1]);
  for (const file of ['package.nls.json', 'package.nls.ja.json']) {
    const strings = require(path.join(dir, file));
    for (const key of keys) assert.ok(strings[key], `${file}: ${key}`);
  }
});

test('the file manager item reads Finder on macOS and Explorer elsewhere', () => {
  const items = manifest.contributes.menus['explorer/context'];
  const when = (command) => items.find((item) => item.command === command)?.when;
  assert.equal(when('worktabs.revealInExplorer'), '!isMac');
  assert.equal(when('worktabs.revealInFinder'), 'isMac');
});

test('every command the manifest adds is registered and kept out of the command palette', () => {
  const source = fs.readFileSync(path.join(dir, 'extension.js'), 'utf8');
  const palette = manifest.contributes.menus.commandPalette;
  for (const { command } of manifest.contributes.commands) {
    assert.ok(source.includes(`registerCommand('${command}'`), command);
    assert.equal(palette.find((item) => item.command === command)?.when, 'false', command);
  }
});
