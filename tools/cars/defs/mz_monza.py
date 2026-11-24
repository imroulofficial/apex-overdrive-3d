"""Monza (mz-monza): the cornering specialist, a mid-engine two-seat supercar, 4.65 m. Batch 2.

An original design with the character of the current Monza: a low, wide mid-engine coupe in deep
red, with a short, sharp nose that falls steeply between raised front wings carrying slim angled
LED headlamps, a black splitter under three big intakes, a long raked windscreen running into a
short cabin, deep side intakes behind the doors fed by a sculpted scallop, flying buttresses
beside a small vertical rear window over a louvred engine cover, a ducktail with a carbon lip,
slim LED tail lamps on a black tail panel, a big diffuser with two centre exhausts, and dark
ten-spoke wheels with yellow callipers. The cockpit is a supercar's: a hooded digital cluster, a
small centre screen, a high carbon console, black alcantara buckets and a flat-bottomed wheel
with a red twelve o'clock mark. No real manufacturer's shapes, badges or names.

It inherits the Vanta (Ridgeback, Kestrel, Aurelia): subdivision-cage body, canopy glass with
sliding windows, ray hits, modern cabin pieces, hands, cockpit machinery, configurable wheels.

Measured from the shipped model (public/assets/models/mz_monza.glb at 4.65 m): front axle x +1.221,
rear -1.404 (wheelbase 2.625 m), tyre radius 0.376 / 0.381 m, half-track 0.895 / 0.847 m.
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from inherit import inherit  # noqa: E402

inherit('rp1_vanta', globals())
_vanta_wheel, _vanta_tail, _vanta_build = steering_wheel, tail_lamps, build

import livery as lv  # noqa: E402
from meshkit import (Curve, Mesh, blob, catmull, ellipse, lerp, loft, norm, patch_slab, revolve, rot,  # noqa: E402
                     rounded_rect, slab, smoothstep, strut, sweep, tube, window, TAU)

ID = 'mz-monza'
FILE = 'mz_monza'
LENGTH = 4.65

XF, XR = 1.221, -1.404
RF, RR = 0.376, 0.381
TF, TR = 0.895, 0.847
WF, WR = 0.265, 0.320
RIM_R = 0.2540                  # 20-inch wheels, low sidewalls
NOSE, TAIL = 2.325, -2.325
DRIVER_Z = -0.380
KDY = -0.040                    # the seat sits 4 cm lower than the Aurelia's
EYE = (-0.200, 1.060, DRIVER_Z)
WHEEL_CENTRE = (0.160, 0.835, DRIVER_Z)
WHEEL_TILT = math.radians(24)
FACTORY_PAINT = (0.42, 0.018, 0.016)   # linear RGB: deep red
ACCENT = (0.90, 0.62, 0.04)
CALIPER = (0.90, 0.62, 0.04)           # yellow callipers
LEATHER = (0.030, 0.030, 0.032)        # black alcantara
TYRE_WORDS = ['APEX OVERDRIVE', 'MONZA CORSA', 'APEX OVERDRIVE', 'MONZA CORSA']
TYRE_HW = WF / 2
TYRE_TEXT_R = (0.062, 0.020)
GLOVE = (0.36, 0.20, 0.095)            # tan leather gloves against the black wheel
RIM_TUBE = 0.0150
HEADLINER = (0.035, 0.035, 0.037)
METAL = (0.50, 0.51, 0.53)
RIM_PAINT = (0.055, 0.056, 0.060)      # dark graphite ten-spoke wheels
B_MAT = 'body:gloss'
TRIM_MAT = 'body:gloss'
SPOKES, SPOKE_TWIST, SPOKE_PAIR, SPOKE_W, SPOKE_MAT, AERO_RING = 10, 0.10, 0.20, (0.015, 0.012), 'rim:paint', False
GAUGES = [
    {'label': 'KM/H', 'max': 340, 'ticks': 12, 'needle': 0.12},
    {'label': 'RPM x1000', 'max': 10, 'ticks': 10, 'needle': 0.10},
    {'label': 'OIL', 'max': 150, 'ticks': 4, 'needle': 0.55},
    {'label': 'WATER', 'max': 130, 'ticks': 4, 'needle': 0.45},
]

# ---------------------------------------------------------------------------------------------
# Body blueprint: low, wide, cab-forward; a long engine deck behind the cabin
# ---------------------------------------------------------------------------------------------

yb_c = Curve([(2.28, 0.260), (2.16, 0.180), (1.96, 0.150), (1.60, 0.142), (0.00, 0.140), (-1.60, 0.142),
              (-1.96, 0.170), (-2.16, 0.230), (-2.28, 0.300)])
hw_c = Curve([(2.28, 0.500), (2.20, 0.720), (2.08, 0.870), (1.90, 0.965), (1.60, 1.012), (1.25, 1.024),
              (0.90, 1.004), (0.40, 0.975), (-0.30, 0.985), (-0.80, 1.020), (-1.20, 1.040), (-1.55, 1.036),
              (-1.85, 1.000), (-2.05, 0.940), (-2.20, 0.860), (-2.28, 0.780)])
ymx_c = Curve([(2.28, 0.360), (1.80, 0.440), (1.00, 0.480), (0.00, 0.470), (-1.00, 0.540), (-1.80, 0.560),
               (-2.28, 0.560)])
# the front wings stand proud of the bonnet; the shoulder rises over the rear wheels
ysh_c = Curve([(2.28, 0.480), (2.18, 0.580), (2.04, 0.672), (1.80, 0.752), (1.50, 0.800), (1.20, 0.828),
               (0.90, 0.830), (0.50, 0.812), (0.00, 0.808), (-0.50, 0.840), (-0.90, 0.900), (-1.30, 0.930),
               (-1.70, 0.912), (-2.00, 0.880), (-2.20, 0.860), (-2.28, 0.840)])
shd_c = Curve([(2.28, 0.050), (1.60, 0.090), (0.80, 0.110), (0.00, 0.120), (-1.00, 0.110), (-2.28, 0.070)])
# centre line: a sharp, low nose; the bonnet falls between the wings; the engine deck and ducktail
top_c = Curve([(2.28, 0.400), (2.20, 0.470), (2.08, 0.550), (1.90, 0.640), (1.70, 0.718), (1.50, 0.760),
               (1.30, 0.792), (1.12, 0.812), (1.04, 0.820), (0.95, 0.900), (-0.80, 0.900), (-0.90, 1.150),
               (-1.10, 1.128), (-1.40, 1.080), (-1.70, 1.004), (-1.95, 0.952), (-2.10, 0.936), (-2.20, 0.948),
               (-2.26, 0.960), (-2.28, 0.954)])

CABIN = (-0.800, 0.950)
TUB_FLOOR = 0.200
ci_c = Curve([(0.95, 0.720), (-0.80, 0.720)])
ZWELL = 0.660
ARCH = [(XF, RF + 0.008, RF + 0.032), (XR, RR + 0.008, RR + 0.034)]
FACE_X = 2.180
FACE_D = 0.070
MOUTH = (0.285, 0.480, 0.095)   # the centre intake
MOUTH_E = (0.16, 0.30)
MOUTH_DROOP = -0.010
BULGE = -0.026                  # the bonnet sits in a shallow valley between the wings
BULGE_W = 0.300
ROW_Z = (0.10, 0.320, 0.520)
STATION_XS = (-2.28, -2.22, -2.14, -2.04, -1.92, -1.00, -0.88, -0.60, -0.30, 0.00, 0.30, 0.55, 0.75, 0.95, 1.70, 1.90,
              2.02, 2.10)
TAIL_TURN = (0.050, 0.90)
ROW_IN = (0.080, 0.035, 0.010)
SIDE_CREASE = 1.0
OVERHANG = 1.95


def bulge_w(x):
    return float(window(x, 1.05, 2.10, 0.30))


def crown_e(x):
    return 2.4


def tip_shift(x, z, y=0.0):
    z = np.abs(z)
    y = np.asarray(y, dtype=np.float64)
    rake = smoothstep(1.80, 2.28, x) * np.clip((y - 0.30) / 0.30, 0, 1) ** 1.2
    tuck = smoothstep(-1.85, -2.28, x) * np.clip((y - 0.45) / 0.45, 0, 1)
    return (0.030 * smoothstep(2.00, FACE_X, x) * smoothstep(0.55, 0.85, z) - 0.120 * rake
            - 0.020 * smoothstep(-2.14, -2.28, x) * smoothstep(0.55, 0.80, z) + 0.090 * tuck)


def gb_c(x):
    return float(Curve([(1.05, 0.700), (0.90, 0.760), (0.50, 0.800), (0.00, 0.808), (-0.50, 0.790), (-0.80, 0.740),
                        (-0.95, 0.660), (-1.05, 0.600)])(x))


# ---------------------------------------------------------------------------------------------
# Greenhouse: a long raked windscreen, a short roof, a small near-vertical rear window between
# flying buttresses (the sail runs back over the engine deck)
# ---------------------------------------------------------------------------------------------

yr_c = Curve([(1.050, 0.825), (0.90, 0.900), (0.70, 0.998), (0.50, 1.090), (0.30, 1.180), (0.15, 1.250),
              (0.00, 1.292), (-0.20, 1.312), (-0.45, 1.304), (-0.65, 1.270), (-0.80, 1.220), (-0.92, 1.170),
              (-1.00, 1.150), (-1.05, 1.140)])
GH_X = (-1.050, 1.050)
T_CANT = 0.55
A_TOP, A_BASE = 0.040, 1.045
B_X = -0.420
C_TOP, C_BASE = -0.560, -0.800
RW = (-0.960, -0.700, 0.360)
WIN_X = 0.10
CANT_K, TUMBLE, ROOF_E, ROOF_ZE, SIDE_BOW = 0.78, 0.40, 0.75, 1.0, 0.012
MIRROR_BASE = 0.860
DOORS = (1.000, -0.560)


def greenhouse(q):
    return _parent_greenhouse(q)


def pillar_trims(q):
    return _parent_trims(q)


# ---------------------------------------------------------------------------------------------
# Front: slim angled headlamps on the wing tops, three intakes, a black splitter
# ---------------------------------------------------------------------------------------------

LAMP_Z, LAMP_HW, LAMP_HH, LAMP_Y = 0.680, 0.200, 0.036, 0.570
INTAKE_Y = (0.200, 0.430)
LIP_Y = 0.420


def _nose_patch(yz, nu, nv, out, thick, mat, s=1):
    """A plate lying on the nose surface: yz(u, v) -> (y, z) over the unit square (right side,
    mirrored by s), lifted `out` along the surface normal, `thick` deep."""
    def fn(u, v):
        Y, Z = yz(u, v)
        P = np.zeros(u.shape + (3,))
        Nn = np.zeros_like(P)
        for i in np.ndindex(u.shape):
            p, n_ = nose_hit(float(Y[i]), float(s * Z[i]))
            Nn[i] = n_
            P[i] = p + n_ * out
        return P, Nn
    return patch_slab(fn, nu, nv, thick, mat=mat)


def _lamp_yz(grow=0.0):
    """The headlamp blade: from the inner end up and out along the wing top, tapering."""
    def yz(u, v):
        z = LAMP_Z - 0.210 - grow + (0.400 + 2 * grow) * u
        yt = LAMP_Y + 0.026 + 0.024 * u + grow
        h = 0.070 - 0.038 * u + 2 * grow
        return yt - h * (1 - v), z
    return yz


def headlamp_parts(q, s):
    """Flush LED blade lying on the wing's leading edge: a smoked housing, a running-light strip
    along its top edge, three projector dots, a clear cover. Returns (body, lens, glass)."""
    body, lens, glass = Mesh(), Mesh(), Mesh()
    lo = q < 0.1
    nu = 3 if lo else seg(10, q, 4)
    body += _nose_patch(_lamp_yz(0.006), nu, 2, 0.001, 0.010, 'body:smoke', s)
    yz = _lamp_yz()
    uu = np.linspace(0.02, 0.98, 4 if lo else seg(12, q, 5))
    pts = []
    for u in uu:
        y, z = yz(np.array(u), np.array(0.88))
        p, n_ = nose_hit(float(y), float(s * z))
        pts.append(p + n_ * 0.005)
    lens += sweep(np.array(pts), lambda i, t: ellipse(0.0040, 0.0040, 4 if lo else seg(8, q, 4)), 'headlight_lens',
                  cap0='flat', cap1='flat')
    if not lo:
        for u in (0.18, 0.38, 0.58):
            y, z = yz(np.array(u), np.array(0.40))
            p, n_ = nose_hit(float(y), float(s * z))
            R = frame_from(n_)
            body += placed(revolve([(0.016, 0.000), (0.011, -0.006), (0.0, -0.008)], seg(14, q, 6),
                                   mat='body:reflector'), R, p + n_ * 0.003)
            lens += placed(revolve([(0.0, 0.001), (0.009, 0.001), (0.010, -0.002), (0.0, -0.003)], seg(12, q, 6),
                                   mat='headlight_lens'), R, p + n_ * 0.004)
    glass += _nose_patch(_lamp_yz(0.004), nu, 2, 0.009, 0.003, 'glass:clear', s)
    return body, lens, glass


def light_bar(q):
    """No light bar on the Monza: a slim black lip under the bonnet's leading edge instead."""
    body = Mesh()
    zi = 0.42
    n = seg(18, q, 6) if q >= 0.1 else 4
    P = _nose_strip(LIP_Y, -zi, zi, n, 0.001)
    body += sweep(P, lambda i, t: ellipse(0.003, 0.008, seg(6, q, 4) if q >= 0.1 else 4, e=0.6), 'body:gloss',
                  cap0='flat', cap1='flat')
    return body, Mesh()


