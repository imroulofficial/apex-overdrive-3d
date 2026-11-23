"""Aurelia GT (ag-aurelia): the classic grand-touring coupe, 4.60 m. Pilot 2, the first closed car.

An original design in the spirit of the current Aurelia: a silver long-bonnet fastback with a
rounded nose and a wide oval grille mouth, faired round headlamps on the front wings, a small
side vent behind each front wheel, chrome blade bumpers with overriders, a slim greenhouse with
chrome window frames and a sloping fastback, horizontal oval tail lamps and wire wheels. No real
manufacturer's shapes, badges or names: the only lettering is the car's and the game's own.

Measured from the shipped model (public/assets/models/ag_aurelia.glb at 4.60 m) so physics and
stats stay the same: wheelbase 2.495 m (front axle x +1.403, rear -1.092, body centred on its
bounding box), tyre radius 0.372 / 0.378 m, half-track 0.770 m, overall 4.60 x 1.83 x 1.39 m.

Closed-car parts the formula car did not have:
    glass               windscreen, rear window, quarter windows, lamp covers (Glass, ClearGlass)
    window_L, window_R  door glass, one node each, slides down into the door (META['windows'])
    interior            seats, dash, console, steering column, headliner (Interior atlas; hidden
                        in the cockpit view, where the car's own _cockpit.glb takes over)
The cockpit file has the detailed cabin (dash with round gauges, wood-rim wheel with gloved
hands, door cards, pillars, headliner, rear-view mirror) and its own clear window glass.

Material keys -> glTF materials (build_car.py group_of):
    'paint'           CarPaint   (livery map: AO, panel gaps; any player paint stays clean)
    'body:<finish>'   Body       chrome, rubber, wheel wells, reflectors, badges, lamps' bezels
    'int:<finish>'    Interior   leather, pleats, carpet, dash, wood, headliner, metal
    'int:gauge'       Gauges     dial faces on a generated dial atlas
    'glass'           Glass      tinted car glass;  'glass:clear' ClearGlass (lamp covers, cabin)
    'mirror'          MirrorGlass (live rear view in the game)
"""

import math

import numpy as np

import livery as lv
from meshkit import (Curve, Mesh, blob, catmull, chaikin, dome_rings, ellipse, lerp, loft, norm, patch_slab,
                     recess_rings, revolve, rot, rounded_rect, slab, smoothstep, spow, strut, sweep, tube, window,
                     TAU)

ID = 'ag-aurelia'
FILE = 'ag_aurelia'
LENGTH = 4.60

XF, XR = 1.403, -1.092          # axles
RF, RR = 0.372, 0.378           # tyre radii
TF, TR = 0.770, 0.770           # half-tracks (wheel centre z)
WF, WR = 0.205, 0.215           # tyre widths
RIM_R = 0.1905                  # 15-inch bead seat (wire wheels)
NOSE, TAIL = 2.300, -2.300
DRIVER_Z = -0.370               # left-hand drive
# Driver's eye: seated low behind the wheel, the bonnet's crown and both wings in view under the
# windscreen, the roof header near the top of the frame.
EYE = (-0.250, 1.100, DRIVER_Z)
WHEEL_CENTRE = (0.120, 0.905, DRIVER_Z)
WHEEL_TILT = math.radians(28)
FACTORY_PAINT = (0.34, 0.355, 0.38)   # linear RGB: silver
LEATHER = (0.28, 0.075, 0.045)        # oxblood
GLASS = ((0.045, 0.06, 0.065, 0.42), 0.03, 0.0, None)   # tinted, the cabin shows through
TYRE_WORDS = ['APEX OVERDRIVE', 'AURELIA GT', 'APEX OVERDRIVE', 'AURELIA GT']
TYRE_HW = WF / 2
TYRE_BAND = None
TYRE_TEXT_R = (0.070, 0.024)
LIVERY_GROUPS = ('Body',)
GLOVE = (0.050, 0.042, 0.036)          # black-brown leather driving gloves
HEADLINER = (0.055, 0.055, 0.058)      # charcoal headliner: neutral under any sky / ground light
METAL = (0.70, 0.70, 0.71)             # brushed aluminium spokes and trims
METAL_RM = (0.34, 0.55)                # half-metal satin: a neutral grey, not a mirror of the verges
# cockpit windows: clear, a faint neutral-grey tint (a dark albedo, so no sky / ground colour washes over
# the view through them)
CLEAR_GLASS = ((0.06, 0.065, 0.07, 0.09), 0.03, 0.0, None)
CALIPER = (0.10, 0.10, 0.105)          # classic: dark grey iron callipers
TEX = {
    'showroom': {'Interior': 1024},
    'drive': {'Interior': 512},
    'cockpit': {'Cockpit': 2048},
}
ORM = {'showroom': {'Interior'}, 'drive': {'Body', 'Rim'}}
GAUGES = [
    {'label': 'KM/H', 'max': 280, 'ticks': 7, 'needle': 0.10},
    {'label': 'RPM x1000', 'max': 8, 'ticks': 8, 'needle': 0.12},
    {'label': 'OIL', 'max': 100, 'ticks': 4, 'needle': 0.55},
    {'label': 'WATER', 'max': 120, 'ticks': 4, 'needle': 0.45},
]


def seg(n, q, lo=3):
    if q < 0.1:
        lo = max(3, int(lo * 0.65))
    v = max(lo, int(round(n * q)))
    return v + (v % 2) if v >= 4 else v


def cnt(n, q, lo=1):
    return max(lo, int(round(n * q)))


def seg4(n, q, lo=16):
    return max(lo, int(round(n * q / 4)) * 4)


def even(n):
    return n + (n % 2)


def turned(m, R=None, t=(0, 0, 0)):
    return m.transform(R=R, t=t)


# ---------------------------------------------------------------------------------------------
# Body shape: curves along x (metres, game frame)
# ---------------------------------------------------------------------------------------------

yb_c = Curve([(2.26, 0.275), (2.10, 0.225), (1.90, 0.195), (1.60, 0.172), (1.20, 0.156), (0.80, 0.146), (0.00, 0.140),
              (-0.80, 0.145), (-1.50, 0.168), (-1.90, 0.215), (-2.10, 0.252), (-2.26, 0.305)])
# plan view: full front wings to a blunt rounded nose, a slight waist at the doors, the rear
# haunch over the rear wheels, then a tail that tapers in plan
hw_c = Curve([(2.26, 0.700), (2.20, 0.778), (2.12, 0.832), (2.00, 0.869), (1.85, 0.890), (1.65, 0.901),
              (1.40, 0.905), (1.15, 0.901), (0.90, 0.894), (0.50, 0.887), (0.10, 0.887), (-0.40, 0.893),
              (-0.80, 0.907), (-1.10, 0.920), (-1.40, 0.917), (-1.65, 0.900), (-1.90, 0.860), (-2.10, 0.792),
              (-2.20, 0.728), (-2.26, 0.665)])
ymx_c = Curve([(2.26, 0.52), (1.80, 0.57), (1.00, 0.58), (0.00, 0.57), (-1.00, 0.60), (-1.80, 0.60), (-2.26, 0.56)])
# shoulder crease: the car's main character line, from the wing tops beside the lamps, falling
# gently along the doors' top and rising into the rear haunch
ysh_c = Curve([(2.26, 0.672), (2.18, 0.718), (2.05, 0.762), (1.85, 0.795), (1.60, 0.818), (1.30, 0.840),
               (1.00, 0.852), (0.60, 0.866), (0.00, 0.885), (-0.50, 0.905), (-0.90, 0.934), (-1.15, 0.950),
               (-1.40, 0.942), (-1.66, 0.908), (-1.90, 0.858), (-2.10, 0.806), (-2.20, 0.772), (-2.26, 0.742)])
shd_c = Curve([(2.26, 0.085), (2.0, 0.072), (1.6, 0.068), (1.0, 0.075), (0.3, 0.082), (-0.5, 0.074), (-1.1, 0.050),
               (-1.6, 0.054), (-2.0, 0.066), (-2.26, 0.085)])   # how far the crease sits inboard of the widest point
# centre-line top: bonnet (below the wing tops at the nose, a power bulge on top, see crown),
# cabin sill height, the fastback's deck and a boot lid ending in a small lip
top_c = Curve([(2.26, 0.572), (2.20, 0.620), (2.10, 0.680), (1.95, 0.745), (1.75, 0.812), (1.50, 0.862),
               (1.20, 0.903), (0.90, 0.930), (0.66, 0.952), (0.40, 1.000), (-0.60, 1.000), (-1.30, 1.000),
               (-1.66, 1.002), (-1.80, 0.960), (-1.95, 0.908), (-2.10, 0.850), (-2.19, 0.818), (-2.235, 0.808),
               (-2.26, 0.778)])

CABIN = (-1.42, 0.64)           # the open tub under the greenhouse (x range)
TUB_FLOOR = 0.235
ci_c = Curve([(0.70, 0.725), (-0.40, 0.725), (-0.62, 0.560), (-1.45, 0.540)])   # tub inner wall
ZWELL = 0.600                   # wheel-well inner wall
ARCH = [(XF, RF + 0.016, RF + 0.054), (XR, RR + 0.016, RR + 0.054)]   # (x, y centre, radius)
FACE_X = NOSE - 0.075           # the last body section; the face panel rolls forward from it to the mouth
MOUTH = (0.425, 0.490, 0.132)   # grille mouth centre y, half width, half height
MOUTH_E = (0.42, 0.80)          # mouth superellipse exponents (z, y): a wide, softly squared oval
BULGE = 0.022                   # bonnet power bulge height


def crown(x, z):
    """Body top surface height at (x, z) (inboard of the shoulder crease)."""
    hs = hw_c(x) - shd_c(x)
    ys, yt = ysh_c(x), top_c(x)
    u = np.clip(np.abs(z) / hs, 0, 1)
    bulge = BULGE * np.exp(-(np.asarray(z) / 0.21) ** 2) * window(x, 0.80, 2.02, 0.22)
    e = 2.4 - 0.7 * smoothstep(-1.70, -2.20, x)      # the boot lid rounds off toward the tail
    return ys + (yt - ys) * (1 - u ** e) + bulge


def arch_y(x):
    """Height of the wheel-arch edge at x (None outside both arches), and the remap weight."""
    for xc, yc, ra in ARCH:
        d = abs(x - xc)
        if d < ra:
            return yc + math.sqrt(ra * ra - d * d), float(smoothstep(ra, ra - 0.018, d))
    return None, 0.0


def tub_depth(x):
    return float(window(x, CABIN[0] + 0.03, CABIN[1] - 0.03, 0.05))


def gb_c(x):
    """Greenhouse half width at the belt (the side glass foot)."""
    return float(Curve([(0.70, 0.688), (0.55, 0.752), (0.30, 0.776), (-0.40, 0.780), (-0.90, 0.766), (-1.20, 0.722),
                        (-1.45, 0.640), (-1.66, 0.540)])(x))


def half_section(x):
    """Dense right half of the section: bottom centre -> underside -> rocker -> side -> shoulder
    crease -> crown -> top centre, as (z, y) points with anchor indices."""
    yb, hw, ymx, ys, yt = (float(c(x)) for c in (yb_c, hw_c, ymx_c, ysh_c, top_c))
    hs = hw - float(shd_c(x))
    yr = yb + 0.055
    hr = hw - 0.068
    pts = []
    # underside, centre -> rocker corner (rounded)
    for z in np.linspace(0, hr - 0.06, 60):
        pts.append((z, yb))
    for a in np.linspace(-math.pi / 2, 0, 16)[1:]:
        pts.append((hr - 0.06 + 0.06 * math.cos(a), yr - 0.055 + 0.055 * (1 + math.sin(a))))
    # lower side: rocker -> widest point
    for t in np.linspace(0, 1, 40)[1:]:
        y = lerp(yr, ymx, t)
        pts.append((hw - (hw - hr) * (1 - t) ** 2.0, y))
    # upper side: widest point -> shoulder crease
    for t in np.linspace(0, 1, 40)[1:]:
        y = lerp(ymx, ys, t)
        pts.append((hw - (hw - hs) * t ** 1.45, y))
    # crown: crease -> centre
    for z in np.linspace(hs, 0, 120)[1:]:
        pts.append((z, float(crown(x, z))))
    return np.array(pts)


