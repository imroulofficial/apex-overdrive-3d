// The engine's control side, with no Web Audio in it: the six-speed virtual gearbox, the RPM
// layer table and the garage rev scripts. The main-thread graph (audio/engine.js) and the
// audio-thread mixer (audio/worklet/carMixer.processor.js) both drive their sound from here,
// so the two paths rev, shift, blow off and crackle the same way.

export const IDLE = 950;
export const REDLINE = 7600;
export const LIMIT = 7900;
// Where each gear runs out, as a fraction of the car's top speed. Sixth reaches into the
// nitro overspeed so Pulse Nitro still pulls through the gears.
const GEAR_TOP = [0.24, 0.42, 0.6, 0.78, 0.98, 1.4];
const GEARS = GEAR_TOP.length;

// The RPM loops, crossfaded with equal power: the sample, the rpm it was recorded at, and its
// fade-in and fade-out ranges. Each rpm is 30 × the loop's fundamental (twice the crank
// speed, the strongest line in all three recordings) as samples.mjs measures it, so every
// layer plays at the pitch the gearbox asks for and the crossfades do not jump. No loop is
// played outside about 0.55-1.85× its own speed. The fades are wide (650-900 rpm), so one
// recording's tone morphs into the next over a whole stretch of the rev range instead of
// switching at a point.
//
// `trim` (dB) and `tilt` (dB per octave of pitch shift) level-match the loops: each one,
// soloed and swept through its range (tools/audio engine-sweep-layer-N clips), is brought onto
// one shared loudness-vs-rpm line, so neither layer of a crossfade is louder than the other
// and a sweep through the gears has no steps at the crossovers.
export const LAYERS = [
  { sample: 'engineIdle', rpm: 985, fadeIn: null, fadeOut: [1200, 1850], trim: -0.6, tilt: 0.8 },
  { sample: 'engineLow', rpm: 2040, fadeIn: [1200, 1850], fadeOut: [2550, 3400], trim: 1.1, tilt: -1.6 },
  { sample: 'engineMid', rpm: 3840, fadeIn: [2550, 3400], fadeOut: [4150, 5000], trim: -0.2, tilt: -0.3 },
  { sample: 'engineHigh', rpm: 5220, fadeIn: [4150, 5000], fadeOut: [5650, 6550], trim: 0, tilt: -0.1 },
  { sample: 'engineTop', rpm: 6735, fadeIn: [5650, 6550], fadeOut: null, trim: -0.3, tilt: -1.3 },
];

// The voice's level into the sfx bus at full load, tuned to the level budget in mixer.js
// (engine about -16 to -18 dBFS RMS at the master input). 0.5 with the level-matched layers
// and the master warmth EQ lands where 0.55 did before them.
export const ENGINE_LEVEL = 0.5;

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => x * x * (3 - 2 * x);

// A layer's crossfade weight at `rpm` (equal power: the squares of two neighbours sum to 1).
export function layerWeight(L, rpm) {
  let w = 1;
  if (L.fadeIn) w *= Math.sin((smooth(clamp((rpm - L.fadeIn[0]) / (L.fadeIn[1] - L.fadeIn[0]), 0, 1)) * Math.PI) / 2);
  if (L.fadeOut) w *= Math.cos((smooth(clamp((rpm - L.fadeOut[0]) / (L.fadeOut[1] - L.fadeOut[0]), 0, 1)) * Math.PI) / 2);
  return w;
}

// The level-match gain of a layer playing at `rpm` (see LAYERS).
export const layerTrim = (L, rpm) => 10 ** (((L.trim ?? 0) + (L.tilt ?? 0) * Math.log2(rpm / L.rpm)) / 20);

// Every layer's level at rpm[0] (crossfade weight × level match) into out[i], 0 outside its
// range. Numbers in and out through arrays, for the audio thread (no number boxed per call).
export function layerLevels(input, out) {
  const rpm = input[0];
  for (let i = 0; i < LAYERS.length; i++) {
    const L = LAYERS[i];
    const w = layerWeight(L, rpm);
    out[i] = w > 0 ? w * layerTrim(L, rpm) : 0;
  }
}

// Gearbox: turns road speed and throttle into RPM, boost pressure and shift events. It never
// allocates: step() refills the same event list from a fixed set of event objects (it runs
// on the audio thread, where garbage collection is a glitch), so a caller reads the events
// before the next step.
export class Gearbox {
  constructor() {
    this.events = [];
    this.slots = Array.from({ length: 6 }, () => ({ type: '', gear: 0, boost: 0, bov: 0, strength: 0, intensity: 0 }));
    this.input = { dt: 0, speedNorm: 0, throttle: 0, neutral: false, airborne: false };
    this.reset();
  }

