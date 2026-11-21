// The control room: watching the weave, the weather console, the link. Then, after the field, the return.
import { THREE, lookToward, E, G, on, wait, until, tween, lerp, say, hint, fade, note, setView, moveView, angleTo, aimAt, discard, warm } from '../engine.js';
import { A } from '../audio.js';
import { makeGrey, makeMantis, idleMantis, makeHuman, makePlayerBody, playerHead, aimGrey, stepGrey, idleGrey, clearGreyArm, gripGrey, GREY_GAIT, T } from '../models.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const V2 = (x, y) => new THREE.Vector2(x, y);
const PI = Math.PI, TAU = PI * 2;
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const c01 = (x) => Math.min(1, Math.max(0, x));
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color, ...o });
const polar = (a, r, y = 0) => V(Math.sin(a) * r, y, Math.cos(a) * r);   // angle from +z, turning toward +x
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const angTo = (a, b, k) => a + wrapA(b - a) * k;
const M4 = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(sx, sy, sz));
// several geometries (each with an optional matrix) as one non-indexed geometry: position, normal, uv
function mergeGeos(parts) {
  const pos = [], nor = [], uv = [], v = V(0, 0, 0), n = V(0, 0, 0), nm = new THREE.Matrix3();
  for (const [g0, m] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0, p = g.attributes.position, nn = g.attributes.normal, u = g.attributes.uv;
    if (m) nm.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); if (m) v.applyMatrix4(m); pos.push(v.x, v.y, v.z);
      n.fromBufferAttribute(nn, i); if (m) n.applyMatrix3(nm).normalize(); nor.push(n.x, n.y, n.z);
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
    }
    if (g !== g0) g.dispose(); g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// soft round glow and a soft noisy puff: shared by every sprite here, kept between scenes
let glowCache = null, puffCache = null;
const glowTex = () => { if (!glowCache) { glowCache = canvasTex(128, 128, (g) => {
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
}); glowCache.userData.keep = true; } return glowCache; };
const puffTex = () => { if (!puffCache) { puffCache = canvasTex(128, 128, (g) => {
  g.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * TAU, d = Math.pow(Math.random(), 0.7) * 30, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d * 0.8, r = 14 + Math.random() * 20;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}); puffCache.userData.keep = true; } return puffCache; };
const sprite = (tex, color, size, o = {}) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...o })); s.scale.setScalar(size); return s; };

// ---------- shader kit (as in ship.js: display-space colours, shared time and fog uniforms) ----------
const dcol = (hex) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);
const TIME = { value: 0 };
const FOGU = { uFogC: { value: new THREE.Color(0) }, uFogN: { value: 1e6 }, uFogF: { value: 2e6 } };
function shaderScene() {
  const f = E.scene.fog;
  FOGU.uFogC.value = f ? f.color : new THREE.Color(0);
  FOGU.uFogN.value = f ? f.near : 1e6; FOGU.uFogF.value = f ? f.far : 2e6;
  on((dt, t) => { TIME.value = t; });
}
const VERT = `
varying vec2 vUv; varying vec3 vPos; varying vec3 vWorld; varying vec3 vNormal; varying vec3 vVN; varying float vDepth;
uniform float uTime;
void main() {
  vUv = uv; vPos = position;
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
#endif
  vec4 w = m * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize((m * vec4(normal, 0.0)).xyz);
  vVN = normalize((viewMatrix * vec4(vNormal, 0.0)).xyz);
  vec4 mv = viewMatrix * w;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const HEAD = `
varying vec2 vUv; varying vec3 vPos; varying vec3 vWorld; varying vec3 vNormal; varying vec3 vVN; varying float vDepth;
uniform float uTime; uniform vec3 uFogC; uniform float uFogN; uniform float uFogF;
float fogk() { return smoothstep(uFogN, uFogF, vDepth); }
vec3 fogit(vec3 c) { return mix(c, pow(uFogC, vec3(0.4545)), fogk()); }
float hash2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 flatN() { vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld))); return n; }
`;
function sm(frag, u = {}, o = {}) {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: HEAD + frag, uniforms: { uTime: TIME, ...FOGU, ...u }, ...o });
}
const ADD = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

// ---------- the hall ----------
// A round hall, 23 m across. The gallery (y 0) runs from the rail at 5 m out to the wall; inside the rail one tier steps down
// to the pit floor, and in the middle of that the basin. Angles are measured from +z turning toward +x; the wall is divided
// into twelve bays of 30 degrees.
const R_WALL = 11.5, R_IN = 5.0, BAY = TAU / 12, BASIN_Y = -1.3, BASIN_R = 2.0;
const A_DOOR = -BAY, A_WEATHER = 2 * BAY, A_LINK = 4 * BAY;
const DESK_BAYS = [1, 3, 5, 6, -2, -3, -4, -5];
const DESK_R = 10.55, DESK_Y = 0.5, DESK_TILT = 0.14;

const HALL_WALL = `
uniform vec3 uBasin; uniform float uView;
float glyph(vec2 q, float g) {
  float m = smoothstep(0.08, 0.03, abs(q.x - (g - 0.5) * 0.5)) * step(abs(q.y), 0.3) * step(0.35, g);
  m += smoothstep(0.08, 0.03, abs(q.y - (fract(g * 7.0) - 0.5) * 0.5)) * step(abs(q.x), 0.3) * step(0.3, fract(g * 3.0));
  m += smoothstep(0.1, 0.04, abs(length(q) - 0.25)) * step(0.78, fract(g * 13.0));
  return min(1.0, m) * step(0.22, g);
}
void main() {
  float y = vWorld.y; float th = atan(vWorld.x, vWorld.z);
  float bay = 0.5235988;
  float k = floor(th / bay + 0.5); float x = (th - k * bay) * 11.5;       // metres along the wall from the bay's middle
  vec3 col = vec3(0.034, 0.04, 0.052) * (0.7 + 0.6 * noise2(vec2(th * 70.0, y * 2.5)));
  col *= 1.0 - 0.4 * smoothstep(0.03, 0.01, abs(fract(y / 1.1) - 0.5) * 1.1);            // plate seams
  col *= 1.0 - 0.3 * smoothstep(0.03, 0.01, abs(abs(x) - 1.5));
  float rib = smoothstep(0.2, 0.12, abs(abs(x) - 3.01));                                 // a pilaster between bays
  col = mix(col, vec3(0.06, 0.07, 0.088) * (0.8 + 0.4 * smoothstep(0.2, 0.0, abs(abs(x) - 3.01))), rib);
  col += uBasin * 0.045 * (1.0 - smoothstep(0.0, 4.4, y));
  float isDoor = step(abs(k + 1.0), 0.1), isLink = step(abs(k - 4.0), 0.1), isWx = step(abs(k - 2.0), 0.1), isTong = step(abs(k), 0.1);
  float desk = (1.0 - isDoor) * (1.0 - isLink) * (1.0 - isWx) * (1.0 - isTong);
  // a display over each console: columns of marks, each column moving at its own pace
  vec2 p = vec2(x / 0.98, (y - 1.78) / 0.66);
  float inP = step(abs(p.x), 1.0) * step(abs(p.y), 1.0) * desk;
  float h1 = hash2(vec2(k, 3.0));
  vec3 tint = mix(vec3(0.3, 0.78, 1.0), vec3(1.0, 0.6, 0.24), step(0.62, h1));
  tint = mix(tint, vec3(0.5, 1.0, 0.72), step(h1, 0.22));
  float fr = smoothstep(1.1, 1.05, max(abs(p.x), abs(p.y))) * (1.0 - inP) * desk;
  col = mix(col, vec3(0.012, 0.014, 0.018), fr);
  col += tint * 0.05 * desk * exp(-max(0.0, max(abs(p.x), abs(p.y)) - 1.0) * 2.2) * (1.0 - inP);   // its light on the wall round it
  if (inP > 0.5) {
    float cx = floor((p.x * 0.5 + 0.5) * 16.0), fx = fract((p.x * 0.5 + 0.5) * 16.0);
    float sp = 0.12 + 0.45 * hash2(vec2(cx, k + 7.0));
    float yy = (p.y * 0.5 + 0.5) * 9.0 + uTime * sp * (hash2(vec2(cx, k)) > 0.5 ? 1.0 : -1.0);
    float cy = floor(yy), fy = fract(yy);
    float g = hash2(vec2(cx + k * 31.0, cy));
    float m = glyph(vec2(fx, fy) - 0.5, g) * step(0.2, hash2(vec2(cx, k * 3.0)));
    float lit = 0.3 + 0.7 * step(0.93, fract(g * 5.0 + uTime * 0.13 * sp));               // now and then one flares
    // a trace across the lower third of some panels
    float tr = smoothstep(0.05, 0.01, abs(p.y + 0.55 - 0.25 * (noise2(vec2(p.x * 4.0 + uTime * 0.4 + k, k)) - 0.5))) * step(0.5, h1);
    col = vec3(0.004, 0.008, 0.012) + tint * (m * lit * 0.85 + tr * 0.6 + 0.025);
  }
  // the way in: a tall arch of white light
  vec2 d = vec2(x, y - 1.5); float sprg = 0.75;
  float sd = d.y > sprg ? length(d - vec2(0.0, sprg)) - 0.95 : max(abs(d.x) - 0.95, -d.y - 1.5);
  col = mix(col, vec3(0.93, 0.95, 1.0) * (0.72 + 0.12 * noise2(vec2(x * 3.0, y * 2.0 - uTime * 0.2))), isDoor * smoothstep(0.02, -0.03, sd));
  col += vec3(0.5, 0.56, 0.66) * isDoor * exp(-max(sd, 0.0) * 2.4) * 0.3 * step(0.0, sd);
  // the link alcove: a tall niche of dull red light behind the couch
  sd = d.y > 1.1 ? length(vec2(d.x, d.y - 1.1)) - 1.5 : max(abs(d.x) - 1.5, -d.y - 1.5);
  float ridges = 0.75 + 0.25 * sin(x * 22.0);
  col = mix(col, vec3(0.32, 0.07, 0.06) * ridges * (0.5 + 0.5 * smoothstep(3.6, 0.0, y)), isLink * smoothstep(0.02, -0.04, sd) * 0.9);
  col += vec3(0.5, 0.12, 0.08) * isLink * exp(-abs(sd) * 9.0) * 0.5;
  // the weather bay: a long port onto the night land far below, a few lights in it
  vec2 w = vec2(x / 2.3, (y - 2.25) / 0.85);
  float inW = smoothstep(1.0, 0.97, length(w * vec2(1.0, 1.0)));
  vec3 land = vec3(0.012, 0.018, 0.03) + vec3(0.02, 0.035, 0.06) * smoothstep(0.2, 1.0, w.y + noise2(w * 3.0 + vec2(uTime * 0.01, 0.0)) * 0.5);
  vec2 lc = (w + vec2(uTime * 0.004, 0.0)) * vec2(150.0, 60.0);
  float lights = step(0.993, hash2(floor(lc))) * smoothstep(0.45, 0.1, length(fract(lc) - 0.5)) * smoothstep(0.3, -0.6, w.y);
  land += vec3(1.0, 0.8, 0.5) * lights * 0.7;
  land += vec3(0.5, 0.6, 0.75) * 0.1 * smoothstep(0.55, 0.8, noise2(w * vec2(2.5, 5.0) + vec2(uTime * 0.02, 3.0))) * uView;   // cloud drawing over the land
  col = mix(col, land, isWx * inW);
  col += vec3(0.25, 0.4, 0.55) * isWx * smoothstep(0.05, 0.0, abs(length(w) - 1.0)) * 0.35;
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
const HALL_FLOOR = `
uniform vec3 uBasin;
void main() {
  float r = length(vWorld.xz); float th = atan(vWorld.x, vWorld.z);
  vec3 col = vec3(0.036, 0.042, 0.054) * (0.75 + 0.5 * noise2(vWorld.xz * 2.2));
  float sa = abs(fract(th / 0.1309 + 0.5) - 0.5) * 0.1309 * r, sr = abs(fract(r / 1.1) - 0.5) * 1.1;
  col *= 1.0 - 0.55 * smoothstep(0.014, 0.004, min(sa, sr));
  col *= 0.9 + 0.2 * noise2(vec2(th * 420.0, r * 5.0));                     // brushed round the hall
  col += uBasin * 0.085 * smoothstep(9.5, 4.0, r);                          // the basin's light lying across the plates
  col += vec3(0.16, 0.34, 0.5) * 0.05 * smoothstep(9.3, 11.4, r);           // and the consoles' at the wall
  float gl = smoothstep(0.03, 0.012, abs(r - 5.55)) * step(0.5, fract(th / 0.0436));
  col += vec3(0.45, 0.8, 1.0) * gl * 0.45;                                   // a broken line of small lights inside the rail
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
const HALL_PIT = `
uniform vec3 uBasin;
void main() {
  vec3 n = flatN(); float up = abs(n.y);
  float r = length(vWorld.xz); float th = atan(vWorld.x, vWorld.z);
  vec3 col = vec3(0.03, 0.035, 0.045) * (0.75 + 0.5 * noise2(vec2(th * 30.0, r * 3.0 + vWorld.y * 5.0)));
  float d = length(vec3(vWorld.x, vWorld.y + 1.2, vWorld.z));
  col += uBasin * (1.0 / (1.0 + d * d * 0.16)) * mix(0.5, 0.26, up);
  float line = smoothstep(0.022, 0.008, abs(vWorld.y + 0.14)) + smoothstep(0.022, 0.008, abs(vWorld.y + 0.89));
  col += vec3(0.4, 0.82, 1.0) * line * (1.0 - up) * 0.65 * (0.55 + 0.45 * step(0.5, fract(th / 0.0654)));
  float sa = abs(fract(th / 0.2618 + 0.5) - 0.5) * 0.2618 * r;
  col *= 1.0 - 0.5 * up * smoothstep(0.014, 0.004, sa);
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
const HALL_DOME = `
uniform vec3 uBasin;
void main() {
  float r = length(vWorld.xz); float th = atan(vWorld.x, vWorld.z);
  vec3 col = vec3(0.016, 0.019, 0.026) * (0.8 + 0.4 * noise2(vec2(th * 40.0, r * 2.0)));
  float ribs = smoothstep(0.07, 0.02, abs(fract(th / 0.2618 + 0.5) - 0.5) * 0.2618 * r);
  float rings = smoothstep(0.05, 0.015, abs(fract(r / 1.9) - 0.5) * 1.9);
  col += vec3(0.022, 0.028, 0.038) * max(ribs, rings);
  col += uBasin * 0.035 * smoothstep(11.5, 0.0, r);
  col += vec3(0.55, 0.78, 1.0) * smoothstep(0.07, 0.02, abs(vWorld.y - 4.62)) * step(0.62, fract(th / 0.0327)) * 0.3;   // small lamps where the dome springs
  col += vec3(0.5, 0.75, 1.0) * 0.5 * smoothstep(2.2, 0.8, r);              // light round the opening the threads go up into
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// The basin: lights without number on slow spiral currents, in three depths. uWin opens the middle onto what lies under it.
const BASIN = `
uniform float uWin; uniform vec4 uDrop; uniform float uLevel;
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 lives(vec2 p, float r, float L) {
  float sw = uTime * 0.025 * (1.0 + L) + (1.2 - r) * (0.7 + 0.2 * L);
  vec2 q = rot(sw) * p * (7.0 + L * 6.0);
  vec2 id = floor(q); vec2 f = fract(q) - 0.5;
  float h = hash2(id + L * 17.0);
  float tw = 0.5 + 0.5 * sin(uTime * (0.3 + h * 1.7) + h * 40.0);
  float d = max(abs(f.x + (h - 0.5) * 0.3), abs(f.y + (fract(h * 9.0) - 0.5) * 0.3) * 1.5);
  float w = smoothstep(0.2, 0.08, d) * step(0.4, h) * (0.15 + 0.85 * tw * tw);
  w += smoothstep(0.4, 0.0, d) * step(0.97, fract(h * 3.7 + uTime * 0.05)) * 1.5;      // one flares: a birth, a fire, a war
  vec3 tint = mix(vec3(1.0, 0.7, 0.36), vec3(0.5, 0.78, 1.0), step(0.5, fract(h * 7.3)));
  return tint * w / (1.0 + L * 0.9);
}
void main() {
  vec2 p = vPos.xy; float r = length(p) / 2.0;
  if (r < uWin * 0.8) discard;
  float a = atan(p.y, p.x);
  vec3 col = vec3(0.006, 0.02, 0.034);
  col += lives(p, r, 0.0) * 0.9 + lives(p + 0.37, r, 1.0) * 0.8 + lives(p - 0.21, r, 2.0) * 0.7;
  float fl = noise2(vec2(a * 3.0 + r * 5.0 - uTime * 0.06, r * 6.0 - uTime * 0.09));
  col += vec3(0.08, 0.3, 0.45) * pow(fl, 3.0) * 0.7;                                     // currents
  col += vec3(0.45, 0.78, 1.0) * exp(-r * r * 7.0) * 0.45;                               // where the threads leave it
  float dr = length(p - uDrop.xy), age = uTime - uDrop.z;
  col += vec3(0.6, 0.85, 1.0) * smoothstep(0.07, 0.0, abs(dr - age * 0.9)) * exp(-age * 1.6) * step(0.0, age) * uDrop.w;   // something fell in
  col += vec3(1.0) * smoothstep(0.06, 0.0, r - uWin * 0.8) * step(0.001, uWin) * 0.8;       // the lip of the opening
  col *= smoothstep(1.0, 0.93, r) * uLevel;
  gl_FragColor = vec4(col, 1.0);
}`;
const COLUMN = `
uniform vec3 uColor; uniform float uAmt;
void main() {
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld);
  float edge = pow(abs(dot(n, v)), 2.0), h = vUv.y;
  float rays = 0.6 + 0.4 * sin(vUv.x * 6.2831853 * 11.0 + sin(h * 3.0 + uTime * 0.2) * 1.5);
  float a = edge * (1.0 - h) * (1.0 - h) * smoothstep(0.0, 0.06, h) * rays;
  gl_FragColor = vec4(uColor * a * uAmt, 1.0);
}`;
const DESK = `
void main() {
  // rows of small keys; a few lit, one now and then waking
  vec2 q = vec2(vUv.x * 22.0, vUv.y * 5.0); vec2 id = floor(q); vec2 f = fract(q) - 0.5;
  float seed = hash2(id + floor(vWorld.xz * 0.37));
  float key = smoothstep(0.42, 0.34, max(abs(f.x), abs(f.y)));
  float lit = step(0.72, seed) * (0.5 + 0.5 * sin(uTime * (0.4 + seed * 2.0) + seed * 30.0)) + step(0.96, fract(seed * 5.0 + uTime * 0.21));
  vec3 tint = mix(vec3(0.3, 0.8, 1.0), vec3(1.0, 0.62, 0.25), step(0.85, fract(seed * 11.0)));
  vec3 col = vec3(0.012, 0.015, 0.02) + key * (vec3(0.03, 0.036, 0.045) + tint * lit * 0.8);
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
class Path extends THREE.Curve { constructor(f) { super(); this.f = f; } getPoint(t, o = new THREE.Vector3()) { return this.f(t, o); } }
// the outline of the tongue that runs out from the gallery over the pit, toward the loom: t 0..1 round its edge
const TONGUE_W = 0.95, TONGUE_Z = 2.9;
function tonguePt(t, y, o, r = TONGUE_W) {
  const s = 5.0 - TONGUE_Z, arc = PI * r, L = t * (2 * s + arc);
  if (L < s) return o.set(-r, y, 5.0 - L);
  if (L < s + arc) { const a = (L - s) / r; return o.set(-Math.cos(a) * r, y, TONGUE_Z - Math.sin(a) * r); }
  return o.set(r, y, TONGUE_Z + (L - s - arc));
}

// the hall's own sky, fog and shader clock (set when its scene starts; the hall itself may have been built ahead)
function hallScene() {
  E.scene.background = new THREE.Color(0x030508);
  E.scene.fog = new THREE.Fog(0x030508, 9, 46);
  shaderScene();
  E.surface = 'deck'; E.heart = false;
}
function buildHall(into = E.scene) {
  const g = new THREE.Group(); into.add(g);
  const HU = { uBasin: { value: new THREE.Color(0.42, 0.78, 1.0) } };
  const metal = std(0x59616d, { metalness: 0.85, roughness: 0.38 }), dark = std(0x23272e, { metalness: 0.8, roughness: 0.45 });
  // shell
  const wallU = { ...HU, uView: { value: 0 } };
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R_WALL, R_WALL, 4.4, 192, 1, true), sm(HALL_WALL, wallU, { side: THREE.BackSide })); wall.position.y = 2.2;
  const domePts = []; for (let i = 0; i <= 18; i++) { const a = i / 18 * PI / 2; domePts.push(V2(0.9 + (R_WALL - 0.9) * Math.cos(a), 4.4 + 5.8 * Math.sin(a))); }
  const dome = new THREE.Mesh(new THREE.LatheGeometry(domePts, 96), sm(HALL_DOME, HU, { side: THREE.DoubleSide }));
  const eye = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), basic(0xa8d4ff)); eye.rotation.x = PI / 2; eye.position.y = 10.2;
  const floorM = sm(HALL_FLOOR, HU);
  const floor = new THREE.Mesh(new THREE.RingGeometry(R_IN, R_WALL, 160, 1), floorM); floor.rotation.x = -PI / 2;
  const pit = new THREE.Mesh(new THREE.LatheGeometry([[5.0, 0.0], [5.0, -0.75], [3.9, -0.75], [3.9, -1.5], [2.42, -1.5], [2.38, -1.22], [2.3, -1.15], [2.08, -1.15], [2.0, -1.2], [2.0, -1.5]].map(([x, y]) => V2(x, y)), 160),
    sm(HALL_PIT, HU, { side: THREE.DoubleSide }));
  g.add(wall, dome, eye, floor, pit);
  // the tongue: a deck running out over the pit, its edge railed
  const ts = new THREE.Shape(); ts.moveTo(-TONGUE_W, 5.15); ts.lineTo(-TONGUE_W, TONGUE_Z); ts.absarc(0, TONGUE_Z, TONGUE_W, PI, TAU, false); ts.lineTo(TONGUE_W, 5.15); ts.closePath();
  const tg = new THREE.ExtrudeGeometry(ts, { depth: 0.14, bevelEnabled: false, curveSegments: 28 }); tg.rotateX(PI / 2);
  const tongue = new THREE.Mesh(tg, [floorM, dark]); tongue.position.y = 0.004; g.add(tongue);
  const strut = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.2, 0.16), dark); strut.position.set(0, -0.72, 3.2); strut.rotation.x = -0.9; g.add(strut);
  // rails: round the gallery's inner edge (open where the tongue joins) and round the tongue
  const gap = Math.asin(TONGUE_W / 5.03) + 0.004;
  for (const [y, tube] of [[1.0, 0.024], [0.52, 0.014]]) {
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new Path((t, o) => o.copy(polar(gap + t * (TAU - 2 * gap), 5.03, y))), 220, tube, 8), metal));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new Path((t, o) => tonguePt(t, y, o, TONGUE_W - 0.03)), 90, tube, 8), metal));
  }
  const posts = [], pv = V(0, 0, 0);
  for (let i = 0; i <= 44; i++) posts.push(polar(gap + i / 44 * (TAU - 2 * gap), 5.03, 0.5));
  for (let i = 1; i < 13; i++) posts.push(tonguePt(i / 13, 0.5, pv, TONGUE_W - 0.03).clone());
  const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.016, 0.02, 1.0, 6), metal, posts.length), dm = new THREE.Object3D();
  posts.forEach((p, i) => { dm.position.copy(p); dm.rotation.set(0, 0, 0); dm.updateMatrix(); post.setMatrixAt(i, dm.matrix); });
  post.frustumCulled = false; g.add(post);
  // a skirting of light where the gallery meets the wall
  const cove = new THREE.Mesh(new THREE.TorusGeometry(R_WALL - 0.05, 0.02, 6, 200), basic(0x1d3a52)); cove.rotation.x = PI / 2; cove.position.y = 0.04; g.add(cove);
  // consoles round the wall: a pedestal, a sloped top, a field of keys
  const nD = DESK_BAYS.length;
  const ped = new THREE.InstancedMesh(mergeGeos([[new THREE.BoxGeometry(1.5, 0.44, 0.26), M4(0, 0.22, -0.05)], [new THREE.BoxGeometry(1.78, 0.05, 0.56), M4(0, DESK_Y - 0.025, 0, DESK_TILT)],
    [new THREE.BoxGeometry(1.78, 0.1, 0.04), M4(0, DESK_Y + 0.06, -0.27, -0.3)]]), dark, nD);
  const keys = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.66, 0.46).rotateX(-PI / 2), sm(DESK), nD);
  DESK_BAYS.forEach((k, i) => {
    dm.position.copy(polar(k * BAY, DESK_R)); dm.rotation.set(0, k * BAY + PI, 0); dm.updateMatrix(); ped.setMatrixAt(i, dm.matrix);
    dm.position.y = DESK_Y + 0.002; dm.rotation.set(DESK_TILT, k * BAY + PI, 0, 'YXZ'); dm.updateMatrix(); keys.setMatrixAt(i, dm.matrix);
  });
  ped.frustumCulled = keys.frustumCulled = false; g.add(ped, keys);
  // a point on a console's keys in world space: u across (-1..1), v from the near edge (0) to the far edge (1)
  const deskPt = (k, u, v, lift = 0) => {
    const z = 0.2 - v * 0.4, a = k * BAY;
    const lx = u * 0.78, ly = DESK_Y + 0.004 + lift - z * Math.sin(DESK_TILT), lz = z * Math.cos(DESK_TILT);
    // desk frame: +z toward the middle of the hall
    return polar(a, DESK_R - lz, ly).add(V(Math.cos(a) * -lx, 0, Math.sin(a) * lx));
  };
  // low lecterns on the tier, for the ones who mind the basin
  const TIER = [1.92, 3.5, 4.98];
  const lect = new THREE.InstancedMesh(mergeGeos([[new THREE.CylinderGeometry(0.035, 0.06, 0.46, 8), M4(0, 0.23, 0)], [new THREE.CylinderGeometry(0.2, 0.17, 0.03, 20), M4(0, 0.47, 0, 0.3)]]), dark, TIER.length);
  const lectTop = new THREE.InstancedMesh(new THREE.CircleGeometry(0.17, 20).rotateX(-PI / 2), basic(0x4fb4e6), TIER.length);
  TIER.forEach((a, i) => {
    dm.position.copy(polar(a, 4.12, -0.75)); dm.rotation.set(0, a, 0); dm.updateMatrix(); lect.setMatrixAt(i, dm.matrix);
    dm.position.y += 0.487; dm.rotation.set(0.3, a, 0, 'YXZ'); dm.updateMatrix(); lectTop.setMatrixAt(i, dm.matrix);
  });
  lect.frustumCulled = lectTop.frustumCulled = false; g.add(lect, lectTop);
  // the basin, the column of light standing in it, dust rising in the column
  const basinU = { uWin: { value: 0 }, uDrop: { value: new THREE.Vector4(0, 0, -99, 0) }, uLevel: { value: 1 } };
  const basin = new THREE.Mesh(new THREE.CircleGeometry(BASIN_R, 96), sm(BASIN, basinU)); basin.rotation.x = -PI / 2; basin.position.y = BASIN_Y; g.add(basin);
  const colU = { uColor: { value: new THREE.Color(0.3, 0.62, 0.9) }, uAmt: { value: 0.5 } };
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.7, BASIN_R - 0.05, 7.5, 64, 1, true), sm(COLUMN, colU, { ...ADD, side: THREE.DoubleSide })); column.position.y = BASIN_Y + 3.75; column.renderOrder = 3; g.add(column);
  // lights: all made here, so nothing recompiles later
  const hemi = new THREE.HemisphereLight(0x8094b8, 0x0c1016, 0.55);
  const basinL = new THREE.PointLight(0x9fd8ff, 42, 0, 2); basinL.position.set(0, -0.3, 0);
  const keyL = new THREE.PointLight(0xfff0e0, 15, 0, 2); keyL.position.set(-0.6, 4.4, 2.6);
  const guideL = new THREE.PointLight(0xcfdcff, 7, 0, 2); guideL.position.set(-3.6, 3.4, 6.2);
  const tableL = new THREE.PointLight(0xbcd4ff, 5, 0, 2); tableL.position.copy(polar(A_WEATHER, 8.5, 2.2));
  const linkL = new THREE.PointLight(0xffa684, 6, 0, 2); linkL.position.copy(polar(A_LINK, 9.2, 2.7));
  g.add(hemi, basinL, keyL, guideL, tableL, linkL);
  return { g, HU, wallU, basin, basinU, column, colU, metal, dark, deskPt, TIER, lights: { hemi, basinL, keyL, guideL, tableL, linkL } };
}

