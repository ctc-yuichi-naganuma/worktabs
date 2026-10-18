const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { copyFiles, globMatches, includePatterns, reaches } = require('../src/repos/worktree-include');
const { tempDir } = require('./support');

test('globMatches takes *, ?, classes, and escapes, ignoring case', () => {
  assert.ok(globMatches('*.env', 'Local.ENV'));
  assert.ok(globMatches('file?.txt', 'file1.txt'));
  assert.ok(!globMatches('file?.txt', 'file10.txt'));
  assert.ok(globMatches('[abc].json', 'b.json'));
  assert.ok(!globMatches('[!abc].json', 'a.json'));
  assert.ok(globMatches('\\*literal', '*literal'));
  assert.ok(!globMatches('\\*literal', 'xliteral'));
});

test('reaches looks into an ignored folder only for the patterns that can name something in it', () => {
  // Without a slash, or starting with **/, a pattern reaches any folder with its first name.
  assert.ok(reaches('.env', ['packages', '.env']));
  assert.ok(reaches('**/secrets/*.json', ['app', 'secrets']));
  assert.ok(!reaches('.env', ['node_modules']));
  // Anchored ones agree with the folder's names as far as both go.
  assert.ok(reaches('config/secrets.json', ['config']));
  assert.ok(!reaches('config/secrets.json', ['other']));
  assert.ok(reaches('config/**/x', ['config', 'deep', 'er']));
});

test('includePatterns reads the patterns of .worktreeinclude, without comments, blanks, or a BOM', (t) => {
  const dir = tempDir(t);
  assert.deepEqual(includePatterns(dir), []);
  fs.writeFileSync(path.join(dir, '.worktreeinclude'), '﻿# comment\n.env\n\nconfig/local.json  \r\nkeep\\ \n');
  assert.deepEqual(includePatterns(dir), ['.env', 'config/local.json', 'keep\\ ']);
});

test('copyFiles copies into the new worktree, keeping the files it has', (t) => {
  const dir = tempDir(t);
  const repo = path.join(dir, 'repo');
  const folder = path.join(dir, 'new');
  fs.mkdirSync(path.join(repo, 'config'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.env'), 'env');
  fs.writeFileSync(path.join(repo, 'config', 'local.json'), 'local');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, '.env'), 'own');
  const failed = copyFiles(repo, folder, ['.env', 'config/local.json']);
  assert.deepEqual(failed.map((f) => f.file), ['.env']);
  assert.equal(fs.readFileSync(path.join(folder, '.env'), 'utf8'), 'own');
  assert.equal(fs.readFileSync(path.join(folder, 'config', 'local.json'), 'utf8'), 'local');
});

// The new worktree's branch may be someone else's pull request, with a link where the main
// worktree has an ignored folder.
test('copyFiles copies nothing through a link in the new worktree', (t) => {
  const dir = tempDir(t);
  const repo = path.join(dir, 'repo');
  const folder = path.join(dir, 'new');
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(path.join(repo, '.claude', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), 'secret');
  fs.writeFileSync(path.join(repo, '.claude', 'deep', 'x.json'), 'secret');
  fs.mkdirSync(folder);
  fs.mkdirSync(outside);
  try {
    fs.symlinkSync(outside, path.join(folder, '.claude'), 'junction');
  } catch (error) {
    t.skip(`cannot make links here: ${error.code}`);
    return;
  }
  const failed = copyFiles(repo, folder, ['.claude/settings.local.json', '.claude/deep/x.json']);
  assert.deepEqual(failed.map((f) => f.file), ['.claude/settings.local.json', '.claude/deep/x.json']);
  assert.match(failed[0].message, /\.claude is a link/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
