const { normalizeFolder } = require('../wsl/wsl');
const { reactAncestors, reactElementProps, webviewReactScript } = require('../conversations/webview-react');

// Whether the worktree root `root` is another worktree than the repository's main one `main`, so
// a linked one. Compare worktree roots, not the folder of a tab or the order tabs were opened in.
// (worktrees.js isLinkedWorktree instead looks at one folder's .git.)
function isOtherWorktree(root, main) {
  return !!root && !!main && normalizeFolder(root).toLowerCase() !== normalizeFolder(main).toLowerCase();
}

const ONBOARDING_SETTINGS = ['claudeCode.hideOnboarding'];

function onboardingSettings(linked) {
  return linked ? { 'claudeCode.hideOnboarding': true } : {};
}

// These functions run in the Codex webview. The first-run component's own completion
// callback writes its onboarding flags and returns to chat, including when its state is
// already complete (upstream #25146). Do not copy storage or navigate other routes.
function onboardingProbe(document) {
  try {
    const ids = new Set(['codex.legal.step.intro.title', 'codex.legal.continueButton', 'codex.legal.continue.apikey']);
    let reason = 'unknown-onboarding';
    for (const element of document.querySelectorAll('h1, button')) {
      const found = reactAncestors(element);
      if (!found.available) { reason = found.reason; continue; }
      let identified = false;
      for (const props of found.props) {
        const children = reactElementProps(props?.children, { maxDepth: 10, includeSelected: false });
        if (!children.available) { reason = children.reason; break; }
        if (props && (ids.has(props.id) || children.props.some((child) => ids.has(child.id)))) identified = true;
        if (identified && props && typeof props.onAccept === 'function' &&
            [0, 3].includes(props.initialStep) && typeof props.hasCloudAccess === 'boolean' &&
            (props.isUsingCopilotAuth === undefined || typeof props.isUsingCopilotAuth === 'boolean')) {
          return { available: true, snapshot: { complete: props.onAccept } };
        }
      }
    }
    return { available: false, reason };
  } catch { return { available: false, reason: 'unreadable-probe' }; }
}
function codexOnboardingSnapshot(document) {
  const found = onboardingProbe(document);
  return found.available ? found.snapshot : null;
}

function watchCodexOnboarding(snapshotOf, environment) {
  environment.worktabsCodexOnboarding?.dispose();
  const { document, MutationObserver, setTimeout, clearTimeout } = environment;
  let timer = null, stopped = false, busy = false;
  const attempted = new WeakSet();
  const state = { result: 'waiting', dispose };
  environment.worktabsCodexOnboarding = state;
  const schedule = () => {
    if (!stopped && timer === null) timer = setTimeout(check, 100);
  };
  async function check() {
    timer = null;
    if (stopped || busy) return;
    let snapshot;
    try { snapshot = snapshotOf(document); } catch { snapshot = null; }
    if (!snapshot) return;
    if (attempted.has(snapshot.complete)) return;
    attempted.add(snapshot.complete);
    busy = true;
    try {
      await snapshot.complete();
      if (!stopped) state.result = 'completed';
    } catch {
      // Keep the original UI usable when an extension changes or completion fails.
      if (!stopped) state.result = 'unavailable';
    } finally {
      busy = false;
      schedule();
    }
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  function dispose() {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    observer.disconnect();
  }
  schedule();
  return true;
}

function codexOnboardingScript() {
  return webviewReactScript(`const onboardingProbe = ${onboardingProbe}; const codexOnboardingSnapshot = ${codexOnboardingSnapshot}; return (${watchCodexOnboarding})(codexOnboardingSnapshot, window);`);
}

module.exports = { ONBOARDING_SETTINGS, isOtherWorktree, onboardingSettings, onboardingProbe, codexOnboardingSnapshot, watchCodexOnboarding, codexOnboardingScript };
