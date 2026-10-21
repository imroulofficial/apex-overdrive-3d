// Garage cars. Each car has a procedural fallback (always available, offline) and an
// optional external model: drop the .glb at `model.url` (relative to public/) and the
// garage and race pick it up automatically. See public/assets/models/README.md.
import { BASE_STATS } from './catalog.js';

export const CARS = [
  {
    id: 'rp1-vanta',
    name: 'RP-1 Vanta',
    class: 'Starter coupe',
    tier: 'C',
    stats: BASE_STATS,
    procedural: { kit: 'coupe' },
    model: {
      url: 'assets/models/rp1_vanta.glb',
      length: 4.6, // metres, nose to tail; the loader scales the model to fit
    },
  },
  {
    id: 'rpx-hyperion',
    name: 'RP-X Hyperion',
    class: 'Tier A hypercar',
    tier: 'A',
    stats: { speed: 74, nitro: 66, handling: 70, grip: 68 },
    procedural: { kit: 'hyper' },
    model: {
      url: 'assets/models/rpx_hyperion.glb',
      length: 4.7,
    },
    // Unlocked only by a Play purchase; never sold for coins.
    unlockProduct: 'supercar_bundle',
  },
];

export const carById = (id) => CARS.find((c) => c.id === id) ?? CARS[0];
