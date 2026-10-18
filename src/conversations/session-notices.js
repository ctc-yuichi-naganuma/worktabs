// What the app does as a conversation changes state: notifications (and clicks on them), the
// window flashing, unread results, and reading git and GitHub again. Electron's Notification and
// the window are injected, so fakes test it.
const { t } = require('../i18n');
const { startsChecks } = require('../repos/github');
const { launchArgs, toastXml } = require('./notifications');

// The name of a conversation's state, as the side bar shows it.
function agentLabel(state) {
  const labels = { working: t('Working'), waiting: t('Waiting for approval'), done: t('Done'), error: t('Error'), idle: t('Idle') };
  return labels[state] || state;
}

// The notifications shown, until clicked. Electron lets a Notification object go, and its click
// listener with it, once nothing holds it, while Windows keeps the toast in the notification
// center after it closes. The notification center keeps an app's last 20.
const KEPT_NOTIFICATIONS = 20;

// After Claude runs a command that makes GitHub start checks (a push, a merge; startsChecks in
// github.js), the side bar reads the repository's pull requests and checks again a moment later,
// and once more after that: GitHub takes a few seconds to add the checks to the commit, so the
// read as the turn ends may find none yet. The approved pull requests are read again with them:
// a merged one is approved no longer, nor may be one pushed to.
const CHECKS_SOON = [10 * 1000, 30 * 1000];

function createSessionNotices({ Notification, platform = process.platform, window, tabs, sessions,
  activeId, refreshSeen, revealSession, refreshGit, refreshApproved,
  schedule = setTimeout, cancel = clearTimeout }) {
  const shownNotifications = new Set();
  // Repository -> the timers of CHECKS_SOON.
  const checksTimers = new Map();

  function notify(tab, agent, sessionId) {
    if (!Notification.isSupported()) return;
    const conversation = sessions.conversations(tab.id).find((c) => c.id === sessionId);
    const name = conversation && (conversation.title || conversation.prompt);
    const place = tab.branch ? `${tab.branch}  ${tab.folder}` : tab.folder;
    const title = `${tab.name}: ${agentLabel(agent)}`;
    const body = name ? `${name}\n${place}` : place;
    // Windows takes the toast as XML, so that a click on one left in the notification center
    // still tells the app which tab and conversation it was. macOS has nothing of the kind: the
    // notification carries a title and a body, and only a running app hears the click.
    const notification = new Notification(
      platform === 'win32'
        ? { toastXml: toastXml({ title, body, launch: launchArgs(tab.id, sessionId) }) }
        : { title, body },
    );
    notification.on('click', () => {
      shownNotifications.delete(notification);
      openFromNotification(tab.id, sessionId);
    });
    shownNotifications.add(notification);
    if (shownNotifications.size > KEPT_NOTIFICATIONS) shownNotifications.delete(shownNotifications.values().next().value);
    notification.show();
  }

  // A click on a notification, or on one from before the app restarted (see notifications.js).
  // The tab may have been closed since.
  function openFromNotification(tabId, sessionId) {
    if (!window()) return;
    bringWindowToFront();
    revealSession(tabId, sessionId);
  }

  function bringWindowToFront() {
    const win = window();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  // Notifications follow tab/window visibility. Unread follows the exact conversation in view,
  // so a result behind another agent or conversation in the active tab is not missed.
  function onSessionState(tabId, sessionId, state) {
    const tab = tabs.get(tabId);
    const win = window();
    if (!tab || !win) return;
    // Child completions are reported to their parent. Avoid a separate unread notification
    // for every worker while keeping each child's thread available to inspect.
    if ((state === 'done' || state === 'error') && sessions.isSubagent(sessionId)) {
      if (state === 'done' && tab.repo) refreshGit([tab], [tab.repo]);
      return;
    }
    const unseen = tabId !== activeId() || !win.isFocused();
    if (state === 'done' || state === 'error') {
      sessions.markUnread(sessionId);
      refreshSeen();
    }
    if (unseen && (state === 'waiting' || state === 'done' || state === 'error')) notify(tab, state, sessionId);
    if (state === 'waiting' && !win.isFocused()) win.flashFrame(true);
    if (state === 'done' && tab.repo) refreshGit([tab], [tab.repo]);
  }

  function onToolUsed(tabId, input) {
    const repo = tabs.get(tabId)?.repo;
    if (!repo || input.hook_event_name !== 'PostToolUse' || !startsChecks(input.tool_input?.command)) return;
    for (const timer of checksTimers.get(repo) || []) cancel(timer);
    checksTimers.set(
      repo,
      CHECKS_SOON.map((delay) =>
        schedule(() => {
          refreshGit([], [repo]);
          refreshApproved();
        }, delay),
      ),
    );
  }

  // Without other branches or remotes to take them from, the commits of a deleted branch are
  // found again only by their hash: the notification center keeps it for later.
  function notifyBranchDeleted(branch, tip) {
    if (!Notification.isSupported()) return;
    new Notification({
      toastXml: toastXml({
        title: t('Deleted the branch {branch} ({tip})', { branch, tip }),
        body: t('To bring it back: git branch {branch} {tip}', { branch, tip }),
        launch: '',
      }),
    }).show();
  }

  return { notify, openFromNotification, bringWindowToFront, onSessionState, onToolUsed, notifyBranchDeleted };
}

module.exports = { CHECKS_SOON, agentLabel, createSessionNotices };
