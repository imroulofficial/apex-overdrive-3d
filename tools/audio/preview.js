// Offline renders of the game's audio, built from the same modules the game plays live.
// Each clip is a little script on a timeline; render.mjs saves them as WAV files.
import { createMixer, MUSIC_LEVEL, OUTPUT } from '../../src/audio/mixer.js';
import { EngineVoice, Gearbox, playEngineEvents, revEngine } from '../../src/audio/engine.js';
import { ui, race, blowOff, nitroIgnite } from '../../src/audio/sfx.js';
import { Music } from '../../src/audio/music.js';
import { simulate, cost, live } from './stall.js';

// The rate phones run at, and the rate the samples are recorded at.
const SR = 48000;
const FRAME = 1 / 60;

// Channels 0-1 carry the output. The rest tap the output stage so the meters can see how
// hard the safety stages work: 2-3 the clipper's input, 4-5 the limiter's input. Only 0-1
// are written to the WAV.
const TAPS = ['clipper', 'trim', 'highpass'];
function context(seconds, opts) {
  const ac = new OfflineAudioContext(TAPS.length * 2, Math.ceil(seconds * SR), SR);
  const mix = createMixer(ac, opts);
  mix.music.gain.value = MUSIC_LEVEL;
  const nodes = mix.stage;
  nodes.clipper.disconnect();
  ac.destination.channelCount = TAPS.length * 2;
  ac.destination.channelInterpretation = 'discrete';
  const merge = ac.createChannelMerger(TAPS.length * 2);
  TAPS.forEach((name, k) => {
    const stereo = ac.createGain();
    stereo.channelCount = 2;
    stereo.channelCountMode = 'explicit';
    const split = ac.createChannelSplitter(2);
    nodes[name].connect(stereo).connect(split);
    split.connect(merge, 0, k * 2);
    split.connect(merge, 1, k * 2 + 1);
  });
  merge.connect(ac.destination);
  return mix;
}

// Butterworth biquad (RBJ) run over a channel, for the band meters.
function biquad(d, type, f0) {
  const w = (2 * Math.PI * f0) / SR;
  const al = Math.sin(w) / (2 * Math.SQRT1_2);
  const c = Math.cos(w);
  const b = type === 'lowpass' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  const a0 = 1 + al;
  const a1 = -2 * c;
  const a2 = 1 - al;
  const o = new Float32Array(d.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const y = (b[0] * d[i] + b[1] * x1 + b[2] * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = d[i];
    y2 = y1;
    y1 = y;
    o[i] = y;
  }
  return o;
}

const energy = (d) => d.reduce((s, x) => s + x * x, 0);
const pct = (v) => +(v * 100).toFixed(1);

// Gain reduction of a compressor from its input and output taps, in 20 ms windows. The
// compressor's static make-up gain is the ratio it applies in quiet passages, so reduction is
// measured from there. DynamicsCompressorNode looks ahead by about 6 ms.
function reduction(buf, inCh, outCh, scale = 1) {
  const win = Math.round(0.02 * SR);
  const ahead = Math.round(0.006 * SR);
  const ratios = [];
  for (let i = ahead; i + win < buf.length; i += win) {
    let ei = 0;
    let eo = 0;
    for (const c of [0, 1]) {
      const di = buf.getChannelData(inCh + c);
      const dout = buf.getChannelData(outCh + c);
      for (let j = i; j < i + win; j++) {
        ei += di[j - ahead] ** 2;
        eo += (dout[j] / scale) ** 2;
      }
    }
    if (ei > 1e-7 * win) ratios.push(10 * Math.log10((eo + 1e-12) / ei));
  }
  if (!ratios.length) return { max: 0, busy: 0 };
  const sorted = [...ratios].sort((x, y) => x - y);
  const makeup = sorted[Math.floor(sorted.length * 0.98)];
  const gr = ratios.map((r) => makeup - r);
  // 99th percentile: a clip's first and last windows (voices starting and stopping) skew a
  // plain maximum.
  const p99 = [...gr].sort((x, y) => x - y)[Math.floor(gr.length * 0.99)];
  return { max: p99, busy: gr.filter((x) => x > 1).length / gr.length };
}

function meters(buf) {
  const knee = OUTPUT.knee;
  let clipped = 0;
  let inPeak = 0;
  for (const c of [2, 3]) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > knee) clipped++;
      if (a > inPeak) inPeak = a;
    }
  }
  // Share of the output's energy below 150 Hz: what a phone speaker cannot play but its
  // amplifier and protection DSP still have to swallow.
  const out = buf.getChannelData(0);
  const low = biquad(biquad(out, 'lowpass', 150), 'lowpass', 150);
  const lim = reduction(buf, 4, 2, OUTPUT.trim);
  const level = (c) => {
    const d = buf.getChannelData(c);
    let p = 0;
    let e = 0;
    for (let i = 0; i < d.length; i++) {
      p = Math.max(p, Math.abs(d[i]));
      e += d[i] * d[i];
    }
    return `${(20 * Math.log10(p + 1e-9)).toFixed(1)}/${(10 * Math.log10(e / d.length + 1e-12)).toFixed(1)}`;
  };
  return {
    clipperPct: pct(clipped / (buf.length * 2)),
    clipInDb: +(20 * Math.log10(inPeak + 1e-9)).toFixed(1),
    limiterMaxDb: +lim.max.toFixed(1),
    limiterBusyPct: pct(lim.busy),
    limIn: level(4),
    lowPct: pct(energy(low) / (energy(out) + 1e-12)),
  };
}

