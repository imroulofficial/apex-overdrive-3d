"""Kestrel (kz-kestrel): the drift specialist, a 1970s two-door rally saloon, 4.15 m. Batch 1.

An original design in the spirit of the current Kestrel: a light-blue three-box works rally car on
raised suspension, with a flat bonnet and squared shoulders, a crisp waist crease that kicks up
over the rear wheel, a tall glasshouse with thin pillars, a full-width black grille carrying two
round lamps a side, a pair of big spot lamps on a light bar, black bolt-on wheel-arch flares,
mud flaps, a sump guard and a small ducktail on the boot. White six-spoke rally wheels on tall
gravel tyres. No real manufacturer's shapes, badges or names.

Built with the closed-car machinery of the Aurelia (inherit, see tools/cars/inherit.py): the body
is a subdivision-surface control cage fitted to the blueprint curves below, the greenhouse is one
canopy surface with the glass, pillars and sliding door windows on it. This file redefines the
curves, the greenhouse proportions and every part that gives the car its character.

Measured from the shipped model (public/assets/models/kz_kestrel.glb at 4.15 m) so physics and
stats stay the same: front axle x +1.1865, rear -1.1655 (wheelbase 2.352 m), tyre radius 0.3815 /
0.3745 m, half-track 0.7975 / 0.808 m.
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from inherit import inherit  # noqa: E402

inherit('ag_aurelia', globals())
_aurelia_hands, _aurelia_meta, _aurelia_wheel, _aurelia_tyre = hands, make_meta, steering_wheel, tyre

import livery as lv  # noqa: E402
from meshkit import (Curve, Mesh, blob, catmull, chaikin, ellipse, lerp, loft, norm, patch_slab,  # noqa: E402
                     revolve, rot, rounded_rect, slab, smoothstep, spow, strut, sweep, tube, window, TAU)

ID = 'kz-kestrel'
FILE = 'kz_kestrel'
LENGTH = 4.15

XF, XR = 1.1865, -1.1655
RF, RR = 0.3815, 0.3745
TF, TR = 0.7975, 0.808
WF, WR = 0.215, 0.215
RIM_R = 0.1905                  # 15-inch rally wheels, tall gravel sidewalls
NOSE, TAIL = 2.075, -2.075
DRIVER_Z = -0.360               # left-hand drive
KDY = 0.120                     # the cabin sits this much higher than the Aurelia's (raised rally car)
EYE = (-0.265, 1.225, DRIVER_Z)
WHEEL_CENTRE = (0.105, 0.995, DRIVER_Z)
WHEEL_TILT = math.radians(24)
FACTORY_PAINT = (0.30, 0.46, 0.66)    # linear RGB: works light blue
B_MAT = 'body:plastic'          # satin black B posts (chrome picked up the garage sunset as a pink bar)
LEATHER = (0.050, 0.050, 0.054)       # black cloth buckets
GLASS = ((0.045, 0.06, 0.065, 0.42), 0.03, 0.0, None)
TYRE_WORDS = ['APEX OVERDRIVE', 'KESTREL RALLY', 'APEX OVERDRIVE', 'KESTREL RALLY']
TYRE_HW = WF / 2
TYRE_BAND = None
TYRE_BLOCKS = 40                      # gravel tread blocks
TYRE_TEXT_R = (0.088, 0.026)
TYRE_NP_MIN = 10
GLOVE = (0.042, 0.043, 0.047)
GLOVE_ACCENT = (0.36, 0.37, 0.40)   # dark grey rally gloves, light grey stitching and knuckle band
RIM_TUBE = 0.0140                   # the rally wheel's suede rim (half-section)
HEADLINER = (0.050, 0.050, 0.053)
METAL = (0.55, 0.56, 0.57)            # roll cage, brushed alloy panel
METAL_RM = (0.40, 0.55)
RIM_PAINT = (0.82, 0.82, 0.80)        # white rally wheels
CALIPER = (0.75, 0.42, 0.04)          # gold rally callipers
STEEL = (0.035, 0.035, 0.038)
CLEAR_GLASS = ((0.06, 0.065, 0.07, 0.09), 0.03, 0.0, None)
TEX = {'showroom': {'Interior': 1024}, 'drive': {'Interior': 512}, 'cockpit': {'Cockpit': 2048}}
ORM = {'showroom': {'Interior'}, 'drive': {'Body', 'Rim'}}
GAUGES = [
    {'label': 'KM/H', 'max': 220, 'ticks': 11, 'needle': 0.12},
    {'label': 'RPM x1000', 'max': 9, 'ticks': 9, 'needle': 0.10},
    {'label': 'OIL', 'max': 100, 'ticks': 4, 'needle': 0.55},
    {'label': 'WATER', 'max': 120, 'ticks': 4, 'needle': 0.45},
]

# ---------------------------------------------------------------------------------------------
# Body blueprint (game frame, metres)
# ---------------------------------------------------------------------------------------------

# underside: high approach and departure for the gravel stages
yb_c = Curve([(2.01, 0.420), (1.92, 0.385), (1.75, 0.345), (1.50, 0.318), (1.10, 0.300), (0.50, 0.288), (0.00, 0.284),
              (-0.60, 0.288), (-1.20, 0.300), (-1.55, 0.322), (-1.78, 0.372), (-1.93, 0.440), (-2.03, 0.500)])
# plan: a near-constant width with rounded corners (the flares add the width over the wheels)
hw_c = Curve([(2.01, 0.790), (1.97, 0.822), (1.90, 0.845), (1.75, 0.858), (1.40, 0.864), (1.00, 0.866), (0.40, 0.868),
              (-0.20, 0.870), (-0.80, 0.874), (-1.30, 0.876), (-1.65, 0.872), (-1.88, 0.860), (-1.98, 0.842),
              (-2.03, 0.818)])
ymx_c = Curve([(2.01, 0.660), (1.50, 0.725), (0.50, 0.745), (-0.50, 0.750), (-1.50, 0.760), (-2.03, 0.760)])
# waist crease: level along the bonnet and the doors, kicking up over the rear wheel
ysh_c = Curve([(2.01, 0.878), (1.92, 0.902), (1.75, 0.926), (1.45, 0.950), (1.10, 0.963), (0.80, 0.970), (0.20, 0.973),
               (-0.35, 0.976), (-0.62, 0.986), (-0.82, 1.004), (-1.02, 1.024), (-1.25, 1.034), (-1.60, 1.037),
               (-1.90, 1.036), (-2.03, 1.034)])
shd_c = Curve([(2.01, 0.040), (1.60, 0.044), (0.50, 0.046), (-0.80, 0.046), (-1.60, 0.044), (-2.03, 0.042)])
# centre line: a flat bonnet rising gently to the scuttle, the tub, a flat boot ending in a ducktail
top_c = Curve([(2.01, 0.900), (1.92, 0.932), (1.75, 0.962), (1.45, 0.995), (1.10, 1.018), (0.80, 1.032), (0.66, 1.036),
               (0.45, 1.100), (-0.60, 1.100), (-1.30, 1.100), (-1.42, 1.092), (-1.60, 1.094), (-1.80, 1.100),
               (-1.93, 1.112), (-2.00, 1.126), (-2.03, 1.136)])

CABIN = (-1.38, 0.62)
TUB_FLOOR = 0.360
ci_c = Curve([(0.70, 0.735), (-0.50, 0.735), (-0.70, 0.665), (-1.42, 0.645)])
ZWELL = 0.610
ARCH = [(XF, RF + 0.010, RF + 0.036), (XR, RR + 0.010, RR + 0.036)]
FACE_X = 1.985
FACE_D = 0.040
MOUTH = (0.706, 0.630, 0.104)   # full-width grille: centre y, half width, half height
MOUTH_E = (0.10, 0.14)          # nearly rectangular
MOUTH_DROOP = 0.0
BULGE = 0.010                   # a faint raised centre on the bonnet
BULGE_W = 0.300
ROW_Z = (0.12, 0.300, 0.420)
STATION_XS = (-2.03, -1.96, -1.88, -1.76, -1.66, -0.70, -0.48, -0.24, 0.0, 0.24, 0.44, 0.60, 0.74, 1.70, 1.80,
              1.88, 1.94)
TAIL_TURN = (0.034, 0.90)
ROW_IN = (0.110, 0.066, 0.026)  # the lower side tucks under: the swage line at the widest row stands out
SIDE_CREASE = 0.75
OVERHANG = 1.70


def bulge_w(x):
    return float(window(x, 0.72, 1.82, 0.30))


def crown_e(x):
    """Squarer than the Aurelia: a flat bonnet and boot that turn down crisply into the crease."""
    return 4.2


def tip_shift(x, z, y=0.0):
    """The wing tops reach a little past the grille panel; the boot lid's corners tuck in."""
    z = np.abs(z)
    return (0.010 * smoothstep(1.88, FACE_X, x) * smoothstep(0.55, 0.72, z)
            - 0.020 * smoothstep(-1.96, -2.03, x) * smoothstep(0.50, 0.70, z))


