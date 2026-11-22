"""Apex Overdrive cockpit: builds the driver-view cabin in Blender, bakes its textures and exports
the meshes that tools/cockpit/pack.mjs turns into public/assets/cockpit/*.glb.

Run with Blender's Python module (pip install bpy==5.2.4, Python 3.13) or inside Blender:

    python tools/cockpit/build_cockpit.py [--size 2048] [--samples 64] [--preview]
    blender -b -P tools/cockpit/build_cockpit.py -- [same options]

Everything is generated from code: no .blend file, no downloaded asset. The design is original
(no real manufacturer's interior, logo or badge). Outputs go to tools/cockpit/build/ (ignored by
git): cockpit_high.glb and cockpit_low.glb (geometry only, one mesh per runtime part) and the
baked texture atlases as 16-bit PNGs. pack.mjs then makes the three shipped files.

Frames. Like src/race/cockpit.js, every coordinate here is in metres in the driver's frame:
x forward, y up, z right, origin at the driver's eye. Blender is z-up, so vertices are written
through B: (x, y, z) -> (x, -z, y); the glTF exporter turns that back into (x, y, z).

Runtime parts (one glTF mesh each, one material each):
    cockpit_shell        the cabin: sculpted dash and instrument hood, binnacle, dial bezels,
                         air vents, centre stack and console, door cards and handles, A-pillars,
                         roof lining and visors, seat edges, mirror housings, steering column
                         (cabin atlas)
    cockpit_trim         carbon accents tinted with the car's paint at runtime (tiling carbon)
    cockpit_wheel        3-spoke wheel: leather rim with stitching, brushed spokes, hub with a
                         generic hex badge, buttons, carbon paddles (wheel atlas, wheel frame)
    cockpit_wheel_trim   the tinted rim marker and spoke inserts (tiling carbon, wheel frame)
    cockpit_hands        both gloved hands wrapped round the rim (wheel atlas, wheel frame)
    cockpit_forearm_l/r  racing-suit sleeves, unit length along +y from the elbow (wheel atlas)
    cockpit_needle       one gauge needle, pivot at the origin, pointing +y (cluster frame)
    cockpit_mirror_glass rear-view and wing mirror glass, uv mapped onto the live rear view
"""

import argparse
import math
import os
import sys
import time

import numpy as np

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument('--out', default=os.path.join(HERE, 'build'))
ap.add_argument('--size', type=int, default=2048, help='bake resolution of each atlas')
ap.add_argument('--samples', type=int, default=64, help='Cycles samples for the AO and light bakes')
ap.add_argument('--preview', action='store_true', help='also render a Cycles preview from the eye')
ap.add_argument('--no-bake', action='store_true', help='geometry only (fast iteration)')
ap.add_argument('--report', action='store_true', help='list the triangles of every part')
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True)

# ---------------------------------------------------------------------------------------------
# Shared with src/race/cockpit.js (keep in step)
# ---------------------------------------------------------------------------------------------
DASH_Z = (-0.84, 1.54)          # cabin width, door to door
HOOD_Z = 0.24                   # half-width of the hood over the instruments
WHEEL_PIVOT = (0.56, -0.44, 0.0)
WHEEL_TILT = -0.35              # about z
RIM_R = 0.165
GRIP_Y = 0.07
CLUSTER_POS = (0.785, -0.32, 0.0)
CLUSTER_TILT = -0.42
FACE_W, FACE_H = 0.34, 0.17
PX = FACE_W / 512               # cluster texture pixel in metres
DIAL_R, DIAL_L, DIAL_R_X, DIAL_Y = 92, 104, 408, 150
ELBOWS = [(0.16, -0.64, -0.44), (0.16, -0.64, 0.44)]
VENTS = [0.25, 0.47, -0.62]
CAR_CENTRE_Z = 0.36

TAU = 2 * math.pi

# ---------------------------------------------------------------------------------------------
# Small maths helpers (numpy, vectorised over parameter grids)
# ---------------------------------------------------------------------------------------------

def v3(*a):
    return np.array(a, dtype=np.float64)


def norm(a, axis=-1):
    n = np.linalg.norm(a, axis=axis, keepdims=True)
    return a / np.maximum(n, 1e-12)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def window(x, a, b, soft):
    """1 inside [a, b], easing to 0 over `soft` outside."""
    return smoothstep(a - soft, a, x) * (1 - smoothstep(b, b + soft, x))


def spow(x, e):
    return np.sign(x) * np.abs(x) ** e


