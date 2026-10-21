// Save schema v2: the shape of the player's save, the v1 -> v2 migration, and the cloud
// document. Pure functions over plain objects (no storage, no browser APIs): core/store.js
// owns localStorage and core/cloud.js owns Firestore; both go through here.
//
// v2 local save
//   v            2
//   coins        soft currency
//   car          selected car id
//   cars         per-car progression, one entry per car the player has ever owned:
//                { unlockedBy: 'starter'|'coins'|'stars'|'iap',
//                  upgrades: { topSpeed, acceleration, handling, nitro } (0 stock .. 5),
//                  paint, rim, rims: [owned rim ids] }
//   ownedPaints  coin paints bought (shared by every car; each car equips its own)
//   career       { unlockedStage (1-60), stageStars: [star bitmask per stage, bit 0 = star 1],
//                  best: { [stageId]: { time, score, plays } }, milestones: [claimed ids] }
//   purchases    Play purchases (owned, sandboxOwned, granted bonuses, derived noAds/paints)
//   settings, ads  per device, never synced
//   story        { seen: [scene ids] } story scenes already played; per device, never synced
//                (a new device replays them once, and every scene can be skipped)
//   savedAt      when progress last changed on this device (ms)
//   ownedCars    derived at runtime by monetization/billing.js, not part of progress
//
// v1 (Phases 1-6) kept upgrades and paint global, plus per-track `records`.
import { PRODUCTS } from '../config.js';
import { STARTING_COINS } from '../data/economy.js';
import { CARS, STARTER_CAR } from '../data/cars.js';
import { PAINTS, RIMS, UPGRADES } from '../data/catalog.js';
import { STAGES, MILESTONES } from '../data/career.js';
import { CONTROL_SCHEMES, DEFAULT_CONTROLS } from '../data/controls.js';
import { SCENES } from '../data/story.js';

export const SAVE_VERSION = 2;

// Free paints everyone owns (not the Play-exclusive or milestone-chest ones).
const DEFAULT_PAINTS = PAINTS.filter((p) => p.price === 0 && !p.product && !p.milestone).map((p) => p.id);
const DEFAULT_PAINT = DEFAULT_PAINTS[0];
const DEFAULT_RIM = RIMS[0].id;
const UNLOCKED_BY = ['starter', 'coins', 'stars', 'iap'];
const MAX_LEVEL = Math.max(...UPGRADES.map((u) => u.maxLevel));
// v1 upgrade ids -> v2. Tires were "grip and launch", which is now Acceleration.
const V1_UPGRADES = { engine: 'topSpeed', tires: 'acceleration', handling: 'handling', nitro: 'nitro' };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback);
function normalizeSettings(st) {
  if (!CONTROL_SCHEMES.includes(st.controls)) st.controls = DEFAULT_CONTROLS;
  return st;
}

const uniq = (list, valid) => [...new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === 'string' && (!valid || valid(x))))];
const carIds = new Set(CARS.map((c) => c.id));
const paintIds = new Set(PAINTS.map((p) => p.id));
const rimIds = new Set(RIMS.map((r) => r.id));
const stageIds = new Set(STAGES.map((s) => s.stageId));
const milestoneIds = new Set(MILESTONES.map((m) => m.id));
const sceneIds = new Set(Object.keys(SCENES));

export const emptyUpgrades = () => Object.fromEntries(UPGRADES.map((u) => [u.id, 0]));

export function newCarEntry(unlockedBy, { paint = DEFAULT_PAINT, upgrades } = {}) {
  return { unlockedBy, upgrades: { ...emptyUpgrades(), ...upgrades }, paint, rim: DEFAULT_RIM, rims: [DEFAULT_RIM] };
}

export function defaults() {
  return {
    v: SAVE_VERSION,
    coins: STARTING_COINS,
    car: STARTER_CAR,
    cars: { [STARTER_CAR]: newCarEntry('starter') },
    ownedPaints: [...DEFAULT_PAINTS],
    career: { unlockedStage: 1, stageStars: STAGES.map(() => 0), best: {}, milestones: [] },
    settings: { quality: 'auto', sound: true, music: true, autoAccelerate: true, showFps: false, sandboxStore: false, controls: DEFAULT_CONTROLS },
    // Play purchases. `owned` mirrors what the store reports; `granted` records which
    // products already paid out their one-time coin bonus so a restore never pays twice.
    purchases: { owned: [], sandboxOwned: [], granted: [], noAds: false, paints: [] },
    // racesFinished counts every finished race on this device; the first few never see an
    // interstitial (ADS.interstitialGraceRaces).
    ads: { crateClaimedAt: 0, racesSinceInterstitial: 0, nextInterstitialAt: 2, lastInterstitialAt: 0, racesFinished: 0 },
    story: { seen: [] },
    // When the progress last changed on this device (ms). Settings and ad pacing do not count,
    // so launching or toggling sound never makes this device look newer than the cloud.
    savedAt: 0,
    ownedCars: [STARTER_CAR],
  };
}

