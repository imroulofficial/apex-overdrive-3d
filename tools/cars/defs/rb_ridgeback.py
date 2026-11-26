"""Ridgeback (rb-ridgeback): the all-weather endurance car, a modern five-door expedition SUV,
4.80 m. Batch 1 redo (batch 2 round).

An original design with the character of the current Ridgeback: a tall, square, modern off-road
SUV in a dark factory colour, with a high flat bonnet over an upright face, a raked windscreen,
a long roof with a platform rack and light bar, black-out pillars (floating roof), chunky squared
black wheel-arch flares, slim LED headlamps with a C-shaped running-light signature joined by a
strong black grille, a chunky bumper with fog lamps, orange recovery hooks, a skid plate and a
bull bar, vertical LED tail lamps, a spare wheel on the side-hinged tailgate, side steps, a
snorkel, dark multi-spoke wheels and big mud-terrain tyres with deep shoulder lugs. The cockpit is
a modern SUV's: a horizontal dash, a digital cluster in a hooded screen, a centre touch screen,
a chunky three-spoke wheel. No real manufacturer's shapes, badges or names.

It inherits the Kestrel (which inherits the Aurelia): subdivision-cage body, canopy glass and
sliding windows, ray hits, cabin pieces, hands and cockpit machinery. The canopy here runs right
to the tail and drops almost vertically into the tailgate.

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
_kestrel_flares, _kestrel_tyre, _aurelia_glow = flares, tyre, glow

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
FACTORY_PAINT = (0.042, 0.045, 0.050)  # linear RGB: graphite (dark, like the old Ridgeback)
ACCENT = (0.92, 0.30, 0.03)            # orange recovery hooks and calipers
LEATHER = (0.040, 0.040, 0.043)        # charcoal cloth and vinyl
TYRE_WORDS = ['APEX OVERDRIVE', 'RIDGEBACK M/T', 'APEX OVERDRIVE', 'RIDGEBACK M/T']
TYRE_HW = WF / 2
TYRE_BAND = None
TYRE_BLOCKS = 30                      # big mud-terrain blocks round the tread (plus shoulder lugs)
TYRE_TEXT_R = (0.120, 0.030)
GLOVE = (0.065, 0.042, 0.024)
GLOVE_ACCENT = (0.40, 0.30, 0.16)   # dark brown softshell gloves, sand stitching and knuckle band
RIM_TUBE = 0.0170                     # chunky modern wheel rim
HEADLINER = (0.050, 0.050, 0.053)
METAL = (0.40, 0.41, 0.43)
METAL_RM = (0.38, 0.6)
RIM_PAINT = (0.030, 0.031, 0.034)     # satin black multi-spoke wheels
CALIPER = (0.92, 0.30, 0.03)
STEEL = (0.022, 0.022, 0.024)         # black powder-coated bars and rack
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

yb_c = Curve([(2.33, 0.660), (2.22, 0.590), (2.05, 0.530), (1.80, 0.490), (1.20, 0.468), (0.00, 0.462),
              (-1.00, 0.466), (-1.70, 0.495), (-1.95, 0.530), (-2.12, 0.580), (-2.22, 0.630)])
hw_c = Curve([(2.33, 0.860), (2.28, 0.892), (2.18, 0.910), (1.90, 0.918), (1.20, 0.920), (0.20, 0.920),
              (-0.80, 0.920), (-1.60, 0.920), (-2.00, 0.916), (-2.16, 0.906), (-2.22, 0.888)])
ymx_c = Curve([(2.33, 0.840), (1.60, 0.880), (0.00, 0.890), (-1.60, 0.890), (-2.22, 0.880)])
ysh_c = Curve([(2.33, 1.182), (2.24, 1.200), (2.05, 1.214), (1.60, 1.222), (0.80, 1.226), (0.00, 1.228),
               (-1.20, 1.230), (-2.00, 1.230), (-2.22, 1.226)])
shd_c = Curve([(2.33, 0.034), (1.60, 0.036), (0.00, 0.036), (-2.22, 0.034)])
top_c = Curve([(2.33, 1.210), (2.24, 1.240), (2.05, 1.266), (1.70, 1.284), (1.20, 1.298), (0.95, 1.304), (0.862, 1.306),
               (0.70, 1.340), (-1.00, 1.340), (-2.14, 1.340), (-2.18, 1.262), (-2.22, 1.250)])

CABIN = (-2.14, 0.66)
TUB_FLOOR = 0.640
ci_c = Curve([(0.70, 0.800), (-2.14, 0.800)])
ZWELL = 0.640
ARCH = [(XF, RF + 0.012, RF + 0.040), (XR, RR + 0.012, RR + 0.040)]
FACE_X = 2.300
FACE_D = 0.040
MOUTH_E = (0.10, 0.16)
MOUTH_DROOP = 0.0
BULGE = 0.012
BULGE_W = 0.360
ROW_Z = (0.14, 0.360, 0.500)
STATION_XS = (-2.22, -2.18, -2.10, -1.98, -1.84, -0.75, -0.50, -0.25, 0.0, 0.25, 0.46, 0.66, 0.86, 1.96, 2.06,
              2.14, 2.22)
TAIL_TURN = (0.030, 0.92)
ROW_IN = (0.100, 0.050, 0.016)
SIDE_CREASE = 0.85
OVERHANG = 2.00


def bulge_w(x):
    return float(window(x, 0.85, 2.18, 0.30))


def crown_e(x):
    return 5.0


def tip_shift(x, z, y=0.0):
    z = np.abs(z)
    return 0.012 * smoothstep(2.14, FACE_X, x) * smoothstep(0.64, 0.82, z)


def gb_c(x):
    return float(Curve([(0.866, 0.834), (0.76, 0.862), (0.50, 0.872), (-2.00, 0.872), (-2.14, 0.866),
                        (-2.20, 0.856)])(x))


# ---------------------------------------------------------------------------------------------
# Greenhouse: upright glass, a long flat roof, the tailgate glass on the vertical back
# ---------------------------------------------------------------------------------------------

yr_c = Curve([(0.866, 1.306), (0.80, 1.364), (0.70, 1.452), (0.60, 1.540), (0.50, 1.626), (0.40, 1.706), (0.30, 1.772),
              (0.20, 1.822), (0.10, 1.850), (0.00, 1.864), (-0.60, 1.876), (-1.40, 1.872), (-1.85, 1.862),
              (-2.00, 1.850), (-2.07, 1.830), (-2.105, 1.796), (-2.130, 1.690), (-2.152, 1.520), (-2.170, 1.360),
              (-2.182, 1.270)])
GH_X = (-2.182, 0.866)
T_CANT = 0.55
A_TOP, A_BASE = 0.150, 0.862
B_X = -0.335
X2 = -1.225                     # rear door glass rear edge (C post)
C_TOP, C_BASE = -1.960, -1.990  # D line: the third window's rear edge, near vertical
RW = (-2.172, -2.120, 0.400)    # tailgate glass on the vertical back (x span of the drop, half width in t)
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
# Front: a strong black grille joining slim LED headlamps, a chunky bumper with fog lamps and
# orange recovery hooks, an alloy skid plate and a bull bar carrying a light bar
# ---------------------------------------------------------------------------------------------

MOUTH = (1.068, 0.520, 0.132)   # grille opening between the lamps (centre y, half width, half height)
LAMP_Z, LAMP_HW, LAMP_HH, LAMP_Y = 0.690, 0.150, 0.054, 1.142


def _lamp_frame(s, y=None, z=None, hw=None):
    """Centre and frame of a lamp on the face: local x across the lamp, y up, z out of the face."""
    y = LAMP_Y if y is None else y
    z = LAMP_Z if z is None else z
    hw = LAMP_HW if hw is None else hw
    p0, _ = nose_hit(y, s * (z - hw * 0.7))
    p1, _ = nose_hit(y, s * (z + hw * 0.7))
    c, n_ = nose_hit(y, s * z)
    across = norm(p1 - p0)
    out = norm(np.cross(across, (0, 1, 0)))
    if out[0] < 0:
        out = -out
    up = norm(np.cross(out, across))
    if up[1] < 0:
        up = -up
    xax = np.cross(up, out)
    R = np.stack([xax, up, out], -1)
    o = 1.0 if np.dot(xax, (0, 0, s)) > 0 else -1.0     # local x sign of the lamp's outer end
    return c, R, o


def grille(q):
    """Black grille: a satin surround on the mouth, a dark mesh, three thick horizontal bars and
    a top bar that runs on into the headlamps."""
    m = Mesh()
    cy, ma, mb = MOUTH
    n = seg(64, q, 14)
    ring = mouth_outline(n, 0.002, _mx() + 0.001)
    m += sweep(ring, lambda i, t: ellipse(0.008, 0.010, seg(8, q, 4)), 'body:plastic', closed=True)
    xg = _mx() - 0.040
    back = slab(rounded_rect(mb * 0.97, ma * 0.985, 0.016, seg(4, q, 2)), 0.006, axis=0, centre=xg - 0.012,
                mat='body:well', steps=1)
    back.transform(t=(0, cy, 0))
    m += back
    if q < 0.2:
        return m
    for k, yy in enumerate(np.linspace(cy - mb * 0.62, cy + mb * 0.62, 3)):
        b = slab(rounded_rect(0.013 if k else 0.016, ma * 0.985, 0.006, seg(2, q, 1)), 0.034, axis=0,
                 centre=xg + 0.012, mat='body:smoke' if k == 2 else 'body:plastic', steps=1)
        b.transform(t=(0, yy, 0))
        m += b
    return m


def headlamp_parts(q, s):
    """Slim LED headlamp: a smoked housing, two small projector modules, a running-light
    signature along the top and down the outer end (lights with the headlamps), a clear cover.
    Returns (body, lens, glass)."""
    body, lens, glass = Mesh(), Mesh(), Mesh()
    c, R, o = _lamp_frame(s)
    hw, hh = LAMP_HW, LAMP_HH
    lo = q < 0.1
    rs = 1 if lo else seg(4, q, 2)
    body += placed(slab(rounded_rect(hw + 0.012, hh + 0.012, 0.014, rs), 0.050, axis=2, centre=-0.022,
                        mat='body:smoke', steps=1), R, c)
    if not lo:
        for lx in (-o * 0.070, -o * 0.010):
            pc = c + R @ np.array([lx, -0.004, -0.004])
            body += placed(revolve([(0.024, 0.000), (0.016, -0.012), (0.0, -0.016)], seg(20, q, 8),
                                   mat='body:reflector'), R, pc)
            lens += placed(revolve([(0.0, 0.002), (0.012, 0.002), (0.014, -0.004), (0.0, -0.006)], seg(14, q, 6),
                                   mat='headlight_lens'), R, pc)
    else:
        lens += placed(slab(rounded_rect(0.050, 0.016, 0.004, 1, cx=-o * 0.040), 0.006, axis=2, centre=0.000,
                            mat='headlight_lens', steps=1), R, c)
    # running-light signature: along the top and down the outer end
    sig = [(-o * (hw - 0.020), hh - 0.010), (o * (hw - 0.016), hh - 0.010), (o * (hw - 0.016), -hh + 0.012),
           (o * (hw - 0.046), -hh + 0.012)]
    pts = [c + R @ np.array([x, y, 0.002]) for x, y in sig]
    if lo:
        lens += strut(tuple(pts[0]), tuple(pts[1]), 0.005, 0.005, n=4, mat='headlight_lens', samples=2, cap='fan')
    else:
        lens += sweep(bent(pts, 0.012), lambda i, t: ellipse(0.0042, 0.0042, seg(8, q, 4)), 'headlight_lens',
                      cap0='flat', cap1='flat')
    glass += placed(slab(rounded_rect(hw + 0.006, hh + 0.006, 0.012, rs), 0.005, axis=2, centre=0.010,
                         mat='glass:clear', steps=1), R, c)
    return body, lens, glass


def indicators(q):
    """Amber LED strips under the headlamps' outer ends."""
    m = Mesh()
    for s in (-1, 1):
        c, R, o = _lamp_frame(s, y=LAMP_Y - LAMP_HH - 0.040, z=LAMP_Z + 0.03, hw=0.08)
        m += placed(slab(rounded_rect(0.060, 0.008, 0.004, 1), 0.010, axis=2, centre=0.002, mat='body:amber',
                         steps=1), R, c)
    return m


