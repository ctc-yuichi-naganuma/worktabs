// Tabs can be opened before shared downloads and extension installation finish.
class StartupGate {
  constructor() {
    this.status = 'pending';
    /** @type {Promise<void>} */
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    // Startup may fail without a tab waiting to display the error.
    this.promise.catch(() => {});
  }

  wait() { return this.promise; }

  complete() {
    if (this.status !== 'pending') return;
    this.status = 'ready';
    this.resolve();
  }

  fail(error) {
    if (this.status !== 'pending') return;
    this.status = 'failed';
    this.reject(error);
  }
}

module.exports = { StartupGate };
