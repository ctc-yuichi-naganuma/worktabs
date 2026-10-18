const { webviewReactScript } = require('./webview-react');

// A successful URI dispatch is not proof that the requested chat rendered. Read the
// mounted local thread context, including busy composers whose permission control is disabled.
function visibleCodexThread(document, propsOf) {
  try {
    const pickers = [...document.querySelectorAll('[data-composer-navigation-target="permissions"]')]
      .filter((node) => node.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }));
    if (pickers.length !== 1) return null;
    const context = propsOf(pickers[0]).find((props) => props && Object.hasOwn(props, 'conversationId') && Object.hasOwn(props, 'hostId'));
    return context?.hostId === 'local' && typeof context.conversationId === 'string' ? context.conversationId : null;
  } catch { return null; }
}

function codexNavigationScript() {
  return webviewReactScript(`return (${visibleCodexThread})(document, (node) => { const found = reactAncestors(node); return found.available ? found.props : []; });`);
}

// Fresh official webviews can take several seconds to load after the helper's URI ack.
async function confirmCodexThread({ threadId, current, read, pause, timeout = 15000,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  let stopped = false, timer;
  const wait = async () => {
    while (!stopped && current()) {
      let shown;
      try { shown = await read(); } catch { shown = null; }
      if (stopped || !current()) return false;
      if (Array.isArray(shown) && shown.length === 1 && shown[0] === threadId) return true;
      await pause();
    }
    return false;
  };
  try {
    return await Promise.race([wait(), new Promise((resolve) => { timer = setTimer(resolve, timeout, false); })]);
  } finally { stopped = true; clearTimer(timer); }
}

module.exports = { visibleCodexThread, codexNavigationScript, confirmCodexThread };
