"""Cycles approval renders of a car glb (the build export or any older model).

    python tools/cars/render.py --glb tools/cars/build/tm_tempesta/tm_tempesta.glb \
        [--tex tools/cars/build/tm_tempesta/tm_tempesta.json] [--paint 0.62,0.025,0.02] \
        [--env studio|outdoor] [--views f34,r34,side,top,front,rear] [--out dir] [--prefix new_]
        [--samples 96] [--res 1600x1000] [--cockpit tools/cars/build/tm_tempesta/tm_tempesta_cockpit.json]

With --tex, materials are rebuilt from the baked PNGs (base, ORM, normal) named in the build json;
otherwise the glb's own materials are used (that is how the shipped models render). The paint
colour replaces CarPaint (only with --tex, or with --repaint for other models).
"""

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument('--glb', required=True)
ap.add_argument('--tex')
ap.add_argument('--cockpit')
ap.add_argument('--paint', default='factory', help="'factory' (the livery map as is) or linear r,g,b")
ap.add_argument('--repaint', action='store_true')
ap.add_argument('--env', default='studio')
ap.add_argument('--views', default='f34,r34,side,top,front,rear')
ap.add_argument('--out', default='.')
ap.add_argument('--prefix', default='')
ap.add_argument('--samples', type=int, default=96)
ap.add_argument('--res', default='1600x1000')
ap.add_argument('--length', type=float, default=5.2)
ap.add_argument('--nose-axis', default='x', help="'z' for source models with the nose on +Z")
ap.add_argument('--hide', default='', help='comma-separated node names to hide')
ap.add_argument('--glass-alpha', type=float, default=0.82, help='car glass opacity (closed cars: ~0.45)')
ap.add_argument('--windows', default='closed', help="'open': door windows in their META open pose")
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = args.samples
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 8
W, H = (int(v) for v in args.res.split('x'))
sc.render.resolution_x, sc.render.resolution_y = W, H
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Medium High Contrast'


def import_car(path, tex=None):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in objs if o.parent is None]
    holder = bpy.data.objects.new('car_holder', None)
    sc.collection.objects.link(holder)
    for r in roots:
        r.parent = holder
    if args.nose_axis == 'z':
        holder.rotation_euler[2] = math.radians(90)
    bpy.context.view_layer.update()
    meshes = [o for o in objs if o.type == 'MESH']
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    s = args.length / (mx.x - mn.x)
    holder.scale = (s, s, s)
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    holder.location = (-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z)
    bpy.context.view_layer.update()
    return objs


