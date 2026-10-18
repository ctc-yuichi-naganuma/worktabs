const assert = require('node:assert/strict');
const test = require('node:test');
const { editJsonc, parseJsonc } = require('../src/code-server/jsonc');

const COMMENTED = `{
  // Theme picked for dark mode.
  "workbench.preferredDarkColorTheme": "One Dark Pro",
  /* Fonts */
  "editor.fontSize": 14, // big enough
  "editor.rulers": [80, 120],
}
`;

test('parseJsonc reads comments and trailing commas, and nothing else that is not JSON', () => {
  assert.deepEqual(parseJsonc(COMMENTED), {
    'workbench.preferredDarkColorTheme': 'One Dark Pro',
    'editor.fontSize': 14,
    'editor.rulers': [80, 120],
  });
  assert.deepEqual(parseJsonc('﻿{"a": "// not a comment", "b": "/* nor this */", "c": "say \\"hi\\""}'), {
    a: '// not a comment',
    b: '/* nor this */',
    c: 'say "hi"',
  });
  assert.deepEqual(parseJsonc('[1, 2, ]'), [1, 2]);
  assert.equal(parseJsonc(''), undefined);
  assert.equal(parseJsonc('{"a": }'), undefined);
  assert.equal(parseJsonc('{"a": 1'), undefined);
  assert.equal(parseJsonc('{a: 1}'), undefined);
});

test('editJsonc sets a value in place and keeps the comments', () => {
  const edited = editJsonc(COMMENTED, { 'editor.fontSize': 16, 'workbench.preferredDarkColorTheme': 'Tokyo Night' });
  assert.equal(edited, COMMENTED.replace('14', '16').replace('One Dark Pro', 'Tokyo Night'));
});

test('editJsonc adds members on lines of their own before the closing brace', () => {
  const edited = editJsonc(COMMENTED, { 'files.autoSave': 'off', 'editor.tabSize': 2 });
  assert.equal(edited, COMMENTED.replace('}\n', '  "files.autoSave": "off",\n  "editor.tabSize": 2\n}\n'));
  assert.deepEqual(parseJsonc(edited)['editor.tabSize'], 2);
  assert.equal(editJsonc('{\n  "a": 1 // one\n}\n', { b: 2 }), '{\n  "a": 1, // one\n  "b": 2\n}\n');
  assert.equal(editJsonc('{"a":1}', { b: true }), '{"a":1,\n  "b": true\n}');
  assert.equal(editJsonc('{}', { a: 1 }), '{\n  "a": 1\n}');
});

test('editJsonc starts an empty or missing text as an empty object', () => {
  assert.equal(editJsonc(null, { a: 1, b: 'x' }), '{\n  "a": 1,\n  "b": "x"\n}\n');
  assert.equal(editJsonc('  \n', {}), '{}\n');
});

test('editJsonc removes members with their lines and the comma they leave', () => {
  const text = '{\n  "a": 1,\n  // about b\n  "b": 2, // two\n  "c": 3\n}\n';
  assert.equal(editJsonc(text, { b: undefined }), '{\n  "a": 1,\n  // about b\n  "c": 3\n}\n');
  assert.equal(editJsonc(text, { c: undefined }), '{\n  "a": 1,\n  // about b\n  "b": 2 // two\n}\n');
  assert.equal(editJsonc(text, { a: undefined, b: undefined, c: undefined }), '{\n  // about b\n}\n');
  assert.equal(editJsonc('{"a":1,"b":2}', { b: undefined }), '{"a":1}');
  assert.equal(editJsonc('{"a":1,"a":2}', { a: undefined }), '{}');
  assert.equal(editJsonc(text, { missing: undefined }), text);
});

test('editJsonc indents values that span lines as the file does', () => {
  const text = '{\r\n\t"a": 1\r\n}\r\n';
  assert.equal(editJsonc(text, { b: { x: [1] } }), '{\r\n\t"a": 1,\r\n\t"b": {\r\n\t\t"x": [\r\n\t\t\t1\r\n\t\t]\r\n\t}\r\n}\r\n');
  assert.equal(editJsonc(text, { a: { y: 2 } }), '{\r\n\t"a": {\r\n\t\t"y": 2\r\n\t}\r\n}\r\n');
});

test('editJsonc gives null for a text that does not hold an object', () => {
  assert.equal(editJsonc('[1]', { a: 1 }), null);
  assert.equal(editJsonc('{"a": }', { a: 1 }), null);
  assert.equal(editJsonc('{"a": 1} {}', { a: 2 }), null);
});
