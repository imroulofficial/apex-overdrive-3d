"""Ridgeback (rb-ridgeback): the all-weather endurance car, a five-door off-road wagon, 4.80 m.
Batch 1.

An original design in the spirit of the current Ridgeback: a tall, square expedition wagon on big
all-terrain tyres, with a high flat bonnet, an upright windscreen, a long flat roof with a roof
rack, three side windows a side, a vertical tailgate carrying the spare wheel, a square face with
a wide grille and square lamps, a steel nudge bar and skid plate, black bolt-on flares, side steps
and dark eight-spoke wheels. No real manufacturer's shapes, badges or names.

It inherits the Kestrel (which inherits the Aurelia): subdivision-cage body, canopy glass and
sliding windows, ray hits, cabin pieces, hands and cockpit machinery. The canopy here runs right
to the tail and drops vertically into the tailgate.

Measured from the shipped model (public/assets/models/rb_ridgeback.glb at 4.80 m): front axle
x +1.4365, rear -1.2535 (wheelbase 2.690 m), tyre radius 0.433 / 0.431 m, half-track 0.851 /
0.845 m.
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from inherit import inherit  # noqa: E402

inherit('kz_kestrel', globals())
_kestrel_driver, _parent_greenhouse, _parent_glass, _parent_trims = driver, greenhouse, glass_panels, pillar_trims
_kestrel_flares = flares

import livery as lv  # noqa: E402
from meshkit import (Curve, Mesh, blob, catmull, ellipse, lerp, loft, norm, patch_slab, revolve, rot,  # noqa: E402
                     rounded_rect, slab, smoothstep, strut, sweep, tube, window, TAU)

ID = 'rb-ridgeback'
FILE = 'rb_ridgeback'
LENGTH = 4.80

XF, XR = 1.4365, -1.2535
RF, RR = 0.433, 0.431
TF, TR = 0.851, 0.845
WF, WR = 0.270, 0.270
RIM_R = 0.2159                  # 17-inch wheels, tall all-terrain sidewalls
NOSE, TAIL = 2.400, -2.400
DRIVER_Z = -0.400
KDY = 0.400                     # the cabin sits 40 cm higher than the Aurelia's
EYE = (-0.270, 1.500, DRIVER_Z)
WHEEL_CENTRE = (0.100, 1.285, DRIVER_Z)
WHEEL_TILT = math.radians(30)
FACTORY_PAINT = (0.40, 0.32, 0.20)    # linear RGB: desert sand
LEATHER = (0.055, 0.055, 0.058)       # charcoal cloth
TYRE_WORDS = ['APEX OVERDRIVE', 'RIDGEBACK A/T', 'APEX OVERDRIVE', 'RIDGEBACK A/T']
TYRE_HW = WF / 2
TYRE_BAND = None
TYRE_BLOCKS = 46                      # all-terrain tread blocks round the tyre
TYRE_TEXT_R = (0.120, 0.030)
GLOVE = (0.44, 0.33, 0.16)            # sand softshell gloves (grey read near-black at night in game)
HEADLINER = (0.050, 0.050, 0.053)
METAL = (0.55, 0.56, 0.57)
METAL_RM = (0.40, 0.55)
RIM_PAINT = (0.075, 0.078, 0.082)     # dark gunmetal wheels
CALIPER = (0.10, 0.10, 0.105)
STEEL = (0.030, 0.030, 0.032)
B_MAT = 'body:plastic'
TRIM_MAT = 'body:rubber'
GAUGES = [
    {'label': 'KM/H', 'max': 200, 'ticks': 10, 'needle': 0.14},
    {'label': 'RPM x1000', 'max': 6, 'ticks': 6, 'needle': 0.18},
    {'label': 'FUEL', 'max': 100, 'ticks': 4, 'needle': 0.75},
    {'label': 'TEMP', 'max': 120, 'ticks': 4, 'needle': 0.45},
]

# ---------------------------------------------------------------------------------------------
# Body blueprint: square and tall, a high flat bonnet, the canopy running to the tail
# ---------------------------------------------------------------------------------------------

yb_c = Curve([(2.33, 0.620), (2.22, 0.540), (2.05, 0.470), (1.80, 0.430), (1.20, 0.410), (0.00, 0.405),
              (-1.00, 0.410), (-1.70, 0.440), (-1.95, 0.480), (-2.12, 0.540), (-2.22, 0.600)])
hw_c = Curve([(2.33, 0.860), (2.28, 0.892), (2.18, 0.910), (1.90, 0.918), (1.20, 0.920), (0.20, 0.920),
              (-0.80, 0.920), (-1.60, 0.920), (-2.00, 0.916), (-2.16, 0.906), (-2.22, 0.888)])
ymx_c = Curve([(2.33, 0.840), (1.60, 0.880), (0.00, 0.890), (-1.60, 0.890), (-2.22, 0.880)])
ysh_c = Curve([(2.33, 1.182), (2.24, 1.200), (2.05, 1.214), (1.60, 1.222), (0.80, 1.226), (0.00, 1.228),
               (-1.20, 1.230), (-2.00, 1.230), (-2.22, 1.226)])
shd_c = Curve([(2.33, 0.034), (1.60, 0.036), (0.00, 0.036), (-2.22, 0.034)])
top_c = Curve([(2.33, 1.205), (2.24, 1.236), (2.05, 1.262), (1.70, 1.278), (1.20, 1.288), (0.85, 1.294), (0.72, 1.296),
               (0.55, 1.340), (-1.00, 1.340), (-2.14, 1.340), (-2.18, 1.262), (-2.22, 1.250)])

CABIN = (-2.14, 0.66)
TUB_FLOOR = 0.640
ci_c = Curve([(0.70, 0.800), (-2.14, 0.800)])
ZWELL = 0.640
ARCH = [(XF, RF + 0.012, RF + 0.040), (XR, RR + 0.012, RR + 0.040)]
FACE_X = 2.300
FACE_D = 0.040
MOUTH = (1.040, 0.790, 0.120)
MOUTH_E = (0.10, 0.16)
MOUTH_DROOP = 0.0
BULGE = 0.012
BULGE_W = 0.360
ROW_Z = (0.14, 0.360, 0.500)
STATION_XS = (-2.22, -2.18, -2.10, -1.98, -1.84, -0.75, -0.50, -0.25, 0.0, 0.25, 0.46, 0.64, 0.80, 1.96, 2.06,
              2.14, 2.22)
TAIL_TURN = (0.030, 0.92)
ROW_IN = (0.100, 0.050, 0.016)
SIDE_CREASE = 0.70
OVERHANG = 2.00


def bulge_w(x):
    return float(window(x, 0.85, 2.18, 0.30))


def crown_e(x):
    return 5.0


def tip_shift(x, z, y=0.0):
    z = np.abs(z)
    return 0.012 * smoothstep(2.14, FACE_X, x) * smoothstep(0.64, 0.82, z)


def gb_c(x):
    return float(Curve([(0.725, 0.832), (0.62, 0.862), (0.40, 0.872), (-2.00, 0.872), (-2.14, 0.866),
                        (-2.20, 0.856)])(x))


# ---------------------------------------------------------------------------------------------
# Greenhouse: upright glass, a long flat roof, the tailgate glass on the vertical back
# ---------------------------------------------------------------------------------------------

yr_c = Curve([(0.725, 1.296), (0.66, 1.380), (0.58, 1.480), (0.50, 1.578), (0.42, 1.668), (0.34, 1.746), (0.27, 1.802),
              (0.20, 1.840), (0.10, 1.866), (0.00, 1.878), (-0.60, 1.888), (-1.40, 1.888), (-1.90, 1.882),
              (-2.04, 1.872), (-2.10, 1.856), (-2.135, 1.820), (-2.155, 1.700), (-2.170, 1.520), (-2.182, 1.360),
              (-2.190, 1.270)])
GH_X = (-2.190, 0.725)
T_CANT = 0.55
A_TOP, A_BASE = 0.200, 0.722
B_X = -0.335
X2 = -1.225                     # rear door glass rear edge (C post)
C_TOP, C_BASE = -1.960, -1.990  # D line: the third window's rear edge, near vertical
RW = (-2.181, -2.140, 0.400)    # tailgate glass on the vertical back (x span of the drop, half width in t)
WIN_X = 0.10
CANT_K, TUMBLE, ROOF_E, ROOF_ZE, SIDE_BOW = 0.86, 0.10, 0.30, 0.80, 0.004


def greenhouse(q):
    """The parent's roof, pillars and sail, plus black C posts between the rear door glass and
    the third window."""
    m = _parent_greenhouse(q)
    for s in (-1, 1):
        m += panel((X2 - 0.030, X2 + 0.020), (0.585, 1.01), 2, seg(8, q, 3), 0.016, B_MAT, inset=-0.002, side=s)
    return m


def pillar_trims(q):
    m = _parent_trims(q)
    for s in (-1, 1):
        m += panel((X2 - 0.034, X2 + 0.024), (0.585, 1.0), 2, seg(8, q, 3), 0.008, 'int:headliner', inset=0.020,
                   side=s)
    return m


# ---------------------------------------------------------------------------------------------
# Front: wide grille with square lamps at its ends, a black bumper, steel nudge bar, skid plate
# ---------------------------------------------------------------------------------------------

LAMPS = [(0.640, 0.095)]        # (z, half size) square lamps
LAMP_Y = 1.040


def grille(q):
    """Black grille panel in the mouth with four thick horizontal bars between the lamps."""
    m = Mesh()
    cy, ma, mb = MOUTH
    n = seg(64, q, 14)
    ring = mouth_outline(n, 0.002, _mx() + 0.001)
    m += sweep(ring, lambda i, t: ellipse(0.006, 0.008, seg(8, q, 4)), 'body:plastic', closed=True)
    xg = _mx() - 0.045
    back = slab(rounded_rect(mb * 0.97, ma * 0.985, 0.016, seg(4, q, 2)), 0.006, axis=0, centre=xg - 0.010,
                mat='body:grille', steps=1)
    back.transform(t=(0, cy, 0))
    m += back
    if q < 0.2:
        return m
    zin = LAMPS[0][0] - LAMPS[0][1] - 0.030
    for yy in np.linspace(cy - mb * 0.66, cy + mb * 0.66, 4):
        b = slab(rounded_rect(0.016, zin, 0.008, seg(2, q, 1)), 0.030, axis=0, centre=xg + 0.016, mat='body:plastic',
                 steps=1)
        b.transform(t=(0, yy, 0))
        m += b
    return m


def headlamp_parts(q, s):
    """Square lamps with a round projector and a running-light strip. Returns (body, lens, glass)."""
    body, lens, glass = Mesh(), Mesh(), Mesh()
    z, h = LAMPS[0]
    c = np.array([_mx() - 0.020, LAMP_Y, s * z])
    R = frame_from((1.0, 0.0, 0.0))
    housing = slab(rounded_rect(h + 0.010, h * 0.86 + 0.010, 0.022, (seg(4, q, 2) if q >= 0.1 else 1)), 0.050, axis=2, centre=-0.022,
                   mat='body:rubber', steps=1)
    body += placed(housing, R, c)
    n = seg(28, q, 8)
    rp = h * 0.52
    cp = c + np.array([0.0, 0.004, s * -0.012])
    if q >= 0.1:
        body += placed(revolve([(rp + 0.004, 0.006), (rp + 0.012, 0.004), (rp + 0.012, -0.020), (rp + 0.004, -0.020)],
                               n, mat='body:chrome', closed_profile=True), R, cp)
    body += placed(revolve([(rp, -0.002), (rp * 0.6, -0.018), (0.0, -0.024)], n, mat='body:reflector'), R, cp)
    lens += placed(revolve([(0.0, -0.016), (rp * 0.55, -0.016), (rp * 0.58, -0.006), (rp * 0.40, 0.004), (0.0, 0.006)],
                           seg(16, q, 6), mat='headlight_lens'), R, cp)
    # running-light strip along the lamp's lower edge (lights with the headlamps)
    strip = slab(rounded_rect(0.007, h * 0.80, 0.004, 1), 0.008, axis=0, centre=0.0, mat='headlight_lens', steps=1)
    strip.transform(t=(c[0] + 0.004, c[1] - h * 0.62, c[2]))
    lens += strip
    cover = slab(rounded_rect(h, h * 0.86, 0.018, (seg(4, q, 2) if q >= 0.1 else 1)), 0.006, axis=2, centre=0.010, mat='glass:clear',
                 steps=1)
    glass += placed(cover, R, c)
    return body, lens, glass


def indicators(q):
    """Amber lamps at the bumper's ends."""
    m = Mesh()
    for s in (-1, 1):
        p, nrm = nose_hit(0.760, s * 0.700)
        R = frame_from(norm(nrm + np.array([0.4, 0, 0])))
        m += placed(slab(rounded_rect(0.050, 0.022, 0.008, seg(3, q, 2)), 0.014, axis=2, centre=0.050,
                         mat='body:amber', steps=1), R, p)
    return m


