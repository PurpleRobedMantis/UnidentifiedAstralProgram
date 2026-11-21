// Core: renderer, camera control, input, timing helpers and on-screen text.
import * as THREE from 'three';
import { A } from './audio.js';
import { NOTES } from './notes.js';
import { t, QUOTES, translateTree } from './i18n.js';
export { t };
export { THREE };

export const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// Player state for one night.
export const G = {};
export function resetNight() {
  G.cued = false;   // the reveal: the cue from the doorway was seen in the remembered room
  G.wove = false;   // the control room: your own touch drew the chosen thread tight
  Object.assign(G, { fear: 0.2, lucidity: 0.5, trust: 0, path: null, stare: false, toy: false, visited: {}, asked: false, talks: 0 });
}
resetNight();

export const E = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(70, 1, 0.03, 400),
  renderer: null,
  time: 0,
  timeScale: Number(params.get('fast')) || 1,
  startScene: params.get('scene'),
  yaw: 0, pitch: 0, roll: 0, shake: 0,
  base: { yaw: 0, pitch: 0 },
  limits: null,            // { yaw, up, down } radians around base
  mode: 'locked',          // 'locked' | 'look' | 'walk'
  bounds: null,            // (x, z) => boolean, for walk mode
  pull: { yaw: 0, pitch: 0 }, // attention drift in rad/s
  gazeAt: null,            // a point the player is meant to keep looking at while something pulls their eyes away (shows the touch FOCUS button)
  steady: false,           // FOCUS held (touch): the pull weakens and the view eases toward gazeAt
  captureLook: null,       // (dx, dy) => void: diverts look input
  canAct: false,           // a scene sets this while E does something right now (shows the touch ACT button)
  lookVel: 0,
  keys: {},
  just: new Set(),
  updaters: new Set(),
  sys: new Set(),
  wantLock: true,
  heart: false,
  dread: 0,        // 0..1, raised by a scene (the jester hall: each face you look at); speeds the heart on top of fear and panic
  unsteady: false, // low lucidity: registered details change while out of view (unsteady() below)
  details: [],
};

