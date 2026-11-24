"""Stallion (sv-stallion): the launch king, a late-1960s muscle coupe, 4.75 m. Batch 1.

An original design in the spirit of the current Stallion: a long bonnet with a power dome and a
scoop, a short deck ending in a ducktail, broad hips over the rear wheels (a coke-bottle waist),
a low semi-fastback roof with a long quarter window, a deep full-width grille with the round lamps
set in its ends, chrome blade bumpers, wide wrap-round tail lamps, side scoops ahead of the rear
wheels and five-spoke mag wheels on raised-letter tyres. No real manufacturer's shapes, badges or
names.

It inherits the Kestrel (which inherits the Aurelia): the subdivision-cage body, the canopy and
sliding windows, ray hits, the cabin, hands and cockpit machinery. This file redefines the
blueprint curves, the greenhouse and the parts that make the car.

Measured from the shipped model (public/assets/models/sv_stallion.glb at 4.75 m): front axle
x +1.3245, rear -1.2875 (wheelbase 2.612 m), tyre radius 0.366 / 0.364 m, half-track 0.8485 /
0.8425 m.
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from inherit import inherit  # noqa: E402

inherit('kz_kestrel', globals())
B_MAT = 'body:chrome'           # chrome B posts (period muscle coupe)
_kestrel_driver = driver

import livery as lv  # noqa: E402
from meshkit import (Curve, Mesh, blob, catmull, ellipse, lerp, loft, norm, patch_slab, revolve, rot,  # noqa: E402
                     rounded_rect, slab, smoothstep, strut, sweep, tube, window, TAU)

ID = 'sv-stallion'
FILE = 'sv_stallion'
LENGTH = 4.75

XF, XR = 1.3245, -1.2875
RF, RR = 0.366, 0.364
TF, TR = 0.8485, 0.8425
WF, WR = 0.235, 0.255
RIM_R = 0.2032                  # 16-inch mags
NOSE, TAIL = 2.375, -2.375
DRIVER_Z = -0.375
KDY = 0.040
EYE = (-0.300, 1.140, DRIVER_Z)
WHEEL_CENTRE = (0.090, 0.915, DRIVER_Z)
WHEEL_TILT = math.radians(26)
FACTORY_PAINT = (0.045, 0.13, 0.50)    # linear RGB: bright royal blue
LEATHER = (0.040, 0.040, 0.043)        # black vinyl
TYRE_WORDS = ['APEX OVERDRIVE', 'STALLION', 'APEX OVERDRIVE', 'STALLION']
TYRE_HW = WF / 2
TYRE_BAND = None
TYRE_BLOCKS = 0
TYRE_NP_MIN = 10
TYRE_TEXT_R = (0.060, 0.026)
GLOVE = (0.34, 0.20, 0.11)             # light brown driving gloves
RIM_TUBE = 0.0135                   # the Aurelia wood-rim wheel
HEADLINER = (0.045, 0.045, 0.048)
METAL = (0.66, 0.66, 0.67)
METAL_RM = (0.36, 0.55)
CALIPER = (0.10, 0.10, 0.105)
RIM_PAINT = (0.52, 0.53, 0.55)         # satin silver mag spokes
STEEL = (0.035, 0.035, 0.038)
GAUGES = [
    {'label': 'MPH', 'max': 160, 'ticks': 8, 'needle': 0.14},
    {'label': 'RPM x1000', 'max': 8, 'ticks': 8, 'needle': 0.12},
    {'label': 'FUEL', 'max': 100, 'ticks': 4, 'needle': 0.70},
    {'label': 'TEMP', 'max': 120, 'ticks': 4, 'needle': 0.45},
]

# ---------------------------------------------------------------------------------------------
# Body blueprint
# ---------------------------------------------------------------------------------------------

yb_c = Curve([(2.31, 0.320), (2.20, 0.262), (2.00, 0.215), (1.70, 0.190), (1.00, 0.176), (0.00, 0.170),
              (-1.00, 0.176), (-1.65, 0.198), (-1.95, 0.232), (-2.18, 0.282), (-2.31, 0.340)])
# plan: a long, square nose, a slim waist at the doors and broad hips over the rear wheels
hw_c = Curve([(2.31, 0.872), (2.26, 0.906), (2.16, 0.932), (1.95, 0.950), (1.60, 0.958), (1.20, 0.956), (0.70, 0.946),
              (0.10, 0.940), (-0.40, 0.946), (-0.80, 0.962), (-1.10, 0.978), (-1.40, 0.982), (-1.70, 0.974),
              (-1.98, 0.954), (-2.18, 0.928), (-2.31, 0.900)])
ymx_c = Curve([(2.31, 0.610), (1.60, 0.690), (0.50, 0.705), (-0.60, 0.712), (-1.60, 0.722), (-2.31, 0.700)])
# fender line: long and level from the nose, kicking up over the hips
ysh_c = Curve([(2.31, 0.836), (2.22, 0.858), (2.05, 0.884), (1.70, 0.910), (1.20, 0.924), (0.90, 0.930), (0.30, 0.926),
               (-0.35, 0.928), (-0.70, 0.940), (-0.95, 0.960), (-1.20, 0.972), (-1.60, 0.970), (-2.00, 0.962),
               (-2.31, 0.952)])
shd_c = Curve([(2.31, 0.060), (1.60, 0.078), (0.30, 0.086), (-1.00, 0.088), (-2.31, 0.072)])
# centre line: a long bonnet with a power dome, the tub, a short deck with a ducktail
top_c = Curve([(2.31, 0.850), (2.22, 0.880), (2.05, 0.918), (1.70, 0.958), (1.30, 0.986), (0.90, 1.002), (0.66, 1.006),
               (0.45, 1.050), (-0.60, 1.050), (-1.30, 1.050), (-1.48, 0.972), (-1.70, 0.968), (-1.95, 0.972),
               (-2.15, 0.982), (-2.26, 0.996), (-2.31, 1.008)])

CABIN = (-1.44, 0.60)
TUB_FLOOR = 0.220
ci_c = Curve([(0.70, 0.765), (-0.45, 0.765), (-0.65, 0.620), (-1.48, 0.600)])
ZWELL = 0.660
ARCH = [(XF, RF + 0.010, RF + 0.040), (XR, RR + 0.010, RR + 0.042)]
FACE_X = 2.255
FACE_D = 0.048
MOUTH = (0.600, 0.790, 0.106)   # deep full-width grille
MOUTH_E = (0.14, 0.30)
MOUTH_DROOP = 0.0
BULGE = 0.034                   # power dome
BULGE_W = 0.200
ROW_Z = (0.10, 0.215, 0.320)
STATION_XS = (-2.31, -2.22, -2.10, -1.96, -1.80, -0.80, -0.55, -0.28, 0.0, 0.24, 0.44, 0.60, 0.74, 1.86, 1.98,
              2.08, 2.17)
TAIL_TURN = (0.036, 0.90)
ROW_IN = (0.125, 0.078, 0.034)
SIDE_CREASE = 0.65
OVERHANG = 2.00


def bulge_w(x):
    return float(window(x, 0.80, 2.06, 0.30))


def crown_e(x):
    return 3.4 - 0.4 * smoothstep(-1.60, -2.20, x)


def tip_shift(x, z, y=0.0):
    """The fender tips reach past the grille (a bladed nose); the tail corners stay square."""
    z = np.abs(z)
    return (0.028 * smoothstep(2.08, FACE_X, x) * smoothstep(0.62, 0.82, z)
            - 0.012 * smoothstep(-2.22, -2.31, x) * smoothstep(0.55, 0.75, z))


def gb_c(x):
    return float(Curve([(0.668, 0.770), (0.56, 0.806), (0.30, 0.822), (-0.40, 0.824), (-0.90, 0.812), (-1.20, 0.774),
                        (-1.40, 0.712), (-1.48, 0.672)])(x))


# ---------------------------------------------------------------------------------------------
# Greenhouse: low, raked windscreen, a semi-fastback roof sloping to the short deck
# ---------------------------------------------------------------------------------------------

yr_c = Curve([(0.668, 0.996), (0.60, 1.050), (0.50, 1.127), (0.40, 1.194), (0.30, 1.250), (0.20, 1.293), (0.10, 1.324),
              (0.00, 1.344), (-0.20, 1.362), (-0.40, 1.366), (-0.60, 1.358), (-0.78, 1.338), (-0.92, 1.304),
              (-1.05, 1.254), (-1.18, 1.190), (-1.30, 1.118), (-1.40, 1.046), (-1.48, 0.982)])
GH_X = (-1.48, 0.668)
A_TOP, A_BASE = 0.095, 0.665
B_X = -0.560
C_TOP, C_BASE = -0.800, -1.150
RW = (-1.430, -0.900, 0.360)
WIN_X = 0.0
CANT_K, TUMBLE, ROOF_E, ROOF_ZE, SIDE_BOW = 0.78, 0.46, 0.70, 1.0, 0.010

# ---------------------------------------------------------------------------------------------
# Front: deep grille with the lamps in its ends, chrome bumper; bonnet scoop
# ---------------------------------------------------------------------------------------------

LAMPS = [(0.668, 0.084)]
LAMP_Y = 0.600


def grille(q):
    """Deep black egg-crate grille filling the mouth, a chrome surround and a chrome horizontal
    bar across its middle (between the lamps)."""
    m = Mesh()
    cy, ma, mb = MOUTH
    n = seg(64, q, 14)
    ring = mouth_outline(n, 0.002, _mx() + 0.001)
    m += sweep(ring, lambda i, t: ellipse(0.0055, 0.0075, seg(8, q, 4)), 'body:chrome', closed=True)
    xg = _mx() - 0.060
    back = slab(rounded_rect(mb * 0.97, ma * 0.985, 0.020, seg(4, q, 2)), 0.006, axis=0, centre=xg - 0.010,
                mat='body:grille', steps=1)
    back.transform(t=(0, cy, 0))
    m += back
    if q < 0.2:
        return m
    zin = LAMPS[0][0] - LAMPS[0][1] - 0.030
    # egg crate: vertical and horizontal black blades
    nb = 21 if q >= 0.6 else 9
    for z in np.linspace(-zin, zin, nb):
        b = slab(rounded_rect(mb * 0.90, 0.0030, 0.002, 1), 0.030, axis=0, centre=xg + 0.012, mat='body:inlet',
                 steps=1)
        b.transform(t=(0, cy, z))
        m += b
    for yy in np.linspace(cy - mb * 0.62, cy + mb * 0.62, 4 if q >= 0.6 else 2):
        b = slab(rounded_rect(0.0030, zin, 0.002, 1), 0.030, axis=0, centre=xg + 0.012, mat='body:inlet', steps=1)
        b.transform(t=(0, yy, 0))
        m += b
    hb = slab(rounded_rect(0.008, ma * 0.96, 0.004, 1), 0.014, axis=0, centre=_mx() - 0.010, mat='body:chrome',
              steps=1)
    hb.transform(t=(0, cy, 0))
    m += hb
    return m


def headlamp_parts(q, s):
    """Round lamps set in the grille's ends, each in a chrome bucket. Returns (body, lens, glass)."""
    body, lens, glass = Mesh(), Mesh(), Mesh()
    R = frame_from((1.0, 0.0, 0.0))
    for z, r in LAMPS:
        c = np.array([_mx() - 0.030, LAMP_Y, s * z])
        n = seg(36, q, 8)
        body += placed(revolve([(r + 0.001, 0.014), (r + 0.014, 0.012), (r + 0.016, -0.040), (r + 0.001, -0.040)],
                               n, mat='body:chrome', closed_profile=True), R, c)
        if q >= 0.2:
            body += placed(revolve([(r - 0.004, -0.002), (r * 0.75, -0.024), (r * 0.42, -0.040), (0.016, -0.046),
                                    (0.012, -0.042), (r * 0.40, -0.035), (r * 0.72, -0.020), (r - 0.006, 0.000)], n,
                                   mat='body:reflector', closed_profile=True), R, c)
        else:
            body += placed(revolve([(r + 0.001, 0.004), (r * 0.5, -0.020), (0.0, -0.026)], n, mat='body:reflector'),
                           R, c)
        lens += placed(revolve([(0.0, -0.030), (0.022, -0.030), (0.024, -0.020), (0.018, -0.012), (0.0, -0.010)],
                               seg(16, q, 6), mat='headlight_lens'), R, c)
        glass += placed(revolve([(0.0, 0.016), (r * 0.6, 0.013), (r + 0.004, 0.008), (r + 0.010, 0.003)], n,
                                mat='glass:clear'), R, c)
    return body, lens, glass


