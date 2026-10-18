// The form of the dialog that adds a worktree (see worktreeDialog in message-box.js): what the
// worktree is for, an issue, a pull request to review or the work in words (optional; words
// alone for a repository that is not on GitHub), and the name of its branch, which claude can
// think of from that (a pull request has its own). The main process reads the issue or pull
// request (describeTask in task.js), says what adding the branch would do (planWorktree), thinks
// of a name (suggestBranch) and makes the worktree. formKey comes from keys.js, answer from
// dialog.js.

const addEl = document.getElementById('add');
const addRepoEl = document.getElementById('add-repo');
const taskLabelEl = document.getElementById('add-task-label');
const taskEl = /** @type {HTMLInputElement} */ (document.getElementById('add-task'));
const taskHintEl = document.getElementById('add-task-hint');
const branchEl = /** @type {HTMLInputElement} */ (document.getElementById('add-branch'));
const branchHintEl = document.getElementById('add-branch-hint');
const suggestEl = /** @type {HTMLButtonElement} */ (document.getElementById('add-suggest'));
const createEl = /** @type {HTMLButtonElement} */ (document.getElementById('add-create'));
const cancelEl = /** @type {HTMLButtonElement} */ (document.getElementById('add-cancel'));

// Text that the main process reads as an issue or pull request (parseTask), which takes gh a
// moment.
const ISSUE_LIKE = /^#?\d+$|^https?:\/\/\S+\/(issues|pull)\/\d+/i;

// The form of the dialog on the page, null while none is:
//   dialog: the dialog ({ id, repo, name, github })
//   taskRead: the last read of the task field, { text, read, result } (result undefined until
//     it is read; describeTask's otherwise)
//   plan, planFor: what adding the branch would do (planWorktree's), and for what (planKey)
//   suggesting: while claude thinks of a name, the task text it thinks for
//   busy: while the worktree is being made
//   error: what went wrong with the name or the making, shown under the branch
let form = null;

function showAddForm(dialog) {
  if (form) clearTimers(form);
  form = { dialog, taskRead: null, taskTimer: null, plan: null, planFor: null, planTimer: null, suggesting: null, busy: false, error: null };
  addRepoEl.textContent = dialog.name;
  addRepoEl.title = dialog.repo;
  // Outside GitHub there is nothing for gh to read: the field is for words alone.
  taskLabelEl.textContent = dialog.github ? t('Issue, PR, or what to do (can be left empty)') : t('What to do (can be left empty)');
  taskEl.placeholder = dialog.github ? t('#20, the URL of an issue or PR, or what to do in a sentence') : t('What to do, in a sentence');
  taskEl.value = '';
  branchEl.value = '';
  addEl.hidden = false;
  update();
  taskEl.focus();
}

function hideAddForm() {
  if (form) clearTimers(form);
  form = null;
  addEl.hidden = true;
}

function clearTimers(current) {
  clearTimeout(current.taskTimer);
  clearTimeout(current.planTimer);
}

// ---- The task -----------------------------------------------------------------------------

// What the task field names, read once for each text: the promise of describeTask's answer.
function currentTask(current) {
  const text = taskEl.value;
  if (!current.taskRead || current.taskRead.text !== text) {
    const entry = { text, read: null, result: undefined };
    entry.read = window.host.worktree
      .task(current.dialog.repo, text)
      .catch((error) => ({ error: String(error.message || error) }))
      .then((result) => {
        entry.result = result;
        if (form === current) update();
        return result;
      });
    current.taskRead = entry;
  }
  return current.taskRead.read;
}

taskEl.addEventListener('input', () => {
  const current = form;
  if (!current) return;
  clearTimeout(current.taskTimer);
  current.taskTimer = setTimeout(() => {
    currentTask(current);
    // A pull request it names is what the branch would check out.
    if (branchEl.value.trim() && current.planFor !== planKey(branchEl.value)) loadPlan(current);
  }, 300);
  update();
});

// Whether the main process reads the text with gh (describeTask): what it takes for an issue or
// pull request, in a repository on GitHub. Elsewhere that is words too.
function readsGithub(text) {
  return form.dialog.github && ISSUE_LIKE.test(text);
}

// What the task field has read, once it has: describeTask's answer, else undefined.
function readTask() {
  const read = form.taskRead;
  return read && read.text === taskEl.value ? read.result : undefined;
}

