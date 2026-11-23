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
| `livery.py` | Livery helpers for a design's `livery()`: `stamp` (project text or numbers), `text_mask`, `number_mask`, `band`, `line`, `box`, `both_sides`. |
| `preview.mjs` | In-game garage and race screenshots, old vs new. Needs `preview-loader.patch` applied **locally only**. |
| `preview-loader.patch` | Temporary loader change used for the preview. Never commit it to `src/`. |

## Adding the next car

Copy `defs/tm_tempesta.py`, then keep the same interface:
- `ID`, `FILE`, `LENGTH`, and the axle and track constants
- `META`
- `build(q)`, which returns a dict of node meshes
- `wheel_layout()`
- `cockpit(q)`
- `livery(group, P, N, valid)` and `FACTORY_PAINT` (see below)

Change the curves and parts.

LODs are made by sampling the same parametric parts at fewer segments, not by decimation, so every LOD stays watertight.

## Materials and livery

Material keys in a design map to these glTF materials:
- `paint*` goes to `CarPaint`. Its map is the factory colour times a shade (AO, panel lines, black decals) and `extras.factoryLum`, so the game's `liveryPaint` keeps a player's paint clean.
- `carbon` / `carbon:satin` go to `Carbon`: a tiling twill weave on TEXCOORD_1 (box projected, `WEAVE_TILE` metres per tile, packed to 0..1 with `KHR_texture_transform`) plus baked AO and roughness.
- `body:*` (satin, gloss, white, disc), `rim:*`, `mirror` (`MirrorGlass`, planar 0..1 UV per glass for a live mirror texture).

`livery(group, P, N, valid)` gets per-texel car-frame position and normal (game axes) and returns:
- for `Body`: `{'layers': [(mask, linear_rgb or None, roughness or None), ...]}`
- for `CarPaint`: `{'shade': multiplier}`

Paint, black and carbon boundaries look sharpest when they fall on vertex rows (see `chassis_breaks` and `fillet_poly` corner indices in `defs/tm_tempesta.py`).

pack.mjs lifts the Carbon roughness for the game (three.js has no clear-coat lobe on these materials, and a ~0.1 roughness mirrors the green verges).
