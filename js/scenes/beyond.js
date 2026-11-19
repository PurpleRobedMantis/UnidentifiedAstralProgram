// Act 5 (the jester hall, the mandala, the council) and Act 6 (waking).
import { THREE, E, G, $, on, wait, until, tween, lerp, say, flashSub, clearSub, hint, bar, fade, flash, note, choose, noteCount, toggleNotes,
  setView, moveView, lookingAt, angleTo, resetNight, discard, warm, unsteady, t as tr } from '../engine.js';
import { A } from '../audio.js';
import { loadJesterLines } from '../jester-lines.js';
import { buildBedroom, makeMantis, idleMantis, makePlayerBody } from '../models.js';
import { resetShip } from './ship.js';
import { makePalace, makeJesterFace, PALACE_FACES, palaceSpot, palaceFace, palaceFaceOff, makeMandala, makePortal, makeOrb, makeMotes, prewarm } from '../fx.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _dir = new THREE.Vector3();
// unit vector for a yaw/pitch; returns a shared scratch vector, so use it at once
const dir = (yaw, pitch) => _dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));

export async function mandala() {
  E.scene.background = new THREE.Color(0);
  setView(0, 1.6, 0, 0, 0); E.mode = 'locked'; E.heart = true; E.unsteady = true;
  // the developer menu can start the act at the council; everything before it is skipped
  palaceToMantis: {
  if (E.devCouncil) { E.devCouncil = false; prewarm(E.renderer, E.camera); fade(0, 2); break palaceToMantis; }
  // the tall one who walks out of the doors, and the light they are seen by, exist from the start: building them and
  // adding a light at the doors froze the game for about a second
  const mantisPre = makeMantis(), mantisLight = new THREE.HemisphereLight(0xffd0f0, 0x402060, 0);
  mantisPre.visible = false; E.scene.add(mantisPre, mantisLight);
  const carrier = A.carrier(300, 0.06, 14, { to: 560 });
  const low = A.drone(41, { type: 'sawtooth', g: 0.06, fade: 10 });
  prewarm(E.renderer, E.camera);   // compile every shader of the act now, while the screen is black
  warm(mantisPre);
  // the flower fills the view from the start (a full-screen surface); it stays shut until the palace burns
  const g = new THREE.Group(); E.scene.add(g);
  const md = makeMandala(0), mu = md.material.uniforms; g.add(md);
  // the doors exist from the start too, hidden and compiled in this scene now: built at the end of the melt, their eight
  // shaders compiled on the first frame of the flower (a 130 ms freeze; prewarm compiles them in an empty scene, which differs)
  const portal = makePortal(); portal.group.scale.setScalar(0.001); portal.group.visible = false; g.add(portal.group); warm(portal.group);
  // the developer menu can also start at the flower opening: the jester hall is skipped
  const skipHall = !!E.devFlower; E.devFlower = false;
  // one clock for the flower from the first moment of the melt to the snatch (build 146): its edge spreads, the flower
  // itself swells and it turns, all on one curve that only slows to a stop 10 s in, long after the palace is gone. It used
  // to ease to a dead stop just as the palace finished burning, sit still, then start again with the chrysanthemum.
  const FLOWER_T = 10;
  let fs = 0, growing = false;
  const sm = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  const offGrow = on((dt) => {
    if (!growing) return;
    fs += dt;
    const u = Math.min(1, fs / FLOWER_T), f = 1 - (1 - u) * (1 - u);
    mu.uGrow.value = 1.5 * f; mu.uZoom.value = 0.55 + 0.45 * f;
    // turning: from the slow drift it opens with, up through the opening, then settling to a slow turn that never stops
    mu.uRot.value += dt * (0.05 + 0.07 * sm(fs / 4) - 0.08 * sm((fs - 8) / 6));
  });
  if (skipHall) { fs = 5; growing = true; setView(0, 1.6, 0, 0, 0.05); fade(0, 2); }
  else {
  note('carrier');
  await wait(0.6);   // the dark before the palace is kept short: 5 s in all
  say('A tone, climbing. Your whole body rings with it.', 'self', 3.2);
  await wait(3.6);
  A.crinkle(); E.shake = 0.03;
  await wait(0.8); E.shake = 0;

  // ---- the checkered palace ----
  const hall = new THREE.Group(); E.scene.add(hall);
  const palace = makePalace(), pu = palace.material.uniforms; hall.add(palace);
  const farPos = V(0, 1.6, -34);   // the hall's vanishing point: the way ahead, where the eyes should stay
  palace.position.copy(E.camera.position);
  const pxSize = new THREE.Vector2();
  const offPalace = on((dt) => {
    pu.uT.value += dt; pu.uZ.value += dt * 2.2; palace.position.copy(E.camera.position);
    // the palace filters its patterns by the true size of a pixel, so distance greys out cleanly at any resolution
    E.renderer.getDrawingBufferSize(pxSize); pu.uPx.value = 2 * Math.tan(E.camera.fov * Math.PI / 360) / Math.max(1, pxSize.y);
  });
  // the jesters are faces the palace grows out of its own walls; these meshes are only their (undrawn) anchors
  const pool = [], jd = V(0, 0, -1);
  for (let i = 0; i < PALACE_FACES; i++) { const j = makeJesterFace(); j.visible = false; j.userData.slot = i; hall.add(j); pool.push(j); }
  await flash('#fff', 0.8);
  note('checker'); note('jester');
  E.mode = 'look'; E.limits = { yaw: 1.15, up: 0.75, down: 0.75 };
  say('A palace in black and white. There are faces in the walls, and every one of them is looking at you.');
  document.body.classList.add('legible');
  hint('Keep your eyes on the far end of the hall. Looking at a face drains the bar.');
  const lines = await loadJesterLines();
  let lastLine = -1;
  const pickLine = () => { let k; do k = Math.floor(Math.random() * lines.length); while (k === lastLine && lines.length > 1); lastLine = k; return lines[k]; };
  const jesters = []; let focus = 0, cool = 0, spawnT = 0.7, pointed = false, tt = 0, whisperT = 2.5, fryK = 0;
  const spawn = (pointing) => {
    const j = pool.find((x) => !x.visible); if (!j) return false;
    const spot = palaceSpot(pu, pointing); if (!spot) return false;   // a pier, a spandrel or the vault, a little way ahead
    const u = j.userData, ju = j.material.uniforms;
    u.spot = spot; u.yaw = 0; u.pitch = 0;
    u.life = pointing ? 99 : 3 + Math.random() * 2.5; u.age = 0; u.pointing = pointing; u.mood = pointing ? 0.45 : 0;
    ju.uSeed.value = Math.random() * 10; ju.uPoint.value = pointing ? 1 : 0; ju.uBurn.value = 0; ju.uMood.value = u.mood;
    if (!pointing) A.honk();
    j.visible = true; jesters.push(j); return true;
  };
  const dropJester = (j) => { j.visible = false; palaceFaceOff(pu, j.userData.slot); };
  const clearJesters = () => { for (const j of jesters.splice(0)) dropJester(j); };
  const mocking = () => { let n = 0; for (const j of jesters) if (!j.userData.pointing) n++; return n; };
  E.gazeAt = farPos;
  await new Promise((res) => {
    const off = on((dt, t) => {
      tt += dt; cool -= dt; spawnT -= dt;
      if (spawnT <= 0 && cool <= 0 && mocking() < 4) spawnT = spawn(false) ? Math.max(0.35, 0.7 + Math.random() * 0.9 - focus * 0.5) : 0.3;
      if (!pointed && focus > 0.68 && spawn(true)) { pointed = true; note('pointing'); say('One of them only points down the hall, the way you are already going.'); }
      let active = null, nearA = 9, nearYaw = 0;
      for (let i = 0; i < jesters.length; i++) {
        const j = jesters[i], u = j.userData, ju = j.material.uniforms; u.age += dt; ju.uT.value += dt;
        // the face rides the wall it grew from, so it comes toward you as you go; it swells out, and sinks back before it is passed
        let depth = palaceFace(pu, u.slot, u.spot, 0, 0, 0, false, jd);
        if (u.pointing && depth < 3) { const s2 = palaceSpot(pu, true); if (s2) { u.spot = s2; u.age = 0; depth = 99; } }   // the pointing one keeps turning up ahead
        if (!u.pointing && depth < 2.6) u.age = u.life + 1;
        const sw = Math.min(1, u.age * 2.5) * Math.min(1, Math.max(0, (u.life - u.age) * 3)) * Math.min(1, Math.max(0, (depth - 2.6) / 1.5));
        palaceFace(pu, u.slot, u.spot, sw, u.mood, u.pointing ? 0 : Math.sin(t * 5 + u.life) * 0.14, u.pointing, jd);
        u.yaw = Math.atan2(-jd.x, -jd.z); u.pitch = Math.asin(jd.y);
        j.position.copy(E.camera.position).addScaledVector(jd, 4);
        // grin and frown swap about twice a second; the shader morphs the mouth between them
        if (!u.pointing) { u.mood += ((Math.floor(t * 0.9 + u.life) % 2 ? 1 : 0) - u.mood) * Math.min(1, dt * 2.5); ju.uMood.value = u.mood; active = j; }
        if (u.age > u.life) { dropJester(j); jesters.splice(i, 1); i--; continue; }
        if (!u.pointing) { const an = angleTo(j.position); if (an < nearA) { nearA = an; nearYaw = u.yaw; } ju.uFry.value = Math.min(1, fryK * 0.6 + Math.max(0, 1 - an / 0.6) * 0.7); }
        else ju.uFry.value = fryK * 0.4;
        if (!u.pointing && cool <= 0 && angleTo(j.position) < 0.2) {
          cool = 2.2; focus = Math.max(0, focus - 0.1); G.fear += 0.04;
          E.dread = Math.min(1, E.dread + 0.2);   // every face you look at sends the heart faster (five to reach the top)
          clearJesters(); flash('#fff', 0.35); A.honk(); A.noise(0.3, { g: 0.3, f: 900 });
          say(pickLine(), 'jest', 1.6);
          if (A.mock) A.mock((Math.random() * 2 - 1) * 0.7, 1.1);
          pu.uZ.value = 0;
          return;
        }
      }
      // djinn whispers: now and then from either side; closer, louder and from the jester's side when one is near the centre of view
      whisperT -= dt;
      if (whisperT <= 0 && A.murmur) {
        // thick with voices: murmurs from both sides all the time, laughter now and then, both closer and louder when one of them is near your eye
        if (nearA < 0.6) { const c = 1 - nearA / 0.6, side = (nearYaw > E.yaw ? -1 : 1) * (0.5 + 0.4 * c); A.murmur(side, 1.4 + 1.2 * c); if (Math.random() < 0.35) A.whisper(-side, 1.8); if (Math.random() < 0.4) A.cackle(side, 1.0 + 0.7 * c); if (A.mock && Math.random() < 0.3) A.mock(side, 1.0 + 0.5 * c); whisperT = 0.4 + Math.random() * 0.7; }
        else { A.murmur(undefined, 0.9 + Math.random() * 0.6); if (Math.random() < 0.35) A.murmur(undefined, 0.7); if (Math.random() < 0.3) A.whisper(undefined, 1.6); if (Math.random() < 0.2) A.cackle(undefined, 0.75); if (A.mock && Math.random() < 0.22) A.mock(undefined, 0.85); whisperT = 0.6 + Math.random() * 1.3; }
      }
      // the picture overdrives as the hall wears on, and surges while a jester is near the centre of view
      const fryT = Math.min(0.55, 0.18 + focus * 0.3 + tt * 0.004) + (nearA < 0.55 ? (1 - nearA / 0.55) * 0.45 : 0);
      fryK += (fryT - fryK) * Math.min(1, dt * 3); pu.uFry.value = fryK;
      if (active) {
        const dy = active.userData.yaw - E.yaw, dp = active.userData.pitch - E.pitch, n = Math.hypot(dy, dp) || 1, m = 0.16 + G.fear * 0.12;
        E.pull.yaw = dy / n * m; E.pull.pitch = dp / n * m;
      } else E.pull.yaw = E.pull.pitch = 0;
      E.dread = Math.max(0, E.dread - dt / 400);   // it barely settles while you are still in the hall
      if (angleTo(farPos) < 0.24) focus += dt / 14; else focus = Math.max(0, focus - dt / 90);
      if (tt > 110) focus += dt / 8;
      pu.uFocus.value = Math.min(1, focus); bar(focus);
      if (focus >= 1) { off(); res(); }
    });
  });
  E.pull.yaw = E.pull.pitch = 0; E.gazeAt = null; bar(null); hint(''); document.body.classList.remove('legible'); E.mode = 'locked'; note('lookpast');
  { const d0 = E.dread; tween(4, (k) => { E.dread = d0 * (1 - k); }); }   // you stop caring: the heart comes back down
  say('What a circus. You stop caring about them, and look past.', 'self', 2.6);
  moveView(2.5, { yaw: 0, pitch: 0.05 });
  await wait(0.9);   // the line is up a moment before the palace starts to melt, and goes soon after
  const burn = A.drone(2000, { noise: true, g: 0.12, q: 1 });
  // the film burns: palace and faces char from the inside out, and at the hall's vanishing point a seed of colour opens
  // the flower is already alive behind the palace: turning and flowing while the film burns off it
  const flowBurn = on((dt) => { mu.uT.value += dt; });
  growing = true;   // the flower's one clock starts with the melt (offGrow above) and runs on through the chrysanthemum
  await tween(5.0, (k) => {
    pu.uBurn.value = k;
    jesters.forEach((j) => { j.material.uniforms.uBurn.value = k; });
  });
  burn.stop(0.4); flowBurn(); clearJesters(); offPalace(); discard(hall);
  }

  // ---- the chrysanthemum ----
  // the doors open from the exact centre of the flower: the flower is drawn about the middle of the screen, so the doors sit
  // on the line of sight, kept there every frame
  portal.group.visible = true;
  const _pf = new THREE.Vector3();
  const placePortal = () => { E.camera.getWorldDirection(_pf); portal.group.position.copy(E.camera.position).addScaledVector(_pf, 10.5); portal.group.quaternion.copy(E.camera.quaternion);
    // the doors stand on their base: drop them by the height of their middle (the glow, 1.45 up) so they grow out of the centre
    portal.group.position.addScaledVector(_pf.set(0, 1, 0).applyQuaternion(E.camera.quaternion), -1.45 * portal.group.scale.x); };
  placePortal();
  const offFlower = on((dt) => { mu.uT.value += dt; placePortal(); portal.tick(dt); });
  const chord = [A.drone(220, { g: 0.04 }), A.drone(277.2, { g: 0.03 }), A.drone(329.6, { g: 0.03 })];
  carrier.set(1000, 0.03, 5); G.fear = Math.max(0.1, G.fear - 0.3); E.heart = false;   // no heartbeat in the mandala
  note('mandala');
  await say('Colour, at last. A flower of it, turning, growing.');
  await say('“I know this place... Yes! I\'ve made it!”', 'self');
  await wait(2.5);
  // doors within doors
  await tween(2, (k) => { portal.group.scale.setScalar(Math.max(0.001, k * 1.6)); });
  await say('A door in the heart of it. Behind that door, more doors.');
  for (let i = 0; i < 4; i++) {
    A.shimmer(523.25 * [1, 1.122, 1.335, 1.498][i], 3.2, 0.022);   // soft swells rising through the doors, not struck chimes
    await tween(0.9, (k) => { const l = (i + k) / 4; portal.open(i, k); portal.setGlow(l); mu.uLight.value = l; });
  }
  const mantis = mantisPre; mantis.visible = true; mantis.position.set(0, 0.2, -10.3); mantis.scale.setScalar(0.45); g.add(mantis);
  mantisLight.intensity = 2.2; g.add(mantisLight);
  const mud = mantis.userData;
  if (mud.eyeM) mud.eyeM.emissiveIntensity = 1.8;
  // in the vision their skin is a vivid, glowing green (own copies: the shared chitin stays as it is on the ship)
  {
    const bright = new Map([[0x6f9a46, [0x7dff3a, 0x2a8a10]], [0x2c3a1c, [0x3fbf1c, 0x125a06]]]), made = new Map();
    mantis.traverse((o) => {
      const m = o.material; if (!o.isMesh || !m || !m.color) return;
      const b = bright.get(m.color.getHex()); if (!b) return;
      if (!made.has(m)) { const c = m.clone(); c.color.setHex(b[0]); c.emissive.setHex(b[1]); c.emissiveIntensity = 0.6; made.set(m, c); }
      o.material = made.get(m);
    });
  }
  const offMantis = on((dt, t) => { idleMantis(mantis, dt, t); if (mud.robeMat) mud.robeMat.color.setHSL(0.84 + Math.sin(t * 1.3) * 0.08, 0.62, 0.24); });
  A.clicks(6);
  // they walk, they do not glide: a rise and fall with each long step, a sway from side to side, at one steady pace the
  // whole way; the walk lasts exactly as long as the captions below (say() holds each for 1.7 s + 0.05 s a letter, then
  // 0.4 s to fade), so they reach arm's length as the last caption goes, stop, and snatch at once
  const walkLines = [
    'The tall one again, walking out through all of them.',
    'Robes that will not hold one colour. Gold writing down the seams. Eyes with stars in them.',
    'Ancient. In charge of something. Coming straight at you.',
    'And you suddenly realise you know them. You have always known them.'];
  const WALK = walkLines.reduce((s, l) => s + 1.7 + l.length * 0.05 + 0.4, 0);
  let walkK = 0, stride = 0, walking = true;
  const offWalk = on((dt) => {
    if (!walking) return;
    walkK = Math.min(1, walkK + dt / WALK); stride += dt * 2.6;
    const k = walkK, st = Math.sin(stride * Math.PI);
    mantis.position.set(Math.sin(stride * Math.PI * 0.5) * 0.04, lerp(0.2, 0, Math.min(1, k * 1.3)) + Math.abs(st) * 0.035, lerp(-10.3, -1.5, k));
    mantis.rotation.z = st * 0.025; mantis.scale.setScalar(lerp(0.45, 1.02, Math.min(1, k * 1.3)));
  });
  for (let i = 0; i < walkLines.length; i++) { if (i === 1) { note('stareyes'); note('gold'); } await say(walkLines[i]); }
  // the snatch: one fast lunge, an arm out for you, and the flower goes out
  walking = false; offWalk(); mantis.rotation.z = 0; mantis.position.x = 0; mantis.position.y = 0;
  const z0 = mantis.position.z, grab = V(0, 1.25, -0.15);
  A.clicks(4);
  await tween(0.75, (k) => {
    mantis.position.z = lerp(z0, -0.6, k * k); mu.uLight.value = 1 + k * 1.5;
    if (mud.reachTo) { mantis.updateMatrixWorld(true); mud.reachTo(grab, Math.min(1, k * 1.6)); }
  });
  E.shake = 0.05;
  chord.forEach((c) => c.stop(0.05)); carrier.stop(0.05); low.stop(0.05);
  offFlower(); offGrow(); offMantis(); discard(g);
  flash('#efe6ff', 1.3); E.shake = 0;   // the flower goes out in a pale bloom that drains into the dark

  }
  // ---- the council ----
  E.heart = false;
  await wait(1.5);
  const ring = new THREE.Group(); E.scene.add(ring);
  // near-total dark: nine orbs of pale light, and fine motes drifting between and beyond them
  const motes = makeMotes(), mm = motes.material; motes.position.copy(E.camera.position); ring.add(motes);
  let moteSpin = 0.012, rushK = 0;
  const ps = [];
  for (let i = 0; i < 9; i++) {
    const s = makeOrb(i * 1.37 + 0.2);
    const a = i / 9 * Math.PI * 2; s.position.set(Math.sin(a) * 4.5, 1.6 + Math.sin(i * 2.1) * 0.5, -Math.cos(a) * 4.5); s.userData = { ph: i * 1.7, k: 1, op: 0 }; ring.add(s); ps.push(s);
    // low lucidity: look back and this one is not the one that was there (another pattern, another pulse)
    const seed = i * 1.37 + 0.2, ph = i * 1.7;
    unsteady(s, (k, n) => { s.material.uniforms.uSeed.value = k ? seed + n * 2.71 : seed; s.userData.ph = k ? ph + n * 2.3 : ph; });
  }
  on((dt, t) => {
    motes.rotation.y += dt * moteSpin; motes.rotation.x = Math.sin(t * 0.05) * 0.15;
    for (const s of ps) {
      const u = s.userData, su = s.material.uniforms; su.uT.value += dt; su.uOp.value = Math.max(0, u.op); su.uRush.value = rushK;
      s.scale.setScalar(Math.max(0.05, Math.abs((2 + Math.sin(t * 0.5 + u.ph) * 1.6 + Math.sin(t * 0.17 + u.ph * 2) * 1.2) * u.k)));
      s.quaternion.copy(E.camera.quaternion);
    }
  });
  E.limits = null; E.mode = 'look';
  const deep = A.drone(55, { g: 0.07 }); const deep2 = A.drone(82.4, { g: 0.04 });
  await tween(3, (k) => { ps.forEach((s) => { s.userData.op = k * 0.8; }); mm.opacity = k * 0.3; });
  note('council');
  await say('It\'s dark. As if you\'re at the end of the universe, and the fireworks have gone out.');
  await say('You are a single point, and there are others all around you.');
  await say('You feel as though you are everyone. You are everything.');
  await say('You made them. To remind you. To meet you here, once you had come this far.');
  await say('They seem small. Then they seem enormous.');
  // the download
  const frags = ['eternal', 'awareness', 'always', 'you', 'nothing else to do', 'experience', 'again', 'for you', 'all of it', 'always existed', 'again', 'you', 'again', 'every one', 'it is you', 'always', 'remember', 'again'];
  const rush = A.drone(400, { noise: true, g: 0.05, q: 0.6 }); rush.set(6000, 0.3, 4.5);
  E.shake = 0.03; moteSpin = 1.6; rushK = 1;   // the orbs flare and flicker, and the dark fills with fast fine light
  for (let i = 0; i < 52; i++) {
    flashSub(tr(frags[Math.floor(Math.random() * frags.length)]).toUpperCase()); ps.forEach((s) => { s.userData.op = 0.45 + Math.random() * 0.9; });
    mm.opacity = 0.55 + Math.random() * 0.45;
    await wait(0.085);
  }
  clearSub(); rush.stop(0.05); E.shake = 0; ps.forEach((s) => { s.userData.op = 0.8; });
  moteSpin = 0.012; rushK = 0; mm.opacity = 0.3;
  await wait(1.4);
  await say('You are the awareness that has always been here.', 'them');
  await say('All of this exists as experience, for you. There was nothing else to do.', 'them');
  await say('You have been doing this for all of eternity.', 'them');
  await say('This is all there ever was, all there is, and all there will ever be.', 'them');
  await say('A thought arrives from nowhere: once you get the message, hang up the phone.');
  await say('No. Wait. I need to make sure. I have to come back and check.');
  await say('Some part of you already knows the answer. You have said this before. You will say it again.');
  const c = await choose(['Is that all this is?', 'Thank you.', 'I don\'t believe this. Let me past.', '(Say nothing. Hold on to it.)']);
  let end;
  if (c === 0) {
    await say('Well, what else were you expecting?', 'them'); note('expecting');
    tween(2, (k) => { ps[3].userData.k = 1 - k * 0.7; ps[3].userData.op = 0.8 - k * 0.6; });
    await say('One of them dims, as if you had saddened them.');
    const d = await choose(["No. I'm sorry. Don't be sad.", '(Say nothing.)']);
    if (d === 0) tween(1.5, (k) => { ps[3].userData.k = 0.3 + k * 0.7; ps[3].userData.op = 0.2 + k * 0.6; });
    end = 'phone';
  } else if (c === 2) {
    G.trust -= 2;
    const md2 = makeMandala(8), mu2 = md2.material.uniforms; md2.position.set(0, 1.6, -14); mu2.uGrow.value = 1.4; E.scene.add(md2);
    on((dt) => { mu2.uT.value += dt; });
    E.mode = 'locked'; moveView(1, { yaw: 0, pitch: 0 });
    await say('You notice that the flower is still turning past them. You go for it.');
    moveView(2.6, { pos: V(0, 1.6, -9) });
    await wait(1.6);
    A.clicks(8);
    say("You shouldn't be here. Come back later.", 'them', 2.5); note('closed');
    await wait(1.3);
    A.zap(); E.shake = 0.06;
    await flash('#fff', 0.5);
    end = 'wardens';
  } else {
    if (c === 1) { G.trust += 1; tween(1.5, (k) => ps.forEach((s) => { s.userData.k = 1 + k * 0.5; s.userData.op = 0.8 + k * 0.25; })); await say('The whole ring of them brightens at once.'); }
    else { G.lucidity += 0.06; await say('You hold on to all of it, as hard as you can.'); }
    end = G.lucidity < 0.55 ? 'sceptic' : G.trust >= 2 ? 'communion' : 'phone';
  }
  deep.stop(1.5); deep2.stop(1.5);
  $('fade').style.background = '#000';
  await fade(1, 1.8);
  E.shake = 0;
  return 'end:' + end;
}