def indicators(q):
    """The two outer intakes (black, with a vertical vane) and the amber indicators in the
    headlamps' inner ends."""
    m = Mesh()
    for s in (-1, 1):
        # outer intake: a tall black trapezoid at the corner of the face
        m += _nose_patch(lambda u, v: (INTAKE_Y[0] + (INTAKE_Y[1] - INTAKE_Y[0]) * v, 0.640 + (0.230 - 0.070 * v) * u), seg(6, q, 3),
                         seg(4, q, 2), 0.001, 0.010, 'body:well', s)
        if q >= 0.6:
            for u in (0.33, 0.66):
                pts = []
                for v in (0.05, 0.95):
                    p, n_ = nose_hit(INTAKE_Y[0] + (INTAKE_Y[1] - INTAKE_Y[0]) * v, s * (0.640 + (0.230 - 0.070 * v) * u))
                    pts.append(p + n_ * 0.010)
                m += strut(tuple(pts[0]), tuple(pts[1]), 0.005, 0.005, n=6, mat='body:gloss', samples=2)
        m += _nose_patch(lambda u, v: (LAMP_Y + 0.034 + 0.008 * v - 0.010 * u, LAMP_Z - 0.240 + 0.040 * u), 2, 1, 0.003, 0.004,
                         'body:amber', s)
    return m


