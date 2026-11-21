// Translation check. Collects every English string the player can see, from the source, and lists what each language
// table in js/lang/ lacks (and what it has that the game no longer uses).
//   node tools/i18n.js            -> report per language; writes tools/i18n-strings.json (every string, with where it is)
//   node tools/i18n.js --missing es  -> prints the strings Spanish lacks, as JSON, ready to translate
// Strings are keyed exactly as js/i18n.js looks them up: whitespace collapsed, numbers as {n}, 'E — ' prefixes dropped.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const STR = String.raw`'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|` + '`(?:\\\\.|[^`\\\\])*`';
const lit = (s) => { try { return Function('return ' + s)(); } catch (_) { return null; } };
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const ent = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// files the player sees text from (dev.js, fx.js, models.js, audio.js are developer-only or draw no text)
const JS = ['js/scenes/night.js', 'js/scenes/ship.js', 'js/scenes/beyond.js', 'js/scenes/control.js', 'js/scenes/field.js', 'js/scenes/reveal.js', 'js/engine.js', 'js/main.js', 'js/touch.js', 'js/jester-lines.js'];   // notes and credits: read as data below
// literals that look like text but never reach the screen
const IGNORE = new Set(['II', 'Something broke', '. Reload the page to start again.', 'language table failed to load', 'untranslated:',
  'high-performance', 'no-store', 'YXZ', 'BUTTON', 'fps · resolution', 'draws ·', 'warm failed', 'layer on', 'unknown scene', 'DEV',
  's axis in the hand', 's surface, in the right hand', 'ACT —', 'beads drawn']);
const CODEY = /[{}=<>]|^[a-z-]+:\S|^#|^\.(?!\.\.)|^\w+:\/\/|\.(js|txt|html|png|jpg)$|^[a-z]+(-[a-z]+)+$|^[a-z]+[A-Z]\w*$|^(Key|Arrow|Digit)\w+$/;
// engine.js lines that only the developer overlay shows
const DEV_LINES = (src) => { const a = src.findIndex((l) => /function devText|const devText/.test(l)); return a < 0 ? [] : [a, a + 30]; };

