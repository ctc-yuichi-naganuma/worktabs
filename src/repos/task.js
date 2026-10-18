// What a new worktree is for, from the first field of the dialog that adds one: an issue of the
// repository on GitHub (#20, 20 or its address), a pull request to review (by its number or
// address), or the work in the user's own words (all there is for a repository that is not on
// GitHub). It gives the branch its name (claude -p thinks of one; a pull request has its own)
// and the new worktree's first Claude conversation its prompt. Runs no Electron code, so the
// tests can load it.
const os = require('os');
const { authenticationFailure, authenticationMessage, cliFailureMessage, resolveAgentCli } = require('../agents/agent-cli');
const { githubRepo } = require('./github');
const { t } = require('../i18n');
const { recentBranches } = require('./worktrees');
const { gitMessage, runAt } = require('../commands');
const { parseWslPath } = require('../wsl/wsl');

// The address of an issue or a pull request: https://<host>/<owner>/<name>/issues/<number>.
const ADDRESS = /^https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/(issues|pull)\/(\d+)(?:[/?#]\S*)?$/i;

// What the text names: { kind: 'none' } for nothing; { kind: 'issue', number, address } for an
// issue's number or address, and { kind: 'pull', number, address } for a pull request's address,
// with address { host, slug } when it was given as one; else { kind: 'text', text }. GitHub
// numbers issues and pull requests together, so a number alone may still be a pull request: gh
// tells (describeTask).
function parseTask(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { kind: 'none' };
  const number = /^#?([1-9]\d{0,9})$/.exec(trimmed);
  if (number) return { kind: 'issue', number: Number(number[1]), address: null };
  const address = ADDRESS.exec(trimmed);
  if (!address) return { kind: 'text', text: trimmed.replace(/\s+/g, ' ') };
  const [, host, owner, name, page, n] = address;
  const kind = page.toLowerCase() === 'pull' ? 'pull' : 'issue';
  return { kind, number: Number(n), address: { host: host.toLowerCase(), slug: `${owner}/${name}` } };
}

// The issue in what `gh issue view --json number,title,state,url` printed: { number, title,
// state, url, pull }, or null. gh shows a pull request as well; its address says which it is.
function issueOf(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || !Number.isInteger(data.number) || typeof data.title !== 'string' || typeof data.url !== 'string') return null;
  return {
    number: data.number,
    title: data.title.replace(/\s+/g, ' ').trim(),
    state: String(data.state || ''),
    url: data.url,
    pull: /\/pull\/\d+/.test(data.url),
  };
}

// The pull request in what `gh pr view --json number,title,state,url,headRefName,
// isCrossRepository,headRepositoryOwner` printed: { number, title, state ('OPEN', 'CLOSED',
// 'MERGED'), url, head, cross, owner }, or null. head: its branch; cross: whether that branch is
// in another repository (a fork), which `owner` owns (null when the fork is gone).
function pullRequestOf(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || !Number.isInteger(data.number) || typeof data.title !== 'string' || typeof data.headRefName !== 'string' || !data.headRefName) {
    return null;
  }
  const owner = data.headRepositoryOwner && data.headRepositoryOwner.login;
  return {
    number: data.number,
    title: data.title.replace(/\s+/g, ' ').trim(),
    state: String(data.state || ''),
    url: String(data.url || ''),
    head: data.headRefName,
    cross: Boolean(data.isCrossRepository),
    owner: typeof owner === 'string' && owner ? owner : null,
  };
}

// The branch a pull request is checked out into: its own branch's name, as gh pr checkout names
// it; one from a fork with the fork's owner in front (alice/patch-1), so that it is not taken
// for a branch of this repository (a fork's main, say) or of another fork.
function pullBranch({ number, head, cross, owner }) {
  if (!cross) return head;
  return owner ? `${owner}/${head}` : `pr-${number}`;
}

// Why a command did not run: the command is not there, else what it said.
function commandMessage(command, error) {
  // ENOENT here; in WSL, the shell's "command not found".
  if (error.code === 'ENOENT' || error.code === 127) return t('{command} is not found', { command });
  return gitMessage(error);
}