def indicators(q):
    """Rectangular amber parking lamps in the valance under the bumper."""
    m = Mesh()
    for s in (-1, 1):
        p, nrm = nose_hit(0.375, s * 0.560)
        R = frame_from(norm(nrm + np.array([0.6, 0, 0])))
        m += placed(slab(rounded_rect(0.075, 0.020, 0.008, seg(3, q, 2)), 0.014, axis=2, centre=0.0,
                         mat='body:amber', steps=1), R, p)
        m += placed(slab(rounded_rect(0.081, 0.026, 0.010, seg(3, q, 2)), 0.008, axis=2, centre=-0.004,
                         mat='body:chrome', steps=1), R, p)
    return m


BADGE_Y = 0.600


def nose_badge(q):
    """A chrome-ringed shield on the grille's centre bar."""
    if q < 0.2:
        return Mesh()
    c = np.array([_mx() + 0.004, BADGE_Y, 0.0])
    R = frame_from((1.0, 0.0, 0.0))
    m = placed(slab(rounded_rect(0.040, 0.030, 0.012, seg(3, q, 2)), 0.008, axis=2, centre=0.0, mat='body:badge',
                    steps=1), R, c)
    m += placed(slab(rounded_rect(0.046, 0.036, 0.014, seg(3, q, 2)), 0.006, axis=2, centre=-0.003,
                     mat='body:chrome', steps=1), R, c)
    return m


