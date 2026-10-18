// Puts an English UI string into the language of a table of translations. The English text is the
// key, so a string without a translation, or with one made for older English, shows in English
// and the UI never breaks for want of one (npm run translations lists them). Loaded by the pages
// as a plain script; the main process and the tests require it.

// `t(text, params)` for a table of translations (English text → translated text). {name} in the
// text is filled in with params.name.
function translator(messages) {
  const table = messages || {};
  return (text, params) => fill(Object.hasOwn(table, text) ? table[text] : text, params);
}

// Fills each {name} with params.name. A placeholder without a value stays as it is, so the
// mistake shows instead of an empty gap.
function fill(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}

// The names of the placeholders in a string, sorted: a translation uses the same ones.
function placeholders(text) {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
}

if (typeof module === 'object') module.exports = { fill, placeholders, translator };
