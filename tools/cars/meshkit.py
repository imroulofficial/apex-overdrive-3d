"""Watertight mesh primitives for the Blender car pipeline (tools/cars/build_car.py).

Every primitive returns a `Mesh`: vertices (n, 3) in the game frame (metres, x forward, y up,
z to the car's right), polygon faces (lists of vertex indices) and one material key per face.
Each primitive is a closed 2-manifold by construction: rings wrap by index (no duplicated seam
vertices), ends are closed with poles, domes, fans or triangulated caps, and the result is
oriented outward. That is what makes "0 open edges" hold for every level of detail: an LOD
is the same function sampled with fewer segments, never a decimated mesh.

Only numpy and mathutils (for polygon triangulation) are needed.
"""

import math

import numpy as np

try:
    from mathutils import Vector
    from mathutils.geometry import tessellate_polygon
except ImportError:  # pragma: no cover - only for linting outside Blender
    Vector = None
    tessellate_polygon = None

TAU = math.tau


# ---------------------------------------------------------------------------------------------
# Small maths helpers
# ---------------------------------------------------------------------------------------------

def norm(a, axis=-1):
    a = np.asarray(a, dtype=np.float64)
    n = np.linalg.norm(a, axis=axis, keepdims=True)
    return a / np.maximum(n, 1e-12)


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def window(x, a, b, soft):
    """1 inside [a, b], easing to 0 over `soft` outside."""
    return smoothstep(a - soft, a, x) * smoothstep(b + soft, b, x)


def spow(x, e):
    return np.sign(x) * np.abs(x) ** e


def lerp(a, b, t):
    return a + (b - a) * t


class Curve:
    """Monotone cubic (Fritsch-Carlson) interpolation through (x, y) keys; no overshoot, so a
    profile never bulges past its keys. Keys may come in any x order."""

    def __init__(self, keys):
        k = sorted(keys)
        self.x = np.array([p[0] for p in k], dtype=np.float64)
        self.y = np.array([p[1] for p in k], dtype=np.float64)
        x, y = self.x, self.y
        h = np.diff(x)
        d = np.diff(y) / h
        m = np.zeros_like(y)
        if len(x) > 1:
            m[0], m[-1] = d[0], d[-1]
            for i in range(1, len(x) - 1):
                if d[i - 1] * d[i] <= 0:
                    m[i] = 0.0
                else:
                    w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
                    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
        self.m = m

    def __call__(self, t):
        t = np.asarray(t, dtype=np.float64)
        x, y, m = self.x, self.y, self.m
        tc = np.clip(t, x[0], x[-1])
        i = np.clip(np.searchsorted(x, tc) - 1, 0, len(x) - 2)
        h = x[i + 1] - x[i]
        s = (tc - x[i]) / h
        h00 = (1 + 2 * s) * (1 - s) ** 2
        h10 = s * (1 - s) ** 2
        h01 = s * s * (3 - 2 * s)
        h11 = s * s * (s - 1)
        return h00 * y[i] + h10 * h * m[i] + h01 * y[i + 1] + h11 * h * m[i + 1]


