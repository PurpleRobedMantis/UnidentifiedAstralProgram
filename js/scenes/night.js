// Acts 1-3: the bedroom at 3:00, the passage through the wall, the white room.
import { THREE, lookToward, E, G, $, on, wait, until, tween, lerp, say, prompt, hint, bar, fade, note, nights,
  setView, moveView, lookingAt, angleTo, aimAt, clearScene, discard, warm, t as tr } from '../engine.js';
import { A } from '../audio.js';
import { T, buildBedroom, makeGrey, stepGrey, makeMantis, idleMantis, makeHuman, makePlayerBody, aimGrey, idleGrey, holdGrey, gripGrey, pointGrey, makeWand, clearGreyArm, greyArmHits, GREY_GAIT, heldSegment } from '../models.js';
import { loadClip, poseClip } from '../clips.js';
import PUTDOWN from '../clips/grey-putdown.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const GRIP_K = 1; // a grey's fingers fully closed round the wand
const wandAim = new THREE.Vector3(); // the wand points at your chin, so from your eyes its shaft still shows

// ---------- shader kit ----------
// Colours in these shaders are display (sRGB) values: ShaderMaterial output is not converted.
const dcol = (hex) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);
const TIME = { value: 0 };
const FOGU = { uFogC: { value: new THREE.Color(0) }, uFogN: { value: 1e6 }, uFogF: { value: 2e6 } };
// call once per scene, after the scene's fog is set (on() callbacks are cleared with the scene)
function shaderScene() {
  const f = E.scene.fog;
  FOGU.uFogC.value = f ? f.color : new THREE.Color(0);
  FOGU.uFogN.value = f ? f.near : 1e6; FOGU.uFogF.value = f ? f.far : 2e6;
  on((dt, t) => { TIME.value = t; });
}
const VERT = `
varying vec2 vUv; varying vec3 vPos; varying vec3 vWorld; varying vec3 vNormal; varying float vDepth;
uniform float uTime;
void main() {
  vUv = uv; vPos = position;
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
#endif
  vec4 w = m * vec4(position, 1.0);
  //DISPLACE
  vWorld = w.xyz;
  vNormal = normalize((m * vec4(normal, 0.0)).xyz);
  vec4 mv = viewMatrix * w;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const HEAD = `