def nose_badge(q):
    """A small shield badge on the nose."""
    if q < 0.2:
        return Mesh()
    p, nn = nose_hit(0.470, 0.0)
    R = frame_from(nn)
    return placed(slab(rounded_rect(0.024, 0.020, 0.010, seg(3, q, 2)), 0.006, axis=2, centre=0.001,
                       mat='body:chrome', steps=1), R, p + nn * 0.001)


def bumpers(q):
    """Black splitter, side blades along the sills, a big black diffuser with five fins."""
    m = Mesh()
    zs = [0.0, 0.25, 0.45, 0.60, 0.72, 0.82, 0.88]
    fpath = _bumper_path(nose_hit, 0.180, 1, zs, 0.010)
    fpath = [(fpath[0][0] - 0.25, fpath[0][1] * 1.08)] + fpath + [(fpath[-1][0] - 0.25, fpath[-1][1] * 1.08)]
    m += blade(fpath, 0.170, 0.012, 0.060, q, mat='body:gloss')
    rzs = [0.0, 0.25, 0.45, 0.60, 0.72, 0.80]
    rpath = _bumper_path(tail_hit, 0.330, -1, rzs, 0.004)
    rpath = [(rpath[0][0] + 0.20, rpath[0][1] * 1.06)] + rpath + [(rpath[-1][0] + 0.20, rpath[-1][1] * 1.06)]
    m += blade(rpath, 0.300, 0.110, 0.030, q, mat='body:plastic')
    if q >= 0.2:
        p, nrm = tail_hit(0.300, 0.0)
        for z in (-0.52, -0.30, 0.30, 0.52):
            m += slab(rounded_rect(0.140, 0.060, 0.010, 1), 0.010, axis=2, centre=0.0, mat='body:gloss',
                      steps=1).transform(t=(p[0] + 0.12, 0.250, z))
    # side blades along the sills
    for s in (-1, 1):
        x0, x1 = XF - ARCH[0][2] - 0.02, XR + ARCH[1][2] + 0.02
        pts = []
        for x in np.linspace(x1, x0, seg(10, q, 4)):
            y = float(yb_c(x)) + 0.040
            pts.append((x, y, s * (surf_z(x, y) + 0.020)))
        m += sweep(np.array(pts), lambda i, t: ellipse(0.022, 0.012, seg(6, q, 4), e=0.6), 'body:gloss',
                   cap0='flat', cap1='flat', up=(0, 1, 0))
    return m


