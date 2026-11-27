"""Step 3: the classified source body -> per-LOD game meshes (Blender).

    python tools/cars/remaster/lods.py --car rp1_vanta [--lods showroom,drive,race]

For each LOD (showroom / drive / race):
- shell: the whole closed source shell (glass included) simplified in one pass (meshoptimizer
  quadric simplifier with the vertex normals as an attribute and regularised triangles,
  simplify.mjs; every LOD vertex is a source vertex). No UVs or classes constrain it, so the error
  goes where the shape allows it. (Blender's DECIMATE left ripples on glossy paint.) Drive and
  race use Blender's DECIMATE collapse (symmetric): at those counts it holds the silhouette better.
- classes on the LOD: every LOD face takes the source class at its centre and corners (majority),
  then the class borders are snapped onto the source's own border lines (window openings, paint /
  trim edges come out as clean curves, not the zig-zag of a decimated per-face mask)
- source texture coordinates and shading normals re-projected per corner from the high-poly
  source (nearest point, same UV island), so the baked textures read as on the original; shading
  normals = the source's face normals averaged over a disc of ~0.6 LOD edge lengths round each
  corner (same side of a crease only): a sparse sample of the dense source's normals aliases into
  ripples on glossy paint, the averaged field does not
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
import subprocess
import tempfile
import json
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

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
    'drive': dict(body=cfg.get('body_tris_drive', 6400), glass=700, lens=140, update=True),
    'race': dict(body=cfg.get('body_tris_race', 1650), glass=180, lens=30, blender=True),
}
INNER_T = 0.004
GLASS_T = 0.003
KEYS = ['src:trim', 'paint:src', 'glass', 'src:trim', 'src:trim', 'body:well', 'int:skin', 'headlight_lens',
        'taillight_lens', 'body:gloss']   # by class (0-5), then inner skin, lenses, gloss black (9)


def smooth_source_classes(C, iters):
    """Majority filter on the source's own classes (the texture-colour classification is ragged
    at the class borders: window frames, lamps): a face whose two or three edge neighbours agree
    on another class takes it. Wells (5) stay."""
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    fid = np.tile(np.arange(len(F)), 3)
    key = np.minimum(e[:, 0], e[:, 1]) * (len(V) + 1) + np.maximum(e[:, 0], e[:, 1])
    o = np.argsort(key, kind='stable')
    ks, fs = key[o], fid[o]
    same = ks[1:] == ks[:-1]
    a, b = fs[:-1][same], fs[1:][same]
    nb = -np.ones((len(F), 3), np.int64)
    cnt = np.zeros(len(F), np.int64)
    # fill neighbour slots (vectorised by rank within each face)
    src = np.concatenate([a, b]); dst = np.concatenate([b, a])
    o2 = np.argsort(src, kind='stable')
    src, dst = src[o2], dst[o2]
    first = np.searchsorted(src, src)
    rank = np.arange(len(src)) - first
    ok = rank < 3
    nb[src[ok], rank[ok]] = dst[ok]
    C = C.copy()
    C0 = C.copy()
    for _ in range(iters):
        Cn = np.where(nb >= 0, C[np.maximum(nb, 0)], -1)
        c0, c1, c2 = Cn[:, 0], Cn[:, 1], Cn[:, 2]
        maj = np.where((c0 == c1) & (c0 >= 0), c0, np.where((c1 == c2) & (c1 >= 0), c1, np.where((c0 == c2) & (c0 >= 0), c0, -1)))
        flip = (maj >= 0) & (maj != C) & (C != 5) & (maj != 5)
        if not flip.any():
            break
        C[flip] = maj[flip]
    print(f'source classes smoothed: {int((C != C0).sum())} faces changed', flush=True)
    return C


C = smooth_source_classes(C, cfg.get('src_smooth', 16))

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
    return absorb_islands(Vx, Fx, Cl, nb)


def face_neighbours(Fx):
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
    return nb


def absorb_islands(Vx, Fx, Cl, nb, min_area=None):
    """Small same-class patches (flecks of trim in the paint, paint chips in the black window
    surrounds, stray glass) take the class of the neighbour they share most edges with. Lamps
    (3, 4) and the arch wells (5) are kept."""
    min_area = cfg.get('island_area', 0.0025) if min_area is None else min_area
    A = 0.5 * np.linalg.norm(np.cross(Vx[Fx[:, 1]] - Vx[Fx[:, 0]], Vx[Fx[:, 2]] - Vx[Fx[:, 0]]), axis=1)
    Cl = Cl.copy()
    total = 0
    for _ in range(4):
        comp = -np.ones(len(Fx), np.int64)
        changed = 0
        for s0 in range(len(Fx)):
            if comp[s0] >= 0:
                continue
            stack, members = [s0], []
            comp[s0] = s0
            while stack:
                f = stack.pop()
                members.append(f)
                for g in nb[f]:
                    if comp[g] < 0 and Cl[g] == Cl[s0]:
                        comp[g] = s0
                        stack.append(g)
            if Cl[s0] in (3, 4, 5) or A[members].sum() >= min_area:
                continue
            border = {}
            for f in members:
                for g in nb[f]:
                    if Cl[g] != Cl[s0]:
                        border[Cl[g]] = border.get(Cl[g], 0) + 1
            if border:
                new = max(border, key=border.get)
                Cl[members] = new
                changed += len(members)
        total += changed
        if not changed:
            break
    print(f'    islands absorbed: {total} faces', flush=True)
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


def simplify(Vs, Fs, target, nw=0.5, err=None, flags=None, compact_out=True, lock=None, cls=None,
             update=False):
    """meshoptimizer quadric simplification (simplify.mjs) -> (V, F) compacted (or the input V
    and F indexing it, compact_out=False). With cls (a class per face) every vertex is split per
    class first: the class borders become attribute seams, which meshopt keeps as borders and
    only simplifies along (clean window openings and paint / trim edges); then -> (V, F, class).
    update=True lets meshopt move the kept vertices (lower error at low counts)."""
    Vs = np.asarray(Vs, np.float32)
    Fs = np.asarray(Fs, np.int64)
    if cls is not None:
        key = Fs * 16 + np.asarray(cls, np.int64)[:, None]
        uk, inv = np.unique(key.ravel(), return_inverse=True)
        orig = uk // 16
        vcls = uk % 16
        Fsplit = inv.reshape(-1, 3)
        Vw = Vs[orig]
    else:
        orig = None
        Fsplit, Vw = Fs, Vs
    Fu = Fsplit.astype(np.uint32)
    cr = np.cross(Vw[Fu[:, 1]] - Vw[Fu[:, 0]], Vw[Fu[:, 2]] - Vw[Fu[:, 0]])
    Nv = np.zeros_like(Vw)
    for k in range(3):
        np.add.at(Nv, Fu[:, k], cr)
    Nv /= np.maximum(np.linalg.norm(Nv, axis=1, keepdims=True), 1e-12)
    with tempfile.TemporaryDirectory() as D:
        Vw.tofile(os.path.join(D, 'V.f32'))
        Nv.astype(np.float32).tofile(os.path.join(D, 'N.f32'))
        Fu.tofile(os.path.join(D, 'F.u32'))
        if lock is not None:
            np.asarray(lock, np.uint8).tofile(os.path.join(D, 'L.u8'))
        cmd = ['node', os.path.join(HERE, 'simplify.mjs'), D, str(int(target)), str(nw)]
        if err is not None or flags or update:
            cmd += ['1' if update else '0', str(err if err is not None else 1.0), ','.join(flags or ['Regularize'])]
        r = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print('    simplify:', r.stdout.strip(), flush=True)
        Fo = np.fromfile(os.path.join(D, 'Fo.u32'), np.uint32).reshape(-1, 3).astype(np.int64)
        if update:
            Vw = np.fromfile(os.path.join(D, 'Vo.f32'), np.float32).reshape(-1, 3)
    if cls is not None:
        Fc = vcls[Fo[:, 0]]
        # weld the class copies back together (by position: with update they moved together)
        _, wid = np.unique(np.round(Vw[np.unique(Fo)], 6), axis=0, return_inverse=True)
        used = np.unique(Fo)
        remap = np.zeros(len(Vw), np.int64)
        remap[used] = wid.ravel()
        Vn = np.zeros((wid.max() + 1, 3))
        Vn[wid.ravel()] = Vw[used]
        Fo = remap[Fo]
        ok = (Fo[:, 0] != Fo[:, 1]) & (Fo[:, 1] != Fo[:, 2]) & (Fo[:, 2] != Fo[:, 0])
        return Vn, Fo[ok], Fc[ok]
    if not compact_out:
        return Vw.astype(np.float64), Fo
    used, inv = np.unique(Fo, return_inverse=True)
    return Vw[used].astype(np.float64), inv.reshape(-1, 3)


_KD = None


def filtered_normals(Vx, Fx, Nref=None, rmul=0.6):
    """Per-corner shading normal: area-weighted source face normals within r of the corner's
    vertex (r = rmul x the vertex's mean LOD edge, 4..50 mm), only those within ~63 degrees of the
    LOD face (or 37 degrees of Nref), i.e. the same side of a crease."""
    global _KD
    A = np.linalg.norm(_FN, axis=1)
    SN = _FN / np.maximum(A[:, None], 1e-15)
    if _KD is None:
        Cs = V[F].mean(1)
        _KD = KDTree(len(Cs))
        for i, c in enumerate(Cs):
            _KD.insert(c, i)
        _KD.balance()
    fl = flat_normals(Vx, Fx)[:, 0]
    L = np.zeros(len(Vx))
    cnt = np.zeros(len(Vx))
    for j in range(3):
        e = np.linalg.norm(Vx[Fx[:, j]] - Vx[Fx[:, (j + 1) % 3]], axis=1)
        for k in (j, (j + 1) % 3):
            np.add.at(L, Fx[:, k], e)
            np.add.at(cnt, Fx[:, k], 1)
    L /= np.maximum(cnt, 1)
    ref = Nref if Nref is not None else np.repeat(fl[:, None, :], 3, 1)
    cos = 0.8 if Nref is not None else 0.45
    near = {}
    N = ref.copy()
    for i in range(len(Fx)):
        for j in range(3):
            v = Fx[i, j]
            if v not in near:
                r = float(np.clip(L[v] * rmul, 0.004, 0.05))
                near[v] = np.array([h[1] for h in _KD.find_range(Vx[v], r)], np.int64)
            idx = near[v]
            if len(idx) == 0:
                continue
            nn = SN[idx]
            w = A[idx] * (nn @ ref[i, j] > cos)
            if w.sum() <= 0:
                continue
            n = (nn * w[:, None]).sum(0)
            n /= max(np.linalg.norm(n), 1e-15)
            if n @ fl[i] > 0.3:
                N[i, j] = n
    return N


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

    The skin is the outer mesh itself (then simplified, borders locked), copied and moved inward along the vertex normals: 4 mm,
    (6 mm since batch 3's simplified skin), or 40 % of the local wall thickness where the part is thinner (mirror arms, lips, spoiler),
    so it can never poke out (a separately decimated skin cut the chords of concave areas and
    showed through the paint as lumps). Returns join the two along the window openings."""
    vn = np.zeros_like(Vo)
    fn = np.cross(Vo[Fo[:, 1]] - Vo[Fo[:, 0]], Vo[Fo[:, 2]] - Vo[Fo[:, 0]])
    for k in range(3):
        np.add.at(vn, Fo[:, k], fn)
    vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
    # local wall thickness: inward ray from each vertex to the next surface of the body
    T = BVHTree.FromPolygons([tuple(v) for v in Vo], [tuple(f) for f in Fo])
    off = np.full(len(Vo), INNER_T + 0.002)
    for i in range(len(Vo)):
        d_ = -vn[i]
        hit = T.ray_cast(Vector(Vo[i] + d_ * 1e-4), Vector(d_), 0.05)
        if hit[0] is not None:
            off[i] = min(INNER_T + 0.002, max(0.0004, 0.4 * (hit[3] + 1e-4)))
    Vi2 = Vo - vn * off[:, None]
    E = {}
    for a_, b_, c_ in Fo:
        for u, v in ((a_, b_), (b_, c_), (c_, a_)):
            E.setdefault((min(u, v), max(u, v)), []).append((u, v))
    bo = [lst[0] for lst in E.values() if len(lst) == 1]
    n0 = len(Vo)
    # the skin is only ever seen dimly through the glass: simplified on its own (the window
    # borders locked, so the returns still meet it; at most 2 mm off the full skin, which sits
    # 4 mm in, so it stays inside the paint)
    _, Fs = simplify(Vi2, Fo, max(len(Fo) // 4, 200), nw=0.0, err=0.002,
                     flags=['LockBorder', 'ErrorAbsolute'], compact_out=False,
                     lock=off < INNER_T + 0.002 - 1e-6)   # thin walls keep the full skin
    Vall = np.concatenate([Vo, Vi2])
    Fin = Fs[:, ::-1] + n0
    rims = np.array([[b_, a_, a_ + n0] for a_, b_ in bo] + [[b_, a_ + n0, b_ + n0] for a_, b_ in bo],
                    np.int64).reshape(-1, 3)
    Fall = np.concatenate([Fo, Fin, rims])
    Kall = np.concatenate([Mo, np.full(len(Fin) + len(rims), 6)])
    Uall = np.concatenate([Uo, np.zeros((len(Fin) + len(rims), 3, 2))])
    # skin: smooth (vertex-averaged) normals, so its vertices are shared in the export
    Fsk = Fin
    fn_s = np.cross(Vall[Fsk[:, 1]] - Vall[Fsk[:, 0]], Vall[Fsk[:, 2]] - Vall[Fsk[:, 0]])
    vn_s = np.zeros_like(Vall)
    for k in range(3):
        np.add.at(vn_s, Fsk[:, k], fn_s)
    vn_s /= np.maximum(np.linalg.norm(vn_s, axis=1, keepdims=True), 1e-12)
    Nall = np.concatenate([No, vn_s[Fsk], flat_normals(Vall, rims)])
    # drop the skin vertices the simplification left unused
    used, inv = np.unique(Fall, return_inverse=True)
    Vall, Fall = Vall[used], inv.reshape(-1, 3)
    bad = closed_check(Vall, Fall)
    thin = (off < INNER_T + 0.002 - 1e-6).mean() * 100
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


def tidy(pv, pf, pu, pk, pn, name=''):
    """Duplicate faces out (same three positions: a back-to-back pair goes, a same-way copy
    keeps one; the exporter drops them otherwise and leaves open edges), and corner normals
    within ~10 degrees of each other at a vertex merged to their mean, so the exported mesh
    shares vertices (per-corner normals tripled the vertex count and the file size)."""
    # weld vertices closer than ~10 micrometres (the packer welds by position too: a near-pair
    # left apart here comes out as an open edge there)
    _, pid = np.unique(np.round(pv / 1e-5).astype(np.int64), axis=0, return_inverse=True)
    pid = pid.ravel()
    first = np.full(pid.max() + 1, -1)
    for i in range(len(pid) - 1, -1, -1):
        first[pid[i]] = i
    pv = pv[first[pid]]
    G = pid[pf]
    keep = np.ones(len(pf), bool)
    seen = {}
    for i, g in enumerate(G):
        if len(set(g)) < 3:
            keep[i] = False      # collapsed by the weld
            continue
        k = tuple(sorted(g))
        if k in seen:
            j = seen.pop(k)
            r = list(G[j]).index(g[0])
            same = (G[j][(r + 1) % 3] == g[1])
            keep[i] = False
            if not same:
                keep[j] = False
        else:
            seen[k] = i
    pf, pu, pk, pn = pf[keep], pu[keep], pk[keep], pn[keep].copy()
    drop = int((~keep).sum())
    corners = {}
    for i in range(len(pf)):
        for j in range(3):
            corners.setdefault(int(pf[i, j]), []).append((i, j))
    for v, cs in corners.items():
        groups = []
        for (i, j) in cs:
            n = pn[i, j]
            for gr in groups:
                if gr[0] @ n > 0.985:
                    gr[1].append((i, j))
                    break
            else:
                groups.append([n.copy(), [(i, j)]])
        for _, mem in groups:
            m = np.mean([pn[i, j] for i, j in mem], 0)
            m /= max(np.linalg.norm(m), 1e-12)
            for i, j in mem:
                pn[i, j] = m
    if drop:
        print(f'    {name}: {drop} duplicate faces out', flush=True)
    return pv, pf, pu, pk, pn


def gloss_black(Vx, Fx, Mo):
    """Class 9 (gloss black, no source texture): the trim above the belt line (window surrounds,
    pillars, roof rails: the source painted white reflections onto them, which read as stains),
    and the cfg 'roof_black' glass / white faces (a panoramic roof is kept as the source's black roof: through
    real glass it shows an empty cabin with no headliner). Applied to the source's classes."""
    Mo = Mo.copy()
    cen = Vx[Fx].mean(1)
    nrm = flat_normals(Vx, Fx)[:, 0]
    blk = (Mo == 0) & (cen[:, 1] > cfg['belt'] - 0.02)
    for r in cfg.get('roof_black', []):
        m = np.isin(Mo, r.get('cls', (1, 2))) & (cen[:, 1] > r['y']) & (nrm[:, 1] > r['ny']) & (cen[:, 0] > r['x'][0]) & (cen[:, 0] < r['x'][1])
        blk |= m
    for r in cfg.get('black_not', []):
        m = np.ones(len(Fx), bool)
        for ax, k in ((0, 'x'), (1, 'y')):
            if k in r:
                m &= (cen[:, ax] > r[k][0]) & (cen[:, ax] < r[k][1])
        blk &= ~m
    Mo[blk] = 9
    print(f'    gloss black: {int(blk.sum())} faces', flush=True)
    return Mo


def main():
    global C
    # gloss black decided on the source faces (fine), so its borders are clean seams in the LODs
    C = gloss_black(V, F, C)
    out_dev = {}
    dev_path = os.path.join(B, f'{car}_deviation.json')
    if os.path.exists(dev_path):
        out_dev = json.load(open(dev_path))
    for lod in args.lods.split(','):
        T = TARGET[lod]
        bpy.ops.wm.read_factory_settings(use_empty=True)
        print(f'== {car} {lod}', flush=True)
        src = make_obj('src_all', V, F)
        if T.get('blender'):
            # drive / race: Blender's collapse moves vertices off the source and keeps the
            # silhouette tighter at these counts (meshopt keeps source vertices: 2-3x the error)
            allo = make_obj('all', V, F)
            decimate(allo, int(T['body'] * 1.25))
            Vo, Fo, _, _ = read(allo, uv=False)
            Cl = lod_classes(Vo, Fo)
            Vo = snap_borders(Vo, Fo, Cl)
        else:
            # classes as seams: the LOD faces keep their source class, borders stay clean lines
            Vo, Fo, Cl = simplify(V, F, int(T['body'] * 1.25), cls=C, update=T.get('update', False))
            Cl = absorb_islands(Vo, Fo, Cl, face_neighbours(Fo))
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
        No = filtered_normals(Vo, Fo)
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
        for name in list(parts):
            parts[name] = tidy(*parts[name], name=name)
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
