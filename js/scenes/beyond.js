// Act 5 (the jester hall, the mandala, the council) and Act 6 (waking).
import { THREE, E, G, $, on, wait, until, tween, lerp, say, flashSub, clearSub, hint, bar, fade, flash, note, choose, noteCount, toggleNotes,
  setView, moveView, lookingAt, angleTo, resetNight, discard, warm, unsteady, t as tr } from '../engine.js';
import { A } from '../audio.js';
import { loadJesterLines } from '../jester-lines.js';
import { buildBedroom, makeMantis, idleMantis, makePlayerBody } from '../models.js';
import { resetShip } from './ship.js';
import { makePalace, makeJesterFace, PALACE_FACES, palaceSpot, palaceFace, palaceFaceOff, makeFlyingJester, makeMandala, makePortal, makeOrb, makeMotes, prewarm } from '../fx.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _dir = new THREE.Vector3();
// unit vector for a yaw/pitch; returns a shared scratch vector, so use it at once
const dir = (yaw, pitch) => _dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));

export async function mandala() {
  E.scene.background = new THREE.Color(0);
  setView(0, 1.6, 0, 0, 0); E.mode = 'locked'; E.heart = true; E.unsteady = true;
  E.noLapse = true;   // no lucidity blur in the vision (the palace, the flower, the council): only the details that change
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
  // Now and then (every 9-16 s, far less often than faces grow) a face tears itself out of the wall and flies at you:
  // it comes away where it was, rushes in faster and faster until it is a few centimetres from your eyes, wherever you
  // are looking, hangs there grinning, then backs off into the dark and is gone. A quad of its own (makeFlyingJester),
  // since the wall faces are drawn inside the palace shader. Phases in seconds: TEAR, RUSH, HOLD, BACK.
  const flyer = makeFlyingJester(); hall.add(flyer);
  const FLY = { TEAR: 0.3, RUSH: 0.75, HOLD: 0.8, BACK: 0.7, NEAR: 0.1 };
  let flyT = 5 + Math.random() * 3, fly = null;
  const fFwd = V(0, 0, -1), fTo = V(0, 0, 0);
  const launch = () => {
    let best = null;
    for (const j of jesters) { const u = j.userData; if (!u.pointing && u.dir && u.sw > 0.6 && u.dist > 4 && (!best || u.dist < best.userData.dist)) best = j; }
    if (!best) return false;
    const u = best.userData, from = E.camera.position.clone().addScaledVector(u.dir, u.dist);
    dropJester(best); jesters.splice(jesters.indexOf(best), 1);
    fly = { t: 0, from, s0: u.spot.size * 5, mood: u.mood, said: false };
    const fu = flyer.material.uniforms; fu.uMood.value = u.mood; fu.uFade.value = 1; fu.uT.value = Math.random() * 10;
    flyer.position.copy(from); flyer.scale.setScalar(fly.s0); flyer.quaternion.copy(E.camera.quaternion); flyer.visible = true;
    A.honk();
    return true;
  };
  const runFly = (dt) => {
    if (!fly) { flyT -= dt; if (flyT <= 0) flyT = launch() ? 0 : 0.8; return; }
    const f = fly, fu = flyer.material.uniforms; f.t += dt; fu.uT.value += dt;
    E.camera.getWorldDirection(fFwd); fTo.copy(E.camera.position).addScaledVector(fFwd, FLY.NEAR);
    flyer.quaternion.copy(E.camera.quaternion);
    const S1 = 0.62;   // life size: the face about 30 cm across
    let t = f.t;
    if (t < FLY.TEAR) {   // comes away from the wall: swells a little and starts to grin
      const k = t / FLY.TEAR; flyer.scale.setScalar(f.s0 * (1 + 0.12 * Math.sin(Math.PI * k))); fu.uMood.value = f.mood + (1 - f.mood) * k;
      return;
    }
    t -= FLY.TEAR;
    if (t < FLY.RUSH) {   // faster and faster, straight at your eyes; the size eases from the wall's to life size
      const k = t / FLY.RUSH, e = k * k * k;
      if (!f.rushing) { f.rushing = true; A.cackle(0, 1.6); }
      flyer.position.lerpVectors(f.from, fTo, e);
      flyer.scale.setScalar(Math.exp(Math.log(f.s0) + (Math.log(S1) - Math.log(f.s0)) * e));
      return;
    }
    t -= FLY.RUSH;
    if (t < FLY.HOLD) {   // a few centimetres from your eyes, trembling, shouting; the grin turns to a scowl
      if (!f.said) {
        f.said = true; cool = Math.max(cool, FLY.HOLD + FLY.BACK);
        A.noise(0.22, { g: 0.32, f: 160, q: 0.8 }); if (A.mock) A.mock(0, 1.3);
        E.panic = Math.min(1, (E.panic || 0) + 0.4);   // a start: the heart races for a few beats (panic eases each beat); no lasting fear, since you did not look for it
        say(pickLine(), 'jest', 1.6);
      }
      flyer.position.copy(fTo).add(fFwd.set(Math.sin(E.time * 53) * 0.003, Math.sin(E.time * 41 + 1) * 0.003, 0).applyQuaternion(E.camera.quaternion));
      flyer.scale.setScalar(S1); fu.uMood.value = t < FLY.HOLD * 0.5 ? 1 : Math.max(0, 1 - (t - FLY.HOLD * 0.5) * 6);
      return;
    }
    t -= FLY.HOLD;
    if (t < FLY.BACK) {   // backs off into the dark and fades
      const k = t / FLY.BACK, e = k * k * (3 - 2 * k);
      E.camera.getWorldDirection(fFwd);
      flyer.position.copy(E.camera.position).addScaledVector(fFwd, FLY.NEAR + 2.4 * e);
      flyer.scale.setScalar(S1); fu.uFade.value = 1 - e;
      return;
    }
    flyer.visible = false; fu.uFade.value = 0; fly = null; flyT = 9 + Math.random() * 7;
  };
  E.gazeAt = farPos;
  await new Promise((res) => {
    const off = on((dt, t) => {
      tt += dt; cool -= dt; spawnT -= dt;
      runFly(dt);
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
        u.dir = (u.dir || V(0, 0, 0)).copy(jd); u.dist = depth / Math.max(0.05, Math.abs(jd.z)); u.sw = sw;
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
      whisperT -= dt / (E.timeScale || 1);   // real seconds: at a developer speed-up the voices keep their own pace
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
      // eyes on the way ahead: focus builds, and the heart settles (one face's dread drains in about 10 s) and fear eases a little, never below 0.2
      if (angleTo(farPos) < 0.24) { focus += dt / 14; E.dread = Math.max(0, E.dread - dt * 0.02); if (G.fear > 0.2) G.fear = Math.max(0.2, G.fear - dt * 0.006); }
      else focus = Math.max(0, focus - dt / 90);
      if (tt > 110) focus += dt / 8;
      pu.uFocus.value = Math.min(1, focus); bar(focus);
      if (focus >= 1) { off(); res(); }
    });
  });
  flyer.visible = false;
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

// ---------- the mantis on the sill (Communion morning) ----------
// A real praying mantis, about 11 cm, outside the window. They climb up the front of the outside sill from below, out of
// sight: the hooked forelegs reach up over the edge and grip the top, the head comes up over it, then the body pivots up
// over the edge and walks on, the middle and hind feet stepping up after it, the forelegs letting go and folding, and the
// weight settles onto the legs. Everything is solved each frame, nothing keyframed: the body is a rigid frame pivoting
// round the sill's edge at a fixed clearance (so no part of it can pass into the stone), every leg is two-bone IK to a
// planted foot or a gripping hook (the hooks' paths arc over the edge), and the head is aimed at what they look at.
// Parts are placed in world space every frame (the legs have no hierarchy); the body, prothorax and head are groups.
// Sill: front face x = SF, top y = SS; the wall plane (and the glass behind it) is x = -2.5: nothing goes past SW.
const SF = -2.655, SS = 0.82, SW = -2.505, MZ = 0.15, MS = 1.25;   // the sill top stands 1 cm over the frame's bottom rail, so their feet show
function windowMantis() {
  const M = new THREE.Group();
  // green cuticle lit from behind by the morning: a rim of light at the edges, and a little light coming through
  const rimMat = (color, rim, o = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.42, side: o.side ?? THREE.FrontSide });
    const rc = new THREE.Color(rim);
    m.onBeforeCompile = (s) => {
      s.uniforms.uRim = { value: rc };
      s.fragmentShader = 'uniform vec3 uRim;\n' + s.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  { float f = 1.0 - abs(dot(normal, normalize(vViewPosition))); totalEmissiveRadiance += uRim * (0.1 + 0.9 * f * f * f); }');
    };
    m.customProgramCacheKey = () => 'mantisRim' + (o.side === THREE.DoubleSide ? 'D' : 'F');
    return m;
  };
  const body = rimMat(0x5a9a30, 0x7da83a), wingM = rimMat(0x7fb84a, 0x9ccf58, { side: THREE.DoubleSide, rough: 0.55 }), eyeM = rimMat(0x9dc65a, 0x8ab048, { rough: 0.18 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x0a0d06 });
  const mk = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
  const ell = (rx, ry, rz, w = 14, h = 10) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
  // a tapering tube along +y from 0 to L (lathe of radius r0 at the base to r1 at the end)
  const rod = (L, r0, r1, seg = 8) => new THREE.CylinderGeometry(r1, r0, L, seg, 1).translate(0, L / 2, 0);
  // body frame (x to the left side, y dorsal, z forward), origin at the thorax between the middle legs
  const bodyG = new THREE.Group(); M.add(bodyG);
  bodyG.add(mk(ell(0.0046, 0.0042, 0.0085), body, 0, 0, -0.004));                                    // meso- and metathorax
  const abd = new THREE.Group(); abd.position.set(0, 0.001, -0.006); bodyG.add(abd);
  { // abdomen: flattened spindle, tip slightly up; the folded tegmina lie over it like two leaves, a roof along the middle
    const prof = [[0.0004, 0], [0.006, 0.008], [0.0084, 0.024], [0.0078, 0.042], [0.0052, 0.056], [0.0014, 0.066], [0.0002, 0.068]].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(prof, 12); g.rotateX(-Math.PI / 2); g.scale(1, 0.62, 1);   // +y → -z (backwards)
    abd.add(mk(g, body));
    const leaf = new THREE.Shape(); leaf.moveTo(0, 0.001); leaf.quadraticCurveTo(0.0092, -0.006, 0.0088, -0.03); leaf.quadraticCurveTo(0.0082, -0.056, 0.0012, -0.066); leaf.lineTo(0, -0.064); leaf.lineTo(0, 0.001);
    const lg = new THREE.ShapeGeometry(leaf, 8); lg.rotateX(Math.PI / 2);   // shape y → -z
    for (const s of [-1, 1]) { const w = mk(s > 0 ? lg : lg.clone().scale(-1, 1, 1), wingM, 0, 0.0056, 0.001); w.rotation.z = -s * 0.22; abd.add(w); }
    // a darker vein along each wing
    for (const s of [-1, 1]) { const v = mk(rod(0.05, 0.00045, 0.0003, 5), new THREE.MeshStandardMaterial({ color: 0x4f8a2a, roughness: 0.6 }), s * 0.0052, 0.0062, -0.004); v.rotation.x = -Math.PI / 2 - 0.02; v.rotation.z = s * 0.05; abd.add(v); }
  }
  const pro = new THREE.Group(); pro.position.set(0, 0.0012, 0.004); bodyG.add(pro);
  { // the long prothorax, widening where the forelegs join, with a faint keel
    const prof = [[0.0022, 0], [0.0026, 0.006], [0.0021, 0.019], [0.0036, 0.029], [0.003, 0.034], [0.0021, 0.038]].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(prof, 10); g.rotateX(Math.PI / 2); g.scale(1, 0.85, 1);
    pro.add(mk(g, body));
  }
  const head = new THREE.Group(); head.position.set(0, 0.0004, 0.039); pro.add(head);
  // head frame: x to the left, y the crown, z the face (looks along +z): triangular, wide eyes at the top corners, mouth down
  head.add(mk(ell(0.0050, 0.0042, 0.003), body, 0, 0.0004, 0));
  const eyes = [-1, 1].map((s) => { const e = mk(ell(0.0029, 0.0037, 0.0029), eyeM, s * 0.0054, 0.0021, 0.0002); e.rotation.z = -s * 0.35; head.add(e); return e; });
  { const c = mk(new THREE.ConeGeometry(0.0026, 0.0058, 8), body, 0, -0.0043, 0.0005); c.rotation.x = Math.PI; head.add(c); }   // clypeus and mandibles
  const pupils = eyes.map(() => { const p = mk(new THREE.SphereGeometry(0.00085, 8, 6), dark); head.add(p); return p; });   // the pseudopupils
  const antM = new THREE.MeshStandardMaterial({ color: 0x6f8f3a, roughness: 0.6 });
  const ants = [-1, 1].map((s) => {
    const cv = new THREE.CatmullRomCurve3([V(s * 0.0013, 0.0034, 0.0022), V(s * 0.006, 0.014, 0.008), V(s * 0.012, 0.024, 0.006), V(s * 0.019, 0.03, -0.002)]);
    const a = new THREE.Group(); a.position.set(s * 0.0013, 0.0034, 0.0022); head.add(a);
    const m = mk(new THREE.TubeGeometry(cv, 16, 0.00042, 4), antM, -s * 0.0013, -0.0034, -0.0022); a.add(m); return a;
  });
  // legs: each bone a group whose +y runs from its joint to the next; spines on the raptorial bones face -x (the fold)
  const bone = (L, r0, r1, extra) => { const g = new THREE.Group(); g.add(mk(rod(L, r0, r1), body)); if (extra) extra(g); M.add(g); Object.assign(g.userData, { L, r0, r1 }); return g; };
  const spines = (L, n, len) => (g) => { for (let i = 0; i < n; i++) { const c = mk(new THREE.ConeGeometry(0.00035, len, 4), body, -0.0012, L * (0.25 + 0.65 * i / n), 0); c.rotation.z = Math.PI / 2 + 0.5; g.add(c); } };
  const fore = [-1, 1].map((s) => ({
    s, coxa: bone(0.016, 0.0022, 0.0018, (g) => g.add(mk(ell(0.0019, 0.0019, 0.0019, 8, 6), body, 0, 0.016, 0))),
    fem: bone(0.022, 0.0027, 0.0016, (g) => { g.children[0].scale.x = 0.7; spines(0.022, 7, 0.0026)(g); }),
    tib: bone(0.011, 0.0014, 0.0009, (g) => { spines(0.011, 3, 0.0016)(g); const h = mk(new THREE.ConeGeometry(0.0008, 0.0036, 5), body, -0.0006, 0.0122, 0); h.rotation.z = 0.9; g.add(h); }),
  }));
  const walk = [[-1, 'm'], [1, 'm'], [-1, 'h'], [1, 'h']].map(([s, k]) => ({
    s, k, fem: bone(k === 'm' ? 0.017 : 0.021, 0.0011, 0.0009), tib: bone(k === 'm' ? 0.022 : 0.027, 0.0008, 0.0005, (g) => g.add(mk(ell(0.0009, 0.0009, 0.0009, 6, 4), body, 0, g.userData?.L || 0, 0))),
    foot: V(), from: V(), to: V(), surf: 'face', step: null,
  }));
  walk.forEach((w) => { w.tib.children[1].position.y = w.tib.userData.L; });
  return { M, bodyG, abd, pro, head, eyes, pupils, ants, fore, walk };
}

