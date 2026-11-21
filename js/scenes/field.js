// The field: the pickup seen from inside a mantis, and from the person in the field.
//
// Layout (metres; +x east, +z south, the group's camp round the origin; the constants below are the source of truth):
//   camp      a ring of three camping chairs, a low table and a blanket, centred on (0, 0)
//   the man   on his back on the blanket, hips at MAN_H, head to the north, feet to the south
//   hedge     along the south side at z = 22 (the fog comes over it and runs north, pointed at the camp)
//   fence     wire, along the east side at x = 11, with an open gate at z = -1.5 .. 2.1; verge, two cars, the lane beyond
//   mantis    starts at (1.2, 17.5) in the fog, facing north
//
// Two viewpoints share one moment. The mantis sees across time (u4D = 1): every person is drawn again at earlier and
// later times on their own animation timeline (ghosts), the laser's sweep is a solid sheet, stars and the lights overhead
// leave their paths, things show their insides. The man sees an ordinary night (u4D = 0). Every person's pose is a pure
// function of their own clock, so a ghost is the same pose function at another time; a person who is "switched off" has
// a clock that has stopped, and their ghosts fold back into them.
import { THREE, E, $, on, wait, until, tween, lerp, say, hint, fade, note, setView, moveView, aimAt, warm, DEV } from '../engine.js';
import { A } from '../audio.js';
import { makeHuman, makeMantis, idleMantis, makeGrey, stepGrey, idleGrey, aimGrey, GREY_GAIT } from '../models.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PI = Math.PI, TAU = PI * 2;
const sm01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// a repeatable random stream, so the field is the same field every time (the control room's map table matches it)
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const MAN_H = V(0.55, 0, 1.3);          // the man's hips on the blanket
const START = V(1.2, 0, 17.5);          // where the mantis stands at the start
const EYE = 2.3;                        // mantis eye height
const HEDGE_Z = 22, FENCE_X = 11;
const CAR_A = V(12.5, 0, -4.0), CAR_B = V(12.5, 0, 3.7);
const TABLE = V(0, 0, -0.15);

// ---------------------------------------------------------------- shared uniforms and GLSL
const U = {
  uTime: { value: 0 }, u4D: { value: 1 },
  uFogA: { value: new THREE.Vector4(0, 14.5, 0.55, 0.25) },   // wedge of fog: centre x, tip z, slope (z per metre of |x|), density
  uFogCol: { value: new THREE.Color(0.2, 0.235, 0.29) }, uFogTop: { value: 0 },   // extra height of the bank's top, metres
  uMed: { value: new THREE.Vector4(0, -50, 0, 0) },            // the medallion's light: position, strength
  uPick: { value: new THREE.Vector4(MAN_H.x, 30, MAN_H.z, 0) },   // the column of light: x, height, z, strength
  uCarA: { value: new THREE.Vector4(CAR_A.x, 1.2, CAR_A.z, 1) }, uCarB: { value: new THREE.Vector4(CAR_B.x, 1.2, CAR_B.z, 1) },
  uRed: { value: new THREE.Vector4(TABLE.x, 0.62, TABLE.z, 1) },
  uSkyL: { value: 0 },                                        // light thrown down by the lights overhead
  uRes: { value: 500 },                                       // pixels per metre at 1 m
};
const COMMON = `
uniform float uTime; uniform float u4D; uniform vec4 uFogA; uniform vec3 uFogCol; uniform vec4 uPick; uniform float uFogTop; uniform vec4 uMed;
// warm light from the held medallion, falling off with distance
vec3 medLight(vec3 p) { vec3 d = p - uMed.xyz; return vec3(1.0, 0.8, 0.45) * uMed.w / (1.0 + dot(d, d) * 5.0); }
float fHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float fNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x), mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), f.x), f.y); }
// the bank: a wedge with its point toward the camp, taller further back, a soft uneven top
float fDens(vec3 p) {
  float edge = p.z - (uFogA.y + uFogA.z * abs(p.x - uFogA.x));
  float top = 1.3 + uFogTop + 0.32 * clamp(edge, 0.0, 12.0);
  top *= 0.78 + 0.44 * fNoise(p.xz * 0.22 + vec2(uTime * 0.03, uTime * 0.05));
  return smoothstep(-0.4, 2.2, edge) * (1.0 - smoothstep(top * 0.5, top, p.y));
}
// how much of the view from a to b the bank hides: six samples along the stretch of the ray that can hold fog
float fieldFog(vec3 a, vec3 b) {
  vec3 d = b - a; float L = length(d); d /= max(L, 1e-4);
  float t0 = 0.0; float t1 = min(L, 150.0);
  if (abs(d.y) > 1e-4) { float ty = (5.6 - a.y) / d.y; if (d.y > 0.0) t1 = min(t1, ty); else t0 = max(t0, ty); } else if (a.y > 5.6) return 0.0;
  if (abs(d.z) > 1e-4) { float tz = (uFogA.y - 0.4 - a.z) / d.z; if (d.z > 0.0) t0 = max(t0, tz); else t1 = min(t1, tz); } else if (a.z < uFogA.y - 0.4) return 0.0;
  if (t1 <= t0) return 0.0;
  float s = 0.0; float st = (t1 - t0) / 6.0;
  for (int i = 0; i < 6; i++) s += fDens(a + d * (t0 + st * (float(i) + 0.5)));
  return 1.0 - exp(-s * st * uFogA.w * mix(1.0, 0.3, u4D));
}
// the bank's own colour where it is seen: starlit grey; in the mantis's sight a dim violet; lit from inside by the column
vec3 fogTint(vec3 p) {
  vec3 c = mix(uFogCol, vec3(0.13, 0.085, 0.2), u4D);
  float r = length(p.xz - uPick.xz);
  return c + vec3(0.62, 0.72, 0.85) * uPick.w * exp(-r * 0.22);
}
// far things sink into the night air; near things into the bank
vec3 fieldAir(vec3 c, vec3 p) {
  float L = length(p - cameraPosition);
  c = mix(c, mix(vec3(0.012, 0.016, 0.03), vec3(0.03, 0.012, 0.05), u4D), 1.0 - exp(-L * 0.0045));
  return mix(c, fogTint(p), fieldFog(cameraPosition, p));
}
`;
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
` + COMMON + `
uniform vec4 uCarA; uniform vec4 uCarB; uniform vec4 uRed; uniform float uSkyL;
vec3 ptl(vec4 L, vec3 col, vec3 p, vec3 n, float k) { vec3 d = L.xyz - p; float r2 = dot(d, d); return col * L.w * (0.35 + 0.65 * max(dot(n, d) * inversesqrt(r2), 0.0)) / (1.0 + r2 * k); }
// light on the field's own surfaces: starlight from the whole sky, the two car lamps, the red torch, the column
vec3 fieldLight(vec3 p, vec3 n) {
  vec3 c = vec3(0.62, 0.74, 1.0) * (0.72 + 0.28 * n.y) * (1.0 + uSkyL * 0.5);
  c += ptl(uCarA, vec3(1.0, 0.78, 0.5), p, n, 0.16) * 5.0 + ptl(uCarB, vec3(1.0, 0.78, 0.5), p, n, 0.16) * 5.0;
  c += ptl(uRed, vec3(1.0, 0.1, 0.05), p, n, 0.5) * 4.0;
  float r = length(p.xz - uPick.xz);
  c += vec3(0.85, 0.93, 1.0) * uPick.w * 7.0 / (1.0 + r * r * 0.08);
  return c;
}
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a; vec2 ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
`;
function sm(frag, u = {}, o = {}) {
  const { displace, ...rest } = o;
  return new THREE.ShaderMaterial({ vertexShader: displace ? VERT.replace('//DISPLACE', displace) : VERT, fragmentShader: HEAD + frag, uniforms: { ...U, ...u }, ...rest });
}
const ADD = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

// Standard and physical materials (people, the mantis, props, cars) are given the same air and bank as the field's own
// shaders, and the mantis's sight: colours turned, warmth showing as light, an iridescent edge. Cached materials from
// models.js are shared with other scenes, so each is cloned first; the clone belongs to this scene.
const FOG_FRAG = `{
  vec3 fv = normalize(cameraPosition - vFW);
  float fr = pow(1.0 - clamp(abs(dot(normalize(vFN), fv)), 0.0, 1.0), 2.2);
  vec3 c = gl_FragColor.rgb;
  vec3 c4 = c.brg * 1.3 + max(uWarm, 0.0) * vec3(1.0, 0.4, 0.14) * (0.2 + 0.45 * (1.0 - fr))
    + (0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + fr * 0.9 + vFW.y * 0.35))) * fr * 0.3;
  c = mix(c, c4, u4D * step(0.0, uWarm));   // uWarm < 0: the tall one's own body, seen in its true colours
  c += c * medLight(vFW) * 1.5;
  gl_FragColor.rgb = fieldAir(c, vFW);
}`;
function patch(m, warmth = 0) {
  const uw = { value: warmth };
  m.onBeforeCompile = (sh) => {
    for (const k of ['uTime', 'u4D', 'uFogA', 'uFogCol', 'uPick', 'uFogTop', 'uMed']) sh.uniforms[k] = U[k];
    sh.uniforms.uWarm = uw;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFW; varying vec3 vFN;')
      .replace('#include <fog_vertex>', 'vFW = (modelMatrix * vec4(transformed, 1.0)).xyz; vFN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFW; varying vec3 vFN; uniform float uWarm;\n' + COMMON)
      .replace('#include <fog_fragment>', FOG_FRAG);
  };
  m.customProgramCacheKey = () => 'fieldair';
  return m;
}
const pstd = (color, o = {}) => patch(new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o }));
// every material under obj swapped for a patched clone (one clone per source material and warmth); tint(src, clone) may recolour
function fogify(obj, { warmth = 0, tint = null, hot = null } = {}) {
  const made = new Map();
  obj.traverse((o) => {
    if (!o.isMesh || !o.material || o.material.isShaderMaterial) return;
    const w = hot && hot(o) ? 1 : warmth, key = o.material.uuid + ':' + w;
    if (!made.has(key)) { const c = patch(o.material.clone(), w); c.userData = {}; if (tint) tint(o.material, c); made.set(key, c); }
    o.material = made.get(key);
  });
  return obj;
}

// several geometries (each with a matrix) as one, non-indexed, with position, normal and uv
function mergeGeos(parts) {
  let n = 0; const list = parts.map(([g, m]) => { const q = g.index ? g.toNonIndexed() : g.clone(); if (m) q.applyMatrix4(m); n += q.attributes.position.count; return q; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2); let o = 0;
  for (const q of list) {
    pos.set(q.attributes.position.array, o * 3); if (q.attributes.normal) nor.set(q.attributes.normal.array, o * 3); if (q.attributes.uv) uv.set(q.attributes.uv.array, o * 2);
    o += q.attributes.position.count; q.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
const M4 = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(sx, sy, sz));
const _up = V(0, 1, 0);
// a rod from a to b (a cylinder of radius r)
function rod(a, b, r, seg = 6) {
  const d = b.clone().sub(a), L = d.length();
  return [new THREE.CylinderGeometry(r, r, L, seg, 1), new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(_up, d.normalize()), V(1, 1, 1))];
}
const boxP = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => [new THREE.BoxGeometry(w, h, d), M4(x, y, z, rx, ry, rz)];
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// ---------------------------------------------------------------- sky
const POLE = V(0, Math.sin(0.91), -Math.cos(0.91));                      // the celestial pole: north, 52 degrees up
const MW = V(1, 0.22, 0.9).normalize(), MX = V(0, 1, 0).addScaledVector(MW, -MW.y).normalize(), MY = new THREE.Vector3().crossVectors(MW, MX);
const FARM = V(-0.78, 0.03, -0.62).normalize();
const SKY = `
uniform vec3 uMW; uniform vec3 uMX; uniform vec3 uMY; uniform vec3 uFarm; uniform float uSkyL2;
void main() {
  vec3 d = normalize(vPos);
  float az = atan(d.x, -d.z);
  float el = d.y / max(length(d.xz), 1e-3);
  // the night sky: darkest overhead, a little airglow low down
  vec3 c = mix(vec3(0.02, 0.028, 0.055), vec3(0.006, 0.009, 0.024), smoothstep(0.0, 0.7, d.y));
  c += vec3(0.028, 0.034, 0.03) * exp(-max(el, 0.0) * 8.0);
  // the Milky Way: a broad band of unresolved stars with dust lanes down its middle
  float b = dot(d, uMW); float lon = atan(dot(d, uMX), dot(d, uMY));
  float band = exp(-b * b / 0.04);
  float cl = fNoise(vec2(lon * 6.0, b * 14.0)) * 0.6 + fNoise(vec2(lon * 17.0 + 3.0, b * 40.0)) * 0.4;
  float lane = smoothstep(0.35, 0.75, fNoise(vec2(lon * 9.0 + 5.0, b * 22.0 + 1.0))) * exp(-b * b / 0.006);
  c += vec3(0.085, 0.092, 0.125) * band * (0.3 + 0.95 * cl) * (0.65 + 0.35 * cos(lon - 0.4)) * (1.0 - 0.75 * lane);
  c += vec3(0.5, 0.6, 0.8) * uSkyL2 * (0.03 + 0.05 * smoothstep(0.2, 1.0, d.y));
  c = mix(c, c.grb * 1.5 + vec3(0.02, 0.0, 0.045) + vec3(0.03, 0.05, 0.06) * band * cl, u4D);
  // hills round the horizon: a far ridge and a nearer rise, the farm's yard light on the near one
  float r1 = 0.028 + 0.024 * fNoise(vec2(az * 2.2, 1.0)) + 0.01 * fNoise(vec2(az * 7.0, 4.0));
  float r2 = 0.008 + 0.02 * fNoise(vec2(az * 4.0 + 9.0, 2.0));
  if (el < r1) c = mix(vec3(0.013, 0.017, 0.026), vec3(0.03, 0.014, 0.04), u4D);
  if (el < r2) c = mix(vec3(0.008, 0.011, 0.015), vec3(0.02, 0.01, 0.03), u4D);
  float fa = acos(clamp(dot(d, uFarm), -1.0, 1.0));
  c += vec3(1.0, 0.72, 0.4) * (0.0000035 / (fa * fa + 0.0000025) + 0.02 * exp(-fa * 40.0));
  gl_FragColor = vec4(mix(c, fogTint(vWorld), fieldFog(cameraPosition, vWorld)), 1.0);
}`;
const STAR_V = `
attribute vec3 aC; attribute float aS; attribute float aK;
uniform float uTime; uniform float u4D; uniform float uRes; uniform vec3 uPole; uniform float uArc; uniform float uLine;
varying vec3 vC;
` + COMMON.replace('uniform float uTime; uniform float u4D;', '') + `
void main() {
  vec3 p = position;
  // a point on the star's path round the pole (aK -1..1 along the exposure)
  float a = aK * uArc; float cs = cos(a); float sn = sin(a);
  p = p * cs + cross(uPole, p) * sn + uPole * dot(uPole, p) * (1.0 - cs);
  vec4 w = modelMatrix * vec4(p, 1.0);
  float tw = 0.75 + 0.25 * sin(uTime * (2.0 + aS * 3.0) + aS * 40.0);
  float f = 1.0 - fieldFog(cameraPosition, w.xyz);
  vC = aC * f * mix(tw * (1.0 - 0.55 * u4D), u4D * (1.0 - aK * aK) * 0.2, uLine);   // brightest at now, fading to either end
  gl_PointSize = max(1.2, aS * uRes / 360.0);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const STAR_F = `
varying vec3 vC; uniform float uLine;
void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = mix(1.0 - smoothstep(0.2, 1.0, r), 1.0, uLine); gl_FragColor = vec4(vC * a, 1.0); }`;
function buildSky(g) {
  const sky = new THREE.Group(); g.add(sky);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 32), sm(SKY, { uMW: { value: MW }, uMX: { value: MX }, uMY: { value: MY }, uFarm: { value: FARM }, uSkyL2: U.uSkyL }, { side: THREE.BackSide, depthWrite: false }));
  dome.renderOrder = -10; dome.frustumCulled = false; sky.add(dome);
  const R = rng(7), N = 2600, pos = [], col = [], size = [], lines = { pos: [], col: [], size: [], k: [] };
  for (let i = 0; i < N; i++) {
    const d = V(0, 0, 0);
    if (R() < 0.45) { const lon = R() * TAU, b = (R() + R() + R() - 1.5) * 0.24; d.copy(MX).multiplyScalar(Math.sin(lon)).addScaledVector(MY, Math.cos(lon)).addScaledVector(MW, b).normalize(); }
    else d.set(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).normalize();
    if (d.y < -0.02) d.y = -d.y;
    const m = Math.pow(R(), 7), s = 1.3 + 4.2 * m, br = 0.3 + 0.9 * Math.pow(R(), 2) + m, tc = R();
    const c = tc < 0.2 ? [1, 0.8, 0.62] : tc < 0.75 ? [0.9, 0.93, 1] : [0.7, 0.8, 1];
    pos.push(d.x * 290, d.y * 290, d.z * 290); col.push(c[0] * br, c[1] * br, c[2] * br); size.push(s);
    // the brighter stars also get their path: an arc round the pole, the same sweep for every star, in ten short pieces
    if (s > 1.9) for (let j = 0; j < 10; j++) for (const k of [j / 10 * 2 - 1, (j + 1) / 10 * 2 - 1]) { lines.pos.push(d.x * 290, d.y * 290, d.z * 290); lines.col.push(c[0] * br, c[1] * br, c[2] * br); lines.size.push(s); lines.k.push(k); }
  }
  const mk = (P, line) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3)); geo.setAttribute('aC', new THREE.Float32BufferAttribute(P.col, 3));
    geo.setAttribute('aS', new THREE.Float32BufferAttribute(P.size, 1)); geo.setAttribute('aK', new THREE.Float32BufferAttribute(P.k || new Array(P.size.length).fill(0), 1));
    const mat = new THREE.ShaderMaterial({ vertexShader: STAR_V, fragmentShader: STAR_F, ...ADD, uniforms: { ...U, uPole: { value: POLE }, uArc: { value: 0.035 }, uLine: { value: line } } });
    const o = line ? new THREE.LineSegments(geo, mat) : new THREE.Points(geo, mat); o.frustumCulled = false; o.renderOrder = -9; sky.add(o); return o;
  };
  mk({ pos, col, size }, 0); const arcs = mk(lines, 1);
  return { sky, arcs };
}

