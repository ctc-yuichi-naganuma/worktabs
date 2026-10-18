// Lists what is left to translate into Japanese: the pages of the documents that are behind their
// English originals, and the UI strings that src/i18n/ja.json has no translation for. The
// Japanese versions are brought up to date when someone chooses to (the sync-ja skill), so this
// is a to-do list, not a check: it never fails.
//
// A Japanese page counts as up to date with the English page as it was at the last commit that
// touched the Japanese page. So the English changes since then are what is left to translate,
// but those of commits whose message has the line "Translation: not needed" (a fix of the English
// alone, such as a typo or a UI label the Japanese page already has in Japanese). A UI string is
// keyed by its English text, so one whose English changed shows up as untranslated, and its old
// translation as unused.
//
// usage: node scripts/translations.js   (npm run translations)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { placeholders } = require('../src/i18n/translate');

// Pages that have no Japanese version on purpose.
const ENGLISH_ONLY = ['docs/research.md'];
// The table of the UI's Japanese, relative to the root.
const UI_TABLE = 'src/i18n/ja.json';
// The line in a commit message that says its English changes need no Japanese ones.
const NOT_NEEDED = /^Translation: not needed$/im;

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// ---- Documents -------------------------------------------------------------------------------

// [English, Japanese] paths relative to the root, with forward slashes: the README, and each page
// of docs/ with its translation in docs/ja/. The documents for contributors in .github/ are in
// English only. A page found in only one of docs/ and docs/ja/ still gets its pair, so a missing
// translation or original shows up.
function documentPairs(root) {
  const pairs = [['README.md', 'README.ja.md']];
  const names = new Set();
  for (const dir of [path.join(root, 'docs'), path.join(root, 'docs', 'ja')]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.md')) names.add(entry.name);
  }
  for (const name of [...names].sort()) pairs.push([`docs/${name}`, `docs/ja/${name}`]);
  return pairs.filter(([en]) => !ENGLISH_ONLY.includes(en));
}

// The level of each heading outside code blocks ("## Usage" is 2). The two versions keep the same
// headings in the same order, so that a link to a heading can be moved between them.
function headingLevels(text) {
  const levels = [];
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1];
    if (marker && (!fence || marker === fence)) {
      fence = fence ? null : marker;
      continue;
    }
    if (fence) continue;
    const heading = /^(#{1,6})\s/.exec(line);
    if (heading) levels.push(heading[1].length);
  }
  return levels;
}

// Where one Japanese page stands: 'current', 'behind' (with the commit it was last updated in and
// the English changes since, uncommitted ones included), 'missing', 'new' (not committed yet) or
// 'orphan' (no English page).
function pageStatus(root, en, ja) {
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  if (!fs.existsSync(path.join(root, en))) return { en, ja, state: 'orphan' };
  if (!fs.existsSync(path.join(root, ja))) return { en, ja, state: 'missing' };
  const sameHeadings = headingLevels(read(en)).join() === headingLevels(read(ja)).join();
  const base = git(root, 'log', '-1', '--format=%H', '--', ja);
  if (!base) return { en, ja, state: 'new', sameHeadings };
  const commits = git(root, 'log', '--format=%B%x00', `${base}..HEAD`, '--', en).split('\0').filter((message) => message.trim());
  const uncommitted = git(root, 'diff', '--numstat', 'HEAD', '--', en);
  if (!uncommitted && commits.every((message) => NOT_NEEDED.test(message))) return { en, ja, state: 'current', sameHeadings };
  const numstat = git(root, 'diff', '--numstat', base, '--', en);
  if (!numstat) return { en, ja, state: 'current', sameHeadings };
  const [added, removed] = numstat.split('\t').map(Number);
  return { en, ja, state: 'behind', base: base.slice(0, 7), added, removed, sameHeadings };
}

function translationStatus(root) {
  return documentPairs(root).map(([en, ja]) => pageStatus(root, en, ja));
}

// ---- UI strings ------------------------------------------------------------------------------

// A string literal's value: the escapes the UI strings use.
function unescape(body) {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|.)/g, (_whole, code) => {
    if (code[0] === 'u' && code.length > 1) return String.fromCodePoint(parseInt(code.replace(/[u{}]/g, ''), 16));
    return { n: '\n', t: '\t' }[code] ?? code;
  });
}

