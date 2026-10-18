const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BUILT_IN_CHAT,
  CHAT_WIDTH_SCRIPT,
  ChatWidths,
  MIN_CHAT_WIDTH,
  MIN_EDITOR_WIDTH,
  SECONDARY_VIEW_SCRIPT,
  chatWidth,
  firstAnswer,
  resizeScript,
  secondaryView,
} = require('../src/conversations/secondary-sidebar');

const CLAUDE = 'workbench.view.extension.claude-sidebar-secondary';

// Runs SECONDARY_VIEW_SCRIPT against a page whose secondary side bar is `bar`: { visible, views }
// with the view containers VS Code has opened there, [id, visible] each; no bar before the
// workbench is up.
function runScript(bar) {
  const element = bar && {
    checkVisibility: () => bar.visible,
    querySelectorAll: (selector) =>
      selector === '.composite[id]' ? bar.views.map(([id, visible]) => ({ id, checkVisibility: () => visible })) : [],
  };
  const document = { querySelector: (selector) => (selector === '.monaco-workbench .part.auxiliarybar' ? element : null) };
  return new Function('document', `return ${SECONDARY_VIEW_SCRIPT}`)(document);
}

test('SECONDARY_VIEW_SCRIPT names the view container the secondary side bar shows', () => {
  assert.equal(runScript({ visible: true, views: [[BUILT_IN_CHAT, true]] }), BUILT_IN_CHAT);
  // The views opened before are still there, hidden.
  assert.equal(runScript({ visible: true, views: [[BUILT_IN_CHAT, false], [CLAUDE, true]] }), CLAUDE);
});

test('SECONDARY_VIEW_SCRIPT tells a closed side bar from one still being built', () => {
  assert.equal(runScript({ visible: false, views: [[BUILT_IN_CHAT, true]] }), 'hidden');
  assert.equal(runScript({ visible: false, views: [] }), 'hidden');
  assert.equal(runScript({ visible: true, views: [] }), null);
  assert.equal(runScript({ visible: true, views: [[BUILT_IN_CHAT, false]] }), null);
  assert.equal(runScript(null), null);
});

// A read that gives `answers` one by one, and counts the reads.
function reads(...answers) {
  const read = () => {
    read.count++;
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return Promise.resolve(answer);
  };
  read.count = 0;
  return read;
}

test('secondaryView takes the first read that tells', async () => {
  const read = reads(BUILT_IN_CHAT, CLAUDE);
  assert.equal(await secondaryView(read, { interval: 0 }), BUILT_IN_CHAT);
  assert.equal(read.count, 1);
  assert.equal(await secondaryView(reads('hidden'), { interval: 0 }), 'hidden');
});

test('secondaryView reads again while the page cannot tell', async () => {
  const read = reads(null, new Error('page gone'), undefined, CLAUDE);
  assert.equal(await secondaryView(read, { interval: 0 }), CLAUDE);
  assert.equal(read.count, 4);
});

test('secondaryView gives up after its attempts', async () => {
  const read = reads(null, null, null, BUILT_IN_CHAT);
  assert.equal(await secondaryView(read, { attempts: 3, interval: 0 }), null);
  assert.equal(read.count, 3);
});

test('firstAnswer takes the first answer it is told to', async () => {
  const read = reads(null, { chat: 0 }, { chat: 420, shared: 1200 });
  assert.deepEqual(await firstAnswer(read, (answer) => answer?.chat > 0, { interval: 0 }), { chat: 420, shared: 1200 });
  assert.equal(read.count, 3);
});

// A workbench 1600 pixels wide: the activity bar (48), the primary side bar (300), the editor, the
// secondary side bar (300, on the right), and the sashes VS Code puts between them (4 wide,
// centered on each edge), one between two editor groups among them. `page` changes it: { bar,
// editor } as { left, width, visible }, `sashes` as the x of each sash's center. A drag of a sash
// on an edge of the side bar moves that edge as VS Code would; `events` records where each event
// went.
function makePage(page = {}) {
  const box = ({ left, width, top = 0, height = 900 }) => ({ left, width, top, height, right: left + width, bottom: top + height });
  const part = (layout) => ({
    layout,
    checkVisibility: () => layout.visible !== false,
    getBoundingClientRect: () => box(layout),
  });
  const bar = part({ left: 1300, width: 300, ...page.bar });
  const editor = part({ left: 348, width: 952, ...page.editor });
  const events = [];
  let drag = null;
  const sashes = (page.sashes || [48, 348, 800, 1300]).map((center) => ({
    getBoundingClientRect: () => box({ left: center - 2, width: 4 }),
    dispatchEvent: (event) => {
      events.push([`sash ${center}`, event.type, event.init.clientX]);
      if (event.type !== 'mousedown') return;
      const { left, width } = bar.layout;
      if (center === left) drag = { from: event.init.clientX, edge: 'left' };
      if (center === left + width) drag = { from: event.init.clientX, edge: 'right' };
    },
  }));
  const window = {
    dispatchEvent: (event) => {
      events.push(['window', event.type, event.init.clientX]);
      if (event.type !== 'mouseup' || !drag) return;
      const moved = event.init.clientX - drag.from;
      if (drag.edge === 'left') {
        bar.layout.left += moved;
        bar.layout.width -= moved;
        editor.layout.width += moved;
      } else {
        bar.layout.width += moved;
        editor.layout.left += moved;
        editor.layout.width -= moved;
      }
      drag = null;
    },
  };
  const document = {
    querySelector: (selector) =>
      ({ '.monaco-workbench .part.auxiliarybar': bar, '.monaco-workbench .part.editor': editor })[selector] || null,
    querySelectorAll: (selector) => (selector === '.monaco-workbench .monaco-sash.vertical' ? sashes : []),
  };
  class MouseEvent {
    constructor(type, init) {
      this.type = type;
      this.init = init;
    }
  }
  const run = (script) => new Function('document', 'window', 'MouseEvent', `return ${script}`)(document, window, MouseEvent);
  return { run, events };
}