// ---------- the field, small: the same night four ways, drawn into the beads ----------
// One little world (its own scene, drawn into each bead's texture): the field, the hedge and gate, two cars, the circle of
// chairs. apply(kind, t) sets it to one version of the night at loop time t: 'home' (they give up and drive off), 'cold'
// (nothing comes), 'rain' (they run for the cars), 'gold' (fog, and one of them standing alone in it).
const LIVE_RT = new Set();   // bead textures still held: freed when their scene ends, or at the next visit after a jump away
function buildFieldWorld() {
  // Laid out as the field itself is (metres; +x east, +z south; the camp at the origin): hedges south (z 22), west (x -46)
  // and north (z -52); a wire fence on the east side (x 11) with the gate at z -1.75..2.35; beyond it the verge with the
  // two cars (12.5, -4) and (12.5, 3.7), noses north; the lane (x 13.6..17) and its far hedge (x 17.9); the farm's yard
  // light far off to the west-north-west.
  const S = new THREE.Scene(); S.background = new THREE.Color(0x02040a); S.fog = new THREE.FogExp2(0x05080e, 0.006);
  discard(S);   // outside the main scene: this hands it to clearScene, which frees it with the rest
  const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
  const mk = (geo, mat, x = 0, y = 0, z = 0, par = S) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); par.add(m); return m; };
  const hemi = new THREE.HemisphereLight(0x7a8cb4, 0x1c2218, 1.9), moon = new THREE.DirectionalLight(0x9db4e0, 0.9); moon.position.set(-4, 6, 3);
  const carL = new THREE.PointLight(0xffd9a0, 0, 0, 2), carL2 = new THREE.PointLight(0xffd9a0, 0, 0, 2), skyL = new THREE.PointLight(0xfff0d0, 0, 0, 2); skyL.position.set(0.5, 8, 3);
  S.add(hemi, moon, carL, carL2, skyL);
  // ground, lane, hedges, fence and gate, hills, the farm's light, the sky
  const grassT = canvasTex(128, 128, (g) => { g.fillStyle = '#566b3c'; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${20 + Math.random() * 90},${40 + Math.random() * 110},${10 + Math.random() * 50},.5)`; g.fillRect(Math.random() * 128, Math.random() * 128, 1, 2 + Math.random() * 3); } });
  grassT.wrapS = grassT.wrapT = THREE.RepeatWrapping; grassT.repeat.set(90, 90);
  mk(new THREE.PlaneGeometry(700, 700).rotateX(-PI / 2), lam(0x3a4a2c, { map: grassT }));
  mk(new THREE.PlaneGeometry(3.4, 400).rotateX(-PI / 2), lam(0x2c2e33), 15.3, 0.02, -60);
  const hedgeM = lam(0x0e1a0c);
  // a hedge from (x0, z0) to (x1, z1): a long box with a ragged top
  const hedge = (x0, z0, x1, z1, h = 2.2) => { const L = Math.hypot(x1 - x0, z1 - z0), geo = new THREE.BoxGeometry(L, h, 1.6, Math.ceil(L / 0.8), 3, 2), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const n = Math.sin(p.getX(i) * 3.1 + x0) * 0.5 + Math.sin(p.getX(i) * 7.7 + z0) * 0.5; p.setY(i, p.getY(i) + (p.getY(i) > 0 ? n * 0.3 : 0)); p.setZ(i, p.getZ(i) + n * 0.15); }
    geo.computeVertexNormals(); const m = mk(geo, hedgeM, (x0 + x1) / 2, h / 2, (z0 + z1) / 2); m.rotation.y = -Math.atan2(z1 - z0, x1 - x0); };
  hedge(-46, 22, 11.4, 22); hedge(-46, 22, -46, -52); hedge(-46, -52, 17.6, -52); hedge(17.9, -70, 17.9, 60);
  const fenceParts = []; for (let z = -50; z <= 22; z += 3) if (z < -2.4 || z > 2.9) fenceParts.push([new THREE.BoxGeometry(0.09, 1.25, 0.09), M4(11, 0.62, z)]);
  for (const y of [0.38, 0.72, 1.08]) fenceParts.push([new THREE.BoxGeometry(0.015, 0.015, 48.25), M4(11, y, -25.9)], [new THREE.BoxGeometry(0.015, 0.015, 19.65), M4(11, y, 12.2)]);
  fenceParts.push([new THREE.BoxGeometry(0.14, 1.4, 0.14), M4(11, 0.7, -1.75)], [new THREE.BoxGeometry(0.14, 1.4, 0.14), M4(11, 0.7, 2.35)]);
  mk(mergeGeos(fenceParts), lam(0x4a4338));
  const gateParts = []; for (let i = 0; i < 5; i++) gateParts.push([new THREE.BoxGeometry(0.035, 0.05, 4.0), M4(0, 0.25 + i * 0.22, 2.0)]);
  gateParts.push([new THREE.BoxGeometry(0.05, 1.2, 0.05), M4(0, 0.6, 0.03)], [new THREE.BoxGeometry(0.05, 1.2, 0.05), M4(0, 0.6, 3.97)], [new THREE.BoxGeometry(0.03, 0.05, 4.1), M4(0, 0.68, 2.0, 0.22)]);
  const gate = mk(mergeGeos(gateParts), lam(0x8a9096), 11, 0, -1.7); gate.rotation.y = -1.35;   // hinged at its north post, standing open into the field
  for (const [x, z, h] of [[-17, 22.2, 11], [6.5, 22.3, 8.5]]) { const tp = [[new THREE.CylinderGeometry(0.12, 0.26, h * 0.5, 6), M4(x, h * 0.25, z)]];
    for (let i = 0; i < 9; i++) { const a = i * 2.4, l = h * (0.25 + 0.2 * ((i * 7) % 5) / 5); tp.push([new THREE.CylinderGeometry(0.02, 0.07, l, 5), M4(x + Math.cos(a) * l * 0.3, h * (0.45 + 0.05 * i), z + Math.sin(a) * l * 0.3, Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7)]); }
    mk(mergeGeos(tp), lam(0x0c0f0c)); }
  { const n = 120, pos = [], idx = []; for (let i = 0; i <= n; i++) { const a = i / n * TAU, h = 14 + 9 * Math.sin(a * 3 + 1) + 6 * Math.sin(a * 7) + 3 * Math.sin(a * 13 + 2); pos.push(Math.sin(a) * 330, -2, Math.cos(a) * 330, Math.sin(a) * 330, Math.max(4, h), Math.cos(a) * 330); if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); mk(geo, basic(0x04070b, { side: THREE.DoubleSide, fog: false })); }
  const skyT = T.stars(260, 1).clone(); skyT.wrapS = skyT.wrapT = THREE.RepeatWrapping; skyT.repeat.set(4, 2); skyT.needsUpdate = true;
  const sky = mk(new THREE.SphereGeometry(360, 24, 16), basic(0xffffff, { map: skyT, side: THREE.BackSide, fog: false }));
  const yard = sprite(glowTex(), 0xffd7a0, 14, { fog: false }); yard.position.set(-0.78 * 300, 0.03 * 300 + 3, -0.62 * 300); S.add(yard);
  // the camp: chairs in a ring, a low folding table with flasks and the small speaker, the blanket
  const chairG = mergeGeos([[new THREE.BoxGeometry(0.52, 0.03, 0.46), M4(0, 0.43, 0)], [new THREE.BoxGeometry(0.52, 0.5, 0.03), M4(0, 0.73, -0.3, -0.17)],
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => [new THREE.CylinderGeometry(0.012, 0.012, 0.52, 5), M4(sx * 0.25, 0.22, sz * 0.2, sz * 0.3, 0, -sx * 0.12)]),
    [new THREE.BoxGeometry(0.03, 0.03, 0.5), M4(-0.29, 0.63, -0.04)], [new THREE.BoxGeometry(0.03, 0.03, 0.5), M4(0.29, 0.63, -0.04)]]);
  const C = V(0, 0, -0.2);
  const SEATS = [[0.1, -1.95], [-1.75, -0.5], [1.6, -1.25], [-1.25, 1.2]].map(([x, z]) => ({ x, z, ry: Math.atan2(C.x - x, C.z - z) }));
  const chairM = [0x24313f, 0x3a2f24, 0x2a3a2a, 0x24313f].map((c) => lam(c));
  const chairs = SEATS.map((s, i) => { const c = mk(chairG, chairM[i], s.x, 0, s.z); c.rotation.y = s.ry; return c; });
  const tartan = canvasTex(64, 64, (g) => { g.fillStyle = '#7a2a2e'; g.fillRect(0, 0, 64, 64); g.fillStyle = 'rgba(20,30,60,.6)'; for (let i = 0; i < 64; i += 16) { g.fillRect(i, 0, 6, 64); g.fillRect(0, i, 64, 6); } g.fillStyle = 'rgba(220,200,120,.5)'; for (let i = 10; i < 64; i += 16) { g.fillRect(i, 0, 1, 64); g.fillRect(0, i, 64, 1); } });
  tartan.wrapS = tartan.wrapT = THREE.RepeatWrapping; tartan.repeat.set(3, 2);
  const blanket = mk(new THREE.BoxGeometry(1.5, 0.03, 2.1), lam(0xffffff, { map: tartan }), 0.55, 0.02, 1.25); blanket.rotation.y = 0.08;
  const table = mk(mergeGeos([[new THREE.BoxGeometry(0.8, 0.03, 0.55), M4(0, 0.5, 0)], ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => [new THREE.CylinderGeometry(0.012, 0.012, 0.5, 5), M4(sx * 0.36, 0.25, sz * 0.24)]),
    [new THREE.CylinderGeometry(0.04, 0.04, 0.24, 8), M4(-0.2, 0.64, 0.05)], [new THREE.CylinderGeometry(0.035, 0.035, 0.2, 8), M4(0.22, 0.62, -0.1)], [new THREE.BoxGeometry(0.18, 0.1, 0.09), M4(0.02, 0.57, 0.12)]]), lam(0x6f7780), 0, 0, -0.15);
  const tableTorch = sprite(glowTex(), 0xff3a22, 0.5); tableTorch.position.set(-0.05, 0.62, -0.2); S.add(tableTorch);
  // people: jointed figures, enough for someone seen small and far off
  const person = (col, hat) => {
    const g = new THREE.Group(), body = new THREE.Group(), chest = new THREE.Group(); g.add(body); body.add(chest);
    const mC = lam(col), mL = lam(0x1d2330), mS = lam(0xc9a48a), mH = lam(hat);
    const t = mk(new THREE.CapsuleGeometry(0.17, 0.34, 4, 10), mC, 0, 0.32, 0, chest); t.scale.z = 0.72;
    const head = new THREE.Group(); head.position.y = 0.72; chest.add(head);
    mk(new THREE.SphereGeometry(0.105, 12, 10), mS, 0, 0.09, 0, head); mk(new THREE.SphereGeometry(0.113, 12, 8, 0, TAU, 0, PI * 0.52), mH, 0, 0.1, -0.008, head);
    mk(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), mS, 0, -0.02, 0, head);
    const limb = (par, x, y, l1, l2, r, m, foot) => { const a = new THREE.Group(); a.position.set(x, y, 0); par.add(a); mk(new THREE.CapsuleGeometry(r, l1 - r, 3, 8), m, 0, -l1 / 2, 0, a);
      const b = new THREE.Group(); b.position.y = -l1; a.add(b); mk(new THREE.CapsuleGeometry(r * 0.85, l2 - r, 3, 8), m, 0, -l2 / 2, 0, b);
      if (foot) mk(new THREE.BoxGeometry(0.09, 0.07, 0.24), lam(0x0c0d10), 0, -l2 - 0.01, 0.06, b); else mk(new THREE.SphereGeometry(r * 0.95, 8, 6), mS, 0, -l2 - 0.02, 0, b);
      return [a, b]; };
    g.userData = { body, chest, head, aL: limb(chest, -0.22, 0.56, 0.29, 0.27, 0.05, mC), aR: limb(chest, 0.22, 0.56, 0.29, 0.27, 0.05, mC), lL: limb(body, -0.09, 0, 0.43, 0.43, 0.065, mL, true), lR: limb(body, 0.09, 0, 0.43, 0.43, 0.065, mL, true) };
    S.add(g); return g;
  };
  // the man from the table (blue-grey), and four others
  const people = [person(0x6a7384, 0x4a3a2e), person(0x7a2f2a, 0x1f2f4f), person(0x56603a, 0x8a8a84), person(0xa8873a, 0x2a2a2a), person(0x2c3e5e, 0x7a2a3a)];
  const pose = (p, o) => { const u = p.userData;
    u.body.position.y = o.y ?? 0.9; u.body.rotation.x = o.lie || 0; u.chest.rotation.set(o.lean || 0, 0, o.sway || 0); u.head.rotation.set(o.head || 0, o.turn || 0, 0);
    u.lL[0].rotation.x = o.hipL || 0; u.lR[0].rotation.x = o.hipR || 0; u.lL[1].rotation.x = o.kneeL || 0; u.lR[1].rotation.x = o.kneeR || 0;
    u.aL[0].rotation.set(o.shL || 0, 0, -(o.out || 0.08)); u.aR[0].rotation.set(o.shR || 0, 0, o.out || 0.08); u.aL[1].rotation.x = o.elL || 0; u.aR[1].rotation.x = o.elR || 0; };
  const sitP = (extra = {}) => ({ y: 0.5, hipL: -1.5, hipR: -1.5, kneeL: 1.45, kneeR: 1.45, shL: -0.5, shR: -0.5, elL: -0.9, elR: -0.9, lean: -0.08, ...extra });
  const standP = (extra = {}) => ({ y: 0.9, shL: 0.05, shR: 0.05, elL: -0.15, elR: -0.15, ...extra });
  const lieP = (extra = {}) => ({ y: 0.14, lie: -PI / 2, kneeL: 0.05, kneeR: 0.5, hipR: -0.3, shL: 0.1, shR: 0.1, out: 0.3, ...extra });   // on the back, looking straight up
  const runP = (ph, extra = {}) => ({ y: 0.86 + Math.abs(Math.sin(ph)) * 0.05, lean: 0.3, hipL: Math.sin(ph) * 0.95, hipR: -Math.sin(ph) * 0.95, kneeL: 0.25 + Math.max(0, Math.cos(ph)) * 1.2, kneeR: 0.25 + Math.max(0, -Math.cos(ph)) * 1.2,
    shL: -Math.sin(ph) * 0.9, shR: Math.sin(ph) * 0.9, elL: -1.3, elR: -1.3, ...extra });
  const place = (p, x, z, ry) => { p.position.set(x, 0, z); p.rotation.y = ry; p.visible = true; };
  // red torches (to keep night sight), the green laser
  const torches = [1, 3].map(() => { const s = sprite(glowTex(), 0xff3a22, 0.32); S.add(s); return s; });
  const laserG = new THREE.Group(); S.add(laserG);
  mk(new THREE.BoxGeometry(0.03, 260, 0.03), basic(0x38ff5a, { ...ADD, fog: false }), 0, 130, 0, laserG); mk(new THREE.BoxGeometry(0.1, 260, 0.1), basic(0x0c5a1c, { ...ADD, fog: false }), 0, 130, 0, laserG);
  // two cars (nose along their own +x): body, wheels, glass, doors that swing on the field side, lamps and the light they throw
  const carBodyG = (() => { const s = new THREE.Shape(); [[-2.05, 0.3], [-2.05, 0.82], [-1.5, 0.9], [-1.0, 1.4], [0.65, 1.4], [1.2, 0.92], [2.05, 0.8], [2.05, 0.3]].forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    const geo = new THREE.ExtrudeGeometry(s, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 }); geo.translate(0, 0, -0.85); return geo; })();
  const wheelG = new THREE.CylinderGeometry(0.31, 0.31, 0.2, 14).rotateX(PI / 2), glassG = new THREE.PlaneGeometry(1.5, 0.36), doorG = new THREE.BoxGeometry(1.0, 0.78, 0.05).translate(-0.5, 0, 0);
  const beamG = new THREE.ConeGeometry(1.9, 11, 18, 1, true).rotateZ(PI / 2).translate(5.5, 0, 0);
  const car = (col) => {
    const g = new THREE.Group(); S.add(g);
    mk(carBodyG, lam(col), 0, 0, 0, g);
    for (const [x, z] of [[-1.3, 0.8], [1.3, 0.8], [-1.3, -0.8], [1.3, -0.8]]) mk(wheelG, lam(0x0a0a0c), x, 0.31, z, g);
    const glassM = basic(0x0a0e14), glass = [mk(glassG, glassM, -0.18, 1.14, 0.905, g), mk(glassG, glassM, -0.18, 1.14, -0.905, g)]; glass[1].rotation.y = PI;
    const doors = [0.25, -0.85].map((x) => mk(doorG, lam(col), x + 0.5, 0.74, 0.9, g));   // +z is the car's left: the field side when its nose is north
    const lampM = basic(0x30281c); mk(new THREE.SphereGeometry(0.1, 8, 6), lampM, 2.03, 0.68, 0.6, g); mk(new THREE.SphereGeometry(0.1, 8, 6), lampM, 2.03, 0.68, -0.6, g);
    const tailM = basic(0x2a0606); mk(new THREE.BoxGeometry(0.05, 0.12, 0.3), tailM, -2.06, 0.72, 0.62, g); mk(new THREE.BoxGeometry(0.05, 0.12, 0.3), tailM, -2.06, 0.72, -0.62, g);
    const tailGlow = sprite(glowTex(), 0xff2010, 0.1, { fog: false }); tailGlow.position.set(-2.1, 0.72, 0); g.add(tailGlow);
    const beamM = basic(0xfff2d0, { ...ADD, opacity: 0, side: THREE.DoubleSide, fog: false }), beam = mk(beamG, beamM, 2.0, 0.66, 0, g); beam.rotation.z = -0.045;
    const flare = sprite(glowTex(), 0xfff4dc, 0.1, { fog: false }); flare.position.set(2.1, 0.68, 0); g.add(flare);
    const inside = sprite(glowTex(), 0xffd9a0, 1.3); inside.position.set(-0.2, 1.1, 0.5); g.add(inside);
    // light: the lamp inside; head: headlamps and tail lamps; open: the doors
    const set = (light, head, open) => { glassM.color.setRGB(0.04 + light * 0.95, 0.055 + light * 0.75, 0.08 + light * 0.4); inside.material.opacity = light * 0.4; doors.forEach((d, i) => { d.rotation.y = open * (1.1 - i * 0.15); });
      lampM.color.setRGB(0.19 + head * 3, 0.16 + head * 2.8, 0.11 + head * 2.2); tailM.color.setRGB(0.16 + head * 0.9, 0.02, 0.02); beamM.opacity = head * 0.06; flare.scale.setScalar(0.1 + head * 1.6); flare.material.opacity = head; tailGlow.scale.setScalar(0.1 + head * 1.1); tailGlow.material.opacity = head; };
    return { g, set };
  };
  const cars = [car(0x5a6670), car(0x7a2e26)];
  const CAR0 = [{ x: 12.5, z: -4.0, r: PI / 2 }, { x: 12.5, z: 3.7, r: PI / 2 }];   // r turns the nose (+x) about y: PI/2 is north
  // the drive away: out to the right onto the lane and off north, gathering speed (worked out once, then read back by time)
  const drive = (c0) => { const pts = []; let x = c0.x, z = c0.z, r = c0.r; for (let i = 0; i <= 260; i++) { pts.push([x, z, r]); const t = i * 0.05, v = Math.min(9, 1.6 + t * 1.5); r += (t < 1.5 ? -0.5 : t < 3.0 ? 0.5 : 0) * 0.05; x += Math.cos(r) * v * 0.05; z -= Math.sin(r) * v * 0.05; } return (t) => pts[Math.max(0, Math.min(260, Math.round(t / 0.05)))]; };
  const paths = CAR0.map(drive);
  // rain: slanting streaks in a block round the camp, wrapped as they fall
  const rain = (() => { const pos = []; for (let i = 0; i < 900; i++) { const x = -10 + Math.random() * 26, z = (Math.random() - 0.5) * 22, y = Math.random() * 12, l = 0.5 + Math.random() * 0.4; pos.push(x, y, z, x + 0.12 * l, y - l, z); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); const m = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xa8bcd8, transparent: true, opacity: 0.55 })); m.frustumCulled = false; S.add(m); return m; })();
  // the three lights that stand over the field in the fog, a little south of the camp, and small coloured ones adrift round them
  const tri = [[-0.9, 6.6, 5.2], [1.9, 6.6, 5.6], [0.6, 7.0, 3.4]].map((p) => { const s = sprite(glowTex(), 0xfff3d6, 4.2, { fog: false }); s.position.set(...p); S.add(s); return s; });
  const orbs = [0xffffff, 0xffb060, 0xff4a2a, 0xffd9a0, 0xff9a40].map((c, i) => { const s = sprite(glowTex(), c, 0.7, { fog: false }); S.add(s); s.userData.i = i; return s; });
  const cam = new THREE.PerspectiveCamera(56, 1, 0.1, 800);
  const tmp = V(0, 0, 0), GATE = V(10.2, 0, 0.3);
  function apply(kind, t) {
    const fog = S.fog, home = kind === 'home', cold = kind === 'cold', wet = kind === 'rain', gold = kind === 'gold';
    fog.density = gold ? 0.03 : wet ? 0.03 : 0.006; fog.color.setHex(gold ? 0x141a20 : wet ? 0x0a0e14 : 0x05080e);   // (the fog thinner and darker than it was, so the one standing in it and the lights above read inside the bead) S.background.copy(fog.color);
    sky.visible = !gold && !wet; rain.visible = wet; laserG.visible = cold || gold; yard.visible = !gold;
    hemi.intensity = gold ? 2.2 : 1.9; skyL.intensity = gold ? 60 + 16 * Math.sin(t * 0.9) : 0;
    for (const s of tri) { s.visible = gold; s.material.opacity = 0.7 + 0.25 * Math.sin(t * 0.9 + s.position.x); }
    for (const o of orbs) { o.visible = gold; const i = o.userData.i; o.position.set(0.5 + Math.sin(t * 0.31 + i * 1.3) * 4.5, 6.5 + Math.sin(t * 0.47 + i * 2.1) * 2.2, 2.6 + Math.cos(t * 0.23 + i) * 3.5); o.material.opacity = 0.35 + 0.3 * Math.sin(t * 1.7 + i * 2.4); }
    chairs.forEach((c) => { c.visible = !home; c.rotation.z = 0; }); blanket.visible = table.visible = tableTorch.visible = !home;
    if (wet) { rain.position.y = -((t * 13) % 6); chairs[1].rotation.z = 1.45; chairs[3].rotation.z = -1.4; tableTorch.visible = false; }
    // cars
    if (home) {
      const T0 = 2.6;
      cars.forEach((c, i) => { const go = T0 + i * 2.8, p = paths[i](Math.max(0, t - go)), on = t > go - 1.0 ? 1 : 0; c.g.position.set(p[0], 0, p[1]); c.g.rotation.y = p[2]; c.set(on ? 0 : 1, on, c01((go - 1.7 - t) / 0.7)); });
      carL.intensity = t < T0 - 1.0 ? 26 : 0; carL2.intensity = t < T0 + 1.8 ? 26 : 0;
    } else {
      cars.forEach((c, i) => { c.g.position.set(CAR0[i].x, 0, CAR0[i].z); c.g.rotation.y = CAR0[i].r; c.set(1, 0, 1); });
      carL.intensity = carL2.intensity = gold ? 10 : 26;
    }
    carL.position.set(cars[0].g.position.x - 1.3, 1.3, cars[0].g.position.z); carL2.position.set(cars[1].g.position.x - 1.3, 1.3, cars[1].g.position.z);
    // people
    people.forEach((p, i) => {
      const s = SEATS[i - 1];
      if (home) {
        // at the open doors; then inside, before the cars pull out
        const c = i < 2 ? 0 : 1, at = CAR0[c], gone = t > 1.2 + c * 2.8 + (i % 2) * 0.5;
        place(p, at.x - 1.75, at.z + (i % 2 ? 0.75 : -0.45) + (i === 4 ? -1.0 : 0), PI / 2); p.visible = !gone;
        pose(p, standP({ head: 0.15, lean: gone ? 0.5 : 0.1 }));
      } else if (wet) {
        // up and running for the gate and the cars, one after another
        const c = i % 2, from = i ? V(s.x, 0, s.z) : V(0.55, 0, 1.3), to = V(CAR0[c].x - 1.8, 0, CAR0[c].z + (i > 2 ? 0.7 : -0.4));
        const u = c01((t - 0.3 - i * 0.3) / (3.4 + i * 0.2)), ph = t * 10 + i * 1.7, k1 = 0.74;
        if (u < k1) tmp.lerpVectors(from, GATE, u / k1); else tmp.lerpVectors(GATE, to, (u - k1) / (1 - k1));
        const aim = u < k1 ? GATE : to; place(p, tmp.x, tmp.z, Math.atan2(aim.x - tmp.x, aim.z - tmp.z)); p.visible = u < 0.985;
        pose(p, u <= 0 ? (i ? sitP({ head: -0.5 }) : lieP()) : runP(ph, i === 2 ? { shL: -2.7, shR: -2.7, elL: -0.5, elR: -0.5, out: 0.25 } : {}));
      } else if (i === 0) {
        // the man: on his back on the blanket looking up; in the fog, on his feet a little way south, alone
        if (gold) { place(p, 0.8, 4.6, 0.15); pose(p, standP({ head: -0.62, lean: -0.06, shL: 0.02, shR: 0.02 })); }
        else { place(p, 0.55, 2.2, PI); pose(p, lieP({ shR: cold ? -1.2 - 0.3 * Math.sin(t * 0.37) : 0.1, elR: cold ? -0.4 : 0 })); }
      } else {
        // in the ring. cold: one shakes with laughing, one drinks; gold: all of them still, heads sunk
        const tc = t % 24, laugh = cold && i === 1 ? c01(1 - Math.abs(tc - 5) / 1.6) : 0, drink = cold && i === 3 ? sst(13.5, 14.3, tc) * (1 - sst(15.6, 16.4, tc)) : 0;
        place(p, s.x, s.z, s.ry);
        pose(p, sitP({ head: gold ? 0.5 : -0.1 + laugh * 0.3 * Math.sin(t * 17) - (cold && i === 2 ? 0.4 : 0), lean: -0.08 + laugh * (0.18 + 0.06 * Math.sin(t * 17)) + (gold ? 0.14 : 0),
          shR: -0.5 - drink * 1.0, elR: -0.9 - drink * 1.5, turn: cold && i === 4 ? 0.5 * Math.sin(t * 0.5) : 0 }));
      }
    });
    torches.forEach((s, j) => { const p = people[j ? 4 : 2]; s.visible = p.visible && !home && !gold; s.position.set(p.position.x + Math.sin(p.rotation.y) * 0.35, wet ? 1.0 : 0.72, p.position.z + Math.cos(p.rotation.y) * 0.35); });
    // the laser: in the man's raised hand, sweeping the sky to the south and east; in the fog it lies in the grass where he let it fall
    if (cold) { laserG.position.set(0.85, 0.5, 1.75); laserG.rotation.set(0.45 + 0.3 * Math.sin(t * 0.37), 0, -0.35 - 0.3 * Math.sin(t * 0.52)); }
    if (gold) { laserG.position.set(0.3, 0.05, 3.9); laserG.rotation.set(1.5, 0, 0.3); }
    // the eye that watches each version: from the field's west side, looking across the camp to the gate and the cars
    if (gold) { const k = 0.5 - 0.5 * Math.cos(t * 0.2); cam.position.set(-4.6 + k * 1.2, 1.45, 2.2 + k * 0.6); cam.lookAt(0.8, 2.3 + k * 0.4, 4.4); }
    else if (home) { cam.position.set(1.5, 1.5, 3.4); cam.lookAt(13.5, 1.2, -6); }
    else { cam.position.set(-6.6 + Math.sin(t * 0.2) * 0.25, 1.45, 3.6); cam.lookAt(3, cold ? 1.5 : 1.0, -0.4); }
  }
  return { scene: S, cam, apply, LOOP: { home: 15, rain: 7.5 } };
}

// ---------- the loom ----------
const THREAD_V = `
attribute vec3 aTan; attribute float aSide; attribute float aS; attribute vec3 aCol;
uniform float uTime; uniform float uW; uniform float uSway;
varying float vS; varying float vSide; varying vec3 vCol;
void main() {
  vec3 p = position;
  float bow = sin(aS * 3.14159);
  p.x += sin(uTime * 0.7 + aS * 5.0 + aCol.r * 20.0) * uSway * bow;
  p.z += cos(uTime * 0.53 + aS * 4.0 + aCol.g * 20.0) * uSway * bow;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vec3 v = normalize(cameraPosition - w.xyz);
  vec3 s = normalize(cross(aTan, v));
  float d = distance(cameraPosition, w.xyz);
  w.xyz += s * aSide * max(uW, d * 0.0013);
  vS = aS; vSide = aSide; vCol = aCol;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const THREAD_F = `
uniform float uTime; uniform vec3 uColor; uniform float uUseCol; uniform float uGold; uniform float uGoldAt; uniform float uFray; uniform float uLevel;
varying float vS; varying float vSide; varying vec3 vCol;
float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
void main() {
  float x = abs(vSide);
  float core = exp(-x * x * 5.0) * 0.55 + exp(-x * x * 40.0) * 0.9;
  vec3 c = mix(uColor, vCol, uUseCol);
  float flow = 0.6 + 0.4 * sin(vS * 80.0 - uTime * 2.4 + c.r * 9.0);
  float gk = clamp((uGold * 1.25 - abs(vS - uGoldAt)) / 0.1, 0.0, 1.0);          // gold running along it from one point
  c = mix(c * flow, vec3(1.0, 0.74, 0.28) * (1.5 + 0.25 * sin(vS * 40.0 - uTime * 1.2)), gk);
  // fraying: it comes apart in lengths, top first, each length dimming to an ember before it goes
  float seg = floor(vS * 90.0), n = h1(seg) * 0.55 + (1.0 - vS) * 0.45;
  float keep = smoothstep(uFray * 1.25 - 0.22, uFray * 1.25, n);
  c = mix(vec3(0.7, 0.22, 0.08), c, smoothstep(uFray * 1.25, uFray * 1.25 + 0.25, n));
  gl_FragColor = vec4(c * core * keep * uLevel, 1.0);
}`;
// A glass ball with a live night in it: the world seen through the ball is magnified in the middle and drawn in toward
// the rim, each colour bent a little differently there (red, green and blue read at three radii); a soft glow in the
// thread's colour fills it from inside; at the rim the glass turns to a mirror of the dark hall and a thin bright edge;
// two glints, one sharp and one broad. The view is brightened with a soft shoulder so night scenes read.
const BEAD = `
uniform sampler2D uMap; uniform vec3 uTint; uniform float uOn; uniform float uGold;
void main() {
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n, v), 0.0), fres = pow(1.0 - ndv, 3.0);
  vec2 q = normalize(vVN).xy; float r = length(q);
  vec2 base = q * (0.36 + 0.13 * r * r), ca = q * 0.014 * r * r;
  vec3 world = vec3(texture2D(uMap, 0.5 + base * 1.03 + ca).r, texture2D(uMap, 0.5 + base).g, texture2D(uMap, 0.5 + base * 0.97 - ca).b);
  world = pow(world, vec3(0.4545)); world = world * 1.45 / (1.0 + 0.3 * world);
  float flick = step(0.15, uOn) + (1.0 - step(0.15, uOn)) * step(0.5, fract(uTime * 9.0)) * uOn * 6.0;   // a last stutter as it goes out
  vec3 col = world * uOn * min(1.0, flick) * smoothstep(1.0, 0.82, r);
  vec3 tint = mix(uTint, vec3(1.0, 0.76, 0.3), uGold);
  col += tint * (0.03 + 0.09 * (1.0 - r * r)) * (0.35 + 0.65 * uOn);
  vec3 rf = reflect(-v, n);
  vec3 env = mix(vec3(0.015, 0.02, 0.03), vec3(0.1, 0.13, 0.18), smoothstep(-0.3, 0.9, rf.y));
  col = mix(col, env + tint * (0.2 + 0.4 * uOn), fres * 0.8);
  col += tint * pow(1.0 - ndv, 7.0) * (0.4 + 0.6 * uOn);
  col += vec3(1.0) * pow(max(dot(rf, normalize(vec3(-0.3, 0.9, 0.3))), 0.0), 90.0) * 1.2;
  col += vec3(0.75, 0.85, 1.0) * pow(max(dot(rf, normalize(vec3(0.6, 0.35, 0.7))), 0.0), 14.0) * 0.1;
  gl_FragColor = vec4(col, 1.0);
}`;
// the weaver stands over the basin's edge on a disc; the worked threads pass in an arc before them
const WEAVER_POS = V(-1.75, -0.55, 1.2), WEAVER_YAW = 1.49, WEAVER_SCALE = 1.12, GATHER_Y = 5.6, TOP_Y = 10.2;
const TH_COL = [0x66d6ff, 0xb58cff, 0xff7fa8, 0xf2ead0, 0x7dffb0, 0xffa25e, 0x8fa8ff];
const GOLD = 3;
// thread i: which arm works it (by the arm's s), where its hook rests in the weaver's own frame
const TH_DEF = [
  { s: -3, az: -0.92, r: 1.12, y: 1.1 }, { s: -2, az: -0.6, r: 1.08, y: 1.32 }, { s: -1, az: -0.3, r: 0.74, y: 1.68 }, { s: 0, az: 0, r: 0.82, y: 1.3 },
  { s: 1, az: 0.3, r: 0.74, y: 1.68 }, { s: 2, az: 0.6, r: 1.08, y: 1.32 }, { s: 3, az: 0.92, r: 1.12, y: 1.1 }];
const BEAD_DEF = [{ th: 0, kind: 'home', f: 0.2 }, { th: 2, kind: 'cold', f: 0.36 }, { th: GOLD, kind: 'gold', f: 0.13 }, { th: 5, kind: 'rain', f: 0.27 }];
const BEAD_R = 0.13;

function buildLoom(hall, { still = false } = {}) {
  const g = hall.g, wFrame = new THREE.Object3D(); wFrame.position.copy(WEAVER_POS); wFrame.rotation.y = WEAVER_YAW; wFrame.scale.setScalar(WEAVER_SCALE); wFrame.updateMatrixWorld(true);
  const wPt = (x, y, z) => wFrame.localToWorld(V(x, y, z));
  // fine threads: the whole standing warp, from all over the basin up into the dark
  {
    const NT = 84, NP = 22, n = NT * NP * 2, pos = new Float32Array(n * 3), tan = new Float32Array(n * 3), side = new Float32Array(n), ss = new Float32Array(n), col = new Float32Array(n * 3), idx = [];
    const p = V(0, 0, 0), q = V(0, 0, 0), c = new THREE.Color(), pt = (b, th0, rr, u, o) => {
      const y = lerp(BASIN_Y, TOP_Y, u), k = sst(0, 1, c01((y - BASIN_Y) / (GATHER_Y - BASIN_Y))), tw = c01((y - GATHER_Y) / (TOP_Y - GATHER_Y));
      const r = lerp(rr, 0.34 + (rr / 1.9) * 0.2, k) * (1 - tw * 0.75), a = th0 + tw * 4.5 + k * 0.5;
      return o.set(Math.cos(a) * r, y, Math.sin(a) * r);
    };
    for (let t = 0; t < NT; t++) {
      const th0 = Math.random() * TAU, rr = 0.25 + Math.sqrt(Math.random()) * 1.6;
      c.setHSL(0.5 + Math.random() * 0.3, 0.6, 0.5 + Math.random() * 0.2);
      for (let i = 0; i < NP; i++) {
        const u = i / (NP - 1); pt(t, th0, rr, u, p); pt(t, th0, rr, Math.min(1, u + 0.01), q); q.sub(pt(t, th0, rr, Math.max(0, u - 0.01), V(0, 0, 0))).normalize();
        for (let s = 0; s < 2; s++) { const v = (t * NP + i) * 2 + s; pos.set([p.x, p.y, p.z], v * 3); tan.set([q.x, q.y, q.z], v * 3); side[v] = s ? 1 : -1; ss[v] = u; col.set([c.r * 0.5, c.g * 0.5, c.b * 0.5], v * 3); }
        if (i < NP - 1) { const a = (t * NP + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aTan', new THREE.BufferAttribute(tan, 3)); geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aS', new THREE.BufferAttribute(ss, 1)); geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3)); geo.setIndex(idx);
    var warpU = { uTime: TIME, uW: { value: 0.0022 }, uSway: { value: 0.03 }, uColor: { value: new THREE.Color(1, 1, 1) }, uUseCol: { value: 1 }, uGold: { value: 0 }, uGoldAt: { value: 0 }, uFray: { value: 0 }, uLevel: { value: still ? 0.16 : 0.5 } };
    const warp = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: THREAD_V, fragmentShader: THREAD_F, uniforms: warpU, ...ADD, side: THREE.DoubleSide })); warp.frustumCulled = false; warp.renderOrder = 4; g.add(warp);
  }
  // the worked threads: each a ribbon through its own run of points (basin, hook, bead, the gathering ring, the top)
  const NP = 60, threads = TH_DEF.map((d, i) => {
    const n = NP * 2, geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), tan = new Float32Array(n * 3), side = new Float32Array(n), ss = new Float32Array(n), idx = [];
    for (let j = 0; j < NP; j++) { side[j * 2] = -1; side[j * 2 + 1] = 1; ss[j * 2] = ss[j * 2 + 1] = j / (NP - 1); if (j < NP - 1) { const a = j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('aTan', new THREE.BufferAttribute(tan, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1)); geo.setAttribute('aS', new THREE.BufferAttribute(ss, 1)); geo.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); geo.setIndex(idx);
    const U = { uTime: TIME, uW: { value: 0.0085 }, uSway: { value: 0 }, uColor: { value: dcol(TH_COL[i]) }, uUseCol: { value: 0 }, uGold: { value: 0 }, uGoldAt: { value: 0.3 }, uFray: { value: 0 }, uLevel: { value: 1 } };
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: THREAD_V, fragmentShader: THREAD_F, uniforms: U, ...ADD, side: THREE.DoubleSide })); mesh.frustumCulled = false; mesh.renderOrder = 5; g.add(mesh);
    const rest = wPt(Math.sin(d.az) * d.r, d.y, Math.cos(d.az) * d.r);
    const B = V(rest.x * 0.86, BASIN_Y + 0.005, rest.z * 0.86), ga = i / 7 * TAU;
    return { i, d, U, mesh, pos, tan, rest, B, H: rest.clone(), H2: null, Hv: V(0, 0, 0), G: V(Math.cos(ga) * 0.2, GATHER_Y, Math.sin(ga) * 0.2), ga, slack: i === GOLD ? 1 : 0.35, vib: 0, vibT: 0, bead: null, held: false, pts: [], gone: false };
  });
  // one thread's points for this frame
  const _a = V(0, 0, 0), _b = V(0, 0, 0), _c = V(0, 0, 0), sag = V(0, 0, 0);
  const lay = (th, t) => {
    const cps = [th.B, th.H]; if (th.H2) cps.push(th.H2); if (th.bead && !th.bead.off) cps.push(th.bead.pos); cps.push(th.G);
    const nSeg = cps.length - 1, per = Math.floor(38 / nSeg); let j = 0;
    sag.set(Math.cos(th.ga * 3 + 1), -0.35, Math.sin(th.ga * 3 + 1));
    for (let s = 0; s < nSeg; s++) {
      const p0 = cps[s], p1 = cps[s + 1], L = p0.distanceTo(p1), n = s === nSeg - 1 ? 38 - per * (nSeg - 1) : per;
      for (let i = 0; i < n; i++, j++) {
        const u = i / n, bow = Math.sin(u * PI);
        _a.lerpVectors(p0, p1, u).addScaledVector(sag, th.slack * L * 0.05 * bow + th.slack * 0.012 * bow * Math.sin(t * 0.9 + th.i + u * 3));
        if (th.vib > 0.0005) _a.addScaledVector(sag, bow * th.vib * Math.sin(th.vibT * 46 + s));
        th.pos[j * 6] = th.pos[j * 6 + 3] = _a.x; th.pos[j * 6 + 1] = th.pos[j * 6 + 4] = _a.y; th.pos[j * 6 + 2] = th.pos[j * 6 + 5] = _a.z;
      }
    }
    // from the gathering ring up: all of them wind round one another into the dark
    for (let i = 0; j < NP; i++, j++) { const u = i / (NP - 39), a = th.ga + u * 4.5, r = 0.2 * (1 - u * 0.8); th.pos[j * 6] = th.pos[j * 6 + 3] = Math.cos(a) * r; th.pos[j * 6 + 1] = th.pos[j * 6 + 4] = lerp(GATHER_Y, TOP_Y, u); th.pos[j * 6 + 2] = th.pos[j * 6 + 5] = Math.sin(a) * r; }
    for (let k = 0; k < NP; k++) { const a = Math.max(0, k - 1) * 6, b = Math.min(NP - 1, k + 1) * 6; _b.set(th.pos[b] - th.pos[a], th.pos[b + 1] - th.pos[a + 1], th.pos[b + 2] - th.pos[a + 2]).normalize(); th.tan.set([_b.x, _b.y, _b.z, _b.x, _b.y, _b.z], k * 6); }
    th.mesh.geometry.attributes.position.needsUpdate = true; th.mesh.geometry.attributes.aTan.needsUpdate = true;
  };
  // where a bead hangs when nobody is looking at it: part of the way from the hook to the gathering ring
  const beadRest = (b, o) => { const th = b.th; if (!th.H2) return o.lerpVectors(th.H, th.G, b.f);
    const l1 = th.H.distanceTo(th.H2), l2 = th.H2.distanceTo(th.G), d = b.f * (l1 + l2); return d < l1 ? o.lerpVectors(th.H, th.H2, d / l1) : o.lerpVectors(th.H2, th.G, (d - l1) / l2); };
  // beads: glass with a world in it
  const world = still ? null : buildFieldWorld();
  const beadG = new THREE.SphereGeometry(BEAD_R, 40, 28);
  const beads = still ? [] : BEAD_DEF.map((d, i) => {
    // (512 px with mipmaps: sharp up close, no shimmer when small; two samples of multisampling for clean edges. Only one
    // or two of the four are drawn in any frame.)
    const th = threads[d.th], rt = new THREE.WebGLRenderTarget(512, 512, { samples: 2, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter }); LIVE_RT.add(rt);
    const U = { uMap: { value: rt.texture }, uTint: { value: dcol(TH_COL[d.th]) }, uOn: { value: 1 }, uGold: { value: 0 } };
    const mesh = new THREE.Mesh(beadG, sm(BEAD, U)); mesh.renderOrder = 6; g.add(mesh);
    const glow = sprite(glowTex(), TH_COL[d.th], 0.5, { opacity: 0.35 }); mesh.add(glow);
    const b = { i, th, kind: d.kind, f: d.f, k: 0, pos: V(0, 0, 0), rest: V(0, 0, 0), focusP: V(0, 0, 0), rt, U, mesh, glow, seen: false, off: false, t0: Math.random() * 10 };
    th.bead = b; beadRest(b, b.pos); mesh.position.copy(b.pos);
    return b;
  });
  let rr = 0;
  const drawWorlds = (t, focus) => {
    if (!world || E.noRender) return;
    const r = E.renderer, hold = window.__view; window.__view = null;   // a test camera set by tools/shot.js must not be applied to these
    const live = beads.filter((b) => !b.off && b.U.uOn.value > 0.01), list = []; if (focus && live.includes(focus)) list.push(focus);
    if (live.length) { const o = live[rr++ % live.length]; if (o !== focus) list.push(o); }
    for (const b of list) { const L = world.LOOP[b.kind]; world.apply(b.kind, L ? (t + b.t0) % L : t + b.t0); r.setRenderTarget(b.rt); r.render(world.scene, world.cam); }
    r.setRenderTarget(null); window.__view = hold;
  };
  const freeBeads = () => { for (const b of beads) { b.rt.dispose(); LIVE_RT.delete(b.rt); } };
  return { threads, beads, lay, beadRest, drawWorlds, freeBeads, warpU, wPt, wFrame, world };
}