BADGE_Y = 1.215


def nose_badge(q):
    if q < 0.2:
        return Mesh()
    p, nrm = nose_hit(BADGE_Y, 0.0)
    R = frame_from(nrm, up=(0, 1, 0))
    m = placed(slab(rounded_rect(0.070, 0.018, 0.008, seg(3, q, 2)), 0.006, axis=2, centre=0.0, mat='body:badge',
                    steps=1), R, p)
    return m


def bumpers(q):
    """Thick black front bumper with a steel nudge bar and an alloy skid plate; black rear bumper
    with a step."""
    m = Mesh()
    zs = [0.0, 0.30, 0.55, 0.70, 0.80, 0.86, 0.90]
    fpath = _bumper_path(nose_hit, 0.760, 1, zs, 0.040)
    fpath = [(fpath[0][0] - 0.16, fpath[0][1] * 1.01)] + fpath + [(fpath[-1][0] - 0.16, fpath[-1][1] * 1.01)]
    m += blade(fpath, 0.760, 0.085, 0.050, q, mat='body:plastic')
    rzs = [0.0, 0.30, 0.55, 0.70, 0.80, 0.86, 0.90]
    rpath = _bumper_path(tail_hit, 0.700, -1, rzs, 0.040)
    rpath = [(rpath[0][0] + 0.12, rpath[0][1] * 1.01)] + rpath + [(rpath[-1][0] + 0.12, rpath[-1][1] * 1.01)]
    m += blade(rpath, 0.700, 0.080, 0.050, q, mat='body:plastic')
    # nudge bar: two uprights and a hoop in front of the grille, a lower cross bar
    xb = _mx() + 0.110
    n = seg(12, q, 6) if q >= 0.1 else 4
    hoop = [(xb - 0.02, 0.86, -0.40), (xb, 1.06, -0.38), (xb + 0.01, 1.13, -0.28), (xb + 0.012, 1.15, 0.0),
            (xb + 0.01, 1.13, 0.28), (xb, 1.06, 0.38), (xb - 0.02, 0.86, 0.40)]
    m += tube(hoop, 0.030, n=n, mat='body:steel', samples=seg(24, q, 8))
    if q >= 0.2:
        m += tube([(xb - 0.02, 0.90, -0.40), (xb - 0.02, 0.90, 0.40)], 0.026, n=n, mat='body:steel',
                  samples=seg(6, q, 3))
    for s in ((-1, 1) if q >= 0.2 else ()):
        m += tube([(xb - 0.02, 0.86, s * 0.40), (xb - 0.07, 0.70, s * 0.40)], 0.032, n=n, mat='body:steel',
                  samples=3)

    def guard(u, v):
        z = (u - 0.5) * 1.10
        x = lerp(_mx() + 0.040, 1.60, v)
        y = 0.700 - 0.250 * smoothstep(0.0, 0.55, v)
        P = np.stack([x, y, z], -1)
        Nn = np.zeros_like(P)
        Nn[..., 1] = -1
        return P, Nn
    m += patch_slab(guard, seg(10, q, 3), seg(8, q, 3), 0.008, mat='body:alu')
    return m


