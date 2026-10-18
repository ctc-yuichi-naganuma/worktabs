// The VS Code settings that the tabs of one repository's worktrees share. Each tab's
// code-server has a user-data-dir of its own: several code-servers cannot share one, since each
// writes its logs, coder.json and globalStorage there. So the repository keeps its settings in a
// folder of its own, <dataDir>/repos/<id>/: settings.json, keybindings.json, tasks.json,
// mcp.json, snippets/ and prompts/, as they are in a User folder. A tab's User folder gets them
// before its VS Code starts; while it runs, what changes there goes to the repository's folder
// and to the other running tabs of the repository. code-server does not see a change to its
// User folder that it did not make, so a running VS Code sets the settings itself (through the
// helper extension), and takes the other files when it starts again.
//
// settings.json goes key by key: what a tab changed since it was last in step (removed keys
// too) goes to the others, so two tabs changing different settings keep both. The other files
// go whole. The agent settings the app manages are not shared: each tab gets them at every
// start. A repository in WSL shares as well; its tabs'
// folders are in the distribution, reached through its agent (`files`), and its shared folder
// is on Windows with the others.
//
// Runs no Electron code, so the tests can load it.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { editJsonc, parseJsonc } = require('./jsonc');
const { normalizeFolder } = require('../wsl/wsl');

// The files of a User folder that the tabs share, besides settings.json; and its folders whose
// files they share, with the names that count.
const SHARED_FILES = ['keybindings.json', 'tasks.json', 'mcp.json'];
const SHARED_FOLDERS = { snippets: /\.(json|code-snippets)$/i, prompts: /\.md$/i };
const META = 'repo.json';

// The folder name of a repository's shared settings, from its main worktree.
function repoIdFor(repo) {
  const hash = crypto.createHash('sha1').update(normalizeFolder(repo).toLowerCase()).digest('hex');
  return `r${hash.slice(0, 10)}`;
}

