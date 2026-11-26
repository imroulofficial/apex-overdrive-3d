"""Apex Overdrive car pipeline: builds one car from its design file in tools/cars/defs/, bakes its
textures in Blender (Cycles) and exports one glTF per level of detail for tools/cars/pack.mjs.

    python tools/cars/build_car.py --car tm_tempesta [--lods showroom,drive,race,cockpit]
                                   [--samples 48] [--no-bake]
    blender -b -P tools/cars/build_car.py -- [same options]

Needs Blender's Python module (pip install bpy==5.2.4, Python 3.13) or Blender itself. Everything is
generated from code: no .blend file and no downloaded asset. Outputs go to tools/cars/build/<car>/
(ignored by git):

    <file>_<lod>.glb                 geometry, node tree, material names (no textures)
    <file>_<lod>_<Group>_base.png    baked albedo (drive: AO multiplied in)
    <file>_<lod>_<Group>_orm.png     R ambient occlusion, G roughness, B metalness (showroom)
    <file>_<lod>_<Group>_normal.png  tangent-space normal
    <file>_<lod>.json                materials, texture files, node list for pack.mjs

The race (rival) LOD has no textures: albedo x AO is baked into vertex colours (COLOR_0), which
the game's rival batcher multiplies into its shared atlas material (src/race/raceCars.js).

Frames. Design files work in the game frame: metres, x forward (nose +X), y up, z to the car's
right, ground at y = 0. Blender is z-up, so vertices go through B: (x, y, z) -> (x, -z, y); the
glTF exporter (+Y up) turns that back into (x, y, z).

Node tree written to every LOD (same names in all of them):

    <file>                    root, extras.apex = the design's META (axles, radii, eye point...)
      body                    chassis, wings, floor, halo, mirrors, suspension (CarPaint, Body)
        exhaust               nitro flames come out of its rear face
        headlight_lens        headlight_lens material
        taillight_lens        rain lights (taillight_lens material)
      wheel_FL/FR/RL/RR       empty, origin exactly on the wheel axis; spins
        tyre_XX, rim_XX       shared mesh per axle (left = right turned 180 degrees about y)
      upright_XX              origin on the wheel axis; steers (front), never spins
        caliper_XX, brake_disc_XX
      steering_wheel          origin on the column axis at the wheel centre, local +x = column
      driver                  helmet, visor, suit, gloves (hidden in the cockpit view)
"""

import argparse
import importlib
import json
import math
import os
import sys
import time

import numpy as np

import bpy
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(HERE, 'defs')]

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument('--car', default='tm_tempesta')
ap.add_argument('--out', default=None)
ap.add_argument('--lods', default='showroom,drive,race,cockpit')
ap.add_argument('--samples', type=int, default=48, help='Cycles samples for the AO bakes')
ap.add_argument('--scale', type=float, default=1.0, help='texture size multiplier (0.5 for quick tests)')
ap.add_argument('--no-bake', action='store_true')
args = ap.parse_args(argv)

car = importlib.import_module(args.car)
OUT = args.out or os.path.join(HERE, 'build', car.FILE)
os.makedirs(OUT, exist_ok=True)

# Detail level and texture sizes per LOD (contract: PHASE0-AUDIT section 2.5).
LODS = {
    'showroom': dict(q=1.0, tex={'Body': 2048, 'CarPaint': 1024, 'Carbon': 1024, 'Tyre': 1024, 'Rim': 512, 'Driver': 512},
                     orm={'Body', 'Carbon', 'Tyre', 'Rim', 'Driver'}),
    'drive': dict(q=0.43, tex={'Body': 1024, 'CarPaint': 512, 'Carbon': 512, 'Tyre': 512, 'Rim': 256, 'Driver': 256},
                  orm={'Carbon'}),
    'race': dict(q=0.075, tex=None, orm=set()),
    'cockpit': dict(q=1.0, tex={'Cockpit': 1024, 'Carbon': 512}, orm={'Cockpit', 'Carbon'}),
}
# A design may add atlases or change sizes per LOD (e.g. a closed car's Interior), as
# TEX = {lod: {group: size}} and ORM = {lod: {group, ...}}.
for _lod, _t in getattr(car, 'TEX', {}).items():
    LODS[_lod]['tex'] = {**(LODS[_lod]['tex'] or {}), **_t}
for _lod, _o in getattr(car, 'ORM', {}).items():
    LODS[_lod]['orm'] = set(LODS[_lod]['orm']) | set(_o)
# Carbon fibre is not baked into an atlas: a tiling 2x2 twill (albedo + normal) on a second UV
# set in metres (TEXCOORD_1, box-projected per face), with the baked AO / roughness on UV 0.
WEAVE_TILE = 0.024   # metres per texture repeat (two twill periods of four 3 mm tows)
SUFFIX = {'showroom': '', 'drive': '_drive', 'race': '_race', 'cockpit': '_cockpit'}

B3 = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)  # game -> Blender


def to_blender(M):
    B4 = np.eye(4)
    B4[:3, :3] = B3
    return Matrix((B4 @ M @ B4.T).tolist())


def mat4(R=None, t=(0, 0, 0)):
    M = np.eye(4)
    if R is not None:
        M[:3, :3] = R
    M[:3, 3] = t
    return M


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


# ---------------------------------------------------------------------------------------------
# Materials: design keys -> glTF material groups
# ---------------------------------------------------------------------------------------------

def group_of(key, lod):
    head = key.split(':')[0]
    if key == 'glass:clear':
        return 'ClearGlass'
    if key == 'int:gauge':
        return 'Gauges'
    if lod == 'cockpit':
        return {'glass': 'Glass', 'carbon': 'Carbon', 'mirror': 'MirrorGlass'}.get(head, 'Cockpit')
    return {'paint': 'CarPaint', 'carbon': 'Carbon', 'mirror': 'MirrorGlass', 'body': 'Body', 'tyre': 'Tyre',
            'rim': 'Rim', 'driver': 'Driver', 'glass': 'Glass', 'int': 'Interior', 'src': 'Body'}.get(head, key)


BAKED = {'Body', 'Tyre', 'Rim', 'Driver', 'Cockpit', 'Carbon', 'Interior'}  # race LOD: vertex colours

# Plain export materials (base colour linear RGBA, roughness, metalness, emissive).
PLAIN = {
    'CarPaint': ((0.62, 0.025, 0.02, 1), 0.3, 0.0, None),
    'MirrorGlass': ((0.62, 0.64, 0.68, 1), 0.03, 1.0, None),
    'Carbon': ((1, 1, 1, 1), 0.3, 0.0, None),
    'Glass': getattr(car, 'GLASS', ((0.03, 0.03, 0.035, 0.72), 0.05, 0.3, None)),
    # lamp covers and the cockpit's own windows: nearly clear
    'ClearGlass': getattr(car, 'CLEAR_GLASS', ((0.80, 0.84, 0.86, 0.14), 0.02, 0.0, None)),
    'headlight_lens': ((0.85, 0.88, 0.92, 1), 0.1, 0.0, (0.0, 0.0, 0.0)),
    'taillight_lens': ((0.30, 0.01, 0.01, 1), 0.15, 0.0, (0.25, 0.0, 0.0)),
    'exhaust': ((0.55, 0.47, 0.38, 1), 0.35, 1.0, None),
    # race LOD flat materials: COLOR_0 carries albedo x AO, the factor stays white
    'Body': ((1, 1, 1, 1), 0.45, 0.15, None),
    'Tyre': ((1, 1, 1, 1), 0.85, 0.0, None),
    'Rim': ((1, 1, 1, 1), 0.35, 0.7, None),
    'Driver': ((1, 1, 1, 1), 0.6, 0.0, None),
    'Interior': ((1, 1, 1, 1), 0.7, 0.0, None),
    'Gauges': ((1, 1, 1, 1), 0.3, 0.0, None),
}


class Kit:
    def __init__(self, mat):
        self.nt = mat.node_tree
        self.n = self.nt.nodes
        self.l = self.nt.links

    def node(self, kind, **props):
        nd = self.n.new(kind)
        for k, v in props.items():
            setattr(nd, k, v)
        return nd

    def feed(self, sock, val):
        if isinstance(val, (int, float)):
            sock.default_value = val
        elif isinstance(val, tuple):
            sock.default_value = val if len(sock.default_value) == len(val) else (*val, 1.0)
        else:
            self.l.new(val, sock)

    def math(self, op, a, b=0.0, clamp=False):
        nd = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.feed(nd.inputs[0], a)
        self.feed(nd.inputs[1], b)
        return nd.outputs[0]

    def mix(self, fac, a, b):
        nd = self.node('ShaderNodeMix', data_type='RGBA')
        self.feed(nd.inputs['Factor'], fac)
        self.feed(nd.inputs[6], a)
        self.feed(nd.inputs[7], b)
        return nd.outputs[2]

    def mixf(self, fac, a, b):
        nd = self.node('ShaderNodeMix', data_type='FLOAT')
        self.feed(nd.inputs['Factor'], fac)
        self.feed(nd.inputs[2], a)
        self.feed(nd.inputs[3], b)
        return nd.outputs[0]

    def obj(self):
        tc = self.node('ShaderNodeTexCoord')
        sep = self.node('ShaderNodeSeparateXYZ')
        self.l.new(tc.outputs['Object'], sep.inputs[0])
        return tc.outputs['Object'], sep.outputs[0], sep.outputs[1], sep.outputs[2]

    def noise(self, vec, scale, detail=2.0, rough=0.5):
        nd = self.node('ShaderNodeTexNoise')
        self.l.new(vec, nd.inputs['Vector'])
        nd.inputs['Scale'].default_value = scale
        nd.inputs['Detail'].default_value = detail
        nd.inputs['Roughness'].default_value = rough
        return nd.outputs['Fac']

    def smooth(self, e0, e1, x):
        nd = self.node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        self.feed(nd.inputs['Value'], x)
        nd.inputs['From Min'].default_value = e0
        nd.inputs['From Max'].default_value = e1
        return nd.outputs['Result']

    def image(self, img, vec):
        nd = self.node('ShaderNodeTexImage')
        nd.image = img
        nd.extension = 'CLIP'
        self.l.new(vec, nd.inputs['Vector'])
        return nd


