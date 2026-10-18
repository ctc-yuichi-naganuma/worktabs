// The language of the app's own UI (menus, dialogs, the side bar), and `t`, which puts an English
// UI string into it. English is the original, written in the code; the other languages are tables
// keyed by the English text (ja.json). The app picks the language once, at start (setLanguage).
// Nothing here needs Electron, so it can be tested.
const { translator } = require('./translate');

const TRANSLATIONS = { ja: require('./ja.json') };
const LANGUAGES = ['en', ...Object.keys(TRANSLATIONS)];

// The UI language for the `locale` setting, which also sets VS Code's display language: that one
// when the app has it, English when it does not. An empty setting follows the system's preferred
// languages (`preferred`, e.g. ['ja-JP', 'en-US']): the first one the app has.
function resolveLanguage(setting, preferred = []) {
  const tags = setting ? [setting] : preferred;
  for (const tag of tags) {
    const base = String(tag).toLowerCase().split(/[-_]/)[0];
    if (LANGUAGES.includes(base)) return base;
  }
  return 'en';
}

let current = { language: 'en', t: translator() };

function setLanguage(language) {
  const known = LANGUAGES.includes(language) ? language : 'en';
  current = { language: known, t: translator(TRANSLATIONS[known]) };
}

function language() {
  return current.language;
}

function t(text, params) {
  return current.t(text, params);
}

// The table the pages build their own `t` from (translate.js).
function messages() {
  return TRANSLATIONS[current.language] || {};
}

// Items joined as a list in the UI language: "a, b, and c", "a、b、c".
function listText(items) {
  return new Intl.ListFormat(current.language, { type: 'conjunction' }).format(items.map(String));
}

// VS Code's display language (code-server --locale): the `locale` setting, or the app's UI
// language when the setting is empty. Always one: without --locale, code-server would follow the
// browser's language, with whatever language packs happen to be in the extensions folder.
function displayLocale(setting, uiLanguage) {
  return String(setting || uiLanguage || 'en').toLowerCase();
}

// The suffix of the Open VSX id of VS Code's language pack (MS-CEINTL.vscode-language-pack-<x>)
// for each display language that has one.
const LANGUAGE_PACKS = {
  cs: 'cs',
  de: 'de',
  es: 'es',
  fr: 'fr',
  it: 'it',
  ja: 'ja',
  ko: 'ko',
  pl: 'pl',
  'pt-br': 'pt-BR',
  ru: 'ru',
  tr: 'tr',
  'zh-cn': 'zh-hans',
  'zh-tw': 'zh-hant',
};

// The extensions to install: the configured ones, and the language pack of the display language
// unless they have it. English needs none.
function withLanguagePack(extensions, locale) {
  const pack = LANGUAGE_PACKS[locale];
  if (!pack) return [...extensions];
  const id = `MS-CEINTL.vscode-language-pack-${pack}`;
  return extensions.some((each) => each.toLowerCase() === id.toLowerCase()) ? [...extensions] : [...extensions, id];
}

module.exports = { LANGUAGES, TRANSLATIONS, displayLocale, language, listText, messages, resolveLanguage, setLanguage, t, withLanguagePack };
