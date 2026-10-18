const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { TOKEN_HEADER, controlToken, startControlServer, writeControlToken } = require('../src/window/control');

const TOKEN = 'a'.repeat(48);

async function withServer(handlers, check) {
  const server = startControlServer(0, handlers, TOKEN);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await check(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// A raw request, so that Host and Origin can be set as a browser would.
function request(port, { method = 'POST', route = '/echo', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: route, headers: { [TOKEN_HEADER]: TOKEN, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('the control port runs a handler for a request with the token', async () => {
  const calls = [];
  await withServer({ echo: async (arg) => { calls.push(arg); return arg; } }, async (port) => {
    const answer = await request(port, { body: JSON.stringify({ x: 1 }) });
    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.text), { ok: true, result: { x: 1 } });
    assert.equal((await request(port, { headers: { Host: `localhost:${port}` } })).status, 200);
    assert.equal((await request(port, { route: '/missing' })).status, 404);
    assert.equal((await request(port, { route: '/toString' })).status, 404);
    assert.deepEqual(calls, [{ x: 1 }, {}]);
  });
});

test('the control port refuses requests without the token, from pages, or by another host name', async () => {
  let called = false;
  await withServer({ echo: () => { called = true; } }, async (port) => {
    assert.equal((await request(port, { headers: { [TOKEN_HEADER]: '' } })).status, 401);
    assert.equal((await request(port, { headers: { [TOKEN_HEADER]: 'b'.repeat(48) } })).status, 401);
    assert.equal((await request(port, { headers: { [TOKEN_HEADER]: 'short' } })).status, 401);
    // A page's request, even one that somehow carries the token.
    assert.equal((await request(port, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await request(port, { headers: { Origin: 'null' } })).status, 403);
    // DNS rebinding: the page's own host name.
    assert.equal((await request(port, { headers: { Host: `evil.example:${port}` } })).status, 403);
    assert.equal((await request(port, { method: 'GET' })).status, 405);
    assert.equal((await request(port, { method: 'OPTIONS' })).status, 405);
  });
  assert.equal(called, false);
});

test('the control port refuses a body that is too large', async () => {
  let called = false;
  await withServer({ echo: () => { called = true; } }, async (port) => {
    const answer = await request(port, { body: 'x'.repeat(9 * 1024 * 1024) }).catch((error) => ({ status: error.code }));
    assert.ok([413, 'ECONNRESET', 'EPIPE'].includes(answer.status), String(answer.status));
  });
  assert.equal(called, false);
});

test('the control port needs a token', () => {
  assert.throws(() => startControlServer(0, {}, ''));
  assert.equal(controlToken({ WORKTABS_CONTROL_TOKEN: 'given' }), 'given');
  assert.match(controlToken({}), /^[0-9a-f]{48}$/);
  assert.notEqual(controlToken({}), controlToken({}));
});

test('writeControlToken writes the token for this user only', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktabs-control-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const data = path.join(dir, 'data');
  const file = writeControlToken(data, 'first');
  fs.chmodSync(file, 0o644);
  writeControlToken(data, 'second');
  assert.equal(fs.readFileSync(file, 'utf8'), 'second');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