// ---------- mantis arms: a two-bone reach with the elbow steered, for a mantis with more arms than two ----------
const UPV = V(0, 1, 0), _P2 = V(0, 0, 0), _S = V(0, 0, 0), _W = V(0, 0, 0), _E = V(0, 0, 0), _D = V(0, 0, 0), _P = V(0, 0, 0), _mq = new THREE.Quaternion(), DOWN = V(0, -1, 0), TIPV = V(0, -0.367, -0.048), TIPN = TIPV.clone().normalize();
function aimBone(b, from, to, axis) { b.parent.getWorldQuaternion(_mq).invert(); _D.subVectors(to, from).normalize().applyQuaternion(_mq); b.quaternion.setFromUnitVectors(axis, _D); b.updateMatrixWorld(true); }
// the tip of the arm's middle hook onto a world point; pole: the way the elbow leans, in the body's frame; down: how steeply
// the hook comes onto the point (0 level, 1 straight down)
function armTo(m, a, target, pole, down = 0.45) {
  const u = m.userData, sc = m.scale.x, la = (a.la || 0.52) * sc, lb = (a.lb || 0.5) * sc, lt = TIPV.length() * sc;
  a.sh.getWorldPosition(_S);
  _D.subVectors(target, _S); _D.y = 0; if (_D.lengthSq() < 1e-8) _D.set(0, 0, 1); _D.normalize().multiplyScalar(Math.sqrt(1 - down * down)); _D.y = -down;
  _W.copy(target).addScaledVector(_D, -lt);
  const d = Math.min(la + lb - 0.002, Math.max(Math.abs(la - lb) + 0.01, _S.distanceTo(_W)));
  const along = _D.subVectors(_W, _S).normalize(), x = (la * la + d * d - lb * lb) / (2 * d), h = Math.sqrt(Math.max(0, la * la - x * x));
  if (a.nrm) {
    // an extra arm: the elbow goes the way that takes the upper arm furthest out of the robe (the robe's outward normal at the
    // shoulder, square to the reach); when the reach itself runs along that normal, round toward the pole (back) as well
    // The elbow's way is written P = cos f e1 + sin f e2 in the plane square to the reach (e1 level, e2 = along x e1); f is
    // the one nearest the normal, then held so the elbow keeps near its shoulder's height (|P.y| <= 0.2): above are the
    // main arms' shoulders and sleeves, below the other extra pair.
    _P.copy(a.nrm).transformDirection(u.root.matrixWorld);
    _P2.crossVectors(along, UPV); if (_P2.lengthSq() < 1e-6) _P2.set(1, 0, 0); _P2.normalize();
    const e2 = _E.crossVectors(along, _P2), f = Math.atan2(_P.dot(e2), _P.dot(_P2)), lim = e2.y ? Math.min(1, 0.2 / Math.abs(e2.y)) : 1;
    let sf = Math.sin(f), cf = Math.cos(f);
    // which side the elbow keeps when held level: changed only when clearly on the other side (no flip-flop near straight up)
    if (!a.cfSide || Math.abs(cf) > 0.25) a.cfSide = Math.sign(cf) || 1;
    if (Math.abs(sf) > lim) { sf = Math.sign(sf) * lim; cf = a.cfSide * Math.sqrt(1 - sf * sf); }
    _P.copy(_P2).multiplyScalar(cf).addScaledVector(e2, sf);
    // eased from last frame's way (the best way can swing fast where the reach turns past the normal: followed at once it
    // popped the elbow 4-8 cm in a frame)
    if (a.Pv) { _P.multiplyScalar(0.18).addScaledVector(a.Pv, 0.82); _P.addScaledVector(along, -_P.dot(along)); if (_P.lengthSq() < 1e-8) _P.copy(a.Pv); _P.normalize(); }
    (a.Pv || (a.Pv = V(0, 0, 0))).copy(_P);
  } else { _P.copy(pole).transformDirection(u.root.matrixWorld); _P.addScaledVector(along, -_P.dot(along)); }
  if (_P.lengthSq() < 1e-8) _P.set(0, -1, 0); _P.normalize();
  _E.copy(_S).addScaledVector(along, x).addScaledVector(_P, h);
  aimBone(a.sh, _S, _E, DOWN); a.el.getWorldPosition(_E); aimBone(a.el, _E, _W, DOWN); a.wr.getWorldPosition(_W); aimBone(a.wr, _W, target, TIPN);
}
const armTip = (a, o) => a.wr.localToWorld(o.copy(TIPV));
// the robe's outline at height y in the body's frame (models.js ROBE), for placing the lower shoulders on its surface
// and for the clearance check
const ROBE = [[0, 0.5], [0.15, 0.46], [0.5, 0.375], [0.9, 0.305], [1.25, 0.262], [1.5, 0.25], [1.68, 0.256], [1.8, 0.238], [1.88, 0.18], [1.94, 0.09], [1.975, 0.0]];
const robeR = (y) => { for (let i = 1; i < ROBE.length; i++) if (y <= ROBE[i][0]) { const [y0, r0] = ROBE[i - 1], [y1, r1] = ROBE[i]; return r0 + (r1 - r0) * (y - y0) / (y1 - y0); } return 0; };
const robeAt = (y, th) => { const r = robeR(y); return V(Math.sin(th) * r * (1 + 0.2 * sst(1.2, 1.7, y)), y, Math.cos(th) * r * 0.8); };
// how far outside the robe a point in the body's frame is (negative: inside); the robe's folds stand up to 3 cm proud low down
const robeGap = (p) => { if (p.y > 1.97 || p.y < 0) return 1; const r = robeR(p.y) + 0.03 * (1 - sst(0.1, 1.45, p.y)), ax = r * (1 + 0.2 * sst(1.2, 1.7, p.y)), az = r * 0.8, k = Math.hypot(p.x / ax, p.z / az); return (k - 1) * Math.min(ax, az); };
// robe colours for a mantis: cloth, its glow, the lining
function robe(m, cloth, glow, lining, sheen) {
  const u = m.userData; u.robeMat.color.setHex(cloth); u.robeMat.emissive.setHex(glow); if (sheen) u.robeMat.sheenColor.setHex(sheen);
  m.traverse((o) => { const mm = o.material; if (!o.isMesh || !mm || !mm.color) return;
    if (mm.color.getHex() === 0x6a2a9e) { const c = mm.clone(); c.color.setHex(lining); c.emissive.setHex(new THREE.Color(lining).multiplyScalar(0.3).getHex()); o.material = c; }
    else if (sheen && mm !== u.robeMat && mm.color === u.robeMat.color) mm.sheenColor.setHex(sheen); });
}
// The weaver: silver cloth that moves through red, blue and indigo, and six arms: the usual pair in their sleeves and two
// more pairs bare, coming out of the robe below them through gold-rimmed openings.
function makeWeaver() {
  const m = makeMantis(), u = m.userData; m.scale.setScalar(WEAVER_SCALE);
  robe(m, 0x9aa2b2, 0x08090d, 0x3a4458, 0xdfe6f4);
  const mats = [u.robeMat]; m.traverse((o) => { if (o.isMesh && o.material !== u.robeMat && o.material.color === u.robeMat.color) mats.push(o.material); });
  for (const mm of mats) { mm.iridescence = 1; mm.iridescenceIOR = 1.7; mm.iridescenceThicknessRange = [160, 620]; mm.roughness = 0.4; mm.metalness = 0.35; mm.sheenRoughness = 0.3; }
  const firstMesh = (o) => o.children.find((c) => c.isMesh), A0 = u.arms[0];
  const femur = firstMesh(A0.el), tibia = firstMesh(A0.wr), fings = A0.fing.map(firstMesh), skin = femur.material;
  const gold = std(0xe8b24c, { metalness: 0.9, roughness: 0.3, emissive: 0x1a1004 });
  // the extra arms' sleeves: the robe's own cloth (same colour object, so the colour shift carries), fitted, not hanging
  const sleeveM = u.robeMat.clone(); sleeveM.side = THREE.FrontSide; sleeveM.color = u.robeMat.color; sleeveM.emissive = u.robeMat.emissive;
  // Each extra arm is a whole limb: a rounded cloth shoulder set into the robe, a fitted sleeve over the upper arm to a
  // gold-edged cuff, a chitin knuckle at the elbow, a spined forearm (the raptorial femur) and the main arms' hooked hand.
  // Built along the bone's -y (shoulder->elbow 0.4, elbow->wrist 0.36: shorter than the main arms, so the extra arms stay
  // less folded on the threads near the body and their upper arms leave the robe well outward).
  const sleeveG = mergeGeos([
    [new THREE.SphereGeometry(0.05, 18, 12), M4(0, 0, 0)],
    [new THREE.CylinderGeometry(0.048, 0.038, 0.34, 18, 6, true), M4(0, -0.17, 0)],
    [new THREE.CylinderGeometry(0.042, 0.038, 0.035, 18, 1, true), M4(0, -0.348, 0)]]);
  // a little looseness in the cloth: soft creases running round the sleeve, deeper toward the cuff
  { const p = sleeveG.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, z); if (y > -0.02 || y < -0.33 || r < 1e-4) continue;
    const a = Math.atan2(x, z), k = 1 + 0.06 * sst(-0.05, -0.3, y) * Math.sin(a * 5 + y * 9) * (0.6 + 0.4 * Math.sin(y * 31)); p.setX(i, x * k); p.setZ(i, z * k); } sleeveG.computeVertexNormals(); }
  const cuffG = new THREE.TorusGeometry(0.041, 0.007, 8, 28).rotateX(PI / 2).translate(0, -0.366, 0);
  const knuckleG = mergeGeos([[new THREE.SphereGeometry(0.033, 16, 12), M4(0, 0, 0)], [new THREE.TorusGeometry(0.03, 0.006, 8, 20), M4(0, -0.03, 0, PI / 2)]]);
  // the forearm: a keeled, tapering segment with a row of spines along its inner (-z) edge, as on a mantis's femur
  const foreParts = [[new THREE.CylinderGeometry(0.031, 0.022, 0.36, 14, 4), M4(0, -0.18, 0)], [new THREE.SphereGeometry(0.024, 12, 8), M4(0, -0.36, 0)],
    [new THREE.CylinderGeometry(0.007, 0.004, 0.3, 6), M4(0, -0.17, 0.026, 0.03)]];
  for (let i = 0; i < 6; i++) { const y = -0.07 - i * 0.045, l = 0.03 - i * 0.003; foreParts.push([new THREE.ConeGeometry(0.0055, l, 6), M4(0, y, -0.026 - l / 2 + 0.004, -PI / 2 - 0.35)]); }
  const foreG = mergeGeos(foreParts);
  for (const a of u.arms) { a.reachK = 1; a.lvl = 1; }
  for (const [lvl, y, th] of [[2, 1.5, 0.9], [3, 1.27, 0.8]]) for (const s of [-1, 1]) {
    const at = robeAt(y, s * th), sh = new THREE.Group(); sh.position.set(at.x * 0.93, y, at.z * 0.93); u.root.add(sh);
    sh.add(new THREE.Mesh(sleeveG, sleeveM), new THREE.Mesh(cuffG, gold));
    const el = new THREE.Group(); el.position.y = -0.4; sh.add(el); el.add(new THREE.Mesh(foreG, skin), new THREE.Mesh(knuckleG, skin));
    const wr = new THREE.Group(); wr.position.y = -0.36; el.add(wr); wr.add(new THREE.Mesh(tibia.geometry, tibia.material));
    const fing = fings.map((f, i) => { const fg = new THREE.Group(); fg.position.set((i - 1) * 0.009, -0.26, 0); fg.add(new THREE.Mesh(f.geometry, f.material)); wr.add(fg); return fg; });
    const nrm = V(at.x / (0.264 * 0.264), 0, at.z / (0.209 * 0.209)).normalize();   // the robe's outward normal at the shoulder
    u.arms.push({ sh, el, wr, s: s * lvl, fing, reachK: 1, lvl, nrm, la: 0.4, lb: 0.36 });
  }
  // which way each arm's elbow leans (body frame): the top pair up and out; the extra pairs round the body toward the back,
// level with the shoulder (along the robe's horizontal tangent there, a little down): the robe curves away round the body,
// but widens below the extra shoulders and overhangs above them, so an elbow led down or up lays the sleeve along it.
// Folded, the same way and further down.
  for (const a of u.arms) { const s = Math.sign(a.s); a.pole = a.lvl === 1 ? V(s, 0.3, 0.1) : V(s * a.nrm.z, -0.15, -s * a.nrm.x); a.tip = V(0, 0, 0); a.home = a.lvl === 1 ? V(s * 0.2, 1.68, 0.6) : a.lvl === 2 ? V(s * 0.58, 1.06, 0.6) : V(s * 0.52, 0.84, 0.56);
    a.foldPole = a.lvl === 1 ? V(s, 0.15, 0) : V(s * a.nrm.z, -0.15, -s * a.nrm.x); a.poleNow = a.pole.clone(); }
  u.hooks = (a, c) => a.fing.forEach((f) => { f.rotation.x = 1.35 * c; });
  // red, then blue, then indigo, and round again, never leaving silver far behind
  // Each stop is a full colour of the cloth (rose, sapphire, indigo, silver), with a low glow of its own and a sheen a step
  // paler, so the change reads across the whole robe at once and not only at grazing angles; the thin-film shimmer is kept
  // but turned down so it no longer washes the colour back to silver. Each change takes about 7 s, eased.
  for (const mm of mats.concat([sleeveM])) { mm.iridescence = 0.45; mm.sheenColor = u.robeMat.sheenColor; mm.emissive = u.robeMat.emissive; mm.color = u.robeMat.color; }
  const hueStops = [0xc2607a, 0x4d74cc, 0x6249c4, 0xb2bac9].map((c) => new THREE.Color(c)), glowStops = [0x300a16, 0x08164a, 0x180c50, 0x0c0e14].map((c) => new THREE.Color(c)), sheenStops = [0xffb4c4, 0xa9c6ff, 0xc4abff, 0xe9eef8].map((c) => new THREE.Color(c));
  u.shift = (t) => { const x = (t * 0.14) % 4, i = Math.floor(x), k = sst(0.15, 0.85, x - i), j = (i + 1) % 4; u.robeMat.color.lerpColors(hueStops[i], hueStops[j], k); u.robeMat.emissive.lerpColors(glowStops[i], glowStops[j], k); u.robeMat.sheenColor.lerpColors(sheenStops[i], sheenStops[j], k); };
  return m;
}

// ---------- the weather console ----------
// A round table holding the land round the field in relief, 1 m to about 2 km, by night. Table frame: +z toward the middle
// of the hall (where you stand), +x to your right as you face it.
const TOP = 0.845, MAP_R = 0.8;
// 1 m of table is about 1 km. camp: the middle of the ring of chairs; the field lies round it as in the field itself
// (57 m by 74 m, the camp toward its south-east corner); the cloud forms to the south, so the mist comes north to the field.
const WX = { field: [0.08, 0.02], farm: [-0.16, -0.21], cloud: [0.12, 0.56] };
const FIELD_BOX = [WX.field[0] - 0.046, WX.field[1] - 0.052, WX.field[0] + 0.011, WX.field[1] + 0.022];
// the lane: north past the field's east fence, then bending away north-west below the farm
const LANE = [[0.13, 0.82], [0.105, 0.1], [0.1, -0.06], [-0.1, -0.27], [-0.5, -0.4], [-0.82, -0.44]];
const laneDist = (x, z) => { let d = 9; for (let i = 0; i < LANE.length - 1; i++) { const [ax, az] = LANE[i], [bx, bz] = LANE[i + 1], ex = bx - ax, ez = bz - az, t = c01(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)); d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t)); } return d; };
const bump = (x, z, cx, cz, s) => Math.exp(-((x - cx) * (x - cx) + (z - cz) * (z - cz)) / (s * s));
const landH = (x, z) => 0.06 * bump(x, z, 0.5, -0.5, 0.26) + 0.05 * bump(x, z, -0.15, -0.68, 0.28) + 0.045 * bump(x, z, 0.72, 0.15, 0.2) + 0.018 * bump(x, z, -0.24, -0.17, 0.16) + 0.04 * bump(x, z, -0.66, -0.2, 0.24)
  + 0.036 * bump(x, z, -0.55, 0.45, 0.25) + 0.03 * bump(x, z, 0.2, 0.7, 0.2) + 0.04 * bump(x, z, 0.62, 0.58, 0.2)
  + 0.003 * Math.sin(x * 13 + z * 5) * Math.sin(z * 11 - x * 3) - 0.005 * Math.exp(-(laneDist(x, z) * laneDist(x, z)) / 0.0006);