const canvas = $('view');
// Resolution adapts to the frame rate: it drops when frames are slow and recovers when there is headroom.
try {
  E.renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio <= 1.25, powerPreference: 'high-performance' });
} catch (err) {
  const m = document.createElement('p'); m.style.color = '#e59a86';
  m.textContent = 'This game needs WebGL, which this browser or graphics driver has turned off.';
  $('title').appendChild(m);
  throw err;
}
// a browser with graphics acceleration off draws on the CPU (SwiftShader, WARP, llvmpipe) at a fraction of the speed: say so on the title screen
E.gpuName = '';
try {
  const gl = E.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  E.gpuName = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  if (/swiftshader|\bwarp\b|llvmpipe|basic render|software/i.test(E.gpuName)) {
    const m = document.createElement('p'); m.className = 'warn'; m.id = 'gpuWarn'; m.style.color = '#e59a86';
    m.textContent = 'Graphics acceleration is off in this browser, so the game will run very slowly. Turn on hardware acceleration in the browser settings, restart the browser, then reload this page.';
    $('title').insertBefore(m, $('build'));
  }
} catch (_) {}
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setPause(true); $('hint').textContent = t('The graphics card reset. Reload the page to continue.'); });
const RES = { max: Math.min(devicePixelRatio, 1.5), min: 0.5, cur: Math.min(devicePixelRatio, 1.5), applied: 0, ema: 16, timer: 0, good: 0 };
try { const saved = Number(localStorage.getItem('uap-res')); if (saved >= RES.min && saved <= RES.max) RES.cur = saved; } catch (_) {}
function applyRes() {
  const want = RES.cur;
  if (Math.abs(want - RES.applied) > 0.04) { RES.applied = want; E.renderer.setPixelRatio(want); }
}
applyRes();
// ---- low lucidity: details that will not hold (scenes that set E.unsteady) ----
// Below lucidity 0.55 things change while you are not looking at them, and never while you are: the writing reads
// differently, someone has turned to look at you, something has moved. Look away and look back, and it is not the same
// (the dream check from lucid-dreaming practice). A scene registers each detail with unsteady(); once the detail has been
// wholly out of view for 0.7 s it gets one roll: change (chance 0.2 at lucidity 0.55, rising to 0.9 at 0.15) or, if
// already changed, perhaps go back. Nothing rolls again until it has been seen. With lucidity back at 0.55 or above,
// whatever had changed goes back the next time it is out of sight.
// Build 151 adds two things while lucidity is low: now and then a detail you are looking straight at warps (stretches
// thin and wavers for about a second) and changes in front of you; and every so often the whole view blurs for a few
// seconds with a line saying you are struggling to stay lucid (a CSS blur on the canvas, so it costs no shader).
// (Builds 135-139 blurred the whole view all the time instead: a lower render scale, then a Gaussian.)
export const unsteadyAmount = () => (E.unsteady && G.lucidity < 0.55 ? Math.min(1, (0.55 - G.lucidity) / 0.4) : 0);
// obj: the thing watched, tested by its world bounding box; or `at` and r: a fixed world point and radius in metres
// (parts of an InstancedMesh). change(k, n): k > 0 alters it (k = how unsteady, n counts up from 1,
// a fresh variant each time); change(0, 0) puts it back as it was. Set d.hold = true while the scene animates it itself.
export function unsteady(obj, change, { r = 0.5, at = null } = {}) {
  const d = { obj, change, r, at, away: 0, rolled: true, changed: false, hold: false, n: 0, seenT: 0 };
  E.details.push(d); return d;
}
const DET = { fr: new THREE.Frustum(), m: new THREE.Matrix4(), s: new THREE.Sphere(), b: new THREE.Box3() };
// a warp in progress: { d, t, dur, base (scale), changed (done at the midpoint) }; WARP.next counts down to the next one
const WARP = { on: null, next: 6, v: new THREE.Vector3(), f: new THREE.Vector3() };
function endWarp() { const w = WARP.on; if (!w) return; WARP.on = null; w.d.obj.scale.copy(w.base); }
function runWarp(dt, k) {
  const w = WARP.on;
  if (!w) return;
  w.t += dt; const u = Math.min(1, w.t / w.dur);
  if (w.d.hold || !w.d.obj.parent) { endWarp(); return; }
  // stretches tall and thin and wavers, never squashes (a seated child must not sink into the stool): height grows by up
  // to 14%, width shrinks by up to 8%, beating three times, eased in and out
  const env = Math.sin(Math.PI * u), wob = Math.abs(Math.sin(u * Math.PI * 3)) * env, a = 0.6 + 0.4 * k;
  w.d.obj.scale.set(w.base.x * (1 - 0.08 * a * wob), w.base.y * (1 + 0.14 * a * wob), w.base.z * (1 - 0.08 * a * wob));
  if (!w.changed && u >= 0.5) {
    w.changed = true;
    if (w.d.changed && Math.random() < 0.3) { w.d.changed = false; w.d.change(0, 0); } else { w.d.changed = true; w.d.change(Math.max(k, 0.05), ++w.d.n); }
  }
  if (u >= 1) endWarp();
}
function watchDetails(dt) {
  if (!E.details.length) { endWarp(); return; }
  const k = unsteadyAmount();
  E.camera.updateMatrixWorld();
  DET.m.multiplyMatrices(E.camera.projectionMatrix, E.camera.matrixWorldInverse); DET.fr.setFromProjectionMatrix(DET.m);
  runWarp(dt, k);
  if (!WARP.on && k > 0) WARP.next -= dt;
  let pick = null, pickA = 0.45;
  E.camera.getWorldDirection(WARP.f);
  for (const d of E.details) {
    // a margin either way: anything still touching the edge of the screen counts as seen
    const seen = d.at ? DET.fr.intersectsSphere(DET.s.set(d.at, d.r * 1.15)) : DET.fr.intersectsBox(DET.b.setFromObject(d.obj).expandByScalar(0.08));
    if (seen) {
      d.away = 0; d.rolled = false; d.seenT += dt;
      // low lucidity: of the details held near the middle of the view for 1.5 s or more, the nearest the centre may warp
      if (k > 0 && !WARP.on && WARP.next <= 0 && !d.at && !d.hold && d.seenT > 1.5) {
        DET.b.getCenter(WARP.v); E.camera.getWorldPosition(DET.s.center); WARP.v.sub(DET.s.center).normalize();
        const an = Math.acos(Math.min(1, Math.max(-1, WARP.v.dot(WARP.f))));
        if (an < pickA) { pickA = an; pick = d; }
      }
      continue;
    }
    d.seenT = 0;
    d.away += dt;
    if (d.rolled || d.hold || d.away < 0.7) continue;
    d.rolled = true;
    if (d.changed && (k === 0 || Math.random() < 0.3)) { d.changed = false; d.change(0, 0); }
    else if (k > 0 && Math.random() < 0.2 + 0.7 * k) { d.changed = true; d.change(k, ++d.n); }
  }
  if (pick) {
    WARP.on = { d: pick, t: 0, dur: 1.1, base: pick.obj.scale.clone(), changed: false };
    WARP.next = (9 + Math.random() * 9) * (1.4 - 0.6 * k);   // about every 10-25 s of looking, more often the lower lucidity is
  }
}
// low lucidity: now and then the view blurs for a few seconds, with a line the first times
const LAPSE = { t: -1, next: 14, n: 0, line: null };
const LAPSE_LINES = ['You struggle to remain lucid.', 'It slips. You hold on to it.', 'The room swims. Stay with it.'];
function lapses(dt) {
  const k = unsteadyAmount(), view = E.renderer && E.renderer.domElement;
  if (!view) return;
  // a scene can rule the blur out (E.noLapse: the vision, from the jester palace on), and one under way stops at once
  if (E.noLapse) { if (LAPSE.t >= 0) endLapse(); return; }
  if (LAPSE.t < 0) {
    if (k <= 0 || E.paused) return;
    LAPSE.next -= dt; if (LAPSE.next > 0) return;
    LAPSE.t = 0; LAPSE.n++; LAPSE.peak = 2.5 + 3.5 * k;   // px of blur at 720p, scaled to the window below
    // the line only while nothing else is being said or asked, and not every time
    const busy = $('sub').classList.contains('on') || $('choices').style.display === 'flex';
    if (!busy && (LAPSE.n <= 2 || Math.random() < 0.4)) { LAPSE.line = LAPSE_LINES[(LAPSE.n - 1) % LAPSE_LINES.length]; flashSub(LAPSE.line, 'self'); }
    return;
  }
  LAPSE.t += dt;
  // 0.9 s in, 1.4 s held (wavering), 1.5 s out
  const T = LAPSE.t, e = T < 0.9 ? T / 0.9 : T < 2.3 ? 1 - 0.25 * Math.abs(Math.sin((T - 0.9) * 4)) : Math.max(0, 1 - (T - 2.3) / 1.5);
  const px = LAPSE.peak * e * e * (3 - 2 * e) * (innerHeight / 720);
  view.style.filter = px > 0.05 ? 'blur(' + px.toFixed(2) + 'px)' : '';
  if (T > 2.9 && LAPSE.line) { if ($('sub').textContent === t(LAPSE.line)) clearSub(); LAPSE.line = null; }
  if (T >= 3.8) { endLapse(); LAPSE.next = (16 + Math.random() * 18) * (1.4 - 0.6 * k); }
}
function endLapse() { LAPSE.t = -1; LAPSE.line = null; if (E.renderer) E.renderer.domElement.style.filter = ''; }
const fpsEl = document.createElement('div');
fpsEl.style.cssText = 'position:fixed;left:8px;top:6px;font:12px monospace;color:#8f8;z-index:9;display:none;text-shadow:0 0 3px #000';
document.body.appendChild(fpsEl);
// developer mode only: F3 also opens this panel under the frame-rate line, refreshed four times a second (not every frame):
// scene, view, night state, the caption on screen and the sounds playing (A.playing, traced in audio.js while A.trace is on)
const devEl = document.createElement('pre');
devEl.style.cssText = 'position:fixed;left:8px;top:24px;margin:0;width:max-content;max-width:min(440px,52vw);max-height:60vh;overflow:hidden;padding:6px 9px;font:11px/1.4 monospace;color:#cfe8d4;background:#000000b0;border-left:2px solid #8f8;z-index:9;display:none;pointer-events:none;white-space:pre-wrap';
document.body.appendChild(devEl);
let devAt = -1e9;
function devText() {
  const f = (v, n = 2) => (typeof v === 'number' && isFinite(v) ? v.toFixed(n) : v == null ? '-' : String(v));
  const deg = (r) => (typeof r === 'number' ? Math.round(r * 180 / Math.PI) + '°' : '-');
  const cut = (t, n = 64) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  const p = E.camera.position, sub = $('sub'), info = E.renderer.info.render;
  const who = sub.className.replace(/\b(layer|on)\b/g, '').trim();
  const L = [
    'scene    ' + (E.sceneName || '-') + (E.room ? ' > ' + E.room : '') + '   time ' + f(E.time, 1) + ' s   speed x' + E.timeScale + (E.paused ? '   PAUSED' : ''),
    'frame    ' + (1000 / RES.ema).toFixed(0) + ' fps   res ' + Math.round(RES.applied * 100) + '%   ' + info.calls + ' draws   ' + info.triangles + ' tris',
    'camera   x ' + f(p.x) + '   y ' + f(p.y) + '   z ' + f(p.z),
    'view     yaw ' + f(E.yaw) + ' (' + deg(E.yaw) + ')   pitch ' + f(E.pitch) + ' (' + deg(E.pitch) + ')   base ' + deg(E.base.yaw) + ' / ' + deg(E.base.pitch),
    'mode     ' + E.mode + (E.limits ? '   limits yaw ' + f(E.limits.yaw) + ' up ' + f(E.limits.up) + ' down ' + f(E.limits.down) : '   no limits') + '   floor ' + (E.surface || '-'),
    'night    path ' + (G.path || '-') + '   fear ' + f(G.fear) + '   lucidity ' + f(G.lucidity) + '   trust ' + f(G.trust),
    '         dread ' + f(E.dread) + '   panic ' + f(E.panic || 0) + '   heart ' + (E.heart ? 'on' : 'off'),
    'caption  ' + (sub.classList.contains('on') && sub.textContent ? (who ? '[' + who + '] ' : '') + cut(sub.textContent) : '-'),
    'hint     ' + (cut($('hint').textContent) || '-') + ($('prompt').classList.contains('on') ? '   prompt ' + cut($('prompt').textContent, 28) : ''),
  ];
  // a one-shot cue sounding more than once at a time (heartbeats, footsteps) is one row: the newest one's name and age and a
  // count; loops keep a row each (two drones at different pitches are two sounds)
  const snd = A.playing ? A.playing() : [], rows = new Map();
  for (const s of snd) { const id = s.loop ? s.name : s.name.replace(/\(.*$/, ''), r = rows.get(id); if (r) r.n++; else rows.set(id, { ...s, key: s.name + (s.loop ? ' (loop)' : ''), n: 1 }); }
  L.push('sounds   ' + snd.length + ' playing   audio ' + (A.state ? A.state() : '-'));
  const list = [...rows.values()];
  for (const s of list.slice(0, 16)) L.push('  ' + cut(s.key + (s.n > 1 ? ' x' + s.n : ''), 30).padEnd(31) + f(s.age, 1).padStart(6) + ' s' + (s.ending ? '  stopping' : ''));
  if (list.length > 16) L.push('  ... ' + (list.length - 16) + ' more');
  return L.join('\n');
}
E.scene.add(E.camera);
E.camera.rotation.order = 'YXZ';

function resize() {
  E.renderer.setSize(innerWidth, innerHeight, false);
  E.camera.aspect = innerWidth / innerHeight;
  E.camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- input ----------
const SENS = 0.0022;
let dragging = false;
function look(dx, dy) {
  if (E.captureLook) return E.captureLook(dx, dy);
  if (E.mode === 'locked') return;
  E.yaw -= dx; E.pitch -= dy;
  E.lookVel += Math.hypot(dx, dy);
}
E.look = look;
// Browsers occasionally report one huge bogus mouse movement while the pointer is locked, which used to
// snap the view round. Raw input avoids most of them; anything implausibly large is thrown away.
let skipMoves = 0;
export function lockPointer() {
  if (!E.wantLock || document.pointerLockElement === canvas) return;
  try {
    const p = canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => { try { const q = canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch (_) {} });
  } catch (_) {}
}
// Fullscreen (F, or the FULLSCREEN button). Going in or out of fullscreen can drop the pointer lock, which would
// otherwise pause the game, so a lock lost during the switch is ignored and taken back once the switch is done.
let fsSwitching = 0;
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
export function toggleFullscreen() {
  const d = document.documentElement;
  fsSwitching = performance.now();
  try {
    const p = fsEl() ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
      : (d.requestFullscreen || d.webkitRequestFullscreen).call(d, { navigationUI: 'hide' });
    if (p && p.catch) p.catch(() => { fsSwitching = 0; });
  } catch (_) { fsSwitching = 0; }
}
const fsLabel = () => { for (const b of document.querySelectorAll('.fsBtn')) b.textContent = t(fsEl() ? 'WINDOWED' : 'FULLSCREEN'); };
const onFs = () => { fsLabel(); if (inPlay() && !E.paused) lockPointer(); setTimeout(() => { fsSwitching = 0; }, 400); };
document.addEventListener('fullscreenchange', onFs);
document.addEventListener('webkitfullscreenchange', onFs);
document.addEventListener('pointerlockchange', () => {
  skipMoves = 2;
  if (fsSwitching && performance.now() - fsSwitching < 1500) return;
  if (document.pointerLockElement !== canvas && E.wantLock && inPlay() && !E.paused) setPause(true);
});
addEventListener('mousemove', (e) => {
  if (E.paused) return;
  if (skipMoves > 0) { skipMoves--; return; }
  if (Math.abs(e.movementX) > 220 || Math.abs(e.movementY) > 220) return;
  if (document.pointerLockElement === canvas || dragging) look(e.movementX * SENS, e.movementY * SENS);
});

// ---------- pause ----------
const pauseEl = document.createElement('div');
pauseEl.style.cssText = 'position:fixed;inset:0;z-index:5;display:none;align-items:center;justify-content:center;flex-direction:column;background:#04050acc;color:#fff;cursor:pointer;text-align:center';
// ESC or P pauses. Pressing ESC also frees the cursor, and the browser will not take the cursor back on an ESC
// press, so ESC never resumes: ENTER, P, a click or RESUME does. ESC on the pause screen backs out of the
// field notes or the leave question instead.
pauseEl.innerHTML = '<div style="font-size:clamp(26px,5vw,54px);letter-spacing:.35em">PAUSED</div>'
  + '<div id="pauseBtns" style="display:flex;flex-direction:column;gap:12px;margin-top:28px;min-width:240px">'
  + '<button class="btn" style="margin:0" id="pauseResume">RESUME</button><button class="btn" style="margin:0" id="pauseNotes">FIELD NOTES</button><button class="btn fsBtn" style="margin:0" id="pauseFs">FULLSCREEN</button><button class="btn muteBtn" style="margin:0" id="pauseMute">MUTE</button><button class="btn" style="margin:0" id="pauseMenu">MAIN MENU</button></div>'
  + '<div id="pauseAsk" style="display:none;margin-top:28px;font:15px Arial,sans-serif;color:#cfd6e2;line-height:1.7">Leave the night and go back to the main menu?<br><span style="color:#9aa3b2">Unlocked field notes are kept. This night is not.</span>'
  + '<div style="display:flex;gap:12px;justify-content:center;margin-top:18px"><button class="btn" style="margin:0" id="pauseLeave">LEAVE</button><button class="btn" style="margin:0" id="pauseStay">STAY</button></div></div>'
  + '<div id="pauseKeys" style="font:13px Arial,sans-serif;letter-spacing:.1em;color:#9aa3b2;margin-top:24px;line-height:2">P to continue &nbsp;·&nbsp; TAB and ENTER to pick a button &nbsp;·&nbsp; F fullscreen</div>'
  // the full key list (the title screen shows only the essentials)
  + '<div id="pauseCtl" style="font:12px Arial,sans-serif;color:#7d8696;margin-top:10px;max-width:90vw;line-height:1.8">MOUSE look &nbsp;·&nbsp; W A S D walk &nbsp;·&nbsp; SPACE struggle &nbsp;·&nbsp; SHIFT breathe / run &nbsp;·&nbsp; E interact &nbsp;·&nbsp; 1–4 answer &nbsp;·&nbsp; TAB field notes &nbsp;·&nbsp; P or ESC pause &nbsp;·&nbsp; F fullscreen</div>';
document.body.appendChild(pauseEl); translateTree(pauseEl);
const pauseAsk = (on) => { $('pauseAsk').style.display = on ? 'block' : 'none'; $('pauseBtns').style.display = on ? 'none' : 'flex'; };
for (const b of pauseEl.querySelectorAll('button')) b.addEventListener('click', (e) => e.stopPropagation());
$('pauseResume').onclick = () => setPause(false);
$('pauseNotes').onclick = () => toggleNotes(true);
for (const b of document.querySelectorAll('.fsBtn')) b.addEventListener('click', toggleFullscreen);
fsLabel();
// MUTE on the title and pause menus (the developer menu has the same switch; A.setMute fires uap-mute so all agree)
const muteLabel = () => { for (const b of document.querySelectorAll('.muteBtn')) b.textContent = t(A.muted ? 'UNMUTE' : 'MUTE'); };
for (const b of document.querySelectorAll('.muteBtn')) b.addEventListener('click', () => A.setMute(!A.muted));
addEventListener('uap-mute', muteLabel); muteLabel();
$('pauseMenu').onclick = () => pauseAsk(true);
$('pauseStay').onclick = () => pauseAsk(false);
$('pauseLeave').onclick = () => { E.paused = true; location.reload(); };   // a clean title screen; notes live in localStorage
const inPlay = () => $('title').style.display === 'none' && $('endcard').style.display !== 'block';
// Forget every held key, button, drag and touch. The page never hears a key released while it is paused or in the
// background, so anything still held then would stay held: W walking on by itself, an arrow turning, SHIFT breathing.
export function releaseInput() {
  for (const k in E.keys) E.keys[k] = false;
  E.just.clear(); dragging = false; E.steady = false;
  dispatchEvent(new Event('uap-release'));   // touch.js resets its stick, buttons and look touches
}
export function setPause(on, quiet = false) {
  if (on && !inPlay()) return;
  E.paused = on; E.quietPause = on && quiet;
  pauseEl.style.display = on && !quiet ? 'flex' : 'none'; pauseAsk(false);
  if (on) { A.suspend(); releaseInput(); if (document.pointerLockElement) document.exitPointerLock(); }
  else { A.resume(); toggleNotes(false); E.just.clear(); lockPointer(); }
}
pauseEl.addEventListener('click', () => setPause(false));
document.addEventListener('visibilitychange', () => { if (!document.hidden) { RES.wake = true; return; } if (E.manual) return; releaseInput(); if (inPlay() && !E.paused) setPause(true); });

// ---------- menus and keyboard focus ----------
// Whichever panel is on top owns the keyboard: TAB / SHIFT+TAB move round its buttons (and never leave it), ENTER
// or SPACE press the focused one. A panel takes focus when it opens and gives it back to the button you left when it
// closes (notes over the pause menu return to FIELD NOTES). In play nothing is focused, so SPACE stays the game's.
const PANELS = () => [$('credits'), $('notes'), pauseEl, $('endcard'), $('title')];   // top first
const openPanel = () => PANELS().find((el) => getComputedStyle(el).display !== 'none') || null;
const buttonsIn = (el) => [...el.querySelectorAll('button')].filter((b) => !b.disabled && b.getClientRects().length);
const lastFocus = new Map();
addEventListener('focusin', (e) => { const p = PANELS().find((el) => el.contains(e.target)); if (p) lastFocus.set(p, e.target); });
function syncFocus() {
  const top = openPanel(), a = document.activeElement;
  const under = a && PANELS().find((p) => p !== top && p.contains(a));   // a panel just covered: remember its button
  if (under) lastFocus.set(under, a);
  for (const p of PANELS()) if (p !== top && getComputedStyle(p).display === 'none') lastFocus.delete(p);
  if (!top) { if (a && a !== document.body && a.blur) a.blur(); return; }
  if (a && top.contains(a) && a.getClientRects().length) return;
  const keep = lastFocus.get(top), to = keep && keep.getClientRects().length ? keep : buttonsIn(top)[0];
  if (to) to.focus({ preventScroll: true });
}
const focusWatch = new MutationObserver(syncFocus);
for (const p of PANELS()) focusWatch.observe(p, { attributes: true, attributeFilter: ['style'], subtree: true });
syncFocus();
function tabIn(panel, back) {
  const bs = buttonsIn(panel); if (!bs.length) return;
  const n = bs.length, i = bs.indexOf(document.activeElement);
  bs[i < 0 ? (back ? n - 1 : 0) : (i + (back ? -1 : 1) + n) % n].focus({ preventScroll: true });
}
addEventListener('blur', () => { if (!E.manual) releaseInput(); });   // switched to another window: keys let go there never reach the page
canvas.addEventListener('mousedown', () => {
  dragging = true;
  lockPointer();
});
addEventListener('mouseup', () => { dragging = false; });
const keyWaiters = [];
addEventListener('keydown', (e) => {
  const menu = openPanel();
  // in play these keys are the game's; on a menu SPACE and the arrows are left to the browser (press a button, scroll the notes)
  if (e.code === 'Tab' || (!menu && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code))) e.preventDefault();
  if (e.repeat) return;
  E.keys[e.code] = true;
  E.just.add(e.code);
  for (const w of keyWaiters.splice(0)) { if (w.codes.includes(e.code)) w.res(e.code); else keyWaiters.push(w); }
  if (e.code === 'Tab') {
    if (!menu && inPlay()) { if (!E.paused) setPause(true); toggleNotes(true); }   // in play: TAB opens the field notes
    else if (menu === $('notes')) toggleNotes(false);                               // and closes them again
    else if (menu) tabIn(menu, e.shiftKey);
  }
  const notesOpen = $('notes').style.display === 'block';
  const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
  if (e.code === 'KeyP' && inPlay()) setPause(!E.paused);
  if (e.code === 'Escape') {
    if ($('credits').style.display === 'block') $('credits').style.display = 'none';
    else if (notesOpen) toggleNotes(false);
    else if (E.paused && !E.quietPause && $('pauseAsk').style.display === 'block') pauseAsk(false);
    else if (inPlay() && !E.paused) setPause(true);
  }
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !onButton && E.paused && !E.quietPause && inPlay() && !notesOpen) {
    if ($('pauseAsk').style.display === 'block') pauseAsk(false); else setPause(false);
  }
  if (e.code === 'KeyF' && !e.ctrlKey && !e.altKey && !e.metaKey) toggleFullscreen();
  if (e.code === 'F3') { e.preventDefault(); fpsEl.style.display = fpsEl.style.display === 'none' ? 'block' : 'none'; devEl.style.display = DEV && fpsEl.style.display === 'block' ? 'block' : 'none'; devAt = -1e9; }
});
addEventListener('keyup', (e) => { E.keys[e.code] = false; });
export const key = (...codes) => new Promise((res) => keyWaiters.push({ codes, res }));

