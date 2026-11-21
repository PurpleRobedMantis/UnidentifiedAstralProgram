// The hall of containers, built: two rows of fluid-filled vessels on raised plinths, each a machined base and cap joined by
// struts round a thick glass cylinder, hoses up into a manifold under the ceiling, and inside a small curled form hung on a
// cord from the cap. Ribbed hall, panelled walls with niches, grating over a lit sub-floor, cold strip lights overhead.
// Everything per vessel is instanced or shared; the forms turn and drift on the GPU. buildVesselHall(g, kit) adds it all
// to group g (kit: the shader kit from ship.js, { sm, ADD }).
import { THREE, on, unsteady } from '../engine.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
export const ROWS = 9, VX = 1.75, BAY = 2.3;
export const VZ = (i) => -1.5 - i * BAY;
const PL = 0.05;                                  // top of the plinths the vessels stand on
const G_BOT = 0.36, G_TOP = 1.98, F_TOP = 1.86;   // glass and fluid, above the plinth top
const R_GO = 0.36, R_GI = 0.342, R_F = 0.338;
const Z0 = 2.3, Z1 = -22.4, HW = 2.5, HH = 3.8;   // hall: back wall, end wall, half width, height
const PORT_Y = PL + 1.91;
const f4 = (x) => x.toFixed(4);

// ---- geometry helpers ----
// parts: [geometry, matrix or null, { aK, aV } constants per vertex, zeroUv]
function mergeParts(parts, extra = []) {
  const pos = [], nor = [], uv = [], ex = extra.map(() => []), v = V(0, 0, 0), n = V(0, 0, 0), nm = new THREE.Matrix3();
  for (const [g0, m, c = {}, zuv] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0, p = g.attributes.position, nn = g.attributes.normal, u = g.attributes.uv;
    if (m) nm.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); if (m) v.applyMatrix4(m); pos.push(v.x, v.y, v.z);
      n.fromBufferAttribute(nn, i); if (m) n.applyMatrix3(nm).normalize(); nor.push(n.x, n.y, n.z);
      uv.push(u && !zuv ? u.getX(i) : 0, u && !zuv ? u.getY(i) : 0);
      extra.forEach((k, j) => ex[j].push(c[k] || 0));
    }
    if (g !== g0) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  extra.forEach((k, j) => out.setAttribute(k, new THREE.Float32BufferAttribute(ex[j], 1)));
  return out;
}
const M4 = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(sx, sy, sz));
const lathe = (pts, n) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), n);
// a tube along a smooth curve whose radius follows rad(t) (t 0..1), closed with a small ball at each end
function limb(pts, rad, radial = 8, seg = 12, caps = [true, true]) {
  const curve = new THREE.CatmullRomCurve3(pts), tube = new THREE.TubeGeometry(curve, seg, 1, radial, false), p = tube.attributes.position, c = V(0, 0, 0), q = V(0, 0, 0);
  for (let i = 0; i <= seg; i++) {
    curve.getPointAt(i / seg, c); const r = rad(i / seg);
    for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; q.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c); p.setXYZ(k, q.x, q.y, q.z); }
  }
  const out = [tube];
  for (const t of [0, 1]) { if (!caps[t]) continue; const s = new THREE.SphereGeometry(rad(t), Math.max(5, radial - 2), 4); const e = curve.getPointAt(t); s.translate(e.x, e.y, e.z); out.push(s); }
  return out;
}
const lerpTab = (tab, t) => { for (let i = 1; i < tab.length; i++) if (t <= tab[i][0]) { const [a, ra] = tab[i - 1], [b, rb] = tab[i]; return ra + (rb - ra) * (t - a) / (b - a); } return tab[tab.length - 1][1]; };

// ---- the small forms: a curled body with a large head, thin limbs drawn up, long fingers ----
// o: st (stage 0 early .. 1 late), curl, flex (head bent onto the chest), turn (head turned), arms [pose L, pose R],
// legs [pose L, pose R]. Origin: the navel, where the cord joins. aK: 1 on the eyes; aV: how veined the skin is.
function formGeo(o) {
  const parts = [], bs = 0.72 + 0.28 * o.st, ls = 0.55 + 0.3 * o.st, c = o.curl;
  const add = (gs, k, vv) => { for (const g of [].concat(gs)) parts.push([g, null, { aK: k, aV: vv }]); };
  // spine from the rump to the neck, bowed back
  const sp = [V(0, -0.095, 0.012), V(0, -0.055, -0.045 - 0.02 * c), V(0, 0.005, -0.07 - 0.02 * c), V(0, 0.058, -0.052 - 0.012 * c), V(0, 0.088, -0.008)].map((p) => p.multiplyScalar(bs));
  const spine = new THREE.CatmullRomCurve3(sp);
  const RT = [[0, 0.04], [0.3, 0.056], [0.6, 0.052], [0.85, 0.044], [1, 0.03]];
  add(limb(sp, (t) => lerpTab(RT, t) * bs, 14, 14), 0, 0.35);
  // a rounder belly
  { const b = spine.getPointAt(0.32); const s = new THREE.SphereGeometry(0.05 * bs, 14, 10); s.scale(1.05, 1.0, 0.9); s.translate(b.x, b.y, b.z + 0.012 * bs); add(s, 0, 0.3); }
  for (let k = 0; k < 11; k++) {
    const t = 0.08 + k * 0.075, p = spine.getPointAt(t), tg = spine.getTangentAt(t), back = V(0, 0, -1).sub(tg.clone().multiplyScalar(-tg.z)).normalize();
    const b = new THREE.SphereGeometry(0.0085 * bs, 5, 4); b.scale(1.3, 0.8, 1); const r = lerpTab(RT, t) * bs;
    b.translate(p.x + back.x * r * 0.93, p.y + back.y * r * 0.93, p.z + back.z * r * 0.93); add(b, 0, 0.2);
  }
  const nav = spine.getPointAt(0.32).add(V(0, 0, 0.055 * bs));   // on the front of the belly
  // head: large cranium, small tapered face, the chin tucked down onto the chest
  const R = 0.074 * (1.06 - 0.12 * o.st);
  const head = new THREE.SphereGeometry(R, 24, 16), hp = head.attributes.position, q = V(0, 0, 0);
  for (let i = 0; i < hp.count; i++) {
    q.fromBufferAttribute(hp, i);
    if (q.y < 0) { const k = Math.min(1, -q.y / R); q.x *= 1 - 0.4 * k * k; q.z *= 1 - 0.22 * k; q.y *= 0.92; q.z += 0.012 * k * R / 0.07; }
    else { q.y *= 1.06; }
    if (q.z < 0) q.z *= 1.12;
    if (q.z > 0.55 * R && Math.abs(q.y) < 0.5 * R) q.z = 0.55 * R + (q.z - 0.55 * R) * 0.7;
    hp.setXYZ(i, q.x, q.y, q.z);
  }
  head.computeVertexNormals();
  const eyes = [-1, 1].map((sd) => { const e = new THREE.SphereGeometry(1, 12, 8); e.scale(R * 0.36, R * 0.19, R * 0.16); e.rotateZ(sd * 0.36); e.rotateY(sd * 0.42); e.translate(sd * R * 0.36, -R * 0.1, R * 0.78); return e; });
  const neck = sp[4], hm = new THREE.Matrix4().compose(neck.clone().add(V(0, 0.0, 0.016)), new THREE.Quaternion().setFromEuler(new THREE.Euler(o.flex, o.turn, o.tilt || 0, 'YXZ')), V(1, 1, 1)).multiply(new THREE.Matrix4().makeTranslation(0, R * 0.78, 0.012));
  head.applyMatrix4(hm); add(head, 0, 1);
  for (const e of eyes) { e.applyMatrix4(hm); add(e, 1, 0.2); }
  // arms and hands
  const sh = spine.getPointAt(0.86);
  const ARM = {
    face: [V(0.012, -0.06, 0.04), V(0.018, 0.05, 0.085), V(-0.006, 0.035, 0.016), 1.0],
    down: [V(0.025, -0.07, 0.0), V(0.012, -0.15, 0.06), V(-0.01, -0.03, 0.02), 0.6],
    reach: [V(0.035, -0.02, 0.06), V(0.07, 0.0, 0.15), V(0.012, 0.0, 0.035), 0.0],
    cross: [V(0.012, -0.065, 0.05), V(-0.06, 0.06, 0.08), V(-0.03, 0.004, 0.015), 0.8],
    mouth: [V(0.015, -0.07, 0.045), V(0.006, 0.045, 0.1), V(-0.012, 0.03, 0.022), 0.9],
  };
  for (const sd of [-1, 1]) {
    const [el, wr, hd, curlF] = ARM[o.arms[sd < 0 ? 0 : 1]];
    const S = sh.clone().add(V(sd * 0.05 * bs, -0.005, 0.0));
    const E1 = S.clone().add(V(el.x * sd * bs, el.y * bs, el.z * bs)), W = S.clone().add(V(wr.x * sd * bs, wr.y * bs, wr.z * bs));
    add(limb([S, S.clone().lerp(E1, 0.5).add(V(sd * 0.006, 0, 0)), E1, E1.clone().lerp(W, 0.5), W], (t) => (0.0145 - 0.005 * t) * bs * ls, 8, 12), 0, 0.45);
    // hand: a small flat palm and four long fingers
    const dir = V(hd.x * sd, hd.y, hd.z).normalize(), side = V(0, 1, 0).cross(dir).normalize(), up = dir.clone().cross(side).normalize();
    const palm = new THREE.SphereGeometry(1, 8, 6); palm.scale(0.012 * bs, 0.005 * bs, 0.016 * bs);
    const pm = new THREE.Matrix4().makeBasis(side, up, dir).setPosition(W.clone().addScaledVector(dir, 0.012 * bs)); palm.applyMatrix4(pm); add(palm, 0, 0.3);
    for (let f = 0; f < 4; f++) {
      const spread = (f - 1.5) * (0.0055 + 0.004 * (1 - curlF)) * bs, base = W.clone().addScaledVector(dir, 0.026 * bs).addScaledVector(side, spread);
      const L = (0.026 + 0.004 * (f === 1 || f === 2)) * bs * (0.8 + 0.2 * ls), fan = side.clone().multiplyScalar(spread * 2.5).add(dir).normalize();
      const m1 = base.clone().addScaledVector(fan, L * 0.45), tip = m1.clone().addScaledVector(fan, L * 0.55 * (1 - curlF * 0.6)).addScaledVector(up, -L * 0.6 * curlF);
      add(limb([base, m1, tip], (t) => (0.0034 - 0.0012 * t) * bs, 4, 4, [false, true]), 0, 0.15);
    }
  }
  // legs drawn up, feet
  const hip = spine.getPointAt(0.04);
  const LEG = {
    tuck: [V(0.06, 0.03, 0.085), V(0.035, -0.04, 0.07), V(-0.006, -0.012, 0.022)],
    cross: [V(0.055, 0.025, 0.09), V(-0.022, -0.04, 0.07), V(-0.02, -0.006, 0.02)],
    stretch: [V(0.05, -0.04, 0.08), V(0.045, -0.13, 0.06), V(0.0, -0.012, 0.022)],
  };
  for (const sd of [-1, 1]) {
    const [kn, an, ft] = LEG[o.legs[sd < 0 ? 0 : 1]];
    const H = hip.clone().add(V(sd * 0.046 * bs, 0, 0.005)), K = H.clone().add(V(kn.x * sd * bs, kn.y * bs, kn.z * bs)), A = H.clone().add(V(an.x * sd * bs, an.y * bs, an.z * bs));
    add(limb([H, H.clone().lerp(K, 0.5), K, K.clone().lerp(A, 0.5), A], (t) => (0.024 - 0.011 * t) * bs * ls, 9, 12), 0, 0.4);
    const fd = V(ft.x * sd, ft.y, ft.z).normalize(), foot = new THREE.SphereGeometry(1, 8, 6); foot.scale(0.011 * bs, 0.008 * bs, 0.022 * bs);
    const fs = V(0, 1, 0).cross(fd).normalize(); foot.applyMatrix4(new THREE.Matrix4().makeBasis(fs, fd.clone().cross(fs), fd).setPosition(A.clone().addScaledVector(fd, 0.014 * bs)));
    add(foot, 0, 0.2);
  }
  const g = mergeParts(parts, ['aK', 'aV']);
  g.translate(-nav.x, -nav.y, -nav.z);
  g.computeBoundingBox();
  const centre = g.boundingBox.getCenter(V(0, 0, 0));
  return { g, centre };
}
// five builds: the stage, the curl and where the arms and legs are; neighbours never share one
const FORMS = [
// rt: the cord's route out of the navel for that build, [forward, side] to its first bend and [forward, side] to its
// second (see CORD_V), each searched against the body through the whole range of movement for the widest clearance
  { st: 1.0, curl: 1.0, flex: 0.75, turn: 0.0, arms: ['face', 'face'], legs: ['cross', 'tuck'], rt: [0.36, -0.1, 0.4, -0.14] },
  { st: 0.6, curl: 0.6, flex: 0.45, turn: 0.45, arms: ['down', 'mouth'], legs: ['tuck', 'tuck'], rt: [0.24, -0.05, 0.4, -0.14] },
  { st: 0.0, curl: 1.0, flex: 0.85, turn: -0.2, arms: ['face', 'cross'], legs: ['tuck', 'cross'], rt: [0.36, 0.1, 0.4, 0.22] },
  { st: 0.9, curl: 0.4, flex: 0.25, turn: -0.35, tilt: 0.15, arms: ['cross', 'down'], legs: ['stretch', 'tuck'], rt: [0.36, 0.1, 0.4, 0.14] },
  { st: 0.75, curl: 0.8, flex: 0.6, turn: 0.3, arms: ['mouth', 'reach'], legs: ['cross', 'stretch'], rt: [0.36, -0.1, 0.4, -0.14] },
];
const FORM_OF = [[0, 3], [2, 1], [4, 0], [1, 4], [3, 2], [0, 1], [2, 4], [4, 0], [3, 1]];   // [left, right] for each row
const FORM_SCALE = [1.0, 0.86, 0.74, 0.96, 0.92];