def gb_c(x):
    """Greenhouse half width at the belt: a tall glasshouse with modest tumblehome."""
    return float(Curve([(0.672, 0.742), (0.58, 0.784), (0.35, 0.800), (-0.40, 0.804), (-0.90, 0.798), (-1.14, 0.780),
                        (-1.32, 0.735), (-1.43, 0.700)])(x))


# ---------------------------------------------------------------------------------------------
# Greenhouse: tall and upright, thin pillars, a near-flat roof with a tight cant rail
# ---------------------------------------------------------------------------------------------

yr_c = Curve([(0.672, 1.030), (0.60, 1.100), (0.50, 1.183), (0.40, 1.265), (0.30, 1.337), (0.20, 1.396), (0.10, 1.437),
              (0.00, 1.457), (-0.20, 1.468), (-0.45, 1.471), (-0.70, 1.463), (-0.85, 1.446), (-0.95, 1.422),
              (-1.05, 1.379), (-1.15, 1.316), (-1.25, 1.242), (-1.33, 1.180), (-1.40, 1.120), (-1.43, 1.098)])
GH_X = (-1.43, 0.672)
T_CANT = 0.55
A_TOP, A_BASE = 0.090, 0.668
B_X = -0.505
C_TOP, C_BASE = -0.860, -1.105
RW = (-1.360, -0.905, 0.405)
WIN_X = 0.08
CANT_K, TUMBLE, ROOF_E, ROOF_ZE, SIDE_BOW = 0.84, 0.30, 0.42, 0.85, 0.008   # tall upright glass, flat roof


# ---------------------------------------------------------------------------------------------
# Front: grille panel with twin round lamps, spot lamps on a light bar, black bumper, sump guard
# ---------------------------------------------------------------------------------------------

LAMPS = [(0.525, 0.084), (0.348, 0.068)]     # (z, radius) of the outer and inner lamp, each side
LAMP_Y = 0.708
SPOT = (0.205, 0.572, 0.084)                 # spot lamps: z, y, radius


def _mx():
    return FACE_X + FACE_D


def grille(q):
    """Black grille panel filling the mouth, chrome-edged; vertical bars in the centre between the
    lamps, a slim bright surround."""
    m = Mesh()
    cy, ma, mb = MOUTH
    n = seg(64, q, 14)
    ring = mouth_outline(n, 0.002, _mx() + 0.001)
    m += sweep(ring, lambda i, t: ellipse(0.0045, 0.0060, seg(8, q, 4)), 'body:chrome', closed=True)
    xg = _mx() - 0.042
    # back panel (black), set a little behind the lip
    back = slab(rounded_rect(mb * 0.97, ma * 0.985, 0.014, seg(4, q, 2)), 0.006, axis=0, centre=xg - 0.008,
                mat='body:grille', steps=1)
    back.transform(t=(0, cy, 0))
    m += back
    if q < 0.2:
        return m
    zin = LAMPS[1][0] - LAMPS[1][1] - 0.022
    nb = 13 if q >= 0.6 else 7
    for z in np.linspace(-zin, zin, nb):
        b = slab(rounded_rect(mb * 0.86, 0.0035, 0.002, 1), 0.016, axis=0, centre=xg + 0.004, mat='body:inlet',
                 steps=1)
        b.transform(t=(0, cy, z))
        m += b
    # a slim chrome horizontal bar across the centre bars
    hb = slab(rounded_rect(0.006, zin + 0.008, 0.003, 1), 0.010, axis=0, centre=xg + 0.012, mat='body:chrome', steps=1)
    hb.transform(t=(0, cy, 0))
    m += hb
    return m


