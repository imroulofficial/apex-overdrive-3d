# Apex Overdrive: 3D Racing

Offline-first 3D arcade racer for Android by **Red Pen Studio**.

| | |
|---|---|
| Package | `com.redpenstudio.apexoverdrive` |
| Android | minSdk 24 · targetSdk 36 · compileSdk 36 · immersive fullscreen |
| Stack | Three.js (WebGL2) + Vite, wrapped with Capacitor 8 |
| Audience | 13+, no sign-up, no analytics; gameplay is offline, cloud save, ads and Play Billing use the network when available |

## Sampled car audio at the device's native rate (this release)

- **Recorded car sounds** (`src/audio/samples.js`, `public/assets/audio/`): the engine, turbo, nitro, tyre screech, blow-off and exhaust pops now play CC0 field recordings by Joseph Sardin ([BigSoundBank](https://bigsoundbank.com), sources and licences in `public/assets/audio/CREDITS.md`) instead of oscillators. 14 samples, 1.4 MB of 16-bit 48 kHz WAV inside the app; nothing downloads.
- **Engine**: five RPM loops crossfaded with equal power and pitch-shifted with the gearbox (AC Cobra V8 idle, a loud four-cylinder exhaust on load for the low revs, an Aston Martin V12 pull for mid, high and top). `node tools/audio/samples.mjs` cuts them from the lossless originals, resampling each slice of the rev sweep against its own tracked pitch so it holds one RPM and loops cleanly. Turbo whistle and spool hiss come from recorded rushing air, nitro from a recorded blower, the screech from two recorded squeals (light and full drift) pitched with the slip angle.
- **Native sample rate**: the AudioContext no longer asks for 32 kHz on Android; it runs at the hardware's own rate (48 kHz on most phones), so nothing is resampled on the way to the speaker and the mix keeps its top octave. The sampled car costs the audio thread about half what the synthesized one did at 32 kHz, and the soundtrack's hall reverb is now one mono convolution widened with a short delay (the old stereo tail was the heaviest node in the graph), so the whole graph at 48 kHz costs what it used to at 32 kHz (`node tools/audio/render.mjs --stall`). The HUD, race cues, weather and soundtrack are still synthesized.

## 60 FPS pass: culling, mobile resolution and memory

- **Scenery culling** (`src/render/culling.js`): every forest, boulder field and big merged mesh used to span the whole track, so the GPU drew all of it every frame, behind the camera included. Static instanced scenery is now bucketed into 160 m cells and only the cells in front of the camera and within their draw distance (240x the object's radius, capped by fog) are packed into the batch: still one draw call, none when nothing is in view. Heavy merged meshes (verges, the alpine village, city concrete and neon) are split into at most 8 chunks that share the original buffers and are frustum-culled one by one, in the main and shadow passes. Redwoods and palms switch to a far LOD (about 1/5 of the triangles) beyond 220 m.
- **Resolution**: phones and tablets never render above a 1.25 pixel ratio, whatever the quality setting. The WebGL context already asked for `powerPreference: 'high-performance'`.
- **Shadows**: only the player's car casts into the sun's shadow map; rivals sit on their instanced contact (blob) shadow.
- **Memory**: the track is freed when the player returns to the garage (it stays loaded on the world map for retries). Fixed leaks per race: the environment cubemap target, ground and road textures held in shader closures, the bloom pass, Time Trial gate banners, rival paints, instance buffers and the shadow map. The garage frees the GPU copy and the parsed model of a car leaving the turntable.
- **Measured** headless (`node tools/perf/bench.mjs --quality high`, 2400x1080 phone, 9 stages across the three chapters): triangles per frame 486k -> 329k, render buffer 1200x540 -> 1000x450, shadow pass 12 -> 9 draws, draw calls 120 -> 122. GPU memory in the garage stays flat across race cycles (was +3 to +4 textures per race), and browsing all 8 cars keeps the JS heap at ~50 MB (was 116 MB). `node tools/perf/campaign.mjs` drives all 60 stages through the game flow and checks every result and saved star.

## Hardware audit: eight real cars

The roster is now the eight usable cars from the studio's Ca.zip pack, all real models; the procedural car bodies are gone.

- **Roster** (`src/data/cars.js`), two cars per tier, each with one job: Tier D Street Classics **Flux 85** (starter, all-rounder) and **Kestrel 930** (drift); Tier C Muscle & Heritage **Stallion Jet** (launch) and **Ridgeback 66** (all-weather endurance); Tier B Vision Tourers **Aurelia Vision** (nitro) and **Monza 55** (cornering grip); Tier A Hypercars **Tempesta 9X** (downforce prototype) and **Valkyrie GT-R** (top speed, Supercar Bundle). Ids are unchanged for the kept cars. The four retired cars (`rz-sakura`, `dr-raptor`, `st-stratos`, `zn-zenith`) and every bought rear wing are refunded in coins once, when an old save loads (`retiredRefund` in `src/core/saveSchema.js`). Rivals now drive the roster's cars too.
- **Three levels of detail per car** (`tools/models/optimize.mjs`): the showroom file (up to 150k triangles, 2048 px paint-side textures), a drive file for the player's own car on track (about 40k triangles) and a rival file under 10k triangles with flat colours. See `public/assets/models/README.md`.
- **Removed**: `src/garage/carShapes.js` and the procedural car builder, the rear-wing shop (the Kit tab keeps smoke and nitro colours), the procedural fallback in the model loader, and a handful of unused exports.
- **Grounded in the track's light**: car bodies receive sun shadows, every car sits on an instanced contact shadow (one draw call for the field), head and tail lights switch on at dusk, at night and in bad weather, and paint flake is laid out in metres so it looks the same on every model.

## Phases 13-14: 12-car roster and the sunset showroom

Blueprint section 04. All twelve launch cars are in the garage, every one built procedurally on the device (no downloaded assets), and the garage is now the architectural showroom from blueprint 4.4.

- **Roster** (`src/data/cars.js`): Tier D Street Tuners **RP-1 Vanta** (starter), **Fujin Type-R**, **Kaze 370**; Tier C Offroad & Muscle **Trailblazer Rally**, **Mustang Bandit**, **Apex WRX**; Tier B Grand Tourers **Monza GT3**, **Stuttgart Carrera**, **Bavaria M-Sport**; Tier A Hypercars **Valkyrie GT-R** (Supercar Bundle), **Chimera Senna**, **Revuelto Storm**. Car ids are unchanged (the Valkyrie is still `rpx-hyperion`), so saves and the Play grant keep working. Display names live on one line each in `DISPLAY_NAMES`; several echo real model names (see the PR notes), so they can be swapped there without touching ids.
- **Bodies** (`src/garage/carShapes.js`): eleven silhouettes from one lofted construction: hot hatch, long-hood Z coupe, raised rally crossover (light pod, roof rails, mud flaps), modern muscle (blunt nose, quad pipes), four-door rally sedan, rear-engined GT and its GT3 track version, front-engined grand tourer, cab-forward track hypercar, a sharp wedge, and the original coupe (Vanta, and the Valkyrie with its aero kit). Smooth fender peaks rise over the wheels where the hood is low; arches are cut open cleanly.
- **Performance profiles**: unique base stats per car plus a `feel` (weight, torque curve, drift balance) fed to `statsToParams` in `src/race/vehicle.js`: heavy cars turn in slower but carry speed, low-exponent torque curves launch hard and fade, high ones pull to the limiter. The default feel reproduces the previous tuning exactly. The Stats tab shows each car's weight, power band and balance.
- **Mobile budget**: race cars build at `RACE_DETAIL` (0.5): 8.8k to 9.8k triangles per car with every rim and wing (a test fails above 10,000). Race draw calls stay at 99 with a Tier A car, swan-neck wing and coloured FX.
- **Rims tab**: six 3D rim designs (`src/garage/rims.js`): Stock Split-5, Classic Mesh, Turbofan, Twin Blade, Forged Monoblock, Carbon Aero. Tap to preview on the turntable, then buy per car (500-1,500 coins). The race bakes the fitted rim into the instanced wheels.
- **Kit tab**: rear wings (Factory, Ducktail Lip 800, GT Wing 1,500, Swan-Neck Wing 2,200) bought per car; a new wing rises into place on the deck or, on hatches, the roof edge. Tyre smoke and nitro trail colours per car (free): Factory White, Nitro Blue, Crimson Fury, Neon Green, Midas Gold, Electric Violet. They colour the player's drift smoke and Blue/Pulse nitro flames on track.
- **Showroom** (`src/garage/showroom.js`): a glass pavilion on a cliff over the ocean at sunset: vertex-coloured sky dome with a low sun, cloud streaks, headlands, an ocean shader with a moving glitter path, a slatted timber back wall with warm LED coves, a ceiling of warm recessed spotlights with light shafts and floor pools, and a polished epoxy floor (planar mirror on High, glossy env reflections on Medium/Low). The paint reflection cubemap is baked from the same sunset. One shadowed key light, one unshadowed low sun for warm rim light, hemisphere fill.
- **Door inspection**: a pulsing hotspot follows the driver-door handle on screen; tap it (or the door) to open the door on a hydraulic strut with a synthesized latch, hiss and pump SFX. Swing doors on most cars, scissor doors on the Revuelto Storm, butterfly doors on the Chimera Senna; behind the door a cockpit (tub, seats, wheel) that never ships into the race mesh.
- **Auto-showcase**: after 8 seconds without a touch the HUD fades and the camera eases into a slow cinematic orbit, then hard cuts to low, overhead, rear, wheel and tracking-profile angles with slow dollies. Any touch brings the HUD back and reframes the car.
- **Tab camera**: Paint frames the body, Rims swings to the front wheel, Kit to the rear wing, Stats to the side profile, all with the eased orbit snap. The Cars tab is grouped by tier and previews any car on the turntable before you own it.
- **Draw calls** (headless, 1280×720): garage 108-110 on High (mirror pass skips floor decals, the cockpit, brake discs and arch liners via a render layer), 65 on Medium, 61 on Low.
- **Save**: per-car `spoiler`, `spoilers`, `smoke`, `nitroFx` inside the existing v2 car entries. The Firestore rules do not check car entry fields, so no rules change or redeploy is needed. Version 0.13.0.

## Biome 3: Neon City (stages 41-60)

Chapter 3 now races on its own track instead of borrowing Emerald Coast.

- **Track** (`src/data/neonCity.js`, 2.9 km, `biome: 'neon'`): an elevated night freeway on concrete piers (the Neon Mile start straight, the Eastern Interchange), the cable-stayed **Harbour Bridge** over the inlet (28 m up), a drop to street level through the **Arcade District** (night-market stalls, underpasses) and the **Skyline Switchbacks** back up to the line. Five crossing freeways pass overhead with green name boards and ambient traffic; each ends in a portal tower.
- **World** (`src/race/neonScenery.js`, `src/race/neonPieces.js`): a block-grid city of lit towers (textured facades, per-tower occupancy, LED crowns, corner neon, aviation lights), flickering neon billboards for fictional brands, blade signs, wet streets with sodium glows, the harbour, a skyline ring, LED-lined jersey barriers, street lights with pools of light that spread on a wet road, and the player's headlight beam. Moonlight is the one shadow light; the environment cubemap is baked from the city so paint and wet asphalt reflect the neon. Concrete and pavement are CC0 Poly Haven scans (`tools/assets/manifest.json`). Measured 53-91 draw calls headless.
- **Weather**: Wet Neon Night, Midnight Downpour, Violet Smog and, for the finale, Neon Thunderstorm (rain and lightning).
- **Stages 41-60** re-tabled over the full circuit, the reversed road and four sprints (Harbour Bridge Run, Arcade District, Skyline Switchbacks, Skyline Descent) with all five modes. Stage 60 is the **Grand Finale Boss Duel against Kage**: three laps of the Neon Grand Prix in the thunderstorm, with Kage streaming a magenta light trail. A new stage 55 scene and an epilogue close the story.
- Shared hooks other biomes use: `Race` picks the world builder from `def.biome`; `track.def.urban` gives paved shoulders and skips the coast guardrails and lamps.

## Phases 11-12: atmosphere pipeline, weather and Biome 1

Blueprint sections 03 and 04. Emerald Coast is now a complete biome with four weathers and four ways to drive it.

- **Weather presets** (`src/data/weather.js`), chosen per stage: **Golden Hour Sunset** (low amber sun, long shadows, orange horizon), **Morning Coastal Fog** (cool maritime light, low mist banks), **Light Tropical Rain** (wet asphalt sheen, puddles, rain, damp grip) and the **Coastal Storm** finale (heavy rain, lightning and thunder). Each sets sun angle and colour, ambient, sky gradient and cloud cover, fog, sea colour, exposure, road wetness and bloom; the reflection cubemap is re-baked for every weather.
- **Mist** (`src/render/heightFog.js`): the fog chunks gain an analytic height fog, densest at sea level and thinning with height, broken into banks by world-space noise. No extra draw calls.
- **Wet road and puddles**: one shared `wet` uniform darkens and glosses the asphalt, kerbs, racing line, bridge planks and trail dirt. Puddles (`generatePuddles` in `src/race/routes.js`) are near-mirror discs with scrolling ripples; driving through one costs grip and drags at the tyres and throws spray. Wet tyres lose up to 16% grip, dirt turns to mud, and the AI brakes earlier.
- **Rain and lightning** (`src/race/atmosphere.js`): world-fixed rain streaks that wrap around the camera (one draw, all motion on the GPU), drops beading and running on the lens (CSS overlay), lightning flickers that light the sky, ambient and fog, and thunder delayed by the strike distance. A rain bed and a thunder synth join the audio engine.
- **Mobile bloom** (`src/render/bloom.js`): HDR scene target, soft-threshold bright pass, 9-tap Gaussian at quarter (Low) or half resolution plus a quarter-resolution halo (Medium). Nitro flames, brake lights, the low sun and its glare on the sea bloom. **Settings → Bloom: Off / Low / Medium** (default Low, per device). Auto quality drops the halo first, then resolution, then bloom.
- **Set-pieces** (`src/race/setPieces.js`): the **Tidecutter Gorge timber suspension bridge** (plank deck, portal towers, main cables, hangers, rope handrails) over a sea gorge cut into the cliffs, with a hollow wooden tyre-roll in the engine mix and a TIMBER surface badge; a **waterfall** off the gorge head with foam mist; **seabird flocks** on the cliff tops that burst up and away when you pass fast and close; and two **red-dirt redwood trails** (Redwood Hollow cuts the summit hairpins, Sawmill Trail the valley esses) with log fences, dense groves and red dust.
- **Routes** (`src/race/routes.js`, segments in `src/data/career.js`): **Full Circuit**, **Reverse** (the same road the other way, rebuilt on first use), **Point-to-Point** coastal sprints, and the **Redwood Loop**, which closes the highway with barriers and sends everyone down both trails. On other routes the trails are optional shortcuts (about 3 s and 1 s); bold AI drivers take them too.
- **Chapter 1** (Emerald Coast 1-20) re-tabled across all four routes, the three weathers and all five modes; stage 20 is the **Boss Duel** against the coastal boss in the Storm. The briefing shows the route and a storm icon. Save: stage order and ids unchanged (append-only), `settings.bloom` added with a default; no Firestore change. Version 0.11.0.
- Performance: 63-99 draw calls per frame across the Chapter 1 weathers and routes, bloom included (budget 120).

## Phase 10: career shell, 3D world map and story

Blueprint sections 01 and 02. The 60 career stages are now one campaign: **3D Garage → World Map → Stage Briefing → Race → 3-Star Results → World Map**.

- **3D world map** (`src/map/`): three low-poly island dioramas laid out west to east (Emerald Coast with redwood hills and a lighthouse, Alpine Summit with snow peaks and a road that climbs the mountain, Neon City with lit towers and neon kerbs), joined by dotted sea routes. The whole static world is one vertex-coloured mesh (one draw call) plus instanced stage pedestals; sky, fog, light and sea colour blend from golden coast to alpine to neon night as you pan. Drag (or scroll) to pan, chapter tabs jump between regions, and a light beam marks the current stage.
- **Stage nodes** (`src/ui/mapHud.js`): 20 per chapter along each island's road, each pinned over its pedestal with the mode icon, stage number and 0-3 stars; boss nodes are bigger and carry the boss's name; 3-star stages get a gold rim. Locked stages show a padlock and say what unlocks them; a locked chapter shows its gate (stage to clear and stars needed). New stars pop on the node when you come back from a race, and a freshly unlocked node lights up.
- **Milestone chests**: every chapter has chests at **15, 30, 45 and 60** chapter stars on a progress track at the bottom of the map (coins ×1 / ×1.5 / ×2 by chapter). The 30 and 60 star chests also hold a **chest-only paint** (Tidal Teal, Riptide Wave, Glacier Frost, Avalanche Chrome, Neon Magenta, Kage Shadow) that is never sold; it appears in the garage Paint tab with a ★ and the chest that awards it. Opening a chest shakes it, pops the lid and banks the reward (cloud sync follows).
- **Stage briefing** (`src/ui/briefing.js`): track variant (laps or sprint, length), weather preset, coin reward, the three star objectives (earned ones lit), and who is on the grid: the rival crew and its tier, a solo note, or on boss duels a **boss card** with portrait, title and a taunt. A **vehicle selector** switches between owned cars with stat bars and a "track demands" hint (Drift Touge favours Handling, Time Trial Top Speed...). **Fill Nitrous Tank**: an opt-in rewarded ad that starts that race at **100% nitro** (it covers a restart from the pause menu, not another run after the finish; No Ads owners keep it because rewarded ads are opt-in).
- **Comic-book story** (`src/data/story.js`, `src/ui/dialogue.js`, `src/ui/portraits.js`): halftone panels with two facing inline-SVG portraits, a typing speech balloon (burst balloons for shouts, dashed for whispers) and yellow narration captions. Cast: crew chief **Elena Vance**, the **Rookie**, and the three regional bosses **Riptide** (Coast), **Avalanche** (Alpine) and **Kage** (Neon City). 12 scenes: the *Apex Expedition* prologue (first map visit), mid-chapter and chapter openers, a pre-duel scene for every boss and a victory scene after each boss falls. Each plays once per device (tap to advance, SKIP to end) and can be replayed from the briefing.
- **Results**: "Back to garage" is now **World map**, plus **Next stage** when the following stage is open (it opens that briefing straight away). Pause → Quit returns to the map. The interstitial still plays behind the wipe on the way back; the banner shows only on the bare world map (blueprint: Stage Map and Settings).
- The bosses carry their story names (Riptide, Avalanche, Kage); their ids are unchanged, and the Chapter 1 rival previously called Riptide is now **Breakwater**.
- **Save**: no schema change and no Firestore rules change. Chest ids (`ec-15` … `nc-60`) replace the never-claimable `stars-*` placeholders; story progress lives in `story.seen` on the device only. The Phase 9 stage picker is gone (its helpers live in `src/ui/stageInfo.js`); `?stage=` / `?mode=` still pick what the garage chip and `__app.startRace()` race. With `?debug`: `__app.openMap()`, `__app.openBriefing('ec-20')`, `__app.startRace('ec-05', { startNitro: true })`. Version 0.10.0.

## Phase 9: game modes, boss duels and 3-star results

Blueprint section 02. The race loop is now a host for five match types (`src/race/modes/`): the host owns the world, the cars, each car's distance along the stage's course, laps and the finish line; a mode picks who is on the grid, lays out its own track furniture, runs its rules every frame, fills a mode panel on the HUD and dresses the result.

- **Stages drive the race**: every race is now a career stage (`src/data/career.js`): its track segment (circuit laps, or a point-to-point sprint with START / FINISH arches), its game mode, its rival set (rival difficulty nudges their stats) and its three objectives, which also show on the intro card.
- **Classic Expedition**: pack race against the stage's five rivals; first past the line wins. All pack modes now have **slipstream**: tucking in within 32 m and 2.6 m of a car's line gives extra pull (strongest on the bumper), so a drafting car can briefly run past its top speed. A SLIPSTREAM tag shows while the player is in a tow.
- **Time Trial (Chrono Run)**: solo against a countdown. The clock starts with one share of the run budget (star-1 target x 1.12) and each cyan **checkpoint gate** (about one per 650 m) adds another share. Floating **green pylons** on the racing line (clusters of three every 150 m, swinging to the inside of corners) take **1.0 s** off the run time when smashed, which also gives that second back to the clock, and count as props smashed. Red clock and ticks in the last seconds; running out ends the run as TIME UP (no stars, skill coins still paid).
- **Drift Touge**: solo score attack against the stage's target and gold scores (meter with both marks). Drifting within 2.4 m of the guardrail pays up to **+100%** drift points (**proximity bonus**, `RAIL KISS` callout, PROXIMITY tag); the run's score is judged at the finish line.
- **Elimination Knock-Out**: six-car sprint with a 20 s knock-out timer that loops; when it hits zero the car in last place explodes out of the race (fireball, blast and falling exit siren, `NAME ELIMINATED`) until one champion remains. The race runs as long as it takes (no finish line); being knocked out ends the player's run in that place.
- **Boss Duel**: 1v1 from a side-by-side front row against the chapter boss (Tidebreaker, Avalanche, Voltage) with a boss intro card and a live gap panel. The boss AI tucks into the player's slipstream and slingshots out to pass, sits on the player's line to block when leading, rubber-bands harder and fires nitro more often; the duel uses a heavy draft (2.2x).
- **3-star results**: the results card lists the stage's three objectives with what the run achieved (`objectiveProgress` in `src/core/career.js`), lights each earned star in turn, dims stars held from earlier runs, and pops a **+250** chip on first-time stars that counts into the star-bonus line. The headline figure and stat rows follow the mode (position, run time, drift score). Stars and coins are banked as soon as the run ends; star 1 unlocks the next stage.
- **Stage picker** (stand-in for the Phase 10 world map): the chip above RACE START shows the stage, mode and stars; tapping it lists the stages by chapter with mode tags and stars, filterable by mode. Players get the stages they have unlocked; **dev builds (no `VITE_RELEASE=1`, or `?debug`) can open every stage**, and locked ones run as **practice** (judged and shown, nothing saved or paid). Alpine Summit and Neon City stages race their segment on Emerald Coast until those tracks exist. URL shortcuts: `?stage=ec-07`, `?mode=BossDuel`. With `?debug`, `__app.pickStage('ec-20')` and `__app.race.autopilot()` help QA.
- New procedural SFX: pylon ping, checkpoint arpeggio, countdown tick, elimination blast. Version 0.9.0.

## Phase 8: driving feel and control schemes

Blueprint sections 2.2 and 2.3.

- **Drift chaining** (`src/race/driftChain.js`): starting a new drift within 1.6 s of the last one links it and steps the combo up x1.0 → x1.5 → x2.0 → x3.0 (holding one drift for 2.5 s counts as a link too). Each drift banks its points at the current multiplier; the chain pays out when the link window runs out, with a `COMBO x2.0 +N` callout. Every step up adds nitro (+6 / +9 / +14). The drift panel shows live points, the multiplier badge (hotter colour per level), the chain total and a shrinking link timer. A hard wall hit ends the chain early (banked points are kept).
- **Perfect Exit** (`Track.findCorners` / `Vehicle.endDrift`): corners tighter than 200 m radius are found from the spline curvature, apex at the tightest point. Letting go of a drift (of at least 0.6 s) from 6 m before to 22 m after the apex fires a +7 m/s kick, 1.2 s of extra pull and top speed, +8 nitro, a "PERFECT!" callout, a cyan flash and spark burst. While a release would count, the HUD shows **APEX · RELEASE** and the drift/brake buttons glow. Player only; rivals do not get it.
- **Control schemes** (Settings → Controls, `src/race/input.js`, stored per device as `settings.controls`):
  - *Touch Drive* (default): the split left/right steering pad, unchanged.
  - *Tilt-to-Steer*: roll the phone like a wheel. Gravity gives the absolute angle (24° = full lock, 1.5° dead zone) and the gyroscope rate is blended in (complementary filter) for quick, steady steering. GAS and a big BRAKE pedal on screen. Uses `devicemotion`, which needs **no Android permission or manifest change** (the WebView serves the game from a secure origin; iOS would prompt on selecting Tilt). If no sensor answers, the game says so and the keyboard still steers.
  - *Virtual Steering Wheel*: an analog wheel on the left (grab it anywhere, 95° = full lock, springs back when released), pedals on the right.
  - Pedal schemes always drive with the GAS pedal; Auto-accelerate now applies to Touch Drive only.
- **Surfaces** (`src/race/surface.js`): the concrete shoulder became a 1.8 m gravel/dirt shoulder plus a 2.2 m grass verge up to the guardrail (the rail moved out 2.6 m). Handling blends by how much of the car's width is on each surface: gravel 62% grip, 86% top speed, a little rolling drag and a tug on the wheel; grass 48% grip and 74% top speed. Tyres squeal only on asphalt; gravel crunches over a low rumble and grass swishes (procedural, `src/audio/engine.js`); dust plumes or torn turf behind the car. A small GRAVEL / GRASS tag shows on the speedometer.
- **Breakable props** (`src/race/props.js`): six fruit stalls on the straights and six neon signposts on the outside of corner entries. They shatter on contact into pooled debris (planks, awning, fruit, glowing glass and sparks) without slowing the car, and count as smashes (nitro and the smash coin bonus).
- **Valkyrie GT-R**: the Tier A Supercar Bundle hypercar now carries its blueprint name (was RP-X Hyperion). Its id stays `rpx-hyperion`, so existing saves, cloud documents and Play grants keep working with no migration and no Firestore rules change. A drop-in model is now `public/assets/models/valkyrie_gtr.glb`.
- Race results also report `perfectExits` and `bestCombo`. Version 0.8.0.

## Phase 7: career data model and save schema v2

The data that the stage map, game modes and the full car roster will be built on. Gameplay is unchanged for now: every race is career stage 1 until the stage map arrives, and the garage still shows the two cars that have art.

- **Career** (`src/data/career.js`): 3 chapters (Emerald Coast, Alpine Summit, Neon City) x 20 stages = 60 stages. Each stage has `stageId` (`ec-01`..`nc-20`), `chapterId`, `trackSegment` (a circuit or sprint stretch of the chapter's track), `gameMode` (Classic, TimeTrial, DriftTouge, Elimination, BossDuel), `weatherPreset` (GoldenHour, Fog, Rain, Midday, Dusk), `rivalSet` and `coinReward`, plus three objectives: star 1 finish (Top 3, beat the par time, reach the score), star 2 skill (drift distance, props smashed, airtime, Pulse Nitros), star 3 mastery (target lap / run time, gold score, or the win). Each chapter ends in a Boss Duel against its regional boss. Chapters 2 and 3 also need 30 and 75 career stars. Eight milestone chests pay out at 10 to 180 stars. Alpine and Neon targets are provisional until those tracks exist.
- **Stars** are earned independently and kept forever, stored as a bitmask per stage (bit 0 = star 1). Star 1 unlocks the next stage. Stages are stored by position, so new stages may only be appended.
- **Cars** (`src/data/cars.js`): 12 cars, 3 per tier (D Street Tuners, C Offroad & Muscle, B Grand Tourers, A Hyper & Supercars), with four stats matching the garage bars (top speed, acceleration, handling, nitro). Unlocks: starter (RP-1 Vanta), coins (3,000 to 75,000), career stars plus coins, or a Play product (Supercar Bundle). Only cars with `released: true` appear in the garage.
- **Per-car progression** (`src/core/inventory.js`): every car keeps its own Top Speed / Acceleration / Handling / Nitro levels (0 stock, 1 to 5 bought for 250 / 500 / 1,000 / 2,000 / 4,000 coins), equipped paint and rim, and owned rims (6 designs, 500 to 1,500 coins). Paints bought with coins are shared by every car.
- **Economy** (`src/data/economy.js`): stage finish reward 500 to 1,500 coins (rising across the career, bosses pay 1,500, lower places get a share but never less than 500), +250 coins per star the first time it is earned, and a drift + airtime + smash bonus capped at 300 coins per race. The rewarded 2x pays finish + skill coins again, not the star bonus. Coin paints now cost 500 to 1,500.
- **Save schema v2** (`src/core/saveSchema.js`): local key `apex-overdrive.save.v2`. On first launch a v1 save is migrated: coins, Play purchases and coin bonuses paid, settings and ad pacing carry over unchanged; the old global upgrades and paint are copied onto every car the player owned; an Emerald Coast top-3 finish becomes stage 1's first star. The v1 key is left in place as a fallback copy.
- **Cloud document v2** (`players/{uid}`): `{ v: 2, updatedAt, appVersion, economy { coins, noAdsPurchased, supercarBundlePurchased, purchases, granted, crateClaimedAt }, progression { unlockedStage, stageStars, best, milestones }, garage { car, ownedPaints, cars } }`. A v1 document is migrated when read and replaced on the next upload. `firestore.rules` accepts both shapes but never lets a document drop to a lower version, so an old install cannot overwrite a migrated save. A newer-schema document is never overwritten by this version. **Deploy the updated rules before releasing 0.7.0** (see Firebase console setup).
- **Tests**: `npm test` (Node's built-in runner, also run in CI) covers the stage and car data, economy, star and reward rules, per-car inventory, v1 to v2 migration and the cloud document. `tools/rules-test` runs `firestore.rules` in the Firestore emulator against real v1 and v2 documents (`cd tools/rules-test && npm install && npm test`, needs Java).

## Phase 6: audio engine and blueprint compliance

All audio is still generated on the device (Web Audio synthesis plus loops rendered at startup); the game ships no audio files and downloads nothing. Code in `src/audio/`, game-facing API in `src/core/audio.js`.

- **Engine** (`src/audio/engine.js`): three RPM loops (1,100 / 3,600 / 6,600 rpm) rendered at startup from a V8 firing model (eight uneven exhaust pulses per cycle, each ringing four exhaust resonances), pitch-shifted by RPM and crossfaded with equal power, through a load-dependent tone filter and a low-mid "throat" boost. Under them: a saturated sub-bass rumble at half and full firing frequency, mechanical gear/cam whine that climbs with RPM, intake roar, turbo spool, wind, and a six-speed virtual gearbox (`Gearbox`) that turns road speed and throttle into RPM with real ratio drops on upshifts, rev-matched downshifts, clutch slip off the line, a bouncing rev limiter and revs flaring in the air.
- **Turbo blow-off**: a "pshh" vent followed by a decaying compressor flutter ("tu-tu-tu") when lifting after boost, and a lighter one on boosted upshifts. Exhaust crackle on the overrun.
- **Nitro**: sub-bass ignition thump plus a sweeping pink-noise whoosh and a resonant two-band howl; Pulse Nitro adds a jet spool and pans across the stereo field. A sustained airflow layer plays while the boost lasts.
- **Tyres**: stick-slip screech from three narrow inharmonic bands and a buzzing saw whose pitch follows the slip angle and wanders like real rubber; a chirp on drift entry.
- **Race soundtrack** (`src/audio/music.js`): an original 126 BPM synthwave / electro-rock track sequenced live on the audio clock (kick/snare/hats, sidechained pumping bass, pads, pulse arp with dotted-eighth echo, lead hook, distorted power chords, hall reverb). Sections rotate (intro → drive → lift → drive with power chords → break → lift…), the green light drops straight into the full track, pause muffles it, and it ducks under heavy throttle and nitro. Every instrument is a persistent voice automated per note, so playback creates no nodes (about 13× faster than real time in an offline render).
- **Garage and UI**: the headlight toggle plays a relay clunk and an aggressive throttle stab into the limiter with blow-off; Race Start blips and pulls; holographic click, swipe, confirm and deny sounds on every garage and race HUD button.
- **Settings**: separate **Sound effects** and **Music** switches.
- **Listening previews**: `node tools/audio/render.mjs` renders the engine through six gears, blow-offs, nitro, drift, the soundtrack, all SFX and a full race mix to `tools/audio/out/*.wav` with the same code, and prints peak/RMS levels.

Blueprint compliance:

- **Ads**: the banner shows only while Settings is open (the future Stage Map is the other allowed place), never in the 3D garage or a race. Interstitials never play during the first 3 finished races (`ADS.interstitialGraceRaces`, existing saves count the races already recorded), then every 2nd-3rd race with a 3-minute cooldown that survives restarts.
- **Nitro**: Blue Nitro fires from 25% of the bar (Pulse needs 50%); the gauge marks moved to match.
- **Props**: cones and barricades no longer slow any car; they still scatter and give the player a little nitro and coins.
- **Auto-accelerate** (Settings, on by default): off shows a **GAS** pedal next to Nitro, and W / Up become the throttle (N / Shift fire nitro).
- **Economy and branding**: the RP-1 Vanta is the **Tier D Starter Coupe**; the $2.99 product is presented as the **No Ads Pack** and now also unlocks the exclusive **Red Pen Studio Founder** iridescent metallic paint (a thin-film finish over heavy flake; locked swatch opens the Store, and it follows the purchase through restores and refunds).

## Graphics & performance pass

Fixes from the first device test (22 FPS, white bars, cartoon look, stock icon).

- **True fullscreen**: `MainActivity` hides the status and navigation bars with `WindowInsetsControllerCompat` (`BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`, the modern replacement for `SYSTEM_UI_FLAG_IMMERSIVE_STICKY`) and re-hides them on focus/resume; the window draws under the display cutout; the theme, decor view, WebView, `body` and canvas are all `#000000`, so no white strip can appear on any aspect ratio. `SystemBars.hidden` is `true` in `capacitor.config.json`.
- **Draw calls** (headless measurement, 960×450): garage 293 → 72 on Medium (the Auto default on phones), 115 on High (adds the floor mirror pass), 42 on Low; race 145 → 76 on the grid with all six cars in view, 41-60 while racing. Untextured parts are batched with a vertex-PBR "atlas" material (`src/render/vertexPbr.js`): each race car is 4 draws (paint, glass, atlas, brake lights) and all wheels are 2 instanced draws; guardrails, posts, lamp posts and the gantry are one mesh for the whole lap; ramps are one mesh.
- **Lighting**: exactly one directional sun with a 512² shadow map (texel-snapped, following the player) plus hemisphere ambient, in the race and in the garage. The garage spotlights and the car's head/tail light sources are now additive floor decals.
- **Render loop**: pixel ratio capped at 1.5 (1.25 Medium, 1 Low); Auto starts at Medium on phones; the garage planar mirror (a second full render each frame) is High-only; the terrain is split into chunks so it frustum-culls; distant trees and trackside rails do not render into the shadow map.
- **Look**: procedural asphalt with normal + roughness maps, painted edge and lane lines, cracks and patches; rubbered-in racing line; raised red/white rumble strips; tyre skid marks (one ring-buffer mesh); layered terrain shader (coastal grass, triplanar stratified cliff rock, wet/dry sand); ocean shader with Fresnel sky reflection and sun glint; coast redwoods, palms and undergrowth; clear-coat rival paint, smoked glass and polished alloy rims, all reflecting a cubemap baked from the actual coast at load.
- **Icons**: adaptive launcher icon (crimson Valkyrie GT-R over carbon fibre with a cyan nitro trail), legacy/round icons for every density, a dark launch splash and `tools/icon/out/play-store-512.png`. Regenerate with `node tools/icon/render.mjs` (needs Playwright; see the header of that file).

## Phase 4: zero-cost Firebase cloud save

- **Anonymous player profiles** (`@capacitor-firebase/authentication`): the first time the game is online it signs in anonymously, so every install gets a Firebase player ID with no sign-up. The native Firebase SDK keeps the session across launches.
- **Cloud Firestore save** (`@capacitor-firebase/firestore`, `src/core/cloud.js`): one document per player at `players/{uid}` holding (in v1; see Phase 7 for v2) `{ v, save, updatedAt, appVersion }`, where `save` is the progress JSON (coins, paints, upgrades, selected car, race records, Play products owned and bonuses paid, crate timer). Settings, sandbox purchases and ad pacing stay on the device.
- **Local first**: every change is saved to the device instantly as before (`src/core/store.js`); the cloud only mirrors it. `savedAt` moves only when progress changes, so launching or changing settings never makes a device look newer than its cloud copy.
- **Batched sync at milestones only**:
  - **Launch**: one read of the player document; if its `updatedAt` is newer than the device's save it replaces local progress (coin bonuses already paid and the crate timer are merged so neither can be gamed), otherwise the device's save is uploaded if it differs.
  - **Back in the garage after a race**: one write.
  - **Buying an upgrade, a paint finish or a Play product** (or a Restore that paid out): one write, with purchases inside 4 s collapsed together.
  - Writes are skipped when the progress is identical to the last upload, never closer than 15 s apart, and retried once the device is back online.
  - Budget: about 1 read per launch and a few writes per session per player, against the Spark plan's 50,000 reads and 20,000 writes per day (and 1 GiB storage; a save is about 1 KB).
- **Garage HUD indicator**: a quiet cloud next to the logo: green tick **Saved to Cloud**, pulsing **Syncing…**, amber **Sync pending** or crossed-out **Offline**; tapping it explains the state (and retries a pending upload). Settings shows the Player ID for support and data-deletion requests.
- **Scope of an anonymous ID**: it belongs to the installation. It survives restarts, updates and going offline, but a reinstall or *Clear storage* starts a new player unless Android backup restores the app data. Linking it to Play Games or Google sign-in later keeps the same ID and save.
- **Security rules** (`firestore.rules`): a player can only `get`, create and update their own document, with the four fields type- and size-checked; listing and deleting are closed.
- The desktop browser build saves on device only (the indicator reads **Saved on device**) unless `VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_APP_ID` of a Firebase web app are set at build time.

### Firebase console setup (once)

1. **Authentication → Sign-in method**: enable **Anonymous**.
2. **Firestore Database**: create the database (production mode, any region).
3. Deploy the rules: `npx firebase-tools deploy --only firestore:rules` (project `apex-overdrive`, see `.firebaserc`), or paste `firestore.rules` into the console's Rules tab.
4. Optional hardening: in Google Cloud Console → Credentials, restrict the Android API key to package `com.redpenstudio.apexoverdrive` with your debug, upload and Play app-signing SHA-1s.

`android/app/google-services.json` is committed. The key in it identifies the Firebase project and is not a secret; access is governed by the security rules above.

## Phase 3: monetization and the 3D model pipeline

- **Google AdMob** (`src/monetization/ads.js`, `@capacitor-community/admob`), on Google's test ad units until a release build:
  - **Rewarded video**: "Watch ad · 2× coins" on the race results screen pays the race's coins a second time (once per race); the garage's **Free 500** reward crate pays 500 coins once every 24 hours and shows a live countdown.
  - **Interstitial**: every 2nd or 3rd finished race (re-rolled each time), played behind the wipe on the way back to the garage. Since Phase 6: never in the first 3 races and never within 3 minutes of another full-screen ad.
  - **Banner**: adaptive banner at the bottom of the screen, lifted above the gesture bar. Since Phase 6 it shows only while Settings is open (Settings moves up to clear it); hidden in the garage and the whole race.
  - Google UMP consent form where required (EEA/UK/US states), with an **Ad privacy** button in Settings when Google requires one; ad content capped at Teen; not child-directed.
  - Desktop browser: the same calls drive an on-page simulator (striped test banner, skippable interstitial, 3 s rewarded countdown).
- **Google Play Billing** (`src/monetization/billing.js`, `@capgo/native-purchases`, Play Billing 9):
  - `remove_ads` ($2.99, shown as the No Ads Pack): removes banner and interstitial ads permanently, +5,000 coins and the Red Pen Studio Founder paint.
  - `supercar_bundle` ($6.99): unlocks the Tier A **Valkyrie GT-R**, +25,000 coins and No Ads.
  - Store dialog (cart button in the top bar, or tapping the locked Valkyrie in the **Cars** tab) with localized Play prices; purchases are acknowledged, pending payments unlock when they clear, refunds revoke the entitlement on next launch.
  - Purchase state is saved on device and re-synced with Play on every launch, so it survives restarts and works offline. Coin bonuses are paid once per install, so Restore never pays twice.
  - **Settings → Restore purchases** (Play compliance).
  - **Sandbox store**: Settings toggle in pre-release builds that simulates both purchases on device with no charge (always on in the desktop browser), plus "Reset purchases" and "Reset crate" for testing. Not present in a `VITE_RELEASE=1` build.
- **Cars tab and Tier A hypercar**: RP-1 Vanta (starter) and Valkyrie GT-R (wing, canards, roof scoop, side blades, yellow calipers; Speed 74 / Nitro 66 / Handling 70 / Grip 68). The selected car is used in the garage and on track; upgrades apply to both.
- **3D model pipeline** (`src/assets/modelLoader.js`): a vehicle spawner that loads `public/assets/models/<car>.glb` with `GLTFLoader` (Draco and Meshopt decoders bundled for offline use) and adapts it to the same car rig as the procedural builder: scaled to length, centred and grounded, wheel nodes re-pivoted to spin and steer, paint materials swapped for the clear-coat paint so the paint shop works, light lenses wired to the light toggle and brake glow, and exhaust anchors for nitro flames. The race bakes whichever rig it gets, and physics never reads meshes, so dropping in a model changes nothing else. A missing or malformed file falls back to the procedural car. Export conventions: [`public/assets/models/README.md`](public/assets/models/README.md).

## Phase 2: Emerald Coast, arcade physics and the race loop

- **Track "Emerald Coast" (Biome 1)**: a 2.8 km closed-loop coastal highway generated from a spline: cliff-top straights above the ocean, an inland climb to a hilltop hairpin, a downhill S and sweeping bends back to the sea (18 m to 54 m elevation). Wooden barrier fences line both sides, kerbs and chevron boards mark the corners, and a start/finish gantry spans the grid.
- **Scenery**: procedural terrain carved around the road (grass, rock faces and sand by slope and height), an animated ocean with emerald shallows, sea stacks and rocks, palms, umbrella pines and cypress, a lighthouse headland, sailboats, a sky with sun glow and image-based lighting rendered from it, and a distant ridge on the horizon.
- **Jump ramps and smashable props**: three ramps (two partial, one full-width downhill jump) launch cars ballistically; traffic-cone slaloms and wooden barricades tumble, bounce and settle when hit and reward nitro and coins without slowing the car.
- **Arcade physics** (`src/race/vehicle.js`): smooth acceleration with a top-speed cap and braking; speed is preserved through turns. Tapping **Drift** while steering kicks the car into a controlled power-slide (~30° slip); holding the slide charges nitro and drift points, and a long drift ends with a mini boost.
- **Dual-tier nitro**: a tap fires **Blue Nitro**; a second tap inside the sweet-spot window (0.16 s to 0.42 s after the first, shown by a needle on the Nitro ring) upgrades it to **Pulse Nitro** (orange/purple) with an explosive kick, higher top speed, a wider camera FOV, speed lines and a screen glow.
- **Touch controls**: a slide-to-steer pad (left/right halves), Drift/Brake and Nitro buttons, all inside the Android 15 safe-area insets. Keyboard on desktop: arrows/A/D steer, Space/S drift and brake, W/Up/Shift nitro (N/Shift with Auto-accelerate off, when W/Up is the throttle), Esc pauses.
- **Five AI rivals** (Riptide, Volta, Solaris, Noctis, Monarch): waypoint pure-pursuit drivers that brake for corners from the track's speed profile, pass on the side with more room, steer around props (or smash them), choose whether to hit ramps and fire nitro on straights, each with its own aggression and skill. Light rubber banding keeps races close, and they scale a little with your upgrades.
- **Race loop**: Race Start revs the coupe and wipes to the track (the world is built and its shaders compiled behind the wipe), a fly-in camera shows the grid, then 3-2-1-GO. The HUD shows speed (km/h), position (1st/6th), lap, race time, a progress strip with every car and the nitro gauge. Two laps; the finish screen shows position, race time, best lap, drift score, props smashed, coins earned and a 1 to 3 star rating, then returns to the garage where the wallet animates up. Coins and best times are saved on device the moment you cross the line. Pause (button, Esc or Android back) offers resume, restart and quit.
- **Garage upgrades matter**: Engine raises top speed and acceleration, Nitro extends boost time and power, Handling sharpens steering and drift control, Tires improve grip and launch.
- **Performance**: race cars are baked into one mesh per material (about 17 draw calls per car instead of 89) with emissive lenses instead of real lights, vegetation, fences, rocks and props are instanced, and the shadow map follows the player. Auto quality lowers the render resolution if the race drops below ~50 FPS.

## Phase 1

- **3D garage**: mirror-finish showroom floor, turntable, LED walls, a shadow-casting key spotlight and two sweeping coloured rim spots that power on in sequence.
- **Starter coupe "RP-1 Vanta"**: generated procedurally from lofted body sections (no downloaded meshes) with a clear-coat metallic-flake paint shader (`MeshPhysicalMaterial` + generated flake normal map) and finishes for metallic, gloss, pearl (iridescent), matte and chrome.
- **Orbit camera**: one-finger drag rotates 360°, pinch zooms, idle auto-rotate, and animated snaps to Body / Wheels (tap again to cycle all four) / Front / Rear. Tapping a wheel on the car snaps to it, tapping the head or tail lights toggles them, tapping the body re-frames it.
- **HUD**: angled glassmorphism panels with coins, Paint and Upgrades tabs (purchases saved offline), vehicle stats, Race Start, and a Settings dialog with graphics quality, sound, FPS counter and links to the Privacy Policy and Terms of Service.
- **Performance**: auto quality steps from High → Medium → Low if the frame rate drops below ~48 FPS (pixel ratio, shadows and floor reflections); rendering pauses while the app is in the background.

## Develop

```bash
npm install
npm run dev            # http://localhost:5173 (desktop browser preview)
npm run build          # production web bundle in dist/
npm test               # unit tests (career, economy, inventory, save migration)
npm run cap:sync       # build + copy into the Android project
npm run android:open   # open in Android Studio
```

Requirements: Node 22, JDK 21, Android SDK platform 36.

## Project layout

```
src/
  main.js              boot, lifecycle, Android back button, ad/race flow
  config.js            studio constants, legal URLs, ad units, Play products
  core/                save data (localStorage) and save schema v2 + migration, career and
                       per-car inventory rules, Firebase cloud save, audio API, Capacitor helpers
  audio/               mixer, sampled engine + gearbox, one-shot SFX, sample bank, race soundtrack
  assets/              GLTF vehicle spawner with procedural fallback
  monetization/        AdMob service (+ browser simulator), Play Billing and entitlements
  data/catalog.js      paints, finishes, rims, rear wings, smoke/nitro colours, upgrades, prices
  data/cars.js         12-car roster: tier, stats, handling feel, body style, .glb path, unlock rule
  data/career.js       chapters, track segments, 60 stages, star objectives, milestones
  data/economy.js      coin rewards and costs
  data/tracks.js       Emerald Coast definition (waypoints, ramps, props, coastline)
  data/neonCity.js     Neon City definition (freeway, Harbour Bridge, overpasses, harbour)
  data/rivals.js       AI rivals per chapter, bosses and rival sets
  garage/              renderer + quality, sunset showroom, procedural cars (body styles, rims,
                       wings, doors), paint shader, camera rig + auto-showcase
  render/              batching material (vertex PBR) and procedural surface textures
  race/                track spline + meshes, scenery, props, vehicle physics, AI, race cars,
                       effects, chase camera, input and the Race host (course.js: stage courses)
  race/modes/          the five game modes and their pure rules (clock, knock-outs, draft, proximity)
  ui/                  garage HUD, stage picker, store + reward crate, race HUD + 3-star results,
                       settings, styles
public/assets/models/  drop-in .glb car models (see README there)
android/               Capacitor Android project (signing reads env vars / keystore.properties)
docs/                  GitHub Pages: privacy-policy.html, terms.html
tools/icon/            launcher icon + splash renderer (dev only, not in the game bundle)
tools/audio/           offline audio preview renderer (dev only, not in the game bundle)
tools/rules-test/      Firestore emulator check of firestore.rules (dev only)
test/                  unit tests (npm test)
.github/workflows/     build-aab.yml
```

All game assets are generated at runtime or bundled into the APK/AAB. The network is used only by the AdMob SDK, Play Billing and the Privacy Policy / Terms links (system browser); the game is fully playable without it.

## Release builds (CI)

`.github/workflows/build-aab.yml` builds the web bundle, syncs Capacitor and runs `./gradlew bundleRelease` on every push to `main` (and on manual dispatch), signs the bundle with the upload key from GitHub Secrets, verifies the signature and uploads `app-release.aab` as a workflow artifact. The version code is the workflow run number. Pull requests build an unsigned bundle to validate the change.

Add these repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the upload keystore, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Create an upload key once and keep a secure backup (Play App Signing holds the app signing key):

```bash
keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 upload.jks > upload.jks.b64   # paste into ANDROID_KEYSTORE_BASE64
```

For a local signed build, create `android/keystore.properties` (git-ignored) with `storeFile`, `storePassword`, `keyAlias` and `keyPassword`.

### Going live with ads and purchases

Pre-release builds (every build until you change this) use Google's test ad units and test AdMob app id, and offer the sandbox store toggle. For the store release:

1. In AdMob, create the app and three ad units (adaptive banner, interstitial, rewarded).
2. In Play Console, create two **one-time products**, `remove_ads` ($2.99) and `supercar_bundle` ($6.99), and activate them. Real purchases can be tested from an internal testing track with license testers.
3. Add repository **variables** (Settings → Secrets and variables → Actions → Variables): `VITE_RELEASE` = `1`, `ADMOB_APP_ID` (`ca-app-pub-…~…`), `VITE_ADMOB_BANNER`, `VITE_ADMOB_INTERSTITIAL`, `VITE_ADMOB_REWARDED` (`ca-app-pub-…/…`). The workflow passes them to Vite and Gradle. Locally: `VITE_RELEASE=1 VITE_ADMOB_…=… npm run build` and `./gradlew bundleRelease -PadmobAppId=…`.

With `VITE_RELEASE=1` and a unit id missing, that ad type is simply not shown.

## Legal pages (GitHub Pages)

Enable **Settings → Pages → Deploy from a branch → `main` / `/docs`**. The app links to:

- https://imroulofficial.github.io/apex-overdrive-3d/privacy-policy.html
- https://imroulofficial.github.io/apex-overdrive-3d/terms.html

## Compliance notes

- Edge-to-edge: `viewport-fit=cover` plus Capacitor's SystemBars `insetsHandling: "css"`; every HUD edge is padded with the safe-area insets so nothing sits under the status bar, navigation bar or display cutout.
- 13+ / COPPA: no accounts and no analytics. The app is not child-directed: AdMob requests are tagged not child-directed, ad content is capped at Teen, and the game is not in the Designed for Families program. The privacy policy (updated for Phase 3) discloses AdMob and Play Billing.
- The AdMob SDK merges the `com.google.android.gms.permission.AD_ID` permission. In Play Console: answer **Contains ads: Yes**, declare advertising ID use, and in **Data safety** declare *Device or other IDs*, *App interactions* and *Diagnostics* collected and shared by the AdMob SDK for advertising, fraud prevention and analytics, plus *Purchase history* processed by Google Play.
