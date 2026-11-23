"""Tempesta FX (tm-tempesta): the open-wheel formula car, 5.20 m. Revision 2.

An original design in the spirit of the current Tempesta: a black / carbon ground-effect formula
car with paint-colour and white accent zones, a raised nose on a four-element front wing,
sculpted sidepods with a deep carbon undercut and letterbox inlets, a slim engine cover with a
shark fin, bargeboards, a halo, a twin-element rear wing with louvred endplates, a beam wing and
a big diffuser. No real team's, sponsor's or manufacturer's shapes, logos or names.

Measured from the shipped model (public/assets/models/tm_tempesta.glb at 5.20 m) so physics and
stats stay the same: wheelbase 3.35 m (front axle x +1.425, rear -1.925 with the body centred on
its bounding box), front tyre radius 0.370 m, rear 0.355 m, front half-track 0.832 m, rear
0.772 m, overall 5.20 x 2.07 x 1.22 m.

`build(q)` returns the car at detail q (1 = showroom, ~0.45 = drive, ~0.08 = race) as
{node: Mesh} in the game frame (x forward, y up, z right, metres, ground y = 0). Wheel, upright
and steering-wheel meshes are in their node's own frame (origin on the axis).

Material keys -> glTF materials (build_car.py group_of):
    'paint'              CarPaint   the zones that take the player's paint (livery map: AO,
                                    panel lines, black decals; see livery())
    'carbon', 'carbon:satin'  Carbon  exposed carbon (tiling twill on its own UV set)
    'body:<finish>'      Body       satin / gloss black, white, metal, padding, inlets, display
    'tyre', 'rim:*', 'driver:*', 'glass', 'mirror', 'headlight_lens', 'taillight_lens', 'exhaust'
`livery(group, P, N, valid)` paints the white accents, decals and panel lines (tools/cars/livery.py).
"""

import math

import numpy as np

import livery as lv
from meshkit import (Curve, Mesh, airfoil, blob, catmull, chaikin, dome_rings, ellipse, fillet_poly, lerp, loft,
                     norm, patch_slab, recess_rings, revolve, rot, rounded_rect, slab, smoothstep, spow, strut,
                     sweep, tube, window, wing, TAU)

ID = 'tm-tempesta'
FILE = 'tm_tempesta'
LENGTH = 5.20

XF, XR = 1.425, -1.925          # axles
RF, RR = 0.370, 0.355           # tyre radii
TF, TR = 0.832, 0.772           # half-tracks (wheel centre z)
WF, WR = 0.400, 0.520           # tyre widths
RIM_R = 0.229                   # 18-inch bead seat
# Cockpit view camera: an onboard camera at the top of the driver's helmet, above the halo hoop
# so the hoop and its centre pillar sit below the road's vanishing point, the steering wheel
# display at the bottom of the view and both front tyres and wing tips at the sides.
EYE = (-0.300, 1.020, 0.0)
WHEEL_CENTRE = (0.140, 0.700, 0.0)
WHEEL_TILT = math.radians(20)   # steering wheel plane leans back toward the driver
FACTORY_PAINT = (0.62, 0.025, 0.02)   # linear RGB of the factory livery's paint zones (red)
RACE_NUMBER = '17'

META = {
    'id': ID, 'length': LENGTH, 'wheelbase': XF - XR,
    'axles': {'front': XF, 'rear': XR},
    'wheelRadius': {'front': RF, 'rear': RR},
    'halfTrack': {'front': TF, 'rear': TR},
    'tyreWidth': {'front': WF, 'rear': WR},
    'eye': list(EYE),
    'steeringWheel': {'centre': list(WHEEL_CENTRE), 'axis': 'local +x (column, toward the nose)', 'tiltDeg': 20},
    'windows': False,
    'mirrorGlass': 'material MirrorGlass, uv 0..1 per glass (u along z, v up)',
    'factoryPaint': list(FACTORY_PAINT),
}


def seg(n, q, lo=3):
    if q < 0.1:  # rival LOD: let the floors drop too
        lo = max(3, int(lo * 0.65))
    v = max(lo, int(round(n * q)))
    return v + (v % 2) if v >= 4 else v  # even ring counts keep left and right symmetric


def cnt(n, q, lo=1):
    """Point count for a fillet-section edge or arc (no even rounding)."""
    return max(lo, int(round(n * q)))


def seg4(n, q, lo=16):
    """Segments round a wheel: a multiple of 4, so a vertex sits at the top and bottom and the
    bounding-box height is exactly the diameter (the game reads the radius from it)."""
    return max(lo, int(round(n * q / 4)) * 4)


def even(n):
    return n + (n % 2)


def mirror_x(m):
    """Mirror a mesh across z = 0 (helper for the left copy of right-side parts)."""
    return m.mirrored_z()


# ---------------------------------------------------------------------------------------------
# Chassis: nose, monocoque with the open cockpit, engine cover, crash structure (one loft)
# ---------------------------------------------------------------------------------------------

NOSE_TIP = 2.50
TAIL = -2.255
NOSE_BAND = 2.33                # nose tip ahead of this is a white Body band (the number board)
ENGINE_CUT = -0.50              # paint ends here: the engine cover behind it is satin black
top_c = Curve([(2.50, 0.245), (2.30, 0.318), (2.00, 0.445), (1.70, 0.560), (1.40, 0.650), (1.10, 0.706),
               (0.80, 0.756), (0.50, 0.796), (0.30, 0.802), (0.10, 0.765), (-0.10, 0.750), (-0.30, 0.752),
               (-0.45, 0.800), (-0.60, 0.865), (-0.90, 0.885), (-1.30, 0.790), (-1.70, 0.650),
               (-2.00, 0.540), (-2.255, 0.460)])
bot_c = Curve([(2.50, 0.170), (2.20, 0.150), (1.70, 0.148), (1.35, 0.150), (1.10, 0.105), (0.60, 0.095),
               (-1.45, 0.095), (-1.80, 0.150), (-2.05, 0.215), (-2.255, 0.265)])
hw_c = Curve([(2.50, 0.050), (2.30, 0.071), (2.00, 0.096), (1.70, 0.126), (1.40, 0.163), (1.00, 0.208),
              (0.60, 0.262), (0.30, 0.300), (0.00, 0.318), (-0.40, 0.312), (-0.80, 0.250), (-1.20, 0.175),
              (-1.60, 0.125), (-2.00, 0.094), (-2.255, 0.066)])