const LAND = `
uniform float uRain; uniform vec2 uFarm; uniform vec2 uField; uniform vec4 uBox; uniform float uCursor; uniform vec2 uCur; uniform float uFogged;
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 e = b - a; return length(p - a - e * clamp(dot(p - a, e) / dot(e, e), 0.0, 1.0)); }
float laneD(vec2 p) { return min(min(sdSeg(p, vec2(0.13, 0.82), vec2(0.105, 0.1)), sdSeg(p, vec2(0.105, 0.1), vec2(0.1, -0.06))), min(sdSeg(p, vec2(0.1, -0.06), vec2(-0.1, -0.27)), min(sdSeg(p, vec2(-0.1, -0.27), vec2(-0.5, -0.4)), sdSeg(p, vec2(-0.5, -0.4), vec2(-0.82, -0.44))))); }
void main() {
  vec2 p = vPos.xz; float h = vPos.y;
  vec2 q = p * 9.0 + vec2(noise2(p * 4.0), noise2(p * 4.0 + 7.0)) * 0.8;
  vec2 id = floor(q); vec2 f = fract(q); float d1 = 9.0, d2 = 9.0, cell = 0.0;
  for (float j = -1.0; j <= 1.0; j += 1.0) for (float i = -1.0; i <= 1.0; i += 1.0) {
    vec2 o = vec2(i, j); float h = hash2(id + o); vec2 c = o + vec2(h, fract(h * 17.3)) * 0.8 + 0.1 - f; float d = max(abs(c.x), abs(c.y)) * 0.6 + length(c) * 0.4;
    if (d < d1) { d2 = d1; d1 = d; cell = h; } else if (d < d2) d2 = d;
  }
  // each field is one of pasture, plough or stubble, its rows running its own way; the flocked surface of a model under it all
  float kind = fract(cell * 7.13), fine = noise2(p * 140.0) * 0.6 + noise2(p * 330.0) * 0.4;
  float ang = cell * 6.2831; vec2 dir = vec2(cos(ang), sin(ang)); float rows = 0.5 + 0.5 * sin(dot(p, dir) * 430.0);
  vec3 pasture = mix(vec3(0.045, 0.08, 0.042), vec3(0.068, 0.1, 0.05), fine);
  vec3 plough = mix(vec3(0.055, 0.042, 0.032), vec3(0.085, 0.064, 0.044), rows) * (0.85 + 0.3 * fine);
  vec3 stubble = mix(vec3(0.095, 0.085, 0.05), vec3(0.13, 0.115, 0.068), rows * 0.6 + fine * 0.4);
  vec3 col = kind < 0.45 ? pasture : kind < 0.75 ? plough : stubble;
  // hedgerows round every field, with trees standing in them here and there
  float edge = d2 - d1, hedge = smoothstep(0.075, 0.025, edge);
  float trees = smoothstep(0.55, 0.8, noise2(p * 90.0)) * smoothstep(0.07, 0.02, edge);
  col = mix(col, vec3(0.022, 0.038, 0.024) * (0.8 + 0.4 * fine), hedge * 0.85);
  col = mix(col, vec3(0.013, 0.027, 0.016), trees * 0.85);
  // woods on the high ground: a canopy of their own grain
  float wood = smoothstep(0.52, 0.72, noise2(p * 10.0 + 3.0)) * smoothstep(0.012, 0.03, h), canopy = noise2(p * 110.0) * 0.6 + noise2(p * 260.0) * 0.4;
  col = mix(col, vec3(0.016, 0.034, 0.02) * (0.65 + 0.7 * canopy), wood * 0.9);
  // light: a low moon from the far left, a cool fill from above, the hollows a little darker
  vec3 n = flatN(); n *= sign(n.y);
  col *= 0.42 + 1.3 * clamp(dot(n, normalize(vec3(-0.6, 0.55, -0.35))), 0.0, 1.0) + 0.15 * n.y;
  col *= 0.8 + 0.4 * smoothstep(0.0, 0.05, h);
  float ct = abs(fract(h / 0.008) - 0.5);
  col += vec3(0.1, 0.4, 0.55) * smoothstep(0.1, 0.0, ct) * 0.05 * smoothstep(0.004, 0.014, h);   // contour lines, faint
  // the one field: a paler square inside its hedge
  vec2 fd = max(uBox.xy - p, p - uBox.zw); float fe = max(fd.x, fd.y), inF = smoothstep(0.002, -0.002, fe);
  col = mix(col, vec3(0.06, 0.085, 0.055), inF * 0.8);
  col *= 1.0 - 0.6 * smoothstep(0.004, 0.001, abs(fe));
  // rain on the one farm: the ground there goes dark and shines; the lane beyond its fence stays pale and dry
  float wet = uRain * smoothstep(0.075, 0.064, length(p - uFarm));
  col = mix(col, col * 0.4 + vec3(0.02, 0.04, 0.07) * pow(noise2(p * 190.0 + uTime * 2.5), 6.0) * 3.0, wet);
  // the lane: pale verges either side of a dark metalled road
  float ld = laneD(p);
  col = mix(col, vec3(0.08, 0.1, 0.06), smoothstep(0.009, 0.006, ld) * 0.6);
  col = mix(col, vec3(0.24, 0.235, 0.225) * (0.85 + 0.3 * fine), smoothstep(0.005, 0.0028, ld));
  col = mix(col, vec3(0.34, 0.38, 0.44), uFogged * smoothstep(0.13, 0.04, length(p - uField + vec2(0.0175, 0.015))) * 0.6);
  float cr = abs(length(p - uCur) - 0.06);
  col += vec3(1.0, 0.56, 0.16) * (smoothstep(0.005, 0.0, cr) + smoothstep(0.012, 0.0, length(p - uCur))) * uCursor;   // the ring the dome steers
  col *= smoothstep(0.8, 0.77, length(p));
  gl_FragColor = vec4(col * 1.35, 1.0);   // (night: the land dim, its kinds of field still told apart)
}`;
// The table's top ring: brushed dark metal, ticks cut round it every 5 degrees (longer every 30), small marks every 15, and
// a fine line of light let into it near the land.
const RIM = `
uniform vec3 uGlow;
void main() {
  vec2 p = vPos.xz; float r = length(p), a = atan(p.y, p.x);
  float brush = noise2(vec2(a * 60.0, r * 1400.0)) * 0.5 + noise2(vec2(a * 9.0, r * 300.0)) * 0.5;
  vec3 col = vec3(0.045, 0.05, 0.058) * (0.75 + 0.5 * brush);
  vec3 v = normalize(cameraPosition - vWorld); col += vec3(0.08, 0.1, 0.12) * pow(1.0 - abs(v.y), 3.0);
  float t5 = abs(fract(a / 0.0872665) - 0.5), t30 = abs(fract(a / 0.523599) - 0.5);
  float tick = smoothstep(0.06, 0.03, t5) * step(0.935, r) * step(r, 0.962) + smoothstep(0.018, 0.008, t30) * step(0.905, r) * step(r, 0.968);
  col = mix(col, vec3(0.01), tick * 0.8); col += uGlow * tick * 0.18;
  float dots = smoothstep(0.012, 0.0, length(vec2((fract(a / 0.261799) - 0.5) * r * 0.2618, r - 0.92)));
  col += uGlow * dots * 0.5;
  col += uGlow * smoothstep(0.0018, 0.0, abs(r - 0.865)) * 0.9;
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// The amber dome: thick glass lit from inside, slow currents moving in it, the old lines of latitude and longitude cut
// into it (they turn as it rolls), a bright rim and a glint.
const DOME = `
void main() {
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld); float ndv = max(dot(n, v), 0.0);
  vec3 lp = normalize(vPos);
  float sw = noise2(lp.xz * 3.0 + vec2(uTime * 0.12, -uTime * 0.09)) * 0.6 + noise2(lp.xy * 6.0 - uTime * 0.2) * 0.4;
  vec3 col = vec3(1.0, 0.5, 0.13) * (0.18 + 0.9 * pow(ndv, 1.6)) * (0.6 + 0.7 * sw);
  float lon = abs(fract(atan(lp.z, lp.x) / 6.2831 * 8.0) - 0.5), lat = abs(fract(lp.y * 2.5) - 0.5);
  col *= 1.0 - 0.6 * (smoothstep(0.03, 0.0, lon) + smoothstep(0.03, 0.0, lat));
  col += vec3(1.0, 0.68, 0.3) * pow(1.0 - ndv, 3.0) * 0.7;
  col += vec3(1.0) * pow(max(dot(reflect(-v, n), normalize(vec3(-0.3, 0.9, 0.3))), 0.0), 70.0) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}`;
const MIST = `
uniform float uAmt; uniform float uSeed;
void main() {
  float v = vUv.y * 2.0 - 1.0;
  float a = pow(max(0.0, 1.0 - v * v), 0.8) * smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.985, vUv.x);
  float n = noise2(vec2(vUv.x * 13.0 + uTime * 0.22 + uSeed, vUv.y * 4.0 + uSeed)) * 0.6 + noise2(vec2(vUv.x * 31.0 + uTime * 0.4, vUv.y * 9.0 - uSeed)) * 0.4;
  a *= 0.25 + 1.0 * n * n;
  gl_FragColor = vec4(vec3(0.4, 0.46, 0.55) * (0.55 + 0.6 * n), min(0.85, a * uAmt));
}`;
const BLANKET = `
uniform float uAmt;
void main() {
  vec2 q = vUv * 2.0 - 1.0; float r = length(q);
  float n = noise2(q * 4.0 + uTime * 0.1) * 0.6 + noise2(q * 9.0 - uTime * 0.16) * 0.4;
  float a = smoothstep(1.0, 0.45 + 0.3 * n, r) * (0.4 + 0.8 * n);
  gl_FragColor = vec4(vec3(0.42, 0.48, 0.57) * (0.55 + 0.6 * n), min(0.9, a * uAmt));
}`;
const RAIN_V = `
attribute float aSeed; attribute float aEnd; uniform float uTime; uniform float uTopY; uniform float uFall;
varying float vA;
void main() {
  vec3 p = position; float f = fract(uTime * 1.9 + aSeed);
  p.y = uTopY - f * uFall - aEnd * 0.014; p.x += aEnd * 0.003;
  vA = smoothstep(0.0, 0.15, f) * (1.0 - aEnd * 0.6);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const RAIN_F = `uniform float uAmt; varying float vA; void main() { gl_FragColor = vec4(vec3(0.55, 0.68, 0.85) * vA * uAmt, 1.0); }`;
const glyphTex = (seed) => canvasTex(64, 64, (g) => {
  let s = seed * 9301 + 49297; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  g.clearRect(0, 0, 64, 64); g.strokeStyle = '#fff'; g.lineWidth = 4; g.lineCap = 'round';
  for (let i = 0; i < 3; i++) { g.beginPath(); const x = 14 + rnd() * 36, y = 14 + rnd() * 36; if (rnd() < 0.4) g.arc(x, y, 5 + rnd() * 9, rnd() * 6, rnd() * 6 + 2.5); else { g.moveTo(x, y); g.lineTo(14 + rnd() * 36, 14 + rnd() * 36); } g.stroke(); }
  g.beginPath(); g.arc(12 + rnd() * 40, 12 + rnd() * 40, 2.5, 0, TAU); g.fillStyle = '#fff'; g.fill();
});
// a pad: a bezel, a key that sinks 6 mm when pressed, a mark on it that lights. Its own +y is the way out of the surface.
function makePad(seed, col = 0x49b8ea) {
  const g = new THREE.Group();
  const rounded = (w, h, r, bev) => new THREE.ExtrudeGeometry(roundedRect(w, w, r), { depth: h - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 6 }).rotateX(-PI / 2).translate(0, -h / 2 + bev, 0);
  g.add(new THREE.Mesh(rounded(0.084, 0.01, 0.012, 0.002), std(0x0c0e12, { metalness: 0.75, roughness: 0.35 })));
  const keyM = new THREE.MeshPhysicalMaterial({ color: 0x1b222b, metalness: 0.2, roughness: 0.4, clearcoat: 0.9, clearcoatRoughness: 0.15, emissive: col, emissiveIntensity: 0.05 });
  const key = new THREE.Mesh(rounded(0.068, 0.014, 0.01, 0.0025), keyM); key.position.y = 0.011; g.add(key);
  const markM = basic(col, { map: glyphTex(seed), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 });
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.056, 0.056).rotateX(-PI / 2), markM); mark.position.y = 0.0075; key.add(mark);
  const u = { key, down: 0, lit: 0,
    set(down, lit) { u.down = down; u.lit = lit; key.position.y = 0.011 - 0.006 * down; keyM.emissiveIntensity = 0.05 + 0.75 * lit; markM.opacity = 0.35 + 0.65 * lit; },
    top(o, lift = 0) { g.updateWorldMatrix(true, false); return g.localToWorld(o.set(0, 0.018 - 0.006 * u.down + lift, 0)); } };
  g.userData = u; return g;
}
function buildWeather(hall) {
  const tb = new THREE.Group(); tb.position.copy(polar(A_WEATHER, 8.5)); tb.rotation.y = A_WEATHER + PI; hall.g.add(tb);
  const lathe = (pts, n = 72) => new THREE.LatheGeometry(pts.map(([x, y]) => V2(x, y)), n);
  tb.add(new THREE.Mesh(lathe([[0, 0], [0.54, 0], [0.56, 0.035], [0.34, 0.1], [0.24, 0.2], [0.22, 0.5], [0.34, 0.66], [0.9, 0.765], [1.0, 0.8], [1.0, TOP], [0.97, TOP + 0.012], [0.84, TOP + 0.012], [0.82, TOP - 0.012], [0, TOP - 0.012]]), hall.dark));
  const lipM = basic(0x2f7fae), lip = new THREE.Mesh(new THREE.TorusGeometry(0.825, 0.005, 6, 120), lipM); lip.rotation.x = PI / 2; lip.position.y = TOP + 0.011; tb.add(lip);
  const rim = new THREE.Mesh(new THREE.RingGeometry(0.835, 0.968, 160, 1).rotateX(-PI / 2), sm(RIM, { uGlow: { value: dcol(0x3a9ad0) } })); rim.position.y = TOP + 0.0125; tb.add(rim);
  // a worked edge to the table: a rolled outer bead and a fine one under it
  for (const [r, y, w] of [[0.998, TOP - 0.004, 0.009], [0.975, 0.79, 0.006]]) { const b = new THREE.Mesh(new THREE.TorusGeometry(r, w, 8, 160), hall.metal); b.rotation.x = PI / 2; b.position.y = y; tb.add(b); }
  // the land
  const N = 120, geo = new THREE.PlaneGeometry(MAP_R * 2, MAP_R * 2, N, N).rotateX(-PI / 2), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { let x = p.getX(i), z = p.getZ(i); const r = Math.hypot(x, z); if (r > MAP_R) { x *= MAP_R / r; z *= MAP_R / r; } p.setXYZ(i, x, landH(x, z), z); }
  const landU = { uRain: { value: 0 }, uFarm: { value: V2(...WX.farm) }, uField: { value: V2(...WX.field) }, uBox: { value: new THREE.Vector4(...FIELD_BOX) }, uCursor: { value: 0 }, uCur: { value: V2(-0.35, 0.3) }, uFogged: { value: 0 } };
  const land = new THREE.Mesh(geo, sm(LAND, landU)); land.position.y = TOP; tb.add(land);
  const at = (x, z, up = 0) => V(x, TOP + landH(x, z) + up, z);
  // the farm: a few roofs and its yard light; the field: two cars' lights, three red torches, the green line of the laser
  const farmG = mergeGeos([[new THREE.BoxGeometry(0.014, 0.006, 0.008), M4(0, 0.003, 0)], [new THREE.BoxGeometry(0.008, 0.005, 0.012), M4(0.014, 0.0025, 0.006)], [new THREE.BoxGeometry(0.01, 0.004, 0.006), M4(-0.012, 0.002, 0.01)]]);
  const farm = new THREE.Mesh(farmG, basic(0x10151a)); farm.position.copy(at(WX.farm[0], WX.farm[1])); tb.add(farm);
  const yard = sprite(glowTex(), 0xffd29a, 0.03); yard.position.copy(at(WX.farm[0] + 0.006, WX.farm[1] + 0.008, 0.008)); tb.add(yard);
  const fieldL = new THREE.Group(); fieldL.position.copy(at(WX.field[0], WX.field[1], 0.004)); tb.add(fieldL);
  for (const [x, z, c, s] of [[0.0125, -0.004, 0xffd9a0, 0.018], [0.0125, 0.0037, 0xffd9a0, 0.018], [0, 0, 0xff3a22, 0.011], [-0.0017, -0.0005, 0xff3a22, 0.007], [-0.0012, 0.0012, 0xff3a22, 0.007]]) { const s2 = sprite(glowTex(), c, s); s2.position.set(x, 0, z); fieldL.add(s2); }
  const laser = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.3, 0.0012).translate(0, 0.15, 0), basic(0x38ff5a, ADD)); laser.position.set(0.0008, 0, 0.0017); fieldL.add(laser);
  // the cloud: puffs that come one after another out of clear air; something bright moves inside it now and then
  const cloud = new THREE.Group(); cloud.position.copy(at(WX.cloud[0], WX.cloud[1], 0.1)); tb.add(cloud);
  const puffs = []; for (let i = 0; i < 80; i++) { const a = Math.random() * TAU, d = Math.pow(Math.random(), 0.6), y = (Math.random() - 0.3) * 0.04 * (1 - d * 0.6);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex(), color: new THREE.Color().setHSL(0.6, 0.14, 0.34 + y * 9), transparent: true, depthWrite: false, opacity: 0 }));
    s.position.set(Math.cos(a) * d * 0.13, y, Math.sin(a) * d * 0.085); s.userData = { d: d * 0.6 + Math.random() * 0.2, size: 0.045 + Math.random() * 0.04 * (1 - d * 0.5) }; s.scale.setScalar(0.001); cloud.add(s); puffs.push(s); }
  const hid = sprite(glowTex(), 0xffe2b0, 0.06, { opacity: 0 }); cloud.add(hid);
  const setCloud = (k, t) => { for (const s of puffs) { const e = sst(0, 1, c01((k - s.userData.d) / 0.4)); s.scale.setScalar(Math.max(0.001, s.userData.size * e * (1 + 0.05 * Math.sin(t * 0.7 + s.userData.d * 30)))); s.material.opacity = 0.42 * e; }
    hid.material.opacity = k > 0.8 ? Math.max(0, Math.sin(t * 2.3) * Math.sin(t * 0.61)) * 0.55 : 0; hid.position.x = Math.sin(t * 0.4) * 0.05; };
  // the bank of mist: a pointed tongue that lies on the land and goes forward in a straight line
  const NU = 46, NV = 10, mg = new THREE.PlaneGeometry(1, 1, NU, NV);
  const mistU = [{ uAmt: { value: 0 }, uSeed: { value: 1.3 } }, { uAmt: { value: 0 }, uSeed: { value: 7.7 } }];
  const mists = mistU.map((U, i) => { const m = new THREE.Mesh(i ? mg.clone() : mg, sm(MIST, U, { transparent: true, depthWrite: false, side: THREE.DoubleSide })); m.frustumCulled = false; m.renderOrder = 7 + i; tb.add(m); return m; });
  const from = V2(WX.cloud[0] - 0.01, WX.cloud[1] - 0.05), toF = V2(WX.field[0] - 0.012, FIELD_BOX[3] + 0.004), dir = toF.clone().sub(from), run = dir.length(); dir.normalize();
  const perp = V2(-dir.y, dir.x);
  // prow: how far the point has gone (0..1 of the way to the field's hedge); len: the length of the bank behind it
  const setMist = (prow, amt) => {
    const L = Math.min(0.4, prow * run), hx = from.x + dir.x * prow * run, hz = from.y + dir.y * prow * run;
    mists.forEach((m, li) => { const pa = m.geometry.attributes.position; mistU[li].uAmt.value = amt * (li ? 0.8 : 1.15);
      for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) { const u = i / NU, v = j / NV * 2 - 1, s = (1 - u) * L, w = 0.07 * Math.min(1, Math.pow(s / 0.13, 0.62)) * (li ? 0.8 : 1);
        const x = hx - dir.x * s + perp.x * v * w, z = hz - dir.y * s + perp.y * v * w; pa.setXYZ(j * (NU + 1) + i, x, TOP + landH(x, z) + 0.006 + li * 0.008 + 0.014 * (1 - v * v) * Math.min(1, s / 0.05), z); }
      pa.needsUpdate = true; });
  };
  setMist(0, 0);
  const blanketU = { uAmt: { value: 0 } };
  const blanket = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2), sm(BLANKET, blanketU, { transparent: true, depthWrite: false })); blanket.position.copy(at(WX.field[0] - 0.0175, WX.field[1] - 0.015, 0.016)); blanket.scale.setScalar(0.001); blanket.renderOrder = 9; tb.add(blanket);
  // rain: a small dark cloud over the farm and streaks under it
  const rcloud = new THREE.Group(); rcloud.position.copy(at(WX.farm[0], WX.farm[1], 0.11)); tb.add(rcloud);
  const rp = []; for (let i = 0; i < 18; i++) { const a = Math.random() * TAU, d = Math.random(); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex(), color: 0x39404c, transparent: true, depthWrite: false, opacity: 0 })); s.position.set(Math.cos(a) * d * 0.065, (Math.random() - 0.5) * 0.02, Math.sin(a) * d * 0.065); s.userData.size = 0.04 + Math.random() * 0.035; s.scale.setScalar(0.001); rcloud.add(s); rp.push(s); }
  const rainU = { uTime: TIME, uTopY: { value: TOP + 0.115 }, uFall: { value: 0.1 }, uAmt: { value: 0 } };
  { const pos = [], seed = [], end = []; for (let i = 0; i < 150; i++) { const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * 0.07, x = WX.farm[0] + Math.cos(a) * d, z = WX.farm[1] + Math.sin(a) * d, s = Math.random(); pos.push(x, 0, z, x, 0, z); seed.push(s, s); end.push(0, 1); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1)); rg.setAttribute('aEnd', new THREE.Float32BufferAttribute(end, 1));
    const rl = new THREE.LineSegments(rg, new THREE.ShaderMaterial({ vertexShader: RAIN_V, fragmentShader: RAIN_F, uniforms: rainU, ...ADD })); rl.frustumCulled = false; rl.renderOrder = 8; tb.add(rl); }
  const setRain = (k) => { landU.uRain.value = sst(0.3, 1, k); rainU.uAmt.value = sst(0.25, 0.7, k) * 0.3; for (const s of rp) { s.scale.setScalar(Math.max(0.001, s.userData.size * sst(0, 0.5, k))); s.material.opacity = 0.6 * sst(0, 0.5, k); } };
  // controls on the rim, at the tall one's side: three pads and the amber dome
  const rimAt = (phi, r = 0.905) => V(Math.cos(phi) * r, TOP + 0.012, Math.sin(phi) * r);
  const pads = [-0.2, 0.04].map((phi, i) => { const pd = makePad(i + 3); pd.position.copy(rimAt(phi)); pd.rotation.y = -phi; tb.add(pd); return pd; });
  const domeT = canvasTex(128, 64, (g) => { g.fillStyle = '#ffb060'; g.fillRect(0, 0, 128, 64); g.strokeStyle = 'rgba(90,30,0,.55)'; g.lineWidth = 2; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16, 64); g.stroke(); } for (let j = 1; j < 4; j++) { g.beginPath(); g.moveTo(0, j * 16); g.lineTo(128, j * 16); g.stroke(); } });
  const domeM = sm(DOME); domeT.dispose();
  const domeSeat = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 28), hall.metal); domeSeat.rotation.x = PI / 2; domeSeat.position.copy(rimAt(-0.52)); tb.add(domeSeat);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.058, 28, 20), domeM); dome.position.copy(rimAt(-0.52)).y -= 0.012; tb.add(dome);
  const domeGlow = sprite(glowTex(), 0xff8a2a, 0.3, { opacity: 0.35 }); domeGlow.position.copy(dome.position).y += 0.03; tb.add(domeGlow);
  // a short lever with a T grip: it leans toward the middle of the table against a slow resistance, and springs back upright
  const lever = new THREE.Group(); lever.position.copy(rimAt(0.3, 0.92)); tb.add(lever);
  // turned so it goes over straight away from the tall grey (who stands at table-local (1.45, 0)): rotation.z tips the top
  // toward local -x, so local -x is set along grey -> lever; the T's crossbar (local z) is then square to the grey
  { const dx = lever.position.x - 1.45, dz = lever.position.z; lever.rotation.y = Math.atan2(dz, -dx); }
  const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.024, 16), hall.metal); boot.position.copy(lever.position).y += 0.006; tb.add(boot);
  // the shaft (worn metal), a ringed collar, a plain metal T bar across the top, and a ribbed rubber gaiter over its foot
  lever.add(new THREE.Mesh(mergeGeos([[new THREE.CylinderGeometry(0.0085, 0.011, 0.15, 14), M4(0, 0.085, 0)], [new THREE.TorusGeometry(0.0115, 0.0025, 6, 16), M4(0, 0.145, 0, PI / 2)], [new THREE.TorusGeometry(0.0115, 0.0025, 6, 16), M4(0, 0.152, 0, PI / 2)]]), hall.metal));
  { // the T bar: a worn metal rod across the top of the shaft, with rounded ends and a boss where it meets the shaft
    lever.add(new THREE.Mesh(mergeGeos([[new THREE.CapsuleGeometry(0.0095, 0.075, 6, 14), M4(0, 0.17, 0, PI / 2)], [new THREE.CylinderGeometry(0.012, 0.0105, 0.016, 14), M4(0, 0.162, 0)]]), hall.metal));
    const gaiter = []; for (let i = 0; i <= 10; i++) gaiter.push([0.017 + 0.004 * (i % 2) - i * 0.0006, i * 0.0042]); gaiter.push([0.0095, 0.046]);
    lever.add(new THREE.Mesh(new THREE.LatheGeometry(gaiter.map(([x, y]) => V2(x, y)), 18), std(0x111214, { roughness: 0.85 }))); }
  const leverTop = (o) => { tb.updateMatrixWorld(true); return lever.localToWorld(o.set(0, 0.18, 0)); };   // the top of the T bar's middle, where the palm presses
  // a raised wing of the rim on your side, with the last pad on it
  const wing = new THREE.Group(); wing.position.set(0.13, 0, 0.9); tb.add(wing);
  wing.add(new THREE.Mesh(mergeGeos([[new THREE.BoxGeometry(0.1, 0.24, 0.07), M4(0, TOP + 0.09, 0.03, 0.2)], [new THREE.BoxGeometry(0.44, 0.03, 0.2), M4(0, 1.03, 0.07, 0.42)]]), hall.dark));
  const panel = new THREE.Group(); panel.position.set(0, 1.03, 0.07); panel.rotation.x = 0.42; wing.add(panel);
  const last = makePad(11, 0xffa040); last.position.set(0, 0.02, 0); panel.add(last);
  for (const x of [-0.13, 0.13]) { const d = makePad(20 + x * 10, 0x2b6f90); d.position.set(x, 0.02, 0); panel.add(d); }
  tb.updateMatrixWorld(true);
  const W = (x, y, z) => tb.localToWorld(V(x, y, z));
  return { tb, W, landU, setCloud, setMist, setRain, blanket, blanketU, pads, last, lever, leverTop, dome, domeGlow, domeM, fieldL, laser, rimAt, at, lipM,
    stand: W(0, 1.6, 1.24), S1: W(1.45, 0, 0), S2: W(0.66, 0, 1.05), yawS1: A_WEATHER + PI - PI / 2 };
}
// The tall grey at the weather console, in a tailored cloak (grey root frame, unscaled: shoulders at y 0.625, x +-0.105,
// the neck pivot at y 0.78, the head's middle at 0.92, feet at 0). Three panels, each cut with real thickness (an outer
// cloth face, a lining face 6-8 mm behind it, closed edges) so no edge is a paper-thin sheet:
//   the yoke: a stiff mantle over the upper back and the tops of the shoulders, standing a little off the body, its front
//     corners at the sides of the neck and its lower edge behind the shoulder joints (the arms swing free in front of it);
//   the collar: a boned standing collar rising from the yoke behind the head and flaring a little at the top, lower at the
//     sides, kept 3 cm or more clear of the head through its whole turn and tilt; gold piping on its edges, ribs inside;
//   the cape: from under the yoke's edge down the back to a rolled hem a hand above the floor, widening as it falls, with
//     soft folds that deepen toward the hem.
// A gold chain hangs across the chest between the yoke's front corners, below the chin.
const TORSO_G = [[0.31, 0.02], [0.325, 0.05], [0.35, 0.07], [0.39, 0.072], [0.44, 0.052], [0.47, 0.05], [0.52, 0.064], [0.565, 0.076], [0.6, 0.083], [0.625, 0.08], [0.645, 0.05], [0.655, 0.02]];
const prof = (P, y) => { if (y <= P[0][0]) return P[0][1]; for (let i = 1; i < P.length; i++) if (y <= P[i][0]) { const [y0, r0] = P[i - 1], [y1, r1] = P[i]; return r0 + (r1 - r0) * (y - y0) / (y1 - y0); } return P[P.length - 1][1]; };
const torsoRx = (y) => prof(TORSO_G, y) * (1 + 0.15 * sst(0.55, 0.62, y)), torsoRz = (y) => prof(TORSO_G, y) * 0.68;
// piecewise-smooth through [v, ...values] keys
const keys = (K, v) => { if (v <= K[0][0]) return K[0].slice(1); for (let i = 1; i < K.length; i++) if (v <= K[i][0]) { const a = K[i - 1], b = K[i], k = sst(a[0], b[0], v); return a.slice(1).map((x, j) => x + (b[j + 1] - x) * k); } return K[K.length - 1].slice(1); };
// the yoke's cross-section from the neckline (v 0) to its edge (v 1): [v, Rx, Rz, y]
const YOKE = [[0, 0.046, 0.04, 0.674], [0.35, 0.09, 0.064, 0.664], [0.62, 0.128, 0.084, 0.638], [1, 0.172, 0.102, 0.55]];   // out over the shoulders: a broad line, not the narrow torso
const yokeTh = (v) => lerp(1.95, 1.15, sst(0, 0.6, v));   // how far round from the back it reaches (rad)
const yokeF = (u, v, o) => { const [rx, rz, y] = keys(YOKE, v), th = lerp(-1, 1, u) * yokeTh(v); return o.set(Math.sin(th) * rx, y, -Math.cos(th) * rz - 0.012); };
// the collar: its radius rising up from the yoke (back), in [v, R, y-at-back]; the top edge comes down toward the sides
const COLLAR = [[0, 0.07, 0.668], [0.2, 0.158, 0.735], [0.45, 0.236, 0.82], [0.7, 0.258, 0.92], [1, 0.27, 1.06]];
const COLLAR_TH = 1.72;
const collarF = (u, v, o) => { const th = lerp(-1, 1, u) * COLLAR_TH, side = (th / COLLAR_TH) ** 2, [R, yb] = keys(COLLAR, v * (1 - 0.3 * side));
  return o.set(Math.sin(th) * R * 1.05, yb, -Math.cos(th) * R - 0.012); };
