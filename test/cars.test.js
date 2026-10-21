import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARS, TIERS, STARTER_CAR, RELEASED_CARS } from '../src/data/cars.js';
import { PRODUCTS } from '../src/config.js';
import { MAX_STARS } from '../src/data/career.js';

test('12 cars, 3 per tier D-A', () => {
  assert.equal(CARS.length, 12);
  for (const tier of Object.keys(TIERS)) assert.equal(CARS.filter((c) => c.tier === tier).length, 3, tier);
  assert.equal(new Set(CARS.map((c) => c.id)).size, 12);
});

test('one Tier D starter: the RP-1 Vanta', () => {
  const starters = CARS.filter((c) => c.unlock.type === 'starter');
  assert.deepEqual(starters.map((c) => c.id), ['rp1-vanta']);
  assert.equal(STARTER_CAR, 'rp1-vanta');
  assert.equal(starters[0].tier, 'D');
});

test('coin prices run 3,000 (Tier D) to 75,000 (Tier A)', () => {
  const priced = CARS.filter((c) => c.unlock.type === 'coins' || (c.unlock.type === 'stars' && c.unlock.price > 0));
  const prices = priced.map((c) => c.unlock.price);
  assert.equal(Math.min(...prices), 3000);
  assert.equal(Math.max(...prices), 75000);
  for (const c of priced) assert.ok(c.unlock.price >= 3000 && c.unlock.price <= 75000);
  // Tiers get dearer.
  const maxOf = (t) => Math.max(...priced.filter((c) => c.tier === t).map((c) => c.unlock.price));
  const minOf = (t) => Math.min(...priced.filter((c) => c.tier === t).map((c) => c.unlock.price));
  assert.ok(maxOf('D') < minOf('C') && maxOf('C') < minOf('B') && maxOf('B') < minOf('A'));
});

test('every unlock type is used and valid', () => {
  assert.deepEqual(new Set(CARS.map((c) => c.unlock.type)), new Set(['starter', 'coins', 'stars', 'iap']));
  for (const c of CARS) {
    if (c.unlock.type === 'stars') assert.ok(c.unlock.stars > 0 && c.unlock.stars <= MAX_STARS);
    if (c.unlock.type === 'iap') assert.ok(PRODUCTS[c.unlock.product].grants.cars.includes(c.id));
  }
});

test('the Supercar Bundle grants the Tier A IAP car', () => {
  const iap = CARS.filter((c) => c.unlock.type === 'iap');
  assert.deepEqual(iap.map((c) => c.id), ['rpx-hyperion']);
  assert.equal(iap[0].tier, 'A');
  assert.deepEqual(PRODUCTS.supercar_bundle.grants.cars, ['rpx-hyperion']);
});

test('stats use the four garage bars and rise with tier', () => {
  const avg = (c) => (c.stats.speed + c.stats.accel + c.stats.handling + c.stats.nitro) / 4;
  for (const c of CARS) assert.deepEqual(Object.keys(c.stats).sort(), ['accel', 'handling', 'nitro', 'speed']);
  const tierAvg = (t) => CARS.filter((c) => c.tier === t).reduce((n, c) => n + avg(c), 0) / 3;
  assert.ok(tierAvg('D') < tierAvg('C') && tierAvg('C') < tierAvg('B') && tierAvg('B') < tierAvg('A'));
});

test('only cars with art are released to the garage', () => {
  assert.deepEqual(RELEASED_CARS.map((c) => c.id), ['rp1-vanta', 'rpx-hyperion']);
});
