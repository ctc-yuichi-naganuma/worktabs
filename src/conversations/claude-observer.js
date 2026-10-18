// Claude transcript and local process observation. WSL exits arrive separately through
// ConversationStore.endProc; Codex processes are polled here without reading Claude files.
const fs = require('fs');
const { titleOf } = require('./conversation-store');
const INTERRUPT_MARKERS = ['[Request interrupted by user', 'Tool permission request failed: AbortError'];
const TITLE_TAIL_BYTES = 256 * 1024;

class ClaudeObserver {
  constructor(store, { alive = isAlive, size = fileSize, range = readRange,
    schedule = setInterval, cancel = clearInterval, interval = 2000 } = {}) {
    this.store = store;
    this.alive = alive;
    this.size = size;
    this.range = range;
    this.schedule = schedule;
    this.cancel = cancel;
    this.interval = interval;
    this.reads = new WeakMap();
    this.running = false;
    this.polling = false;
    this.timer = null;
    this.observe = (session) => this.readTranscript(session);
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this.store.on('observe-claude', this.observe);
    this.timer = this.schedule(() => this.poll(), this.interval);
    this.timer?.unref?.();
    return this;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.cancel(this.timer);
    this.timer = null;
    this.store.removeListener('observe-claude', this.observe);
  }

  // The reads are asynchronous: a WSL transcript is read through \\wsl.localhost, and a stat
  // there blocks for as long as the distribution takes to answer. A poll still going when the
  // next is due is not started again.
  async poll() {
    if (!this.running || this.polling) return;
    this.polling = true;
    const changed = new Set();
    try {
      for (const procId of [...this.store.procs.keys(), ...this.store.codexProcs.keys()]) {
        if (!/^\d+$/.test(procId) || this.alive(Number(procId))) continue;
        const tabId = this.store.procEnded(procId);
        if (tabId) changed.add(tabId);
      }
      await Promise.all([...this.store.sessions].map(async ([id, session]) => {
        if (!session.conversation || session.provider === 'codex') return;
        const title = titleOf(session);
        if (await this.readTranscript(session, { markers: true }) && this.store.sessions.get(id) === session) {
          this.store.setState(id, session, 'idle');
          changed.add(session.tabId);
        }
        if (titleOf(session) !== title) changed.add(session.tabId);
      }));
    } finally {
      this.polling = false;
    }
    for (const tabId of changed) this.store.emit('change', tabId);
  }

  // Reads what the transcript has gained, after any read of it still going. Resolves to whether
  // that has an interruption (with `markers`) while the session is working or waiting.
  readTranscript(session, options = {}) {
    if (!session.transcript || session.provider === 'codex') return Promise.resolve(false);
    let read = this.reads.get(session);
    if (!read) { read = { offset: null, pending: null, queue: Promise.resolve(false) }; this.reads.set(session, read); }
    read.queue = read.queue.then(() => this.readMore(session, read, options), () => false);
    return read.queue;
  }

  // Offsets count bytes; incomplete lines retain their bytes until the next read, including
  // a UTF-8 character split across writes. The first tail is only a title baseline.
  async readMore(session, read, { markers = false }) {
    const size = await this.size(session.transcript);
    if (read.offset === null && size === 0) read.offset = 0;
    const first = read.offset === null;
    const start = first ? Math.max(0, size - TITLE_TAIL_BYTES) : read.offset;
    if (size <= start) return false;
    let chunk;
    try { chunk = await this.range(session.transcript, start, size); }
    catch { return false; } // A disappearing or temporarily unreadable file is retried.
    read.offset = size;
    if (read.pending) chunk = Buffer.concat([read.pending, chunk]);
    const end = chunk.lastIndexOf(0x0a) + 1;
    read.pending = chunk.subarray(end);
    let text = chunk.subarray(0, end).toString('utf8');
    if (first && start > 0) text = text.slice(text.indexOf('\n') + 1);
    const records = [];
    for (const line of text.split('\n')) {
      if (!/"type":"(ai-title|custom-title|last-prompt)"/.test(line)) continue;
      try { records.push(JSON.parse(line)); } catch { /* A partial or malformed record is ignored. */ }
    }
    this.store.updateTranscript(session, records);
    const busy = session.state === 'working' || session.state === 'waiting';
    return !first && markers && busy && INTERRUPT_MARKERS.some((marker) => text.includes(marker));
  }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}
async function fileSize(file) {
  try { return file ? (await fs.promises.stat(file)).size : 0; } catch { return 0; }
}
async function readRange(file, start, end) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const buffer = Buffer.alloc(end - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}
module.exports = { ClaudeObserver, TITLE_TAIL_BYTES };
