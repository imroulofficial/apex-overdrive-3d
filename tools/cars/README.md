# Car pipeline (pilot: Tempesta)

Every car is generated from a Python design file in `defs/`. There are no .blend files and no
downloaded meshes. Blender (bpy) builds the mesh, bakes the textures, and writes one glTF per level of detail.
`pack.mjs` compresses those into the game files and checks them against the new-car contract
(PHASE0-AUDIT section 2.5).

```
pip install bpy==5.2.4 pillow numpy             # Python 3.13 venv, or run inside Blender 5.2
python tools/cars/build_car.py --car tm_tempesta # -> tools/cars/build/tm_tempesta/ (gitignored)
node   tools/cars/pack.mjs tm_tempesta           # -> tools/cars/out/*.glb + tm_tempesta-stats.json
python tools/cars/render.py --glb tools/cars/build/tm_tempesta/tm_tempesta.glb \
       --tex tools/cars/build/tm_tempesta/tm_tempesta.json --views f34,r34,side --env studio
```

| file | what |
|---|---|
| `meshkit.py` | Watertight primitives: loft, sweep, revolve, strut, slab, wing/airfoil, blob, patch slab, and an open-edge check. |
| `defs/tm_tempesta.py` | The Tempesta design: dimensions, curves, every part, wheels, driver, cockpit parts, META. |
| `build_car.py` | Builds each LOD from the design at a detail level `q`, unwraps it, bakes in Cycles (base, AO, roughness, metal, normal, or vertex colours for race), and splits the node tree. |
| `pack.mjs` | Packs to WebP textures and meshopt, then measures triangles, bytes, open edges, tyre roundness and bounds. |
| `render.py` | Cycles turntable and close-up renders (studio and outdoor), with paint override, cockpit view and hidden nodes. |
| `preview.mjs` | In-game garage and race screenshots, old vs new. Needs `preview-loader.patch` applied **locally only**. |
| `preview-loader.patch` | Temporary loader change used for the preview. Never commit it to `src/`. |

## Adding the next car

Copy `defs/tm_tempesta.py`, then keep the same interface:
- `ID`, `FILE`, `LENGTH`, and the axle and track constants
- `META`
- `build(q)`, which returns a dict of node meshes
- `wheel_layout()`
- `cockpit(q)`

Change the curves and parts.

LODs are made by sampling the same parametric parts at fewer segments, not by decimation, so every LOD stays watertight.