def arclen(P):
    return np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])


def at_param(P, s_acc, s):
    return np.stack([np.interp(s, s_acc, P[:, 0]), np.interp(s, s_acc, P[:, 1])], -1)


def body_ring(x, counts):
    """Right half then mirrored left half of the body section at x, fixed point counts per band
    so every livery and arch line is an exact vertex row. Returns (ring (N, 3), band_of_point)."""
    nU1, nU2, nS1, nS2, nT1a, nT1b, nT2 = counts
    P = half_section(x)
    s = arclen(P)
    yb, hw, ys = float(yb_c(x)), float(hw_c(x)), float(ysh_c(x))
    hs = hw - float(shd_c(x))
    ya, w = arch_y(x)
    yr = yb + 0.055
    y_anchor = min(ya, ys - 0.05) if ya is not None else yr + 0.05
    ci = float(ci_c(np.clip(x, -1.45, 0.70)))
    gb = min(gb_c(np.clip(x, -1.66, 0.70)), hs - 0.012)
    # anchors by arc length
    zs, ysx = P[:, 0], P[:, 1]
    k_side0 = 75                                   # first side point (end of the underside corner)
    sW = np.interp(ZWELL, zs[:60], s[:60])
    sR = s[k_side0]
    side_y, side_s = ysx[k_side0:153], s[k_side0:153]
    sA = np.interp(y_anchor, side_y, side_s)
    sC = s[152]
    crown_z, crown_s = zs[152:][::-1], s[152:][::-1]
    sG = np.interp(gb, crown_z, crown_s)
    sI = np.interp(min(ci + 0.035, gb - 0.02), crown_z, crown_s)
    sE = s[-1]
    # T2: half the points packed into the first 7 cm (the tub's inner wall)
    sI2 = np.interp(max(ci - 0.035, 0.05), crown_z, crown_s)
    nw = nT2 // 2
    t2 = np.concatenate([np.linspace(sI, sI2, nw + 1)[:-1], np.linspace(sI2, sE, nT2 - nw + 1)])
    tt = np.concatenate([np.linspace(0, sW, nU1 + 1)[:-1], np.linspace(sW, sR, nU2 + 1)[:-1],
                         np.linspace(sR, sA, nS1 + 1)[:-1], np.linspace(sA, sC, nS2 + 1)[:-1],
                         np.linspace(sC, sG, nT1a + 1)[:-1], np.linspace(sG, sI, nT1b + 1)[:-1], t2])
    band = np.concatenate([np.full(nU1, 0), np.full(nU2, 1), np.full(nS1, 2), np.full(nS2, 3), np.full(nT1a, 4),
                           np.full(nT1b, 5), np.full(nT2 + 1, 6)])
    half = at_param(P, s, tt)
    # wheel arch: the underside outboard of the well wall and the side below the arch line fold
    # into the well (fixed topology: the same points, moved)
    if w > 0:
        i0, i1 = nU1, nU1 + nU2 + nS1          # points from the well wall to the arch line
        edge = half[i1]
        well = np.array([(ZWELL, yb), (ZWELL, max(y_anchor - 0.03, yb + 0.02)), (edge[0] - 0.012, y_anchor - 0.004),
                         tuple(edge)])
        ws = arclen(well)
        f = np.linspace(0, 1, i1 - i0 + 1)[:-1]
        target = at_param(well, ws, f * ws[-1])
        half[i0:i1] = half[i0:i1] * (1 - w) + target * w
    # cabin tub: the crown inboard of the inner wall drops to the floor
    D = tub_depth(x)
    if D > 1e-4:
        hz, hy = half[:, 0], half[:, 1]
        m = smoothstep(ci + 0.030, ci - 0.020, hz) * (band >= 5)
        half[:, 1] = hy - D * m * np.maximum(hy - TUB_FLOOR, 0)
    full = np.vstack([half, half[-2:0:-1] * [-1, 1]])
    bands = np.concatenate([band, band[-2:0:-1]])
    return np.stack([np.full(len(full), x), full[:, 1], full[:, 0]], -1), bands


def body_stations(q):
    """x stations tail -> nose: even spacing, plus exact stations at the arch edges, the tub ends
    and the panel-gap lines so those edges are crisp vertex rows."""
    n = seg(150, q, 18) if q >= 0.1 else 8
    xs = list(np.linspace(TAIL + 0.04, FACE_X, n))
    if q >= 0.2:
        for xc, yc, ra in ARCH:
            for d in (-ra, -ra + 0.006, -ra + 0.018, -ra + 0.04, ra - 0.04, ra - 0.018, ra - 0.006, ra):
                xs.append(xc + d)
        xs += [CABIN[0], CABIN[0] + 0.06, CABIN[1] - 0.06, CABIN[1]]
        xs += list(np.linspace(2.05, FACE_X, seg(10, q, 4)))
    else:
        # coarse LOD: exact stations at the arch edges (and the axle) instead of the even ones
        # that fall inside an arch, so no face straddles the arch line (no dark wedges)
        xs = [x for x in xs if all(abs(x - xc) > ra + 0.05 for xc, yc, ra in ARCH)]
        for xc, yc, ra in ARCH:
            xs += [xc - ra, xc - ra * 0.62, xc, xc + ra * 0.62, xc + ra]
    xs = np.unique(np.round(np.array(xs), 4))
    keep = [xs[0]]
    for v in xs[1:]:
        if v - keep[-1] > 0.004:
            keep.append(v)
    return np.array(keep)


def mouth_pts(ang, grow=0.0):
    """Grille mouth outline (z, y) at angles about its centre."""
    cy, ma, mb = MOUTH
    return np.stack([(ma + grow) * spow(np.cos(ang), MOUTH_E[0]), cy + (mb + grow) * spow(np.sin(ang), MOUTH_E[1])], -1)


FACE_D = 0.060                  # how far the face's centre stands ahead of the last section


def face_rings(front, k):
    """Rings from the last body section (x = FACE_X) to the mouth outline: each point slides
    toward the mouth point at the same angle about the mouth centre while the face bows forward."""
    cy = MOUTH[0]
    zy = front[:, [2, 1]]
    ang = np.arctan2(zy[:, 1] - cy, zy[:, 0])
    tgt = mouth_pts(ang)
    out = []
    for i in range(1, k + 1):
        f = i / k
        g = f ** 0.85
        p = zy * (1 - g) + tgt * g
        xx = FACE_X + FACE_D * (1 - (1 - f) ** 2.2)
        out.append(np.stack([np.full(len(p), xx), p[:, 1], p[:, 0]], -1))
    return out


def body_shell(q):
    H = even(seg(64, q, 12)) // 2 * 2
    nU1 = cnt(8, q, 2)
    nU2 = cnt(4, q, 1)
    nS1 = cnt(7, q, 2)
    nS2 = cnt(9, q, 3)
    nT1a = cnt(4, q, 1)
    nT1b = cnt(2, q, 1)
    nT2 = max(4, H - (nU1 + nU2 + nS1 + nS2 + nT1a + nT1b))
    counts = (nU1, nU2, nS1, nS2, nT1a, nT1b, nT2)
    xs = body_stations(q)
    rings, bands = [], None
    for x in xs:
        r, bands = body_ring(x, counts)
        rings.append(r)
    # nose: the face panel rolls forward and inward from the last section to the grille mouth,
    # then a rounded lip turns into a shallow duct behind the grille
    face = face_rings(rings[-1], seg(7, q, 2))
    c = np.array([face[-1][:, 0].mean(), MOUTH[0], 0.0])
    rr, pole = recess_rings(face[-1], c, (1, 0, 0), lip=0.95, depth=0.15, steps=seg(3, q, 2), lip_round=0.010)
    rr = face + rr
    nlip = len(face) + seg(3, q, 2)
    tail_rr, tail_pole = dome_rings(rings[0], rings[0].mean(0), (-1, 0, 0), 0.06, steps=seg(5, q, 2), power=0.8)
    allr = tail_rr[::-1] + rings + rr
    R = np.array(allr)
    nt = len(tail_rr)
    ns = len(rings)
    N = R.shape[1]

    def mat(i, j):
        if i >= nt + ns - 1 + nlip:
            return 'body:inlet'
        if i >= nt + ns - 1:
            return 'paint'
        a, b2 = R[i, j], R[min(i + 1, len(R) - 1), (j + 1) % N]
        p = (a + b2) / 2
        x = p[0]
        if i < nt:
            # tail panel (the dome that closes the body): paint down to the valance
            return 'body:well' if p[1] < float(yb_c(x)) + 0.025 else 'paint'
        bd = bands[j]
        if bd == 0:
            return 'body:well'
        ya, w = arch_y(x)
        if bd in (1, 2) and w > 0.5:
            return 'body:well'
        if w > 0.5 and p[1] < ya - 0.012 and ZWELL - 0.02 < abs(p[2]) < float(hw_c(x)) - 0.035:
            return 'body:well'      # inner walls of the wheel arch
        for xc, yc, ra in ARCH:     # and the fold into the well just ahead of / behind it
            if q >= 0.2 and abs(x - xc) < ra + 0.07 and p[1] < yc + 0.05:   # (coarse faces: no)
                i2 = min(i + 1, len(R) - 1)
                nn = np.cross(R[i2, j] - R[i, j], R[i, (j + 1) % N] - R[i, j])
                nx = abs(nn[0]) / (np.linalg.norm(nn) + 1e-12)
                if abs(p[2]) < ZWELL + 0.10 and nx > 0.3:
                    return 'body:well'
        if tub_depth(x) > 0.5 and bd >= 5:
            # inside the tub: door cards on the walls, carpet on the floor, trim on the sill
            if p[1] < TUB_FLOOR + 0.03:
                return 'int:carpet'
            if bd == 5 or (p[1] > crown(x, abs(p[2])) - 0.02):
                return 'int:dash'
            return 'int:leather'
        if tub_depth(x) > 0.5 and bd == 4 and abs(p[2]) < gb_c(x) - 0.004:
            return 'int:dash'
        return 'paint'

    return loft(R, 'paint', cap0=tail_pole, cap1=pole, mats=mat, cap_mat=('paint', 'body:inlet'))


# ---------------------------------------------------------------------------------------------
# Greenhouse: one canopy surface S(x, t) across the car (t = 0 roof centre, 0.55 the cant rail,
# 1 the belt, > 1 below the belt inside the door); roof, pillars, sails and glass are panels on it
# ---------------------------------------------------------------------------------------------

yr_c = Curve([(0.668, 0.966), (0.6, 1.025), (0.5, 1.098), (0.4, 1.163), (0.3, 1.222), (0.2, 1.27), (0.1, 1.305),
              (0.0, 1.328), (-0.1, 1.341), (-0.2, 1.345), (-0.382, 1.3324), (-0.565, 1.3069), (-0.748, 1.2721),
              (-0.93, 1.2295), (-1.112, 1.18), (-1.295, 1.1241), (-1.477, 1.0623), (-1.66, 0.995)])