const TEXT_HINT = t('Taken as what to do: for the branch name, and in the input box of a new Claude conversation.');
const NUMBER_HINT = t('Without a GitHub remote, issues cannot be read. Write what to do in a sentence, and a branch name can be suggested.');
const PULL_STATES = { MERGED: t('merged'), CLOSED: t('closed') };

// What the task field's text is taken for, under it. A pull request says which branch it
// comes from, owner:branch for one in a fork, as GitHub writes it.
function taskHint() {
  const text = taskEl.value.trim();
  if (!text) return [t('Write it and press "Suggest a branch name" or Enter, and the branch name below is suggested. The new worktree has it in the input box of a new Claude conversation.'), false];
  const result = readTask();
  if (result === undefined) return readsGithub(text) ? [t('Reading from GitHub…'), false] : [TEXT_HINT, false];
  if (result.error) return [result.error, true];
  // Not an error: the worktree is made all the same, with the number in the conversation's input.
  if (result.numberOnly) return [NUMBER_HINT, false];
  if (result.kind === 'issue') {
    const words = { number: result.number, title: result.title };
    return [result.state === 'CLOSED' ? t('#{number} {title} (closed)', words) : `#${result.number} ${result.title}`, false];
  }
  if (result.kind === 'pull') {
    const from = result.cross ? `${result.owner || t('deleted fork')}:${result.head}` : result.head;
    const notes = [t('branch {branch}', { branch: from }), PULL_STATES[result.state]].filter(Boolean).join(t(', '));
    return [t('PR #{number} {title} ({notes})', { number: result.number, title: result.title, notes }), false];
  }
  return [TEXT_HINT, false];
}

// ---- The branch ---------------------------------------------------------------------------

branchEl.addEventListener('input', () => {
  const current = form;
  if (!current) return;
  current.error = null;
  clearTimeout(current.planTimer);
  current.planTimer = setTimeout(() => loadPlan(current), 150);
  update();
});

// What a plan is for: the name, with the task's text when that may name a pull request, which
// the branch would check out.
function planKey(name) {
  const text = taskEl.value.trim();
  return readsGithub(text) ? `${name}\n${text}` : name;
}

// What adding the branch would do; for a pull request, once gh has read the task.
async function loadPlan(current) {
  const name = branchEl.value;
  const key = planKey(name);
  const task = readsGithub(taskEl.value.trim()) ? await currentTask(current) : null;
  if (form !== current || planKey(branchEl.value) !== key) return;
  const pull = task && task.kind === 'pull' ? task : null;
  const plan = await window.host.worktree.plan(current.dialog.repo, name, pull).catch((error) => ({ error: String(error.message || error) }));
  if (form !== current || planKey(branchEl.value) !== key) return;
  current.plan = plan;
  current.planFor = key;
  update();
}

// What adding the branch would do, or what went wrong, under it.
function branchHint() {
  const { plan } = form;
  if (form.busy) return [t('Creating…'), false];
  if (form.error) return [form.error, true];
  if (form.suggesting !== null) return [t('Thinking of a branch name…'), false];
  if (!branchEl.value.trim()) return [t('It is made in a folder next to the repository.'), false];
  if (form.planFor !== planKey(branchEl.value)) return [t('Checking…'), false];
  if (plan.error) return [plan.error, true];
  const words = { folder: `..\\${plan.folder.split(/[\\/]/).pop()}`, base: plan.base, branch: plan.branch, number: plan.number };
  const pull = readTask()?.kind === 'pull';
  const text = {
    new: () => t('Creates a new branch from {base} in {folder}', words),
    // For a pull request too: what the branch has is kept.
    local: () => (pull ? t('Checks out the existing branch {branch} in {folder} (the PR is not fetched)', words) : t('Checks out the existing branch {branch} in {folder}', words)),
    remote: () => t('Creates a branch that tracks {base} in {folder}', words),
    pull: () => (plan.track ? t('Fetches {base} and creates a branch that tracks it in {folder}', words) : t('Fetches PR #{number} and creates a new branch in {folder}', words)),
  }[plan.from]();
  if (plan.copies === 1) return [t('{plan}. Copies 1 file of .worktreeinclude', { plan: text }), false];
  if (plan.copies) return [t('{plan}. Copies {count} files of .worktreeinclude', { plan: text, count: plan.copies }), false];
  return [text, false];
}

