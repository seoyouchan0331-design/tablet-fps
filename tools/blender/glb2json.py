"""
GLB props -> src/arena/props.json: per prop, flat positions (mm-rounded) and
triangle indices, plus its bounds. The map code merges these into the one
arena mesh like any other piece (no extra draw calls, no file loads, and it
works on hosts that refuse .glb).
  python3 tools/blender/glb2json.py <dir with *.glb> src/arena/props.json
"""
import json, struct, sys, os, glob

def read_glb(path):
    d = open(path, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    bin_ = d[20 + jl + 8:]
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        n = a['count']; comps = {'SCALAR': 1, 'VEC3': 3}[a['type']]
        fmt = {5126: 'f', 5123: 'H', 5125: 'I'}[a['componentType']]
        size = struct.calcsize(fmt)
        stride = bv.get('byteStride', comps * size)
        out = []
        for k in range(n):
            out.extend(struct.unpack_from('<' + fmt * comps, bin_, off + k * stride))
        return out
    pos, idx = [], []
    for node in j['nodes']:
        if 'mesh' not in node: continue
        t = node.get('translation', [0, 0, 0])
        for prim in j['meshes'][node['mesh']]['primitives']:
            p = acc(prim['attributes']['POSITION']); base = len(pos) // 3
            for k in range(0, len(p), 3):
                pos += [p[k] + t[0], p[k + 1] + t[1], p[k + 2] + t[2]]
            idx += [base + i for i in acc(prim['indices'])]
    return pos, idx

src, dst = sys.argv[1], sys.argv[2]
props = {}
for f in sorted(glob.glob(os.path.join(src, '*.glb'))):
    pos, idx = read_glb(f)
    pos = [round(v, 3) for v in pos]
    xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
    props[os.path.basename(f)[:-4]] = {
        'min': [min(xs), min(ys), min(zs)], 'max': [max(xs), max(ys), max(zs)],
        'positions': pos, 'indices': idx,
    }
    print(os.path.basename(f), len(pos) // 3, 'verts', len(idx) // 3, 'tris', 'bounds', props[os.path.basename(f)[:-4]]['min'], props[os.path.basename(f)[:-4]]['max'])
json.dump(props, open(dst, 'w'), separators=(',', ':'))