TAIL_Y = 1.040
TAIL_Z = 0.845


def tail_lamps(q):
    """Tall tail lamps on the rear corners: red with an amber top and a clear reverse section.
    Returns (body, lens)."""
    body, lens = Mesh(), Mesh()
    for s in (-1, 1):
        p, nrm = tail_hit(TAIL_Y, s * TAIL_Z)
        R = frame_from(norm(nrm * 0.8 + np.array([0, 0, s * 0.2])))
        c = p + nrm * 0.004
        body += placed(slab(rounded_rect(0.052, 0.170, 0.016, seg(3, q, 2) if q >= 0.1 else 1), 0.020, axis=2, centre=-0.004,
                            mat='body:rubber', steps=1), R, c)
        lens += placed(slab(rounded_rect(0.044, 0.105, 0.012, seg(3, q, 2) if q >= 0.1 else 1, cy=-0.040), 0.010, axis=2, centre=0.008,
                            mat='taillight_lens', steps=1), R, c)
        if q >= 0.2:
            body += placed(slab(rounded_rect(0.044, 0.030, 0.010, seg(3, q, 2), cy=0.125), 0.010, axis=2,
                                centre=0.008, mat='body:amber', steps=1), R, c)
            body += placed(slab(rounded_rect(0.044, 0.014, 0.006, 1, cy=0.078), 0.010, axis=2, centre=0.008,
                                mat='body:reflector', steps=1), R, c)
    return body, lens


def tail_finisher(q):
    """Black tailgate handle bar."""
    if q < 0.2:
        return Mesh()
    p, nrm = tail_hit(1.140, 0.0)
    R = frame_from(nrm)
    return placed(slab(rounded_rect(0.200, 0.026, 0.010, seg(3, q, 2)), 0.016, axis=2, centre=0.006,
                       mat='body:plastic', steps=1), R, p)