def srgb(c):
    c = np.asarray(c, dtype=np.float64)
    return tuple(np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4))


TEX_IMAGES = {}


def src_image(path, data=False):
    key = ('src', path)
    if key not in TEX_IMAGES:
        img = bpy.data.images.load(path)
        img.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
        TEX_IMAGES[key] = img
    return TEX_IMAGES[key]


def src_uv(k):
    nd = k.node('ShaderNodeUVMap')
    nd.uv_map = 'src'
    return nd.outputs['UV']


def text_strip():
    """Sidewall lettering strip (generic: the game's own name and the car's), white on black."""
    if 'strip' in TEX_IMAGES:
        return TEX_IMAGES['strip']
    from PIL import Image, ImageDraw, ImageFont
    W, H = 4096, 160
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    ttf = None
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
              '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'):
        if os.path.exists(f):
            ttf = f
            break
    words = getattr(car, 'TYRE_WORDS', ['APEX OVERDRIVE', 'TEMPESTA', 'APEX OVERDRIVE', 'TEMPESTA'])
    # every word centred in its own equal share of the strip (the strip wraps once round the
    # sidewall), the font shrunk if the longest word would not fit its share with a margin
    cell = W / len(words)
    size = 104
    while True:
        font = ImageFont.truetype(ttf, size) if ttf else ImageFont.load_default()
        widest = max(d.textbbox((0, 0), wd, font=font)[2] for wd in words)
        if widest <= cell - 160 or size <= 40 or not ttf:
            break
        size -= 4
    for i, wd in enumerate(words):
        bb = d.textbbox((0, 0), wd, font=font)
        d.text(((i + 0.5) * cell - (bb[2] - bb[0]) / 2 - bb[0], 22 + (104 - size) / 2), wd, fill=255, font=font)
    path = os.path.join(OUT, '_strip.png')
    im.save(path)
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    TEX_IMAGES['strip'] = img
    return img


def display_image():
    if 'display' in TEX_IMAGES:
        return TEX_IMAGES['display']
    from PIL import Image, ImageDraw, ImageFont
    W, H = 512, 360
    im = Image.new('RGB', (W, H), (6, 8, 12))
    d = ImageDraw.Draw(im)
    # rev-light strip along the top: green, red, blue
    for i in range(15):
        col = (30, 220, 70) if i < 5 else (235, 40, 30) if i < 10 else (60, 110, 255)
        d.rounded_rectangle((20 + i * 32, 8, 44 + i * 32, 40), 5, fill=col)
    try:
        fb = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 150)
        fs = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 40)
    except OSError:
        fb = fs = ImageFont.load_default()
    d.rounded_rectangle((180, 92, 332, 300), 12, outline=(80, 200, 255), width=5)
    d.text((205, 105), '4', fill=(240, 245, 255), font=fb)
    d.text((30, 110), '287', fill=(255, 210, 60), font=fs)
    d.text((30, 160), 'KPH', fill=(150, 160, 170), font=fs)
    d.text((360, 110), '+0.42', fill=(80, 230, 110), font=fs)
    d.text((360, 160), 'P3', fill=(240, 245, 255), font=fs)
    for k in range(5):
        d.rectangle((30 + k * 30, 250, 52 + k * 30, 300), fill=(255, 190 - k * 30, 40))
    d.rectangle((360, 250, 480, 300), fill=(20, 140, 255))
    path = os.path.join(OUT, '_display.png')
    im.save(path)
    img = bpy.data.images.load(path)
    TEX_IMAGES['display'] = img
    return img


MATS = {}