GH_X = (-1.66, 0.668)           # canopy extent
T_CANT = 0.55
A_TOP, A_BASE = 0.125, 0.665    # A-pillar from the header corner down to the scuttle
B_X = -0.385                    # B-pillar (door glass rear edge)
C_TOP, C_BASE = -0.820, -1.130  # C line (quarter glass rear edge) from the cant down to the belt
RW = (-1.600, -0.900, 0.410)    # rear window: base x, top x, half width in t


def canopy(x, t):
    """Canopy point(s) at x, t (arrays broadcast); right side for t >= 0, left for t < 0."""
    x = np.asarray(x, dtype=np.float64)
    t = np.asarray(t, dtype=np.float64)
    gb = np.vectorize(gb_c)(np.clip(x, GH_X[0], GH_X[1]))
    yB = crown(x, gb)
    yr = yr_c(x)
    yk = yB + 0.78 * (yr - yB)
    gk = gb - 0.52 * (yk - yB)
    at = np.abs(t)
    th = np.clip(at / T_CANT, 0, 1) * math.pi / 2
    roof_z = gk * np.sin(th)
    roof_y = yk + (yr - yk) * np.cos(th) ** 0.55
    sv = (at - T_CANT) / (1 - T_CANT)            # 0 at the cant, 1 at the belt, > 1 below it
    side_z = gk + (gb - gk) * sv + 0.012 * np.sin(np.clip(sv, 0, 1) * math.pi)
    side_y = yk + (yB - yk) * sv
    z = np.where(at <= T_CANT, roof_z, side_z) * np.sign(t + 1e-12)
    y = np.where(at <= T_CANT, roof_y, side_y)
    return np.stack([x, y, z], -1)


def canopy_normal(x, t):
    e = 1e-3
    dx = canopy(x + e, t) - canopy(x - e, t)
    dt = canopy(x, t + e) - canopy(x, t - e)
    n = norm(np.cross(dx, dt))
    # outward: up on the roof, out on the sides
    out = canopy(x, t) - np.stack([x, np.full_like(np.asarray(x, float), 0.9), np.zeros_like(np.asarray(x, float))], -1)
    flip = np.sum(n * out, -1, keepdims=True) < 0
    return np.where(flip, -n, n)


def t_apillar(x):
    """t of the A-pillar centre line at x (windscreen side edge)."""
    u = np.clip((x - A_TOP) / (A_BASE - A_TOP), 0, 1)
    return T_CANT + (1.0 - T_CANT) * u ** 1.15


def t_cline(x):
    u = np.clip((x - C_TOP) / (C_BASE - C_TOP), 0, 1)
    return T_CANT + (1.0 - T_CANT) * u


def panel(xr, tr, nu, nv, thick, mat, inset=0.0, side=1, side_mat=None):
    """Plate on the canopy over x in xr(v) and t in tr(u, x): xr / tr are (lo, hi) pairs or
    functions; the plate goes `thick` inward from the canopy (offset `inset` inward first)."""
    def fn(u, v):
        x0, x1 = xr(v) if callable(xr) else xr
        x = lerp(x0, x1, u)
        t0, t1 = tr(x) if callable(tr) else tr
        t = lerp(t0, t1, v) * side
        P = canopy(x, t)
        Nn = canopy_normal(x, t)
        return P - Nn * inset, -Nn
    return patch_slab(fn, nu, nv, thick, mat=mat, side_mat=side_mat or mat)


def greenhouse(q):
    """Painted roof, pillars and sails, chrome B-pillars (body)."""
    m = Mesh()
    nu, nv = seg(30, q, 6), seg(16, q, 4)
    m += panel((RW[1] - 0.015, A_TOP + 0.025), (-0.605, 0.605), nu, nv, 0.022, 'paint')
    for s in (-1, 1):
        # A-pillar: a strip round the pillar line, from the header corner to the scuttle
        m += panel((A_TOP - 0.03, A_BASE + 0.008), lambda x: (t_apillar(x) - 0.024, np.minimum(1.04, t_apillar(x) + 0.040)),
                   seg(22, q, 5), seg(4, q, 2), 0.020, 'paint', side=s)
        # cant rail over the door and the quarter glass
        m += panel((C_TOP - 0.02, A_TOP), (0.57, 0.615), seg(26, q, 5), 2, 0.018, 'paint', side=s)
        # sail (C-pillar) from the C line back to the rear window and down to the deck
        m += panel((GH_X[0] - 0.005, C_TOP + 0.02),
                   lambda x: (np.where(x < RW[1] + 0.012, RW[2] - 0.030, 0.598), np.where(x > C_BASE, np.clip(t_cline(x) + 0.035, 0.60, 1.08), 1.08)),
                   seg(24, q, 5), seg(10, q, 3), 0.022, 'paint', side=s)
        # B-pillar: a slim chrome post between the door glass and the quarter glass
        m += panel((B_X - 0.018, B_X + 0.012), (0.585, 1.01), 2, seg(8, q, 3), 0.016, 'body:chrome', inset=-0.002,
                   side=s)
    # header rail over the windscreen and the scuttle panel under it
    m += panel((A_TOP - 0.006, A_TOP + 0.034), lambda x: (-t_apillar(x) + 0.02, t_apillar(x) - 0.02), 2, seg(20, q, 6),
               0.018, 'paint')
    return m


def glass_panels(q, k='glass'):
    """Windscreen, rear window and quarter glass (node 'glass'), inset a few mm under the frames."""
    m = Mesh()
    m += panel((A_TOP + 0.004, A_BASE + 0.006), lambda x: (-t_apillar(x) + 0.004, t_apillar(x) - 0.004),
               seg(16, q, 3), seg(24, q, 4), 0.006, k, inset=0.006)
    m += panel((RW[0], RW[1] - 0.01), (-RW[2] - 0.008, RW[2] + 0.008), seg(16, q, 3), seg(20, q, 4), 0.006, k,
               inset=0.006)
    for s in (-1, 1):
        m += panel(lambda v: (B_X - 0.010, lerp(C_TOP, C_BASE, v) - 0.02), (0.585, 1.06), seg(12, q, 3),
                   seg(8, q, 2), 0.006, k, inset=0.010, side=s)
    return m


def door_glass(q, s, key='glass'):
    """Door window (right s = 1, left -1): frameless, from the A-pillar back to the B-pillar and
    from the cant rail down into the door (t to 1.12), so it can slide down out of sight."""
    return panel((B_X + 0.006, A_BASE - 0.004), lambda x: (np.maximum(0.585, t_apillar(x) + 0.040), 1.12),
                 seg(20, q, 4), seg(10, q, 3), 0.006, key, inset=0.012, side=s)


def window_open(s):
    """Open pose of a door window (side s) as a 4x4 car-frame matrix applied to its node: the
    glass first turns about the belt line until it stands upright (it leans in with the
    tumblehome when closed), then drops straight down into the door between the outer skin and
    the door card, its top edge just under the belt moulding."""
    x = -0.05
    P0, P1, Pb = canopy(x, s * 0.585), canopy(x, s * 1.12), canopy(x, s * 1.0)
    d = P0 - Pb                                   # belt -> top edge
    th = math.atan2(-d[2], d[1])                  # turn that brings the top edge over the belt
    c, sn = math.cos(th), math.sin(th)
    R = np.array([[1, 0, 0], [0, c, -sn], [0, sn, c]])
    drop = float(np.linalg.norm(d[1:])) + 0.025
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = Pb - R @ Pb + np.array([0.0, -drop, 0.0])
    return M


def window_travel(s):
    """Open position of a door window (translation of its node): down along the glass's own
    tumblehome by the height of the opening."""
    x = -0.05
    a, b = canopy(x, s * 0.585), canopy(x, s * 1.12)
    d = b - a
    h = abs(float(canopy(x, s * 1.0)[1] - canopy(x, s * 0.585)[1]))
    return (norm(d) * (h + 0.02)).round(4).tolist()


def window_trims(q):
    """Chrome frames round the glass: windscreen surround, drip rails, belt mouldings, rear
    window surround, and black rubber seals inside them (body)."""
    m = Mesh()
    n = seg(6, q, 4) if q >= 0.2 else 3
    sam = lambda L: max(4 if q >= 0.2 else 3, int(L / 0.05 * q) + 3)

    def along(pts, r, mat='body:chrome'):
        P = np.asarray(pts)
        L = float(np.sum(np.linalg.norm(np.diff(P, axis=0), axis=1)))
        return tube(P, r, n=n, mat=mat, samples=sam(L), cap='dome' if q >= 0.2 else 'fan')

    xs = np.linspace(A_TOP, A_BASE, 8)
    for s in (-1, 1):
        # windscreen side (A-pillar inner edge) and the drip rail along the cant to the C line
        m += along(canopy(xs, s * t_apillar(xs)) + canopy_normal(xs, s * t_apillar(xs)) * 0.004, 0.0065)
        xd = np.linspace(C_TOP, A_TOP, 10)
        m += along(canopy(xd, np.full_like(xd, s * 0.578)) + canopy_normal(xd, s * 0.578) * 0.006, 0.0060)
        xc = np.linspace(C_TOP, C_BASE, 6)
        m += along(canopy(xc, s * t_cline(xc)) + canopy_normal(xc, s * t_cline(xc)) * 0.005, 0.0055)
        # belt moulding along the window sill
        xb = np.linspace(C_BASE, A_BASE, 14)
        m += along(canopy(xb, np.full_like(xb, s * 1.0)) + canopy_normal(xb, s * 1.0) * 0.004 + [0, 0.004, 0], 0.0060)
        # rear window sides
        xr_ = np.linspace(RW[0], RW[1], 8)
        m += along(canopy(xr_, np.full_like(xr_, s * RW[2])) + canopy_normal(xr_, s * RW[2]) * 0.004, 0.0055)
    tt = np.linspace(-1, 1, 13)
    for xx, tw in ((A_TOP + 0.002, None), (A_BASE + 0.002, None), (RW[0] + 0.004, RW[2]), (RW[1] - 0.004, RW[2])):
        span = t_apillar(xx) if tw is None else tw
        P = canopy(np.full_like(tt, xx), tt * span) + canopy_normal(np.full_like(tt, xx), tt * span) * 0.004
        m += along(P, 0.0065)
    return m


# ---------------------------------------------------------------------------------------------
# Surface queries (for parts that sit on the body: lamps, vents, handles, badges)
# ---------------------------------------------------------------------------------------------

_RING = {}


