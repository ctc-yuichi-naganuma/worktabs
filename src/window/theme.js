// The side bar and the dialogs in the colors of the VS Code theme of the tab in front. VS Code
// writes every color of its theme as a CSS variable on the workbench (--vscode-sideBar-background,
// ...) and the theme's type as a class on it; the app reads them from the tab's page
// (THEME_SCRIPT) and turns them into the variables of the side bar and the dialogs
// (sidebarTheme). The colors that carry a meaning (the states, the WSL tag, Claude's usage) are
// not taken from the theme: the side bar has its own, a set for light themes and one for dark
// ones, so they mean the same in every theme.

// The VS Code colors the side bar and the dialogs take.
const COLORS = [
  'sideBar.background',
  'sideBar.foreground',
  'sideBar.border',
  'sideBarSectionHeader.background',
  'sideBarSectionHeader.foreground',
  'sideBarSectionHeader.border',
  'foreground',
  'descriptionForeground',
  'icon.foreground',
  'focusBorder',
  'contrastBorder',
  'contrastActiveBorder',
  'list.hoverBackground',
  'list.inactiveSelectionBackground',
  'list.inactiveSelectionForeground',
  'input.background',
  'input.foreground',
  'input.border',
  'input.placeholderForeground',
  'button.background',
  'button.foreground',
  'button.hoverBackground',
  'button.border',
  'button.secondaryBackground',
  'button.secondaryForeground',
  'button.secondaryHoverBackground',
  'toolbar.hoverBackground',
  'scrollbarSlider.background',
  // Those of VS Code's own dialogs.
  'editorWidget.background',
  'editorWidget.foreground',
  'widget.border',
  'widget.shadow',
  'checkbox.background',
  'checkbox.foreground',
  'checkbox.border',
  'problemsInfoIcon.foreground',
  'problemsWarningIcon.foreground',
  'problemsErrorIcon.foreground',
];

// Run in a tab's page: { kind, colors } with the theme's type ('vs', 'vs-dark', 'hc-black' or
// 'hc-light') and the COLORS by id, '' for those the theme leaves out; null before the
// workbench is up.
const THEME_SCRIPT = `(() => {
  const workbench = document.querySelector('.monaco-workbench');
  if (!workbench) return null;
  const style = getComputedStyle(workbench);
  const colors = {};
  for (const id of ${JSON.stringify(COLORS)}) colors[id] = style.getPropertyValue('--vscode-' + id.split('.').join('-')).trim();
  return { kind: ['vs', 'vs-dark', 'hc-black', 'hc-light'].find((name) => workbench.classList.contains(name)) || null, colors };
})()`;

// The theme's type -> the side bar's set of colors, and whether it is a high contrast theme.
const KINDS = {
  vs: { scheme: 'light', contrast: false },
  'vs-dark': { scheme: 'dark', contrast: false },
  'hc-light': { scheme: 'light', contrast: true },
  'hc-black': { scheme: 'dark', contrast: true },
};

// A color as VS Code writes them (#rgb to #rrggbbaa, rgb(), rgba()). The values come from a
// page and end up in the side bar's styles, so anything else is dropped.
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\))$/i;

const mix = (color, percent, base) => `color-mix(in srgb, ${color} ${percent}%, ${base})`;

// The icons of VS Code's dialogs, when the theme leaves them out: those of its default themes.
const ICON_COLORS = {
  light: { warning: '#bf8803', error: '#e51400' },
  dark: { warning: '#cca700', error: '#f14c4c' },
};

