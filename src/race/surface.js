// Road surfaces across the track: smooth asphalt (plus kerbs), a loose gravel/dirt shoulder,
// then a strip of roadside grass up to the guardrail. The car straddles them, so handling is
// blended by how much of its width sits on each one: two wheels on the gravel feels half as
// loose as all four.

export const SURFACES = {
  //            lateral grip, grip while drifting, top speed, rolling drag (1/s), steering, jitter
  asphalt: { id: 'asphalt', grip: 1, driftGrip: 1, top: 1, drag: 0, steer: 1, jitter: 0 },
  gravel: { id: 'gravel', grip: 0.62, driftGrip: 0.8, top: 0.86, drag: 0.08, steer: 0.88, jitter: 0.05 },
  grass: { id: 'grass', grip: 0.48, driftGrip: 0.66, top: 0.74, drag: 0.16, steer: 0.8, jitter: 0.08 },
  // Packed red dirt of the redwood trails: loose enough to slide, firm enough to stay fast.
  dirt: { id: 'dirt', grip: 0.72, driftGrip: 0.86, top: 0.97, drag: 0.02, steer: 0.9, jitter: 0.04 },
};
export const SURFACE_IDS = Object.keys(SURFACES);

// Black ice on the asphalt (Alpine Summit, track def `ice`): multipliers at full strength on
// top of the road's own grip. Sliding still works, so a drift survives it better than grip.
export const ICE = { grip: 0.5, driftGrip: 0.74, steer: 0.86, ramp: 12 };

// Lateral layout from the centre line (metres beyond the asphalt edge).
export const LAYOUT = {
  edgeLine: 0.3, // asphalt (painted edge line, kerb lip) still grips like the road
  gravel: 1.8, // gravel/dirt shoulder width
  grass: 2.2, // grass verge width, up to the guardrail
};
export const VERGE = LAYOUT.gravel + LAYOUT.grass;

const CAR_HALF_WIDTH = 1.0;
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// Fraction of the car's width over each surface at lateral offset d. `out` is reused.
export function surfaceMix(halfWidth, d, out = {}) {
  const ad = Math.abs(d);
  const lo = ad - CAR_HALF_WIDTH;
  const hi = ad + CAR_HALF_WIDTH;
  const w = hi - lo;
  const roadEdge = halfWidth + LAYOUT.edgeLine;
  const gravelEdge = halfWidth + LAYOUT.gravel;
  out.asphalt = overlap(lo, hi, -Infinity, roadEdge) / w;
  out.gravel = overlap(lo, hi, roadEdge, gravelEdge) / w;
  out.grass = overlap(lo, hi, gravelEdge, Infinity) / w;
  out.dirt = 0;
  return out;
}

// On a trail: asphalt where the car still overlaps the highway (fork and merge zones; dMain is
// null once the highway is out of reach), packed dirt on the lane, grass and leaf litter beyond.
export function trailMix(halfWidth, dMain, dTrail, core, out = {}) {
  const lo = Math.abs(dTrail) - CAR_HALF_WIDTH;
  const hi = Math.abs(dTrail) + CAR_HALF_WIDTH;
  const w = hi - lo;
  let asphalt = 0;
  if (dMain !== null) {
    const am = Math.abs(dMain);
    asphalt = overlap(am - CAR_HALF_WIDTH, am + CAR_HALF_WIDTH, -Infinity, halfWidth + LAYOUT.edgeLine) / w;
  }
  const dirt = Math.max(0, overlap(lo, hi, -Infinity, core) / w - asphalt);
  out.asphalt = asphalt;
  out.dirt = dirt;
  out.gravel = 0;
  out.grass = Math.max(0, 1 - asphalt - dirt);
  return out;
}

// On the timber bridge the deck runs rail to rail: every wheel is on planks.
export function deckMix(out = {}) {
  out.asphalt = 1;
  out.gravel = 0;
  out.grass = 0;
  out.dirt = 0;
  return out;
}

// Handling multipliers for a mix: a weighted blend of the surfaces' coefficients.
const BLENDED = ['grip', 'driftGrip', 'top', 'drag', 'steer', 'jitter'];
export function blendSurface(mix, out = {}) {
  for (const k of BLENDED) {
    out[k] = SURFACES.asphalt[k] * mix.asphalt + SURFACES.gravel[k] * mix.gravel + SURFACES.grass[k] * mix.grass + SURFACES.dirt[k] * (mix.dirt ?? 0);
  }
  return out;
}

// The surface with the largest share (for effects and the HUD).
export function dominantSurface(mix) {
  let best = 'asphalt';
  for (const k of SURFACE_IDS) if ((mix[k] ?? 0) > (mix[best] ?? 0)) best = k;
  return best;
}
