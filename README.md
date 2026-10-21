# Apex Overdrive: 3D Racing

Offline-first 3D arcade racer for Android by **Red Pen Studio**.

| | |
|---|---|
| Package | `com.redpenstudio.apexoverdrive` |
| Android | minSdk 24 · targetSdk 36 · compileSdk 36 · immersive fullscreen |
| Stack | Three.js (WebGL2) + Vite, wrapped with Capacitor 8 |
| Audience | 13+, no sign-up, no analytics; gameplay is offline, cloud save, ads and Play Billing use the network when available |

## Phase 7: career data model and save schema v2 (this release)

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
- **Icons**: adaptive launcher icon (crimson RP-X Hyperion over carbon fibre with a cyan nitro trail), legacy/round icons for every density, a dark launch splash and `tools/icon/out/play-store-512.png`. Regenerate with `node tools/icon/render.mjs` (needs Playwright; see the header of that file).

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
  - `supercar_bundle` ($6.99): unlocks the Tier A **RP-X Hyperion**, +25,000 coins and No Ads.
  - Store dialog (cart button in the top bar, or tapping the locked Hyperion in the **Cars** tab) with localized Play prices; purchases are acknowledged, pending payments unlock when they clear, refunds revoke the entitlement on next launch.
  - Purchase state is saved on device and re-synced with Play on every launch, so it survives restarts and works offline. Coin bonuses are paid once per install, so Restore never pays twice.
  - **Settings → Restore purchases** (Play compliance).
  - **Sandbox store**: Settings toggle in pre-release builds that simulates both purchases on device with no charge (always on in the desktop browser), plus "Reset purchases" and "Reset crate" for testing. Not present in a `VITE_RELEASE=1` build.
- **Cars tab and Tier A hypercar**: RP-1 Vanta (starter) and RP-X Hyperion (wing, canards, roof scoop, side blades, yellow calipers; Speed 74 / Nitro 66 / Handling 70 / Grip 68). The selected car is used in the garage and on track; upgrades apply to both.
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
  audio/               synthesis: mixer, engine + gearbox, one-shot SFX, race soundtrack
  assets/              GLTF vehicle spawner with procedural fallback
  monetization/        AdMob service (+ browser simulator), Play Billing and entitlements
  data/catalog.js      paints, finishes, rims, upgrades, prices
  data/cars.js         12-car roster: tier, stats, procedural kit, .glb path, unlock rule
  data/career.js       chapters, track segments, 60 stages, star objectives, milestones
  data/economy.js      coin rewards and costs
  data/tracks.js       Emerald Coast definition (waypoints, ramps, props, coastline)
  data/rivals.js       AI rivals per chapter, bosses and rival sets
  garage/              renderer + quality, showroom, procedural car, paint shader, camera rig
  render/              batching material (vertex PBR) and procedural surface textures
  race/                track spline + meshes, scenery, props, vehicle physics, AI, race cars,
                       effects, chase camera, input and the Race state machine
  ui/                  garage HUD, store + reward crate, race HUD + finish screen, settings, styles
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