// The variables of the side bar and the dialogs (see sidebar.css and dialog.css) from what
// THEME_SCRIPT read: { scheme, contrast, vars }, or null when it read no theme. A color the
// theme leaves out falls back to what VS Code shows in its place, or is mixed from the theme's
// text and background.
function sidebarTheme(read) {
  if (!read || typeof read !== 'object' || !Object.hasOwn(KINDS, read.kind)) return null;
  const color = (id) => {
    const value = read.colors && read.colors[id];
    return typeof value === 'string' && COLOR.test(value.trim()) ? value.trim() : null;
  };
  const bg = color('sideBar.background');
  const text = color('sideBar.foreground') || color('foreground');
  if (!bg || !text) return null;
  const muted = color('descriptionForeground') || mix(text, 70, bg);
  const border = color('sideBar.border') || color('sideBarSectionHeader.border') || color('contrastBorder') || mix(text, 15, bg);
  const hover = color('list.hoverBackground') || 'transparent';
  const accent = color('focusBorder') || color('button.background') || text;
  const button = color('button.background') || accent;
  const inputBg = color('input.background') || bg;
  const inputBorder = color('input.border') || border;
  const icons = ICON_COLORS[KINDS[read.kind].scheme];
  return {
    ...KINDS[read.kind],
    vars: {
      '--bg': bg,
      '--text': text,
      '--text-muted': muted,
      '--border': border,
      '--row-hover': hover,
      '--row-active': color('list.inactiveSelectionBackground') || mix(text, 12, bg),
      '--active-text': color('list.inactiveSelectionForeground') || text,
      '--accent': accent,
      // High contrast themes outline the rows under the mouse and the selected one.
      '--outline': color('contrastActiveBorder') || 'transparent',
      '--section-bg': color('sideBarSectionHeader.background') || bg,
      '--section-text': color('sideBarSectionHeader.foreground') || text,
      '--icon': color('icon.foreground') || muted,
      '--icon-hover': color('toolbar.hoverBackground') || hover,
      '--input-bg': inputBg,
      '--input-text': color('input.foreground') || text,
      '--input-border': inputBorder,
      '--placeholder': color('input.placeholderForeground') || muted,
      '--button-bg': button,
      '--button-text': color('button.foreground') || bg,
      '--button-hover': color('button.hoverBackground') || button,
      // High contrast themes give buttons a border of their own.
      '--button-border': color('button.border') || button,
      '--button2-bg': color('button.secondaryBackground') || 'transparent',
      '--button2-text': color('button.secondaryForeground') || text,
      '--button2-hover': color('button.secondaryHoverBackground') || hover,
      '--scrollbar': color('scrollbarSlider.background') || mix(text, 30, 'transparent'),
      // The dialogs, as VS Code draws its own: in a widget's colors, with the theme's icon
      // colors. High contrast themes outline them instead of a shadow.
      '--dialog-bg': color('editorWidget.background') || bg,
      '--dialog-text': color('editorWidget.foreground') || text,
      '--dialog-border': color('widget.border') || color('contrastBorder') || 'transparent',
      '--dialog-shadow': color('widget.shadow') || 'transparent',
      '--checkbox-bg': color('checkbox.background') || inputBg,
      '--checkbox-text': color('checkbox.foreground') || text,
      '--checkbox-border': color('checkbox.border') || inputBorder,
      '--info-icon': color('problemsInfoIcon.foreground') || accent,
      '--warning-icon': color('problemsWarningIcon.foreground') || icons.warning,
      '--error-icon': color('problemsErrorIcon.foreground') || icons.error,
    },
  };
}

// The variables sidebarTheme sets, every one of them whatever the theme leaves out.
const VARS = Object.keys(sidebarTheme({ kind: 'vs', colors: { 'sideBar.background': '#ffffff', foreground: '#000000' } }).vars);

// A theme the side bar can use, as saved for the next start (theme.json): what sidebarTheme
// gave, else null. One saved by another version, with other variables, is null too: the tab in
// front gives its theme again once its VS Code is up.
function savedTheme(value) {
  if (!value || typeof value !== 'object' || !value.vars || typeof value.vars !== 'object') return null;
  if (!Object.values(KINDS).some((kind) => kind.scheme === value.scheme && kind.contrast === value.contrast)) return null;
  const names = Object.keys(value.vars);
  if (names.length !== VARS.length || !VARS.every((name) => names.includes(name))) return null;
  const valid = (css) => typeof css === 'string' && /^[#()0-9a-z.,%\s-]+$/i.test(css);
  return Object.values(value.vars).every(valid) ? { scheme: value.scheme, contrast: value.contrast, vars: value.vars } : null;
}

// The window's background under the views, which Electron takes as #rrggbb only (#aarrggbb
// would read the theme's #rrggbbaa wrongly): the theme's, when it is one, else null.
function windowBackground(theme) {
  const bg = theme && theme.vars['--bg'];
  return /^#[0-9a-f]{6}$/i.test(bg || '') ? bg : null;
}

module.exports = { COLORS, THEME_SCRIPT, sidebarTheme, savedTheme, windowBackground };