def catmull(points, n=400):
    """Dense centripetal Catmull-Rom through `points` (k x d), resampled evenly by arc length.
    Returns a function t (0..1, array) -> points."""
    P = np.asarray(points, dtype=np.float64)
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        t0 = 0.0
        t1 = t0 + np.linalg.norm(p1 - p0) ** 0.5 + 1e-9
        t2 = t1 + np.linalg.norm(p2 - p1) ** 0.5 + 1e-9
        t3 = t2 + np.linalg.norm(p3 - p2) ** 0.5 + 1e-9
        for t in np.linspace(t1, t2, 40, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    out.append(P[-2])
    D = np.array(out)
    seg = np.linalg.norm(np.diff(D, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    s /= s[-1]

    def f(t):
        t = np.asarray(t, dtype=np.float64)
        return np.stack([np.interp(t, s, D[:, k]) for k in range(D.shape[1])], axis=-1)

    return f


def rot_axis(axis, ang):
    axis = norm(np.asarray(axis, dtype=np.float64))
    x, y, z = axis
    c, s = math.cos(ang), math.sin(ang)
    C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def mat4(R=None, t=(0, 0, 0), s=(1, 1, 1)):
    M = np.eye(4)
    M[:3, :3] = (np.eye(3) if R is None else R) @ np.diag(s)
    M[:3, 3] = t
    return M


def apply(M, P):
    return P @ M[:3, :3].T + M[:3, 3]


ROT_Z = lambda a: rot_axis((0, 0, 1), a)  # noqa: E731
ROT_X = lambda a: rot_axis((1, 0, 0), a)  # noqa: E731
WHEEL_M = mat4(ROT_Z(WHEEL_TILT), WHEEL_PIVOT)
CLUSTER_M = mat4(ROT_Z(CLUSTER_TILT), CLUSTER_POS)


def face_px(px, py, x=0.0):
    """A point on the cluster face (texture pixels) in the cluster frame."""
    return v3(x, (128 - py) * PX, (px - 256) * PX)


# ---------------------------------------------------------------------------------------------
# Parts: parametric surfaces. Each one is a function of (u, v) in 0..1, so every level of detail
# shares one texture layout: its uv island depends on its size in metres, never on how finely
# it is tessellated.
# ---------------------------------------------------------------------------------------------

class Part:
    def __init__(self, name, group, mat, fn, nu, nv, density=1.0, closed=None, min_lod=0.0,
                 stitch=(), extra=None, wrap_u=False, cap=None):
        self.name = name
        self.group = group          # which runtime mesh it joins
        self.mat = mat              # bake material kind
        self.fn = fn                # (u, v) grids -> (..., 3) points
        self.nu, self.nv = nu, nv   # segments at full detail
        self.density = density      # texel density weight in its atlas
        self.closed = closed        # orientation rule: True (volume), False (faces the eye)
        self.min_lod = min_lod      # dropped below this detail level
        self.stitch = stitch        # (('u'|'v', param position), ...) stitched seams
        self.extra = extra or {}
        self.wrap_u = wrap_u
        self.cap = cap
        P = self.points(33, 33)
        self.Lu = float(np.mean(np.sum(np.linalg.norm(np.diff(P, axis=1), axis=-1), axis=1)))
        self.Lv = float(np.mean(np.sum(np.linalg.norm(np.diff(P, axis=0), axis=-1), axis=0)))

    def points(self, nu, nv):
        u, v = np.meshgrid(np.linspace(0, 1, nu + 1), np.linspace(0, 1, nv + 1))
        return self.fn(u, v)

    def build(self, lod):
        nu = max(3, int(round(self.nu * lod_scale(lod, self.nu))))
        nv = max(1, int(round(self.nv * lod_scale(lod, self.nv))))
        P = self.points(nu, nv)
        V = P.reshape(-1, 3)
        u, v = np.meshgrid(np.linspace(0, 1, nu + 1), np.linspace(0, 1, nv + 1))
        UV = np.stack([u.ravel(), v.ravel()], axis=-1)
        F = []
        W = nu + 1
        for j in range(nv):
            for i in range(nu):
                a = j * W + i
                F.append((a, a + 1, a + W + 1, a + W))
        return V, np.array(F, dtype=np.int64), UV


def lod_scale(lod, n):
    # Low detail: segment counts shrink, the small ones less (a 6-sided tube stays round-ish).
    if lod >= 1:
        return 1.0
    k = lod
    return max(k, min(1.0, 6.0 / max(n, 1)))


def sheet(name, group, mat, fn, nu, nv, **kw):
    return Part(name, group, mat, fn, nu, nv, closed=False, **kw)


def sweep(name, group, mat, path, section, nu, nv, up=(0, 1, 0), **kw):
    """A tube along `path(v) -> (n, 3)` with cross-section `section(u, v) -> (a, b)` offsets
    along the path's side axis `n` and its `b` axis (b = t x n)."""
    upv = np.asarray(up, dtype=np.float64)

    def fn(u, v):
        vs = v[:, 0]
        P = path(vs)
        eps = 1e-3
        T = norm(path(np.clip(vs + eps, 0, 1)) - path(np.clip(vs - eps, 0, 1)))
        N = norm(np.cross(T, upv))
        Bn = norm(np.cross(T, N))
        a, b = section(u, v)
        return P[:, None, :] + a[..., None] * N[:, None, :] + b[..., None] * Bn[:, None, :]

    kw.setdefault('closed', True)
    return Part(name, group, mat, fn, nu, nv, wrap_u=True, **kw)


def ellipse_section(ra, rb, prof=None):
    """Elliptical section of radii ra, rb (numbers or functions of v), times prof(v)."""
    def sec(u, v):
        A = ra(v) if callable(ra) else ra
        Bv = rb(v) if callable(rb) else rb
        k = prof(v) if prof else 1.0
        ang = u * TAU
        return np.cos(ang) * A * k, np.sin(ang) * Bv * k
    return sec


def superellipse_section(ra, rb, e=0.35, prof=None):
    def sec(u, v):
        A = ra(v) if callable(ra) else ra
        Bv = rb(v) if callable(rb) else rb
        k = prof(v) if prof else 1.0
        ang = u * TAU
        return spow(np.cos(ang), e) * A * k, spow(np.sin(ang), e) * Bv * k
    return sec


def blob(name, group, mat, centre, half, e1=0.4, e2=0.4, R=None, nu=24, nv=12, **kw):
    """Superellipsoid: a rounded box (e ~0.2-0.4) or a pebble (e ~1)."""
    c = np.asarray(centre, dtype=np.float64)
    h = np.asarray(half, dtype=np.float64)
    Rm = np.eye(3) if R is None else R

    def fn(u, v):
        th = (v - 0.5) * math.pi
        ph = (u - 0.5) * TAU
        x = h[0] * spow(np.cos(th), e1) * spow(np.cos(ph), e2)
        y = h[1] * spow(np.sin(th), e1)
        z = h[2] * spow(np.cos(th), e1) * spow(np.sin(ph), e2)
        P = np.stack([x, y, z], axis=-1)
        return P @ Rm.T + c

    kw.setdefault('closed', True)
    return Part(name, group, mat, fn, nu, nv, wrap_u=True, **kw)


def ring(name, group, mat, centre, R, half, radius, tube, nu=10, nv=48, corner=None, **kw):
    """A tube swept round a rounded rectangle (half sizes along the frame's y and z, corner
    radius) or a circle (corner None, half = radius) in the plane x = const of frame R."""
    c = np.asarray(centre, dtype=np.float64)
    Rm = np.eye(3) if R is None else R

    def path(t):
        ang = t * TAU
        if corner is None:
            y = radius * np.cos(ang)
            z = radius * np.sin(ang)
        else:
            # Superellipse with an exponent that gives about the asked corner radius.
            e = max(0.08, min(1.0, corner / max(1e-6, min(half))))
            y = half[0] * spow(np.cos(ang), e)
            z = half[1] * spow(np.sin(ang), e)
        P = np.stack([np.zeros_like(y), y, z], axis=-1)
        return P @ Rm.T + c

    axis = Rm @ v3(1, 0, 0)
    return sweep(name, group, mat, path, ellipse_section(tube[0], tube[1]), nu, nv, up=axis, **kw)


def lathe(name, group, mat, profile, M, nu=32, nv=8, **kw):
    """Surface of revolution about the frame's x axis: profile(v) -> (x, r) (arrays)."""
    def fn(u, v):
        x, r = profile(v)
        ang = u * TAU
        P = np.stack([x, r * np.cos(ang), r * np.sin(ang)], axis=-1)
        return apply(M, P)
    kw.setdefault('closed', True)
    return Part(name, group, mat, fn, nu, nv, wrap_u=True, **kw)


def transform(part, M):
    fn = part.fn
    part.fn = lambda u, v: apply(M, fn(u, v))
    return part


# ---------------------------------------------------------------------------------------------
# The cabin (cabin frame)
# ---------------------------------------------------------------------------------------------

DASH_TOP = [(1.17, -0.318), (1.10, -0.307), (1.02, -0.302), (0.94, -0.309), (0.885, -0.322), (0.85, -0.343)]
DASH_FACE = [(0.85, -0.343), (0.826, -0.37), (0.812, -0.41), (0.807, -0.475), (0.805, -0.56), (0.802, -0.72), (0.795, -1.05)]
dash_top_f = catmull(DASH_TOP)
dash_face_f = catmull(DASH_FACE)


def dash_point(f, u, v, stack=False):
    P = f(v)
    x, y = P[..., 0], P[..., 1]
    z = DASH_Z[0] + (DASH_Z[1] - DASH_Z[0]) * u
    # A soft crown across the cabin and a gentle wave toward the passenger.
    y = y + 0.006 * np.sin(math.pi * u) * smoothstep(1.0, 0.95, x)
    if stack:
        # Centre stack: the face swells toward the driver below the vents.
        w = window(z, 0.18, 0.56, 0.08) * smoothstep(-0.5, -0.6, y)
        x = x - 0.045 * w
    return np.stack([x, y, z], axis=-1)


def dash_y_at(x):
    """Dash top height at x (for blending the hood into it)."""
    P = dash_top_f(np.linspace(0, 1, 200))
    order = np.argsort(P[:, 0])
    return np.interp(x, P[order, 0], P[order, 1])


HOOD_PROFILE = catmull([(0.99, -0.309), (0.93, -0.272), (0.875, -0.245), (0.835, -0.231), (0.808, -0.228),
                        (0.794, -0.236), (0.797, -0.249), (0.815, -0.254)])


def hood_fn(u, v):
    z = (u * 2 - 1) * (HOOD_Z + 0.03)
    zz = np.abs(z) / HOOD_Z
    h = np.clip(1 - zz ** 3, 0, 1) ** 0.75
    h = smoothstep(0, 1, h)
    P = HOOD_PROFILE(v)
    fx = np.maximum(P[..., 0], 0.86 + 0.13 * (1 - v))
    fx = 0.99 - 0.13 * v
    fy = dash_y_at(fx) + 0.001
    x = fx + (P[..., 0] - fx) * h
    y = fy + (P[..., 1] - fy) * h
    return np.stack([x, y, z], axis=-1)


def door_parts(side):
    """Door card on the left (side -1) or right (side 1): sill, upper panel, Alcantara insert,
    stitched leather armrest, lower panel."""
    wall = DASH_Z[0] if side < 0 else DASH_Z[1]
    inward = 1 if side < 0 else -1
    X0, X1 = -0.68, 1.16
    sections = [
        ('sill', 'soft_plastic', [(-0.296, 0.0), (-0.300, 0.016), (-0.309, 0.034), (-0.322, 0.044), (-0.345, 0.047), (-0.40, 0.044)], 1.0),
        ('insert', 'alcantara', [(-0.40, 0.044), (-0.44, 0.043), (-0.48, 0.042), (-0.505, 0.044)], 0.8),
        ('armrest', 'leather', [(-0.505, 0.044), (-0.525, 0.062), (-0.545, 0.09), (-0.565, 0.1), (-0.59, 0.097), (-0.612, 0.072), (-0.64, 0.052)], 0.7),
        ('lower', 'hard_plastic', [(-0.64, 0.052), (-0.75, 0.046), (-0.95, 0.043), (-1.35, 0.04)], 0.25),
    ]
    parts = []
    for key, mat, prof, dens in sections:
        f = catmull(prof)

        def fn(u, v, f=f, key=key):
            x = X0 + (X1 - X0) * u
            P = f(v)
            y, d = P[..., 0], P[..., 1]
            if key in ('armrest', 'insert'):
                w = window(x, -0.45, 0.5, 0.18)
                d = 0.044 + (d - 0.044) * w
            # Toward the dash the panel curves in to meet it.
            d = d + 0.03 * smoothstep(0.95, 1.16, x)
            return np.stack([x, y, wall + inward * d], axis=-1)

        stitch = (('v', 0.06), ('v', 0.94)) if key == 'armrest' else ()
        parts.append(sheet(f'door_{key}_{side}', 'cabin', mat, fn, 48, {'sill': 9, 'insert': 4, 'armrest': 10, 'lower': 4}[key], density=dens, stitch=stitch))
    # Door pull: a dark recess and a brushed lever.
    z = wall + inward * 0.05
    parts.append(blob(f'door_cup_{side}', 'cabin', 'hard_plastic', (0.40, -0.425, z), (0.085, 0.024, 0.012), 0.3, 0.3, nu=20, nv=10, density=1.2))
    parts.append(blob(f'door_lever_{side}', 'cabin', 'alu', (0.40, -0.418, z + inward * 0.012), (0.065, 0.008, 0.007), 0.35, 0.35, nu=20, nv=10, density=1.5))
    # Window switches on the armrest front.
    for i in range(2):
        parts.append(blob(f'door_switch_{side}_{i}', 'cabin', 'gloss_black', (0.43 + i * 0.045, -0.547, wall + inward * 0.09), (0.016, 0.006, 0.012), 0.3, 0.3, nu=12, nv=6, density=1.0, min_lod=0.5))
    # Speaker grille low on the door.
    parts.append(blob(f'door_speaker_{side}', 'cabin', 'grille_dots', (0.55, -0.82, wall + inward * 0.043), (0.08, 0.08, 0.008), 1.0, 1.0, R=None, nu=24, nv=12, density=0.4, min_lod=0.5))
    return parts


def cabin_parts():
    P = []
    # Dashboard: stitched leather top, soft-touch face with the centre stack.
    P.append(sheet('dash_top', 'cabin', 'leather', lambda u, v: dash_point(dash_top_f, u, v), 120, 18, density=1.0, stitch=(('v', 0.975),)))
    P.append(sheet('dash_face', 'cabin', 'soft_plastic', lambda u, v: dash_point(dash_face_f, u, v, stack=True), 120, 24, density=0.8))
    # Defroster grille along the glass and corner speakers.
    P.append(blob('defrost', 'cabin', 'grille', (1.12, -0.305, 0.35), (0.028, 0.004, 0.78), 0.25, 0.25, nu=48, nv=8, density=0.6))
    for z in (-0.62, 1.36):
        P.append(blob(f'dash_speaker_{z}', 'cabin', 'grille_dots', (1.05, -0.3, z), (0.045, 0.004, 0.045), 0.3, 1.0, nu=24, nv=8, density=0.8))
    # Instrument hood (stitched along the brow) and the binnacle under it.
    P.append(sheet('hood', 'cabin', 'leather', hood_fn, 56, 30, density=1.6, stitch=(('v', 0.6),)))
    P += binnacle_parts()
    # Air vents on the dash face (bezel rings are tinted trim).
    for z in VENTS:
        P.append(blob(f'vent_back_{z}', 'cabin', 'vent', (0.803, -0.402, z), (0.006, 0.027, 0.049), 0.2, 0.2, nu=20, nv=8, density=1.4))
        for i in range(4):
            y = -0.402 + (i - 1.5) * 0.0125
            P.append(blob(f'vent_slat_{z}_{i}', 'cabin', 'soft_plastic', (0.795, y, z), (0.009, 0.0016, 0.046), 0.3, 0.2, R=ROT_Z(-0.22), nu=12, nv=6, density=0.8, min_lod=0.3))
        P.append(blob(f'vent_knob_{z}', 'cabin', 'alu', (0.789, -0.402, z), (0.005, 0.005, 0.009), 0.5, 0.5, nu=12, nv=6, density=1.5, min_lod=0.5))
    # Centre stack: a glossy screen and a row of brushed switches.
    P.append(blob('stack_screen', 'cabin', 'screen', (0.762, -0.548, CAR_CENTRE_Z), (0.01, 0.052, 0.098), 0.18, 0.18, R=ROT_Z(-0.12), nu=24, nv=10, density=1.0))
    for i in range(5):
        P.append(blob(f'stack_key_{i}', 'cabin', 'alu', (0.77, -0.63, CAR_CENTRE_Z + (i - 2) * 0.034), (0.008, 0.009, 0.013), 0.35, 0.35, nu=12, nv=6, density=0.8, min_lod=0.5))
    # Console between the seats with the gear selector.
    P.append(blob('console', 'cabin', 'leather', (0.12, -0.86, CAR_CENTRE_Z), (0.6, 0.14, 0.11), 0.3, 0.3, nu=28, nv=12, density=0.2))
    P.append(blob('console_top', 'cabin', 'carbon', (0.12, -0.725, CAR_CENTRE_Z), (0.5, 0.008, 0.09), 0.2, 0.2, nu=24, nv=6, density=0.3))
    P.append(sweep('gear_stem', 'cabin', 'gloss_black', lambda t: np.stack([0.22 - 0.03 * t, -0.72 + 0.1 * t, np.full_like(t, CAR_CENTRE_Z)], -1), ellipse_section(0.009, 0.009), 10, 4, up=(0, 0, 1), density=0.3))
    P.append(blob('gear_knob', 'cabin', 'leather', (0.19, -0.6, CAR_CENTRE_Z), (0.032, 0.028, 0.028), 0.7, 0.7, nu=18, nv=10, density=0.5))
    P.append(blob('gear_knob_cap', 'cabin', 'alu', (0.19, -0.575, CAR_CENTRE_Z), (0.024, 0.006, 0.022), 0.4, 0.6, nu=18, nv=6, density=0.5))
    P.append(blob('start_button', 'cabin', 'gloss_black', (0.36, -0.715, CAR_CENTRE_Z + 0.05), (0.014, 0.006, 0.014), 0.3, 1.0, nu=16, nv=6, density=0.5, min_lod=0.5))
    # Door cards.
    P += door_parts(-1) + door_parts(1)
    # A-pillars wrapped in Alcantara, bowed and wider at the dash.
    for z0, z1, out in ((-0.71, -0.74, -0.02), (1.37, 1.40, 0.02)):
        a, c, b = v3(1.15, -0.33, z0), v3(0.9, 0.07, z0 + out), v3(0.52, 0.37, z1)

        def path(t, a=a, b=b, c=c):
            t = t[..., None]
            return (1 - t) ** 2 * a + 2 * (1 - t) * t * c + t ** 2 * b

        P.append(sweep(f'pillar_{z0}', 'cabin', 'alcantara', path, superellipse_section(lambda v: 0.062 - 0.02 * v, lambda v: 0.042 - 0.01 * v, 0.7), 18, 22, up=(0, 0, 1), density=0.9))
    # Roof header (rolled lip over the windscreen), lining and visors.
    def header(u, v):
        prof = catmull([(0.60, 0.33), (0.55, 0.345), (0.525, 0.37), (0.53, 0.40), (0.50, 0.415)])(v)
        z = -0.80 + 2.26 * u
        return np.stack([prof[..., 0], prof[..., 1] - 0.01 * np.sin(math.pi * u), z], -1)
    P.append(sheet('roof_header', 'cabin', 'alcantara_light', header, 60, 8, density=0.6))
    P.append(sheet('roof', 'cabin', 'alcantara_light', lambda u, v: np.stack([0.5 - 1.4 * v, 0.415 + 0.035 * np.sin(v * math.pi) + 0.012 * np.sin(u * math.pi), -0.84 + 2.38 * u], -1), 30, 12, density=0.3))
    for z in (-0.37, 1.09):
        P.append(blob(f'visor_{z}', 'cabin', 'alcantara_light', (0.41, 0.372, z), (0.1, 0.012, 0.2), 0.3, 0.35, R=ROT_Z(0.12), nu=24, nv=8, density=0.5))
    # Seat edges: the driver's bolsters and the passenger seat beside.
    for z, s in ((-0.24, -1), (0.24, 1), (CAR_CENTRE_Z * 2 + 0.24 - 0.48, -1), (CAR_CENTRE_Z * 2 + 0.24, 1)):
        P.append(blob(f'bolster_{z}', 'cabin', 'leather', (-0.02, -0.7, z), (0.3, 0.075, 0.065), 0.6, 0.6, nu=20, nv=10, density=0.15, min_lod=0.5))
        P.append(blob(f'backrest_{z}', 'cabin', 'leather', (-0.36, -0.2, z), (0.07, 0.42, 0.07), 0.6, 0.6, R=ROT_Z(0.22), nu=20, nv=10, density=0.15, min_lod=0.5))
    # Steering column shroud, from the dash to behind the hub along the wheel's axis.
    axis = WHEEL_M[:3, :3] @ v3(1, 0, 0)
    hub = v3(*WHEEL_PIVOT)
    P.append(sweep('column', 'cabin', 'soft_plastic', lambda t: hub + (0.05 + 0.3 * t)[..., None] * axis,
                   superellipse_section(lambda v: 0.036 + 0.02 * v, lambda v: 0.04 + 0.02 * v, 0.6), 20, 6, up=(0, 0, 1), density=0.5))
    # Rear-view mirror: housing, bezel and stalk to the roof.
    P.append(blob('rv_housing', 'cabin', 'soft_plastic', (0.568, 0.235, 0.33), (0.016, 0.044, 0.13), 0.35, 0.3, nu=28, nv=12, density=1.2))
    P.append(ring('rv_bezel', 'cabin', 'gloss_black', (0.5505, 0.235, 0.33), None, (0.035, 0.119), None, (0.0025, 0.004), nu=8, nv=48, corner=0.02, density=1.2))
    P.append(sweep('rv_stalk', 'cabin', 'soft_plastic', lambda t: v3(0.585, 0.262, 0.33) + t[..., None] * v3(0.035, 0.1, 0), ellipse_section(0.009, 0.011), 10, 4, up=(0, 0, 1), density=0.5))
    P.append(blob('rv_base', 'cabin', 'soft_plastic', (0.62, 0.372, 0.33), (0.035, 0.01, 0.03), 0.4, 0.4, nu=16, nv=6, density=0.5))
    # Wing mirrors outside the side glass (left one in view), their arms and the sail panels.
    for z, side in ((-0.93, -1), (1.65, 1)):
        P.append(blob(f'wing_housing_{side}', 'cabin', 'gloss_black', (1.085, -0.2, z), (0.048, 0.066, 0.134), 0.35, 0.35, nu=28, nv=12, density=0.8))
        P.append(ring(f'wing_bezel_{side}', 'cabin', 'soft_plastic', (1.0345, -0.2, z), None, (0.052, 0.107), None, (0.003, 0.004), nu=8, nv=40, corner=0.03, density=0.8))
        wall = DASH_Z[0] if side < 0 else DASH_Z[1]
        P.append(sweep(f'wing_arm_{side}', 'cabin', 'gloss_black', lambda t, z=z, wall=wall: np.stack([1.1 + 0.0 * t, -0.25 - 0.0 * t, wall + (z - wall) * t], -1), superellipse_section(0.012, 0.02, 0.5), 10, 4, up=(1, 0, 0), density=0.5))
        P.append(blob(f'sail_{side}', 'cabin', 'soft_plastic', (1.1, -0.29, wall - side * 0.025), (0.06, 0.035, 0.012), 0.5, 0.5, nu=16, nv=8, density=0.6))
    return P


def binnacle_parts():
    """Instrument binnacle round the cluster face (src/race/cockpit.js draws the face itself):
    surround, chin, cheeks, chrome dial bezels, frames round the digital panel and shift
    lights, needle caps. Built in the cluster frame, placed with CLUSTER_M."""
    P = []
    hw, hh = FACE_W / 2 + 0.006, FACE_H / 2 + 0.006
    P.append(ring('surround', 'cabin', 'soft_plastic', (-0.004, 0, 0), None, (hh, hw), None, (0.006, 0.01), nu=10, nv=64, corner=0.02, density=1.6))
    # Chin: from the face's lower edge to the dash face; cheeks: face sides to the hood.
    def chin(u, v):
        z = (u * 2 - 1) * (hw + 0.004)
        a = apply(CLUSTER_M, np.stack([np.full_like(z, -0.006), np.full_like(z, -hh - 0.004), z], -1))
        b = np.stack([np.full_like(z, 0.809), np.full_like(z, -0.432), z * 1.12], -1)
        t = v[..., None]
        m = (1 - t) * a + t * b
        m[..., 1] -= 0.012 * np.sin(math.pi * v)
        return m
    P.append(sheet('chin', 'cabin', 'soft_plastic', chin, 40, 8, density=1.2))
    for s in (-1, 1):
        def cheek(u, v, s=s):
            # Along the face's side edge (u), outward to the hood edge (v).
            yv = (u * 2 - 1) * hh
            a = apply(CLUSTER_M, np.stack([np.full_like(yv, -0.006), yv, np.full_like(yv, s * (hw + 0.004))], -1))
            b = a.copy()
            b[..., 0] += 0.035 + 0.02 * u
            b[..., 2] = s * (HOOD_Z * 0.86)
            b[..., 1] = np.minimum(b[..., 1], -0.252)
            t = v[..., None]
            return (1 - t) * a + t * b
        P.append(sheet(f'cheek_{s}', 'cabin', 'soft_plastic', cheek, 10, 8, density=1.0))
    cl = []
    for px in (DIAL_L, DIAL_R_X):
        c = face_px(px, DIAL_Y, -0.0026)
        cl.append(ring(f'bezel_{px}', 'cabin', 'chrome', c, None, None, DIAL_R * PX + 0.0018, (0.0022, 0.0034), nu=10, nv=72, density=2.4))
        cl.append(lathe(f'cap_{px}', 'cabin', 'chrome_dark', lambda v: (-0.0058 - 0.0035 * np.cos(v * math.pi / 2) * 0 - 0.003 * np.sqrt(np.clip(1 - v ** 2, 0, 1)), 0.0075 * v), mat4(t=c), nu=20, nv=6, density=2.0))
    cl.append(ring('panel_frame', 'cabin', 'gloss_black', face_px(256, 76, -0.0022), None, (50 * PX, 44 * PX), None, (0.0016, 0.0024), nu=8, nv=48, corner=0.006, density=2.0))
    cl.append(ring('led_frame', 'cabin', 'gloss_black', face_px(256, 12.5, -0.0022), None, (12.5 * PX + 0.002, 131 * PX), None, (0.0016, 0.0024), nu=8, nv=48, corner=0.006, density=2.0))
    for p in cl:
        transform(p, CLUSTER_M)
    P += cl
    return [transform(p, CLUSTER_M) if p.name == 'surround' else p for p in P]


def trim_parts():
    """Tinted carbon accents (cabin frame): dash strip, door strips, vent bezels."""
    P = []
    face = dash_face_f(np.linspace(0, 1, 400))
    xs = np.interp(-0.475, face[::-1, 1], face[::-1, 0])
    P.append(sweep('dash_strip', 'trim', 'carbon_tint', lambda t: np.stack([np.full_like(t, xs - 0.004), np.full_like(t, -0.475), -0.80 + 2.3 * t], -1),
                   superellipse_section(0.0045, 0.011, 0.4), 10, 6, up=(1, 0, 0), closed=True))
    for side in (-1, 1):
        wall = DASH_Z[0] if side < 0 else DASH_Z[1]
        z = wall + (1 if side < 0 else -1) * 0.047
        P.append(sweep(f'door_strip_{side}', 'trim', 'carbon_tint', lambda t, z=z: np.stack([-0.5 + 1.55 * t, np.full_like(t, -0.43), np.full_like(t, z)], -1),
                       superellipse_section(0.011, 0.0045, 0.4), 10, 6, up=(0, 0, 1)))
    for z in VENTS:
        P.append(ring(f'vent_ring_{z}', 'trim', 'carbon_tint', (0.797, -0.402, z), None, (0.031, 0.053), None, (0.0045, 0.006), nu=8, nv=40, corner=0.012))
    return P


# ---------------------------------------------------------------------------------------------
# Wheel and hands (wheel frame: x along the column toward the dash, rim in the y-z plane)
# ---------------------------------------------------------------------------------------------

RIM_A, RIM_B = 0.0125, 0.0158  # rim section: in-plane and axial half-thickness
GRIP_ANG = math.atan2(math.sqrt(RIM_R ** 2 - GRIP_Y ** 2), GRIP_Y)  # from 12 o'clock


def rim_point(theta):
    """Rim centre line at angle theta (0 at 12 o'clock, + toward the driver's right), flat
    across the bottom."""
    y = RIM_R * np.cos(theta)
    z = RIM_R * np.sin(theta)
    floor = -0.142
    k = smoothstep(floor + 0.03, floor - 0.03, y)
    y = y + (np.maximum(y, floor) - y) * k
    z = z * (1 + 0.06 * k)
    return np.stack([np.zeros_like(y), y, z], -1)


def rim_thickness(theta):
    # Thumb rests swell the section just below each hand.
    g = sum(np.exp(-((theta - s * (GRIP_ANG + 0.28)) / 0.18) ** 2) for s in (-1, 1))
    return 1 + 0.16 * g


def wheel_parts():
    P = []

    def rim_path(t):
        return rim_point(t * TAU)

    def rim_sec(u, v):
        th = v * TAU
        k = rim_thickness(th)
        ang = u * TAU
        # Section in (radial, axial): N from the sweep is in-plane, B along the axis.
        return np.cos(ang) * RIM_A * k * (1 + 0.04 * np.cos(2 * ang)), np.sin(ang) * RIM_B * k

    rim = sweep('rim', 'wheel', 'leather_rim', rim_path, rim_sec, 22, 128, up=(1, 0, 0), density=2.2, stitch=(('u', 0.5),))
    P.append(rim)
    # Spokes: brushed aluminium arms at 3, 9 and 6 o'clock, a little behind the rim.
    for s in (-1, 1):
        P.append(sweep(f'spoke_{s}', 'wheel', 'alu', lambda t, s=s: np.stack([0.006 + 0 * t, -0.012 - 0.004 * t, s * (0.048 + 0.104 * t)], -1),
                       superellipse_section(lambda v: 0.019 + 0.006 * v, 0.0105, 0.45), 16, 10, up=(1, 0, 0), density=2.0))
        for i in range(2):
            P.append(blob(f'button_{s}_{i}', 'wheel', 'rubber', (-0.0075, -0.001 - i * 0.022, s * 0.088), (0.003, 0.0075, 0.0105), 0.4, 0.4, nu=14, nv=6, density=1.5, min_lod=0.5))
    P.append(sweep('spoke_low', 'wheel', 'alu', lambda t: np.stack([0.006 + 0 * t, -0.05 - 0.09 * t, 0 * t], -1),
                   superellipse_section(0.011, lambda v: 0.022 + 0.01 * v, 0.45), 16, 10, up=(0, 0, 1), density=2.0))
    # Hub: a rounded airbag pad (its poles at the rim of the disc, none facing the driver), and
    # the generic hex badge.
    P.append(blob('hub', 'wheel', 'soft_plastic', (0.002, 0, 0), (0.03, 0.058, 0.058), 1.0, 0.45, nu=40, nv=24, density=1.8))
    P.append(Part('badge', 'wheel', 'alu_polished', lambda u, v: hex_prism(u, v, 0.019, 0.003, -0.0335), 6 * 6, 10, density=3.0, closed=True, wrap_u=True))
    P.append(Part('badge_inlay', 'wheel', 'gloss_black', lambda u, v: hex_prism(u, v, 0.0125, 0.002, -0.0362), 6 * 4, 6, density=3.0, closed=True, wrap_u=True))
    # Paddle shifters behind the rim, carbon blades on short stalks.
    for s in (-1, 1):
        P.append(blob(f'paddle_{s}', 'wheel', 'carbon', (0.038, 0.012, s * 0.128), (0.0032, 0.048, 0.04), 0.35, 0.3, R=ROT_X(-s * 0.35), nu=20, nv=8, density=1.2))
        P.append(blob(f'paddle_mount_{s}', 'wheel', 'gloss_black', (0.033, 0.0, s * 0.075), (0.006, 0.012, 0.03), 0.4, 0.4, nu=12, nv=6, density=0.8))
    return P


def hex_prism(u, v, r, depth, x0):
    """A bevelled hexagonal badge facing the driver (-x): u round the edge, v from the back
    centre over the bevel to the face centre."""
    ang = u * TAU
    # Regular hexagon radius in direction ang (flat top).
    k = math.cos(math.pi / 6) / np.cos(((ang + math.pi / 6) % (math.pi / 3)) - math.pi / 6)
    bev = 0.0015
    prof_x = np.interp(v, [0, 0.2, 0.45, 0.55, 0.8, 1.0], [x0 + depth, x0 + depth, x0 + bev * 0.3, x0, x0, x0])
    prof_r = np.interp(v, [0, 0.2, 0.45, 0.55, 0.8, 1.0], [0, r, r, r - bev, (r - bev) * 0.5, 0])
    rr = prof_r * k
    return np.stack([prof_x, rr * np.cos(ang + math.pi / 2), rr * np.sin(ang + math.pi / 2)], -1)


def wheel_trim_parts():
    P = []
    # Marker stripe at 12 o'clock, a hair proud of the leather.
    def stripe_path(t):
        return rim_point((t - 0.5) * 0.22)
    P.append(sweep('rim_stripe', 'wheeltrim', 'carbon_tint', stripe_path, ellipse_section(RIM_A * 1.06, RIM_B * 1.05), 18, 10, up=(1, 0, 0)))
    for s in (-1, 1):
        P.append(blob(f'insert_{s}', 'wheeltrim', 'carbon_tint', (-0.0045, -0.015, s * 0.118), (0.0016, 0.0085, 0.024), 0.3, 0.3, nu=14, nv=6))
    P.append(blob('insert_low', 'wheeltrim', 'carbon_tint', (-0.0055, -0.11, 0), (0.0016, 0.024, 0.0085), 0.3, 0.3, nu=14, nv=6))
    return P


def hand_parts(side):
    """A gloved hand wrapped round the rim at ten to two: fingers curled over the far side of
    the rim with the tips showing inside it, the thumb over the near face, knuckle pad and
    seams on the back, a flared gauntlet cuff that meets the sleeve."""
    th = side * GRIP_ANG
    C = rim_point(np.array(th))
    n = norm(v3(0, math.cos(th), math.sin(th)))          # outward, in the rim's plane
    ax = v3(1, 0, 0)                                       # away from the driver
    t = norm(np.cross(ax, n)) * -side                      # along the rim toward 12 o'clock
    if t[1] < 0:
        t = -t
    k = rim_thickness(np.array(th))
    ra, rb = RIM_A * k, RIM_B * k
    parts = []
    fingers = [(0.0255, 0.0094, 205), (0.0085, 0.0101, 212), (-0.0085, 0.0097, 205), (-0.0245, 0.0086, 192)]
    for i, (off, fr, end) in enumerate(fingers):
        a0, a1 = math.radians(-32), math.radians(end)

        def path(s, off=off, fr=fr, a0=a0, a1=a1):
            phi = a0 + (a1 - a0) * s
            ga = ra + fr + 0.0012
            gb = rb + fr + 0.0012
            pos = C + np.cos(phi)[..., None] * ga * n + np.sin(phi)[..., None] * gb * ax + off * t
            # The base of each finger rises into the back of the hand.
            pos = pos + (smoothstep(0.18, 0.0, s) * 0.006)[..., None] * (n * 0.8 - ax * 0.6)
            return pos

        def radius(v, fr=fr):
            joints = sum(np.exp(-((v - j) / 0.05) ** 2) for j in (0.12, 0.47, 0.75))
            tip = np.sqrt(np.clip((1.0 - v) / 0.09, 0, 1))
            return fr * (1 + 0.08 * joints) * (0.82 + 0.18 * tip) * np.where(v > 0.91, tip, 1)

        def sec(u, v, radius=radius):
            r = radius(v)
            ang = u * TAU
            return np.cos(ang) * r, np.sin(ang) * r * 0.92

        parts.append(sweep(f'finger_{side}_{i}', 'hands', 'glove', path, sec, 14, 22, up=t, density=2.2, stitch=(('u', 0.25),)))
    # Back of the hand: from the knuckles to the gauntlet, wide across the fingers.
    knuckle = C + math.cos(-0.5) * (ra + 0.016) * n + math.sin(-0.5) * (rb + 0.016) * ax
    wrist = v3(-0.12, GRIP_Y - 0.05, side * (math.sqrt(RIM_R ** 2 - GRIP_Y ** 2) + 0.042))
    mid = knuckle + 0.62 * (wrist - knuckle)
    back_dir = norm(wrist - knuckle)
    width_axis = norm(t - np.dot(t, back_dir) * back_dir)
    up_axis = norm(np.cross(back_dir, width_axis))
    if np.dot(up_axis, -ax + n * 0.3) < 0:
        up_axis = -up_axis

    def back_fn(u, v):
        s = v
        pos = knuckle - 0.012 * back_dir + (s * (np.linalg.norm(mid - knuckle) + 0.012))[..., None] * back_dir
        ang = u * TAU
        w = 0.041 - 0.009 * s
        h = 0.0135 + 0.006 * s
        cw = spow(np.cos(ang), 0.55) * w
        sh = spow(np.sin(ang), 0.7) * h
        # Knuckle ridges on the top near the fingers.
        bumps = sum(np.exp(-((cw - off) / 0.0075) ** 2) for off, _, _ in fingers)
        sh = sh + np.where(np.sin(ang) > 0, 0.0028 * bumps * smoothstep(0.35, 0.05, s) * np.sin(ang) ** 2, 0)
        return pos[..., :] + cw[..., None] * width_axis + sh[..., None] * up_axis

    parts.append(Part(f'hand_back_{side}', 'hands', 'glove', back_fn, 36, 14, density=2.0, closed=True, wrap_u=True, stitch=(('v', 0.55),)))
    # Knuckle guard pad (perforated suede with a stitched edge).
    pad_c = knuckle + 0.026 * back_dir + 0.0125 * up_axis
    R = np.stack([back_dir, up_axis, width_axis], axis=1)
    parts.append(blob(f'knuckle_pad_{side}', 'hands', 'glove_pad', pad_c, (0.016, 0.0045, 0.032), 0.45, 0.4, R=R, nu=24, nv=8, density=2.2))
    # Thumb over the near face of the rim.
    def thumb_path(s):
        a = np.interp(s, [0, 0.4, 1], [-0.6, -1.55, -2.3])
        r_off = np.interp(s, [0, 0.4, 1], [0.012, 0.004, 0.002])
        o = np.interp(s, [0, 0.5, 1], [0.028, 0.034, 0.022])
        return C + np.cos(a)[..., None] * (ra + 0.011 + r_off)[..., None] * n + np.sin(a)[..., None] * (rb + 0.011 + r_off)[..., None] * ax + o[..., None] * t

    def thumb_sec(u, v):
        tip = np.sqrt(np.clip((1.0 - v) / 0.12, 0, 1))
        r = 0.0108 * (1 - 0.15 * v) * np.where(v > 0.88, tip, 1)
        ang = u * TAU
        return np.cos(ang) * r, np.sin(ang) * r * 0.85

    parts.append(sweep(f'thumb_{side}', 'hands', 'glove', thumb_path, thumb_sec, 14, 16, up=t, density=2.0))
    # Gauntlet: flared cuff over the sleeve, with a strap.
    g0 = mid - 0.012 * back_dir
    g1 = wrist + 0.012 * back_dir

    def gauntlet(s):
        return g0 + s[..., None] * (g1 - g0)

    parts.append(sweep(f'gauntlet_{side}', 'hands', 'glove', gauntlet,
                       superellipse_section(lambda v: 0.036 + 0.006 * v, lambda v: 0.029 + 0.01 * v, 0.8), 28, 8, up=up_axis, density=1.4, stitch=(('v', 0.7),)))
    parts.append(sweep(f'strap_{side}', 'hands', 'glove_pad', lambda s: g0 + (0.45 + 0.18 * s)[..., None] * (g1 - g0),
                       superellipse_section(lambda v: 0.0405, lambda v: 0.0345, 0.8), 28, 3, up=up_axis, density=1.4))
    return parts, wrist


FOREARM_REST = []


def forearm_part(side):
    """Racing-suit sleeve from the elbow (origin) along +y to the wrist, in metres at its rest
    length; exported at unit length (the game stretches it to the turned glove)."""
    i = 0 if side < 0 else 1
    elbow = v3(*ELBOWS[i])
    wrist_rest = apply(WHEEL_M, hand_wrist(side)[None])[0]
    L = float(np.linalg.norm(wrist_rest - elbow))
    FOREARM_REST.append(L)

    def fn(u, v):
        y = v * L
        ang = u * TAU
        r = 0.05 - 0.012 * v + 0.004 * smoothstep(0.86, 0.9, v) - 0.006 * smoothstep(0.9, 1.0, v)
        wr = 1 + 0.035 * np.sin(v * 31 + np.cos(ang * 2) * 1.3) * smoothstep(0.85, 0.3, v) * (0.6 + 0.4 * np.cos(ang - 1))
        r = r * wr
        return np.stack([np.cos(ang) * r, y, np.sin(ang) * r * 0.9], -1)

    return Part(f'forearm_{side}', 'forearm_l' if side < 0 else 'forearm_r', 'fabric', fn, 24, 24, density=1.0, closed=True, wrap_u=True), L


def hand_wrist(side):
    return v3(-0.12, GRIP_Y - 0.05, side * (math.sqrt(RIM_R ** 2 - GRIP_Y ** 2) + 0.042))


def needle_part():
    # Tapered blade, counterweight tail, pivot at the origin, pointing +y, facing -x.
    def fn(u, v):
        y = -0.014 + 0.072 * v
        w = np.interp(v, [0, 0.12, 0.2, 0.3, 1.0], [0.0025, 0.0042, 0.0026, 0.0024, 0.0008])
        ang = u * TAU
        return np.stack([np.sin(ang) * 0.0011, y, spow(np.cos(ang), 0.5) * w], -1)
    return Part('needle', 'needle', 'needle', fn, 8, 16, closed=True, wrap_u=True)


def mirror_glass_parts():
    """Glass quads facing the driver; uv.x reads the rearward camera's image right to left (the
    rear-view shows all of it, the left wing mirror its right part, the right one its left)."""
    def quad(c, w, h, u0, u1, x):
        def fn(u, v):
            z = c[2] + (u - 0.5) * w
            y = c[1] + (v - 0.5) * h
            # Rounded corners: pull the corner rows in a little.
            return np.stack([np.full_like(z, x), y, z], -1)
        p = Part(f'glass_{c[2]}', 'mirror', 'glass', fn, 1, 1, closed=False)
        p.extra['u'] = (u0, u1)
        return p
    return [quad((0, 0.235, 0.33), 0.235, 0.068, 1.0, 0.0, 0.548),
            quad((0, -0.2, -0.93), 0.21, 0.1, 1.0, 0.62, 1.033),
            quad((0, -0.2, 1.65), 0.21, 0.1, 0.38, 0.0, 1.033)]


# ---------------------------------------------------------------------------------------------
# Mesh assembly: normals, orientation, uv atlas
# ---------------------------------------------------------------------------------------------

def tri_normals(V, F):
    t1 = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    t2 = np.cross(V[F[:, 2]] - V[F[:, 0]], V[F[:, 3]] - V[F[:, 0]])
    return t1 + t2


def vertex_normals(V, F):
    """Area-weighted normals, shared by every vertex at one position (seams of the param grid
    and the poles of the rounded shapes stay smooth)."""
    key = np.round(V / 1e-6).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    fn = tri_normals(V, F)
    acc = np.zeros((inv.max() + 1, 3))
    for k in range(4):
        np.add.at(acc, inv[F[:, k]], fn)
    N = acc[inv]
    return norm(N)


def orient(part, V, F):
    """Faces outward (closed shapes) or toward the driver's eye (sheets)."""
    fn = tri_normals(V, F)
    cen = V[F].mean(axis=1)
    if part.closed:
        vol = np.sum(np.einsum('ij,ij->i', cen - cen.mean(0), fn))
        flip = vol < 0
    else:
        eye = np.zeros(3)
        flip = np.sum(np.einsum('ij,ij->i', eye - cen, fn)) < 0
    if flip:
        F = F[:, ::-1]
    return F


def pack_islands(parts, margin_px, size):
    """Shelf-packs one island per part (its size in metres times its density weight) into the
    unit square. Returns {name: (u0, v0, su, sv, rotated)}."""
    items = []
    for p in parts:
        w, h = p.Lu * p.density, p.Lv * p.density
        rot = h > w * 1.15
        if rot:
            w, h = h, w
        items.append((p.name, w, h, rot))
    items.sort(key=lambda it: -it[2])
    total = sum(w * h for _, w, h, _ in items)
    S = math.sqrt(total / 0.72)
    for _ in range(200):
        pad = margin_px / size * S
        x = y = shelf = 0.0
        out = {}
        ok = True
        for name, w, h, rot in items:
            if x + w + pad > S:
                x = 0.0
                y += shelf + pad
                shelf = 0.0
            if y + h + pad > S:
                ok = False
                break
            out[name] = (x + pad, y + pad, w, h, rot)
            x += w + pad
            shelf = max(shelf, h)
        if ok:
            return {k: (a / S, b / S, c / S, d / S, r) for k, (a, b, c, d, r) in out.items()}
        S *= 1.03
    raise RuntimeError('atlas packing failed')


def assemble(parts, lod, layout=None, uv_mode='atlas'):
    """Joins parts into one mesh: vertices (cockpit frame), quads, atlas uv, param uv (0..1),
    metric uv (metres), per-face material index, the list of materials."""
    Vs, Fs, UVa, UVp, UVm, mats, mat_ids = [], [], [], [], [], [], []
    off = 0
    for p in parts:
        if lod < p.min_lod:
            continue
        V, F, UV = p.build(lod)
        F = orient(p, V, F)
        Vs.append(V)
        Fs.append(F + off)
        UVp.append(UV)
        UVm.append(UV * [p.Lu, p.Lv])
        if uv_mode == 'atlas' and layout is not None:
            u0, v0, su, sv, rot = layout[p.name]
            uu, vv = (UV[:, 1], UV[:, 0]) if rot else (UV[:, 0], UV[:, 1])
            UVa.append(np.stack([u0 + uu * su, v0 + vv * sv], -1))
        elif uv_mode == 'tile':
            UVa.append(UV * [p.Lu, p.Lv] / 0.036)  # carbon tile: 12 tows of 3 mm
        elif uv_mode == 'mirror':
            u0, u1 = p.extra['u']
            UVa.append(np.stack([u0 + (u1 - u0) * UV[:, 0], UV[:, 1]], -1))
        else:
            UVa.append(UV.copy())
        key = (p.mat, p.stitch, round(p.Lu, 4), round(p.Lv, 4)) if p.stitch else (p.mat,)
        if key not in mats:
            mats.append(key)
        mat_ids.append(np.full(len(F), mats.index(key)))
        off += len(V)
    V = np.vstack(Vs)
    F = np.vstack(Fs)
    return dict(V=V, F=F, UV=np.vstack(UVa), UVp=np.vstack(UVp), UVm=np.vstack(UVm), mats=mats, mat_ids=np.concatenate(mat_ids))


# ---------------------------------------------------------------------------------------------
# Blender objects
# ---------------------------------------------------------------------------------------------

B3 = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)  # cockpit -> Blender


def to_blender_matrix(M):
    B4 = np.eye(4)
    B4[:3, :3] = B3
    return Matrix((B4 @ M @ B4.T).tolist())


def make_object(name, mesh, M=np.eye(4), normals_scale=None):
    V = mesh['V'] @ B3.T
    F = mesh['F']
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], F.tolist())
    me.update()
    for layer, key in (('atlas', 'UV'), ('param', 'UVp'), ('metric', 'UVm')):
        uv = me.uv_layers.new(name=layer)
        loops = np.zeros(len(me.loops) * 2)
        idx = np.zeros(len(me.loops), dtype=np.int64)
        me.loops.foreach_get('vertex_index', idx)
        loops = mesh[key][idx].ravel()
        uv.data.foreach_set('uv', loops)
    me.uv_layers['atlas'].active = True
    me.uv_layers['atlas'].active_render = True
    me.polygons.foreach_set('material_index', mesh['mat_ids'].astype(np.int32))
    me.shade_smooth()
    N = vertex_normals(mesh['V'], F)
    if normals_scale is not None:
        N = norm(N * normals_scale)
    me.normals_split_custom_set_from_vertices((N @ B3.T).tolist())
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = to_blender_matrix(M)
    return ob


