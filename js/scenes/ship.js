// Act 4: the crossroads room and the four rooms that lead off it.
import { THREE, lookToward, E, G, $, on, wait, until, tween, lerp, say, hint, bar, fade, note, choose, prompt,
  setView, moveView, angleTo, aimAt, clearScene, discard, unsteady, t as tr } from '../engine.js';
import { A } from '../audio.js';
import { buildBedroom, makeGrey, makeMantis, idleMantis, makeHuman, idleHuman, makePlayerBody, aimGrey, humanGaze } from '../models.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const V2 = (x, y) => new THREE.Vector2(x, y);
const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color, ...o });
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
function archShape(w, h) {
  const s = new THREE.Shape(), r = w / 2;
  s.moveTo(-r, 0); s.lineTo(-r, h - r); s.absarc(0, h - r, r, Math.PI, 0, true); s.lineTo(r, 0); s.lineTo(-r, 0);
  return s;
}
// an arch-shaped band: outer arch (ro, spring so) minus inner arch (ri, spring si), open at the floor
function archBand(ro, so, ri, si) {
  const s = new THREE.Shape();
  s.moveTo(-ro, 0); s.lineTo(-ro, so); s.absarc(0, so, ro, Math.PI, 0, true); s.lineTo(ro, 0);
  s.lineTo(ri, 0); s.lineTo(ri, si); s.absarc(0, si, ri, 0, Math.PI, false); s.lineTo(-ri, 0); s.lineTo(-ro, 0);
  return s;
}
function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
const lathe = (pts, n = 40) => new THREE.LatheGeometry(pts.map(([x, y]) => V2(x, y)), n);
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let glowCache = null;
const glowTex = () => { if (!glowCache) { glowCache = canvasTex(128, 128, (g) => {
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
}); glowCache.userData.keep = true; } return glowCache; };

