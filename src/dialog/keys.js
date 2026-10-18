// What a key does in a dialog (dialog.js, add-worktree.js), apart from the page so it can be
// tested. The page loads this as a plain script; the tests require it.

// `event`: the keydown ({ key, repeat, ctrlKey, shiftKey, altKey, metaKey }). `place`:
//   controls: the dialog's controls in tab order, each the index of its button, or -1 for the
//     checkbox
//   focused: the index in `controls` of the one with the focus, -1 when none has it (after a
//     click on the text, say)
//   defaultId, cancelId: the dialog's
//   selection: whether some of its text is selected
// Returns { answer: button index }, { focus: index in controls }, { copy: true } (the whole
// dialog, as Windows' dialogs do with Ctrl+C), { swallow: true } (the key does nothing), or null
// to leave the key to the page (Space on a button or the checkbox, Ctrl+C on a selection).
function dialogKey(event, { controls, focused, defaultId, cancelId, selection = false }) {
  const modifiers = event.ctrlKey || event.altKey || event.metaKey;
  const plain = !modifiers && !event.shiftKey;
  if ((event.key === 'Enter' || event.key === 'Escape') && plain) {
    // Held down, the key would answer the next dialog too, as it comes up.
    if (event.repeat) return { swallow: true };
    if (event.key === 'Escape') return { answer: cancelId };
    const button = focused >= 0 ? controls[focused] : -1;
    return { answer: button >= 0 ? button : defaultId };
  }
  // The focus goes round the dialog's controls only.
  if (event.key === 'Tab' && !modifiers) {
    const step = event.shiftKey ? -1 : 1;
    const from = focused >= 0 ? focused : event.shiftKey ? 0 : -1;
    return { focus: (from + step + controls.length) % controls.length };
  }
  // Left and right go along the buttons, as in VS Code's dialogs.
  if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && plain && focused >= 0 && controls[focused] >= 0) {
    const buttons = controls.map((control, index) => (control >= 0 ? index : -1)).filter((index) => index >= 0);
    const at = buttons.indexOf(focused);
    const step = event.key === 'ArrowLeft' ? -1 : 1;
    return { focus: buttons[(at + step + buttons.length) % buttons.length] };
  }
  if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'c' && !selection) {
    return { copy: true };
  }
  return null;
}

// What a key does in the form of the dialog that adds a worktree (add-worktree.js). `event` as
// above, with isComposing. `place`:
//   count: how many controls the form has, in tab order
//   focused: the index of the one with the focus, -1 when none has it
//   field: whether the focus is in a text field
// Returns { submit: true } (Enter in a field makes the worktree), { press: index } (Enter on a
// button), { cancel: true } (Esc), { focus: index }, { swallow: true }, or null to leave the key
// to the page: typing, Space on a button (which presses it), Ctrl+C and the like.
function formKey(event, { count, focused, field }) {
  // The input method's own while it composes: Enter takes the text, Esc drops it.
  if (event.isComposing) return null;
  const modifiers = event.ctrlKey || event.altKey || event.metaKey;
  const plain = !modifiers && !event.shiftKey;
  if ((event.key === 'Enter' || event.key === 'Escape') && plain) {
    // Held down, the key would answer the next dialog too, as it comes up.
    if (event.repeat) return { swallow: true };
    if (event.key === 'Escape') return { cancel: true };
    return field || focused < 0 ? { submit: true } : { press: focused };
  }
  if (event.key === 'Tab' && !modifiers && count > 0) {
    const step = event.shiftKey ? -1 : 1;
    const from = focused >= 0 ? focused : event.shiftKey ? 0 : -1;
    return { focus: (from + step + count) % count };
  }
  return null;
}

if (typeof module === 'object') module.exports = { dialogKey, formKey };