BADGE_Y = 1.150


def nose_badge(q):
    return Mesh()


def bumpers(q):
    """Chunky black front bumper with fog lamps, orange recovery hooks, an alloy skid plate and a
    bull bar with a light bar; black rear bumper with a step and a recovery hook."""
    m = Mesh()
    zs = [0.0, 0.30, 0.55, 0.70, 0.80, 0.86, 0.90]
    fpath = _bumper_path(nose_hit, 0.850, 1, zs, 0.050)
    fpath = ([(fpath[0][0] - 0.40, fpath[0][1] * 1.03), (fpath[0][0] - 0.16, fpath[0][1] * 1.02)] + fpath
             + [(fpath[-1][0] - 0.16, fpath[-1][1] * 1.02), (fpath[-1][0] - 0.40, fpath[-1][1] * 1.03)])
    m += blade(fpath, 0.850, 0.098, 0.060, q, mat='body:plastic')
    rzs = [0.0, 0.30, 0.55, 0.70, 0.80, 0.86, 0.90]
    rpath = _bumper_path(tail_hit, 0.700, -1, rzs, 0.040)
    rpath = [(rpath[0][0] + 0.14, rpath[0][1] * 1.01)] + rpath + [(rpath[-1][0] + 0.14, rpath[-1][1] * 1.01)]
    m += blade(rpath, 0.700, 0.100, 0.055, q, mat='body:plastic')
    xf = _mx() + 0.055 + 0.060                      # bumper front face
    lo = q < 0.1
    if q >= 0.2:
        # fog lamps in square smoked recesses at the bumper's corners
        for s in (-1, 1):
            p, nrm = ray_hit((3.0, 0.850, s * 0.700), (-1, 0, 0))
            R = frame_from(norm(nrm * 0.7 + np.array([0.3, 0, 0])))
            m += placed(slab(rounded_rect(0.046, 0.034, 0.010, seg(3, q, 2)), 0.016, axis=2, centre=0.004,
                             mat='body:smoke', steps=1), R, p)
        # step plate on the rear bumper
        p, nrm = tail_hit(0.770, 0.0)
        m += slab(rounded_rect(0.050, 0.300, 0.010, seg(3, q, 2), cx=p[0] - 0.040), 0.008, axis=1, centre=0.803,
                  mat='body:alu', steps=1)
    # orange recovery hooks: two at the front, one at the back
    if not lo:
        for z in (-0.40, 0.40):
            loop = [(xf - 0.04, 0.690, z), (xf + 0.030, 0.690, z), (xf + 0.045, 0.705, z), (xf + 0.030, 0.722, z),
                    (xf - 0.02, 0.722, z)]
            m += tube(loop, 0.009, n=seg(8, q, 5), mat='body:accent', samples=seg(10, q, 5))
        p, nrm = tail_hit(0.640, -0.55)
        xr = p[0] - 0.05
        loop = [(xr + 0.06, 0.630, -0.55), (xr - 0.02, 0.630, -0.55), (xr - 0.035, 0.645, -0.55),
                (xr - 0.02, 0.662, -0.55), (xr + 0.04, 0.662, -0.55)]
        m += tube(loop, 0.009, n=seg(8, q, 5), mat='body:accent', samples=seg(10, q, 5))

    # bull bar: two square-section uprights from the bumper, a top bar with rounded corners
    xb = xf + 0.040
    sec_n = 4 if lo else seg(10, q, 6)
    hoop = [(xb - 0.03, 0.92, -0.44), (xb, 1.060, -0.44), (xb, 1.060, 0.44), (xb - 0.03, 0.92, 0.44)]
    path = bent(hoop, 0.06) if not lo else np.array(hoop)
    m += sweep(path, lambda i, t: ellipse(0.022, 0.026, sec_n, e=0.45), 'body:steel', cap0='flat', cap1='flat')
    if q >= 0.2:
        # inner uprights and the LED light bar on top
        for z in (-0.14, 0.14):
            m += strut((xb - 0.02, 0.92, z), (xb, 1.048, z), 0.016, 0.018, n=seg(8, q, 5), mat='body:steel', samples=2,
                       e=0.45)
    # skid plate under the nose
    def guard(u, v):
        z = (u - 0.5) * 1.05
        x = lerp(_mx() + 0.080, 1.62, v)
        y = 0.640 - 0.180 * smoothstep(0.0, 0.55, v)
        P = np.stack([x, y, z], -1)
        Nn = np.zeros_like(P)
        Nn[..., 1] = -1
        return P, Nn
    m += patch_slab(guard, seg(10, q, 3), seg(8, q, 3), 0.010, mat='body:alu')
    return m