// ---------- shader kit ----------
// Colours in these shaders are display (sRGB) values: ShaderMaterial output is not converted.
const dcol = (hex) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);
// the child who looks at you in the classroom is the one who holds out the toy in the containers hall (build 146): same
// size, clothes colour and eye colour (makeHuman picks those from the colour), and their own copper hair, cut short, which
// no other child in the classroom has, so they stand out and are the same child in both rooms
export const KNOWN_KID = { scale: 0.55, color: 0x6a7b99, hair: { hair: 0xa4502a, hairStyle: 0 } };
// The known child's seat in the classroom circle (room centred on the dais at z -2.6, you enter at z 1.3): turned on the
// stool a little over half way from the dais toward you, so they can look round at you over their shoulder (neck and
// eyes) and back to the lesson without turning the whole body. Makes the person face +z, so rotation.y = atan2(dx, dz).
export function seatKnownKid(kid) {
  const p = kid.position, ad = Math.atan2(-p.x, -2.6 - p.z), ap = Math.atan2(-p.x, 1.3 - p.z);
  let d = ap - ad; d = Math.atan2(Math.sin(d), Math.cos(d));
  kid.rotation.set(0, ad + 0.55 * d, 0);
}
// A seated child's hands laid on the lap with the arms clear of the body. sitHuman reaches the wrists to the middle of the
// thighs by swinging the arms in across the sides, and the upper arms and forearms then run about 1.5 cm inside the
// torso. Here the same solve (shoulder x and z, elbow x, mirrored) is held to arms hanging at least zMin out from the
// sides, and aims the wrists at the outer half of each thigh (out times the hip's width out from the middle), further
// toward the knee (along), `lift` over the thigh's top; then the wrists are turned palm down with the fingers along the
// thigh, as sitHuman does. idleHuman keeps these values (u.armX, u.armZ, u.foreX).
export function clearLap(h, lift = 0.01, out = 1.5, along = 0.65, zMin = 0.06) {
  const u = h.userData; if (!u.wristR || !u.seated) return h;
  const p = h.parent; if (p) p.remove(h);
  const pos0 = h.position.clone(), q0 = h.quaternion.clone(); h.position.set(0, 0, 0); h.quaternion.identity();
  const pose = () => { u.armL.rotation.set(u.armX, 0, -u.armZ); u.armR.rotation.set(u.armX, 0, u.armZ); u.foreL.rotation.x = u.foreR.rotation.x = u.foreX; };
  pose(); h.updateMatrixWorld(true);
  const knee = u.kneeR.getWorldPosition(V(0, 0, 0)), hip = u.legR.getWorldPosition(V(0, 0, 0)), fwd = knee.clone().sub(hip); fwd.y = 0; fwd.normalize();
  const target = hip.clone().lerp(knee, along); target.x *= out; target.y += (0.078 * (u.rf || 1) + 0.016 + lift) * h.scale.x; target.addScaledVector(fwd, -0.045 * h.scale.x);
  u.armZ = Math.max(zMin, u.armZ);
  const w = V(0, 0, 0), err = () => { pose(); h.updateMatrixWorld(true); u.wristR.getWorldPosition(w); return w.distanceToSquared(target); };
  let e = err(), st = 0.2;
  for (let it = 0; it < 160 && st > 0.002; it++) {
    let better = false;
    for (const k of ['armX', 'armZ', 'foreX']) for (const d of [st, -st]) {
      const o = u[k]; u[k] = o + d; if (k === 'foreX') u[k] = Math.min(0, Math.max(-2.4, u[k])); if (k === 'armZ') u[k] = Math.max(zMin, u[k]);
      const e2 = err(); if (e2 < e) { e = e2; better = true; } else u[k] = o;
    }
    if (!better) st *= 0.5;
  }
  pose(); h.updateMatrixWorld(true);
  const down = V(0, -1, 0), m = new THREE.Matrix4(), qw = new THREE.Quaternion(), qp = new THREE.Quaternion();
  for (const [wr, s] of [[u.wristR, 1], [u.wristL, -1]]) {
    const f = fwd.clone(); f.x *= s;
    const xa = down.clone().multiplyScalar(-s), ya = f.clone().negate(), za = V(0, 0, 0).crossVectors(xa, ya);
    m.makeBasis(xa, ya, za); qw.setFromRotationMatrix(m); wr.parent.getWorldQuaternion(qp); wr.quaternion.copy(qp.invert().multiply(qw));
  }
  h.position.copy(pos0); h.quaternion.copy(q0); if (p) p.add(h);
  return h;
}
const TIME = { value: 0 };
const FOGU ={ uFogC: { value: new THREE.Color(0) }, uFogN: { value: 1e6 }, uFogF: { value: 2e6 } };
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
float fogk() { return smoothstep(uFogN, uFogF, vDepth); }
vec3 fogit(vec3 c) { return mix(c, pow(uFogC, vec3(0.4545)), fogk()); }
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
// cut-gem look for the orb, its shapes, and the child's gift
const JEWEL = `
uniform vec3 uColor; uniform float uGlow;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.5);
  vec3 r = reflect(-v, n);
  float env = smoothstep(0.1, 0.9, r.y) * 0.45 + pow(max(r.y, 0.0), 40.0) * 1.4;
  float spark = pow(noise3(vPos * 22.0 + vec3(0.0, uTime * 0.6, 0.0)), 9.0) * 3.0;
  vec3 deep = uColor * uColor;
  vec3 col = mix(deep * 0.6, uColor, ndv) * (0.55 + 0.6 * uGlow);
  col += uColor * fres * (1.2 + uGlow);
  col += vec3(1.0) * (env * 0.6 + spark * (0.3 + 0.5 * uGlow));
  gl_FragColor = vec4(col, 1.0);
}`;
const pxScale = () => E.renderer.domElement.height * 0.714; // world size -> pixels at 1 m for the 70 degree camera
// drifting dust, wrapped inside a box round `center`; animated entirely on the GPU
const MOTE_V = `
attribute vec4 aM;
uniform float uTime; uniform float uScale; uniform vec3 uBox; uniform vec3 uCenter;
varying float vA;
void main() {
  vec3 p = aM.xyz + vec3(sin(uTime * 0.13 + aM.w * 6.0), sin(uTime * 0.07 + aM.w * 9.0) * 0.6 + uTime * 0.02, cos(uTime * 0.11 + aM.w * 4.0)) * 0.35;
  p = uCenter + mod(p - uCenter + uBox, uBox * 2.0) - uBox;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vA = smoothstep(0.2, 0.9, d) * (1.0 - smoothstep(4.0, 9.0, d)) * (0.45 + 0.55 * sin(uTime * 0.9 + aM.w * 30.0));
  gl_PointSize = position.x * uScale / max(d, 0.1);
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_F = `
uniform vec3 uColor;
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, r);
  gl_FragColor = vec4(uColor * a * a * max(vA, 0.0), 1.0);
}`;
function motes(n, center, half, color, amt = 1, size = 0.013) {
  const pos = new Float32Array(n * 3), m = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = size * (0.5 + Math.random());
    m[i * 4] = center.x + (Math.random() * 2 - 1) * half.x; m[i * 4 + 1] = center.y + (Math.random() * 2 - 1) * half.y;
    m[i * 4 + 2] = center.z + (Math.random() * 2 - 1) * half.z; m[i * 4 + 3] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aM', new THREE.BufferAttribute(m, 4));
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: MOTE_V, fragmentShader: MOTE_F, ...ADD,
    uniforms: { uTime: TIME, uScale: { value: pxScale() }, uBox: { value: half }, uCenter: { value: center }, uColor: { value: dcol(color).multiplyScalar(amt) } } }));
  pts.frustumCulled = false; pts.renderOrder = 6;
  return pts;
}
// a soft shaft of light: an open cylinder, bright where you look through its middle, faint at its edges
const SHAFT = `
uniform vec3 uColor; uniform float uAmt;
void main() {
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld);
  float edge = pow(abs(dot(n, v)), 2.0);
  float h = vUv.y;
  float rays = 0.65 + 0.35 * sin(vUv.x * 6.2831853 * 9.0 + sin(h * 3.0 + uTime * 0.25) * 1.5);
  float drift = 0.8 + 0.2 * sin(h * 9.0 + uTime * 0.6);
  float a = edge * mix(0.3, 1.0, h) * smoothstep(0.0, 0.25, h) * (1.0 - smoothstep(0.88, 1.0, h)) * rays * drift;
  gl_FragColor = vec4(uColor * a * uAmt * (1.0 - fogk()), 1.0);
}`;
function shaft(rTop, rBot, h, color, amt, segs = 48) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, segs, 1, true), sm(SHAFT, { uColor: { value: dcol(color) }, uAmt: { value: amt } }, { ...ADD, side: THREE.DoubleSide }));
  m.renderOrder = 5;
  return m;
}
// iridescent pearl sheen, strongest at grazing angles (fres = 0..1)
const PEARL = `
vec3 pearl(float fres, float shift) { return 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + fres * 0.9 + shift)); }
`;

const DOORS = [
  { id: 'class', name: 'The classroom', ang: 0, color: 0xffe2a8 },
  { id: 'window', name: 'The window', ang: Math.PI / 2, color: 0x8fb8ff },
  { id: 'containers', name: 'The hall of containers', ang: Math.PI, color: 0x7fffd0 },
  { id: 'viewing', name: 'The still room', ang: Math.PI * 1.5, color: 0xf2f2f2 },
];
let lastDoor = null, firstVisit = true;
export function resetShip() { lastDoor = null; firstVisit = true; }

export async function hub() {
  for (;;) {
    clearScene();
    const sel = await crossroads();
    if (sel === 'control' || sel.startsWith('end:')) return sel;
    clearScene();
    await ROOMS[sel]();
    G.visited[sel] = true; lastDoor = sel;
  }
}

// ---------- the crossroads ----------
const DOORU = `
uniform vec4 uSeen; uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
vec4 doorW(float qi) {
  float idx = mod(qi + 4.0, 4.0);
  return vec4(step(abs(idx), 0.5), step(abs(idx - 1.0), 0.5), step(abs(idx - 2.0), 0.5), step(abs(idx - 3.0), 0.5));
}
vec3 doorC(vec4 w) { return uC0 * w.x + uC1 * w.y + uC2 * w.z + uC3 * w.w; }
`;
// brushed metal panels, seams, glowing inlays, with arched holes cut for the four doorways
const CR_WALL = DOORU + PEARL + `
void main() {
  float th = atan(vWorld.x, -vWorld.z);
  float q = th / 1.5707963;
  float qi = floor(q + 0.5);
  float dw = (q - qi) * 1.5707963 * 6.0;
  float y = vWorld.y;
  float sd = archSD(vec2(dw, y), 0.85, 2.6);
  if (sd < 0.0) discard;
  vec4 wv = doorW(qi);
  vec3 dc = doorC(wv);
  float seen = dot(uSeen, wv);
  float u = th / 6.2831853 + 0.5;
  float px = u * 48.0;
  float fx = fract(px);
  float seamV = smoothstep(0.014, 0.004, min(fx, 1.0 - fx) * 0.785);
  float hs = min(min(abs(y - 0.32), abs(y - 1.25)), abs(y - 2.95));
  float seamH = smoothstep(0.014, 0.004, hs);
  float br = noise2(vec2(px * 2.0, y * 70.0)) * 0.6 + noise2(vec2(px * 7.0, y * 240.0)) * 0.4;
  float tone = hash2(vec2(floor(px), floor((y + 0.05) / 0.93) + 3.7));
  vec3 base = vec3(0.46, 0.49, 0.53) * (0.82 + 0.18 * tone) * (0.82 + 0.3 * br);
  vec3 n = normalize(-vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 L = normalize(vec3(0.0, 3.1, 0.0) - vWorld);
  float spec = pow(max(dot(n, normalize(L + v)), 0.0), 36.0);
  float diff = 0.3 + 0.7 * max(dot(n, L), 0.0);
  vec3 col = base * diff * (0.6 + 0.4 * smoothstep(0.0, 3.4, y));
  col += vec3(0.75, 0.82, 0.95) * spec * (0.35 + 0.65 * br);
  float seamAll = max(seamV, seamH);
  col *= 1.0 - 0.6 * seamAll;
  col += vec3(0.6, 0.65, 0.75) * smoothstep(0.008, 0.0, abs(hs - 0.016)) * 0.12;
  // the panels nearest you wake: a soft fill and brighter inlays
  vec2 dp = vWorld.xz - cameraPosition.xz;
  float near = exp(-dot(dp, dp) * 0.3);
  float fres = pow(1.0 - abs(dot(n, v)), 3.0);
  col += pearl(fres, y * 0.05) * fres * 0.07;
  col += vec3(0.1, 0.18, 0.28) * near * (1.0 - seamAll) * smoothstep(0.3, 1.0, y) * 0.3;
  float inl = smoothstep(0.022, 0.006, abs(y - 1.05));
  float dash = step(0.3, hash2(vec2(floor(u * 320.0), 1.0)));
  float pulse = 0.5 + 0.5 * sin(u * 6.2831853 * 4.0 - uTime * 1.2);
  col += vec3(0.42, 0.78, 1.0) * inl * dash * (0.4 + 1.1 * pulse + 2.2 * near);
  float vin = smoothstep(0.018, 0.004, abs(fx - 0.5) * 0.785) * smoothstep(1.4, 1.6, y) * smoothstep(2.9, 2.7, y);
  col += vec3(0.3, 0.55, 0.85) * vin * (0.25 + 0.4 * pulse + 1.3 * near);
  col *= (0.55 + 0.45 * smoothstep(0.0, 0.6, y)) * (0.8 + 0.2 * smoothstep(3.4, 3.0, y));
  col += dc * exp(-max(sd - 0.2, 0.0) * 2.5) * (1.0 - seen) * 0.28;
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
const CR_FLOOR = DOORU + `
float ceilB(float r) {
  return smoothstep(1.5, 1.2, r) * 0.9 + smoothstep(0.05, 0.0, abs(r - 2.3)) * 0.5 + smoothstep(0.05, 0.0, abs(r - 3.4)) * 0.45 + smoothstep(0.08, 0.0, abs(r - 5.85)) * 0.6;
}
void main() {
  vec2 p = vWorld.xz;
  float r = length(p);
  float th = atan(p.x, -p.y);
  vec3 col = vec3(0.13, 0.145, 0.165);
  col *= 0.85 + 0.25 * noise3(vec3(r * 140.0, cos(th) * 2.0, sin(th) * 2.0));
  float rr = min(min(abs(r - 1.05), abs(r - 1.7)), min(abs(r - 2.6), min(abs(r - 3.9), abs(r - 5.3))));
  col *= 1.0 - 0.5 * smoothstep(0.012, 0.003, rr);
  float ang = th / 6.2831853 * 48.0;
  float sp = abs(fract(ang + 0.5) - 0.5) * r * 6.2831853 / 48.0;
  col *= 1.0 - 0.35 * smoothstep(0.01, 0.003, sp) * step(1.7, r) * step(r, 5.3);
  float band = step(2.66, r) * step(r, 2.84);
  float gly = step(0.45, hash2(vec2(floor(ang * 4.0), floor((r - 2.66) / 0.06))));
  col += vec3(0.32, 0.6, 0.85) * band * gly * 0.18;
  vec3 v = normalize(vWorld - cameraPosition);
  vec3 rd = vec3(v.x, -v.y, v.z);
  vec2 hit = p + rd.xz * (3.4 / max(rd.y, 0.05));
  col += vec3(0.75, 0.85, 1.0) * ceilB(length(hit)) * 0.22 * (0.6 + 0.4 * noise2(p * 9.0));
  // engraved rings light up round your feet; corners darken where floor meets wall and dais
  float pd = length(p - cameraPosition.xz);
  col += vec3(0.35, 0.65, 1.0) * smoothstep(0.012, 0.0, rr) * exp(-pd * pd * 0.6) * 0.7;
  col *= (0.5 + 0.5 * smoothstep(6.0, 5.3, r)) * (0.45 + 0.55 * smoothstep(0.78, 1.3, r));
  float q = th / 1.5707963; float qi = floor(q + 0.5);
  float lat = abs((q - qi) * 1.5707963) * r;
  vec4 wv = doorW(qi);
  vec3 dc = doorC(wv);
  float seen = dot(uSeen, wv);
  float chan = smoothstep(0.05, 0.015, lat) * step(1.1, r);
  float pul = pow(0.5 + 0.5 * sin(r * 2.4 - uTime * 2.2), 8.0);
  col += dc * chan * ((1.0 - seen) * (0.25 + 0.9 * pul) + seen * 0.04);
  col += dc * exp(-lat * lat * 1.2) * smoothstep(3.6, 5.9, r) * (1.0 - seen) * 0.3;
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
const CR_CEIL = `
void main() {
  vec2 p = vWorld.xz;
  float r = length(p);
  float th = atan(p.x, -p.y);
  vec3 col = vec3(0.55, 0.6, 0.68) * (0.55 + 0.45 * smoothstep(6.0, 0.0, r));
  col += vec3(0.85, 0.92, 1.0) * smoothstep(1.5, 1.2, r) * (0.75 + 0.25 * sin(r * 30.0 - uTime * 1.5));
  float rl = smoothstep(0.05, 0.0, abs(r - 2.3)) + smoothstep(0.05, 0.0, abs(r - 3.4)) + smoothstep(0.08, 0.0, abs(r - 5.85));
  col += vec3(0.7, 0.85, 1.0) * rl * 0.8;
  float rib = abs(fract(th / 6.2831853 * 16.0 + 0.5) - 0.5) * r * 6.2831853 / 16.0;
  col *= 1.0 - 0.6 * smoothstep(0.06, 0.02, rib) * step(1.6, r);
  float sw = sin(th * 3.0 + r * 1.6 - uTime * 0.35) * 0.5 + 0.5;
  col += vec3(0.25, 0.35, 0.5) * pow(sw, 6.0) * smoothstep(1.6, 2.0, r) * 0.35;
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// the short hallway behind each doorway, glowing deeper in
const CR_HALL = `
uniform vec3 uColor; uniform float uSeen; uniform float uF0;
void main() {
  float d = vUv.y;
  float flo = step(vPos.y, 0.01);
  float ribs = smoothstep(0.04, 0.0, abs(fract(d * 8.0) - 0.5) - 0.44);
  float flow = pow(0.5 + 0.5 * sin((d * 4.0 - uTime * 0.5) * 6.2831853), 10.0);
  vec3 col = uColor * (0.1 + 0.85 * d * d);
  col += uColor * flow * 0.35 * (0.4 + d);
  col *= 1.0 - 0.55 * ribs;
  col += uColor * ribs * flow * 0.4;
  float fx = (vUv.x - uF0) / (1.0 - uF0);
  float strip = flo * (smoothstep(0.02, 0.0, abs(fx - 0.18)) + smoothstep(0.02, 0.0, abs(fx - 0.82)));
  col += mix(uColor, vec3(1.0), 0.4) * strip * (0.5 + 0.5 * flow);
  col = mix(col, vec3(1.0), smoothstep(0.75, 1.0, d) * 0.55);
  vec3 sealed = uColor * 0.035 + vec3(0.025, 0.028, 0.034) * (1.0 - ribs * 0.5);
  col = mix(col, sealed, uSeen);
  gl_FragColor = vec4(col, 1.0);
}`;
// a closed door: dark ribbed metal, a centre seam, a faint trace of the door's colour
const CR_SEAL = `
uniform vec3 uColor;
void main() {
  vec2 p = vPos.xy;
  float hb = abs(fract(p.y / 0.32) - 0.5);
  float ribs = smoothstep(0.44, 0.5, hb);
  float br = noise2(vec2(p.x * 3.0, p.y * 80.0));
  vec3 col = vec3(0.16, 0.17, 0.19) * (0.8 + 0.3 * br);
  col *= 1.0 - 0.35 * ribs;
  col *= 1.0 - 0.7 * smoothstep(0.012, 0.0, abs(p.x));
  col += uColor * smoothstep(0.004, 0.0, abs(p.x)) * 0.25;
  col += uColor * smoothstep(0.01, 0.0, abs(length(p - vec2(0.0, 1.5)) - 0.35)) * 0.12;
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// coloured haze hanging in an open doorway, thickest along the floor
const DOOR_HAZE = `
uniform vec3 uColor;
void main() {
  vec2 p = vPos.xy;
  float n = noise2(vec2(p.x * 2.0 + uTime * 0.2, p.y * 1.5 - uTime * 0.12)) * 0.6 + noise2(vec2(p.x * 5.0 - uTime * 0.1, p.y * 4.0)) * 0.4;
  float a = (0.12 + 0.45 * exp(-p.y * 1.8)) * (0.5 + 0.7 * n) * (1.0 - smoothstep(0.45, 0.85, abs(p.x)));
  gl_FragColor = vec4(uColor * a * 0.55 * (1.0 - fogk()), 1.0);
}`;
// tube along the arch outline (open front and back), bending sideways as it goes deeper
function archTube(hw, h, L, segs, bend) {
  const spring = h - hw, pts = [[-hw, 0], [-hw, spring * 0.5], [-hw, spring]];
  for (let i = 1; i < 16; i++) { const a = Math.PI - i * Math.PI / 16; pts.push([Math.cos(a) * hw, spring + Math.sin(a) * hw]); }
  pts.push([hw, spring], [hw, spring * 0.5], [hw, 0], [0, 0], [-hw, 0]);
  const per = [0];
  for (let i = 1; i < pts.length; i++) per.push(per[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = per[per.length - 1], n = pts.length, pos = [], uv = [], idx = [];
  for (let j = 0; j <= segs; j++) {
    const f = j / segs, bx = bend * f * f;
    for (let i = 0; i < n; i++) { pos.push(pts[i][0] + bx, pts[i][1], -f * L); uv.push(per[i] / total, f); }
  }
  for (let j = 0; j < segs; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, c = a + n; idx.push(a, c, a + 1, a + 1, c, c + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  geo.userData.f0 = per[n - 3] / total;
  return geo;
}
// the mark over doorway i. v > 0 draws it as it reads at low lucidity: another doorway's mark, turned or mirrored,
// the ring's gap moved, sometimes a stray dot. Redrawn into the same canvas (no new texture).
function drawGlyph(g, i, v = 0) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 256, 256);
  let s = (v * 7919 + i * 131) % 233280; const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  if (v) { r(); r(); }
  g.translate(128, 128); g.strokeStyle = g.fillStyle = '#fff'; g.lineCap = g.lineJoin = 'round'; g.shadowColor = '#fff'; g.shadowBlur = 10;
  const gap = v ? 0.2 + r() * 0.8 : 0.4, ga = v ? r() * Math.PI * 2 : 0;
  g.lineWidth = 7; g.beginPath(); g.arc(0, 0, 100, ga + gap, ga + Math.PI * 2 - gap); g.stroke();
  g.lineWidth = 10;
  if (v) {
    for (let n = Math.floor(r() * 3); n > 0; n--) { const a = r() * Math.PI * 2, d = 62 + r() * 18; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, 6, 0, 7); g.fill(); }
    i = (i + 1 + Math.floor(r() * 3)) % 4;
    g.rotate((r() - 0.5) * 2.6); if (r() < 0.5) g.scale(-1, 1);
  }
  {
    if (i === 0) {
      g.beginPath(); g.arc(0, 8, 50, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
      g.beginPath(); g.arc(0, -8, 18, 0, 7); g.stroke();
      for (const x of [-34, 0, 34]) { g.beginPath(); g.arc(x, -60, 6, 0, 7); g.fill(); }
    } else if (i === 1) {
      g.beginPath(); g.arc(0, 0, 52, 0, 7); g.stroke();
      g.beginPath(); g.moveTo(-74, 12); g.lineTo(74, 12); g.stroke();
      g.beginPath(); g.arc(0, 12, 22, Math.PI, 0); g.stroke();
    } else if (i === 2) {
      for (const x of [-36, 0, 36]) { g.beginPath(); g.moveTo(x, -50); g.lineTo(x, 52); g.stroke(); g.beginPath(); g.arc(x, 4, 8, 0, 7); g.fill(); }
      g.beginPath(); g.moveTo(-58, -62); g.lineTo(58, -62); g.stroke();
    } else {
      g.beginPath(); g.moveTo(-66, 0); g.quadraticCurveTo(0, -58, 66, 0); g.quadraticCurveTo(0, 58, -66, 0); g.stroke();
      g.beginPath(); g.arc(0, 0, 14, 0, 7); g.fill();
      g.beginPath(); g.moveTo(0, -84); g.lineTo(0, -44); g.moveTo(0, 44); g.lineTo(0, 84); g.stroke();
    }
  }
}
const doorGlyph = (i) => canvasTex(256, 256, (g) => drawGlyph(g, i));

async function crossroads() {
  E.scene.background = new THREE.Color(0x0b0e13);
  E.scene.fog = new THREE.Fog(0x0b0e13, 6, 22);
  E.unsteady = true; E.heart = false;
  shaderScene();
  const g = new THREE.Group(); E.scene.add(g);
  // the ways stay shut until you have faced the tall one; then they open one after another
  let shut = !G.asked && Object.keys(G.visited).length === 0;
  const seenV = new THREE.Vector4(...DOORS.map((d) => (shut || G.visited[d.id] ? 1 : 0)));
  const DU = { uSeen: { value: seenV } };
  DOORS.forEach((d, i) => { DU['uC' + i] = { value: dcol(d.color) }; });
  const metal = std(0x8e98a2, { metalness: 0.85, roughness: 0.35 });
  const darkMetal = std(0x3a4049, { metalness: 0.8, roughness: 0.4 });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 3.4, 128, 1, true), sm(CR_WALL, DU, { side: THREE.BackSide })); wall.position.y = 1.7;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 128), sm(CR_FLOOR, DU)); floor.rotation.x = -Math.PI / 2;
  const top = new THREE.Mesh(new THREE.CircleGeometry(6, 128), sm(CR_CEIL)); top.rotation.x = Math.PI / 2; top.position.y = 3.4;
  const lamp = new THREE.PointLight(0xdfeaff, 9, 20, 1.5); lamp.position.set(0, 3.1, 0);
  g.add(wall, floor, top, lamp, new THREE.HemisphereLight(0xdfe8ff, 0x39414f, 1.4));
  // pilasters between the panels, a lit cove under the ceiling, a skirting ring
  const dummy = new THREE.Object3D(), pil = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 3.4, 0.12), metal, 20);
  for (let k = 0, n = 0; k < 24; k++) {
    if (k % 6 === 0) continue;
    const a = k * Math.PI / 12;
    dummy.position.set(Math.sin(a) * 5.93, 1.7, -Math.cos(a) * 5.93); dummy.lookAt(0, 1.7, 0); dummy.updateMatrix(); pil.setMatrixAt(n++, dummy.matrix);
  }
  g.add(pil);
  const cove = new THREE.Mesh(new THREE.TorusGeometry(5.88, 0.03, 8, 160), basic(0xbfe0ff)); cove.rotation.x = Math.PI / 2; cove.position.y = 3.36; g.add(cove);
  const skirt = new THREE.Mesh(new THREE.TorusGeometry(5.95, 0.07, 8, 160), darkMetal); skirt.rotation.x = Math.PI / 2; skirt.position.y = 0.05; g.add(skirt);
  // the doorways: a deep metal frame, a lit edge, a short glowing hallway, a glyph above
  const frameG = new THREE.ExtrudeGeometry(archBand(1.05, 1.8, 0.85, 1.75), { depth: 0.36, bevelEnabled: false, curveSegments: 32 });
  const edgeG = new THREE.ShapeGeometry(archBand(0.885, 1.75, 0.85, 1.75), 32);
  const bends = [0.9, -1.1, 0.7, -0.8];
  const hazeG = new THREE.ShapeGeometry(archShape(1.66, 2.57), 16);
  const doors = DOORS.map((d, i) => {
    const pos = V(Math.sin(d.ang) * 5.9, 0, -Math.cos(d.ang) * 5.9);
    const seen = !!G.visited[d.id];
    const dg = new THREE.Group(); dg.position.copy(pos); dg.lookAt(0, 0, 0); g.add(dg);
    const frame = new THREE.Mesh(frameG, metal); frame.position.z = -0.31; dg.add(frame);
    const dark = seen || shut;
    const edge = new THREE.Mesh(edgeG, basic(dark ? 0x262a31 : d.color)); edge.position.z = 0.055; dg.add(edge);
    const tube = archTube(0.84, 2.59, 5.5, 14, bends[i]);
    const hall = new THREE.Mesh(tube, sm(CR_HALL, { uColor: { value: dcol(d.color) }, uSeen: { value: dark ? 1 : 0 }, uF0: { value: tube.userData.f0 } }, { side: THREE.DoubleSide }));
    dg.add(hall);
    const endC = seen ? new THREE.Color(0x0a0c10) : new THREE.Color(d.color).lerp(new THREE.Color(0xffffff), 0.55);
    const end = new THREE.Mesh(new THREE.ShapeGeometry(archShape(1.7, 2.6), 16), basic(endC, { fog: false })); end.position.set(bends[i], 0, -5.5); dg.add(end);
    let seal = null;
    if (dark) { seal = new THREE.Mesh(new THREE.ShapeGeometry(archShape(1.72, 2.61), 24), sm(CR_SEAL, { uColor: { value: dcol(d.color) } })); seal.position.z = -0.12; dg.add(seal); }
    const hazeM = seen ? null : sm(DOOR_HAZE, { uColor: { value: dcol(d.color) } }, ADD);
    const hazes = [];
    if (!seen) for (const z of [-0.5, -1.6, -2.9]) { const hz = new THREE.Mesh(hazeG, hazeM); hz.position.set(bends[i] * (z / 5.5) * (z / 5.5), 0, z); hz.renderOrder = 4; hz.visible = !shut; dg.add(hz); hazes.push(hz); }
    const gTex = doorGlyph(i);
    const glyph = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), basic(seen ? 0x30343c : shut ? 0x14161a : d.color, seen
      ? { map: gTex, transparent: true, depthWrite: false }
      : { map: gTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glyph.position.set(0, 3.1, 0.04); dg.add(glyph);
    // low lucidity: look back and the mark over the doorway is not the one that was there
    unsteady(glyph, (k, n) => { drawGlyph(gTex.image.getContext('2d'), i, n); gTex.needsUpdate = true; });
    return { ...d, seen, eye: pos.clone().setY(1.5), i, dg, seal, hazes, hazeM, hall, edge, glyph };
  });
  // one doorway opening: the slab sinks into the floor, light runs up the frame and the passage wakes behind it
  const openDoor = async (d) => {
    const full = d.hazeM.uniforms.uColor.value.clone(), lit = new THREE.Color(d.color), off = new THREE.Color(0x262a31), gOff = new THREE.Color(0x14161a);
    const f0 = 82 * Math.pow(1.335, d.i);
    A.noise(1.9, { g: 0.16, f: 240, q: 0.7, type: 'lowpass', to: 2600 });      // air let in
    A.tone(f0, 2.2, { type: 'sawtooth', g: 0.07, a: 0.5, to: f0 * 0.5 });       // the slab going down
    A.noise(0.12, { g: 0.2, f: 900, q: 3 });                                    // the seal breaking
    d.hazes.forEach((h) => { h.visible = true; });
    await tween(1.8, (k) => {
      d.seal.position.y = -2.75 * k * k;
      d.hall.material.uniforms.uSeen.value = 1 - k;
      seenV.setComponent(d.i, 1 - k);
      d.edge.material.color.lerpColors(off, lit, Math.min(1, k * 2));
      d.glyph.material.color.lerpColors(gOff, lit, k);
      d.hazeM.uniforms.uColor.value.copy(full).multiplyScalar(k);
    });
    discard(d.seal); d.seal = null;
    A.tone(f0 * 0.5, 0.7, { type: 'triangle', g: 0.07, to: f0 * 0.33 });   // the slab seating itself, low
  };
  const openDoors = async () => {
    E.mode = 'walk';   // free to walk and look round while the walls open
    if (mantis.userData.setFold) tween(1.2, (k) => mantis.userData.setFold(1 - k * 0.8));
    A.clicks(7);
    say('They open their arms. Around the room, the walls answer.');
    const todo = doors.filter((d) => !d.seen);
    for (let n = 0; n < todo.length; n++) { const p = openDoor(todo[n]); if (n === todo.length - 1) await p; else await wait(0.55); }
    if (mantis.userData.setFold) tween(1.6, (k) => mantis.userData.setFold(0.2 + k * 0.8));
    shut = false; E.mode = 'walk';
  };
  // the dais the tall one stands on
  const dais = new THREE.Mesh(lathe([[0, 0], [0.8, 0], [0.8, 0.06], [0.74, 0.085], [0.74, 0.12], [0, 0.12]], 64), darkMetal); g.add(dais);
  const daisRing = new THREE.Mesh(new THREE.TorusGeometry(0.775, 0.01, 6, 96), basic(0x8fd8ff)); daisRing.rotation.x = Math.PI / 2; daisRing.position.y = 0.072; g.add(daisRing);
  const daisIn = new THREE.Mesh(new THREE.RingGeometry(0.48, 0.5, 64), basic(0x8fd8ff, { side: THREE.DoubleSide })); daisIn.rotation.x = -Math.PI / 2; daisIn.position.y = 0.122; g.add(daisIn);
  const stand = new THREE.Group(); stand.position.y = 0.12; g.add(stand);
  const mantis = makeMantis(); stand.add(mantis);
  // a column of pale light from the bright ceiling disc down onto the dais, and dust hanging in the room
  const col = shaft(1.25, 0.82, 3.28, 0xcfe4ff, 0.22); col.position.y = 1.76; g.add(col);
  g.add(motes(260, V(0, 1.7, 0), V(5, 1.6, 5), 0xbcd6ff, 0.9));
  const count = Object.keys(G.visited).length;
  if (lastDoor) {
    const d = DOORS.find((x) => x.id === lastDoor);
    setView(Math.sin(d.ang) * 4.2, 1.6, -Math.cos(d.ang) * 4.2, 0, 0);
    E.yaw = aimAt(V(0, 1.6, 0)).yaw;
  } else setView(0, 1.6, 4.2, 0, 0);
  E.mode = 'walk';
  E.bounds = (x, z) => { const r = x * x + z * z; return r < 5.25 * 5.25 && r > 0.85 * 0.85; };
  // it stands with its back to you as you come in, and only then turns, unhurried, to face you
  mantis.rotation.y = Math.atan2(E.camera.position.x, E.camera.position.z) + Math.PI;
  let here = 0, turned = false;
  const amb = A.drone(74, { g: 0.05 }); const amb2 = A.drone(111.3, { g: 0.03 });
  // on the visit that ends with "see more" (every way seen), the control room is built ahead while the view is still white
  // (control.js prebuild, a piece a frame), so neither the question nor the change into it stalls
  let crossPre = null;
  if (count >= 4 && G.trust > -2) { crossPre = import('./control.js').then((m) => m.prebuild({ group: g, mantis })); await crossPre; }
  await fade(0, 1.4, '#fff');
  if (firstVisit) { firstVisit = false; note('crossroads'); say('A round metal room with ways leading off it. The tall one is here, and has been waiting.'); }
  else if (count >= 4) say('The tall one turns to face you.');

  const mantisHead = V(0, 1.9, 0);
  const result = await new Promise((res) => {
    let busy = false;
    const off = on((dt, t) => {
      const p = E.camera.position;
      const want = Math.atan2(p.x, p.z);
      let dy = want - mantis.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      here += dt;
      if (here > 0.3) {
        if (!turned) { turned = true; A.clicks(4); }
        mantis.rotation.y += dy * Math.min(1, dt * (here < 5 ? 0.9 : 1.5));
      }
      idleMantis(mantis, dt, t);
      if (Math.random() < dt * 0.12) A.clicks(3);
      if (busy) { E.canAct = false; return; }
      const dM = Math.hypot(p.x, p.z);
      let act = false;
      let h = count >= 4 ? 'The tall one is waiting for you.' : shut ? 'W A S D to walk, SHIFT to run.  The tall one is waiting.' : `W A S D to walk, SHIFT to run.  Doorways seen: ${count} of 4.`;
      if (dM < 2.6 && angleTo(mantisHead) < 0.6) {
        if (count >= 4) { if (here > 1.5 && Math.abs(dy) < 0.25) { h = 'E — face the tall one'; act = true; if (E.just.has('KeyE')) { E.canAct = false; off(); return res('mandala'); } } else h = 'The tall one is turning to you.'; }
        else {
          h = 'E — face the tall one'; act = true;
          if (E.just.has('KeyE')) { busy = true; E.canAct = false; hint(''); talk(mantis).then(() => (shut ? openDoors() : null)).then(() => { busy = false; }); return; }
        }
      }
      for (const d of doors) {
        if (p.distanceTo(d.eye) < 2.3 && angleTo(d.eye) < 0.7) {
          h = d.seen ? tr(d.name) + '. ' + tr('You have been through here.') : shut ? 'Shut. A ribbed slab of metal with no handle.' : `E — ${d.name}`;
          act = !d.seen && !shut;
          if (act && E.just.has('KeyE')) { E.canAct = false; off(); return res(d.id); }
        }
      }
      E.canAct = act;
      hint(h);
    });
  });
  hint(''); E.mode = 'locked';
  if (result === 'mandala') {
    E.mode = 'look';
    A.clicks(5);
    // no trust shown all night: they do not offer the vision
    let yes = false;
    // (the control room, where a yes leads, was built ahead under the white as this visit began; a no leaves it unused)
    let preP = crossPre;
    if (G.trust <= -2) await say('You are not ready.', 'them');
    else { await say('Would you like to see more?', 'them'); yes = (await choose(['Yes.', 'No. Take me home.'])) === 0; }
    if (!yes) {
      mantis.userData.tilt = 0.4;
      // a beat of looking, then a slow bow of the head that it holds, and rises from only a little
      if (mantis.userData.nod) tween(4.5, (k) => { const d = Math.min(1, Math.max(0, (k - 0.3) / 0.35)), u = Math.min(1, Math.max(0, (k - 0.8) / 0.2)); mantis.userData.nod(d * d * (3 - 2 * d) * (1 - 0.4 * u * u * (3 - 2 * u))); }, (k) => k);
      await say('They look at you a moment longer. Then they incline their head.');
      await say('Then rest.', 'them');
      amb.stop(2.5); amb2.stop(2.5);
      await fade(1, 2.5);
      return 'end:sceptic';
    }
    E.mode = 'locked';
    // it opens one arm and reaches down; your own hand comes up to meet it
    const me = makePlayerBody(), mu = me.userData;
    mu.torso.children[0].visible = false; mu.legs.visible = false; mu.armL.visible = false; E.camera.add(me);
    // (your arm's materials, compiled for the control room's lights too, once the build ahead is done)
    preP = preP.then((pre) => import('./control.js').then((m) => m.prebuildMe(pre, me)));
    const p0 = E.camera.position.clone(), near = p0.clone().multiplyScalar(1.25 / Math.max(1.25, Math.hypot(p0.x, p0.z))); near.y = p0.y;
    const aim = aimAt(V(0, 1.25, 0));
    moveView(2.2, { pos: near, yaw: aim.yaw, pitch: aim.pitch });
    // its left arm follows your hand down: the other fingers curl away and the tip of one long hook comes to rest in the middle
    // of your palm. Its right hand comes to rest on your left shoulder (just off the top left of the view).
    const palm = V(0, 0, 0), reach = palmReach(me), held = V(), fw = V(), shoulder = V();
    await tween(2.6, (k) => {
      // the palm goes to a point a little right of centre, 0.42 m ahead of the eyes and 0.3 m below them, carried with the view
      E.camera.getWorldDirection(fw); fw.y = 0; fw.normalize();
      held.copy(E.camera.position).addScaledVector(fw, 0.42).add(V(-fw.z * 0.06, -0.3, fw.x * 0.06));
      if (mantis.userData.setFold) mantis.userData.setFold(1 - Math.min(1, k * 1.2)); reach(held, Math.min(1, k * 1.2));
      if (mantis.userData.reachTo) {
        const r = Math.min(1, Math.max(0, (k - 0.15) / 0.8)), r2 = Math.min(1, Math.max(0, (k - 0.05) / 0.7));
        E.camera.updateMatrixWorld(true); mu.handR.localToWorld(palm.set(-0.022, -0.06, 0));
        // your left shoulder: 0.2 m left of the eyes, 0.23 m below them, a little behind
        shoulder.copy(E.camera.position).addScaledVector(fw, -0.06).add(V(fw.z * 0.2, -0.23, -fw.x * 0.2));
        mantis.userData.reachTo(palm, r * r * (3 - 2 * r), 1); mantis.userData.curl(1, Math.min(1, r * 1.5), true);
        mantis.userData.reachTo(shoulder, r2 * r2 * (3 - 2 * r2), -1); mantis.userData.curl(-1, 0.3 * r2, true);
      }
    }, (k) => k);
    A.clicks(3);
    await say('One hand settles on your shoulder. They lay one long finger in your open hand. It weighs nothing.');
    // the room begins to change around you: a deep hum and a tremor start here, and this room as it stands (the group, the
    // tall one with their finger in your palm, your arm) is handed on to the control room, which takes its place around you
    // (control.js); no fade
    const hum = A.shiftHum ? A.shiftHum(0.45) : null;
    amb.stop(2.5); amb2.stop(2.5);
    await tween(1.2, (k) => { E.shake = 0.0035 * k; });
    const pre = await preP;
    E.carry = { objs: [g, me], group: g, mantis, me, hum, pre };
    return 'control';
  }
  amb.stop(1); amb2.stop(1);
  await fade(1, 0.9, '#fff');
  return result;
}

// The player's right palm, open and facing up, carried to a world point by two-bone IK (makePlayerBody ikRight), the elbow
// down and out; for a body carried on the camera. reach(P, k): k 0 = arm at rest by the side, 1 = palm centre on P. The hand
// comes up from below and nearer, turning palm up and opening, and rises the last few centimetres onto the point.
const PALM = V(-0.022, -0.06, 0);   // palm centre on the palm's surface, in the right hand's frame (palm faces -x)
function palmReach(me) {
  const mu = me.userData, hr = mu.handRigR, sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  mu.relax(0.1); me.updateMatrixWorld(true);
  const qi = me.getWorldQuaternion(new THREE.Quaternion()).invert();
  const W0 = me.worldToLocal(mu.handR.getWorldPosition(V())), Q0 = qi.clone().multiply(mu.handR.getWorldQuaternion(new THREE.Quaternion()));
  const c0 = hr.curls.slice(), sp0 = hr.spread, op0 = hr.opp, tf0 = hr.tflex, cu = [0, 0, 0, 0];
  const pole = V(0.6, -1, 0.2), W = V(), Wc = V(), Wb = V(), C = V(), f = V(), rt = V(), hx = V(0, -1, 0), hy = V(), hz = V();
  const Q = new THREE.Quaternion(), Qw = new THREE.Quaternion(), Ql = new THREE.Quaternion(), m4 = new THREE.Matrix4();
  return (P, k) => {
    E.camera.updateMatrixWorld(true); me.updateMatrixWorld(true); me.getWorldQuaternion(qi).invert();
    // palm up (hand -x = world up), fingers along the heading and turned a little in toward the middle
    E.camera.getWorldDirection(f); f.y = 0; f.normalize(); rt.set(-f.z, 0, f.x);
    hy.copy(f).addScaledVector(rt, -0.25).normalize().negate(); hz.crossVectors(hx, hy);
    Ql.copy(qi).multiply(Qw.setFromRotationMatrix(m4.makeBasis(hx, hy, hz)));
    Wc.copy(me.worldToLocal(W.copy(P))).sub(C.copy(PALM).applyQuaternion(Ql));
    Wb.copy(Wc).add(V(0, -0.08, 0.05));
    C.copy(W0).lerp(Wb, 0.5).add(V(0.12, 0.02, 0));
    if (k < 0.75) { const t = sm(0, 0.75, k); W.copy(W0).multiplyScalar((1 - t) * (1 - t)).addScaledVector(C, 2 * t * (1 - t)).addScaledVector(Wb, t * t); }
    else W.lerpVectors(Wb, Wc, sm(0.75, 1, k));
    mu.ikRight(W, Q.slerpQuaternions(Q0, Ql, sm(0.05, 0.6, k)), pole);
    const h = sm(0.1, 0.6, k); for (let i = 0; i < 4; i++) cu[i] = lerp(c0[i], 0.05 + i * 0.03, h);
    hr.set(cu, lerp(sp0, 0.45, h), lerp(op0, 0.05, h), lerp(tf0, 0.05, h));
  };
}

async function talk(mantis) {
  E.mode = 'look';
  A.clicks(6);
  if (G.asked) {
    // it can be approached again; it says little, and never the same thing twice running
    const again = G.trust < 0 ? [
      ['Not yet.', 'them'],
      ['They say nothing at all.', 'self'],
      ['You are not ready.', 'them'],
    ] : [
      ['We are still teaching you.', 'them'],
      ['They tilt their head. A run of clicks, soft and fast, and nothing you can turn into words.', 'self'],
      ['Find joy.', 'them'],
      ['You must give something back.', 'them'],
      ['They look at you for a long time. You have the feeling of being read like a book.', 'self'],
      ['Calm.', 'them'],
    ];
    const [line, who] = again[(G.talks = (G.talks || 0) + 1) % again.length];
    mantis.userData.tilt = (Math.random() - 0.5) * 0.9;
    await say(line, who);
    E.mode = 'walk';
    return;
  }
  if (G.stare) await say('You held our gaze. Not many do.', 'them');
  else if (G.path === 'afraid') await say('You are afraid. That is all right.', 'them');
  await say('Do you trust us?', 'them'); note('trust'); note('clicking');
  const i = await choose(['Yes.', 'No.', '(Think something rude at them.)']);
  if (i === 0) { G.trust += 1; await say('We are still teaching you.', 'them'); }
  else if (i === 1) { G.trust -= 1; mantis.userData.tilt = 0.5; await say('They tilt their head and say nothing at all.'); }
  else {
    G.trust -= 1; mantis.userData.tilt = -0.6; A.clicks(5);
    await say('“What the hell are you.”', 'them');
    await say('Your own thought, given back flat. They seem almost bored.'); note('mimic');
  }
  G.asked = true; E.mode = 'walk';
}

// ---------- the classroom ----------
const CL_WALL = PEARL + `
void main() {
  float y = vWorld.y;
  float th = atan(vWorld.x, -vWorld.z);
  float u = th / 6.2831853 + 0.5;
  vec2 c = vec2(u * 36.0, y / 0.873);
  vec2 f1 = fract(c) - 0.5; vec2 f2 = fract(c + 0.5) - 0.5;
  float d = min(abs(length(f1) - 0.5), abs(length(f2) - 0.5));
  float pat = smoothstep(0.03, 0.0, d) * smoothstep(0.75, 1.0, y) * smoothstep(3.0, 2.6, y);
  vec3 col = vec3(0.86, 0.8, 0.69) * (0.8 + 0.22 * smoothstep(0.0, 3.4, y));
  col *= 1.0 - 0.07 * pat;
  col += vec3(0.07, 0.05, 0.0) * smoothstep(0.012, 0.0, abs(y - 0.68));
  col *= 1.0 - 0.1 * smoothstep(0.65, 0.0, y);
  col *= 0.96 + 0.04 * noise2(vec2(u * 400.0, y * 60.0));
  col += vec3(0.06, 0.05, 0.03) * exp(-(3.4 - y) * 3.0);
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(normalize(vNormal), v)), 3.0);
  col += pearl(fres, y * 0.04) * fres * 0.05;
  col *= 0.72 + 0.28 * smoothstep(0.0, 0.55, y);
  gl_FragColor = vec4(col, 1.0);
}`;
const CL_FLOOR = `
void main() {
  vec2 p = vWorld.xz - vec2(0.0, -2.6);
  float r = length(p);
  vec3 col = vec3(0.77, 0.71, 0.6);
  col *= 0.92 + 0.08 * noise2(vWorld.xz * 30.0) + 0.04 * noise2(vWorld.xz * 3.0);
  float rings = pow(0.5 + 0.5 * cos(r * 9.0), 30.0) * smoothstep(0.8, 1.2, r) * smoothstep(4.0, 2.0, r);
  col *= 1.0 - 0.06 * rings;
  col += vec3(0.08, 0.06, 0.03) * exp(-r * 0.9);
  col *= 0.88 + 0.12 * smoothstep(5.0, 3.0, length(vWorld.xz));
  col *= 0.72 + 0.28 * smoothstep(0.84, 1.25, r);
  col *= 0.8 + 0.2 * smoothstep(5.0, 4.6, length(vWorld.xz));
  gl_FragColor = vec4(col, 1.0);
}`;
const CL_CEIL = `
void main() {
  float rr = length(vWorld.xz) / 5.0;
  float th = atan(vWorld.x, -vWorld.z);
  vec3 col = vec3(1.0, 0.96, 0.88) * (0.82 + 0.18 * smoothstep(1.0, 0.0, rr));
  float petals = pow(abs(cos(th * 6.0)), 6.0) * smoothstep(0.15, 0.3, rr) * smoothstep(0.75, 0.45, rr);
  col *= 1.0 - 0.05 * petals;
  col *= 1.0 - 0.06 * smoothstep(0.015, 0.0, abs(rr - 0.3)) - 0.06 * smoothstep(0.015, 0.0, abs(rr - 0.78));
  col += exp(-rr * rr * 40.0) * 0.15;
  gl_FragColor = vec4(col, 1.0);
}`;
const CL_INLAY = `
void main() {
  vec2 p = vPos.xy;
  float r = length(p) / 0.5;
  float a = atan(p.y, p.x + 0.0001);
  float rays = pow(abs(cos(a * 8.0)), 12.0) * smoothstep(0.3, 0.45, r) * smoothstep(0.95, 0.8, r);
  float rg = smoothstep(0.02, 0.0, abs(r - 0.28)) + smoothstep(0.02, 0.0, abs(r - 0.92));
  vec3 col = vec3(0.79, 0.73, 0.58) + vec3(0.25, 0.18, 0.02) * (rays * 0.6 + rg) * (0.8 + 0.2 * sin(uTime * 1.3));
  gl_FragColor = vec4(col, 1.0);
}`;
// the star toy: a dark sphere inside, round soft stars on it, and a glass shell outside
const STAR_V = `
attribute float aSize; attribute vec3 aColor;
uniform float uScale;
varying vec3 vC; varying float vBig;
void main() {
  vC = aColor; vBig = smoothstep(0.03, 0.045, aSize);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(-mv.z, 0.05);
  gl_Position = projectionMatrix * mv;
}`;
const STAR_F = `
varying vec3 vC; varying float vBig;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r = length(p) * 2.0;
  float core = smoothstep(0.32, 0.0, r);
  float halo = exp(-r * r * 7.0) * 0.55;
  float spikes = vBig * (max(0.0, 1.0 - abs(p.x) * 30.0) + max(0.0, 1.0 - abs(p.y) * 30.0)) * max(0.0, 1.0 - r) * 0.8;
  float a = clamp(core + halo + spikes, 0.0, 1.0);
  if (a < 0.04) discard;
  gl_FragColor = vec4(vC * a + vec3(core * 0.7), 1.0);
}`;
const TOY_IN = `
void main() {
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n, v), 0.0);
  float neb = noise3(vPos * 9.0) * 0.6 + noise3(vPos * 22.0) * 0.4;
  vec3 col = mix(vec3(0.02, 0.03, 0.09), vec3(0.09, 0.1, 0.26), neb * neb);
  col += vec3(0.15, 0.2, 0.45) * pow(1.0 - ndv, 2.0) * 0.5;
  gl_FragColor = vec4(col, 0.985);
}`;
const GLASS_BALL = `
void main() {
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld);
  float ndv = abs(dot(n, v));
  float fres = pow(1.0 - ndv, 3.0);
  vec3 r = reflect(-v, n);
  float hl = pow(max(dot(r, normalize(vec3(-0.4, 0.8, 0.45))), 0.0), 80.0) * 1.6 + pow(max(dot(r, normalize(vec3(0.6, 0.3, 0.7))), 0.0), 30.0) * 0.4;
  vec3 col = vec3(0.6, 0.75, 1.0) * fres * 0.7 + vec3(1.0, 0.97, 0.9) * hl;
  gl_FragColor = vec4(col, 1.0);
}`;
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
const _face = new THREE.Vector3(), _front = new THREE.Vector3(0, 0, 1);
// thin rods along pairs of points, as a group
function rods(points, radius, mat, order) {
  const grp = new THREE.Group(), up = V(0, 1, 0), dir = new THREE.Vector3();
  for (let i = 0; i < points.length; i += 2) {
    const a = points[i], b = points[i + 1], m = new THREE.Mesh(unitCyl, mat);
    dir.subVectors(b, a); m.scale.set(radius, dir.length(), radius);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(up, dir.normalize());
    m.renderOrder = order; grp.add(m);
  }
  return grp;
}

async function classroom() {
  E.scene.background = new THREE.Color(0xd9cdb4);
  shaderScene();
  const g = new THREE.Group(); E.scene.add(g);
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 3.4, 96, 1, true), sm(CL_WALL, {}, { side: THREE.BackSide })); wall.position.y = 1.7;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(5, 96), sm(CL_FLOOR)); floor.rotation.x = -Math.PI / 2;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5, 64, 16, 0, Math.PI * 2, 0, Math.PI / 2), sm(CL_CEIL, {}, { side: THREE.BackSide })); dome.position.y = 3.4; dome.scale.y = 0.25;
  const cove = new THREE.Mesh(new THREE.TorusGeometry(4.95, 0.12, 10, 128, Math.PI * 2), std(0xcbbd9e, { roughness: 0.8 })); cove.rotation.x = Math.PI / 2; cove.position.y = 0.06;
  // the room is centred on the dais (z = -2.6), so the dais stands in the middle of the floor
  for (const m of [wall, floor, dome, cove]) m.position.z = -2.6;
  g.add(wall, floor, dome, cove, new THREE.HemisphereLight(0xffffff, 0x8a8f9c, 2));
  const cols = [KNOWN_KID.color, 0x9a6a6a, 0x6a9a7c, 0x8a7a55, 0x7a6a9a, 0x556a7a, 0x9a8a6a];
  const seatM = std(0xb3a07a, { roughness: 0.9 }), seats = new THREE.InstancedMesh(lathe([[0, 0], [0.2, 0], [0.23, 0.06], [0.23, 0.22], [0.2, 0.28], [0.12, 0.3], [0, 0.3]], 32), seatM, cols.length);
  const dummy = new THREE.Object3D(), kids = [];
  cols.forEach((c, i) => {
    const side = i % 2 ? 1 : -1, k = Math.floor(i / 2), s = 0.55 + (i % 3) * 0.08;
    // seated on low stools in a circle round the dais, open on your side; the nearest (i = 0) sits half turned toward you
    // and later shows off
    const th = side * (0.42 + k * 0.42), kid = makeHuman(i ? s : KNOWN_KID.scale, c, i ? { seated: true } : { seated: true, ...KNOWN_KID.hair });
    clearLap(kid);
    kid.position.set(Math.sin(th) * 2.2, 0, -2.6 + Math.cos(th) * 2.2);
    if (i === 0) seatKnownKid(kid); else kid.lookAt(0, 0, -2.6);
    g.add(kid); kids.push(kid);
    dummy.position.copy(kid.position); dummy.scale.setScalar(s * 1.5); dummy.updateMatrix(); seats.setMatrixAt(i, dummy.matrix);
  });
  g.add(seats);
  on((dt, t) => { for (let i = 0; i < kids.length; i++) idleHuman(kids[i], t + i * 1.3); });
  // The known child's eyes. mode 'you': held on you (the scripted beats). 'free': on the lesson (focusObj, or the space
  // over the dais), looking round at you every 4-11 s for 1.6-3.2 s; if you meet their eyes they hold it for about half a
  // second and look away. The eyes move first and the head follows them (humanGaze), aimed at the camera itself.
  const kidLook = { mode: 'you', focusObj: null, at: false, t: 2.5, met: 0, glances: 0, looks: 0 };
  {
    const gz = humanGaze(kids[0]), focus = V(0, 1.35, -2.6), eye = V(0, 0, 0), cd = V(0, 0, 0), kh = kids[0].userData.head;
    on((dt) => {
      const k = kidLook;
      if (k.mode === 'free') {
        k.t -= dt;
        if (k.at) {
          kh.getWorldPosition(eye); E.camera.getWorldDirection(cd);
          if (cd.angleTo(eye.sub(E.camera.position)) < 0.2) k.met += dt;   // you are looking at their face
          if (k.met > 0.55 || k.t <= 0) { k.at = false; if (k.met > 0.55) k.looks++; k.met = 0; k.t = 4 + Math.random() * 7; }
        } else if (k.t <= 0) { k.at = true; k.glances++; k.t = 1.6 + Math.random() * 1.6; }
      }
      const tgt = k.mode === 'you' || (k.mode === 'free' && k.at) ? E.camera.position : k.focusObj ? k.focusObj.getWorldPosition(focus) : focus.set(0, 1.35, -2.6);
      gz.update(dt, tgt, 1);
    });
  }
  // low lucidity: look back and some of them have turned on their stools to look at you (not the nearest: they already do).
  // Turned about their own stool, which is round, so nothing moves into anything (checked: shots/b140/kids.js).
  kids.forEach((kid, i) => {
    if (!i) return;
    const home = kid.quaternion.clone();
    unsteady(kid, (k) => { if (k) kid.lookAt(E.camera.position.x, 0, E.camera.position.z); else kid.quaternion.copy(home); });
  });
  const teacher = makeGrey(); teacher.position.set(-0.55, 0, -1.75); teacher.lookAt(0, 0, 1.2); g.add(teacher);
  const second = makeGrey(); second.position.set(1.5, 0, -2.9); second.lookAt(0, 0, 1.2); g.add(second);
  // stepped dais, top at y = 0.5, gold-lit edges and an inlaid sun
  const dais = new THREE.Mesh(lathe([[0, 0], [0.85, 0], [0.85, 0.1], [0.8, 0.12], [0.68, 0.12], [0.68, 0.32], [0.62, 0.34], [0.58, 0.34], [0.58, 0.48], [0.55, 0.5], [0, 0.5]], 64), std(0xc9b994, { roughness: 0.5, metalness: 0.1 }));
  dais.position.set(0, 0, -2.6); g.add(dais);
  const goldGlow = basic(0xffd98a);
  for (const [r, y] of [[0.585, 0.47], [0.69, 0.3], [0.86, 0.06]]) { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 6, 80), goldGlow); t.rotation.x = Math.PI / 2; t.position.set(0, y, -2.6); g.add(t); }
  const inlay = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48), sm(CL_INLAY)); inlay.rotation.x = -Math.PI / 2; inlay.position.set(0, 0.502, -2.6); g.add(inlay);
  // warm light falling from the dome onto the dais, and dust turning in it
  const beam = shaft(0.45, 0.72, 2.9, 0xfff0c8, 0.2); beam.position.set(0, 1.95, -2.6); g.add(beam);
  g.add(motes(220, V(0, 1.7, -1.2), V(4, 1.6, 3.4), 0xfff1d0, 0.9));
  setView(0, 1.4, 1.3, 0, 0); E.limits = { yaw: 1.25, up: 0.7, down: 0.7 }; E.mode = 'look'; E.unsteady = true;
  const amb = A.drone(220, { g: 0.025 });
  await fade(0, 1.4, '#fff');
  note('class');
  await say('A round, sand-coloured room. Warm light falls from the dome onto a low dais, and children sit in a circle round it. None of them looks afraid.');
  await lookToward(V(kids[0].position.x, 0.7, kids[0].position.z), 1.4);
  await say('The child nearest you is looking right at you.');
  await say('You know this child. You cannot think where from.');
  // and they look away, back to the lesson; from now on only glances
  Object.assign(kidLook, { mode: 'free', at: false, t: 4.5 });
  if (window.UAP) window.UAP.classroom = { kids, kidLook };
  await moveView(1.2, { yaw: 0, pitch: 0 });
  await say('We will play.', 'them');

  // lesson 1: the sky from home. The star ball floats in the light over the middle of the dais and stays there the whole
  // lesson: it grows in out of the shaft, drifts gently up and down, and you turn it from where you sit. The ball, its glass
  // shell and the gold guide share one holder, so they can never part.
  const TOYS = 2, TOYY = 1.55, holder = new THREE.Group(); holder.position.set(0, TOYY, -2.6); holder.scale.setScalar(0.001); g.add(holder);
  const toy = new THREE.Group(); holder.add(toy);
  const R = 0.45, sp = [], sz = [], sc = [];
  for (let i = 0; i < 260; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(R); sp.push(v.x, v.y, v.z);
    const b = Math.random(), tint = Math.random();
    sz.push(0.006 + b * b * b * 0.02); sc.push(0.75 + 0.25 * tint, 0.8 + 0.1 * tint, 1.0 - 0.3 * tint * tint);
  }
  const orion = [[-0.13, 0.2], [0.11, 0.19], [-0.05, 0], [0, 0.012], [0.05, 0.024], [-0.11, -0.2], [0.13, -0.21]].map(([x, y]) => V(x, y, Math.sqrt(R * R - x * x - y * y)));
  const oSize = [0.055, 0.044, 0.04, 0.04, 0.04, 0.042, 0.06];
  orion.forEach((p, i) => { sp.push(p.x, p.y, p.z); sz.push(oSize[i]); if (i === 0) sc.push(1.0, 0.62, 0.35); else sc.push(0.78, 0.88, 1.0); });
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sg.setAttribute('aSize', new THREE.Float32BufferAttribute(sz, 1));
  sg.setAttribute('aColor', new THREE.Float32BufferAttribute(sc, 3));
  const stars = new THREE.Points(sg, new THREE.ShaderMaterial({ vertexShader: STAR_V, fragmentShader: STAR_F, uniforms: { uScale: { value: pxScale() * TOYS } }, transparent: true, blending: THREE.AdditiveBlending }));   // point sizes are in world units, so they take the holder's scale by hand
  stars.renderOrder = 1; toy.add(stars);
  const inner = new THREE.Mesh(new THREE.SphereGeometry(0.44, 48, 32), sm(TOY_IN, {}, { transparent: true, depthWrite: false }));
  inner.renderOrder = 2; toy.add(inner);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.475, 48, 32), sm(GLASS_BALL, {}, ADD));
  shell.renderOrder = 3; holder.add(shell);
  const segs = [0, 2, 1, 4, 2, 3, 3, 4, 2, 5, 4, 6, 0, 1, 5, 6].map((i) => orion[i]);
  const lineM = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0, depthWrite: false });
  toy.add(rods(segs, 0.0028, lineM, 4));
  // the gold guide: fixed rods and a ring round each bright star's place
  const goldM = new THREE.MeshBasicMaterial({ color: 0xe0a83a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const guide = rods(segs, 0.0035, goldM, 5);
  const ringG = new THREE.RingGeometry(0.02, 0.026, 32);
  for (const p of orion) { const r = new THREE.Mesh(ringG, goldM); r.position.copy(p); r.lookAt(p.clone().multiplyScalar(2)); r.renderOrder = 5; guide.add(r); }
  guide.scale.setScalar(1.03); holder.add(guide);
  const bobToy = on((dt, t) => { holder.position.y = TOYY + Math.sin(t * 0.8) * 0.035; });
  // The sky turns like a ball under your hand: mouse right drags the near side right, mouse down drags it down,
  // whichever way it is already turned. Only the near side shows, so nothing ever appears to move backwards.
  const q = toy.quaternion, dq = new THREE.Quaternion(), HOME = new THREE.Quaternion(), ax = new THREE.Vector3();
  q.setFromEuler(new THREE.Euler(-0.55, 1.1, 0));
  let good = 0, tt = 0, idle = 0;
  // your eyes go to the toy and stay on it while you turn it, wherever you were looking before
  E.mode = 'locked';
  A.shimmer(659.3, 2.2, 0.02);
  { const lk = aimAt(V(0, TOYY, -2.6)); moveView(1.2, { yaw: 0, pitch: lk.pitch }); }
  kidLook.focusObj = holder;
  await tween(1.4, (k) => holder.scale.setScalar(Math.max(0.001, TOYS * k)), (k) => 1 - Math.pow(1 - k, 3));
  E.captureLook = (dx, dy) => {
    idle = 0;
    q.premultiply(dq.setFromAxisAngle(ax.set(0, 1, 0), dx * 1.3));
    q.premultiply(dq.setFromAxisAngle(ax.set(1, 0, 0), dy * 1.3));
    q.normalize();
  };
  hint('Move the mouse to turn the sky. Line the bright stars up with the gold outline.');
  await new Promise((res) => {
    const off = on((dt) => {
      tt += dt; idle += dt;
      const err = _face.set(0, 0, 1).applyQuaternion(q).angleTo(_front);   // how far the constellation is from facing you, ignoring roll
      // close enough and it settles into place by itself; after a long while it drifts home so nobody is stuck here
      if (err < 0.75 && idle > 0.1) q.slerp(HOME, Math.min(1, dt * 3.5));
      else if (tt > 20) q.slerp(HOME, Math.min(1, dt * 1.2));
      good = err < 0.3 && q.angleTo(HOME) < 0.35 ? good + dt : 0;
      if (good > 0.35) { off(); res(); }
    });
  });
  E.captureLook = null; hint('');
  A.settle();
  const q0 = q.clone();
  await tween(0.8, (k) => { q.slerpQuaternions(q0, HOME, k); lineM.opacity = k; });
  E.mode = 'look';
  note('startoy');
  await say('The sky as it looks from home.');
  await tween(0.8, (k) => holder.scale.setScalar(Math.max(0.001, TOYS * (1 - k))), (k) => k * k);
  bobToy(); discard(holder);

  // lesson 2: the orb
  const coneG = new THREE.ConeGeometry(0.2, 0.32, 4).toNonIndexed(); coneG.computeVertexNormals();
  const OG = [new THREE.SphereGeometry(0.15, 32, 24), new THREE.BoxGeometry(0.26, 0.26, 0.26), coneG];
  const OC = [0xffe08a, 0x5a86ff, 0xb070ff];
  const ou = { uColor: { value: dcol(OC[0]) }, uGlow: { value: 0.4 } };
  const orb = new THREE.Mesh(OG[0], sm(JEWEL, ou));
  orb.position.set(0, 1.25, -2.6); g.add(orb); kidLook.focusObj = orb;
  const ol = new THREE.PointLight(0xffe08a, 2, 5); orb.add(ol);
  const haloM = new THREE.SpriteMaterial({ map: glowTex(), color: OC[0], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 });
  const halo = new THREE.Sprite(haloM); halo.scale.setScalar(0.9); orb.add(halo);
  const orbitM = basic(0xffe9b0, { transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const [r, rx] of [[0.26, 1.2], [0.31, -0.6]]) { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.003, 6, 80), orbitM); t.rotation.x = rx; orb.add(t); }
  const hum = A.drone(330, { type: 'triangle', g: 0.02 });
  await say('Now this. Change it. Then bring it to you.', 'them');
  hint("Keep your eyes on it and follow it slowly. Don't grab at it.");
  // what to do is shown on the orb itself (that looking at it is what changes it is otherwise easy to miss): a ring round
  // it fills as it changes and brightens while your eyes are on it, a dot marks where your eyes are, and a faint line
  // runs from the dot to the orb whenever you have lost it. On a phone, FOCUS (E.gazeAt) eases your view onto it.
  const gz = $('gaze'), gzDot = $('gazeDot'), gzLine = $('gazeLine'), gv = V(0, 0, 0);
  gz.style.display = gzDot.style.display = 'block'; E.gazeAt = orb.position;
  const gaze = (p, aimed, snapped, col) => {
    gv.copy(orb.position).project(E.camera);
    const W = innerWidth, H = innerHeight, x = (gv.x + 1) / 2 * W, y = (1 - gv.y) / 2 * H, behind = gv.z > 1;
    const d = E.camera.position.distanceTo(orb.position), r = Math.max(26, Math.min(160, 0.3 / d / Math.tan(E.camera.fov * Math.PI / 360) * H / 2));
    gz.style.display = behind ? 'none' : 'block';
    gz.style.width = gz.style.height = (2 * r).toFixed(0) + 'px'; gz.style.transform = `translate(${(x - r).toFixed(1)}px, ${(y - r).toFixed(1)}px)`;
    gz.style.setProperty('--p', (Math.min(1, p) * 100).toFixed(1) + '%'); gz.style.setProperty('--c', col);
    gz.classList.toggle('on', aimed); gz.classList.toggle('snap', snapped);
    const dx = x - W / 2, dy = y - H / 2, len = Math.hypot(dx, dy) - r - 6;
    gzLine.style.display = !aimed && !behind && len > 12 ? 'block' : 'none';
    gzLine.style.width = Math.max(0, len).toFixed(0) + 'px'; gzLine.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
  };
  // a change of shape is seen happening: it shrinks and spins, takes the new shape at its smallest, and swells back
  let morph = 0, pending = -1; const MORPH = 0.8;
  const reshape = (s) => {
    orb.geometry = OG[s];
    ou.uColor.value.setHex(OC[s], THREE.LinearSRGBColorSpace); ol.color.setHex(s === 1 ? 0x3d6bff : 0x9a4bff); haloM.color.setHex(OC[s]); orbitM.color.setHex(OC[s]);
  };
  let p = 0, stage = 0, flinch = 0; tt = 0; let told = 0, nudged = false;
  await new Promise((res) => {
    const off = on((dt, t) => {
      tt += dt; flinch = Math.max(0, flinch - dt * 2);
      // its drift runs on the lesson's own clock (tt from 0), so it sets off from where it was shown, over the dais, and
      // eases out to its full wander over the first 3 s instead of jumping to wherever the scene clock had it
      const roam = Math.min(1, tt / 3), ramp = roam * roam * (3 - 2 * roam);
      orb.position.set(Math.sin(tt * 0.33) * 0.75 * ramp + flinch * 0.5, 1.25 + Math.sin(tt * 0.47) * 0.16 * ramp + flinch * 0.3, -2.6);
      orb.rotation.y += dt * 0.6; orb.rotation.x += dt * 0.25;
      if (morph > 0) {
        morph = Math.max(0, morph - dt); const k = 1 - morph / MORPH, sk = Math.sin(Math.PI * k);
        orb.scale.setScalar(1 - 0.6 * sk); orb.rotation.y += dt * 9 * sk;
        if (k >= 0.5 && pending >= 0) { reshape(pending); pending = -1; }
      } else orb.scale.setScalar(1);
      const aimed = angleTo(orb.position) < 0.085, sp2 = E.lookSpeed || 0;
      if (aimed && sp2 < 0.7) p += dt / 15;
      else if (sp2 > 2.4) { p -= dt / 3; flinch = 1; }
      else p -= dt / 50;
      if (tt > 80) p += dt / 6;
      p = Math.max(0, p);
      ou.uGlow.value = 0.4 + (aimed ? 1.2 : 0); haloM.opacity = aimed ? 0.9 : 0.55; hum.set(330 + p * 330, aimed ? 0.06 : 0.02, 0.1);
      bar(p);
      const s = p >= 0.66 ? 2 : p >= 0.33 ? 1 : 0;
      if (s > stage) { stage = s; A.bloom(s); if (pending >= 0) reshape(pending); pending = s; morph = MORPH; }
      gaze(p, aimed, flinch > 0.3, '#' + OC[stage].toString(16).padStart(6, '0'));
      if (!nudged && tt > 6 && p < 0.08) { nudged = true; say('Keep your eyes on it.', 'them'); }
      if (told === 0 && tt > 16 && p < 0.5) { told = 1; say("Don't be afraid that it won't work. You're holding yourself back.", 'them'); note('holding'); }
      if (told === 1 && tt > 38 && p < 0.8) { told = 2; say('Just have them take it again.', 'them'); note('again'); }
      if (p >= 1) { off(); res(); }
    });
  });
  bar(null); hint(''); note('orb'); G.lucidity += 0.06;
  if (pending >= 0) reshape(pending); orb.scale.setScalar(1);
  gz.style.display = gzDot.style.display = gzLine.style.display = 'none'; E.gazeAt = null; E.steady = false;
  A.release();
  const o0 = orb.position.clone();
  await tween(2.5, (k) => orb.position.lerpVectors(o0, V(0, 1.3, 0.5), k));
  hum.stop(0.5);
  await say('It comes to you.');
  {
    const kid = kids[0];
    kidLook.mode = 'you';
    E.mode = 'locked'; await lookToward(V(kid.position.x, 0.7, kid.position.z), 1.2);
    A.inner();
    await say('The child speaks without moving their lips: “Watch. I can do it too.”');
    // everything loose in the room lifts at once: the children, their stools, the two greys, the orb, and you
    const lifted = [...kids, seats, teacher, second, orb], y0 = lifted.map((o) => o.position.y), cy = E.camera.position.y;
    const hum2 = A.drone(110, { type: 'triangle', g: 0.0001 }); hum2.set(110, 0.06, 1.5);
    const lift = (h) => { lifted.forEach((o, j) => { o.position.y = y0[j] + h * (o === kid ? 0.6 : 0.4 + (j % 3) * 0.08); }); E.camera.position.y = cy + h * 0.12; };
    let liftK = 0;
    const lt0 = lifted.map((o) => o.position.clone());
    const floatT = on((dt, t) => { if (liftK > 0) lifted.forEach((o, j) => { o.position.x = lt0[j].x + Math.sin(t * 0.6 + j * 1.7) * 0.015 * liftK; o.position.z = lt0[j].z + Math.cos(t * 0.5 + j * 2.3) * 0.015 * liftK; }); });
    await tween(2.2, (q) => { liftK = q; lift(q); }, (q) => q * q * (3 - 2 * q));
    E.shake = 0.004;
    await say('Everything in the room comes up off the floor at once: the stools, the other children, the greys, you. Nobody else is surprised.');
    await wait(1.2);
    await tween(2.0, (q) => { liftK = 1 - q; lift(1 - q); }, (q) => q * q * (3 - 2 * q));
    floatT(); lifted.forEach((o, j) => { o.position.x = lt0[j].x; o.position.z = lt0[j].z; }); E.shake = 0; hum2.stop(1);
    await say('Everything settles back without a sound. The child looks very pleased.');
    note('hybridkids');
    E.mode = 'look';
  }
  amb.stop(1);
  await fade(1, 1, '#fff');
}

// ---------- the window ----------
// Real geography: img/earth_day.jpg is NASA Blue Marble (land_shallow_topo, public domain);
// img/earth_data.png packs R = SRTM elevation, G = NASA city lights, B = water mask (built from NASA public-domain maps).
let EARTH_TEX = null;
function earthTex() {
  if (!EARTH_TEX) {
    const L = new THREE.TextureLoader();
    const day = L.load('img/earth_day.jpg'), data = L.load('img/earth_data.png'), moon = L.load('img/moon.jpg');
    for (const t of [day, data, moon]) { t.userData.keep = true; t.anisotropy = 4; }
    EARTH_TEX = { day, data, moon };
  }
  return EARTH_TEX;
}
const EARTH = `
uniform vec3 uSun; uniform sampler2D uDay; uniform sampler2D uData;
float fbmC(vec3 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise3(p); p = p * 2.2 + vec3(5.3, 1.1, 7.7); a *= 0.5; } return s; }
void main() {
  vec3 p = normalize(vPos);
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  vec2 uv = vUv;
  vec4 d = texture2D(uData, uv);
  float water = smoothstep(0.3, 0.7, d.b);
  float land = 1.0 - water;
  vec3 alb = pow(texture2D(uDay, uv).rgb, vec3(2.2));
  // a little more life in the Blue Marble colours, deeper open ocean
  float lum = dot(alb, vec3(0.3, 0.55, 0.15));
  alb = max(mix(vec3(lum), alb, 1.12), 0.0);
  alb = mix(alb, alb * vec3(0.55, 0.8, 1.25), water * 0.6);
  // relief from the elevation map: tilt the normal by the slope (east and north in world space)
  float cosl = sqrt(max(1.0 - p.y * p.y, 0.02));
  vec2 tx = vec2(1.5 / 2048.0, 1.5 / 1024.0);
  float hE = texture2D(uData, uv + vec2(tx.x, 0.0)).r - texture2D(uData, uv - vec2(tx.x, 0.0)).r;
  float hN = texture2D(uData, uv + vec2(0.0, tx.y)).r - texture2D(uData, uv - vec2(0.0, tx.y)).r;
  vec3 east = cross(vec3(0.0, 1.0, 0.0), n); east /= max(length(east), 1e-4);
  vec3 north = cross(n, east);
  vec3 nb = normalize(n - 2.6 * land * (hE / cosl * east + hN * north));
  float ndl = dot(n, uSun);
  float lit = smoothstep(-0.06, 0.14, ndl);
  float diff = max(dot(nb, uSun), 0.0) * lit;
  float day = smoothstep(-0.15, 0.2, ndl);
  // clouds: drifting, banded by latitude (storm tracks and the tropics, clearer subtropics)
  float ca = uTime * 0.006;
  vec3 pc = vec3(p.x * cos(ca) - p.z * sin(ca), p.y, p.x * sin(ca) + p.z * cos(ca));
  float lat = abs(p.y);
  vec3 wq = vec3(noise3(pc * 2.5), noise3(pc * 2.5 + 7.3), noise3(pc * 2.5 + 3.1));
  float cn = fbmC(pc * 5.0 + (wq - 0.5) * 2.2 + vec3(0.0, uTime * 0.003, 0.0));
  cn += (noise3(pc * 34.0 + wq * 3.0) - 0.5) * 0.12;
  float band = 0.5 + 0.12 * smoothstep(0.25, 0.0, lat) - 0.1 * smoothstep(0.15, 0.0, abs(lat - 0.42)) + 0.14 * smoothstep(0.6, 0.85, lat);
  float cl = smoothstep(1.0 - band, 1.2 - band, cn);
  cl = cl * cl * (0.6 + 0.4 * noise3(pc * 22.0 + wq * 4.0)) * 0.92;
  // surface light: sun plus a faint blue skylight
  vec3 col = alb * (vec3(1.0, 0.97, 0.92) * 2.1 * diff + vec3(0.02, 0.03, 0.05) * day + 0.004);
  // sun glint on the sea, sharp core and a broad sheen, stronger at grazing angles
  vec3 hv = normalize(uSun + v);
  float ndh = max(dot(n, hv), 0.0);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(hv, v), 0.0), 5.0);
  col += vec3(1.0, 0.9, 0.78) * (pow(ndh, 500.0) * 2.5 * (0.5 + 2.0 * fres) + pow(ndh, 60.0) * 0.12) * water * lit * (1.0 - cl);
  // city lights on the night side
  vec3 city = vec3(1.0, 0.62, 0.28) * pow(d.g, 1.3) * 1.6 * land;
  col += city * (1.0 - day) * (1.0 - cl * 0.8);
  // cloud deck: lit on top, soft shadow tone near the terminator
  vec3 cloudC = vec3(1.0) * (2.0 * max(ndl, 0.0) * lit + 0.006) + vec3(0.9, 0.35, 0.15) * smoothstep(0.18, 0.0, abs(ndl - 0.04)) * 0.15;
  col = mix(col * (1.0 - cl * 0.35), cloudC, cl);
  // air seen edge-on: blue haze over the day side and a thin warm terminator
  float ndv = max(dot(n, v), 0.0);
  float haze = pow(1.0 - ndv, 3.5);
  col = mix(col, vec3(0.18, 0.38, 0.95) * (0.1 + 1.4 * max(ndl + 0.1, 0.0)), haze * 0.6 * smoothstep(-0.25, 0.3, ndl));
  col += vec3(0.08, 0.2, 0.6) * 0.03 * day * (1.0 - cl);
  col += vec3(1.0, 0.45, 0.2) * smoothstep(0.12, 0.0, abs(ndl - 0.02)) * 0.04 * (1.0 - cl);
  col = col / (1.0 + col * 0.35);
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;
const ATMO = `
uniform vec3 uSun;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  float g = pow(smoothstep(0.0, 0.28, -dot(n, v)), 1.6);
  g *= 0.2 + 0.8 * smoothstep(-0.35, 0.5, dot(n, uSun));
  gl_FragColor = vec4(vec3(0.3, 0.55, 1.0) * g * 1.3, 1.0);
}`;
// the faint outer glow of the air, wider and softer than ATMO
const AIRGLOW = `
uniform vec3 uSun;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  float g = pow(smoothstep(0.0, 0.55, -dot(n, v)), 3.0);
  g *= 0.15 + 0.85 * smoothstep(-0.4, 0.6, dot(n, uSun));
  gl_FragColor = vec4(vec3(0.25, 0.45, 1.0) * g * 0.22, 1.0);
}`;
// img/moon.jpg: NASA LRO colour map (SVS CGI Moon Kit, public domain); near side faces the window
const MOON = `
uniform vec3 uSun; uniform sampler2D uMap;
void main() {
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld);
  vec3 alb = pow(texture2D(uMap, vUv).rgb, vec3(2.2));
  float diff = max(dot(n, uSun), 0.0);
  // dusty regolith: flatter than a matte ball, so the full disc stays bright to the edge
  float ls = 2.0 * diff / (diff + max(dot(n, v), 0.02));
  vec3 col = alb * (mix(diff, ls, 0.6) * 1.7 + 0.003);
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;
// faint glare and smudges on the great window, mostly at grazing angles
const PANE = `
uniform float uFilm;
void main() {
  vec2 p = vPos.xy;
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(v.z), 4.0);
  float streak = smoothstep(0.35, 0.0, abs(p.x * 0.6 + p.y - 0.8 + sin(p.y * 0.7) * 0.2)) * 0.5 + smoothstep(0.12, 0.0, abs(p.x * 0.6 + p.y + 1.3)) * 0.35;
  float edge = smoothstep(3.3, 4.0, abs(p.x)) + smoothstep(1.4, 2.0, abs(p.y));
  float smudge = noise2(p * 3.0) * 0.5 + noise2(p * 11.0) * 0.5;
  float a = (streak * 0.06 + edge * 0.05 + fres * 0.1 + 0.012) * (0.6 + 0.7 * smudge);
  // the room behind you, faint in the glass: a broad sheen and the pale ribs of the hall, sliding against the view as you move
  vec2 rq = p + v.xy * 2.5;
  float sheen = smoothstep(1.5, 0.0, abs(rq.x * 0.45 - rq.y * 0.85 + 0.5)) * 0.022;
  float ribs = pow(0.5 + 0.5 * cos(rq.x * 5.2 + 0.6), 30.0) * smoothstep(-2.2, 0.0, rq.y) * smoothstep(2.2, 0.9, rq.y) * 0.016;
  float lowGlow = smoothstep(0.0, -2.0, p.y) * 0.016;
  a += (sheen + ribs + lowGlow) * (0.75 + 0.35 * smudge);
  gl_FragColor = vec4(vec3(0.6, 0.72, 1.0) * a * (1.0 - uFilm * 0.7), 1.0);
}`;
// thin slices of haze stacked in front of the window: the room's air catching its light
const SLICE = `
uniform vec3 uWinC; uniform float uFilm; uniform float uK;
void main() {
  vec2 p = vPos.xy;
  vec2 q = abs(p) - vec2(3.9, 1.95);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float blur = 0.25 + uK * 1.5;
  float a = 1.0 - smoothstep(-blur, blur, d);
  a *= 0.55 + 0.45 * noise2(p * 0.7 + vec2(uTime * 0.04, uK * 7.0));
  float strength = mix(0.014, 0.04, uFilm) * (1.0 - uK * 0.6);
  gl_FragColor = vec4(uWinC * a * strength, 1.0);
}`;
const SKY = `
void main() {
  vec3 d = normalize(vPos);
  float band = exp(-pow(dot(d, normalize(vec3(0.6, 0.7, 0.2))), 2.0) * 14.0);
  float n = noise3(d * 3.0) * 0.6 + noise3(d * 7.0) * 0.3 + noise3(d * 17.0) * 0.1;
  vec3 col = vec3(0.004, 0.006, 0.016);
  col += vec3(0.07, 0.065, 0.11) * band * smoothstep(0.35, 0.8, n);
  col += vec3(0.08, 0.03, 0.06) * band * pow(n, 4.0) * 0.8;
  gl_FragColor = vec4(col, 1.0);
}`;
const SKYSTAR_V = `
attribute float aSize; attribute vec3 aColor; attribute float aPh;
uniform float uTime; uniform float uPR;
varying vec3 vC;
void main() {
  vC = aColor * (0.75 + 0.25 * sin(uTime * (1.0 + aPh * 3.0) + aPh * 40.0));
  gl_PointSize = aSize * uPR;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKYSTAR_F = `
varying vec3 vC;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, r);
  gl_FragColor = vec4(vC * a * a, 1.0);
}`;
// dark deck panels; walls nearer the window catch its light
const DECK = `
uniform vec3 uWinC;
void main() {
  vec3 n = normalize(vNormal);
  vec2 p = abs(n.z) > 0.5 ? vWorld.xy : (abs(n.x) > 0.5 ? vWorld.zy : vWorld.xz);
  vec2 cell = vec2(1.1, 0.8);
  vec2 e = (0.5 - abs(fract(p / cell) - 0.5)) * cell;
  float seam = smoothstep(0.012, 0.004, min(e.x, e.y));
  vec3 col = vec3(0.07, 0.08, 0.1) * (0.85 + 0.3 * hash2(floor(p / cell)));
  float wd = max(vWorld.z + 4.6, 0.0);
  col += uWinC * exp(-wd * 0.3) * 0.22 * (0.4 + 0.6 * max(-n.z, 0.0));
  col *= 1.0 - 0.5 * seam;
  col += vec3(0.3, 0.5, 0.9) * smoothstep(0.02, 0.0, abs(vWorld.y - 0.25)) * 0.5 * step(abs(n.y), 0.5);
  col += vec3(0.25, 0.4, 0.7) * smoothstep(0.03, 0.0, abs(abs(vWorld.x) - 2.2)) * step(0.5, n.y * -1.0) * 0.4;
  gl_FragColor = vec4(col, 1.0);
}`;
// polished floor: a soft reflection of the window, the film or the Earth beyond it
const DECK_FLOOR = `
uniform vec3 uWinC; uniform float uFilm;
void main() {
  vec2 p = vWorld.xz;
  vec2 e = (0.5 - abs(fract(p / 1.1) - 0.5)) * 1.1;
  float seam = smoothstep(0.01, 0.003, min(e.x, e.y));
  vec3 col = vec3(0.025, 0.028, 0.035) * (0.9 + 0.2 * hash2(floor(p / 1.1)));
  vec3 v = normalize(vWorld - cameraPosition);
  vec3 rd = vec3(v.x, -v.y, v.z);
  rd.xy += (vec2(noise2(p * 7.0), noise2(p * 7.0 + 9.0)) - 0.5) * 0.03;
  float fres = 0.12 + 0.6 * pow(1.0 - abs(v.y), 4.0);
  vec3 rc = vec3(0.0);
  if (rd.z < -0.01) {
    float t = (-4.5 - vWorld.z) / rd.z;
    vec2 h = vec2(vWorld.x + rd.x * t, rd.y * t);
    float soft = 0.05 + t * 0.04;
    float inW = smoothstep(4.0 + soft, 4.0 - soft, abs(h.x)) * smoothstep(0.1 - soft, 0.1 + soft, h.y) * smoothstep(4.1 + soft, 4.1 - soft, h.y);
    float t2 = (-13.0 - vWorld.z) / rd.z;
    vec2 h2 = vec2(vWorld.x + rd.x * t2, rd.y * t2);
    float earth = smoothstep(5.7, 5.3, length(h2 - vec2(0.0, -3.4)));
    vec3 beyond = vec3(0.25, 0.45, 0.85) * earth * 0.6 + vec3(0.01, 0.015, 0.03);
    rc = mix(beyond, uWinC, uFilm) * inW;
  }
  col += rc * fres * 1.4;
  col *= 1.0 - 0.6 * seam;
  float lane = smoothstep(0.02, 0.0, abs(abs(vWorld.x) - 1.6)) * step(vWorld.z, 0.5) * (0.5 + 0.5 * sin(vWorld.z * 4.0 + uTime * 2.0));
  col += vec3(0.2, 0.35, 0.7) * lane * 0.4;
  col += vec3(0.2, 0.32, 0.6) * exp(-max(vWorld.z + 4.45, 0.0) * 3.0) * 0.4 * smoothstep(4.3, 3.8, abs(vWorld.x));
  gl_FragColor = vec4(col, 1.0);
}`;
// The film on the great window: one landscape in three movements, driven by uK (0..1).
// 0 - 0.30 the living world; 0.30 - 0.62 what was done to it; 0.69 a single soft white flash, then three
// detonations, the firestorm, and from 0.86 a still, grey, dead plain. uFade is the screen's opacity.
const FILM = `
uniform float uK; uniform float uFade; uniform float uT0;
float fbm2(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise2(p); p = p * 2.03 + vec2(13.1, 7.7); a *= 0.5; } return s; }
float ridge(float x, float seed) { return noise2(vec2(x, seed)) * 0.6 + noise2(vec2(x * 2.7, seed + 9.0)) * 0.28 + noise2(vec2(x * 7.1, seed + 3.0)) * 0.12; }
float segd(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a; vec2 ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// nearest of a jittered grid of points: (distance, how far the pixel sits on the sunward side of it, id).
// Rounded clumps for foliage: no square cells.
vec3 clump(vec2 p) {
  vec2 ci = floor(p); vec2 cf = fract(p);
  float best = 9.0; float lit = 0.0; float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash2(ci + g), hash2(ci + g + 31.7));
      vec2 r = g + o - cf;
      float d = dot(r, r);
      if (d < best) { best = d; lit = dot(r, vec2(-0.6, -0.8)); id = o.x; }
    }
  }
  return vec3(sqrt(best), lit, id);
}
// one mushroom cloud, m = 0..1 through its rise: returns (density, heat)
vec2 shroom(vec2 p, vec2 base, float sc, float m) {
  if (m <= 0.0) return vec2(0.0);
  vec2 q = (p - base) / sc;
  float rise = 1.0 - (1.0 - m) * (1.0 - m);
  float top = 0.07 + 0.33 * rise;
  float wob = noise2(q * 7.0 + vec2(0.0, -uTime * 0.2)) - 0.5;
  float wob2 = noise2(q * 19.0 + vec2(3.0, -uTime * 0.35)) - 0.5;
  float capR = 0.08 + 0.14 * rise;
  float cap = length((q - vec2(0.0, top)) * vec2(1.0, 2.1)) - capR - wob * 0.07 - wob2 * 0.025;
  float stemW = 0.03 + 0.035 * rise + 0.07 * (1.0 - smoothstep(0.0, 0.1, q.y));
  float stem = max(abs(q.x) - stemW - wob * 0.02, q.y - top);
  float skirt = length((q - vec2(0.0, top - capR * 0.42)) * vec2(1.0, 3.4)) - capR * 0.62 - wob2 * 0.02;
  float surge = length(q * vec2(1.0, 5.0)) - (0.08 + 0.42 * rise) - wob * 0.05;
  float dd = min(min(cap, stem), min(skirt, surge));
  float dens = (1.0 - smoothstep(-0.01, 0.01, dd)) * step(0.0, q.y);
  float core = 1.0 - smoothstep(-0.11, 0.0, cap);
  float heat = (1.0 - 0.75 * smoothstep(0.45, 1.0, m)) * (0.3 + 0.7 * core) + 0.35 * core * (0.5 + wob2);
  return vec2(dens, clamp(heat, 0.0, 1.0));
}
void main() {
  float k = uK; float t = uTime - uT0;
  vec2 p = vec2(vUv.x * 2.0, vUv.y);
  float sick = smoothstep(0.30, 0.62, k);
  float fl = smoothstep(0.665, 0.69, k) * (1.0 - smoothstep(0.69, 0.77, k));
  float war = smoothstep(0.69, 0.78, k);
  float dead = smoothstep(0.86, 0.95, k);
  float fire = war * (1.0 - dead);
  float alive = 1.0 - sick;
  // the pan: slow, and it stops when the film ends (k reaches 1 after 17 s); left running it carried the near hill out of the frame
  float dr = (min(t, 17.0) * 0.006 + k * 0.25) * 0.45;
  float H = 0.40;

  // ---- sky and sun ----
  float sy = clamp((p.y - H) / (1.0 - H), 0.0, 1.0);
  vec3 skyT = mix(vec3(0.10, 0.32, 0.76), vec3(0.40, 0.33, 0.22), sick);
  vec3 skyH = mix(vec3(0.72, 0.86, 0.96), vec3(0.74, 0.60, 0.36), sick);
  skyT = mix(skyT, vec3(0.05, 0.012, 0.01), war); skyH = mix(skyH, vec3(0.80, 0.22, 0.04), war);
  skyT = mix(skyT, vec3(0.10, 0.09, 0.09), dead); skyH = mix(skyH, vec3(0.30, 0.20, 0.17), dead);
  vec3 sky = mix(skyH, skyT, pow(sy, 0.65));
  vec2 sp = vec2(1.46 - dr * 0.05, 0.80);
  float sd = length(p - sp);
  float dull = max(sick, dead);
  vec3 sunC = mix(vec3(1.0, 0.97, 0.86), vec3(0.86, 0.62, 0.30), sick);
  sunC = mix(sunC, vec3(0.75, 0.13, 0.05), dead);
  float sunVis = 1.0 - fire * 0.95;
  vec2 dn = (p - sp) / max(sd, 0.001);
  float shafts = pow(noise2(dn * 9.0 + vec2(t * 0.03, 1.0)), 3.0) * exp(-sd * 3.0) * alive * 0.22;
  float sunGlow = exp(-sd * mix(6.0, 14.0, dull)) * (0.75 - 0.5 * sick) + exp(-sd * 1.7) * 0.22 * alive;
  sky += sunC * (sunGlow + shafts) * sunVis;
  sky = mix(sky, sunC * mix(1.25, 0.9, dull), (1.0 - smoothstep(0.042, 0.05, sd)) * sunVis);

  // ---- clouds: towering and sunlit, then flattened to smog, then smoke ----
  vec2 cp = vec2(p.x * mix(1.5, 0.9, sick) + dr * 2.0 + t * 0.012, (p.y - H) * mix(4.2, 9.0, sick));
  float cn = fbm2(cp);
  float cth = mix(0.5, 0.42, sick);
  float cd = smoothstep(cth, cth + mix(0.2, 0.35, sick), cn) * smoothstep(0.02, 0.2, sy);
  float cn2 = fbm2(cp + (sp - p) * vec2(0.14, 0.6) + vec2(0.0, 0.12));
  float lit = clamp(0.5 + (cn - cn2) * 4.5, 0.0, 1.0);
  vec3 cloudC = mix(vec3(0.50, 0.56, 0.70), vec3(1.0, 0.99, 0.95), lit);
  cloudC *= mix(1.0, 0.8, cd * cd * (1.0 - lit));
  cloudC += vec3(1.0, 0.93, 0.78) * cd * (1.0 - cd) * 1.6 * exp(-sd * 1.6) * alive;
  cloudC = mix(cloudC, vec3(1.0, 0.98, 0.9), exp(-sd * 4.5) * 0.85 * alive);
  cloudC = mix(cloudC, mix(vec3(0.36, 0.30, 0.22), vec3(0.66, 0.55, 0.36), lit), sick);
  cloudC = mix(cloudC, mix(vec3(0.6, 0.14, 0.03), vec3(0.03, 0.01, 0.01), smoothstep(0.0, 0.5, sy)), war);
  cloudC = mix(cloudC, vec3(0.2, 0.18, 0.18) * (0.8 + 0.4 * lit), dead);
  cd = mix(cd, max(cd, 0.75), max(war, sick * 0.3));
  vec3 col = mix(sky, cloudC, cd * 0.94);

  // ---- birds, while there are any ----
  float birds = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 bp = vec2(fract(t * 0.012 + 0.2) * 2.6 - 0.3 - abs(fi - 2.0) * 0.04, 0.72 + (fi - 2.0) * 0.018 + 0.006 * sin(t * 0.8 + fi));
    vec2 bq = (p - bp) / 0.02;
    float flap = 0.35 + 0.3 * sin(t * 6.0 + fi * 1.7);
    birds += (1.0 - smoothstep(0.05, 0.13, abs(bq.y - abs(bq.x) * flap))) * (1.0 - smoothstep(0.8, 1.0, abs(bq.x)));
  }
  col = mix(col, vec3(0.08, 0.09, 0.12), clamp(birds, 0.0, 1.0) * alive * 0.85);

  // ---- the detonations, behind the mountains ----
  float bx = dr * 0.25;
  vec2 gz = vec2(1.52 - bx, H - 0.03);
  vec2 m1 = shroom(p, gz, 1.15, clamp((k - 0.69) / 0.14, 0.0, 1.0));
  vec2 m2 = shroom(p, vec2(0.36 - bx, H - 0.02), 0.8, clamp((k - 0.735) / 0.14, 0.0, 1.0));
  vec2 m3 = shroom(p, vec2(0.74 - bx, H - 0.02), 0.55, clamp((k - 0.775) / 0.14, 0.0, 1.0));
  float md = max(m1.x, max(m2.x, m3.x));
  float mh = max(m1.x * m1.y, max(m2.x * m2.y, m3.x * m3.y));
  float roil = noise2(p * vec2(22.0, 26.0) + vec2(0.0, -t * 0.15)) * 0.6 + noise2(p * vec2(47.0, 55.0) + vec2(4.0, -t * 0.25)) * 0.4;
  vec3 smokeC = mix(vec3(0.20, 0.09, 0.06), vec3(0.72, 0.30, 0.10), clamp(1.0 - (p.y - H) * 2.0, 0.0, 1.0)) * (0.55 + 0.9 * roil);
  smokeC = mix(smokeC, vec3(0.17, 0.16, 0.16) * (0.7 + 0.6 * roil), dead);
  vec3 hotC = mix(vec3(1.0, 0.55, 0.12), vec3(1.0, 0.95, 0.7), mh);
  col = mix(col, mix(smokeC, hotC, mh), md * (1.0 - dead * 0.7));
  col += vec3(1.0, 0.36, 0.06) * exp(-abs(p.y - H) * 7.0) * fire * (0.55 + 0.15 * noise2(vec2(p.x * 3.0, t * 0.6)));

  // ---- three ridges receding into the air ----
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float rx = (p.x + dr * (0.25 + fi * 0.3)) * (1.6 + fi * 0.9) + fi * 17.0;
    float rr = ridge(rx, fi * 5.0);
    float hgt = H + 0.015 - fi * 0.025 + (0.33 - fi * 0.1) * rr * rr * 1.6;
    float below = hgt - p.y;
    // which way the face leans (sun is to the right), and creases running down it
    float lean = noise2(vec2(rx + 0.12, fi * 5.0)) - noise2(vec2(rx - 0.12, fi * 5.0));
    float crease = noise2(vec2(rx * 9.0 + below * 30.0, below * 14.0 + fi * 3.0)) * 0.6 + noise2(vec2(rx * 21.0 - below * 55.0, below * 30.0 + fi * 7.0)) * 0.4;
    float light = clamp(0.55 - lean * 2.6 + (crease - 0.5) * 0.9, 0.0, 1.0);
    vec3 rc = (fi < 0.5) ? vec3(0.34, 0.44, 0.62) : ((fi < 1.5) ? vec3(0.27, 0.42, 0.46) : vec3(0.17, 0.34, 0.24));
    rc *= 0.62 + 0.62 * light;
    float alt = p.y - H;
    // forest climbing to a treeline, bare rock above, snow lying in the creases of the highest peaks
    rc = mix(rc, vec3(0.10, 0.26, 0.15) * (0.7 + 0.5 * light), (1.0 - smoothstep(0.05 + crease * 0.05, 0.11 + crease * 0.05, alt)) * (0.35 + fi * 0.25) * alive);
    float snow = smoothstep(0.0, 0.03, alt - (0.19 - fi * 0.01) + (crease - 0.5) * 0.11) * alive;
    rc = mix(rc, vec3(0.80, 0.86, 0.96) * (0.72 + 0.4 * light), snow);
    rc = mix(rc, vec3(0.42, 0.36, 0.28) * (0.75 - fi * 0.12 + 0.3 * light), sick * 0.8);
    rc = mix(rc, skyH * vec3(0.86, 0.92, 1.0), (0.42 - fi * 0.14) * (1.0 - war));
    rc = mix(rc, vec3(0.10, 0.03, 0.02) + vec3(0.5, 0.14, 0.02) * exp(-below * 30.0), war);
    rc = mix(rc, vec3(0.24, 0.22, 0.21) * (0.7 - fi * 0.12 + 0.35 * light), dead);
    col = mix(col, rc, 1.0 - smoothstep(-0.0015, 0.0015, -below));
  }

  // ---- the far shore, and the city that grows along it ----
  float shore = 0.335;
  if (p.y < H + 0.01) {
    vec3 plain = mix(vec3(0.26, 0.47, 0.22) * (0.85 + 0.3 * noise2(vec2(p.x * 40.0, p.y * 300.0))), vec3(0.34, 0.31, 0.25), sick);
    plain = mix(plain, vec3(0.08, 0.03, 0.02), war);
    plain = mix(plain, vec3(0.22, 0.21, 0.20), dead);
    col = mix(col, mix(plain, skyH, 0.22 * (1.0 - war)), 1.0 - smoothstep(H - 0.036, H - 0.03, p.y));
  }
  // the far city: rows of skyline receding up the plain behind the waterfront, each smaller, denser and hazier
  for (int j = 3; j >= 1; j--) {
    float fj = float(j);
    float lx = (p.x + dr * (0.8 - fj * 0.15)) * 70.0 * (1.0 + fj * 0.6) + fj * 31.0;
    float lid = floor(lx); float lfx = fract(lx);
    float lh1 = hash2(vec2(lid, 13.0 + fj)); float lh2 = hash2(vec2(lid, 21.0 + fj));
    float lg = smoothstep(0.0, 1.0, sick * 1.5 - lh2 * 0.5 - fj * 0.1);
    float lcx = p.x - 1.0 + fj * 0.25;
    float lbh = (0.012 + 0.1 * lh1 * lh1) * pow(0.86, fj) * (0.6 + 0.9 * exp(-lcx * lcx * 2.5 / (1.0 + fj * 0.6))) * lg * (1.0 - dead * lh2 * 0.6);
    float lbase = shore + (H - 0.036 - shore) * fj * 0.3;
    float lin = (1.0 - smoothstep(lbase + lbh - 0.001, lbase + lbh + 0.001, p.y)) * step(shore - 0.004, p.y) * (1.0 - smoothstep(0.38, 0.44, abs(lfx - 0.5))) * step(0.002, lbh);
    float lrows = 260.0 + fj * 110.0;
    float lw = step(0.6, hash2(vec2(lid * 7.0 + floor(lfx * 4.0), floor((p.y - lbase) * lrows)))) * step(0.3, fract((p.y - lbase) * lrows)) * step(0.3, fract(lfx * 4.0));
    vec3 lc = mix(vec3(0.30, 0.31, 0.36) * (1.0 - fj * 0.05), skyH, 0.28 + fj * 0.17);
    lc = mix(lc, vec3(1.0, 0.82, 0.48), lw * smoothstep(0.35, 0.9, sick) * (1.0 - war) * (0.85 - fj * 0.18));
    lc = mix(lc, vec3(0.04, 0.012, 0.01) + vec3(1.0, 0.4, 0.05) * lw * step(0.6, lh1) * (0.7 - fj * 0.12), war);
    lc = mix(lc, mix(vec3(0.15, 0.14, 0.14), skyH, 0.15 * fj), dead);
    col = mix(col, lc, lin);
  }
  float cx = (p.x + dr * 0.8) * 70.0;
  float cid = floor(cx); float cfx = fract(cx);
  float ch1 = hash2(vec2(cid, 3.0)); float ch2 = hash2(vec2(cid, 9.0));
  float grow = smoothstep(0.0, 1.0, sick * 1.5 - ch2 * 0.5);
  float stack = step(0.9, ch2);
  float bh = (0.012 + 0.08 * ch1 * ch1) * (0.55 + 0.9 * exp(-(p.x - 1.0) * (p.x - 1.0) * 2.5)) * grow * (1.0 - dead * ch2 * 0.7);
  bh = mix(bh, bh * 0.6 + 0.05 * grow, stack);
  float bw = mix(0.38, 0.12, stack);
  // flame tongues standing on the skyline
  float ft1 = (0.012 + 0.06 * noise2(vec2(p.x * 55.0, t * 1.7)) * noise2(vec2(p.x * 9.0, 2.0 + t * 0.2))) * fire;
  float fy1 = (p.y - (shore + bh * 0.7)) / max(ft1, 0.0001);
  col += mix(vec3(1.0, 0.85, 0.35), vec3(1.0, 0.25, 0.03), clamp(fy1, 0.0, 1.0)) * (1.0 - smoothstep(0.2, 1.0, fy1)) * step(0.0, fy1) * fire * 0.9;
  float inB = (1.0 - smoothstep(shore + bh - 0.0015, shore + bh + 0.0015, p.y)) * step(shore - 0.004, p.y) * (1.0 - smoothstep(bw, bw + 0.05, abs(cfx - 0.5)));
  vec3 bc = mix(vec3(0.34, 0.35, 0.40), skyH, 0.35);
  float wl = step(0.55, hash2(vec2(cid * 7.0 + floor(cfx * 5.0), floor((p.y - shore) * 260.0)))) * step(0.25, fract((p.y - shore) * 260.0)) * step(0.3, fract(cfx * 5.0)) * (1.0 - stack);
  bc = mix(bc, vec3(1.0, 0.82, 0.48), wl * smoothstep(0.35, 0.9, sick) * (1.0 - war));
  bc = mix(bc, vec3(0.03, 0.01, 0.01) + vec3(1.0, 0.4, 0.05) * wl * step(0.6, ch1) * (0.6 + 0.4 * noise2(vec2(cid, t * 0.9))), war);
  bc = mix(bc, vec3(0.15, 0.14, 0.14), dead);
  col = mix(col, bc, inB);
  // smog standing over it
  col = mix(col, vec3(0.62, 0.50, 0.30), sick * (1.0 - war) * exp(-max(p.y - shore, 0.0) * 7.0) * step(shore, p.y) * (0.3 + 0.35 * noise2(vec2(p.x * 2.0 + t * 0.02, p.y * 9.0))));

  // ---- the water ----
  float sk1 = clamp((k - 0.69) / 0.1, 0.0, 1.0);
  float el = length((p - gz) * vec2(1.0, 3.2));
  float ring = exp(-abs(el - sk1 * 1.9) * 22.0) * (1.0 - sk1) * step(0.001, sk1);
  if (p.y < shore) {
    float wy = shore - p.y;
    vec3 water = mix(skyH, skyT, clamp(wy * 2.4, 0.0, 1.0)) * mix(0.82, 0.5, clamp(wy * 2.5, 0.0, 1.0));
    // the far shore and ridges lying soft on the surface
    float refl = exp(-wy * 13.0) * (0.55 + 0.25 * noise2(vec2(p.x * 5.0 + dr, 1.0)));
    water = mix(water, mix(vec3(0.16, 0.30, 0.30), vec3(0.25, 0.22, 0.17), sick), refl * 0.6 * (1.0 - war));
    // ripples: fine horizontal slivers, tightening toward the far shore
    float ry = wy * 1500.0 / (1.0 + wy * 13.0);
    float rp = noise2(vec2(p.x * 16.0 + t * 0.2 + noise2(vec2(ry * 0.3, 2.0)), ry - t * 0.6));
    float rp2 = noise2(vec2(p.x * 41.0 - t * 0.15, ry * 1.7 + t * 0.4));
    water += vec3(0.10, 0.11, 0.12) * (rp - 0.5) * alive;
    float path = exp(-abs(p.x - sp.x) / (0.035 + wy * 0.55));
    float glint = smoothstep(0.55, 0.78, rp) * (0.35 + 0.65 * smoothstep(0.45, 0.7, rp2));
    water += sunC * glint * path * 1.5 * sunVis * (1.0 - sick * 0.85) * (1.0 - dead);
    water += sunC * path * 0.12 * sunVis * alive;
    vec3 slick = vec3(0.06, 0.06, 0.05) + 0.05 * cos(vec3(0.0, 2.1, 4.2) + rp * 9.0 + p.x * 20.0);
    water = mix(water, slick, sick * 0.85 * (1.0 - war));
    water = mix(water, vec3(0.05, 0.015, 0.01) + vec3(0.85, 0.24, 0.03) * (0.15 + 0.6 * glint + 0.25 * rp) * exp(-wy * 5.0), war);
    float bedCrack = 1.0 - smoothstep(0.0, 0.035, abs(noise2(vec2(p.x * 9.0, wy * 30.0)) - 0.5));
    water = mix(water, vec3(0.17, 0.16, 0.155) * (0.8 + 0.4 * noise2(p * 40.0)) + vec3(0.9, 0.25, 0.05) * bedCrack * 0.3 * (0.7 + 0.3 * sin(t * 0.9 + p.x * 5.0)), dead);
    // the shock front crossing the water: a bright lip with a darkened trough behind it
    water = water * (1.0 - 0.5 * exp(-abs(el - sk1 * 1.9 + 0.05) * 16.0) * (1.0 - sk1) * step(0.001, sk1)) + vec3(1.0, 0.9, 0.78) * ring * 1.1;
    col = water;
  } else {
    col += vec3(1.0, 0.85, 0.7) * ring * step(p.y, H) * 0.8;
  }

  // ---- near slopes: forest, then stumps, then fire, then ash ----
  float nx = p.x + dr * 1.2;
  float hl = 0.34 * (1.0 - smoothstep(0.05, 0.95, nx));
  float hr = 0.30 * smoothstep(1.3, 2.3, nx);
  float nh = max(hl, hr) + 0.06 + 0.025 * noise2(vec2(nx * 4.0, 2.0));
  float cnz = noise2(vec2(nx * 6.0, 5.0)) * 0.5 - (1.45 - sick * 1.35);
  float coverTop = (1.0 - smoothstep(-0.15, 0.15, 1.0 + cnz)) * (1.0 - war);
  // a ragged line of crowns, with the odd taller tree standing clear of it
  float tcell = floor(nx * 70.0); float th = hash2(vec2(tcell, 1.0));
  float tf = abs(fract(nx * 70.0) - 0.5) * 2.0;
  float spike = (0.35 + 0.65 * th + 1.3 * step(0.86, th)) * (1.0 - tf * tf);
  float top = nh + 0.016 * spike * coverTop + 0.006 * noise2(vec2(nx * 31.0, 7.0)) * coverTop;
  // fire running over the bare slope (the city stays on the far shore)
  float ft2 = (0.015 + 0.075 * noise2(vec2(nx * 38.0, t * 1.5)) * noise2(vec2(nx * 6.0, 4.0 + t * 0.15))) * fire;
  float fy2 = (p.y - nh) / max(ft2, 0.0001);
  col += mix(vec3(1.0, 0.88, 0.4), vec3(1.0, 0.22, 0.02), clamp(fy2, 0.0, 1.0)) * (1.0 - smoothstep(0.2, 1.0, fy2)) * step(0.0, fy2) * fire;
  // where the near bank meets the water the edge is wet and soft, and the bank lies dark on the surface just beyond it
  float wetK = smoothstep(0.0, 0.03, shore - top) * (1.0 - dead);
  col *= 1.0 - 0.28 * wetK * exp(-max(p.y - top, 0.0) * 70.0) * step(top, p.y);
  float edgeW = mix(0.0015, 0.004, wetK);
  if (p.y < top + edgeW + 0.002) {
    float hm = 1.0 - smoothstep(top - edgeW, top + edgeW, p.y);
    float yn = p.y / max(nh, 0.01);
    float cover = (1.0 - smoothstep(-0.15, 0.15, yn + cnz)) * (1.0 - war);
    // canopy from a distance: rounded crowns, lit on the sun side, dark in the gaps between
    float pers = 1.0 + (nh - p.y) * 2.5;
    // only the height is foreshortened: dividing the drifting x by a factor that changes with height sheared the crowns
    // into streaks (worse the further the film had drifted) and made them swim against the slope's outline
    vec3 cl = clump(vec2(nx * 62.0, p.y * 96.0 / pers));
    float patchy = noise2(vec2(nx * 7.0, p.y * 11.0) + 4.0);
    float dome = 1.0 - smoothstep(0.15, 0.72, cl.x);
    float crownLit = clamp(0.5 + cl.y * 1.5, 0.0, 1.0);
    vec3 green = mix(vec3(0.05, 0.19, 0.07), vec3(0.16, 0.42, 0.11), cl.z * 0.6 + patchy * 0.5);
    green = mix(green * 0.34, green * (0.6 + 0.85 * crownLit), dome);
    green += vec3(0.30, 0.32, 0.06) * dome * smoothstep(0.62, 1.0, crownLit) * alive;
    green *= 0.72 + 0.4 * yn;
    green = mix(green, skyH * 0.6, 0.12 * yn * alive);
    green = mix(green, vec3(0.19, 0.21, 0.10) * (0.6 + 0.6 * dome * crownLit), sick * 0.55);
    vec3 bare = mix(vec3(0.34, 0.26, 0.17), vec3(0.23, 0.18, 0.12), patchy);
    bare *= 0.85 + 0.3 * noise2(vec2(nx * 60.0, p.y * 40.0));
    bare *= 1.0 - 0.5 * (1.0 - smoothstep(0.1, 0.2, cl.x)) * step(0.5, cl.z);
    vec3 hc = mix(bare, green, cover);
    hc = mix(hc, vec3(0.05, 0.02, 0.015), war);
    // embers: fine points that wink, a few lifting in streaks
    vec2 eg = vec2(nx * 150.0, p.y * 110.0 - t * 0.35);
    vec2 ei = floor(eg); vec2 ef = fract(eg) - 0.5;
    float eh = hash2(ei);
    float ember = (1.0 - smoothstep(0.03, 0.22, length(ef * vec2(1.0, 0.45)))) * step(0.9, eh) * (0.45 + 0.55 * sin(t * 5.0 + eh * 60.0));
    hc += vec3(1.0, 0.45, 0.08) * max(ember, 0.0) * fire * 1.2;
    hc += vec3(1.0, 0.45, 0.08) * fire * exp(-(top - p.y) * 60.0) * (0.6 + 0.4 * noise2(vec2(nx * 20.0, t * 0.8)));
    float crack = 1.0 - smoothstep(0.0, 0.035, abs(noise2(vec2(nx * 9.0, p.y * 26.0)) - 0.5));
    hc = mix(hc, vec3(0.2, 0.19, 0.18) * (0.7 + 0.5 * patchy) + vec3(0.9, 0.25, 0.05) * crack * 0.35 * (0.7 + 0.3 * sin(t * 0.9 + nx * 5.0)), dead);
    col = mix(col, hc, hm);
  }

  // ---- one great tree, close: forking limbs, a crown of overlapping clumps with sky in the gaps ----
  float tx = 0.5 - dr * 1.3;
  vec2 tb = vec2(tx, 0.0);
  float leafK = 1.0 - smoothstep(0.42, 0.62, k);
  float dTree = max(abs(p.x - tx - 0.012 * sin(p.y * 8.0)) - mix(0.027, 0.012, clamp(p.y / 0.36, 0.0, 1.0)), p.y - 0.36);
  dTree = min(dTree, abs(p.x - tx) - 0.027 - 0.04 * (1.0 - smoothstep(0.0, 0.05, p.y)));
  dTree = max(dTree, p.y - 0.36);
  vec2 f0 = tb + vec2(0.004, 0.35);
  vec2 lA = tb + vec2(-0.11, 0.52); vec2 lB = tb + vec2(0.02, 0.60); vec2 lC = tb + vec2(0.13, 0.50);
  dTree = min(dTree, segd(p, f0, lA) - mix(0.011, 0.004, clamp((p.y - 0.35) / 0.17, 0.0, 1.0)));
  dTree = min(dTree, segd(p, f0, lB) - mix(0.011, 0.004, clamp((p.y - 0.35) / 0.25, 0.0, 1.0)));
  dTree = min(dTree, segd(p, f0 + vec2(0.0, -0.03), lC) - mix(0.010, 0.004, clamp((p.y - 0.32) / 0.18, 0.0, 1.0)));
  dTree = min(dTree, segd(p, mix(f0, lA, 0.55), tb + vec2(-0.03, 0.56)) - 0.0035);
  dTree = min(dTree, segd(p, mix(f0, lA, 0.75), tb + vec2(-0.17, 0.50)) - 0.003);
  dTree = min(dTree, segd(p, mix(f0, lB, 0.6), tb + vec2(0.08, 0.63)) - 0.003);
  dTree = min(dTree, segd(p, mix(f0, lB, 0.75), tb + vec2(-0.05, 0.66)) - 0.003);
  dTree = min(dTree, segd(p, mix(f0, lC, 0.6), tb + vec2(0.17, 0.57)) - 0.003);
  dTree = min(dTree, segd(p, mix(f0, lC, 0.8), tb + vec2(0.19, 0.46)) - 0.0028);
  float bark = noise2(vec2(p.x * 160.0, p.y * 14.0));
  vec3 trunkC = mix(vec3(0.13, 0.09, 0.06), vec3(0.24, 0.18, 0.12), bark * smoothstep(-0.02, 0.02, p.x - tx)) * (1.0 - 0.4 * sick);
  trunkC = mix(trunkC, vec3(0.03, 0.025, 0.025), max(war, dead * 0.6));
  col = mix(col, trunkC, 1.0 - smoothstep(-0.0012, 0.0012, dTree));
  if (leafK > 0.0 && p.y > 0.3 && abs(p.x - tx) < 0.32) {
    float edgeN = (noise2(p * 13.0 + 2.0) - 0.5) * 0.05 + (noise2(p * 37.0) - 0.5) * 0.022;
    float dCr = length((p - lA) * vec2(1.0, 1.15)) - 0.085;
    dCr = min(dCr, length((p - lB) * vec2(1.0, 1.1)) - 0.105);
    dCr = min(dCr, length((p - lC) * vec2(1.0, 1.2)) - 0.085);
    dCr = min(dCr, length(p - (tb + vec2(-0.045, 0.64))) - 0.07);
    dCr = min(dCr, length(p - (tb + vec2(0.085, 0.62))) - 0.075);
    dCr = min(dCr, length((p - (tb + vec2(0.01, 0.50))) * vec2(0.8, 1.3)) - 0.075);
    dCr = min(dCr, length(p - (tb + vec2(-0.165, 0.49))) - 0.045);
    dCr = min(dCr, length(p - (tb + vec2(0.185, 0.47))) - 0.045);
    dCr -= edgeN;
    vec3 lf = clump(p * vec2(88.0, 100.0));
    vec3 lf2 = clump(p * vec2(27.0, 31.0) + 5.0);
    // leaf clusters thin toward the rim so sky shows through, and fall away a cluster at a time
    float rimGap = smoothstep(-0.04, 0.0, dCr) * 0.6 + 0.06;
    float keep = step(lf2.z * 0.55 + lf.z * 0.45, leafK * 1.2 - 0.1) * step(rimGap, 1.0 - lf2.x * 0.9 + (lf.z - 0.5) * 0.3);
    float crown = (1.0 - smoothstep(-0.003, 0.003, dCr)) * keep;
    float big = clamp(0.5 + lf2.y * 1.3, 0.0, 1.0);
    float sunSide = smoothstep(-0.16, 0.2, (p.x - tx) * 0.6 + (p.y - 0.55) * 0.8);
    float shadeL = 0.3 + 0.75 * big * (0.45 + 0.55 * sunSide);
    vec3 crownC = mix(vec3(0.03, 0.13, 0.05), vec3(0.15, 0.40, 0.10), lf.z * 0.5 + big * 0.5) * (0.45 + shadeL);
    crownC *= 0.75 + 0.5 * (1.0 - smoothstep(0.1, 0.6, lf.x)) * clamp(0.6 + lf.y * 1.5, 0.0, 1.0);
    crownC += vec3(0.34, 0.36, 0.08) * big * sunSide * smoothstep(0.55, 1.0, clamp(0.5 + lf.y * 1.5, 0.0, 1.0)) * alive;
    crownC = mix(crownC, vec3(0.34, 0.27, 0.09) * (0.5 + shadeL * 0.7), sick * 0.75);
    col = mix(col, crownC, crown);
  }

  // ---- ash coming down ----
  vec2 ag = vec2(p.x * 40.0 + sin(t * 0.3 + p.y * 3.0), p.y * 22.0 + t * 0.9);
  vec2 ai = floor(ag); vec2 af = fract(ag) - 0.5;
  float ash = (1.0 - smoothstep(0.03, 0.08, length(af - (vec2(hash2(ai + 3.0), hash2(ai + 7.0)) - 0.5) * 0.7))) * step(0.72, hash2(ai));
  col = mix(col, vec3(0.62, 0.58, 0.55), ash * war * 0.7 * (1.0 - dead * 0.5));

  // ---- the flash: once, with a soft ramp ----
  col = mix(col, vec3(1.0, 0.98, 0.93), clamp(fl * (0.75 + 0.6 * exp(-length(p - gz) * 1.5)), 0.0, 1.0));

  // ---- it is still a projection: a breath of grain, a soft vignette ----
  col += (hash2(p * 700.0 + fract(t) * 91.0) - 0.5) * 0.03;
  vec2 vq = vUv - 0.5;
  col *= 1.0 - 0.7 * dot(vq, vq);
  gl_FragColor = vec4(col, uFade);
}`;
function skyStars(n, radius) {
  const pos = new Float32Array(n * 3), size = new Float32Array(n), color = new Float32Array(n * 3), ph = new Float32Array(n);
  const bandN = V(0.6, 0.7, 0.2).normalize(), t1 = V(0, 0, 1).cross(bandN).normalize(), t2 = bandN.clone().cross(t1), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (i % 5 < 2) { const a = Math.random() * Math.PI * 2, off = (Math.random() + Math.random() + Math.random() - 1.5) * 0.18; v.copy(t1).multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a)).addScaledVector(bandN, off).normalize(); }
    else v.randomDirection();
    pos.set([v.x * radius, v.y * radius, v.z * radius], i * 3);
    const b = Math.random();
    size[i] = 1.1 + Math.pow(b, 7) * 5;
    const temp = Math.random(), br = 0.45 + 0.55 * Math.random();
    color.set(temp < 0.15 ? [1.0 * br, 0.75 * br, 0.55 * br] : temp < 0.4 ? [0.7 * br, 0.8 * br, 1.0 * br] : [br, br, br * 0.97], i * 3);
    ph[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  geo.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  return new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: SKYSTAR_V, fragmentShader: SKYSTAR_F, uniforms: { uTime: TIME, uPR: { value: E.renderer.getPixelRatio() } }, ...ADD }));
}
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

