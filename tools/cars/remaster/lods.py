"""Step 3: the classified source body -> per-LOD game meshes (Blender).

    python tools/cars/remaster/lods.py --car rp1_vanta [--lods showroom,drive,race]

For each LOD (showroom / drive / race):
- shell: the whole closed source shell (glass included) decimated in one pass (Blender
  DECIMATE collapse = quadric edge collapse, symmetric about the centre plane). No UVs or classes
  constrain it, so the error goes where the shape allows it.
- classes on the LOD: every LOD face takes the source class at its centre and corners (majority),
  then the class borders are snapped onto the source's own border lines (window openings, paint /
  trim edges come out as clean curves, not the zig-zag of a decimated per-face mask)
- source texture coordinates and shading normals re-projected per corner from the high-poly
  source (nearest point, same UV island), so the baked textures and the glossy paint read as on
  the original
- glass: limited dissolve of the panes (stage 2), then 3 mm slabs; door panes -> window_L / _R
- body: the rest, plus an inner skin (the same mesh 4 mm in, thinner on thin parts) joined by
  returns round the window openings: closed (open edges 0), dark inside behind the glass
- lenses: the bright head-lamp and red tail-lamp faces copied 0.5-2.5 mm proud of the body as
  closed slabs (headlight_lens / taillight_lens nodes)
- deviation: 150k source vertices -> nearest point on the LOD shell: max / p99 / mean

Out: build/remaster/<car>/<car>_<lod>.npz with {part}_V, _F, _UV, _K (key index), _N (corner
normals) and KEYS, plus <car>_deviation.json.
"""
import argparse
import json
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cars_cfg import CFG  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument('--car', required=True)
ap.add_argument('--lods', default='showroom,drive,race')
args = ap.parse_args(argv)
car = args.car
cfg = CFG[car]
B = os.path.join(HERE, '..', 'build', 'remaster', car)
d = np.load(os.path.join(B, f'{car}_cls.npz'))
V, F, UV, C = d['V'], d['F'], d['UV'], d['C']

# triangle targets per LOD (outer body, inner skin, glass, each lens set)
TARGET = {
    'showroom': dict(body=cfg.get('body_tris', 32000), glass=2600, lens=500),
    'drive': dict(body=cfg.get('body_tris_drive', 7600), glass=700, lens=140),
    'race': dict(body=cfg.get('body_tris_race', 1650), glass=180, lens=30),
}
INNER_T = 0.004
GLASS_T = 0.003
KEYS = ['src:trim', 'paint:src', 'glass', 'src:trim', 'src:trim', 'body:well', 'int:skin', 'headlight_lens',
        'taillight_lens']   # by class (0-5), then inner skin, lenses


# source vertex normals (area weighted) and a BVH of the source, for the normal transfer
_FN = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
VN = np.zeros_like(V, dtype=np.float64)
for _k in range(3):
    np.add.at(VN, F[:, _k], _FN)
VN /= np.maximum(np.linalg.norm(VN, axis=1, keepdims=True), 1e-12)
_BVH = None


def flat_normals(Vx, Fx):
    n = np.cross(Vx[Fx[:, 1]] - Vx[Fx[:, 0]], Vx[Fx[:, 2]] - Vx[Fx[:, 0]])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    return np.repeat(n[:, None, :], 3, 1)


def _islands():
    """UV island id per source face (faces joined by an edge whose two UVs agree)."""
    par = np.arange(len(F))

    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x
    E = {}
    for i, f in enumerate(F):
        for j in range(3):
            a_, b_ = f[j], f[(j + 1) % 3]
            key = (min(a_, b_), max(a_, b_))
            uv = (UV[i, j], UV[i, (j + 1) % 3]) if a_ < b_ else (UV[i, (j + 1) % 3], UV[i, j])
            if key in E:
                k, uvk = E[key]
                if np.abs(uv[0] - uvk[0]).max() < 1e-5 and np.abs(uv[1] - uvk[1]).max() < 1e-5:
                    ra, rb = find(i), find(k)
                    if ra != rb:
                        par[ra] = rb
            else:
                E[key] = (i, uv)
    return np.array([find(i) for i in range(len(F))])


