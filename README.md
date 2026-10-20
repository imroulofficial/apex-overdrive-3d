# Apex Overdrive: 3D Racing

Offline-first 3D arcade racer for Android by **Red Pen Studio**.

| | |
|---|---|
| Package | `com.redpenstudio.apexoverdrive` |
| Android | minSdk 24 · targetSdk 36 · compileSdk 36 · edge-to-edge |
| Stack | Three.js (WebGL2) + Vite, wrapped with Capacitor 8 |
| Audience | 13+, no accounts, no analytics, no network calls during play |

## Phase 1 (this release)

- **3D garage**: mirror-finish showroom floor, turntable, LED walls, a shadow-casting key spotlight and two sweeping coloured rim spots that power on in sequence.
- **Starter coupe "RP-1 Vanta"**: generated procedurally from lofted body sections (no downloaded meshes) with a clear-coat metallic-flake paint shader (`MeshPhysicalMaterial` + generated flake normal map) and finishes for metallic, gloss, pearl (iridescent), matte and chrome.
- **Orbit camera**: one-finger drag rotates 360°, pinch zooms, idle auto-rotate, and animated snaps to Body / Wheels (tap again to cycle all four) / Front / Rear. Tapping a wheel on the car snaps to it, tapping the head or tail lights toggles them, tapping the body re-frames it.
- **HUD**: angled glassmorphism panels with coins, Paint and Upgrades tabs (purchases saved offline), vehicle stats, Race Start (countdown; tracks arrive in Phase 2), and a Settings dialog with graphics quality, sound, FPS counter and links to the Privacy Policy and Terms of Service.
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
  core/                save data (localStorage), synthesized UI audio, Capacitor helpers
  data/catalog.js      paints, finishes, upgrades, prices
  garage/              renderer + quality, showroom, procedural car, paint shader, camera rig
  ui/                  HUD, settings dialog, styles
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
