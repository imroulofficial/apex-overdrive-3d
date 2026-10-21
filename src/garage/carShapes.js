// Body styles for the procedural roster. Every car is the same lofted construction (see
// carModel.js): a superellipse body swept along a side profile, a greenhouse swept the same
// way, arches carved around the wheels. A style is a handful of numbers (overhangs, hood,
// cowl, deck and roof heights, how square the sections are) that this module turns into the
// profiles, window cut-outs, door panel and kit mounting points the builder needs.
//
// Axes: nose at +X, up +Y, the car's right side at +Z, centred on the origin, wheels on y = 0.
// All heights are measured before `ride` is added (ride lifts the whole body off the wheels).

// The RP-1 Vanta coupe. Every other style overrides a few of these.
const BASE = {
  front: 2.32, // nose x
  rear: 2.32, // tail x (positive; the tail sits at -rear)
  width: 0.95, // half width at the widest station
  wheelBase: 1.3, // half wheelbase: axles at +/- this x
  track: 0.86, // half track: wheel centres at +/- this z
  wheel: 0.34, // tyre radius
  ride: 0, // extra body lift (rally cars)
  nose: 0.4,
  hood: 0.64,
  cowlX: 0.6, // where the hood meets the windshield
  cowl: 0.85,
  belt: 0.87, // top line at the doors
  deck: 0.92,
  tail: 0.78,
  sill: 0.21,
  nFront: 3.2, // plan-view roundness of the nose (higher = blunter)
  nRear: 7,
  m: 5, // section squareness (2 = ellipse, higher = slab sides)
  tumble: 0.12, // how much the sides lean in above the belt
  tuck: 0.1,
  flareFront: 0.035,
  flareRear: 0.05,
  cabin: {
    front: 0.98, // base of the windshield
    tail: -2.02, // where the greenhouse meets the deck
    width: 0.7,
    base: 0.74,
    roofFront: 0, // top of the windshield
    roof: 1.28,
    roofEnd: -1.2, // top of the rear glass
    nFront: 2.6,
    nRear: 2.4,
    m: 3.4,
    tumble: 0.3,
    sideTop: 0.6, // side windows run up to this section height
  },
  door: { front: 0.72, rear: -0.72, type: 'swing' },
  // Rear wing mount (x, height above the deck line) for factory and aftermarket wings.
  wingAt: null,
  exhaust: { count: 2, spread: 0.42, y: 0.32 },
  kit: [],
  wing: null, // factory wing: null | 'ducktail' | 'gt-wing' | 'swan-neck' | 'roof'
  caliper: 0xe2231a,
};