# ---------------------------------------------------------------------------------------------
# Bake materials (procedural, baked into the atlases)
# ---------------------------------------------------------------------------------------------

LIN = {
    'black_leather': (0.020, 0.019, 0.019),
    'glove': (0.024, 0.025, 0.028),
    'glove_pad': (0.06, 0.062, 0.068),
    'plastic': (0.026, 0.027, 0.03),
    'hard_plastic': (0.018, 0.018, 0.02),
    'alcantara': (0.034, 0.034, 0.037),
    'alcantara_light': (0.105, 0.104, 0.104),
    'thread': (0.33, 0.33, 0.34),
    'alu': (0.62, 0.63, 0.65),
    'chrome': (0.8, 0.8, 0.82),
    'chrome_dark': (0.25, 0.25, 0.27),
    'rubber': (0.016, 0.016, 0.017),
    'fabric': (0.032, 0.036, 0.046),
    'vent': (0.006, 0.006, 0.007),
}


class NodeKit:
    def __init__(self, mat):
        self.nt = mat.node_tree
        self.n = self.nt.nodes
        self.l = self.nt.links

    def node(self, kind, **props):
        nd = self.n.new(kind)
        for k, v in props.items():
            setattr(nd, k, v)
        return nd

    def link(self, a, b):
        self.l.new(a, b)

    def feed(self, sock, val):
        if isinstance(val, (int, float)):
            sock.default_value = val
        elif isinstance(val, tuple):
            sock.default_value = val if len(sock.default_value) == len(val) else (*val, 1.0)
        else:
            self.l.new(val, sock)

    def math(self, op, a, b=0.0, clamp=False):
        nd = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.feed(nd.inputs[0], a)
        self.feed(nd.inputs[1], b)
        return nd.outputs[0]

    def mix(self, fac, a, b):
        nd = self.node('ShaderNodeMix', data_type='RGBA')
        self.feed(nd.inputs['Factor'], fac)
        self.feed(nd.inputs[6], a)
        self.feed(nd.inputs[7], b)
        return nd.outputs[2]

    def mixf(self, fac, a, b):
        nd = self.node('ShaderNodeMix', data_type='FLOAT')
        self.feed(nd.inputs['Factor'], fac)
        self.feed(nd.inputs[2], a)
        self.feed(nd.inputs[3], b)
        return nd.outputs[0]

    def uv(self, name):
        nd = self.node('ShaderNodeUVMap', uv_map=name)
        sep = self.node('ShaderNodeSeparateXYZ')
        self.link(nd.outputs['UV'], sep.inputs[0])
        return sep.outputs[0], sep.outputs[1]

    def obj(self, scale=1.0):
        tc = self.node('ShaderNodeTexCoord')
        vm = self.node('ShaderNodeVectorMath', operation='SCALE')
        self.link(tc.outputs['Object'], vm.inputs[0])
        vm.inputs['Scale'].default_value = scale
        return vm.outputs[0]

    def noise(self, vec, scale, detail=2.0, rough=0.5):
        nd = self.node('ShaderNodeTexNoise')
        self.link(vec, nd.inputs['Vector'])
        nd.inputs['Scale'].default_value = scale
        nd.inputs['Detail'].default_value = detail
        nd.inputs['Roughness'].default_value = rough
        return nd.outputs['Fac']

    def voronoi_edge(self, vec, scale):
        nd = self.node('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE')
        self.link(vec, nd.inputs['Vector'])
        nd.inputs['Scale'].default_value = scale
        return nd.outputs['Distance']

    def combine(self, x, y, z=0.0):
        nd = self.node('ShaderNodeCombineXYZ')
        self.feed(nd.inputs[0], x)
        self.feed(nd.inputs[1], y)
        self.feed(nd.inputs[2], z)
        return nd.outputs[0]

    def smooth(self, e0, e1, x):
        nd = self.node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        self.feed(nd.inputs['Value'], x)
        nd.inputs['From Min'].default_value = e0
        nd.inputs['From Max'].default_value = e1
        return nd.outputs['Result']


