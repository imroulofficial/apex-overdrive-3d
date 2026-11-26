"""Vanta (rp1-vanta): the starter all-rounder, a modern electric five-door crossover, 4.60 m.
Batch 2.

An original design with the character of the current Vanta: a clean, smooth electric crossover
hatch in pearl white, with a closed nose under a short, falling bonnet, a slim LED light bar
running the full width of the nose into two thin headlamp blades, vertical air-curtain slots and a
low black intake, a fast windscreen and a long roof with a black floating-roof finish that drops
into a raked hatch with a roof spoiler, a crisp waist crease, black lower cladding, flush door
handles, a full-width LED tail light bar, a black diffuser and two-tone aero wheels. The cockpit
is an EV's: a low, clean dash with one wide floating display, a floating console, light grey
seats and a flat-bottomed two-spoke wheel. No real manufacturer's shapes, badges or names.

It inherits the Ridgeback (Kestrel, Aurelia): subdivision-cage body, canopy glass with sliding
windows, ray hits, the modern cabin pieces, hands and cockpit machinery.

Measured from the shipped model (public/assets/models/rp1_vanta.glb at 4.60 m): front axle
x +1.382, rear -1.441 (wheelbase 2.823 m), tyre radius 0.385 / 0.386 m, half-track 0.822 m.
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from inherit import inherit  # noqa: E402

inherit('rb_ridgeback', globals())
_rb_greenhouse, _rb_trims, _rb_cabin, _rb_gauges = greenhouse, pillar_trims, cabin, gauges
_rb_binnacle, _rb_console, _rb_wheel = binnacle, console, steering_wheel

import livery as lv  # noqa: E402
from meshkit import (Curve, Mesh, blob, catmull, ellipse, lerp, loft, norm, patch_slab, revolve, rot,  # noqa: E402
                     rounded_rect, slab, smoothstep, strut, sweep, tube, window, TAU)

ID = 'rp1-vanta'
FILE = 'rp1_vanta'
LENGTH = 4.60

XF, XR = 1.382, -1.441
RF, RR = 0.385, 0.386
TF, TR = 0.822, 0.822
WF, WR = 0.245, 0.245
RIM_R = 0.2413                  # 19-inch aero wheels
NOSE, TAIL = 2.300, -2.300
DRIVER_Z = -0.390
KDY = 0.150                     # the cabin sits 15 cm higher than the Aurelia's (crossover)
EYE = (-0.260, 1.250, DRIVER_Z)
WHEEL_CENTRE = (0.110, 1.030, DRIVER_Z)
WHEEL_TILT = math.radians(26)
FACTORY_PAINT = (0.66, 0.665, 0.67)    # linear RGB: pearl white
ACCENT = (0.05, 0.30, 0.62)            # electric blue (callipers, the badge)
CALIPER = (0.05, 0.24, 0.52)
LEATHER = (0.30, 0.295, 0.285)         # light grey vegan leather
TYRE_WORDS = ['APEX OVERDRIVE', 'VANTA EV', 'APEX OVERDRIVE', 'VANTA EV']
TYRE_HW = WF / 2
TYRE_BAND = None
TYRE_BLOCKS = 0
TYRE_TEXT_R = (0.080, 0.024)
GLOVE = (0.030, 0.030, 0.033)
GLOVE_ACCENT = (0.30, 0.31, 0.33)   # black leather gloves, cool grey stitching and knuckle band
RIM_TUBE = 0.0150
HEADLINER = (0.16, 0.16, 0.16)
METAL = (0.55, 0.56, 0.58)
METAL_RM = (0.30, 0.8)
RIM_PAINT = (0.045, 0.047, 0.052)      # dark gunmetal wheel base, machined blades
STEEL = (0.03, 0.03, 0.033)
B_MAT = 'body:gloss'
TRIM_MAT = 'body:gloss'
GAUGES = [
    {'label': 'KM/H', 'max': 200, 'ticks': 10, 'needle': 0.14},
    {'label': 'kW', 'max': 160, 'ticks': 8, 'needle': 0.20},
    {'label': 'BATT', 'max': 100, 'ticks': 4, 'needle': 0.80},
    {'label': 'TEMP', 'max': 60, 'ticks': 4, 'needle': 0.40},
]

# ---------------------------------------------------------------------------------------------
# Body blueprint: a crossover's ride height and glasshouse over a smooth, low-nosed body
# ---------------------------------------------------------------------------------------------

yb_c = Curve([(2.24, 0.380), (2.14, 0.290), (1.96, 0.215), (1.70, 0.195), (1.20, 0.188), (0.00, 0.186),
              (-1.00, 0.188), (-1.70, 0.215), (-1.98, 0.250), (-2.16, 0.300), (-2.26, 0.350)])
hw_c = Curve([(2.24, 0.520), (2.18, 0.670), (2.08, 0.785), (1.96, 0.855), (1.80, 0.900), (1.60, 0.925), (1.35, 0.935),
              (1.00, 0.925), (0.40, 0.912), (-0.40, 0.914), (-1.00, 0.930), (-1.40, 0.942), (-1.75, 0.932),
              (-1.90, 0.890), (-2.04, 0.840), (-2.16, 0.760), (-2.26, 0.600)])
ymx_c = Curve([(2.24, 0.520), (1.80, 0.600), (1.00, 0.640), (0.00, 0.650), (-1.00, 0.670), (-1.80, 0.690),
               (-2.26, 0.680)])
# waist crease: low over the headlamps, rising gently along the doors, kicking up over the rear
# wheel and wrapping round the tail
ysh_c = Curve([(2.24, 0.680), (2.14, 0.770), (2.00, 0.845), (1.80, 0.893), (1.50, 0.940), (1.10, 0.982),
               (0.70, 1.000), (0.00, 1.020), (-0.60, 1.040), (-1.10, 1.070), (-1.50, 1.096), (-1.85, 1.100),
               (-2.10, 1.090), (-2.26, 1.060)])
shd_c = Curve([(2.24, 0.070), (1.60, 0.085), (0.50, 0.092), (-0.50, 0.092), (-1.60, 0.090), (-2.26, 0.070)])
# centre line: a short bonnet falling to a low nose; the hatch's ducktail behind the glass
top_c = Curve([(2.24, 0.700), (2.14, 0.790), (2.00, 0.868), (1.80, 0.920), (1.50, 0.982), (1.20, 1.040),
               (1.00, 1.076), (0.93, 1.086), (0.80, 1.160), (-1.00, 1.160), (-2.04, 1.160), (-2.08, 1.150),
               (-2.14, 1.134), (-2.20, 1.110), (-2.24, 1.086), (-2.26, 1.070)])

CABIN = (-2.04, 0.80)
TUB_FLOOR = 0.380
ci_c = Curve([(0.80, 0.740), (-2.04, 0.700)])
ZWELL = 0.620
ARCH = [(XF, RF + 0.012, RF + 0.040), (XR, RR + 0.012, RR + 0.040)]
FACE_X = 2.120
FACE_D = 0.100
MOUTH = (0.350, 0.520, 0.092)   # low black intake (centre y, half width, half height)
MOUTH_E = (0.14, 0.30)
MOUTH_DROOP = 0.0
BULGE = 0.008
BULGE_W = 0.300
ROW_Z = (0.10, 0.300, 0.460)
STATION_XS = (-2.26, -2.20, -2.13, -2.06, -1.98, -1.88, -0.80, -0.55, -0.30, -0.05, 0.20, 0.45, 0.66, 0.86, 1.90, 2.00)
TAIL_TURN = (0.060, 0.86)
ROW_IN = (0.090, 0.040, 0.012)
SIDE_CREASE = 0.70
OVERHANG = 1.95


def bulge_w(x):
    return float(window(x, 0.95, 2.10, 0.30))


def crown_e(x):
    return 2.0 - 0.3 * smoothstep(1.6, 2.2, x)


def tip_shift(x, z, y=0.0):
    z = np.abs(z)
    y = np.asarray(y, dtype=np.float64)
    rake = smoothstep(1.70, 2.24, x) * np.clip((y - 0.36) / 0.40, 0, 1) ** 1.3     # the face leans back
    tuck = smoothstep(-1.80, -2.26, x) * np.clip((y - 0.55) / 0.55, 0, 1)         # the tail leans in
    return (0.018 * smoothstep(2.00, FACE_X, x) * smoothstep(0.50, 0.74, z) - 0.120 * rake
            - 0.020 * smoothstep(-2.12, -2.26, x) * smoothstep(0.50, 0.70, z) + 0.060 * tuck)


def gb_c(x):
    return float(Curve([(0.93, 0.760), (0.80, 0.790), (0.50, 0.812), (-0.40, 0.818), (-1.20, 0.822), (-1.60, 0.806),
                        (-1.85, 0.770), (-2.02, 0.700), (-2.08, 0.660)])(x))


# ---------------------------------------------------------------------------------------------
# Greenhouse: a fast windscreen, a long roof with black pillars (floating roof), a raked hatch
# ---------------------------------------------------------------------------------------------

yr_c = Curve([(0.930, 1.092), (0.85, 1.150), (0.70, 1.250), (0.55, 1.340), (0.40, 1.418), (0.25, 1.478),
              (0.10, 1.518), (-0.05, 1.540), (-0.40, 1.556), (-0.90, 1.548), (-1.20, 1.530), (-1.45, 1.494),
              (-1.62, 1.452), (-1.78, 1.394), (-1.92, 1.322), (-2.02, 1.252), (-2.08, 1.196)])
GH_X = (-2.080, 0.930)
T_CANT = 0.55
A_TOP, A_BASE = 0.040, 0.926
B_X = -0.330
X2 = -1.180                     # rear door glass rear edge
C_TOP, C_BASE = -1.420, -1.700  # rear quarter glass's back edge, raked
RW = (-2.055, -1.600, 0.410)    # hatch glass: base x, top x, half width in t
WIN_X = -0.05
CANT_K, TUMBLE, ROOF_E, ROOF_ZE, SIDE_BOW = 0.80, 0.34, 0.80, 1.0, 0.010
MIRROR_BASE = 0.780
DOORS = (0.930, -0.340, -1.200)


def greenhouse(q):
    return _rb_greenhouse(q)


# ---------------------------------------------------------------------------------------------
# Front: a closed nose with a full-width light bar into slim headlamp blades, air-curtain slots,
# a low black intake and a slim splitter
# ---------------------------------------------------------------------------------------------

LAMP_Z, LAMP_HW, LAMP_HH, LAMP_Y = 0.560, 0.190, 0.030, 0.690


def _lamp_frame(s, y=None, z=None, hw=None):
    """Centre and frame of a lamp lying on the raked face: local z along the surface normal, x
    across the lamp, y up the face."""
    y = LAMP_Y if y is None else y
    z = LAMP_Z if z is None else z
    hw = LAMP_HW if hw is None else hw
    p0, _ = nose_hit(y, s * (z - hw * 0.7))
    p1, _ = nose_hit(y, s * (z + hw * 0.7))
    c, n_ = nose_hit(y, s * z)
    out = norm(n_)
    across = norm(p1 - p0)
    across = norm(across - out * np.dot(across, out))
    up = norm(np.cross(out, across))
    if up[1] < 0:
        up = -up
    xax = np.cross(up, out)
    R = np.stack([xax, up, out], -1)
    o = 1.0 if np.dot(xax, (0, 0, s)) > 0 else -1.0
    return c, R, o


def grille(q):
    """The low intake: a black surround, a dark back panel and slim horizontal vanes."""
    m = Mesh()
    cy, ma, mb = MOUTH
    n = seg(56, q, 12)
    ring = mouth_outline(n, 0.002, _mx() + 0.001)
    m += sweep(ring, lambda i, t: ellipse(0.006, 0.008, seg(8, q, 4)), 'body:gloss', closed=True)
    xg = _mx() - 0.036
    back = slab(rounded_rect(mb * 0.96, ma * 0.98, 0.016, seg(4, q, 2)), 0.006, axis=0, centre=xg - 0.010,
                mat='body:well', steps=1)
    back.transform(t=(0, cy, 0))
    m += back
    if q < 0.2:
        return m
    for yy in np.linspace(cy - mb * 0.45, cy + mb * 0.45, 3):
        b = slab(rounded_rect(0.006, ma * 0.97, 0.003, 1), 0.026, axis=0, centre=xg + 0.006, mat='body:plastic',
                 steps=1)
        b.transform(t=(0, yy, 0))
        m += b
    return m


def _nose_strip(y, z0, z1, n, out=0.004):
    """Points on the nose surface at height y from z0 to z1, pushed `out` along the normal."""
    pts = []
    for z in np.linspace(z0, z1, n):
        p, nn = nose_hit(y, z)
        pts.append(p + nn * out)
    return np.array(pts)


def headlamp_parts(q, s):
    """Slim LED headlamp blade: a smoked housing, a running-light strip along its top edge, a row
    of three small LED projectors, a clear cover. Returns (body, lens, glass)."""
    body, lens, glass = Mesh(), Mesh(), Mesh()
    c, R, o = _lamp_frame(s)
    hw, hh = LAMP_HW, LAMP_HH
    lo = q < 0.1
    rs = 1 if lo else seg(4, q, 2)
    # the blade tapers down toward the outer end
    outline = rounded_rect(hw + 0.008, hh + 0.008, 0.010, rs)
    body += placed(slab(outline, 0.040, axis=2, centre=-0.018, mat='body:smoke', steps=1), R, c)
    if lo:
        lens += placed(slab(rounded_rect(hw - 0.010, 0.008, 0.004, 1, cy=hh - 0.012), 0.006, axis=2, centre=0.000,
                            mat='headlight_lens', steps=1), R, c)
    else:
        sig = [(-o * (hw - 0.006), hh - 0.010), (o * (hw - 0.010), hh - 0.010), (o * (hw - 0.010), -hh + 0.010)]
        pts = [c + R @ np.array([x, y, 0.002]) for x, y in sig]
        lens += sweep(bent(pts, 0.010), lambda i, t: ellipse(0.0036, 0.0036, seg(8, q, 4)), 'headlight_lens',
                      cap0='flat', cap1='flat')
        for k in range(3):
            pc = c + R @ np.array([-o * (0.040 - k * 0.046), -0.004, -0.004])
            body += placed(revolve([(0.014, 0.000), (0.010, -0.008), (0.0, -0.010)], seg(14, q, 6),
                                   mat='body:reflector'), R, pc)
            lens += placed(revolve([(0.0, 0.001), (0.008, 0.001), (0.009, -0.003), (0.0, -0.004)], seg(12, q, 6),
                                   mat='headlight_lens'), R, pc)
    glass += placed(slab(rounded_rect(hw + 0.004, hh + 0.004, 0.010, rs), 0.004, axis=2, centre=0.008,
                         mat='glass:clear', steps=1), R, c)
    return body, lens, glass


def light_bar(q):
    """The LED bar across the nose between the headlamps: a thin black channel (body) and its lit
    strip (headlight_lens). Returns (body, lens)."""
    body, lens = Mesh(), Mesh()
    zi = LAMP_Z - LAMP_HW + 0.010
    y = LAMP_Y + LAMP_HH - 0.012
    n = seg(24, q, 6) if q >= 0.1 else 5
    P = _nose_strip(y, -zi, zi, n, 0.002)
    body += sweep(P, lambda i, t: ellipse(0.004, 0.010, seg(6, q, 4) if q >= 0.1 else 4, e=0.6), 'body:gloss',
                  cap0='flat', cap1='flat')
    P2 = _nose_strip(y, -zi, zi, n, 0.006)
    lens += sweep(P2, lambda i, t: ellipse(0.0025, 0.0032, seg(6, q, 4) if q >= 0.1 else 4), 'headlight_lens',
                  cap0='flat', cap1='flat')
    return body, lens


def indicators(q):
    """Air-curtain slots at the bumper corners (black), the amber indicators in the headlamp
    blades' lower edges."""
    m = Mesh()
    for s in (-1, 1):
        c, R, o = _lamp_frame(s, y=0.500, z=0.650, hw=0.04)
        m += placed(slab(rounded_rect(0.018, 0.105, 0.012, seg(3, q, 2)), 0.016, axis=2, centre=0.000,
                         mat='body:well', steps=1), R, c)
        c, R, o = _lamp_frame(s)
        m += placed(slab(rounded_rect(0.060, 0.004, 0.002, 1, cx=o * 0.080, cy=-LAMP_HH + 0.006), 0.006, axis=2,
                         centre=0.004, mat='body:amber', steps=1), R, c)
    return m


