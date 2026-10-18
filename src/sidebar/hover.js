// When a bar that comes up on hover shows and goes (the GitHub buttons under a repository's mark,
// see sidebar.js), apart from the page so it can be tested. It shows once the mouse has rested on
// its anchor for a while, so the mouse passing over the anchor on its way to a row brings nothing
// up over that row, and goes once the mouse has been off both the anchor and the bar for a while,
// so the mouse can cross the gap between them. The page loads this as a plain script; the tests
// require it.

const SHOW_DELAY = 300;
const HIDE_DELAY = 250;

// `show(key)` and `hide(key)` bring up and take away the bar of the anchor `key`. The page calls
// `enter(key)` as the mouse comes onto an anchor, `enterBar()` onto the bar, and `leave()` as it
// leaves either.
function hoverIntent({ show, hide, showDelay = SHOW_DELAY, hideDelay = HIDE_DELAY }) {
  let shown = null;
  let timer = null;
  const clear = () => {
    clearTimeout(timer);
    timer = null;
  };
  const take = () => {
    const key = shown;
    shown = null;
    if (key !== null) hide(key);
  };
  return {
    get shown() {
      return shown;
    },
    enter(key) {
      clear();
      if (key === shown) return;
      // Another anchor's bar stays until this one's comes, so passing over an anchor does not take
      // it away.
      timer = setTimeout(() => {
        timer = null;
        take();
        shown = key;
        show(key);
      }, showDelay);
    },
    enterBar() {
      if (shown !== null) clear();
    },
    leave() {
      clear();
      if (shown === null) return;
      timer = setTimeout(() => {
        timer = null;
        take();
      }, hideDelay);
    },
    // Takes the bar away at once (a press, a key, a scroll, the window losing the focus), and one
    // about to come.
    close() {
      clear();
      take();
    },
  };
}

if (typeof module === 'object') module.exports = { HIDE_DELAY, SHOW_DELAY, hoverIntent };
