import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, migrateV1, defaults, normalize, progressOf, applyProgress, toCloudDoc, fromCloudDoc, SAVE_VERSION } from '../src/core/saveSchema.js';
import { STAGES } from '../src/data/career.js';
import { v1Save } from './helpers.js';

test('a fresh install starts on v2 defaults', () => {
  const s = migrate(null);
  assert.equal(s.v, 2);
  assert.equal(s.coins, 2500);
  assert.equal(s.car, 'rp1-vanta');
  assert.deepEqual(Object.keys(s.cars), ['rp1-vanta']);
  assert.equal(s.career.unlockedStage, 1);
  assert.equal(s.career.stageStars.length, STAGES.length);
  assert.ok(s.career.stageStars.every((m) => m === 0));
  assert.deepEqual(s.career.milestones, []);
});

test('v1 -> v2 keeps coins and every purchase flag', () => {
  const v1 = v1Save();
  const s = migrate(v1);
  assert.equal(s.v, SAVE_VERSION);
  assert.equal(s.coins, 18450);
  assert.deepEqual(s.purchases.owned, ['supercar_bundle']);
  assert.deepEqual(s.purchases.sandboxOwned, ['remove_ads']);
  assert.deepEqual(s.purchases.granted, ['supercar_bundle']);
  assert.equal(s.purchases.noAds, true);
  assert.equal(s.savedAt, v1.savedAt);
  assert.deepEqual(s.settings, { ...v1.settings, controls: 'touch', bloom: 'low', cameraView: 'chase' }); // Phase 8 added the control scheme, Phase 11 bloom, then the camera view
  assert.deepEqual(s.ads, v1.ads);
});

test('v1 global upgrades and paint land on every car the player owned', () => {
  const s = migrate(v1Save());
  assert.deepEqual(Object.keys(s.cars).sort(), ['rp1-vanta', 'rpx-hyperion']);
  for (const id of ['rp1-vanta', 'rpx-hyperion']) {
    assert.deepEqual(s.cars[id].upgrades, { topSpeed: 3, acceleration: 1, handling: 4, nitro: 2 });
    assert.equal(s.cars[id].paint, 'ultraviolet');
    assert.equal(s.cars[id].rim, 'stock');
  }
  assert.equal(s.cars['rp1-vanta'].unlockedBy, 'starter');
  assert.equal(s.cars['rpx-hyperion'].unlockedBy, 'iap');
  assert.equal(s.car, 'rpx-hyperion');
  assert.ok(s.ownedPaints.includes('ultraviolet') && s.ownedPaints.includes('volt'));
  assert.equal(s.upgrades, undefined);
  assert.equal(s.paint, undefined);
  assert.equal(s.records, undefined);
});

test('the v1 Emerald Coast record becomes career stage 1', () => {
  const s = migrate(v1Save());
  assert.equal(s.career.stageStars[0], 1); // top-3 finish = stage 1 star 1
  assert.equal(s.career.unlockedStage, 2);
  assert.deepEqual(s.career.best['ec-01'], { time: 131.42, score: 0, plays: 9 });

  const never = v1Save();
  never.records = {};
  const t = migrate(never);
  assert.equal(t.career.unlockedStage, 1);
  assert.deepEqual(t.career.best, {});

  const backmarker = v1Save();
  backmarker.records['emerald-coast'].stars = 1; // only ever finished 4th-6th
  assert.equal(migrate(backmarker).career.stageStars[0], 0);
});

test('a v1 IAP car without the store list still migrates from the purchase', () => {
  const v1 = v1Save();
  delete v1.ownedCars;
  const s = migrate(v1);
  assert.ok(s.cars['rpx-hyperion']);
});

test('a very old v1 save without the interstitial counter counts its races', () => {
  const v1 = v1Save();
  delete v1.ads.racesFinished;
  assert.equal(migrate(v1).ads.racesFinished, 9);
});

