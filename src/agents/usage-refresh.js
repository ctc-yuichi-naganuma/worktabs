// Short-lived, quota-only CLI connections. No thread, user message or model turn is sent.
const { spawn } = require('child_process');
const { resolveAgentCli } = require('./agent-cli');
const { jsonScanner } = require('../codex/codex-wrap');
const { CodexQuotaObserver } = require('../codex/codex-quota');

const REFRESH_EVERY = 5 * 60 * 1000;
const TIMEOUT = 20000;

function claudeWindows(value, now = Date.now()) {
  const windows = {};
  for (const key of ['five_hour', 'seven_day']) {
    const window = value?.rate_limits?.[key];
    const resetsAt = typeof window?.resets_at === 'string' ? Date.parse(window.resets_at) / 1000 : NaN;
    if (Number.isFinite(window?.utilization) && window.utilization >= 0 && Number.isFinite(resetsAt) && resetsAt * 1000 > now) {
      windows[key] = { utilization: window.utilization / 100, resetsAt: Math.round(resetsAt) };
    }
  }
  return windows;
}

function usageError(category) {
  const message = category === 'timeout' ? 'Usage refresh timed out' : category === 'cancelled' ? 'Usage refresh cancelled' : 'Usage unavailable';
  return Object.assign(new Error(message), { category });
}

/**
 * @param {string} agent
 * @param {{ extensionsDir?: string, cwd?: string, signal?: AbortSignal, resolve?: typeof resolveAgentCli,
 *   launch?: typeof spawn, timeout?: number, now?: () => number }} [options]
 */
function readUsage(agent, { extensionsDir, cwd, signal, resolve = resolveAgentCli, launch = spawn, timeout = TIMEOUT, now = Date.now } = {}) {
  const args = agent === 'codex' ? ['app-server'] : [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--no-session-persistence', '--setting-sources', '', '--settings', '{"disableAllHooks":true}',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--tools', '',
  ];
  return new Promise((resolveResult, reject) => {
    let child, done = false, timer, initialized = false, attempt = 0, accountId, quotaId;
    function finish(error, result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      // A quota response is the end of this connection. Never keep a helper alive to chat.
      child?.stdin.end();
      child?.kill();
      if (error) reject(usageError(error));
      else resolveResult(result);
    }
    const abort = () => finish('cancelled');
    const events = [];
    const observer = new CodexQuotaObserver((event) => events.push(event), now);
    function send(message) {
      if (agent === 'codex') observer.client(message);
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
    function readAccount() {
      attempt++;
      accountId = attempt === 1 ? 'account' : `account-${attempt}`;
      quotaId = null;
      send({ id: accountId, method: 'account/read', params: { refreshToken: false } });
    }
    function readQuota() {
      quotaId = `quota${attempt === 1 ? '' : `-${attempt}`}`;
      send({ id: quotaId, method: 'account/rateLimits/read', params: {} });
    }
    function receive(message) {
      if (done) return;
      if (agent === 'codex') {
        const count = events.length;
        observer.server(message);
        if (message.method === 'account/updated') {
          // These notifications invalidate pending reads in the observer. Recheck identity
          // with a new request ID instead of treating the invalidated reply as fresh quota.
          if (initialized) readAccount();
          return;
        }
        if (message.id === 'init') {
          if (message.error || !message.result) return finish('initialization');
          initialized = true;
          send({ method: 'initialized' });
          readAccount();
        } else if (accountId && message.id === accountId) {
          if (message.error || !message.result) return finish('account-read');
          if (!events.slice(count).some((event) => event.type === 'codex-account')) return readAccount();
          if (message.result.account?.type !== 'chatgpt') return finish(null, { events });
          if (!observer.accountKey) return finish(null, { events, unavailable: true, category: 'identity-unavailable' });
          readQuota();
        } else if (quotaId && message.id === quotaId) {
          if (message.error || !message.result) return finish(null, { events, unavailable: true, category: 'quota-read' });
          if (!events.slice(count).some((event) => event.type === 'codex-usage' && event.complete)) {
            // A newer quota notification can supersede this response. Obtain a full read
            // after it so absent buckets still get replaced, within the original deadline.
            attempt++;
            return readQuota();
          }
          finish(null, { events });
        }
      } else if (message.type === 'control_response') {
        const response = message.response;
        if (!['init', 'quota'].includes(response?.request_id)) return;
        if (response.subtype !== 'success') return finish(response.request_id === 'init' ? 'initialization' : 'quota-read');
        if (response.request_id === 'init') {
          // Experimental SDK control API used by the installed Claude Code extension.
          send({ type: 'control_request', request_id: 'quota', request: { subtype: 'get_usage', skip_behaviors: true } });
        } else {
          if (response.response?.rate_limits_available !== true) return finish('quota-read');
          finish(null, { windows: claudeWindows(response.response, now()) });
        }
      }
    }
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish('timeout'), timeout);
    if (signal?.aborted) return abort();
    // Resolution is inside the deadline too. A late resolver must never launch a helper.
    Promise.resolve().then(() => resolve('', agent, { extensionsDir })).then((binary) => {
      if (done) return;
      try {
        child = launch(binary, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        child.stdin.on('error', () => finish('process'));
        child.on('error', () => finish('process'));
        child.on('close', () => finish('process'));
        child.stderr.resume(); // Diagnostics can include account information; never forward them.
        child.stdout.on('data', jsonScanner(receive));
        if (agent === 'codex') send({ id: 'init', method: 'initialize', params: { clientInfo: { name: 'worktabs_usage', version: '1' }, capabilities: {} } });
        else send({ type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } });
      } catch {
        finish('process');
      }
    }, () => finish('resolution'));
  });
}

module.exports = { REFRESH_EVERY, claudeWindows, readUsage };
