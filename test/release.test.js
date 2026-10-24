import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import sharp from 'sharp';
import { GAME, ADMOB_APP_ID, PRODUCTION_AD_UNITS, TEST_AD_UNITS, ADS, PRODUCTS, RELEASE } from '../src/config.js';

// The 1.0.0 Google Play release candidate: versions, live AdMob ids, no sandbox store, icons.
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const RES = 'android/app/src/main/res';

test('package.json, build.gradle and the About line agree on 1.0.0 (code 64)', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const gradle = await read('android/app/build.gradle');
  assert.equal(pkg.version, '1.0.0');
  assert.equal(GAME.version, pkg.version);
  assert.match(gradle, /versionName "1\.0\.0"/);
  assert.match(gradle, /versionCode 64\b/);
  assert.doesNotMatch(await read('.github/workflows/build-aab.yml'), /-PversionCode/);
});

test('the manifest carries the live AdMob app id', async () => {
  const manifest = await read('android/app/src/main/AndroidManifest.xml');
  assert.equal(ADMOB_APP_ID, 'ca-app-pub-1848535996024012~6089611565');
  assert.match(manifest, new RegExp(`android:name="com.google.android.gms.ads.APPLICATION_ID"\\s+android:value="${ADMOB_APP_ID}"`));
});

test('release builds serve the live ad units, everything else Google test units', async () => {
  assert.deepEqual({ ...PRODUCTION_AD_UNITS }, {
    banner: 'ca-app-pub-1848535996024012/3147879768',
    interstitial: 'ca-app-pub-1848535996024012/1044546325',
    rewarded: 'ca-app-pub-1848535996024012/1767223174',
  });
  for (const id of Object.values(TEST_AD_UNITS)) assert.ok(id.startsWith('ca-app-pub-3940256099942544/'));
  // Under plain Node there is no Vite env, which is the dev/debug path.
  assert.equal(RELEASE, false);
  assert.equal(ADS.units, TEST_AD_UNITS);
  assert.equal(ADS.testing, true);
  // The Play bundle: release mode sets VITE_RELEASE=1, and CI builds in that mode.
  assert.match(await read('.env.release'), /^VITE_RELEASE=1$/m);
  assert.match(JSON.parse(await read('package.json')).scripts['build:release'], /--mode release/);
  assert.match(await read('.github/workflows/build-aab.yml'), /npm run build:release/);
});

test('the sandbox store is gone: purchases go through Google Play only', async () => {
  assert.deepEqual(Object.keys(PRODUCTS), ['remove_ads', 'supercar_bundle']);
  assert.equal(PRODUCTS.remove_ads.price, '$2.99');
  assert.equal(PRODUCTS.supercar_bundle.price, '$6.99');
  for (const file of ['index.html', 'src/monetization/billing.js', 'src/ui/settings.js', 'src/ui/store.js', 'src/ui/hud.js', 'src/core/inventory.js']) {
    assert.doesNotMatch(await read(file), /sandbox/i, file);
  }
});

test('every launcher density and the 512 px Play icon are present at their sizes', async () => {
  const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(DENSITIES)) {
    const dir = new URL(`../${RES}/mipmap-${d}/`, import.meta.url);
    const files = (await readdir(dir)).sort();
    assert.deepEqual(files, ['ic_launcher.png', 'ic_launcher_background.png', 'ic_launcher_foreground.png', 'ic_launcher_round.png']);
    for (const f of files) {
      const { width, height } = await sharp(new URL(f, dir).pathname).metadata();
      const want = Math.round((/_(fore|back)ground/.test(f) ? 108 : 48) * k);
      assert.deepEqual([width, height], [want, want], `${d}/${f}`);
    }
  }
  // Adaptive foreground: the art fills the visible 72 dp centre, the 18 dp margin is transparent.
  const fg = await sharp(new URL(`../${RES}/mipmap-xxxhdpi/ic_launcher_foreground.png`, import.meta.url).pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => fg.data[(y * fg.info.width + x) * 4 + 3];
  assert.equal(alphaAt(10, 10), 0);
  assert.equal(alphaAt(fg.info.width >> 1, fg.info.height >> 1), 255);
  const store = await sharp(new URL('../public/assets/icon/play-store-512.png', import.meta.url).pathname).metadata();
  assert.deepEqual([store.width, store.height, store.format], [512, 512, 'png']);
  assert.match(await read(`${RES}/mipmap-anydpi-v26/ic_launcher.xml`), /ic_launcher_foreground/);
});
