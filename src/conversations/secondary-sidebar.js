// The view in the secondary side bar (on the right) of a tab's VS Code. VS Code 1.139 shows that
// side bar by default (workbench.secondarySideBar.defaultVisibility is visibleInWorkspace), with
// its own chat first (workbench.panel.chat), which chat.disableAIFeatures leaves empty. The Claude
// Code chat is only an icon at its top until it is clicked, and until then the Claude Code
// extension does not build it: the conversation it held does not come back, nor does its claude
// start, so the app's side bar has no row for it. VS Code Web keeps which view it showed per
// origin (port), so this happens on every new port: a tab opened for the first time (a new
// worktree's), or one whose port was taken.

const { sleep } = require('../util');

// VS Code's own chat, the view the secondary side bar shows first.
const BUILT_IN_CHAT = 'workbench.panel.chat';

// Run in a tab's page: the id of the view container the secondary side bar shows, 'hidden' when
// that side bar is closed, or null while the page cannot tell yet (the workbench or the view is
// still being built). VS Code puts each view container it has opened there in an element of its
// own with the container's id (its title is a .composite too, without one), and hides all but
// the one shown.
const SECONDARY_VIEW_SCRIPT = `(() => {
  const bar = document.querySelector('.monaco-workbench .part.auxiliarybar');
  if (!bar) return null;
  if (!bar.checkVisibility()) return 'hidden';
  const view = [...bar.querySelectorAll('.composite[id]')].find((element) => element.checkVisibility());
  return view ? view.id : null;
})()`;

// The first answer of `read` that `told` takes, reading again every `interval` while the page
// cannot tell (an answer `told` does not take, or a read that fails). Resolves null when none of
// the `attempts` could tell.
async function firstAnswer(read, told, { attempts = 10, interval = 500 } = {}) {
  for (let attempt = 1; ; attempt++) {
    const answer = await Promise.resolve().then(read).catch(() => null);
    if (told(answer)) return answer;
    if (attempt >= attempts) return null;
    await sleep(interval);
  }
}

// What the secondary side bar shows, from `read` (SECONDARY_VIEW_SCRIPT in the page; null, or
// failing, when it cannot tell). The helper extension says it is up once VS Code has restored its
// views (onStartupFinished comes after that), so the first read tells; while one cannot, it reads
// again for a few seconds. Resolves null when none could tell.
function secondaryView(read, options) {
  return firstAnswer(read, (view) => typeof view === 'string', options);
}

// ---- The chat's width ----------------------------------------------------------------------
//
// VS Code shows the secondary side bar at its own width on a new port (300 pixels), narrow for
// the chat. A tab opened for the first time takes the width of the chat in its repository's
// primary, where the person sizes it to their liking; without one, the chat takes a third of the
// width it shares with the editor. VS Code keeps the width per port from then on, as it keeps one
// the person drags, so a tab opened before keeps its own.

// The chat's part of the width it shares with the editor: the editor gets twice as much.
const CHAT_SHARE = 1 / 3;
// The chat stays as wide as VS Code's default at least, and leaves the editor room for code: a
// width from the primary may have been read on a wider window, or set narrower than that.
const MIN_CHAT_WIDTH = 300;
const MIN_EDITOR_WIDTH = 400;

// Run in a tab's page: { chat, shared }, the width of the secondary side bar and the width it
// shares with the editor (the two together), or null when that side bar or the editor is not
// shown (closed, being built, or the side bar maximized over the editor). In CSS pixels, as VS
// Code keeps the side bar's width: a pixel width it keeps whatever the size of the window.
const CHAT_WIDTH_SCRIPT = `(() => {
  const bar = document.querySelector('.monaco-workbench .part.auxiliarybar');
  const editor = document.querySelector('.monaco-workbench .part.editor');
  if (!bar || !editor || !bar.checkVisibility() || !editor.checkVisibility()) return null;
  const chat = Math.round(bar.getBoundingClientRect().width);
  const shared = chat + Math.round(editor.getBoundingClientRect().width);
  return chat > 0 ? { chat, shared } : null;
})()`;