def nose_badge(q):
    """A small round badge in the middle of the light bar's channel."""
    if q < 0.2:
        return Mesh()
    p, nn = nose_hit(LAMP_Y - 0.030, 0.0)
    R = frame_from(nn)
    return placed(revolve([(0.0, 0.004), (0.026, 0.004), (0.030, 0.0), (0.030, -0.006), (0.0, -0.006)], seg(20, q, 8),
                          mat='body:chrome'), R, p + nn * 0.002)


def bumpers(q):
    """Black splitter lip under the nose, black rear diffuser with a red reflector line."""
    m = Mesh()
    zs = [0.0, 0.25, 0.45, 0.60, 0.70, 0.78]
    fpath = _bumper_path(nose_hit, 0.230, 1, zs, 0.004)
    fpath = [(fpath[0][0] - 0.22, fpath[0][1] * 1.06)] + fpath + [(fpath[-1][0] - 0.22, fpath[-1][1] * 1.06)]
    m += blade(fpath, 0.228, 0.020, 0.040, q, mat='body:gloss')
    rzs = [0.0, 0.25, 0.45, 0.60, 0.70, 0.78]
    rpath = _bumper_path(tail_hit, 0.360, -1, rzs, 0.006)
    rpath = [(rpath[0][0] + 0.20, rpath[0][1] * 1.04)] + rpath + [(rpath[-1][0] + 0.20, rpath[-1][1] * 1.04)]
    m += blade(rpath, 0.350, 0.070, 0.040, q, mat='body:plastic')
    if q >= 0.2:
        p, nrm = tail_hit(0.470, 0.0)
        for s in (-1, 1):
            c = np.array([p[0] - 0.006, 0.470, s * 0.66])
            m += slab(rounded_rect(0.007, 0.090, 0.003, 1), 0.010, axis=0, centre=0.0, mat='body:reflector',
                      steps=1).transform(t=tuple(c))
        # diffuser fins
        for z in (-0.30, -0.10, 0.10, 0.30):
            m += slab(rounded_rect(0.080, 0.035, 0.010, 1), 0.008, axis=2, centre=0.0, mat='body:plastic',
                      steps=1).transform(t=(p[0] + 0.07, 0.290, z))
    return m


