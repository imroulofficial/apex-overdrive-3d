// Offline save data. localStorage (persisted by the Android WebView) is the source of
// truth and every save is instant and local. src/core/cloud.js mirrors the progress part
// of it (see progressOf) to Cloud Firestore at a few milestones.
import { STARTING_COINS } from '../config.js';

const KEY = 'apex-overdrive.save.v1';

const defaults = () => ({
  coins: STARTING_COINS,
  paint: 'apex-red',
  ownedPaints: ['apex-red', 'midnight', 'arctic', 'carbon'],
  upgrades: { engine: 0, nitro: 0, handling: 0, tires: 0 },
  car: 'rp1-vanta',
  ownedCars: ['rp1-vanta'],
  settings: { quality: 'auto', sound: true, showFps: false, sandboxStore: false },
  records: {}, // per track: { bestTime, stars, races, wins }
  // Play purchases. `owned` mirrors what the store reports; `granted` records which
  // products already paid out their one-time coin bonus so a restore never pays twice.
  purchases: { owned: [], sandboxOwned: [], granted: [], noAds: false },
  ads: { crateClaimedAt: 0, racesSinceInterstitial: 0, nextInterstitialAt: 2, lastInterstitialAt: 0 },
  // When the progress last changed on this device (ms). Settings and ad pacing do not count,
  // so launching or toggling sound never makes this device look newer than the cloud.
  savedAt: 0,
});

// The slice of the save that follows the player to the cloud. Settings, sandbox purchases,
// derived car unlocks and interstitial pacing stay per device.
export function progressOf(s) {
  return {
    coins: s.coins,
    paint: s.paint,
    ownedPaints: s.ownedPaints,
    upgrades: s.upgrades,
    car: s.car,
    records: s.records,
    purchases: { owned: s.purchases.owned, granted: s.purchases.granted },
    crateClaimedAt: s.ads.crateClaimedAt,
  };
}

// Replaces this device's progress with a cloud copy. Coin bonuses already paid here stay
// recorded (so Restore can never pay twice) and the crate timer never moves backwards.
export function applyProgress(p, savedAt) {
  const base = defaults();
  state.coins = Number.isFinite(p.coins) ? p.coins : state.coins;
  state.paint = p.paint ?? state.paint;
  state.ownedPaints = [...new Set([...base.ownedPaints, ...(p.ownedPaints ?? [])])];
  state.upgrades = { ...base.upgrades, ...p.upgrades };
  state.car = p.car ?? state.car;
  state.records = { ...p.records };
  state.purchases.owned = [...new Set([...state.purchases.owned, ...(p.purchases?.owned ?? [])])];
  state.purchases.granted = [...new Set([...state.purchases.granted, ...(p.purchases?.granted ?? [])])];
  state.ads.crateClaimedAt = Math.max(state.ads.crateClaimedAt, p.crateClaimedAt ?? 0);
  lastProgress = JSON.stringify(progressOf(state));
  state.savedAt = savedAt;
  save();
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const data = JSON.parse(raw);
    const base = defaults();
    return {
      ...base,
      ...data,
      upgrades: { ...base.upgrades, ...data.upgrades },
      settings: { ...base.settings, ...data.settings },
      records: { ...base.records, ...data.records },
      purchases: { ...base.purchases, ...data.purchases },
      ads: { ...base.ads, ...data.ads },
    };
  } catch {
    return defaults();
  }
}

const listeners = new Set();
export const state = load();
let lastProgress = JSON.stringify(progressOf(state));

export function save() {
  const progress = JSON.stringify(progressOf(state));
  if (progress !== lastProgress) {
    lastProgress = progress;
    state.savedAt = Date.now();
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode); progress stays in memory for this session.
  }
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function addCoins(amount) {
  state.coins += Math.max(0, Math.round(amount));
}

export function spendCoins(amount) {
  if (state.coins < amount) return false;
  state.coins -= amount;
  return true;
}