def srgb_to_lin(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def paint_material(rgb):
    m = bpy.data.materials.new('render_paint')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = 0.25
    b.inputs['Roughness'].default_value = 0.32
    b.inputs['Coat Weight'].default_value = 1.0
    b.inputs['Coat Roughness'].default_value = 0.03
    return m


def textured_material(name, files, uv1=None):
    m = bpy.data.materials.new('render_' + name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']

    def img(path, data, uv=None):
        nd = nt.nodes.new('ShaderNodeTexImage')
        nd.image = bpy.data.images.load(path, check_existing=True)
        nd.image.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
        if uv:
            um = nt.nodes.new('ShaderNodeUVMap')
            um.uv_map = uv
            nt.links.new(um.outputs['UV'], nd.inputs['Vector'])
        return nd

    if name == 'CarPaint':
        # The game's paint over the livery map: factory = the map as is; a player colour =
        # colour x clamp(luminance(map) / factoryLum, 0, 1.6) (carPaint.js liveryPaint).
        base = img(files['base'], False)
        if args.paint == 'factory':
            nt.links.new(base.outputs['Color'], b.inputs['Base Color'])
        else:
            rgb = nt.nodes.new('ShaderNodeRGBToBW')
            nt.links.new(base.outputs['Color'], rgb.inputs[0])
            sh = nt.nodes.new('ShaderNodeMath')
            sh.operation = 'DIVIDE'
            sh.use_clamp = False
            nt.links.new(rgb.outputs[0], sh.inputs[0])
            sh.inputs[1].default_value = files['factoryLum']
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            mix.inputs[6].default_value = (*(float(v) for v in args.paint.split(',')), 1)
            cl = nt.nodes.new('ShaderNodeClamp')
            nt.links.new(sh.outputs[0], cl.inputs['Value'])
            cl.inputs['Max'].default_value = 1.6
            cmb = nt.nodes.new('ShaderNodeCombineColor')
            for i in range(3):
                nt.links.new(cl.outputs[0], cmb.inputs[i])
            nt.links.new(cmb.outputs[0], mix.inputs[7])
            nt.links.new(mix.outputs[2], b.inputs['Base Color'])
        b.inputs['Metallic'].default_value = 0.25
        b.inputs['Roughness'].default_value = 0.32
        b.inputs['Coat Weight'].default_value = 1.0
        b.inputs['Coat Roughness'].default_value = 0.03
        return m
    if 'weave_base' in files:
        base = img(files['weave_base'], False, uv1)
        nt.links.new(base.outputs['Color'], b.inputs['Base Color'])
        nm = img(files['weave_normal'], True, uv1)
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nmap.uv_map = uv1 or ''
        nmap.inputs['Strength'].default_value = 0.45
        nt.links.new(nm.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], b.inputs['Normal'])
        orm = img(files['orm'], True)
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(orm.outputs['Color'], sep.inputs[0])
        nt.links.new(sep.outputs[1], b.inputs['Roughness'])
        # AO as a multiply on the weave (Cycles makes its own occlusion; keep it subtle)
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 0.5
        nt.links.new(base.outputs['Color'], mix.inputs[6])
        nt.links.new(sep.outputs[0], mix.inputs[7])
        nt.links.new(mix.outputs[2], b.inputs['Base Color'])
        b.inputs['Coat Weight'].default_value = 0.8
        b.inputs['Coat Roughness'].default_value = 0.06
        return m
    base = img(files['base'], False)
    nt.links.new(base.outputs['Color'], b.inputs['Base Color'])
    if os.path.exists(files.get('orm', '')):
        orm = img(files['orm'], True)
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(orm.outputs['Color'], sep.inputs[0])
        nt.links.new(sep.outputs[1], b.inputs['Roughness'])
        nt.links.new(sep.outputs[2], b.inputs['Metallic'])
    if os.path.exists(files.get('normal', '')):
        nm = img(files['normal'], True)
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(nm.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], b.inputs['Normal'])
    if name == 'Gauges':
        nt.links.new(base.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = 0.25
    if name in ('Body',):
        b.inputs['Coat Weight'].default_value = 0.25
        b.inputs['Coat Roughness'].default_value = 0.08
    return m


def plain(name, col, rough, metal, emit=None, alpha=1.0):
    m = bpy.data.materials.new('render_' + name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit[0], 1)
        b.inputs['Emission Strength'].default_value = emit[1]
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
    return m


def apply_materials(objs, tex_json):
    info = json.load(open(tex_json))
    paint = paint_material((0.62, 0.025, 0.02) if args.paint == 'factory' else tuple(float(v) for v in args.paint.split(',')))
    mats = {
        'CarPaint': paint,
        'Glass': plain('Glass', (0.02, 0.025, 0.027), 0.03, 0.4, alpha=args.glass_alpha),
        'ClearGlass': plain('ClearGlass', (0.85, 0.88, 0.9), 0.01, 0.0, alpha=0.10),
        'MirrorGlass': plain('MirrorGlass', (0.85, 0.87, 0.9), 0.02, 1.0),
        'headlight_lens': plain('head', (0.8, 0.85, 0.9), 0.05, 0.0, ((0.9, 0.95, 1.0), 1.5)),
        'taillight_lens': plain('tail', (0.25, 0.005, 0.005), 0.1, 0.0, ((1.0, 0.03, 0.02), 2.5)),
        'exhaust': plain('exhaust', (0.55, 0.45, 0.35), 0.32, 1.0),
    }
    uv1 = None
    for o in objs:
        if o.type == 'MESH' and len(o.data.uv_layers) > 1:
            uv1 = o.data.uv_layers[1].name
            break
    for g, files in info['textures'].items():
        mats[g] = textured_material(g, files, uv1)
    for g, (r, mt) in {'Body': (0.45, 0.15), 'Tyre': (0.85, 0.0), 'Rim': (0.35, 0.7), 'Driver': (0.6, 0.0),
                       'Carbon': (0.3, 0.0), 'Interior': (0.7, 0.0), 'Gauges': (0.3, 0.0)}.items():
        if g not in mats:  # race LOD: albedo x AO in the vertex colours
            m = plain(g, (1, 1, 1), r, mt)
            nt = m.node_tree
            at = nt.nodes.new('ShaderNodeVertexColor')
            at.layer_name = 'Color'
            nt.links.new(at.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
            mats[g] = m
    for o in objs:
        if o.type != 'MESH':
            continue
        for s in o.material_slots:
            if s.material is None:
                continue
            nm = s.material.name.split('.')[0]
            if nm in mats:
                s.material = mats[nm]


def repaint(objs):
    paint = paint_material(tuple(float(v) for v in args.paint.split(',')))
    for o in objs:
        for s in getattr(o, 'material_slots', []):
            if s.material and 'paint' in s.material.name.lower():
                s.material = paint


car = import_car(args.glb)
if args.tex:
    apply_materials(car, args.tex)
elif args.repaint:
    repaint(car)
hidden = set(filter(None, args.hide.split(',')))
for o in car:
    if o.name.split('.')[0] in hidden:
        o.hide_render = True
        for ch in o.children_recursive:
            ch.hide_render = True

if args.windows == 'open':
    _m = None
    for _p in (args.tex,):
        if _p:
            _m = json.load(open(_p)).get('meta')
    from mathutils import Matrix, Quaternion
    B3 = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
    for o in car:
        pose = (_m or {}).get('windows', {}).get(o.name.split('.')[0]) if isinstance((_m or {}).get('windows'), dict) else None
        if not pose or o.type != 'MESH':
            continue
        qx, qy, qz, qw = pose['open']['quaternion']
        Rg = Quaternion((qw, qx, qy, qz)).to_matrix()
        Rb = B3 @ Rg @ B3.transposed()
        tg = Vector(pose['open']['position'])
        tb = B3 @ tg
        M = Matrix.Translation(tb) @ Rb.to_4x4()
        # the node sits at the car origin: pose in the car's (holder's) frame
        H = o.parent.matrix_world if o.parent else Matrix()
        o.matrix_world = H @ M @ H.inverted() @ o.matrix_world
cockpit_objs = []
if args.cockpit:
    info = json.load(open(args.cockpit))
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=info['glb'])
    cockpit_objs = [o for o in bpy.data.objects if o not in before]
    apply_materials(cockpit_objs, args.cockpit)

# ---------------------------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------------------------

world = bpy.data.worlds.new('w')
sc.world = world
world.use_nodes = True
wn = world.node_tree.nodes
bg = wn['Background']


def area(name, loc, size, energy, color=(1, 1, 1), shape='RECTANGLE', size_y=None):
    L = bpy.data.lights.new(name, 'AREA')
    L.energy = energy
    L.color = color
    L.shape = shape
    L.size = size
    L.size_y = size_y or size
    o = bpy.data.objects.new(name, L)
    sc.collection.objects.link(o)
    o.location = loc
    d = Vector((0, 0, 0.4)) - Vector(loc)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return o


def floor(color, rough, size=60):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    f = bpy.context.object
    m = bpy.data.materials.new('floor')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    f.data.materials.append(m)
    return f


if args.env == 'studio':
    bg.inputs[0].default_value = (0.035, 0.037, 0.042, 1)
    bg.inputs[1].default_value = 1.0
    floor((0.16, 0.165, 0.175), 0.38, 80)
    area('key', (2.5, -5.5, 5.5), 6.0, 2600, (1.0, 0.97, 0.93), size_y=3.0)
    area('fill', (-6.0, 4.0, 3.0), 6.0, 900, (0.85, 0.9, 1.0))
    area('rim', (-5.5, -4.0, 4.0), 3.0, 1300, (1.0, 1.0, 1.0), size_y=8.0)
    area('top', (0, 0, 7.5), 7.0, 1500, (1, 1, 1), size_y=3.0)
else:
    sky = wn.new('ShaderNodeTexSky')
    for t in ('MULTIPLE_SCATTERING', 'NISHITA', 'HOSEK_WILKIE'):
        try:
            sky.sky_type = t
            break
        except TypeError:
            continue
    try:
        sky.sun_elevation = math.radians(28)
        sky.sun_rotation = math.radians(215)
    except AttributeError:
        pass
    world.node_tree.links.new(sky.outputs[0], bg.inputs[0])
    bg.inputs[1].default_value = 0.35
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 4.2
    sun.angle = math.radians(1.2)
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(62), 0, math.radians(215))
    f = floor((0.06, 0.06, 0.065), 0.8, 200)
    # asphalt grain
    nt = f.data.materials[0].node_tree
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 300
    ramp = nt.nodes.new('ShaderNodeMapRange')
    ramp.inputs['To Min'].default_value = 0.035
    ramp.inputs['To Max'].default_value = 0.085
    nt.links.new(n.outputs['Fac'], ramp.inputs['Value'])
    nt.links.new(ramp.outputs['Result'], nt.nodes['Principled BSDF'].inputs['Base Color'])