// Pose the mantis at climb time t (seconds; the climb runs 0..7.2 and then holds). Returns a log of clearances.
const _m = { T: V(), f: V(), u: V(), r: V(), a: V(), b: V(), k: V(), p: V(), d: V(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), mx: new THREE.Matrix4(), x: V(), y: V(), z: V() };
const smt = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// body frame at time t: theta (0 on the face heading up, PI/2 on top heading in), sigma (where along the body the edge is),
// c (how far the body's axis rides off the surface), alpha (the prothorax raised), lift (abdomen)
function mantisFrame(t) {
  const th = Math.PI / 2 * smt(3.1, 5.0, t);
  const sg = lerp(lerp(lerp(0.066, 0.062, smt(0, 1.8, t)), 0.034, smt(1.8, 3.1, t)), -0.045, smt(3.5, 5.7, t));
  const land = t > 5.5 ? -0.0019 * Math.exp(-(t - 5.5) * 3.2) * Math.sin((t - 5.5) * 9) : 0;   // the weight comes down onto the legs and settles
  const c = 0.0105 + 0.001 * smt(3.1, 4.2, t) * (1 - smt(4.8, 5.5, t)) + land;
  const alpha = lerp(lerp(lerp(0.12, 0.42, smt(1.8, 2.9, t)), 0.12, smt(3.1, 4.4, t)), 0.85, smt(5.3, 6.8, t));   // at the end reared up, forelegs held high
  const lift = 0.1 * smt(3.4, 4.4, t) * (1 - smt(4.6, 5.6, t)) + 0.1 * smt(5.6, 6.8, t) - 0.04 * Math.sin(Math.PI * smt(5.5, 6.3, t));
  return { th, sg, c, alpha, lift };
}
function poseMantis(m, t, lookAt, out) {
  const { T, f, u, r } = _m, F = mantisFrame(t);
  f.set(Math.sin(F.th), Math.cos(F.th), 0); u.set(-Math.cos(F.th), Math.sin(F.th), 0); r.set(0, 0, -1);   // r = u x f (right-handed: with y up and z forward, x is the left side)
  T.set(SF, SS, MZ).addScaledVector(u, F.c).addScaledVector(f, -F.sg);
  // the sway (a mantis rocks like a leaf in the wind), once settled
  const sw = smt(6.2, 7.4, t); T.z += sw * 0.0016 * Math.sin(t * 2 * Math.PI * 0.9) ; T.y += sw * 0.0004 * Math.sin(t * 2 * Math.PI * 1.8);
  _m.mx.makeBasis(r, u, f); m.bodyG.quaternion.setFromRotationMatrix(_m.mx); m.bodyG.position.copy(T);
  m.pro.rotation.x = -F.alpha; m.abd.rotation.x = F.lift;
  m.M.updateMatrixWorld(true);
  // head: aimed at what they look at, crown kept toward the body's up, then turned in its own frame
  { const hp = m.head.getWorldPosition(_m.a), z = _m.z.subVectors(lookAt, hp).normalize(), x = _m.x.crossVectors(_m.y.copy(u).lerp(V(0, 1, 0), 0.5), z).normalize(), y = _m.y.crossVectors(z, x);
    _m.mx.makeBasis(x, y, z); _m.q.setFromRotationMatrix(_m.mx); m.head.parent.getWorldQuaternion(_m.q2).invert(); m.head.quaternion.copy(_m.q2.multiply(_m.q)); }
  // antennae: a slow sweep, faster while they climb
  m.ants.forEach((a, i) => { a.rotation.set(0.25 * Math.sin(t * 2.3 + i * 1.7) + 0.15 * smt(1.8, 2.6, t), 0.2 * Math.sin(t * 1.3 + i), 0); });
  m.M.updateMatrixWorld(true);
  return F;
}