def door_handles(q):
    """Flush handles: a slim black slot on each door."""
    m = Mesh()
    for xh in (-0.200, -1.060):
        for s in (-1, 1):
            p, nn = side_frame(xh, 1.000)
            nn = nn * [1, 1, s]
            p = p * [1, 1, s]
            R = frame_from(nn)
            m += placed(slab(rounded_rect(0.075, 0.010, 0.006, seg(2, q, 1)), 0.006, axis=2, centre=0.001,
                             mat='body:gloss', steps=1), R, p)
    return m


def door_mirrors(q):
    """Slim gloss-black mirrors on the doors: a short arm, an aero head, a repeater strip."""
    if q < 0.2:
        return race_mirrors(q, mat='body:gloss')
    m = Mesh()
    for s in (-1, 1):
        x = MIRROR_BASE
        zb = float(gb_c(x)) + 0.030
        yb_ = float(crown(x, zb))
        base = np.array([x, yb_ + 0.010, s * zb])
        head = np.array([x - 0.050, yb_ + 0.085, s * (zb + 0.150)])
        m += strut(tuple(base), tuple(head - [0, 0.040, s * 0.070]), 0.022, 0.012, n=seg(8, q, 5), mat='body:gloss',
                   samples=3, e=0.5)
        m += blob(head + [0.012, 0, 0], (0.036, 0.062, 0.105), n=seg(16, q, 8), rings=seg(8, q, 4), e1=0.32,
                  e2=0.40, mat='body:gloss')
        g = slab(rounded_rect(0.052, 0.090, 0.016, seg(4, q, 2)), 0.004, axis=0, centre=0.0, mat='mirror', steps=1)
        m += g.transform(t=tuple(head - [0.022, 0, 0]))
        m += slab(rounded_rect(0.004, 0.050, 0.002, 1), 0.010, axis=0, centre=0.0, mat='body:amber',
                  steps=1).transform(t=tuple(head + [0.012, -0.034, s * 0.070]))
    return m