def light_bar(q):
    """LED light bar on the roof rack's front, over the windscreen: a smoked box (body) and its
    lit face (headlight_lens). Returns (body, lens)."""
    body, lens = Mesh(), Mesh()
    p = canopy(0.14, 0.0) + np.array([0.0, 0.075 + 0.030, 0.0])
    box = slab(rounded_rect(0.030, 0.420, 0.010, seg(3, q, 1) if q >= 0.1 else 1), 0.044, axis=1, centre=p[1],
               mat='body:smoke', steps=1)
    box.transform(t=(p[0], 0, 0))
    body += box
    face = slab(rounded_rect(0.012, 0.400, 0.004, 1), 0.006, axis=0, centre=p[0] + 0.030, mat='headlight_lens', steps=1)
    face.transform(t=(0, p[1], 0))
    lens += face
    return body, lens


TAIL_Y = 1.060
TAIL_Z = 0.838


def tail_lamps(q):
    """Vertical LED tail lamps on the rear corners: a smoked housing, four red light-bar
    segments and an outer red strip (taillight_lens), an amber indicator and a white reverse
    lamp. Returns (body, lens)."""
    body, lens = Mesh(), Mesh()
    lo = q < 0.1
    for s in (-1, 1):
        p, nrm = tail_hit(TAIL_Y, s * TAIL_Z)
        R = frame_from(norm(nrm * 0.8 + np.array([0, 0, s * 0.2])))
        c = p + nrm * 0.004
        o = 1.0 if np.dot(R[:, 0], (0, 0, s)) > 0 else -1.0
        body += placed(slab(rounded_rect(0.054, 0.180, 0.016, 1 if lo else seg(3, q, 2)), 0.022, axis=2, centre=-0.004,
                            mat='body:smoke', steps=1), R, c)
        if lo:
            lens += placed(slab(rounded_rect(0.044, 0.120, 0.008, 1, cy=0.020), 0.008, axis=2, centre=0.008,
                                mat='taillight_lens', steps=1), R, c)
            continue
        for k in range(4):
            lens += placed(slab(rounded_rect(0.036, 0.0075, 0.003, 1, cx=-o * 0.006, cy=0.120 - k * 0.046), 0.006,
                                axis=2, centre=0.008, mat='taillight_lens', steps=1), R, c)
        lens += placed(slab(rounded_rect(0.006, 0.150, 0.003, 1, cx=o * 0.040, cy=0.000), 0.006, axis=2,
                            centre=0.008, mat='taillight_lens', steps=1), R, c)
        if q >= 0.2:
            body += placed(slab(rounded_rect(0.034, 0.012, 0.004, 1, cx=-o * 0.006, cy=-0.150), 0.006, axis=2,
                                centre=0.008, mat='body:reflector', steps=1), R, c)
            body += placed(slab(rounded_rect(0.034, 0.010, 0.004, 1, cx=-o * 0.006, cy=0.162), 0.006, axis=2,
                                centre=0.008, mat='body:amber', steps=1), R, c)
    return body, lens