varying vec2 vUv; varying vec3 vPos; varying vec3 vWorld; varying vec3 vNormal; varying float vDepth;
uniform float uTime; uniform vec3 uFogC; uniform float uFogN; uniform float uFogF;
vec3 fogit(vec3 c) { return mix(c, pow(uFogC, vec3(0.4545)), smoothstep(uFogN, uFogF, vDepth)); }
`;
const NOISE = `
float hash2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float hash3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float noise2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float noise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash3(i); float b = hash3(i + vec3(1.0, 0.0, 0.0));
  float c = hash3(i + vec3(0.0, 1.0, 0.0)); float d = hash3(i + vec3(1.0, 1.0, 0.0));
  float e = hash3(i + vec3(0.0, 0.0, 1.0)); float g = hash3(i + vec3(1.0, 0.0, 1.0));
  float h = hash3(i + vec3(0.0, 1.0, 1.0)); float k = hash3(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float archSD(vec2 p, float hw, float hh) {
  float spring = hh - hw;
  return p.y > spring ? length(p - vec2(0.0, spring)) - hw : max(abs(p.x) - hw, -p.y);
}
`;
function sm(frag, u = {}, o = {}) {
  const { displace, ...rest } = o;
  return new THREE.ShaderMaterial({
    vertexShader: displace ? VERT.replace('//DISPLACE', displace) : VERT,
    fragmentShader: HEAD + NOISE + frag,
    uniforms: { uTime: TIME, ...FOGU, ...u }, ...rest,
  });
}
const ADD = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

// ---------- bedroom: the doorway and the wall ----------
// inside the arch: no surface, a soft tunnel of moving light, mist curling deeper in, a breathing white heart and motes
// drifting out; at the edge no hard rim, a luminous lip with wisps of light lifting off it into the room
const VORTEX = `
uniform float uHW; uniform float uH; uniform float uPH;
float fbm(vec2 q) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise2(q); q = q * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main() {
  vec2 p = vec2(vPos.x, vPos.y + uPH * 0.5);
  float t = uTime;
  // build 131: no defined outline. The edge itself drifts: the arch's distance is pushed in and out by slow noise that
  // flows upwards and sways, so the boundary wavers and breathes like smoke rather than sitting on a line
  vec2 fl = vec2(p.x * 1.7 + sin(t * 0.23 + p.y * 0.9) * 0.5, p.y * 1.3 - t * 0.32);
  float warp = fbm(fl) - 0.5;
  float warp2 = fbm(fl * 2.3 + vec2(3.1, -t * 0.25)) - 0.5;
  float sd0 = archSD(p, uHW * 1.0, uH * 0.99);
  float sd = sd0 + warp * 0.2 + warp2 * 0.08;
  // the wisps outside the edge: long tendrils rising and curling off it
  float wisp = fbm(vec2(p.x * 2.6 + sin(t * 0.37 + p.y * 1.3) * 0.5 + warp * 0.8, p.y * 1.2 - t * 0.45));
  float streak = fbm(vec2(p.x * 5.5 + warp2 * 1.5, p.y * 0.9 - t * 0.6));   // thin upward strands
  float out_ = max(sd, 0.0);
  float halo = exp(-out_ * (9.0 - 6.5 * wisp)) * smoothstep(0.0, 0.05, p.y) * (0.35 + 0.85 * smoothstep(0.38, 0.72, streak));
  halo *= 0.75 + 0.25 * sin(t * 0.8 + wisp * 6.0);
  // fade out well before the quad's own edges, so no straight line ever shows
  halo *= (1.0 - smoothstep(uHW + 0.3, uHW + 0.58, abs(p.x))) * (1.0 - smoothstep(uPH - 0.3, uPH - 0.02, p.y));
  // the tunnel: depth grows towards a heart a little above the middle; the mist twists as it goes in
  vec2 c = p - vec2(0.0, uH * 0.56);
  float r = length(c * vec2(1.0, 0.82));
  float z = 0.55 / (r + 0.1);
  float tw = z * 0.8 + t * 0.22;
  vec2 q = mat2(cos(tw), -sin(tw), sin(tw), cos(tw)) * c * (1.2 + z * 0.35);
  float mist = fbm(q * 2.2 + vec2(0.0, -t * 0.15));
  float mist2 = fbm(q * 4.1 - vec2(t * 0.11, 0.0) + 5.0);
  float rings = pow(0.5 + 0.5 * sin((z - t * 0.55) * 6.2832 * 0.8), 8.0) * smoothstep(0.15, 0.7, r) * 0.45;
  vec3 col = mix(vec3(0.07, 0.16, 0.6), vec3(0.35, 0.6, 1.0), smoothstep(0.25, 0.75, mist));
  col = mix(col, vec3(0.6, 0.48, 1.0), smoothstep(0.5, 0.85, mist2) * 0.45);    // a violet sheen
  col = mix(col, vec3(0.5, 0.95, 1.0), smoothstep(0.62, 0.9, mist) * 0.35);     // and cyan where the mist thins
  col += vec3(0.8, 0.92, 1.0) * rings * (0.5 + mist);
  float breathe = 0.85 + 0.15 * sin(t * 0.9);
  col = mix(col, vec3(1.0), smoothstep(0.8 * breathe, 0.0, r) * 0.9);
  // motes: points of light carried outwards, each twinkling
  vec2 g = q * 7.0 + vec2(0.0, t * 0.6); vec2 id = floor(g); vec2 f = fract(g) - 0.5;
  float h = hash2(id);
  float m = smoothstep(0.09, 0.0, length(f - (vec2(h, fract(h * 7.31)) - 0.5) * 0.6)) * step(0.8, h) * (0.4 + 0.6 * sin(t * 3.0 + h * 40.0));
  col += vec3(0.9, 0.96, 1.0) * m * 0.9;
  // near the edge the tunnel thins into a pale glowing veil, broken into strands, not an even rim
  float veil = smoothstep(-0.32, 0.0, sd) * (0.35 + 0.45 * smoothstep(0.3, 0.8, streak));
  col = mix(col, vec3(0.62, 0.8, 1.0), veil * 0.7);
  // a wide feathered fade from opening to room instead of a cut
  float inside = smoothstep(0.05, -0.2, sd);
  vec3 haloC = mix(vec3(0.3, 0.55, 1.0), vec3(0.7, 0.62, 1.0), smoothstep(0.4, 0.8, wisp)) * (0.6 + halo);
  gl_FragColor = vec4(mix(haloC, col, inside), max(inside, clamp(halo, 0.0, 1.0) * 0.8));
}`;
// light pooled on the carpet in front of the doorway
const SPILL = `
uniform float uHW; uniform float uOpen;
void main() {
  float z = vPos.y; float x = vPos.x;
  float g = exp(-x * x / (uHW * uHW * 2.2 + z * 0.6)) * exp(-z * 0.85) * smoothstep(0.0, 0.08, z);
  g *= (1.0 - smoothstep(1.1, 1.65, abs(x))) * (1.0 - smoothstep(2.4, 3.15, z));   // no hard edge at the quad's sides or end
  g *= 0.9 + 0.1 * sin(z * 14.0 - uTime * 3.0);
  gl_FragColor = vec4(vec3(0.35, 0.6, 1.0) * g * 0.55 * uOpen, 1.0);
}`;
// the far wall turning to a hologram
const HOLO = `
uniform float uAmt; uniform vec2 uSize;
void main() {
  vec2 p = vUv * uSize;
  float scan = pow(0.5 + 0.5 * sin(p.y * 90.0 - uTime * 6.0), 4.0);
  vec2 gq = abs(fract(p * 3.0) - 0.5);
  float grid = smoothstep(0.47, 0.5, max(gq.x, gq.y));
  float roll = smoothstep(0.12, 0.0, abs(fract(vUv.y - uTime * 0.18) - 0.5) - 0.38);
  float fl = 0.85 + 0.15 * noise2(vec2(uTime * 9.0, 1.0));
  float g = (scan * 0.18 + grid * 0.35 + roll * 0.25) * fl;
  gl_FragColor = vec4(vec3(0.25, 0.55, 1.0) * g * uAmt, 1.0);
}`;
function dressPortal(R) {
  R.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(R.portal);
  const pw = R.portal.getWorldPosition(new THREE.Vector3());
  let hw = 0.6, h = 2.3;
  if (!box.isEmpty() && Number.isFinite(box.max.y)) {
    hw = THREE.MathUtils.clamp((box.max.x - box.min.x) / 2 / 1.08, 0.3, 1.4);
    h = THREE.MathUtils.clamp((box.max.y - pw.y) / 1.04, 1.2, 3.2);
  }
  const PAD = 0.6, ph = h + PAD;   // the quad reaches past the arch so wisps can lift off the edge
  const u = { uHW: { value: hw }, uH: { value: h }, uPH: { value: ph }, uOpen: { value: 0 }, uCy: { value: 0 } };
  const vortex = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 + PAD * 2, ph), sm(VORTEX, u, { transparent: true, depthWrite: false }));
  vortex.position.set(0, ph / 2, 0.02); R.portal.add(vortex);
  for (const c of R.portal.children) if (c.isMesh && c !== vortex) c.visible = false;   // the flat rim and core: the vortex draws the whole opening now
  // (the light spilling out onto the wall and into the room is drawn by buildBedroom: R.portalRays / R.portalGlow)
  // floor spill lives in the room, in world space, in front of the door
  const into = pw.z > 0 ? -1 : 1;
  // plane local +y runs from the door (vPos.y = 0) into the room; rotation.x maps local +y to world -z
  const spillG = new THREE.PlaneGeometry(3.4, 3.2); spillG.translate(0, 1.6, 0);
  const spill = new THREE.Mesh(spillG, sm(SPILL, u, ADD));
  spill.rotation.x = -Math.PI / 2; spill.rotation.z = into < 0 ? 0 : Math.PI;
  spill.position.set(pw.x, 0.012, pw.z);
  spill.visible = false; R.group.add(spill);
  on(() => {
    u.uOpen.value = THREE.MathUtils.clamp(R.portalLight.intensity / 11, 0, 1);
    spill.visible = R.portal.visible;
  });
}
function holoWall(R) {
  R.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(R.farWall);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const w = Math.max(size.x, 0.5), h = Math.max(size.y, 0.5);
  const u = { uAmt: { value: 0 }, uSize: { value: new THREE.Vector2(w, h) } };
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), sm(HOLO, u, { ...ADD, side: THREE.DoubleSide }));
  m.position.set(c.x, c.y, c.z - Math.sign(c.z || 1) * 0.04);
  R.group.add(m);
  return u.uAmt;
}

// ---------- the tunnel ----------
const BEND = `
  float bd = max(0.0, -w.z);
  w.x += sin(uTime * 0.31) * bd * bd * 0.005;
  w.y += cos(uTime * 0.23) * bd * bd * 0.0035;`;
const TUNNEL = `
void main() {
  float d = -vWorld.z;
  float a = vUv.x * 6.2831853;
  vec2 cs = vec2(cos(a), sin(a));
  float flow = d * 0.5 + uTime * 7.0;
  float s1 = noise3(vec3(cs * 9.0, flow * 0.12));
  float s2 = noise3(vec3(cs * 23.0, flow * 0.3 + 5.0));
  float streak = pow(s1, 7.0) * 2.2 + pow(s2, 12.0) * 3.0;
  float sw = sin(a * 3.0 + d * 0.35 - uTime * 1.6) * 0.5 + 0.5;
  float sw2 = sin(a * 5.0 - d * 0.22 + uTime * 1.1) * 0.5 + 0.5;
  float rg = pow(0.5 + 0.5 * sin(flow * 0.9), 24.0);
  vec3 col = mix(vec3(0.015, 0.05, 0.12), vec3(0.1, 0.36, 0.7), sw * sw2);
  col += vec3(0.06, 0.16, 0.3) * sw;
  col += vec3(0.7, 0.9, 1.0) * streak;
  col += vec3(0.45, 0.75, 1.0) * rg * 0.4;
  col *= 0.35 + 0.65 * smoothstep(0.0, 5.0, d);
  col = mix(col, vec3(0.92, 0.97, 1.0), smoothstep(10.0, 38.0, d));
  gl_FragColor = vec4(col, 1.0);
}`;
// light streaks rushing past, animated entirely on the GPU
const STREAK_V = `
attribute vec4 aS; attribute float aEnd;
uniform float uTime;
varying float vA;
void main() {
  float L = 70.0;
  float z = mod(aS.z + uTime * aS.w, L);
  float d = L - z - 3.0 + aEnd * (0.5 + aS.w * 0.09);
  vec4 w = vec4(cos(aS.x) * aS.y, sin(aS.x) * aS.y, -d, 1.0);
  float bd = max(0.0, d);
  w.x += sin(uTime * 0.31) * bd * bd * 0.005;
  w.y += cos(uTime * 0.23) * bd * bd * 0.0035;
  vA = (1.0 - aEnd * 0.9) * (1.0 - smoothstep(30.0, 66.0, d)) * smoothstep(-3.0, 1.0, d);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const STREAK_F = `
varying float vA;
void main() { gl_FragColor = vec4(vec3(0.75, 0.92, 1.0) * vA, 1.0); }`;
function streakLines(n) {
  const pos = new Float32Array(n * 6), s = new Float32Array(n * 8), e = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 1.55, ph = Math.random() * 70, sp = 9 + Math.random() * 16;
    for (let j = 0; j < 2; j++) { s.set([a, r, ph, sp], (i * 2 + j) * 4); e[i * 2 + j] = j; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aS', new THREE.BufferAttribute(s, 4));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(e, 1));
  const m = new THREE.LineSegments(geo, new THREE.ShaderMaterial({ vertexShader: STREAK_V, fragmentShader: STREAK_F, uniforms: { uTime: TIME }, ...ADD }));
  m.frustumCulled = false;
  return m;
}

export async function bedroom() {
  const R = buildBedroom(); E.surface = 'carpet';
  // the grey's wand borrows the clock's red light when it is needed: one fewer light for every surface all scene
  // (a dark light still costs per pixel, and adding one mid-scene would recompile every material)
  const wandLight = R.clockLight;
  E.scene.add(R.group);
  shaderScene();
  dressPortal(R);
  // everyone who comes through the wall later is built now, hidden, and compiled while the screen is still black
  const pre = { greys: [makeGrey(), makeGrey()], mantis: makeMantis(), wand: makeWand() };
  for (const o of [...pre.greys, pre.mantis, pre.wand]) { o.visible = false; R.group.add(o); }
  warm(R.portal, ...pre.greys, pre.mantis, pre.wand);
  const holo = holoWall(R);
  setView(0, 0.86, -1.52, Math.PI, 0.2);
  // your own body, lying in the bed with your arms on top of the covers
  const me = makePlayerBody(); me.userData.layInBed(); R.group.add(me); me.userData.legs.children[1].visible = false;
  E.limits = { yaw: 1.4, up: 0.8, down: 0.55 }; E.mode = 'look'; E.heart = false;
  G.fear = 0.15;
  const roomTone = A.drone(110, { noise: true, g: 0.05, q: 0.4 });
  await fade(0, 3);
  hint('Move the mouse to turn your head.');
  say("You are awake. You don't know why.");
  const clockPos = R.clock.position.clone();
  await until(() => lookingAt(clockPos, 0.3), 16);
  hint('');
  // the eyes settle on the clock and stay there while the numbers go wrong: the view eases onto it and the field narrows
  // a little (a slow push in, not a snap), holds through the scramble, then lets go
  {
    R.clock.getWorldPosition(clockPos);
    E.mode = 'locked';
    const lk = aimAt(clockPos), dy = Math.atan2(Math.sin(lk.yaw - E.yaw), Math.cos(lk.yaw - E.yaw)), fov0 = E.camera.fov;
    const zoom = (to, dur) => { const f0 = E.camera.fov; return tween(dur, (k) => { E.camera.fov = lerp(f0, to, k); E.camera.updateProjectionMatrix(); }); };
    moveView(1.4, { yaw: E.yaw + dy, pitch: lk.pitch });
    await zoom(fov0 * 0.72, 1.6);
    R.setClock('3:00'); A.tone(990, 0.06, { g: 0.04 });
    await wait(0.9);
    for (let i = 0; i < 12; i++) { R.setClock('', true); E.shake = 0.004; await wait(0.1); }
    E.shake = 0;
    R.setClock('3:00'); note('clock');
    say("For a moment, you can't read the numbers.");
    await wait(1.6);
    await zoom(fov0, 1.6);
    E.mode = 'look';
  }
  await wait(1.6);

  // the Oz factor
  for (let i = 0; i < 4; i++) { A.bark(); await wait(0.35 + Math.random() * 0.3); }
  await wait(0.6); A.bark(); await wait(1.2);
  roomTone.stop(2.5);
  say("A dog was barking. Now it isn't. Now... nothing is.");
  note('oz');
  // the carrier creeps in out of the silence: a low doubled tone that climbs in pitch and level over about 20 s
  const ring = A.carrier(85, 0.07, 20, { to: 130 });
  await wait(3.5);

  // the light
  const glassFrom = R.glass.color.clone(), glassTo = new THREE.Color(0xcfe8ff);
  await tween(4.5, (k) => {
    R.glare.intensity = k * 42;
    R.glare.target.position.set(lerp(-1.5, 2.2, k), 0.5, lerp(3, 0.2, k));
    R.glass.color.lerpColors(glassFrom, glassTo, k);
  });
  E.heart = true;   // the heart starts to go once the light has stopped on you
  note('light');
  say('Light sweeps the room like headlights. It stops, and stays.');
  await wait(3.6);
  E.limits = { yaw: 0.8, up: 0.5, down: 0.48 }; G.fear = 0.4;
  say("You try to sit up. Nothing moves but your eyes.");
  note('paralysis');
  // you strain against it: the view judders and pulls a fraction, your breath catches, and nothing gives
  if (A.breath) A.breath(true, 1.4, 0.8);
  const pitch0 = E.pitch;
  await tween(1.8, (k) => { const s = Math.sin(Math.PI * k); E.shake = 0.014 * s; E.pitch = pitch0 + 0.05 * s * Math.sin(k * 40); });
  E.shake = 0; E.pitch = pitch0;
  await wait(2.0);

  // the doorway
  const hum = A.rise(62, 0.05, 5, { type: 'sawtooth' });
  R.openPortal(0); A.portal(2.6);
  // the light outside dies back as the doorway opens, so the room is lit from the doorway and the window is night again
  // (left on, it lit the whole room evenly and washed the window out to pale grey)
  { const gl0 = R.glare.intensity, c0 = R.glass.color.clone(), cN = new THREE.Color(0x26344f);
    await tween(2.6, (k) => { R.openPortal(k); R.glare.intensity = gl0 * (1 - 0.92 * k); R.glass.color.lerpColors(c0, cN, k); }); }
  note('doorway');
  A.greysIn(2.56, 6);   // laid out on the 2.0 s wait and the walk below (they cross the wall plane 0.56 s into it): change either and change this
  await wait(2.0);      // build 130: 0.8 s before, lengthened so the roar builds longer before they come through

  const greys = pre.greys;
  if (window.UAP) window.UAP.bed = { greys };   // for test harnesses
  greys.forEach((g, i) => { g.visible = true; g.position.set(i ? 0.3 : -0.3, 0, 4.3); g.rotation.y = Math.PI; R.group.add(g); });
  // from the moment they come through they watch you: necks follow your eyes, they breathe. hold = one arm up, palm out.
  let track = 1, hold = 0, holding = false;
  on((dt, t) => {
    for (let i = 0; i < greys.length; i++) {
      const g = greys[i]; if (g.userData.busy) continue;
      idleGrey(g, t + i); aimGrey(g, E.camera.position, track);
      if (holding) holdGrey(g, i ? 'R' : 'L', hold, t + i * 1.7);   // the arm nearer the bed
    }
  });
  const mantis = pre.mantis; mantis.visible = true; mantis.position.set(0, 0, 5.2); mantis.rotation.y = Math.PI; mantis.scale.multiplyScalar(0.93); R.group.add(mantis); // slightly smaller here so it fits under a bedroom ceiling
  on((dt, t) => idleMantis(mantis, dt, t));
  let phase = 0;
  const walkGreys = (dur, to) => {
    const from = greys.map((g) => g.position.clone());
    return tween(dur, (k) => {
      phase = E.time * GREY_GAIT;
      for (let i = 0; i < greys.length; i++) { const g = greys[i]; g.position.lerpVectors(from[i], to[i], k); stepGrey(g, phase, k < 1 ? 1 : 0); }
    }, (k) => k);
  };
  G.fear = Math.max(G.fear, 0.72);   // the heart takes off the moment they are in the room
  say('Two small ones, walking in step.');
  await walkGreys(6, [V(-1.1, 0, 0.75), V(1.1, 0, 0.75)]);
  note('hierarchy');
  // the tall one stoops through and stands back. A.mantisIn is laid out on these two tweens (3.2 s through, 1.6 s along
  // the wall): change either and change its arguments to match
  A.mantisIn(3.2, 1.6);
  await tween(3.2, (k) => {
    mantis.position.z = lerp(5.2, 3.0, k);
    mantis.rotation.x = Math.sin(Math.min(1, k * 1.6) * Math.PI) * -0.5;
  });
  await tween(1.6, (k) => { mantis.position.x = lerp(0, -1.25, k); });
  say('Behind them something tall stoops to come through, and stays by the wall, watching.');
  note('mantis'); note('gold');
  await wait(4.2);

  // one hand each comes up, palm out toward you: the vibration
  holding = true; await tween(1.6, (k) => { hold = k; });
  const vib = A.drone(38, { type: 'sawtooth', g: 0.13, fade: 0.05 });
  E.shake = 0.012; note('vibration');
  await wait(1.2);

  // ---- BREAK FREE? ----
  // No interface but one line: the moment is felt through the body. The hum of the held hands swells and fades in a slow
  // rhythm (in for IN seconds, out for OUT); holding SHIFT draws a breath (you hear it, and the view lifts with your
  // chest), letting go breathes out. Breathing with the hum calms you: fear, and with it the heartbeat, the dark edges and
  // the tremor, come down. Each SPACE press is a twitch in the right hand on the covers, and as the struggle builds the
  // arm starts to come up off them (fistLift), sinking back as it fades; when it wins the fist comes the rest of the way.
  // A grey talks the first breaths through ("Breathe in..." / "...and out.") until you are with it, you struggle, or three
  // breaths have gone by. One instruction line under the prompt goes once either control has been tried.
  prompt('BREAK FREE?');
  // on a phone the line under the prompt says it all; the long hint would wrap over the voice talking the breath through
  hint(E.touch ? '' : 'SPACE to struggle   ·   or breathe: hold SHIFT as the hum swells, let go as it fades');
  const how = $('how');
  how.textContent = tr(E.touch ? 'Hold BREATHE to breathe. Tap STRUGGLE to fight.' : 'Hold SHIFT to breathe. Tap SPACE to fight.');
  how.classList.add('on'); let howGone = -1;
  E.breathing = true; E.nudge = { breathe: false, struggle: false };
  let struggle = 0, calm = 0, t = 0, wasHeld = false, air = null;
  const IN = 3.5, OUT = 4.5, GRACE = 0.6, LEAD = 3.4; // seconds the hum swells, fades, the slack allowed at each turn, and the wait for "Be not afraid."
  let lung = 0, camLift = 0, pitchLift = 0, twitch = 0, lastIn = null, coached = 0, idle = 0;
  G.fear = Math.max(G.fear, 0.8); // the heart is hammering when this starts; breathing brings it down
  say('Be not afraid.', 'them', 3.2);
  const startZ = greys.map((g) => g.position.z);
  const result = await new Promise((res) => {
    const off = on((dt) => {
      t += dt;
      const held = !!(E.keys.ShiftLeft || E.keys.ShiftRight), pressed = E.just.has('Space');
      if (pressed) { struggle += 0.05; twitch = 1; G.fear += 0.03; E.panic = Math.min(1, (E.panic || 0) + 0.12); A.noise(0.07, { g: 0.12, f: 180, q: 1 }); }
      struggle = Math.max(0, struggle - dt * 0.09);
      E.shake = 0.012 + struggle * 0.05 - calm * 0.008;
      // the rhythm: before LEAD it rests (breathing out); then IN swelling, OUT fading
      const u = t < LEAD ? IN + 0.01 : (t - LEAD) % (IN + OUT), inhale = u < IN;
      const turn = t >= LEAD && Math.min(u, Math.abs(u - IN), IN + OUT - u) < GRACE;
      if (t >= LEAD && inhale !== lastIn) {
        lastIn = inhale;
        vib.set(inhale ? 44 : 38, inhale ? 0.2 : 0.1, inhale ? IN : OUT);   // the hum is the rhythm: up and louder in, down and softer out
        if (coached < 3 && calm < 0.3 && struggle < 0.1) { say(inhale ? 'Breathe in...' : '...and out.', 'them', (inhale ? IN : OUT) - 0.4); if (!inhale) coached++; }
      }
      // the instruction goes once either control has been tried
      if (howGone < 0 && (held || pressed)) howGone = t;
      if (howGone >= 0 && t - howGone > 1.5) how.classList.remove('on');
      // your chest: fills while the key is held, empties when it is let go; the view rises and tips a little with it
      lung = held ? Math.min(1, lung + dt / IN) : Math.max(0, lung - dt / OUT);
      const ly = 0.014 * Math.sin(lung * Math.PI / 2), lp = 0.02 * Math.sin(lung * Math.PI / 2);
      E.camera.position.y += ly - camLift; E.pitch += lp - pitchLift; camLift = ly; pitchLift = lp;
      // the right hand: a twitch at each press, the arm coming up off the covers as the struggle builds
      twitch = Math.max(0, twitch - dt * 6);
      me.userData.fistLift(Math.min(0.45, struggle * 0.45 + twitch * 0.06));
      // you hear your own breath follow the key
      if (held !== wasHeld) {
        if (air) air.stop(0.2);
        air = (held || t > 0.5) ? A.breath(held, held ? IN : OUT, G.fear) : null;
      }
      // phones: the real buttons pulse while a breath is being talked through, or after a while with nothing pressed
      idle = held !== wasHeld || pressed || held ? 0 : idle + dt;
      wasHeld = held;
      E.nudge.breathe = (coached < 3 && calm < 0.3 && t >= LEAD && inhale && !held) || idle > 6; E.nudge.struggle = idle > 12;
      if (struggle >= 0.05) calm = Math.max(0, calm - dt * 0.2);
      else if (t < LEAD) { if (!held) G.fear -= dt * 0.01; }
      else if ((held === inhale || turn) && (held || calm > 0)) { calm += dt / 13; G.fear -= dt * 0.04; }   // 13 s of breathing in time (16 before build 156)
      else calm = Math.max(0, calm - dt / 16);   // drains over 16 s when out of time (12 before build 156)
      if (calm === 0 && t >= LEAD) G.fear += dt * 0.012;
      for (let i = 0; i < greys.length; i++) greys[i].position.z = lerp(startZ[i], -0.75, Math.min(1, t / 28));
      const done = struggle >= 1 ? 'fight' : calm >= 1 ? 'calm' : t > 28 ? 'afraid' : null;
      if (done) { off(); if (air) air.stop(0.4); res(done); }
    });
  });
  prompt(''); hint(''); how.classList.remove('on'); E.breathing = false; E.nudge = null;
  E.camera.position.y -= camLift; E.pitch -= pitchLift; vib.set(38, 0.13, 0.6);
  const liftFrom = Math.min(0.45, struggle * 0.45);   // where the arm got to (the fight takes it on from there)
  if (result !== 'fight') tween(0.6, (k) => me.userData.fistLift(liftFrom * (1 - k)));
  G.path = result;

  if (result === 'fight') {
    note('struggle');
    E.limits = null; E.shake = 0.02;
    say('A fist lifts off the sheet. Your voice comes back as a croak.'); A.croak();
    tween(0.8, (k) => me.userData.fistLift(liftFrom + (1 - liftFrom) * k))   // on from wherever the struggle had got it
      .then(() => wait(1.2)).then(() => { const u = me.userData, a0 = u.armR.rotation.x, f0 = u.foreR.rotation.x;   // sitting up, the fist comes down to chest height, still clenched (fully raised it filled the right of the view)
        return tween(1.4, (k) => { u.armR.rotation.x = a0 - 0.45 * k; u.foreR.rotation.x = f0 - 0.2 * k; }); });
    moveView(1.1, { pos: V(0, 1.2, -1.15), pitch: 0, yaw: Math.PI }); A.rustle(1.0, 1.3);   // bolt upright: the covers drag
    // the body sits up with the view (its eyes stay at the camera, so it is never seen from outside, headless), and the
    // look is held to what a sitting body can see without turning into its own open collar
    // (pivoting a little behind the hips, so it sits up against the pillows rather than leaning far back)
    // The lying view sits 12 cm over the lying body's eyes, so that gap closes over the bolt instead of in one frame.
    { const mu = me.userData, hip = V(0, 0.56, -1.0), off = me.localToWorld(V(0, 0, 0)).sub(E.camera.position), tg = V();
      const hip0 = me.localToWorld(mu.legs.position.clone()), hw = V();
      let tb = 0; on((dt) => { tb += dt; const w = Math.min(1, tb / 1.1), s = w * w * (3 - 2 * w); mu.riseTo(tg.copy(E.camera.position).addScaledVector(off, 1 - s), hw.lerpVectors(hip0, hip, s), E.camera.quaternion, s); });
      mu.riseTo(V(0, 1.2, -1.15), hip); const rl = mu.riseLimits(Math.PI); mu.riseTo(tg.copy(E.camera.position).add(off), hip0);
      E.base.yaw = rl.base.yaw; E.base.pitch = rl.base.pitch; E.limits = rl.limits; }
    // How they take it (build 123; they used to slide back 2 cm a frame, a sudden glide away): in the accounts the beings
    // are not frightened off. They stop dead, a startled stillness, a look passes between them, and then they carry on,
    // calm and businesslike, and come in closer to put you under again (the stare, a touch, an instrument). So: they freeze
    // with the hands still up and flinch back a little from the hips (the feet stay put), glance at each other, turn back
    // to you, and the nearer one takes one slow step in as the hands come down.
    const fl = (g, x) => { g.userData.root.rotation.x = -x; };
    await tween(0.35, (k) => { greys.forEach((g) => fl(g, 0.07 * k)); });
    note('shocked');
    await wait(0.5);
    // the glance: each turns its neck toward the other one's head (aimed at it, so it is always the right way: build 123
    // turned the heads by a fixed angle with the sign the wrong way round, and they looked away from each other)
    const lookAt = V(0, 0, 0), otherHead = V(0, 0, 0);
    const glance = (g, i, k) => { greys[1 - i].userData.head.getWorldPosition(otherHead); lookAt.lerpVectors(E.camera.position, otherHead, k); aimGrey(g, lookAt, 1); };
    await tween(0.8, (k) => { track = 0; greys.forEach((g, i) => glance(g, i, k)); });
    await tween(0.6, () => { greys.forEach((g, i) => glance(g, i, 1)); });
    await tween(0.7, (k) => { greys.forEach((g, i) => { glance(g, i, 1 - k); fl(g, 0.07 * (1 - k)); }); track = k; });
    track = 1;
    {
      const g0 = greys[0], p0 = g0.position.clone(), p1 = p0.clone().add(V(-p0.x, 0, -1.15 - p0.z).setY(0).normalize().multiplyScalar(0.18));
      await tween(1.1, (k) => { hold = 1 - k; g0.position.lerpVectors(p0, p1, k); stepGrey(g0, E.time * GREY_GAIT, Math.sin(Math.PI * k)); holdGrey(g0, 'L', hold, E.time); }, (k) => k);   // the step swings the arms; the raised one is put back
      stepGrey(g0, 0, 0);
    }
    holding = false;
    await wait(0.3);
    if (nights('fights') > 0) { await say('Why do we have to go through this every time?', 'them'); note('everytime'); }
    const g = greys[1];
    // the wand is held in the long fingers like a pen-light, red tip forward; its light was made dark at the start
    const wand = pre.wand; wand.visible = true; gripGrey(g, 'R', GRIP_K, wand);
    wand.userData.tip.add(wandLight); wandLight.position.set(0, 0, 0); wandLight.color.set(0xff2030); wandLight.distance = 3; wandLight.intensity = 0;
    g.userData.busy = true; g.userData.armL.rotation.x = 0; g.userData.head.rotation.y = 0;
    // It comes round to the bedside on foot (it never floats up: from the bed its feet are hidden behind the mattress, so a
    // rise read as it growing taller), then climbs onto the bed beside you: a hand down on the covers, knees up onto the
    // mattress, and it kneels there leaning in. The wand comes up until its red tip is about 10 cm in front of your eyes,
    // pointed at them. (The bed surface here is 0.57-0.58; the covers end at x 0.89, the nightstand starts at z -1.49.)
    const from = g.position.clone(), to = V(1.06, 0, -1.08), you = V(0, 1.2, -1.15);
    const kn = V(0.62, 0.332, -1.02);   // sitting back on its heels: knees (0.268 up in its own frame) on the covers at about 0.575
    const faceOf = (p) => Math.atan2(you.x - p.x, you.z - p.z), r0 = g.rotation.y;
    const turn = Math.atan2(Math.sin(faceOf(to) - r0), Math.cos(faceOf(to) - r0)), turnK = Math.atan2(Math.sin(faceOf(kn) - faceOf(to)), Math.cos(faceOf(kn) - faceOf(to)));
    const u = g.userData, sh = u.armR, el = u.foreR, hd = u.handR, wq = new THREE.Quaternion(), qs = new THREE.Quaternion(), qe = new THREE.Quaternion(), qs0 = new THREE.Quaternion(), qe0 = new THREE.Quaternion();
    const wv = new THREE.Vector3(), tv = new THREE.Vector3(), down = V(0, -1, 0), sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
    // turn the wrist so the shaft (which crosses the palm) points along a world direction, red tip leading
    const aimWand = (dir) => { hd.quaternion.identity(); hd.parent.getWorldQuaternion(wq).invert(); wv.copy(dir).normalize().applyQuaternion(wq); if (u.gripAxisR) hd.quaternion.setFromUnitVectors(u.gripAxisR, wv); };
    // your eyes go to it as it comes: the view turns toward the bedside
    { const look = aimAt(V(0.95, 0.85, -1.0)), dy = Math.atan2(Math.sin(look.yaw - E.yaw), Math.cos(look.yaw - E.yaw)); moveView(1.3, { yaw: E.yaw + dy, pitch: look.pitch }); }   // the short way round
    await tween(1.3, (k) => {
      phase = E.time * GREY_GAIT; g.position.lerpVectors(from, to, k); stepGrey(g, phase, 1 - k); g.rotation.y = r0 + turn * k;
      u.armR.rotation.z = 0.16; u.armL.rotation.z = -0.1;   // arms held a little out from its sides as it walks: the wand hand clears its thigh, the arms its chest
      aimGrey(g, E.camera.position, k); aimWand(down); gripGrey(g, 'R', GRIP_K);
    }, (k) => k);
    // The climb, k 0..1, seen: your eyes drop to the mattress edge as it comes up. It bends low over the bed from the hips
    // (so its head stays about where it was while its body comes up: a rise with nothing to show for it read as growing),
    // puts its free hand down on the covers at the edge, brings one knee up onto the mattress, then the other, moves in
    // beside you, its hand stepping in after it, and straightens partway on its knees. The wand hand comes up to its chest,
    // elbow bent. Knees clear the mattress top (0.575) before they cross its edge (x 0.89): the rise finishes at k 0.52.
    // Kneeling: thighs forward and nearly level (TH), shins folded back under them, rising a little to the heels (SH).
    const TH = -1.0, SH = Math.PI / 2 + 0.3, rotY0 = r0 + turn, plant = new THREE.Vector3(), plant1 = new THREE.Vector3(), handAt = new THREE.Vector3();
    { const f = faceOf(kn), fx = Math.sin(f), fz = Math.cos(f); plant.set(kn.x + fx * 0.18 - fz * 0.15, 0.58, kn.z + fz * 0.18 + fx * 0.15); }   // ahead of it and to its left (its right is (fz, -fx)), clear of your hip
    { const f = faceOf(to), fx = Math.sin(f), fz = Math.cos(f); plant1.set(to.x + fx * 0.3 - fz * 0.12, 0.58, to.z + fz * 0.3 + fx * 0.12); }   // first: just in from the mattress edge, to its left
    // Both arms are solved like a robot arm (models.js solveGreyArm / clearGreyArm): each wrist goes to a waypoint, the
    // elbow points out to its side, back and down, and if any sampled point of the arm or the wand would be inside its own
    // torso or head, the elbow is turned about the shoulder-to-wrist line until none is (build 121: the hand-set poses ran
    // the planted arm through its chest and put the wand hand inside its chin). Waypoints are in its body's frame (root),
    // so they move with the lean.
    const rootPt = (x, y, z, out) => u.root.localToWorld(out.set(x, y, z));
    const poleR = new THREE.Vector3(), poleL = new THREE.Vector3(), wR = new THREE.Vector3(), wL = new THREE.Vector3(), w0R = new THREE.Vector3(), w0L = new THREE.Vector3(), tmp = new THREE.Vector3(), rq = new THREE.Quaternion();
    const wandA = new THREE.Vector3(), wandB = new THREE.Vector3(), wandSeg = [wandA, wandB];
    const wandPts = () => { pre.wand.localToWorld(wandA.set(0, 0.15, 0)); pre.wand.userData.tip.getWorldPosition(wandB); return wandSeg; };
    const poleDir = (sd, out) => { u.root.updateMatrixWorld(true); return out.set(sd, -0.35, -0.55).normalize().applyQuaternion(u.root.getWorldQuaternion(rq)); };
    // where the wrists hang at rest, in its body frame, so the climb starts from them
    g.updateMatrixWorld(true); u.root.worldToLocal(u.handR.getWorldPosition(w0R)); u.root.worldToLocal(u.handL.getWorldPosition(w0L));
    const climb = (k) => {
      const h = sm((k - 0.1) / 0.42), m = sm((k - 0.45) / 0.55), L = 1.0 * sm(k / 0.35) - 0.55 * sm((k - 0.65) / 0.35);
      const bR = sm((k - 0.18) / 0.3), bL = sm((k - 0.34) / 0.3), st = sm((k - 0.55) / 0.25);
      g.position.set(lerp(to.x, kn.x, m), kn.y * h, lerp(to.z, kn.z, m)); g.rotation.y = rotY0 + turnK * m;
      // lean the body from the hips (root turned about the hip point), legs turned back so they keep their own angle
      u.root.rotation.set(L, 0, 0); u.root.position.set(0, 0.36 - 0.36 * Math.cos(L), -0.36 * Math.sin(L));
      u.legR.rotation.set(TH * bR - L, 0, 0); u.kneeR.rotation.set((SH - TH) * bR, 0, 0);
      u.legL.rotation.set(TH * bL - L, 0, 0); u.kneeL.rotation.set((SH - TH) * bL, 0, 0);
      // the free hand: down at the edge first, then lifted and set down again further in as it moves across
      handAt.lerpVectors(plant1, plant, st); handAt.y += 0.07 * Math.sin(Math.PI * st);
      // its wrist 9 cm above the spot on the covers (fingers reach down to it), eased in from hanging
      tmp.copy(handAt); tmp.y += 0.09; rootPt(w0L.x, w0L.y, w0L.z, wL).lerp(tmp, sm(k / 0.25));
      clearGreyArm(g, 'L', wL, poleDir(-1, poleL), () => { gripGrey(g, 'L', 0.15 * sm(k / 0.25)); return null; });
      // the wand hand: held low at its right side in front of its hip; the wand turns from pointing down to pointing at you
      rootPt(0.17, 0.43, 0.11, tmp); rootPt(w0R.x, w0R.y, w0R.z, wR).lerp(tmp, sm(k / 0.4));
      clearGreyArm(g, 'R', wR, poleDir(1, poleR), () => { hd.getWorldPosition(wv); tv.subVectors(E.camera.position, wv).normalize().lerp(down, 1 - sm((k - 0.5) / 0.4)); aimWand(tv); gripGrey(g, 'R', GRIP_K); return wandPts(); });
      // bent low, its head tips right back to keep its eyes on you (aimGrey works in its upright frame: take the bend off)
      gripGrey(g, 'R', GRIP_K); aimGrey(g, E.camera.position, 1, true); u.neck.rotation.x -= L;
    };
    // Where its head and right shoulder will be once it kneels. The tip ends 10 cm from your eyes in the direction of a
    // point just outside that shoulder: the wand hand, behind the tip, is then out at its side, clear of its face (over the
    // face the red ball read as a clown's nose; a hand on that line sat inside its chin).
    climb(1); const headK = new THREE.Vector3(), aimP = new THREE.Vector3(); u.head.getWorldPosition(headK);
    u.armR.getWorldPosition(aimP).addScaledVector(tmp.set(1, 0, 0).applyQuaternion(u.root.getWorldQuaternion(rq)), 0.12); aimP.y += 0.04; climb(0);
    const eye = E.camera.position.clone(), TIP = new THREE.Vector3().subVectors(aimP, eye).normalize().multiplyScalar(0.1).add(eye);
    // your eyes: down to the mattress edge where it comes up, then up to its face as it straightens
    const turnTo = (p, dur) => { const look = aimAt(p), dy = Math.atan2(Math.sin(look.yaw - E.yaw), Math.cos(look.yaw - E.yaw)); moveView(dur, { yaw: E.yaw + dy, pitch: look.pitch }); };
    turnTo(V(0.78, 0.72, -1.02), 0.9);
    wait(1.15).then(() => turnTo(headK.clone().lerp(aimP, 0.3).add(V(0, -0.06, 0)), 1.3));
    await tween(2.1, climb, (k) => k);
    // The reach: first solve the wrist that puts the tip on TIP (corrected by where the tip actually lands), then the wrist
    // travels a curve from where it holds the wand, out round its side at shoulder height (WP), to that point, the arm solved
    // and cleared of its body every frame; the wand points at your eyes. The planted hand stays where it is.
    const W0 = new THREE.Vector3(), WP = new THREE.Vector3(), Wf = new THREE.Vector3(), Bz = new THREE.Vector3(), tp = new THREE.Vector3();
    hd.getWorldPosition(W0); rootPt(0.24, 0.62, 0.16, WP);
    const pointAt = () => { hd.getWorldPosition(wv); aimWand(tv.subVectors(eye, wv)); gripGrey(g, 'R', GRIP_K); return wandPts(); };
    Wf.subVectors(TIP, eye).normalize().multiplyScalar(0.17).add(TIP);
    for (let i = 0; i < 14; i++) { clearGreyArm(g, 'R', Wf, poleDir(1, poleR), pointAt); pre.wand.userData.tip.getWorldPosition(tp); Wf.addScaledVector(tv.subVectors(TIP, tp), 0.7); }
    const reachOut = (e, tremor = 0) => {
      const q = sm(e), r = 1 - q;
      Bz.copy(W0).multiplyScalar(r * r).addScaledVector(WP, 2 * q * r).addScaledVector(Wf, q * q);
      if (tremor) Bz.y += Math.sin(tremor * 23) * 0.002;
      clearGreyArm(g, 'L', wL, poleDir(-1, poleL), null);
      clearGreyArm(g, 'R', Bz, poleDir(1, poleR), pointAt);
      aimGrey(g, eye, 1, true); u.neck.rotation.x -= u.root.rotation.x;
    };
    await tween(1.5, (k) => { reachOut(k); wandLight.intensity = 3 * Math.max(0, (k - 0.3) / 0.7) ** 2; }, (k) => k);
    A.tone(1800, 1.2, { g: 0.1, to: 4000 });
    await tween(1.2, (k) => reachOut(1, k * 1.2 + 0.01), (k) => k);
    note('wand'); nights('fights', 1); nights('foughtlast', 1 - nights('foughtlast'));
    A.zap(); ring.stop(0.1); hum.stop(0.1); vib.stop(0.1);
    $('fade').style.background = '#fff'; $('fade').style.opacity = 1;
    await wait(0.25);
    $('fade').style.background = '#000';
    E.heart = false;
    await wait(2.5);
    return 'end:missing';
  }

  if (result === 'calm') {
    note('breathe'); G.lucidity = 0.6; G.fear = 0.22; G.trust += 1;
    await say("It's fine. You are safe.", 'them'); note('safe');
    if (nights('foughtlast') > 0) { nights('foughtlast', -nights('foughtlast')); await say('You did not fight this time.', 'them'); }
  } else {
    G.lucidity = 0.38; G.fear = 0.72; nights('foughtlast', -nights('foughtlast'));
    await say('They are at the bed. You cannot look away.');
  }

  // ---- Act 2: through the wall ----
  E.mode = 'locked'; E.limits = null; E.shake = 0.004;
  vib.set(52, 0.08, 4);
  say('You are rising.');
  // they watch you go: the greys' heads and the tall one follow you up to the ceiling and across the room
  {
    if (window.UAP) window.UAP.watchers = { greys, mantis };   // for test harnesses
    const mp = new THREE.Vector3();
    on(() => {
      for (const g of greys) aimGrey(g, E.camera.position, 1, true);
      mantis.getWorldPosition(mp);
      const dx = E.camera.position.x - mp.x, dz = E.camera.position.z - mp.z;
      let d = Math.atan2(dx, dz) - mantis.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      mantis.rotation.y += d * 0.08;
      const el = Math.atan2(E.camera.position.y - (mp.y + 2.1), Math.hypot(dx, dz));
      mantis.userData.nodK = -Math.max(0, Math.min(1.4, el / 0.6));   // its head tips back to keep you in view
    });
  }
  // from here you have no body: it stays behind, asleep under the covers (same pose, so the swap is seamless); its head
  // appears once your eyes have left it. The body comes back on the examination table.
  discard(me);
  R.body.visible = true; R.body.userData.head.visible = false;
  wait(0.9).then(() => { R.body.userData.head.visible = true; });
  // the room's light lifts as you rise (the doorway's glow filling the room), so the ceiling at your nose reads grain by grain
  // (the doorway's light, held near the door while you lay there, reaches out into the room: its point light moves in)
  { const a0 = R.amb.intensity, pz = R.portalLight.position.z; tween(5, (k) => { R.amb.intensity = a0 * (1 + 0.6 * k); R.portalLight.position.z = lerp(pz, 2.8, k); }); }
  await moveView(5, { pos: V(0, 2.4, -1.0), pitch: 1.45, yaw: Math.PI });
  note('ceiling');
  await say('The ceiling, inches from your nose. Every grain of it.');
  await moveView(3.5, { pitch: -1.3 });
  note('body');
  await say('Below you, someone is asleep in your bed.');
  const wm = R.farWall.material; wm.transparent = true; wm.emissive = new THREE.Color(0x2a66cc);
  tween(2.5, (k) => { wm.opacity = lerp(1, 0.22, k); wm.emissiveIntensity = k; holo.value = k; });
  await moveView(2.6, { pitch: -0.1 });
  note('hologram');
  say('The wall is there, and it is not. You go through it.');
  ring.set(175, 0.08, 4);
  // behind the wall there is only the doorway's light: a shell of it, so nothing past the room's edge ever shows,
  // and the view whites out into it before the eye reaches the wall
  const shell = new THREE.Mesh(new THREE.BoxGeometry(7, 6, 4), new THREE.MeshBasicMaterial({ color: 0xdff0ff, side: THREE.BackSide, fog: false }));
  shell.position.set(0, 1.3, 6.02); shell.visible = false; R.group.add(shell);
  moveView(4.2, { pos: V(0, 1.5, 4.6) });
  await until(() => E.camera.position.z > 2.7, 4);
  shell.visible = true;
  await fade(1, 0.75, '#dff0ff');
  hum.stop(1); vib.stop(1);

  // tunnel
  clearScene();
  shaderScene();
  E.scene.background = new THREE.Color(0xdff0ff);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 80, 64, 100, true), sm(TUNNEL, {}, { side: THREE.BackSide, displace: BEND }));
  tube.rotation.x = Math.PI / 2; tube.frustumCulled = false; E.scene.add(tube);
  E.scene.add(streakLines(420));
  setView(0, 0, 0, 0, 0);
  on((dt, tt) => { E.roll = Math.sin(tt * 0.4) * 0.5; E.camera.position.x = Math.sin(tt * 0.9) * 0.3; });
  const rush = A.drone(300, { noise: true, g: 0.14, q: 0.7 });
  E.heart = false;   // carried along, the fear drops away
  note('current');
  await fade(0, 1, '#dff0ff');
  await say('Pulled along like something in an ocean current.');
  rush.set(900, 0.2, 2);
  await wait(1.5);
  await fade(1, 1.4, '#fff');
  rush.stop(0.8); ring.stop(0.8);
  return 'exam';
}

// ---------- the white room ----------
// walls like still water in a glass: soft vertical panels, drifting caustic filaments
const EX_WALL = `
uniform float uDark; uniform vec3 uTint;
void main() {
  float y = vWorld.y;
  float fx = fract(vUv.x * 40.0);
  float bulge = 1.0 - pow(abs(fx - 0.5) * 2.0, 2.0);
  float seam = smoothstep(0.03, 0.0, min(fx, 1.0 - fx));
  vec2 q = vec2(vUv.x * 70.0, y * 2.4);
  float n1 = noise2(q + vec2(uTime * 0.21, uTime * 0.09));
  float n2 = noise2(q * 1.7 - vec2(uTime * 0.13, -uTime * 0.17));
  float caus = pow(1.0 - abs(n1 - n2), 7.0);
  float shim = noise2(vec2(vUv.x * 18.0, y * 0.9 - uTime * 0.05));
  vec3 col = uTint * (0.86 + 0.09 * bulge + 0.05 * shim);
  col -= vec3(0.05, 0.04, 0.03) * seam;
  col += vec3(0.05, 0.07, 0.09) * caus;
  col += vec3(0.1, 0.13, 0.16) * (exp(-y * 5.0) + exp(-(3.6 - y) * 4.0));
  float band = smoothstep(0.03, 0.0, abs(y - 2.55)) + smoothstep(0.015, 0.0, abs(y - 0.45)) * 0.6;
  col += vec3(0.1, 0.17, 0.24) * band;
  // mother-of-pearl sheen at grazing angles, and a soft darkening where wall meets floor
  vec3 wn = normalize(-vNormal); vec3 wv = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(wn, wv)), 2.5);
  col += (0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + fres * 0.9 + y * 0.08 + uTime * 0.01))) * fres * 0.07;
  col *= 0.86 + 0.14 * smoothstep(0.0, 0.45, y);
  col = mix(col, vec3(0.012, 0.014, 0.022), uDark);
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
const EX_FLOOR = `
uniform float uDark;
void main() {
  vec2 p = vWorld.xz;
  float r = length(p);
  float a = atan(p.y, p.x + 0.0001);
  vec3 col = vec3(0.86, 0.89, 0.92);
  float fr = abs(fract(r / 0.8 + 0.5) - 0.5) * 0.8;
  float ringL = smoothstep(0.012, 0.004, fr) * step(0.5, r);
  float sp = abs(fract(a / 6.2831853 * 32.0 + 0.5) - 0.5) * r * 6.2831853 / 32.0;
  float spoke = smoothstep(0.01, 0.003, sp) * smoothstep(1.4, 1.8, r);
  col -= vec3(0.06, 0.05, 0.04) * (ringL + spoke * 0.7);
  col += pow(0.5 + 0.5 * sin(r * 3.0 - uTime * 0.7), 8.0) * 0.04;
  float dx = p.x - 2.3, dl = p.x + 2.3;
  float pool = exp(-(p.x * p.x) / 0.25 - (p.y * p.y) / 1.6) + exp(-(dx * dx) / 0.25 - (p.y * p.y) / 1.6) + exp(-(dl * dl) / 0.25 - (p.y * p.y) / 1.6);
  // soft contact shadow round each table's stem (yours, the man's on your right, the empty one on your left), a faint glow pooled under the slab
  float stem = min(length(p), min(length(vec2(dx, p.y)), length(vec2(dl, p.y))));
  col *= 0.8 + 0.2 * smoothstep(0.3, 0.8, stem);
  col += vec3(0.04, 0.07, 0.1) * pool;
  col += vec3(0.1, 0.12, 0.14) * smoothstep(4.2, 5.0, r);
  // a polished floor: the bright centre of the dome, blurred, in its surface
  vec3 vv = normalize(vWorld - cameraPosition);
  vec2 hit = p + vv.xz * (4.8 / max(-vv.y, 0.05));
  col += vec3(0.05, 0.06, 0.075) * exp(-dot(hit, hit) * 0.12) * (0.4 + 0.6 * pow(1.0 - abs(vv.y), 2.0));
  col *= 0.97 + 0.03 * noise2(p * 40.0);
  col = mix(col, vec3(0.01, 0.012, 0.02), uDark);
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
const EX_DOME = `
uniform float uDark;
void main() {
  vec2 p = vWorld.xz;
  float rr = length(p) / 5.0;
  float a = atan(p.y, p.x + 0.0001);
  vec3 col = vec3(0.95, 0.97, 1.0);
  float ribs = abs(fract(a / 6.2831853 * 40.0 + 0.5) - 0.5);
  col -= vec3(0.05) * smoothstep(0.08, 0.0, ribs) * smoothstep(0.18, 0.4, rr);
  float rings = abs(fract(rr * 7.0 + 0.5) - 0.5);
  col -= vec3(0.04) * smoothstep(0.04, 0.0, rings) * step(0.15, rr);
  col += vec3(0.1, 0.12, 0.15) * (1.0 - rr) + exp(-rr * rr * 60.0) * 0.4;
  col += pow(0.5 + 0.5 * sin(rr * 40.0 - uTime * 1.3), 10.0) * smoothstep(0.35, 0.05, rr) * 0.08;
  col = mix(col, vec3(0.01, 0.012, 0.02), uDark);
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// porcelain-white solid (ribs, ports) that darkens with the room
const EX_SOLID = `
uniform float uDark; uniform vec3 uTint;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = abs(dot(n, v));
  vec3 col = uTint * (0.78 + 0.2 * ndv + 0.06 * n.y);
  col += vec3(0.1, 0.13, 0.16) * pow(1.0 - ndv, 3.0);
  col = mix(col, vec3(0.015, 0.017, 0.025), uDark);
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
const EX_GLOW = `
uniform float uDark; uniform vec3 uColor;
void main() { gl_FragColor = vec4(fogit(mix(uColor, vec3(0.0), uDark)), 1.0); }`;
// the eye's lens: concentric rings and a turning shutter
const EYE_LENS = `
uniform float uShift;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x + 0.0001);
  float rings = 0.5 + 0.5 * sin(r * 40.0 - uTime * 4.0);
  float seg = step(0.5, fract(a / 6.2831853 * 12.0 + uTime * 0.2));
  vec3 col = mix(vec3(0.05, 0.25, 0.45), vec3(0.4, 0.85, 1.0), rings * 0.6 + 0.2);
  col = mix(col, col * 0.55, seg * smoothstep(0.4, 0.9, r));
  col += vec3(0.9, 1.0, 1.0) * smoothstep(0.25, 0.0, r);
  col *= smoothstep(1.0, 0.85, r) * 0.7 + 0.3;
  col = mix(col, vec3(1.0, 0.52, 0.12) * dot(col, vec3(0.45, 0.45, 0.3)) * 1.7, uShift);   // reading you: a hot orange (build 146; was green)
  gl_FragColor = vec4(col, 1.0);
}`;
const EYE_BEAM = `
uniform float uShift;
void main() {
  float v = vUv.y;
  float lines = pow(0.5 + 0.5 * sin(v * 60.0 + uTime * 9.0), 6.0);
  float edge = 0.6 + 0.4 * sin(vUv.x * 6.2831853 * 24.0);
  float a = (v * v * 0.3 + lines * 0.2 * v) * edge;
  gl_FragColor = vec4(mix(vec3(0.4, 0.8, 1.0), vec3(1.0, 0.58, 0.18), uShift) * a, 1.0);
}`;

function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
// the slab-on-a-stem examination table, lowered by TY so the greys' shoulders stand well above the top and their arms reach
// down onto you instead of up through the slab. The top is a further TD lower than the stem was built for (build 124): your
// body was placed at the old height and lay 13-15 cm inside the slab (from the foot of the table only your feet showed);
// its top surface is now at y = 0.875 + TY - TD, where your back is (measured 0.525-0.54)
const TY = -0.2, TD = 0.13;
function examTables(g, xs, porcelain, glowM) {
  const stem = new THREE.LatheGeometry([[0, 0], [0.34, 0], [0.36, 0.025], [0.3, 0.07], [0.15, 0.18], [0.1, 0.42], [0.12, 0.68], [0.22, 0.77], [0.24, 0.8], [0, 0.8]].map(([x, y]) => new THREE.Vector2(x, y)), 40);
  const top = new THREE.ExtrudeGeometry(roundedRect(0.8, 2.1, 0.22), { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 3, curveSegments: 10 });
  top.rotateX(-Math.PI / 2);
  const edge = roundedRect(0.87, 2.17, 0.25); edge.holes.push(roundedRect(0.83, 2.13, 0.23));
  const edgeG = new THREE.ExtrudeGeometry(edge, { depth: 0.012, bevelEnabled: false, curveSegments: 10 }); edgeG.rotateX(-Math.PI / 2);
  const band = new THREE.TorusGeometry(0.104, 0.007, 8, 40); band.rotateX(Math.PI / 2);
  // finer detail: an inset line round the top, sensor points down both long edges, a lit foot ring
  const inset = roundedRect(0.66, 1.9, 0.18); inset.holes.push(roundedRect(0.645, 1.885, 0.172));
  const insetG = new THREE.ShapeGeometry(inset, 10); insetG.rotateX(-Math.PI / 2);
  const foot = new THREE.TorusGeometry(0.375, 0.006, 6, 64); foot.rotateX(Math.PI / 2);
  const dotG = new THREE.SphereGeometry(0.0075, 8, 6), dm = new THREE.Matrix4();
  for (const x of xs) {
    const s = new THREE.Mesh(stem, porcelain); s.position.set(x, 0, 0); s.scale.y = (0.8 + TY - TD) / 0.8; g.add(s);
    const t = new THREE.Mesh(top, porcelain); t.position.set(x, 0.82 + TY - TD, 0); g.add(t);
    const e = new THREE.Mesh(edgeG, glowM); e.position.set(x, 0.81 + TY - TD, 0); g.add(e);
    const b = new THREE.Mesh(band, glowM); b.position.set(x, 0.45 * (0.8 + TY - TD) / 0.8, 0); g.add(b);
    const il = new THREE.Mesh(insetG, glowM); il.position.set(x, 0.8765 + TY - TD, 0); g.add(il);
    const f = new THREE.Mesh(foot, glowM); f.position.set(x, 0.008, 0); g.add(f);
    const dots = new THREE.InstancedMesh(dotG, glowM, 24);
    for (let k = 0; k < 24; k++) { dm.makeTranslation(x + (k % 2 ? 0.432 : -0.432), 0.842 + TY - TD, -0.9 + Math.floor(k / 2) * 0.164); dots.setMatrixAt(k, dm); }
    g.add(dots);
  }
}
// The player's legs are one merged mesh. This splits them (in place, for the exam) into a fixed pelvis and, per side, a thigh on
// a hip pivot and a shin + foot on a knee pivot, so the legs can be spread and bent like a patient in stirrups.
// set(spread, kneeBend) in radians; pt(side, d, off, out, outward) is a point on that shin d metres below the knee
// (off + is the back of the leg, outward + is away from the other leg). At set(0, 0) it looks exactly as before.
function stirrups(legs) {
  const KY = -0.39, KZ = -0.012, HX = 0.085, HY = 0.02;
  const src = legs.children[0], feetM = legs.children[1];
  const split = (geo, classify) => {
    const gg = geo.index ? geo.toNonIndexed() : geo, names = Object.keys(gg.attributes), P = gg.attributes.position, out = {};
    for (let t = 0; t < P.count; t += 3) {
      for (const key of classify(P, t)) {
        if (!out[key]) { out[key] = {}; for (const n of names) out[key][n] = []; }
        for (const n of names) { const A = gg.attributes[n], k = A.itemSize; for (let j = 0; j < 3; j++) for (let c = 0; c < k; c++) out[key][n].push(A.array[(t + j) * k + c]); }
      }
    }
    const res = {};
    for (const key in out) { const bg = new THREE.BufferGeometry(); for (const n of names) bg.setAttribute(n, new THREE.Float32BufferAttribute(out[key][n], gg.attributes[n].itemSize)); res[key] = bg; }
    return res;
  };
  const cen = (P, t, c) => (P.getComponent(t, c) + P.getComponent(t + 1, c) + P.getComponent(t + 2, c)) / 3;
  const L = split(src.geometry, (P, t) => {
    const cx = cen(P, t, 0), cy = cen(P, t, 1), sd = cx < 0 ? 'L' : 'R', fx = cx < 0 ? -0.09 : 0.09;
    if (cy > -0.04) return ['p'];
    let ball = true;
    for (let j = 0; j < 3; j++) if (Math.hypot(P.getX(t + j) - fx, P.getY(t + j) - KY, P.getZ(t + j) - KZ) > 0.066) ball = false;
    if (ball) return ['t' + sd, 's' + sd];   // the knee's round cap goes with both, so the joint stays closed when it bends
    return [(cy > KY ? 't' : 's') + sd];
  });
  const Fg = split(feetM.geometry, (P, t) => [(cen(P, t, 0) < 0 ? 's' : 's') + (cen(P, t, 0) < 0 ? 'L' : 'R')]);
  if (L.p) legs.add(new THREE.Mesh(L.p, src.material));
  const piv = {};
  for (const [sg, k] of [[-1, 'L'], [1, 'R']]) {
    const hip = new THREE.Group(); hip.position.set(sg * HX, HY, 0); legs.add(hip);
    const tm = new THREE.Mesh(L['t' + k], src.material); tm.position.set(-sg * HX, -HY, 0); hip.add(tm);
    const knee = new THREE.Group(); knee.position.set(sg * (0.09 - HX), KY - HY, KZ); hip.add(knee);
    const sh = new THREE.Mesh(L['s' + k], src.material); sh.position.set(-sg * 0.09, -KY, -KZ); knee.add(sh);
    if (Fg['s' + k]) { const fm = new THREE.Mesh(Fg['s' + k], feetM.material); fm.position.copy(sh.position); knee.add(fm); }
    piv[k] = { hip, knee };
  }
  src.visible = false; feetM.visible = false;
  return {
    set(spread, bend) { for (const [sg, k] of [[-1, 'L'], [1, 'R']]) { piv[k].hip.rotation.z = sg * spread; piv[k].knee.rotation.x = -bend; } },
    pt(sg, d, off, out, outward = 0) { const kn = piv[sg < 0 ? 'L' : 'R'].knee; kn.updateWorldMatrix(true, false); return kn.localToWorld(out.set(sg * outward, -d, off)); },
  };
}

// the floating eye on its stalk; stalk runs back along -z into the wall
function eyeDevice(steel, portAt) {
  const eye = new THREE.Group(), EU = { uShift: { value: 0 } };
  const shell = new THREE.MeshStandardMaterial({ color: 0x20242c, metalness: 0.9, roughness: 0.22 });
  const pale = new THREE.MeshStandardMaterial({ color: 0xd9dfe6, metalness: 0.6, roughness: 0.25 });
  eye.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 32, 24), shell));
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.093, 0.011, 10, 40), pale); collar.rotation.x = Math.PI / 2; collar.position.y = -0.03; eye.add(collar);
  const collar2 = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.006, 8, 32), pale); collar2.rotation.x = Math.PI / 2; collar2.position.y = -0.065; eye.add(collar2);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.045, 32), sm(EYE_LENS, EU)); lens.position.y = -0.087; lens.rotation.x = Math.PI / 2; eye.add(lens);
  // three fine prongs hanging round the lens
  const prongG = new THREE.ConeGeometry(0.007, 0.09, 6); prongG.rotateX(Math.PI); prongG.translate(0, -0.045, 0);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + 0.5, p = new THREE.Mesh(prongG, pale);
    p.position.set(Math.cos(a) * 0.075, -0.05, Math.sin(a) * 0.075); p.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); eye.add(p);
  }
  // housing at the back where the stalk joins
  const back = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.07, 20), pale); back.rotation.x = Math.PI / 2; back.position.z = -0.1; eye.add(back);
  // the stalk and its collars hang from the housing and always run straight into the middle of the port, whatever the
  // eye does: aimTail() turns them toward the port and sets the stalk's length to reach it
  const tail = new THREE.Group(); tail.position.z = -0.1; eye.add(tail);
  const sg = new THREE.CylinderGeometry(0.012, 0.012, 1, 10); sg.rotateX(Math.PI / 2); sg.translate(0, 0, -0.5);
  const stalk = new THREE.Mesh(sg, steel); tail.add(stalk);
  const cg = new THREE.CylinderGeometry(0.022, 0.022, 0.035, 14); cg.rotateX(Math.PI / 2);
  const cols = new THREE.InstancedMesh(cg, pale, 10), dm = new THREE.Matrix4();
  for (let i = 0; i < 10; i++) { dm.makeTranslation(0, 0, -0.2 - i * 0.55); cols.setMatrixAt(i, dm); }
  cols.frustumCulled = false; tail.add(cols);   // its bounds change with cols.count; never cull it on stale bounds
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _back = new THREE.Vector3(0, 0, -1);
  const aimTail = () => {
    tail.visible = eye.position.z > portAt.z + 0.05;   // still inside the port: nothing to show
    eye.updateMatrixWorld(true);
    _p.copy(portAt); eye.worldToLocal(_p).sub(tail.position);
    const L = _p.length() + 0.15;                     // a little past the rim, into the dark of the port
    tail.quaternion.copy(_q.setFromUnitVectors(_back, _p.normalize()));
    stalk.scale.z = L;
    cols.count = Math.max(0, Math.min(10, Math.floor((L - 0.35) / 0.55) + 1));
  };
  const blinkM = new THREE.MeshBasicMaterial({ color: 0x66c8ff });
  const blink = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), blinkM); blink.position.set(0, 0.088, -0.02); eye.add(blink);
  const beamG = new THREE.ConeGeometry(0.42, 0.95, 40, 1, true); beamG.translate(0, -0.475, 0);
  const beam = new THREE.Mesh(beamG, sm(EYE_BEAM, EU, { ...ADD, side: THREE.DoubleSide })); beam.position.y = -0.09; beam.visible = false; eye.add(beam);
  return { eye, beam, blink, blinkM, aimTail, shift: EU.uShift };
}