async function windowRoom() {
  E.surface = 'deck';
  E.scene.background = new THREE.Color(0x020308);
  shaderScene();
  const g = new THREE.Group(); E.scene.add(g);
  const WU = { uWinC: { value: new THREE.Color(0.7, 0.8, 0.9) }, uFilm: { value: 1 } };
  // the deck: polished floor, panelled walls and ceiling, beams and ribs
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(11, 8.7), sm(DECK_FLOOR, WU)); floor.rotation.x = -Math.PI / 2; floor.position.z = -0.35; g.add(floor);
  const deckM = sm(DECK, WU);
  const panel = (w, h, x, y, z, rx, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), deckM); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); g.add(m); };
  panel(8.7, 4.8, -5.5, 2.4, -0.35, 0, Math.PI / 2); panel(8.7, 4.8, 5.5, 2.4, -0.35, 0, -Math.PI / 2);
  panel(11, 4.8, 0, 2.4, 4.0, 0, Math.PI); panel(11, 8.7, 0, 4.8, -0.35, Math.PI / 2, 0);
  const front = new THREE.Shape(); front.moveTo(-5.5, -0.2); front.lineTo(5.5, -0.2); front.lineTo(5.5, 4.8); front.lineTo(-5.5, 4.8); front.lineTo(-5.5, -0.2);
  const holeP = new THREE.Path(roundedRect(8.2, 4.2, 0.35).getPoints(12).map((pt) => V2(pt.x, pt.y + 2.1)));
  front.holes.push(holeP);
  const fw = new THREE.Mesh(new THREE.ShapeGeometry(front, 12), deckM); fw.position.z = -4.62; g.add(fw);
  const frameS = roundedRect(8.8, 4.8, 0.5); frameS.holes.push(new THREE.Path(roundedRect(8.0, 4.0, 0.3).getPoints(12)));
  const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(frameS, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 12 }), std(0x2a2f38, { metalness: 0.8, roughness: 0.35 }));
  frame.position.set(0, 2.1, -4.78); g.add(frame);
  const lipS = roundedRect(8.06, 4.06, 0.31); lipS.holes.push(new THREE.Path(roundedRect(7.98, 3.98, 0.3).getPoints(12)));
  const lip = new THREE.Mesh(new THREE.ShapeGeometry(lipS, 12), basic(0x7fa8ff, { transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); lip.position.set(0, 2.1, -4.33); g.add(lip);
  const dummy = new THREE.Object3D(), ribM = std(0x1c2028, { metalness: 0.7, roughness: 0.45 });
  const ribs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 4.8, 0.18), ribM, 14);
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) { dummy.position.set(s * 5.44, 2.4, -3.6 + i * 1.2); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); ribs.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), dummy.matrix); }
  g.add(ribs);
  const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(11, 0.2, 0.18), ribM, 7);
  for (let i = 0; i < 7; i++) { dummy.position.set(0, 4.7, -3.6 + i * 1.2); dummy.updateMatrix(); beams.setMatrixAt(i, dummy.matrix); }
  g.add(beams);
  g.add(new THREE.HemisphereLight(0x8fa8ff, 0x20222c, 0.9));
  const winLight = new THREE.DirectionalLight(0x9fb8ff, 0.6); winLight.position.set(0, 3, -6); g.add(winLight);
  // beyond the glass: sky, stars, the Earth and its air
  const sky = new THREE.Mesh(new THREE.SphereGeometry(95, 32, 16), sm(SKY, {}, { side: THREE.BackSide, depthWrite: false })); g.add(sky);
  g.add(skyStars(3500, 90));
  const sunDir = { value: V(-1.0, 0.35, 0.25).normalize() };
  const ET = earthTex();
  const earth = new THREE.Mesh(new THREE.SphereGeometry(5.5, 128, 64), sm(EARTH, { uSun: sunDir, uDay: { value: ET.day }, uData: { value: ET.data } })); earth.position.set(0, -3.4, -13); earth.rotation.y = -2.27; g.add(earth);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(5.5 * 1.04, 96, 64), sm(ATMO, { uSun: sunDir }, { ...ADD, side: THREE.BackSide })); atmo.position.copy(earth.position); g.add(atmo);
  const air = new THREE.Mesh(new THREE.SphereGeometry(5.5 * 1.14, 64, 32), sm(AIRGLOW, { uSun: sunDir }, { ...ADD, side: THREE.BackSide })); air.position.copy(earth.position); g.add(air);
  // the Moon far off: about 30 Earth-widths away and a quarter its size, so a small bright disc (slightly enlarged to stay readable)
  const moon = new THREE.Mesh(new THREE.SphereGeometry(0.75, 48, 32), sm(MOON, { uSun: sunDir, uMap: { value: ET.moon } })); moon.position.set(14.1, 14.4, -86.6); moon.rotation.y = -1.74; g.add(moon);
  // low lucidity: look back and the Moon is somewhere else in the window, still high and clear of the Earth
  { const home = moon.position.clone(); unsteady(moon, (k) => {
    if (!k) { moon.position.copy(home); return; }
    const yaw = (Math.random() - 0.5) * 0.8, up = 0.14 + Math.random() * 0.24, d = home.length();
    moon.position.set(Math.sin(yaw) * Math.cos(up) * d, Math.sin(up) * d, -Math.cos(yaw) * Math.cos(up) * d);
  }); }
  // the glass itself, the air in front of it, and dust drifting through the light
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), sm(PANE, WU, ADD)); pane.position.set(0, 2.1, -4.46); pane.renderOrder = 4; g.add(pane);
  for (let i = 0; i < 5; i++) {
    const sl = new THREE.Mesh(new THREE.PlaneGeometry(10, 5.6), sm(SLICE, { ...WU, uK: { value: i / 4 } }, ADD));
    sl.position.set(0, 2.1 - i * 0.12, -4.2 + i * 0.75); sl.renderOrder = 5; g.add(sl);
  }
  g.add(motes(180, V(0, 2.0, -1.6), V(4.5, 1.9, 3.0), 0x9fb8ff, 0.7));
  on((dt) => { earth.rotation.y += dt * 0.02; });
  // the screen: the film is a shader on the window plane (FILM), driven by uK and faded out with uFade
  const FU = { uK: { value: 0 }, uFade: { value: 1 }, uT0: { value: TIME.value } };   // the film always starts from the same frame
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), sm(FILM, FU, { transparent: true })); screen.position.set(0, 2.1, -4.5); g.add(screen);
  let filmK = 0;
  // window light on the room follows the film (sky blue, ochre smog, the flash, firelight, ash grey), then the Earth
  on(() => {
    const s = sstep(0.3, 0.62, filmK), w = sstep(0.69, 0.78, filmK), d = sstep(0.86, 0.95, filmK), f = sstep(0.665, 0.69, filmK) * (1 - sstep(0.69, 0.77, filmK));
    WU.uWinC.value.setRGB(
      lerp(lerp(lerp(lerp(0.72, 0.62, s), 0.8, w), 0.3, d), 1.4, f),
      lerp(lerp(lerp(lerp(0.82, 0.52, s), 0.28, w), 0.24, d), 1.36, f),
      lerp(lerp(lerp(lerp(0.92, 0.34, s), 0.08, w), 0.22, d), 1.25, f));
    WU.uFilm.value = screen.parent ? FU.uFade.value : 0;
  });
  const mantis = makeMantis(); mantis.position.set(1.9, 0, -2.9); mantis.rotation.y = Math.PI; g.add(mantis);
  const ml = new THREE.PointLight(0xb89aff, 6, 6); ml.position.set(1.9, 2.2, -1.2); g.add(ml);
  on((dt, t) => idleMantis(mantis, dt, t));
  setView(0, 1.6, -0.9, 0, 0.1); E.limits = { yaw: 1.3, up: 0.6, down: 0.6 }; E.mode = 'look'; E.unsteady = true;
  const amb = A.drone(98, { g: 0.05 });
  await fade(0, 1.4, '#fff');
  say('A dark room and one bright wall. The tall one stands beside you.');
  await wait(1);
  let k = 0, birdT = 1, fireT = 0, boom2 = false, siren = null, city = null;
  const blast = (v) => { A.blast(v); E.shake = 0.02 * v; setTimeout(() => { E.shake = 0; }, 1600); };
  const off = on((dt) => {
    k = Math.min(1, k + dt / 17); filmK = FU.uK.value = k;
    if (k < 0.32) { birdT -= dt; if (birdT <= 0) { birdT = 0.5 + Math.random() * 1.6; const f0 = 2400 + Math.random() * 1800; A.tone(f0, 0.12, { g: 0.03, to: f0 * (1.1 + Math.random() * 0.4) }); if (Math.random() < 0.5) setTimeout(() => A.tone(f0 * 1.2, 0.1, { g: 0.025, to: f0 * 0.9 }), 140); } }
    if (k > 0.34 && !city) { city = A.drone(72, { type: 'sawtooth', g: 0.0001 }); city.set(72, 0.035, 5); }
    if (k > 0.685 && !siren) { siren = 1; if (city) city.stop(0.05); }
    if (k > 0.79 && !boom2) { boom2 = true; blast(0.9); }
    if (k > 0.74 && k < 0.93) { fireT -= dt; if (fireT <= 0) { fireT = 0.08 + Math.random() * 0.25; A.noise(0.05 + Math.random() * 0.08, { g: 0.05 + Math.random() * 0.05, f: 1200 + Math.random() * 2500, q: 3 }); } }
  });
  await wait(2.5); await say('The world, the way it was...');
  await until(() => k > 0.34); await say('Then what was done to it...');
  // the flash (k 0.69) is silent; each blast arrives a beat after its cloud, from far off, and then there is only wind
  await until(() => k > 0.75);
  blast(1);
  const wind = A.drone(260, { noise: true, g: 0.06, q: 0.6 });
  await say('...Then everything else.');
  note('screens');
  await until(() => k >= 1); off();
  await wait(2.2);   // hold the dead plain
  wind.stop(3.5);
  await tween(3.5, (q) => { FU.uFade.value = 1 - q; });
  discard(screen); note('window');
  await say('It was never a screen. It is a window, and that is the Earth.');
  E.mode = 'locked';
  await moveView(5.6, { pos: V(0, 1.6, -4.08), yaw: 0, pitch: -0.12, walk: 0.6 });   // slow steps up to the pane (z -4.46), close enough to reach it
  {
    // The right arm by two-bone IK (makePlayerBody ikRight): the palm goes flat onto the pane, comes straight back off it
    // (the elbow bends, the palm stays parallel to the glass), then the arm lowers out of sight. The body stands in the room,
    // not on the camera, so the shake of the view cannot push the hand through the glass.
    const me = makePlayerBody(), mu = me.userData, hr = mu.handRigR;
    mu.torso.children[0].visible = false; mu.legs.visible = false; mu.armL.visible = false;
    me.position.copy(E.camera.position); g.add(me);
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const tilt = 0.25, Fu = V(Math.sin(tilt), Math.cos(tilt), 0);   // fingers up and a little out
    // hand frame: palm toward -x, fingers -y, thumb -z. Palm onto the glass (-z), then tipped 0.1 rad so the heel of the hand
    // and the finger pads both meet the glass (the palm is thicker at the heel than the fingers are)
    const Qc = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, 1), Fu.clone().negate(), V(Math.cos(tilt), -Math.sin(tilt), 0)))
      .multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), -0.1));
    mu.relax(0.1); me.updateMatrixWorld(true);
    const W0 = mu.handR.getWorldPosition(V()).sub(me.position), Q0 = mu.handR.getWorldQuaternion(new THREE.Quaternion());
    const c0 = hr.curls.slice(), sp0 = hr.spread, op0 = hr.opp, tf0 = hr.tflex, cu = [0, 0, 0, 0];
    const pole = V(0.6, -1, 0.1), Wt = V(), Qt = new THREE.Quaternion(), v = V();
    const pose = (W, Q, f) => { mu.ikRight(W, Q, pole); for (let i = 0; i < 4; i++) cu[i] = lerp(c0[i], 0.03, f); hr.set(cu, lerp(sp0, 0.35, f), lerp(op0, -0.5, f), lerp(tf0, 0, f)); };
    // how far the flat hand reaches ahead of the wrist pivot, from the skinned vertices, so the palm lands flush
    pose(V(0.14, -0.13, -0.3), Qc, 1); me.updateMatrixWorld(true);
    let front = 0; const hm = hr.mesh, nv = hm.geometry.attributes.position.count;
    for (let i = 0; i < nv; i++) { hm.getVertexPosition(i, v); hm.localToWorld(v); front = Math.max(front, (me.position.z - 0.3) - v.z); }
    const Wc = V(0.14, -0.13, -4.46 - me.position.z + front + 0.002);   // wrist with the palm on the pane
    const Wa = Wc.clone().setZ(Wc.z + 0.07), Wb = Wc.clone().setZ(Wc.z + 0.13);
    const C1 = V(0.24, -0.5, -0.18), C2 = V(0.22, -0.4, -0.08);
    const bez = (a, c, b, t, out) => out.copy(a).multiplyScalar((1 - t) * (1 - t)).addScaledVector(c, 2 * t * (1 - t)).addScaledVector(b, t * t);
    pose(W0, Q0, 0);
    // up from the side to a hand's breadth off the glass, turning the palm to face it; then straight in
    await tween(1.8, (q) => {
      if (q < 0.7) bez(W0, C1, Wa, sm(0, 0.7, q), Wt); else Wt.lerpVectors(Wa, Wc, sm(0.7, 1, q));
      pose(Wt, Qt.slerpQuaternions(Q0, Qc, sm(0.05, 0.5, q)), sm(0.15, 0.55, q));
    }, (q) => q);
    A.noise(0.08, { g: 0.12, f: 240, q: 1, type: 'lowpass' });
    await say('You put your hand flat on the glass. It is cold. Everything you have ever known is on the other side of it.');
    // straight back off the glass, palm still parallel to it
    await tween(0.8, (q) => { pose(Wt.lerpVectors(Wc, Wb, sm(0, 1, q)), Qc, 1 - 0.3 * sm(0.6, 1, q)); }, (q) => q);
    // then down and out of sight
    await tween(1.4, (q) => { pose(bez(Wb, C2, W0, sm(0, 1, q), Wt), Qt.slerpQuaternions(Qc, Q0, sm(0.1, 0.9, q)), 0.7 * (1 - sm(0, 0.8, q))); }, (q) => q);
    discard(me);
  }
  E.base.yaw = 0; E.base.pitch = -0.12; E.limits = { yaw: 1.3, up: 0.7, down: 0.5 }; E.mode = 'look';
  A.clicks(6);
  await tween(1.2, (q) => { mantis.rotation.y = lerp(Math.PI, Math.PI * 0.62, q); });
  await say("I know this is hard. I'm sorry.", 'them'); note('sorry');
  const i = await choose(["It's alive. I can feel it.", 'Why are you showing me this?', 'You could be showing me anything.']);
  if (i === 0) { G.trust += 1; G.lucidity += 0.04; await say('Yes.', 'them'); }
  else if (i === 1) await say('So that you remember.', 'them');
  else { G.trust -= 1; G.lucidity -= 0.04; mantis.userData.tilt = 0.6; await say('They tilt their head. They do not answer.'); }
  amb.stop(1);
  await fade(1, 1, '#fff');
}