def stitch_mask(k, axis, pos_m, along_period=0.0052, rows=(-0.0032, 0.0032)):
    """Height and colour mask for a stitched seam at metric distance pos_m along `axis` of the
    metric uv: a groove on the seam and two rows of stitches either side."""
    um, vm = k.uv('metric')
    across, along = (vm, um) if axis == 'v' else (um, vm)
    d = k.math('ABSOLUTE', k.math('SUBTRACT', across, pos_m))
    groove = k.smooth(0.0016, 0.0, d)
    dash = k.math('FRACT', k.math('DIVIDE', along, along_period))
    dash = k.math('MULTIPLY', k.smooth(0.08, 0.2, dash), k.smooth(0.78, 0.66, dash))
    st = 0.0
    for r in rows:
        row = k.smooth(0.0011, 0.0003, k.math('ABSOLUTE', k.math('SUBTRACT', d, abs(r))))
        st = row if st == 0.0 else k.math('MAXIMUM', st, row)
    st = k.math('MULTIPLY', st, dash)
    return groove, st


MATS = {}


def bake_material(key, group):
    """One material per (kind, stitches, part size, atlas). Builds the shading the bakes read:
    colour, roughness, metalness and a bump-mapped normal."""
    name = f'{group}:{"/".join(map(str, key))}'
    if name in MATS:
        return MATS[name]
    kind = key[0]
    stitches = key[1] if len(key) > 1 else ()
    Lu, Lv = (key[2], key[3]) if len(key) > 3 else (1, 1)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    k = NodeKit(mat)
    for nd in list(k.n):
        k.n.remove(nd)
    out = k.node('ShaderNodeOutputMaterial')
    bsdf = k.node('ShaderNodeBsdfPrincipled')
    col, rough, metal, height = None, 0.5, 0.0, 0.0
    hscale = 1.0
    P = k.obj()

    if kind in ('leather', 'leather_rim', 'glove'):
        base = LIN['glove'] if kind == 'glove' else LIN['black_leather']
        scale = 1300 if kind == 'glove' else 800
        cells = k.voronoi_edge(P, scale)
        h = k.smooth(0.0, 0.12, cells)
        fine = k.noise(P, scale * 3, 3)
        height = k.math('ADD', k.math('MULTIPLY', h, 0.7), k.math('MULTIPLY', fine, 0.3))
        shade = k.math('ADD', 0.82, k.math('MULTIPLY', h, 0.25))
        col = k.mix(shade, (0, 0, 0, 1), (*[c * 1.15 for c in base], 1))
        rough = k.math('ADD', 0.42 if kind != 'glove' else 0.5, k.math('MULTIPLY', k.math('SUBTRACT', 1.0, h), 0.18))
        hscale = 0.1
    elif kind in ('alcantara', 'alcantara_light', 'glove_pad'):
        base = LIN['glove_pad' if kind == 'glove_pad' else kind]
        nap = k.noise(P, 6.0, 2)
        fibre = k.noise(P, 2600, 2, 0.6)
        col = k.mix(k.math('ADD', 0.85, k.math('MULTIPLY', nap, 0.3)), (0, 0, 0, 1), (*base, 1))
        rough = 0.93
        height = fibre
        hscale = 0.12
        if kind == 'glove_pad':
            # Perforations.
            um, vm = k.uv('metric')
            fu = k.math('SUBTRACT', k.math('FRACT', k.math('DIVIDE', um, 0.0028)), 0.5)
            fv = k.math('SUBTRACT', k.math('FRACT', k.math('DIVIDE', vm, 0.0028)), 0.5)
            dd = k.math('SQRT', k.math('ADD', k.math('MULTIPLY', fu, fu), k.math('MULTIPLY', fv, fv)))
            hole = k.smooth(0.2, 0.12, dd)
            height = k.math('SUBTRACT', height, hole)
            col = k.mix(hole, col, (0.005, 0.005, 0.005, 1))
            hscale = 0.2
    elif kind in ('soft_plastic', 'hard_plastic'):
        base = LIN['plastic' if kind == 'soft_plastic' else 'hard_plastic']
        g = k.noise(P, 1500 if kind == 'soft_plastic' else 700, 3, 0.65)
        col = (*base, 1)
        rough = k.math('ADD', 0.6 if kind == 'soft_plastic' else 0.5, k.math('MULTIPLY', g, 0.12))
        height = g
        hscale = 0.12
    elif kind == 'gloss_black':
        col = (0.008, 0.008, 0.009, 1)
        rough = 0.14
    elif kind == 'screen':
        col = (0.004, 0.0045, 0.006, 1)
        rough = 0.06
    elif kind == 'vent':
        col = (*LIN['vent'], 1)
        rough = 0.7
    elif kind in ('alu', 'alu_polished'):
        um, vm = k.uv('metric')
        streak = k.noise(k.combine(k.math('MULTIPLY', um, 8.0), k.math('MULTIPLY', vm, 2600.0)), 1.0, 4, 0.6)
        col = k.mix(streak, (*[c * 0.88 for c in LIN['alu']], 1), (*LIN['alu'], 1))
        rough = k.math('ADD', 0.2 if kind == 'alu' else 0.1, k.math('MULTIPLY', streak, 0.12))
        metal = 1.0
        height = streak
        hscale = 0.05
    elif kind in ('chrome', 'chrome_dark'):
        col = (*LIN[kind], 1)
        rough = 0.1 if kind == 'chrome' else 0.22
        metal = 1.0
    elif kind == 'rubber':
        g = k.noise(P, 1800, 2)
        col = (*LIN['rubber'], 1)
        rough = 0.82
        height = g
        hscale = 0.1
    elif kind == 'carbon':
        um, vm = k.uv('metric')
        X = k.math('DIVIDE', um, 0.003)
        Y = k.math('DIVIDE', vm, 0.003)
        par = k.math('MODULO', k.math('ADD', k.math('FLOOR', X), k.math('FLOOR', Y)), 2.0)
        wx = k.math('SINE', k.math('MULTIPLY', k.math('FRACT', X), math.pi))
        wy = k.math('SINE', k.math('MULTIPLY', k.math('FRACT', Y), math.pi))
        tow = k.mixf(par, wy, wx)
        col = k.mix(tow, (0.008, 0.008, 0.009, 1), (0.06, 0.062, 0.068, 1))
        rough = 0.22
        height = tow
        hscale = 0.05
    elif kind == 'fabric':
        um, vm = k.uv('metric')
        w1 = k.math('SINE', k.math('MULTIPLY', um, TAU / 0.0016))
        w2 = k.math('SINE', k.math('MULTIPLY', vm, TAU / 0.0016))
        weave = k.math('MULTIPLY', k.math('ADD', k.math('MULTIPLY', w1, w2), 1.0), 0.5)
        nap = k.noise(P, 40, 3)
        col = k.mix(k.math('ADD', 0.8, k.math('MULTIPLY', nap, 0.4)), (0, 0, 0, 1), (*LIN['fabric'], 1))
        rough = 0.9
        height = weave
        hscale = 0.15
    elif kind == 'grille':
        um, vm = k.uv('metric')
        slot = k.smooth(0.35, 0.45, k.math('ABSOLUTE', k.math('SUBTRACT', k.math('FRACT', k.math('DIVIDE', um, 0.008)), 0.5)))
        col = k.mix(slot, (0.002, 0.002, 0.002, 1), (*LIN['plastic'], 1))
        rough = 0.6
        height = slot
        hscale = 0.6
    elif kind == 'grille_dots':
        um, vm = k.uv('metric')
        fu = k.math('SUBTRACT', k.math('FRACT', k.math('DIVIDE', um, 0.0035)), 0.5)
        fv = k.math('SUBTRACT', k.math('FRACT', k.math('DIVIDE', vm, 0.0035)), 0.5)
        dd = k.math('SQRT', k.math('ADD', k.math('MULTIPLY', fu, fu), k.math('MULTIPLY', fv, fv)))
        hole = k.smooth(0.3, 0.22, dd)
        col = k.mix(hole, (*LIN['plastic'], 1), (0.002, 0.002, 0.002, 1))
        rough = 0.55
        height = k.math('SUBTRACT', 1.0, hole)
        hscale = 0.5
    else:
        col = (0.5, 0.5, 0.5, 1)

    # Stitched seams: groove in the surface, thread colour and height on the stitches.
    for axis, pos in stitches:
        L = Lv if axis == 'v' else Lu
        groove, st = stitch_mask(k, axis, pos * L)
        height = k.math('SUBTRACT', k.math('ADD', height if not isinstance(height, float) else height, k.math('MULTIPLY', st, 2.5)), k.math('MULTIPLY', groove, 2.0))
        col = k.mix(st, col, (*LIN['thread'], 1))
        rough = k.mixf(st, rough, 0.7)
        hscale = max(hscale, 0.25)

    k.feed(bsdf.inputs['Base Color'], col)
    k.feed(bsdf.inputs['Roughness'], rough)
    k.feed(bsdf.inputs['Metallic'], metal)
    bump = k.node('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 1.0
    bump.inputs['Distance'].default_value = 0.0006 * hscale
    k.feed(bump.inputs['Height'], height)
    k.link(bump.outputs['Normal'], bsdf.inputs['Normal'])
    k.link(bsdf.outputs['BSDF'], out.inputs['Surface'])
    # Bake plumbing: an emission node for colour/roughness/metal passes, a white diffuse for the
    # light pass, the target image.
    emit = k.node('ShaderNodeEmission')
    white = k.node('ShaderNodeBsdfDiffuse')
    white.inputs['Color'].default_value = (0.8, 0.8, 0.8, 1)
    img = k.node('ShaderNodeTexImage')
    img.name = 'BakeTarget'
    k.n.active = img
    MATS[name] = dict(mat=mat, kit=k, out=out, bsdf=bsdf, emit=emit, white=white, img=img,
                      col=col, rough=rough, metal=metal)
    return MATS[name]


def set_mode(m, mode):
    """Routes a material to the output a bake pass reads."""
    k = m['kit']
    surf = m['out'].inputs['Surface']
    for ln in list(surf.links):
        k.l.remove(ln)
    for ln in list(m['emit'].inputs['Color'].links):
        k.l.remove(ln)
    if mode == 'shade':
        k.link(m['bsdf'].outputs['BSDF'], surf)
    elif mode == 'light':
        k.link(m['white'].outputs['BSDF'], surf)
    else:
        src = m[mode]
        if isinstance(src, (int, float)):
            m['emit'].inputs['Color'].default_value = (src, src, src, 1)
        elif isinstance(src, tuple):
            m['emit'].inputs['Color'].default_value = src
        else:
            k.link(src, m['emit'].inputs['Color'])
        k.link(m['emit'].outputs['Emission'], surf)


# ---------------------------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------------------------

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    world = bpy.data.worlds.new('sky')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background') or world.node_tree.nodes.new('ShaderNodeBackground')
    bg.inputs['Color'].default_value = (0.55, 0.66, 0.85, 1)
    bg.inputs['Strength'].default_value = 1.15
    return sc


def add_occluders():
    """The car body round the cabin for the light bake (not exported): floor, firewall, door
    skins below the glass, B-pillars, rear bulkhead and roof skin. The windscreen and side
    windows stay open, so the light comes in where it would in a real car."""
    planes = [
        ((0.0, -1.42, 0.35), (1.8, 0.0, 1.4)),
        ((1.24, -0.85, 0.35), (0.0, 0.55, 1.4)),
        ((-0.2, -0.86, -0.9), (1.5, 0.55, 0.0)),
        ((-0.2, -0.86, 1.6), (1.5, 0.55, 0.0)),
        ((-1.05, -0.6, 0.35), (0.0, 0.8, 1.4)),
        ((-0.6, 0.47, 0.35), (1.2, 0.0, 1.4)),
        ((-0.72, 0.07, -0.88), (0.12, 0.4, 0.0)),
        ((-0.72, 0.07, 1.58), (0.12, 0.4, 0.0)),
    ]
    for i, (c, h) in enumerate(planes):
        c = np.array(c)
        h = np.array(h)
        axes = [a for a in range(3) if h[a] > 0]
        a, b = axes
        corners = []
        for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            p = c.copy()
            p[a] += sa * h[a]
            p[b] += sb * h[b]
            corners.append(p)
        me = bpy.data.meshes.new(f'occ{i}')
        me.from_pydata((np.array(corners) @ B3.T).tolist(), [], [(0, 1, 2, 3)])
        ob = bpy.data.objects.new(f'occ{i}', me)
        bpy.context.scene.collection.objects.link(ob)
        mat = bpy.data.materials.new(f'occ{i}')
        mat.use_nodes = True
        mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.03, 0.03, 0.03, 1)
        me.materials.append(mat)
    # Sun ahead and above, a little to the left.
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 2.2
    sun.angle = math.radians(12)
    ob = bpy.data.objects.new('sun', sun)
    bpy.context.scene.collection.objects.link(ob)
    d = norm(v3(-0.45, -1.0, 0.2)) @ B3.T
    ob.rotation_euler = Vector((-d).tolist()).to_track_quat('Z', 'Y').to_euler()