def headlamp_parts(q, s):
    """The two round lamps of side s in the grille panel: chrome bezels, faceted reflectors,
    bulb shields (headlight_lens) and flat clear covers. Returns (body, lens, glass)."""
    body, lens, glass = Mesh(), Mesh(), Mesh()
    R = frame_from((1.0, 0.0, 0.0))
    for z, r in LAMPS:
        c = np.array([_mx() - 0.010, LAMP_Y, s * z])
        n = seg(36, q, 8)
        body += placed(revolve([(r + 0.001, 0.010), (r + 0.010, 0.008), (r + 0.011, -0.030), (r + 0.001, -0.030)],
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
        glass += placed(revolve([(0.0, 0.012), (r * 0.6, 0.010), (r + 0.004, 0.006), (r + 0.008, 0.002)], n,
                                mat='glass:clear'), R, c)
    return body, lens, glass


def spot_lamps(q):
    """Two big rally spot lamps on a black light bar in front of the grille (lens: headlight_lens,
    they light at night with the headlamps). Returns (body, lens, glass)."""
    body, lens, glass = Mesh(), Mesh(), Mesh()
    z0, y0, r = SPOT
    R = frame_from((1.0, 0.0, 0.0))
    n = seg(36, q, 8)
    xb = _mx() + 0.070
    # light bar: a flat steel bar between two brackets down to the bumper
    body += strut((xb - 0.010, y0 - r - 0.020, -0.44), (xb - 0.010, y0 - r - 0.020, 0.44), 0.012, 0.016, n=seg(8, q, 4),
                  mat='body:steel', samples=3, e=0.6)
    for s in (-1, 1):
        c = np.array([xb + 0.050, y0, s * z0])
        if q < 0.1:
            body += placed(revolve([(0.0, -0.110), (r * 0.92, -0.080), (r + 0.008, 0.004), (0.0, 0.004)], n,
                                   mat='body:steel'), R, c)
            continue
        body += placed(revolve([(0.0, -0.110), (r * 0.55, -0.108), (r * 0.92, -0.080), (r + 0.006, -0.030),
                                (r + 0.008, 0.004), (r - 0.004, 0.006), (r - 0.004, -0.010), (0.0, -0.020)], n,
                               mat='body:steel'), R, c)
        body += placed(revolve([(r - 0.002, 0.000), (r + 0.010, 0.002), (r + 0.010, 0.012), (r - 0.002, 0.012)], n,
                               mat='body:chrome', closed_profile=True), R, c)
        if q >= 0.2:
            body += placed(revolve([(r - 0.006, -0.004), (r * 0.7, -0.026), (r * 0.35, -0.044), (0.014, -0.050),
                                    (0.010, -0.046), (r * 0.33, -0.039), (r * 0.68, -0.022), (r - 0.008, -0.002)], n,
                                   mat='body:reflector', closed_profile=True), R, c)
        lens += placed(revolve([(0.0, -0.034), (0.024, -0.034), (0.026, -0.024), (0.020, -0.016), (0.0, -0.014)],
                               seg(16, q, 6), mat='headlight_lens'), R, c)
        glass += placed(revolve([(0.0, 0.020), (r * 0.6, 0.017), (r - 0.002, 0.010), (r + 0.004, 0.006)], n,
                                mat='glass:clear'), R, c)
        if q < 0.2:
            continue
        # bracket from the lamp's foot down to the bar
        body += strut(tuple(c + [-0.060, -r * 0.80, 0]), (xb - 0.010, y0 - r - 0.018, s * z0), 0.010, 0.010,
                      n=seg(8, q, 4), mat='body:steel', samples=2)
    for s in ((-1, 1) if q >= 0.2 else ()):
        body += strut((xb - 0.010, y0 - r - 0.020, s * 0.40), (_mx() + 0.040, 0.470, s * 0.40), 0.011, 0.011,
                      n=seg(8, q, 4), mat='body:steel', samples=2)
    return body, lens, glass


def indicators(q):
    """Small rectangular amber lamps in the front valance under the outer headlamps."""
    m = Mesh()
    for s in (-1, 1):
        p, nrm = nose_hit(0.548, s * 0.600)
        R = frame_from(norm(nrm + np.array([0.5, 0, 0])))
        lamp = slab(rounded_rect(0.060, 0.022, 0.008, seg(3, q, 2)), 0.014, axis=2, centre=0.0, mat='body:amber',
                    steps=1)
        m += placed(lamp, R, p)
        bez = slab(rounded_rect(0.066, 0.028, 0.010, seg(3, q, 2)), 0.008, axis=2, centre=-0.004, mat='body:chrome',
                   steps=1)
        m += placed(bez, R, p)
    return m


BADGE_Y = 0.852


def nose_badge(q):
    """Small enamel badge on the bonnet's leading edge above the grille."""
    if q < 0.2:
        return Mesh()
    p, nrm = nose_hit(BADGE_Y, 0.0)
    R = frame_from(nrm, up=(0, 1, 0))
    m = placed(slab(rounded_rect(0.034, 0.016, 0.008, seg(3, q, 2)), 0.006, axis=2, centre=0.0, mat='body:badge',
                    steps=1), R, p)
    m += placed(slab(rounded_rect(0.039, 0.021, 0.010, seg(3, q, 2)), 0.004, axis=2, centre=-0.002, mat='body:chrome',
                     steps=1), R, p)
    return m


def bumpers(q):
    """Black steel blade bumpers wrapping the corners, an alloy sump guard under the nose, and
    towing eyes."""
    m = Mesh()
    zs = [0.0, 0.25, 0.45, 0.60, 0.70, 0.77, 0.82]
    fpath = _bumper_path(nose_hit, 0.455, 1, zs, 0.022)
    fpath = [(fpath[0][0] - 0.10, fpath[0][1] * 1.02)] + fpath + [(fpath[-1][0] - 0.10, fpath[-1][1] * 1.02)]
    m += blade(fpath, 0.455, 0.042, 0.020, q, mat='body:steel')
    rzs = [0.0, 0.25, 0.45, 0.60, 0.70, 0.77, 0.82]
    rpath = _bumper_path(tail_hit, 0.575, -1, rzs, 0.022)
    rpath = [(rpath[0][0] + 0.10, rpath[0][1] * 1.02)] + rpath + [(rpath[-1][0] + 0.10, rpath[-1][1] * 1.02)]
    m += blade(rpath, 0.575, 0.040, 0.020, q, mat='body:steel')
    # sump guard: a curved alloy plate from under the bumper back under the engine
    def guard(u, v):
        z = (u - 0.5) * 1.10
        x = lerp(_mx() + 0.010, 1.42, v)
        y = 0.430 - 0.170 * smoothstep(0.0, 0.55, v) + 0.012 * np.cos(z * 2.4)
        P = np.stack([x, y, z], -1)
        Nn = np.zeros_like(P)
        Nn[..., 1] = -1
        return P, Nn
    m += patch_slab(guard, seg(10, q, 3), seg(8, q, 3), 0.006, mat='body:alu')
    if q >= 0.2:
        # front towing eye (right) and rear (left), bright red
        m += revolve([(0.020, -0.006), (0.030, -0.006), (0.030, 0.006), (0.020, 0.006)], seg(12, q, 6),
                     mat='body:caliper', axis='y', closed_profile=True).transform(t=(_mx() + 0.050, 0.420, 0.52))
    return m


def bonnet_pins(q):
    """Two chrome bonnet pins with their clips near the bonnet's leading edge."""
    m = Mesh()
    if q < 0.2:
        return m
    for s in (-1, 1):
        x, z = 1.80, s * 0.46
        y = float(crown(x, abs(z)))
        m += revolve([(0.0, 0.0), (0.016, 0.0), (0.016, 0.006), (0.010, 0.010), (0.0, 0.010)], seg(12, q, 6),
                     mat='body:chrome', axis='y').transform(t=(x, y, z))
        m += strut((x + 0.004, y + 0.012, z - 0.012), (x + 0.004, y + 0.012, z + 0.012), 0.003, 0.003, n=seg(6, q, 4),
                   mat='body:chrome', samples=2)
    return m


TAIL_Y = 0.862
TAIL_Z = 0.600


def tail_lamps(q):
    """Wide rectangular tail lamps on the tail panel: red with an amber inner section and a clear
    reverse lamp, a black rubber bezel. Returns (body, lens)."""
    body, lens = Mesh(), Mesh()
    for s in (-1, 1):
        p, nrm = tail_hit(TAIL_Y, s * TAIL_Z)
        axis = norm(nrm * 0.85 + np.array([-0.15, 0.0, 0.0]))
        R = frame_from(axis)
        c = p + axis * 0.004
        # local x across the car (frame_from: x = up x axis), y up
        bez = slab(rounded_rect(0.165, 0.066, 0.014, seg(4, q, 2)), 0.020, axis=2, centre=-0.004, mat='body:rubber',
                   steps=1)
        body += placed(bez, R, c)
        red = slab(rounded_rect(0.110, 0.056, 0.010, seg(3, q, 2), cx=0.045 * -s), 0.010, axis=2, centre=0.008,
                   mat='taillight_lens', steps=1)
        lens += placed(red, R, c)
        if q >= 0.2:
            am = slab(rounded_rect(0.040, 0.056, 0.008, seg(3, q, 2), cx=0.112 * s), 0.010, axis=2, centre=0.008,
                      mat='body:amber', steps=1)
            body += placed(am, R, c)
            rv = slab(rounded_rect(0.010, 0.056, 0.004, 1, cx=0.062 * s), 0.010, axis=2, centre=0.008,
                      mat='body:reflector', steps=1)
            body += placed(rv, R, c)
    return body, lens


def tail_finisher(q):
    """Bright strip across the tail panel between the lamps."""
    pts = []
    for z in np.linspace(-0.40, 0.40, 9):
        p, nrm = tail_hit(TAIL_Y - 0.080, z)
        pts.append(p + nrm * 0.005)
    return tube(pts, 0.0055, n=seg(6, q, 4), mat='body:chrome', samples=seg(14, q, 4))


def boot_plate(q):
    if q < 0.2:
        return Mesh()
    return _boot_plate(q)


def _boot_plate(q):
    """Number-plate recess panel on the tail between the lamps (black plate, white characters in
    the livery) and a small chrome boot lock."""
    p, nrm = tail_hit(0.715, 0.0)
    R = frame_from(nrm)
    m = placed(slab(rounded_rect(0.250, 0.055, 0.006, seg(3, q, 2)), 0.006, axis=2, centre=0.002, mat='body:rubber',
                    steps=1), R, p)
    p2, n2 = tail_hit(0.880, 0.0)
    m += placed(revolve([(0.0, -0.004), (0.016, -0.004), (0.017, 0.004), (0.0, 0.006)], seg(12, q, 6),
                        mat='body:chrome'), frame_from(n2), p2)
    return m


# ---------------------------------------------------------------------------------------------
# Rally hardware: bolt-on arch flares with rivets, mud flaps, door handles, mirrors, filler
# ---------------------------------------------------------------------------------------------

def flares(q):
    """Black bolt-on wheel-arch flares: a band round each arch lip standing out over the tyre,
    riveted to the wing."""
    m = Mesh()
    for xc, yc, ra in ARCH:
        a0, a1 = math.radians(-14), math.radians(194)
        na = seg(30, q, 8) if q >= 0.1 else 6
        prof = (((0.000, -0.046), (0.014, -0.048), (0.056, -0.026), (0.078, 0.004), (0.080, 0.024), (0.064, 0.034),
                 (0.000, 0.026)) if q >= 0.1 else ((0.000, -0.046), (0.078, 0.004), (0.064, 0.034), (0.000, 0.026)))
        angs = np.linspace(a0, a1, na)
        ring = []
        for a in angs:
            x = xc + math.cos(a) * (ra + 0.020)
            y = yc + math.sin(a) * (ra + 0.020)
            z = surf_z(x, max(float(yb_c(x)) + 0.040, min(y, float(ysh_c(x)) - 0.03)))
            ring.append((x, y, z))
        ring = np.array(ring)
        for s in (-1, 1):
            P = ring * [1, 1, s]
            # profile points run: on the wing (radial out) -> outer edge -> lip over the tyre
            rings = np.array([[P[i] + np.array([0, 0, s]) * pz - norm(P[i] - np.array([xc, yc, P[i][2]])) * pr
                               for pz, pr in prof]
                              for i in range(len(P))])
            m += loft(rings, 'body:plastic', cap0='fan', cap1='fan', closed=False).orient_outward()
            if q >= 0.6:
                for a in np.linspace(a0 + 0.12, a1 - 0.12, 9):
                    x = xc + math.cos(a) * (ra + 0.044)
                    y = yc + math.sin(a) * (ra + 0.044)
                    z = surf_z(x, max(float(yb_c(x)) + 0.040, min(y, float(ysh_c(x)) - 0.03))) + 0.020
                    m += blob((x, y, s * z), (0.005, 0.005, 0.004), n=8, rings=4, mat='body:chrome')
    return m


def mud_flaps(q):
    """Rubber mud flaps behind each wheel (white lettering in the livery)."""
    m = Mesh()
    for xc, yc, ra in ARCH:
        x = xc - ra * 0.86
        for s in (-1, 1):
            zc = (TF if xc > 0 else TR)
            fl = slab(rounded_rect(0.115, 0.150, 0.010, seg(3, q, 2) if q >= 0.2 else 1), 0.010, axis=0, centre=x, mat='body:rubber',
                      steps=1)
            fl.transform(t=(0, 0.250, s * zc))
            m += fl
    return m


def door_handles(q):
    """Flush pull handles in a recess at the door's rear edge, on the waist crease."""
    m = Mesh()
    for s in (-1, 1):
        p, nn = side_frame(-0.420, 0.935)
        R = frame_from(nn * [1, 1, 1], up=(0, 1, 0))
        rec = placed(slab(rounded_rect(0.060, 0.016, 0.008, seg(3, q, 2)), 0.006, axis=2, centre=0.0,
                          mat='body:chrome', steps=1), R, p + nn * 0.002)
        if s < 0:
            rec = rec.mirrored_z()
        m += rec
    return m


MIRROR_BASE = 0.600


def race_mirrors(q, mat='body:plastic'):
    """Rival-LOD mirrors: a stalk and a small head with its glass."""
    m = Mesh()
    for s in (-1, 1):
        x = MIRROR_BASE
        zb = float(gb_c(x)) + 0.040
        yb_ = float(crown(x, zb))
        head = np.array([x - 0.015, yb_ + 0.090, s * (zb + 0.075)])
        m += strut((x, yb_, s * zb), tuple(head), 0.010, 0.010, n=4, mat=mat, samples=2, cap='fan')
        m += blob(head, (0.030, 0.045, 0.055), n=6, rings=4, mat=mat)
        g = slab(rounded_rect(0.040, 0.050, 0.010, 1), 0.004, axis=0, centre=0.0, mat='mirror', steps=1)
        m += g.transform(t=tuple(head - [0.030, 0, 0]))
    return m


def door_mirrors(q):
    if q < 0.2:
        return race_mirrors(q)
    return _door_mirrors(q)


def _door_mirrors(q):
    """Black round rally mirrors on short stalks at the front of the doors (MirrorGlass faces
    the driver)."""
    m = Mesh()
    n = seg(20, q, 8)
    for s in (-1, 1):
        x = MIRROR_BASE
        zb = float(gb_c(x)) + 0.040
        yb_ = float(crown(x, zb))
        base = np.array([x, yb_, s * zb])
        head = np.array([x - 0.015, yb_ + 0.080, s * (zb + 0.070)])
        m += strut(tuple(base), tuple(head), 0.009, 0.009, n=seg(8, q, 5), mat='body:plastic', samples=3)
        m += blob(base + [0, 0.004, 0], (0.032, 0.010, 0.020), n=seg(12, q, 6), rings=seg(6, q, 4), e1=0.7, e2=0.7,
                  mat='body:plastic')
        shell = revolve([(0.0, 0.040), (0.026, 0.034), (0.046, 0.012), (0.050, -0.016), (0.050, -0.022),
                         (0.0, -0.022)], n, mat='body:plastic', axis='x')
        shell.transform(t=tuple(head + [0.0, 0.02, 0]))
        m += shell
        g = revolve([(0.0, -0.028), (0.045, -0.028), (0.045, -0.023), (0.0, -0.023)], n, mat='mirror', axis='x')
        g.transform(t=tuple(head + [0.0, 0.02, 0]))
        m += g
    return m


def sills(q):
    """Black sill strips with a bright edge between the flares."""
    m = Mesh()
    n = seg(6, q, 4)
    for s in (-1, 1):
        pts = []
        for x in np.linspace(XF - ARCH[0][2] - 0.07, XR + ARCH[1][2] + 0.07, seg(12, q, 4)):
            y = float(yb_c(x)) + 0.075
            z = surf_z_low(x, y) + 0.003
            pts.append((x, y, s * z))
        m += tube(pts, 0.0080, n=n, mat='body:plastic', samples=seg(12, q, 4))
    return m


def fuel_filler(q):
    """Quick-release alloy filler cap on the right rear pillar's foot (rally style)."""
    if q < 0.2:
        return Mesh()
    p, nrm = side_frame(-1.30, 0.960)
    R = frame_from(nrm)
    m = revolve([(0.0, -0.004), (0.040, -0.004), (0.042, 0.006), (0.034, 0.012), (0.0, 0.013)], seg(24, q, 8),
                mat='body:alu')
    return placed(m, R, p)


def wing_vents(q):
    return Mesh()


# ---------------------------------------------------------------------------------------------
# Wheels: white six-spoke rally wheels on tall gravel tyres
# ---------------------------------------------------------------------------------------------

def rim(W, q):
    n = seg4(72, q)
    rw = W - 0.040
    zo, zi = rw / 2, -rw / 2
    if q < 0.2:
        return rim_race(W, n)
    R0 = RIM_R
    prof = [(R0 + 0.012, zo + 0.004), (R0 + 0.013, zo - 0.004), (R0 + 0.002, zo - 0.010), (R0, zo - 0.025),
            (R0 - 0.020, zo - 0.040), (R0 - 0.020, zi + 0.040), (R0, zi + 0.025), (R0 + 0.002, zi + 0.010),
            (R0 + 0.013, zi - 0.004), (R0 + 0.012, zi + 0.004), (R0 - 0.003, zi + 0.012), (R0 - 0.025, zi + 0.040),
            (R0 - 0.025, zo - 0.040), (R0 - 0.004, zo - 0.012)]
    m = revolve(prof, n, mat='rim:paint', closed_profile=True)
    zf = zo - 0.030                 # spoke face plane
    # hub boss and the six spokes, slightly dished toward the hub
    m += revolve([(0.0, zf - 0.020), (0.078, zf - 0.020), (0.082, zf - 0.004), (0.074, zf + 0.012), (0.050, zf + 0.016),
                  (0.0, zf + 0.016)], seg(36, q, 10), mat='rim:paint')
    ns = 6
    for k in range(ns):
        th = k * TAU / ns + TAU / 12
        d = np.array([math.cos(th), math.sin(th), 0.0])
        sd = np.array([-math.sin(th), math.cos(th), 0.0])
        a = d * 0.064 + [0, 0, zf + 0.004]
        b = d * (R0 - 0.022) + [0, 0, zf - 0.012]
        P = np.array([lerp(a, b, t) for t in np.linspace(0, 1, seg(5, q, 3))])

        def sec(i, t):
            w = lerp(0.024, 0.017, t)
            return ellipse(w, 0.011, seg(10, q, 6), e=0.45)
        m += sweep(P, sec, 'rim:paint', up=tuple(sd), cap0='flat', cap1='flat')
    # chrome centre cap and four wheel nuts
    m += revolve([(0.0, zf + 0.040), (0.030, zf + 0.038), (0.036, zf + 0.026), (0.036, zf + 0.012), (0.0, zf + 0.012)],
                 seg(20, q, 8), mat='rim:chrome')
    for k in range(4):
        th = k * TAU / 4
        c = (math.cos(th) * 0.052, math.sin(th) * 0.052)
        m += revolve([(0.0, zf + 0.026), (0.009, zf + 0.026), (0.010, zf + 0.012), (0.0, zf + 0.012)], 6,
                     mat='rim:chrome').transform(t=(c[0], c[1], 0))
    return m


def rim_race(W, n):
    rw = W - 0.040
    zo, zi = rw / 2, -rw / 2
    prof = [(0.0, zo - 0.024), (RIM_R - 0.015, zo - 0.024), (RIM_R + 0.012, zo), (RIM_R + 0.012, zi),
            (RIM_R - 0.02, zi), (0.0, zi)]
    m = revolve(prof, n, mat='rim:paint')
    m += revolve([(0.0, zo - 0.026), (0.036, zo - 0.026), (0.036, zo + 0.010), (0.0, zo + 0.012)], 8, mat='rim:chrome')
    return m


def tyre(R, W, q):
    """Tall gravel tyre: a rounder shoulder than the GT's, with a stepped tread edge."""
    n = seg4(72, q)
    hw = W / 2
    hb = hw - 0.016
    rb = RIM_R + 0.004
    bulge = RIM_R + 0.50 * (R - RIM_R)
    pts = [(rb, -hb), (rb + 0.010, -hw + 0.008), (bulge - 0.05, -hw - 0.006), (bulge + 0.05, -hw - 0.006),
           (R - 0.040, -hw + 0.004), (R - 0.016, -hw + 0.016), (R - 0.004, -hw + 0.034), (R + 0.002, 0.0),
           (R - 0.004, hw - 0.034), (R - 0.016, hw - 0.016), (R - 0.040, hw - 0.004), (bulge + 0.05, hw + 0.006),
           (bulge - 0.05, hw + 0.006), (rb + 0.010, hw - 0.008), (rb, hb), (RIM_R - 0.006, hb - 0.008),
           (RIM_R - 0.006, -hb + 0.008)]
    np_ = max(TYRE_NP_MIN, even(int(round(32 * q))))
    prof = catmull(pts, np_, closed=True)
    rmax = prof[:, 0].max()
    prof[:, 0] = rb + (prof[:, 0] - rb) * (R - rb) / (rmax - rb)
    return revolve(prof, n, mat='tyre', closed_profile=True)


def upright(front, q):
    """Vented disc, gold four-pot calliper, hub carrier (wheel frame, right side)."""
    W = WF if front else WR
    zc = -W / 2 + 0.024
    m = Mesh()
    n = seg(40, q, 10)
    m += revolve([(0.070, zc - 0.022), (0.150, zc - 0.022), (0.150, zc + 0.000), (0.070, zc + 0.000)], n,
                 mat='body:discp', closed_profile=True)
    na = seg(12, q, 4)
    angs = np.radians(np.linspace(100, 150, na))
    path = np.stack([np.cos(angs) * 0.132, np.sin(angs) * 0.132, np.full(na, zc - 0.011)], -1)
    if q < 0.2:
        return m + sweep(path, lambda i, t: ellipse(0.026, 0.030, 4, e=0.35), 'body:caliper', cap0='fan', cap1='fan',
                         up=(0, 0, 1))
    m += sweep(path, lambda i, t: ellipse(0.026, 0.032, seg(12, q, 6), e=0.30), 'body:caliper', cap0='dome',
               cap1='dome', up=(0, 0, 1), dome_depth=0.010, dome_steps=2)
    m += blob((0.0, 0.0, zc - 0.060), (0.050, 0.150, 0.026), n=seg(16, q, 6), rings=seg(10, q, 4), e1=0.55, e2=0.6,
              mat='body:metal')
    return m


# ---------------------------------------------------------------------------------------------
# Cabin: rally buckets, a flat dash with a big tachometer, roll cage
# ---------------------------------------------------------------------------------------------

DASH = [(0.640, 0.866 + KDY), (0.600, 0.904 + KDY), (0.540, 0.934 + KDY), (0.478, 0.944 + KDY),
        (0.430, 0.932 + KDY), (0.410, 0.893 + KDY), (0.408, 0.742 + KDY), (0.440, 0.700 + KDY), (0.640, 0.700 + KDY)]
GAUGE_POS = [(0.880 + KDY, -0.462, 0.046), (0.884 + KDY, -0.270, 0.056), (0.836 + KDY, -0.120, 0.030),
             (0.836 + KDY, -0.030, 0.030)]


def _fascia(q):
    """Brushed alloy panel across the dash face."""
    m = slab(rounded_rect(0.052, 0.690, 0.008, seg(3, q, 2)), 0.006, axis=0, centre=0.403, mat='int:metal', steps=1)
    m.transform(t=(0, 0.850 + KDY, 0))
    return m


def binnacle(q):
    """Leather cowl over the two big dials, toggle switches and a rally trip meter box on the
    co-driver's side."""
    m = Mesh()
    n = seg(24, q, 8)
    for y, z, r in GAUGE_POS[:2]:
        ring = revolve([(r + 0.004, 0.000), (r + 0.012, 0.004), (r + 0.012, 0.030), (r + 0.008, 0.034),
                        (r + 0.003, 0.030), (r + 0.003, 0.006)], n, mat='int:dash', axis='x', closed_profile=True)
        ring.transform(t=(0.392 - 0.028, y, z))
        m += ring
    ang = np.linspace(math.radians(25), math.radians(155), seg(16, q, 6))
    pts = [(0.43, GAUGE_POS[0][0] + 0.024 + 0.062 * math.sin(a), DRIVER_Z + 0.160 * math.cos(a)) for a in ang]
    m += sweep(np.array(pts), lambda i, t: ellipse(0.045, 0.005, seg(8, q, 4), e=0.5), 'int:dash',
               up=(1, 0, 0), dome_depth=0.004, dome_steps=1)
    for k in range(7):
        z = -0.16 + k * 0.040
        m += strut((0.402, 0.800 + KDY, z), (0.380, 0.802 + KDY, z), 0.003, 0.003, n=seg(6, q, 4), mat='int:chrome',
                   samples=2)
    # trip meter box on top of the dash, co-driver's side
    box = slab(rounded_rect(0.045, 0.110, 0.010, seg(3, q, 2)), 0.060, axis=1, centre=0.0, mat='int:black', steps=1)
    box.transform(t=(0.50, 0.968 + KDY, 0.34))
    m += box
    face = slab(rounded_rect(0.020, 0.090, 0.004, 1), 0.004, axis=0, centre=0.0, mat='int:gauge', steps=1)
    face.transform(t=(0.454, 0.968 + KDY, 0.34))
    m += face
    return m


def console(q):
    """Transmission tunnel, a tall gear lever and the fly-off hand brake."""
    m = Mesh()
    m += blob((-0.08, 0.330 + KDY, 0.0), (0.560, 0.110, 0.092), n=seg(16, q, 6), rings=seg(8, q, 4), e1=0.35, e2=0.35,
              mat='int:carpet')
    m += strut((0.14, 0.44 + KDY, 0.0), (0.06, 0.66 + KDY, 0.0), 0.006, 0.006, n=seg(8, q, 4), mat='int:chrome',
               samples=3)
    m += blob((0.058, 0.672 + KDY, 0.0), (0.020, 0.024, 0.020), n=seg(12, q, 6), rings=seg(6, q, 4), mat='int:black')
    if q >= 0.2:
        m += strut((-0.10, 0.44 + KDY, 0.06), (0.02, 0.60 + KDY, 0.06), 0.011, 0.009, n=seg(8, q, 4), mat='int:metal',
                   samples=3)
        m += blob((0.025, 0.605 + KDY, 0.06), (0.030, 0.016, 0.016), n=seg(10, q, 5), rings=seg(5, q, 3),
                  mat='int:black')
    return m


def _seat(q, z, x0=-0.40, front=True):
    return seat(q, z, x0, front).transform(t=(0, KDY, 0))


def bent(points, bend):
    """Polyline with every inner corner replaced by a circular bend of radius `bend` (a bent
    tube: straight runs, clean constant-radius bends). Returns a dense point list."""
    P = [np.asarray(p, float) for p in points]
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        u, v = norm(a - b), norm(c - b)
        ang = math.acos(np.clip(u @ v, -1, 1))
        if ang > math.pi - 1e-3:
            out.append(b)
            continue
        d = min(bend / math.tan(ang / 2), 0.45 * np.linalg.norm(a - b), 0.45 * np.linalg.norm(c - b))
        r = d * math.tan(ang / 2)
        p0, p1 = b + u * d, b + v * d
        cen = b + norm(u + v) * (r / math.sin(ang / 2))
        e0, e1 = p0 - cen, p1 - cen
        k = max(3, int((math.pi - ang) / 0.18) + 1)
        th = math.acos(np.clip(norm(e0) @ norm(e1), -1, 1))
        for t in np.linspace(0, 1, k):
            w0 = math.sin((1 - t) * th) / math.sin(th)
            w1 = math.sin(t * th) / math.sin(th)
            out.append(cen + e0 * w0 + e1 * w1)
    out.append(P[-1])
    # resample evenly so the swept tube stays straight on the runs
    Q = np.array(out)
    L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(Q, axis=0), axis=1))])
    s_ = np.linspace(0, L[-1], max(4, int(L[-1] / 0.02) + 2))
    return np.stack([np.interp(s_, L, Q[:, i]) for i in range(3)], -1)


