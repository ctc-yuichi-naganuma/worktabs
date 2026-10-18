const assert = require('node:assert/strict');
const test = require('node:test');
const { COLORS, THEME_SCRIPT, savedTheme, sidebarTheme, windowBackground } = require('../src/window/theme');

// Colors of VS Code's Dark Modern, as the workbench writes them.
const DARK_MODERN = {
  'sideBar.background': '#181818',
  'sideBar.foreground': '#cccccc',
  'sideBar.border': '#2b2b2b',
  'sideBarSectionHeader.background': '#181818',
  'sideBarSectionHeader.foreground': '#cccccc',
  'sideBarSectionHeader.border': '#2b2b2b',
  foreground: '#cccccc',
  descriptionForeground: '#9d9d9d',
  'icon.foreground': '#cccccc',
  focusBorder: '#0078d4',
  'list.hoverBackground': '#2a2d2e',
  'list.inactiveSelectionBackground': '#37373d',
  'input.background': '#313131',
  'input.foreground': '#cccccc',
  'input.border': '#3c3c3c',
  'input.placeholderForeground': '#989898',
  'button.background': '#0078d4',
  'button.foreground': '#ffffff',
  'button.hoverBackground': '#026ec1',
  'button.secondaryBackground': '#313131',
  'button.secondaryForeground': '#cccccc',
  'button.secondaryHoverBackground': '#3c3c3c',
  'toolbar.hoverBackground': 'rgba(90, 93, 94, 0.31)',
  'scrollbarSlider.background': 'rgba(121, 121, 121, 0.4)',
  'editorWidget.background': '#202020',
  'editorWidget.foreground': '#cccccc',
  'widget.border': '#313131',
  'widget.shadow': 'rgba(0, 0, 0, 0.36)',
  'checkbox.background': '#313131',
  'checkbox.foreground': '#cccccc',
  'checkbox.border': '#3c3c3c',
  'problemsInfoIcon.foreground': '#3794ff',
  'problemsWarningIcon.foreground': '#cca700',
  'problemsErrorIcon.foreground': '#f14c4c',
};

// Runs THEME_SCRIPT against a page whose workbench has `classes` and the CSS variables `vars`.
function runScript(workbench) {
  const document = { querySelector: (selector) => (selector === '.monaco-workbench' ? workbench : null) };
  const getComputedStyle = (element) => ({ getPropertyValue: (name) => (element.vars[name] === undefined ? '' : ` ${element.vars[name]}`) });
  return new Function('document', 'getComputedStyle', `return ${THEME_SCRIPT}`)(document, getComputedStyle);
}

test('THEME_SCRIPT reads the theme type and the colors from the workbench', () => {
  const vars = { '--vscode-sideBar-background': '#181818', '--vscode-list-hoverBackground': '#2a2d2e' };
  const read = runScript({ classList: { contains: (name) => ['monaco-workbench', 'vs-dark'].includes(name) }, vars });
  assert.equal(read.kind, 'vs-dark');
  assert.equal(read.colors['sideBar.background'], '#181818');
  assert.equal(read.colors['list.hoverBackground'], '#2a2d2e');
  assert.equal(read.colors['sideBar.border'], '');
  assert.deepEqual(Object.keys(read.colors), COLORS);
  assert.equal(runScript(null), null);
});

test('sidebarTheme takes the side bar colors of the theme', () => {
  const theme = sidebarTheme({ kind: 'vs-dark', colors: DARK_MODERN });
  assert.equal(theme.scheme, 'dark');
  assert.equal(theme.contrast, false);
  assert.equal(theme.vars['--bg'], '#181818');
  assert.equal(theme.vars['--text'], '#cccccc');
  assert.equal(theme.vars['--text-muted'], '#9d9d9d');
  assert.equal(theme.vars['--row-active'], '#37373d');
  assert.equal(theme.vars['--accent'], '#0078d4');
  assert.equal(theme.vars['--icon-hover'], 'rgba(90, 93, 94, 0.31)');
  assert.equal(theme.vars['--outline'], 'transparent');
});

test('sidebarTheme fills in what the theme leaves out', () => {
  const theme = sidebarTheme({ kind: 'vs', colors: { 'sideBar.background': '#fafafa', foreground: '#222222' } });
  assert.equal(theme.scheme, 'light');
  assert.equal(theme.vars['--text'], '#222222');
  assert.equal(theme.vars['--text-muted'], 'color-mix(in srgb, #222222 70%, #fafafa)');
  assert.equal(theme.vars['--input-border'], theme.vars['--border']);
  assert.equal(theme.vars['--button2-bg'], 'transparent');
  // Every variable has a value, so none is left from the defaults for another scheme.
  assert.deepEqual(Object.keys(theme.vars), Object.keys(sidebarTheme({ kind: 'vs-dark', colors: DARK_MODERN }).vars));
  for (const value of Object.values(theme.vars)) assert.ok(value);
});

