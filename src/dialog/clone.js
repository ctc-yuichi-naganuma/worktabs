// The form of the dialog that asks where to clone a repository of the account with git, where
// there is no ghq to decide (see cloneDialog in message-box.js): the folder it goes into, which
// starts as the one cloned into last, or as one of where the listed repositories are (the
// choices under it), or is picked with "Browse…". The main process says whether it can go there
// (checkCloneDestination in main.js) and starts the clone, after which the dialog closes and its
// row in the side bar says it is being cloned. formKey comes from keys.js, answer from dialog.js.

const cloneEl = document.getElementById('clone');
const cloneRepoEl = document.getElementById('clone-repo');
const cloneNoteEl = document.getElementById('clone-note');
const cloneDestEl = /** @type {HTMLInputElement} */ (document.getElementById('clone-dest'));
const cloneBrowseEl = /** @type {HTMLButtonElement} */ (document.getElementById('clone-browse'));
const cloneHintEl = document.getElementById('clone-hint');
const cloneChoicesLabelEl = document.getElementById('clone-choices-label');
const cloneChoicesEl = document.getElementById('clone-choices');
const cloneStartEl = /** @type {HTMLButtonElement} */ (document.getElementById('clone-start'));
const cloneCancelEl = /** @type {HTMLButtonElement} */ (document.getElementById('clone-cancel'));

// The form of the dialog on the page, null while none is:
//   dialog: the dialog ({ id, url, slug, place, dest, choices })
//   checked: what the main process said of the folder in the field, { text, result } (result
//     undefined until it has)
//   busy: while the clone is being started (or a folder picked)
//   error: what went wrong starting it, shown under the field
let cloneForm = null;

function showCloneForm(dialog) {
  if (cloneForm) clearTimeout(cloneForm.timer);
  cloneForm = { dialog, checked: null, timer: null, busy: false, error: null };
  cloneRepoEl.textContent = dialog.slug;
  cloneRepoEl.title = dialog.url;
  cloneNoteEl.textContent = dialog.place
    ? t('ghq is not found, so git clone clones it ({place}). The cloned folder is added to the repository list in the sidebar.', { place: dialog.place })
    : t('ghq is not found, so git clone clones it. The cloned folder is added to the repository list in the sidebar.');
  cloneDestEl.value = dialog.dest;
  cloneChoicesEl.replaceChildren(...dialog.choices.map(choiceButton));
  cloneChoicesEl.hidden = !dialog.choices.length;
  cloneChoicesLabelEl.hidden = !dialog.choices.length;
  cloneEl.hidden = false;
  checkClone(cloneForm);
  cloneDestEl.focus();
  // The end of the path, where the repository's own name is, shows.
  cloneDestEl.setSelectionRange(cloneDestEl.value.length, cloneDestEl.value.length);
}

function hideCloneForm() {
  if (cloneForm) clearTimeout(cloneForm.timer);
  cloneForm = null;
  cloneEl.hidden = true;
}

// A place where the listed repositories are: the folder the repository would go into there, and
// how many are there.
function choiceButton({ dest, count }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'choice';
  const where = document.createElement('span');
  where.className = 'choice-path';
  where.textContent = dest;
  const many = document.createElement('span');
  many.className = 'choice-count';
  many.textContent = count === 1 ? t('1 repo') : t('{count} repos', { count });
  button.title = `${dest}\n${t('Repositories here: {count}', { count })}`;
  button.append(where, many);
  button.addEventListener('click', () => {
    if (!cloneForm || cloneForm.busy) return;
    setCloneDest(button.querySelector('.choice-path').textContent);
    cloneDestEl.focus();
  });
  return button;
}

function setCloneDest(dest) {
  cloneDestEl.value = dest;
  cloneForm.error = null;
  checkClone(cloneForm);
}

// Asks the main process whether the repository can go into the folder in the field.
async function checkClone(current) {
  const text = cloneDestEl.value;
  current.checked = { text, result: undefined };
  updateClone();
  const result = await window.host.clone.check(text).catch((error) => ({ error: String(error.message || error) }));
  if (cloneForm !== current || cloneDestEl.value !== text) return;
  current.checked = { text, result };
  updateClone();
}

