await steps(5);
const M = await import('/js/models.js'); const THREE = await import('three');
E.updaters.clear();
for (const c of [...E.scene.children]) c.visible = false;
for (const c of [...E.camera.children]) c.visible = false;
E.camera.visible = true; E.scene.background = new THREE.Color(0x2a2a30); E.scene.fog = null;
const L = new THREE.Group(); E.scene.add(L);
L.add(new THREE.HemisphereLight(0xfff4ea, 0x403530, 1.2));
const d = new THREE.DirectionalLight(0xfff0e0, 2.2); d.position.set(1, 2, 1.5); L.add(d);
E.pitch = 0; E.yaw = 0; E.roll = 0; E.camera.position.set(0, 0, 0); E.camera.fov = 18; E.camera.updateProjectionMatrix();
const me = M.makePlayerBody(); E.camera.add(me); me.visible = true; window.__me = me;
const lg = me.userData.legs; lg.visible = true; lg.children.forEach((c) => (c.visible = true));
window.__T = THREE; window.__log = window.__log || [];
const fm = lg.children[1], g = fm.geometry, P = g.attributes.position;
let bad = 0; for (let t = 0; t < P.count; t += 3) { const sx = Math.sign(P.getX(t)); if (Math.sign(P.getX(t + 1)) !== sx || Math.sign(P.getX(t + 2)) !== sx) bad++; }
g.computeBoundingBox(); const bb = g.boundingBox;
__log.push(`tris ${P.count / 3} perFoot ${P.count / 6} mixedSign ${bad} attrs ${Object.keys(g.attributes)} index ${!!g.index} groups ${g.groups.length} box ${bb.min.toArray().map((v) => v.toFixed(3))} ${bb.max.toArray().map((v) => v.toFixed(3))}`);
// 2x2 close-up montage of the right foot: inner side, outer side, top from the front, back
me.visible = false;
window.__grid = new THREE.Group(); E.camera.add(__grid);
const R = new THREE.BufferGeometry(); for (const n of Object.keys(g.attributes)) { const A = g.attributes[n], k = A.itemSize, out = []; for (let t = 0; t < P.count; t += 3) if (P.getX(t) > 0) for (let j = 0; j < 3 * k; j++) out.push(A.array[t * k + j]); R.setAttribute(n, new THREE.Float32BufferAttribute(out, k)); }
for (const [rx, ry, x, y] of [[0.1, Math.PI / 2, -0.21, 0.12], [0.75, Math.PI * 0.82, 0.21, 0.12], [1.35, Math.PI, -0.21, -0.12], [0.25, -0.35, 0.21, -0.12]]) {
  const outer = new THREE.Group(), m = new THREE.Mesh(R, fm.material); m.position.set(-0.09, 0.78, 0.065);
  outer.rotation.set(rx, ry, 0, 'XYZ'); outer.position.set(x, y, -1.6); outer.add(m); __grid.add(outer);
}
await snap('grid');
__grid.visible = false; __me.visible = true;
window.__aim = (rx, ry, dist) => { const T = window.__T; __me.position.set(0, 0, 0); __me.rotation.set(rx, ry, 0, 'YXZ'); E.camera.updateMatrixWorld(true); const c = E.camera.worldToLocal(new T.Box3().setFromObject(__me.userData.legs.children[1]).getCenter(new T.Vector3())); __me.position.set(-c.x, -c.y, -c.z - dist); };
__aim(-0.55, -0.6 + Math.PI, 0.6);
await snap('ctx');
