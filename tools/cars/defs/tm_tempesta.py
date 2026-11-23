"""Tempesta FX (tm-tempesta): the open-wheel formula car, 5.20 m.

An original design in the spirit of the current Tempesta (black ground-effect formula car with a
raised nose on a four-element front wing, raked sidepods with letterbox inlets, an airbox with a
camera pod, halo, twin-element rear wing and a big diffuser). No real team's or manufacturer's
shapes, logos or names.

Measured from the shipped model (public/assets/models/tm_tempesta.glb at 5.20 m) so physics and
stats stay the same: wheelbase 3.35 m (front axle x +1.425, rear -1.925 with the body centred on
its bounding box), front tyre radius 0.370 m, rear 0.355 m, front half-track 0.832 m, rear
0.772 m, overall 5.20 x 2.06 x 1.22 m.

`build(q)` returns the car at detail q (1 = showroom, ~0.45 = drive, ~0.16 = race) as
{node: [Mesh, ...]} in the game frame (x forward, y up, z right, metres, ground y = 0). Wheel,
upright and steering-wheel meshes are in their node's own frame (origin on the axis).
Material keys: 'paint', 'body:<finish>', 'tyre', 'rim:<finish>', 'glass', 'driver:<finish>',
'headlight_lens', 'taillight_lens', 'exhaust' (build_car.py maps them to glTF materials).
"""

import math

import numpy as np

from meshkit import (Curve, Mesh, airfoil, blob, catmull, chaikin, ellipse, lerp, loft, norm, patch_slab,
                     recess_rings, dome_rings, resample, revolve, rot, rounded_rect, slab, smoothstep,
                     spow, strut, sweep, tube, window, wing, TAU)

ID = 'tm-tempesta'
FILE = 'tm_tempesta'
LENGTH = 5.20

XF, XR = 1.425, -1.925          # axles
RF, RR = 0.370, 0.355           # tyre radii
TF, TR = 0.832, 0.772           # half-tracks (wheel centre z)
WF, WR = 0.400, 0.520           # tyre widths
RIM_R = 0.229                   # 18-inch bead seat
EYE = (-0.175, 0.900, 0.0)      # driver's eye (cockpit view camera)
WHEEL_CENTRE = (0.170, 0.640, 0.0)
WHEEL_TILT = math.radians(18)   # steering wheel plane leans back toward the driver

META = {
    'id': ID, 'length': LENGTH, 'wheelbase': XF - XR,
    'axles': {'front': XF, 'rear': XR},
    'wheelRadius': {'front': RF, 'rear': RR},
    'halfTrack': {'front': TF, 'rear': TR},
    'tyreWidth': {'front': WF, 'rear': WR},
    'eye': list(EYE),
    'steeringWheel': {'centre': list(WHEEL_CENTRE), 'axis': 'local +x (column, toward the nose)', 'tiltDeg': 18},
    'windows': False,
}


def seg(n, q, lo=3):
    if q < 0.1:  # rival LOD: let the floors drop too
        lo = max(3, int(lo * 0.65))
    v = max(lo, int(round(n * q)))
    return v + (v % 2) if v >= 4 else v  # even ring counts keep left and right symmetric


def seg4(n, q, lo=16):
    """Segments round a wheel: a multiple of 4, so a vertex sits at the top and bottom and the
    bounding-box height is exactly the diameter (the game reads the radius from it)."""
    return max(lo, int(round(n * q / 4)) * 4)


def even(n):
    return n + (n % 2)


# ---------------------------------------------------------------------------------------------
# Chassis: nose, monocoque with the open cockpit, engine cover, crash structure (one loft)
# ---------------------------------------------------------------------------------------------

NOSE_TIP = 2.50
TAIL = -2.255
top_c = Curve([(2.50, 0.245), (2.30, 0.320), (2.00, 0.450), (1.70, 0.565), (1.40, 0.655), (1.10, 0.710),
               (0.80, 0.760), (0.50, 0.800), (0.30, 0.805), (0.10, 0.765), (-0.10, 0.750), (-0.30, 0.752),
               (-0.45, 0.800), (-0.60, 0.870), (-0.90, 0.895), (-1.30, 0.800), (-1.70, 0.660),
               (-2.00, 0.550), (-2.255, 0.470)])
bot_c = Curve([(2.50, 0.170), (2.20, 0.150), (1.70, 0.148), (1.35, 0.150), (1.10, 0.105), (0.60, 0.095),
               (-1.45, 0.095), (-1.80, 0.150), (-2.05, 0.215), (-2.255, 0.265)])
hw_c = Curve([(2.50, 0.052), (2.30, 0.075), (2.00, 0.100), (1.70, 0.130), (1.40, 0.170), (1.00, 0.215),
              (0.60, 0.270), (0.30, 0.310), (0.00, 0.330), (-0.40, 0.330), (-0.80, 0.285), (-1.20, 0.215),
              (-1.60, 0.150), (-2.00, 0.110), (-2.255, 0.070)])
shoulder_c = Curve([(2.5, 0.42), (1.5, 0.50), (0.5, 0.55), (-0.5, 0.55), (-2.255, 0.50)])
COCKPIT = (-0.40, 0.255)   # x range of the opening
cp_floor = Curve([(-0.40, 0.40), (0.0, 0.42), (0.255, 0.50)])
cp_half = Curve([(-0.40, 0.200), (0.0, 0.205), (0.255, 0.170)])