# Detail levels (segment-count scale) of the two exported meshes.
LOD_HIGH = 0.84
LOD_LOW = 0.36

GROUPS = ('cabin', 'trim', 'wheel', 'wheeltrim', 'hands', 'forearm_l', 'forearm_r', 'needle', 'mirror')
EXPORT_NAMES = {
    'cabin': 'cockpit_shell', 'trim': 'cockpit_trim', 'wheel': 'cockpit_wheel', 'wheeltrim': 'cockpit_wheel_trim',
    'hands': 'cockpit_hands', 'forearm_l': 'cockpit_forearm_l', 'forearm_r': 'cockpit_forearm_r',
    'needle': 'cockpit_needle', 'mirror': 'cockpit_mirror_glass',
}
ATLAS_OF = {'cabin': 'cabin', 'wheel': 'wheel', 'hands': 'wheel', 'forearm_l': 'wheel', 'forearm_r': 'wheel'}


def all_parts():
    parts = cabin_parts() + trim_parts() + wheel_parts() + wheel_trim_parts()
    for s in (-1, 1):
        hp, _ = hand_parts(s)
        parts += hp
    fl, Ll = forearm_part(-1)
    fr, Lr = forearm_part(1)
    parts += [fl, fr, needle_part()] + mirror_glass_parts()
    return parts, (Ll, Lr)