def boot_plate(q):
    if q < 0.2:
        return Mesh()
    p, nrm = tail_hit(0.880, 0.0)
    R = frame_from(nrm)
    return placed(slab(rounded_rect(0.230, 0.058, 0.008, seg(3, q, 2)), 0.006, axis=2, centre=0.002,
                       mat='body:rubber', steps=1), R, p)


SPARE = (-2.235, 1.020)         # spare wheel centre (x of its mounting face, y)


def spare_wheel(q):
    """The spare on the tailgate (a full tyre and rim, axis along x, outer face to the rear) on
    a black carrier."""
    R = rot((0, 1, 0), -math.pi / 2)
    qq = min(q, 0.6)
    m = Mesh()
    if q < 0.1:
        r0 = RR * 0.96
        t = revolve([(RIM_R, 0.0), (r0 - 0.03, 0.0), (r0, 0.03), (r0, WR - 0.03), (r0 - 0.03, WR), (RIM_R, WR)], 10, closed_profile=True,
                    mat='tyre')
    else:
        t = tyre(RR * 0.96, WR, qq)
    r = rim(WR, qq) if q >= 0.2 else revolve([(0.0, 0.0), (RIM_R, 0.0), (RIM_R, 0.04), (0.0, 0.04)], 8, mat='rim:paint')
    for part in (t, r):
        part.V = part.V @ R.T + np.array([SPARE[0] - WR / 2 - 0.010, SPARE[1], 0.0])
        m += part
    m += revolve([(0.0, 0.0), (0.090, 0.0), (0.090, 0.040), (0.0, 0.045)], seg(16, q, 8), mat='body:steel',
                 axis='x').transform(t=(SPARE[0] + 0.030, SPARE[1], 0.0))
    return m


def flares(q):
    """The Kestrel's bolt-on flares, sized for the big tyres."""
    return _kestrel_flares(q)


def side_steps(q):
    """Black side steps between the arches on short brackets."""
    m = Mesh()
    x0, x1 = XF - ARCH[0][2] - 0.06, XR + ARCH[1][2] + 0.06
    for s in (-1, 1):
        z = 0.930
        st = slab(rounded_rect((x0 - x1) / 2, 0.060, 0.020, seg(3, q, 2), cx=(x0 + x1) / 2, cy=s * (z - 0.040)),
                  0.036, axis=1, centre=0.380, mat='body:plastic', steps=1)
        m += st
        for x in np.linspace(x1 + 0.10, x0 - 0.10, 3 if q >= 0.2 else 2):
            m += strut((x, 0.380, s * 0.84), (x, 0.420, s * 0.76), 0.020, 0.010, n=seg(6, q, 4), mat='body:steel',
                       samples=2)
    return m


def roof_rack(q):
    """Expedition roof rack: two side rails on four feet each, five cross bars."""
    m = Mesh()
    if q < 0.1:
        for s in (-1, 1):
            a, b = canopy(-2.02, s * 0.44) + [0, 0.085, 0], canopy(0.12, s * 0.44) + [0, 0.085, 0]
            m += strut(tuple(a), tuple(b), 0.016, 0.016, n=4, mat='body:steel', samples=2, cap='fan')
            for x in (-1.90, 0.0):
                p = canopy(x, s * 0.44)
                m += strut(tuple(p + [0, -0.005, 0]), tuple(p + [0, 0.080, 0]), 0.020, 0.014, n=4, mat='body:steel',
                           samples=2, cap='fan')
        for x in (-1.95, -0.95, 0.05):
            a, b = canopy(x, -0.44) + [0, 0.085, 0], canopy(x, 0.44) + [0, 0.085, 0]
            m += strut(tuple(a), tuple(b), 0.012, 0.012, n=4, mat='body:steel', samples=2, cap='fan')
        return m
    n = seg(8, q, 5) if q >= 0.2 else 4
    rx = np.linspace(-1.95, 0.05, 5 if q >= 0.2 else 3)
    for s in (-1, 1):
        rail = [canopy(x, s * 0.44) + [0, 0.085, 0] for x in np.linspace(-2.02, 0.12, 6)]
        m += tube(rail, 0.016, n=n, mat='body:steel', samples=seg(12, q, 4))
        for x in np.linspace(-1.90, 0.00, 4 if q >= 0.2 else 2):
            p = canopy(x, s * 0.44)
            m += strut(tuple(p + [0, -0.005, 0]), tuple(p + [0, 0.080, 0]), 0.022, 0.014, n=seg(6, q, 4),
                       mat='body:steel', samples=2)
    for x in rx:
        a, b = canopy(x, -0.44) + [0, 0.085, 0], canopy(x, 0.44) + [0, 0.085, 0]
        m += strut(tuple(a), tuple(b), 0.012, 0.012, n=n, mat='body:steel', samples=2)
    return m


def door_handles(q):
    """Black pull handles on all four doors."""
    m = Mesh()
    for xh in (-0.250, -1.140):
        for s in (-1, 1):
            p, nn = side_frame(xh, 1.150)
            a = p + nn * 0.012 + [0.060, 0, 0]
            b = p + nn * 0.012 - [0.060, 0, 0]
            m += strut(tuple(a * [1, 1, s]), tuple(b * [1, 1, s]), 0.012, 0.010, n=seg(10, q, 6), mat='body:plastic',
                       samples=seg(5, q, 3))
    return m


MIRROR_BASE = 0.640