# ---------------------------------------------------------------------------------------------
# Cameras (Blender frame: x nose, -y the car's right side, z up)
# ---------------------------------------------------------------------------------------------

VIEWS = {
    #            location               target            lens  ortho
    'f34': ((5.6, 4.6, 1.9), (0.1, 0, 0.42), 55, None),
    'r34': ((-5.6, 4.6, 2.0), (-0.1, 0, 0.45), 55, None),
    'side': ((0, 12, 0.6), (0, 0, 0.6), 0, 5.7),
    'top': ((0, 0, 12), (0, 0, 0), 0, 5.7),
    'front': ((12, 0, 0.55), (0, 0, 0.55), 0, 2.6),
    'rear': ((-12, 0, 0.6), (0, 0, 0.6), 0, 2.6),
    'f34r': ((5.6, -4.6, 1.9), (0.1, 0, 0.42), 55, None),
    # the game garage's opening shot (cameraRig.js SHOTS.body, 42 deg vertical fov)
    'garage': ((4.6, -5.1, 1.75), (0, 0, 0.55), 34, None),
    'hero': ((4.4, 3.2, 0.75), (0.2, 0, 0.45), 40, None),
    'wheel': ((2.25, -1.85, 0.48), (1.425, -0.84, 0.37), 70, None),
    'suspension': ((2.55, -1.15, 1.25), (1.35, -0.45, 0.38), 50, None),
    'rear_corner': ((-2.9, -1.9, 0.75), (-1.95, -0.6, 0.40), 50, None),
    'driver': ((0.9, 1.25, 1.55), (-0.15, 0, 0.82), 50, None),
    'halo': ((1.1, -0.9, 1.35), (-0.05, 0, 0.88), 45, None),
    # the game's driver view: eye from the build's META, looking 30 m down the nose 0.9 m lower,
    # 70 degrees vertical field of view (chaseCamera.js COCKPIT / BASE_FOV)
    'cockpit': (None, None, 'fov70', None),
    'aero': ((1.55, -2.0, 0.95), (0.35, -0.55, 0.32), 42, None),
    'sidepod': ((0.2, -2.6, 1.55), (-0.45, -0.45, 0.42), 40, None),
    'front_wing': ((3.35, -1.55, 0.55), (2.25, -0.55, 0.18), 45, None),
    'rear_wing': ((-3.3, -1.75, 1.25), (-2.35, -0.55, 0.72), 45, None),
    'diffuser': ((-3.6, -0.9, 0.18), (-2.0, 0.0, 0.25), 38, None),
    # closed GT close-ups (Aurelia)
    'gt_wheel': ((2.30, -1.75, 0.50), (1.40, -0.80, 0.36), 62, None),
    'gt_lights': ((3.05, -1.35, 0.88), (2.12, -0.60, 0.62), 45, None),
    'gt_grille': ((3.55, -0.55, 0.70), (2.20, 0.0, 0.47), 48, None),
    'gt_tail': ((-3.30, -1.45, 1.00), (-2.20, -0.40, 0.60), 45, None),
    'gt_interior': ((0.10, -2.35, 1.30), (-0.25, 0.0, 0.80), 40, None),
    'gt_window': ((0.60, -3.20, 1.20), (0.05, 0.0, 0.85), 38, None),
    'gt_side34': ((1.6, -5.4, 1.2), (0.0, 0.0, 0.6), 45, None),
    'gt_hands': ((-0.16, 0.08, 1.16), (0.07, 0.50, 0.97), 40, None),
}
EYE = (-0.175, 0.0, 0.900)
_meta = None
for _p in (args.tex, args.cockpit):
    if _p:
        try:
            _meta = json.load(open(_p)).get('meta')
        except Exception:
            pass
        if _meta:
            break