def frames(lengths):
    """Bake-time placement of each runtime mesh (its local frame -> cabin)."""
    M = {g: np.eye(4) for g in GROUPS}
    M['wheel'] = M['wheeltrim'] = M['hands'] = WHEEL_M
    for i, side in enumerate((-1, 1)):
        elbow = v3(*ELBOWS[i])
        wrist = apply(WHEEL_M, hand_wrist(side)[None])[0]
        d = norm(wrist - elbow)
        axis = np.cross(v3(0, 1, 0), d)
        ang = math.acos(np.clip(d[1], -1, 1))
        R = rot_axis(axis, ang) if np.linalg.norm(axis) > 1e-9 else np.eye(3)
        M['forearm_l' if side < 0 else 'forearm_r'] = mat4(R, elbow)
    M['needle'] = CLUSTER_M @ mat4(t=face_px(DIAL_L, DIAL_Y, -0.004))
    return M


def build_lod(parts, lod, layouts, lengths, place=True):
    objs = {}
    Mf = frames(lengths)
    for g in GROUPS:
        ps = [p for p in parts if p.group == g]
        atlas = ATLAS_OF.get(g)
        mode = 'atlas' if atlas else ('tile' if g in ('trim', 'wheeltrim') else ('mirror' if g == 'mirror' else 'none'))
        mesh = assemble(ps, lod, layouts.get(atlas), mode)
        name = EXPORT_NAMES[g]
        ns = None
        if g.startswith('forearm'):
            L = lengths[0 if g.endswith('_l') else 1]
            mesh['V'] = mesh['V'] / [1, L, 1]
            ns = np.array([1, L, 1.0])
        ob = make_object(name, mesh, Mf[g] if place else np.eye(4), ns)
        if g.startswith('forearm') and place:
            L = lengths[0 if g.endswith('_l') else 1]
            ob.matrix_world = to_blender_matrix(Mf[g] @ mat4(s=(1, L, 1)))
        ob['group'] = g
        ob['atlas'] = atlas or ''
        for key in mesh['mats']:
            m = bake_material(key, atlas or g)
            ob.data.materials.append(m['mat'])
        objs[g] = ob
    return objs


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ---------------------------------------------------------------------------------------------
# Baking
# ---------------------------------------------------------------------------------------------

