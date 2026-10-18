// The settings the app brings from the repository's other tabs. Apart from
// extension.js, which needs VS Code, so that the tests can load it.

// Sets them one by one with `update(key, value)` (undefined removes one). Resolves the keys it
// could not set: VS Code refuses one no extension has registered, for one.
async function applySettings({ set = {}, remove = [] }, update) {
  const failed = [];
  for (const [key, value] of [...Object.entries(set), ...remove.map((key) => [key, undefined])]) {
    try {
      await update(key, value);
    } catch {
      failed.push(key);
    }
  }
  return failed;
}

module.exports = { applySettings };
