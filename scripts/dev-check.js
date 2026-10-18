// End-to-end badge check: opens two worktrees, sends a prompt in one, switches to the other,
// and follows the first tab's badge: working -> waiting -> (switch back and approve, as a
// person would) -> done while in the background -> cleared when looked at.
//
// usage: node scripts/dev-check.js <other worktree> <worktree to prompt> <prompt>
const { approveFirstOption, badges, call, log, openClaudePanel, run, sendPrompt, sleep, until } = require('./dev-lib');

const [OTHER, TARGET, ...words] = process.argv.slice(2);
const PROMPT = words.join(' ');

run(async () => {
  await until('control port', () => call('state'), 60000);
  const other = await call('open', { folder: OTHER, activate: true });
  const target = await call('open', { folder: TARGET, activate: true });
  const targetName = (await call('state')).tabs.find((t) => t.id === target).name;
  log('opened', { other, target });

  await until('both servers running', async () => {
    const state = await call('state');
    return state.tabs.filter((t) => [other, target].includes(t.id)).every((t) => t.server === 'running');
  });
  log('servers running', JSON.stringify(await badges()));

  await openClaudePanel(target);
  log('Claude panel ready');
  await sendPrompt(target, PROMPT);
  await call('activate', { id: other });
  log('prompt sent, switched to the other tab');

  const seen = [];
  let approvals = 0;
  for (const deadline = Date.now() + 240000; Date.now() < deadline; ) {
    const badge = (await badges())[targetName];
    if (seen[seen.length - 1] !== badge) {
      seen.push(badge);
      log(`badge ${targetName}: ${badge}`);
    }
    if (badge === 'done') break;
    if (badge === 'waiting') {
      await call('activate', { id: target });
      log(`approved: ${await approveFirstOption(target)}`);
      approvals += 1;
      await call('activate', { id: other });
      // Wait for the badge to leave "waiting" so the same prompt is not answered twice.
      await until('badge to leave waiting', async () => (await badges())[targetName] !== 'waiting', 15000, 300).catch(() => {});
    } else {
      await sleep(700);
    }
  }
  log('badge history', seen.join(' -> '), `approvals=${approvals}`);
  const tabs = (await call('state')).tabs;
  log('tabs', JSON.stringify(tabs.map((t) => ({ name: t.name, server: t.server, agent: t.agent, unread: t.unread }))));

  await call('activate', { id: target });
  await sleep(500);
  log('after looking at the tab', JSON.stringify(await badges()));
  log('sessions', JSON.stringify((await call('state')).sessions));
});