def side_intakes(q):
    """The deep intakes behind the doors: a black mouth set into the scallop, with a body-colour
    blade along its leading edge."""
    m = Mesh()
    for s in (-1, 1):
        def fn(u, v, s=s):
            x = -0.600 - 0.460 * u
            y = 0.500 + 0.060 * u + (0.300 - 0.170 * u) * v ** (1.0 + 0.0 * u)
            z = np.vectorize(lambda a, b: surf_z(a, b))(x, y) - 0.004
            P = np.stack([x, y, s * z], -1)
            Nn = np.zeros_like(P)
            Nn[..., 2] = s
            return P, Nn
        m += patch_slab(fn, seg(10, q, 3), seg(6, q, 2), 0.012, mat='body:well')
        if q >= 0.2:
            pts = []
            for v in np.linspace(0, 1, seg(8, q, 3)):
                x, y = -0.640, 0.470 + 0.300 * v
                pts.append((x + 0.010, y, s * (surf_z(x, y) + 0.004)))
            m += sweep(np.array(pts), lambda i, t: ellipse(0.010, 0.006, seg(6, q, 4), e=0.6), 'paint',
                       cap0='flat', cap1='flat')
    return m


def cladding(q):
    return side_intakes(q)


def roof_spoiler(q):
    """Carbon lip on the ducktail and the louvred engine cover between the buttresses."""
    m = Mesh()
    zs = [0.0, 0.25, 0.45, 0.60, 0.70]
    pts = []
    for z in zs[::-1]:
        p, nn = tail_hit(0.940, -z)
        pts.append((p[0] - 0.006, 0.962, -z))
    for z in zs[1:]:
        p, nn = tail_hit(0.940, z)
        pts.append((p[0] - 0.006, 0.962, z))
    m += sweep(catmull(pts, seg(20, q, 6)), lambda i, t: ellipse(0.030, 0.006, seg(6, q, 4), e=0.6), 'body:gloss',
               cap0='flat', cap1='flat', up=(0, 1, 0))
    if q >= 0.2:
        for k in range(seg(6, q, 3)):
            x = -1.16 - k * 0.075
            y = float(crown(x, 0.0)) + 0.004
            m += slab(rounded_rect(0.012, 0.300, 0.004, 1), 0.006, axis=1, centre=y, mat='body:gloss',
                      steps=1).transform(t=(x, 0, 0))
    return m


