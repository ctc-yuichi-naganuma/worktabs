// The width of the side bar, which its right edge drags (sidebar.js), apart from Electron so it
// can be tested. Widths are in DIPs, as the window's are.

// Wide enough for the buttons at the top, and a few characters of a row's name.
const MIN_WIDTH = 180;
const MAX_WIDTH = 600;
// Room a narrow window keeps for the tab, down to the narrowest side bar.
const MIN_TAB_WIDTH = 320;
// When the configured width is not a number.
const DEFAULT_WIDTH = 260;

// The widths the side bar may take in a window whose content is `windowWidth` wide. A window
// narrower than the narrowest side bar is all side bar.
function sidebarLimits(windowWidth) {
  const room = Math.max(0, windowWidth);
  return {
    min: Math.min(MIN_WIDTH, room),
    max: Math.min(room, Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, room - MIN_TAB_WIDTH))),
  };
}

// The width the side bar shows at: `width` (dragged, or configured) within the limits. What was
// dragged is kept as it was, so the side bar gets it back as the window widens again.
function fitSidebarWidth(width, windowWidth) {
  const { min, max } = sidebarLimits(windowWidth);
  const wanted = Number.isFinite(width) ? Math.round(width) : DEFAULT_WIDTH;
  return Math.min(Math.max(wanted, min), max);
}

// A width saved in window.json, or null (the configured width then applies).
function savedSidebarWidth(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

module.exports = { DEFAULT_WIDTH, MAX_WIDTH, MIN_TAB_WIDTH, MIN_WIDTH, fitSidebarWidth, savedSidebarWidth, sidebarLimits };