def fuel_filler(q):
    """The charge-port flap on the left rear wing."""
    if q < 0.2:
        return Mesh()
    p, nrm = side_frame(-1.780, 0.930)
    p, nrm = p * [1, 1, -1], nrm * [1, 1, -1]
    R = frame_from(nrm)
    return placed(slab(rounded_rect(0.055, 0.050, 0.016, seg(3, q, 2)), 0.006, axis=2, centre=0.001, mat='paint',
                       steps=1), R, p)


def cladding(q):
    """Black lower cladding along the sills between the arches, and slim black arch lips."""
    m = Mesh()
    x0, x1 = XF - ARCH[0][2] - 0.010, XR + ARCH[1][2] + 0.010
    for s in (-1, 1):
        def fn(u, v, s=s):
            x = x1 + (x0 - x1) * u
            yb = np.vectorize(lambda t: float(yb_c(t)))(x)
            y = yb + 0.030 + 0.110 * v
            z = np.vectorize(lambda a, b: surf_z(a, b))(x, y) + 0.002
            P = np.stack([x, y, s * z], -1)
            Nn = np.zeros_like(P)
            Nn[..., 2] = s
            return P, Nn
        m += patch_slab(fn, seg(16, q, 4), 2, 0.010, mat='body:plastic')
    if q < 0.2:
        return m
    for xc, yc, ra in ARCH:
        a0, a1 = math.radians(-8), math.radians(188)
        na = seg(28, q, 8)
        for s in (-1, 1):
            pts = []
            for a in np.linspace(a0, a1, na):
                x, y = xc + (ra + 0.006) * math.cos(a), yc + (ra + 0.006) * math.sin(a)
                z = surf_z(x, max(y, float(yb_c(x)) + 0.03))
                pts.append((x, y, s * (z + 0.002)))
            m += sweep(np.array(pts), lambda i, t: ellipse(0.016, 0.006, seg(6, q, 4), e=0.6), 'body:plastic',
                       up=(0, 0, s), cap0='flat', cap1='flat')
    return m