// two-bone IK in world space: from joint A to target P with lengths L1, L2, the knee bent toward pole; returns the knee in K
function ik2(A, P, L1, L2, pole, K) {
  const d = _m.d.subVectors(P, A); let D = d.length(); d.divideScalar(D || 1);
  D = Math.min(Math.max(D, Math.abs(L1 - L2) + 1e-5), L1 + L2 - 1e-5);
  const ca = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const pp = _m.p.copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
  return K.copy(A).addScaledVector(d, L1 * ca).addScaledVector(pp, L1 * sa);
}
// Two-bone IK that keeps the leg out of the sill: the knee is swung round the hip-to-foot line (the pole turned about it)
// to the nearest angle, from where it was last frame, at which no sampled point of femur or tibia (its last 15 cm short
// of the foot or hook, which rest on the stone) is inside the stone; it relaxes back toward the plain pole when that is
// clear. Works in the mantis group's own frame, against the sill as it is there (the group is scaled about the edge).
const DLO = new THREE.Vector3(SF, SS - (SS - 0.6) / MS, MZ - (MZ + 0.35) / MS), DHI = new THREE.Vector3(SF + (-2.49 - SF) / MS, SS, MZ + (1.15 - MZ) / MS);
const _c = { q: new THREE.Quaternion(), pr: V(), d: V(), p: V(), tip: V() };
function legClear(A, K, tip, r0, r1) {
  let m = 9; const p = _c.p;
  for (let i = 0; i <= 6; i++) {   // femur
    p.lerpVectors(A, K, i / 6);
    const cx = Math.max(DLO.x - p.x, 0, p.x - DHI.x), cy = Math.max(DLO.y - p.y, 0, p.y - DHI.y), cz = Math.max(DLO.z - p.z, 0, p.z - DHI.z);
    m = Math.min(m, Math.hypot(cx, cy, cz) - r0);
  }
  for (let i = 0; i <= 5; i++) {   // tibia, short of the foot
    p.lerpVectors(K, tip, 0.85 * i / 5);
    const cx = Math.max(DLO.x - p.x, 0, p.x - DHI.x), cy = Math.max(DLO.y - p.y, 0, p.y - DHI.y), cz = Math.max(DLO.z - p.z, 0, p.z - DHI.z);
    m = Math.min(m, Math.hypot(cx, cy, cz) - r1);
  }
  return m;
}
function ikClear(leg, A, P, L1, L2, pole, K) {
  const d = _c.d.subVectors(P, A).normalize();
  const tryA = (a) => {
    _c.q.setFromAxisAngle(d, a); ik2(A, P, L1, L2, _c.pr.copy(pole).applyQuaternion(_c.q), K);
    _c.tip.subVectors(P, K).normalize().multiplyScalar(L2).add(K);
    return legClear(A, K, _c.tip, L1 * 0.13, L2 * 0.1) >= 0.0003;
  };
  const a0 = leg.ang || 0, rel = a0 - Math.sign(a0) * Math.min(Math.abs(a0), 0.05);
  let a = null;
  if (tryA(rel)) a = rel; else if (tryA(a0)) a = a0;
  else for (let i = 1; i <= 26 && a === null; i++) for (const sg of [1, -1]) { if (tryA(a0 + sg * i * 0.1)) { a = a0 + sg * i * 0.1; break; } }
  leg.ang = a === null ? a0 : a; tryA(leg.ang);
  return K;
}
// lay a bone from a toward b; its -x (spine side) turned away from `side`
function layBone(g, a, b, side) {
  const y = _m.y.subVectors(b, a).normalize(), x = _m.x.copy(side).addScaledVector(y, -side.dot(y)).normalize(), z = _m.z.crossVectors(x, y);
  _m.mx.makeBasis(x, y, z); g.quaternion.setFromRotationMatrix(_m.mx); g.position.copy(a);
}

