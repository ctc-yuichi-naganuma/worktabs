const assert = require('node:assert/strict');
const test = require('node:test');
const { placeholderUrl, tabPlaceholder } = require('../src/window/placeholder');

const page = (url) => decodeURIComponent(url.replace('data:text/html;charset=utf-8,', ''));

test('placeholderUrl escapes the title and detail and takes the theme colors', () => {
  const html = page(placeholderUrl('<repo>', 'a & "b"', { scheme: 'dark', vars: { '--bg': '#111', '--text': '#eee', '--text-muted': '#999' } }, 'ja'));
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /<h1>&lt;repo&gt;<\/h1><p>a &amp; &quot;b&quot;<\/p>/);
  assert.match(html, /color-scheme: dark; --bg: #111; --fg: #eee; --muted: #999;/);
});

test('placeholderUrl without a theme follows the system', () => {
  const html = page(placeholderUrl('Worktabs'));
  assert.match(html, /color-scheme: light dark/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /<p><\/p>/);
});

test('tabPlaceholder says what the tab is waiting for', () => {
  assert.deepEqual(tabPlaceholder('app', 'initial', 'ignored', false), { title: 'app', detail: 'Suspended. Select the tab to start it.' });
  assert.equal(tabPlaceholder('app', 'starting', '', true).detail, 'Preparing code-server and extensions…');
  assert.equal(tabPlaceholder('app', 'starting', '', false).detail, 'Starting code-server…');
  assert.equal(tabPlaceholder('app', 'starting', 'Installing', true).detail, 'Installing');
  assert.match(tabPlaceholder('app', 'suspended', '', false).detail, /^Suspended. Click the tab/);
  assert.deepEqual(tabPlaceholder('app', 'error', 'boom', false), { title: 'Could not start app', detail: 'boom' });
});
