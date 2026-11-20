# The probe grey putting the probe back on the tray (exam), keyed on the grey rig.
#   blender -b anim/grey-rig.blend -P tools/blender/clip_putdown.py -- anim/grey-putdown.blend
# Writes a first version of the clip; after that, edit anim/grey-putdown.blend by hand in Blender and export it with
# tools/blender/export_clip.py. Do not rerun this over hand edits.
#
# What the clip owns: the body (lean from the hips with the feet planted, the free left arm hanging) for the whole
# put-down, and the probe arm only from the 'clear' marker (hand off the probe) to the end: the drop to hang. While the
# hand holds the probe the game solves that arm itself (kinematics to the probe's place); the head is aimed by the game.
# Markers (seconds = (frame - 1) / 30) set the game's timing: level, down, release, clear, hang. Change them here or in
# Blender's timeline and the game follows.
import bpy, sys, math
from mathutils import Quaternion

argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]
sc = bpy.context.scene
FPS = 30
F = lambda t: round(t * FPS) + 1
sc.frame_start, sc.frame_end = 1, F(3.6)

X = lambda a: Quaternion((1, 0, 0), a)   # turn about the joint's own x: + swings a hanging limb back, tips the body forward
ob = bpy.data.objects

def keyq(name, t, q):
    o = ob[name]; o.rotation_quaternion = q; o.keyframe_insert('rotation_quaternion', frame=F(t))
def keyl(name, t, v):
    o = ob[name]; o.location = v; o.keyframe_insert('location', frame=F(t))

# lean from the hips, feet planted (as night.js lean(): the body turns about the hip, 0.36 m up, and the legs turn back)
LEAN = [(0.0, 0.0), (0.9, 0.09), (1.5, 0.16), (1.85, 0.16), (2.2, 0.12), (3.0, 0.02), (3.4, 0.0), (3.6, 0.0)]
for t, L in LEAN:
    keyq('root', t, X(L)); keyl('root', t, (0, 0.36 - 0.36 * math.cos(L), -0.36 * math.sin(L)))
    keyq('legL', t, X(-L)); keyq('legR', t, X(-L))
    # the free arm hangs: it turns forward as much as the body tips, a little less, so it swings a touch behind
    keyq('armL', t, X(-0.85 * L)); keyq('foreL', t, X(-0.05 - 0.45 * L))
# the probe arm, from the hand coming off the probe: the shoulder leads down, the elbow and wrist trail and settle
for t, a, e, w in [(2.2, -0.55, -0.85, -0.15), (2.7, -0.22, -0.5, -0.25), (3.1, 0.05, -0.16, -0.1), (3.5, 0.0, -0.07, -0.04), (3.6, 0.0, -0.07, -0.04)]:
    keyq('armR', t, X(a)); keyq('foreR', t, X(e)); keyq('handR', t, X(w))

for name, t in [('level', 0.9), ('down', 1.5), ('release', 1.85), ('clear', 2.2), ('hang', 3.2)]:
    sc.timeline_markers.new(name, frame=F(t))
bpy.ops.wm.save_as_mainfile(filepath=out)
print('saved', out)
