// The colors of the VS Code theme in the tab in front ({ scheme, contrast, vars }, see theme.js)
// go on the page's root in place of the defaults in sidebar.css. Before the app has read a
// theme, the side bar is light or dark as Windows is, as the tabs' VS Code is by default.
// Returns applyTheme(theme), having applied the default one.

function createPageTheme({ document, window }) {
  const darkMode = window.matchMedia('(prefers-color-scheme: dark)');
  let appliedTheme;

  function applyTheme(theme) {
    const key = JSON.stringify(theme);
    if (key === appliedTheme) return;
    appliedTheme = key;
    const root = document.documentElement;
    root.removeAttribute('style');
    if (theme) for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
    root.dataset.scheme = theme ? theme.scheme : darkMode.matches ? 'dark' : 'light';
    root.toggleAttribute('data-contrast', Boolean(theme && theme.contrast));
  }

  darkMode.addEventListener('change', () => {
    if (appliedTheme !== 'null') return;
    appliedTheme = undefined;
    applyTheme(null);
  });
  applyTheme(null);

  return applyTheme;
}

if (typeof module === 'object') module.exports = { createPageTheme };
