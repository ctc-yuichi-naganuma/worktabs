// The code-server manager of each folder: the local one (Windows or macOS), and one per WSL
// distribution, made the first time a folder in it needs one. The managers are injected, so
// fakes test it.
const { parseWslPath } = require('../wsl/wsl');

// `createWsl(distro)`: a new WslCodeServerManager for the distribution, its events wired.
function createServerRegistry({ createWsl }) {
  // Set once code-server is ready at start; until then, local tabs have no manager.
  let local = null;
  // Lowercase name -> WslCodeServerManager.
  const wsl = new Map();

  function wslFor(distro) {
    const key = distro.toLowerCase();
    if (!wsl.has(key)) wsl.set(key, createWsl(distro));
    return wsl.get(key);
  }

  // The manager for a folder: its WSL distribution's, or the local one.
  function forFolder(folder) {
    const parsed = parseWslPath(folder);
    return parsed ? wslFor(parsed.distro) : local;
  }

  function all() {
    return [local, ...wsl.values()].filter(Boolean);
  }

  // The distributions the app will likely use (those of `folders`: the listed repositories, as the
  // last run left the list, and the open tabs), made ready without downloading anything, so that
  // git in them goes through their agents, which is much faster than wsl.exe. The other
  // distributions are only looked into when the list is read again, and are not kept running.
  function prepareWsl(folders) {
    // Lowercase name -> name.
    const distros = new Map();
    for (const folder of folders) {
      const parsed = parseWslPath(folder);
      if (parsed) distros.set(parsed.distro.toLowerCase(), parsed.distro);
    }
    for (const distro of distros.values()) wslFor(distro).prepare({ install: false }).catch(() => {});
  }

  return {
    local: () => local,
    setLocal: (manager) => { local = manager; },
    wsl,
    wslFor,
    forFolder,
    all,
    prepareWsl,
  };
}

module.exports = { createServerRegistry };