// ---------------------------------------------------------------- ground, grass, hedges
const GROUND = `
uniform vec4 uLead; uniform float uLeadA;
void main() {
  vec3 p = vWorld; float d = vDepth;
  float n1 = fNoise(p.xz * 0.33); float n2 = fNoise(p.xz * 1.7 + 7.0); float n3 = fNoise(p.xz * 8.0) * (1.0 - smoothstep(12.0, 45.0, d));
  float n4 = fNoise(p.xz * 36.0) * (1.0 - smoothstep(3.0, 12.0, d));
  // rough late-autumn pasture: dull green, straw-coloured dead tussocks, darker hollows
  vec3 g = mix(vec3(0.05, 0.068, 0.043), vec3(0.094, 0.098, 0.058), n1);
  g = mix(g, vec3(0.13, 0.117, 0.07), smoothstep(0.52, 0.85, n2) * 0.65);
  g *= 0.72 + 0.5 * n3; g *= 0.85 + 0.35 * n4;
  // trodden flat round the camp and along the way in from the gate; the lane's tarmac beyond the verge
  float camp = 1.0 - smoothstep(1.6, 4.2, length(p.xz - vec2(0.0, 0.5)));
  float path = 1.0 - smoothstep(0.25, 1.0, sdSeg(p.xz, vec2(11.2, 0.3), vec2(2.6, 0.3)));
  g = mix(g, g * 0.7 + vec3(0.012, 0.01, 0.005), max(camp * 0.6, path * 0.5));
  float lane = smoothstep(13.5, 13.75, p.x) * (1.0 - smoothstep(16.9, 17.1, p.x));
  g = mix(g, vec3(0.045, 0.047, 0.052) * (0.8 + 0.4 * n4), lane);
  vec3 n = normalize(vec3((n2 - 0.5) * 0.6, 1.0, (n3 - 0.5) * 0.6));
  vec3 c = g * fieldLight(p, n);
  // the mantis's sight: time laid on the ground. Where they walked this evening still glows, the wind is its own streaks,
  // and a pale line runs ahead of you to where you are going.
  float flow = fNoise(vec2(dot(p.xz, vec2(0.8, -0.6)) * 2.4, dot(p.xz, vec2(0.6, 0.8)) * 0.2 - uTime * 0.4));
  vec3 c4 = c.brg * 1.7 + vec3(0.035, 0.016, 0.07) * (0.4 + 0.6 * n1) + vec3(0.06, 0.3, 0.27) * pow(flow, 3.0) * (0.25 + 0.75 * (1.0 - lane));
  c4 += vec3(1.0, 0.5, 0.13) * (path * 0.3 + camp * 0.1) * (0.7 + 0.3 * sin(uTime * 1.3 + p.x * 2.0)) * (0.5 + 0.5 * n3);
  vec2 ld = uLead.zw - uLead.xy; float ll = max(length(ld), 1e-3);
  float along = dot(p.xz - uLead.xy, ld / ll);
  float lead = (1.0 - smoothstep(0.03, 0.26, sdSeg(p.xz, uLead.xy, uLead.zw))) * smoothstep(0.6, 1.6, along) * (0.45 + 0.55 * sin(along * 5.0 - uTime * 2.6));
  c4 += vec3(0.7, 0.82, 1.0) * lead * uLeadA;
  c = mix(c, c4, u4D);
  gl_FragColor = vec4(fieldAir(c, p), 1.0);
}`;
const TUFT = `
uniform sampler2D uMap; uniform vec3 uLo; uniform vec3 uHi;
void main() {
  vec4 t = texture2D(uMap, vUv);
  if (t.a < 0.45) discard;
  vec3 g = mix(uLo, uHi, vUv.y * (0.6 + 0.6 * t.r));
  vec3 c = g * fieldLight(vWorld, vec3(0.0, 1.0, 0.0));
  vec3 c4 = c.brg * 1.7 + vec3(0.05, 0.22, 0.2) * vUv.y * (0.2 + 0.9 * fNoise(vWorld.xz * 0.45 + vec2(uTime * 0.35, -uTime * 0.2)));
  c = mix(c, c4, u4D);
  gl_FragColor = vec4(fieldAir(c, vWorld), 1.0);
}`;
// each tuft leans with the wind: the top of the card moves, the root stays
const TUFT_SWAY = `
  float sw = uv.y * uv.y * (sin(uTime * 1.3 + w.x * 0.9 + w.z * 0.7) * 0.05 + sin(uTime * 2.9 + w.x * 2.3) * 0.02);
  w.x += sw; w.z += sw * 0.6;
`;
const bladeTex = (twig) => canvasTex(256, 256, (g, w, h) => {
  const R = rng(twig ? 31 : 11);
  g.clearRect(0, 0, w, h); g.lineCap = 'round';
  if (twig) {
    // bare hedge twigs: a few stems forking upward
    const fork = (x, y, a, len, wd, n) => { const x2 = x + Math.sin(a) * len, y2 = y - Math.cos(a) * len; g.strokeStyle = '#888'; g.lineWidth = wd; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke(); if (n > 0) for (let i = 0; i < 2 + (R() < 0.4 ? 1 : 0); i++) fork(x2, y2, a + (R() - 0.5) * 1.3, len * (0.55 + R() * 0.3), wd * 0.65, n - 1); };
    for (let i = 0; i < 5; i++) fork(30 + i * 48 + R() * 20, h, (R() - 0.5) * 0.5, 60 + R() * 40, 5, 3);
  } else {
    for (let i = 0; i < 46; i++) {
      const x = 14 + R() * (w - 28), top = h * (0.05 + R() * 0.55), lean = (R() - 0.5) * 70, sh = 110 + R() * 145;
      g.strokeStyle = `rgb(${sh},${sh},${sh})`; g.lineWidth = 2.5 + R() * 4.5;
      g.beginPath(); g.moveTo(x, h + 4); g.quadraticCurveTo(x + lean * 0.2, (h + top) / 2, x + lean, top); g.stroke();
    }
  }
});
function tuftMesh(spots, tex, lo, hi, wMin, wMax, hMin, hMax, seed) {
  const card = new THREE.PlaneGeometry(1, 1); card.translate(0, 0.5, 0);
  const geo = mergeGeos([[card, null], [card, M4(0, 0, 0, 0, PI / 3)], [card, M4(0, 0, 0, 0, -PI / 3)]]);
  const mat = sm(TUFT, { uMap: { value: tex }, uLo: { value: new THREE.Color(...lo) }, uHi: { value: new THREE.Color(...hi) } }, { side: THREE.DoubleSide, displace: TUFT_SWAY });
  const im = new THREE.InstancedMesh(geo, mat, spots.length), o = new THREE.Object3D(), R = rng(seed);
  spots.forEach(([x, y, z], i) => { o.position.set(x, y, z); o.rotation.set(0, R() * TAU, 0); const wd = wMin + R() * (wMax - wMin); o.scale.set(wd, hMin + R() * (hMax - hMin), wd); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
  im.frustumCulled = false;
  return im;
}
// a hedge: a rounded, lumpy bank of growth swept along a line, with a ragged top of bare twigs
function hedgeRun(g, a, b, hgt, wid, seed, twigTex, leafMat) {
  const R = rng(seed), L = a.distanceTo(b), nL = Math.ceil(L / 0.8), nA = 9, pos = [], col = [], idx = [];
  const dir = b.clone().sub(a).normalize(), side = V(-dir.z, 0, dir.x), spots = [];
  const hs = []; for (let i = 0; i <= nL; i++) hs.push(hgt * (0.82 + 0.36 * (0.5 + 0.5 * Math.sin(i * 0.37 + seed) * Math.sin(i * 0.11 + seed * 2))) + (R() - 0.5) * 0.2);
  for (let i = 0; i <= nL; i++) for (let j = 0; j <= nA; j++) {
    const th = j / nA * PI, lump = 1 + (R() - 0.5) * 0.28, h = hs[i], c = a.clone().addScaledVector(dir, i / nL * L).addScaledVector(side, Math.cos(th) * wid * 0.5 * lump * (0.75 + 0.25 * Math.sin(th)));
    pos.push(c.x, Math.pow(Math.sin(th), 0.6) * h * lump, c.z);
    const s = 0.5 + R() * 0.6; col.push(0.055 * s, 0.07 * s, 0.04 * s);
    if (j === 4 && R() < 0.9) spots.push([c.x + (R() - 0.5) * wid * 0.4, h * 0.9, c.z + (R() - 0.5) * wid * 0.4]);
  }
  for (let i = 0; i < nL; i++) for (let j = 0; j < nA; j++) { const p = i * (nA + 1) + j, q = p + nA + 1; idx.push(p, q, p + 1, p + 1, q, q + 1); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, leafMat); g.add(m);
  g.add(tuftMesh(spots, twigTex, [0.03, 0.028, 0.022], [0.06, 0.055, 0.045], 0.9, 1.7, 0.6, 1.3, seed + 5));
}
// a bare tree: trunk and forking limbs, one geometry
function tree(x, z, h, seed) {
  const R = rng(seed), parts = [];
  const grow = (p, d, len, r, n) => {
    const e = p.clone().addScaledVector(d, len); parts.push(rod(p, e, r, n > 2 ? 7 : 5));
    if (n <= 0) return;
    const k = n > 2 ? 2 + (R() < 0.5 ? 1 : 0) : 2;
    for (let i = 0; i < k; i++) { const nd = d.clone().add(V((R() - 0.5) * 1.5, 0.15 + R() * 0.5, (R() - 0.5) * 1.5)).normalize(); grow(e, nd, len * (0.62 + R() * 0.2), r * 0.62, n - 1); }
  };
  grow(V(x, 0, z), V((R() - 0.5) * 0.1, 1, (R() - 0.5) * 0.1).normalize(), h * 0.36, h * 0.035, 5);
  return mergeGeos(parts);
}
function buildGround(g) {
  const R = rng(3);
  const lead = { uLead: { value: new THREE.Vector4(0, 0, 0, 1) }, uLeadA: { value: 0 } };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), sm(GROUND, lead)); ground.rotation.x = -PI / 2; g.add(ground);
  // grass standing above the sward: thick round the camp's edge and along the way up from the hedge, thinner further out
  const spots = [], ok = (x, z) => Math.hypot(x, z - 0.5) > 2.9 && !(x > FENCE_X - 0.4 && x < 13.6 + 3.5) && !(Math.abs(z - 0.3) < 0.7 && x > 2.6 && x < 11.2);
  const add = (n, f) => { for (let i = 0, k = 0; i < n && k < n * 6; k++) { const [x, z] = f(); if (ok(x, z)) { spots.push([x, 0, z]); i++; } } };
  add(1500, () => { const a = R() * TAU, r = 2.9 + Math.pow(R(), 1.6) * 5; return [Math.cos(a) * r, 0.5 + Math.sin(a) * r]; });
  add(2600, () => [(R() - 0.5) * 16, 2 + R() * 19.5]);
  add(3200, () => [-34 + R() * 45, -34 + R() * 56]);
  const tex = bladeTex(false), twig = bladeTex(true);
  g.add(tuftMesh(spots, tex, [0.028, 0.04, 0.024], [0.15, 0.14, 0.085], 0.35, 0.75, 0.22, 0.55, 17));
  // hedges: south (the fog comes over this one), west, far north, and beyond the lane; trees stand in them
  const leaf = pstd(0xffffff, { vertexColors: true, roughness: 1 });
  hedgeRun(g, V(-46, 0, HEDGE_Z), V(FENCE_X + 0.4, 0, HEDGE_Z), 2.3, 2.0, 1, twig, leaf);
  hedgeRun(g, V(-46, 0, HEDGE_Z), V(-46, 0, -52), 2.2, 2.0, 2, twig, leaf);
  hedgeRun(g, V(-46, 0, -52), V(17.6, 0, -52), 2.2, 2.0, 3, twig, leaf);
  hedgeRun(g, V(17.9, 0, 40), V(17.9, 0, -52), 2.4, 1.8, 4, twig, leaf);
  const bark = pstd(0x1c1814, { roughness: 1 });
  for (const [x, z, h, s] of [[-17, HEDGE_Z + 0.2, 11, 21], [6.5, HEDGE_Z + 0.3, 8.5, 22], [-46.2, 3, 12, 23], [-46, -30, 10, 24], [18.2, -17, 11, 25], [18.1, 14, 9, 26], [-9, -52.3, 12, 27]]) g.add(new THREE.Mesh(tree(x, z, h, s), bark));
  return { lead, ground };
}