def door_handles(q):
    return Mesh()


def door_mirrors(q):
    """Slim mirrors on twin stalks from the door tops."""
    if q < 0.2:
        return race_mirrors(q, mat='body:gloss')
    m = Mesh()
    for s in (-1, 1):
        x = MIRROR_BASE
        zb = float(gb_c(x)) + 0.040
        yb_ = float(crown(x, zb))
        head = np.array([x - 0.060, yb_ + 0.080, s * (zb + 0.140)])
        for dx in (0.0, -0.050):
            m += strut((x + dx, yb_ + 0.004, s * zb), tuple(head + [dx + 0.020, -0.030, -s * 0.050]), 0.010, 0.007,
                       n=seg(8, q, 5), mat='body:gloss', samples=3)
        m += blob(head + [0.012, 0, 0], (0.034, 0.050, 0.095), n=seg(16, q, 8), rings=seg(8, q, 4), e1=0.30,
                  e2=0.40, mat='paint')
        g = slab(rounded_rect(0.040, 0.082, 0.014, seg(4, q, 2)), 0.004, axis=0, centre=0.0, mat='mirror', steps=1)
        m += g.transform(t=tuple(head - [0.020, 0, 0]))
    return m


def fuel_filler(q):
    if q < 0.2:
        return Mesh()
    p, nrm = side_frame(-1.30, 0.880)
    R = frame_from(nrm)
    return placed(revolve([(0.0, 0.003), (0.040, 0.003), (0.042, 0.0), (0.042, -0.004), (0.0, -0.004)],
                          seg(20, q, 8), mat='body:alu'), R, p)