def door_mirrors(q):
    """Big square black mirrors on the doors (MirrorGlass faces the driver)."""
    if q < 0.2:
        return race_mirrors(q)
    m = Mesh()
    for s in (-1, 1):
        x = MIRROR_BASE
        zb = float(gb_c(x)) + 0.030
        yb_ = float(crown(x, zb))
        base = np.array([x, yb_ + 0.02, s * zb])
        head = np.array([x - 0.030, yb_ + 0.130, s * (zb + 0.150)])
        m += strut(tuple(base), tuple(head - [0, 0.04, s * 0.06]), 0.016, 0.012, n=seg(8, q, 5), mat='body:plastic',
                   samples=3)
        shell = slab(rounded_rect(0.110, 0.080, 0.025, seg(4, q, 2)), 0.060, axis=0, centre=0.0, mat='body:plastic',
                     steps=1)
        shell.transform(t=tuple(head))
        m += shell
        g = slab(rounded_rect(0.100, 0.070, 0.020, seg(4, q, 2)), 0.004, axis=0, centre=0.0, mat='mirror', steps=1)
        g.transform(t=tuple(head - [0.031, 0, 0]))
        m += g
    return m


def sills(q):
    return Mesh()


def fuel_filler(q):
    if q < 0.2:
        return Mesh()
    p, nrm = side_frame(-1.80, 1.060)
    R = frame_from(nrm)
    m = slab(rounded_rect(0.060, 0.060, 0.018, seg(3, q, 2)), 0.008, axis=2, centre=0.002, mat='paint', steps=1)
    return placed(m, R, p)


def snorkel(q):
    """Raised air intake up the right A-pillar (the wading snorkel of an expedition car)."""
    m = Mesh()
    pts = [np.array([1.02, 1.00, 0.935]), np.array([0.90, 1.15, 0.935]), np.array([0.80, 1.28, 0.925])]
    for x in (A_BASE - 0.02, 0.50, 0.36):
        p = canopy(x, 1.0 if x > A_BASE - 0.05 else t_apillar(x) + 0.03)
        pts.append(p + canopy_normal(x, t_apillar(x)) * 0.060 + [0.04, 0, 0])
    pts = np.array(pts)
    m += tube(pts, 0.040, n=seg(12, q, 6), mat='body:plastic', samples=seg(16, q, 6))
    top = pts[-1]
    m += strut(tuple(top), tuple(top + [0.10, 0.03, 0]), 0.050, 0.045, n=seg(12, q, 6), mat='body:plastic',
               samples=2)
    return m


# ---------------------------------------------------------------------------------------------
# Wheels: dark eight-spoke wheels with a bead ring, chunky all-terrain tyres
# ---------------------------------------------------------------------------------------------

def rim(W, q):
    n = seg4(72, q)
    rw = W - 0.050
    zo, zi = rw / 2, -rw / 2
    if q < 0.2:
        return rim_race(W, n)
    R0 = RIM_R
    prof = [(R0 + 0.014, zo + 0.006), (R0 + 0.016, zo - 0.006), (R0 + 0.002, zo - 0.012), (R0, zo - 0.030),
            (R0 - 0.022, zo - 0.045), (R0 - 0.022, zi + 0.040), (R0, zi + 0.025), (R0 + 0.002, zi + 0.010),
            (R0 + 0.013, zi - 0.004), (R0 + 0.012, zi + 0.004), (R0 - 0.003, zi + 0.012), (R0 - 0.027, zi + 0.040),
            (R0 - 0.027, zo - 0.045), (R0 - 0.004, zo - 0.014)]
    m = revolve(prof, n, mat='rim:paint', closed_profile=True)
    zf = zo - 0.034
    m += revolve([(0.0, zf - 0.020), (0.080, zf - 0.020), (0.084, zf - 0.004), (0.076, zf + 0.014), (0.050, zf + 0.018),
                  (0.0, zf + 0.018)], seg(36, q, 10), mat='rim:paint')
    for k in range(8):
        th = k * TAU / 8
        d = np.array([math.cos(th), math.sin(th), 0.0])
        sd = np.array([-math.sin(th), math.cos(th), 0.0])
        a = d * 0.070 + [0, 0, zf + 0.008]
        b = d * (R0 - 0.020) + [0, 0, zf + 0.016]
        P = np.array([lerp(a, b, t) for t in np.linspace(0, 1, seg(4, q, 3))])

        def sec(i, t):
            return ellipse(lerp(0.017, 0.014, t), 0.013, seg(8, q, 6), e=0.40)
        m += sweep(P, sec, 'rim:paint', up=tuple(sd), cap0='flat', cap1='flat')
    # bead ring with bolts (machined)
    m += revolve([(R0 - 0.004, zo + 0.004), (R0 + 0.016, zo + 0.004), (R0 + 0.016, zo + 0.014), (R0 - 0.004, zo + 0.014)],
                 n, mat='rim:chrome', closed_profile=True)
    if q >= 0.6:
        for k in range(16):
            th = k * TAU / 16
            m += revolve([(0.0, zo + 0.022), (0.005, zo + 0.022), (0.006, zo + 0.012), (0.0, zo + 0.012)], 6,
                         mat='rim:chrome').transform(t=(math.cos(th) * (R0 + 0.006), math.sin(th) * (R0 + 0.006), 0))
    m += revolve([(0.0, zf + 0.040), (0.036, zf + 0.038), (0.044, zf + 0.026), (0.044, zf + 0.014), (0.0, zf + 0.014)],
                 seg(20, q, 8), mat='rim:paint')
    for k in range(6):
        th = k * TAU / 6 + TAU / 16
        m += revolve([(0.0, zf + 0.030), (0.010, zf + 0.030), (0.011, zf + 0.014), (0.0, zf + 0.014)], 6,
                     mat='rim:chrome').transform(t=(math.cos(th) * 0.062, math.sin(th) * 0.062, 0))
    return m


def rim_race(W, n):
    rw = W - 0.050
    zo, zi = rw / 2, -rw / 2
    prof = [(0.0, zo - 0.030), (RIM_R - 0.015, zo - 0.030), (RIM_R + 0.016, zo), (RIM_R + 0.016, zi),
            (RIM_R - 0.02, zi), (0.0, zi)]
    m = revolve(prof, n, mat='rim:paint')
    m += revolve([(0.0, zo - 0.032), (0.044, zo - 0.032), (0.044, zo + 0.008), (0.0, zo + 0.010)], 8, mat='rim:paint')
    return m


