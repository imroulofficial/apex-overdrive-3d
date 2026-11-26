"""Step 1 of the remaster pipeline: the original hyper3d source of a car -> a clean, watertight
body in the game frame, without the AI-generated wheels.

    python tools/cars/remaster/prep.py --car rp1_vanta --src "New Car 3.glb" --out build/remaster/rp1_vanta

- weld (the source splits every vertex on its normals: welded, the body is one closed shell)
- game frame: x forward (source +Z), y up, z right (source -X), scaled to cars.js length
- wheels: islands that sit in a wheel's box are dropped; where the AI fused a tyre to the body,
  the faces inside the wheel's cylinder are cut and the cut is closed again
- junk: small islands are dropped
- out: <car>_src.npz (V, F, UV per corner, the source texture path) and the texture PNG
"""

import argparse
import importlib
import math
import os
import sys

import bpy
import bmesh
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.dirname(HERE), os.path.join(os.path.dirname(HERE), 'defs')]

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument('--car', required=True)
ap.add_argument('--src', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--cut-margin', type=float, default=0.012, help='metres beyond the tyre radius')
ap.add_argument('--inboard', type=float, default=0.30, help='metres the cut reaches inboard of the tyre (hub, brake, arm junk)')
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True)

car = importlib.import_module(args.car)
L = car.LENGTH

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.src)
ob = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
img = None
for n in ob.data.materials[0].node_tree.nodes:
    if n.type == 'TEX_IMAGE':
        img = n.image
tex_path = os.path.join(args.out, f'{args.car}_src.png')
img.filepath_raw = tex_path
img.file_format = 'PNG'
img.save()

bm = bmesh.new()
bm.from_mesh(ob.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.verts.ensure_lookup_table()
bm.faces.ensure_lookup_table()

# Blender frame (glTF x, -z, y) -> game frame: x = glTF z = -blender y, y = blender z, z = -blender x
P = np.array([v.co[:] for v in bm.verts])
G = np.stack([-P[:, 1], P[:, 2], -P[:, 0]], 1)
span = G[:, 0].max() - G[:, 0].min()
s = L / span
G *= s
print(f'source length {span:.4f} -> scale {s:.4f}; y {G[:, 1].min():.3f}..{G[:, 1].max():.3f}', flush=True)
for v, g in zip(bm.verts, G):
    v.co = g

# wheel cylinders (game frame): centre (x, R, +-T), radius R, half width W/2
wheels = []
for x, R, T, W in ((car.XF, car.RF, car.TF, car.WF), (car.XR, car.RR, car.TR, car.WR)):
    for side in (-1, 1):
        wheels.append((np.array([x, R, side * T]), R, W))


def in_wheel(p, grow=0.0):
    for c, R, W in wheels:
        d = p - c
        r = math.hypot(d[0], d[1])
        out = d[2] * np.sign(c[2])  # + outboard
        if r < R + args.cut_margin + grow and -(W / 2 + args.inboard) - grow < out < W / 2 + 0.06 + grow:
            return True
    return False


# islands
def islands(bm):
    seen = set()
    out = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, comp = [f], []
        seen.add(f.index)
        while stack:
            x = stack.pop()
            comp.append(x)
            for e in x.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        out.append(comp)
    return out


isl = sorted(islands(bm), key=len, reverse=True)
kill = []
for comp in isl[1:]:
    c = np.array([v.co[:] for f in comp for v in f.verts])
    mid = (c.min(0) + c.max(0)) / 2
    if in_wheel(mid, 0.05) or len(comp) < 2000:
        kill += comp
        print(f'  drop island {len(comp)} faces at {np.round(mid, 3)}', flush=True)
bmesh.ops.delete(bm, geom=kill, context='FACES')
bm.faces.ensure_lookup_table()

# fused tyres: faces whose three corners are inside a wheel cylinder
cut = [f for f in bm.faces if all(in_wheel(np.array(v.co[:])) for v in f.verts)]
print(f'  cut {len(cut)} faces inside the wheel cylinders', flush=True)
bmesh.ops.delete(bm, geom=cut, context='FACES')
# anything the cut left floating
isl = sorted(islands(bm), key=len, reverse=True)
for comp in isl[1:]:
    print(f'  drop leftover island {len(comp)} faces', flush=True)
bmesh.ops.delete(bm, geom=[f for comp in isl[1:] for f in comp], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')

# close the cuts: every boundary loop gets a cap (fan from its centroid, so long loops stay clean)
bm.edges.ensure_lookup_table()
loops = []
bnd = {e for e in bm.edges if e.is_boundary}
while bnd:
    e = bnd.pop()
    loop = [e]
    v = e.verts[1]
    start = e.verts[0]
    guard = 0
    while v != start and guard < 100000:
        guard += 1
        nxt = [x for x in v.link_edges if x in bnd]
        if not nxt:
            break
        x = nxt[0]
        bnd.discard(x)
        loop.append(x)
        v = x.other_vert(v)
    loops.append(loop)
print(f'  {len(loops)} boundary loops: sizes {sorted(len(l) for l in loops)[-12:]}', flush=True)
uv = bm.loops.layers.uv.active
capl = bm.faces.layers.int.new('cap')
for loop in loops:
    edges = loop
    res = bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    faces = res['faces']
    if faces:
        tri = bmesh.ops.triangulate(bm, faces=faces)
        for f in tri['faces'] + faces:
            if f.is_valid:
                f[capl] = 1
bm.normal_update()
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
nb = sum(1 for e in bm.edges if not e.is_manifold)
print(f'  non-manifold edges after close: {nb}', flush=True)

bm.verts.ensure_lookup_table()
bm.faces.ensure_lookup_table()
bm.verts.index_update()
V = np.array([v.co[:] for v in bm.verts], dtype=np.float32)
F = np.array([[v.index for v in f.verts] for f in bm.faces if len(f.verts) == 3], dtype=np.int32)
quads = [f for f in bm.faces if len(f.verts) != 3]
assert not quads, f'{len(quads)} non-triangles'
UV = np.array([[l[uv].uv[:] for l in f.loops] for f in bm.faces], dtype=np.float32)
CAP = np.array([f[capl] for f in bm.faces], dtype=np.int8)
print(f'  {int(CAP.sum())} cap faces', flush=True)
np.savez_compressed(os.path.join(args.out, f'{args.car}_src.npz'), V=V, F=F, UV=UV, CAP=CAP, scale=s)
print(f'saved {len(V)} verts {len(F)} tris, bounds {np.round(V.min(0), 3)} {np.round(V.max(0), 3)}', flush=True)
