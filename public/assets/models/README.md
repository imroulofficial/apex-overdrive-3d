# Car models (.glb)

Drop finished car models here. The game looks for the file named in `src/data/cars.js`
(`model.url`) and falls back to the procedural car when it is missing or cannot be parsed,
so a model can land at any time without code changes.

| Car | File |
| --- | --- |
| RP-1 Vanta (Tier D starter) | `rp1_vanta.glb` |
| Fujin Type-R (Tier D) | `kz_kestrel.glb` |
| Kaze 370 (Tier D) | `rz_sakura.glb` |
| Trailblazer Rally (Tier C) | `rb_ridgeback.glb` |
| Mustang Bandit (Tier C) | `sv_stallion.glb` |
| Apex WRX (Tier C) | `dr_raptor.glb` |
| Bavaria M-Sport (Tier B) | `ag_aurelia.glb` |
| Stuttgart Carrera (Tier B) | `st_stratos.glb` |
| Monza GT3 (Tier B) | `mz_monza.glb` |
| Valkyrie GT-R (Tier A) | `valkyrie_gtr.glb` |
| Chimera Senna (Tier A) | `tm_tempesta.glb` |
| Revuelto Storm (Tier A) | `zn_zenith.glb` |

Each car can also have a race LOD next to it, `<file>_race.glb` (for example
`tm_tempesta_race.glb`). The race loads it when present and otherwise uses the showroom file,
so keep the race file under 10k triangles. Six cars race at once.

File names follow the permanent car ids, not the display names. A `.glb` brings its own
wheels, wing and doors: the Rims and Kit choices and the door hotspot only apply to the
procedural cars.

## Importing source models

`node tools/models/optimize.mjs <folder with the source .glb files>` builds both files for
every car listed in `tools/models/manifest.json`. It simplifies to the triangle budgets, turns
textures into WebP of up to 1024 px, drops the interior and bakes flat colours for the race
LOD, turns the nose to +X, renames the wheels and the paint material to the conventions below,
and applies meshopt compression. It also rewrites `CREDITS.md` from the manifest, so add each
model's author, licence and source there. Only use models whose licence allows commercial use,
because the game has ads and in-app purchases.

## Export conventions

- **Format:** binary glTF (`.glb`), textures embedded. Draco and Meshopt compression are
  both supported offline. Keep each car under ~3 MB and ~60k triangles for mid-range phones.
- **Orientation:** nose toward **+X**, roof toward **+Y** in glTF space. In Blender that
  means the car faces +X (the exporter keeps X and turns Blender's Z-up into Y-up). A
  model facing another way works too: set `model.rotationY` in `cars.js` (radians, e.g.
  `Math.PI / 2` for a car that faces +Z).
- **Scale:** any. The loader scales the car to `model.length` metres, centres it and puts
  the tyres on the ground. Set `model.scale` instead to keep the file's own scale.
- **Wheels:** four separate nodes named `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR`
  (with the nose at +X, the car's left side is -Z). Variants such as `Wheel.FL`, `wheel_front_left` also match, or
  map names explicitly with `model.wheels: { FL: 'MyNode', ... }`. Each wheel node should
  contain the tyre and rim only; brake calipers belong to the body so they do not spin.
- **Paint:** body panels use a material whose name contains `paint` (e.g. `CarPaint`).
  It is replaced by the game's clear-coat paint so the paint shop works. Override with
  `model.paintMaterials: ['Body', ...]`.
- **Lights (optional):** materials or meshes named `headlight…` / `taillight…` /
  `brakelight…` get the game's emissive lenses (light toggle, brake glow).
- **Exhausts (optional):** nodes named `exhaust…` anchor the nitro flames; otherwise they
  come out of the centre of the rear bumper.

Physics never reads the mesh, so handling, collisions and upgrades are unchanged by a
model swap.