// Run in a tab's page: drags the sash between the editor and the secondary side bar, as the mouse
// would, so that the side bar is `width` wide, and returns { chat, shared } as CHAT_WIDTH_SCRIPT
// reads them after (VS Code keeps each part within its own limits), or null as it does. The
// extension API has no way to size a part, and VS Code keeps a width a drag leaves as it keeps
// one the person drags. A sash takes a mousedown on itself, then follows the mousemove and mouseup
// on its window (VS Code 1.139); an event of a script does not move the focus. The side bar is on
// the editor's right, or on its left when the primary side bar is on the right.
function resizeScript(width) {
  return `((width) => {
  const bar = document.querySelector('.monaco-workbench .part.auxiliarybar');
  const editor = document.querySelector('.monaco-workbench .part.editor');
  if (!bar || !editor || !bar.checkVisibility() || !editor.checkVisibility()) return null;
  const barBox = bar.getBoundingClientRect();
  const right = barBox.left >= editor.getBoundingClientRect().left;
  const edge = right ? barBox.left : barBox.right;
  const sash = [...document.querySelectorAll('.monaco-workbench .monaco-sash.vertical')].find((element) => {
    const box = element.getBoundingClientRect();
    return Math.abs(box.left + box.width / 2 - edge) <= 2 && box.top < barBox.bottom && box.bottom > barBox.top;
  });
  if (!sash) return null;
  const box = sash.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = (Math.max(box.top, barBox.top) + Math.min(box.bottom, barBox.bottom)) / 2;
  const to = x + (right ? barBox.width - width : width - barBox.width);
  const mouse = (clientX, buttons) => ({ bubbles: true, cancelable: true, view: window, clientX, clientY: y, button: 0, buttons });
  sash.dispatchEvent(new MouseEvent('mousedown', mouse(x, 1)));
  window.dispatchEvent(new MouseEvent('mousemove', mouse(to, 1)));
  window.dispatchEvent(new MouseEvent('mouseup', mouse(to, 0)));
  return ${CHAT_WIDTH_SCRIPT};
})(${JSON.stringify(width)})`;
}

// The width the chat of a tab opened for the first time takes, out of `shared` (CHAT_WIDTH_SCRIPT):
// `primary`, the width of the chat in the repository's primary, or a third of `shared` without
// one, within the bounds. A window too narrow for both bounds is shared as without one.
function chatWidth({ shared, primary = null }) {
  const third = Math.round(shared * CHAT_SHARE);
  const max = shared - MIN_EDITOR_WIDTH;
  if (max < MIN_CHAT_WIDTH) return third;
  const wanted = Number.isFinite(primary) && primary > 0 ? primary : third;
  return Math.round(Math.min(Math.max(wanted, MIN_CHAT_WIDTH), max));
}

// Repositories whose primary's chat width is kept: those read last.
const KEPT_WIDTHS = 200;

const isWidth = (width) => Number.isInteger(width) && width > 0;

// The width of the chat in each repository's primary, as last read from its tab, for the tabs
// opened while it does not run (after the app starts again, say). Kept in tabs.json (chatWidths:
// lowercase path of the main worktree -> CSS pixels), the one read longest ago first.
class ChatWidths {
  constructor({ limit = KEPT_WIDTHS } = {}) {
    this.limit = limit;
    this.widths = new Map();
  }

  // Takes chatWidths from tabs.json.
  load(saved) {
    this.widths.clear();
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
    for (const [repo, width] of Object.entries(saved)) if (isWidth(width)) this.widths.set(repo.toLowerCase(), width);
  }

  // The width last read of the repository's primary, or null.
  get(repo) {
    return this.widths.get(repo.toLowerCase()) ?? null;
  }

  // Keeps `width` as the one read last. Returns whether it changed.
  set(repo, width) {
    if (!isWidth(width)) return false;
    const key = repo.toLowerCase();
    const changed = this.widths.get(key) !== width;
    this.widths.delete(key);
    this.widths.set(key, width);
    return changed;
  }

  // chatWidths for tabs.json: the repositories read last, within the limit.
  toJSON() {
    return Object.fromEntries([...this.widths].slice(-this.limit));
  }
}

module.exports = {
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
};
