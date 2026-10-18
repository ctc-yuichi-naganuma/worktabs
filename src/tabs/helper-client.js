// Calls the helper extension in each running tab's VS Code, where it said it listens (`helpers`:
// tab id -> { port, token }).
/**
 * @param {Map<string, { port: number, token: string }>} helpers
 * @param {{ request?: (url: string, init?: RequestInit) => Promise<Response>, timeout?: number }} [options]
 */
function createHelperClient(helpers, { request = (...args) => fetch(...args), timeout = 5000 } = {}) {
  // Resolves false when the tab's helper has not registered (or is an older one without the
  // route), or does not answer: VS Code is reloading or gone. With `result`, resolves what it
  // answered instead of true.
  async function callHelper(tabId, route, body = {}, { result = false } = {}) {
    const helper = helpers.get(tabId);
    if (!helper) return false;
    try {
      const res = await request(`http://127.0.0.1:${helper.port}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Helper-Token': helper.token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      return res.ok ? (result ? await res.json() : true) : false;
    } catch {
      return false;
    }
  }

  // Has the tab's VS Code set settings that another tab of its repository changed (key -> value,
  // undefined removes one). Resolves false when it cannot: VS Code is not up yet, or has an older
  // helper.
  function applySettings(tabId, changes) {
    const set = {};
    const remove = [];
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) remove.push(key);
      else set[key] = value;
    }
    return callHelper(tabId, '/settings', { set, remove });
  }

  return { callHelper, applySettings };
}

module.exports = { createHelperClient };
