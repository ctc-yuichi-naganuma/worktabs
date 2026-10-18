// What stopping or reloading a tab's VS Code would lose (an agent turn in progress, unsaved
// edits), asking before it, and suspending the tabs left idle. The tabs' pages and the dialogs are
// injected.
const { t } = require('../i18n');
const { sessionRisks } = require('../conversations/session-risks');

// What confirmStop says for each action: the button and the message.
function stopWords(action, name) {
  if (action === 'close') return { button: t('Close'), message: t('Closing {name} will have these effects.', { name }) };
  if (action === 'suspend') return { button: t('Suspend'), message: t('Suspending {name} will have these effects.', { name }) };
  if (action === 'restart') return { button: t('Restart'), message: t('Restarting {name} will have these effects.', { name }) };
  return { button: t('Reload'), message: t('Reloading {name} will have these effects.', { name }) };
}

// `activeId`, `idleMinutes` and `suspend` are for suspendIdleTabs.
function createTabRisks({ tabs, sessions, messageBox, activeId, idleMinutes, suspend, now = Date.now }) {
  // Number of editors with unsaved changes in the tab's VS Code (0 when it is not running).
  async function unsavedEditors(tab) {
    if (tab.server !== 'running') return 0;
    return tab.view.webContents
      .executeJavaScript("document.querySelectorAll('.tabs-container .tab.dirty').length")
      .catch(() => 0);
  }

  async function stopRisks(tab) {
    const risks = sessionRisks(sessions.conversations(tab.id));
    const unsaved = await unsavedEditors(tab);
    if (unsaved === 1) risks.push(t('1 file is not saved. Its changes may be lost.'));
    else if (unsaved) risks.push(t('{count} files are not saved. Their changes may be lost.', { count: unsaved }));
    return risks;
  }

  // A line for each of the tabs that stopping would lose something in, for a dialog that asks
  // once for all of them.
  async function tabRiskLines(tabList) {
    const lines = await Promise.all(tabList.map(async (tab) => {
      const risks = await stopRisks(tab);
      return risks.length ? `${tab.name}: ${risks.join(' ')}` : null;
    }));
    return lines.filter(Boolean);
  }

  function riskLines(ids) {
    return tabRiskLines(ids.map((id) => tabs.get(id)).filter(Boolean));
  }

  async function confirmed(message, button, detail) {
    const { response } = await messageBox({
      type: 'warning',
      buttons: [button, t('Cancel')],
      defaultId: 1,
      cancelId: 1,
      message,
      detail: detail.join('\n'),
    });
    return response === 0;
  }

  // Asks before an action ('close', 'suspend', 'restart' or 'reload') that stops or reloads the
  // tab's VS Code. Resolves true to go ahead.
  async function confirmStop(tab, action) {
    const risks = await stopRisks(tab);
    if (!risks.length) return true;
    const words = stopWords(action, tab.name);
    return confirmed(words.message, words.button, risks);
  }

  async function confirmCloseTogether(tabList, name) {
    const lines = await tabRiskLines(tabList);
    if (!lines.length) return true;
    return confirmed(t('Closing all the tabs of {name} will have these effects.', { name }), t('Close'), lines);
  }

  // Suspends background tabs that have been idle for idleMinutes. A tab is idle when none of its
  // conversations is working, waiting or holds an unread result.
  async function suspendIdleTabs() {
    const limit = idleMinutes() * 60 * 1000;
    for (const tab of tabs.values()) {
      if (tab.id === activeId() || tab.server !== 'running' || sessions.hasUnread(tab.id)) continue;
      if (now() - (tab.lastUsed || 0) <= limit) continue;
      // Busy conversations and unsaved edits keep the tab running.
      if ((await stopRisks(tab)).length) continue;
      suspend(tab, { force: true });
    }
  }

  return { stopRisks, riskLines, tabRiskLines, confirmStop, confirmCloseTogether, suspendIdleTabs };
}

module.exports = { createTabRisks };