def _half(x):
    """Right half of the full-detail body section at x (with the nose morph), (z, y)."""
    key = round(float(x), 4)
    if key not in _RING:
        r, _ = body_ring(float(x), (8, 4, 7, 9, 4, 2, 40))
        h = r[: len(r) // 2 + 1]
        _RING[key] = np.stack([h[:, 2], h[:, 1]], -1)
    return _RING[key]


def surf_z(x, y):
    """Outer side half width at height y (upper part of the section, above the widest point)."""
    h = _half(x)
    i = int(np.argmax(h[:, 0]))
    up = h[i:]
    k = np.argsort(up[:, 1])
    return float(np.interp(y, up[k, 1], up[k, 0]))


def surf_z_low(x, y):
    h = _half(x)
    i = int(np.argmax(h[:, 0]))
    lo = h[: i + 1]
    lo = lo[lo[:, 0] > 0.3]
    k = np.argsort(lo[:, 1])
    return float(np.interp(y, lo[k, 1], lo[k, 0]))


def top_y(x):
    h = _half(x)
    return float(h[-1, 1])


def side_frame(x, y, z_fn=surf_z):
    """Point on the right side and its outward normal (finite differences)."""
    e = 0.004
    p = np.array([x, y, z_fn(x, y)])
    px = np.array([x + e, y, z_fn(x + e, y)]) - np.array([x - e, y, z_fn(x - e, y)])
    py = np.array([x, y + e, z_fn(x, y + e)]) - np.array([x, y - e, z_fn(x, y - e)])
    n = norm(np.cross(px, py))
    if n[2] < 0:
        n = -n
    return p, n


def bisect(f, a, b, it=40):
    fa = f(a)
    for _ in range(it):
        c = (a + b) / 2
        fc = f(c)
        if (fc > 0) == (fa > 0):
            a, fa = c, fc
        else:
            b = c
    return (a + b) / 2


def frame_from(axis, up=(0, 1, 0)):
    """Rotation whose local +z is `axis` (local x across, y up-ish)."""
    zax = norm(np.asarray(axis, float))
    xax = norm(np.cross(up, zax))
    yax = np.cross(zax, xax)
    return np.stack([xax, yax, zax], -1)


def placed(m, R, t):
    m.V = m.V @ np.asarray(R).T + np.asarray(t)
    return m


# ---------------------------------------------------------------------------------------------
# Front: grille, headlamps, indicators, badge, bumper; rear: lamps, bumper, badge plate
# ---------------------------------------------------------------------------------------------

_TRI = {}


def _body_tris():
    if 'T' not in _TRI:
        m = body_shell(0.6)
        tris = []
        for f in m.F:
            for k in range(1, len(f) - 1):
                tris.append((f[0], f[k], f[k + 1]))
        T = m.V[np.array(tris)]
        _TRI['T'] = T
    return _TRI['T']


def ray_hit(o, d):
    """First hit of the ray o + t d on the body shell: (point, unit normal facing the ray's origin)."""
    T = _body_tris()
    o = np.asarray(o, float)
    d = norm(np.asarray(d, float))
    e1, e2 = T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
    pv = np.cross(d, e2)
    det = np.sum(e1 * pv, -1)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
    tv = o - T[:, 0]
    u = np.sum(tv * pv, -1) * inv
    qv = np.cross(tv, e1)
    v = np.sum(d * qv, -1) * inv
    t = np.sum(e2 * qv, -1) * inv
    hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0)
    if not hit.any():
        raise ValueError(f'ray {o} {d} misses the body')
    k = np.where(hit)[0][np.argmin(t[hit])]
    n = norm(np.cross(e1[k], e2[k]))
    if np.dot(n, d) > 0:
        n = -n
    return o + d * t[k], n


def nose_hit(y, z):
    return ray_hit((3.0, y, z), (-1, 0, 0))


def tail_hit(y, z):
    return ray_hit((-3.0, y, z), (1, 0, 0))


def mouth_outline(n, grow=0.0, x=None):
    t = np.arange(n) / n * TAU
    zy = mouth_pts(t, grow)
    return np.stack([np.full(n, _mouth_x() if x is None else x), zy[:, 1], zy[:, 0]], -1)


def _mouth_x():
    return FACE_X + FACE_D


def grille(q):
    """Chrome surround on the mouth's lip, fine horizontal chrome bars with a slim centre post,
    and a dark mesh behind them (body)."""
    m = Mesh()
    cy, ma, mb = MOUTH
    n = seg(64, q, 14)
    ring = mouth_outline(n, 0.002, _mouth_x() + 0.001)
    m += sweep(ring, lambda i, t: ellipse(0.0055, 0.0075, seg(8, q, 4)), 'body:chrome', closed=True)
    if q < 0.2:
        return m
    xg = _mouth_x() - 0.030

    def half_w(y):
        v = np.clip(np.abs((y - cy) / (mb * 0.985)), 0, 1)
        return ma * 0.985 * (1 - v ** (1 / MOUTH_E[1])) ** MOUTH_E[0]

    for yy in np.linspace(cy - mb * 0.80, cy + mb * 0.80, 9):
        w = float(half_w(yy)) - 0.006
        if w > 0.05:
            m += _hbar(xg + 0.004, yy, w)
    # slim vertical centre post and a dark mesh plane behind the bars
    b = slab(rounded_rect(0.007, mb * 0.96, 0.003, 1), 0.012, axis=2, centre=0.0, round_r=0.002,
             mat='body:chrome', steps=1)
    b.transform(t=(xg + 0.010, cy, 0))
    m += b
    mesh = slab(rounded_rect(mb * 0.94, ma * 0.97, mb * 0.5, seg(6, q, 3)), 0.004, axis=0, centre=xg - 0.018,
                mat='body:grille', steps=1)
    mesh.transform(t=(0, cy, 0))
    m += mesh
    return m


def _hbar(xg, yy, w):
    b = slab(rounded_rect(0.008, 0.0028, 0.0025, 1), 2 * w, axis=2, centre=0.0, round_r=0.002, mat='body:chrome', steps=1)
    b.transform(t=(xg, yy, 0))
    return b


HEAD_Y, HEAD_Z = 0.622, 0.600   # headlamp centres, in the wing tips beside the grille
HEAD_R = 0.090


def headlamp_parts(q, s):
    """One headlamp (side s), faired into the wing tip under a clear cover: a paint cowl that
    grows out of the wing, a slim chrome ring, faceted reflector, bulb shield
    (headlight_lens) and the domed glass cover. Returns (body, lens, glass) meshes."""
    p, nrm = nose_hit(HEAD_Y, s * HEAD_Z)
    axis = norm(np.array([1.0, 0.06, 0.20 * s]) + nrm * 0.4)
    R = frame_from(axis)
    c = p + axis * 0.042            # stands proud of the face; the cowl fairs it back into the wing
    r = HEAD_R
    n = seg(36, q, 8)
    body = Mesh()
    body += placed(revolve([(r + 0.002, -0.24), (r + 0.010, -0.08), (r + 0.008, -0.012), (r + 0.002, 0.000),
                            (r - 0.006, -0.004), (r - 0.008, -0.050), (r - 0.010, -0.20)], n, mat='paint',
                           closed_profile=True), R, c)
    body += placed(revolve([(r - 0.007, -0.001), (r + 0.001, 0.000), (r + 0.003, 0.005), (r - 0.002, 0.009),
                            (r - 0.007, 0.006)], n, mat='body:chrome', closed_profile=True), R, c)
    if q >= 0.2:
        body += placed(revolve([(r - 0.008, -0.006), (r * 0.75, -0.030), (r * 0.45, -0.052), (0.018, -0.060),
                                (0.014, -0.056), (r * 0.43, -0.047), (r * 0.73, -0.025), (r - 0.010, -0.003)], n,
                               mat='body:reflector', closed_profile=True), R, c)
    lens = placed(revolve([(0.0, -0.040), (0.026, -0.040), (0.028, -0.030), (0.022, -0.020), (0.0, -0.018)],
                          seg(16, q, 6), mat='headlight_lens'), R, c)
    glass = placed(revolve([(0.0, 0.030), (r * 0.55, 0.024), (r - 0.004, 0.010), (r - 0.004, 0.006),
                            (r * 0.55, 0.019), (0.0, 0.025)], n, mat='glass:clear'), R, c)
    return body, lens, glass


def indicators(q):
    """Small round amber lamps under the headlamps, beside the grille's ends."""
    m = Mesh()
    for s in (-1, 1):
        p, nrm = nose_hit(0.452, s * 0.600)
        R = frame_from(norm(nrm + np.array([0.6, 0, 0])))
        c = p - nrm * 0.004
        lamp = revolve([(0.0, -0.01), (0.022, -0.01), (0.024, 0.004), (0.017, 0.010), (0.0, 0.012)], seg(16, q, 6),
                       mat='body:amber')
        lamp.V[:, 0] *= 1.35
        m += placed(lamp, R, c)
        rim = revolve([(0.022, -0.004), (0.027, -0.002), (0.027, 0.006), (0.023, 0.006)], seg(16, q, 6),
                      mat='body:chrome', closed_profile=True)
        rim.V[:, 0] *= 1.35
        m += placed(rim, R, c)
    return m


BADGE_Y = 0.585


def nose_badge(q):
    """Enamel roundel on the nose above the grille (generic: the game's own mark)."""
    p, nrm = nose_hit(BADGE_Y, 0.0)
    R = frame_from(nrm, up=(0, 1, 0))
    m = placed(revolve([(0.0, -0.004), (0.026, -0.004), (0.028, 0.004), (0.024, 0.007), (0.0, 0.007)],
                       seg(24, q, 8), mat='body:badge'), R, p)
    m += placed(revolve([(0.025, 0.000), (0.031, 0.001), (0.031, 0.007), (0.026, 0.009)], seg(24, q, 8),
                        mat='body:chrome', closed_profile=True), R, p)
    return m


def blade(path_xz, y, h, t_, q, mat='body:chrome'):
    P = catmull([(x, y, z) for x, z in path_xz], seg(44, q, 8))
    return sweep(P, lambda i, t: ellipse(t_, h, seg(10, q, 6), e=0.7), mat, up=(0, 1, 0), dome_depth=0.02,
                 dome_steps=2)


def _bumper_path(hit, y, sign, zs, gap):
    pts = []
    for z in zs:
        p, nrm = hit(y, z)
        pts.append((p[0] + sign * gap, z))
    half = pts[::-1] + [(x, -z) for x, z in pts[1:]]
    return [(x, -z) for x, z in half]


def bumpers(q):
    """Slim chrome blades hugging the nose and the tail, short rounded overriders."""
    m = Mesh()
    zs = [0.0, 0.25, 0.45, 0.60, 0.70, 0.76]
    fpath = _bumper_path(nose_hit, 0.300, 1, zs, 0.030)
    fpath = [(fpath[0][0] - 0.06, fpath[0][1] * 1.03)] + fpath + [(fpath[-1][0] - 0.06, fpath[-1][1] * 1.03)]
    m += blade(fpath, 0.300, 0.020, 0.011, q)
    rzs = [0.0, 0.25, 0.42, 0.55, 0.64, 0.70]
    rpath = _bumper_path(tail_hit, 0.400, -1, rzs, 0.030)
    rpath = [(rpath[0][0] + 0.07, rpath[0][1] * 1.04)] + rpath + [(rpath[-1][0] + 0.07, rpath[-1][1] * 1.04)]
    m += blade(rpath, 0.400, 0.020, 0.011, q)
    n = seg(12, q, 6)
    for s in (-1, 1):
        for hit, y0, y1, sg in ((nose_hit, 0.245, 0.360, 1),):
            p, _ = hit(0.30 if sg > 0 else 0.40, s * 0.30)
            x = p[0] + sg * 0.036
            m += strut((x, y0, s * 0.30), (x - sg * 0.006, y1, s * 0.30), 0.016, 0.014, n=n, mat='body:chrome',
                       samples=seg(5, q, 3))
    return m


TAIL_Y, TAIL_Z = 0.672, 0.585    # tail lamp centres, in the ends of the rear wings