CAGE_R = 0.0190                 # 38 mm tube (main hoop 45 mm)
CAGE_BEND = 0.10                # centre-line bend radius (about 2.5 x the tube diameter)


def _cage_tube(pts, r, q, mat='int:cage'):
    path = bent(pts, CAGE_BEND)
    if q < 0.6:
        # the outside LODs: a coarser path (the straight runs stay straight, the bends lose samples)
        idx = list(range(0, len(path), 4))
        if idx[-1] != len(path) - 1:
            idx.append(len(path) - 1)
        path = path[idx]
    n = seg(12, q, 6)
    return sweep(path, lambda i, t: ellipse(r, r, n), mat, cap0='flat', cap1='flat')


def roll_cage(q):
    """Bolted-in rally cage in satin dark grey: a 45 mm main hoop behind the front seats, 38 mm
    A-pillar legs that run straight down behind the real A-pillars (placed on the line from the
    driver's eye to the pillar, so they hide behind it), straight roof rails with clean bends,
    door bars, a diagonal and rear stays. Black foam padding only where a helmet can touch: the
    driver's roof rail and the main hoop beside the head."""
    m = Mesh()
    eye = np.array(EYE, float)
    rh = 0.0225

    def under(x, t, d):
        return canopy(x, t) - canopy_normal(x, t) * d

    def behind(x, t, r):
        g = canopy(x, t) - canopy_normal(x, t) * 0.010
        return g - norm(g - eye) * (r + 0.012)

    xh = B_X - 0.06
    # main hoop: straight legs up from the floor, one bend each into the roof span
    top_l, top_r = under(xh, -0.56, rh + 0.03), under(xh, 0.56, rh + 0.03)
    ci = float(ci_c(np.clip(xh, -1.42, 0.70)))
    foot = lambda s_: np.array([xh, TUB_FLOOR + 0.02, s_ * (ci - 0.040)])
    belt = lambda s_: np.array([xh, float(crown(xh, gb_c(np.clip(xh, GH_X[0], GH_X[1])))) - 0.02,
                                s_ * (ci - 0.040)])
    m += _cage_tube([foot(-1), belt(-1), top_l, top_r, belt(1), foot(1)], rh, q)
    for s in (-1, 1):
        # A-pillar leg: from the header corner straight down behind the pillar to the scuttle,
        # then down the footwell to the floor
        xa0, xa1 = A_TOP + 0.03, A_BASE - 0.10
        a0 = behind(xa0, s * t_apillar(xa0), CAGE_R)
        a1 = behind(xa1, s * t_apillar(xa1), CAGE_R)
        ci1 = float(ci_c(np.clip(xa1 + 0.05, -1.42, 0.70)))
        fw = np.array([xa1 + 0.02, TUB_FLOOR + 0.04, s * (ci1 - 0.045)])
        corner = under(xh + 0.02, s * 0.56, rh + 0.03)
        hc = under(A_TOP - 0.06, s * 0.57, CAGE_R + 0.03)
        m += _cage_tube([corner, hc, a0, a1, fw], CAGE_R, q)
        # door bar: a straight diagonal in the door below the window line
        ci2 = float(ci_c(-0.10))
        yb = float(crown(-0.10, gb_c(-0.10)))
        d0 = np.array([xh + 0.03, yb - 0.10, s * (ci2 - 0.05)])
        d1 = np.array([xa1 - 0.02, TUB_FLOOR + 0.16, s * (ci2 - 0.06)])
        m += _cage_tube([d0, d1], CAGE_R * 0.95, q)
        # rear stay from the hoop top back to the floor behind the rear seat
        m += _cage_tube([top_r if s > 0 else top_l, np.array([-1.30, TUB_FLOOR + 0.20, s * 0.55])],
                        CAGE_R * 0.95, q)
        if q >= 0.2 and s < 0:
            # padding where the helmet can reach: the driver's roof rail and the hoop beside the head
            pr = np.array(bent([corner, hc], CAGE_BEND))
            seg_ = pr[int(len(pr) * 0.15):int(len(pr) * 0.75)]
            m += sweep(seg_, lambda i, t: ellipse(0.033, 0.033, seg(14, q, 8)), 'int:pad', cap0='flat', cap1='flat')
            hp = np.array(bent([belt(-1), top_l, top_r], CAGE_BEND))
            k0 = int(len(hp) * 0.08)
            m += sweep(hp[k0:k0 + 12], lambda i, t: ellipse(0.034, 0.034, seg(14, q, 8)), 'int:pad', cap0='flat',
                       cap1='flat')
    # diagonal across the hoop
    m += _cage_tube([foot(-1) + [0, 0.05, 0.03], top_r - [0, 0.02, 0.04]], CAGE_R, q)
    return m


