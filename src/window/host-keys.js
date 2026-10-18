// Keys the host keeps for itself, from any view. Everything else goes to VS Code. None while a
// dialog is up: it has the focus, and the keys are its own. Resolves 'next' or 'previous' (switch
// tabs), 'paste' (config.pasteFallback), or null for a key the page keeps.
function hostKeyAction(input, { dialogOpen = false, pasteFallback = false, platform = process.platform } = {}) {
  if (input.type !== 'keyDown' || dialogOpen) return null;
  const ctrlAlt = input.control && input.alt && !input.shift && !input.meta;
  if (ctrlAlt && input.key === 'PageDown') return 'next';
  if (ctrlAlt && input.key === 'PageUp') return 'previous';
  // The modifier the platform's own shortcuts take: Cmd on macOS, Ctrl elsewhere.
  const ctrlOrCmd = platform === 'darwin' ? input.meta : input.control;
  if (pasteFallback && ctrlOrCmd && !input.alt && !input.shift && input.code === 'KeyV') return 'paste';
  return null;
}

module.exports = { hostKeyAction };
