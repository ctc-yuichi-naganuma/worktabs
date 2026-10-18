// The UI language of a page (the side bar, the dialogs): the page's `t`, made from the table its
// preload got from the main process (window.i18n), and the text of the page's own HTML put into
// that language. Loaded as a plain script after translate.js and before the page's other scripts,
// which use `t` and `listText` from here.

// `var`, not `const`: the scripts the tests also require (time.js, checks.js) declare `t` with
// `var` too, for when they run outside a page, and a page's plain scripts share their globals.
var t = translator(window.i18n && window.i18n.messages);

const pageLanguage = (window.i18n && window.i18n.language) || 'en';
document.documentElement.lang = pageLanguage;

// Items joined as a list in the page's language: "a, b, and c", "a、b、c".
function listText(items) {
  return new Intl.ListFormat(pageLanguage, { type: 'conjunction' }).format(items.map(String));
}

// data-i18n="English" sets an element's text; data-i18n-title, data-i18n-aria-label and
// data-i18n-placeholder set those attributes. The English is in the attribute, so that
// npm run translations finds it.
const I18N_ATTRIBUTES = ['title', 'aria-label', 'placeholder'];
for (const element of document.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-aria-label], [data-i18n-placeholder]')) {
  if (element.hasAttribute('data-i18n')) element.textContent = t(element.getAttribute('data-i18n'));
  for (const name of I18N_ATTRIBUTES) {
    const english = element.getAttribute(`data-i18n-${name}`);
    if (english !== null) element.setAttribute(name, t(english));
  }
}