if _meta and 'eye' in _meta:
    ex, ey, ez = _meta['eye']
    EYE = (ex, -ez, ey)
    VIEWS['cockpit'] = (EYE, (ex + 30, -ez, ey - 0.9), 'fov70', None)
else:
    VIEWS['cockpit'] = (EYE, (EYE[0] + 30, 0, EYE[2] - 0.9), 'fov70', None)

cam_data = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
for v in args.views.split(','):
    loc, tgt, lens, ortho = VIEWS[v]
    cam.location = loc
    d = Vector(tgt) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    if v == 'top':
        cam.rotation_euler = (0, 0, 0)
    cam_data.clip_start = 0.02 if v == 'cockpit' else 0.1
    if ortho:
        cam_data.type = 'ORTHO'
        cam_data.ortho_scale = ortho
    elif lens == 'fov70':
        cam_data.type = 'PERSP'
        cam_data.sensor_fit = 'VERTICAL'
        cam_data.angle_y = math.radians(70)
    else:
        cam_data.type = 'PERSP'
        cam_data.sensor_fit = 'AUTO'
        cam_data.lens = lens
    sc.render.filepath = os.path.join(args.out, f'{args.prefix}{v}.png')
    bpy.ops.render.render(write_still=True)
    print('rendered', sc.render.filepath, flush=True)
