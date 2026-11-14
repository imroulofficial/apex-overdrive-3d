import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  decideMetaMeasurement, acConsentedIds, hasPurposeConsent, META_ATP_ID, META_TCF_PURPOSES,
  decodeGppHeader, decodeUsnat, gppSectionsInForce, decideUsOptOut,
} from '../src/monetization/metaConsent.js';

// Meta (Facebook) SDK for install / app-open measurement: the UMP consent → Meta mapping, and
// the Android setup that keeps Meta switched off until that mapping says yes.
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

// TCF purpose consent strings: '1' per consented purpose, purpose 1 first.
const ALL_PURPOSES = '11111111111';
const decide = (over) => decideMetaMeasurement({ umpStatus: 'OBTAINED', gdprApplies: 1, purposeConsents: ALL_PURPOSES, addtlConsent: '2~89.2253~dv.70', ...over });

test('Meta is Google ad tech provider 89 and needs TCF purposes 1 and 7', () => {
  assert.equal(META_ATP_ID, 89);
  assert.deepEqual(META_TCF_PURPOSES, [1, 7]);
});

test('Additional Consent strings: only the consented part counts', () => {
  assert.deepEqual(acConsentedIds('2~89.2253~dv.70.540'), [89, 2253]);
  assert.deepEqual(acConsentedIds('2~~dv.89.2253'), []); // disclosed but refused
  assert.deepEqual(acConsentedIds('1~89.43'), [89, 43]); // v1 format
  assert.deepEqual(acConsentedIds('2~43.890~dv.89'), [43, 890]); // 890 is not 89
  for (const bad of [null, undefined, '', '3~89', 'garbage', 89]) assert.deepEqual(acConsentedIds(bad), [], String(bad));
});

test('purpose consent reads the right position', () => {
  assert.equal(hasPurposeConsent('1000001', 1), true);
  assert.equal(hasPurposeConsent('1000001', 7), true);
  assert.equal(hasPurposeConsent('1000000', 7), false);
  assert.equal(hasPurposeConsent('1', 7), false); // too short
  assert.equal(hasPurposeConsent(null, 1), false);
});

test('EEA/UK/CH: allowed only with purposes 1 + 7 and Meta (89) consented', () => {
  assert.equal(decide().allowed, true);
  assert.equal(decide({ gdprApplies: '1' }).allowed, true);
  // "Consent" to everything except Meta itself.
  assert.equal(decide({ addtlConsent: '2~2253~dv.89' }).allowed, false);
  assert.equal(decide({ addtlConsent: null }).allowed, false);
  // Refused purpose 1 (device storage) or purpose 7 (measurement).
  assert.equal(decide({ purposeConsents: '01111111111' }).allowed, false);
  assert.equal(decide({ purposeConsents: '11111101111' }).allowed, false);
  // "Do not consent" / reject all.
  assert.equal(decide({ purposeConsents: '00000000000', addtlConsent: '2~~dv.89' }).allowed, false);
  // Consent message still pending or never completed: nothing stored yet.
  assert.equal(decide({ umpStatus: 'REQUIRED', purposeConsents: null, addtlConsent: null }).allowed, false);
  // A stale UMP status never overrides the stored GDPR signal.
  assert.equal(decide({ umpStatus: 'NOT_REQUIRED', purposeConsents: '0', addtlConsent: '2~~dv.89' }).allowed, false);
});

test('outside GDPR and US message areas: allowed when UMP says consent is not required', () => {
  for (const gdprApplies of [0, '0', null, undefined]) {
    for (const gppSid of [undefined, null, '', '-1', '0']) {
      assert.equal(decideMetaMeasurement({ umpStatus: 'NOT_REQUIRED', gdprApplies, gppSid }).allowed, true, `${gdprApplies} ${gppSid}`);
    }
  }
  // OBTAINED outside GDPR means the US message ran; with no readable US section, Meta stays off.
  assert.equal(decideMetaMeasurement({ umpStatus: 'OBTAINED', gdprApplies: 0 }).allowed, false);
});

// Strings Google's AdMob team published for the UMP US states message (usnat, section 7).
const US_ALLOW = 'DBABL~BVQqAAAAAg'; // "Allow data sharing"
const US_OPTED_OUT = 'DBABL~BVQVAAAAAg'; // "Don't allow data sharing"
const US_NO_CHOICE = 'DBABL~BAAAAAAAAg'; // reported for a fresh install, before any choice