// ---------- the hall of containers ----------
const VZ = (i) => -1.5 - i * 2.3; // vessel rows at x = +-1.75
const GLASS = `
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = abs(dot(n, v));
  float fres = pow(1.0 - ndv, 3.0);
  float streak = smoothstep(0.08, 0.0, abs(dot(n, normalize(cross(v, vec3(0.0, 1.0, 0.0)))) - 0.55));
  vec3 col = vec3(0.4, 1.0, 0.85) * fres * 0.55 + vec3(0.8, 1.0, 0.95) * streak * 0.2;
  col += vec3(0.3, 1.0, 0.8) * (smoothstep(0.05, 0.0, vUv.y) + smoothstep(0.95, 1.0, vUv.y)) * 0.3;
  gl_FragColor = vec4(col * (1.0 - fogk()), 1.0);
}`;
const FLUID = `
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = abs(dot(n, v));
  float c1 = noise3(vec3(vWorld.x * 6.0, vWorld.y * 3.0 - uTime * 0.35, vWorld.z * 6.0));
  float c2 = noise3(vec3(vWorld.x * 13.0, vWorld.y * 7.0 - uTime * 0.8, vWorld.z * 13.0));
  float caus = pow(1.0 - abs(c1 - c2), 6.0);
  float bub = pow(noise3(vec3(vWorld.x * 30.0, vWorld.y * 12.0 - uTime * 1.6, vWorld.z * 30.0)), 12.0) * 4.0;
  vec3 col = mix(vec3(0.02, 0.22, 0.2), vec3(0.25, 0.95, 0.78), (1.0 - vUv.y) * 0.55 + ndv * 0.35);
  col += vec3(0.4, 1.0, 0.85) * caus * 0.25 + vec3(0.8, 1.0, 0.95) * bub;
  // a lit core seen through the thickest part, bent bands like refraction, a bright meniscus
  col += vec3(0.3, 1.0, 0.8) * pow(ndv, 4.0) * 0.3 * (1.25 - vUv.y);
  col *= 0.88 + 0.24 * (0.5 + 0.5 * sin(vWorld.y * 10.0 + (n.x + n.z) * 6.0 + uTime * 0.5));
  col += vec3(0.6, 1.0, 0.9) * smoothstep(0.03, 0.0, abs(vUv.y - 0.975)) * 0.6;
  col *= 0.75 + 0.25 * sin(uTime * 0.7 + vWorld.z * 0.8);
  gl_FragColor = vec4(fogit(col), 0.45 + 0.35 * (1.0 - ndv));
}`;
// low mist over the hall floor, brighter where it pools round each vessel's foot
const GROUND_HAZE = `
uniform float uAmt;
void main() {
  vec2 p = vWorld.xz;
  float n = noise2(p * 0.8 + vec2(uTime * 0.05, -uTime * 0.08)) * 0.6 + noise2(p * 2.3 - vec2(uTime * 0.11, 0.0)) * 0.4;
  float ii = clamp(floor((-1.5 - p.y) / 2.3 + 0.5), 0.0, 8.0);
  float dz = -1.5 - ii * 2.3 - p.y; float dx = abs(p.x) - 1.75;
  float lit = 0.4 + 1.3 * exp(-(dx * dx + dz * dz) * 1.2);
  float a = n * n * smoothstep(0.4, 2.0, vDepth) * lit * uAmt * (1.0 - fogk());
  gl_FragColor = vec4(vec3(0.25, 0.9, 0.75) * a, 1.0);
}`;
const SEED = `
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - abs(dot(n, v)), 2.5);
  gl_FragColor = vec4(fogit(vec3(0.01, 0.025, 0.025) + vec3(0.15, 0.6, 0.5) * rim * 0.6), 1.0);
}`;
const BOB = `
  w.y += sin(uTime * 0.6 + m[3][2] * 1.7 + m[3][0]) * 0.035;
  w.x += sin(uTime * 0.37 + m[3][2]) * 0.01;`;
