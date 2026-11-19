import './reset.js';   // first: a new build clears every stored setting before anything reads one
import { CREDITS } from './credits.js';
// Boot and scene order.
import { E, G, $, clearScene, resetNight, toggleNotes, noteCount, lockPointer, setPause, releaseInput, DEV, THREE } from './engine.js';
import { greyArmHits, heldSegment } from './models.js';
import { initDev } from './dev.js';
import { initTouch } from './touch.js';
initTouch();
import { A } from './audio.js';
import { bedroom, exam } from './scenes/night.js';
import { hub, resetShip, ROOMS } from './scenes/ship.js';
import { mandala, ending } from './scenes/beyond.js';
import { fxQuality } from './fx.js';
import { t, translateTree, LANGS, LANG, setLang } from './i18n.js';

fxQuality.value = 1;   // the vision always draws at full detail; a slow machine gives up resolution instead (engine.js), never pattern

const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
// the developer F3 panel names the room you are in (the hub runs them through ROOMS[name], so wrapping here covers it)
for (const k of Object.keys(ROOMS)) { const f = ROOMS[k]; ROOMS[k] = async (...a) => { E.room = k; try { return await f(...a); } finally { E.room = null; } }; }
const ENDINGS = ['missing', 'communion', 'wardens', 'phone', 'sceptic']; // the keys of ENDS in scenes/beyond.js
let devRoom = new URLSearchParams(location.search).get('room');
const scenes = { bedroom, exam, hub, mandala, room: async () => {
  if (has(ROOMS, devRoom)) { G.visited[devRoom] = true; await ROOMS[devRoom](); }
  return 'hub';
} };
const validScene = (s) => has(scenes, s) || (typeof s === 'string' && s.startsWith('end:') && ENDINGS.includes(s.slice(4)));
// testing aids come from the URL; anything unrecognised falls back to normal play instead of breaking the game
// they only work with ?dev=1, so a shared link cannot spoil or speed up someone's first night
if (!DEV || !validScene(E.startScene)) E.startScene = null;
if (!DEV) E.timeScale = 1;
if (!(E.timeScale > 0 && E.timeScale <= 20)) E.timeScale = 1;

let gen = 0; // a jump from the developer menu starts a new run; the old one is abandoned where it stands
async function run(start) {
  const my = ++gen;
  let s = start;
  for (;;) {
    clearScene();
    if (!validScene(s)) throw new Error('unknown scene ' + String(s));
    E.sceneName = s; E.room = null;   // shown in the developer F3 panel
    s = s.startsWith('end:') ? await ending(s.slice(4)) : await scenes[s]();
    if (my !== gen) return;
  }
}
// any error a player hits is shown on screen with the build, so a tester can report it; only the first is shown
const BUILD = ($('build') && $('build').textContent.trim()) || '';
let failed = false;
const fail = (err) => {
  console.error(err);
  if (failed) return; failed = true;
  const msg = (err && err.message) || String(err);
  $('hint').textContent = 'Something broke' + (BUILD ? ' (' + BUILD + ')' : '') + ': ' + msg + '. Reload the page to start again.';
};
addEventListener('error', (e) => fail(e.error || e.message));
addEventListener('unhandledrejection', (e) => fail(e.reason));
const setState = (st) => {
  if (['fight', 'calm', 'afraid'].includes(st.path)) G.path = st.path;
  if (Number.isFinite(st.lucid)) G.lucidity = Math.min(1, Math.max(0, st.lucid));
  if (Number.isFinite(st.fear)) G.fear = Math.min(1, Math.max(0, st.fear));
  if (Number.isFinite(st.trust)) G.trust = st.trust;
  if (st.stare) G.stare = true;
  if (st.seen > 0) ['class', 'window', 'containers', 'viewing'].slice(0, Math.min(4, Math.floor(st.seen))).forEach((k) => { G.visited[k] = true; });
  if (st.asked) G.asked = true;
  if (st.toy) G.toy = true;
  E.devCouncil = !!st.council; E.devFlower = !!st.flower;
};
// developer menu: drop whatever is happening and start again from the chosen place
function jump(scene, st = {}) {
  A.init();
  for (const id of ['title', 'endcard', 'notes']) $(id).style.display = 'none';
  $('fade').style.background = '#000'; $('fade').style.opacity = 1;
  E.heart = false; E.shake = 0;
  resetNight(); resetShip();
  G.lucidity = 0.8; G.fear = 0.2;
  setState(st);
  if (scene.startsWith('room:')) { devRoom = scene.slice(5); scene = 'room'; }
  setPause(false); releaseInput(); lockPointer();
  run(scene).catch(fail);
}
if (DEV) initDev(jump);
else addEventListener('keydown', (e) => { if (e.code === 'F2') { try { localStorage.setItem('uap-dev', '1'); } catch (_) {} location.reload(); } });