ISL = None


def bvh():
    global _BVH
    if _BVH is None:
        _BVH = BVHTree.FromPolygons([tuple(v) for v in V.astype(np.float64)], [tuple(f) for f in F])
    return _BVH


def _bary(fi, p, clip=True):
    a, b, c = V[F[fi]].astype(np.float64)
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
    d20, d21 = v2 @ v0, v2 @ v1
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-18:
        return np.array([1 / 3, 1 / 3, 1 / 3])
    vb = (d11 * d20 - d01 * d21) / den
    wb = (d00 * d21 - d01 * d20) / den
    w = np.array([1 - vb - wb, vb, wb])
    if clip:
        w = np.clip(w, 0, 1)
        w /= max(w.sum(), 1e-12)
    return w


def corner_attrs(Vx, Fx, want_uv=True):
    """Per-corner shading normal and source UV of a LOD surface, from the high-poly source.
    Each corner is sampled at a point nudged 15 % toward its face centre (a corner on a crease
    or a class border reads its own side). Normal: the source's interpolated vertex normal (the
    face normal where they disagree by more than 60 degrees). UV: interpolated on the nearest
    source face when it lies in the same UV island as the face centre's source face, else
    extrapolated on that face (a corner across a UV seam must not jump to another island)."""
    global ISL
    if want_uv and ISL is None:
        ISL = _islands()
    T = bvh()
    cen = Vx[Fx].mean(1)
    fl = flat_normals(Vx, Fx)
    N = np.zeros((len(Fx), 3, 3))
    U = np.zeros((len(Fx), 3, 2))
    for i in range(len(Fx)):
        fc = T.find_nearest(Vector(cen[i]))[2] if want_uv else None
        for j in range(3):
            p = Vx[Fx[i, j]] * 0.85 + cen[i] * 0.15
            loc, _, fi, _ = T.find_nearest(Vector(p))
            if loc is None:
                N[i, j] = fl[i, j]
                continue
            w = _bary(fi, np.asarray(loc))
            n = (VN[F[fi]] * w[:, None]).sum(0)
            n /= max(np.linalg.norm(n), 1e-12)
            N[i, j] = n if n @ fl[i, j] > 0.5 else fl[i, j]
            if want_uv:
                if fc is None or ISL[fi] == ISL[fc]:
                    U[i, j] = (UV[fi] * w[:, None]).sum(0)
                else:
                    we = _bary(fc, Vx[Fx[i, j]], clip=False)
                    U[i, j] = (UV[fc] * we[:, None]).sum(0)
    return N, U


def lod_classes(Vx, Fx, iters=8):
    """Source class per LOD face (majority of the centre and the three nudged corners), then a
    2-of-3 neighbour filter (a lone face of another class takes its neighbours' class)."""
    T = bvh()
    cen = Vx[Fx].mean(1)
    Cl = np.zeros(len(Fx), np.int64)
    for i in range(len(Fx)):
        votes = []
        for p in (cen[i], *(Vx[Fx[i, j]] * 0.7 + cen[i] * 0.3 for j in range(3))):
            fi = T.find_nearest(Vector(p))[2]
            if fi is not None:
                votes.append(int(C[fi]))
        if votes:
            vals, cnt = np.unique(votes, return_counts=True)
            # the centre breaks ties
            best = vals[cnt == cnt.max()]
            Cl[i] = votes[0] if votes[0] in best else best[0]
    E = {}
    for i, f in enumerate(Fx):
        for j in range(3):
            a_, b_ = f[j], f[(j + 1) % 3]
            E.setdefault((min(a_, b_), max(a_, b_)), []).append(i)
    nb = [[] for _ in range(len(Fx))]
    for fs in E.values():
        if len(fs) == 2:
            nb[fs[0]].append(fs[1])
            nb[fs[1]].append(fs[0])
    for _ in range(iters):
        C2 = Cl.copy()
        for i in range(len(Fx)):
            ns = nb[i]
            if len(ns) == 3:
                v = Cl[ns]
                other = v[v != Cl[i]]
                if len(other) >= 2:
                    vals, cnt = np.unique(other, return_counts=True)
                    if cnt.max() >= 2 and Cl[i] != 5:
                        C2[i] = vals[np.argmax(cnt)]
        Cl = C2
    return Cl


