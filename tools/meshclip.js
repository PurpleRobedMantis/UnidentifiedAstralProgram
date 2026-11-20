// Mesh clipping check for headless drivers (tools/shot.js). Imported in the page:
//   const { meshChecker } = await import('/tools/meshclip.js');
//   const C = meshChecker(grey);      // call while the grey stands at rest (arms hanging): that pose is the zero
//   ... every frame: const r = C.check();  -> { n, depth, part, mesh, parts: { armR: { n, depth } } }
//
// What it tests: every vertex (stride 2 by default) of the grey's arms, hands and anything held in them (any mesh under
// armL/armR) against the triangles of the rest of its body (torso, head, legs), by generalised winding number per body
// mesh: a point is inside a mesh when |winding| > 0.5, which holds for open and overlapping meshes too. An inside point
// gets a depth: its distance to the nearest triangle of that mesh, in metres.
// Zero pose: vertices already inside the body at rest (where an arm meets the shoulder) are left out from then on, so
// only new penetration counts. Limb vertices within `seam` (3 cm) of the shoulder joint are left out too: a rigid arm
// turning in its socket always dips into the chest there (measured build 150: every such hit was within 2.3 cm). The game's watchdog (models.js greyArmHits) tests a few points on each bone against an
// ellipsoid and slices with a 1.2 cm margin; this tests the real surfaces with no margin, and reports how deep.
export function meshChecker(g, { stride = 2, seam = 0.03 } = {}) {
  const u = g.userData, arms = [u.armL, u.armR].filter(Boolean);
  const names = new Map(Object.entries(u).filter(([, o]) => o && o.isObject3D).map(([k, o]) => [o, k]));
  const partOf = (o) => { for (let p = o; p; p = p.parent) if (names.has(p)) return names.get(p); return '?'; };
  const underArm = (o) => { for (let p = o; p && p !== g; p = p.parent) if (arms.includes(p)) return true; return false; };
  const skip = new Set();   // limb vertices inside at the zero pose: 'meshuuid:index'

  const collect = () => {
    const body = [], limbs = [];
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.geometry || !o.geometry.attributes.position) return;
      for (let p = o; p; p = p.parent) if (!p.visible) return;
      (underArm(o) ? limbs : body).push(o);
    });
    return { body, limbs };
  };
  const world = (o) => {
    const P = o.geometry.attributes.position, m = o.matrixWorld.elements, n = P.count, out = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      out[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      out[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      out[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    return out;
  };
  const bodyData = (body) => body.map((o) => {
    const W = world(o), idx = o.geometry.index ? o.geometry.index.array : null, nt = idx ? idx.length / 3 : W.length / 9;
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let i = 0; i < W.length; i += 3) { x0 = Math.min(x0, W[i]); x1 = Math.max(x1, W[i]); y0 = Math.min(y0, W[i + 1]); y1 = Math.max(y1, W[i + 1]); z0 = Math.min(z0, W[i + 2]); z1 = Math.max(z1, W[i + 2]); }
    return { o, W, idx, nt, box: [x0, y0, z0, x1, y1, z1], part: partOf(o) };
  });
  const tri = (B, t) => B.idx ? [B.idx[t * 3], B.idx[t * 3 + 1], B.idx[t * 3 + 2]] : [t * 3, t * 3 + 1, t * 3 + 2];
  // generalised winding number of mesh B at p (van Oosterom & Strackee solid angle per triangle)
  const winding = (B, px, py, pz) => {
    const W = B.W; let s = 0;
    for (let t = 0; t < B.nt; t++) {
      const [i, j, k] = tri(B, t);
      const ax = W[i * 3] - px, ay = W[i * 3 + 1] - py, az = W[i * 3 + 2] - pz;
      const bx = W[j * 3] - px, by = W[j * 3 + 1] - py, bz = W[j * 3 + 2] - pz;
      const cx = W[k * 3] - px, cy = W[k * 3 + 1] - py, cz = W[k * 3 + 2] - pz;
      const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz);
      const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
      const den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la + (cx * ax + cy * ay + cz * az) * lb;
      s += 2 * Math.atan2(det, den);
    }
    return s / (4 * Math.PI);
  };
  // distance from p to the nearest triangle of B (closest point on a triangle, Ericson 5.1.5)
  const depthTo = (B, px, py, pz) => {
    const W = B.W; let best = 1e9;
    for (let t = 0; t < B.nt; t++) {
      const [i, j, k] = tri(B, t);
      const a = [W[i * 3], W[i * 3 + 1], W[i * 3 + 2]], b = [W[j * 3], W[j * 3 + 1], W[j * 3 + 2]], c = [W[k * 3], W[k * 3 + 1], W[k * 3 + 2]];
      const q = closest([px, py, pz], a, b, c), d = Math.hypot(q[0] - px, q[1] - py, q[2] - pz);
      if (d < best) best = d;
    }
    return best;
  };
  const inBox = (bx, x, y, z) => x > bx[0] && x < bx[3] && y > bx[1] && y < bx[4] && z > bx[2] && z < bx[5];

  const run = (record) => {
    const { body, limbs } = collect(), BD = bodyData(body);
    const res = { n: 0, depth: 0, part: '', mesh: '', parts: {} };
    const sh = {}; for (const sd of ['L', 'R']) { const a = u['arm' + sd]; if (a) { const e = a.matrixWorld.elements; sh[sd] = [e[12], e[13], e[14]]; } }
    for (const o of limbs) {
      const W = world(o), part = partOf(o);
      for (let i = 0; i < W.length / 3; i += stride) {
        const key = o.uuid + ':' + i; if (!record && skip.has(key)) continue;
        const x = W[i * 3], y = W[i * 3 + 1], z = W[i * 3 + 2];
        // the shoulder seam: a rigid upper arm turning in its socket dips into the chest round the joint; not a clip
        const S0 = sh[part.endsWith('L') ? 'L' : 'R']; if (!record && S0 && Math.hypot(x - S0[0], y - S0[1], z - S0[2]) < seam * (g.scale.x || 1)) continue;
        for (const B of BD) {
          if (!inBox(B.box, x, y, z)) continue;
          if (Math.abs(winding(B, x, y, z)) <= 0.5) continue;
          if (record) { skip.add(key); break; }
          const d = depthTo(B, x, y, z), P = res.parts[part] || (res.parts[part] = { n: 0, depth: 0, into: '', fromShoulder: 9 });
          const S = sh[part.endsWith('L') ? 'L' : 'R']; if (S) P.fromShoulder = Math.min(P.fromShoulder, Math.max(...[Math.hypot(x - S[0], y - S[1], z - S[2])]));
          P.far = Math.max(P.far || 0, S ? Math.hypot(x - S[0], y - S[1], z - S[2]) : 0);
          res.n++; P.n++;
          if (d > P.depth) { P.depth = d; P.into = B.part; }
          if (d > res.depth) { res.depth = d; res.part = part; res.mesh = B.part; }
          break;
        }
      }
    }
    return res;
  };
  run(true);
  return {
    skipped: () => skip.size,
    check: () => run(false),
  };
}

function closest(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const add = (u, v, s) => [u[0] + v[0] * s, u[1] + v[1] * s, u[2] + v[2] * s];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return add(add(a, ab, v), ac, w);
}