def cabin(q):
    """Rally buckets, dash and gauges, tunnel, column, headliner, parcel shelf, roll cage."""
    m = Mesh()
    m += dash_body(q, half=0.735)
    m += _fascia(q)
    if q >= 0.6:
        m += gauges(q)
    for z in (DRIVER_Z, -DRIVER_Z):
        m += _seat(q, z)
    m += _seat(q, 0.0, x0=-1.06, front=False).transform(s=(1, 1, 1.50))
    if q < 0.1:
        return m
    m += console(q)
    m += strut(tuple(np.array(WHEEL_CENTRE) + [0.06, -0.03, 0]), (0.45, 0.80 + KDY, DRIVER_Z), 0.022, 0.022,
               n=seg(10, q, 6), mat='int:black', samples=3)
    m += panel((C_TOP + 0.02, A_TOP + 0.10), (-0.59, 0.59), seg(14, q, 3), seg(8, q, 2), 0.006, 'int:headliner',
               inset=0.024)
    m += _shelf(q)
    if q >= 0.2:
        m += roll_cage(q)
    return m


def _shelf(q):
    m = slab(rounded_rect(0.13, 0.52, 0.04, seg(3, q, 2)), 0.016, axis=1, centre=0.0, mat='int:carpet', steps=1)
    m.transform(t=(-1.30, 1.090, 0))
    return m


