// Receives Claude Code hooks and observed Codex app-server state from each tab.
const crypto = require('crypto');
const { EventEmitter } = require('events');
const fs = require('fs');
const http = require('http');
const { ConversationStore, PRIORITY, nextState, nextConversation } = require('./conversation-store');
const { ClaudeObserver } = require('./claude-observer');

const HOOK_EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
  'PermissionDenied', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'SubagentStart',
  'SubagentStop', 'Stop', 'StopFailure', 'PreCompact', 'PostCompact',
];

// Loopback HTTP endpoint for the hooks (/hook), for the rate_limit_event lines that
// claude-wrap.exe picks out of claude's output (/usage), and for the helper extension in each
// tab to say where it listens (/helper), to have a file shown in File Explorer (/explore) and to
// say that its VS Code's color theme has changed (/theme).
// Every request must carry the per-run token, so other local processes cannot fake tab states.
// The tabs in WSL cannot reach it; their requests come through the distribution's agent
// instead (receive).
class HookServer extends EventEmitter {
  // logFile: optional path; one line per received event, for troubleshooting.
  /** @param {{ logFile?: string }} [options] */
  constructor({ logFile } = {}) {
    super();
    this.token = crypto.randomBytes(24).toString('hex');
    this.port = 0;
    this.logFile = logFile;
  }

  get url() {
    return `http://127.0.0.1:${this.port}/hook`;
  }

  listen() {
    const server = http.createServer((req, res) => {
      const route = ['/hook', '/codex', '/usage', '/helper', '/explore', '/theme'].includes(req.url) ? req.url.slice(1) : null;
      if (req.method !== 'POST' || !route || req.headers['x-wrapper-token'] !== this.token) {
        res.writeHead(404);
        res.end();
        return;
      }
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        // Empty 2xx: no decision, so permission prompts stay with the extension's UI.
        res.writeHead(200);
        res.end();
        // The claude-wrap.exe that runs the session's claude; empty from an older wrapper.
        // Node joins repeated custom headers into one string, so only set-cookie is an array.
        const procId = /^\d+$/.test(/** @type {string} */ (req.headers['x-wrapper-proc'] || '')) ? req.headers['x-wrapper-proc'] : null;
        this.receive(route, req.headers['x-wrapper-tab'], procId, raw);
      });
    });
    this.server = server;
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
      this.port = /** @type {import('net').AddressInfo} */ (server.address()).port;
      resolve(this.port);
    }));
  }

  // Takes a request whose token has been checked: its route (hook, usage, helper, explore,
  // theme, codex), the tab it comes from, the wrapper process that sent it (null if unknown), and its
  // body.
  receive(route, tabId, procId, raw) {
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return;
    }
    if (!tabId || !input || typeof input !== 'object') return;
    if (route === 'codex') {
      if (['codex-account', 'codex-usage'].includes(input.type)) {
        if (procId) this.emit('codex-usage', tabId, input, procId);
        return;
      }
      if (input.type === 'codex-observer') {
        if (procId) this.emit('codex-observer', tabId, procId);
        return;
      }
      if (typeof input.threadId !== 'string' || !input.threadId || (!input.ended && !input.restoreFailed && !PRIORITY.includes(input.state))) return;
      this.log(tabId, input.threadId, 'codex', input.restoreFailed ? 'restore-failed' : input.ended ? 'ended' : input.state, procId);
      this.emit('codex', tabId, input, procId);
      return;
    }
    if (route === 'helper') {
      if (Number.isInteger(input.port) && typeof input.token === 'string') {
        this.emit('helper', tabId, { port: input.port, token: input.token });
      }
      return;
    }
    if (route === 'explore') {
      if (typeof input.path === 'string') this.emit('explore', tabId, input.path);
      return;
    }
    // The app reads the new colors from the tab's page itself.
    if (route === 'theme') {
      this.emit('theme', tabId);
      return;
    }
    if (route === 'usage') {
      if (input.type !== 'rate_limit_event') return;
      const windows = Object.entries(input.rate_limit_info?.unifiedWindows || {})
        .map(([name, window]) => `${name}=${window?.utilization}`)
        .join(' ');
      this.log(tabId, input.session_id, input.type, windows, procId);
      this.emit('usage', input);
      return;
    }
    if (route !== 'hook') return;
    const detail = input.tool_name || input.notification_type || input.source || input.reason || '';
    this.log(tabId, input.session_id, input.hook_event_name, detail, procId);
    this.emit('hook', tabId, input, procId);
  }

  close() {
    this.server?.closeAllConnections();
    this.server?.close();
  }

  log(tabId, sessionId, event, detail, procId) {
    if (!this.logFile) return;
    const line = [new Date().toISOString(), tabId, sessionId, event, detail, procId || ''].join('\t');
    fs.appendFile(this.logFile, `${line}\n`, () => {});
  }

  // Settings file that claude-wrap.exe passes to claude with --settings. SessionStart cannot
  // use an http hook, so it goes through `claude-wrap.exe --hook`.
  writeSettings(file, wrapExe) {
    const settings = hookSettings(this.url, `"${wrapExe.replace(/\\/g, '/')}" --hook`);
    fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  }
}

// Claude Code settings that send every hook event to `url`, and SessionStart, which cannot use
// an http hook, through the command hook `command`.
function hookSettings(url, command) {
  const hooks = {};
  for (const event of HOOK_EVENTS) {
    const hook = event === 'SessionStart'
      ? { type: 'command', command, timeout: 5 }
      : {
          type: 'http',
          url,
          timeout: 5,
          headers: {
            'X-Wrapper-Token': '$WORKTABS_HOOK_TOKEN',
            'X-Wrapper-Tab': '$WORKTABS_TAB_ID',
            'X-Wrapper-Proc': '$WORKTABS_PROC_ID',
          },
          allowedEnvVars: ['WORKTABS_HOOK_TOKEN', 'WORKTABS_TAB_ID', 'WORKTABS_PROC_ID'],
        };
    hooks[event] = [{ hooks: [hook] }];
  }
  return { hooks };
}

// Existing callers can keep the combined API while new code attaches runtime observation
// explicitly. State-only callers should construct ConversationStore instead.
class SessionTracker extends ConversationStore {
  constructor(options = {}) {
    super(options);
    this.observer = new ClaudeObserver(this, options.observer).start();
  }
  get timer() { return this.observer.timer; }
  poll() { return this.observer.poll(); }
  readTranscript(session, options) { return this.observer.readTranscript(session, options); }
  close() { this.observer.stop(); }
}

module.exports = { HookServer, SessionTracker, hookSettings, nextConversation, nextState };