// the cape: top tucked under the yoke edge (y 0.6), hem at 0.06
const capeY = (v) => lerp(0.6, 0.06, v);
const capeF = (u, v, o) => {
  const y = capeY(v), w = sst(0, 1, v), thm = lerp(1.13, 1.36, w), th = lerp(-1, 1, u) * thm;
  const rx = lerp(0.152, 0.27, Math.pow(w, 0.85)), rz = lerp(0.092, 0.2, Math.pow(w, 0.85)), zc = -0.012 - 0.03 * w;
  const fold = 1 + (0.012 + 0.075 * w) * Math.sin(th * 8.5 + 0.6) * sst(0.05, 0.5, v) + 0.02 * w * Math.sin(th * 15 + 2);
  return o.set(Math.sin(th) * rx * fold, y + 0.006 * w * Math.sin(th * 5), -Math.cos(th) * rz * fold + zc);
};
// A panel with thickness: outer face f(u, v), the lining face `th` behind it (toward the axis through (0, y, -0.012)),
// and the four edges closed. Groups: 0 outer cloth, 1 lining, 2 edges (cloth).
function thickPanel(NU, NV, f, th) {
  const n = (NU + 1) * (NV + 1), O = [], I = [], p = V(0, 0, 0), a = V(0, 0, 0), b = V(0, 0, 0), du = V(0, 0, 0), dv = V(0, 0, 0), nn = V(0, 0, 0);
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    const u = i / NU, v = j / NV, e = 1e-3;
    f(u, v, p); f(Math.min(1, u + e), v, a); f(Math.max(0, u - e), v, b); du.subVectors(a, b);
    f(u, Math.min(1, v + e), a); f(u, Math.max(0, v - e), b); dv.subVectors(a, b);
    nn.crossVectors(du, dv).normalize(); if (nn.x * p.x + nn.z * (p.z + 0.012) < 0) nn.negate();
    O.push(p.clone()); I.push(p.clone().addScaledVector(nn, -th));
  }
  const pos = [], uv = [], idx = [], groups = [];
  const vid = (arr, i, j) => arr[j * (NU + 1) + i];
  const add = (q, uu, vv) => { pos.push(q.x, q.y, q.z); uv.push(uu, vv); return pos.length / 3 - 1; };
  const quad = (A, B, C, D, flip) => { if (flip) idx.push(A, C, B, B, C, D); else idx.push(A, B, C, B, D, C); };
  let start = 0;
  // faces: outer then inner (same grid, opposite winding)
  for (const [arr, flip] of [[O, false], [I, true]]) {
    const base = pos.length / 3;
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) add(vid(arr, i, j), i / NU, j / NV);
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const A = base + j * (NU + 1) + i; quad(A, A + 1, A + NU + 1, A + NU + 2, flip); }
    groups.push([start, idx.length - start]); start = idx.length;
  }
  // edges: a strip between outer and inner along each border
  const border = [];
  for (let i = 0; i < NU; i++) border.push([[i, 0], [i + 1, 0]]);
  for (let j = 0; j < NV; j++) border.push([[NU, j], [NU, j + 1]]);
  for (let i = NU; i > 0; i--) border.push([[i, NV], [i - 1, NV]]);
  for (let j = NV; j > 0; j--) border.push([[0, j], [0, j - 1]]);
  for (const [[i0, j0], [i1, j1]] of border) { const A = add(vid(O, i0, j0), 0, 0), B = add(vid(O, i1, j1), 1, 0), C = add(vid(I, i0, j0), 0, 1), D = add(vid(I, i1, j1), 1, 1); quad(A, B, C, D, true); }
  groups.push([start, idx.length - start]);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
  groups.forEach(([s, c], k) => geo.addGroup(s, c, k));
  geo.computeVertexNormals();
  // wind every face outward: test the outer face's first triangle against its outward direction, and flip all if needed
  { const P2 = geo.attributes.position, t0 = V(0, 0, 0), t1 = V(0, 0, 0), t2 = V(0, 0, 0); t0.fromBufferAttribute(P2, idx[0]); t1.fromBufferAttribute(P2, idx[1]); t2.fromBufferAttribute(P2, idx[2]);
    const fn = t1.clone().sub(t0).cross(t2.clone().sub(t0)); if (fn.x * t0.x + fn.z * (t0.z + 0.012) < 0) { for (let k = 0; k < idx.length; k += 3) { const tmp = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tmp; } geo.setIndex(idx); geo.computeVertexNormals(); } }
  return { geo, O, I };
}
// a gold piping tube along points
const piping = (pts, r, mat) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(8, pts.length * 3), r, 8, false), mat);
function makeCollared() {
  const gr = makeGrey(true), u = gr.userData;
  const cloth = new THREE.MeshPhysicalMaterial({ color: 0x16222a, roughness: 0.62, sheen: 0.55, sheenColor: new THREE.Color(0x4f7f96), sheenRoughness: 0.42, emissive: 0x030607 });
  const lining = new THREE.MeshPhysicalMaterial({ color: 0x4a141a, roughness: 0.66, sheen: 0.7, sheenColor: new THREE.Color(0xc05a5a), emissive: 0x0c0304 });
  const gold = std(0xe8b24c, { metalness: 0.9, roughness: 0.3, emissive: 0x1a1004 });
  const edge = cloth.clone(); edge.side = THREE.DoubleSide; const mats = [cloth, lining, edge];   // the edge strips' winding is not checked: lit from both sides
  const yoke = thickPanel(36, 10, yokeF, 0.008), collar = thickPanel(40, 14, collarF, 0.007), cape = thickPanel(44, 26, capeF, 0.006);
  for (const pnl of [yoke, collar, cape]) u.root.add(new THREE.Mesh(pnl.geo, mats));
  const p = V(0, 0, 0);
  // the collar: gold piping round its top and down its front edges; seven ribs up its lining
  const top = [], fl = [], fr = [];
  for (let i = 0; i <= 40; i++) top.push(collarF(i / 40, 1, V(0, 0, 0)));
  for (let j = 0; j <= 14; j++) { fl.push(collarF(0, j / 14, V(0, 0, 0))); fr.push(collarF(1, j / 14, V(0, 0, 0))); }
  u.root.add(piping(top, 0.006, gold), piping(fl, 0.005, gold), piping(fr, 0.005, gold));
  for (let k = -3; k <= 3; k++) { const pts = []; for (let j = 1; j <= 12; j++) { collarF(0.5 + k * 0.12, j / 13, p); const r = Math.hypot(p.x, p.z + 0.012); pts.push(V(p.x * (r - 0.008) / r, p.y, (p.z + 0.012) * (r - 0.008) / r - 0.012)); } u.root.add(piping(pts, 0.0028, gold)); }
  // the yoke's edge piped in gold, the cape's hem rolled in its own cloth
  const yEdge = []; for (let i = 0; i <= 36; i++) yEdge.push(yokeF(i / 36, 1, V(0, 0, 0)).add(V(0, -0.002, 0)));
  const hem = []; for (let i = 0; i <= 44; i++) hem.push(capeF(i / 44, 1, V(0, 0, 0)));
  u.root.add(piping(yEdge, 0.005, gold), piping(hem, 0.009, cloth));
  // the chain across the chest: a hanging curve between the yoke's front corners, with a clasp in the middle
  const cl = yokeF(0, 0.12, V(0, 0, 0)), cr = yokeF(1, 0.12, V(0, 0, 0)), chain = [];
  for (let i = 0; i <= 16; i++) { const k = i / 16, x = lerp(cl.x, cr.x, k), sag = Math.sin(k * PI); chain.push(V(x, lerp(cl.y, cr.y, k) - 0.07 * sag, lerp(cl.z, cr.z, k) + 0.075 * sag)); }
  u.root.add(piping(chain, 0.0035, gold));
  const clasp = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.004, 8, 16), gold); clasp.position.copy(chain[8]); u.root.add(clasp);
  u.cape = { yokeF, collarF, capeF, yoke, collar, cape };
  return gr;
}
// a grey's fingertips onto a moving point, solved afresh each frame from the last frame's wrist (so the pose never switches)
function greyReach(g, side) {
  const u = g.userData, hd = u['hand' + side], tips = u['tips' + side], W = V(0, 0, 0), Tt = V(0, 0, 0), pole = V(0, 0, 0), q = new THREE.Quaternion();
  const tm = tips.children.find((c) => c.isMesh);
  const tipL = V(0, 9, 0); { const p = tm.geometry.attributes.position, c = V(0, 0, 0); for (let i = 0; i < p.count; i++) { c.fromBufferAttribute(p, i); if (c.y < tipL.y) tipL.copy(c); } tipL.y += 0.004; }
  let live = false;
  const tip = (o) => { g.updateMatrixWorld(true); return tips.localToWorld(o.copy(tipL)); };
  const f = (P, poleL) => {
    if (!live) { g.updateMatrixWorld(true); hd.getWorldPosition(W); tip(Tt); W.add(P).sub(Tt); live = true; }
    pole.copy(poleL || f.pole).normalize().applyQuaternion(u.root.getWorldQuaternion(q));
    for (let i = 0; i < 3; i++) { clearGreyArm(g, side, W, pole); hd.rotation.set(0, 0, 0); tip(Tt); W.add(Tt.subVectors(P, Tt).multiplyScalar(0.9)); }
    clearGreyArm(g, side, W, pole); hd.rotation.set(0, 0, 0);
  };
  f.pole = V(side === 'R' ? 0.75 : -0.75, -0.75, 0.1); f.tip = tip; f.reset = () => { live = false; };
  return f;
}

// ---------- the link: a couch under a ring of light ----------
// Couch frame: +z toward the middle of the hall (the way you face lying on it).
// Lying on it: the eyes at EYE, the body leaned back LEAN, the legs raised LEGS at the hip, the arms loose at the sides. The
// player's legs are one straight piece (no knee), so the couch is cut to the body rather than the body bent to a couch: its
// padded top follows the underside of the body in this pose (sampled from the body itself, 4 cm steps along it, the lowest
// point of the torso and legs in each), 2 mm under it, with a headrest carried on up the line of the back and a foot past the
// heels. The same pose is used in both scenes (lie()), so the body always rests on the pad and never passes into it.
const LINK_EYE = V(0, 1.2, -0.7), LINK_LEAN = 0.8, LINK_LEGS = 0.62, PAD_BEV = 0.035, PAD_W = 0.52;
// how far the view may turn while lying (from the pose's own view up at the ring): kept where the body is not seen from inside
const LIE_LOOK = { yaw: 0.5, up: 0.65, down: 0.5 };
// the same lying, looking along the body (aftermath: base pitch -0.78)
const LIE_LOOK_DOWN = { yaw: 0.35, up: 0.65, down: 0.2 };
// While you lie and look about, the body's eyes stay on the view (models.js riseTo): the head turns on the neck toward
// where you look and the torso follows about the hip, so looking down shows your shirt front and chin-side, never the open
// collar from inside. The view's turn is taken from E.yaw/E.pitch (the camera's own turn is only set after the updaters).
const _lq = new THREE.Quaternion(), _le = new THREE.Euler();
// The torso turns a little as it follows the view, and the arms with it: each upper arm is then turned at the shoulder
// (two secant steps a frame) so its elbow stays at the height it has on its armrest. opts.right = false leaves the right
// arm to a scene that is moving it.
function lieLook(me, opts = {}) {
  const mu = me.userData, P = couchProfile(), v = V(0, 0, 0), inv = new THREE.Matrix4();
  const elbowY = (arm, fore, a) => { arm.rotation.x = a; arm.updateMatrixWorld(true); return fore.getWorldPosition(v).applyMatrix4(inv).y; };
  const f = () => {
    mu.riseTo(E.camera.position, null, _lq.setFromEuler(_le.set(E.pitch, E.yaw, E.roll, 'YXZ')), LIE_HEAD);
    if (!me.parent) return; me.parent.updateMatrixWorld(true); inv.copy(me.parent.matrixWorld).invert(); me.updateMatrixWorld(true);
    [[mu.armL, mu.foreL, P.elbowY[0]], [mu.armR, mu.foreR, P.elbowY[1]]].forEach(([arm, fore, want], i) => {
      if (i === 1 && opts.right === false) return;
      let a0 = arm.rotation.x, y0 = elbowY(arm, fore, a0), a1 = a0 + 0.02;
      for (let k = 0; k < 2; k++) { const y1 = elbowY(arm, fore, a1), d = y1 - y0; if (Math.abs(d) < 1e-6) break; const a2 = Math.max(-0.4, Math.min(0.9, a1 - (y1 - want) * (a1 - a0) / d)); a0 = a1; y0 = y1; a1 = a2; }
      elbowY(arm, fore, a1);
    });
  };
  f(); const off = on(f); off.opts = opts; return Object.assign(off, { opts });
}
// how far the head turns toward the view while lying (riseTo headK): enough to look over the chest, not so far that the
// shoulders lift off the couch
const LIE_HEAD = 0.6;
function lie(me, arm = padProfile ? padProfile.arm : 0.3) { const mu = me.userData; me.position.copy(LINK_EYE); me.rotation.set(-LINK_LEAN, PI, 0); mu.relax(arm); mu.legs.rotation.x = LINK_LEGS; me.updateMatrixWorld(true); }
let padProfile = null;
function couchProfile() {
  if (padProfile) return padProfile;
  const me = makePlayerBody(); lie(me);
  const Z0 = -1.12, DZ = 0.04, NB = 58, low = new Array(NB).fill(9), v = V(0, 0, 0);
  // sampled with the body as it lies looking about (lieLook turns the torso about the hip to follow the view), over the
  // whole look range of both lying views, in the couch's frame (the couch faces back along the view: local yaw -PI)
  const sample = () => { me.updateMatrixWorld(true); me.traverse((o) => { if (!o.isMesh || o.isSkinnedMesh) return; const P = o.geometry.attributes.position;
    for (let i = 0; i < P.count; i += 2) { v.fromBufferAttribute(P, i); o.localToWorld(v); if (Math.abs(v.x) > 0.17) continue; const k = Math.floor((v.z - Z0) / DZ); if (k >= 0 && k < NB) low[k] = Math.min(low[k], v.y); } }); };
  const q = new THREE.Quaternion(), eu = new THREE.Euler();
  for (const dy of [-0.5, 0, 0.5]) for (const p of [-0.98, -0.58, 0.05, 0.55, 0.95]) { me.userData.riseTo(LINK_EYE, null, q.setFromEuler(eu.set(p, -PI + dy, 0, 'YXZ')), LIE_HEAD); sample(); }
  // fill: before the shoulders, carry the back's line on up (the headrest under the head); past the heels, a short level foot
  let first = low.findIndex((y) => y < 9), last = NB - 1 - [...low].reverse().findIndex((y) => y < 9);
  const k0 = first + 3, slope = (low[k0 + 4] - low[k0]) / 4;
  for (let k = 0; k < k0; k++) low[k] = low[k0] + slope * (k - k0);
  for (let k = last + 1; k < NB; k++) low[k] = low[last];
  // any step along the body with no sample in it (between two parts) takes the straight line between its neighbours
  for (let k = first; k <= last; k++) if (low[k] >= 9) { let j = k; while (j <= last && low[j] >= 9) j++; for (let q = k; q < j; q++) low[q] = low[k - 1] + (low[j] - low[k - 1]) * (q - k + 1) / (j - k + 1); k = j; }
  // a soft envelope: never above the body (each bin the least of itself and its neighbours), then eased, then kept under again
  const lo2 = low.map((y, k) => Math.min(y, low[Math.max(0, k - 1)], low[Math.min(NB - 1, k + 1)]));
  const sm2 = lo2.map((y, k) => (lo2[Math.max(0, k - 1)] + 2 * y + lo2[Math.min(NB - 1, k + 1)]) / 4);
  padProfile = sm2.map((y, k) => [Z0 + (k + 0.5) * DZ, Math.min(y, lo2[k]) - PAD_BEV - 0.005]).filter(([z]) => z > -1.1 && z < 1.12);
  // the arms lie loose at the sides (raised 0.3 rad off the body, so the hands are in view): each forearm rests on an armrest
  // cut to it, a rail from just past the elbow to 3 cm short of the wrist, its top 3 mm under the forearm's underside
  // (forearm 4.3 cm thick at the elbow, 2.5 at the wrist); the hand hangs loose off its end
  // (cut for the arm as it lies with the aftermath's view along the body; as you look about lieLook keeps each elbow at
  // this height on its rest)
  const mu = me.userData; mu.relax(0.3);
  padProfile.arm = 0.3;
  const joints = [[mu.foreL, mu.handL], [mu.foreR, mu.handR]];
  mu.riseTo(LINK_EYE, null, q.setFromEuler(eu.set(-0.78, -PI, 0, 'YXZ')), LIE_HEAD); me.updateMatrixWorld(true);
  padProfile.elbowY = joints.map(([e]) => e.getWorldPosition(V(0, 0, 0)).y);
  padProfile.rests = joints.map(([e, w]) => { const E0 = e.getWorldPosition(V(0, 0, 0)), W0 = w.getWorldPosition(V(0, 0, 0)), d = W0.clone().sub(E0).normalize();
    return [E0.clone().addScaledVector(d, 0.05).add(V(0, -(0.041 + 0.03 + 0.003), 0)), W0.clone().addScaledVector(d, -0.03).add(V(0, -(0.027 + 0.03 + 0.003), 0))]; });
  return padProfile;
}
function buildLink(hall) {
  const lk = new THREE.Group(); lk.position.copy(polar(A_LINK, 9.5)); lk.rotation.y = A_LINK + PI; hall.g.add(lk);
  const pad = std(0x2b2f38, { roughness: 0.8, metalness: 0.1 }), trim = hall.metal;
  // the couch in profile (z along it, y up): the padded top cut to the body, 11 cm deep; cut as one padded shape
  const top = couchProfile(), under = top.map(([z, y]) => [z + 0.02, y - 0.11]).reverse();
  const prof = new THREE.Shape(); top.concat(under).forEach(([z, y], i) => (i ? prof.lineTo(z, y) : prof.moveTo(z, y))); prof.closePath();
  const padG = new THREE.ExtrudeGeometry(prof, { depth: PAD_W, bevelEnabled: true, bevelThickness: 0.04, bevelSize: PAD_BEV, bevelSegments: 4, curveSegments: 6 }); padG.translate(0, 0, -PAD_W / 2); padG.rotateY(-PI / 2);
  lk.add(new THREE.Mesh(padG, pad));
  const shellG = new THREE.ExtrudeGeometry(prof, { depth: 0.66, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 }); shellG.translate(0, -0.075, -0.33); shellG.rotateY(-PI / 2);
  // the stem under the seat, at the lowest point of the shell
  const seatZ = top.reduce((m, p) => (p[1] < m[1] ? p : m), top[0]), stemTop = seatZ[1] - 0.2;
  lk.add(new THREE.Mesh(mergeGeos([[shellG, null], [new THREE.CylinderGeometry(0.09, 0.2, stemTop - 0.02, 20), M4(0, (stemTop + 0.02) / 2 + 0.01, seatZ[0])], [new THREE.CylinderGeometry(0.46, 0.5, 0.04, 36), M4(0, 0.02, seatZ[0])],
    // the armrests under the forearms, each on a strut down into the shell's side
    ...top.rests.map(([p, q]) => { const d = q.clone().sub(p); return [new THREE.CapsuleGeometry(0.03, d.length(), 4, 10), new THREE.Matrix4().compose(p.clone().add(q).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()), V(1, 1, 1))]; }),
    ...top.rests.map(([p, q]) => { const m = p.clone().lerp(q, 0.4), base = top.reduce((b, r) => (Math.abs(r[0] - m.z) < Math.abs(b[0] - m.z) ? r : b))[1] - 0.06, h = Math.max(0.04, m.y - base); return [new THREE.CylinderGeometry(0.013, 0.018, h, 10), M4(m.x, m.y - h / 2, m.z)]; })]), trim));
  // the ring: it hangs in the air over the couch, and lowers along the line of your eyes
  const ringG = new THREE.Group(); ringG.position.set(0, 2.42, -0.5); lk.add(ringG);
  const ringM = basic(0xffd9b8), ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.016, 10, 72), ringM); ring.rotation.x = PI / 2; ringG.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.006, 6, 72), basic(0x8a5a48)); ring2.rotation.x = PI / 2; ringG.add(ring2);
  const halo = sprite(glowTex(), 0xffb690, 1.5, { opacity: 0.3 }); ringG.add(halo);
  lk.updateMatrixWorld(true);
  const W = (x, y, z) => lk.localToWorld(V(x, y, z));
  return { lk, W, ringG, ringM, halo, EYE: LINK_EYE, LEAN: LINK_LEAN, yaw: A_LINK, PROF: top, BEV: PAD_BEV, WID: PAD_W + 2 * PAD_BEV };
}

// ---------- the ones who work here ----------
// Small greys at the consoles (hands on the keys, by the arm solver, every frame), two who walk the gallery between consoles,
// three on the tier minding the basin. They do not attend to you; now and then one looks up.
function buildCrew(hall) {
  const g = hall.g, crew = [], tV = V(0, 0, 0);
  const deskers = [1, -2, 5, -4].map((k, i) => {
    const gr = makeGrey(); gr.position.copy(polar(k * BAY, DESK_R - 0.47)); gr.rotation.y = k * BAY; gr.userData.phase = i * 1.7; g.add(gr);
    const hands = ['L', 'R'].map((sd, j) => { return { sd, reach: greyReach(gr, sd), u: 0, v: 0.3, P: V(0, 0, 0), A: V(0, 0, 0), B: V(0, 0, 0), t0: -9, dur: 0.4, next: 0.5 + j * 0.6 + i * 0.3, side: 0 }; });
    return { gr, k, hands, look: 0, lookT: 6 + i * 7 };
  });
  // which side of the desk each hand works: the hand whose shoulder is on that side
  for (const d of deskers) { d.gr.updateMatrixWorld(true); for (const h of d.hands) { const sx = hall.deskPt(d.k, 1, 0.5).distanceTo(d.gr.userData['arm' + h.sd].getWorldPosition(tV)) < hall.deskPt(d.k, -1, 0.5).distanceTo(tV) ? 1 : -1; h.side = sx; h.u = sx * 0.25; h.P.copy(hall.deskPt(d.k, h.u, h.v, 0.03)); h.A.copy(h.P); h.B.copy(h.P); } }
  const walkers = [{ a: 5.4 * BAY, to: 6 * BAY, stops: [6, 5, 7, 5] }, { a: -3.6 * BAY, to: -5 * BAY, stops: [-5, -3, -2, -4] }].map((w, i) => {
    const gr = makeGrey(); gr.userData.phase = 3 + i; g.add(gr); return { gr, ...w, n: 0, mode: 'walk', amt: 0, hold: 0, yaw: 0 };
  });
  const tier = hall.TIER.map((a, i) => { const gr = makeGrey(); gr.position.copy(polar(a, 4.52, -0.75)); gr.rotation.y = a + PI; gr.userData.phase = i * 2.3; g.add(gr); return { gr, a }; });
  for (const w of walkers) { w.gr.position.copy(polar(w.a, 9.35)); w.yaw = w.gr.rotation.y = w.a + PI / 2 * Math.sign(w.to - w.a); }
  const lectP = V(0, 0, 0);
  const update = (dt, t, calm = 1) => {
    // at the consoles: each hand goes from key to key in a low arc, and rests on each a moment
    for (const d of deskers) {
      idleGrey(d.gr, t);
      d.lookT -= dt; if (d.lookT < 0) { d.lookT = 14 + Math.random() * 16; d.lookAt = t; }
      const lk = d.lookAt != null ? sst(0, 0.5, t - d.lookAt) * (1 - sst(1.6, 2.3, t - d.lookAt)) : 0;
      aimGrey(d.gr, lk > 0 ? tV.copy(E.camera.position) : hall.deskPt(d.k, d.hands[0].u * 0.5, 0.5, 0.0), 1);
      if (lk > 0) { d.gr.userData.neck.rotation.y *= lk; d.gr.userData.neck.rotation.x = lerp(0.35, d.gr.userData.neck.rotation.x, lk); }
      for (const h of d.hands) {
        if (t > h.next) { h.A.copy(h.P); h.u = h.side * (0.08 + Math.random() * 0.5); h.v = 0.15 + Math.random() * 0.5; h.B.copy(hall.deskPt(d.k, h.u, h.v)); h.t0 = t; h.dur = 0.32 + h.A.distanceTo(h.B) * 0.9; h.next = t + h.dur + (0.35 + Math.random() * 1.6) / calm; h.tick = false; }
        const k = sst(0, 1, c01((t - h.t0) / h.dur)); h.P.lerpVectors(h.A, h.B, k); h.P.y += Math.sin(k * PI) * 0.035 + (k >= 1 ? 0 : 0.004);
        if (k >= 1 && !h.tick) { h.tick = true; if (A.consoleTick && E.camera.position.distanceTo(h.P) < 9) A.consoleTick(c01(1.2 - E.camera.position.distanceTo(h.P) / 8)); }
        h.reach(h.P);
      }
    }
    // on the gallery: a walk round the wall from one console to another, a pause at each
    for (const w of walkers) {
      const gr = w.gr, u = gr.userData, dA = w.to - w.a, dirS = Math.sign(dA) || 1;
      let want = w.a + dirS * PI / 2, stride = 0;
      if (w.mode === 'walk') {
        const turnErr = Math.abs(wrapA(want - w.yaw));
        if (turnErr < 0.5) { const sp = 0.42 / 9.35 * dt * Math.min(1, w.amt + 0.2); w.a += dirS * Math.min(Math.abs(dA), sp); stride = 1; } else stride = 0.5;
        if (Math.abs(w.to - w.a) < 0.002) { w.mode = 'face'; }
      } else { want = w.a; stride = Math.abs(wrapA(want - w.yaw)) > 0.05 ? 0.5 : 0; if (!stride) { w.hold += dt; if (w.hold > 5 + (w.n % 3) * 2) { w.hold = 0; w.n++; w.to = w.stops[w.n % w.stops.length] * BAY; w.mode = 'walk'; } } }
      const dy = wrapA(want - w.yaw); w.yaw += Math.sign(dy) * Math.min(Math.abs(dy), 1.6 * dt); gr.rotation.y = w.yaw;
      w.amt += (stride - w.amt) * Math.min(1, dt * 5);
      gr.position.copy(polar(w.a, 9.35));
      stepGrey(gr, E.time * GREY_GAIT, w.amt); if (w.amt < 0.02) idleGrey(gr, t);
      aimGrey(gr, w.mode === 'face' ? polar(w.a, R_WALL, 1.6) : tV.copy(gr.position).add(V(Math.sin(w.yaw), 0.75, Math.cos(w.yaw))), 0.8);
    }
    for (const s of tier) { idleGrey(s.gr, t); lectP.copy(polar(s.a, 0.3 + 1.2 * (0.5 + 0.5 * Math.sin(t * 0.13 + s.a)), BASIN_Y)); aimGrey(s.gr, lectP, 0.9); }
  };
  return { deskers, walkers, tier, update };
}

// ---------- coming in from the crossroads: one room giving way to the other ----------
// The crossroads (ship.js) hands its room, the tall one and your arm over as they stand (E.carry). Both rooms are drawn
// together and a sphere grows out from your eyes: inside it the control room is drawn and the crossroads is not, outside
// it the other way round, so neither ever shows through the other. The front is broken into 16 cm cells (each panel goes
// at its own moment) and the crossroads' side of it burns pale blue as it goes. Every material in each room is patched
// once: the vertex shader finds its world position from gl_Position (whatever the shader does to get there), the fragment
// shader discards on the wrong side of the front. Afterwards the control room's radius is left huge, so the patch costs a
// compare per pixel and never discards (patched materials that models.js caches keep it, harmlessly, in later scenes).
// (the world position comes from gl_Position through the inverse view-projection, a uniform set as each frame is drawn,
// after the view has its final pose for the frame)
const RV_IPV = { value: new THREE.Matrix4() };
const RV_HALL = { uRv: { value: new THREE.Vector4(0, 0, 0, 1e6) }, uRvS: { value: 1 }, uRvG: { value: 0 }, uRvIPV: RV_IPV };
const RV_CROSS = { uRv: RV_HALL.uRv, uRvS: { value: -1 }, uRvG: { value: 1 }, uRvIPV: RV_IPV };
function rvHook() { const sc = E.scene; if (sc.userData.rvHook) return; sc.userData.rvHook = true; const prev = sc.onBeforeRender;
  sc.onBeforeRender = function (r, s2, cam, rt) { prev.call(this, r, s2, cam, rt); RV_IPV.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert(); }; }
