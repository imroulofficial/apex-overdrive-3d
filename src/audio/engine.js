import { mulberry32, saturation, noiseSource, filter, gain } from './mixer.js';
import { blowOff, crackle } from './sfx.js';

// The player's engine, modelled like a commercial racing game's: pitch-shifted RPM loops
// crossfaded by RPM, under a sub-bass rumble, a mechanical whine and intake/turbo layers,
// driven by a six-speed virtual gearbox. The loops are not recordings: each one is rendered
// on the device from a V8 firing model (eight uneven exhaust pulses per cycle, each ringing
// the exhaust's resonances), so the game still ships no audio files.

const IDLE = 950;
const REDLINE = 7600;
const LIMIT = 7900;
// Where each gear runs out, as a fraction of the car's top speed. Sixth reaches into the
// nitro overspeed so Pulse Nitro still pulls through the gears.
const GEAR_TOP = [0.24, 0.42, 0.6, 0.78, 0.98, 1.4];
const GEARS = GEAR_TOP.length;

// Rendered RPM loops, crossfaded with equal power: [rpm it was rendered at, fade-in range,
// fade-out range]. Resonances are the exhaust's (Hz, decay seconds, level).
const LAYERS = [
  {
    rpm: 1100,
    fadeIn: null,
    fadeOut: [1900, 3000],
    res: [
      [58, 0.024, 1.0],
      [126, 0.013, 0.75],
      [300, 0.006, 0.45],
      [690, 0.0028, 0.25],
    ],
    noise: 0.12,
    drive: 1.5,
    seed: 11,
  },
  {
    rpm: 3600,
    fadeIn: [1900, 3000],
    fadeOut: [4800, 6000],
    res: [
      [92, 0.011, 0.85],
      [230, 0.007, 0.85],
      [520, 0.0042, 0.5],
      [1250, 0.0019, 0.3],
    ],
    noise: 0.16,
    drive: 1.8,
    seed: 23,
  },
  {
    rpm: 6600,
    fadeIn: [4800, 6000],
    fadeOut: null,
    res: [
      [170, 0.0065, 0.65],
      [410, 0.0042, 0.85],
      [880, 0.0026, 0.6],
      [2050, 0.0013, 0.35],
    ],
    noise: 0.2,
    drive: 2.1,
    seed: 37,
  },
];

// Pulse strength and timing skew per cylinder: unequal header lengths and a cross-plane
// crank make a V8's "lope" instead of a buzz.
const CYL = [1.0, 0.76, 0.93, 0.7, 1.07, 0.81, 0.89, 0.73];
const SKEW = [0, 0.07, -0.03, 0.05, 0, -0.06, 0.04, -0.02];

const loopCache = new WeakMap();
function engineLoops(ac) {
  if (!loopCache.has(ac)) loopCache.set(ac, LAYERS.map((L) => renderLoop(ac, L)));
  return loopCache.get(ac);
}

function renderLoop(ac, L) {
  const sr = ac.sampleRate;
  const cycle = 120 / L.rpm; // four-stroke: one cycle is two revolutions
  const cycles = Math.max(2, Math.round(0.75 / cycle));
  const n = Math.round(cycles * cycle * sr);
  const out = new Float32Array(n);
  const rand = mulberry32(L.seed);
  const pulses = cycles * 8;
  const interval = n / pulses;
  for (let k = 0; k < pulses; k++) {
    const cyl = k % 8;
    const start = Math.round((k + SKEW[cyl]) * interval + n) % n;
    const amp = CYL[cyl] * (0.86 + rand() * 0.28);
    for (const [f, d, g] of L.res) {
      const w = (2 * Math.PI * f * (1 + (rand() - 0.5) * 0.05)) / sr;
      const fall = Math.exp(-1 / (d * sr));
      let env = amp * g;
      for (let i = 0; i < n && env > 2e-4; i++) {
        out[(start + i) % n] += env * Math.sin(w * i);
        env *= fall;
      }
    }
    // The combustion crack: a very short noise burst at the start of each pulse.
    const fall = Math.exp(-1 / (0.0022 * sr));
    let env = amp * L.noise;
    for (let i = 0; i < n && env > 2e-4; i++) {
      out[(start + i) % n] += env * (rand() * 2 - 1);
      env *= fall;
    }
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += out[i];
  mean /= n;
  let peak = 1e-6;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i] - mean));
  const norm = Math.tanh(L.drive);
  const buf = ac.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.tanh(((out[i] - mean) / peak) * L.drive) / norm;
  return buf;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => x * x * (3 - 2 * x);