shoulder_c = Curve([(2.5, 0.42), (1.5, 0.50), (0.5, 0.55), (-0.5, 0.55), (-2.255, 0.50)])
COCKPIT = (-0.40, 0.255)   # x range of the opening
cp_floor = Curve([(-0.40, 0.40), (0.0, 0.42), (0.255, 0.50)])
cp_half = Curve([(-0.40, 0.200), (0.0, 0.205), (0.255, 0.170)])


def chassis_breaks(x):
    """Livery lines on the chassis side: carbon below y1, satin black band (white pinstripe at
    its top) up to y2, paint above. Vectorised (the livery uses the same lines)."""
    t, b = top_c(x), bot_c(x)
    ys = b + (t - b) * shoulder_c(x)
    return b + 0.28 * (ys - b), ys - 0.012


def chassis_ring(x, counts):
    na, nb, nc = counts
    t, b, w = float(top_c(x)), float(bot_c(x)), float(hw_c(x))
    ys = b + (t - b) * float(shoulder_c(x))
    phi = np.linspace(-math.pi / 2, math.pi / 2, 361)
    up = phi > 0
    e = np.where(up, 0.46, 0.30)   # crisper shoulder on top, flat boxy bottom
    z = w * np.abs(np.cos(phi)) ** e
    y = ys + np.where(up, t - ys, ys - b) * spow(np.sin(phi), e)
    # Points are placed on the undeformed section (by arc length, denser where the cockpit wall
    # will be) and only then pushed down into the tub, so they never slide between stations.
    # The two livery lines are exact vertex rows (counts per band are fixed), so the paint edge
    # is a clean curve along the car, not a staircase of faces.
    ci = float(cp_half(np.clip(x, COCKPIT[0], COCKPIT[1])))
    P = np.stack([z, y], -1)
    seg_len = np.linalg.norm(np.diff(P, axis=0), axis=1)
    mid = (P[1:] + P[:-1]) / 2
    dens = 1 + 5 * np.exp(-((mid[:, 0] - ci) / 0.035) ** 2) * (mid[:, 1] > ys)
    s_acc = np.concatenate([[0], np.cumsum(seg_len * dens)])
    y1, y2 = (float(v) for v in chassis_breaks(x))
    s1, s2 = np.interp(y1, P[:, 1], s_acc), np.interp(y2, P[:, 1], s_acc)
    tt = np.concatenate([np.linspace(0, s1, na + 1)[:-1], np.linspace(s1, s2, nb + 1)[:-1],
                         np.linspace(s2, s_acc[-1], nc + 1)])
    half = np.stack([np.interp(tt, s_acc, P[:, 0]), np.interp(tt, s_acc, P[:, 1])], -1)
    D = float(window(x, COCKPIT[0] + 0.05, COCKPIT[1] - 0.05, 0.07))
    if D > 1e-4:
        fl = float(cp_floor(x))
        hz, hy = half[:, 0], half[:, 1]
        m = smoothstep(ci + 0.03, ci - 0.025, hz) * (hy > ys)
        half[:, 1] = hy - D * m * np.maximum(hy - fl, 0)
    full = np.vstack([half, half[-2:0:-1] * [-1, 1]])
    return np.stack([np.full(len(full), x), full[:, 1], full[:, 0]], -1)


def chassis(q):
    N = even(seg(84, q, 12))
    H = N // 2
    na, nb = max(1, round(H * 0.24)), max(1, round(H * 0.14))
    counts = (na, nb, H - na - nb)
    S = seg(124, q, 18)
    xs = NOSE_TIP - (NOSE_TIP - TAIL) * (1 - np.cos(np.linspace(0, math.pi, S))) / 2  # denser at the ends
    for cut in (NOSE_BAND, ENGINE_CUT):
        k = int(np.argmin(np.abs(xs - cut)))
        xs[k] = cut
    rings = [chassis_ring(x, counts) for x in xs]
    nose_rings, nose_pole = dome_rings(rings[0], rings[0].mean(0), (1, 0, 0), 0.050, steps=seg(5, q, 2))
    tail_rings, tail_pole = dome_rings(rings[-1], rings[-1].mean(0), (-1, 0, 0), 0.045, steps=seg(5, q, 2))
    allr = nose_rings[::-1] + rings + tail_rings
    R = np.array(allr)

    def mat(i, j):
        p = (R[i, j] + R[min(i + 1, len(R) - 1), j]) / 2
        x = p[0]
        if x > NOSE_BAND + 1e-4:
            return 'body:satin'
        # the cockpit tub inside the coaming is dark alcantara, not paint
        if COCKPIT[0] - 0.02 < x < COCKPIT[1] + 0.02 and abs(p[2]) < cp_half(x) + 0.02 and p[1] < top_c(x) - 0.025:
            return 'body:padding'
        hb = j if j < H else 2 * H - 1 - j
        if hb < na:
            return 'carbon'
        if hb < na + nb or x < ENGINE_CUT:
            return 'body:satin'
        return 'paint'

    return loft(R, 'paint', cap0=nose_pole, cap1=tail_pole, mats=mat, cap_mat='body:satin')


# ---------------------------------------------------------------------------------------------
# Sidepods (right side; mirrored): sculpted, crisp outer edge, deep carbon undercut, letterbox
# ---------------------------------------------------------------------------------------------

sp_zo = Curve([(0.40, 0.700), (0.20, 0.735), (-0.20, 0.725), (-0.60, 0.635), (-1.00, 0.480), (-1.30, 0.355),
               (-1.55, 0.255)])
sp_ye = Curve([(0.40, 0.500), (0.10, 0.478), (-0.40, 0.422), (-0.90, 0.335), (-1.30, 0.255), (-1.55, 0.190)])
sp_yt = Curve([(0.40, 0.625), (0.15, 0.660), (-0.20, 0.642), (-0.60, 0.555), (-1.00, 0.432), (-1.30, 0.322),
               (-1.55, 0.236)])
sp_zu = Curve([(0.40, 0.375), (0.00, 0.385), (-0.60, 0.365), (-1.10, 0.300), (-1.55, 0.215)])
SP_YB = 0.070
SP_X = (0.40, -1.55)


