// The port each tab's code-server last listened on, kept in tabs.json for closed tabs too, apart
// from Electron so it can be tested. VS Code web keeps the state of its workbench (the open
// editors, the Claude conversations on editor tabs, the views in the side bars, the sizes of the
// panels) in browser storage, one per origin: a tab that starts on its port again comes back as
// it was, and one on another port starts empty. So a port stays with its tab, and no other tab's
// VS Code may take it: on the same origin, the state VS Code keeps for every folder (global)
// would mix with the other tab's.
//
// A port goes when the worktree is removed in the app, when its folder is found gone at start
// (removed outside the app), and when more than KEPT_CLOSED closed tabs were used after it.

// Closed tabs whose ports are kept: those used last.
const KEPT_CLOSED = 200;

const isPort = (port) => Number.isInteger(port) && port > 0 && port < 65536;

class TabPorts {
  // `idOf(folder)`: the id of the folder's tab. `isOpen(id)`: whether that tab is open; an open
  // tab keeps its port whatever the limit.
  constructor({ idOf, isOpen, limit = KEPT_CLOSED }) {
    this.idOf = idOf;
    this.isOpen = isOpen;
    this.limit = limit;
    // id -> { folder, port }, the one used longest ago first.
    this.kept = new Map();
  }

  // Takes the ports in tabs.json (`saved`): the closed tabs' (`ports`, folder -> port) and the
  // open tabs' (`tabs`, [{ folder, port }]). A folder that is gone (`present(folder)` false)
  // loses its port. Returns the ports no tab keeps.
  /** @param {(folder: string) => boolean} [present] */
  load(saved, present = () => true) {
    const closed = saved.ports && typeof saved.ports === 'object' && !Array.isArray(saved.ports) ? Object.entries(saved.ports) : [];
    const open = (Array.isArray(saved.tabs) ? saved.tabs : []).map((entry) => [entry?.folder, entry?.port]);
    const gone = [];
    for (const [folder, port] of [...closed, ...open]) {
      if (typeof folder !== 'string' || !isPort(port)) continue;
      const id = this.idOf(folder);
      if (!present(folder)) gone.push(port);
      // A port that two tabs had stays with the first: an older version gave a new tab any free
      // port, and that could be the one of a tab that was not running.
      else if (!this.kept.has(id) && !this.holds(port)) this.kept.set(id, { folder, port });
    }
    return [...new Set(gone)].filter((port) => !this.holds(port));
  }

  // The port the tab's code-server should listen on, or 0 for any.
  port(id) {
    return this.kept.get(id)?.port || 0;
  }

  // The ports the other tabs keep, which the tab's code-server must not take.
  reserved(id) {
    return new Set([...this.kept].filter(([other]) => other !== id).map(([, entry]) => entry.port));
  }

  // The tab's code-server listens on `port` now: the tab keeps it, as the one used last. Returns
  // the port it kept before when it got another one (that one was taken), which no tab keeps now.
  use(id, folder, port) {
    const before = this.port(id);
    this.kept.delete(id);
    for (const [other, entry] of this.kept) if (entry.port === port) this.kept.delete(other);
    this.kept.set(id, { folder, port });
    return before && before !== port ? [before] : [];
  }

  // The tab was closed: it keeps its port, as the one used last. Returns the ports of the closed
  // tabs beyond the limit, those used longest ago, which no tab keeps now.
  close(id) {
    const entry = this.kept.get(id);
    if (entry) {
      this.kept.delete(id);
      this.kept.set(id, entry);
    }
    const closed = [...this.kept.keys()].filter((other) => !this.isOpen(other));
    return closed.slice(0, Math.max(0, closed.length - this.limit)).map((other) => {
      const { port } = this.kept.get(other);
      this.kept.delete(other);
      return port;
    });
  }

  // The tab's worktree was removed. Returns its port, which no tab keeps now.
  forget(id) {
    const entry = this.kept.get(id);
    this.kept.delete(id);
    return entry ? [entry.port] : [];
  }

  // The closed tabs' ports for tabs.json (folder -> port), the one used longest ago first.
  closed() {
    return Object.fromEntries([...this.kept].filter(([id]) => !this.isOpen(id)).map(([, { folder, port }]) => [folder, port]));
  }

  holds(port) {
    return [...this.kept.values()].some((entry) => entry.port === port);
  }
}

module.exports = { TabPorts };