const HALL_WALL = `
void main() {
  vec3 n = normalize(vNormal);
  float side = step(abs(n.y), 0.5);
  float rib = abs(fract((vWorld.z + 1.5) / 2.3 + 0.5) - 0.5) * 2.3;
  vec3 col = vec3(0.02, 0.04, 0.045) * (0.8 + 0.4 * noise2(vec2(vWorld.z * 3.0, vWorld.y * 3.0 + vWorld.x * 3.0)));
  col += vec3(0.03, 0.2, 0.17) * exp(-rib * rib * 4.0) * smoothstep(3.6, 1.0, vWorld.y) * side;
  col *= 1.0 - 0.6 * smoothstep(0.08, 0.04, abs(rib - 1.15));
  float line = smoothstep(0.015, 0.0, abs(vWorld.y - 0.6)) + smoothstep(0.015, 0.0, abs(vWorld.y - 2.9));
  col += vec3(0.1, 0.5, 0.4) * line * 0.3 * side;
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
const HALL_FLOOR = `
float vesselAt(float hz, float hy) {
  float iz = (-1.5 - hz) / 2.3; float ii = floor(iz + 0.5); float dz = (iz - ii) * 2.3;
  float inr = step(-0.5, ii) * step(ii, 8.5);
  return smoothstep(0.42, 0.22, abs(dz)) * smoothstep(0.25, 0.45, hy) * smoothstep(2.05, 1.85, hy) * inr;
}
void main() {
  vec2 p = vWorld.xz;
  vec3 v = normalize(vWorld - cameraPosition);
  vec2 jit = (vec2(noise2(p * 6.0), noise2(p * 6.0 + 17.0)) - 0.5) * 0.06;
  vec3 rd = normalize(vec3(v.x + jit.x, -v.y, v.z + jit.y));
  float rx = abs(rd.x) < 0.0001 ? 0.0001 : rd.x;
  float t1 = (1.75 - p.x) / rx;
  float t2 = (-1.75 - p.x) / rx;
  float refl = 0.0;
  if (t1 > 0.0) refl += vesselAt(p.y + rd.z * t1, rd.y * t1) * exp(-t1 * 0.35);
  if (t2 > 0.0) refl += vesselAt(p.y + rd.z * t2, rd.y * t2) * exp(-t2 * 0.35);
  float fres = 0.25 + 0.75 * pow(1.0 - abs(v.y), 3.0);
  vec3 col = vec3(0.012, 0.022, 0.024);
  vec2 cell = vec2(0.9, 1.15);
  vec2 e = (0.5 - abs(fract(p / cell) - 0.5)) * cell;
  col *= 1.0 - 0.5 * smoothstep(0.012, 0.004, min(e.x, e.y));
  col += vec3(0.15, 0.75, 0.6) * refl * fres * 0.55;
  float ii = clamp(floor((-1.5 - p.y) / 2.3 + 0.5), 0.0, 8.0);
  float dz = -1.5 - ii * 2.3 - p.y;
  float dx = abs(p.x) - 1.75;
  col += vec3(0.05, 0.3, 0.25) * exp(-(dx * dx + dz * dz) * 3.0) * 0.6;
  col += vec3(0.1, 0.6, 0.5) * smoothstep(0.02, 0.0, abs(abs(p.x) - 1.12)) * (0.25 + 0.2 * sin(p.y * 2.0 + uTime * 1.5));
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
const BUB_V = `
attribute vec4 aB;
uniform float uTime; uniform float uScale; uniform float uFogN; uniform float uFogF;
varying float vF;
void main() {
  float y = 0.35 + mod(aB.z * 1.55 + uTime * aB.w, 1.55);
  vec3 p = vec3(aB.x + position.x + sin(uTime * 3.0 + aB.z * 20.0) * 0.012, y, aB.y + position.z);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vF = (1.0 - smoothstep(uFogN, uFogF, d)) * smoothstep(0.35, 0.45, y) * (1.0 - smoothstep(1.75, 1.9, y));
  gl_PointSize = position.y * uScale / max(d, 0.1);
  gl_Position = projectionMatrix * mv;
}`;
const BUB_F = `
varying float vF;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r = length(p) * 2.0;
  float rim = smoothstep(0.55, 0.85, r) * (1.0 - smoothstep(0.88, 1.0, r));
  float hl = 1.0 - smoothstep(0.0, 0.25, length(p - vec2(-0.15, -0.15)) * 2.0);
  float a = (rim * 0.8 + hl * 0.9 + 0.08 * step(r, 1.0)) * vF;
  gl_FragColor = vec4(vec3(0.7, 1.0, 0.92) * a, 1.0);
}`;
// the plate's marks; seed 7 is how it reads, other seeds are how it reads at low lucidity (redrawn into the same canvas)
const plateTex = () => canvasTex(512, 128, (g) => drawPlate(g, 7));
function drawPlate(g, seed) {
  {
    g.shadowBlur = 0; g.fillStyle = '#071311'; g.fillRect(0, 0, 512, 128);
    g.strokeStyle = '#2d5f54'; g.lineWidth = 4; g.strokeRect(6, 6, 500, 116);
    g.strokeStyle = '#bff5d8'; g.shadowColor = '#7fffd0'; g.shadowBlur = 12; g.lineWidth = 5; g.lineCap = 'round';
    let s = seed; const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    for (let x = 44; x < 480; x += 48) {
      g.beginPath();
      const k = Math.floor(r() * 5), y = 64;
      if (k === 0) g.arc(x, y, 16, 0, 2 + r() * 4);
      else if (k === 1) { g.moveTo(x - 16, y - 18); g.lineTo(x + 16, y - 18); g.lineTo(x, y + 18); g.closePath(); }
      else if (k === 2) { g.moveTo(x - 14, y + 18); g.lineTo(x, y - 18); g.lineTo(x + 14, y + 18); g.moveTo(x, y - 18); g.lineTo(x, y + 20); }
      else if (k === 3) { g.moveTo(x - 18, y); g.bezierCurveTo(x - 6, y - 26, x + 6, y + 26, x + 18, y); }
      else { g.moveTo(x - 10, y - 18); g.lineTo(x - 10, y + 18); g.moveTo(x + 2, y - 18); g.lineTo(x + 2, y + 18); g.moveTo(x + 14, y - 8); g.lineTo(x + 14, y + 8); }
      g.stroke();
    }
  }
}

async function containers() {
  E.scene.background = new THREE.Color(0x020807);
  E.scene.fog = new THREE.Fog(0x020807, 3, 20);
  shaderScene();
  const g = new THREE.Group(); E.scene.add(g);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(5, 30), sm(HALL_FLOOR)); floor.rotation.x = -Math.PI / 2; floor.position.z = -11; g.add(floor);
  const wallM = sm(HALL_WALL);
  for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(30, 3.8), wallM); w.position.set(s * 2.5, 1.9, -11); w.rotation.y = -s * Math.PI / 2; g.add(w); }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(5, 30), wallM); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 3.8, -11); g.add(ceil);
  g.add(new THREE.HemisphereLight(0x7fffd0, 0x06100e, 0.5));
  for (const z of [-6, -15]) { const l = new THREE.PointLight(0x4fffc8, 5, 9, 1.6); l.position.set(0, 2.6, z); g.add(l); }
  // the vessels, instanced: base, fluid, the dark thing inside, glass, cap, lit rings, pipes
  const N = 18, P = [];
  for (let i = 0; i < 9; i++) for (const s of [-1, 1]) P.push([s * 1.75, VZ(i), i, s]);
  const dummy = new THREE.Object3D();
  const inst = (geo, mat, f, count = N) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    for (let j = 0; j < count; j++) { dummy.position.set(0, 0, 0); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); f(j); dummy.updateMatrix(); m.setMatrixAt(j, dummy.matrix); }
    g.add(m); return m;
  };
  const capM = std(0x39454a, { metalness: 0.9, roughness: 0.35 });
  inst(lathe([[0, 0], [0.47, 0], [0.47, 0.05], [0.43, 0.08], [0.43, 0.24], [0.39, 0.3], [0, 0.3]], 40), capM, (j) => dummy.position.set(P[j][0], 0, P[j][1]));
  inst(lathe([[0, 0], [0.4, 0], [0.41, 0.02], [0.41, 0.12], [0.37, 0.16], [0.3, 0.2], [0.12, 0.22], [0.1, 0.3], [0, 0.3]], 40), capM, (j) => dummy.position.set(P[j][0], 1.99, P[j][1]));
  const seedG = lathe([[0, -0.19], [0.08, -0.17], [0.11, -0.08], [0.1, 0.03], [0.06, 0.09], [0.075, 0.13], [0.07, 0.18], [0.03, 0.21], [0, 0.215]], 24);
  const seedPose = (j, h, y) => { dummy.position.set(P[j][0], h, P[j][1]); dummy.rotation.set(0, y, 0.25 * P[j][3]); dummy.scale.set(1, 1, 1); };
  const seedI = inst(seedG, sm(SEED, {}, { displace: BOB }), (j) => seedPose(j, 1.0 + (P[j][2] % 3) * 0.08, j * 1.3));
  // low lucidity: look back and the dark form in a vessel hangs at another height, leaning another way. Heights stay
  // in the range they already use (1.00-1.16), so the cord from the cap always meets it.
  for (let j = 0; j < N; j++) unsteady(seedI, (k) => {
    if (k) seedPose(j, 1.0 + Math.random() * 0.16, Math.random() * Math.PI * 2); else seedPose(j, 1.0 + (P[j][2] % 3) * 0.08, j * 1.3);
    dummy.updateMatrix(); seedI.setMatrixAt(j, dummy.matrix); seedI.instanceMatrix.needsUpdate = true; seedI.boundingSphere = null;   // bounds recomputed: never stale
  }, { r: 0.42, at: V(P[j][0], 1.15, P[j][1]) });
  const fluid = inst(new THREE.CylinderGeometry(0.335, 0.335, 1.62, 40, 1, true), sm(FLUID, {}, { transparent: true, depthWrite: false }), (j) => dummy.position.set(P[j][0], 1.15, P[j][1]));
  const glassI = inst(new THREE.CylinderGeometry(0.36, 0.36, 1.7, 40, 1, true), sm(GLASS, {}, ADD), (j) => dummy.position.set(P[j][0], 1.15, P[j][1]));
  fluid.renderOrder = 1; glassI.renderOrder = 3;
  // light hanging round each vessel; a fine cord from each dark form up to its cap
  const haloI = inst(new THREE.CylinderGeometry(0.62, 0.62, 2.0, 32, 1, true), sm(SHAFT, { uColor: { value: dcol(0x5fffd0) }, uAmt: { value: 0.07 } }, { ...ADD, side: THREE.DoubleSide }), (j) => dummy.position.set(P[j][0], 1.15, P[j][1]));
  haloI.renderOrder = 4;
  inst(new THREE.CylinderGeometry(0.005, 0.005, 0.72, 5), sm(SEED), (j) => dummy.position.set(P[j][0], 1.64, P[j][1]));
  for (const [y, amt] of [[0.14, 0.5], [0.42, 0.25]]) {
    const mist = new THREE.Mesh(new THREE.PlaneGeometry(5, 30), sm(GROUND_HAZE, { uAmt: { value: amt } }, { ...ADD, side: THREE.DoubleSide }));
    mist.rotation.x = -Math.PI / 2; mist.position.set(0, y, -11); mist.renderOrder = 5; g.add(mist);
  }
  g.add(motes(300, V(0, 1.8, -9), V(2.2, 1.7, 9.5), 0x7fffd0, 0.8));
  const ringM = basic(0x6fffd8);
  const torus = new THREE.TorusGeometry(0.372, 0.016, 8, 48); torus.rotateX(Math.PI / 2);
  inst(torus, ringM, (j) => dummy.position.set(P[j >> 1][0], j % 2 ? 1.96 : 0.33, P[j >> 1][1]), N * 2);
  const curve = new THREE.CatmullRomCurve3([V(0, 0, 0), V(0, 0.35, 0), V(0.1, 0.7, 0), V(0.5, 0.95, 0)]);
  const pipeR = new THREE.TubeGeometry(curve, 20, 0.035, 8), pipeL = pipeR.clone().scale(-1, 1, 1);
  const pipeM = std(0x4a565c, { metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide });
  for (const [geo, s] of [[pipeR, 1], [pipeL, -1]]) inst(geo, pipeM, (j) => dummy.position.set(s * 1.75, 2.28, VZ(j)), 9);
  const condG = new THREE.CylinderGeometry(0.09, 0.09, 26, 12); condG.rotateX(Math.PI / 2);
  const cableG = new THREE.CylinderGeometry(0.035, 0.035, 26, 8); cableG.rotateX(Math.PI / 2);
  for (const s of [-1, 1]) {
    const c1 = new THREE.Mesh(condG, pipeM); c1.position.set(s * 2.25, 3.25, -10); g.add(c1);
    const c2 = new THREE.Mesh(cableG, pipeM); c2.position.set(s * 2.3, 3.0, -10); g.add(c2);
    const c3 = new THREE.Mesh(cableG, pipeM); c3.position.set(s * 2.2, 0.04, -10); g.add(c3);
  }
  // bubbles rising in every vessel, animated on the GPU
  const NB = N * 16, bpos = new Float32Array(NB * 3), bb = new Float32Array(NB * 4);
  for (let j = 0; j < NB; j++) {
    const v = P[j % N], a = Math.random() * Math.PI * 2, r = Math.random() * 0.28;
    bpos.set([Math.cos(a) * r, 0.012 + Math.random() * 0.03, Math.sin(a) * r], j * 3);
    bb.set([v[0], v[1], Math.random(), 0.12 + Math.random() * 0.3], j * 4);
  }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(bpos, 3)); bg.setAttribute('aB', new THREE.BufferAttribute(bb, 4));
  const bubbles = new THREE.Points(bg, new THREE.ShaderMaterial({ vertexShader: BUB_V, fragmentShader: BUB_F, uniforms: { uTime: TIME, uScale: { value: pxScale() }, ...FOGU }, ...ADD }));
  bubbles.frustumCulled = false; bubbles.renderOrder = 2; g.add(bubbles);
  on((dt, t) => { const k = 0.75 + 0.25 * Math.sin(t * 1.4); ringM.color.setRGB(0.16 * k, 1.0 * k, 0.7 * k); });
  // the plate over the hall, hung from the ceiling
  const pTex = plateTex();
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), basic(0xffffff, { map: pTex })); plate.position.set(0, 2.5, -1.4); g.add(plate);
  // low lucidity: look back and the plate says something else
  unsteady(plate, (k, n) => { drawPlate(pTex.image.getContext('2d'), k ? 7 + n * 1013 : 7); pTex.needsUpdate = true; });
  for (const x of [-0.7, 0.7]) { const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.1, 6), pipeM); rod.position.set(x, 3.27, -1.42); g.add(rod); }
  const child = makeHuman(KNOWN_KID.scale, KNOWN_KID.color, KNOWN_KID.hair); child.position.set(0, 0, -19.5); g.add(child);
  const grey = makeGrey(); grey.position.set(0.8, 0, -19.9); g.add(grey);
  const toy = new THREE.Mesh(new THREE.TetrahedronGeometry(0.09), sm(JEWEL, { uColor: { value: dcol(0xffd27a) }, uGlow: { value: 1.2 } })); toy.position.set(0, 0.72, -19.15); g.add(toy);
  const tl = new THREE.PointLight(0xffc24a, 1.5, 4); toy.add(tl);
  const tHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffc24a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 })); tHalo.scale.setScalar(0.5); toy.add(tHalo);
  on((dt) => { toy.rotation.y += dt * 1.2; toy.rotation.x += dt * 0.7; });
  let giftHeld = false; const gift = A.aura(293.66); let giftNear = 0;
  on(() => { giftNear = giftHeld ? 1 : Math.max(0, 1 - E.camera.position.distanceTo(toy.position) / 14); gift.set(giftNear * giftNear); });
  // the child stands with both arms out, the thing held up in cupped hands; offer 1 = held out, 0 = arms down
  const cu = child.userData, toyHeld = toy.position.clone();
  // held in the cupped hands: the arms posed held out, the toy 5.5 cm out in front of the middle of the two hands (it was
  // a fixed point, made for a taller child)
  {
    cu.armL.rotation.set(-1.05, 0, 0.09); cu.armR.rotation.set(-1.05, 0, -0.09); cu.foreL.rotation.x = cu.foreR.rotation.x = -0.48;
    child.updateMatrixWorld(true);
    const hc = (w) => { const m = w.children.find((c) => c.isMesh); m.geometry.computeBoundingBox(); return m.localToWorld(m.geometry.boundingBox.getCenter(V(0, 0, 0))); };
    toyHeld.copy(hc(cu.wristL)).add(hc(cu.wristR)).multiplyScalar(0.5).add(V(0, 0, 0.055));
    toy.position.copy(toyHeld);
  }
  let offer = 1, toyFollows = true;
  const childGaze = humanGaze(child), CHILD_REST = { y: 0, p: 0.1 };
  if (window.UAP) window.UAP.containers = { child, childGaze };
  on((dt, t) => {
    const b = Math.sin(t * 1.1) * 0.02;
    cu.armL.rotation.set(-1.05 * offer + b, 0, 0.17 * offer - 0.08); cu.armR.rotation.set(-1.05 * offer + b, 0, -0.17 * offer + 0.08);   // (a positive z on the left arm swings it in: held out, the arms just in from straight ahead; let down, a little out from the sides, clear of the body)
    cu.foreL.rotation.x = cu.foreR.rotation.x = -0.08 - 0.4 * offer;
    // eyes on you the whole time, the head turned to you (humanGaze: aimed at the camera itself)
    childGaze.update(dt, E.camera.position, 0.9, CHILD_REST); cu.chest.scale.z = 1 + Math.sin(t * 1.6) * 0.018;
    if (toyFollows) toy.position.set(toyHeld.x, lerp(0.4, toyHeld.y, offer) + b * 0.3, lerp(toyHeld.z - 0.2, toyHeld.z, offer));
    aimGrey(grey, E.camera.position, 0.8);
  });
  setView(0, 1.6, 1, 0, 0); E.mode = 'locked'; E.unsteady = true; E.heart = true; E.surface = 'hall';
  E.bounds = (x, z) => Math.abs(x) < 1.15 && z < 1.6 && z > -18.2;
  const amb = A.drone(55, { type: 'triangle', g: 0.06 }); const bub = A.drone(700, { noise: true, g: 0.015, q: 6 });
  // two pale tones a hair apart, beating slowly; and now and then something odd from somewhere down the hall
  const padA = A.drone(110, { g: 0.02, fade: 6 }), padB = A.drone(116.5, { g: 0.015, fade: 9 });
  let oddT = 2.5;
  on((dt) => {
    oddT -= dt; if (oddT > 0) return;
    oddT = 1.4 + Math.random() * 2.2; const r = Math.random();   // an odd sound every 1.4 to 3.6 s
    if (r < 0.36) A.noise(2.8, { g: 0.05, f: 120 + Math.random() * 120, q: 9, to: 55 });                                      // a far-off groan of metal
    else if (r < 0.72) { const f = 196 * Math.pow(2, Math.floor(Math.random() * 6) / 12); A.tone(f, 2, { g: 0.018 }); setTimeout(() => A.tone(f * 1.059, 2.2, { g: 0.014 }), 700); }   // two notes a semitone apart
    else A.noise(1.6, { g: 0.025, f: 2600, q: 12, to: 5200 });                                                                   // a thin rising whistle
  });
  await fade(0, 1.4, '#fff');
  say('Rows of them, lit from inside. Something small in each one.');
  await wait(0.6);
  await moveView(1.6, { yaw: 0.55, pitch: -0.12 });
  await wait(0.5);
  await moveView(2.0, { yaw: -0.55, pitch: -0.08 });
  await wait(0.4);
  say('A plate above the hall. For an instant the marks make a word you can read: CONTAINERS.'); note('containers');
  await lookToward(plate.position, 1.5);
  await wait(2.4);
  await moveView(1.0, { yaw: 0, pitch: 0 });
  E.base.yaw = 0; E.base.pitch = 0; E.mode = 'walk';
  hint('W A S D to walk, SHIFT to run.');
  await until(() => E.camera.position.z < -17.5);
  hint(''); E.mode = 'look';
  const aim = aimAt(V(0, 0.78, -19.3)); E.mode = 'locked';
  await moveView(0.9, aim);       // your eyes drop to the child and what it is holding
  E.base.yaw = aim.yaw; E.base.pitch = aim.pitch; E.limits = { yaw: 0.5, up: 0.45, down: 0.3 }; E.mode = 'look';
  await say('At the far end a child, too thin, too still, holding something out to you.');
  await say('It is yours while you are here.', 'them');
  const i = await choose(['Take it.', 'Leave it.']);
  if (i === 0) {
    G.toy = true; G.trust += 1;
    // your own hand comes up, open, and the thing crosses into it
    const me = makePlayerBody(), mu = me.userData;
    mu.torso.children[0].visible = false; mu.legs.visible = false; mu.armL.visible = false; E.camera.add(me);
    // you crouch to the child's height, close enough to reach; the open palm rises to just under the thing in its hands
    E.mode = 'locked';
    const crouch = V(0, 1.06, -18.82), look = V(0, 0.86, -19.2).sub(crouch).normalize();
    await moveView(1.5, { pos: crouch, yaw: Math.atan2(-look.x, -look.z), pitch: Math.asin(look.y) });
    const reach = palmReach(me), hand = new THREE.Vector3(), p0 = new THREE.Vector3();
    toyFollows = false; p0.copy(toy.position);
    const under = p0.clone().add(V(0, -0.1, 0.03));
    await tween(1.5, (k) => reach(under, k), (k) => k);
    // then it settles into the palm (centre 4.2 cm off the palm along its normal, so the shrunk jewel rests on it)
    const inPalm = () => { E.camera.updateMatrixWorld(true); return mu.handR.localToWorld(hand.copy(PALM).add(V(-0.042, 0, 0))); };
    await tween(1.6, (k) => { toy.position.lerpVectors(p0, inPalm(), k); toy.scale.setScalar(1 - 0.55 * k); tl.intensity = 1.5 - k; tHalo.material.opacity = 0.7 - 0.5 * k; });
    const hold = on(() => toy.position.copy(inPalm()));
    giftHeld = true;   // in your hand it hums at its fullest (still faint)
    tween(1.8, (k) => { offer = 1 - k; });
    await say('It is warm. It hums against your palm.');
    await say('The child lets their arms fall, and goes on looking at you.');
    hold();
  } else {
    tween(3.2, (k) => { offer = 1 - k; tl.intensity = 1.5 - k * 1.1; tHalo.material.opacity = 0.7 - k * 0.45; });
    await say('The child lowers it, slowly, and goes on looking at you.');
    await wait(1.2);
  }
  note('toy');
  amb.stop(1); bub.stop(1); padA.stop(1); padB.stop(1); gift.stop(1.5);
  await fade(1, 1, '#fff');
}

