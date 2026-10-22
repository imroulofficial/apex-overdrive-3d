import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../src/core/saveSchema.js';
import { buyUpgrade, carStats, ownsCar, unlockCar, unlockStatus, syncOwnedCars, buyRim, equipPaint, ownedCarIds } from '../src/core/inventory.js';
import { carById } from '../src/data/cars.js';
import { STAT_PER_LEVEL } from '../src/data/catalog.js';

test('upgrades are stored per car', () => {
  const save = defaults();
  save.coins = 100000;
  syncOwnedCars(save, new Set(['supercar_bundle']));
  assert.ok(save.cars['rpx-hyperion']);
  assert.equal(buyUpgrade(save, 'rp1-vanta', 'topSpeed').cost, 250);
  assert.equal(buyUpgrade(save, 'rp1-vanta', 'topSpeed').cost, 500);
  assert.equal(save.cars['rp1-vanta'].upgrades.topSpeed, 2);
  assert.equal(save.cars['rpx-hyperion'].upgrades.topSpeed, 0);
  assert.equal(carStats(save, 'rp1-vanta').speed, carById('rp1-vanta').stats.speed + 2 * STAT_PER_LEVEL);
  assert.equal(carStats(save, 'rpx-hyperion').speed, carById('rpx-hyperion').stats.speed);
});

test('upgrades stop at level 5 and need the coins', () => {
  const save = defaults();
  save.coins = 7750; // exactly levels 1-5
  for (let i = 0; i < 5; i++) assert.ok(buyUpgrade(save, 'rp1-vanta', 'nitro').ok);
  assert.equal(save.coins, 0);
  assert.equal(buyUpgrade(save, 'rp1-vanta', 'nitro').reason, 'max');
  assert.equal(buyUpgrade(save, 'rp1-vanta', 'handling').reason, 'coins');
  assert.ok(carStats(save, 'rp1-vanta').nitro <= 100);
});

test('coin cars are bought once with coins', () => {
  const save = defaults();
  save.coins = 2999;
  assert.equal(unlockStatus(save, 'kz-kestrel').reason, 'coins');
  assert.equal(unlockCar(save, 'kz-kestrel').ok, false);
  save.coins = 5000;
  assert.deepEqual(unlockCar(save, 'kz-kestrel'), { ok: true, price: 3000 });
  assert.equal(save.coins, 2000);
  assert.ok(ownsCar(save, 'kz-kestrel'));
  assert.equal(save.cars['kz-kestrel'].unlockedBy, 'coins');
  assert.equal(unlockCar(save, 'kz-kestrel').reason, 'owned');
});

test('star cars need the career stars first', () => {
  const save = defaults();
  save.coins = 50000;
  const st = unlockStatus(save, 'rb-ridgeback');
  assert.equal(st.reason, 'stars');
  assert.equal(st.starsNeeded, 15);
  save.career.stageStars.fill(7, 0, 5); // 15 stars
  assert.ok(unlockCar(save, 'rb-ridgeback').ok);
  assert.equal(save.coins, 38000);
  assert.equal(save.cars['rb-ridgeback'].unlockedBy, 'stars');
});

test('IAP cars follow the Play entitlement and keep their upgrades through a refund', () => {
  const save = defaults();
  save.coins = 10000;
  assert.equal(unlockStatus(save, 'rpx-hyperion').reason, 'iap');
  assert.equal(unlockCar(save, 'rpx-hyperion').ok, false);
  syncOwnedCars(save, new Set(['supercar_bundle']));
  save.car = 'rpx-hyperion';
  buyUpgrade(save, 'rpx-hyperion', 'handling');
  syncOwnedCars(save, new Set()); // refunded
  assert.ok(!ownsCar(save, 'rpx-hyperion', new Set()));
  assert.equal(save.car, 'rp1-vanta');
  assert.deepEqual(save.ownedCars, ['rp1-vanta']);
  syncOwnedCars(save, new Set(['supercar_bundle'])); // restored
  assert.equal(save.cars['rpx-hyperion'].upgrades.handling, 1);
  assert.deepEqual(ownedCarIds(save, new Set(['supercar_bundle'])), ['rp1-vanta', 'rpx-hyperion']);
});

test('paint and rims are equipped per car', () => {
  const save = defaults();
  save.coins = 1000;
  syncOwnedCars(save, new Set(['supercar_bundle']));
  assert.ok(equipPaint(save, 'rp1-vanta', 'midnight'));
  assert.equal(save.cars['rpx-hyperion'].paint, 'apex-red');
  assert.ok(!equipPaint(save, 'rp1-vanta', 'not-a-paint'));
  assert.ok(buyRim(save, 'rp1-vanta', 'mesh').ok);
  assert.equal(save.coins, 500);
  assert.equal(save.cars['rp1-vanta'].rim, 'mesh');
  assert.deepEqual(save.cars['rp1-vanta'].rims, ['stock', 'mesh']);
  assert.equal(save.cars['rpx-hyperion'].rim, 'stock');
  assert.equal(buyRim(save, 'rpx-hyperion', 'carbon-aero').reason, 'coins');
  assert.ok(buyRim(save, 'rp1-vanta', 'stock').ok); // owned: free to re-equip
  assert.equal(save.coins, 500);
});

test('rear wings are bought per car; smoke and nitro colours are free and per car', async () => {
  const { buySpoiler, equipFx, carLook } = await import('../src/core/inventory.js');
  const save = defaults();
  save.coins = 2000;
  syncOwnedCars(save, new Set(['supercar_bundle']));
  assert.deepEqual(carLook(save, 'rp1-vanta'), { rim: 'stock', spoiler: 'factory' });
  assert.ok(buySpoiler(save, 'rp1-vanta', 'gt-wing').ok);
  assert.equal(save.coins, 500);
  assert.deepEqual(save.cars['rp1-vanta'].spoilers, ['factory', 'gt-wing']);
  assert.equal(carLook(save, 'rp1-vanta').spoiler, 'gt-wing');
  assert.equal(save.cars['rpx-hyperion'].spoiler, 'factory');
  assert.equal(buySpoiler(save, 'rp1-vanta', 'swan-neck').reason, 'coins');
  assert.ok(buySpoiler(save, 'rp1-vanta', 'factory').ok); // owned: free to refit
  assert.ok(buySpoiler(save, 'rp1-vanta', 'gt-wing').ok);
  assert.equal(save.coins, 500);
  assert.equal(buySpoiler(save, 'rp1-vanta', 'rocket').reason, 'unknown');

  assert.equal(save.cars['rp1-vanta'].smoke, 'white');
  assert.equal(save.cars['rp1-vanta'].nitroFx, 'blue');
  assert.ok(equipFx(save, 'rp1-vanta', 'smoke', 'violet'));
  assert.ok(equipFx(save, 'rp1-vanta', 'nitroFx', 'gold'));
  assert.ok(!equipFx(save, 'rp1-vanta', 'smoke', 'plaid'));
  assert.ok(!equipFx(save, 'rp1-vanta', 'paint', 'gold'));
  assert.equal(save.cars['rpx-hyperion'].smoke, 'white');
  assert.equal(save.coins, 500);
});
