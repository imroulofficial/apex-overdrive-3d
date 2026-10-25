import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Google Play pre-launch warnings on 1.0.0 (64): edge-to-edge via EdgeToEdge.enable, no Android 15
// deprecated edge-to-edge APIs, and no orientation / resizability restrictions for large screens.
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const ACTIVITY = 'android/app/src/main/java/com/redpenstudio/apexoverdrive/MainActivity.java';
const DEPRECATED_CALLS = /setStatusBarColor|setNavigationBarColor|setNavigationBarDividerColor|setSystemUiVisibility|SYSTEM_UI_FLAG_|LAYOUT_IN_DISPLAY_CUTOUT_MODE_(SHORT_EDGES|DEFAULT)|FLAG_TRANSLUCENT_|setDecorFitsSystemWindows/;

test('MainActivity enables edge-to-edge through androidx before super.onCreate', async () => {
  const src = await read(ACTIVITY);
  const code = src.replace(/\/\/.*$/gm, '');
  assert.match(code, /import androidx\.activity\.EdgeToEdge;/);
  const enable = code.indexOf('EdgeToEdge.enable(this');
  assert.ok(enable > 0 && enable < code.indexOf('super.onCreate(savedInstanceState)'));
  assert.match(code, /WindowCompat\.getInsetsController\(window, decor\)/);
  assert.match(code, /BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE/);
  assert.doesNotMatch(code, DEPRECATED_CALLS);
  const gradle = await read('android/app/build.gradle');
  assert.match(gradle, /implementation "androidx\.activity:activity:\$androidxActivityVersion"/);
  const [maj, min] = (await read('android/variables.gradle')).match(/androidxActivityVersion = '(\d+)\.(\d+)/).slice(1).map(Number);
  assert.ok(maj > 1 || min >= 9, 'androidx.activity 1.9+ ships EdgeToEdge');
});

test('no theme sets deprecated bar colours, translucent bars or a deprecated cutout mode', async () => {
  const res = 'android/app/src/main/res';
  const dirs = (await readdir(new URL(`../${res}/`, import.meta.url))).filter((d) => d.startsWith('values'));
  assert.ok(dirs.includes('values-v30'));
  for (const dir of dirs) {
    for (const file of await readdir(new URL(`../${res}/${dir}/`, import.meta.url))) {
      const xml = await read(`${res}/${dir}/${file}`);
      assert.doesNotMatch(xml, /android:(statusBarColor|navigationBarColor|navigationBarDividerColor|windowTranslucentStatus|windowTranslucentNavigation)/, `${dir}/${file}`);
      assert.doesNotMatch(xml, /windowLayoutInDisplayCutoutMode"[^>]*>(shortEdges|default)</, `${dir}/${file}`);
    }
  }
  assert.match(await read(`${res}/values-v30/styles.xml`), /windowLayoutInDisplayCutoutMode">always</);
});

test('the manifest drops the orientation lock and declares a resizable game', async () => {
  const manifest = await read('android/app/src/main/AndroidManifest.xml');
  assert.doesNotMatch(manifest, /screenOrientation/);
  assert.doesNotMatch(manifest, /resizeableActivity="false"/);
  assert.equal(manifest.match(/android:resizeableActivity="true"/g).length, 2);
  const changes = manifest.match(/android:configChanges="([^"]+)"/)[1].split('|');
  for (const c of ['orientation', 'keyboardHidden', 'keyboard', 'screenSize', 'locale', 'smallestScreenSize', 'screenLayout', 'uiMode', 'navigation', 'density']) {
    assert.ok(changes.includes(c), c);
  }
});

test('no status-bar plugin is installed: MainActivity owns the system bars', async () => {
  const pkg = JSON.parse(await read('package.json'));
  for (const name of ['@capacitor/status-bar', '@capacitor/splash-screen']) {
    assert.equal(pkg.dependencies[name], undefined, name);
  }
  assert.doesNotMatch(await read('android/capacitor.settings.gradle'), /status-bar|splash-screen/);
});
