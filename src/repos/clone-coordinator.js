// Cloning the account's repositories, apart from Electron: where a repository can be cloned,
// cloning it (ghq or git), the dialog that asks where, and putting the new repository in the list.
// Menus and the native folder picker stay in main.js and come in as `pickFolder`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { t } = require('../i18n');
const {
  checkDestination,
  cloneDestination,
  cloneFailure,
  cloneRoots,
  defaultDestination,
  destinationIn,
  hiddenOwnerName,
  isHiddenOwner,
  placeOf,
  repoKey,
  rootOf,
} = require('./clone');
const { oneLine } = require('../util');
const { normalizeFolder, parseWslPath } = require('../wsl/wsl');
const { usableSources } = require('./worktrees');

function createCloneCoordinator({ config, saveConfig, repositories, cloning, dialogs, messageBox, pushState,
  sendRepos, refreshRepos, cloned, log, pickFolder, windowOpen, hasGhq, gitProtocol, cloneRepo, placeFolder,
  platform = process.platform, exists = fs.existsSync, homedir = os.homedir }) {
  // The repository of the accounts at `url` (an entry of ownedList), or null: the side bar names
  // it by its address, and only those GitHub listed are cloned.
  function ownedRepo(url) {
    const key = repoKey(url);
    return (key && repositories.owned.find((repo) => repoKey(repo.url) === key)) || null;
  }

  const isCloning = (repo) => cloning.has(repoKey(repo.url));

  // Where a repository can be cloned: here, and on Windows the WSL distributions that the list
  // reads (repoSources) where ghq is installed or the list has repositories. [{ label, distro }],
  // distro null for here.
  function clonePlaces() {
    const here = { label: platform === 'win32' ? 'Windows' : '', distro: null };
    if (platform !== 'win32') return [here];
    const sources = usableSources(config.repoSources || [], platform);
    const every = sources.some((source) => source.toLowerCase() === 'wsl');
    const named = new Set(sources.map((source) => /^wsl:(.+)$/i.exec(source)).filter(Boolean).map((match) => match[1].toLowerCase()));
    const distros = new Map(repositories.ghqDistros);
    for (const repo of repositories.list || []) {
      const wsl = parseWslPath(repo.path);
      if (wsl && !distros.has(wsl.distro.toLowerCase())) distros.set(wsl.distro.toLowerCase(), wsl.distro);
    }
    const wsl = [...distros]
      .filter(([key]) => every || named.has(key))
      .map(([, name]) => name)
      .sort((a, b) => a.localeCompare(b));
    return [here, ...wsl.map((distro) => ({ label: `WSL: ${distro}`, distro }))];
  }

  // Leaves the owner's repositories out of the section (hiddenGithubOwners in config.json, where it
  // can be taken back).
  function hideOwner(host, owner) {
    if (!isHiddenOwner(config.hiddenGithubOwners, host, owner)) {
      config.hiddenGithubOwners.push(hiddenOwnerName(host, owner));
      // Only that key: see addRepository in main.js.
      saveConfig(config, ['hiddenGithubOwners']);
    }
    sendRepos();
  }

  // Clones `repo` at `place` (clonePlaces): with ghq where it is installed (ghq decides where),
  // else into a folder that the dialog asks for.
  async function startClone(repo, place) {
    const key = repoKey(repo.url);
    if (cloning.has(key) || dialogs.has((dialog) => dialog.kind === 'clone')) return;
    const folder = placeFolder(place.distro);
    // At once: asking for ghq takes a moment for a distribution that is not running.
    cloning.add(key);
    pushState();
    if (await hasGhq(folder)) {
      cloneNow(repo, { folder, ghq: true });
      return;
    }
    cloning.delete(key);
    pushState();
    openCloneDialog(repo, place.distro);
  }

  // Clones `repo`, marked as being cloned meanwhile: with ghq where `folder` is, or with git into
  // `dest`, over SSH or https as gh is set up there (gitProtocol in github.js). The new repository
  // joins the list at once (addClonedRepo). A failure shows what ghq or git said.
  async function cloneNow(repo, { folder = null, ghq = false, dest = null }) {
    const key = repoKey(repo.url);
    cloning.add(key);
    pushState();
    const at = ghq ? folder : placeFolder(parseWslPath(dest)?.distro);
    let ssh = false;
    let clonedFolder;
    try {
      ssh = (await gitProtocol(at, repo.host)) === 'ssh';
      clonedFolder = normalizeFolder(await cloneRepo(repo, { folder, ghq, ssh, dest }));
    } catch (error) {
      cloning.delete(key);
      pushState();
      log(`clone ${repo.url}: ${oneLine(error.message)}`);
      messageBox(cloneFailure(error, repo, { ssh, ghq }));
      return;
    }
    addClonedRepo(clonedFolder, repo, { ghq });
    cloning.delete(key);
    pushState();
  }

  // Puts a repository just cloned into the list, as one of the other repositories: shown at once,
  // with its remote known, so that its row goes from the section of those not cloned. ghq lists it
  // when the list reads ghq there (repoSources); else it is added to config.repos, as "Add
  // repository" does. The side bar expands it to show its primary; the sources are read again
  // behind it.
  function addClonedRepo(folder, repo, { ghq }) {
    const wsl = parseWslPath(folder);
    const sources = usableSources(config.repoSources || [], platform).map((source) => source.toLowerCase());
    const read = wsl ? sources.includes('wsl') || sources.includes(`wsl:${wsl.distro.toLowerCase()}`) : sources.includes('ghq');
    const source = ghq && read ? (wsl ? `wsl:${wsl.distro}` : 'ghq') : 'config';
    if (source === 'config' && !config.repos.some((r) => normalizeFolder(r).toLowerCase() === folder.toLowerCase())) {
      config.repos.push(folder);
      saveConfig(config, ['repos']);
    }
    repositories.add(folder, source, { provider: 'github', url: repo.url, visibility: repo.visibility, current: null });
    cloned(folder);
    refreshRepos();
  }

  // The listed git repositories at a place ('' here, else a distribution's lowercase name), with
  // their remotes, as cloneRoots in clone.js takes them.
  function reposAt(place) {
    return (repositories.list || [])
      .filter((repo) => repo.git && placeOf(repo.path) === place)
      .map((repo) => ({ path: repo.path, url: repositories.remotes.get(repo.path.toLowerCase())?.url || null }));
  }

  // Asks where to clone `repo` with git, in the distribution `distro` or here (null), in the dialog
  // for it (src/dialog/clone.js): from where the listed repositories there are, the folder cloned
  // into last first. The page starts the clone (clone:start).
  function openCloneDialog(repo, distro) {
    if (!windowOpen() || dialogs.has((dialog) => dialog.kind === 'clone')) return;
    const place = distro ? distro.toLowerCase() : '';
    const roots = cloneRoots(reposAt(place));
    const remembered = config.cloneRoot && placeOf(config.cloneRoot) === place ? config.cloneRoot : null;
    dialogs.open({
      kind: 'clone',
      url: repo.url,
      slug: `${repo.owner}/${repo.name}`,
      place: distro ? `WSL: ${distro}` : platform === 'win32' ? 'Windows' : '',
      dest: defaultDestination(roots, remembered, repo),
      choices: roots.slice(0, 10).map((root) => ({ dest: cloneDestination(root.root, root.ghq, repo), count: root.count })),
    });
  }

  // The dialog that asks where to clone, when it is in front: what its page asks is done for it
  // only.
  function cloneDialogInFront() {
    const current = dialogs.current;
    return current && current.kind === 'clone' ? current : null;
  }

  // Whether the repository can be cloned into the folder written in the dialog (checkDestination in
  // clone.js): { dest: as the app keeps it, distro and linux: its distribution and path in WSL (else
  // null), error }.
  function checkCloneDestination(text) {
    const { dest, error } = checkDestination(text);
    if (error) return { dest, distro: null, linux: null, error };
    const folder = normalizeFolder(dest);
    const wsl = parseWslPath(folder);
    return { dest: folder, distro: wsl ? wsl.distro : null, linux: wsl ? wsl.path : null, error: null };
  }

  // The nearest folder above `p` (or `p` itself) that is there, for the folder picker to open in.
  function existingFolder(p) {
    let folder = p;
    for (let i = 0; i < 32 && folder; i += 1) {
      if (exists(folder)) return folder;
      const up = path.dirname(folder);
      if (up === folder) break;
      folder = up;
    }
    return homedir();
  }

  // "Browse…" in the dialog: picks a folder, and resolves where the repository goes under it
  // (destinationIn in clone.js): { dest }, null when none was picked.
  async function browseCloneDestination(current) {
    const shown = cloneDialogInFront();
    const repo = shown && ownedRepo(shown.url);
    if (!repo) return { dest: null };
    const text = typeof current === 'string' ? current.trim() : '';
    const picked = await pickFolder({
      title: t('Where to clone {repo}', { repo: shown.slug }),
      defaultPath: existingFolder(text ? path.dirname(text) : homedir()),
    });
    if (!picked || cloneDialogInFront() !== shown) return { dest: null };
    const folder = normalizeFolder(picked);
    return { dest: destinationIn(folder, cloneRoots(reposAt(placeOf(folder))), repo) };
  }

  // "Clone" in the dialog: starts cloning into the folder written there, and keeps where it went
  // for next time (cloneRoot in config.json). Resolves { error } when it cannot; the page closes
  // once it has started, and the row says it is being cloned.
  function cloneFromDialog(text) {
    const shown = cloneDialogInFront();
    const repo = shown && ownedRepo(shown.url);
    if (!repo) return { error: t('This repository is no longer in the list') };
    if (isCloning(repo)) return { error: t('This repository is being cloned') };
    const checked = checkCloneDestination(text);
    if (checked.error) return checked;
    config.cloneRoot = rootOf(checked.dest, repo);
    saveConfig(config, ['cloneRoot']);
    cloneNow(repo, { dest: checked.dest });
    return {};
  }

  // What the dialog's page asks (clone:check, clone:browse, clone:start), done only while it is in
  // front. Each resolves { error } when it cannot be done.
  const notCloning = () => ({ error: t('The dialog that asks where to clone is closed') });
  const fromDialog = (request) => (text) => (cloneDialogInFront() ? request(text) : notCloning());
  const dialogRequests = {
    check: fromDialog(checkCloneDestination),
    browse: fromDialog(browseCloneDestination),
    start: fromDialog(cloneFromDialog),
  };

  return { ownedRepo, isCloning, clonePlaces, hideOwner, startClone, openCloneDialog, dialogRequests };
}

module.exports = { createCloneCoordinator };