// Eleven silhouettes for the twelve launch cars (the Vanta and the Valkyrie share the coupe
// body; the Valkyrie wears the hypercar aero kit).
export const STYLES = {
  coupe: {},
  hyper: { kit: ['hyper'], wing: 'hyper', caliper: 0xffc21a },

  // Tier D: a tall hot hatch with a roof wing and a centre triple exhaust.
  hatch: {
    front: 2.15, rear: 2.08, width: 0.93, wheelBase: 1.33, track: 0.85,
    nose: 0.46, hood: 0.74, cowlX: 0.9, cowl: 0.92, belt: 0.94, deck: 1.0, tail: 0.94,
    nFront: 3.6, nRear: 10, m: 4.6, flareFront: 0.06, flareRear: 0.07,
    cabin: { front: 1.32, tail: -2.02, width: 0.74, base: 0.84, roofFront: 0.5, roof: 1.44, roofEnd: -1.62, nRear: 9, m: 3.2, tumble: 0.24 },
    door: { front: 0.86, rear: -0.55, type: 'swing' },
    exhaust: { count: 3, spread: 0.09, y: 0.3 },
    kit: ['vents', 'splitter'],
    wing: 'roof',
  },
  // Tier D: long hood, short tail, a fastback that runs to a squared-off hatch.
  zcoupe: {
    front: 2.2, rear: 2.12, width: 0.96, wheelBase: 1.3,
    nose: 0.42, hood: 0.66, cowlX: 0.42, cowl: 0.84, belt: 0.88, deck: 0.94, tail: 0.87,
    nFront: 3, nRear: 8, m: 4.6, flareRear: 0.075,
    cabin: { front: 0.86, tail: -1.92, width: 0.68, roofFront: -0.1, roof: 1.27, roofEnd: -0.8, nRear: 2.2 },
    door: { front: 0.62, rear: -0.78, type: 'swing' },
    wing: 'ducktail',
  },

  // Tier C: raised rally crossover on big tyres, light pod, roof rails, mud flaps.
  rally: {
    front: 2.18, rear: 2.1, width: 0.98, wheelBase: 1.32, track: 0.9, wheel: 0.37, ride: 0.12,
    nose: 0.5, hood: 0.78, cowlX: 0.86, cowl: 0.95, belt: 0.98, deck: 1.05, tail: 1.0, sill: 0.3,
    nFront: 4, nRear: 9, m: 5.5, flareFront: 0.07, flareRear: 0.07,
    cabin: { front: 1.28, tail: -1.98, width: 0.76, base: 0.88, roofFront: 0.42, roof: 1.5, roofEnd: -1.55, nRear: 8, m: 3.6, tumble: 0.2 },
    door: { front: 0.82, rear: -0.6, type: 'swing' },
    exhaust: { count: 1, spread: 0.45, y: 0.36 },
    kit: ['rally', 'scoop'],
    wing: 'roof',
  },
  // Tier C: modern muscle, long blunt nose, high shoulders and a fastback.
  muscle: {
    front: 2.45, rear: 2.36, width: 0.99, wheelBase: 1.38, track: 0.88, wheel: 0.35,
    nose: 0.5, hood: 0.78, cowlX: 0.3, cowl: 0.9, belt: 0.91, deck: 0.95, tail: 0.88,
    nFront: 6, nRear: 9, m: 7, tumble: 0.08, flareRear: 0.06,
    cabin: { front: 0.72, tail: -1.9, width: 0.7, base: 0.82, roofFront: -0.25, roof: 1.3, roofEnd: -0.98, nRear: 2.8, m: 4 },
    door: { front: 0.48, rear: -0.86, type: 'swing' },
    exhaust: { count: 4, spread: 0.5, y: 0.32 },
    kit: ['muscle', 'scoop'],
    wing: 'ducktail',
  },
  // Tier C: four-door turbo rally sedan with a bonnet scoop and a tall trunk wing.
  sedan: {
    front: 2.3, rear: 2.28, width: 0.95, wheelBase: 1.33, track: 0.86, wheel: 0.35, ride: 0.03,
    nose: 0.46, hood: 0.72, cowlX: 0.82, cowl: 0.9, belt: 0.93, deck: 0.99, tail: 0.92,
    nFront: 3.8, nRear: 6.5, m: 4.8, flareFront: 0.05, flareRear: 0.06,
    cabin: { front: 1.22, tail: -1.56, width: 0.72, base: 0.84, roofFront: 0.36, roof: 1.42, roofEnd: -0.9, nRear: 3, m: 3.4 },
    door: { front: 0.78, rear: -0.18, type: 'swing' },
    exhaust: { count: 2, spread: 0.5, y: 0.32 },
    kit: ['scoop', 'splitter'],
    wing: 'gt-wing',
  },

  // Tier B: rear-engined GT, round nose and a long sloping roof.
  gt: {
    front: 2.18, rear: 2.26, width: 0.96, wheelBase: 1.26, track: 0.86, wheel: 0.345,
    nose: 0.36, hood: 0.56, cowlX: 0.74, cowl: 0.8, belt: 0.84, deck: 0.9, tail: 0.8,
    nFront: 2.4, nRear: 3.6, m: 4.2, tumble: 0.16, flareFront: 0.05, flareRear: 0.1,
    cabin: { front: 1.1, tail: -2.0, width: 0.68, base: 0.76, roofFront: 0.3, roof: 1.27, roofEnd: -0.75, nFront: 2.4, nRear: 2, m: 3 },
    door: { front: 0.66, rear: -0.72, type: 'swing' },
    exhaust: { count: 2, spread: 0.22, y: 0.3 },
    wing: 'ducktail',
  },
  // Tier B: the same rear-engined GT in track spec: wider hips, splitter and a swan-neck wing.
  gt3: {
    front: 2.2, rear: 2.28, width: 0.98, wheelBase: 1.26, track: 0.88, wheel: 0.35, ride: -0.02,
    nose: 0.34, hood: 0.55, cowlX: 0.74, cowl: 0.8, belt: 0.84, deck: 0.9, tail: 0.8,
    nFront: 2.4, nRear: 3.6, m: 4.2, tumble: 0.16, flareFront: 0.08, flareRear: 0.13,
    cabin: { front: 1.1, tail: -2.0, width: 0.68, base: 0.76, roofFront: 0.3, roof: 1.25, roofEnd: -0.75, nFront: 2.4, nRear: 2, m: 3 },
    door: { front: 0.66, rear: -0.72, type: 'swing' },
    exhaust: { count: 2, spread: 0.12, y: 0.3 },
    kit: ['splitter', 'vents', 'fin'],
    wing: 'swan-neck',
    caliper: 0xffc21a,
  },
  // Tier B: front-engined grand tourer, long flat hood and a short notchback deck.
  gtfront: {
    front: 2.4, rear: 2.3, width: 0.97, wheelBase: 1.4, track: 0.87, wheel: 0.35,
    nose: 0.45, hood: 0.7, cowlX: 0.26, cowl: 0.86, belt: 0.88, deck: 0.95, tail: 0.88,
    nFront: 4.2, nRear: 6, m: 5.2, flareRear: 0.07,
    cabin: { front: 0.7, tail: -1.62, width: 0.7, base: 0.8, roofFront: -0.3, roof: 1.28, roofEnd: -1.0, nRear: 2.6, m: 3.6 },
    door: { front: 0.42, rear: -0.95, type: 'swing' },
    exhaust: { count: 4, spread: 0.5, y: 0.3 },
    kit: ['vents', 'splitter'],
    wing: 'ducktail',
    caliper: 0x1d5bff,
  },

  // Tier A: cab-forward track hypercar, bubble canopy, huge swan-neck wing, butterfly doors.
  senna: {
    front: 2.3, rear: 2.46, width: 0.98, wheelBase: 1.34, track: 0.88, wheel: 0.35, ride: -0.03,
    nose: 0.3, hood: 0.5, cowlX: 1.02, cowl: 0.68, belt: 0.78, deck: 0.92, tail: 0.84,
    nFront: 2.4, nRear: 8, m: 4.4, tumble: 0.2, flareFront: 0.09, flareRear: 0.12,
    cabin: { front: 1.5, tail: -1.62, width: 0.64, base: 0.68, roofFront: 0.62, roof: 1.17, roofEnd: -0.55, nFront: 2.2, nRear: 3.2, m: 2.6, tumble: 0.36 },
    door: { front: 1.0, rear: -0.55, type: 'butterfly' },
    exhaust: { count: 2, spread: 0.1, y: 0.95 },
    kit: ['splitter', 'vents', 'canards'],
    wing: 'swan-neck',
    caliper: 0xffc21a,
  },
  // Tier A: sharp-edged wedge with scissor doors and a fixed deck wing.
  wedge: {
    front: 2.38, rear: 2.38, width: 1.0, wheelBase: 1.38, track: 0.89, wheel: 0.355, ride: -0.02,
    nose: 0.3, hood: 0.52, cowlX: 0.88, cowl: 0.74, belt: 0.82, deck: 0.96, tail: 0.86,
    nFront: 1.7, nRear: 10, m: 9, tumble: 0.18, tuck: 0.16, flareFront: 0.06, flareRear: 0.09,
    cabin: { front: 1.36, tail: -1.9, width: 0.66, base: 0.74, roofFront: 0.45, roof: 1.15, roofEnd: -0.72, nFront: 2.8, nRear: 4, m: 5, tumble: 0.32 },
    door: { front: 0.86, rear: -0.62, type: 'scissor' },
    exhaust: { count: 3, spread: 0.12, y: 0.62 },
    kit: ['vents', 'canards', 'splitter'],
    wing: 'deck',
    caliper: 0x39ff6a,
  },
};

