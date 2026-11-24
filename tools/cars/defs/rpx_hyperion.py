"""Hyperion (rpx-hyperion): the top-speed flagship, a mid-engine hypercar, 4.70 m. Batch 2.

An original design with the character of the current Hyperion: a very low, wide hypercar in
champagne gold over a black carbon lower body, with a sharp nose between two raised wing pods
carrying thin LED blades, big black intakes and a wide splitter, a teardrop canopy cabin set
between deeply scooped flanks (a black channel runs from behind the front wheels to the rear
intakes), a long low engine deck with louvres, a tall swan-neck rear wing on two pylons, a full-
width LED tail blade over a huge diffuser with two high exhausts, and black ten-spoke centre-lock
style wheels with gold callipers. The cockpit is a hypercar's: a low carbon tub, a squared
racing wheel with its own display, a slim cluster, alcantara buckets. No real manufacturer's
shapes, badges or names.

It inherits the Monza (Vanta, Ridgeback, Kestrel, Aurelia).

Measured from the shipped model (public/assets/models/rpx_hyperion.glb at 4.70 m): front axle
x +1.302, rear -1.313 (wheelbase 2.615 m), tyre radius 0.339 / 0.354 m, half-track 0.834 /
0.801 m.
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from inherit import inherit  # noqa: E402

inherit('mz_monza', globals())
_monza_build, _monza_bumpers = build, bumpers

import livery as lv  # noqa: E402
from meshkit import (Curve, Mesh, blob, catmull, ellipse, lerp, loft, norm, patch_slab, revolve, rot,  # noqa: E402
                     rounded_rect, slab, smoothstep, strut, sweep, tube, window, TAU)

ID = 'rpx-hyperion'
FILE = 'rpx_hyperion'
LENGTH = 4.70

XF, XR = 1.302, -1.313
RF, RR = 0.339, 0.354
TF, TR = 0.834, 0.801
WF, WR = 0.275, 0.335
RIM_R = 0.2413                  # 19-inch front, the rear tyre taller
NOSE, TAIL = 2.350, -2.350
DRIVER_Z = -0.330
KDY = -0.200
EYE = (-0.180, 0.900, DRIVER_Z)
WHEEL_CENTRE = (0.180, 0.680, DRIVER_Z)
WHEEL_TILT = math.radians(20)
FACTORY_PAINT = (0.40, 0.28, 0.10)     # linear RGB: champagne gold
ACCENT = (0.75, 0.55, 0.20)
CALIPER = (0.75, 0.55, 0.18)           # gold callipers
LEATHER = (0.032, 0.032, 0.035)
TYRE_WORDS = ['APEX OVERDRIVE', 'HYPERION', 'APEX OVERDRIVE', 'HYPERION']
TYRE_HW = WF / 2
TYRE_TEXT_R = (0.052, 0.018)
GLOVE = (0.52, 0.52, 0.54)             # light grey race gloves
RIM_TUBE = 0.0150
RIM_PAINT = (0.035, 0.036, 0.040)      # black wheels
SPOKES, SPOKE_TWIST, SPOKE_PAIR, SPOKE_W, SPOKE_MAT, AERO_RING = 10, 0.30, 0.0, (0.020, 0.010), 'rim:paint', False
GAUGES = [
    {'label': 'KM/H', 'max': 420, 'ticks': 14, 'needle': 0.10},
    {'label': 'RPM x1000', 'max': 10, 'ticks': 10, 'needle': 0.10},
    {'label': 'OIL', 'max': 150, 'ticks': 4, 'needle': 0.55},
    {'label': 'WATER', 'max': 130, 'ticks': 4, 'needle': 0.45},
]

# ---------------------------------------------------------------------------------------------
# Body blueprint: very low, the canopy cabin narrow over wide wings and haunches
# ---------------------------------------------------------------------------------------------

yb_c = Curve([(2.30, 0.150), (2.18, 0.095), (1.96, 0.075), (1.60, 0.072), (0.00, 0.072), (-1.60, 0.078),
              (-1.96, 0.110), (-2.16, 0.170), (-2.30, 0.230)])
hw_c = Curve([(2.30, 0.500), (2.22, 0.720), (2.10, 0.880), (1.92, 0.968), (1.65, 0.995), (1.30, 0.998),
              (0.95, 0.975), (0.40, 0.940), (-0.20, 0.950), (-0.70, 0.990), (-1.10, 1.010), (-1.45, 1.004),
              (-1.80, 0.975), (-2.05, 0.915), (-2.22, 0.830), (-2.30, 0.740)])
ymx_c = Curve([(2.30, 0.260), (1.80, 0.330), (1.00, 0.360), (0.00, 0.340), (-1.00, 0.420), (-1.80, 0.440),
               (-2.30, 0.440)])
ysh_c = Curve([(2.30, 0.330), (2.20, 0.420), (2.06, 0.540), (1.85, 0.635), (1.60, 0.690), (1.30, 0.700),
               (1.00, 0.690), (0.60, 0.650), (0.00, 0.640), (-0.50, 0.690), (-0.90, 0.760), (-1.30, 0.790),
               (-1.70, 0.786), (-2.00, 0.770), (-2.22, 0.760), (-2.30, 0.740)])
shd_c = Curve([(2.30, 0.050), (1.60, 0.090), (0.80, 0.120), (0.00, 0.130), (-1.00, 0.120), (-2.30, 0.070)])
top_c = Curve([(2.30, 0.270), (2.22, 0.320), (2.10, 0.390), (1.90, 0.460), (1.70, 0.520), (1.50, 0.566),
               (1.30, 0.605), (1.12, 0.620), (1.06, 0.626), (0.98, 0.700), (-0.70, 0.700), (-0.80, 0.960),
               (-1.00, 0.930), (-1.30, 0.880), (-1.60, 0.836), (-1.90, 0.800), (-2.10, 0.790), (-2.22, 0.800),
               (-2.30, 0.796)])

CABIN = (-0.700, 0.980)
TUB_FLOOR = 0.100
ci_c = Curve([(0.98, 0.640), (-0.70, 0.640)])
ZWELL = 0.640
ARCH = [(XF, RF + 0.006, RF + 0.030), (XR, RR + 0.006, RR + 0.032)]
FACE_X = 2.200
FACE_D = 0.070
MOUTH = (0.190, 0.420, 0.070)
MOUTH_E = (0.16, 0.30)
MOUTH_DROOP = -0.010
BULGE = -0.045
BULGE_W = 0.260
ROW_Z = (0.10, 0.300, 0.500)
STATION_XS = (-2.30, -2.24, -2.16, -2.06, -1.94, -0.92, -0.80, -0.55, -0.30, 0.00, 0.30, 0.55, 0.78, 0.98, 1.75, 1.92,
              2.04, 2.12)
TAIL_TURN = (0.050, 0.90)
SIDE_CREASE = 1.0


def bulge_w(x):
    return float(window(x, 1.10, 2.12, 0.30))


def tip_shift(x, z, y=0.0):
    z = np.abs(z)
    y = np.asarray(y, dtype=np.float64)
    rake = smoothstep(1.85, 2.30, x) * np.clip((y - 0.18) / 0.25, 0, 1) ** 1.2
    tuck = smoothstep(-1.90, -2.30, x) * np.clip((y - 0.35) / 0.40, 0, 1)
    return (0.040 * smoothstep(2.00, FACE_X, x) * smoothstep(0.55, 0.85, z) - 0.110 * rake
            - 0.020 * smoothstep(-2.14, -2.30, x) * smoothstep(0.55, 0.80, z) + 0.110 * tuck)


def gb_c(x):
    """The canopy sits narrow between the wings: the belt is well inboard of the shoulders."""
    return float(Curve([(1.06, 0.560), (0.90, 0.640), (0.50, 0.700), (0.00, 0.712), (-0.40, 0.700), (-0.70, 0.660),
                        (-0.86, 0.580), (-0.95, 0.520)])(x))


# ---------------------------------------------------------------------------------------------
# Greenhouse: a teardrop canopy, a long raked windscreen, the roof falling into a short engine
# glass between buttresses
# ---------------------------------------------------------------------------------------------

yr_c = Curve([(1.060, 0.628), (0.90, 0.712), (0.70, 0.812), (0.50, 0.906), (0.30, 0.990), (0.15, 1.044),
              (0.00, 1.088), (-0.20, 1.108), (-0.40, 1.100), (-0.58, 1.064), (-0.72, 1.010), (-0.84, 0.962),
              (-0.92, 0.940), (-0.95, 0.934)])
GH_X = (-0.950, 1.060)
A_TOP, A_BASE = 0.020, 1.056
B_X = -0.400
C_TOP, C_BASE = -0.480, -0.700
RW = (-0.900, -0.640, 0.330)
WIN_X = 0.10
CANT_K, TUMBLE, ROOF_E, ROOF_ZE, SIDE_BOW = 0.72, 0.46, 0.90, 1.0, 0.016
MIRROR_BASE = 0.860
DOORS = (1.010, -0.520)

# ---------------------------------------------------------------------------------------------
# Front and flanks
# ---------------------------------------------------------------------------------------------

LAMP_Z, LAMP_HW, LAMP_HH, LAMP_Y = 0.690, 0.200, 0.036, 0.400
INTAKE_Y = (0.110, 0.300)
LIP_Y = 0.270


def bumpers(q):
    """Wide splitter, sill blades, a huge diffuser with six tall fins."""
    m = Mesh()
    zs = [0.0, 0.25, 0.45, 0.60, 0.72, 0.82, 0.90]
    fpath = _bumper_path(nose_hit, 0.110, 1, zs, 0.030)
    fpath = [(fpath[0][0] - 0.30, fpath[0][1] * 1.08)] + fpath + [(fpath[-1][0] - 0.30, fpath[-1][1] * 1.08)]
    m += blade(fpath, 0.090, 0.012, 0.080, q, mat='body:gloss')
    rzs = [0.0, 0.25, 0.45, 0.60, 0.72, 0.80]
    rpath = _bumper_path(tail_hit, 0.230, -1, rzs, 0.004)
    rpath = [(rpath[0][0] + 0.20, rpath[0][1] * 1.06)] + rpath + [(rpath[-1][0] + 0.20, rpath[-1][1] * 1.06)]
    m += blade(rpath, 0.200, 0.110, 0.030, q, mat='body:gloss')
    if q >= 0.2:
        p, nrm = tail_hit(0.220, 0.0)
        for z in (-0.62, -0.42, -0.22, 0.22, 0.42, 0.62):
            m += slab(rounded_rect(0.200, 0.090, 0.012, 1), 0.010, axis=2, centre=0.0, mat='body:gloss',
                      steps=1).transform(t=(p[0] + 0.14, 0.170, z))
    for s in (-1, 1):
        x0, x1 = XF - ARCH[0][2] - 0.02, XR + ARCH[1][2] + 0.02
        pts = []
        for x in np.linspace(x1, x0, seg(10, q, 4)):
            y = float(yb_c(x)) + 0.030
            pts.append((x, y, s * (surf_z(x, y) + 0.030)))
        m += sweep(np.array(pts), lambda i, t: ellipse(0.032, 0.010, seg(6, q, 4), e=0.6), 'body:gloss',
                   cap0='flat', cap1='flat', up=(0, 1, 0))
    return m


def side_intakes(q):
    """The black channel along each flank: from behind the front wheel it deepens back to the
    big intake in front of the rear wheel."""
    m = Mesh()
    for s in (-1, 1):
        def fn(u, v, s=s):
            x = 0.900 - 1.880 * u
            h = 0.060 + 0.260 * smoothstep(0.15, 1.0, u) ** 1.5
            y0 = 0.200 + 0.020 * u
            y = y0 + h * v
            z = np.vectorize(lambda a, b: surf_z(a, b))(x, y) - 0.002
            P = np.stack([x, y, s * z], -1)
            Nn = np.zeros_like(P)
            Nn[..., 2] = s
            return P, Nn
        m += patch_slab(fn, seg(16, q, 5), seg(4, q, 2), 0.012, mat='body:well')
    return m


def roof_spoiler(q):
    """The swan-neck rear wing: an airfoil on two pylons hanging from its top, with end plates;
    louvres on the engine deck."""
    m = Mesh()
    lo = q < 0.1
    xw, yw, span, chord = -2.16, 1.000, 0.800, 0.300
    n = 4 if lo else seg(10, q, 5)
    foil = [(0.0, 0.0), (0.06, 0.020), (0.16, 0.026), (0.26, 0.016), (0.30, 0.004), (0.24, -0.004), (0.12, -0.006),
            (0.03, -0.004)]
    if lo:
        foil = [(0.0, 0.0), (0.16, 0.026), (0.30, 0.004), (0.12, -0.006)]
    rings = []
    for z in np.linspace(-span, span, 3 if lo else 9):
        dy = 0.020 * (abs(z) / span) ** 2
        rings.append([(xw + chord / 2 - c * math.cos(0.12) - 0.0, yw + dy + t + c * math.sin(0.12), z)
                      for c, t in foil])
    m += loft(np.array(rings), 'body:gloss', cap0='flat', cap1='flat').orient_outward()
    for s in (-1, 1):
        # end plates
        m += slab(rounded_rect(0.190, 0.090, 0.030, 1 if lo else seg(3, q, 2), cx=xw, cy=yw - 0.010), 0.010, axis=2,
                  centre=s * (span + 0.005), mat='body:gloss', steps=1)
        # swan-neck pylon from the deck up and over to the wing's top
        base = np.array([-1.86, float(crown(-1.86, 0.36)), s * 0.36])
        pts = [base, base + [-0.10, 0.12, 0], np.array([xw + 0.06, yw + 0.080, s * 0.36]),
               np.array([xw + 0.02, yw + 0.030, s * 0.36])]
        P = catmull(pts, 4 if lo else seg(10, q, 5))
        m += sweep(P, lambda i, t: ellipse(0.040 - 0.012 * t, 0.008, 4 if lo else seg(6, q, 4), e=0.5), 'body:gloss',
                   cap0='flat', cap1='flat', up=(0, 0, 1))
    if q >= 0.2:
        for k in range(seg(6, q, 3)):
            x = -1.05 - k * 0.080
            y = float(crown(x, 0.0)) + 0.004
            m += slab(rounded_rect(0.012, 0.300, 0.004, 1), 0.006, axis=1, centre=y, mat='body:gloss',
                      steps=1).transform(t=(x, 0, 0))
    return m


TAIL_Y = 0.700


def tail_lamps(q):
    body, lens = _vanta_tail(q)
    b2, l2 = _tail_band(q)
    body += b2
    lens += l2
    if q < 0.2:
        return body, lens
    def fn(u, v):
        z = (u - 0.5) * 2 * 0.66
        y = 0.290 + 0.200 * v
        x = np.vectorize(lambda a, b: float(tail_hit(a, b)[0][0]))(y, z) - 0.002
        P = np.stack([x, y, z], -1)
        Nn = np.zeros_like(P)
        Nn[..., 0] = -1
        return P, Nn
    body += patch_slab(fn, seg(10, q, 3), seg(4, q, 2), 0.006, mat='body:gloss')
    return body, lens


def boot_plate(q):
    if q < 0.2:
        return Mesh()
    p, nrm = tail_hit(0.450, 0.0)
    R = frame_from(nrm)
    return placed(slab(rounded_rect(0.230, 0.058, 0.008, seg(3, q, 2)), 0.006, axis=2, centre=0.006,
                       mat='body:rubber', steps=1), R, p)


def exhaust(q):
    """Two hexagonal-section tailpipes high in the tail panel."""
    m = Mesh()
    n = 6
    p, _ = tail_hit(0.620, 0.0)
    for z in (-0.090, 0.090):
        pipe = revolve([(0.040, 0.0), (0.042, -0.100), (0.044, -0.110), (0.044, -0.120), (0.034, -0.120),
                        (0.032, -0.010)], n, mat='body:steel', axis='x', closed_profile=True)
        pipe.transform(t=(p[0] + 0.100, 0.600, z))
        m += pipe
    return m


def engine(q):
    m = Mesh()
    for z in (-0.16, 0.16):
        m += blob((-0.82, float(crown(-0.82, 0.0)) - 0.020, z), (0.100, 0.026, 0.070), n=seg(14, q, 6),
                  rings=seg(6, q, 3), e1=0.4, e2=0.4, mat='body:accent')
    return m


def fuel_filler(q):
    return Mesh()


# ---------------------------------------------------------------------------------------------
# Cabin: a low carbon tub, a slim cluster, a squared racing wheel with its own display
# ---------------------------------------------------------------------------------------------

DASH = [(1.000, 0.800 + KDY), (0.800, 0.870 + KDY), (0.600, 0.905 + KDY), (0.480, 0.912 + KDY),
        (0.432, 0.900 + KDY), (0.412, 0.870 + KDY), (0.410, 0.720 + KDY), (0.440, 0.640 + KDY), (1.000, 0.640 + KDY)]
GAUGE_POS = [(0.868 + KDY, -0.440, 0.036), (0.868 + KDY, -0.300, 0.036), (0.868 + KDY, -0.510, 0.016),
             (0.868 + KDY, -0.230, 0.016)]
SCREEN = (0.452, 0.860 + KDY, 0.020, 0.080, 0.050)
HELMET_C = np.array([-0.380, 0.905, DRIVER_Z])
GLOW_C = np.array([0.36, 0.86 + KDY, DRIVER_Z * 0.6])
WHEEL_R = 0.170


def console(q):
    m = Mesh()
    m += blob((0.00, 0.400 + KDY, 0.0), (0.560, 0.130, 0.090), n=seg(16, q, 6), rings=seg(8, q, 4), e1=0.25,
              e2=0.30, mat='carbon:satin')
    return m


def steering_wheel(q):
    """Squared racing wheel: the rim flattened top and bottom, two wide grips, a carbon centre
    plate carrying a small display and switches, a red twelve o'clock band."""
    m = Mesh()
    n = seg(56, q, 10)
    ang = np.arange(n) / n * TAU
    sn = np.sin(ang)
    rr = WHEEL_R * (1 - 0.16 * np.clip(-sn, 0, 1) ** 4 - 0.10 * np.clip(sn, 0, 1) ** 6)
    path = np.stack([np.zeros(n), rr * sn, rr * np.cos(ang)], -1)
    m += sweep(path, lambda i, t: ellipse(0.0135, 0.0150, seg(10, q, 4)), 'int:leather', closed=True, up=(1, 0, 0))
    if q < 0.1:
        return m + revolve([(0.0, 0.0), (0.055, 0.0), (0.055, 0.045), (0.0, 0.05)], 8, mat='int:dash', axis='x')
    plate = slab(rounded_rect(0.070, 0.120, 0.024, seg(4, q, 2)), 0.016, axis=0, centre=0.030, mat='carbon:satin',
                 steps=1)
    m += plate.transform(t=(0, -0.010, 0))
    m += slab(rounded_rect(0.026, 0.044, 0.004, 2), 0.003, axis=0, centre=0.020, mat='int:screen',
              steps=1).transform(t=(0, 0.010, 0))
    for a in (0.0, math.pi):
        d = np.array([0.0, 0.0, math.cos(a)])
        pts = [d * 0.110 + [0.030, -0.010, 0], d * (WHEEL_R - 0.006) + [0, -0.004, 0]]
        m += sweep(catmull(pts, 4), lambda i, t: ellipse(0.008, 0.026, seg(8, q, 4), e=0.5), 'carbon:satin',
                   up=(0, 1, 0), cap0='flat', cap1='flat')
        if q >= 0.6:
            for k in range(2):
                m += revolve([(0.0, 0.0), (0.008, 0.0), (0.008, 0.006), (0.0, 0.007)], 10, mat='int:metal',
                             axis='x').transform(t=(0.020, -0.040 + k * 0.025, d[2] * 0.090))
    if q >= 0.2:
        k = 8
        a = np.linspace(math.pi / 2 - 0.08, math.pi / 2 + 0.08, k)
        r = WHEEL_R * (1 - 0.10 * np.clip(np.sin(a), 0, 1) ** 6)
        p2 = np.stack([np.zeros(k), r * np.sin(a), r * np.cos(a)], -1)
        m += sweep(p2, lambda i, t: ellipse(0.0140, 0.0155, seg(10, q, 4)), 'body:accent', up=(1, 0, 0),
                   cap0='flat', cap1='flat')
    return m


