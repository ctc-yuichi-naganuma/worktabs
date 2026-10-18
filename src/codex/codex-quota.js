// A strict projection of the supported app-server account protocol. No credentials, credit
// details, or full account responses leave the proxy. This file also runs beside code-server.
const { createHash } = require('crypto');

function quotaWindow(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    usedPercent: Number.isFinite(value.usedPercent) && value.usedPercent >= 0 ? value.usedPercent : null,
    windowDurationMins: Number.isFinite(value.windowDurationMins) && value.windowDurationMins > 0 ? value.windowDurationMins : null,
    resetsAt: Number.isSafeInteger(value.resetsAt) && value.resetsAt > 0 && value.resetsAt <= 8640000000000 ? value.resetsAt : null,
  };
}

function quotaBuckets(value) {
  const multiple = value?.rateLimitsByLimitId;
  const entries = multiple && typeof multiple === 'object' && !Array.isArray(multiple)
    ? Object.entries(multiple) : value?.rateLimits ? [[value.rateLimits.limitId || 'codex', value.rateLimits]] : [];
  return entries.filter(([, bucket]) => bucket && typeof bucket === 'object').map(([id, bucket]) => ({
    id: typeof bucket.limitId === 'string' && bucket.limitId ? bucket.limitId : id,
    name: typeof bucket.limitName === 'string' ? bucket.limitName : null,
    primary: quotaWindow(bucket.primary),
    secondary: quotaWindow(bucket.secondary),
  }));
}

class CodexQuotaObserver {
  constructor(onEvent, now = Date.now) {
    this.onEvent = onEvent;
    this.now = now;
    this.requests = new Map();
    this.seq = 0;
    this.generation = 0;
    this.latest = 0;
    this.accountKey = null;
  }

  client(message) {
    if (message?.id === undefined) return;
    if (['account/login/start', 'account/logout'].includes(message.method)) this.account('changing', null);
    if (['account/read', 'account/rateLimits/read'].includes(message.method)) {
      this.requests.set(message.id, { method: message.method, at: this.now(), seq: ++this.seq, generation: this.generation });
    }
  }

  server(message) {
    if (!message || typeof message !== 'object') return;
    if (message.method === 'account/updated') {
      const mode = message.params?.authMode;
      return this.account(['chatgpt', 'chatgptAuthTokens', 'apikey', 'bedrockApiKey', 'agentIdentity', 'personalAccessToken'].includes(mode) ? mode : mode === null ? null : 'unknown', null);
    }
    if (message.method === 'account/rateLimits/updated') {
      return this.usage(message.params, { at: this.now(), seq: ++this.seq }, false);
    }
    if (message.method || !this.requests.has(message.id)) return;
    const request = this.requests.get(message.id);
    this.requests.delete(message.id);
    if (request.generation !== this.generation) return;
    // A failed read is not an authoritative empty snapshot of the account's quota.
    if (message.error) return;
    if (request.method === 'account/rateLimits/read') return this.usage(message.result, request, true);
    if (!message.result || request.seq < this.accountSeq) return;
    const account = message.result.account;
    const mode = account?.type === 'chatgpt' ? 'chatgpt' : account?.type === 'apiKey' ? 'apikey' : account === null ? null : 'unknown';
    // The documented account/read identity is email. A hash compares tabs without sending
    // the email to Worktabs or keeping it in the proxy. No token fields are inspected.
    const key = mode === 'chatgpt' && typeof account.email === 'string'
      ? createHash('sha256').update(account.email).digest('hex') : null;
    this.account(mode, key, request);
  }

  account(authMode, accountKey, request) {
    if (!request) {
      request = { at: this.now(), seq: ++this.seq };
      this.generation++;
    } else if (authMode !== this.authMode || accountKey !== this.accountKey) {
      // Reads begun after this identity read may belong to that account. Earlier pending
      // reads cannot establish its quota, even if they finish after the identity response.
      for (const [id, pending] of this.requests) if (pending.seq <= request.seq) this.requests.delete(id);
    }
    this.authMode = authMode;
    this.accountSeq = request.seq;
    this.accountKey = accountKey;
    this.onEvent({ type: 'codex-account', authMode, accountKey, at: request.at, receivedAt: this.now(), seq: ++this.seq });
  }

  usage(value, request, complete) {
    if (request.seq <= this.latest) return;
    this.latest = request.seq;
    this.onEvent({ type: 'codex-usage', buckets: quotaBuckets(value), complete, accountKey: this.accountKey,
      at: request.at, receivedAt: this.now(), seq: ++this.seq });
  }
}

module.exports = { CodexQuotaObserver, quotaBuckets, quotaWindow };