// Reads the issue with gh where the repository is: in WSL for a folder there, signed in there.
function viewIssue(folder, repo, number) {
  const target = repo.url.replace(/^https:\/\//, '');
  const args = ['issue', 'view', String(number), '--repo', target, '--json', 'number,title,state,url'];
  return runAt(folder, 'gh', args, 15000, { shellEnv: true });
}

// Reads the pull request with gh, as viewIssue, with its branch and where that is.
function viewPull(folder, repo, number) {
  const target = repo.url.replace(/^https:\/\//, '');
  const fields = 'number,title,state,url,headRefName,isCrossRepository,headRepositoryOwner';
  return runAt(folder, 'gh', ['pr', 'view', String(number), '--repo', target, '--json', fields], 15000, { shellEnv: true });
}

// What the dialog says of the text: the task, an issue or pull request with its title and state
// as gh reads it: { kind: 'issue', number, title, state ('OPEN', 'CLOSED'), url }, or { kind:
// 'pull', number, title, state (also 'MERGED'), url, head, cross, owner, branch } (see
// pullRequestOf; branch: the one to check it out into, pullBranch's), or { kind: 'text', text },
// { kind: 'none' }; { error } when it names nothing of this repository. A number that gh's issue
// answers with the address of a pull request is read again as one. A repository that is not on
// GitHub (GitLab, or no remote) has nothing for gh to read, and its issues are called #20 too:
// everything is words there, and a number alone has numberOnly, as it tells claude nothing to
// name a branch after.
async function describeTask(folder, text, { view = viewIssue, viewPr = viewPull } = {}) {
  const task = parseTask(text);
  if (task.kind !== 'issue' && task.kind !== 'pull') return task;
  const repo = await githubRepo(folder);
  if (!repo) {
    const words = { kind: 'text', text: String(text).trim().replace(/\s+/g, ' ') };
    return task.address ? words : { ...words, numberOnly: true };
  }
  const here = repo.url.replace(/^https:\/\//, '').toLowerCase();
  if (task.address && `${task.address.host}/${task.address.slug}`.toLowerCase() !== here) {
    const words = { other: task.address.slug, repo: repo.slug };
    return {
      error: task.kind === 'pull' ? t('That is a PR of {other}. Enter an issue or PR of {repo}', words) : t('That is an issue of {other}. Enter an issue or PR of {repo}', words),
    };
  }
  try {
    let { number } = task;
    if (task.kind === 'issue') {
      const issue = issueOf(await view(folder, repo, number));
      if (!issue) return { error: t('Could not read #{number}', { number }) };
      if (!issue.pull) return { kind: 'issue', number: issue.number, title: issue.title, state: issue.state, url: issue.url };
      number = issue.number;
    }
    const pull = pullRequestOf(await viewPr(folder, repo, number));
    if (!pull) return { error: t('Could not read PR #{number}', { number }) };
    return { kind: 'pull', ...pull, branch: pullBranch(pull) };
  } catch (error) {
    return { error: commandMessage('gh', error) };
  }
}

// A task the dialog's page sent back (from describeTask), as far as it is one; null for none. A
// pull request keeps what checking it out needs: its branch, whether that is in a fork, and
// whether it is open.
function checkedTask(task) {
  if (!task || typeof task !== 'object') return null;
  const numbered = Number.isInteger(task.number) && task.number > 0 && typeof task.title === 'string';
  if (task.kind === 'issue' && numbered) return { kind: 'issue', number: task.number, title: task.title };
  if (task.kind === 'pull' && numbered && typeof task.head === 'string' && task.head && typeof task.cross === 'boolean') {
    return { kind: 'pull', number: task.number, title: task.title, head: task.head, cross: task.cross, open: task.state === 'OPEN' };
  }
  if (task.kind === 'text' && typeof task.text === 'string' && task.text.trim()) return { kind: 'text', text: task.text.trim() };
  return null;
}

// ---- A name for the branch -------------------------------------------------------------------

// An alias, not a model ID: the extension's CLI maps it to the newest Sonnet, so names follow
// new models with each extension update. Measured on 2026-10-11 (CLI 2.1.296), Haiku 5.5 was
// at most a second faster, since CLI start-up takes most of the time, and it mixed up feat and
// fix more often (#199).
const NAMING_MODEL = 'sonnet';

// The recent branches alone made names of the number and nothing else (fix/issue74), so the
// form and the words are spelled out.
const NAMING = [
  'You name a git branch for a piece of work.',
  'Reply with the branch name only: one line, without quotes or explanation.',
  'Form it as <type>/<number>-<words>.',
  'type: the kind of work, one of feat, fix, docs, refactor, test, chore.',
  "number: the GitHub issue's number when the work is an issue; leave it out, with its hyphen, when it is not.",
  'words: two to four lowercase English words joined by hyphens that say what the work changes, specific enough to tell this branch from the others. Never leave them out.',
  "Where the repository's recent branches write the type or the number their own way (issue66 for 66, say), write them that way, but still add the words.",
  'Use only lowercase letters, digits, hyphens and the one slash; keep it under 40 characters. It must differ from every recent branch.',
  'Examples: feat/12-dark-mode-toggle, fix/31-reveal-long-titles, docs/install-steps.',
].join(' ');

// What claude is told of the work and of the repository's branches. One line: it goes on
// wsl.exe's command line for a repository in WSL.
function namingPrompt(task, branches) {
  const work = {
    issue: `GitHub issue #${task.number}: ${task.title}`,
    pull: `GitHub pull request #${task.number}: ${task.title}`,
    text: `The work: ${task.text}`,
  }[task.kind];
  return branches.length ? `${work} (recent branches, newest first: ${branches.join(', ')})` : work;
}

// The branch name in what claude answered: the first line that is a name alone, without the
// quotes or backticks a model may put around it; null when there is none.
function branchNameIn(output) {
  for (const line of String(output).split(/\r?\n/)) {
    const name = line.trim().replace(/^[`'"]+|[`'"]+$/g, '');
    if (/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)) return name;
  }
  return null;
}

function runSuggestion(run, folder, binary, args, cwd) {
  const wsl = parseWslPath(folder);
  // runAt starts WSL commands in the user's home. Keep Claude away from project guides,
  // and let Codex use the selected repository, just as the local invocation does.
  if (wsl) return run(folder, 'sh', ['-c', 'cd "$1" && shift && exec "$@"', 'sh', cwd, binary, ...args], 90 * 1000, { shellEnv: true, input: '' });
  // The prompt is already in argv. Closing stdin avoids the CLI waiting for piped input.
  return run(folder, binary, args, 90 * 1000, { shellEnv: true, cwd, input: '' });
}

// claude -p where the repository is (claude's login is there too): without tools, MCP servers,
// slash commands or the user's settings (their hooks would run for it), and without keeping the
// conversation, which would show among the user's Claude conversations. Here in the temporary
// folder, so that no project's agent guide goes along.
async function askClaude(folder, prompt, { resolve = resolveAgentCli, run = runAt, ...options } = {}) {
  const binary = await resolve(folder, 'claude', options);
  const args = ['-p', prompt, '--model', NAMING_MODEL, '--system-prompt', NAMING, '--no-session-persistence'];
  args.push('--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', '');
  return runSuggestion(run, folder, binary, args, parseWslPath(folder) ? '/tmp' : os.tmpdir());
}

// codex exec where the repository is (Codex's login is there too): read-only sandbox, with the
// naming instruction in the prompt so no project instructions need to be trusted for the format.
async function askCodex(folder, prompt, { resolve = resolveAgentCli, run = runAt, ...options } = {}) {
  const binary = await resolve(folder, 'codex', options);
  return runSuggestion(run, folder, binary, ['exec', '--sandbox', 'read-only', `${NAMING}\n\n${prompt}`], parseWslPath(folder)?.path || folder);
}

// A name for the task's branch, which the selected agent thinks of in the style of the
// repository's recent branches. Resolves { name } or { error }; the name may still be taken
// (planWorktree says so).
// The other options (extensionsDir and so on) go on to the agent's CLI lookup.
/**
 * @param {string} folder
 * @param {{ kind: string, number?: number, title?: string, text?: string }} task
 * @param {{ ask?: Function | null, agent?: string, extensionsDir?: string, [key: string]: any }} [options]
 */
async function suggestBranch(folder, task, { ask = null, agent = 'claude', ...options } = {}) {
  const branches = await recentBranches(folder).catch(() => []);
  let output;
  const command = agent === 'codex' ? 'codex' : 'claude';
  try {
    output = await (ask || (command === 'codex' ? askCodex : askClaude))(folder, namingPrompt(task, branches), options);
  } catch (error) {
    return { error: t('Could not suggest a name: {reason}', { reason: cliFailureMessage(command, folder, error) }) };
  }
  if (authenticationFailure(output)) return { error: t('Could not suggest a name: {reason}', { reason: authenticationMessage(command, folder) }) };
  const name = branchNameIn(output);
  if (name) return { name };
  const said = String(output).trim().split(/\r?\n/)[0] || t('(empty)');
  return { error: t('Could not suggest a name: {reason}', { reason: said }) };
}

// What the new worktree's first conversation starts with in its input, for the user to send
// or change; null when there is no task. A worktree made from a pull request is for reviewing
// it. In the UI language, which Claude then answers in.
function firstPrompt(task) {
  if (!task) return null;
  const words = { number: task.number, title: task.title };
  if (task.kind === 'issue') return t('Implement GitHub issue #{number} "{title}"', words);
  if (task.kind === 'pull') return t('Review GitHub PR #{number} "{title}"', words);
  return task.text;
}

module.exports = {
  branchNameIn,
  checkedTask,
  describeTask,
  firstPrompt,
  askCodex,
  askClaude,
  issueOf,
  namingPrompt,
  parseTask,
  pullBranch,
  pullRequestOf,
  suggestBranch,
};
