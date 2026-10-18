// Registers the main process's IPC channels from a table, apart from Electron so it can be
// tested. A handler takes the arguments the page sent, without Electron's event; withEvent marks
// one that needs the event too (to check which page sent it). Guards that several channels share
// wrap their handlers in the table (see main.js).

const NEEDS_EVENT = Symbol('needs event');

// A handler that takes the event first: (event, ...args).
function withEvent(handler) {
  return Object.assign((...args) => handler(...args), { [NEEDS_EVENT]: true });
}

const call = (handler, event, args) => (handler[NEEDS_EVENT] ? handler(event, ...args) : handler(...args));

// `handle`: channels a page invokes and awaits (ipcMain.handle). `on`: channels a page sends to
// without an answer (ipcMain.on). `sync`: channels a page asks with sendSync, answered through
// event.returnValue.
function registerIpc(ipcMain, { handle = {}, on = {}, sync = {} }) {
  for (const [channel, handler] of Object.entries(handle)) ipcMain.handle(channel, (event, ...args) => call(handler, event, args));
  for (const [channel, handler] of Object.entries(on)) ipcMain.on(channel, (event, ...args) => call(handler, event, args));
  for (const [channel, handler] of Object.entries(sync)) {
    ipcMain.on(channel, (event, ...args) => {
      event.returnValue = call(handler, event, args);
    });
  }
}

// What a page sent, taken only when it has the expected type.
const stringOrNull = (value) => (typeof value === 'string' ? value : null);
const stringList = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);

module.exports = { registerIpc, stringList, stringOrNull, withEvent };
