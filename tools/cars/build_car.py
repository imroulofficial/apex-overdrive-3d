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
    'showroom': dict(q=1.0, tex={'Body': 2048, 'Tyre': 1024, 'Rim': 512, 'Driver': 512}, orm=True),
    'drive': dict(q=0.43, tex={'Body': 1024, 'Tyre': 512, 'Rim': 256, 'Driver': 256}, orm=False),
    'race': dict(q=0.075, tex=None, orm=False),
    'cockpit': dict(q=1.0, tex={'Cockpit': 1024}, orm=True),
}
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
    if lod == 'cockpit':
        return 'Glass' if key == 'glass' else 'Cockpit'
    if key == 'paint':
        return 'CarPaint'
    head = key.split(':')[0]
    return {'body': 'Body', 'tyre': 'Tyre', 'rim': 'Rim', 'driver': 'Driver', 'glass': 'Glass'}.get(head, key)


BAKED = {'Body', 'Tyre', 'Rim', 'Driver', 'Cockpit'}

# Plain export materials (base colour linear RGBA, roughness, metalness, emissive).
PLAIN = {
    'CarPaint': ((0.62, 0.025, 0.02, 1), 0.3, 0.0, None),
    'Glass': ((0.03, 0.03, 0.035, 0.72), 0.05, 0.3, None),
    'headlight_lens': ((0.85, 0.88, 0.92, 1), 0.1, 0.0, (0.0, 0.0, 0.0)),
    'taillight_lens': ((0.30, 0.01, 0.01, 1), 0.15, 0.0, (0.25, 0.0, 0.0)),
    'exhaust': ((0.55, 0.47, 0.38, 1), 0.35, 1.0, None),
    # race LOD flat materials: COLOR_0 carries albedo x AO, the factor stays white
    'Body': ((1, 1, 1, 1), 0.45, 0.15, None),
    'Tyre': ((1, 1, 1, 1), 0.85, 0.0, None),
    'Rim': ((1, 1, 1, 1), 0.35, 0.7, None),
    'Driver': ((1, 1, 1, 1), 0.6, 0.0, None),
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


def text_strip():
    """Sidewall lettering strip (generic: the game's own name and the car's), white on black."""
    if 'strip' in TEX_IMAGES:
        return TEX_IMAGES['strip']
    from PIL import Image, ImageDraw, ImageFont
    W, H = 4096, 160
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    font = None
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
              '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'):
        if os.path.exists(f):
            font = ImageFont.truetype(f, 104)
            break
    font = font or ImageFont.load_default()
    words = ['APEX OVERDRIVE', 'TEMPESTA', 'APEX OVERDRIVE', 'TEMPESTA']
    x = 60
    for wd in words:
        d.text((x, 22), wd, fill=255, font=font)
        bb = d.textbbox((x, 22), wd, font=font)
        x = bb[2] + 330
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

    if key == 'paint':
        col, rough, coat = (0.62, 0.025, 0.02), 0.3, 1.0
    elif key == 'body:carbon':
        # 2x2 twill, 9 mm tows, with a glossy clear coat
        sx = k.math('MULTIPLY', ox, 1 / 0.009)
        sy = k.math('MULTIPLY', k.math('ADD', oy, oz), 1 / 0.009)
        tw = k.math('FRACT', k.math('MULTIPLY', k.math('ADD', k.math('FLOOR', sx), k.math('FLOOR', sy)), 0.25))
        weave = k.smooth(0.45, 0.55, tw)
        n = k.noise(vec, 40.0, 2.0)
        col = k.mix(weave, srgb((0.050, 0.051, 0.055)), srgb((0.085, 0.087, 0.093)))
        col = k.mix(k.math('MULTIPLY', n, 0.25), col, srgb((0.03, 0.03, 0.03)))
        rough = k.mixf(weave, 0.22, 0.30)
        height = k.math('MULTIPLY', weave, 0.3)
    elif key == 'body:satin':
        n = k.noise(vec, 160.0, 3.0)
        col, rough = srgb((0.055, 0.056, 0.06)), k.mixf(n, 0.48, 0.62)
    elif key == 'body:metal':
        col, rough, metal = (0.55, 0.55, 0.56), 0.33, 1.0
    elif key == 'body:mirror':
        col, rough, metal = (0.92, 0.93, 0.95), 0.04, 1.0
    elif key == 'body:disc':
        n = k.noise(vec, 90.0, 4.0)
        col = k.mix(n, srgb((0.10, 0.10, 0.105)), srgb((0.22, 0.21, 0.20)))
        rough = 0.65
    elif key == 'body:caliper':
        col, rough = srgb((0.78, 0.06, 0.04)), 0.35
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
        side = k.smooth(0.10, 0.17, k.math('ABSOLUTE', oy))
        R0 = car.RIM_R
        band = k.math('MULTIPLY', k.smooth(R0 + 0.075, R0 + 0.079, rr), k.smooth(R0 + 0.092, R0 + 0.088, rr))
        band = k.math('MULTIPLY', band, side)
        v = k.math('MULTIPLY', k.math('SUBTRACT', rr, R0 + 0.030), 1 / 0.036)
        cmb = k.node('ShaderNodeCombineXYZ')
        k.feed(cmb.inputs[0], k.math('FRACT', k.math('MULTIPLY', u, 2.0)))
        k.feed(cmb.inputs[1], v)
        img = k.image(text_strip(), cmb.outputs[0])
        letters = k.math('MULTIPLY', img.outputs['Color'], side)
        n = k.noise(vec, 220.0, 3.0)
        base = k.mix(k.math('MULTIPLY', n, 0.4), srgb((0.030, 0.030, 0.032)), srgb((0.045, 0.045, 0.047)))
        tread = k.smooth(0.155, 0.10, k.math('ABSOLUTE', oy))
        base = k.mix(k.math('MULTIPLY', tread, 0.5), base, srgb((0.055, 0.054, 0.052)))
        base = k.mix(letters, base, srgb((0.62, 0.62, 0.60)))
        col = k.mix(band, base, srgb((0.80, 0.05, 0.04)))
        rough = k.mixf(tread, 0.88, 0.72)
        height = k.math('ADD', k.math('MULTIPLY', letters, 0.6), k.math('MULTIPLY', band, 0.3))
    elif key == 'rim:alloy':
        r = k.node('ShaderNodeVectorMath', operation='LENGTH')
        cxy = k.node('ShaderNodeCombineXYZ')
        k.feed(cxy.inputs[0], ox)
        k.feed(cxy.inputs[1], oz)
        k.l.new(cxy.outputs[0], r.inputs[0])
        lip = k.smooth(0.2285, 0.231, r.outputs['Value'])
        col = k.mix(lip, srgb((0.11, 0.11, 0.12)), srgb((0.70, 0.70, 0.72)))
        rough = k.mixf(lip, 0.38, 0.18)
        metal = 1.0
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
    elif key == 'driver:glove':
        n = k.noise(vec, 260.0, 3.0)
        col = k.mix(k.math('MULTIPLY', n, 0.4), srgb((0.05, 0.05, 0.055)), srgb((0.12, 0.12, 0.13)))
        rough = 0.8
        height = k.math('MULTIPLY', n, 0.2)
    elif key == 'glass':
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
    k.feed(be.inputs['Color'], col)
    em = k.node('ShaderNodeEmission')
    em.name = 'metal_emit'
    k.l.new(mv.outputs[0], em.inputs['Color'])
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
    me.update()
    me.shade_smooth()
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
        out[g] = Mesh(mesh.V[used], [[remap[v] for v in mesh.F[i]] for i in fids], [mesh.mats[i] for i in fids])
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
        for node, mesh, parent in (('steering_wheel', parts['steering_wheel'], sw), ('hands', parts['hands'], sw),
                                   ('cockpit_shell', parts['cockpit_shell'], root)):
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
    for node, (M, holder) in placement.items():
        if holder is None:
            holder = empty(node, M, body if node in ('exhaust', 'headlight_lens', 'taillight_lens') else root)
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


