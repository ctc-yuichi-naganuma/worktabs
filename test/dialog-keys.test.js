const assert = require('node:assert/strict');
const test = require('node:test');
const { dialogKey, formKey } = require('../src/dialog/keys');

const key = (name, modifiers = {}) => ({ key: name, repeat: false, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...modifiers });

// The removal's confirmation: the checkbox, then Remove (0) and Cancel (1), with Cancel the
// default.
const REMOVAL = { controls: [-1, 0, 1], defaultId: 1, cancelId: 1 };

test('Enter presses the button with the focus, else the default one', () => {
  assert.deepEqual(dialogKey(key('Enter'), { ...REMOVAL, focused: 1 }), { answer: 0 });
  assert.deepEqual(dialogKey(key('Enter'), { ...REMOVAL, focused: 2 }), { answer: 1 });
  // On the checkbox, or on the text after a click.
  assert.deepEqual(dialogKey(key('Enter'), { ...REMOVAL, focused: 0 }), { answer: 1 });
  assert.deepEqual(dialogKey(key('Enter'), { ...REMOVAL, focused: -1 }), { answer: 1 });
  assert.equal(dialogKey(key('Enter', { ctrlKey: true }), { ...REMOVAL, focused: 1 }), null);
});

test('Esc presses the cancel button', () => {
  assert.deepEqual(dialogKey(key('Escape'), { controls: [0, 1], defaultId: 0, cancelId: 1, focused: 0 }), { answer: 1 });
  assert.deepEqual(dialogKey(key('Escape'), { controls: [0], defaultId: 0, cancelId: 0, focused: 0 }), { answer: 0 });
});

test('a held Enter or Esc does nothing, so it does not answer the next dialog too', () => {
  assert.deepEqual(dialogKey(key('Enter', { repeat: true }), { ...REMOVAL, focused: 1 }), { swallow: true });
  assert.deepEqual(dialogKey(key('Escape', { repeat: true }), { ...REMOVAL, focused: 1 }), { swallow: true });
});

test('Tab goes round the controls of the dialog only', () => {
  assert.deepEqual(dialogKey(key('Tab'), { ...REMOVAL, focused: 0 }), { focus: 1 });
  assert.deepEqual(dialogKey(key('Tab'), { ...REMOVAL, focused: 2 }), { focus: 0 });
  assert.deepEqual(dialogKey(key('Tab', { shiftKey: true }), { ...REMOVAL, focused: 0 }), { focus: 2 });
  assert.deepEqual(dialogKey(key('Tab', { shiftKey: true }), { ...REMOVAL, focused: 2 }), { focus: 1 });
  // From the text: the first, or with Shift the last.
  assert.deepEqual(dialogKey(key('Tab'), { ...REMOVAL, focused: -1 }), { focus: 0 });
  assert.deepEqual(dialogKey(key('Tab', { shiftKey: true }), { ...REMOVAL, focused: -1 }), { focus: 2 });
  assert.deepEqual(dialogKey(key('Tab'), { controls: [0], defaultId: 0, cancelId: 0, focused: 0 }), { focus: 0 });
});

test('left and right go along the buttons', () => {
  assert.deepEqual(dialogKey(key('ArrowRight'), { ...REMOVAL, focused: 1 }), { focus: 2 });
  assert.deepEqual(dialogKey(key('ArrowRight'), { ...REMOVAL, focused: 2 }), { focus: 1 });
  assert.deepEqual(dialogKey(key('ArrowLeft'), { ...REMOVAL, focused: 1 }), { focus: 2 });
  // Not from the checkbox.
  assert.equal(dialogKey(key('ArrowRight'), { ...REMOVAL, focused: 0 }), null);
});

test('Ctrl+C copies the whole dialog when nothing is selected', () => {
  assert.deepEqual(dialogKey(key('c', { ctrlKey: true }), { ...REMOVAL, focused: 1 }), { copy: true });
  assert.equal(dialogKey(key('c', { ctrlKey: true }), { ...REMOVAL, focused: -1, selection: true }), null);
});

test('other keys are left to the page', () => {
  assert.equal(dialogKey(key(' '), { ...REMOVAL, focused: 0 }), null);
  assert.equal(dialogKey(key('PageDown', { ctrlKey: true, altKey: true }), { ...REMOVAL, focused: 1 }), null);
});

// The form that adds a worktree: the task field, Suggest a branch name, the branch field, Create
// and Cancel.
const FORM = { count: 5 };

test('in the form, Enter in a field makes the worktree, and on a button presses that button', () => {
  assert.deepEqual(formKey(key('Enter'), { ...FORM, focused: 0, field: true }), { submit: true });
  assert.deepEqual(formKey(key('Enter'), { ...FORM, focused: 2, field: true }), { submit: true });
  assert.deepEqual(formKey(key('Enter'), { ...FORM, focused: -1, field: false }), { submit: true });
  assert.deepEqual(formKey(key('Enter'), { ...FORM, focused: 1, field: false }), { press: 1 });
  assert.deepEqual(formKey(key('Enter'), { ...FORM, focused: 4, field: false }), { press: 4 });
  assert.equal(formKey(key('Enter', { shiftKey: true }), { ...FORM, focused: 1, field: true }), null);
});

test('in the form, Esc closes it, and a held Enter or Esc does nothing', () => {
  assert.deepEqual(formKey(key('Escape'), { ...FORM, focused: 1, field: true }), { cancel: true });
  assert.deepEqual(formKey(key('Enter', { repeat: true }), { ...FORM, focused: 1, field: true }), { swallow: true });
  assert.deepEqual(formKey(key('Escape', { repeat: true }), { ...FORM, focused: 1, field: true }), { swallow: true });
});

test('in the form, the input method keeps Enter and Esc while it composes', () => {
  assert.equal(formKey(key('Enter', { isComposing: true }), { ...FORM, focused: 0, field: true }), null);
  assert.equal(formKey(key('Escape', { isComposing: true }), { ...FORM, focused: 0, field: true }), null);
});

test('in the form, Tab goes round its controls', () => {
  assert.deepEqual(formKey(key('Tab'), { ...FORM, focused: 0, field: true }), { focus: 1 });
  assert.deepEqual(formKey(key('Tab'), { ...FORM, focused: 4, field: false }), { focus: 0 });
  assert.deepEqual(formKey(key('Tab', { shiftKey: true }), { ...FORM, focused: 0, field: true }), { focus: 4 });
  assert.deepEqual(formKey(key('Tab'), { ...FORM, focused: -1, field: false }), { focus: 0 });
  // Typing and copying are the fields' own.
  assert.equal(formKey(key('a'), { ...FORM, focused: 0, field: true }), null);
  assert.equal(formKey(key('c', { ctrlKey: true }), { ...FORM, focused: 0, field: true }), null);
});