def tail_finisher(q):
    """Black tailgate handle on the hinge-free (right) side."""
    if q < 0.2:
        return Mesh()
    p, nrm = tail_hit(1.150, 0.600)
    R = frame_from(nrm)
    return placed(slab(rounded_rect(0.070, 0.020, 0.008, seg(3, q, 2)), 0.016, axis=2, centre=0.006,
                       mat='body:plastic', steps=1), R, p)


def boot_plate(q):
    if q < 0.2:
        return Mesh()
    p, nrm = tail_hit(0.900, 0.0)
    R = frame_from(nrm)
    return placed(slab(rounded_rect(0.230, 0.058, 0.008, seg(3, q, 2)), 0.006, axis=2, centre=0.002,
                       mat='body:rubber', steps=1), R, p)


SPARE = (-2.230, 1.080)         # spare wheel centre (x of its mounting face, y)


def spare_wheel(q):
    """The spare on the tailgate: a full mud-terrain tyre (its own rubber material, so it is
    shaded like the body and not by the wheel-frame tyre shader) on a black wheel, a black carrier
    and a hub cap."""
    R = rot((0, 1, 0), -math.pi / 2)
    qq = min(q, 0.6)
    m = Mesh()
    if q < 0.1:
        r0 = RR * 0.97
        t = revolve([(RIM_R, 0.0), (r0 - 0.03, 0.0), (r0, 0.03), (r0, WR - 0.03), (r0 - 0.03, WR), (RIM_R, WR)], 10,
                    closed_profile=True, mat='body:tyre')
        t.transform(t=(0, 0, -WR / 2))
        r = revolve([(0.0, 0.0), (RIM_R, 0.0), (RIM_R, 0.04), (0.0, 0.04)], 8, mat='rim:paint')
        r.transform(t=(0, 0, WR / 2 - 0.05))
    else:
        t = tyre(RR * 0.97, WR, qq)
        t.mats = ['body:tyre'] * len(t.F)
        r = rim(WR, qq) if q >= 0.6 else rim_race(WR, seg4(72, q))
    for part in (t, r):
        part.V = part.V @ R.T + np.array([SPARE[0] - WR / 2 - 0.010, SPARE[1], 0.0])
        m += part
    m += revolve([(0.0, 0.0), (0.090, 0.0), (0.090, 0.040), (0.0, 0.045)], seg(16, q, 8), mat='body:steel',
                 axis='x').transform(t=(SPARE[0] + 0.030, SPARE[1], 0.0))
    return m


def flares(q):
    """Chunky black bolt-on flares, squared at the top: a deep band round each arch standing well
    out over the big tyres (their outer edge flattened over the wheel), with a step along it."""
    m = Mesh()
    lo = q < 0.1
    for xc, yc, ra in ARCH:
        a0, a1 = math.radians(-12), math.radians(192)
        na = 7 if lo else seg(34, q, 10)
        angs = np.linspace(a0, a1, na)
        ring = []
        for a in angs:
            x = xc + math.cos(a) * (ra + 0.016)
            y = yc + math.sin(a) * (ra + 0.016)
            z = surf_z(x, max(float(yb_c(x)) + 0.040, min(y, float(ysh_c(x)) - 0.03)))
            ring.append((x, y, z))
        ring = np.array(ring)
        prof = (((0.000, -0.050), (0.020, -0.054), (0.062, -0.040), (0.088, -0.010), (0.092, 0.020), (0.090, 0.050),
                 (0.074, 0.066), (0.000, 0.058)) if not lo else
                ((0.000, -0.050), (0.088, -0.010), (0.090, 0.050), (0.000, 0.058)))
        for s in (-1, 1):
            P = ring * [1, 1, s]
            rings = []
            for i in range(len(P)):
                a = angs[i]
                sq = 1.0 + 0.55 * max(0.0, math.sin(a)) ** 6        # squared-off top: the band grows over the wheel
                d_ = norm(P[i] - np.array([xc, yc, P[i][2]]))
                rings.append([P[i] + np.array([0, 0, s]) * pz - d_ * (pr * (sq if pr > 0 else 1.0))
                              for pz, pr in prof])
            m += loft(np.array(rings), 'body:plastic', cap0='fan', cap1='fan', closed=False).orient_outward()
            if q >= 0.6:
                for a in np.linspace(a0 + 0.10, a1 - 0.10, 11):
                    sq = 1.0 + 0.55 * max(0.0, math.sin(a)) ** 6
                    x = xc + math.cos(a) * (ra + 0.016 + 0.035 * sq)
                    y = yc + math.sin(a) * (ra + 0.016 + 0.035 * sq)
                    z = surf_z(x, max(float(yb_c(x)) + 0.040, min(y, float(ysh_c(x)) - 0.03))) + 0.084
                    m += blob((x, y, s * z), (0.006, 0.006, 0.004), n=8, rings=4, mat='body:steel')
    return m


