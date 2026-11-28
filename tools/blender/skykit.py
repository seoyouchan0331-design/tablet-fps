"""
SKYBASE kit, modelled from code in Blender (headless) after the prop sheet:
white sci-fi panels with chamfered edges, inset panel seams, and blue neon
strips on chosen lines.
Run:   blender -b -P tools/blender/skykit.py -- <out_dir>
then   python3 tools/blender/glb2json.py <out_dir> <merged json>   (see README in tools/blender)

Same conventions as kit.py: +Y up after export, origin at the base centre,
objects named "neon*" become the glowing strips. Low poly (a few hundred
triangles each): chamfers are one bevel segment.
"""
import bpy, bmesh, math, sys, os

out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '.'
os.makedirs(out, exist_ok=True)
N = 0.035  # neon strip thickness


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _apply(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def box(sx, sy, sz, x=0.0, y=0.0, z=0.0, bevel=0.0, name='part'):
    """Box sx (x) by sy (depth, Blender y) by sz (up), centred at x, y, z; chamfered by `bevel`."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    o = bpy.context.object
    o.scale = (sx, sy, sz)
    o.name = name
    _apply(o)
    if bevel > 0:
        m = o.modifiers.new('bv', 'BEVEL')
        m.width = bevel
        m.segments = 1
        m.limit_method = 'NONE'
        bpy.ops.object.modifier_apply(modifier='bv')
    return o


def cyl(r, depth, x=0.0, y=0.0, z=0.0, verts=16, rot=(0, 0, 0), r2=None, name='part'):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=(x, y, z), rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=(x, y, z), rotation=rot)
    o = bpy.context.object
    o.name = name
    _apply(o)
    return o


def neon(sx, sy, sz, x=0.0, y=0.0, z=0.0):
    return box(sx, sy, sz, x, y, z, name='neon')


def rot_z(o, ang):
    o.rotation_euler = (0, 0, ang)
    _apply(o)


def export(name):
    """Join every non-neon object into one body, keep neon strips separate, export."""
    objs = list(bpy.data.objects)
    body = [o for o in objs if not o.name.startswith('neon')]
    lights = [o for o in objs if o.name.startswith('neon')]
    for group, label in ((body, name), (lights, 'neon')):
        if not group:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in group:
            o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        if len(group) > 1:
            bpy.ops.object.join()
        bpy.context.object.name = label
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, name + '.glb'), export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_normals=True, export_materials='NONE',
                              export_texcoords=False)


def crate_parts(cx=0.0, cy=0.0, z0=0.0, s=1.2, h=1.2, lights=True):
    """A sci-fi cargo crate: chamfered shell, a raised frame and X brace on each side, corner caps."""
    box(s, s, h, cx, cy, z0 + h / 2, bevel=0.05)
    f = 0.06  # frame bar
    for sx, sy, w, d in ((0, 1, s - 0.16, 0.03), (0, -1, s - 0.16, 0.03), (1, 0, 0.03, s - 0.16), (-1, 0, 0.03, s - 0.16)):
        px, py = cx + sx * (s / 2 + 0.01), cy + sy * (s / 2 + 0.01)
        # frame: top and bottom bars, two uprights
        for zz in (z0 + 0.12, z0 + h - 0.12):
            box(w if sy else 0.03, d if sx else 0.03, f, px, py, zz)
        for t in (-1, 1):
            ox, oy = (t * (s / 2 - 0.1), 0) if sy else (0, t * (s / 2 - 0.1))
            box(0.03 if sx else f, 0.03 if sy else f, h - 0.24, px + ox, py + oy, z0 + h / 2)
        # the X brace: two leaned bars
        diag = math.hypot(s - 0.3, h - 0.3)
        ang = math.atan2(h - 0.3, s - 0.3)
        for sgn in (-1, 1):
            b = box(diag, 0.03, f, px, py, z0 + h / 2) if sy else box(0.03, diag, f, px, py, z0 + h / 2)
            b.rotation_euler = (0, -sgn * ang, 0) if sy else (sgn * ang, 0, 0)
            _apply(b)
    # corner caps
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(0.16, 0.16, 0.1, cx + sx * (s / 2 - 0.05), cy + sy * (s / 2 - 0.05), z0 + h - 0.03, bevel=0.02)
            box(0.16, 0.16, 0.1, cx + sx * (s / 2 - 0.05), cy + sy * (s / 2 - 0.05), z0 + 0.03, bevel=0.02)
    if lights:
        # short neon dashes along the lid's front and back edges, like the art
        for sy in (-1, 1):
            for x in (-s / 2 + 0.28, s / 2 - 0.28):
                neon(0.26, N, N, cx + x, cy + sy * (s / 2 + 0.02), z0 + h - 0.1)


# ------------------------------------------------------------------ crate --
reset()
crate_parts()
export('skycrate')

# ------------------------------------------------------- stack of three --
reset()
crate_parts(0, 0, 0, s=1.1, h=0.8)
crate_parts(0, 0, 0.8, s=1.1, h=0.8, lights=False)
crate_parts(0, 0, 1.6, s=1.1, h=0.8)
for i in range(3):  # handle slots
    for sy in (-1, 1):
        box(0.24, 0.04, 0.07, 0.3, sy * 0.57, 0.62 + 0.8 * i)
export('skystack')

# --------------------------------------------------------------- barrier --
# 2.4 m cover wall, 1.15 m high: three panels between chamfered end posts
reset()
L, H, T = 2.4, 1.15, 0.36
box(L - 0.5, T - 0.08, H - 0.12, z=(H - 0.12) / 2, bevel=0.03)
for i in (-1, 0, 1):  # panel seams
    for sy in (-1, 1):
        box(0.03, 0.04, H - 0.32, i * 0.32 - 0.16 if i else 0.16, sy * (T / 2 - 0.02), H / 2 - 0.04)
for sx in (-1, 1):
    box(0.32, T + 0.08, H + 0.1, sx * (L / 2 - 0.16), 0, (H + 0.1) / 2, bevel=0.04)
    box(0.4, T + 0.14, 0.12, sx * (L / 2 - 0.16), 0, 0.06, bevel=0.02)  # foot
    box(0.36, T + 0.12, 0.08, sx * (L / 2 - 0.16), 0, H + 0.12, bevel=0.02)  # cap
box(L - 0.6, T - 0.02, 0.06, z=H - 0.09)  # top rail
for sy in (-1, 1):
    neon(L - 0.66, N, N, y=sy * (T / 2 + 0.005), z=H - 0.14)
export('barrier')

# --------------------------------------------------------------- railing --
# a 2 m railing section (decoration over the hidden collision wall)
reset()
L = 2.0
for sx in (-1, 1):
    box(0.2, 0.2, 1.05, sx * (L / 2 - 0.1), 0, 0.525, bevel=0.02)
    box(0.26, 0.26, 0.08, sx * (L / 2 - 0.1), 0, 1.07, bevel=0.015)
box(L - 0.2, 0.08, 0.08, z=0.98)  # top rail
box(L - 0.2, 0.06, 0.06, z=0.18)  # bottom rail
for i in range(5):
    box(0.035, 0.035, 0.8, -L / 2 + 0.35 + i * (L - 0.7) / 4, 0, 0.58)
neon(L - 0.24, N, N, z=1.03)
export('skyrail')

# --------------------------------------------------------------- antenna --
reset()
box(0.5, 0.5, 0.25, z=0.125, bevel=0.03)
for a in range(3):  # tripod legs
    ang = a * 2 * math.pi / 3
    leg = box(0.06, 0.06, 0.9, math.cos(ang) * 0.32, math.sin(ang) * 0.32, 0.35)
    leg.rotation_euler = (math.sin(ang) * 0.5, -math.cos(ang) * 0.5, 0)
    _apply(leg)
    box(0.16, 0.16, 0.05, math.cos(ang) * 0.55, math.sin(ang) * 0.55, 0.025)
cyl(0.05, 3.2, z=1.85, verts=10)
cyl(0.03, 0.9, x=0.12, z=3.0, verts=8)
box(0.14, 0.1, 0.4, x=0.12, y=0.08, z=2.2, bevel=0.015)
box(0.14, 0.1, 0.3, x=-0.1, y=0.08, z=2.7, bevel=0.015)
box(0.12, 0.08, 0.22, x=-0.08, y=-0.07, z=1.5, bevel=0.015)
cyl(0.035, 0.5, z=3.7, verts=8, name='neon')
export('antenna')

# ------------------------------------------------------------ light strip --
reset()
box(2.0, 0.3, 0.1, z=0.05, bevel=0.03)
box(0.22, 0.34, 0.14, x=-0.92, z=0.07, bevel=0.03)
box(0.22, 0.34, 0.14, x=0.92, z=0.07, bevel=0.03)
neon(1.56, 0.1, 0.03, z=0.11)
export('lightstrip')

# ------------------------------------------------------------------- vent --
reset()
box(1.6, 1.3, 0.12, z=0.06, bevel=0.02)  # base plate
body = box(1.4, 1.1, 0.7, z=0.47, bevel=0.04)
box(1.2, 0.9, 0.12, z=0.88, bevel=0.03)  # cap
for i in range(5):  # louvres on the front
    lv = box(1.1, 0.05, 0.05, y=-0.57, z=0.25 + i * 0.1)
    lv.rotation_euler = (0.5, 0, 0)
    _apply(lv)
neon(1.22, N, N, y=-0.47, z=0.82)
neon(1.22, N, N, y=0.47, z=0.82)
export('vent')

# ------------------------------------------------------------------- dish --
reset()
box(0.7, 0.7, 0.3, z=0.15, bevel=0.04)
box(0.45, 0.45, 0.7, z=0.65, bevel=0.03)
cyl(0.14, 0.4, z=1.1, verts=12)
# the bowl, tilted back: a shallow cone, open side forward
bowl = cyl(1.0, 0.35, z=1.75, verts=28, r2=0.15, rot=(math.radians(-55), 0, 0))
T = (math.radians(-55), 0, 0)
rim = cyl(1.03, 0.04, z=1.75, verts=28, rot=T, name='neon')
inner = cyl(0.97, 0.2, z=1.75, verts=28, rot=T)
m = rim.modifiers.new('b', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = inner; m.solver = 'EXACT'
bpy.context.view_layer.objects.active = rim
bpy.ops.object.modifier_apply(modifier='b')
bpy.data.objects.remove(inner)
for a in range(3):  # feed struts to the horn
    ang = a * 2 * math.pi / 3
    s = box(0.03, 0.03, 0.95, math.cos(ang) * 0.35, -0.35 + math.sin(ang) * 0.25, 2.05)
    s.rotation_euler = (math.radians(-30), 0, ang * 0.2)
    _apply(s)
box(0.12, 0.12, 0.12, 0, -0.6, 2.35, bevel=0.02)
export('dish')

# --------------------------------------------------------------- aircraft --
# a small VTOL, 5.4 m long along x (nose +x), 4.8 m wingspan
reset()
box(3.2, 1.2, 0.9, x=0.2, z=1.0, bevel=0.18)  # fuselage
nose = cyl(0.55, 1.3, x=2.4, z=1.0, verts=8, r2=0.12, rot=(0, math.pi / 2, 0))
box(1.4, 0.95, 0.45, x=0.9, z=1.55, bevel=0.15)  # canopy
box(1.2, 0.9, 0.5, x=-1.8, z=1.05, bevel=0.12)  # tail boom
for sy in (-1, 1):
    wing = box(1.4, 2.0, 0.12, x=0.0, y=sy * 1.5, z=1.15, bevel=0.03)
    pod = cyl(0.36, 1.2, x=0.2, y=sy * 2.45, z=1.15, verts=12, rot=(0, math.pi / 2, 0))
    neon(N, 0.5, 0.5, x=0.82, y=sy * 2.45, z=1.15)  # engine glow ring (square)
    fin = box(0.6, 0.08, 0.7, x=-2.2, y=sy * 0.4, z=1.6, bevel=0.02)
    fin.rotation_euler = (sy * 0.35, 0, 0)
    _apply(fin)
    neon(0.5, N, N, x=-2.2, y=sy * 0.55, z=1.95)
    # skids
    box(2.6, 0.08, 0.08, x=0.2, y=sy * 0.55, z=0.12)
    for x in (-0.8, 1.0):
        box(0.08, 0.08, 0.5, x=x, y=sy * 0.55, z=0.4)
neon(1.0, N, N, x=0.9, y=-0.49, z=1.4)
neon(1.0, N, N, x=0.9, y=0.49, z=1.4)
export('aircraft')

# ----------------------------------------------------- floating island --
# far scenery: a rock cone hanging under a small walled town (12 m across)
reset()
rock = cyl(6.0, 8.0, z=-4.0, verts=9, r2=0.6, rot=(math.pi, 0, 0))
cyl(5.2, 2.2, z=-9.0 + 8.0, verts=9, r2=1.2, rot=(math.pi, 0, 0), name='rock2')
box(10.0, 8.0, 0.6, z=0.3, bevel=0.2)  # the deck on top
box(3.0, 3.0, 4.0, x=-2.0, y=1.0, z=2.6, bevel=0.1)
box(2.2, 2.2, 6.0, x=2.2, y=-1.0, z=3.6, bevel=0.1)
box(2.6, 2.6, 0.3, x=2.2, y=-1.0, z=6.7, bevel=0.05)
box(4.0, 2.0, 2.0, x=1.0, y=2.4, z=1.6, bevel=0.1)
neon(10.04, N, N, y=-4.02, z=0.55)
neon(10.04, N, N, y=4.02, z=0.55)
neon(N, 8.04, N, x=-5.02, z=0.55)
neon(N, 8.04, N, x=5.02, z=0.55)
neon(2.24, N, N, x=2.2, y=-2.12, z=6.0)
export('island')

# ------------------------------------------------------------ capture ring --
reset()
ring = cyl(1.6, 0.16, z=0.08, verts=32)
hole = cyl(1.1, 0.4, z=0.08, verts=32)
m = ring.modifiers.new('b', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = hole; m.solver = 'EXACT'
bpy.context.view_layer.objects.active = ring
bpy.ops.object.modifier_apply(modifier='b')
bpy.data.objects.remove(hole)
cyl(1.1, 0.06, z=0.03, verts=32)
for a in range(4):
    ang = a * math.pi / 2 + math.pi / 4
    b = box(0.5, 0.3, 0.22, math.cos(ang) * 1.45, math.sin(ang) * 1.45, 0.11, bevel=0.04)
    b.rotation_euler = (0, 0, ang)
    _apply(b)
glow = cyl(1.25, 0.02, z=0.17, verts=32, name='neon')
inner = cyl(1.18, 0.2, z=0.17, verts=32)
m = glow.modifiers.new('b', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = inner; m.solver = 'EXACT'
bpy.context.view_layer.objects.active = glow
bpy.ops.object.modifier_apply(modifier='b')
bpy.data.objects.remove(inner)
export('capring')

# ------------------------------------------------------------------ cloud --
# far below the deck: a cluster of flattened low-poly puffs, 18 m across
reset()
for (x, y, z, r) in ((0, 0, 0, 4.2), (4.5, 1.0, -0.6, 3.4), (-4.6, -0.8, -0.8, 3.2), (1.5, -3.0, -0.4, 3.0),
                     (-1.8, 3.2, -0.5, 3.1), (7.6, -1.6, -1.2, 2.2), (-7.4, 1.8, -1.3, 2.1), (2.4, 2.6, 1.0, 2.6)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=r, location=(x, y, z))
    o = bpy.context.object
    o.scale = (1.0, 0.8, 0.55)
    _apply(o)
export('cloud')