def snap_borders(Vx, Fx, Cl):
    """Moves each LOD vertex on a class border onto the nearest point of the source's border
    between the same two classes (source edge midpoints), when that is closer than 60 % of its
    shortest edge and no face round it flips. Returns new vertex positions."""
    from mathutils.kdtree import KDTree
    # source border points per class pair
    E = {}
    for i, f in enumerate(F):
        for j in range(3):
            a_, b_ = f[j], f[(j + 1) % 3]
            E.setdefault((min(a_, b_), max(a_, b_)), []).append(i)
    pts = {}
    for (a_, b_), fs in E.items():
        if len(fs) == 2:
            ca, cb = int(C[fs[0]]), int(C[fs[1]])
            if ca != cb:
                pts.setdefault((min(ca, cb), max(ca, cb)), []).append((V[a_] + V[b_]) / 2)
    trees = {}
    for k, P in pts.items():
        t = KDTree(len(P))
        for i, p in enumerate(P):
            t.insert(Vector(p), i)
        t.balance()
        trees[k] = t
    vf = [[] for _ in range(len(Vx))]
    for i, f in enumerate(Fx):
        for v in f:
            vf[v].append(i)
    fn0 = flat_normals(Vx, Fx)[:, 0]
    Vn = Vx.copy()
    moved = 0
    for v in range(len(Vx)):
        cs = sorted({int(Cl[i]) for i in vf[v]})
        if len(cs) < 2:
            continue
        cnt = {c: sum(1 for i in vf[v] if Cl[i] == c) for c in cs}
        top = sorted(cs, key=lambda c: -cnt[c])[:2]
        key = (min(top), max(top))
        if key not in trees:
            continue
        co, _, dist = trees[key].find(Vector(Vx[v]))
        el = min(np.linalg.norm(Vx[u] - Vx[v]) for i in vf[v] for u in Fx[i] if u != v)
        if dist > 0.6 * el:
            continue
        old = Vn[v].copy()
        Vn[v] = np.asarray(co)
        ok = True
        for i in vf[v]:
            a_, b_, c_ = Vn[Fx[i]]
            n = np.cross(b_ - a_, c_ - a_)
            ln = np.linalg.norm(n)
            if ln < 1e-12 or (n / ln) @ fn0[i] < 0.3:
                ok = False
                break
        if ok:
            moved += 1
        else:
            Vn[v] = old
    print(f'    class borders: {moved} vertices snapped onto the source border lines', flush=True)
    return Vn


def to_bl(P):
    return np.stack([P[:, 0], -P[:, 2], P[:, 1]], 1)


def to_game(P):
    return np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1)