// ---------------------------------------------------------------- fence, gate, cars
function buildFence(g) {
  const wood = pstd(0x4a4034, { roughness: 0.95 }), steel = pstd(0x8a9094, { metalness: 0.7, roughness: 0.45 });
  // posts every 3 m, skipping the gateway, and three strands of wire
  const posts = [], wires = [];
  for (let z = -50; z <= HEDGE_Z; z += 3) if (z < -2.4 || z > 2.9) posts.push(boxP(0.09, 1.25, 0.09, FENCE_X, 0.62, z, 0, (z * 7) % 1 * 0.2, ((z * 13) % 5) * 0.012));
  for (const [z0, z1] of [[-50, -1.75], [2.35, HEDGE_Z]]) for (const y of [0.38, 0.72, 1.08]) wires.push(boxP(0.006, 0.006, z1 - z0, FENCE_X, y, (z0 + z1) / 2));
  posts.push(boxP(0.16, 1.5, 0.16, FENCE_X, 0.75, -1.75), boxP(0.16, 1.5, 0.16, FENCE_X, 0.75, 2.35));
  g.add(new THREE.Mesh(mergeGeos(posts), wood), new THREE.Mesh(mergeGeos(wires), steel));
  // a galvanised field gate, 3.9 m, swung open into the field on its north post
  const gate = new THREE.Group(), bars = [], Lg = 3.9;
  for (const y of [0.12, 0.34, 0.56, 0.8, 1.12]) bars.push(rod(V(0, y, 0), V(0, y, Lg), 0.016));
  bars.push(rod(V(0, 0.12, 0), V(0, 1.12, 0), 0.02), rod(V(0, 0.12, Lg), V(0, 1.12, Lg), 0.02), rod(V(0, 0.12, Lg / 2), V(0, 1.12, Lg / 2), 0.014), rod(V(0, 0.12, 0), V(0, 1.12, Lg / 2), 0.012), rod(V(0, 0.12, Lg), V(0, 1.12, Lg / 2), 0.012));
  gate.add(new THREE.Mesh(mergeGeos(bars), steel)); gate.position.set(FENCE_X - 0.1, 0.1, -1.7); gate.rotation.y = -1.25; g.add(gate);
}
// What the mantis sees inside a thing: additive, drawn through whatever is in front of it, only while u4D is up
const XRAY = `
uniform vec3 uCol; uniform float uAmt;
void main() {
  vec3 v = normalize(cameraPosition - vWorld);
  float e = 0.35 + 0.65 * abs(dot(normalize(vNormal), v));
  float pulse = 0.8 + 0.2 * sin(uTime * 2.0 + vWorld.y * 9.0 + vWorld.z * 3.0);
  gl_FragColor = vec4(uCol * e * pulse * uAmt * u4D * (1.0 - 0.75 * fieldFog(cameraPosition, vWorld)), 1.0);
}`;
const xray = (col, amt) => sm(XRAY, { uCol: { value: new THREE.Color(...col) }, uAmt: { value: amt } }, { ...ADD, depthTest: false });
// a small hatchback, nose toward -z, seen at night from a field: body, glasshouse, wheels, an open door on the field side
// (and the tailgate up on the one they unloaded), the cabin lamp on, and its frame and works for the mantis's sight
function car(g, at, colour, tailUp, light) {
  const c = new THREE.Group(); c.position.copy(at); c.rotation.y = (at.z < 0 ? 0.05 : -0.04); g.add(c);
  const paint = pstd(colour, { metalness: 0.55, roughness: 0.38 }), glass = pstd(0x0c1116, { metalness: 0.2, roughness: 0.15, transparent: true, opacity: 0.55 });
  const trim = pstd(0x0e0f11, { roughness: 0.8 }), seat = pstd(0x3a3d44, { roughness: 0.9 });
  const prof = (pts, wdt, bev) => {
    const s = new THREE.Shape(); pts.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
    const e = new THREE.ExtrudeGeometry(s, { depth: wdt - bev * 2, bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 2, curveSegments: 4 });
    e.translate(0, 0, -(wdt - bev * 2) / 2); e.rotateY(-PI / 2); return e;   // the profile's x runs along the car's z
  };
  const body = new THREE.Mesh(prof([[-2.02, 0.3], [-2.05, 0.6], [-1.9, 0.78], [-0.95, 0.9], [1.0, 0.92], [1.92, 0.9], [2.04, 0.72], [2.03, 0.3]], 1.74, 0.07), paint);
  const top = new THREE.Mesh(prof([[-0.98, 0.9], [-0.36, 1.4], [1.3, 1.43], [1.86, 0.92]], 1.56, 0.06), glass); top.renderOrder = 2;
  const roof = new THREE.Mesh(prof([[-0.42, 1.385], [-0.34, 1.425], [1.3, 1.455], [1.42, 1.4]], 1.5, 0.05), paint);
  const pill = []; for (const s of [-1, 1]) pill.push(rod(V(s * 0.76, 0.92, -0.95), V(s * 0.74, 1.4, -0.36), 0.03), rod(V(s * 0.77, 0.92, 0.42), V(s * 0.75, 1.42, 0.45), 0.035), rod(V(s * 0.76, 0.92, 1.84), V(s * 0.74, 1.42, 1.3), 0.035));
  c.add(body, top, roof, new THREE.Mesh(mergeGeos(pill), paint));
  const wheels = []; for (const s of [-1, 1]) for (const z of [-1.3, 1.28]) wheels.push([new THREE.CylinderGeometry(0.31, 0.31, 0.2, 18), M4(s * 0.8, 0.31, z, 0, 0, PI / 2)]);
  c.add(new THREE.Mesh(mergeGeos(wheels), trim));
  const hubs = []; for (const s of [-1, 1]) for (const z of [-1.3, 1.28]) hubs.push([new THREE.CylinderGeometry(0.19, 0.19, 0.02, 14), M4(s * 0.905, 0.31, z, 0, 0, PI / 2)]);
  c.add(new THREE.Mesh(mergeGeos(hubs), pstd(0x9aa0a6, { metalness: 0.8, roughness: 0.4 })));
  // cabin: seats, dashboard, wheel, and the roof lamp that the open door has switched on
  const inside = [boxP(0.5, 0.14, 0.5, -0.38, 0.62, -0.1), boxP(0.5, 0.6, 0.12, -0.38, 0.95, 0.2, -0.2), boxP(0.5, 0.14, 0.5, 0.38, 0.62, -0.1), boxP(0.5, 0.6, 0.12, 0.38, 0.95, 0.2, -0.2), boxP(1.3, 0.14, 0.5, 0, 0.62, 0.95), boxP(1.3, 0.55, 0.12, 0, 0.93, 1.25, -0.2), boxP(1.5, 0.25, 0.3, 0, 0.88, -0.85)];
  c.add(new THREE.Mesh(mergeGeos(inside), seat));
  const wheelS = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.016, 6, 20), trim); wheelS.position.set(0.38, 1.0, -0.6); wheelS.rotation.x = -0.4; c.add(wheelS);
  const lampM = new THREE.MeshBasicMaterial({ color: 0xffe2b0 }), lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.09), lampM); lamp.position.set(0, 1.36, 0.25); c.add(lamp);
  light.position.copy(at).add(V(0, 1.2, 0.2)); g.add(light);
  // the door on the field side (west, -x), hinged at its front edge and standing open
  const door = new THREE.Group(); door.position.set(-0.87, 0, -0.9); door.rotation.y = -1.15;
  const dp = new THREE.Mesh(prof([[0, 0.36], [0, 0.9], [1.28, 0.92], [1.3, 0.36]], 0.07, 0.015), paint), dframe = [rod(V(0, 0.9, 0.02), V(0, 1.38, 0.58), 0.022), rod(V(0, 1.38, 0.58), V(0, 1.4, 1.3), 0.022), rod(V(0, 1.4, 1.3), V(0, 0.92, 1.3), 0.022)];
  door.add(dp, new THREE.Mesh(mergeGeos(dframe), paint), new THREE.Mesh(mergeGeos([boxP(0.03, 0.4, 1.1, 0.03, 0.62, 0.65)]), seat)); c.add(door);
  if (tailUp) { const tg = new THREE.Group(); tg.position.set(0, 1.42, 1.32); tg.rotation.x = 1.15; tg.add(new THREE.Mesh(mergeGeos([boxP(1.5, 0.05, 0.75, 0, 0, 0.4)]), paint), new THREE.Mesh(mergeGeos([boxP(1.3, 0.02, 0.5, 0, -0.03, 0.36)]), glass)); c.add(tg); }
  const tail = new THREE.MeshBasicMaterial({ color: 0x3a0606 }); for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.02), tail); r.position.set(s * 0.68, 0.78, 2.05); c.add(r); }
  // inside the panels: sills and cross-members, pillars and roof rails, engine and gearbox, shaft, axles, exhaust, tank, the
  // seat frames, the steering column; the battery brighter than the rest
  const fr = [];
  for (const s of [-1, 1]) fr.push(rod(V(s * 0.72, 0.34, -1.85), V(s * 0.72, 0.34, 1.9), 0.035), rod(V(s * 0.72, 1.4, -0.36), V(s * 0.72, 1.43, 1.3), 0.025), rod(V(s * 0.74, 0.36, -0.95), V(s * 0.74, 1.4, -0.36), 0.025), rod(V(s * 0.75, 0.36, 0.42), V(s * 0.75, 1.42, 0.45), 0.025), rod(V(s * 0.74, 0.36, 1.84), V(s * 0.74, 1.42, 1.3), 0.025), rod(V(s * 0.38, 0.5, -0.3), V(s * 0.38, 0.5, 0.3), 0.02), rod(V(s * 0.38, 0.5, 0.25), V(s * 0.38, 1.25, 0.4), 0.02));
  for (const z of [-1.85, -0.95, 0.42, 1.2, 1.9]) fr.push(rod(V(-0.72, 0.34, z), V(0.72, 0.34, z), 0.03));
  for (const z of [-1.3, 1.28]) fr.push(rod(V(-0.8, 0.31, z), V(0.8, 0.31, z), 0.028));
  fr.push(boxP(0.6, 0.45, 0.5, -0.05, 0.6, -1.4), boxP(0.3, 0.3, 0.4, 0.35, 0.5, -1.35), rod(V(0.1, 0.36, -1.1), V(0.1, 0.36, 1.28), 0.022), rod(V(-0.35, 0.26, -1.0), V(-0.4, 0.26, 2.0), 0.03), boxP(0.8, 0.2, 0.5, 0, 0.42, 1.0), rod(V(0.38, 1.0, -0.62), V(0.38, 0.62, -1.15), 0.016));
  const fm = new THREE.Mesh(mergeGeos(fr), xray([0.2, 0.75, 0.9], 0.55)); fm.renderOrder = 8; c.add(fm);
  const bat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.18), xray([1.0, 0.85, 0.4], 1.4)); bat.position.set(-0.45, 0.72, -1.55); bat.renderOrder = 8; c.add(bat);
  return { group: c, lamp: lampM, light };
}

// ---------------------------------------------------------------- the camp: chairs, table, blanket, the things they brought
const CAMP = V(0, 0, -0.2);
const FEET = V(MAN_H.x, 0, MAN_H.z + 0.84);                  // the man's feet: where he will stand (hip height 0.84 at scale 1)                                 // the middle of the ring of chairs
const facing = (x, z, to = CAMP) => Math.atan2(to.x - x, to.z - z);   // rotation.y that turns +z (a person's front) toward a point
// a folding camp chair facing +z: aluminium frame, a sling seat that sags, a back panel, arms with a cup holder
function chair(g, x, z, cloth) {
  const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = facing(x, z); g.add(c);
  const alu = pstd(0x60646a, { metalness: 0.6, roughness: 0.45 }), f = [];
  for (const s of [-1, 1]) {
    f.push(rod(V(s * 0.27, 0, 0.25), V(s * 0.27, 0.44, 0.22), 0.011), rod(V(s * 0.27, 0, -0.27), V(s * 0.27, 1.0, -0.37), 0.011),
      rod(V(s * 0.3, 0.63, -0.31), V(s * 0.3, 0.63, 0.22), 0.013), rod(V(s * 0.29, 0.63, 0.22), V(s * 0.27, 0.44, 0.22), 0.011),
      rod(V(s * 0.27, 0.05, 0.24), V(s * 0.27, 0.42, -0.26), 0.008), rod(V(s * 0.27, 0.05, -0.26), V(s * 0.27, 0.42, 0.22), 0.008));
  }
  f.push(rod(V(-0.27, 0.44, 0.22), V(0.27, 0.44, 0.22), 0.011), rod(V(-0.27, 0.43, -0.25), V(0.27, 0.43, -0.25), 0.011), rod(V(-0.27, 0.985, -0.36), V(0.27, 0.985, -0.36), 0.011));
  const ring = new THREE.TorusGeometry(0.045, 0.008, 6, 16); f.push([ring, M4(0.36, 0.63, 0.12, PI / 2)]);
  c.add(new THREE.Mesh(mergeGeos(f), alu));
  const seat = new THREE.PlaneGeometry(0.54, 0.47, 6, 6); seat.rotateX(-PI / 2);
  { const p = seat.attributes.position; for (let i = 0; i < p.count; i++) { const sx = p.getX(i) / 0.27, sz = p.getZ(i) / 0.235; p.setY(i, 0.44 - 0.035 * (1 - sx * sx) * (1 - sz * sz)); } seat.computeVertexNormals(); }
  const fab = pstd(cloth, { roughness: 0.95, side: THREE.DoubleSide });
  c.add(new THREE.Mesh(mergeGeos([[seat, null], [new THREE.PlaneGeometry(0.54, 0.5, 2, 2), M4(0, 0.73, -0.315, -0.17)]]), fab));
  return c;
}
// a tartan picnic blanket, slightly rucked where the grass pushes it up
function blanket(g) {
  const tex = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#26324a'; c.fillRect(0, 0, w, h);
    const band = (col, a, x, wd) => { c.fillStyle = col; c.globalAlpha = a; c.fillRect(x, 0, wd, h); c.fillRect(0, x, w, wd); };
    for (let k = 0; k < 4; k++) { const o = k * 64; band('#1f4a33', 0.75, o + 4, 22); band('#7a2a2a', 0.8, o + 34, 6); band('#c9b98a', 0.6, o + 46, 2); band('#0e1424', 0.5, o + 54, 8); }
    c.globalAlpha = 1;
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(2, 3);
  const geo = new THREE.PlaneGeometry(1.5, 2.15, 24, 32); geo.rotateX(-PI / 2);
  { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), e = Math.max(Math.abs(x) / 0.75, Math.abs(z) / 1.075); p.setY(i, 0.018 + 0.012 * Math.sin(x * 9 + z * 4) * Math.sin(z * 7) + 0.03 * Math.max(0, e - 0.9) * 10 * (0.5 + 0.5 * Math.sin(x * 13 + z * 11))); } geo.computeVertexNormals(); }
  const m = new THREE.Mesh(geo, pstd(0xffffff, { map: tex, roughness: 1 })); m.position.set(MAN_H.x - 0.05, 0, MAN_H.z - 0.15); m.rotation.y = 0.06; g.add(m);
  return m;
}
// the low camp table: a flask and its cup, a mug, the phone playing the tones through a small round speaker, the red torch
function table(g) {
  const t = new THREE.Group(); t.position.copy(TABLE); t.rotation.y = 0.2; g.add(t);
  const alu = pstd(0x7a7e84, { metalness: 0.6, roughness: 0.4 }), top = pstd(0x3c3a36, { roughness: 0.8 });
  const legs = []; for (const s of [-1, 1]) legs.push(rod(V(s * 0.27, 0, -0.17), V(s * 0.27, 0.45, 0.17), 0.009), rod(V(s * 0.27, 0, 0.17), V(s * 0.27, 0.45, -0.17), 0.009));
  t.add(new THREE.Mesh(mergeGeos(legs), alu), new THREE.Mesh(mergeGeos([boxP(0.62, 0.022, 0.42, 0, 0.46, 0)]), top));
  const flaskM = pstd(0x24402f, { metalness: 0.35, roughness: 0.45 }), steel = pstd(0xa8adb2, { metalness: 0.85, roughness: 0.3 });
  t.add(new THREE.Mesh(mergeGeos([[new THREE.CylinderGeometry(0.037, 0.037, 0.25, 16), M4(-0.19, 0.596, -0.06)]]), flaskM));
  t.add(new THREE.Mesh(mergeGeos([[new THREE.CylinderGeometry(0.041, 0.037, 0.075, 16), M4(-0.19, 0.758, -0.06)], [new THREE.CylinderGeometry(0.036, 0.03, 0.07, 14), M4(-0.06, 0.506, 0.1)]]), steel));
  t.add(new THREE.Mesh(mergeGeos([[new THREE.CylinderGeometry(0.04, 0.034, 0.09, 14), M4(0.05, 0.516, -0.12)]]), pstd(0xd8d2c4, { roughness: 0.5 })));
  // speaker: a fabric-covered drum on its side, a blue power light; the phone face up beside it with the app's dim screen
  const spk = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.12, 20), pstd(0x2a2c30, { roughness: 0.95 })); spk.rotation.z = PI / 2; spk.position.set(0.16, 0.52, 0.02); t.add(spk);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 4), new THREE.MeshBasicMaterial({ color: 0x3a7cff })); led.position.set(0.16, 0.567, 0.03); t.add(led);
  t.add(new THREE.Mesh(mergeGeos([boxP(0.075, 0.009, 0.155, 0.02, 0.476, 0.1, 0, 0.3)]), pstd(0x111214, { roughness: 0.3 })));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.065, 0.14), new THREE.MeshBasicMaterial({ color: 0x24384c })); scr.rotation.set(-PI / 2, 0, 0.3); scr.position.set(0.02, 0.4815, 0.1); t.add(scr);
  // the red torch, lying on its side, lens toward the ring
  t.add(new THREE.Mesh(mergeGeos([[new THREE.CylinderGeometry(0.019, 0.016, 0.15, 12), M4(0.2, 0.49, -0.13, 0, 0, PI / 2)]]), pstd(0x1a1a1c, { roughness: 0.6 })));
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.018, 14), new THREE.MeshBasicMaterial({ color: 0xff2a14 })); lens.position.set(0.276, 0.49, -0.13); lens.rotation.y = PI / 2; t.add(lens);
  return { group: t, speaker: t.localToWorld(V(0.16, 0.52, 0.02)) };
}

// ---------------------------------------------------------------- the people and their time
// Every person's pose is a pure function of their own clock (pose(h, t)), so a ghost is the same function at another time.
const MAN_COL = 0x6a7384;                                    // the man from the exam table (night.js exam(): makeHuman(1, 0x6a7384))
// his own shirt as on the table; jeans and walking boots for a night in a field
const MAN_FIT = { legs: 'jeans', legCol: 0x2e3a50, shoes: 'boots', shoeCol: 0x4a3424 };
const CREW = [
  { k: 'still', col: 0x7a4a5c, sc: 0.96, at: V(-1.8, 0, -0.45), cloth: 0x2e4d3a,     // eyes closed, still meditating
    outfit: { top: 'fleece', topCol: [0x2f5c5e], legs: 'trousers', legCol: 0x25252b, shoes: 'trainers', shoeCol: 0x5a5f6a, beanie: 0x8a3a48,
      face: { fem: 1, age: 0.55, len: 0.96, full: 0.3, chinW: 0.3, noseL: -0.3, cheek: 0.4, eye: -0.1, lips: 0.1, hair: 'tied', hairCol: 0x5a5048, tone: 0xd2ab8e } } },   // face: makeHuman's adult face (models.js faceDims); in the outfit so walking doubles and ghosts share it
  { k: 'notes', col: 0x4f6a4a, sc: 1.0, at: V(0.25, 0, -2.0), cloth: 0x34396a,       // the log-keeper, red head torch, looking up and down
    outfit: { top: 'puffer', topCol: [0x2a3852], legs: 'jeans', legCol: 0x34466a, shoes: 'boots', shoeCol: 0x3a2a1c, beanie: 0x44503c,
      face: { age: 0.15, jaw: 0.3, full: 0.3, noseW: 0.2, brow: 0.4, browT: 0.5, hair: 'short', hairCol: 0x2a1c14, beard: 'full', tone: 0xb88a6a } } },
  { k: 'flask', col: 0x8a6a3c, sc: 1.04, at: V(1.9, 0, -0.6), cloth: 0x6a2a2a,       // cup in hand, talking
    outfit: { top: 'flannel', topCol: [0x7a2420, 0x161212, 0xc8b070], sleeves: 'rolled', legs: 'jeans', legCol: 0x283652, shoes: 'boots', shoeCol: 0x6a4428,
      face: { age: 0.9, full: 0.5, w: 1.03, noseL: 0.4, tip: 0.5, chin: -0.3, hair: 'bald', hairCol: 0x9a968e, beard: 'moustache', beardCol: 0xb0a698, tone: 0xd9b49c } } },
  { k: 'laser', col: 0x3a4a6a, sc: 1.02, at: V(-1.65, 0, 1.8),                        // standing, the green laser
    outfit: { top: 'hoodie', topCol: [0x585c62], legs: 'jeans', legCol: 0x1e2638, shoes: 'trainers', shoeCol: 0xd8d4cc,
      face: { fem: 1, age: 0.05, lips: 0.5, noseW: 0.35, eye: 0.2, cheek: 0.3, hair: 'long', hairCol: 0x161010, tone: 0x7a5038, eyeCol: 0x2a1a10 } } },
];
const dirAE = (az, el, out = V(0, 0, 0)) => out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));   // az from north toward east
const LASER_O = V(-1.4, 1.75, 1.95);                         // about where the beam leaves the hand (for the lights' positions)
const TRI_C2 = LASER_O.clone().add(dirAE(PI + 0.42, 0.98).multiplyScalar(170));   // where the triangle moves to, as one
// the triangle the laser draws: three directions round a centre high in the southern sky
const TRI_C = dirAE(PI - 0.12, 1.0);
const TRI_V = (() => { const e1 = new THREE.Vector3().crossVectors(TRI_C, V(0, 1, 0)).normalize(), e2 = new THREE.Vector3().crossVectors(e1, TRI_C).normalize();
  return [0, 1, 2].map((i) => { const a = PI / 2 + i * TAU / 3; return TRI_C.clone().addScaledVector(e1, Math.cos(a) * 0.15).addScaledVector(e2, Math.sin(a) * 0.15).normalize(); }); })();
