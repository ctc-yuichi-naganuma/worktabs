// The webPreferences of every view the app makes. Electron's defaults are these today; spelling
// them out keeps a later change from turning one off without a test failing. The tabs show
// code-server, a web page the app does not control, and the side bar and the dialog reach the
// main process only through what their preload scripts expose.
const SECURE = Object.freeze({ contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true });

// `options` adds to them (partition, preload, ...) and cannot loosen them.
function viewPreferences(options = {}) {
  return { ...options, ...SECURE };
}

module.exports = { SECURE, viewPreferences };
