// LANGUAGES. The game is written in English; every other language is a table in js/lang/<code>.js that maps each
// English string, exactly as it is in the code, to its translation. t(english) looks it up and falls back to English.
// Numbers are matched loosely: 'Doorways seen: 2 of 4.' finds the entry 'Doorways seen: {n} of {n}.' and puts the
// numbers back. say, flashSub, hint, prompt, choose, the field notes, the ending card and the menus all call t(),
// so a scene never has to. After changing any English text, run  node tools/i18n.js  to list what each language lacks.
export const LANGS = [
  ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português (Brasil)'],
];
const pick = () => {
  const q = new URLSearchParams(location.search).get('lang');   // ?lang=de tries a language without saving it (test drivers)
  if (q && LANGS.some(([c]) => c === q)) return q;
  try { const s = localStorage.getItem('uap-lang'); if (s && LANGS.some(([c]) => c === s)) return s; } catch (_) {}
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return LANGS.some(([c]) => c === nav) ? nav : 'en';
};
export const LANG = pick();
let dict = {};
if (LANG !== 'en') { try { dict = (await import(`./lang/${LANG}.js`)).default; } catch (e) { console.warn('language table failed to load', e); } }
document.documentElement.lang = LANG === 'pt' ? 'pt-BR' : LANG;

// the quotation marks round a being's speech
export const QUOTES = { en: ['“', '”'], es: ['«', '»'], fr: ['« ', ' »'], de: ['„', '“'], pt: ['“', '”'] }[LANG];

const missed = new Set();
const norm = (s) => s.replace(/\s+/g, ' ').trim();   // \s includes the non-breaking spaces of the menus
export function t(s) {
  if (LANG === 'en' || s == null || s === '') return s;
  s = String(s);
  if (dict[s] !== undefined) return dict[s];
  const n = norm(s);
  if (dict[n] !== undefined) return dict[n];
  const act = n.match(/^(E|ACT) — (.+)$/);   // 'E — open the door': the key stays, the button name and the action are translated
  if (act) return (act[1] === 'ACT' ? t('ACT') : 'E') + ' — ' + t(act[2]);
  if (/\d/.test(n)) {
    const nums = n.match(/\d+/g), k = n.replace(/\d+/g, '{n}');
    if (dict[k] !== undefined) { let i = 0; return dict[k].replace(/\{n\}/g, () => nums[i++] ?? ''); }
  }
  if (/[a-z]/i.test(n) && !missed.has(n)) { missed.add(n); let dev = false; try { dev = localStorage.getItem('uap-dev') === '1'; } catch (_) {} if (dev) console.warn('[' + LANG + '] untranslated:', n); }
  return s;
}
// translate every text node under root (the menus written in index.html)
export function translateTree(root) {
  if (LANG === 'en' || !root) return;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = walk.nextNode());) {
    const raw = n.nodeValue, key = norm(raw);
    if (!key || !/[a-z]/i.test(key)) continue;
    const tr = t(key);
    if (tr !== key) n.nodeValue = raw.replace(raw.trim(), tr);
  }
}
export function setLang(code) { try { localStorage.setItem('uap-lang', code); } catch (_) {} location.reload(); }
