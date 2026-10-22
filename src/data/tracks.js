import { ALPINE_SUMMIT } from './alpineSummit.js';
import { NEON_CITY } from './neonCity.js';

// Track definitions. Points are closed-loop waypoints [x, y, z] in metres (y is road height
// above sea level); the race spline runs through them. The ocean lies to the south (+z).

export const EMERALD_COAST = {
  id: 'emerald-coast',
  name: 'Emerald Coast',
  biome: 'Biome 1 · Coastal Highway',
  laps: 2,
  width: 18,
  points: [
    [0, 21, 205],
    [190, 23, 212],
    [360, 27, 190],
    [490, 31, 122],
    [535, 36, 10],
    [490, 43, -105],
    [385, 48, -185],
    [378, 52, -262],
    [338, 54, -302],
    [296, 52, -272],
    [282, 47, -205],
    [225, 41, -150],
    [125, 33, -65],
    [5, 27, -85],
    [-115, 33, -165],
    [-275, 42, -205],
    [-430, 38, -160],
    [-525, 30, -40],
    [-505, 24, 95],
    [-395, 19, 185],
    [-215, 18, 212],
  ],
  // Jump ramps: `at` is the lap fraction, `from`/`to` the lateral span across the road
  // (negative = left of the driving direction).
  ramps: [
    { at: 0.085, length: 14, height: 1.7, from: -2.5, to: 8.6 },
    { at: 0.418, length: 16, height: 2.6, from: -8.6, to: 8.6 },
    { at: 0.632, length: 13, height: 1.6, from: -8.6, to: 1.5 },
  ],
  // Smashable props: cone slaloms and wooden barricades, as lap fractions.
  slaloms: [0.035, 0.435, 0.615, 0.935],
  barricades: [0.175, 0.275, 0.5, 0.75, 0.8],
  // Breakables on the shoulder: fruit stalls along the straights, neon signposts on the
  // outside of corner entries (lap fractions).
  fruitStalls: [0.06, 0.13, 0.66, 0.69, 0.88, 0.97],
  neonSigns: [0.21, 0.305, 0.395, 0.47, 0.565, 0.735],
  // Coastline (sea begins south of this z) used by the terrain and scenery.
  coastZ: (x) => 254 + 16 * Math.sin(x / 150 + 0.6) + 9 * Math.sin(x / 47) + 46 * Math.exp(-(((x - 250) / 85) ** 2)),
  lighthouseX: 255,
  sun: { azimuth: -0.55, elevation: 0.42 },

  // ---- Biome 1 set-pieces (race/setPieces.js) ----
  // Timber suspension bridge over a sea gorge cut into the south cliffs (lap fractions). The
  // gorge runs inland from the sea under the deck; a waterfall pours off its head wall.
  bridge: { from: 0.894, to: 0.916, name: 'Tidecutter Gorge Bridge' },
  gorge: { width: 46, inland: 92, headHeight: 40 },
  // Seabird flocks resting on the verge (lap fraction, side: +1 = right of travel); they
  // scatter upward when a fast car comes by.
  seabirds: [
    { at: 0.03, side: 1 },
    { at: 0.13, side: -1 },
    { at: 0.86, side: 1 },
    { at: 0.955, side: 1 },
  ],
  // Off-road red-dirt shortcuts that leave the highway and cut across the inside of a bend
  // through the redwood groves (lap fractions where they fork off and rejoin). Open as a
  // risky shortcut on most routes; the Redwood Loop route closes the highway and sends every
  // car down them.
  trails: [
    { id: 'redwood-hollow', name: 'Redwood Hollow', from: 0.305, to: 0.41 }, // cuts the summit hairpins
    { id: 'sawmill-trail', name: 'Sawmill Trail', from: 0.46, to: 0.6 }, // straightens the valley esses
  ],
};

export const TRACKS = [EMERALD_COAST, ALPINE_SUMMIT, NEON_CITY];
export { ALPINE_SUMMIT };
