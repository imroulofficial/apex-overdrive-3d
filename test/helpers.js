// A realistic Phase 6 (schema v1) save as localStorage held it.
export const v1Save = () => ({
  coins: 18450,
  paint: 'ultraviolet',
  ownedPaints: ['apex-red', 'midnight', 'arctic', 'carbon', 'ultraviolet', 'volt'],
  upgrades: { engine: 3, nitro: 2, handling: 4, tires: 1 },
  car: 'rpx-hyperion',
  ownedCars: ['rp1-vanta', 'rpx-hyperion'],
  settings: { quality: 'high', sound: false, music: true, autoAccelerate: false, showFps: true, sandboxStore: false },
  records: { 'emerald-coast': { bestTime: 131.42, stars: 3, races: 9, wins: 4 } },
  purchases: { owned: ['supercar_bundle'], sandboxOwned: ['remove_ads'], granted: ['supercar_bundle'], noAds: true, paints: [] },
  ads: { crateClaimedAt: 1792531200000, racesSinceInterstitial: 1, nextInterstitialAt: 3, lastInterstitialAt: 1792530000000, racesFinished: 9 },
  savedAt: 1792531300000,
});

// What a finished race reports (src/race/Race.js finishRacer).
export const result = (over = {}) => ({
  finished: true,
  position: 1,
  total: 6,
  time: 120,
  bestLap: 58,
  driftScore: 2400,
  driftDistance: 420,
  airTime: 3.2,
  pulses: 2,
  smashes: 9,
  ...over,
});
