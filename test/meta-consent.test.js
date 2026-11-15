import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';

// Meta (Facebook) SDK for install / app-open measurement: the Android setup (the Zingora-style
// MetaManifestTest equivalent) and the wiring that keeps Meta off until consent allows it. The
// consent rules themselves are Java unit tests (android/app/src/test/.../meta), which run with
// every bundleRelease, so CI checks them too.
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const JAVA = 'android/app/src/main/java/com/redpenstudio/apexoverdrive';

test('the manifest starts Meta switched off and does not auto-start the SDK', async () => {
  const manifest = await read('android/app/src/main/AndroidManifest.xml');
  const meta = (name) => manifest.match(new RegExp(`android:name="com\\.facebook\\.sdk\\.${name}"\\s+android:value="([^"]*)"`))?.[1];
  assert.equal(meta('ApplicationId'), '@string/facebook_app_id');
  assert.equal(meta('ClientToken'), '@string/facebook_client_token');
  for (const off of ['AutoInitEnabled', 'AutoLogAppEventsEnabled', 'AdvertiserIDCollectionEnabled', 'AutoLogMetaDataEnabled', 'AutoLogProductImprovementEnabled', 'MonitorEnabled']) {
    assert.equal(meta(off), 'false', off);
  }
  assert.match(manifest, /android:name="com\.facebook\.internal\.FacebookInitProvider"\s+android:authorities="\$\{applicationId\}\.FacebookInitProvider"\s+tools:node="remove"/);
  // Measurement only: Meta's Privacy Sandbox custom-audience (remarketing) permission is removed.
  assert.match(manifest, /android:name="android\.permission\.ACCESS_ADSERVICES_CUSTOM_AUDIENCE"\s+tools:node="remove"/);
  const strings = await read('android/app/src/main/res/values/strings.xml');
  assert.match(strings, /<string name="facebook_app_id" translatable="false">1099961482668447<\/string>/);
  assert.match(strings, /<string name="facebook_client_token" translatable="false">[0-9a-f]{32}<\/string>/);
});

test('the manifest queries only the Facebook app, as in Zingora', async () => {
  const manifest = await read('android/app/src/main/AndroidManifest.xml');
  const queries = [...manifest.matchAll(/<queries>([\s\S]*?)<\/queries>/g)];
  assert.equal(queries.length, 1);
  assert.deepEqual([...queries[0][1].matchAll(/<package android:name="([^"]+)"\s*\/>/g)].map((m) => m[1]), ['com.facebook.katana']);
  assert.doesNotMatch(queries[0][1], /<intent>|<provider/);
});

test('the SDK starts natively at app start, before the first screen, when the stored answer allows it', async () => {
  const manifest = await read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /<application\s+android:name="\.ApexOverdriveApplication"/);
  const app = await read(`${JAVA}/ApexOverdriveApplication.java`);
  assert.match(app, /extends Application/);
  // After super.onCreate, inside a catch-all: Meta can never crash or block the game's start.
  assert.match(app, /super\.onCreate\(\);\s+try \{\s+FacebookMetaSdk\.attribution\(this\)\.onAppCreate\(\);\s+\} catch \(Throwable t\)/);
  const sdk = await read(`${JAVA}/meta/FacebookMetaSdk.java`);
  // Started the same way as Zingora's FacebookMetaSdk.enable(), in the same order.
  const enable = sdk.slice(sdk.indexOf('public void enable()'), sdk.indexOf('public void disable()'));
  const order = [
    'FacebookSdk.fullyInitialize()', 'FacebookSdk.isInitialized()', 'FacebookSdk.sdkInitialize(app)',
    'FacebookSdk.setDataProcessingOptions(new String[] { "LDU" }, 0, 0)', 'FacebookSdk.setAdvertiserIDCollectionEnabled(true)',
    'FacebookSdk.setAutoInitEnabled(true)', 'FacebookSdk.setAutoLogAppEventsEnabled(true)', 'AppEventsLogger.activateApp(app)',
  ];
  let at = -1;
  for (const call of order) {
    const i = enable.indexOf(call);
    assert.ok(i > at, `${call} missing or out of order`);
    at = i;
  }
  // The stored UMP answer: consent status, canRequestAds and the IAB TCF / GPP keys.
  for (const key of ['getConsentStatus()', 'canRequestAds()', 'IABTCF_gdprApplies', 'IABTCF_PurposeConsents', 'IABTCF_AddtlConsent', 'IABGPP_GppSID', 'IABGPP_HDR_GppString']) {
    assert.ok(sdk.includes(key), key);
  }
});