def upright(front, q):
    W = WF if front else WR
    zc = -W / 2 + 0.030
    m = Mesh()
    n = seg(40, q, 10)
    m += revolve([(0.080, zc - 0.026), (0.165, zc - 0.026), (0.165, zc + 0.000), (0.080, zc + 0.000)], n,
                 mat='body:discp', closed_profile=True)
    na = seg(12, q, 4)
    angs = np.radians(np.linspace(100, 148, na))
    path = np.stack([np.cos(angs) * 0.146, np.sin(angs) * 0.146, np.full(na, zc - 0.013)], -1)
    if q < 0.2:
        return m + sweep(path, lambda i, t: ellipse(0.028, 0.032, 4, e=0.35), 'body:caliper', cap0='fan', cap1='fan',
                         up=(0, 0, 1))
    m += sweep(path, lambda i, t: ellipse(0.028, 0.034, seg(12, q, 6), e=0.30), 'body:caliper', cap0='dome',
               cap1='dome', up=(0, 0, 1), dome_depth=0.010, dome_steps=2)
    m += blob((0.0, 0.0, zc - 0.064), (0.055, 0.160, 0.028), n=seg(16, q, 6), rings=seg(10, q, 4), e1=0.55, e2=0.6,
              mat='body:metal')
    return m


# ---------------------------------------------------------------------------------------------
# Cabin: high seats, a tall upright dash, a chunky wheel, a cargo floor behind the rear bench
# ---------------------------------------------------------------------------------------------

DASH = [(0.640, 0.866 + KDY), (0.600, 0.910 + KDY), (0.540, 0.944 + KDY), (0.478, 0.952 + KDY),
        (0.430, 0.940 + KDY), (0.410, 0.893 + KDY), (0.408, 0.700 + KDY), (0.440, 0.640 + KDY), (0.640, 0.640 + KDY)]
GAUGE_POS = [(0.880 + KDY, -0.490, 0.048), (0.880 + KDY, -0.310, 0.048), (0.836 + KDY, -0.140, 0.030),
             (0.836 + KDY, -0.050, 0.030)]
HELMET_C = np.array([-0.440, 1.505, DRIVER_Z])
GLOW_C = np.array([0.36, 0.86 + KDY, DRIVER_Z * 0.6])
WHEEL_R = 0.190


def _fascia(q):
    m = slab(rounded_rect(0.052, 0.780, 0.008, seg(3, q, 2)), 0.006, axis=0, centre=0.403, mat='int:metal', steps=1)
    m.transform(t=(0, 0.850 + KDY, 0))
    return m


def console(q):
    m = Mesh()
    m += blob((-0.10, 0.340 + KDY, 0.0), (0.600, 0.150, 0.130), n=seg(16, q, 6), rings=seg(8, q, 4), e1=0.35,
              e2=0.35, mat='int:dash')
    m += strut((0.12, 0.48 + KDY, 0.0), (0.08, 0.64 + KDY, 0.0), 0.008, 0.008, n=seg(8, q, 4), mat='int:black',
               samples=3)
    m += blob((0.074, 0.655 + KDY, 0.0), (0.024, 0.026, 0.024), n=seg(12, q, 6), rings=seg(6, q, 4), mat='int:black')
    # transfer-case lever
    m += strut((0.06, 0.48 + KDY, 0.06), (0.03, 0.58 + KDY, 0.06), 0.006, 0.006, n=seg(8, q, 4), mat='int:black',
               samples=3)
    m += blob((0.026, 0.590 + KDY, 0.06), (0.016, 0.018, 0.016), n=seg(10, q, 5), rings=seg(5, q, 3),
              mat='int:metal')
    return m


def binnacle(q):
    m = Mesh()
    n = seg(24, q, 8)
    for y, z, r in GAUGE_POS[:2]:
        ring = revolve([(r + 0.004, 0.000), (r + 0.012, 0.004), (r + 0.012, 0.030), (r + 0.008, 0.034),
                        (r + 0.003, 0.030), (r + 0.003, 0.006)], n, mat='int:dash', axis='x', closed_profile=True)
        ring.transform(t=(0.392 - 0.028, y, z))
        m += ring
    ang = np.linspace(math.radians(25), math.radians(155), seg(16, q, 6))
    pts = [(0.43, GAUGE_POS[0][0] + 0.024 + 0.062 * math.sin(a), DRIVER_Z + 0.170 * math.cos(a)) for a in ang]
    m += sweep(np.array(pts), lambda i, t: ellipse(0.050, 0.006, seg(8, q, 4), e=0.5), 'int:dash',
               up=(1, 0, 0), dome_depth=0.004, dome_steps=1)
    # inclinometer pod and switches on the centre stack
    m += revolve([(0.0, -0.0015), (0.034, -0.0015), (0.034, 0.0015), (0.0, 0.0015)], seg(24, q, 8), mat='int:gauge',
                 axis='x').transform(t=(0.392, 0.840 + KDY, 0.060))
    m += revolve([(0.032, -0.008), (0.040, -0.006), (0.041, 0.002), (0.032, 0.003)], seg(24, q, 8), mat='int:metal',
                 axis='x', closed_profile=True).transform(t=(0.392, 0.840 + KDY, 0.060))
    for k in range(6):
        z = -0.06 + k * 0.040
        m += strut((0.402, 0.770 + KDY, z), (0.384, 0.772 + KDY, z), 0.004, 0.004, n=seg(6, q, 4), mat='int:metal',
                   samples=2)
    # grab handle across the passenger side of the dash
    m += tube([(0.47, 0.98 + KDY, 0.12), (0.43, 1.02 + KDY, 0.28), (0.43, 1.02 + KDY, 0.52), (0.47, 0.98 + KDY, 0.66)],
              0.012, n=seg(8, q, 5), mat='int:black', samples=seg(10, q, 4))
    return m


