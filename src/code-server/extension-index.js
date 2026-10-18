// The active index is authoritative; old extension folders may remain after update/restore.
// Parsing is shared, while each caller chooses whether a failed read is fatal or unavailable.
const fs = require('fs');
const path = require('path');

function validRelativeLocation(location) {
  return typeof location === 'string' && Boolean(location) && !/^[\\/]|^[a-z]:/i.test(location) && !location.split(/[\\/]/).includes('..');
}
function invalidIndex() {
  return Object.assign(new Error('Invalid extension list.'), { code: 'INVALID_EXTENSION_INDEX' });
}
function parseExtensionIndex(text, { strict = false } = {}) {
  const raw = text == null ? [] : JSON.parse(text);
  if (!Array.isArray(raw)) throw invalidIndex();
  const entries = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      if (strict) throw invalidIndex();
      continue;
    }
    const originalId = typeof entry.identifier?.id === 'string' ? entry.identifier.id : null;
    entries.push({ id: originalId?.toLowerCase() || null, originalId, identifier: entry.identifier,
      version: entry.version, relativeLocation: typeof entry.relativeLocation === 'string' ? entry.relativeLocation : '',
      validLocation: validRelativeLocation(entry.relativeLocation),
      declaredTargetPlatform: entry.metadata?.targetPlatform, targetPlatform: entry.metadata?.targetPlatform || 'universal' });
  }
  const byId = new Map(entries.filter((entry) => entry.id).map((entry) => [entry.id, entry]));
  return { available: text != null, entries, byId, versions: new Map([...byId].map(([id, entry]) => [id, entry.version])) };
}
async function readExtensionIndex(files, root, options) {
  return parseExtensionIndex(await files.read(files.join(root, 'extensions.json')), options);
}
function readExtensionIndexSync(root, options) {
  let text;
  try { text = fs.readFileSync(path.join(root, 'extensions.json'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return parseExtensionIndex(text, options);
}
module.exports = { parseExtensionIndex, readExtensionIndex, readExtensionIndexSync, validRelativeLocation };
