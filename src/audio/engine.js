import { noiseSource, filter, gain } from './mixer.js';
import { loopSource } from './samples.js';
import { blowOff, crackle } from './sfx.js';
import { Gate } from './clock.js';

// The player's engine, built the way commercial racers build theirs: recorded RPM loops,
// pitch-shifted with the revs and crossfaded between, plus recorded turbo, nitro and tyre
// layers, all driven by a six-speed virtual gearbox. The loops are cut from CC0 recordings
// of real cars by tools/audio/samples.mjs (see audio/samples.js): the idle is a big-block V8
// ticking over, the low range a loud four-cylinder exhaust on load, and the mid to top range
// an Aston Martin V12 pulling to the redline, each slice resampled to hold one steady pitch
// so it can loop. No layer is an oscillator.

const IDLE = 950;
const REDLINE = 7600;
const LIMIT = 7900;
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

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
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
// Engine voice: the sample graph, driven by set() at a given time
// ---------------------------------------------------------------------------

// The voice's level into the sfx bus at full load, tuned to the level budget in mixer.js
// (engine about -16 to -18 dBFS RMS at the master input). 0.5 with the level-matched layers
// and the master warmth EQ lands where 0.55 did before them.
const ENGINE_LEVEL = 0.5;

// gated: layers that are often silent (RPM loops outside their range, turbo, tyres, surfaces,
// nitro air) stay unplugged from the graph while their level is zero, so the audio thread
// skips them. Only for a live context whose clock polls the gates (see AudioClock); offline
// renders keep everything plugged in.
export class EngineVoice {
  constructor(mix, { dest = mix.sfx, ambience = mix.ambience ?? dest, gated = false } = {}) {
    const ac = mix.ac;
    this.mix = mix;
    this.ac = ac;
    this.params = new Map();
    this.sources = [];
    this.gates = new Map();
    const src = (node) => (this.sources.push(node), node);
    // Connects a layer's level to its destinations, behind a gate when gated.
    const plug = (g, ...dests) => {
      if (gated) this.gates.set(g.gain, new Gate(dests.map((d) => [g, d])));
      else for (const d of dests) g.connect(d);
    };

    this.out = gain(ac, 0);
    this.out.connect(dest);
    const send = gain(ac, 0.2);
    this.out.connect(send).connect(mix.space);

    // Combustion: the RPM loops through a load-dependent tone filter (a lift closes it, the
    // way an engine on the overrun loses its rasp) and a broad low-mid lift (the body a phone
    // speaker can still play; the master EQ adds a little more warmth on top).
    this.body = gain(ac, 0.8);
    this.tone = filter(ac, 'lowpass', 4000, 0.6);
    const weight = filter(ac, 'peaking', 200, 0.7);
    weight.gain.value = 2.5;
    this.body.connect(this.tone).connect(weight).connect(this.out);
    this.loops = LAYERS.map((L) => {
      const s = src(loopSource(mix, L.sample));
      const g = gain(ac, 0);
      s.connect(g);
      plug(g, this.body);
      return { src: s, g, L };
    });
    // Slight cycle-to-cycle level drift so a held RPM never sounds like a loop.
    const rough = src(noiseSource(mix, { buffer: mix.wobble, rate: 2.5 }));
    rough.connect(gain(ac, 0.05)).connect(this.body.gain);

    // Turbo: recorded rushing air through a narrow band that rises with boost pressure (the
    // whistle) and a high-pass (the spool hiss).
    const air = src(loopSource(mix, 'turboAir'));
    this.whistleBp = filter(ac, 'bandpass', 2400, 9);
    this.whistleGain = gain(ac, 0);
    air.connect(this.whistleBp).connect(this.whistleGain);
    plug(this.whistleGain, this.out);
    this.spoolHp = filter(ac, 'highpass', 2600, 0.7);
    this.spoolGain = gain(ac, 0);
    // The recording's air is brightest above 12 kHz, where it only tires the ear: cut it.
    air.connect(this.spoolHp).connect(filter(ac, 'lowpass', 12000, 0.7)).connect(this.spoolGain);
    plug(this.spoolGain, this.out);

    // Nitro airflow: a recorded blower roar while the boost lasts, brighter and faster for
    // Pulse Nitro.
    this.rush = src(loopSource(mix, 'nitroRush'));
    this.rushBp = filter(ac, 'bandpass', 1100, 0.8);
    this.rushGain = gain(ac, 0);
    this.rush.connect(this.rushBp).connect(this.rushGain);
    plug(this.rushGain, dest);

    // Wind over the body: background, so it sits in the damped ambience bus.
    const wind = src(noiseSource(mix, { buffer: mix.pink }));
    this.windLp = filter(ac, 'lowpass', 400, 0.5);
    this.windGain = gain(ac, 0);
    wind.connect(this.windLp).connect(this.windGain);
    plug(this.windGain, ambience);

    // Tyre screech: two recorded squeals, a light one for a scrub and a hard four-tyre squeal
    // for a full drift, crossfaded by how hard the tyres slide and pitched up with the slip.
    // They play through the mixer's tyre bus (de-harsh dip, 12 kHz cut).
    this.skidGain = gain(ac, 0);
    const skidSend = gain(ac, 0.35);
    skidSend.connect(mix.space);
    plug(this.skidGain, dest === mix.sfx && mix.tyre ? mix.tyre : dest, skidSend);
    this.skids = ['skidLight', 'skidHeavy'].map((name) => {
      const s = src(loopSource(mix, name));
      const g = gain(ac, 0);
      s.connect(g).connect(this.skidGain);
      return { src: s, g };
    });

    // Off the asphalt. Gravel: stones crunching and pinging off the floor pan (bright noise,
    // chopped by a fast random wander) over a low rumble. Grass: a soft, swishing hiss.
    this.gravelGain = gain(ac, 0);
    plug(this.gravelGain, dest);
    const grit = src(noiseSource(mix));
    const chop = gain(ac, 0.55);
    src(noiseSource(mix, { buffer: mix.wobble, rate: 7 })).connect(gain(ac, 0.6)).connect(chop.gain);
    grit.connect(filter(ac, 'highpass', 900, 0.7)).connect(filter(ac, 'peaking', 2600, 0.9)).connect(chop).connect(this.gravelGain);
    this.gravelRumble = filter(ac, 'lowpass', 160, 0.9);
    src(noiseSource(mix, { buffer: mix.pink })).connect(this.gravelRumble).connect(gain(ac, 2.2)).connect(this.gravelGain);
    this.grassGain = gain(ac, 0);
    plug(this.grassGain, dest);
    const swish = gain(ac, 0.6);
    src(noiseSource(mix, { buffer: mix.wobble, rate: 1.6 })).connect(gain(ac, 0.4)).connect(swish.gain);
    this.grassLp = filter(ac, 'lowpass', 900, 0.5);
    src(noiseSource(mix, { buffer: mix.pink })).connect(this.grassLp).connect(swish).connect(this.grassGain);

    // Timber bridge deck: every plank seam knocks the tyres (a hollow low-mid knock, gated
    // once per seam by the mixer's one-second seam pulse played at speed / plank pitch) over
    // the boom of the empty span underneath.
    this.woodGain = gain(ac, 0);
    const woodSend = gain(ac, 0.4);
    woodSend.connect(mix.space);
    plug(this.woodGain, dest, woodSend);
    const knock = src(noiseSource(mix, { buffer: mix.pink }));
    this.woodBp = filter(ac, 'bandpass', 210, 2.2);
    const seams = gain(ac, 0.5);
    this.woodSeams = src(noiseSource(mix, { buffer: mix.seams, rate: 8 }));
    this.woodSeams.connect(gain(ac, 0.5)).connect(seams.gain);
    knock.connect(this.woodBp).connect(seams).connect(gain(ac, 5)).connect(this.woodGain);
    const boom = filter(ac, 'lowpass', 95, 7);
    src(noiseSource(mix, { buffer: mix.pink })).connect(boom).connect(gain(ac, 2.6)).connect(this.woodGain);
  }