def bumpers(q):
    """Chrome blade bumpers wrapping round the corners, front and rear."""
    m = Mesh()
    zs = [0.0, 0.30, 0.55, 0.72, 0.82, 0.88, 0.92]
    fpath = _bumper_path(nose_hit, 0.448, 1, zs, 0.026)
    fpath = [(fpath[0][0] - 0.16, fpath[0][1] * 1.02)] + fpath + [(fpath[-1][0] - 0.16, fpath[-1][1] * 1.02)]
    m += blade(fpath, 0.448, 0.040, 0.020, q)
    rzs = [0.0, 0.30, 0.55, 0.72, 0.82, 0.88, 0.92]
    rpath = _bumper_path(tail_hit, 0.520, -1, rzs, 0.026)
    rpath = [(rpath[0][0] + 0.16, rpath[0][1] * 1.02)] + rpath + [(rpath[-1][0] + 0.16, rpath[-1][1] * 1.02)]
    m += blade(rpath, 0.520, 0.040, 0.020, q)
    return m


def hood_scoop(q):
    """A raised scoop on the power dome, open at the front (black inlet, chrome lip)."""
    m = Mesh()
    x0, x1 = 1.10, 1.56
    ns = seg(10, q, 4)
    rings = []
    for x in np.linspace(x0, x1, ns):
        u = (x - x0) / (x1 - x0)
        y0 = float(crown(x, 0.0)) - 0.010
        h = 0.010 + 0.042 * smoothstep(0.0, 0.85, u)
        w = 0.130 + 0.030 * u
        sec = rounded_rect(w, h / 2 + 0.002, min(0.020, h / 2), seg(3, q, 2))
        rings.append(np.stack([np.full(len(sec), x), y0 + h / 2 + sec[:, 1], sec[:, 0]], -1))
    m += loft(np.array(rings), 'paint', cap0='fan', cap1='fan').orient_outward()
    if q >= 0.2:
        y0 = float(crown(x1, 0.0)) - 0.010
        h = 0.052
        inl = slab(rounded_rect(h / 2 - 0.004, 0.150, 0.014, seg(3, q, 2)), 0.006, axis=0, centre=x1 + 0.001,
                   mat='body:inlet', steps=1)
        inl.transform(t=(0, y0 + h / 2 + 0.002, 0))
        m += inl
    return m