def door_cards(q):
    """Plain rally door trims: a flat panel, a pull strap and the window winder."""
    m = Mesh()
    for s in (-1, 1):
        ci = float(ci_c(0.10))
        z = s * (ci - 0.010)
        pts = [(x, float(crown(x, ci)) - 0.040, z) for x in np.linspace(-0.40, 0.56, 6)]
        m += tube(pts, 0.020, n=seg(10, q, 6), mat='int:dash', samples=seg(10, q, 4))
        m += blob((0.05, 0.640 + KDY, z - s * 0.012), (0.300, 0.150, 0.010), n=seg(14, q, 6), rings=seg(6, q, 4),
                  e1=0.25, e2=0.25, mat='int:dash')
        m += strut((0.20, 0.770 + KDY, z - s * 0.024), (-0.02, 0.770 + KDY, z - s * 0.024), 0.006, 0.012,
                   n=seg(8, q, 5), mat='int:black', samples=3)
        hub = np.array([-0.08, 0.660 + KDY, z - s * 0.024])
        m += strut(tuple(hub), tuple(hub + [0.0, -0.060, -s * 0.006]), 0.005, 0.005, n=seg(6, q, 4), mat='int:metal',
                   samples=2)
        m += strut(tuple(hub + [0.0, -0.060, -s * 0.006]), tuple(hub + [0.0, -0.060, -s * 0.040]), 0.008, 0.008,
                   n=seg(8, q, 5), mat='int:black', samples=2)
    return m