def chassis_ring(x, H):
    t, b, w = float(top_c(x)), float(bot_c(x)), float(hw_c(x))
    ys = b + (t - b) * float(shoulder_c(x))
    phi = np.linspace(-math.pi / 2, math.pi / 2, 241)
    up = phi > 0
    e = np.where(up, 0.62, 0.30)   # rounded top, flat boxy bottom
    z = w * np.abs(np.cos(phi)) ** e
    y = ys + np.where(up, t - ys, ys - b) * spow(np.sin(phi), e)
    # Points are placed on the undeformed section (by arc length, denser where the cockpit wall
    # will be) and only then pushed down into the tub, so they never slide between stations and
    # the skin stays free of creases where the opening starts and ends.
    ci = float(cp_half(np.clip(x, COCKPIT[0], COCKPIT[1])))
    P = np.stack([z, y], -1)
    seg_len = np.linalg.norm(np.diff(P, axis=0), axis=1)
    mid = (P[1:] + P[:-1]) / 2
    dens = 1 + 5 * np.exp(-((mid[:, 0] - ci) / 0.035) ** 2) * (mid[:, 1] > ys)
    s_acc = np.concatenate([[0], np.cumsum(seg_len * dens)])
    t = np.linspace(0, s_acc[-1], H + 1)
    half = np.stack([np.interp(t, s_acc, P[:, 0]), np.interp(t, s_acc, P[:, 1])], -1)
    D = float(window(x, COCKPIT[0] + 0.05, COCKPIT[1] - 0.05, 0.07))
    if D > 1e-4:
        fl = float(cp_floor(x))
        hz, hy = half[:, 0], half[:, 1]
        m = smoothstep(ci + 0.03, ci - 0.025, hz) * (hy > ys)
        half[:, 1] = hy - D * m * np.maximum(hy - fl, 0)
    full = np.vstack([half, half[-2:0:-1] * [-1, 1]])
    return np.stack([np.full(len(full), x), full[:, 1], full[:, 0]], -1)