// Drives a player engine through a scripted run: drive(t) returns the controls at time t.
function driveEngine(mix, seconds, drive, { from = 0 } = {}) {
  const voice = new EngineVoice(mix).start(from);
  const box = new Gearbox();
  let v = 0;
  // A clip that starts at speed settles the gearbox into the right gear first, silently.
  const first = drive(0, 0);
  if (first.speed) for (let t = 0; t < 4; t += FRAME) box.step(FRAME, { speedNorm: first.speed * Math.min(1, t / 3), throttle: 1 });
  const log = [];
  for (let t = 0; t < seconds; t += FRAME) {
    const c = drive(t, v);
    const thr = c.throttle ?? 1;
    const tier = c.tier ?? 0;
    const top = tier === 2 ? 1.36 : tier === 1 ? 1.18 : 1;
    // Same shape as the game's arcade longitudinal model, in units of top speed.
    let a = thr * 0.26 * (1 - Math.min(1, (v / top) ** 2)) * (v < 0.4 ? 1.25 : 1);
    if (tier) a += tier === 2 ? 0.5 : 0.25;
    if (v > top) a -= (v - top) * 1.4;
    if (c.brake) a -= 0.6;
    if (!thr && !c.brake) a -= 0.04;
    v = Math.max(0, v + a * FRAME);
    if (c.speed !== undefined) v = c.speed;
    if (c.neutral) v = 0;
    const ev = box.step(FRAME, { speedNorm: v, throttle: thr, neutral: c.neutral, airborne: c.airborne });
    const at = from + t;
    playEngineEvents(mix, ev, at);
    voice.set({ rpm: box.rpm, load: thr, boost: box.boost, tier, speed: Math.min(1, v * 0.9), skid: c.skid ?? 0, slip: c.slip ?? 0, cut: box.cut }, at);
    // Music ducking as in core/audio.js.
    const r = Math.max(0, Math.min(1, (box.rpm - 1500) / 6000));
    mix.duck.gain.setTargetAtTime(c.duck ?? 1 - 0.38 * Math.min(1, r * thr * 0.8 + tier * 0.25), at, c.duck ? 0.04 : 0.35);
    for (const e of ev) if (e.type === 'upshift' || e.type === 'downshift') log.push(`${at.toFixed(2)}s ${e.type} → gear ${e.gear + 1}`);
  }
  voice.stop(from + seconds, 0.4);
  return log;
}

// A steady cruise at part throttle, then a long drift: the stretch where a short loop's period
// shows (the same RPM loop and tyre loop held for seconds). Rendered with the 12 s baked loops
// and, for comparison, with the recorded 0.45-2 s loops.
const cruise = (longLoops) => ({
  seconds: 16,
  mixer: { longLoops },
  build(mix) {
    const voice = new EngineVoice(mix).start(0);
    for (let t = 0; t < 15.5; t += FRAME) {
      const drift = t > 9;
      voice.set({ rpm: drift ? 5400 : 2700, load: drift ? 0.9 : 0.55, speed: 0.55, skid: drift ? 0.85 : 0, slip: drift ? 0.5 : 0, volume: 1 }, t);
    }
    voice.stop(15.5, 0.4);
    return [];
  },
});

