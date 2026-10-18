const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ChatWidths } = require('../src/conversations/secondary-sidebar');
const { REPO_USED_LIMIT, createTabStore } = require('../src/tabs/tab-store');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktabs-tabs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'tabs.json');
  const restored = [];
  let at = 0;
  const lifecycle = {
    snapshot: () => ({ tabs: [{ folder: '/src/app' }], ports: { t1: 4000 } }),
    restore: (saved, present) => restored.push({ saved, present }),
  };
  const chatWidths = new ChatWidths();
  const store = createTabStore({ file, lifecycle, chatWidths, present: () => true, now: () => ++at });
  return { store, file, restored, chatWidths };
}

test('the tabs, the repositories used, and the chat widths are saved together', (t) => {
  const { store, file, chatWidths } = setup(t);
  store.markTabUsed({ repo: '/src/App', folder: '/src/App' });
  store.markTabUsed({ repo: null, folder: '/notes' });
  // Still being looked up: nothing.
  store.markTabUsed({ repo: undefined, folder: '/src/other' });
  chatWidths.set('/src/app', 420);
  store.save();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved.tabs, [{ folder: '/src/app' }]);
  assert.deepEqual(saved.repoUsed, { '/notes': 2, '/src/app': 1 });
  assert.deepEqual(saved.chatWidths, { '/src/app': 420 });
});

test('only the repositories used last are kept', (t) => {
  const { store, file } = setup(t);
  for (let i = 0; i < REPO_USED_LIMIT + 3; i++) store.markTabUsed({ repo: `/src/r${i}`, folder: `/src/r${i}` });
  store.save();
  const kept = Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).repoUsed);
  assert.equal(kept.length, REPO_USED_LIMIT);
  assert.equal(kept.includes('/src/r0'), false);
});

test('restoring takes back what was saved, and a missing or broken file changes nothing', (t) => {
  const { store, file, restored, chatWidths } = setup(t);
  store.restore();
  fs.writeFileSync(file, '{ broken');
  store.restore();
  assert.equal(restored.length, 0);
  fs.writeFileSync(file, JSON.stringify({ tabs: [], repoUsed: { '/src/app': 5, '/bad': 'x' }, chatWidths: { '/src/app': 300 } }));
  store.restore();
  assert.equal(restored.length, 1);
  assert.deepEqual(store.repoUsed(), { '/src/app': 5 });
  assert.equal(chatWidths.get('/src/app'), 300);
});