// languages: the menus written in index.html are translated here, and the title screen gets a language row
for (const id of ['title', 'notes', 'endcard', 'credits']) translateTree($(id));
$('bar').dataset.label = t('FOCUS');
{
  const row = document.createElement('div'); row.className = 'langs';
  for (const [code, name] of LANGS) {
    const b = document.createElement('button'); b.className = 'lang' + (code === LANG ? ' on' : ''); b.textContent = name; b.lang = code;
    b.onclick = () => { if (code !== LANG) setLang(code); };
    row.append(b);
  }
  $('title').insertBefore(row, $('title').querySelector('.warn'));
}
$('noteCount').textContent = noteCount();
$('notesBtn').onclick = () => toggleNotes(true);
// credits: built from js/credits.js
{
  const list = $('creditsList');
  for (const sec of CREDITS) {
    const h = document.createElement('h2'); h.textContent = t(sec.title); list.append(h);
    for (const [name, what] of sec.lines) {
      const d = document.createElement('div'), b = document.createElement('b'); d.className = 'c'; b.textContent = t(name); d.append(b);
      if (what) { const i = document.createElement('i'); i.textContent = '  ·  ' + t(what); d.append(i); }
      list.append(d);
    }
  }
  const show = (v) => { $('credits').style.display = v ? 'block' : 'none'; };
  $('creditsBtn').onclick = $('endCreditsBtn').onclick = () => show(true);
  $('creditsClose').onclick = () => show(false);
}
$('notesClose').onclick = () => toggleNotes(false);
$('startBtn').onclick = () => {
  A.init();
  $('title').style.display = 'none';
  resetNight(); resetShip();
  // testing aids: ?scene=hub&path=calm&seen=3&lucid=0.8&trust=-2&stare=1&asked=1&toy=1 (&scene=mandala&council=1: start at the council)
  const q = new URLSearchParams(DEV ? location.search : '');
  setState({ path: q.get('path'), lucid: q.get('lucid') ? Number(q.get('lucid')) : NaN, seen: Number(q.get('seen')),
    trust: q.get('trust') ? Number(q.get('trust')) : NaN, stare: q.get('stare') === '1', asked: q.get('asked') === '1', toy: q.get('toy') === '1', council: q.get('council') === '1' });
  lockPointer();
  run(E.startScene || 'bedroom').catch(fail);
};
if (DEV) window.UAP = { E, G, A };
// Developer mode: clipping watchdog (build 122, after an arm through a grey's chest shipped in build 120). Every other
// frame every visible grey has both arms and anything held in its hands tested against its own torso and head
// (models.js greyArmHits). The first clip of each arm per scene is a console warning naming scene, time, grey and part;
// tools/shot.js prints console warnings at the end of every run, so every headless check reports clipping unasked.
// window.UAP.clips holds them all. Mantis and people are not covered yet (no volumes for them).
if (DEV) {
  const seen = new Set(), a = new THREE.Vector3(), b = new THREE.Vector3(); let n = 0, last = null;
  window.UAP.clips = [];
  E.sys.add(() => {
    if (E.sceneName !== last) { last = E.sceneName; seen.clear(); }
    if (++n % 2 || !E.scene) return;
    let i = 0;
    E.scene.traverse((o) => {
      const u = o.userData; if (!u || !u.armR || !u.chest || !u.root) return;
      const id = i++; let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) { vis = false; break; }
      if (!vis) return;
      for (const sd of ['R', 'L']) {
        const key = id + sd; if (seen.has(key) || u['fore' + sd].parent !== u['arm' + sd]) continue;
        const held = u['held' + sd], extra = held && held.visible && held.parent === u['hand' + sd] ? heldSegment(held, a, b) : null;
        const hits = greyArmHits(o, sd, extra);
        if (hits) { seen.add(key); const msg = 'CLIP ' + E.sceneName + ' t=' + E.time.toFixed(2) + ' grey#' + id + ' arm' + sd + (held ? '+held' : '') + ' ' + hits + ' points inside its own body (' + u._hitParts + '), caption "' + $('sub').textContent.slice(0, 50) + '"'; window.UAP.clips.push(msg); console.warn(msg); }
      }
    });
  });
}   // A: test drivers can read A.playing()