def make_key_material(key):
    """Procedural PBR material for a design key, with the nodes the bakes read:
    principled (albedo, roughness, normal via bump) and a 'metal' value for the EMIT pass."""
    if key in MATS:
        return MATS[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    k = Kit(m)
    k.n.clear()
    out = k.node('ShaderNodeOutputMaterial')
    bsdf = k.node('ShaderNodeBsdfPrincipled')
    k.l.new(bsdf.outputs[0], out.inputs[0])
    vec, ox, oy, oz = k.obj()
    col, rough, metal, height = (0.02, 0.02, 0.02), 0.5, 0.0, None
    coat = 0.0

    src_shade = None
    if key == 'paint:src':
        # remastered car: factory colour; its bake (BASE) is the source paint's shading layer
        col, rough, coat = tuple(getattr(car, 'FACTORY_PAINT', (0.62, 0.025, 0.02))), 0.3, 1.0
        src_shade = k.image(src_image(car.SRC_SHADE, data=True), src_uv(k)).outputs['Color']
    elif key.startswith('paint'):
        col, rough, coat = tuple(getattr(car, 'FACTORY_PAINT', (0.62, 0.025, 0.02))), 0.3, 1.0
    elif key.startswith('src:'):
        # remastered car: the original model's own texture (trim, grilles, lamps, badges)
        tx = k.image(src_image(car.SRC_TEX), src_uv(k))
        col = tx.outputs['Color']
        rough = getattr(car, 'SRC_ROUGH', 0.42)
    elif key == 'int:skin':
        # remastered car: the inside of the shell (headliner, door cards, floor seen through glass)
        n = k.noise(vec, 300.0, 3.0)
        col, rough = k.mix(n, srgb((0.030, 0.030, 0.032)), srgb((0.042, 0.042, 0.045))), 0.85
    elif key.startswith('carbon'):
        # 2x2 twill, 9 mm tows, with a glossy clear coat
        sx = k.math('MULTIPLY', ox, 1 / 0.009)
        sy = k.math('MULTIPLY', k.math('ADD', oy, oz), 1 / 0.009)
        tw = k.math('FRACT', k.math('MULTIPLY', k.math('ADD', k.math('FLOOR', sx), k.math('FLOOR', sy)), 0.25))
        weave = k.smooth(0.45, 0.55, tw)
        n = k.noise(vec, 40.0, 2.0)
        col = k.mix(weave, srgb((0.050, 0.051, 0.055)), srgb((0.085, 0.087, 0.093)))
        col = k.mix(k.math('MULTIPLY', n, 0.25), col, srgb((0.03, 0.03, 0.03)))
        rough = k.mixf(weave, 0.40, 0.50) if key == 'carbon:satin' else k.mixf(weave, 0.17, 0.24)
        height = k.math('MULTIPLY', weave, 0.3)
        coat = 0.0 if key == 'carbon:satin' else 1.0
    elif key == 'body:white':
        col, rough, coat = srgb((0.90, 0.90, 0.88)), 0.22, 1.0
    elif key == 'body:gloss':
        col, rough, coat = srgb((0.035, 0.036, 0.04)), 0.12, 1.0
    elif key == 'mirror':
        col, rough, metal = (0.62, 0.64, 0.68), 0.03, 1.0
    elif key == 'body:satin':
        n = k.noise(vec, 160.0, 3.0)
        col, rough = srgb((0.055, 0.056, 0.06)), k.mixf(n, 0.48, 0.62)
    elif key == 'body:metal':
        col, rough, metal = (0.55, 0.55, 0.56), 0.33, 1.0
    elif key == 'body:mirror':
        col, rough, metal = (0.92, 0.93, 0.95), 0.04, 1.0
    elif key == 'body:disc':
        # ventilated, cross-drilled disc (wheel frame, Blender local: axis along y)
        r = k.node('ShaderNodeVectorMath', operation='LENGTH')
        cxy = k.node('ShaderNodeCombineXYZ')
        k.feed(cxy.inputs[0], ox)
        k.feed(cxy.inputs[1], oz)
        k.l.new(cxy.outputs[0], r.inputs[0])
        rr = r.outputs['Value']
        az = k.node('ShaderNodeMath', operation='ARCTAN2')
        k.feed(az.inputs[0], oz)
        k.feed(az.inputs[1], ox)
        a = k.math('SUBTRACT', k.math('FRACT', k.math('MULTIPLY', az.outputs[0], 36 / math.tau)), 0.5)
        b = k.math('SUBTRACT', k.math('FRACT', k.math('MULTIPLY', k.math('SUBTRACT', rr, 0.092), 1 / 0.019)), 0.5)
        d = k.math('SQRT', k.math('ADD', k.math('MULTIPLY', a, a), k.math('MULTIPLY', b, b)))
        hole = k.math('MULTIPLY', k.smooth(0.27, 0.20, d), k.math('MULTIPLY', k.smooth(0.098, 0.104, rr),
                                                                     k.smooth(0.162, 0.156, rr)))
        n = k.noise(vec, 90.0, 4.0)
        col = k.mix(n, srgb((0.20, 0.20, 0.205)), srgb((0.34, 0.33, 0.32)))
        col = k.mix(hole, col, srgb((0.02, 0.02, 0.02)))
        rough = 0.6
        height = k.math('MULTIPLY', hole, -1.0)
    elif key == 'body:discp':
        # plain solid disc of a classic car: machined iron with fine concentric grind marks
        r = k.node('ShaderNodeVectorMath', operation='LENGTH')
        cxy = k.node('ShaderNodeCombineXYZ')
        k.feed(cxy.inputs[0], ox)
        k.feed(cxy.inputs[1], oz)
        k.l.new(cxy.outputs[0], r.inputs[0])
        g = k.math('FRACT', k.math('MULTIPLY', r.outputs['Value'], 1 / 0.0012))
        n = k.noise(vec, 90.0, 4.0)
        col = k.mix(k.math('ADD', k.math('MULTIPLY', g, 0.3), k.math('MULTIPLY', n, 0.5)),
                    srgb((0.30, 0.30, 0.31)), srgb((0.46, 0.46, 0.47)))
        rough, metal = k.mixf(g, 0.32, 0.42), 1.0
    elif key == 'body:caliper':
        col, rough, coat = srgb(getattr(car, 'CALIPER', (0.85, 0.08, 0.05))), 0.30, 1.0
    elif key == 'body:padding':
        n = k.noise(vec, 300.0, 4.0, 0.7)
        col = k.mix(n, srgb((0.07, 0.07, 0.075)), srgb((0.11, 0.11, 0.115)))
        rough = 0.92
        height = k.math('MULTIPLY', n, 0.2)
    elif key == 'body:inlet':
        col, rough = srgb((0.012, 0.012, 0.014)), 0.7
    elif key == 'body:display':
        # steering-wheel frame: z across, y up
        u = k.math('MULTIPLY', k.math('SUBTRACT', 0.045, oy), 1 / 0.090)
        v = k.math('MULTIPLY', k.math('ADD', oz, 0.020), 1 / 0.075)
        img = k.image(display_image(), k.node('ShaderNodeCombineXYZ').outputs[0])
        cmb = img.inputs['Vector'].links[0].from_node
        k.feed(cmb.inputs[0], u)
        k.feed(cmb.inputs[1], v)
        col, rough = img.outputs['Color'], 0.15
    elif key == 'tyre':
        # wheel frame (Blender local): axis along y, radial plane x-z. Sidewall band and lettering by radius, scrubbed tread.
        r = k.node('ShaderNodeVectorMath', operation='LENGTH')
        cxy = k.node('ShaderNodeCombineXYZ')
        k.feed(cxy.inputs[0], ox)
        k.feed(cxy.inputs[1], oz)
        k.l.new(cxy.outputs[0], r.inputs[0])
        rr = r.outputs['Value']
        az = k.node('ShaderNodeMath', operation='ARCTAN2')
        k.feed(az.inputs[0], oz)
        k.feed(az.inputs[1], ox)
        u = k.math('ADD', k.math('MULTIPLY', az.outputs[0], 1 / math.tau), 0.5)
        th = getattr(car, 'TYRE_HW', 0.20)          # half width of the narrower tyre
        side = k.smooth(0.50 * th, 0.85 * th, k.math('ABSOLUTE', oy))
        R0 = car.RIM_R
        b0 = getattr(car, 'TYRE_BAND', (0.075, 0.092))   # coloured sidewall ring (None: no ring)
        if b0:
            band = k.math('MULTIPLY', k.smooth(R0 + b0[0], R0 + b0[0] + 0.004, rr),
                          k.smooth(R0 + b0[1], R0 + b0[1] - 0.004, rr))
        else:
            band = 0.0
        band = k.math('MULTIPLY', band, side)
        lt = getattr(car, 'TYRE_TEXT_R', (0.030, 0.036))  # lettering: start above the rim, height
        v = k.math('MULTIPLY', k.math('SUBTRACT', rr, R0 + lt[0]), 1 / lt[1])
        cmb = k.node('ShaderNodeCombineXYZ')
        k.feed(cmb.inputs[0], k.math('FRACT', k.math('MULTIPLY', u, 2.0)))
        k.feed(cmb.inputs[1], v)
        img = k.image(text_strip(), cmb.outputs[0])
        letters = k.math('MULTIPLY', img.outputs['Color'], side)
        n = k.noise(vec, 220.0, 3.0)
        base = k.mix(k.math('MULTIPLY', n, 0.4), srgb((0.030, 0.030, 0.032)), srgb((0.045, 0.045, 0.047)))
        tread = k.smooth(0.775 * th, 0.50 * th, k.math('ABSOLUTE', oy))
        base = k.mix(k.math('MULTIPLY', tread, 0.5), base, srgb((0.055, 0.054, 0.052)))
        blocks = None
        nb = getattr(car, 'TYRE_BLOCKS', 0)          # all-terrain / gravel tread: staggered blocks
        if nb:
            rt = min(car.RF, car.RR)
            shoulder = k.math('MULTIPLY', k.smooth(0.98 * th, 0.84 * th, k.math('ABSOLUTE', oy)),
                              k.smooth(rt - 0.050, rt - 0.030, rr))
            lane = k.math('FLOOR', k.math('MULTIPLY', k.math('ADD', oy, th), 2.0 / th))     # 4 lanes across
            off = k.math('MULTIPLY', k.math('FRACT', k.math('MULTIPLY', lane, 0.5)), 1.0)
            cu = k.math('FRACT', k.math('ADD', k.math('MULTIPLY', u, float(nb)), off))
            cv = k.math('FRACT', k.math('MULTIPLY', k.math('ADD', oy, th), 2.0 / th))
            gu = k.math('MULTIPLY', k.smooth(0.06, 0.14, cu), k.smooth(0.94, 0.86, cu))
            gv = k.math('MULTIPLY', k.smooth(0.04, 0.12, cv), k.smooth(0.96, 0.88, cv))
            blocks = k.math('MULTIPLY', k.math('MULTIPLY', gu, gv), shoulder)
            groove = k.math('SUBTRACT', shoulder, blocks)
            base = k.mix(k.math('MULTIPLY', groove, 0.9), base, srgb((0.012, 0.012, 0.013)))
        base = k.mix(letters, base, srgb((0.62, 0.62, 0.60)))
        col = k.mix(band, base, srgb((0.80, 0.05, 0.04)))
        rough = k.mixf(tread, 0.88, 0.72)
        height = k.math('ADD', k.math('MULTIPLY', letters, 0.6), k.math('MULTIPLY', band, 0.3))
        if blocks is not None:
            height = k.math('ADD', height, k.math('MULTIPLY', blocks, 1.6))
    elif key == 'rim:alloy':
        # satin gunmetal, polished barrel lip
        r = k.node('ShaderNodeVectorMath', operation='LENGTH')
        cxy = k.node('ShaderNodeCombineXYZ')
        k.feed(cxy.inputs[0], ox)
        k.feed(cxy.inputs[1], oz)
        k.l.new(cxy.outputs[0], r.inputs[0])
        lip = k.smooth(0.2285, 0.231, r.outputs['Value'])
        col = k.mix(lip, srgb((0.40, 0.41, 0.43)), srgb((0.80, 0.80, 0.82)))
        rough = k.mixf(lip, 0.34, 0.16)
        metal = 1.0
    elif key == 'rim:paint':
        # painted cast wheel (car.RIM_PAINT), satin clear coat
        n = k.noise(vec, 500.0, 2.0)
        c0 = tuple(getattr(car, 'RIM_PAINT', (0.80, 0.80, 0.78)))
        col = k.mix(k.math('MULTIPLY', n, 0.3), srgb(c0), srgb(tuple(v * 0.92 for v in c0)))
        rough, coat = 0.32, 0.6
    elif key == 'body:plastic':
        # textured black plastic (flares, bumpers, cladding): matte, grained
        n = k.noise(vec, 900.0, 4.0, 0.7)
        col = k.mix(n, srgb((0.030, 0.030, 0.032)), srgb((0.048, 0.048, 0.050)))
        rough = 0.78
        height = k.math('MULTIPLY', n, 0.35)
    elif key == 'body:steel':
        # painted steel (bars, guards, racks): satin
        c0 = tuple(getattr(car, 'STEEL', (0.05, 0.05, 0.055)))
        col, rough, coat = srgb(c0), 0.42, 0.3
    elif key == 'body:alu':
        n = k.noise(vec, 700.0, 2.0)
        col, rough, metal = k.mix(n, (0.62, 0.63, 0.64), (0.70, 0.71, 0.72)), 0.30, 1.0
    elif key == 'rim:wire':
        n = k.noise(vec, 400.0, 2.0)
        col, rough, metal = k.mix(n, (0.80, 0.81, 0.83), (0.88, 0.89, 0.90)), 0.10, 1.0
    elif key == 'rim:spoke':
        n = k.noise(vec, 400.0, 2.0)
        col = k.mix(k.math('MULTIPLY', n, 0.3), srgb((0.42, 0.43, 0.45)), srgb((0.50, 0.51, 0.53)))
        rough, metal = 0.30, 1.0
    elif key == 'rim:nut':
        col, rough, metal = (0.80, 0.55, 0.20), 0.28, 1.0
    elif key == 'driver:helmet':
        # Blender frame (game z = -y, game y = z): red crown stripe, black lower shell, white elsewhere
        stripe = k.smooth(0.040, 0.030, k.math('ABSOLUTE', oy))
        low = k.smooth(0.86, 0.84, oz)
        c = k.mix(stripe, srgb((0.86, 0.86, 0.88)), srgb((0.80, 0.05, 0.04)))
        col = k.mix(low, c, srgb((0.05, 0.05, 0.055)))
        rough = 0.2
        coat = 1.0
    elif key == 'driver:suit':
        side = k.smooth(0.14, 0.17, k.math('ABSOLUTE', oy))
        n = k.noise(vec, 200.0, 3.0)
        col = k.mix(side, srgb((0.06, 0.065, 0.08)), srgb((0.72, 0.05, 0.04)))
        rough = k.mixf(n, 0.75, 0.9)
        height = k.math('MULTIPLY', n, 0.15)
    elif key == 'driver:jacket':
        # navy wool jacket of a gentleman driver
        n = k.noise(vec, 260.0, 3.0)
        col = k.mix(n, srgb((0.030, 0.036, 0.062)), srgb((0.050, 0.058, 0.090)))
        rough = 0.9
        height = k.math('MULTIPLY', n, 0.2)
    elif key == 'driver:glove' and getattr(car, 'GLOVE', None):
        # soft leather: fine grain, a satin sheen
        n = k.noise(vec, 520.0, 4.0, 0.6)
        col = k.mix(k.math('MULTIPLY', n, 0.5), srgb(car.GLOVE), srgb(tuple(v * 1.22 for v in car.GLOVE)))
        rough = k.mixf(n, 0.48, 0.62)
        height = k.math('MULTIPLY', n, 0.22)
    elif key == 'driver:seam':
        # glove seams and wrist strap: the glove's leather, darker
        g = tuple(getattr(car, 'GLOVE', None) or (0.08, 0.08, 0.085))
        n = k.noise(vec, 900.0, 3.0)
        col = k.mix(k.math('MULTIPLY', n, 0.4), srgb(tuple(v * 0.42 for v in g)), srgb(tuple(v * 0.55 for v in g)))
        rough = 0.6
    elif key == 'driver:glove':
        n = k.noise(vec, 260.0, 3.0)
        col = k.mix(k.math('MULTIPLY', n, 0.4), srgb((0.05, 0.05, 0.055)), srgb((0.12, 0.12, 0.13)))
        rough = 0.8
        height = k.math('MULTIPLY', n, 0.2)
    elif key == 'body:chrome' or key == 'int:chrome' or key == 'rim:chrome':
        n = k.noise(vec, 600.0, 2.0)
        col, rough, metal = (0.86, 0.87, 0.89), k.mixf(n, 0.05, 0.09), 1.0
    elif key == 'body:reflector':
        # lamp reflector: chrome bowl with concentric facets
        r = k.node('ShaderNodeVectorMath', operation='LENGTH')
        k.l.new(vec, r.inputs[0])
        rings_ = k.math('FRACT', k.math('MULTIPLY', r.outputs['Value'], 1 / 0.006))
        col, rough, metal = (0.90, 0.90, 0.91), 0.12, 1.0
        height = k.math('MULTIPLY', k.smooth(0.3, 0.7, rings_), 0.5)
    elif key == 'body:well':
        n = k.noise(vec, 120.0, 3.0)
        col, rough = k.mix(n, srgb((0.025, 0.025, 0.027)), srgb((0.04, 0.04, 0.042))), 0.85
        height = k.math('MULTIPLY', n, 0.3)
    elif key == 'body:rubber':
        col, rough = srgb((0.02, 0.02, 0.022)), 0.75
    elif key == 'body:grille':
        col, rough, metal = (0.70, 0.71, 0.73), 0.18, 1.0
    elif key == 'body:badge':
        col, rough, coat = srgb((0.05, 0.10, 0.30)), 0.25, 1.0
    elif key == 'body:amber':
        col, rough, coat = srgb((0.95, 0.45, 0.05)), 0.15, 1.0
    elif key == 'body:accent':
        # coloured hard parts (tow hooks, recovery points): the car's ACCENT, glossy powder coat
        col, rough, coat = srgb(tuple(getattr(car, 'ACCENT', (0.90, 0.30, 0.04)))), 0.30, 0.5
    elif key == 'body:tyre':
        # a tyre carried on the body (spare): rubber with a fine scrub, no wheel-frame lettering
        n = k.noise(vec, 300.0, 3.0)
        col, rough = k.mix(n, srgb((0.030, 0.030, 0.032)), srgb((0.045, 0.045, 0.048))), 0.85
        height = k.math('MULTIPLY', n, 0.3)
    elif key == 'body:smoke':
        # smoked lamp interiors: glossy near-black
        col, rough, coat = srgb((0.012, 0.012, 0.014)), 0.12, 1.0
    elif key == 'int:leather':
        n = k.noise(vec, 260.0, 5.0, 0.7)
        c0 = tuple(getattr(car, 'LEATHER', (0.30, 0.09, 0.05)))
        col = k.mix(k.math('MULTIPLY', n, 0.5), srgb(c0), srgb(tuple(v * 0.7 for v in c0)))
        rough = k.mixf(n, 0.48, 0.62)
        height = k.math('MULTIPLY', n, 0.35)
    elif key == 'int:pleat':
        # pleated seat centres: ribs across the seat (along the car's x in Blender local)
        rib = k.math('ABSOLUTE', k.math('SUBTRACT', k.math('FRACT', k.math('MULTIPLY', oz, 1 / 0.045)), 0.5))
        n = k.noise(vec, 260.0, 5.0, 0.7)
        c0 = tuple(getattr(car, 'LEATHER', (0.30, 0.09, 0.05)))
        col = k.mix(k.smooth(0.42, 0.5, rib), srgb(c0), srgb(tuple(v * 0.55 for v in c0)))
        rough = k.mixf(n, 0.5, 0.62)
        height = k.math('ADD', k.math('MULTIPLY', k.smooth(0.5, 0.3, rib), 1.0), k.math('MULTIPLY', n, 0.2))
    elif key == 'int:carpet':
        n = k.noise(vec, 700.0, 4.0, 0.8)
        col, rough = k.mix(n, srgb((0.035, 0.033, 0.032)), srgb((0.06, 0.055, 0.05))), 0.95
        height = k.math('MULTIPLY', n, 0.4)
    elif key == 'int:dash':
        # leather-grain vinyl: matte, so the dash top does not mirror the sky into the screen
        n = k.noise(vec, 400.0, 4.0, 0.6)
        col, rough = k.mix(n, srgb((0.030, 0.030, 0.032)), srgb((0.045, 0.045, 0.048))), 0.9
        height = k.math('MULTIPLY', n, 0.25)
    elif key == 'int:headliner':
        n = k.noise(vec, 500.0, 3.0, 0.6)
        h0 = tuple(getattr(car, 'HEADLINER', (0.55, 0.53, 0.49)))
        col, rough = k.mix(n, srgb(h0), srgb(tuple(v * 1.12 for v in h0))), 0.9
        height = k.math('MULTIPLY', n, 0.2)
    elif key == 'int:wood':
        # walnut veneer: grain along the car's z (Blender -y)
        n = k.noise(vec, 30.0, 6.0, 0.65)
        g = k.math('FRACT', k.math('ADD', k.math('MULTIPLY', oy, 70.0), k.math('MULTIPLY', n, 6.0)))
        col = k.mix(k.smooth(0.2, 0.8, g), srgb((0.20, 0.09, 0.035)), srgb((0.34, 0.17, 0.07)))
        rough, coat = 0.25, 1.0
    elif key == 'int:metal':
        n = k.noise(vec, 900.0, 2.0)
        col, rough, metal = k.mix(n, srgb((0.62, 0.62, 0.63)), srgb((0.72, 0.72, 0.73))), 0.28, 1.0
        col, rough, metal = (k.mix(n, srgb(getattr(car, 'METAL', (0.62, 0.62, 0.63))),
                                   srgb(tuple(min(1, v * 1.12) for v in getattr(car, 'METAL', (0.62, 0.62, 0.63))))),
                             *getattr(car, 'METAL_RM', (0.28, 1.0)))
    elif key == 'int:screen':
        # centre touch screen: a dark map with roads and a few UI tiles (it glows at night)
        n = k.noise(vec, 40.0, 5.0, 0.6)
        road = k.smooth(0.47, 0.50, k.math('ABSOLUTE', k.math('SUBTRACT', k.math('FRACT', k.math('MULTIPLY', n, 6.0)), 0.5)))
        base = k.mix(n, srgb((0.010, 0.022, 0.040)), srgb((0.020, 0.040, 0.065)))
        col = k.mix(road, base, srgb((0.10, 0.36, 0.46)))
        # anti-glare matte coating: at 0.08 the in-game sky reflection washed the screen out to grey
        rough = 0.42
    elif key == 'int:cage':
        # powder-coated roll cage: satin dark grey
        n = k.noise(vec, 700.0, 3.0)
        col, rough = k.mix(k.math('MULTIPLY', n, 0.4), srgb((0.055, 0.057, 0.062)), srgb((0.075, 0.077, 0.083))), 0.45
    elif key == 'int:pad':
        # black cage padding foam in a textile sleeve
        n = k.noise(vec, 400.0, 3.0)
        col, rough = k.mix(n, srgb((0.018, 0.018, 0.020)), srgb((0.030, 0.030, 0.033))), 0.92
        height = k.math('MULTIPLY', n, 0.3)
    elif key == 'int:gauge':
        # dial faces: a generated dial atlas on a planar UV (group Gauges, see gauge_uv)
        col, rough = srgb((0.03, 0.03, 0.03)), 0.2
    elif key == 'int:black':
        col, rough = srgb((0.02, 0.02, 0.022)), 0.45
    elif key == 'glass' or key == 'glass:clear':
        col, rough, metal = (0.05, 0.045, 0.03), 0.04, 0.6
    elif key == 'headlight_lens':
        col, rough = (0.85, 0.88, 0.92), 0.1
    elif key == 'taillight_lens':
        col, rough = (0.30, 0.01, 0.01), 0.15
    elif key == 'exhaust':
        col, rough, metal = (0.55, 0.47, 0.38), 0.35, 1.0

    k.feed(bsdf.inputs['Base Color'], col)
    k.feed(bsdf.inputs['Roughness'], rough)
    k.feed(bsdf.inputs['Metallic'], metal)
    bsdf.inputs['Coat Weight'].default_value = coat
    if height is not None:
        bump = k.node('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.25
        bump.inputs['Distance'].default_value = 0.0004
        k.feed(bump.inputs['Height'], height)
        k.l.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    mv = k.node('ShaderNodeValue')
    mv.name = 'metal'
    if isinstance(metal, (int, float)):
        mv.outputs[0].default_value = metal
    be = k.node('ShaderNodeEmission')
    be.name = 'base_emit'
    k.feed(be.inputs['Color'], src_shade if src_shade is not None else col)
    em = k.node('ShaderNodeEmission')
    em.name = 'metal_emit'
    k.l.new(mv.outputs[0], em.inputs['Color'])
    # world position / normal (float bakes the livery is painted from, see bake_livery)
    geo = k.node('ShaderNodeNewGeometry')
    for nm, sock, sc_ in (('pos_emit', 'Position', 0.1), ('nrm_emit', 'Normal', 0.5)):
        enc = k.node('ShaderNodeVectorMath', operation='MULTIPLY_ADD')   # into 0..1 (emission > 0)
        k.l.new(geo.outputs[sock], enc.inputs[0])
        enc.inputs[1].default_value = (sc_, sc_, sc_)
        enc.inputs[2].default_value = (0.5, 0.5, 0.5)
        e = k.node('ShaderNodeEmission')
        e.name = nm
        k.l.new(enc.outputs[0], e.inputs['Color'])
    m['bsdf'] = bsdf.name
    MATS[key] = m
    return m


# ---------------------------------------------------------------------------------------------
# Scene assembly
# ---------------------------------------------------------------------------------------------

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    TEX_IMAGES.clear()
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.unit_settings.system = 'METRIC'
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 1.0


def mesh_object(name, mesh, keys_lod, M=None, parent=None):
    """Blender object from a meshkit Mesh (game frame) with one material slot per design key."""
    V = mesh.V @ B3.T
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], mesh.F)
    keys = sorted(set(mesh.mats))
    for kk in keys:
        me.materials.append(make_key_material(kk))
    idx = np.array([keys.index(kk) for kk in mesh.mats], dtype=np.int32)
    me.polygons.foreach_set('material_index', idx)
    if mesh.uv is not None and any(kk.startswith(('src:', 'paint:src')) for kk in keys):
        # the source texture's coordinates (remastered cars): layer 'src', read by the src:*
        # materials while baking, dropped before export
        lay = me.uv_layers.new(name='src')
        lay.data.foreach_set('uv', np.array([c for f in mesh.uv for c in f], dtype=np.float64).ravel())
    me.update()
    me.shade_smooth()
    if mesh.cn is not None:
        # remastered body: the source's own smooth shading (normals transferred from the
        # high-poly original; a decimated surface's own normals wobble on glossy paint)
        N = np.array([c for f in mesh.cn for c in f], dtype=np.float64) @ B3.T
        me.normals_split_custom_set(N.tolist())
    else:
        me.set_sharp_from_angle(angle=math.radians(48))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    if M is not None:
        ob.matrix_world = to_blender(M)
    return ob


