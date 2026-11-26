"""Debug: a remaster npz (V, F, UV, optional per-face class C) -> glb with the source texture as an
unlit-ish material, for render.py (--nose-axis x).

    python tools/cars/remaster/npz2glb.py in.npz tex.png out.glb [--classes]
"""
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
src, tex, out = argv[:3]
classes = '--classes' in argv
d = np.load(src)
V, F, UV = d['V'], d['F'], d['UV']
bpy.ops.wm.read_factory_settings(use_empty=True)
# game frame -> Blender (x, -z, y) so the glTF export lands back in the game frame
B = np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1)
me = bpy.data.meshes.new('body')
me.from_pydata(B.tolist(), [], F.tolist())
uvl = me.uv_layers.new(name='UVMap')
uvl.data.foreach_set('uv', UV.reshape(-1))
m = bpy.data.materials.new('src')
m.use_nodes = True
nt = m.node_tree
bs = nt.nodes['Principled BSDF']
t = nt.nodes.new('ShaderNodeTexImage')
t.image = bpy.data.images.load(tex)
if '--clay' in argv:
    bs.inputs['Base Color'].default_value = (0.72, 0.72, 0.72, 1)
    bs.inputs['Roughness'].default_value = 0.18
else:
    nt.links.new(t.outputs[0], bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value = 0.4
me.materials.append(m)
if classes and 'C' in d:
    cols = [(0.6, 0.6, 0.6), (0.8, 0.05, 0.05), (0.05, 0.3, 1.0), (0.9, 0.9, 0.1), (1, 0.9, 0.2), (1, 0.2, 0.6), (0.2, 0.9, 0.3), (0.5, 0.3, 0.1)]
    for i, c in enumerate(cols):
        mm = bpy.data.materials.new(f'c{i}')
        mm.diffuse_color = (*c, 1)
        mm.use_nodes = True
        mm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*c, 1)
        mm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
        me.materials.append(mm)
    me.polygons.foreach_set('material_index', (d['C'].astype(np.int32) + 1))
me.update()
me.shade_smooth()
ob = bpy.data.objects.new('body', me)
bpy.context.scene.collection.objects.link(ob)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False)
print('wrote', out)