const _lv = V(0, 0, 0), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = V(0, 0, 0), _v2 = V(0, 0, 0), _down = V(0, -1, 0);
const breathe = (u, t) => { const b = Math.sin(t * 1.6 + u.ph); u.chest.scale.set(1 + b * 0.008, 1, 1 + b * 0.018); return b; };
// a direction in world space in the person's own frame (their body's frame)
const toBody = (h, d, out) => out.copy(d).applyQuaternion(_q.copy(h.quaternion).multiply(h.userData.body.quaternion).invert());
// turn the neck toward a world direction, within what a neck can do; k blends from the neck's own rest (nod forward, turn)
function neckToward(h, d, k, nod = 0, turn = 0) {
  const u = h.userData; toBody(h, d, _v);
  const yaw = clamp(Math.atan2(_v.x, _v.z), -1.0, 1.0), pit = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.5, 0.8);
  u.neck.rotation.set(lerp(nod, -pit, k), lerp(turn, yaw, k), 0);
}
// aim an arm (shoulder group) along a world direction, the elbow straight; k blends from its rest quaternion
function armToward(h, sh, d, k, rest) {
  toBody(h, d, _v).normalize(); _q2.setFromUnitVectors(_down, _v); sh.quaternion.copy(rest).slerp(_q2, k);
}
// the laser's direction on the laser-holder's clock: slow sweeps over the southern sky; once, the triangle
function laserDir(L, t, out) {
  const az = PI + 0.1 + 0.55 * Math.sin(t * 0.31) + 0.2 * Math.sin(t * 0.73 + 1), el = 0.82 + 0.28 * Math.sin(t * 0.23 + 0.5);
  dirAE(az, el, out);
  if (L.drawAt == null) return out;
  const s = t - L.drawAt;
  if (s < -0.0 || s > 6.6) return out;
  // in: to the first corner; three strokes round the triangle; a hold; back to the sweep
  let p;
  if (s < 0.7) p = TRI_V[0];
  else if (s < 4.3) { const k = (s - 0.7) / 1.2, i = Math.min(2, Math.floor(k)), f = sm01(0, 1, k - i); p = _lv.copy(TRI_V[i]).lerp(TRI_V[(i + 1) % 3], f).normalize(); }
  else p = TRI_V[0];
  const w = sm01(0, 0.7, s) * (1 - sm01(5.2, 6.6, s));
  return out.lerp(p, w).normalize();
}
const POSE = {
  still(h, t) { const u = h.userData; breathe(u, t); u.neck.rotation.set(0.42 + Math.sin(t * 0.21) * 0.05, Math.sin(t * 0.13) * 0.07, 0); u.body.rotation.z = Math.sin(t * 0.29) * 0.02; },
  notes(h, t) {
    const u = h.userData; breathe(u, t);
    const c = ((t + 1.5) % 9) / 9, up = sm01(0.3, 0.4, c) - sm01(0.74, 0.84, c);
    u.neck.rotation.set(lerp(0.5, -0.62, up), up * 0.35 * Math.sin(t * 0.37), 0);
  },
  flask(h, t, P) {
    const u = h.userData; breathe(u, t);
    const c = ((t + 2) % 7) / 7, gst = sm01(0.1, 0.2, c) - sm01(0.48, 0.62, c);
    u.foreL.rotation.x = u.foreX - 1.0 * gst * (1 + 0.12 * Math.sin(t * 6.5)); u.armL.rotation.x = u.armX - 0.22 * gst;
    _v2.subVectors(P.still, h.position).setY(0.25).normalize(); neckToward(h, _v2, 0.25 + 0.7 * gst, 0.12, 0);
  },
  laser(h, t, P) {
    const u = h.userData; breathe(u, t);
    laserDir(P.L, t, _v2); h.rotation.y = Math.atan2(_v2.x, _v2.z) * 0.55 + 0.15;
    armToward(h, u.armR, _v2, 1, u.restR); u.foreR.rotation.set(0, 0, 0);
    neckToward(h, _v2, 0.85);
    u.armL.rotation.set(-0.05 + Math.sin(t * 1.6) * 0.01, 0, -0.06);
  },
  man(h, t, P) {
    const u = h.userData; breathe(u, t);
    u.neck.rotation.set(0.3, P.noPoint ? 0 : 0.32 * Math.sin(t * 0.23) + 0.12 * Math.sin(t * 0.61), 0);   // head propped on a rolled coat
    const k = P.pointAt == null || P.noPoint ? 0 : sm01(P.pointAt, P.pointAt + 1.3, t) - sm01(P.pointAt + 5.5, P.pointAt + 7, t);
    _v2.copy(P.triDir); armToward(h, u.armR, _v2, k * 0.95, u.restR);
    u.foreR.rotation.x = -0.12 * (1 - k);
    neckToward(h, _v2, k * 0.6, u.neck.rotation.x, u.neck.rotation.y);
  },
};
// what the mantis's sight shows of a person's time: a fresnel shell, warm for where they were, pale for where they will be
const GHOST = `
uniform vec3 uCol; uniform float uA;
void main() {
  vec3 v = normalize(cameraPosition - vWorld);
  float f = 1.0 - abs(dot(normalize(vNormal), v));
  float a = (0.1 + 0.9 * f * f) * uA * u4D * (1.0 - 0.85 * fieldFog(cameraPosition, vWorld));
  gl_FragColor = vec4(uCol * a, 1.0);
}`;
const PAST = [1.0, 0.5, 0.18], FUTURE = [0.5, 0.78, 1.0];
const GHOSTS = [[-2, 0.34], [-1, 0.55], [1, 0.5], [2, 0.3]];   // [steps along the person's clock, strength]
const GHOST_DT = 1.4;                                             // seconds of their time per step
function ghostOf(make, col, a) {
  const h = make(), mat = sm(GHOST, { uCol: { value: new THREE.Color(...col) }, uA: { value: a } }, ADD);
  h.traverse((o) => { if (o.isMesh) { o.material = mat; o.renderOrder = 6; } });
  h.userData.mat = mat; return h;
}
function person(g, spec, P) {
  const seated = !!spec.cloth, make = () => {
    const h = makeHuman(spec.sc || 1, spec.col, { seated, outfit: spec.outfit });
    const u = h.userData; u.neck.rotation.order = 'YXZ'; u.restR = u.armR.quaternion.clone(); u.ph = spec.ph || 0;
    if (spec.k === 'man') { h.rotation.x = -PI / 2; }
    else { h.position.copy(spec.at); h.rotation.y = seated ? facing(spec.at.x, spec.at.z) : 0.3; }
    return h;
  };
  const h = make(), u = h.userData;
  fogify(h, { warmth: 0.45, hot: (o) => o.parent === u.head || o.parent === u.wristL || o.parent === u.wristR || o.parent === u.neck });
  g.add(h);
  const ghosts = GHOSTS.map(([k, a]) => { const gh = ghostOf(make, k < 0 ? PAST : FUTURE, a); gh.userData.k = k; g.add(gh); return gh; });
  return { h, ghosts, spec, clock: 0, rate: 1, offAt: null, pose: POSE[spec.k] };
}

// ---------------------------------------------------------------- lights in the sky
// One set of points: the swirling lights, the three in the triangle, and (in the mantis's sight) each light's path through
// time as a dotted line ahead and behind it. Positions are pure functions of the scene clock.
const ORB_V = `
attribute vec3 aC; attribute float aS; attribute float aA;
uniform float uPx;
varying vec3 vC; varying float vA;
` + COMMON + `
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vC = aC; vA = aA * (1.0 - fieldFog(cameraPosition, w.xyz));
  gl_PointSize = aS * uPx;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const ORB_F = `
