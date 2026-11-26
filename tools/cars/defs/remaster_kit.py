"""Shared assembly for the remastered cars (batch 3): the original hyper3d body, processed by
tools/cars/remaster/ (prep -> classify -> paintshade -> lods), plus our own wheels, brakes,
exhaust, cabin, driver, steering wheel, hands and cockpit file from the car's scripted design.

A remaster design file runs its scripted parent (inherit) for the machinery and dimensions, then:

    import remaster_kit as rk
    rk.setup(globals(), 'rp1_vanta')         # source paths, factory colour, no scripted livery
    def build(q): return rk.build(globals(), q)
    def cockpit(q=1.0): return rk.cockpit(globals(), q)
    META = rk.meta(globals())

The body keeps the source's surfaces exactly (decimated only: see lods.py and the deviation
json); the paint, trim, glass, lamp and arch-cap faces carry design keys:
    paint:src   CarPaint, shaded by the source paint's own panel gaps (SRC_SHADE)
    src:trim    Body atlas baked from the source texture (grilles, black trim, lamp housings)
    body:well   the closed wheel-arch walls, int:skin the shell's inside, glass / lenses.
"""

import math
import os

import numpy as np

from meshkit import Mesh, revolve

HERE = os.path.dirname(os.path.abspath(__file__))
RM = os.path.join(HERE, '..', 'build', 'remaster')


def lod_of(q):
    return 'showroom' if q >= 0.9 else 'drive' if q >= 0.2 else 'race'


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


_CACHE = {}


def parts(src, lod):
    """{part: Mesh} of one LOD (game frame, design keys, source UVs on the body)."""
    key = (src, lod)
    if key in _CACHE:
        return {k: m.copy() for k, m in _CACHE[key].items()}
    d = np.load(os.path.join(RM, src, f'{src}_{lod}.npz'))
    KEYS = [str(k) for k in d['KEYS']]
    out = {}
    for name in ('body', 'glass', 'window_L', 'window_R', 'headlight_lens', 'taillight_lens'):
        if f'{name}_V' not in d:
            continue
        V = d[f'{name}_V'].astype(np.float64)
        F = d[f'{name}_F'].tolist()
        K = d[f'{name}_K']
        mats = [KEYS[int(k)] for k in K]
        uv = d[f'{name}_UV'].tolist() if name == 'body' else None
        cn = d[f'{name}_N'].tolist() if f'{name}_N' in d else None
        out[name] = Mesh(V, F, mats, uv=uv, cn=cn)
    _CACHE[key] = out
    return {k: m.copy() for k, m in out.items()}


def setup(g, src):
    """Source texture paths and factory colour into the design's namespace; the scripted livery
    (panel lines drawn for the scripted body) is dropped: the source paint has its own."""
    B = os.path.join(RM, src)
    g['SRC'] = src
    g['SRC_TEX'] = os.path.join(B, f'{src}_src.png')
    g['SRC_SHADE'] = os.path.join(B, f'{src}_shade.png')
    fac = np.load(os.path.join(B, f'{src}_cls.npz'))['factory']
    lin = srgb_to_lin(fac)
    # the source texture has its lighting baked in; a paint albedo above ~0.78 reads as
    # blown-out white under the game's lights
    lin = lin * min(1.0, 0.78 / max(float(lin.max()), 1e-6))
    g['FACTORY_PAINT'] = tuple(round(float(v), 4) for v in lin)
    if 'livery' in g:
        del g['livery']
    g['LIVERY_GROUPS'] = ()


# ---------------------------------------------------------------------------------------------
# Ray casts on the source body (fitting the exhaust and checking the cabin)
# ---------------------------------------------------------------------------------------------

def ray_hits(V, F, o, d):
    """All hit distances of one ray against a triangle soup (Moeller-Trumbore, numpy)."""
    F = np.asarray(F)
    A, Bv, C = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    e1, e2 = Bv - A, C - A
    p = np.cross(d, e2)
    det = (e1 * p).sum(1)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
    s = o - A
    u = (s * p).sum(1) * inv
    qv = np.cross(s, e1)
    v = (qv * d).sum(1) * inv
    t = (e2 * qv).sum(1) * inv
    hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0)
    return np.sort(t[hit])


def rear_x(body, y, z):
    """x of the body's rearmost surface at height y, lateral z (ray from behind)."""
    o = np.array([-4.0, y, z])
    t = ray_hits(body.V, body.F, o, np.array([1.0, 0, 0]))
    return -4.0 + t[0] if len(t) else None