TAIL_Y = 0.800


def tail_lamps(q):
    """Wide wrap-round tail lamps across most of the tail, each split by chrome bars; red lenses
    with a clear reverse lamp at the inner end. Returns (body, lens)."""
    body, lens = Mesh(), Mesh()
    for s in (-1, 1):
        for k, zc in enumerate((0.46, 0.70)):
            p, nrm = tail_hit(TAIL_Y, s * zc)
            axis = norm(nrm * 0.9 + np.array([-0.1, 0.0, 0.0]))
            R = frame_from(axis)
            c = p + axis * 0.003
            body += placed(slab(rounded_rect(0.124, 0.050, 0.010, seg(3, q, 2)), 0.018, axis=2, centre=-0.004,
                                mat='body:chrome', steps=1), R, c)
            lens += placed(slab(rounded_rect(0.112, 0.040, 0.008, seg(3, q, 2)), 0.010, axis=2, centre=0.006,
                                mat='taillight_lens', steps=1), R, c)
            if q >= 0.2:
                for dx in (-0.040, 0.0, 0.040):
                    body += placed(slab(rounded_rect(0.003, 0.040, 0.0015, 1, cx=dx), 0.012, axis=2, centre=0.010,
                                        mat='body:chrome', steps=1), R, c)
        if q >= 0.2:
            p, nrm = tail_hit(TAIL_Y, s * 0.300)
            R = frame_from(nrm)
            body += placed(slab(rounded_rect(0.030, 0.030, 0.008, seg(3, q, 2)), 0.012, axis=2, centre=0.004,
                                mat='body:reflector', steps=1), R, p)
    return body, lens


def tail_finisher(q):
    """Black tail panel strip between the lamps with a chrome edge (the car's name in the livery)."""
    p, nrm = tail_hit(TAIL_Y, 0.0)
    R = frame_from(nrm)
    m = placed(slab(rounded_rect(0.235, 0.044, 0.008, seg(3, q, 2)), 0.006, axis=2, centre=0.001, mat='body:rubber',
                    steps=1), R, p)
    if q >= 0.2:
        m += placed(slab(rounded_rect(0.241, 0.050, 0.010, seg(3, q, 2)), 0.004, axis=2, centre=-0.002,
                         mat='body:chrome', steps=1), R, p)
    return m


def boot_plate(q):
    """Number plate under the rear bumper's centre."""
    p, nrm = tail_hit(0.420, 0.0)
    R = frame_from(nrm)
    return placed(slab(rounded_rect(0.230, 0.055, 0.008, seg(3, q, 2)), 0.006, axis=2, centre=0.002,
                       mat='body:rubber', steps=1), R, p)


def side_scoops(q):
    """Fake scoops on the rear quarters ahead of the rear wheels: a dark recess with chrome
    strakes and surround."""
    m = Mesh()
    if q < 0.2:
        return m
    x0, x1, y0, y1 = -0.92, -0.68, 0.600, 0.700
    v = surface_patch(x0, x1, y0, y1, seg(10, q, 4), seg(5, q, 3), 0.004, 'body:inlet', out=0.0005)
    n = seg(8, q, 4)
    for s in (-1, 1):
        mm = v.copy()
        if s < 0:
            mm = mm.mirrored_z()
        m += mm
        for yy in np.linspace(y0 + 0.020, y1 - 0.020, 3):
            pts = []
            for xx in np.linspace(x0 + 0.015, x1 - 0.015, 4):
                p, nn = side_frame(xx, yy)
                pts.append(p + nn * 0.006)
            m += tube(np.array(pts) * [1, 1, s], 0.0040, n=n, mat='body:chrome', samples=seg(6, q, 3))
        ring = []
        for xx, yy in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
            p, nn = side_frame(xx, yy)
            ring.append(p + nn * 0.004)
        R_ = np.array(ring) * [1, 1, s]
        P = np.vstack([np.linspace(R_[k], R_[(k + 1) % 4], 5)[:-1] for k in range(4)])
        m += sweep(P, lambda i, t: ellipse(0.0045, 0.0045, n), 'body:chrome', closed=True)
    return m


def door_handles(q):
    m = Mesh()
    for s in (-1, 1):
        p, nn = side_frame(-0.440, 0.880)
        a = p + nn * 0.010 + [0.050, 0, 0]
        b = p + nn * 0.010 - [0.050, 0, 0]
        m += strut(tuple(a * [1, 1, s]), tuple(b * [1, 1, s]), 0.010, 0.008, n=seg(10, q, 6), mat='body:chrome',
                   samples=seg(5, q, 3))
    return m


