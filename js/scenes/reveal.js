// The reveal: the nursery, the child, the toy, and three memories it brings back. Only reached if the toy was taken.
//
// Every set lives in this one scene (nursery, the end of the containers hall, the classroom, the pale room) and only one
// is shown at a time, so their shaders compile once under the opening white. The whole scene is drawn through one
// full-screen pass (E.draw): in the present it only adds the toy's bloom; in a memory it turns the frame warm, soft and
// milky, with a drifting second image, grain and edges that come apart (POST_F). Because the scene is drawn into an sRGB
// render target, standard materials write linear light there; the shared shaders from ship.js write display values, so
// each one is converted (lin) to match.
import { THREE, E, G, on, wait, until, tween, lerp, say, hint, fade, note, choose, setView, moveView, aimAt, lookToward,
  lookingAt, warm } from '../engine.js';
import { A } from '../audio.js';
import { makeGrey, makeMantis, idleMantis, makeHuman, idleHuman, makePlayerBody, aimGrey, clearGreyArm, gripGrey,
  makeGreyWig, makeGreyShift, SHIFT_SEAT, humanGaze } from '../models.js';
import { KNOWN_KID, KIT, seatKnownKid, clearLap } from './ship.js';
import { buildVesselHall } from './vessels.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const sm3 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });

// ---------- drawing ----------
// display value to linear light, appended to every scene shader written for the screen (see the top of the file)
const S2L = 'vec3 s2l(vec3 c) { c = max(c, 0.0); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }\n';
function lin(mat) { mat.fragmentShader = S2L + mat.fragmentShader.replace(/\}\s*$/, '  gl_FragColor.rgb = s2l(gl_FragColor.rgb);\n}'); return mat; }
const smL = (frag, u = {}, o = {}) => lin(KIT.sm(frag, u, o));

const POST_V = `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// uMem 0 = the present (the frame as drawn, plus the toy's bloom); 1 = a memory. In a memory: the frame swims a little;
// it is softened by a ring of taps that widens toward the edges, where it also comes apart into a warm haze through moving
// noise; a second, fainter copy of the frame drifts over it; highlights bleed; the colour goes warm and milky; grain.
// uBloom: light from the toy at uAt (screen 0..1) swelling to fill the view.
const POST_F = `
uniform sampler2D tScene; uniform vec2 uRes; uniform float uMem; uniform float uTime; uniform float uBloom; uniform vec2 uAt; uniform float uDim;
varying vec2 vUv;
float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
vec3 l2s(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  float asp = uRes.x / uRes.y;
  vec3 col;
  float m = uMem;
  if (m < 0.002) col = texture2D(tScene, vUv).rgb;
  else {
    vec2 c = vUv - 0.5; float r = length(c * vec2(asp, 1.0));
    vec2 sw = vec2(vn(vUv * 3.0 + vec2(uTime * 0.11, 0.0)), vn(vUv * 3.0 + vec2(7.0, uTime * 0.09))) - 0.5;
    vec2 uv = vUv + (sw * 0.007 * (0.35 + r) + vec2(sin(uTime * 0.23), cos(uTime * 0.19)) * 0.0025) * m;
    float rad = (0.0022 + 0.014 * smoothstep(0.15, 0.75, r)) * m;
    vec3 sharp = texture2D(tScene, uv).rgb, blur = vec3(0.0);
    for (int i = 0; i < 8; i++) { float an = float(i) * 0.7853982 + 0.39; blur += texture2D(tScene, uv + vec2(cos(an) / asp, sin(an)) * rad).rgb; }
    blur *= 0.125;
    col = mix(sharp, blur, 0.45 + 0.5 * smoothstep(0.2, 0.7, r));
    vec2 dd = vec2(sin(uTime * 0.41), sin(uTime * 0.29 + 1.3)) * 0.009 + vec2(0.007, -0.004);
    vec3 ghost = texture2D(tScene, (uv - 0.5) * 0.982 + 0.5 + dd * m).rgb;
    col = mix(col, ghost, 0.32 * m);
    col += max(blur - 0.3, 0.0) * vec3(1.0, 0.78, 0.5) * 0.9 * m;
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, lum * vec3(1.3, 0.97, 0.66), 0.45 * m);
    col = col * (1.0 - 0.12 * m) + vec3(0.035, 0.021, 0.01) * m;
    float e = r + (vn(vUv * 4.0 + vec2(uTime * 0.07, -uTime * 0.05)) - 0.5) * 0.32 + (vn(vUv * 13.0 - uTime * 0.06) - 0.5) * 0.09;
    float edge = smoothstep(0.4, 0.85, e);
    col = mix(col, blur * 0.75 + vec3(0.1, 0.07, 0.04), edge * 0.88 * m);
  }
  col *= uDim;   // (linear, before l2s) the whole room dimming (the wig memory's light softening), lamp, walls, figures and doorway alike
  vec3 s = l2s(col);
  if (m > 0.002) s += (h21(gl_FragCoord.xy + fract(uTime * 7.13) * vec2(97.0, 331.0)) - 0.5) * 0.075 * m;
  if (uBloom > 0.001) {
    float d = length((vUv - uAt) * vec2(asp, 1.0));
    float b = uBloom;
    float glow = exp(-d * d / (0.004 + 0.5 * b * b)) * b * 1.6 + smoothstep(0.7, 1.0, b);
    s = mix(s, vec3(1.0, 0.95, 0.85), clamp(glow, 0.0, 1.0));
  }
  gl_FragColor = vec4(s, 1.0);
}`;
// The scene drawn into a multisampled sRGB target, then through POST_F onto the screen. A full-screen triangle that
// ignores every camera matrix, so a test driver that swaps the camera (tools/shot.js view) cannot move it.
function memoryPass() {
  const r = E.renderer, size = new THREE.Vector2();
  r.getDrawingBufferSize(size);
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { colorSpace: THREE.SRGBColorSpace, samples: 4 });
  const U = { tScene: { value: rt.texture }, uRes: { value: size.clone() }, uMem: { value: 0 }, uTime: KIT.TIME, uBloom: { value: 0 }, uAt: { value: new THREE.Vector2(0.5, 0.5) }, uDim: { value: 1 } };
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mat = new THREE.ShaderMaterial({ vertexShader: POST_V, fragmentShader: POST_F, uniforms: U, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(geo, mat); quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const draw = () => {
    r.getDrawingBufferSize(size);
    if (size.x !== rt.width || size.y !== rt.height) { rt.setSize(size.x, size.y); U.uRes.value.copy(size); }
    r.setRenderTarget(rt); r.render(E.scene, E.camera); r.setRenderTarget(null); r.render(scene, cam);
  };
  draw.dispose = () => { rt.dispose(); geo.dispose(); mat.dispose(); };
  draw.rt = rt;
  E.draw = draw;
  return U;
}

// ---------- the nursery's surfaces ----------
// tufted padding, diamond-quilted: each cell a soft pillow, a button where four meet; lit by the cradle and the cove
const N_FLOOR = `
void main() {
  vec2 p = vWorld.xz; float r = length(p);
  vec2 q = vec2(p.x + p.y, p.x - p.y) * 0.7071 / 0.42;
  vec2 f = fract(q) - 0.5; vec2 id = floor(q);
  float d = length(f * vec2(1.0, 1.0)) * 1.25;
  float puff = 1.0 - d * d;
  float btn = smoothstep(0.09, 0.03, length(fract(q + 0.5) - 0.5));
  vec3 col = vec3(0.8, 0.68, 0.58) * (0.97 + 0.05 * hash2(id));
  col *= 0.8 + 0.22 * puff - 0.18 * btn;
  col *= 0.95 + 0.05 * (noise2(q * 2.3 + 4.0) - 0.5);
  col *= 0.93 + 0.07 * noise2(p * 55.0) + 0.03 * noise2(p * 7.0);
  vec2 cr = p - vec2(0.0, -1.9);
  float pool = exp(-dot(cr, cr) * 0.42), cove = smoothstep(2.4, 3.2, r);
  col *= 0.26 + 0.8 * pool + 0.4 * cove;
  col += vec3(0.16, 0.09, 0.03) * pool * puff * 0.3;
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// padded ribs round the wall, tied in at two heights; washed with warm light from a hidden strip at its foot; an arched door
const N_WALL = `
void main() {
  float y = vWorld.y; float th = atan(vWorld.x, -vWorld.z);
  if (vWorld.z > 2.0 && archSD(vec2(vWorld.x, y), 0.56, 2.05) < 0.0) discard;
  float f = fract(th / 6.2831853 * 72.0) - 0.5;
  float puff = sqrt(max(0.0, 1.0 - 4.0 * f * f));
  vec3 col = mix(vec3(0.5, 0.32, 0.28), vec3(0.8, 0.6, 0.5), puff);
  float pinch = exp(-pow((y - 0.95) * 10.0, 2.0)) + exp(-pow((y - 1.75) * 10.0, 2.0));
  col *= 1.0 - 0.22 * pinch * (1.0 - 0.5 * puff);
  col *= 0.93 + 0.07 * noise2(vec2(th * 160.0, y * 60.0));
  col *= 0.13 + 0.95 * exp(-y * 1.5) + 0.1 * smoothstep(1.2, 2.2, y);
  col += vec3(0.4, 0.22, 0.08) * exp(-y * 9.0) * 0.55;
  float fr = archSD(vec2(vWorld.x, y), 0.56, 2.05);
  col += vec3(0.25, 0.18, 0.35) * smoothstep(0.12, 0.0, abs(fr)) * step(2.0, vWorld.z) * 0.5;
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// the low dome: soft rings, darker toward its rim, a dim rose lamp at the crown
const N_CEIL = `
void main() {
  float rr = length(vWorld.xz) / 3.2;
  vec3 col = vec3(0.34, 0.22, 0.2) * (0.45 + 0.55 * smoothstep(1.0, 0.1, rr));
  float rings = pow(0.5 + 0.5 * cos(rr * 44.0), 10.0) * smoothstep(0.22, 0.32, rr);
  col *= 1.0 - 0.15 * rings;
  col += vec3(0.55, 0.32, 0.22) * exp(-rr * rr * 28.0) * 0.7;
  col *= 0.88 + 0.12 * noise2(vWorld.xz * 18.0);
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// the doorway's passage: dim, cooler, fading out
const N_PASS = `
void main() {
  float k = smoothstep(5.6, 3.2, vWorld.z);
  vec3 col = vec3(0.16, 0.11, 0.2) * k * (0.8 + 0.2 * noise2(vWorld.xy * 9.0 + vWorld.z * 3.0));
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// nacre: the cradle's shell
const NACRE = KIT.PEARL + `
void main() {
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld);
  float ndv = abs(dot(n, v)), fres = pow(1.0 - ndv, 3.0);
  vec3 col = vec3(0.86, 0.74, 0.66) * (0.35 + 0.4 * ndv) * (0.85 + 0.15 * noise3(vWorld * 30.0));
  col += pearl(fres, vWorld.y * 0.6 + uTime * 0.02) * fres * 0.35;
  col += vec3(0.5, 0.32, 0.14) * smoothstep(0.35, 0.58, vWorld.y) * 0.3;
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// the cradle of light: a slow, folding glow inside the shell
const CRADLE = `
uniform float uAmt;
void main() {
  vec3 n = normalize(vNormal); vec3 v = normalize(cameraPosition - vWorld);
  float ndv = abs(dot(n, v));
  float sw = noise3(vPos * 5.0 + vec3(0.0, uTime * 0.16, uTime * 0.05)) * 0.6 + noise3(vPos * 11.0 - vec3(uTime * 0.09)) * 0.4;
  vec3 col = vec3(1.0, 0.76, 0.48) * pow(ndv, 1.4) * (0.35 + 0.8 * sw * sw) * uAmt;
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------- the pale room's surfaces (the third memory) ----------
const P_WALL = `
void main() {
  vec3 n = normalize(vNormal);
  vec2 p = abs(n.x) > 0.5 ? vWorld.zy : vWorld.xy;
  vec3 col = vec3(0.93, 0.86, 0.86);
  float seam = smoothstep(0.006, 0.0, abs(fract(p.x / 1.2 + 0.5) - 0.5) * 1.2);
  col *= 1.0 - 0.06 * seam;
  col *= 0.94 + 0.04 * noise2(p * 3.0) + 0.02 * noise2(p * 40.0);
  col *= 0.42 + 0.58 * exp(-pow(length(vWorld - vec3(0.0, 2.3, -0.2)) * 0.42, 2.0));
  col *= 0.8 + 0.2 * smoothstep(0.0, 0.4, vWorld.y);
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
const P_FLOOR = `
void main() {
  vec2 p = vWorld.xz;
  vec3 col = vec3(0.88, 0.8, 0.79) * (0.95 + 0.05 * noise2(p * 6.0) + 0.02 * noise2(p * 60.0));
  col *= 0.4 + 0.6 * exp(-dot(p - vec2(0.0, -0.2), p - vec2(0.0, -0.2)) * 0.22);
  gl_FragColor = vec4(fogit(col), 1.0);
}`;
// the round lamp in the ceiling: uSoft spreads and dims it (the light softening as you lie back)
const P_LAMP = `
uniform float uSoft;
void main() {
  float r = length(vPos.xy) / 0.42;
  float core = smoothstep(1.0 - 0.6 * uSoft, 0.55 - 0.5 * uSoft, r);
  vec3 col = vec3(1.0, 0.9, 0.9) * mix(1.25, 0.7, uSoft) * core + vec3(0.95, 0.82, 0.84) * (1.0 - core) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`;
const P_GLOW = `
uniform float uAmt;
void main() {
  float r = length(vPos.xy);
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.86) * exp(-r * r * 6.0) * uAmt, 1.0);
}`;
// the light in the passage beyond the doorway: brighter than the room, so whoever stands in it is half a silhouette
const P_BEYOND = `
void main() {
  float k = exp(-pow((vWorld.y - 1.2) * 0.9, 2.0));
  gl_FragColor = vec4(vec3(1.0, 0.93, 0.9) * (0.75 + 0.25 * k), 1.0);
}`;

// a box with rounded edges (cushions, the couch)
function softBox(w, h, d, r, seg = 6) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg), p = g.attributes.position, v = V(0, 0, 0), c = V(0, 0, 0);
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
    v.sub(c); if (v.lengthSq() > 1e-12) v.setLength(r); v.add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
// woven upholstery: a fine twill and a little slub, as a colour map
function clothTex(base) {
  return KIT.canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const s = ((x + y) >> 1) % 4 < 2 ? 0.05 : -0.04; g.fillStyle = s > 0 ? `rgba(255,255,255,${s})` : `rgba(0,0,0,${-s})`; g.fillRect(x, y, 2, 2); }
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.04})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 10, 1); }
  });
}

