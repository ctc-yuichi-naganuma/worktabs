// The dialog in front (see message-box.js), drawn in the colors of the VS Code theme in the tab in
// front. The main process shows this page over the whole window while a dialog is up, and hides
// it once none is left. dialogKey comes from keys.js; the form of the dialog that adds a
// worktree (showAddForm, hideAddForm, addFormKey) from add-worktree.js, that of the one that
// asks where to clone (showCloneForm, hideCloneForm, cloneFormKey) from clone.js, and the
// settings form from settings.js.

const SVG_NS = 'http://www.w3.org/2000/svg';
// VS Code's dialogs show the info icon for a question too; a question mark says more.
const ICONS = {
  info: [
    ['circle', { cx: 8, cy: 8, r: 6.5 }],
    ['path', { d: 'M8 7.25v4' }],
    ['circle', { cx: 8, cy: 5, r: 0.85, class: 'fill' }],
  ],
  question: [
    ['circle', { cx: 8, cy: 8, r: 6.5 }],
    ['path', { d: 'M6.2 6.3a1.85 1.85 0 1 1 2.6 1.7c-.5.25-.8.6-.8 1.15v.35' }],
    ['circle', { cx: 8, cy: 11.3, r: 0.85, class: 'fill' }],
  ],
  warning: [
    ['path', { d: 'M8 1.75 14.75 13.75H1.25Z' }],
    ['path', { d: 'M8 6v4' }],
    ['circle', { cx: 8, cy: 11.75, r: 0.85, class: 'fill' }],
  ],
  error: [
    ['circle', { cx: 8, cy: 8, r: 6.5 }],
    ['path', { d: 'm5.75 5.75 4.5 4.5m0-4.5-4.5 4.5' }],
  ],
};

const backdropEl = document.getElementById('backdrop');
const boxEl = document.getElementById('box');
const iconEl = document.getElementById('icon');
const messageEl = document.getElementById('message');
const detailEl = document.getElementById('detail');
const checkboxRowEl = document.getElementById('checkbox-row');
const checkboxEl = /** @type {HTMLInputElement} */ (document.getElementById('checkbox'));
const checkboxLabelEl = document.getElementById('checkbox-label');
const buttonsEl = document.getElementById('buttons');

// The dialog on the page ({ id, kind, type, message, detail, buttons, defaultId, cancelId,
// checkboxLabel, checkboxChecked }, of kind 'worktree' { id, kind, repo, name, github, ... }, or
// of kind 'clone' { id, kind, url, slug, place, dest, choices, ... }), null once it has been
// answered.
let shown = null;

function show(dialog) {
  if (shown && shown.id === dialog.id) return;
  shown = dialog;
  backdropEl.hidden = false;
  if (dialog.kind === 'worktree') {
    boxEl.hidden = true;
    hideCloneForm();
    hideSettingsForm();
    showAddForm(dialog);
    return;
  }
  if (dialog.kind === 'clone') {
    boxEl.hidden = true;
    hideAddForm();
    hideSettingsForm();
    showCloneForm(dialog);
    return;
  }
  if (dialog.kind === 'settings') {
    boxEl.hidden = true;
    hideAddForm();
    hideCloneForm();
    showSettingsForm(dialog);
    return;
  }
  hideAddForm();
  hideCloneForm();
  hideSettingsForm();
  boxEl.className = `box ${dialog.type}`;
  iconEl.replaceChildren();
  for (const [tag, attributes] of ICONS[dialog.type] || []) {
    const part = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) part.setAttribute(key, String(value));
    iconEl.append(part);
  }
  iconEl.toggleAttribute('hidden', !ICONS[dialog.type]);
  messageEl.textContent = dialog.message;
  detailEl.textContent = dialog.detail;
  detailEl.hidden = !dialog.detail;
  detailEl.scrollTop = 0;
  checkboxRowEl.hidden = !dialog.checkboxLabel;
  checkboxEl.checked = dialog.checkboxChecked;
  checkboxLabelEl.textContent = dialog.checkboxLabel;
  buttonsEl.replaceChildren(
    ...dialog.buttons.map((label, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      // The one Enter presses looks it.
      button.className = index === dialog.defaultId ? 'button primary' : 'button';
      button.textContent = label;
      button.dataset.index = String(index);
      button.addEventListener('click', () => answer(index));
      return button;
    }),
  );
  boxEl.hidden = false;
  window.getSelection().removeAllRanges();
  buttonElements()[dialog.defaultId].focus();
}

// The box goes first and the answer a frame later: the page is hidden with the backdrop only, so
// it does not show this dialog for a moment when it comes up again with another one.
function answer(response) {
  if (!shown) return;
  const { id } = shown;
  const checked = checkboxEl.checked;
  shown = null;
  boxEl.hidden = true;
  hideAddForm();
  hideCloneForm();
  hideSettingsForm();
  requestAnimationFrame(() => setTimeout(() => window.host.answer(id, response, checked)));
}

function buttonElements() {
  return /** @type {HTMLCollectionOf<HTMLButtonElement>} */ (buttonsEl.children);
}

// The checkbox and the buttons, in tab order.
/** @returns {HTMLElement[]} */
function controls() {
  return [...(checkboxRowEl.hidden ? [] : [checkboxEl]), ...buttonElements()];
}

window.addEventListener(
  'keydown',
  (event) => {
    if (!shown) return;
    if (shown.kind === 'worktree') {
      addFormKey(event);
      return;
    }
    if (shown.kind === 'clone') {
      cloneFormKey(event);
      return;
    }
    if (shown.kind === 'settings') {
      settingsFormKey(event);
      return;
    }
    const list = controls();
    const action = dialogKey(event, {
      controls: list.map((control) => (control === checkboxEl ? -1 : Number(control.dataset.index))),
      focused: list.indexOf(/** @type {HTMLElement} */ (document.activeElement)),
      defaultId: shown.defaultId,
      cancelId: shown.cancelId,
      selection: !window.getSelection().isCollapsed,
    });
    if (!action) return;
    event.preventDefault();
    if ('answer' in action) answer(action.answer);
    else if ('focus' in action) list[action.focus].focus();
    else if (action.copy) window.host.copy();
  },
  true,
);

// ---- Theme ------------------------------------------------------------------------------

// As in the side bar (sidebar.js): the colors of the VS Code theme in the tab in front go on the
// page's root in place of the defaults in dialog.css; before the app has read a theme, the
// dialog is light or dark as Windows is.
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

window.host.onShow((dialog, theme) => {
  applyTheme(theme);
  show(dialog);
});
window.host.onTheme((theme) => applyTheme(theme));
// A dialog that came up before the page had loaded.
window.host.ready().then(({ dialog, theme }) => {
  applyTheme(theme);
  if (dialog) show(dialog);
});
