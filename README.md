# Apex Overdrive: 3D Racing

Offline-first 3D arcade racer for Android by **Red Pen Studio**.

| | |
|---|---|
| Package | `com.redpenstudio.apexoverdrive` |
| Android | minSdk 24 · targetSdk 36 · compileSdk 36 · edge-to-edge |
| Stack | Three.js (WebGL2) + Vite, wrapped with Capacitor 8 |
| Audience | 13+, no accounts, no analytics, no network calls during play |

## Phase 2 (this release): Emerald Coast, arcade physics and the race loop

- **Track "Emerald Coast" (Biome 1)**: a 2.8 km closed-loop coastal highway generated from a spline: cliff-top straights above the ocean, an inland climb to a hilltop hairpin, a downhill S and sweeping bends back to the sea (18 m to 54 m elevation). Wooden barrier fences line both sides, kerbs and chevron boards mark the corners, and a start/finish gantry spans the grid.
- **Scenery**: procedural terrain carved around the road (grass, rock faces and sand by slope and height), an animated ocean with emerald shallows, sea stacks and rocks, palms, umbrella pines and cypress, a lighthouse headland, sailboats, a sky with sun glow and image-based lighting rendered from it, and a distant ridge on the horizon.
- **Jump ramps and smashable props**: three ramps (two partial, one full-width downhill jump) launch cars ballistically; traffic-cone slaloms and wooden barricades tumble, bounce and settle when hit, cost a little speed and reward nitro and coins.
- **Arcade physics** (`src/race/vehicle.js`): smooth acceleration with a top-speed cap and braking; speed is preserved through turns. Tapping **Drift** while steering kicks the car into a controlled power-slide (~30° slip); holding the slide charges nitro and drift points, and a long drift ends with a mini boost.
- **Dual-tier nitro**: a tap fires **Blue Nitro**; a second tap inside the sweet-spot window (0.16 s to 0.42 s after the first, shown by a needle on the Nitro ring) upgrades it to **Pulse Nitro** (orange/purple) with an explosive kick, higher top speed, a wider camera FOV, speed lines and a screen glow.
- **Touch controls**: a slide-to-steer pad (left/right halves), Drift/Brake and Nitro buttons, all inside the Android 15 safe-area insets. Keyboard on desktop: arrows/A/D steer, Space/S drift and brake, W/Up/Shift nitro, Esc pauses.
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
npm run cap:sync       # build + copy into the Android project
npm run android:open   # open in Android Studio
```

Requirements: Node 22, JDK 21, Android SDK platform 36.

## Project layout

```
src/
  main.js              boot, lifecycle, Android back button
  config.js            studio constants and legal URLs
  core/                save data (localStorage), synthesized UI/engine audio, Capacitor helpers
  data/catalog.js      paints, finishes, upgrades, prices
  data/tracks.js       Emerald Coast definition (waypoints, ramps, props, coastline)
  data/rivals.js       AI rivals, race rewards and star rating
  garage/              renderer + quality, showroom, procedural car, paint shader, camera rig
  race/                track spline + meshes, scenery, props, vehicle physics, AI, race cars,
                       effects, chase camera, input and the Race state machine
  ui/                  garage HUD, race HUD + finish screen, settings dialog, styles
android/               Capacitor Android project (signing reads env vars / keystore.properties)
docs/                  GitHub Pages: privacy-policy.html, terms.html
.github/workflows/     build-aab.yml
```

All assets are generated at runtime or bundled into the APK/AAB; nothing is fetched from the network. The only links that leave the app are the Privacy Policy and Terms pages, which open in the system browser.

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

## Legal pages (GitHub Pages)

Enable **Settings → Pages → Deploy from a branch → `main` / `/docs`**. The app links to:

- https://imroulofficial.github.io/apex-overdrive-3d/privacy-policy.html
- https://imroulofficial.github.io/apex-overdrive-3d/terms.html

## Compliance notes

- Edge-to-edge: `viewport-fit=cover` plus Capacitor's SystemBars `insetsHandling: "css"`; every HUD edge is padded with the safe-area insets so nothing sits under the status bar, navigation bar or display cutout.
- 13+ / COPPA: no accounts, no personal data, no ad or analytics SDKs, and no `AD_ID` permission. Update the privacy policy and the Play Data safety form before adding AdMob or IAP.