test('sidebarTheme takes the colors of VS Code dialogs', () => {
  const theme = sidebarTheme({ kind: 'vs-dark', colors: DARK_MODERN });
  assert.equal(theme.vars['--dialog-bg'], '#202020');
  assert.equal(theme.vars['--dialog-text'], '#cccccc');
  assert.equal(theme.vars['--dialog-border'], '#313131');
  assert.equal(theme.vars['--dialog-shadow'], 'rgba(0, 0, 0, 0.36)');
  assert.equal(theme.vars['--checkbox-border'], '#3c3c3c');
  assert.equal(theme.vars['--warning-icon'], '#cca700');
});

test('sidebarTheme fills in the dialog colors the theme leaves out', () => {
  const light = sidebarTheme({ kind: 'vs', colors: { 'sideBar.background': '#fafafa', foreground: '#222222', focusBorder: '#005fb8' } });
  assert.equal(light.vars['--dialog-bg'], '#fafafa');
  assert.equal(light.vars['--dialog-text'], '#222222');
  assert.equal(light.vars['--dialog-border'], 'transparent');
  assert.equal(light.vars['--dialog-shadow'], 'transparent');
  assert.equal(light.vars['--checkbox-border'], light.vars['--input-border']);
  assert.equal(light.vars['--info-icon'], '#005fb8');
  // VS Code's own, for a light theme or a dark one.
  assert.equal(light.vars['--warning-icon'], '#bf8803');
  const dark = sidebarTheme({ kind: 'hc-black', colors: { 'sideBar.background': '#000000', foreground: '#ffffff', contrastBorder: '#6fc3df' } });
  assert.equal(dark.vars['--error-icon'], '#f14c4c');
  // A high contrast theme outlines the dialog.
  assert.equal(dark.vars['--dialog-border'], '#6fc3df');
});

test('sidebarTheme outlines rows in a high contrast theme', () => {
  const theme = sidebarTheme({
    kind: 'hc-black',
    colors: { ...DARK_MODERN, 'sideBar.background': '#000000', contrastActiveBorder: '#f38518', 'button.border': '#6fc3df' },
  });
  assert.equal(theme.scheme, 'dark');
  assert.equal(theme.contrast, true);
  assert.equal(theme.vars['--outline'], '#f38518');
  assert.equal(theme.vars['--button-border'], '#6fc3df');
  assert.equal(sidebarTheme({ kind: 'hc-light', colors: DARK_MODERN }).scheme, 'light');
});

test('sidebarTheme reads no theme without a type or a background, and drops what is not a color', () => {
  assert.equal(sidebarTheme(null), null);
  assert.equal(sidebarTheme({ kind: null, colors: DARK_MODERN }), null);
  assert.equal(sidebarTheme({ kind: 'toString', colors: DARK_MODERN }), null);
  assert.equal(sidebarTheme({ kind: 'vs-dark', colors: { ...DARK_MODERN, 'sideBar.background': '' } }), null);
  const theme = sidebarTheme({ kind: 'vs-dark', colors: { ...DARK_MODERN, descriptionForeground: 'red; } body { color: red' } });
  assert.equal(theme.vars['--text-muted'], 'color-mix(in srgb, #cccccc 70%, #181818)');
});

test('savedTheme takes a theme saved by the app, and nothing else', () => {
  const theme = sidebarTheme({ kind: 'vs-dark', colors: DARK_MODERN });
  assert.deepEqual(savedTheme(JSON.parse(JSON.stringify(theme))), theme);
  assert.equal(savedTheme(null), null);
  assert.equal(savedTheme({ ...theme, scheme: 'sepia' }), null);
  assert.equal(savedTheme({ ...theme, contrast: 'yes' }), null);
  const { '--bg': _bg, ...withoutBg } = theme.vars;
  assert.equal(savedTheme({ ...theme, vars: withoutBg }), null);
  assert.equal(savedTheme({ ...theme, vars: { ...theme.vars, '--bg': '</style><script>' } }), null);
});

test('windowBackground takes the theme background only as #rrggbb', () => {
  assert.equal(windowBackground(null), null);
  assert.equal(windowBackground(sidebarTheme({ kind: 'vs-dark', colors: DARK_MODERN })), '#181818');
  const translucent = sidebarTheme({ kind: 'vs-dark', colors: { ...DARK_MODERN, 'sideBar.background': '#181818cc' } });
  assert.equal(windowBackground(translucent), null);
});