def tail_lamps(q):
    """Long tapered tail lamps set into the rear wing ends: a chrome bezel, red lens with a small
    amber section at the inner end, the outer end wrapping round the corner. Returns
    (body, lens)."""
    body, lens = Mesh(), Mesh()
    for s in (-1, 1):
        p, nrm = tail_hit(TAIL_Y, s * TAIL_Z)
        axis = norm(nrm * 0.75 + np.array([-0.25, 0.0, 0.0]))
        R = frame_from(axis)
        c = p - axis * 0.004
        n = seg(32, q, 10)

        def shaped(m):
            # long oval, tapered toward the car's centre line (local x points across the car)
            V = m.V
            lx = V[:, 0] * 2.7
            k = 1.0 + 0.22 * np.clip(lx * s / 0.10, -1, 1)
            V[:, 0] = lx
            V[:, 1] = V[:, 1] * 1.05 * k
            return m

        bez = shaped(revolve([(0.040, -0.030), (0.045, -0.002), (0.045, 0.005), (0.040, 0.008), (0.037, -0.030)],
                             n, mat='body:chrome', closed_profile=True))
        body += placed(bez, R, c)
        cowl = shaped(revolve([(0.047, -0.16), (0.050, -0.04), (0.046, -0.004), (0.040, -0.004), (0.040, -0.16)], n,
                              mat='paint', closed_profile=True))
        if q >= 0.2:
            body += placed(cowl, R, c)
        L = shaped(revolve([(0.0, -0.020), (0.039, -0.020), (0.040, 0.003), (0.026, 0.010), (0.0, 0.012)], n,
                           mat='taillight_lens'))
        lens += placed(L, R, c)
        if q >= 0.2:
            am = revolve([(0.0, -0.01), (0.015, -0.01), (0.016, 0.009), (0.0, 0.014)], seg(14, q, 6), mat='body:amber')
            body += placed(am, R, c + R @ np.array([-0.062 * s, 0.0, 0.004]))
    return body, lens


def boot_plate(q):
    """Chrome name plate on the boot lid (the car's name, see livery)."""
    x = -2.02
    y = float(crown(x, 0.0))
    e = 0.004
    nrm = norm(np.array([float(crown(x - e, 0) - crown(x + e, 0)), 2 * e, 0.0]))
    R = frame_from(nrm, up=(1, 0, 0))
    m = slab(rounded_rect(0.160, 0.030, 0.010, seg(3, q, 2)), 0.006, axis=2, centre=0.002, mat='body:chrome', steps=1)
    return placed(m, R, (x, y, 0.0))


# ---------------------------------------------------------------------------------------------
# Side details: wing vents, door handles, mirrors, sill finisher, fuel filler, wipers
# ---------------------------------------------------------------------------------------------

def surface_patch(x0, x1, y0, y1, nu, nv, thick, mat, out=0.0, shape=None):
    """Plate hugging the right side between x0..x1, y0..y1 (optionally an oval `shape`)."""
    def fn(u, v):
        if shape == 'oval':
            a = (u - 0.5) * 2
            yy = lerp(y0, y1, 0.5) + (v - 0.5) * (y1 - y0) * np.sqrt(np.clip(1 - a ** 2, 0, 1) * 0.98 + 0.02)
        else:
            yy = lerp(y0, y1, v)
        xx = lerp(x0, x1, u)
        P = np.zeros(u.shape + (3,))
        Nn = np.zeros(u.shape + (3,))
        for idx in np.ndindex(u.shape):
            p, n = side_frame(float(xx[idx]), float(yy[idx]))
            P[idx], Nn[idx] = p + n * out, n
        return P, Nn
    return patch_slab(fn, nu, nv, thick, mat=mat)


def wing_vents(q):
    m = Mesh()
    if q < 0.2:
        return m
    x0, x1, y0, y1 = 0.700, 0.905, 0.560, 0.655
    v = surface_patch(x0, x1, y0, y1, seg(12, q, 4), seg(6, q, 3), 0.004, 'body:inlet', out=0.0005, shape='oval')
    n = seg(8, q, 4)
    for s in (-1, 1):
        mm = v.copy()
        if s < 0:
            mm = mm.mirrored_z()
        m += mm
        ring = []
        for a in np.linspace(0, TAU, seg(28, q, 10), endpoint=False):
            xx = (x0 + x1) / 2 + (x1 - x0) / 2 * math.cos(a)
            yy = (y0 + y1) / 2 + (y1 - y0) / 2 * math.sin(a)
            p, nn = side_frame(xx, yy)
            ring.append(p + nn * 0.004)
        R_ = np.array(ring) * [1, 1, s]
        m += sweep(R_, lambda i, t: ellipse(0.0045, 0.0045, n), 'body:chrome', closed=True)
        for yy in np.linspace(y0 + 0.022, y1 - 0.022, 3):
            pts = []
            for xx in np.linspace(x0 + 0.03, x1 - 0.03, 4):
                p, nn = side_frame(xx, yy)
                pts.append(p + nn * 0.006)
            m += tube(np.array(pts) * [1, 1, s], 0.0045, n=n, mat='body:chrome', samples=seg(6, q, 3))
    return m


def door_handles(q):
    m = Mesh()
    for s in (-1, 1):
        p, nn = side_frame(-0.310, 0.870)
        a = p + nn * 0.012 + [0.055, 0, 0]
        b = p + nn * 0.012 - [0.055, 0, 0]
        h = strut(tuple(a * [1, 1, s]), tuple(b * [1, 1, s]), 0.011, 0.009, n=seg(10, q, 6), mat='body:chrome',
                  samples=seg(5, q, 3))
        m += h
        if q >= 0.2:
            for d in (0.045, -0.045):
                m += strut(tuple((p + [d, 0, 0]) * [1, 1, s]), tuple((p + nn * 0.012 + [d, 0, 0]) * [1, 1, s]), 0.006,
                           0.006, n=seg(6, q, 4), mat='body:chrome', samples=2)
    return m


MIRROR_BASE = 0.560


def door_mirrors(q):
    """Chrome bullet mirrors on the doors, just behind the A-pillar foot; round glass faces the
    driver (MirrorGlass)."""
    m = Mesh()
    n = seg(20, q, 8)
    for s in (-1, 1):
        x = MIRROR_BASE
        zb = float(gb_c(x)) + 0.06
        yb_ = float(crown(x, zb))
        base = np.array([x, yb_, s * zb])
        head = np.array([x - 0.02, yb_ + 0.075, s * (zb + 0.085)])
        m += strut(tuple(base), tuple(head), 0.010, 0.010, n=seg(8, q, 5), mat='body:chrome', samples=3)
        m += blob(base + [0, 0.004, 0], (0.030, 0.010, 0.020), n=seg(12, q, 6), rings=seg(6, q, 4), e1=0.7, e2=0.7,
                  mat='body:chrome')
        shell = revolve([(0.0, 0.050), (0.020, 0.040), (0.040, 0.012), (0.046, -0.020), (0.046, -0.026),
                         (0.0, -0.026)], n, mat='body:chrome', axis='x')
        shell.transform(t=tuple(head + [0.0, 0.02, 0]))
        m += shell
        g = revolve([(0.0, -0.032), (0.041, -0.032), (0.041, -0.027), (0.0, -0.027)], n, mat='mirror', axis='x')
        g.transform(t=tuple(head + [0.0, 0.02, 0]))
        m += g
    return m


def sills(q):
    m = Mesh()
    n = seg(6, q, 4)
    for s in (-1, 1):
        pts = []
        for x in np.linspace(XF - ARCH[0][2] - 0.01, XR + ARCH[1][2] + 0.01, seg(14, q, 4)):
            y = float(yb_c(x)) + 0.090
            z = surf_z_low(x, y) + 0.004
            pts.append((x, y, s * z))
        m += tube(pts, 0.0060, n=n, mat='body:chrome', samples=seg(14, q, 4))
    return m


def fuel_filler(q):
    x, z = -1.72, -0.700
    y = float(crown(x, abs(z)))
    e = 0.004
    ny = norm(np.array([float(crown(x - e, 0.7) - crown(x + e, 0.7)), 2 * e,
                        float(crown(x, 0.7 - e) - crown(x, 0.7 + e)) * -1]))
    R = frame_from(ny, up=(1, 0, 0))
    m = revolve([(0.0, -0.004), (0.046, -0.004), (0.048, 0.004), (0.040, 0.010), (0.0, 0.012)], seg(24, q, 8),
                mat='body:chrome')
    return placed(m, R, (x, y, z))


def wipers(q):
    m = Mesh()
    if q < 0.2:
        return m
    for tc in (-0.42, 0.10):
        # parked along the foot of the windscreen, pivot at the scuttle
        a = canopy(A_BASE - 0.010, tc)
        b = canopy(A_BASE - 0.045, tc + 0.42)
        nrm = canopy_normal(A_BASE - 0.03, tc + 0.2)
        m += strut(tuple(a + nrm * 0.012), tuple(b + nrm * 0.012), 0.004, 0.0025, n=seg(6, q, 4), mat='body:rubber',
                   samples=3)
        m += blob(a + nrm * 0.008, (0.012, 0.010, 0.012), n=seg(8, q, 5), rings=4, mat='body:chrome')
    return m


# ---------------------------------------------------------------------------------------------
# Wheels: classic wire wheels (wheel frame: axis z, outer face +z, origin on the axis)
# ---------------------------------------------------------------------------------------------

def tyre(R, W, q):
    n = seg4(72, q)
    hw = W / 2
    hb = hw - 0.016
    rb = RIM_R + 0.004
    bulge = RIM_R + 0.55 * (R - RIM_R)
    pts = [(rb, -hb), (rb + 0.010, -hw + 0.008), (bulge - 0.04, -hw - 0.004), (bulge + 0.04, -hw - 0.004),
           (R - 0.030, -hw + 0.006), (R - 0.008, -hw + 0.020), (R, -hw + 0.040), (R + 0.002, 0.0),
           (R, hw - 0.040), (R - 0.008, hw - 0.020), (R - 0.030, hw - 0.006), (bulge + 0.04, hw + 0.004),
           (bulge - 0.04, hw + 0.004), (rb + 0.010, hw - 0.008), (rb, hb), (RIM_R - 0.006, hb - 0.008),
           (RIM_R - 0.006, -hb + 0.008)]
    np_ = max(12, even(int(round(32 * q))))
    prof = catmull(pts, np_, closed=True)
    rmax = prof[:, 0].max()
    prof[:, 0] = rb + (prof[:, 0] - rb) * (R - rb) / (rmax - rb)
    return revolve(prof, n, mat='tyre', closed_profile=True)


def rim(W, q):
    """Chrome wire wheel: well-base rim, 72 tangent-laced spokes in three rows from the hub's two
    flanges, deep centre-lock hub with a two-eared knock-off spinner."""
    n = seg4(72, q)
    rw = W - 0.050
    zo, zi = rw / 2, -rw / 2
    if q < 0.2:
        return rim_race(W, n)
    R0 = RIM_R
    prof = [(R0 + 0.012, zo + 0.004), (R0 + 0.013, zo - 0.004), (R0 + 0.002, zo - 0.010), (R0, zo - 0.025),
            (R0 - 0.022, zo - 0.040), (R0 - 0.022, zi + 0.040), (R0, zi + 0.025), (R0 + 0.002, zi + 0.010),
            (R0 + 0.013, zi - 0.004), (R0 + 0.012, zi + 0.004), (R0 - 0.003, zi + 0.012), (R0 - 0.027, zi + 0.040),
            (R0 - 0.027, zo - 0.040), (R0 - 0.004, zo - 0.012)]
    m = revolve(prof, n, mat='rim:chrome', closed_profile=True)
    # hub shell with two flanges, sticking out past the rim face
    m += revolve([(0.000, zi + 0.010), (0.072, zi + 0.010), (0.074, zi + 0.022), (0.050, zi + 0.030),
                  (0.046, zo - 0.030), (0.082, zo - 0.024), (0.082, zo - 0.012), (0.052, zo - 0.006),
                  (0.046, zo + 0.040), (0.0, zo + 0.040)], seg(32, q, 10), mat='rim:chrome')
    # spokes
    rows = 24 if q >= 0.6 else 16
    ns = seg(6, q, 4)
    flange = {'o': (0.078, zo - 0.018), 'i': (0.068, zi + 0.018)}
    rim_r = R0 - 0.020
    for k in range(rows):
        th = k * TAU / rows
        for row, (fl, zr, dth) in enumerate((('o', 0.000, 0.38), ('i', 0.030, -0.38), ('i', -0.030, 0.38 + TAU / rows / 2))):
            if q < 0.6 and row == 2:
                continue
            fr, fz = flange[fl]
            a = (fr * math.cos(th), fr * math.sin(th), fz)
            b = (rim_r * math.cos(th + dth), rim_r * math.sin(th + dth), zr)
            m += strut(a, b, 0.0024, 0.0024, n=ns, mat='rim:wire', samples=2, cap='fan')
    # knock-off spinner: hex body and two ears
    m += revolve([(0.0, zo + 0.036), (0.050, zo + 0.036), (0.052, zo + 0.048), (0.040, zo + 0.060), (0.0, zo + 0.062)],
                 8, mat='rim:chrome')
    if q >= 0.2:
        for s in (-1, 1):
            ear = slab(chaikin([(0.035, -0.012), (0.105, -0.008), (0.112, 0.0), (0.105, 0.008), (0.035, 0.012)],
                               seg(14, q, 6), iters=2) * [s, 1], 0.012, axis=2, centre=zo + 0.050, mat='rim:chrome',
                       steps=1)
            m += ear
    return m


