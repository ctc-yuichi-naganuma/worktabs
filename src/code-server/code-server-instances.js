// The running code-server instances of a manager, one per tab: what CodeServerManager (Windows
// and macOS) and WslCodeServerManager share. Each manager starts its instances its own way and
// says how to end one (endInstance); the bookkeeping, and which events still count, are here.
// Testable without Electron.
const { EventEmitter } = require('events');
const { stopSettings } = require('./code-server-launch');

// An instance: { port, started, stopping, shared (its shared settings, see stopSettings), owner,
// ... what the manager keeps }. Emits 'exit' (tabId, code, owner) when a started instance ends
// without being stopped; one that ends while starting fails its start instead.
class InstanceManager extends EventEmitter {
  constructor() {
    super();
    this.instances = new Map(); // tabId -> instance
  }

  ports() {
    return [...this.instances.values()].map((i) => i.port);
  }

  // Whether `instance` is still the tab's: a later start of the same tab replaces it.
  isCurrent(tabId, instance) {
    return this.instances.get(tabId) === instance;
  }

  // Ends the process of an instance (and everything under it). The manager's own.
  endInstance(_instance) {
    throw new Error('endInstance is not implemented');
  }

  // Stops the instance and everything under it (extension host, claude processes). `expected`:
  // that instance only, which a later start of the tab may have replaced; the newer one stays.
  stop(tabId, expected = null) {
    const instance = expected || this.instances.get(tabId);
    if (!instance || instance.stopping) return;
    instance.stopping = true;
    if (this.isCurrent(tabId, instance)) this.instances.delete(tabId);
    this.endInstance(instance);
    stopSettings(instance);
  }

  stopAll() {
    for (const tabId of [...this.instances.keys()]) this.stop(tabId);
  }

  // The instance's process ended (with `code`, or what ended it).
  instanceEnded(tabId, instance, code) {
    stopSettings(instance);
    if (this.isCurrent(tabId, instance)) this.instances.delete(tabId);
    if (instance.started && !instance.stopping) this.emit('exit', tabId, code, instance.owner);
  }

  // The instance's process could not run; its start fails.
  instanceFailed(tabId, instance) {
    stopSettings(instance);
    if (this.isCurrent(tabId, instance)) this.instances.delete(tabId);
  }
}

module.exports = { InstanceManager };
