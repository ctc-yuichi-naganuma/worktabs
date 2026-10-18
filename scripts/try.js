// Starts the build in dist/win-unpacked next to the Worktabs in everyday use, with its own data
// folder (tabs, code-server, extensions, single-instance lock), so a build can be checked
// without closing the app this is run from.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const exe = path.join(__dirname, '..', 'dist', 'win-unpacked', 'Worktabs.exe');
// A short path: under a long one Chromium cannot open the webviews' Cache Storage.
const dataDir = path.join(process.env.LOCALAPPDATA, 'Worktabs-try');

if (!fs.existsSync(exe)) {
  console.error(`not found: ${exe} (run npm run pack first)`);
  process.exit(1);
}

// Run from a terminal inside Worktabs, the environment has ELECTRON_RUN_AS_NODE (the exe would
// start as plain Node) and the everyday app's WORKTABS_* values (the wrapper's, and any others);
// start as if from Explorer, with only the data folder set below.
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (!/^(ELECTRON_|WORKTABS_)/i.test(key)) env[key] = value;
}
env.WORKTABS_DATA_DIR = dataDir;

spawn(exe, [], { env, detached: true, stdio: 'ignore' }).unref();
console.log(`started ${exe}`);
console.log(`data: ${dataDir}`);
