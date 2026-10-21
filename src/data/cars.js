// The 12 launch cars across Tiers D-A (blueprint section 04). Each car has a procedural
// fallback (always available, offline) and an optional external model: drop the .glb at
// `model.url` (relative to public/) and the garage and race pick it up automatically.
// See public/assets/models/README.md.
//
// `released` cars have art and appear in the garage Cars tab today; the rest are planned for
// the car roster phase and only exist as data until then (their kit is a stand-in body).
//
// `unlock` says how a car is first owned:
//   { type: 'starter' }                       owned from the first launch
//   { type: 'coins', price }                  bought with coins
//   { type: 'stars', stars, price }           needs that many career stars, then costs `price`
//                                             coins (0 = free once the stars are reached)
//   { type: 'iap', product }                  granted by a Play product, never sold for coins
// Ownership and upgrades are stored per car in the save (core/saveSchema.js).
import { BASE_STATS } from './catalog.js';

export const TIERS = {
  D: { id: 'D', name: 'Street Tuners', blurb: 'JDM hatchbacks and compact coupes' },
  C: { id: 'C', name: 'Offroad & Muscle', blurb: 'Rally crossovers and modern muscle' },
  B: { id: 'B', name: 'Grand Tourers', blurb: 'European exotic coupes' },
  A: { id: 'A', name: 'Hyper & Supercars', blurb: 'Aerodynamic hypercars' },
};

const car = (id, name, tier, className, stats, kit, unlock, { length = 4.5, ...extra } = {}) => ({
  id,
  name,
  tier,
  class: `Tier ${tier} ${className}`,
  stats,
  procedural: { kit },
  model: { url: `assets/models/${id.replace(/-/g, '_')}.glb`, length },
  unlock,
  released: false,
  ...extra,
});

export const CARS = [
  // ---- Tier D · Street Tuners ----
  car('rp1-vanta', 'RP-1 Vanta', 'D', 'Starter Coupe', BASE_STATS, 'coupe', { type: 'starter' }, {
    model: { url: 'assets/models/rp1_vanta.glb', length: 4.6 }, // metres, nose to tail; the loader scales the model to fit
    released: true,
  }),
  car('kz-kestrel', 'Kestrel Type-K', 'D', 'Hot Hatch', { speed: 50, accel: 60, handling: 62, nitro: 42 }, 'coupe', { type: 'coins', price: 3000 }, { length: 4.3 }),
  car('rz-sakura', 'Sakura RZ', 'D', 'Compact Coupe', { speed: 56, accel: 56, handling: 60, nitro: 46 }, 'coupe', { type: 'coins', price: 6500 }),

  // ---- Tier C · Offroad & Muscle ----
  car('rb-ridgeback', 'Ridgeback RX', 'C', 'Rally Crossover', { speed: 58, accel: 64, handling: 62, nitro: 50 }, 'coupe', { type: 'stars', stars: 15, price: 12000 }),
  car('sv-stallion', 'Stallion V8', 'C', 'Modern Muscle', { speed: 66, accel: 62, handling: 54, nitro: 54 }, 'coupe', { type: 'stars', stars: 30, price: 16000 }, { length: 4.8 }),
  car('dr-raptor', 'Dune Raptor', 'C', 'Rally Raid', { speed: 62, accel: 66, handling: 60, nitro: 56 }, 'coupe', { type: 'stars', stars: 45, price: 20000 }),

  // ---- Tier B · Grand Tourers ----
  car('ag-aurelia', 'Aurelia GT3', 'B', 'Track Coupe', { speed: 68, accel: 68, handling: 70, nitro: 58 }, 'hyper', { type: 'coins', price: 28000 }),
  car('st-stratos', 'Stratos GT', 'B', 'Grand Tourer', { speed: 72, accel: 66, handling: 66, nitro: 62 }, 'hyper', { type: 'coins', price: 36000 }),
  car('mz-monza', 'Monza R', 'B', 'Super GT', { speed: 72, accel: 70, handling: 70, nitro: 62 }, 'hyper', { type: 'stars', stars: 75, price: 45000 }),

  // ---- Tier A · Hyper & Supercars ----
  // The Supercar Bundle hypercar, Valkyrie GT-R (blueprint name; shipped as "RP-X Hyperion"
  // up to 0.7.0). Its id keeps the old name on purpose: saves, Firestore documents and the
  // Play grant all refer to 'rpx-hyperion', so renaming the car never needs a migration.
  car('rpx-hyperion', 'Valkyrie GT-R', 'A', 'Hypercar', { speed: 74, accel: 72, handling: 70, nitro: 66 }, 'hyper', { type: 'iap', product: 'supercar_bundle' }, {
    model: { url: 'assets/models/valkyrie_gtr.glb', length: 4.7 },
    released: true,
  }),
  car('tm-tempesta', 'Tempesta V12', 'A', 'Hypercar', { speed: 78, accel: 74, handling: 72, nitro: 70 }, 'hyper', { type: 'stars', stars: 120, price: 60000 }, { length: 4.7 }),
  car('zn-zenith', 'Zenith Omega', 'A', 'Hypercar', { speed: 82, accel: 76, handling: 74, nitro: 72 }, 'hyper', { type: 'coins', price: 75000 }, { length: 4.8 }),
];

export const carById = (id) => CARS.find((c) => c.id === id) ?? CARS[0];
export const STARTER_CAR = CARS.find((c) => c.unlock.type === 'starter').id;
// Cars the garage can show today.
export const RELEASED_CARS = CARS.filter((c) => c.released);