def sidepod_ring(x, q):
    zo, ye, yt, zu = (float(c(x)) for c in (sp_zo, sp_ye, sp_yt, sp_zu))
    zi = float(hw_c(x)) - 0.05
    yb = SP_YB
    C = [(zi, yb), (zu, yb), (zu + 0.30 * (zo - zu), yb + 0.70 * (ye - yb)), (zo, ye),
         (zo - 0.30 * (zo - zi), yt + 0.012), (zi + 0.03, yt), (zi, yt - 0.04)]
    R = [0.004, 0.030, 0.100, 0.009, 0.100, 0.030, 0.004]
    E = [cnt(3, q), cnt(5, q), cnt(5, q), cnt(8, q, 2), cnt(6, q), cnt(2, q), cnt(4, q)]
    A = [2, cnt(3, q, 2), cnt(5, q, 2), cnt(3, q, 2), cnt(5, q, 2), cnt(3, q, 2), 2]
    pts, st = fillet_poly(C, R, E, A)
    return np.stack([np.full(len(pts), x), pts[:, 1], pts[:, 0]], -1), st


def sidepod(q):
    S = seg(44, q, 7)
    xs = np.linspace(SP_X[0], SP_X[1], S)
    rr_ = [sidepod_ring(x, q) for x in xs]
    rings = [r for r, _ in rr_]
    st = rr_[0][1]
    front = rings[0]
    c = front.mean(0) + [0, 0.02, 0.015]
    rr, pole = recess_rings(front, c, (1, 0, 0), lip=0.80, depth=0.30, steps=seg(3, q, 2), lip_round=0.022)
    nlip = seg(3, q, 2)
    tail, tpole = dome_rings(rings[-1], rings[-1].mean(0), (-1, 0, 0), 0.05, steps=seg(3, q, 2))
    allr = rr[::-1] + rings + tail
    n_in = len(rr)

    def mats(i, j):
        # Bands inside the inlet (past the lip) are the dark duct; outside, a paint flash runs
        # from the crisp outer edge up to the crest, the inner top is satin black and the
        # undercut below the edge exposed carbon.
        if i < n_in - nlip:
            return 'body:inlet'
        if st[3] <= j < st[4]:
            return 'paint'
        return 'body:satin' if st[4] <= j < st[6] else 'carbon'

    return loft(np.array(allr), 'paint', cap0=pole, cap1=tpole, mats=mats, cap_mat='body:inlet')


# ---------------------------------------------------------------------------------------------
# Airbox and engine-cover spine, camera pod, shark fin
# ---------------------------------------------------------------------------------------------

ab_top = Curve([(-0.36, 1.095), (-0.50, 1.140), (-0.70, 1.070), (-1.00, 1.005), (-1.30, 0.925), (-1.65, 0.790)])
ab_bot = Curve([(-0.36, 0.800), (-0.70, 0.830), (-1.65, 0.630)])
ab_wb = Curve([(-0.36, 0.118), (-0.60, 0.128), (-1.00, 0.108), (-1.65, 0.068)])
ab_wt = Curve([(-0.36, 0.052), (-0.60, 0.046), (-1.00, 0.032), (-1.65, 0.022)])


def airbox_ring(x, N):
    yt, yb, wb, wt = (float(c(x)) for c in (ab_top, ab_bot, ab_wb, ab_wt))
    t = np.arange(N) / N * TAU
    c, s = np.cos(t), np.sin(t)
    yn = spow(s, 0.6)
    y = (yt + yb) / 2 + (yt - yb) / 2 * yn
    hw = lerp(wb, wt, (yn + 1) / 2)
    z = hw * spow(c, 0.45)
    return np.stack([np.full(N, x), y, z], -1)


def airbox(q):
    N = seg(40, q, 8)
    S = seg(34, q, 6)
    xs = np.linspace(-0.36, -1.65, S)
    rings = [airbox_ring(x, N) for x in xs]
    # The intake mouth is the upper part of the front face (a rounded slot above the head).
    rr, pole = recess_rings(rings[0], rings[0].mean(0) + [0, 0.05, 0], (1, 0, 0), lip=0.72, depth=0.20,
                            steps=seg(3, q, 2), lip_round=0.012)
    tail, tpole = dome_rings(rings[-1], rings[-1].mean(0), (-1, 0, 0), 0.08, steps=seg(3, q, 2))
    n_in = len(rr)
    nlip = seg(3, q, 2)
    allr = rr[::-1] + rings + tail
    return loft(np.array(allr), 'paint', cap0=pole, cap1=tpole,
                mats=lambda i, j: 'body:inlet' if i < n_in - nlip else 'paint', cap_mat='body:inlet')


def camera_pod(q):
    n = seg(16, q, 6)
    post = blob((-0.50, 1.160, 0), (0.028, 0.035, 0.014), n=n, rings=seg(8, q, 4), e1=0.6, e2=0.7, mat='carbon')
    pod = tube([(-0.50, 1.193, -0.095), (-0.50, 1.193, 0.095)], 0.017, n=n, mat='body:white', samples=seg(8, q, 3),
               up=(1, 0, 0))
    return post + pod


FIN = [(-0.90, 1.015), (-1.25, 1.030), (-1.65, 0.985), (-2.00, 0.890), (-2.09, 0.815), (-2.06, 0.500),
       (-1.60, 0.660), (-1.20, 0.860), (-0.90, 0.940)]


def shark_fin(q):
    out = chaikin(np.array(FIN), seg(64, q, 12), iters=2)
    return slab(out, 0.008, axis=2, centre=0.0, mat='body:satin', steps=1)


# ---------------------------------------------------------------------------------------------
# Cockpit: carbon rim, padded headrest, halo, mirrors, steering column
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
    return sweep(path, lambda i, tt: ellipse(0.020, 0.016, k), 'carbon', closed=True)


def headrest(q):
    n, r = seg(24, q, 8), seg(10, q, 5)
    m = Mesh()
    for s in (-1, 1):
        m += blob((-0.255, 0.787, s * 0.205), (0.17, 0.058, 0.046), n=n, rings=r, e1=0.42, e2=0.38,
                  mat='body:padding')
    m += blob((-0.395, 0.80, 0), (0.035, 0.07, 0.19), n=n, rings=r, e1=0.42, e2=0.42, mat='body:padding')
    return m