const out = new Map();   // key -> [where, ...]
const add = (s, where, dyn) => {   // dyn: its numbers change at run time, so they are keyed as {n}
  if (s == null) return;
  s = norm(String(s)).replace(/^(E|ACT) — /, '');
  if (!s || !/[a-z]/i.test(s) || IGNORE.has(s) || /^(v[\d.]+ [a-z]+ · )?build \d+$/.test(s)) return;   // the version label on the title screen
  if (/\b(uniform|varying)\s+(float|vec\d|mat\d|sampler)|\bvec\d\(|\bnormalize\(|COMMON\.replace/.test(s)) return;   // GLSL source fragments
  if (dyn) s = s.replace(/\d+/g, '{n}');
  if (!out.has(s)) out.set(s, []);
  if (out.get(s).length < 3) out.get(s).push(where);
};
const htmlText = (html, where) => { for (const part of ent(html.replace(/<br\s*\/?>/g, '\n')).split(/<[^>]*>|\n/)) add(part, where); };

for (const f of JS) {
  const lines = read(f).split('\n');
  const [d0, d1] = f === 'js/engine.js' ? DEV_LINES(lines) : [-1, -1];
  let inStyle = false;
  lines.forEach((ln, i) => {
    if (i >= d0 && i <= d1) return;
    if (f === 'js/engine.js' && /^\s*\[(\/|')/.test(ln)) return;   // the TOUCH_WORDS pieces; their results are added below
    // whole-line comments, and a comment after the code on the same line (its apostrophes read as strings otherwise)
    const code = ln.replace(/^\s*\/\/.*$/, '').replace(/([;{}),])\s+\/\/.*$/, '$1');
    const where0 = f + ':' + (i + 1);
    // whatever is passed straight to a caption call is text, whatever it looks like ('...They stop', a lone word):
    // the filters below never get to drop it (build 133: two lines starting with '...' were dropped as code)
    for (const m of code.matchAll(new RegExp(String.raw`\b(?:say|flashSub|hint|prompt)\(\s*(${STR})`, 'g'))) add(lit(m[1]), where0);
    for (const m of code.matchAll(/\bchoose\(\[(.*?)\]\)/g)) for (const x of m[1].matchAll(new RegExp(STR, 'g'))) add(lit(x[0]), where0);
    if (/\bconsole\.(log|warn|error)\(|\bUAP\.clips\b/.test(code)) return;   // developer messages (the CLIP watchdog), never shown to players
    if (/^\s*(precision|uniform|varying|float|vec\d|void|#)/.test(code) || /glsl|THREE\.ShaderMaterial/.test(code)) return;
    if (/`\s*$/.test(code) && /(css|style|Shader|glsl)\s*=\s*`/i.test(code)) inStyle = true;
    if (inStyle) { if (/^\s*`/.test(code) || /`;?\s*$/.test(code) && !/=\s*`/.test(code)) inStyle = false; return; }
    const where = f + ':' + (i + 1);
    // the flashed words in the vision are single lower-case words: take every string on that line
    if (/frags = \[/.test(code)) { for (const m of code.matchAll(new RegExp(STR, 'g'))) add(lit(m[0]), where); return; }
    for (const m of code.matchAll(new RegExp(STR, 'g'))) {
      const raw = m[0];
      if (raw[0] === '`' && raw.includes('${')) continue;   // built strings are listed by hand below
      const s = lit(raw); if (typeof s !== 'string') continue;
      if (/<[a-z]/i.test(s)) { htmlText(s, where); continue; }
      const n = norm(s);
      if (CODEY.test(n)) continue;
      // text: has a space, or is a word in capitals (a button), or a capitalised single word in a text list
      if (/\s/.test(n) || /^[A-Z][A-Z'’]+$/.test(n) || /^[A-Z][a-z]+[.!?]$/.test(n)) add(s, where);
    }
  });
}
// index.html: every text node outside <style>/<script>
{
  const html = read('index.html').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<head[\s\S]*?<\/head>/g, '');
  htmlText(html, 'index.html');
  add('FOCUS', 'index.html (bar label)');
}
// field notes and credits, read as data so no field is missed
const data = (f, name) => Function(read(f).replace(new RegExp('export const ' + name + ' ='), 'return'))();
for (const [id, n] of Object.entries(data('js/notes.js', 'NOTES'))) for (const k of ['title', 'text', 'src']) add(n[k], 'js/notes.js ' + id + '.' + k);
for (const sec of data('js/credits.js', 'CREDITS')) { add(sec.title, 'js/credits.js'); for (const l of sec.lines) for (const x of l) add(x, 'js/credits.js'); }
// the jesters' shouts
for (const l of read('js/jester-lines.txt').split(/\r?\n/)) add(l, 'js/jester-lines.txt');
// built strings and words made in code
for (const s of ['COUNTED', 'RECURRING', 'ONE ACCOUNT', 'CONTESTED', 'GAME', 'Field note:', 'Not yet witnessed', 'You have been through here.']) add(s, 'built in code');
for (const s of ['Field notes found: 1 / 2.', 'W A S D to walk, SHIFT to run. Doorways seen: 1 of 4.']) add(s, 'built in code; the numbers change', true);
// every hint as a phone shows it (engine.js TOUCH_WORDS)
{
  const src = read('js/engine.js'), m = src.match(/const TOUCH_WORDS = (\[[\s\S]*?\n\]);/);
  const TW = Function('return ' + m[1])();
  for (const k of [...out.keys()]) { const v = TW.reduce((s, [a, b]) => s.replace(a, b), k); if (v !== k) add(v, 'touch form of: ' + k.slice(0, 60), k.includes('{n}')); }
}

const all = [...out.keys()];
fs.writeFileSync(path.join(__dirname, 'i18n-strings.json'), JSON.stringify(Object.fromEntries([...out].map(([k, v]) => [k, v.join(' | ')])), null, 1));
const langs = fs.existsSync(path.join(root, 'js/lang')) ? fs.readdirSync(path.join(root, 'js/lang')).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)) : [];
const load = (c) => { const src = read(`js/lang/${c}.js`).replace(/^\s*export default\s*/m, 'return '); return Function(src)(); };
const want = process.argv.indexOf('--missing');
if (want > 0) {
  const c = process.argv[want + 1], d = langs.includes(c) ? load(c) : {};
  console.log(JSON.stringify(Object.fromEntries(all.filter((k) => d[k] === undefined).map((k) => [k, out.get(k).join(' | ')])), null, 1));
} else {
  console.log(all.length, 'English strings -> tools/i18n-strings.json');
  for (const c of langs) {
    const d = load(c), miss = all.filter((k) => d[k] === undefined), extra = Object.keys(d).filter((k) => !out.has(k));
    const nums = Object.entries(d).filter(([k, v]) => (k.match(/\{n\}/g) || []).length !== (String(v).match(/\{n\}/g) || []).length).map(([k]) => k);
    // a pause the English has ('Now... nothing is') that the translation lost
    const dots = (s) => /\.\.\.|…/.test(s), pause = Object.entries(d).filter(([k, v]) => out.has(k) && dots(k) && !dots(String(v))).map(([k]) => k);
    // an English line that was edited leaves its old entry unused and the new one missing: pair them up, so the
    // translation is redone from the new English (not just re-keyed, which keeps the old meaning)
    const words = (s) => new Set(s.toLowerCase().match(/[a-z']+/g) || []);
    const sim = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, Math.min(A.size, B.size)); };
    const changed = [];
    for (const k of miss) { let best = null, bs = 0.5; for (const e of extra) { const s = sim(k, e); if (s > bs) { bs = s; best = e; } } if (best) changed.push([k, best]); }
    const paired = new Set(changed.flatMap(([k, e]) => [k, e]));
    console.log(`${c}: ${all.length - miss.length}/${all.length} translated` + (miss.length ? `, ${miss.length} missing` : '') + (changed.length ? ` (${changed.length} of them edited English)` : '') + (extra.length ? `, ${extra.length} unused` : '') + (nums.length ? `, ${nums.length} with wrong {n} count` : '') + (pause.length ? `, ${pause.length} lost a "..."` : ''));
    for (const [k, e] of changed) console.log('   edited:  ' + k.slice(0, 110) + '\n      was:  ' + e.slice(0, 110) + '\n      old translation: ' + String(d[e]).slice(0, 110));
    for (const k of miss.filter((k) => !paired.has(k)).slice(0, 15)) console.log('   missing: ' + k.slice(0, 110));
    for (const k of extra.filter((k) => !paired.has(k)).slice(0, 8)) console.log('   unused:  ' + k.slice(0, 110));
    for (const k of nums) console.log('   {n}:     ' + k.slice(0, 110));
    for (const k of pause) console.log('   "...":   ' + k.slice(0, 110));
    if (miss.length || nums.length || pause.length) process.exitCode = 1;
  }
}