def new_image(name, size, data=False):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
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
            continue
        mats = mats_of(objs)
        base = new_image(f'{g}_base', size)
        ao = new_image(f'{g}_ao', size, True)
        rough = new_image(f'{g}_rough', size, True)
        metal = new_image(f'{g}_metal', size, True)
        nrm = new_image(f'{g}_normal', size, True)
        bake('BASE', objs, base, mats, samples=4)
        bake('AO', objs, ao, mats, samples=args.samples)
        bake('ROUGHNESS', objs, rough, mats, samples=4)
        bake('METAL', objs, metal, mats, samples=1)
        bake('NORMAL', objs, nrm, mats, samples=4)
        B, A, R, Mt, N = (pixels(i) for i in (base, ao, rough, metal, nrm))
        print(f'    check {g}: base mean {B[..., :3].mean():.3f} ao {A[..., 0].mean():.3f}', flush=True)
        stem = os.path.join(OUT, f'{car.FILE}{SUFFIX[lod]}_{g}')
        if cfg['orm']:
            save_png(stem + '_base.png', B[..., :3])  # Blender stores sRGB images display-encoded
            orm = np.stack([A[..., 0], R[..., 0], Mt[..., 0]], -1)
            save_png(stem + '_orm.png', orm)
            files[g] = {'base': stem + '_base.png', 'orm': stem + '_orm.png', 'normal': stem + '_normal.png'}
        else:
            # AO multiplied into the albedo (decode sRGB, multiply, encode)
            lin = np.where(B[..., :3] <= 0.04045, B[..., :3] / 12.92, ((B[..., :3] + 0.055) / 1.055) ** 2.4)
            lin = lin * (0.25 + 0.75 * A[..., :1])
            save_png(stem + '_base.png', lin, srgb_encode=True)
            orm = np.stack([A[..., 0], R[..., 0], Mt[..., 0]], -1)
            save_png(stem + '_orm.png', orm)
            files[g] = {'base': stem + '_base.png', 'orm': stem + '_orm.png', 'normal': stem + '_normal.png'}
        save_png(stem + '_normal.png', N[..., :3])
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
            vals[p.index] = 1 if nm == 'body:caliper' else 2 if nm == 'body:disc' else 0
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
