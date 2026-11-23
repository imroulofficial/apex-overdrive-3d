"""Subdivision-surface bodies: a low-poly quad control cage with creased edges, smoothed by
Blender's Subdivision Surface modifier (Catmull-Clark) and read back as a meshkit Mesh.

    cage = Mesh(V, F, mats)                      # quads, outward normals
    creases = {(i, j): 1.0, ...}                 # cage edges (vertex pairs) -> crease 0..1
    surf = subdivide(cage, levels=2, creases=creases)

Materials survive per face (each cage face's material goes to all its sub-faces). Works in the
game frame (no axis change: Blender only does the topology).
"""

import numpy as np

import bpy

from meshkit import Mesh


def subdivide(cage, levels, creases=None, name='_subd_cage'):
    if levels <= 0:
        return cage.copy()
    mats = sorted(set(cage.mats))
    mi = {m: i for i, m in enumerate(mats)}
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in cage.V], [], [tuple(f) for f in cage.F])
    me.update()
    me.polygons.foreach_set('material_index', np.array([mi[m] for m in cage.mats], dtype=np.int32))
    if creases:
        attr = me.attributes.get('crease_edge') or me.attributes.new('crease_edge', 'FLOAT', 'EDGE')
        lookup = {}
        for e in me.edges:
            a, b = e.vertices
            lookup[(min(a, b), max(a, b))] = e.index
        vals = np.zeros(len(me.edges), dtype=np.float32)
        for (a, b), w in creases.items():
            k = lookup.get((min(a, b), max(a, b)))
            if k is not None:
                vals[k] = max(vals[k], w)
        attr.data.foreach_set('value', vals)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('subd', 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels
    mod.quality = 3
    mod.use_creases = True
    mod.use_limit_surface = True
    mod.boundary_smooth = 'PRESERVE_CORNERS'
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    m2 = ev.to_mesh()
    V = np.empty(len(m2.vertices) * 3)
    m2.vertices.foreach_get('co', V)
    F = [list(p.vertices) for p in m2.polygons]
    idx = np.empty(len(m2.polygons), dtype=np.int32)
    m2.polygons.foreach_get('material_index', idx)
    out = Mesh(V.reshape(-1, 3), F, [mats[i] for i in idx])
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return out