test('GPP header: section ids, including the spec examples', () => {
  assert.deepEqual(decodeGppHeader('DBABM').sectionIds, [2]);
  assert.deepEqual(decodeGppHeader('DBACNY').sectionIds, [2, 6]);
  assert.deepEqual(decodeGppHeader('DBABjw').sectionIds, [5, 6]);
  assert.deepEqual(decodeGppHeader('DBABL').sectionIds, [7]);
  for (const bad of ['', null, 'D', 'AAAA', '!!!', 42]) assert.equal(decodeGppHeader(bad), null, String(bad));
});

test('usnat core: sale, sharing and targeted-advertising opt-outs and GPC', () => {
  assert.deepEqual(decodeUsnat('BVQqAAAAAg'), { version: 1, saleOptOut: 2, sharingOptOut: 2, targetedAdvertisingOptOut: 2, gpc: false });
  assert.deepEqual(decodeUsnat('BVQVAAAAAg'), { version: 1, saleOptOut: 1, sharingOptOut: 1, targetedAdvertisingOptOut: 1, gpc: false });
  assert.deepEqual(decodeUsnat('BAAAAAAAAg'), { version: 1, saleOptOut: 0, sharingOptOut: 0, targetedAdvertisingOptOut: 0, gpc: false });
  assert.equal(decodeUsnat('BVQqAAAAAg.YA').gpc, true); // GPC subsection: type 1, Gpc = 1
  assert.equal(decodeUsnat('BVQqAAAAAg.QA').gpc, false); // GPC subsection: type 1, Gpc = 0
  assert.equal(decodeUsnat('DVQqAAAAAg'), null); // usnat version 3: layout not known here
  for (const bad of ['', null, 'B', 'BV?q']) assert.equal(decodeUsnat(bad), null, String(bad));
});

test('GPP sections in force', () => {
  assert.deepEqual(gppSectionsInForce('7'), [7]);
  assert.deepEqual(gppSectionsInForce('2_7'), [2, 7]);
  assert.deepEqual(gppSectionsInForce(7), [7]);
  for (const none of ['-1', '0', '', null, undefined]) assert.deepEqual(gppSectionsInForce(none), [], String(none));
});

test('US states message: Meta only when the player did not opt out', () => {
  for (const umpStatus of ['NOT_REQUIRED', 'OBTAINED']) {
    const us = (gppString, gppSid = '7') => decideMetaMeasurement({ umpStatus, gdprApplies: 0, gppSid, gppString });
    assert.equal(us(US_ALLOW).allowed, true, umpStatus);
    assert.equal(us(US_OPTED_OUT).allowed, false, umpStatus);
    // No choice recorded, missing or broken signal: unknown, so off for this session.
    assert.equal(us(US_NO_CHOICE).allowed, false, umpStatus);
    assert.equal(us(undefined).allowed, false, umpStatus);
    assert.equal(us('DBABL').allowed, false, umpStatus); // header only
    assert.equal(us('DBABM~BVQqAAAAAg').allowed, false, umpStatus); // header says the part is TCF
    assert.equal(us('garbage').allowed, false, umpStatus);
    // GPC set, or a US section this code cannot read (a state section, old US Privacy).
    assert.equal(us('DBABL~BVQqAAAAAg.YA').allowed, false, umpStatus);
    assert.equal(us(US_ALLOW, '8').allowed, false, umpStatus);
    assert.equal(us(US_ALLOW, '7_8').allowed, false, umpStatus);
    assert.equal(us(US_ALLOW, '6').allowed, false, umpStatus);
  }
  // Only one of the three opt-outs is enough to keep Meta off.
  const one = 'BVQmAAAAAg'; // sale 2, sharing 1, targeted 2
  assert.deepEqual(decodeUsnat(one), { version: 1, saleOptOut: 2, sharingOptOut: 1, targetedAdvertisingOptOut: 2, gpc: false });
  assert.equal(decideUsOptOut({ gppSid: '7', gppString: `DBABL~${one}` }).allowed, false);
  // Not in a US message area: the US check does not apply.
  assert.equal(decideUsOptOut({ gppSid: '-1', gppString: US_OPTED_OUT }), null);
  // The EU rules win where GDPR applies, whatever a stale GPP string says.
  assert.equal(decide({ gppSid: '7', gppString: US_ALLOW, addtlConsent: '2~~dv.89' }).allowed, false);
  // UMP check failed: off, as before.
  assert.equal(decideMetaMeasurement({ umpStatus: undefined, gppSid: '7', gppString: US_ALLOW }).allowed, false);
});

