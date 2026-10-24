import { noiseSource, filter, gain } from './mixer.js';
import { loopSource } from './samples.js';
import { blowOff, crackle } from './sfx.js';
import { Gate } from './clock.js';
import { Gearbox, LAYERS, layerWeight, layerTrim, REVS, IDLE, REDLINE, ENGINE_LEVEL, clamp } from './gearbox.js';

// The player's engine, built the way commercial racers build theirs: recorded RPM loops,
// pitch-shifted with the revs and crossfaded between, plus recorded turbo, nitro and tyre
// layers, all driven by a six-speed virtual gearbox. The loops are cut from CC0 recordings
// of real cars by tools/audio/samples.mjs (see audio/samples.js): the idle is a big-block V8
// ticking over, the low range a loud four-cylinder exhaust on load, and the mid to top range
// an Aston Martin V12 pulling to the redline, each slice resampled to hold one steady pitch
// so it can loop. No layer is an oscillator.

// The gearbox, the layer table and the rev scripts are shared with the audio-thread mixer
// (audio/worklet/carMixer.processor.js).
export { Gearbox, LAYERS, layerWeight, layerTrim, REVS } from './gearbox.js';

// ---------------------------------------------------------------------------
// Engine voice: the sample graph, driven by set() at a given time
// ---------------------------------------------------------------------------

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
    this.state = {}; // the voice settings of one control step, refilled
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
      const v = this.state;
      v.rpm = box.rpm;
      v.load = throttle;
      v.boost = box.boost;
      v.tier = boost;
      v.speed = speed;
      v.skid = skid;
      v.slip = slip;
      v.cut = box.cut;
      v.gravel = gravel;
      v.grass = grass;
      v.wood = wood;
      v.mps = mps;
      v.volume = volume;
      this.voice.set(v, t);
      this.onStep?.(t, box, c);
      this.next += CONTROL_STEP;
    }
    this.voice.poll(now);
  }
}

// A free-revving one-shot for the garage (REVS in audio/gearbox.js).
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