def cladding(q):
    """Black lower body cladding along the doors between the flares (rugged modern SUV)."""
    m = Mesh()
    x0, x1 = XF - ARCH[0][2] - 0.02, XR + ARCH[1][2] + 0.02
    for s in (-1, 1):
        def fn(u, v, s=s):
            x = x1 + (x0 - x1) * u
            yb = np.vectorize(lambda t: float(yb_c(t)))(x)
            y = yb + 0.045 + 0.150 * v
            z = np.vectorize(lambda a, b: surf_z(a, b))(x, y) + 0.002
            P = np.stack([x, y, s * z], -1)
            Nn = np.zeros_like(P)
            Nn[..., 2] = s
            return P, Nn
        m += patch_slab(fn, seg(16, q, 4), 2, 0.012, mat='body:plastic')
    return m


def side_steps(q):
    """Running boards between the arches: a black board with an alloy tread strip, on brackets."""
    m = Mesh()
    x0, x1 = XF - ARCH[0][2] - 0.07, XR + ARCH[1][2] + 0.07
    for s in (-1, 1):
        z = 0.925
        m += slab(rounded_rect((x0 - x1) / 2, 0.075, 0.020, seg(3, q, 2), cx=(x0 + x1) / 2, cy=s * (z - 0.050)),
                  0.040, axis=1, centre=0.430, mat='body:plastic', steps=1)
        m += slab(rounded_rect((x0 - x1) / 2 - 0.03, 0.040, 0.012, seg(3, q, 2), cx=(x0 + x1) / 2, cy=s * (z - 0.050)),
                  0.006, axis=1, centre=0.452, mat='body:alu', steps=1)
        for x in np.linspace(x1 + 0.12, x0 - 0.12, 3 if q >= 0.2 else 2):
            m += strut((x, 0.420, s * 0.86), (x, 0.480, s * 0.76), 0.022, 0.010, n=seg(6, q, 4), mat='body:steel',
                       samples=2)
    return m


def roof_rack(q):
    """Low platform rack: two flat side rails on three feet a side, seven flat slats, a wind
    deflector at the front."""
    m = Mesh()
    lo = q < 0.1
    h = 0.075
    xs = (-2.00, 0.10)
    nf = 2 if lo else 3
    for s in (-1, 1):
        a, b = canopy(xs[0], s * 0.46) + [0, h, 0], canopy(xs[1], s * 0.46) + [0, h, 0]
        m += strut(tuple(a), tuple(b), 0.012, 0.022, n=4 if lo else seg(8, q, 5), mat='body:steel', samples=2,
                   cap='fan', e=0.35)
        for x in np.linspace(xs[0] + 0.08, xs[1] - 0.08, nf):
            p = canopy(x, s * 0.46)
            m += strut(tuple(p + [0, -0.005, 0]), tuple(p + [0, h - 0.01, 0]), 0.030, 0.012, n=4 if lo else 6,
                       mat='body:steel', samples=2, cap='fan', e=0.4)
    for x in np.linspace(xs[0] + 0.05, xs[1] - 0.05, 3 if lo else 7):
        a, b = canopy(x, -0.46) + [0, h + 0.006, 0], canopy(x, 0.46) + [0, h + 0.006, 0]
        m += strut(tuple(a), tuple(b), 0.026, 0.006, n=4 if lo else 6, mat='body:steel', samples=2, cap='fan', e=0.35)
    if not lo:
        a, b = canopy(xs[1] + 0.02, -0.44) + [0, h + 0.02, 0], canopy(xs[1] + 0.02, 0.44) + [0, h + 0.02, 0]
        m += strut(tuple(a), tuple(b), 0.012, 0.030, n=seg(8, q, 5), mat='body:steel', samples=2, cap='fan', e=0.4)
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


MIRROR_BASE = 0.760


def door_mirrors(q):
    """Big modern mirrors on the doors: a black housing on a short arm, an amber repeater strip
    on the outer edge, MirrorGlass facing the driver."""
    if q < 0.2:
        return race_mirrors(q)
    m = Mesh()
    for s in (-1, 1):
        x = MIRROR_BASE
        zb = float(gb_c(x)) + 0.030
        yb_ = float(crown(x, zb))
        base = np.array([x, yb_ + 0.015, s * zb])
        head = np.array([x - 0.040, yb_ + 0.115, s * (zb + 0.165)])
        m += strut(tuple(base), tuple(head - [0, 0.05, s * 0.07]), 0.030, 0.014, n=seg(8, q, 5), mat='body:plastic',
                   samples=3, e=0.5)
        shell = blob(head + [0.010, 0, 0], (0.040, 0.085, 0.120), n=seg(16, q, 8), rings=seg(8, q, 4), e1=0.30,
                     e2=0.35, mat='body:plastic')
        m += shell
        g = slab(rounded_rect(0.072, 0.104, 0.018, seg(4, q, 2)), 0.004, axis=0, centre=0.0, mat='mirror', steps=1)
        g.transform(t=tuple(head - [0.030, 0, 0]))
        m += g
        rep = slab(rounded_rect(0.006, 0.060, 0.003, 1), 0.012, axis=0, centre=0.0, mat='body:amber', steps=1)
        rep.transform(t=tuple(head + [0.005, -0.030, s * 0.118]))
        m += rep
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
# Wheels: satin black twelve-spoke wheels with a bead ring, mud-terrain tyres with deep shoulder
# lugs
# ---------------------------------------------------------------------------------------------