def rim_race(W, n):
    rw = W - 0.050
    zo, zi = rw / 2, -rw / 2
    prof = [(0.0, zo - 0.020), (RIM_R - 0.015, zo - 0.020), (RIM_R + 0.012, zo), (RIM_R + 0.012, zi),
            (RIM_R - 0.02, zi), (0.0, zi)]
    m = revolve(prof, n, mat='rim:chrome')
    m += revolve([(0.0, zo - 0.022), (0.050, zo - 0.022), (0.050, zo + 0.050), (0.0, zo + 0.055)], 8, mat='rim:chrome')
    return m


def upright(front, q):
    """Static side of a wheel: solid disc, caliper, hub carrier (wheel frame, right side)."""
    W = WF if front else WR
    zc = -W / 2 + 0.020
    m = Mesh()
    n = seg(40, q, 10)
    m += revolve([(0.075, zc - 0.016), (0.135, zc - 0.016), (0.135, zc + 0.000), (0.075, zc + 0.000)], n,
                 mat='body:discp', closed_profile=True)
    na = seg(12, q, 4)
    angs = np.radians(np.linspace(105, 145, na))
    path = np.stack([np.cos(angs) * 0.118, np.sin(angs) * 0.118, np.full(na, zc - 0.008)], -1)
    if q < 0.2:
        return m + sweep(path, lambda i, t: ellipse(0.024, 0.028, 4, e=0.35), 'body:caliper', cap0='fan', cap1='fan',
                         up=(0, 0, 1))
    m += sweep(path, lambda i, t: ellipse(0.024, 0.030, seg(12, q, 6), e=0.30), 'body:caliper', cap0='dome',
               cap1='dome', up=(0, 0, 1), dome_depth=0.010, dome_steps=2)
    m += blob((0.0, 0.0, zc - 0.060), (0.050, 0.150, 0.026), n=seg(16, q, 6), rings=seg(10, q, 4), e1=0.55, e2=0.6,
              mat='body:metal')
    return m


# ---------------------------------------------------------------------------------------------
# Cabin (node 'interior' in the outside LODs; the cockpit file has its own detailed one)
# ---------------------------------------------------------------------------------------------

DASH = [(0.668, 0.890), (0.645, 0.950), (0.565, 0.972), (0.478, 0.966), (0.432, 0.944), (0.408, 0.893),
        (0.406, 0.742), (0.440, 0.700), (0.668, 0.700)]


def dash_body(q, half=0.715, mat='int:dash'):
    """Dashboard: the DASH section lofted across the car, its top dropping near the doors so it
    stays under the windscreen's curved sides."""
    out = chaikin(np.array(DASH), seg(40, q, 10), iters=2)
    zs = np.linspace(-half, half, seg(24, q, 6))
    rings = []
    top = out[:, 1] > 0.86
    for z in zs:
        dz = max(0.0, (abs(z) - 0.50) / (half - 0.50))
        o = out.copy()
        o[:, 1] = np.where(top, o[:, 1] - 0.050 * dz ** 2 * (o[:, 1] - 0.86) / 0.11, o[:, 1])
        rings.append(np.stack([o[:, 0], o[:, 1], np.full(len(o), z)], -1))
    return loft(np.array(rings), mat, cap0='flat', cap1='flat')


GAUGE_POS = [(0.872, -0.455, 0.050), (0.872, -0.285, 0.050), (0.818, -0.140, 0.030), (0.818, -0.035, 0.030)]


def gauges(q, x=0.392):
    m = Mesh()
    n = seg(32, q, 10)
    for y, z, r in GAUGE_POS:
        face = revolve([(0.0, -0.0015), (r, -0.0015), (r, 0.0015), (0.0, 0.0015)], n, mat='int:gauge', axis='x')
        face.transform(t=(x, y, z))
        m += face
        bez = revolve([(r - 0.002, -0.008), (r + 0.006, -0.006), (r + 0.007, 0.002), (r - 0.002, 0.003)], n,
                      mat='int:chrome', axis='x', closed_profile=True)
        bez.transform(t=(x, y, z))
        m += bez
    return m


def seat(q, z, x0=-0.40, front=True):
    """Bucket seat: pleated cushion and back, leather bolsters (car frame)."""
    m = Mesh()
    n, r = seg(18, q, 6), seg(10, q, 4)
    tilt = rot((0, 0, 1), math.radians(14 if front else 24))
    cush = (x0, 0.355, z) if front else (x0, 0.385, z)
    hw = 0.215 if front else 0.20
    m += blob(cush, (0.235, 0.050, hw * 0.78), n=n, rings=r, e1=0.35, e2=0.35, mat='int:pleat')
    back_c = np.array([x0 - 0.245, 0.650, z]) if front else np.array([x0 - 0.20, 0.640, z])
    m += blob(back_c, (0.055, 0.290 if front else 0.250, hw * 0.78), n=n, rings=r, e1=0.35, e2=0.35, mat='int:pleat',
              R=tilt)
    if q >= 0.2:
        for s in (-1, 1):
            m += blob((x0, 0.385, z + s * hw * 0.86), (0.245, 0.060, 0.040), n=seg(14, q, 6), rings=seg(8, q, 4),
                      e1=0.4, e2=0.4, mat='int:leather')
            m += blob(back_c + tilt @ np.array([0.02, 0.0, s * hw * 0.86]), (0.070, 0.300, 0.040), n=seg(14, q, 6),
                      rings=seg(8, q, 4), e1=0.4, e2=0.4, mat='int:leather', R=tilt)
    return m


def console(q):
    m = Mesh()
    m += blob((-0.08, 0.330, 0.0), (0.560, 0.110, 0.092), n=seg(16, q, 6), rings=seg(8, q, 4), e1=0.35, e2=0.35,
              mat='int:carpet')
    m += blob((0.20, 0.448, 0.0), (0.180, 0.020, 0.080), n=seg(14, q, 6), rings=seg(6, q, 3), e1=0.3, e2=0.3,
              mat='int:wood')
    m += strut((0.12, 0.45, 0.0), (0.07, 0.62, 0.0), 0.006, 0.006, n=seg(8, q, 4), mat='int:chrome', samples=3)
    m += blob((0.068, 0.632, 0.0), (0.020, 0.020, 0.020), n=seg(12, q, 6), rings=seg(6, q, 4), mat='int:wood')
    if q >= 0.2:
        m += strut((-0.18, 0.45, 0.06), (-0.40, 0.49, 0.06), 0.012, 0.010, n=seg(8, q, 4), mat='int:chrome', samples=3)
    return m


def cabin(q):
    """Seats, dash, gauges, console, column, headliner, parcel shelf, door pulls."""
    m = Mesh()
    m += dash_body(q)
    m += _fascia(q)
    if q >= 0.6:
        m += gauges(q)
    for z in (DRIVER_Z, -DRIVER_Z):
        m += seat(q, z)
    m += seat(q, 0.0, x0=-1.06, front=False).transform(s=(1, 1, 1.55))
    if q < 0.1:
        return m                 # rival LOD: dash and seats are all that read through the glass
    m += console(q)
    # steering column from the dash to the wheel
    m += strut(tuple(np.array(WHEEL_CENTRE) + [0.06, -0.03, 0]), (0.45, 0.80, DRIVER_Z), 0.022, 0.022,
               n=seg(10, q, 6), mat='int:black', samples=3)
    # headliner under the roof
    m += panel((-0.86, 0.236), (-0.59, 0.59), seg(14, q, 3), seg(8, q, 2), 0.006, 'int:headliner', inset=0.024)
    # parcel shelf under the rear window
    m += _shelf(q)
    if q >= 0.2:
        for s in (-1, 1):
            ci = float(ci_c(0.0))
            m += blob((-0.10, 0.66, s * (ci - 0.022)), (0.20, 0.022, 0.024), n=seg(12, q, 6), rings=seg(6, q, 3),
                      e1=0.4, e2=0.4, mat='int:leather')
            m += strut((0.18, 0.80, s * (ci - 0.006)), (0.18, 0.80, s * (ci - 0.030)), 0.008, 0.008, n=seg(8, q, 4),
                       mat='int:chrome', samples=2)
    return m


def _fascia(q):
    """Wood fascia across the dash face, under the gauges."""
    m = slab(rounded_rect(0.050, 0.700, 0.010, seg(3, q, 2)), 0.008, axis=0, centre=0.401, mat='int:wood', steps=1)
    m.transform(t=(0, 0.835, 0))
    # slab(axis=0): outline coords are (y, z): rounded_rect(hx=0.05 along y, hy=0.70 along z)
    return m


def _shelf(q):
    m = slab(rounded_rect(0.14, 0.50, 0.04, seg(3, q, 2)), 0.016, axis=1, centre=0.0, mat='int:carpet', steps=1)
    m.transform(t=(-1.32, 1.000, 0))
    return m


# ---------------------------------------------------------------------------------------------
# Steering wheel (frame: origin on the column axis at the wheel centre, local +x along the
# column toward the nose, +y up the wheel face, +z to the car's right)
# ---------------------------------------------------------------------------------------------

WHEEL_R = 0.192                 # rim centre-line radius (a big classic wheel)


def steering_wheel(q):
    m = Mesh()
    n = seg(56, q, 10)
    rimsec = ellipse(0.011, 0.013, seg(10, q, 4))
    ang = np.arange(n) / n * TAU
    path = np.stack([np.zeros(n), WHEEL_R * np.cos(ang), WHEEL_R * np.sin(ang)], -1)
    m += sweep(path, lambda i, t: rimsec, 'int:wood', closed=True, up=(1, 0, 0))
    # three slotted aluminium spokes (9, 3 and 6 o'clock), dished toward the hub
    for a in (math.pi / 2, -math.pi / 2, math.pi):
        d = np.array([0.0, math.cos(a), math.sin(a)])
        side = np.array([0.0, -math.sin(a), math.cos(a)])
        pts = [d * 0.040 + [0.030, 0, 0], d * 0.110 + [0.012, 0, 0], d * (WHEEL_R - 0.004)]
        m += sweep(catmull(pts, seg(8, q, 3)), lambda i, t: ellipse(0.0022, 0.016 - 0.004 * t, seg(6, q, 4)),
                   'int:metal', up=tuple(side), dome_depth=0.003, dome_steps=1)
    m += revolve([(0.0, -0.005), (0.046, -0.005), (0.050, 0.020), (0.044, 0.050), (0.0, 0.052)], seg(20, q, 8),
                 mat='int:black', axis='x')
    horn = revolve([(0.0, -0.010), (0.030, -0.010), (0.028, -0.002), (0.0, 0.0)], seg(20, q, 8), mat='body:badge',
                   axis='x')
    m += horn
    return m