// ---------- loop ----------
let last = performance.now() / 1000;
let smoothVel = 0;
function frame(ms) {
  const now = ms / 1000;
  if (E.paused) { last = now; return; }
  const rawMs = (now - last) * 1000;
  // A single long frame is a hitch (a scene loading, shaders compiling) and the first frame back from a hidden tab
  // is just the time away, so neither counts. A run of three or more long frames is a slow machine and does count,
  // capped at 1 s a frame, so the resolution still steps down where it is needed most.
  const away = RES.wake || document.hidden; RES.wake = false;
  RES.long = rawMs >= 250 && !away ? (RES.long || 0) + 1 : 0;
  if (!away && (rawMs < 250 || RES.long >= 3)) {
    const fMs = Math.min(rawMs, 1000);
    RES.ema += (fMs - RES.ema) * 0.05; RES.timer += fMs;
    if (RES.timer > 1000) {
      RES.timer = 0;
      const fps = 1000 / RES.ema;
      const before = RES.cur;
      RES.slow = fps < 45 ? (RES.slow || 0) + 1 : 0;
      if (RES.slow >= 2 && RES.cur > RES.min) { RES.cur = Math.max(RES.min, RES.cur - 0.15); RES.good = 0; RES.slow = 0; }
      else if (fps > 57 && RES.cur < RES.max) { if (++RES.good >= 4) { RES.cur = Math.min(RES.max, RES.cur + 0.1); RES.good = 0; } }
      else RES.good = 0;
      if (RES.cur !== before) { try { localStorage.setItem('uap-res', RES.cur.toFixed(2)); } catch (_) {} }
      if (fpsEl.style.display !== 'none') fpsEl.textContent = fps.toFixed(0) + ' fps  ·  resolution ' + Math.round(RES.applied * 100) + '%  ·  ' + E.renderer.info.render.calls + ' draws  ·  ' + E.renderer.info.render.triangles + ' tris';
    }
    applyRes();
  }
  if (devEl.style.display !== 'none' && ms - devAt >= 250) { devAt = ms; devEl.textContent = devText(); }
  A.speed = E.timeScale;
  let dt = Math.min(0.05, Math.max(0, now - last)) * E.timeScale;
  last = now;
  E.time += dt;

  // arrow keys turn the head too
  const ar = 1.4 * dt / E.timeScale;
  const ax = (E.keys.ArrowRight ? 1 : 0) - (E.keys.ArrowLeft ? 1 : 0);
  const ay = (E.keys.ArrowDown ? 1 : 0) - (E.keys.ArrowUp ? 1 : 0);
  if (ax || ay) look(ax * ar, ay * ar);
  smoothVel += (E.lookVel / Math.max(dt, 1e-4) - smoothVel) * Math.min(1, dt * 6);
  E.lookSpeed = smoothVel; E.lookVel = 0;

  for (const f of [...E.updaters]) f(dt, E.time);
  for (const f of [...E.sys]) f(dt, E.time);

  if (E.mode !== 'locked') {
    const pk = E.steady && E.gazeAt ? 0.3 : 1;
    E.yaw += E.pull.yaw * dt * pk; E.pitch += E.pull.pitch * dt * pk;
    if (E.steady && E.gazeAt) {
      const a = aimAt(E.gazeAt), k = Math.min(1, dt * 1.6);
      E.yaw += (Math.atan2(Math.sin(a.yaw - E.yaw), Math.cos(a.yaw - E.yaw))) * k; E.pitch += (a.pitch - E.pitch) * k;
    }
  }
  if (E.mode === 'walk') {
    const f = (E.keys.KeyW ? 1 : 0) - (E.keys.KeyS ? 1 : 0), s = (E.keys.KeyD ? 1 : 0) - (E.keys.KeyA ? 1 : 0);
    if (f || s) {
      E.running = f > 0 && !!(E.keys.ShiftLeft || E.keys.ShiftRight);   // Shift runs (forward only)
      const sp = 2.3 * (E.running ? 1.8 : 1) * dt / Math.hypot(f, s);
      const dx = (-Math.sin(E.yaw) * f + Math.cos(E.yaw) * s) * sp, dz = (-Math.cos(E.yaw) * f - Math.sin(E.yaw) * s) * sp;
      const p = E.camera.position;
      if (!E.bounds || E.bounds(p.x + dx, p.z)) p.x += dx;
      if (!E.bounds || E.bounds(p.x, p.z + dz)) p.z += dz;
    }
  }
  // footsteps and the head's rise and fall: on foot whenever the player walks (walk mode) or a scripted move is marked as a
  // walk (moveView(dur, { pos, walk: stride metres })). One footfall per stride; E.surface names the floor (A.step).
  {
    const p = E.camera.position; let d = Math.hypot(p.x - FOOT.x, p.z - FOOT.z); FOOT.x = p.x; FOOT.z = p.z;
    if (d > 0.5) d = 0;   // a cut, not a step
    const onFoot = (E.mode === 'walk' || E.stride > 0) && d > 0.0003;
    if (onFoot) {
      const stride = E.stride > 0 ? E.stride : E.running ? 1.25 : 0.85;
      if (FOOT.amt < 0.05) FOOT.ph = Math.PI * (Math.floor(FOOT.ph / Math.PI) + 1) - 0.3 * Math.PI;   // from standing, the first foot lands soon
      const n0 = Math.floor(FOOT.ph / Math.PI); FOOT.ph += d / stride * Math.PI;
      if (Math.floor(FOOT.ph / Math.PI) !== n0 && E.surface !== 'none' && A.step) {
        FOOT.side = -FOOT.side;
        A.step(E.surface || 'ship', Math.min(1, 0.4 + (dt > 0 ? d / dt : 0) * 0.28) * (E.stride > 0 ? 0.8 : 1), FOOT.side);
      }
    }
    FOOT.amt += ((onFoot ? 1 : 0) - FOOT.amt) * Math.min(1, dt * (onFoot ? 5 : 3));
    const slow = E.stride > 0 && E.stride < 0.75 ? 1.35 : E.running && E.mode === 'walk' ? 1.6 : 1;   // a slow, deliberate walk sinks further into each step
    FOOT.y = FOOT.amt * (Math.abs(Math.sin(FOOT.ph)) - 0.62) * 0.04 * slow;
    FOOT.r = FOOT.amt * Math.sin(FOOT.ph) * 0.0075 * slow;
  }
  if (E.limits) {
    E.yaw = THREE.MathUtils.clamp(E.yaw, E.base.yaw - E.limits.yaw, E.base.yaw + E.limits.yaw);
    E.pitch = THREE.MathUtils.clamp(E.pitch, E.base.pitch - E.limits.down, E.base.pitch + E.limits.up);
  }
  E.pitch = THREE.MathUtils.clamp(E.pitch, -1.5, 1.5);
  const sh = E.shake + Math.max(0, G.fear - 0.5) * 0.004;   // fear only jitters the view when it is high; a scene sets E.shake for anything stronger
  E.camera.rotation.set(E.pitch + (Math.random() - 0.5) * sh, E.yaw + (Math.random() - 0.5) * sh, E.roll + FOOT.r);

  E.camera.position.y += FOOT.y;   // the step's rise and fall is drawn but never seen by scene code
  watchDetails(dt); lapses(dt);
  // E.draw: a scene's own full-screen pass (the reveal's memories) draws the frame instead; clearScene removes it
  if (!E.noRender) { if (E.draw) E.draw(); else E.renderer.render(E.scene, E.camera); }
  E.camera.position.y -= FOOT.y;   // a test harness may step frames without drawing them
  if (staleMats.size && ++staleFrames >= STALE_FRAMES) flushMaterials();
  E.just.clear();
}
// E.step lets a test harness drive frames when the tab is hidden and requestAnimationFrame is paused.
// developer mode: ?dev=1 in the address, or switched on with F2 (remembered in this browser until switched off)
let devStored = false; try { devStored = localStorage.getItem('uap-dev') === '1'; } catch (_) {}
export const DEV = new URLSearchParams(location.search).get('dev') === '1' || devStored;
if (DEV) { E.step = frame; A.trace = true; }   // A.trace: audio.js keeps the list of sounds playing for the F3 panel
function loop(ms) { if (!(DEV && E.manual)) frame(ms); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

// fear vignette and heartbeat
let beat = 0, lastVig = '';
E.sys.add((dt) => {
  G.fear = THREE.MathUtils.clamp(G.fear, 0, 1);
  G.lucidity = THREE.MathUtils.clamp(G.lucidity, 0, 1);
  const vg = (G.fear * 0.85).toFixed(2);
  if (vg !== lastVig) { lastVig = vg; $('vig').style.opacity = vg; }
  if (E.heart) {
    beat -= dt / (E.timeScale || 1);   // real seconds: at a developer speed-up the heart keeps a human pace (at 8x it beat 30 times a second)
    if (beat <= 0) {
      E.panic = Math.max(0, (E.panic || 0) - 0.06);          // struggling pushes the heart past anything fear alone does, then it eases
      E.dread = THREE.MathUtils.clamp(E.dread || 0, 0, 1);
      beat = Math.max(0.27, 1.12 - G.fear * 0.72 - E.panic * 0.16 - E.dread * 0.38); // about 54 bpm calm, 150 terrified, over 200 while fighting; full dread adds ~+45 bpm (about 165 at the jester hall's worst)
      A.heartbeat(Math.min(1, G.fear + E.dread * 0.35));   // and beats harder
    }
  }
});

// ---------- timing ----------
export const on = (f) => { E.updaters.add(f); return () => E.updaters.delete(f); };
export const wait = (s) => new Promise((res) => {
  const end = E.time + s;
  const f = () => { if (E.time >= end) { E.updaters.delete(f); res(); } };
  E.updaters.add(f);
});
export const until = (pred, timeout = Infinity) => new Promise((res) => {
  const end = E.time + timeout;
  const f = () => { const v = pred(); if (v || E.time >= end) { E.updaters.delete(f); res(v); } };
  E.updaters.add(f);
});
export const ease = (k) => k * k * (3 - 2 * k);
export const tween = (dur, fn, ez = ease) => new Promise((res) => {
  const t0 = E.time;
  const f = () => {
    const k = Math.min(1, (E.time - t0) / dur);
    fn(ez(k));
    if (k >= 1) { E.updaters.delete(f); res(); }
  };
  E.updaters.add(f);
});
export const lerp = (a, b, k) => a + (b - a) * k;

// ---------- camera helpers ----------
export function setView(x, y, z, yaw, pitch) {
  E.camera.position.set(x, y, z);
  E.yaw = E.base.yaw = yaw; E.pitch = E.base.pitch = pitch; E.roll = 0;
}
const FOOT = { x: 0, z: 0, ph: 0, amt: 0, side: 1, y: 0, r: 0 };
// to.walk (stride in metres, or true) makes a position move a walk: footsteps and the head's rise and fall
export function moveView(dur, to) {
  const p0 = E.camera.position.clone(), y0 = E.yaw, pi0 = E.pitch;
  if (to.walk && to.pos) { E.stride = to.walk === true ? 0.75 : to.walk; }
  return tween(dur, (k) => {
    if (k >= 1 && to.walk && E.stride) {   // the trailing foot comes alongside as you stop
      E.stride = 0; FOOT.side = -FOOT.side; if (A.step && E.surface !== 'none') A.step(E.surface || 'ship', 0.3, FOOT.side);
    }
    if (to.pos) E.camera.position.lerpVectors(p0, to.pos, k);
    if (to.yaw !== undefined) E.yaw = lerp(y0, to.yaw, k);
    if (to.pitch !== undefined) E.pitch = lerp(pi0, to.pitch, k);
  });
}
const _f = new THREE.Vector3(), _d = new THREE.Vector3();
export function forward() { return E.camera.getWorldDirection(_f); }
export function angleTo(target) {
  _d.copy(target).sub(E.camera.position).normalize();
  return forward().angleTo(_d);
}
export const lookingAt = (target, tol = 0.2) => angleTo(target) < tol;
// turn the view to a point over dur seconds (a promise)
export const lookToward = (target, dur = 1) => moveView(dur, aimAt(target));
// yaw/pitch that would aim the camera at a point
export function aimAt(target) {
  _d.copy(target).sub(E.camera.position).normalize();
  return { yaw: Math.atan2(-_d.x, -_d.z), pitch: Math.asin(_d.y) };
}

// Freeing a finished scene's GPU resources. Anything marked userData.keep is a shared cache (models.js G/Mt/ctex,
// ship.js earth and glow textures, fx.js plane/sky) and stays. Everything else the scene made is its own and goes:
// geometries, textures, skeletons (their bone textures) and instanced buffers at once, materials a little later.
// Materials wait STALE_FRAMES rendered frames so the next scene has compiled first: a shader program is released only
// when no material uses it, so the next scene's look-alike materials keep it alive and nothing recompiles. The vision
// shaders are also pinned for good by fx.js prewarm(), which never disposes its warm-up materials.
const keep = (r) => r && r.userData && r.userData.keep;
const STALE_FRAMES = 60;
const staleMats = new Set(), orphans = new Set();
let staleFrames = 0;
// a scene removing something for good mid-scene: use discard(obj) instead of parent.remove(obj), so it is freed at the next clearScene
// Compile the shaders and upload the textures of objects that are already in the scene but hidden, so they cost nothing
// when they appear later (a first render compiles and uploads on the spot, which froze the game for about a second).
// Call it at a quiet moment, ideally while the screen is black.
export function warm(...objs) {
  const vis = [];
  for (const o of objs) o.traverse((x) => { vis.push([x, x.visible]); x.visible = true; });
  try {
    E.renderer.compile(E.scene, E.camera);
    const seen = new Set();
    for (const o of objs) o.traverse((x) => {
      for (const m of [].concat(x.material || [])) for (const k in m) { const t = m[k]; if (t && t.isTexture && !seen.has(t)) { seen.add(t); E.renderer.initTexture(t); } }
    });
  } catch (e) { console.warn('warm failed', e); }
  for (const [x, v] of vis) x.visible = v;
}
export function discard(obj) { if (!obj) return; if (obj.parent) obj.parent.remove(obj); orphans.add(obj); }
function collect(root, seen) {
  root.traverse((o) => {
    if (o.geometry && !keep(o.geometry)) seen.add(o.geometry);
    if (o.isSkinnedMesh && o.skeleton) seen.add(o.skeleton);
    if (o.isInstancedMesh) seen.add(o);
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k in m) { const v = m[k]; if (v && v.isTexture && !keep(v)) seen.add(v); }
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture && !keep(u.value)) seen.add(u.value);
      if (!(m.userData && m.userData.keep === m.uuid)) staleMats.add(m);   // models.js marks cached materials with their own uuid; clones of them are the scene's
    }
  });
}
function flushMaterials() { for (const m of staleMats) m.dispose(); staleMats.clear(); staleFrames = 0; }
// frees everything under root now, materials included (each resource once)
export function disposeTree(root) {
  const seen = new Set(); collect(root, seen);
  for (const r of seen) r.dispose();
  flushMaterials();
}
export function clearScene() {
  const seen = new Set();
  // E.carry: { objs: [...] } a scene hands to the next one (scene or camera children left in place, once); the next scene
  // takes it and sets E.carry = null. If it is not taken, the following clear disposes it as usual.
  const carry = E.carry && !E.carry.passed ? E.carry.objs : [];
  if (E.carry) { if (E.carry.passed) E.carry = null; else E.carry.passed = true; }
  for (const c of [...E.scene.children]) if (c !== E.camera && !carry.includes(c)) { E.scene.remove(c); collect(c, seen); }
  for (const c of [...E.camera.children]) if (!carry.includes(c)) { E.camera.remove(c); collect(c, seen); }
  for (const o of orphans) collect(o, seen);
  orphans.clear();
  for (const r of seen) r.dispose();   // one Set per pass: shared buffers are disposed once
  staleFrames = 0;
  A.stopAll(0.3); clearSub(); $('choices').style.display = 'none'; bar(null); E.gazeAt = null; E.steady = false;
  // scene-only presentation left behind when a scene is abandoned mid-way (a developer jump)
  $('how').classList.remove('on'); E.breathing = false; E.nudge = null;
  for (const id of ['gaze', 'gazeDot', 'gazeLine']) $(id).style.display = 'none';
  $('bar').firstChild.style.background = ''; document.body.classList.remove('legible');
  E.updaters.clear();
  E.scene.fog = null; E.scene.background = new THREE.Color(0);
  E.limits = null; E.mode = 'locked'; E.bounds = null; E.captureLook = null; E.stride = 0; E.surface = 'ship'; E.dread = 0; E.canAct = false;
  E.pull.yaw = E.pull.pitch = 0; E.roll = 0; E.shake = 0; E.unsteady = false; E.noLapse = false; endWarp(); E.details.length = 0; endLapse(); LAPSE.next = 14; WARP.next = 6;
  E.camera.fov = 70; E.camera.updateProjectionMatrix();
  if (E.draw) { if (E.draw.dispose) E.draw.dispose(); E.draw = null; }   // a scene's own full-screen pass and its render target
  hint(''); prompt('');
}