// the body frame at time t without the sway, into T, f, u, r (for predicting where a stepping foot should land)
function mantisBasis(t, T, f, u, r) {
  const F = mantisFrame(t);
  f.set(Math.sin(F.th), Math.cos(F.th), 0); u.set(-Math.cos(F.th), Math.sin(F.th), 0); r.set(0, 0, -1);   // r = u x f (right-handed: with y up and z forward, x is the left side)
  return T.set(SF, SS, MZ).addScaledVector(u, F.c).addScaledVector(f, -F.sg);
}
// stance spots (body frame: right, forward) for the middle and hind feet; the step schedule: [start, end, surface] per leg
const STANCE = { m: [0.022, 0.009], h: [0.025, -0.03] };
const STEPS = [
  [[2.3, 2.7, 'face'], [3.7, 4.2, 'top'], [5.95, 6.25, 'top']],   // middle left
  [[2.5, 2.9, 'face'], [3.85, 4.35, 'top'], [6.1, 6.4, 'top']],   // middle right
  [[1.9, 2.3, 'face'], [3.3, 3.65, 'face'], [4.2, 4.75, 'top'], [5.75, 6.05, 'top']],   // hind left
  [[2.1, 2.5, 'face'], [3.45, 3.8, 'face'], [4.4, 4.95, 'top'], [5.85, 6.15, 'top']],   // hind right
];
const _w = { T: V(), f: V(), u: V(), r: V(), A: V(), E: V(), K: V(), P: V(), C: V(), G: V(), pole: V(), s: V(), fold: V(), cd: V(), cdF: V(), fdF: V(), poleF: V(), tg: V(), cg: V(), n: V() };
const spot = (w, t, out) => {   // where this foot should stand on its surface, for the body as it will be at t
  const { T, f, u, r } = _w, st = STANCE[w.k]; mantisBasis(t, T, f, u, r);
  out.copy(T).addScaledVector(r, w.s * st[0]).addScaledVector(f, st[1]);
  if (w.surf === 'top') { out.y = SS + 0.0009; out.x = Math.max(out.x, SF + 0.004); } else { out.x = SF - 0.0009; out.y = Math.min(out.y, SS - 0.004); }   // on the foot's pad
  return out;
};
const bez2 = (a, c, b, e, out) => out.copy(a).multiplyScalar((1 - e) * (1 - e)).addScaledVector(c, 2 * e * (1 - e)).addScaledVector(b, e * e);
const UPOUT = new THREE.Vector3(-0.35, 1, 0).normalize(), OUTUP = new THREE.Vector3(-1, 0.8, 0).normalize(), FACE_N = new THREE.Vector3(-1, 0, 0), TOP_N = new THREE.Vector3(0, 1, 0);
// legs at climb time t (after poseMantis): returns how many feet or hooks touched down or lifted this frame (for the sound)
function legsMantis(m, t, prevT) {
  let taps = 0;
  // joints in the mantis group's own frame (the group is scaled about the sill edge; the legs are laid in that frame)
  const pv = (p, x, y, z) => m.M.worldToLocal(m.pro.localToWorld(p.set(x, y, z))), bv = (p, x, y, z) => m.M.worldToLocal(m.bodyG.localToWorld(p.set(x, y, z)));
  const proQ = m.pro.getWorldQuaternion(_m.q2);
  // forelegs: folded (praying), reaching over the edge to hook the sill top, then letting go and folding again
  for (const L of m.fore) {
    const s = L.s, J = pv(_w.A, s * 0.0032, -0.0022, 0.029);
    // folded: while on the face, held up off it (coxae forward, femurs up and out); once up on the sill, the praying pose
    // (coxae hanging, femurs along the raised prothorax, tibiae closed back on them)
    const pk = smt(6.0, 6.9, t);   // (once the prothorax is up, so the hanging coxae clear the stone)
    const cdF = _w.cdF.set(s * lerp(0.18, 0.15, pk), lerp(-0.6, -0.9, pk), lerp(0.78, 0.05, pk)).normalize().applyQuaternion(proQ), fdF = _w.fdF.set(s * 0.05, lerp(0.78, -0.05, pk), lerp(0.62, 1, pk)).normalize().applyQuaternion(proQ);
    const poleF = _w.poleF.set(0, 0.4, 1).normalize().applyQuaternion(proQ);
    const G = _w.G.set(SF + 0.004, SS + 0.0011, MZ - s * 0.0075);   // hooked over the edge (body x is world -z)
    // the hooks let go as the body tips over the edge and the middle feet come up (later, the body would be over them)
    const r0 = s < 0 ? 0.15 : 0.5, r1 = r0 + 1.1, l0 = s < 0 ? 3.6 : 3.72, l1 = l0 + 0.6;
    const reach = smt(r0, r1, t), let_ = smt(l0, l1, t), w = reach * (1 - let_);   // w: how far the leg is set for gripping
    if ((prevT < r1 && t >= r1) || (prevT < l0 && t >= l0)) taps++;
    // gripping, the coxa is the third bone of the reach: turned between pointing at the hook's spot and out-and-up off the
    // face, to the angle that leaves femur and tibia a comfortable bend to it (a straight or fully closed leg would have
    // to let go, or push the hook through the stone)
    const toG = _w.tg.subVectors(G, J).normalize(), Lc = L.coxa.userData.L, Dt = 0.024;
    const dist = (b) => _w.cg.copy(toG).lerp(OUTUP, b).normalize().multiplyScalar(Lc).add(J).distanceTo(G);
    let lo = 0, hi = 1; if (dist(0) >= Dt) hi = 0; else if (dist(1) <= Dt) lo = 1; else for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (dist(mid) < Dt) lo = mid; else hi = mid; }
    _w.cg.copy(toG).lerp(OUTUP, (lo + hi) / 2).normalize();
    const cd = _w.cd.copy(cdF).lerp(_w.cg, w).normalize();
    const Ec = _w.E.copy(J).addScaledVector(cd, L.coxa.userData.L);
    // folded: the tibia closed back along the femur's spines (not shut tight: a fully closed leg is a singular pose for the IK)
    const fold = _w.fold.copy(Ec).addScaledVector(fdF, 0.0125).addScaledVector(poleF, 0.0025).add(_w.s.set(-s * 0.001, 0, 0).applyQuaternion(proQ));
    const P = _w.P;
    if (t < l0) {   // up in front of the face, over the edge, and down onto the top from straight above
      const A1 = _w.cg.set(G.x, SS + 0.011, G.z);
      if (reach < 0.78) bez2(fold, _w.C.set(SF - 0.007, SS + 0.022, G.z), A1, reach / 0.78, P); else P.lerpVectors(A1, G, smt(0.78, 1, reach));
    }
    else bez2(G, _w.C.copy(G).add(_w.s.set(0.004, 0.016, 0)), fold, let_, P);             // lifted off and drawn back in under the head
    // the knee bends in the leg's own up-and-down plane: the pole is square to the hip-to-hook line and the body's side
    // axis, so it never lines up with the leg and flips the knee over (a blend between two poles did, at the start of the reach)
    const pole = _w.pole.subVectors(P, Ec).normalize().cross(_m.r).normalize();
    const K = ikClear(L, Ec, P, L.fem.userData.L, L.tib.userData.L, pole, _w.K);
    layBone(L.coxa, J, Ec, pole); layBone(L.fem, Ec, K, pole);
    const tip = _w.s.subVectors(P, K).normalize().multiplyScalar(L.tib.userData.L).add(K); layBone(L.tib, K, tip, pole);
    L.tip = (L.tip || V()).copy(tip); L.knee = (L.knee || V()).copy(K); L.hook = w;
  }
  // middle and hind legs: planted feet, stepping on the schedule; two-bone IK, knees up and out
  m.walk.forEach((w, i) => {
    if (!w.init) { w.surf = 'face'; spot(w, 0, w.foot); w.init = true; }
    let stepping = false;
    for (const [a, b, surf] of STEPS[i]) {
      if (prevT < a && t >= a) { w.from.copy(w.foot); w.surf = surf; spot(w, b, w.to); }
      if (t >= a && t < b) {
        stepping = true; const e = smt(a, b, t), C = _w.C.lerpVectors(w.from, w.to, 0.5);
        if (w.from.x < SF + 0.001 && w.to.y > SS) {   // off the face onto the top: out from the face, up past the edge, over and down
          const Q = _w.s.set(SF - 0.005, SS + 0.009, (w.from.z + w.to.z) / 2);
          if (e < 0.5) bez2(w.from, C.set(SF - 0.008, (w.from.y + Q.y) / 2, w.from.z), Q, e * 2, w.foot); else bez2(Q, C.set(w.to.x, SS + 0.011, w.to.z), w.to, e * 2 - 1, w.foot);
        } else { if (w.to.y > SS) C.y += 0.008; else C.x -= 0.008; bez2(w.from, C, w.to, e, w.foot); }
      }
      if (prevT < b && t >= b) { w.foot.copy(w.to); taps++; }
    }
    const A = bv(_w.A, w.s * (w.k === 'm' ? 0.0042 : 0.0045), -0.003, w.k === 'm' ? -0.002 : -0.012);
    const n = _w.n.lerpVectors(FACE_N, TOP_N, smt(SS - 0.03, SS + 0.01, w.foot.y));   // the surface under the foot, blended round the edge
    const pole = _w.pole.copy(_m.u).multiplyScalar(0.6).addScaledVector(n, 0.8).addScaledVector(_m.r, w.s * 0.6).normalize();
    const K = ikClear(w, A, w.foot, w.fem.userData.L, w.tib.userData.L, pole, _w.K);
    layBone(w.fem, A, K, pole);
    const tip = _w.s.subVectors(w.foot, K).normalize().multiplyScalar(w.tib.userData.L).add(K); layBone(w.tib, K, tip, pole);
    w.tip = (w.tip || V()).copy(tip); w.knee = (w.knee || V()).copy(K); w.stepping = stepping;
  });
  return taps;
}
// For the check: the least distance from any sampled point of a leg, the body, head or antennae to the sill (negative:
// inside it), the furthest any point gets toward the glass (x), the hooks' height over the sill top while gripping (mm),
// and each foot's gap to the surface it stands on (mm)
const SILL_LO = new THREE.Vector3(SF, 0.6, -0.35), SILL_HI = new THREE.Vector3(-2.49, SS, 1.15);
function sillDist(p) {
  const lo = SILL_LO, hi = SILL_HI, cx = Math.max(lo.x - p.x, 0, p.x - hi.x), cy = Math.max(lo.y - p.y, 0, p.y - hi.y), cz = Math.max(lo.z - p.z, 0, p.z - hi.z);
  const out = Math.hypot(cx, cy, cz); if (out > 0) return out;
  return -Math.min(p.x - lo.x, hi.x - p.x, p.y - lo.y, hi.y - p.y, p.z - lo.z, hi.z - p.z);
}
function measureMantis(m) {
  let min = 9, at = '', maxX = -9; const p = V(), a = V(), b = V();
  const test = (name, q, rad = 0) => { const d = sillDist(q) - rad; if (d < min) { min = d; at = name; } maxX = Math.max(maxX, q.x + rad); };
  const segs = [];
  m.fore.forEach((L) => [L.coxa, L.fem, L.tib].forEach((g, j) => segs.push(['fore' + L.s + ['coxa', 'femur', 'tibia'][j], g])));
  m.walk.forEach((w) => [w.fem, w.tib].forEach((g, j) => segs.push([w.k + w.s + ['femur', 'tibia'][j], g])));
  for (const [name, g] of segs) {   // each bone as a tapering rod (world radius), its end with the pad or hook on it
    g.getWorldPosition(a); g.localToWorld(b.set(0, g.userData.L, 0));
    for (let i = 0; i <= 8; i++) test(name, p.lerpVectors(a, b, i / 8), MS * lerp(g.userData.r0, g.userData.r1, i / 8));
  }
  for (let z = -0.074; z <= 0.006; z += 0.004) for (const [x, y] of [[0, -0.0058], [0.0085, 0], [-0.0085, 0], [0, 0.0075]]) test('body', m.bodyG.localToWorld(p.set(x * (z < -0.006 ? 1 : 0.55), y, z)));
  for (let z = 0; z <= 0.044; z += 0.004) for (const [x, y] of [[0, -0.004], [0.004, 0], [-0.004, 0], [0, 0.004]]) test('pro', m.pro.localToWorld(p.set(x, y, z)));
  for (const [x, y, z] of [[0, 0.007, 0], [0.009, 0.003, 0], [-0.009, 0.003, 0], [0, -0.008, 0.002], [0, 0, 0.004], [0.019, 0.03, -0.002], [-0.019, 0.03, -0.002]]) test('head', m.head.localToWorld(p.set(x, y, z)));
  const hooks = m.fore.map((L) => (L.hook > 0.98 ? +((L.tip.y - SS) * 1000).toFixed(2) : null));
  const feet = m.walk.map((w) => (w.stepping ? null : +((w.surf === 'top' ? w.tip.y - SS : SF - w.tip.x) * 1000).toFixed(2)));
  return { min, at, maxX, hooks, feet, knees: [...m.fore.map((L) => L.knee.clone()), ...m.walk.map((w) => w.knee.clone())] };
}