// ---------- the still room (Gateway: mind awake, body asleep) ----------
// a plain box room: matte panels, darkened corners, a lit ceiling panel over the table
const VIEW_ROOM = PEARL + `
uniform vec3 uHalf;
void main() {
  vec3 n = normalize(vNormal);
  vec3 d = uHalf - abs(vPos);
  float m1 = min(d.x, min(d.y, d.z)); float m3 = max(d.x, max(d.y, d.z));
  float m2 = d.x + d.y + d.z - m1 - m3;
  float ao = 0.55 + 0.45 * smoothstep(0.0, 0.7, m2);
  float isFloor = step(n.y, -0.5); float isCeil = step(0.5, n.y);
  vec2 q = abs(n.y) > 0.5 ? vWorld.xz : (abs(n.x) > 0.5 ? vWorld.zy : vWorld.xy);
  vec2 cell = mix(vec2(0.9, 0.725), vec2(0.6, 0.6), isFloor);
  vec2 e = (0.5 - abs(fract(q / cell) - 0.5)) * cell;
  float seam = smoothstep(0.01, 0.003, min(e.x, e.y));
  vec3 col = mix(vec3(0.2, 0.215, 0.24), vec3(0.13, 0.14, 0.16), isFloor);
  col *= 0.94 + 0.06 * hash2(floor(q / cell));
  vec2 lp = vWorld.xz - vec2(0.0, -0.5);
  float pool = exp(-dot(lp, lp) * 0.35);
  col *= 0.55 + 0.75 * pool * mix(0.6, 1.0, isFloor) + 0.25 * smoothstep(0.0, 2.9, vWorld.y) * (1.0 - isCeil);
  col *= 1.0 - 0.45 * seam;
  col *= ao;
  col += vec3(0.35, 0.55, 0.8) * smoothstep(0.012, 0.0, abs(vWorld.y - 1.02)) * step(abs(n.y), 0.5) * 0.5;
  vec2 cp = abs(vWorld.xz - vec2(0.0, -0.5));
  float panel = step(cp.x, 0.8) * step(cp.y, 0.45) * isCeil;
  vec2 gq = fract(vWorld.xz * 10.0);
  col = mix(col, vec3(0.92, 0.95, 1.0) * (1.0 - 0.15 * step(0.9, max(gq.x, gq.y))), panel);
  col += vec3(0.2, 0.25, 0.3) * exp(-max(cp.x - 0.8, 0.0) * 6.0 - max(cp.y - 0.45, 0.0) * 6.0) * (1.0 - panel) * isCeil * 0.4;
  float fres = pow(1.0 - abs(dot(n, normalize(cameraPosition - vWorld))), 3.0);
  col += pearl(fres, vWorld.y * 0.05) * fres * 0.04 * (1.0 - isFloor);
  vec2 sd = vWorld.xz - vec2(0.0, -0.5);
  col *= 1.0 - 0.35 * isFloor * exp(-(sd.x * sd.x / 0.5 + sd.y * sd.y / 0.2) * 1.6);
  gl_FragColor = vec4(col, 1.0);
}`;
// the display's columns of marks; seed 3 is how they read, other seeds at low lucidity (redrawn into the same canvas)
const glyphColumns = () => canvasTex(256, 512, (g) => drawColumns(g, 3));
function drawColumns(g, seed) {
  {
    g.globalAlpha = 1; g.fillStyle = '#000'; g.fillRect(0, 0, 256, 512);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.lineCap = 'round';
    let s = seed; const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    for (let x = 14; x < 256; x += 22) for (let y = 10; y < 512; y += 20) {
      if (r() < 0.25) continue;
      g.globalAlpha = 0.4 + r() * 0.6; g.beginPath();
      const k = Math.floor(r() * 4);
      if (k === 0) g.arc(x, y, 5, 0, 1 + r() * 5);
      else if (k === 1) { g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y - 5); g.lineTo(x, y + 5); }
      else if (k === 2) { g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.moveTo(x, y - 6); g.lineTo(x, y + 6); }
      else { g.moveTo(x - 4, y - 6); g.lineTo(x - 4, y + 6); g.moveTo(x + 3, y - 3); g.lineTo(x + 3, y + 3); }
      g.stroke();
    }
  }
}