const RV_VDECL = 'varying vec3 vRvW; uniform mat4 uRvIPV;\n';
const RV_VSET = '\n  { vec4 rvC = uRvIPV * gl_Position; vRvW = rvC.xyz / rvC.w; }\n}';
const RV_FDECL = `varying vec3 vRvW; uniform vec4 uRv; uniform float uRvS; uniform float uRvG;
float rvD() { vec3 c = floor(vRvW * 6.0); float n = fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  return distance(vRvW, uRv.xyz) - uRv.w + (n - 0.5) * 0.9; }
`;
const RV_FCUT = 'float rvd = rvD(); if (uRvS * rvd > 0.0) discard;';
const RV_FGLOW = '\n  gl_FragColor.rgb += vec3(0.5, 0.78, 1.0) * uRvG * (1.0 - smoothstep(0.0, 0.3, rvD())) * 1.6;\n}';
function rvMaterial(m, U) {
  if (!m || m.userData.rv) return; m.userData.rv = true;
  const vfix = (vs) => RV_VDECL + vs.replace(/\}\s*$/, RV_VSET), ffix = (fs) => RV_FDECL + fs.replace(/void\s+main\s*\(\s*\)\s*\{/, (x) => x + ' ' + RV_FCUT).replace(/\}\s*$/, RV_FGLOW);
  if (m.isShaderMaterial) { m.vertexShader = vfix(m.vertexShader); m.fragmentShader = ffix(m.fragmentShader); Object.assign(m.uniforms, U); }
  else {
    const prev = m.onBeforeCompile, key = m.customProgramCacheKey;
    m.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r); sh.vertexShader = vfix(sh.vertexShader); sh.fragmentShader = ffix(sh.fragmentShader); Object.assign(sh.uniforms, U); };
    m.customProgramCacheKey = function () { return (key ? key.call(this) : '') + '|rv' + U.uRvS.value; };
  }
  m.needsUpdate = true;
}
function rvPatch(root, U, skip) { root.traverse((o) => { for (let p = o; p; p = p.parent) if (skip && skip.has(p)) return; for (const m of [].concat(o.material || [])) rvMaterial(m, U); }); }
// The change itself, from the moment the control room has been built round the crossroads: the tall one keeps their finger
// in your palm and their other hand on your shoulder (solved each frame, as at the crossroads); the hum swells and the
// view trembles; the front goes out from your eyes, slowly over the first metre, then through the room and on to the far
// wall of the hall; the crossroads' lights go down as it goes; the tall one steps down off their dais as it sinks; then the
// tremor and the hum die away, and both hands are let go.
async function fromCrossroads(cross, { S, guide, guideH, hall }) {
  const gu = guide.userData, me = cross.me, mu = me.userData, reach = palmReach(me), fw = V(0, 0, 0), held = V(0, 0, 0), palm = V(0, 0, 0), sh = V(0, 0, 0);
  // where the hands are held, as at the crossroads, fixed in the room (you may look about a little meanwhile); the view is
  // set from E.yaw/E.pitch now, since the frame that would do it has not run since the room was moved
  E.camera.rotation.set(E.pitch, E.yaw, 0); E.camera.updateMatrixWorld(true);
  fw.set(-Math.sin(E.yaw), 0, -Math.cos(E.yaw));
  held.copy(E.camera.position).addScaledVector(fw, 0.42).add(V(-fw.z * 0.06, -0.3, fw.x * 0.06));
  const shoulderAt = () => sh.copy(E.camera.position).addScaledVector(fw, -0.06).add(V(fw.z * 0.2, -0.23, -fw.x * 0.2));
  E.base.yaw = E.yaw; E.base.pitch = E.pitch; E.limits = { yaw: 0.45, up: 0.45, down: 0.15 }; E.mode = 'look';
  let hold = 1;
  const pose = () => { reach(held, hold); E.camera.updateMatrixWorld(true); mu.handR.localToWorld(palm.copy(PALM)); shoulderAt();
    if (hold < 1) gu.setFold(1); gu.reachTo(palm, hold, 1); gu.curl(1, hold, true); gu.reachTo(sh, hold, -1); gu.curl(-1, 0.3 * hold, true); };
  S.guideFace = false; pose();
  // the tall one's idle sway picks up where the crossroads left it (eased over half a second, no jump at the change)
  const y0 = guide.position.y, t0 = E.time, ease = on(() => { const k = sst(0, 0.6, E.time - t0); guide.position.y = lerp(y0, guide.position.y, k); if (k >= 1) ease(); });
  const holdOn = on(pose);
  const U = RV_HALL.uRv.value, R0 = U.w, far = 24;
  cross.hum.set(1, 2.5);
  tween(2, (k) => { E.shake = lerp(0.0035, 0.006, k); });
  // the front: a slow first metre, then out through the room to the far wall
  const grow = tween(6, (k) => { U.w = R0 + far * Math.pow(sst(0, 1, k), 1.6); for (const [l, i0] of cross.lights) l.intensity = i0 * (1 - sst(0.1, 0.55, k)); }, (k) => k);
  // the dais sinks with the front: the tall one comes down the 12 cm to the hall's floor
  wait(0.9).then(() => tween(1.1, (k) => { guideH.position.y = cross.lift * (1 - k); }, (k) => k * k * (3 - 2 * k)));
  await wait(1.4);
  say('The room comes apart around you. A far larger one is there in its place.');
  await grow;
  U.w = 1e6;
  // the crossroads is gone: its geometry is let go; its lights stay in the scene, off (taking them out would recompile
  // every material in the hall)
  for (const [l] of cross.lights) { l.intensity = 0; hall.g.attach(l); }
  discard(cross.cg);
  cross.hum.stop(3.5);
  tween(1.6, (k) => { E.shake = 0.006 * (1 - k); }).then(() => { E.shake = 0; });
  await tween(1.8, (k) => { hold = 1 - k; }, (k) => k * k * (3 - 2 * k));
  holdOn(); gu.reachTo(palm, 0, 1); gu.reachTo(sh, 0, -1); gu.curl(1, 0); gu.curl(-1, 0); gu.setFold(1); discard(me);
  S.guideFace = true; E.limits = null;
}
// The hall and everything in it that does not run per frame. pause (optional): awaited between the heavy pieces, so the
// build can be spread over frames.
async function makeHallSet(pause, into) {
  const T = window.UAP ? (window.UAP.buildPerf = []) : null; let t0 = performance.now();
  const P = async () => { if (T) { const t = performance.now(); T.push((t - t0).toFixed(0)); } if (pause) await pause(); t0 = performance.now(); };
  for (const rt of LIVE_RT) rt.dispose(); LIVE_RT.clear();
  const hall = buildHall(into); await P();
  const loom = buildLoom(hall); await P();
  const wx = buildWeather(hall); await P();
  const link = buildLink(hall); await P();
  const crew = buildCrew(hall); await P();
  const { g } = hall;
  const weaverH = new THREE.Group(), weaver = makeWeaver(); weaverH.position.copy(WEAVER_POS); weaverH.rotation.y = WEAVER_YAW; weaverH.add(weaver); g.add(weaverH);
  const disc = new THREE.Mesh(new THREE.LatheGeometry([[0, -0.1], [0.5, -0.1], [0.66, -0.04], [0.66, -0.01], [0.6, 0], [0, 0]].map(([x, y]) => V2(x, y)), 48), hall.dark); disc.position.copy(WEAVER_POS); g.add(disc);
  const discRim = new THREE.Mesh(new THREE.TorusGeometry(0.655, 0.008, 6, 64), basic(0x8fd8ff)); discRim.rotation.x = PI / 2; discRim.position.copy(WEAVER_POS).y -= 0.025; g.add(discRim);
  const discGlow = sprite(glowTex(), 0x6fc8ff, 1.5, { opacity: 0.4 }); discGlow.position.copy(WEAVER_POS).y -= 0.2; g.add(discGlow);
  await P();
  const maroonH = new THREE.Group(), maroon = makeMantis(); robe(maroon, 0x74161f, 0x26060a, 0x4a0e16, 0xe8a0a4); maroonH.add(maroon); maroonH.position.copy(link.W(-1.05, 0, 0.3)); maroonH.rotation.y = A_LINK + PI + 0.5; g.add(maroonH);
  const collared = makeCollared(); collared.position.copy(wx.S1); { const c = wx.W(0, 0, 0); collared.rotation.set(0, Math.atan2(c.x - collared.position.x, c.z - collared.position.z), 0); } g.add(collared);
  await P();
  return { hall, loom, wx, link, crew, weaverH, weaver, maroonH, maroon, collared };
}
// Built ahead, at the crossroads, after the yes, while the tall one reaches for your hand (ship.js): the hall is built a
// piece a frame into a holder outside the scene; its materials (cached ones as own copies first, so nothing else that
// uses them is touched) get the change's cut; the crossroads' own materials get it too, as copies on stand-ins, swapped in
// at the change. Then every program is compiled off the main thread (compileAsync, against the crossroads scene and its
// lights, which is what the hall will be drawn with), eight materials a frame, and the textures are sent up two a frame. Nothing on screen
// changes. Returns { set, swap } for control().
export async function prebuild({ group: cg, mantis }) {
  const PP = window.UAP ? (window.UAP.prePerf = []) : null; let pt = performance.now(); const pm = (n) => { if (PP) { const t = performance.now(); PP.push(n + ' ' + (t - pt).toFixed(0)); pt = t; } };
  const pause = async () => { pm('slice'); await wait(0); pt = performance.now(); }, hold = new THREE.Scene();
  const set = await makeHallSet(pause, hold), g = set.hall.g;
  RV_HALL.uRv.value.set(0, 0, 0, -10);   // until the change: the hall cut away everywhere, the crossroads nowhere
  ownCached(g); rvPatch(g, RV_HALL); rvHook(); await pause();
  const swap = [];
  cg.traverse((o) => { for (let p = o; p; p = p.parent) if (p === mantis) return; if (!o.material || o === cg) return;
    const ms = [].concat(o.material).map((m) => { const c = m.clone(); rvMaterial(c, RV_CROSS); return c; }), mm = Array.isArray(o.material) ? ms : ms[0];
    const st = o.clone(false); st.material = mm; hold.add(st); swap.push([o, mm]); });
  // (the tall one keeps their own materials; they are compiled again here for the hall's lights)
  mantis.traverse((o) => { if (o.material) hold.add(o.clone(false)); });
  await pause();
  // compiled eight materials a frame: everything else in the holder is hidden for each call (lights stay)
  // (hidden things too, as warm() does: whatever is shown later must not compile then)
  const items = [], vis = new Map(); hold.traverse((o) => { vis.set(o, o.visible); if (o.material) items.push(o); });
  const jobs = []; let mats = 0, chunk = [];
  const flush = async () => { const on = new Set(chunk); for (const o of items) o.visible = on.has(o); for (const o of chunk) for (let p = o.parent; p; p = p.parent) p.visible = true;
    jobs.push(E.renderer.compileAsync(hold, E.camera, E.scene)); for (const [o, v] of vis) o.visible = v; chunk = []; mats = 0; await pause(); };
  for (const o of items) { chunk.push(o); mats += [].concat(o.material).length; if (mats >= 8) await flush(); }
  if (chunk.length) await flush();
  if (set.loom.world) { jobs.push(E.renderer.compileAsync(set.loom.world.scene, set.loom.world.cam)); await pause(); }
  await Promise.all(jobs);
  for (const c of [...hold.children]) if (c !== g) hold.remove(c);
  // textures up, four a frame
  const tex = new Set(); g.traverse((o) => { for (const m of [].concat(o.material || [])) { for (const k in m) { const t = m[k]; if (t && t.isTexture) tex.add(t); } if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture) tex.add(u.value); } });
  let n = 0; for (const t of tex) { E.renderer.initTexture(t); if (++n % 2 === 0) await pause(); }
  hold.remove(g);
  // stand-ins for the hall's lights (a program depends only on how many lights of each kind), for prebuildMe
  const lightsProto = new THREE.Group(); g.traverse((o) => { if (o.isLight) lightsProto.add(o.clone()); });
  return { set, swap, lightsProto };
}
// your arm (made at the yes): its materials compiled for the hall's lights as well
export async function prebuildMe(pre, me) {
  const sc = new THREE.Scene(); sc.add(pre.lightsProto); me.traverse((o) => { if (o.material) sc.add(o.clone(false)); });
  await E.renderer.compileAsync(sc, E.camera, E.scene);
  return pre;
}
// own copies of the materials models.js caches (marked userData.keep === their uuid), for everything under root but skip:
// the hall's patch then never reaches a cached material that something outside it (the crossroads' tall one, a later
// scene) also draws with
function ownCached(root, skip) { const map = new Map(); root.traverse((o) => { for (let p = o; p; p = p.parent) if (p === skip) return; if (!o.material) return;
  const own = (m) => { if (!(m.userData && m.userData.keep === m.uuid)) return m; if (!map.has(m)) { const c = m.clone(); c.userData = {}; map.set(m, c); } return map.get(m); };
  o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material); }); }
// You, seen from outside (the bead orbit): your own body standing naturally, arms loose, with a head: the player's neck
// and head (models.js playerHead, the same look as the sleeper in the bedroom) on the shirt's collar. pos: the eyes.
function standingSelf(pos, yaw) {
  const me = makePlayerBody(); me.userData.relax(0.1);
  const { wrap, neck } = playerHead(); me.add(wrap);
  me.userData.neckSkin.visible = false;   // the first-person throat and collarbone strips: the head's own neck replaces them
  me.position.copy(pos); me.rotation.y = yaw; me.updateMatrixWorld(true);
  return { me, head: neck };
}
// own copies of the materials of something that must stay drawn whatever the front does (the tall one carried over)
function ownMaterials(root) { const map = new Map(), own = (m) => { if (!map.has(m)) map.set(m, m.clone()); return map.get(m); }; root.traverse((o) => { if (o.material) o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material); }); }

// ---------- shared by both scenes ----------
const cue = (name, ...a) => (A[name] ? A[name](...a) : null);
// The mantids click now and then (their own sound, A.clicks, as at the crossroads): each on its own clock (6-16 s), only
// while within 9 m of you, and sometimes another answers a moment later. Returns the updater's remover.
function chirps(list) {
  const next = list.map(() => 2 + Math.random() * 7), w = new THREE.Vector3(), r = new THREE.Vector3();
  const one = (m) => {
    if (!m || !m.visible) return;
    m.getWorldPosition(w); w.y += 2.1 * m.getWorldScale(r).y;
    if (w.distanceTo(E.camera.position) < 9) cue('clicks', 3 + (Math.random() * 4 | 0));
  };
  return on((dt) => {
    for (let i = 0; i < list.length; i++) {
      next[i] -= dt; if (next[i] > 0) continue;
      next[i] = 6 + Math.random() * 10; one(list[i]);
      if (list.length > 1 && Math.random() < 0.3) { const j = (i + 1 + (Math.random() * (list.length - 1) | 0)) % list.length; next[j] = Math.min(next[j], 0.4 + Math.random() * 0.6); }
    }
  });
}
const quiet = { set() {}, stop() {}, swell() {} };
// The player's right palm, open and facing up, carried to a world point by two-bone IK (makePlayerBody ikRight), for a body
// carried on the camera: reach(P, k), k 0 = arm at rest by the side, 1 = palm centre on P (as at the crossroads).
const PALM = V(-0.022, -0.06, 0);
function palmReach(me) {
  const mu = me.userData, hr = mu.handRigR;
  mu.relax(0.1); me.updateMatrixWorld(true);
  const qi = me.getWorldQuaternion(new THREE.Quaternion()).invert();
  const W0 = me.worldToLocal(mu.handR.getWorldPosition(V(0, 0, 0))), Q0 = qi.clone().multiply(mu.handR.getWorldQuaternion(new THREE.Quaternion()));
  const c0 = hr.curls.slice(), sp0 = hr.spread, op0 = hr.opp, tf0 = hr.tflex, cu = [0, 0, 0, 0];
  const pole = V(0.6, -1, 0.2), W = V(0, 0, 0), Wc = V(0, 0, 0), Wb = V(0, 0, 0), C = V(0, 0, 0), f = V(0, 0, 0), rt = V(0, 0, 0), hx = V(0, -1, 0), hy = V(0, 0, 0), hz = V(0, 0, 0);
  const Q = new THREE.Quaternion(), Qw = new THREE.Quaternion(), Ql = new THREE.Quaternion(), m4 = new THREE.Matrix4();
  return (P, k) => {
    E.camera.updateMatrixWorld(true); me.updateMatrixWorld(true); me.getWorldQuaternion(qi).invert();
    E.camera.getWorldDirection(f); f.y = 0; f.normalize(); rt.set(-f.z, 0, f.x);
    hy.copy(f).addScaledVector(rt, -0.25).normalize().negate(); hz.crossVectors(hx, hy);
    Ql.copy(qi).multiply(Qw.setFromRotationMatrix(m4.makeBasis(hx, hy, hz)));
    Wc.copy(me.worldToLocal(W.copy(P))).sub(C.copy(PALM).applyQuaternion(Ql));
    Wb.copy(Wc).add(V(0, -0.08, 0.05));
    C.copy(W0).lerp(Wb, 0.5).add(V(0.12, 0.02, 0));
    if (k < 0.75) { const t = sst(0, 0.75, k); W.copy(W0).multiplyScalar((1 - t) * (1 - t)).addScaledVector(C, 2 * t * (1 - t)).addScaledVector(Wb, t * t); }
    else W.lerpVectors(Wb, Wc, sst(0.75, 1, k));
    mu.ikRight(W, Q.slerpQuaternions(Q0, Ql, sst(0.05, 0.6, k)), pole);
    const h = sst(0.1, 0.6, k); for (let i = 0; i < 4; i++) cu[i] = lerp(c0[i], 0.05 + i * 0.03, h);
    hr.set(cu, lerp(sp0, 0.45, h), lerp(op0, 0.05, h), lerp(tf0, 0.05, h));
  };
}
const armOnly = () => { const me = makePlayerBody(), mu = me.userData; mu.torso.children[0].visible = false; mu.legs.visible = false; mu.armL.visible = false; return me; };
// a walk round the gallery by angle and radius (never across the pit), facing the way you go
function walkPolar(a1, r1, speed = 1.3) {
  const p = E.camera.position, a0 = Math.atan2(p.x, p.z), r0 = Math.hypot(p.x, p.z), da = wrapA(a1 - a0);
  const len = Math.hypot(da * (r0 + r1) / 2, r1 - r0), dur = Math.max(0.5, len / speed);
  let k = 0; E.stride = 0.75;
  return new Promise((res) => { const off = on((dt) => {
    k = Math.min(1, k + dt / dur); const e = sst(0, 1, k), a = a0 + da * e, r = lerp(r0, r1, e), a2 = a0 + da * Math.min(1, e + 0.04), r2 = lerp(r0, r1, Math.min(1, e + 0.04));
    p.set(Math.sin(a) * r, 1.6, Math.cos(a) * r);
    if (k < 0.97) { const want = Math.atan2(-(Math.sin(a2) * r2 - p.x), -(Math.cos(a2) * r2 - p.z)); E.yaw += wrapA(want - E.yaw) * Math.min(1, dt * 3.2); E.pitch += (-0.04 - E.pitch) * Math.min(1, dt * 2); }
    if (k >= 1) { off(); E.stride = 0; E.yaw = wrapA(E.yaw); res(); }
  }); });
}
// a mantis going round the gallery ahead of you, robe trailing; ends turned to face `face` (a point)
function glide(H, a1, r1, face, speed = 1.5) {
  const a0 = Math.atan2(H.position.x, H.position.z), r0 = Math.hypot(H.position.x, H.position.z), da = wrapA(a1 - a0), dur = Math.max(0.6, Math.hypot(da * (r0 + r1) / 2, r1 - r0) / speed);
  let k = 0;
  return new Promise((res) => { const off = on((dt) => {
    k = Math.min(1, k + dt / dur); const e = sst(0, 1, k), a = a0 + da * e, r = lerp(r0, r1, e), a2 = a0 + da * Math.min(1, e + 0.05), r2 = lerp(r0, r1, Math.min(1, e + 0.05));
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    let want = k < 0.8 ? Math.atan2(Math.sin(a2) * r2 - x, Math.cos(a2) * r2 - z) : Math.atan2(face.x - x, face.z - z);
    H.rotation.y += wrapA(want - H.rotation.y) * Math.min(1, dt * 2.5); H.position.set(x, H.position.y, z);
    if (k >= 1) { off(); res(); }
  }); });
}
const faceTo = (H, p, dt, rate = 1.2) => { const want = Math.atan2(p.x - H.position.x, p.z - H.position.z); H.rotation.y += wrapA(want - H.rotation.y) * Math.min(1, dt * rate); };
// wait for E while a hint offers it (also the touch ACT button); gives up after `timeout` seconds so nobody is stuck
async function pressE(text, timeout = 14) {
  hint(text); E.canAct = true; let done = false;
  const off = on(() => { if (E.just.has('KeyE')) done = true; });
  await until(() => done, timeout);
  off(); E.canAct = false; hint('');
  return done;
}
// closest approach of two segments (for the arm checks)
function segDist(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2), a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), c = d1.dot(r), b = d1.dot(d2), den = a * e - b * b;
  let s = den > 1e-9 ? c01((b * f - c * e) / den) : 0, t = e > 1e-9 ? (b * s + f) / e : 0;
  if (t < 0) { t = 0; s = c01(-c / a); } else if (t > 1) { t = 1; s = c01((b - c) / a); }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}
// developer checks for a mantis's arms: least gap between a limb's surface and the robe (skipping the first 13 cm out of
// each extra shoulder, which is set into the robe by design, and the main arms' upper arms, inside their sleeves), and the
// least gap between the surfaces of any two arms. Radii: the extra arms' sleeves 5 cm, forearms 3.2, hands 2.2; the
// main arms' parts 3 cm.
function mantisCheck(m) {
  const u = m.userData, segs = [], p = V(0, 0, 0); let gap = 9, between = 9, gapOf = '', betweenOf = '';
  m.updateMatrixWorld(true); const inv = u.root.matrixWorld.clone().invert(), names = ['upper', 'fore', 'hook'], sc = u.root.getWorldScale(V(0, 0, 0)).x;
  for (const a of u.arms) { const S = a.sh.getWorldPosition(V(0, 0, 0)), El = a.el.getWorldPosition(V(0, 0, 0)), Wr = a.wr.getWorldPosition(V(0, 0, 0)), Tp = armTip(a, V(0, 0, 0)); const rr = a.lvl === 1 ? [0.03, 0.03, 0.03] : [0.05, 0.032, 0.022]; segs.push([a, S, El, 0, rr[0]], [a, El, Wr, 1, rr[1]], [a, Wr, Tp, 2, rr[2]]);
    [[S, El, a.lvl === 1 ? 1 : 0.3], [El, Wr, 0], [Wr, Tp, 0]].forEach(([x, y, k0], n) => { for (let i = 0; i <= 6; i++) { const k = k0 + (1 - k0) * i / 6; p.lerpVectors(x, y, k).applyMatrix4(inv); const g = robeGap(p) - rr[n]; if (g < gap) { gap = g; gapOf = 'arm' + a.s + ' ' + names[n]; } } }); }
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segs[i][0] !== segs[j][0]) { const d = segDist(segs[i][1], segs[i][2], segs[j][1], segs[j][2]) - (segs[i][4] + segs[j][4]) * sc; if (d < between) { between = d; betweenOf = 'arm' + segs[i][0].s + ' ' + names[segs[i][3]] + ' / arm' + segs[j][0].s + ' ' + names[segs[j][3]]; } }
  return { gap, between, gapOf, betweenOf };
}
// The weaver's head turned round to the viewer the long way, like an owl's: k 0 facing ahead .. 1 aimed at the eyes. The
// yaw is measured afresh every frame from the head's own neck (so it ends on the eyes wherever they are), unwrapped the long
// way round (past the shoulder and the back of the robe), and eased; the head also tips down or up onto the eyes. The long
// way is chosen once, when the turn starts, and the end angle then follows the eyes continuously (never flips by a turn).
const _owl = V(0, 0, 0), _owlQ = new THREE.Quaternion();
function owlTurn(wu, k) {
  const h = wu.head; h.rotation.order = 'YXZ';
  if (!(k > 0)) { h.rotation.y = 0; wu.owlT = null; return; }
  wu.neck.updateWorldMatrix(true, false); wu.neck.getWorldPosition(_owl); const hy = _owl.y + 0.34 * WEAVER_SCALE;
  _owl.subVectors(E.camera.position, _owl); wu.neck.getWorldQuaternion(_owlQ).invert(); _owl.applyQuaternion(_owlQ);
  const rel = Math.atan2(_owl.x, _owl.z);
  if (wu.owlT == null) wu.owlT = rel - (rel < 0 ? -TAU : TAU); else wu.owlT += wrapA(rel - wu.owlT);
  const e = sst(0, 1, k);
  h.rotation.y = wu.owlT * e;
  h.rotation.x += Math.atan2(hy - E.camera.position.y, Math.hypot(_owl.x, _owl.z)) * 0.85 * sst(0.55, 1, k);
}
const faceView = (p, dur) => { const a = aimAt(p); return moveView(dur, { yaw: E.yaw + wrapA(a.yaw - E.yaw), pitch: a.pitch }); };

