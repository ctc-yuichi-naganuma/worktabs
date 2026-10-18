// Checks that every JavaScript file of the app parses (node --check), without running it.
// The app's own modules need Electron or VS Code to load, so this is what catches a broken
// file on a machine that cannot start the app.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const FOLDERS = ['src', 'helper-extension', 'scripts', 'test'];

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

let failed = 0;
const files = FOLDERS.flatMap((folder) => jsFiles(path.join(root, folder)));
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed += 1;
    process.stderr.write(String(error.stderr));
  }
}
console.log(`${files.length - failed} of ${files.length} files parse`);
process.exit(failed ? 1 : 0);
