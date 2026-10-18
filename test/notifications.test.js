const assert = require('node:assert/strict');
const test = require('node:test');
const { launchArgs, parseLaunchArgs, toastXml } = require('../src/conversations/notifications');

test('toastXml makes the toast Electron makes, with launch arguments', () => {
  assert.equal(
    toastXml({ title: 'worktabs: 完了', body: '会話\nmain  C:\\src\\worktabs', launch: 'tab=t1&session=s1' }),
    '<toast launch="tab=t1&amp;session=s1"><visual><binding template="ToastGeneric">'
      + '<text>worktabs: 完了</text><text>会話\nmain  C:\\src\\worktabs</text>'
      + '</binding></visual></toast>',
  );
});

test('toastXml escapes what XML would read as markup', () => {
  const xml = toastXml({ title: 'a<b>&"c\'', body: '</text><text>x', launch: '"><x' });
  assert.match(xml, /launch="&quot;&gt;&lt;x"/);
  assert.match(xml, /<text>a&lt;b&gt;&amp;&quot;c&apos;<\/text>/);
  assert.match(xml, /<text>&lt;\/text&gt;&lt;text&gt;x<\/text>/);
});

test('toastXml drops control characters, which XML cannot hold', () => {
  const xml = toastXml({ title: 'a\u0000b\u001bc', body: 'd\te\r\nf\u000bg', launch: '' });
  assert.match(xml, /<text>abc<\/text><text>d\te\r\nfg<\/text>/);
});

test('parseLaunchArgs reads the tab and conversation of launchArgs', () => {
  const sessionId = '0f8e2b7a-3c1d-4e5f-9a6b-7c8d9e0f1a2b';
  assert.deepEqual(parseLaunchArgs(launchArgs('t0123456789', sessionId)), { tabId: 't0123456789', sessionId });
  // Values that would read as more arguments stay whole.
  assert.deepEqual(parseLaunchArgs(launchArgs('t&x=1', 'a=b&c')), { tabId: 't&x=1', sessionId: 'a=b&c' });
});

test('launchArgs keeps out of the names Electron reads for its own buttons', () => {
  const args = launchArgs('type=action', 'tag=1');
  for (const name of ['type', 'action', 'tag']) assert.equal(new URLSearchParams(args).has(name), false, name);
  assert.doesNotMatch(args, /type=action|type=reply/);
});

test('parseLaunchArgs gives null for a toast without a tab', () => {
  for (const args of ['', undefined, null, 'type=click', 'session=s1']) assert.equal(parseLaunchArgs(args), null, String(args));
});