# Hoop centre line (right half, back to front). Thin (34 x 28 mm), lower at the front so the
# onboard camera looks over it: the hoop and pillar sit below the road's vanishing point.
HALO_R = [(-0.40, 0.700, 0.268), (-0.37, 0.850, 0.270), (-0.28, 0.945, 0.250), (-0.10, 0.952, 0.226),
          (0.080, 0.930, 0.172), (0.200, 0.910, 0.088), (0.236, 0.905, 0.0)]


def halo(q):
    pts = [(x, y, -z) for x, y, z in HALO_R] + [(x, y, z) for x, y, z in HALO_R[-2::-1]]
    n = seg(14, q, 6)
    hoop = tube(pts, 0.0, n=n, samples=seg(70, q, 14), mat='carbon',
                section=lambda i, t: ellipse(0.017, 0.014, n))
    pillar = strut((0.232, 0.903, 0), (0.432, 0.772, 0), 0.011, 0.026, n=n, mat='carbon', samples=seg(6, q, 3),
                   up=(0, 0, 1))
    return hoop + pillar


MIRROR_C = (0.360, 0.835, 0.600)    # housing centre (right side)


def mirrors(q):
    """Aero mirror pods on stalks over the sidepods; the glass (MirrorGlass) faces the driver."""
    n, r = seg(28, q, 8), seg(12, q, 5)
    m = Mesh()
    for s in (-1, 1):
        cx, cy, cz = MIRROR_C
        cz *= s
        m += blob((cx, cy, cz), (0.032, 0.033, 0.088), n=n, rings=r, e1=0.32, e2=0.36, mat='paint')
        m += strut((cx + 0.004, cy - 0.026, cz), (cx - 0.005, float(sp_yt(cx)) - 0.02, s * 0.585), 0.020, 0.008,
                   n=seg(8, q, 6), mat='carbon', samples=3)
        m += strut((cx + 0.010, cy - 0.004, s * 0.525), (cx + 0.060, cy - 0.065, s * 0.292), 0.018, 0.007,
                   n=seg(8, q, 6), mat='carbon', samples=3)
        g = slab(rounded_rect(0.077, 0.026, 0.010, seg(4, q, 2)), 0.004, axis=0, centre=0.0, mat='mirror', steps=1)
        # outline coords for axis 0 are (y, z): swap so the long side runs along z
        g.V = g.V[:, [0, 2, 1]]
        g.F = [f[::-1] for f in g.F]
        g.orient_outward()
        g.transform(t=(cx - 0.0305, cy, cz))
        m += g
    return m


def column(q):
    a = np.array(WHEEL_CENTRE) + [0.03, 0.005, 0]
    return strut(tuple(a), (0.50, 0.722, 0), 0.016, 0.016, n=seg(10, q, 6), mat='body:metal', samples=3)


# ---------------------------------------------------------------------------------------------
# Bargeboards and turning vanes (right side; mirrored)
# ---------------------------------------------------------------------------------------------

def bargeboards(q):
    m = Mesh()
    nv = seg(30, q, 8)
    for zc, h, x0 in ((0.405, 0.43, 0.97), (0.500, 0.40, 0.93), (0.590, 0.35, 0.88)):
        o = chaikin([(x0, 0.072), (x0 + 0.01, 0.20), (x0 - 0.08, h - 0.02), (x0 - 0.22, h), (x0 - 0.42, h - 0.04),
                     (x0 - 0.47, h - 0.13), (x0 - 0.45, 0.072)], nv, iters=2)
        m += slab(o, 0.006, axis=2, centre=zc, mat='carbon', steps=1)
    # boomerang: a small wing bridging the vane tops
    zz = np.linspace(0.40, 0.60, seg(12, q, 4))
    le = np.stack([np.full_like(zz, 0.79), 0.432 - 0.07 * (zz - 0.40), zz], -1)
    m += wing(le, 0.15, math.radians(10), airfoil(even(seg(18, q, 8)), 0.12, 0.06), mat='carbon')
    return m


# ---------------------------------------------------------------------------------------------
# Floor, plank, fences, edge strakes, diffuser
# ---------------------------------------------------------------------------------------------

FLOOR_R = [(1.08, 0.0), (1.07, 0.20), (0.95, 0.40), (0.75, 0.63), (0.55, 0.835), (0.30, 0.858), (-0.90, 0.858),
           (-1.20, 0.835), (-1.40, 0.690), (-1.52, 0.480), (-1.60, 0.470), (-1.60, 0.0)]


def floor(q):
    right = catmull(FLOOR_R, seg(70, q, 14))
    right[0, 1] = 0.0
    right[-1, 1] = 0.0
    outline = np.vstack([right, right[-2:0:-1] * [1, -1]])
    f = slab(outline, 0.020, axis=1, centre=0.058, mat='carbon', steps=1)
    plank = slab(rounded_rect(1.20, 0.14, 0.05, seg(4, q, 2), cx=-0.25), 0.012, axis=1, centre=0.044,
                 mat='body:satin', steps=1)
    m = f + plank
    race = q < 0.2
    for s in (-1, 1):
        # edge wing along the floor edge
        e = np.array([(0.45, 0.064), (0.30, 0.128), (-0.95, 0.142), (-1.22, 0.112), (-1.25, 0.064)])
        m += slab(chaikin(e, seg(24, q, 8)), 0.009, axis=2, centre=s * 0.853, mat='carbon', steps=1)
        if race:
            continue
        # floor fences under the nose (the leading edge of the ground-effect tunnels)
        for zf in (0.16, 0.25, 0.34, 0.43):
            fo = chaikin([(1.06, 0.050), (0.99, 0.066), (0.60, 0.066), (0.56, 0.030), (0.80, 0.026), (1.02, 0.034)],
                         seg(16, q, 6), iters=2)
            m += slab(fo, 0.006, axis=2, centre=s * zf, mat='carbon', steps=1)
        # edge strakes on top of the floor edge, ahead of the rear tyre
        for xs in (0.05, -0.20, -0.45, -0.70, -0.95):
            so = chaikin([(0.066, 0.70), (0.090, 0.715), (0.105, 0.80), (0.090, 0.852), (0.066, 0.852)],
                         seg(12, q, 5), iters=2)
            m += slab(so * [1, s], 0.006, axis=0, centre=xs, mat='carbon', steps=1)
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

    m = patch_slab(fn, nu, nv, 0.012, mat='carbon')
    fences = (-HZ, -0.36, -0.24, -0.12, 0.0, 0.12, 0.24, 0.36, HZ) if q >= 0.2 else (-HZ, -0.20, 0.20, HZ)
    for zf in fences:
        xs = np.linspace(X0 - 0.05, X1, seg(14, q, 4))
        top = roof_y(xs, zf) + 0.008
        pts = np.vstack([np.stack([xs, top], -1), [[X1, 0.066], [X0 - 0.05, 0.062]]])
        m += slab(pts, 0.007 if abs(zf) < HZ else 0.012, axis=2, centre=zf, mat='carbon', steps=1)
    if q >= 0.2:
        # trailing-edge gurney lip and outer kick-ups
        zz = np.linspace(-HZ, HZ, seg(24, q, 6))
        le = np.stack([np.full_like(zz, X1 + 0.02), roof_y(np.full_like(zz, X1), zz) + 0.004, zz], -1)
        m += wing(le, 0.035, math.radians(55), airfoil(even(seg(12, q, 6)), 0.25, 0.0), mat='carbon')
    return m