// The UI strings in a script: the first argument of each `t(` that is a string literal (a
// template literal only without ${}). [{ text, line }].
function uiStringsIn(source) {
  const found = [];
  const call = /\bt\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.|\$(?!\{))*)`)/g;
  for (const match of source.matchAll(call)) {
    const body = match[1] ?? match[2] ?? match[3];
    found.push({ text: unescape(body), line: source.slice(0, match.index).split('\n').length });
  }
  return found;
}

// The UI strings of a page's HTML: the English of each data-i18n and data-i18n-<attribute>
// (see src/i18n/page.js). [{ text, line }].
function uiStringsInHtml(source) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
  const found = [];
  for (const match of source.matchAll(/\sdata-i18n(?:-[a-z-]+)?="([^"]*)"/g)) {
    const text = match[1].replace(/&(amp|lt|gt|quot|#39);/g, (_whole, name) => entities[name]);
    found.push({ text, line: source.slice(0, match.index).split('\n').length });
  }
  return found;
}

// Every .js and .html file under src/, but the i18n module itself.
function uiSources(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full !== path.join(root, 'src', 'i18n')) walk(full);
      } else if (/\.(js|html)$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(path.join(root, 'src'));
  return files.sort();
}

// The UI strings of the code against the Japanese table: `missing` the strings with no
// translation ([{ text, at }], at: the first place it is used), `unused` the translations no
// string has any more, `mismatched` the translations whose placeholders differ from their
// English, and `total` the number of strings.
function uiStatus(root) {
  const strings = new Map();
  for (const file of uiSources(root)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const source = fs.readFileSync(file, 'utf8');
    for (const { text, line } of file.endsWith('.html') ? uiStringsInHtml(source) : uiStringsIn(source)) {
      if (!strings.has(text)) strings.set(text, `${relative}:${line}`);
    }
  }
  const tableFile = path.join(root, UI_TABLE);
  const table = fs.existsSync(tableFile) ? JSON.parse(fs.readFileSync(tableFile, 'utf8')) : {};
  return {
    total: strings.size,
    missing: [...strings].filter(([text]) => !Object.hasOwn(table, text)).map(([text, at]) => ({ text, at })),
    unused: Object.keys(table).filter((text) => !strings.has(text)),
    mismatched: Object.entries(table)
      .filter(([text, translated]) => placeholders(text).join() !== placeholders(translated).join())
      .map(([text]) => text),
  };
}

// ---- Report ----------------------------------------------------------------------------------

function report(pages, ui = null) {
  const lines = [];
  for (const page of pages) {
    if (page.state === 'behind') {
      lines.push(`behind   ${page.ja}: ${page.en} has +${page.added} -${page.removed} lines since ${page.base}`);
      lines.push(`         git diff ${page.base} -- ${page.en}`);
    } else if (page.state === 'missing') {
      lines.push(`missing  ${page.ja}: translate the whole of ${page.en}`);
    } else if (page.state === 'orphan') {
      lines.push(`orphan   ${page.ja}: ${page.en} does not exist`);
    } else if (page.state === 'new') {
      lines.push(`new      ${page.ja}: not committed yet`);
    }
    if (page.sameHeadings === false) lines.push(`headings ${page.ja}: the headings differ from ${page.en} in number or level`);
  }
  const current = pages.filter((page) => page.state === 'current').length;
  lines.push(`${current} of ${pages.length} Japanese pages are up to date.`);
  if (ui) {
    lines.push('');
    for (const { text, at } of ui.missing) lines.push(`untranslated ${JSON.stringify(text)} (${at})`);
    for (const text of ui.unused) lines.push(`unused       ${JSON.stringify(text)}`);
    for (const text of ui.mismatched) lines.push(`placeholders ${JSON.stringify(text)}: the translation's differ`);
    lines.push(`${ui.total - ui.missing.length} of ${ui.total} UI strings are in ${UI_TABLE}.`);
  }
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  process.stdout.write(report(translationStatus(root), uiStatus(root)));
}

module.exports = { ENGLISH_ONLY, UI_TABLE, documentPairs, headingLevels, pageStatus, report, translationStatus, uiStatus, uiStringsIn, uiStringsInHtml };