def tailpipes(g, q, body):
    """Round tailpipes at the design's EXHAUST spots (y, z, radius), their tips just proud of
    the source's rear valance."""
    m = Mesh()
    n = g['seg'](20, q, 8)
    for y, z, r in g['EXHAUST']:
        x = rear_x(body, y, z)
        x = (x if x is not None else -2.0) + g.get('EXHAUST_PROUD', 0.012)
        pipe = revolve([(r * 0.88, 0.0), (r * 0.96, -0.14), (r, -0.15), (r, -0.16), (r * 0.80, -0.16),
                        (r * 0.78, -0.01)], n, mat='body:steel', axis='x', closed_profile=True)
        pipe.transform(t=(x + 0.16, y, z))
        m += pipe
        if q >= 0.2:
            soot = revolve([(0.0, -0.152), (r * 0.79, -0.152), (r * 0.79, -0.148), (0.0, -0.148)], n,
                           mat='body:inlet', axis='x')
            soot.transform(t=(x + 0.16, y, z))
            m += soot
    return m


# ---------------------------------------------------------------------------------------------
# Door windows: open pose from the source pane
# ---------------------------------------------------------------------------------------------

def window_open(g, s):
    """Open pose (4x4, car frame) of the source door pane on side s: it turns about its bottom
    edge until upright (the pane leans in with the tumblehome), then drops straight down by its
    height plus 25 mm, so its top edge ends up under the belt inside the door."""
    P = parts(g['SRC'], 'showroom')['window_L' if s < 0 else 'window_R'].V
    zs = np.abs(P[:, 2])
    y0, y1 = P[:, 1].min(), P[:, 1].max()
    bot = P[P[:, 1] < y0 + 0.03]
    top = P[P[:, 1] > y1 - 0.03]
    pb = np.array([bot[:, 0].mean(), y0, bot[:, 2].mean()])
    pt = np.array([top[:, 0].mean(), y1, top[:, 2].mean()])
    d = pt - pb
    th = math.atan2(-d[2], d[1])
    c, sn = math.cos(th), math.sin(th)
    R = np.array([[1, 0, 0], [0, c, -sn], [0, sn, c]])
    drop = float(np.linalg.norm(d[1:])) + 0.025
    M = np.eye(4)
    M[:3, :3] = R
    # pivot at the bottom edge, 6 mm inboard so the pane drops inside the door skin
    pv = pb + np.array([0.0, 0.0, -s * 0.006])
    M[:3, 3] = pv - R @ pv + np.array([0.0, -drop, 0.0]) + np.array([0.0, 0.0, -s * 0.006])
    return M


def meta(g):
    m = g['make_meta']()
    m['windows']['window_L'] = g['_pose'](window_open(g, -1))
    m['windows']['window_R'] = g['_pose'](window_open(g, 1))
    m['windows']['note'] = ('open pose of the node in the car frame (closed = identity): position (m) and '
                            'quaternion (x, y, z, w); the source pane stands up about its bottom edge and drops '
                            'into the door')
    m['factoryPaint'] = list(g['FACTORY_PAINT'])
    m['source'] = 'original hyper3d model (New Car.zip), remastered: tools/cars/remaster'
    return m


# ---------------------------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------------------------

def build(g, q):
    P = parts(g['SRC'], lod_of(q))
    body = P['body']
    out = {
        'body': body,
        'glass': P['glass'],
        'exhaust': tailpipes(g, q, body),
        'headlight_lens': P['headlight_lens'],
        'taillight_lens': P['taillight_lens'],
        'window_L': P['window_L'],
        'window_R': P['window_R'],
        'interior': cabin(g, q),
        'driver': g['driver'](q),
        'steering_wheel': g['steering_wheel'](q),
    }
    for axle, R, W in (('front', g['RF'], g['WF']), ('rear', g['RR'], g['WR'])):
        out[f'tyre_{axle}'] = g['tyre'](R, W, q)
        out[f'rim_{axle}'] = g['rim'](W, q)
        out[f'upright_{axle}'] = g['upright'](axle == 'front', q)
    return out