// Getting off the exam table in one go (about 6.5 s): you sit up, swing your legs over the right-hand side until your feet
// find the floor, steady yourself with a hand on the table's edge and push up to standing with a small sway, while the
// greys step back to give you room. The body is posed by its hip; the view rides on its eyes throughout.
async function standUp(me, greys) {
  E.mode = 'locked'; E.limits = null;
  const u = me.userData, eyeOff = V(0, 0.73, -0.095), tmp = V(0, 0, 0), cam0 = E.camera.position.clone(), off0 = V(0, 0, 0);
  me.rotation.order = 'YXZ';
  // [hip x, y, z, trunk pitch (PI/2 lying), yaw, legs' angle at the hip, how far the eyes look down, steadying hand 0..1]
  const K = [
    [0, 0.835 + TY, 0.17, Math.PI / 2, 0, 0, Math.PI / 2 - E.pitch, 0],
    [0, 0.86 + TY, 0.22, 0.14, 0, Math.PI / 2 - 0.14, 0.62, 0],
    [0.3, 0.86 + TY, 0.2, 0.1, -Math.PI / 2, 0.62, 0.8, 0.5],
    [0.42, 0.85 + TY, 0.2, 0.06, -Math.PI / 2, 0.26, 0.88, 1],
    [0.64, 0.865, 0.2, 0, -Math.PI / 2, 0, 0.32, 0.7],
  ], D = [1.7, 1.5, 0.7, 1.7];
  let first = true;
  const pose = (p, offK, lean, sway) => {
    const rx = p[3] + lean;
    me.rotation.set(rx, p[4], 0);
    tmp.copy(eyeOff).applyEuler(me.rotation); me.position.set(p[0] + tmp.x, p[1] + tmp.y, p[2] + tmp.z);
    u.legs.rotation.x = p[5] - lean;   // the legs keep their angle to the floor while the trunk leans
    // the steadying hand: right arm down, a little back and out, wrist bent so the palm lies on the table's edge
    const h = p[7]; u.armR.rotation.set(0.1 - 0.45 * h, 0, 0.36 * h); u.foreR.rotation.set(0.15 + 0.1 * h, 0, 0); u.handR.rotation.set(0, 0, 1.0 * h);
    if (first) { off0.copy(cam0).sub(me.position); first = false; }
    E.camera.position.copy(me.position).addScaledVector(off0, offK);
    E.pitch = rx - p[6]; E.yaw = p[4]; E.roll = sway;
  };
  // the greys back away from the side you are getting off
  for (const a of greys) a.userData.busy = true;
  const gFrom = greys.map((a) => a.position.clone()), gTo = greys.map((a) => { const d = V(a.position.x - 0.4, 0, a.position.z - 0.2).normalize(); return a.position.clone().addScaledVector(d, 0.5); });
  let ph = 0;
  const gStep = (k) => { ph = E.time * GREY_GAIT; greys.forEach((a, i) => { a.position.lerpVectors(gFrom[i], gTo[i], k); stepGrey(a, ph + i, k > 0 && k < 1 ? 1 : 0); idleGrey(a, E.time + i); aimGrey(a, E.camera.position, 1); }); };
  const P = new Array(8);
  for (let s = 0; s < 4; s++) {
    if (s === 3) A.noise(0.25, { g: 0.05, f: 300, q: 0.8 });   // bare feet taking the weight
    await tween(D[s], (k) => {
      for (let i = 0; i < 8; i++) P[i] = K[s][i] + (K[s + 1][i] - K[s][i]) * k;
      if (s === 1) P[5] = K[1][5] + (K[2][5] - K[1][5]) * k * k;   // the legs stay over the table until the hips have turned
      const lean = s === 3 ? -0.4 * Math.sin(Math.PI * k) : 0;     // lean forward over the feet to push up
      pose(P, s === 0 ? 1 - k : 0, lean, s === 3 ? 0.03 * Math.sin(k * 8) * k : 0);
      if (s < 2) gStep((s + k) / 2); else greys.forEach((a, i) => aimGrey(a, E.camera.position, 1));
    });
  }
  // standing: a small sway, settling; the hand comes off the table
  await tween(1.0, (k) => { for (let i = 0; i < 8; i++) P[i] = K[4][i]; P[7] = 0.7 * (1 - k); P[6] = 0.32 - 0.15 * k; pose(P, 0, 0, 0.022 * Math.sin(k * 7) * (1 - k)); }, (k) => k);
  for (const a of greys) a.userData.busy = false;
}