function normalizeCar(entry, fallbackBy) {
  const e = isObj(entry) ? entry : {};
  const upgrades = emptyUpgrades();
  for (const id of Object.keys(upgrades)) upgrades[id] = int(e.upgrades?.[id], 0, MAX_LEVEL, 0);
  const rims = uniq([DEFAULT_RIM, ...(e.rims ?? [])], (r) => rimIds.has(r));
  return {
    unlockedBy: UNLOCKED_BY.includes(e.unlockedBy) ? e.unlockedBy : fallbackBy,
    upgrades,
    paint: paintIds.has(e.paint) ? e.paint : DEFAULT_PAINT,
    rim: rims.includes(e.rim) ? e.rim : DEFAULT_RIM,
    rims,
  };
}

function normalizeCareer(c) {
  const src = isObj(c) ? c : {};
  const stars = Array.isArray(src.stageStars) ? src.stageStars : [];
  const best = {};
  if (isObj(src.best)) {
    for (const [id, b] of Object.entries(src.best)) {
      if (!stageIds.has(id) || !isObj(b)) continue;
      best[id] = {
        time: Number.isFinite(b.time) && b.time > 0 ? b.time : null,
        score: int(b.score, 0, 1e9, 0),
        plays: int(b.plays, 0, 1e9, 0),
      };
    }
  }
  return {
    unlockedStage: int(src.unlockedStage, 1, STAGES.length, 1),
    stageStars: STAGES.map((_, i) => int(stars[i], 0, 7, 0) & 7),
    best,
    milestones: uniq(src.milestones, (id) => milestoneIds.has(id)),
  };
}

// Fills gaps and drops anything invalid in a v2 save, so the rest of the game can trust it.
export function normalize(data) {
  const base = defaults();
  const d = isObj(data) ? data : {};
  const cars = {};
  if (isObj(d.cars)) {
    for (const [id, entry] of Object.entries(d.cars)) {
      if (carIds.has(id)) cars[id] = normalizeCar(entry, id === STARTER_CAR ? 'starter' : 'coins');
    }
  }
  cars[STARTER_CAR] ??= newCarEntry('starter');
  cars[STARTER_CAR].unlockedBy = 'starter';
  return {
    ...base,
    ...d,
    v: SAVE_VERSION,
    coins: int(d.coins, 0, Number.MAX_SAFE_INTEGER, base.coins),
    car: cars[d.car] ? d.car : STARTER_CAR,
    cars,
    ownedPaints: uniq([...DEFAULT_PAINTS, ...(d.ownedPaints ?? [])], (id) => paintIds.has(id)),
    career: normalizeCareer(d.career),
    settings: normalizeSettings({ ...base.settings, ...d.settings }),
    purchases: {
      ...base.purchases,
      ...d.purchases,
      owned: uniq(d.purchases?.owned),
      sandboxOwned: uniq(d.purchases?.sandboxOwned),
      granted: uniq(d.purchases?.granted),
    },
    ads: { ...base.ads, ...d.ads },
    story: { seen: uniq(d.story?.seen, (id) => sceneIds.has(id)) },
    savedAt: Number.isFinite(d.savedAt) ? d.savedAt : 0,
    ownedCars: uniq(d.ownedCars, (id) => carIds.has(id)).length ? uniq(d.ownedCars, (id) => carIds.has(id)) : [STARTER_CAR],
  };
}

// v1 -> v2. Coins, Play purchases (owned, sandbox, granted bonuses), settings, ad pacing and
// savedAt carry over untouched. The global upgrades and paint are copied onto every car the
// player owned in v1, so nothing they paid for is lost. The v1 Emerald Coast record becomes
// stage 1 of the career: a top-3 finish there is exactly stage 1's star-1 objective.
export function migrateV1(v1) {
  const d = isObj(v1) ? v1 : {};
  const levels = {};
  for (const [from, to] of Object.entries(V1_UPGRADES)) levels[to] = int(d.upgrades?.[from], 0, MAX_LEVEL, 0);
  const paint = paintIds.has(d.paint) ? d.paint : DEFAULT_PAINT;
  const owned = new Set([STARTER_CAR, ...uniq(d.ownedCars, (id) => carIds.has(id))]);
  const products = new Set([...(d.purchases?.owned ?? []), ...(d.purchases?.sandboxOwned ?? [])]);
  for (const id of products) PRODUCTS[id]?.grants.cars.forEach((c) => owned.add(c));
  const cars = {};
  for (const id of owned) {
    const car = CARS.find((c) => c.id === id);
    cars[id] = newCarEntry(car.unlock.type === 'iap' ? 'iap' : 'starter', { paint, upgrades: levels });
  }

  const career = normalizeCareer(null);
  const rec = d.records?.['emerald-coast'];
  if (isObj(rec) && rec.races > 0) {
    const first = STAGES[0];
    career.best[first.stageId] = { time: Number.isFinite(rec.bestTime) ? rec.bestTime : null, score: 0, plays: int(rec.races, 0, 1e9, 0) };
    if (rec.stars >= 2) {
      career.stageStars[0] = 1;
      career.unlockedStage = 2;
    }
  }

  const ads = { ...d.ads };
  // Saves from before the interstitial grace period: count the races already recorded.
  if (isObj(d.ads) && d.ads.racesFinished === undefined) {
    ads.racesFinished = Object.values(d.records ?? {}).reduce((n, r) => n + (r?.races ?? 0), 0);
  }

  return normalize({
    coins: d.coins,
    car: owned.has(d.car) ? d.car : STARTER_CAR,
    cars,
    ownedPaints: d.ownedPaints,
    career,
    settings: d.settings,
    purchases: d.purchases,
    ads,
    savedAt: d.savedAt,
    ownedCars: [...owned],
  });
}