def cabin(g, q):
    """The scripted car's cabin pieces that sit inside any shell (dash, fascia, gauges / screens,
    seats, console, steering column), without the pieces drawn for the scripted body (headliner
    panel, door cards, pillar trims, parcel shelf, cargo floor): the source shell's dark inner
    skin is the headliner and the door cards here, and a glass roof stays see-through."""
    from meshkit import strut
    m = Mesh()
    try:
        m += g['dash_body'](q, half=g.get('DASH_HALF', 0.80))
    except TypeError:
        m += g['dash_body'](q)
    m += g['_fascia'](q)
    if q >= 0.6:
        m += g['gauges'](q)
        if 'binnacle' in g:
            m += g['binnacle'](q)
    seat = g.get('_seat', g.get('seat'))
    Z = g['DRIVER_Z']
    for z in (Z, -Z):
        m += seat(q, z)
    m += seat(q, 0.0, x0=g.get('REAR_SEAT_X', -1.08), front=False).transform(s=(1, 1, 1.6)) \
        if g.get('REAR_SEAT', True) else Mesh()
    if q < 0.1:
        return m
    m += g['console'](q)
    m += strut(tuple(np.array(g['WHEEL_CENTRE']) + [0.06, -0.03, 0]),
               (0.45, 0.80 + g.get('KDY', 0.0), Z), 0.024, 0.024, n=g['seg'](10, q, 6), mat='int:black', samples=3)
    return m


def rear_mirror(g, q):
    """The scripted interior mirror (MirrorGlass, the game's live mirror), moved to hang 10 cm
    under the source roof's header at the same station."""
    m = g['rear_view_mirror'](q)
    if not len(m.V):
        return m
    gl = [i for i, k in enumerate(m.mats) if k == 'mirror']
    c_old = m.V[sorted({v for i in gl for v in m.F[i]})].mean(0) if gl else m.V.mean(0)
    P = parts(g['SRC'], 'showroom')
    shell = P['body'] + P['glass']
    t = ray_hits(shell.V, shell.F, np.array([c_old[0], 0.9, -0.05]), np.array([0.0, 1.0, 0.0]))
    if not len(t):
        return m
    roof = 0.9 + t[-1] if len(t) == 1 else 0.9 + t[0]
    # the first surface above the cabin floor is the roof's inside (or the glass roof)
    dy = (roof - 0.100) - c_old[1]
    top = m.V[:, 1].max()
    m.V[:, 1] += dy
    # the stalk reaches the roof: stretch its upper end
    hi = m.V[:, 1] > top + dy - 0.03
    m.V[hi, 1] += min(0.0, roof - 0.004 - (top + dy))
    return m


def inside_report(g, mesh, name):
    """Share of a part's vertices that stick out of the source shell (ray parity, vertical rays)."""
    P = parts(g['SRC'], 'showroom')
    body = P['body']
    keep = [i for i, k in enumerate(body.mats) if k != 'int:skin']
    # the outer shell with its glass (outer faces of each pane: the first third of a slab)
    shell = Mesh(body.V, [body.F[i] for i in keep], ['b'] * len(keep))
    for k in ('glass', 'window_L', 'window_R'):
        gl = P[k]
        nf = len(gl.F)
        n_out = next(i for i in range(nf) if i > 0 and gl.F[i][0] >= len(gl.V) // 2) if nf else 0
        shell += Mesh(gl.V, gl.F[:n_out], ['g'] * n_out)
    body = shell
    Fb = np.array(body.F)
    V = mesh.V
    idx = np.linspace(0, len(V) - 1, min(400, len(V))).astype(int)
    out = 0
    for i in idx:
        t = ray_hits(body.V, Fb, V[i], np.array([0.0, 1.0, 0.0]))
        if len(t) % 2 == 0:
            out += 1
    print(f'  {name}: {out}/{len(idx)} sampled vertices outside the source shell')
    return out / len(idx)


def cockpit(g, q=1.0):
    """Cockpit file: wheel, hands, the cabin trim (dash, binnacle / screens, console, seats, door
    cards, rear-view mirror) under the source roof; the cabin glass and door panes are the
    source's own window shapes in clear glass. The outside body (with its dark inner skin for
    the pillars and headliner) stays visible in the driver's view."""
    P = parts(g['SRC'], 'showroom')
    for k in ('glass', 'window_L', 'window_R'):
        P[k].mats = ['glass:clear'] * len(P[k].F)
    shell = cabin(g, q) + rear_mirror(g, q)
    return {
        'steering_wheel': g['steering_wheel'](q),
        'hands': g['hands'](q),
        'cockpit_shell': shell,
        'cabin_glass': P['glass'],
        'window_L': P['window_L'],
        'window_R': P['window_R'],
    }