def roof_spoiler(q):
    """A thin roof spoiler over the hatch glass, in the black of the roof."""
    def fn(u, v):
        t = (u - 0.5) * 2 * 0.50
        x0 = -1.560
        base = canopy(np.full_like(t, x0), t)
        x = x0 - 0.190 * v
        y = base[..., 1] + 0.010 - 0.018 * v ** 2
        z = base[..., 2] * (1 - 0.06 * v)
        P = np.stack([x, y, z], -1)
        Nn = np.zeros_like(P)
        Nn[..., 1] = 1
        return P, Nn
    return patch_slab(fn, seg(14, q, 4), seg(4, q, 2), 0.012, mat='body:gloss')


# ---------------------------------------------------------------------------------------------
# Rear: a full-width LED light bar across the hatch, wrapping into the corners
# ---------------------------------------------------------------------------------------------

TAIL_Y = 0.985
NAME_Y, NAME_W = 0.900, 0.34      # the name across the hatch (dark, under any paint)


def _tail_strip(y, z0, z1, n, out=0.004):
    pts = []
    for z in np.linspace(z0, z1, n):
        p, nn = tail_hit(y, z)
        pts.append(p + nn * out)
    return np.array(pts)


def tail_lamps(q):
    """A smoked band across the tail with a slim red light bar on it, thicker lamp ends at the
    corners, white reverse lamps low in the bumper. Returns (body, lens)."""
    body, lens = Mesh(), Mesh()
    lo = q < 0.1
    n = 6 if lo else seg(32, q, 10)
    zmax = 0.800
    P = _tail_strip(TAIL_Y, -zmax, zmax, n, 0.002)
    body += sweep(P, lambda i, t: ellipse(0.006, 0.026, 4 if lo else seg(6, q, 4), e=0.5), 'body:smoke',
                  cap0='flat', cap1='flat', up=(0, 1, 0))
    P2 = _tail_strip(TAIL_Y + 0.004, -zmax + 0.01, zmax - 0.01, n, 0.008)
    lens += sweep(P2, lambda i, t: ellipse(0.0040, 0.0060, 4 if lo else seg(6, q, 4)), 'taillight_lens',
                  cap0='flat', cap1='flat')
    if lo:
        return body, lens
    for s in (-1, 1):
        # the lamp ends: a wider red block where the bar turns the corner
        P3 = _tail_strip(TAIL_Y - 0.002, s * (zmax - 0.16), s * (zmax - 0.01), seg(8, q, 4), 0.008)
        lens += sweep(P3, lambda i, t: ellipse(0.003, 0.016, seg(6, q, 4), e=0.5), 'taillight_lens', cap0='flat',
                      cap1='flat', up=(0, 1, 0))
        if q >= 0.2:
            p, nn = tail_hit(0.420, s * 0.420)
            R = frame_from(nn)
            body += placed(slab(rounded_rect(0.050, 0.012, 0.004, 1), 0.006, axis=2, centre=0.004,
                                mat='body:reflector', steps=1), R, p)
    return body, lens


