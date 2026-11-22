// Startup order for ads and Meta measurement (monetization/startAds.js, versionCode 70):
// UMP consent and the Meta re-sync right after the splash, as in v68; MobileAds.initialize
// only after the delay and the idle callback (ANR fix F4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startAds } from '../src/monetization/startAds.js';

function fakes() {
  const calls = [];
  let timer = null;
  let idle = null;
  let resolveConsent;
  const ads = {
    consent: () => {
      calls.push('consent');
      return new Promise((r) => (resolveConsent = r));
    },
    init: () => {
      calls.push('initialize');
      return Promise.resolve();
    },
  };
  const metaMeasurement = { sync: (...args) => calls.push(`meta-sync(${args.length})`) };
  const later = (fn, ms) => {
    calls.push(`timer(${ms})`);
    timer = fn;
  };
  const whenIdle = (fn) => {
    calls.push('idle-wait');
    idle = fn;
  };
  return { calls, ads, metaMeasurement, later, whenIdle, resolveConsent: (v) => resolveConsent(v), fireTimer: () => timer(), fireIdle: () => idle() };
}

test('consent starts at once and Meta syncs as soon as it is answered, before MobileAds.initialize', async () => {
  const f = fakes();
  const done = startAds({ ads: f.ads, metaMeasurement: f.metaMeasurement, delayMs: 4500, later: f.later, whenIdle: f.whenIdle });
  // Synchronously: consent requested, the initialize step only scheduled.
  assert.deepEqual(f.calls, ['consent', 'timer(4500)']);
  f.resolveConsent();
  await done;
  assert.deepEqual(f.calls, ['consent', 'timer(4500)', 'meta-sync(0)']);
  // initialize waits for the timer and then the idle callback.
  f.fireTimer();
  assert.deepEqual(f.calls.slice(3), ['idle-wait']);
  f.fireIdle();
  assert.deepEqual(f.calls, ['consent', 'timer(4500)', 'meta-sync(0)', 'idle-wait', 'initialize']);
});

test('Meta sync does not wait for the delayed initialize, even when consent is slow', async () => {
  const f = fakes();
  const done = startAds({ ads: f.ads, metaMeasurement: f.metaMeasurement, delayMs: 4500, later: f.later, whenIdle: f.whenIdle });
  f.fireTimer();
  f.fireIdle();
  // initialize may start while the consent form is still open (ads.init reuses that request).
  assert.deepEqual(f.calls, ['consent', 'timer(4500)', 'idle-wait', 'initialize']);
  f.resolveConsent();
  await done;
  assert.equal(f.calls.at(-1), 'meta-sync(0)');
});

test('main.js starts ads through startAds right after the splash, with the 4.5 s idle delay', async () => {
  const src = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(src, /const ADS_START_DELAY_MS = 4500;/);
  assert.match(src, /startAds\(\{ ads, metaMeasurement, delayMs: ADS_START_DELAY_MS, whenIdle \}\)/);
  // Nothing else starts ads or the startup Meta sync.
  assert.equal(src.match(/ads\.(init|consent)\(/g), null);
  assert.equal(src.match(/metaMeasurement\.sync\(/g), null);
  const reveal = src.slice(src.indexOf("$('#splash').classList.add('is-done')"));
  assert.ok(reveal.indexOf('startAds(') > 0 && reveal.indexOf('startAds(') < reveal.indexOf('cloud.init()'));
});

test('ads.js: consent() never calls MobileAds.initialize; init() reuses the one consent request', async () => {
  const src = await readFile(new URL('../src/monetization/ads.js', import.meta.url), 'utf8');
  const consentFn = src.slice(src.indexOf('async consent() {'), src.indexOf('async init(info) {'));
  assert.match(consentFn, /AdMob\.requestConsentInfo/);
  assert.match(consentFn, /AdMob\.showConsentForm/);
  assert.doesNotMatch(consentFn, /AdMob\.initialize/);
  const initFn = src.slice(src.indexOf('async init(info) {'), src.indexOf('showPrivacyOptions:'));
  assert.match(initFn, /AdMob\.initialize/);
  assert.doesNotMatch(initFn, /requestConsentInfo|showConsentForm/);
  assert.match(src, /consented \?\?= /);
  assert.match(src, /backend\.init\(await startConsent\(\)\)/);
});