// the eye's scan: clinical, not cartoon. A low hum pulsing at about 2.3 Hz, soft dry ticks at irregular intervals (denser
// while it lingers), and a faint high whine just at the edge of hearing. Nothing rises in pitch.
// a man held off his table in a column of light (the most reported way people are moved: lifted in a beam). An emitter
// hangs over the table, dark until start(); then it hums on, its light fades in, the table's lights go from blue to amber,
// and the body rises a few centimetres and floats there with a slow, uneven bob. All procedural: one updater, no keys.
function levitator(g, body, at, tableGlow) {
  // the fitting, built like the room's own furniture: a porcelain head in a steel yoke, on a telescoping stem that runs up
  // into a rosette set into the dome (the dome is a squashed sphere: y = 3.6 + 1.5 * sqrt(1 - r^2 / 25))
  const dev = new THREE.Group(); dev.position.set(at.x, 0, at.z); g.add(dev);
  const steelM = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.8, roughness: 0.25 });
  const shellM = new THREE.MeshStandardMaterial({ color: 0xe9eef3, metalness: 0.25, roughness: 0.22 });
  const darkM = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.5, roughness: 0.5 });
  const r = Math.hypot(at.x, at.z), ceilY = 3.6 + 1.5 * Math.sqrt(Math.max(0, 1 - r * r / 25));
  const HY = 2.66, LY = HY - 0.055, YK = 0.47;   // head pivot, lens plane, yoke half-width
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); dev.add(m); return m; };
  // rosette: a flanged plate, its top buried in the dome so it never shows a gap on the slope
  add(new THREE.LatheGeometry([[0, 0.25], [0.2, 0.25], [0.24, 0.02], [0.27, 0], [0.25, -0.03], [0.16, -0.05], [0.07, -0.06], [0, -0.06]].map(([a, b]) => new THREE.Vector2(a, b)), 40), shellM, 0, ceilY - 0.05, 0);
  // telescoping stem: wide outer sleeve, a collar, a narrower inner tube down to the yoke
  const SJ = 3.42, YT = HY + YK;
  add(new THREE.CylinderGeometry(0.05, 0.05, ceilY - 0.1 - SJ, 20), shellM, 0, (ceilY - 0.1 + SJ) / 2, 0);
  add(new THREE.TorusGeometry(0.05, 0.012, 8, 24), steelM, 0, SJ, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.03, 0.03, SJ - YT + 0.03, 14), steelM, 0, (SJ + YT) / 2, 0);
  add(new THREE.SphereGeometry(0.05, 16, 12), steelM, 0, YT, 0);   // the swivel at the top of the yoke
  // the yoke: a half ring arching over the head across your line of sight (you see it face on from your table), a hub at each pivot
  add(new THREE.TorusGeometry(YK, 0.022, 10, 48, Math.PI), steelM, 0, HY, 0, 0, Math.PI / 2);
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 20), darkM, 0, HY, s * (YK - 0.01), Math.PI / 2);
  // a cable from the head's side up along the yoke into the stem
  const cab = new THREE.CatmullRomCurve3([[0.43, HY + 0.02, 0.04], [0.5, HY + 0.18, 0.05], [0.36, HY + 0.4, 0.05], [0.04, YT + 0.08, 0.035], [0.035, YT + 0.3, 0.035]].map(([a, b, c]) => new THREE.Vector3(a, b, c)));
  add(new THREE.TubeGeometry(cab, 40, 0.009, 6), darkM, 0, 0, 0);
  // the head: a shallow porcelain dome with a chamfered rim and a steel trim band
  add(new THREE.LatheGeometry([[0, 0.11], [0.15, 0.1], [0.3, 0.07], [0.4, 0.035], [0.43, 0.01], [0.43, -0.035], [0.41, -0.055], [0, -0.055]].map(([a, b]) => new THREE.Vector2(a, b)), 64), shellM, 0, HY, 0);
  add(new THREE.TorusGeometry(0.432, 0.008, 6, 64), steelM, 0, HY - 0.012, 0, Math.PI / 2);
  // underneath: a recessed lens with fresnel rings, a ring of lamps round it
  const lensM = new THREE.MeshBasicMaterial({ color: 0x1a2430 });
  const lens = add(new THREE.CircleGeometry(0.33, 48), lensM, 0, LY - 0.002, 0, Math.PI / 2);
  const grooveM = new THREE.MeshBasicMaterial({ color: 0x0e141b, transparent: true, opacity: 0.55, depthWrite: false });
  for (const gr of [0.09, 0.16, 0.22, 0.27, 0.31]) { const ring = add(new THREE.RingGeometry(gr, gr + 0.006, 48), grooveM, 0, LY - 0.004, 0, Math.PI / 2); ring.renderOrder = 1; }
  add(new THREE.RingGeometry(0.33, 0.36, 48), darkM, 0, LY - 0.001, 0, Math.PI / 2);
  const ledM = new THREE.MeshBasicMaterial({ color: 0x55606c });
  const ledG = new THREE.SphereGeometry(0.011, 8, 6);
  for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; add(ledG, ledM, Math.cos(a) * 0.385, LY - 0.002, Math.sin(a) * 0.385); }
  // a small status light on the rim: dark, then a slow blink while it holds him
  const tellM = new THREE.MeshBasicMaterial({ color: 0x2a2f36 });
  add(new THREE.SphereGeometry(0.014, 10, 8), tellM, 0, HY - 0.01, 0.43);
  // the column: an open cone, additive, brightest at the top and fading toward the table
  const beamM = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uK: { value: 0 }, uT: { value: 0 } },
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uK, uT; varying vec2 vU; void main(){ float a = pow(vU.y, 1.6) * (0.85 + 0.15 * sin(uT * 3.0 + vU.y * 9.0)); gl_FragColor = vec4(vec3(0.62, 0.8, 1.0) * a * uK * 0.32, 1.0); }' });
  const beamH = LY - 0.004 - (0.877 + TY - TD);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, beamH, 40, 1, true), beamM); beam.position.y = (0.877 + TY - TD) + beamH / 2; dev.add(beam);
  const ledOn = new THREE.Color(0xbfe9ff), y0 = body.position.y, off = new THREE.Color(0x1a2430), on_ = new THREE.Color(0xdcefff), blue = dcol(0xbfe6ff), amber = dcol(0xffb060);
  let k = 0, going = false, t = 0, hum = null;
  on((dt) => {
    t += dt; beamM.uniforms.uT.value = t;
    if (!going) return;
    k = Math.min(1, k + dt / 4);
    const e = k * k * (3 - 2 * k);
    beamM.uniforms.uK.value = e; lensM.color.copy(off).lerp(on_, e);
    ledM.color.setHex(0x55606c).lerp(ledOn, Math.min(1, k * 2)); tellM.color.setHex(Math.sin(t * 2.4) > 0.6 ? 0xffb060 : 0x2a2f36);
    tableGlow.uniforms.uColor.value.copy(blue).lerp(amber, Math.min(1, k * 3));
    // rise 6 cm, then a bob made of two slow sines so it never quite repeats; a faint roll and pitch with it
    const rise = 0.06 * e, bob = (Math.sin(t * 0.9) * 0.012 + Math.sin(t * 0.53 + 1.3) * 0.007) * e;
    body.position.y = y0 + rise + bob;
    body.rotation.z = Math.sin(t * 0.41) * 0.012 * e;
    body.rotation.x = -Math.PI / 2 + Math.sin(t * 0.67 + 0.4) * 0.008 * e;
  });
  return {
    start() {
      if (going) return; going = true;
      A.tone(146.8, 0.5, { g: 0.03 }); A.tone(587, 0.25, { g: 0.012 });   // a soft two-note chime as it comes on
      hum = A.drone(73.4, { g: 0.018, fade: 3 });
    },
    stop() { if (hum) hum.stop(1); },
  };
}