// ---- shaders ----
const SHARED = `
#define PLY ${f4(PL)}
#define F_TOP ${f4(PL + F_TOP)}
#define G_BOT ${f4(PL + G_BOT)}
#define R_F ${f4(R_F)}
const vec3 FLC = vec3(0.2, 0.9, 0.76);
vec2 tankAxis(vec2 xz) { float i = clamp(floor((-1.5 - xz.y) / 2.3 + 0.5), 0.0, 8.0); return vec2(sign(xz.x) * 1.75, -1.5 - i * 2.3); }
float tankIdx(vec2 ax) { return floor((-1.5 - ax.y) / 2.3 + 0.5); }
float tankPh(vec2 ax) { return fract(sin(ax.x * 3.1 + ax.y * 17.3) * 43758.5453) * 6.2831853; }
// each vessel's own brightness; one in the left row stutters
float tankGlow(float i, float s) {
  float g = 0.82 + 0.28 * fract(sin(i * 12.9898 + s * 78.233) * 43758.5453);
  if (abs(i - 5.0) < 0.1 && s < 0.0) g *= 0.6 + 0.4 * step(0.3, fract(sin(floor(uTime * 6.0) * 91.7) * 437.5)) * (0.75 + 0.25 * sin(uTime * 1.3));
  return g;
}
// where a ray from ro enters the fluid column round axis a (the distance along the ray)
float fluidEntry(vec3 ro, vec3 rd, vec2 a) {
  vec2 oc = ro.xz - a; float A = max(dot(rd.xz, rd.xz), 1e-5); float B = dot(oc, rd.xz); float C = dot(oc, oc) - R_F * R_F;
  float t = (-B - sqrt(max(B * B - A * C, 0.0))) / A;
  if (ro.y > F_TOP && rd.y < 0.0) t = max(t, (F_TOP - ro.y) / rd.y);
  return max(t, 0.0);
}
// the light the fluid gives off at point m: brighter low (the lamp in the base) and down the middle, clouded
vec3 fluidEm(vec3 m, vec2 a, float g) {
  float h = clamp((m.y - G_BOT) / (F_TOP - G_BOT), 0.0, 1.0);
  float cl = noise3(vec3(m.x * 7.0, m.y * 4.0 - uTime * 0.05, m.z * 7.0));
  vec3 e = mix(FLC, vec3(0.52, 0.86, 0.5), cl * 0.35) * (1.05 - 0.45 * h) * (0.85 + 0.3 * cl);
  vec2 d = m.xz - a;
  e += FLC * 0.5 * exp(-dot(d, d) * 25.0) * (1.0 - h);
  return e * g;
}
`;
const LIT = `
uniform vec3 uToyP; uniform float uToyI;
// the vessels as upright line lights (the two rows nearest along the hall, both sides), the cold strips overhead, the
// toy's warm light; spec is how much the surface mirrors them, gloss how tight
vec3 hallLight(vec3 p, vec3 n, vec3 v, vec3 alb, float spec, float gloss) {
  vec3 acc = alb * vec3(0.045, 0.055, 0.068) * (0.65 + 0.35 * n.y * n.y);
  vec3 r = reflect(-v, n);
  float fi = (-1.5 - p.z) / 2.3; float i0 = floor(fi);
  float nrm = (gloss + 2.0) / 8.0;
  for (int k = 0; k < 4; k++) {
    float i = i0 + float(k / 2); float s = float(k - (k / 2) * 2) * 2.0 - 1.0;
    if (i < -0.5 || i > 8.5) continue;
    vec2 a = vec2(s * 1.75, -1.5 - i * 2.3);
    vec3 c = vec3(a.x, clamp(p.y, G_BOT + 0.15, F_TOP - 0.05), a.y);
    vec3 d = c - p; float L2 = dot(d, d); float L = sqrt(L2); vec3 l = d / L;
    float g = tankGlow(i, s);
    float att = g / (1.0 + L2 * 2.6) * smoothstep(0.2, 0.42, L);
    float dif = max(dot(n, l), 0.0) * 0.85 + 0.15;
    vec2 rx = r.xz; float t = max(dot(a - p.xz, rx) / max(dot(rx, rx), 1e-4), 0.0);
    vec3 q = vec3(a.x, clamp(p.y + r.y * t, G_BOT + 0.05, F_TOP), a.y);
    float sp = pow(max(dot(r, normalize(q - p)), 0.0), gloss) * nrm;
    acc += FLC * att * (alb * dif + spec * sp);
  }
  float up = r.y;
  acc += spec * mix(mix(vec3(0.004, 0.006, 0.007), FLC * 0.05, smoothstep(-0.6, 0.0, up)), vec3(0.09, 0.1, 0.13), smoothstep(0.1, 0.9, up));
  // the cold strip over the aisle at this row
  float ii = floor(fi + 0.5); float zc = -1.5 - ii * 2.3;
  vec3 q = vec3(0.0, 3.74, clamp(p.z, zc - 0.7, zc + 0.7));
  vec3 d = q - p; float L2 = dot(d, d); vec3 l = d * inversesqrt(L2);
  float att = 1.0 / (1.0 + L2 * 0.22);
  vec3 cold = vec3(0.6, 0.7, 0.95) * 0.5;
  acc += cold * att * (alb * max(dot(n, l), 0.0) + spec * pow(max(dot(r, l), 0.0), gloss) * nrm * 0.6);
  // the toy
  d = uToyP - p; L2 = dot(d, d); l = d * inversesqrt(L2);
  att = uToyI / (1.0 + L2 * 4.0);
  acc += vec3(1.0, 0.68, 0.3) * att * (alb * max(dot(n, l), 0.0) + spec * pow(max(dot(r, l), 0.0), gloss) * nrm * 0.5);
  return acc;
}
`;
// metal: machined vessel parts, the hall's frame, pipes; uRib > 0 rings it along the tube (hoses)
const METAL = SHARED + LIT + `
uniform vec3 uAlb; uniform float uGloss; uniform float uSpec; uniform float uRib;
void main() {
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld);
  vec3 alb = uAlb * (0.82 + 0.36 * noise3(vPos * 7.0));
  if (uRib > 0.0) {
    float x = vUv.x * uRib; float aa = clamp(fwidth(x) * 1.5, 0.0, 1.0);
    alb *= 0.72 + 0.28 * mix(sin(x * 6.2831853) * 0.5 + 0.5, 0.5, aa);
  }
  alb *= 0.55 + 0.45 * smoothstep(0.0, 0.7, vWorld.y);
  vec3 col = hallLight(vWorld, n, v, alb, uSpec * (0.75 + 0.5 * noise3(vPos * 23.0)), uGloss);
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// walls, ceiling and both end walls: plates with bevelled edges, rivets, vents, marks by each vessel; niches behind them
const WALL = SHARED + LIT + `
float glyph(vec2 q, float g) {
  float m = smoothstep(0.08, 0.03, abs(q.x - (g - 0.5) * 0.5)) * step(abs(q.y), 0.3) * step(0.35, g);
  m += smoothstep(0.08, 0.03, abs(q.y - (fract(g * 7.0) - 0.5) * 0.5)) * step(abs(q.x), 0.3) * step(0.3, fract(g * 3.0));
  m += smoothstep(0.1, 0.04, abs(length(q) - 0.25)) * step(0.78, fract(g * 13.0));
  return min(1.0, m);
}
void main() {
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld); vec3 p = vWorld;
  float isWall = step(0.5, abs(n.x)), isCeil = step(0.5, -n.y), isEnd = step(0.5, abs(n.z));
  vec2 q; vec3 tu, tv;
  if (isWall > 0.5) { q = vec2(p.z, p.y); tu = vec3(0.0, 0.0, 1.0); tv = vec3(0.0, 1.0, 0.0); }
  else if (isEnd > 0.5) { q = vec2(p.x, p.y); tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 1.0, 0.0); }
  else { q = vec2(p.x, p.z); tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 0.0, 1.0); }
  float fi = floor((-1.5 - p.z) / 2.3 + 0.5); float bz = p.z - (-1.5 - fi * 2.3);
  vec2 lo, hi; float niche = 0.0, vent = 0.0, door = 0.0;
  if (isWall > 0.5) {
    float az = abs(bz);
    if (az < 0.55) { lo.x = -0.55; hi.x = 0.55; niche = 1.0; }
    else { lo.x = sign(bz) > 0.0 ? 0.55 : -1.15; hi.x = sign(bz) > 0.0 ? 1.15 : -0.55; }
    float y = p.y;
    if (y < 0.14) { lo.y = 0.0; hi.y = 0.14; } else if (y < 0.95) { lo.y = 0.14; hi.y = 0.95; vent = 1.0 - niche; }
    else if (y < 2.35) { lo.y = 0.95; hi.y = 2.35; } else { lo.y = 2.35; hi.y = 3.8; }
    q.x = bz;
  } else if (isCeil > 0.5) {
    float cz = fract(bz / 1.15 + 0.5) * 1.15 - 0.575;
    lo.x = p.x < -1.3 ? -2.5 : (p.x < -0.3 ? -1.3 : (p.x < 0.3 ? -0.3 : (p.x < 1.3 ? 0.3 : 1.3)));
    hi.x = p.x < -1.3 ? -1.3 : (p.x < -0.3 ? -0.3 : (p.x < 0.3 ? 0.3 : (p.x < 1.3 ? 1.3 : 2.5)));
    lo.y = -0.575; hi.y = 0.575; q = vec2(p.x, cz);
  } else {
    // end walls: a sealed hatch in a heavy frame, plates round it
    float dx = abs(p.x); float dy = p.y - 1.45;
    float sd = (dy > 0.0 ? length(vec2(dx, dy * 1.05)) - 1.0 : dx - 1.0);
    door = smoothstep(0.012, -0.012, sd); float frame = smoothstep(0.012, -0.012, sd - 0.14) * (1.0 - door);
    lo = vec2(-2.5, 0.0); hi = vec2(2.5, 3.8);
    if (door > 0.5) { lo = vec2(p.x < 0.0 ? -1.0 : 0.0, 0.0); hi = vec2(p.x < 0.0 ? 0.0 : 1.0, 2.5); }
    else if (frame > 0.5) { lo = vec2(-1.2, 0.0); hi = vec2(1.2, 2.7); }
    else { float yy = floor(p.y / 0.95); lo = vec2(p.x < 0.0 ? -2.5 : 1.2, yy * 0.95); hi = vec2(p.x < 0.0 ? -1.2 : 2.5, yy * 0.95 + 0.95); }
  }
  // bevel: near a plate's edge the surface tips toward it; a dark seam in the gap
  vec2 e0 = q - lo, e1 = hi - q; float ex = min(e0.x, e1.x), ey = min(e0.y, e1.y), e = min(ex, ey);
  float bev = smoothstep(0.03, 0.004, e);
  vec3 tip = ex < ey ? tu * (e0.x < e1.x ? -1.0 : 1.0) : tv * (e0.y < e1.y ? -1.0 : 1.0);
  vec3 nn = normalize(n + tip * bev * 0.7);
  vec3 alb = vec3(0.13, 0.145, 0.16) * (0.8 + 0.3 * noise2(q * vec2(3.0, 5.0)) + 0.1 * noise2(q * 40.0));
  alb *= 1.0 - 0.15 * step(0.5, fract(sin(dot(floor(lo * 10.0), vec2(12.9, 78.2))) * 437.5));   // plates differ a little
  float seam = smoothstep(0.006, 0.002, e);
  // rivets just in from each edge
  float along = ex < ey ? q.y : q.x; float rb = abs(e - 0.028);
  float rv = smoothstep(0.0075, 0.004, length(vec2(rb, (fract(along / 0.11) - 0.5) * 0.11))) * step(0.14, max(hi.x - lo.x, hi.y - lo.y)) * (1.0 - niche);
  nn = normalize(nn + (tu + tv) * rv * 0.35);
  if (niche > 0.5) {   // the back of the niche: fluted, darker
    float fl = sin(q.x * 70.0); nn = normalize(nn + tu * fl * 0.25); alb *= 0.65;
  }
  if (vent > 0.5) {    // louvres in the low side plates
    vec2 vc = vec2(abs(q.x) - 0.85, p.y - 0.55);
    float inV = step(abs(vc.x), 0.18) * step(abs(vc.y), 0.24);
    float sl = fract(p.y / 0.04); alb *= 1.0 - inV * 0.85 * smoothstep(0.35, 0.5, sl); nn = normalize(nn + tv * inV * (sl - 0.5) * 0.8);
    alb *= 1.0 - 0.35 * (1.0 - inV) * step(abs(vc.x), 0.18) * smoothstep(-0.24, -1.0, vc.y) * noise2(vec2(q.x * 60.0, p.y * 2.0));   // streaks below
  }
  float doorLine = 0.0;
  if (isEnd > 0.5) { float dx = abs(p.x); float dy = p.y - 1.45; float sd = (dy > 0.0 ? length(vec2(dx, dy * 1.05)) - 1.0 : dx - 1.0); doorLine = smoothstep(0.012, 0.0, abs(sd - 0.14)) * step(0.02, p.y) + smoothstep(0.008, 0.0, abs(p.x)) * door; }
  if (door > 0.5) { alb *= 0.7; float sl = smoothstep(0.012, 0.004, abs(p.x)); alb *= 1.0 - sl * 0.8; }
  alb *= 1.0 - 0.5 * seam;
  // grime: toward the floor, into the corners
  alb *= 0.55 + 0.45 * smoothstep(0.0, 0.5, p.y);
  alb *= 1.0 - 0.3 * smoothstep(3.2, 3.8, p.y) * isWall;
  vec3 col = hallLight(p, nn, v, alb, 0.22 * (1.0 - seam), 22.0);
  col += vec3(0.35, 0.5, 0.75) * doorLine * 0.22;
  // marks by each vessel: a column of four signs, worn
  if (isWall > 0.5 && fi > -0.5 && fi < 8.5) {
    vec2 gq = vec2((abs(bz) - 0.8) / 0.11, (p.y - 1.55) / 0.11);
    if (abs(gq.x) < 0.5 && gq.y > -2.0 && gq.y < 2.0) {
      float cell = floor(gq.y + 2.0);
      float gm = glyph(vec2(gq.x, fract(gq.y + 2.0) - 0.5), fract(sin((fi * 4.0 + cell) * 7.13 + sign(p.x) * 3.1) * 437.5));
      col += vec3(0.32, 0.4, 0.42) * gm * 0.22 * (0.6 + 0.4 * noise2(q * 90.0));
    }
  }
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// the aisle: steel grating over a dim sub-floor (seen through it, with parallax) where two lit conduits run
const GRATE = SHARED + LIT + `
float bars(float c, float pitch, float w, float fw) {
  float d = abs(fract(c / pitch) - 0.5) * pitch;
  float l = 1.0 - smoothstep(pitch * 0.5 - w * 0.5 - fw, pitch * 0.5 - w * 0.5 + fw, d);
  return mix(l, w / pitch, smoothstep(pitch * 0.2, pitch * 0.5, fw));
}
void main() {
  vec2 p = vWorld.xz; vec3 v = normalize(cameraPosition - vWorld);
  vec2 fw = fwidth(p);
  float b = max(bars(p.x + 0.0175, 0.035, 0.007, fw.x), bars(p.y, 0.1, 0.008, fw.y));
  // panel frames: every 1.15 m along, and down the middle
  float fz = abs(fract(p.y / 1.15) - 0.5) * 1.15; float fx = abs(p.x);
  float frame = max(1.0 - smoothstep(0.02 - fw.y, 0.02 + fw.y, 0.575 - fz), 1.0 - smoothstep(0.02 - fw.x, 0.02 + fw.x, fx));
  frame = max(frame, 1.0 - smoothstep(0.03, 0.03 + fw.x, 1.15 - fx));
  b = max(b, frame);
  // below: 22 cm down, seen along the view ray
  vec2 u = p - v.xz / max(v.y, 0.05) * 0.22;
  vec3 under = vec3(0.006, 0.01, 0.012) * (0.6 + 0.6 * noise2(u * 3.0));
  float cond = exp(-pow((abs(u.x) - 0.42) / 0.035, 2.0));
  under += FLC * cond * 0.16 * (0.7 + 0.3 * sin(u.y * 1.3 - uTime * 0.8));
  under *= 1.0 - 0.8 * smoothstep(0.08, 0.0, abs(fract((-1.5 - u.y) / 2.3 + 0.5) - 0.5) * 2.3);   // cross beams
  vec3 top = hallLight(vWorld, vec3(0.0, 1.0, 0.0), v, vec3(0.2, 0.21, 0.22) * (0.75 + 0.4 * noise2(p * 7.0)), 0.3, 12.0);
  vec3 col = mix(under, top, b);
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// the plinths: dark polished tiles that mirror the vessels, a drain ring round each base; the kerb face with a thin light
const PLINTH = SHARED + LIT + `
float hitVessel(vec3 p, vec3 rd, vec2 a) {
  vec2 oc = p.xz - a; float A = max(dot(rd.xz, rd.xz), 1e-5); float B = dot(oc, rd.xz); float C = dot(oc, oc) - 0.36 * 0.36;
  float D = B * B - A * C; if (D < 0.0) return 0.0;
  float t = (-B - sqrt(D)) / A; if (t < 0.0) return 0.0;
  float y = p.y + rd.y * t;
  return smoothstep(G_BOT, G_BOT + 0.05, y) * smoothstep(F_TOP + 0.05, F_TOP - 0.05, y) * exp(-t * 0.5);
}
void main() {
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld); vec3 p = vWorld;
  if (n.y < 0.5) {   // kerb face
    vec3 alb = vec3(0.07, 0.08, 0.09);
    vec3 col = hallLight(p, n, v, alb, 0.2, 16.0) + vec3(0.45, 0.85, 0.8) * smoothstep(0.004, 0.0, abs(p.y - 0.026)) * 0.35;
    gl_FragColor = vec4(fogit(col), 1.0); return;
  }
  vec2 q = p.xz;
  float fi = floor((-1.5 - p.z) / 2.3 + 0.5); vec2 a = vec2(sign(p.x) * 1.75, -1.5 - fi * 2.3);
  vec2 t = vec2(p.x, p.z - a.y);
  vec2 e = abs(fract(t / 0.575 + 0.5) - 0.5) * 0.575;
  float seam = smoothstep(0.004, 0.0015, min(e.x, e.y));
  float dr = length(q - a);
  float ring = smoothstep(0.012, 0.004, abs(dr - 0.585));
  vec2 jit = (vec2(noise2(q * 9.0), noise2(q * 9.0 + 17.0)) - 0.5) * 0.05;
  vec3 rd = normalize(vec3(-v.x + jit.x, v.y, -v.z + jit.y));
  float refl = 0.0;
  for (int k = -1; k <= 1; k++) {
    float i = fi + float(k); if (i < -0.5 || i > 8.5) continue;
    vec2 aa = vec2(a.x, -1.5 - i * 2.3); vec2 bb = vec2(-a.x, aa.y);
    refl += hitVessel(p, rd, aa) * tankGlow(i, sign(a.x)) + hitVessel(p, rd, bb) * tankGlow(i, -sign(a.x)) * 0.8;
  }
  float fres = 0.12 + 0.88 * pow(1.0 - abs(v.y), 4.0);
  vec3 alb = vec3(0.05, 0.058, 0.064) * (0.85 + 0.3 * noise2(floor(t / 0.575) * 3.7));
  vec3 col = hallLight(p, n, v, alb, 0.4, 40.0);
  col += FLC * refl * fres * 0.55 * (1.0 - seam);
  col *= 1.0 - 0.6 * seam - 0.7 * ring;
  col *= 0.7 + 0.3 * smoothstep(0.52, 0.75, dr);   // dark under the base's rim
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// thick glass: mirrors the strips overhead and the row across, greener and denser at the edges where it is seen through
// its thickness, misted with droplets above the fluid, a faint film and runs below, the meniscus line. Drawn premultiplied.
const GLASS = SHARED + `
uniform float uBack;
float vesAt(float hz, float hy) {
  float iz = (-1.5 - hz) / 2.3; float ii = floor(iz + 0.5); float dz = (iz - ii) * 2.3;
  return smoothstep(0.38, 0.25, abs(dz)) * smoothstep(G_BOT, G_BOT + 0.1, hy) * smoothstep(F_TOP + 0.05, F_TOP - 0.1, hy) * step(-0.5, ii) * step(ii, 8.5);
}
void main() {
  vec3 n = normalize(vNormal); if (uBack > 0.5) n = -n;
  vec3 v = normalize(cameraPosition - vWorld); vec3 p = vWorld;
  float ndv = abs(dot(n, v));
  float fres = 0.05 + 0.95 * pow(1.0 - ndv, 5.0);
  vec3 r = reflect(-v, n);
  vec3 env = vec3(0.012, 0.016, 0.022);
  if (r.y > 0.05) {
    float t = (3.74 - p.y) / r.y; vec3 h = p + r * t;
    float ii = floor((-1.5 - h.z) / 2.3 + 0.5); float zc = -1.5 - ii * 2.3;
    env += vec3(0.8, 0.88, 1.0) * 1.6 * smoothstep(0.08, 0.03, abs(h.x)) * smoothstep(0.75, 0.68, abs(h.z - zc)) / (1.0 + t * 0.3);
  }
  if (abs(r.x) > 0.05) {
    float xo = -sign(p.x) * 1.39; float t = (xo - p.x) / r.x;
    if (t > 0.0) env += FLC * 0.7 * vesAt(p.z + r.z * t, p.y + r.y * t) / (1.0 + t * 0.4);
  }
  float y = p.y; float ang = vUv.x;
  float above = smoothstep(F_TOP - 0.004, F_TOP + 0.01, y);
  // droplets: one per cell where the hash says so, bigger above the fluid
  vec2 dq = vec2(ang * 150.0, y * 62.0); vec2 cell = floor(dq); vec2 fr = fract(dq) - 0.5;
  float h1 = hash2(cell + vec2(uBack * 31.0, 0.0)), h2 = hash2(cell + 7.3);
  vec2 off = (vec2(h2, hash2(cell + 3.1)) - 0.5) * 0.5;
  float drop = smoothstep(0.12 + 0.22 * h2, 0.04 + 0.12 * h2, length(fr - off)) * step(mix(0.82, 0.35, above), h1);
  float runs = smoothstep(0.78, 0.98, noise2(vec2(ang * 110.0, y * 1.2))) * smoothstep(0.6, 0.0, noise2(vec2(ang * 110.0, y * 9.0))) * (1.0 - above);
  float mist = above * (0.55 + 0.45 * noise2(vec2(ang * 60.0, y * 40.0)));
  float film = noise2(vec2(ang * 18.0, y * 6.0)) * 0.6 + 0.4 * noise2(vec2(ang * 70.0, y * 22.0));
  float grime = smoothstep(G_BOT + 0.15, G_BOT, y);
  float thick = smoothstep(0.42, 0.06, ndv);
  float edge = smoothstep(0.14, 0.04, ndv) * smoothstep(0.0, 0.04, ndv);
  float men = smoothstep(0.009, 0.0, abs(y - F_TOP - 0.003));
  vec2 ax = tankAxis(p.xz); float g = tankGlow(tankIdx(ax), sign(ax.x));
  vec3 lit = FLC * g * (1.0 - above * 0.55);          // the fluid's light behind the glass, scattered by what is on it
  vec3 col = env * fres + lit * (thick * 0.22 + drop * mix(0.2, 0.32, above) + runs * 0.12 + mist * 0.22 + film * 0.03) + vec3(0.75, 1.0, 0.95) * (edge * 0.35 + men * 0.5) * g;
  col *= 1.0 - grime * 0.5;
  float a = clamp(fres * 0.9 + thick * 0.4 + drop * 0.3 + mist * 0.3 + runs * 0.15 + film * 0.06 + grime * 0.35 + men * 0.4, 0.0, 0.92);
  float fk = fogk();
  gl_FragColor = vec4(col * (1.0 - fk) + pow(uFogC, vec3(0.4545)) * a * fk, a) * (uBack > 0.5 ? 0.6 : 1.0);
}`;
// the fluid, drawn on the far inside wall of its column: everything along the view ray through it, clouded and glowing
const FLUID = SHARED + `
void main() {
  vec2 ax = tankAxis(vWorld.xz); float g = tankGlow(tankIdx(ax), sign(ax.x));
  vec3 ro = cameraPosition; vec3 d = vWorld - ro; float t1 = length(d); vec3 rd = d / t1;
  float t0 = fluidEntry(ro, rd, ax);
  float L = max(t1 - t0, 0.0);
  vec3 m = ro + rd * (t0 + t1) * 0.5;
  vec3 em = fluidEm(m, ax, g);
  em *= 0.95 + 0.07 * sin(m.y * 18.0 - uTime * 0.6 + noise3(m * 6.0) * 4.0);   // faint slow bands of light rising
  float a = 1.0 - exp(-L * 1.6);
  float fk = fogk();
  vec3 col = em * a * 0.8;
  gl_FragColor = vec4(col * (1.0 - fk) + pow(uFogC, vec3(0.4545)) * a * fk, a * 0.82);
}`;
// the surface seen from below: silvered where the light turns back off it, rippling
const MENISCUS = SHARED + `
void main() {
  vec2 ax = tankAxis(vWorld.xz); float g = tankGlow(tankIdx(ax), sign(ax.x));
  vec3 v = normalize(cameraPosition - vWorld);
  vec2 q = vWorld.xz - ax;
  float rip = noise2(q * 40.0 + uTime * 0.3) * 0.6 + noise2(q * 90.0 - uTime * 0.5) * 0.4;
  float k = pow(1.0 - abs(v.y), 3.0);
  vec3 col = mix(FLC * 0.35, vec3(0.75, 0.97, 0.92), k * (0.6 + 0.4 * rip)) * g;
  col += vec3(0.8, 1.0, 0.95) * smoothstep(0.32, 0.338, length(q)) * 0.5 * g;
  float a = 0.25 + 0.55 * k;
  gl_FragColor = vec4(col * a * (1.0 - fogk()), a);
}`;
// the lamp under each column: a grille over a bright well
const LAMP = SHARED + `
void main() {
  vec2 ax = tankAxis(vWorld.xz); float g = tankGlow(tankIdx(ax), sign(ax.x));
  vec2 q = vWorld.xz - ax; float r = length(q) / R_F; float a = atan(q.y, q.x);
  float slots = step(0.5, fract(r * 7.0)) * step(0.18, abs(fract(a * 3.0 / 3.14159265) - 0.5) * 2.0) * step(r, 0.92) * step(0.12, r);
  vec3 col = mix(vec3(0.025, 0.032, 0.036), (FLC * 0.9 + 0.15) * (1.1 - r * 0.6), slots * 0.85) * g;
  col += FLC * smoothstep(0.12, 0.0, r) * 0.8 * g;
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// the small readout on each base: three lamps, a trace that beats, columns of marks
const PANEL = SHARED + `
void main() {
  vec2 ax = tankAxis(vWorld.xz); float i = tankIdx(ax); float s = sign(ax.x);
  float h = fract(sin(i * 7.7 + s * 3.3) * 437.58);
  vec2 u = vUv * vec2(2.14, 1.0);
  vec3 col = vec3(0.008, 0.012, 0.014);
  // lamps
  float l1 = smoothstep(0.075, 0.05, length(u - vec2(0.14, 0.72)));
  float l2 = smoothstep(0.075, 0.05, length(u - vec2(0.34, 0.72)));
  float l3 = smoothstep(0.075, 0.05, length(u - vec2(0.54, 0.72)));
  float sick = step(abs(i - 5.0), 0.1) * step(s, 0.0);
  col += vec3(1.0, 0.62, 0.18) * l1 * (0.25 + 0.75 * step(0.5, fract(uTime * 0.45 + h)));
  col += vec3(1.0, 0.18, 0.12) * l2 * mix(0.12 + 0.2 * step(0.75, h), 0.3 + 0.7 * step(0.5, fract(uTime * 1.6)), sick);
  col += vec3(0.4, 1.0, 0.85) * l3 * 0.7;
  // a beat: a flat line with a spike every so often, scrolling
  float x = u.x * 1.4 - uTime * 0.35 - h;
  float bt = fract(x * 1.5);
  float yb = 0.3 + 0.16 * exp(-pow((bt - 0.5) / 0.03, 2.0)) - 0.06 * exp(-pow((bt - 0.56) / 0.025, 2.0));
  yb += sick * 0.06 * (noise2(vec2(u.x * 20.0, uTime * 3.0)) - 0.5);
  col += vec3(0.4, 1.0, 0.8) * smoothstep(0.03, 0.008, abs(vUv.y - yb)) * step(u.x, 1.25) * 0.8;
  // marks
  vec2 c = vec2(floor((u.x - 1.35) / 0.12), floor(vUv.y / 0.14 + uTime * 0.2 * (0.5 + h)));
  float mk = step(1.33, u.x) * step(u.x, 2.05) * step(0.55, hash2(c + h * 9.0)) * step(0.25, fract((u.x - 1.35) / 0.12)) * step(0.3, fract(vUv.y / 0.14 + uTime * 0.2 * (0.5 + h)));
  col += vec3(0.95, 0.7, 0.3) * mk * 0.35;
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
const PREAMBLE_V = `
varying vec2 vUv; varying vec3 vPos; varying vec3 vWorld; varying vec3 vNormal; varying float vDepth;
uniform float uTime;
vec2 tankAxis(vec2 xz) { float i = clamp(floor((-1.5 - xz.y) / 2.3 + 0.5), 0.0, 8.0); return vec2(sign(xz.x) * 1.75, -1.5 - i * 2.3); }
float tankPh(vec2 ax) { return fract(sin(ax.x * 3.1 + ax.y * 17.3) * 43758.5453) * 6.2831853; }
// each form turns slowly on its cord and drifts a little
float sway(float ph) { return sin(uTime * 0.21 + ph) * 0.2 + sin(uTime * 0.083 + ph * 1.7) * 0.25; }
vec3 drift(float ph) { return vec3(sin(uTime * 0.29 + ph) * 0.006, sin(uTime * 0.47 + ph * 1.3) * 0.02, cos(uTime * 0.23 + ph) * 0.006); }
`;
const FORM_V = PREAMBLE_V + `
attribute float aK; attribute float aV;
varying float vK; varying float vV; varying vec2 vAx;
void main() {
  vUv = uv; vPos = position; vK = aK; vV = aV;
  mat4 m = modelMatrix * instanceMatrix;
  vec2 ax = tankAxis(m[3].xz); float ph = tankPh(ax); vAx = ax;
  float sw = sway(ph), c = cos(sw), s = sin(sw);
  vec3 p = position; p.xz = vec2(c * p.x + s * p.z, -s * p.x + c * p.z);
  vec3 nn = normal; nn.xz = vec2(c * nn.x + s * nn.z, -s * nn.x + c * nn.z);
  vec4 w = m * vec4(p, 1.0);
  w.xyz += drift(ph);
  vWorld = w.xyz; vNormal = normalize((m * vec4(nn, 0.0)).xyz);
  vec4 mv = viewMatrix * w; vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
// thin skin: pale, light coming through it reddened, veins over the cranium; dark lidded eyes; seen through the fluid
const SKIN_LIGHT = `
vec3 skinLit(vec3 base, vec3 n, vec3 v, vec2 ax, float g, float thin) {
  vec3 l = normalize(vec3(ax.x, G_BOT, ax.y) - vWorld);
  float ndl = dot(n, l);
  float wrap = max((ndl + 0.45) / 1.45, 0.0);
  float back = pow(max(-ndl, 0.0), 1.4);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 2.2);
  float top = max(n.y, 0.0) * 0.25;
  vec3 col = base * (FLC * 0.22 + vec3(0.9, 0.98, 0.95) * (wrap * 0.8 + top)) * g;
  col += vec3(0.95, 0.42, 0.36) * (back * 0.3 + rim * 0.32) * thin * g;
  return col;
}
vec3 throughFluid(vec3 col, vec2 ax, float g) {
  vec3 ro = cameraPosition; vec3 d = vWorld - ro; float t1 = length(d); vec3 rd = d / t1;
  float t0 = fluidEntry(ro, rd, ax);
  float L = max(t1 - t0, 0.0) * step(vWorld.y, F_TOP);
  float k = exp(-L * 1.5);
  return col * k + fluidEm(ro + rd * (t0 + t1) * 0.5, ax, g) * (1.0 - k) * 0.6;
}
`;
const FORM_F = SHARED + SKIN_LIGHT + `
varying float vK; varying float vV; varying vec2 vAx;
void main() {
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld);
  float g = tankGlow(tankIdx(vAx), sign(vAx.x));
  float n1 = 1.0 - abs(noise3(vPos * 42.0) * 2.0 - 1.0);
  float n2 = 1.0 - abs(noise3(vPos * 110.0 + 7.0) * 2.0 - 1.0);
  float vein = max(pow(n1, 26.0), pow(n2, 30.0) * 0.6) * vV;
  vec3 base = vec3(0.92, 0.77, 0.74) * (0.86 + 0.2 * noise3(vPos * 30.0));
  base = mix(base, vec3(0.45, 0.36, 0.62), vein * 0.55);
  vec3 col = skinLit(base, n, v, vAx, g, 1.0 - vein * 0.5);
  if (vK > 0.5) {
    vec3 l = normalize(vec3(vAx.x, G_BOT, vAx.y) - vWorld);
    col = vec3(0.05, 0.055, 0.08) * (0.6 + 0.6 * max(dot(n, l), 0.0)) * g;
    col += vec3(0.7, 0.95, 0.9) * pow(max(dot(reflect(-l, n), v), 0.0), 30.0) * 0.35 * g;
    col += vec3(0.3, 0.2, 0.4) * pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.3 * g;
  }
  gl_FragColor = vec4(fogit(throughFluid(col, vAx, g)), 1.0);
}`;
// the cord: a tube worked out in the vertex shader from the navel (moving with the form) to the port under the cap
const CORD_V = PREAMBLE_V + `
#define PORT_Y ${f4(PORT_Y)}
attribute vec3 aC;   // along (0 navel .. 1 port), angle round, which vessel
uniform vec3 uAt[18]; uniform mat3 uR[18]; uniform float uSc[18]; uniform vec4 uRt[18];
varying vec2 vAx; varying float vS;
void main() {
  int k = int(aC.z + 0.5);
  vec3 at = uAt[k]; vec2 ax = tankAxis(at.xz); float ph = tankPh(ax); vAx = ax;
  float sw = sway(ph), c = cos(sw), s = sin(sw), sc = uSc[k];
  vec3 dl = normalize(vec3(0.0, 0.08, 1.0)); dl.xz = vec2(c * dl.x + s * dl.z, -s * dl.x + c * dl.z);
  vec3 fw = uR[k] * dl;
  vec3 P0 = at + drift(ph), P3 = vec3(ax.x, PORT_Y, ax.y);
  vec3 side0 = normalize(vec3(fw.z, 0.0, -fw.x) + vec3(1e-4, 0.0, 0.0)); vec4 rt = uRt[k];
  vec3 P1 = P0 + (fw * rt.x + side0 * rt.y + vec3(0.0, 0.04, 0.0)) * sc;
  vec3 P2 = P0 + (fw * rt.z + side0 * rt.w) * sc + vec3(0.0, 0.45, 0.0);
  float t = aC.x, u = 1.0 - t;
  vec3 C = u * u * u * P0 + 3.0 * u * u * t * P1 + 3.0 * u * t * t * P2 + t * t * t * P3;
  vec3 T = normalize(3.0 * u * u * (P1 - P0) + 6.0 * u * t * (P2 - P1) + 3.0 * t * t * (P3 - P2));
  vec3 side = normalize(vec3(fw.z, 0.0, -fw.x) + vec3(1e-4, 0.0, 0.0));
  vec3 N = normalize(cross(T, side)); vec3 B = cross(T, N);
  C += side * sin(t * 8.0 + uTime * 0.6 + ph) * 0.012 * t * (1.0 - t) * 4.0;
  float r = (0.0052 + 0.0024 * u) * (0.7 + 0.3 * sc);
  vec3 nrm = cos(aC.y) * N + sin(aC.y) * B;
  vec3 w = C + nrm * r;
  vUv = vec2(t, aC.y / 6.2831853); vPos = vec3(t, aC.y, 0.0); vS = t;
  vWorld = w; vNormal = nrm;
  vec4 mv = viewMatrix * vec4(w, 1.0); vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const CORD_F = SHARED + SKIN_LIGHT + `
varying vec2 vAx; varying float vS;
void main() {
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld);
  float g = tankGlow(tankIdx(vAx), sign(vAx.x));
  float tw = vUv.y * 3.0 + vS * 26.0;
  float ves = smoothstep(0.32, 0.1, abs(fract(tw) - 0.5));
  vec3 base = mix(vec3(0.82, 0.84, 0.86), vec3(0.45, 0.32, 0.55), ves * 0.6);
  vec3 col = skinLit(base, n, v, vAx, g, 0.8);
  gl_FragColor = vec4(fogit(throughFluid(col, vAx, g)), 1.0);
}`;
// flecks hanging in the fluid, circling very slowly; and a thin stream of bubbles from one side of each lamp
const FLECK_V = `
attribute vec4 aP; attribute vec4 aQ;
uniform float uTime; uniform float uScale; uniform float uFogN; uniform float uFogF;
varying float vA;
void main() {
  float a = aP.z + uTime * aQ.y;
  float y = aQ.x + sin(uTime * 0.13 + aQ.z * 6.0) * 0.05;
  vec3 p = vec3(aP.x + cos(a) * aP.w, y, aP.y + sin(a) * aP.w);
  vec4 mv = viewMatrix * vec4(p, 1.0); float d = -mv.z;
  vA = (1.0 - smoothstep(uFogN, uFogF, d)) * smoothstep(0.25, 0.8, d) * (0.5 + 0.5 * sin(uTime * 0.7 + aQ.z * 40.0));
  gl_PointSize = max(aQ.w * uScale / max(d, 0.1), 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const FLECK_F = `
varying float vA;
void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.2, 1.0, r)) * vA; gl_FragColor = vec4(vec3(0.75, 0.92, 0.78) * a * 0.55, 1.0); }`;
const BUB_V = `
attribute vec4 aB;
uniform float uTime; uniform float uScale; uniform float uFogN; uniform float uFogF;
varying float vF;
void main() {
  float span = ${f4(F_TOP - G_BOT - 0.04)};
  float y = ${f4(PL + G_BOT + 0.02)} + mod(aB.z * span + uTime * aB.w, span);
  vec3 p = vec3(aB.x + position.x + sin(uTime * 3.0 + aB.z * 20.0) * 0.006, y, aB.y + position.z);
  vec4 mv = viewMatrix * vec4(p, 1.0); float d = -mv.z;
  vF = (1.0 - smoothstep(uFogN, uFogF, d)) * smoothstep(0.0, 0.08, y - ${f4(PL + G_BOT + 0.02)}) * (1.0 - smoothstep(${f4(PL + F_TOP - 0.06)}, ${f4(PL + F_TOP - 0.01)}, y));
  gl_PointSize = position.y * uScale / max(d, 0.1);
  gl_Position = projectionMatrix * mv;
}`;
const BUB_F = `
varying float vF;
void main() {
  vec2 p = gl_PointCoord - 0.5; float r = length(p) * 2.0;
  float rim = smoothstep(0.55, 0.85, r) * (1.0 - smoothstep(0.88, 1.0, r));
  float hl = 1.0 - smoothstep(0.0, 0.25, length(p - vec2(-0.15, -0.15)) * 2.0);
  gl_FragColor = vec4(vec3(0.7, 1.0, 0.92) * (rim * 0.6 + hl * 0.7) * vF, 1.0);
}`;

// ---- the hall ----
export function buildVesselHall(g, kit) {
  const { sm } = kit;
  const TOYU = { uToyP: { value: V(0, -50, 0) }, uToyI: { value: 0 } };
  const pxScale = () => kit.pxScale();
  const metal = (alb, gloss, spec, rib = 0) => sm(METAL, { ...TOYU, uAlb: { value: new THREE.Color(alb) }, uGloss: { value: gloss }, uSpec: { value: spec }, uRib: { value: rib } });
  const P = [];   // vessels: [x, z, row, side]
  for (let i = 0; i < ROWS; i++) for (const s of [-1, 1]) P.push([s * VX, VZ(i), i, s]);
  const N = P.length;
  const vesselM = (j) => M4(P[j][0], PL, P[j][1], 0, -P[j][3] * PI / 2, 0);   // local +z faces the aisle
  const inst = (geo, mat, count, f, order) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    for (let j = 0; j < count; j++) m.setMatrixAt(j, f(j));
    m.computeBoundingSphere(); if (order !== undefined) m.renderOrder = order; g.add(m); return m;
  };

  // walls, ceiling, end walls
  const wallM = sm(WALL, TOYU), L = Z0 - Z1, ZM = (Z0 + Z1) / 2;
  for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(L, HH), wallM); w.position.set(s * HW, HH / 2, ZM); w.rotation.y = -s * PI / 2; g.add(w); }
  { const c = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, L), wallM); c.rotation.x = PI / 2; c.position.set(0, HH, ZM); g.add(c); }
  for (const [z, ry] of [[Z1, 0], [Z0, PI]]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, HH), wallM); e.position.set(0, HH / 2, z); e.rotation.y = ry; g.add(e); }
  // aisle grating and the plinths either side
  { const f = new THREE.Mesh(new THREE.PlaneGeometry(2.3, L), sm(GRATE, TOYU)); f.rotation.x = -PI / 2; f.position.set(0, 0, ZM); g.add(f); }
  const plM = sm(PLINTH, TOYU);
  for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(HW - 1.15, PL, L), plM); b.position.set(s * (1.15 + HW) / 2, PL / 2, ZM); g.add(b); }

  // the hall's frame, merged into one mesh: ribs, niche frames, conduits, the manifolds and their hangers, strip housings
  const frame = [];
  {
    const sh = new THREE.Shape();
    sh.moveTo(-HW, 0); sh.lineTo(-HW, HH); sh.lineTo(HW, HH); sh.lineTo(HW, 0); sh.lineTo(2.28, 0); sh.lineTo(2.28, 2.48);
    sh.absarc(1.18, 2.48, 1.1, 0, PI / 2, false); sh.lineTo(-1.18, 3.58); sh.absarc(-1.18, 2.48, 1.1, PI / 2, PI, false); sh.lineTo(-2.28, 0); sh.lineTo(-HW, 0);
    const rib = new THREE.ExtrudeGeometry(sh, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2, curveSegments: 14 });
    rib.translate(0, 0, -0.11);
    for (let i = -2; i <= 8; i++) frame.push([rib, M4(0, 0, VZ(i) - 1.15)]);
    // a flat band down each rib's inner face, bolted
    const bolt = new THREE.CylinderGeometry(0.014, 0.014, 0.02, 6);
    for (let i = -2; i <= 8; i++) for (const s of [-1, 1]) for (let y = 0.3; y < 2.4; y += 0.42) frame.push([bolt, M4(s * 2.255, y, VZ(i) - 1.15 + 0.07, 0, 0, PI / 2)]);
    const conduit = (r) => new THREE.CylinderGeometry(r, r, L, 14, 1, true);
    for (const s of [-1, 1]) {
      frame.push([conduit(0.06), M4(s * 0.95, 3.46, ZM, PI / 2)], [conduit(0.04), M4(s * 1.13, 3.5, ZM, PI / 2)], [conduit(0.1), M4(s * 1.55, PL + 3.2, ZM, PI / 2)]);
    }
    const hang = new THREE.BoxGeometry(0.025, 0.28, 0.04), hangM = new THREE.BoxGeometry(0.03, 0.42, 0.05), clamp = new THREE.TorusGeometry(0.108, 0.013, 6, 20), clampS = new THREE.TorusGeometry(0.066, 0.01, 6, 16);
    const house = new THREE.BoxGeometry(0.24, 0.05, 1.56);
    for (let i = -1; i <= 8; i++) {
      const z = VZ(i);
      for (const s of [-1, 1]) {
        frame.push([hang, M4(s * 0.95, 3.66, z + 0.5)], [clampS, M4(s * 0.95, 3.46, z + 0.5)], [hangM, M4(s * 1.55, PL + 3.2 + 0.31, z + 0.45)], [clamp, M4(s * 1.55, PL + 3.2, z + 0.45)]);
      }
      frame.push([house, M4(0, 3.775, z)]);
    }
    // niche frames behind each vessel: two pilasters and a header against the wall
    const pil = new THREE.BoxGeometry(0.1, 3.0, 0.16), head = new THREE.BoxGeometry(1.4, 0.14, 0.2), foot = new THREE.BoxGeometry(1.4, 0.08, 0.12);
    for (let j = 0; j < N; j++) {
      const m = vesselM(j);
      frame.push([pil, m.clone().multiply(M4(0.64, 1.5 - PL, -0.67))], [pil, m.clone().multiply(M4(-0.64, 1.5 - PL, -0.67))], [head, m.clone().multiply(M4(0, 3.0 - PL, -0.66))], [foot, m.clone().multiply(M4(0, 0.04, -0.69))]);
      // the junction under the manifold where the hoses go in
      frame.push([new THREE.BoxGeometry(0.62, 0.1, 0.26), m.clone().multiply(M4(0, 3.07, 0.2))]);
    }
  }
  const frameM = metal(0x2e363d, 26, 0.38);
  g.add(new THREE.Mesh(mergeParts(frame), frameM));
  // the strips themselves, cold white
  const stripG = new THREE.BoxGeometry(0.1, 0.02, 1.4);
  inst(stripG, new THREE.MeshBasicMaterial({ color: 0xd2e0ff }), 10, (j) => M4(0, 3.745, VZ(j - 1)));

  // ---- vessel parts (vessel-local: y up from the plinth top, +z toward the aisle) ----
  const vparts = [];
  vparts.push([lathe([[0, 0], [0.5, 0], [0.52, 0.01], [0.52, 0.05], [0.5, 0.062], [0.47, 0.066], [0.47, 0.175], [0.458, 0.18], [0.458, 0.192], [0.47, 0.197], [0.47, 0.262], [0.445, 0.29], [0.41, 0.292], [0.41, 0.375], [0.398, 0.388], [0.366, 0.388], [0.366, 0.352], [0.34, 0.352], [0.34, 0.34], [0, 0.34]], 30), null]);
  vparts.push([lathe([[0, 1.958], [0.3, 1.958], [0.33, 1.95], [0.338, 1.95], [0.338, 1.99], [0.366, 1.99], [0.366, 1.95], [0.398, 1.948], [0.41, 1.96], [0.41, 2.04], [0.44, 2.045], [0.44, 2.09], [0.405, 2.1], [0.37, 2.13], [0.3, 2.15], [0.2, 2.18], [0.13, 2.19], [0.12, 2.24], [0.09, 2.25], [0, 2.25]], 30), null]);
  {
    const hex = new THREE.CylinderGeometry(0.011, 0.011, 0.012, 6);
    for (let k = 0; k < 12; k++) { const a = (k + 0.5) / 12 * PI * 2; vparts.push([hex, M4(Math.sin(a) * 0.49, 0.068, Math.cos(a) * 0.49)]); }
    for (let k = 0; k < 8; k++) { const a = k / 8 * PI * 2; vparts.push([hex, M4(Math.sin(a) * 0.382, 0.394, Math.cos(a) * 0.382)]); }
    for (let k = 0; k < 10; k++) { const a = (k + 0.5) / 10 * PI * 2; vparts.push([hex, M4(Math.sin(a) * 0.425, 2.1, Math.cos(a) * 0.425, 0.12 * Math.cos(a), 0, -0.12 * Math.sin(a))]); }
    const strut = new THREE.CylinderGeometry(0.011, 0.011, 1.56, 8);
    for (const a of [1.9, PI, PI * 2 - 1.9]) vparts.push([strut, M4(Math.sin(a) * 0.392, 1.168, Math.cos(a) * 0.392)]);
    const cup = new THREE.CylinderGeometry(0.028, 0.03, 0.05, 12);
    for (const x of [-0.13, 0.13]) vparts.push([cup, M4(x, 2.2, -0.04)]);
    vparts.push([new THREE.CylinderGeometry(0.016, 0.022, 0.06, 10), M4(0, 1.93, 0)]);                   // the port the cord hangs from
    vparts.push([new THREE.BoxGeometry(0.17, 0.095, 0.016), M4(0, 0.17, 0.47)]);                      // readout bezel
  }
  const baseG = mergeParts(vparts);
  inst(baseG, metal(0x56606a, 48, 0.75), N, vesselM);
  // rubber: gaskets top and bottom, hoses up to the manifold, cables out of the base back into the wall
  {
    const rp = [];
    const gask = new THREE.TorusGeometry(0.364, 0.0075, 4, 32); gask.rotateX(PI / 2);
    rp.push([gask, M4(0, 0.389, 0), {}, true], [gask, M4(0, 1.947, 0), {}, true]);
    const tube = (pts, r, seg = 20, rad = 8) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, rad, false);
    for (const sd of [-1, 1]) rp.push([tube([V(sd * 0.13, 2.22, -0.04), V(sd * 0.15, 2.55, -0.03), V(sd * 0.2, 2.85, 0.1), V(sd * 0.24, 3.03, 0.2)], 0.024), null]);
    rp.push([tube([V(0.0, 2.24, 0.0), V(0.03, 2.6, 0.06), V(0.0, 3.03, 0.18)], 0.009, 14, 5), null, {}, true]);
    rp.push([tube([V(0, 0.12, -0.45), V(0, 0.06, -0.6), V(0, 0.13, -0.72)], 0.03, 10), null]);
    rp.push([tube([V(0.13, 0.1, -0.43), V(0.15, 0.035, -0.58), V(0.19, 0.16, -0.72)], 0.018, 10, 6), null]);
    inst(mergeParts(rp), metal(0x262b31, 18, 0.4, 60), N, vesselM);
  }
  // lamp and readout
  { const lg = new THREE.CircleGeometry(R_F, 40); lg.rotateX(-PI / 2); lg.translate(0, 0.343, 0); inst(lg, sm(LAMP), N, vesselM); }
  { const pg = new THREE.PlaneGeometry(0.15, 0.07); pg.translate(0, 0.17, 0.4785); inst(pg, sm(PANEL), N, vesselM); }
  // glass (far wall, then fluid, then the surface, then the near wall), premultiplied
  const PM = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor };
  const glassG = new THREE.CylinderGeometry(R_GO, R_GO, G_TOP - G_BOT, 48, 1, true); glassG.translate(0, (G_TOP + G_BOT) / 2, 0);
  inst(glassG, sm(GLASS, { uBack: { value: 1 } }, { ...PM, side: THREE.BackSide }), N, vesselM, 1);
  const fluidG = new THREE.CylinderGeometry(R_F, R_F, F_TOP - G_BOT, 48, 1, true); fluidG.translate(0, (F_TOP + G_BOT) / 2, 0);
  inst(fluidG, sm(FLUID, {}, { ...PM, side: THREE.BackSide }), N, vesselM, 2);
  const menG = lathe([[0, F_TOP], [0.3, F_TOP + 0.001], [0.33, F_TOP + 0.004], [R_F, F_TOP + 0.01]], 40);
  inst(menG, sm(MENISCUS, {}, { ...PM, side: THREE.DoubleSide }), N, vesselM, 4);
  inst(glassG, sm(GLASS, { uBack: { value: 0 } }, PM), N, vesselM, 5);

  // ---- the forms and their cords ----
  const built = FORMS.map(formGeo);
  const formM = sm(FORM_F); formM.vertexShader = FORM_V;
  const slots = FORMS.map(() => []);
  const T = [];   // per vessel: { v, k, sc, yaw, tilt, mesh }
  let seed = 11; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let j = 0; j < N; j++) {
    const [x, z, i, s] = P[j], v = FORM_OF[i][s < 0 ? 0 : 1];
    const face = -s * PI / 2, yaw = face + (i >= 7 ? (rnd() - 0.5) * 0.6 : (rnd() - 0.5) * 2.6);
    T.push({ v, k: slots[v].length, sc: FORM_SCALE[v] * (0.92 + 0.16 * rnd()), yaw, tilt: (rnd() - 0.5) * 0.3, y: PL + 1.1 + (rnd() - 0.5) * 0.08, x, z });
    slots[v].push(j);
  }
  const q = new THREE.Quaternion(), e = new THREE.Euler(), mtx = new THREE.Matrix4(), cen = V(0, 0, 0), at = V(0, 0, 0);
  const pose = (t, yaw, tilt, qo, ato) => {
    e.set(tilt, yaw, 0, 'YXZ'); qo.setFromEuler(e);
    cen.copy(built[t.v].centre).multiplyScalar(t.sc).applyQuaternion(qo);
    return ato.set(t.x - cen.x - Math.sin(yaw) * 0.04, t.y - cen.y, t.z - cen.z - Math.cos(yaw) * 0.04);
  };
  const CU = { uAt: { value: Array.from({ length: N }, () => V(0, 0, 0)) }, uR: { value: Array.from({ length: N }, () => new THREE.Matrix3()) }, uSc: { value: new Array(N).fill(1) }, uRt: { value: Array.from({ length: N }, () => new THREE.Vector4()) } };
  const place = (j, yaw, tilt) => {
    const t = T[j];
    pose(t, yaw, tilt, q, at);
    mtx.compose(at, q, V(t.sc, t.sc, t.sc));
    t.mesh.setMatrixAt(t.k, mtx); t.mesh.instanceMatrix.needsUpdate = true;
    CU.uRt.value[j].fromArray(FORMS[t.v].rt); CU.uAt.value[j].copy(at); CU.uR.value[j].setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q)); CU.uSc.value[j] = t.sc;
  };
  const meshes = built.map((b, v) => { const m = new THREE.InstancedMesh(b.g, formM, slots[v].length); m.frustumCulled = false; g.add(m); return m; });   // they turn and drift in the shader
  for (let j = 0; j < N; j++) { T[j].mesh = meshes[T[j].v]; place(j, T[j].yaw, T[j].tilt); }
  {
    const SEG = 28, RAD = 6, pos = [], ac = [], idx = [];
    for (let j = 0; j < N; j++) {
      const b0 = pos.length / 3;
      for (let a = 0; a <= SEG; a++) for (let r = 0; r <= RAD; r++) { pos.push(0, 0, 0); ac.push(a / SEG, r / RAD * PI * 2, j); }
      for (let a = 0; a < SEG; a++) for (let r = 0; r < RAD; r++) { const p0 = b0 + a * (RAD + 1) + r, p1 = p0 + RAD + 1; idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1); }
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setAttribute('aC', new THREE.Float32BufferAttribute(ac, 3)); cg.setIndex(idx);
    const cm = sm(CORD_F, CU); cm.vertexShader = CORD_V;
    const cord = new THREE.Mesh(cg, cm); cord.frustumCulled = false; g.add(cord);
  }
  // low lucidity: look back and a form hangs turned another way, leaning another way, still on its cord
  for (let j = 0; j < N; j++) unsteady(T[j].mesh, (k) => {
    if (k) place(j, T[j].yaw + (1.2 + Math.random() * 2.4) * (Math.random() < 0.5 ? -1 : 1), (Math.random() - 0.5) * 0.6); else place(j, T[j].yaw, T[j].tilt);
  }, { r: 0.42, at: V(P[j][0], PL + 1.15, P[j][1]) });

  // flecks and bubbles
  {
    const NF = N * 34, ap = new Float32Array(NF * 4), aq = new Float32Array(NF * 4);
    for (let k = 0; k < NF; k++) {
      const p = P[k % N]; ap.set([p[0], p[1], Math.random() * PI * 2, 0.04 + Math.sqrt(Math.random()) * 0.27], k * 4);
      aq.set([PL + G_BOT + 0.08 + Math.random() * (F_TOP - G_BOT - 0.16), (Math.random() - 0.5) * 0.06, Math.random(), 0.003 + Math.random() * 0.004], k * 4);
    }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NF * 3), 3)); fg.setAttribute('aP', new THREE.BufferAttribute(ap, 4)); fg.setAttribute('aQ', new THREE.BufferAttribute(aq, 4));
    const fl = new THREE.Points(fg, new THREE.ShaderMaterial({ vertexShader: FLECK_V, fragmentShader: FLECK_F, uniforms: { uTime: kit.TIME, uScale: { value: pxScale() }, ...kit.FOGU }, ...kit.ADD }));
    fl.frustumCulled = false; fl.renderOrder = 3; g.add(fl);
    const NB = N * 9, bp = new Float32Array(NB * 3), bb = new Float32Array(NB * 4);
    for (let k = 0; k < NB; k++) {
      const j = k % N, p = P[j], a = (j * 2.4) % (PI * 2), r = 0.26 + Math.random() * 0.03;
      bp.set([Math.cos(a) * r + (Math.random() - 0.5) * 0.02, 0.006 + Math.random() * 0.012, Math.sin(a) * r + (Math.random() - 0.5) * 0.02], k * 3);
      bb.set([p[0], p[1], Math.random(), 0.1 + Math.random() * 0.12], k * 4);
    }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(bp, 3)); bg.setAttribute('aB', new THREE.BufferAttribute(bb, 4));
    const bub = new THREE.Points(bg, new THREE.ShaderMaterial({ vertexShader: BUB_V, fragmentShader: BUB_F, uniforms: { uTime: kit.TIME, uScale: { value: pxScale() }, ...kit.FOGU }, ...kit.ADD }));
    bub.frustumCulled = false; bub.renderOrder = 3; g.add(bub);
  }
  return { toyU: TOYU, forms: { T, meshes, CU, place, built, pose }, frameM };
}
