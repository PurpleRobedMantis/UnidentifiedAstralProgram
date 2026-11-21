// Developer menu: only exists in developer mode (press F2 once on any screen, or open the page with ?dev=1).
// ` (the key under Esc) or F2 opens it. [ and ] halve and double the speed, \ puts it back to normal.
import { E, G, setPause, notesAll, setNotesAll, resetNotes } from './engine.js';
import { A } from './audio.js';

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];
const JUMPS = [
  ['Night', [
    ['Bedroom (start)', 'bedroom'],
    ['Exam room', 'exam', { path: 'calm' }],
  ]],
  ['Ship', [
    ['Crossroads, doors shut', 'hub', { path: 'calm' }],
    ['Crossroads, doors open', 'hub', { path: 'calm', asked: true }],
    ['Crossroads, ready to leave', 'hub', { path: 'calm', asked: true, seen: 4 }],
    ['Classroom', 'room:class', { asked: true }],
    ['Window', 'room:window', { asked: true }],
    ['Containers', 'room:containers', { asked: true }],
    ['Still room', 'room:viewing', { asked: true }],
  ]],
  ['Control room', [
    ['Control room (loom, weather, link)', 'control', { path: 'calm', asked: true, seen: 4 }],
    ['The field (ride-along)', 'field', { path: 'calm', asked: true, seen: 4 }],
    ['Back in the control room', 'aftermath', { path: 'calm', asked: true, seen: 4 }],
    ['The reveal (took the toy)', 'reveal', { path: 'calm', asked: true, seen: 4, toy: true }],
  ]],
  ['Vision', [
    ['Jester palace to council', 'mandala', { path: 'calm', seen: 4 }],
    ['Mandala (the flower, doors, mantis)', 'mandala', { path: 'calm', seen: 4, flower: true }],
    ['Council (the dark and the orbs)', 'mandala', { path: 'calm', seen: 4, council: true }],
  ]],
  ['Endings', [
    ['Missing Time', 'end:missing', { path: 'fight' }],
    ['Communion', 'end:communion'],
    ['The Wardens', 'end:wardens'],
    ['Hang Up the Phone', 'end:phone'],
    ['Scepticism', 'end:sceptic'],
  ]],
];