function scanSound() {
  const hum = A.drone(58, { type: 'sine', g: 0.0001, fade: 0.1 }), hum2 = A.drone(116.4, { type: 'triangle', g: 0.0001, fade: 0.1 });
  const whine = A.drone(7300, { g: 0.0045, fade: 0.05 });
  let busy = false, tick = 0.3, pulse = 0, on_ = true;
  const off = on((dt) => {
    if (!on_) return;
    pulse -= dt;
    if (pulse <= 0) { pulse = 0.43; hum.set(58, 0.075, 0.06); hum2.set(116.4, 0.018, 0.06); setTimeout(() => { if (on_) { hum.set(58, 0.03, 0.25); hum2.set(116.4, 0.006, 0.25); } }, 90); }
    tick -= dt;
    if (tick <= 0) { tick = (busy ? 0.08 : 0.25) + Math.random() * (busy ? 0.35 : 0.9); A.noise(0.012, { g: 0.05 + Math.random() * 0.03, f: 2600 + Math.random() * 2400, q: 6 }); }
  });
  return { busy(b) { busy = b; }, stop() { on_ = false; off(); hum.stop(0.6); hum2.stop(0.6); whine.stop(0.6); } };
}

export async function exam() {
  E.scene.background = new THREE.Color(0xf2f5f8);
  E.scene.fog = new THREE.Fog(0xf2f5f8, 5, 15);
  E.heart = true;
  shaderScene();
  const g = new THREE.Group(); E.scene.add(g);
  const X = { uDark: { value: 0 }, uTint: { value: dcol(0xeef2f6) } };
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 3.6, 96, 1, true), sm(EX_WALL, X, { side: THREE.BackSide })); wall.position.y = 1.8; g.add(wall);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(5, 96), sm(EX_FLOOR, X)); floor.rotation.x = -Math.PI / 2; g.add(floor);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5, 64, 16, 0, Math.PI * 2, 0, Math.PI / 2), sm(EX_DOME, X, { side: THREE.BackSide })); dome.position.y = 3.6; dome.scale.y = 0.3; g.add(dome);
  const hemi = new THREE.HemisphereLight(0xffffff, 0xaab4c4, 2.2); g.add(hemi);
  const steel = new THREE.MeshStandardMaterial({ color: 0xc8d0d8, metalness: 0.7, roughness: 0.3 });
  const porcelain = new THREE.MeshStandardMaterial({ color: 0xe9eef3, metalness: 0.25, roughness: 0.22 });
  const solid = sm(EX_SOLID, X);
  const glowM = sm(EX_GLOW, { ...X, uColor: { value: dcol(0xbfe6ff) } });
  const glowM2 = sm(EX_GLOW, { ...X, uColor: { value: dcol(0xbfe6ff) } });   // the man's table: its lights change when the beam takes him
  // ribs between the wall panels, glowing coves at floor and ceiling
  const ribG = new THREE.BoxGeometry(0.09, 3.5, 0.07), ribs = new THREE.InstancedMesh(ribG, solid, 19), dm = new THREE.Matrix4(), dq = new THREE.Quaternion(), up = V(0, 1, 0);
  for (let i = 0, n = 0; i < 40; i += 2) {
    if (i === 20) continue; // the eye's port
    const a = i * Math.PI * 2 / 40;
    dq.setFromAxisAngle(up, a); dm.compose(V(Math.sin(a) * 4.96, 1.8, Math.cos(a) * 4.96), dq, V(1, 1, 1)); ribs.setMatrixAt(n++, dm);
  }
  g.add(ribs);
  for (const [y, r] of [[0.02, 4.94], [3.58, 4.94]]) { const c = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 8, 128), glowM); c.rotation.x = Math.PI / 2; c.position.y = y; g.add(c); }
  // the port the eye comes out of
  const port = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 12, 40), solid); port.position.set(0, 1.75, -4.93); g.add(port);
  const portIn = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32), sm(EX_GLOW, { ...X, uColor: { value: dcol(0x2a3442) } })); portIn.position.set(0, 1.75, -4.95); g.add(portIn);
  const portRing = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.006, 6, 40), glowM); portRing.position.set(0, 1.75, -4.9); g.add(portRing);
  // small dark wall ports with lit pupils, at eye height round the room
  const pg = new THREE.CircleGeometry(0.07, 24), ports = new THREE.InstancedMesh(pg, sm(EX_GLOW, { ...X, uColor: { value: dcol(0x3a4656) } }), 8);
  const pupils = new THREE.InstancedMesh(new THREE.CircleGeometry(0.018, 12), glowM, 8);
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) * Math.PI * 2 / 8 + Math.PI / 40;
    dq.setFromAxisAngle(up, a + Math.PI); dm.compose(V(Math.sin(a) * 4.93, 1.25, Math.cos(a) * 4.93), dq, V(1, 1.5, 1)); ports.setMatrixAt(i, dm);
    dm.compose(V(Math.sin(a) * 4.92, 1.25, Math.cos(a) * 4.92), dq, V(1, 1, 1)); pupils.setMatrixAt(i, dm);
  }
  g.add(ports, pupils);
  // overhead apparatus: a suspended ring of lights with a cluster of fine needles
  const rig = new THREE.Group(); rig.position.set(0, 2.75, 0.1); g.add(rig);
  const ringT = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.028, 12, 64), porcelain); ringT.rotation.x = Math.PI / 2; rig.add(ringT);
  const ringG = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.008, 6, 64), glowM); ringG.rotation.x = Math.PI / 2; ringG.position.y = -0.028; rig.add(ringG);
  const nodes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 10, 8), glowM, 12);
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; dm.makeTranslation(Math.cos(a) * 0.55, -0.03, Math.sin(a) * 0.55); nodes.setMatrixAt(i, dm); }
  rig.add(nodes);
  const rodG = new THREE.CylinderGeometry(0.008, 0.008, 2.4, 6);
  for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3, r = new THREE.Mesh(rodG, steel); r.position.set(Math.cos(a) * 0.55, 1.2, Math.sin(a) * 0.55); rig.add(r); }
  const hub = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 24), porcelain); hub.rotation.x = Math.PI; hub.position.y = -0.05; rig.add(hub);
  const spokeG = new THREE.CylinderGeometry(0.005, 0.005, 1.1, 6); spokeG.rotateZ(Math.PI / 2);
  for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(spokeG, steel); s.rotation.y = i * Math.PI / 3 + Math.PI / 6; s.position.y = 0.02; rig.add(s); }
  const needleG = new THREE.CylinderGeometry(0.0025, 0.0008, 0.26, 5); needleG.translate(0, -0.13, 0);
  const needles = new THREE.InstancedMesh(needleG, steel, 6);
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; dq.setFromAxisAngle(V(Math.cos(a), 0, Math.sin(a)), 0.18); dm.compose(V(Math.cos(a) * 0.035, -0.15, Math.sin(a) * 0.035), dq, V(1, 1, 1)); needles.setMatrixAt(i, dm); }
  rig.add(needles);
  const tipM = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), glowM); tipM.position.y = -0.17; rig.add(tipM);

  const table = (x) => examTables(g, [x], porcelain, glowM);
  table(0); examTables(g, [2.3], porcelain, glowM2);
  table(-2.3);   // an empty table on your left, the same as yours and the man's (its floor shadow is in EX_FLOOR)
  // a steel tray on a stand off the foot-left corner of your table, with a very long chrome probe lying on it.
  // The probe's business end is its local -y; the ringed grip is at its +y end.
  const tray = new THREE.Group(); tray.position.set(-0.95, 0, -1.47); g.add(tray);   // 15 cm further from the table end than before build 149, so a grey walks straight between them
  {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.8, 10), steel); leg.position.y = 0.4;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.012, 0.16), steel); plate.position.y = 0.806;
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.02, 0.006), steel); lip.position.set(0, 0.818, 0.08);
    const lip2 = lip.clone(); lip2.position.z = -0.08;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.02, 20), steel); foot.position.y = 0.01;
    tray.add(leg, plate, lip, lip2, foot);
  }
  const chrome = new THREE.MeshStandardMaterial({ color: 0xeef2f6, metalness: 0.85, roughness: 0.14 });
  const instr = new THREE.Group();
  {
    // 0.70 m from the ring end to the tip (build 146, was 0.43): long enough to come in under your raised legs to your
    // backside from the foot of the table with the grey's elbow bent; on the tray it lies across the whole plate
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0068, 0.70, 10), chrome); rod.position.y = -0.27; instr.add(rod);
    const nub = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 12, 8), new THREE.MeshBasicMaterial({ color: 0xd8f2ff })); nub.position.y = -0.62; instr.add(nub);   // a pale lit tip
    for (const y of [0.06, 0.04, 0.02]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.0078, 0.0018, 4, 12), chrome); r.rotation.x = Math.PI / 2; r.position.y = y; instr.add(r); }
  }
  // it lies with its ringed handle out past the end of the tray (build 125), so a hand can close round the handle without
  // its fingers going through the plate (the handle, probe y 0.02-0.06, is at tray x -0.35 to -0.39; the plate ends at -0.26: 5 cm further out since build 146, when the diagonal grip turned the fingertips over the plate end)
  instr.position.set(-0.33, 0.8215, 0); instr.rotation.set(0, 0, Math.PI / 2); tray.add(instr);
  const other = makeHuman(1, 0x6a7384); other.rotation.x = -Math.PI / 2; other.position.set(2.3, 1.05 + TY, 1.0); g.add(other);
  // lay him on the slab: drop him until his lowest point rests on the top (it was set by eye and floated)
  { other.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(other); other.position.y += 0.877 + TY - TD - bb.min.y; }
  const otherHead = V(2.3, 1.05 + TY - TD, -0.5);
  const lift = levitator(g, other, V(2.3, 0, 0.2), glowM2);
  const greys = [V(-0.75, 0, -0.3), V(0.75, 0, 0.1), V(-0.65, 0, 0.7)].map((p) => { const a = makeGrey(); a.scale.setScalar(1.38); /* sized so their shoulders are level with the table top */ a.position.copy(p); a.rotation.set(0, Math.atan2(-p.x, 0.2 - p.z), 0); g.add(a); return a; });
  // standing by: breathing, watching you, now and then a hand moves (greys marked busy are being choreographed)
  on((dt, t) => {
    for (let i = 0; i < greys.length; i++) {
      const a = greys[i]; if (a.userData.busy) continue;
      idleGrey(a, t + i); aimGrey(a, E.camera.position, 0.85);
      a.userData.armR.rotation.x = -0.12 + Math.sin(t * 0.37 + i * 2.1) * 0.1; a.userData.foreR.rotation.x = -0.25 + Math.sin(t * 0.53 + i) * 0.12;
    }
    rig.rotation.y = Math.sin(t * 0.15) * 0.4;
  });

  setView(0, 1.0 + TY, 0.8, 0, 1.0);
  // your body on the table
  const me = makePlayerBody(); me.rotation.set(Math.PI / 2, 0, 0); me.position.set(0, 0.93 + TY, 0.9); E.scene.add(me);
  me.userData.relax(0.08);
  E.limits = { yaw: 1.45, up: 0.45, down: 0.85 }; E.mode = 'look';
  const tone = A.drone(196, { g: 0.03 }); const tone2 = A.drone(294.5, { g: 0.02 });
  await fade(0, 3, '#fff');
  note('room');
  hint('Look around.');
  await say('White. No lamp anywhere, and no door.');
  // the other table, before anything is done to either of you
  hint('Look to your right.');
  const saw = await until(() => lookingAt(otherHead, 0.35), 9);
  hint('');
  if (saw) { note('others'); await say('On the next table, a man with his eyes open. He does not blink.'); }
  // the eye
  const ED = eyeDevice(steel, V(0, 1.75, -4.93)), eye = ED.eye;
  eye.position.set(0, 1.75, -5); g.add(eye);
  on((dt, t) => { ED.blink.visible = (t * 2.2) % 1 < 0.5; });
  // it travels on its stalk (which always runs back to the port), goes over the man on the next table first, then over you,
  // stopping where it is interested. The sound: a low pulsing hum, soft irregular ticks, a faint high whine.
  const scan = scanSound();
  const eyeAt = (x, y, z) => { eye.position.set(x, y, z); eye.rotation.y = Math.atan2(x, Math.max(0.3, 5 + z)); ED.aimTail(); };
  const glide = (dur, to, ease) => { const from = eye.position.clone(); return tween(dur, (k) => eyeAt(lerp(from.x, to.x, k), lerp(from.y, to.y, k), lerp(from.z, to.z, k)), ease); };
  // a sweep along a body, lingering at a few places: stops = [[z, seconds], ...]
  const sweep = async (x, y, stops) => { for (const [z, s] of stops) { await glide(Math.max(0.6, Math.abs(z - eye.position.z) * 1.6), V(x, y, z)); scan.busy(true); await wait(s); scan.busy(false); } };
  await glide(3, V(1.2, 1.85, -2.2));
  note('eye');
  say('Something slides out of the wall on a long stalk.');
  await glide(1.6, V(2.3, 1.7 + TY, -0.75));
  ED.beam.visible = true;
  await sweep(2.3, 1.7 + TY, [[-0.55, 0.9], [0.0, 0.5], [0.7, 0.4]]);
  ED.beam.visible = false;
  // over you: it drops low over your feet, then travels slowly up the whole length of you to your face, its beam on you;
  // your eyes follow it the whole way
  await glide(2.2, V(0, 1.42 + TY, -1.05));
  ED.beam.scale.set(0.5, 0.42, 0.5); ED.beam.visible = true;
  say('Then it comes to you, and looks at your entire being, slowly.', 'self', 9);
  {
    E.mode = 'locked';
    const y0 = E.yaw, p0 = E.pitch, ev = V(0, 0, 0);
    scan.busy(true);
    await tween(8.5, (k) => {
      const z = lerp(-1.05, 0.6, k), x = 0.05 * Math.sin(k * Math.PI * 5), y = lerp(1.42, 1.5, k) + TY;
      eyeAt(x, y, z);
      const lk = aimAt(ev.set(x, y - 0.22, z)), b = Math.min(1, k * 5);
      E.yaw = lerp(y0, lk.yaw, b); E.pitch = lerp(p0, lk.pitch, b);
    }, (k) => k);
    scan.busy(false);
    // it comes to rest right over your face and stops dead there; your eyes go straight up to it. Only the pitch moves:
    // with it directly overhead the direction you face is undefined, and turning toward it would spin the view round
    { const from = eye.position.clone(), to = V(0, 1.38 + TY, 0.82), pa = E.pitch, pTop = E.base.pitch + (E.limits ? E.limits.up : 0.45);
      await tween(1.3, (k) => {
        const e = k * k * (3 - 2 * k); eyeAt(lerp(from.x, to.x, e), lerp(from.y, to.y, e), lerp(from.z, to.z, e));
        E.pitch = lerp(pa, pTop, e);
      }, (k) => k);
      eyeAt(to.x, to.y, to.z); }
    await wait(0.5);
    // it reads you: the lens and beam go orange, then back to blue
    A.scanLock(); ED.blinkM.color.setHex(0xffa040);
    await tween(0.12, (k) => { ED.shift.value = k; });
    await wait(0.75);
    await tween(0.3, (k) => { ED.shift.value = 1 - k; });
    ED.blinkM.color.setHex(0x66c8ff);
    await wait(0.5);
    E.mode = 'look';
  }
  ED.beam.visible = false;
  await glide(2.6, V(0, 1.75, -5.15));
  eye.visible = false;
  scan.stop();
  // the spine: two of them come to the table and roll you onto your side, the third goes round behind your head
  {
    const [g0, g1] = greys; for (const a of greys) a.userData.busy = true;
    const homeP = greys.map((a) => a.position.clone()), homeR = greys.map((a) => a.rotation.y);
    const spotP = [V(-0.42, 0, 0.35), V(0.66, 0, 0.5), V(0.15, 0, 1.65)], spotR = [Math.PI / 2, -Math.PI / 2, Math.PI];
    const fromP = greys.map((a) => a.position.clone()), fromR = [0, 0, 0];
    const tv = V(0, 0, 0), tA = V(0, 0, 0), tB = V(0, 0, 0), tC = V(0, 0, 0);
    const lerpAng = (a, b, k) => a + ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * k;
    const walk = (dur, P, Rr) => { let ph = 0; greys.forEach((a, i) => { fromP[i].copy(a.position); fromR[i] = a.rotation.y; });
      return tween(dur, (k) => { ph = E.time * GREY_GAIT; for (let i = 0; i < 3; i++) { const a = greys[i]; a.position.lerpVectors(fromP[i], P[i], k); a.rotation.y = lerpAng(fromR[i], Rr[i], k); stepGrey(a, ph, k < 1 ? 1 : 0); idleGrey(a, E.time); aimGrey(a, E.camera.position, 0.8); } }, (k) => k); };
    // points on your body (your own frame: right +x, back +z, eye at the origin) for their hands
    const hands = (amt, press = -1, push = 0) => {
      me.updateMatrixWorld();
      me.localToWorld(tA.set(-0.12, -0.22, 0.2)); pointGrey(g0, 'L', tA, amt, true);                       // back of your shoulder
      if (press < 0) me.localToWorld(tB.set(-0.06, -0.72, 0.19)); else me.localToWorld(tB.set(0, -0.7 + press * 0.056, 0.2 + push));
      pointGrey(g0, 'R', tB, amt, true);                                                                   // your hip, then down your spine
      me.localToWorld(tC.set(0.21, -0.2, 0.0)); pointGrey(g1, 'R', tC, amt, true);                          // the front of your shoulder
      gripGrey(g0, 'L', -0.2 + 0.45 * amt); gripGrey(g0, 'R', -0.2 + 0.4 * amt); gripGrey(g1, 'R', -0.2 + 0.45 * amt);
      aimGrey(g1, E.camera.position, 1); aimGrey(g0, tB, 0.7);
    };
    // roll about the length of the table: the body and the view turn together, exactly
    const q0 = new THREE.Quaternion(), cam0 = V(0, 0, 0), me0 = me.position.clone(), meq0 = me.quaternion.clone();
    const qz = new THREE.Quaternion(), qc = new THREE.Quaternion(), eul = new THREE.Euler(0, 0, 0, 'YXZ'), Z = V(0, 0, 1), lim0 = E.limits;
    const rollTo = (k, jx = 0, jz = 0) => {
      const lift = 0.09 * Math.sin(Math.PI / 2 * k); qz.setFromAxisAngle(Z, -1.0 * k);
      me.quaternion.copy(meq0).premultiply(qz); tv.set(me0.x, me0.y - 0.835 - TY, 0).applyQuaternion(qz); me.position.set(tv.x + jx, 0.835 + TY + lift + tv.y, me0.z + jz);
      tv.set(cam0.x, cam0.y - 0.835 - TY, 0).applyQuaternion(qz); E.camera.position.set(tv.x + jx, 0.835 + TY + lift + tv.y, cam0.z + jz);
      qc.copy(q0).premultiply(qz); eul.setFromQuaternion(qc, 'YXZ'); E.pitch = eul.x; E.yaw = eul.y; E.roll = eul.z;
    };
    await walk(2.0, spotP, spotR);
    await tween(0.6, (k) => hands(k));
    E.mode = 'locked'; E.limits = null; q0.copy(E.camera.quaternion); cam0.copy(E.camera.position);   // roll from wherever you were looking
    await tween(1.2, (k) => { rollTo(k); hands(1); });
    say('Small fingers press down your spine, one bone at a time.');
    // nine presses, from the base of the spine up toward the neck; the one in front watches your face
    for (let i = 0; i < 9; i++) {
      A.tone(180 + i * 38, 0.3, { type: 'triangle', g: 0.09 }); E.shake = 0.02;
      await tween(0.12, (k) => { const j = Math.sin(Math.PI * k) * 0.008; rollTo(1, j, j * 0.35); hands(1, i, -0.02 * Math.sin(Math.PI * k)); g1.userData.head.rotation.z = (i % 2 ? 1 : -1) * 0.12 * Math.sin(Math.PI * k); gripGrey(g1, 'R', 0.25 + 0.25 * Math.sin(Math.PI * k)); }, (k) => k);
      E.shake = 0; await wait(0.3);
    }
    note('piano');
    await tween(1.0, (k) => { rollTo(1 - k); hands(1); });
    E.camera.position.copy(cam0); eul.setFromQuaternion(q0, 'YXZ'); E.pitch = eul.x; E.yaw = eul.y; E.roll = 0; me.position.copy(me0); me.quaternion.copy(meq0);
    E.limits = lim0; E.mode = 'look';
    await tween(0.5, (k) => hands(1 - k));
    g1.userData.head.rotation.z = 0;
    await walk(1.3, homeP, homeR);
    for (const a of greys) a.userData.busy = false;
  }
  // halfway through, with no word about it, the emitter over the man comes on and he rises off his table
  lift.start();

  // ---- the instrument, played dry: two of them take your legs and lift them; the third fetches the very long probe from the
  // tray, comes round to the foot of the table, lines it up, brings it nearly in, stops, has a think, thinks better of it
  // and puts it back. The probe is always held with its shaft pointing away from the holder's head. ----
  {
    const angTo = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
    const [gP, gR, gL] = greys, uP = gP.userData, legs = me.userData.legs, legs0 = legs.rotation.x, LIFT = 1.15, ST = stirrups(legs);
    for (const a of greys) a.userData.busy = true;
    if (window.UAP) window.UAP.exam = { ST, greys, legs, instr, tray, me };   // for test harnesses
    const homeP = greys.map((a) => a.position.clone()), homeR = greys.map((a) => a.rotation.y);
    const tv = V(0, 0, 0), tq = new THREE.Quaternion(), hand = V(0, 0, 0), aimP = V(0, 0, 0);
    const GA = V(0, -0.25, 1).normalize();   // the probe's axis in the hand's frame (gripGrey's baton grip)
    const local = (a, x, y, z, out) => { a.updateWorldMatrix(true, false); return a.localToWorld(out.set(x, y, z)); };
    const tip = () => instr.localToWorld(aimP.set(0, -0.59, 0));
    // turn gP's right wrist so the probe's axis points along dir (world)
    // Build 146: the hand first rolls about the forearm (as a forearm turns, up to 135 degrees either way) to bring the shaft
    // round to the side it must point, and only bends at the wrist for what is left. It used to take the shortest turn, all
    // of it a bend: the wrist sat cocked back 75-99 degrees the whole time it held the probe.
    const twQ = new THREE.Quaternion(), twA = V(0, 0, 0), twY = V(0, 1, 0); let twLast = 0;
    const wristTo = (dir) => {
      const hd = uP.handR, ga = uP.gripAxisR || GA; tv.copy(dir).normalize(); hd.parent.getWorldQuaternion(tq).invert(); tv.applyQuaternion(tq);
      // the turn nearest last frame's (no flip from one side to the other when the shaft points straight back)
      let ph = Math.atan2(tv.x, tv.z) - Math.atan2(ga.x, ga.z); ph = twLast + Math.atan2(Math.sin(ph - twLast), Math.cos(ph - twLast));
      if (Math.hypot(tv.x, tv.z) < 0.05) ph = twLast;   // along the forearm: no side to turn toward
      ph = Math.max(-2.4, Math.min(2.4, ph)); twLast = ph;
      twQ.setFromAxisAngle(twY, ph); twA.copy(ga).applyQuaternion(twQ);
      hd.quaternion.setFromUnitVectors(twA, tv).multiply(twQ);
    };
    // walk a grey through some points, facing where it goes, then turn to endR. post() runs after the step every frame
    // the stride eases in over the first 0.4 s (it started at full stride in one frame: the body and anything carried jumped)
    const walkPath = async (a, pts, endR, look, post) => {
      let ph = 0, amt = 0, tPrev = E.time;
      // the stride eases toward each phase's size (none, half on the spot, full walking) instead of switching: it went from
      // half to full in one frame as a turn on the spot ended, the body twisted and the carrying arm jumped 11 cm (build 125)
      const stride = (target) => { const dt = Math.max(0, E.time - tPrev); tPrev = E.time; amt += (target - amt) * Math.min(1, dt * 5); return amt; };
      // with post (something else poses its arms, e.g. carrying the probe) the walk cycle leaves the arms alone: it wrote the
      // arms' angles before the carry re-solved them, and the first frame of a walk moved the elbow 7 cm (build 125)
      const armQ = [], arms = [a.userData.armR, a.userData.foreR, a.userData.handR, a.userData.armL, a.userData.foreL, a.userData.handL];
      const step = (amtNow) => { if (post) arms.forEach((o, i) => { armQ[i] = (armQ[i] || o.quaternion.clone()).copy(o.quaternion); }); stepGrey(a, ph, amtNow); if (post) arms.forEach((o, i) => o.quaternion.copy(armQ[i])); };
      const TURN = 1.6;   // radians a second: a big turn is made on the spot first, stepping (build 124: it spun 140 degrees in 5 frames)
      for (const p of pts) {
        const from = a.position.clone(), hd = Math.atan2(p.x - from.x, p.z - from.z);
        let r0 = a.rotation.y; const dTurn = Math.abs(Math.atan2(Math.sin(hd - r0), Math.cos(hd - r0)));
        if (dTurn > 0.5) { const rs = r0; await tween(dTurn / TURN, (k) => { ph = E.time * GREY_GAIT; a.rotation.y = angTo(rs, hd, k); step(stride(0.5)); if (look) aimGrey(a, look(), 0.8); if (post) post(); }); r0 = a.rotation.y; }
        await tween(Math.max(0.5, from.distanceTo(p) / 0.45), (k) => { ph = E.time * GREY_GAIT; a.position.lerpVectors(from, p, k); a.rotation.y = angTo(r0, hd, Math.min(1, k * 3)); step(stride(1)); if (look) aimGrey(a, look(), 0.8); if (post) post(); }, (k) => k);
      }
      const r0 = a.rotation.y, dEnd = Math.abs(Math.atan2(Math.sin(endR - r0), Math.cos(endR - r0)));
      await tween(Math.max(0.6, dEnd / TURN), (k) => { ph = E.time * GREY_GAIT; a.rotation.y = angTo(r0, endR, k); step(stride(0) * (1 - k)); if (look) aimGrey(a, look(), 0.8); if (post) post(); });
    };
    // the probe in gP's right hand: the hand goes to a point, then the wrist turns the shaft toward another
    // The probe arm is solved continuously while it holds the probe (build 124): pointGrey's reach switched between its plain
    // pose and its collision fallback on alternate frames while the grey walked with it, so the arm and the probe flickered
    // between two places every frame (a double image: 27 cm at the elbow, 16 at the wrist). fistTo keeps a wrist target from
    // frame to frame (fW), solves the arm with clearGreyArm (its elbow turn starts from the last frame's, the probe counts as
    // part of the arm for collision), and corrects the wrist by where the fingertips land with the hand unturned, as
    // pointGrey's reach did. dir: the shaft's world direction, a function (handPos, out) => direction, or null for a flat hand.
    const fW = V(0, 0, 0), fT = V(0, 0, 0), fP = V(0, 0, 0), fA = V(0, 0, 0), fB = V(0, 0, 0), fD = V(0, 0, 0), fPole = V(0, 0, 0), fQ = new THREE.Quaternion();
    let fLive = false, armPrev = null, armBase = null, armT = -1, armDt = 1 / 30;
    const fQ2 = new THREE.Quaternion();
    const fistTo = (fist, dir, w = 1) => {   // w < 1 turns the hand only part of the way from straight
      const hd = uP.handR;
      if (window.UAP) window.UAP.fist = fist;   // for test harnesses
      if (!fLive) { gP.updateMatrixWorld(true); hd.getWorldPosition(fW); fLive = true; armPrev = armBase = null; armT = -1; }
      // the arm as it was at the end of the last frame (fistTo runs several times a frame)
      if (E.time !== armT) { if (armPrev) { armBase = armBase || [new THREE.Quaternion(), new THREE.Quaternion()]; armBase[0].copy(armPrev[0]); armBase[1].copy(armPrev[1]); } armDt = armT < 0 ? 1 / 30 : E.time - armT; armT = E.time; }
      gP.updateMatrixWorld(true); fPole.set(1, -0.35, -0.55).normalize().applyQuaternion(uP.root.getWorldQuaternion(fQ));
      const orient = () => {
        if (!dir) hd.quaternion.identity();
        else { gP.updateMatrixWorld(true); hd.getWorldPosition(fP); wristTo(typeof dir === 'function' ? dir(fP, fD) : dir); if (w < 1) { fQ2.copy(hd.quaternion); hd.quaternion.identity().slerp(fQ2, w); } }
        return instr.parent === hd ? heldSegment(instr, fA, fB) : null;
      };
      for (let i = 0; i < 3; i++) {
        clearGreyArm(gP, 'R', fW, fPole, orient);
        hd.quaternion.identity(); gP.updateMatrixWorld(true); uP.tipsR.getWorldPosition(fT); fW.addScaledVector(fT.subVectors(fist, fT), 0.8);
      }
      clearGreyArm(gP, 'R', fW, fPole, orient);
      // the shoulder and elbow turn at most 2.4 rad a second of game time (0.08 a frame at 30 fps; build 146): when the solver's elbow swings to another side to
      // keep clear of the body (the waddle twists the chest into the carrying arm), it went 13-15 cm in one frame
      // (only when the held-back pose is itself clear of the body; otherwise the solver's clear pose stands)
      if (armBase) { const maxA = Math.max(0.01, 2.4 * armDt), keep = [uP.armR.quaternion.clone(), uP.foreR.quaternion.clone()]; let lim = false; [uP.armR, uP.foreR].forEach((o, i) => { const ang = armBase[i].angleTo(o.quaternion); if (ang > maxA) { lim = true; o.quaternion.copy(armBase[i].clone().slerp(o.quaternion, maxA / ang)); } }); gP.updateMatrixWorld(true); if (lim && greyArmHits(gP, 'R', orient())) { uP.armR.quaternion.copy(keep[0]); uP.foreR.quaternion.copy(keep[1]); gP.updateMatrixWorld(true); } }
      orient(); armPrev = armPrev || [new THREE.Quaternion(), new THREE.Quaternion()]; armPrev[0].copy(uP.armR.quaternion); armPrev[1].copy(uP.foreR.quaternion);
    };
    const holdAt = (fist, toward) => { fistTo(fist, (h, out) => out.subVectors(toward, h)); gripGrey(gP, 'R', 1); };
    // the two at your legs: a hand under each calf (the one on your left also steadies your knee); legK lifts, handK reaches
    let legK = 0, handK = 0, holding = false, watchL = null, watchR = null;
    const h1 = V(0, 0, 0), h2 = V(0, 0, 0), h3 = V(0, 0, 0), h4 = V(0, 0, 0), w1 = V(0, 0, 0), w2 = V(0, 0, 0), w3 = V(0, 0, 0);
    // after pointGrey: turn the whole arm about the shoulder-to-target line so the elbow is as high as it can be (the fingertips
    // stay put). Reaching up from beside the table, the elbow otherwise drops under the table top and the forearm goes through it.
    const eA = V(0, 0, 0), eS = V(0, 0, 0), eE = V(0, 0, 0), eU = V(0, 0, 0), eQ = new THREE.Quaternion(), eP = new THREE.Quaternion();
    const elbowUp = (a, sd, target, k = 1) => {
      const u = a.userData, sh = sd === 'L' ? u.armL : u.armR, el = sd === 'L' ? u.foreL : u.foreR;
      sh.getWorldPosition(eS); el.getWorldPosition(eE); eA.subVectors(target, eS).normalize();
      eE.sub(eS); eE.addScaledVector(eA, -eE.dot(eA)); eU.set(0, 1, 0).addScaledVector(eA, -eA.y);
      if (eE.lengthSq() < 1e-8 || eU.lengthSq() < 1e-8) return;
      const ang = Math.atan2(eA.dot(eS.crossVectors(eE, eU)), eE.dot(eU));
      sh.parent.getWorldQuaternion(eP).invert(); eA.applyQuaternion(eP);
      sh.quaternion.premultiply(eQ.setFromAxisAngle(eA, ang * k));
    };
    const lift = (v) => { v.y += 0.04 * (1 - legK); return v; };   // while your legs are still flat, take hold from just above
    // turn the arm about the shoulder-to-aim line so the elbow points toward pole (world): out and up, away from the table
    const elbowTo = (a, sd, aimPt, pole, k) => {
      const u = a.userData, sh = sd === 'L' ? u.armL : u.armR, el = sd === 'L' ? u.foreL : u.foreR;
      sh.getWorldPosition(eS); el.getWorldPosition(eE); eA.subVectors(aimPt, eS).normalize();
      eE.sub(eS); eE.addScaledVector(eA, -eE.dot(eA)); eU.copy(pole).addScaledVector(eA, -pole.dot(eA));
      if (eE.lengthSq() < 1e-8 || eU.lengthSq() < 1e-8) return;
      const ang = Math.atan2(eA.dot(eS.crossVectors(eE, eU)), eE.dot(eU));
      sh.parent.getWorldQuaternion(eP).invert(); eA.applyQuaternion(eP);
      sh.quaternion.premultiply(eQ.setFromAxisAngle(eA, ang * k));
    };
    // put the fingers on a point on the leg: aim, swing the elbow down and out, then correct the aim by what's left over
    const cT = V(0, 0, 0), aims = [V(0, 0, 0), V(0, 0, 0), V(0, 0, 0), V(0, 0, 0)];
    // elbows out and up, away from the table: pointing down, they went under the table top and the forearms came through it
    // elbows flared out to each grey's sides, along the table (the head-end arm toward your head, the other toward your feet),
    // a little up and back from the table edge; the table is low enough now that nothing has to go up through it
    const LIFT_CLEAR = 0.3, TABLE_TOP = 0.675 - TD;   // legK when the calf is about 9 cm clear of the table top (measured: 3 cm at 0.15); the top slab's upper face
    const poleLU = V(-0.75, 0.05, 0.5).normalize(), poleRU = V(0.75, 0.05, 0.5).normalize();   // under-calf hands: elbows out to the side, level (pointing down they went into the table edge)
    const poleLH = V(-0.35, 0.25, 1).normalize(), poleLF = V(-0.35, 0.25, -1).normalize(), poleRH = V(0.35, 0.25, 1).normalize(), poleRF = V(0.35, 0.25, -1).normalize();
    // while the hand comes in (k < 1) it aims at a point above and outside the table edge that slides onto the leg, so the
    // hand rises clear of the table side and comes over the top, instead of sweeping through the edge from where it hung
    const cIn = V(0, 0, 0);
    // Solved like a robot arm with the grey's own body as an obstacle (models.js clearGreyArm, build 122: pointGrey plus
    // elbowTo put a forearm through its own chest): av is the wrist that puts the fingertips on cIn (corrected from the last
    // frame), the elbow points toward pole and is turned further if any of the arm would be inside the grey. While the hand
    // comes in, the wrist eases from where it hung (hangW) to av.
    const hangW = new Map(), hangQ = new Map(), wB = V(0, 0, 0);
    // The hands close round your legs (build 123; before, only the fingertips were put on a point and the fingers hung half
    // open). The palm lies flat on the shin facing its axis, the fingers run round the leg toward its inner side, and each
    // finger joint curls until it meets the leg (solved every frame, so the grip follows the legs as they lift). While the
    // hand comes in (k < 1) it is open and held back, up and out from the leg, and the fingers close as it arrives.
    // sg: your leg (-1 left); d: metres below the knee; (ox, bz): the side of the leg the palm is on, outward and back (-bz
    // is the front of the shin).
    const LEG_R = 0.056, LEG_Z = 0.016, FING_HALF = 0.0085, TIP_HALF = 0.007;   // the trouser leg's radius and axis offset (measured by ray, 5.2-5.8 cm round its axis) and the fingers' half thickness
    const hA = V(0, 0, 0), hAx = V(0, 0, 0), hR = V(0, 0, 0), hIn = V(0, 0, 0), hF = V(0, 0, 0), hZ = V(0, 0, 0), hC = V(0, 0, 0), hW = V(0, 0, 0), hX = V(0, 0, 0), hT = V(0, 0, 0);
    const hM = new THREE.Matrix4(), hL = new THREE.Matrix4(), hQ = new THREE.Quaternion(), hPq = new THREE.Quaternion(), hId = new THREE.Quaternion();
    const legDist = (p) => { hX.subVectors(p, hA); hX.addScaledVector(hAx, -hX.dot(hAx)); return hX.length(); };
    // the largest curl (0..max) of one joint that keeps the point it carries outside the leg
    const curlTo = (joint, s, max, pt, local, clear) => {
      // outside the leg, and above your table's top while over it (build 124: with your leg lying flat the fingers wrapped
      // round its inside and down into the table)
      const at = (x) => { joint.rotation.z = -s * x; joint.updateMatrixWorld(true); pt.localToWorld(hT.copy(local)); return (Math.abs(hT.x) > 0.43 || hT.y > TABLE_TOP + 0.008) && legDist(hT) >= clear; };
      let lo = 0, hi = max;
      if (!at(0)) { joint.rotation.z = 0; joint.updateMatrixWorld(true); return 0; }
      if (at(max)) return max;
      for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (at(m)) lo = m; else hi = m; }
      at(lo); return lo;
    };
    const TIP_END = V(0, -0.04, 0), BASE_PT = V(0, 0, 0);
    // side = true: the hand comes in from the outside, level (the one going under the calf), not down from above
    const holdLeg = (a, sd, sg, d, ox, bz, pole, k, out, side = false) => {
      const e = 1 - k, u = a.userData, s = sd === 'L' ? -1 : 1, sc = a.scale.x;
      const hd = sd === 'L' ? u.handL : u.handR, fi = sd === 'L' ? u.fingersL : u.fingersR, ti = sd === 'L' ? u.tipsL : u.tipsR;
      // the leg here: a point on its axis, the axis, the side the palm goes on, and the way round to the inside of the leg
      ST.pt(sg, d, LEG_Z, hA); ST.pt(sg, d + 0.05, LEG_Z, hAx).sub(hA).normalize();
      ST.pt(sg, d, LEG_Z + bz, hR, ox).sub(hA); hR.addScaledVector(hAx, -hR.dot(hAx)).normalize();
      ST.pt(sg, d, LEG_Z, hIn, -0.05).sub(hA);
      hF.crossVectors(hAx, hR); if (hF.dot(hIn) < 0) hF.negate();
      // hand frame (palm -x for the right hand, +x for the left; fingers -y; z across the knuckles) onto palm -> axis, fingers round
      hZ.crossVectors(hR, hF).multiplyScalar(-s);
      hM.makeBasis(hX.copy(hR).negate(), hF, hZ);
      hL.makeBasis(hT.set(-s, 0, 0), hC.set(0, -1, 0), hW.set(0, 0, 1)).transpose();
      hQ.setFromRotationMatrix(hM.multiply(hL));
      // the palm's middle on the cloth (approaching: back off the side it comes to, and up; not out toward the grey, or the
      // wrist comes in past its own chest)
      if (!side) { hC.copy(hA).addScaledVector(hR, LEG_R + 0.006 + 0.1 * e); hC.y += 0.25 * e; }
      else { ST.pt(sg, d, LEG_Z, hT, 0.05).sub(hA).normalize(); hC.copy(hA).addScaledVector(hR, LEG_R + 0.006).addScaledVector(hT, 0.16 * e); }
      if (out) out.copy(hC);
      hW.set(-s * 0.010, -0.024, 0.002).multiplyScalar(sc).applyQuaternion(hQ); hW.subVectors(hC, hW);
      const key = a.id + sd;
      // where the hand hung, kept in the grey's own frame so it moves with the grey as it shuffles
      if (!hangW.has(key)) { a.updateMatrixWorld(true); hangW.set(key, a.worldToLocal(hd.getWorldPosition(V(0, 0, 0)))); hangQ.set(key, a.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(hd.getWorldQuaternion(new THREE.Quaternion()))); }
      const w = sm2(k), turn = side ? sm2((k - 0.35) / 0.5) : sm2((k - 0.15) / 0.6);   // the under hand turns palm up only once it has risen beside the table (turning low, its fingers swung into the table edge)   // eased over the whole reach (it went most of the way in the first fifth: a 13 cm jump a frame)
      // the hand keeps the angle it hung at (in the grey's frame) until it turns to the grip: left straight along the forearm
      // while the elbow swung out, an under-hand pointed in and down into the table for a frame
      const orient = () => { a.getWorldQuaternion(hId).multiply(hangQ.get(key)).slerp(hQ, turn); hd.parent.getWorldQuaternion(hPq).invert(); hd.quaternion.copy(hPq.multiply(hId)); return null; };
      // the wrist's way in: up beside the table first, then across to the leg (a curve through a point straight above where it
      // hung, at the height it is going to: in a straight line from where it hung, below the table top, it cut through the
      // table's edge)
      // (and bowed out from its side: rising straight up its flank, the hand went through its hip)
      { const h0 = a.localToWorld(hT.copy(hangW.get(key))), ie = 1 - w; hX.subVectors(h0, a.position).setY(0).normalize().multiplyScalar(0.12).add(h0); hX.y = Math.max(h0.y, hW.y) + (side ? 0.03 : 0.08); wB.copy(h0).multiplyScalar(ie * ie).addScaledVector(hX, 2 * w * ie).addScaledVector(hW, w * w); }
      clearGreyArm(a, sd, wB, pole, orient);
      orient(); a.updateMatrixWorld(true);
      // fingers: thumb a little in, then each joint curled till it meets the leg; open while the hand is still coming
      gripGrey(a, sd, 0.25 * sm2((k - 0.55) / 0.45));
      fi.rotation.z = 0; ti.rotation.z = 0;
      const close = sm2((k - 0.55) / 0.45), ca = curlTo(fi, s, 1.7, ti, BASE_PT, LEG_R + FING_HALF);
      fi.rotation.z = -s * ca * close; fi.updateMatrixWorld(true);
      ti.rotation.z = -s * curlTo(ti, s, 2.0, ti, TIP_END, LEG_R + TIP_HALF) * close;
    };
    const sm2 = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
    const holders = on((dt, t) => {
      if (!holding) return;
      // thighs up and spread, knees bent, feet up: as if in stirrups
      legs.rotation.x = legs0 + (LIFT - legs0) * legK; ST.set(0.32 * legK, 1.3 * legK);
      // they shuffle up the table with your legs as they lift them (the hold points move 25 cm toward your head; standing
      // still, the hand nearer your head had to reach across its own chest while your legs were flat)
      { const z = lerp(spotL.z, -0.14, legK), w = 0.6 * Math.sin(Math.PI * legK); gL.position.z = gR.position.z = z; stepGrey(gL, E.time * GREY_GAIT, w); stepGrey(gR, E.time * GREY_GAIT + Math.PI, w); }
      idleGrey(gL, t); idleGrey(gR, t + 2);   // breathing first: it turns the hands, which the grip then sets
      // each takes one leg in both hands, one above it and one below (build 124): the hand by the ankle over the top
      // of the shin, fingers round the inside; the hand nearer your head under the calf, palm up, fingers curling up round
      // the inside. A hand cannot go under a leg lying on the table, so the top hand takes hold first and starts the lift,
      // and the other slides in under the calf from the outside once it is clear of the table (k1 follows the lift, and
      // comes out again before the leg is back down). gL faces +x, so its left hand is the one nearer your head; gR the
      // other way round.
      const k1 = sm2((legK - LIFT_CLEAR) / 0.3) * handK;
      holdLeg(gL, 'L', -1, 0.12, 0.015, 0.05, poleLU, k1, h1, true);
      holdLeg(gL, 'R', -1, 0.23, 0, -0.05, poleLF, handK, h2);
      holdLeg(gR, 'R', 1, 0.12, 0.015, 0.05, poleRU, k1, h3, true);
      holdLeg(gR, 'L', 1, 0.23, 0, -0.05, poleRF, handK, h4);
      aimGrey(gL, watchL ? watchL() : h1, 0.9); aimGrey(gR, watchR ? watchR() : h3, 0.9);
    });
    const spotL = V(-0.6, 0, -0.3), spotR = V(0.6, 0, -0.3);   // level with the middle of your shins while your legs are flat
    const restW = instr.getWorldPosition(V(0, 0, 0)), grip = local(tray, -0.37, 0.83, 0, V(0, 0, 0)), probeDir = V(1, -0.02, 0);
    // the probe placed by where it lands, not by the fingertips: its ring end (its origin) to world point w, shaft along d;
    // the fist (pa, warm-started) is corrected by where the probe ends up. low: where it lies, lifted clear of the tray
    // in the grey's hand the probe would take on the grey's size (1.38): it grew by a third when picked up and stayed that
    // big on the tray (build 123), so its own scale undoes the grey's
    // and it is held by its ringed grip (probe y 0.02-0.06): models.js gripGrey reads userData.gripAt
    instr.userData.gripAt = 0.04;
    // held diagonally across the palm, as a hand holds a rod it means to point (build 146): 55 degrees off the forearm, not
    // the wand's 76, so pointing it ahead does not cock the wrist right back
    instr.userData.gripAxis = V(0, -0.7, 1).normalize();
    const holdProbe = () => { instr.scale.setScalar(1 / gP.scale.x); gripGrey(gP, 'R', 1, instr); };
    const pa = V(0, 0, 0), pb = V(0, 0, 0), pick = V(0, 0, 0), low = restW.clone().setY(restW.y + 0.03);   // 3 cm: at 2.2 the fingertips under it touched the plate
    const probeTo = (w, d) => { for (let i = 0; i < 3; i++) { fistTo(pa, d); gripGrey(gP, 'R', 1); gP.updateMatrixWorld(true); instr.getWorldPosition(pb); pa.add(pb.subVectors(w, pb)); } aimGrey(gP, restW, 1); };
    const traySpot = V(-1.03, 0, -1.14), footSpot = V(0, 0, -1.27), footR = 0;   // at the foot of the table, square on, between your feet (9 cm nearer since build 125: holding the probe by its rings puts the tip 9 cm nearer the fist, and the arm was already at full stretch)
    const mePos = me.position.clone();
    // the fetcher sets off first; the other two come to your legs
    lookToward(V(-0.6, 1.05 + TY, -0.7), 1.6);
    await Promise.all([
      walkPath(gP, [V(-0.95, 0, -0.9), traySpot], Math.PI, () => restW),
      (async () => { await wait(0.5); await walkPath(gL, [V(-0.74, 0, 0.3), spotL], Math.PI / 2, () => mePos); })(),
      walkPath(gR, [spotR], -Math.PI / 2, () => E.camera.position),
    ]);
    // you lift your head to see down yourself
    const lim0 = E.limits, cam0 = E.camera.position.clone(), camUp = cam0.clone().add(V(0, 0.2, -0.1));
    E.mode = 'locked'; E.limits = null;
    { const lk = aimAt(V(0, 1.02 + TY, -0.5)); moveView(1.4, { yaw: lk.yaw, pitch: lk.pitch, pos: camUp }); }
    holding = true;
    note('instrument');
    say('Two of them take your legs and lift them, knees bent, feet up...', 'self', 4.5);
    await Promise.all([
      (async () => { await tween(0.8, (k) => { handK = k; }); await tween(2.4, (k) => { legK = k; }); })(),
      (async () => {
        // the hand goes to the probe's grip, already turned to lie along it, and closes on it. Where the fist must be is
        // found by holding the probe for a moment out of sight (between frames) and solving the fist so the probe lies where
        // it is, lifted 2.2 cm (the fingers go under it); then it is put back. pointGrey puts the fingertips on a point and
        // the probe sits below them in the fist, so reaching for the grip point itself pulled the probe down through the
        // tray as the hand closed (build 123).
        const tips0 = V(0, 0, 0), over = V(0, 0, 0), fv0 = V(0, 0, 0), pickW = V(0, 0, 0), pickQ = new THREE.Quaternion(), pq0 = new THREE.Quaternion(), hpq = new THREE.Quaternion();
        {
          const p0 = instr.position.clone(), q0 = instr.quaternion.clone(), arm = [uP.armR, uP.foreR, uP.handR, uP.fingersR, uP.tipsR, uP.thumbR].filter(Boolean), aq = arm.map((o) => o.quaternion.clone());
          holdProbe(); pa.copy(grip);
          for (let i = 0; i < 4; i++) probeTo(low, probeDir);
          pick.copy(pa); gP.updateMatrixWorld(true); uP.handR.getWorldPosition(pickW); uP.handR.getWorldQuaternion(pickQ); tray.add(instr); instr.position.copy(p0); instr.quaternion.copy(q0); instr.scale.setScalar(1); uP.gripAxisR = null; uP.heldR = null;
          arm.forEach((o, i) => o.quaternion.copy(aq[i])); fLive = false;   // the arm and fingers back as they hung; the solver starts from there (build 150: the fingers stayed closed from the dry run for one frame, the tips 7 mm into its own knee)
          gP.updateMatrixWorld(true); uP.handR.getWorldPosition(tips0); over.copy(pickW); over.y += 0.15;
        }
        // the reach comes down onto it from above (a curve through a point 15 cm over the grip), the hand turning as it comes
        // The wrist itself goes to where the dry run had it, and the hand turns to the dry run's angle (build 124): reaching
        // for the fingertip point instead, the arm could settle on another elbow angle, the wrist landed elsewhere and the
        // probe dropped into the tray as the hand closed.
        uP.handR.getWorldQuaternion(pq0);
        // up and over to 15 cm above the grip, the hand turning on the way, then straight down onto it (build 146: on a curve
        // still coming down sideways, the fingertips went 1 cm into the plate)
        await tween(0.9, (k) => {
          if (k < 0.6) { const q = sm2(k / 0.6); fv0.lerpVectors(tips0, over, q); fv0.y += 0.06 * Math.sin(Math.PI * q); } else fv0.lerpVectors(over, pickW, sm2((k - 0.6) / 0.4));
          gP.updateMatrixWorld(true); fPole.set(1, -0.35, -0.55).normalize().applyQuaternion(uP.root.getWorldQuaternion(fQ));
          // turned to the grip by the time it starts down (build 146: still turning at the end, the fingertips dipped 1 cm into the plate)
          const orient = () => { gP.updateMatrixWorld(true); uP.handR.parent.getWorldQuaternion(hpq).invert(); uP.handR.quaternion.copy(hpq.multiply(fQ2.slerpQuaternions(pq0, pickQ, sm2(k / 0.6)))); return null; };
          clearGreyArm(gP, 'R', fv0, fPole, orient); orient(); gripGrey(gP, 'R', 0.3 * k); aimGrey(gP, grip, k);
        });
        A.tone(3100, 0.05, { g: 0.02 }); A.tone(4300, 0.04, { g: 0.01 });
        // on the tray the fingers close only part way (a full fist round a probe lying there put them through the plate); they
        // finish closing as it comes up
        holdProbe(); gripGrey(gP, 'R', 0.35); gP.updateMatrixWorld(true); uP.handR.getWorldPosition(fW); fLive = true;
        // up in front of it and out to its right, held up and turned slowly so it can look along it
        const f0 = V(0, 0, 0), t0 = V(0, 0, 0);
        await tween(2.2, (k) => {
          local(gP, 0.2, lerp(0.8, 0.92, Math.min(1, k * 2)), 0.3, f0);
          local(gP, lerp(0.7, 0.9, k), lerp(1.6, 1.15, k), lerp(0.5, 0.9, k), t0);
          // the shaft turns up from lying level as it rises (it used to point up at once: the tip jumped a metre in a frame)
          const tk = Math.min(1, k * 1.2), turnK = tk * tk * (3 - 2 * tk);
          const rk = Math.min(1, k * 2); fistTo(f0.lerpVectors(pick, f0, rk * rk * (3 - 2 * rk)), (h, out) => out.subVectors(t0, h).normalize().lerp(probeDir, 1 - turnK).normalize()); gripGrey(gP, 'R', Math.min(1, 0.35 + 0.65 * sm2(k / 0.3))); aimGrey(gP, tip(), 1);
        });
        // from where the lift ends into the carrying pose before it sets off (the walk used to start in the carrying pose:
        // the probe's tip moved 54 cm in one frame)
        { const fA = f0.clone(), tA = t0.clone(), cf2 = V(0, 0, 0), ct2 = V(0, 0, 0), fm = V(0, 0, 0), tm = V(0, 0, 0);
          await tween(0.7, (k) => { local(uP.root, 0.2, 0.95, 0.24, cf2); local(uP.root, 0.3, 1.9, 0.85, ct2); holdAt(fm.lerpVectors(fA, cf2, k), tm.lerpVectors(tA, ct2, k)); aimGrey(gP, tip(), 1); }); }
      })(),
    ]);
    // round the foot of the table, the probe carried upright and out in front
    const cf = V(0, 0, 0), ct = V(0, 0, 0);
    const carry = () => holdAt(local(uP.root, 0.2, 0.95, 0.24, cf), local(uP.root, 0.3, 1.9, 0.85, ct));   // in its body's frame, so the fist rocks with the waddle instead of the chest rocking into the arm
    watchL = watchR = () => tip();
    // straight between the stand and the table's corner (build 149: it went round the far side of the stand; with the stand
    // 15 cm further out the straight line clears the plate and the table's rim)
    await walkPath(gP, [footSpot], footR, () => tip(), carry);
    // lines it up and brings it in, slowly, nearly all the way
    say('The third comes round to the foot of the table with a long chrome probe, and lines it up...', 'self', 4.5);
    // Build 146: aimed lower and closer. Your backside is low between your raised legs
    // (measured: the middle's rearmost point at about y 0.63, z 0.05; the thighs are above y 0.84 from z -0.05 down the table),
    // so the probe comes in low and level along the table between your legs and stops a few centimetres short of it. It was
    // held up by your feet, its tip 53 cm short and 25 cm high. It is placed by the probe itself (its ring end to a point, the
    // shaft along a direction), not by the fingertips. To reach, the grey leans in from the hips with its feet planted (body
    // turned about the hip, legs turned back), as the bedroom grey does to climb onto the bed.
    const BS = V(0, 0.63, 0.05), PL = 0.62;   // your backside; the probe's ring end to its tip
    const D1 = V(0, 0.03, 1).normalize(), DA = V(0, -0.1, 1).normalize();
    const O1 = BS.clone().addScaledVector(D1, -(0.07 + PL));   // the tip 7 cm short of you
    const OA = O1.clone().add(V(0, 0.12, -0.14));                // lined up first, a little higher and further back
    const LEAN_A = 0.35, LEAN_1 = 0.65;
    const fv = V(0, 0, 0), OV = V(0, 0, 0), DV = V(0, 0, 0);
    let leanK = 0; const leg0R = uP.legR.rotation.x, leg0L = uP.legL.rotation.x;
    const lean = (L) => { leanK = L; uP.root.rotation.set(L, 0, 0); uP.root.position.set(0, 0.36 - 0.36 * Math.cos(L), -0.36 * Math.sin(L)); uP.legR.rotation.x = leg0R - L; uP.legL.rotation.x = leg0L - L; };
    // aimGrey aims in the upright frame: take the lean off the neck
    const look = (pt, k = 1) => { aimGrey(gP, pt, k); uP.neck.rotation.x -= leanK * k; };
    const lineTo = (o, d) => { for (let i = 0; i < 3; i++) { fistTo(pa, d); gripGrey(gP, 'R', 1); gP.updateMatrixWorld(true); instr.getWorldPosition(pb); pa.add(pb.subVectors(o, pb)); } };
    // from carrying it upright into line with you, leaning in as it comes down level
    { gP.updateMatrixWorld(true); uP.tipsR.getWorldPosition(pa); const o0 = instr.getWorldPosition(V(0, 0, 0)), d0 = tip().clone().sub(o0).normalize();
      await tween(1.4, (k) => { lean(LEAN_A * k); lineTo(OV.lerpVectors(o0, OA, k), DV.lerpVectors(d0, DA, k).normalize()); look(tip()); }); }
    // your heart races while it is near, until the probe is back on the tray
    // and you breathe hard and fast, shakily, in and out
    let hbT = 0, brT = 0.2, inh = true;
    const pound = on((dt) => {
      hbT -= dt; if (hbT <= 0) { hbT = 0.38; A.heartbeat(0.9); }
      brT -= dt; if (brT <= 0) { brT = (inh ? 0.42 : 0.5) + Math.random() * 0.12; A.breath(inh, inh ? 0.4 : 0.48, 0.95); inh = !inh; }
      E.shake = 0.005;
    });
    await tween(2.8, (k) => { lean(lerp(LEAN_A, LEAN_1, k)); lineTo(OV.lerpVectors(OA, O1, k), DV.lerpVectors(DA, D1, k).normalize()); look(tip()); });
    // it stops. A look at the one on the left, at the one on the right, back at the end of the probe; an inch more; no
    await wait(0.7);
    const hU = uP.head;
    watchL = watchR = () => w3.copy(gP.position).setY(1.05);
    await tween(0.9, (k) => { aimGrey(gP, local(gL, 0, 1.0, 0, w1), k); uP.neck.rotation.x -= leanK; hU.rotation.z = 0.12 * k; });
    await wait(0.5);
    await tween(1.0, (k) => { local(gL, 0, 1.0, 0, w1); local(gR, 0, 1.0, 0, w2); look(w1.lerp(w2, k)); hU.rotation.z = 0.12 - 0.26 * k; });
    await wait(0.5);
    watchL = watchR = () => tip();
    await tween(0.8, (k) => { local(gR, 0, 1.0, 0, w2); look(w2.lerp(tip(), k)); hU.rotation.z = -0.14 * (1 - k); });
    // an inch more: the tip to 3.5 cm from you, and back
    await tween(0.6, (k) => { lineTo(OV.copy(O1).addScaledVector(D1, 0.035 * Math.sin(Math.PI * k)), D1); look(tip()); });
    await wait(0.6);
    say('...They stop, consider the matter at some length, and think better of it. The probe goes back on the tray.', 'self', 6);
    await tween(0.9, (k) => { hU.rotation.z = 0.1 * Math.sin(Math.PI * k); look(tip()); });
    hU.rotation.z = 0;
    // withdraw, probe back upright; your legs come down; it goes back round to the tray
    await tween(1.4, (k) => { lean(lerp(LEAN_1, LEAN_A, k)); lineTo(OV.lerpVectors(O1, OA, k), DV.lerpVectors(D1, DA, k).normalize()); look(tip()); });
    // into the carrying pose, the shaft aimed from the wrist the way the carry aims it (aimed from the fist, it snapped 7 cm
    // as the walk began)
    { const cf3 = V(0, 0, 0), ct3 = V(0, 0, 0), d3 = V(0, 0, 0), lk3 = V(0, 0, 0), pA = pa.clone();
      await tween(1.1, (k) => { lean(LEAN_A * (1 - k)); local(uP.root, 0.2, 0.95, 0.24, cf3); local(uP.root, 0.3, 1.9, 0.85, ct3); look(lk3.lerpVectors(tip(), restW, k), 1 - 0.2 * k); fistTo(fv.lerpVectors(pA, cf3, k), (h, out) => out.copy(DA).lerp(d3.subVectors(ct3, h).normalize(), k).normalize()); gripGrey(gP, 'R', 1); }); }
    lean(0);   // its eyes move to the tray as it goes (the walk looks there: the head snapped, and the arm, kept clear of the head, jumped with it)
    const lower = (async () => { await tween(2.0, (k) => { legK = 1 - k; }); await tween(0.6, (k) => { handK = 1 - k; }); holding = false; legs.rotation.x = legs0; ST.set(0, 0); })();
    watchL = watchR = null;
    await walkPath(gP, [traySpot], Math.PI, () => restW, carry);
    await lower;
    moveView(1.4, { pos: cam0, pitch: 0.35 });
    // Down on the tray where it came from (build 123: the hand used to sink to the tray's grip point while the shaft was
    // still turning, and since pointGrey puts the fingertips on the point and the probe sits below them in the fist, the
    // probe went down through the tray). Now the probe itself is placed: its ring end (its origin) is carried to a point,
    // the fist solved each frame by where the probe lands. It is turned level 15 cm above its place, lowered straight
    // down until it is just clear of the tray (2.2 cm: the fingers are under it), the hand opens and it settles; then the
    // hand lifts clear before the arm drops.
    pa.copy(local(gP, 0.2, 0.95, 0.24, V(0, 0, 0)));
    const want = V(0, 0, 0), dir0 = V(0, 0, 0), dirK = V(0, 0, 0);
    const w0 = instr.getWorldPosition(V(0, 0, 0)), above = restW.clone().setY(restW.y + 0.15);
    instr.localToWorld(dir0.set(0, -1, 0)).sub(w0).normalize();   // the way the business end points now
    // turning it level, the probe is carried out in front of it and the shaft swings forward on the way (straight from upright
    // to level the shaft passed its own head, and the fist, turning round the probe close to its chest, went into it)
    const fwdP = V(Math.sin(gP.rotation.y), 0, Math.cos(gP.rotation.y));
    // Build 148 pilot: the body is a keyframed clip made in Blender (anim/grey-putdown.blend, js/clips/grey-putdown.js): it
    // leans in from the hips over the tray as the probe goes down, the free arm hanging, and straightens as the probe arm
    // drops. The clip's marks set the timing of each step below. Every frame the clip poses the body first; then the
    // probe arm is solved on top of it, as before, while it holds or is near the probe; from 'clear' the clip's own drop
    // to hang takes the arm over from wherever the solver left it. The head is aimed (aimGrey) and the lean taken off it.
    const PD = loadClip(PUTDOWN), mk = PD.marks, pd0 = E.time, ARM = { armR: 1, foreR: 1, handR: 1 };
    const pdT = () => E.time - pd0;
    // each step runs until the clip reaches its mark (steps run whole frames, so fixed lengths drifted a few frames behind the clip)
    const till = (m) => Math.max(1 / 30, m - pdT());
    const body = () => poseClip(gP, PD, pdT(), sm2(pdT() / 0.35), (j) => !ARM[j]);
    const unLean = (k = 1) => { uP.neck.rotation.x -= uP.root.rotation.x * k; };
    await tween(till(mk.level), (k) => { body(); probeTo(want.lerpVectors(w0, above, k).addScaledVector(fwdP, 0.14 * Math.sin(Math.PI * k)), dirK.lerpVectors(dir0, probeDir, k).addScaledVector(fwdP, 0.8 * Math.sin(Math.PI * k)).normalize()); unLean(); }, (k) => k);
    // and the fingers open part way as it comes down, so they are not under it at the tray
    await tween(till(mk.down), (k) => { body(); probeTo(want.lerpVectors(above, low, k), probeDir); unLean(); gripGrey(gP, 'R', 1 - 0.65 * sm2((k - 0.3) / 0.7)); }, (k) => k);
    tray.attach(instr); uP.gripAxisR = null;
    const fromP = instr.position.clone(), fromQ = instr.quaternion.clone(), restP = V(-0.33, 0.8215, 0), restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    // the hand stays where it let go (held in the world while the body moves under it), turned as it was
    const hq = new THREE.Quaternion(), hpq2 = new THREE.Quaternion(), wr0 = V(0, 0, 0), wr1 = V(0, 0, 0);
    gP.updateMatrixWorld(true); uP.handR.getWorldQuaternion(hq); uP.handR.getWorldPosition(wr0);
    const handStill = () => { gP.updateMatrixWorld(true); uP.handR.parent.getWorldQuaternion(hpq2).invert(); uP.handR.quaternion.copy(hpq2.multiply(hq)); return null; };
    const handAt = (p) => { gP.updateMatrixWorld(true); fPole.set(1, -0.35, -0.55).normalize().applyQuaternion(uP.root.getWorldQuaternion(fQ)); clearGreyArm(gP, 'R', p, fPole, handStill); handStill(); };
    await tween(till(mk.release), (k) => { body(); handAt(wr0); aimGrey(gP, restW, 1); unLean(); instr.position.lerpVectors(fromP, restP, k); instr.quaternion.slerpQuaternions(fromQ, restQ, k); gripGrey(gP, 'R', 0.35 * (1 - k)); });   // already part open from the lowering
    A.tone(2900, 0.05, { g: 0.02 }); A.tone(3900, 0.04, { g: 0.01 }); pound(); E.shake = 0;
    // the hand lifts 10 cm straight up off the probe, still turned as it was (build 147 laid the hand flat in one frame
    // here: the fingertips jumped 8.8 cm)
    await tween(till(mk.clear), (k) => { body(); handAt(wr1.copy(wr0).setY(wr0.y + 0.1 * sm2(k))); gripGrey(gP, 'R', 0); aimGrey(gP, restW, 1); unLean(); });
    // the arm comes down to hang: from where the solver left it into the clip's drop (shoulder first, elbow and wrist
    // trailing), and the head turns from the tray to you, ready for the walk home (it snapped 9 cm as the walk began)
    { const a = [uP.armR, uP.foreR, uP.handR], q0 = a.map((o) => o.quaternion.clone()), nk = V(0, 0, 0);
      await tween(till(PD.duration), (k) => {
        body(); a.forEach((o, i) => o.quaternion.copy(q0[i]));
        poseClip(gP, PD, pdT(), sm2(k), (j) => !!ARM[j]);   // over the whole drop: faster, the fingertips went 8 cm a frame
        // the two aims are blended, not one aim at a point moving from the tray to you: that line passes through its own head and
        // the aim swung 3 cm in a frame
        const kl = sm2(k * 1.6); aimGrey(gP, restW, 1); unLean(); nk.set(uP.neck.rotation.x, uP.neck.rotation.y, 0);
        aimGrey(gP, E.camera.position, 0.8); uP.neck.rotation.x = lerp(nk.x, uP.neck.rotation.x, kl); uP.neck.rotation.y = lerp(nk.y, uP.neck.rotation.y, kl);
      }); }
    // the clip ends upright: nothing of the lean may stay (the walk sets the root's sway and turn, not its tip)
    uP.root.quaternion.identity(); uP.root.position.set(0, 0, 0);
    E.limits = lim0; E.mode = 'look';
    await Promise.all([
      walkPath(gP, [homeP[0]], homeR[0], () => E.camera.position),
      walkPath(gL, [V(-0.74, 0, 0.3), homeP[2]], homeR[2], () => E.camera.position),
      walkPath(gR, [homeP[1]], homeR[1], () => E.camera.position),
    ]);
    holders();
    for (const a of greys) a.userData.busy = false;
  }

  // ---- the stare ----
  // a taller one leans in over the table from behind your head, slowly, and stops with its face about 25 cm from yours.
  // Its face is placed by its surface, not its centre, so nothing ever comes nearer than that.
  const tall = makeGrey(true); const face = tall.userData.head; face.scale.setScalar(1.35);
  g.add(face); face.position.set(0, 0, 0); face.rotation.set(0, 0, 0); face.updateMatrixWorld(true);
  const frontZ = new THREE.Box3().setFromObject(face).max.z;   // how far its face reaches in front of the head's centre
  const fwd = V(0, Math.sin(1.0), -Math.cos(1.0));
  const target = E.camera.position.clone().addScaledVector(fwd, 0.25 + frontZ);
  const start = E.camera.position.clone().add(V(0, 0.8, 0.6)), ctrl = target.clone().add(V(0, 0.38, 0.32));
  // its body (neck, shoulders, arms; the head is `face`) follows the head: the neck is under the head, bent so the torso
  // goes up and away behind your head rather than straight out
  tall.scale.setScalar(1.35); g.add(tall);
  for (const k of ['legL', 'legR']) tall.userData[k].visible = false;   // its legs are never in view
  // its arms hang down and back from its shoulders, elbows softly bent, hands loose, past the end of the table: out of your view behind your head
  { const u = tall.userData;
    u.armL.rotation.set(-0.6, 0, -0.12); u.armR.rotation.set(-0.6, 0, 0.12); u.foreL.rotation.set(-0.45, 0, 0); u.foreR.rotation.set(-0.45, 0, 0);
    gripGrey(tall, 'L', 0.3); gripGrey(tall, 'R', 0.3);
    // a proper neck: short and thick, tapering from the shoulders into the skull (over the model's thin neck stalk)
    const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.036 + 0.03 * Math.pow(1 - t, 1.8), 0.6 + 0.25 * t)); }
    u.root.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 24), u.chest.material)); }
  const NECK_AT = V(0, -0.05, -0.06), neckW = V(0, 0, 0);   // where the neck meets the skull: under and behind, away from you (head units)
  const bendQ = new THREE.Quaternion(), upV = V(0, 0, 0), bodyV = V(0, 0, 0), behind = V(0, -0.12, 0.99).normalize();   // bent right over you from the head end, chest facing down
  const faceAt = () => {
    // chin toward the top of your view. The head's path runs in the vertical plane along the table, passing almost straight
    // over your eyes, where a world-up lookAt flips the head round for a moment; the sideways axis is never along the view,
    // so it is the reference instead (the -PI/2 turn gives the same final pose as the old up-based one)
    face.up.set(1, 0, 0); face.lookAt(E.camera.position); face.rotateZ(-Math.PI / 2);
    // from the back of its head the neck and chest run up and away behind your head: it is leaning over you
    bodyV.set(0, -1, 0).applyQuaternion(face.quaternion); bendQ.setFromUnitVectors(bodyV, behind);
    tall.quaternion.copy(face.quaternion).premultiply(bendQ);
    // the top of the neck (model height 0.8) sits in the back of the skull
    face.updateMatrixWorld(); face.localToWorld(neckW.copy(NECK_AT));
    tall.position.copy(neckW).addScaledVector(upV.set(0, 1, 0).applyQuaternion(tall.quaternion), -0.8 * 1.35);
  };
  face.position.copy(start); faceAt();
  E.mode = 'locked';
  const aim = aimAt(target);
  moveView(2.2, aim);
  say('A taller one leans in over you from behind your head, staring at you. Their eyes are all you can see.', 'self', 4.5);
  await tween(3.4, (k) => { const a = 1 - k; face.position.set(0, 0, 0).addScaledVector(start, a * a).addScaledVector(ctrl, 2 * a * k).addScaledVector(target, k * k); faceAt(); });
  E.base.yaw = aim.yaw; E.base.pitch = aim.pitch; E.limits = { yaw: 0.7, up: 0.5, down: 0.7 }; E.mode = 'look';
  await wait(1.2);
  say('Stay where you are and keep looking.', 'them', 5);
  hint('Hold their gaze. Your eyes will try to slide away.');
  G.fear = Math.max(G.fear, 0.45);
  let score = 0, tt = 0, next = 0; E.gazeAt = target;
  const bg = E.scene.background, bg0 = bg.clone(), black = new THREE.Color(0x05060a);
  // everything but the tall one fades out: a black shell round your eyes, drawn over the whole room (and your own body),
  // with the tall one drawn after it. Its materials join the transparent pass (still fully opaque) so they can come after
  // the shell; any they share with the other greys are put back once the stare is over.
  const dim = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 12), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
  dim.renderOrder = 990; dim.frustumCulled = false; dim.position.copy(E.camera.position); g.add(dim);
  const tallMats = new Map();
  for (const root of [tall, face]) root.traverse((o) => {
    if (!o.isMesh) return; o.renderOrder = 995;
    for (const m of [].concat(o.material)) if (!tallMats.has(m)) { tallMats.set(m, m.transparent); m.transparent = true; m.needsUpdate = true; }
  });
  // their eyes fill with stars as the room goes dark (set up now, in the same recompile as the pass change above, at 0)
  const em = tall.userData.eyeM; em.emissive = new THREE.Color(0xffffff); em.emissiveMap = T.stars(400, 1); em.emissiveIntensity = 0; em.needsUpdate = true;
  await new Promise((res) => {
    const off = on((dt) => {
      tt += dt;
      if (tt > next) { next = tt + 0.5 + Math.random() * 0.7; const a = Math.random() * 6.28, m = 0.22 + G.fear * 0.55; E.pull.yaw = Math.cos(a) * m; E.pull.pitch = Math.sin(a) * m; }
      const onIt = angleTo(face.position) < 0.15;
      if (onIt) { score += dt; G.fear -= dt * 0.03; } else G.fear += dt * 0.05;
      const k = Math.min(1, score / 8);
      // the room's light drains away; the face does not come any nearer, it only breathes a few millimetres
      // and all of it but the tall one goes to black; the tall one stays lit
      bg.lerpColors(bg0, black, k); E.scene.fog.color.copy(bg); X.uDark.value = k; hemi.intensity = 2.2 * (1 - 0.25 * k);
      dim.material.opacity = Math.min(1, k * 1.15);
      em.emissiveIntensity = Math.max(em.emissiveIntensity, 1.4 * k * k);
      face.position.copy(target).addScaledVector(fwd, 0.004 * Math.sin(tt * 1.3)); faceAt();
      bar(k);
      if (tt > 14 || score >= 8) { off(); res(); }
    });
  });
  E.pull.yaw = E.pull.pitch = 0; E.gazeAt = null; bar(null); hint(''); E.mode = 'locked';
  note('mindscan');
  if (score >= 6.5) {
    G.stare = true; G.lucidity += 0.15; G.fear = 0.2; G.trust += 1;
    A.vast();
    // a sky round you, drawn over everything, that opens out of each of its eyes until it fills the view. Each pool is the
    // eye's own outline as you see it (the convex outline of the eye mesh, projected to the screen each frame): it swells
    // from a small copy of the eye up to the eye itself, then spreads outward, and the two merge.
    const NP = 48, outline = Array.from({ length: NP * 2 }, () => new THREE.Vector2()), eyeC = [new THREE.Vector2(), new THREE.Vector2()];
    const pv = V(0, 0, 0);
    const traceEyes = () => {
      E.camera.updateMatrixWorld(); face.updateMatrixWorld(true);
      tall.userData.eyes.forEach((m, e) => {
        const pos = m.geometry.attributes.position, pts = [];
        for (let i = 0; i < pos.count; i++) { pv.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).project(E.camera); pts.push([pv.x * E.camera.aspect, pv.y]); }
        // convex hull (monotone chain), counter-clockwise
        pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], hi = [];
        for (const p of pts) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
        for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length > 1 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
        const hull = lo.slice(0, -1).concat(hi.slice(0, -1));
        // resample to exactly NP points along the outline, so the shader's loop is fixed
        const len = [0]; for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; len.push(len[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
        const L = len[hull.length]; let j = 0; eyeC[e].set(0, 0);
        for (let n = 0; n < NP; n++) {
          const s = (n / NP) * L; while (len[j + 1] < s) j++;
          const a = hull[j], b = hull[(j + 1) % hull.length], t = (s - len[j]) / Math.max(1e-9, len[j + 1] - len[j]);
          outline[e * NP + n].set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); eyeC[e].add(outline[e * NP + n]);
        }
        eyeC[e].multiplyScalar(1 / NP);
      });
    };
    traceEyes();
    const skyT = T.stars(400, 1);
    skyT.wrapS = skyT.wrapT = THREE.RepeatWrapping; skyT.needsUpdate = true;
    const SK = { uMap: { value: skyT }, uP: { value: outline }, uC: { value: eyeC }, uAsp: { value: E.camera.aspect }, uS: { value: 0.2 }, uR: { value: 0 } };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(0.2, 48, 24), new THREE.ShaderMaterial({
      uniforms: SK, side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec4 vC; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); vC = gl_Position; }',
      fragmentShader: `uniform sampler2D uMap; uniform vec2 uP[${NP * 2}]; uniform vec2 uC[2]; uniform float uAsp, uS, uR; varying vec4 vC;
// signed distance to one eye's outline (negative inside)
float sdEye(vec2 p, int o) {
  float d = 1e9, s = 1.0;
  for (int i = 0; i < ${NP}; i++) {
    vec2 vi = uP[o + i], vj = uP[o + (i == 0 ? ${NP - 1} : i - 1)];
    vec2 e = vj - vi, w = p - vi, b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= vi.y, p.y < vj.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}
void main(){
  vec2 p = vC.xy / vC.w; p.x *= uAsp;
  // each eye, scaled about its middle by uS (a small copy of the eye growing to the eye itself), then grown outward by uR
  float dL = sdEye(uC[0] + (p - uC[0]) / uS, 0) * uS, dR = sdEye(uC[1] + (p - uC[1]) / uS, ${NP}) * uS;
  float h = clamp(0.5 + 0.5 * (dR - dL) / 0.12, 0.0, 1.0), d = mix(dR, dL, h) - 0.12 * h * (1.0 - h);   // smooth union: they merge
  float f = 0.004 + 0.06 * min(uR, 1.0);
  float m = 1.0 - smoothstep(-f, 0.0, d - uR);
  vec3 c = texture2D(uMap, gl_FragCoord.xy / 512.0).rgb * 1.6;
  gl_FragColor = vec4(c, m);
}`,
    }));
    sky.renderOrder = 999; sky.frustumCulled = false; sky.position.copy(E.camera.position); g.add(sky);
    tween(0.4, (k) => { dim.material.opacity = Math.max(dim.material.opacity, k); });
    const em0 = em.emissiveIntensity; tween(3, (k) => { em.emissiveIntensity = lerp(em0, 2.2, k); hemi.intensity = 2.2 * (0.75 - 0.6 * k); });
    // first the pools swell to the size of the eyes, then they spread until the sky fills the view
    tween(4.5, (k) => { traceEyes(); SK.uAsp.value = E.camera.aspect; const a = Math.min(1, k / 0.3), b = Math.max(0, (k - 0.3) / 0.7); SK.uS.value = 0.2 + 0.8 * a * (2 - a); SK.uR.value = 3.6 * b * b; }, (k) => k);
    await say('You hold their gaze, and the black of their eyes opens out, like looking up into the night sky.', 'self', 4.5);
    await fade(1, 1.5);
    discard(sky);
  } else {
    G.lucidity -= 0.2; G.fear = 0.5;
    say('Your eyes slide away. A long hand passes over your forehead, and the room goes out.');
    // its long forearm and hand come down from above, palm toward you, over your forehead and across your eyes;
    // the room goes out as the hand covers the view
    const fore = tall.userData.foreR; g.add(fore); fore.scale.setScalar(2.0); fore.rotation.set(0, 0, 0);
    gripGrey(tall, 'R', 0.15); tall.userData.handR.rotation.set(0, 0, 0);
    const loc = V(0, 0, 0), q90 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.25, Math.PI / 2, 0));
    let faded = false;
    await tween(1.0, (k) => {
      E.camera.updateMatrixWorld();
      fore.quaternion.copy(E.camera.quaternion).multiply(q90);
      fore.position.copy(E.camera.localToWorld(loc.set(0.01, lerp(0.85, 0.25, k), lerp(-0.12, -0.085, k))));
      if (k > 0.45 && !faded) { faded = true; fade(1, 0.35); }
    }, (k) => k);
    await wait(0.15);
    discard(fore);
    await wait(2.5);
  }
  for (const [m, tr] of tallMats) { m.transparent = tr; m.needsUpdate = true; }
  discard(dim); discard(face); discard(tall); hemi.intensity = 2.2;
  bg.setHex(0xe9eef6); E.scene.fog.color.copy(bg); X.uDark.value = 0; X.uTint.value.setHex(0xdfe8f4, THREE.LinearSRGBColorSpace);

  // ---- the static ----
  E.limits = null;
  setView(0, 1.0 + TY, 0.8, 0, 0.5);
  const fuzz = new THREE.Mesh(new THREE.CylinderGeometry(4.9, 4.9, 0.9, 48, 1, true), new THREE.MeshBasicMaterial({ map: T.static(), transparent: true, side: THREE.BackSide }));
  g.add(fuzz); fuzz.position.y = -0.5;
  await fade(0, 1.5);
  const hiss = A.drone(3000, { noise: true, g: 0.1, q: 0.5, fade: 0.05 });
  await tween(2.8, (k) => { fuzz.position.y = lerp(-0.5, 4, k); fuzz.material.map.offset.x = Math.random(); fuzz.material.map.offset.y = Math.random(); }, (k) => k);
  hiss.stop(0.3); discard(fuzz); note('fuzz');
  await say('Static sweeps up the walls. The room is the same. Almost.');
  say('You find you can stand.', 'self', 4);
  await standUp(me, greys);
  await wait(1.2);
  tone.stop(1); tone2.stop(1); lift.stop();
  await fade(1, 1.2, '#fff');
  return 'hub';
}
