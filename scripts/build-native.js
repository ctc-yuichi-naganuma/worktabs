// Builds the files the app needs besides its JavaScript: the Windows wrappers (the C#
// compiler of .NET Framework 4, which comes with Windows) and the helper extension's VSIX (tar).
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tarCommand } = require('../src/code-server/install');

const appDir = path.join(__dirname, '..');
const nativeDir = path.join(appDir, 'native');
const windir = process.env.WINDIR || 'C:\\Windows';

function buildWrapper() {
  // Elsewhere the wrapper is JavaScript, which the app writes out when it starts
  // (src/agents/mac-claude-wrap.js); there is nothing to build here.
  if (process.platform !== 'win32') {
    console.log('skipped: native Windows wrappers are built on Windows');
    return;
  }
  const csc = path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) {
    console.error(`csc.exe not found at ${csc}`);
    process.exit(1);
  }
  for (const [name, binary, refs] of [['ClaudeWrap.cs', 'claude-wrap.exe', []], ['CodexWrap.cs', 'codex-wrap.exe', ['-r:System.Web.Extensions.dll']]]) {
    buildWindowsWrapper(csc, name, binary, refs);
  }
}

function buildWindowsWrapper(csc, name, binary, refs) {
  const source = path.join(nativeDir, name);
  const output = path.join(nativeDir, binary);
  // Skip when up to date: a running app keeps the exe open, so it could not be replaced anyway.
  if (fs.existsSync(output) && fs.statSync(output).mtimeMs >= fs.statSync(source).mtimeMs) {
    console.log(`up to date: ${output}`);
    return;
  }
  execFileSync(
    csc,
    ['-nologo', '-target:exe', '-platform:x64', ...refs, `-out:${binary}`, name],
    { cwd: nativeDir, stdio: 'inherit' },
  );
  console.log(`built ${output}`);
}

// A VSIX is a zip with the extension under extension/. The file is named <id>-<version>.vsix,
// the same as the folder it installs to, so the app can tell whether it is installed.
function buildHelperExtension() {
  const source = path.join(appDir, 'helper-extension');
  const { publisher, name, version } = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  const prefix = `${publisher}.${name}-`;
  for (const file of fs.readdirSync(nativeDir)) {
    if (file.startsWith(prefix) && file.endsWith('.vsix')) fs.rmSync(path.join(nativeDir, file));
  }
  const output = path.join(nativeDir, `${prefix}${version}.vsix`);
  // Windows' bsdtar cannot rename entries (-s), so the folder is staged as extension/.
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'worktabs-vsix-'));
  try {
    fs.cpSync(source, path.join(staging, 'extension'), { recursive: true });
    execFileSync(tarCommand(), ['--format', 'zip', '-cf', output, 'extension'], {
      cwd: staging,
      stdio: 'inherit',
    });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  console.log(`built ${output}`);
}

buildWrapper();
buildHelperExtension();
