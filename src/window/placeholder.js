// The pages shown where there is no VS Code to show: the window without tabs, and a tab that is
// starting, suspended, or could not start. They take the side bar's colors (theme.js).
const { t } = require('../i18n');

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// A data: URL of a page with `title` and `detail`. `theme`: sidebarTheme's colors, or null
// before a tab's theme has been read, when it is light or dark as the system is. `lang`: the
// page's language.
function placeholderUrl(title, detail = '', theme = null, lang = 'en') {
  const colors = theme
    ? `:root { color-scheme: ${theme.scheme}; --bg: ${theme.vars['--bg']}; --fg: ${theme.vars['--text']}; --muted: ${theme.vars['--text-muted']}; }`
    : `:root { color-scheme: light dark; --bg: #ffffff; --fg: #333333; --muted: #6f6f6f; }
    @media (prefers-color-scheme: dark) { :root { --bg: #1e1e1e; --fg: #e6e6e6; --muted: #9d9d9d; } }`;
  const html = `<!doctype html><html lang="${lang}"><meta charset="utf-8"><style>
    ${colors}
    body { margin: 0; height: 100vh; display: grid; place-content: center; gap: 10px; padding: 0 24px;
      text-align: center; background: var(--bg); color: var(--fg);
      font: 14px/1.6 "Segoe UI", "Yu Gothic UI", system-ui, sans-serif; }
    h1 { margin: 0; font-size: 18px; font-weight: 600; }
    p { margin: 0; color: var(--muted); max-width: 640px; overflow-wrap: anywhere; }
  </style><h1>${escape(title)}</h1><p>${escape(detail)}</p>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

// The title and detail of a tab's page in the lifecycle's `state` ('initial', 'starting',
// 'suspended', 'error'). `preparing`: code-server and the extensions are still being made ready
// (startup-gate.js), which a tab starting waits for.
function tabPlaceholder(name, state, detail, preparing) {
  if (state === 'initial') detail = t('Suspended. Select the tab to start it.');
  else if (state === 'starting' && !detail) detail = preparing ? t('Preparing code-server and extensions…') : t('Starting code-server…');
  else if (state === 'suspended') detail = t('Suspended. Click the tab to start it. Claude conversations can be resumed from the history.');
  const title = state === 'error' ? t('Could not start {name}', { name }) : name;
  return { title, detail };
}

module.exports = { placeholderUrl, tabPlaceholder };
