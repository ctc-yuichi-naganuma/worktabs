const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { documentPairs, headingLevels, report, translationStatus, uiStatus, uiStringsIn, uiStringsInHtml } = require('../scripts/translations');
const { git, makeRepo, tempDir } = require('./support');

function write(repo, file, text) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
}

function commit(repo, message) {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
}

function stateOf(repo, ja) {
  return translationStatus(repo).find((page) => page.ja === ja);
}

test('headingLevels ignores lines starting with # inside code blocks', () => {
  const text = ['# Title', '', '```sh', '# a comment', '```', '## Usage', '~~~', '## not a heading', '~~~', '### More'].join('\n');
  assert.deepEqual(headingLevels(text), [1, 2, 3]);
});

test('documentPairs pairs the pages of docs and docs/ja by name, without the English-only ones', (t) => {
  const repo = makeRepo(tempDir(t));
  write(repo, 'docs/usage.md', '# Usage\n');
  write(repo, 'docs/research.md', '# Research\n');
  write(repo, 'docs/ja/wsl.md', '# WSL\n');
  assert.deepEqual(documentPairs(repo), [
    ['README.md', 'README.ja.md'],
    ['docs/usage.md', 'docs/ja/usage.md'],
    ['docs/wsl.md', 'docs/ja/wsl.md'],
  ]);
});

test('a Japanese page is behind when the English page changed after the Japanese page last did', (t) => {
  const repo = makeRepo(tempDir(t));
  write(repo, 'docs/usage.md', '# Usage\n\nOne.\n');
  write(repo, 'docs/ja/usage.md', '# 使い方\n\n1 つ。\n');
  commit(repo, 'both');
  assert.equal(stateOf(repo, 'docs/ja/usage.md').state, 'current');

  write(repo, 'docs/usage.md', '# Usage\n\nOne.\nTwo.\n');
  commit(repo, 'english only');
  const page = stateOf(repo, 'docs/ja/usage.md');
  assert.equal(page.state, 'behind');
  assert.equal(page.added, 1);
  assert.equal(page.removed, 0);
  assert.match(report([page]), /git diff [0-9a-f]{7} -- docs\/usage\.md/);

  write(repo, 'docs/ja/usage.md', '# 使い方\n\n1 つ。\n2 つ。\n');
  commit(repo, 'japanese');
  assert.equal(stateOf(repo, 'docs/ja/usage.md').state, 'current');
});

test('English changes in commits that say "Translation: not needed" do not count', (t) => {
  const repo = makeRepo(tempDir(t));
  write(repo, 'docs/usage.md', '# Usage\n\nPress "リポジトリを追加…".\n');
  write(repo, 'docs/ja/usage.md', '# 使い方\n\n「リポジトリを追加…」を押す。\n');
  commit(repo, 'both');
  write(repo, 'docs/usage.md', '# Usage\n\nPress "Add repository…".\n');
  commit(repo, 'docs: quote the English label\n\n- The Japanese page has the Japanese one.\n\nTranslation: not needed');
  assert.equal(stateOf(repo, 'docs/ja/usage.md').state, 'current');

  // A later change that needs one makes it behind, with all the English changes to look at.
  write(repo, 'docs/usage.md', '# Usage\n\nPress "Add repository…".\nThen pick a folder.\n');
  commit(repo, 'docs: say what comes next');
  const page = stateOf(repo, 'docs/ja/usage.md');
  assert.equal(page.state, 'behind');
  assert.equal(page.added, 2);
});

test('uncommitted English changes count as behind', (t) => {
  const repo = makeRepo(tempDir(t));
  write(repo, 'docs/usage.md', '# Usage\n');
  write(repo, 'docs/ja/usage.md', '# 使い方\n');
  commit(repo, 'both');
  write(repo, 'docs/usage.md', '# Usage\n\nNew.\n');
  assert.equal(stateOf(repo, 'docs/ja/usage.md').state, 'behind');
});

test('missing, orphan, new pages and different headings are reported', (t) => {
  const repo = makeRepo(tempDir(t));
  write(repo, 'docs/usage.md', '# Usage\n\n## Tabs\n');
  write(repo, 'docs/ja/usage.md', '# 使い方\n');
  write(repo, 'docs/wsl.md', '# WSL\n');
  write(repo, 'docs/ja/old.md', '# 古い\n');
  commit(repo, 'pages');
  write(repo, 'docs/config.md', '# Config\n');
  write(repo, 'docs/ja/config.md', '# 設定\n');

  assert.equal(stateOf(repo, 'docs/ja/wsl.md').state, 'missing');
  assert.equal(stateOf(repo, 'docs/ja/old.md').state, 'orphan');
  assert.equal(stateOf(repo, 'docs/ja/config.md').state, 'new');
  const usage = stateOf(repo, 'docs/ja/usage.md');
  assert.equal(usage.state, 'current');
  assert.equal(usage.sameHeadings, false);
  assert.match(report([usage]), /^headings docs\/ja\/usage\.md/m);
});

test('uiStringsIn finds the string literal each t( starts with', () => {
  const source = [
    "const a = t('Close');",
    'const b = t("It\'s {name}", { name });',
    "const c = t(`Plain template`);",
    "const d = t(`Not ${'this'}`);",
    "const e = t(label);",
    "const f = split('x'); const g = it('no');",
    "const h = t('Line\\nbreak \\u2026');",
  ].join('\n');
  assert.deepEqual(uiStringsIn(source), [
    { text: 'Close', line: 1 },
    { text: "It's {name}", line: 2 },
    { text: 'Plain template', line: 3 },
    { text: 'Line\nbreak …', line: 7 },
  ]);
});

test('uiStatus lists the strings without a translation, the unused translations and the placeholders that differ', (t) => {
  const root = tempDir(t);
  write(root, 'src/main.js', "t('Open'); t('Close {name}', { name }); t('Open');\n");
  write(root, 'src/sidebar/sidebar.js', "t('Remove');\n");
  write(root, 'src/sidebar/index.html', '<html>\n<button data-i18n-title="Open">x</button>\n<span data-i18n="Width"></span>\n</html>\n');
  write(root, 'src/i18n/index.js', "t('Inside the module');\n");
  write(root, 'src/i18n/ja.json', JSON.stringify({ Open: '開く', 'Close {name}': '{title} を閉じる', Gone: 'もうない' }));
  assert.deepEqual(uiStatus(root), {
    total: 4,
    missing: [
      { text: 'Width', at: 'src/sidebar/index.html:3' },
      { text: 'Remove', at: 'src/sidebar/sidebar.js:1' },
    ],
    unused: ['Gone'],
    mismatched: ['Close {name}'],
  });
});

test('uiStringsInHtml finds the English of data-i18n and data-i18n-<attribute>', () => {
  const html = [
    '<div role="toolbar" data-i18n-aria-label="Sidebar actions">',
    '  <input data-i18n-placeholder="Filter" placeholder="not this" />',
    '  <span data-i18n="Tom &amp; Jerry&#39;s &quot;tabs&quot;"></span>',
    '</div>',
  ].join('\n');
  assert.deepEqual(uiStringsInHtml(html), [
    { text: 'Sidebar actions', line: 1 },
    { text: 'Filter', line: 2 },
    { text: 'Tom & Jerry\'s "tabs"', line: 3 },
  ]);
});