test('unknown region (UMP failed, offline, still required): Meta gets nothing', () => {
  for (const umpStatus of ['REQUIRED', 'UNKNOWN', undefined, null, 'SOMETHING_NEW']) {
    for (const gdprApplies of [0, null]) {
      assert.equal(decideMetaMeasurement({ umpStatus, gdprApplies }).allowed, false, `${umpStatus} ${gdprApplies}`);
    }
  }
  assert.equal(decideMetaMeasurement().allowed, false);
  assert.equal(decideMetaMeasurement({}).allowed, false);
});

test('the manifest starts Meta switched off and does not auto-start the SDK', async () => {
  const manifest = await read('android/app/src/main/AndroidManifest.xml');
  const meta = (name) => manifest.match(new RegExp(`android:name="com\\.facebook\\.sdk\\.${name}"\\s+android:value="([^"]*)"`))?.[1];
  assert.equal(meta('ApplicationId'), '@string/facebook_app_id');
  assert.equal(meta('ClientToken'), '@string/facebook_client_token');
  for (const off of ['AutoInitEnabled', 'AutoLogAppEventsEnabled', 'AdvertiserIDCollectionEnabled', 'AutoLogMetaDataEnabled', 'AutoLogProductImprovementEnabled']) {
    assert.equal(meta(off), 'false', off);
  }
  assert.match(manifest, /android:name="com\.facebook\.internal\.FacebookInitProvider"\s+android:authorities="\$\{applicationId\}\.FacebookInitProvider"\s+tools:node="remove"/);
  // Measurement only: Meta's Privacy Sandbox custom-audience (remarketing) permission is removed.
  assert.match(manifest, /android:name="android\.permission\.ACCESS_ADSERVICES_CUSTOM_AUDIENCE"\s+tools:node="remove"/);
  const strings = await read('android/app/src/main/res/values/strings.xml');
  assert.match(strings, /<string name="facebook_app_id" translatable="false">1099961482668447<\/string>/);
  assert.match(strings, /<string name="facebook_client_token" translatable="false">[0-9a-f]{32}<\/string>/);
});

test('only facebook-core, at an exact version, and nothing logged by hand', async () => {
  const gradle = await read('android/app/build.gradle');
  const deps = [...gradle.matchAll(/com\.facebook\.android:([\w-]+):([^"'\s]+)/g)];
  assert.deepEqual(deps.map((m) => m[1]), ['facebook-core']);
  assert.match(deps[0][2], /^\d+\.\d+\.\d+$/);
  const plugin = await read('android/app/src/main/java/com/redpenstudio/apexoverdrive/MetaMeasurementPlugin.java');
  const js = await read('src/monetization/metaMeasurement.js');
  for (const src of [plugin, js]) assert.doesNotMatch(src, /logEvent|logPurchase|newLogger|setUserData|setUserID/);
  // The bridge is a local plugin, registered by the app itself.
  assert.match(await read('android/app/src/main/java/com/redpenstudio/apexoverdrive/MainActivity.java'), /registerPlugin\(MetaMeasurementPlugin\.class\);\s+super\.onCreate/);
  const pkg = JSON.parse(await read('package.json'));
  assert.ok(!Object.keys(pkg.dependencies).some((d) => /facebook|fbsdk|meta/i.test(d)));
  // Only the launch consent check and the Ad privacy row drive the bridge.
  const files = (await readdir(new URL('../src/', import.meta.url), { recursive: true })).filter((f) => f.endsWith('.js'));
  const users = [];
  for (const f of files) if (/^import .*from '[./]*(monetization\/)?metaMeasurement\.js';$/m.test(await read(`src/${f}`))) users.push(f.replaceAll('\\', '/'));
  assert.deepEqual(users.sort(), ['main.js', 'ui/settings.js']);
});