  reset() {
    this.gear = 0;
    this.rpm = IDLE;
    this.boost = 0;
    this.shiftT = 0;
    this.limiterT = 0;
    this.liftT = 9;
    this.popT = 0;
    this.throttle = 0;
    this.cut = 0;
    while (this.events.length) this.events.pop();
  }

  emit(type) {
    const e = this.slots[this.events.length];
    if (!e) return null;
    e.type = type;
    e.gear = this.gear;
    e.boost = 0;
    e.bov = 0;
    e.strength = 0;
    e.intensity = 0;
    this.events.push(e);
    return e;
  }

  // speedNorm: forward speed / top speed. neutral: revving on the grid or in the garage.
  step(dt, { speedNorm = 0, throttle = 0, neutral = false, airborne = false }) {
    const s = this.input;
    s.dt = dt;
    s.speedNorm = speedNorm;
    s.throttle = throttle;
    s.neutral = neutral;
    s.airborne = airborne;
    return this.run(s);
  }

  // step() with everything in one object, dt included: what the audio thread calls (a number
  // passed to a call that is not inlined is boxed, and that garbage is a glitch there).
  run(input) {
    const { dt, speedNorm, throttle, neutral, airborne } = input;
    const ev = this.events;
    // Emptied by popping: `length = 0` drops the array's storage, and the next push allocates.
    while (ev.length) ev.pop();
    let target;
    let tc;
    if (neutral) {
      this.gear = 0;
      target = IDLE + throttle * (LIMIT + 300 - IDLE);
      tc = target > this.rpm ? 0.085 : 0.3;
    } else {
      if (this.shiftT > 0) this.shiftT -= dt;
      else if (this.gear < GEARS - 1 && speedNorm > GEAR_TOP[this.gear] * 0.985 && throttle > 0.3) {
        this.gear += 1;
        this.shiftT = 0.16;
        const e = this.emit('upshift');
        if (e) e.boost = this.boost;
      } else if (this.gear > 0 && speedNorm < GEAR_TOP[this.gear - 1] * 0.72) {
        this.gear -= 1;
        this.shiftT = 0.12;
        this.emit('downshift');
      }
      const ratio = clamp(speedNorm / GEAR_TOP[this.gear], 0, 1.06);
      target = IDLE + (REDLINE - IDLE) * ratio;
      // Clutch slip off the line, wheels free in the air.
      if (this.gear === 0) target = Math.max(target, IDLE + throttle * 2600);
      if (airborne && throttle > 0.3) target += 1500;
      tc = this.shiftT > 0 ? 0.045 : target > this.rpm ? 0.07 : 0.12;
    }
    this.rpm += (Math.min(target, LIMIT + 200) - this.rpm) * (1 - Math.exp(-dt / tc));

    // Rev limiter: bounce off the cut while the throttle stays pinned.
    this.limiterT -= dt;
    let cut = this.shiftT > 0.05 ? 1 : 0;
    if (this.rpm > LIMIT && throttle > 0.5) {
      if (this.limiterT <= 0) {
        this.rpm -= 650;
        this.limiterT = 0.075;
      }
      cut = 0.6;
    }

    // Turbo: spools with load and RPM, vents through the blow-off valve on a lift.
    const r = clamp((this.rpm - 2200) / 3800, 0, 1);
    const want = neutral ? throttle * r * 0.9 : throttle > 0.4 ? r : 0;
    const before = this.boost;
    this.boost += (want - this.boost) * (1 - Math.exp(-dt / (want > this.boost ? (neutral ? 0.3 : 0.55) : 0.1)));
    if (this.throttle > 0.5 && throttle < 0.25) {
      this.liftT = 0;
      if (before > 0.35) {
        const e = this.emit('bov');
        if (e) e.strength = before;
      }
    }
    for (const e of ev) if (e.type === 'upshift' && e.boost > 0.4) e.bov = e.boost * 0.7;

    // Overrun crackle for a moment after lifting at high RPM.
    this.liftT += dt;
    this.popT -= dt;
    if (throttle < 0.25 && this.liftT < 1.4 && this.rpm > 3800 && this.popT <= 0) {
      this.popT = 0.12 + Math.random() * 0.35;
      if (Math.random() < 0.55) {
        const e = this.emit('pop');
        if (e) e.intensity = clamp((this.rpm - 3800) / 3000, 0.3, 1);
      }
    }
    this.throttle = throttle;
    this.cut = cut;
    return ev;
  }
}

// A free-revving one-shot for the garage: throttle(t) is the pedal over `duration` seconds.
export const REVS = {
  // Headlight toggle: one hard stab into the limiter, blow-off and crackle on the way down.
  stab: { duration: 1.6, throttle: (t) => (t > 0.04 && t < 0.42 ? 1 : 0) },
  // Race start: a quick blip, then a long pull.
  double: { duration: 2.0, throttle: (t) => (t > 0.03 && t < 0.2 ? 0.8 : t > 0.42 && t < 0.86 ? 1 : 0) },
};