def hands(q):
    """Tan leather driving gloves on the rim at ten to two, navy cuffs and sleeves (wheel frame:
    x along the column toward the nose, the driver is at -x)."""
    m = Mesh()
    n = seg(12, q, 6)
    X = np.array([1.0, 0, 0])
    for s in (-1, 1):
        a = math.radians(40)
        radial = np.array([0.0, math.sin(a), s * math.cos(a)])
        tang = norm(np.cross(X, radial)) * s
        c = radial * WHEEL_R
        # back of the hand: a flattened pad behind and over the rim
        Rh = np.stack([X, tang, radial], -1)
        m += blob(c - X * 0.017 + radial * 0.008, (0.013, 0.034, 0.024), n=seg(18, q, 8), rings=seg(10, q, 5),
                  e1=0.55, e2=0.65, mat='driver:glove', R=Rh)
        # knuckle ridge where the fingers leave the back of the hand
        m += blob(c - X * 0.006 + radial * 0.017, (0.009, 0.031, 0.011), n=seg(14, q, 6), rings=seg(6, q, 4),
                  e1=0.6, e2=0.6, mat='driver:glove', R=Rh)
        # four fingers curled round the rim from the outside to the front
        for k in range(4):
            off = (k - 1.5) * 0.0150
            base = c + tang * off
            ang = np.radians(np.linspace(-20, 215 - 12 * k, 8))
            rr = 0.0185
            pts = [base + radial * (math.cos(t) * rr) + X * (math.sin(t) * rr) for t in ang]
            m += tube(pts, 0.0068 - 0.0005 * k, n=n, mat='driver:glove', samples=seg(12, q, 5),
                      radius_fn=lambda t: lerp(1.08, 0.82, t))
        # thumb along the inside of the rim
        tb = c - X * 0.010 - radial * 0.014 - tang * 0.018
        m += tube([tb, tb + tang * 0.026 - radial * 0.004 + X * 0.010, tb + tang * 0.040 + X * 0.017], 0.0070, n=n,
                  mat='driver:glove', samples=seg(6, q, 3), radius_fn=lambda t: lerp(1.1, 0.85, t))
        # cuff and sleeve back toward the driver's elbow
        w0 = c - X * 0.034 - radial * 0.002
        m += tube([w0, w0 - X * 0.032 - radial * 0.010], 0.024, n=n, mat='driver:glove', samples=seg(3, q, 2),
                  radius_fn=lambda t: lerp(0.95, 1.1, t))
        m += tube([w0 - X * 0.028 - radial * 0.010, w0 - X * 0.20 - radial * 0.11 + np.array([0, -0.05, 0])], 0.031,
                  n=n, mat='driver:jacket', samples=seg(6, q, 3), radius_fn=lambda t: lerp(1.0, 1.2, t))
    return m


# ---------------------------------------------------------------------------------------------
# Driver (car frame; hidden in the cockpit view)
# ---------------------------------------------------------------------------------------------

HELMET_C = np.array([-0.430, 1.110, DRIVER_Z])
HELMET_H = np.array([0.128, 0.126, 0.112])


def sw_to_car(p):
    Rz = rot((0, 0, 1), WHEEL_TILT)
    return Rz @ np.asarray(p) + np.asarray(WHEEL_CENTRE)


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
    m += blob((-0.50, 0.950, DRIVER_Z), (0.085, 0.060, 0.170), n=seg(20, q, 8), rings=seg(8, q, 4), e1=0.6, e2=0.7,
              mat='driver:jacket')
    m += blob((-0.535, 0.700, DRIVER_Z), (0.110, 0.230, 0.180), n=seg(20, q, 8), rings=seg(10, q, 4), e1=0.7, e2=0.7,
              mat='driver:jacket', R=rot((0, 0, 1), math.radians(12)))
    for s in (-1, 1):
        sh = np.array([-0.50, 0.930, DRIVER_Z + s * 0.165])
        grip = sw_to_car((0.0, WHEEL_R * math.sin(math.radians(40)), s * WHEEL_R * math.cos(math.radians(40))))
        elbow = (sh + grip) / 2 + [0.0, -0.08, s * 0.05]
        m += tube([sh, elbow, grip - [0.03, 0, 0]], 0.040, n=seg(10, q, 6), mat='driver:jacket',
                  radius_fn=lambda t: lerp(1.0, 0.75, t), samples=seg(12, q, 4))
        m += blob(grip, (0.032, 0.040, 0.030), n=seg(12, q, 6), rings=seg(6, q, 4), e1=0.7, e2=0.7, mat='driver:glove')
        # thighs toward the pedals (not on the rival LOD: below the belt line)
        if q < 0.1:
            continue
        m += tube([(-0.48, 0.42, DRIVER_Z + s * 0.09), (-0.05, 0.47, DRIVER_Z + s * 0.10), (0.25, 0.36, DRIVER_Z + s * 0.10)],
                  0.065, n=seg(10, q, 6), mat='driver:jacket', samples=seg(10, q, 4))
    return m


# ---------------------------------------------------------------------------------------------
# Exhaust: twin chrome tailpipes under the rear bumper (node 'exhaust': nitro flames start here)
# ---------------------------------------------------------------------------------------------

def exhaust(q):
    m = Mesh()
    n = seg(20, q, 8)
    for z in (-0.38, -0.47):
        pipe = revolve([(0.026, 0.0), (0.030, -0.255), (0.031, -0.260), (0.031, -0.275), (0.024, -0.275),
                        (0.023, -0.010)], n, mat='body:chrome', axis='x', closed_profile=True)
        pipe.transform(t=(-2.05, 0.215, z))
        m += pipe
        if q >= 0.2:
            soot = revolve([(0.0, -0.255), (0.0235, -0.255), (0.0235, -0.251), (0.0, -0.251)], n, mat='body:inlet',
                           axis='x')
            soot.transform(t=(-2.05, 0.215, z))
            m += soot
    return m


# ---------------------------------------------------------------------------------------------
# Cockpit file (_cockpit.glb): the cabin as the driver sees it. The outside car stays visible
# (bonnet, wings, mirrors); the game hides its interior, driver, steering_wheel, glass and
# window nodes and adds this file in the same car frame.
# ---------------------------------------------------------------------------------------------

def binnacle(q):
    """Cowl over the two big dials, stitched leather, and the small switch row under them."""
    m = Mesh()
    n = seg(24, q, 8)
    for y, z, r in GAUGE_POS[:2]:
        ring = revolve([(r + 0.006, 0.000), (r + 0.016, 0.004), (r + 0.016, 0.034), (r + 0.010, 0.040),
                        (r + 0.004, 0.036), (r + 0.004, 0.006)], n, mat='int:leather', axis='x', closed_profile=True)
        ring.transform(t=(0.392 - 0.03, y, z))
        m += ring
    # hood over both, a curved visor
    ang = np.linspace(math.radians(25), math.radians(155), seg(16, q, 6))
    zc, yc = (GAUGE_POS[0][1] + GAUGE_POS[1][1]) / 2, GAUGE_POS[0][1] - 0.0
    pts = [(0.43, GAUGE_POS[0][0] + 0.018 + 0.060 * math.sin(a), DRIVER_Z + 0.150 * math.cos(a)) for a in ang]
    m += sweep(np.array(pts), lambda i, t: ellipse(0.045, 0.005, seg(8, q, 4), e=0.5), 'int:leather',
               up=(1, 0, 0), dome_depth=0.004, dome_steps=1)
    # toggle switches and small knobs on the fascia
    for k in range(6):
        z = -0.14 + k * 0.045
        m += strut((0.402, 0.790, z), (0.380, 0.792, z), 0.003, 0.003, n=seg(6, q, 4), mat='int:chrome', samples=2)
    for z in (0.16, 0.24, 0.32):
        m += revolve([(0.0, 0.0), (0.012, 0.0), (0.012, -0.016), (0.0, -0.018)], seg(12, q, 6), mat='int:black',
                     axis='x').transform(t=(0.402, 0.800, z))
    # clock in the centre of the dash
    m += revolve([(0.0, -0.0015), (0.032, -0.0015), (0.032, 0.0015), (0.0, 0.0015)], seg(24, q, 8), mat='int:gauge',
                 axis="x").transform(t=(0.392, 0.835, 0.150))
    m += revolve([(0.030, -0.008), (0.038, -0.006), (0.039, 0.002), (0.030, 0.003)], seg(24, q, 8), mat='int:chrome',
                 axis="x", closed_profile=True).transform(t=(0.392, 0.835, 0.150))
    return m


def rear_view_mirror(q):
    """Interior mirror hung from the header rail, glass toward the driver (MirrorGlass)."""
    m = Mesh()
    top = canopy(A_TOP + 0.005, 0.0)
    c = np.array([A_TOP - 0.050, float(canopy(A_TOP - 0.050, 0.0)[1]) - 0.070, -0.06])
    m += strut(tuple(top + [0, -0.004, 0]), tuple(c + [0.010, 0.018, 0]), 0.006, 0.006, n=seg(8, q, 5),
               mat='int:chrome', samples=3)
    yaw = rot((0, 1, 0), math.radians(-8))       # turned a little toward the driver
    body = blob((0.0, 0.0, 0.0), (0.016, 0.034, 0.112), n=seg(20, q, 8), rings=seg(8, q, 4), e1=0.45, e2=0.45,
                mat='int:black')
    glass = slab(rounded_rect(0.028, 0.104, 0.014, seg(4, q, 2)), 0.003, axis=0, centre=-0.0165, mat='mirror',
                 steps=1)
    for part in (body, glass):
        m += placed(part, yaw, c)
    return m


def door_cards(q):
    """Door trim on the tub walls: leather panel with an armrest, chrome pull and release, a
    window winder and a stitched upper roll under the belt (both sides)."""
    m = Mesh()
    for s in (-1, 1):
        ci = float(ci_c(0.10))
        z = s * (ci - 0.010)
        m += blob((0.05, 0.610, z - s * 0.020), (0.240, 0.024, 0.030), n=seg(14, q, 6), rings=seg(6, q, 4),
                  e1=0.4, e2=0.4, mat='int:leather')
        # upper roll along the belt
        pts = [(x, float(crown(x, ci)) - 0.040, z) for x in np.linspace(-0.36, 0.55, 6)]
        m += tube(pts, 0.022, n=seg(10, q, 6), mat='int:dash', samples=seg(10, q, 4))
        # window winder
        hub = np.array([-0.05, 0.700, z - s * 0.014])
        m += strut(tuple(hub), tuple(hub + [0.0, -0.065, -s * 0.006]), 0.005, 0.005, n=seg(6, q, 4),
                   mat='int:chrome', samples=2)
        m += strut(tuple(hub + [0.0, -0.065, -s * 0.006]), tuple(hub + [0.0, -0.065, -s * 0.040]), 0.008, 0.008,
                   n=seg(8, q, 5), mat='int:black', samples=2)
        # chrome release lever
        m += strut((0.32, 0.760, z - s * 0.006), (0.25, 0.760, z - s * 0.014), 0.005, 0.009, n=seg(8, q, 5),
                   mat='int:chrome', samples=3)
        # map pocket
        m += blob((0.10, 0.420, z - s * 0.020), (0.200, 0.040, 0.016), n=seg(12, q, 6), rings=seg(6, q, 3),
                  e1=0.35, e2=0.35, mat='int:carpet')
    return m


