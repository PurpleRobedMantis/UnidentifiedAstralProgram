await steps(5);
const M = await import('/js/models.js'); const THREE = await import('three');
E.updaters.clear();
for (const c of [...E.scene.children]) c.visible = false;
for (const c of [...E.camera.children]) c.visible = false;
E.camera.visible = true;
E.scene.background = new THREE.Color(0x2a2a30); E.scene.fog = null;
const L = new THREE.Group(); E.scene.add(L);
L.add(new THREE.HemisphereLight(0xfff4ea, 0x403530, 1.2));
const d = new THREE.DirectionalLight(0xfff0e0, 2.2); d.position.set(1, 2, 1.5); L.add(d);
const d2 = new THREE.DirectionalLight(0xc0d0ff, 0.6); d2.position.set(-1, 0.5, -1); L.add(d2);
E.camera.position.set(0, 0, 0); E.camera.rotation.set(0, 0, 0); E.camera.fov = 22; E.camera.updateProjectionMatrix();
const me = M.makePlayerBody(); E.camera.add(me); me.visible = true;
window.__me = me;
me.userData.examineHand(0.28);
__me.userData.examineHand(0.5);

E.pitch = 0.2; E.yaw = -0.1; __me.rotation.set(0, 0, 0); __me.quaternion.setFromEuler(new (await import('three')).Euler(0.2, -0.1, 0, 'YXZ')).invert(); E.camera.fov = 14; E.camera.updateProjectionMatrix();
await snap('nails');
