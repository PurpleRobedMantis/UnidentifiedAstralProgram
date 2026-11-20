// Everything visible is built here in code: sculpted BufferGeometry, lathes, merged parts and canvas-drawn textures.
// Geometry, materials and textures are cached at module level, so ten greys share one set of buffers.
import * as THREE from 'three';

const PI = Math.PI, TAU = PI * 2;

// ---------- small maths ----------
let _seed = 1;
const seed = (s) => { _seed = (s >>> 0) || 1; };
const rand = () => { _seed = (_seed + 0x6D2B79F5) | 0; let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rr = (a, b) => a + rand() * (b - a);
const rnd = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Catmull-Rom through [y, value] pairs (y increasing)
function profileAt(pts, y) {
  let i = 0; while (i < pts.length - 2 && y > pts[i + 1][0]) i++;
  const p0 = pts[Math.max(0, i - 1)][1], p1 = pts[i][1], p2 = pts[i + 1][1], p3 = pts[Math.min(pts.length - 1, i + 2)][1];
  const t = Math.min(1, Math.max(0, (y - pts[i][0]) / (pts[i + 1][0] - pts[i][0])));
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

// ---------- canvas textures ----------
const canvases = new Map();
function paint(key, w, h, draw) {
  let c = key ? canvases.get(key) : null;
  if (!c) { c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); if (key) canvases.set(key, c); }
  return c;
}
function wrapTex(c, repeat, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
// T.* hands out a fresh Texture each call (scenes change repeat/offset) but the drawing is done once per argument set
const tex = (key, w, h, draw, repeat) => wrapTex(paint(key, w, h, draw), repeat);
const texCache = new Map();
const ctex = (key, w, h, draw, repeat) => { let t = texCache.get(key); if (!t) { t = tex(key, w, h, draw, repeat); t.userData.keep = true; texCache.set(key, t); } return t; };
// the same for non-colour data (bump maps): linear, cached, kept
const ctexL = (key, w, h, draw, repeat) => { let t = texCache.get(key + 'T'); if (!t) { t = wrapTex(paint(key, w, h, draw), repeat, false); t.userData.keep = true; texCache.set(key + 'T', t); } return t; };
// a dim equirect "room" with a few soft lights: gives metal, wet eyes and glossy chitin something to reflect
const studioEnv = () => { let t = texCache.get('studioEnvT'); if (!t) {
  t = wrapTex(paint('studioEnv', 256, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#8e8c96'); gr.addColorStop(0.42, '#3a3940'); gr.addColorStop(0.55, '#1c1a18'); gr.addColorStop(1, '#0a0908');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (const [x, y, r, a] of [[0.22, 0.24, 26, 0.95], [0.68, 0.3, 18, 0.65], [0.48, 0.07, 40, 0.5], [0.9, 0.36, 12, 0.5]]) { const rg = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, r); rg.addColorStop(0, `rgba(255,248,236,${a})`); rg.addColorStop(1, 'rgba(255,248,236,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, h); }
  }), null, true);
  t.mapping = THREE.EquirectangularReflectionMapping; t.userData.keep = true; texCache.set('studioEnvT', t); } return t; };

// one alien glyph as a Path2D, built from a couple of primitives
function glyphPath(cx, cy, s, r = Math.random) {
  const p = new Path2D();
  const k = Math.floor(r() * 9);
  if (k === 0) { p.moveTo(cx + s * 0.8, cy); p.arc(cx, cy, s * 0.8, 0, 3 + r() * 2.6); }
  else if (k === 1) { p.moveTo(cx - s, cy - s * 0.7); p.lineTo(cx + s, cy - s * 0.7); p.lineTo(cx, cy + s); p.closePath(); }
  else if (k === 2) { p.moveTo(cx - s * 0.8, cy + s * 0.8); p.lineTo(cx, cy - s * 0.9); p.lineTo(cx + s * 0.8, cy + s * 0.8); p.moveTo(cx, cy - s * 0.9); p.lineTo(cx, cy + s); }
  else if (k === 3) { p.moveTo(cx - s, cy); p.bezierCurveTo(cx - s * 0.4, cy - s * 1.4, cx + s * 0.4, cy + s * 1.4, cx + s, cy); }
  else if (k === 4) { for (const dx of [-0.7, 0, 0.7]) { p.moveTo(cx + dx * s, cy - s * (dx ? 0.8 : 0.4)); p.lineTo(cx + dx * s, cy + s * 0.8); } }
  else if (k === 5) { p.moveTo(cx + s, cy); p.ellipse(cx, cy, s, s * 0.5, 0, 0, TAU); p.moveTo(cx + s * 0.22, cy); p.arc(cx, cy, s * 0.22, 0, TAU); }
  else if (k === 6) { p.moveTo(cx + s * 0.8 * Math.cos(0.7), cy + s * 0.8 * Math.sin(0.7)); p.arc(cx, cy, s * 0.8, 0.7, TAU - 0.7); p.moveTo(cx + s * 0.6, cy); p.lineTo(cx - s * 0.2, cy); }
  else if (k === 7) { p.moveTo(cx, cy); for (let a = 0; a < 4 * PI; a += 0.3) { const q = a / (4 * PI) * s; p.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q); } }
  else { p.moveTo(cx - s, cy); p.lineTo(cx + s, cy); p.moveTo(cx, cy - s); p.lineTo(cx, cy + s); p.moveTo(cx + s, cy); p.lineTo(cx + s, cy - s * 0.5); p.moveTo(cx - s, cy); p.lineTo(cx - s, cy + s * 0.5); }
  const a = r();
  if (a < 0.3) { p.moveTo(cx + 3, cy - s * 1.3); p.arc(cx, cy - s * 1.3, 3, 0, TAU); }
  else if (a < 0.55) { p.moveTo(cx - s * 0.6, cy + s * 1.25); p.lineTo(cx + s * 0.6, cy + s * 1.25); }
  return p;
}
function drawGlyphs(g, w, h) {
  g.clearRect(0, 0, w, h); g.lineCap = 'round'; g.lineJoin = 'round';
  for (const x of [9, w - 9]) { g.fillStyle = '#3a2405'; g.fillRect(x - 4, 0, 8, h); g.fillStyle = '#f2cf6b'; g.fillRect(x - 2, 0, 4, h); }
  for (let y = 32; y < h; y += 64) {
    const p = glyphPath(w / 2, y, 21);
    g.strokeStyle = '#3a2405'; g.lineWidth = 11; g.stroke(p);
    g.strokeStyle = '#f2cf6b'; g.lineWidth = 5.5; g.stroke(p);
    g.strokeStyle = 'rgba(255,250,215,.85)'; g.lineWidth = 1.6; g.stroke(p);
    g.fillStyle = '#f2cf6b'; for (const x of [9, w - 9]) { g.beginPath(); g.arc(x, y + 32, 5, 0, TAU); g.fill(); }
  }
}

export const T = {
  stars: (n = 220, bright = 1) => tex(`stars:${n}:${bright}`, 512, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) {
      const x = rnd(0, w), y = rnd(0, h), r = rnd(60, 180), col = ['90,60,200', '40,90,200', '160,60,180'][i % 3];
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${col},${0.09 * bright})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
    for (let i = 0; i < n * 2; i++) { g.fillStyle = `rgba(255,255,255,${rnd(0.08, 0.3) * bright})`; g.fillRect(rnd(0, w), rnd(0, h), 1, 1); }
    for (let i = 0; i < n; i++) {
      const x = rnd(0, w), y = rnd(0, h), k = Math.random(), a = Math.min(1, rnd(0.45, 1) * bright), tint = ['255,255,255', '200,220,255', '255,236,200', '225,205,255'][i % 4];
      if (k < 0.8) { g.fillStyle = `rgba(${tint},${a})`; const s = rnd(0.9, 2.2); g.fillRect(x, y, s, s); continue; }
      const r = rnd(2, 5), gr = g.createRadialGradient(x, y, 0, x, y, r * 2.4);
      gr.addColorStop(0, `rgba(${tint},${a})`); gr.addColorStop(0.3, `rgba(${tint},${a * 0.45})`); gr.addColorStop(1, `rgba(${tint},0)`);
      g.fillStyle = gr; g.fillRect(x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8);
      if (k > 0.95) { g.strokeStyle = `rgba(${tint},${a * 0.7})`; g.lineWidth = 1; g.beginPath(); g.moveTo(x - r * 3, y); g.lineTo(x + r * 3, y); g.moveTo(x, y - r * 3); g.lineTo(x, y + r * 3); g.stroke(); }
    }
  }),
  static: () => tex('static', 256, 256, (g) => { const d = g.createImageData(256, 256); for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = Math.random() * 255; } g.putImageData(d, 0, 0); }, [8, 1]),
};

// ---------- internal textures (cached) ----------
// draw f() once, plus wrapped copies wherever a shape of radius r crosses an edge, so the texture tiles without a seam
function wrapAt(g, w, h, x, y, r, f) { for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { if (x + ox + r < 0 || x + ox - r > w || y + oy + r < 0 || y + oy - r > h) continue; g.save(); g.translate(ox, oy); f(); g.restore(); } }
function drawGreySkin(g, w, h, bump) {
  seed(11); g.fillStyle = bump ? '#808080' : '#e4e8ea'; g.fillRect(0, 0, w, h);
  // mottling: soft cool blotches, paler patches, a faint warm flush here and there
  for (let i = 0; i < (bump ? 160 : 420); i++) {
    const x = rr(0, w), y = rr(0, h), r = rr(8, 70), q = rand(), gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, bump ? (q < 0.5 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.06)') : q < 0.45 ? 'rgba(100,114,136,.09)' : q < 0.82 ? 'rgba(255,255,255,.1)' : 'rgba(176,150,156,.07)');
    gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; wrapAt(g, w, h, x, y, r, () => g.fillRect(x - r, y - r, 2 * r, 2 * r));
  }
  g.lineCap = 'round';
  if (!bump) for (let i = 0; i < 34; i++) { let x = rr(0, w), y = rr(0, h); const x0 = x, y0 = y, pts = [[x, y]]; g.strokeStyle = `rgba(80,100,150,${rr(0.05, 0.1)})`; g.lineWidth = rr(0.6, 1.6); for (let k = 0; k < 6; k++) { x += rr(-30, 30); y += rr(-30, 30); pts.push([x, y]); } wrapAt(g, w, h, x0, y0, 180, () => { g.beginPath(); for (const [px, py] of pts) g.lineTo(px, py); g.stroke(); }); }
  // fine creases: little bunches of near-parallel lines, mostly running across
  for (let i = 0; i < 80; i++) {
    const x = rr(0, w), y = rr(0, h), n = 3 + Math.floor(rand() * 4), L = rr(14, 44), sp = rr(2.5, 4.5);
    const rot = rr(-0.35, 0.35), ls = [];
    for (let k = 0; k < n; k++) ls.push([L * rr(0.5, 1), k * sp, rr(-3, 3), bump ? rr(0.9, 1.5) : rr(0.6, 1)]);
    wrapAt(g, w, h, x, y, 50, () => { g.translate(x, y); g.rotate(rot);
    for (const [l, oy, c, lw] of ls) {
      g.beginPath(); g.moveTo(-l / 2, oy); g.quadraticCurveTo(0, oy + c, l / 2, oy);
      g.strokeStyle = bump ? 'rgba(20,20,20,.5)' : 'rgba(70,80,96,.14)'; g.lineWidth = lw; g.stroke();
      if (bump) { g.beginPath(); g.moveTo(-l / 2, oy - 1.3); g.quadraticCurveTo(0, oy + c - 1.3, l / 2, oy - 1.3); g.strokeStyle = 'rgba(230,230,230,.28)'; g.lineWidth = 0.8; g.stroke(); }
    }
    });
  }
  // pores and grain
  for (let i = 0; i < 9000; i++) {
    const x = rr(0, w), y = rr(0, h);
    if (bump) { g.fillStyle = rand() < 0.75 ? 'rgba(0,0,0,.4)' : 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(x, y, rr(0.5, 1.1), 0, TAU); g.fill(); }
    else { g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,.075)' : 'rgba(255,255,255,.08)'; g.fillRect(x, y, 1.2, 1.2); }
  }
}
const greySkinTex = () => ctex('greySkin3', 512, 512, (g, w, h) => drawGreySkin(g, w, h, false), [2, 2]);
const greySkinBump = () => ctexL('greySkinBump3', 512, 512, (g, w, h) => drawGreySkin(g, w, h, true), [2, 2]);
// waxy, faintly translucent skin: a sheen, a thin clearcoat, and light that seems to come up through the edges
const greySkinMat = (color) => {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, map: greySkinTex(), bumpMap: greySkinBump(), bumpScale: 0.8, sheen: 0.7, sheenColor: new THREE.Color(0xd4e0ec), sheenRoughness: 0.42, clearcoat: 0.12, clearcoatRoughness: 0.5 });
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    { float fr = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.5); totalEmissiveRadiance += diffuseColor.rgb * vec3(0.55, 0.62, 0.72) * fr * 0.09; }`); };
  return m;
};
// the eyes: near-black glass with a faint deep blue-grey in the middle
const greyEyeTex = () => ctex('greyEye', 128, 64, (g, w, h) => {
  const gr = g.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, w * 0.5); gr.addColorStop(0, '#2a3446'); gr.addColorStop(0.35, '#121822'); gr.addColorStop(0.75, '#05070a'); gr.addColorStop(1, '#020203');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const glintTex = () => ctex('glintSoft', 64, 64, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });

const brocadeTex = () => ctex('brocade', 512, 512, (g, w, h) => {
  g.fillStyle = '#d6d6d6'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 4) { g.fillStyle = x % 8 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)'; g.fillRect(x, 0, 2, h); }
  g.lineCap = 'round'; g.lineJoin = 'round';
  // ogee lattice: pairs of sine curves around each column
  for (let cx = 0; cx <= w; cx += 128) for (const sg of [-1, 1]) {
    g.beginPath(); for (let y = 0; y <= h; y += 4) { const x = cx + sg * 40 * Math.sin(y * TAU / 128); y ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = '#8c8c8c'; g.lineWidth = 8; g.stroke(); g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#ffffff'; for (let y = 8; y < h; y += 16) { g.beginPath(); g.arc(cx + sg * 40 * Math.sin(y * TAU / 128) + sg * 9, y, 1.8, 0, TAU); g.fill(); }
  }
  for (let cx = 0; cx <= w; cx += 128) for (let k = 0; k < 8; k++) {
    const cy = 32 + k * 64; g.save(); g.translate(cx, cy);
    if (k % 2 === 0) {
      for (let i = 0; i < 8; i++) { g.save(); g.rotate(i * TAU / 8); g.beginPath(); g.ellipse(0, 13, 4.5, 11, 0, 0, TAU); g.fillStyle = '#f2f2f2'; g.fill(); g.strokeStyle = '#7a7a7a'; g.lineWidth = 1.5; g.stroke(); g.restore(); }
      g.beginPath(); g.arc(0, 0, 5.5, 0, TAU); g.fillStyle = '#fff'; g.fill(); g.stroke();
    } else {
      g.beginPath(); g.moveTo(-19, 0); g.quadraticCurveTo(0, -15, 19, 0); g.quadraticCurveTo(0, 15, -19, 0); g.fillStyle = '#eeeeee'; g.fill(); g.strokeStyle = '#6e6e6e'; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.arc(0, 0, 5.5, 0, TAU); g.fillStyle = '#7e7e7e'; g.fill(); g.beginPath(); g.arc(-1.5, -1.5, 1.6, 0, TAU); g.fillStyle = '#fff'; g.fill();
      for (const sy of [-1, 1]) { g.beginPath(); g.moveTo(-8, sy * 11); g.lineTo(0, sy * 18); g.lineTo(8, sy * 11); g.strokeStyle = '#8a8a8a'; g.lineWidth = 1.5; g.stroke(); }
    }
    g.restore();
    g.save(); g.translate(cx + 64, cy); g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 0); g.lineTo(0, 8); g.lineTo(-6, 0); g.closePath(); g.fillStyle = '#ececec'; g.fill(); g.strokeStyle = '#7a7a7a'; g.lineWidth = 1.5; g.stroke(); g.restore();
  }
}, [5, 4]);

function drawChitin(g, w, h, bump) {
  seed(5); g.fillStyle = bump ? '#808080' : '#e2eed2'; g.fillRect(0, 0, w, h);
  if (!bump) for (let i = 0; i < 120; i++) { const x = rr(0, w), y = rr(0, h), r = rr(14, 60), gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rand() < 0.5 ? 'rgba(80,110,40,.14)' : 'rgba(255,255,210,.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  // overlapping plates: a dark groove, a lit lip, then the plate curving away
  for (let y = 0; y < h; y += 64) {
    const gr = g.createLinearGradient(0, y, 0, y + 64);
    if (bump) { gr.addColorStop(0, '#3c3c3c'); gr.addColorStop(0.07, '#d8d8d8'); gr.addColorStop(0.45, '#a4a4a4'); gr.addColorStop(1, '#6a6a6a'); }
    else { gr.addColorStop(0, 'rgba(40,60,20,.4)'); gr.addColorStop(0.06, 'rgba(255,255,230,.32)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(40,60,20,.16)'); }
    g.fillStyle = gr; g.fillRect(0, y, w, 64);
  }
  // fine lengthwise striations
  for (let i = 0; i < 150; i++) { const x = rr(0, w); g.strokeStyle = bump ? `rgba(${rand() < 0.5 ? '30,30,30' : '220,220,220'},${rr(0.15, 0.35)})` : `rgba(60,80,30,${rr(0.05, 0.16)})`; g.lineWidth = rr(0.6, 2.4); g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + rr(-8, 8), h / 3, x + rr(-8, 8), h * 2 / 3, x, h); g.stroke(); }
  // pits and grain
  for (let i = 0; i < 2600; i++) { const x = rr(0, w), y = rr(0, h), dk = rand() < 0.6; g.fillStyle = bump ? (dk ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.3)') : (dk ? 'rgba(30,50,10,.16)' : 'rgba(255,255,220,.14)'); g.beginPath(); g.arc(x, y, rr(0.6, 1.7), 0, TAU); g.fill(); }
}
const chitinTex = () => ctex('chitin2', 512, 512, (g, w, h) => drawChitin(g, w, h, false), [2, 2]);
const chitinBump = () => ctexL('chitinBump', 512, 512, (g, w, h) => drawChitin(g, w, h, true), [2, 2]);
// the robe's relief: the brocade pattern raised, over a fine over-under weave
const robeBump = () => ctexL('robeBump', 512, 512, (g, w, h) => {
  g.drawImage(brocadeTex().image, 0, 0, w, h);
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) { g.fillStyle = ((x + y) / 3) % 2 ? 'rgba(0,0,0,.16)' : 'rgba(255,255,255,.12)'; g.fillRect(x, y, 3, 1.5); g.fillStyle = ((x + y) / 3) % 2 ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.16)'; g.fillRect(x, y + 1.5, 3, 1.5); }
}, [5, 4]);

const floorTex = () => ctex('floor', 1024, 1024, (g, w, h) => {
  seed(31); const rowH = 64;
  for (let row = 0; row < h / rowH; row++) {
    const y = row * rowH; let x = rr(0, w); const end = x + w;
    while (x < end) {
      const len = rr(260, 620), l = Math.min(len, end - x), L = rr(28, 40), hue = rr(22, 32), sat = rr(32, 46);
      for (const ox of [x, x - w]) {
        if (ox + l < 0 || ox > w) continue;
        g.save(); g.beginPath(); g.rect(ox, y, l, rowH); g.clip();
        g.fillStyle = `hsl(${hue},${sat}%,${L}%)`; g.fillRect(ox, y, l, rowH);
        seed(row * 977 + Math.floor(x));
        for (let k = 0; k < 16; k++) { const gy = y + rr(0, rowH), a = rr(0.05, 0.18); g.strokeStyle = rand() < 0.7 ? `rgba(40,22,10,${a})` : `rgba(255,220,180,${a * 0.6})`; g.lineWidth = rr(0.6, 2.2); g.beginPath(); g.moveTo(ox, gy); for (let s = 0; s <= l; s += 24) g.lineTo(ox + s, gy + Math.sin(s * 0.02 + k) * rr(1, 4)); g.stroke(); }
        if (rand() < 0.35) { const kx = ox + rr(30, l - 30), ky = y + rr(16, rowH - 16); for (let r = 9; r > 1; r -= 2.5) { g.strokeStyle = 'rgba(40,20,8,.35)'; g.lineWidth = 1.2; g.beginPath(); g.ellipse(kx, ky, r * 1.8, r * 0.7, 0, 0, TAU); g.stroke(); } }
        g.fillStyle = 'rgba(15,8,4,.85)'; g.fillRect(ox, y, 2, rowH);
        g.restore();
      }
      x += len;
    }
    g.fillStyle = 'rgba(12,6,3,.9)'; g.fillRect(0, y, w, 2); g.fillStyle = 'rgba(255,230,200,.08)'; g.fillRect(0, y + 2, w, 1);
  }
}, [2.5, 3]);

const woodTex = () => ctex('wood', 512, 512, (g, w, h) => {
  seed(41); g.fillStyle = '#8a6446'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 110; i++) { const x = rr(0, w), a = rr(0.06, 0.22); g.strokeStyle = rand() < 0.75 ? `rgba(45,25,12,${a})` : `rgba(255,215,170,${a * 0.5})`; g.lineWidth = rr(0.5, 2.6); g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= h; y += 16) g.lineTo(x + Math.sin(y * 0.012 + i) * 5, y); g.stroke(); }
  for (let i = 0; i < 3; i++) { const cx = rr(80, w - 80), cy = rr(0, h); for (let r = 20; r < 110; r += 9) { g.strokeStyle = 'rgba(45,25,12,.14)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(cx, cy, r * 0.35, r, 0, PI * 1.1, PI * 1.9); g.stroke(); } }
});

const fabricTex = () => ctex('fabric', 256, 256, (g, w, h) => {
  seed(51); g.fillStyle = '#ececec'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { g.fillStyle = ((x + y) / 4) % 2 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.06)'; g.fillRect(x, y, 4, 2); g.fillRect(x + 2, y + 2, 2, 2); }
  for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(0,0,0,.04)'; g.lineWidth = 1; const y = rr(0, h); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + rr(-2, 2)); g.stroke(); }
}, [4, 4]);

const quiltTex = () => ctex('quilt', 512, 512, (g, w, h) => {
  seed(61); g.fillStyle = '#e2e2e2'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 128) for (let y = 0; y < h; y += 128) {
    const gr = g.createRadialGradient(x + 64, y + 64, 6, x + 64, y + 64, 90); gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(0,0,0,.12)'); g.fillStyle = gr; g.fillRect(x, y, 128, 128);
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1.5; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(x + 64, y + 14); g.lineTo(x + 114, y + 64); g.lineTo(x + 64, y + 114); g.lineTo(x + 14, y + 64); g.closePath(); g.stroke();
    g.beginPath(); g.arc(x + 64, y + 64, 12, 0, TAU); g.stroke(); g.setLineDash([]);
  }
  for (let i = 0; i <= w; i += 128) { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(i - 1, 0, 3, h); g.fillRect(0, i - 1, w, 3); }
  for (let i = 0; i < 5000; i++) { g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.06)'; g.fillRect(rr(0, w), rr(0, h), 2, 1); }
}, [3, 3]);

const pyjamaTex = () => ctex('pyjama2', 256, 256, (g, w, h) => {
  seed(111); g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 64) { g.fillStyle = '#a7b6d6'; g.fillRect(x + 6, 0, 16, h); g.fillStyle = '#7f8fb5'; g.fillRect(x + 30, 0, 3, h); }
  for (let y = 0; y < h; y += 3) { g.fillStyle = 'rgba(0,0,0,.035)'; g.fillRect(0, y, w, 1); }
  // soft folds: long slanted shadows and highlights, wrapped so the tile stays seamless
  for (let i = 0; i < 9; i++) {
    const x = rr(0, w), y = rr(0, h), len = rr(60, 150), a = rr(-0.5, 0.5), dark = rand() < 0.6;
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
      g.save(); g.translate(x + ox, y + oy); g.rotate(a);
      const gr = g.createLinearGradient(-10, 0, 10, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, dark ? 'rgba(20,30,60,.13)' : 'rgba(255,255,255,.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(-10, -len / 2, 20, len); g.restore();
    }
  }
}, [3, 2]);
// non-colour bump tiles (linear, not sRGB)
const weaveBump = () => { let t = texCache.get('weaveBumpT'); if (!t) { t = wrapTex(paint('weave', 128, 128, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { g.fillStyle = ((x + y) / 4) % 2 ? '#b0b0b0' : '#5a5a5a'; g.fillRect(x, y, 4, 2); g.fillStyle = ((x + y) / 4) % 2 ? '#5a5a5a' : '#b0b0b0'; g.fillRect(x, y + 2, 4, 2); } }), [14, 14], false); t.userData.keep = true; texCache.set('weaveBumpT', t); } return t; };
// skin: warm, slightly uneven tone with faint veins and pores (near-white, tinted by vertex/material colour)
const skinTex = () => ctex('skin2', 256, 256, (g, w, h) => {
  seed(121); g.fillStyle = '#f4ece8'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 160; i++) { const x = rr(0, w), y = rr(0, h), r = rr(8, 40), gr = g.createRadialGradient(x, y, 0, x, y, r), k = rand(); gr.addColorStop(0, k < 0.45 ? 'rgba(210,90,80,.07)' : k < 0.7 ? 'rgba(90,110,170,.05)' : 'rgba(255,250,240,.09)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  g.lineCap = g.lineJoin = 'round'; g.filter = 'blur(3px)';
  for (let i = 0; i < 6; i++) { let x = rr(0, w), y = rr(0, h); const a = rr(0, TAU); g.strokeStyle = 'rgba(100,115,150,.07)'; g.lineWidth = rr(4, 7); g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += Math.cos(a) * 22 + rr(-6, 6); y += Math.sin(a) * 22 + rr(-6, 6); g.lineTo(x, y); } g.stroke(); }
  g.filter = 'none';
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(140,80,50,.18)'; g.beginPath(); g.arc(rr(0, w), rr(0, h), rr(0.6, 1.4), 0, TAU); g.fill(); }
  for (let i = 0; i < 3000; i++) { g.fillStyle = rand() < 0.5 ? 'rgba(90,40,30,.06)' : 'rgba(255,255,255,.07)'; g.fillRect(rr(0, w), rr(0, h), 1, 1); }
}, [2, 2]);
// a small puncture mark: dark centre, raw red ring, faint bruised halo
const punctureTex = () => ctex('puncture', 64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(40,4,4,1)'); gr.addColorStop(0.18, 'rgba(70,10,8,1)'); gr.addColorStop(0.32, 'rgba(150,30,26,.95)'); gr.addColorStop(0.55, 'rgba(185,70,62,.5)'); gr.addColorStop(0.8, 'rgba(170,90,110,.18)'); gr.addColorStop(1, 'rgba(170,90,110,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,220,210,.35)'; g.beginPath(); g.arc(27, 27, 3, 0, TAU); g.fill();
});

const hairTex = () => ctex('hair', 256, 256, (g, w, h) => {
  seed(71); g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) { const x = rr(0, w); g.strokeStyle = rand() < 0.6 ? `rgba(0,0,0,${rr(0.1, 0.3)})` : `rgba(255,255,255,${rr(0.1, 0.35)})`; g.lineWidth = rr(0.6, 1.8); g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x + rr(-12, 12), h / 2, x + rr(-6, 6), h); g.stroke(); }
}, [3, 1]);

const rugTex = () => ctex('rug', 1024, 512, (g, w, h) => {
  g.fillStyle = '#6a1f24'; g.fillRect(0, 0, w, h);
  g.lineJoin = 'round';
  // field lattice of small diamonds
  for (let x = 0; x < w; x += 48) for (let y = 0; y < h; y += 48) { const ox = x + ((y / 48) % 2 ? 24 : 0); g.beginPath(); g.moveTo(ox, y - 12); g.lineTo(ox + 9, y); g.lineTo(ox, y + 12); g.lineTo(ox - 9, y); g.closePath(); g.fillStyle = '#842c31'; g.fill(); g.strokeStyle = '#3a1216'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#c9a34a'; g.fillRect(ox - 1.5, y - 1.5, 3, 3); }
  // medallion: an eye in rays
  g.save(); g.translate(w / 2, h / 2);
  for (let i = 0; i < 24; i++) { g.save(); g.rotate(i * TAU / 24); g.beginPath(); g.moveTo(-10, 70); g.lineTo(0, i % 2 ? 150 : 185); g.lineTo(10, 70); g.closePath(); g.fillStyle = i % 2 ? '#1f2440' : '#c9a34a'; g.fill(); g.strokeStyle = '#140a0c'; g.lineWidth = 2; g.stroke(); g.restore(); }
  for (const [r, c] of [[110, '#1f2440'], [96, '#c9a34a'], [88, '#6a1f24']]) { g.beginPath(); g.ellipse(0, 0, r * 1.5, r * 0.8, 0, 0, TAU); g.fillStyle = c; g.fill(); g.strokeStyle = '#140a0c'; g.lineWidth = 3; g.stroke(); }
  g.beginPath(); g.moveTo(-120, 0); g.quadraticCurveTo(0, -80, 120, 0); g.quadraticCurveTo(0, 80, -120, 0); g.fillStyle = '#e8dcc0'; g.fill(); g.stroke();
  for (const [r, c] of [[42, '#1f2440'], [30, '#c9a34a'], [16, '#140a0c']]) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fillStyle = c; g.fill(); }
  g.restore();
  // borders
  const band = (m, bw, col) => { g.strokeStyle = col; g.lineWidth = bw; g.strokeRect(m + bw / 2, m + bw / 2, w - 2 * m - bw, h - 2 * m - bw); };
  band(0, 46, '#1f2440'); band(46, 14, '#c9a34a'); band(60, 4, '#140a0c');
  g.strokeStyle = '#c9a34a'; g.lineWidth = 3; g.beginPath();
  for (let x = 23; x <= w - 23; x += 16) { const y0 = (x / 16) % 2 ? 12 : 34; g.lineTo(x, y0); } g.stroke();
  g.beginPath(); for (let x = 23; x <= w - 23; x += 16) { const y0 = h - ((x / 16) % 2 ? 12 : 34); g.lineTo(x, y0); } g.stroke();
  g.beginPath(); for (let y = 23; y <= h - 23; y += 16) { g.lineTo((y / 16) % 2 ? 12 : 34, y); } g.stroke();
  g.beginPath(); for (let y = 23; y <= h - 23; y += 16) { g.lineTo(w - ((y / 16) % 2 ? 12 : 34), y); } g.stroke();
  seed(81); for (let i = 0; i < 9000; i++) { g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.05)'; g.fillRect(rr(0, w), rr(0, h), 2, 2); }
});

const posterTex = () => ctex('poster', 512, 768, (g, w, h) => {
  seed(91);
  const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#0b1230'); bg.addColorStop(1, '#22164a'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${rr(0.2, 0.9)})`; const s = rr(0.8, 2.4); g.fillRect(rr(0, w), rr(0, h), s, s); }
  g.save(); g.translate(320, 300);
  const ring = (front) => { g.beginPath(); g.ellipse(0, 0, 200, 46, -0.35, front ? 0 : PI, front ? PI : TAU); g.strokeStyle = '#e8c890'; g.lineWidth = 14; g.stroke(); g.strokeStyle = '#a07a50'; g.lineWidth = 4; g.stroke(); };
  ring(false);
  const pg = g.createRadialGradient(-40, -50, 10, 0, 0, 120); pg.addColorStop(0, '#ffd9a0'); pg.addColorStop(1, '#a0582a'); g.fillStyle = pg; g.beginPath(); g.arc(0, 0, 118, 0, TAU); g.fill();
  g.save(); g.clip(); for (let i = -5; i < 6; i++) { g.fillStyle = i % 2 ? 'rgba(120,60,20,.25)' : 'rgba(255,230,190,.18)'; g.fillRect(-130, i * 22, 260, 10); } g.restore();
  ring(true); g.restore();
  const cols = ['#b0b0b0', '#e8c070', '#4a8ad8', '#d0603a', '#d8a870', '#9ad0e0'];
  cols.forEach((c, i) => { const x = 50 + i * 82, r = [10, 16, 17, 13, 26, 20][i]; g.fillStyle = c; g.beginPath(); g.arc(x, 600, r, 0, TAU); g.fill(); g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(x + r * 0.35, 600 + r * 0.2, r, 0, TAU); g.fill(); });
  g.save(); g.translate(110, 460); g.rotate(-0.6);
  g.fillStyle = '#ffb040'; g.beginPath(); g.moveTo(-10, 40); g.lineTo(0, 78); g.lineTo(10, 40); g.fill();
  g.fillStyle = '#eee'; g.beginPath(); g.moveTo(0, -50); g.quadraticCurveTo(22, -10, 14, 40); g.lineTo(-14, 40); g.quadraticCurveTo(-22, -10, 0, -50); g.fill();
  g.fillStyle = '#c0283c'; g.fillRect(-26, 20, 12, 22); g.fillRect(14, 20, 12, 22); g.fillStyle = '#4a8ad8'; g.beginPath(); g.arc(0, -8, 7, 0, TAU); g.fill(); g.restore();
  g.fillStyle = '#ffd36b'; g.font = 'bold 54px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('THE PLANETS', w / 2, 86);
  g.font = '18px Arial, sans-serif'; g.fillStyle = '#c8d0ff'; g.fillText('OUR SOLAR SYSTEM', w / 2, 116); g.fillText('YOU ARE HERE  →  ●', w / 2, 690);
  g.strokeStyle = '#f4f0e6'; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14);
});

const pictureTex = () => ctex('picture', 384, 256, (g, w, h) => {
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#3a4a80'); sky.addColorStop(0.55, '#d08a6a'); sky.addColorStop(0.7, '#f0c08a'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff6d8'; g.beginPath(); g.arc(290, 70, 3, 0, TAU); g.fill();
  const hill = (y0, amp, col, ph) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += 8) g.lineTo(x, y0 + Math.sin(x * 0.012 + ph) * amp + Math.sin(x * 0.031 + ph * 2) * amp * 0.4); g.lineTo(w, h); g.fill(); };
  hill(170, 16, '#5a5a7a', 1); hill(196, 14, '#34465a', 3); hill(222, 10, '#1e2c30', 5);
  g.fillStyle = '#111a1c'; g.fillRect(96, 194, 40, 26); g.beginPath(); g.moveTo(90, 196); g.lineTo(116, 176); g.lineTo(142, 196); g.fill();
  g.fillStyle = '#ffd890'; g.fillRect(104, 202, 8, 8);
  g.strokeStyle = 'rgba(0,0,0,.15)'; g.lineWidth = 2; for (let i = 0; i < 300; i++) { const x = rnd(0, w), y = rnd(0, h); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6, y + rnd(-2, 2)); g.stroke(); }
  const m = 26;
  g.fillStyle = '#e4dccb'; g.beginPath(); g.rect(0, 0, w, h); g.rect(m, m, w - 2 * m, h - 2 * m); g.fill('evenodd');
  g.strokeStyle = '#f6f1e4'; g.lineWidth = 3; g.strokeRect(m - 1.5, m - 1.5, w - 2 * m + 3, h - 2 * m + 3);
  g.strokeStyle = 'rgba(60,50,40,.35)'; g.lineWidth = 1; g.strokeRect(m - 0.5, m - 0.5, w - 2 * m + 1, h - 2 * m + 1);
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
});

// ---------- geometry helpers ----------
const geoCache = new Map(), matCache = new Map();
// cached things are shared between scenes: mark them so engine.js clearScene never disposes them
const keepAll = (v, depth = 0) => {
  if (!v || typeof v !== 'object' || depth > 2) return;
  if (v.isBufferGeometry || v.isTexture) { v.userData.keep = true; return; }
  if (v.isMaterial) { v.userData.keep = v.uuid;   // the uuid, not true: a clone copies userData but gets a new uuid, so clones are not kept
    for (const k in v) { const t = v[k]; if (t && t.isTexture) t.userData.keep = true; } return; }
  for (const k of Object.keys(v)) keepAll(v[k], depth + 1);
};
const G = (key, fn) => { let v = geoCache.get(key); if (!v) { v = fn(); keepAll(v); geoCache.set(key, v); } return v; };
const Mt = (key, fn) => { let v = matCache.get(key); if (!v) { v = fn(); keepAll(v); matCache.set(key, v); } return v; };
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _fw = new THREE.Vector3(0, 0, 1);
function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) { return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)); }
const cylG = (rt, rb, n) => G(`cyl${rt},${rb},${n}`, () => new THREE.CylinderGeometry(rt, rb, 1, n, 1, true));
const sphG = (w, h) => G(`sph${w},${h}`, () => new THREE.SphereGeometry(1, w, h));
const boxG = () => G('box', () => new THREE.BoxGeometry(1, 1, 1));
// tapered tube from point a (radius ra) to point b (radius rb)
function seg(a, b, ra, rb, n = 8) {
  _a.set(a[0], a[1], a[2]); _b.set(b[0], b[1], b[2]);
  const d = _b.clone().sub(_a), len = d.length(); _q.setFromUnitVectors(_up, d.normalize());
  const r = [cylG(rb, ra, n), new THREE.Matrix4().compose(_p.addVectors(_a, _b).multiplyScalar(0.5), _q, _s.set(1, len, 1))]; r.grain = [0, 1, 0]; return r;
}
const ball = (x, y, z, rx, ry = rx, rz = rx, w = 8, h = 6, rotx = 0, roty = 0, rotz = 0) => [sphG(w, h), M(x, y, z, rotx, roty, rotz, rx, ry, rz)];
const box = (x, y, z, w, h, d, rx = 0, ry = 0, rz = 0, col) => [boxG(), M(x, y, z, rx, ry, rz, w, h, d), col];
function bevelBox(w, h, d, r) {
  r = Math.min(r, w * 0.3, h * 0.3, d * 0.3);
  const geo = new THREE.BoxGeometry(1, 1, 1, 3, 3, 3), p = geo.attributes.position, nr = geo.attributes.normal, v = new THREE.Vector3(), c = new THREE.Vector3();
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r, at = (t, half) => Math.sign(t) * (Math.abs(t) > 0.4 ? half : half - r);
  for (let i = 0; i < p.count; i++) {
    v.set(at(p.getX(i), w / 2), at(p.getY(i), h / 2), at(p.getZ(i), d / 2));
    c.set(Math.max(-hw, Math.min(hw, v.x)), Math.max(-hh, Math.min(hh, v.y)), Math.max(-hd, Math.min(hd, v.z)));
    v.sub(c); const l = v.length();
    if (l > 1e-7) { v.multiplyScalar(r / l); nr.setXYZ(i, v.x / r, v.y / r, v.z / r); }
    v.add(c); p.setXYZ(i, v.x, v.y, v.z);
  }
  return geo;
}
// a bevelled box part, grain along its longest side
const bbox = (x, y, z, w, h, d, rx = 0, ry = 0, rz = 0, col, r = 0.004) => [bevelBox(w, h, d, r), M(x, y, z, rx, ry, rz), col, w >= h && w >= d ? [1, 0, 0] : h >= d ? [0, 1, 0] : [0, 0, 1]];

// merge [geometry, matrix, colour?] parts into one non-indexed geometry (one draw call)
// grain: also write aGrain, each piece's grain direction: part[3] (a local axis) through its matrix, or else the matrix's longest
// axis (a scaled unit box runs along its longest side), y when they tie (lathed posts)
const _g3 = new THREE.Vector3(), _m3 = new THREE.Matrix3();
function grainOf(m, local) {
  if (local) return _g3.set(...local).applyMatrix3(_m3.setFromMatrix4(m || new THREE.Matrix4())).normalize().toArray();
  if (!m) return [0, 1, 0];
  const e = m.elements, L = [Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])];
  const k = L[1] >= Math.max(L[0], L[2]) - 1e-6 ? 1 : L[0] >= L[2] ? 0 : 2;
  return [e[k * 4] / L[k], e[k * 4 + 1] / L[k], e[k * 4 + 2] / L[k]];
}
function merge(parts, grain = false) {
  let n = 0, hasCol = false; const gs = [];
  for (const part of parts) { const [geo, m, col] = part, gl = part[3] || part.grain; const g = geo.index ? geo.toNonIndexed() : geo.clone(); if (m) g.applyMatrix4(m); gs.push([g, col, grain ? grainOf(m, gl) : null]); n += g.attributes.position.count; if (col !== undefined) hasCol = true; }
  const grA = grain ? new Float32Array(n * 3) : null;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), colA = hasCol ? new Float32Array(n * 3) : null, c = new THREE.Color();
  let o = 0;
  for (const [g, col, gd] of gs) {
    const k = g.attributes.position.count;
    if (grA) for (let i = 0; i < k; i++) grA.set(gd, (o + i) * 3);
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    if (colA) { c.set(col ?? 0xffffff); for (let i = 0; i < k; i++) { colA[(o + i) * 3] = c.r; colA[(o + i) * 3 + 1] = c.g; colA[(o + i) * 3 + 2] = c.b; } }
    o += k; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (colA) out.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  if (grA) out.setAttribute('aGrain', new THREE.BufferAttribute(grA, 3));
  out.computeBoundingSphere(); return out;
}
// mirror across x, keeping triangles facing outwards
function mirrorX(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const swap = (arr, size) => { for (let t = 0; t < arr.length; t += size * 3) for (let k = 0; k < size; k++) { const a = arr[t + size + k]; arr[t + size + k] = arr[t + 2 * size + k]; arr[t + 2 * size + k] = a; } };
  const p = g.attributes.position.array, nr = g.attributes.normal.array;
  for (let i = 0; i < p.length; i += 3) { p[i] = -p[i]; nr[i] = -nr[i]; }
  swap(p, 3); swap(nr, 3); if (g.attributes.uv) swap(g.attributes.uv.array, 2); if (g.attributes.color) swap(g.attributes.color.array, 3);
  g.computeBoundingSphere(); return g;
}
// vertex normals, then averaged across duplicated seam/pole vertices so sculpted shapes shade without seams
function smoothSeams(geo) {
  geo.computeVertexNormals();
  const p = geo.attributes.position.array, n = geo.attributes.normal.array, groups = new Map();
  for (let i = 0; i < p.length; i += 3) { const k = `${Math.round(p[i] * 1e4)},${Math.round(p[i + 1] * 1e4)},${Math.round(p[i + 2] * 1e4)}`; const a = groups.get(k); if (a) a.push(i); else groups.set(k, [i]); }
  for (const a of groups.values()) if (a.length > 1) { let x = 0, y = 0, z = 0; for (const i of a) { x += n[i]; y += n[i + 1]; z += n[i + 2]; } const l = Math.hypot(x, y, z) || 1; for (const i of a) { n[i] = x / l; n[i + 1] = y / l; n[i + 2] = z / l; } }
  geo.attributes.normal.needsUpdate = true; return geo;
}
// parametric surface: fn(u, v, out) with u, v in 0..1. Faces point along (du x dv); flip reverses.
function grid(nu, nv, fn, flip = false) {
  const pos = [], uv = [], idx = [], v = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { fn(i / nu, j / nv, v); pos.push(v.x, v.y, v.z); uv.push(i / nu, j / nv); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, d = a + nu + 1, c = d + 1; if (flip) idx.push(a, d, b, b, d, c); else idx.push(a, b, d, b, c, d); }
  const geo = new THREE.BufferGeometry(); geo.setIndex(idx);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return smoothSeams(geo);
}
// a deformed unit sphere
function sculpt(ws, hs, fn) {
  const geo = new THREE.SphereGeometry(1, ws, hs), p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); fn(v.x, v.y, v.z, v); p.setXYZ(i, v.x, v.y, v.z); }
  return smoothSeams(geo);
}
// glyph bands: remap uv so the glyph column runs along the band (alongU) and repeats rep times
function bandUV(geo, rep, alongU) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); if (alongU) uv.setXY(i, v, u * rep); else uv.setXY(i, u, v * rep); }
  return geo;
}
// a box with rounded edges
function roundedBox(w, h, d, r, s) {
  const geo = new THREE.BoxGeometry(w, h, d, s, s, s), p = geo.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3(), hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); c.set(Math.max(-hw, Math.min(hw, v.x)), Math.max(-hh, Math.min(hh, v.y)), Math.max(-hd, Math.min(hd, v.z)));
    v.sub(c); if (v.lengthSq() > 0) v.normalize().multiplyScalar(r); v.add(c); p.setXYZ(i, v.x, v.y, v.z);
  }
  return smoothSeams(geo);
}
const lathe = (pts, n, start = PI) => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), n, start);
// orient a flat disc (facing +z) to a normal
function facing(x, y, z, nx, ny, nz, sx = 1, sy = sx) { _a.set(nx, ny, nz).normalize(); _q.setFromUnitVectors(_fw, _a); return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, 1)); }

// ---------- the greys ----------
const GR = 0.17;
// sculpted grey skull: swollen cranium tapering to a tiny chin
function greyHeadPt(nx, ny, nz, out) {
  const up = Math.max(0, ny), dn = Math.max(0, -ny);
  const w = 1 + 0.06 * up - 0.6 * Math.pow(dn, 1.5);
  const x = nx * w;
  let z = nz * w * 1.04;
  if (nz < 0) z *= 1 + 0.16 * up; else z *= 1 - 0.1 * dn;
  z += 0.05 * dn * dn * Math.max(0, nz);
  const y = ny * (ny > 0 ? 1.06 : 1.22);
  // cheekbones under the outer eye and a low ridge over the brows, both on the face only
  const ax = Math.abs(nx), fz = Math.max(0, nz);
  const cheek = Math.exp(-((ax - 0.42) ** 2) / 0.012 - ((ny + 0.38) ** 2) / 0.007) * fz;
  const brow = Math.exp(-((ny - 0.17 - 0.45 * Math.max(0, ax - 0.25)) ** 2) / 0.005) * Math.exp(-(nx * nx) / 0.4) * fz * fz;
  const k = GR * (1 + 0.03 * cheek + 0.02 * brow);
  return out.set(x * k, y * k, z * k);
}
// large almond eyes wrapped round the skull; outer corners lifted
function greyEyePt(s, U, V, out, lift = 0) {
  const cx = s * 0.43, cy = -0.03, tl = s * 0.5, a = 0.36, b = 0.165;
  const lx = U * a, ly = V * b * Math.pow(Math.max(0, 1 - U * U), 0.85);
  const fx = cx + lx * Math.cos(tl) - ly * Math.sin(tl), fy = cy + lx * Math.sin(tl) + ly * Math.cos(tl);
  const fz = Math.sqrt(Math.max(0.04, 1 - fx * fx - fy * fy)), l = Math.hypot(fx, fy, fz);
  greyHeadPt(fx / l, fy / l, fz / l, out);
  return out.multiplyScalar(0.97 + 0.11 * (1 - V * V) * Math.sqrt(Math.max(0, 1 - U * U)) + lift);
}
const onGreyHead = (nx, ny, out) => { const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)); return greyHeadPt(nx, ny, nz, out); };

const GF0 = [-0.002, -0.037, 0.002], GF1 = [-0.002, -0.045, 0], GT0 = [-0.004, -0.012, 0.012];
const TORSO = [[0.31, 0.02], [0.325, 0.05], [0.35, 0.07], [0.39, 0.072], [0.44, 0.052], [0.47, 0.05], [0.52, 0.064], [0.565, 0.076], [0.6, 0.083], [0.625, 0.08], [0.645, 0.05], [0.655, 0.02]];
function greyParts() {
  return G('grey', () => {
    const v = new THREE.Vector3();
    const head = sculpt(32, 24, greyHeadPt);
    const eye = (s) => grid(30, 14, (u, w, o) => greyEyePt(s, u * 2 - 1, w * 2 - 1, o));
    const disc = new THREE.CircleGeometry(1, 16), glints = [];
    for (const s of [-1, 1]) {
      greyEyePt(s, -0.32 * s, 0.42, v, 0.006); const n = v.clone().normalize(); glints.push([disc, facing(v.x, v.y, v.z, n.x, n.y, n.z, 0.012)]);
      greyEyePt(s, -0.12 * s, 0.62, v, 0.006); glints.push([disc, facing(v.x, v.y, v.z, n.x, n.y, n.z, 0.005)]);
      greyEyePt(s, 0.4 * s, -0.5, v, 0.004); glints.push([disc, facing(v.x, v.y, v.z, n.x, n.y, n.z, 0.007)]);
    }
    const feat = [];
    for (const s of [-1, 1]) { onGreyHead(s * 0.07, -0.36, v); feat.push(ball(v.x, v.y, v.z - 0.002, 0.0035, 0.008, 0.003, 8, 6, 0, 0, s * 0.35)); }
    onGreyHead(0, -0.64, v); feat.push(ball(v.x, v.y, v.z - 0.002, 0.026, 0.0024, 0.006, 12, 6));
    // body: lathe torso with shoulders and a faint ribcage
    const torso = new THREE.LatheGeometry(Array.from({ length: 65 }, (_, i) => { const y = 0.31 + i / 64 * 0.345; return new THREE.Vector2(Math.max(0, profileAt(TORSO, y)), y); }), 36, PI);
    const tp = torso.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i), x = tp.getX(i), z = tp.getZ(i), r = Math.hypot(x, z) || 1e-6;
      const rib = z > 0 ? 1 + 0.035 * Math.max(0, Math.sin((y - 0.5) * 120)) * smooth(0.49, 0.52, y) * (1 - smooth(0.58, 0.6, y)) * (z / r) : 1;
      // collarbones: a thin ridge from the notch out to each shoulder, and the notch between them
      const ax = Math.abs(x), fr = Math.max(0, z / r), dc = y - (0.628 + 0.013 * Math.min(1, ax / 0.09));
      const clav = Math.exp(-(dc * dc) / 0.000036) * smooth(0.01, 0.026, ax) * (1 - smooth(0.075, 0.095, ax)) * fr;
      const notch = Math.exp(-(x * x) / 0.00012 - ((y - 0.636) ** 2) / 0.00008) * fr;
      const cb = 1 + 0.07 * clav - 0.06 * notch;
      tp.setXYZ(i, x * (1 + 0.15 * smooth(0.55, 0.62, y)) * rib * cb, y, z * 0.68 * rib * cb);
    }
    smoothSeams(torso);
    const neckG = new THREE.CylinderGeometry(0.019, 0.024, 1, 16, 24, true), np = neckG.attributes.position;
    for (let i = 0; i < np.count; i++) {
      const t = np.getY(i) + 0.5, x = np.getX(i), z = np.getZ(i), fr = 0.5 + 0.5 * Math.max(0, z / (Math.hypot(x, z) || 1));
      const cr = Math.pow(0.5 + 0.5 * Math.cos(t * TAU * 5), 10) * smooth(0.03, 0.12, t) * (1 - smooth(0.5, 0.65, t));
      const k = 1 - 0.075 * cr * fr; np.setX(i, x * k); np.setZ(i, z * k);
    }
    smoothSeams(neckG);
    const body = merge([[torso], ball(-0.098, 0.62, 0, 0.021), ball(0.098, 0.62, 0, 0.021), [neckG, seg([0, 0.6, -0.01], [0, 0.84, -0.015], 0.024, 0.019, 10)[1]]]);
    // right arm (+x) in three jointed pieces: upper arm (shoulder pivot), forearm (elbow pivot), hand (wrist pivot)
    const E = [0.004, -0.2, 0.01], W = [0, -0.388, 0.03], rel = (p, o) => [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    const upperR = merge([seg([0, 0, 0], E, 0.017, 0.013), ball(...E, 0.0155)]);
    const foreR = merge([seg([0, 0, 0], rel(W, E), 0.013, 0.0095), ball(...rel(W, E), 0.011)]);
    // hand: palm (wrist pivot), a row of long finger bases (pivot GF0) and the fingertip row (pivot GF1) so it can grip
    // three long fingers and an opposable thumb growing from a small thenar mound low on the palm
    const palm = [ball(...rel([-0.002, -0.41, 0.032], W), 0.007, 0.02, 0.016), ball(...rel([-0.004, -0.4, 0.04], W), 0.006, 0.012, 0.007, 6, 4)], fing = [], tips = [];
    const F0 = GF0, F1 = GF1, sub = (p, o) => [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    const thumb = [seg([0, 0, 0], [-0.003, -0.022, 0.012], 0.0045, 0.0038, 6), ball(-0.003, -0.022, 0.012, 0.004, 0.004, 0.004, 6, 4), seg([-0.003, -0.022, 0.012], [-0.006, -0.042, 0.016], 0.0038, 0.0026, 6), ball(-0.006, -0.042, 0.016, 0.0031, 0.004, 0.0034, 6, 4)];
    for (let k = 0.5; k < 3.5; k++) {
      const z = 0.032 + (k - 1.5) * 0.011, dz = (k - 1.5) * 0.009, len = k === 1.5 ? 1.05 : 0.95;
      const b = sub(rel([-0.002, -0.425, z], W), F0), m = sub(rel([-0.004, -0.425 - 0.045 * len, z + dz], W), F0), t = rel([-0.009, -0.425 - 0.082 * len, z + dz * 1.7], W);
      fing.push(seg(b, m, 0.0042, 0.0036, 6), ball(m[0] + 0.0008, m[1], m[2], 0.0047, 0.0044, 0.0046, 8, 6), ball(b[0] + 0.0026, b[1] + 0.001, b[2], 0.0036, 0.0034, 0.0038, 8, 6));
      const m2 = sub(m, F1), t2 = sub(sub(t, F0), F1);
      tips.push(seg(m2, t2, 0.0036, 0.0026, 6), ball(...t2, 0.0034, 0.0045, 0.004, 8, 6));
    }
    const handR = merge(palm), fingR = merge(fing), tipsR = merge(tips), thumbR = merge(thumb);
    const uvS = (geo) => { const a = geo.attributes.uv.array; for (let i = 0; i < a.length; i += 2) { a[i] *= 0.5; a[i + 1] *= 0.5; } return geo; };
    const thigh = merge([seg([0, 0, 0], [0, -0.17, 0.006], 0.026, 0.019), ball(0, -0.17, 0.006, 0.019)]);
    const shin = merge([seg([0, 0, 0], [0, -0.162, -0.01], 0.017, 0.012), ball(0, -0.163, -0.01, 0.012), ball(0, -0.178, 0.012, 0.021, 0.011, 0.045, 12, 8),
      ball(-0.012, -0.182, 0.056, 0.0065, 0.005, 0.008, 6, 4), ball(0, -0.182, 0.06, 0.0065, 0.005, 0.008, 6, 4), ball(0.012, -0.182, 0.056, 0.0065, 0.005, 0.008, 6, 4)]);
    for (const geo of [upperR, foreR, handR, fingR, tipsR, thumbR, thigh, shin]) uvS(geo);
    return { head, eyeL: eye(-1), eyeR: eye(1), glint: merge(glints), feat: merge(feat), body, upperR, upperL: mirrorX(upperR), foreR, foreL: mirrorX(foreR), handR, handL: mirrorX(handR), fingR, fingL: mirrorX(fingR), tipsR, tipsL: mirrorX(tipsR), thumbR, thumbL: mirrorX(thumbR), E, W, thigh, shin };
  });
}

export function makeGrey(tall = false) {
  const P = greyParts();
  const skin = Mt(tall ? 'greySkinTall2' : 'greySkin2', () => greySkinMat(tall ? 0xb0b6bb : 0x9ca3aa));
  const dark = Mt('greyDark', () => std(0x14171a, { roughness: 0.7 }));
  const glintM = Mt('glintSoft', () => new THREE.MeshBasicMaterial({ color: 0xffffff, map: glintTex(), transparent: true, opacity: 0.8, depthWrite: false }));
  // wet black glass: a clearcoat over a dark body with a faint depth in the middle; reflects a dim room
  const eyeM = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: greyEyeTex(), roughness: 0.35, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1, envMap: studioEnv(), envMapIntensity: 0.45 });
  const g = new THREE.Group();
  // root: everything hangs off it so the walk can drop and sway the body without touching g's own transform
  const root = new THREE.Group(); g.add(root);
  const neck = new THREE.Group(); neck.position.set(0, 0.78, -0.012); root.add(neck);
  const head = new THREE.Group(); head.position.set(0, 0.14, 0.012); neck.add(head);
  const eyes = [new THREE.Mesh(P.eyeL, eyeM), new THREE.Mesh(P.eyeR, eyeM)];
  head.add(new THREE.Mesh(P.head, skin), ...eyes, new THREE.Mesh(P.feat, dark), new THREE.Mesh(P.glint, glintM));
  const chest = new THREE.Mesh(P.body, skin); root.add(chest);
  const pivot = (parent, geo, x, y, z = 0) => { const p = new THREE.Group(); p.position.set(x, y, z); p.add(new THREE.Mesh(geo, skin)); parent.add(p); return p; };
  const arm = (s) => {
    const sh = pivot(root, s > 0 ? P.upperR : P.upperL, s * 0.105, 0.625);
    const el = pivot(sh, s > 0 ? P.foreR : P.foreL, s * P.E[0], P.E[1], P.E[2]);
    const wr = pivot(el, s > 0 ? P.handR : P.handL, s * (P.W[0] - P.E[0]), P.W[1] - P.E[1], P.W[2] - P.E[2]);
    const fi = pivot(wr, s > 0 ? P.fingR : P.fingL, s * GF0[0], GF0[1], GF0[2]);
    const ti = pivot(fi, s > 0 ? P.tipsR : P.tipsL, s * GF1[0], GF1[1], GF1[2]);
    const th = pivot(wr, s > 0 ? P.thumbR : P.thumbL, s * GT0[0], GT0[1], GT0[2]);
    return [sh, el, wr, fi, ti, th];
  };
  const [armL, foreL, handL, fingersL, tipsL, thumbL] = arm(-1), [armR, foreR, handR, fingersR, tipsR, thumbR] = arm(1);
  const leg = (x) => { const p = pivot(root, P.thigh, x, 0.36), k = new THREE.Group(); k.position.set(0, -0.17, 0.006); k.add(new THREE.Mesh(P.shin, skin)); p.add(k); return [p, k]; };
  const [legL, kneeL] = leg(-0.045), [legR, kneeR] = leg(0.045);
  g.userData = { head, eyes, eyeM, armL, armR, legL, legR, kneeL, kneeR, foreL, foreR, handL, handR, fingersL, fingersR, tipsL, tipsR, thumbL, thumbR, neck, root, chest, phase: 0 };
  g.scale.setScalar(tall ? 1.5 : 1.08);
  return g;
}
// lockstep walk: every grey passed the same phase moves identically.
// Hips swing the legs, the swinging leg bends at the knee, arms counter-swing with a little elbow, the body dips at full stride.
// The phase must come from game time, phase = E.time * GREY_GAIT (build 123): it used to be advanced a fixed amount per
// frame, so the walk ran faster the higher the frame rate (about 2-4 steps a second at 60 fps). GREY_GAIT is radians of
// phase per second (two steps per 2 pi): the one knob for how fast every grey walks. Short steps, the body rocking over
// each foot: a waddle.
export const GREY_GAIT = 5.5;
export function stepGrey(g, phase, amt = 1) {
  const u = g.userData, s = Math.sin(phase) * 0.34 * amt, c = Math.cos(phase);
  u.legL.rotation.x = s; u.legR.rotation.x = -s; u.armL.rotation.x = -s * 0.5; u.armR.rotation.x = s * 0.5;
  if (u.kneeL) { u.kneeL.rotation.x = (Math.max(0, -c) * 0.8 + 0.04) * amt; u.kneeR.rotation.x = (Math.max(0, c) * 0.8 + 0.04) * amt; }
  if (u.foreL) { u.foreL.rotation.x = -(0.06 + 0.22 * Math.max(0, s)) * amt; u.foreR.rotation.x = -(0.06 + 0.22 * Math.max(0, -s)) * amt; }
  if (u.root) {
    // drop the body so the lower foot stays on the floor (thigh 0.17, shin + foot 0.19)
    const reach = (h, k) => 0.17 * Math.cos(h) + 0.19 * Math.cos(h + k);
    u.root.position.y = Math.max(reach(s, u.kneeL.rotation.x), reach(-s, u.kneeR.rotation.x)) - 0.36;
    u.root.rotation.z = Math.sin(phase) * 0.06 * amt; u.root.rotation.y = -s * 0.16;
  }
}
// turn a grey's neck toward a world-space point (amt 0..1 blends from straight ahead); no allocation
const _gv = new THREE.Vector3(), _gq = new THREE.Quaternion();
// far = true lets the head tip back on the neck as well, for looking steeply up (something rising to the ceiling)
export function aimGrey(g, target, amt = 1, far = false) {
  const u = g.userData; if (!u.neck) return;
  u.neck.getWorldPosition(_gv); _gv.subVectors(target, _gv);
  g.getWorldQuaternion(_gq).invert(); _gv.applyQuaternion(_gq);
  const raw = Math.atan2(-_gv.y, Math.hypot(_gv.x, _gv.z));
  const yaw = Math.max(-1.1, Math.min(1.1, Math.atan2(_gv.x, _gv.z))), pitch = Math.max(-0.6, Math.min(0.6, raw));
  u.neck.rotation.y = yaw * amt; u.neck.rotation.x = pitch * amt;
  if (far && u.head) u.head.rotation.x = Math.max(-0.7, Math.min(0.7, raw - pitch)) * amt;
}
// curl a grey's long fingers (k 0 open .. 1 closed); with obj, also put obj in that hand's grip (e.g. makeWand())
export function gripGrey(g, side, k = 1, obj) {
  const u = g.userData, R = side !== 'L', s = R ? 1 : -1, f = R ? u.fingersR : u.fingersL, t = R ? u.tipsR : u.tipsL;
  if (!f) return;
  const th = R ? u.thumbR : u.thumbL;
  if (u[R ? 'gripAxisR' : 'gripAxisL'] && !obj) {
    // holding something: close round it (base row nearly flat under it, tips folded back over it, thumb over the top)
    f.rotation.set(0, 0, -s * GRIP_A * k); t.rotation.set(0, 0, -s * GRIP_B * k);
    if (th) { _gq2.setFromUnitVectors(_thRest, _thv.set(s * GRIP_TH[0], GRIP_TH[1], GRIP_TH[2]).normalize()); th.quaternion.identity().slerp(_gq2, Math.max(0, Math.min(1, k))); }
    return;
  }
  f.rotation.z = -s * 1.15 * k; t.rotation.z = -s * 1.35 * k;
  if (th) th.rotation.set(-0.5 * Math.max(0, k), 0, -s * 0.9 * Math.max(0, k));
  if (obj) {
    // baton grip: the shaft lies diagonally across the palm, from the heel of the hand (little-finger side) out between the
    // thumb and the first finger; the fingers close round it from one side and the thumb from the other. GRIP_AXIS is the
    // shaft's forward direction in the hand's frame; the grip point sits on the palm side, under the finger bases.
    const hd = R ? u.handR : u.handL; hd.add(obj); u[R ? 'heldR' : 'heldL'] = obj;
    // obj.userData.gripAxis: a shaft held at another angle across the palm (build 146: the exam probe, held diagonally)
    const ax = obj.userData.gripAxis || GRIP_AXIS;
    obj.quaternion.setFromUnitVectors(_down, ax);
    // obj.userData.gripAt: the point along the object's own y axis that sits in the fist (default GRIP_BACK, made for the wand,
    // whose origin is its middle); scaled by the object's own scale. Build 125: the probe's origin is its ring end, so the
    // wand's offset put it 6-10 cm out past the fingers and the fist held air
    const at = obj.userData.gripAt !== undefined ? obj.userData.gripAt : GRIP_BACK;
    obj.position.set(-s * GRIP_C[0], GRIP_C[1], GRIP_C[2]).addScaledVector(ax, at * obj.scale.y);
    u[R ? 'gripAxisR' : 'gripAxisL'] = obj.userData.gripAxis || (s > 0 ? GRIP_AXIS : GRIP_AXIS_L);
    gripGrey(g, side, k);   // closed round it before it is ever seen
  }
}
// the wand's place in a grey's right hand (wrist frame: fingers -y, palm -x, thumb +z): across the palm, just under it at the
// finger bases, running toward the thumb side and a little toward the fingers. Found by rendering the grip from several sides.
const GRIP_AXIS = new THREE.Vector3(0, -0.25, 1).normalize(), GRIP_AXIS_L = GRIP_AXIS, GRIP_C = [0.0115, -0.029, 0], GRIP_BACK = 0.1;
const GRIP_A = 1.4, GRIP_B = 2.54, GRIP_TH = [-0.55, -0.45, 0.5];
const _down = new THREE.Vector3(0, -1, 0), _thRest = new THREE.Vector3(-0.003, -0.022, 0.012).normalize(), _thv = new THREE.Vector3(), _gq2 = new THREE.Quaternion();
// aim a grey's straight-ish arm at a world point (k 0..1 blends from hanging); a hand holding something (gripGrey with obj)
// then turns at the wrist so the held object's axis, not the fingers, points at the target
const _pa = new THREE.Vector3(), _pq = new THREE.Quaternion(), _pe = new THREE.Euler(), _px = new THREE.Vector3(1, 0, 0);
const _pb = new THREE.Vector3(), _pc = new THREE.Vector3(), _pd = new THREE.Vector3(), _pe2 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _wy = new THREE.Vector3(0, 1, 0);
// reach = true bends the elbow (two-bone solve) so the fingertips land on the target instead of the arm pointing through it
// ---- a grey's arm solved like a robot arm, with its own body as collision volumes ----
// solveGreyArm(g, side, wrist, pole): two-bone IK. The wrist pivot goes to the world point `wrist` (clamped to the arm's
//   reach); the elbow bends in the plane through shoulder, wrist and the world point `pole`, on the pole's side. The hand
//   keeps its own rotation: turn it afterwards.
// greyInside(g, p, margin): is world point p inside the grey's own torso (an ellipse per centimetre of height, measured
//   from the chest mesh) or head (an ellipsoid from its bounds)? Grown by `margin`.
// greyArmHits(g, side, extra, margin): how many sample points along that arm (upper arm from 3.5 cm out of the shoulder
//   joint, forearm, hand to fingertips) and along any extra world segments [a0, b0, a1, b1, ...] (a held wand) are inside.
// clearGreyArm(g, side, wrist, poleDir, after): solve with the elbow pointing along poleDir, then, if anything is inside,
//   turn the pole about the shoulder-to-wrist line in steps (nearest to the last turn first, so the elbow does not jump)
//   until nothing is; keeps the clear pose, or the one with fewest hits. `after()` runs after each solve (turn the hand,
//   grip) and may return extra segments to test. Returns the hit count of the pose kept.
const _A = [...Array(8)].map(() => new THREE.Vector3()), _B = [...Array(4)].map(() => new THREE.Vector3()), _Aq = new THREE.Quaternion(), _Am0 = new THREE.Matrix4(), _Am1 = new THREE.Matrix4();
function greyVol(g) {
  const u = g.userData; if (u._vol) return u._vol;
  const p = u.chest.geometry.attributes.position, bins = new Map();
  // the shoulder-joint balls (radius 0.021 at x ±0.098, y 0.62) are where the arms attach, not torso: left out, or every
  // arm's top would count as inside its own shoulder
  for (let i = 0; i < p.count; i++) { if (Math.hypot(Math.abs(p.getX(i)) - 0.098, p.getY(i) - 0.62, p.getZ(i)) < 0.0225) continue; const k = Math.round(p.getY(i) * 100); let b = bins.get(k); if (!b) bins.set(k, (b = { x: 0, z0: 9, z1: -9 })); b.x = Math.max(b.x, Math.abs(p.getX(i))); b.z0 = Math.min(b.z0, p.getZ(i)); b.z1 = Math.max(b.z1, p.getZ(i)); }
  const box = new THREE.Box3();
  for (const m of u.head.children) if (m.isMesh) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); m.updateMatrix(); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrix)); }
  return (u._vol = { bins, hc: box.getCenter(new THREE.Vector3()), hr: box.getSize(new THREE.Vector3()).multiplyScalar(0.5) });
}
export function greyInside(g, pw, margin = 0.012) {
  const u = g.userData, V = greyVol(g), q = u.root.worldToLocal(_A[6].copy(pw)), b = V.bins.get(Math.round(q.y * 100));
  if (b) { const cz = (b.z0 + b.z1) / 2, rx = b.x + margin, rz = (b.z1 - b.z0) / 2 + margin; if ((q.x / rx) ** 2 + ((q.z - cz) / rz) ** 2 < 1) return true; }
  const h = u.head.worldToLocal(_A[6].copy(pw)).sub(V.hc);
  return (h.x / (V.hr.x + margin)) ** 2 + (h.y / (V.hr.y + margin)) ** 2 + (h.z / (V.hr.z + margin)) ** 2 < 1;
}
export function greyArmHits(g, side, extra = null, margin = 0.012) {
  const u = g.userData; g.updateMatrixWorld(true);
  const S = u['arm' + side].getWorldPosition(_A[0]), El = u['fore' + side].getWorldPosition(_A[1]), Wr = u['hand' + side].getWorldPosition(_A[2]), F = u['tips' + side].getWorldPosition(_A[3]);
  let n = 0, parts = '';
  const seg = (a, b, skip, name) => { let c = 0; for (let t = 0; t <= 1.0001; t += 0.125) { _A[4].lerpVectors(a, b, t); if (skip && _A[4].distanceTo(S) < skip) continue; if (greyInside(g, _A[4], margin)) c++; } if (c) { n += c; parts += name + ':' + c + ' '; } };
  seg(S, El, 0.035, 'upper'); seg(El, Wr, 0, 'fore'); seg(Wr, F, 0, 'hand');
  if (extra) for (let i = 0; i + 1 < extra.length; i += 2) seg(extra[i], extra[i + 1], 0, 'held');
  u._hitParts = parts.trim();
  return n;
}
export function heldSegment(obj, a, b) {
  let L = obj.userData._seg;
  if (!L) {
    const box = new THREE.Box3(); obj.updateMatrixWorld(true); const inv = obj.matrixWorld.clone().invert();
    obj.traverse((m) => { if (m.isMesh) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld))); } });
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()), ax = s.x >= s.y && s.x >= s.z ? 'x' : s.y >= s.z ? 'y' : 'z';
    const h = new THREE.Vector3(); h[ax] = s[ax] / 2; L = obj.userData._seg = [c.clone().sub(h), c.clone().add(h)];
  }
  return [obj.localToWorld(a.copy(L[0])), obj.localToWorld(b.copy(L[1]))];
}
export function solveGreyArm(g, side, wrist, pole) {
  const u = g.userData, sh = u['arm' + side], el = u['fore' + side], hd = u['hand' + side];
  g.updateMatrixWorld(true);
  const sc = g.scale.x || 1, S = sh.getWorldPosition(_A[0]), a = el.position.length() * sc, b = hd.position.length() * sc;
  const dir = _A[2].subVectors(wrist, S), d = Math.max(Math.abs(a - b) + 0.005, Math.min(a + b - 0.002, dir.length()));
  dir.normalize(); const T = _A[1].copy(S).addScaledVector(dir, d);
  const pp = _A[3].subVectors(pole, S); pp.addScaledVector(dir, -pp.dot(dir));
  if (pp.lengthSq() < 1e-10) pp.set(0, -1, 0).addScaledVector(dir, dir.y); pp.normalize();
  const al = Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))));
  const Ep = _A[4].copy(S).addScaledVector(dir, a * Math.cos(al)).addScaledVector(pp, a * Math.sin(al));
  // upper arm: its rest bone (shoulder to elbow pivot) onto shoulder-to-elbow, its forward side (+z, the way the elbow
  // folds the forearm) toward the wrist
  const y1 = _A[5].subVectors(Ep, S).normalize(), z1 = _A[6].subVectors(T, Ep); z1.addScaledVector(y1, -z1.dot(y1)).normalize();
  sh.parent.getWorldQuaternion(_Aq).invert(); y1.applyQuaternion(_Aq); z1.applyQuaternion(_Aq);
  const x1 = _A[7].crossVectors(y1, z1);
  const y0 = _B[0].copy(el.position).normalize(), z0 = _B[1].set(0, 0, 1).addScaledVector(y0, -y0.z).normalize(), x0 = _B[2].crossVectors(y0, z0);
  _Am1.makeBasis(x1, y1, z1); _Am0.makeBasis(x0, y0, z0).transpose(); sh.quaternion.setFromRotationMatrix(_Am1.multiply(_Am0));
  // elbow: turn the forearm about its own x axis onto elbow-to-wrist
  sh.updateMatrixWorld(true); sh.getWorldQuaternion(_Aq).invert();
  const v = _B[3].subVectors(T, Ep).applyQuaternion(_Aq), f0 = _B[0].copy(hd.position).normalize();
  el.quaternion.identity(); el.rotation.set(Math.atan2(f0.y * v.z - f0.z * v.y, f0.y * v.y + f0.z * v.z), 0, 0);
  g.updateMatrixWorld(true);
}
const _pole = new THREE.Vector3(), _pax = new THREE.Vector3(), _pdir = new THREE.Vector3(), _pq2 = new THREE.Quaternion(), _wst = new THREE.Vector3();
export function clearGreyArm(g, side, wrist, poleDir, after = null) {
  const u = g.userData, key = '_poleA' + side, last = u[key] || 0;
  _wst.copy(wrist); u['arm' + side].getWorldPosition(_pax); _pax.subVectors(_wst, _pax).normalize();
  const tries = [0]; for (let i = 1; i <= 12; i++) tries.push(i * 0.25, -i * 0.25);
  let best = null, bestN = 1e9, tried = null;
  for (const off of tries.map((o) => o + last).sort((p, q) => Math.abs(p - last) - Math.abs(q - last))) {
    _pdir.copy(poleDir).applyQuaternion(_pq2.setFromAxisAngle(_pax, off));
    u['arm' + side].getWorldPosition(_pole).addScaledVector(_pdir, 0.3);
    solveGreyArm(g, side, _wst, _pole);
    const n = greyArmHits(g, side, after ? after() : null);
    tried = off; if (n < bestN) { bestN = n; best = off; }
    if (n === 0) break;
  }
  if (best !== null) {
    if (tried !== best) { _pdir.copy(poleDir).applyQuaternion(_pq2.setFromAxisAngle(_pax, best)); u['arm' + side].getWorldPosition(_pole).addScaledVector(_pdir, 0.3); solveGreyArm(g, side, _wst, _pole); if (after) after(); }
    u[key] = best;
  }
  return bestN;
}
const _rw = new THREE.Vector3(), _rt = new THREE.Vector3(), _rpd = new THREE.Vector3(), _rq = new THREE.Quaternion();
export function pointGrey(g, side, target, k = 1, reach = false) {
  const u = g.userData, R = side !== 'L', sh = R ? u.armR : u.armL, el = R ? u.foreR : u.foreL, hd = R ? u.handR : u.handL;
  sh.getWorldPosition(_pa); _pa.subVectors(target, _pa);
  const dist = _pa.length() / (g.scale.x || 1); _pa.normalize();
  sh.parent.getWorldQuaternion(_pq).invert(); _pa.applyQuaternion(_pq);
  const z = Math.asin(Math.max(-1, Math.min(1, _pa.x))), x = Math.atan2(-_pa.z, -_pa.y);
  if (reach) {
    const a = 0.2, b = 0.325, d = Math.max(Math.abs(a - b) + 0.01, Math.min(a + b - 0.002, dist));
    const phi = PI - Math.acos((a * a + b * b - d * d) / (2 * a * b)), al = Math.acos((a * a + d * d - b * b) / (2 * a * d));
    // aim, then lift the upper arm by al about its own x axis (the elbow's bend axis) so the triangle closes on the target
    sh.quaternion.setFromEuler(_pe.set(x * k, 0, z * k)).multiply(_pq.setFromAxisAngle(_px, al * k)); el.rotation.set(-phi * k, 0, 0); hd.rotation.set(0, 0, 0);
    // no reach may pass through the grey's own body (build 122): if this pose does, keep the wrist where it is (at full
    // reach, nudge it so the fingertips still land on the target) and solve the arm again with the elbow turned out
    if (greyArmHits(g, side) > 0 && el.parent === sh) {
      const tips = R ? u.tipsR : u.tipsL; hd.getWorldPosition(_rw);
      for (let i = 0; i < (k > 0.999 ? 4 : 1); i++) {
        clearGreyArm(g, side, _rw, _rpd.set(R ? 1 : -1, -0.35, -0.55).normalize().applyQuaternion(u.root.getWorldQuaternion(_rq)));
        hd.rotation.set(0, 0, 0);
        if (k > 0.999) { g.updateMatrixWorld(true); tips.getWorldPosition(_rt); _rw.add(_rt.subVectors(target, _rt).multiplyScalar(0.8)); }
      }
    }
    return;
  }
  sh.rotation.set(x * k, 0, z * k); el.rotation.set(-0.22 * k, 0, 0); hd.rotation.set(0.2 * k, 0, 0);
  const axis = R ? u.gripAxisR : u.gripAxisL;
  if (axis) {
    // holding the wand: the fist comes up and out in front (elbow forward and down, forearm rising toward the target),
    // and the wrist turns so the shaft (which crosses the palm) points at the target
    const sc = g.scale.x || 1;
    sh.getWorldPosition(_pa); _pd.subVectors(target, _pa).normalize();
    _pb.copy(_wy).addScaledVector(_pd, -_wy.dot(_pd)).normalize();                       // up, square to the line of aim
    _pc.copy(_pa).addScaledVector(_pd, 0.14 * sc).addScaledVector(_pb, -0.13 * sc);     // the elbow: forward and down
    sh.quaternion.identity(); sh.parent.getWorldQuaternion(_pq).invert();
    _pe2.subVectors(_pc, _pa).normalize().applyQuaternion(_pq); _q1.setFromUnitVectors(_down, _pe2); sh.quaternion.identity().slerp(_q1, k);
    el.quaternion.identity(); el.parent.getWorldQuaternion(_pq).invert();
    _pe2.copy(_pb).multiplyScalar(0.85).addScaledVector(_pd, 0.55).normalize().applyQuaternion(_pq); _q1.setFromUnitVectors(_down, _pe2); el.quaternion.identity().slerp(_q1, k);  // forearm forward and up: the fist held out
    hd.quaternion.identity(); hd.getWorldPosition(_pa); _pa.subVectors(target, _pa).normalize();
    hd.parent.getWorldQuaternion(_pq).invert(); _pa.applyQuaternion(_pq);
    _q1.setFromUnitVectors(axis, _pa); hd.quaternion.identity().slerp(_q1, k);
  }
}
// one arm raised to chest height, elbow bent, long fingers spread, palm out toward whoever it faces: "be still".
// k 0..1 raises it; t (seconds) adds a slow drift. The other arm hangs loose.
const GREY_HOLD = [-1.027, 0.053, 0.276, -1.502, -1.242, 0.01, 0.516];   // solved: wrist at chest height, palm facing forward, fingers up
export function holdGrey(g, side, k, t = 0) {
  const u = g.userData, R = side !== 'L', s = R ? 1 : -1, P = GREY_HOLD;
  const sh = R ? u.armR : u.armL, el = R ? u.foreR : u.foreL, hd = R ? u.handR : u.handL;
  const d1 = Math.sin(t * 0.7 + s) * 0.04, d2 = Math.sin(t * 0.43 + 2 * s) * 0.05;
  sh.rotation.set((P[0] + d1) * k, s * P[1] * k, s * (P[2] + d2 * 0.5) * k);
  el.rotation.set((P[3] - d2) * k, s * P[4] * k, 0);
  hd.rotation.set((P[5] + d1) * k, 0, s * P[6] * k);
  gripGrey(g, side, (-0.18 + Math.sin(t * 1.3 + s) * 0.06) * k);
  const o = R ? u.armL : u.armR; o.rotation.set(Math.sin(t * 0.5) * 0.04 * k, 0, 0);
}
// the silver wand: a thin shaft with a grip and a red glowing tip at its -y end (userData.tip: hang a light on it)
export function makeWand() {
  const P = G('wand', () => ({ shaft: merge([seg([0, 0.15, 0], [0, -0.15, 0], 0.0055, 0.005, 8), ball(0, 0.15, 0, 0.0065, 0.0065, 0.0065, 8, 6),
    ...[0.08, 0.06, 0.04].map((y) => [G('wandRing', () => new THREE.TorusGeometry(0.0062, 0.0014, 4, 10)), M(0, y, 0, PI / 2)])]), tip: new THREE.SphereGeometry(0.011, 12, 8) }));
  const w = new THREE.Group();
  w.add(new THREE.Mesh(P.shaft, Mt('wandMetal', () => std(0xdfe6ee, { metalness: 0.7, roughness: 0.22, emissive: 0x202428 }))));
  const tip = mesh(P.tip, Mt('wandTip', () => new THREE.MeshBasicMaterial({ color: 0xff2030 })), 0, -0.158, 0); w.add(tip);
  w.userData.tip = tip;
  return w;
}
// breathing and small hand twitches while standing; call every frame
export function idleGrey(g, t) {
  const u = g.userData, b = Math.sin(t * 1.7 + (u.phase || 0)) * 0.012;
  if (u.chest) { u.chest.scale.set(1 + b, 1, 1 + b * 1.4); }
  if (u.handL) { u.handL.rotation.x = Math.sin(t * 0.9) * 0.08; u.handR.rotation.x = Math.sin(t * 1.1 + 1) * 0.08; }
}

// ---------- the mantis ----------
const ROBE = [[0, 0.5], [0.15, 0.46], [0.5, 0.375], [0.9, 0.305], [1.25, 0.262], [1.5, 0.25], [1.68, 0.256], [1.8, 0.238], [1.88, 0.18], [1.94, 0.09], [1.975, 0.0]];
function robeXYZ(th, y, out, off = 0) {
  let r = Math.max(0, profileAt(ROBE, y));
  const amp = 0.05 * (1 - smooth(0.1, 1.45, y)) + 0.006;
  r += amp * (0.62 * Math.sin(th * 9 + 0.5) + 0.38 * Math.sin(th * 5 + 1.7 + y * 2.2));
  const d = Math.atan2(Math.sin(th), Math.cos(th));
  r -= 0.014 * Math.exp(-(d * d) / 0.02) * (1 - smooth(1.7, 1.9, y));
  r = Math.max(0, r) + off;
  return out.set(Math.sin(th) * r * (1 + 0.2 * smooth(1.2, 1.7, y)), y, Math.cos(th) * r * 0.8);
}
const C0 = PI * 0.37, CL = PI * 1.26;
// the high collar: a clean flare, highest at the back, open at the front
function collarXYZ(u, v, out, off = 0) {
  const th = C0 + u * CL, back = -Math.cos(th);
  // a high stand-up collar: frames the back and sides of the head without swallowing it
  const h = 0.3 + 0.08 * back;
  const r = 0.212 - 0.016 * Math.sin(v * PI) + 0.04 * v * v + 0.014 * v * (0.5 - 0.5 * back) + off;
  return out.set(Math.sin(th) * r * 1.12, 1.79 + v * h, Math.cos(th) * r * 0.92 - 0.03);
}
// a bell sleeve hanging down its group's -y from y0, radius r0 widening to r1
function sleeveXYZ(u, v, out, off, y0, len, r0, r1) {
  const th = u * TAU, r = r0 + (r1 - r0) * Math.pow(v, 1.4) + 0.01 * Math.sin(th * 6 + v * 3) * v + off;
  return out.set(Math.sin(th) * r, y0 - v * len, Math.cos(th) * r);
}
const SLEEVE_U = [0.06, 0.62, 0.075, 0.11], SLEEVE_F = [0.08, 0.52, 0.095, 0.155];
// inverted-triangle head: wide crown, narrow jaw, notched between the eye domes
function mantisHeadPt(nx, ny, nz, out) {
  const t = (ny + 1) / 2, w = 0.16 + 0.84 * smooth(0, 0.78, t);
  const y = ny * 0.19 - 0.035 * Math.exp(-(nx * nx) / 0.04) * Math.pow(Math.max(0, ny), 3);
  return out.set(nx * w * 0.25, y, nz * (0.06 + 0.06 * t));
}

function mantisParts() {
  return G('mantis', () => {
    const v = new THREE.Vector3();
    const robe = grid(36, 18, (u, w, o) => robeXYZ(u * TAU, w * 1.975, o));
    const hem = bandUV(grid(48, 1, (u, w, o) => robeXYZ(u * TAU, 0.012 + w * 0.085, o, 0.007)), 4, true);
    const seam = bandUV(grid(1, 26, (u, w, o) => { const y = 0.02 + w * 1.77, r = Math.max(0.12, profileAt(ROBE, y)); return robeXYZ((u - 0.5) * 0.07 / r, y, o, 0.006); }), 3.2, false);
    const collar = grid(28, 8, (u, w, o) => collarXYZ(u, w, o));
    const lining = grid(28, 8, (u, w, o) => collarXYZ(u, w, o, -0.006), true);
    const collarBands = merge([
      [bandUV(grid(64, 1, (u, w, o) => collarXYZ(u, 0.88 + 0.12 * w, o, 0.005)), 4, true)],
      [bandUV(grid(1, 10, (u, w, o) => collarXYZ(0.03 * u, w * 0.88, o, 0.005)), 1, false)],
      [bandUV(grid(1, 10, (u, w, o) => collarXYZ(0.97 + 0.03 * u, w * 0.88, o, 0.005)), 1, false)],
    ]);
    const sleeveU = grid(20, 6, (u, w, o) => sleeveXYZ(u, w, o, 0, ...SLEEVE_U), true);
    const sleeveF = grid(20, 6, (u, w, o) => sleeveXYZ(u, w, o, 0, ...SLEEVE_F), true);
    const cuff = bandUV(grid(24, 1, (u, w, o) => sleeveXYZ(u, 0.86 + 0.14 * w, o, 0.005, ...SLEEVE_F), true), 2, true);
    // head, eyes, face
    const head = sculpt(20, 14, mantisHeadPt);
    // two large slanted eyes on the front of the face
    const eye = (s) => [G('ico2', () => new THREE.IcosahedronGeometry(1, 2)), M(s * 0.118, 0.058, 0.055, 0, s * 0.35, s * 0.62, 0.104, 0.049, 0.055)];
    const eyes = merge([eye(-1), eye(1)]);
    const darkParts = [];
    for (const s of [-1, 1]) darkParts.push(seg([s * 0.022, -0.16, 0.035], [s * 0.04, -0.205, 0.045], 0.012, 0.008, 6), seg([s * 0.04, -0.205, 0.045], [s * 0.014, -0.235, 0.05], 0.008, 0.002, 6));
    const face = merge(darkParts);
    const thorax = merge([ball(0, 1.9, 0.035, 0.092, 0.07, 0.08, 20, 12), seg([0, 1.92, 0.02], [0, 2.02, -0.02], 0.068, 0.03, 14), ball(0, 1.95, 0.06, 0.05, 0.035, 0.03, 12, 8)]);
    // segmented antenna (right side, relative to its base), swept low and back
    const curve = new THREE.CatmullRomCurve3([[0, 0, 0], [0.03, 0.07, -0.02], [0.08, 0.13, -0.08], [0.15, 0.16, -0.17], [0.21, 0.15, -0.25]].map((p) => new THREE.Vector3(...p)));
    const ant = [], bead = G('oct', () => new THREE.OctahedronGeometry(1, 0)), N = 9;
    for (let i = 0; i < N; i++) {
      const a = curve.getPoint(i / N), b = curve.getPoint((i + 1) / N), r0 = 0.006 - i * 0.0005, r1 = 0.006 - (i + 1) * 0.0005;
      ant.push(seg(a.toArray(), b.toArray(), r0, r1, 5), [bead, M(b.x, b.y, b.z, 0, 0, 0, r1 * 1.5)]);
    }
    const antR = merge(ant);
    // neck: thin, ringed
    const neckPts = [[0, 1.9, -0.01], [0, 1.98, -0.02], [0, 2.06, -0.035], [0, 2.14, -0.05]], neck = [];
    for (let i = 0; i < 3; i++) neck.push(seg(neckPts[i], neckPts[i + 1], 0.028, 0.024, 8), ball(...neckPts[i + 1], 0.036, 0.012, 0.036, 10, 4));
    // raptorial arm: the forearm sits inside the sleeve; the hooked hand (tibia and three fingers) comes out at the cuff
    const femur = [seg([0, 0, 0], [0, -0.5, 0], 0.03, 0.02, 8), ball(0, -0.5, 0, 0.022, 0.022, 0.022, 8, 6)];
    const cone = G('cone4', () => new THREE.ConeGeometry(1, 1, 4, 1, true));
    // the hand segment: a wrist joint where it leaves the cuff, the shaft, and a knuckle mass the three fingers grow from
    const tibia = [ball(0, 0, 0, 0.021, 0.021, 0.021, 10, 6), seg([0, 0, 0], [0, -0.26, 0], 0.017, 0.013, 8), ball(0, -0.259, -0.003, 0.022, 0.017, 0.018, 10, 6)];
    for (let i = 0; i < 3; i++) { const y = -0.06 - i * 0.06, l = (0.026 - i * 0.004) * 1.4; tibia.push([cone, M(0, y, -0.014 - l / 2 + 0.004, -PI / 2, 0, 0, 0.004, l, 0.004)]); }
    // three long hooked fingers (about 40% longer than they were)
    const fx = (f0, f, k = 1.4) => f0.map((c, i) => c + (f[i] - c) * k);
    // each finger is its own piece with its knuckle at the origin (placed at [k * 0.009, -0.26, 0] on the wrist), so it can curl
    const fingers = [];
    for (let k = -1; k <= 1; k++) { const f0 = [k * 0.009, -0.26, 0], o = (p) => p.map((c, i) => c - f0[i]), f1 = o(fx(f0, [k * 0.016, -0.305, -0.008])), f2 = o(fx(f0, [k * 0.018, -0.335, -0.034])); fingers.push(merge([seg([0, 0, 0], f1, 0.0075, 0.005, 5), ball(...f1, 0.0055, 0.0055, 0.0055, 5, 4), seg(f1, f2, 0.005, 0.0012, 5)])); }
    // medallion and chain: a heavy-rimmed disc in raised relief: an open eye inside a triangle, in a ring of sixteen rays
    // (long and short), a beaded inner ring. The pupil is the one dark, sunk part (medalMark).
    robeXYZ(0, 1.5, v); const mz = v.z + 0.01, mf = mz + 0.004, MY = 1.5;
    const md = [[G('medalDisc3', () => new THREE.CylinderGeometry(0.066, 0.066, 0.008, 36)), M(0, MY, mz, PI / 2)],
      [G('medalRim2', () => new THREE.TorusGeometry(0.0625, 0.0055, 8, 48)), M(0, MY, mf - 0.001)]];
    for (let i = 0; i < 16; i++) {   // rays between the triangle and the rim, tapering outward
      const a = i * TAU / 16 + PI / 2, r0 = 0.034, r1 = i % 2 ? 0.047 : 0.053, rm = (r0 + r1) / 2;
      md.push([cone, M(Math.cos(a) * rm, MY + Math.sin(a) * rm, mf + 0.0012, 0, 0, a - PI / 2, 0.0034, r1 - r0, 0.0016)]);
    }
    for (let i = 0; i < 24; i++) { const a = i * TAU / 24; md.push(ball(Math.cos(a) * 0.0565, MY + Math.sin(a) * 0.0565, mf + 0.0006, 0.0017, 0.0017, 0.0012, 5, 4)); }
    const tri = [0, 1, 2].map((i) => { const a = PI / 2 + i * TAU / 3; return [Math.cos(a) * 0.031, MY - 0.002 + Math.sin(a) * 0.031]; });
    for (let i = 0; i < 3; i++) {   // the triangle: three raised bars
      const [x0, y0] = tri[i], [x1, y1] = tri[(i + 1) % 3], L = Math.hypot(x1 - x0, y1 - y0);
      md.push(box((x0 + x1) / 2, (y0 + y1) / 2, mf + 0.0018, L + 0.004, 0.0042, 0.0036, 0, 0, Math.atan2(y1 - y0, x1 - x0)));
    }
    // the eye: an almond lid, a domed iris ring, lashes of light above it
    md.push(ball(0, MY - 0.006, mf + 0.0012, 0.0175, 0.0085, 0.0024, 14, 6));
    md.push([G('medalIris', () => new THREE.TorusGeometry(0.0062, 0.0016, 6, 20)), M(0, MY - 0.006, mf + 0.0034)]);
    for (let i = -2; i <= 2; i++) { const a = PI / 2 + i * 0.32; md.push(box(Math.cos(a) * 0.015, MY - 0.006 + Math.sin(a) * 0.015, mf + 0.0012, 0.0016, 0.006, 0.0018, 0, 0, a - PI / 2)); }
    const medal = merge(md);
    const medalMark = merge([ball(0, MY - 0.006, mf + 0.0034, 0.0042, 0.0042, 0.0015, 10, 6)]);
    const chain = [];
    for (const s of [-1, 1]) for (let i = 0; i <= 13; i++) { const t = i / 13, th = s * 0.45 * (1 - t), y = 1.83 - 0.25 * t; robeXYZ(th, y, v); chain.push([bead, M(v.x + Math.sin(th) * 0.012, v.y, v.z + Math.cos(th) * 0.012, 0, 0, i * 0.7, 0.0065)]); }
    return {
      robe, hem, seam, collar, lining, collarBands, sleeveU, sleeveF, cuff, elbow: sphG(12, 8), head, eyes, face, antR, antL: mirrorX(antR), neck: merge(neck), femur: merge(femur), tibia: merge(tibia), fingers,
      medal, medalMark, medalZ: mz, chain: merge(chain), thorax,
    };
  });
}

// ---- the mantis's sleeves: cloth that hangs ----
// One small dynamic mesh per sleeve, in the mantis root's space. Rings run from the shoulder (fitted, inside the robe) along
// the shoulder->elbow->wrist chain to a wide open cuff at the wrist. The lower side of each ring is pulled along gravity
// (lagged, with a little sway), so the forearm part becomes a deep swag that always hangs straight down, whatever the arm
// does. Soft vertical folds ripple the hanging cloth. Recomputed before each render from the joints, without allocating.
// Per-render cloth updates must run BEFORE three uploads geometry for the frame. A mesh's own onBeforeRender comes after the
// upload, so a vertex change made there only shows one render later (the sleeve stayed where the arm had been, which a
// test still, or any frame after a pose jump, shows plainly). So the updates hang off the scene's onBeforeRender, which
// three calls before it walks the scene; the mesh hook only registers the update (and runs it once, the first time).
const _pre = new Set();
function hookScene(scene) {
  if (scene.userData.preHook) return; scene.userData.preHook = true;
  const prev = scene.onBeforeRender;
  scene.onBeforeRender = function (r, sc, c, t) { prev.call(this, r, sc, c, t); for (const e of _pre) { let o = e.obj; while (o.parent) o = o.parent; if (o === sc) { e.on = true; e.fn(); } else if (e.on) _pre.delete(e); } };
}
// registered at once (so the very first render is right once the scene is hooked; idleMantis hooks the scene it is in);
// dropped once its object has been in a scene and left it; the mesh hook re-registers it if it comes back
function preRender(obj, fn) { const e = { obj, fn, on: false }; _pre.add(e); obj.onBeforeRender = (renderer, scene) => { if (!_pre.has(e)) { e.on = false; _pre.add(e); fn(); } if (scene && scene.isScene) hookScene(scene); }; }

const SL_NU = 16, SL_NV = 18, SL_SAG = 0.23;
// the folded (praying) pose: upper arm close in at the side, elbow sharply bent so the forearm folds up in front of the
// chest, swung slightly inward; the hands fold down from the cuffs, hooks turned back toward the body
const FOLD_SH = [-0.12, 0.2, 0.1], FOLD_EL = -2.45, WRF = 1.8;
const _sS = new THREE.Vector3(), _sE = new THREE.Vector3(), _sW = new THREE.Vector3(), _sC = new THREE.Vector3(), _sT = new THREE.Vector3(), _sT2 = new THREE.Vector3();
const _sN = new THREE.Vector3(), _sB = new THREE.Vector3(), _sG = new THREE.Vector3(), _sP = new THREE.Vector3(), _sInv = new THREE.Matrix4(), _sX = new THREE.Vector3(1, 0, 0);
const _sA = new THREE.Vector3(), _sD = new THREE.Vector3(), _sU = new THREE.Vector3();
function makeSleeve(arm, root, outerM, innerM, trimM) {
  const NU = SL_NU, NV = SL_NV, n = (NU + 1) * (NV + 1);
  const geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
  for (let j = 0; j <= NU; j++) for (let k = 0; k <= NV; k++) { const i = j * (NV + 1) + k; uv[i * 2] = k / NV * 2; uv[i * 2 + 1] = j / NU; }
  for (let j = 0; j < NU; j++) for (let k = 0; k < NV; k++) { const a = j * (NV + 1) + k, b = a + 1, d = a + NV + 1, c = d + 1; idx.push(a, b, d, b, c, d); }
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // the gold-trimmed cuff: a narrow band just outside the last rings
  const bgeo = new THREE.BufferGeometry(), bpos = new Float32Array(2 * (NV + 1) * 3), buv = new Float32Array(2 * (NV + 1) * 2), bidx = [];
  for (let j = 0; j < 2; j++) for (let k = 0; k <= NV; k++) { const i = j * (NV + 1) + k; buv[i * 2] = j; buv[i * 2 + 1] = k / NV * 3; }
  for (let k = 0; k < NV; k++) { const a = k, b = a + 1, d = a + NV + 1, c = d + 1; bidx.push(a, b, d, b, c, d); }
  bgeo.setIndex(bidx); bgeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3).setUsage(THREE.DynamicDrawUsage)); bgeo.setAttribute('uv', new THREE.BufferAttribute(buv, 2));
  const outer = new THREE.Mesh(geo, outerM), inner = new THREE.Mesh(geo, innerM), band = new THREE.Mesh(bgeo, trimM);
  for (const m of [outer, inner, band]) { m.frustumCulled = false; root.add(m); }
  const st = { g: new THREE.Vector3(0, -1, 0), t: -1, frame: -1, s: arm.s };
  const ringPt = (u, k, rScale, out) => {
    // centre and tangent along the arm chain (shoulder->elbow over u 0..0.45, elbow->wrist over 0.45..1), rounded at the elbow
    const e = 0.45;
    if (u < e) { _sC.lerpVectors(_sS, _sE, u / e); _sT.subVectors(_sE, _sS).normalize(); } else { _sC.lerpVectors(_sE, _sW, (u - e) / (1 - e)); _sT.subVectors(_sW, _sE).normalize(); }
    const bl = 1 - Math.min(1, Math.abs(u - e) / 0.08);
    if (bl > 0) { _sT2.subVectors(u < e ? _sW : _sE, u < e ? _sE : _sS).normalize(); _sT.lerp(_sT2, bl * 0.5).normalize(); }
    // the ring's "down" side: gravity, square to the arm (with a fallback when the arm itself hangs straight down)
    _sN.copy(st.g).addScaledVector(_sT, -st.g.dot(_sT));
    if (_sN.lengthSq() < 0.02) _sN.crossVectors(_sT, _sX);
    _sN.normalize(); _sB.crossVectors(_sT, _sN);
    const th = k / NV * TAU, down = Math.max(0, Math.cos(th));
    // narrow, and laid over the top of the arm: the ring's upper edge rests on the arm and the rest hangs below it
    const r = (0.06 + 0.014 * smooth(0, 0.45, u) + 0.022 * smooth(0.45, 1, u)) * rScale;
    const hang = smooth(0.3, 1, u), sag = SL_SAG * Math.pow(hang, 1.3) * Math.pow(down, 1.6);
    const fold = 0.014 * Math.sin(th * 6 + u * 4 + st.s) * down * hang;
    const rest = (r - 0.052) * smooth(0.12, 0.5, u);   // slide the ring down so its top sits just over the arm (clear of the forearm tube)
    return out.copy(_sC).addScaledVector(_sN, Math.cos(th) * r + rest).addScaledVector(_sB, Math.sin(th) * r * 0.72 + fold * 0.7).addScaledVector(st.g, sag);
  };
  const update = () => {
    const now = performance.now() / 1000, dt = st.t < 0 ? 1 : Math.min(0.1, now - st.t); st.t = now;
    root.updateWorldMatrix(true, false); _sInv.copy(root.matrixWorld).invert();
    arm.sh.getWorldPosition(_sS).applyMatrix4(_sInv); arm.el.getWorldPosition(_sE).applyMatrix4(_sInv); arm.wr.getWorldPosition(_sW).applyMatrix4(_sInv);
    // gravity in the root's frame, eased (the cloth lags a little) with a slow sway
    _sG.set(Math.sin(now * 1.1 + st.s) * 0.06, -1, Math.sin(now * 0.8 + st.s * 2) * 0.05).transformDirection(_sInv);
    st.g.lerp(_sG, Math.min(1, dt * 5)).normalize();
    for (let j = 0; j <= NU; j++) for (let k = 0; k <= NV; k++) { ringPt(j / NU, k, 1, _sP); const i = (j * (NV + 1) + k) * 3; pos[i] = _sP.x; pos[i + 1] = _sP.y; pos[i + 2] = _sP.z; }
    // normals from the grid (around x along), no allocation
    for (let j = 0; j <= NU; j++) for (let k = 0; k <= NV; k++) {
      const i = j * (NV + 1) + k, ja = Math.max(0, j - 1), jb = Math.min(NU, j + 1), ka = k === 0 ? NV - 1 : k - 1, kb = k === NV ? 1 : k + 1;
      const a1 = (ja * (NV + 1) + k) * 3, b1 = (jb * (NV + 1) + k) * 3, a2 = (j * (NV + 1) + ka) * 3, b2 = (j * (NV + 1) + kb) * 3;
      _sA.set(pos[b1] - pos[a1], pos[b1 + 1] - pos[a1 + 1], pos[b1 + 2] - pos[a1 + 2]); _sD.set(pos[b2] - pos[a2], pos[b2 + 1] - pos[a2 + 1], pos[b2 + 2] - pos[a2 + 2]);
      _sU.crossVectors(_sD, _sA).normalize(); nor[i * 3] = _sU.x; nor[i * 3 + 1] = _sU.y; nor[i * 3 + 2] = _sU.z;
    }
    for (let j = 0; j < 2; j++) for (let k = 0; k <= NV; k++) { ringPt(0.955 + 0.045 * j, k, 1.03, _sP); const i = (j * (NV + 1) + k) * 3; bpos[i] = _sP.x; bpos[i + 1] = _sP.y; bpos[i + 2] = _sP.z; }
    geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true; bgeo.attributes.position.needsUpdate = true;
    bgeo.computeVertexNormals();   // the cuff band needs normals to be lit at all; without them its gold read as black
  };
  preRender(outer, update);
  return { outer, inner, band, update };
}

// ---- the mantis's skirt: the lower robe swings ----
// One damped spring per mantis (game time, stepped from idleMantis): the hem trails behind its motion, twists against its
// turns, hangs toward world down when the body tips, sways a little at rest, with a soft ripple round the hem. Each ring
// is moved as a whole (shift + twist, more toward the hem), so the cloth never folds through itself; it only ever rises,
// so it never goes through the floor. Applied to the robe, hem band and seam (cloned per mantis) just before drawing.
const SK_TOP = 1.3;
const _kP = new THREE.Vector3(), _kQ = new THREE.Quaternion(), _kS = new THREE.Vector3(), _kV = new THREE.Vector3(), _kG = new THREE.Vector3(), _kF = new THREE.Vector3();
function makeSkirt(root, meshes) {
  const parts = meshes.map((m) => {
    const geo = m.geometry; geo.userData = {}; m.frustumCulled = false;
    const p = geo.attributes.position, nr = geo.attributes.normal; p.setUsage(THREE.DynamicDrawUsage); nr.setUsage(THREE.DynamicDrawUsage);
    const idx = [], w = [], th = [];
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < SK_TOP) { idx.push(i); w.push(Math.pow(1 - y / SK_TOP, 1.5)); th.push(Math.atan2(p.getX(i), p.getZ(i))); } }
    return { geo, p, nr, p0: p.array.slice(), n0: nr.array.slice(), idx, w, th };
  });
  const st = { ox: 0, oz: 0, vx: 0, vz: 0, tw: 0, tv: 0, spd: 0, t: 0, init: false, yaw: 0, p: new THREE.Vector3(), frame: -1 };
  const step = (dt, t) => {
    st.t = t; if (!(dt > 0)) return; dt = Math.min(dt, 0.1);
    root.updateWorldMatrix(true, false); root.matrixWorld.decompose(_kP, _kQ, _kS);
    const yaw = Math.atan2(_kF.set(0, 0, 1).applyQuaternion(_kQ).x, _kF.z);
    if (!st.init) { st.p.copy(_kP); st.yaw = yaw; st.init = true; }
    _kV.subVectors(_kP, st.p).divideScalar(dt * (_kS.x || 1)); st.p.copy(_kP);
    let dy = yaw - st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); st.yaw = yaw;
    if (_kV.lengthSq() > 36) { _kV.set(0, 0, 0); dy = 0; }   // a jump cut, not motion
    _kQ.invert(); _kV.applyQuaternion(_kQ); _kG.set(0, -1, 0).applyQuaternion(_kQ);
    const sp = Math.hypot(_kV.x, _kV.z); st.spd += (Math.min(1.5, sp) - st.spd) * Math.min(1, dt * 3);
    let tx = -_kV.x * 0.16 + _kG.x * 0.5 + Math.sin(t * 0.83) * 0.012 + Math.sin(t * 1.9 + 1) * 0.004;
    let tz = -_kV.z * 0.16 + _kG.z * 0.5 + Math.sin(t * 0.61 + 2) * 0.01;
    const tl = Math.hypot(tx, tz); if (tl > 0.22) { tx *= 0.22 / tl; tz *= 0.22 / tl; }
    const ttw = Math.max(-0.3, Math.min(0.3, -dy / dt * 0.1)) + Math.sin(t * 0.5) * 0.02;
    // under-damped springs, a few substeps so big frames stay stable
    const n = Math.ceil(dt / 0.016), h = dt / n;
    for (let i = 0; i < n; i++) {
      st.vx += (30 * (tx - st.ox) - 5.5 * st.vx) * h; st.vz += (30 * (tz - st.oz) - 5.5 * st.vz) * h; st.ox += st.vx * h; st.oz += st.vz * h;
      st.tv += (20 * (ttw - st.tw) - 4 * st.tv) * h; st.tw += st.tv * h;
    }
  };
  const apply = () => {
    const t = st.t, amp = 0.004 + 0.014 * st.spd;
    for (const P of parts) {
      const a = P.p.array, na = P.nr.array, p0 = P.p0, n0 = P.n0;
      for (let j = 0; j < P.idx.length; j++) {
        const i3 = P.idx[j] * 3, w = P.w[j], th = P.th[j], ang = st.tw * w, c = Math.cos(ang), sn = Math.sin(ang);
        let x = p0[i3], z = p0[i3 + 2]; const y0 = p0[i3 + 1], r0 = Math.hypot(x, z) || 1;
        const rip = w * w * amp * (Math.sin(th * 3 - t * 2.1) + 0.6 * Math.sin(th * 5 + t * 1.3));
        x += x / r0 * rip; z += z / r0 * rip;
        const dx = st.ox * w, dz = st.oz * w;
        a[i3] = x * c + z * sn + dx; a[i3 + 2] = -x * sn + z * c + dz;
        a[i3 + 1] = y0 + (dx * dx + dz * dz) / (2 * Math.max(0.35, SK_TOP - y0));
        const nx = n0[i3], nz = n0[i3 + 2]; na[i3] = nx * c + nz * sn; na[i3 + 2] = -nx * sn + nz * c;
      }
      P.p.needsUpdate = true; P.nr.needsUpdate = true;
    }
  };
  preRender(meshes[0], apply);
  return { step, apply, st };
}

export function makeMantis() {
  const P = mantisParts();
  const robeMat = new THREE.MeshPhysicalMaterial({ color: 0x5a1e8c, roughness: 0.62, emissive: 0x1c0638, side: THREE.DoubleSide, map: brocadeTex(), bumpMap: robeBump(), bumpScale: 0.7, sheen: 1, sheenColor: new THREE.Color(0xc89ae6), sheenRoughness: 0.38 });
  const skin = Mt('chitin2', () => new THREE.MeshPhysicalMaterial({ color: 0x6f9a46, roughness: 0.4, metalness: 0.05, map: chitinTex(), bumpMap: chitinBump(), bumpScale: 0.9, clearcoat: 0.55, clearcoatRoughness: 0.28, envMap: studioEnv(), envMapIntensity: 0.3 }));
  const darkSkin = Mt('chitinDark2', () => new THREE.MeshPhysicalMaterial({ color: 0x2c3a1c, roughness: 0.32, metalness: 0.1, bumpMap: chitinBump(), bumpScale: 0.6, clearcoat: 0.6, clearcoatRoughness: 0.2, envMap: studioEnv(), envMapIntensity: 0.3 }));
  // the gold script: metal that reflects a dim room, with a little self-light so the glyphs still read in the dark
  const goldScript = Mt('goldScript2', () => { const gt = wrapTex(paint('glyphs', 128, 1024, drawGlyphs), [1, 1]); return std(0xffffff, { map: gt, metalness: 0.75, roughness: 0.32, envMap: studioEnv(), envMapIntensity: 1, emissive: 0xffffff, emissiveMap: gt, emissiveIntensity: 0.3, alphaTest: 0.35, side: THREE.DoubleSide }); });
  // worked gold: properly metallic, softly polished, reflecting a dim room
  const gold = Mt('gold2', () => std(0xe8b24c, { metalness: 0.92, roughness: 0.3, envMap: studioEnv(), envMapIntensity: 1.15, emissive: 0x1a1004 }));
  const incised = Mt('medalPupil', () => std(0x140c04, { roughness: 0.3, metalness: 0.2 }));
  const lining = Mt('liningPurple', () => std(0x6a2a9e, { roughness: 0.7, emissive: 0x220a3c, map: fabricTex() }));
  const eyeM = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.08, metalness: 0.5, emissive: 0xffffff, emissiveMap: T.stars(260, 1), emissiveIntensity: 0.25, flatShading: true });

  const g = new THREE.Group();
  const root = new THREE.Group(); g.add(root);
  // the robe, hem band and seam are this mantis's own copies: the skirt moves them
  const robeM = new THREE.Mesh(P.robe.clone(), robeMat), hemM = new THREE.Mesh(P.hem.clone(), goldScript), seamM = new THREE.Mesh(P.seam.clone(), goldScript);
  root.add(robeM, new THREE.Mesh(P.collar, robeMat), new THREE.Mesh(P.lining, lining));
  root.add(hemM, seamM, new THREE.Mesh(P.collarBands, goldScript), new THREE.Mesh(P.thorax, skin));
  root.add(new THREE.Mesh(P.medal, gold), new THREE.Mesh(P.chain, gold), new THREE.Mesh(P.medalMark, incised));
  // neck pivots where it leaves the robe; the head pivots at its own centre (tilt)
  const neck = new THREE.Group(); neck.position.set(0, 1.9, -0.01); root.add(neck);
  neck.add(mesh(P.neck, skin, 0, -1.9, 0.01));
  const head = new THREE.Group(); head.position.set(0, 0.34, 0.01); neck.add(head);
  head.add(new THREE.Mesh(P.head, skin), new THREE.Mesh(P.eyes, eyeM), new THREE.Mesh(P.face, darkSkin));
  const ant = [-1, 1].map((s) => { const a = new THREE.Group(); a.position.set(s * 0.03, 0.17, 0.05); a.add(new THREE.Mesh(s < 0 ? P.antL : P.antR, darkSkin)); head.add(a); return a; });
  // jointed raptorial arms (shoulder, elbow, wrist) coming out of wide sleeves; folded = praying pose
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.26, 1.74, 0.05); root.add(sh);
    const el = new THREE.Group(); el.position.y = -0.52; sh.add(el);
    el.add(new THREE.Mesh(P.femur, skin));
    const wr = new THREE.Group(); wr.position.y = -0.5; el.add(wr);
    wr.add(new THREE.Mesh(P.tibia, skin));
    const fing = P.fingers.map((fg, i) => { const f = new THREE.Group(); f.position.set((i - 1) * 0.009, -0.26, 0); f.add(new THREE.Mesh(fg, skin)); wr.add(f); return f; });
    arms.push({ sh, el, wr, s, fing });
  }
  const u = { head, robeMat, eyeM, arms, tilt: 0, ant, neck, root, fold: 1, wrBase: WRF };
  // fold 1 = arms folded in prayer, 0 = unfolded and reaching forward with the hooks open
  u.setFold = (f) => {
    u.fold = f; u.wrBase = 0.5 + (WRF - 0.5) * f;   // folded: the hooks come forward out of the cuffs, not down over the sleeves
    // the arms work in the body's forward plane: elbows forward and down, never out to the side; tipped slightly inward
    for (const a of arms) { a.sh.rotation.set(-1.25 + (1.25 + FOLD_SH[0]) * f, -a.s * FOLD_SH[1] * f, -a.s * (0.06 + (FOLD_SH[2] - 0.06) * f)); a.el.rotation.set(-0.55 + (0.55 + FOLD_EL) * f, 0, 0); a.wr.rotation.x = u.wrBase; }
  };
  u.setFold(1);
  // bow the head: the neck tips forward and the head follows; k 0 upright .. 1 a deep slow bow
  u.nodK = 0;
  u.nod = (k) => { u.nodK = k; neck.rotation.x = 0.3 * k; head.rotation.x = 0.4 * k; };
  // reach the arm nearer a world point so the tip of its middle hook comes to rest on it, coming down from above and from the
  // mantis's side (two-bone solve for shoulder and elbow, then the wrist aims the hand). k 0..1 blends from the current pose.
  const _rS = new THREE.Vector3(), _rW = new THREE.Vector3(), _rE = new THREE.Vector3(), _rD = new THREE.Vector3(), _rP = new THREE.Vector3();
  const _rQ = new THREE.Quaternion(), _rQ2 = new THREE.Quaternion(), _rDn = new THREE.Vector3(0, -1, 0), _rTip = new THREE.Vector3(0, -0.367, -0.048);
  const aimBone = (b, from, to, localAxis, k) => {
    b.parent.getWorldQuaternion(_rQ2).invert(); _rD.subVectors(to, from).normalize().applyQuaternion(_rQ2);
    _rQ.setFromUnitVectors(localAxis, _rD); b.quaternion.slerp(_rQ, k); b.updateMatrixWorld(true);
  };
  const _rF = new THREE.Quaternion(), _rEu = new THREE.Euler();
  u.reachTo = (target, k, side) => {
    if (side) {
      const a = arms.find((x) => x.s === side); a.reachK = Math.max(0, k);
      if (k > 0) { g.updateMatrixWorld(true); solve(a, target, k); }
      return;
    }
    u.reachK = Math.max(0, k);
    if (k <= 0) { u.reachArm = null; return; }
    g.updateMatrixWorld(true);
    const a = u.reachArm || (u.reachArm = arms.reduce((best, x) => (x.sh.getWorldPosition(_rS).distanceToSquared(target) < best.d ? { a: x, d: _rS.distanceToSquared(target) } : best), { a: arms[0], d: Infinity }).a);
    // the other arm stays folded at the chest whatever setFold says, so it never pokes out toward the viewer
    const ok = Math.min(1, k * 5);
    for (const o of arms) if (o !== a) {
      o.sh.quaternion.slerp(_rF.setFromEuler(_rEu.set(FOLD_SH[0], -o.s * FOLD_SH[1], -o.s * FOLD_SH[2])), ok); o.el.quaternion.slerp(_rF.setFromEuler(_rEu.set(FOLD_EL, 0, 0)), ok);
      o.wr.quaternion.slerp(_rF.setFromEuler(_rEu.set(WRF, 0, 0)), ok); o.sh.updateMatrixWorld(true);
    }
    solve(a, target, k);
  };
  const solve = (a, target, k) => {
    const sc = g.getWorldScale(_rP).x, la = 0.52 * sc, lb = 0.5 * sc, lt = _rTip.length() * sc;
    a.sh.getWorldPosition(_rS);
    // the hand comes in from the mantis's side, sloping down onto the point
    _rD.subVectors(target, _rS); _rD.y = 0; _rD.normalize().multiplyScalar(0.7); _rD.y = -0.71; _rD.normalize();
    _rW.copy(target).addScaledVector(_rD, -lt);
    // elbow: on the triangle, bent down and a little outward
    const d = Math.min(la + lb - 0.002, Math.max(Math.abs(la - lb) + 0.01, _rS.distanceTo(_rW)));
    const along = _rD.subVectors(_rW, _rS).normalize(), x = (la * la + d * d - lb * lb) / (2 * d), h = Math.sqrt(Math.max(0, la * la - x * x));
    root.localToWorld(_rP.set(a.s * 1, 0.35, 0.1)).sub(root.getWorldPosition(_rE)); _rP.addScaledVector(along, -_rP.dot(along)).normalize();
    _rE.copy(_rS).addScaledVector(along, x).addScaledVector(_rP, h);
    aimBone(a.sh, _rS, _rE, _rDn, k);
    a.el.getWorldPosition(_rE); aimBone(a.el, _rE, _rW, _rDn, k);
    a.wr.getWorldPosition(_rW); _rP.copy(_rTip).normalize(); aimBone(a.wr, _rW, target, _rP, k);
  };
  u.curl = (side, c, point = false) => { for (const a of arms) if (a.s === side) a.fing.forEach((f, i) => { f.rotation.x = point && i === 1 ? 0 : 1.35 * c; f.rotation.z = point && i !== 1 ? (1 - i) * 0.25 * c : 0; }); };
  // wide hanging sleeves: robe cloth outside (same colour object as the robe, so colour animation carries over), purple lining inside
  const sleeveOut = robeMat.clone(); sleeveOut.side = THREE.FrontSide; sleeveOut.color = robeMat.color; sleeveOut.emissive = robeMat.emissive;
  const sleeveIn = Mt('liningBack', () => { const m = lining.clone(); m.side = THREE.BackSide; return m; });
  g.scale.setScalar(1.02); g.updateMatrixWorld(true);
  u.sleeves = arms.map((a) => makeSleeve(a, root, sleeveOut, sleeveIn, goldScript));
  for (const sl of u.sleeves) sl.update();
  u.skirt = makeSkirt(root, [robeM, hemM, seamM]);
  g.userData = u;
  return g;
}
// occasional sharp insect head-tilt, a slow sway of the body and neck, antennae and hooks alive; call every frame
export function idleMantis(m, dt, t) {
  const u = m.userData;
  if (Math.random() < dt * 0.25) u.tilt = (Math.random() - 0.5) * 0.9;
  if (Math.random() < dt * 0.4) u.tilt = 0;
  u.head.rotation.z += (u.tilt - u.head.rotation.z) * Math.min(1, dt * 14);
  m.position.y = Math.sin(t * 0.7) * 0.01;
  if (u.root) { u.root.rotation.z = Math.sin(t * 0.45) * 0.012; u.root.rotation.x = Math.sin(t * 0.31) * 0.008; }
  if (u.neck) { u.neck.rotation.x = Math.sin(t * 0.6) * 0.035 + 0.3 * (u.nodK || 0); u.neck.rotation.y = Math.sin(t * 0.37) * 0.05; u.head.rotation.x = 0.4 * (u.nodK || 0); }
  if (u.ant) { u.ant[0].rotation.x = Math.sin(t * 1.9) * 0.09; u.ant[0].rotation.z = Math.sin(t * 1.3) * 0.06; u.ant[1].rotation.x = Math.sin(t * 2.3 + 1) * 0.09; u.ant[1].rotation.z = Math.sin(t * 1.1 + 2) * 0.06; }
  if (u.arms) for (let i = 0; i < u.arms.length; i++) {
    const a = u.arms[i], rk = u.reachArm ? u.reachK || 0 : 0;
    if ((rk > 0 && a === u.reachArm) || a.reachK > 0) continue;
    a.wr.rotation.x = (u.wrBase ?? WRF) + (WRF - (u.wrBase ?? WRF)) * Math.min(1, rk * 5) + Math.sin(t * 0.8 + i * 1.7) * 0.04;
  }
  if (u.skirt) u.skirt.step(dt, t);
  if (!u.hooked) { let o = m; while (o.parent) o = o.parent; if (o.isScene) { hookScene(o); u.hooked = true; } }
}

// ---------- people ----------
const HR = 0.105;
function humanHeadPt(nx, ny, nz, out) {
  const up = Math.max(0, ny), dn = Math.max(0, -ny), w = 1 - 0.22 * dn * dn;
  let z = nz * w * 1.06;
  if (nz < 0) z *= 1 + 0.12 * up;
  z += 0.08 * dn * dn * Math.max(0, nz);
  return out.set(nx * w * 0.92 * HR, ny * (ny > 0 ? 1.08 : 1.2) * HR, z * HR);
}
const onHumanHead = (nx, ny, out) => humanHeadPt(nx, ny, Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)), out);
// ---- hands for people in the distance: one static piece, same layout as the player's skinned hand (below) ----
// Right hand as seen by its owner: wrist at the origin, fingers down -y, palm toward -x, thumb toward -z.
const SKIN = 0xc9a48a, NAIL = 0xcf9e8e, NAILTIP = 0xe2cfbf;
const tag = (part, col) => [part[0], part[1], col];
function handParts() {
  return G('handParts2', () => {
    const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    const lite = [tag(ball(0, -0.046, 0, 0.0155, 0.047, 0.036, 8, 5), SKIN), tag(ball(0, -0.004, 0, 0.0172, 0.014, 0.026, 6, 4), SKIN)];
    // fingers: from inside the palm, two bends of a relaxed half-curl, rounded tips
    HF.forEach((f, k) => {
      const d = new THREE.Vector3(0, -1, f.d).normalize(), K = V3(f.k), b = K.clone().addScaledVector(d, -0.012);
      const p1 = K.clone().addScaledVector(d, f.L[0]).add(new THREE.Vector3(-0.006, 0.002, 0)), p2 = p1.clone().addScaledVector(d, f.L[1]).add(new THREE.Vector3(-0.008, 0.004, 0)), tp = p2.clone().addScaledVector(d, f.L[2]).add(new THREE.Vector3(-0.007, 0.005, 0));
      lite.push(tag(seg(b.toArray(), p1.toArray(), f.r, f.r * 0.92, 5), SKIN), tag(ball(...p1.toArray(), f.r * 0.92, f.r * 0.92, f.r * 0.92, 4, 3), SKIN), tag(seg(p1.toArray(), p2.toArray(), f.r * 0.92, f.r * 0.84, 5), SKIN), tag(ball(...p2.toArray(), f.r * 0.84, f.r * 0.84, f.r * 0.84, 4, 3), SKIN), tag(seg(p2.toArray(), tp.toArray(), f.r * 0.84, f.r * 0.76, 5), SKIN), tag(ball(...tp.toArray(), f.r * 0.76, f.r * 0.76, f.r * 0.76, 4, 3), SKIN));
    });
    // thumb: grows from a fleshy thenar mound low by the wrist, metacarpal + two phalanges
    let p = V3(HT.c); const pts = [p.clone().addScaledVector(V3(HT.dirs[0]).normalize(), -0.012), p.clone()];
    HT.L.forEach((L, i) => { p = p.clone().addScaledVector(V3(HT.dirs[i]).normalize(), L); pts.push(p); });
    const mid = pts[1].clone().lerp(pts[2], 0.45);
    lite.push(tag(ball(mid.x - 0.004, mid.y, mid.z + 0.004, 0.016, 0.022, 0.016, 8, 5), SKIN));
    for (let i = 0; i < 4; i++) lite.push(tag(seg(pts[i].toArray(), pts[i + 1].toArray(), HT.r[Math.min(i, 4)], HT.r[Math.min(i + 1, 4)], 5), SKIN), tag(ball(...pts[i + 1].toArray(), HT.r[Math.min(i + 1, 4)], HT.r[Math.min(i + 1, 4)], HT.r[Math.min(i + 1, 4)], 4, 3), SKIN));
    const P = { lite: merge(lite) }; P.liteL = mirrorX(P.lite);
    return P;
  });
}
const handSkinMat = () => Mt('handSkin', () => std(0xffffff, { vertexColors: true, roughness: 0.62, map: skinTex(), bumpMap: skinTex(), bumpScale: 0.6 }));
// eased 0..1 with a small overshoot and settle; x outside 0..1 clamps
const settle = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x) + 0.09 * Math.sin(PI * x) * x * x; };

// ---- the player's hands: one skinned mesh per hand ----
// Hand-local frame (right hand): wrist at the origin, fingers toward -y, palm facing -x, back facing +x, thumb on the -z side.
// The left hand is the same build mirrored in x. Geometry is shared (cached); each body gets its own bones.
//
// Construction: a palm shell (super-ellipsoid, two sheets: back and palm, sharing the rim) shaped with knuckle bumps, tendon
// ridges, thenar / hypothenar pads, a hollow and a radial bulge that forms the web to the thumb; a wrist tube with the ulnar bump;
// four fingers and the thumb as tubes swept along their joints (rings denser at the joints, palm-side creases cut in, pads,
// rounded caps). Every finger and the thumb start well inside the palm, so no seam can open. Bones: a root, three per finger
// (proximal, middle, distal), three for the thumb (metacarpal from a low carpometacarpal joint by the wrist, proximal, distal).
// Weights blend across each joint over about half the local radius; the palm's knuckle region follows the proximal bones a
// little and the web region follows the thumb metacarpal. Nails are inset plates in a second (glossier) material group.
const HF = [ // knuckle (MCP), splay (z drift per unit -y), phalanx lengths, base radius, spread direction
  { k: [0, -0.082, -0.0275], d: -0.07, L: [0.040, 0.024, 0.019], r: 0.0091, sp: 0.12 },
  { k: [0.001, -0.086, -0.0085], d: -0.005, L: [0.045, 0.028, 0.020], r: 0.0094, sp: 0.02 },
  { k: [0, -0.083, 0.0105], d: 0.05, L: [0.042, 0.026, 0.019], r: 0.0088, sp: -0.08 },
  { k: [-0.001, -0.076, 0.0275], d: 0.12, L: [0.033, 0.019, 0.017], r: 0.0077, sp: -0.2 },
];
const HT = { c: [-0.006, -0.012, -0.024], dirs: [[-0.3, -0.75, -0.55], [-0.3, -0.85, -0.35], [-0.25, -0.9, -0.2]], L: [0.042, 0.031, 0.026], r: [0.0165, 0.0125, 0.0118, 0.0106, 0.0094], n: [0.5, 0.05, -0.86] };
const PALM_C = -0.046, PALM_RY = 0.047, PE1 = 0.6, PE2 = 0.5;
const palmW = (y) => 0.031 + 0.008 * smooth(-0.005, -0.075, y);
function palmBack(y, z) {
  let t = 0.0125;
  for (const f of HF) t += 0.0032 * Math.exp(-(((z - f.k[2]) / 0.0075) ** 2 + ((y - f.k[1] + 0.002) / 0.008) ** 2));
  for (const f of HF) { const k = Math.min(1, Math.max(0, y / f.k[1])), zt = f.k[2] * (0.25 + 0.75 * k); t += 0.0009 * Math.exp(-(((z - zt) / 0.0028) ** 2)) * smooth(0, 0.3, k) * (1 - smooth(0.85, 1, k)); }
  return t;
}
function palmFront(y, z) {
  let t = 0.015;
  t += 0.0045 * Math.exp(-(((z + 0.022) / 0.014) ** 2 + ((y + 0.03) / 0.022) ** 2));   // thenar
  t += 0.0038 * Math.exp(-(((z - 0.026) / 0.011) ** 2 + ((y + 0.045) / 0.028) ** 2));  // hypothenar
  t += 0.0022 * Math.exp(-(((y + 0.078) / 0.007) ** 2));                               // pads under the fingers
  t -= 0.0025 * Math.exp(-((z / 0.014) ** 2 + ((y + 0.052) / 0.02) ** 2));              // the hollow of the palm
  return t;
}
// point on the palm shell (right hand); phi round the outline, th from the rim (0) to the middle of the face (pi/2)
function palmPt(phi, th, back, out) {
  const cp = Math.cos(phi), sp = Math.sin(phi), ff = Math.pow(Math.abs(Math.cos(th)), PE1);
  const Y = Math.sign(cp) * Math.pow(Math.abs(cp), PE2) * ff, Z = Math.sign(sp) * Math.pow(Math.abs(sp), PE2) * ff;
  const y = PALM_C + Y * PALM_RY;
  let z = Z * palmW(y);
  if (Z < 0) z -= 0.009 * Math.exp(-(((y + 0.052) / 0.014) ** 2)) * Z * Z;            // web toward the thumb
  const x = (back ? 1 : -1) * Math.pow(Math.abs(Math.sin(th)), PE1) * (back ? palmBack(y, z) : palmFront(y, z));
  return out.set(x, y, z);
}
// inside test for the palm (right hand coordinates), used by the checks: < 1 inside
export function palmInside(x, y, z) {
  const Y = (y - PALM_C) / PALM_RY, Z = z / palmW(y), X = x / (x > 0 ? palmBack(y, z) : palmFront(y, z));
  return Math.pow(Math.pow(Math.abs(Y), 2 / PE2) + Math.pow(Math.abs(Z), 2 / PE2), PE2 / PE1) + Math.pow(Math.abs(X), 2 / PE1);
}
const palmUV = (y, z, back) => [0.5 + 0.5 * Math.min(1, Math.max(0, (z + 0.05) / 0.1)), (back ? 0.5 : 0) + 0.5 * Math.min(1, Math.max(0, (y + 0.105) / 0.115))];
const palmPx = (y, z, back) => { const [u, v] = palmUV(y, z, back); return [u * 1024, (1 - v) * 1024]; };
// procedural skin atlas: left half = finger/thumb detail, bottom right = palm (creases), top right = back of the hand (veins, tendons)
function drawHandAtlas(g, bump) {
  seed(141); const W = 1024;
  g.fillStyle = bump ? '#808080' : '#f3ebe7'; g.fillRect(0, 0, W, W);
  const dot = (x, y, r, dark) => { g.fillStyle = bump ? (dark ? 'rgba(0,0,0,.22)' : 'rgba(255,255,255,.18)') : (dark ? 'rgba(110,60,50,.07)' : 'rgba(255,255,255,.08)'); g.fillRect(x, y, r, r); };
  for (let i = 0; i < 26000; i++) dot(rr(0, W), rr(0, W), rr(1, 2.2), rand() < 0.55);
  if (!bump) for (let i = 0; i < 140; i++) { const x = rr(0, W), y = rr(0, W), r = rr(10, 50), gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rand() < 0.5 ? 'rgba(210,100,90,.06)' : 'rgba(255,250,245,.08)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  // fingers: fine wrinkles running round the finger
  g.lineCap = 'round';
  for (let i = 0; i < 1600; i++) { const x = rr(0, 512), y = rr(0, W), l = rr(6, 22); g.strokeStyle = bump ? 'rgba(0,0,0,.16)' : 'rgba(120,70,60,.07)'; g.lineWidth = rr(0.6, 1.4); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y + rr(-2, 2), x + l, y + rr(-1.5, 1.5)); g.stroke(); }
  const path = (pts, back, width, col) => { g.strokeStyle = col; g.lineWidth = width; g.beginPath(); pts.forEach(([y, z], i) => { const [px, py] = palmPx(y, z, back); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke(); };
  // palm: fingerprint-like ridges, the three main creases, the bracelet lines at the wrist, small secondary creases
  for (let i = 0; i < 2400; i++) { const [px, py] = palmPx(rr(-0.1, 0), rr(-0.045, 0.045), false); g.strokeStyle = bump ? 'rgba(0,0,0,.1)' : 'rgba(120,70,60,.04)'; g.lineWidth = 0.8; g.beginPath(); g.arc(px, py, rr(4, 9), rr(0, 6), rr(0, 6) + 0.9); g.stroke(); }
  const crease = bump ? 'rgba(0,0,0,.75)' : 'rgba(120,58,52,.42)', crease2 = bump ? 'rgba(0,0,0,.35)' : 'rgba(120,58,52,.18)';
  const heart = [[-0.066, 0.038], [-0.069, 0.028], [-0.071, 0.016], [-0.073, 0.004], [-0.073, -0.006], [-0.075, -0.014], [-0.079, -0.02]];
  const head = [[-0.058, -0.036], [-0.057, -0.026], [-0.055, -0.014], [-0.053, -0.002], [-0.05, 0.012], [-0.047, 0.024], [-0.044, 0.032]];
  const life = [[-0.061, -0.036], [-0.054, -0.03], [-0.045, -0.024], [-0.035, -0.019], [-0.025, -0.016], [-0.014, -0.015], [-0.005, -0.014]];
  for (const p of [heart, head, life]) { path(p, false, 7, crease2); path(p, false, 3.2, crease); }
  for (const y of [-0.004, -0.009]) path([[y, -0.032], [y - 0.001, -0.01], [y, 0.01], [y + 0.001, 0.03]], false, 2, crease2);
  for (let i = 0; i < 60; i++) { const y = rr(-0.08, -0.01), z = rr(-0.03, 0.035); path([[y, z], [y + rr(-0.004, 0.004), z + rr(0.004, 0.012)]], false, 1, crease2); }
  // back of the hand: veins from the wrist toward the gaps between the knuckles, tendon ridges, wrinkles over each knuckle
  for (const f of HF) {
    path([[-0.006, f.k[2] * 0.25], [f.k[1] + 0.008, f.k[2]]], true, 6, bump ? 'rgba(255,255,255,.14)' : 'rgba(255,250,245,.07)');
    { const [px, py] = palmPx(f.k[1] + 0.001, f.k[2], true); for (let i = 0; i < 4; i++) { g.strokeStyle = bump ? 'rgba(0,0,0,.16)' : 'rgba(120,64,56,.05)'; g.lineWidth = rr(0.8, 1.3); g.beginPath(); g.ellipse(px + rr(-3, 3), py + 4 + i * rr(4, 6), rr(12, 20), rr(2, 4), 0, Math.PI + 0.5, TAU - 0.5); g.stroke(); } }
  }
  // fingers (left half: u 0..0.5 round the finger, back of the finger at x 0 and 512, pad at x 256; v base -> tip, so
  // canvas y = (1 - v) * 1024). Joints sit at about v 0.13 (knuckle), 0.55 (middle) and 0.80 (last) on every finger.
  const fy = (vv) => (1 - vv) * W, wrinkle = bump ? 'rgba(0,0,0,.42)' : 'rgba(112,62,54,.16)', crease3 = bump ? 'rgba(0,0,0,.8)' : 'rgba(118,58,50,.38)';
  const hline = (cx, y, half, bow, width, col) => { g.strokeStyle = col; g.lineWidth = width; g.beginPath(); g.moveTo(cx - half, y + rr(-1.5, 1.5)); g.quadraticCurveTo(cx, y + bow, cx + half, y + rr(-1.5, 1.5)); g.stroke(); };
  for (const cx of [0, 512]) {
    // the knuckle wrinkles on the back: a loose bunch of curved lines over the middle joint, a smaller one over the last
    for (let i = 0; i < 9; i++) hline(cx, fy(0.55) + (i - 4) * rr(4.5, 6.5), rr(34, 70) * (1 - Math.abs(i - 4) * 0.08), rr(-7, -2), rr(0.9, 1.8), wrinkle);
    for (let i = 0; i < 5; i++) hline(cx, fy(0.8) + (i - 2) * rr(3.5, 5), rr(22, 44), rr(-5, -1), rr(0.8, 1.4), wrinkle);
    // fine hairline wrinkles on the backs of the fingers between joints
    for (let i = 0; i < 70; i++) hline(cx, rr(fy(0.95), fy(0.15)), rr(8, 24), rr(-2, 2), 0.7, bump ? 'rgba(0,0,0,.2)' : 'rgba(120,70,60,.06)');
  }
  // the flexion creases on the pad side: doubled at the middle joint, single at the last, the palm-finger crease at the base
  for (const [vv, dbl] of [[0.55, true], [0.8, false], [0.09, true]]) {
    for (const off of dbl ? [-4.5, 4.5] : [0]) { hline(256, fy(vv) + off, 92, rr(-2, 2), 6, crease2); hline(256, fy(vv) + off, 84, rr(-2, 2), 2.4, crease3); }
  }
  // fingerprint whorls on the pads of the fingertips
  for (let i = 0; i < 16; i++) { g.strokeStyle = bump ? 'rgba(0,0,0,.22)' : 'rgba(120,70,60,.05)'; g.lineWidth = 1.1; g.beginPath(); g.ellipse(256, fy(0.9), 6 + i * 4.6, 4 + i * 3.4, 0, 0, TAU); g.stroke(); }
  // back of the hand: the dorsal venous network. Veins rise from the gaps between the knuckles, meet in a loose arch across
  // the middle of the hand and leave the wrist as two trunks (thumb side and little-finger side). Drawn wide and blurred, a
  // muted blue-green under the skin, and raised in the bump map, never as hard lines.
  {
    const curve = (pts, n = 24) => { const out = []; for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]; for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t; out.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3))); } } out.push(pts[pts.length - 1]); return out; };
    const veins = [ // [y, z] from the knuckle gaps toward the wrist; width in px
      [[[-0.074, -0.019], [-0.062, -0.017], [-0.048, -0.019], [-0.036, -0.021], [-0.022, -0.023], [-0.008, -0.022], [0.002, -0.021]], 1],
      [[[-0.075, 0.0005], [-0.063, 0.001], [-0.05, -0.002], [-0.04, -0.008], [-0.034, -0.016], [-0.03, -0.02]], 0.85],
      [[[-0.073, 0.019], [-0.062, 0.018], [-0.05, 0.016], [-0.04, 0.017], [-0.028, 0.02], [-0.014, 0.022], [0.002, 0.021]], 0.95],
      [[[-0.05, -0.002], [-0.044, 0.006], [-0.039, 0.013], [-0.036, 0.017]], 0.7],
      [[[-0.064, 0.027], [-0.052, 0.024], [-0.042, 0.019]], 0.55],
      [[[-0.026, -0.022], [-0.018, -0.012], [-0.01, -0.006], [-0.002, -0.004]], 0.5],
    ];
    g.lineJoin = 'round';
    for (const [pts, wd] of veins) {
      const c = curve(pts), draw = (width, col, blur) => { g.filter = `blur(${blur}px)`; path(c, true, width * wd, col); g.filter = 'none'; };
      if (bump) { draw(20, 'rgba(255,255,255,.12)', 7); draw(11, 'rgba(255,255,255,.1)', 5); }
      else { draw(16, 'rgba(120,128,150,.05)', 6); draw(9, 'rgba(100,114,140,.06)', 4); }
    }
  }
  // pores: fine, denser on the backs of the hand and fingers, softer on the palm
  for (let i = 0; i < 30000; i++) { const x = rr(0, W), y = rr(0, W); g.fillStyle = bump ? 'rgba(0,0,0,.18)' : 'rgba(120,70,60,.035)'; g.fillRect(x, y, 1, 1); }
  // the colour detail is drawn faint; stretch it away from the base tone so it survives the dim bedroom light
  if (!bump) {
    const im = g.getImageData(0, 0, W, W), d = im.data, b = [243, 235, 231], k = 2.6;
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, b[c] + (d[i + c] - b[c]) * k));
    g.putImageData(im, 0, 0);
  }
}
const handAtlas = () => ctex('handAtlas', 1024, 1024, (g) => drawHandAtlas(g, false));
const handBumpTex = () => { let t = texCache.get('handBumpT'); if (!t) { t = wrapTex(paint('handBump', 1024, 1024, (g) => drawHandAtlas(g, true)), null, false); t.anisotropy = 16; t.userData.keep = true; texCache.set('handBumpT', t); } return t; };
const handSkinM = () => Mt('handSkin2', () => { const m = std(0xffffff, { vertexColors: true, roughness: 0.58, map: handAtlas(), bumpMap: handBumpTex(), bumpScale: 1.1 }); m.map.anisotropy = 16; return m; });
const handNailM = () => Mt('handNail2', () => std(0xffffff, { vertexColors: true, roughness: 0.38, metalness: 0 }));

const TONE = { base: 0xc9a48a, palm: 0xd9b9a3, knuckle: 0xbf8a78, tip: 0xcf927f, crease: 0xa47a6a, nail: 0xd3a08f, nailTip: 0xe6d3c2, cuticle: 0xb08470, lunula: 0xe0bfb0, nailBed: 0xc99282 };
const _tc = {}; for (const k in TONE) _tc[k] = new THREE.Color(TONE[k]);
// nail colour by row j of NV (base -> free edge) and across w (-1..1)
const nailCol = (c, j, NV, w) => (j === 0 ? c.copy(_tc.cuticle) : j === 1 ? c.copy(_tc.lunula).lerp(_tc.nail, 0.45 + 0.55 * w * w) : j === NV ? c.copy(_tc.nailTip).lerp(_tc.nail, 0.3 * w * w) : c.copy(_tc.nail).lerp(_tc.nailBed, 0.2 + 0.4 * w * w)).lerp(_tc.base, j === NV ? 0 : 0.55 * w ** 4);   // edges fade into the skin
// row positions along the nail (0 cuticle .. 1 free edge): the free edge is only a thin last band
const nailRow = (j, NV) => (NV === 5 ? [0, 0.12, 0.3, 0.58, 0.86, 1] : [0, 0.22, 0.86, 1])[j];
// build one hand (s = +1 right, -1 left); detail 1 = hero, 0 = lighter
function skinHandData(s, detail) {
  return G(`skinHand${s}${detail}`, () => {
    const SIDES = detail ? 10 : 8;
    const pos = [], nor = [], uv = [], col = [], si = [], sw = [], idxSkin = [], idxNail = [];
    const v = new THREE.Vector3(), c = new THREE.Color();
    const bones = [{ parent: -1, p: [0, 0, 0] }];
    const addV = (p, u, vv, color, b0, b1, w) => { pos.push(p.x * s, p.y, p.z); uv.push(u, vv); col.push(color.r, color.g, color.b); si.push(b0, b1, 0, 0); sw.push(1 - w, w, 0, 0); return pos.length / 3 - 1; };
    const quad = (list, a, b, cc, d) => { if (s > 0) list.push(a, b, d, b, cc, d); else list.push(a, d, b, b, d, cc); };
    // a tube swept through joint points J[0..n]; seq = bone index for each segment; rad(s,a) gives [rx, rz]
    function sweep(J, seq, dorsal, rad, ringsAt, colorAt, capLen, list, vScale) {
      const S = [0]; for (let i = 1; i < J.length; i++) S.push(S[i - 1] + J[i].distanceTo(J[i - 1]));
      const total = S[S.length - 1];
      const segAt = (x) => { let i = 0; while (i < J.length - 2 && x > S[i + 1]) i++; return i; };
      const dir = new THREE.Vector3(), d2 = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3(), P = new THREE.Vector3();
      const ring = (x, scale) => {
        const i = segAt(x), t = (x - S[i]) / (S[i + 1] - S[i] || 1);
        P.copy(J[i]).lerp(J[i + 1], t);
        dir.subVectors(J[i + 1], J[i]).normalize();
        // blend directions near joints so rings do not cross at a bend
        if (i + 2 < J.length && x > S[i + 1] - 0.004) { d2.subVectors(J[i + 2], J[i + 1]).normalize(); dir.lerp(d2, smooth(S[i + 1] - 0.004, S[i + 1] + 0.004, x) * 0.5).normalize(); }
        if (i > 0 && x < S[i] + 0.004) { d2.subVectors(J[i], J[i - 1]).normalize(); dir.lerp(d2, (1 - smooth(S[i] - 0.004, S[i] + 0.004, x)) * 0.5).normalize(); }
        n.copy(dorsal).addScaledVector(dir, -dorsal.dot(dir)).normalize(); b.crossVectors(dir, n);
        // bone weights: blend across the nearest joint
        let b0 = seq[Math.min(seq.length - 1, i)], b1 = b0, w = 0;
        for (let j = 1; j < J.length - 1; j++) { const bw = 0.55 * rad(S[j], 0)[0]; if (Math.abs(x - S[j]) < bw) { b0 = seq[j - 1]; b1 = seq[j]; w = smooth(S[j] - bw, S[j] + bw, x); } }
        const first = pos.length / 3;
        for (let k = 0; k <= SIDES; k++) {
          const a = k / SIDES * TAU, [rx, rz] = rad(x, a);
          v.copy(P).addScaledVector(n, Math.cos(a) * rx * scale).addScaledVector(b, Math.sin(a) * rz * scale);
          addV(v, k / SIDES * 0.5, x / total * vScale, colorAt(x, a, i), b0, b1, w);
        }
        return first;
      };
      const xs = ringsAt(S); let prev = null;
      const capRings = [[0, 1], [0.45, 0.9], [0.72, 0.72], [0.88, 0.5], [0.97, 0.25], [1, 0]];
      for (const x of xs) { const r = ring(Math.min(x, total - capLen), 1); if (prev !== null) for (let k = 0; k < SIDES; k++) quad(list, prev + k, prev + k + 1, r + k + 1, r + k); prev = r; }
      for (let q = 1; q < capRings.length; q++) { const r = ring(total - capLen + capRings[q][0] * capLen, capRings[q][1]); for (let k = 0; k < SIDES; k++) quad(list, prev + k, prev + k + 1, r + k + 1, r + k); prev = r; }
      return { S, total };
    }
    const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    // ---- fingers ----
    const fingerInfo = [];
    HF.forEach((f, fi) => {
      const K = V3(f.k), dirv = new THREE.Vector3(0, -1, f.d).normalize();
      const J = [K.clone().addScaledVector(dirv, -0.013), K.clone()];
      let p = K.clone(); for (const L of f.L) { p = p.clone().addScaledVector(dirv, L); J.push(p); }
      const b1 = bones.length; bones.push({ parent: 0, p: f.k.slice() }, { parent: b1, p: [0, -f.L[0] * dirv.y * -1, 0] }, { parent: b1 + 1, p: [0, 0, 0] });
      bones[b1 + 1].p = J[2].clone().sub(J[1]).toArray(); bones[b1 + 2].p = J[3].clone().sub(J[2]).toArray();
      const S1 = 0.013, S2 = S1 + f.L[0], S3 = S2 + f.L[1], S4 = S3 + f.L[2];
      const rad = (x, a) => {
        let r = f.r * (1 - 0.24 * smooth(S1, S4, x));
        for (const sj of [S1, S2, S3]) r *= 1 + 0.045 * Math.exp(-(((x - sj) / 0.004) ** 2));
        const palmSide = Math.max(0, -Math.cos(a));
        for (const sj of [S2, S3]) r *= 1 - 0.07 * palmSide * palmSide * Math.exp(-(((x - sj) / 0.0018) ** 2));   // joint creases
        r *= 1 + 0.06 * palmSide * Math.exp(-(((x - (S3 + 0.55 * f.L[2])) / 0.006) ** 2));                             // fingertip pad
        return [r * 0.9, r * 1.04];
      };
      const colorAt = (x, a) => {
        const dors = Math.max(0, Math.cos(a)), palmS = Math.max(0, -Math.cos(a));
        c.copy(_tc.base).lerp(_tc.palm, palmS * 0.7);
        for (const sj of [S1, S2, S3]) c.lerp(_tc.knuckle, dors * 0.55 * Math.exp(-(((x - sj) / 0.006) ** 2)));
        for (const sj of [S2, S3]) c.lerp(_tc.crease, palmS * 0.6 * Math.exp(-(((x - sj) / 0.0016) ** 2)));
        c.lerp(_tc.tip, 0.55 * smooth(S3 + f.L[2] * 0.4, S4, x));
        return c;
      };
      const rings = () => detail
        ? [0, 0.006, S1 - 0.004, S1, S1 + 0.004, S1 + f.L[0] * 0.3, S1 + f.L[0] * 0.62, S2 - 0.0035, S2 - 0.0012, S2, S2 + 0.0012, S2 + 0.0035, S2 + f.L[1] * 0.5, S3 - 0.003, S3 - 0.001, S3, S3 + 0.001, S3 + 0.003, S3 + f.L[2] * 0.35]
        : [0, S1 - 0.004, S1, S1 + 0.004, S1 + f.L[0] * 0.5, S2 - 0.003, S2, S2 + 0.003, S2 + f.L[1] * 0.5, S3 - 0.003, S3, S3 + 0.003];
      const dorsal = new THREE.Vector3(1, 0, 0);
      sweep(J, [0, b1, b1 + 1, b1 + 2], dorsal, rad, rings, colorAt, f.r * 0.62, idxSkin, 1);
      fingerInfo.push({ bones: [b1, b1 + 1, b1 + 2], dir: dirv, J, rad, S: [S1, S2, S3, S4] });
      // the nail: a slightly domed plate on the back of the last bone, its edges sunk into the skin
      const NU = detail ? 6 : 4, NV = detail ? 5 : 3, base = pos.length / 3, P = new THREE.Vector3();
      for (let j = 0; j <= NV; j++) for (let k = 0; k <= NU; k++) {
        const x = S3 + f.L[2] * (0.32 + 0.6 * nailRow(j, NV)), w = k / NU * 2 - 1, a = w * 0.95, [rx, rz] = rad(x, a);
        P.copy(J[3]).addScaledVector(dirv, x - S3);
        const lift = 0.0007 * (1 - w * w) - 0.00035 * w * w - (j === 0 ? 0.0005 : 0);   // the base slides under the cuticle
        v.copy(P).addScaledVector(new THREE.Vector3(1, 0, 0), Math.cos(a) * (rx + lift)).addScaledVector(new THREE.Vector3().crossVectors(dirv, new THREE.Vector3(1, 0, 0)), Math.sin(a) * (rz + lift));
        addV(v, 0, 0, nailCol(c, j, NV, w), b1 + 2, b1 + 2, 0);
      }
      for (let j = 0; j < NV; j++) for (let k = 0; k < NU; k++) { const a = base + j * (NU + 1) + k; quad(idxNail, a, a + 1, a + NU + 2, a + NU + 1); }
    });
    // ---- thumb ----
    const C = V3(HT.c), dirs = HT.dirs.map((d) => V3(d).normalize());
    const TJ = [C.clone().addScaledVector(dirs[0], -0.014), C.clone()];
    let tp = C.clone(); HT.L.forEach((L, i) => { tp = tp.clone().addScaledVector(dirs[i], L); TJ.push(tp); });
    const t1 = bones.length; bones.push({ parent: 0, p: HT.c.slice() }, { parent: t1, p: TJ[2].clone().sub(TJ[1]).toArray() }, { parent: t1 + 1, p: TJ[3].clone().sub(TJ[2]).toArray() });
    const TS = [0.014, 0.014 + HT.L[0], 0.014 + HT.L[0] + HT.L[1], 0.014 + HT.L[0] + HT.L[1] + HT.L[2]];
    const tn = V3(HT.n).normalize();
    const trad = (x, a) => {
      const k = smooth(TS[0], TS[1], x), palmSide = Math.max(0, -Math.cos(a));
      let r = x < TS[1] ? HT.r[0] + (HT.r[1] - HT.r[0]) * k : x < TS[2] ? HT.r[2] + (HT.r[3] - HT.r[2]) * smooth(TS[1], TS[2], x) : HT.r[3] + (HT.r[4] - HT.r[3]) * smooth(TS[2], TS[3], x);
      r *= 1 + 0.25 * palmSide * (1 - smooth(TS[0], TS[1] - 0.008, x));   // the thenar mound under the metacarpal
      r *= 1 + 0.04 * Math.exp(-(((x - TS[1]) / 0.004) ** 2)) + 0.04 * Math.exp(-(((x - TS[2]) / 0.004) ** 2));
      r *= 1 - 0.07 * palmSide * palmSide * Math.exp(-(((x - TS[2]) / 0.002) ** 2));
      r *= 1 + 0.06 * palmSide * Math.exp(-(((x - (TS[2] + 0.55 * HT.L[2])) / 0.007) ** 2));
      return [r * 0.92, r * 1.06];
    };
    const tcol = (x, a) => {
      const dors = Math.max(0, Math.cos(a)), palmS = Math.max(0, -Math.cos(a));
      c.copy(_tc.base).lerp(_tc.palm, palmS * 0.6);
      for (const sj of [TS[1], TS[2]]) c.lerp(_tc.knuckle, dors * 0.5 * Math.exp(-(((x - sj) / 0.006) ** 2)));
      c.lerp(_tc.crease, palmS * 0.6 * Math.exp(-(((x - TS[2]) / 0.0018) ** 2)));
      c.lerp(_tc.tip, 0.5 * smooth(TS[2] + HT.L[2] * 0.4, TS[3], x));
      return c;
    };
    const tRings = () => detail
      ? [0, 0.006, TS[0] - 0.004, TS[0], TS[0] + 0.005, TS[0] + HT.L[0] * 0.3, TS[0] + HT.L[0] * 0.55, TS[0] + HT.L[0] * 0.8, TS[1] - 0.004, TS[1], TS[1] + 0.004, TS[1] + HT.L[1] * 0.5, TS[2] - 0.0035, TS[2] - 0.001, TS[2], TS[2] + 0.001, TS[2] + 0.0035, TS[2] + HT.L[2] * 0.35]
      : [0, TS[0] - 0.004, TS[0], TS[0] + 0.005, TS[0] + HT.L[0] * 0.5, TS[1] - 0.004, TS[1], TS[1] + 0.004, TS[1] + HT.L[1] * 0.5, TS[2] - 0.003, TS[2], TS[2] + 0.003];
    sweep(TJ, [0, t1, t1 + 1, t1 + 2], tn, trad, tRings, tcol, HT.r[4] * 0.66, idxSkin, 1);
    {
      const NU = detail ? 6 : 4, NV = detail ? 5 : 3, base = pos.length / 3, d3 = dirs[2], n3 = tn.clone().addScaledVector(d3, -tn.dot(d3)).normalize(), b3 = new THREE.Vector3().crossVectors(d3, n3);
      for (let j = 0; j <= NV; j++) for (let k = 0; k <= NU; k++) {
        const x = TS[2] + HT.L[2] * (0.3 + 0.6 * nailRow(j, NV)), w = k / NU * 2 - 1, a = w * 0.95, [rx, rz] = trad(x, a), lift = 0.0008 * (1 - w * w) - 0.00035 * w * w - (j === 0 ? 0.0005 : 0);
        v.copy(TJ[3]).addScaledVector(d3, x - TS[2]).addScaledVector(n3, Math.cos(a) * (rx + lift)).addScaledVector(b3, Math.sin(a) * (rz + lift));
        addV(v, 0, 0, nailCol(c, j, NV, w), t1 + 2, t1 + 2, 0);
      }
      for (let j = 0; j < NV; j++) for (let k = 0; k < NU; k++) { const a = base + j * (NU + 1) + k; quad(idxNail, a, a + 1, a + NU + 2, a + NU + 1); }
    }
    // ---- palm shell (two sheets) with the web following the thumb and the knuckles following the fingers ----
    const segDist = (p, a, b) => { const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(a.clone().addScaledVector(ab, t)); };
    const PU = detail ? 28 : 18, PV = detail ? 9 : 6;
    for (const back of [true, false]) {
      const base = pos.length / 3;
      for (let j = 0; j <= PV; j++) for (let k = 0; k <= PU; k++) {
        palmPt(k / PU * TAU, j / PV * PI / 2, back, v);
        // bone weights: the thumb's metacarpal pulls the web and thenar; each proximal bone pulls its knuckle
        let bb = 0, w = 0;
        const wt = Math.min(0.85, 1.1 * Math.exp(-((segDist(v, TJ[1], TJ[2]) / 0.011) ** 2))) * (v.z < 0 ? 1 : 0);
        if (wt > w) { bb = t1; w = wt; }
        fingerInfo.forEach((fi) => { const wk = 0.4 * Math.exp(-((v.distanceTo(fi.J[1]) / 0.008) ** 2)); if (wk > w) { bb = fi.bones[0]; w = wk; } });
        const [u0, v0] = palmUV(v.y, v.z, back);
        c.copy(_tc.base).lerp(back ? _tc.base : _tc.palm, back ? 0 : 0.85);
        if (back) fingerInfo.forEach((fi) => c.lerp(_tc.knuckle, 0.5 * Math.exp(-((v.distanceTo(fi.J[1]) / 0.009) ** 2))));
        addV(v, u0, v0, c, 0, bb, w);
      }
      for (let j = 0; j < PV; j++) for (let k = 0; k < PU; k++) { const a = base + j * (PU + 1) + k; if (back) quad(idxSkin, a, a + 1, a + PU + 2, a + PU + 1); else quad(idxSkin, a, a + PU + 1, a + PU + 2, a + 1); }
    }
    // ---- wrist, with the ulnar bump, running up into the forearm ----
    // the upper rings ride on a wrist bone (wb) that skinHand keeps lined up with the forearm, so a bent wrist bends the skin
    // instead of leaving a rigid stub of wrist sticking out of the arm
    const wb = bones.length; bones.push({ parent: 0, p: [0, 0, 0] });
    const WJ = [new THREE.Vector3(0, 0.036, 0), new THREE.Vector3(0, 0.012, 0), new THREE.Vector3(0, -0.012, 0)];
    sweep(WJ, [wb, 0, 0], new THREE.Vector3(1, 0, 0), (x, a) => { const bump = 0.0028 * Math.exp(-(((a - 1.0) / 0.45) ** 2)) * Math.exp(-(((x - 0.028) / 0.008) ** 2)); return [0.0172 + bump, 0.0262 + bump]; },
      () => (detail ? [0, 0.01, 0.02, 0.028, 0.036, 0.042] : [0, 0.02, 0.034, 0.042]), () => c.copy(_tc.base), 0.0001, idxSkin, 0.15);
    // ---- assemble ----
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setIndex([...idxSkin, ...idxNail]); geo.addGroup(0, idxSkin.length, 0); geo.addGroup(idxSkin.length, idxNail.length, 1);
    smoothSeams(geo);
    geo.computeBoundingSphere();
    // the wrist tube's last ring is degenerate (cap 0) inside the palm; that is fine. Axes for posing (in this hand's frame):
    const dorsal = new THREE.Vector3(s, 0, 0);
    const flex = fingerInfo.map((fi) => new THREE.Vector3().crossVectors(dorsal, new THREE.Vector3(fi.dir.x * s, fi.dir.y, fi.dir.z)).normalize());
    const tdir = dirs.map((d) => new THREE.Vector3(d.x * s, d.y, d.z)), tnor = new THREE.Vector3(tn.x * s, tn.y, tn.z);
    const tflex = tdir.map((d) => new THREE.Vector3().crossVectors(tnor.clone().addScaledVector(d, -tnor.dot(d)).normalize(), d).normalize());
    const mirrorP = (p) => [p[0] * s, p[1], p[2]];
    return {
      geo, bones: bones.map((b) => ({ parent: b.parent, p: mirrorP(b.p) })), flex, tflex, opp: new THREE.Vector3(0, s, 0), spread: new THREE.Vector3(1, 0, 0),
      fingerBones: fingerInfo.map((fi) => fi.bones), thumbBones: [t1, t1 + 1, t1 + 2], wristBone: wb, spreadDir: HF.map((f) => f.sp),
    };
  });
}
// a posable skinned hand: { mesh, bones, set(curls[4], spread, thumbOpp, thumbFlex), s }
const _hq = new THREE.Quaternion(), _hq2 = new THREE.Quaternion();
function skinHand(s, detail) {
  const D = skinHandData(s, detail);
  const bones = D.bones.map((b) => { const o = new THREE.Bone(); o.position.fromArray(b.p); return o; });
  D.bones.forEach((b, i) => { if (b.parent >= 0) bones[b.parent].add(bones[i]); });
  const mesh = new THREE.SkinnedMesh(D.geo, [handSkinM(), handNailM()]);
  mesh.add(bones[0]); mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = false;
  const h = { mesh, bones, D, s, curls: [0, 0, 0, 0], spread: 0, opp: 0, tflex: 0 };
  // the wrist bone undoes the wrist pivot's bend but keeps its roll about the forearm (set as the parent group updates its
  // matrix, before the skeleton is read), so the tube never twists against itself
  const wbone = bones[D.wristBone], _tw = new THREE.Quaternion();
  mesh.addEventListener('added', () => {
    const hp = mesh.parent; if (!hp || hp.userData.wristHook) return; hp.userData.wristHook = true;
    hp.updateMatrix = function () {
      const q = this.quaternion; _tw.set(0, q.y, 0, q.w).normalize();
      wbone.quaternion.copy(q).invert().multiply(_tw); THREE.Object3D.prototype.updateMatrix.call(this);
    };
  });
  // curls: 0 straight .. 1 closed (MCP : PIP : DIP about 1.45 : 1.7 : 1.05 rad); negative bends back a little
  h.set = (curls, spread = 0, opp = 0, tflex = 0) => {
    for (let f = 0; f < 4; f++) {
      const c = typeof curls === 'number' ? curls : curls[f], [b1, b2, b3] = D.fingerBones[f], ax = D.flex[f];
      bones[b1].quaternion.setFromAxisAngle(ax, 1.45 * c).premultiply(_hq.setFromAxisAngle(D.spread, D.spreadDir[f] * spread));
      bones[b2].quaternion.setFromAxisAngle(ax, 1.7 * Math.max(-0.05, c));
      bones[b3].quaternion.setFromAxisAngle(ax, 1.05 * Math.max(-0.1, c));
      h.curls[f] = c;
    }
    const [t1, t2, t3] = D.thumbBones;
    bones[t1].quaternion.setFromAxisAngle(D.opp, 0.85 * opp).multiply(_hq2.setFromAxisAngle(D.tflex[0], 0.25 * tflex));
    bones[t2].quaternion.setFromAxisAngle(D.tflex[1], 0.55 * tflex + 0.15 * opp);
    bones[t3].quaternion.setFromAxisAngle(D.tflex[2], 0.85 * tflex);
    h.spread = spread; h.opp = opp; h.tflex = tflex;
  };
  h.set(0);
  return h;
}

// ---- people ----
const SHIRT = [[0.86, 0.15], [0.95, 0.152], [1.05, 0.142], [1.18, 0.158], [1.3, 0.172], [1.39, 0.176], [1.44, 0.13], [1.47, 0.06], [1.48, 0.03]];
const H_S = [0.205, 1.385, 0], H_E = [0.235, 1.12, -0.01], H_W = [0.245, 0.885, 0.02];
function humanParts() {
  return G('human2', () => {
    const v = new THREE.Vector3();
    const head = sculpt(24, 18, humanHeadPt);
    const skinHead = [[head], ball(-HR * 0.93, -0.005, -0.005, 0.011, 0.026, 0.017, 6, 6), ball(HR * 0.93, -0.005, -0.005, 0.011, 0.026, 0.017, 6, 6)];
    onHumanHead(0, -0.12, v); skinHead.push(ball(v.x, v.y, v.z + 0.004, 0.012, 0.022, 0.016, 8, 6));
    const hair = grid(24, 10, (u, w, o) => {
      const a = u * TAU, front = 0.5 + 0.5 * Math.cos(a), ph = w * PI * (0.66 - 0.36 * front);
      humanHeadPt(Math.sin(ph) * Math.sin(a), Math.cos(ph), Math.sin(ph) * Math.cos(a), o);
      return o.multiplyScalar(1.07 + 0.025 * Math.sin(a * 7 + w * 4) * w);
    }, true);
    const brows = [], eyeW = [], iris = [], closed = [];
    for (const s of [-1, 1]) {
      onHumanHead(s * 0.36, 0.3, v); brows.push(box(v.x, v.y, v.z, 0.032, 0.006, 0.008, 0, 0, -s * 0.12));
      onHumanHead(s * 0.36, 0.08, v); eyeW.push(ball(v.x, v.y, v.z - 0.004, 0.016, 0.0105, 0.008, 8, 6)); iris.push(ball(v.x, v.y, v.z + 0.002, 0.0075, 0.0075, 0.004, 8, 6));
      closed.push(ball(v.x, v.y - 0.002, v.z, 0.015, 0.0018, 0.004, 8, 4));
    }
    onHumanHead(0, -0.5, v); const mouth = ball(v.x, v.y, v.z - 0.002, 0.022, 0.0042, 0.006, 10, 6);
    // shirt / pyjama top: lathe with shoulders, a little chest and shoulder-blade shape
    const shirtL = new THREE.LatheGeometry(Array.from({ length: 15 }, (_, i) => { const y = 0.86 + i / 14 * 0.62; return new THREE.Vector2(Math.max(0, profileAt(SHIRT, y)), y); }), 18, PI);
    const sp = shirtL.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const y = sp.getY(i), x = sp.getX(i), z = sp.getZ(i), r = Math.hypot(x, z) || 1e-6, front = Math.max(0, z / r), back = Math.max(0, -z / r);
      const chest = 1 + 0.08 * Math.sin(PI * smooth(1.18, 1.38, y)) * front * front + 0.05 * Math.sin(PI * smooth(1.2, 1.4, y)) * back * back * Math.abs(x / r);
      sp.setXYZ(i, x * (1 + 0.18 * smooth(1.25, 1.4, y)), y, z * 0.62 * chest);
    }
    smoothSeams(shirtL);
    const buttons = [];
    for (let i = 0; i < 4; i++) { const y = 1.0 + i * 0.11; buttons.push(ball(0, y, profileAt(SHIRT, y) * 0.62 + 0.003, 0.007, 0.007, 0.004, 6, 4)); }
    const collar = [G('collar', () => new THREE.TorusGeometry(0.068, 0.014, 6, 16)), M(0, 1.455, 0.005, PI / 2 - 0.15, 0, 0, 1, 0.8, 1)];
    const rel = (a, b, s) => [s * a[0] - s * b[0], a[1] - b[1], a[2] - b[2]];
    const HP = handParts();
    const side = (s) => ({
      upper: merge([ball(0, 0, 0, 0.052), seg([s * 0.005, 0.005, 0], rel(H_E, H_S, s), 0.048, 0.04, 10), ball(...rel(H_E, H_S, s), 0.04)]),
      fore: merge([seg([0, 0, 0], rel(H_W, H_E, s), 0.04, 0.034, 10), ball(...rel(H_W, H_E, s), 0.035, 0.014, 0.035, 10, 4)]),
      // the anatomical right hand sits at -x on a body facing +z: the player's right hand turned half round
      hand: merge([[s < 0 ? HP.lite : HP.liteL, M(...rel([H_W[0], 0.875, H_W[2]], H_E, s), 0, PI, 0)]]),
    });
    const pelvis = lathe([[0.12, 0.76], [0.145, 0.8], [0.152, 0.88], [0.15, 0.95]], 16);
    pelvis.scale(1, 1, 0.7);
    // legs: thigh from the hip pivot (±0.085, 0.84), shin and shoe from the knee pivot (0.005 out, 0.37 down)
    const thigh = merge([seg([0, 0, 0], [0.005, -0.37, 0.012], 0.072, 0.056, 10), ball(0.005, -0.37, 0.012, 0.056)]);
    const shin = merge([seg([0, 0, 0], [0, -0.37, -0.022], 0.055, 0.042, 10), ball(0, -0.37, -0.022, 0.044, 0.02, 0.044, 10, 4)]);
    const shoe = merge([ball(0, -0.425, 0.028, 0.05, 0.045, 0.12, 12, 8)]);
    return {
      head: merge(skinHead), hair: merge([[hair], ...brows]), eyeW: merge(eyeW), buttons: merge(buttons), iris: merge(iris), closed: merge(closed), mouth: merge([mouth]),
      shirtTorso: merge([[shirtL], collar]), L: side(-1), R: side(1), pelvis, thighR: thigh, thighL: mirrorX(thigh), shin, shoe,
      neck: merge([seg([0, -0.03, -0.005], [0, 0.08, -0.01], 0.045, 0.042, 10)]),
    };
  });
}
const HAIR = [0x2b1d14, 0x5a3a22, 0x1a1410, 0x8a6a3a];
const skinMat = () => Mt('humanSkin', () => std(0xc9a48a, { roughness: 0.66, map: skinTex() }));
const hairMat = (c) => Mt(`hair${c}`, () => std(c, { roughness: 0.75, map: hairTex() }));
const clothMat = (c) => Mt(`cloth${c}`, () => std(c, { roughness: 0.85, map: fabricTex(), bumpMap: weaveBump(), bumpScale: 0.6 }));
const eyeWhiteMat = () => Mt('eyeWhite', () => std(0xe8e4dc, { roughness: 0.3 }));
const irisMat = () => Mt('iris', () => std(0x1a120c, { roughness: 0.2 }));
const lipMat = () => Mt('lips', () => std(0x8a4a48, { roughness: 0.6 }));

// ---- people (the man on the other table, the children): smooth sculpted heads and bodies ----
// turn every triangle to face away from c (by signed volume), then smooth the normals
function faceOut(geo, c) {
  const p = geo.attributes.position, ix = geo.index.array;
  if (!c) { c = [0, 0, 0]; for (let i = 0; i < p.count; i++) { c[0] += p.getX(i) / p.count; c[1] += p.getY(i) / p.count; c[2] += p.getZ(i) / p.count; } }
  let vol = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t], b = ix[t + 1], d = ix[t + 2], ax = p.getX(a) - c[0], ay = p.getY(a) - c[1], az = p.getZ(a) - c[2], bx = p.getX(b) - c[0], by = p.getY(b) - c[1], bz = p.getZ(b) - c[2], dx = p.getX(d) - c[0], dy = p.getY(d) - c[1], dz = p.getZ(d) - c[2];
    vol += ax * (by * dz - bz * dy) - ay * (bx * dz - bz * dx) + az * (bx * dy - by * dx);
  }
  if (vol < 0) for (let t = 0; t < ix.length; t += 3) { const k = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = k; }
  return smoothSeams(geo);
}
// a closed soft tube along a smooth curve through pts; rad(t, a) -> [radius along side, radius across]; ends rounded over capA / capB of its length
function softTube(pts, rad, nu, nv, capA = 0.1, capB = 0.1, side = [1, 0, 0]) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))), S = new THREE.Vector3(...side), P = new THREE.Vector3(), T = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
  return faceOut(grid(nu, nv, (u, w, o) => {
    const t = 0.5 - 0.5 * Math.cos(PI * w), a = u * TAU;
    curve.getPointAt(t, P); curve.getTangentAt(t, T);
    n1.copy(S).addScaledVector(T, -S.dot(T)).normalize(); n2.crossVectors(T, n1);
    const k = t < capA ? Math.sqrt(Math.max(0, 1 - ((capA - t) / capA) ** 2)) : t > 1 - capB ? Math.sqrt(Math.max(0, 1 - ((t - 1 + capB) / capB) ** 2)) : 1, [r1, r2] = rad(t, a);
    o.copy(P).addScaledVector(n1, Math.cos(a) * r1 * k).addScaledVector(n2, Math.sin(a) * r2 * k);
  }));
}
// proportions: a child has a bigger head on a shorter, narrower body with shorter limbs (all at scale 1)
const personDims = (child) => {
  const K = child ? { child, cw: 0.88, tf: 0.92, lf: 0.96, af: 0.88, rf: 0.8, hf: 0.8, nf: 0.86 } : { child, cw: 1, tf: 1, lf: 1, af: 1, rf: 1, hf: 1, nf: 1 };
  K.hipY = 0.84 * K.lf; K.neckY = K.hipY + 0.61 * K.tf;
  K.sh = [0.205 * K.cw, K.hipY + 0.545 * K.tf, 0]; K.el = [0.03, -0.265 * K.af, -0.01 * K.af]; K.wr = [0.01, -0.245 * K.af, 0.03 * K.af];
  K.F = child
    ? { R: 0.124, chinY: 1.08, crown: 0.06, jawIn: 0.1, eyeY: -0.14, socket: 0.06, brow: 0.012, cheek: 0.06, bridge: 0.015, muzzle: 0.035, chin: 0.02, nose: 0.085, noseL: 0.36, er: 0.0112, openU: 0.5, openL: 0.46, ear: 0.85, lip: 0.8 }
    : { R: 0.105, chinY: 1.2, crown: 0, jawIn: 0.2, eyeY: -0.02, socket: 0.085, brow: 0.05, cheek: 0.035, bridge: 0.045, muzzle: 0.05, chin: 0.05, nose: 0.15, noseL: 0.5, er: 0.0118, openU: 0.42, openL: 0.4, ear: 1, lip: 1 };
  return K;
};
// the head: a deformed sphere with jaw, cheeks, brow, eye sockets and chin; face toward +z, units of F.R
function personHeadPt(nx, ny, nz, o, F) {
  const up = Math.max(0, ny), dn = Math.max(0, -ny), fr = Math.max(0, nz), bk = Math.max(0, -nz);
  let x = nx * 0.9, y = ny * (ny > 0 ? 1.06 : F.chinY), z = nz * 1.04;
  z *= 1 + 0.1 * bk * up + F.crown * bk;                       // the back of the skull
  x *= 1 - (0.12 + F.jawIn * fr) * dn * dn;                     // the jaw narrowing to the chin
  z += 0.1 * dn * dn * fr; z *= 1 - 0.32 * bk * dn * dn;        // jaw forward, skull tucking into the neck behind
  x *= 1 - 0.05 * Math.exp(-(((ny - F.eyeY - 0.32) / 0.16) ** 2)) * fr;   // temples
  const G2 = (cx, cy, sx, sy) => Math.exp(-(((nx - cx) / sx) ** 2) - (((ny - cy) / sy) ** 2)) * fr * fr, e = F.eyeY;
  let dz = F.bridge * G2(0, e, 0.07, 0.12) + F.muzzle * G2(0, e - 0.6, 0.28, 0.2) + F.chin * G2(0, -0.86, 0.16, 0.12);
  for (const s of [-1, 1]) dz += -F.socket * G2(s * 0.33, e, 0.15, 0.1) + F.brow * G2(s * 0.31, e + 0.17, 0.22, 0.06) + F.cheek * G2(s * 0.46, e - 0.24, 0.18, 0.14) - 0.012 * G2(s * 0.19, e - 0.6, 0.05, 0.05);
  return o.set(x * F.R, y * F.R, (z + dz) * F.R);
}
const onPersonFace = (nx, ny, F, o) => personHeadPt(nx, ny, Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)), o, F);
// hairline height (in ny) round the head by azimuth from the front: forehead, temples, sideburn, over the ear, nape
const HAIRLINE = (a, e, front) => { const K = [[0, e + front], [0.6, e + front - 0.05], [1.05, e + 0.26], [1.28, e - 0.1], [1.42, e - 0.1], [1.52, e + 0.17], [1.95, e + 0.1], [2.35, -0.6], [PI, -0.66]]; let i = 0; while (i < K.length - 2 && a > K[i + 1][0]) i++; return K[i][1] + (K[i + 1][1] - K[i][1]) * Math.min(1, Math.max(0, (a - K[i][0]) / (K[i + 1][0] - K[i][0]))); };
const HAIR_STYLES = [{ th: 0.05, front: 0.64, hang: 0 }, { th: 0.09, front: 0.42, hang: 0 }, { th: 0.08, front: 0.5, hang: 1 }];
function personHead(child, style) {
  return G(`personHead${child ? 1 : 0}${style}`, () => {
    const K = personDims(child), F = K.F, R = F.R, e = F.eyeY, v = new THREE.Vector3(), w2 = new THREE.Vector3();
    const head = sculpt(40, 30, (nx, ny, nz, o) => personHeadPt(nx, ny, nz, o, F));
    // midline depth of the face at a height, for seating the nose and lips
    const faceZ = (y) => { let lo = -1, hi = 1; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; onPersonFace(0, m, F, v); if (v.y < y) lo = m; else hi = m; } return onPersonFace(0, (lo + hi) / 2, F, v).z; };
    onPersonFace(0.33, e, F, v); const eyeC = new THREE.Vector3(v.x, v.y, v.z + 0.0055 - F.er);
    // nose: bridge from between the eyes to a rounded tip and two wings
    const nTop = eyeC.y + 0.02 * R, NL = F.noseL * R;
    const nose = sculpt(16, 12, (nx, ny, nz, o) => {
      const t = (ny + 1) / 2, y = nTop - NL + t * NL, wd = R * (0.06 + 0.1 * Math.exp(-(((t - 0.15) / 0.16) ** 2))), d = R * (0.05 + F.nose * Math.exp(-(((t - 0.2) / 0.2) ** 2)) + 0.04 * t);
      return o.set(nx * wd, y, faceZ(y) - 0.004 + (nz > 0 ? nz * d * (1 - 0.45 * nx * nx * (1 - t)) : nz * 0.02 * R));
    });
    // ears, tilted back and standing a little off the head
    const earG = sculpt(12, 10, (nx, ny, nz, o) => o.set(nx * 0.0055 - (nx > 0 ? 0.0035 * (1 - ny * ny - nz * nz) : 0), ny * 0.03, nz * 0.017 * (1 - 0.25 * Math.max(0, -ny))));
    const ed = new THREE.Vector3(0.97, (e - 0.12) * 0.75, -0.22).normalize(); personHeadPt(ed.x, ed.y, ed.z, v, F);
    const ear = [earG, M(v.x + 0.0012, v.y, v.z, -0.2, -0.1, 0, F.ear)];
    // lips, bent round the face
    const ym = (e - 0.6) * F.chinY * R, zm = faceZ(ym), lipG = (rx, ry, rz) => sculpt(14, 8, (nx, ny, nz, o) => o.set(nx * rx, ny * ry, nz * rz - (nx * rx) ** 2 * 7));
    const lips = merge([[lipG(0.022 * F.lip, 0.0036 * F.lip, 0.0055), M(0, ym + 0.0036 * F.lip, zm - 0.0028)], [lipG(0.02 * F.lip, 0.0052 * F.lip, 0.0065), M(0, ym - 0.0046 * F.lip, zm - 0.0032)]]);
    // eyes: an eyeball inside a skin shell with an almond slot for the lids
    const eyeW = [], iris = [], pupil = [], lidParts = [];
    for (const s of [-1, 1]) {
      const C = eyeC.clone(); C.x *= s; const er = F.er;
      eyeW.push(ball(C.x, C.y, C.z, er, er, er, 14, 10)); iris.push(ball(C.x, C.y, C.z + er - 0.0012, 0.0062, 0.0062, 0.0022, 14, 6)); pupil.push(ball(C.x, C.y, C.z + er + 0.0006, 0.0026, 0.0026, 0.0008, 10, 4));
      for (const upper of [true, false]) {
        lidParts.push([faceOut(grid(14, 6, (u, w, o) => {
          const a = (u - 0.5) * TAU, win = Math.abs(a) < 1.3 ? Math.cos(a / 1.3 * PI / 2) ** 0.6 : 0, ec = 0.06 * Math.sin(a) * s;
          const edge = upper ? ec + F.openU * win : ec - F.openL * win, el = upper ? PI / 2 + (edge - PI / 2) * w : -PI / 2 + (edge + PI / 2) * w, r = er * (1.1 - 0.07 * smooth(0.6, 1, w) * win);
          return o.set(C.x + r * Math.cos(el) * Math.sin(a), C.y + r * Math.sin(el), C.z + r * Math.cos(el) * Math.cos(a));
        }), [C.x, C.y, C.z])]);
      }
    }
    // brows
    const browG = sculpt(10, 6, (nx, ny, nz, o) => o.set(nx * 0.021, ny * 0.0026 * (1 - 0.4 * nx), nz * 0.004 - (nx * 0.021) ** 2 * 5));
    const brows = [-1, 1].map((s) => { onPersonFace(s * 0.31, e + 0.21, F, v); return [browG, M(v.x, v.y, v.z + 0.0012, 0, s * 0.3, -s * 0.12, child ? 0.9 : 1, child ? 0.7 : 1, 1)]; });
    // hair: a shell over the skull, thinning to nothing at the hairline; long hair falls behind the shoulders
    const st = HAIR_STYLES[style];
    const hair = faceOut(grid(34, 16, (u, w, o) => {
      const az = (u - 0.5) * TAU, aa = Math.abs(az), H = st.hang && aa > 1.9 ? -1 : HAIRLINE(aa, e, st.front), ny = 1 - (1 - H) * w ** 0.85, q = Math.sqrt(Math.max(0, 1 - ny * ny));
      const nx = Math.sin(az) * q, nz = Math.cos(az) * q;
      personHeadPt(nx, ny, nz, o, F);
      const edge = smooth(1, 0.8, w), th = (st.th * (0.6 + 0.4 * Math.max(0, ny)) + 0.008 * Math.sin(az * 9 + ny * 5)) * edge + 0.008 * (1 - edge);
      const len = o.length(); o.multiplyScalar((len + R * th) / len);
      if (st.hang) {
        const wh = smooth(1.5, 1.95, aa) * smooth(0.15, -0.25, ny);
        if (wh > 0) {
          personHeadPt(nx, 0.12, Math.sign(nz) * Math.sqrt(Math.max(0, 1 - nx * nx - 0.0144)), w2, F);
          const hx = w2.x * (1 + st.th * 1.1), hz = w2.z * (1 + st.th * 1.1) - 0.01 * smooth(0, -1, ny), hy = 0.12 * R + (ny - 0.12) / 1.12 * 1.75 * R;
          o.set(o.x + (hx - o.x) * wh, o.y + (hy - o.y) * wh, o.z + (hz - o.z) * wh);
        }
      }
      return o;
    }), [0, 0, 0]);
    return {
      skin: merge([[head], [nose], ear, [mirrorX(merge([ear]))], ...lidParts]), hair: merge([[hair], ...brows]),
      eyeW: merge(eyeW), iris: merge(iris), pupil: merge(pupil), lips,
    };
  });
}
// the shirt body: rings of a rounded box, chest and shoulder blades (a child: a rounder tummy)
const TORSO_W = [[0.79, 0.166], [0.84, 0.162], [0.95, 0.15], [1.06, 0.149], [1.18, 0.158], [1.3, 0.17], [1.375, 0.178], [1.415, 0.152], [1.45, 0.092], [1.475, 0.062]];
const TORSO_D = [[0.79, 0.116], [0.84, 0.112], [0.95, 0.104], [1.06, 0.106], [1.18, 0.115], [1.3, 0.118], [1.375, 0.105], [1.415, 0.086], [1.45, 0.066], [1.475, 0.058]];
function torsoPt(a, yn, K, o, out = 0) {
  const w = profileAt(TORSO_W, yn) * K.cw + out, d = profileAt(TORSO_D, yn) + out, c = Math.cos(a), s = Math.sin(a);
  const bump = (a0, b0) => Math.sin(PI * smooth(a0, b0, yn));
  let z = d * Math.sign(s) * Math.abs(s) ** 0.8;
  if (s > 0) z *= 1 + (K.child ? 0.06 * bump(0.86, 1.12) : 0.07 * bump(1.12, 1.36)) * s * s; else z *= 1 + 0.05 * bump(1.2, 1.4) * Math.abs(c);
  return o.set(w * Math.sign(c) * Math.abs(c) ** 0.8, K.hipY + (yn - 0.84) * K.tf, z + 0.006 * bump(1.1, 1.4) - 0.006 * bump(0.86, 1.06));
}
// a mitten hand (right hand as its owner sees it: wrist at the origin, fingers down -y, palm toward -x, thumb toward -z)
function mittenHand() {
  return G('mitten1', () => {
    const parts = [[sculpt(12, 10, (nx, ny, nz, o) => o.set(nx * (nx > 0 ? 0.012 : 0.0155), -0.046 + ny * 0.047, nz * 0.038))]];
    [[-0.024, 0.074, 0.0083], [-0.008, 0.081, 0.0088], [0.008, 0.077, 0.0084], [0.023, 0.062, 0.0073]].forEach(([zf, L, r]) => parts.push([softTube([[0, -0.068, zf], [-0.003, -0.068 - L * 0.5, zf * 1.05], [-0.011, -0.068 - L * 0.88, zf * 1.05], [-0.018, -0.068 - L, zf]], () => [r * 0.85, r], 6, 7, 0.12, 0.12)]));
    parts.push([softTube([[-0.004, -0.012, -0.022], [-0.012, -0.035, -0.036], [-0.018, -0.058, -0.04], [-0.022, -0.075, -0.036]], () => [0.0092, 0.0098], 7, 8, 0.12, 0.14)]);
    return merge(parts);
  });
}
function personBody(child) {
  return G(`personBody${child ? 1 : 0}`, () => {
    const K = personDims(child), v = new THREE.Vector3(), rf = K.rf, lf = K.lf;
    const torso = faceOut(grid(28, 22, (u, w, o) => torsoPt(u * TAU, 0.79 + w * 0.685, K, o)));
    // a rolled band following the body (collar, hem)
    const band = (yn, out, r) => faceOut(grid(28, 5, (u, w, o) => { const a = u * TAU, b = w * TAU; torsoPt(a, yn, K, v, out); const l = Math.hypot(v.x, v.z) || 1; return o.set(v.x + v.x / l * r * Math.cos(b), v.y + r * Math.sin(b), v.z + v.z / l * r * Math.cos(b)); }));
        const collar = [[band(1.455, 0.006, 0.009 * K.nf)]];
    const buttons = []; for (let i = 0; i < 4; i++) { const yn = 1.36 - i * 0.12; torsoPt(PI / 2, yn, K, v); buttons.push(ball(0, v.y, v.z + 0.003, 0.0065, 0.0065, 0.003, 6, 4)); }
    const pelvis = lathe([[0.001, 0.75], [0.09, 0.752], [0.13, 0.765], [0.152, 0.8], [0.158, 0.86], [0.152, 0.95], [0.001, 0.955]], 24); pelvis.scale(K.cw * 0.95, lf, 0.64); smoothSeams(pelvis);
    // arms (right side; the left is its mirror): sleeve from a rounded shoulder to the elbow, sleeve to a cuff, then the hand
    const E = K.el, W = K.wr, len = Math.hypot(...E) + 0.08;
    const upper = softTube([[-0.012, 0.045, 0], [0, 0, 0], [E[0] * 0.5, E[1] * 0.5, E[2] * 0.5], E, [E[0] * 1.1, E[1] * 1.1, E[2] * 1.1]], (t, a) => { const r = (0.053 - 0.011 * smooth(0.1, 0.85, t)) * rf; return [r, r * 1.04]; }, 12, 14, 0.053 * rf / len, 0.04 * rf / len);
    const wl = Math.hypot(...W) + 0.04;
    const fore = softTube([[0, 0.035, 0], [W[0] * 0.5, W[1] * 0.5, W[2] * 0.5], [W[0], W[1], W[2]]], (t) => { const r = (0.0395 - 0.0055 * smooth(0, 1, t)) * rf; return [r, r * 1.05]; }, 12, 12, 0.041 * rf / wl, 0.02 / wl);
    const wd = new THREE.Vector3(...W).normalize(), cuffQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), wd);
    const cuff = [G(`cuff${rf}`, () => new THREE.TorusGeometry(0.036 * rf, 0.0055, 5, 18)), new THREE.Matrix4().compose(new THREE.Vector3(W[0] * 0.97, W[1] * 0.97, W[2] * 0.97), cuffQ, new THREE.Vector3(1, 1, 1))];
    const WO = 0.028 * rf, WH = [W[0] + wd.x * WO, W[1] + wd.y * WO, W[2] + wd.z * WO];   // the wrist shows this far past the cuff
    const hand = [mirrorX(mittenHand()), M(WH[0], WH[1] - 0.01 * K.af, WH[2], 0, PI, 0, K.hf)];
    const wrist = softTube([[W[0] * 0.92, W[1] * 0.92, W[2] * 0.92], [W[0], W[1], W[2]], [WH[0] + wd.x * 0.012, WH[1] + wd.y * 0.012, WH[2] + wd.z * 0.012]], (t) => { const r = (0.026 - 0.002 * t) * rf; return [r * 1.15, r * 0.85]; }, 10, 6, 0.3, 0.3);
    const foreR = merge([[fore], cuff]), handR = merge([hand, [wrist]]);
    // legs: thigh from the hip pivot, trouser leg with a hem and a shoe from the knee pivot
    const thigh = softTube([[0, 0.06, -0.004], [0, 0, 0], [0.003, -0.19, 0.01], [0.005, -0.37, 0.012], [0.005, -0.405, 0.008]].map((p) => p.map((q) => q * lf)), (t) => { const r = (0.078 - 0.021 * smooth(0.1, 0.85, t)) * rf; return [r, r]; }, 12, 14, 0.16, 0.1);
    const shinG = softTube([[0, 0.04, 0], [0, -0.17, -0.006], [0, -0.39, -0.024]].map((p) => p.map((q) => q * lf)), (t) => { const r = (0.057 - 0.01 * smooth(0, 1, t)) * rf; return [r, r]; }, 12, 12, 0.13, 0.05);
    const hem = [G(`hem${rf}`, () => new THREE.TorusGeometry(0.048 * rf, 0.006, 5, 18)), M(0, -0.37 * lf, -0.023 * lf, PI / 2)];
    const shoe = sculpt(18, 12, (nx, ny, nz, o) => {
      let x = nx * 0.047 * (child ? 0.92 : 1), y = ny * 0.042, z = nz * 0.125;
      const front = smooth(-0.02, 0.1, z); if (y > 0) y *= 1 - 0.45 * front;
      y = Math.max(y, -0.04);
      return o.set(x, (-0.428 + y) * lf, (0.028 + z) * (child ? 0.92 : 1) * lf);
    });
    const neck = softTube([[0, -0.06, -0.012], [0, 0.03, -0.006], [0, 0.125, 0.004]], (t) => { const r = (0.05 - 0.005 * t) * K.nf; return [r, r]; }, 14, 8, 0.2, 0.15);
    return {
      torso: merge([[torso], [band(0.795, 0.004, 0.006)], ...collar]), buttons: merge(buttons), pelvis,
      upperR: upper, upperL: mirrorX(merge([[upper]])), foreR, foreL: mirrorX(foreR), handR, handL: mirrorX(handR),
      thighR: thigh, thighL: mirrorX(merge([[thigh]])), shin: merge([[shinG], hem]), shoe, neck,
    };
  });
}
const lipMat2 = () => Mt('lips2', () => std(0xb27a70, { roughness: 0.55, map: skinTex() }));

// a person: neck, shoulders, elbows, hips and knees are pivots
// (userData neck, head, armL/armR, foreL/foreR, legL/legR, kneeL/kneeR, chest, body); call idleHuman to breathe.
// opt.seated sits them on a stool (see sitHuman).
export function makeHuman(scale = 1, color = 0x3d4a66, opt = {}) {
  const child = opt.child ?? scale < 0.8, K = personDims(child), g = new THREE.Group();
  const c = new THREE.Color(color), dark = c.clone().multiplyScalar(0.55).getHex(), cloth = clothMat(color), trouser = clothMat(dark);
  const hash = (c.r * 7 + c.g * 13 + c.b * 5) * 10, hc = opt.hair ?? HAIR[hash % HAIR.length | 0], eyeC = [0x4a3324, 0x5a6f86, 0x3d2a1c, 0x5b6a45][(hash * 1.9 | 0) % 4];
  const P = personBody(child), Hd = personHead(child, opt.hairStyle ?? (child ? (hash * 3.7 | 0) % HAIR_STYLES.length : 0));
  // body: everything from the hips up (and the legs hanging off it), so sitting can lower it
  const body = new THREE.Group(); g.add(body);
  body.add(new THREE.Mesh(P.pelvis, trouser));
  const chest = new THREE.Group(); body.add(chest);
  chest.add(new THREE.Mesh(P.torso, cloth), new THREE.Mesh(P.buttons, eyeWhiteMat()));
  const leg = (s) => {
    const hip = new THREE.Group(); hip.position.set(s * 0.085 * K.cw, K.hipY, 0); hip.add(new THREE.Mesh(s > 0 ? P.thighR : P.thighL, trouser)); body.add(hip);
    const knee = new THREE.Group(); knee.position.set(s * 0.005 * K.lf, -0.37 * K.lf, 0.012 * K.lf); knee.add(new THREE.Mesh(P.shin, trouser), new THREE.Mesh(P.shoe, Mt('shoes', () => std(0x2a2420, { roughness: 0.5 })))); hip.add(knee);
    return [hip, knee];
  };
  const [legL, kneeL] = leg(-1), [legR, kneeR] = leg(1);
  const neck = new THREE.Group(); neck.position.set(0, K.neckY, 0); body.add(neck);
  neck.add(new THREE.Mesh(P.neck, skinMat()));
  const head = new THREE.Group(); head.position.y = 0.15; neck.add(head);
  head.add(new THREE.Mesh(Hd.skin, skinMat()), new THREE.Mesh(Hd.hair, hairMat(hc)), new THREE.Mesh(Hd.iris, Mt(`irisC${eyeC}`, () => std(eyeC, { roughness: 0.25 }))), new THREE.Mesh(Hd.pupil, irisMat()), new THREE.Mesh(Hd.lips, lipMat2()), new THREE.Mesh(Hd.eyeW, eyeWhiteMat()));
  const arm = (s) => {
    const sh = new THREE.Group(); sh.position.set(s * K.sh[0], K.sh[1], K.sh[2]); sh.add(new THREE.Mesh(s > 0 ? P.upperR : P.upperL, cloth)); body.add(sh);
    const el = new THREE.Group(); el.position.set(s * K.el[0], K.el[1], K.el[2]); el.add(new THREE.Mesh(s > 0 ? P.foreR : P.foreL, cloth)); sh.add(el);
    const wr = new THREE.Group(); wr.position.set(s * K.wr[0], K.wr[1], K.wr[2]); el.add(wr);
    const hm = new THREE.Mesh(s > 0 ? P.handR : P.handL, skinMat()); hm.position.set(-s * K.wr[0], -K.wr[1], -K.wr[2]); wr.add(hm);
    return [sh, el, wr];
  };
  const [armL, foreL, wristL] = arm(-1), [armR, foreR, wristR] = arm(1);
  g.userData = { head, neck, chest, body, armL, armR, foreL, foreR, wristL, wristR, legL, legR, kneeL, kneeR, hipY: K.hipY, child, rf: K.rf, lf: K.lf, hf: K.hf, ph: Math.random() * TAU, armX: 0, foreX: -0.08, armZ: 0.03 };
  g.scale.setScalar(scale);
  if (opt.seated) sitHuman(g);
  return g;
}
// Sit a person on a stool: the origin stays on the floor under the hips, the seat is 0.45 (unscaled) above it,
// thighs forward, shins down, hands resting on the knees. Facing +z, so the stool goes under the origin.
export function sitHuman(h) {
  const u = h.userData; if (!u.body) return h;
  u.body.position.set(0, 0.51 - (u.hipY ?? 0.84), 0);   // hip joints at 0.51: seat 0.45 under the thighs
  for (const [hip, knee] of [[u.legL, u.kneeL], [u.legR, u.kneeR]]) { hip.rotation.set(-1.5, 0, 0); knee.rotation.set(1.42, 0, 0); }
  u.legL.rotation.z = -0.06; u.legR.rotation.z = 0.06;
  u.armX = -0.6; u.foreX = -0.15; u.armZ = -0.18;
  const pose = () => { u.armL.rotation.set(u.armX, 0, -u.armZ); u.armR.rotation.set(u.armX, 0, u.armZ); u.foreL.rotation.x = u.foreR.rotation.x = u.foreX; };
  pose();
  if (u.wristR) {
    // hands on the lap: solve shoulder (x, z) and elbow (x) for the right arm so the wrist sits just above the thigh, about
    // half way to the knee, then mirror; the wrist turns the hand palm down with the fingers along the thigh
    const p = h.parent; if (p) p.remove(h);
    const pos0 = h.position.clone(), q0 = h.quaternion.clone(); h.position.set(0, 0, 0); h.quaternion.identity();
    const lf = u.lf || 1, rf = u.rf || 1, V3 = THREE.Vector3;
    h.updateMatrixWorld(true);
    const knee = u.kneeR.getWorldPosition(new V3()), hip = u.legR.getWorldPosition(new V3());
    const fwd = knee.clone().sub(hip); fwd.y = 0; fwd.normalize();
    const lap = hip.clone().lerp(knee, 0.5); lap.y += 0.078 * rf * h.scale.x + 0.016 * h.scale.x;   // the top of the thigh, half way along
    const target = lap.addScaledVector(fwd, -0.045 * h.scale.x);   // the palm's middle is ahead of the wrist
    const w = new V3();
    const err = () => { pose(); h.updateMatrixWorld(true); u.wristR.getWorldPosition(w); return w.distanceToSquared(target); };
    let e = err(), st = 0.2;
    for (let it = 0; it < 160 && st > 0.002; it++) {
      let better = false;
      for (const k of ['armX', 'armZ', 'foreX']) for (const d of [st, -st]) {
        const o = u[k]; u[k] = o + d;
        if (k === 'foreX') u[k] = Math.min(0, Math.max(-2.4, u[k]));   // the elbow only bends one way
        const e2 = err(); if (e2 < e) { e = e2; better = true; } else u[k] = o;
      }
      if (!better) st *= 0.5;
    }
    pose(); h.updateMatrixWorld(true);
    // turn each wrist so the fingers (hand -y) run along the thigh and the palm (hand x toward the body) faces down
    const down = new V3(0, -1, 0), m = new THREE.Matrix4(), qw = new THREE.Quaternion(), qp = new THREE.Quaternion();
    for (const [wr, s] of [[u.wristR, 1], [u.wristL, -1]]) {
      const f = fwd.clone(); f.x *= s;   // the left leg's forward is the mirror of the right's
      const xa = down.clone().multiplyScalar(-s), ya = f.clone().negate(), za = new V3().crossVectors(xa, ya);
      m.makeBasis(xa, ya, za); qw.setFromRotationMatrix(m);
      wr.parent.getWorldQuaternion(qp); wr.quaternion.copy(qp.invert().multiply(qw));
    }
    h.position.copy(pos0); h.quaternion.copy(q0); if (p) p.add(h);
  }
  u.seated = true;
  return h;
}
// breathing, a slow weight of the head, arms loose (or resting on the knees when seated); call every frame
export function idleHuman(h, t) {
  const u = h.userData; if (!u.chest) return;
  const b = Math.sin(t * 1.6 + u.ph);
  u.chest.scale.set(1 + b * 0.008, 1, 1 + b * 0.018);
  u.neck.rotation.x = Math.sin(t * 0.4 + u.ph) * 0.03 + (u.seated ? 0.12 : 0); u.neck.rotation.y = Math.sin(t * 0.23 + u.ph) * 0.05;
  u.armL.rotation.z = -u.armZ - b * 0.012; u.armR.rotation.z = u.armZ + b * 0.012;
  u.foreL.rotation.x = u.foreR.rotation.x = u.foreX - b * 0.02;
}

// ---- bare feet: one sculpted surface per foot. Heel, ankle, arch, instep and ball are a smooth signed-distance shape,
// sampled as rings on planes that run down the shin, fan round a line in front of the ankle, then stand upright along the
// forefoot (each ring cast from its deepest point). The toes are swept tubes rooted inside the ball, as the fingers are rooted
// in the palm, and the nails are domed vertex-coloured plates sunk at the cuticle, as on the hands.
const _smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const _smax = (a, b, k) => -_smin(-a, -b, k);
// local right foot: x lateral (+ = outside, - = the big-toe side), y up, toes toward -z
function footSDF(x, y, z) {
  const E = (cx, cy, cz, rx, ry, rz, rot = 0) => {
    let dx = x - cx, dz = z - cz;
    if (rot) { const c = Math.cos(rot), s = Math.sin(rot), u = dx * c + dz * s; dz = -dx * s + dz * c; dx = u; }
    const a = dx / rx, b = (y - cy) / ry, w = dz / rz, k0 = Math.hypot(a, b, w), k1 = Math.hypot(a / rx, b / ry, w / rz) + 1e-9;
    return k0 * (k0 - 1) / k1;
  };
  const Cap = (ax, ay, az, bx, by, bz, ra, rb) => {
    const px = x - ax, py = y - ay, pz = z - az, qx = bx - ax, qy = by - ay, qz = bz - az, t = Math.min(1, Math.max(0, (px * qx + py * qy + pz * qz) / (qx * qx + qy * qy + qz * qz)));
    return Math.hypot(px - qx * t, py - qy * t, pz - qz * t) - (ra + (rb - ra) * t);
  };
  // the shin narrowing into the ankle, rounded off underneath
  const ty = Math.min(1, Math.max(0, (-0.69 - y) / 0.08)), lrx = 0.0285 - 0.003 * ty, lrz = 0.031 - 0.003 * ty, lcz = 0.008 + 0.005 * ty;
  const la = x / lrx, lc = (z - lcz) / lrz, k0 = Math.hypot(la, lc);
  let d = _smax(k0 * (k0 - 1) / (Math.hypot(la / lrx, lc / lrz) + 1e-9), -0.792 - y, 0.03);
  d = _smin(d, E(0.002, -0.818, 0.016, 0.03, 0.034, 0.033), 0.026);                         // heel
  d = _smin(d, E(0.008, -0.823, -0.045, 0.035, 0.028, 0.075), 0.03);                        // midfoot
  d = _smin(d, E(0.03, -0.836, -0.055, 0.016, 0.015, 0.05), 0.02);                           // outer edge, resting on the floor
  d = _smin(d, Cap(-0.004, -0.785, -0.012, -0.008, -0.828, -0.112, 0.02, 0.0095), 0.022);    // instep sloping to the ball
  d = _smin(d, E(-0.004, -0.834, -0.103, 0.046, 0.016, 0.026, 0.35), 0.022);                  // ball: wider than the heel, slanting back to the little toe
  // the toe roots grow out of the ball with a soft web between them; each toe's tube emerges from its root at the first joint
  for (const t of FOOT_TOES) {
    const [a, b] = t.J, k = t.w / t.h, px = x - a[0], py = (y - a[1]) * k, pz = z - a[2], qx = b[0] - a[0], qy = (b[1] - a[1]) * k, qz = b[2] - a[2];
    const u = Math.min(1, Math.max(0, (px * qx + py * qy + pz * qz) / (qx * qx + qy * qy + qz * qz)));
    d = _smin(d, (Math.hypot(px - qx * u, py - qy * u, pz - qz * u) - t.w * (1.08 - 0.11 * u)) / Math.sqrt(k), t.w > 0.01 ? 0.012 : 0.009);
  }
  d = _smin(d, E(-0.024, -0.765, 0.006, 0.009, 0.013, 0.012), 0.012);                       // inner ankle bone: higher, further forward
  d = _smin(d, E(0.025, -0.778, 0.017, 0.009, 0.013, 0.012), 0.012);                        // outer ankle bone: lower, further back
  for (const sx of [-1, 1]) d = _smax(d, -Cap(sx * 0.017, -0.715, 0.04, sx * 0.016, -0.79, 0.038, 0.0065, 0.005), 0.008);   // hollows beside the Achilles tendon
  d = _smax(d, -E(-0.034, -0.857, -0.05, 0.028, 0.028, 0.06), 0.014);                      // the arch, lifted on the inner side
  return _smax(d, -0.848 - y, 0.006);                                                          // flat where the sole meets the floor
}
// the toes: joint points root (inside the ball) -> MTP -> ... -> tip; half-width, half-height; the small toes curl a little
const FOOT_TOES = [
  { w: 0.0125, h: 0.0122, J: [[-0.0235, -0.833, -0.1], [-0.025, -0.835, -0.13], [-0.026, -0.8355, -0.153], [-0.027, -0.836, -0.1745]] },
  { w: 0.0082, h: 0.0076, J: [[-0.002, -0.8285, -0.095], [-0.002, -0.8375, -0.124], [-0.0015, -0.836, -0.146], [-0.001, -0.839, -0.158], [-0.001, -0.8404, -0.1675]] },
  { w: 0.0076, h: 0.0072, J: [[0.013, -0.83, -0.092], [0.0135, -0.838, -0.118], [0.0145, -0.8365, -0.138], [0.015, -0.8395, -0.149], [0.0155, -0.8408, -0.157]] },
  { w: 0.0071, h: 0.0068, J: [[0.0255, -0.831, -0.088], [0.0265, -0.8385, -0.111], [0.028, -0.837, -0.128], [0.029, -0.8398, -0.138], [0.0295, -0.8412, -0.145]] },
  { w: 0.0065, h: 0.0063, J: [[0.036, -0.833, -0.082], [0.0375, -0.84, -0.102], [0.039, -0.8385, -0.117], [0.04, -0.841, -0.126], [0.0405, -0.8417, -0.133]] },
];
function footLocal() {
  const pos = [], col = [], uv = [], idx = [], gn = [], c = new THREE.Color(), f = footSDF;
  const add = (p, cl, u, v, n = null) => { pos.push(p[0], p[1], p[2]); col.push(cl.r, cl.g, cl.b); uv.push(u, v); gn.push(n); return pos.length / 3 - 1; };
  const quad = (a, b, cc, d) => idx.push(a, b, d, b, cc, d);
  const grad = (p) => { const h = 0.0004, [x, y, z] = p, gx = f(x + h, y, z) - f(x - h, y, z), gy = f(x, y + h, z) - f(x, y - h, z), gz = f(x, y, z + h) - f(x, y, z - h), l = Math.hypot(gx, gy, gz) || 1; return [gx / l, gy / l, gz / l]; };
  // ---- body ----
  const SIDES = 40, yA = -0.75, zA = -0.05, planes = [];
  for (const y of [-0.672, -0.69, -0.706, -0.72, -0.732, -0.742]) planes.push({ o: [0, y, zA], e: [0, 0, 1] });
  const NF = 15; for (let k = 0; k <= NF; k++) { const t = k / NF * PI / 2; planes.push({ o: [0, yA, zA], e: [0, -Math.sin(t), Math.cos(t)] }); }
  const at = (o, e, u, v) => [o[0] + u, o[1] + e[1] * v, o[2] + e[2] * v];
  const deepest = (o, e) => {
    let best = 1, bu = 0, bv = 0;
    for (let u = -0.065; u <= 0.07; u += 0.004) for (let v = 0.002; v <= 0.15; v += 0.004) { const q = f(...at(o, e, u, v)); if (q < best) { best = q; bu = u; bv = v; } }
    const u0 = bu, v0 = bv;
    for (let u = u0 - 0.004; u <= u0 + 0.004; u += 0.001) for (let v = Math.max(0.001, v0 - 0.004); v <= v0 + 0.004; v += 0.001) { const q = f(...at(o, e, u, v)); if (q < best) { best = q; bu = u; bv = v; } }
    return [best, bu, bv];
  };
  // forefoot: upright planes, closer together toward the front of the ball
  let lo = -0.11, hi = -0.2;
  for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (deepest([0, yA, m], [0, -1, 0])[0] < -0.0015) lo = m; else hi = m; }
  const NZ = 13; for (let j = 1; j <= NZ; j++) planes.push({ o: [0, yA, zA + (lo - zA) * Math.sin(j / NZ * PI / 2)], e: [0, -1, 0] });
  const cast = (o, e, cu, cv, du, dv) => {
    const inside = (t) => f(...at(o, e, cu + du * t, cv + dv * t)) < 0;
    let t = 0; while (t < 0.2 && inside(t + 0.0015)) t += 0.0015;
    let a = t, b = t + 0.0015; for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (inside(m)) a = m; else b = m; }
    return (a + b) / 2;
  };
  const bodyCol = (p, n) => {
    c.copy(_tc.base);
    c.lerp(_tc.palm, 0.55 * smooth(-0.35, -0.85, n[1]) * smooth(-0.83, -0.845, p[1]));                           // paler sole
    c.lerp(_tc.tip, 0.3 * smooth(0.03, 0.05, p[2]) * smooth(-0.79, -0.83, p[1]));                                 // pinker heel
    c.lerp(_tc.tip, 0.22 * smooth(-0.09, -0.12, p[2]) * smooth(-0.83, -0.846, p[1]));                             // and ball
    for (const [mx, my, mz] of [[-0.03, -0.765, 0.006], [0.031, -0.778, 0.017]]) c.lerp(_tc.knuckle, 0.35 * Math.exp(-(((p[0] - mx) ** 2 + (p[1] - my) ** 2 + (p[2] - mz) ** 2) / 0.00012)));
    return c;
  };
  const cen = planes.map((pl) => deepest(pl.o, pl.e).slice(1));
  const soften = (arr, passes) => { for (let q = 0; q < passes; q++) { const o = arr.map((x) => x.slice()); for (let i = 1; i < arr.length - 1; i++) for (let j = 0; j < 2; j++) arr[i][j] = (o[i - 1][j] + 2 * o[i][j] + o[i + 1][j]) / 4; } };
  soften(cen, 3);
  const ext = planes.map((pl, i) => { const [cu, cv] = cen[i]; return [(cast(pl.o, pl.e, cu, cv, 1, 0) + cast(pl.o, pl.e, cu, cv, -1, 0)) / 2, (cast(pl.o, pl.e, cu, cv, 0, 1) + cast(pl.o, pl.e, cu, cv, 0, -1)) / 2]; });
  soften(ext, 2);
  let prev = null, vAcc = 0, lastC = null;
  planes.forEach((pl, pi) => {
    const [cu, cv] = cen[pi], [eu, ev] = ext[pi], C = at(pl.o, pl.e, cu, cv);
    if (lastC) vAcc += Math.hypot(C[0] - lastC[0], C[1] - lastC[1], C[2] - lastC[2]) / 0.1;
    lastC = C;
    const first = pos.length / 3;
    for (let k = 0; k <= SIDES; k++) {
      const a = k / SIDES * TAU, qu = Math.cos(a) * eu, qv = Math.sin(a) * ev, dl = Math.hypot(qu, qv), du = qu / dl, dv = qv / dl, t = cast(pl.o, pl.e, cu, cv, du, dv);
      const p = at(pl.o, pl.e, cu + du * t, cv + dv * t), n = grad(p);
      add(p, bodyCol(p, n), k / SIDES * 2, vAcc, n);
    }
    if (prev !== null) for (let k = 0; k < SIDES; k++) quad(prev + k, prev + k + 1, first + k + 1, first + k);
    prev = first;
  });
  { // the front of the ball closes to a point (inside the big toe's root)
    const C = lastC.slice(); while (f(C[0], C[1], C[2] - 0.0005) < 0) C[2] -= 0.0005;
    const n = grad(C), first = pos.length / 3;
    for (let k = 0; k <= SIDES; k++) add(C, bodyCol(C, n), k / SIDES * 2, vAcc + 0.02, n);
    for (let k = 0; k < SIDES; k++) quad(prev + k, prev + k + 1, first + k + 1, first + k);
  }
  // ---- toes ----
  const V = THREE.Vector3, up = new V(0, 1, 0), P = new V(), dir = new V(), d2 = new V(), nn = new V(), bb = new V();
  const capRings = [[0, 1], [0.45, 0.9], [0.72, 0.72], [0.88, 0.5], [0.97, 0.25], [1, 0]];
  FOOT_TOES.forEach((toe, ti) => {
    const big = ti === 0, J = toe.J.map((p) => new V(p[0], p[1], p[2])), S = [0];
    for (let i = 1; i < J.length; i++) S.push(S[i - 1] + J[i].distanceTo(J[i - 1]));
    const T = S[S.length - 1], capLen = toe.w * 0.75, sides = big ? 14 : 10, SJ = S[S.length - 2], Ld = T - SJ;
    const frame = (x) => {
      let i = 0; while (i < J.length - 2 && x > S[i + 1]) i++;
      P.copy(J[i]).lerp(J[i + 1], (x - S[i]) / (S[i + 1] - S[i])); dir.subVectors(J[i + 1], J[i]).normalize();
      if (i + 2 < J.length && x > S[i + 1] - 0.004) { d2.subVectors(J[i + 2], J[i + 1]).normalize(); dir.lerp(d2, smooth(S[i + 1] - 0.004, S[i + 1] + 0.004, x) * 0.5).normalize(); }
      if (i > 0 && x < S[i] + 0.004) { d2.subVectors(J[i], J[i - 1]).normalize(); dir.lerp(d2, (1 - smooth(S[i] - 0.004, S[i] + 0.004, x)) * 0.5).normalize(); }
      nn.copy(up).addScaledVector(dir, -up.dot(dir)).normalize(); bb.crossVectors(dir, nn);
    };
    const rad = (x, a) => {
      const bot = Math.max(0, -Math.cos(a));
      let r = (0.9 + 0.1 * smooth(S[1] - 0.006, S[1], x)) * (1 - 0.1 * smooth(S[1], T, x));                    // hidden inside its root until the first joint, then a slight taper
      for (let j = 2; j < S.length - 1; j++) r *= 1 + 0.045 * Math.exp(-(((x - S[j]) / 0.003) ** 2));     // knuckles
      r *= 1 + 0.12 * bot * Math.exp(-(((x - (T - capLen * 1.1)) / (capLen * 0.7)) ** 2));                // pad under the tip
      const bulb = big ? Math.exp(-(((x - (T - capLen * 1.2)) / (capLen * 0.9)) ** 2)) : 0, waist = big ? Math.exp(-(((x - S[2]) / 0.006) ** 2)) : 0;   // big toe: broad flat tip, waisted at its joint
      return [toe.h * r * (1 - 0.1 * bot * bot) * (1 - 0.12 * smooth(S[1], T, x)) * (1 - 0.05 * waist), toe.w * r * (1 + 0.1 * bulb - 0.05 * waist)];
    };
    const capScale = (x) => { const q = (x - (T - capLen)) / capLen; if (q <= 0) return 1; for (let i = 1; i < capRings.length; i++) if (q <= capRings[i][0]) { const [a0, s0] = capRings[i - 1], [a1, s1] = capRings[i]; return s0 + (s1 - s0) * (q - a0) / (a1 - a0); } return 0; };
    const pt = (x, a, extra) => { frame(x); const [rv, rs] = rad(x, a), sc = capScale(x); return [P.x + nn.x * Math.cos(a) * (rv * sc + extra) + bb.x * Math.sin(a) * (rs * sc + extra), P.y + nn.y * Math.cos(a) * (rv * sc + extra) + bb.y * Math.sin(a) * (rs * sc + extra), P.z + nn.z * Math.cos(a) * (rv * sc + extra) + bb.z * Math.sin(a) * (rs * sc + extra)]; };
    const toeCol = (x, a) => {
      const top = Math.max(0, Math.cos(a)), bot = Math.max(0, -Math.cos(a));
      c.copy(_tc.base).lerp(_tc.palm, 0.5 * bot);
      for (let j = 2; j < S.length - 1; j++) c.lerp(_tc.knuckle, top * 0.45 * Math.exp(-(((x - S[j]) / 0.004) ** 2)));
      for (let j = 1; j < S.length - 1; j++) c.lerp(_tc.crease, bot * 0.5 * Math.exp(-(((x - S[j]) / 0.0016) ** 2)));
      return c.lerp(_tc.tip, 0.5 * smooth(SJ + Ld * 0.3, T, x));
    };
    const xs = [];
    for (let x = 0; x < T - capLen - 0.001; x += 0.005) xs.push(x);
    for (let j = 1; j < S.length - 1; j++) xs.push(S[j] - 0.002, S[j], S[j] + 0.002);
    xs.sort((a, b) => a - b);
    const rings = []; for (const x of xs) if (x < T - capLen - 0.0008 && (!rings.length || x - rings[rings.length - 1] > 0.0012)) rings.push(x);
    for (const [q] of capRings) rings.push(T - capLen + q * capLen);
    let pr = null;
    for (const x of rings) {
      const first = pos.length / 3;
      for (let k = 0; k <= sides; k++) { const a = k / sides * TAU; add(pt(x, a, 0), toeCol(x, a), k / sides * 0.4, x / 0.1); }
      if (pr !== null) for (let k = 0; k < sides; k++) quad(pr + k, pr + k + 1, first + k + 1, first + k);
      pr = first;
    }
    // the nail: a domed plate on top of the last bone, base sunk under the cuticle, edges fading into the skin
    const NU = big ? 6 : 4, NV = big ? 5 : 3, A = big ? 0.95 : 0.82, n0 = big ? 0.2 : 0.14, n1 = 1 - 0.3 * capLen / Ld, base = pos.length / 3;
    for (let j = 0; j <= NV; j++) for (let k = 0; k <= NU; k++) {
      const x = SJ + Ld * (n0 + (n1 - n0) * nailRow(j, NV)), w = k / NU * 2 - 1;
      const lift = (big ? 0.0008 : 0.0005) * (1 - w * w) - 0.0003 * w * w - (j === 0 ? 0.0005 : 0) + (j === NV ? 0.00015 : 0);
      add(pt(x, w * A, lift), nailCol(c, j, NV, w), 0, 0);
    }
    for (let j = 0; j < NV; j++) for (let k = 0; k < NU; k++) { const a = base + j * (NU + 1) + k; quad(a, a + 1, a + NU + 2, a + NU + 1); }
  });
  // vertex normals, averaged across duplicated seam and pole vertices; the body takes the exact normal of its shape
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const nr = g.attributes.normal.array, groups = new Map();
  for (let i = 0; i < pos.length; i += 3) { const key = `${Math.round(pos[i] * 1e5)},${Math.round(pos[i + 1] * 1e5)},${Math.round(pos[i + 2] * 1e5)}`; const a = groups.get(key); if (a) a.push(i); else groups.set(key, [i]); }
  for (const a of groups.values()) if (a.length > 1) { let x = 0, y = 0, z = 0; for (const i of a) { x += nr[i]; y += nr[i + 1]; z += nr[i + 2]; } const l = Math.hypot(x, y, z) || 1; for (const i of a) { nr[i] = x / l; nr[i + 1] = y / l; nr[i + 2] = z / l; } }
  gn.forEach((n, i) => { if (n) { nr[i * 3] = n[0]; nr[i * 3 + 1] = n[1]; nr[i * 3 + 2] = n[2]; } });
  return { pos, nor: Array.from(nr), col, uv, idx };
}
// both feet as one plain non-indexed geometry (left foot all x < 0, right all x > 0), skin and nails by vertex colour
function skinFeetGeo() {
  const F = footLocal(), n = F.idx.length * 2, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const s of [-1, 1]) for (let t = 0; t < F.idx.length; t += 3) for (const j of s > 0 ? [0, 1, 2] : [0, 2, 1]) {
    const i = F.idx[t + j];
    pos[o * 3] = s * (0.09 + F.pos[i * 3]); pos[o * 3 + 1] = F.pos[i * 3 + 1]; pos[o * 3 + 2] = F.pos[i * 3 + 2];
    nor[o * 3] = s * F.nor[i * 3]; nor[o * 3 + 1] = F.nor[i * 3 + 1]; nor[o * 3 + 2] = F.nor[i * 3 + 2];
    col[o * 3] = F.col[i * 3]; col[o * 3 + 1] = F.col[i * 3 + 1]; col[o * 3 + 2] = F.col[i * 3 + 2];
    uv[o * 2] = F.uv[i * 2]; uv[o * 2 + 1] = F.uv[i * 2 + 1]; o++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere(); return g;
}

// ---- first-person body: origin at the eye point, facing -z, no head ----
function playerParts() {
  return G('player3', () => {
    const H = humanParts();
    const toPlayer = M(0, -1.59, 0.095, 0, PI, 0);
    const torso = H.shirtTorso.clone().applyMatrix4(toPlayer);
    // skin at the open neck: the top of the chest and two collarbones
    const neckSkin = merge([tag(ball(0, -0.135, 0.038, 0.058, 0.026, 0.045, 10, 6), SKIN), ...[-1, 1].map((s) => tag(seg([s * 0.014, -0.142, 0.004], [s * 0.11, -0.158, 0.036], 0.0065, 0.0055, 6), SKIN))]);
    // sleeves pushed up: pyjama to mid-forearm, then bare forearm narrowing to the wrist
    const upper = merge([ball(0, 0, 0, 0.052), seg([0, 0, 0], [0.025, -0.27, 0], 0.049, 0.042, 12), ball(0.025, -0.27, 0, 0.043)]);
    const fore = merge([seg([0, 0, 0], [0.003, -0.1, 0], 0.043, 0.041, 12), [G('cuffRing', () => new THREE.TorusGeometry(0.041, 0.009, 4, 12)), M(0.003, -0.1, 0, PI / 2)]]);
    const foreSkin = merge([tag(seg([0.002, -0.08, 0], [0.006, -0.17, 0], 0.037, 0.033, 10), SKIN), tag(seg([0.006, -0.17, 0], [0.008, -0.243, 0], 0.033, 0.025, 10), SKIN), tag(ball(0.008, -0.245, 0, 0.019, 0.012, 0.026, 8, 5), SKIN)]);
    const legs = [];
    for (const s of [-1, 1]) {
      const fx = s * 0.09;
      legs.push(seg([s * 0.085, 0.02, 0], [fx, -0.39, -0.012], 0.074, 0.06, 12), ball(fx, -0.39, -0.012, 0.06), seg([fx, -0.39, -0.012], [fx, -0.7, 0.008], 0.059, 0.053, 12), [G('legCuff', () => new THREE.TorusGeometry(0.053, 0.008, 4, 12)), M(fx, -0.7, 0.008, PI / 2)]);
    }
    const pelvis = lathe([[0.12, -0.08], [0.145, -0.04], [0.152, 0.04], [0.15, 0.1]], 16); pelvis.scale(1, 1, 0.7);
    // three puncture marks in a triangle, in a flat local frame facing +z
    const disc = new THREE.CircleGeometry(1, 14), marks = merge([[disc, M(0, 0.0049, 0, 0, 0, 0, 0.0038)], [disc, M(-0.00425, -0.00245, 0, 0, 0, 0, 0.0034)], [disc, M(0.00425, -0.00245, 0, 0, 0, 0, 0.0036)]]);
    return { torso, neckSkin, upper, upperL: mirrorX(upper), fore, foreL: mirrorX(fore), foreSkin, foreSkinL: mirrorX(foreSkin), legs: merge([[pelvis], ...legs]), feet: skinFeetGeo(), marks };
  });
}
// solved joint angles (armR x,y,z / foreR x(flex),y(twist) / handR x,y,z) for the hand poses; the left arm mirrors y and z
const POSE_REACH = [1.283, -0.262, -0.197, 0.246, -1.267, 0.1, 0, 0.063];
const POSE_PALM = [1.393, 0.235, -0.335, 1.179, -1.1, 0.202, 0, -0.474];
const POSE_BACK = [1.393, 0.235, -0.335, 1.179, 1.865, -0.113, 0, 0.447];
const POSE_BED = [0.1, 0, 0.25, 0.05, 0, 0, PI / 2, 0];
const RELAX = [0.3, 0.36, 0.42, 0.5], SHOW = [0.06, 0.03, 0.07, 0.12], _pose = new Array(8).fill(0), _curl = [0, 0, 0, 0];
const _ikV = [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3()), _ikQ = [0, 1, 2, 3, 4].map(() => new THREE.Quaternion());
// the marks: on the back of the right hand by the thumb, over the base of the index metacarpal (found on the palm shell)
const markSpot = () => G('markSpot', () => {
  const y = -0.058, z = -0.03; let lo = 0, hi = 0.04;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (palmInside(m, y, z) < 1) lo = m; else hi = m; }
  const e = 0.0005, f = (x, yy, zz) => palmInside(x, yy, zz);
  const n = new THREE.Vector3(f(lo + e, y, z) - f(lo - e, y, z), f(lo, y + e, z) - f(lo, y - e, z), f(lo, y, z + e) - f(lo, y, z - e)).normalize();
  return { p: new THREE.Vector3(lo, y, z), n };
});

// The player's own body. userData:
//  armL/armR (shoulder pivots), foreL/foreR (elbow pivots; rotation.y rolls the forearm), handL/handR (wrist pivots),
//  handRigL/handRigR (skinned hands: .bones, .set(curls[4], spread, thumbOpp, thumbFlex)), legs (hip pivot), torso, chest, marks
//  Poses (tween a 0..1 value): examineHand(t), reachRight(k), fistLift(k). Rest states: layInBed(), relax(a).
//  ikRight(W, Q, pole) places the right hand by two-bone IK; bareShin() bares the right shin and returns the mark on it.
//  setHand(side, curls, spread, opp, flex), curl(side, c, thumb); breathe(t) moves the chest.
export function makePlayerBody() {
  const P = playerParts();
  const pj = Mt('pyjamaC', () => { const wb = weaveBump().clone(); wb.repeat.set(28, 28); wb.needsUpdate = true; return std(0xc8d0e0, { roughness: 0.85, map: pyjamaTex(), bumpMap: wb, bumpScale: 0.45 }); });   // weave twice as fine as other cloth: it is right at the camera
  const hs = handSkinMat();
  const g = new THREE.Group();
  const torso = new THREE.Group(); g.add(torso);
  const chest = new THREE.Group(); torso.add(chest);
  chest.add(new THREE.Mesh(P.torso, pj), new THREE.Mesh(P.neckSkin, hs));
  const side = (s) => {
    const L = s < 0;
    const arm = new THREE.Group(); arm.position.set(s * 0.205, -0.205, 0.095); arm.add(new THREE.Mesh(L ? P.upperL : P.upper, pj)); torso.add(arm);
    const fore = new THREE.Group(); fore.position.set(s * 0.025, -0.27, 0); fore.add(new THREE.Mesh(L ? P.foreL : P.fore, pj), new THREE.Mesh(L ? P.foreSkinL : P.foreSkin, hs)); arm.add(fore);
    const hand = new THREE.Group(); hand.position.set(s * 0.008, -0.25, 0); fore.add(hand);
    const h = skinHand(s, L ? 0 : 1); hand.add(h.mesh); h.hand = hand;
    return [arm, fore, h];
  };
  const [armL, foreL, hL] = side(-1), [armR, foreR, hR] = side(1);
  // three puncture marks on the back of the right hand, by the thumb
  const marks = new THREE.Group(); marks.visible = false; hR.hand.add(marks);
  const ms = markSpot(); marks.position.copy(ms.p).addScaledVector(ms.n, 0.0008); marks.quaternion.setFromUnitVectors(_fw, ms.n);
  marks.add(new THREE.Mesh(P.marks, Mt('puncture', () => new THREE.MeshStandardMaterial({ map: punctureTex(), transparent: true, depthWrite: false, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }))));
  const legs = new THREE.Group(); legs.position.set(0, -0.73, 0.095); g.add(legs);
  legs.add(new THREE.Mesh(P.legs, pj), new THREE.Mesh(P.feet, hs));
  const hands = { L: hL, R: hR };
  const setArm = (s, p, kS, kE, kT, kW, extra = 0) => {
    const a = s > 0 ? armR : armL, f = s > 0 ? foreR : foreL, h = (s > 0 ? hR : hL).hand;
    a.rotation.set(p[0] * kS, s * p[1] * kS, s * p[2] * kS);
    f.rotation.set(p[3] * kE, s * p[4] * kT, 0);
    h.rotation.set(p[5] * kW, s * (p[6] * kW + extra * 0.5), s * (p[7] * kW + extra));
  };
  const relaxHand = (h, k = 1, th = 0.25) => { for (let f = 0; f < 4; f++) _curl[f] = RELAX[f] * k; h.set(_curl, 0.15, 0.15, th); };
  const u = {
    armL, armR, foreL, foreR, handL: hL.hand, handR: hR.hand, handRigL: hL, handRigR: hR, legs, torso, chest, marks,
    setHand(sideKey, curls, spread = 0, opp = 0, flex = 0) { hands[sideKey].set(curls, spread, opp, flex); },
    curl(sideKey, c, th = c) { for (let f = 0; f < 4; f++) _curl[f] = c * (0.9 + f * 0.06); const tt = Math.pow(Math.max(0, th), 0.6); hands[sideKey].set(_curl, 0.1 * (1 - c), 0.15 + 0.95 * tt, 0.2 + 0.85 * tt); },
    // The cliché look at the hand, as one continuous motion over t 0..1 (tween about 6 s, linear: easing is inside):
    // the hand rises in front of the face palm toward the eyes; a beat; it turns slowly to show the back (marks seen
    // around t 0.5..0.6); a little examining turn; the fingers curl into a loose fist and open; a pause; it lowers.
    examineHand(t) {
      const up = (d) => settle((t - d) / 0.24) * (1 - settle((t - 0.86 + d) / 0.14));
      const kS = up(0), kE = up(0.03), kW = up(0.06);
      const tw = settle((t - 0.34) / 0.22);
      for (let i = 0; i < 8; i++) _pose[i] = POSE_PALM[i] + (POSE_BACK[i] - POSE_PALM[i]) * tw;
      const wob = Math.sin(t * 9) * 0.02 * kW + Math.sin(PI * smooth(0.55, 0.63, t)) * 0.09;
      setArm(1, _pose, kS, kE, kE, kW, wob);
      const fist = t > 0.64 && t < 0.78 ? Math.sin(PI * (t - 0.64) / 0.14) : 0;
      for (let f = 0; f < 4; f++) { const base = RELAX[f] + (SHOW[f] - RELAX[f]) * kW; _curl[f] = base + (0.66 + f * 0.05 - base) * fist; }
      const ft = Math.pow(fist, 0.6); hR.set(_curl, 0.55 * kW * (1 - fist), 0.12 + 1.0 * ft, 0.2 + 0.9 * ft); // the thumb leads and folds over the fingers
    },
    // right arm held out in front at chest height, palm up, fingers open (for taking something, or a finger laid in the palm)
    reachRight(k) {
      setArm(1, POSE_REACH, settle(k / 0.7), settle((k - 0.05) / 0.7), settle((k - 0.2) / 0.7), settle((k - 0.3) / 0.7));
      const w = settle((k - 0.25) / 0.75); for (let f = 0; f < 4; f++) _curl[f] = RELAX[f] * (1 - w) + (0.05 + f * 0.03) * w; hR.set(_curl, 0.5 * w, 0.1 - 0.1 * w, 0.25 - 0.35 * w);
    },
    // from layInBed: the right fist comes up off the covers
    fistLift(k) {
      const a = settle(k / 0.7), e = settle((k - 0.1) / 0.7), c = settle((k - 0.2) / 0.6);
      armR.rotation.set(POSE_BED[0] + 0.85 * a, 0, POSE_BED[2] - 0.12 * a);
      foreR.rotation.set(POSE_BED[3] + 1.25 * e, 0, 0);
      hR.hand.rotation.set(-0.25 * c, POSE_BED[6], 0);
      for (let f = 0; f < 4; f++) _curl[f] = RELAX[f] * 0.8 + (0.86 + f * 0.03 - RELAX[f] * 0.8) * c; const ct = Math.pow(c, 0.6); hR.set(_curl, 0, 0.15 + 0.95 * ct, 0.25 + 0.85 * ct);
    },
    // lying on the back in the bed of buildBedroom, head on the pillow, arms resting on top of the covers, palms down
    layInBed() {
      g.position.set(0, 0.74, -1.58); g.rotation.set(-PI / 2 + 0.08, PI, 0);
      legs.rotation.x = 0.07;   // legs level along the mattress (the covers in buildBedroom are shaped round this pose)
      for (const s of [-1, 1]) setArm(s, POSE_BED, 1, 1, 1, 1);
      relaxHand(hL, 0.8); relaxHand(hR, 0.8);
    },
    // arms loose at the sides, raised forward by a (radians), fingers in a natural half-curl
    relax(a = 0.1) {
      for (const s of [-1, 1]) setArm(s, [a, 0, 0.08, 0.15, 0, 0, 0, 0], 1, 1, 1, 1);
      relaxHand(hL); relaxHand(hR);
    },
    // Two-bone IK for the right arm, in the body's own frame (origin at the eyes, -z ahead, torso unrotated).
    // W: where the wrist pivot goes; Q: the hand's orientation (hand frame: palm toward -x, fingers along -y, thumb toward -z);
    // pole: the direction the elbow points. The upper arm and forearm keep their lengths (law of cosines); the forearm takes
    // the hand's roll about its own axis (pronation), so the wrist pivot is left with only the bend. Returns the elbow.
    ikRight(W, Q, pole) {
      const [d, p, e, u0, f0, t] = _ikV, [qa, qal, rel, tw, qh] = _ikQ;
      u0.copy(foreR.position); f0.copy(hR.hand.position);
      const L1 = u0.length(), L2 = f0.length();
      d.subVectors(W, armR.position); let D = d.length(); d.divideScalar(D || 1);
      D = Math.min(Math.max(D, Math.abs(L1 - L2) + 1e-3), L1 + L2 - 1e-4);
      const ca = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
      p.copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
      e.copy(armR.position).addScaledVector(d, L1 * ca).addScaledVector(p, L1 * sa);
      // upper arm: swing its bone direction onto shoulder-to-elbow
      t.subVectors(e, armR.position).normalize(); qa.setFromUnitVectors(u0.normalize(), t); armR.quaternion.copy(qa);
      // forearm: swing onto elbow-to-wrist (in the upper arm's frame), then roll it with the hand
      t.subVectors(W, e).normalize().applyQuaternion(tw.copy(qa).invert()); f0.normalize(); qal.setFromUnitVectors(f0, t);
      rel.copy(qa).multiply(qal).invert().multiply(Q);                  // the hand relative to the swung forearm
      const k = rel.x * f0.x + rel.y * f0.y + rel.z * f0.z;            // swing-twist about the forearm axis
      tw.set(f0.x * k, f0.y * k, f0.z * k, rel.w); if (tw.lengthSq() < 1e-12) tw.identity(); else tw.normalize();
      foreR.quaternion.copy(qal).multiply(tw);
      hR.hand.quaternion.copy(qh.copy(tw).invert().multiply(rel));
      return e;
    },
    breathe(t) { const b = Math.sin(t * 1.5); chest.scale.set(1 + b * 0.006, 1, 1 + b * 0.016); },
    // the right trouser leg pushed up over the knee, a bare shin below it, and on the shin a small scooped mark (the sceptic
    // morning). Returns the mark, so a view can be aimed at it.
    bareShin() {
      const pm = legs.children[0], src = pm.geometry, p = src.attributes.position, idx = src.index ? src.index.array : null, n = idx ? idx.length : p.count, keep = [];
      const out = (i) => (p.getX(i) > 0.03 && p.getY(i) < -0.43 && p.getY(i) > -0.76 ? 1 : 0);
      for (let t = 0; t < n; t += 3) { const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2; if (out(a) + out(b) + out(c) === 0) keep.push(a, b, c); }   // the shin tube has rings only at its ends: drop any triangle that reaches below the knee
      const geo = src.clone(); geo.setIndex(keep); pm.geometry = geo;
      const fx = 0.09;
      legs.add(new THREE.Mesh(merge([tag(seg([fx, -0.41, -0.011], [fx, -0.69, 0.008], 0.05, 0.035, 14), SKIN), tag(ball(fx, -0.415, -0.013, 0.051, 0.042, 0.05, 12, 8), SKIN)]), hs));
      const roll = new THREE.Mesh(G('legRoll', () => new THREE.TorusGeometry(0.058, 0.018, 8, 18)), pj); roll.position.set(fx, -0.425, -0.011); roll.rotation.x = PI / 2; legs.add(roll);
      const mt = ctex('scoopMark', 128, 128, (g2, w, h) => {
        g2.clearRect(0, 0, w, h);
        const r = g2.createRadialGradient(64, 64, 0, 64, 64, 62);
        r.addColorStop(0, 'rgba(236,178,166,1)'); r.addColorStop(0.42, 'rgba(206,128,116,1)'); r.addColorStop(0.66, 'rgba(118,52,46,0.95)'); r.addColorStop(0.82, 'rgba(176,110,98,0.5)'); r.addColorStop(1, 'rgba(190,130,115,0)');
        g2.fillStyle = r; g2.fillRect(0, 0, w, h);
        // the scoop: shadow under its upper lip, a little light on its lower slope
        g2.fillStyle = 'rgba(90,40,36,0.35)'; g2.beginPath(); g2.ellipse(64, 54, 36, 20, 0, PI, TAU); g2.fill();
        g2.fillStyle = 'rgba(255,230,220,0.25)'; g2.beginPath(); g2.ellipse(64, 74, 26, 12, 0, 0, PI); g2.fill();
      });
      const mark = new THREE.Mesh(G('scoopDisc', () => new THREE.CircleGeometry(0.015, 24)), Mt('scoopMark', () => new THREE.MeshStandardMaterial({ map: mt, transparent: true, depthWrite: false, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 })));
      mark.position.set(fx - 0.006, -0.55, -0.0555); mark.rotation.y = PI; legs.add(mark);
      legs.children[1].visible = true;   // the feet, now out from under the covers
      return mark;
    },
  };
  relaxHand(hL); relaxHand(hR);
  g.userData = u;
  return g;
}

// ---- the ceiling, made to be stared at from 25 cm ----
// 1) a 1024 map over the whole ceiling (5 x 6 m): tone, roller bands, a water stain, dust toward the walls, a crack network
// 2) a tiling orange-peel bump (512 px per 0.21 m, so the stipple bumps are 1-3 mm) repeated across it
// 3) a sharp 1 m detail patch (1 mm per pixel) right above the bed where you end up: hairline cracks, the stain's tide line,
//    paint nibs and a drip, dust, a stray strand; its alpha fades to nothing so it has no edge
const _wrapDraw = (g, w, h, x, y, f) => { for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) f(x + ox, y + oy); };
const ceilingMap = () => ctex('ceilMap', 1024, 1024, (g, w, h) => {
  seed(151); g.fillStyle = '#8f8f8a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) { const x = rr(0, w), y = rr(0, h), r = rr(40, 160), gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rand() < 0.5 ? 'rgba(255,255,250,.05)' : 'rgba(0,0,0,.05)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  for (let x = 0; x < w; x += rr(30, 60)) { g.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},.025)`; g.fillRect(x, 0, rr(20, 50), h); }   // roller bands
  // dust and grime toward the walls
  const edge = g.createLinearGradient(0, 0, w, 0); edge.addColorStop(0, 'rgba(60,55,45,.18)'); edge.addColorStop(0.08, 'rgba(0,0,0,0)'); edge.addColorStop(0.92, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(60,55,45,.18)'); g.fillStyle = edge; g.fillRect(0, 0, w, h);
  const edge2 = g.createLinearGradient(0, 0, 0, h); edge2.addColorStop(0, 'rgba(60,55,45,.18)'); edge2.addColorStop(0.08, 'rgba(0,0,0,0)'); edge2.addColorStop(0.92, 'rgba(0,0,0,0)'); edge2.addColorStop(1, 'rgba(60,55,45,.18)'); g.fillStyle = edge2; g.fillRect(0, 0, w, h);
  // a big faint water stain near the window corner, with a tide line
  const sx = 120, sy = 780; for (const [r, a] of [[150, 0.08], [110, 0.06]]) { const gr = g.createRadialGradient(sx, sy, r * 0.3, sx, sy, r); gr.addColorStop(0, `rgba(140,110,60,${a})`); gr.addColorStop(0.85, `rgba(120,90,50,${a * 1.6})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(sx, sy, r * 1.2, r, 0.4, 0, TAU); g.fill(); }
  // hairline cracks spreading from the light fitting
  g.lineCap = 'round';
  const crack = (x, y, a, len, d) => { if (d > 5 || len < 6) return; g.strokeStyle = 'rgba(40,38,34,.45)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x, y); let px = x, py = y; for (let i = 0; i < 6; i++) { a += rr(-0.5, 0.5); px += Math.cos(a) * len / 6; py += Math.sin(a) * len / 6; g.lineTo(px, py); } g.stroke(); crack(px, py, a + rr(-0.8, 0.8), len * 0.6, d + 1); if (rand() < 0.5) crack(px, py, a + rr(-1.2, 1.2), len * 0.5, d + 1); };
  for (let i = 0; i < 5; i++) crack(512, 512, rr(0, TAU), rr(40, 90), 0);
});
const ceilStipple = () => { let t = texCache.get('ceilStippleT'); if (!t) {
  t = wrapTex(paint('ceilStipple', 512, 512, (g, w, h) => {
    seed(161); g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i++) { const x = rr(0, w), y = rr(0, h), r = rr(2, 7), up = rand() < 0.78; _wrapDraw(g, w, h, x, y, (X, Y) => { if (X < -r || Y < -r || X > w + r || Y > h + r) return; const gr = g.createRadialGradient(X, Y, 0, X, Y, r); gr.addColorStop(0, up ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(128,128,128,0)'); g.fillStyle = gr; g.fillRect(X - r, Y - r, 2 * r, 2 * r); }); }
    for (let i = 0; i < 9000; i++) { g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.14)'; g.fillRect(rr(0, w), rr(0, h), 1, 1); }
  }), [24, 28], false);
  t.anisotropy = 16; t.userData.keep = true; texCache.set('ceilStippleT', t); } return t; };
// the detail patch above the bed: colour+alpha and a matching bump
function drawCeilPatch(g, bump) {
  seed(171); const W = 1024, C = W / 2;
  if (bump) { g.fillStyle = '#808080'; g.fillRect(0, 0, W, W); } else g.clearRect(0, 0, W, W);
  const col = (r, gg, b, a) => bump ? `rgba(${a > 0 ? 0 : 255},${a > 0 ? 0 : 255},${a > 0 ? 0 : 255},${Math.abs(a)})` : `rgba(${r},${gg},${b},${Math.abs(a)})`;
  if (!bump) { const gr = g.createRadialGradient(C, C, 0, C, C, C); gr.addColorStop(0, 'rgba(143,143,138,.0)'); g.fillStyle = gr; }
  // paint nibs, a drip, dust
  for (let i = 0; i < 520; i++) { const x = rr(0, W), y = rr(0, W), r = rr(0.7, 2.1); g.fillStyle = bump ? 'rgba(255,255,255,.45)' : 'rgba(160,160,154,.35)'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); if (!bump) { g.fillStyle = 'rgba(70,70,64,.16)'; g.beginPath(); g.arc(x + r * 0.45, y + r * 0.45, r * 0.6, 0, TAU); g.fill(); } }
  // the grain itself: thousands of specks finer than a millimetre
  for (let i = 0; i < 16000; i++) { g.fillStyle = bump ? (rand() < 0.5 ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.22)') : (rand() < 0.5 ? 'rgba(175,175,168,.16)' : 'rgba(95,95,88,.14)'); g.fillRect(rr(0, W), rr(0, W), 1, 1); }
  g.fillStyle = bump ? 'rgba(255,255,255,.6)' : 'rgba(170,170,162,.7)'; g.beginPath(); g.ellipse(640, 300, 6, 18, 0.2, 0, TAU); g.fill(); g.beginPath(); g.arc(644, 322, 8, 0, TAU); g.fill();
  for (let i = 0; i < 1400; i++) { g.fillStyle = bump ? 'rgba(255,255,255,.2)' : `rgba(${rand() < 0.5 ? '70,66,60' : '190,188,180'},.35)`; g.fillRect(rr(0, W), rr(0, W), rr(1, 2.5), rr(1, 2.5)); }
  // the water stain's tide line crossing one side of the patch
  if (!bump) { for (let i = 0; i < 3; i++) { g.strokeStyle = `rgba(120,92,50,${0.18 - i * 0.04})`; g.lineWidth = 10 - i * 3; g.beginPath(); g.ellipse(80, 980, 520 + i * 6, 430 + i * 5, -0.3, -1.9, -0.6); g.stroke(); }
    const st = g.createRadialGradient(80, 980, 150, 80, 980, 520); st.addColorStop(0, 'rgba(150,120,70,.12)'); st.addColorStop(1, 'rgba(150,120,70,0)'); g.fillStyle = st; g.fillRect(0, 0, W, W); }
  // hairline cracks with a lifted lip of paint on one side
  g.lineCap = 'round'; seed(181);
  const crack = (x, y, a, len, d) => { if (d > 6 || len < 8) return; let px = x, py = y; const pts = [[x, y]]; for (let i = 0; i < 8; i++) { a += rr(-0.45, 0.45); px += Math.cos(a) * len / 8; py += Math.sin(a) * len / 8; pts.push([px, py]); }
    for (const [w, c] of bump ? [[2.2, 'rgba(255,255,255,.3)'], [0.8, 'rgba(0,0,0,.8)']] : [[2.2, 'rgba(190,190,182,.22)'], [0.6, 'rgba(52,48,42,.6)']]) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); pts.forEach(([X, Y], i) => (i ? g.lineTo(X, Y) : g.moveTo(X, Y))); g.stroke(); }
    crack(px, py, a + rr(-0.7, 0.7), len * 0.62, d + 1); if (rand() < 0.55) crack(pts[4][0], pts[4][1], a + rr(-1.3, 1.3), len * 0.45, d + 1); };
  crack(260, 520, -0.2, 260, 0); crack(520, 470, 2.6, 200, 1); crack(700, 640, 0.9, 180, 1);
  // a stray strand of cobweb
  if (!bump) { g.strokeStyle = 'rgba(225,228,235,.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(980, 120); g.bezierCurveTo(820, 180, 760, 320, 690, 330); g.stroke(); }
  // alpha: fade the whole patch out radially so it has no edge
  if (!bump) { g.globalCompositeOperation = 'destination-in'; const gr = g.createRadialGradient(C, C, C * 0.55, C, C, C * 0.98); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, W); g.globalCompositeOperation = 'source-over'; }
}
const ceilPatchTex = () => { const t = ctex('ceilPatch', 1024, 1024, (g) => drawCeilPatch(g, false)); t.anisotropy = 16; return t; };
const ceilPatchBump = () => { let t = texCache.get('ceilPatchBumpT'); if (!t) { t = wrapTex(paint('ceilPatchBump', 1024, 1024, (g) => drawCeilPatch(g, true)), null, false); t.anisotropy = 16; t.userData.keep = true; texCache.set('ceilPatchBumpT', t); } return t; };

// ---- light from the doorway: shafts and wall glow that are drawn by shaders, not scaled with the opening ----
const RAY_V = `
uniform float uHW, uH, uOpen;
attribute vec2 aTA; attribute vec4 aShaft; attribute float aLen;
varying float vT, vEdge, vSeed; varying vec3 vW;
void main() {
  float t = aTA.x, a = aTA.y, h = max(uH, 0.001), f = clamp(uH / 2.42, 0.0, 1.0);
  vec3 S = vec3(aShaft.x * uHW * 0.9, aShaft.y * h, 0.0);
  vec3 D = normalize(vec3(sin(aShaft.z * (0.4 + 0.6 * f)), -sin(aShaft.w), cos(aShaft.z)));
  vec3 U = normalize(cross(D, vec3(0.0, 1.0, 0.0))); vec3 W = cross(U, D);
  float r = mix(0.06 + 0.1 * f, 0.35 + 0.45 * f, t);
  vec3 n = cos(a) * U + sin(a) * W;
  vec4 wp = modelMatrix * vec4(S + D * t * aLen + n * r, 1.0);
  vec3 wn = normalize(mat3(modelMatrix) * n);
  vEdge = abs(dot(wn, normalize(cameraPosition - wp.xyz)));
  vT = t; vSeed = aShaft.x * 5.0 + aShaft.z * 11.0; vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const RAY_F = `
uniform float uOpen, uTime;
varying float vT, vEdge, vSeed; varying vec3 vW;
void main() {
  float side = pow(vEdge, 2.4);                                      // soft to nothing at the silhouette
  float along = smoothstep(0.0, 0.14, vT) * pow(1.0 - vT, 1.7);      // from nothing at the source to nothing at the end
  float dust = 0.72 + 0.28 * sin(vW.x * 6.0 + vW.y * 4.5 - vW.z * 2.5 + uTime * 0.5 + vSeed) * sin(vW.y * 9.0 - vW.z * 3.0 + uTime * 0.31 + vSeed * 2.0);
  float motes = 0.9 + 0.1 * sin(dot(vW, vec3(37.0, 41.0, 29.0)) + uTime * 0.8);
  gl_FragColor = vec4(vec3(0.42, 0.66, 1.0) * side * along * dust * motes * uOpen * 0.11, 1.0);
}`;
const GLOW_V = `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GLOW_F = `
uniform float uHW, uH, uOpen;
varying vec2 vP;
float archSD(vec2 p, float hw, float h) { float spring = max(h - hw, 0.0); return p.y > spring ? length(p - vec2(0.0, spring)) - hw : max(abs(p.x) - hw, -p.y); }
void main() {
  float sd = max(archSD(vP, uHW, max(uH, 0.001)), 0.0);
  float g = exp(-sd * 3.2) * 0.55 + exp(-sd * 1.1) * 0.22;
  g *= 1.0 - smoothstep(0.5, 0.98, length(vec2(vP.x / 2.3, (vP.y - 1.2) / 2.0)));   // gone well before the quad's edge
  g *= smoothstep(-0.02, 0.12, vP.y) * smoothstep(0.0, 0.25, uH);
  gl_FragColor = vec4(vec3(0.38, 0.62, 1.0) * g * uOpen, 1.0);
}`;
function portalRayGeo() {
  return G('portalRays', () => {
    const SH = [[-0.7, 0.3, -0.32, 0.12, 4.6], [-0.35, 0.6, -0.15, 0.2, 5.2], [0.0, 0.45, 0.02, 0.15, 5.6], [0.3, 0.7, 0.16, 0.24, 5.0], [0.65, 0.35, 0.3, 0.1, 4.4], [-0.15, 0.85, -0.05, 0.3, 4.8], [0.45, 0.15, 0.22, 0.05, 3.8]];
    const NA = 10, NT = 12, pos = [], ta = [], sh = [], len = [], idx = [];
    SH.forEach((s) => {
      const base = ta.length / 2;
      for (let i = 0; i <= NT; i++) for (let j = 0; j <= NA; j++) { pos.push(0, 0, 0); ta.push(Math.pow(i / NT, 1.3), j / NA * TAU); sh.push(s[0], s[1], s[2], s[3]); len.push(s[4]); }
      for (let i = 0; i < NT; i++) for (let j = 0; j < NA; j++) { const a = base + i * (NA + 1) + j, b = a + 1, d = a + NA + 1, c = d + 1; idx.push(a, b, d, b, c, d); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aTA', new THREE.Float32BufferAttribute(ta, 2));
    geo.setAttribute('aShaft', new THREE.Float32BufferAttribute(sh, 4)); geo.setAttribute('aLen', new THREE.Float32BufferAttribute(len, 1)); geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 3), 6);
    return geo;
  });
}

// ---------- the bedroom ----------
// Room spans x -2.5..2.5, y 0..2.6, z -2..4. Bed head against the z=-2 wall, feet toward +z.
// Blanket in its own space: the mesh sits at (0, 0.57, -0.55), so local z = world z + 0.55 and local y = world y - 0.57.
// Its head edge is at world z -1.33, across the chest under the arms resting on top; it drapes over both sides and the foot.
const BW = 0.81, BL0 = -0.78, BL1 = 0.73, BR = 0.06;   // head edge at world z -1.33: across the chest, just below the shoulders
// side and foot drape: unfolded coordinate s past the mattress edge W bends round a radius and hangs down
function drape(s, W) {
  const q = PI * BR / 2, a = Math.abs(s);
  if (a <= W) return [s, 0];
  const d = a - W;
  if (d < q) { const t = d / BR; return [Math.sign(s) * (W + BR * Math.sin(t)), -(BR - BR * Math.cos(t))]; }
  return [Math.sign(s) * (W + BR), -BR - (d - q)];
}
const rumple = (x, z) => 0.022 * Math.sin(x * 6.1 + z * 2.3) * Math.sin(z * 4.7 - x * 1.9) + 0.01 * Math.sin(x * 15 + z * 9.5) + 0.03 * Math.exp(-Math.pow((x * 0.55 + z * 0.85 + 0.05) / 0.09, 2)) + 0.02 * Math.exp(-Math.pow((x * 0.9 - z * 0.4 - 0.35) / 0.06, 2));
// tidy covers over a sleeper: torso mound, two leg ridges, a small peak at the feet
function blanketPt(sx, sz, out) {
  const [x, yx] = drape(sx, BW), [z, yz] = drape(sz - BL0, BL1 - BL0).map((v, i) => (i ? v : v + BL0));
  const wz = z - 0.55, top = Math.abs(sx) <= BW && sz <= BL1 ? 1 : 0.3;
  // the covers lie over the real sleeper (see bedFields): chest, two leg ridges, knees, tented feet, arms resting on top
  const ridge = Math.abs(sx) <= BW + 0.02 ? bedH(x, wz) : 0;
  const hang = yx + yz < -0.08 ? 0.018 * Math.sin(z * 14 + x * 3) : 0;
  const lane = (1 - 0.8 * Math.exp(-Math.pow((Math.abs(x) - 0.33) / 0.1, 2)) * (1 - smooth(-0.55, -0.4, wz))) * (1 - 0.65 * smooth(0.01, 0.06, ridge));
  return out.set(x + (yx < -BR ? hang * Math.sign(x) : 0), yx + yz + ridge + rumple(x, z) * 0.45 * top * lane, z + (yz < -BR ? hang : 0));
}
// The covers are draped over the actual sleeping body (makePlayerBody in its layInBed pose): a height field of torso, legs and
// feet, widened by a hanging-cloth falloff (tents over the feet, sags between the legs), a shallow dip round the body where its
// weight presses the mattress, and pushed down under the arms resting on top. World x -0.6..0.6, z -1.2..0.36, 1.5 cm cells;
// heights are above the blanket's base level (world y 0.57).
const BF = { x0: -0.6, z0: -1.5, d: 0.015, nx: 81, nz: 125, h: null };
function bedFields() {
  if (BF.h) return BF;
  const { nx, nz, d, x0, z0 } = BF, N = nx * nz, top = new Float32Array(N).fill(-1), arm = new Float32Array(N).fill(9);
  const b = makePlayerBody(); b.userData.layInBed(); b.updateMatrixWorld(true);
  const armSet = new Set(); for (const a of [b.userData.armL, b.userData.armR]) a.traverse((o) => armSet.add(o));
  const v = new THREE.Vector3();
  const put = (isArm, x, y, z) => {
    const ix = Math.round((x - x0) / d), iz = Math.round((z - z0) / d);
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return;
    const c = iz * nx + ix; y -= 0.57;
    if (isArm) { if (y < arm[c]) arm[c] = y; } else if (y > top[c]) top[c] = y;
  };
  b.traverse((o) => {
    if (!o.isMesh) return;
    const isArm = armSet.has(o), p = o.geometry.attributes.position, W = new Float32Array(p.count * 3), ix = o.geometry.index;
    for (let i = 0; i < p.count; i++) {
      if (o.isSkinnedMesh) o.getVertexPosition(i, v); else v.fromBufferAttribute(p, i);
      v.applyMatrix4(o.matrixWorld); W[i * 3] = v.x; W[i * 3 + 1] = v.y; W[i * 3 + 2] = v.z;
    }
    // sample across every triangle (long cylinders only have vertices at their ends)
    const nT = ix ? ix.count / 3 : p.count / 3;
    for (let t = 0; t < nT; t++) {
      const a = (ix ? ix.getX(t * 3) : t * 3) * 3, bb = (ix ? ix.getX(t * 3 + 1) : t * 3 + 1) * 3, c = (ix ? ix.getX(t * 3 + 2) : t * 3 + 2) * 3;
      const e = Math.max(Math.hypot(W[bb] - W[a], W[bb + 2] - W[a + 2]), Math.hypot(W[c] - W[a], W[c + 2] - W[a + 2]), Math.hypot(W[c] - W[bb], W[c + 2] - W[bb + 2]));
      const n = Math.min(40, Math.ceil(e / (d * 0.7)) || 1);
      for (let i = 0; i <= n; i++) for (let j = 0; i + j <= n; j++) {
        const u = i / n, w = j / n, s = 1 - u - w;
        put(isArm, W[a] * s + W[bb] * u + W[c] * w, W[a + 1] * s + W[bb + 1] * u + W[c + 1] * w, W[a + 2] * s + W[bb + 2] * u + W[c + 2] * w);
      }
    }
  });
  // the first-person body is slim (chest 12-17 cm, legs 7-9 cm above the mattress); under the covers a sleeper reads fuller:
  // chest, belly, hips and legs a third higher, easing in below the covers' head edge so the edge still meets the chest,
  // and out again before the feet (they already tent the covers as high as the chest)
  for (let iz = 0; iz < nz; iz++) { const z = z0 + iz * d, k = 1 + 0.35 * smooth(-1.25, -0.95, z) * (1 - smooth(-0.32, -0.16, z)); for (let ix = 0; ix < nx; ix++) { const c = iz * nx + ix; if (top[c] > 0) top[c] *= k; } }
  // nobody lies dead straight: the right knee a little up (4 cm), so the covers are not one even tube
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) { const c = iz * nx + ix, x = x0 + ix * d, z = z0 + iz * d; if (top[c] > 0) top[c] += 0.04 * Math.exp(-((x - 0.09) ** 2) / 0.0098 - ((z + 0.33) ** 2) / 0.02); }
  // a lofty duvet hanging from whatever holds it up: about 3 cm proud of the body, falling ~2.4 cm over the first 10 cm to
  // the sides, and a little slower toward the foot of the bed (it tents off the toes in a slope), never below the
  // dip round the body
  const R = 22, CF = 2.4 * d * d, H = new Float32Array(N);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    let m = -1, near = 99;
    for (let dz = -R; dz <= R; dz++) {
      const jz = iz + dz; if (jz < 0 || jz >= nz) continue;
      for (let dx = -R; dx <= R; dx++) {
        const jx = ix + dx; if (jx < 0 || jx >= nx) continue;
        const t = top[jz * nx + jx]; if (t <= -0.02) continue;
        const r2 = dx * dx + dz * dz; if (r2 < near) near = r2;
        const h = t + 0.032 - CF * (dx * dx + (dz < 0 ? 0.7 : 1) * dz * dz); if (h > m) m = h;
      }
    }
    H[iz * nx + ix] = Math.max(m, -0.016 * Math.exp(-near * d * d / 0.012));
  }
  // soften the cell steps, then the arms: the cover runs under each arm, pressed a little by its weight
  const S = new Float32Array(N);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    let s = 0, w = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const jz = iz + dz, jx = ix + dx; if (jz < 0 || jz >= nz || jx < 0 || jx >= nx) continue; const k = dx || dz ? 1 : 2; s += H[jz * nx + jx] * k; w += k; }
    S[iz * nx + ix] = s / w;
  }
  const A = 6;
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    let lim = 9;
    for (let dz = -A; dz <= A; dz++) { const jz = iz + dz; if (jz < 0 || jz >= nz) continue; for (let dx = -A; dx <= A; dx++) { const jx = ix + dx; if (jx < 0 || jx >= nx) continue; const a = arm[jz * nx + jx]; if (a < 9) lim = Math.min(lim, a - 0.006 + 9 * (dx * dx + dz * dz) * d * d); } }
    S[iz * nx + ix] = Math.max(Math.min(S[iz * nx + ix], lim), top[iz * nx + ix] + 0.008);   // pressed under the arms, but never into the body
  }
  BF.h = S; return BF;
}
function bedH(x, z) {
  const { nx, nz, d, x0, z0, h } = bedFields();
  const fx = (x - x0) / d, fz = (z - z0) / d;
  if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return 0;
  const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, c = iz * nx + ix;
  const edge = Math.min(1, fx / 4, fz / 4, (nx - 1 - fx) / 4, (nz - 1 - fz) / 4);
  return edge * ((h[c] * (1 - tx) + h[c + 1] * tx) * (1 - tz) + (h[c + nx] * (1 - tx) + h[c + nx + 1] * tx) * tz);
}
// The turned-down sheet over the quilt's head edge, as one closed hem: t 0..0.5 lies on the quilt (from 18 cm in to the edge),
// 0.5..0.8 rolls over the edge, 0.8..1 falls to just below the mattress top (or in to the mattress side under the side drapes). Where it meets the body the fall is
// inside the body; beside it, it is a cloth wall, so there is nothing to see under the edge.
function bandPt(sx, t, out) {
  const off = 0.012, r = 0.016, a = Math.abs(sx) - BW, ang = a > 0 ? Math.min(a / BR, PI / 2) : 0;
  const ox = Math.sign(sx) * Math.sin(ang) * off, oy = Math.cos(ang) * off;
  if (t <= 0.5) { const k = 0.15 + 0.85 * smooth(0, 0.3, t); return blanketPt(sx, BL0 + 0.18 * (1 - t / 0.5), out).add(_p.set(ox * k, oy * k, 0)); }   // lies flush where it ends on the quilt
  blanketPt(sx, BL0, out).add(_p.set(ox, oy, 0));
  if (t <= 0.8) { const q = (t - 0.5) / 0.3 * PI / 2; return out.set(out.x, out.y - r + r * Math.cos(q), out.z - r * Math.sin(q)); }
  // on the top the fall goes straight down into the mattress; on the hanging sides it closes inward to the mattress side
  const x0 = out.x, y0 = out.y - r, yb = Math.min(-0.03, y0), xb = Math.sign(x0) * Math.min(Math.abs(x0), 0.79), q = (t - 0.8) / 0.2;
  return out.set(x0 + (xb - x0) * q, y0 + (yb - y0) * q, out.z - r);
}
// covers thrown back: folded over on themselves in a heap toward the foot, pushed to the +x side
function heapPt(sx, t, out) {
  const rf = 0.05, A = 0.74, arc = PI * rf, s = t * (A + arc + 0.62);
  let z, y, layer;
  if (s < A) { z = BL1 - s; y = 0; layer = 0; }
  else if (s < A + arc) { const a = (s - A) / rf; z = BL1 - A - rf * Math.sin(a); y = rf - rf * Math.cos(a); layer = a / PI; }
  else { z = BL1 - A + (s - A - arc); y = 2 * rf; layer = 1; }
  const shift = 0.12 + 0.12 * layer, [x0, yx] = drape(sx + shift, BW), x = x0 + (yx < -BR ? Math.sign(x0) * 0.015 * layer : 0);
  const n = (0.035 * Math.sin(x * 5 + z * 7) * Math.sin(z * 3 - x * 4) + 0.02 * Math.sin(x * 11 - z * 8)) * (0.4 + layer) + 0.07 * layer * Math.exp(-((x - 0.25) ** 2 + (z - 0.25) ** 2) / 0.03);
  const hang = yx < -0.08 ? 0.018 * Math.sin(z * 14 + x * 3) : 0;
  return out.set(x + hang * Math.sign(x), y + yx + (yx < -0.02 ? 0.3 : 1) * n, z);
}
// the sleeper's shoulders under the covers, running into the blanket mound at its head edge
const LUMPW = [[-1.58, 0], [-1.52, 0.2], [-1.42, 0.25], [-1.2, 0.24], [-1.0, 0.21], [-0.88, 0.18]];
const LUMPH = [[-1.58, 0], [-1.52, 0.1], [-1.42, 0.15], [-1.2, 0.15], [-1.05, 0.13], [-0.88, 0.09]];

function bedroomParts() {
  return G('bedroom', () => {
    const P = {};
    // painted trim: skirting, cornice, window casing and sill, door casing, switch plates
    const trim = [];
    const run = (x0, z0, x1, z1, y, h, d) => { const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), L = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0); trim.push(alongX ? bbox(cx, y, cz, L, h, d) : bbox(cx, y, cz, d, h, L)); };
    const wallRun = (y, h, d, inset) => {
      run(-2.5, -2 + inset, 2.5, -2 + inset, y, h, d); run(-2.5, 4 - inset, 2.5, 4 - inset, y, h, d); run(-2.5 + inset, -2, -2.5 + inset, 4, y, h, d);
      if (y < 1) { run(2.5 - inset, -2, 2.5 - inset, 2.09, y, h, d); run(2.5 - inset, 3.11, 2.5 - inset, 4, y, h, d); } else run(2.5 - inset, -2, 2.5 - inset, 4, y, h, d);
    };
    wallRun(0.05, 0.1, 0.018, 0.009); wallRun(0.104, 0.012, 0.026, 0.013); wallRun(2.575, 0.05, 0.03, 0.015); wallRun(2.54, 0.02, 0.018, 0.009);
    // window (on the x=-2.5 wall, centred z=0.4, y=1.45)
    trim.push(bbox(-2.475, 2.145, 0.4, 0.05, 0.09, 1.5), bbox(-2.415, 0.765, 0.4, 0.17, 0.04, 1.62), bbox(-2.485, 0.705, 0.4, 0.03, 0.08, 1.4));
    for (const dz of [-0.705, 0.705]) trim.push(bbox(-2.475, 1.45, 0.4 + dz, 0.05, 1.42, 0.09));
    for (const dy of [-0.66, 0.66]) trim.push(bbox(-2.47, 1.45 + dy, 0.4, 0.03, 0.04, 1.32));
    for (const dz of [-0.66, 0.66]) trim.push(bbox(-2.47, 1.45, 0.4 + dz, 0.03, 1.32, 0.04));
    trim.push(bbox(-2.465, 1.45, 0.4, 0.03, 1.3, 0.03), bbox(-2.465, 1.45, 0.4, 0.03, 0.03, 1.3));
    // door casing (x=2.5 wall, centred z=2.6) and the light switch, socket
    for (const dz of [-0.47, 0.47]) trim.push(bbox(2.485, 1.05, 2.6 + dz, 0.03, 2.1, 0.08));
    trim.push(bbox(2.485, 2.06, 2.6, 0.03, 0.08, 1.02), bbox(2.496, 1.3, 2.0, 0.008, 0.12, 0.075), bbox(1.6, 0.3, -1.996, 0.07, 0.11, 0.008));
    P.trim = merge(trim, true);
    // dark wood: bed frame, nightstand, dresser, picture frame
    const wood = [
      bbox(-0.835, 0.27, -0.86, 0.05, 0.14, 2.12), bbox(0.835, 0.27, -0.86, 0.05, 0.14, 2.12), bbox(0, 0.43, 0.26, 1.62, 0.3, 0.035), bbox(0, 0.82, -1.96, 1.63, 0.62, 0.035),
      seg([-0.85, 1.14, -1.955], [0.85, 1.14, -1.955], 0.03, 0.03, 10),
    ];
    for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) wood.push(bbox(x, 0.82, -1.938, 0.06, 0.5, 0.012));
    for (const s of [-1, 1]) wood.push([turnedPost(1.24), M(s * 0.85, 0, -1.955)], ball(s * 0.85, 1.24, -1.955, 0.034, 0.04, 0.034, 10, 8), [turnedPost(0.7), M(s * 0.85, 0, 0.26)], ball(s * 0.85, 0.7, 0.26, 0.032, 0.036, 0.032, 10, 8));
    // nightstand: back flush to the head wall (z=-2), beside the bed, drawer facing the room
    wood.push(bbox(1.17, 0.535, -1.74, 0.5, 0.03, 0.52), bbox(1.17, 0.31, -1.75, 0.46, 0.42, 0.48), bbox(1.17, 0.43, -1.502, 0.4, 0.14, 0.016));
    for (const dx of [-0.2, 0.2]) for (const dz of [-0.2, 0.2]) wood.push(bbox(1.17 + dx, 0.05, -1.75 + dz, 0.04, 0.1, 0.04));
    // and its twin on the other side
    wood.push(bbox(-1.17, 0.535, -1.74, 0.5, 0.03, 0.52), bbox(-1.17, 0.31, -1.75, 0.46, 0.42, 0.48), bbox(-1.17, 0.43, -1.502, 0.4, 0.14, 0.016));
    for (const dx of [-0.2, 0.2]) for (const dz of [-0.2, 0.2]) wood.push(bbox(-1.17 + dx, 0.05, -1.75 + dz, 0.04, 0.1, 0.04));
    wood.push(bbox(-1.7, 0.47, 3.72, 1.06, 0.82, 0.46), bbox(-1.7, 0.895, 3.72, 1.12, 0.03, 0.5), bbox(-1.7, 0.03, 3.72, 1.02, 0.06, 0.42));
    // top drawers: the left one shut, the right one pulled out 12 cm (sides showing, dark inside, a sock hanging over the front)
    wood.push(bbox(-1.958, 0.76, 3.482, 0.505, 0.2, 0.016), bbox(-1.442, 0.76, 3.362, 0.505, 0.2, 0.016));
    for (const dx of [-0.226, 0.226]) wood.push(bbox(-1.442 + dx, 0.765, 3.43, 0.012, 0.16, 0.13));
    wood.push(bbox(-1.442, 0.69, 3.43, 0.46, 0.01, 0.13));
    for (const y of [0.53, 0.28]) wood.push(bbox(-1.7, y, 3.482, 1.02, 0.24, 0.016));
    wood.push(bbox(0, 1.725, -1.983, 0.66, 0.05, 0.034), bbox(0, 1.295, -1.983, 0.66, 0.05, 0.034), bbox(-0.305, 1.51, -1.983, 0.05, 0.38, 0.034), bbox(0.305, 1.51, -1.983, 0.05, 0.38, 0.034));
    P.wood = merge(wood, true);
    // door leaf with raised panels
    const door = [bbox(2.475, 1.01, 2.6, 0.04, 2.02, 0.86)];
    for (const dz of [-0.19, 0.19]) door.push(bbox(2.45, 1.55, 2.6 + dz, 0.012, 0.62, 0.3), bbox(2.45, 0.55, 2.6 + dz, 0.012, 0.72, 0.3));
    P.door = merge(door, true);
    // metal: knobs, handle, curtain rod, lamp stem, light fitting rim
    const metal = [ball(1.17, 0.43, -1.488, 0.014), ball(-1.17, 0.43, -1.488, 0.014), seg([2.455, 1.0, 2.92], [2.44, 1.0, 2.92], 0.026, 0.026, 12), ball(2.44, 1.0, 2.92, 0.026, 0.026, 0.01, 10, 6, 0, PI / 2, 0), bbox(2.428, 1.0, 2.88, 0.012, 0.014, 0.11), bbox(2.452, 0.9, 2.92, 0.006, 0.05, 0.025),
      seg([-2.4, 2.22, -0.85], [-2.4, 2.22, 1.65], 0.012, 0.012, 8), ball(-2.4, 2.22, -0.87, 0.03), ball(-2.4, 2.22, 1.67, 0.03), bbox(-2.45, 2.22, -0.7, 0.1, 0.02, 0.02), bbox(-2.45, 2.22, 1.5, 0.1, 0.02, 0.02),
      seg([1.3, 0.71, -1.86], [1.3, 0.86, -1.86], 0.006, 0.006, 6), seg([0, 2.585, 1], [0, 2.6, 1], 0.185, 0.185, 24), bbox(-2.45, 1.45, 0.4, 0.02, 0.04, 0.06)];
    // bar handles: a rod on two posts, standing 2 cm off each drawer front
    const handle = (x, y, z, w) => { metal.push(seg([x - w / 2, y, z - 0.022], [x + w / 2, y, z - 0.022], 0.0055, 0.0055, 10), ball(x - w / 2, y, z - 0.022, 0.0058, 0.0058, 0.0058, 8, 6), ball(x + w / 2, y, z - 0.022, 0.0058, 0.0058, 0.0058, 8, 6));
      for (const s of [-1, 1]) metal.push(seg([x + s * w * 0.42, y, z], [x + s * w * 0.42, y, z - 0.022], 0.004, 0.004, 8), seg([x + s * w * 0.42, y, z], [x + s * w * 0.42, y, z - 0.002], 0.009, 0.009, 12)); };
    handle(-1.958, 0.76, 3.474, 0.11); handle(-1.442, 0.76, 3.354, 0.11);
    for (const y of [0.53, 0.28]) for (const dx of [-0.26, 0.26]) handle(-1.7 + dx, y, 3.474, 0.13);
    P.metal = merge(metal);
    // small coloured props in one draw call
    const props = [bbox(1.17, 0.22, -1.508, 0.4, 0.16, 0.01, 0, 0, 0, 0x120c08), bbox(-1.17, 0.22, -1.508, 0.4, 0.16, 0.01, 0, 0, 0, 0x120c08),
      // the other nightstand: a paperback and a phone lying face down
      bbox(-1.06, 0.5615, -1.66, 0.118, 0.023, 0.178, 0, 0.32, 0, 0x2c4a7a), bbox(-1.06, 0.5615, -1.66, 0.11, 0.019, 0.181, 0, 0.32, 0, 0xe6dcc6), bbox(-1.3, 0.5545, -1.6, 0.072, 0.009, 0.148, 0, -0.35, 0, 0x16161a), bbox(-1.31, 0.5605, -1.645, 0.022, 0.003, 0.03, 0, -0.35, 0, 0x2c2c32), bbox(1.32, 0.565, -1.63, 0.16, 0.025, 0.2, 0, 0, 0, 0x6a2a2a), bbox(1.32, 0.588, -1.635, 0.15, 0.02, 0.19, 0, 0.1, 0, 0x2a4a6a),
      bbox(2.49, 1.3, 2.0, 0.012, 0.025, 0.012, 0, 0, 0, 0xd0ccc4), bbox(1.585, 0.3, -1.991, 0.004, 0.022, 0.006, 0, 0, 0, 0x101010), bbox(1.615, 0.3, -1.991, 0.004, 0.022, 0.006, 0, 0, 0, 0x101010)];
    [0x6a2a2a, 0x2a4a6a, 0x8a7a3a, 0x3a5a3a].forEach((c, i) => props.push(bbox(-2.13 + i * 0.065, 1.02 - (i % 2) * 0.015, 3.8, 0.06, 0.22 - (i % 2) * 0.03, 0.16, 0, 0, 0, c)));
    const rocket = lathe([[0, 0], [0.03, 0.02], [0.032, 0.12], [0.022, 0.19], [0, 0.24]], 12);
    props.push([rocket, M(-1.32, 0.91, 3.72), 0xe8e8e8], ball(-1.32, 1.04, 3.75, 0.009, 0.009, 0.006, 8, 6, 0, 0, 0), [rocket, M(-1.32, 1.1, 3.72, 0, 0, 0, 0.62, 0.22, 0.62), 0xc0283c]);
    props[props.length - 2].push(0x4a8ad8);
    for (let i = 0; i < 3; i++) { const a = i * TAU / 3; props.push(bbox(-1.32 + Math.sin(a) * 0.035, 0.94, 3.72 + Math.cos(a) * 0.035, 0.004, 0.06, 0.04, 0, a, 0, 0xc0283c)); }
    const cup = lathe([[0.03, 0], [0.034, 0.01], [0.036, 0.09], [0.032, 0.09], [0.03, 0.012], [0, 0.012]], 14);
    props.push([cup, M(-1.85, 0.91, 3.62), 0xd8d2c0]);
    props.push(bbox(-1.55, 1.01, 3.85, 0.16, 0.2, 0.015, -0.2, 0.15, 0, 0x3a2a20), bbox(-1.55, 1.01, 3.842, 0.12, 0.16, 0.002, -0.2, 0.15, 0, 0xb8c4c8));
    for (const [y, z] of [[1.81, 0.53], [1.81, 0.97], [1.1, 0.53], [1.1, 0.97]]) props.push(ball(2.484, y, z, 0.006, 0.006, 0.006, 6, 4, 0, 0, 0));
    props[props.length - 1].push(0xc0283c); props[props.length - 2].push(0x2a7ad8); props[props.length - 3].push(0xd8c040); props[props.length - 4].push(0x3aa060);
    P.props = merge(props);
    // soft things
    P.mattress = merge([[roundedBox(1.6, 0.24, 2.08, 0.05, 4), M(0, 0.43, -0.86)]]);
    P.base = merge([bbox(0, 0.245, -0.86, 1.62, 0.13, 2.1)]);
    const pillow = sculpt(20, 12, (nx, ny, nz, o) => {
      const e = (a) => Math.sign(a) * Math.pow(Math.abs(a), 0.45);
      const x = e(nx) * 0.34, z = e(nz) * 0.21, c = Math.pow(Math.abs(x / 0.34), 3) + Math.pow(Math.abs(z / 0.21), 3);
      let y = e(ny) * 0.075 * (1 - 0.45 * Math.min(1, c * 0.6));
      if (ny > 0) y -= 0.03 * Math.exp(-((x / 0.15) ** 2 + (z / 0.1) ** 2));
      return o.set(x, y, z);
    });
    // made bed: the sleeper's pillow in the middle, a second smaller one lying flat beside it
    P.pillows = merge([[pillow, M(0.04, 0.62, -1.68, 0, 0.03, 0)], [pillow, M(-0.54, 0.618, -1.71, 0, -0.04, 0, 0.78)]]);
    P.pillowsMess = merge([[pillow, M(0.16, 0.625, -1.6, 0.06, 0.42, -0.08)], [pillow, M(-0.42, 0.68, -1.78, -0.7, -0.25, 0.12, 0.92)]]);
    // the bottom sheet, creased, with the hollow where someone lay (only shown once the bed is messed)
    P.sheet = grid(30, 40, (u, v, o) => {
      const x = (u - 0.5) * 1.52, z = -1.86 + v * 1.98;
      const y = 0.556 + 0.005 * Math.sin(x * 9 + z * 4) * Math.sin(z * 7 - x * 3) + 0.008 * Math.exp(-Math.pow((x * 0.7 - z * 0.5 - 0.35) / 0.03, 2)) + 0.006 * Math.exp(-Math.pow((x * 0.4 + z * 0.9 + 0.6) / 0.025, 2))
        - 0.008 * Math.exp(-((x + 0.05) ** 2) / 0.05) * smooth(-1.55, -1.3, z) * (1 - smooth(-0.1, 0.1, z));
      return o.set(x, y, z);
    }, true);
    const curtain = (z0, z1, ph) => grid(36, 10, (u, v, o) => {
      const amp = 0.022 + 0.025 * v;
      return o.set(-2.445 + amp * (0.8 * Math.sin(u * TAU * 4.5 + ph) + 0.2 * Math.sin(u * TAU * 9 + 1)) + amp, 2.2 - v * 1.4, z0 + (z1 - z0) * u + 0.012 * Math.sin(u * TAU * 4.5 + ph + PI / 2) * v);
    });
    P.curtains = merge([[curtain(-0.75, -0.08, 0)], [curtain(0.86, 1.55, 1.3)]]);
    P.glass = merge([[lathe([[0.03, 0], [0.033, 0.11], [0.031, 0.11], [0.028, 0.004], [0, 0.004]], 16), M(-1.3, 0.55, -1.84), 0xd8e8f0], [lathe([[0, 0.004], [0.0275, 0.004], [0.0295, 0.075], [0, 0.075]], 16), M(-1.3, 0.55, -1.84), 0x9cc0d4]]);
    { const cw = [], c0 = new THREE.Vector3(2.49, 2.59, -1.99); for (let i = 0; i < 6; i++) { const a = i / 5 * PI / 2; cw.push(c0.x, c0.y, c0.z, c0.x - Math.cos(a) * 0.32, c0.y - (i % 3) * 0.03, c0.z + Math.sin(a) * 0.32); } for (const rr0 of [0.09, 0.17, 0.25]) for (let i = 0; i < 5; i++) { const a0 = i / 5 * PI / 2, a1 = (i + 1) / 5 * PI / 2; cw.push(c0.x - Math.cos(a0) * rr0, c0.y - 0.01, c0.z + Math.sin(a0) * rr0, c0.x - Math.cos(a1) * rr0 * 0.94, c0.y - 0.012, c0.z + Math.sin(a1) * rr0 * 0.94); }
      P.cobweb = new THREE.BufferGeometry(); P.cobweb.setAttribute('position', new THREE.Float32BufferAttribute(cw, 3)); }
    P.shade = lathe([[0.13, 0], [0.085, 0.17]], 24);
    P.lampBase = lathe([[0, 0], [0.055, 0], [0.065, 0.04], [0.06, 0.1], [0.03, 0.15], [0.012, 0.17]], 16);
    P.dome = lathe([[0, -0.1], [0.11, -0.08], [0.16, -0.04], [0.17, 0]], 20);
    // blanket, its turned-down sheet, and the sleeper beneath it
    P.blanket = grid(116, 112, (u, v, o) => blanketPt((u - 0.5) * 2 * (BW + 0.36), BL0 + v * (BL1 - BL0 + 0.16), o), true);
    P.band = grid(116, 14, (u, v, o) => bandPt((u - 0.5) * 2 * (BW + 0.36), v, o), true);
    P.heap = grid(44, 40, (u, v, o) => heapPt((u - 0.5) * 2 * (BW + 0.36), v, o), true);
    P.lump = grid(20, 16, (u, v, o) => {
      const z = -1.58 + v * 0.7, w = Math.max(0, profileAt(LUMPW, z)), h = Math.max(0, profileAt(LUMPH, z)), a = PI * (1 - u);
      return o.set(Math.cos(a) * w, 0.575 + Math.max(0, Math.sin(a)) * h, z);
    }, true);
    // the sleeper's head on the pillow, chin a little down toward the chest, face turned slightly toward the room; the neck
    // runs down from it to the pyjama collar of the sleeping body (makePlayerBody, layInBed) under the covers
    const H = humanParts(), hm = M(0, 0.745, -1.655, -PI / 2 + 0.3, 0.28, 0);
    P.sleeperSkin = merge([[H.head, hm], [H.neck, hm.clone().multiply(M(0, -0.17, 0.0, 0.25, 0, 0, 1, 1.5, 1))]]);
    P.sleeperHair = H.hair.clone().applyMatrix4(hm);
    P.sleeperFace = merge([[H.closed, hm], [H.mouth, hm]]);
    return P;
  });
}

// ---------- the bedroom at night: wallpaper, baked occlusion, moonlight through the window, the view outside ----------
// furniture volumes [x0, x1, y0, y1, z0, z1]: they bake contact shadows into the floor and walls and block the doorway's light
const FURN = [
  [-0.87, 0.87, 0.01, 0.66, -1.98, 0.29],                                         // bed
  [0.92, 1.42, 0.01, 0.56, -1.99, -1.49], [-1.42, -0.92, 0.01, 0.56, -1.99, -1.49], // nightstands
  [-2.23, -1.17, 0.01, 0.92, 3.47, 3.97],                                         // chest of drawers
  [1.92, 2.5, 0.01, 2.06, 3.14, 3.98],                                            // wardrobe
  [1.95, 2.5, 0.3, 0.77, 0.15, 1.35],                                             // desk
  [1.62, 2.08, 0.01, 0.96, 0.52, 0.98],                                           // chair with clothes on it
  [-2.3, -1.9, 0.01, 0.43, 2.2, 2.6],                                             // laundry basket
];
const MOONL = new THREE.Vector3(-1, 0.42, -0.25).normalize();   // from the room toward the moon, out through the window
// linear (non-colour) data textures: occlusion, light masks
const dtex = (key, w, h, draw, wrap) => { let t = texCache.get(key); if (!t) { t = wrapTex(paint(key, w, h, draw), wrap ? [1, 1] : null, false); t.userData.keep = true; texCache.set(key, t); } return t; };
const blurred = (g, px, f) => { g.save(); g.filter = `blur(${px}px)`; f(); g.restore(); };
const shade = (g, x0, y0, x1, y1, a, w, h) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); };

// papered walls, one 53 cm roll width per tile: a trailing ogee trellis of leafy stems with a small flower in each lens,
// printed in two passes slightly out of register on an off-white ground with faint stria (the shader adds the paper)
const wallpaperTex = () => ctex('wallpaper3', 1024, 1024, (g, w, h) => {
  seed(23); g.fillStyle = '#ece7dd'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += rr(2, 6)) { g.fillStyle = `rgba(120,110,95,${rr(0.008, 0.03)})`; g.fillRect(x, 0, rr(1, 2.5), h); }
  const all = (f) => { for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { g.save(); g.translate(ox, oy); f(); g.restore(); } };
  const P = 512, A = 128, X = (k, d, y) => k * 256 + d * A * Math.sin(2 * PI * y / P);
  const stems = (lw, col, dx, dy) => { g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round';
    for (let k = 0; k <= 4; k++) for (const d of [-1, 1]) { g.beginPath(); for (let y = 0; y <= h; y += 4) { const x = X(k, d, y) + dx; y ? g.lineTo(x, y + dy) : g.moveTo(x, y + dy); } g.stroke(); } };
  const leaf = (x, y, a, L, col) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = col; g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(L * 0.25, -L * 0.42, L * 0.75, -L * 0.36, L, 0); g.bezierCurveTo(L * 0.75, L * 0.36, L * 0.25, L * 0.42, 0, 0); g.fill();
    g.strokeStyle = 'rgba(236,231,221,.35)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(L * 0.1, 0); g.lineTo(L * 0.85, 0); g.stroke(); g.restore(); };
  const leaves = (col, dx, dy) => { for (let k = 0; k <= 4; k++) for (const d of [-1, 1]) for (let y = 40; y < h; y += 64) {
    const x = X(k, d, y), t = Math.atan2(4, X(k, d, y + 4) - x), side = ((y / 64) | 0) % 2 ? 1 : -1;
    leaf(x + dx, y + dy, t + side * 0.6, 40, col); } };
  const flower = (cx, cy, col, mid) => { for (let i = 0; i < 5; i++) { const q = i / 5 * TAU - PI / 2; g.fillStyle = col; g.beginPath(); g.ellipse(cx + Math.cos(q) * 14, cy + Math.sin(q) * 14, 13, 11, q, 0, TAU); g.fill(); }
    g.fillStyle = mid; g.beginPath(); g.arc(cx, cy, 6, 0, TAU); g.fill(); };
  all(() => {
    // first pass: the dark key, a little off register
    stems(7, 'rgba(70,72,58,.15)', 2, 1.5); leaves('rgba(70,72,58,.14)', 2, 1.5);
    // second pass: sage stems and leaves, dusty rose flowers, a bead where the stems touch
    stems(3.5, 'rgba(118,124,98,.58)', 0, 0); leaves('rgba(128,136,106,.55)', 0, 0);
    for (let k = 0; k <= 4; k++) for (let n = 0; n < 2; n++) {
      const cx = k * 256, cy = 128 + n * 256;
      for (const s of [-1, 1]) leaf(cx, cy + 6, PI / 2 + s * 0.7, 46, 'rgba(118,128,98,.55)');
      flower(cx + 1.5, cy + 1, 'rgba(90,70,64,.14)', 'rgba(0,0,0,0)'); flower(cx, cy, 'rgba(176,138,128,.72)', 'rgba(140,112,70,.85)');
      g.fillStyle = 'rgba(150,120,82,.7)'; g.beginPath(); g.arc(cx + 128, cy, 4.5, 0, TAU); g.fill();
    }
  });
  for (let i = 0; i < 14000; i++) { g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,.03)' : 'rgba(255,255,255,.05)'; g.fillRect(rr(0, w), rr(0, h), 1.5, 1.5); }
});
// baked occlusion for one wall (W metres wide, canvas top = ceiling): into the floor, the cornice and the corners,
// behind furniture standing against it ([u0, u1, height, darkness], u in metres from the wall's left end seen from the room)
const wallAO = (key, W, items, extra) => dtex(key, 512, 256, (g, w, h) => {
  const sx = w / W, sy = h / 2.6;
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  shade(g, 0, h, 0, h - 0.4 * sy, 0.55, w, h); shade(g, 0, 0, 0, 0.2 * sy, 0.4, w, h); shade(g, 0, 0, 0.35 * sx, 0, 0.45, w, h); shade(g, w, 0, w - 0.35 * sx, 0, 0.45, w, h);
  blurred(g, 9, () => { for (const [u0, u1, hgt, a] of items) { g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(u0 * sx, h - hgt * sy, (u1 - u0) * sx, hgt * sy); } });
  if (extra) { seed(key.length * 31); extra(g, sx, sy, w, h); }
});
const scuffs = (u0, u1) => (g, sx, sy, w, h) => {
  for (let i = 0; i < 26; i++) { const u = rr(u0, u1), y = h - rr(0.12, 0.4) * sy; g.strokeStyle = `rgba(0,0,0,${rr(0.08, 0.2)})`; g.lineWidth = rr(0.6, 1.6); g.beginPath(); g.moveTo(u * sx, y); g.lineTo(u * sx + rr(4, 14), y + rr(-2, 2)); g.stroke(); }
};
const aoHead = () => wallAO('aoHead', 5, [[3.42, 3.92, 0.6, 0.55], [1.08, 1.58, 0.6, 0.55], [1.63, 3.37, 1.25, 0.3], [1.63, 3.37, 0.65, 0.5]], scuffs(0.2, 4.8));
const aoFar = () => wallAO('aoFar', 5, [[3.67, 4.73, 0.95, 0.5], [0, 0.6, 2.1, 0.55]], scuffs(0.6, 3.6));
const aoWin = () => wallAO('aoWin', 6, [[0.03, 0.53, 0.9, 0.25], [1.4, 1.8, 0.45, 0.35], [3.15, 4.05, 0.68, 0.3]], scuffs(0.2, 5.8));
const aoDoor = () => wallAO('aoDoor', 6, [[5.14, 5.98, 2.1, 0.55], [2.15, 3.35, 0.8, 0.4], [3.6, 3.95, 0.32, 0.35]], (g, sx, sy, w, h) => {
  scuffs(0.2, 4.0)(g, sx, sy, w, h);
  // grubby fingermarks round the light switch (z 2.0, 1.3 m up)
  blurred(g, 3, () => { for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(0,0,0,${rr(0.05, 0.14)})`; g.beginPath(); g.ellipse((4.0 + rr(-0.12, 0.12)) * sx, h - (1.3 + rr(-0.12, 0.14)) * sy, rr(2, 5), rr(2, 4), rr(0, 3), 0, TAU); g.fill(); } });
});
// floor occlusion (canvas x = world x -2.5..2.5, canvas y = world z -2..4): edges, every footprint, deep under the bed
const floorAO = () => dtex('floorAO', 512, 616, (g, w, h) => {
  const X = (x) => (x + 2.5) / 5 * w, Z = (z) => (z + 2) / 6 * h, s = w / 5;
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  shade(g, 0, 0, 0.35 * s, 0, 0.5, w, h); shade(g, w, 0, w - 0.35 * s, 0, 0.5, w, h); shade(g, 0, 0, 0, 0.35 * s, 0.5, w, h); shade(g, 0, h, 0, h - 0.35 * s, 0.5, w, h);
  blurred(g, 12, () => { for (const [x0, x1, , , z0, z1] of FURN) { g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(X(x0) - 4, Z(z0) - 4, X(x1) - X(x0) + 8, Z(z1) - Z(z0) + 8); } });
  blurred(g, 5, () => {
    g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(X(-0.8), Z(-1.9), X(0.8) - X(-0.8), Z(0.2) - Z(-1.9));
    g.fillStyle = 'rgba(0,0,0,.4)';
    g.fillRect(X(-2.48), Z(-0.05), X(-2.36) - X(-2.48), Z(0.85) - Z(-0.05));          // radiator
    g.beginPath(); g.ellipse(X(2.17), Z(1.78), 0.2 * s, 0.13 * s, 0.3, 0, TAU); g.fill();   // bag
    for (const [x, z] of [[1.55, 1.55], [1.7, 1.68]]) { g.beginPath(); g.ellipse(X(x), Z(z), 0.06 * s, 0.14 * s, 0.3, 0, TAU); g.fill(); }
  });
});
// the window as the moon draws it on the room: panes, glazing bars, the parted curtains (canvas covers z -0.45..1.25, y 0.7..2.2)
const moonCookie = () => dtex('moonCookie', 512, 512, (g, w, h) => {
  const X = (z) => (z + 0.45) / 1.7 * w, Y = (y) => (2.2 - y) / 1.5 * h;
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  blurred(g, 3, () => {
    g.fillStyle = '#fff'; g.fillRect(X(-0.245), Y(2.095), X(1.045) - X(-0.245), Y(0.805) - Y(2.095));
    g.fillStyle = '#000'; g.fillRect(X(0.385), 0, X(0.415) - X(0.385), h); g.fillRect(0, Y(1.47), w, Y(1.43) - Y(1.47));
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, Y(0.86), w, Y(0.805) - Y(0.86));
    // the curtains, heavy cloth with a little light through the folds
    for (const [z0, z1, dir] of [[-0.5, -0.08, 1], [0.86, 1.3, -1]]) {
      g.fillStyle = 'rgba(0,0,0,.88)'; g.beginPath(); const e = dir > 0 ? z1 : z0;
      g.moveTo(X(dir > 0 ? z0 : z1), 0); for (let y = 0; y <= h; y += 8) g.lineTo(X(e + 0.025 * Math.sin(y * 0.05)), y); g.lineTo(X(dir > 0 ? z0 : z1), h); g.fill();
    }
  });
});
// bare branches of the tree outside, for the moving shadow (tiles; sampled further out than the window so it shifts and blurs)
const moonBranch = () => { const t = dtex('moonBranch', 512, 512, (g, w, h) => {
  seed(211); g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  blurred(g, 4, () => {
    g.strokeStyle = '#fff'; g.lineCap = 'round';
    const br = (x, y, a, len, wd, d) => { if (d > 6 || len < 6) return; const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; g.lineWidth = wd; for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo((x + x2) / 2 + ox + rr(-8, 8), (y + y2) / 2 + oy + rr(-8, 8), x2 + ox, y2 + oy); g.stroke(); } br(x2, y2, a - rr(0.25, 0.6), len * rr(0.6, 0.78), wd * 0.68, d + 1); br(x2, y2, a + rr(0.2, 0.55), len * rr(0.6, 0.78), wd * 0.68, d + 1); };
    br(380, 512, -PI / 2 - 0.4, 150, 22, 0); br(80, 380, -0.5, 120, 14, 1);
  });
}, true); return t; };
// a smudged pane: faint wipe marks and a streak, added on top of the view out
const paneTex = () => ctex('paneSmudge', 256, 256, (g, w, h) => {
  seed(221); g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  blurred(g, 6, () => { for (let i = 0; i < 8; i++) { g.strokeStyle = `rgba(255,255,255,${rr(0.05, 0.12)})`; g.lineWidth = rr(6, 18); g.beginPath(); g.arc(rr(40, 220), rr(60, 240), rr(30, 70), rr(0, 3), rr(3.5, 6)); g.stroke(); } });
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0.35, 'rgba(255,255,255,0)'); gr.addColorStop(0.45, 'rgba(255,255,255,.18)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
// sky: brighter toward the horizon with the town's glow (multiplied by R.glass colour)
const skyGradTex = () => ctex('skyGrad', 8, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#6c7898'); gr.addColorStop(0.5, '#b8c2da'); gr.addColorStop(0.68, '#fff2e4'); gr.addColorStop(1, '#fff2e4'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
// silhouettes: neighbouring roofs (top half; plane z -20..40, y -10..12) and a far tree line (bottom half; z -30..70, y -10..14)
const nightAtlas = () => ctex('nightAtlas', 1024, 1024, (g) => {
  seed(201); g.clearRect(0, 0, 1024, 1024); g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  const RX = (z) => (z + 20) / 60 * 1024, RY = (y) => (12 - y) / 22 * 512;
  g.beginPath(); g.moveTo(0, 512);
  for (const [z0, z1, e, r] of [[-20, -12, 3.2, 5.2], [-11.5, -2, 2.8, 4.6], [-1.5, 8.5, 3.0, 5.6], [9.5, 15, 2.6, 4.1], [16, 27, 3.1, 6.0], [28, 40, 2.7, 4.8]]) { g.lineTo(RX(z0), RY(e)); g.lineTo(RX(z0 + 0.3), RY(e)); g.lineTo(RX((z0 + z1) / 2), RY(r)); g.lineTo(RX(z1 - 0.3), RY(e)); g.lineTo(RX(z1), RY(e)); }
  g.lineTo(1024, 512); g.closePath(); g.fill();
  for (const [z, top, wd] of [[5.5, 6.5, 0.7], [21.5, 6.9, 0.8], [-6, 5.1, 0.5], [34, 5.6, 0.6]]) { g.fillRect(RX(z - wd / 2), RY(top), RX(wd) - RX(0), RY(3.5) - RY(top)); g.fillRect(RX(z - wd / 2 - 0.08), RY(top), RX(wd + 0.16) - RX(0), 4); }
  g.lineWidth = 2; g.beginPath(); g.moveTo(RX(12.5), RY(4.0)); g.lineTo(RX(12.5), RY(6.4)); for (const [y, l] of [[6.2, 0.9], [5.8, 0.7], [5.4, 0.5]]) { g.moveTo(RX(12.5 - l / 2), RY(y)); g.lineTo(RX(12.5 + l / 2), RY(y)); } g.stroke();
  g.save(); g.beginPath(); g.rect(0, 512, 1024, 512); g.clip();
  const TX = (z) => (z + 30) / 100 * 1024, TY = (y) => 512 + (14 - y) / 24 * 512;
  g.fillRect(0, TY(3.2), 1024, 1024 - TY(3.2));
  for (let i = 0; i < 90; i++) { const z = rr(-30, 70), top = rr(4.5, 9), r = rr(1, 2.6); for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(TX(z + rr(-r, r)), TY(top - rr(0, r * 1.6)), (r * rr(0.4, 0.8)) / 100 * 1024, 0, TAU); g.fill(); } g.fillRect(TX(z) - 2, TY(top - r), 4, TY(2) - TY(top - r)); }
  g.lineCap = 'round';
  const br = (x, y, a, len, wd, d) => { if (d > 5 || len < 3) return; const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; g.lineWidth = wd; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke(); br(x2, y2, a - rr(0.2, 0.5), len * 0.72, wd * 0.7, d + 1); br(x2, y2, a + rr(0.2, 0.5), len * 0.72, wd * 0.7, d + 1); };
  for (let i = 0; i < 9; i++) br(TX(rr(-25, 65)), TY(3.5), -PI / 2 + rr(-0.15, 0.15), rr(30, 55), rr(4, 7), 0);
  g.restore();
});
// the bare tree in the garden, close enough to show its twigs (plane z -6..14, y -6..10)
const nearTreeTex = () => ctex('nearTree', 1024, 1024, (g) => {
  seed(231); g.clearRect(0, 0, 1024, 1024); g.strokeStyle = g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  const NX = (z) => (z + 6) / 20 * 1024, NY = (y) => (10 - y) / 16 * 1024;
  const br = (x, y, a, len, wd, d) => {
    if (d > 8 || len < 4) return;
    let px = x, py = y, aa = a; g.lineWidth = wd; g.beginPath(); g.moveTo(px, py);
    for (let k = 0; k < 4; k++) { aa += rr(-0.18, 0.18); px += Math.cos(aa) * len / 4; py += Math.sin(aa) * len / 4; g.lineTo(px, py); }
    g.stroke();
    const n = d < 2 ? 3 : 2; for (let i = 0; i < n; i++) br(px, py, aa + rr(-0.75, 0.75), len * rr(0.55, 0.75), Math.max(1, wd * 0.62), d + 1);
  };
  g.lineWidth = 34; g.beginPath(); g.moveTo(NX(7.2), 1024); g.quadraticCurveTo(NX(6.6), NY(-1), NX(7.0), NY(1.8)); g.stroke();
  br(NX(7.0), NY(1.8), -PI / 2 - 0.9, 230, 22, 0); br(NX(7.0), NY(1.8), -PI / 2 + 0.2, 200, 20, 0); br(NX(7.0), NY(0.6), PI + 0.35, 210, 16, 1); br(NX(6.9), NY(1.2), -PI / 2 - 0.4, 260, 14, 1);
  g.fillRect(0, NY(-1.6), 1024, 6); for (let x = 6; x < 1024; x += 26) g.fillRect(x, NY(-1.15), 8, NY(-2.4) - NY(-1.15));   // garden fence
});
const SKYX_V = `varying vec2 vP; void main() { vP = (modelMatrix * vec4(position, 1.0)).zy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKYX_F = `
uniform float uNight, uTime;
varying vec2 vP;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  vec2 p = vP;
  vec2 c = floor(p * 1.6), f = fract(p * 1.6) - 0.5; float r = h21(c);
  vec2 off = vec2(h21(c + 7.1), h21(c + 3.3)) - 0.5;
  float st = smoothstep(0.09, 0.0, length(f - off * 0.7)) * step(0.8, r) * (0.25 + 0.75 * h21(c + 1.7)) * (0.75 + 0.25 * sin(uTime * (1.0 + r * 3.0) + r * 40.0));
  st *= smoothstep(6.0, 14.0, p.y);
  float cl = vn(p * vec2(0.05, 0.12) + vec2(uTime * 0.004, 0.0)) * 0.6 + vn(p * vec2(0.13, 0.3) + vec2(uTime * 0.006, 3.0)) * 0.4;
  cl = smoothstep(0.42, 0.8, cl) * smoothstep(5.0, 16.0, p.y);
  vec2 mp = (p - vec2(-16.0, 25.0)) * 0.035;
  float glow = exp(-dot(mp, mp)) * 0.5;
  vec3 col = vec3(0.75, 0.82, 1.0) * st * (1.0 - cl * 0.85) + vec3(0.22, 0.27, 0.36) * cl * (0.35 + glow * 1.6) + vec3(0.12, 0.16, 0.26) * glow;
  vec2 lp = (p - vec2(13.0, 0.5)) * vec2(0.09, 0.16);
  col += vec3(1.0, 0.52, 0.18) * exp(-dot(lp, lp)) * 0.3;
  gl_FragColor = vec4(col * uNight, 1.0);
}`;
// the doorway's light, blocked by the furniture: a multiply overlay on floor and walls, strength follows portalLight
const PSH_V = `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const PSH_F = `
uniform float uAmt; uniform vec3 uBmin[8]; uniform vec3 uBmax[8];
varying vec3 vW;
float blocked(vec3 o, vec3 L) {
  vec3 d = L - o; float tmax = length(d); d /= tmax; vec3 inv = 1.0 / d; float s = 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 t0 = (uBmin[i] - o) * inv, t1 = (uBmax[i] - o) * inv, tn = min(t0, t1), tf = max(t0, t1);
    float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z);
    s = max(s, step(a, b) * step(0.002, a) * step(a, tmax));
  }
  return s;
}
void main() {
  float sh = (blocked(vW, vec3(0.0, 1.3, 3.55)) + blocked(vW, vec3(-0.6, 0.8, 3.65)) + blocked(vW, vec3(0.6, 0.8, 3.65)) + blocked(vW, vec3(0.0, 2.1, 3.65))) * 0.25;
  vec3 q = vW - vec3(0.0, 1.2, 3.6);
  float k = sh * uAmt * (0.4 + 0.6 / (1.0 + dot(q, q) * 0.06));
  gl_FragColor = vec4(mix(vec3(1.0), vec3(0.16, 0.18, 0.24), k), 1.0);
}`;
// ---------- bedroom surfaces: procedural detail drawn in the shader, in world metres ----------
// Every surface keeps resolving as the camera comes close: each layer of detail fades out (sFade) only once it is finer than
// the pixel, so nothing shimmers at a distance. Heights are in metres and the normal is bent by their true slope (surfBump).
// surf(m, mode, opt) adds it to a standard/physical material; moonify() composes with it. Modes:
//   wood   furniture: flat-sawn rings and pores along aGrain (merge(parts, true) writes the grain direction of each piece)
//   paint  trim, door, radiator: brush lines along aGrain, orange peel, knocks and chips that show the undercoat
//   floor  floorboards in world x/z: staggered boards, own grain and tone each, knots, eased edges and gaps, worn varnish, dust
//   paper  wallpaper: print raised off the paper, fibres, roll seams with each roll a touch off in shade and in register
//   plaster ceiling: textured paint at five scales, roller laps and tramlines
//   cloth  woven fabric in uv space (opt.size metres per uv unit, opt.pitch thread spacing): weave, heathered threads, creases
const SURF_V = `
attribute vec3 aGrain; varying vec3 vSurfP; varying vec3 vSurfG; varying vec2 vSurfUv;`;
const SURF_VMAIN = `
  vSurfP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vSurfG = length(aGrain) > 0.5 ? normalize(mat3(modelMatrix) * aGrain) : vec3(0.0, 1.0, 0.0);
  vSurfUv = uv;`;
const SURF_F = `
varying vec3 vSurfP; varying vec3 vSurfG; varying vec2 vSurfUv;
uniform vec2 uSurfSize; uniform float uSurfPitch;
float sH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float sH3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(sH(i), sH(i + vec2(1.0, 0.0)), f.x), mix(sH(i + vec2(0.0, 1.0)), sH(i + vec2(1.0, 1.0)), f.x), f.y); }
float sN3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sH3(i), sH3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(sH3(i + vec3(0.0, 1.0, 0.0)), sH3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(sH3(i + vec3(0.0, 0.0, 1.0)), sH3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(sH3(i + vec3(0.0, 1.0, 1.0)), sH3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z); }
// 1 while a pattern of f cycles per metre is coarser than the pixel (fw metres), 0 once it would alias
float sFade(float fw, float f) { return 1.0 - smoothstep(0.18, 0.5, fw * f); }
// Mikkelsen's surface-gradient bump with unnormalised derivatives: h in metres gives the true slope at any distance
vec3 surfBump(vec3 sp, vec3 n, float h, float fd) {
  vec3 dpx = dFdx(sp), dpy = dFdy(sp); float hx = dFdx(h), hy = dFdy(h);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx); float det = dot(dpx, r1) * fd;
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  return normalize(abs(det) * n - grad);
}
// flat-sawn wood: growth rings round a log axis running along g, warped; pores along the grain
void surfWood(vec3 P, vec3 g, float fw, inout vec3 alb, inout float rgh, inout float h) {
  float al = dot(P, g); vec3 q = P - g * al;
  vec3 c = vec3(0.31, -0.57, 0.83); c -= g * dot(c, g);
  float r = length(q - c);
  r += 0.014 * (sN(vec2(al * 1.3, r * 4.0)) - 0.5) + 0.004 * (sN(vec2(al * 6.0, r * 22.0)) - 0.5);
  float rf = 240.0, t = fract(r * rf), wR = 1.0 - smoothstep(0.25, 0.6, length(fwidth(r * rf)));
  float late = smoothstep(0.5, 0.88, t) * (1.0 - smoothstep(0.9, 1.0, t));
  float tone = 0.86 + 0.28 * sN(vec2(al * 0.6, r * 7.0));
  float pf = 2200.0, pore = smoothstep(0.62, 0.92, sN(vec2(al * 38.0, r * pf))) * sFade(fw, pf * 0.6);
  float fig = sN(vec2(al * 2.2, r * 60.0));                       // ray fleck / figure, a soft shimmer across the rings
  alb *= tone * mix(0.9, mix(1.0, 0.64, late), wR) * (1.0 - 0.28 * pore) * (0.95 + 0.1 * fig);
  rgh *= mix(1.0, 0.82, late * wR) * (1.0 + 0.35 * pore);
  h += -late * wR * 0.00003 - pore * 0.000025;
}
// gloss paint brushed along g over old coats: bristle lines, stroke loading, orange peel; chips, mostly low down
void surfPaint(vec3 P, vec3 g, vec3 wn, float fw, inout vec3 alb, inout float rgh, inout float h) {
  vec3 b = normalize(cross(g, wn) + vec3(1e-4, 2e-4, 3e-4));
  float al = dot(P, g), ac = dot(P, b);
  float bf = 260.0, wb = sFade(fw, bf);
  float br = sN(vec2(al * 2.5, ac * bf)) * 0.6 + sN(vec2(al * 1.1 + 7.0, ac * bf * 2.3)) * 0.4;
  float load = sN(vec2(al * 0.7, ac * 8.0));
  float peel = sN3(P * 700.0), wp = sFade(fw, 700.0);
  h += (br - 0.5) * 0.00005 * wb * (0.4 + load) + (peel - 0.5) * 0.000012 * wp;
  rgh *= 0.92 + 0.3 * (br - 0.5) * wb + 0.18 * load;
  alb *= 0.95 + 0.07 * sN3(P * 2.5) - 0.035 * load * wb;
  float low = 1.0 - smoothstep(0.12, 0.7, P.y);
  float zone = smoothstep(0.72 - 0.12 * low, 0.86 - 0.12 * low, sN3(P * 3.1 + 5.0));
  float ch = (sN3(P * 38.0) * 0.72 + sN3(P * 170.0) * 0.28) * zone;
  float th = 0.8;
  float chip = smoothstep(th, th + 0.012, ch);
  float rim = smoothstep(th - 0.025, th, ch) * (1.0 - chip);    // grubby lifted edge round a chip
  alb = mix(alb, alb * vec3(0.66, 0.6, 0.5), chip) * (1.0 - 0.18 * rim);
  h += -chip * 0.0003 + rim * 0.00004;
  rgh = mix(rgh, min(1.0, rgh * 1.7), chip);
}
// floorboards, long along x, 12.5 cm wide: each its own length, offset, tone, grain and maybe a knot
void surfFloor(vec3 P, float fw, inout vec3 alb, inout float rgh, inout float h) {
  float W = 0.125, row = floor(P.z / W), lz = P.z - row * W;
  float L = mix(0.95, 2.3, sH(vec2(row, 3.1))), xo = P.x + sH(vec2(row, 7.7)) * L;
  float seg = floor(xo / L), lx = xo - seg * L; vec2 id = vec2(row, seg);
  float k1 = sH(id + 0.5), k2 = sH(id + 17.3), k3 = sH(id + 41.9);
  // the knot first, so the rings can swirl round it
  vec2 kp = vec2((0.15 + 0.7 * fract(k3 * 7.3)) * L, (0.25 + 0.5 * fract(k1 * 13.1)) * W);
  float hasK = step(0.66, fract(k2 * 5.7));
  vec2 kd = vec2((lx - kp.x) * 0.38, lz - kp.y); float kr = length(kd);
  float cz = (k2 - 0.5) * 0.14 + W * 0.5, dep = 0.012 + 0.07 * k3 + (lx - 0.5 * L) * (0.012 + 0.03 * k1) * sign(k2 - 0.5);
  float r = length(vec2(lz - cz, dep)) + hasK * 0.012 * exp(-kr * kr / 0.00012);
  r += 0.006 * (sN(vec2(xo * 1.1 + k1 * 50.0, lz * 12.0)) - 0.5) + 0.0025 * (sN(vec2(xo * 5.0 + k3 * 9.0, lz * 40.0)) - 0.5);
  float rf = 190.0, t = fract(r * rf), wR = 1.0 - smoothstep(0.25, 0.6, length(fwidth(r * rf)));
  float late = smoothstep(0.5, 0.88, t) * (1.0 - smoothstep(0.9, 1.0, t));
  float knot = hasK * (1.0 - smoothstep(0.0035, 0.008, kr));
  float tone = mix(0.7, 1.2, k1) * (0.9 + 0.2 * sN(vec2(xo * 0.8, lz * 6.0 + k2 * 9.0)));
  vec3 hue = mix(vec3(1.0), vec3(1.1, 0.96, 0.84), k2) * mix(vec3(1.0), vec3(0.92, 0.95, 1.02), k3 * k3);
  float pf = 1900.0, pore = smoothstep(0.6, 0.9, sN(vec2(xo * 30.0, lz * pf))) * sFade(fw, pf * 0.6);
  alb *= tone * hue * mix(0.88, mix(1.0, 0.6, late), wR) * (1.0 - 0.24 * pore) * (1.0 - 0.65 * knot);
  // eased edges and the dark gaps between boards (at least a pixel wide, so joints still read from across the room)
  float e = min(min(lz, W - lz), min(lx, L - lx));
  float gap = 1.0 - smoothstep(0.0009 - fw * 0.6, 0.0009 + fw * 0.6, e);
  float ease = 1.0 - smoothstep(0.0, 0.0035, e);
  float wE = 1.0 - smoothstep(0.25, 0.7, fw / 0.0035);
  alb *= 1.0 - 0.72 * gap; h += (-ease * 0.0005 - gap * 0.0004) * wE - late * wR * 0.00002 - pore * 0.00002 - knot * 0.00004;
  // varnish: glossy, worn dull and paler where people walk (door to bedside, round the foot of the bed); fine scratches
  vec2 a = vec2(2.3, 2.5), bb = vec2(0.95, -0.6); vec2 pa = P.xz - a, ba = bb - a;
  float path = exp(-pow(length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) / 0.38, 2.0));
  path = max(path, exp(-pow(length(vec2((P.x - 0.0) / 1.1, (P.z - 0.65) / 0.35)), 2.0)) * 0.7);
  float sc = smoothstep(0.82, 0.96, sN(vec2(P.x * 6.0 + P.z * 1.5, P.z * 420.0 - P.x * 90.0))) * sFade(fw, 420.0);
  rgh = mix(rgh, 0.72, 0.65 * path) + 0.25 * sc + 0.08 * pore; rgh = mix(rgh, 1.0, gap);
  alb *= 1.0 + 0.1 * path;
  // dust: a grey film along the skirting and in under the bed
  float wallD = min(min(P.x + 2.5, 2.5 - P.x), min(P.z + 2.0, 4.0 - P.z));
  float dust = (1.0 - smoothstep(0.0, 0.07, wallD)) * 0.6 + (1.0 - smoothstep(0.0, 0.25, max(abs(P.x) - 0.7, max(-1.95 - P.z, P.z - 0.2)))) * 0.45;
  dust *= 0.6 + 0.4 * sN(P.xz * 23.0);
  alb = mix(alb, vec3(dot(alb, vec3(0.33))) * 1.25 + 0.012, dust * 0.5); rgh = mix(rgh, 0.95, dust);
}
// matt emulsion on plastered walls: fine roller stipple, vertical roller laps with their ridges, a wall that is not quite
// flat (raking light finds it), patchy sheen where it was touched up
void surfEmulsion(vec3 P, float fw, inout vec3 alb, inout float rgh, inout float h) {
  vec3 gn = normalize(cross(dFdx(P), dFdy(P)));
  vec2 p = abs(gn.x) > abs(gn.z) ? P.zy : P.xy;
  float s = 0.0, a = 1.0, f = 70.0;
  for (int i = 0; i < 5; i++) { s += (sN(p * f + float(i) * 11.7) - 0.5) * a * sFade(fw, f); a *= 0.55; f *= 2.3; }
  float lapU = p.x / 0.23 + 0.3 * sN(vec2(p.y * 0.8, p.x * 0.3));
  float lap = sN(vec2(floor(lapU) * 2.7, p.y * 0.6)), edge = smoothstep(0.92, 1.0, fract(lapU)) * (1.0 - smoothstep(0.99, 1.0, fract(lapU)));
  h += s * 0.00018 + edge * 0.00006 + (sN(p * 1.3) - 0.5) * 0.0012;
  alb *= 0.975 + 0.04 * (lap - 0.5) + 0.04 * s;
  rgh *= 0.94 + 0.12 * sN(p * 1.7 + 3.0);
}
// cut-pile carpet: heathered tufts, pile brushed different ways in soft patches, crushed and paler along the walking
// path, a grey soiling line along the skirting
void surfCarpet(vec3 P, float fw, inout vec3 alb, inout float rgh, inout float h) {
  vec2 p = P.xz;
  float wT = sFade(fw, 420.0), wF = sFade(fw, 900.0);
  float tuft = sN(p * 420.0) * 0.65 + mix(0.175, sN(p * 900.0 + 5.0) * 0.35, wF);
  float fleck = sN(p * 310.0 + 9.0);
  float nap = sN(p * 2.4) * 0.6 + sN(p * 6.0 + 3.0) * 0.4;
  // heathered yarn, each scale fading on its own so the coarse blotches still read across the room
  float mottle = clamp(0.5 + (sN(p * 22.0) - 0.5) * 0.7 + (sN(p * 55.0) - 0.5) * 0.6 * sFade(fw, 55.0) + (sN(p * 130.0 + 7.0) - 0.5) * 0.5 * sFade(fw, 130.0), 0.0, 1.0);
  float wK = sFade(fw, 200.0), knot = sN(p * 200.0 + 2.0), fl = smoothstep(0.3, 0.75, sN(p * 190.0 + 13.0));   // tufts and paler fibres at a few mm
  vec2 a = vec2(2.3, 2.5), bb = vec2(0.95, -0.6); vec2 pa = p - a, ba = bb - a;
  float path = exp(-pow(length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) / 0.38, 2.0));
  path = max(path, exp(-pow(length(vec2(P.x / 1.1, (P.z - 0.65) / 0.35)), 2.0)) * 0.7);
  float wallD = min(min(P.x + 2.5, 2.5 - P.x), min(P.z + 2.0, 4.0 - P.z));
  float soil = 1.0 - smoothstep(0.004, 0.03, wallD);
  h += (tuft - 0.5) * 0.0012 * wT * (1.0 - 0.6 * path) + (nap - 0.5) * 0.0006;
  alb *= mix(1.0, (0.82 + 0.36 * fleck) * (0.9 + 0.2 * tuft), wT) * (0.84 + 0.32 * nap) * (0.7 + 0.6 * mottle) * mix(1.0, 0.78 + 0.44 * fl, wK) * (1.0 + 0.12 * path) * (1.0 - 0.3 * soil);
  h += (mottle - 0.5) * 0.0005 + (knot - 0.5) * 0.0016 * wK * (1.0 - 0.5 * path);
}
// textured ceiling paint at five scales (it holds up at a few centimetres), roller laps and the ridges along their edges
void surfPlaster(vec3 P, float fw, inout vec3 alb, inout float rgh, inout float h) {
  vec2 p = P.xz; float s = 0.0, a = 1.0, f = 55.0;
  for (int i = 0; i < 6; i++) { s += (sN(p * f + float(i) * 17.31) - 0.5) * a * sFade(fw, f); a *= 0.56; f *= 2.25; }
  float lapU = p.y / 0.23 + 0.35 * sN(vec2(p.x * 0.9, p.y * 0.4));
  float lap = sN(vec2(p.x * 0.7, floor(lapU) * 3.1)), edge = smoothstep(0.9, 1.0, fract(lapU)) * (1.0 - smoothstep(0.985, 1.0, fract(lapU)));
  float spat = smoothstep(0.7, 0.95, sN(p * 140.0)) * sFade(fw, 140.0);   // the odd spatter of thicker paint
  h += s * 0.0004 + edge * 0.00012 * (0.5 + lap) + spat * 0.00008;
  alb *= 0.965 + 0.06 * (lap - 0.5) + 0.07 * s - 0.03 * edge;
  rgh *= 1.0 - 0.12 * s;
}
// wallpaper print sampled per roll: each 53 cm drop slightly off in register and shade; fibres; overlapped seams
vec4 surfPaperMap(sampler2D mp, vec2 uv) {
  float strip = floor(uv.x);
  return texture2D(mp, uv + vec2(0.0, (sH(vec2(strip, 1.7)) - 0.5) * 0.018));
}
void surfPaper(vec2 uv, float lum, float fw, inout vec3 alb, inout float rgh, inout float h) {
  vec2 m = uv * 0.53; float strip = floor(uv.x);
  float fib = sN(m * 2600.0) * 0.6 + sN(m * vec2(900.0, 5200.0)) * 0.4;
  float sx = fract(uv.x) * 0.53, sd = min(sx, 0.53 - sx);
  float seam = 1.0 - smoothstep(0.0, 0.0012, sd), line = 1.0 - smoothstep(0.00025 - fw * 0.5, 0.00025 + fw * 0.5, sd);
  float bub = smoothstep(0.78, 0.95, sN(m * vec2(9.0, 5.0) + strip * 4.1));
  h += (fib - 0.5) * 0.00002 * sFade(fw, 2600.0) + (1.0 - lum) * 0.00006 + seam * 0.00009 + bub * 0.0006;
  alb *= (0.975 + 0.05 * sH(vec2(strip, 9.1))) * (1.0 - 0.3 * line) * (0.985 + 0.03 * fib);
  rgh *= 1.0 - 0.06 * (1.0 - lum);
}
// plain-woven cloth: warp along v, weft along u; threads vary in shade; creases and slubs
void surfCloth(vec2 uv, float fwUv, inout vec3 alb, inout float rgh, inout float h) {
  vec2 m = uv * uSurfSize; vec2 q = m / uSurfPitch;
  vec2 cyc = fwidth(q); float ww = 1.0 - smoothstep(0.2, 0.5, max(cyc.x, cyc.y));
  vec2 c = floor(q), f = fract(q);
  float over = mod(c.x + c.y, 2.0);
  float warp = sin(3.14159 * f.x) * (0.55 + 0.45 * sin(3.14159 * f.y)), weft = sin(3.14159 * f.y) * (0.55 + 0.45 * sin(3.14159 * f.x));
  float wv = mix(weft, warp, over);
  float thread = mix(sH(vec2(c.y, 3.3)), sH(vec2(c.x, 8.1)), over);
  float slub = sN(vec2(m.x * 3.0, c.y * 0.37)) * (1.0 - over) + sN(vec2(c.x * 0.41, m.y * 3.0)) * over;
  float crease = sN(m * vec2(9.0, 22.0)) * 0.6 + sN(m * vec2(31.0, 13.0)) * 0.4;
  float pill = smoothstep(0.86, 0.97, sN(m * 260.0)) * (1.0 - smoothstep(0.2, 0.5, fwUv * 260.0));
  h += (wv - 0.5) * uSurfPitch * 0.3 * ww + (crease - 0.5) * 0.0012 + (slub - 0.5) * uSurfPitch * 0.25 * ww;
  alb *= mix(1.0, (0.86 + 0.28 * thread) * (0.92 + 0.16 * wv), ww) * (0.94 + 0.12 * sN(m * 3.5)) * (1.0 + 0.12 * pill);
  rgh *= 1.0 + 0.06 * pill;
}`;
// splice the surface into a material's shaders (called from onBeforeCompile, on its own or after moonify's changes)
function applySurf(s, m) {
  const o = m.userData.surf, mode = o.mode;
  s.uniforms.uSurfSize = { value: new THREE.Vector2(...(o.size || [1, 1])) }; s.uniforms.uSurfPitch = { value: o.pitch || 0.001 };
  s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>' + SURF_V).replace('#include <project_vertex>', '#include <project_vertex>' + SURF_VMAIN);
  const MAP = mode === 'paper' ? `#ifdef USE_MAP
  vec4 sampledDiffuseColor = surfPaperMap(map, vMapUv); diffuseColor *= sampledDiffuseColor;
  float surfLum = dot(sampledDiffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  #else
  float surfLum = 1.0;
  #endif` : '#include <map_fragment>';
  const call = {
    wood: 'surfWood(vSurfP, vSurfG, sfw, sAlb, sRgh, sHt);',
    paint: 'surfPaint(vSurfP, vSurfG, normalize(cross(dFdx(vSurfP), dFdy(vSurfP))), sfw, sAlb, sRgh, sHt);',
    floor: 'surfFloor(vSurfP, sfw, sAlb, sRgh, sHt);',
    plaster: 'surfPlaster(vSurfP, sfw, sAlb, sRgh, sHt);',
    emulsion: 'surfEmulsion(vSurfP, sfw, sAlb, sRgh, sHt);',
    carpet: 'surfCarpet(vSurfP, sfw, sAlb, sRgh, sHt);',
    paper: '#ifdef USE_MAP\n  surfPaper(vMapUv, surfLum, sfw, sAlb, sRgh, sHt);\n  #endif',
    cloth: 'surfCloth(vSurfUv, length(fwidth(vSurfUv * uSurfSize)), sAlb, sRgh, sHt);',
  }[mode];
  s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>' + SURF_F)
    .replace('#include <map_fragment>', `${MAP}
  vec3 sAlb = vec3(1.0); float sRgh = 1.0, sHt = 0.0, sfw = length(fwidth(vSurfP));
  ${call}
  diffuseColor.rgb *= sAlb;`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor * sRgh, 0.04, 1.0);')
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = surfBump(-vViewPosition, normal, sHt, faceDirection);');
}
const surfKey = (m) => (m.userData.moon ? 'moon1' : 'std') + (m.userData.surf ? '-surf-' + m.userData.surf.mode : '');
function surf(m, mode, opt = {}) {
  m.userData.surf = { mode, ...opt };
  if (!m.userData.moon) m.onBeforeCompile = (s) => applySurf(s, m);
  m.customProgramCacheKey = () => surfKey(m);
  return m;
}

const MOONU = { uMoonCol: { value: new THREE.Color() }, uMoonL: { value: MOONL }, uCookie: { value: null }, uBranch: { value: null }, uSway: { value: 0 } };
// moonlight through the window, added to a standard material: panes, glazing bars, curtain edges and a swaying branch shadow,
// blocked by the bed; and baked occlusion applied to direct light too (soft contact shadows under everything)
function moonify(m) {
  if (m.userData.moon) return m;
  m.userData.moon = true;
  m.onBeforeCompile = (s) => {
    MOONU.uCookie.value = moonCookie(); MOONU.uBranch.value = moonBranch();
    Object.assign(s.uniforms, MOONU);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMW;').replace('#include <project_vertex>', `#include <project_vertex>
  vec4 mwp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  mwp = instanceMatrix * mwp;
  #endif
  vMW = (modelMatrix * mwp).xyz;`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vMW; uniform vec3 uMoonCol; uniform vec3 uMoonL; uniform sampler2D uCookie; uniform sampler2D uBranch; uniform float uSway;
float bedBlock(vec3 o, vec3 d) { vec3 inv = 1.0 / d; vec3 t0 = (vec3(-0.8, 0.0, -1.96) - o) * inv; vec3 t1 = (vec3(0.8, 0.47, 0.26) - o) * inv; vec3 tn = min(t0, t1); vec3 tf = max(t0, t1); float a = max(max(tn.x, tn.y), tn.z); float b = min(min(tf.x, tf.y), tf.z); return step(a, b) * step(0.0, b); }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  #ifdef USE_AOMAP
  reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, 0.8); reflectedLight.directSpecular *= ambientOcclusion;
  #endif`)
      .replace('#include <opaque_fragment>', `{
    float mt = (-2.47 - vMW.x) / uMoonL.x;
    vec3 hw = vMW + uMoonL * mt;
    vec2 cu = vec2((hw.z + 0.45) / 1.7, (hw.y - 0.7) / 1.5);
    float ck = step(0.0, mt) * step(0.0, cu.x) * step(cu.x, 1.0) * step(0.0, cu.y) * step(cu.y, 1.0) * texture2D(uCookie, cu).r;
    vec3 h2 = vMW + uMoonL * ((-5.5 - vMW.x) / uMoonL.x);
    ck *= 1.0 - 0.8 * texture2D(uBranch, vec2(h2.z * 0.16 + uSway, h2.y * 0.16)).r;
    ck *= 1.0 - bedBlock(vMW, uMoonL);
    float ml = ck * max(dot(inverseTransformDirection(normal, viewMatrix), uMoonL), 0.0);
    #ifdef USE_AOMAP
    ml *= ambientOcclusion;
    #endif
    outgoingLight += uMoonCol * diffuseColor.rgb * ml;
  }
  #include <opaque_fragment>`);
    if (m.userData.surf) applySurf(s, m);
  };
  m.customProgramCacheKey = () => surfKey(m);
  return m;
}
// a turned bedpost of height h
const turnedPost = (h) => lathe([[0, 0], [0.036, 0], [0.037, 0.02], [0.036, h * 0.2], [0.028, h * 0.22], [0.031, h * 0.24], [0.022, h * 0.28], [0.021, h * 0.58], [0.029, h * 0.62], [0.023, h * 0.645], [0.034, h * 0.68], [0.034, h * 0.86], [0.027, h * 0.88], [0.031, h * 0.92], [0.036, h * 0.955], [0.026, h * 0.985], [0, h]], 14);
// the lived-in clutter: desk, shelf, chair with clothes, wardrobe ajar, radiator, basket, shoes, bag, smoke alarm, cables
function bedroomExtras() {
  return G('bedroomExtras', () => {
    const X = {}, wood = [], paint = [], props = [], metal = [];
    // desk under the poster, its pedestal of drawers, a shelf of books above
    wood.push(bbox(2.225, 0.745, 0.75, 0.55, 0.03, 1.22), bbox(2.225, 0.365, 0.16, 0.5, 0.73, 0.025), bbox(2.225, 0.365, 1.24, 0.5, 0.73, 0.2), bbox(2.47, 0.5, 0.66, 0.02, 0.42, 0.95), bbox(2.39, 1.98, 0.75, 0.22, 0.025, 1.0));
    for (const y of [0.6, 0.38, 0.15]) { wood.push(bbox(1.968, y, 1.24, 0.014, 0.2, 0.18)); metal.push(bbox(1.955, y + 0.05, 1.24, 0.012, 0.012, 0.08)); }
    for (const z of [0.32, 1.18]) metal.push(bbox(2.46, 1.94, z, 0.06, 0.06, 0.012));
    // desk chair, a jumper over its back and jeans on the seat
    wood.push(bbox(1.85, 0.46, 0.75, 0.42, 0.04, 0.42), bbox(1.632, 0.88, 0.75, 0.025, 0.1, 0.38), bbox(1.636, 0.67, 0.75, 0.025, 0.06, 0.38));
    for (const [dx, dz] of [[-0.18, -0.18], [-0.18, 0.18], [0.18, -0.18], [0.18, 0.18]]) wood.push(seg([1.85 + dx, 0.44, 0.75 + dz], [1.85 + dx * 1.1, 0, 0.75 + dz * 1.1], 0.016, 0.013, 8));
    for (const dz of [-0.18, 0.18]) wood.push(seg([1.66, 0.46, 0.75 + dz], [1.625, 0.95, 0.75 + dz], 0.015, 0.013, 8));
    props.push([grid(14, 22, (u, v, o) => {
      const s = -0.42 + v * 0.86, z = 0.56 + u * 0.38, rip = 0.012 * Math.sin(u * 19 + v * 5) + 0.008 * Math.sin(u * 7 - v * 11);
      if (Math.abs(s) < 0.05) { const a = s / 0.05 * PI / 2; return o.set(1.632 + Math.sin(a) * 0.034, 0.955 + Math.cos(a) * 0.018, z); }
      const k = Math.abs(s) - 0.05; return o.set(1.632 + Math.sign(s) * (0.034 + k * 0.08) + rip, 0.955 - k * 0.92, z + rip * 0.5);
    }), null, 0x3a4a6c]);
    props.push([sculpt(16, 10, (nx, ny, nz, o) => o.set(nx * 0.16 * (1 + 0.1 * Math.sin(nz * 9)), ny * 0.035 * (1 + 0.5 * Math.sin(nx * 7 + nz * 5)), nz * 0.13)), M(1.9, 0.5, 0.78, 0, 0.4, 0), 0x2a3552]);
    // closed laptop, mug, a stack of books on the desk; books on the shelf
    props.push(bbox(2.2, 0.771, 0.55, 0.23, 0.018, 0.33, 0, 0.1, 0, 0x5c6068), bbox(2.2, 0.781, 0.55, 0.225, 0.002, 0.325, 0, 0.1, 0, 0x7a7e86));
    const cup = lathe([[0.034, 0], [0.038, 0.01], [0.04, 0.095], [0.036, 0.095], [0.034, 0.012], [0, 0.012]], 14);
    props.push([cup, M(2.32, 0.76, 1.06), 0x8a3328], bbox(2.355, 0.81, 1.06, 0.014, 0.05, 0.012, 0, 0, 0, 0x8a3328));
    [[0.03, 0x6a5a3a], [0.025, 0x2a3a5a], [0.04, 0x7a2a2a]].reduce((y, [t, c], i) => { props.push(bbox(2.28, y + t / 2, 0.28, 0.2, t, 0.27, 0, 0.15 * i - 0.1, 0, c)); return y + t; }, 0.76);
    seed(241); let bz = 0.3;
    while (bz < 1.18) { const wz = rr(0.02, 0.045), hgt = rr(0.16, 0.24), dx = rr(0.14, 0.19), lean = bz > 1.05 ? 0.3 : 0; props.push(bbox(2.39 + (0.2 - dx) / 2, 1.9925 + hgt / 2 * Math.cos(lean), bz, dx, hgt, wz, lean, 0, 0, [0x5a2a2a, 0x2a3a5a, 0x3a5a3a, 0x6a5a3a, 0x8a8070, 0x2a2a2a, 0x6a4a6a][Math.floor(rr(0, 7))])); bz += wz + 0.002; }
    // the wardrobe in the far corner, its door standing a hand's width open on darkness
    wood.push(bbox(2.21, 1.025, 3.15, 0.58, 2.05, 0.02), bbox(2.21, 1.025, 3.97, 0.58, 2.05, 0.02), bbox(2.21, 2.05, 3.56, 0.6, 0.03, 0.86), bbox(2.2, 2.08, 3.56, 0.64, 0.025, 0.9), bbox(2.22, 0.04, 3.56, 0.56, 0.08, 0.82));
    props.push(bbox(2.22, 1.05, 3.56, 0.54, 1.94, 0.8, 0, 0, 0, 0x010101));
    { const a = 0.3, hz = 3.955, hx = 1.925, cx = hx - 0.39 * Math.sin(a), cz = hz - 0.39 * Math.cos(a);
      wood.push(bbox(cx, 1.06, cz, 0.022, 1.94, 0.78, 0, a, 0));
      for (const dy of [-0.5, 0.45]) wood.push(bbox(cx - 0.014 * Math.cos(a), 1.06 + dy, cz + 0.014 * Math.sin(a), 0.008, 0.72, 0.58, 0, a, 0));
      const fx = hx - 0.72 * Math.sin(a) - 0.03 * Math.cos(a), fz = hz - 0.72 * Math.cos(a) + 0.03 * Math.sin(a);
      metal.push(seg([fx, 0.98, fz], [fx, 1.14, fz], 0.008, 0.008, 6)); }
    // radiator under the window: columns, manifolds, valve
    for (let z = 0.0; z < 0.82; z += 0.085) paint.push(bbox(-2.42, 0.38, z, 0.08, 0.5, 0.055));
    paint.push(bbox(-2.42, 0.625, 0.39, 0.05, 0.03, 0.83), bbox(-2.42, 0.14, 0.39, 0.05, 0.03, 0.83), seg([-2.42, 0.13, 0.86], [-2.42, 0.0, 0.9], 0.012, 0.012, 8), seg([-2.42, 0.13, -0.08], [-2.42, 0.0, -0.1], 0.012, 0.012, 8));
    metal.push(ball(-2.42, 0.16, 0.87, 0.022, 0.03, 0.022, 8, 6));
    // smoke alarm on the ceiling, and a second wall socket by the other nightstand
    paint.push([lathe([[0, 0], [0.065, 0], [0.065, 0.02], [0.05, 0.034], [0, 0.034]], 24), M(0.74, 2.6, 2.1, PI, 0, 0)], bbox(-1.6, 0.3, -1.996, 0.07, 0.11, 0.008));
    props.push(bbox(-1.615, 0.3, -1.991, 0.004, 0.022, 0.006, 0, 0, 0, 0x101010), bbox(-1.585, 0.3, -1.991, 0.004, 0.022, 0.006, 0, 0, 0, 0x101010));
    // cables: the clock's lead and the phone charger, slack down the back to their sockets
    const cable = (pts, col) => props.push([new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))), 36, 0.003, 5), null, col]);
    cable([[1.06, 0.56, -1.63], [1.12, 0.552, -1.85], [1.25, 0.548, -1.97], [1.33, 0.4, -1.987], [1.42, 0.07, -1.988], [1.53, 0.05, -1.988], [1.6, 0.27, -1.99]], 0x141414);
    cable([[-1.33, 0.556, -1.64], [-1.3, 0.552, -1.85], [-1.32, 0.5, -1.975], [-1.4, 0.2, -1.987], [-1.5, 0.06, -1.988], [-1.58, 0.1, -1.988], [-1.6, 0.27, -1.99]], 0xe6e6e6);
    // laundry basket by the window wall, a sleeve over the rim
    props.push([lathe([[0.165, 0], [0.2, 0.39], [0.207, 0.41], [0.196, 0.41], [0.157, 0.02], [0, 0.02]], 18), M(-2.1, 0, 2.4), 0x8a7552]);
    for (const [dx, dz, c] of [[0.03, -0.02, 0xc8c8cc], [-0.05, 0.04, 0x5a6a8a], [0.02, 0.06, 0x7a3a3a]]) props.push(ball(-2.1 + dx, 0.38, 2.4 + dz, 0.13, 0.06, 0.11, 10, 6, 0, dx * 20, 0.3, c));
    props.push(seg([-2.0, 0.42, 2.27], [-1.93, 0.18, 2.24], 0.035, 0.03, 8)); props[props.length - 1].push(0x5a6a8a);
    // trainers by the desk, one on its side; a bag slumped against the wall
    // footprint: superellipse 27 cm long, narrow at the heel; z + is the toe
    const pe = (a, e) => Math.sign(a) * Math.pow(Math.abs(a), e), shW = (z) => 0.04 + 0.011 * smooth(-0.11, 0.04, z) - 0.006 * smooth(0.07, 0.135, z);
    const shH = (z) => 0.028 + 0.05 * smooth(0.06, -0.1, z);   // the upper's height over the sole: low at the toe, up round the ankle
    const sole = sculpt(22, 10, (nx, ny, nz, o) => { const z = pe(nz, 0.55) * 0.135; return o.set(pe(nx, 0.55) * shW(z) * 1.04, pe(ny, 0.35) * 0.011 + 0.011, z); });
    const upper = sculpt(22, 12, (nx, ny, nz, o) => { const z = pe(nz, 0.6) * 0.128; return o.set(pe(nx, 0.7) * shW(z) * 0.94, 0.02 + Math.pow(Math.max(ny, 0), 0.75) * shH(z), z); });
    const shoe = (m, up) => {
      props.push([sole, m, 0xcfcac0], [upper, m, up]);
      props.push([sphG(14, 8), m.clone().multiply(M(0, 0.02 + shH(-0.08) - 0.0035, -0.08, -0.22, 0, 0, 0.022, 0.0042, 0.036)), 0x121214]);   // the opening
      for (const z of [-0.035, -0.012, 0.011, 0.034]) props.push([boxG(), m.clone().multiply(M(0, 0.02 + shH(z) + 0.001, z, -0.25, 0, 0, 0.042, 0.003, 0.006)), 0xd6d2c8]);   // laces
      props.push([boxG(), m.clone().multiply(M(0, 0.02 + shH(0.0), 0.0, -0.32, 0, 0, 0.03, 0.004, 0.09)), up]);   // tongue
    };
    shoe(M(1.55, 0, 1.55, 0, 0.35, 0), 0x4a5262); shoe(M(1.74, 0.046, 1.7, 0, -0.5, 1.4), 0x4a5262);
    { // local: x out from the wall toward the room is -x, y up, z across; leaning back against the wall, a little slumped
      const pe = (a, e) => Math.sign(a) * Math.pow(Math.abs(a), e), bm = M(2.3, 0, 1.78, 0, 0.12, -0.2);
      const bodyG = sculpt(18, 14, (nx, ny, nz, o) => { const y = pe(ny, 0.55) * 0.19 + 0.19, top = smooth(0.25, 0.38, y); return o.set(pe(nx, 0.6) * 0.075 * (1 - 0.35 * top) - 0.02 * smooth(0.2, 0.0, y), y, pe(nz, 0.5) * 0.15 * (1 - 0.3 * top)); });
      const pocketG = sculpt(14, 10, (nx, ny, nz, o) => o.set(pe(nx, 0.6) * 0.032, pe(ny, 0.5) * 0.075, pe(nz, 0.5) * 0.11));
      const part = (geo, m, c) => props.push([geo, bm.clone().multiply(m), c]);
      part(bodyG, M(), 0x2c3446); part(pocketG, M(-0.085, 0.13, 0), 0x2a3142);
      part(boxG(), M(-0.108, 0.2, 0, 0, 0, 0, 0.004, 0.006, 0.2), 0x8a8e98); part(boxG(), M(-0.111, 0.2, 0.07, 0, 0, 0, 0.006, 0.03, 0.012), 0xb8bcc4);   // zip and its pull
      for (const [a, b] of [[[0, 0.37, -0.04], [0, 0.41, -0.025]], [[0, 0.41, -0.025], [0, 0.41, 0.025]], [[0, 0.41, 0.025], [0, 0.37, 0.04]]]) { const sg = seg(a, b, 0.006, 0.006, 6); part(sg[0], sg[1], 0x1e2330); }   // carry loop
    }
    // on the chest of drawers: a plant, keys and coins, a table lamp (off)
    props.push([lathe([[0.04, 0], [0.055, 0.1], [0.058, 0.11], [0.05, 0.11], [0, 0.09]], 14), M(-2.02, 0.91, 3.78), 0x9a5a3a]);
    seed(251); for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + rr(-0.2, 0.2), tilt = rr(0.5, 1.1); props.push(ball(-2.02 + Math.sin(a) * 0.06, 1.08, 3.78 + Math.cos(a) * 0.06, 0.018, 0.11, 0.008, 6, 4, Math.cos(a) * tilt, 0, -Math.sin(a) * tilt, 0x2e5a2e)); }
    props.push(bbox(-1.62, 0.913, 3.6, 0.05, 0.004, 0.012, 0, 0.4, 0, 0x9a9488), bbox(-1.6, 0.913, 3.62, 0.04, 0.004, 0.012, 0, -0.3, 0, 0xa89a70), ball(-1.62, 0.913, 3.62, 0.014, 0.003, 0.014, 8, 4, 0, 0, 0, 0x8a8478));
    for (const [dx, dz] of [[0.06, -0.05], [0.08, -0.02], [0.05, 0.01]]) props.push(ball(-1.62 + dx, 0.912, 3.62 + dz, 0.011, 0.002, 0.011, 8, 4, 0, 0, 0, 0xb09450));
    // second picture frame on the far wall, the dark gap under the door, the open drawer's insides, door hinges
    wood.push(bbox(1.32, 1.6, 3.985, 0.44, 0.34, 0.025));
    props.push(bbox(2.488, 0.004, 2.6, 0.02, 0.008, 0.84, 0, 0, 0, 0x000000), bbox(-1.442, 0.76, 3.4748, 0.49, 0.19, 0.002, 0, 0, 0, 0x060504));
    // in the open drawer: folded clothes, and a sock slung over its front
    props.push(ball(-1.5, 0.735, 3.43, 0.16, 0.035, 0.06, 10, 6, 0, 0.1, 0, 0x6a6e78), ball(-1.36, 0.73, 3.44, 0.09, 0.03, 0.05, 10, 6, 0, -0.2, 0, 0x2a3550));
    props.push(seg([-1.39, 0.745, 3.42], [-1.385, 0.868, 3.372], 0.012, 0.013, 8), seg([-1.385, 0.868, 3.372], [-1.383, 0.86, 3.35], 0.013, 0.013, 8), seg([-1.383, 0.86, 3.35], [-1.38, 0.72, 3.348], 0.013, 0.014, 8));
    for (let i = 3; i > 0; i--) props[props.length - i].push(0x7a2a2a);
    for (const y of [0.25, 1.0, 1.75]) metal.push(bbox(2.474, y, 2.165, 0.012, 0.09, 0.022));
    X.wood = merge(wood, true); X.paint = merge(paint, true); X.props = merge(props); X.metal = merge(metal);
    X.post = turnedPost(1.24); X.footPost = turnedPost(0.7);
    X.poster = (() => { const geo = new THREE.PlaneGeometry(0.5, 0.75, 10, 14), p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const u = p.getX(i) / 0.25, v = p.getY(i) / 0.375, c = Math.max(0, Math.abs(u) * Math.abs(v) - 0.55) / 0.45; p.setZ(i, 0.02 * c * c + 0.007 * Math.pow(Math.max(0, v), 6) + 0.0015 * Math.sin(u * 3 + v * 2)); } geo.computeVertexNormals(); return geo; })();
    return X;
  });
}

export function buildBedroom(opt = {}) {
  const g = new THREE.Group(), P = bedroomParts(), X = bedroomExtras();
  // papered walls, each with its own baked occlusion; the window wall has a real opening onto the night outside
  const paper = (W) => Mt(`paper3${W}`, () => { const t = wallpaperTex().clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(W / 0.53, 2.6 / 0.53); t.needsUpdate = true; return t; });
  // painted walls (build 115; the trellis paper is still there as wallpaperTex / mode 'paper' if a paper is wanted again)
  const wallMat = (W, ao) => moonify(surf(std(new THREE.Color(opt.wall || 0xb4b8c2).multiply(new THREE.Color(0xebe7df)), { roughness: 0.9, side: THREE.DoubleSide, aoMap: ao }), 'emulsion'));
  const wallGeo = (key, W, hole) => G(key, () => {
    const s = new THREE.Shape(); s.moveTo(-W / 2, -1.3); s.lineTo(W / 2, -1.3); s.lineTo(W / 2, 1.3); s.lineTo(-W / 2, 1.3); s.closePath();
    if (hole) { const [x0, x1, y0, y1] = hole, h = new THREE.Path(); h.moveTo(x0, y0); h.lineTo(x0, y1); h.lineTo(x1, y1); h.lineTo(x1, y0); h.closePath(); s.holes.push(h); }
    const geo = new THREE.ShapeGeometry(s), uv = geo.attributes.uv, p = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + W / 2) / W, (p.getY(i) + 1.3) / 2.6);
    return geo;
  });
  const wall = (geo, m, x, z, ry) => { const p = mesh(geo, m, x, 1.3, z); p.rotation.y = ry; g.add(p); return p; };
  const plane = (w, h, m, x, y, z, rx, ry) => { const p = mesh(new THREE.PlaneGeometry(w, h), m, x, y, z); p.rotation.set(rx || 0, ry || 0, 0); g.add(p); return p; };
  // carpet: the pile hardly reflects (a full specular made it a grey veil under the portal light)
  const floor = plane(5, 6, Mt('carpet1', () => moonify(surf(new THREE.MeshPhysicalMaterial({ color: 0x4e4339, roughness: 1, aoMap: floorAO(), sheen: 0.12, sheenRoughness: 0.8, sheenColor: new THREE.Color(0x5a5048), specularIntensity: 0.12 }), 'carpet'))), 0, 0, 1, -Math.PI / 2);
  const ceiling = plane(5, 6, Mt('ceiling3', () => { const m = surf(std(0xffffff, { map: ceilingMap(), roughness: 0.92 }), 'plaster'); m.map.anisotropy = 16; return m; }), 0, 2.6, 1, Math.PI / 2);
  // a sharp detail patch over the bed, where you float up to the ceiling
  const patch = mesh(G('ceilPatchPlane', () => new THREE.PlaneGeometry(1.4, 1.4)), Mt('ceilPatch', () => std(0xffffff, { map: ceilPatchTex(), bumpMap: ceilPatchBump(), bumpScale: 0.6, roughness: 0.95, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })), 0, 2.598, -1.0);
  patch.rotation.x = Math.PI / 2; g.add(patch);
  wall(wallGeo('wallHead', 5), wallMat(5, aoHead()), 0, -2, 0);
  const farWall = wall(wallGeo('wallFar', 5), wallMat(5, aoFar()), 0, 4, Math.PI);
  wall(wallGeo('wallWin', 6, [-0.07, 1.27, -0.52, 0.82]), wallMat(6, aoWin()), -2.5, 1, Math.PI / 2);
  wall(wallGeo('wallDoor', 6), wallMat(6, aoDoor()), 2.5, 1, -Math.PI / 2);
  // furniture, trim and props (merged per material)
  const woodM = Mt('woodDark2', () => moonify(surf(std(0x452a1b, { roughness: 0.48 }), 'wood')));
  // cloth: woven in the shader (size = metres per uv unit, pitch = thread spacing) with a soft sheen at grazing angles
  const cloth = (c, o = {}) => moonify(surf(new THREE.MeshPhysicalMaterial({ color: c, roughness: o.rough ?? 0.88, map: o.map === undefined ? fabricTex() : o.map, side: o.side ?? THREE.FrontSide,
    sheen: o.sheen ?? 0.5, sheenRoughness: 0.75, sheenColor: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.2) }), 'cloth', { size: o.size || [1.4, 0.9], pitch: o.pitch || 0.0006 }));
  const fabric = (c) => Mt(`fab2${c}`, () => cloth(c));
  const trimM = Mt('trim2', () => moonify(surf(std(0xd8d4cc, { roughness: 0.42 }), 'paint'))), metalM = Mt('brass', () => std(0xb89a5a, { roughness: 0.35, metalness: 0.6 }));
  const propsM = Mt('props', () => moonify(std(0xffffff, { roughness: 0.6, vertexColors: true, side: THREE.DoubleSide })));
  g.add(new THREE.Mesh(P.trim, trimM), new THREE.Mesh(P.wood, woodM), new THREE.Mesh(P.door, Mt('doorPaint2', () => moonify(surf(std(0x8a8478, { roughness: 0.48 }), 'paint')))),
    new THREE.Mesh(P.metal, metalM), new THREE.Mesh(P.props, propsM),
    new THREE.Mesh(X.wood, woodM), new THREE.Mesh(X.paint, trimM), new THREE.Mesh(X.props, propsM), new THREE.Mesh(X.metal, metalM),
    mesh(P.shade, Mt('shade', () => std(0xd8c8a8, { roughness: 0.9, side: THREE.DoubleSide, map: fabricTex() })), -1.42, 1.2, 3.8), mesh(P.lampBase, Mt('ceramic', () => std(0x3a5a6a, { roughness: 0.25 })), -1.42, 0.91, 3.8),
    new THREE.Mesh(P.mattress, fabric(0x9a9eb2)), new THREE.Mesh(P.base, fabric(0x2a2a34)),
    new THREE.Mesh(P.curtains, Mt('curtain2', () => cloth(0x4a3c5a, { rough: 0.95, side: THREE.DoubleSide, size: [0.7, 1.4], pitch: 0.0016, sheen: 1 }))),
    mesh(P.shade, Mt('shade', () => std(0xd8c8a8, { roughness: 0.9, side: THREE.DoubleSide, map: fabricTex() })), 1.3, 0.84, -1.86), mesh(P.lampBase, Mt('ceramic', () => std(0x3a5a6a, { roughness: 0.25 })), 1.3, 0.55, -1.86),
    mesh(P.dome, Mt('dome', () => std(0xe8eef6, { roughness: 0.3 })), 0, 2.6, 1));
  g.add(mesh(P.glass, Mt('waterGlass', () => std(0xffffff, { vertexColors: true, transparent: true, opacity: 0.38, roughness: 0.06, depthWrite: false }))));
  g.add(new THREE.LineSegments(P.cobweb, Mt('cobweb', () => new THREE.LineBasicMaterial({ color: 0xd8dce4, transparent: true, opacity: 0.35 }))));
  const rug = mesh(new THREE.PlaneGeometry(2.4, 1.2), Mt('rug2', () => cloth(0xffffff, { rough: 1, map: rugTex(), size: [2.4, 1.2], pitch: 0.0028, sheen: 0.6 })), 0.15, 0.004, 1.65); rug.rotation.set(-PI / 2, 0, 0.05); g.add(rug);
  const poster = mesh(X.poster, Mt('poster', () => std(0xffffff, { roughness: 0.8, map: posterTex(), side: THREE.DoubleSide })), 2.49, 1.45, 0.75); poster.rotation.y = -PI / 2; g.add(poster);
  const picM = Mt('picture', () => std(0xffffff, { roughness: 0.7, map: pictureTex() }));
  g.add(mesh(new THREE.PlaneGeometry(0.56, 0.38), picM, 0, 1.51, -1.98));
  const pic2 = mesh(new THREE.PlaneGeometry(0.36, 0.26), picM, 1.32, 1.6, 3.97); pic2.rotation.y = PI; g.add(pic2);
  // bed covers
  const blanketM = Mt('blanket2', () => cloth(0x39456b, { map: quiltTex(), side: THREE.DoubleSide, size: [2.34, 1.83], pitch: 0.00055 }));
  const sheetM = Mt('sheet2', () => cloth(0xc8ccd8, { side: THREE.DoubleSide, size: [2.0, 1.2], pitch: 0.0004, sheen: 0.5 }));
  const blanket = mesh(P.blanket, blanketM, 0, 0.57, -0.55); g.add(blanket);
  const band = new THREE.Mesh(P.band, sheetM); blanket.add(band);
  const pillows = new THREE.Mesh(P.pillows, fabric(0xd8d8de)); g.add(pillows);
  const sheet = new THREE.Mesh(P.sheet, sheetM); sheet.visible = false; g.add(sheet);
  // sleeping body (shown when you look back from the ceiling): head on the pillow, shoulders under the covers
  // the same body as the first-person one, lying in its layInBed pose (the covers are shaped round it), with a head on the pillow
  const body = new THREE.Group();
  const sleeper = makePlayerBody(); sleeper.userData.layInBed(); sleeper.userData.legs.children[1].visible = false; body.add(sleeper);
  const sleeperHead = new THREE.Group(); body.add(sleeperHead);
  sleeperHead.add(new THREE.Mesh(P.sleeperSkin, skinMat()), new THREE.Mesh(P.sleeperHair, hairMat(HAIR[0])), new THREE.Mesh(P.sleeperFace, irisMat()));
  body.userData = { sleeper, head: sleeperHead };
  body.visible = false; g.add(body);
  // the bed just vacated: covers thrown back into a heap toward the foot and the +x side, sheet showing, a pillow askew
  const messBed = () => { blanket.geometry = P.heap; band.visible = false; pillows.geometry = P.pillowsMess; sheet.visible = true; body.visible = false; };
  // LED clock on the nightstand on the player's left (+x)
  const cc = document.createElement('canvas'); cc.width = 512; cc.height = 192;
  const clockTex = new THREE.CanvasTexture(cc); clockTex.colorSpace = THREE.SRGBColorSpace; clockTex.anisotropy = 8;
  const caseM = Mt('clockCase', () => std(0x0a0a0a, { roughness: 0.4 }));
  // on the front corner of the nightstand nearest the pillow, turned to face it (reachable inside the bedroom's look limits)
  const clock = mesh(new THREE.BoxGeometry(0.22, 0.095, 0.07), [0, 0, 0, 0, 0, 0].map((_, i) => i === 4 ? new THREE.MeshBasicMaterial({ map: clockTex }) : caseM), 1.04, 0.6025, -1.59);
  clock.lookAt(0, 0.85, -1.5); g.add(clock);
  const clockLight = new THREE.PointLight(0xff2a1a, 0.012, 0, 2);   // very faint, no range cut-off (a short range drew a lit ball round the clock)   // a faint red spill on the nightstand only (was 0.5 over 2.2 m: far too strong)
  clockLight.position.set(0.92, 0.7, -1.58); g.add(clockLight);   // in the room from the start: the wand borrows it later, and a light added mid-scene recompiles everything
  const setClock = (text, scramble) => {
    const c = cc.getContext('2d'); c.setTransform(2, 0, 0, 2, 0, 0); c.shadowBlur = 0;
    c.fillStyle = '#050000'; c.fillRect(0, 0, 256, 96);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 70px "Courier New", monospace';
    if (!scramble) { c.fillStyle = 'rgba(255,42,26,0.07)'; c.fillText(String(text).replace(/[0-9]/g, '8'), 128, 52); }
    c.fillStyle = '#a81a10'; c.shadowColor = '#a81a10'; c.shadowBlur = 6;   // dim digits, a small glow
    if (scramble) { c.font = 'bold 60px serif'; text = Array.from({ length: 4 }, () => '⏃⟒⏁⌇⍜⎍⏚⌰☌⊑'[Math.floor(Math.random() * 10)]).join(''); }
    c.fillText(text, 128, 52);
    c.shadowBlur = 6; c.beginPath(); c.arc(16, 74, 3.5, 0, TAU); c.fill();
    c.shadowBlur = 0; c.fillStyle = 'rgba(0,0,0,.28)'; for (let y = 0; y < 96; y += 3) c.fillRect(0, y, 256, 1);
    const sh = c.createLinearGradient(0, 0, 256, 96); sh.addColorStop(0, 'rgba(255,255,255,.07)'); sh.addColorStop(0.45, 'rgba(255,255,255,0)'); c.fillStyle = sh; c.fillRect(0, 0, 256, 96);
    clockTex.needsUpdate = true;
  };
  setClock(opt.clock || '2:59');
  // window on the player's right (-x)
  // outside the window: the sky (its colour is R.glass, which scenes tint), stars and thin cloud, roofs and trees in silhouette
  const glassM = new THREE.MeshBasicMaterial({ color: opt.window || 0x1c2840, map: skyGradTex(), fog: false });
  const skyG = G('skyPlane', () => new THREE.PlaneGeometry(240, 120));
  const sky = mesh(skyG, glassM, -60, 20, 20); sky.rotation.y = PI / 2; g.add(sky);
  const skyFx = { uNight: { value: 1 }, uTime: { value: 0 } };
  const skyX = mesh(skyG, new THREE.ShaderMaterial({ vertexShader: SKYX_V, fragmentShader: SKYX_F, uniforms: skyFx, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), -59.5, 20, 20); skyX.rotation.y = PI / 2; g.add(skyX);
  const flipU = (geo, v0, v1) => { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 1 - uv.getX(i), v0 + uv.getY(i) * (v1 - v0)); return geo; };
  const silM = new THREE.MeshBasicMaterial({ map: nightAtlas(), alphaTest: 0.5, color: 0, fog: false }), treeM = new THREE.MeshBasicMaterial({ map: nearTreeTex(), alphaTest: 0.5, color: 0, fog: false });
  g.add(new THREE.Mesh(G('silhouettes', () => merge([[flipU(new THREE.PlaneGeometry(60, 22), 0.5, 1), M(-18, 1, 10, 0, PI / 2, 0)], [flipU(new THREE.PlaneGeometry(100, 24), 0, 0.5), M(-30, 2, 20, 0, PI / 2, 0)]])), silM));
  const tree = mesh(G('nearTreeG', () => flipU(new THREE.PlaneGeometry(20, 16), 0, 1)), treeM, -7, 2, 4); tree.rotation.y = PI / 2; g.add(tree);
  const pane = mesh(G('panePlane', () => new THREE.PlaneGeometry(1.3, 1.3)), Mt('pane', () => new THREE.MeshBasicMaterial({ map: paneTex(), color: 0x5a6a88, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })), -2.462, 1.45, 0.4); pane.rotation.y = PI / 2; g.add(pane);
  // lights: a low cold ambient, a faint moon from the window side; the window's light itself is drawn by moonify
  const amb = new THREE.AmbientLight(opt.ambColor || 0x56649a, opt.ambient ?? 0.3); g.add(amb);
  const moon = new THREE.DirectionalLight(0x8aa0d8, opt.moon ?? 0.14); moon.position.copy(MOONL).multiplyScalar(6); g.add(moon);
  const moonBase = new THREE.Color(1.0, 1.3, 2.1).multiplyScalar((opt.moon ?? 0.14) / 0.14);
  const glare = new THREE.SpotLight(0xbfe0ff, 0, 14, 0.7, 0.6, 1); glare.position.set(-3.6, 1.7, 0.4); glare.target.position.set(2, 0.6, 0.4); g.add(glare, glare.target);
  // the doorway in the far wall (hidden until opened)
  // arch: core 1.6 x 2.42 m, rim 1.7 x 2.5 m; base at local y=0, local +z faces into the room
  const shape = new THREE.Shape(); shape.moveTo(-0.8, 0); shape.lineTo(-0.8, 1.62); shape.absarc(0, 1.62, 0.8, Math.PI, 0, true); shape.lineTo(0.8, 0); shape.lineTo(-0.8, 0);
  const portal = new THREE.Group(); portal.position.set(0, 0, 3.97); portal.rotation.y = Math.PI; portal.visible = false;
  const rim = mesh(new THREE.ShapeGeometry(shape, 32), new THREE.MeshBasicMaterial({ color: 0x2f7bff })); rim.scale.set(1.0625, 2.5 / 2.42, 1);
  const core = mesh(new THREE.ShapeGeometry(shape, 32), new THREE.MeshBasicMaterial({ color: 0xd8efff }), 0, 0, 0.01);
  const pl = new THREE.PointLight(0x6aa8ff, 0, 8.5, 2.0); pl.position.set(0, 1.5, 2.5);   // just inside the doorway, so the room is lit from that end
  portal.add(rim, core, pl); g.add(portal);
  // the light coming out of it: shader shafts into the room and a soft glow on the wall, NOT children of the portal, so they do
  // not scale with it. They read the opening's current height (portal.scale.y) and portalLight.intensity every frame.
  const portalFx = { uHW: { value: 0.8 }, uH: { value: 0 }, uOpen: { value: 0 }, uTime: { value: 0 } };
  const rayMat = new THREE.ShaderMaterial({ vertexShader: RAY_V, fragmentShader: RAY_F, uniforms: portalFx, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const portalRays = new THREE.Mesh(portalRayGeo(), rayMat); portalRays.position.set(0, 0, 3.95); portalRays.rotation.y = Math.PI; portalRays.frustumCulled = false; g.add(portalRays);
  const glowG = G('portalGlowG', () => { const q = new THREE.PlaneGeometry(4.6, 3.4); q.translate(0, 1.5, 0); return q; });
  const portalGlow = new THREE.Mesh(glowG, new THREE.ShaderMaterial({ vertexShader: GLOW_V, fragmentShader: GLOW_F, uniforms: portalFx, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  portalGlow.position.set(0, 0, 3.988); portalGlow.rotation.y = Math.PI; g.add(portalGlow);
  portalRays.onBeforeRender = () => {
    portalFx.uOpen.value = portal.visible ? Math.min(1, pl.intensity / 11) * (rim.material.opacity ?? 1) : 0;
    portalFx.uH.value = 2.42 * portal.scale.y; portalFx.uTime.value = performance.now() / 1000;
  };
  // open the doorway: k 0..1 grows the arch, the light and the shafts together
  const openPortal = (k) => { portal.visible = true; portal.scale.y = Math.max(0.001, k); pl.intensity = 11 * k; };
  // the furniture's shadows thrown away from the open doorway (a multiply overlay on floor and walls)
  const shadowU = { uAmt: { value: 0 }, uBmin: { value: FURN.map((b) => new THREE.Vector3(b[0], b[2], b[4])) }, uBmax: { value: FURN.map((b) => new THREE.Vector3(b[1], b[3], b[5])) } };
  const shadowMesh = new THREE.Mesh(G('portalShadowG', () => merge([[new THREE.PlaneGeometry(5, 6), M(0, 0.003, 1, -PI / 2)], [new THREE.PlaneGeometry(5, 2.6), M(0, 1.3, -1.996)], [new THREE.PlaneGeometry(6, 2.6), M(-2.496, 1.3, 1, 0, PI / 2)], [new THREE.PlaneGeometry(6, 2.6), M(2.496, 1.3, 1, 0, -PI / 2)]])),
    new THREE.ShaderMaterial({ vertexShader: PSH_V, fragmentShader: PSH_F, uniforms: shadowU, transparent: true, depthWrite: false, blending: THREE.MultiplyBlending }));
  shadowMesh.renderOrder = -1; shadowMesh.frustumCulled = false; shadowMesh.visible = false; g.add(shadowMesh);
  // the smoke alarm's LED, a red blink every few seconds
  const ledM = new THREE.MeshBasicMaterial({ color: 0x100000 });
  g.add(mesh(G('ledG', () => new THREE.SphereGeometry(0.005, 8, 6)), ledM, 0.77, 2.565, 2.1));
  // per frame, no allocation: moon colour (brightens with R.glass, e.g. headlights or day), branch sway, sky, silhouettes, shadows
  floor.onBeforeRender = () => {
    const t = performance.now() / 1000, gc = glassM.color, lum = 0.2126 * gc.r + 0.7152 * gc.g + 0.0722 * gc.b;
    MOONU.uSway.value = Math.sin(t * 0.37) * 0.012 + Math.sin(t * 0.91) * 0.005;
    MOONU.uMoonCol.value.setRGB(moonBase.r + gc.r * 3, moonBase.g + gc.g * 3, moonBase.b + gc.b * 3);
    skyFx.uNight.value = 1 - smooth(0.06, 0.4, lum); skyFx.uTime.value = t;
    silM.color.setRGB(gc.r * 0.15, gc.g * 0.15, gc.b * 0.15); treeM.color.copy(silM.color);
    shadowU.uAmt.value = portal.visible ? Math.min(1, pl.intensity / 11) : 0; shadowMesh.visible = shadowU.uAmt.value > 0.001;
    ledM.color.setRGB(t % 3.2 < 0.1 ? 0.3 : 0.025, 0.004, 0.002);   // dim: a small LED, not a lamp
  };
  return { group: g, setClock, clock, clockLight, glass: glassM, glare, amb, moon, portal, portalLight: pl, farWall, ceiling, body, blanket, pillows, messBed, openPortal, portalRays, portalGlow, portalFx };
}