  // Loops start at a random point so two voices (a garage rev over another) never phase.
  start(t = this.ac.currentTime) {
    for (const s of this.sources) s.start(t, s.buffer ? Math.random() * s.buffer.duration : 0);
    return this;
  }

  stop(t = this.ac.currentTime, fade = 0.12) {
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, fade / 3);
    for (const g of [this.rushGain, this.windGain, this.skidGain, this.gravelGain, this.grassGain, this.woodGain]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, fade / 3);
    }
    for (const s of this.sources) s.stop(t + fade + 0.3);
  }

  // Sets a param toward v, skipping tiny changes so a steady state schedules nothing. A gated
  // layer is plugged in while its level is up and unplugged once it has faded out.
  p(param, v, t, tc) {
    const last = this.params.get(param);
    if (last !== undefined && Math.abs(last - v) <= Math.abs(v) * 0.004 + 1e-4) return;
    this.params.set(param, v);
    param.setTargetAtTime(v, t, tc);
    const gate = this.gates.get(param);
    if (gate) {
      if (v > 1e-4) gate.open();
      else gate.release(t + tc * 8);
    }
  }

  // Unplugs gated layers that have gone quiet (audio time `now`).
  poll(now) {
    for (const g of this.gates.values()) g.poll(now);
  }

  // s: { rpm, load 0..1, boost 0..1, tier 0..2, speed 0..1, skid 0..1, slip (rad), cut 0..1,
  //      gravel 0..1, grass 0..1 (share of the tyres on each), wood 0..1 (on the bridge deck),
  //      mps (road speed, m/s, for the plank seams), volume 0..1 }
  set(s, t, tc = 0.035) {
    const { rpm, load = 1, boost = 0, tier = 0, speed = 0, skid = 0, slip = 0, cut = 0, gravel = 0, grass = 0, wood = 0, mps = 0, volume = 1 } = s;
    const r = clamp((rpm - IDLE) / (REDLINE - IDLE), 0, 1.1);
    for (const { src, g, L } of this.loops) {
      const w = layerWeight(L, rpm);
      // A layer out of its range keeps its last pitch while silent, so it schedules nothing.
      if (w > 0) this.p(src.playbackRate, rpm / L.rpm, t, tc);
      this.p(g.gain, w > 0 ? w * layerTrim(L, rpm) : 0, t, tc);
    }
    this.p(this.tone.frequency, 1100 + load * 2200 + r * 3200 + tier * 800, t, tc);
    this.p(this.body.gain, 0.55 + 0.45 * load, t, tc);
    // The whistle shows while boost builds or changes; the hiss follows the pressure.
    this.p(this.whistleBp.frequency, 1800 + boost * 3400, t, tc);
    this.p(this.whistleGain.gain, 0.5 * boost * boost * (1 - 0.5 * r), t, tc);
    this.p(this.spoolHp.frequency, 2200 + boost * 2400, t, tc);
    this.p(this.spoolGain.gain, 0.09 * boost * boost, t, tc);
    this.p(this.rushGain.gain, tier ? 0.32 + 0.16 * tier : 0, t, tier ? tc : 0.2);
    if (tier) this.p(this.rush.playbackRate, 0.9 + 0.12 * tier + speed * 0.15, t, 0.2);
    this.p(this.rushBp.frequency, 800 + tier * 500 + speed * 700, t, 0.2);
    this.p(this.windGain.gain, speed * speed * 0.26, t, 0.15);
    this.p(this.windLp.frequency, 280 + speed * 1600, t, 0.15);
    const hard = clamp((skid - 0.35) / 0.5, 0, 1);
    this.p(this.skids[0].g.gain, Math.cos((hard * Math.PI) / 2), t, 0.08);
    this.p(this.skids[1].g.gain, Math.sin((hard * Math.PI) / 2), t, 0.08);
    if (skid > 0) {
      const pitch = 0.88 + Math.min(1, Math.abs(slip) * 1.6) * 0.3 + speed * 0.08;
      for (const k of this.skids) this.p(k.src.playbackRate, pitch, t, 0.06);
    }
    this.p(this.skidGain.gain, skid * 0.3 * volume, t, skid > 0 ? 0.04 : 0.09);
    const roll = Math.min(1, speed * 2.2) * (1 + Math.min(1, Math.abs(slip) * 2));
    this.p(this.gravelGain.gain, gravel * roll * 0.1 * volume, t, 0.05);
    this.p(this.gravelRumble.frequency, 90 + speed * 220, t, 0.1);
    this.p(this.grassGain.gain, grass * roll * 0.34 * volume, t, 0.08);
    this.p(this.grassLp.frequency, 500 + speed * 1400, t, 0.1);
    this.p(this.woodGain.gain, wood * Math.min(1, speed * 3) * 0.18 * volume, t, 0.04);
    this.p(this.woodSeams.playbackRate, Math.max(4, mps / 0.6), t, 0.05);
    this.p(this.woodBp.frequency, 180 + speed * 140, t, 0.1);
    this.p(this.out.gain, volume * ENGINE_LEVEL * (0.62 + 0.38 * load) * (0.8 + 0.4 * Math.min(1, r)) * (1 - 0.55 * cut), t, cut ? 0.02 : tc);
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

// ---------------------------------------------------------------------------
// Engine driver: runs the gearbox on the audio clock
// ---------------------------------------------------------------------------

// Control step on the audio timeline. The voice's params glide with time constants of 35 ms
// and up, so 60 Hz steps are smooth.
export const CONTROL_STEP = 1 / 60;

// Steps the gearbox in fixed steps of audio time and lays each step's voice settings onto the
// timeline `lookahead` seconds ahead of the playhead, holding the latest controls. The race
// hands it new controls every frame (input()); the audio clock calls fill() whether frames
// arrive or not, so frame timing never reaches the sound. onStep(t, rpm, throttle, boost)
// lets the mixer follow along (music ducking); onEvents(events, t) plays blow-off and crackle.
// Controls with `hold` set (the race is paused) freeze the gearbox where it is.
export class EngineDriver {
  constructor(voice, { lookahead = 0.05, onStep, onEvents } = {}) {
    this.voice = voice;
    this.box = new Gearbox();
    this.lookahead = lookahead;
    this.onStep = onStep;
    this.onEvents = onEvents ?? ((ev, t) => playEngineEvents(voice.mix, ev, t));
    this.controls = { throttle: 0, neutral: true, volume: 1 };
    this.next = -1;
  }

  input(controls) {
    this.controls = controls;
  }

  fill(now) {
    const until = now + this.lookahead;
    // First fill, or a stall longer than the look-ahead: the voice has held its last state
    // and carries on from the playhead (no burst of catch-up steps).
    if (this.next < now) this.next = now;
    const c = this.controls;
    const { speedNorm = 0, throttle = 1, neutral = false, airborne = false, speed = 0, boost = 0, skid = 0, slip = 0, gravel = 0, grass = 0, wood = 0, mps = 0, volume = 1 } = c;
    while (this.next < until) {
      const t = this.next;
      const box = this.box;
      const events = box.step(c.hold ? 0 : CONTROL_STEP, { speedNorm, throttle, neutral, airborne });
      if (volume > 0 && events.length) this.onEvents(events, t);
      this.voice.set({ rpm: box.rpm, load: throttle, boost: box.boost, tier: boost, speed, skid, slip, cut: box.cut, gravel, grass, wood, mps, volume }, t);
      this.onStep?.(t, box, c);
      this.next += CONTROL_STEP;
    }
    this.voice.poll(now);
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
