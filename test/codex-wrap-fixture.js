// A small app-server stand-in. The same fixture exercises the node proxy and Windows launcher.
const { readFileSync } = require('fs');
const readline = require('readline');

const MESSAGES = [
  { method: 'thread/started', params: { thread: { id: 'thread', cwd: '/repo', name: '日本語', status: { type: 'idle' } } } },
  { method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn' } } },
  { id: 0, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', turnId: 'turn', itemId: 'command' } },
  { method: 'serverRequest/resolved', params: { threadId: 'thread', requestId: 0 } },
  { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } },
  { method: 'account/updated', params: { authMode: 'chatgpt' } },
  { method: 'account/rateLimits/updated', params: { rateLimits: { limitId: 'codex', primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 2000000000 }, secondary: null, credits: { balance: 'PRIVATE_CREDITS' } } } },
];
const OUTPUT = `${MESSAGES.map((m) => JSON.stringify(m)).join('\r\n')}\r\n`;
const ERROR = 'stderr stays with the extension 日本語\n';

if (require.main === module) {
  // Input and argv must reach the child byte for byte, including approval decisions.
  const expected = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  if (JSON.stringify(process.argv.slice(4)) !== JSON.stringify(expected.args)) process.exit(3);
  const lines = readline.createInterface({ input: process.stdin });
  lines.once('line', (line) => {
    if (line !== expected.input) process.exit(4);
    process.stderr.write(ERROR);
    const buffer = Buffer.from(OUTPUT);
    // Split the output at every byte, including inside Japanese characters.
    for (let i = 0; i < buffer.length; i++) process.stdout.write(buffer.subarray(i, i + 1));
    setTimeout(() => process.exit(7), 30);
  });
}

module.exports = { ERROR, MESSAGES, OUTPUT };