def empty(name, M=None, parent=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.1
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    if M is not None:
        ob.matrix_world = to_blender(M)
    return ob


def split_by_group(mesh, lod):
    """{group: Mesh} keeping face materials (keys)."""
    from meshkit import Mesh
    groups = {}
    for i, kk in enumerate(mesh.mats):
        groups.setdefault(group_of(kk, lod), []).append(i)
    out = {}
    for g, fids in groups.items():
        used = sorted({v for i in fids for v in mesh.F[i]})
        remap = {v: j for j, v in enumerate(used)}
        out[g] = Mesh(mesh.V[used], [[remap[v] for v in mesh.F[i]] for i in fids], [mesh.mats[i] for i in fids],
                      uv=None if mesh.uv is None else [mesh.uv[i] for i in fids],
                      cn=None if mesh.cn is None else [mesh.cn[i] for i in fids])
    return out


class Built:
    """Blender objects of one LOD. `parts` are the bake objects: (node, group, object)."""

    def __init__(self):
        self.parts = []
        self.nodes = {}
        self.root = None


def build_lod(lod):
    cfg = LODS[lod]
    q = cfg['q']
    b = Built()
    if lod == 'cockpit':
        parts = car.cockpit(q)
        root = empty('cockpit', mat4())
        b.root = root
        sw_M = mat4(rot_z(car.WHEEL_TILT), car.WHEEL_CENTRE)
        sw = empty('steering_wheel', sw_M, root)
        b.nodes['steering_wheel'] = sw
        # steering wheel and hands in the wheel's frame; every other part (shell, the cockpit's
        # own window glass...) in the car frame, one node each
        order = ['steering_wheel', 'hands'] + [k for k in parts if k not in ('steering_wheel', 'hands')]
        for node in order:
            mesh, parent = parts[node], (sw if node in ('steering_wheel', 'hands') else root)
            M = sw_M if parent is sw else mat4()
            for g, gm in split_by_group(mesh, lod).items():
                ob = mesh_object(f'{node}__{g}', gm, lod, M, parent)
                b.parts.append((node, g, ob))
        return b

    nodes = car.build(q)
    root = empty(car.FILE, mat4())
    b.root = root
    body = empty('body', mat4(), root)
    b.nodes['body'] = body
    placement = {
        'body': (mat4(), body),
        'exhaust': (mat4(), None), 'headlight_lens': (mat4(), None), 'taillight_lens': (mat4(), None),
        'driver': (mat4(), None),
        'steering_wheel': (mat4(rot_z(car.WHEEL_TILT), car.WHEEL_CENTRE), None),
    }
    # Further car-frame nodes a design may add (glass, interior, window_L / window_R...): children
    # of body, origin at the car's origin (a window node's open position is in META['windows']).
    for node in nodes:
        if node not in placement and not node.startswith(('tyre_', 'rim_', 'upright_')):
            placement[node] = (mat4(), None)
    under_root = ('driver', 'steering_wheel')
    for node, (M, holder) in placement.items():
        if holder is None:
            holder = empty(node, M, root if node in under_root else body)
            b.nodes[node] = holder
        for g, gm in split_by_group(nodes[node], lod).items():
            ob = mesh_object(f'{node}__{g}', gm, lod, M, holder)
            b.parts.append((node, g, ob))
    # Right-side wheels and uprights are built (and baked) here; the left side is added after the
    # bake by instancing (wheels) or mirroring (uprights) them.
    for key, axle, centre, left in car.wheel_layout():
        if left:
            continue
        M = mat4(None, centre)
        w = empty(f'wheel_{key}', M, root)
        b.nodes[f'wheel_{key}'] = w
        for part in ('tyre', 'rim'):
            mesh = nodes[f'{part}_{axle}']
            for g, gm in split_by_group(mesh, lod).items():
                ob = mesh_object(f'{part}_{key}', gm, lod, M, w)
                b.parts.append((f'{part}_{key}', g, ob))
        u = empty(f'upright_{key}', M, root)
        b.nodes[f'upright_{key}'] = u
        up = nodes[f'upright_{axle}']
        for g, gm in split_by_group(up, lod).items():
            ob = mesh_object(f'upright_{key}__{g}', gm, lod, M, u)
            b.parts.append((f'upright_{key}', g, ob))
    return b


# ---------------------------------------------------------------------------------------------
# UVs and baking
# ---------------------------------------------------------------------------------------------

def select_only(objs):
    bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def tyre_uv(o, slot=0, slots=1):
    """Torus mapping for a tyre (wheel frame: axis along Blender -y): u = half-turn angle (both
    halves share the texture), v = angle round the tyre section. Smart UV cannot flatten it."""
    me = o.data
    V = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', V)
    V = V.reshape(-1, 3)
    x, ax, y = V[:, 0], -V[:, 1], V[:, 2]
    r = np.hypot(x, y)
    a = np.mod(np.arctan2(y, x), np.pi) / np.pi
    r0 = (r.max() + r.min()) / 2
    b = (np.arctan2(ax, r - r0) / (2 * np.pi)) % 1.0
    uv = np.zeros((len(me.loops), 2))
    for p in me.polygons:
        ids = list(p.loop_indices)
        vs = [me.loops[i].vertex_index for i in ids]
        uu, vv = a[vs].copy(), b[vs].copy()
        if uu.max() - uu.min() > 0.5:
            uu[uu < 0.5] += 1
        if vv.max() - vv.min() > 0.5:
            vv[vv < 0.5] += 1
        # squeeze into the unit square: [0, 1) x [0, 1) -> margins
        uu = np.clip(uu, 0, 1)
        vv = np.clip(vv, 0, 1)
        for i, u_, v_ in zip(ids, uu, vv):
            uv[i] = ((slot + 0.01 + 0.98 * u_) / slots, 0.01 + 0.98 * v_)
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    me.uv_layers.active.data.foreach_set('uv', uv.ravel())


def unwrap(objs, margin):
    if all(o.name.startswith('tyre_') for o in objs):
        for i, o in enumerate(objs):
            tyre_uv(o, i, len(objs))
        return
    for o in objs:
        # keep a source-texture layer ('src') for the bakes: the atlas goes on a new layer
        lays = o.data.uv_layers
        if 'src' in lays:
            if 'UVMap' not in lays:
                lays.new(name='UVMap')
            lays.active = lays['UVMap']
    select_only(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin=margin, scale=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in objs:
        uv = np.empty(len(o.data.loops) * 2)
        o.data.uv_layers.active.data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)
        print(f'    uv {o.name}: {uv.min(0).round(3)} .. {uv.max(0).round(3)}', flush=True)


def new_image(name, size, data=False, float_buffer=False):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=float_buffer)
    img.colorspace_settings.name = 'Non-Color' if (data or float_buffer) else 'sRGB'
    return img


