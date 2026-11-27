"""
Modular town kit for the duel maps, modelled from code in Blender (headless),
after the art-direction sheet: grey stucco, thin neon only on chosen lines.
Run:   blender -b -P tools/blender/kit.py -- <out_dir>

Conventions (glTF, after Blender's +Z-up export):
  +Y up, origin at the piece's base. Wall-mounted pieces have their BACK on
  the plane z = 0 and stick out toward +Z (Blender -Y), centred on x = 0.
  Objects named "neon*" are exported as separate nodes: the game draws them
  with the neon material instead of the stucco.
Every piece is a few hundred triangles at most: no bevels, no textures.
"""
import bpy, bmesh, math, sys, os

out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '.'
os.makedirs(out, exist_ok=True)
N = 0.035  # neon strip thickness


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def box(sx, sf, sz, x=0.0, f=0.0, z=0.0, name='part'):
    """Box sized sx (across) x sf (out from the wall) x sz (up), centred at x,
    f (distance in front of the wall plane) and z (height of its centre)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -f, z))
    o = bpy.context.object
    o.scale = (sx, sf, sz)
    o.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o


def cyl(r, depth, x=0.0, f=0.0, z=0.0, verts=16, axis='Z', name='part'):
    rot = {'Z': (0, 0, 0), 'F': (math.pi / 2, 0, 0), 'X': (0, math.pi / 2, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=(x, -f, z), rotation=rot)
    o = bpy.context.object
    o.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o


def neon(sx, sf, sz, x=0.0, f=0.0, z=0.0):
    return box(sx, sf, sz, x, f, z, name='neon')


def cut(target, cutter):
    m = target.modifiers.new('b', 'BOOLEAN')
    m.operation = 'DIFFERENCE'
    m.object = cutter
    m.solver = 'EXACT'
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier='b')
    bpy.data.objects.remove(cutter)


def arch_cut(target, w, h, depth, f=0.0, x=0.0, verts=20):
    """Cut a round-headed opening w wide, h to the crown, through target."""
    spring = h - w / 2
    cut(target, box(w, depth, spring, x=x, f=f, z=spring / 2))
    cut(target, cyl(w / 2, depth, x=x, f=f, z=spring, verts=verts, axis='F'))


def rot_z(o, ang):
    o.rotation_euler = (0, 0, ang)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


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
        o = bpy.context.object
        o.name = label
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bm.to_mesh(o.data); bm.free()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, name + '.glb'), export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_normals=True,
                              export_materials='NONE', export_texcoords=False)
    print('exported', name)


# --------------------------------------------------------------- window ----
# Frame for a 1.4 x 1.2 opening (the wall supplies the hole), with a sill,
# a projecting head and two louvred shutters folded open against the wall.
reset()
W, H = 1.4, 1.2
box(W + 0.36, 0.14, 0.12, f=0.07, z=-0.06)                   # sill
box(W + 0.44, 0.16, 0.16, f=0.08, z=H + 0.08)                # head
box(W + 0.5, 0.1, 0.05, f=0.12, z=H + 0.19)                  # head cap
for sx in (-1, 1):
    box(0.12, 0.08, H, x=sx * (W / 2 + 0.06), f=0.04, z=H / 2)   # jambs
    sh = box(0.62, 0.05, H - 0.06, x=sx * (W / 2 + 0.12 + 0.31), f=0.05, z=H / 2)  # shutter leaf
    for k in range(5):                                         # louvres
        box(0.54, 0.035, 0.04, x=sx * (W / 2 + 0.12 + 0.31), f=0.09, z=0.16 + k * 0.2)
export('window')

# -------------------------------------------------------------- balcony ----
# Slab on two corbels with an iron railing: top rail, bottom rail, balusters.
reset()
BW, BD = 2.2, 0.85
box(BW, BD, 0.14, f=BD / 2, z=-0.07)                          # slab (top at 0)
box(BW + 0.06, 0.06, 0.06, f=BD + 0.0, z=-0.11)               # slab edge
for sx in (-0.75, 0.75):                                      # corbels
    box(0.18, 0.5, 0.18, x=sx, f=0.25, z=-0.23)
    box(0.18, 0.3, 0.14, x=sx, f=0.15, z=-0.39)
for sx in (-1, 1):
    box(0.04, BD, 0.04, x=sx * (BW / 2 - 0.04), f=BD / 2, z=0.95)  # side rails
box(BW - 0.04, 0.04, 0.05, f=BD - 0.04, z=0.97)                 # top rail
box(BW - 0.04, 0.04, 0.03, f=BD - 0.04, z=0.1)                  # bottom rail
n = 11
for k in range(n):                                              # balusters (square bars)
    box(0.025, 0.025, 0.88, x=-BW / 2 + 0.08 + k * (BW - 0.16) / (n - 1), f=BD - 0.04, z=0.53)
for k in range(1, 4):
    for sx in (-1, 1):
        box(0.025, 0.025, 0.88, x=sx * (BW / 2 - 0.04), f=k * BD / 4, z=0.53)
export('balcony')

# --------------------------------------------------------------- awning ----
# Sloped canopy with ribs (stripes as relief), a front valance and two brackets.
reset()
AW, AD, DROP = 2.4, 1.1, 0.45
can = box(AW, AD, 0.05, f=AD / 2, z=0)
can.rotation_euler = (math.atan2(DROP, AD), 0, 0)            # slopes down and out
bpy.context.view_layer.objects.active = can
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
can.location.z = -DROP / 2
for k in range(6):                                            # raised stripes
    rib = box(AW / 12, AD, 0.025, x=-AW / 2 + AW / 12 + k * AW / 6, f=AD / 2, z=0.035)
    rib.rotation_euler = (math.atan2(DROP, AD), 0, 0)
    bpy.context.view_layer.objects.active = rib
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    rib.location.z = -DROP / 2
for k in range(8):                                            # scalloped valance
    box(AW / 8 - 0.02, 0.03, 0.2 if k % 2 == 0 else 0.15, x=-AW / 2 + AW / 16 + k * AW / 8, f=AD, z=-DROP - 0.1)
for sx in (-1, 1):                                            # brackets
    br = box(0.04, 1.2, 0.04, x=sx * (AW / 2 - 0.1), f=0.55, z=-0.55)
    br.rotation_euler = (-0.6, 0, 0)
    bpy.context.view_layer.objects.active = br
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
export('awning')

# ----------------------------------------------------------- door frame ----
# Moulded frame for a 1.6 x 2.4 doorway: jambs on plinths, lintel, cornice.
reset()
DW, DH = 1.6, 2.4
for sx in (-1, 1):
    box(0.22, 0.12, DH, x=sx * (DW / 2 + 0.11), f=0.06, z=DH / 2)
    box(0.3, 0.16, 0.3, x=sx * (DW / 2 + 0.11), f=0.08, z=0.15)
box(DW + 0.6, 0.16, 0.26, f=0.08, z=DH + 0.13)
box(DW + 0.76, 0.24, 0.08, f=0.12, z=DH + 0.3)
neon(DW + 0.76, N, N, f=0.25, z=DH + 0.3)
export('doorframe')

# ------------------------------------------------------- arched doorway ----
# Free-standing arched door wall (as on the sheet): 3.6 wide, 4.0 tall.
reset()
wall = box(3.6, 0.6, 4.0, f=0.0, z=2.0)
arch_cut(wall, 1.8, 3.1, 1.0)
for sx in (-1, 1):
    box(0.5, 0.75, 2.1, x=sx * 1.15, f=0.0, z=1.05)            # impost piers
    box(0.62, 0.85, 0.22, x=sx * 1.15, f=0.0, z=2.2)           # impost blocks
    box(0.62, 0.85, 0.3, x=sx * 1.15, f=0.0, z=0.15)           # plinths
    neon(0.62, N, N, x=sx * 1.15, f=0.44, z=2.13)              # impost glow (front)
    neon(0.62, N, N, x=sx * 1.15, f=-0.44, z=2.13)             # and back
box(0.42, 0.75, 0.55, f=0.0, z=3.3)                             # keystone
box(3.8, 0.75, 0.2, f=0.0, z=4.1)                               # cap
export('archdoor')

# ----------------------------------------------------------- colonnade ----
# Three arches on square piers, impost bands glowing, beam and cornice.
reset()
CW, CH, CD = 9.0, 4.6, 0.9
beam = box(CW, CD, CH, z=CH / 2)
for k in (-1, 0, 1):
    arch_cut(beam, 2.0, 3.5, 2.0, x=k * 3.0)
for k in (-1.5, -0.5, 0.5, 1.5):
    x = k * 3.0
    box(0.7, CD + 0.12, 0.32, x=x, z=0.16)                       # plinth
    box(0.7, CD + 0.12, 0.2, x=x, z=2.6)                         # impost block
    neon(0.7, N, N, x=x, f=(CD + 0.12) / 2 + 0.01, z=2.52)
    neon(0.7, N, N, x=x, f=-(CD + 0.12) / 2 - 0.01, z=2.52)
box(CW + 0.3, CD + 0.25, 0.22, z=CH + 0.11)                     # cornice
neon(CW + 0.3, N, N, f=(CD + 0.25) / 2 + 0.01, z=CH + 0.02)
export('colonnade')

# -------------------------------------------------------------- stairs ----
# Straight stone flight with a solid side wall: rises 3.2 m over 5.6 m,
# 1.6 m wide, steps toward +Z (out from the wall it stands against is -X).
reset()
RISE, RUN, SW, STEPS = 3.2, 5.6, 1.6, 16
for k in range(STEPS):
    h = RISE * (k + 1) / STEPS
    box(SW, RUN / STEPS, h, x=0, f=-(RUN / 2) + RUN * (k + 0.5) / STEPS, z=h / 2)
side = box(0.3, RUN, RISE + 0.9, x=SW / 2 + 0.15, f=0, z=(RISE + 0.9) / 2)
# trim the side wall to a slope: cut a big rotated box off its top
cutter = box(0.6, RUN * 1.6, 3.0, x=SW / 2 + 0.15, f=0, z=RISE + 0.9 + 1.5)
cutter.rotation_euler = (-math.atan2(RISE, RUN), 0, 0)
bpy.context.view_layer.objects.active = cutter
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
cutter.location.z -= 1.2
cut(side, cutter)
neon(N, RUN * 1.03, N, x=SW / 2 + 0.31, f=0, z=RISE / 2 + 0.85)  # handrail glow, will be sloped
n2 = bpy.data.objects['neon']
n2.rotation_euler = (-math.atan2(RISE, RUN), 0, 0)
bpy.context.view_layer.objects.active = n2
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
export('stairs')

# ------------------------------------------------------------ pilaster ----
# Corner pilaster for a 6.7 m two-storey house: plinth, shaft, mid band,
# capital; neon up the outer edge and around the capital.
reset()
PH = 6.7
box(0.7, 0.7, 0.45, z=0.225)
box(0.56, 0.56, PH - 0.75, z=0.45 + (PH - 0.75) / 2)
box(0.66, 0.66, 0.16, z=3.2)
box(0.72, 0.72, 0.3, z=PH - 0.15)
box(0.8, 0.8, 0.08, z=PH + 0.04)
neon(N, N, PH - 1.0, x=0.29, f=0.29, z=0.5 + (PH - 1.0) / 2)
neon(0.74, N, N, f=0.37, z=PH - 0.32)
export('pilaster')

# ------------------------------------------------------------- cornice ----
# 1 m of roof cornice (stretched along X in the game), stepped profile.
reset()
box(1.0, 0.18, 0.14, f=0.09, z=0.07)
box(1.0, 0.3, 0.1, f=0.15, z=0.19)
box(1.0, 0.42, 0.08, f=0.21, z=0.28)
neon(1.0, N, N, f=0.43, z=0.28)
export('cornice')

# ----------------------------------------------------------- bell tower ----
# 3.4 m square, 13 m tall: plain base, mid cornice, open belfry with an arch
# on each face, pyramid cap. Neon on the belfry edges and the mid cornice.
reset()
T, BH = 3.4, 8.0
box(T, T, BH, z=BH / 2)
box(T + 0.3, T + 0.3, 0.3, z=BH + 0.15)                          # mid cornice
bel = box(T, T, 3.4, z=BH + 0.3 + 1.7)
for ang in (0, math.pi / 2):
    c1 = box(1.4, T * 2, 2.0, z=BH + 0.3 + 1.0 + 0.2)
    c2 = cyl(0.7, T * 2, z=BH + 0.3 + 2.2, verts=16, axis='F')
    if ang:
        rot_z(c1, ang); rot_z(c2, ang)
    cut(bel, c1); cut(bel, c2)
box(T + 0.2, T + 0.2, 0.2, z=BH + 3.8)
bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=T * 0.78, radius2=0.05, depth=1.8, location=(0, 0, BH + 3.9 + 0.9), rotation=(0, 0, math.pi / 4))
for sx in (-1, 1):
    for sf in (-1, 1):
        neon(N, N, 3.4, x=sx * (T / 2 + 0.01), f=sf * (T / 2 + 0.01), z=BH + 0.3 + 1.7)
neon(T + 0.3, N, N, f=(T + 0.3) / 2 + 0.01, z=BH + 0.05)
neon(T + 0.3, N, N, f=-(T + 0.3) / 2 - 0.01, z=BH + 0.05)
export('belltower')

# -------------------------------------------------------------- parapet ----
# 1 m of low wall with an iron railing (stretched along X in the game).
reset()
box(1.0, 0.35, 0.9, z=0.45)
box(1.0, 0.45, 0.08, z=0.94)
box(1.0, 0.04, 0.04, z=1.75)
for k in range(3):
    box(0.025, 0.025, 0.8, x=-0.33 + k * 0.33, z=1.35)
neon(1.0, N, N, f=0.235, z=0.9)
export('parapet')
print('kit done ->', out)