# ---------------------------------------------------------------------------------------------
# Rear: slim LED lamps on the tail's upper edge joined by a thin bar, a black tail panel, two
# centre exhausts in the diffuser
# ---------------------------------------------------------------------------------------------

TAIL_Y = 0.860
NAME, NAME_Y, NAME_W = 'MONZA', 0.740, 0.30


def _tail_band(q):
    """A deeper smoked band behind the light bar and wider red lamp ends, so the lamps read on
    any paint. Returns (body, lens)."""
    body, lens = Mesh(), Mesh()
    lo = q < 0.1
    zmax = 0.780
    P = _tail_strip(TAIL_Y - 0.010, -zmax, zmax, 6 if lo else seg(28, q, 8), 0.003)
    body += sweep(P, lambda i, t: ellipse(0.006, 0.040, 4 if lo else seg(6, q, 4), e=0.5), 'body:smoke',
                  cap0='flat', cap1='flat', up=(0, 1, 0))
    if not lo:
        for s in (-1, 1):
            P3 = _tail_strip(TAIL_Y - 0.012, s * 0.50, s * 0.76, seg(8, q, 4), 0.010)
            lens += sweep(P3, lambda i, t: ellipse(0.003, 0.022, seg(6, q, 4), e=0.5), 'taillight_lens',
                          cap0='flat', cap1='flat', up=(0, 1, 0))
    return body, lens


def tail_lamps(q):
    body, lens = _vanta_tail(q)
    b2, l2 = _tail_band(q)
    body += b2
    lens += l2
    if q < 0.2:
        return body, lens
    # the black tail panel between the lamps and the diffuser
    def fn(u, v):
        z = (u - 0.5) * 2 * 0.62
        y = 0.430 + 0.180 * v
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
    p, nrm = tail_hit(0.580, 0.0)
    R = frame_from(nrm)
    return placed(slab(rounded_rect(0.230, 0.058, 0.008, seg(3, q, 2)), 0.006, axis=2, centre=0.006,
                       mat='body:rubber', steps=1), R, p)


