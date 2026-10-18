const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { CodeServerManager, pickPort, unproxiedUrl } = require('../src/code-server/code-server');
const { tempDir } = require('./support');

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const close = (server) => new Promise((resolve) => server.close(resolve));

test('a local process exit carries the owner of its start', async (t) => {
  const dir = tempDir(t);
  const script = path.join(dir, 'server.js');
  fs.writeFileSync(script, `
    const http = require('node:http');
    const bind = process.argv[process.argv.indexOf('--bind-addr') + 1];
    const server = http.createServer((req, res) => {
      res.end('ok');
      if (req.url === '/exit') setTimeout(() => process.exit(7), 10);
    });
    server.listen(Number(bind.split(':').pop()), '127.0.0.1');
  `);
  const manager = new CodeServerManager({ dataDir: dir, extensionsDir: path.join(dir, 'extensions') });
  Object.defineProperty(manager, 'nodeExe', { value: process.execPath });
  manager.baseArgs = () => [script];
  const owner = {};
  try {
    const { port } = await manager.start('tab', dir, 0, { owner });
    const exit = once(manager, 'exit');
    await fetch(`http://127.0.0.1:${port}/exit`);
    assert.deepEqual(await exit, ['tab', 7, owner]);
    assert.equal(manager.instances.size, 0);
  } finally {
    manager.stopAll();
  }
});

test('pickPort takes the preferred port while it is free', async () => {
  const free = await pickPort();
  assert.equal(await pickPort(free), free);
});

test('pickPort takes another port when the preferred one is in use', async () => {
  const server = await listen(0);
  const taken = server.address().port;
  try {
    const picked = await pickPort(taken);
    assert.notEqual(picked, taken);
    assert.ok(picked > 0);
  } finally {
    await close(server);
  }
});

test('pickPort passes over the ports to avoid, and is not given one of them again', async () => {
  const offered = [];
  // Takes the place of the ports other tabs keep: the first three the OS gives.
  const avoid = { has: (port) => offered.push(port) <= 3 };
  const picked = await pickPort(0, avoid);
  assert.equal(offered.length, 4);
  assert.equal(new Set(offered).size, 4);
  assert.equal(picked, offered[3]);
  // None of them stays bound.
  for (const port of offered) await close(await listen(port));
});

test('pickPort takes the preferred port even when other tabs keep ports', async () => {
  const free = await pickPort();
  assert.equal(await pickPort(free, new Set([free + 1])), free);
});

test("unproxiedUrl takes a link through the tab's code-server proxy back to the port it stands for", () => {
  const page = 'http://127.0.0.1:58049/?folder=/c:/repos/app';
  assert.equal(unproxiedUrl('http://127.0.0.1:58049/proxy/5173/', page), 'http://localhost:5173/');
  assert.equal(unproxiedUrl('http://127.0.0.1:58049/proxy/5173', page), 'http://localhost:5173/');
  assert.equal(unproxiedUrl('http://127.0.0.1:58049/proxy/3000/app/page?q=1#top', page), 'http://localhost:3000/app/page?q=1#top');
});

test('unproxiedUrl leaves other links alone', () => {
  const page = 'http://127.0.0.1:58049/?folder=/c:/repos/app';
  for (const url of [
    // Another tab's code-server, and other pages of this one.
    'http://127.0.0.1:58050/proxy/5173/',
    'http://127.0.0.1:58049/absproxy/5173/',
    'http://127.0.0.1:58049/proxy/x/',
    'http://127.0.0.1:58049/?folder=/c:/repos/other',
    // Links that are already direct, and others.
    'http://localhost:5173/',
    'https://github.com/proxy/5173/',
    'not a url',
  ]) {
    assert.equal(unproxiedUrl(url, page), null, url);
  }
  assert.equal(unproxiedUrl('http://127.0.0.1:58049/proxy/5173/', 'about:blank'), null);
});
