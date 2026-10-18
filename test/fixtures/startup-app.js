// This entry point delays offline extension installation without adding test controls to the app.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { CodeServerManager } = require('../../src/code-server/code-server');
const root = path.resolve(__dirname, '../..');
const dir = process.env.WORKTABS_TEST_STARTUP_DIR;
if (!dir) throw new Error('WORKTABS_TEST_STARTUP_DIR is required');
const record = (event) => fs.appendFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify(event)}\n`);
const install = CodeServerManager.prototype.ensureExtensions;
CodeServerManager.prototype.ensureExtensions = async function () {
  record({ event: 'install-begin' });
  while (!fs.existsSync(path.join(dir, 'release'))) await new Promise((resolve) => setTimeout(resolve, 25));
  if (fs.existsSync(path.join(dir, 'fail'))) throw new Error('fixture extension installation failed');
  const version = require('../../helper-extension/package.json').version;
  await install.call(this, [path.join(root, 'native', `worktabs.worktabs-helper-${version}.vsix`)]);
  const indexFile = path.join(this.extensionsDir, 'extensions.json');
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const sources = [path.join(__dirname, 'codex-sidebar')];
  if (process.env.WORKTABS_TEST_LANGUAGE_PACK_DIR) sources.push(process.env.WORKTABS_TEST_LANGUAGE_PACK_DIR);
  for (const source of sources) {
    const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    const id = `${pkg.publisher}.${pkg.name}`;
    const name = `${id}-${pkg.version}`;
    const target = path.join(this.extensionsDir, name);
    fs.cpSync(source, target, { recursive: true });
    index.push({ identifier: { id }, version: pkg.version, relativeLocation: name,
      metadata: { source: 'vsix' }, location: { $mid: 1, scheme: 'file', path: decodeURIComponent(pathToFileURL(target).pathname) } });
  }
  fs.writeFileSync(indexFile, JSON.stringify(index));
  record({ event: 'install-ready' });
};
const start = CodeServerManager.prototype.start;
CodeServerManager.prototype.start = function (id, ...args) {
  record({ event: 'server-start', id });
  return start.call(this, id, ...args);
};
require('../../src/main');