const clips = {
  'engine-cruise-drift': cruise(true),
  'engine-cruise-drift-short-loops': cruise(false),
  // Standing start through all six gears, a lift (blow-off + crackle), then back on it.
  'engine-6-gears': {
    seconds: 22,
    build(mix) {
      return driveEngine(mix, 21.5, (t) => {
        if (t < 1.2) return { neutral: true, throttle: t > 0.4 && t < 0.8 ? 0.6 : 0.1 };
        if (t < 15) return { throttle: 1 };
        if (t < 17.5) return { throttle: 0 };
        return { throttle: 1 };
      }, {});
    },
  },
  // Analysis clip: the RPM loops alone at full load, swept slowly from idle to the limiter
  // and back (12 s each way), so every crossfade can be checked for level, tone and pitch
  // jumps. The rpm is written into the log every 0.25 s for the analysis script.
  'engine-rpm-sweep': {
    seconds: 25,
    build(mix) {
      const voice = new EngineVoice(mix).start(0);
      const log = [];
      const lo = 950;
      const hi = 7800;
      for (let t = 0; t < 24; t += FRAME) {
        const k = t < 12 ? t / 12 : (24 - t) / 12;
        // Exponential sweep: equal time per musical interval, like a real pull.
        const rpm = lo * (hi / lo) ** k;
        voice.set({ rpm, load: 1, volume: 1 }, t);
        if (Math.abs(t * 4 - Math.round(t * 4)) < FRAME * 2) log.push(`rpm ${t.toFixed(2)} ${Math.round(rpm)}`);
      }
      voice.stop(24, 0.4);
      return log;
    },
  },
  // The same sweep with one RPM loop left in (analysis of each layer's level and tone).
  ...Object.fromEntries(
    [0, 1, 2, 3, 4].map((k) => [
      `engine-sweep-layer-${k}`,
      {
        seconds: 25,
        analysis: true,
        build(mix) {
          const voice = new EngineVoice(mix).start(0);
          voice.loops.forEach((l, i) => i !== k && l.g.disconnect());
          for (let t = 0; t < 24; t += FRAME) {
            const q = t < 12 ? t / 12 : (24 - t) / 12;
            voice.set({ rpm: 950 * (7800 / 950) ** q, load: 1, volume: 1 }, t);
          }
          voice.stop(24, 0.4);
        },
      },
    ])
  ),
  'garage-headlight-rev': {
    seconds: 5,
    build(mix) {
      ui.relay(mix, 0.3);
      revEngine(mix, 'stab', 0.32);
      ui.tap(mix, 2.6);
      revEngine(mix, 'double', 2.7);
    },
  },
  'turbo-blow-off': {
    seconds: 4,
    build(mix) {
      blowOff(mix, 0.5, 0.2);
      blowOff(mix, 0.85, 1.4);
      blowOff(mix, 1.2, 2.6);
    },
  },
  // Cruising in the upper gears: Blue Nitro, then Pulse Nitro.
  'nitro-blue-and-pulse': {
    seconds: 10,
    build(mix) {
      nitroIgnite(mix, 1, 1.5);
      nitroIgnite(mix, 2, 5.5);
      return driveEngine(mix, 9.6, (t) => ({ throttle: 1, speed: t < 1.5 ? 0.82 : undefined, tier: t > 1.5 && t < 3.4 ? 1 : t > 5.5 && t < 8 ? 2 : 0 }));
    },
  },
  // A power-slide: slip angle swells and wobbles, then the car straightens and banks it.
  'drift-screech': {
    seconds: 8,
    build(mix) {
      race.chirp(mix, 1.0);
      race.driftBank(mix, 6.2);
      return driveEngine(mix, 7.6, (t) => {
        const inDrift = t > 1 && t < 6;
        const slip = inDrift ? 0.35 + 0.2 * Math.sin(t * 2.3) + 0.1 * Math.sin(t * 7.1) : 0;
        return { throttle: 1, speed: 0.62, skid: inDrift ? Math.min(1, slip * 2) : 0, slip };
      });
    },
  },
  'race-soundtrack': {
    seconds: 66,
    build(mix) {
      const music = new Music(mix);
      music.start(0.05);
      music.schedule(65.5);
    },
  },
  // Countdown, launch, nitro, a drift and a smash with the soundtrack ducking underneath.
  'race-mix': {
    seconds: 28,
    build(mix) {
      const music = new Music(mix);
      music.start(0.05);
      race.beep(mix, 1.0);
      race.beep(mix, 1.9);
      race.beep(mix, 2.8);
      race.go(mix, 3.7);
      music.dropPending = false;
      nitroIgnite(mix, 1, 9);
      nitroIgnite(mix, 2, 9.35);
      race.chirp(mix, 14);
      race.smash(mix, false, 18.2);
      race.smash(mix, true, 19.1);
      race.wall(mix, 12, 21.5);
      race.lap(mix, 24);
      // Jump the soundtrack into the full track on the green light, as the game does.
      music.schedule(3.8);
      music.dropPending = true;
      music.schedule(27.5);
      const log = driveEngine(mix, 27.5, (t) => {
        if (t < 3.7) return { neutral: true, throttle: t > 1 && Math.sin(t * 7.3) > 0.4 ? 0.62 : 0.16 };
        if (t > 14 && t < 17) {
          const slip = 0.4 + 0.15 * Math.sin(t * 3);
          return { throttle: 1, skid: Math.min(1, slip * 2), slip };
        }
        if (t > 21.5 && t < 22.5) return { throttle: 0 };
        return { throttle: 1, tier: t > 9 && t < 9.35 ? 1 : t >= 9.35 && t < 12 ? 2 : 0, duck: t > 9 && t < 10.6 ? 0.45 : undefined };
      });
      return log;
    },
  },
  // Worst case for the output stage: redline on pulse nitro, the music drop, and a pile of
  // impacts stacked on the same frames. The peak must stay under the clipper ceiling.
  'pileup': {
    seconds: 8,
    build(mix) {
      const music = new Music(mix);
      music.dropPending = true;
      music.start(0.05);
      music.schedule(7.5);
      nitroIgnite(mix, 2, 2);
      for (let i = 0; i < 6; i++) race.smash(mix, i % 2 === 0, 3 + i * 0.012);
      race.shatter(mix, 'neon', 3);
      race.wall(mix, 20, 3.01);
      race.land(mix, 14, 3.02);
      race.bump(mix, 3.03);
      race.perfect(mix, 3.05);
      race.finish(mix, 4);
      return driveEngine(mix, 7.5, (t) => ({ speed: 1.3, throttle: 1, tier: t > 2 ? 2 : 0, skid: 1, slip: 0.5, duck: 1 }));
    },
  },
  'ui-and-race-sfx': {
    seconds: 12,
    build(mix) {
      let t = 0.2;
      const at = (dt) => (t += dt);
      ui.tap(mix, t);
      ui.tap(mix, at(0.35));
      ui.swipe(mix, at(0.5));
      ui.swipe(mix, at(0.45));
      ui.confirm(mix, at(0.6));
      ui.deny(mix, at(0.8));
      ui.relay(mix, at(0.7));
      race.beep(mix, at(0.8));
      race.go(mix, at(0.9));
      race.empty(mix, at(1.0));
      race.smash(mix, false, at(0.6));
      race.smash(mix, true, at(0.7));
      race.bump(mix, at(0.7));
      race.wall(mix, 10, at(0.7));
      race.land(mix, 9, at(0.8));
      race.lap(mix, at(0.8));
      race.finish(mix, at(1.0));
    },
  },
};