test('CHAT_WIDTH_SCRIPT reads the chat and the width it shares with the editor', () => {
  assert.deepEqual(makePage().run(CHAT_WIDTH_SCRIPT), { chat: 300, shared: 1252 });
  assert.equal(makePage({ bar: { visible: false } }).run(CHAT_WIDTH_SCRIPT), null);
  // The side bar maximized over the editor.
  assert.equal(makePage({ editor: { visible: false } }).run(CHAT_WIDTH_SCRIPT), null);
});

test('resizeScript drags the sash on the side bar edge to the width', () => {
  const page = makePage();
  assert.deepEqual(page.run(resizeScript(417)), { chat: 417, shared: 1252 });
  // Not the sashes of the activity bar, the primary side bar or the editor groups.
  assert.deepEqual(page.events, [
    ['sash 1300', 'mousedown', 1300],
    ['window', 'mousemove', 1183],
    ['window', 'mouseup', 1183],
  ]);
});

test('resizeScript drags a side bar on the left of the editor the other way', () => {
  // The primary side bar on the right puts the secondary one on the left, after the activity bar.
  const page = makePage({ bar: { left: 48, width: 300 }, editor: { left: 348, width: 952 }, sashes: [48, 348, 1300] });
  assert.deepEqual(page.run(resizeScript(500)), { chat: 500, shared: 1252 });
  assert.deepEqual(page.events, [
    ['sash 348', 'mousedown', 348],
    ['window', 'mousemove', 548],
    ['window', 'mouseup', 548],
  ]);
});

test('resizeScript leaves a closed side bar, or one without a sash, alone', () => {
  const closed = makePage({ bar: { visible: false } });
  assert.equal(closed.run(resizeScript(500)), null);
  assert.deepEqual(closed.events, []);
  const noSash = makePage({ sashes: [48, 348] });
  assert.equal(noSash.run(resizeScript(500)), null);
  assert.deepEqual(noSash.events, []);
});

test('chatWidth gives a third of the shared width without a primary', () => {
  assert.equal(chatWidth({ shared: 1500 }), 500);
  assert.equal(chatWidth({ shared: 1500, primary: null }), 500);
  // Never narrower than VS Code's own width.
  assert.equal(chatWidth({ shared: 800 }), MIN_CHAT_WIDTH);
});

test("chatWidth takes the primary's width within the bounds", () => {
  assert.equal(chatWidth({ shared: 1500, primary: 640 }), 640);
  // Read on a wider window: the editor keeps its room.
  assert.equal(chatWidth({ shared: 1000, primary: 900 }), 1000 - MIN_EDITOR_WIDTH);
  // VS Code's default on the primary, or narrower.
  assert.equal(chatWidth({ shared: 1500, primary: 200 }), MIN_CHAT_WIDTH);
});

test('chatWidth shares a window too narrow for both bounds 2:1', () => {
  assert.equal(chatWidth({ shared: 600, primary: 500 }), 200);
  assert.equal(chatWidth({ shared: 600 }), 200);
});

test('ChatWidths keeps the width read last of each repository', () => {
  const widths = new ChatWidths();
  assert.equal(widths.get('C:\\repo'), null);
  assert.equal(widths.set('C:\\Repo', 640), true);
  assert.equal(widths.get('c:\\repo'), 640);
  assert.equal(widths.set('C:\\repo', 640), false);
  assert.equal(widths.set('C:\\repo', 0), false);
  assert.equal(widths.set('C:\\repo', 512.5), false);
  assert.deepEqual(widths.toJSON(), { 'c:\\repo': 640 });
});

test('ChatWidths keeps those read last within its limit, and loads tabs.json', () => {
  const widths = new ChatWidths({ limit: 2 });
  widths.set('a', 400);
  widths.set('b', 500);
  widths.set('a', 410);
  widths.set('c', 600);
  assert.deepEqual(widths.toJSON(), { a: 410, c: 600 });
  const loaded = new ChatWidths();
  loaded.load({ A: 400, b: 'wide', c: -1, d: 700 });
  assert.deepEqual(loaded.toJSON(), { a: 400, d: 700 });
  loaded.load(null);
  assert.deepEqual(loaded.toJSON(), {});
});
