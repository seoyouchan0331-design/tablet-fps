"""Render each kit GLB up close (Workbench, 3/4 view), one PNG per piece.
   blender -b -P tools/blender/preview.py -- <glb_dir> <out_dir>"""
import bpy, sys, os, glob, math
from mathutils import Vector
args = sys.argv[sys.argv.index('--') + 1:]
src, outd = args[0], args[1]
os.makedirs(outd, exist_ok=True)
for f in sorted(glob.glob(os.path.join(src, '*.glb'))):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    neonm = bpy.data.materials.new('neon'); neonm.diffuse_color = (0.35, 0.65, 1.0, 1)
    stucco = bpy.data.materials.new('st'); stucco.diffuse_color = (0.62, 0.63, 0.66, 1)
    pts = []
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(neonm if o.name.startswith('neon') else stucco)
        pts += [o.matrix_world @ v.co for v in o.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    r = (hi - lo).length / 2
    d = r * 2.6
    cam_pos = c + Vector((d * 0.55, -d * 0.75, d * 0.45))
    bpy.ops.object.camera_add(location=cam_pos)
    cam = bpy.context.object
    cam.rotation_euler = (c - cam_pos).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 50
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'MATERIAL'
    sc.display.shading.show_cavity = True
    sc.display.shading.show_shadows = False
    sc.render.resolution_x = sc.render.resolution_y = 420
    sc.render.filepath = os.path.join(outd, os.path.basename(f)[:-4] + '.png')
    bpy.ops.render.render(write_still=True)
    print('rendered', sc.render.filepath)