function toWav(buf) {
  const ch = 2;
  const n = buf.length;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  data.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVEfmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, buf.sampleRate, true);
  data.setUint32(28, buf.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, n * ch * 2, true);
  const chans = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(data.buffer);
}

function stats(buf) {
  let peak = 0;
  let sum = 0;
  let bad = 0;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const x = d[i];
      if (!Number.isFinite(x)) bad++;
      else {
        peak = Math.max(peak, Math.abs(x));
        sum += x * x;
      }
    }
  }
  const rms = Math.sqrt(sum / (buf.length * 2));
  return { peakDb: +(20 * Math.log10(peak + 1e-9)).toFixed(1), rmsDb: +(20 * Math.log10(rms + 1e-9)).toFixed(1), nonFinite: bad };
}

async function render(name) {
  const clip = clips[name];
  const mix = context(clip.seconds, clip.mixer);
  await mix.samples.ready;
  const log = clip.build(mix) ?? [];
  const t0 = performance.now();
  const buf = await mix.ac.startRendering();
  const ms = Math.round(performance.now() - t0);
  const bytes = toWav(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name, wav: btoa(bin), stats: { ...stats(buf), ...meters(buf) }, ms, log };
}

window.__audio = { names: Object.keys(clips).filter((n) => !clips[n].analysis), render, simulate, cost, live };
