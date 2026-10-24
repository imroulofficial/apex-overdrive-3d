// Car ownership, per-car upgrades and cosmetics over a v2 save (core/saveSchema.js).
// Pure functions; callers save afterwards. Every car keeps its own upgrade levels, paint and
// rims, so switching cars never carries one car's upgrades onto another.
import { PRODUCTS } from '../config.js';
import { CARS, carById } from '../data/cars.js';
import { UPGRADES, RIMS, PAINTS, FX_COLORS, STAT_PER_LEVEL, upgradeCost } from '../data/catalog.js';
import { newCarEntry } from './saveSchema.js';
import { totalStars } from './career.js';

const fail = (reason, extra) => ({ ok: false, reason, ...extra });

// Products the player has bought on Google Play, as a Set.
export function activeProducts(save) {
  return new Set(save.purchases.owned);
}

const grantedByProduct = (carId, products) => [...products].some((id) => PRODUCTS[id]?.grants.cars.includes(carId));

export function ownsCar(save, carId, products = new Set()) {
  const car = CARS.find((c) => c.id === carId);
  if (!car) return false;
  if (car.unlock.type === 'starter') return true;
  if (grantedByProduct(carId, products)) return true;
  const by = save.cars[carId]?.unlockedBy;
  return by === 'coins' || by === 'stars';
}

export const ownedCarIds = (save, products) => CARS.filter((c) => ownsCar(save, c.id, products)).map((c) => c.id);

// Makes sure every owned car has a progression entry (an IAP car gets one on first grant;
// a refund keeps the entry, so its upgrades come back if the product is restored).
export function syncOwnedCars(save, products) {
  const owned = ownedCarIds(save, products);
  for (const id of owned) save.cars[id] ??= newCarEntry(carById(id).unlock.type === 'starter' ? 'starter' : 'iap');
  save.ownedCars = owned;
  if (!owned.includes(save.car)) save.car = owned[0];
  return owned;
}

// What the Cars tab shows for a car the player does not own yet.
export function unlockStatus(save, carId, products = new Set()) {
  const car = carById(carId);
  if (ownsCar(save, carId, products)) return { owned: true };
  const u = car.unlock;
  if (u.type === 'iap') return { owned: false, product: u.product, canUnlock: false, reason: 'iap' };
  const price = u.price ?? 0;
  if (u.type === 'stars') {
    const stars = totalStars(save);
    if (stars < u.stars) return { owned: false, price, starsNeeded: u.stars - stars, canUnlock: false, reason: 'stars' };
  }
  return { owned: false, price, canUnlock: save.coins >= price, reason: save.coins >= price ? null : 'coins' };
}

// Unlocks a coin or star car, spending its price.
export function unlockCar(save, carId, products) {
  const status = unlockStatus(save, carId, products);
  if (status.owned) return fail('owned');
  if (!status.canUnlock) return fail(status.reason, status);
  const car = carById(carId);
  save.coins -= status.price;
  save.cars[carId] = { ...newCarEntry(car.unlock.type), ...save.cars[carId], unlockedBy: car.unlock.type };
  save.ownedCars = [...new Set([...(save.ownedCars ?? []), carId])];
  return { ok: true, price: status.price };
}

export function buyUpgrade(save, carId, upgradeId) {
  const entry = ownedEntry(save, carId);
  const u = UPGRADES.find((x) => x.id === upgradeId);
  if (!entry || !u) return fail('unknown');
  const level = entry.upgrades[u.id];
  if (level >= u.maxLevel) return fail('max');
  const cost = upgradeCost(u, level);
  if (save.coins < cost) return fail('coins', { cost });
  save.coins -= cost;
  entry.upgrades[u.id] = level + 1;
  return { ok: true, cost, level: level + 1 };
}

// What one upgrade level adds to a stat: STAT_PER_LEVEL, or less on a stat that starts so
// high that full steps would hit the 100 cap early. Every level then still counts, and Level 5
// lands where it always did (base + 5 full steps, at most 100).
export const statStep = (base, maxLevel) => Math.min(STAT_PER_LEVEL, Math.max(0, 100 - base) / maxLevel);

// A car's stats (0-100) with its own upgrades applied.
export function carStats(save, carId) {
  const values = { ...carById(carId).stats };
  const levels = save.cars[carId]?.upgrades ?? {};
  for (const u of UPGRADES) {
    const base = values[u.stat];
    values[u.stat] = Math.min(100, Math.round((base + (levels[u.id] ?? 0) * statStep(base, u.maxLevel)) * 10) / 10);
  }
  return values;
}

// Coin paints are bought once (ownedPaints, which also holds the chest paints); purchase-
// exclusive paints follow the Play entitlement.
export const ownsPaint = (save, paint) => (paint.product ? save.purchases.paints.includes(paint.id) : save.ownedPaints.includes(paint.id));

// Only owned cars take upgrades, rims and paint (a refunded IAP car keeps its entry).
const ownedEntry = (save, carId) =>
  save.ownedCars?.includes(carId) || ownsCar(save, carId, activeProducts(save)) ? save.cars[carId] ?? null : null;

export function equipPaint(save, carId, paintId) {
  const entry = ownedEntry(save, carId);
  const paint = PAINTS.find((p) => p.id === paintId);
  if (!entry || !paint || !ownsPaint(save, paint)) return false;
  entry.paint = paintId;
  return true;
}

// Buys (if needed) and equips a rim on one car.
export function buyRim(save, carId, rimId) {
  const entry = ownedEntry(save, carId);
  const rim = RIMS.find((r) => r.id === rimId);
  if (!entry || !rim) return fail('unknown');
  if (!entry.rims.includes(rim.id)) {
    if (save.coins < rim.price) return fail('coins', { cost: rim.price });
    save.coins -= rim.price;
    entry.rims.push(rim.id);
  }
  entry.rim = rim.id;
  return { ok: true };
}

// Tyre smoke ('smoke') or nitro trail ('nitroFx') colour for one car. Free.
export function equipFx(save, carId, slot, fxId) {
  const entry = save.cars[carId];
  if (!entry || !['smoke', 'nitroFx'].includes(slot) || !FX_COLORS.some((f) => f.id === fxId)) return false;
  entry[slot] = fxId;
  return true;
}

// What the race and the turntable need to build a car as the player fitted it.
export const carLook = (save, carId) => {
  const e = save.cars[carId];
  return { rim: e?.rim ?? RIMS[0].id };
};
