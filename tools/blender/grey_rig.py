# Builds the small grey in Blender from the game's own joints and meshes, for keyframing clips by hand.
#   blender -b -P tools/blender/grey_rig.py -- anim/grey-rig.json anim/grey-rig.blend
# The JSON comes from the game (shots/b148/rigdump.js: a fresh makeGrey() plus the exam tray and probe).
# Every joint is an empty named exactly as the game's userData handle (root, neck, armR, foreR, handR, legL, kneeL...),
# holding its meshes. Everything sits under UAP_world, turned +90 degrees about X so three.js's y-up reads upright in
# Blender; inside it, positions and rotations are the game's own numbers. Animate the empties' rotation (quaternion) and
# root's location only; tools/blender/export_clip.py writes what is keyed to js/clips/*.js.
import bpy, json, sys, math
from mathutils import Matrix, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
d = json.load(open(src))

for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
sc = bpy.context.scene
sc.render.fps = 30

mats = {}
def mat(hexc):
    if hexc in mats: return mats[hexc]
    m = bpy.data.materials.new('c%06x' % hexc)
    r, g, b = [((hexc >> s) & 255) / 255 for s in (16, 8, 0)]
    m.diffuse_color = (r ** 2.2, g ** 2.2, b ** 2.2, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf: bsdf.inputs['Base Color'].default_value = (r ** 2.2, g ** 2.2, b ** 2.2, 1)
    mats[hexc] = m
    return m

def m4(e):   # three.js column-major elements to a Blender matrix
    return Matrix(((e[0], e[4], e[8], e[12]), (e[1], e[5], e[9], e[13]), (e[2], e[6], e[10], e[14]), (0, 0, 0, 1)))

def mesh(name, item, parent):
    p = item['p']; vs = [tuple(p[i:i + 3]) for i in range(0, len(p), 3)]
    idx = item['i'] if item['i'] is not None else list(range(len(vs)))
    fs = [tuple(idx[i:i + 3]) for i in range(0, len(idx) - 2, 3)]
    me = bpy.data.meshes.new(name); me.from_pydata(vs, [], fs); me.update()
    for poly in me.polygons: poly.use_smooth = True
    me.materials.append(mat(item['color']))
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob)
    ob.parent = parent; ob.matrix_basis = m4(item['mat'])
    ob.hide_select = True   # select the joints, not the skin
    return ob

world = bpy.data.objects.new('UAP_world', None); sc.collection.objects.link(world)
world.rotation_euler = (math.pi / 2, 0, 0); world.empty_display_size = 0.05

J = {}
for j in d['joints']:
    ob = bpy.data.objects.new(j['name'], None); sc.collection.objects.link(ob)
    ob.empty_display_type = 'SPHERE' if j['name'] not in ('grey',) else 'ARROWS'
    ob.empty_display_size = 0.02 if j['name'] != 'grey' else 0.15
    ob.rotation_mode = 'QUATERNION'
    ob.parent = J[j['parent']] if j['parent'] else world
    ob.location = j['pos']; x, y, z, w = j['quat']; ob.rotation_quaternion = Quaternion((w, x, y, z)); ob.scale = j['scale']
    ob.show_in_front = True
    J[j['name']] = ob
# where it stands for the put-down: at the tray, facing it (game: traySpot, rotation.y = pi)
g = J['grey']; g.location = d['place']['pos']; g.rotation_quaternion = Quaternion((0, 1, 0), d['place']['rotY'])

for i, m in enumerate(d['meshes']): mesh('skin.%s.%d' % (m['joint'], i), m, J[m['joint']])
for i, m in enumerate(d['world']): ob = mesh('%s.%d' % (m['what'], i), m, world)

# the rest pose of every joint, kept so a clip can be started from it
for name, ob in J.items(): ob['rest_quat'] = list(ob.rotation_quaternion); ob['rest_loc'] = list(ob.location)
bpy.ops.wm.save_as_mainfile(filepath=out)
print('saved', out, len(J), 'joints', len(d['meshes']), 'meshes')
