// Downloads the code-server release the app was tested with, when no install is configured.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { serverNode } = require('./code-server');
const { t } = require('../i18n');

// How code-server names its releases, by platform and architecture. Windows has an amd64
// release only; macOS has one for each, and an Intel Mac must not be given the arm64 one.
const RELEASE_OS = { win32: 'windows', darwin: 'macos' };
const RELEASE_ARCH = { x64: 'amd64', arm64: 'arm64' };

// The release for this machine, or with `linuxArch` (amd64, arm64) the Linux one, for WSL.
// Null when there is none to download; the code-server to use is then a configured one.
function releaseName(version, linuxArch = null, { platform = process.platform, arch = process.arch } = {}) {
  if (linuxArch) return `code-server-${version}-linux-${linuxArch}`;
  const os = RELEASE_OS[platform];
  const cpu = RELEASE_ARCH[arch];
  if (!os || !cpu || (platform === 'win32' && cpu !== 'amd64')) return null;
  return `code-server-${version}-${os}-${cpu}`;
}

// The tar that unpacks the release. On Windows it is the one that comes with it (Windows 10 and
// later): a GNU tar earlier on PATH (Git Bash) would read "C:/..." as a remote host.
function tarCommand(platform = process.platform) {
  if (platform !== 'win32') return 'tar';
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
}

// Downloads the archive of the release `name` into <dataDir>/code-server, unless it is there
// already, and returns its path. onProgress(downloadedMB, totalMB) reports the download.
/** @param {{ dataDir: string, version: string, name: string, onProgress?: (mb: number, totalMb: number) => void }} options */
async function downloadRelease({ dataDir, version, name, onProgress = () => {} }) {
  const root = path.join(dataDir, 'code-server');
  fs.mkdirSync(root, { recursive: true });
  const archive = path.join(root, `${name}.tar.gz`);
  if (!fs.existsSync(archive)) {
    const partial = `${archive}.part`;
    const url = `https://github.com/coder/code-server/releases/download/v${version}/${name}.tar.gz`;
    // net.fetch goes through Chromium's network stack, so the system proxy settings apply.
    // Required here, not at the top: the rest of the file is read by the tests, without Electron.
    const { net } = require('electron');
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(t('Could not download code-server {version} (HTTP {status})', { version, status: res.status }));
    const total = Number(res.headers.get('content-length')) || 0;
    let received = 0;
    const progress = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        onProgress(received / 2 ** 20, total / 2 ** 20);
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), progress, fs.createWriteStream(partial));
    fs.renameSync(partial, archive);
  }
  return archive;
}

// Returns the code-server directory under <dataDir>/code-server, downloading and extracting
// the release first if needed. onProgress(downloadedMB, totalMB) reports the download.
/** @param {{ dataDir: string, version: string, onProgress?: (mb: number, totalMb: number) => void }} options */
async function ensureCodeServer({ dataDir, version, onProgress = () => {} }) {
  const name = releaseName(version);
  if (!name) {
    throw new Error(t('Downloading code-server is not supported here ({platform}-{arch}). Set codeServerDir in config.local.json.', { platform: process.platform, arch: process.arch }));
  }
  const root = path.join(dataDir, 'code-server');
  const dir = path.join(root, name);
  if (fs.existsSync(serverNode(dir))) return dir;
  const archive = await downloadRelease({ dataDir, version, name, onProgress });

  await /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
    execFile(tarCommand(), ['-xzf', archive, '-C', root], { windowsHide: true }, (error, _stdout, stderr) =>
      error ? reject(new Error(t('Extracting failed: {error}', { error: stderr || error.message }))) : resolve(),
    );
  }));
  fs.rmSync(archive, { force: true });
  if (!fs.existsSync(serverNode(dir))) throw new Error(t('{path} is not found after extracting', { path: dir }));
  return dir;
}

// Removes the code-server releases under <dataDir>/code-server other than `keep` (directories),
// so each update leaves only the version before it.
function removeOldCodeServers(dataDir, keep) {
  const root = path.join(dataDir, 'code-server');
  const kept = new Set(keep.map((dir) => path.resolve(dir).toLowerCase()));
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const dir = path.join(root, entry.name);
    if (!entry.isDirectory() || !/^code-server-.+/.test(entry.name) || kept.has(dir.toLowerCase())) continue;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

module.exports = { downloadRelease, ensureCodeServer, releaseName, removeOldCodeServers, tarCommand };
