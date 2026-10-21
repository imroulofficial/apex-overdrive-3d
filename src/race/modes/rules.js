// Game-mode rules that do not need the 3D scene (blueprint §02): the Time Trial clock, the
// Elimination countdown, slipstream drafting and the Drift Touge guardrail proximity bonus.
// Pure arithmetic, so the tests can drive them under Node.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---- Time Trial (Chrono Run) ----
// The clock starts with one share of the stage budget and every checkpoint gate adds another,
// so the run only stays alive by reaching the next gate. Green pylons take `pylonBonus` off
// the run time, which also gives that much back to the countdown.
export const CHRONO = {
  pylonBonus: 1.0,
  slack: 1.2, // whole-run budget = star-1 target time x slack
  warnAt: 10, // seconds left when the clock turns red
  pylonSpacing: 220, // metres between pylons along the racing line (about 12 a lap)
  checkpointSpacing: 650, // roughly one gate every this many metres
};

export class ChronoClock {
  // budget: seconds for the whole run; checkpoints: gates between the start and the finish.
  constructor({ budget, checkpoints }) {
    this.checkpoints = Math.max(0, checkpoints);
    this.share = budget / (this.checkpoints + 1);
    this.allowance = this.share;
    this.elapsed = 0;
    this.bonus = 0;
    this.pylons = 0;
    this.gates = 0;
    this.stopped = false;
  }

  tick(dt) {
    if (!this.stopped) this.elapsed += dt;
  }

  // The run time that counts (results, star objectives): clock time minus pylon bonuses.
  get time() {
    return Math.max(0, this.elapsed - this.bonus);
  }

  get remaining() {
    return Math.max(0, this.allowance - this.time);
  }

  get expired() {
    return this.allowance - this.time <= 0;
  }

  pylon() {
    this.pylons += 1;
    this.bonus += CHRONO.pylonBonus;
    return CHRONO.pylonBonus;
  }

  // Passing a gate extends the countdown. Returns the seconds added (0 once all are used).
  checkpoint() {
    if (this.gates >= this.checkpoints) return 0;
    this.gates += 1;
    this.allowance += this.share;
    return this.share;
  }

  stop() {
    this.stopped = true;
  }
}

// Number of checkpoint gates for a run of `distance` metres.
export const checkpointCount = (distance) => Math.max(1, Math.round(distance / CHRONO.checkpointSpacing) - 1);

// ---- Elimination Knock-Out ----
export const ELIMINATION = {
  interval: 20, // seconds between knock-outs
  warnAt: 5, // the timer pulses red and beeps for the last seconds
};

export class EliminationTimer {
  constructor(interval = ELIMINATION.interval) {
    this.interval = interval;
    this.left = interval;
    this.round = 1;
  }

  // Returns true on the frame the timer hits zero (and starts the next round).
  tick(dt) {
    this.left -= dt;
    if (this.left > 0) return false;
    this.left += this.interval;
    this.round += 1;
    return true;
  }

  // Whole seconds left, for the beeps in the last few seconds.
  get secondsLeft() {
    return Math.ceil(this.left);
  }
}

// `ranked` is the field still in the race, leader first. Returns who is knocked out.
export const pickEliminated = (ranked) => (ranked.length > 1 ? ranked[ranked.length - 1] : null);

// ---- Slipstream ----
// A car tucked in behind another within `range` metres and `width` metres of its line gets
// extra pull, strongest right on its bumper. Boss Duels multiply it ("heavy draft").
export const DRAFT = {
  range: 32,
  width: 2.6,
  accel: 3.2, // m/s^2 at full strength (lets a drafting car run a little past its top speed)
  minSpeed: 18,
};

// ahead: metres along the track to the car in front; lateral: metres between the two lines.
export function draftFactor(ahead, lateral, speed) {
  if (!(ahead > 2.5) || ahead > DRAFT.range || speed < DRAFT.minSpeed) return 0;
  const side = Math.abs(lateral) / DRAFT.width;
  if (side >= 1) return 0;
  return (1 - ahead / DRAFT.range) * (1 - side * side);
}

// ---- Drift Touge: proximity bonus ----
// Drifting within `band` metres of the guardrail earns up to `bonus` x the normal drift points
// on top (so +100% right against the rail).
export const PROXIMITY = {
  band: 2.4,
  bonus: 1.0,
};

// d: lateral offset from the centre line; wallLimit: where the car meets the rail.
export function proximityFactor(d, wallLimit) {
  const gap = wallLimit - Math.abs(d);
  if (gap >= PROXIMITY.band) return 0;
  return clamp(1 - gap / PROXIMITY.band, 0, 1);
}