MIRROR_BASE = 0.585
_kestrel_mirrors = door_mirrors


def door_mirrors(q):
    """Chrome bullet mirrors (the Aurelia's shape) on the doors' leading edges."""
    if q < 0.2:
        return race_mirrors(q, 'body:chrome')
    m = Mesh()
    n = seg(20, q, 8)
    for s in (-1, 1):
        x = MIRROR_BASE
        zb = float(gb_c(x)) + 0.055
        yb_ = float(crown(x, zb))
        base = np.array([x, yb_, s * zb])
        head = np.array([x - 0.02, yb_ + 0.070, s * (zb + 0.070)])
        m += strut(tuple(base), tuple(head), 0.010, 0.010, n=seg(8, q, 5), mat='body:chrome', samples=3)
        m += blob(base + [0, 0.004, 0], (0.030, 0.010, 0.020), n=seg(12, q, 6), rings=seg(6, q, 4), e1=0.7, e2=0.7,
                  mat='body:chrome')
        shell = revolve([(0.0, 0.052), (0.022, 0.040), (0.042, 0.012), (0.048, -0.020), (0.048, -0.026),
                         (0.0, -0.026)], n, mat='body:chrome', axis='x')
        shell.transform(t=tuple(head + [0.0, 0.02, 0]))
        m += shell
        g = revolve([(0.0, -0.032), (0.043, -0.032), (0.043, -0.027), (0.0, -0.027)], n, mat='mirror', axis='x')
        g.transform(t=tuple(head + [0.0, 0.02, 0]))
        m += g
    return m


def sills(q):
    """Bright rocker mouldings between the arches."""
    m = Mesh()
    n = seg(6, q, 4)
    for s in (-1, 1):
        pts = []
        for x in np.linspace(XF - ARCH[0][2] - 0.02, XR + ARCH[1][2] + 0.02, seg(14, q, 4)):
            y = float(yb_c(x)) + 0.080
            z = surf_z_low(x, y) + 0.003
            pts.append((x, y, s * z))
        m += tube(pts, 0.0065, n=n, mat='body:chrome', samples=seg(14, q, 4))
    return m


def fuel_filler(q):
    """Chrome pop-open filler cap in the tail panel's centre, above the strip."""
    p, nrm = tail_hit(0.905, 0.0)
    R = frame_from(nrm)
    m = revolve([(0.0, -0.004), (0.040, -0.004), (0.042, 0.006), (0.034, 0.012), (0.0, 0.013)], seg(24, q, 8),
                mat='body:chrome')
    return placed(m, R, p)


# ---------------------------------------------------------------------------------------------
# Wheels: five-spoke mags, polished lip, raised-letter tyres
# ---------------------------------------------------------------------------------------------

def rim(W, q):
    n = seg4(72, q)
    rw = W - 0.040
    zo, zi = rw / 2, -rw / 2
    if q < 0.2:
        return rim_race(W, n)
    R0 = RIM_R
    prof = [(R0 + 0.013, zo + 0.004), (R0 + 0.014, zo - 0.004), (R0 + 0.002, zo - 0.010), (R0, zo - 0.030),
            (R0 - 0.020, zo - 0.045), (R0 - 0.020, zi + 0.040), (R0, zi + 0.025), (R0 + 0.002, zi + 0.010),
            (R0 + 0.013, zi - 0.004), (R0 + 0.012, zi + 0.004), (R0 - 0.003, zi + 0.012), (R0 - 0.025, zi + 0.040),
            (R0 - 0.025, zo - 0.045), (R0 - 0.004, zo - 0.014)]
    m = revolve(prof, n, mat='rim:chrome', closed_profile=True)
    zf = zo - 0.040
    m += revolve([(0.0, zf - 0.020), (0.072, zf - 0.020), (0.076, zf - 0.004), (0.068, zf + 0.012), (0.046, zf + 0.016),
                  (0.0, zf + 0.016)], seg(36, q, 10), mat='rim:paint')
    for k in range(5):
        th = k * TAU / 5 + math.pi / 2
        d = np.array([math.cos(th), math.sin(th), 0.0])
        sd = np.array([-math.sin(th), math.cos(th), 0.0])
        a = d * 0.060 + [0, 0, zf + 0.006]
        b = d * (R0 - 0.020) + [0, 0, zf + 0.022]
        P = np.array([lerp(a, b, t) for t in np.linspace(0, 1, seg(5, q, 3))])

        def sec(i, t):
            w = lerp(0.030, 0.040, t)
            return ellipse(w, 0.012, seg(10, q, 6), e=0.40)
        m += sweep(P, sec, 'rim:paint', up=tuple(sd), cap0='flat', cap1='flat')
    m += revolve([(0.0, zf + 0.044), (0.030, zf + 0.042), (0.040, zf + 0.026), (0.040, zf + 0.012), (0.0, zf + 0.012)],
                 seg(20, q, 8), mat='rim:chrome')
    for k in range(5):
        th = k * TAU / 5 + math.pi / 2 + math.pi / 5
        m += revolve([(0.0, zf + 0.028), (0.009, zf + 0.028), (0.010, zf + 0.012), (0.0, zf + 0.012)], 6,
                     mat='rim:chrome').transform(t=(math.cos(th) * 0.056, math.sin(th) * 0.056, 0))
    return m