// ---------- waking ----------
const ENDS = {
  missing: { title: 'MISSING TIME', text: "You fought, and they switched you off. Whatever happened next, you were there for it. You just don't get to keep it.", echo: 'Echoes Budd Hopkins and David Jacobs: resistance fails, and the price is memory. To see more of the night, try not fighting.' },
  communion: { title: 'COMMUNION', text: 'You did not fight, you met them halfway, and you were allowed to keep the night. Whether they are teachers is still your guess.', echo: 'Echoes John Mack and Whitley Strieber: terrifying, and transforming. About 70% of surveyed experiencers say contact changed their life for the better.' },
  wardens: { title: 'THE WARDENS', text: 'They told you what you already believed, and when you asked for more they put you back. Something is further in. They would rather you did not look.', echo: 'Echoes Karla Turner and the prison-planet community. It is one reading among several, and no better proven than the others.' },
  phone: { title: 'HANG UP THE PHONE', text: 'You got the message. It was the one you had always suspected, which is either the proof or the problem.', echo: 'Echoes a DMT trip from 2023: the answer was the one the author already suspected.' },
  sceptic: { title: 'THE SCEPTIC', text: 'By morning most of it is gone, and what is left has an explanation. Most of it.', echo: 'Echoes Susan Clancy and Chris French on sleep paralysis, and the experiencers who answer them with marks on the body. Staying calm and holding the stare lets you keep more of the night.' },
};

