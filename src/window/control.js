// Development only: a loopback HTTP port for scripted checks (config controlPort).
// Each endpoint is a handler name; the request body is its JSON argument.
// Its handlers can run scripts in every page, so a request must carry the token generated at
// start (written to the data folder, see writeControlToken). Browsers cannot send that header
// without a preflight this server never answers, and requests from a page (Origin) or under
// another host name (DNS rebinding) are refused before the token is even compared.
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const TOKEN_HEADER = 'x-worktabs-control-token';
const TOKEN_FILE = 'control-token';
const MAX_BODY = 8 * 1024 * 1024;

// The token: the one the environment gives (WORKTABS_CONTROL_TOKEN, for a test that starts the
// app), else a new random one.
function controlToken(env = process.env) {
  return env.WORKTABS_CONTROL_TOKEN || crypto.randomBytes(24).toString('hex');
}

// Writes the token where the dev scripts read it, readable by this user only.
function writeControlToken(dataDir, token) {
  const file = path.join(dataDir, TOKEN_FILE);
  fs.mkdirSync(dataDir, { recursive: true });
  // A file left by an earlier run may have other permissions; mode applies only on creation.
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, token, { mode: 0o600 });
  return file;
}

function sameToken(given, token) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Why a request is refused (its status), or null.
function refusal(req, token) {
  const port = req.socket.localPort;
  if (req.method !== 'POST') return 405;
  if (req.headers.origin !== undefined) return 403;
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return 403;
  if (!sameToken(req.headers[TOKEN_HEADER], token)) return 401;
  return null;
}

function createControlServer(handlers, token) {
  if (!token) throw new Error('control port needs a token');
  return http.createServer((req, res) => {
    const status = refusal(req, token);
    if (status) {
      res.writeHead(status, { Connection: 'close' });
      res.end();
      // Discarded unread, so that the answer is not cut off.
      req.resume();
      return;
    }
    let raw = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY) {
        res.writeHead(413, { Connection: 'close' });
        res.end();
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', async () => {
      if (size > MAX_BODY) return;
      const name = req.url.slice(1);
      const handler = Object.hasOwn(handlers, name) ? handlers[name] : null;
      if (!handler) {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const result = await handler(raw ? JSON.parse(raw) : {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: result ?? null }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
    });
  });
}

function startControlServer(port, handlers, token) {
  const server = createControlServer(handlers, token);
  // A port in use would otherwise end up as an uncaught exception dialog, even on a hidden run.
  server.on('error', (error) => console.error(`control port ${port}: ${error.message}`));
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { TOKEN_FILE, TOKEN_HEADER, controlToken, createControlServer, startControlServer, writeControlToken };