# ---------------------------------------------------------------------------------------------
# Front wing: main plane, three flaps, fences, endplates with cut-outs, footplates
# ---------------------------------------------------------------------------------------------

def front_wing(q):
    S = seg(52, q, 10)
    NA = even(seg(22, q, 10))
    sec = airfoil(NA, thickness=0.11, camber=0.055)
    flap = airfoil(NA, thickness=0.10, camber=0.07)
    m = Mesh()
    zs = np.linspace(-0.966, 0.966, S)
    a = np.abs(zs) / 0.966
    neutral = window(np.abs(zs), 0, 0.22, 0.10)
    le = np.stack([2.585 - 0.07 * a ** 2, 0.104 + 0.012 * neutral - 0.006 * a, zs], -1)
    m += wing(le, lambda t: 0.30 - 0.03 * float(window(abs(t * 2 - 1) * 0.966, 0, 0.22, 0.1)),
              lambda t: math.radians(5 + 4 * abs(t * 2 - 1)), sec, mat='carbon')
    flaps = [  # (le x, le y inner, le y outer, chord, aoa deg, material)
        (2.300, 0.162, 0.150, 0.185, 17, 'carbon'),
        (2.165, 0.232, 0.212, 0.160, 29, 'paint'),
        (2.040, 0.312, 0.288, 0.135, 41, 'paint'),
    ]
    Sf = seg(30, q, 8)
    for x0, yi, yo, ch, ao, mat in flaps:
        for s in (-1, 1):
            zz = np.linspace(0.235, 0.966, Sf)
            t = (zz - 0.235) / (0.966 - 0.235)
            le = np.stack([x0 - 0.06 * t ** 2, lerp(yi, yo, t) + 0.025 * (1 - t) ** 3, s * zz], -1)
            if s < 0:
                le = le[::-1]
            m += wing(le, ch, math.radians(ao), flap, mat=mat)
    for s in (-1, 1):
        # inner fence where the flaps start
        fence = chaikin([(2.33, 0.10), (2.30, 0.20), (2.17, 0.29), (2.03, 0.37), (1.96, 0.36), (2.00, 0.30),
                         (2.15, 0.17), (2.25, 0.10)], seg(26, q, 8))
        m += slab(fence, 0.008, axis=2, centre=s * 0.232, mat='carbon', steps=1)
        # endplate with two cut-outs on its trailing edge and a strake slot near the bottom
        ep = chaikin([(2.600, 0.065), (2.600, 0.150), (2.48, 0.215), (2.25, 0.300), (2.02, 0.395),
                      (1.905, 0.405), (1.890, 0.335), (1.950, 0.318), (1.952, 0.268), (1.892, 0.255),
                      (1.895, 0.175), (1.985, 0.160), (1.985, 0.120), (1.905, 0.105), (1.905, 0.090),
                      (2.000, 0.060), (2.300, 0.058)], seg(56, q, 12), iters=2)
        m += slab(ep, 0.012, axis=2, centre=s * 0.972, mat='body:satin', steps=1)
        if q < 0.2:
            continue
        # footplate turning out under the endplate, dive plane on its outer face
        fp = chaikin([(2.585, 0.966), (2.585, 1.022), (2.30, 1.030), (1.98, 1.012), (1.94, 0.966)], seg(18, q, 6),
                     iters=2)
        m += slab(fp[:, :] * [1, s], 0.008, axis=1, centre=0.064, mat='carbon', steps=1)
        dz = np.linspace(0.978, 1.012, 4) * s
        le = np.stack([np.full(4, 2.38), np.full(4, 0.255), dz], -1)
        m += wing(le if s > 0 else le[::-1], 0.10, math.radians(-12), airfoil(even(seg(12, q, 6)), 0.12, 0.04),
                  mat='carbon')
        # fences under the main plane, outboard
        for zf in (0.52, 0.66, 0.80):
            uf = chaikin([(2.57, 0.100), (2.60, 0.072), (2.40, 0.050), (2.28, 0.058), (2.30, 0.092)], seg(12, q, 5),
                         iters=2)
            m += slab(uf, 0.006, axis=2, centre=s * zf, mat='carbon', steps=1)
    return m


# ---------------------------------------------------------------------------------------------
# Rear wing, louvred endplates, two-element beam wing, pylons, DRS pod
# ---------------------------------------------------------------------------------------------