def tail_finisher(q):
    return Mesh()


def boot_plate(q):
    if q < 0.2:
        return Mesh()
    p, nrm = tail_hit(0.700, 0.0)
    R = frame_from(nrm)
    return placed(slab(rounded_rect(0.230, 0.058, 0.008, seg(3, q, 2)), 0.006, axis=2, centre=0.002,
                       mat='body:rubber', steps=1), R, p)


def exhaust(q):
    """No tailpipes (electric): the node carries the diffuser's centre slot, where the game's
    exhaust effects would anchor."""
    p, nrm = tail_hit(0.330, 0.0)
    return slab(rounded_rect(0.030, 0.200, 0.012, seg(3, q, 1) if q >= 0.1 else 1), 0.060, axis=0,
                centre=p[0] + 0.010, mat='body:plastic', steps=1).transform(t=(0, 0.300, 0))


# ---------------------------------------------------------------------------------------------
# Wheels: two-tone aero wheels (a dark base, ten machined curved blades, a closed aero ring),
# road tyres
# ---------------------------------------------------------------------------------------------

def tyre(R, W, q):
    return _aurelia_tyre(R, W, q)


SPOKES = 10                     # spokes (blades) on the wheel face
SPOKE_TWIST = 0.42              # how far a spoke curves round from hub to rim (rad)
SPOKE_PAIR = 0.0                # angle between the two spokes of a pair (0: evenly spread)
SPOKE_W = (0.017, 0.011)        # spoke width at the hub, at the rim
SPOKE_MAT = 'rim:wire'
AERO_RING = True