// ---------- waking ----------
const ENDS = {
  missing: { title: 'MISSING TIME', text: "You fought, and they switched you off. Whatever happened next, you were there for it. You just don't get to keep it.", echo: 'Echoes Budd Hopkins and David Jacobs: resistance fails, and the price is memory. To see more of the night, try not fighting.' },
  communion: { title: 'COMMUNION', text: 'You did not fight, you met them halfway, and you were allowed to keep the night. Whether they are teachers is still your guess.', echo: 'Echoes John Mack and Whitley Strieber: terrifying, and transforming. About 70% of surveyed experiencers say contact changed their life for the better.' },
  wardens: { title: 'THE WARDENS', text: 'They told you what you already believed, and when you asked for more they put you back. Something is further in. They would rather you did not look.', echo: 'Echoes Karla Turner and the prison-planet community. It is one reading among several, and no better proven than the others.' },
  phone: { title: 'HANG UP THE PHONE', text: 'You got the message. It was the one you had always suspected, which is either the proof or the problem.', echo: 'Echoes a DMT trip from 2023: the answer was the one the author already suspected.' },
  sceptic: { title: 'SCEPTICISM', text: 'By morning most of it is gone, and what is left has an explanation. Most of it.', echo: 'Echoes Susan Clancy and Chris French on sleep paralysis, and the experiencers who answer them with marks on the body. Staying calm and holding the stare lets you keep more of the night.' },
};