cloneDestEl.addEventListener('input', () => {
  const current = cloneForm;
  if (!current) return;
  current.error = null;
  clearTimeout(current.timer);
  current.timer = setTimeout(() => checkClone(current), 150);
  updateClone();
});

// "Browse…": a folder picked has the repository go under it, as the main process says.
cloneBrowseEl.addEventListener('click', async () => {
  const current = cloneForm;
  if (!current || current.busy) return;
  current.busy = true;
  updateClone();
  const result = await window.host.clone.browse(cloneDestEl.value).catch(() => null);
  if (cloneForm !== current) return;
  current.busy = false;
  if (result && result.dest) setCloneDest(result.dest);
  else updateClone();
  cloneDestEl.focus();
});

// Starts the clone; the dialog closes once it has started.
async function submitClone() {
  const current = cloneForm;
  if (!current || current.busy) return;
  current.busy = true;
  current.error = null;
  updateClone();
  const result = await window.host.clone.start(cloneDestEl.value).catch((error) => ({ error: String(error.message || error) }));
  if (cloneForm !== current) return;
  if (!result.error) {
    answer(0);
    return;
  }
  current.busy = false;
  current.error = result.error;
  updateClone();
  cloneDestEl.focus();
}

cloneStartEl.addEventListener('click', () => submitClone());

function cancelClone() {
  if (cloneForm && !cloneForm.busy) answer(1);
}

cloneCancelEl.addEventListener('click', () => cancelClone());

// What the folder in the field comes to, under it.
function cloneHint() {
  if (cloneForm.error) return [cloneForm.error, true];
  const { checked } = cloneForm;
  if (!cloneDestEl.value.trim()) {
    return [
      cloneForm.dialog.choices.length
        ? t('Enter the folder to clone into, or pick one with "Browse…" or from the places below.')
        : t('Enter the folder to clone into, or pick one with "Browse…".'),
      false,
    ];
  }
  if (!checked || checked.text !== cloneDestEl.value || checked.result === undefined) return [t('Checking…'), false];
  const { result } = checked;
  if (result.error) return [result.error, true];
  return [result.linux ? t('Clones into {path} in WSL ({distro}).', { path: result.linux, distro: result.distro }) : t('Clones into {path}.', { path: result.dest }), false];
}

// ---- Keys and state -----------------------------------------------------------------------

// The destination buttons (see choiceButton).
function cloneChoices() {
  return /** @type {HTMLCollectionOf<HTMLButtonElement>} */ (cloneChoicesEl.children);
}

/** @returns {HTMLElement[]} */
function cloneControls() {
  return [cloneDestEl, cloneBrowseEl, ...cloneChoices(), cloneStartEl, cloneCancelEl].filter((control) => !control.disabled);
}

// Keys in the form (see formKey), from dialog.js: Enter in the field clones, on a button presses
// it.
function cloneFormKey(event) {
  if (!cloneForm) return;
  const list = cloneControls();
  const focused = list.indexOf(/** @type {HTMLElement} */ (document.activeElement));
  const action = formKey(event, { count: list.length, focused, field: document.activeElement === cloneDestEl });
  if (!action) return;
  event.preventDefault();
  if (action.submit) submitClone();
  else if ('press' in action) list[action.press].click();
  else if (action.cancel) cancelClone();
  else if ('focus' in action) list[action.focus].focus();
}

function updateClone() {
  if (!cloneForm) return;
  const [text, error] = cloneHint();
  cloneHintEl.textContent = text;
  cloneHintEl.classList.toggle('error', error);
  const dest = cloneDestEl.value.trim().toLowerCase();
  for (const button of cloneChoices()) {
    button.setAttribute('aria-pressed', String(button.querySelector('.choice-path').textContent.toLowerCase() === dest));
    button.disabled = cloneForm.busy;
  }
  cloneDestEl.disabled = cloneForm.busy;
  cloneBrowseEl.disabled = cloneForm.busy;
  cloneStartEl.disabled = cloneForm.busy;
  cloneCancelEl.disabled = cloneForm.busy;
}