def rim(W, q):
    """Aero wheel: ten slim machined blades curving from the hub to the rim over a dark base and
    a dark aero ring near the rim, a flush centre cap."""
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
    zf = zo - 0.036
    # aero ring between the blade tips and the rim
    if AERO_RING:
        m += revolve([(R0 - 0.060, zf + 0.004), (R0 - 0.010, zf + 0.020), (R0 + 0.002, zf + 0.026),
                      (R0 + 0.002, zf + 0.018), (R0 - 0.012, zf + 0.012), (R0 - 0.060, zf - 0.004)], n,
                     mat='rim:paint', closed_profile=True)
    m += revolve([(0.0, zf - 0.016), (0.070, zf - 0.016), (0.074, zf - 0.002), (0.066, zf + 0.014), (0.0, zf + 0.016)],
                 seg(36, q, 10), mat='rim:paint')
    hi = q >= 0.6
    for k in range(SPOKES):
        if SPOKE_PAIR:
            th = (k // 2) * TAU / (SPOKES // 2) + (SPOKE_PAIR / 2 if k % 2 else -SPOKE_PAIR / 2)
        else:
            th = k * TAU / SPOKES
        pts = []
        rt = R0 - (0.040 if AERO_RING else 0.020)
        for f, r, dz in ((0.0, 0.064, 0.010), (0.4, 0.120, 0.008), (0.75, 0.170, 0.010), (1.0, rt, 0.016)):
            a = th + SPOKE_TWIST * f ** 1.3 + (SPOKE_PAIR * 0.6 * f * (1 if k % 2 else -1) if SPOKE_PAIR else 0)
            pts.append((r * math.cos(a), r * math.sin(a), zf + dz))
        P = catmull(pts, seg(8, q, 3) if hi else 3)

        def sec(i, t):
            return ellipse(lerp(SPOKE_W[0], SPOKE_W[1], t), 0.010, seg(8, q, 5) if hi else 4, e=0.40)
        m += sweep(P, sec, SPOKE_MAT, up=(0, 0, 1), cap0='flat', cap1='flat')
    m += revolve([(0.0, zf + 0.030), (0.036, zf + 0.028), (0.044, zf + 0.020), (0.044, zf + 0.012), (0.0, zf + 0.012)],
                 seg(20, q, 8), mat='rim:spoke')
    if hi:
        for k in range(5):
            th = k * TAU / 5 + TAU / 20
            m += revolve([(0.0, zf + 0.024), (0.008, zf + 0.024), (0.009, zf + 0.014), (0.0, zf + 0.014)], 6,
                         mat='rim:chrome').transform(t=(math.cos(th) * 0.054, math.sin(th) * 0.054, 0))
    return m


def rim_race(W, n):
    rw = W - 0.050
    zo, zi = rw / 2, -rw / 2
    prof = [(0.0, zo - 0.030), (RIM_R - 0.015, zo - 0.030), (RIM_R + 0.016, zo), (RIM_R + 0.016, zi),
            (RIM_R - 0.02, zi), (0.0, zi)]
    m = revolve(prof, n, mat='rim:paint')
    m += revolve([(0.0, zo - 0.032), (0.044, zo - 0.032), (0.044, zo + 0.008), (0.0, zo + 0.010)], 8,
                 mat='rim:spoke')
    return m


# ---------------------------------------------------------------------------------------------
# Cabin: a low clean dash, one wide floating display (cluster and centre screen), a floating
# console, light grey seats, a flat-bottomed two-spoke wheel
# ---------------------------------------------------------------------------------------------

DASH = [(0.700, 0.866 + KDY), (0.640, 0.906 + KDY), (0.560, 0.930 + KDY), (0.480, 0.936 + KDY),
        (0.432, 0.924 + KDY), (0.412, 0.890 + KDY), (0.410, 0.720 + KDY), (0.440, 0.660 + KDY), (0.700, 0.660 + KDY)]
DISPLAY = (0.396, 1.005 + KDY, -0.170, 0.400, 0.056)   # x, y, z centre, half width, half height
GAUGE_POS = [(1.005 + KDY, -0.470, 0.036), (1.005 + KDY, -0.320, 0.036), (1.005 + KDY, -0.560, 0.016),
             (1.005 + KDY, -0.230, 0.016)]
SCREEN = DISPLAY
HELMET_C = np.array([-0.440, 1.255, DRIVER_Z])
GLOW_C = np.array([0.36, 0.86 + KDY, DRIVER_Z * 0.6])
WHEEL_R = 0.182


def gauges(q, x=0.384):
    return _rb_gauges(q, x)



def binnacle(q):
    """One wide display floating over the dash on a slim stem (driver's cluster and centre screen
    in one glass), a thin ambient light line under it, the passenger grab recess."""
    m = Mesh()
    x, y, z, hw, hh = DISPLAY
    bez = slab(rounded_rect(hh + 0.008, hw + 0.008, 0.014, seg(3, q, 2)), 0.014, axis=0, centre=x + 0.008,
               mat='int:black', steps=1)
    bez.transform(t=(0, y, z))
    m += bez
    scr = slab(rounded_rect(hh, hw, 0.010, seg(3, q, 2)), 0.003, axis=0, centre=x, mat='int:screen', steps=1)
    scr.transform(t=(0, y, z))
    m += scr
    m += strut((x + 0.030, y - hh, z + 0.06), (x + 0.050, 0.910 + KDY, z + 0.06), 0.012, 0.016, n=seg(8, q, 5),
               mat='int:black', samples=2)
    return m


def console(q):
    """Floating centre console: a bridge from the dash to the armrest with a wireless pad on top
    and an open shelf under it."""
    m = Mesh()
    m += blob((-0.10, 0.520 + KDY, 0.0), (0.400, 0.050, 0.110), n=seg(16, q, 6), rings=seg(8, q, 4), e1=0.25,
              e2=0.30, mat='int:dash')
    m += blob((0.22, 0.600 + KDY, 0.0), (0.200, 0.160, 0.100), n=seg(14, q, 6), rings=seg(8, q, 4), e1=0.35,
              e2=0.35, mat='int:dash')
    m += blob((-0.36, 0.590 + KDY, 0.0), (0.170, 0.034, 0.095), n=seg(14, q, 6), rings=seg(6, q, 4), e1=0.35,
              e2=0.35, mat='int:leather')
    m += blob((-0.32, 0.300 + KDY, 0.0), (0.200, 0.160, 0.090), n=seg(12, q, 6), rings=seg(6, q, 4), e1=0.35,
              e2=0.35, mat='int:dash')
    if q >= 0.2:
        m += slab(rounded_rect(0.060, 0.050, 0.010, 2), 0.004, axis=1, centre=0.572 + KDY, mat='int:black',
                  steps=1).transform(t=(0.02, 0, 0))
    return m


def steering_wheel(q):
    """Flat-bottomed two-spoke wheel: a leather rim flattened at the bottom, two wide spokes at 3
    and 9 o'clock with touch pads, a compact boss."""
    m = Mesh()
    n = seg(56, q, 10)
    ang = np.arange(n) / n * TAU
    rr = WHEEL_R * (1 - 0.10 * np.clip(-np.sin(ang), 0, 1) ** 6)
    path = np.stack([np.zeros(n), rr * np.sin(ang), rr * np.cos(ang)], -1)
    path[:, 1] = rr * np.sin(ang)
    path[:, 2] = rr * np.cos(ang)
    m += sweep(path, lambda i, t: ellipse(0.0135, 0.0150, seg(10, q, 4)), 'int:leather', closed=True, up=(1, 0, 0))
    if q < 0.1:
        return m + revolve([(0.0, 0.0), (0.055, 0.0), (0.055, 0.045), (0.0, 0.05)], 8, mat='int:dash', axis='x')
    for a in (0.0, math.pi):
        d = np.array([0.0, 0.0, math.cos(a)])
        pts = [d * 0.050 + [0.034, -0.012, 0], d * 0.110 + [0.018, -0.016, 0], d * (WHEEL_R - 0.008) + [0, -0.004, 0]]
        m += sweep(catmull(pts, seg(8, q, 3)), lambda i, t: ellipse(0.008, 0.030 - 0.010 * t, seg(8, q, 4), e=0.5),
                   'int:dash', up=(0, 1, 0), dome_depth=0.004, dome_steps=1)
        if q >= 0.6:
            m += slab(rounded_rect(0.018, 0.026, 0.006, 2), 0.005, axis=0, centre=0.0, mat='int:black',
                      steps=1).transform(t=(0.020, -0.014, d[2] * 0.105))
    m += blob((0.040, -0.010, 0.0), (0.030, 0.060, 0.074), n=seg(18, q, 6), rings=seg(8, q, 4), e1=0.40, e2=0.45,
              mat='int:dash')
    m += revolve([(0.0, 0.0), (0.014, 0.0), (0.014, 0.003), (0.0, 0.004)], seg(16, q, 6), mat='body:accent',
                 axis='x').transform(t=(0.010, -0.008, 0.0))
    return m


# ---------------------------------------------------------------------------------------------
# Livery: panel gaps; a black floating roof and pillars over the pearl white; a pixel fade on the
# rear doors (dark dots that thin out toward the front); the name on the hatch (Body)
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
        sill = yb + 0.150
        belt = np.vectorize(lambda v: float(crown(v, gb_c(np.clip(v, GH_X[0], GH_X[1])))))(x)
        for xd in DOORS:
            g = np.maximum(g, lv.line(x - xd, W) * side * (y > sill - 0.005) * (y < belt + 0.01))
        in_door = (x < DOORS[0] + 0.004) & (x > DOORS[2] - 0.004)
        g = np.maximum(g, lv.line(y - sill, W) * side * in_door * (az > 0.7))
        bon = (x > 0.98) & (x < fx(2.18))
        g = np.maximum(g, lv.line(x - 0.985, W) * top * (az < 0.80))
        g = np.maximum(g, lv.line(az - 0.80, W) * top * bon)
        back = valid & (N[..., 0] < -0.4)
        g = np.maximum(g, lv.line(y - 0.900, W) * back * (az < 0.78))
        shade = 1.0 - 0.62 * np.clip(g, 0, 1)
        dark = zero.copy()
        # floating roof: everything on the canopy above the cant rail, and the roof spoiler
        yr = np.vectorize(lambda v: float(yr_c(np.clip(v, GH_X[0], GH_X[1]))))(x)
        roof = (x > GH_X[0] - 0.02) & (x < A_TOP + 0.02) & (y > yr - 0.130)
        dark = np.maximum(dark, 0.95 * roof * valid * lv.band(x, GH_X[0] - 0.3, A_TOP + 0.01, 0.01))
        # pixel fade on the rear doors and quarter: dots that grow toward the back and the sill
        u = np.clip((-0.40 - x) / 1.30, 0, 1) * np.clip((0.86 - y) / 0.40, 0, 1)
        cell = 0.028
        fxx = np.mod(x / cell, 1.0) - 0.5
        fyy = np.mod(y / cell + 0.5 * (np.floor(x / cell) % 2), 1.0) - 0.5
        rad = 0.46 * np.sqrt(u)
        dots = np.clip((rad - np.sqrt(fxx ** 2 + fyy ** 2)) / 0.06, 0, 1) * (u > 0.02)
        dark = np.maximum(dark, 0.85 * dots * side * (y > sill + 0.01))
        p, nrm = tail_hit(NAME_Y, 0.0)
        dark = np.maximum(dark, 0.90 * lv.stamp(P, N, valid, lv.text_mask('VANTA', oblique=False),
                                                (fx(p[0]), NAME_Y, 0.0), (0, 0, 1), (0, 1, 0), NAME_W,
                                                facing=(-1, 0, 0), min_dot=0.3, depth=0.10))
        shade = shade * (1 - np.clip(dark, 0, 0.95))
        return {'shade': shade}
    if group == 'Body':
        return {'layers': []}
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
    tb, tl = tail_lamps(q)
    body += tb
    tail += tl
    lb, ll = light_bar(q)
    body += lb
    head += ll
    body += nose_badge(q) + bumpers(q) + boot_plate(q) + roof_spoiler(q)
    body += door_mirrors(q) + fuel_filler(q) + wipers(q) + cladding(q)
    if q >= 0.2:
        body += indicators(q) + door_handles(q)
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
    'gt_lights': ((3.30, 1.10, 1.45), (2.20, 0.78, 0.55), 45),
    'gt_grille': ((3.80, 0.85, 0.55), (2.25, 0.62, 0.0), 48),
    'gt_wheel': ((2.40, 0.60, 2.00), (1.38, 0.39, 0.92), 62),
    'gt_tail': ((-3.50, 1.30, 1.55), (-2.20, 0.95, 0.40), 45),
    'gt_interior': ((0.05, 1.70, 2.30), (-0.40, 1.10, 0.0), 40),
    'gt_window': ((0.60, 1.45, 3.20), (0.15, 1.20, 0.0), 38),
}

META = make_meta()
