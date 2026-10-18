const assert = require('node:assert/strict');
const test = require('node:test');
const { createHelperClient } = require('../src/tabs/helper-client');

function client({ status = 200, answer = { ok: true }, fail = false } = {}) {
  const requests = [];
  const helpers = new Map([['t1', { port: 4000, token: 'secret' }]]);
  const request = async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    if (fail) throw new Error('refused');
    return { ok: status === 200, json: async () => answer };
  };
  return { requests, helper: createHelperClient(helpers, { request }) };
}

test('a call goes to the port and with the token the tab registered', async () => {
  const { requests, helper } = client();
  assert.equal(await helper.callHelper('t1', '/show-chat', { agent: 'codex' }), true);
  assert.equal(requests[0].url, 'http://127.0.0.1:4000/show-chat');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].headers['X-Helper-Token'], 'secret');
  assert.deepEqual(requests[0].body, { agent: 'codex' });
  assert.deepEqual(await helper.callHelper('t1', '/codex-active', {}, { result: true }), { ok: true });
});

test('a tab without a helper, an error status, or no answer resolves false', async () => {
  const none = client();
  assert.equal(await none.helper.callHelper('t2', '/show-chat'), false);
  assert.equal(none.requests.length, 0);
  assert.equal(await client({ status: 404 }).helper.callHelper('t1', '/old-route'), false);
  assert.equal(await client({ fail: true }).helper.callHelper('t1', '/show-chat', {}, { result: true }), false);
});

test('settings to set and to remove are sent apart', async () => {
  const { requests, helper } = client();
  await helper.applySettings('t1', { 'editor.fontSize': 14, 'files.autoSave': undefined });
  assert.equal(requests[0].url, 'http://127.0.0.1:4000/settings');
  assert.deepEqual(requests[0].body, { set: { 'editor.fontSize': 14 }, remove: ['files.autoSave'] });
});