export async function ending(kind) {
  E.heart = false; G.fear = kind === 'missing' ? 0.3 : 0.1;
  const day = kind === 'communion' || kind === 'sceptic';
  const R = buildBedroom(day
    // morning: a low sun through the window (warm patches with the frame's and curtains' soft shadows, models.js moonify),
    // its warm bounce, and a cooler fill from the sky that falls off across the room
    // (the fill is a clear sky blue, only gently uneven: a bright room, not a dim one with a patch in it)
    ? { clock: kind === 'communion' ? '8:08' : '7:12', ambient: kind === 'communion' ? 2.3 : 2.4, ambColor: kind === 'communion' ? 0xcfdcff : 0xdde6f6, moon: 0, window: kind === 'communion' ? 0xffeccc : 0xeaf2fa, wall: kind === 'communion' ? 0x9a8f96 : 0x8f8a96,
      sun: kind === 'communion' ? 0xffb874 : 0xffe2c0, sunK: kind === 'communion' ? 22 : 16, ambK: 0.35, bounce: kind === 'communion' ? 0.3 : 0.2, spill: kind === 'communion' ? 0xffc890 : 0xfff0e0 }
    : { clock: kind === 'missing' ? '4:14' : '3:00', ambient: kind === 'missing' ? 0.95 : undefined }); // a touch more room light so the hand reads
  E.scene.add(R.group);
  if (day) { const s = new THREE.DirectionalLight(kind === 'communion' ? 0xffd8a8 : 0xfff4e6, 1.5); s.position.set(-4, 1.8, 0.6); R.group.add(s); }   // daylight from the window side (no shadows)
  // Communion: the stone sill outside the window, and the mantis waiting below its edge, out of sight from the bed (built
  // now, so their materials compile while the screen is black). Only the sill's top edge shows from the bed.
  let wm = null, mt = -1;
  if (kind === 'communion') {
    const sill = new THREE.Mesh(new THREE.BoxGeometry(SILL_HI.x - SILL_LO.x, SILL_HI.y - SILL_LO.y, SILL_HI.z - SILL_LO.z), new THREE.MeshStandardMaterial({ color: 0xcdc6b6, roughness: 0.85 }));
    sill.position.addVectors(SILL_LO, SILL_HI).multiplyScalar(0.5); R.group.add(sill);
    wm = windowMantis(); R.group.add(wm.M);
    wm.M.scale.setScalar(MS); wm.M.position.set(SF, SS, MZ).multiplyScalar(1 - MS);   // a big one (14 cm), scaled about the sill's edge so every contact holds
    poseMantis(wm, 0, V(SF - 0.02, SS + 0.09, MZ)); legsMantis(wm, 0, -1);
    wm.M.userData.measure = () => measureMantis(wm); wm.M.userData.clock = () => mt; wm.M.userData.rig = wm;   // for the headless checks
  }
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
  // Sitting up from the pillow (the endings that face down the bed): the eyes ride an arc round the hips (the chin tucks
  // first, so the view tips down early), the body's torso turns up with them (makePlayerBody riseTo: its eyes stay on the
  // camera, so the chest is below the view as when standing and never seen from outside, headless), and the covers slide a
  // little toward the lap. The lying view sits 12 cm over the body's eyes; that gap closes over the rise. Afterwards the
  // torso keeps following the eyes (the sceptic morning leans in), and the look is held to riseLimits() narrowed to `yaw`
  // (so the view never turns into the open collar). Leaves E.mode 'locked'.
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const bu = bed.userData, eyeT = V();
  let rising = false;
  // headQ: the sceptic reach holds the head still while its arm is solved in the torso's frame (null: the view's own turn)
  let headQ = null;
  on(() => { if (rising) bu.riseTo(E.camera.position, null, headQ || E.camera.quaternion); });
  const sitUp = async (dur, to, pitch, yaw = 1.4) => {
    E.limits = null; E.mode = 'locked';
    A.rustle(dur * 0.8, 0.9);   // the covers slide as you come up off the pillow
    const hip = bed.localToWorld(bu.legs.position.clone());
    const p0 = E.camera.position.clone(), pi0 = E.pitch, bz = R.blanket.position.z, off = bed.localToWorld(V(0, 0, 0)).sub(p0);
    const el = (p) => Math.atan2(p.y - hip.y, Math.hypot(p.x - hip.x, p.z - hip.z));
    const a0 = el(p0), a1 = el(to), r0 = p0.distanceTo(hip), r1 = to.distanceTo(hip);
    const h0 = V(p0.x - hip.x, 0, p0.z - hip.z).normalize(), h1 = V(to.x - hip.x, 0, to.z - hip.z).normalize(), h = V();
    await tween(dur, (k) => {
      const e = k * k * (3 - 2 * k), a = lerp(a0, a1, e), r = lerp(r0, r1, e);
      h.lerpVectors(h0, h1, e).normalize();
      E.camera.position.copy(hip).addScaledVector(h, r * Math.cos(a)); E.camera.position.y += r * Math.sin(a);
      E.pitch = lerp(pi0, pitch, sm(0, 0.85, k));
      bu.riseTo(eyeT.copy(E.camera.position).addScaledVector(off, 1 - e), null, E.camera.quaternion, e);
      R.blanket.position.z = bz + 0.08 * e * Math.sign(hip.z - p0.z);   // toward the lap (the 'missing' bed is end for end)
    }, (k) => k);
    rising = true;
    const rl = bu.riseLimits(E.yaw);
    E.base.yaw = rl.base.yaw; E.base.pitch = rl.base.pitch; E.limits = { ...rl.limits, yaw: Math.min(yaw, rl.limits.yaw) };
  };
  // the Wardens wake to the seam still in the wall: it is there as the room fades in, not switched on afterwards
  if (kind === 'wardens') { R.portal.visible = true; R.portal.children[1].visible = false; R.portal.children[0].material.transparent = true; R.portal.children[0].material.opacity = 0.35; R.portalLight.intensity = 6; }
  await fade(0, 3);

  if (kind === 'missing') {
    await say('4:14.');
    note('missingtime');
    await say('You remember the clock saying 3:00. Then this.');
    await say('You are lying the wrong way round in your own bed. Your shirt is on backwards.'); note('wrongway');
    await sitUp(2.8, V(0, 1.34, -0.65), -0.12, 0.9); E.mode = 'look';   // up off the pillow at the foot of the bed; the look held near the raised hand (its arm is carried with the view)
    const me = makePlayerBody(); me.userData.torso.children[0].visible = false; me.userData.legs.visible = false; me.userData.armL.visible = false; me.userData.marks.visible = true;
    E.camera.add(me);   // lit only by the room
    bed.userData.armR.visible = false;   // the right arm that rises is the one carried with the view
    // the hand comes up palm first, turns over, curls and opens, and stays up; the caption lands as the back turns to you
    let told = false;
    await tween(4.75, (q) => { const k = q * 0.79; me.userData.examineHand(k); if (!told && k > 0.5) { told = true; say('On the back of your hand, by the thumb: three small marks in a triangle.'); note('marks'); } }, (k) => k);
    await wait(3.2);   // the hand stays up, still being stared at, as the night ends
  } else if (kind === 'communion') {
    await say('Morning. You remember all of it.');
    await say('There\'s a feeling of interconnectedness with everything that exists. The room, the street, every living thing, the whole sky: one thing, and you are it.');
    await say('When you hurt someone, you hurt yourself. When you love someone, you love yourself.');
    if (G.toy) await say("The toy is not in your hand. You knew it wouldn't be.");
    hint('Look at the window.');
    await until(() => lookingAt(V(-2.5, 1.2, 0.4), 0.45), 20);
    hint('');
    // They climb up onto the sill from below while you watch (windowMantis). The eyes go to the
    // sill's edge and then stay on their head, and the view narrows on them as it would on anything that small; it lets go
    // once they have looked at you.
    const lim = E.limits; E.limits = null; E.mode = 'locked';
    const fov0 = E.camera.fov, aimP = V(SF + 0.01, SS + 0.012, MZ), hp = V(), y0 = E.yaw, p0 = E.pitch, cp = E.camera.position;
    const up = V(SF - 0.02, SS + 0.09, MZ), over = V(SF + 0.3, SS + 0.03, MZ - 0.03), lookP = V(), pl = V();
    let ck = 0, prevT = 0;
    // the mantis: posed every frame from the climb clock; their pseudopupils (the dark spots in a mantis's eyes) are wherever
    // the eye looks straight back at you, so they follow you; feet and hooks tick on the stone
    on((dt) => {
      if (mt < 0) return;
      prevT = mt; mt += dt;
      lookP.lerpVectors(up, over, smt(2.2, 3.0, mt)).lerp(cp, smt(6.3, 7.3, mt));
      poseMantis(wm, mt, lookP); wm.head.rotateZ(0.22 * smt(7.8, 8.6, mt));   // and a slow tilt of the head, once they have you
      const taps = legsMantis(wm, mt, prevT);
      wm.M.updateMatrixWorld(true);
      wm.eyes.forEach((e, i) => { wm.head.worldToLocal(pl.copy(cp)).sub(e.position).normalize(); wm.pupils[i].position.copy(e.position).addScaledVector(pl, 0.0027); });
      if (taps) A.mantisSill(mt < 2 ? 'hook' : 'step', 2.5);
      if (prevT < 5.55 && mt >= 5.55) A.mantisSill('settle', 2.5);
    });
    const look = on((dt) => {
      ck = Math.min(1, ck + dt / 1.4);
      if (mt > 2.0) { wm.head.getWorldPosition(hp); aimP.lerp(hp, Math.min(1, dt * 1.6)); }   // the edge, then their head once it shows
      const d = pl.subVectors(aimP, cp).normalize(), yw = Math.atan2(-d.x, -d.z), e = smt(0, 1, ck);
      E.yaw = y0 + Math.atan2(Math.sin(yw - y0), Math.cos(yw - y0)) * e; E.pitch = lerp(p0, Math.asin(d.y), e);
    });
    mt = 0;
    tween(3, (k) => { E.camera.fov = lerp(fov0, 14, k); E.camera.updateProjectionMatrix(); });
    await until(() => mt >= 6.4, 30);
    note('realmantis');
    await say('On the sill outside the window, a small green mantis. They turn their head, and look in at you.');
    await say('You are not afraid of them. You are not sure you are afraid of anything.');
    look();
    await tween(2.4, (k) => { E.camera.fov = lerp(14, fov0, k); E.camera.updateProjectionMatrix(); });
    E.limits = lim; E.mode = 'look';
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
    E.limits = null;
    bed.userData.armR.visible = false;   // the lying body's right arm; the one that reaches is this one
    // the head is held where it is while this arm works, so the sitting torso (and the arm's shoulder on it) stays put
    const hq0 = E.camera.quaternion.clone(); headQ = hq0.clone();
    const me = makePlayerBody(), mu = me.userData, hr = mu.handRigR;
    mu.torso.children[0].visible = false; mu.legs.visible = false; mu.armL.visible = false;
    // in the sitting torso's frame, so the arm leaves from its shoulder, and carried with it when the body leans in
    const toTorso = () => { bu.torso.getWorldPosition(me.position); bu.torso.getWorldQuaternion(me.quaternion); };
    toTorso(); R.group.add(me);
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
      const m = sm(0.1, 1, q);
      E.camera.position.lerpVectors(p1, lean, m); look.lerpVectors(L1, mw, m);
      headQ.slerpQuaternions(hq0, E.camera.quaternion, sm(0, 0.6, q)); bu.riseTo(E.camera.position, null, headQ);   // the head comes free as the arm drops
      if (q < 0.6) { toTorso(); pose(bez(Wd, C2, W0, d, Wt), Qt.slerpQuaternions(Qh, Q0, d), 1 - sm(0.1, 0.6, q), 1 - g2); }
      else if (me.parent) discard(me);   // down by the hip, out of sight (discard frees its bone texture)
    }, (k) => k);
    headQ = null;
    aim(); { const rl = bu.riseLimits(E.yaw); E.base.yaw = rl.base.yaw; E.base.pitch = rl.base.pitch; E.limits = rl.limits; }   // the look held to the leaning torso
    await say('You pull back the sheet. On your shin, a small scooped mark that was not there yesterday.'); note('marks');
    await wait(1.5);
  }
  await wait(1);
  tone.stop(2);
  await fade(1, 2.2);
  const e = ENDS[kind];
  $('endTitle').textContent = tr(e.title); $('endText').textContent = tr(e.text); $('endEcho').textContent = tr(e.echo);
  $('endNotes').textContent = tr('Field notes found: ' + noteCount() + '.');
  $('endcard').style.display = 'block';
  if (document.pointerLockElement) document.exitPointerLock();
  $('endNotesBtn').onclick = () => toggleNotes(true);
  await new Promise((res) => { $('againBtn').onclick = res; });
  $('endcard').style.display = 'none';
  resetNight(); resetShip();
  return 'bedroom';
}
