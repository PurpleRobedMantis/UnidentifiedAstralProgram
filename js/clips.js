// Keyframed clips for the beings, made in Blender (anim/*.blend, exported by tools/blender/export_clip.py to js/clips/).
// Build 148 pilot: the probe grey's put-down. The clip poses the body (what touches nothing); anything that reaches,
// holds or touches is still solved by kinematics afterwards, every frame, on top of the clip's pose.
// A clip's tracks name the grey's joints by their userData handle ('root.quaternion', 'armR.quaternion',
// 'root.position'); its marks (seconds) are the game's timing for that move.
import * as THREE from 'three';

const cache = new Map(), warned = new Set();
export function loadClip(data) {
  if (cache.has(data)) return cache.get(data);
  const clip = THREE.AnimationClip.parse({ name: data.name, duration: data.duration, tracks: data.tracks });
  const c = { clip, marks: data.marks || {}, duration: data.duration, tracks: clip.tracks.map((tr) => { const [joint, prop] = tr.name.split('.'); return { joint, prop, interp: tr.createInterpolant() }; }) };
  cache.set(data, c);
  return c;
}

// What a clip actually holds, before using it: its name, length, marks and one 'joint.prop' per track.
export function clipInfo(c) {
  return { name: c.clip.name, duration: c.duration, marks: { ...c.marks }, tracks: c.tracks.map((t) => t.joint + '.' + t.prop) };
}
// The clip's tracks whose joint the rig g does not have (a renamed or missing joint is otherwise silently skipped).
export function missingJoints(g, c) {
  return c.tracks.filter((t) => !(g.userData[t.joint] && g.userData[t.joint].isObject3D)).map((t) => t.joint + '.' + t.prop);
}

const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
// Puts grey g in the clip's pose at time t (seconds; clamped to the clip). w (0..1) blends from its current pose.
// only(joint): a function returning false (or a weight 0..1) to leave a joint out or blend it by itself.
export function poseClip(g, c, t, w = 1, only = null) {
  const u = g.userData, tt = Math.max(0, Math.min(c.duration, t));
  for (const tr of c.tracks) {
    const o = u[tr.joint];
    if (!o) { const k = c.clip.name + ':' + tr.joint; if (!warned.has(k)) { warned.add(k); console.warn('clip ' + c.clip.name + ': the rig has no joint ' + tr.joint + '; track skipped'); } continue; }
    let k = w; if (only) { const r = only(tr.joint); if (r === false) continue; if (typeof r === 'number') k *= r; }
    if (k <= 0) continue;
    const v = tr.interp.evaluate(tt);
    if (tr.prop === 'quaternion') { _q.fromArray(v).normalize(); if (k >= 1) o.quaternion.copy(_q); else o.quaternion.slerp(_q, k); }
    else if (tr.prop === 'position') { _v.fromArray(v); if (k >= 1) o.position.copy(_v); else o.position.lerp(_v, k); }
  }
}