// ---------- people and greys ----------
// A person's arm (makeHuman) carried so the end of the hand reaches a world point: a two-bone solve (upper arm, then the
// forearm and hand as one), the elbow bent toward a pole that points out from the body, down and a little back, so the
// elbow swings out to the side, as a child's does, rather than the upper arm crossing the chest. The elbow is a hinge
// (the forearm only turns about its own x). Then the arm is kept out of the body: points along the upper arm, at the
// elbow and along the forearm (each with the arm's thickness) are tested against the torso (a rounded box fitted to the
// chest mesh) and the head (a ball); while any is inside, the pole is swung further out and the arm solved again. A last
// pass corrects for the hand not lying exactly on the forearm's line. st keeps nothing between calls (the solve is
// closed-form); returns how far the end of the hand is from the target.
const _kp = V(0, 0, 0), _ka = V(0, 0, 0), _kd = V(0, 0, 0), _ke = V(0, 0, 0), _kt = V(0, 0, 0), _kc = V(0, 0, 0), _kn = V(0, 0, 0), _kx = V(0, 0, 0), _ko = V(0, 0, 0), _kq = new THREE.Quaternion(), _kq2 = new THREE.Quaternion(), _km0 = new THREE.Matrix4(), _km1 = new THREE.Matrix4();
function armRig(kid, side) {
  const u = kid.userData, key = 'rig' + side;
  if (u[key]) return u[key];
  const arm = u['arm' + side], fore = u['fore' + side], wr = u['wrist' + side], hm = wr.children.find((c) => c.isMesh);
  if (!hm.userData.tip) { hm.geometry.computeBoundingBox(); const b = hm.geometry.boundingBox; hm.userData.tip = V((b.min.x + b.max.x) / 2, b.min.y + 0.012, (b.min.z + b.max.z) / 2); }
  // rest lengths and directions, in the arm's and forearm's own frames (model units: the person's scale is applied after)
  const qa = arm.quaternion.clone(), qf = fore.quaternion.clone(), qw = wr.quaternion.clone();
  fore.quaternion.identity(); wr.quaternion.identity(); kid.updateMatrixWorld(true);
  const tipF = fore.worldToLocal(hm.localToWorld(hm.userData.tip.clone()));
  arm.quaternion.copy(qa); fore.quaternion.copy(qf); wr.quaternion.copy(qw); kid.updateMatrixWorld(true);
  const u0 = fore.position.clone().normalize(), x0 = V(1, 0, 0).addScaledVector(u0, -u0.x).normalize();
  const r0 = new THREE.Matrix4().makeBasis(x0, u0, V(0, 0, 0).crossVectors(x0, u0));
  // the body to keep clear of: the torso mesh's box (chest frame) and the head's ball (head frame), and the arm's thickness
  const tm = u.chest.children[0]; tm.geometry.computeBoundingBox(); const tb = tm.geometry.boundingBox;
  const hs = u.head.children[0]; hs.geometry.computeBoundingSphere();
  const am = arm.children.find((c) => c.isMesh); am.geometry.computeBoundingBox(); const ab = am.geometry.boundingBox;
  const R = { arm, fore, wr, hm, tipF, L1: fore.position.length(), L2: tipF.length(), wrF: wr.position.clone(), L2w: wr.position.length(), r0, u0, x0, tc: tb.getCenter(V(0, 0, 0)), th: tb.getSize(V(0, 0, 0)).multiplyScalar(0.5), hc: hs.geometry.boundingSphere.center.clone(), hr: hs.geometry.boundingSphere.radius, thick: 0.5 * Math.min(ab.max.x - ab.min.x, ab.max.z - ab.min.z) };
  u[key] = R;
  return R;
}
// how far a world point (with radius r, model units) is inside the person's torso or head; 0 when clear
function bodyDepth(kid, R, p) {
  const u = kid.userData, s = kid.scale.x, r = R.thick;
  const c = u.chest.worldToLocal(_ko.copy(p)).sub(R.tc);
  const e = Math.pow(Math.abs(c.x) / (R.th.x + r), 4) + Math.pow(Math.abs(c.y) / (R.th.y + r), 4) + Math.pow(Math.abs(c.z) / (R.th.z + r), 4);
  let d = e < 1 ? (1 - Math.pow(e, 0.25)) * Math.min(R.th.x, R.th.z) : 0;
  const h = u.head.worldToLocal(_ko.copy(p)).sub(R.hc).length();
  if (h < R.hr + r) d = Math.max(d, R.hr + r - h);
  return d * s;
}
function armSolve(kid, R, S, T, pole, toWrist = false) {
  const s = kid.scale.x, L1 = R.L1 * s, L2 = (toWrist ? R.L2w : R.L2) * s, rd = toWrist ? R.wrF : R.tipF;
  _kd.subVectors(T, S); let D = _kd.length(); _kd.divideScalar(D || 1);
  D = Math.min(Math.max(D, Math.abs(L1 - L2) + 1e-4), L1 + L2 - 1e-4);
  const ca = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  _kn.copy(pole).addScaledVector(_kd, -pole.dot(_kd)).normalize();
  _ke.copy(S).addScaledVector(_kd, L1 * ca).addScaledVector(_kn, L1 * sa);                 // the elbow
  _ka.subVectors(_ke, S).normalize();                                                      // upper arm
  _kc.copy(S).addScaledVector(_kd, D).sub(_ke).normalize();                                // forearm and hand
  _kx.copy(_kc).addScaledVector(_ka, -_kc.dot(_ka));
  if (_kx.lengthSq() < 1e-8) _kx.copy(_kn).negate();                                       // straight: bend toward the pole's far side
  _kx.normalize().cross(_ka);                                                              // the hinge axis
  _km1.makeBasis(_kx, _ka, _kt.crossVectors(_kx, _ka));
  _kq.setFromRotationMatrix(_km1.multiply(_km0.copy(R.r0).transpose()));                  // the arm's world turn
  R.arm.parent.getWorldQuaternion(_kq2).invert(); R.arm.quaternion.copy(_kq2.multiply(_kq));
  R.fore.rotation.set(-Math.acos(Math.max(-1, Math.min(1, _ka.dot(_kc)))) + Math.atan2(rd.z, -rd.y), 0, 0);
  R.arm.updateMatrixWorld(true);
  return _ke;
}
// toWrist: the target is the wrist's pivot (the hand is then turned by the caller), not the end of the hand
function kidArm(kid, side, target, st = {}, toWrist = false) {
  const R = armRig(kid, side), sg = side === 'L' ? 1 : -1, S = R.arm.getWorldPosition(V(0, 0, 0));
  // the pole: out from the body's middle, down, a little back (in the chest's frame, so it turns with the body)
  const u = kid.userData; u.chest.updateMatrixWorld(true); u.chest.getWorldQuaternion(_kq);
  const out = V(0, 0, 0).subVectors(S, u.chest.localToWorld(R.tc.clone())); out.addScaledVector(V(0, 1, 0).applyQuaternion(_kq), -out.dot(V(0, 1, 0).applyQuaternion(_kq))).normalize();
  if (!isFinite(out.x)) out.set(-sg, 0, 0).applyQuaternion(_kq);
  const down = V(0, -1, 0).applyQuaternion(_kq), back = V(0, 0, -1).applyQuaternion(_kq);
  const T = target.clone(), pole = V(0, 0, 0), tip = V(0, 0, 0), p = V(0, 0, 0);
  let outK = st.out ?? 0.8, hit = 0;
  for (let tries = 0; tries < 8; tries++) {
    pole.copy(out).multiplyScalar(outK).addScaledVector(down, 0.7).addScaledVector(back, 0.25).normalize();
    for (let it = 0; it < 3; it++) {   // aim the hand's end (or the wrist), not the forearm's line
      armSolve(kid, R, S, T, pole, toWrist);
      if (toWrist) R.wr.getWorldPosition(tip); else R.hm.localToWorld(tip.copy(R.hm.userData.tip));
      T.add(_kt.subVectors(target, tip));
    }
    armSolve(kid, R, S, T, pole, toWrist);
    // clear of the body? points along the upper arm (past the shoulder's own joint), the elbow, along the forearm
    const E = _ke.clone(); R.wr.getWorldPosition(p); const W = p.clone(); hit = 0;
    for (const t of [0.45, 0.7, 1]) hit = Math.max(hit, bodyDepth(kid, R, p.lerpVectors(S, E, t)));
    for (const t of [0.35, 0.7, 1]) hit = Math.max(hit, bodyDepth(kid, R, p.lerpVectors(E, W, t)));
    if (hit <= 0) break;
    outK += 0.8;
  }
  st.out = Math.max(0.8, outK - 0.2); st.hit = hit;
  if (toWrist) R.wr.getWorldPosition(tip); else R.hm.localToWorld(tip.copy(R.hm.userData.tip));
  return tip.distanceTo(target);
}
// a person's arm pose (the shoulder's turn and the elbow's bend), to blend between
const armPose = (kid, side) => { const u = kid.userData; return { q: u['arm' + side].quaternion.clone(), f: u['fore' + side].rotation.x }; };
const setArmPose = (kid, side, a, b = null, k = 1) => {
  const u = kid.userData, arm = u['arm' + side], fore = u['fore' + side];
  if (b) { arm.quaternion.slerpQuaternions(a.q, b.q, k); fore.rotation.set(lerp(a.f, b.f, k), 0, 0); } else { arm.quaternion.copy(a.q); fore.rotation.set(a.f, 0, 0); }
};
const eulerPose = (x, z, f) => ({ q: new THREE.Quaternion().setFromEuler(new THREE.Euler(x, 0, z)), f });
// a person's head turned toward a world point (neck yaw and pitch, limited)
const _hv = V(0, 0, 0), _hq = new THREE.Quaternion();
function lookHuman(h, target, amt = 1, tilt = 0) {
  const u = h.userData; u.neck.getWorldPosition(_hv); _hv.subVectors(target, _hv);
  h.getWorldQuaternion(_hq).invert(); _hv.applyQuaternion(_hq);
  u.neck.rotation.y = Math.max(-1.1, Math.min(1.1, Math.atan2(_hv.x, _hv.z))) * amt;
  u.neck.rotation.x = Math.max(-0.6, Math.min(0.6, -Math.atan2(_hv.y, Math.hypot(_hv.x, _hv.z)))) * amt + tilt;
}
// the lips of a person's head (makeHuman puts them fifth), opened about their own middle: k 0 shut .. 1 a word's widest
function mouthOf(h) {
  const m = h.userData.head.children[4]; m.geometry.computeBoundingBox();
  const c = m.geometry.boundingBox.getCenter(V(0, 0, 0));
  return (k) => { m.scale.set(1 - 0.12 * k, 1 + 0.9 * k, 1 + 0.15 * k); m.position.set(c.x * (1 - m.scale.x), c.y * (1 - m.scale.y) - 0.0015 * k, c.z * (1 - m.scale.z)); };
}
// a grey seated on a seat whose top is SHIFT_SEAT up its own frame (thighs level, knees bent: the shift is cut for this)
function seatGrey(g) { const u = g.userData; u.legL.rotation.set(-1.45, 0, 0); u.legR.rotation.set(-1.45, 0, 0); u.kneeL.rotation.x = u.kneeR.rotation.x = 1.35; }
// leaning from the hips, turned at the waist by twist, then forward by L and over to the right by roll, about the middle
// of the hips, with the thighs held where they were (the exam lean, seated, with a turn and a sideways part)
const _lq = new THREE.Quaternion(), _lq2 = new THREE.Quaternion(), _le = new THREE.Euler(), _lp = V(0, 0, 0);
const LEG0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.45, 0, 0));
function leanSeated(g, L, roll = 0, twist = 0) {
  const u = g.userData; _lq.setFromEuler(_le.set(L, twist, -roll, 'YXZ'));
  u.root.quaternion.copy(_lq);
  _lp.set(0, 0.36, 0).applyQuaternion(_lq); u.root.position.set(-_lp.x, 0.36 - _lp.y, -_lp.z);
  _lq2.copy(_lq).invert().multiply(LEG0); u.legL.quaternion.copy(_lq2); u.legR.quaternion.copy(_lq2);
}
// a grey's head turned toward a world point in the frame of its (possibly leaning) body
// (the neck takes the yaw and up to 0.6 of the pitch; the head tips on the neck for the rest, up to 0.6 more)
function aimLeaning(g, target, amt = 1) {
  const u = g.userData; u.root.updateMatrixWorld(true);
  const p = u.root.worldToLocal(_hv.copy(target)).sub(u.neck.position);
  const pitch = Math.atan2(-p.y, Math.hypot(p.x, p.z)), np = Math.max(-0.6, Math.min(0.6, pitch));
  u.neck.rotation.set(np * amt, Math.max(-1.1, Math.min(1.1, Math.atan2(p.x, p.z))) * amt, 0);
  u.head.rotation.x = Math.max(-0.6, Math.min(0.6, pitch - np)) * amt;
}
// a grey's hand placed by its fingertips: palm facing along palmN (world), fingers along fdir, the arm solved round it with
// the body as collision volume (clearGreyArm); the wrist target is corrected by where the fingertips land, warm-started
const _gw = {}, _gt = V(0, 0, 0), _gx = V(0, 0, 0), _gy = V(0, 0, 0), _gz = V(0, 0, 0), _gm = new THREE.Matrix4(), _gqw = new THREE.Quaternion(), _gqp = new THREE.Quaternion();
function tipOf(g, side) {
  const t = g.userData['tips' + side], m = t.children.find((c) => c.isMesh);
  if (!m.userData.end) { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; m.userData.end = V((b.min.x + b.max.x) / 2, b.min.y + 0.004, (b.min.z + b.max.z) / 2); }
  return m.localToWorld(_gt.copy(m.userData.end));
}
function greyHand(g, side, tip, palmN, fdir, poleDir, curl, iters = 3) {
  const u = g.userData, hd = u['hand' + side], key = g.uuid + side;
  _gx.copy(palmN).multiplyScalar(side === 'R' ? -1 : 1).normalize();
  _gy.copy(fdir).negate(); _gy.addScaledVector(_gx, -_gy.dot(_gx)).normalize(); _gz.crossVectors(_gx, _gy);
  _gqw.setFromRotationMatrix(_gm.makeBasis(_gx, _gy, _gz));
  const after = () => { hd.parent.updateMatrixWorld(true); hd.parent.getWorldQuaternion(_gqp).invert(); hd.quaternion.copy(_gqp).multiply(_gqw); gripGrey(g, side, curl); return null; };
  const w = _gw[key] || (_gw[key] = tip.clone().addScaledVector(fdir, -0.1));
  let hits = 0;
  for (let i = 0; i < iters; i++) {
    hits = clearGreyArm(g, side, w, poleDir, after);
    g.updateMatrixWorld(true);
    w.add(_gt.subVectors(tip, tipOf(g, side)));
  }
  return hits;
}

