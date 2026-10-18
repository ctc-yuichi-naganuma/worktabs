// App settings. Read from WORKTABS_CONFIG if set; otherwise from config.local.json next to
// package.json during development, and from <userData>/config.json in the packaged app.
const fs = require('fs');
const path = require('path');
const { agentExtensions, isAgentExtension, normalizeAgent, normalizeAgents, normalizeBranchAgent } = require('./agents/agents');
const { normalizeCodexApproval } = require('./codex/codex-approval');

const DEFAULTS = {
  // Where the side bar's repository list comes from, besides `repos`: "ghq" (`ghq list`),
  // "wsl:<distribution>" (`ghq list` in that WSL distribution), and "wsl" (`ghq list` in each
  // distribution installed; none without WSL).
  repoSources: ['ghq', 'wsl'],
  // Repositories added by hand ("Add repository" in the side bar menu).
  repos: [],
  // Extracted code-server release directory (contains lib/node.exe). Empty: the app downloads
  // codeServerVersion into <userData>/code-server on first start.
  codeServerDir: '',
  codeServerVersion: '4.139.1',
  // For the tabs in WSL: an extracted Linux release of code-server in the distribution (its
  // Linux path; contains lib/node). Empty: the app puts codeServerVersion's Linux release into
  // ~/.worktabs/code-server there on the first such tab.
  wslCodeServerDir: '',
  // Look for newer code-server and extension versions at start (GitHub and Open VSX) and offer
  // them in the side bar. Nothing is updated without asking.
  updateCheck: true,
  // Extensions directory shared by every code-server; defaults to <userData>/extensions.
  extensionsDir: '',
  // Installed from Open VSX into extensionsDir when missing, with the language pack of VS Code's
  // display language (withLanguagePack in i18n).
  extensions: [],
  // Embedded editors use the Worktabs extension manager instead of a second gallery.
  restrictExtensionGallery: true,
  // Agent providers to install and show in Worktabs. The default keeps the old behavior.
  agents: ['claude'],
  // The provider new tabs open by default when both Claude Code and Codex are installed.
  defaultAgent: 'claude',
  // Which provider suggests branch names. "default" follows defaultAgent.
  branchAgent: 'claude',
  // The display language of the app (English or Japanese; English for any other) and of VS Code
  // (code-server --locale). '' follows the system's preferred languages (resolveLanguage in i18n).
  locale: '',
  // claudeCode.initialPermissionMode for new conversations. '' starts in Manual: with a process
  // wrapper the extension passes --permission-mode default instead of letting the CLI pick Auto.
  permissionMode: 'auto',
  // Codex's own permission picker checks availability before selecting automatic review.
  codexApprovalMode: 'auto-review',
  // Intercept Ctrl+V and paste through Electron (fallback if Ctrl+V does not paste).
  pasteFallback: false,
  // Suspend a background tab after this many idle minutes (0 = never). Only tabs whose Claude
  // sessions are not working, waiting or unread are suspended; selecting the tab resumes it.
  idleSuspendMinutes: 0,
  // Width of the side bar with the tabs and repositories, in pixels.
  sidebarWidth: 260,
  // Hosts of GitHub Enterprise Server whose remotes are on GitHub, besides github.com, the hosts
  // named github.*, <tenant>.ghe.com and the hosts gh is signed in to (see readRemote in
  // github.js).
  githubHosts: [],
  // Show the repositories of the accounts gh is signed in to (their own and their organizations')
  // that are not cloned, in a section of the side bar that clones them. false: gh is not asked.
  unclonedRepos: true,
  // Owners whose repositories that section leaves out: "<owner>" (on any host) or
  // "<host>/<owner>". "Hide this owner" on an owner's row adds one.
  hiddenGithubOwners: [],
  // The folder a repository was last cloned into without ghq (its ghq root, or its parent), which
  // the dialog that asks where to starts from.
  cloneRoot: '',
  // Development only: loopback port for scripted checks (0 = off).
  controlPort: 0,
};

// Keys written back when the app saves the file (e.g. after "Add repository").
const SAVED_KEYS = [
  'repoSources',
  'repos',
  'sidebarWidth',
  'githubHosts',
  'unclonedRepos',
  'hiddenGithubOwners',
  'cloneRoot',
  'codeServerDir',
  'wslCodeServerDir',
  'extensionsDir',
  'agents',
  'defaultAgent',
  'branchAgent',
  'locale',
  'permissionMode',
  'codexApprovalMode',
  'pasteFallback',
  'idleSuspendMinutes',
  'updateCheck',
  'restrictExtensionGallery',
];

// The loaded settings: DEFAULTS overlaid with the file, plus what is worked out from them.
// resolvedLocale and resolvedExtensions are set later by main.js.
/**
 * @typedef {typeof DEFAULTS & {
 *   file: string,
 *   resolvedExtensionsDir: string,
 *   resolvedLocale?: string,
 *   resolvedExtensions?: string[],
 * }} Config
 */

function configFile(appDir, userDataDir, isPackaged) {
  if (process.env.WORKTABS_CONFIG) return process.env.WORKTABS_CONFIG;
  return isPackaged ? path.join(userDataDir, 'config.json') : path.join(appDir, 'config.local.json');
}

/** @returns {Config} */
function loadConfig(appDir, userDataDir, isPackaged) {
  const file = configFile(appDir, userDataDir, isPackaged);
  let user = {};
  if (fs.existsSync(file)) user = JSON.parse(fs.readFileSync(file, 'utf8'));
  // resolvedExtensionsDir is filled in below.
  const config = /** @type {Config} */ ({ ...DEFAULTS, ...user, file });
  // Copies, so adding a repository never changes DEFAULTS.
  config.repos = [...config.repos];
  config.repoSources = [...config.repoSources];
  config.agents = normalizeAgents(config.agents);
  config.defaultAgent = normalizeAgent(config.defaultAgent, config.agents);
  config.branchAgent = normalizeBranchAgent(config.branchAgent, config.agents, config.defaultAgent);
  config.codexApprovalMode = normalizeCodexApproval(config.codexApprovalMode);
  const extraExtensions = Array.isArray(config.extensions) ? config.extensions.filter((id) => !isAgentExtension(id)) : [];
  config.extensions = [...new Set([...agentExtensions(config.agents), ...extraExtensions])];
  config.githubHosts = Array.isArray(config.githubHosts) ? [...config.githubHosts] : [];
  config.hiddenGithubOwners = Array.isArray(config.hiddenGithubOwners) ? config.hiddenGithubOwners.filter((owner) => typeof owner === 'string') : [];
  config.resolvedExtensionsDir = config.extensionsDir || path.join(userDataDir, 'extensions');
  if (process.env.WORKTABS_CONTROL_PORT) config.controlPort = Number(process.env.WORKTABS_CONTROL_PORT);
  return config;
}

// Writes settings back to the config file (creating it if needed): the user-editable ones, or
// only `keys`. codeServerVersion is written only by an update, so that until then a newer app
// brings its own tested version.
function saveConfig(config, keys = SAVED_KEYS) {
  let current = {};
  if (fs.existsSync(config.file)) current = JSON.parse(fs.readFileSync(config.file, 'utf8'));
  for (const key of keys) current[key] = config[key];
  fs.mkdirSync(path.dirname(config.file), { recursive: true });
  fs.writeFileSync(config.file, `${JSON.stringify(current, null, 2)}\n`);
}

module.exports = { DEFAULTS, loadConfig, saveConfig };