def make_obj(name, Vg, Fs, uvs=None, cls=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(to_bl(Vg).tolist(), [], Fs.tolist())
    if uvs is not None:
        lay = me.uv_layers.new(name='src')
        lay.data.foreach_set('uv', uvs.reshape(-1))
    if cls is not None:
        for k in range(10):
            mat = bpy.data.materials.get(f'k{k}') or bpy.data.materials.new(f'k{k}')
            me.materials.append(mat)
        me.polygons.foreach_set('material_index', cls.astype(np.int32))
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def subset(mask):
    fids = np.nonzero(mask)[0]
    used = np.unique(F[fids])
    remap = -np.ones(len(V), np.int64)
    remap[used] = np.arange(len(used))
    return V[used], remap[F[fids]], UV[fids], C[fids]


def select_only(objs):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def decimate(ob, target, vgroup=None):
    n = len(ob.data.polygons)
    if n <= target:
        return
    m = ob.modifiers.new('dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = target / n
    m.use_collapse_triangulate = True
    m.use_symmetry = True
    m.symmetry_axis = 'Y'      # Blender y = the car's lateral axis
    if vgroup:
        m.vertex_group = vgroup
        m.vertex_group_factor = 1000.0
        m.invert_vertex_group = False
    select_only([ob])
    bpy.ops.object.modifier_apply(modifier='dec')


def read(ob, uv=True):
    me = ob.data
    me.calc_loop_triangles()
    Vb = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', Vb)
    Vb = Vb.reshape(-1, 3)
    tris = me.loop_triangles
    Fs = np.empty(len(tris) * 3, np.int64)
    tris.foreach_get('vertices', Fs)
    Fs = Fs.reshape(-1, 3)
    loops = np.empty(len(tris) * 3, np.int64)
    tris.foreach_get('loops', loops)
    mi = np.empty(len(tris), np.int64)
    tris.foreach_get('material_index', mi)
    U = None
    if uv and 'src' in me.uv_layers:
        allu = np.empty(len(me.loops) * 2)
        me.uv_layers['src'].data.foreach_get('uv', allu)
        U = allu.reshape(-1, 2)[loops].reshape(-1, 3, 2)
    return to_game(Vb), Fs, U, mi


def boundary_edges(bm):
    return [e for e in bm.edges if e.is_boundary]


def closed_check(Vg, Fs):
    E = {}
    for a, b, c in Fs:
        for u, v in ((a, b), (b, c), (c, a)):
            k = (min(u, v), max(u, v))
            E[k] = E.get(k, 0) + 1
    return sum(1 for n in E.values() if n == 1)


def glass_dissolve(ob, angle_deg):
    """Stage 2: the glass panes (gently curved) need far fewer triangles than the quadric pass
    leaves them: limited dissolve of the glass-only edges (angle limit), then triangulate. The
    edges where glass meets body are not touched, so the openings still match exactly."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    gl = lambda f: f.material_index == 2
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and all(gl(f) for f in e.link_faces)]
    verts = [v for v in bm.verts if v.link_faces and all(gl(f) for f in v.link_faces)]
    n0 = sum(1 for f in bm.faces if gl(f))
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(angle_deg), use_dissolve_boundaries=False,
                             verts=verts, edges=edges, delimit={'MATERIAL'})
    big = [f for f in bm.faces if len(f.verts) > 3]
    bmesh.ops.triangulate(bm, faces=big, quad_method='BEAUTY', ngon_method='BEAUTY')
    n1 = sum(1 for f in bm.faces if gl(f))
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    print(f'    glass dissolve ({angle_deg} deg): {n0} -> {n1} faces', flush=True)


def body_with_skin(Vo, Fo, Uo, Mo, No):
    """Outer body (with window holes) + its inner skin + returns -> one closed mesh.

    The skin is the outer mesh itself, copied and moved inward along the vertex normals: 4 mm,
    or 40 % of the local wall thickness where the part is thinner (mirror arms, lips, spoiler),
    so it can never poke out (a separately decimated skin cut the chords of concave areas and
    showed through the paint as lumps). Returns join the two along the window openings."""
    vn = np.zeros_like(Vo)
    fn = np.cross(Vo[Fo[:, 1]] - Vo[Fo[:, 0]], Vo[Fo[:, 2]] - Vo[Fo[:, 0]])
    for k in range(3):
        np.add.at(vn, Fo[:, k], fn)
    vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
    # local wall thickness: inward ray from each vertex to the next surface of the body
    T = BVHTree.FromPolygons([tuple(v) for v in Vo], [tuple(f) for f in Fo])
    off = np.full(len(Vo), INNER_T)
    for i in range(len(Vo)):
        d_ = -vn[i]
        hit = T.ray_cast(Vector(Vo[i] + d_ * 1e-4), Vector(d_), 0.05)
        if hit[0] is not None:
            off[i] = min(INNER_T, max(0.0004, 0.4 * (hit[3] + 1e-4)))
    Vi2 = Vo - vn * off[:, None]
    E = {}
    for a_, b_, c_ in Fo:
        for u, v in ((a_, b_), (b_, c_), (c_, a_)):
            E.setdefault((min(u, v), max(u, v)), []).append((u, v))
    bo = [lst[0] for lst in E.values() if len(lst) == 1]
    n0 = len(Vo)
    Vall = np.concatenate([Vo, Vi2])
    Fin = Fo[:, ::-1] + n0
    rims = np.array([[b_, a_, a_ + n0] for a_, b_ in bo] + [[b_, a_ + n0, b_ + n0] for a_, b_ in bo],
                    np.int64).reshape(-1, 3)
    Fall = np.concatenate([Fo, Fin, rims])
    Kall = np.concatenate([Mo, np.full(len(Fin) + len(rims), 6)])
    Uall = np.concatenate([Uo, np.zeros((len(Fin) + len(rims), 3, 2))])
    Nall = np.concatenate([No, -No[:, ::-1], flat_normals(Vall, rims)])
    bad = closed_check(Vall, Fall)
    thin = (off < INNER_T - 1e-6).mean() * 100
    print(f'    body {len(Fo)} + skin {len(Fin)} + returns {len(rims)} tris; thin-wall verts {thin:.1f}%; '
          f'open edges {bad}', flush=True)
    return Vall, Fall, Uall, Kall, Nall


def slab(Vo, Fo, t, out_off=0.0):
    """Closed slab from a surface patch: the patch moved out_off along its normals, and a copy
    t further in, joined along the patch boundary."""
    vn = np.zeros_like(Vo)
    fn = np.cross(Vo[Fo[:, 1]] - Vo[Fo[:, 0]], Vo[Fo[:, 2]] - Vo[Fo[:, 0]])
    for k in range(3):
        np.add.at(vn, Fo[:, k], fn)
    vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
    A = Vo + vn * out_off
    Bv = A - vn * t
    n = len(A)
    E = {}
    for a_, b_, c_ in Fo:
        for u, v in ((a_, b_), (b_, c_), (c_, a_)):
            E.setdefault((min(u, v), max(u, v)), []).append((u, v))
    rims = []
    for lst in E.values():
        if len(lst) == 1:
            a_, b_ = lst[0]
            rims += [[b_, a_, a_ + n], [b_, a_ + n, b_ + n]]
    R = np.array(rims, np.int64).reshape(-1, 3)
    Fs = np.concatenate([Fo, Fo[:, ::-1] + n, R])
    Vs = np.concatenate([A, Bv])
    No, _ = corner_attrs(Vo, Fo, want_uv=False)
    Ns = np.concatenate([No, -No[:, ::-1], flat_normals(Vs, R)])
    return Vs, Fs, Ns


def compact(Vx, Fx, mask, *per_face):
    used = np.unique(Fx[mask])
    rm = -np.ones(len(Vx), np.int64)
    rm[used] = np.arange(len(used))
    return (Vx[used], rm[Fx[mask]]) + tuple(a[mask] for a in per_face)


def deviation(src_ob, lod_V, lod_F, n=150000):
    """Two-way distances (m) between the source body surface and the LOD body (outer only)."""
    bvh_lod = BVHTree.FromPolygons([tuple(v) for v in to_bl(lod_V)], [tuple(f) for f in lod_F])
    me = src_ob.data
    Vs = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', Vs)
    Vs = Vs.reshape(-1, 3)
    rng = np.random.default_rng(1)
    pick = rng.choice(len(Vs), min(n, len(Vs)), replace=False)
    dist = np.array([bvh_lod.find_nearest(Vector(Vs[i]))[3] for i in pick])
    return dist


def main():
    out_dev = {}
    dev_path = os.path.join(B, f'{car}_deviation.json')
    if os.path.exists(dev_path):
        out_dev = json.load(open(dev_path))
    for lod in args.lods.split(','):
        T = TARGET[lod]
        bpy.ops.wm.read_factory_settings(use_empty=True)
        print(f'== {car} {lod}', flush=True)
        src = make_obj('src_all', V, F)
        allo = make_obj('all', V, F)
        decimate(allo, int(T['body'] * 1.25))
        Vo, Fo, _, _ = read(allo, uv=False)
        Cl = lod_classes(Vo, Fo)
        Vo = snap_borders(Vo, Fo, Cl)
        # stage 2: the glass panes (gently curved) need far fewer triangles
        ob2 = make_obj('all2', Vo, Fo, None, Cl)
        if (Cl == 2).sum() > T['glass']:
            glass_dissolve(ob2, cfg.get('glass_angle', 3.0))
        Vo, Fo, _, Mo = read(ob2, uv=False)
        print(f'    shell: {int((Mo != 2).sum())} body + {int((Mo == 2).sum())} glass faces', flush=True)
        dist = deviation(src, Vo, Fo)
        out_dev[lod] = {'tris': int(len(Fo)), 'max_mm': round(float(dist.max()) * 1000, 2),
                        'p99_mm': round(float(np.percentile(dist, 99)) * 1000, 2),
                        'mean_mm': round(float(dist.mean()) * 1000, 3)}
        print(f'    deviation {out_dev[lod]}', flush=True)
        No, Uo = corner_attrs(Vo, Fo)
        parts = {'body': body_with_skin(*compact(Vo, Fo, Mo != 2, Uo, Mo, No))}
        # glass
        gm = Mo == 2
        cen = Vo[Fo].mean(1)
        nrm = flat_normals(Vo, Fo)[:, 0]
        x0, x1 = cfg['door']
        door = gm & (cen[:, 0] > x0) & (cen[:, 0] < x1) & (np.abs(nrm[:, 2]) > 0.45) & (np.abs(cen[:, 2]) > 0.3)
        for name, m in (('glass', gm & ~door), ('window_L', door & (cen[:, 2] < 0)), ('window_R', door & (cen[:, 2] > 0))):
            if not m.any():
                continue
            PV, PF = compact(Vo, Fo, m)
            SV, SF, SN = slab(PV, PF, GLASS_T)
            parts[name] = (SV, SF, np.zeros((len(SF), 3, 2)), np.full(len(SF), 2), SN)
            print(f'    {name}: {len(SF)} tris, open {closed_check(SV, SF)}', flush=True)
        # lenses: copies of the lamp faces, 0.5..2.5 mm proud
        for name, cls, k in (('headlight_lens', 3, 7), ('taillight_lens', 4, 8)):
            if not (C == cls).any():
                continue
            Vl, Fl, _, _ = subset(C == cls)
            o = make_obj(name + '_p', Vl, Fl)
            decimate(o, T['lens'])
            LV, LF, _, _ = read(o, uv=False)
            SV, SF, SN = slab(LV, LF, 0.002, 0.0025)
            parts[name] = (SV, SF, np.zeros((len(SF), 3, 2)), np.full(len(SF), k), SN)
            print(f'    {name}: {len(SF)} tris, open {closed_check(SV, SF)}', flush=True)
        save = {'KEYS': np.array(KEYS)}
        for name, (pv, pf, pu, pk, pn) in parts.items():
            save[f'{name}_N'] = pn.astype(np.float32)
            save[f'{name}_V'] = pv.astype(np.float32)
            save[f'{name}_F'] = pf.astype(np.int32)
            save[f'{name}_UV'] = pu.astype(np.float32)
            save[f'{name}_K'] = pk.astype(np.int16)
        np.savez_compressed(os.path.join(B, f'{car}_{lod}.npz'), **save)
        tot = sum(len(p[1]) for p in parts.values())
        print(f'    {lod}: {tot} tris in {", ".join(f"{k} {len(p[1])}" for k, p in parts.items())}', flush=True)
        out_dev[lod]['total_tris'] = int(tot)
    json.dump(out_dev, open(dev_path, 'w'), indent=1)


main()
