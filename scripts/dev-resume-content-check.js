// Checks that a conversation's content survives suspend/resume: sends a short prompt that
// needs no tools, waits for Stop, suspends the tab, selects it again, and looks for the
// earlier exchange in the restored Claude panel.
//
// usage: node scripts/dev-resume-content-check.js <tab name>
const { call, inPanel, log, openClaudePanel, run, sendPrompt, sleep, tabNamed, until } = require('./dev-lib');

const NAME = process.argv[2];
const MARKER = `resume-check-${Date.now()}`;

run(async () => {
  const tab = await tabNamed(NAME);
  await call('activate', { id: tab.id });
  await until('server running', async () => (await tabNamed(NAME)).server === 'running', 60000);
  await openClaudePanel(tab.id);
  const count = async () => {
    const text = await inPanel(tab.id, 'document.body.innerText');
    return text ? text.split(MARKER).length - 1 : 0;
  };
  await sendPrompt(tab.id, `Reply with "${MARKER}" and nothing else. Do not use any tools.`);
  await until('working', async () => (await tabNamed(NAME)).agent === 'working', 60000, 300);
  await until('Stop', async () => (await tabNamed(NAME)).agent === 'done', 120000, 500);
  await sleep(2000);
  const before = await count();
  const session = (await call('state')).sessions.find((s) => s.tabId === tab.id);
  log(`answered (session ${session && session.id}); marker appears ${before} time(s)`);

  await call('suspend', { id: tab.id });
  await sleep(1500);
  log('suspended:', (await tabNamed(NAME)).server);
  await call('activate', { id: tab.id });

  const after = await until('restored conversation', async () => ((await count()) >= before ? count() : undefined), 90000);
  log(`restored: marker appears ${after} time(s) (before suspend: ${before})`);
  log('sessions after resume', JSON.stringify((await call('state')).sessions));
});