def pillar_trims(q):
    """Inside of the greenhouse: headliner, A-pillar and sail trims, sun visors, under the
    painted panels so no paint shows from the cabin."""
    m = Mesh()
    m += panel((C_TOP + 0.02, A_TOP + 0.05), (-0.625, 0.625), seg(26, q, 6), seg(16, q, 4), 0.006, 'int:headliner',
               inset=0.026)
    for s in (-1, 1):
        m += panel((A_TOP - 0.02, A_BASE), lambda x: (t_apillar(x) - 0.026, np.minimum(1.03, t_apillar(x) + 0.046)),
                   seg(22, q, 5), seg(4, q, 2), 0.008, 'int:headliner', inset=0.024, side=s)
        m += panel((GH_X[0] + 0.03, C_TOP + 0.03),
                   lambda x: (RW[2] - 0.020, np.where(x > C_BASE, np.clip(t_cline(x) + 0.030, 0.60, 1.06), 1.06)),
                   seg(18, q, 4), seg(8, q, 3), 0.008, 'int:headliner', inset=0.026, side=s)
        m += panel((B_X - 0.022, B_X + 0.016), (0.585, 1.0), 2, seg(8, q, 3), 0.008, 'int:headliner', inset=0.020,
                   side=s)
        # sun visor folded up against the headliner
        c = canopy(A_TOP - 0.075, s * 0.30)
        m += blob(c + [0, -0.034, 0], (0.075, 0.010, 0.165), n=seg(16, q, 6), rings=seg(6, q, 3), e1=0.35, e2=0.35,
                  mat='int:headliner', R=rot((0, 0, 1), math.radians(-28)))
    return m


def cockpit_shell(q):
    m = Mesh()
    m += dash_body(q)
    m += _fascia(q)
    m += gauges(q)
    m += binnacle(q)
    for z in (DRIVER_Z, -DRIVER_Z):
        m += seat(q, z)
    m += seat(q, 0.0, x0=-1.06, front=False).transform(s=(1, 1, 1.55))
    m += console(q)
    m += strut(tuple(np.array(WHEEL_CENTRE) + [0.06, -0.03, 0]), (0.45, 0.80, DRIVER_Z), 0.022, 0.022,
               n=seg(12, q, 6), mat='int:black', samples=3)
    m += _shelf(q)
    m += door_cards(q)
    m += pillar_trims(q)
    m += rear_view_mirror(q)
    return m


GLOW_C = np.array([0.36, 0.86, DRIVER_Z * 0.6])   # where the instrument light seems to come from


def glow(group, lod, P, N, valid):
    """Night light for the cockpit atlas (emissive map = albedo x gain, see build_car): a soft
    ambient over the whole cabin (dark trims lifted to a floor so the pillars and the headliner
    read against the night) and a warm pool of instrument light over the fascia, the wheel and
    the hands. Daylight hides it (it is a few percent of the day's light)."""
    if lod != 'cockpit' or group != 'Cockpit':
        return None
    d = P - GLOW_C
    r = np.linalg.norm(d, axis=-1)
    facing = np.clip(np.sum(N * -d / np.maximum(r, 1e-6)[..., None], -1) * 0.6 + 0.4, 0, 1)
    pool = 0.55 * facing / (1.0 + (r / 0.22) ** 2)
    gain = (0.10 + pool) * valid
    return gain.astype(np.float32), 0.10


def cockpit(q=1.0):
    """Cockpit-view parts (separate file): steering wheel and gloved hands (wheel frame), the
    cabin shell, the cabin's own clear glass and the two door windows (car frame; the windows
    use the same open offsets as the outside car, META['windows'])."""
    return {
        'steering_wheel': steering_wheel(q),
        'hands': hands(q),
        'cockpit_shell': cockpit_shell(q),
        'cabin_glass': glass_panels(q, 'glass:clear'),
        'window_L': door_glass(q, -1, 'glass:clear'),
        'window_R': door_glass(q, 1, 'glass:clear'),
    }


# ---------------------------------------------------------------------------------------------
# Livery: panel gaps on the paint (shade, so any player paint stays clean), lettering on the
# boot plate and the nose roundel (Body)
# ---------------------------------------------------------------------------------------------

DOOR_X = (0.625, -0.415)


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
        sill = yb + 0.115
        belt = np.vectorize(lambda v: float(crown(v, gb_c(np.clip(v, GH_X[0], GH_X[1])))))(x)
        in_door = (x < DOOR_X[0] + 0.004) & (x > DOOR_X[1] - 0.004)
        # door: front and rear shut lines from the sill up to the belt, bottom edge over the sill
        for xd in DOOR_X:
            g = np.maximum(g, lv.line(x - xd, W) * side * (y > sill - 0.005) * (y < belt + 0.01))
        g = np.maximum(g, lv.line(y - sill, W) * side * in_door * (az > 0.6))
        # bonnet: scuttle line ahead of the windscreen, sides along the wing tops, a front edge
        # behind the grille's crown
        bon = (x > 0.70) & (x < fx(2.06))
        g = np.maximum(g, lv.line(x - 0.715, W) * top * (az < 0.625))
        g = np.maximum(g, lv.line(az - 0.625, W) * top * bon)
        g = np.maximum(g, lv.line(x - fx(2.06), W) * valid * (az < 0.625) * (y > 0.60))
        # boot lid
        boot = (x < -1.60) & (x > fx(-2.16))
        g = np.maximum(g, lv.line(x + 1.60, W) * top * (az < 0.56))
        g = np.maximum(g, lv.line(az - 0.56, W) * valid * boot * (y > 0.72))
        g = np.maximum(g, lv.line(x - fx(-2.16), W) * valid * (az < 0.56) * (y > 0.72))
        # fuel filler ring
        d = np.sqrt((x + 1.72) ** 2 + (z + 0.700) ** 2 * 0.6)
        g = np.maximum(g, lv.line(d - 0.056, W) * valid)
        return {'shade': 1.0 - 0.62 * np.clip(g, 0, 1)}
    if group == 'Body':
        layers = []
        # boot plate: the car's name in black enamel on the chrome
        x0 = -2.02
        y0 = float(crown(x0, 0.0))
        X0 = fx(x0)
        e = 0.004
        nrm = norm(np.array([float(crown(x0 - e, 0) - crown(x0 + e, 0)), 2 * e, 0.0]))
        up = norm(np.cross(nrm, (0, 0, 1)))
        au = lv.text_mask('AURELIA', oblique=False)
        layers.append((lv.stamp(P, N, valid, au, (X0, y0, 0.0), (0, 0, 1), -up, 0.27, facing=nrm, min_dot=0.5,
                                depth=0.012), (0.012, 0.012, 0.014), 0.3))
        # nose roundel: deep blue enamel with the game's initials in silver
        pb, nb = nose_hit(BADGE_Y, 0.0)
        XB = fx(pb[0] + nb[0] * 0.007)
        YB = pb[1] + nb[1] * 0.007
        rel = P - np.array([XB, YB, 0.0])
        disc = valid & (np.linalg.norm(rel, axis=-1) < 0.025) & ((N @ nb) > 0.6)
        layers.append((disc * 1.0, (0.010, 0.030, 0.120), 0.15))
        ao = lv.text_mask('AO', oblique=False)
        upb = norm(np.cross(nb, (0, 0, 1)))
        layers.append((lv.stamp(P, N, valid, ao, (XB, YB, 0.0), (0, 0, 1), -upb, 0.032, facing=nb, min_dot=0.6,
                                depth=0.012) * disc, (0.80, 0.80, 0.82), 0.12))
        return {'layers': layers}
    return {}


# ---------------------------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------------------------

def build(q):
    """{node: Mesh}: body, glass, window_L / window_R, interior, exhaust, lamp lenses, driver,
    steering_wheel in the car frame (steering_wheel in its own frame); tyres, rims, uprights in
    their wheel frame."""
    body = body_shell(q) + greenhouse(q) + window_trims(q) + grille(q)
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
    body += indicators(q) + nose_badge(q) + bumpers(q) + boot_plate(q)
    body += wing_vents(q) + door_handles(q) + door_mirrors(q) + sills(q) + fuel_filler(q) + wipers(q)
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


OVERHANG = 1.95                 # overhangs beyond this |x| are fitted to the catalog length


def fit_overhangs(parts):
    """Fits the bumpers' and tailpipes' reach to exactly NOSE / TAIL (the game scales the car to
    its catalog length from the bounding box and centres it on it, so the box must be 4.60 m and
    centred for the wheels to land on the physics axles): x beyond +-OVERHANG is scaled per end."""
    xs = np.concatenate([m.V[:, 0] for m in parts.values() if len(m.V)])
    kf = (NOSE - OVERHANG) / (xs.max() - OVERHANG)
    kr = (TAIL + OVERHANG) / (xs.min() + OVERHANG)
    for m in parts.values():
        x = m.V[:, 0]
        x = np.where(x > OVERHANG, OVERHANG + (x - OVERHANG) * kf, x)
        m.V[:, 0] = np.where(x < -OVERHANG, -OVERHANG + (x + OVERHANG) * kr, x)
    _FIT.update(kf=kf, kr=kr)


_FIT = {}


def fx(x):
    """Where a design x ends up after fit_overhangs (for the livery's stamp centres)."""
    if not _FIT:
        build(1.0)
    if x > OVERHANG:
        return OVERHANG + (x - OVERHANG) * _FIT['kf']
    if x < -OVERHANG:
        return -OVERHANG + (x + OVERHANG) * _FIT['kr']
    return x


def wheel_layout():
    return [
        ('FL', 'front', (XF, RF, -TF), True), ('FR', 'front', (XF, RF, TF), False),
        ('RL', 'rear', (XR, RR, -TR), True), ('RR', 'rear', (XR, RR, TR), False),
    ]


def _pose(M):
    R = M[:3, :3]
    w = math.sqrt(max(0.0, 1 + R[0, 0] + R[1, 1] + R[2, 2])) / 2
    qx = (R[2, 1] - R[1, 2]) / (4 * w)
    qy = (R[0, 2] - R[2, 0]) / (4 * w)
    qz = (R[1, 0] - R[0, 1]) / (4 * w)
    return {'closed': {'position': [0.0, 0.0, 0.0], 'quaternion': [0.0, 0.0, 0.0, 1.0]},
            'open': {'position': [round(float(v), 4) for v in M[:3, 3]],
                     'quaternion': [round(float(v), 5) for v in (qx, qy, qz, w)]}}


META = {
    'id': ID, 'length': LENGTH, 'wheelbase': XF - XR,
    'axles': {'front': XF, 'rear': XR},
    'wheelRadius': {'front': RF, 'rear': RR},
    'halfTrack': {'front': TF, 'rear': TR},
    'tyreWidth': {'front': WF, 'rear': WR},
    'eye': list(EYE),
    'steeringWheel': {'centre': list(WHEEL_CENTRE), 'axis': 'local +x (column, toward the nose)', 'tiltDeg': 28},
    'windows': {
        'window_L': _pose(window_open(-1)),
        'window_R': _pose(window_open(1)),
        'note': 'open pose of the node in the car frame (closed = identity): position (m) and '
                'quaternion (x, y, z, w); the glass stands up about the belt line and drops into the door',
    },
    'hideInCockpit': ['interior', 'driver', 'steering_wheel', 'glass', 'window_L', 'window_R'],
    'cockpitFx': {'speedLines': False, 'particleNearFade': 2.8,
                  'note': 'in the driver view no nitro streaks, smoke or sparks within ~2.8 m of the eye'},
    'cockpitGlow': 'material Cockpit carries a baked emissive night-light map (instrument glow, soft ambient); '
                   'Gauges glow warm white',
    'mirrorGlass': 'material MirrorGlass, uv 0..1 per glass (u along z, v up)',
    'factoryPaint': list(FACTORY_PAINT),
}