function layerWeight(L, rpm) {
  let w = 1;
  if (L.fadeIn) w *= Math.sin((smooth(clamp((rpm - L.fadeIn[0]) / (L.fadeIn[1] - L.fadeIn[0]), 0, 1)) * Math.PI) / 2);
  if (L.fadeOut) w *= Math.cos((smooth(clamp((rpm - L.fadeOut[0]) / (L.fadeOut[1] - L.fadeOut[0]), 0, 1)) * Math.PI) / 2);
  return w;
}

// ---------------------------------------------------------------------------
// Gearbox: turns road speed and throttle into RPM, boost pressure and shift events
// ---------------------------------------------------------------------------

export class Gearbox {
  constructor() {
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
    this.events = [];
  }

  // speedNorm: forward speed / top speed. neutral: revving on the grid or in the garage.
  step(dt, { speedNorm = 0, throttle = 0, neutral = false, airborne = false }) {
    const ev = this.events;
    ev.length = 0;
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
        ev.push({ type: 'upshift', gear: this.gear, boost: this.boost });
      } else if (this.gear > 0 && speedNorm < GEAR_TOP[this.gear - 1] * 0.72) {
        this.gear -= 1;
        this.shiftT = 0.12;
        ev.push({ type: 'downshift', gear: this.gear });
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
      if (before > 0.35) ev.push({ type: 'bov', strength: before });
    }
    for (const e of ev) if (e.type === 'upshift' && e.boost > 0.4) e.bov = e.boost * 0.7;

    // Overrun crackle for a moment after lifting at high RPM.
    this.liftT += dt;
    this.popT -= dt;
    if (throttle < 0.25 && this.liftT < 1.4 && this.rpm > 3800 && this.popT <= 0) {
      this.popT = 0.12 + Math.random() * 0.35;
      if (Math.random() < 0.55) ev.push({ type: 'pop', intensity: clamp((this.rpm - 3800) / 3000, 0.3, 1) });
    }
    this.throttle = throttle;
    this.cut = cut;
    return ev;
  }
}

// ---------------------------------------------------------------------------
// Engine voice: the synth graph, driven by set() at a given time
// ---------------------------------------------------------------------------

