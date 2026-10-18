// The side bar's renders held while a pointer is pressed on the page, apart from the page so it
// can be tested. A click goes to the element both pressed and released on, and the page makes its
// rows again on every render (renderSection in sidebar.js): a row made again in between is not
// that element any more, and the click does nothing. The window coming to the front makes them
// again several times within a second or two (its tabs' state, their branches, then the worktrees
// and pull requests of the expanded repositories), just as the click that brought it there is let
// go. The page loads this as a plain script; the tests require it.

// How long a press holds the renders at most: the page may never hear of its release.
const PRESS_HOLD = 2000;

// Renders (`render`) when asked (`request`), at most once a frame (`frame`): the asks come in
// bursts, and each render makes every row again. Unless a pointer is pressed (`press`): then
// once, after it is let go (`release`) and its click has been handled, or after `limit` ms.
// `flush` renders a render asked for at once, for a caller that reads the rows next.
function pressHold(render, limit = PRESS_HOLD, frame = (fn) => requestAnimationFrame(fn)) {
  let pressed = false;
  let held = false;
  let queued = false;
  let timer = null;
  const now = () => {
    queued = false;
    held = false;
    render();
  };
  const end = () => {
    clearTimeout(timer);
    timer = null;
    pressed = false;
    if (held) now();
  };
  return {
    request() {
      if (pressed) held = true;
      if (pressed || queued) return;
      queued = true;
      frame(() => {
        if (!queued) return;
        queued = false;
        if (pressed) held = true;
        else render();
      });
    },
    flush() {
      if (queued && !pressed) now();
    },
    press() {
      clearTimeout(timer);
      pressed = true;
      timer = setTimeout(end, limit);
    },
    // Chromium dispatches the click right after the release, in the same task, so the renders
    // wait for the next one. A press again before then (a double click) holds them on.
    release() {
      if (!pressed) return;
      clearTimeout(timer);
      timer = setTimeout(end, 0);
    },
  };
}

if (typeof module === 'object') module.exports = { PRESS_HOLD, pressHold };
