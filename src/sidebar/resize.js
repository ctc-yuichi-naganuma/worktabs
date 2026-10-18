// The right edge drags to change the side bar's width, and a double click on it goes back to the
// configured width. While it is dragged, the page covers the whole window (see main.js): it draws
// the side bar at the width dragged to, which the tab in front follows, and is transparent beyond.
// The page gives it the edge and its host; it wires its own pointer events.

function attachSidebarResize({ edge, host, window, document }) {
  // While the edge is dragged: { offset, width, moved, limits }.
  let drag = null;
  // The width the body is held at while the page may cover the window, else null.
  let heldWidth = null;

  function holdWidth(width) {
    heldWidth = width;
    document.body.style.width = width === null ? '' : `${width}px`;
    document.documentElement.classList.toggle('resizing', width !== null);
  }

  async function startResize(event) {
    if (event.button !== 0 || drag) return;
    edge.setPointerCapture(event.pointerId);
    // The second press of a double click comes while the page still covers the window.
    const width = heldWidth ?? window.innerWidth;
    const current = { offset: width - event.clientX, width, moved: false, limits: null };
    drag = current;
    holdWidth(width);
    const limits = await host.startResize().catch(() => null);
    if (drag !== current) return;
    if (limits) current.limits = limits;
    else endResize();
  }

  function moveResize(event) {
    const current = drag;
    if (!current || !current.limits) return;
    // Let go where the page could not tell (outside the window, say).
    if (!(event.buttons & 1)) {
      endResize();
      return;
    }
    const { min, max } = current.limits;
    const width = Math.min(Math.max(Math.round(event.clientX + current.offset), min), max);
    if (width === current.width) return;
    current.width = width;
    current.moved = true;
    holdWidth(width);
    // Chromium sends the mouse's moves once a frame at most, and so the tab follows.
    host.resize(width);
  }

  async function endResize() {
    const current = drag;
    if (!current) return;
    drag = null;
    const width = await host.endResize(current.moved ? current.width : null).catch(() => null);
    if (drag) return;
    if (width !== null) holdWidth(width);
    await sidebarFits();
    if (!drag) holdWidth(null);
  }

  // Resolves once the page is no wider than the width the body is held at, or after a moment. The
  // body follows the page again only then: until the side bar is back to its own width in the
  // window, the body would spread over the whole window.
  /** @returns {Promise<void>} */
  function sidebarFits() {
    return new Promise((resolve) => {
      const fits = () => heldWidth === null || window.innerWidth <= heldWidth;
      if (fits()) {
        resolve();
        return;
      }
      const done = () => {
        window.removeEventListener('resize', check);
        clearTimeout(timer);
        resolve();
      };
      const check = () => {
        if (fits()) done();
      };
      const timer = setTimeout(done, 500);
      window.addEventListener('resize', check);
    });
  }

  async function resetWidth() {
    const width = await host.resetWidth().catch(() => null);
    // The second press of the double click may still hold the body at the width dragged to.
    if (!drag && heldWidth !== null && width !== null) holdWidth(width);
  }

  edge.addEventListener('pointerdown', startResize);
  window.addEventListener('pointermove', moveResize);
  for (const name of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(name, endResize);
  edge.addEventListener('lostpointercapture', endResize);
  edge.addEventListener('dblclick', resetWidth);
}

if (typeof module === 'object') module.exports = { attachSidebarResize };
