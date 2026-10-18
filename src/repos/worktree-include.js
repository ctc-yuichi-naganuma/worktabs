// The files a new worktree gets beyond what git tracks: those the repository's .worktreeinclude
// names among the ignored ones. worktrees.js exports these too.
const fs = require('fs');
const path = require('path');
const { runGit } = require('../commands');

// ---- Files for a new worktree (.worktreeinclude) -------------------------------------------

// A new worktree has only what git tracks. The repository's .worktreeinclude (.gitignore
// syntax) names the ignored files it needs as well (.env, local settings), the same file and
// rules as Claude Code's worktrees (https://code.claude.com/docs/en/worktrees), so one list
// serves both.

// The lines of the main worktree's .worktreeinclude that are patterns.
function includePatterns(repo) {
  let text;
  try {
    text = fs.readFileSync(path.join(repo, '.worktreeinclude'), 'utf8');
  } catch {
    return [];
  }
  // Notepad may start the file with a byte order mark.
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/(?<!\\)\s+$/, ''))
    .filter((line) => line && !line.startsWith('#'));
}

// Whether a glob without slashes (*, ?, [...]) matches the name. Case is ignored, as git does on
// Windows; this only picks the folders git itself then matches in.
function globMatches(glob, name) {
  const escape = (c) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    const close = c === '[' ? glob.indexOf(']', i + 2) : -1;
    if (c === '\\' && i + 1 < glob.length) source += escape(glob[(i += 1)]);
    else if (c === '*') source += '.*';
    else if (c === '?') source += '.';
    else if (close > 0) {
      source += `[${glob.slice(i + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`;
      i = close;
    } else source += escape(c);
  }
  try {
    return new RegExp(`^${source}$`, 'i').test(name);
  } catch {
    return true;
  }
}

// Whether a pattern reaches into a folder that is ignored as a whole (its path as names), by
// Claude Code's rule: a pattern starting with **/ (or without a slash, which means the same)
// reaches it when its first name is one of the folder's names; any other pattern when its names
// agree with the folder's as far as both go (config/secrets.json reaches config/).
function reaches(pattern, dir) {
  const names = pattern.replace(/\/+$/, '').replace(/^\//, '').split('/');
  if (!pattern.replace(/\/+$/, '').includes('/') || names[0] === '**') {
    const first = names.find((name) => name !== '**');
    return first !== undefined && dir.some((name) => globMatches(first, name));
  }
  for (let i = 0; i < Math.min(names.length, dir.length); i += 1) {
    if (names[i] === '**') return true;
    if (!globMatches(names[i], dir[i])) return false;
  }
  return true;
}

// Paths in groups short enough for one command line (Windows allows 32767 characters).
function chunked(paths, limit = 8000) {
  const chunks = [];
  let length = Infinity;
  for (const p of paths) {
    if (length + p.length > limit) {
      chunks.push([]);
      length = 0;
    }
    chunks[chunks.length - 1].push(p);
    // With the :(literal) and the space before it.
    length += p.length + 12;
  }
  return chunks;
}

// Those of `paths` (relative, with /) that the repository's .gitignore files ignore.
async function ignoredOf(repo, paths) {
  if (!paths.length) return [];
  try {
    const out = await runGit(repo, ['check-ignore', '-z', '--stdin'], 15000, `${paths.join('\0')}\0`);
    return out.split('\0').filter(Boolean);
  } catch (error) {
    // check-ignore exits with 1 when none of them is ignored.
    if (error.code === 1) return [];
    throw error;
  }
}

// The files of the main worktree (relative, with /) that .worktreeinclude names and git ignores.
// Folders ignored as a whole (node_modules) are listed by git as the folder alone, and only
// searched for the patterns that reach them, so a large one costs nothing unless named.
async function includedFiles(repo) {
  const patterns = includePatterns(repo);
  if (!patterns.length) return [];
  const ignored = (await runGit(repo, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']))
    .split('\0')
    .filter(Boolean);
  // git also lists a folder that holds only ignored files, which are listed on their own too.
  const dirs = await ignoredOf(repo, ignored.filter((p) => p.endsWith('/')));
  const groups = new Map([['', { patterns, paths: ignored.filter((p) => !p.endsWith('/')) }]]);
  for (const dir of dirs) {
    const names = dir.replace(/\/+$/, '').split('/');
    // Negations stay with every group: they take back what the patterns before them named.
    const reaching = patterns.filter((p) => p.startsWith('!') || reaches(p, names));
    if (!reaching.some((p) => !p.startsWith('!'))) continue;
    const key = `\n${reaching.join('\n')}`;
    if (!groups.has(key)) groups.set(key, { patterns: reaching, paths: [] });
    groups.get(key).paths.push(dir.replace(/\/+$/, ''));
  }
  const found = new Set();
  for (const group of groups.values()) {
    const excludes = group.patterns.map((p) => `--exclude=${p}`);
    for (const chunk of chunked(group.paths)) {
      const pathspecs = chunk.map((p) => `:(literal)${p}`);
      const out = await runGit(repo, ['ls-files', '-z', '--others', '--ignored', ...excludes, '--', ...pathspecs]);
      out.split('\0').filter(Boolean).forEach((file) => found.add(file));
    }
  }
  return [...found].sort();
}

// The first folder on the way to `file` in `folder` that is a link, or null. The new worktree's
// links come from its branch, which may be someone else's pull request: a link where the main
// worktree has an ignored folder would send the copies out of the worktree, or into a tracked
// folder where they could be committed.
function linkOnTheWay(folder, file) {
  const names = file.split('/').slice(0, -1);
  for (let i = 1; i <= names.length; i += 1) {
    const dir = path.join(folder, ...names.slice(0, i));
    let stat;
    try {
      stat = fs.lstatSync(dir);
    } catch {
      return null;
    }
    if (stat.isSymbolicLink()) return names.slice(0, i).join('/');
  }
  return null;
}

// Copies the files (relative, with /) from the main worktree into the new one. Resolves the ones
// that could not be copied, as { file, message }; a file the new worktree has already stays.
function copyFiles(repo, folder, files) {
  const failed = [];
  for (const file of files) {
    const target = path.join(folder, ...file.split('/'));
    try {
      const link = linkOnTheWay(folder, file);
      if (link) throw new Error(`${link} is a link in the new worktree`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(repo, ...file.split('/')), target, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      failed.push({ file, message: error.message });
    }
  }
  return failed;
}

module.exports = { copyFiles, globMatches, includePatterns, includedFiles, reaches };