test('the JS re-sync after ads.init() and Settings → Ad privacy still drives the bridge', async () => {
  const js = await read('src/monetization/metaMeasurement.js');
  assert.match(js, /registerPlugin\('MetaMeasurement'\)/);
  assert.match(js, /Native\.sync\(\)/);
  const plugin = await read(`${JAVA}/MetaMeasurementPlugin.java`);
  assert.match(plugin, /@PluginMethod\s+public void sync\(PluginCall call\)/);
  assert.match(plugin, /onConsentUpdated\(/);
  assert.match(await read('src/main.js'), /ads\.init\(\)\.then\(\(\) => metaMeasurement\.sync\(/);
  assert.match(await read('src/ui/settings.js'), /\.then\(\(\) => metaMeasurement\.sync\(/);
  // The Java consent rules run with every release bundle.
  assert.match(await read('android/app/build.gradle'), /it\.name == 'bundleRelease' \}\.configureEach \{ dependsOn 'testReleaseUnitTest' \}/);
  for (const t of ['MetaConsentPolicyTest', 'UsPrivacyOptOutTest', 'MetaAttributionTest']) {
    await access(new URL(`../android/app/src/test/java/com/redpenstudio/apexoverdrive/meta/${t}.java`, import.meta.url));
  }
});

test('only facebook-core 19.0.1, and nothing logged by hand', async () => {
  const gradle = await read('android/app/build.gradle');
  const deps = [...gradle.matchAll(/com\.facebook\.android:([\w-]+):([^"'\s]+)/g)];
  assert.deepEqual(deps.map((m) => [m[1], m[2]]), [['facebook-core', '19.0.1']]);
  // UMP is compile-time only: the runtime copy is the AdMob plugin's own.
  assert.match(gradle, /compileOnly "com\.google\.android\.ump:user-messaging-platform:[\d.]+"/);
  assert.doesNotMatch(gradle, /implementation "com\.google\.android\.ump/);
  const sources = [
    await read(`${JAVA}/MetaMeasurementPlugin.java`), await read(`${JAVA}/meta/FacebookMetaSdk.java`),
    await read(`${JAVA}/meta/MetaAttribution.java`), await read('src/monetization/metaMeasurement.js'),
  ];
  for (const src of sources) assert.doesNotMatch(src, /logEvent|logPurchase|newLogger|setUserData|setUserID/);
  // The bridge is a local plugin, registered by the app itself.
  assert.match(await read(`${JAVA}/MainActivity.java`), /registerPlugin\(MetaMeasurementPlugin\.class\);\s+super\.onCreate/);
  const pkg = JSON.parse(await read('package.json'));
  assert.ok(!Object.keys(pkg.dependencies).some((d) => /facebook|fbsdk|meta/i.test(d)));
  // Only the launch consent check and the Ad privacy row drive the bridge.
  const files = (await readdir(new URL('../src/', import.meta.url), { recursive: true })).filter((f) => f.endsWith('.js'));
  const users = [];
  for (const f of files) if (/^import .*from '[./]*(monetization\/)?metaMeasurement\.js';$/m.test(await read(`src/${f}`))) users.push(f.replaceAll('\\', '/'));
  assert.deepEqual(users.sort(), ['main.js', 'ui/settings.js']);
});
