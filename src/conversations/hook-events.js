// What the tabs' agents and helper extensions tell the app through the hook server (hooks.js),
// handed to the conversation store, the usage trackers, and the app. Paths from a tab in WSL are
// Linux paths: they are read here through \\wsl.localhost.
const path = require('path');
const { parseWslPath, windowsPath } = require('../wsl/wsl');

// A Linux path from a tab in WSL as the app reads it; any other path as it is.
function localPath(folder, target) {
  const wsl = parseWslPath(folder);
  return wsl && typeof target === 'string' && target.startsWith('/') ? windowsPath(wsl.distro, target) : target;
}

// The app reads the transcript, and compares the working folder with the tabs' folders, through
// \\wsl.localhost.
function localHookInput(folder, input) {
  if (!parseWslPath(folder)) return input;
  const local = { ...input };
  for (const key of ['transcript_path', 'cwd']) if (key in local) local[key] = localPath(folder, local[key]);
  return local;
}

const live = (tab) => Boolean(tab) && ['starting', 'running'].includes(tab.server);

function wireHooks({ hooks, tabs, sessions, usage, codexUsage, usagePolling, pushState, onToolUsed,
  helperRegistered, readTheme, reveal, exists }) {
  hooks.on('hook', (tabId, input, procId) => {
    sessions.handle(tabId, localHookInput(tabs.get(tabId)?.folder, input), procId);
    onToolUsed(tabId, input);
  });
  hooks.on('codex', (tabId, input, procId) => {
    const tab = tabs.get(tabId);
    if (!live(tab)) return;
    sessions.handleCodex(tabId, { ...input, cwd: localPath(tab.folder, input.cwd) }, procId);
  });
  hooks.on('usage', (input) => {
    if (usage.take(input)) pushState();
  });
  hooks.on('codex-observer', (tabId) => {
    const tab = tabs.get(tabId);
    if (live(tab)) tab.codexObserved = true;
  });
  hooks.on('codex-usage', (tabId, input, procId) => {
    if (!live(tabs.get(tabId))) return;
    if (codexUsage.take(tabId, procId, input)) pushState();
    if (input.type === 'codex-account') usagePolling.refresh('codex');
  });
  hooks.on('helper', helperRegistered);
  hooks.on('theme', (tabId) => {
    const tab = tabs.get(tabId);
    if (tab) readTheme(tab);
  });
  // "Reveal in File Explorer" (on macOS "Reveal in Finder") from the helper extension comes
  // here, since a program the extension host starts may not bring Explorer to the front.
  hooks.on('explore', (tabId, target) => {
    const tab = tabs.get(tabId);
    if (!tab) return;
    const local = localPath(tab.folder, target);
    if (path.isAbsolute(local) && exists(local)) reveal(local);
  });
}

module.exports = { localHookInput, localPath, wireHooks };