export class EngineVoice {
  constructor(mix, { dest = mix.sfx } = {}) {
    const ac = mix.ac;
    this.mix = mix;
    this.ac = ac;
    this.params = new Map();
    this.sources = [];
    const src = (node) => (this.sources.push(node), node);

    this.out = gain(ac, 0);
    this.out.connect(dest);
    const send = gain(ac, 0.2);
    this.out.connect(send).connect(mix.space);

    // Combustion: crossfaded RPM loops through drive, a load-dependent tone filter and a
    // low-mid "throat" boost.
    this.body = gain(ac, 0.8);
    const drive = ac.createWaveShaper();
    drive.curve = saturation(1.25);
    this.tone = filter(ac, 'lowpass', 1200, 0.7);
    const throat = filter(ac, 'peaking', 115, 0.9);
    throat.gain.value = 6;
    const chest = filter(ac, 'lowshelf', 260, 0.7);
    chest.gain.value = 4;
    this.body.connect(drive).connect(this.tone).connect(throat).connect(chest).connect(this.out);
    this.loops = engineLoops(ac).map((buffer, i) => {
      const s = src(ac.createBufferSource());
      s.buffer = buffer;
      s.loop = true;
      const g = gain(ac, 0);
      s.connect(g).connect(this.body);
      return { src: s, g, L: LAYERS[i] };
    });
    // Slight cycle-to-cycle level drift so a held RPM never sounds like a loop.
    const rough = src(noiseSource(mix, { buffer: mix.wobble, rate: 2.5 }));
    rough.connect(gain(ac, 0.07)).connect(this.body.gain);

    // Sub-bass rumble at half and full firing frequency, saturated and kept low.
    this.sub = src(ac.createOscillator());
    this.sub.type = 'sine';
    this.sub2 = src(ac.createOscillator());
    this.sub2.type = 'triangle';
    const subMix = gain(ac, 1);
    this.sub.connect(subMix);
    this.sub2.connect(gain(ac, 0.45)).connect(subMix);
    const subDrive = ac.createWaveShaper();
    subDrive.curve = saturation(2.4);
    this.subLp = filter(ac, 'lowpass', 190, 0.9);
    this.subGain = gain(ac, 0);
    subMix.connect(subDrive).connect(this.subLp).connect(this.subGain).connect(this.out);

    // Mechanical whine: straight-cut gears and the cam drive.
    this.whine = src(ac.createOscillator());
    this.whine.type = 'triangle';
    this.whine2 = src(ac.createOscillator());
    this.whine2.type = 'sine';
    this.whineBp = filter(ac, 'bandpass', 900, 2.5);
    this.whineGain = gain(ac, 0);
    this.whine.connect(this.whineBp);
    this.whine2.connect(gain(ac, 0.5)).connect(this.whineBp);
    this.whineBp.connect(this.whineGain).connect(this.out);

    // Intake roar and turbo whistle.
    const intake = src(noiseSource(mix, { buffer: mix.pink }));
    this.intakeBp = filter(ac, 'bandpass', 900, 1.1);
    this.intakeGain = gain(ac, 0);
    intake.connect(this.intakeBp).connect(this.intakeGain).connect(this.out);
    this.turbo = src(ac.createOscillator());
    this.turbo.type = 'sine';
    this.turboGain = gain(ac, 0);
    this.turbo.connect(this.turboGain).connect(this.out);
    const spool = src(noiseSource(mix));
    this.spoolBp = filter(ac, 'bandpass', 3000, 18);
    this.spoolGain = gain(ac, 0);
    spool.connect(this.spoolBp).connect(this.spoolGain).connect(this.out);

    // Nitro airflow: a broad rush plus a resonant howl while the boost lasts.
    const air = src(noiseSource(mix, { buffer: mix.pink }));
    this.airBp = filter(ac, 'bandpass', 900, 0.7);
    this.airGain = gain(ac, 0);
    air.connect(this.airBp).connect(this.airGain).connect(dest);
    const howl = src(noiseSource(mix));
    this.howlBp = filter(ac, 'bandpass', 800, 12);
    this.howlGain = gain(ac, 0);
    howl.connect(this.howlBp).connect(this.howlGain).connect(dest);

    // Wind over the body.
    const wind = src(noiseSource(mix, { buffer: mix.pink }));
    this.windLp = filter(ac, 'lowpass', 400, 0.5);
    this.windGain = gain(ac, 0);
    wind.connect(this.windLp).connect(this.windGain).connect(dest);

    // Tyre screech: stick-slip squeal is nearly tonal, so three narrow bands at inharmonic
    // ratios plus a buzzing saw, all wandering in pitch with the slip.
    this.skidGain = gain(ac, 0);
    this.skidGain.connect(dest);
    this.skidGain.connect(gain(ac, 0.35)).connect(mix.space);
    const skidNoise = src(noiseSource(mix));
    const jitter = src(noiseSource(mix, { buffer: mix.wobble, rate: 9 }));
    this.skidBands = [
      [1, 22, 0.9],
      [1.93, 26, 0.55],
      [2.71, 30, 0.35],
    ].map(([ratio, q, level]) => {
      const f = filter(ac, 'bandpass', 900 * ratio, q);
      jitter.connect(gain(ac, 45 * ratio)).connect(f.frequency);
      const g = gain(ac, level * 8); // narrow bands pass little energy: make it up here
      skidNoise.connect(f).connect(g).connect(this.skidGain);
      return { f, ratio };
    });
    this.skidSaw = src(ac.createOscillator());
    this.skidSaw.type = 'sawtooth';
    jitter.connect(gain(ac, 25)).connect(this.skidSaw.frequency);
    const sawBp = filter(ac, 'bandpass', 900, 5);
    this.skidSawBp = sawBp;
    this.skidSaw.connect(sawBp).connect(gain(ac, 0.15)).connect(this.skidGain);

    // Off the asphalt. Gravel: stones crunching and pinging off the floor pan (bright noise,
    // chopped by a fast random wander) over a low rumble. Grass: a soft, swishing hiss.
    this.gravelGain = gain(ac, 0);
    this.gravelGain.connect(dest);
    const grit = src(noiseSource(mix));
    const chop = gain(ac, 0.55);
    src(noiseSource(mix, { buffer: mix.wobble, rate: 7 })).connect(gain(ac, 0.6)).connect(chop.gain);
    grit.connect(filter(ac, 'highpass', 900, 0.7)).connect(filter(ac, 'peaking', 2600, 0.9)).connect(chop).connect(this.gravelGain);
    this.gravelRumble = filter(ac, 'lowpass', 160, 0.9);
    src(noiseSource(mix, { buffer: mix.pink })).connect(this.gravelRumble).connect(gain(ac, 2.2)).connect(this.gravelGain);
    this.grassGain = gain(ac, 0);
    this.grassGain.connect(dest);
    const swish = gain(ac, 0.6);
    src(noiseSource(mix, { buffer: mix.wobble, rate: 1.6 })).connect(gain(ac, 0.4)).connect(swish.gain);
    this.grassLp = filter(ac, 'lowpass', 900, 0.5);
    src(noiseSource(mix, { buffer: mix.pink })).connect(this.grassLp).connect(swish).connect(this.grassGain);

    // Timber bridge deck: every plank seam knocks the tyres (a chopped, hollow low-mid knock at
    // speed / plank pitch) over the boom of the empty span underneath.
    this.woodGain = gain(ac, 0);
    this.woodGain.connect(dest);
    this.woodGain.connect(gain(ac, 0.4)).connect(mix.space);
    const knock = src(noiseSource(mix, { buffer: mix.pink }));
    this.woodBp = filter(ac, 'bandpass', 210, 2.2);
    const seams = gain(ac, 0.5);
    this.woodSeams = src(ac.createOscillator());
    this.woodSeams.type = 'square';
    this.woodSeams.connect(gain(ac, 0.5)).connect(seams.gain);
    knock.connect(this.woodBp).connect(seams).connect(gain(ac, 5)).connect(this.woodGain);
    const boom = filter(ac, 'lowpass', 95, 7);
    src(noiseSource(mix, { buffer: mix.pink })).connect(boom).connect(gain(ac, 2.6)).connect(this.woodGain);
  }