// ---------- on-screen text ----------
let subToken = 0;
const quote = (text, who) => (who === 'self' || !text || /^[“"‘'(«„]/.test(text) ? text : QUOTES[0] + text + QUOTES[1]);
export async function say(text, who = 'self', dur) {
  text = t(text); const el = $('sub'), my = ++subToken;
  // a line still showing fades out first (the #sub transition, 0.35 s) instead of being swapped in place; game time, so
  // fast speeds and stepped test runs never lose a line to the fade
  if (el.classList.contains('on') && el.textContent) {
    el.classList.remove('on'); await wait(0.32);
    if (my !== subToken) { await wait(dur || 1.7 + text.length * 0.05); return; }   // replaced meanwhile: keep the caller's timing
  }
  el.className = 'layer ' + who; el.textContent = quote(text, who);
  requestAnimationFrame(() => el.classList.add('on'));
  await wait(dur || 1.7 + text.length * 0.05);
  if (my === subToken) { el.classList.remove('on'); await wait(0.4); }
}
export function flashSub(text, who = 'them') { const el = $('sub'); subToken++; el.className = 'layer on ' + who; el.textContent = t(text); }
export function clearSub() { subToken++; $('sub').classList.remove('on'); }
export function prompt(text) { text = t(text); const el = $('prompt'); el.textContent = text; el.classList.toggle('on', !!text); }
let lastHint = null;
// on a phone every hint is reworded for touch (most specific first). A new keyboard hint needs a line here.
const TOUCH_WORDS = [
  [/^E — /, 'ACT — '],
  ['W A S D to walk, SHIFT to run', 'Left stick to walk, push it to the edge to run'],
  ['W A S D to walk', 'Left stick to walk'],
  ['Move the mouse to turn the sky', 'Drag across the screen to turn the sky'],
  ['Move the mouse left and right (or A and D)', 'Drag left and right'],
  ['Move the mouse to turn your head', 'Drag to turn your head'],
  ['Hold A or D, or drag sideways', 'Drag sideways'],
  ["Hold their gaze. Your eyes will try to slide away.", "Hold their gaze: drag back to their eyes when they slide away, or hold FOCUS."],
  ["Keep your eyes on it and follow it slowly. Don't grab at it.", "Keep your eyes on it: drag slowly after it, or hold FOCUS. Don't grab at it."],
  ['Look where the laser points, and hold your eyes there.', 'Drag to where the laser points, or hold FOCUS.'],
  ['Hold the light on him to lift him. It will try to slide away.', 'Drag to keep the light on him, or hold FOCUS.'],
  ['Move the mouse', 'Drag'],
  ['SPACE to struggle', 'STRUGGLE to fight'],
  ['hold SHIFT as the hum swells, let go as it fades', 'hold BREATHE as the hum swells, let go as it fades'],
];
const touchWords = (t) => TOUCH_WORDS.reduce((s, [a, b]) => s.replace(a, b), t);
export function hint(text) { if (E.touch && text) text = touchWords(text); text = t(text); if (text === lastHint && $('hint').textContent === text) return; lastHint = text; $('hint').textContent = text; }
export function bar(v) { $('bar').style.opacity = v == null ? 0 : 1; if (v != null) $('bar').firstChild.style.width = (Math.max(0, Math.min(1, v)) * 100) + '%'; }
// A ring on screen round something the player must keep looking at (#gaze): it fills with p (0..1) and brightens while
// aimed; a dot marks the middle of the view (#gazeDot) and a faint line runs from it to the ring whenever the eyes are off
// it (#gazeLine). r is the ring's radius in pixels, or a world radius at the target when given as { world: m }.
// Call every frame with the target's world position; gazeRing(null) hides all three.
const gzV = new THREE.Vector3();
export function gazeRing(pos, { p = 0, aimed = false, snapped = false, col = '#ffe9b0', r = 60, min = 26, max = 160 } = {}) {
  const gz = $('gaze'), dot = $('gazeDot'), line = $('gazeLine');
  if (!pos) { gz.style.display = dot.style.display = line.style.display = 'none'; return; }
  gzV.copy(pos).project(E.camera);
  const W = innerWidth, H = innerHeight, x = (gzV.x + 1) / 2 * W, y = (1 - gzV.y) / 2 * H, behind = gzV.z > 1;
  if (typeof r === 'object') r = r.world / E.camera.position.distanceTo(pos) / Math.tan(E.camera.fov * Math.PI / 360) * H / 2;
  r = Math.max(min, Math.min(max, r));
  dot.style.display = 'block'; gz.style.display = behind ? 'none' : 'block';
  gz.style.width = gz.style.height = (2 * r).toFixed(0) + 'px'; gz.style.transform = `translate(${(x - r).toFixed(1)}px, ${(y - r).toFixed(1)}px)`;
  gz.style.setProperty('--p', (Math.min(1, Math.max(0, p)) * 100).toFixed(1) + '%'); gz.style.setProperty('--c', col);
  gz.classList.toggle('on', aimed); gz.classList.toggle('snap', snapped);
  const dx = x - W / 2, dy = y - H / 2, len = Math.hypot(dx, dy) - r - 6;
  line.style.display = !aimed && !behind && len > 12 ? 'block' : 'none';
  line.style.width = Math.max(0, len).toFixed(0) + 'px'; line.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
}
export function fade(to, dur = 1, color = '#000') {
  const el = $('fade'); el.style.background = color;
  const from = Number(el.style.opacity || getComputedStyle(el).opacity);
  return tween(dur, (k) => { el.style.opacity = lerp(from, to, k); }, (k) => k);
}
export function flash(color = '#fff', dur = 0.6) { const el = $('fade'); el.style.background = color; el.style.opacity = 1; return fade(0, dur, color); }

export function choose(options) {
  return new Promise((res) => {
    const box = $('choices'); box.innerHTML = ''; box.style.display = 'flex';
    const done = (i) => { box.style.display = 'none'; off(); res(i); };
    options.forEach((o, i) => {
      const b = document.createElement('button');
      const n = document.createElement('span'); n.textContent = i + 1; b.append(n, t(o));
      b.onclick = () => done(i);
      box.appendChild(b);
    });
    const off = on(() => { for (let i = 0; i < options.length; i++) if (E.just.has('Digit' + (i + 1)) || E.just.has('Numpad' + (i + 1))) return done(i); });
  });
}

// ---------- field notes ----------
let unlocked = {};
try { unlocked = JSON.parse(localStorage.getItem('uap-notes') || '{}'); } catch (_) {}
if (!unlocked || typeof unlocked !== 'object' || Array.isArray(unlocked)) unlocked = {};
// every new build starts with no field notes and every setting cleared: js/reset.js (runs before this module)
// developer menu: show every note without unlocking it
let allNotes = false; try { allNotes = localStorage.getItem('uap-allnotes') === '1'; } catch (_) {}
export const notesAll = () => allNotes;
export function setNotesAll(v) { allNotes = !!v; try { localStorage.setItem('uap-allnotes', allNotes ? '1' : '0'); } catch (_) {} }
export function resetNotes() { unlocked = {}; try { localStorage.removeItem('uap-notes'); } catch (_) {} }
export function note(id) {
  if (!NOTES[id] || unlocked[id]) return;
  unlocked[id] = 1;
  try { localStorage.setItem('uap-notes', JSON.stringify(unlocked)); } catch (_) {}
  const tEl = $('toast'); tEl.textContent = t('Field note:') + ' ' + t(NOTES[id].title); tEl.classList.add('on');
  clearTimeout(note.timer); note.timer = setTimeout(() => tEl.classList.remove('on'), 3200);
}
export const noteCount = () => `${allNotes ? Object.keys(NOTES).length : Object.keys(unlocked).filter((k) => NOTES[k]).length} / ${Object.keys(NOTES).length}`;
// the evidence tag shown on a field note: 'single' is one report (SINGLE read as "unique" or "unmarried")
const TAG_LABEL = { single: 'ONE ACCOUNT' };
export function toggleNotes(force) {
  const el = $('notes'), show = force !== undefined ? force : el.style.display !== 'block';
  if (show) {
    $('notesList').innerHTML = Object.entries(NOTES).map(([id, n]) => (unlocked[id] || allNotes)
      ? `<div class="n"><b>${t(n.title)}</b><em class="t-${n.tag}">${t(TAG_LABEL[n.tag] || n.tag.toUpperCase())}</em><p>${t(n.text)}</p><i>${t(n.src)}</i></div>`
      : `<div class="n lock">${t('Not yet witnessed')}</div>`).join('');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  el.style.display = show ? 'block' : 'none';
}

// memory across nights (how many times the player has fought)
export function nights(key, add = 0) {
  let v = 0;
  try { v = Number(localStorage.getItem('uap-' + key) || 0) + add; if (add) localStorage.setItem('uap-' + key, v); } catch (_) {}
  return v;
}