def exhaust(q):
    """Two big round tailpipes in the middle of the diffuser."""
    m = Mesh()
    n = seg(20, q, 8)
    p, _ = tail_hit(0.380, 0.0)
    for z in (-0.110, 0.110):
        pipe = revolve([(0.046, 0.0), (0.050, -0.140), (0.052, -0.150), (0.052, -0.160), (0.042, -0.160),
                        (0.040, -0.010)], n, mat='body:steel', axis='x', closed_profile=True)
        pipe.transform(t=(p[0] + 0.140, 0.380, z))
        m += pipe
        if q >= 0.2:
            soot = revolve([(0.0, -0.145), (0.0405, -0.145), (0.0405, -0.141), (0.0, -0.141)], n, mat='body:inlet',
                           axis='x')
            soot.transform(t=(p[0] + 0.140, 0.380, z))
            m += soot
    return m


def tyre(R, W, q):
    return _aurelia_tyre(R, W, q)


# ---------------------------------------------------------------------------------------------
# Cabin: a supercar's: hooded digital cluster, small centre screen, high carbon console, black
# buckets, a bulkhead behind the seats (the engine), a flat-bottomed wheel
# ---------------------------------------------------------------------------------------------

DASH = [(1.000, 0.800 + KDY), (0.800, 0.880 + KDY), (0.600, 0.920 + KDY), (0.480, 0.930 + KDY),
        (0.432, 0.918 + KDY), (0.412, 0.884 + KDY), (0.410, 0.720 + KDY), (0.440, 0.640 + KDY), (1.000, 0.640 + KDY)]
GAUGE_POS = [(0.884 + KDY, -0.470, 0.044), (0.884 + KDY, -0.296, 0.044), (0.884 + KDY, -0.550, 0.020),
             (0.884 + KDY, -0.216, 0.020)]
SCREEN = (0.452, 0.880 + KDY, 0.020, 0.090, 0.060)
HELMET_C = np.array([-0.400, 1.065, DRIVER_Z])
GLOW_C = np.array([0.36, 0.86 + KDY, DRIVER_Z * 0.6])
WHEEL_R = 0.178


def binnacle(q):
    return _rb_binnacle(q)


def gauges(q, x=0.394):
    return _rb_gauges(q, x)


def console(q):
    """High carbon centre spine from the dash to the seats with a row of switches."""
    m = Mesh()
    m += blob((0.00, 0.420 + KDY, 0.0), (0.560, 0.150, 0.100), n=seg(16, q, 6), rings=seg(8, q, 4), e1=0.25,
              e2=0.30, mat='carbon:satin')
    if q >= 0.2:
        for k in range(5):
            m += slab(rounded_rect(0.008, 0.012, 0.003, 1), 0.012, axis=1, centre=0.572 + KDY, mat='int:metal',
                      steps=1).transform(t=(0.20 - k * 0.04, 0, 0))
    return m


def _bulkhead(q):
    """The wall behind the seats (the engine is behind it)."""
    return slab(rounded_rect(0.300, 0.700, 0.06, seg(3, q, 2)), 0.030, axis=0, centre=-0.770, mat='int:dash',
                steps=1).transform(t=(0, TUB_FLOOR + 0.300, 0))


def engine(q):
    """What shows through the rear window: a black engine cover with two red intake plenums."""
    m = Mesh()
    for z in (-0.18, 0.18):
        m += blob((-0.88, 0.930, z), (0.110, 0.030, 0.080), n=seg(14, q, 6), rings=seg(6, q, 3), e1=0.4, e2=0.4,
                  mat='body:accent')
    return m


def cabin(q):
    m = Mesh()
    m += dash_body(q, half=0.760)
    m += _fascia(q)
    if q >= 0.6:
        m += gauges(q)
        m += binnacle(q)
    for z in (DRIVER_Z, -DRIVER_Z):
        m += _seat(q, z)
    if q < 0.1:
        return m
    m += console(q)
    m += _bulkhead(q)
    m += strut(tuple(np.array(WHEEL_CENTRE) + [0.06, -0.03, 0]), (0.45, 0.80 + KDY, DRIVER_Z), 0.024, 0.024,
               n=seg(10, q, 6), mat='int:black', samples=3)
    m += panel((-0.60, A_TOP + 0.10), (-0.59, 0.59), seg(12, q, 3), seg(8, q, 2), 0.006, 'int:headliner', inset=0.024)
    return m