export async function control() {
  const P0 = performance.now(), perf = window.UAP ? (window.UAP.ctrlPerf = []) : null, mark = (n) => { if (perf) perf.push(n + ' ' + (performance.now() - P0).toFixed(1)); };
  // from the crossroads: its room, the tall one and your arm, as they stood (ship.js), and the hall built ahead while they
  // stood there (prebuild); absent on a developer start
  const carry = E.carry; E.carry = null;
  const pre = carry && carry.pre;
  hallScene();
  const set = pre ? pre.set : await makeHallSet();
  if (pre) { E.scene.add(set.hall.g); for (const [o, m] of pre.swap) o.material = m; }
  mark('hall');
  const { hall, loom, wx, link, crew, weaverH, weaver, maroonH, maroon, collared } = set, wu = weaver.userData, cu = collared.userData;
  const { g } = hall, { threads, beads } = loom;
  const guideH = new THREE.Group(), guide = carry ? carry.mantis : makeMantis(); g.add(guideH);
  // where you come in, and the tall one beside you
  const START = polar(A_DOOR + 0.02, 7.6, 1.6);
  let cross = null;
  if (carry) {
    // the crossroads is set down round you as it stood: turned and moved so your eyes are at START facing the middle of the
    // hall; the tall one, still holding your hand, comes into the hall's cast where they stand
    const cg = carry.group, pc = E.camera.position.clone(), yc = E.yaw, pitch = E.pitch, yh = Math.atan2(START.x, START.z), dy = yh - yc;
    cg.rotation.y = dy; { const r = pc.clone().applyAxisAngle(V(0, 1, 0), dy); cg.position.set(START.x - r.x, 0, START.z - r.z); }
    cg.updateMatrixWorld(true);
    setView(START.x, START.y, START.z, yh, pitch); E.shake = 0.0035;
    const wp = guide.getWorldPosition(V(0, 0, 0)), wq = guide.getWorldQuaternion(new THREE.Quaternion()), fw = V(0, 0, 1).applyQuaternion(wq);
    guideH.position.set(wp.x, wp.y - guide.position.y, wp.z); guideH.rotation.y = Math.atan2(fw.x, fw.z); guide.rotation.set(0, 0, 0); guide.position.set(0, guide.position.y, 0); guideH.add(guide);
    if (!pre) { ownMaterials(guide); ownMaterials(carry.me); }
    const lights = []; cg.traverse((o) => { if (o.isLight) lights.push([o, o.intensity]); });
    cross = { cg, lights, me: carry.me, hum: carry.hum || quiet, lift: guideH.position.y, rv: RV_HALL.uRv };
  } else {
    setView(START.x, START.y, START.z, 0, 0); { const aim = aimAt(V(0, 0.6, 0)); E.yaw = E.base.yaw = aim.yaw; E.pitch = E.base.pitch = -0.05; }
    guideH.add(guide); guideH.position.copy(polar(A_DOOR + 0.27, 6.5)); guideH.rotation.y = Math.atan2(-guideH.position.x, -guideH.position.z);
  }
  E.mode = 'look'; E.limits = null;
  // state the frame loop reads
  const S = { wt: 0, pause: 0, mode: 'weave', gaze: false, focus: null, held: null, guideFace: true, collarLook: null, headK: 0, hands: [] };
  const amb = cue('ctrlRoom') || quiet;
  for (const b of beads) { b.on = 1; b.snd = cue('beadWorld', b.kind) || quiet; }
  chirps([guide, weaver, maroon]);
  // ----- the weaver's arms -----
  const arms = wu.arms, tV = V(0, 0, 0), tV2 = V(0, 0, 0), lat = V(0, 0, 0), rad = V(0, 0, 0);
  arms.forEach((a, i) => { a.th = threads.find((th) => th.d.s === a.s) || null; a.st = 'hold'; a.t0 = -i * 0.8; a.dur = 2.6 + ((i * 1.7) % 2.5); a.from = V(0, 0, 0); a.grab = a.th ? a.th.rest.clone() : V(0, 0, 0); a.ph = i * 2.1; a.script = null; a.grip = 0.8;
    a.tip.copy(a.th ? a.th.rest : loom.wPt(a.home.x, a.home.y, a.home.z)); });
  const weaveStep = (dt) => {
    S.wt += dt * (1 - S.pause); const t = S.wt;
    weaver.updateMatrixWorld(true);
    for (const a of arms) {
      const th = a.th;
      if (a.script || (a.th && !a.th.gone)) a.foldAt = null;
      if (a.script) a.script(dt, t);
      else if (th && !th.gone) {
        const age = t - a.t0, d = th.d;
        if (a.st === 'hold') {
          // the hook draws its thread up, across and round its neighbours; eased in from wherever it took hold
          const ramp = sst(0, 1.2, age);
          lat.set(Math.cos(d.az), 0, -Math.sin(d.az)); rad.set(Math.sin(d.az), 0, Math.cos(d.az));
          // (the sideways sweep carries the thread across toward its neighbour's and back: passing it over and under)
          tV.set(Math.sin(d.az) * d.r, d.y, Math.cos(d.az) * d.r).addScaledVector(lat, 0.14 * Math.sin(age * 1.5 + a.ph * 1.3) * ramp).addScaledVector(rad, 0.08 * Math.sin(age * 1.9 + a.ph * 0.7) * ramp);
          tV.y += (0.06 + 0.07 * Math.sin(age * 2.3 + a.ph)) * ramp;
          loom.wFrame.localToWorld(tV); a.tip.lerpVectors(a.grab, tV, sst(0, 0.7, age)); th.H.copy(a.tip); th.held = true; a.grip = 0.8;
          if (age > a.dur || (S.mode !== 'weave' && t > a.relAt)) { a.st = 'release'; a.t0 = t; a.from.copy(a.tip); a.Hfrom = th.H.clone(); th.Hv.set(0, 0, 0); th.vib = 0.012; th.vibT = 0; cue('loomPluck', th.i); }
        } else if (a.st === 'release') {
          // passes it back: the hook eases the thread home to where it hangs (still running through the hook, so it never
          // snaps away from it), opening as it goes, and slides 10 cm up it, close beside it, to take it again higher up
          th.H.lerpVectors(a.Hfrom, th.rest, sst(0, 0.7, age)); th.held = true;
          tV.subVectors(th.G, th.H).normalize(); lat.set(tV.z, 0, -tV.x).normalize();
          a.tip.copy(th.H).addScaledVector(tV, 0.1 * sst(0.2, 0.85, age)).addScaledVector(lat, 0.02 * Math.sin(Math.min(1, age / 0.9) * PI));
          a.grip = lerp(0.8, 0.15, sst(0, 0.2, age)) + 0.5 * sst(0.6, 0.9, age);
          if (age > 0.9) { th.held = false; th.Hv.set(0, 0, 0); if (S.mode === 'weave') { a.st = 'reach'; a.t0 = t; a.from.copy(a.tip); } else a.th = null; }
        } else {
          const k = sst(0, 0.55, age); a.tip.lerpVectors(a.from, th.H, k); a.grip = lerp(0.15, 0.8, sst(0.45, 0.55, age));
          if (age >= 0.55) { a.st = 'hold'; a.t0 = t; a.dur = 2.6 + Math.random() * 2.8; a.grab.copy(th.H); }
        }
      } else {
        // nothing to hold: the hook comes back in before the chest
        if (a.foldAt == null) a.foldAt = t;   // (it sets off gently: the pull home builds over its first 0.8 s, no jump from rest to full speed)
        loom.wFrame.localToWorld(tV.copy(a.home)); a.tip.lerp(tV, 1 - Math.exp(-dt * (1 - S.pause) * 1.6 * sst(0, 0.8, t - a.foldAt))); a.grip += (0.5 - a.grip) * Math.min(1, dt * 3);
      }
      a.poleNow.lerp(a.th || a.script ? a.pole : a.foldPole, 1 - Math.exp(-dt * (1 - S.pause) * 2.5));
      a.downNow = (a.downNow ?? 0.45) + ((a.script ? 0.3 : a.nrm ? 0.15 : 0.45) - (a.downNow ?? 0.45)) * (1 - Math.exp(-dt * (1 - S.pause) * 4));
      armTo(weaver, a, a.tip, a.poleNow, a.downNow); wu.hooks(a, a.grip);
    }
    // a thread nobody holds goes back to where it hangs, and shivers as it goes
    const n = Math.max(1, Math.ceil(dt * (1 - S.pause) / 0.008)), h = dt * (1 - S.pause) / n;
    for (const th of threads) {
      if (!th.held && !th.fixed && h > 0) for (let i = 0; i < n; i++) { th.Hv.addScaledVector(tV.subVectors(th.rest, th.H), 120 * h).multiplyScalar(1 - 5 * h); th.H.addScaledVector(th.Hv, h); }
      th.vib *= Math.exp(-dt * 2.4); th.vibT += dt;
      if (!th.gone) loom.lay(th, TIME.value);
    }
  };
  // ----- beads: the one you look at comes to you -----
  const gazeStep = (dt, t) => {
    let best = null, bd = 9;
    if (S.gaze && !S.held) for (const b of beads) if (!b.off) { const ang = angleTo(b.pos), tol = b === S.focus ? 0.34 : 0.09; if (ang < tol && ang < bd) { bd = ang; best = b; } }
    if (S.tour) best = S.tour;
    if (!S.held && best !== S.focus) { S.focus = best; if (best) { loom.beadRest(best, best.rest); tV.subVectors(best.rest, E.camera.position).normalize(); tV.y = Math.max(-0.25, Math.min(0.12, tV.y)); best.focusP.copy(E.camera.position).addScaledVector(tV.normalize(), 0.62); } }
    for (const b of beads) {
      if (b.off) continue;
      const want = b === S.focus || b === S.held ? 1 : 0; b.k += (want - b.k) * (1 - Math.exp(-dt * (want ? 1.4 : 2.0)));
      loom.beadRest(b, b.rest); const e = sst(0, 1, b.k);
      b.pos.lerpVectors(b.rest, b.focusP, e); b.mesh.position.copy(b.pos); b.mesh.scale.setScalar((1 + 0.5 * e) * (b.shrink ?? 1));
      const L = loom.world.LOOP[b.kind], tl = L ? (t + b.t0) % L : 9, dip = L ? Math.min(1, tl / 0.4, (L - tl) / 0.4) : 1;
      b.U.uOn.value = b.on * (0.8 + 0.2 * e) * dip; b.glow.material.opacity = 0.3 * (1 - e) * b.on;
      b.snd.set(e * e * b.on);
    }
  };
  // the tall grey at the table: hands that are in use are solved every frame
  const cHands = ['L', 'R'].map((sd) => ({ sd, reach: greyReach(collared, sd), P: V(0, 0, 0), on: false }));
  collared.updateMatrixWorld(true);
  for (const h of cHands) { h.hang = collared.worldToLocal(h.reach.tip(V(0, 0, 0))); h.sh = cu['arm' + h.sd].getWorldPosition(V(0, 0, 0)); }
  let cWalk = 0; const cRest = wx.W(0.3, TOP + 0.1, 0), cLook = cRest.clone();
  on((dt, t) => {
    idleMantis(guide, dt, t); idleMantis(maroon, dt, t); idleMantis(weaver, dt, t);
    if (S.guideFace) faceTo(guideH, E.camera.position, dt, 0.9);
    wu.shift(t); owlTurn(wu, S.headK);
    weaveStep(dt); gazeStep(dt, t); loom.drawWorlds(t, S.held || S.focus);
    crew.update(dt, t);
    if (!cWalk) idleGrey(collared, t);
    cLook.lerp(S.collarLook || cRest, Math.min(1, dt * 2.2)); aimGrey(collared, cLook, 0.9); cu.neck.rotation.x += S.collarNod || 0;
    for (const h of cHands) if (h.on) { if (h.carry) h.P.copy(carryPt(h)); h.reach(h.P); }
    hall.lights.guideL.position.lerp(tV.copy(E.camera.position).setY(3.3), Math.min(1, dt * 2));
  });
  if (window.UAP) window.UAP.ctrl = { hall, loom, wx, link, crew, weaver, guide, maroon, collared, S, cHands, mantisCheck, armTip, threads, beads, cross };
  if (cross) {
    RV_HALL.uRv.value.set(START.x, START.y, START.z, 0.2); rvHook();
    if (!pre) { ownCached(g, guide); rvPatch(g, RV_HALL, new Set([guide])); rvPatch(cross.cg, RV_CROSS); warm(g, cross.cg); }
  } else warm(g);
  mark('compiled');
  loom.drawWorlds(0, null);
  mark('beads drawn');
  if (perf) { let n = 0; on(() => { if (++n <= 3) mark('frame ' + n); }); }

  // ===== 1. arrival =====
  if (cross) await fromCrossroads(cross, { S, guide, guideH, hall });
  else await fade(0, 2.4, '#fff');
  await say('They have brought you higher. Here they work.');
  note('robes');
  await say('A round hall, dark, tier under tier. Small grey ones at the walls. None of them looks up.');
  cue('inner');
  await say('You wished to see more. This is what we do.', 'them');
  // free to walk the near part of the gallery; the tall one goes to the head of the deck that runs out over the pit
  E.mode = 'walk';
  E.bounds = (x, z) => {
    if (Math.abs(x) < 0.72 && z > TONGUE_Z && z < 5.7) return true;
    if (z <= TONGUE_Z && x * x + (z - TONGUE_Z) * (z - TONGUE_Z) < 0.72 * 0.72) return true;
    const r = Math.hypot(x, z), a = Math.atan2(x, z);
    return r > 5.6 && r < 8.7 && a > -1.3 && a < 0.55 && Math.hypot(x - guideH.position.x, z - guideH.position.z) > 0.75;
  };
  S.guideFace = false; const gl = glide(guideH, 0.2, 6.3, V(0, 0, 0), 1.2).then(() => { S.guideFace = true; });
  hint('W A S D to walk, SHIFT to run.  The tall one is waiting by the rail.');
  say('Others like the tall one, in other colours. One in maroon by the far wall. One in silver in the middle of it all.');
  await until(() => { const p = E.camera.position; return Math.abs(p.x) < 0.9 && p.z < 4.9; }, 30);
  hint(''); E.mode = 'locked'; E.bounds = null; await gl;

  // ===== 2. the loom =====
  { const p = E.camera.position; if (!(Math.abs(p.x) < 0.9 && p.z < 5.6)) { await walkPolar(0, Math.max(6.2, Math.min(8, Math.hypot(p.x, p.z)))); } }
  { const stand = V(0, 1.6, 3.15), to = V(-0.95, 1.55, 0.95);
    const d = to.clone().sub(stand).normalize(); await moveView(Math.max(1, E.camera.position.distanceTo(stand) / 1.2), { pos: stand, yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(d.y), walk: 0.7 }); }
  E.base.yaw = E.yaw; E.base.pitch = E.pitch; E.limits = { yaw: 1.25, up: 1.0, down: 0.85 }; E.mode = 'look';
  note('weave');
  await say('Threads of light stand up out of the basin. One in silver weaves them together, quickly, with more arms than they should have.');
  await say('Their robe goes red, then blue, then indigo, and is silver again.');
  note('basin');
  await say('The basin is full of small lights, and each one is a life. Somewhere in it, someone is brushing their teeth.');
  cue('inner');
  await say('Tonight, in a field, some of your kind are calling us.', 'them');
  // The view leaves your eyes and goes round the beads: up and forward off your head, out round the far side of the beads
  // (away from the weaver and their threads) low, back round higher and wider, and down into your head again, ending on
  // the view you had. One closed loop on a smooth spline, travelled at an eased speed that slows as it passes each bead;
  // it looks at the beads throughout, leaning a little toward the one it is passing. While the view is outside your head,
  // your own body stands at the rail (standingSelf), its head hidden while the view is within 35 cm of your eyes.
  {
    E.mode = 'locked'; const lim0 = E.limits; E.limits = null;   // (the look range at the stand would clamp the orbit's aim)
    const eye = E.camera.position.clone(), yaw0 = E.yaw, pitch0 = E.pitch, fov0 = E.camera.fov;
    const C = beads.reduce((o, b) => o.add(b.rest), V(0, 0, 0)).multiplyScalar(1 / beads.length);
    const fw = V(-Math.sin(yaw0), 0, -Math.cos(yaw0)), th0 = Math.atan2(eye.x - C.x, eye.z - C.z);
    const at = (th, r, h) => V(C.x + Math.sin(th) * r, h, C.z + Math.cos(th) * r);
    // up off your head, one full turn round the beads at an even radius and height (a little higher on the far side,
    // over the weaver's head), and back down into your eyes; travelled at one steady speed, eased only at the two ends
    const Q = eye.clone().addScaledVector(fw, 0.45).add(V(0, 0.5, 0));
    const ORB = { r: 3.0, h: 2.6, rise: 0.6, n: 16 };
    const pts = [eye.clone(), Q];
    for (let k = 0; k <= ORB.n; k++) { const q = k / ORB.n; pts.push(at(th0 + 0.3 + 2 * PI * q, ORB.r, ORB.h + ORB.rise * Math.sin(PI * q))); }
    pts.push(Q.clone().addScaledVector(fw, -0.05), eye.clone());
    const path = new THREE.CatmullRomCurve3(pts, false, 'centripetal'), L = path.getLength();
    // where it passes each bead (kept for the check drivers); no slowing there now
    const left = beads.slice(), near = [0.2, 0.38, 0.56, 0.74].map((u) => { const p = path.getPointAt(u); left.sort((a, b) => a.rest.distanceTo(p) - b.rest.distanceTo(p)); return { b: left.shift(), u }; });
    const ORBIT_S = 10.5;   // seconds for the whole loop at the steady speed (plus a little for the eased ends)
    const speed = (u) => 0.22 + 0.78 * sst(0, 0.07, u) * sst(1, 0.93, u);
    const self = standingSelf(eye, yaw0); g.add(self.me);
    if (window.UAP) Object.assign(window.UAP.ctrl, { orbit: { path, C, self, near } });
    const aimP = C.clone(), look = V(0, 0, 0); let u = 0, done = false, yawT = yaw0;   // (yawT: the aim's turn, followed continuously)
    say('Each of these is one way their night can go.', 'them');
    const orbit = on((dt) => {
      u = Math.min(1, u + dt * speed(u) / ORBIT_S);
      const p = path.getPointAt(u); E.camera.position.copy(p);
      // the aim: the beads' middle, drawn toward the bead being passed; at both ends the view you had (eased in and out)
      const n = near.reduce((m, x) => (Math.abs(x.u - u) < Math.abs(m.u - u) ? x : m)), pull = Math.exp(-((u - n.u) * (u - n.u)) / 0.004);
      look.copy(C).lerp(n.b.rest, 0.15 * pull); aimP.lerp(look, Math.min(1, dt * 2));
      const a = aimAt(aimP), w = sst(0.0, 0.08, u) * sst(1.0, 0.9, u); yawT += wrapA(a.yaw - yawT);
      // after a full turn the aim has gone round once: blend back to the start yaw plus those whole turns, not unwinding them
      const yawE = yaw0 + 2 * PI * Math.round((yawT - yaw0) / (2 * PI)) * (u > 0.5 ? 1 : 0);
      E.yaw = lerp(yawE, yawT, w); E.pitch = lerp(pitch0, a.pitch, w);
      E.camera.fov = lerp(fov0, 62, w); E.camera.updateProjectionMatrix();
      self.head.visible = p.distanceTo(eye) > 0.35;
      if (u >= 1) done = true;
    });
    for (const b of beads) b.seen = true;
    await until(() => done, 60);
    orbit(); discard(self.me);
    E.camera.position.copy(eye); E.yaw = yaw0; E.pitch = pitch0; E.camera.fov = fov0; E.camera.updateProjectionMatrix();
    E.base.yaw = E.yaw; E.base.pitch = E.pitch; E.limits = lim0; E.mode = 'look';
  }
  S.gaze = true;
  let touched = null;
  {
    const t0 = E.time; let allAt = 0;
    await new Promise((res) => { const off = on(() => {
      const f = S.focus, can = f && f.k > 0.85;
      E.canAct = !!can; hint(can ? 'E — hold the bead' : 'Look at a bead to bring it close.');
      if (can && E.just.has('KeyE')) { touched = f; off(); return res(); }
      if (!allAt && beads.every((b) => b.seen)) allAt = E.time;
      if ((allAt && E.time - allAt > 7 && !f) || (allAt && E.time - allAt > 16) || E.time - t0 > 55) { off(); res(); }
    }); });
    E.canAct = false; hint('');
  }
  const weaverHead = () => wu.head.getWorldPosition(V(0, 0, 0));
  const gold = threads[GOLD], goldBead = gold.bead, mainL = arms.find((a) => a.s === -1), mainR = arms.find((a) => a.s === 1);
  const linePt = (y, o) => o.lerpVectors(gold.B, gold.G, (y - gold.B.y) / (gold.G.y - gold.B.y));
  const fray = async (th) => {
    cue('loomFray', th.i);
    const b = th.bead;
    tween(1.7, (k) => { th.U.uFray.value = k; }, (k) => k);
    if (b) {
      await tween(0.9, (k) => { b.on = 1 - k; }, (k) => k);
      b.off = true; const y0 = b.pos.y, x = b.pos.x, z = b.pos.z;
      await tween(Math.sqrt(2 * (y0 - BASIN_Y) / 9.8), (k) => { b.mesh.position.set(x, lerp(y0, BASIN_Y, k * k), z); }, (k) => k);
      hall.basinU.uDrop.value.set(x, -z, TIME.value, Math.hypot(x, z) < BASIN_R ? 1 : 0); cue('basinDrop'); b.snd.stop(0.5); discard(b.mesh);
    } else await wait(1.0);
    await wait(0.4); th.gone = true; th.mesh.visible = false;
  };
  const frayOthers = async () => { const order = [0, 6, 1, 5, 2, 4]; for (let i = 0; i < order.length; i++) { const p = fray(threads[order[i]]); if (i === order.length - 1) await p; else await wait(0.85); } };
  const letGo = async () => { arms.forEach((a, i) => { a.relAt = S.wt + 0.2 + [0, 3, 1, 4, 2, 5][i] * 0.22; }); S.mode = 'tie'; await wait(1.5); };
  let byYou = false;
  if (touched) {
    // the bead settles over your open hand
    E.mode = 'locked'; S.held = touched; S.focus = null;
    const me = armOnly(); E.camera.add(me); const reach = palmReach(me), fw = V(0, 0, 0), hold = V(0, 0, 0), palm = V(0, 0, 0);
    if (window.UAP) window.UAP.ctrl.hand = me;
    E.camera.getWorldDirection(fw); fw.y = 0; fw.normalize();
    hold.copy(E.camera.position).addScaledVector(fw, 0.42).add(V(-fw.z * 0.06, -0.11, fw.x * 0.06));
    const f0 = touched.focusP.clone(), aim = aimAt(hold.clone().add(V(0, -0.06, 0)));
    moveView(1.6, { yaw: aim.yaw, pitch: aim.pitch });
    await tween(1.7, (k) => { touched.focusP.lerpVectors(f0, hold, sst(0, 0.8, k)); touched.shrink = lerp(1, 0.8, sst(0, 0.8, k)); reach(palm.copy(touched.focusP).add(V(0, -BEAD_R * 1.5 * (touched.shrink ?? 1) - 0.016, 0)), k); }, (k) => k);
    G.lucidity = Math.min(1, G.lucidity + 0.04);
    // the hand stays under the bead while the view moves (the arm is carried on the view)
    const holdOn = on(() => { reach(palm.copy(touched.pos).add(V(0, -BEAD_R * 1.5 * (touched.shrink ?? 1) - 0.016, 0)), 1); });
    tween(0.7, (k) => { S.pause = k; });
    await say('It settles over your palm, cold as a window in winter.');
    // you look up from your hand (held a little lower, out of the middle of the view): the silver one's head comes round
    const holdUp = touched.focusP.clone(), holdLow = holdUp.clone().add(V(0, -0.13, 0)).addScaledVector(fw, -0.05);
    tween(1.3, (k) => { touched.focusP.lerpVectors(holdUp, holdLow, k); });
    faceView(weaverHead(), 1.3); tween(4.6, (k) => { S.headK = k; }, (k) => k);
    await say('The silver one stops. Every arm stops. Their head turns all the way round to you, like an owl\'s.');
    cue('inner');
    await say('The living do not touch the weave. Most who come here have already died.', 'them');
    byYou = touched === goldBead && G.trust >= 2;
    tween(1.2, (k) => { touched.focusP.lerpVectors(holdLow, holdUp, k); });
    { const aim = aimAt(hold.clone().add(V(0, -0.06, 0))); moveView(1.2, { yaw: E.yaw + wrapA(aim.yaw - E.yaw), pitch: aim.pitch }); }
    if (byYou) {
      await say('They open their hooks, and wait.');
      tween(0.8, (k) => { S.pause = 1 - k; });
      await letGo(); await wait(1.2);
      // the thread draws tight through the bead in your hand, and the gold runs out from it both ways
      gold.fixed = true; cue('loomTie'); const H0 = gold.H.clone(), HL = linePt(gold.rest.y, V(0, 0, 0));
      gold.U.uGoldAt.value = 0.42;
      await tween(1.5, (k) => { gold.slack = 1 - k; gold.H.lerpVectors(H0, HL, k); }, (k) => k * k);
      gold.vib = 0.03; gold.vibT = 0;
      tween(2.4, (k) => { gold.U.uGold.value = k; goldBead.U.uGold.value = k; }, (k) => k);
      await say('The thread pulls tight through your hand. Where it touches you it turns to gold.');
      G.wove = true;
    } else {
      await say(touched === goldBead ? 'Then they turn their head back, and every arm takes up the weave again without you.' : 'Then they turn back to the one thread they want.');
      tween(0.8, (k) => { S.pause = 1 - k; });
    }
    // it goes back to its thread; your hand comes down
    holdOn(); S.held = null; tween(3.6, (k) => { S.headK = 1 - k; }, (k) => k);
    await tween(1.3, (k) => { reach(palm.copy(touched.pos).add(V(0, -BEAD_R * 1.5 * (touched.shrink ?? 1) - 0.016 - 0.1 * k, 0)), 1 - k); }, (k) => k);
    discard(me); E.mode = 'look';
  }
  S.gaze = false; S.focus = null;
  if (!touched) {
    // nobody reached for a bead: the weaver looks round at you all the same, and says their piece
    tween(0.7, (k) => { S.pause = k; }); E.mode = 'locked'; faceView(weaverHead(), 1.3); tween(4.6, (k) => { S.headK = k; }, (k) => k);
    await say('The silver one stops. Their head turns all the way round to you, like an owl\'s.');
    cue('inner');
    await say('You are still alive. Most who stand here have already died.', 'them');
    E.base.yaw = E.yaw; E.base.pitch = E.pitch; E.mode = 'look';
    tween(0.8, (k) => { S.pause = 1 - k; }); tween(3.6, (k) => { S.headK = 1 - k; }, (k) => k);
    await wait(1.2);
  }
  if (!byYou) {
    cue('inner');
    say('We are choosing one.', 'them');
    await letGo(); await wait(1.7);
    // two hooks take the one thread, one above the other, and draw it into a straight line
    gold.fixed = true;
    const lo0 = gold.H.clone(), hi0 = lo0.clone().add(tV2.subVectors(goldBead.pos, lo0).normalize().multiplyScalar(0.4)), lo1 = linePt(lo0.y - 0.08, V(0, 0, 0)), hi1 = linePt(lo0.y + 0.52, V(0, 0, 0));
    const fromL = mainL.tip.clone(), fromR = mainR.tip.clone(); let ph = 0, pk = 0;
    mainL.script = () => { if (ph === 0) mainL.tip.lerpVectors(fromL, lo0, pk); else if (ph === 1) { mainL.tip.lerpVectors(lo0, lo1, pk); gold.H.copy(mainL.tip); } mainL.grip = ph === 0 ? lerp(0.3, 0.9, sst(0.8, 1, pk)) : ph === 3 ? lerp(0.9, 0.2, pk) : 0.9; };
    mainR.script = () => { if (ph === 0) mainR.tip.lerpVectors(fromR, hi0, pk); else if (ph === 1) { mainR.tip.lerpVectors(hi0, hi1, pk); gold.H2.copy(mainR.tip); } mainR.grip = ph === 0 ? lerp(0.3, 0.9, sst(0.8, 1, pk)) : ph === 3 ? lerp(0.9, 0.2, pk) : 0.9; };
    await tween(1.5, (k) => { pk = k; });
    gold.H2 = hi0.clone(); ph = 1; pk = 0;
    say('The silver one takes a single thread in two hooks and draws it tight.');
    cue('loomTie'); gold.U.uGoldAt.value = 0.2;
    await tween(1.5, (k) => { pk = k; gold.slack = 1 - k; }, (k) => k * k);
    ph = 2; gold.vib = 0.03; gold.vibT = 0;
    tween(2.6, (k) => { gold.U.uGold.value = k; goldBead.U.uGold.value = k; }, (k) => k);
    await wait(1.4);
    await say('It turns to gold.');
    S.release = async () => { ph = 3; pk = 0; await tween(0.8, (k) => { pk = k; }); mainL.script = mainR.script = null; mainL.th = mainR.th = null; };
  }
  say('The other threads fray and go dark, one after another.');
  await frayOthers();
  if (S.release) await S.release();
  tween(3, (k) => { loom.warpU.uLevel.value = lerp(0.5, 0.2, k); });
  await wait(1.2);

  // ===== 3. the weather console =====
  E.mode = 'locked'; E.limits = null;
  S.guideFace = false; glide(guideH, A_WEATHER + 0.24, 6.5, wx.W(0, 0, 0), 1.7).then(() => { S.guideFace = true; });
  // the view turns to the table across the hall and holds on it a moment (the table's lip brightens), then you walk there
  { const aim = aimAt(wx.W(0, TOP, 0)); await moveView(2.8, { yaw: E.yaw + wrapA(aim.yaw - E.yaw), pitch: aim.pitch }); }
  tween(1.2, (k) => { wx.lipM.color.setRGB(0.18 + 0.5 * Math.sin(k * PI), 0.5 + 0.45 * Math.sin(k * PI), 0.68 + 0.3 * Math.sin(k * PI)); });
  await wait(1.1);
  {
    const tc = wx.W(0, 0, 0), near = () => Math.hypot(E.camera.position.x - tc.x, E.camera.position.z - tc.z);
    E.mode = 'walk';
    E.bounds = (x, z) => {
      if (Math.abs(x) < 0.72 && z > TONGUE_Z && z < 5.7) return true;
      if (z <= TONGUE_Z && x * x + (z - TONGUE_Z) * (z - TONGUE_Z) < 0.72 * 0.72) return true;
      const r = Math.hypot(x, z), a = Math.atan2(x, z);
      return r > 5.6 && r < 8.7 && a > -0.45 && a < A_WEATHER + 0.75 && Math.hypot(x - tc.x, z - tc.z) > 1.15 && Math.hypot(x - guideH.position.x, z - guideH.position.z) > 0.7 && Math.hypot(x - collared.position.x, z - collared.position.z) > 0.7;
    };
    hint('W A S D to walk, SHIFT to run. Go over to the table.');
    const arrived = await until(() => near() < 1.75, 25);
    hint(''); E.mode = 'locked'; E.bounds = null;
    if (!arrived) {
      // nobody came: walk them there (off the deck first if still on it)
      if (E.camera.position.z < 5.6 && Math.abs(E.camera.position.x) < 0.9) { const back = V(0, 1.6, 5.9), d = back.clone().sub(E.camera.position).normalize(); await moveView(0.9, { yaw: E.yaw + wrapA(Math.atan2(-d.x, -d.z) - E.yaw), pitch: -0.04 }); await moveView(2.3, { pos: back, walk: 0.75 }); }
      await walkPolar(A_WEATHER, 7.26);
    }
    // step up to your place at the table, facing it
    const aim = aimAt(wx.W(0.1, TOP, 0.15)), standW = wx.stand.clone().setY(1.6);
    await moveView(Math.max(0.8, E.camera.position.distanceTo(standW) / 1.1), { pos: standW, yaw: E.yaw + wrapA(aimAt(wx.W(0.1, TOP, 0.15)).yaw - E.yaw), pitch: aim.pitch, walk: 0.7 });
    { const a2 = aimAt(wx.W(0.1, TOP, 0.15)); await moveView(0.6, { yaw: E.yaw + wrapA(a2.yaw - E.yaw), pitch: a2.pitch }); }
  }
  E.base.yaw = E.yaw; E.base.pitch = E.pitch; E.limits = { yaw: 1.2, up: 0.9, down: 0.45 }; E.mode = 'look';
  note('weather');
  await say('A table with the countryside in it, small and dark: hedges, a farm, a lane. In one field, pinpricks of light.');
  await say('Over it stands a tall grey one, in a cloak with a high collar.');
  // which of the tall grey's hands is on the dome's side
  const near = (p) => { collared.updateMatrixWorld(true); for (const h of cHands) cu['arm' + h.sd].getWorldPosition(h.sh); return cHands.slice().sort((a, b) => a.sh.distanceTo(p) - b.sh.distanceTo(p))[0]; };
  const domeTop = wx.tb.localToWorld(wx.dome.position.clone().add(V(0, 0.062, 0))), hD = near(domeTop), hP = cHands.find((h) => h !== hD);
  const raisePt = (h) => collared.localToWorld(V(Math.sign(h.hang.x) * 0.15, 0.6, 0.32));
  const carryPt = (h) => collared.localToWorld(V(Math.sign(h.hang.x) * 0.15, 0.8, 0.26));   // a hand held up before the chest
  const handTo = async (h, to, dur, lift = 0.05) => { if (!h.on) { h.reach.reset(); h.reach.tip(h.P); h.on = true; const a0 = h.P.clone(), up = raisePt(h); await tween(1.0, (k) => { h.P.lerpVectors(a0, up, k); }); } const a = h.P.clone(); await tween(dur, (k) => { h.P.lerpVectors(a, to, k); h.P.y += Math.sin(k * PI) * lift; }); };
  const press = async (h, pad, i) => {
    S.collarLook = pad.userData.top(V(0, 0, 0));
    await handTo(h, pad.userData.top(V(0, 0, 0), 0.03), 0.9, 0.06);
    await handTo(h, pad.userData.top(V(0, 0, 0), 0.0015), 0.3, 0);
    cue('padPress', i);
    await tween(0.22, (k) => { pad.userData.set(k, k); pad.userData.top(h.P, 0.0015); }, (k) => k * (2 - k));
    await wait(0.35);
    await tween(0.3, (k) => { pad.userData.set(1 - k * 0.55, 1); pad.userData.top(h.P, 0.0015 + 0.025 * k); });
  };
  // the dome: one palm rolls it, and a ring of light slides over the land to a hill and stops
  S.collarLook = domeTop;
  await handTo(hD, domeTop, 1.3, 0.1);
  cue('domeRoll');
  { const c0 = wx.landU.uCur.value.clone(), c1 = V2(WX.cloud[0], WX.cloud[1]), r0 = wx.dome.rotation.clone();
    tween(0.5, (k) => { wx.landU.uCursor.value = k; });
    say('They roll an amber dome under one palm. A ring of light slides over the hills, and stops.');
    await tween(2.8, (k) => { wx.landU.uCur.value.lerpVectors(c0, c1, k); wx.dome.rotation.set(r0.x + k * 2.2, r0.y, r0.z - k * 1.6); hD.P.copy(domeTop).add(V(Math.sin(k * 5) * 0.006, 0, Math.cos(k * 4) * 0.006 - 0.006)); S.collarLook = wx.W(wx.landU.uCur.value.x, TOP + 0.05, wx.landU.uCur.value.y); }); }
  await wait(0.5);
  // first pad: a cloud out of clear air
  let cloudK = 0, mistK = 0, mistA = 0, rainK = 0, fogK = 0;
  on((dt, t) => { wx.setCloud(cloudK, t); wx.setMist(mistK, mistA); wx.laser.rotation.set(0.5 + 0.2 * Math.sin(t * 0.5), 0, -0.35 - 0.25 * Math.sin(t * 0.37)); });
  await press(hD, wx.pads[0], 0);
  S.collarLook = wx.W(WX.cloud[0], TOP + 0.2, WX.cloud[1]); cue('tableStir', 0);
  tween(7, (k) => { cloudK = k * 1.4; hall.wallU.uView.value = k; }, (k) => k);
  tween(1.5, (k) => { wx.landU.uCursor.value = 1 - k; });
  await say('A pad sinks under one long finger. Over the hill, in clear air, a cloud begins.');
  await wait(1.6);
  // the lever: leaned on, it goes over slowly and the mist goes with it; let go, it springs upright and the mist stays
  const push = async (from, to, dur) => {
    cue('leverPush', dur);
    await tween(dur, (k) => { wx.lever.rotation.z = 0.55 * k; wx.leverTop(hP.P); mistK = lerp(from, to, k); }, (k) => k * (2 - k));
    await wait(0.35);
    const up = wx.leverTop(V(0, 0, 0)).add(V(0, 0.05, 0)); await handTo(hP, up, 0.35, 0);
    cue('leverBack');
    await tween(0.5, (k) => { wx.lever.rotation.z = 0.55 * (1 - k) * Math.cos(k * 9) * (1 - k * 0.3); }, (k) => k);
    wx.lever.rotation.z = 0;
  };
  S.collarLook = wx.leverTop(V(0, 0, 0));
  await handTo(hP, wx.leverTop(V(0, 0, 0)), 1.0, 0.07);
  S.collarLook = wx.W(WX.cloud[0], TOP + 0.05, WX.cloud[1] - 0.15); cue('tableStir', 1);
  tween(1.2, (k) => { mistA = k; });
  say('They lean on a short lever. It goes over slowly, as if through oil. Mist comes out from under the cloud in a point.');
  await push(0, 0.42, 4.2);
  await say('They let go. The lever springs upright. The mist stays where it stopped.');
  await handTo(hP, wx.leverTop(V(0, 0, 0)), 0.5, 0);
  S.collarLook = wx.W(WX.field[0], TOP + 0.05, WX.field[1] + 0.1);
  say('Again. The mist goes straight for the field, and holds its shape. It does not drift.');
  await push(0.42, 0.86, 4.4);
  // the second pad: rain on the one farm
  await press(hD, wx.pads[1], 2);
  S.collarLook = wx.W(WX.farm[0], TOP + 0.08, WX.farm[1]); cue('tableStir', 2);
  tween(4, (k) => { rainK = k; wx.setRain(k); }, (k) => k);
  await say('Rain, over one farm and nowhere else. The lane at its fence stays dry.');
  cue('inner');
  await say('None of this happens by itself.', 'them');
  // the collared one looks round at the tall one, and inclines their head
  S.collarLook = guideH.position.clone().setY(1.9); await wait(0.9);
  await tween(1.6, (k) => { S.collarNod = Math.sin(k * PI) * 0.32; }, (k) => k);
  await say('We do not make storms. Only cover.', 'them');
  // the tall grey comes round to your side
  S.collarLook = null;
  { const lower = async (h) => { await handTo(h, raisePt(h), 0.8, 0.03); const to = collared.localToWorld(h.hang.clone()); await handTo(h, to, 0.9, 0); h.on = false; cu['arm' + h.sd].quaternion.identity(); cu['fore' + h.sd].quaternion.identity(); cu['hand' + h.sd].quaternion.identity(); };
    await Promise.all([lower(hD), (async () => { await handTo(hP, raisePt(hP), 0.8, 0.03); await handTo(hP, carryPt(hP), 0.7, 0); hP.carry = true; })()]); }
  {
    const pts = [wx.W(1.14, 0, 0.66), wx.S2], look = last2(wx); cWalk = 1; let amt = 0, amtT = 0;
    const hold = () => { collared.updateMatrixWorld(true); for (const h of cHands) if (h.on) { if (h.carry) h.P.copy(carryPt(h)); h.reach(h.P); } };   // the walk cycle swings both arms: the raised one is solved again after it
    const stepper = on((dt) => { amt += (amtT - amt) * Math.min(1, dt * 5); stepGrey(collared, E.time * GREY_GAIT, amt); hold(); });
    for (const p of pts) {
      const from = collared.position.clone(), hd = Math.atan2(p.x - from.x, p.z - from.z), r0 = collared.rotation.y, dT = Math.abs(wrapA(hd - r0));
      if (dT > 0.4) { amtT = 0.5; await tween(dT / 1.6, (k) => { collared.rotation.y = angTo(r0, hd, k); }); }
      amtT = 1; const r1 = collared.rotation.y;
      await tween(Math.max(0.5, from.distanceTo(p) / 0.5), (k) => { collared.position.lerpVectors(from, p, k); collared.rotation.y = angTo(r1, hd, Math.min(1, k * 3)); }, (k) => k);
    }
    const r0 = collared.rotation.y, hd = Math.atan2(look.x - collared.position.x, look.z - collared.position.z);
    amtT = 0.5; await tween(Math.max(0.6, Math.abs(wrapA(hd - r0)) / 1.6), (k) => { collared.rotation.y = angTo(r0, hd, k); });
    amtT = 0; await wait(0.6); stepper(); stepGrey(collared, 0, 0); hold(); cWalk = 0;
  }
  S.collarLook = E.camera.position;
  say('The grey in the cloak comes round the table to your side, and looks at your hand.');
  // your hand: up over the pad and held there; theirs comes to rest on the back of it; then both go down
  E.mode = 'locked';
  const padTop = wx.last.userData.top(V(0, 0, 0)), padN = V(0, 1, 0).transformDirection(wx.last.matrixWorld).normalize();
  { const aim = aimAt(padTop.clone().add(V(0, 0.04, 0))); await moveView(1.4, { yaw: E.yaw + wrapA(aim.yaw - E.yaw), pitch: aim.pitch }); }
  const me = makePlayerBody(), mu = me.userData, hr = mu.handRigR; mu.torso.children[0].visible = false; mu.legs.visible = false; mu.armL.visible = false;
  me.position.copy(E.camera.position); me.rotation.y = E.yaw; g.add(me); mu.relax(0.1); me.updateMatrixWorld(true);
  const qi = me.getWorldQuaternion(new THREE.Quaternion()).invert();
  // hand frame: palm toward -x, fingers -y, thumb -z. Palm onto the pad: back of the hand along the pad's way out, fingers up the slope
  const fwd = V(0, 0, -1).applyQuaternion(me.quaternion), fS = fwd.clone().addScaledVector(padN, -fwd.dot(padN)).normalize();
  const Qp = qi.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(padN, fS.clone().negate(), padN.clone().cross(fS.clone().negate()))));
  const W0 = me.worldToLocal(mu.handR.getWorldPosition(V(0, 0, 0))), Q0 = qi.clone().multiply(mu.handR.getWorldQuaternion(new THREE.Quaternion()));
  const c0 = hr.curls.slice(), sp0 = hr.spread, op0 = hr.opp, tf0 = hr.tflex, cuF = [0, 0, 0, 0], pole = V(0.7, -1, 0.25), Wt = V(0, 0, 0), Qt = new THREE.Quaternion(), v = V(0, 0, 0);
  const poseH = (Wl, Q, f) => { mu.ikRight(Wl, Q, pole); for (let i = 0; i < 4; i++) cuF[i] = lerp(c0[i], 0.04, f); hr.set(cuF, lerp(sp0, 0.2, f), lerp(op0, -0.3, f), lerp(tf0, 0, f)); };
  // the wrist so that the fingers lie on the key: found from the hand's own vertices over the key
  const wristAt = (lift) => padTop.clone().addScaledVector(fS, -0.125).addScaledVector(padN, lift);
  let off0 = 0.03;
  { poseH(me.worldToLocal(wristAt(off0)), Qp, 1); me.updateMatrixWorld(true); const hm = hr.mesh, nv = hm.geometry.attributes.position.count, inv = wx.last.matrixWorld.clone().invert(); let low = 9;
    for (let i = 0; i < nv; i++) { hm.getVertexPosition(i, v); hm.localToWorld(v); const d = v.clone().sub(padTop).dot(padN); v.applyMatrix4(inv); if (Math.abs(v.x) < 0.035 && Math.abs(v.z) < 0.035) low = Math.min(low, d); }
    off0 -= low - 0.001; }
  const Wc = () => me.worldToLocal(wristAt(off0 - 0.006 * wx.last.userData.down)), Wh = me.worldToLocal(wristAt(off0 + 0.075)), C1 = V(0.26, -0.5, -0.12);
  poseH(W0, Q0, 0);
  const bez = (a, c, b, t, o) => o.copy(a).multiplyScalar((1 - t) * (1 - t)).addScaledVector(c, 2 * t * (1 - t)).addScaledVector(b, t * t);
  await tween(1.7, (q) => { poseH(bez(W0, C1, Wh, sst(0, 1, q), Wt), Qt.slerpQuaternions(Q0, Qp, sst(0.1, 0.7, q)), sst(0.2, 0.7, q)); }, (q) => q);
  // the grey's fingertips onto the back of your hand
  const hG = hP, backOf = (o) => mu.handR.localToWorld(o.set(0.013, -0.078, 0.0)).addScaledVector(padN, 0.003);
  hG.reach.pole.set(hG.reach.pole.x, -0.9, 0.2);
  if (window.UAP) Object.assign(window.UAP.ctrl, { me, hG });
  const ride = on(() => { if (hG.riding) backOf(hG.P); });
  hG.carry = false; await handTo(hG, backOf(V(0, 0, 0)), 1.5, 0.05); hG.riding = true;
  await say('Their fingers come to rest on the back of your hand. They weigh nothing.');
  const did = await pressE('E — press the last pad', 12);
  await tween(0.7, (q) => { poseH(Wt.lerpVectors(Wh, Wc(), q), Qp, 1); });
  cue('padPress', 3);
  await tween(0.25, (q) => { wx.last.userData.set(q, q); poseH(Wc(), Qp, 1); }, (q) => q * (2 - q));
  cue('tableStir', 3);
  // the view turns further onto the table, down over the field, to watch it go (your hand stays on the pad)
  { const fa = aimAt(wx.W(WX.field[0] - 0.01, TOP + 0.01, WX.field[1] - 0.01)); moveView(1.8, { yaw: E.yaw + wrapA(fa.yaw - E.yaw), pitch: fa.pitch }); }
  tween(1.8, (k) => { E.camera.fov = lerp(70, 52, k); E.camera.updateProjectionMatrix(); }, (k) => k * k * (3 - 2 * k));
  tween(6, (k) => { fogK = k; wx.blanket.scale.setScalar(Math.max(0.001, 0.24 * sst(0, 0.8, k))); wx.blanketU.uAmt.value = sst(0, 0.5, k) * 0.95; wx.landU.uFogged.value = k; mistK = 0.86 + 0.1 * k;
    wx.fieldL.children.forEach((s) => { if (s.material) s.material.opacity = 1 - 0.85 * sst(0.2, 0.9, k); }); }, (k) => k);
  await say('The pad sinks under your fingers. On the table the mist closes over the field.');
  await say('The pinpricks of light go soft, and then you cannot find them.');
  tween(1.4, (k) => { E.camera.fov = lerp(52, 70, k); E.camera.updateProjectionMatrix(); }, (k) => k * k * (3 - 2 * k));
  S.collarLook = wx.W(WX.field[0], TOP + 0.05, WX.field[1]);
  // hands away: theirs first, then yours
  hG.riding = false; ride();
  { const up = hG.P.clone().add(V(0, 0.08, 0)); await handTo(hG, up, 0.6, 0); await handTo(hG, carryPt(hG), 0.9, 0.02); hG.carry = true; }
  const Wb = Wc().clone();
  await tween(1.5, (q) => { wx.last.userData.set(1 - 0.55 * sst(0, 0.3, q), 1); poseH(bez(Wb, C1, W0, sst(0, 1, q), Wt), Qt.slerpQuaternions(Qp, Q0, sst(0.1, 0.9, q)), 1 - sst(0, 0.8, q)); }, (q) => q);
  discard(me);
  S.collarLook = null;

  // ===== 4. the link =====
  E.limits = null;
  S.guideFace = false; glide(guideH, A_LINK - 0.1, 7.45, link.W(0, 0, 0), 1.7).then(() => { S.guideFace = true; });
  await moveView(1.0, { yaw: E.yaw + wrapA(A_WEATHER + PI / 2 - E.yaw) * 0.6, pitch: -0.04 });
  await walkPolar(A_LINK - 0.2, 8.3);
  const standL = link.W(1.15, 1.6, 0.85);
  // the maroon one turns to the couch and holds one hand out over it, the long middle hook pointing at where you will lie
  // (the arm solved onto a point 30 cm over the pad's back each frame; the other arm stays folded)
  const mu2 = maroon.userData, gestP = link.W(-0.06, 0.98, -0.32); for (const a of mu2.arms) a.lvl = 1;   // (lvl 1: the arm check takes these as sleeved arms)
  // (the arms are set back to the fold each frame first, so the reach blends from it, never from the last frame's pose)
  let gestK = 0; const gest = on(() => { if (gestK > 0) { mu2.setFold(1); mu2.reachTo(gestP, gestK); if (mu2.reachArm) mu2.curl(mu2.reachArm.s, 0.75 * gestK, true); } else mu2.reachTo(gestP, 0); });
  if (window.UAP) Object.assign(window.UAP.ctrl, { gestP, gestK: () => gestK });
  { const aim0 = link.W(0, 1.0, -0.3), d = aim0.clone().sub(standL).normalize();
    const r0 = maroonH.rotation.y, r1 = Math.atan2(gestP.x - maroonH.position.x, gestP.z - maroonH.position.z) + 0.35;
    tween(1.4, (k) => { maroonH.rotation.y = angTo(r0, r1, k); }).then(() => tween(1.8, (k) => { gestK = k; }, (k) => k * k * (3 - 2 * k)));
    await moveView(2.2, { pos: standL, yaw: E.yaw + wrapA(Math.atan2(-d.x, -d.z) - E.yaw), pitch: Math.asin(d.y), walk: 0.7 }); }
  E.base.yaw = E.yaw; E.base.pitch = E.pitch; E.limits = { yaw: 1.3, up: 0.8, down: 0.5 }; E.mode = 'look';
  await say('A couch under a ring of light. One in maroon stands beside it, and points to it with one long hand.');
  cue('inner');
  await say('Lie here. You will go with this one, and see as they see.', 'them');
  await pressE('E — lie back', 12);
  E.mode = 'locked'; E.limits = null;
  const eyeW = link.W(link.EYE.x, link.EYE.y, link.EYE.z);
  tween(1.4, (k) => { gestK = 1 - k; }, (k) => k * k * (3 - 2 * k)).then(() => { gest(); mu2.reachTo(gestP, 0); mu2.curl(1, 0); mu2.curl(-1, 0); mu2.setFold(1); });
  await moveView(1.2, { pos: link.W(0.5, 1.5, 0.1), yaw: E.yaw + wrapA(A_LINK + 0.9 - E.yaw), pitch: -0.2, walk: 0.6 });
  await moveView(2.2, { pos: eyeW, yaw: E.yaw + wrapA(A_LINK - E.yaw), pitch: 0.55 });
  // your own body, lying as the couch is cut for it (it comes in while the view is up at the ring, below the frame)
  const meL = makePlayerBody(); lie(meL); link.lk.add(meL); const lieOff = lieLook(meL);
  if (window.UAP) window.UAP.ctrl.lying = meL;
  E.base.yaw = E.yaw; E.base.pitch = E.pitch; E.limits = LIE_LOOK; E.mode = 'look';
  // the maroon one bends over you; the ring comes down the line of your eyes
  const mFrom = maroonH.position.clone(), mTo = link.W(-0.78, 0, -0.35);
  tween(2.4, (k) => { maroonH.position.lerpVectors(mFrom, mTo, k); maroon.userData.nod(0.75 * k); });
  on((dt) => faceTo(maroonH, E.camera.position, dt, 1.5));
  const hum = cue('linkRing') || quiet, dirL = V(0, Math.sin(0.62), Math.cos(0.62)), ringAt = (d) => { link.ringG.position.copy(link.EYE).addScaledVector(dirL, d); };
  link.ringG.rotation.x = PI / 2 - 0.62;
  ringAt(1.75);
  say('You lie back. The ring comes down over your eyes.');
  await tween(6.5, (k) => { ringAt(lerp(1.75, 0.04, k)); link.halo.material.opacity = 0.25 + 0.2 * k; link.halo.scale.setScalar(1.5 + 0.6 * k); hall.lights.linkL.intensity = 6 + 30 * k; hum.set(k); }, (k) => k * k * (3 - 2 * k));
  cue('linkLock');
  say('The hall pulls away from you, turning.');
  E.mode = 'locked'; lieOff();   // the body holds still while the view twists away
  // the view widens (the hall shrinks away) and twists, turning faster as it goes
  { const y0 = E.yaw; tween(2.6, (k) => { E.camera.fov = 70 + 58 * k * k; E.camera.updateProjectionMatrix(); E.roll = 1.5 * k * k * k; E.yaw = y0 + 0.5 * k * k * k; hall.colU.uAmt.value = 0.5 + 3 * k; }); }
  await wait(0.9);
  amb.stop(1.6); hum.stop(1.6); for (const b of beads) b.snd.stop(0.3);
  await fade(1, 1.7, '#fff');
  loom.freeBeads();
  return 'field';
}
const last2 = (wx) => wx.last.userData.top(V(0, 0, 0));

