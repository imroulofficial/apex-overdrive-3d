// The 8 launch cars across Tiers D-A, two per tier, every one a real 3D model from the studio
// car pack (built by tools/models/optimize.mjs, see public/assets/models/README.md). Each car
// has three files: the showroom model (`model.url`), the textured model the player drives on
// track (`model.driveUrl`) and the light rival LOD (`model.raceUrl`).
//
// Each car has one job (`role`, shown in the garage) so no two cars overlap:
//   D  Flux 85        forgiving all-rounder (starter)    Kestrel 930    drift specialist
//   C  Stallion Jet   launch and sprints                 Ridgeback 66   all-weather stability
//   B  Aurelia Vision nitro specialist                   Monza 55       cornering grip
//   A  Tempesta 9X    downforce, mountain hairpins       Valkyrie GT-R  top speed flagship
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
  D: { id: 'D', name: 'Street Classics', blurb: 'Retro coupes for learning the roads' },
  C: { id: 'C', name: 'Muscle & Heritage', blurb: 'Drag muscle and endurance legends' },
  B: { id: 'B', name: 'Vision Tourers', blurb: 'Concept coupes and prototypes' },
  A: { id: 'A', name: 'Hypercars', blurb: 'Le Mans hybrids and track hypercars' },
};

// Display names, one line per car. The blueprint asks for original, fictional brands, so no
// manufacturer or model names appear here; ids, saves and Play products never change.
export const DISPLAY_NAMES = {
  'rp1-vanta': 'Flux 85',
  'kz-kestrel': 'Kestrel 930',
  'sv-stallion': 'Stallion Jet',
  'rb-ridgeback': 'Ridgeback 66',
  'ag-aurelia': 'Aurelia Vision',
  'mz-monza': 'Monza 55',
  'tm-tempesta': 'Tempesta 9X',
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
  // ---- Tier D · Street Classics ----
  car('rp1-vanta', 'D', 'All-Rounder', BASE_STATS, { weight: 1, power: 2, drift: 1 }, { type: 'starter' }, 4.21),
  car('kz-kestrel', 'D', 'Drift Specialist', { speed: 53, accel: 58, handling: 68, nitro: 46 }, { weight: 0.84, power: 1.7, drift: 1.38 }, { type: 'coins', price: 3000 }, 4.29),

  // ---- Tier C · Muscle & Heritage ----
  car('sv-stallion', 'C', 'Launch King', { speed: 63, accel: 76, handling: 50, nitro: 58 }, { weight: 1.32, power: 1.35, drift: 1.3 }, { type: 'stars', stars: 15, price: 12000 }, 4.79),
  car('rb-ridgeback', 'C', 'All-Weather Endurance', { speed: 68, accel: 61, handling: 66, nitro: 54 }, { weight: 1.12, power: 2.4, drift: 0.92 }, { type: 'stars', stars: 35, price: 18000 }, 4.19),

  // ---- Tier B · Vision Tourers ----
  car('ag-aurelia', 'B', 'Nitro Specialist', { speed: 71, accel: 66, handling: 68, nitro: 78 }, { weight: 1.0, power: 2.3, drift: 1.12 }, { type: 'coins', price: 30000 }, 4.6),
  car('mz-monza', 'B', 'Cornering Grip', { speed: 69, accel: 71, handling: 82, nitro: 58 }, { weight: 0.9, power: 2.7, drift: 0.82 }, { type: 'stars', stars: 75, price: 45000 }, 4.75),

  // ---- Tier A · Hypercars ----
  car('tm-tempesta', 'A', 'Downforce Prototype', { speed: 78, accel: 77, handling: 84, nitro: 66 }, { weight: 0.95, power: 2.8, drift: 0.85 }, { type: 'stars', stars: 120, price: 75000 }, 5.1),
  // The Supercar Bundle hypercar, Valkyrie GT-R. Its id keeps the old name on purpose: saves,
  // Firestore documents and the Play grant all refer to 'rpx-hyperion'.
  car('rpx-hyperion', 'A', 'Top Speed Flagship', { speed: 86, accel: 74, handling: 72, nitro: 76 }, { weight: 1.06, power: 3.1, drift: 1.08 }, { type: 'iap', product: 'supercar_bundle' }, 4.85),
];

export const carById = (id) => CARS.find((c) => c.id === id) ?? CARS[0];
export const STARTER_CAR = CARS.find((c) => c.unlock.type === 'starter').id;
// Cars the garage shows.
export const RELEASED_CARS = CARS.filter((c) => c.released);