def rim_race(W, n):
    rw = W - 0.040
    zo, zi = rw / 2, -rw / 2
    prof = [(0.0, zo - 0.034), (RIM_R - 0.015, zo - 0.034), (RIM_R + 0.013, zo), (RIM_R + 0.013, zi),
            (RIM_R - 0.02, zi), (0.0, zi)]
    m = revolve(prof, n, mat='rim:paint')
    m += revolve([(0.0, zo - 0.036), (0.040, zo - 0.036), (0.040, zo + 0.006), (0.0, zo + 0.008)], 8, mat='rim:chrome')
    return m


def tyre(R, W, q):
    return _aurelia_tyre(R, W, q)


def upright(front, q):
    W = WF if front else WR
    zc = -W / 2 + 0.024
    m = Mesh()
    n = seg(40, q, 10)
    m += revolve([(0.075, zc - 0.022), (0.160, zc - 0.022), (0.160, zc + 0.000), (0.075, zc + 0.000)], n,
                 mat='body:discp', closed_profile=True)
    na = seg(12, q, 4)
    angs = np.radians(np.linspace(100, 145, na))
    path = np.stack([np.cos(angs) * 0.142, np.sin(angs) * 0.142, np.full(na, zc - 0.011)], -1)
    if q < 0.2:
        return m + sweep(path, lambda i, t: ellipse(0.026, 0.030, 4, e=0.35), 'body:caliper', cap0='fan', cap1='fan',
                         up=(0, 0, 1))
    m += sweep(path, lambda i, t: ellipse(0.026, 0.032, seg(12, q, 6), e=0.30), 'body:caliper', cap0='dome',
               cap1='dome', up=(0, 0, 1), dome_depth=0.010, dome_steps=2)
    m += blob((0.0, 0.0, zc - 0.060), (0.050, 0.150, 0.026), n=seg(16, q, 6), rings=seg(10, q, 4), e1=0.55, e2=0.6,
              mat='body:metal')
    return m


# ---------------------------------------------------------------------------------------------
# Cabin: black vinyl buckets, deep gauge pods, a console with a pistol-grip shifter
# ---------------------------------------------------------------------------------------------

DASH = [(0.640, 0.866 + KDY), (0.600, 0.904 + KDY), (0.540, 0.934 + KDY), (0.478, 0.944 + KDY),
        (0.430, 0.932 + KDY), (0.410, 0.893 + KDY), (0.408, 0.742 + KDY), (0.440, 0.700 + KDY), (0.640, 0.700 + KDY)]
GAUGE_POS = [(0.884 + KDY, -0.470, 0.050), (0.884 + KDY, -0.282, 0.050), (0.836 + KDY, -0.120, 0.030),
             (0.836 + KDY, -0.030, 0.030)]
HELMET_C = np.array([-0.470, 1.145, DRIVER_Z])
GLOW_C = np.array([0.36, 0.86 + KDY, DRIVER_Z * 0.6])


def _fascia(q):
    """Brushed aluminium dash fascia with a dark centre stripe (engine-turned look)."""
    m = slab(rounded_rect(0.052, 0.700, 0.008, seg(3, q, 2)), 0.006, axis=0, centre=0.403, mat='int:metal', steps=1)
    m.transform(t=(0, 0.850 + KDY, 0))
    return m


def console(q):
    m = Mesh()
    m += blob((-0.10, 0.330 + KDY, 0.0), (0.580, 0.130, 0.110), n=seg(16, q, 6), rings=seg(8, q, 4), e1=0.35,
              e2=0.35, mat='int:dash')
    m += blob((0.10, 0.462 + KDY, 0.0), (0.200, 0.018, 0.090), n=seg(14, q, 6), rings=seg(6, q, 3), e1=0.3, e2=0.3,
              mat='int:metal')
    # pistol-grip shifter
    m += strut((0.10, 0.47 + KDY, 0.0), (0.05, 0.60 + KDY, 0.0), 0.007, 0.007, n=seg(8, q, 4), mat='int:chrome',
               samples=3)
    m += blob((0.040, 0.625 + KDY, 0.0), (0.040, 0.030, 0.018), n=seg(12, q, 6), rings=seg(6, q, 4), e1=0.6, e2=0.6,
              mat='int:wood', R=rot((0, 0, 1), math.radians(-25)))
    return m