// Any stored save -> a valid v2 save. v1 saves have no `v` field.
export function migrate(raw) {
  if (!isObj(raw)) return defaults();
  if (raw.v === undefined || raw.v === 1) return migrateV1(raw);
  return normalize(raw);
}

// ---- Cloud ----

// The slice of the save that follows the player to the cloud, grouped like the blueprint's
// Firestore schema (economy / progression) plus the per-car garage. Settings, sandbox
// purchases, derived car unlocks and interstitial pacing stay per device.
export function progressOf(s) {
  const owned = s.purchases.owned;
  return {
    economy: {
      coins: s.coins,
      noAdsPurchased: owned.some((id) => PRODUCTS[id]?.grants.noAds),
      supercarBundlePurchased: owned.includes('supercar_bundle'),
      purchases: owned,
      granted: s.purchases.granted,
      crateClaimedAt: s.ads.crateClaimedAt,
    },
    progression: {
      unlockedStage: s.career.unlockedStage,
      stageStars: s.career.stageStars,
      best: s.career.best,
      milestones: s.career.milestones,
    },
    garage: { car: s.car, ownedPaints: s.ownedPaints, cars: s.cars },
  };
}

// Replaces a save's progress with a cloud copy (mutates and returns `s`). Coin bonuses
// already paid on this device stay recorded (so Restore can never pay twice), milestone
// claims are merged the same way, and the crate timer never moves backwards.
// noAdsPurchased / supercarBundlePurchased are informational; entitlements are always
// re-derived from the purchase list.
export function applyProgress(s, p, savedAt) {
  const e = p.economy ?? {};
  const pr = p.progression ?? {};
  const g = p.garage ?? {};
  const next = normalize({
    ...s,
    coins: Number.isFinite(e.coins) ? e.coins : s.coins,
    car: g.car ?? s.car,
    cars: isObj(g.cars) ? g.cars : s.cars,
    ownedPaints: g.ownedPaints ?? s.ownedPaints,
    career: { ...pr, milestones: [...(pr.milestones ?? []), ...s.career.milestones] },
    purchases: {
      ...s.purchases,
      owned: [...s.purchases.owned, ...(e.purchases ?? [])],
      granted: [...s.purchases.granted, ...(e.granted ?? [])],
    },
    ads: { ...s.ads, crateClaimedAt: Math.max(s.ads.crateClaimedAt, e.crateClaimedAt ?? 0) },
    savedAt,
  });
  // Keep cars owned on this device (an IAP car whose entry the cloud copy predates).
  for (const [id, entry] of Object.entries(s.cars)) next.cars[id] ??= entry;
  return Object.assign(s, next);
}

// The Firestore document for players/{uid} (see firestore.rules).
export function toCloudDoc(s, appVersion) {
  return { v: SAVE_VERSION, updatedAt: s.savedAt ?? 0, appVersion, ...progressOf(s) };
}

// A Firestore document -> { v, updatedAt, progress } in the v2 progress shape, or null when
// the document is missing, damaged or written by a newer app (check `newer` first).
// v1 documents ({ v: 1, save: JSON string }) are migrated on the fly.
export function fromCloudDoc(doc) {
  if (!isObj(doc) || !Number.isFinite(doc.v)) return null;
  if (doc.v > SAVE_VERSION) return { v: doc.v, updatedAt: doc.updatedAt, newer: true, progress: null };
  try {
    if (doc.v === 1) {
      if (typeof doc.save !== 'string') return null;
      const p = JSON.parse(doc.save);
      const migrated = migrateV1({
        ...p,
        purchases: { owned: p.purchases?.owned ?? [], granted: p.purchases?.granted ?? [] },
        ads: { crateClaimedAt: p.crateClaimedAt ?? 0 },
      });
      return { v: 1, updatedAt: doc.updatedAt, progress: progressOf(migrated) };
    }
    if (doc.v === SAVE_VERSION) {
      if (!isObj(doc.economy) || !isObj(doc.progression) || !isObj(doc.garage)) return null;
      return { v: doc.v, updatedAt: doc.updatedAt, progress: { economy: doc.economy, progression: doc.progression, garage: doc.garage } };
    }
  } catch {
    return null;
  }
  return null;
}