def cockpit_shell(q):
    m = Mesh()
    m += dash_body(q, half=0.760)
    m += _fascia(q)
    m += gauges(q)
    m += binnacle(q)
    for z in (DRIVER_Z, -DRIVER_Z):
        m += _seat(q, z)
    m += console(q)
    m += _bulkhead(q)
    m += strut(tuple(np.array(WHEEL_CENTRE) + [0.06, -0.03, 0]), (0.45, 0.80 + KDY, DRIVER_Z), 0.024, 0.024,
               n=seg(12, q, 6), mat='int:black', samples=3)
    m += door_cards(q)
    m += pillar_trims(q)
    m += rear_view_mirror(q)
    return m


def steering_wheel(q):
    """The Vanta's flat-bottomed wheel in alcantara with a red twelve o'clock band."""
    m = _vanta_wheel(q)
    if q >= 0.2:
        n = 8
        a = np.linspace(math.pi / 2 - 0.08, math.pi / 2 + 0.08, n)
        path = np.stack([np.zeros(n), WHEEL_R * np.sin(a), WHEEL_R * np.cos(a)], -1)
        m += sweep(path, lambda i, t: ellipse(0.0140, 0.0155, seg(10, q, 4)), 'body:accent', up=(1, 0, 0),
                   cap0='flat', cap1='flat')
    return m


# ---------------------------------------------------------------------------------------------
# Livery: panel gaps; twin dark racing stripes over the nose, roof and deck (shade); black
# roof panel; the name on the tail panel (Body)
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
        sill = yb + 0.100
        belt = np.vectorize(lambda v: float(crown(v, gb_c(np.clip(v, GH_X[0], GH_X[1])))))(x)
        for xd in DOORS:
            g = np.maximum(g, lv.line(x - xd, W) * side * (y > sill - 0.005) * (y < belt + 0.01))
        g = np.maximum(g, lv.line(x - 1.150, W) * top * (az < 0.70))
        g = np.maximum(g, lv.line(x + 1.100, W) * top * (az < 0.62))
        shade = 1.0 - 0.62 * np.clip(g, 0, 1)
        dark = zero.copy()
        stripe = (lv.band(az, 0.060, 0.170, 0.003) + lv.band(az, 0.200, 0.235, 0.003)) * top
        dark = np.maximum(dark, 0.80 * np.clip(stripe, 0, 1) * valid)
        p, nrm = tail_hit(NAME_Y, 0.0)
        dark = np.maximum(dark, 0.90 * lv.stamp(P, N, valid, lv.text_mask(NAME, oblique=False),
                                                (fx(p[0]), NAME_Y, 0.0), (0, 0, 1), (0, 1, 0), NAME_W,
                                                facing=(-1, 0, 0), min_dot=0.3, depth=0.10))
        shade = shade * (1 - np.clip(dark, 0, 0.95))
        return {'shade': shade}
    if group == 'Body':
        return {'layers': []}
    return {}


def build(q):
    m = _vanta_build(q)
    m['body'] = m['body'] + (engine(q) if q >= 0.2 else Mesh())
    return m


RENDER_VIEWS = {
    'gt_lights': ((3.30, 0.95, 1.50), (2.15, 0.52, 0.60), 45),
    'gt_grille': ((3.80, 0.65, 0.55), (2.25, 0.36, 0.0), 48),
    'gt_wheel': ((2.30, 0.58, 2.05), (1.22, 0.38, 0.98), 62),
    'gt_tail': ((-3.50, 1.20, 1.55), (-2.20, 0.75, 0.40), 45),
    'gt_interior': ((0.25, 1.50, 2.20), (-0.20, 0.90, 0.0), 40),
    'gt_window': ((0.70, 1.20, 3.10), (0.20, 1.00, 0.0), 38),
}

META = make_meta()