// the sound list: [label, () => play it] by where it is heard. The bedroom portal also plays each layer alone, including
// the tear that build 115 removed, so each can be heard on its own.
const SOUNDS = [
  ['BEDROOM PORTAL OPENING', [
    ['Portal, as it is now', () => A.portal(2.6)],
    ['Portal with the wall creaks put back (as build 114)', () => A.portal(2.6, { creaks: true })],
    ['Layer: growl', () => A.portal(2.6, { only: 'growl' })],
    ['Layer: wall creaks (removed in 117)', () => A.portal(2.6, { only: 'creaks' })],
    ['Layer: window rattle', () => A.portal(2.6, { only: 'rattle' })],
    ['Layer: air rushing to the wall', () => A.portal(2.6, { only: 'air' })],
    ['Layer: electrics buzzing', () => A.portal(2.6, { only: 'electrics' })],
    ['Layer: the tear', () => A.portal(2.6, { only: 'tear' })],
    ['Layer: slam when fully open', () => A.portal(2.6, { only: 'slam' })],
    ['Layer: roar after it opens', () => A.portal(2.6, { only: 'roar' })],
    ['Rising hum under it', () => A.rise(62, 0.05, 5, { type: 'sawtooth' })],
  ]],
  ['BEDROOM', [
    ['Two greys come through', () => A.greysIn(2.56, 6)],
    ['Mantis comes through', () => A.mantisIn(3.2, 1.6)],
    ['Carrier wave (ringing tone)', () => A.carrier(85, 0.07, 20, { to: 130 })],
    ['Vibration drone', () => A.drone(38, { type: 'sawtooth', g: 0.13, fade: 0.05 })],
    ['Dog barking', () => A.bark()],
    ['Heartbeat, calm', () => A.heartbeat(0.2)],
    ['Heartbeat, afraid', () => A.heartbeat(0.9)],
    ['Breath in', () => A.breath(true, 1.4, 0.8)],
    ['Breath out', () => A.breath(false, 1.8, 0.8)],
    ['Covers (sitting up)', () => A.rustle(1.2, 0.9)],
    ['Covers pulled, landing', () => A.rustle(1.2, 0.9, { flop: true })],
    ['Croak (voice comes back)', () => A.croak()],
    ['Wand zap', () => A.zap()],
    ['Clicks', () => A.clicks(6)],
  ]],
  ['EXAM ROOM', [
    ['Scanner locks on', () => A.scanLock()],
    ['Stare: the sky opens', () => A.vast()],
    ['Low drone', () => A.drone(98, { g: 0.05 })],
  ]],
  ['SHIP', [
    ['Classroom sky settles', () => A.settle()],
    ['Orb, stage 1', () => A.bloom(1)],
    ['Orb, stage 2', () => A.bloom(2)],
    ['Orb released', () => A.release()],
    ['Child speaks in your head', () => A.inner()],
    ['Gift hum', () => A.aura(293.66)],
    ['Shimmer', () => A.shimmer(659.3, 2.2, 0.02)],
    ['Window film: detonation', () => A.blast(1)],
    ['Binaural tones (still room)', () => A.binaural(180, 4)],
    ['Crinkle', () => A.crinkle()],
    ['Honk', () => A.honk()],
  ]],
  ['VISION', [
    ['Whisper', () => A.whisper(undefined, 1.6)],
    ['Murmur', () => A.murmur(undefined, 1.2)],
    ['Cackle', () => A.cackle(undefined, 0.75)],
    ['Mocking laugh', () => A.mock(undefined, 0.85)],
  ]],
  ['CONTROL ROOM', [
    ['The hall at work (loop)', () => A.ctrlRoom(1)],
    ['Bead: they drive home (loop)', () => A.beadWorld('home', 1)],
    ['Bead: nothing comes (loop)', () => A.beadWorld('cold', 1)],
    ['Bead: rain (loop)', () => A.beadWorld('rain', 1)],
    ['Bead: fog, the golden one (loop)', () => A.beadWorld('gold', 1)],
    ['Loom: a thread let go', () => { for (let i = 0; i < 4; i++) setTimeout(() => A.loomPluck(i * 2), i * 700); }],
    ['Loom: the thread drawn tight, gold', () => A.loomTie()],
    ['Loom: a thread fraying', () => A.loomFray(2)],
    ['Bead falls into the basin', () => A.basinDrop()],
    ['Weather table: a pad pressed', () => A.padPress(0)],
    ['Weather table: the dome rolled', () => A.domeRoll()],
    ['Weather table: at work', () => A.tableStir(0)],
    ['Console keys', () => { for (let i = 0; i < 8; i++) setTimeout(() => A.consoleTick(1), i * 260 + Math.random() * 120); }],
    ['The ring coming down (loop)', () => A.linkRing(1)],
    ['The ring closes', () => A.linkLock()],
  ]],
  ['THE FIELD', [
    ['Night in the field (loop)', () => A.fieldNight()],
    ['Crop circle tones from the speaker (loop)', () => A.cropTones()],
    ['Mantis breathing, from inside (loop)', () => A.mantisBreath()],
    ['Mantis footsteps on grass', () => { for (let i = 0; i < 4; i++) setTimeout(() => A.fieldStep(1, i % 2 ? 1 : -1), i * 800); }],
    ['Pressure of the lights (loop)', () => A.lightsPressure()],
    ['Three lights answer', () => A.lightsAnswer()],
    ['A light wakes at a corner (three in turn)', () => { for (let i = 0; i < 3; i++) setTimeout(() => A.lightWake(i), i * 2200); }],
    ['The medallion beam held, on him then off (loop)', () => { const h = A.fieldBeam(); setTimeout(() => h.set(0, 0), 4000); setTimeout(() => h.set(1, 1), 7000); setTimeout(() => h.stop(2), 10000); }],
    ['The others stop', () => A.switchOff()],
    ['Into his body', () => A.fieldSwitch(true)],
    ['Into the mantis', () => A.fieldSwitch(false)],
    ['The pickup (column, lift-off)', () => A.fieldPickup(5.4)],
    ['The triangle opens', () => A.fieldOpen()],
  ]],
  ['THE REVEAL', [
    ['Nursery room (loop)', () => A.nursery()],
    ['The tune hummed, remembered voice', () => A.hum(0)],
    ['The tune hummed, the child', () => A.hum(1, 1, { bars: 8 })],
    ['The tune hummed under the breath', () => A.hum(2)],
    ['The tune, the first closed-mouth voice', () => A.lull(0)],
    ['The lullaby (all eight bars)', () => A._lullaby()],
    ['The toy plays the tune', () => A.toyTune({ from: 0, to: 4, oct: 4, gain: 0.5 })],
    ['A child clapping', () => A.clap(1)],
    ['A memory comes up', () => A.recall()],
    ['The toy meets their hand', () => A.toyTouch()],
    ['Lying back on the couch', () => A.couch()],
  ]],
  ['FOOTSTEPS', ['carpet', 'wood', 'ship', 'deck', 'hall', 'stone', 'grass'].map((s) => [s, () => { for (let i = 0; i < 4; i++) setTimeout(() => A.step(s, 0.8, i % 2 ? 1 : -1), i * 480); }])],
  ['OTHER', [
    ['Plain tone (the few left in scenes)', () => A.tone(990, 0.3, { g: 0.06 })],
    ['Old chime (not used any more)', () => A.chime()],
  ]],
];

