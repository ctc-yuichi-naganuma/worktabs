// Copies the build in dist/win-unpacked to the folder of the Worktabs in everyday use and starts
// it there. Run by update-worktabs.cmd (double-clicked after closing Worktabs, since a terminal
// inside Worktabs closes with it).
//
// usage: node scripts/update-worktabs.js <folder of the everyday Worktabs>
const { execFileSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

const src = path.join(__dirname, '..', 'dist', 'win-unpacked');
const dest = process.argv[2] ? path.resolve(process.argv[2]) : '';
// The data folder the everyday Worktabs uses. A copy running from anywhere with it holds the
// single-instance lock, and the updated app would quit on start.
const everydayData = path.join(process.env.APPDATA, 'Worktabs');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function formatTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Worktabs processes that run from `dest` or use the everyday data folder (Electron passes
// --user-data-dir to its child processes).
function runningWorktabs() {
  const script = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `Get-CimInstance Win32_Process -Filter "Name='Worktabs.exe'" | Select-Object ExecutablePath, CommandLine | ConvertTo-Json -Compress`,
  ].join('; ');
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
  const procs = out ? [].concat(JSON.parse(out)) : [];
  const inDest = `${dest.toLowerCase()}\\`;
  const dataArg = `--user-data-dir="${everydayData.toLowerCase()}"`;
  const hits = procs.filter((p) =>
    (p.ExecutablePath || '').toLowerCase().startsWith(inDest) || (p.CommandLine || '').toLowerCase().includes(dataArg));
  return [...new Set(hits.map((p) => p.ExecutablePath))];
}

async function main() {
  if (!dest) fail('Give the folder to copy to.');
  if (path.parse(dest).root === dest) fail(`The folder to copy to is the root of a drive: ${dest}`);
  const srcExe = path.join(src, 'Worktabs.exe');
  if (!fs.existsSync(srcExe)) fail(`${srcExe} is missing. Build it first with npm run pack.`);
  // /MIR deletes whatever only the destination has, so refuse a folder that is not a Worktabs.
  if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0 && !fs.existsSync(path.join(dest, 'Worktabs.exe'))) {
    fail(`${dest} is not empty and has no Worktabs.exe. Check that it is the right folder.`);
  }

  const built = fs.statSync(path.join(src, 'resources', 'app.asar')).mtime;
  console.log(`From: ${src} (built ${formatTime(built)})`);
  console.log(`To:   ${dest}`);
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  for (let running = runningWorktabs(); running.length > 0; running = runningWorktabs()) {
    console.log('These Worktabs are running. Quit them, then press Enter (to stop, close this window).');
    for (const exe of running) console.log(`  ${exe}`);
    await rl.question('');
  }
  rl.close();

  // robocopy: 0-7 is success (1 = files copied), 8 and above is failure. Few retries, so a
  // locked file fails at once instead of waiting for the default million retries.
  const result = spawnSync('robocopy', [src, dest, '/MIR', '/R:2', '/W:1', '/NFL', '/NDL', '/NP', '/NJH'], { stdio: 'inherit' });
  if (result.error) fail(`Could not run robocopy: ${result.error.message}`);
  if (result.status >= 8) fail(`Copying failed (robocopy exit code ${result.status}).`);

  // Start as from Explorer, even when run from a terminal inside Worktabs or a development shell.
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(ELECTRON_|WORKTABS_)/i.test(key)) env[key] = value;
  }
  spawn(path.join(dest, 'Worktabs.exe'), [], { cwd: dest, env, detached: true, stdio: 'ignore' }).unref();
  console.log(`Started ${path.join(dest, 'Worktabs.exe')}.`);
}

main().catch((error) => fail(error.stack || String(error)));