def rear_wing(q):
    S = seg(46, q, 10)
    NA = even(seg(24, q, 10))
    m = Mesh()
    zs = np.linspace(-0.842, 0.842, S)
    a = np.abs(zs) / 0.842
    spoon = 1 - a ** 2
    le = np.stack([-2.318 - 0.012 * spoon, 0.872 - 0.020 * spoon, zs], -1)
    m += wing(le, 0.175, math.radians(7), airfoil(NA, 0.12, 0.06), mat='carbon')
    le = np.stack([-2.455 - 0.006 * spoon, 0.948 - 0.010 * spoon, zs], -1)
    m += wing(le, 0.128, math.radians(30), airfoil(NA, 0.11, 0.07), mat='paint')
    # two-element beam wing between the diffuser fences
    zb = np.linspace(-0.47, 0.47, seg(30, q, 8))
    m += wing(np.stack([np.full_like(zb, -2.200), np.full_like(zb, 0.420), zb], -1), 0.120, math.radians(12),
              airfoil(NA, 0.12, 0.06), mat='carbon')
    if q >= 0.2:
        m += wing(np.stack([np.full_like(zb, -2.300), np.full_like(zb, 0.488), zb], -1), 0.085, math.radians(28),
                  airfoil(NA, 0.11, 0.07), mat='carbon')
    for s in (-1, 1):
        # endplate: a notch at its leading edge filled with louvres
        ep = chaikin([(-2.312, 0.400), (-2.302, 0.540), (-2.378, 0.552), (-2.380, 0.808), (-2.292, 0.818),
                      (-2.240, 0.860), (-2.265, 0.985), (-2.380, 1.035), (-2.560, 1.035), (-2.595, 0.990),
                      (-2.595, 0.560), (-2.520, 0.420), (-2.420, 0.385)], seg(56, q, 12), iters=2)
        m += slab(ep, 0.014, axis=2, centre=s * 0.846, mat='body:satin', steps=1)
        if q >= 0.2:
            for yl in np.linspace(0.585, 0.775, 5):
                lo = rounded_rect(0.046, 0.0055, 0.004, 2, cx=-2.338, cy=yl)
                lo = [(px + 0.35 * (py - yl), py) for px, py in lo]   # raked louvres
                m += slab(np.array(lo), 0.012, axis=2, centre=s * 0.846, mat='carbon', steps=1)
        # beam-wing end fences
        bf = chaikin([(-2.18, 0.37), (-2.17, 0.53), (-2.36, 0.55), (-2.38, 0.38)], seg(16, q, 6))
        m += slab(bf, 0.008, axis=2, centre=s * 0.474, mat='carbon', steps=1)
        # swan-neck pylons (twin, either side of the exhaust)
        py = chaikin([(-2.150, 0.430), (-2.200, 0.600), (-2.330, 0.780), (-2.350, 0.880), (-2.420, 0.880),
                      (-2.400, 0.760), (-2.290, 0.580), (-2.250, 0.430)], seg(30, q, 8))
        m += slab(py, 0.010, axis=2, centre=s * 0.072, mat='carbon', steps=1)
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
            m += strut(a, b, 0.016 if push else 0.026, 0.010 if push else 0.009, n=n, mat='carbon',
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
    np_ = max(12, even(int(round(34 * q))))
    prof = catmull(pts, np_, closed=True)
    # Scale the section about the bead so the crown is exactly R (the spline rounds past its keys).
    rmax = prof[:, 0].max()
    prof[:, 0] = rb + (prof[:, 0] - rb) * (R - rb) / (rmax - rb)
    return revolve(prof, n, mat='tyre', closed_profile=True)


def rim(W, q):
    """Gunmetal forged rim: ten thick swept spokes dished to the hub, polished barrel lip with a
    paint-colour ring, centre-lock nut with drive pins."""
    n = seg4(72, q)
    if q < 0.2:
        return rim_race(W, n)
    wr = W - 0.05
    zo, zi = wr / 2, -wr / 2
    prof = [(0.236, zo - 0.004), (0.236, zo - 0.012), (0.229, zo - 0.017), (0.229, zo - 0.035),
            (0.212, zo - 0.060), (0.212, zi + 0.060), (0.229, zi + 0.035), (0.229, zi + 0.017),
            (0.236, zi + 0.012), (0.236, zi + 0.004), (0.226, zi), (0.200, zi + 0.012), (0.200, zo - 0.030),
            (0.214, zo - 0.008), (0.230, zo)]
    m = revolve(prof, n, mat='rim:alloy', closed_profile=True)
    m += revolve([(0.2272, zo - 0.0025), (0.2368, zo - 0.0025), (0.2368, zo + 0.0030), (0.2272, zo + 0.0030)], n,
                 mat='paint', closed_profile=True)
    ns, nsec = seg(9, q, 5), seg(10, q, 6)
    for k in range(10):
        th0 = k * TAU / 10
        rs = np.linspace(0.060, 0.212, ns)
        th = th0 + math.radians(7) * ((rs - 0.06) / 0.152) ** 1.4
        zz = zo - 0.009 - 0.031 * smoothstep(0.07, 0.205, rs)
        path = np.stack([rs * np.cos(th), rs * np.sin(th), zz], -1)
        m += sweep(path, lambda i, t: ellipse(lerp(0.0130, 0.0098, t), 0.0105, nsec, e=0.6), 'rim:spoke',
                   cap0='flat', cap1='flat', up=(0, 0, 1))
    m += revolve([(0.0, zo - 0.050), (0.074, zo - 0.050), (0.074, zo - 0.016), (0.062, zo - 0.006),
                  (0.0, zo - 0.006)], seg(32, q, 10), mat='rim:alloy')
    m += revolve([(0.0, zo - 0.010), (0.041, zo - 0.010), (0.041, zo + 0.012), (0.034, zo + 0.019),
                  (0.0, zo + 0.019)], 6, mat='rim:nut')
    m += revolve([(0.0, zo + 0.015), (0.018, zo + 0.015), (0.018, zo + 0.025), (0.010, zo + 0.031),
                  (0.0, zo + 0.032)], seg(16, q, 6), mat='rim:alloy')
    for k in range(6):
        a = k * TAU / 6 + TAU / 12
        pin = revolve([(0.0, zo - 0.012), (0.0055, zo - 0.012), (0.0055, zo + 0.002), (0.0, zo + 0.004)],
                      seg(8, q, 6), mat='rim:alloy')
        pin.transform(t=(0.056 * math.cos(a), 0.056 * math.sin(a), 0))
        m += pin
    return m


def rim_race(W, n):
    """Rival LOD rim: barrel and dished face in one revolve, hex nut; the spoke pattern is in its
    vertex colours."""
    wr = W - 0.05
    zo, zi = wr / 2, -wr / 2
    prof = [(0.0, zo - 0.030), (0.205, zo - 0.030), (0.236, zo - 0.004), (0.236, zi + 0.004), (0.200, zi + 0.004),
            (0.0, zi + 0.004)]
    m = revolve(prof, n, mat='rim:alloy')
    nut = [(0.0, zo - 0.032), (0.034, zo - 0.032), (0.034, zo + 0.012), (0.0, zo + 0.012)]
    m += revolve(nut, 6, mat='rim:nut')
    return m


def upright(front, q):
    """Static (steering) side of a wheel: upright, brake drum, ventilated disc, caliper, brake duct.
    Wheel frame, right side; the left one is its mirror."""
    W = WF if front else WR
    hw = W / 2
    m = Mesh()
    zc = -hw + 0.10            # inner part of the rim barrel
    n = seg(44, q, 10)
    disc = [(0.086, zc + 0.016), (0.168, zc + 0.016), (0.168, zc + 0.050), (0.086, zc + 0.050)]
    m += revolve(disc, n, mat='body:disc', closed_profile=True)
    # caliper: a block that straddles the disc at the top rear of the wheel
    if q < 0.2:
        na = 5
        angs = np.radians(np.linspace(100, 150, na))
        path = np.stack([np.cos(angs) * 0.148, np.sin(angs) * 0.148, np.full(na, zc + 0.033)], -1)
        return m + sweep(path, lambda i, t: ellipse(0.036, 0.040, 4, e=0.35), 'body:caliper', cap0='fan', cap1='fan',
                         up=(0, 0, 1))
    drum = [(0.0, zc - 0.065), (0.172, zc - 0.065), (0.176, zc - 0.040), (0.176, zc + 0.008), (0.086, zc + 0.012),
            (0.0, zc + 0.012)]
    m += revolve(drum, n, mat='carbon')
    na = seg(14, q, 5)
    angs = np.radians(np.linspace(100, 150, na))
    path = np.stack([np.cos(angs) * 0.148, np.sin(angs) * 0.148, np.full(na, zc + 0.033)], -1)
    m += sweep(path, lambda i, t: ellipse(0.036, 0.042, seg(12, q, 6), e=0.30), 'body:caliper', cap0='dome',
               cap1='dome', up=(0, 0, 1), dome_depth=0.012, dome_steps=2)
    m += blob((0.0, 0.0, zc - 0.090), (0.055, 0.170, 0.030), n=seg(16, q, 6), rings=seg(10, q, 4), e1=0.55,
              e2=0.6, mat='body:metal')
    if front:
        # brake duct: a carbon scoop with a dark inlet, ahead of the axle
        S, nd = seg(8, q, 4), seg(16, q, 8)
        ang = np.arange(nd) / nd * TAU
        rings = []
        for x in np.linspace(0.23, 0.02, S):
            t = (0.23 - x) / 0.21
            rings.append(np.stack([np.full(nd, x), 0.035 + 0.055 * (1 - 0.35 * t) * spow(np.sin(ang), 0.5),
                                   -hw - 0.052 + 0.030 * (1 - 0.2 * t) * spow(np.cos(ang), 0.5)], -1))
        rr, pole = recess_rings(rings[0], rings[0].mean(0), (1, 0, 0), lip=0.72, depth=0.06, steps=2, lip_round=0.006)
        nr = len(rr)
        m += loft(np.array(rr[::-1] + rings), 'carbon', cap0=pole, cap1='fan',
                  mats=lambda i, j: 'body:inlet' if i < nr - 2 else 'carbon', cap_mat='body:inlet')
    else:
        # rear brake-duct winglets above the axle
        for yy, ch in ((0.140, 0.10), (0.185, 0.08)):
            zz = np.linspace(-hw - 0.095, -hw - 0.012, 4)
            le = np.stack([np.full(4, 0.075), np.full(4, yy), zz], -1)
            m += wing(le, ch, math.radians(14), airfoil(even(seg(12, q, 6)), 0.12, 0.06), mat='carbon')
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
        pad = slab(rounded_rect(0.040, 0.022, 0.010, 2), 0.006, axis=0, centre=0.024, mat='carbon', steps=1)
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

HELMET_C = np.array([-0.200, 0.865, 0.0])
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
    m += blob((-0.285, 0.760, 0), (0.090, 0.040, 0.150), n=seg(24, q, 8), rings=seg(10, q, 4), e1=0.6, e2=0.7,
              mat='driver:suit')
    m += blob((-0.330, 0.590, 0), (0.120, 0.170, 0.190), n=seg(24, q, 8), rings=seg(10, q, 4), e1=0.7, e2=0.7,
              mat='driver:suit')
    na = seg(12, q, 6)
    for s in (-1, 1):
        m += tube([(-0.300, 0.685, s * 0.175), (-0.080, 0.660, s * 0.208), (0.110, 0.690, s * 0.138)], 0.042,
                  n=na, mat='driver:suit', radius_fn=lambda t: lerp(1.0, 0.78, t), samples=seg(14, q, 5))
        m += blob((0.148, 0.700, s * 0.126), (0.046, 0.042, 0.034), n=seg(14, q, 6), rings=seg(8, q, 4), e1=0.7,
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
    switches under the wheel. Added on top of the drive body."""
    m = Mesh()
    pnl = patch_slab(lambda u, v: (np.stack([np.full_like(u, 0.262), lerp(0.53, 0.72, v), lerp(-0.15, 0.15, u)], -1),
                                   np.stack([-np.ones_like(u), np.zeros_like(u), np.zeros_like(u)], -1)),
                     seg(10, q, 4), seg(6, q, 3), 0.012, mat='carbon:satin')
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
# Livery: white accents, race numbers, generic decals, panel lines (painted into the bakes)
# ---------------------------------------------------------------------------------------------

WHITE = (0.80, 0.80, 0.78)


def livery(group, P, N, valid):
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    az = np.abs(z)
    zero = np.zeros(P.shape[:2], np.float32)
    hw = hw_c(x)
    on_chassis = valid & (az < hw + 0.012) & (y > 0.10) & (x > TAIL - 0.01) & (x < NOSE_TIP + 0.06)
    side = lambda s: np.array([0, 0, s], float)

    if group == 'CarPaint':
        dark = zero.copy()
        # panel lines: nose-cone joint, engine-cover split behind the cockpit, sidepod hatch
        dark = np.maximum(dark, lv.line(x - 1.120, 0.0045) * on_chassis)
        dark = np.maximum(dark, lv.line(x + 0.470, 0.0045) * on_chassis * (y > 0.55))
        on_pod = valid & (az > 0.30) & (az < 0.76) & (y > 0.40) & (x < 0.40) & (x > -1.6)
        hatch = (x < 0.12) & (x > -0.72)
        dark = np.maximum(dark, (lv.line(x - 0.12, 0.0045) + lv.line(x + 0.72, 0.0045)) * on_pod * (az < 0.66))
        dark = np.maximum(dark, lv.line(az - 0.47, 0.0045) * on_pod * hatch)
        dark *= 0.55
        # black decals: race number on the nose, name on the engine cover, game name on the
        # sidepods and across the rear wing flap
        num, ring = lv.number_mask(RACE_NUMBER)
        dark = np.maximum(dark, 0.94 * lv.stamp(P, N, valid, num, (1.78, float(top_c(1.78)), 0.0), (0, 0, 1),
                                                (1, 0, 0), 0.15, facing=(0, 1, 0), depth=0.08))
        tm = lv.text_mask('TEMPESTA')
        ao = lv.text_mask('APEX OVERDRIVE')
        for s in (-1, 1):
            dark = np.maximum(dark, 0.92 * lv.stamp(P, N, valid, ao, (-0.30, 0.640, s * 0.555), (s, 0, 0),
                                                    (0, 0, -s), 0.50, facing=(0, 1, 0), min_dot=0.4, depth=0.10))
        flap = valid & (x < -2.44) & (y > 0.93) & (az < 0.84)
        dark = np.maximum(dark, 0.92 * flap * lv.stamp(P, N, valid, ao, (-2.505, 0.985, 0.0), (0, 0, 1),
                                                       (0.87, -0.5, 0), 1.00, facing=(0.5, 0.87, 0), min_dot=0.3,
                                                       depth=0.06))
        return {'shade': 1.0 - np.clip(dark, 0, 0.95)}

    if group == 'Body':
        layers = []
        y1, y2 = chassis_breaks(x)
        # white pinstripe just under the paint line, nose tip number board
        pin = lv.band(y2 - y, 0.007, 0.021, 0.002) * on_chassis * (x < NOSE_BAND) * (x > -0.45) * (az > hw - 0.035)
        layers.append((pin, WHITE, 0.24))
        zo, zi = sp_zo(x), hw - 0.05
        crest = zo - 0.30 * (zo - zi)
        on_pod = valid & (x < SP_X[0] - 0.02) & (x > SP_X[1] + 0.1) & (y > sp_ye(x) + 0.01) & (az > zi + 0.05)
        layers.append((lv.band(crest - az, 0.028, 0.040, 0.003) * on_pod, WHITE, 0.24))
        layers.append((lv.band(x - ENGINE_CUT, -0.030, -0.018, 0.003) * on_chassis * (y > 0.5) * (az > 0.05), WHITE,
                       0.24))
        tip = on_chassis * (x > NOSE_BAND - 0.002) * (az < 0.09)
        layers.append((tip, WHITE, 0.24))
        num, ring = lv.number_mask(RACE_NUMBER)
        layers.append((lv.stamp(P, N, valid, num, (2.43, float(top_c(2.43)), 0.0), (0, 0, 1), (1, 0, 0), 0.09, facing=(0, 1, 0),
                                min_dot=0.2, depth=0.06) * tip, (0.02, 0.02, 0.022), 0.3))
        # shark fin: white race number both sides, white top edge
        on_fin = valid & (az < 0.008) & (x < -0.88) & (x > -2.12) & (y > 0.48)
        for s in (-1, 1):
            layers.append((lv.stamp(P, N, valid, num, (-1.50, 0.88, 0.0), (s, 0, 0), (0, 1, 0), 0.20, facing=side(s),
                                    min_dot=0.5, depth=0.02) * on_fin, WHITE, 0.24))
        fin_top = Curve([(-0.90, 1.015), (-1.25, 1.030), (-1.65, 0.985), (-2.00, 0.890), (-2.09, 0.815)])
        layers.append((lv.band(fin_top(x) - y, -0.01, 0.025, 0.003) * on_fin, WHITE, 0.24))
        # front wing endplates: white diagonal stripe and the game name
        fep = valid & (az > 0.955) & (az < 0.99) & (x > 1.87) & (y < 0.42) & (y > 0.05)
        diag = (x - 2.0) + 0.9 * (y - 0.10)
        layers.append((lv.band(diag, 0.16, 0.215, 0.004) * fep, WHITE, 0.24))
        ap = lv.text_mask('APEX')
        for s in (-1, 1):
            layers.append((lv.stamp(P, N, valid, ap, (2.30, 0.150, s * 0.972), (s, 0, 0), (0, 1, 0), 0.17,
                                    facing=side(s), min_dot=0.5, depth=0.02) * fep, WHITE, 0.24))
        # engine cover: car name in white on the satin black
        tm = lv.text_mask('TEMPESTA')
        for s in (-1, 1):
            layers.append((lv.stamp(P, N, valid, tm, (-1.08, 0.735, s * 0.17), (s, 0, 0), (0, 1, 0), 0.40,
                                    facing=side(s), min_dot=0.35, depth=0.09) * on_chassis, WHITE, 0.24))
        # rear wing endplates: name in two lines, white top band
        rep = valid & (az > 0.83) & (az < 0.865) & (x < -2.22) & (y > 0.37)
        od = lv.text_mask('OVERDRIVE')
        for s in (-1, 1):
            layers.append((lv.stamp(P, N, valid, ap, (-2.475, 0.735, s * 0.846), (s, 0, 0), (0, 1, 0), 0.20,
                                    facing=side(s), min_dot=0.5, depth=0.02) * rep, WHITE, 0.24))
            layers.append((lv.stamp(P, N, valid, od, (-2.475, 0.650, s * 0.846), (s, 0, 0), (0, 1, 0), 0.22,
                                    facing=side(s), min_dot=0.5, depth=0.02) * rep, WHITE, 0.24))
        layers.append((lv.band(y, 0.990, 1.05, 0.004) * rep, WHITE, 0.24))
        return {'layers': layers}
    return {}


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
    if q >= 0.2:
        bb = bargeboards(q)
        body += bb + bb.mirrored_z()
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