export function initDev(jump) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:12px;top:12px;z-index:9;display:none;width:300px;max-height:92vh;overflow:auto;background:#0b0e14f2;border:1px solid #39435a;padding:12px 14px;font:13px Arial,sans-serif;color:#c3c9d4';
  const tag = document.createElement('div');
  tag.style.cssText = 'position:fixed;left:8px;bottom:6px;z-index:9;font:11px monospace;color:#e0a83a;text-shadow:0 0 3px #000;pointer-events:none';
  document.body.append(el, tag);
  const btn = (text, fn) => {
    const b = document.createElement('button'); b.textContent = text; b.onclick = fn;
    b.style.cssText = 'font:12px Arial,sans-serif;color:#fff;background:#1a2030;border:1px solid #39435a;padding:5px 8px;margin:3px 4px 0 0;cursor:pointer';
    return b;
  };
  const head = (text) => { const h = document.createElement('div'); h.textContent = text; h.style.cssText = 'color:#e0a83a;letter-spacing:.1em;margin:12px 0 2px;font-size:11px'; return h; };

  const build = (document.getElementById('build')?.textContent || '').trim();
  const title = document.createElement('div'); title.textContent = 'DEVELOPER MENU' + (build ? '   ·   ' + build : ''); title.style.cssText = 'color:#fff;letter-spacing:.2em';
  el.append(title, head('SPEED   ·   keys: [ slower   ] faster   \\ back to 1x'));
  const speedRow = document.createElement('div'); el.append(speedRow);
  const label = () => {
    tag.textContent = 'DEV' + (build ? '  ·  ' + build : '') + '  ·  speed ' + E.timeScale + 'x' + (A.muted ? '  ·  MUTED' : '') + '  ·  ` menu  ·  [ slower  ] faster  \\ 1x';
    speedRow.querySelectorAll('button').forEach((b) => { b.style.borderColor = Number(b.dataset.s) === E.timeScale ? '#e0a83a' : '#39435a'; });
  };
  const setSpeed = (s) => { E.timeScale = s; label(); };
  for (const s of SPEEDS) { const b = btn(s + 'x', () => setSpeed(s)); b.dataset.s = s; speedRow.append(b); }
  el.append(head('SOUND'));
  const muteB = btn('', () => { A.setMute(!A.muted); muteLabel(); label(); });
  const muteLabel = () => { muteB.textContent = A.muted ? 'Sound off (click to unmute)' : 'Sound on (click to mute)'; muteB.style.borderColor = A.muted ? '#e0a83a' : '#39435a'; };
  muteLabel(); el.append(muteB); addEventListener('uap-mute', muteLabel);
  // every sound in the game, to audition one at a time (the menu holds the game but wakes the audio for these). Loops
  // play for 6 s then fade. Played at normal speed whatever the game speed is.
  const box = document.createElement('details'), sum = document.createElement('summary');
  sum.textContent = 'All sounds (click to open)'; sum.style.cssText = 'cursor:pointer;margin:6px 0 2px;color:#fff'; box.append(sum); el.append(box);
  const play = (fn) => {
    A.init(); A.resume();
    const sp0 = A.speed; A.speed = 1; let r; try { r = fn(); } finally { A.speed = sp0; }
    if (r && typeof r.stop === 'function') setTimeout(() => r.stop(1), 6000);
  };
  const sub = (text) => { const h = head(text); h.style.margin = '10px 0 0'; return h; };
  for (const [group, items] of SOUNDS) {
    box.append(sub(group));
    for (const [text, fn] of items) box.append(btn(text, () => play(fn)));
  }
  box.append(sub('STOP'), btn('Stop all sounds', () => { A.stopAll(0.2); }));

  el.append(head('FIELD NOTES'));
  const allB = btn('', () => { setNotesAll(!notesAll()); allLabel(); });
  const allLabel = () => { allB.textContent = notesAll() ? 'All notes open (click to show only unlocked)' : 'Only unlocked notes (click to open all)'; allB.style.borderColor = notesAll() ? '#e0a83a' : '#39435a'; };
  allLabel();
  const resetB = btn('Reset field notes', () => { resetNotes(); resetB.textContent = 'Field notes reset'; setTimeout(() => { resetB.textContent = 'Reset field notes'; }, 1500); });
  el.append(allB, resetB);

  // ---- night state, live: the sliders change it at once (the game is held while the menu is open, so you see it on
  // closing). Read back from the game every time the menu opens. Scenes still set fear and lucidity at their own beats.
  el.append(head('NIGHT STATE   ·   live'));
  const live = [];
  const slider = (name, key, min, max, step, info, status) => {
    const lab = document.createElement('div'); lab.style.cssText = 'display:flex;justify-content:space-between;margin-top:6px;font-size:12px';
    const val = document.createElement('span'); val.style.color = '#fff'; lab.append(name, val);
    const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step;
    r.style.cssText = 'width:100%;margin:2px 0 0;accent-color:#e0a83a';
    const note = document.createElement('div'); note.textContent = info; note.style.cssText = 'font-size:10px;color:#8891a0;line-height:1.4';
    const showV = (v) => { val.textContent = (step < 1 ? v.toFixed(2) : String(v)) + '   ' + status(v); };
    r.oninput = () => { const v = Number(r.value); G[key] = v; showV(v); };
    live.push({ key, r, read: () => { r.value = G[key]; showV(Number(G[key])); } });
    el.append(lab, r, note);
    return r;
  };
  const fearR = slider('Fear', 'fear', 0, 1, 0.01, 'Vignette and heartbeat; the view trembles above 0.50. Calm starts 0.22, afraid 0.72.', (v) => (v > 0.5 ? 'trembling' : ''));
  const lucR = slider('Lucidity', 'lucidity', 0, 1, 0.01, 'Below 0.55 details change when you look away, and the council ends in Scepticism. Calm starts 0.60, afraid 0.38.', (v) => (v < 0.55 ? 'unsteady · Sceptic' : 'lucid'));
  const trustR = slider('Trust', 'trust', -4, 6, 1, '2 or more: Communion (if lucid). Below 0: cold lines. -2 or less: "You are not ready."', (v) => (v <= -2 ? 'not ready' : v < 0 ? 'cold' : v >= 2 ? 'Communion' : ''));
  const stareBox = document.createElement('input'); stareBox.type = 'checkbox'; stareBox.onchange = () => { G.stare = stareBox.checked; };
  const stareLab = document.createElement('label'); stareLab.append(stareBox, ' held the stare'); stareLab.style.cssText = 'display:block;margin-top:6px';
  const carryBox = document.createElement('input'); carryBox.type = 'checkbox';
  const carryLab = document.createElement('label'); carryLab.append(carryBox, ' also start jumps with these'); carryLab.style.cssText = 'display:block;margin-top:4px';
  el.append(stareLab, carryLab);
  const readLive = () => { live.forEach((s) => s.read()); stareBox.checked = !!G.stare; };

  el.append(head('STATE FOR THE NEXT JUMP'));
  const pathSel = document.createElement('select'); pathSel.style.cssText = 'background:#1a2030;color:#fff;border:1px solid #39435a;padding:4px;margin:0 10px 0 4px';
  for (const p of ['as listed', 'calm', 'afraid', 'fight']) { const o = document.createElement('option'); o.textContent = p; pathSel.append(o); }
  const toyBox = document.createElement('input'); toyBox.type = 'checkbox';
  const toyLab = document.createElement('label'); toyLab.append(toyBox, ' took the toy');
  const row = document.createElement('div'); row.append('path', pathSel, toyLab); el.append(row);

  el.prepend(btn('Close', () => show(false)));   // for touch screens, which have no F2
  const show = (on) => {
    el.style.display = on ? 'block' : 'none';
    if (on) readLive();
    else if (el.contains(document.activeElement)) document.activeElement.blur();   // a focused slider would otherwise take the arrow keys in play
    // open: free the cursor and hold the game without the PAUSED screen; close: straight back in, cursor captured again
    if (on) { if (document.pointerLockElement) document.exitPointerLock(); setPause(true, true); } else setPause(false);
  };
  for (const [name, items] of JUMPS) {
    el.append(head(name.toUpperCase()));
    for (const [text, scene, st] of items) {
      el.append(btn(text, () => {
        const state = { ...(st || {}) };
        if (pathSel.value !== 'as listed') state.path = pathSel.value;
        state.toy = toyBox.checked;
        if (carryBox.checked) Object.assign(state, { fear: Number(fearR.value), lucid: Number(lucR.value), trust: Number(trustR.value), stare: stareBox.checked });
        el.style.display = 'none';
        jump(scene, state);
      }));
    }
  }
  el.append(head('DEVELOPER MODE'));
  el.append(btn('Switch off and reload', () => { try { localStorage.removeItem('uap-dev'); } catch (_) {} location.href = location.pathname; }));
  const foot = document.createElement('div'); foot.style.cssText = 'margin-top:12px;color:#8891a0;font-size:11px;line-height:1.6';
  foot.textContent = '` (the key under Esc) or F2 opens and closes this menu. Speed keys work at any time in developer mode, menu open or not: [ (left square bracket) = slower, ] (right square bracket) = faster, \\ (backslash) = back to 1x. F3 shows the frame rate and, in developer mode, a panel under it: scene, camera and view, night state, the caption on screen and every sound playing.';
  el.append(foot);

  addEventListener('keydown', (e) => {
    if (e.code === 'Backquote' || e.code === 'F2') { e.preventDefault(); show(el.style.display === 'none'); }
    if (e.code === 'Escape' && el.style.display !== 'none') { e.stopImmediatePropagation(); show(false); }
    const i = SPEEDS.indexOf(E.timeScale), at = i < 0 ? 2 : i;
    if (e.code === 'BracketLeft') setSpeed(SPEEDS[Math.max(0, at - 1)]);
    if (e.code === 'BracketRight') setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, at + 1)]);
    if (e.code === 'Backslash') setSpeed(1);
  });
  label();
}