async function viewing() {
  E.scene.background = new THREE.Color(0x0b0d11);
  shaderScene();
  const g = new THREE.Group(); E.scene.add(g);
  g.add(new THREE.HemisphereLight(0xdfe6ff, 0x20242c, 1.2));
  const lamp = new THREE.PointLight(0xffffff, 8, 8); lamp.position.set(0, 2.6, -0.4); g.add(lamp);
  const room = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.9, 5.8), sm(VIEW_ROOM, { uHalf: { value: V(3.2, 1.45, 2.9) } }, { side: THREE.BackSide }));
  room.position.set(0, 1.45, -0.4); g.add(room);
  // a low couch: a padded slab on a stem, its surface at y = 0.5
  const couchM = std(0x5a606b, { metalness: 0.5, roughness: 0.5 });
  const stem = new THREE.Mesh(lathe([[0, 0], [0.36, 0], [0.38, 0.025], [0.3, 0.07], [0.14, 0.16], [0.12, 0.36], [0.22, 0.44], [0, 0.44]]), couchM); stem.position.set(0, 0, -0.5); g.add(stem);
  const topG = new THREE.ExtrudeGeometry(roundedRect(0.8, 2.1, 0.2), { depth: 0.06, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 10 }); topG.rotateX(-Math.PI / 2);
  const couch = new THREE.Mesh(topG, couchM); couch.position.set(0, 0.44, -0.5); g.add(couch);
  // a dark display on the back wall with columns of marks drifting through it
  const cols = glyphColumns(); cols.wrapS = cols.wrapT = THREE.RepeatWrapping; cols.repeat.set(2, 0.6);
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.8), basic(0x6fa0c8, { map: cols, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })); disp.position.set(0, 1.85, -3.27); g.add(disp);
  const dispFrame = new THREE.Mesh(new THREE.PlaneGeometry(2.72, 0.92), basic(0x07090c)); dispFrame.position.set(0, 1.85, -3.285); g.add(dispFrame);
  on((dt) => { cols.offset.y -= dt * 0.02; });
  // low lucidity: look back and the marks on the display are other marks
  unsteady(disp, (k, n) => { drawColumns(cols.image.getContext('2d'), k ? 3 + n * 1013 : 3); cols.needsUpdate = true; });
  // the ceiling panel's light, falling as a soft square cone onto the table, and dust turning in it
  const cone = shaft(0.75, 1.05, 2.05, 0xe8f0ff, 0.14, 4); cone.geometry.rotateY(Math.PI / 4); cone.scale.set(1.1, 1, 0.62); cone.position.set(0, 1.875, -0.5); g.add(cone);
  g.add(motes(120, V(0, 1.6, -0.6), V(2.5, 1.3, 2.0), 0xdfe8ff, 0.7));
  const monitor = makeGrey(true); monitor.position.set(0.8, 0, -0.1); monitor.lookAt(0, 0, -0.1); g.add(monitor);
  on((dt, t) => { aimGrey(monitor, E.camera.position, 0.9); });
  // you, lying on the couch, looking up
  setView(0, 0.74, 0.25, 0, 1.2); E.mode = 'look'; E.limits = { yaw: 1.5, up: 0.35, down: 1.1 }; E.unsteady = true;   // free to look round the room until the tuning starts
  const me = makePlayerBody(); me.rotation.set(Math.PI / 2, 0, 0); me.position.set(0, 0.67, 0.35); me.userData.relax(0.08); E.scene.add(me);
  const amb = A.drone(147, { g: 0.03 });
  await fade(0, 1.4, '#fff');
  await say('A bare room and a low table, and you are on it. The tall grey one stands over you and does not blink.');
  await say('Mind awake. Body asleep.', 'them'); note('focus10');
  await say('A tone starts in your left ear. A different one in your right.');

  // ---- tuning: two rings overhead are the two tones; bring them together and hold them there ----
  // once the tuning starts the view is held flat on your back, straight up into the ceiling light
  const upAim = aimAt(V(0, 2.9, -0.5)); E.mode = 'locked';
  await moveView(1.2, { yaw: upAim.yaw, pitch: upAim.pitch });
  const ringG = new THREE.TorusGeometry(0.42, 0.012, 8, 96);
  const mL = basic(0x8fc8ff, { transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }), mR = basic(0xffd27a, { transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const rL = new THREE.Mesh(ringG, mL), rR = new THREE.Mesh(ringG, mR), rings = new THREE.Group(); rings.add(rL, rR);
  const _rd = new THREE.Vector3(); let spin = 0;
  const placeRings = () => { E.camera.getWorldDirection(_rd); rings.position.copy(E.camera.position).addScaledVector(_rd, 1.6); rings.lookAt(E.camera.position); rings.rotateZ(spin); };
  placeRings(); g.add(rings);
  const TARGET = 4;                                  // the slow beat that carries you down
  let d = Math.random() < 0.5 ? 15 : -9, prog = 0, tt = 0, ph = 0;
  const tones = A.binaural(180, d); tones.level(0.15, 3);
  const vib = A.drone(38, { type: 'sawtooth', g: 0.0001, fade: 0.1 });
  E.captureLook = (dx) => { d += dx * 22; };
  hint('Move the mouse left and right (or A and D) until the two rings sit on each other. Hold them there.');
  await new Promise((res) => {
    let lastV = -1;
    const off = on((dt) => {
      tt += dt;
      d += ((E.keys.KeyD ? 1 : 0) - (E.keys.KeyA ? 1 : 0)) * dt * 7;
      d += Math.sin(tt * 0.6) * dt * 0.9;             // it will not stay put on its own
      if (tt > 32) d += (TARGET - d) * Math.min(1, dt * 1.5);   // nobody gets stuck here
      d = Math.max(-18, Math.min(18, d));
      tones.diff(d);
      const err = d - TARGET, locked = Math.abs(err) < 0.8;
      prog = Math.max(0, Math.min(1, prog + (locked ? dt / 8 : -dt / 18)));
      ph += dt * Math.abs(d) * Math.PI * 2;
      const beat = 0.5 + 0.5 * Math.cos(ph);
      rR.scale.setScalar(Math.max(0.2, 1 + err * 0.085)); rL.scale.setScalar(1 + prog * 0.15 * beat);
      mL.opacity = mR.opacity = 0.35 + 0.6 * beat;
      mR.color.setHex(locked ? 0x8fc8ff : 0xffd27a);
      spin += dt * 0.2; placeRings();
      E.shake = 0.002 + prog * 0.028; bar(prog);
      const vg = Math.round(prog * 10); if (vg !== lastV) { lastV = vg; vib.set(38 + prog * 10, 0.0001 + prog * 0.065, 0.4); }
      if (prog >= 1) { off(); res(); }
    });
  });
  E.captureLook = null; hint(''); bar(null);
  await say('The vibration takes your whole body. Then it smooths out, into a hum.');
  note('rollout');

  // ---- rolling out ----
  prompt('ROLL OUT');
  hint('Hold A or D, or drag sideways. Roll over without moving a muscle.');
  let roll = 0, dir = 0, push = 0;
  const p0 = E.camera.position.clone(); E.mode = 'locked';
  E.captureLook = (dx) => { push = Math.min(1, push + Math.abs(dx) * 6); if (!dir && Math.abs(dx) > 0.002) dir = dx > 0 ? 1 : -1; };
  await new Promise((res) => {
    let t2 = 0;
    const off = on((dt) => {
      t2 += dt;
      const key = (E.keys.KeyD || E.keys.ArrowRight ? 1 : 0) - (E.keys.KeyA || E.keys.ArrowLeft ? 1 : 0);
      if (key && !dir) dir = key;
      const going = key !== 0 || push > 0.05 || t2 > 14;
      if (!dir && t2 > 14) dir = 1;
      push = Math.max(0, push - dt * 2.5);
      roll = Math.max(0, Math.min(1, roll + (going ? dt / 2.6 : -dt / 4)));
      E.roll = -dir * roll * 1.45;
      E.camera.position.set(p0.x + dir * roll * 0.5, p0.y + roll * roll * 0.35, p0.z);
      E.shake = 0.03 * (1 - roll); bar(roll);
      rings.scale.setScalar(1 + roll * 2); mL.opacity = mR.opacity = 0.8 * (1 - roll);
      if (roll >= 1) { off(); res(); }
    });
  });
  E.captureLook = null; prompt(''); hint(''); bar(null);
  tones.stop(0.4); vib.stop(0.3); amb.stop(0.5);
  A.tone(60, 1.2, { g: 0.3, to: 30 });
  $('fade').style.background = '#fff'; $('fade').style.opacity = 1;
  await wait(0.5);
  G.lucidity += 0.08;

  // ---- out: not on the ship at all ----
  clearScene();
  shaderScene();
  E.roll = 0; E.shake = 0.002;
  const R = buildBedroom({ clock: '3:07' }); E.scene.add(R.group);
  R.body.visible = true;
  const watcher = makeGrey(); watcher.position.set(1.0, 0, -0.5); watcher.rotation.y = -Math.PI / 2; R.group.add(watcher);
  E.camera.position.set(0.35, 2.3, -0.2);
  const a0 = aimAt(V(0, 0.55, -1.45)); setView(0.35, 2.3, -0.2, a0.yaw, a0.pitch); E.limits = { yaw: 0.7, up: 0.5, down: 0.3 }; E.mode = 'look';
  on((dt, t) => { E.camera.position.y = 2.3 + Math.sin(t * 0.5) * 0.04; E.camera.position.x = 0.35 + Math.sin(t * 0.31) * 0.05; E.roll = Math.sin(t * 0.37) * 0.03; });
  const hum = A.rise(62, 0.04, 4, { type: 'sawtooth' });
  await fade(0, 2.2, '#fff');
  await say('You are out. And you are not on any ship.');
  await say('Your own room. Your own bed. Someone is asleep in it.');
  await say('It is you. You never left... or did you?');
  await wait(0.8);
  const hd = watcher.userData.head, want = Math.atan2(E.camera.position.x - 1.0, E.camera.position.z + 0.5) + Math.PI / 2;
  A.tone(110, 1.6, { type: 'sawtooth', g: 0.22, to: 55 });
  say('The small one by the bed turns their head, and looks straight up at you.');
  await tween(0.6, (k) => { hd.rotation.y = want * k; hd.rotation.x = -0.6 * k; }, (k) => 1 - Math.pow(1 - k, 3));
  note('looksback');
  await wait(2.4);
  hum.stop(0.05);
  $('fade').style.background = '#000'; $('fade').style.opacity = 1;
  A.noise(0.25, { g: 0.3, f: 300, q: 0.7, type: 'lowpass' });
  await wait(1);
  await say('Enough.', 'them');
}

export const ROOMS = { class: classroom, window: windowRoom, containers, viewing };
// the shader kit and room shaders, for scenes in other files that show these rooms again (js/scenes/reveal.js)
export const KIT = { sm, shaderScene, motes, shaft, glowTex, dcol, lathe, canvasTex, palmReach, PALM, TIME, FOGU, ADD, JEWEL, PEARL, SHAFT,
  HALL_WALL, HALL_FLOOR, GLASS, FLUID, SEED, BOB, GROUND_HAZE, VZ, CL_WALL, CL_FLOOR, CL_CEIL, CL_INLAY };