varying vec3 vC; varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float core = exp(-r * r * 9.0), halo = exp(-r * 3.0) * 0.5 * (1.0 - r);
  gl_FragColor = vec4(vC * (core * 1.8 + halo) * vA, 1.0);
}`;
// As they are reported: mostly white and amber, one pulsing cherry red-orange, one blue-green; mostly still or slow, then
// one surprising thing: a dart to a new place and dead still again, a flash here and then there, two turning round each
// other, one splitting into two and then three. Silent.
const ORB_COLS = [[1, 0.62, 0.22], [1, 0.95, 0.88], [1, 0.3, 0.14], [1, 0.95, 0.9], [1, 0.72, 0.32], [0.35, 1, 0.78], [1, 0.84, 0.45]];
const ORB_N = ORB_COLS.length, TRAIL = 40, TRAIL_T = 3.2, FLASHER = 3;
const ORB_HOME = ORB_COLS.map((_, i) => { const R = rng(500 + i); return dirAE(PI + 0.5 + (R() - 0.5) * 0.9, 0.7 + R() * 0.4); });
ORB_HOME[5] = ORB_HOME[2];                                   // the red and the blue-green turn round one middle
const hashv = (i, n, out) => { const R = rng(i * 7919 + n * 104729 + 13); return out.set(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1); };
function orbAt(i, t, out) {
  const k = i === 5 ? 2 : i, P = 8 + (k % 4) * 2.3, x = (t + k * 2.9) / P, n = Math.floor(x), e = sm01(0.93, 0.975, x - n);
  const sp = i === FLASHER ? 0.4 : 0.12;
  const a = hashv(k, n, _v).multiplyScalar(sp), b = hashv(k, n + 1, _v2).multiplyScalar(sp);
  out.copy(ORB_HOME[i]).add(i === FLASHER ? a : a.lerp(b, e)).normalize().multiplyScalar(210).add(LASER_O);
  if (k === 2) { const w = t * 0.45 + (i === 5 ? PI : 0); out.x += Math.cos(w) * 10; out.y += Math.sin(w) * 6; out.z += Math.sin(w) * 10; }
  out.x += Math.sin(t * 0.13 + i) * 3; out.y += Math.sin(t * 0.09 + i * 2) * 2;
  return out;
}
// brightness: slow breathing; the red one pulses hard; the flasher is dark but for one short flash each time it moves
function orbPulse(i, t) {
  if (i === FLASHER) { const P = 8 + (FLASHER % 4) * 2.3, x = (t + FLASHER * 2.9) / P, f = (x - Math.floor(x)) * P; return 1.8 * Math.exp(-(((f - 1.5) / 0.09) ** 2)); }
  if (i === 2) return 0.5 + 0.5 * Math.sin(t * 1.3);
  return 0.78 + 0.22 * Math.sin(t * 0.6 + i * 1.7);
}
function buildLights(g) {
  const n = ORB_N + 5 + ORB_N * TRAIL;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), al = new Float32Array(n);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aC', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aS', new THREE.BufferAttribute(size, 1)); geo.setAttribute('aA', new THREE.BufferAttribute(al, 1));
  for (const a of ['position', 'aC', 'aS', 'aA']) geo.attributes[a].setUsage(THREE.DynamicDrawUsage);
  const mat = new THREE.ShaderMaterial({ vertexShader: ORB_V, fragmentShader: ORB_F, uniforms: { ...U, uPx: { value: 1 } }, ...ADD });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 4; g.add(pts);
  // the opening over the triangle at the end: a ring of light widening round a white middle
  const ringM = sm(`uniform float uO; void main() { float r = length(vUv - 0.5) * 2.0; float ring = exp(-pow((r - 0.8) * 9.0, 2.0)); float mid = (1.0 - smoothstep(0.0, 0.8, r)) * uO;
    gl_FragColor = vec4(vec3(1.0, 0.96, 0.9) * (ring * 1.4 + mid * 2.0) * uO * (1.0 - smoothstep(0.95, 1.0, r)), 1.0); }`, { uO: { value: 0 } }, { ...ADD, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringM); ring.frustumCulled = false; ring.renderOrder = 5; ring.visible = false; g.add(ring);
  return { pts, geo, mat, ring, ringM, tri: TRI_V.map((d) => LASER_O.clone().addScaledVector(d, 170)), triC: LASER_O.clone().addScaledVector(TRI_C, 170) };
}

// ---------------------------------------------------------------- the laser
// The beam is a ribbon turned to face the eye; in the mantis's sight its sweep over a few seconds either side is drawn too,
// a fan of green through time.
const BEAM = `
uniform float uW;
void main() {
  float x = (vUv.x - 0.5) * 2.0;
  float a = exp(-x * x * 2.5) * (0.3 + 0.7 * exp(-vUv.y * 2.5));
  gl_FragColor = vec4(vec3(0.2, 1.0, 0.32) * a * uW * (1.0 - 0.7 * fieldFog(cameraPosition, vWorld)), 1.0);
}`;
const SHEET = `
varying float vK;
void main() {
  float a = vK * (0.35 + 0.65 * exp(-vUv.y * 3.0));
  gl_FragColor = vec4(vec3(0.15, 0.9, 0.35) * a * 0.11 * u4D * (1.0 - 0.7 * fieldFog(cameraPosition, vWorld)), 1.0);
}`;
const SHEET_N = 28, BEAM_L = 260;
function buildLaser(g) {
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)); bg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
  bg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(12), 3)); bg.setIndex([0, 2, 1, 1, 2, 3]);
  const beam = new THREE.Mesh(bg, sm(BEAM, { uW: { value: 1 } }, { ...ADD, side: THREE.DoubleSide })); beam.frustumCulled = false; beam.renderOrder = 7; g.add(beam);
  const m = (SHEET_N - 1) * 3, sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m * 3), 3)); sg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(m * 2), 2));
  sg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(m * 3), 3)); sg.setAttribute('aK', new THREE.BufferAttribute(new Float32Array(m), 1));
  const sheetM = sm(SHEET, {}, { ...ADD, side: THREE.DoubleSide }); sheetM.vertexShader = sheetM.vertexShader.replace('void main() {', 'attribute float aK; varying float vK;\nvoid main() { vK = aK;'); 
  const sheet = new THREE.Mesh(sg, sheetM); sheet.frustumCulled = false; sheet.renderOrder = 7; g.add(sheet);
  return { beam, bg, sheet, sg };
}
function drawBeam(Lz, o, d) {
  const p = Lz.bg.attributes.position, cam = E.camera.position, far = _v.copy(o).addScaledVector(d, BEAM_L);
  const side = _v2.subVectors(o, cam).cross(d).normalize();
  // at least about two pixels wide at either end, or a thin ribbon breaks into dashes
  const w0 = Math.max(0.012, o.distanceTo(cam) * 0.004), w1 = Math.max(1.1, far.distanceTo(cam) * 0.004);
  p.setXYZ(0, o.x - side.x * w0, o.y - side.y * w0, o.z - side.z * w0); p.setXYZ(1, o.x + side.x * w0, o.y + side.y * w0, o.z + side.z * w0);
  p.setXYZ(2, far.x - side.x * w1, far.y - side.y * w1, far.z - side.z * w1); p.setXYZ(3, far.x + side.x * w1, far.y + side.y * w1, far.z + side.z * w1);
  p.needsUpdate = true;
}

// ---------------------------------------------------------------- the column of light (the pickup)
const COLUMN = `
void main() {
  float y = vWorld.y;
  float rings = 0.55 + 0.45 * sin(y * 1.7 - uTime * 3.0) * sin(y * 0.43 - uTime * 1.1);
  vec3 v = normalize(cameraPosition - vWorld);
  float f = abs(dot(normalize(vNormal), v));
  float a = pow(f, 2.5) * rings * uPick.w * (0.45 + 0.55 * smoothstep(0.0, 60.0, y)) * smoothstep(-0.2, 0.6, y) * (1.0 - smoothstep(66.0, 80.0, y));
  gl_FragColor = vec4(vec3(0.82, 0.9, 1.0) * a * 0.55, 1.0);
}`;

// ---------------------------------------------------------------- the beings: lines of light, or chrome only half there
// From inside the tall one, the tall one and the two greys with them are drawn as lines of light: a lattice laid through
// every part (rings round it and two slanted sets crossing them, about a pixel wide at any distance, so a fine mesh never
// fills in solid), additive, brightest at the silhouette, a slow shimmer running up them. uThin thins the lines out (a
// travelling noise takes whole stretches away), as if they were barely there. Seen by the man they are a liquid chrome
// that is only half present: a dark mirror of the night with bright fresnel edges, see-through in the middle, and a slow
// noise dissolving patches of it, their edges glowing.
const WIRE = `
uniform vec3 uCol; uniform float uA; uniform float uThin;
// a line wherever x crosses a whole number
float gridLine(float x) { float w = fwidth(x); float d = abs(fract(x - 0.5) - 0.5); return 1.0 - smoothstep(0.3 * w, 1.3 * w, d); }
void main() {
  vec3 v = normalize(cameraPosition - vWorld);
  float f = 1.0 - abs(dot(normalize(vNormal), v));
  // rings every 5.5 cm of the part's own height, and two slanted sets crossing them
  vec3 q = vPos * 18.0;
  float g = max(gridLine(q.y), 0.7 * max(gridLine(q.x + q.z * 0.55), gridLine(q.z - q.x * 0.55)));
  float rim = smoothstep(0.6, 0.97, f);
  float sh = 0.72 + 0.28 * sin(uTime * 2.1 + vWorld.y * 6.0 - vWorld.x * 2.0 + vWorld.z * 1.3);
  float run = fNoise(vec2(vWorld.x * 2.0 + vWorld.z * 1.7, vWorld.y * 3.0 - uTime * 0.6));
  float keep = mix(1.0, smoothstep(0.42, 0.7, run), uThin);
  float near = smoothstep(0.2, 1.0, length(cameraPosition - vWorld));
  float a = (g * (0.3 + 0.7 * f) + rim * 0.3) * sh * keep * uA * near * (1.0 - 0.8 * fieldFog(cameraPosition, vWorld));
  gl_FragColor = vec4(uCol * a + medLight(vWorld) * (g + rim) * 0.6 * near, 1.0);
}`;
const CHROME = `
uniform vec3 uCol; uniform float uA; uniform float uThin;
// the moon, low in the south-west, and its light
const vec3 MOON = vec3(-0.45, 0.42, 0.79);
void main() {
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld);
  if (dot(n, v) < 0.0) n = -n;
  float ndv = clamp(dot(n, v), 0.0, 1.0), fr = pow(1.0 - ndv, 2.2);
  // liquid: the surface barely stirred by slow noise, so the reflections run along the curves and crawl a little
  vec2 q = vWorld.xy * 2.2 + vec2(vWorld.z * 1.7, 0.0);
  n = normalize(n + 0.07 * vec3(fNoise(q + uTime * 0.3) - 0.5, fNoise(q * 1.3 - uTime * 0.25 + 4.0) - 0.5, fNoise(q * 0.8 + 9.0 + uTime * 0.2) - 0.5));
  vec3 r = reflect(-v, n), m = normalize(MOON);
  // a moonlit night mirrored: dark ground, a bright band along the horizon, the sky lightening toward the moon, the moon a hot spot
  float up = r.y, mo = max(dot(r, m), 0.0);
  vec3 env = mix(vec3(0.02, 0.022, 0.026), vec3(0.09, 0.1, 0.12), smoothstep(-0.6, -0.02, up));
  env = mix(env, vec3(0.16, 0.19, 0.27), smoothstep(0.0, 0.7, up));
  env += vec3(0.75, 0.8, 0.9) * exp(-abs(up - 0.03) * 14.0) * 1.1;
  env += vec3(0.55, 0.62, 0.78) * pow(mo, 6.0) * 0.7 + vec3(1.0, 0.98, 0.92) * pow(mo, 90.0) * 7.0;
  env += vec3(1.0, 0.78, 0.5) * pow(max(dot(r, normalize(vec3(0.9, 0.05, -0.2))), 0.0), 60.0) * 0.5;   // the cars' cabin lamps
  env += vec3(0.85, 0.93, 1.0) * uPick.w * 1.2 * smoothstep(0.2, 1.0, up);
  // silver, cool, with the being's own colour only as an undertone; brightest where the surface turns away
  vec3 metal = mix(vec3(0.82, 0.86, 0.94), uCol, 0.14);
  vec3 c = env * metal * (0.8 + 1.6 * fr);
  vec3 ml = medLight(vWorld); c += ml * metal * (0.5 + 1.5 * fr);   // the medallion's light caught on the metal nearby
  // only half there: a slow noise thins patches of it, their edges faintly lit (texture, not the main read)
  float d = fNoise(vWorld.xz * 2.6 + vec2(vWorld.y * 2.0, uTime * 0.1)) * 0.65 + fNoise(vWorld.xy * 8.0 + vec2(-uTime * 0.25, uTime * 0.15)) * 0.35;
  float th = 0.3 + 0.25 * uThin;
  float keep = smoothstep(th, th + 0.12, d + 0.2 * fr);
  float rim = (1.0 - smoothstep(0.0, 0.05, abs(d + 0.2 * fr - th - 0.03))) * 0.35;
  c += mix(vec3(0.75, 0.82, 0.95), uCol, 0.3) * rim * uA;
  float a = uA * (0.3 + 0.62 * fr + 0.25 * pow(mo, 20.0) + 0.35 * min(1.0, ml.r)) * mix(0.45, 1.0, keep) * (1.0 - 0.45 * uThin);
  float fg = fieldFog(cameraPosition, vWorld);
  gl_FragColor = vec4(mix(c, fogTint(vWorld), fg), clamp(a + rim * 0.2 * uA, 0.0, 1.0) * (1.0 - fg * 0.92));
}`;
// two material sets on one body: the lines and the chrome; setForm swaps every mesh between them (the body's own
// standard materials are kept for nothing: it is never drawn solid in this scene)
function formify(obj, col) {
  const u = { uCol: { value: new THREE.Color(...col) }, uA: { value: 1 }, uThin: { value: 0 } };
  const wire = sm(WIRE, u, { ...ADD, side: THREE.DoubleSide });
  const chrome = sm(CHROME, u, { transparent: true, depthWrite: false, side: THREE.DoubleSide });
  obj.traverse((o) => { if (o.isMesh) { o.userData.forms = { wire, chrome }; o.material = wire; o.renderOrder = 6; } });
  return { u, wire, chrome, set(f) { obj.traverse((o) => { if (o.isMesh && o.userData.forms) o.material = o.userData.forms[f]; }); } };
}

// ---------------------------------------------------------------- the scene
export async function field() {
  const g = new THREE.Group(); E.scene.add(g);
  U.uFogTop.value = 0; U.uPick.value.w = 0; U.uMed.value.w = 0;   // shared uniforms keep their values between runs of the scene
  E.scene.background = new THREE.Color(0);
  // lights for the standard materials (people, the mantis, cars): starlight from the whole sky, the cars' cabin lamps, the red
  // torch, the column. All exist from the start (a light added later recompiles every material).
  const hemi = new THREE.HemisphereLight(0x7d8cc0, 0x141210, 0.55); g.add(hemi);
  const lampA = new THREE.PointLight(0xffd9a6, 1.6, 7, 1.6), lampB = new THREE.PointLight(0xffd9a6, 1.6, 7, 1.6);
  const red = new THREE.PointLight(0xff2a14, 0.9, 2.2, 1.6); red.position.set(TABLE.x + 0.2, 0.62, TABLE.z); g.add(red);
  const pickL = new THREE.PointLight(0xdde8ff, 0, 40, 1.2); pickL.position.set(MAN_H.x, 9, MAN_H.z); g.add(pickL);
  const { sky, arcs } = buildSky(g);
  const { lead } = buildGround(g);
  buildFence(g);
  const carA = car(g, CAR_A, 0x5a6670, false, lampA), carB = car(g, CAR_B, 0x7a2e26, true, lampB);
  for (const c of CREW) if (c.cloth) chair(g, c.at.x, c.at.z, c.cloth);
  const blk = blanket(g);
  const tbl = table(g);
  const lights = buildLights(g), laser = buildLaser(g);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.6, 80, 32, 1, true), sm(COLUMN, {}, { ...ADD, side: THREE.DoubleSide }));
  column.position.set(FEET.x, 40, FEET.z); column.frustumCulled = false; column.renderOrder = 7; column.visible = false; g.add(column);

  // ---- people
  const props = [];   // things that only appear once the group has sat down (hidden through the arrival)
  const P = { still: CREW[0].at, L: { drawAt: null }, triDir: TRI_C.clone(), pointAt: null, noPoint: false };
  const crew = CREW.map((c) => person(g, c, P));
  const man = person(g, { k: 'man', col: MAN_COL, sc: 1, ph: 1.1, outfit: MAN_FIT }, P), mu = man.h.userData;
  // lay him on the blanket on his back, head to the north: hips at MAN_H, then down until he rests on it (as on the exam table)
  const layMan = (h) => { h.rotation.set(-PI / 2, 0, 0); h.position.set(MAN_H.x, 0, MAN_H.z + h.userData.hipY); };
  layMan(man.h); man.h.updateMatrixWorld(true);
  const manDrop = 0.03 - new THREE.Box3().setFromObject(man.h).min.y;
  man.h.position.y += manDrop; for (const gh of man.ghosts) { layMan(gh); gh.position.y += manDrop; }
  // a rolled coat under his head
  { man.pose(man.h, 0, P); man.h.updateMatrixWorld(true); const hp = mu.head.getWorldPosition(V(0, 0, 0));
    const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.5, 14), pstd(0x3b3326, { roughness: 1 })); coat.rotation.z = PI / 2; coat.position.set(hp.x, 0.09, hp.z + 0.06); g.add(coat); props.push(coat); window.__coat = [hp.toArray(), coat.position.toArray()]; }
  // where he will be: standing, facing the tall one, there in the mantis's sight before he moves
  const fore = ghostOf(() => makeHuman(1, MAN_COL, { outfit: MAN_FIT }), FUTURE, 0.2); fore.position.copy(FEET); g.add(fore);
  // the laser pen in the laser-holder's right hand (and in each of their ghosts')
  const penM = pstd(0x16181a, { metalness: 0.5, roughness: 0.35 });
  const pen = (h, m) => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.13, 8), m || penM); p.position.set(0, -0.085, 0.01); h.userData.wristR.add(p); return p; };
  const lz = crew[3]; pen(lz.h); for (const gh of lz.ghosts) pen(gh, gh.userData.mat);
  const tip = new THREE.Object3D(); tip.position.set(0, -0.15, 0.01); lz.h.userData.wristR.add(tip);
  // the log-keeper's notebook on their knee and red head torch with its faint cone
  const nk = crew[1].h.userData;
  const torch = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.03, 0.025), new THREE.MeshBasicMaterial({ color: 0xff3018 })); torch.position.set(0, 0.075, 0.1); nk.head.add(torch);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.2, 16, 1, true), sm(`void main() { float a = vUv.y; gl_FragColor = vec4(vec3(1.0, 0.12, 0.05) * 0.05 * a * (1.0 - fieldFog(cameraPosition, vWorld)), 1.0); }`, {}, { ...ADD, side: THREE.DoubleSide }));
  cone.rotation.x = -PI / 2; cone.position.set(0, 0.075, 1.2); cone.renderOrder = 7; nk.head.add(cone);
  { crew[1].h.updateMatrixWorld(true); const kn = nk.kneeL.getWorldPosition(V(0, 0, 0)), hp = nk.legL.getWorldPosition(V(0, 0, 0));
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.014, 0.21), pstd(0x6a2018, { roughness: 0.8 })); book.position.copy(hp.lerp(kn, 0.78)); book.position.y += 0.085; book.rotation.y = crew[1].h.rotation.y; g.add(book); props.push(book); }

  // ---- the mantis: you. A dark red robe; seen from inside, the head is hidden and the eye is where its eyes are.
  const mantis = makeMantis(), mt = mantis.userData;
  mt.robeMat.color.set(0x5c1626); mt.robeMat.emissive.set(0x1c040a); if (mt.robeMat.sheenColor) mt.robeMat.sheenColor.set(0xd08a96);
  // the robe's purple lining (collar and inside the sleeves) dyed a darker red to go with this robe
  mt.setFold(0.62); g.add(mantis);
  // ---- the medallion: its disc and pupil moved into their own pivot so it can come off the chest on its chain; the chain
  // itself is drawn again as two strands of beads from the collar to the disc while it is off the robe
  const med = { parts: new THREE.Group(), g: new THREE.Group(), C: V(0, 0, 0), anc: [V(0, 0, 0), V(0, 0, 0)], lift: 0, held: 0, glow: 0, found: '' };
  {
    mt.root.add(med.parts); med.parts.add(med.g);
    const box = new THREE.Box3(), cen = V(0, 0, 0), sz = V(0, 0, 0); let disc = null, mark = null, chain = null;
    for (const m of mt.root.children) {
      if (!m.isMesh) continue; m.geometry.computeBoundingBox(); box.copy(m.geometry.boundingBox); box.getSize(sz); box.getCenter(cen);
      if (Math.abs(cen.y - 1.5) < 0.03 && sz.x > 0.1 && sz.x < 0.16 && sz.y > 0.1 && sz.y < 0.16) disc = m;
      else if (Math.abs(cen.y - 1.494) < 0.02 && sz.x < 0.02) mark = m;
      else if (cen.y > 1.6 && cen.y < 1.8 && sz.y > 0.2 && sz.y < 0.32 && sz.x > 0.12) chain = m;
    }
    med.found = [disc, mark, chain].map((x) => (x ? 1 : 0)).join('');
    disc.geometry.boundingBox.getCenter(med.C); med.g.position.copy(med.C);
    for (const m of [disc, mark]) if (m) { mt.root.remove(m); med.g.add(m); m.position.copy(med.C).negate(); }
    med.chain = chain;
    const pa = chain.geometry.attributes.position, n = [0, 0];
    for (let i = 0; i < pa.count; i++) if (pa.getY(i) > 1.795) { const k = pa.getX(i) < 0 ? 0 : 1; med.anc[k].x += pa.getX(i); med.anc[k].y += pa.getY(i); med.anc[k].z += pa.getZ(i); n[k]++; }
    med.anc.forEach((a, k) => a.multiplyScalar(1 / Math.max(1, n[k])));
    med.beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0064, 6, 4), chain.material, 28); med.beads.frustumCulled = false; med.beads.visible = false; med.parts.add(med.beads);
  }
  const mForm = formify(mantis, [0.95, 0.3, 0.42]);
  const medForm = formify(med.parts, [1.0, 0.78, 0.4]); medForm.u.uA.value = 1.5;
  // the medallion's light while it acts: a soft glow drawn facing the eye
  const glowM = sm(`uniform float uG; void main() { float r = length(vUv - 0.5) * 2.0; float a = (exp(-r * r * 7.0) * 0.8 + 0.25 * exp(-r * r * 1.6) + 0.9 * exp(-r * r * 70.0)) * (1.0 - smoothstep(0.85, 1.0, r));
    gl_FragColor = vec4(vec3(1.0, 0.86, 0.58) * a * uG * (1.0 - 0.7 * fieldFog(cameraPosition, vWorld)), 1.0); }`, { uG: { value: 0 } }, { ...ADD, side: THREE.DoubleSide });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), glowM); glow.frustumCulled = false; glow.renderOrder = 9; glow.visible = false; g.add(glow);
  // two greys with them, standing a little behind on either side: the backup
  const greys = [-1, 1].map((side) => { const gr = makeGrey(true); g.add(gr); const f = formify(gr, [0.42, 0.78, 1.0]); const u = gr.userData; u.armL.rotation.z = -0.12; u.armR.rotation.z = 0.12; return { g: gr, f, side, ph: side * 1.3, pos: V(0, 0, 0), yaw: 0 }; });
  const forms = [mForm, medForm, ...greys.map((x) => x.f)];
  const setForms = (f) => { for (const x of forms) x.set(f); };
  const S = {
    t: 0, view: 'mantis', walk: false, auto: false, ph: 0, amt: 0, side: 1, bodyYaw: 0, walkYaw: 0, mp: V(START.x, 0, START.z),
    tip: 15.6, tipTo: null, triOn: null, triMove: null, open: 0, tilt: 0, lift: 0, pick: 0, switches: 0, busy: false,
    look: { mantis: { yaw: 0, pitch: -0.05 }, man: null }, fogTo: null, fogLead: 0.8, fogW: 0.25, thin: 0, final: false, cut: false, d: 99, lifting: false, over: 0, raised: false, splitAt: null, sp0: V(0, 0, 0), cNow: V(0, 0, 0), cOver: V(FEET.x, 62, FEET.z), ct: 0, warpK: 0,
  };
  const goalDist = () => Math.hypot(S.mp.x - FEET.x, S.mp.z - FEET.z);
  // where the tall one may stand: in the field, not among the chairs, not on top of him
  const okAt = (x, z) => x > -12 && x < 10.2 && z > -8 && z < 20.4 && Math.hypot(x - FEET.x, z - FEET.z) > 3.0 && Math.hypot(x - CAMP.x, z - CAMP.z) > 3.6
    && Math.hypot(x - CREW[3].at.x, z - CREW[3].at.z) > 1.6;
  const manEye = V(0, 0, 0);
  const eyeOf = (out) => { man.h.updateMatrixWorld(true); return mu.head.localToWorld(out.set(0, 0.03, 0.13)); };

  // ---- sound
  const night = A.fieldNight ? A.fieldNight() : null;
  const tones = A.cropTones ? A.cropTones() : null;
  const breath = A.mantisBreath ? A.mantisBreath() : null;
  const press = A.lightsPressure ? A.lightsPressure() : null;
  // a loop's level is only sent when it has moved (an automation event every frame would pile up for minutes)
  const level = (h) => { let last = []; return (...a) => { if (h && a.some((x, i) => !(Math.abs(x - last[i]) < 0.02))) { last = a; h.set(...a); } }; };
  const setTones = level(tones), setPress = level(press), setBreath = level(breath), setNight = level(night);
  let hum = null;

  // ---- one view or the other: where the eye is, how much of time it sees, what of each body is drawn
  function applyView(v) {
    const L = S.look[S.view] = { yaw: E.yaw, pitch: E.pitch };
    S.view = v;
    const mine = v === 'mantis';
    U.u4D.value = mine ? 1 : 0;
    setForms(mine && !S.final ? 'wire' : 'chrome');
    mt.neck.visible = !mine; mu.head.visible = mine; mu.neck.visible = mine || !S.lifting;   // lying, his neck fills the collar; upright it would be in the way
    E.limits = null; E.roll = 0;
    if (mine) {
      const l = S.look.mantis; E.yaw = l.yaw; E.pitch = l.pitch; E.base.yaw = l.yaw; E.base.pitch = 0;
    } else {
      eyeOf(manEye); E.camera.position.copy(manEye);
      const south = Math.atan2(-(0), -(1));   // looking toward +z (his feet, the hedge, the tall one)
      if (!S.lifting) {
        E.base.yaw = south; E.base.pitch = 0.88; E.limits = { yaw: 0.6, up: 0.6, down: 0.55 };   // he cannot move: only his eyes
        const l = S.look.man || { yaw: south + 0.15, pitch: 1.2 }; E.yaw = l.yaw; E.pitch = l.pitch;
      }
    }
    void L;
  }
  async function doSwitch(v, before) {
    if (S.busy || S.view === v) return;
    S.busy = true; E.canAct = false; hint('');
    if (A.fieldSwitch) A.fieldSwitch(v === 'man');
    await fade(1, 0.14, '#000');
    applyView(v); if (before) before();
    window.__fieldCut = (window.__fieldCut || 0) + 1;
    await fade(0, 0.42, '#000');
    S.switches++; S.busy = false;
  }

  // ---- the arrival (before the tall one's eyes open): the group walking in from the cars with what they brought, seen
  // from where the tall one stands in the dark at the hedge, unseen. The same five people, standing (the seated ones are
  // built seated, so these are their walking doubles); a cut to the circle once they have sat down.
  const walkers = [], wTorch = new THREE.PointLight(0xfff0dc, 0, 9, 1.6); g.add(wTorch);
  {
    const via = (from, to) => [from, V(11.0, 0, Math.min(1.6, Math.max(-1.0, from.z * 0.25 + 0.3))), V(3.2, 0, 0.3 + (to.z - 0.3) * 0.25), to];
    const spec = [
      { c: CREW[0], to: V(-1.25, 0, -0.3), from: V(11.7, 0, -3.1), t0: 0.3, v: 1.3, carry: 'torch' },
      { c: CREW[1], to: V(0.3, 0, -1.35), from: V(11.9, 0, -2.6), t0: 1.4, v: 1.25, carry: 'phone' },
      { c: CREW[2], to: V(1.45, 0, -0.25), from: V(12.4, 0, 5.7), t0: 0.8, v: 1.35, carry: 'flask' },
      { c: CREW[3], to: V(-1.65, 0, 1.8), from: V(12.0, 0, 5.9), t0: 0.5, v: 1.45, carry: 'laser' },
      { c: { col: MAN_COL, sc: 1, outfit: MAN_FIT }, to: V(0.62, 0, 2.75), from: V(11.9, 0, 5.3), t0: 0.0, v: 1.3, carry: 'blanket' },
    ];
    for (const s of spec) {
      const h = makeHuman(s.c.sc || 1, s.c.col, { outfit: s.c.outfit }), u = h.userData; fogify(h, { warmth: 0.45 }); g.add(h); h.visible = false;
      const pts = via(s.from, s.to), segs = []; let L = 0; for (let i = 1; i < pts.length; i++) { const d = pts[i].distanceTo(pts[i - 1]); segs.push([pts[i - 1], pts[i], L, d]); L += d; }
      const w = { h, u, s, segs, L, ph: Math.random() * TAU, amt: 0, yaw: Math.atan2(pts[1].x - pts[0].x, pts[1].z - pts[0].z), done: false };
      // what they carry
      if (s.carry === 'torch') { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.02, 0.16, 12), pstd(0x2a2c30, { metalness: 0.5, roughness: 0.4 })); t.position.set(0, -0.1, 0.035); u.wristR.add(t);
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.019, 14), new THREE.MeshBasicMaterial({ color: 0xfff3e0 })); lens.rotation.x = PI / 2; lens.position.set(0, -0.181, 0.035); u.wristR.add(lens);
        const beam = new THREE.Mesh(new THREE.ConeGeometry(0.75, 5, 18, 1, true), sm(`void main() { float a = 1.0 - vUv.y; gl_FragColor = vec4(vec3(1.0, 0.94, 0.82) * 0.06 * (1.0 - a) * (1.0 - fieldFog(cameraPosition, vWorld)), 1.0); }`, {}, { ...ADD, side: THREE.DoubleSide }));
        beam.position.set(0, -0.19 - 2.5, 0.035); beam.renderOrder = 7; u.wristR.add(beam); w.lamp = lens; w.beam = beam; }
      if (s.carry === 'phone') { const ph = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.155, 0.009), pstd(0x111214, { roughness: 0.3 })); ph.position.set(-0.012, -0.11, 0.035); ph.rotation.set(0.2, 0, 0); u.wristR.add(ph);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.14), new THREE.MeshBasicMaterial({ color: 0x5a86b0 })); scr.position.set(-0.012, -0.11, 0.0405); scr.rotation.set(0.2, 0, 0); u.wristR.add(scr); w.screen = scr;
        const torch = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.03, 0.025), new THREE.MeshBasicMaterial({ color: 0xff3018 })); torch.position.set(0, 0.075, 0.1); u.head.add(torch); w.headTorch = torch; }
      if (s.carry === 'flask') { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.27, 16), pstd(0x24402f, { metalness: 0.35, roughness: 0.45 })); f.position.set(0, -0.13, 0.02); u.wristL.add(f); }
      if (s.carry === 'laser') { pen(h); w.tip = new THREE.Object3D(); w.tip.position.set(0, -0.15, 0.01); u.wristR.add(w.tip); }
      if (s.carry === 'blanket') { const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.56, 16), blk.material); roll.rotation.z = PI / 2 - 0.25; roll.position.set(0.16, 1.22, 0.08); u.chest.add(roll); w.roll = roll; }
      walkers.push(w);
    }
  }
  const _wq = V(0, 0, 0);
  // a person walking: legs swinging from the hip with the passing knee bent, arms countering, the body rising over each step
  function walkPose(w, dt) {
    const u = w.u, s = Math.sin(w.ph), c = Math.cos(w.ph), a = w.amt;
    u.legL.rotation.x = -0.38 * s * a; u.legR.rotation.x = 0.38 * s * a;
    u.kneeL.rotation.x = (0.05 + 0.75 * Math.max(0, c) ** 1.5) * a; u.kneeR.rotation.x = (0.05 + 0.75 * Math.max(0, -c) ** 1.5) * a;
    u.armL.rotation.set(0.28 * s * a, 0, -0.06); u.armR.rotation.set(-0.28 * s * a, 0, 0.06);
    u.foreL.rotation.x = -0.12 - 0.15 * Math.max(0, -s) * a; u.foreR.rotation.x = -0.12 - 0.15 * Math.max(0, s) * a;
    u.body.position.y = -0.012 * a * (1 - Math.abs(c)); u.body.rotation.y = 0.05 * s * a;
    breathe(u, w.ph * 0.4);
  }
  function cutFrame(dt, c) {
    if (S.cutDone) return;
    for (const w of walkers) {
      const s = w.s, d = Math.max(0, (c - s.t0) * s.v);
      w.h.visible = c > s.t0 - 0.05;
      let p = null, hd = w.yaw;
      if (d >= w.L) { p = w.segs[w.segs.length - 1][1]; w.done = true; hd = s.carry === 'laser' ? w.yaw : Math.atan2(CAMP.x - p.x, CAMP.z - p.z); }
      else for (const [a, b, L0, len] of w.segs) if (d < L0 + len) { p = _wq.copy(a).lerp(b, (d - L0) / len); hd = Math.atan2(b.x - a.x, b.z - a.z); break; }
      const moving = c > s.t0 && d < w.L;
      w.amt += ((moving ? 1 : 0) - w.amt) * Math.min(1, dt * 4);
      w.ph += dt * s.v / 0.66 * PI * (moving ? 1 : w.amt);
      { const dy = wrap(hd - w.yaw) * Math.min(1, dt * 3), cap = 2.2 * dt; w.yaw += clamp(dy, -cap, cap); }   // a person turns at most about 2 rad a second
      w.h.position.set(p.x, 0, p.z); w.h.rotation.y = w.yaw;
      walkPose(w, dt);
      const u = w.u;
      if (s.carry === 'torch') {   // the beam swung a little ahead on the path, switched off once there
        u.armR.rotation.set(-0.75 + 0.05 * Math.sin(w.ph), 0, 0.1); u.foreR.rotation.x = -0.25;
        const on = c < s.t0 + w.L / s.v + 2.5 ? 1 : 0; w.lamp.visible = !!on; w.beam.visible = !!on;
        u.wristR.updateMatrixWorld(true); w.lamp.getWorldPosition(wTorch.position); wTorch.intensity = on * 2.2;
      }
      if (s.carry === 'phone') {
        u.head.updateMatrixWorld(true); w.headTorch.getWorldPosition(red.position); red.intensity = 0.5; red.distance = 1.1;   // a head torch lights what is ahead of it, not the faces round it
        const k = w.done ? sm01(0, 1.2, c - (s.t0 + w.L / s.v)) : 0;   // there: the phone held up, the app started
        u.armR.rotation.set(-0.15 - 0.85 * k, 0, 0.12 * (1 - k)); u.foreR.rotation.x = -0.15 - 1.1 * k;
        w.screen.material.color.setRGB(0.18 + 0.2 * k, 0.3 + 0.28 * k, 0.42 + 0.3 * k); S.cutTones = k;
      }
      if (s.carry === 'blanket') {   // there: the roll put down and spread out toward the north
        const k = w.done ? sm01(0.4, 2.6, c - (s.t0 + w.L / s.v)) : 0;
        w.roll.visible = k < 0.05; blk.visible = k > 0.03;
        blk.scale.set(1, 1, Math.max(0.04, k)); blk.position.z = MAN_H.z - 0.15 + 1.075 * (1 - Math.max(0.04, k));
        u.armR.rotation.set(-0.1 - 0.9 * Math.sin(PI * k), 0, 0.2 * (1 - k)); u.foreR.rotation.x = -0.2 - 0.5 * Math.sin(PI * k);
        if (w.done) { u.body.rotation.x = 0.55 * Math.sin(PI * k); }
      }
      if (s.carry === 'laser') {   // there: the laser tried on the sky, a slow sweep
        const k = w.done ? sm01(0.3, 1.0, c - (s.t0 + w.L / s.v)) : 0;
        if (k > 0) { laserDir(P.L, c * 0.7, _v2); const ty = Math.atan2(_v2.x, _v2.z) * 0.55 + 0.15; w.yaw += clamp(wrap(ty - w.yaw) * Math.min(1, dt * 3), -2.2 * dt, 2.2 * dt); w.h.rotation.y = w.yaw; w.h.updateMatrixWorld(true); armToward(w.h, u.armR, _v2, k, u.restR || (u.restR = u.armR.quaternion.clone())); u.foreR.rotation.set(0, 0, 0); neckToward(w.h, _v2, 0.8 * k); }
        laser.beam.visible = k > 0.5;
        if (k > 0.5) { w.h.updateMatrixWorld(true); w.tip.getWorldPosition(o); drawBeam(laser, o, dir.copy(_v2)); }
      }
    }
    // the eye follows them in, slowly, closing in on the circle as they gather; starlight a little brighter for the look
    E.camera.fov = 40 - 12 * sm01(8, 20, c); E.camera.updateProjectionMatrix(); hemi.intensity = 0.95;
    if (window.__cutLog) window.__cutLog(c, walkers);
    let cx = 0, cz = 0, n = 0; for (const w of walkers) if (w.h.visible) { cx += w.h.position.x; cz += w.h.position.z; n++; }
    if (n) { const a = aimAt(_wq.set(cx / n, 0.9, cz / n)); S.cutYaw = (S.cutYaw == null ? E.yaw : S.cutYaw) + wrap(a.yaw - (S.cutYaw == null ? E.yaw : S.cutYaw)) * Math.min(1, dt * 0.5); E.yaw = S.cutYaw; E.pitch = a.pitch + 0.02; }
  }

  // ---- the 4D fold: the whole view turned through a fourth direction and back (one full-screen pass, only while it runs)
  const WARP_F = `
  varying vec2 vUv; uniform sampler2D tScene; uniform float uK; uniform float uT; uniform vec2 uRes;
  uniform vec4 uEd[32]; uniform float uEw[32];
  float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h); }
  vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
  vec3 tap(vec2 p, float asp) { vec2 uv = p / vec2(asp, 1.0) + 0.5; uv = 1.0 - abs(1.0 - abs(uv)); return texture2D(tScene, uv).rgb; }
  void main() {
    float asp = uRes.x / uRes.y, k = uK;
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    // lift each point of the view into four dimensions (w from how far out it is), turn it in the x-w and y-z planes,
    // and project it back: the middle swells toward you and the edges fold in, as a tesseract turning inside out
    float a = k * 1.25 * (0.8 + 0.2 * sin(uT * 1.7));
    vec4 q = vec4(p, 0.0, 0.9 * dot(p, p) - 0.3);
    q.xw = rot(q.xw, a); q.yz = rot(q.yz, a * 0.5);
    vec2 pw = q.xy / (1.0 + 0.55 * q.w * k + 0.25 * q.z * k);
    // space folded over on itself along two slowly turning planes
    vec2 f = rot(pw, uT * 0.4);
    f = mix(f, abs(f) - 0.18 * k, 0.55 * k * smoothstep(0.0, 0.3, length(f)));
    pw = mix(pw, rot(f, -uT * 0.4), 0.7 * k);
    // the moment before and the moment after sliding through it, amber one way, blue the other
    vec2 sl = rot(vec2(0.07, 0.03), uT * 0.8) * k;
    vec3 now = tap(pw, asp), past = tap(pw + sl, asp), next = tap(pw - sl * 1.2, asp);
    vec3 c = now * (1.0 - 0.45 * k) + past * vec3(1.0, 0.62, 0.3) * 0.45 * k + next * vec3(0.45, 0.7, 1.0) * 0.45 * k;
    // the edges of the turning cube: two squares and the lines between their corners, faint
    vec2 e = rot(pw, a * 0.8); float s1 = 0.42, s2 = 0.42 * (0.45 + 0.2 * cos(a * 2.0));
    float d1 = abs(max(abs(e.x), abs(e.y)) - s1), d2 = abs(max(abs(e.x), abs(e.y)) - s2);
    vec2 ae = abs(e); float d3 = (ae.x > s2 && ae.x < s1 && ae.y > s2 && ae.y < s1) ? abs(ae.x - ae.y) * 0.7071 : 1.0;
    float ln = exp(-min(min(d1, d2), d3) * uRes.y * 0.35);
    c += vec3(0.65, 0.8, 1.0) * ln * 0.12 * k * k;
    float inner = step(max(abs(e.x), abs(e.y)), s2);
    c = mix(c, tap(rot(e, -a * 0.8) / max(s2, 0.05) * 0.5, asp) * vec3(0.8, 0.9, 1.1), inner * 0.38 * k);
    vec3 wire = vec3(0.0); float px = 1.0 / uRes.y;
    for (int i = 0; i < 32; i++) {
      float d = seg(p, uEd[i].xy, uEd[i].zw), w = uEw[i];
      vec3 col = mix(vec3(1.0, 0.66, 0.32), vec3(0.45, 0.75, 1.0), smoothstep(-0.6, 0.6, w));
      wire += col * (exp(-d / (1.3 * px)) * 0.9 + exp(-d * 28.0) * 0.07) * (0.55 + 0.45 * smoothstep(-1.0, 1.0, w + 0.4));
    }
    c += wire * k * smoothstep(0.0, 0.35, k);
    gl_FragColor = vec4(c, 1.0);
  }`;
  let warpU = null, warpPass = null;
  // the hypercube: 16 corners at +-1 in x y z w, 32 edges between corners one bit apart; turned in the x-w, y-z and z-w
  // planes, projected 4D to 3D (from w) and 3D to the screen (from z), in the shader's screen units (height 1)
  const TV = [], TE = []; for (let i = 0; i < 16; i++) TV.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
  for (let i = 0; i < 16; i++) for (let b = 0; b < 4; b++) { const j = i ^ (1 << b); if (j > i) TE.push([i, j]); }
  const TP = TV.map(() => [0, 0, 0]);
  function tesseract(u, T, k) {
    const a1 = T * 0.55 + k * 1.1, a2 = T * 0.31, a3 = T * 0.19 + 0.4, c1 = Math.cos(a1), s1 = Math.sin(a1), c2 = Math.cos(a2), s2 = Math.sin(a2), c3 = Math.cos(a3), s3 = Math.sin(a3);
    const sc = 0.62 + 0.22 * k;
    for (let i = 0; i < 16; i++) {
      let [x, y, z, w] = TV[i];
      [x, w] = [c1 * x - s1 * w, s1 * x + c1 * w];
      [y, z] = [c2 * y - s2 * z, s2 * y + c2 * z];
      [z, w] = [c3 * z - s3 * w, s3 * z + c3 * w];
      const fw = 2.2 / (3.2 - w), X = x * fw, Y = y * fw, Z = z * fw, fz = 2.0 / (4.2 - Z);
      TP[i][0] = X * fz * sc * 0.5; TP[i][1] = Y * fz * sc * 0.5; TP[i][2] = w;
    }
    for (let e = 0; e < 32; e++) { const [i, j] = TE[e]; u.uEd.value[e].set(TP[i][0], TP[i][1], TP[j][0], TP[j][1]); u.uEw.value[e] = (TP[i][2] + TP[j][2]) / 2; }
  }
  function warpBuild() {
    const r = E.renderer, size = new THREE.Vector2(); r.getDrawingBufferSize(size);
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { colorSpace: THREE.SRGBColorSpace, samples: 2 });
    const u = { tScene: { value: rt.texture }, uK: { value: 0 }, uT: { value: 0 }, uRes: { value: size.clone() }, uEd: { value: TE.map(() => new THREE.Vector4()) }, uEw: { value: TE.map(() => 0) } };
    warpU = u;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const mat = new THREE.ShaderMaterial({ vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: WARP_F, uniforms: warpU, depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(geo, mat); quad.frustumCulled = false; const sc = new THREE.Scene(); sc.add(quad); const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const draw = () => { r.getDrawingBufferSize(size); if (size.x !== rt.width || size.y !== rt.height) { rt.setSize(size.x, size.y); u.uRes.value.copy(size); } r.setRenderTarget(rt); r.render(E.scene, E.camera); r.setRenderTarget(null); r.render(sc, cam); };
    draw.dispose = () => { rt.dispose(); geo.dispose(); mat.dispose(); };
    r.compile(sc, cam);   // the fold's shader compiled now, not on its first frame
    // every scene material drawn into this target needs its own program (linear output): compile those ahead too
    r.setRenderTarget(rt); r.compile(E.scene, E.camera); r.setRenderTarget(null);
    warpU = null;
    return { draw, u };
  }
  function warpOn() { if (!warpPass) warpPass = warpBuild(); warpU = warpPass.u; E.draw = warpPass.draw; }
  function warpOff() { if (E.draw === (warpPass && warpPass.draw)) E.draw = null; warpU = null; S.warpK = 0; E.camera.fov = 70; E.camera.updateProjectionMatrix(); }

  // ---- every frame
  const tmp = V(0, 0, 0), o = V(0, 0, 0), dir = V(0, 0, 0), fa = V(0, 0, 0), fb = V(0, 0, 0), buf = new THREE.Vector2();
  const posA = lights.geo.attributes.position, colA = lights.geo.attributes.aC, sizA = lights.geo.attributes.aS, alA = lights.geo.attributes.aA;
  let stepPh = 0;
  on((dt, t) => {
    // the arrival runs on its own clock; the night's own clock (the lights, the fog's creep) starts when the eyes open
    if (S.cut) {
      S.ct += dt; U.uTime.value = 100 + S.ct; cutFrame(dt, S.ct);
      U.uFogA.value.set(0, 90, 0.55, 0.25);   // no bank yet: the fog comes later
      if (S.cutDone) {   // the circle: everyone breathing on their own clocks, the laser at work
        for (const p of [...crew, man]) { p.clock += dt; p.pose(p.h, p.clock, P); }
        lz.h.updateMatrixWorld(true); tip.getWorldPosition(o); laserDir(P.L, lz.clock, dir); drawBeam(laser, o, dir); laser.beam.visible = true;
      }
      setTones(0.9 * (S.cutTones || 0) * Math.min(1, 1.6 / (1 + E.camera.position.distanceTo(tbl.speaker) * 0.45)), 0); setPress(0.12); setBreath(0.3); setNight(1, 0);
      if (window.__fieldLog) window.__fieldLog(S, { crew, man, lz, P, walkers });
      return;
    }
    S.t += dt; const T = S.t;
    U.uTime.value = T;
    if (warpU) { warpU.uK.value = S.warpK; warpU.uT.value = T; tesseract(warpU, T, S.warpK); E.camera.fov = 70 + 14 * S.warpK; E.camera.updateProjectionMatrix(); }
    const sz = E.renderer.getDrawingBufferSize(buf); U.uRes.value = sz.y / (2 * Math.tan(THREE.MathUtils.degToRad(E.camera.fov) / 2));
    lights.mat.uniforms.uPx.value = sz.y / 720;

    // the tall one walking (its own slow gait: long strides, a sway from side to side)
    let moved = 0;
    if (S.view === 'mantis' && S.walk && !S.busy) {
      let f = (E.keys.KeyW ? 1 : 0) - (E.keys.KeyS ? 1 : 0), s = (E.keys.KeyD ? 1 : 0) - (E.keys.KeyA ? 1 : 0), dx = 0, dz = 0;
      if (S.auto && !f && !s) { const ax = FEET.x - S.mp.x, az = FEET.z - S.mp.z, l = Math.hypot(ax, az); if (l > 3.3) { dx = ax / l; dz = az / l; } }
      else if (f || s) { const l = Math.hypot(f, s); dx = (-Math.sin(E.yaw) * f + Math.cos(E.yaw) * s) / l; dz = (-Math.cos(E.yaw) * f - Math.sin(E.yaw) * s) / l; }
      if (dx || dz) {
        // the heading the party walks on: follows the way the tall one actually goes, never the way the eyes turn
        // (stepping backwards leaves it where it is, so the greys do not swing round to the front)
        const wy = Math.atan2(-dx, -dz), dw = wrap(wy - S.walkYaw);
        if (Math.abs(dw) < 2.0) S.walkYaw += dw * Math.min(1, dt * 1.1);
        const sp = 0.95 * dt, nx = S.mp.x + dx * sp, nz = S.mp.z + dz * sp;
        if (okAt(nx, S.mp.z)) { S.mp.x = nx; moved += Math.abs(dx * sp); }
        if (okAt(S.mp.x, nz)) { S.mp.z = nz; moved += Math.abs(dz * sp); }
      }
    }
    S.amt += ((moved > 0 ? 1 : 0) - S.amt) * Math.min(1, dt * (moved > 0 ? 3 : 2));
    const ph0 = Math.floor(stepPh / PI); stepPh += moved / 1.5 * PI;
    if (Math.floor(stepPh / PI) !== ph0) { S.side = -S.side; if (A.fieldStep) A.fieldStep(0.6 + 0.4 * S.amt, S.side); }
    if (S.view === 'mantis') S.bodyYaw += wrap(E.yaw - S.bodyYaw) * Math.min(1, dt * (moved > 0 ? 3 : 1.4));
    mantis.position.set(S.mp.x, 0, S.mp.z); mantis.rotation.y = S.bodyYaw + PI;
    idleMantis(mantis, dt, T);
    mt.root.rotation.z += Math.sin(stepPh) * 0.025 * S.amt;
    // the greys keep their places beside and a little behind the tall one, walking when it walks (their own short steps)
    { const fx = -Math.sin(S.walkYaw), fz = -Math.cos(S.walkYaw), rx = Math.cos(S.walkYaw), rz = -Math.sin(S.walkYaw);
      for (const gy of greys) {
        const tx = S.mp.x + rx * gy.side * 1.6 - fx * 0.8, tz = S.mp.z + rz * gy.side * 1.6 - fz * 0.8, k = Math.min(1, dt * 2.2);
        if (!gy.placed) { gy.pos.set(tx, 0, tz); gy.yaw = S.walkYaw; gy.placed = true; }
        const ox = gy.pos.x, oz = gy.pos.z; gy.pos.x += (tx - gy.pos.x) * k; gy.pos.z += (tz - gy.pos.z) * k;
        const sp = Math.hypot(gy.pos.x - ox, gy.pos.z - oz) / Math.max(dt, 1e-4);
        gy.amt = (gy.amt || 0) + ((sp > 0.15 ? 1 : 0) - (gy.amt || 0)) * Math.min(1, dt * 3);
        gy.ph += dt * GREY_GAIT * gy.amt; gy.yaw += wrap(S.walkYaw - gy.yaw) * Math.min(1, dt * 1.5);
        gy.g.position.copy(gy.pos); gy.g.rotation.y = gy.yaw + PI;
        stepGrey(gy.g, gy.ph, gy.amt); idleGrey(gy.g, T + gy.side);
        aimGrey(gy.g, _v.set(FEET.x, 0.5 + S.lift, FEET.z), 0.5 * sm01(14, 7, S.d) + 0.4 * sm01(0, 1, S.tilt));
      } }
    if (S.view === 'mantis') {
      const bob = S.amt * (Math.abs(Math.sin(stepPh)) - 0.62) * 0.07;
      E.camera.position.set(S.mp.x - Math.sin(S.bodyYaw) * 0.07, EYE + bob, S.mp.z - Math.cos(S.bodyYaw) * 0.07);
      E.roll = Math.sin(stepPh) * 0.03 * S.amt;
    }
    S.d = goalDist();

    // everyone's own time: running, or stopped (switched off) as the tall one comes
    for (const p of crew) {
      if (p.offAt != null) p.rate = Math.max(0, 1 - (T - p.offAt) / 1.4);
      p.clock += dt * p.rate;
    }
    man.clock += dt;
    // the tones on the speaker carry on; the pressure of the lights is felt more in his body, near the ground
    P.noPoint = S.view === 'man';
    for (const p of [...crew, man]) {
      p.pose(p.h, p.clock, P);
      for (const gh of p.ghosts) {
        if (p !== man) { gh.position.copy(p.h.position); }
        p.pose(gh, p.clock + gh.userData.k * GHOST_DT * p.rate * (1 + 3 * (S.warpK || 0)), { ...P, noPoint: false });
        gh.visible = U.u4D.value > 0.01;
      }
    }
    // the man rising: tipped up onto his feet as if lifted by the head, then up the column
    if (S.tilt > 0 || S.lift > 0) {
      // upright he faces the tall one; going up he turns slowly round to face the camp below
      const k = sm01(0, 1, S.tilt), f0 = Math.atan2(S.mp.x - FEET.x, S.mp.z - FEET.z), f1 = Math.atan2(CAMP.x - FEET.x, CAMP.z - FEET.z);
      const face = f0 + wrap(f1 - f0) * (S.turn || 0);
      man.h.rotation.set(-PI / 2 * (1 - k), face * k, 0, 'YXZ');
      man.h.position.set(FEET.x, manDrop * (1 - k) + S.lift, FEET.z);
      for (const gh of man.ghosts) gh.visible = false;
    }
    fore.rotation.y = Math.atan2(S.mp.x - FEET.x, S.mp.z - FEET.z);
    fore.position.y = S.lift;
    fore.userData.mat.uniforms.uA.value = S.tilt > 0 ? 0.6 * (1 - sm01(0.6, 1, S.tilt)) : 0.1 + 0.16 * sm01(12, 3.5, S.d);
    fore.visible = U.u4D.value > 0.01;

    // the laser: the beam from the pen; in the mantis's sight its sweep through a few seconds of their time
    lz.h.updateMatrixWorld(true); tip.getWorldPosition(o); laserDir(P.L, lz.clock, dir);
    drawBeam(laser, o, dir);
    { const sp = laser.sg.attributes.position, su = laser.sg.attributes.uv, sk = laser.sg.attributes.aK, span = 2.2 * lz.rate; let vi = 0;
      for (let j = 0; j < SHEET_N - 1; j++) {
        const t0 = lz.clock + (j / (SHEET_N - 1) * 2 - 1) * span, t1 = lz.clock + ((j + 1) / (SHEET_N - 1) * 2 - 1) * span;
        const f0 = fa.copy(o).addScaledVector(laserDir(P.L, t0, _v), BEAM_L), f1 = fb.copy(o).addScaledVector(laserDir(P.L, t1, _v), BEAM_L);
        const k0 = 1 - Math.abs(j / (SHEET_N - 1) * 2 - 1), k1 = 1 - Math.abs((j + 1) / (SHEET_N - 1) * 2 - 1);
        for (const [pp, uy, kk] of [[o, 0, (k0 + k1) / 2], [f0, 1, k0], [f1, 1, k1]]) { sp.setXYZ(vi, pp.x, pp.y, pp.z); su.setXY(vi, 0.5, uy); sk.setX(vi, kk * kk); vi++; }
      }
      sp.needsUpdate = su.needsUpdate = sk.needsUpdate = true; laser.sheet.visible = U.u4D.value > 0.01 && lz.rate > 0.02; }

    // the lights overhead and, in the mantis's sight, their paths
    let vi = 0, sky = 0;
    const put = (p, c, s, a) => { posA.setXYZ(vi, p.x, p.y, p.z); colA.setXYZ(vi, c[0], c[1], c[2]); sizA.setX(vi, s); alA.setX(vi, a); vi++; };
    for (let i = 0; i < ORB_N; i++) { const pu = orbPulse(i, T); sky += pu; put(orbAt(i, T, tmp), ORB_COLS[i], 30 + 14 * Math.min(1, pu), 0.35 + 0.65 * pu); }
    // the amber one splitting: into two, then three
    { const p0 = orbAt(0, T, S.sp0), k1 = S.splitAt == null ? 0 : sm01(S.splitAt, S.splitAt + 1.6, T), k2 = S.splitAt == null ? 0 : sm01(S.splitAt + 3, S.splitAt + 4.6, T), pu = orbPulse(0, T);
      put(_v.copy(p0).add(_v2.set(13, 4, -3).multiplyScalar(k1)), ORB_COLS[0], 30 * Math.max(0.3, k1), k1 * (0.35 + 0.65 * pu));
      put(_v.copy(p0).add(_v2.set(-7, 11, 5).multiplyScalar(k2)), ORB_COLS[0], 30 * Math.max(0.3, k2), k2 * (0.35 + 0.65 * pu)); }
    // the triangle: three lights coming on one by one where the laser drew; holding; moving as one; at the end, over him
    const triK = (i) => (S.triOn == null ? 0 : sm01(S.triOn + i * 0.6, S.triOn + i * 0.6 + 0.35, T));
    const mv = S.triMove == null ? 0 : sm01(S.triMove, S.triMove + 6, T);
    const over = S.over;
    const cNow = S.cNow.copy(lights.triC).lerp(TRI_C2, mv).lerp(S.cOver, over);
    for (let i = 0; i < 3; i++) {
      const off = _v2.subVectors(lights.tri[i], lights.triC).multiplyScalar(1 - 0.55 * over + 0.9 * S.open);
      const p = _v.copy(cNow).add(off), k = triK(i);
      put(p, [1, 0.92, 0.78], (38 + 10 * k) * (1 + 0.6 * over), k * (0.9 + 0.1 * Math.sin(T * 0.9 + i)));
      sky += k * 0.8;
    }
    if (S.open > 0) { lights.ring.visible = true; lights.ring.position.copy(cNow); lights.ring.lookAt(E.camera.position); lights.ring.scale.setScalar(4 + 40 * S.open); lights.ringM.uniforms.uO.value = S.open; }
    const show = U.u4D.value;
    for (let i = 0; i < ORB_N; i++) for (let j = 0; j < TRAIL; j++) {
      const s = j / (TRAIL - 1) * 2 - 1, p = orbAt(i, T + s * TRAIL_T, tmp), c = ORB_COLS[i], fut = s > 0;
      put(p, fut ? [c[0] * 0.6 + 0.4, c[1] * 0.6 + 0.4, c[2] * 0.6 + 0.4] : c, 5 + 4 * (1 - Math.abs(s)), show * 0.45 * (1 - Math.abs(s)) ** 1.5 * (i === FLASHER ? orbPulse(i, T + s * TRAIL_T) : 1));
    }
    posA.needsUpdate = colA.needsUpdate = sizA.needsUpdate = alA.needsUpdate = true;
    U.uSkyL.value = 0.25 + sky * 0.06 + S.pick * 1.5;
    hemi.intensity = 0.55 + sky * 0.02 + S.pick * 0.6;
    arcs.visible = show > 0.01;

    // the fog: its point comes on ahead of the tall one, then over the camp at the end
    const creep = 15.6 - T * 0.06;
    S.tip = Math.min(S.tip, creep, Math.max(2.3, S.mp.z - S.fogLead));
    if (S.fogTo != null) S.tip += (S.fogTo - S.tip) * Math.min(1, dt * 0.35);
    U.uFogA.value.set(S.mp.x * 0.5 + 0.3, S.tip, 0.55, S.fogW);
    for (const x of forms) x.u.uThin.value = S.thin;
    // the pale line ahead of you, to where you are going
    lead.uLead.value.set(S.mp.x, S.mp.z, FEET.x, FEET.z); lead.uLeadA.value += ((S.walk && S.d > 3.6 ? 1 : 0) - lead.uLeadA.value) * Math.min(1, dt * 1.5);
    // the column
    U.uPick.value.set(FEET.x, 30, FEET.z, S.pick); column.visible = S.pick > 0.01; pickL.intensity = S.pick * 30;

    // the eye: in his body it rides on his head
    if (S.view === 'man') { eyeOf(manEye); E.camera.position.copy(manEye); }
    // sound: the tones from the little speaker by how near it is; the pressure of the lights; the mantis breathing in its own body
    const ds = E.camera.position.distanceTo(tbl.speaker);
    _v.subVectors(tbl.speaker, E.camera.position).normalize();
    setTones(S.hush != null ? 0 : Math.min(1, 1.6 / (1 + ds * 0.45)) * (1 - S.pick), clamp(_v.x * Math.cos(E.yaw) - _v.z * Math.sin(E.yaw), -0.8, 0.8));
    setPress((S.view === 'man' ? 0.65 : 0.35) + 0.25 * mv + S.pick * 0.6 + over * 0.4);
    setBreath(S.view === 'mantis' ? 1 : 0.22 * sm01(12, 4, S.d));
    setNight((1 - 0.5 * S.pick) * (S.hush == null ? 1 : 0.6 * sm01(S.hush + 3, S.hush + 14, T)),   // after the stop the air comes back only slowly, and quieter
       clamp((S.mp.z - S.tip) * 0.12, 0, 0.7) * (S.view === 'mantis' ? 1 : 0.6));
    if (window.__fieldLog) window.__fieldLog(S, { crew, man, lz, P });
  });

  // ---- the arrival, seen from where the tall one stands at the hedge, unseen
  E.surface = 'none'; E.mode = 'locked';
  setView(S.mp.x, EYE, S.mp.z - 0.07, 0, -0.05); S.bodyYaw = 0; S.walkYaw = 0;
  applyView('mantis');
  for (const w of walkers) w.h.visible = true;
  setForms('chrome'); warm(g); setForms('wire'); warm(g);
  warpPass = warpBuild();
  window.UAP && (window.UAP.field = { S, crew, man, mantis, fore, lights, laser, P, FEET, greys, walkers, forms, med, setForms, U });
  const hideCamp = (hide) => {
    for (const p of [...crew, man]) p.h.visible = !hide;
    for (const x of props) x.visible = !hide;
    mantis.visible = !hide; for (const gy of greys) gy.g.visible = !hide;
    if (hide) { blk.visible = false; laser.sheet.visible = false; laser.beam.visible = false; }
  };
  hideCamp(true); for (const w of walkers) w.h.visible = false;
  S.cut = true; S.ct = 0; U.u4D.value = 0;
  E.camera.fov = 40; E.camera.updateProjectionMatrix();
  { const a = aimAt(V(10.5, 1.0, 1.0)); E.yaw = E.base.yaw = a.yaw; E.pitch = E.base.pitch = a.pitch; }
  await fade(0, 2.2, '#fff');
  await say('Late at night, a group comes into a field.');
  await say('This is CE5: they meditate together, to invite contact.');
  // the laser line waits for the laser (it is tried on the sky as its holder gets there)
  await until(() => laser.beam.visible, 12);
  await say('A green laser signals to the sky.');
  // cut: they have sat down
  await fade(1, 0.8, '#000');
  S.cutDone = true; for (const w of walkers) w.h.visible = false;
  hideCamp(false); mantis.visible = false; for (const gy of greys) gy.g.visible = false;
  blk.visible = true; blk.scale.set(1, 1, 1); blk.position.z = MAN_H.z - 0.15; laser.beam.visible = false;
  red.position.set(TABLE.x + 0.2, 0.62, TABLE.z); red.intensity = 0.9; red.distance = 2.2; S.cutTones = 1;
  // the circle, closer: a little moonlight, and the phone's and a torch's glow on their faces from the table
  hemi.intensity = 1.5; wTorch.position.set(TABLE.x + 0.1, 1.05, TABLE.z + 0.4); wTorch.intensity = 10; wTorch.distance = 6;
  pickL.position.set(-5, 9, 11); pickL.color.set(0xb8c8ff); pickL.intensity = 70;   // moonlight from behind the watcher (the column's light, unused until the end)
  E.camera.fov = 20; E.camera.updateProjectionMatrix();
  { const a = aimAt(V(0.1, 0.55, 0.0)); E.yaw = a.yaw; E.pitch = a.pitch; }
  await fade(0, 1.0, '#000');
  await say('They sit in a circle, eyes closed. One works the laser.');
  wTorch.intensity = 0; wTorch.distance = 9; pickL.intensity = 0; pickL.color.set(0xdde8ff); pickL.position.set(MAN_H.x, 9, MAN_H.z);
  await fade(1, 1.4, '#fff');
  // ---- out of the white into the tall one's eyes
  S.cut = false; mantis.visible = true; for (const gy of greys) gy.g.visible = true; laser.beam.visible = true; hemi.intensity = 0.55;
  E.camera.fov = 70; E.camera.updateProjectionMatrix();
  setView(S.mp.x, EYE, S.mp.z - 0.07, 0, -0.05); S.look.mantis = { yaw: 0, pitch: -0.05 }; applyView('mantis');
  await fade(0, 2.6, '#fff');
  E.mode = 'look';
  await say('You open your eyes. They are not your eyes.');
  await until(() => E.pitch < -0.7, 7);
  await say('Long hooked forelimbs, folded in wide sleeves. Drawn in lines of light.');
  note('mantisbody');
  await say('You are inside one of them.');
  await say('Two greys stand with you, one on each side.');
  // the whole moment at once: the view turned through time and back
  warpOn(); if (A.fieldFold) A.fieldFold(); tween(1.6, (k) => { S.warpK = k; }).then(() => wait(1.6)).then(() => tween(2.4, (k) => { S.warpK = 1 - k; })).then(warpOff);
  await say('You see the whole moment at once: where they have been, where they are going.');
  S.walk = true; hint('W A S D to walk');
  const w0 = S.t;
  await until(() => S.d < 13 || S.t - w0 > 20, 60);
  if (S.d >= 13) S.auto = true;
  // the laser draws a triangle on the sky; three lights answer
  P.L.drawAt = lz.clock + 0.4;
  await say('A green line draws a triangle on the sky.');
  await until(() => lz.clock > P.L.drawAt + 4.6, 10);
  S.triOn = S.t; P.pointAt = man.clock + 1.0; if (A.lightsAnswer) A.lightsAnswer();
  await wait(1.4);
  await say('Three lights answer it.');
  note('ce5');
  // as the tall one comes near, the others stop
  const w1 = S.t;
  await until(() => S.d < 8.5 || S.t - w1 > 8, 20);
  S.auto = S.auto || S.d >= 8.5;
  crew.forEach((p, i) => { p.offAt = S.t + [0.8, 0, 0.5, 1.2][i]; });
  // everything stops on the same frame: the phone's tones and the night air cut dead, the ears fill
  if (tones && tones.cut) tones.cut(); if (night && night.cut) night.cut(); S.hush = S.t;
  if (A.switchOff) A.switchOff();
  await say('They stop. Mid-breath, mid-word.');
  note('switchedoff');
  await say('All but the one on the blanket.');
  await until(() => S.d < 6.5 || S.t - w1 > 18, 20);
  // into his eyes
  hint('E — see through his eyes'); E.canAct = true;
  { const w2 = S.t; await until(() => E.just.has('KeyE') || S.t - w2 > 14, 30); }
  E.canAct = false; hint('');
  S.auto = false;
  await doSwitch('man');
  // the bank thickens a little round the tall one's legs while he lies there; it comes on toward him with its own line
  tween(9, (k) => { S.fogW = 0.25 + 0.08 * k; U.uFogTop.value = 0.15 * k; });
  await say('Cold. The blanket is damp under your back.');
  await say('You cannot move. Only your eyes.');
  await say('Lights over the field. Amber, white, red, green.');
  note('triangle');
  S.splitAt = S.t + 0.5;
  await say('One of them splits in two. Then three.');
  await say('Three of them hold still, in a triangle.');
  S.triMove = S.t;
  await say('Then they move. Together, as one thing.');
  await say('You ask the others if they can see it. Nobody answers.');
  // his eyes go to the tall one: an eased turn to a target kept inside what his eyes can reach, so the limits never cut it
  // off part way (that stop read as a snap)
  const ms = V(S.mp.x, 1.7, S.mp.z);
  { const a = aimAt(ms), L = E.limits, y = E.yaw + wrap(a.yaw - E.yaw);
    const to = L ? { yaw: clamp(y, E.base.yaw - L.yaw + 0.04, E.base.yaw + L.yaw - 0.04), pitch: clamp(a.pitch, E.base.pitch - L.down + 0.04, E.base.pitch + L.up - 0.04) } : { yaw: y, pitch: a.pitch };
    moveView(3.4, to); }
  // the bank comes on: its point runs in over the grass toward the blanket (held close to the tall one until now, so the
  // advance is seen here), and it rises round the tall one
  { const l0 = S.fogLead, w0 = S.fogW, t0 = U.uFogTop.value;
    tween(7, (k) => { S.fogLead = l0 + 4.0 * k; S.fogW = w0 + 0.14 * k; U.uFogTop.value = t0 + 0.35 * k; }); }
  await say('Fog, coming over the hedge in a straight line. Pointed, as if it were steered.');
  // as if barely there: the lines (and the chrome) thin out, then slowly come back
  tween(1.6, (k) => { S.thin = 0.55 * k; });
  await say('Something tall is standing in it.');
  await say('It is you.');
  note('twoviews');
  tween(5, (k) => { S.thin = 0.55 * (1 - k) + 0.12 * k; });
  // back to the tall one, once, when you choose (14 s and it takes you): one switch each way, never a back-and-forth
  await until(() => !S.busy, 3);
  hint('E — the tall one'); E.canAct = true;
  { const w3 = S.t; await until(() => E.just.has('KeyE') || S.t - w3 > 14, 30); }
  E.canAct = false; hint('');
  await doSwitch('mantis');

  // ---- the pickup
  hint('E — hold out the medallion'); E.canAct = true;
  { const w4 = S.t; await until(() => E.just.has('KeyE') || S.t - w4 > 12, 30); }
  E.canAct = false; hint(''); S.walk = false;
  tween(1.2, (k) => { S.thin = 0.12 * (1 - k); });
  if (S.view === 'mantis') { const a = aimAt(V(FEET.x, 1.4, FEET.z)); E.yaw = a.yaw + wrap(E.yaw - a.yaw); moveView(1.4, { yaw: a.yaw, pitch: Math.max(a.pitch, -0.25) }); }
  // the arms fold home first (the reach holds the other arm fully folded)
  await tween(0.6, (k) => mt.setFold(0.62 + 0.38 * k));
  // The medallion lifts off the robe on its chain to a point in front of the chest, a little to the right; the hook nearer
  // it comes out and takes it by the top of the disc (two-bone solve onto the point, never a set pose), then holds it out
  // toward him, the disc hanging from the hook. Points in the robe's own frame first, then the world.
  const MED_TO = V(-0.14, 1.8, med.C.z + 0.42), HANG = 0.072;   // where it lifts to (root frame); disc centre under the hook tip
  const tipOf = (out) => { const a = mt.reachArm || mt.arms.find((x) => x.s === -1); return a.wr.localToWorld(out.set(0, -0.367, -0.048)); };
  const outTo = (out) => { const dx = FEET.x - S.mp.x, dz = FEET.z - S.mp.z, l = Math.hypot(dx, dz), fx = dx / l, fz = dz / l; return out.set(S.mp.x + fx * 1.0 - fz * 0.08, 1.72, S.mp.z + fz * 1.0 + fx * 0.08); };
  const mTip = V(0, 0, 0), mOut = V(0, 0, 0), mT = V(0, 0, 0), mL = V(0, 0, 0), mTop = V(0, 0, 0), o3 = new THREE.Object3D();
  const MED = { reach: 0, out: 0, reachK: 0 };
  // the hook's target: the top of the lifted disc, then on out toward him
  const medTarget = (out) => { mt.root.localToWorld(out.copy(MED_TO).add(_v2.set(0, HANG, 0))); return MED.out > 0 ? out.lerp(outTo(mOut), MED.out) : out; };
  on(() => {
    // the hook on it: reaching, then holding it out (solved first, so the disc can hang from where the hook now is)
    if (MED.reach > 0 && MED.reachK > 0) mt.reachTo(medTarget(mT), MED.reachK);
    // the disc: on its way up off the robe, then hanging from the hook
    if (med.held > 0) { mantis.updateMatrixWorld(true); tipOf(mTip); mt.root.worldToLocal(mL.copy(mTip)); mL.y -= HANG; med.g.position.copy(mL); }
    else med.g.position.lerpVectors(med.C, MED_TO, med.lift);
    med.g.rotation.x = -0.25 * med.lift; med.g.rotation.z = 0.06 * Math.sin(S.t * 1.7) * med.lift;
    // the chain: the robe's own chain while it rests; two strands of beads from the collar to the top of the disc once off
    const off = med.lift > 0.001; med.chain.visible = !off; med.beads.visible = off;
    if (off) {
      mTop.copy(med.g.position); mTop.y += 0.066;
      for (let k = 0; k < 2; k++) { const a = med.anc[k], L = a.distanceTo(mTop), sag = Math.max(0, 0.32 - L) * 0.35;
        for (let i = 0; i < 14; i++) { const t = (i + 0.5) / 14; o3.position.lerpVectors(a, mTop, t); o3.position.x += (k ? 1 : -1) * 0.008 * Math.sin(PI * t) * (1 - med.lift); o3.position.y -= sag * Math.sin(PI * t); o3.updateMatrix(); med.beads.setMatrixAt(k * 14 + i, o3.matrix); } }
      med.beads.instanceMatrix.needsUpdate = true;
    }
    // the light it gives while it acts
    glow.visible = med.glow > 0.01; glowM.uniforms.uG.value = med.glow * 1.1 * (0.85 + 0.15 * Math.sin(S.t * 3.1));
    if (glow.visible) { med.g.getWorldPosition(glow.position); glow.quaternion.copy(E.camera.quaternion); glow.scale.setScalar(0.5 + 0.7 * med.glow); }
    { med.g.getWorldPosition(_v); U.uMed.value.set(_v.x, _v.y, _v.z, med.glow * 2.2 * (0.85 + 0.15 * Math.sin(S.t * 3.1))); }
    // his eyes on it, while he lies and as he is brought up (he cannot turn his head; the eyes follow)
    if (S.watchMed && S.view === 'man') { med.g.getWorldPosition(_v); const a = aimAt(_v), k = Math.min(1, 1 / 30 * 4); E.yaw += wrap(a.yaw - E.yaw) * k; E.pitch += (a.pitch - E.pitch) * k; }
    if (window.__medLog) window.__medLog({ med, MED, mt, mantis, tip: tipOf(V(0, 0, 0)), glow, S });
  });
  if (A.fieldMedal) A.fieldMedal(1.4 + 1.7);
  if (S.view === 'man') { E.limits = null; S.watchMed = true; }
  tween(1.4, (k) => { med.lift = k; }).then(() => {
    // reachTo blends from the arm's current pose by k, so a plain eased k would chase the target and lurch in the middle;
    // each frame takes the fraction of what is left that keeps the arm on the eased path from where it started
    let e0 = 0; MED.reach = 1;
    return tween(1.7, (e) => { MED.reachK = e >= 1 ? 1 : (e - e0) / (1 - e0); e0 = e; });
  }).then(() => { MED.reachK = 1; med.held = 1; });
  await say('The medallion lifts off your robe on its chain.');
  await until(() => med.held > 0, 4);
  if (A.fieldPickup) hum = A.fieldPickup(3.4);
  tween(1.6, (k) => { MED.out = k; med.glow = k; });
  tween(2.0, (k) => { S.pick = k; });
  await say('Your hook takes it and holds it out to him. It burns with light.');
  // the end: from here on they are the half-there chrome in either sight; and his eyes, on the light
  S.final = true;
  if (S.view !== 'man') await doSwitch('man', () => { med.g.getWorldPosition(_v); const a = aimAt(_v); E.yaw = a.yaw; E.pitch = a.pitch; E.limits = null; S.watchMed = true; });
  else { E.limits = null; S.watchMed = true; setForms('chrome'); }
  tween(2.6, (k) => { S.tilt = k; });
  await say('You come up off the blanket, rigid. Not by your own strength.');
  S.lifting = true; mu.neck.visible = false;   // upright, his own neck would fill his view
  tween(14, (k) => { S.lift = 26 * k * k; });
  tween(2.6, (k) => { S.turn = k; });
  await wait(2.0);
  // turned toward the camp as he rises: the eyes go down to it
  S.watchMed = false; S.fogTo = 0.9;
  { const a = aimAt(V(CAMP.x, 0, CAMP.z)); E.base.yaw = a.yaw; E.base.pitch = -0.45; await moveView(1.2, { yaw: E.yaw + wrap(a.yaw - E.yaw), pitch: Math.max(-1.0, a.pitch) }); E.yaw = a.yaw; E.limits = { yaw: 0.9, up: 2, down: 0.55 }; }   // never far enough down or round to see into his own collar
  await say('The ground falls away.');
  await say('Below, they sit as they were. Nobody looks up.');
  tween(2.5, (k) => { S.over = k; });
  moveView(2.4, { pitch: 1.42 });   // straight up at what is overhead, without swinging round
  await wait(1.6);
  tween(3.5, (k) => { S.open = k; }); if (A.fieldOpen) A.fieldOpen();
  await say('Above you, the three lights open.');
  await fade(1, 2.4, '#fff');
  if (night) night.stop(1); if (tones) tones.stop(0.5); if (breath) breath.stop(1); if (press) press.stop(1); if (hum) hum.stop(2);
  if (warpPass) { warpPass.draw.dispose(); warpPass = null; }
  return 'aftermath';
}