def mats_of(objs):
    out = []
    for o in objs:
        for s in o.material_slots:
            if s.material and s.material not in out:
                out.append(s.material)
    return out


def set_target(mats, img):
    for m in mats:
        nt = m.node_tree
        nd = nt.nodes.get('__bake__') or nt.nodes.new('ShaderNodeTexImage')
        nd.name = '__bake__'
        nd.image = img
        nt.nodes.active = nd
        nd.select = True


def route(mats, metal):
    """metal='metal' / 'base': material output shows that value as emission (EMIT bake; the
    albedo goes this way too, because a DIFFUSE colour bake is black on metals); False: back to
    the principled BSDF."""
    for m in mats:
        nt = m.node_tree
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        src = nt.nodes[f'{metal}_emit'].outputs[0] if metal else nt.nodes[m['bsdf']].outputs[0]
        nt.links.new(src, out.inputs[0])


def bake(kind, objs, img, mats, samples=1, target='IMAGE_TEXTURES'):
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = False
    sc.render.bake.margin_type = 'EXTEND'
    sc.render.bake.target = target
    if target == 'IMAGE_TEXTURES':
        set_target(mats, img)
    select_only(objs)
    t = time.time()
    if kind == 'BASE':
        route(mats, 'base')
        bpy.ops.object.bake(type='EMIT')
        route(mats, False)
    elif kind == 'DIFFUSE':
        sc.render.bake.use_pass_direct = False
        sc.render.bake.use_pass_indirect = False
        sc.render.bake.use_pass_color = True
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'})
    elif kind == 'AO':
        sc.world.light_settings.distance = 0.6
        bpy.ops.object.bake(type='AO')
    elif kind in ('POS', 'NRM'):
        route(mats, kind.lower())
        bpy.ops.object.bake(type='EMIT')
        route(mats, False)
    elif kind == 'METAL':
        route(mats, 'metal')
        bpy.ops.object.bake(type='EMIT')
        route(mats, False)
    else:
        bpy.ops.object.bake(type=kind, normal_space='TANGENT') if kind == 'NORMAL' else bpy.ops.object.bake(type=kind)
    print(f'    bake {kind:9s} {len(objs):3d} objs  {time.time() - t:6.1f}s', flush=True)


