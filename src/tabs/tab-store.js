// tabs.json: the open tabs, the port each tab last used (closed ones too, so a tab's VS Code
// workbench state survives), when each repository last had a tab open, and the width of the chat
// in each repository's primary.
const fs = require('fs');

// Repositories whose last use is kept; older ones sort by name like those never opened.
const REPO_USED_LIMIT = 200;

// `lifecycle`: the TabLifecycle whose snapshot is kept. `chatWidths`: ChatWidths. `present`:
// whether a saved tab's folder is still there.
function createTabStore({ file, lifecycle, chatWidths, present, now = Date.now }) {
  // When each repository last had a tab open (lowercase path -> ms): the side bar lists the
  // repositories without one most recent first.
  let repoUsed = new Map();

  function markRepoUsed(repo) {
    if (repo) repoUsed.set(repo.toLowerCase(), now());
  }

  // A tab's use counts for its repository; outside git, for its own folder, which is how the
  // side bar lists a ghq checkout of another version control system. Nothing while the
  // repository is still being looked up.
  function markTabUsed(tab) {
    if (tab.repo !== undefined) markRepoUsed(tab.repo || tab.folder);
  }

  function save() {
    const used = [...repoUsed].sort((a, b) => b[1] - a[1]).slice(0, REPO_USED_LIMIT);
    const data = {
      ...lifecycle.snapshot(),
      repoUsed: Object.fromEntries(used),
      chatWidths: chatWidths.toJSON(),
    };
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }

  // Reopens last session's tabs. Only the active one starts; the rest start when selected.
  function restore() {
    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return;
    }
    repoUsed = new Map(Object.entries(saved.repoUsed || {}).filter(([, at]) => Number.isFinite(at)));
    chatWidths.load(saved.chatWidths);
    lifecycle.restore(saved, present);
  }

  return { save, restore, markTabUsed, repoUsed: () => Object.fromEntries(repoUsed) };
}

module.exports = { REPO_USED_LIMIT, createTabStore };