def door_cards(q):
    m = Mesh()
    for s in (-1, 1):
        ci = float(ci_c(0.10))
        z = s * (ci - 0.010)
        pts = [(x, float(crown(x, ci)) - 0.040, z) for x in np.linspace(-0.30, 0.62, 6)]
        m += tube(pts, 0.024, n=seg(10, q, 6), mat='int:dash', samples=seg(10, q, 4))
        m += blob((0.12, 0.640 + KDY, z - s * 0.016), (0.360, 0.170, 0.016), n=seg(14, q, 6), rings=seg(6, q, 4),
                  e1=0.25, e2=0.25, mat='int:dash')
        m += blob((0.08, 0.640 + KDY, z - s * 0.036), (0.240, 0.026, 0.030), n=seg(14, q, 6), rings=seg(6, q, 4),
                  e1=0.4, e2=0.4, mat='int:leather')
        m += strut((0.34, 0.760 + KDY, z - s * 0.022), (0.27, 0.760 + KDY, z - s * 0.028), 0.006, 0.010,
                   n=seg(8, q, 5), mat='int:metal', samples=3)
    return m


def _cargo(q):
    m = slab(rounded_rect(0.36, 0.74, 0.04, seg(3, q, 2)), 0.016, axis=1, centre=0.0, mat='int:carpet', steps=1)
    m.transform(t=(-1.72, TUB_FLOOR + 0.10, 0))
    return m


def cabin(q):
    m = Mesh()
    m += dash_body(q, half=0.800)
    m += _fascia(q)
    if q >= 0.6:
        m += gauges(q)
    for z in (DRIVER_Z, -DRIVER_Z):
        m += _seat(q, z)
    m += _seat(q, 0.0, x0=-1.10, front=False).transform(s=(1, 1, 1.70))
    if q < 0.1:
        return m
    m += console(q)
    m += strut(tuple(np.array(WHEEL_CENTRE) + [0.06, -0.03, 0]), (0.45, 0.80 + KDY, DRIVER_Z), 0.024, 0.024,
               n=seg(10, q, 6), mat='int:black', samples=3)
    m += panel((C_TOP + 0.04, A_TOP + 0.10), (-0.59, 0.59), seg(16, q, 3), seg(8, q, 2), 0.006, 'int:headliner',
               inset=0.024)
    m += _cargo(q)
    return m


def cockpit_shell(q):
    m = Mesh()
    m += dash_body(q, half=0.800)
    m += _fascia(q)
    m += gauges(q)
    m += binnacle(q)
    for z in (DRIVER_Z, -DRIVER_Z):
        m += _seat(q, z)
    m += _seat(q, 0.0, x0=-1.10, front=False).transform(s=(1, 1, 1.70))
    m += console(q)
    m += strut(tuple(np.array(WHEEL_CENTRE) + [0.06, -0.03, 0]), (0.45, 0.80 + KDY, DRIVER_Z), 0.024, 0.024,
               n=seg(12, q, 6), mat='int:black', samples=3)
    m += _cargo(q)
    m += door_cards(q)
    m += pillar_trims(q)
    m += rear_view_mirror(q)
    return m


def steering_wheel(q):
    """Chunky four-spoke wheel with a padded boss."""
    m = Mesh()
    n = seg(56, q, 10)
    ang = np.arange(n) / n * TAU
    path = np.stack([np.zeros(n), WHEEL_R * np.cos(ang), WHEEL_R * np.sin(ang)], -1)
    m += sweep(path, lambda i, t: ellipse(0.0140, 0.0165, seg(10, q, 4)), 'int:black', closed=True, up=(1, 0, 0))
    if q < 0.1:
        return m + revolve([(0.0, 0.0), (0.050, 0.0), (0.050, 0.05), (0.0, 0.055)], 8, mat='int:dash', axis='x')
    for a in (math.radians(200), math.radians(-20), math.radians(250), math.radians(-70)):
        d = np.array([0.0, math.cos(a), math.sin(a)])
        side = np.array([0.0, -math.sin(a), math.cos(a)])
        pts = [d * 0.050 + [0.040, 0, 0], d * 0.110 + [0.018, 0, 0], d * (WHEEL_R - 0.006)]
        m += sweep(catmull(pts, seg(8, q, 3)), lambda i, t: ellipse(0.006, 0.020 - 0.004 * t, seg(6, q, 4)),
                   'int:dash', up=tuple(side), dome_depth=0.004, dome_steps=1)
    m += blob((0.040, -0.010, 0.0), (0.030, 0.060, 0.080), n=seg(16, q, 6), rings=seg(8, q, 4), e1=0.5, e2=0.5,
              mat='int:dash')
    m += revolve([(0.0, 0.004), (0.020, 0.004), (0.019, 0.010), (0.0, 0.012)], seg(16, q, 8), mat='int:metal',
                 axis='x').transform(t=(0.0, -0.005, 0.0))
    return m


def hands(q):
    return _aurelia_hands(q)


def driver(q):
    m = _kestrel_driver(q)
    m.mats = ['driver:jacket' if k == 'driver:suit' else k for k in m.mats]
    return m


def exhaust(q):
    """One pipe turned down under the left rear corner."""
    m = Mesh()
    n = seg(20, q, 8)
    pipe = revolve([(0.034, 0.0), (0.038, -0.185), (0.039, -0.190), (0.039, -0.205), (0.031, -0.205),
                    (0.030, -0.010)], n, mat='body:steel', axis='x', closed_profile=True)
    pipe.transform(t=(-1.98, 0.500, -0.62))
    m += pipe
    if q >= 0.2:
        soot = revolve([(0.0, -0.185), (0.0305, -0.185), (0.0305, -0.181), (0.0, -0.181)], n, mat='body:inlet',
                       axis='x')
        soot.transform(t=(-1.98, 0.500, -0.62))
        m += soot
    return m


# ---------------------------------------------------------------------------------------------
# Livery: panel gaps; factory expedition livery: a black bonnet panel, a dark lower body, an
# orange stripe along the waist (the factory sand's luminance), the name on the rear doors
# ---------------------------------------------------------------------------------------------