def tyre(R, W, q):
    """Mud-terrain tyre: the Kestrel's tall-sidewall carcass with big staggered tread blocks that
    wrap over the shoulders onto the sidewall (wheel frame: axis z)."""
    m = _kestrel_tyre(R, W, q)
    if q < 0.6:
        return m
    hw = W / 2
    nl = 24 if q < 0.6 else 30
    for k in range(nl):
        for side in (-1, 1):
            ph = (k + (0.5 if side > 0 else 0.0)) * TAU / nl
            wdt = TAU / nl * 0.40
            rings = []
            # stations across the block: on the tread, at the shoulder, down the sidewall
            for a, r0, h in ((0.30 * hw, R - 0.002, 0.016), (0.80 * hw, R - 0.010, 0.016), (hw + 0.004, R - 0.040, 0.012),
                             (hw + 0.006, R - 0.075, 0.006)):
                ring = []
                for (da, dh) in ((-wdt * 0.5, 0.0), (wdt * 0.5, 0.0), (wdt * 0.42, h), (-wdt * 0.42, h)):
                    p = ph + da
                    rr = r0 + dh - 0.004
                    ring.append((math.cos(p) * rr, math.sin(p) * rr, side * a))
                rings.append(ring)
            m += loft(np.array(rings), 'tyre', cap0='flat', cap1='flat').orient_outward()
    return m


def rim(W, q):
    """Satin black twelve-spoke wheel: slim concave spokes in pairs, a bolted bead ring, a
    centre cap."""
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
    zf = zo - 0.040
    m += revolve([(0.0, zf - 0.020), (0.074, zf - 0.020), (0.078, zf - 0.004), (0.070, zf + 0.012), (0.048, zf + 0.016),
                  (0.0, zf + 0.016)], seg(36, q, 10), mat='rim:paint')
    for k in range(12):
        th = k * TAU / 12 + (0.05 if k % 2 else -0.05)
        d = np.array([math.cos(th), math.sin(th), 0.0])
        sd = np.array([-math.sin(th), math.cos(th), 0.0])
        pts = [d * 0.066 + [0, 0, zf + 0.006], d * 0.140 + [0, 0, zf - 0.004], d * (R0 - 0.022) + [0, 0, zf + 0.026]]
        P = catmull(pts, seg(6, q, 3) if q >= 0.6 else 3)

        def sec(i, t):
            return ellipse(lerp(0.010, 0.0075, t), 0.011, seg(8, q, 5) if q >= 0.6 else 4, e=0.45)
        m += sweep(P, sec, 'rim:paint', up=tuple(sd), cap0='flat', cap1='flat')
    m += revolve([(R0 - 0.004, zo + 0.004), (R0 + 0.016, zo + 0.004), (R0 + 0.016, zo + 0.014), (R0 - 0.004, zo + 0.014)],
                 n, mat='rim:paint', closed_profile=True)
    if q >= 0.6:
        for k in range(16):
            th = k * TAU / 16
            m += revolve([(0.0, zo + 0.020), (0.005, zo + 0.020), (0.006, zo + 0.012), (0.0, zo + 0.012)], 6,
                         mat='rim:chrome').transform(t=(math.cos(th) * (R0 + 0.006), math.sin(th) * (R0 + 0.006), 0))
    m += revolve([(0.0, zf + 0.034), (0.034, zf + 0.032), (0.042, zf + 0.022), (0.042, zf + 0.012), (0.0, zf + 0.012)],
                 seg(20, q, 8), mat='rim:paint')
    for k in range(6):
        th = k * TAU / 6 + TAU / 16
        m += revolve([(0.0, zf + 0.026), (0.010, zf + 0.026), (0.011, zf + 0.012), (0.0, zf + 0.012)], 6,
                     mat='rim:chrome').transform(t=(math.cos(th) * 0.058, math.sin(th) * 0.058, 0))
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
# Cabin: a modern SUV's horizontal dash, a digital cluster under a hood, a centre touch screen,
# a high console with a rotary selector and a terrain dial, a chunky three-spoke wheel
# ---------------------------------------------------------------------------------------------

DASH = [(0.660, 0.866 + KDY), (0.610, 0.918 + KDY), (0.540, 0.950 + KDY), (0.470, 0.956 + KDY),
        (0.430, 0.944 + KDY), (0.412, 0.900 + KDY), (0.410, 0.700 + KDY), (0.440, 0.640 + KDY), (0.660, 0.640 + KDY)]
GAUGE_POS = [(0.884 + KDY, -0.486, 0.044), (0.884 + KDY, -0.314, 0.044), (0.884 + KDY, -0.568, 0.020),
             (0.884 + KDY, -0.232, 0.020)]
HELMET_C = np.array([-0.440, 1.505, DRIVER_Z])
GLOW_C = np.array([0.36, 0.86 + KDY, DRIVER_Z * 0.6])
WHEEL_R = 0.188
SCREEN = (0.452, 0.995 + KDY, 0.020, 0.130, 0.082)   # centre screen: x, y, z, half width, half height


def gauges(q, x=0.394):
    """The digital cluster's dials (int:gauge discs) with slim dark rings, flush in the cluster
    screen."""
    m = Mesh()
    n = seg(32, q, 10)
    for y, z, r in GAUGE_POS:
        m += revolve([(0.0, -0.0015), (r, -0.0015), (r, 0.0015), (0.0, 0.0015)], n, mat='int:gauge',
                     axis='x').transform(t=(x, y, z))
        m += revolve([(r - 0.001, -0.004), (r + 0.003, -0.004), (r + 0.003, 0.002), (r - 0.001, 0.002)], n,
                     mat='int:black', axis='x', closed_profile=True).transform(t=(x, y, z))
    return m