// the man from the exam table, as the basin shows him: on the same slab-on-a-stem table as in the exam room (night.js
// examTables: the same profile, top, glowing edge, band, inset line, sensor points and foot ring, in the same porcelain),
// lying on it as he lay there, in a white room under the opening
const ET_TY = -0.2, ET_TD = 0.13, ET_TOP = 0.877 + ET_TY - ET_TD;   // the table top surface (night.js TY, TD)
function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function examTable(g, porcelain, glowM) {
  const TY = ET_TY, TD = ET_TD;
  const stem = new THREE.LatheGeometry([[0, 0], [0.34, 0], [0.36, 0.025], [0.3, 0.07], [0.15, 0.18], [0.1, 0.42], [0.12, 0.68], [0.22, 0.77], [0.24, 0.8], [0, 0.8]].map(([x, y]) => V2(x, y)), 40);
  const top = new THREE.ExtrudeGeometry(roundedRect(0.8, 2.1, 0.22), { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 3, curveSegments: 10 }); top.rotateX(-PI / 2);
  const edge = roundedRect(0.87, 2.17, 0.25); edge.holes.push(roundedRect(0.83, 2.13, 0.23));
  const edgeG = new THREE.ExtrudeGeometry(edge, { depth: 0.012, bevelEnabled: false, curveSegments: 10 }); edgeG.rotateX(-PI / 2);
  const band = new THREE.TorusGeometry(0.104, 0.007, 8, 40); band.rotateX(PI / 2);
  const inset = roundedRect(0.66, 1.9, 0.18); inset.holes.push(roundedRect(0.645, 1.885, 0.172));
  const insetG = new THREE.ShapeGeometry(inset, 10); insetG.rotateX(-PI / 2);
  const foot = new THREE.TorusGeometry(0.375, 0.006, 6, 64); foot.rotateX(PI / 2);
  const s = new THREE.Mesh(stem, porcelain); s.scale.y = (0.8 + TY - TD) / 0.8; g.add(s);
  const t = new THREE.Mesh(top, porcelain); t.position.y = 0.82 + TY - TD; g.add(t);
  const e = new THREE.Mesh(edgeG, glowM); e.position.y = 0.81 + TY - TD; g.add(e);
  const b = new THREE.Mesh(band, glowM); b.position.y = 0.45 * (0.8 + TY - TD) / 0.8; g.add(b);
  const il = new THREE.Mesh(insetG, glowM); il.position.y = 0.8765 + TY - TD; g.add(il);
  const f = new THREE.Mesh(foot, glowM); f.position.y = 0.008; g.add(f);
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0075, 8, 6), glowM, 24), dm = new THREE.Matrix4();
  for (let k = 0; k < 24; k++) { dm.makeTranslation(k % 2 ? 0.432 : -0.432, 0.842 + TY - TD, -0.9 + Math.floor(k / 2) * 0.164); dots.setMatrixAt(k, dm); }
  g.add(dots);
}
function buildBelow(hall, towards) {
  const room = new THREE.Group(); room.position.set(0, BASIN_Y, 0); room.rotation.y = towards; hall.g.add(room);
  // the table stands on the room's floor; the table and the man are drawn 1.45 times life size so he reads from the rail
  const SC = 1.45, TOPY = -0.57, FLOOR = TOPY - ET_TOP * SC;
  const soft = basic(0xd6dee8);
  const well = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 2.4, -FLOOR, 48, 1, true), basic(0xb9c4d2, { side: THREE.BackSide })); well.position.y = FLOOR / 2; room.add(well);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.4, 48).rotateX(-PI / 2), soft); floor.position.y = FLOOR; room.add(floor);
  // the table runs across the view from the rail (its length along the room's x), the far side of the opening
  const tbl = new THREE.Group(); tbl.position.set(0, FLOOR, -0.35); tbl.rotation.y = PI / 2; tbl.scale.setScalar(SC); room.add(tbl);
  const porcelain = new THREE.MeshStandardMaterial({ color: 0xe9eef3, metalness: 0.25, roughness: 0.22 }), glowM = basic(0xbfe6ff);
  examTable(tbl, porcelain, glowM);
  // as on the exam table: on his back, feet toward the table's +z end, then lowered until his lowest point rests on the top
  const man = makeHuman(1, 0x6a7384); man.rotation.x = -PI / 2; man.position.set(0, 1.05 + ET_TY, 1.0); tbl.add(man);
  room.updateMatrixWorld(true);
  { const bb = new THREE.Box3().setFromObject(man), topW = tbl.localToWorld(V(0, ET_TOP, 0)).y; man.position.y += (topW - bb.min.y) / SC; }
  const lamp = new THREE.PointLight(0xffffff, 0, 0, 2); lamp.position.set(0, 1.1 / SC + ET_TOP, 0.2); tbl.add(lamp);
  room.updateMatrixWorld(true);
  return { room, man, lamp, tbl };
}

export async function aftermath() {
  for (const rt of LIVE_RT) rt.dispose(); LIVE_RT.clear();
  hallScene();
  const hall = buildHall(), loom = buildLoom(hall, { still: true }), wx = buildWeather(hall), link = buildLink(hall), crew = buildCrew(hall);
  const { g } = hall, { threads } = loom;
  const below = buildBelow(hall, 0);
  // the room as you left it: the weather made, the loom still, one thread
  wx.setCloud(1.4, 0); wx.setMist(0.96, 0.9); wx.setRain(1); wx.blanket.scale.setScalar(0.24); wx.blanketU.uAmt.value = 0.95; wx.landU.uFogged.value = 1; wx.fieldL.children.forEach((s) => { if (s.material) s.material.opacity = 0.15; });
  for (const p of [...wx.pads, wx.last]) p.userData.set(0.45, 1);
  const gold = threads[GOLD];
  for (const th of threads) if (th !== gold) { th.gone = true; th.mesh.visible = false; }
  gold.slack = 0; gold.U.uGold.value = 1; gold.U.uGoldAt.value = 0.3; gold.U.uW.value = 0.007;
  const guideH = new THREE.Group(), guide = makeMantis(); guideH.add(guide); g.add(guideH);
  const weaverH = new THREE.Group(), weaver = makeWeaver(), wu = weaver.userData; weaverH.position.copy(WEAVER_POS); weaverH.rotation.y = WEAVER_YAW; weaverH.add(weaver); g.add(weaverH);
  const disc = new THREE.Mesh(new THREE.LatheGeometry([[0, -0.1], [0.5, -0.1], [0.66, -0.04], [0.66, -0.01], [0.6, 0], [0, 0]].map(([x, y]) => V2(x, y)), 48), hall.dark); disc.position.copy(WEAVER_POS); g.add(disc);
  const discRim = new THREE.Mesh(new THREE.TorusGeometry(0.655, 0.008, 6, 64), basic(0x8fd8ff)); discRim.rotation.x = PI / 2; discRim.position.copy(WEAVER_POS).y -= 0.025; g.add(discRim);
  const maroonH = new THREE.Group(), maroon = makeMantis(); robe(maroon, 0x74161f, 0x26060a, 0x4a0e16, 0xe8a0a4); maroonH.add(maroon); maroonH.position.copy(link.W(-1.05, 0, 0.3)); maroonH.rotation.y = A_LINK + PI + 0.5; g.add(maroonH);
  const collared = makeCollared(); collared.position.copy(wx.S1); { const c = wx.W(0, 0, 0); collared.rotation.set(0, Math.atan2(c.x - collared.position.x, c.z - collared.position.z), 0); } g.add(collared);
  guideH.position.copy(link.W(0.95, 0, 1.3)); guideH.rotation.y = Math.atan2(link.W(0, 0, 0).x - guideH.position.x, link.W(0, 0, 0).z - guideH.position.z);
  for (const a of wu.arms) a.tip.copy(loom.wPt(a.home.x, a.home.y, a.home.z));
  wu.nod(0.5);
  // you, on the couch
  const me = makePlayerBody(), mu = me.userData; lie(me); link.lk.add(me);
  const eyeW = link.W(link.EYE.x, link.EYE.y, link.EYE.z);
  setView(eyeW.x, eyeW.y, eyeW.z, A_LINK, -0.78); E.mode = 'look'; E.limits = { ...LIE_LOOK_DOWN };
  const lookOff = lieLook(me);
  link.ringG.position.copy(link.EYE).add(V(0, 1.5, 1.0)); link.ringG.rotation.x = PI / 2 - 0.62;
  const S = { guideFace: true };
  const amb = cue('ctrlRoom', 0.6) || quiet;
  chirps([guide, weaver, maroon]);
  const tV = V(0, 0, 0);
  on((dt, t) => {
    idleMantis(guide, dt, t); idleMantis(maroon, dt, t); idleMantis(weaver, dt, t); wu.shift(t);
    if (S.guideFace) faceTo(guideH, E.camera.position, dt, 0.9);
    weaver.updateMatrixWorld(true); for (const a of wu.arms) { armTo(weaver, a, a.tip, a.foldPole, 0.45); wu.hooks(a, 0.5); }
    loom.lay(gold, t);
    crew.update(dt, t, 0.5); idleGrey(collared, t); aimGrey(collared, wx.W(WX.field[0], TOP + 0.05, WX.field[1]), 0.9);
    hall.lights.guideL.position.lerp(tV.copy(E.camera.position).setY(3.3), Math.min(1, dt * 2));
    if (!S.stood) mu.breathe(t);
  });
  if (window.UAP) window.UAP.ctrl = { hall, loom, wx, link, crew, weaver, guide, maroon, collared, S, below, me, mantisCheck, armTip, threads, beads: [] };
  warm(g);
  // ----- your own body -----
  await fade(0, 2.6, '#fff');
  await say('The couch. The hall. Your own body.');
  await say('Your hands lie where you left them. They do not move.');
  await wait(1.2);
  // a finger, then the fingers, then the right hand turns over and lifts
  // the fingers move from (and back to) their loose resting curl (about 0.38, thumb open), so nothing jumps
  await tween(0.5, (k) => { mu.curl('R', 0.38 + 0.25 * Math.sin(k * PI), 0.1 * Math.sin(k * PI)); }, (k) => k);
  await wait(0.7);
  say('Then they do.');
  await tween(2.2, (k) => { const s1 = Math.sin(k * PI) ** 2, s2 = Math.sin(Math.min(1, k * 1.3) * PI) ** 2; mu.curl('R', 0.38 + 0.4 * s1, 0.5 * s1); mu.curl('L', 0.38 + 0.35 * s2, 0.2 * s2); }, (k) => k);
  moveView(2.4, { pitch: -0.45 });
  // the reach starts from (and comes back to) the arm as it lies on its rest, not from the arm hanging straight: the joints are
  // eased from the resting angles into the reach over its first third, and back over the last third of the lowering
  lookOff.opts.right = false;   // this scene moves the right arm now
  const restA = [mu.armR, mu.foreR, mu.handR].map((b) => b.quaternion.clone()), fromRest = (w) => { if (w > 0) [mu.armR, mu.foreR, mu.handR].forEach((b, i) => b.quaternion.slerp(restA[i], w)); };
  await tween(2.6, (k) => { mu.reachRight(k); fromRest(1 - sst(0, 0.35, k)); }, (k) => k);
  await wait(1.0);
  await tween(1.6, (k) => { mu.reachRight(1 - k); fromRest(sst(0.6, 1, k)); }, (k) => k);
  mu.relax(couchProfile().arm); lookOff.opts.right = true;
  await wait(0.5);
  // and you are standing at the rail, with no memory of getting up
  await fade(1, 0.5, '#000');
  lookOff(); discard(me); S.stood = true;
  const stand = V(0, 1.6, 2.72); setView(stand.x, stand.y, stand.z, 0, 0); { const aim = aimAt(V(-0.3, 1.9, 0.4)); E.yaw = E.base.yaw = aim.yaw; E.pitch = E.base.pitch = aim.pitch; }
  guideH.position.set(0, 0, 4.05); guideH.rotation.y = PI;
  E.limits = { yaw: 1.3, up: 1.0, down: 1.1 }; E.mode = 'look';
  hall.basinU.uWin.value = 1; below.lamp.intensity = 2.2; hall.lights.basinL.intensity = 9; hall.HU.uBasin.value.setRGB(0.8, 0.86, 0.95);
  // the thread now runs down through the opening to the man's chest
  gold.B.copy(below.man.userData.chest.getWorldPosition(V(0, 0, 0))); gold.H.lerpVectors(gold.B, gold.G, 0.33); gold.rest.copy(gold.H);
  await wait(0.5);
  await fade(0, 1.2, '#000');
  await say('You are at the rail. You do not remember getting up.');
  await say(G.wove ? 'The loom is still. One thread is left, and it is gold. Yours.' : 'The loom is still. One thread is left, and it is gold.');
  E.mode = 'locked'; E.limits = null;
  const head = below.man.userData.head.getWorldPosition(V(0, 0, 0));
  await lookToward(head.clone().lerp(gold.B, 0.5), 2.0);
  await say('It goes down into the basin. The basin has opened on a white room. A man on a table, eyes open.');
  { const aim = aimAt(head); moveView(2.6, { yaw: aim.yaw, pitch: aim.pitch }); await tween(2.6, (k) => { E.camera.fov = lerp(70, 34, k); E.camera.updateProjectionMatrix(); }); }
  await say('You know his face. He was on the table beside yours.');
  await say('Hours ago. Or not yet.');
  await tween(1.8, (k) => { E.camera.fov = lerp(34, 70, k); E.camera.updateProjectionMatrix(); });
  // the tall one, at your shoulder
  { const aim = aimAt(V(guideH.position.x, 1.95, guideH.position.z)); await moveView(1.6, { yaw: E.yaw + wrapA(aim.yaw - E.yaw), pitch: aim.pitch }); }
  cue('inner');
  await say('It has already happened. It is happening. It will happen.', 'them');
  // your hand comes up, open
  const arm = armOnly(), au = arm.userData; E.camera.add(arm);
  const reach = palmReach(arm), fw = V(0, 0, 0), held = V(0, 0, 0), palm = V(0, 0, 0);
  const heldAt = () => { E.camera.getWorldDirection(fw); fw.y = 0; fw.normalize(); return held.copy(E.camera.position).addScaledVector(fw, 0.42).add(V(-fw.z * 0.06, -0.3, fw.x * 0.06)); };
  const palmW = () => { E.camera.updateMatrixWorld(true); return au.handR.localToWorld(palm.copy(PALM)); };
  if (G.toy) {
    // the toy, in your palm: it begins to hum
    const toy = new THREE.Mesh(new THREE.TetrahedronGeometry(0.04), sm(`
      uniform float uGlow;
      void main() { vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld); float ndv = clamp(dot(n, v), 0.0, 1.0);
        vec3 c = vec3(1.0, 0.82, 0.48); vec3 col = mix(c * c * 0.6, c, ndv) * (0.5 + 0.7 * uGlow) + c * pow(1.0 - ndv, 2.5) * (1.0 + uGlow) + vec3(1.0) * pow(max(reflect(-v, n).y, 0.0), 30.0);
        gl_FragColor = vec4(col, 1.0); }`, { uGlow: { value: 0.3 } }));
    const tHalo = sprite(glowTex(), 0xffc24a, 0.2, { opacity: 0.25 }); toy.add(tHalo); au.handR.add(toy); toy.position.copy(PALM).add(V(-0.042, 0, 0));
    const aura = cue('aura', 293.66) || quiet; aura.set(0);
    const spin = on((dt) => { toy.rotation.y += dt * 1.2; toy.rotation.x += dt * 0.7; });
    { const aim = aimAt(heldAt().add(V(0, 0.02, 0))); moveView(2.0, { yaw: aim.yaw, pitch: aim.pitch }); }
    await tween(2.4, (k) => { reach(heldAt(), k); aura.set(k * k); toy.material.uniforms.uGlow.value = 0.3 + k; tHalo.material.opacity = 0.25 + 0.5 * k; tHalo.scale.setScalar(0.2 + 0.25 * k); }, (k) => k);
    await say('In your hand the toy has begun to hum.');
    cue('inner');
    await say('Someone wishes to see you.', 'them');
    amb.stop(2); aura.stop(2.2);
    await fade(1, 2.2, '#fff');
    spin();
    return 'reveal';
  }
  // no toy: the finger in your palm, as at the crossroads, and the white
  S.guideFace = false;
  moveView(2.0, { pitch: -0.42 });
  const gu = guide.userData;
  on((dt) => faceTo(guideH, E.camera.position, dt, 2));
  await tween(2.8, (k) => {
    gu.setFold(1 - Math.min(1, k * 1.2)); reach(heldAt(), Math.min(1, k * 1.2));
    const r = c01((k - 0.15) / 0.8);
    gu.reachTo(palmW(), sst(0, 1, r), 0); gu.curl(gu.reachArm ? gu.reachArm.s : 1, Math.min(1, r * 1.5), true);
  }, (k) => k);
  cue('clicks', 3);
  await say('They lay one long finger in your open hand, as before. It weighs nothing.');
  // why they take you on from here: you were inside one of them
  cue('inner');
  await say('Tonight you were inside one of us. No one does that and stays only what they were.', 'them');
  await say('Those above us wish to see you now.', 'them');
  amb.stop(2);
  await fade(1, 2.2, '#fff');
  return 'mandala';
}