def binnacle(q):
    """Two deep pods for the big dials, a shrouded centre stack with toggles."""
    m = Mesh()
    n = seg(24, q, 8)
    for y, z, r in GAUGE_POS[:2]:
        ring = revolve([(r + 0.004, 0.000), (r + 0.014, 0.004), (r + 0.016, 0.050), (r + 0.010, 0.054),
                        (r + 0.004, 0.050), (r + 0.004, 0.006)], n, mat='int:dash', axis='x', closed_profile=True)
        ring.transform(t=(0.392 - 0.046, y, z))
        m += ring
    for k in range(5):
        z = -0.13 + k * 0.040
        m += strut((0.402, 0.796 + KDY, z), (0.380, 0.798 + KDY, z), 0.003, 0.003, n=seg(6, q, 4), mat='int:chrome',
                   samples=2)
    m += revolve([(0.0, -0.0015), (0.032, -0.0015), (0.032, 0.0015), (0.0, 0.0015)], seg(24, q, 8), mat='int:gauge',
                 axis='x').transform(t=(0.392, 0.835 + KDY, 0.150))
    m += revolve([(0.030, -0.008), (0.038, -0.006), (0.039, 0.002), (0.030, 0.003)], seg(24, q, 8), mat='int:chrome',
                 axis='x', closed_profile=True).transform(t=(0.392, 0.835 + KDY, 0.150))
    return m


def door_cards(q):
    m = Mesh()
    for s in (-1, 1):
        ci = float(ci_c(0.10))
        z = s * (ci - 0.010)
        pts = [(x, float(crown(x, ci)) - 0.040, z) for x in np.linspace(-0.45, 0.55, 6)]
        m += tube(pts, 0.022, n=seg(10, q, 6), mat='int:dash', samples=seg(10, q, 4))
        m += blob((0.02, 0.640 + KDY, z - s * 0.016), (0.320, 0.140, 0.014), n=seg(14, q, 6), rings=seg(6, q, 4),
                  e1=0.25, e2=0.25, mat='int:pleat')
        m += blob((0.00, 0.610 + KDY, z - s * 0.034), (0.230, 0.024, 0.026), n=seg(14, q, 6), rings=seg(6, q, 4),
                  e1=0.4, e2=0.4, mat='int:leather')
        m += strut((0.30, 0.760 + KDY, z - s * 0.020), (0.23, 0.760 + KDY, z - s * 0.026), 0.005, 0.009,
                   n=seg(8, q, 5), mat='int:chrome', samples=3)
    return m


def cabin(q):
    m = Mesh()
    m += dash_body(q, half=0.765)
    m += _fascia(q)
    if q >= 0.6:
        m += gauges(q)
    for z in (DRIVER_Z, -DRIVER_Z):
        m += _seat(q, z)
    m += _seat(q, 0.0, x0=-1.08, front=False).transform(s=(1, 1, 1.60))
    if q < 0.1:
        return m
    m += console(q)
    m += strut(tuple(np.array(WHEEL_CENTRE) + [0.06, -0.03, 0]), (0.45, 0.80 + KDY, DRIVER_Z), 0.022, 0.022,
               n=seg(10, q, 6), mat='int:black', samples=3)
    m += panel((C_TOP + 0.02, A_TOP + 0.10), (-0.59, 0.59), seg(14, q, 3), seg(8, q, 2), 0.006, 'int:headliner',
               inset=0.024)
    m += _shelf(q)
    return m


def _shelf(q):
    m = slab(rounded_rect(0.12, 0.52, 0.04, seg(3, q, 2)), 0.016, axis=1, centre=0.0, mat='int:carpet', steps=1)
    m.transform(t=(-1.36, 0.990, 0))
    return m


def cockpit_shell(q):
    m = Mesh()
    m += dash_body(q, half=0.765)
    m += _fascia(q)
    m += gauges(q)
    m += binnacle(q)
    for z in (DRIVER_Z, -DRIVER_Z):
        m += _seat(q, z)
    m += _seat(q, 0.0, x0=-1.08, front=False).transform(s=(1, 1, 1.60))
    m += console(q)
    m += strut(tuple(np.array(WHEEL_CENTRE) + [0.06, -0.03, 0]), (0.45, 0.80 + KDY, DRIVER_Z), 0.022, 0.022,
               n=seg(12, q, 6), mat='int:black', samples=3)
    m += _shelf(q)
    m += door_cards(q)
    m += pillar_trims(q)
    m += rear_view_mirror(q)
    return m


WHEEL_R = 0.188                 # a big thin-rimmed 38 cm wheel


def steering_wheel(q):
    return _aurelia_wheel(q)


def hands(q):
    return _aurelia_hands(q)


def driver(q):
    m = _kestrel_driver(q)
    m.mats = ['driver:jacket' if k == 'driver:suit' else k for k in m.mats]
    return m


# ---------------------------------------------------------------------------------------------
# Exhaust: twin pipes out under each side of the rear bumper
# ---------------------------------------------------------------------------------------------

def exhaust(q):
    m = Mesh()
    n = seg(20, q, 8)
    for z in (-0.58, 0.58):
        pipe = revolve([(0.030, 0.0), (0.034, -0.205), (0.035, -0.210), (0.035, -0.225), (0.027, -0.225),
                        (0.026, -0.010)], n, mat='body:chrome', axis='x', closed_profile=True)
        pipe.transform(t=(-2.08, 0.300, z))
        m += pipe
        if q >= 0.2:
            soot = revolve([(0.0, -0.205), (0.0265, -0.205), (0.0265, -0.201), (0.0, -0.201)], n, mat='body:inlet',
                           axis='x')
            soot.transform(t=(-2.08, 0.300, z))
            m += soot
    return m


