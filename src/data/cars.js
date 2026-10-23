// The 8 launch cars across Tiers D-A, two per tier: the studio's own original models
// (New Car.zip, 2026-10-23), split and optimised by tools/models/optimize.mjs (see
// public/assets/models/README.md). Each car has three files: the showroom model (`model.url`),
// the textured model the player drives on track (`model.driveUrl`) and the light rival LOD
// (`model.raceUrl`).
//
// Each car has one job (`role`, shown in the garage) so no two cars overlap:
//   D  Lumen EV        forgiving all-rounder (starter)   Kestrel Rally   drift specialist
//   C  Stallion 68     launch and sprints                Ridgeback Trail all-weather stability
//   B  Aurelia GT      nitro specialist                  Vipera R        cornering grip
//   A  Tempesta FX     downforce, mountain hairpins      Valkyrie GT-R   top speed flagship
//
// `unlock` says how a car is first owned:
//   { type: 'starter' }                       owned from the first launch
//   { type: 'coins', price }                  bought with coins
//   { type: 'stars', stars, price }           needs that many career stars, then costs `price`
//                                             coins (0 = free once the stars are reached)
//   { type: 'iap', product }                  granted by a Play product, never sold for coins
// Ownership and upgrades are stored per car in the save (core/saveSchema.js). The ids are the
// 0.14.0 ones, so owned cars, upgrades and the Supercar Bundle carry over to the new models.
//
// `feel` shapes how the stats drive (race/vehicle.js statsToParams):
//   weight   1 = the starter; heavier cars turn in and settle more slowly but hold momentum
//   power    torque curve exponent: low = punchy low end that fades, high = pulls to the limiter
//   drift    how easily the tail steps out and holds an angle (1 = neutral)
import { BASE_STATS } from './catalog.js';

export const TIERS = {
  D: { id: 'D', name: 'Street Starters', blurb: 'An everyday EV and a gravel rally coupe' },
  C: { id: 'C', name: 'Muscle & Off-Road', blurb: 'V8 muscle and a trail-rated 4x4' },
  B: { id: 'B', name: 'Grand Tourers', blurb: 'A classic GT and a mid-engine supercar' },
  A: { id: 'A', name: 'Apex Machines', blurb: 'An open-wheel racer and the hypercar flagship' },
};

// Display names, one line per car. The blueprint asks for original, fictional brands, so no
// manufacturer or model names appear here; ids, saves and Play products never change.
export const DISPLAY_NAMES = {
  'rp1-vanta': 'Lumen EV',
  'kz-kestrel': 'Kestrel Rally',
  'sv-stallion': 'Stallion 68',
  'rb-ridgeback': 'Ridgeback Trail',
  'ag-aurelia': 'Aurelia GT',
  'mz-monza': 'Vipera R',
  'tm-tempesta': 'Tempesta FX',
  'rpx-hyperion': 'Valkyrie GT-R',
};

// Cars that left the roster when it went from 12 to 8 (0.14.0), with what each cost. A save
// that owned one is refunded once (core/saveSchema.js) and the car drops out of it.
export const RETIRED_CARS = {
  'rz-sakura': { price: 6500 },
  'dr-raptor': { price: 20000 },
  'st-stratos': { price: 36000 },
  'zn-zenith': { price: 75000 },
};

const file = (id) => `assets/models/${id.replace(/-/g, '_')}`;
const car = (id, tier, role, stats, feel, unlock, length) => ({
  id,
  name: DISPLAY_NAMES[id],
  tier,
  role,
  class: `Tier ${tier} ${role}`,
  stats,
  feel,
  // `length` is metres nose to tail; the loader scales the model to fit.
  model: { url: `${file(id)}.glb`, driveUrl: `${file(id)}_drive.glb`, raceUrl: `${file(id)}_race.glb`, length },
  unlock,
  released: true,
});

// Ids are permanent (saves, cloud documents and Play grants store them); names are not.
export const CARS = [
  // ---- Tier D · Street Starters ----
  car('rp1-vanta', 'D', 'All-Rounder', BASE_STATS, { weight: 1, power: 2, drift: 1 }, { type: 'starter' }, 4.6),
  car('kz-kestrel', 'D', 'Drift Specialist', { speed: 53, accel: 58, handling: 68, nitro: 46 }, { weight: 0.84, power: 1.7, drift: 1.38 }, { type: 'coins', price: 3000 }, 4.15),

  // ---- Tier C · Muscle & Off-Road ----
  car('sv-stallion', 'C', 'Launch King', { speed: 63, accel: 76, handling: 50, nitro: 58 }, { weight: 1.32, power: 1.35, drift: 1.3 }, { type: 'stars', stars: 15, price: 12000 }, 4.75),
  car('rb-ridgeback', 'C', 'All-Weather Endurance', { speed: 68, accel: 61, handling: 66, nitro: 54 }, { weight: 1.24, power: 2.4, drift: 0.9 }, { type: 'stars', stars: 35, price: 18000 }, 4.8),

  // ---- Tier B · Grand Tourers ----
  car('ag-aurelia', 'B', 'Nitro Specialist', { speed: 71, accel: 66, handling: 68, nitro: 78 }, { weight: 1.0, power: 2.3, drift: 1.12 }, { type: 'coins', price: 30000 }, 4.6),
  car('mz-monza', 'B', 'Cornering Grip', { speed: 69, accel: 71, handling: 82, nitro: 58 }, { weight: 0.9, power: 2.7, drift: 0.82 }, { type: 'stars', stars: 75, price: 45000 }, 4.65),

  // ---- Tier A · Apex Machines ----
  car('tm-tempesta', 'A', 'Downforce Prototype', { speed: 78, accel: 77, handling: 84, nitro: 66 }, { weight: 0.8, power: 2.8, drift: 0.85 }, { type: 'stars', stars: 120, price: 75000 }, 5.2),
  // The Supercar Bundle hypercar, Valkyrie GT-R (the blueprint's name). Saves, Firestore
  // documents and the Play grant all refer to 'rpx-hyperion'.
  car('rpx-hyperion', 'A', 'Top Speed Flagship', { speed: 86, accel: 74, handling: 72, nitro: 76 }, { weight: 1.06, power: 3.1, drift: 1.08 }, { type: 'iap', product: 'supercar_bundle' }, 4.7),
];

export const carById = (id) => CARS.find((c) => c.id === id) ?? CARS[0];
export const STARTER_CAR = CARS.find((c) => c.unlock.type === 'starter').id;
// Cars the garage shows.
export const RELEASED_CARS = CARS.filter((c) => c.released);