def _fascia(q):
    """Soft dash face with a thin metal line across it and slim air vents."""
    m = slab(rounded_rect(0.006, 0.760, 0.003, 1), 0.006, axis=0, centre=0.407, mat='int:metal', steps=1)
    m.transform(t=(0, 0.800 + KDY, 0))
    if q >= 0.2:
        for zc, hw in ((-0.720, 0.050), (-0.090, 0.060), (0.090, 0.060), (0.720, 0.050)):
            v = slab(rounded_rect(0.018, hw, 0.006, seg(2, q, 1)), 0.012, axis=0, centre=0.404, mat='int:black',
                     steps=1)
            v.transform(t=(0, 0.850 + KDY, zc))
            m += v
    return m


def console(q):
    """High centre console with an armrest, a rotary gear selector and a terrain dial."""
    m = Mesh()
    m += blob((-0.06, 0.430 + KDY, 0.0), (0.560, 0.180, 0.120), n=seg(16, q, 6), rings=seg(8, q, 4), e1=0.30,
              e2=0.30, mat='int:dash')
    m += blob((-0.30, 0.620 + KDY, 0.0), (0.180, 0.030, 0.090), n=seg(14, q, 6), rings=seg(6, q, 4), e1=0.35,
              e2=0.35, mat='int:leather')
    for x, r in ((0.10, 0.030), (0.18, 0.024)):
        m += revolve([(0.0, 0.0), (r, 0.0), (r, 0.022), (r * 0.9, 0.028), (0.0, 0.028)], seg(20, q, 8),
                     mat='int:metal', axis='y').transform(t=(x, 0.605 + KDY, 0.0))
    return m


def binnacle(q):
    """Cluster screen under a short hood, the centre touch screen standing on the dash, a row of
    switches and the passenger grab handle."""
    m = Mesh()
    zc = (GAUGE_POS[0][1] + GAUGE_POS[1][1]) / 2
    yc = GAUGE_POS[0][0]
    panel_ = slab(rounded_rect(0.064, 0.205, 0.012, seg(3, q, 2)), 0.010, axis=0, centre=0.400, mat='int:black',
                  steps=1)
    panel_.transform(t=(0, yc, zc))
    m += panel_
    ang = np.linspace(math.radians(18), math.radians(162), seg(16, q, 6))
    pts = [(0.44, yc + 0.030 + 0.050 * math.sin(a), zc + 0.215 * math.cos(a)) for a in ang]
    m += sweep(np.array(pts), lambda i, t: ellipse(0.055, 0.006, seg(8, q, 4), e=0.5), 'int:dash', up=(1, 0, 0),
               dome_depth=0.004, dome_steps=1)
    # centre touch screen in a black bezel, leaning back a little
    x, y, z, hw, hh = SCREEN
    R = rot((0, 0, 1), math.radians(-12))
    bez = slab(rounded_rect(hh + 0.010, hw + 0.010, 0.012, seg(3, q, 2)), 0.016, axis=0, centre=0.0, mat='int:black',
               steps=1)
    scr = slab(rounded_rect(hh, hw, 0.008, seg(3, q, 2)), 0.004, axis=0, centre=-0.009, mat='int:screen', steps=1)
    for part in (bez, scr):
        part.V = part.V @ R.T + np.array([x, y, z])
        m += part
    for k in range(6):
        zz = z - 0.10 + k * 0.040
        m += slab(rounded_rect(0.008, 0.014, 0.003, 1), 0.010, axis=0, centre=0.404, mat='int:metal',
                  steps=1).transform(t=(0, 0.760 + KDY, zz))
    m += tube([(0.47, 0.98 + KDY, 0.14), (0.43, 1.02 + KDY, 0.28), (0.43, 1.02 + KDY, 0.52), (0.47, 0.98 + KDY, 0.66)],
              0.012, n=seg(8, q, 5), mat='int:black', samples=seg(10, q, 4))
    return m