DOORS = (0.720, -0.330, -1.230)
STRIPE = (0.95, 0.40, 0.08)


def livery(group, P, N, valid):
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    az = np.abs(z)
    zero = np.zeros(P.shape[:2], np.float32)
    side_n = lambda s: np.array([0, 0, s], float)
    if group == 'CarPaint':
        g = zero.copy()
        W = 0.0040
        side = valid & (np.abs(N[..., 2]) > 0.35)
        top = valid & (N[..., 1] > 0.30)
        yb = np.vectorize(lambda v: float(yb_c(v)))(x)
        sill = yb + 0.100
        belt = np.vectorize(lambda v: float(crown(v, gb_c(np.clip(v, GH_X[0], GH_X[1])))))(x)
        in_door = (x < DOORS[0] + 0.004) & (x > DOORS[2] - 0.004)
        for xd in DOORS:
            g = np.maximum(g, lv.line(x - xd, W) * side * (y > sill - 0.005) * (y < belt + 0.01))
        g = np.maximum(g, lv.line(y - sill, W) * side * in_door * (az > 0.7))
        bon = (x > 0.76) & (x < fx(2.24))
        g = np.maximum(g, lv.line(x - 0.760, W) * top * (az < 0.86))
        g = np.maximum(g, lv.line(az - 0.86, W) * top * bon)
        # tailgate shut lines on the back
        back = valid & (N[..., 0] < -0.5)
        g = np.maximum(g, lv.line(az - 0.80, W) * back * (y > 0.78))
        shade = 1.0 - 0.62 * np.clip(g, 0, 1)
        dark = zero.copy()
        # black bonnet panel and a dark lower body below the swage line
        dark = np.maximum(dark, 0.88 * top * lv.band(x, 0.80, 1.70, 0.004) * lv.band(az, -1, 0.62, 0.004))
        ym = np.vectorize(lambda v: float(ymx_c(v)))(x)
        dark = np.maximum(dark, 0.55 * side * lv.band(ym - y, 0.006, 0.6, 0.003))
        nm = lv.text_mask('RIDGEBACK')
        for s in (-1, 1):
            dark = np.maximum(dark, 0.92 * lv.stamp(P, N, valid, nm, (-0.80, 1.080, s * 0.92), (s, 0, 0), (0, 1, 0), 0.56,
                                                    facing=side_n(s), min_dot=0.5, depth=0.08))
        shade = shade * (1 - np.clip(dark, 0, 0.95))
        k = _lum(FACTORY_PAINT) / _lum(STRIPE)
        col = tuple(min(1.0, c * k) for c in STRIPE)
        ys = np.vectorize(lambda v: float(ysh_c(v)))(x)
        wb = lv.band(ys - y, 0.030, 0.060, 0.003) * side * (x > -2.16) * (x < 2.26)
        return {'shade': shade, 'layers': [(np.clip(wb, 0, 1) * valid, col)]}
    if group == 'Body':
        layers = []
        p, nrm = tail_hit(0.880, 0.0)
        layers.append((lv.stamp(P, N, valid, lv.text_mask('RB 4X4', oblique=False), (fx(p[0]) - 0.006, 0.880, 0.0),
                                (0, 0, 1), (0, 1, 0), 0.30, facing=(-1, 0, 0), min_dot=0.5, depth=0.03),
                       (0.85, 0.85, 0.84), 0.5))
        pb, nb = nose_hit(BADGE_Y, 0.0)
        layers.append((lv.stamp(P, N, valid, lv.text_mask('RIDGEBACK', oblique=False), (fx(pb[0] + 0.006), BADGE_Y, 0.0),
                                (0, 0, 1), (0, 1, 0), 0.125, facing=nb, min_dot=0.6, depth=0.012), (0.80, 0.80, 0.80),
                       0.2))
        return {'layers': layers}
    return {}


def build(q):
    body = body_shell(q) + greenhouse(q) + grille(q)
    if q >= 0.1:
        body += window_trims(q)
    glass = glass_panels(q)
    head, tail = Mesh(), Mesh()
    for s in (-1, 1):
        b_, l_, g_ = headlamp_parts(q, s)
        body += b_
        head += l_
        glass += g_
    tb, tl = tail_lamps(q)
    body += tb
    tail += tl
    body += nose_badge(q) + bumpers(q) + boot_plate(q) + tail_finisher(q) + flares(q) + spare_wheel(q)
    body += door_mirrors(q) + fuel_filler(q) + wipers(q) + roof_rack(q)
    if q >= 0.2:
        body += indicators(q) + door_handles(q) + side_steps(q) + snorkel(q)
    ext = {'body': body, 'glass': glass, 'exhaust': exhaust(q), 'headlight_lens': head, 'taillight_lens': tail}
    fit_overhangs(ext)
    return {
        **ext,
        'window_L': door_glass(q, -1),
        'window_R': door_glass(q, 1),
        'interior': cabin(q),
        'driver': driver(q),
        'steering_wheel': steering_wheel(q),
        'tyre_front': tyre(RF, WF, q), 'rim_front': rim(WF, q),
        'tyre_rear': tyre(RR, WR, q), 'rim_rear': rim(WR, q),
        'upright_front': upright(True, q), 'upright_rear': upright(False, q),
    }


RENDER_VIEWS = {
    'gt_lights': ((3.40, 1.35, 1.50), (2.30, 1.02, 0.55), 45),
    'gt_grille': ((3.90, 1.15, 0.55), (2.35, 0.98, 0.0), 48),
    'gt_wheel': ((2.45, 0.62, 2.00), (1.44, 0.43, 0.98), 62),
    'gt_tail': ((-3.55, 1.45, 1.55), (-2.25, 1.00, 0.45), 45),
    'gt_interior': ((0.05, 1.85, 2.45), (-0.40, 1.30, 0.0), 40),
    'gt_window': ((0.60, 1.65, 3.30), (0.15, 1.40, 0.0), 38),
}


META = make_meta()