def pixels(img):
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def save_png(path, arr, srgb_encode=False):
    from PIL import Image
    a = np.clip(arr, 0, 1)
    if srgb_encode:
        a = np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)
    a = (a[::-1] * 255 + 0.5).astype(np.uint8)
    Image.fromarray(a).save(path)


def to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lum(c):
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def livery_inputs(objs, mats, size):
    """Per-texel car-frame position and normal (game axes) of an atlas, plus a coverage mask."""
    pos = new_image('_pos', size, float_buffer=True)
    nrm = new_image('_nrm', size, float_buffer=True)
    bake('POS', objs, pos, mats, samples=1)
    bake('NRM', objs, nrm, mats, samples=1)
    Pb = (pixels(pos)[..., :3] - 0.5) / 0.1
    Nb = (pixels(nrm)[..., :3] - 0.5) / 0.5
    valid = np.abs(pixels(pos)[..., :3]).sum(-1) > 1e-6
    to_game = lambda A: np.stack([A[..., 0], A[..., 2], -A[..., 1]], -1)   # Blender (x, -z, y) -> game
    return to_game(Pb), to_game(Nb), valid


def weave_uv(objs):
    """Second UV set 'Weave' for carbon: per-face box projection in metres / WEAVE_TILE."""
    for o in objs:
        me = o.data
        if 'Weave' in me.uv_layers:
            continue
        V = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get('co', V)
        V = V.reshape(-1, 3)
        Ns = np.empty(len(me.polygons) * 3)
        me.polygons.foreach_get('normal', Ns)
        Ns = np.abs(Ns.reshape(-1, 3))
        lv = np.empty(len(me.loops), dtype=np.int64)
        me.loops.foreach_get('vertex_index', lv)
        start = np.empty(len(me.polygons), dtype=np.int64)
        tot = np.empty(len(me.polygons), dtype=np.int64)
        me.polygons.foreach_get('loop_start', start)
        me.polygons.foreach_get('loop_total', tot)
        axis = np.repeat(Ns.argmax(1), tot)
        P = V[lv]
        u = np.where(axis == 0, P[:, 1], P[:, 0])
        v = np.where(axis == 2, P[:, 1], P[:, 2])
        layer = me.uv_layers.new(name='Weave')
        layer.data.foreach_set('uv', (np.stack([u, v], -1) / WEAVE_TILE).ravel())
        me.uv_layers.active = me.uv_layers[0]
        me.uv_layers[0].active_render = True


def components(me):
    """Connected parts of a mesh: a component id per vertex (union-find over the faces)."""
    nv = len(me.vertices)
    par = np.arange(nv)

    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a
    for p in me.polygons:
        vs = list(p.vertices)
        r0 = find(vs[0])
        for v in vs[1:]:
            r = find(v)
            if r != r0:
                par[r] = r0
    roots = np.array([find(i) for i in range(nv)])
    _, comp = np.unique(roots, return_inverse=True)
    return comp


def planar_uv(objs, tiles=None):
    """0..1 per glass / dial (each connected part on its own), u along the car's z and v up for
    a part that faces along x; along x and up for one that faces sideways. For the game's live
    mirror (render target) or its low-tier sky gradient (reads uv.y). `tiles` (gauges): a list of
    (u0, v0, size) atlas cells, given to the parts in order of their z (left to right)."""
    for o in objs:
        me = o.data
        V = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get('co', V)
        V = V.reshape(-1, 3) @ np.asarray(o.matrix_world)[:3, :3].T + np.asarray(o.matrix_world)[:3, 3]
        gx, gz, gy = V[:, 0], -V[:, 1], V[:, 2]
        comp = components(me)
        order = sorted(range(comp.max() + 1), key=lambda c: gz[comp == c].mean())
        uv = np.zeros((len(V), 2))
        for rank, c in enumerate(order):
            side = comp == c
            ext = np.array([np.ptp(gx[side]), np.ptp(gz[side])])
            a = gz if ext[1] >= ext[0] else -gx * np.sign(gz[side].mean() or 1)
            a0, a1 = a[side].min(), a[side].max()
            y0, y1 = gy[side].min(), gy[side].max()
            if tiles is not None:
                # keep the dial round: square cell round the part's centre
                span = max(a1 - a0, y1 - y0)
                ac, yc = (a0 + a1) / 2, (y0 + y1) / 2
                u0, v0, sz = tiles[min(rank, len(tiles) - 1)]
                uv[side, 0] = u0 + sz * ((a[side] - ac) / span + 0.5)
                uv[side, 1] = v0 + sz * ((gy[side] - yc) / span + 0.5)
            else:
                uv[side, 0] = (a[side] - a0) / max(a1 - a0, 1e-6)
                uv[side, 1] = (gy[side] - y0) / max(y1 - y0, 1e-6)
        lv = np.empty(len(me.loops), dtype=np.int64)
        me.loops.foreach_get('vertex_index', lv)
        if not me.uv_layers:
            me.uv_layers.new(name='UVMap')
        me.uv_layers.active.data.foreach_set('uv', uv[lv].ravel())


