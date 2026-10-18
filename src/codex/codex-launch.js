// Installs a proxy beside each instance, outside the packaged app's asar. It uses code-server's
// node and the selected extension's own CLI, so no separate Codex install is required.
const fs = require('fs');
const path = require('path');
const { shellQuote } = require('../wsl/wsl');
const { t } = require('../i18n');
const { extensionBinary } = require('../agents/agent-cli');

async function prepareCodex({ files, extensionsDir, dir, node, platform = process.platform, arch = process.arch, nativeLauncher }) {
  const binary = await extensionBinary({ files, extensionsDir, agent: 'codex', platform, arch });
  if (!binary) return null;
  for (const name of ['codex-wrap.js', 'codex-events.js', 'codex-quota.js']) await files.write(files.join(dir, name), fs.readFileSync(path.join(__dirname, name), 'utf8'));
  await files.write(files.join(dir, 'codex-launch.json'), `${JSON.stringify({ node, binary })}\n`);
  let wrapper;
  if (platform === 'win32') {
    if (!nativeLauncher) throw new Error(t('Codex launcher is missing. Run npm run build:native.'));
    wrapper = files.join(dir, 'codex-wrap.exe');
    await files.write(wrapper, fs.readFileSync(nativeLauncher));
  } else {
    wrapper = files.join(dir, 'codex-wrap');
    await files.write(wrapper, `#!/bin/sh\nexec ${shellQuote(node)} ${shellQuote(files.join(dir, 'codex-wrap.js'))} "$@"\n`);
    await files.chmod(wrapper, 0o755);
  }
  return wrapper;
}

module.exports = { prepareCodex };