  start(t = this.ac.currentTime) {
    for (const s of this.sources) s.start(t, s.buffer ? Math.random() * 0.5 : undefined);
    return this;
  }

  stop(t = this.ac.currentTime, fade = 0.12) {
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, fade / 3);
    for (const g of [this.airGain, this.howlGain, this.windGain, this.skidGain, this.gravelGain, this.grassGain, this.woodGain]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, fade / 3);
    }
    for (const s of this.sources) s.stop(t + fade + 0.3);
  }

  // Sets a param toward v, skipping tiny changes so a steady state schedules nothing.
  p(param, v, t, tc) {
    const last = this.params.get(param);
    if (last !== undefined && Math.abs(last - v) <= Math.abs(v) * 0.004 + 1e-4) return;
    this.params.set(param, v);
    param.setTargetAtTime(v, t, tc);
  }

  // s: { rpm, load 0..1, boost 0..1, tier 0..2, speed 0..1, skid 0..1, slip (rad), cut 0..1,
  //      gravel 0..1, grass 0..1 (share of the tyres on each), wood 0..1 (on the bridge deck),
  //      mps (road speed, m/s, for the plank seams), volume 0..1 }
  set(s, t, tc = 0.035) {
    const { rpm, load = 1, boost = 0, tier = 0, speed = 0, skid = 0, slip = 0, cut = 0, gravel = 0, grass = 0, wood = 0, mps = 0, volume = 1 } = s;
    const r = clamp((rpm - IDLE) / (REDLINE - IDLE), 0, 1.1);
    for (const { src, g, L } of this.loops) {
      this.p(src.playbackRate, rpm / L.rpm, t, tc);
      this.p(g.gain, layerWeight(L, rpm), t, tc);
    }
    this.p(this.tone.frequency, 320 + load * 700 + r * 1600 + tier * 400, t, tc);
    this.p(this.body.gain, 0.5 + 0.45 * load, t, tc);
    this.p(this.sub.frequency, rpm / 30, t, tc);
    this.p(this.sub2.frequency, rpm / 15, t, tc);
    this.p(this.subGain.gain, (0.45 + 0.5 * load) * (1 - 0.4 * r), t, tc);
    const wf = (rpm / 60) * 11;
    this.p(this.whine.frequency, wf, t, tc);
    this.p(this.whine2.frequency, wf * 2.01, t, tc);
    this.p(this.whineBp.frequency, wf * 1.2, t, tc);
    this.p(this.whineGain.gain, 0.012 + 0.07 * r * r * (0.4 + 0.6 * load), t, tc);
    this.p(this.intakeBp.frequency, 500 + r * 2600, t, tc);
    this.p(this.intakeGain.gain, (0.015 + 0.06 * r) * load, t, tc);
    // The turbo whistle only shows while the boost is building or changing, not as a held tone.
    this.p(this.turbo.frequency, 1600 + boost * 2600, t, tc);
    this.p(this.turboGain.gain, 0.014 * boost * boost * (1 - 0.6 * r), t, tc);
    this.p(this.spoolBp.frequency, 1900 + boost * 3200, t, tc);
    this.p(this.spoolGain.gain, 0.4 * boost * boost, t, tc);
    this.p(this.airGain.gain, tier ? 0.25 + 0.15 * tier : 0, t, tier ? tc : 0.2);
    this.p(this.airBp.frequency, 700 + tier * 500 + speed * 600, t, 0.2);
    this.p(this.howlGain.gain, tier ? 0.6 * tier : 0, t, tier ? 0.08 : 0.25);
    this.p(this.howlBp.frequency, 650 + speed * 900 + tier * 250, t, 0.2);
    this.p(this.windGain.gain, speed * speed * 0.26, t, 0.15);
    this.p(this.windLp.frequency, 280 + speed * 1600, t, 0.15);
    const sf = 720 + Math.min(1, Math.abs(slip) * 1.6) * 900 + speed * 260;
    for (const b of this.skidBands) this.p(b.f.frequency, sf * b.ratio, t, 0.06);
    this.p(this.skidSaw.frequency, sf * 0.5, t, 0.06);
    this.p(this.skidSawBp.frequency, sf, t, 0.06);
    this.p(this.skidGain.gain, skid * 0.7 * volume, t, skid > 0 ? 0.04 : 0.09);
    const roll = Math.min(1, speed * 2.2) * (1 + Math.min(1, Math.abs(slip) * 2));
    this.p(this.gravelGain.gain, gravel * roll * 0.32 * volume, t, 0.05);
    this.p(this.gravelRumble.frequency, 90 + speed * 220, t, 0.1);
    this.p(this.grassGain.gain, grass * roll * 0.42 * volume, t, 0.08);
    this.p(this.grassLp.frequency, 500 + speed * 1400, t, 0.1);
    this.p(this.woodGain.gain, wood * Math.min(1, speed * 3) * 0.55 * volume, t, 0.04);
    this.p(this.woodSeams.frequency, Math.max(4, mps / 0.6), t, 0.05);
    this.p(this.woodBp.frequency, 180 + speed * 140, t, 0.1);
    this.p(this.out.gain, volume * (0.1 + 0.055 * load) * (1 - 0.55 * cut), t, cut ? 0.02 : tc);
  }
}

