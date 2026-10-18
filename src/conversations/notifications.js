// The Windows notifications (toasts) of conversations: what a toast holds, and what reaches the
// app when it is clicked.
//
// Electron hands a click on a toast to the Notification object that showed it, and only while
// the object lives. A click that finds none (a toast from before the app restarted) reaches
// Notification.handleActivation with the toast's launch arguments, which tell the tab and the
// conversation. The toasts Electron makes have none, hence toasts of our own.

// Control characters other than tabs and line breaks cannot be in XML, and Windows would refuse
// the whole toast.
function escapeXml(text) {
  return String(text)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}

// The toast Electron makes from a title and a body, with launch arguments.
function toastXml({ title, body, launch }) {
  return `<toast launch="${escapeXml(launch)}"><visual><binding template="ToastGeneric">`
    + `<text>${escapeXml(title)}</text><text>${escapeXml(body)}</text>`
    + '</binding></visual></toast>';
}

// Electron reads type, action and tag from the arguments for its own toasts' buttons, so these
// take other names.
function launchArgs(tabId, sessionId) {
  return new URLSearchParams({ tab: tabId, session: sessionId }).toString();
}

// The tab and conversation of a toast's launch arguments, or null for a toast without them.
function parseLaunchArgs(args) {
  const params = new URLSearchParams(args || '');
  const tabId = params.get('tab');
  return tabId ? { tabId, sessionId: params.get('session') } : null;
}

module.exports = { launchArgs, parseLaunchArgs, toastXml };
