"""
Sculpted props for the duel maps, built in Blender from code (no hand edits),
exported one GLB each. Run:
  blender -b -P tools/blender/props.py -- <out_dir>
Units are metres, +Y up in the exported GLB (Blender's +Z up converts).
Every prop's origin is its footprint centre at floor level.
"""
import bpy, bmesh, math, sys, os

out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '.'
os.makedirs(out, exist_ok=True)

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def export(name):
    for o in bpy.data.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, name + '.glb'), export_format='GLB',
                              use_selection=True, export_apply=True, export_yup=True,
                              export_normals=True, export_materials='NONE', export_texcoords=False)

def boolean(target, cutter, op='DIFFERENCE'):
    m = target.modifiers.new('b', 'BOOLEAN')
    m.operation = op
    m.object = cutter
    m.solver = 'EXACT'
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier='b')
    bpy.data.objects.remove(cutter)

def box(sx, sy, sz, x=0, y=0, z=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    o = bpy.context.object
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    return o

def cyl(r, depth, x=0, y=0, z=0, verts=24, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=(x, y, z), rotation=rot)
    return bpy.context.object

def join(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    # weld coincident verts so edges read cleanly
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(o.data); bm.free()
    return o

# ---------------------------------------------------------------- arch gate --
# 6 m wide, 4.2 m tall, 0.7 m thick wall; round-headed passage 2.6 m wide,
# 3.3 m to the crown; a keystone and a cornice band on top.
reset()
wall = box(6, 0.7, 4.2, z=2.1)
# Cut one cutter at a time: two overlapping cutters joined into one mesh are
# not a clean solid, and the exact solver then leaves their caps behind.
boolean(wall, box(2.6, 2.0, 2.0, z=1.0))                                # straight part
boolean(wall, cyl(1.3, 2.0, z=2.0, verts=24, rot=(math.pi / 2, 0, 0)))  # half-round top
key = box(0.5, 0.85, 0.6, z=3.55)                     # keystone
cornice = box(6.3, 0.95, 0.25, z=4.25)                # projecting cap
pl = box(0.5, 0.85, 3.3, x=-1.55, z=1.65)             # pilasters either side
pr = box(0.5, 0.85, 3.3, x=1.55, z=1.65)
join([wall, key, cornice, pl, pr])
export('arch')

# ---------------------------------------------------------------- fountain --
# Octagonal basin 5 m across with a raised rim, a tiered column and a bowl.
reset()
basin = cyl(2.5, 0.5, z=0.25, verts=8)
inner = cyl(2.15, 0.5, z=0.6, verts=8)
boolean(basin, inner)
rim = cyl(2.6, 0.12, z=0.56, verts=8)
ped = cyl(0.55, 0.9, z=0.7, verts=8)
col = cyl(0.3, 1.4, z=1.85, verts=12)
bowl = cyl(0.9, 0.25, z=2.2, verts=12)
top = cyl(0.18, 0.7, z=2.65, verts=12)
cap = cyl(0.32, 0.18, z=3.05, verts=12)
join([basin, rim, ped, col, bowl, top, cap])
export('fountain')
print('props exported to', out)