const lerp = (a, b, k) => a + (b - a) * k;

// Resolves a style id into everything carModel.js needs.
export function shapeFor(styleId = 'coupe') {
  const o = STYLES[styleId] ?? STYLES.coupe;
  const s = { ...BASE, ...o, cabin: { ...BASE.cabin, ...o.cabin }, door: { ...BASE.door, ...o.door }, exhaust: { ...BASE.exhaust, ...o.exhaust } };
  const { front: F, rear: R, ride } = s;
  const up = (pts) => pts.map(([x, y]) => [x, y + ride]);

  const hoodX = F - 0.32;
  const beltX = Math.min(0, s.cowlX - 0.45);
  const top = up([
    [F, s.nose],
    [F - 0.1, s.nose + 0.16 * (s.hood - s.nose) / 0.24],
    [hoodX, s.hood],
    [lerp(hoodX, s.cowlX, 0.36), lerp(s.hood, s.cowl, 0.43)],
    [lerp(hoodX, s.cowlX, 0.72), lerp(s.hood, s.cowl, 0.76)],
    [s.cowlX, s.cowl],
    [beltX, s.belt],
    [Math.min(beltX - 0.3, -R * 0.43), lerp(s.belt, s.deck, 0.6)],
    [-R * 0.73, s.deck],
    [-R + 0.22, s.deck - 0.01],
    [-R, s.tail],
  ]);
  const bottom = up([
    [F, s.nose - 0.06],
    [F - 0.22, s.sill + 0.04],
    [F - 0.8, s.sill],
    [-R + 0.8, s.sill],
    [-R + 0.22, s.sill + 0.04],
    [-R, Math.max(s.sill + 0.12, s.tail - 0.38)],
  ]);

  const c = s.cabin;
  const tailY = c.base + 0.14;
  const endY = c.roof - 0.11;
  const cabinTop = up([
    [c.front, c.base + 0.08],
    [lerp(c.front, c.roofFront, 0.5), c.base + 0.21 + (c.roof - 1.28) * 0.3],
    [c.roofFront, c.roof - 0.09],
    [c.roofFront - 0.4, c.roof],
    [Math.min(c.roofEnd + 0.4, c.roofFront - 0.5), c.roof - 0.01],
    [c.roofEnd, endY],
    [lerp(c.roofEnd, c.tail, 0.5), lerp(endY, tailY, 0.5)],
    [c.tail, tailY],
  ]).sort((a, b) => b[0] - a[0]);

  return {
    id: styleId,
    ...s,
    length: F + R,
    profiles: { top, bottom, cabinTop, cabinBase: c.base + ride },
    // Window cut-outs on the greenhouse, as station ranges.
    windows: {
      windshield: [c.roofFront + 0.02, c.front - 0.12],
      rearGlass: [c.tail + 0.17, c.roofEnd + 0.18],
      side: [c.roofEnd - 0.12, c.front - 0.48],
    },
    // Rear wing mount: on the deck just ahead of the tail, or on the roof's trailing edge.
    wingMount: s.wing === 'roof'
      ? { x: c.roofEnd - 0.1, y: endY + ride + 0.02, roof: true }
      : { x: -R + 0.32, y: s.deck + ride, roof: false },
    archRadius: s.wheel + 0.11,
  };
}
