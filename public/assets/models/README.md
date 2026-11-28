# Car models (.glb)

Every car in the game is a real model from this folder; there is no procedural fallback, so a
car whose files are missing fails to load. Each car ships three levels of detail and its own
driver-view cabin, named after the permanent car id:

| File | Used for | Budget |
| --- | --- | --- |
| `<id>.glb` | Garage showroom (turntable, close-ups) | 150k triangles, 10 MB, colour textures 2048 px |
| `<id>_drive.glb` | The player's own car on track | 60k triangles, 3 MB, textures 1024 px |
| `<id>_race.glb` | Rival cars (flat vertex colours, no textures) | 10k triangles with any rim, 0.5 MB |
| `<id>_cockpit.glb` | The cockpit view (dash, seats, steering wheel with hands, dials, mirrors) | 60k triangles, 1.5 MB |

## versionCode 75: the Blender cars

Since v75 all eight cars are built in Blender by the studio's car pipeline (`tools/cars` on the
`pilot/cars` branch, not shipped with the game): Tempesta FX, Aurelia GT, Stallion 68 and
Kestrel Rally modelled on the original designs, and Lumen EV, Vipera R, Valkyrie GT-R and
Ridgeback Trail remastered from the original `New Car.zip` sources. Their files carry the
design data as `extras.apex` (a JSON string) on the root node, which the game reads
(`src/assets/modelLoader.js`, `src/race/carCockpit.js`):

- `axles`, `wheelbase`, `wheelRadius.front` / `.rear` (rolling radius per axle), `halfTrack`;
  each `wheel_XX` node's origin is on its axle, and `upright_XX` (disc, caliper, upright)
  steers with the wheel without spinning;
- `eye` (the driver's eye, car frame: x forward, y up, z right), `steeringWheel`, `gauges`
  (dial faces in the `Gauges` atlas: label, scale, sweep), `mirrorGlass` (every `MirrorGlass`
  surface shows the live rear view);
- `windows` (`window_L` / `window_R` closed and open poses, or `false` for a car without door
  windows), `hideInCockpit` (body nodes the cockpit view hides: interior, driver, glass, door
  windows, steering wheel), `cockpitFx` (no speed lines, particles fade near the eye);
- `factoryPaint` (linear RGB): the colour the Factory Livery shows on that car.

Lamp lenses are `headlight_lens` / `taillight_lens` nodes (the Tempesta's rain light is part
of its tail lens). Glass keeps its alpha so the cabin shows through.

`test/car-models.test.js` fails when a file goes over budget. The loader falls back to a more
detailed file when a lower LOD is missing.

| Car | Tier | Files | Source |
| --- | --- | --- | --- |
| Lumen EV (starter) | D | `rp1_vanta*.glb` | New Car 3 (remastered, v75) |
| Kestrel Rally | D | `kz_kestrel*.glb` | New Car 6 (Blender model, v75) |
| Stallion 68 | C | `sv_stallion*.glb` | New Car 5 (Blender model, v75) |
| Ridgeback Trail | C | `rb_ridgeback*.glb` | New Car 8 (remastered, v75) |
| Aurelia GT | B | `ag_aurelia*.glb` | New Car 4 (Blender model, v75) |
| Vipera R | B | `mz_monza*.glb` | New Car 7 (remastered, v75) |
| Tempesta FX | A | `tm_tempesta*.glb` | New Car 1 (Blender model, v75) |
| Valkyrie GT-R (Supercar Bundle) | A | `rpx_hyperion*.glb` | New Car 2 (remastered, v75) |

All eight are the studio's own original designs from `New Car.zip` (2026-10-23); see
`CREDITS.md`. The import pipeline below (`tools/models/optimize.mjs`) built the files up to v74
and still documents the single-mesh source models. File names follow the permanent car ids, not the display names. A `.glb` brings
its own wheels. The Stock rim shows the model's own wheels; the other five rims swap in
procedural rims at the model's tyre size.

### Single-mesh (generated) models

AI model generators export a car as one welded surface with one baked colour texture: no
wheel nodes, no paint material. Manifest entries with `segment` go through
`tools/models/segment.mjs`, which:

- finds the four wheels from their treads (each tread triangle votes for an axle position and
  radius) and cuts everything inside each tyre's cylinder out as `wheel_FL` ... `wheel_RR`;
- sorts the body's triangles by texture colour into `CarPaint` (the `paint` colour rule),
  `headlight_lens` / `taillight_lens` (front / rear facing, bright or red, optionally inside a
  `head` / `tail` box) and `Body`;
- simplifies body and wheels apart (body ~120k / 34k / 7k triangles, each wheel 7k / 1.5k / 300
  for the showroom / drive / rival files), after welding away the generator's split normals.

The paint shell keeps the texture: in the game it is a shading layer under the paint colour,
and the **Factory Livery** finish (the default paint) shows the model's own colours. The rival
LOD carries the texture as vertex colours.

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
  `brakelight…` / `rainlight…` (or `headlight_lens` / `taillight_lens` nodes) get the game's emissive lenses (light toggle, brake glow).
- **Exhausts (optional):** nodes named `exhaust…` anchor the nitro flames; otherwise they
  come out of the centre of the rear bumper.

Physics never reads the mesh, so handling, collisions and upgrades are unchanged by a
model swap.
