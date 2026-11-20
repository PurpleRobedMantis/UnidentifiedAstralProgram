# Renders a grey clip .blend at given times from a game camera, to compare with the game's own stills.
#   blender -b anim/grey-putdown.blend -P tools/blender/render_check.py -- <out-prefix> <camx,camy,camz> <atx,aty,atz> t1 t2 ...
# Camera points are in game (three.js) coordinates.
import bpy, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
pre = argv[0]
g2b = lambda s: (lambda x, y, z: Vector((x, -z, y)))(*map(float, s.split(',')))
cp, at = g2b(argv[1]), g2b(argv[2])
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.render.resolution_x, sc.render.resolution_y = 640, 360
sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'MATERIAL'
for o in bpy.data.objects:
    if o.type == 'EMPTY': o.hide_render = True
cam = bpy.data.cameras.new('cam'); cam.lens = 24; co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co)
co.location = cp; co.rotation_euler = (at - cp).to_track_quat('-Z', 'Y').to_euler(); sc.camera = co
for t in argv[3:]:
    sc.frame_set(round(float(t) * sc.render.fps) + 1)
    sc.render.filepath = '%s-%s.png' % (pre, t); bpy.ops.render.render(write_still=True)
print('rendered')