export async function ending(kind) {
  E.heart = false; G.fear = kind === 'missing' ? 0.3 : 0.1;
  const day = kind === 'communion' || kind === 'sceptic';
  const R = buildBedroom(day
    ? { clock: kind === 'communion' ? '8:08' : '7:12', ambient: 2.4, ambColor: kind === 'communion' ? 0xfff0dc : 0xf2f4f8, moon: 0, window: kind === 'communion' ? 0xffeccc : 0xeaf2fa, wall: 0x8f8a96 }
    : { clock: kind === 'missing' ? '4:14' : '3:00', ambient: kind === 'missing' ? 0.95 : undefined }); // a touch more room light so the hand reads
  E.scene.add(R.group);
  if (day) { const s = new THREE.DirectionalLight(kind === 'communion' ? 0xffe2b8 : 0xffffff, 2.2); s.position.set(-4, 2.5, 0.6); R.group.add(s); }
  if (kind === 'missing') setView(0, 0.86, -0.25, 0, 0.3);
  else setView(0, 0.86, -1.52, Math.PI, 0.2);
  // your body in the bed under the covers (the covers are shaped round it). 'missing': lying the wrong way round, so the
  // body, the covers and the pillows are all turned end for end
  const bed = makePlayerBody(); bed.userData.layInBed(); bed.userData.legs.children[1].visible = false; R.group.add(bed);
  if (kind === 'missing') {
    bed.position.set(0, 0.74, -0.19); bed.rotation.set(Math.PI / 2 - 0.08, 0, 0);
    R.blanket.position.z = -1.22; R.blanket.rotation.y = Math.PI; R.pillows.position.z = 1.59;
  }
  E.limits = { yaw: 1.4, up: 0.8, down: 0.55 }; E.mode = 'look';
  const tone = A.drone(110, { noise: true, g: 0.04, q: 0.4 });
  // dust hanging in the room's light; and, unless the night was taken, the flower still fading from the eye
  const dust = makeMotes(170, day ? 0xffe2b8 : 0x93a8ff, 0.011); dust.scale.setScalar(0.22); dust.position.copy(E.camera.position); dust.material.opacity = day ? 0.5 : 0.22; R.group.add(dust);
  const ghostK = { communion: 0.42, phone: 0.5, wardens: 0.32, sceptic: 0.16 }[kind] || 0;
  let ghost = null, ghostT = 0;
  if (ghostK) {
    ghost = makeMandala(0); ghost.material.depthTest = false; ghost.renderOrder = 10;   // full-screen: no quad edge at any aspect ratio
    ghost.material.uniforms.uGrow.value = 1.5; ghost.material.uniforms.uFade.value = ghostK; E.camera.add(ghost);
  }
  on((dt) => {
    dust.rotation.y += dt * 0.02; dust.rotation.x += dt * 0.007;
    if (!ghost) return;
    ghostT += dt; const k = Math.max(0, 1 - ghostT / (4 + ghostK * 10)), gu = ghost.material.uniforms;
    gu.uT.value += dt * 0.5; gu.uFade.value = ghostK * k * k;
    if (k <= 0) { discard(ghost); ghost = null; }
  });
  $('fade').style.background = '#000';
  // Sitting up from the pillow (the endings that face down the bed): the lying body's shoulders and arms swing up round its
  // hips, the eyes riding the same arc (the chin tucks first, so the view tips down early), and the covers slide a little
  // toward the lap. The chest itself is hidden, as it would sit inside the view. Leaves E.mode 'locked'.
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const sitUp = async (dur, to, pitch) => {
    const lim = E.limits; E.limits = null; E.mode = 'locked';
    A.rustle(dur * 0.8, 0.9);   // the covers slide as you come up off the pillow
    const bu = bed.userData, hipL = bu.legs.position.clone(), hip = bed.localToWorld(hipL.clone());
    bu.torso.children[0].visible = false;
    const p0 = E.camera.position.clone(), pi0 = E.pitch, bz = R.blanket.position.z;
    const el = (p) => Math.atan2(p.y - hip.y, Math.hypot(p.x - hip.x, p.z - hip.z));
    const a0 = el(p0), a1 = el(to), r0 = p0.distanceTo(hip), r1 = to.distanceTo(hip);
    const h0 = V(p0.x - hip.x, 0, p0.z - hip.z).normalize(), h1 = V(to.x - hip.x, 0, to.z - hip.z).normalize(), h = V();
    const rq = new THREE.Quaternion(), ax = V(1, 0, 0);
    await tween(dur, (k) => {
      const e = k * k * (3 - 2 * k), a = lerp(a0, a1, e), r = lerp(r0, r1, e);
      h.lerpVectors(h0, h1, e).normalize();
      E.camera.position.copy(hip).addScaledVector(h, r * Math.cos(a)); E.camera.position.y += r * Math.sin(a);
      E.pitch = lerp(pi0, pitch, sm(0, 0.85, k));
      rq.setFromAxisAngle(ax, -(a - a0)); bu.torso.quaternion.copy(rq); bu.torso.position.copy(hipL).sub(h.copy(hipL).applyQuaternion(rq));   // bed x is world -x
      R.blanket.position.z = bz + 0.08 * e * Math.sign(hip.z - p0.z);   // toward the lap (the 'missing' bed is end for end)
    }, (k) => k);
    E.base.yaw = E.yaw; E.base.pitch = E.pitch; E.limits = lim;
  };
  // the Wardens wake to the seam still in the wall: it is there as the room fades in, not switched on afterwards
  if (kind === 'wardens') { R.portal.visible = true; R.portal.children[1].visible = false; R.portal.children[0].material.transparent = true; R.portal.children[0].material.opacity = 0.35; R.portalLight.intensity = 6; }
  await fade(0, 3);

  if (kind === 'missing') {
    await say('4:14.');
    note('missingtime');
    await say('You remember the clock saying 3:00. Then this.');
    await say('You are lying the wrong way round in your own bed. Your shirt is on backwards.'); note('wrongway');
    await sitUp(2.8, V(0, 1.34, -0.65), -0.12); E.mode = 'look';   // up off the pillow at the foot of the bed
    const me = makePlayerBody(); me.userData.torso.children[0].visible = false; me.userData.legs.visible = false; me.userData.armL.visible = false; me.userData.marks.visible = true;
    E.camera.add(me);   // lit only by the room
    bed.userData.armR.visible = false;   // the right arm that rises is the one carried with the view
    // the hand comes up palm first, turns over, curls and opens, and stays up; the caption lands as the back turns to you
    let told = false;
    await tween(4.75, (q) => { const k = q * 0.79; me.userData.examineHand(k); if (!told && k > 0.5) { told = true; say('On the back of your hand, by the thumb: three small marks in a triangle.'); note('marks'); } }, (k) => k);
    await wait(3.2);   // the hand stays up, still being stared at, as the night ends
  } else if (kind === 'communion') {
    await say('Morning. You remember all of it.');
    await say('A feeling of interconnectedness with everything that exists.');
    await say('When you hurt someone, you hurt yourself. When you love someone, you love yourself.');
    if (G.toy) await say("The toy is not in your hand. You knew it wouldn't be.");
    hint('Look at the window.');
    const bug = new THREE.Group(), gm = new THREE.MeshStandardMaterial({ color: 0x4f9a35, roughness: 0.5 });
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.09, 4, 8), gm); b.rotation.z = 0.5;
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.025, 3), gm); h.position.set(-0.035, 0.065, 0); h.rotation.z = Math.PI;
    bug.add(b, h);
    for (let i = 0; i < 6; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.07), gm); l.position.set(0.01 * (i % 3 - 1), -0.01 + (i % 3) * 0.02, i < 3 ? 0.02 : -0.02); l.rotation.set(i < 3 ? 0.9 : -0.9, 0, 0.6); bug.add(l); }
    bug.position.set(-2.45, 1.5, 0.15); bug.rotation.y = Math.PI / 2; bug.scale.setScalar(1.6); R.group.add(bug);
    await until(() => lookingAt(bug.position, 0.25), 20);
    hint(''); note('realmantis');
    await say('On the outside of the glass, a small green mantis. They turn their head, and look in at you.');
    await say('You are not afraid of them. You are not sure you are afraid of anything.');
  } else if (kind === 'wardens') {
    await say('3:00. Again.');
    await say('On the far wall, a seam of blue light, closing.');
    await tween(3, (k) => { R.portal.children[0].material.opacity = 0.35 * (1 - k); R.portalLight.intensity = 6 * (1 - k); });
    await say('You tried to get past them, and they put you back in your bed.');
    await say('Did they answer you? Or did you answer yourself?'); note('prison');
  } else if (kind === 'phone') {
    await say('There\'s a feeling of interconnectedness with everything that exists. The room, the street, every living thing, the whole sky: one thing, and you are it.');
    const up = sitUp(2.8, V(0, 1.34, -1.12), -0.12);
    await say('You sit up laughing, and angry, and not sure which.');
    await up; E.mode = 'look';
    await say('“You can be whoever and do whatever you want,” you tell the room... you tell yourself.');
    await say('“Why are you scared of the dark?”');
    R.setClock('3:01'); A.tone(990, 0.06, { g: 0.04 });
    await say('“I\'m coming back later, to check again.”'); note('phone');
    await say('When you hurt someone, you hurt yourself. When you love someone, you love yourself.');
  } else {
    await say('Morning. Most of it has already gone, the way dreams go.');
    await say('Your brain woke up before your body did.', 'voice');
    await say('It... happens to about one person in twelve. Buzzing, floating, figures by the bed, right?', 'voice');
    await say('It was a bad night. That is all it was.', 'voice'); note('sceptic');
    // you sit up and look down the bed; your right hand takes the edge of the covers and drags them off to the side, and
    // there on the bare shin is the mark
    const mark = bed.userData.bareShin();
    await sitUp(2.8, V(0, 1.3, -1.12), -0.75);
    // The right hand, by IK (makePlayerBody ikRight): up from the side, palm down onto the covers over the thigh; it grips,
    // drags them off to the right and lets go (they slide on and fall away), then drops out of sight. The eyes follow the
    // hand the whole time and then go down to the shin: one aim point, moved continuously, so the view never jumps.
    const lim = E.limits; E.limits = null;
    bed.userData.armR.visible = false;   // the lying body's right arm; the one that reaches is this one
    const me = makePlayerBody(), mu = me.userData, hr = mu.handRigR;
    mu.torso.children[0].visible = false; mu.legs.visible = false; mu.armL.visible = false;
    me.position.copy(E.camera.position); me.rotation.set(0, Math.PI, 0); R.group.add(me);
    mu.relax(0.1); me.updateMatrixWorld(true);
    const toL = (w) => me.worldToLocal(w.clone()), iq = me.quaternion.clone().invert();
    const W0 = toL(mu.handR.getWorldPosition(V())), Q0 = iq.clone().multiply(mu.handR.getWorldQuaternion(new THREE.Quaternion()));
    const c0 = hr.curls.slice(), sp0 = hr.spread, op0 = hr.opp, tf0 = hr.tflex, cu = [0, 0, 0, 0];
    // palm down, fingers toward the feet and a little in (hand frame: palm -x, fingers -y, thumb -z)
    const Fd = V(0.25, 0, 1).normalize(), hy = Fd.clone().negate(), hx = V(0, 1, 0);
    const Qd = iq.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(hx, hy, V().crossVectors(hx, hy))));
    const grab = V(-0.12, 0.735, -0.82);                                        // the covers over the right thigh
    const Wg = toL(grab.clone().addScaledVector(Fd, -0.05).add(V(0, 0.03, 0))), Wup = Wg.clone().add(V(0, 0.08, 0));
    const C1 = W0.clone().lerp(Wup, 0.5).add(V(0.1, 0.06, 0)), drag = V(0.3, 0.05, 0.1);   // body frame: to the right, up, back
    const bez = (a, c, b, t, out) => out.copy(a).multiplyScalar((1 - t) * (1 - t)).addScaledVector(c, 2 * t * (1 - t)).addScaledVector(b, t * t);
    const pole = V(0.7, -1, 0.3), Wt = V(), Qt = new THREE.Quaternion(), hp = V();
    const pose = (W, Q, f, grip) => {
      mu.ikRight(W, Q, pole);
      if (grip > 0) mu.curl('R', lerp(0.08, 0.75, grip));
      else { for (let i = 0; i < 4; i++) cu[i] = lerp(c0[i], 0.08, f); hr.set(cu, lerp(sp0, 0.3, f), lerp(op0, 0.1, f), lerp(tf0, 0.1, f)); }
      me.updateMatrixWorld(true); mu.handR.getWorldPosition(hp);
    };
    const look = V().copy(E.camera.position).add(dir(E.yaw, E.pitch).multiplyScalar(0.6)), L0 = look.clone(), _d = V();
    const aim = on(() => {
      _d.copy(look).sub(E.camera.position).normalize();
      let y = Math.atan2(-_d.x, -_d.z); y += Math.round((E.yaw - y) / (2 * Math.PI)) * 2 * Math.PI;   // nearest turn, never the long way round
      E.yaw = E.base.yaw = y; E.pitch = E.base.pitch = Math.asin(_d.y);
    });
    pose(W0, Q0, 0, 0);
    await tween(1.6, (q) => {
      if (q < 0.75) bez(W0, C1, Wup, sm(0, 0.75, q), Wt); else Wt.lerpVectors(Wup, Wg, sm(0.75, 1, q));
      pose(Wt, Qt.slerpQuaternions(Q0, Qd, sm(0.05, 0.6, q)), sm(0.1, 0.6, q), 0);
      look.lerpVectors(L0, hp, 0.6 * sm(0.1, 1, q));
    }, (k) => k);
    await tween(0.35, (q) => pose(Wg, Qd, 1, q), (k) => k);
    const bx = R.blanket.position.x, by = R.blanket.position.y;
    A.rustle(1.5, 1.4, { flop: true });   // the covers dragged off and falling away
    await tween(1.5, (q) => {
      const e = sm(0, 1, q); pose(Wt.copy(Wg).addScaledVector(drag, e), Qd, 1, 1);
      R.blanket.position.x = bx - 0.3 * e; R.blanket.position.y = by - 0.01 * e;
      look.lerpVectors(L0, hp, 0.6);
    }, (k) => k);
    // it lets go; the covers slide on off the bed; the hand drops away and the eyes go down to the shin
    const Wd = Wt.clone(), Qh = Qd.clone(), C2 = Wd.clone().lerp(W0, 0.5).add(V(0.08, 0.05, 0.05)), L1 = look.clone(), p1 = E.camera.position.clone();
    const lean = V(-0.1, 0.96, -0.66), mw = mark.getWorldPosition(V());
    await tween(2.4, (q) => {
      const e = 1 - (1 - q) * (1 - q);   // the fling: fastest as the hand lets go, then sliding to a stop
      R.blanket.position.x = bx - 0.3 - 0.65 * e; R.blanket.position.y = by - 0.01 - 0.04 * e; R.blanket.rotation.z = -0.1 * e;
      const d = sm(0.05, 0.6, q), g2 = sm(0, 0.2, q);
      if (q < 0.6) pose(bez(Wd, C2, W0, d, Wt), Qt.slerpQuaternions(Qh, Q0, d), 1 - sm(0.1, 0.6, q), 1 - g2);
      else if (me.parent) discard(me);   // down by the hip, out of sight (discard frees its bone texture)
      const m = sm(0.1, 1, q);
      E.camera.position.lerpVectors(p1, lean, m); look.lerpVectors(L1, mw, m);
    }, (k) => k);
    aim(); E.limits = lim;
    await say('You pull back the sheet. On your shin, a small scooped mark that was not there yesterday.'); note('marks');
    await wait(1.5);
  }
  await wait(1);
  tone.stop(2);
  await fade(1, 2.2);
  const e = ENDS[kind];
  $('endTitle').textContent = tr(e.title); $('endText').textContent = tr(e.text); $('endEcho').textContent = tr(e.echo);
  $('endNotes').textContent = tr('Field notes witnessed: ' + noteCount() + '.');
  $('endcard').style.display = 'block';
  if (document.pointerLockElement) document.exitPointerLock();
  $('endNotesBtn').onclick = () => toggleNotes(true);
  await new Promise((res) => { $('againBtn').onclick = res; });
  $('endcard').style.display = 'none';
  resetNight(); resetShip();
  return 'bedroom';
}
