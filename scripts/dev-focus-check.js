// Focus check for two Claude chats in one VS Code: one in the side bar and one on
// an editor tab. The focus passes from one chat to the other at once, as when the page gets the
// focus back (Chromium gives it to the chat that had it last) and a click lands on the other
// chat. Claude Code's chat moves the focus to its input a moment after its window gets the
// focus, without checking that it still has it, so without the app's guard the two chats take
// the focus from each other hundreds of times a second. The focus must stay on the second chat.
// Also checks that the side bar chat still takes the focus when VS Code gives it (the helper's
// /new-conversation, which a newly added worktree uses).
//
// usage: node scripts/dev-focus-check.js <worktree>
const { call, log, openClaudePanel, run, sleep, until } = require('./dev-lib');

const [FOLDER] = process.argv.slice(2);

// Runs `js` in each Claude chat frame of the tab, with `chat` set to 'sidebar' or 'editor'.
async function inChats(id, js) {
  const results = await call('eval', {
    id,
    target: 'webviews',
    js: `(() => {
      if (!document.querySelector('[aria-label="Message input"]')) return undefined;
      const chat = new URLSearchParams(location.search).get('purpose') === 'webviewView' ? 'sidebar' : 'editor';
      return (${js});
    })()`,
  });
  return results.filter((r) => r !== undefined && r !== null);
}

// Whether each chat has the focus, and whether its input does.
async function focusState(id) {
  const states = await inChats(id, `({ chat, frame: document.hasFocus(), input: document.activeElement === document.querySelector('[aria-label="Message input"]') })`);
  return Object.fromEntries(states.map((s) => [s.chat, s]));
}

run(async () => {
  await until('control port', () => call('state'), 60000);
  const id = await call('open', { folder: FOLDER, activate: true });
  await until('server running', async () => (await call('state')).tabs.find((t) => t.id === id)?.server === 'running');

  await openClaudePanel(id);
  await until('the helper extension', () => call('helper', { id, route: '/new-conversation' }), 60000, 2000);
  await until('chats in the side bar and on an editor tab', async () => {
    const chats = await inChats(id, 'chat');
    return chats.includes('sidebar') && chats.includes('editor');
  }, 60000, 1000);
  // VS Code gives the side bar chat the focus, and the chat moves it to its input.
  await until('the focus in the side bar chat input', async () => {
    const { sidebar } = await focusState(id);
    return sidebar?.frame && sidebar.input;
  }, 10000, 300);
  log('side bar chat input has the focus');

  await inChats(id, `(window.__focusCount = 0, window.addEventListener('focus', () => window.__focusCount++), true)`);
  // In one go: the editor chat's window gets the focus, then the side bar chat's.
  const moved = await call('eval', {
    id,
    js: `(() => {
      const chats = {};
      for (const outer of document.querySelectorAll('iframe')) {
        const inner = outer.contentDocument?.getElementById('active-frame')?.contentWindow;
        if (!inner?.document.querySelector('[aria-label="Message input"]')) continue;
        chats[new URL(outer.src).searchParams.get('purpose') === 'webviewView' ? 'sidebar' : 'editor'] = inner;
      }
      if (!chats.sidebar || !chats.editor) return false;
      chats.editor.focus();
      chats.sidebar.focus();
      return true;
    })()`,
  });
  if (!moved) throw new Error('could not find both chat windows');
  await sleep(1500);
  const counts = Object.fromEntries((await inChats(id, `[chat, window.__focusCount]`)).map(([chat, count]) => [chat, count]));
  const state = await focusState(id);
  log('focus events in 1.5 s:', JSON.stringify(counts), 'side bar has the focus:', state.sidebar.frame, 'input:', state.sidebar.input);
  const total = counts.sidebar + counts.editor;
  if (total > 4) throw new Error(`the chats took the focus from each other (${total} focus events)`);
  if (!state.sidebar.frame || !state.sidebar.input) throw new Error('the focus did not stay in the side bar chat input');
  log('OK');
});