def chassis(q):
    N = even(seg(96, q, 12))
    S = seg(150, q, 18)
    xs = NOSE_TIP - (NOSE_TIP - TAIL) * (1 - np.cos(np.linspace(0, math.pi, S))) / 2  # denser at the ends
    rings = [chassis_ring(x, N // 2) for x in xs]
    nose_rings, nose_pole = dome_rings(rings[0], rings[0].mean(0), (1, 0, 0), 0.050, steps=seg(5, q, 2))
    tail_rings, tail_pole = dome_rings(rings[-1], rings[-1].mean(0), (-1, 0, 0), 0.045, steps=seg(5, q, 2))
    allr = nose_rings[::-1] + rings + tail_rings
    R = np.array(allr)

    def mat(i, j):
        # the cockpit tub inside the coaming is dark alcantara, not paint
        p = (R[i, j] + R[min(i + 1, len(R) - 1), j]) / 2
        x = p[0]
        if COCKPIT[0] - 0.02 < x < COCKPIT[1] + 0.02 and abs(p[2]) < cp_half(x) + 0.02 and p[1] < top_c(x) - 0.025:
            return 'body:padding'
        return 'paint'

    return loft(R, 'paint', cap0=nose_pole, cap1=tail_pole, mats=mat)


def floor_underside_ring(m):
    return m


# ---------------------------------------------------------------------------------------------
# Sidepods (right side; mirrored)
# ---------------------------------------------------------------------------------------------

sp_out = Curve([(0.42, 0.730), (0.30, 0.780), (0.00, 0.780), (-0.40, 0.700), (-0.80, 0.560), (-1.20, 0.400), (-1.55, 0.250)])
sp_in = Curve([(0.42, 0.170), (-0.60, 0.170), (-1.20, 0.140), (-1.55, 0.110)])
sp_top = Curve([(0.42, 0.620), (0.20, 0.650), (0.00, 0.645), (-0.40, 0.570), (-0.80, 0.450), (-1.20, 0.330), (-1.55, 0.240)])
sp_bot = Curve([(0.42, 0.205), (0.10, 0.140), (-0.40, 0.080), (-1.55, 0.066)])
sp_under = Curve([(0.42, 0.62), (-0.40, 0.52), (-1.55, 0.18)])


def sidepod_ring(x, N):
    zo, zi, yt, yb = (float(c(x)) for c in (sp_out, sp_in, sp_top, sp_bot))
    zc, hz = (zo + zi) / 2, (zo - zi) / 2
    yc, hy = (yt + yb) / 2 + 0.03 * (yt - yb), (yt - yb) / 2
    t = np.arange(N) / N * TAU
    c, s = np.cos(t), np.sin(t)
    dz = hz * spow(c, 0.42)
    dy = hy * spow(s, np.where(s > 0, 0.55, 0.40))
    und = float(sp_under(x))
    low = np.clip(-s, 0, 1)
    dz = np.where(dz > 0, dz * (1 - und * low ** 1.6), dz)
    return np.stack([np.full(N, x), yc + dy, zc + dz], -1)


def sidepod(q):
    N = seg(56, q, 10)
    S = seg(46, q, 8)
    xs = np.linspace(0.42, -1.55, S)
    rings = [sidepod_ring(x, N) for x in xs]
    front = rings[0]
    rr, pole = recess_rings(front, front.mean(0), (1, 0, 0), lip=0.80, depth=0.20, steps=seg(3, q, 2),
                            lip_round=0.03)
    nlip = seg(3, q, 2)
    tail, tpole = dome_rings(rings[-1], rings[-1].mean(0), (-1, 0, 0), 0.05, steps=seg(3, q, 2))
    allr = rr[::-1] + rings + tail
    n_in = len(rr)

    def mats(i, j):
        # Bands inside the inlet (past the lip) are the dark duct.
        return 'body:inlet' if i < n_in - nlip else 'paint'

    m = loft(np.array(allr), 'paint', cap0=pole, cap1=tpole, mats=mats, cap_mat='body:inlet')
    return m


# ---------------------------------------------------------------------------------------------
# Airbox and engine-cover spine, camera pod, shark fin
# ---------------------------------------------------------------------------------------------

ab_top = Curve([(-0.36, 1.100), (-0.50, 1.150), (-0.70, 1.080), (-1.00, 1.020), (-1.30, 0.940), (-1.65, 0.800)])
ab_bot = Curve([(-0.36, 0.800), (-0.70, 0.840), (-1.65, 0.640)])
ab_wb = Curve([(-0.36, 0.125), (-0.60, 0.150), (-1.00, 0.140), (-1.65, 0.090)])
ab_wt = Curve([(-0.36, 0.060), (-0.60, 0.055), (-1.00, 0.040), (-1.65, 0.030)])


def airbox_ring(x, N):
    yt, yb, wb, wt = (float(c(x)) for c in (ab_top, ab_bot, ab_wb, ab_wt))
    t = np.arange(N) / N * TAU
    c, s = np.cos(t), np.sin(t)
    yn = spow(s, 0.7)
    y = (yt + yb) / 2 + (yt - yb) / 2 * yn
    hw = lerp(wb, wt, (yn + 1) / 2)
    z = hw * spow(c, 0.6)
    return np.stack([np.full(N, x), y, z], -1)


def airbox(q):
    N = seg(40, q, 8)
    S = seg(36, q, 6)
    xs = np.linspace(-0.36, -1.65, S)
    rings = [airbox_ring(x, N) for x in xs]
    # The intake mouth is the upper part of the front face (a rounded slot above the head).
    rr, pole = recess_rings(rings[0], rings[0].mean(0) + [0, 0.05, 0], (1, 0, 0), lip=0.72, depth=0.16,
                            steps=seg(3, q, 2), lip_round=0.015)
    tail, tpole = dome_rings(rings[-1], rings[-1].mean(0), (-1, 0, 0), 0.08, steps=seg(3, q, 2))
    n_in = len(rr)
    nlip = seg(3, q, 2)
    allr = rr[::-1] + rings + tail
    return loft(np.array(allr), 'paint', cap0=pole, cap1=tpole,
                mats=lambda i, j: 'body:inlet' if i < n_in - nlip else 'paint', cap_mat='body:inlet')


def camera_pod(q):
    n = seg(16, q, 6)
    post = blob((-0.50, 1.165, 0), (0.028, 0.035, 0.014), n=n, rings=seg(8, q, 4), e1=0.6, e2=0.7, mat='body:carbon')
    pod = tube([(-0.50, 1.198, -0.095), (-0.50, 1.198, 0.095)], 0.018, n=n, mat='paint', samples=seg(8, q, 3),
               up=(1, 0, 0))
    return post + pod


def shark_fin(q):
    pts = np.array([(-0.95, 0.99), (-1.25, 0.99), (-1.65, 0.93), (-1.98, 0.82), (-2.05, 0.74),
                    (-2.00, 0.60), (-1.60, 0.70), (-1.20, 0.82), (-0.95, 0.90)])
    out = chaikin(pts, seg(60, q, 12))
    return slab(out, 0.008, axis=2, centre=0.0, mat='paint', steps=1)


# ---------------------------------------------------------------------------------------------
# Cockpit: coaming pad, headrest, halo, mirrors, steering column
# ---------------------------------------------------------------------------------------------

def coaming(q):
    n = seg(72, q, 16)
    t = np.arange(n) / n * TAU
    cx, hx = (COCKPIT[0] + COCKPIT[1]) / 2, (COCKPIT[1] - COCKPIT[0]) / 2 + 0.012
    x = cx + hx * spow(np.cos(t), 0.35)
    z = (cp_half(x) + 0.016) * spow(np.sin(t), 0.35)
    y = top_c(x) - 0.004
    path = np.stack([x, y, z], -1)
    k = seg(10, q, 5)
    return sweep(path, lambda i, tt: ellipse(0.020, 0.016, k), 'body:padding', closed=True)


def headrest(q):
    n, r = seg(24, q, 8), seg(10, q, 5)
    m = Mesh()
    for s in (-1, 1):
        m += blob((-0.255, 0.785, s * 0.205), (0.17, 0.055, 0.045), n=n, rings=r, e1=0.55, e2=0.45,
                  mat='body:padding')
    m += blob((-0.395, 0.80, 0), (0.035, 0.07, 0.19), n=n, rings=r, e1=0.5, e2=0.5, mat='body:padding')
    return m


HALO_R = [(-0.40, 0.700, 0.285), (-0.37, 0.850, 0.285), (-0.27, 0.948, 0.258), (-0.07, 0.976, 0.232),
          (0.110, 0.972, 0.172), (0.225, 0.966, 0.085), (0.262, 0.963, 0.0)]


def halo(q):
    pts = [(x, y, -z) for x, y, z in HALO_R] + [(x, y, z) for x, y, z in HALO_R[-2::-1]]
    n = seg(14, q, 6)
    hoop = tube(pts, 0.0, n=n, samples=seg(70, q, 14), mat='body:carbon',
                section=lambda i, t: ellipse(0.024, 0.021, n))
    pillar = strut((0.258, 0.962, 0), (0.445, 0.775, 0), 0.016, 0.030, n=n, mat='body:carbon', samples=seg(6, q, 3),
                   up=(0, 0, 1))
    return hoop + pillar


def mirrors(q):
    n, r = seg(20, q, 8), seg(10, q, 5)
    m = Mesh()
    glass = Mesh()
    for s in (-1, 1):
        m += blob((0.385, 0.800, s * 0.575), (0.050, 0.036, 0.088), n=n, rings=r, e1=0.45, e2=0.55, mat='paint')
        m += strut((0.392, 0.772, s * 0.560), (0.372, 0.655, s * 0.545), 0.020, 0.008, n=seg(8, q, 6),
                   mat='body:carbon', samples=3)
        m += strut((0.395, 0.798, s * 0.495), (0.420, 0.780, s * 0.285), 0.018, 0.007, n=seg(8, q, 6),
                   mat='body:carbon', samples=3)
        g = slab(rounded_rect(0.083, 0.030, 0.014, seg(4, q, 2)), 0.004, axis=0, centre=0.0, mat='body:mirror',
                 steps=1)
        # outline coords for axis 0 are (y, z): swap so the long side runs along z
        g.V = g.V[:, [0, 2, 1]]
        g.F = [f[::-1] for f in g.F]
        g.orient_outward()
        g.transform(t=(0.331, 0.800, s * 0.575))
        glass += g
    return m + glass


def column(q):
    return strut((0.20, 0.648, 0), (0.50, 0.700, 0), 0.016, 0.016, n=seg(10, q, 6), mat='body:metal', samples=3)


# ---------------------------------------------------------------------------------------------
# Floor, plank, edge wings, diffuser
# ---------------------------------------------------------------------------------------------

FLOOR_R = [(1.08, 0.0), (1.07, 0.20), (0.95, 0.40), (0.75, 0.63), (0.55, 0.835), (0.30, 0.858), (-0.90, 0.858),
           (-1.20, 0.835), (-1.40, 0.690), (-1.52, 0.480), (-1.60, 0.470), (-1.60, 0.0)]


def floor(q):
    right = catmull(FLOOR_R, seg(70, q, 14))
    right[0, 1] = 0.0
    right[-1, 1] = 0.0
    outline = np.vstack([right, right[-2:0:-1] * [1, -1]])
    f = slab(outline, 0.020, axis=1, centre=0.058, mat='body:carbon', steps=1)
    plank = slab(rounded_rect(1.20, 0.14, 0.05, seg(4, q, 2), cx=-0.25), 0.012, axis=1, centre=0.044,
                 mat='body:satin', steps=1)
    m = f + plank
    for s in (-1, 1):
        e = np.array([(0.45, 0.064), (0.30, 0.125), (-0.95, 0.140), (-1.22, 0.110), (-1.25, 0.064)])
        o = chaikin(e, seg(24, q, 8))
        m += slab(o, 0.009, axis=2, centre=s * 0.853, mat='body:carbon', steps=1)
    return m


def diffuser(q):
    nu, nv = seg(30, q, 6), seg(36, q, 8)
    X0, X1, HZ = -1.55, -2.32, 0.468

    def roof_y(x, z):
        u = np.clip((X0 - x) / (X0 - X1), 0, 1)
        base = 0.066 + 0.235 * u ** 1.5
        tunnels = 0.035 * u * np.cos(np.clip(np.abs(z) / HZ, 0, 1) * math.pi * 1.5) ** 2
        return base + tunnels

    def fn(u, v):
        x = lerp(X0, X1, u)
        z = lerp(-HZ, HZ, v)
        y = roof_y(x, z)
        e = 1e-3
        dx = (roof_y(x + e, z) - roof_y(x - e, z)) / (2 * e)
        dz = (roof_y(x, z + e) - roof_y(x, z - e)) / (2 * e)
        N = norm(np.stack([-dx, np.ones_like(x), -dz], -1))
        return np.stack([x, y, z], -1), N

    m = patch_slab(fn, nu, nv, 0.012, mat='body:carbon')
    for zf in (-HZ, -0.30, -0.12, 0.12, 0.30, HZ):
        xs = np.linspace(X0 - 0.05, X1, seg(14, q, 4))
        top = roof_y(xs, zf) + 0.008
        pts = np.vstack([np.stack([xs, top], -1), [[X1, 0.066], [X0 - 0.05, 0.062]]])
        m += slab(pts, 0.008 if abs(zf) < HZ else 0.012, axis=2, centre=zf, mat='body:carbon', steps=1)
    return m


# ---------------------------------------------------------------------------------------------
# Front wing and endplates
# ---------------------------------------------------------------------------------------------

def front_wing(q):
    S = seg(60, q, 10)
    NA = even(seg(28, q, 10))
    sec = airfoil(NA, thickness=0.11, camber=0.055)
    flap = airfoil(NA, thickness=0.10, camber=0.07)
    m = Mesh()
    zs = np.linspace(-0.966, 0.966, S)
    a = np.abs(zs) / 0.966
    neutral = window(np.abs(zs), 0, 0.22, 0.10)
    le = np.stack([2.585 - 0.07 * a ** 2, 0.104 + 0.012 * neutral - 0.006 * a, zs], -1)
    m += wing(le, lambda t: 0.30 - 0.03 * float(window(abs(t * 2 - 1) * 0.966, 0, 0.22, 0.1)),
              lambda t: math.radians(5 + 4 * abs(t * 2 - 1)), sec, mat='body:carbon')
    flaps = [  # (le x, le y inner, le y outer, chord, aoa deg, material)
        (2.300, 0.162, 0.150, 0.185, 17, 'body:carbon'),
        (2.165, 0.232, 0.212, 0.160, 29, 'paint'),
        (2.040, 0.312, 0.288, 0.135, 41, 'paint'),
    ]
    Sf = seg(40, q, 8)
    for x0, yi, yo, ch, ao, mat in flaps:
        for s in (-1, 1):
            zz = np.linspace(0.235, 0.966, Sf)
            t = (zz - 0.235) / (0.966 - 0.235)
            le = np.stack([x0 - 0.06 * t ** 2, lerp(yi, yo, t) + 0.025 * (1 - t) ** 3, s * zz], -1)
            if s < 0:
                le = le[::-1]
            m += wing(le, ch, math.radians(ao), flap, mat=mat)
    # Inner fences where the flaps start, and the endplates.
    for s in (-1, 1):
        fence = chaikin([(2.33, 0.10), (2.30, 0.20), (2.17, 0.29), (2.03, 0.37), (1.96, 0.36), (2.00, 0.30),
                         (2.15, 0.17), (2.25, 0.10)], seg(30, q, 8))
        m += slab(fence, 0.008, axis=2, centre=s * 0.232, mat='body:carbon', steps=1)
        ep = chaikin([(2.600, 0.065), (2.600, 0.150), (2.48, 0.215), (2.25, 0.300), (2.02, 0.395),
                      (1.905, 0.405), (1.890, 0.330), (1.905, 0.090), (2.000, 0.060), (2.300, 0.058)],
                     seg(46, q, 10), closed=True)
        m += slab(ep, 0.012, axis=2, centre=s * 0.972, mat='paint', steps=1)
    return m


# ---------------------------------------------------------------------------------------------
# Rear wing, beam wing, pylons, DRS pod
# ---------------------------------------------------------------------------------------------

def rear_wing(q):
    S = seg(50, q, 10)
    NA = even(seg(28, q, 10))
    m = Mesh()
    zs = np.linspace(-0.842, 0.842, S)
    a = np.abs(zs) / 0.842
    spoon = 1 - a ** 2
    le = np.stack([-2.318 - 0.012 * spoon, 0.872 - 0.020 * spoon, zs], -1)
    m += wing(le, 0.175, math.radians(7), airfoil(NA, 0.12, 0.06), mat='body:carbon')
    le = np.stack([-2.455 - 0.006 * spoon, 0.948 - 0.010 * spoon, zs], -1)
    m += wing(le, 0.128, math.radians(30), airfoil(NA, 0.11, 0.07), mat='paint')
    # beam wing between the diffuser fences
    zb = np.linspace(-0.47, 0.47, seg(30, q, 8))
    le = np.stack([np.full_like(zb, -2.205), np.full_like(zb, 0.425), zb], -1)
    m += wing(le, 0.120, math.radians(12), airfoil(NA, 0.12, 0.06), mat='body:carbon')
    for s in (-1, 1):
        ep = chaikin([(-2.312, 0.400), (-2.300, 0.700), (-2.240, 0.860), (-2.265, 0.985), (-2.380, 1.035),
                      (-2.560, 1.035), (-2.595, 0.990), (-2.595, 0.560), (-2.520, 0.420), (-2.420, 0.385)],
                     seg(50, q, 10), closed=True)
        m += slab(ep, 0.014, axis=2, centre=s * 0.846, mat='paint', steps=1)
        # beam-wing end fences
        bf = chaikin([(-2.18, 0.37), (-2.17, 0.49), (-2.34, 0.50), (-2.36, 0.38)], seg(16, q, 6))
        m += slab(bf, 0.008, axis=2, centre=s * 0.474, mat='body:carbon', steps=1)
        # swan-neck pylons (twin, either side of the exhaust)
        py = chaikin([(-2.150, 0.430), (-2.200, 0.600), (-2.330, 0.780), (-2.350, 0.880), (-2.420, 0.880),
                      (-2.400, 0.760), (-2.290, 0.580), (-2.250, 0.430)], seg(30, q, 8))
        m += slab(py, 0.010, axis=2, centre=s * 0.072, mat='body:carbon', steps=1)
    m += blob((-2.445, 0.925, 0), (0.030, 0.028, 0.026), n=seg(16, q, 6), rings=seg(8, q, 4), e1=0.6, e2=0.6,
              mat='body:satin')
    return m


def rain_light(q):
    # Centre rain light on the crash structure and LED strips on the endplate trailing edges.
    m = slab(rounded_rect(0.032, 0.020, 0.008, seg(3, q, 2)), 0.010, axis=0, centre=-2.296, mat='taillight_lens',
             steps=1)
    m.V = m.V[:, [0, 2, 1]]
    m.F = [f[::-1] for f in m.F]
    m.orient_outward()
    m.transform(t=(0, 0.355, 0))
    for s in (-1, 1):
        st = slab(rounded_rect(0.17, 0.0045, 0.004, 2, cx=0.0), 0.008, axis=0, centre=-2.596, mat='taillight_lens',
                  steps=1)
        st.transform(t=(0, 0, 0))
        st.V[:, 1], st.V[:, 2] = st.V[:, 1].copy(), st.V[:, 2].copy()
        st.transform(t=(0, 0.78, s * 0.846))
        m += st
    return m


def head_lights(q):
    # Formula cars carry no headlamps: two small LED marker strips on the nose sides give the game
    # something to light at night (headlight_lens in every LOD).
    m = Mesh()
    for s in (-1, 1):
        x0 = 2.06
        w = float(hw_c(x0))
        L = slab(rounded_rect(0.060, 0.0075, 0.006, 2), 0.006, axis=2, centre=0.0, mat='headlight_lens', steps=1)
        ang = math.atan2(float(hw_c(x0 - 0.05) - hw_c(x0 + 0.05)), 0.10)
        L.transform(R=rot((0, 1, 0), -s * ang), t=(x0, 0.40, s * (w - 0.004)))
        m += L
    return m


def exhaust(q):
    n = seg(20, q, 8)
    m = Mesh()
    prof = [(0.0, -0.30), (0.050, -0.30), (0.050, -0.02), (0.056, 0.0), (0.050, 0.004), (0.040, -0.006),
            (0.0, -0.012)]
    main = revolve(prof, n, mat='exhaust', axis='x')
    main.V[:, 0] *= -1
    main.F = [f[::-1] for f in main.F]
    main.orient_outward()
    main.transform(t=(-2.300, 0.525, 0))
    m += main
    for s in (-1, 1):
        wg = revolve([(0.0, -0.20), (0.018, -0.20), (0.018, 0.0), (0.012, -0.004), (0.0, -0.006)], seg(12, q, 6),
                     mat='exhaust', axis='x')
        wg.V[:, 0] *= -1
        wg.F = [f[::-1] for f in wg.F]
        wg.orient_outward()
        wg.transform(t=(-2.255, 0.598, s * 0.055))
        m += wg
    return m


# ---------------------------------------------------------------------------------------------
# Suspension (body-side, static), driveshafts
# ---------------------------------------------------------------------------------------------

def suspension(q):
    race = q < 0.2
    n = 4 if race else seg(10, q, 6)
    k = 2 if race else seg(4, q, 3)
    cap = 'fan' if race else 'dome'
    m = Mesh()
    for s in (-1, 1):
        def P(x, y, z):
            return (x, y, s * z)
        arms = [
            # front: upper and lower wishbones, pushrod, track rod
            (P(XF + 0.26, 0.545, 0.150), P(XF + 0.01, 0.565, 0.700)),
            (P(XF - 0.34, 0.520, 0.170), P(XF + 0.01, 0.565, 0.700)),
            (P(XF + 0.30, 0.255, 0.120), P(XF - 0.01, 0.218, 0.715)),
            (P(XF - 0.44, 0.240, 0.160), P(XF - 0.01, 0.218, 0.715)),
            (P(XF - 0.02, 0.230, 0.690), P(XF - 0.06, 0.620, 0.160)),
            (P(XF - 0.13, 0.405, 0.150), P(XF - 0.13, 0.392, 0.720)),
            # rear: wishbones, pullrod, toe link
            (P(XR + 0.30, 0.505, 0.100), P(XR + 0.02, 0.530, 0.615)),
            (P(XR - 0.14, 0.505, 0.090), P(XR + 0.02, 0.530, 0.615)),
            (P(XR + 0.42, 0.205, 0.120), P(XR, 0.190, 0.640)),
            (P(XR - 0.10, 0.205, 0.100), P(XR, 0.190, 0.640)),
            (P(XR + 0.05, 0.520, 0.600), P(XR + 0.22, 0.180, 0.110)),
            (P(XR - 0.17, 0.320, 0.090), P(XR - 0.15, 0.330, 0.630)),
        ]
        for i, (a, b) in enumerate(arms):
            push = i in (4, 10)
            m += strut(a, b, 0.016 if push else 0.026, 0.010 if push else 0.009, n=n, mat='body:carbon',
                       samples=k, cap=cap)
        # driveshaft with CV boots
        m += strut(P(XR, RR, 0.09), P(XR, RR, 0.63), 0.020, 0.020, n=n + 2 * (not race), mat='body:metal',
                   samples=k, cap=cap)
        if race:
            continue
        for zz in (0.15, 0.58):
            m += blob(P(XR, RR, zz), (0.034, 0.034, 0.040), n=n, rings=seg(8, q, 4), e1=0.9, e2=1.0,
                      mat='body:satin')
    return m


# ---------------------------------------------------------------------------------------------
# Wheels (wheel frame: axis z, outer face +z, origin on the axis)
# ---------------------------------------------------------------------------------------------

def tyre(R, W, q):
    n = seg4(72, q)
    hw = W / 2
    hb = hw - 0.028
    rb = RIM_R + 0.004
    bulge = RIM_R + 0.55 * (R - RIM_R)
    pts = [(rb, -hb), (rb + 0.012, -hw + 0.012), (bulge - 0.03, -hw - 0.002), (bulge + 0.03, -hw - 0.002),
           (R - 0.045, -hw + 0.008), (R - 0.012, -hw + 0.030), (R, -hw + 0.055), (R + 0.003, 0.0),
           (R, hw - 0.055), (R - 0.012, hw - 0.030), (R - 0.045, hw - 0.008), (bulge + 0.03, hw + 0.002),
           (bulge - 0.03, hw + 0.002), (rb + 0.012, hw - 0.012), (rb, hb), (RIM_R - 0.006, hb - 0.01),
           (RIM_R - 0.006, -hb + 0.01)]
    np_ = max(12, even(int(round(40 * q))))
    prof = catmull(pts, np_, closed=True)
    # Scale the section about the bead so the crown is exactly R (the spline rounds past its keys).
    rmax = prof[:, 0].max()
    prof[:, 0] = rb + (prof[:, 0] - rb) * (R - rb) / (rmax - rb)
    m = revolve(prof, n, mat='tyre', closed_profile=True)
    return m


def rim(W, q):
    n = seg4(84, q)
    if q < 0.2:
        return rim_race(W, n)
    wr = W - 0.05
    zo, zi = wr / 2, -wr / 2
    prof = [(0.236, zo - 0.004), (0.236, zo - 0.012), (0.229, zo - 0.017), (0.229, zo - 0.035),
            (0.212, zo - 0.060), (0.212, zi + 0.060), (0.229, zi + 0.035), (0.229, zi + 0.017),
            (0.236, zi + 0.012), (0.236, zi + 0.004), (0.226, zi), (0.200, zi + 0.012), (0.200, zo - 0.030),
            (0.214, zo - 0.008), (0.230, zo)]
    m = revolve(prof, n, mat='rim:alloy', closed_profile=True)
    # Spokes: five twin-spoke pairs, dished out toward the hub.
    ns = seg(10, q, 6)
    nsec = seg(10, q, 6)
    for k in range(10):
        base = (k // 2) * TAU / 5
        sgn = 1 if k % 2 else -1
        rs = np.linspace(0.052, 0.207, ns)
        # twin spokes start together at the hub and split toward the rim (a Y)
        th = base + sgn * math.radians(9.0) * ((rs - 0.052) / 0.155) ** 0.85
        zz = zo - 0.012 - 0.026 * smoothstep(0.06, 0.20, rs)
        path = np.stack([rs * np.cos(th), rs * np.sin(th), zz], -1)

        def sec(i, t):
            return ellipse(lerp(0.013, 0.009, t), 0.011, nsec, e=0.55)

        m += sweep(path, sec, 'rim:alloy', cap0='flat', cap1='flat', up=(0, 0, 1))
    hub = [(0.0, zo - 0.050), (0.068, zo - 0.050), (0.068, zo - 0.018), (0.058, zo - 0.008), (0.0, zo - 0.008)]
    m += revolve(hub, seg(32, q, 10), mat='rim:alloy')
    nut = [(0.0, zo - 0.010), (0.034, zo - 0.010), (0.034, zo + 0.010), (0.028, zo + 0.016), (0.0, zo + 0.016)]
    m += revolve(nut, 6, mat='rim:nut')
    cap = [(0.0, zo + 0.012), (0.018, zo + 0.012), (0.018, zo + 0.022), (0.010, zo + 0.028), (0.0, zo + 0.029)]
    m += revolve(cap, seg(16, q, 6), mat='rim:nut')
    return m


def rim_race(W, n):
    """Rival LOD rim: barrel and dished face in one revolve, hex nut; the spokes are painted
    into its vertex colours by the bake."""
    wr = W - 0.05
    zo, zi = wr / 2, -wr / 2
    prof = [(0.0, zo - 0.030), (0.205, zo - 0.030), (0.236, zo - 0.004), (0.236, zi + 0.004), (0.200, zi + 0.004),
            (0.0, zi + 0.004)]
    m = revolve(prof, n, mat='rim:alloy')
    nut = [(0.0, zo - 0.032), (0.034, zo - 0.032), (0.034, zo + 0.012), (0.0, zo + 0.012)]
    m += revolve(nut, 6, mat='rim:nut')
    return m


def upright(front, q):
    """Static (steering) side of a wheel: upright, brake drum, disc, caliper. Wheel frame, right
    side; the left one is its mirror."""
    W = WF if front else WR
    hw = W / 2
    m = Mesh()
    zc = -hw + 0.10            # inner part of the rim barrel
    n = seg(40, q, 10)
    disc = [(0.090, zc + 0.020), (0.158, zc + 0.020), (0.158, zc + 0.052), (0.090, zc + 0.052)]
    m += revolve(disc, n, mat='body:disc', closed_profile=True)
    drum = [(0.0, zc - 0.065), (0.172, zc - 0.065), (0.176, zc - 0.040), (0.176, zc + 0.012), (0.090, zc + 0.016),
            (0.0, zc + 0.016)]
    if q < 0.2:
        na = 5
        angs = np.radians(np.linspace(108, 152, na))
        path = np.stack([np.cos(angs) * 0.140, np.sin(angs) * 0.140, np.full(na, zc + 0.036)], -1)
        return m + sweep(path, lambda i, t: ellipse(0.034, 0.036, 4, e=0.35), 'body:caliper', cap0='fan', cap1='fan',
                         up=(0, 0, 1))
    m += revolve(drum, n, mat='body:carbon')
    # caliper: an arc that straddles the disc behind the top of the wheel
    na = seg(14, q, 5)
    angs = np.radians(np.linspace(108, 152, na))
    path = np.stack([np.cos(angs) * 0.140, np.sin(angs) * 0.140, np.full(na, zc + 0.036)], -1)
    m += sweep(path, lambda i, t: ellipse(0.034, 0.036, seg(12, q, 6), e=0.35), 'body:caliper', cap0='dome',
               cap1='dome', up=(0, 0, 1), dome_depth=0.012, dome_steps=2)
    m += blob((0.0, 0.0, zc - 0.090), (0.055, 0.170, 0.030), n=seg(16, q, 6), rings=seg(10, q, 4), e1=0.55,
              e2=0.6, mat='body:metal')
    if front:
        m += blob((0.175, 0.04, zc - 0.05), (0.06, 0.05, 0.035), n=seg(14, q, 6), rings=seg(8, q, 4), e1=0.5,
                  e2=0.5, mat='body:carbon')
    return m


# ---------------------------------------------------------------------------------------------
# Steering wheel (steering_wheel frame: origin on the column axis at the wheel centre, local +x
# along the column toward the nose, +y up the wheel face, +z to the car's right)
# ---------------------------------------------------------------------------------------------

def steering_wheel(q, detail=1.0):
    m = Mesh()
    if q < 0.2:
        return slab(rounded_rect(0.060, 0.130, 0.040, 1), 0.034, axis=0, centre=0.0, mat='body:satin', steps=1)
    body = rounded_rect(0.060, 0.098, 0.030, seg(5, q, 3))
    b = slab(body, 0.034, axis=0, centre=0.0, mat='body:satin', steps=seg(2, q, 1))
    m += b
    n = seg(14, q, 6)
    for s in (-1, 1):
        grip = [(0.0, -0.070, s * 0.095), (0.0, -0.045, s * 0.128), (0.0, 0.010, s * 0.136), (0.0, 0.052, s * 0.118),
                (0.0, 0.062, s * 0.090)]
        m += tube(grip, 0.0, n=n, samples=seg(14, q, 5), mat='body:padding', up=(1, 0, 0),
                  section=lambda i, t: ellipse(0.024, 0.020, n))
        # paddles behind the wheel
        pad = slab(rounded_rect(0.040, 0.022, 0.010, 2), 0.006, axis=0, centre=0.024, mat='body:carbon', steps=1)
        pad.transform(t=(0, 0.005, s * 0.075))
        m += pad
    # display and rev lights on the driver's face (-x)
    disp = slab(rounded_rect(0.024, 0.040, 0.004, 2), 0.004, axis=0, centre=-0.018, mat='body:display', steps=1)
    disp.transform(t=(0, 0.012, 0))
    m += disp
    leds = slab(rounded_rect(0.004, 0.050, 0.003, 2), 0.004, axis=0, centre=-0.018, mat='body:display', steps=1)
    leds.transform(t=(0, 0.048, 0))
    m += leds
    if q >= 0.3:
        nb = seg(10, q, 6)
        for yy, zz in ((-0.020, -0.062), (-0.020, 0.062), (-0.045, -0.050), (-0.045, 0.050), (0.030, -0.065),
                       (0.030, 0.065), (-0.040, 0.0)):
            k = revolve([(0.0, 0.0), (0.008, 0.0), (0.008, 0.006), (0.0, 0.007)], nb, mat='body:metal', axis='x')
            k.V[:, 0] *= -1
            k.F = [f[::-1] for f in k.F]
            k.orient_outward()
            k.transform(t=(-0.016, yy, zz))
            m += k
    return m


# ---------------------------------------------------------------------------------------------
# Driver (car frame)
# ---------------------------------------------------------------------------------------------

HELMET_C = np.array([-0.200, 0.895, 0.0])
HELMET_H = np.array([0.150, 0.138, 0.128])


def helmet_surface(u, v):
    """Ellipsoid point and normal at azimuth u (0..1 around the vertical, 0.5 = straight ahead)
    and elevation v (-1..1)."""
    az = (u - 0.5) * TAU
    el = v * math.pi / 2
    d = np.stack([np.cos(el) * np.cos(az), np.sin(el), np.cos(el) * np.sin(az)], -1)
    P = HELMET_C + d * HELMET_H
    N = norm(d / HELMET_H)
    return P, N


def driver(q):
    m = Mesh()
    n, r = seg(36, q, 10), seg(18, q, 6)
    h = blob(HELMET_C, HELMET_H, n=n, rings=r, e1=0.9, e2=0.95, mat='driver:helmet')
    # chin bar: push the lower front forward
    loc = (h.V - HELMET_C) / HELMET_H
    chin = smoothstep(0.1, 0.8, loc[:, 0]) * smoothstep(0.1, -0.7, loc[:, 1])
    h.V[:, 0] += chin * 0.03
    h.V[:, 1] -= chin * 0.012
    m += h

    def visor(u, v):
        uu = lerp(0.5 - 0.17, 0.5 + 0.17, u)
        vv = lerp(-0.06, 0.30, v)
        return helmet_surface(uu, vv)

    m += patch_slab(visor, seg(16, q, 4), seg(5, q, 2), 0.005, mat='glass', side_mat='driver:helmet')
    m += blob((-0.285, 0.770, 0), (0.090, 0.040, 0.150), n=seg(24, q, 8), rings=seg(10, q, 4), e1=0.6, e2=0.7,
              mat='driver:suit')
    m += blob((-0.330, 0.600, 0), (0.120, 0.170, 0.190), n=seg(24, q, 8), rings=seg(10, q, 4), e1=0.7, e2=0.7,
              mat='driver:suit')
    na = seg(12, q, 6)
    for s in (-1, 1):
        m += tube([(-0.300, 0.690, s * 0.175), (-0.090, 0.648, s * 0.205), (0.110, 0.643, s * 0.128)], 0.042,
                  n=na, mat='driver:suit', radius_fn=lambda t: lerp(1.0, 0.78, t), samples=seg(14, q, 5))
        m += blob((0.150, 0.640, s * 0.122), (0.048, 0.040, 0.034), n=seg(14, q, 6), rings=seg(8, q, 4), e1=0.7,
                  e2=0.7, mat='driver:glove')
    return m


def hands_detail(q):
    """Gloved hands round the grips, for the cockpit file (steering_wheel frame)."""
    m = Mesh()
    n = seg(12, q, 6)
    for s in (-1, 1):
        palm = blob((0.012, 0.000, s * 0.132), (0.040, 0.046, 0.026), n=seg(18, q, 8), rings=seg(10, q, 5),
                    e1=0.7, e2=0.7, mat='driver:glove')
        m += palm
        for k, yy in enumerate((0.030, 0.012, -0.006, -0.024)):
            # fingers curl round the grip from the back (+x) to the front (-x)
            ang = np.radians(np.linspace(-30, 200, 7))
            rr = 0.030
            pts = np.stack([np.cos(ang) * rr * 1.1 + 0.002, np.full(7, yy), s * (0.132 - np.sin(ang) * rr * 0.9)], -1)
            m += tube(pts, 0.0095 - 0.0008 * k, n=n, mat='driver:glove', samples=seg(12, q, 6))
        thumb = [(0.010, 0.040, s * 0.112), (-0.012, 0.050, s * 0.098), (-0.026, 0.046, s * 0.088)]
        m += tube(thumb, 0.011, n=n, mat='driver:glove', samples=seg(8, q, 4))
        cuff = tube([(0.040, -0.004, s * 0.150), (0.090, -0.020, s * 0.175)], 0.030, n=n, mat='driver:suit',
                    samples=seg(6, q, 3))
        m += cuff
    return m


def cockpit_shell(q):
    """Inner cockpit surfaces seen from the eye at high detail (car frame): bulkhead panel with
    switches under the wheel and the side pads. Added on top of the drive body."""
    m = Mesh()
    pnl = patch_slab(lambda u, v: (np.stack([np.full_like(u, 0.262), lerp(0.53, 0.72, v), lerp(-0.15, 0.15, u)], -1),
                                   np.stack([-np.ones_like(u), np.zeros_like(u), np.zeros_like(u)], -1)),
                     seg(10, q, 4), seg(6, q, 3), 0.012, mat='body:satin')
    m += pnl
    for k in range(6):
        sw = revolve([(0.0, 0.0), (0.006, 0.0), (0.006, 0.008), (0.0, 0.009)], seg(10, q, 6), mat='body:metal',
                     axis='x')
        sw.V[:, 0] *= -1
        sw.F = [f[::-1] for f in sw.F]
        sw.orient_outward()
        sw.transform(t=(0.250, 0.60 + 0.03 * (k // 3), -0.06 + 0.06 * (k % 3)))
        m += sw
    return m


# ---------------------------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------------------------

def build(q):
    """{node: Mesh}. Node frames: body, driver, headlight_lens, taillight_lens, exhaust in car
    frame; wheel_XX / upright_XX in their wheel frame (origin on the axis, +z outward on the
    right side; the left side is the same mesh turned 180 degrees about y for wheels and a mirror
    for uprights); steering_wheel in its own frame."""
    body = chassis(q)
    sp = sidepod(q)
    body += sp + sp.mirrored_z()
    body += airbox(q) + camera_pod(q) + shark_fin(q)
    body += coaming(q) + headrest(q) + halo(q) + mirrors(q) + column(q)
    body += floor(q) + diffuser(q)
    body += front_wing(q) + rear_wing(q) + suspension(q)
    nodes = {
        'body': body,
        'exhaust': exhaust(q),
        'headlight_lens': head_lights(q),
        'taillight_lens': rain_light(q),
        'driver': driver(q),
        'steering_wheel': steering_wheel(q),
        'tyre_front': tyre(RF, WF, q), 'rim_front': rim(WF, q),
        'tyre_rear': tyre(RR, WR, q), 'rim_rear': rim(WR, q),
        'upright_front': upright(True, q), 'upright_rear': upright(False, q),
    }
    return nodes


def wheel_layout():
    """(node name, axle key, centre in car frame, left side?)"""
    return [
        ('FL', 'front', (XF, RF, -TF), True), ('FR', 'front', (XF, RF, TF), False),
        ('RL', 'rear', (XR, RR, -TR), True), ('RR', 'rear', (XR, RR, TR), False),
    ]


def cockpit(q=1.0):
    """Cockpit-view parts (separate file): high-detail steering wheel with hands (wheel frame)
    and the inner cockpit panel (car frame)."""
    return {
        'steering_wheel': steering_wheel(q),
        'hands': hands_detail(q),
        'cockpit_shell': cockpit_shell(q),
    }
