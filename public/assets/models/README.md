# Car models (.glb)

Every car in the game is a real model from this folder; there is no procedural fallback, so a
car whose files are missing fails to load. Each car ships three levels of detail, named after
the permanent car id:

| File | Used for | Budget |
| --- | --- | --- |
| `<id>.glb` | Garage showroom (turntable, close-ups) | 150k triangles, 10 MB, colour textures 2048 px |
| `<id>_drive.glb` | The player's own car on track | 60k triangles, 3 MB, textures 1024 px |
| `<id>_race.glb` | Rival cars (flat vertex colours, no textures) | 10k triangles with any rim, 0.5 MB |

`test/car-models.test.js` fails when a file goes over budget. The loader falls back to a more
detailed file when a lower LOD is missing.

| Car | Tier | Files |
| --- | --- | --- |
| Flux 85 (starter) | D | `rp1_vanta*.glb` |
| Kestrel 930 | D | `kz_kestrel*.glb` |
| Stallion Jet | C | `sv_stallion*.glb` |
| Ridgeback 66 | C | `rb_ridgeback*.glb` |
| Aurelia Vision | B | `ag_aurelia*.glb` |
| Monza 55 | B | `mz_monza*.glb` |
| Tempesta 9X | A | `tm_tempesta*.glb` |
| Valkyrie GT-R (Supercar Bundle) | A | `rpx_hyperion*.glb` |

All eight come from the studio's Ca.zip asset pack; see `CREDITS.md`. File names follow the
permanent car ids, not the display names. A `.glb` brings its own wheels. The Stock rim shows
the model's own wheels; the other five rims swap in procedural rims at the model's tyre size.

## Importing source models

`node tools/models/optimize.mjs <folder with the source .glb files>` builds all three files
for every car listed in `tools/models/manifest.json`. It simplifies to the triangle budgets
(the garage file only as far as its budget needs, so detail is not thrown away), turns
textures into WebP (garage colour maps 2048 px, other maps and cabin textures smaller, drive
file 1024 px), drops the interior and bakes flat colours for the race LOD, turns the nose to +X, renames the wheels and the paint material to the conventions below,
and applies meshopt compression. Per-car manifest options: `drop` (parts removed from both
files), `raceDrop` / `driveDrop` (parts removed from those files), `raceTris` / `driveTris` /
`garageTris` (budgets), `wheelParts` (group loose tyre and rim meshes into the four wheels) and
`raceSimplify: "collapse"` for bodies with closed, welded panels, which keep their shape
better with edge collapse than with the default vertex clustering. Transmissive glass is
turned into tinted blended glass in the game, because transmission renders the scene twice. It also rewrites `CREDITS.md` from the manifest, so add each
model's author, licence and source there. Only use models whose licence allows commercial use,
because the game has ads and in-app purchases; a pack model the studio holds rights to is
marked `commercialRights: true` with the studio's licence line.

## Export conventions

- **Format:** binary glTF (`.glb`), textures embedded. Draco and Meshopt compression are
  both supported offline. See the budgets above.
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
