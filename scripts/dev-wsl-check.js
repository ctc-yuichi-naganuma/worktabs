// WSL check: opens a worktree in WSL, has Claude run a command with its Bash tool, and checks
// where things run: the hooks come from a claude in the distribution (process ids named
// wsl:<distribution>:<pid>), the conversation works in the worktree, and closing the tab leaves
// none of its processes running in the distribution. The command's output (uname, code) is in
// the Claude panel; the terminal is checked by hand.
//
// usage: node scripts/dev-wsl-check.js <worktree in WSL (\\wsl.localhost\<distribution>\...)>
const { execFileSync } = require('child_process');
const { approveFirstOption, call, log, openClaudePanel, run, sendPrompt, until } = require('./dev-lib');
const { normalizeFolder, parseWslPath } = require('../src/wsl/wsl');

const FOLDER = process.argv[2] && normalizeFolder(process.argv[2]);
const wsl = parseWslPath(FOLDER);
const PROMPT = 'Run `uname -s; pwd; command -v code` with the Bash tool and show its output as it is';

// The processes in the distribution that the tab's code-server started: they all inherit its
// WORKTABS_TAB_ID.
function processesOf(tabId) {
  const script = 'grep -lzx "WORKTABS_TAB_ID=$1" /proc/[0-9]*/environ 2>/dev/null || true';
  return execFileSync('wsl.exe', ['-d', wsl.distro, '-e', 'sh', '-c', script, 'sh', tabId], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

run(async () => {
  if (!wsl) throw new Error('usage: node scripts/dev-wsl-check.js \\\\wsl.localhost\\<distribution>\\<worktree>');
  await until('control port', () => call('state'), 60000);
  const id = await call('open', { folder: FOLDER, activate: true });
  log('opened', id);
  // The first tab in a distribution downloads code-server and the extensions into it.
  await until('server running', async () => {
    const tab = (await call('state')).tabs.find((t) => t.id === id);
    if (tab.server === 'error') throw new Error(tab.error);
    return tab.server === 'running';
  }, 10 * 60 * 1000, 2000);
  log('running', `${processesOf(id).length} processes in ${wsl.distro}`);

  await openClaudePanel(id);
  await sendPrompt(id, PROMPT);
  log('prompt sent');
  await until('the turn to end', async () => {
    const tab = (await call('state')).tabs.find((t) => t.id === id);
    if (tab.agent === 'waiting') log(`approved: ${await approveFirstOption(id)}`);
    return tab.agent === 'done';
  }, 240000);

  const failures = [];
  const conversation = (await call('state')).tabs.find((t) => t.id === id).conversations.at(-1);
  const session = (await call('state')).sessions.find((s) => s.id === conversation.id);
  log('conversation', JSON.stringify(conversation));
  log('processes', JSON.stringify(session.procs));
  if (!session.procs.every((proc) => proc.startsWith(`wsl:${wsl.distro}:`))) failures.push('the hooks did not come from a claude in WSL');
  if (normalizeFolder(conversation.cwd || '').toLowerCase() !== FOLDER.toLowerCase()) failures.push(`the conversation works in ${conversation.cwd}`);

  await call('close', { id, force: true });
  await until('the tab\'s processes to end', async () => processesOf(id).length === 0, 15000).then(
    () => log('closed: no processes left'),
    () => failures.push(`processes left after closing: ${processesOf(id).join(' ')}`),
  );
  if (failures.length) throw new Error(failures.join('; '));
  log('OK');
});