// the lips while humming the tune: just parted on each note (a little more on long ones), shut in the gaps; t is the time
// since the first note, k the most they open, from the bar the hum began on
function humLips(t, k, from = 0) {
  const e = (t / A._T8 + from * 6) % 48;
  for (const [a, l] of A._TUNE) if (e >= a && e < a + l - 0.15) { const q = (e - a) / l; return k * (l > 2 ? 0.75 : 0.5) * Math.sin(Math.PI * Math.min(1, q * 1.3)) + 0.02; }
  return 0;
}

// ---------- the scene ----------
export async function reveal() {
  E.scene.background = new THREE.Color(0x0c0605);
  E.scene.fog = new THREE.Fog(0x0c0605, 4, 14);
  KIT.shaderScene();
  const FOG = { n: KIT.FOGU.uFogN, f: KIT.FOGU.uFogF };
  const setFog = (col, near, far) => { E.scene.fog.color.setHex(col); E.scene.fog.near = near; E.scene.fog.far = far; FOG.n.value = near; FOG.f.value = far; E.scene.background.setHex(col); };
  const U = memoryPass();
  E.surface = 'carpet'; E.unsteady = false;
  // lights: one pool for every set, always in the scene (a light appearing or vanishing would recompile every material)
  const rig = new THREE.Group(); E.scene.add(rig);
  const hemi = new THREE.HemisphereLight(0xffd2a8, 0x2a1408, 0.4); rig.add(hemi);
  const L = [0, 1, 2, 3].map(() => { const l = new THREE.PointLight(0xffffff, 0, 6, 1.6); rig.add(l); return l; });
  const toyL = new THREE.PointLight(0xffc24a, 0, 3, 1.8); rig.add(toyL);
  const faceL = new THREE.PointLight(0xffd6b4, 0, 1.4, 2); rig.add(faceL);
  const lights = (h, list) => {
    hemi.color.setHex(h[0]); hemi.groundColor.setHex(h[1]); hemi.intensity = h[2];
    L.forEach((l, i) => { const d = list[i]; if (!d) { l.intensity = 0; return; } l.color.setHex(d[0]); l.intensity = d[1]; l.distance = d[2]; l.position.set(d[3], d[4], d[5]); });
  };

  // ======== the nursery ========
  const nur = new THREE.Group(); E.scene.add(nur);
  const R = 3.2, WALL_H = 2.25, DOME = 0.72;
  { const fl = new THREE.Mesh(new THREE.CircleGeometry(R, 96), smL(N_FLOOR)); fl.rotation.x = -Math.PI / 2; nur.add(fl); }
  { const w = new THREE.Mesh(new THREE.CylinderGeometry(R, R, WALL_H, 160, 1, true), smL(N_WALL, {}, { side: THREE.BackSide })); w.position.y = WALL_H / 2; nur.add(w); }
  { const d = new THREE.Mesh(new THREE.SphereGeometry(R, 72, 16, 0, Math.PI * 2, 0, Math.PI / 2), smL(N_CEIL, {}, { side: THREE.BackSide })); d.position.y = WALL_H; d.scale.y = DOME / R; nur.add(d); }
  // the passage behind the door: an arched tube going off into the dark
  {
    const sh = new THREE.Shape(); sh.moveTo(-0.56, 0); sh.lineTo(-0.56, 1.49); sh.absarc(0, 1.49, 0.56, Math.PI, 0, true); sh.lineTo(0.56, 0); sh.lineTo(-0.56, 0);
    const pg = new THREE.ExtrudeGeometry(sh, { depth: 2.6, bevelEnabled: false, curveSegments: 24 });
    const pass = new THREE.Mesh(pg, smL(N_PASS, {}, { side: THREE.BackSide })); pass.position.z = 3.05; nur.add(pass);
  }
  // a low cove of light round the foot of the wall
  { const cv = new THREE.Mesh(new THREE.TorusGeometry(R - 0.06, 0.05, 8, 160), std(0x8a5a40, { roughness: 0.9, emissive: 0x6a3410, emissiveIntensity: 0.6 })); cv.rotation.x = Math.PI / 2; cv.position.y = 0.05; nur.add(cv); }
  // the ledge round the wall and the small things on it, to hold
  {
    const ledge = new THREE.Mesh(KIT.lathe([[R, 0.36], [R - 0.26, 0.37], [R - 0.29, 0.41], [R - 0.26, 0.45], [R, 0.45]], 160), std(0xb08a70, { roughness: 0.85 }));
    nur.add(ledge);
    const cols = [0x8fa3b8, 0x9fb09a, 0xc9a25e, 0xc48e8a, 0xe3d6c2, 0xa58fb3, 0xd8b48c];
    const shapes = [new THREE.SphereGeometry(0.035, 20, 14), new THREE.TorusGeometry(0.03, 0.011, 10, 24), softBox(0.05, 0.05, 0.05, 0.014, 4), new THREE.SphereGeometry(0.028, 20, 14)];
    for (let i = 0; i < 26; i++) {
      const a = 0.35 + i / 26 * (Math.PI * 2 - 0.7) + (Math.random() - 0.5) * 0.08, r = R - 0.13 - Math.random() * 0.08;
      const k = i % shapes.length, m = new THREE.Mesh(shapes[k], std(cols[(i * 3) % cols.length], { roughness: 0.55 }));
      m.position.set(Math.sin(a) * r, 0.45 + (k === 1 ? 0.011 : k === 2 ? 0.025 : k === 0 ? 0.024 : 0.02), Math.cos(a) * r);
      if (k === 0) m.scale.set(1.25, 0.7, 1); if (k === 3) m.scale.set(1, 0.75, 1.4);
      if (k === 1) m.rotation.x = Math.PI / 2; m.rotation.y = Math.random() * 3;
      nur.add(m);
    }
    // round floor cushions
    const pouf = KIT.lathe([[0, 0], [0.3, 0], [0.36, 0.05], [0.37, 0.11], [0.33, 0.16], [0.2, 0.18], [0, 0.18]], 40);
    for (const [a, c] of [[2.2, 0xb47c66], [2.9, 0x9a7e8e], [-2.4, 0xc2a07a]]) { const p = new THREE.Mesh(pouf, std(c, { roughness: 0.95, map: clothTex('#' + c.toString(16)) })); p.position.set(Math.sin(a) * 2.45, 0, Math.cos(a) * 2.45); nur.add(p); }
  }
  // the cradle: a nacre shell on a stem, full of slow light, a mobile of pearls turning over it
  const CRADLE_P = V(0, 0, -1.95);
  const cradleU = { uAmt: { value: 1 } };
  {
    const shell = new THREE.Mesh(KIT.lathe([[0, 0], [0.26, 0], [0.24, 0.04], [0.11, 0.1], [0.08, 0.3], [0.18, 0.36], [0.42, 0.42], [0.56, 0.52], [0.6, 0.6], [0.57, 0.62], [0.5, 0.57], [0.3, 0.5], [0, 0.47]], 64), smL(NACRE, {}, { side: THREE.DoubleSide }));
    shell.position.copy(CRADLE_P); nur.add(shell);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 40, 20), smL(CRADLE, cradleU, { ...KIT.ADD }));
    glow.scale.set(1, 0.34, 1); glow.position.copy(CRADLE_P).add(V(0, 0.6, 0)); glow.renderOrder = 4; nur.add(glow);
    const beam = KIT.shaft(0.42, 0.55, 2.0, 0xffd6a0, 0.12); lin(beam.material); beam.position.copy(CRADLE_P).add(V(0, 1.6, 0)); nur.add(beam);
    const mob = new THREE.Group(); mob.position.copy(CRADLE_P).add(V(0, 2.05, 0)); nur.add(mob);
    const brass = std(0xc8a060, { metalness: 0.8, roughness: 0.35 });
    { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.006, 6, 64), brass); ring.rotation.x = Math.PI / 2; mob.add(ring); }
    for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.6, 4), brass); const a = i * 2.094; t.position.set(Math.sin(a) * 0.36 * 0.5, 0.28, Math.cos(a) * 0.36 * 0.5); t.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5); mob.add(t); }
    const pearlM = new THREE.MeshBasicMaterial({ color: 0xffe2b8 });
    const halo = new THREE.SpriteMaterial({ map: KIT.glowTex(), color: 0xffc890, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.45 });
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2, len = 0.12 + (i * 37 % 7) * 0.035;
      const th = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, len, 3), brass); th.position.set(Math.sin(a) * 0.36, -len / 2, Math.cos(a) * 0.36); mob.add(th);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 10), pearlM); p.position.set(Math.sin(a) * 0.36, -len - 0.02, Math.cos(a) * 0.36); mob.add(p);
      const s = new THREE.Sprite(halo); s.scale.setScalar(0.16); p.add(s);
    }
    on((dt, t) => { mob.rotation.y = t * 0.12; cradleU.uAmt.value = 0.85 + 0.15 * Math.sin(t * 0.7); });
    const mo = KIT.motes(160, V(0, 1.4, -0.6), V(2.6, 1.1, 2.6), 0xffd2a0, 0.6); lin(mo.material); nur.add(mo);
  }
  const NUR_LIGHT = [[0xffe6d2, 0x2a1a12, 0.45], [[0xffd2ae, 2.4, 6, 0, 0.95, -1.95], [0xffbe98, 1.0, 4.5, -2.3, 0.25, 0.6], [0xffbe98, 1.0, 4.5, 2.3, 0.25, 0.6], [0xa98cff, 1.4, 4, -0.3, 2.0, 3.4]]];

  // the child, by the cradle; the caretaker beside it; the mantis just inside the door, head bowed under the low roof
  const KID_P = V(0, 0, -1.0);
  const kid = makeHuman(KNOWN_KID.scale, KNOWN_KID.color, KNOWN_KID.hair); kid.position.copy(KID_P); nur.add(kid);
  const ku = kid.userData, kidMouth = mouthOf(kid);
  const care = makeGrey(); care.position.set(0.95, 0, -1.55); care.rotation.y = -0.55; nur.add(care);
  // (the model faces -z: this turns it into the room)
  // (makeMantis faces +z: rotation.y = atan2(dx, dz) turns them to face a point dx, dz away)
  const mantis = makeMantis(); mantis.scale.setScalar(0.95); mantis.position.set(-1.4, 0, 2.2); nur.add(mantis);
  const mantisFacing = (p) => Math.atan2(p.x - mantis.position.x, p.z - mantis.position.z);
  // they stand behind you and to your left, out of the opening view, and watch you: facing you (mantisLook), squared up
  // to you at the end
  const mantisLook = V(0, 0, 0), mantisAt = () => mantisLook.copy(E.camera.position).lerp(kid.position, mantisOnYou ? 0 : 0.1);
  let mantisOnYou = false;
  mantis.rotation.y = mantisFacing(V(0, 0, 2.4));
  mantis.userData.nod(0.35);

  // the toy, in your right hand (the jewel from the containers hall, at the size it shrank to in your palm)
  const toyU = { uColor: { value: KIT.dcol(0xffd27a) }, uGlow: { value: 0.45 } };
  const toy = new THREE.Mesh(new THREE.TetrahedronGeometry(0.09), smL(KIT.JEWEL, toyU)); toy.scale.setScalar(0.45); E.scene.add(toy);
  const toyHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: KIT.glowTex(), color: 0xffc24a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.25 }));
  toyHalo.scale.setScalar(0.5 / 0.45); toy.add(toyHalo);
  // it turns slowly, and stops turning while a hand rests on it (toySpin)
  let toySpin = 1;
  on((dt) => { toy.rotation.y += dt * 1.2 * toySpin; toy.rotation.x += dt * 0.7 * toySpin; toyL.position.copy(toy.getWorldPosition(_kp)); });
  const me = makePlayerBody(), mu = me.userData;
  mu.torso.children[0].visible = false; mu.legs.visible = false; mu.armL.visible = false; E.camera.add(me);
  const reach = KIT.palmReach(me), palmP = V(0, 0, 0), handTo = V(0, 0, 0), fw = V(0, 0, 0);
  const inPalm = (out) => { E.camera.updateMatrixWorld(true); return mu.handR.localToWorld(out.copy(KIT.PALM).add(V(-0.042, 0, 0))); };
  // where the open palm is carried while you walk: ahead, low and a little right, moving with the view
  const carry = (out) => { E.camera.getWorldDirection(fw); fw.y = 0; fw.normalize(); return out.copy(E.camera.position).addScaledVector(fw, 0.4).add(V(-fw.z * 0.07, -0.3, fw.x * 0.07)); };
  let handK = 1, toyInHand = true, palmTarget = null;
  on(() => {
    if (!me.visible) return;
    if (palmTarget) handTo.copy(palmTarget); else carry(handTo);
    reach(handTo, handK);
    if (toyInHand) toy.position.copy(inPalm(palmP));
  });

  // the child: standing, breathing, the arms either loose or solved onto a point (kidReach)
  const kst = { x: 0, z: 0.03, f: -0.08 }, kidState = { reach: null, dance: 0, danceF: 0.62, ph: 0, clapK: 0, smile: 0, look: null, lookAmt: 1, tilt: 0, back: 0, mouth: 0, humAt: 0, humFrom: 0 };
  // the dance's sway: one full rock (left and back) a bar of the lullaby, 1.62 s, so the weight lands on each of its two beats
  const DANCE_F = 0.62;
  // the arms hang a little out from the sides (makeHuman: a positive z on the left arm, or negative on the right, swings
  // the hand in toward the body; arms hanging straight down already touch the sides)
  const REST_Z = 0.08;
  ku.armL.rotation.set(0, 0, -REST_Z); ku.armR.rotation.set(0, 0, REST_Z); ku.foreL.rotation.x = ku.foreR.rotation.x = -0.08;
  // makeHuman hangs the chest, arms and neck each straight off the hips, so turning the chest alone parts it from the arms
  // and the neck. Here they share one pivot at the waist and bend and turn over the hips as one piece.
  const upper = new THREE.Group(); upper.position.set(0, ku.hipY + 0.08, 0); ku.body.add(upper);
  for (const o of [ku.chest, ku.armL, ku.armR, ku.neck]) { o.position.y -= upper.position.y; upper.add(o); }
  const kidGaze = humanGaze(kid), KID_REST = { y: 0, p: 0 }, _fv = V(0, 0, 0);
  // The child's smile, as morph targets on this child's own copies of the lips and brows (the shared head meshes are left
  // as they are): the mouth curves, its corners lifting about half its half-width and drawing out a fifth, the lips
  // thinning; the brows come down level, the inner ends most (the head is made with them raised a touch at the inner
  // end, which reads as worried). kidSmile(k) sets it, 0..1.
  let kidBrowVerts = 0;
  const kidSmile = (() => {
    const hd = ku.head, lips = hd.children[4], hair = hd.children[1];
    const lg = lips.geometry.clone(); lg.computeBoundingBox();
    const lb = lg.boundingBox, hw = (lb.max.x - lb.min.x) / 2, cy = (lb.max.y + lb.min.y) / 2, lp = lg.attributes.position, lm = new Float32Array(lp.count * 3);
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i), y = lp.getY(i), z = lp.getZ(i), u = Math.min(1, Math.abs(x) / hw);
      lm[i * 3] = x * 0.22; lm[i * 3 + 1] = 0.55 * hw * u * u - 0.08 * hw - (y - cy) * 0.35; lm[i * 3 + 2] = -0.006 * u * u;
    }
    lg.morphAttributes.position = [new THREE.Float32BufferAttribute(lm, 3)]; lg.morphTargetsRelative = true;
    lips.geometry = lg; lips.updateMorphTargets();
    // the brows: the last vertices of the hair mesh (merged in after the hair), found from the end while they sit just over an eye
    const eye = kidGaze.eyes[1].position, ex = Math.abs(eye.x), hg = hair.geometry.clone(), hp = hg.attributes.position, hm = new Float32Array(hp.count * 3);
    let n = 0;
    for (let i = hp.count - 1; i >= 0; i--) {
      const x = hp.getX(i), y = hp.getY(i);
      if (Math.abs(Math.abs(x) - ex) > 0.035 || y < eye.y + 0.002 || y > eye.y + 0.06) break;
      const inner = Math.max(0, Math.min(1, (ex + 0.025 - Math.abs(x)) / 0.05));   // 1 at the inner end, 0 at the outer
      hm[i * 3 + 1] = -0.0025 - 0.0045 * inner; n++;
    }
    hg.morphAttributes.position = [new THREE.Float32BufferAttribute(hm, 3)]; hg.morphTargetsRelative = true;
    hair.geometry = hg; hair.updateMorphTargets();
    kidBrowVerts = n;
    // the smile's line: the lips are small and close in colour to the skin, so the parted line between them is drawn as a
    // thin dark crease, a little wider than the lips, curving up at the corners, lying on the face (which falls back
    // round the sides as the lips do); it grows out from the middle with the smile, and its ends tuck into the cheeks
    const W = hw * 1.5, cz = (lb.max.z + lb.min.z) / 2 + 0.0012, pts = [];
    for (let i = 0; i <= 16; i++) { const x = -W + (2 * W) * i / 16, u = x / W; pts.push(V(x, -0.15 * hw + 0.3 * hw * u * u * u * u + 0.3 * hw * u * u, -7 * x * x - 0.002 * u * u)); }
    const crease = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, hw * 0.1, 6, false), new THREE.MeshStandardMaterial({ color: 0x6e3228, roughness: 0.6 }));
    { const p = crease.geometry.attributes.position, cc = V(0, 0, 0);   // tapered: thinnest at the corners
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), u = Math.min(1, Math.abs(x) / W), near = pts.reduce((a, q) => (Math.abs(q.x - x) < Math.abs(a.x - x) ? q : a)); cc.set(p.getX(i), p.getY(i), p.getZ(i)).sub(near).multiplyScalar(1 - 0.65 * u * u).add(near); p.setXYZ(i, cc.x, cc.y, cc.z); }
      crease.geometry.computeVertexNormals(); }
    crease.position.set(0, cy, cz); crease.visible = false; hd.add(crease);
    return (k) => {
      lips.morphTargetInfluences[0] = k; hair.morphTargetInfluences[0] = k;
      crease.visible = k > 0.02; crease.scale.set(0.55 + 0.45 * k, 0.3 + 0.7 * k, 1);
    };
  })();

  // The legs keep the feet planted: each sole stays on its spot on the floor (in the nursery's frame) while the hips move
  // over them, the hip (x, z) and knee solved every frame by coordinate descent, warm-started. A foot that ends up more
  // than 4 cm from where it belongs under the child steps there in a short lifted arc, one foot at a time.
  const legs = ['L', 'R'].map((s) => {
    const hip = ku['leg' + s], knee = ku['knee' + s], shoe = knee.children[1];
    shoe.geometry.computeBoundingBox(); const bb = shoe.geometry.boundingBox;
    const sole = V((bb.min.x + bb.max.x) / 2, bb.min.y, (bb.min.z + bb.max.z) / 2);
    kid.updateMatrixWorld(true);
    const rest = kid.worldToLocal(knee.localToWorld(sole.clone()));   // the sole's spot under the child, in the child's frame
    return { s, hip, knee, sole, rest, planted: knee.localToWorld(sole.clone()), st: { x: 0, z: 0, k: 0 }, step: null, lift: 0 };
  });
  const _lqh = new THREE.Quaternion(), _lqk = new THREE.Quaternion(), _le2 = new THREE.Euler(), _lv = V(0, 0, 0), _lt = V(0, 0, 0), _lm = new THREE.Matrix4();
  const legFK = (L, x, z, k, out) => {
    _lqk.setFromEuler(_le2.set(k, 0, 0)); _lqh.setFromEuler(_le2.set(x, 0, z));
    return out.copy(L.sole).applyQuaternion(_lqk).add(L.knee.position).applyQuaternion(_lqh).add(L.hip.position);
  };
  const solveLeg = (L, target) => {
    // the target into the body's own frame (the frame the hip joint hangs in)
    kid.updateMatrix(); ku.body.updateMatrix();
    _lm.copy(ku.body.matrix).invert(); kid.worldToLocal(_lt.copy(target)).applyMatrix4(_lm);
    const st = L.st, err = () => legFK(L, st.x, st.z, st.k, _lv).distanceToSquared(_lt) + 2e-5 * (st.x + st.k * 0.5) ** 2;
    let e = err(), step = 0.04;
    for (let it = 0; it < 40 && step > 0.0008; it++) {
      let better = false;
      for (const key of ['x', 'z', 'k']) for (const dd of [step, -step]) {
        const o = st[key]; st[key] = o + dd;
        st.k = Math.max(0, Math.min(1.6, st.k)); st.x = Math.max(-1.2, Math.min(0.5, st.x)); st.z = Math.max(-0.35, Math.min(0.35, st.z));
        const e2 = err(); if (e2 < e) { e = e2; better = true; } else st[key] = o;
      }
      if (!better) step *= 0.5;
    }
    L.hip.rotation.set(st.x, 0, st.z); L.knee.rotation.set(st.k, 0, 0);
  };
  // Claps: on each weight change of the dance (twice a bar) both hands come together in front of the chest. Each hand's end
  // is solved (kidArm) to a point either side of a plane through the middle of the chest, facing across it, held
  // cst.base[side] out from it plus the opening; base is tuned while the hands are together so the nearest point of each
  // hand rests 2.2 mm off the plane: the palms meet with no part of either hand through the other. clap.gap logs the gap
  // between the hands (the two nearest points' distances from the plane, added) every frame; a contact sounds A.clap.
  const cst = { L: {}, R: {}, base: { L: 0.04, R: 0.04 } };
  // from the wrist to the middle of the palm (makeHuman's hand, at this child's size)
  const HAND_MID = (() => { const hm = ku.wristL.children.find((o) => o.isMesh); hm.geometry.computeBoundingBox(); return 0.45 * (hm.geometry.boundingBox.max.y - hm.geometry.boundingBox.min.y) * kid.scale.x; })();
  const clap = { F: V(0, 0, 0), P: V(0, 0, 0), a: V(0, 0, 0), fw: V(0, 0, 0), up: V(0, 0, 0), sL: V(0, 0, 0), sR: V(0, 0, 0), tL: V(0, 0, 0), tR: V(0, 0, 0), open: 1, wasOpen: 1, gap: 0, dL: 0, dR: 0, n: 0 };
  const _cq = new THREE.Quaternion(), _cv = V(0, 0, 0);
  const handOff = (side, sign) => {   // nearest point of a hand to the clap plane, measured toward that hand's own side
    const m = ku['wrist' + side].children.find((o) => o.isMesh), p = m.geometry.attributes.position; m.updateMatrixWorld(true);
    let mn = 9; for (let i = 0; i < p.count; i += 2) { _cv.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).sub(clap.P); mn = Math.min(mn, sign * _cv.dot(clap.a)); }
    return mn;
  };
  const clapFrame = () => {
    upper.updateMatrixWorld(true);
    ku.armL.getWorldPosition(clap.sL); ku.armR.getWorldPosition(clap.sR);
    clap.a.subVectors(clap.sL, clap.sR).normalize();
    upper.getWorldQuaternion(_cq); clap.fw.set(0, 0, 1).applyQuaternion(_cq); clap.up.set(0, 1, 0).applyQuaternion(_cq);
    clap.P.copy(clap.sL).add(clap.sR).multiplyScalar(0.5).addScaledVector(clap.fw, 0.17).addScaledVector(clap.up, -0.08);
  };
  // free: the hands' ends in the loose dance pose, to blend from (c < 1): the solve then goes to points between the two,
  // each kept on its own side of the middle plane, so the hands come in to the clap and never cross
  const tipOfHand = (side, out) => { const hm = ku['wrist' + side].children.find((o) => o.isMesh); if (!hm.userData.tip) { hm.geometry.computeBoundingBox(); const b = hm.geometry.boundingBox; hm.userData.tip = V((b.min.x + b.max.x) / 2, b.min.y + 0.012, (b.min.z + b.max.z) / 2); } return hm.localToWorld(out.copy(hm.userData.tip)); };
  const clapSolve = (open, c = 1, free = null) => {
    clapFrame();
    // the hands stand up from the wrists, fingers forward and up, so the palms' middles meet at P: the wrists sit below
    // and behind it, one either side
    clap.F.copy(clap.fw).multiplyScalar(0.5).addScaledVector(clap.up, 0.87).normalize();
    clap.tL.copy(clap.P).addScaledVector(clap.a, cst.base.L + open).addScaledVector(clap.F, -HAND_MID); clap.tR.copy(clap.P).addScaledVector(clap.a, -(cst.base.R + open)).addScaledVector(clap.F, -HAND_MID);
    if (free && c < 1) {
      clap.tL.lerpVectors(free.L, clap.tL, c); clap.tR.lerpVectors(free.R, clap.tR, c);
      for (const [t, sg, b] of [[clap.tL, 1, cst.base.L], [clap.tR, -1, cst.base.R]]) { const off = sg * _cv.subVectors(t, clap.P).dot(clap.a); if (off < b) t.addScaledVector(clap.a, sg * (b - off)); }
    }
    kidArm(kid, 'L', clap.tL, cst.L, true); kidArm(kid, 'R', clap.tR, cst.R, true);
  };
  const freeTips = { L: V(0, 0, 0), R: V(0, 0, 0) };
  // the hands come together on each weight change (|sin| at its top), stay together a moment, and open 4 cm a side between
  const clapHands = (ph, c, fL, fR) => {
    clap.open = 0.04 * Math.pow(Math.max(0, Math.abs(Math.cos(ph)) - 0.12) / 0.88, 1.3);
    let free = null;
    if (c < 1) { ku.armL.rotation.set(fL.x, 0, fL.z); ku.foreL.rotation.x = fL.f; ku.armR.rotation.set(fR.x, 0, fR.z); ku.foreR.rotation.x = fR.f; kid.updateMatrixWorld(true); ku.wristL.getWorldPosition(freeTips.L); ku.wristR.getWorldPosition(freeTips.R); free = freeTips; }
    clapSolve(clap.open, c, free);
  };
  // each forearm rolled so its palm faces straight across at the other (the hand's palm is its local -x on the right, +x
  // on the left), by c; the roll about the forearm's own axis is held within what a wrist can turn
  const _pq = new THREE.Quaternion(), _pd = V(0, 0, 0);
  // the hands turned at the wrists to stand up, fingers along clap.F, each palm facing straight across at the other (a
  // hand's palm is its local -x on the right, +x on the left; its fingers run down its local -y); by c from rest
  const _hx = V(0, 0, 0), _hy = V(0, 0, 0), _hz = V(0, 0, 0), _hmq = new THREE.Matrix4(), _hq = new THREE.Quaternion(), _hq0 = new THREE.Quaternion();
  const palmsIn = (c) => {
    for (const [side, sg] of [['L', -1], ['R', 1]]) {
      const wr = ku['wrist' + side];
      if (c < 0.001) { wr.quaternion.identity(); continue; }
      // the palm's normal toward the other hand: -a for the left hand (on the +a side), +a for the right
      const N = _pd.copy(clap.a).multiplyScalar(sg);
      _hx.copy(N).multiplyScalar(side === 'L' ? 1 : -1);                       // the hand's local x in the world
      _hy.copy(clap.F).negate(); _hy.addScaledVector(_hx, -_hy.dot(_hx)).normalize();   // local y: back down the fingers
      _hz.crossVectors(_hx, _hy);
      _hq.setFromRotationMatrix(_hmq.makeBasis(_hx, _hy, _hz));
      wr.parent.updateMatrixWorld(true); wr.parent.getWorldQuaternion(_pq).invert();
      wr.quaternion.copy(_hq0.identity()).slerp(_pq.multiply(_hq), c);
    }
  };
  const clapMeasure = (c) => {
    clap.dL = handOff('L', 1); clap.dR = handOff('R', -1); clap.gap = clap.dL + clap.dR;
    if (c > 0.99 && clap.open < 0.002) for (const [k, dd] of [['L', clap.dL], ['R', clap.dR]]) cst.base[k] = Math.max(-0.04, Math.min(0.08, cst.base[k] + 0.7 * (0.0022 - dd)));
    if (clap.open < 0.0015 && clap.wasOpen >= 0.0015 && c > 0.5) { clap.n++; A.clap(0.85 * c, { pan: -0.1 }); }
    clap.wasOpen = clap.open;
  };
  const _home = V(0, 0, 0);
  const plantFeet = (dt) => {
    kid.updateMatrixWorld(true);
    for (const L of legs) {
      kid.localToWorld(_home.copy(L.rest));
      if (L.step) {
        const sp = L.step; sp.t += dt / sp.d; const q = Math.min(1, sp.t), e = q * q * (3 - 2 * q);
        L.planted.lerpVectors(sp.from, sp.to.copy(_home), e); L.lift = Math.sin(Math.PI * q) * 0.045;
        if (q >= 1) { L.step = null; L.lift = 0; }
      } else if (L.planted.distanceTo(_home) > 0.04 && !legs.some((o) => o.step)) {
        L.step = { t: 0, d: 0.3, from: L.planted.clone(), to: _home.clone() };
      }
    }
  };
  for (let i = 0; i < 14; i++) { clapSolve(0); palmsIn(1); clapMeasure(0); for (const [k, dd] of [['L', clap.dL], ['R', clap.dR]]) cst.base[k] = Math.max(-0.04, Math.min(0.08, cst.base[k] + 0.8 * (0.0022 - dd))); }
  ku.armL.rotation.set(0, 0, -REST_Z); ku.armR.rotation.set(0, 0, REST_Z); ku.foreL.rotation.x = ku.foreR.rotation.x = -0.08; palmsIn(0);
  on((dt, t) => {
    const b = Math.sin(t * 1.9 + ku.ph);
    ku.chest.scale.set(1 + b * 0.009, 1, 1 + b * 0.02);
    // The small happy dance: the weight rocks from one foot to the other about once a second. The hips carry over the
    // standing foot and rise on it, sinking a little as the weight passes between the feet (the knees take it); the free
    // foot's heel lifts; the shoulders tilt and swing against the hips a moment behind them, the head tilts later still;
    // the elbows are bent and the arms swing with the rock. Everything turns over the planted feet.
    kidState.ph += dt * Math.PI * 2 * kidState.danceF;
    const d = kidState.dance, ph = kidState.ph, w = Math.sin(ph);
    // (the pelvis rolls about the middle of the hips, not the floor: the hips' middle moves by exactly the shift and dip)
    const roll = 0.1 * d * w, hy = ku.hipY;
    ku.body.rotation.z = roll;
    ku.body.position.set(0.09 * d * w + hy * Math.sin(roll), -0.05 * d * (1 - w * w) + hy * (1 - Math.cos(roll)), 0);
    upper.rotation.set(-0.05 * d, 0.2 * d * Math.sin(ph - 0.3), -0.17 * d * Math.sin(ph - 0.35));
    kid.position.z = KID_P.z - kidState.back;
    plantFeet(dt);
    for (const L of legs) {
      const free = L.s === 'L' ? Math.max(0, w) : Math.max(0, -w);   // w > 0: the hips are over the right foot, the left is free
      _lt.copy(L.planted); _lt.y += L.lift + 0.025 * d * free;
      solveLeg(L, _lt);
    }
    if (!kidState.reach) {
      const sw = 0.2 * d * Math.sin(ph - 0.25), a = REST_Z + d * (0.22 + 0.06 * Math.abs(w));
      const fL = { x: -0.25 * d - sw, z: -a, f: -0.08 - 1.1 * d + 0.12 * d * Math.sin(ph) }, fR = { x: -0.25 * d + sw, z: a, f: -0.08 - 1.1 * d - 0.12 * d * Math.sin(ph) };
      const c = kidState.clapK;
      if (c > 0.001) clapHands(ph, c, fL, fR);
      else { ku.armL.rotation.set(fL.x, 0, fL.z); ku.foreL.rotation.x = fL.f; ku.armR.rotation.set(fR.x, 0, fR.z); ku.foreR.rotation.x = fR.f; }
      palmsIn(c);
      if (c > 0.001) clapMeasure(c);
    }
    kidGaze.update(dt, kidState.look, kidState.look ? kidState.lookAmt : 0, KID_REST);
    ku.neck.rotation.x += kidState.tilt + 0.02 * Math.sin(t * 0.4);
    ku.neck.rotation.z = 0.22 * d * Math.sin(ph - 0.9) + 0.12 * kidState.smile;   // a shy happy tilt with the smile
    // the face fill sits 55 cm in front of the child's face, a little above it, toward you
    ku.head.getWorldPosition(faceL.position); _fv.set(E.camera.position.x - faceL.position.x, 0, E.camera.position.z - faceL.position.z).normalize();
    faceL.position.addScaledVector(_fv, 0.55).y += 0.18;
    kidMouth(kidState.humAt && E.time > kidState.humAt - 0.3 && E.time < kidState.humAt + 48 * A._T8 ? humLips(E.time - kidState.humAt, 0.16, kidState.humFrom) : kidState.mouth);
    kidSmile(kidState.smile);
  });
  let mantisTrack = 0.9;
  on((dt, t) => {
    aimGrey(care, E.camera.position, 0.85);
    const b = Math.sin(t * 1.7) * 0.012; care.userData.chest.scale.set(1 + b, 1, 1 + b * 1.4);
    idleMantis(mantis, dt, t);
    // the mantis keeps turning, unhurried, to face you (the shortest way round)
    if (mantisTrack) { let dy = mantisFacing(mantisAt()) - mantis.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); mantis.rotation.y += dy * Math.min(1, dt * mantisTrack); }
  });

  // ======== memory 1: the end of the containers hall ========
  const m1 = new THREE.Group(); m1.visible = false; E.scene.add(m1);
  const m1Kid = makeHuman(KNOWN_KID.scale, KNOWN_KID.color, KNOWN_KID.hair), m1Grey = makeGrey();
  const m1Toy = new THREE.Mesh(new THREE.TetrahedronGeometry(0.09), smL(KIT.JEWEL, { uColor: { value: KIT.dcol(0xffd27a) }, uGlow: { value: 1.2 } }));
  {
    // the same hall as the containers room (vessels.js), drawn through the memory's linear-colour wrapper
    buildVesselHall(m1, { sm: smL, TIME: KIT.TIME, FOGU: KIT.FOGU, ADD: KIT.ADD, pxScale: () => E.renderer.domElement.height * 0.714 });
    m1Kid.position.set(0, 0, -19.5); m1.add(m1Kid);
    m1Grey.position.set(0.8, 0, -19.9); m1.add(m1Grey);
    m1Toy.userData.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: KIT.glowTex(), color: 0xffc24a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 }));
    m1Toy.userData.halo.scale.setScalar(0.5); m1Toy.add(m1Toy.userData.halo); m1.add(m1Toy);
  }
  const M1_LIGHT = [[0x7fffd0, 0x06100e, 0.5], [[0x4fffc8, 5, 9, 0, 2.6, -15], [0x4fffc8, 3, 7, 0, 2.6, -20], [0xa8ffe4, 1.6, 3.5, -0.4, 1.7, -18.6]]];
  // the child holding it out, hands shaking; the grey behind, eyes on you
  const m1u = m1Kid.userData, m1Held = V(0, 0, 0);
  {
    m1u.armL.rotation.set(-1.05, 0, 0.09); m1u.armR.rotation.set(-1.05, 0, -0.09); m1u.foreL.rotation.x = m1u.foreR.rotation.x = -0.48;
    m1Kid.updateMatrixWorld(true);
    const hc = (w) => { const m = w.children.find((c) => c.isMesh); m.geometry.computeBoundingBox(); return m.localToWorld(m.geometry.boundingBox.getCenter(V(0, 0, 0))); };
    m1Held.copy(hc(m1u.wristL)).add(hc(m1u.wristR)).multiplyScalar(0.5).add(V(0, 0, 0.055));
  }
  const m1State = { shake: 0 }, m1Gaze = humanGaze(m1Kid), M1_REST = { y: 0, p: 0.05 };
  on((dt, t) => {
    if (!m1.visible) return;
    const b = Math.sin(t * 1.1) * 0.02, sh = m1State.shake, tr = (Math.sin(t * 47) * 0.6 + Math.sin(t * 31 + 1) * 0.4) * 0.022 * sh, tr2 = (Math.sin(t * 43 + 2) * 0.6 + Math.sin(t * 29) * 0.4) * 0.022 * sh;
    m1u.armL.rotation.set(-1.05 + b + tr, 0, 0.09); m1u.armR.rotation.set(-1.05 + b + tr2, 0, -0.09);
    m1u.foreL.rotation.x = -0.48 + tr2 * 0.6; m1u.foreR.rotation.x = -0.48 + tr * 0.6;
    m1Gaze.update(dt, E.camera.position, 0.85, M1_REST); m1u.chest.scale.z = 1 + Math.sin(t * 1.6) * 0.018;
    m1Toy.position.set(m1Held.x + (tr + tr2) * 0.06, m1Held.y + b * 0.3 + (tr - tr2) * 0.05, m1Held.z);
    m1Toy.rotation.y += dt * 1.2; m1Toy.rotation.x += dt * 0.7;
    aimGrey(m1Grey, E.camera.position, 1);
  });

  // ======== memory 2: the classroom ========
  const m2 = new THREE.Group(); m2.visible = false; E.scene.add(m2);
  const m2Kids = [];
  let m2Known = null, m2Mouth = null, m2Gaze = null;
  {
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 3.4, 96, 1, true), smL(KIT.CL_WALL, {}, { side: THREE.BackSide })); wall.position.y = 1.7;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(5, 96), smL(KIT.CL_FLOOR)); floor.rotation.x = -Math.PI / 2;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(5, 64, 16, 0, Math.PI * 2, 0, Math.PI / 2), smL(KIT.CL_CEIL, {}, { side: THREE.BackSide })); dome.position.y = 3.4; dome.scale.y = 0.25;
    for (const m of [wall, floor, dome]) m.position.z = -2.6;
    m2.add(wall, floor, dome);
    const cols = [KNOWN_KID.color, 0x9a6a6a, 0x6a9a7c, 0x8a7a55, 0x7a6a9a, 0x556a7a, 0x9a8a6a];
    const seatG = KIT.lathe([[0, 0], [0.2, 0], [0.23, 0.06], [0.23, 0.22], [0.2, 0.28], [0.12, 0.3], [0, 0.3]], 32), seatM = std(0xb3a07a, { roughness: 0.9 });
    cols.forEach((c, i) => {
      const side = i % 2 ? 1 : -1, k = Math.floor(i / 2), s = 0.55 + (i % 3) * 0.08;
      const th = side * (0.42 + k * 0.42), k2 = makeHuman(i ? s : KNOWN_KID.scale, c, i ? { seated: true } : { seated: true, ...KNOWN_KID.hair });
      clearLap(k2);
      k2.position.set(Math.sin(th) * 2.2, 0, -2.6 + Math.cos(th) * 2.2);
      if (i === 0) seatKnownKid(k2); else k2.lookAt(0, 0, -2.6);
      m2.add(k2); m2Kids.push(k2);
      const st = new THREE.Mesh(seatG, seatM); st.position.copy(k2.position); st.scale.setScalar(s * 1.5); m2.add(st);
    });
    m2Known = m2Kids[0]; m2Mouth = mouthOf(m2Known); m2Gaze = humanGaze(m2Known);
    const t1 = makeGrey(); t1.position.set(-0.55, 0, -1.75); t1.lookAt(0, 0, 1.2); m2.add(t1);
    const t2 = makeGrey(); t2.position.set(1.5, 0, -2.9); t2.lookAt(0, 0, 1.2); m2.add(t2);
    const dais = new THREE.Mesh(KIT.lathe([[0, 0], [0.85, 0], [0.85, 0.1], [0.8, 0.12], [0.68, 0.12], [0.68, 0.32], [0.62, 0.34], [0.58, 0.34], [0.58, 0.48], [0.55, 0.5], [0, 0.5]], 64), std(0xc9b994, { roughness: 0.5, metalness: 0.1 }));
    dais.position.set(0, 0, -2.6); m2.add(dais);
    const gold = new THREE.MeshBasicMaterial({ color: 0xffd98a });
    for (const [r, y] of [[0.585, 0.47], [0.69, 0.3], [0.86, 0.06]]) { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 6, 80), gold); t.rotation.x = Math.PI / 2; t.position.set(0, y, -2.6); m2.add(t); }
    const inlay = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48), smL(KIT.CL_INLAY)); inlay.rotation.x = -Math.PI / 2; inlay.position.set(0, 0.502, -2.6); m2.add(inlay);
    const beam = KIT.shaft(0.45, 0.72, 2.9, 0xfff0c8, 0.2); lin(beam.material); beam.position.set(0, 1.95, -2.6); m2.add(beam);
    const mo = KIT.motes(160, V(0, 1.7, -1.2), V(4, 1.6, 3.4), 0xfff1d0, 0.9); lin(mo.material); m2.add(mo);
  }
  const M2_LIGHT = [[0xffffff, 0x8a8f9c, 2], []];
  const m2State = { turn: 0, mouth: 0, humAt: 0, humFrom: 0 }, M2_DAIS = V(0, 1.2, -2.6);
  on((dt, t) => {
    if (!m2.visible) return;
    for (let i = 1; i < m2Kids.length; i++) idleHuman(m2Kids[i], t + i * 1.3);
    idleHuman(m2Known, t);
    // looking at the dais, then round at you (the eyes first, the head after them), and held
    m2Gaze.update(dt, m2State.turn > 0.5 ? E.camera.position : M2_DAIS, 1);
    m2Mouth(m2State.humAt ? humLips(E.time - m2State.humAt, 0.22, m2State.humFrom) : m2State.mouth);
  });

  // ======== memory 3: the pale room, years ago ========
  const m3 = new THREE.Group(); m3.visible = false; E.scene.add(m3);
  const SEAT_Y = 0.32, EYE = V(0, 1.1, -0.42);
  // seated, the head turns up to 83 degrees either side of straight ahead (her face is at about 72 to the right, the
  // doorway at 75 to the left)
  const SEATED = { yaw: 1.45, up: 0.6, down: 0.85 };
  const lampU = { uSoft: { value: 0 } }, glowU = { uAmt: { value: 0.35 } };
  const wig = makeGreyWig(), shift = makeGreyShift();
  const her = makeGrey(), door = makeGrey();
  const me3 = makePlayerBody(), m3u = me3.userData;
  {
    const wm = smL(P_WALL);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.8), smL(P_FLOOR)); fl.rotation.x = -Math.PI / 2; fl.position.set(0.1, 0, -0.25); m3.add(fl);
    const ce = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.8), wm); ce.rotation.x = Math.PI / 2; ce.position.set(0.1, 2.35, -0.25); m3.add(ce);
    // walls: front, back, right, and the left one in three pieces round the doorway (z -1.3 .. -0.5, up to 2.0)
    const wall = (w, h, x, y, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wm); m.position.set(x, y, z); m.rotation.y = ry; m3.add(m); };
    wall(3.8, 2.35, 0.1, 1.175, -2.15, 0); wall(3.8, 2.35, 0.1, 1.175, 1.65, Math.PI); wall(3.8, 2.35, 2.0, 1.175, -0.25, -Math.PI / 2);
    wall(0.85, 2.35, -1.8, 1.175, -1.725, Math.PI / 2); wall(2.15, 2.35, -1.8, 1.175, 0.575, Math.PI / 2); wall(0.8, 0.35, -1.8, 2.175, -0.9, Math.PI / 2);
    // the passage beyond: bright
    const bm = smL(P_BEYOND);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.35), bm); back.position.set(-3.0, 1.175, -0.9); back.rotation.y = Math.PI / 2; m3.add(back);
    for (const z of [-1.3, -0.5]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.0), bm); s.position.set(-2.4, 1.0, z); s.rotation.y = z < -1 ? 0 : Math.PI; m3.add(s); }
    const bfl = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), bm); bfl.rotation.x = -Math.PI / 2; bfl.position.set(-2.4, 0.001, -0.9); m3.add(bfl);
    const bce = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), bm); bce.rotation.x = Math.PI / 2; bce.position.set(-2.4, 2.0, -0.9); m3.add(bce);
    // the lamp: a round panel in the ceiling, and its glow
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.42, 48), smL(P_LAMP, lampU)); lamp.rotation.x = Math.PI / 2; lamp.position.set(0, 2.345, -0.1); m3.add(lamp);
    const lg = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), smL(P_GLOW, glowU, { ...KIT.ADD })); lg.rotation.x = Math.PI / 2; lg.position.set(0, 2.335, -0.1); m3.add(lg);
    // the low couch: a deep daybed, a bolster at the back
    const upM = std(0xf2e4e2, { roughness: 0.9, map: clothTex('#efe0de') });
    const seat = new THREE.Mesh(softBox(1.9, 0.18, 1.75, 0.06, 8), upM); seat.position.set(0.15, SEAT_Y - 0.09, 0.12); m3.add(seat);
    const plinth = new THREE.Mesh(softBox(1.84, 0.16, 1.68, 0.02, 3), std(0xd9c9c4, { roughness: 0.6 })); plinth.position.set(0.15, 0.08, 0.12); m3.add(plinth);
    const bol = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 1.6, 8, 24), upM); bol.rotation.z = Math.PI / 2; bol.position.set(0.15, SEAT_Y + 0.08, 0.9); m3.add(bol);
    // two round chairs
    const tub = KIT.lathe([[0, 0], [0.3, 0], [0.32, 0.05], [0.33, 0.38], [0.36, 0.6], [0.33, 0.66], [0.29, 0.6], [0.27, 0.42], [0.2, 0.4], [0, 0.4]], 48);
    for (const [x, z] of [[1.3, -1.45], [-1.0, -1.7]]) { const c = new THREE.Mesh(tub, std(0xf4ecea, { roughness: 0.45 })); c.position.set(x, 0, z); m3.add(c); }
    // you, seated on the front edge: your own body placed in the room, the legs bent over the edge
    me3.position.copy(EYE); m3.add(me3); m3u.legs.visible = false;
    m3u.chest.children[1].visible = false;   // the bit of neck in the collar: from your own eyes the chin hides it
    const pj = m3u.legs.children[0].material;
    const legM = (a, b, r) => { const d = V(0, 0, 0).subVectors(b, a), m = new THREE.Mesh(new THREE.CapsuleGeometry(r, d.length(), 6, 18), pj); m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); m3.add(m); return m; };
    for (const s of [-1, 1]) {
      const hip = V(s * 0.1, SEAT_Y + 0.085, EYE.z + 0.04), knee = V(s * 0.11, SEAT_Y + 0.07, EYE.z - 0.43), ankle = V(s * 0.115, 0.07, EYE.z - 0.47);
      legM(hip, knee, 0.078); legM(knee, ankle, 0.055);
      const foot = new THREE.Mesh(softBox(0.09, 0.06, 0.22, 0.03, 4), std(0xc99c84, { roughness: 0.6 })); foot.position.set(s * 0.115, 0.03, EYE.z - 0.55); m3.add(foot);
    }
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.12, 6, 18), pj); pelvis.rotation.z = Math.PI / 2; pelvis.position.set(0, SEAT_Y + 0.1, EYE.z + 0.06); m3.add(pelvis);
    // the grey in the wig, seated beside you on the front edge, turned toward you; the shift and the wig
    seatGrey(her); her.position.set(0.56, SEAT_Y - SHIFT_SEAT * 1.08, -0.6); her.rotation.y = -2.53; m3.add(her);
    her.userData.head.add(wig); her.userData.root.add(shift.bodice); her.add(shift.skirt);
    // the one in the doorway
    door.position.set(-2.0, 0, -0.95); door.rotation.y = Math.PI / 2 - 0.25; m3.add(door);
  }
  // Your head turns on your neck. The camera is not turned on the spot at EYE: it is carried round a pivot 7 cm below and
  // 8 cm behind the eyes (in the body's frame, whichever way the body lies), as eyes are, so looking round, down or back
  // never puts the view inside or behind your own shoulders and collar. Uses the same limits the engine clamps to.
  const NECK = V(0, -0.07, 0.08), EYE_OFF = V(0, 0.07, -0.08), _nq = new THREE.Quaternion(), _ne = new THREE.Euler(0, 0, 0, 'YXZ'), _nv = V(0, 0, 0);
  on(() => {
    if (!m3.visible) return;
    if (E.limits) { E.yaw = Math.max(E.base.yaw - E.limits.yaw, Math.min(E.base.yaw + E.limits.yaw, E.yaw)); E.pitch = Math.max(E.base.pitch - E.limits.down, Math.min(E.base.pitch + E.limits.up, E.pitch)); }
    // seated, a head turned far round over a shoulder cannot also look far down (down to half the reach at the side)
    if (E.limits === SEATED) { const k = (E.yaw - E.base.yaw) / SEATED.yaw; E.pitch = Math.max(E.base.pitch - SEATED.down * (1 - 0.5 * k * k), E.pitch); }
    me3.updateMatrixWorld(true);
    _nq.setFromEuler(_ne.set(E.pitch, E.yaw, 0));
    me3.localToWorld(E.camera.position.copy(NECK)).add(_nv.copy(EYE_OFF).applyQuaternion(_nq));
  });
  const M3_LIGHT = [[0xfff0f0, 0xb89a9a, 1.1], [[0xffe2e2, 2.2, 5, 0, 2.1, -0.1], [0xffeeee, 1.4, 3.5, -2.4, 1.6, -0.9]]];
  const hu = her.userData;
  // her arms: resting on the lap, or (handK3 > 0) her right hand carried over the back of yours
  const lapR = V(0, 0, 0), lapL = V(0, 0, 0), yourBack = V(0, 0, 0), herTip = V(0, 0, 0), herPal = V(0, 0, 0), herFd = V(0, 0, 0), poleR = V(0, 0, 0), poleL = V(0, 0, 0), hq = new THREE.Quaternion();
  // handK: her right hand from her lap (0) to over yours (1); plantK: from her lap (0) to flat on the couch beside you (1);
  // lean / roll: forward and sideways from the hips; doorK: her eyes from you (0) to the doorway (1)
  const m3State = { handK: 0, plantK: 0, lean: 0, roll: 0, twist: 0, doorK: 0, askew: 0, gesture: 0 };
  const PLANT = V(0.5, SEAT_Y + 0.006, -0.05), lookPt = V(0, 0, 0), doorPt = V(0, 0, 0);
  // your right hand resting palm down on your right thigh, in the body's own frame
  const yourQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 1, 0), V(0, 0, 1), V(1, 0, 0)));
  const yourPalm = V(0.112, SEAT_Y + 0.07 + 0.078 + 0.012 - EYE.y, -0.25);
  const yourW = yourPalm.clone().sub(KIT.PALM.clone().applyQuaternion(yourQ));
  m3u.relax(0.05); m3u.ikRight(yourW, yourQ, V(0.7, -0.4, 0.5).normalize());
  { const l = m3u.armL; l.rotation.x += 0.25; }
  const herRest = () => {
    her.updateMatrixWorld(true);
    // her hands lie on her thighs, palm down, fingers toward the knees
    hu.root.localToWorld(lapR.set(0.052, 0.415, 0.205)); hu.root.localToWorld(lapL.set(-0.052, 0.415, 0.205));
  };
  const down = V(0, -1, 0), herFwd = V(0, 0, 0);
  const poseHer = () => {
    her.updateMatrixWorld(true);
    her.getWorldDirection(herFwd); herFwd.y = 0; herFwd.normalize();
    herRest();
    const rq = hu.root.getWorldQuaternion(hq);
    poleL.set(-1, -0.2, -0.4).applyQuaternion(rq).normalize();
    greyHand(her, 'L', lapL, down, herFwd, poleL, 0.18, 2);
    // the right hand: from the lap to over the back of your hand (yourBack), the fingers across it toward your thumb
    me3.updateMatrixWorld(true);
    m3u.handR.localToWorld(yourBack.set(0.016, -0.07, 0.004));
    const k = m3State.handK, p = m3State.plantK;
    herFd.copy(herFwd).lerp(V(-0.93, 0, -0.36).normalize(), sm3(0.2, 0.8, Math.max(k, p))).normalize();
    if (p > 0) { herTip.copy(lapR).lerp(PLANT, p); herTip.y += Math.sin(Math.PI * p) * 0.08; }
    else { herTip.copy(lapR).lerp(_kp.copy(yourBack).add(V(-0.03, 0.005, -0.006)), k); herTip.y += Math.sin(Math.PI * k) * 0.07; }
    poleR.set(1, -0.35, -0.5).applyQuaternion(rq).normalize();
    greyHand(her, 'R', herTip, down, herFd, poleR, 0.18 + 0.12 * Math.max(k, p * 0.4), 3);
  };
  on((dt, t) => {
    if (!m3.visible) return;
    leanSeated(her, m3State.lean, m3State.roll, m3State.twist);
    const b = Math.sin(t * 1.5) * 0.01; hu.chest.scale.set(1 + b, 1, 1 + b * 1.4);
    // her eyes: on you, or carried over to the doorway and back
    door.updateMatrixWorld(true); door.userData.head.getWorldPosition(doorPt);
    aimLeaning(her, lookPt.copy(E.camera.position).lerp(doorPt, m3State.doorK), 1);
    wig.userData.askew(m3State.askew);
    poseHer();
    // the one in the doorway: still, eyes on the two of you; the small gesture lifts one hand a little and lets it fall
    aimGrey(door, her.getWorldPosition(_kp).add(V(0, 0.8, 0)), 0.9);
    // (up over 0.3 of the move, held, down over the last quarter: the forearm lifts out from the side, the long fingers
    // open and tip forward once, toward the couch)
    const du = door.userData, q = m3State.gesture, gk = sm3(0, 0.3, q) * (1 - sm3(0.75, 1, q)), tip = Math.sin(Math.PI * sm3(0.35, 0.7, q));
    du.armR.rotation.set(-0.3 * gk, 0, 0.35 * gk + 0.04); du.foreR.rotation.set(-1.15 * gk, 0, 0); du.handR.rotation.set((0.2 + 0.5 * tip) * gk, 0, 0);
    gripGrey(door, 'R', 0.15 - 0.35 * gk);
  });

  // ---------- switching between the present and the memories ----------
  const SETS = { nur: [nur, NUR_LIGHT, 0x0c0605, 4, 14], m1: [m1, M1_LIGHT, 0x020807, 3, 20], m2: [m2, M2_LIGHT, 0xd9cdb4, 1e5, 2e5], m3: [m3, M3_LIGHT, 0xe8dcdc, 1e5, 2e5] };
  const show = (k) => {
    for (const [key, [grp]] of Object.entries(SETS)) grp.visible = key === k;
    const [, li, fc, fn, ff] = SETS[k]; lights(li[0], li[1]); setFog(fc, fn, ff);
    const now = k === 'nur'; me.visible = now; toy.visible = now && toyInHand !== null; toyL.intensity = now ? 0.12 : k === 'm1' ? 1.2 : 0; faceL.intensity = now ? 0.55 : 0;
    if (k === 'm1') toyL.position.copy(m1Toy.position);
  };
  show('nur');
  // developer-mode handles for the test drivers (shots/b157/reveal)
  if (window.UAP) window.UAP.reveal = { U, kidState, kid, care, mantis, her, door, wig, me3, m3State, m1Kid, m1Grey, m2Known, show, kidGaze, legs, upper, m2Gaze, m1Gaze, m2State, toy, clap, cst, kidSmile, get browVerts() { return kidBrowVerts; }, get mus() { return mus; } };
  // compile every set now, for the render target the frames go to, under the white
  E.renderer.setRenderTarget(E.draw.rt); warm(m1, m2, m3); E.renderer.setRenderTarget(null);
  for (const k of ['m1', 'm2', 'm3', 'nur']) { show(k); E.renderer.setRenderTarget(E.draw.rt); E.renderer.compile(E.scene, E.camera); E.renderer.setRenderTarget(null); }
  show('nur');

  // sound: the room, and the toy's hum, which grows as you come near the child
  const room = A.nursery ? A.nursery() : { stop() {} };
  const gift = A.aura(293.66); let giftLevel = 0.35;
  on(() => { if (me.visible) gift.set(giftLevel); });
  // the lullaby (A.music): one piece from the moment you come in to the mantis's last word, under everything
  let mus = null, humFree = 0;
  // a hum in time with the music: from the music's next bar 0 or 4 (and not before the last hum has ended), so the hummed
  // notes fall on the music's own; returns the game time of its first note and the bar it starts on (for the lips)
  const humSync = (voice, level, bars, o = {}) => {
    const now = A.clock, after = Math.max(now + 0.75, humFree);
    let at = after, from = 0;
    if (mus) { const t0 = mus.barTime(0, after), t4 = mus.barTime(4, after); [at, from] = t0 < t4 ? [t0, 0] : [t4, 4]; }
    humFree = at + A.hum(voice, level, { ...o, at, from, bars }) - (at - now);
    return { at: E.time + (at - now), from };
  };
  // memories are heard as if through a wall (the further back, the thicker)
  let muffle = 0;
  on(() => { if (muffle > 0.01) A._muffle(muffle); });
  // the toy's place on screen, for the bloom
  const atToy = (obj) => { const p = obj.getWorldPosition(V(0, 0, 0)).project(E.camera); U.uAt.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5); };
  // into a memory: the toy's light swells over everything, white, and the memory comes up out of it
  const enter = async (k, view, sounds, thick = 0.72) => {
    A.recall(2.6);
    if (mus) mus.set({ lead: 0.35 }, 2);   // the music goes on under the memory (muffled with it); its voice steps back for the hums
    giftLevel = 1;
    await tween(1.7, (q) => { atToy(toy); U.uBloom.value = q * q * 1.1; });
    await fade(1, 0.35, '#fff');
    U.uBloom.value = 0;
    show(k); view(); muffle = thick; U.uMem.value = 1;
    const s = sounds ? sounds() : [];
    await fade(0, 1.3, '#fff');
    return s;
  };
  // out of a memory, back into the nursery: white, then the present coming back with the memory still on it for a moment
  const leave = async (sounds, cut = 0.5) => {
    await fade(1, cut, '#fff');
    for (const s of sounds) s.stop(0.4);
    show('nur'); setView(KNEEL.x, KNEEL.y, KNEEL.z, KNEEL_AIM.yaw, KNEEL_AIM.pitch); E.mode = 'locked'; muffle = 0; U.uDim.value = 1;
    if (mus) mus.set({ lead: 0.85 }, 2);
    A.breath(true, 1.1, 0.4);
    tween(1.6, (q) => { U.uMem.value = 1 - q; });
    await fade(0, 1.0, '#fff');
  };

  // ========================= beat 1: the room, the child =========================
  setView(0, 1.6, 2.55, 0, -0.08); E.mode = 'locked';
  E.limits = { yaw: 0.9, up: 0.5, down: 0.6 };
  kidState.look = E.camera.position; kidState.lookAmt = 0.6;
  mus = A.music({ in: 0.9, levels: { lead: 0.85, chord: 0.8, low: 0.8, pluck: 0.8 } });
  await fade(0, 1.6, '#fff');
  E.mode = 'look';
  await say('Lower in the ship. A small round room, warm and dim. Everything in it is soft.');
  await say('The toy is still in your hand. It has started to hum again.');
  // the child sees you: the small dance
  kidState.lookAmt = 1;

  await tween(0.5, (q) => { kidState.dance = q; kidState.clapK = q; kidState.smile = q; });
  await say('By the cradle of light, the child. They see you and do a small, happy dance, wiggling from side to side and clapping.');
  await wait(2.4);
  await tween(0.9, (q) => { kidState.dance = 1 - q * 0.88; kidState.clapK = 1 - q; kidState.smile = 1 - 0.7 * q; });
  // walk to them; the hum grows as you come near
  E.base.yaw = 0; E.base.pitch = 0; E.limits = null; E.mode = 'walk';
  E.bounds = (x, z) => Math.hypot(x, z) < 2.7 && z > KID_P.z + 0.55 && Math.hypot(x - mantis.position.x, z - mantis.position.z) > 0.65 && Math.hypot(x - care.position.x, z - care.position.z) > 0.5;
  hint('W A S D to walk.');
  const walkT0 = E.time;
  await until(() => {
    giftLevel = 0.35 + 0.65 * Math.max(0, 1 - Math.hypot(E.camera.position.x - KID_P.x, E.camera.position.z - KID_P.z) / 3.4);
    return Math.hypot(E.camera.position.x - KID_P.x, E.camera.position.z - KID_P.z) < 1.15 || E.time - walkT0 > 16;
  });
  hint(''); E.mode = 'locked'; E.bounds = null;
  // you kneel in front of them
  const KNEEL = V(0, 0.86, KID_P.z + 0.66);   // eye to eye with the child, so their arms held out read as held out
  kid.updateMatrixWorld(true);
  const kidFace = ku.head.getWorldPosition(V(0, 0, 0));
  const KNEEL_AIM = (() => { const c = E.camera.position.clone(); E.camera.position.copy(KNEEL); const a = aimAt(kidFace.clone().add(V(0, -0.12, 0))); E.camera.position.copy(c); return a; })();
  await moveView(1.6, { pos: KNEEL, yaw: KNEEL_AIM.yaw, pitch: KNEEL_AIM.pitch });
  giftLevel = 0.85;
  E.limits = { yaw: 0.45, up: 0.35, down: 0.3 }; E.base.yaw = KNEEL_AIM.yaw; E.base.pitch = KNEEL_AIM.pitch; E.mode = 'look';
  await say('Up close, they are trying very hard to stand still.');
  // hold the toy out (E, or after a while it is held out anyway)
  hint('E — hold the toy out to them');
  E.canAct = true;
  { const t0 = E.time; await until(() => E.just.has('KeyE') || E.time - t0 > 9); }
  E.canAct = false; hint(''); E.mode = 'locked';
  tween(0.6, (q) => { kidState.dance = 0.12 * (1 - q); });
  // the palm goes out toward the child; their left hand comes up to it
  kid.updateMatrixWorld(true);
  const kSh = ku.armL.getWorldPosition(V(0, 0, 0));
  const offerP = V(-0.02, kSh.y - 0.04, KNEEL.z - 0.34);
  const carryP = carry(V(0, 0, 0));
  await tween(1.3, (q) => { palmTarget = palmTarget || V(0, 0, 0); palmTarget.lerpVectors(carryP, offerP, q); });
  const touchAt = V(0, 0, 0), towardKid = V(0, 0, 0);
  const kidTo = (k) => {
    towardKid.subVectors(kSh, toy.position); towardKid.y = 0; towardKid.normalize();
    // the fingers come down onto the top of the toy from the child's side, so they show over your fingers
    // (resting 5.6 cm from the toy's middle: the jewel's points reach 4.1 cm, and the finger runs about a centimetre past
    // the point solved for)
    touchAt.copy(toy.position).addScaledVector(towardKid, 0.02 + 0.12 * (1 - k)).add(V(0, 0.052 - 0.11 * (1 - k), 0));
    return kidArm(kid, 'L', touchAt, kst);
  };
  // the arm comes up from where it is to the solved touch (angles eased, so it never jumps), then is held there
  // The arm comes up (angles eased from where it is to a pose with the hand beside and below the toy, on the child's side,
  // so it never jumps), then the hand is solved every frame along kidTo's path up and over onto the top of the toy, and
  // held there. Taken away along the same path, then let down.
  const reachIn = async (dur) => {
    kidState.reach = true;
    const a = armPose(kid, 'L'); kidTo(0); const b = armPose(kid, 'L');
    setArmPose(kid, 'L', a);   // the solve left the arm at the end pose: back to the start for this frame
    await tween(dur * 0.45, (q) => { setArmPose(kid, 'L', a, b, q); });
    await tween(dur * 0.55, (q) => { kidTo(q); });
    tween(0.6, (q) => { toySpin = 1 - q; });
    return on(() => kidTo(1));
  };
  const reachOut = async (dur, off) => {
    off(); tween(0.8, (q) => { toySpin = q; });
    await tween(dur * 0.45, (q) => { kidTo(1 - q); });
    const a = armPose(kid, 'L'), rest = eulerPose(0, -REST_Z, -0.08);
    await tween(dur * 0.55, (q) => { setArmPose(kid, 'L', a, rest, q); });
    kidState.reach = false;
  };
  const holdKid = await reachIn(1.4);
  A.toyTouch();
  await wait(0.4);

  // ========================= the first memory: the toy given =========================
  let snd = await enter('m1', () => {
    setView(0, 1.08, -18.05, 0, 0); const a = aimAt(V(0.2, 0.8, -19.5)); setView(0, 1.08, -18.05, a.yaw, a.pitch);
    E.base.yaw = a.yaw; E.base.pitch = a.pitch; E.limits = { yaw: 0.55, up: 0.45, down: 0.3 }; E.mode = 'look'; m1State.shake = 0;
  }, () => { humSync(1, 0.3, 4, { pan: 0.15 }); return [A.drone(55, { type: 'triangle', g: 0.05 }), A.drone(700, { noise: true, g: 0.012, q: 6 })]; }, 0.8);
  await say('The hall. The child holding it out to you, the first time.');
  E.mode = 'locked';
  m1Grey.updateMatrixWorld(true);
  await lookToward(m1Grey.userData.head.getWorldPosition(V(0, 0, 0)), 1.6);
  await say('This time you see the grey behind them. They are not watching the child. They are watching you.');
  await lookToward(m1Held, 1.4);
  tween(1.2, (q) => { m1State.shake = q; });
  await say("And the child's hands are shaking.");
  await wait(0.8);
  await leave(snd);

  // ========================= the second memory: the stare =========================
  await wait(0.6);
  snd = await enter('m2', () => {
    m2State.turn = 0; m2State.mouth = 0;
    m2Known.updateMatrixWorld(true);
    const f = m2Known.userData.head.getWorldPosition(V(0, 0, 0));
    setView(0, 1.4, 1.3, 0, 0); const a = aimAt(f); setView(0, 1.4, 1.3, a.yaw, a.pitch);
    E.base.yaw = a.yaw; E.base.pitch = a.pitch; E.limits = { yaw: 0.5, up: 0.3, down: 0.3 }; E.mode = 'look';
  }, () => [A.drone(220, { g: 0.022 })], 0.66);
  await say('The classroom. The child in the circle glances round at you, as before.');
  await tween(1.4, (q) => { m2State.turn = q; });
  // the view closes in on their face while they hold it
  const fov0 = E.camera.fov;
  tween(7, (q) => { E.camera.fov = lerp(fov0, 46, q); E.camera.updateProjectionMatrix(); });
  await say('This time they do not look away.');
  // humming under their breath: the lips just parted, moving with the notes
  { const h = humSync(2, 0.7, 4); m2State.humAt = h.at; m2State.humFrom = h.from; }
  await say('Their lips are moving. They are humming, under their breath.');
  await until(() => E.time > m2State.humAt + 22 * A._T8 + 0.3, 16);
  m2State.humAt = 0;
  await leave(snd);
  E.camera.fov = fov0; E.camera.updateProjectionMatrix();

  // ========================= the third memory: years ago =========================
  await wait(0.6);
  let lull = null;
  snd = await enter('m3', () => {
    // made to look at the floor
    setView(EYE.x, EYE.y, EYE.z, 0.1, -0.85); E.mode = 'locked'; E.limits = null;
    Object.assign(m3State, { handK: 0, plantK: 0, lean: 0, roll: 0, twist: 0, doorK: 0, askew: 0, gesture: 0 }); lampU.uSoft.value = 0; U.uDim.value = 1;
  }, () => [A.drone(160, { noise: true, q: 0.7, g: 0.006 })], 0.5);
  note('wig');
  await say('An earlier night. Years ago.');
  humSync(0, 0.55, 4, { pan: 0.35 });
  await say('You are sitting. You cannot lift your head. You can only look at the floor.');
  await wait(0.6);
  // then let look up, at the one beside you
  her.updateMatrixWorld(true);
  const herFace = () => hu.head.getWorldPosition(V(0, 0, 0));
  await lookToward(herFace(), 2.4);
  E.base.yaw = 0; E.base.pitch = -0.1; E.limits = SEATED; E.mode = 'look';
  await say('Then you are allowed to look up. A small pale room. Someone sits beside you, close.');
  await say('A grey, in a wig. Glossy and black, cut straight across the brow.');
  await say("It is too small for the grey's great head, and sits on it slightly wrong.");
  humSync(0, 0.85, 4, { pan: 0.3 });
  await say("Don't be afraid.", 'them');
  await say("I'm like you.", 'them');
  // her hand comes over yours
  A.couch && A.couch(0.3);
  E.mode = 'locked';
  me3.updateMatrixWorld(true);
  lookToward(m3u.handR.localToWorld(V(0, -0.05, 0)), 1.6);
  await tween(2.4, (q) => { m3State.handK = q; });
  await say('Long fingers settle over the back of your hand. Cool, and very light.');
  await lookToward(herFace(), 1.4);
  E.base.yaw = 0; E.base.pitch = -0.1; E.limits = SEATED; E.mode = 'look';
  // the doorway: if you look, you see the cue given; either way, it is given and taken
  door.updateMatrixWorld(true);
  const doorHead = door.userData.head.getWorldPosition(V(0, 0, 0));
  say('Someone is standing in the doorway.');
  let seen = 0;
  { const t0 = E.time; await until(() => { seen = lookingAt(doorHead, 0.32) ? seen + 1 : 0; return seen > 12 || E.time - t0 > 7.5; }); }
  G.cued = seen > 12;
  if (G.cued) await wait(0.3);
  await tween(2.0, (q) => { m3State.gesture = q; }, (q) => q);
  // she takes it: a glance at the doorway, then back to you
  await tween(0.45, (q) => { m3State.doorK = q; });
  await wait(0.55);
  await tween(0.6, (q) => { m3State.doorK = 1 - q; });
  if (G.cued) await say('A small lift of the hand in the doorway. The grey beside you sees it, and turns back to you.');
  else await say('The grey beside you glances at the doorway, and back.');
  // lying back: her hand leaves yours, and you are back on the couch looking up
  await tween(1.4, (q) => { m3State.handK = 1 - q; });
  A.couch && A.couch(1);
  const hip = V(0, SEAT_Y + 0.085, EYE.z + 0.04), eyeOff = EYE.clone().sub(hip);
  { const qa = m3u.armR.quaternion.clone(), qf = m3u.foreR.quaternion.clone(), qh = m3u.handR.quaternion.clone();
    m3u.relax(0.12); const ra = m3u.armR.quaternion.clone(), rf = m3u.foreR.quaternion.clone(), rh = m3u.handR.quaternion.clone();
    tween(1.2, (q) => { m3u.armR.quaternion.slerpQuaternions(qa, ra, q); m3u.foreR.quaternion.slerpQuaternions(qf, rf, q); m3u.handR.quaternion.slerpQuaternions(qh, rh, q); }); }
  E.mode = 'locked'; E.limits = null;
  const y0 = E.yaw, p0 = E.pitch;
  await tween(2.8, (q) => {
    const a = q * 1.42;
    const eu = new THREE.Euler(a, 0.5 * q, 0, 'YXZ');
    me3.rotation.copy(eu); me3.position.copy(hip).add(eyeOff.clone().applyEuler(eu));
    E.yaw = lerp(y0, -0.25, q); E.pitch = lerp(p0, 1.25, q);
  });
  E.base.yaw = E.yaw; E.base.pitch = E.pitch; E.limits = { yaw: 0.8, up: 0.2, down: 0.5 }; E.mode = 'look';
  await say('You are lying back. You do not remember deciding to.');
  tween(3, (q) => { lampU.uSoft.value = q; glowU.uAmt.value = 0.35 - 0.15 * q; U.uDim.value = 1 - 0.75 * q * q * (3 - 2 * q); });   // linear light: 0.25 here is about half as bright to the eye
  await say('The light above you softens.');
  // she puts a hand flat on the couch beside you and leans in over you; the wig slips
  humSync(0, 1, 4, { pan: 0.15 });
  E.mode = 'locked';
  lookToward(herFace(), 1.6);
  await tween(3.6, (q) => { m3State.twist = 1.3 * sm3(0, 0.55, q); m3State.plantK = sm3(0.1, 0.55, q); m3State.lean = 0.5 * sm3(0.3, 1, q); m3State.roll = 0.3 * sm3(0.3, 1, q); m3State.askew = sm3(0.5, 1, q); }, (q) => q);
  lookToward(herFace(), 0.8);
  await say('As they lean over you, the wig slips.');
  await wait(0.4);
  await leave(snd, 0.25);
  me3.rotation.set(0, 0, 0); me3.position.copy(EYE);

  // ========================= back: the same notes =========================
  E.limits = { yaw: 0.45, up: 0.35, down: 0.3 }; E.base.yaw = KNEEL_AIM.yaw; E.base.pitch = KNEEL_AIM.pitch; E.mode = 'look';
  // the child lets go of the toy, and hums
  // their hand lifts off the toy first; then your open hand comes back in to where you carry it
  reachOut(1.2, holdKid);
  { const from = palmTarget.clone(), to = V(0, 0, 0);
    wait(0.6).then(() => tween(1.2, (q) => { palmTarget.lerpVectors(from, carry(to), q * q * (3 - 2 * q)); })).then(() => { palmTarget = null; }); }
  giftLevel = 0.6;
  // the child hums all eight bars with the music; its own voice steps back while they do
  const BAR = 6 * A._T8, hk = humSync(1, 0.8, 8);
  kidState.humAt = hk.at; kidState.humFrom = hk.from;
  if (mus) mus.set({ lead: 0.25 }, 1.5);
  await say('The child is humming. The same notes.');
  await until(() => E.time > hk.at + 4 * BAR + 0.2, 16);
  if (mus) mus.set({ lead: 0.9, chord: 1.2, low: 1.05, pluck: 1.1 }, 1.5);   // a small swell under it
  await say('This child is yours.', 'them');
  if (mus) mus.set({ chord: 0.85, low: 0.8, pluck: 0.8 }, 4);
  note('yours');
  await say('You knew it in the hall. You knew it in the classroom.');
  // the choice
  const c = await choose(['Reach for them.', 'Step back.', '(Say nothing.)']);
  if (c === 0) {
    G.trust += 1;
    moveView(0.9, { pos: KNEEL.clone().add(V(0, 0.02, -0.1)) });
    await tween(0.9, (q) => { kidState.back = 0.16 * q; });
    await say("Not yet. It's too soon to hold me.", 'them'); note('toosoon');
    // a touch on the toy instead: one fingertip
    await tween(0.7, (q) => { kidState.back = 0.16 * (1 - q * 0.6); });
    const h2 = await reachIn(0.9); A.toyTouch(); await wait(0.7); await reachOut(0.9, h2);
  } else if (c === 1) {
    G.trust -= 1;
    moveView(1.0, { pos: KNEEL.clone().add(V(0, 0.04, 0.22)) });
    kidState.look = toy.position; await tween(1.2, (q) => { kidState.tilt = 0.3 * q; });
    await say("The child's face falls. They look at the toy instead.");
    tween(1.5, (q) => { kidState.tilt = 0.3 * (1 - q); }).then(() => { kidState.look = E.camera.position; });
  } else {
    G.lucidity += 0.04;
    // they smile, and dance again: a small, shy version, half as big and slower, no claps
    tween(0.7, (q) => { kidState.smile = q; });
    kidState.danceF = 0.42;
    await tween(1.0, (q) => { kidState.dance = 0.5 * q; });
    await wait(3.6);
    await tween(1.0, (q) => { kidState.dance = 0.5 * (1 - q); });
    kidState.danceF = DANCE_F;
    tween(1.2, (q) => { kidState.smile = 1 - 0.6 * q; });
  }
  await say('We are sorry. They cannot go with you.', 'them');
  // the toy goes back to them: both hands come up in front of their chest, cupped round where it will rest, each hand's
  // end solved to under the toy's sides (8 cm from its middle, so every part of the hand stays clear of its points as it
  // turns, 5 cm out), and it crosses from your palm to float just over theirs
  kidState.back = Math.min(kidState.back, 0.07);
  await wait(0.1);
  kid.updateMatrixWorld(true);
  const shL = ku.armL.getWorldPosition(V(0, 0, 0)), shR = ku.armR.getWorldPosition(V(0, 0, 0)), across = shL.clone().sub(shR).setY(0).normalize();
  const kidFwd = V(-across.z, 0, across.x); if (kidFwd.dot(V(E.camera.position.x - kid.position.x, 0, E.camera.position.z - kid.position.z)) < 0) kidFwd.negate();
  const cupped = shL.clone().add(shR).multiplyScalar(0.5).addScaledVector(kidFwd, 0.2).add(V(0, -0.17, 0));
  const kstR = { x: 0, z: -0.03, f: -0.08 }, cupL = V(0, 0, 0), cupR = V(0, 0, 0);
  const cupTo = () => {
    cupL.copy(cupped).addScaledVector(across, 0.045).addScaledVector(kidFwd, -0.005).add(V(0, -0.068, 0));
    cupR.copy(cupped).addScaledVector(across, -0.045).addScaledVector(kidFwd, -0.005).add(V(0, -0.068, 0));
    kidArm(kid, 'L', cupL, kst); kidArm(kid, 'R', cupR, kstR);
  };
  {
    kidState.reach = true;
    const a = armPose(kid, 'L'), aR = armPose(kid, 'R'); cupTo();
    const b = armPose(kid, 'L'), bR = armPose(kid, 'R');
    const pose = (q) => { setArmPose(kid, 'L', a, b, q); setArmPose(kid, 'R', aR, bR, q); };
    pose(0);
    await tween(1.2, pose);
    on(() => cupTo());
  }
  toyInHand = false; const t0p = toy.position.clone();
  await tween(1.6, (q) => { toy.position.lerpVectors(t0p, cupped, q).add(V(0, Math.sin(Math.PI * q) * 0.05, 0)); toy.scale.setScalar(0.45 + 0.1 * q); });
  const hold = on((dt, t) => { toy.position.copy(cupped); toy.position.y += Math.sin(t * 1.3) * 0.004; });
  tween(1.2, (q) => { handK = 1 - q; });
  if (mus) { const [nb, nt] = mus.next(); A.toyTune({ at: nt, from: nb, to: nb + 2, oct: 4, gain: 0.45 }); }
  await say('It lifts out of your palm and settles in their hands.');
  await say("I'll keep it till you come back.", 'them');
  // the mantis at the door: why they take you on now
  mantis.updateMatrixWorld(true);
  E.mode = 'locked'; E.limits = null;
  const mHead = mantis.userData.head.getWorldPosition(V(0, 0, 0));
  await lookToward(mHead, 1.4);
  await say('You have a child among us now.', 'them');
  await say("Those above us have asked to see the child's parent.", 'them');
  await say('Come.', 'them');
  if (mus) { mus.stop(5); mus = null; }   // the lullaby ends with the word
  const toM = V(mantis.position.x, 0, mantis.position.z).sub(V(E.camera.position.x, 0, E.camera.position.z)), dM = toM.length();
  const stand = V(E.camera.position.x, 1.6, E.camera.position.z).addScaledVector(toM.normalize(), dM - 1.32);
  const sAim = (() => { const c0 = E.camera.position.clone(); E.camera.position.copy(stand); const a = aimAt(V(mantis.position.x, 1.55, mantis.position.z)); E.camera.position.copy(c0); return a; })();
  await moveView(2.6, { pos: stand, yaw: sAim.yaw, pitch: sAim.pitch, walk: true });
  hold();
  // square to you before the reach: eased over the shortest way round, then held facing you
  { mantisTrack = 0; mantisOnYou = true; const r0 = mantis.rotation.y; let dr = mantisFacing(E.camera.position) - r0; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    await tween(0.8, (q) => { mantis.rotation.y = r0 + dr * q; }); mantisTrack = 3; }
  // their finger in your palm, as before
  const held = V(0, 0, 0), shoulder = V(0, 0, 0), palm = V(0, 0, 0);
  handK = 0; palmTarget = held; const mtu = mantis.userData;
  await tween(2.6, (k) => {
    E.camera.getWorldDirection(fw); fw.y = 0; fw.normalize();
    held.copy(E.camera.position).addScaledVector(fw, 0.42).add(V(-fw.z * 0.06, -0.3, fw.x * 0.06));
    handK = Math.min(1, k * 1.2);
    if (mtu.setFold) mtu.setFold(1 - Math.min(1, k * 1.2));
    if (mtu.reachTo) {
      const r = Math.min(1, Math.max(0, (k - 0.15) / 0.8)), r2 = Math.min(1, Math.max(0, (k - 0.05) / 0.7));
      E.camera.updateMatrixWorld(true); mu.handR.localToWorld(palm.copy(KIT.PALM));
      shoulder.copy(E.camera.position).addScaledVector(fw, -0.06).add(V(fw.z * 0.2, -0.23, -fw.x * 0.2));
      mtu.reachTo(palm, r * r * (3 - 2 * r), 1); mtu.curl(1, Math.min(1, r * 1.5), true);
      mtu.reachTo(shoulder, r2 * r2 * (3 - 2 * r2), -1); mtu.curl(-1, 0.3 * r2, true);
    }
  }, (k) => k);
  A.clicks(3);
  A.hum(1, 0.4, { pan: -0.4 });
  await say('One long finger rests in your open palm. Behind you, the child is humming.');
  room.stop(2); gift.stop(2);
  await fade(1, 2.2, '#fff');
  return 'mandala';
}
