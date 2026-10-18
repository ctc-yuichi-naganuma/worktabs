// Which tabs a close of several takes, and which tab comes to the front after it, apart from
// Electron so they can be tested (TabLifecycle.closeNow). The × of a tab closes one; the button
// on a repository's row in the side bar closes all of its tabs at once.

// The tabs among `ids` that are open, once each, in `order` (the open tabs, in the order they
// opened). Ids of tabs closed meanwhile drop out.
function openAmong(order, ids) {
  const wanted = new Set(ids);
  return order.filter((id) => wanted.has(id));
}

// The tab to bring to the front once the tabs `closing` have closed, chosen before any of them
// closes: the one in front (`activeId`, null for none) if it stays; else the first after it in
// `order` that stays, else the last before it, as the × of the tab in front picks; null when
// none stays. Bringing one of `closing` to the front on the way would start its code-server, only
// to stop it again.
function nextActive(order, activeId, closing) {
  const closed = new Set(closing);
  if (!closed.has(activeId)) return activeId;
  const index = order.indexOf(activeId);
  const stays = (id) => !closed.has(id);
  const after = order.slice(index + 1).find(stays);
  if (after !== undefined) return after;
  const before = order.slice(0, Math.max(index, 0)).reverse().find(stays);
  return before === undefined ? null : before;
}

module.exports = { nextActive, openAmong };
