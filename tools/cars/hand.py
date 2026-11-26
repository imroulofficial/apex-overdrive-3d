"""Gloved driver's hand on a steering-wheel rim, as one smooth closed surface.

The hand is a signed-distance field built from an anatomical skeleton (four metacarpals, three
phalanges per finger, a thumb with its own metacarpal, wrist, gauntlet cuff) joined with smooth
unions, so knuckles, the palm and the finger roots blend like a gloved hand instead of separate
tubes. The surface is extracted with surface nets (quads), projected onto the zero set, relaxed,
and decimated by Blender to the LOD's budget. Seams are thin darker welts laid on the surface
(back-of-hand points and the cuff hem).

    from hand import glove
    m = glove(q, c, radial, X, tup, rim_r)   # wheel frame, one hand

c: the rim's centre-line point under the hand; radial: outward from the wheel centre; X: along
the column toward the nose (the driver is at -X); tup: along the rim toward twelve o'clock;
rim_r: the rim tube's radius.
"""

import math

import numpy as np

from meshkit import Mesh, norm, tube

# finger table: (offset along the rim from the hand's middle, MCP angle round the rim (deg),
# MCP distance from the rim axis, glove radius, phalanx lengths proximal/middle/distal)
FINGERS = (
    (0.0300, -6.0, 0.0345, 0.0092, (0.045, 0.027, 0.022)),    # index (toward twelve o'clock)
    (0.0095, -4.0, 0.0355, 0.0095, (0.049, 0.030, 0.023)),    # middle
    (-0.0115, -6.0, 0.0345, 0.0090, (0.046, 0.028, 0.022)),   # ring
    (-0.0315, -12.0, 0.0320, 0.0079, (0.037, 0.022, 0.019)),  # little
)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


class Cone:
    """Round cone a->b with radii r0->r1; the cross-section is squashed to `flat` along `nrm`
    (a unit vector across the segment), for the palm and the wrist."""

    def __init__(self, a, b, r0, r1, nrm=None, flat=1.0):
        self.a, self.b = np.asarray(a, float), np.asarray(b, float)
        self.r0, self.r1 = r0, r1
        self.n = None if nrm is None else norm(np.asarray(nrm, float))
        self.flat = flat

    def __call__(self, P):
        ab = self.b - self.a
        L2 = float(ab @ ab)
        ap = P - self.a
        t = np.clip(ap @ ab / L2, 0.0, 1.0)
        d = ap - t[:, None] * ab
        r = self.r0 + (self.r1 - self.r0) * t
        if self.n is not None:
            dn = d @ self.n
            d = d + (dn / self.flat - dn)[:, None] * self.n
            r = r / self.flat
            return (np.linalg.norm(d, axis=1) - r) * self.flat
        return np.linalg.norm(d, axis=1) - r