def gauge_atlas():
    """Dial faces for the classic instruments (car.GAUGES: list of dicts with kind, label, max,
    ticks), 2 x 2 cells of 512 px; returns (path, tiles)."""
    from PIL import Image, ImageDraw, ImageFont
    S = 1024
    im = Image.new('RGB', (S, S), (8, 8, 9))
    d = ImageDraw.Draw(im)
    try:
        F = lambda px: ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', px)
        F(10)
    except OSError:
        F = lambda px: ImageFont.load_default()
    tiles = []
    for i, g in enumerate(getattr(car, 'GAUGES', [])[:4]):
        cx, cy = (i % 2) * 512 + 256, (i // 2) * 512 + 256
        R = 236
        d.ellipse((cx - R, cy - R, cx + R, cy + R), fill=(14, 14, 15), outline=(190, 190, 185), width=6)
        a0, a1 = math.radians(225), math.radians(-45)
        n = g.get('ticks', 8)
        for k in range(n * 5 + 1):
            a = a0 + (a1 - a0) * k / (n * 5)
            major = k % 5 == 0
            r1 = R - (52 if major else 32)
            d.line((cx + (R - 14) * math.cos(a), cy - (R - 14) * math.sin(a), cx + r1 * math.cos(a), cy - r1 * math.sin(a)),
                   fill=(235, 232, 220), width=7 if major else 3)
            if major:
                val = str(int(g['max'] * (k // 5) / n))
                f = F(44)
                bb = d.textbbox((0, 0), val, font=f)
                tx, ty = cx + (R - 92) * math.cos(a), cy - (R - 92) * math.sin(a)
                d.text((tx - (bb[2] - bb[0]) / 2, ty - (bb[3] - bb[1]) / 2 - bb[1]), val, fill=(235, 232, 220), font=f)
        f = F(34)
        bb = d.textbbox((0, 0), g['label'], font=f)
        d.text((cx - (bb[2] - bb[0]) / 2, cy + 70), g['label'], fill=(200, 196, 180), font=f)
        # needle at rest-ish, centre cap
        a = a0 + (a1 - a0) * g.get('needle', 0.12)
        d.line((cx - 30 * math.cos(a), cy + 30 * math.sin(a), cx + (R - 40) * math.cos(a), cy - (R - 40) * math.sin(a)),
               fill=(245, 110, 30), width=10)
        d.ellipse((cx - 26, cy - 26, cx + 26, cy + 26), fill=(30, 30, 32), outline=(150, 150, 150), width=4)
        tiles.append(((i % 2) * 0.5 + 0.01, 1 - ((i // 2) + 1) * 0.5 + 0.01, 0.48))
    path = os.path.join(OUT, 'gauges.png')
    im.save(path)
    return path, tiles


def weave_textures():
    """2x2 twill tile (albedo sRGB + tangent normal), generated once per build."""
    path_b, path_n = os.path.join(OUT, 'weave_base.png'), os.path.join(OUT, 'weave_normal.png')
    if os.path.exists(path_b) and os.path.exists(path_n):
        return path_b, path_n
    from PIL import Image
    S, T = 512, 8                       # pixels, tows per tile
    c = (np.arange(S) + 0.5) / S * T
    X, Y = np.meshgrid(c, c)
    i, j = np.floor(X).astype(int), np.floor(Y).astype(int)
    fx, fy = X - i, Y - j
    warp = ((i + j) % 4) < 2            # warp (along v) on top, else weft (along u)
    across = np.where(warp, fx, fy)     # position across the visible tow
    along = np.where(warp, fy, fx)
    prof = np.sin(np.clip(across, 0, 1) * np.pi)          # tow crown
    gap = np.clip(1 - np.abs(across - 0.5) * 2.0, 0, 1) ** 0.25
    rng = np.random.default_rng(7)
    fil = rng.normal(0, 1, (S, S))
    from numpy.fft import fft2, ifft2
    k = np.fft.fftfreq(S)
    KX, KY = np.meshgrid(k, k)
    filament = np.real(ifft2(fft2(fil) * np.exp(-(KX ** 2 * 900 + KY ** 2 * 4))))
    filament2 = np.real(ifft2(fft2(fil) * np.exp(-(KX ** 2 * 4 + KY ** 2 * 900))))
    fil_s = np.where(warp, filament, filament2)
    fil_s = fil_s / (np.abs(fil_s).max() + 1e-9)
    tone = np.where(warp, 0.050, 0.042) + 0.012 * prof + 0.005 * fil_s - 0.012 * (1 - gap)
    tone *= 0.85 + 0.15 * np.sin(np.clip(along, 0, 1) * np.pi)
    base = np.stack([tone, tone * 1.01, tone * 1.06], -1)
    # normals: tow curvature across its width, a dip where it dives under the next one
    h = prof * 0.6 + 0.4 * np.sin(np.clip(along, 0, 1) * np.pi) * gap
    gy_, gx_ = np.gradient(h * 3.5)
    nrm = norm(np.stack([-gx_, gy_, np.ones_like(h) * 1.0], -1))
    Image.fromarray((np.clip(base, 0, 1) ** (1 / 2.2) * 255 + 0.5).astype(np.uint8)).save(path_b)
    Image.fromarray(((nrm * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)).save(path_n)
    return path_b, path_n


def norm(a):
    return a / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-9)


def bake_textures(b, lod):
    cfg = LODS[lod]
    files = {}
    for g, size in cfg['tex'].items():
        size = int(size * args.scale)
        objs = [o for (_, gg, o) in b.parts if gg == g]
        if not objs:
            continue
        print(f'  {lod} {g}: {len(objs)} objects, {sum(len(o.data.polygons) for o in objs)} faces, {size}px', flush=True)
        unwrap(objs, 0.004 if size >= 1024 else 0.008)
        if args.no_bake:
            if g == 'Carbon':
                weave_uv(objs)
            continue
        mats = mats_of(objs)
        stem = os.path.join(OUT, f'{car.FILE}{SUFFIX[lod]}_{g}')
        ao = new_image(f'{g}_ao', size, True)
        bake('AO', objs, ao, mats, samples=args.samples)
        A = pixels(ao)[..., 0]
        if g == 'CarPaint':
            # Factory livery map: the factory colour shaded by soft AO, panel lines and the
            # car's black decals. The game reads it as a shading layer under any paint
            # (texel luminance / factoryLum), so a player's colour comes out clean.
            fac = np.array(getattr(car, 'FACTORY_PAINT', (0.62, 0.025, 0.02)))
            shade = 0.55 + 0.45 * A
            if getattr(car, 'SRC_SHADE', None):
                # remastered car: the source paint's own shading (panel gaps, vents, lettering)
                sh = new_image(f'{g}_srcshade', size, True)
                bake('BASE', objs, sh, mats, samples=4)
                shade = shade * pixels(sh)[..., 0]
            layers = []
            if hasattr(car, 'livery'):
                P, N, valid = livery_inputs(objs, mats, size)
                L = car.livery('CarPaint', P, N, valid)
                shade = shade * L['shade']
                layers = L.get('layers', [])
            lin = fac[None, None, :] * shade[..., None]
            # coloured factory-livery layers (mask, linear rgb): the Factory Livery finish shows
            # them; under a player's paint only their luminance against the factory colour's
            # shows, so a colour of the factory paint's luminance leaves the player's paint clean
            for mask, col in layers:
                m = np.clip(mask, 0, 1)[..., None]
                lin = lin * (1 - m) + np.asarray(col)[None, None, :] * shade[..., None] * m
            save_png(stem + '_base.png', lin, srgb_encode=True)
            files[g] = {'base': stem + '_base.png', 'factoryLum': float(lum(fac))}
            print(f'    check {g}: shade mean {shade.mean():.3f}', flush=True)
            continue
        rough = new_image(f'{g}_rough', size, True)
        metal = new_image(f'{g}_metal', size, True)
        bake('ROUGHNESS', objs, rough, mats, samples=4)
        bake('METAL', objs, metal, mats, samples=1)
        R, Mt = pixels(rough)[..., 0], pixels(metal)[..., 0]
        if g == 'Carbon':
            wb, wn = weave_textures()
            save_png(stem + '_orm.png', np.stack([A, R, Mt], -1))
            files[g] = {'orm': stem + '_orm.png', 'weave_base': wb, 'weave_normal': wn, 'weaveTile': WEAVE_TILE}
            weave_uv(objs)
            print(f'    check {g}: ao {A.mean():.3f} rough {R.mean():.3f}', flush=True)
            continue
        base = new_image(f'{g}_base', size)
        nrm = new_image(f'{g}_normal', size, True)
        bake('BASE', objs, base, mats, samples=4)
        bake('NORMAL', objs, nrm, mats, samples=4)
        B, Nn = pixels(base)[..., :3], pixels(nrm)[..., :3]
        if hasattr(car, 'livery') and g in getattr(car, 'LIVERY_GROUPS', ('Body',)):
            P, N, valid = livery_inputs(objs, mats, size)
            L = car.livery(g, P, N, valid)
            lin = to_lin(B)
            for mask, col, rgh in L.get('layers', []):
                m = np.clip(mask, 0, 1) * valid
                if col is not None:
                    lin = lin * (1 - m[..., None]) + np.asarray(col)[None, None, :] * m[..., None]
                if rgh is not None:
                    R = R * (1 - m) + rgh * m
            if 'shade' in L:
                lin = lin * L['shade'][..., None]
            B = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.clip(lin, 0, None) ** (1 / 2.4) - 0.055)
        print(f'    check {g}: base mean {B.mean():.3f} ao {A.mean():.3f}', flush=True)
        glow = None
        if hasattr(car, 'glow'):
            P, N, valid = livery_inputs(objs, mats, size)
            glow = car.glow(g, lod, P, N, valid)
        if glow is not None:
            # night light baked into an emissive map: albedo x (gain), dark trims lifted to a floor
            gain, floor = glow
            E = np.maximum(to_lin(B), floor) * (gain * (0.35 + 0.65 * A))[..., None]
            save_png(stem + '_glow.png', E, srgb_encode=True)
            print(f'    check {g}: glow mean {E.mean():.4f} max {E.max():.3f}', flush=True)
        if g in cfg['orm']:
            save_png(stem + '_base.png', B)  # Blender stores sRGB images display-encoded
            save_png(stem + '_orm.png', np.stack([A, R, Mt], -1))
            files[g] = {'base': stem + '_base.png', 'orm': stem + '_orm.png', 'normal': stem + '_normal.png',
                        'useOrm': True}
        else:
            # AO multiplied into the albedo (decode sRGB, multiply, encode)
            lin = to_lin(B) * (0.25 + 0.75 * A[..., None])
            save_png(stem + '_base.png', lin, srgb_encode=True)
            save_png(stem + '_orm.png', np.stack([A, R, Mt], -1))
            files[g] = {'base': stem + '_base.png', 'orm': stem + '_orm.png', 'normal': stem + '_normal.png'}
        if glow is not None:
            files[g]['glow'] = stem + '_glow.png'
        save_png(stem + '_normal.png', Nn)
    for g in ('MirrorGlass',):
        objs = [o for (_, gg, o) in b.parts if gg == g]
        if objs:
            planar_uv(objs)
    objs = [o for (_, gg, o) in b.parts if gg == 'Gauges']
    if objs:
        path, tiles = gauge_atlas()
        planar_uv(objs, tiles)
        files['Gauges'] = {'base': path}
    return files


def bake_vertex_colours(b, lod):
    """Race LOD: albedo x AO into a CORNER colour attribute per object."""
    objs = [o for (_, g, o) in b.parts]
    for o in objs:
        for name in ('Col', 'AO'):
            if name not in o.data.color_attributes:
                o.data.color_attributes.new(name, 'FLOAT_COLOR', 'CORNER')
    baked = [o for (_, g, o) in b.parts if g in BAKED]
    if args.no_bake or not baked:
        return
    mats = mats_of(baked)
    for name, kind, samples in (('Col', 'BASE', 4), ('AO', 'AO', args.samples)):
        for o in baked:
            o.data.color_attributes.active_color = o.data.color_attributes[name]
        bake(kind, baked, None, mats, samples=samples, target='VERTEX_COLORS')
    for o in objs:
        ca = o.data.color_attributes
        n = len(o.data.loops)
        c = np.empty(n * 4, dtype=np.float32)
        a = np.empty(n * 4, dtype=np.float32)
        ca['Col'].data.foreach_get('color', c)
        ca['AO'].data.foreach_get('color', a)
        c = c.reshape(-1, 4)
        a = a.reshape(-1, 4)
        if o in baked:
            c[:, :3] *= (0.25 + 0.75 * a[:, :1])
        else:
            c[:] = 1.0
        c[:, 3] = 1.0
        ca['Col'].data.foreach_set('color', c.ravel())
        ca.remove(ca['AO'])
        ca.active_color = ca['Col']
        ca.render_color_index = 0


# ---------------------------------------------------------------------------------------------
# Final materials, left side, joining, export
# ---------------------------------------------------------------------------------------------

def export_material(g, lod):
    name = g
    m = bpy.data.materials.get(name)
    if m and m.get('lod') == lod:
        return m
    if m:
        m.name = name + '_old'
    m = bpy.data.materials.new(name)
    m['lod'] = lod
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    col, rough, metal, emit = PLAIN.get(g, ((1, 1, 1, 1), 0.5, 0.0, None))
    if lod != 'race' and g in BAKED:
        col, rough, metal = (1, 1, 1, 1), 1.0, 1.0
    bsdf.inputs['Base Color'].default_value = col
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if col[3] < 1:
        bsdf.inputs['Alpha'].default_value = col[3]
        m.surface_render_method = 'BLENDED'
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = 1.0
    if lod == 'race' and g in BAKED:
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs[6].default_value = col
        nt.links.new(attr.outputs['Color'], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    return m


def finalize(b, lod):
    # Swap design-key materials for the export material of each object's group.
    for node, g, o in b.parts:
        lays = o.data.uv_layers
        if 'src' in lays:
            lays.remove(lays['src'])
            if len(lays):
                lays.active = lays[0]
                lays[0].active_render = True
        o.data.materials.clear()
        o.data.materials.append(export_material(g, lod))
        o.data.polygons.foreach_set('material_index', np.zeros(len(o.data.polygons), dtype=np.int32))
    # Join the group objects of each node into one mesh object named after the node.
    by_node = {}
    for node, g, o in b.parts:
        by_node.setdefault(node, []).append(o)
    final = {}
    for node, objs in by_node.items():
        if len(objs) > 1:
            select_only(objs)
            bpy.ops.object.join()
        ob = objs[0]
        holder = b.nodes.get(node)
        if holder is not None and holder.type == 'EMPTY' and node not in ('steering_wheel',) and lod != 'cockpit':
            # replace the empty holder by the mesh itself (keeps the node name and transform)
            ob.parent = holder.parent
            ob.matrix_world = holder.matrix_world.copy()
            for ch in list(holder.children):
                M = ch.matrix_world.copy()
                ch.parent = ob
                ch.matrix_world = M
            bpy.data.objects.remove(holder)
            b.nodes[node] = ob
        ob.name = node
        ob.data.name = node
        final[node] = ob
    if lod == 'cockpit':
        sw = b.nodes['steering_wheel']
        mesh = final['steering_wheel']
        M = mesh.matrix_world.copy()
        mesh.parent = sw.parent
        mesh.matrix_world = M
        for ch in list(sw.children):
            Mc = ch.matrix_world.copy()
            ch.parent = mesh
            ch.matrix_world = Mc
        bpy.data.objects.remove(sw)
        mesh.name = 'steering_wheel'
        return final
    # steering wheel: mesh replaces its holder
    sw = b.nodes['steering_wheel']
    if sw.type == 'EMPTY':
        mesh = final['steering_wheel']
        M = sw.matrix_world.copy()
        mesh.parent = sw.parent
        mesh.matrix_world = M
        bpy.data.objects.remove(sw)
        mesh.name = 'steering_wheel'
    # Upright parts: one upright mesh, caliper and disc as children, named per corner.
    for key, axle, centre, left in car.wheel_layout():
        if left:
            continue
        up = final[f'upright_{key}']
        split_upright(up, key)
    # Left side.
    for key, axle, centre, left in car.wheel_layout():
        if not left:
            continue
        rkey = key[0] + 'R'
        M = mat4(rot_y(math.pi), centre)
        w = empty(f'wheel_{key}', M, b.root)
        for part in ('tyre', 'rim'):
            src = bpy.data.objects[f'{part}_{rkey}']
            ob = bpy.data.objects.new(f'{part}_{key}', src.data)
            bpy.context.scene.collection.objects.link(ob)
            ob.parent = w
            ob.matrix_world = to_blender(M)
        src_up = bpy.data.objects[f'upright_{rkey}']
        up = mirror_copy(src_up, f'upright_{key}', mat4(None, centre), b.root)
        for ch in src_up.children:
            nm = ch.name.replace(rkey, key)
            mirror_copy(ch, nm, mat4(None, centre), up)
    return final


def split_upright(up, key):
    """Moves the caliper and disc faces of an upright mesh into child objects."""
    me = up.data
    import bmesh
    for kind, keyname in (('caliper', 'body:caliper'), ('brake_disc', 'body:disc')):
        pass
    # The upright was joined from group objects; split by loose parts using the design key
    # recorded per face before finalize (stored as an int attribute).
    attr = me.attributes.get('part')
    if attr is None:
        return
    vals = np.empty(len(me.polygons), dtype=np.int32)
    attr.data.foreach_get('value', vals)
    for code, kind in ((1, 'caliper'), (2, 'brake_disc')):
        if not (vals == code).any():
            continue
        select_only([up])
        bpy.ops.object.mode_set(mode='EDIT')
        bm = bmesh.from_edit_mesh(me)
        layer = bm.faces.layers.int.get('part')
        for f in bm.faces:
            f.select = f[layer] == code
        bmesh.update_edit_mesh(me)
        bpy.ops.mesh.separate(type='SELECTED')
        bpy.ops.object.mode_set(mode='OBJECT')
        new = [o for o in bpy.context.selected_objects if o is not up][0]
        new.name = f'{kind}_{key}'
        new.data.name = f'{kind}_{key}'
        M = new.matrix_world.copy()
        new.parent = up
        new.matrix_world = M
        me = up.data


def mirror_copy(src, name, M_game, parent):
    me = src.data.copy()
    me.name = name
    # mirror in the node's own frame: game z -> -z is Blender y -> -y
    me.transform(Matrix.Diagonal((1, -1, 1, 1)))
    me.flip_normals()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    ob.matrix_world = to_blender(M_game)
    return ob


def tag_upright_parts(b):
    """Before finalize: write an int face attribute 'part' (0 upright, 1 caliper, 2 disc) on the
    upright objects, from their design keys."""
    for node, g, o in b.parts:
        if not node.startswith('upright_'):
            continue
        me = o.data
        attr = me.attributes.new('part', 'INT', 'FACE')
        vals = np.zeros(len(me.polygons), dtype=np.int32)
        for p in me.polygons:
            nm = me.materials[p.material_index].name
            vals[p.index] = 1 if nm == 'body:caliper' else 2 if nm in ('body:disc', 'body:discp') else 0
        attr.data.foreach_set('value', vals)


def export(lod, final_root, files):
    path = os.path.join(OUT, f'{car.FILE}{SUFFIX[lod]}.glb')
    objs = [final_root] + list(final_root.children_recursive)
    select_only(objs)
    final_root['apex'] = json.dumps(car.META)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
              export_extras=True, export_materials='EXPORT', export_image_format='NONE', export_normals=True,
              export_texcoords=True, export_tangents=False, export_cameras=False, export_lights=False,
              export_animations=False, export_skins=False, export_morph=False)
    kw['export_vertex_color'] = 'ACTIVE' if lod == 'race' else 'NONE'
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError as e:
        print('exporter option issue:', e)
        kw.pop('export_vertex_color', None)
        bpy.ops.export_scene.gltf(**kw)
    # pack.mjs reads this
    used = sorted({s.material.name for o in objs if o.type == 'MESH' for s in o.material_slots if s.material})
    info = {'lod': lod, 'glb': path, 'materials': used, 'textures': files,
            'nodes': sorted(o.name for o in objs), 'meta': car.META}
    with open(os.path.join(OUT, f'{car.FILE}{SUFFIX[lod]}.json'), 'w') as f:
        json.dump(info, f, indent=1)
    print(f'  wrote {path}')


def main():
    t0 = time.time()
    for lod in args.lods.split(','):
        print(f'== {lod}', flush=True)
        reset_scene()
        b = build_lod(lod)
        tag_upright_parts(b)
        if lod == 'race':
            bake_vertex_colours(b, lod)
            files = {}
        else:
            files = bake_textures(b, lod)
        finalize(b, lod)
        export(lod, b.root, files)
        if lod == 'showroom':
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f'{car.FILE}_showroom.blend'))
        print(f'  {lod} done at {time.time() - t0:.0f}s', flush=True)


main()