def catmull(points, n=200, closed=False):
    """Centripetal Catmull-Rom through points (k, d); returns n samples resampled to equal
    arc length (closed: n distinct samples of a loop)."""
    P = np.asarray(points, dtype=np.float64)
    if closed:
        P = np.vstack([P[-1], P, P[0], P[1]])
    else:
        P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        t0 = 0.0
        t1 = t0 + max(np.linalg.norm(p1 - p0), 1e-9) ** 0.5
        t2 = t1 + max(np.linalg.norm(p2 - p1), 1e-9) ** 0.5
        t3 = t2 + max(np.linalg.norm(p3 - p2), 1e-9) ** 0.5
        for t in np.linspace(t1, t2, 24, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    if not closed:
        out.append(P[-2])
    return resample(np.array(out), n, closed=closed)


def chaikin(points, n=None, iters=3, closed=True):
    """Corner-cutting smoothing of a closed outline (never overshoots its control polygon, so
    extremes such as the car's nose and tail stay exactly where they are drawn); resampled to n
    points by arc length when n is given."""
    P = np.asarray(points, dtype=np.float64)
    for _ in range(iters):
        Q = np.roll(P, -1, 0) if closed else P[1:]
        A = P if closed else P[:-1]
        a = 0.75 * A + 0.25 * Q
        b = 0.25 * A + 0.75 * Q
        P = np.stack([a, b], 1).reshape(-1, P.shape[1])
    return resample(P, n, closed=closed) if n else P


def resample(P, n, closed=False):
    """Resamples a polyline (k, d) to n points evenly spaced by arc length."""
    P = np.asarray(P, dtype=np.float64)
    Q = np.vstack([P, P[:1]]) if closed else P
    seg = np.linalg.norm(np.diff(Q, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    total = s[-1]
    t = np.linspace(0, total, n, endpoint=not closed) if not closed else np.arange(n) * total / n
    out = np.empty((n, P.shape[1]))
    for d in range(P.shape[1]):
        out[:, d] = np.interp(t, s, Q[:, d])
    return out


def rot(axis, ang):
    axis = norm(axis)
    x, y, z = axis
    c, s = math.cos(ang), math.sin(ang)
    C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


# ---------------------------------------------------------------------------------------------
# Mesh container
# ---------------------------------------------------------------------------------------------

class Mesh:
    def __init__(self, V=None, F=None, mats=None, mat='default'):
        self.V = np.zeros((0, 3)) if V is None else np.asarray(V, dtype=np.float64)
        self.F = [] if F is None else [list(f) for f in F]
        if mats is None:
            mats = [mat] * len(self.F)
        self.mats = list(mats)

    def copy(self):
        return Mesh(self.V.copy(), [list(f) for f in self.F], list(self.mats))

    def __iadd__(self, other):
        off = len(self.V)
        self.V = np.vstack([self.V, other.V]) if len(self.V) else other.V.copy()
        self.F += [[i + off for i in f] for f in other.F]
        self.mats += other.mats
        return self

    def __add__(self, other):
        m = self.copy()
        m += other
        return m

    def set_mat(self, mat):
        self.mats = [mat] * len(self.F)
        return self

    def transform(self, R=None, t=(0, 0, 0), s=None):
        V = self.V
        if s is not None:
            V = V * np.asarray(s, dtype=np.float64)
        if R is not None:
            V = V @ np.asarray(R).T
        self.V = V + np.asarray(t, dtype=np.float64)
        if s is not None and np.prod(np.sign(s)) < 0:
            self.F = [f[::-1] for f in self.F]
        return self

    def mirrored_z(self):
        m = self.copy()
        m.V[:, 2] *= -1
        m.F = [f[::-1] for f in m.F]
        return m

    def tris(self):
        return sum(len(f) - 2 for f in self.F)

    def signed_volume(self):
        V = self.V
        vol = 0.0
        for f in self.F:
            a = V[f[0]]
            for k in range(1, len(f) - 1):
                vol += np.dot(a, np.cross(V[f[k]], V[f[k + 1]]))
        return vol / 6.0

    def orient_outward(self):
        if self.signed_volume() < 0:
            self.F = [f[::-1] for f in self.F]
        return self

    def open_edges(self):
        """Edges used by exactly one face, counted after welding vertices at the same position
        (the way a renderer sees cracks). 0 for a closed surface."""
        key = np.round(self.V / 1e-6).astype(np.int64)
        _, inv = np.unique(key, axis=0, return_inverse=True)
        inv = inv.ravel()
        count = {}
        for f in self.F:
            for k in range(len(f)):
                a, b = inv[f[k]], inv[f[(k + 1) % len(f)]]
                if a == b:
                    continue
                e = (a, b) if a < b else (b, a)
                count[e] = count.get(e, 0) + 1
        return sum(1 for c in count.values() if c == 1)


# ---------------------------------------------------------------------------------------------
# Caps
# ---------------------------------------------------------------------------------------------

def _tess(ring):
    """Triangulates a (possibly concave, roughly planar) ring; returns index triples into ring."""
    P = np.asarray(ring)
    c = P.mean(0)
    # Plane of the ring by Newell's method.
    n = np.zeros(3)
    for i in range(len(P)):
        a, b = P[i] - c, P[(i + 1) % len(P)] - c
        n += np.cross(a, b)
    n = norm(n)
    u = norm(np.cross(n, [0, 0, 1] if abs(n[2]) < 0.9 else [1, 0, 0]))
    v = np.cross(n, u)
    pts = [Vector((float(np.dot(p - c, u)), float(np.dot(p - c, v)), 0.0)) for p in P]
    return tessellate_polygon([pts])


def cap_ring(mesh, idx, kind='fan', at=None, mat=None, flip=False):
    """Closes the ring of vertex indices `idx` (ordered) in `mesh`.
    kind 'fan': triangle fan to the ring centroid (or `at`); 'flat': triangulated polygon."""
    mat = mat or (mesh.mats[0] if mesh.mats else 'default')
    if kind == 'flat':
        ring = mesh.V[idx]
        for tri in _tess(ring):
            f = [idx[tri[0]], idx[tri[1]], idx[tri[2]]]
            mesh.F.append(f[::-1] if flip else f)
            mesh.mats.append(mat)
        return
    c = np.asarray(at if at is not None else mesh.V[idx].mean(0))
    ci = len(mesh.V)
    mesh.V = np.vstack([mesh.V, c[None]])
    n = len(idx)
    for k in range(n):
        f = [idx[k], idx[(k + 1) % n], ci]
        mesh.F.append(f[::-1] if flip else f)
        mesh.mats.append(mat)


# ---------------------------------------------------------------------------------------------
# Lofts
# ---------------------------------------------------------------------------------------------

def loft(rings, mat='default', cap0='fan', cap1='fan', mats=None, closed=False, cap_mat=None):
    """Skins a sequence of rings (S, N, 3), each a closed loop of N points in the same order.
    cap0/cap1: 'fan', 'flat', None (only with closed=True: the last ring joins the first) or a
    point (pole). `mats` may give a material per ring band (S-1) or per face column."""
    R = np.asarray(rings, dtype=np.float64)
    S, N = R.shape[:2]
    V = R.reshape(-1, 3)
    F, M = [], []
    bands = S if closed else S - 1
    for i in range(bands):
        i2 = (i + 1) % S
        for j in range(N):
            j2 = (j + 1) % N
            F.append([i * N + j, i * N + j2, i2 * N + j2, i2 * N + j])
            if mats is None:
                M.append(mat)
            elif callable(mats):
                M.append(mats(i, j))
            else:
                M.append(mats[i])
    m = Mesh(V, F, M)
    if not closed:
        for cap, ring_i, flip in ((cap0, 0, True), (cap1, S - 1, False)):
            idx = list(range(ring_i * N, ring_i * N + N))
            if cap is None:
                continue
            cm = cap_mat[0 if ring_i == 0 else 1] if isinstance(cap_mat, tuple) else (cap_mat or mat)
            if isinstance(cap, str):
                cap_ring(m, idx, cap, mat=cm, flip=flip)
            else:
                cap_ring(m, idx, 'fan', at=cap, mat=cm, flip=flip)
    return m.orient_outward()


def dome_rings(ring, centre, axis, depth, steps=4, power=1.0):
    """Rings that close `ring` with a rounded dome bulging `depth` along `axis` (unit) from
    the ring plane; returns (rings, pole)."""
    ring = np.asarray(ring, dtype=np.float64)
    c = np.asarray(centre, dtype=np.float64)
    ax = norm(axis)
    out = []
    for k in range(1, steps + 1):
        a = (k / (steps + 1)) * (math.pi / 2)
        r = math.cos(a) ** power
        h = math.sin(a) * depth
        out.append(c + (ring - c) * r + ax * h)
    return out, c + ax * depth


def recess_rings(ring, centre, axis, lip=0.82, depth=0.12, steps=3, lip_round=0.012):
    """Rings that turn a loft end into an intake: a rounded lip that rolls in to `lip` of the
    mouth size, then a duct `depth` deep along -axis. Returns (rings, bottom pole)."""
    ring = np.asarray(ring, dtype=np.float64)
    c = np.asarray(centre, dtype=np.float64)
    ax = norm(axis)
    out = []
    for k in range(1, steps + 1):
        a = k / steps * math.pi / 2
        s = 1 - (1 - lip) * math.sin(a)
        out.append(c + (ring - c) * s + ax * lip_round * math.sin(a * 2) * 0.5)
    for k in range(1, steps + 1):
        t = k / steps
        s = lip * (1 - 0.25 * t)
        out.append(c + (ring - c) * s - ax * depth * t)
    return out, c - ax * depth * 1.05


def sweep(path, section, mat='default', cap0='dome', cap1='dome', up=(0, 1, 0), closed=False,
          dome_depth=None, dome_steps=3, mats=None):
    """Tube along `path` (S, 3) with cross-section `section(i, t) -> (N, 2)` points (a, b) in
    the path's normal frame (a along the side axis, b along the up-ish axis). Rotation-minimising
    frames keep the section from twisting. Ends: 'dome', 'fan', 'flat' or None (closed path)."""
    P = np.asarray(path, dtype=np.float64)
    S = len(P)
    if closed:
        T = norm(np.roll(P, -1, 0) - np.roll(P, 1, 0))
    else:
        T = np.gradient(P, axis=0)
        T = norm(T)
    upv = np.asarray(up, dtype=np.float64)
    N0 = np.cross(T[0], upv)
    if np.linalg.norm(N0) < 1e-6:
        N0 = np.cross(T[0], [1, 0, 0])
    Ns = [norm(N0)]
    for i in range(1, S):
        n = Ns[-1] - T[i] * np.dot(Ns[-1], T[i])
        Ns.append(norm(n))
    Ns = np.array(Ns)
    Bs = np.cross(T, Ns)
    rings = []
    for i in range(S):
        t = i / max(1, S - 1)
        sec = np.asarray(section(i, t), dtype=np.float64)
        rings.append(P[i] + sec[:, :1] * Ns[i] + sec[:, 1:2] * Bs[i])
    rings = np.array(rings)
    if closed:
        return loft(rings, mat, closed=True, mats=mats)
    caps = []
    pre, post = [], []
    for end, cap in ((0, cap0), (1, cap1)):
        if cap == 'dome':
            ring = rings[0] if end == 0 else rings[-1]
            c = ring.mean(0)
            ax = -T[0] if end == 0 else T[-1]
            rad = np.mean(np.linalg.norm(ring - c, axis=1))
            d = dome_depth if dome_depth is not None else rad * 0.9
            rr, pole = dome_rings(ring, c, ax, d, steps=dome_steps)
            if end == 0:
                pre = rr[::-1]
            else:
                post = rr
            caps.append(pole)
        else:
            caps.append(cap)
    all_rings = list(pre) + list(rings) + list(post)
    band_mats = None
    if mats is not None:
        band_mats = [mats[0]] * len(pre) + list(mats) + [mats[-1]] * (len(post) + 1)
    return loft(np.array(all_rings), mat, cap0=caps[0], cap1=caps[1], mats=band_mats)


def ellipse(a, b, n, e=1.0, phase=0.0):
    """n points of a superellipse with radii a, b (exponent e: 1 ellipse, <1 boxier)."""
    t = np.arange(n) / n * TAU + phase
    return np.stack([spow(np.cos(t), e) * a, spow(np.sin(t), e) * b], -1)


def tube(points, radius, n=12, mat='default', samples=None, cap='dome', section=None, up=(0, 1, 0),
         radius_fn=None):
    """Round (or `section`) tube through control points (Catmull-Rom), domed ends."""
    pts = np.asarray(points, dtype=np.float64)
    if samples is None:
        L = np.sum(np.linalg.norm(np.diff(pts, axis=0), axis=1))
        samples = max(2, int(L / 0.04) + 2)
    path = catmull(pts, samples) if len(pts) > 2 else resample(pts, samples)

    def sec(i, t):
        if section is not None:
            return section(i, t)
        r = radius * (radius_fn(t) if radius_fn else 1.0)
        return ellipse(r, r, n)

    return sweep(path, sec, mat, cap0=cap, cap1=cap, up=up)


def strut(a, b, w, h, n=10, mat='default', taper=1.0, up=(0, 1, 0), samples=4, e=1.0, cap='dome'):
    """Straight streamlined bar from a to b, elliptical w x h (half sizes) section."""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    path = np.array([lerp(a, b, t) for t in np.linspace(0, 1, samples)])

    def sec(i, t):
        k = lerp(1.0, taper, t)
        return ellipse(w * k, h * k, n, e=e)

    return sweep(path, sec, mat, up=up, dome_depth=min(w, h) * 0.9, dome_steps=2, cap0=cap, cap1=cap)


# ---------------------------------------------------------------------------------------------
# Revolves and rounded solids
# ---------------------------------------------------------------------------------------------

def revolve(profile, n, mat='default', axis='z', closed_profile=False, mats=None):
    """Surface of revolution of profile points (r, a) about the axis (`a` along it). Open
    profiles must start and end on the axis (r = 0): those ends become poles.
    Returns a mesh in a frame where the axis is z (default) or x / y."""
    P = np.asarray(profile, dtype=np.float64)
    ang = np.arange(n) / n * TAU
    rings = []
    for r, a in P:
        rings.append(np.stack([r * np.cos(ang), r * np.sin(ang), np.full(n, a)], -1))
    rings = np.array(rings)
    if closed_profile:
        m = loft(rings, mat, closed=True, mats=mats)
    else:
        # Poles replace the zero-radius rings.
        inner = rings[1:-1]
        p0 = np.array([0, 0, P[0][1]])
        p1 = np.array([0, 0, P[-1][1]])
        m = loft(inner, mat, cap0=p0, cap1=p1, mats=mats)
    if axis == 'x':
        m.V = m.V[:, [2, 0, 1]]
    elif axis == 'y':
        m.V = m.V[:, [1, 2, 0]]
    return m.orient_outward()


def blob(centre, half, n=24, rings=12, e1=1.0, e2=1.0, mat='default', R=None):
    """Superellipsoid (e ~0.3 rounded box, 1 ellipsoid) with poles on its local y axis."""
    c = np.asarray(centre, dtype=np.float64)
    h = np.asarray(half, dtype=np.float64)
    Rm = np.eye(3) if R is None else np.asarray(R)
    rs = []
    for k in range(1, rings):
        th = -math.pi / 2 + k / rings * math.pi
        ph = np.arange(n) / n * TAU
        x = h[0] * spow(math.cos(th), e1) * spow(np.cos(ph), e2)
        y = np.full(n, h[1] * spow(math.sin(th), e1))
        z = h[2] * spow(math.cos(th), e1) * spow(np.sin(ph), e2)
        rs.append(np.stack([x, y, z], -1) @ Rm.T + c)
    p0 = np.array([0, -h[1], 0]) @ Rm.T + c
    p1 = np.array([0, h[1], 0]) @ Rm.T + c
    return loft(np.array(rs), mat, cap0=p0, cap1=p1)


def slab(outline, thickness, axis=2, centre=0.0, round_r=None, mat='default', steps=2,
         n=None, outline_closed=True):
    """Extrudes a closed 2D outline (k, 2) along `axis` (0 x, 1 y, 2 z) into a plate with
    rounded edges: the faces are triangulated polygons, the rim a half-round of radius round_r.
    The outline's 2D coordinates are the two other axes in order (x, y, z minus `axis`)."""
    O = np.asarray(outline, dtype=np.float64)
    if n is not None:
        O = resample(O, n, closed=True)
    t2 = thickness / 2
    r = t2 if round_r is None else min(round_r, t2)
    # Inward offset of the outline for the flat faces (by r along the 2D normal).
    k = len(O)
    sgn = 1.0 if _area2(O) > 0 else -1.0
    tang = np.roll(O, -1, 0) - np.roll(O, 1, 0)
    nrm2 = norm(np.stack([tang[:, 1], -tang[:, 0]], -1)) * sgn  # outward
    rings = []
    for i in range(steps * 2 + 1):
        a = -math.pi / 2 + i / (steps * 2) * math.pi
        off = (math.cos(a) - 1) * r
        h = math.sin(a) * r
        h = (t2 - r) * np.sign(h) + h if abs(h) > 1e-12 else 0.0
        o2 = O + nrm2 * off
        P = np.zeros((k, 3))
        others = [d for d in range(3) if d != axis]
        P[:, others[0]] = o2[:, 0]
        P[:, others[1]] = o2[:, 1]
        P[:, axis] = centre + h
        rings.append(P)
    return loft(np.array(rings), mat, cap0='flat', cap1='flat')


def _area2(O):
    x, y = O[:, 0], O[:, 1]
    return 0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y)


def rounded_rect(hx, hy, r, n_corner=4, cx=0.0, cy=0.0):
    """Closed outline of a rounded rectangle (counter-clockwise)."""
    pts = []
    for (sx, sy, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ccx, ccy = cx + sx * (hx - r), cy + sy * (hy - r)
        for i in range(n_corner + 1):
            a = math.radians(a0 + 90 * i / n_corner)
            pts.append((ccx + r * math.cos(a), ccy + r * math.sin(a)))
    return np.array(pts)


def patch_slab(fn, nu, nv, thickness, mat='default', side_mat=None, outward=None):
    """A closed plate laid on a surface: fn(u, v) -> (points (..., 3), normals (..., 3)) over
    u, v in 0..1; the plate goes from the surface out by `thickness` along the normal. Used for
    visors, stickers, lenses and anything that hugs a body panel."""
    u, v = np.meshgrid(np.linspace(0, 1, nu + 1), np.linspace(0, 1, nv + 1))
    P, Nn = fn(u, v)
    top = P + Nn * thickness
    W = nu + 1
    V = np.vstack([P.reshape(-1, 3), top.reshape(-1, 3)])
    off = (nv + 1) * W
    F, M = [], []
    for j in range(nv):
        for i in range(nu):
            a = j * W + i
            F.append([a, a + W, a + W + 1, a + 1])
            M.append(mat)
            F.append([off + a, off + a + 1, off + a + W + 1, off + a + W])
            M.append(mat)
    sm = side_mat or mat
    border = [j * W + 0 for j in range(nv + 1)][::-1]
    border = ([i for i in range(W)] + [j * W + nu for j in range(1, nv + 1)]
              + [nv * W + i for i in range(nu - 1, -1, -1)] + [j * W for j in range(nv - 1, 0, -1)])
    for k in range(len(border)):
        a, b = border[k], border[(k + 1) % len(border)]
        F.append([a, b, off + b, off + a])
        M.append(sm)
    return Mesh(V, F, M).orient_outward()


# ---------------------------------------------------------------------------------------------
# Wings
# ---------------------------------------------------------------------------------------------

def airfoil(n, thickness=0.12, camber=0.06, camber_pos=0.4, te=0.004):
    """Closed NACA-style 4-digit section, chord 0..1 along +c, thickness along +t, cambered
    toward -t (an inverted, downforce wing when +t is up). n points, starting at the trailing
    edge, going over the top (+t) to the leading edge and back under."""
    k = n // 2
    beta = np.linspace(0, math.pi, k + 1)
    xc = (1 - np.cos(beta)) / 2  # cosine spacing: dense at the leading edge
    yt = 5 * thickness * (0.2969 * np.sqrt(xc) - 0.1260 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1036 * xc ** 4)
    yt = np.maximum(yt, te * (xc))  # blunt trailing edge keeps a little thickness
    m, p = camber, camber_pos
    yc = np.where(xc < p, m / p ** 2 * (2 * p * xc - xc ** 2), m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * xc - xc ** 2))
    dyc = np.where(xc < p, 2 * m / p ** 2 * (p - xc), 2 * m / (1 - p) ** 2 * (p - xc))
    th = np.arctan(dyc)
    yc, th = -yc, -th
    xu, yu = xc - yt * np.sin(th), yc + yt * np.cos(th)
    xl, yl = xc + yt * np.sin(th), yc - yt * np.cos(th)
    upper = np.stack([xu, yu], -1)[::-1]   # TE -> LE over the top
    lower = np.stack([xl, yl], -1)[1:-1]   # LE -> TE underneath (no duplicate LE / TE)
    return np.vstack([upper, lower])


def wing(span_pts, chord, aoa, sec, mat='default', cap='flat', le_dir=(-1, 0, 0), up=(0, 1, 0)):
    """Airfoil loft along a span path. span_pts (S, 3) are leading-edge points; chord(t) and
    aoa(t) (radians, positive = trailing edge up) are functions of span parameter t in 0..1;
    sec is an airfoil() array. The chord runs along le_dir (rearward) rotated by aoa about the
    span direction."""
    P = np.asarray(span_pts, dtype=np.float64)
    S = len(P)
    rings = []
    span_dir = norm(np.gradient(P, axis=0))
    cdir0 = norm(le_dir)
    for i in range(S):
        t = i / max(1, S - 1)
        sd = span_dir[i]
        c0 = norm(cdir0 - sd * np.dot(cdir0, sd))
        u0 = norm(np.cross(sd, c0))
        if np.dot(u0, up) < 0:
            u0 = -u0
        a = aoa(t) if callable(aoa) else aoa
        # Trailing edge up = rotate chord toward +up.
        cd = c0 * math.cos(a) + u0 * math.sin(a)
        ud = u0 * math.cos(a) - c0 * math.sin(a)
        ch = chord(t) if callable(chord) else chord
        rings.append(P[i] + ch * (sec[:, :1] * cd + sec[:, 1:2] * ud))
    return loft(np.array(rings), mat, cap0=cap, cap1=cap)


def fillet_poly(ctrl, radii, edge_n, arc_n, density=None):
    """Closed 2-D section with rounded corners and a FIXED point count, so sections built from
    the same control layout at different stations loft cleanly (same topology).

    ctrl    (K, 2) corners in order; radii (K,) fillet radius per corner (small = crisp edge)
    edge_n  points strictly inside each edge i (corner i -> i+1); arc_n points per corner arc
    density optional fn(edge_i, t) -> weight, to bunch an edge's points (t in 0..1)
    Returns (points (M, 2), starts) where starts[i] is the index of corner i's arc middle, which
    is a stable row for material zones (a paint line exactly on a crease).
    """
    P = np.asarray(ctrl, dtype=np.float64)
    K = len(P)
    radii = np.broadcast_to(np.asarray(radii, dtype=np.float64), (K,))
    edge_n = np.broadcast_to(np.asarray(edge_n), (K,))
    arc_n = np.broadcast_to(np.asarray(arc_n), (K,))
    T1, T2, arcs = [], [], []
    for i in range(K):
        p0, p1, p2 = P[i - 1], P[i], P[(i + 1) % K]
        la, lb = np.linalg.norm(p0 - p1), np.linalg.norm(p2 - p1)
        a, b = (p0 - p1) / la, (p2 - p1) / lb
        cosang = np.clip(np.dot(a, b), -0.9999, 0.9999)
        half = math.acos(cosang) / 2
        r = float(radii[i])
        d = r / max(math.tan(half), 1e-6)
        dmax = 0.45 * min(la, lb)
        if d > dmax:
            d = dmax
            r = d * math.tan(half)
        t1, t2 = p1 + a * d, p1 + b * d
        n = int(arc_n[i])
        if r < 1e-6 or n < 2:
            pts = np.repeat(p1[None], max(n, 1), 0) if n > 0 else np.zeros((0, 2))
        else:
            bis = norm(a + b)
            c = p1 + bis * (r / math.sin(half))
            a1 = math.atan2(*(t1 - c)[::-1])
            a2 = math.atan2(*(t2 - c)[::-1])
            da = (a2 - a1 + math.pi) % TAU - math.pi
            ang = a1 + da * np.linspace(0, 1, n)
            pts = c + r * np.stack([np.cos(ang), np.sin(ang)], -1)
        T1.append(t1)
        T2.append(t2)
        arcs.append(pts)
    out, starts = [], []
    for i in range(K):
        starts.append(sum(len(x) for x in out) + len(arcs[i]) // 2)
        out.append(arcs[i])
        n = int(edge_n[i])
        if n > 0:
            a, b = T2[i], T1[(i + 1) % K]
            t = np.linspace(0, 1, n + 2)[1:-1]
            if density is not None:
                tt = np.linspace(0, 1, 401)
                w = np.array([density(i, x) for x in (tt[1:] + tt[:-1]) / 2])
                acc = np.concatenate([[0], np.cumsum(w)])
                acc /= acc[-1]
                t = np.interp(t, acc, tt)
            out.append(a + (b - a) * t[:, None])
    return np.vstack(out), starts