# ---------------------------------------------------------------------------------------------
# Livery: panel gaps; factory: twin gold stripes over the bonnet, roof and deck (the factory
# blue's luminance, so a player's paint stays clean), the car's name in black on the front
# fenders and on the tail strip
# ---------------------------------------------------------------------------------------------

DOOR_X = (0.640, -0.560)
STRIPE = (0.90, 0.62, 0.12)


def livery(group, P, N, valid):
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    az = np.abs(z)
    zero = np.zeros(P.shape[:2], np.float32)
    side_n = lambda s: np.array([0, 0, s], float)
    if group == 'CarPaint':
        g = zero.copy()
        W = 0.0035
        side = valid & (np.abs(N[..., 2]) > 0.35)
        top = valid & (N[..., 1] > 0.30)
        yb = np.vectorize(lambda v: float(yb_c(v)))(x)
        sill = yb + 0.100
        belt = np.vectorize(lambda v: float(crown(v, gb_c(np.clip(v, GH_X[0], GH_X[1])))))(x)
        in_door = (x < DOOR_X[0] + 0.004) & (x > DOOR_X[1] - 0.004)
        for xd in DOOR_X:
            g = np.maximum(g, lv.line(x - xd, W) * side * (y > sill - 0.005) * (y < belt + 0.01))
        g = np.maximum(g, lv.line(y - sill, W) * side * in_door * (az > 0.6))
        bon = (x > 0.70) & (x < fx(2.18))
        g = np.maximum(g, lv.line(x - 0.700, W) * top * (az < 0.86))
        g = np.maximum(g, lv.line(az - 0.86, W) * top * bon)
        g = np.maximum(g, lv.line(x - fx(2.18), W) * valid * (az < 0.86) * (y > 0.80))
        boot = (x < -1.52) & (x > fx(-2.24))
        g = np.maximum(g, lv.line(x + 1.52, W) * top * (az < 0.82))
        g = np.maximum(g, lv.line(az - 0.82, W) * valid * boot * (y > 0.90))
        shade = 1.0 - 0.62 * np.clip(g, 0, 1)
        dark = zero.copy()
        nm = lv.text_mask('STALLION')
        for s in (-1, 1):
            dark = np.maximum(dark, 0.92 * lv.stamp(P, N, valid, nm, (1.72, 0.780, s * 0.95), (s, 0, 0), (0, 1, 0), 0.36,
                                                    facing=side_n(s), min_dot=0.5, depth=0.08))
        shade = shade * (1 - np.clip(dark, 0, 0.95))
        k = _lum(FACTORY_PAINT) / _lum(STRIPE)
        col = tuple(min(1.0, c * k) for c in STRIPE)
        cl = valid & (N[..., 1] > 0.40) & (az < 0.40)
        stripes = (lv.band(az, 0.090, 0.230, 0.004)) * cl
        stripes = stripes * (1 - np.clip(lv.band(x, 1.08, 1.60, 0.004) * lv.band(az, -1, 0.17, 0.004), 0, 1))
        return {'shade': shade, 'layers': [(np.clip(stripes, 0, 1) * valid, col)]}
    if group == 'Body':
        layers = []
        p, nrm = tail_hit(TAIL_Y, 0.0)
        X0 = fx(p[0])
        layers.append((lv.stamp(P, N, valid, lv.text_mask('STALLION', oblique=False), (X0 - 0.006, TAIL_Y, 0.0),
                                (0, 0, 1), (0, 1, 0), 0.34, facing=(-1, 0, 0), min_dot=0.5, depth=0.03),
                       (0.80, 0.80, 0.82), 0.15))
        p, nrm = tail_hit(0.420, 0.0)
        layers.append((lv.stamp(P, N, valid, lv.text_mask('SV 1969', oblique=False), (fx(p[0]) - 0.006, 0.420, 0.0),
                                (0, 0, 1), (0, 1, 0), 0.30, facing=(-1, 0, 0), min_dot=0.5, depth=0.03),
                       (0.85, 0.85, 0.84), 0.5))
        layers.append((lv.stamp(P, N, valid, lv.text_mask('S', oblique=False), (fx(_mx()) + 0.012, BADGE_Y, 0.0),
                                (0, 0, 1), (0, 1, 0), 0.030, facing=(1, 0, 0), min_dot=0.6, depth=0.012),
                       (0.85, 0.75, 0.30), 0.2))
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
    body += nose_badge(q) + bumpers(q) + boot_plate(q) + tail_finisher(q) + hood_scoop(q)
    body += door_mirrors(q) + fuel_filler(q) + wipers(q) + side_scoops(q)
    if q >= 0.2:
        body += indicators(q) + door_handles(q) + sills(q)
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
    'gt_lights': ((3.30, 0.85, 1.40), (2.30, 0.60, 0.50), 45),
    'gt_grille': ((3.80, 0.70, 0.50), (2.30, 0.58, 0.0), 48),
    'gt_wheel': ((2.25, 0.50, 1.85), (1.32, 0.36, 0.90), 62),
    'gt_tail': ((-3.45, 1.05, 1.45), (-2.35, 0.75, 0.40), 45),
    'gt_interior': ((0.05, 1.35, 2.35), (-0.30, 0.90, 0.0), 40),
    'gt_window': ((0.55, 1.20, 3.15), (0.05, 1.00, 0.0), 38),
}


META = make_meta()