def bake_atlas(atlas, objs, size, samples):
    sc = bpy.context.scene
    targets = [o for o in objs.values() if o['atlas'] == atlas]
    imgs = {}
    passes = [('col', 'EMIT', 1), ('rough', 'EMIT', 1), ('metal', 'EMIT', 1), ('normal', 'NORMAL', 4),
              ('ao', 'AO', samples), ('light', 'DIFFUSE', samples)]
    for pname, btype, spp in passes:
        t0 = time.time()
        img = bpy.data.images.new(f'{atlas}_{pname}', size, size, alpha=False, float_buffer=True)
        img.colorspace_settings.name = 'Non-Color'
        for o in targets:
            for slot in o.material_slots:
                m = MATS[slot.material.name]
                m['img'].image = img
                m['kit'].n.active = m['img']
                set_mode(m, 'light' if pname == 'light' else ('shade' if btype in ('NORMAL', 'AO') else pname))
        bpy.ops.object.select_all(action='DESELECT')
        for o in targets:
            o.select_set(True)
        bpy.context.view_layer.objects.active = targets[0]
        sc.cycles.samples = spp
        sc.render.bake.margin = max(4, size // 128)
        sc.render.bake.margin_type = 'EXTEND'
        sc.render.bake.use_clear = True
        sc.render.bake.normal_space = 'TANGENT'
        sc.world.light_settings.distance = 0.22
        kw = dict(type=btype, margin=sc.render.bake.margin, use_clear=True)
        if btype == 'DIFFUSE':
            kw['pass_filter'] = {'DIRECT', 'INDIRECT'}
        bpy.ops.object.bake(**kw)
        px = np.empty(size * size * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        imgs[pname] = px.reshape(size, size, 4)[::-1, :, :3].copy()  # top row first
        print(f'  bake {atlas}/{pname}: {time.time() - t0:.1f} s', flush=True)
    for o in targets:
        for slot in o.material_slots:
            set_mode(MATS[slot.material.name], 'shade')
    return imgs


def to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def save_png(path, arr):
    from PIL import Image
    a = np.clip(arr, 0, 1)
    Image.fromarray((a * 65535 + 0.5).astype(np.uint16) if False else (a * 255 + 0.5).astype(np.uint8)).save(path)


def compose(atlas, imgs):
    """Turns the bake passes into the shipped maps:
        <atlas>_albedo.png  base colour (sRGB)
        <atlas>_normal.png  tangent-space normal (OpenGL)
        <atlas>_orm.png     R: baked cabin shading (AO x soft interior light), G: roughness, B: metal
        <atlas>_lit.png     colour with the cabin light baked in (unlit low-end path, sRGB)"""
    col, rough, metal = imgs['col'], imgs['rough'][..., 0], imgs['metal'][..., 0]
    ao = imgs['ao'][..., 0]
    light = imgs['light'].mean(-1)
    lit_ref = np.percentile(light, 98.5)
    L = np.clip(light / max(lit_ref, 1e-6), 0, 1.5)
    shade = np.clip(ao ** 0.85 * (0.3 + 0.7 * np.minimum(L, 1)), 0.05, 1)
    out = os.path.join(args.out, atlas)
    save_png(f'{out}_albedo.png', to_srgb(col))
    save_png(f'{out}_normal.png', imgs['normal'])
    save_png(f'{out}_orm.png', np.stack([shade, rough, metal], -1))
    lit = col * (0.1 + 1.05 * np.minimum(L, 1.3)[..., None] * (ao ** 0.7)[..., None])
    lit += (metal * 0.18 * np.minimum(L, 1) * ao)[..., None] * np.array([0.9, 0.95, 1.0])
    save_png(f'{out}_lit.png', to_srgb(lit * 1.25))
    print(f'  {atlas}: light ref {lit_ref:.3f}, mean shade {shade.mean():.2f}')


def carbon_tile(size=256):
    """Tiling carbon weave for the tinted trim: 12 x 12 tows, light grey (tinted at runtime)."""
    n = 12
    y, x = np.mgrid[0:size, 0:size] / size * n
    par = (np.floor(x) + np.floor(y)) % 2
    fx, fy = x % 1, y % 1
    tow = np.where(par > 0, np.sin(fx * math.pi), np.sin(fy * math.pi))
    sheen = np.where(par > 0, 0.85 + 0.15 * np.sin(fy * TAU * 3), 0.85 + 0.15 * np.sin(fx * TAU * 3))
    shade = (0.35 + 0.65 * tow ** 0.7) * sheen
    alb = np.stack([shade * 0.6] * 3, -1)
    h = tow
    gy, gx = np.gradient(h)
    k = 1.2
    nm = norm(np.stack([-gx * k, gy * k, np.ones_like(h)], -1))
    save_png(os.path.join(args.out, 'carbon_albedo.png'), to_srgb(alb))
    save_png(os.path.join(args.out, 'carbon_normal.png'), nm * 0.5 + 0.5)


# ---------------------------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------------------------

def export(objs, path):
    keep = set(objs.values())
    for ob in bpy.context.scene.objects:
        ob.select_set(ob in keep)
    # Every mesh is exported in its own runtime frame (the game places it): no node transforms.
    for ob in keep:
        ob.matrix_world = Matrix.Identity(4)
    # Export only the atlas uv; the param and metric uv exist only for the bakes.
    stash = {}
    for ob in keep:
        me = ob.data
        stash[ob.name] = me.copy()
        for layer in [l for l in me.uv_layers if l.name != 'atlas']:
            me.uv_layers.remove(layer)
        me.materials.clear()
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_materials='NONE',
                              export_texcoords=True, export_normals=True, export_tangents=path.endswith('high.glb'),
                              export_yup=True, export_apply=False, export_extras=False, export_animations=False)
    print(f'  wrote {path} ({os.path.getsize(path) / 1024:.0f} KB)')


PREVIEWS = [
    ('eye', (0, 0, 0), (30, -0.9, 0), 70, (1600, 720)),
    ('wheel', (0.25, -0.33, -0.02), (0.56, -0.44, 0), 52, (1200, 800)),
    ('cluster', (0.5, -0.27, 0.0), (0.78, -0.32, 0), 40, (1200, 700)),
    ('left', (0.1, -0.15, 0.1), (0.8, -0.38, -0.8), 60, (1200, 700)),
]


def previews(out):
    sc = bpy.context.scene
    cam = bpy.data.cameras.new('eye')
    cam.sensor_fit = 'VERTICAL'
    ob = bpy.data.objects.new('eye', cam)
    sc.collection.objects.link(ob)
    sc.camera = ob
    sc.cycles.samples = 24
    for name, pos, target, fov, size in PREVIEWS:
        cam.angle_y = math.radians(fov)
        cam.clip_start = 0.01
        ob.location = Vector((np.asarray(pos, float) @ B3.T).tolist())
        d = norm(np.asarray(target, float) - np.asarray(pos, float)) @ B3.T
        ob.rotation_euler = Vector(d.tolist()).to_track_quat('-Z', 'Y').to_euler()
        sc.render.resolution_x, sc.render.resolution_y = size
        sc.render.filepath = os.path.join(out, f'preview_{name}.png')
        bpy.ops.render.render(write_still=True)


def main():
    t0 = time.time()
    reset_scene()
    parts, lengths = all_parts()
    if args.report:
        rows = sorted(((p.build(LOD_HIGH)[1].shape[0] * 2, p.name) for p in parts), reverse=True)
        for n, name in rows[:40]:
            print(f'{n:6d}  {name}')
    layouts = {}
    for atlas in ('cabin', 'wheel'):
        ps = [p for p in parts if ATLAS_OF.get(p.group) == atlas]
        layouts[atlas] = pack_islands(ps, max(6, args.size // 160), args.size)
    stats = {}
    # Low detail first (its objects are exported and removed), then full detail, baked.
    low = build_lod(parts, LOD_LOW, layouts, lengths)
    stats['low'] = {k: tris(o) for k, o in low.items()}
    export(low, os.path.join(args.out, 'cockpit_low.glb'))
    for ob in low.values():
        bpy.data.objects.remove(ob, do_unlink=True)
    high = build_lod(parts, LOD_HIGH, layouts, lengths)
    stats['high'] = {k: tris(o) for k, o in high.items()}
    for lod, s in stats.items():
        print(f'{lod}: {sum(s.values())} triangles', {k: v for k, v in s.items()})
    carbon_tile()
    if not args.no_bake:
        add_occluders()
        for atlas in ('cabin', 'wheel'):
            imgs = bake_atlas(atlas, high, args.size, args.samples)
            compose(atlas, imgs)
    if args.preview:
        previews(args.out)
    export(high, os.path.join(args.out, 'cockpit_high.glb'))
    with open(os.path.join(args.out, 'stats.json'), 'w') as f:
        import json
        json.dump({'triangles': stats, 'forearm_rest': lengths, 'bake_size': args.size, 'samples': args.samples}, f, indent=1)
    print(f'done in {time.time() - t0:.0f} s')


main()