// Plays the gearbox's events (blow-off, crackle) at time t.
export function playEngineEvents(mix, events, t) {
  for (const e of events) {
    if (e.type === 'bov') blowOff(mix, e.strength, t);
    else if (e.type === 'upshift' && e.bov) blowOff(mix, e.bov, t);
    else if (e.type === 'pop') crackle(mix, e.intensity, t);
  }
}

// A free-revving one-shot for the garage: throttle(t) is the pedal over `duration` seconds.
const REVS = {
  // Headlight toggle: one hard stab into the limiter, blow-off and crackle on the way down.
  stab: { duration: 1.6, throttle: (t) => (t > 0.04 && t < 0.42 ? 1 : 0) },
  // Race start: a quick blip, then a long pull.
  double: { duration: 2.0, throttle: (t) => (t > 0.03 && t < 0.2 ? 0.8 : t > 0.42 && t < 0.86 ? 1 : 0) },
};

let activeRev = null;
export function revEngine(mix, kind = 'stab', at) {
  const { duration, throttle } = REVS[kind] ?? REVS.stab;
  const t0 = (at ?? mix.ac.currentTime) + 0.01;
  if (activeRev && at === undefined) activeRev.stop(t0, 0.08);
  const voice = new EngineVoice(mix).start(t0);
  const box = new Gearbox();
  const dt = 1 / 60;
  for (let i = 0; i * dt < duration; i++) {
    const tt = i * dt;
    const th = throttle(tt);
    const ev = box.step(dt, { throttle: th, neutral: true });
    const t = t0 + tt;
    voice.set({ rpm: box.rpm, load: 0.35 + 0.65 * th, boost: box.boost, cut: box.cut, volume: 1.15 }, t, 0.02);
    playEngineEvents(mix, ev, t);
  }
  voice.stop(t0 + duration, 0.35);
  if (at === undefined) activeRev = voice;
  return voice;
}