test('migration is idempotent and v2 saves load unchanged', () => {
  const once = migrate(v1Save());
  const twice = migrate(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
});

test('damaged saves are repaired, never thrown', () => {
  for (const bad of [undefined, 42, 'x', [], { v: 2, cars: 'nope', career: { stageStars: 'x', unlockedStage: 999 } }, { upgrades: { engine: 99 } }]) {
    const s = migrate(bad);
    assert.equal(s.v, 2);
    assert.ok(s.cars['rp1-vanta']);
    assert.ok(s.career.unlockedStage >= 1 && s.career.unlockedStage <= STAGES.length);
    assert.equal(s.career.stageStars.length, STAGES.length);
  }
  assert.equal(migrate({ upgrades: { engine: 99 } }).cars['rp1-vanta'].upgrades.topSpeed, 5);
  const s = normalize({ v: 2, car: 'ghost', cars: { ghost: {}, 'rp1-vanta': { upgrades: { nitro: -3 }, paint: 'nope', rim: 'gold', spoiler: 'jet', spoilers: ['jet', 'gt-wing'], smoke: 'plaid', nitroFx: 7 } }, career: { stageStars: [9, 3.4, -1], milestones: ['ec-15', 'fake', 'stars-10', 'ec-15'] } });
  assert.equal(s.car, 'rp1-vanta');
  assert.equal(s.cars.ghost, undefined);
  assert.equal(s.cars['rp1-vanta'].upgrades.nitro, 0);
  assert.equal(s.cars['rp1-vanta'].paint, 'apex-red');
  assert.equal(s.cars['rp1-vanta'].rim, 'stock');
  assert.equal(s.cars['rp1-vanta'].spoiler, 'factory');
  assert.deepEqual(s.cars['rp1-vanta'].spoilers, ['factory']);
  assert.equal(s.cars['rp1-vanta'].smoke, 'white');
  assert.equal(s.cars['rp1-vanta'].nitroFx, 'blue');
  assert.deepEqual(s.career.stageStars.slice(0, 3), [7, 3, 0]);
  assert.deepEqual(s.career.milestones, ['ec-15']);
});

// ---- Cloud ----

test('a v1 cloud document migrates to v2 progress', () => {
  const v1 = v1Save();
  const progressV1 = {
    coins: v1.coins,
    paint: v1.paint,
    ownedPaints: v1.ownedPaints,
    upgrades: v1.upgrades,
    car: v1.car,
    records: v1.records,
    purchases: { owned: v1.purchases.owned, granted: v1.purchases.granted },
    crateClaimedAt: v1.ads.crateClaimedAt,
  };
  const doc = { v: 1, save: JSON.stringify(progressV1), updatedAt: 1792531300000, appVersion: '0.6.0' };
  const parsed = fromCloudDoc(doc);
  assert.equal(parsed.v, 1);
  assert.equal(parsed.updatedAt, doc.updatedAt);
  const p = parsed.progress;
  assert.equal(p.economy.coins, 18450);
  assert.equal(p.economy.supercarBundlePurchased, true);
  assert.equal(p.economy.noAdsPurchased, true);
  assert.deepEqual(p.economy.granted, ['supercar_bundle']);
  assert.equal(p.economy.crateClaimedAt, v1.ads.crateClaimedAt);
  assert.equal(p.progression.unlockedStage, 2);
  assert.equal(p.garage.cars['rpx-hyperion'].upgrades.handling, 4);
  assert.equal(p.garage.car, 'rpx-hyperion');
});

test('v2 cloud documents round-trip', () => {
  const s = migrate(v1Save());
  const doc = JSON.parse(JSON.stringify(toCloudDoc(s, '0.7.0')));
  assert.equal(doc.v, 2);
  assert.equal(doc.updatedAt, s.savedAt);
  assert.equal(doc.save, undefined);
  const back = fromCloudDoc(doc);
  assert.deepEqual(back.progress, JSON.parse(JSON.stringify(progressOf(s))));

  const other = defaults();
  other.purchases.granted = ['remove_ads'];
  other.career.milestones = ['ec-15'];
  other.ads.crateClaimedAt = 1792531999999;
  applyProgress(other, back.progress, doc.updatedAt);
  assert.equal(other.coins, 18450);
  assert.equal(other.savedAt, doc.updatedAt);
  assert.deepEqual(other.cars['rpx-hyperion'].upgrades, s.cars['rpx-hyperion'].upgrades);
  assert.deepEqual(other.career.stageStars, s.career.stageStars);
  // Bonuses paid and milestones claimed on this device are never forgotten.
  assert.deepEqual(other.purchases.granted.sort(), ['remove_ads', 'supercar_bundle']);
  assert.deepEqual(other.career.milestones, ['ec-15']);
  assert.equal(other.ads.crateClaimedAt, 1792531999999);
  // Device-only settings survive.
  assert.deepEqual(other.settings, defaults().settings);
});

test('cloud documents from a newer app are recognised and not parsed', () => {
  assert.deepEqual(fromCloudDoc({ v: 3, updatedAt: 5 }), { v: 3, updatedAt: 5, newer: true, progress: null });
  assert.equal(fromCloudDoc(null), null);
  assert.equal(fromCloudDoc({ v: 1, save: '{broken' }), null);
  assert.equal(fromCloudDoc({ v: 2, economy: {} }), null);
});

test('control scheme defaults to Touch Drive and survives migration', () => {
  assert.equal(migrate(null).settings.controls, 'touch');
  // Phase 1-7 saves have no controls setting.
  assert.equal(migrate(v1Save()).settings.controls, 'touch');
  const s = migrate(null);
  s.settings.controls = 'wheel';
  assert.equal(normalize(JSON.parse(JSON.stringify(s))).settings.controls, 'wheel');
  s.settings.controls = 'joystick';
  assert.equal(normalize(s).settings.controls, 'touch');
});

// ---- 0.14.0 roster: 12 cars -> 8 ----

test('retired cars and bought wings are refunded once, then gone', () => {
  const before = {
    v: 2,
    coins: 1000,
    car: 'zn-zenith',
    cars: {
      'rp1-vanta': { unlockedBy: 'starter', upgrades: { topSpeed: 2 }, spoilers: ['factory', 'gt-wing'], spoiler: 'gt-wing' },
      'zn-zenith': { unlockedBy: 'coins', upgrades: { topSpeed: 2, nitro: 1 }, rims: ['stock', 'mesh'], spoilers: ['factory', 'ducktail'] },
      'dr-raptor': { unlockedBy: 'stars', upgrades: {} },
    },
  };
  const s = normalize(before);
  // 75,000 + 20,000 cars, 250 + 500 + 250 upgrades, 500 mesh rims, 1,500 + 800 wings.
  assert.equal(s.coins, 1000 + 75000 + 20000 + 1000 + 500 + 2300);
  assert.equal(s.car, 'rp1-vanta');
  assert.deepEqual(Object.keys(s.cars), ['rp1-vanta']);
  assert.equal(s.cars['rp1-vanta'].upgrades.topSpeed, 2); // a kept car keeps its upgrades
  assert.deepEqual(s.cars['rp1-vanta'].spoilers, ['factory']);
  // Loading the normalized save again pays nothing more.
  assert.equal(normalize(JSON.parse(JSON.stringify(s))).coins, s.coins);
});

