const assert = require('node:assert/strict');
const test = require('node:test');
const { CHECKS_SOON, agentLabel, createSessionNotices } = require('../src/conversations/session-notices');

function setup({ focused = false, active = 'other', subagent = false, supported = true, platform = 'darwin' } = {}) {
  const calls = [];
  const shown = [];
  class Notification {
    static isSupported() { return supported; }
    constructor(options) { this.options = options; this.listeners = {}; }
    on(event, listener) { this.listeners[event] = listener; }
    show() { shown.push(this); }
  }
  const win = {
    isFocused: () => focused, isMinimized: () => true,
    restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus'),
    flashFrame: (on) => calls.push(['flash', on]),
  };
  const tab = { id: 't1', name: 'app', branch: 'fix', folder: '/src/app', repo: '/src/app' };
  const timers = [];
  const notices = createSessionNotices({
    Notification, platform, window: () => win, tabs: new Map([['t1', tab]]),
    sessions: {
      conversations: () => [{ id: 's1', title: 'Fix the bug' }],
      markUnread: (id) => calls.push(['unread', id]),
      isSubagent: () => subagent,
    },
    activeId: () => active,
    refreshSeen: () => calls.push('seen'),
    revealSession: (...args) => calls.push(['reveal', ...args]),
    refreshGit: (...args) => calls.push(['git', ...args]),
    refreshApproved: () => calls.push('approved'),
    schedule: (fn, delay) => { const timer = { fn, delay, cleared: false }; timers.push(timer); return timer; },
    cancel: (timer) => { if (timer) timer.cleared = true; },
  });
  return { notices, calls, shown, tab, timers };
}

test('a state names itself as the side bar does, and other words stay', () => {
  assert.equal(agentLabel('waiting'), 'Waiting for approval');
  assert.equal(agentLabel('codex'), 'codex');
});

test('a result in the background notifies, marks it unread, and reads git again', () => {
  const { notices, calls, shown, tab } = setup();
  notices.onSessionState('t1', 's1', 'done');
  assert.deepEqual(shown.map((n) => n.options), [{ title: 'app: Done', body: 'Fix the bug\nfix  /src/app' }]);
  assert.deepEqual(calls, [['unread', 's1'], 'seen', ['git', [tab], ['/src/app']]]);
  // A click brings the window to the front and opens the conversation.
  calls.length = 0;
  shown[0].listeners.click();
  assert.deepEqual(calls, ['restore', 'show', 'focus', ['reveal', 't1', 's1']]);
});

test('a conversation in view is not notified, and waiting flashes an unfocused window', () => {
  const inView = setup({ focused: true, active: 't1' });
  inView.notices.onSessionState('t1', 's1', 'waiting');
  assert.equal(inView.shown.length, 0);
  assert.deepEqual(inView.calls, []);
  const away = setup({ active: 't1' });
  away.notices.onSessionState('t1', 's1', 'waiting');
  assert.equal(away.shown.length, 1);
  assert.deepEqual(away.calls, [['flash', true]]);
});

test('a subagent finishing only reads git again', () => {
  const { notices, calls, shown } = setup({ subagent: true });
  notices.onSessionState('t1', 's1', 'done');
  notices.onSessionState('t1', 's1', 'error');
  assert.equal(shown.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'git');
});

test('Windows gets a toast that names the tab and the conversation', () => {
  const { notices, shown } = setup({ platform: 'win32' });
  notices.notify({ id: 't1', name: 'app', folder: 'C:\\src\\app' }, 'error', 's1');
  assert.match(shown[0].options.toastXml, /launch="[^"]*t1[^"]*"/);
  assert.match(shown[0].options.toastXml, /app: Error/);
});

test('a push reads the pull requests and checks again twice, once for the latest push', () => {
  const { notices, calls, timers } = setup();
  const push = { hook_event_name: 'PostToolUse', tool_input: { command: 'git push' } };
  notices.onToolUsed('t1', push);
  notices.onToolUsed('t1', push);
  notices.onToolUsed('t1', { hook_event_name: 'PostToolUse', tool_input: { command: 'ls' } });
  notices.onToolUsed('t1', { hook_event_name: 'PreToolUse', tool_input: { command: 'git push' } });
  assert.deepEqual(timers.map((timer) => [timer.delay, timer.cleared]), [[CHECKS_SOON[0], true], [CHECKS_SOON[1], true], [CHECKS_SOON[0], false], [CHECKS_SOON[1], false]]);
  timers[2].fn();
  assert.deepEqual(calls, [['git', [], ['/src/app']], 'approved']);
});

test('nothing is notified where notifications are not supported', () => {
  const { notices, shown } = setup({ supported: false });
  notices.onSessionState('t1', 's1', 'done');
  notices.notifyBranchDeleted('fix', 'abc123');
  assert.equal(shown.length, 0);
});
