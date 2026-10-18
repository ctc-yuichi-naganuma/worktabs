const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { gitCliffPath } = require('../scripts/changelog');
const { releaseNotes } = require('../scripts/release-notes');
const { git, makeRepo, tempDir } = require('./support');

const changelog = [
  '# Changelog',
  '',
  'Header',
  '',
  '## [0.2.0] - 2026-10-02',
  '',
  '### Features',
  '- Something new',
  '',
  '## [0.1.10] - 2026-10-01',
  '',
  '### Bug fixes',
  '- Something fixed',
  '',
  '## [0.1.0] - 2026-09-01',
  '',
  '### Other',
  '- The first version',
  '',
].join('\n');

test('releaseNotes gives the section of the version, up to the next one', () => {
  assert.equal(releaseNotes(changelog, 'v0.2.0'), '## [0.2.0] - 2026-10-02\n\n### Features\n- Something new\n');
  assert.equal(releaseNotes(changelog, '0.1.10'), '## [0.1.10] - 2026-10-01\n\n### Bug fixes\n- Something fixed\n');
});

test('releaseNotes gives the last section up to the end of the file', () => {
  assert.equal(releaseNotes(changelog, 'v0.1.0'), '## [0.1.0] - 2026-09-01\n\n### Other\n- The first version\n');
});

test('releaseNotes keeps CRLF line endings', () => {
  const crlf = changelog.replace(/\n/g, '\r\n');
  assert.equal(releaseNotes(crlf, 'v0.1.10'), '## [0.1.10] - 2026-10-01\r\n\r\n### Bug fixes\r\n- Something fixed\n');
});

test('releaseNotes reads the dots in the version as dots', () => {
  // As a pattern, 0.1.0 would also match the heading of 0x1y0.
  const other = '## [0x1y0] - 2026-09-01\n\n- Another version\n';
  assert.throws(() => releaseNotes(other, 'v0.1.0'), /no section for 0\.1\.0/);
  assert.match(releaseNotes(`${other}\n${changelog}`, 'v0.1.0'), /^## \[0\.1\.0\]/);
});

test('releaseNotes refuses a missing, repeated or empty section', () => {
  assert.throws(() => releaseNotes(changelog, 'v0.3.0'), /no section for 0\.3\.0/);
  assert.throws(() => releaseNotes(`${changelog}\n## [0.2.0] - 2026-10-03\n\n- Again\n`, 'v0.2.0'), /2 sections for 0\.2\.0/);
  assert.throws(() => releaseNotes('## [0.2.0] - 2026-10-02\n\n\n## [0.1.0] - 2026-09-01\n\n- First\n', 'v0.2.0'), /empty/);
  assert.throws(() => releaseNotes(changelog, 'v'), /no version/);
});

// The release notes of a real release: git-cliff with this repository's cliff.toml writes the
// CHANGELOG.md, as `npm version` does, and releaseNotes reads it.
test('cliff.toml groups the prefixes in order and leaves out releases and merges', (t) => {
  const repo = makeRepo(tempDir(t));
  const commit = (message) => git(repo, 'commit', '-q', '--allow-empty', '-m', message);
  commit('fix: fix a bug of the old version (#1)');
  commit('chore(release): v0.1.0');
  git(repo, 'tag', 'v0.1.0');
  commit('docs: write the usage (#4)');
  commit('fix: show the notification (#3)');
  commit('Merge pull request #5 from worktabs/feat/x\n\nfeat: a big feature');
  commit('feat: remove worktrees (#2)');
  commit('feat!: change the form of the settings file (#6)');
  commit('a commit without a prefix');

  const config = path.join(__dirname, '..', 'cliff.toml');
  execFileSync(gitCliffPath(), ['--config', config, '--tag', 'v0.2.0', '--output', 'CHANGELOG.md'], {
    cwd: repo,
    stdio: 'ignore',
  });
  const written = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8');

  const notes = releaseNotes(written, 'v0.2.0');
  const pr = (n) => `([#${n}](https://github.com/worktabs/worktabs/pull/${n}))`;
  assert.match(notes, /^## \[0\.2\.0\] - \d{4}-\d{2}-\d{2}\n/);
  assert.equal(
    notes.replace(/^.*\n/, ''),
    [
      '',
      '### Features',
      `- **Breaking change** change the form of the settings file ${pr(6)}`,
      `- remove worktrees ${pr(2)}`,
      '',
      '### Bug fixes',
      `- show the notification ${pr(3)}`,
      '',
      '### Documentation',
      `- write the usage ${pr(4)}`,
      '',
      '### Other',
      '- a commit without a prefix',
      '',
    ].join('\n'),
  );
  assert.match(releaseNotes(written, 'v0.1.0'), /### Bug fixes\n- fix a bug of the old version/);
  assert.doesNotMatch(written, /chore\(release\)|Merge pull request|a big feature/);
});
