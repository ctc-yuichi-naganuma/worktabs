const assert = require('node:assert/strict');
const test = require('node:test');
const { createTabRisks } = require('../src/tabs/tab-risks');

const tabOf = (id, { unsaved = 0, server = 'running', lastUsed = 0 } = {}) => ({
  id, name: id, server, lastUsed,
  view: { webContents: { executeJavaScript: async () => unsaved } },
});

function setup(tabList, { busy = [], unread = [], answer = 0, active = null } = {}) {
  const asked = [];
  const suspended = [];
  const risks = createTabRisks({
    tabs: new Map(tabList.map((tab) => [tab.id, tab])),
    sessions: {
      conversations: (id) => (busy.includes(id) ? [{ id: 's', agent: 'claude', state: 'working' }] : []),
      hasUnread: (id) => unread.includes(id),
    },
    messageBox: async (options) => { asked.push(options); return { response: answer }; },
    activeId: () => active,
    idleMinutes: () => 10,
    suspend: (tab, options) => suspended.push([tab.id, options]),
    now: () => 60 * 60 * 1000,
  });
  return { risks, asked, suspended };
}

test('unsaved editors count as a risk, and a stopped tab has none', async () => {
  const { risks } = setup([]);
  assert.deepEqual(await risks.stopRisks(tabOf('a')), []);
  assert.match((await risks.stopRisks(tabOf('a', { unsaved: 1 })))[0], /^1 file is not saved/);
  assert.match((await risks.stopRisks(tabOf('a', { unsaved: 3 })))[0], /^3 files are not saved/);
  assert.deepEqual(await risks.stopRisks(tabOf('a', { unsaved: 3, server: 'stopped' })), []);
});

test('stopping asks only when something would be lost, and goes ahead on the first button', async () => {
  const quiet = setup([]);
  assert.equal(await quiet.risks.confirmStop(tabOf('a'), 'close'), true);
  assert.equal(quiet.asked.length, 0);
  const keep = setup([], { answer: 1 });
  assert.equal(await keep.risks.confirmStop(tabOf('a', { unsaved: 1 }), 'suspend'), false);
  assert.deepEqual(keep.asked[0].buttons, ['Suspend', 'Cancel']);
  assert.equal(keep.asked[0].message, 'Suspending a will have these effects.');
});

test('closing tabs together asks once, with a line for each tab at risk', async () => {
  const tabs = [tabOf('a', { unsaved: 1 }), tabOf('b'), tabOf('c', { unsaved: 2 })];
  const { risks, asked } = setup(tabs);
  assert.equal(await risks.confirmCloseTogether(tabs, 'repo'), true);
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].detail.split('\n').map((line) => line.split(':')[0]), ['a', 'c']);
  assert.deepEqual((await risks.riskLines(['b', 'gone', 'a'])).map((line) => line.split(':')[0]), ['a']);
});

test('only idle background tabs with nothing to lose are suspended', async () => {
  const tabs = [
    tabOf('active'), tabOf('idle'), tabOf('recent', { lastUsed: 55 * 60 * 1000 }), tabOf('unread'),
    tabOf('busy'), tabOf('unsaved', { unsaved: 1 }), tabOf('stopped', { server: 'suspended' }),
  ];
  const { risks, suspended } = setup(tabs, { active: 'active', unread: ['unread'], busy: ['busy'] });
  await risks.suspendIdleTabs();
  assert.deepEqual(suspended, [['idle', { force: true }]]);
});