class Blob:
    """Ellipsoid (approximate distance)."""

    def __init__(self, c, R, half):
        self.c, self.R, self.h = np.asarray(c, float), np.asarray(R, float), np.asarray(half, float)

    def __call__(self, P):
        p = (P - self.c) @ self.R
        k0 = np.linalg.norm(p / self.h, axis=1)
        k1 = np.linalg.norm(p / (self.h * self.h), axis=1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def _wrap(p, rho, length, sense):
    """Walk `length` from p (2D, around the origin) along the tangent to the circle of radius
    rho, turning in `sense` (+1 counter-clockwise). Returns the end point."""
    d = math.hypot(*p)
    if d <= rho + 1e-6:
        p = np.asarray(p) * (rho + 1e-4) / max(d, 1e-9)
        d = rho + 1e-4
    u = np.asarray(p) / d
    perp = np.array([-u[1], u[0]]) * sense
    # tangent direction from p touching the circle on the `sense` side
    tl = math.sqrt(max(d * d - rho * rho, 0.0))
    v = (-u) * (tl / d) + perp * (rho / d)
    return np.asarray(p) + norm(v) * length


class Glove:
    def __init__(self, c, radial, X, tup, rim_r):
        self.c = np.asarray(c, float)
        self.er = norm(np.asarray(radial, float))
        self.ex = norm(np.asarray(X, float))
        self.et = norm(np.asarray(tup, float))
        self.rim_r = rim_r
        self.build()

    def P(self, r, x, t):
        return self.c + self.er * r + self.ex * x + self.et * t

    def ang(self, th, d, t):
        a = math.radians(th)
        return self.P(math.cos(a) * d, math.sin(a) * d, t)

    def build(self):
        rr = self.rim_r
        # forearm direction (from the knuckles back to the wrist): toward the driver, a little
        # inboard and down along the rim
        Lw = norm(self.er * -0.28 + self.ex * -0.86 + self.et * -0.42)
        self.Lw = Lw
        back = norm(self.er - Lw * (self.er @ Lw))      # back-of-hand normal (outboard)
        self.back = back
        fingers, mcps, joints = [], [], []
        for off, th, d, fr, lens in FINGERS:
            # walk round the rim in the (radial, X) plane: from the MCP over the front (+X) to the
            # inside, each phalanx a straight bone touching the glove's clearance circle
            a = math.radians(th)
            p = np.array([math.cos(a) * d, math.sin(a) * d])
            rho = rr + fr * 0.98
            pts = [p]
            for k, Lk in enumerate(lens):
                p = _wrap(p, rho + 0.0012 * k, Lk, +1)
                pts.append(p)
            P3 = [self.P(q_[0], q_[1], off + (0.0015 * j if off > 0 else -0.001 * j)) for j, q_ in enumerate(pts)]
            radii = (fr * 1.04, fr * 0.98, fr * 0.93, fr * 0.84)
            for j in range(3):
                fingers.append(Cone(P3[j], P3[j + 1], radii[j], radii[j + 1]))
            mcps.append((P3[0], fr))
            joints.append(P3)
        self.joints = joints
        # metacarpals: from each MCP back to the wrist, converging
        wc = (mcps[1][0] + mcps[2][0]) / 2 + Lw * 0.090 + back * 0.002
        self.wc = wc
        palm = []
        for (m, fr), (off, *_r) in zip(mcps, FINGERS):
            w = wc + self.et * off * 0.55
            palm.append(Cone(m, w, fr * 1.25, 0.0135, nrm=back, flat=0.80))
        # palm pads (thenar near the thumb, hypothenar on the little-finger side) on the palm side
        Rb = np.stack([Lw, norm(np.cross(back, Lw)), back], -1)
        pads = [Blob(wc - Lw * 0.035 - back * 0.010 + self.et * 0.018, Rb, (0.034, 0.020, 0.013)),
                Blob(wc - Lw * 0.030 - back * 0.008 - self.et * 0.022, Rb, (0.034, 0.016, 0.012))]
        # thumb: base on the index side near the wrist, round the rim's driver face, tip inboard
        tb = wc - Lw * 0.012 + self.et * 0.030 - back * 0.012
        t1 = self.P(0.016, -(rr + 0.017), 0.040)
        t2 = self.P(-0.008, -(rr + 0.0115), 0.042)
        t3 = self.P(-0.030, -(rr + 0.0105), 0.036)
        thumb = [Cone(tb, t1, 0.0150, 0.0112), Cone(t1, t2, 0.0112, 0.0104), Cone(t2, t3, 0.0104, 0.0090)]
        self.thumb = (tb, t1, t2, t3)
        # wrist and gauntlet cuff (flattened), flaring a little toward the forearm
        wrist = Cone(wc - Lw * 0.005, wc + Lw * 0.040, 0.0235, 0.0245, nrm=back, flat=0.74)
        cuff = Cone(wc + Lw * 0.030, wc + Lw * 0.060, 0.0262, 0.0285, nrm=back, flat=0.78)
        self.cuff_a, self.cuff_b = wc + Lw * 0.030, wc + Lw * 0.060
        self.parts = dict(fingers=fingers, palm=palm, pads=pads, thumb=thumb, wrist=wrist, cuff=cuff)

    def sdf(self, P):
        pr = self.parts
        d_palm = pr['palm'][0](P)
        for c_ in pr['palm'][1:]:
            d_palm = smin(d_palm, c_(P), 0.012)
        for b in pr['pads']:
            d_palm = smin(d_palm, b(P), 0.010)
        d = smin(d_palm, pr['wrist'](P), 0.014)
        d = smin(d, pr['cuff'](P), 0.006)
        # each finger is a smooth chain; fingers join the palm softly but stay apart
        f = pr['fingers']
        for i in range(0, len(f), 3):
            df = smin(smin(f[i](P), f[i + 1](P), 0.003), f[i + 2](P), 0.003)
            d = smin(d, df, 0.006)
        th = pr['thumb']
        dt = smin(smin(th[0](P), th[1](P), 0.004), th[2](P), 0.003)
        d = smin(d, dt, 0.008)
        # keep the glove off the rim: carve the rim tube (plus a hair of clearance)
        rim = self._rim(P)
        d = np.maximum(d, -(rim - 0.0006))
        return d

    def _rim(self, P):
        q = P - self.c
        a = q @ self.et
        rad = q - np.outer(a, self.et)
        return np.linalg.norm(rad, axis=1) - self.rim_r

    def bounds(self):
        pts = [j for J in self.joints for j in J] + list(self.thumb) + [self.cuff_b, self.wc]
        pts = np.array(pts)
        return pts.min(0) - 0.050, pts.max(0) + 0.050


def surface_nets(f, lo, hi, h):
    """Quad mesh of the zero set of f (negative inside) on a grid of step h."""
    n = np.ceil((hi - lo) / h).astype(int) + 1
    xs = [lo[i] + np.arange(n[i]) * h for i in range(3)]
    G = np.stack(np.meshgrid(*xs, indexing='ij'), -1).reshape(-1, 3)
    F = f(G).reshape(n)
    inside = F < 0
    # active cells
    c8 = [F[i:n[0] - 1 + i, j:n[1] - 1 + j, k:n[2] - 1 + k] for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    st = np.stack(c8, -1)
    act = (st.min(-1) < 0) & (st.max(-1) >= 0)
    idx = -np.ones(act.shape, dtype=np.int64)
    cells = np.argwhere(act)
    idx[act] = np.arange(len(cells))
    # vertex per cell: mean of the edge crossings
    corners = np.array([(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)])
    edges = [(a, b) for a in range(8) for b in range(a + 1, 8) if np.abs(corners[a] - corners[b]).sum() == 1]
    vals = st[act]
    acc = np.zeros((len(cells), 3))
    cnt = np.zeros(len(cells))
    for a, b in edges:
        va, vb = vals[:, a], vals[:, b]
        m = (va < 0) != (vb < 0)
        t = np.where(m, va / np.where(m, va - vb, 1.0), 0.0)
        p = corners[a] + (corners[b] - corners[a]) * t[:, None]
        acc[m] += p[m]
        cnt[m] += 1
    V = lo + (cells + acc / cnt[:, None]) * h
    faces = []
    # quads round each sign-changing grid edge
    for ax in range(3):
        a1, a2 = [x for x in range(3) if x != ax]
        sl0 = [slice(None)] * 3
        sl1 = [slice(None)] * 3
        sl0[ax] = slice(0, n[ax] - 1)
        sl1[ax] = slice(1, n[ax])
        e = inside[tuple(sl0)] != inside[tuple(sl1)]
        E = np.argwhere(e)
        if not len(E):
            continue
        flip = inside[tuple(E.T)]           # inside at the low end: outward is +ax

        def cell(d1, d2):
            C = E.copy()
            C[:, a1] -= d1
            C[:, a2] -= d2
            return idx[tuple(C.T)]
        q = np.stack([cell(1, 1), cell(0, 1), cell(0, 0), cell(1, 0)], -1)
        # orientation: (a1, a2, ax) right-handed?
        rh = (a1, a2, ax) in ((0, 1, 2), (1, 2, 0), (2, 0, 1))
        rev = flip != rh
        q[rev] = q[rev][:, ::-1]
        faces.append(q)
    Fq = np.concatenate(faces)
    Fq = Fq[(Fq >= 0).all(1)]
    return V, Fq


def _grad(f, P, e=2e-4):
    g = np.zeros_like(P)
    for i in range(3):
        d = np.zeros(3)
        d[i] = e
        g[:, i] = (f(P + d) - f(P - d)) / (2 * e)
    return g


def project(f, V, iters=3):
    for _ in range(iters):
        d = f(V)
        g = _grad(f, V)
        V = V - (d / np.maximum((g * g).sum(1), 1e-9))[:, None] * g
    return V


def relax(V, F, f, iters=3):
    nb = [[] for _ in range(len(V))]
    for q in F:
        for i in range(4):
            nb[q[i]].append(q[(i + 1) % 4])
            nb[q[i]].append(q[(i - 1) % 4])
    nb = [np.unique(x) for x in nb]
    for _ in range(iters):
        V = np.array([V[x].mean(0) if len(x) else v for v, x in zip(V, nb)]) * 0.6 + V * 0.4
        V = project(f, V, 2)
    return V


def decimate(m, ratio):
    if ratio >= 0.999:
        return m
    import bpy
    me = bpy.data.meshes.new('_glove')
    me.from_pydata([tuple(v) for v in m.V], [], [tuple(f) for f in m.F])
    me.update()
    ob = bpy.data.objects.new('_glove', me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('dec', 'DECIMATE')
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    m2 = ev.to_mesh()
    V = np.empty(len(m2.vertices) * 3)
    m2.vertices.foreach_get('co', V)
    F = [list(p.vertices) for p in m2.polygons]
    out = Mesh(V.reshape(-1, 3), F, [m.mats[0]] * len(F))
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return out


def _on_surface(g, pts, lift):
    pts = project(g.sdf, np.asarray(pts, float), 4)
    n_ = norm(_grad(g.sdf, pts))
    return pts + n_ * lift


def seams(g, q, mat='driver:seam'):
    """Darker welts: three 'points' on the back of the hand, a seam along the top of each
    finger's root and the cuff hem."""
    m = Mesh()
    n = 4 if q < 0.6 else 5
    r = 0.0011
    Lw, back = g.Lw, g.back
    for k, (off, *_r) in enumerate(FINGERS[:3]):
        J = g.joints[k]
        a = J[0] + Lw * 0.018 + back * 0.02
        b = g.wc + g.et * off * 0.55 - Lw * 0.012 + back * 0.02
        pts = _on_surface(g, [a + (b - a) * t for t in np.linspace(0, 1, 9)], 0.0007)
        m += tube(pts, r, n=n, mat=mat, samples=10, cap='fan')
    # knuckle band: a lighter padded strip across the four knuckles (the glove's accent)
    kn = [g.joints[k][0] + back * 0.002 for k in range(4)]
    kn = [kn[0] + (kn[0] - kn[1]) * 0.35] + kn + [kn[3] + (kn[3] - kn[2]) * 0.35]
    pts = _on_surface(g, kn, 0.0010)
    m += tube(pts, 0.0026, n=n + 2, mat=mat, samples=14, cap='dome')
    # cuff hem: a ring round the cuff's open end
    ca, cb = g.cuff_a, g.cuff_b
    ax = norm(cb - ca)
    u = g.back
    v = norm(np.cross(ax, u))
    ring = [cb - ax * 0.004 + (u * math.cos(t) + v * math.sin(t)) * 0.05 for t in np.linspace(0, 2 * math.pi, 25)]
    ring = _on_surface(g, ring, 0.0006)
    m += tube(ring, r * 1.3, n=n, mat=mat, samples=26, cap='fan')
    return m


def glove(q, c, radial, X, tup, rim_r, mat='driver:glove', seam_mat='driver:seam'):
    g = Glove(c, radial, X, tup, rim_r)
    lo, hi = g.bounds()
    h = 0.0021 if q >= 0.6 else 0.0030
    V, F = surface_nets(g.sdf, lo, hi, h)
    V = project(g.sdf, V, 3)
    V = relax(V, F, g.sdf, 2)
    m = Mesh(V, F.tolist(), [mat] * len(F))
    target = 7000 if q >= 0.6 else 2400
    m = decimate(m, min(1.0, target / (2 * len(F))))
    m += seams(g, q, seam_mat)
    m.cuff_end, m.forearm = g.cuff_b, g.Lw
    return m