// Asks claude for a name from the task, into the branch field (in place of what is there); a
// pull request's is the branch it is checked out into, without asking. A task changed meanwhile
// drops the name.
async function suggest() {
  const current = form;
  if (!current || current.busy || current.suggesting !== null || !taskEl.value.trim()) return;
  const text = taskEl.value;
  current.suggesting = text;
  current.error = null;
  update();
  const task = await currentTask(current);
  let result;
  if (task.error || task.kind === 'none') result = { error: task.error || t('Enter an issue, a PR, or what to do') };
  else if (task.numberOnly) result = { error: t('A number alone is not enough to suggest a branch name. Enter a branch name') };
  else if (task.kind === 'pull') result = { name: task.branch };
  else result = await window.host.worktree.suggest(current.dialog.repo, task).catch((error) => ({ error: String(error.message || error) }));
  if (form !== current) return;
  current.suggesting = null;
  if (taskEl.value !== text) {
    update();
    return;
  }
  if (result.error) current.error = result.error;
  else {
    branchEl.value = result.name;
    clearTimeout(current.planTimer);
    loadPlan(current);
  }
  update();
  // Enter then makes the worktree; the name can be changed first.
  branchEl.focus();
}

suggestEl.addEventListener('click', () => suggest());

// ---- Making it ----------------------------------------------------------------------------

// Makes the worktree once the task is read (an issue that could not be read stops it). The
// main process opens its tab; the dialog closes once it is there.
async function submit() {
  const current = form;
  if (!current || current.busy) return;
  // Without a name yet, Enter after the task asks for one: there is nothing to make yet.
  if (!branchEl.value.trim() && taskEl.value.trim() && current.suggesting === null) {
    suggest();
    return;
  }
  if (!branchEl.value.trim()) {
    current.error = current.suggesting !== null ? t('Wait until the name is suggested') : t('Enter a branch name');
    update();
    branchEl.focus();
    return;
  }
  current.busy = true;
  current.error = null;
  update();
  const task = await currentTask(current);
  if (form !== current) return;
  if (task.error) {
    current.busy = false;
    update();
    taskEl.focus();
    return;
  }
  const result = await window.host.worktree
    .create(current.dialog.repo, branchEl.value.trim(), task)
    .catch((error) => ({ error: String(error.message || error) }));
  if (form !== current) return;
  if (!result.error) {
    answer(0);
    return;
  }
  current.busy = false;
  current.error = result.error;
  update();
  branchEl.focus();
}

createEl.addEventListener('click', () => submit());

// Closing while the worktree is being made would not stop it; the dialog stays until it is done.
function cancelAdd() {
  if (form && !form.busy) answer(1);
}

cancelEl.addEventListener('click', () => cancelAdd());

// ---- Keys and state -----------------------------------------------------------------------

/** @returns {HTMLElement[]} */
function formControls() {
  // As they stand: the button beside the task field acts on it.
  return [taskEl, suggestEl, branchEl, createEl, cancelEl].filter((control) => !control.disabled);
}

// Keys in the form (see formKey), from dialog.js.
function addFormKey(event) {
  if (!form) return;
  const list = formControls();
  const focused = list.indexOf(/** @type {HTMLElement} */ (document.activeElement));
  const action = formKey(event, { count: list.length, focused, field: document.activeElement === taskEl || document.activeElement === branchEl });
  if (!action) return;
  event.preventDefault();
  if (action.submit) submit();
  else if ('press' in action) list[action.press].click();
  else if (action.cancel) cancelAdd();
  else if ('focus' in action) list[action.focus].focus();
}

function update() {
  if (!form) return;
  const [taskText, taskError] = taskHint();
  taskHintEl.textContent = taskText;
  taskHintEl.classList.toggle('error', taskError);
  const [branchText, branchError] = branchHint();
  branchHintEl.textContent = branchText;
  branchHintEl.classList.toggle('error', branchError);
  suggestEl.textContent = form.suggesting !== null ? t('Thinking…') : readTask()?.kind === 'pull' ? t("Use the PR's branch name") : t('Suggest a branch name');
  suggestEl.disabled = form.busy || form.suggesting !== null || !taskEl.value.trim() || Boolean(readTask()?.numberOnly);
  taskEl.disabled = form.busy;
  branchEl.disabled = form.busy;
  createEl.disabled = form.busy;
  cancelEl.disabled = form.busy;
}