// The settings in the text of a settings.json: {} for a missing or empty file, undefined when it
// does not hold an object.
function settingsObject(text) {
  if (text === null || text === undefined || !String(text).trim()) return {};
  const value = parseJsonc(text);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function sameValue(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

const valueOf = (settings, key) => (Object.hasOwn(settings, key) ? settings[key] : undefined);

// What makes `from` into `to`: key -> value, undefined for a key `to` does not have. Keys in
// `ignore` are left out.
function changedSettings(from, to, ignore = new Set()) {
  const changes = {};
  for (const [key, value] of Object.entries(to)) {
    if (!ignore.has(key) && (!Object.hasOwn(from, key) || !sameValue(from[key], value))) changes[key] = value;
  }
  for (const key of Object.keys(from)) {
    if (!ignore.has(key) && !Object.hasOwn(to, key)) changes[key] = undefined;
  }
  return changes;
}

function applyChanges(settings, changes) {
  const next = { ...settings };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

const isEmpty = (object) => !Object.keys(object).length;

// Fills `defaults` into a VS Code settings file and sets `managed` (undefined removes the key).
// The rest of the file, comments included, stays. A file that does not hold an object is left
// alone. Resolves whether the file holds the settings.
async function mergeSettings(files, file, defaults, managed) {
  const text = await files.read(file);
  const current = settingsObject(text);
  if (!current) return false;
  const changes = {};
  for (const [key, value] of Object.entries(defaults)) if (!Object.hasOwn(current, key)) changes[key] = value;
  for (const [key, value] of Object.entries(managed)) if (!sameValue(valueOf(current, key), value)) changes[key] = value;
  if (text === null || !isEmpty(changes)) await files.write(file, editJsonc(text, changes));
  return true;
}

class SettingsSync {
  // dir: where the repositories' shared settings go; defaults: the settings every VS Code starts
  // with, where the repository's leave them out; delay: how long a change settles (ms) before
  // it goes to the other tabs; log(line): what went wrong.
  /** @param {{ dir: string, defaults?: object, delay?: number, log?: (line: string) => void }} options */
  constructor({ dir, defaults = {}, delay = 300, log = () => {} }) {
    this.dir = dir;
    this.defaults = defaults;
    this.delay = delay;
    this.log = log;
    this.repos = new Map(); // id -> { repo, dir, tabs: Map(tabId -> tab), queue, timer }
    this.seq = 0;
  }

  repoState(repo) {
    const id = repoIdFor(repo);
    if (!this.repos.has(id)) {
      this.repos.set(id, { repo, dir: path.join(this.dir, id), tabs: new Map(), queue: Promise.resolve(), timer: null });
    }
    return this.repos.get(id);
  }

  // Runs the repository's jobs one at a time. Resolves or rejects as the job does.
  enqueue(state, job) {
    const run = state.queue.then(job);
    state.queue = run.catch(() => {});
    return run;
  }

  // A job that nothing waits for: what went wrong goes to the log.
  background(state, job) {
    this.enqueue(state, job).catch((error) => this.log(`${state.repo}: ${error.message}`));
  }

  // Brings the User folder of a tab of `repo` (its main worktree), before its VS Code starts, to
  // the settings the repository's tabs share, and keeps them in step while it runs. Resolves a
  // handle whose stop() ends that, when its code-server stops.
  //   files: reads and writes the tab's folders (code-server.js's localFiles, or a WSL
  //     distribution's);
  //   userDir(tabId): the User folder of a tab of the repository;
  //   managed: the settings the app sets at every start (undefined removes one), not shared;
  //   unshared: settings kept by each tab, without forcing a value in primary;
  //   worktreeTabs(): the tabs of the repository's worktrees, open or not. The first time, their
  //     settings make the repository's;
  //   apply(changes): has the tab's VS Code set settings (key -> value, undefined removes one):
  //     code-server does not see a change to the settings.json that it did not make itself.
  //     Resolves whether VS Code took them (false: it is not up yet).
  async attach({ tabId, repo, files, userDir, managed = {}, unshared = [], worktreeTabs = async () => [], apply = async () => false }) {
    const state = this.repoState(repo);
    const tab = {
      tabId,
      files,
      userDir,
      dir: userDir(tabId),
      managed,
      apply,
      ignore: new Set([...Object.keys(managed), ...unshared]),
      // As they were when the tab was last in step: its settings (undefined when they could not
      // be read), and the text of each of its other shared files (null: none).
      settings: undefined,
      texts: new Map(),
      // Whether its VS Code may be up: not while it joins, before it starts.
      running: false,
      dirty: false,
      changedAt: 0,
      stopped: false,
      unwatch: null,
    };
    try {
      await this.enqueue(state, () => this.round(state, (store) => this.join(state, store, tab, worktreeTabs)));
      await mergeSettings(files, files.join(tab.dir, 'settings.json'), {}, managed);
      const folders = [tab.dir, ...Object.keys(SHARED_FOLDERS).map((folder) => files.join(tab.dir, folder))];
      tab.unwatch = await files.watch(folders, (folder, name) => this.changed(state, tab, folder, name));
      tab.running = true;
    } catch (error) {
      this.log(`${repo}: ${tabId}: ${error.message}`);
      tab.stopped = true;
      tab.unwatch?.();
      if (state.tabs.get(tabId) === tab) state.tabs.delete(tabId);
      // It starts with settings of its own, as a folder outside git does.
      await mergeSettings(files, files.join(tab.dir, 'settings.json'), this.defaults, managed).catch(() => {});
      return { stop() {} };
    }
    return { stop: () => this.detach(state, tab) };
  }

  // A tab's code-server has stopped. What it changed just before still goes to the others.
  detach(state, tab) {
    if (tab.stopped) return;
    tab.stopped = true;
    tab.unwatch?.();
    tab.dirty = true;
    tab.changedAt = ++this.seq;
    this.background(state, async () => {
      if (state.tabs.get(tab.tabId) !== tab) return;
      try {
        await this.round(state);
      } finally {
        if (state.tabs.get(tab.tabId) === tab) state.tabs.delete(tab.tabId);
      }
    });
  }

  changed(state, tab, folder, name) {
    if (tab.stopped) return;
    if (name && folder === tab.dir && name !== 'settings.json' && !SHARED_FILES.includes(name)) return;
    tab.dirty = true;
    tab.changedAt = ++this.seq;
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      this.background(state, () => this.round(state));
    }, this.delay);
  }

  // Resolves once the changes seen so far have gone everywhere.
  async settled() {
    for (const state of this.repos.values()) {
      if (!state.timer) continue;
      clearTimeout(state.timer);
      state.timer = null;
      this.background(state, () => this.round(state));
    }
    await Promise.all([...this.repos.values()].map((state) => state.queue));
  }

  // One step of keeping the repository's tabs in step: what the tabs changed goes to the
  // repository's folder (the tab that changed last winning), then what they lack goes to each.
  // `prepare(store)` first, for a tab that joins.
  async round(state, prepare = null) {
    const store = this.load(state);
    const saved = { settings: store.settings, files: new Map(store.files), meta: JSON.stringify(store.meta) };
    if (prepare) await prepare(store);
    const tabs = [...state.tabs.values()];
    for (const tab of tabs.filter((t) => t.dirty).sort((a, b) => a.changedAt - b.changedAt)) await this.take(tab, store);
    this.save(state, store, saved);
    for (const tab of tabs) await this.give(tab, store);
  }

  // A tab starting: the repository's folder is made from its worktrees' tabs the first time,
  // and takes what a tab new to it has that it does not. The defaults fill what it leaves out.
  async join(state, store, tab, worktreeTabs) {
    if (!store.meta) await this.migrate(state, store, tab, await worktreeTabs());
    else if (!store.meta.tabs.includes(tab.tabId)) await this.welcome(store, tab);
    const shared = settingsObject(store.settings);
    if (shared) {
      const missing = {};
      for (const [key, value] of Object.entries(this.defaults)) if (!Object.hasOwn(shared, key)) missing[key] = value;
      if (!isEmpty(missing)) store.settings = editJsonc(store.settings, missing);
    }
    if (!store.meta.tabs.includes(tab.tabId)) store.meta.tabs.push(tab.tabId);
    // The tab as it is: whatever it has that the repository's settings do not is dropped, since
    // the repository's are newer (it has had them before, or took its own just now).
    const snapshot = await this.snapshot(tab.files, tab.dir);
    tab.settings = snapshot.settings;
    tab.texts = new Map([...snapshot.files].map(([rel, file]) => [rel, file.text]));
    const previous = state.tabs.get(tab.tabId);
    if (previous) {
      previous.stopped = true;
      previous.unwatch?.();
    }
    state.tabs.set(tab.tabId, tab);
  }

  // The repository's settings the first time: those of its worktrees' tabs (made before tabs
  // shared them), each setting and each file from the tab that changed it last.
  async migrate(state, store, tab, tabIds) {
    const ids = [...new Set([...tabIds, tab.tabId])];
    const sources = [];
    for (const id of ids) sources.push(await this.snapshot(tab.files, tab.userDir(id), { times: true }));
    const readable = sources.filter((s) => s.text !== null && s.settings).sort((a, b) => a.time - b.time);
    const merged = {};
    for (const source of readable) Object.assign(merged, source.settings);
    for (const key of tab.ignore) delete merged[key];
    // The comments and layout of the newest file stay.
    const newest = readable[readable.length - 1];
    store.settings = newest ? editJsonc(newest.text, changedSettings(newest.settings, merged)) : null;
    store.files = new Map();
    const times = new Map();
    for (const source of sources) {
      for (const [rel, file] of source.files) {
        if (file.text === null || times.get(rel) > file.time) continue;
        store.files.set(rel, file.text);
        times.set(rel, file.time);
      }
    }
    store.meta = { repo: state.repo, tabs: ids };
  }

  // A tab new to the repository's settings (a folder inside a worktree, say) adds the settings
  // and files they do not have. Where both have one, the repository's stays.
  async welcome(store, tab) {
    const snapshot = await this.snapshot(tab.files, tab.dir);
    const shared = settingsObject(store.settings);
    if (snapshot.settings && shared) {
      const extra = {};
      for (const [key, value] of Object.entries(snapshot.settings)) {
        if (!tab.ignore.has(key) && !Object.hasOwn(shared, key)) extra[key] = value;
      }
      if (!isEmpty(extra)) store.settings = editJsonc(store.settings, extra);
    }
    for (const [rel, file] of snapshot.files) if (file.text !== null && !store.files.has(rel)) store.files.set(rel, file.text);
  }

  // What changed in the tab since it was last in step goes to the repository's settings.
  async take(tab, store) {
    tab.dirty = false;
    const text = await tab.files.read(tab.files.join(tab.dir, 'settings.json'));
    // A folder without settings.json is being removed with its worktree: its files are not
    // taken for removed ones. An empty file is taken for one being written, not for every setting
    // removed.
    if (text === null) return;
    const current = text.trim() ? settingsObject(text) : undefined;
    const shared = settingsObject(store.settings);
    if (current && shared) {
      // Settings that could not be read before: those it has that differ go, and none is removed.
      const from = tab.settings ?? Object.fromEntries(Object.keys(current).map((key) => [key, valueOf(shared, key)]));
      const changes = changedSettings(from, current, tab.ignore);
      if (!isEmpty(changes)) store.settings = editJsonc(store.settings, changes);
      tab.settings = current;
    }
    const names = new Set([...(await this.sharedNames(tab.files, tab.dir)), ...tab.texts.keys()]);
    for (const rel of names) {
      const file = await tab.files.read(this.fileIn(tab, rel));
      if (file === (tab.texts.get(rel) ?? null)) continue;
      if (file === null) store.files.delete(rel);
      else store.files.set(rel, file);
      tab.texts.set(rel, file);
    }
  }

  // What the repository's settings have that the tab lacks goes to it: through its VS Code
  // while that runs, else into its settings.json, which VS Code reads when it starts. What the
  // tab changed meanwhile stays: it goes to the others in the next round.
  async give(tab, store) {
    // A stopped tab gets them when it starts again (its folder may be going with its worktree).
    if (tab.stopped) return;
    const shared = settingsObject(store.settings);
    const wanted = shared && tab.settings ? changedSettings(tab.settings, shared, tab.ignore) : {};
    if (!isEmpty(wanted)) await this.giveSettings(tab, store, wanted);
    // The other files only go to its folder: a running VS Code takes them when it starts again.
    for (const rel of new Set([...store.files.keys(), ...tab.texts.keys()])) {
      const want = store.files.get(rel) ?? null;
      const had = tab.texts.get(rel) ?? null;
      if (want === had) continue;
      const file = this.fileIn(tab, rel);
      if ((await tab.files.read(file)) !== had) continue;
      if (want === null) await tab.files.remove(file);
      else await tab.files.write(file, want);
      tab.texts.set(rel, want);
    }
  }

  async giveSettings(tab, store, wanted) {
    const file = tab.files.join(tab.dir, 'settings.json');
    const text = await tab.files.read(file);
    if ((text === null || !text.trim()) && isEmpty(tab.settings)) {
      // A new tab starts from the repository's file as it is, comments included.
      await tab.files.write(file, editJsonc(store.settings, Object.fromEntries([...tab.ignore].map((key) => [key, undefined]))));
      tab.settings = applyChanges(tab.settings, wanted);
      return;
    }
    const current = text !== null && text.trim() ? settingsObject(text) : undefined;
    if (!current) return;
    for (const key of Object.keys(changedSettings(tab.settings, current, tab.ignore))) delete wanted[key];
    if (isEmpty(wanted)) return;
    // Its VS Code writes what it sets. What is not in the file then (it refused a setting, or
    // is not up) goes in as the file is now.
    const latest = tab.running && !tab.stopped && (await tab.apply(wanted)) ? await tab.files.read(file) : text;
    const settings = latest !== null && latest.trim() ? settingsObject(latest) : undefined;
    if (!settings) return;
    const rest = {};
    for (const [key, value] of Object.entries(wanted)) if (!sameValue(valueOf(settings, key), value)) rest[key] = value;
    if (!isEmpty(rest)) await tab.files.write(file, editJsonc(latest, rest));
    tab.settings = applyChanges(tab.settings, wanted);
  }

  fileIn(tab, rel) {
    return tab.files.join(tab.dir, ...rel.split('/'));
  }

  // The shared files that a User folder may have, as paths relative to it ('snippets/x.json').
  async sharedNames(files, dir) {
    const names = [...SHARED_FILES];
    for (const [folder, pattern] of Object.entries(SHARED_FOLDERS)) {
      for (const name of await files.list(files.join(dir, folder))) if (pattern.test(name)) names.push(`${folder}/${name}`);
    }
    return names;
  }

  // What a User folder holds: { text (of settings.json, null when there is none), settings,
  // time, files: Map(relative path -> { text, time }) }, with the times only when asked.
  async snapshot(files, dir, { times = false } = {}) {
    const read = async (file) => ({ text: await files.read(file), time: times ? await files.mtime(file) : 0 });
    const main = await read(files.join(dir, 'settings.json'));
    const found = new Map();
    for (const rel of await this.sharedNames(files, dir)) {
      const file = await read(files.join(dir, ...rel.split('/')));
      if (file.text !== null) found.set(rel, file);
    }
    return { text: main.text, settings: settingsObject(main.text), time: main.time, files: found };
  }

  // The repository's folder: { settings (the text of settings.json, or null), files: Map
  // (relative path -> text), meta: { repo, tabs } or null before it has been made }.
  load(state) {
    const read = (rel) => {
      try {
        return fs.readFileSync(path.join(state.dir, ...rel.split('/')), 'utf8');
      } catch {
        return null;
      }
    };
    const files = new Map();
    for (const rel of SHARED_FILES) {
      const text = read(rel);
      if (text !== null) files.set(rel, text);
    }
    for (const [folder, pattern] of Object.entries(SHARED_FOLDERS)) {
      let names = [];
      try {
        names = fs.readdirSync(path.join(state.dir, folder), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
      } catch {
        // None yet.
      }
      for (const name of names.filter((n) => pattern.test(n))) files.set(`${folder}/${name}`, read(`${folder}/${name}`));
    }
    let meta = null;
    try {
      meta = JSON.parse(read(META));
    } catch {
      // Not made yet.
    }
    if (!meta || !Array.isArray(meta.tabs)) meta = null;
    return { settings: read('settings.json'), files, meta };
  }

  // Writes what changed in the repository's folder. repo.json, which says the folder has been
  // made, goes last.
  save(state, store, saved) {
    const file = (rel) => path.join(state.dir, ...rel.split('/'));
    const write = (rel, text) => {
      fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
      fs.writeFileSync(file(rel), text);
    };
    if (store.settings !== null && store.settings !== saved.settings) write('settings.json', store.settings);
    for (const [rel, text] of store.files) if (saved.files.get(rel) !== text) write(rel, text);
    for (const rel of saved.files.keys()) if (!store.files.has(rel)) fs.rmSync(file(rel), { force: true });
    if (store.meta && JSON.stringify(store.meta) !== saved.meta) write(META, `${JSON.stringify(store.meta, null, 2)}\n`);
  }
}

module.exports = { SettingsSync, changedSettings, mergeSettings, repoIdFor, settingsObject };