def cockpit_shell(q):
    m = Mesh()
    m += dash_body(q, half=0.735)
    m += _fascia(q)
    m += gauges(q)
    m += binnacle(q)
    for z in (DRIVER_Z, -DRIVER_Z):
        m += _seat(q, z)
    m += _seat(q, 0.0, x0=-1.06, front=False).transform(s=(1, 1, 1.50))
    m += console(q)
    m += strut(tuple(np.array(WHEEL_CENTRE) + [0.06, -0.03, 0]), (0.45, 0.80 + KDY, DRIVER_Z), 0.022, 0.022,
               n=seg(12, q, 6), mat='int:black', samples=3)
    m += _shelf(q)
    m += door_cards(q)
    m += pillar_trims(q)
    m += rear_view_mirror(q)
    m += roll_cage(q)
    return m


# ---------------------------------------------------------------------------------------------
# Steering wheel: dished three-spoke rally wheel, suede rim, a top-centre marker
# ---------------------------------------------------------------------------------------------

WHEEL_R = 0.172


def steering_wheel(q):
    m = Mesh()
    n = seg(56, q, 10)
    rimsec = ellipse(0.0120, 0.0140, seg(10, q, 4))
    ang = np.arange(n) / n * TAU
    path = np.stack([np.zeros(n), WHEEL_R * np.cos(ang), WHEEL_R * np.sin(ang)], -1)
    m += sweep(path, lambda i, t: rimsec, 'int:black', closed=True, up=(1, 0, 0))
    if q < 0.1:
        return m + revolve([(0.0, 0.025), (0.040, 0.025), (0.040, 0.075), (0.0, 0.078)], 8, mat='int:black', axis='x')
    # red top-centre marker on the rim
    mk = np.stack([np.full(5, 0.0), WHEEL_R * np.cos(np.linspace(-0.05, 0.05, 5) + math.pi / 2),
                   WHEEL_R * np.sin(np.linspace(-0.05, 0.05, 5) + math.pi / 2)], -1)
    m += sweep(mk, lambda i, t: ellipse(0.0128, 0.0148, seg(10, q, 4)), 'body:caliper', up=(1, 0, 0), cap0='flat',
               cap1='flat')
    # three slotted spokes dished toward the hub (deep dish: the hub sits 6 cm toward the dash)
    for a in (math.pi / 2 + 0.0, -math.pi / 2, math.pi):
        a = a if a != math.pi / 2 else math.pi / 2
        d = np.array([0.0, math.cos(a), math.sin(a)])
        side = np.array([0.0, -math.sin(a), math.cos(a)])
        pts = [d * 0.036 + [0.060, 0, 0], d * 0.105 + [0.026, 0, 0], d * (WHEEL_R - 0.004)]
        m += sweep(catmull(pts, seg(8, q, 3)), lambda i, t: ellipse(0.0022, 0.017 - 0.005 * t, seg(6, q, 4)),
                   'int:metal', up=tuple(side), dome_depth=0.003, dome_steps=1)
    m += revolve([(0.0, 0.025), (0.040, 0.025), (0.044, 0.050), (0.038, 0.075), (0.0, 0.078)], seg(20, q, 8),
                 mat='int:black', axis='x')
    m += revolve([(0.0, 0.016), (0.028, 0.016), (0.026, 0.024), (0.0, 0.026)], seg(20, q, 8), mat='body:badge',
                 axis='x')
    return m


# ---------------------------------------------------------------------------------------------
# Driver (car frame; hidden in the cockpit view): rally helmet, race suit
# ---------------------------------------------------------------------------------------------

HELMET_C = np.array([-0.440, 1.230, DRIVER_Z])
HELMET_H = np.array([0.128, 0.128, 0.114])


def driver(q):
    m = Mesh()
    n, r = seg(30, q, 8), seg(14, q, 5)
    m += blob(HELMET_C, HELMET_H, n=n, rings=r, e1=0.9, e2=0.95, mat='driver:helmet')

    def visor(u, v):
        az = (lerp(0.5 - 0.15, 0.5 + 0.15, u) - 0.5) * TAU
        el = lerp(-0.25, 0.22, v) * math.pi / 2
        d = np.stack([np.cos(el) * np.cos(az), np.sin(el), np.cos(el) * np.sin(az)], -1)
        return HELMET_C + d * HELMET_H, norm(d / HELMET_H)
    m += patch_slab(visor, seg(12, q, 3), seg(5, q, 2), 0.005, mat='glass', side_mat='driver:helmet')
    m += blob((-0.51, 0.950 + KDY, DRIVER_Z), (0.085, 0.060, 0.170), n=seg(20, q, 8), rings=seg(8, q, 4), e1=0.6,
              e2=0.7, mat='driver:suit')
    m += blob((-0.545, 0.700 + KDY, DRIVER_Z), (0.110, 0.230, 0.180), n=seg(20, q, 8), rings=seg(10, q, 4), e1=0.7,
              e2=0.7, mat='driver:suit', R=rot((0, 0, 1), math.radians(12)))
    for s in (-1, 1):
        sh = np.array([-0.51, 0.930 + KDY, DRIVER_Z + s * 0.165])
        grip = sw_to_car((0.0, WHEEL_R * math.sin(math.radians(40)), s * WHEEL_R * math.cos(math.radians(40))))
        elbow = (sh + grip) / 2 + [0.0, -0.08, s * 0.05]
        m += tube([sh, elbow, grip - [0.03, 0, 0]], 0.040, n=seg(10, q, 6), mat='driver:suit',
                  radius_fn=lambda t: lerp(1.0, 0.75, t), samples=seg(12, q, 4))
        m += blob(grip, (0.032, 0.040, 0.030), n=seg(12, q, 6), rings=seg(6, q, 4), e1=0.7, e2=0.7, mat='driver:glove')
        if q < 0.1:
            continue
        m += tube([(-0.49, 0.42 + KDY, DRIVER_Z + s * 0.09), (-0.06, 0.47 + KDY, DRIVER_Z + s * 0.10),
                   (0.24, 0.36 + KDY, DRIVER_Z + s * 0.10)], 0.065, n=seg(10, q, 6), mat='driver:suit',
                  samples=seg(10, q, 4))
    return m


def hands(q):
    """Rally gloves on the rim (the Aurelia's hand, with a race-suit sleeve)."""
    m = _aurelia_hands(q)
    m.mats = ['driver:suit' if k == 'driver:jacket' else k for k in m.mats]
    return m


# ---------------------------------------------------------------------------------------------
# Exhaust: one big-bore pipe out under the left rear corner
# ---------------------------------------------------------------------------------------------

def exhaust(q):
    m = Mesh()
    n = seg(20, q, 8)
    pipe = revolve([(0.034, 0.0), (0.038, -0.205), (0.039, -0.210), (0.039, -0.225), (0.031, -0.225),
                    (0.030, -0.010)], n, mat='body:chrome', axis='x', closed_profile=True)
    pipe.transform(t=(-1.84, 0.392, -0.52))
    m += pipe
    if q >= 0.2:
        soot = revolve([(0.0, -0.205), (0.0305, -0.205), (0.0305, -0.201), (0.0, -0.201)], n, mat='body:inlet',
                       axis='x')
        soot.transform(t=(-1.84, 0.392, -0.52))
        m += soot
    return m