def door_cards(q):
    m = Mesh()
    for s in (-1, 1):
        ci = float(ci_c(0.10))
        z = s * (ci - 0.010)
        pts = [(x, float(crown(x, ci)) - 0.040, z) for x in np.linspace(-0.30, 0.72, 6)]
        m += tube(pts, 0.024, n=seg(10, q, 6), mat='int:dash', samples=seg(10, q, 4))
        m += blob((0.16, 0.640 + KDY, z - s * 0.016), (0.400, 0.170, 0.016), n=seg(14, q, 6), rings=seg(6, q, 4),
                  e1=0.25, e2=0.25, mat='int:dash')
        m += blob((0.10, 0.660 + KDY, z - s * 0.036), (0.260, 0.026, 0.030), n=seg(14, q, 6), rings=seg(6, q, 4),
                  e1=0.4, e2=0.4, mat='int:leather')
        m += strut((0.36, 0.770 + KDY, z - s * 0.022), (0.29, 0.770 + KDY, z - s * 0.028), 0.006, 0.010,
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
        m += binnacle(q)
    for z in (DRIVER_Z, -DRIVER_Z):
        m += _seat(q, z)
    m += _seat(q, 0.0, x0=-1.10, front=False).transform(s=(1, 1, 1.70))
    if q < 0.1:
        return m
    m += console(q)
    m += strut(tuple(np.array(WHEEL_CENTRE) + [0.06, -0.03, 0]), (0.45, 0.80 + KDY, DRIVER_Z), 0.026, 0.026,
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
    m += strut(tuple(np.array(WHEEL_CENTRE) + [0.06, -0.03, 0]), (0.45, 0.80 + KDY, DRIVER_Z), 0.026, 0.026,
               n=seg(12, q, 6), mat='int:black', samples=3)
    m += _cargo(q)
    m += door_cards(q)
    m += pillar_trims(q)
    m += rear_view_mirror(q)
    return m


def steering_wheel(q):
    """Chunky three-spoke wheel: a thick leather rim, wide spokes at 3, 9 and 6 o'clock carrying
    switch pads, a large flat airbag boss."""
    m = Mesh()
    n = seg(56, q, 10)
    ang = np.arange(n) / n * TAU
    path = np.stack([np.zeros(n), WHEEL_R * np.cos(ang), WHEEL_R * np.sin(ang)], -1)
    m += sweep(path, lambda i, t: ellipse(0.0150, 0.0170, seg(10, q, 4)), 'int:leather', closed=True, up=(1, 0, 0))
    if q < 0.1:
        return m + revolve([(0.0, 0.0), (0.060, 0.0), (0.060, 0.05), (0.0, 0.055)], 8, mat='int:dash', axis='x')
    for a, w in ((0.0, 0.026), (math.pi, 0.026), (-math.pi / 2, 0.020)):
        d = np.array([0.0, math.cos(a), math.sin(a)])
        side = np.array([0.0, -math.sin(a), math.cos(a)])
        pts = [d * 0.060 + [0.036, 0, 0], d * 0.120 + [0.020, 0, 0], d * (WHEEL_R - 0.008)]
        m += sweep(catmull(pts, seg(8, q, 3)), lambda i, t, w=w: ellipse(0.008, w - 0.006 * t, seg(8, q, 4), e=0.5),
                   'int:dash', up=tuple(side), dome_depth=0.004, dome_steps=1)
        if q >= 0.6 and a != -math.pi / 2:
            m += slab(rounded_rect(0.016, 0.022, 0.005, 2), 0.006, axis=0, centre=0.0, mat='int:metal',
                      steps=1).transform(t=(0.022, d[1] * 0.105, d[2] * 0.105))
    m += blob((0.040, -0.006, 0.0), (0.032, 0.068, 0.088), n=seg(18, q, 6), rings=seg(8, q, 4), e1=0.35, e2=0.40,
              mat='int:dash')
    m += slab(rounded_rect(0.010, 0.022, 0.004, 1), 0.004, axis=0, centre=0.0, mat='int:metal',
              steps=1).transform(t=(0.008, 0.010, 0.0))
    return m


def glow(group, lod, P, N, valid):
    """The Kestrel/Aurelia cabin glow, plus the centre screen lit at night."""
    r = _aurelia_glow(group, lod, P, N, valid)
    if r is None:
        return r
    gain, floor = r
    x, y, z, hw, hh = SCREEN
    d = P - np.array([x, y, z])
    scr = (np.abs(d[..., 2]) < hw + 0.004) & (np.abs(d[..., 1]) < hh + 0.010) & (np.abs(d[..., 0]) < 0.03)
    gain = np.where(scr & valid, 1.4, gain).astype(np.float32)
    # no floor on the screen: lifting its near-black map to the cabin floor turned it into a grey
    # slab in game (day and night); now only its own map (roads, tiles) glows
    floor = np.where(scr & valid, 0.0, floor).astype(np.float32)[..., None]
    return gain, floor


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
# Livery: panel gaps; the factory graphite carries black decals that stay under any player paint
# (a satin black bonnet panel, topographic contour lines over the rear doors and quarters, the
# name on the rear doors); the name in white on the grille bar and the tailgate (Body)
# ---------------------------------------------------------------------------------------------

DOORS = (0.860, -0.330, -1.230)


def _contours(x, y):
    """Smooth height field for the topographic lines (a few gentle hills)."""
    return (np.sin(x * 2.1 + 0.4) * 0.55 + np.sin(y * 5.3 - x * 1.3) * 0.35 + np.cos(x * 4.7 + y * 2.9) * 0.22
            + y * 1.4)


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
        bon = (x > 0.88) & (x < fx(2.24))
        g = np.maximum(g, lv.line(x - 0.880, W) * top * (az < 0.86))
        g = np.maximum(g, lv.line(az - 0.86, W) * top * bon)
        back = valid & (N[..., 0] < -0.5)
        g = np.maximum(g, lv.line(az - 0.80, W) * back * (y > 0.80))
        shade = 1.0 - 0.62 * np.clip(g, 0, 1)
        dark = zero.copy()
        # satin black bonnet panel between the bonnet's creases
        dark = np.maximum(dark, 0.80 * top * lv.band(x, 1.00, 2.10, 0.004) * lv.band(az, -1, 0.46, 0.004))
        # topographic contour lines over the rear doors and quarters, fading toward the front
        h = _contours(x, y)
        fr = np.abs(np.mod(h * 6.0, 1.0) - 0.5)
        lines = np.clip((0.5 - fr - 0.44) / 0.02, 0, 1)
        fade = lv.band(x, -2.16, -0.36, 0.30) * lv.band(y, 0.52, 1.14, 0.04)
        dark = np.maximum(dark, 0.70 * lines * fade * side)
        nm = lv.text_mask('RIDGEBACK')
        for s in (-1, 1):
            dark = np.maximum(dark, 0.92 * lv.stamp(P, N, valid, nm, (-0.78, 0.700, s * 0.92), (s, 0, 0), (0, 1, 0),
                                                    0.62, facing=side_n(s), min_dot=0.5, depth=0.08))
        shade = shade * (1 - np.clip(dark, 0, 0.95))
        return {'shade': shade}
    if group == 'Body':
        layers = []
        xg = _mx() - 0.040 + 0.012 + 0.017
        layers.append((lv.stamp(P, N, valid, lv.text_mask('RIDGEBACK', oblique=False), (xg + 0.002, MOUTH[0] + MOUTH[2] * 0.62, 0.0),
                                (0, 0, -1), (0, 1, 0), 0.30, facing=(1, 0, 0), min_dot=0.6, depth=0.02),
                       (0.86, 0.86, 0.85), 0.3))
        p, nrm = tail_hit(1.150, -0.560)
        layers.append((lv.stamp(P, N, valid, lv.text_mask('RIDGEBACK', oblique=False), (fx(p[0]) - 0.004, 1.150, -0.560),
                                (0, 0, 1), (0, 1, 0), 0.26, facing=(-1, 0, 0), min_dot=0.5, depth=0.03),
                       (0.86, 0.86, 0.85), 0.3))
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
    lb, ll = light_bar(q)
    body += lb
    head += ll
    body += nose_badge(q) + bumpers(q) + boot_plate(q) + tail_finisher(q) + flares(q) + spare_wheel(q)
    body += door_mirrors(q) + fuel_filler(q) + wipers(q) + roof_rack(q)
    if q >= 0.2:
        body += indicators(q) + door_handles(q) + side_steps(q) + snorkel(q) + cladding(q)
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
