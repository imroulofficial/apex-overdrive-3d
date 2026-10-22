// The 12 launch cars across Tiers D-A (blueprint section 04). Each car has a procedural
// body (always available, offline; `procedural.style` picks the silhouette in
// garage/carShapes.js) and an optional external model: drop the .glb at `model.url`
// (relative to public/) and the garage and race pick it up automatically.
// See public/assets/models/README.md.
//
// `unlock` says how a car is first owned:
//   { type: 'starter' }                       owned from the first launch
//   { type: 'coins', price }                  bought with coins
//   { type: 'stars', stars, price }           needs that many career stars, then costs `price`
//                                             coins (0 = free once the stars are reached)
//   { type: 'iap', product }                  granted by a Play product, never sold for coins
// Ownership and upgrades are stored per car in the save (core/saveSchema.js).
//
// `feel` shapes how the stats drive (race/vehicle.js statsToParams):
//   weight   1 = the starter; heavier cars turn in and settle more slowly but hold momentum
//   power    torque curve exponent: low = punchy low end that fades, high = pulls to the limiter
//   drift    how easily the tail steps out and holds an angle (1 = neutral)
import { BASE_STATS } from './catalog.js';

export const TIERS = {
  D: { id: 'D', name: 'Street Tuners', blurb: 'JDM hatchbacks and compact coupes' },
  C: { id: 'C', name: 'Offroad & Muscle', blurb: 'Rally crossovers and modern muscle' },
  B: { id: 'B', name: 'Grand Tourers', blurb: 'European exotic coupes' },
  A: { id: 'A', name: 'Hyper & Supercars', blurb: 'Aerodynamic hypercars' },
};

// Display names, one line per car. The blueprint asks for original, fictional brands; some
// of these echo real model names, so they can be swapped here without touching ids, saves
// or Play products.
export const DISPLAY_NAMES = {
  'rp1-vanta': 'RP-1 Vanta',
  'kz-kestrel': 'Fujin Type-R',
  'rz-sakura': 'Kaze 370',
  'rb-ridgeback': 'Trailblazer Rally',
  'sv-stallion': 'Mustang Bandit',
  'dr-raptor': 'Apex WRX',
  'mz-monza': 'Monza GT3',
  'st-stratos': 'Stuttgart Carrera',
  'ag-aurelia': 'Bavaria M-Sport',
  'rpx-hyperion': 'Valkyrie GT-R',
  'tm-tempesta': 'Chimera Senna',
  'zn-zenith': 'Revuelto Storm',
};

const car = (id, tier, className, stats, style, feel, unlock, { length = 4.5, ...extra } = {}) => ({
  id,
  name: DISPLAY_NAMES[id],
  tier,
  class: `Tier ${tier} ${className}`,
  stats,
  feel,
  procedural: { style },
  model: { url: `assets/models/${id.replace(/-/g, '_')}.glb`, length },
  unlock,
  released: true,
  ...extra,
});

// Ids are permanent (saves, cloud documents and Play grants store them); names are not.
export const CARS = [
  // ---- Tier D · Street Tuners ----
  car('rp1-vanta', 'D', 'Starter Coupe', BASE_STATS, 'coupe', { weight: 1, power: 2, drift: 1 }, { type: 'starter' }, {
    model: { url: 'assets/models/rp1_vanta.glb', length: 4.6 }, // metres, nose to tail; the loader scales the model to fit
  }),
  car('kz-kestrel', 'D', 'Hot Hatch', { speed: 50, accel: 62, handling: 64, nitro: 42 }, 'hatch', { weight: 0.86, power: 1.6, drift: 0.9 }, { type: 'coins', price: 3000 }, { length: 4.2 }),
  car('rz-sakura', 'D', 'Compact Coupe', { speed: 57, accel: 55, handling: 60, nitro: 46 }, 'zcoupe', { weight: 1.02, power: 2.2, drift: 1.2 }, { type: 'coins', price: 6500 }, { length: 4.3 }),

  // ---- Tier C · Offroad & Muscle ----
  car('rb-ridgeback', 'C', 'Rally Crossover', { speed: 57, accel: 66, handling: 64, nitro: 50 }, 'rally', { weight: 1.12, power: 1.6, drift: 1.25 }, { type: 'stars', stars: 15, price: 12000 }, { length: 4.3 }),
  car('sv-stallion', 'C', 'Modern Muscle', { speed: 68, accel: 63, handling: 52, nitro: 54 }, 'muscle', { weight: 1.3, power: 1.4, drift: 1.35 }, { type: 'stars', stars: 30, price: 16000 }, { length: 4.8 }),
  car('dr-raptor', 'C', 'Rally Sedan', { speed: 62, accel: 67, handling: 62, nitro: 56 }, 'sedan', { weight: 1.08, power: 1.8, drift: 1.1 }, { type: 'stars', stars: 45, price: 20000 }, { length: 4.6 }),

  // ---- Tier B · Grand Tourers ----
  car('ag-aurelia', 'B', 'Grand Tourer', { speed: 71, accel: 64, handling: 66, nitro: 62 }, 'gtfront', { weight: 1.2, power: 2.3, drift: 1.15 }, { type: 'coins', price: 28000 }, { length: 4.7 }),
  car('st-stratos', 'B', 'Sports Coupe', { speed: 69, accel: 70, handling: 69, nitro: 58 }, 'gt', { weight: 0.98, power: 2.4, drift: 0.95 }, { type: 'coins', price: 36000 }, { length: 4.45 }),
  car('mz-monza', 'B', 'Track Coupe', { speed: 71, accel: 70, handling: 74, nitro: 60 }, 'gt3', { weight: 0.94, power: 2.7, drift: 0.85 }, { type: 'stars', stars: 75, price: 45000 }, { length: 4.5 }),

  // ---- Tier A · Hyper & Supercars ----
  // The Supercar Bundle hypercar, Valkyrie GT-R (blueprint name; shipped as "RP-X Hyperion"
  // up to 0.7.0). Its id keeps the old name on purpose: saves, Firestore documents and the
  // Play grant all refer to 'rpx-hyperion', so renaming the car never needs a migration.
  car('rpx-hyperion', 'A', 'Hypercar', { speed: 74, accel: 72, handling: 70, nitro: 66 }, 'hyper', { weight: 1.0, power: 2.5, drift: 1.05 }, { type: 'iap', product: 'supercar_bundle' }, {
    model: { url: 'assets/models/valkyrie_gtr.glb', length: 4.7 },
  }),
  car('tm-tempesta', 'A', 'Track Hypercar', { speed: 76, accel: 75, handling: 78, nitro: 68 }, 'senna', { weight: 0.88, power: 2.8, drift: 0.85 }, { type: 'stars', stars: 120, price: 60000 }, { length: 4.75 }),
  car('zn-zenith', 'A', 'V12 Hypercar', { speed: 84, accel: 76, handling: 70, nitro: 74 }, 'wedge', { weight: 1.12, power: 3.2, drift: 1.1 }, { type: 'coins', price: 75000 }, { length: 4.75 }),
];

export const carById = (id) => CARS.find((c) => c.id === id) ?? CARS[0];
export const STARTER_CAR = CARS.find((c) => c.unlock.type === 'starter').id;
// Cars the garage shows (every launch car has a procedural body now).
export const RELEASED_CARS = CARS.filter((c) => c.released);