GLOW_C = np.array([0.36, 0.86 + KDY, DRIVER_Z * 0.6])

# ---------------------------------------------------------------------------------------------
# Livery: panel gaps; factory works livery (Factory Livery finish): coral-red double stripes over
# the bonnet, roof and boot and along the waist (the factory blue's luminance, so a player's paint
# stays clean), a black anti-glare panel ahead of the windscreen, black door number discs, the
# car's name on the doors, white lettering on the mud flaps
# ---------------------------------------------------------------------------------------------

DOOR_X = (0.640, -0.500)
RACE_NO = '27'
STRIPE = (0.92, 0.25, 0.20)             # coral red, scaled to the factory blue's luminance below


def _lum(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


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
        sill = yb + 0.105
        belt = np.vectorize(lambda v: float(crown(v, gb_c(np.clip(v, GH_X[0], GH_X[1])))))(x)
        in_door = (x < DOOR_X[0] + 0.004) & (x > DOOR_X[1] - 0.004)
        for xd in DOOR_X:
            g = np.maximum(g, lv.line(x - xd, W) * side * (y > sill - 0.005) * (y < belt + 0.01))
        g = np.maximum(g, lv.line(y - sill, W) * side * in_door * (az > 0.6))
        bon = (x > 0.70) & (x < fx(1.95))
        g = np.maximum(g, lv.line(x - 0.700, W) * top * (az < 0.80))
        g = np.maximum(g, lv.line(az - 0.800, W) * top * bon)
        boot = (x < -1.44) & (x > fx(-2.00))
        g = np.maximum(g, lv.line(x + 1.44, W) * top * (az < 0.78))
        g = np.maximum(g, lv.line(az - 0.78, W) * valid * boot * (y > 0.98))
        shade = 1.0 - 0.62 * np.clip(g, 0, 1)
        # black anti-glare panel on the bonnet ahead of the windscreen
        ag = valid & top & (x > 0.70) & (x < 1.12) & (az < 0.60)
        soft = lv.band(x, 0.70, 1.12, 0.004) * lv.band(az, -1, 0.60, 0.004)
        shade = shade * (1 - 0.90 * soft * ag)
        # door number discs (black ring) with the number, and the name under the window
        num, ring = lv.number_mask(RACE_NO)
        dark = zero.copy()
        for s in (-1, 1):
            c = np.array([0.08, 0.735, 0.0])
            sp = side & ((N @ side_n(s)) > 0.5)
            d = np.sqrt((x - c[0]) ** 2 + (y - c[1]) ** 2)
            dark = np.maximum(dark, lv.line(d - 0.150, 0.014) * sp)
            dark = np.maximum(dark, 0.95 * lv.stamp(P, N, valid, num, (0.08, 0.735, s * 0.87), (s, 0, 0), (0, 1, 0),
                                                    0.17, facing=side_n(s), min_dot=0.5, depth=0.08))
            dark = np.maximum(dark, 0.92 * lv.stamp(P, N, valid, lv.text_mask('KESTREL'), (0.10, 0.905, s * 0.87),
                                                    (s, 0, 0), (0, 1, 0), 0.34, facing=side_n(s), min_dot=0.5,
                                                    depth=0.08))
        # roof number, read from the side of the stage
        dark = np.maximum(dark, 0.95 * lv.stamp(P, N, valid, num, (-0.42, 1.50, 0.0), (0, 0, 1), (1, 0, 0), 0.26,
                                                facing=(0, 1, 0), min_dot=0.6, depth=0.06))
        shade = shade * (1 - np.clip(dark, 0, 0.95))
        # coral-red double stripes over the car's centre line and along the waist
        k = _lum(FACTORY_PAINT) / _lum(STRIPE)
        col = tuple(min(1.0, c * k) for c in STRIPE)
        cl = valid & (N[..., 1] > 0.45) & (az < 0.40)
        stripes = (lv.band(az, 0.105, 0.185, 0.004) + lv.band(az, 0.215, 0.250, 0.004)) * cl
        stripes = stripes * (1 - lv.band(x, -0.70, -0.14, 0.004))       # clear of the roof number
        waist = valid & side & (x < 1.92) & (x > -1.98)
        ys = np.vectorize(lambda v: float(ysh_c(v)))(x)
        wb = lv.band(ys - y, 0.020, 0.060, 0.003) * waist
        wb = wb * (1 - (lv.band(x - 0.08, -0.17, 0.17, 0.004)))           # broken by the number disc
        return {'shade': shade, 'layers': [(np.clip(stripes + wb, 0, 1) * valid, col)]}
    if group == 'Body':
        layers = []
        # mud flaps: the game's name in white
        ap = lv.text_mask('APEX')
        for xc, yc, ra in ARCH:
            xf = xc - ra * 0.86
            for s in (-1, 1):
                zc = (TF if xc > 0 else TR)
                layers.append((lv.stamp(P, N, valid, ap, (xf - 0.006, 0.300, s * zc), (0, 0, -1), (0, 1, 0), 0.17,
                                        facing=(-1, 0, 0), min_dot=0.6, depth=0.02), (0.85, 0.85, 0.84), 0.6))
        # rear number plate: white characters on the black plate
        p, nrm = tail_hit(0.740, 0.0)
        X0 = fx(p[0])
        layers.append((lv.stamp(P, N, valid, lv.text_mask('KZ 27', oblique=False), (X0 - 0.006, 0.740, 0.0), (0, 0, 1),
                                (0, 1, 0), 0.30, facing=(-1, 0, 0), min_dot=0.5, depth=0.03), (0.85, 0.85, 0.84), 0.5))
        # nose badge: a white kestrel-wing chevron on the blue enamel
        pb, nb = nose_hit(BADGE_Y, 0.0)
        XB = fx(pb[0] + nb[0] * 0.006)
        layers.append((lv.stamp(P, N, valid, lv.text_mask('K', oblique=False), (XB, pb[1], 0.0), (0, 0, 1), (0, 1, 0),
                                0.022, facing=nb, min_dot=0.6, depth=0.01), (0.85, 0.85, 0.84), 0.2))
        return {'layers': layers}
    return {}


# ---------------------------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------------------------

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
    sb, sl, sg = spot_lamps(q)
    body += sb
    head += sl
    glass += sg
    tb, tl = tail_lamps(q)
    body += tb
    tail += tl
    body += nose_badge(q) + bumpers(q) + boot_plate(q) + flares(q) + mud_flaps(q) + tail_finisher(q)
    body += door_mirrors(q) + fuel_filler(q) + wipers(q)
    if q >= 0.2:
        body += indicators(q) + door_handles(q) + sills(q) + bonnet_pins(q)
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
    'gt_lights': ((2.95, 0.95, 1.30), (2.02, 0.66, 0.45), 45),
    'gt_grille': ((3.45, 0.78, 0.50), (2.05, 0.66, 0.0), 48),
    'gt_wheel': ((2.10, 0.52, 1.80), (1.19, 0.38, 0.85), 62),
    'gt_tail': ((-3.20, 1.10, 1.40), (-2.08, 0.80, 0.40), 45),
    'gt_interior': ((0.05, 1.42, 2.30), (-0.30, 1.00, 0.0), 40),
    'gt_window': ((0.55, 1.30, 3.10), (0.05, 1.08, 0.0), 38),
}


def make_meta():
    m = _aurelia_meta()
    m['steeringWheel']['tiltDeg'] = round(math.degrees(WHEEL_TILT))
    wc = np.array(WHEEL_CENTRE)
    views = dict(RENDER_VIEWS)
    # gloved hands close-up from beside the driver's head (as the Aurelia's)
    views['gt_hands'] = (tuple((wc + [-0.28, 0.28, 0.29]).round(3).tolist()), tuple((wc + [-0.05, 0.09, -0.13]).round(3).tolist()), 40)
    m['renderViews'] = {k: [list(v[0]), list(v[1]), v[2]] for k, v in views.items()}
    return m


META = make_meta()