# ---------------------------------------------------------------------------------------------
# Livery: panel gaps; a two-tone body (black carbon-look lower body below a line sweeping up
# toward the tail); a dark centre stripe over the nose; the name on the tail (Body)
# ---------------------------------------------------------------------------------------------

def livery(group, P, N, valid):
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    az = np.abs(z)
    zero = np.zeros(P.shape[:2], np.float32)
    if group == 'CarPaint':
        g = zero.copy()
        W = 0.0035
        side = valid & (np.abs(N[..., 2]) > 0.35)
        top = valid & (N[..., 1] > 0.30)
        yb = np.vectorize(lambda v: float(yb_c(v)))(x)
        belt = np.vectorize(lambda v: float(crown(v, gb_c(np.clip(v, GH_X[0], GH_X[1])))))(x)
        for xd in DOORS:
            g = np.maximum(g, lv.line(x - xd, W) * side * (y > yb + 0.08) * (y < belt + 0.01))
        g = np.maximum(g, lv.line(x - 1.200, W) * top * (az < 0.62))
        shade = 1.0 - 0.62 * np.clip(g, 0, 1)
        dark = zero.copy()
        # lower body: below a line rising from the nose to the haunch
        line_y = 0.300 + 0.120 * np.clip((1.80 - x) / 3.40, 0, 1)
        dark = np.maximum(dark, 0.92 * np.clip((line_y - y) / 0.008, 0, 1) * valid * (np.abs(N[..., 1]) < 0.85))
        dark = np.maximum(dark, 0.85 * lv.band(az, -1, 0.090, 0.003) * top * (x > 1.06))
        shade = shade * (1 - np.clip(dark, 0, 0.95))
        return {'shade': shade}
    if group == 'Body':
        layers = []
        p, nrm = tail_hit(0.400, 0.0)
        layers.append((lv.stamp(P, N, valid, lv.text_mask('HYPERION', oblique=False), (fx(p[0]) - 0.010, 0.400, 0.0),
                                (0, 0, 1), (0, 1, 0), 0.34, facing=(-1, 0, 0), min_dot=0.3, depth=0.10),
                       (0.75, 0.62, 0.38), 0.3))
        return {'layers': layers}
    return {}


RENDER_VIEWS = {
    'gt_lights': ((3.30, 0.80, 1.50), (2.20, 0.40, 0.60), 45),
    'gt_grille': ((3.80, 0.50, 0.55), (2.25, 0.22, 0.0), 48),
    'gt_wheel': ((2.35, 0.52, 2.00), (1.30, 0.34, 0.92), 62),
    'gt_tail': ((-3.60, 1.20, 1.60), (-2.25, 0.70, 0.40), 45),
    'gt_interior': ((0.25, 1.35, 2.10), (-0.20, 0.75, 0.0), 40),
    'gt_window': ((0.70, 1.00, 3.00), (0.20, 0.82, 0.0), 38),
}

META = make_meta()
