// Frame-stall test: plays a race through the game's audio code while a simulated Android main
// thread drops frames, and measures what the stalls do to the sound.
//
// The race runs in an OfflineAudioContext that suspends at every moment the main thread
// would get to run JS (a frame, or a timer tick when no frame is hogging the thread), so the
// audio side sees exactly the call pattern a phone produces, hitches included. Three paths
// are compared on the same hitch pattern:
//   previous: the engine set from the render loop at "now", music queued 150 ms ahead from a
//             25 ms main-thread timer, every one-shot sounding, nothing unplugged, and the
//             synthesized car (tools/audio/legacy);
//   synth:    the audio clock (engine stepped on audio time and queued ahead, music queued
//             300 ms ahead, worker ticks), 6 pooled one-shot voices, idle layers unplugged,
//             still with the synthesized car and the stereo hall reverb: the build before
//             the car went to samples (tools/audio/legacy);
//   current:  the same control path with the sampled car and the mono hall (src/audio/).
// render.mjs compares the synthesized car at the 32 kHz the Android build used to run at with
// the sampled one at the hardware's 48 kHz.
import { createMixer, MUSIC_LEVEL, MUSIC_TONE, mulberry32 } from '../../src/audio/mixer.js';
import * as sampled from '../../src/audio/engine.js';
import * as synth from './legacy/engine.js';
import { race, nitroIgnite as sampledNitro, rainBed } from '../../src/audio/sfx.js';
import { nitroIgnite as synthNitro } from './legacy/sfx.js';
import { Music as SampledMusic, MUSIC_INFO } from '../../src/audio/music.js';
import { Music as SynthMusic } from './legacy/music.js';
import { VoicePool, PRIORITY, MAX_VOICES } from '../../src/audio/voices.js';
import { AudioClock } from '../../src/audio/clock.js';

const FRAME = 1 / 60;

// Main-thread frames as [start, duration]. Hitches like a mid-range phone's (GC, shader
// compiles, texture uploads, the GPU falling behind): one every 1.2-2.5 s of 60-250 ms, and
// one frame in ten at 30 FPS. `heavy` hitches run 120-500 ms (a shader compile on a new
// stage, a big GC on a slow phone).
export const HITCHES = { normal: [0.06, 0.09, 0.12, 0.18, 0.25], heavy: [0.12, 0.25, 0.35, 0.5] };
export function frames(seconds, { seed = 4, hitches = true, sizes = HITCHES.normal } = {}) {
  const rand = mulberry32(seed);
  const out = [];
  let t = 0;
  let next = 1.5;
  while (t < seconds) {
    let d = FRAME;
    if (hitches && t >= next) {
      d = sizes[Math.floor(rand() * sizes.length)];
      next = t + 1.2 + rand() * 1.3;
    } else if (hitches && rand() < 0.1) d = 2 * FRAME;
    out.push([t, d]);
    t += d;
  }
  return out;
}

// When a timer due at `due` gets to run: at once, unless a long frame holds the thread.
function released(due, busy) {
  for (const [s, d] of busy) if (due >= s && due < s + d) return s + d;
  return due;
}

// The scripted race on game time g: grid, launch through the gears, nitro, a drift, a lift.
function controls(g) {
  if (g < 2.5) return { neutral: true, throttle: g > 1 && Math.sin(g * 7.3) > 0.4 ? 0.62 : 0.16 };
  if (g > 11 && g < 13.5) {
    const slip = 0.4 + 0.15 * Math.sin(g * 3);
    return { throttle: 1, skid: Math.min(1, slip * 2), slip };
  }
  if (g > 17 && g < 18.2) return { throttle: 0 };
  return { throttle: 1, tier: g > 7 && g < 7.35 ? 1 : g >= 7.35 && g < 10 ? 2 : 0 };
}

// One-shots on game time: [time, priority, play(mix)]. A cone field at 14 s stacks up.
const SHOTS = [
  [0.4, 'key', (m) => race.beep(m)],
  [1.2, 'key', (m) => race.beep(m)],
  [2.0, 'key', (m) => race.beep(m)],
  [2.5, 'key', (m) => race.go(m)],
  [7, 'key', (m, car) => car.nitroIgnite(m, 1)],
  [7.35, 'key', (m, car) => car.nitroIgnite(m, 2)],
  [11, 'detail', (m) => race.chirp(m)],
  [13.6, 'cue', (m) => race.driftBank(m)],
  ...[0, 0.07, 0.14, 0.21, 0.28, 0.35, 0.42, 0.49].map((dt, i) => [14 + dt, 'impact', (m) => race.smash(m, i % 3 === 0)]),
  [14.1, 'impact', (m) => race.shatter(m, 'neon')],
  [14.25, 'impact', (m) => race.wall(m, 14)],
  [14.3, 'key', (m) => race.perfect(m)],
  [14.4, 'detail', (m) => race.bump(m)],
  [15.5, 'impact', (m) => race.thunder(m, 0.2)],
  [20, 'key', (m) => race.lap(m)],
];

// The race's audio, wired up the way the given control path does it. Returns the main-thread
// work (a frame of the race, a timer tick) for the caller to run at audio time `now`.
function raceAudio(mix, path, { live = false, t0 = 0, without = [] } = {}) {
  mix.music.gain.value = MUSIC_LEVEL;
  const current = path !== 'previous';
  const car = path === 'current' ? { ...sampled, nitroIgnite: sampledNitro } : { ...synth, nitroIgnite: synthNitro };
  const { EngineVoice, EngineDriver, Gearbox, playEngineEvents } = car;
  const pool = new VoicePool(mix, current ? MAX_VOICES : Infinity);
  pool.live = live;

  // Music, counting every 16th it queues and the ones queued after their time had passed.
  const Music = path === 'current' ? SampledMusic : SynthMusic;
  const music = new Music(mix, current ? { gated: true, lookahead: 0.3 } : { lookahead: 0.15 });
  const notes = { queued: 0, late: 0 };
  let playhead = 0;
  const play = music.play.bind(music);
  music.play = (sec, s, t) => {
    notes.queued++;
    if (t < playhead) notes.late++;
    play(sec, s, t);
  };
  const musicStart = 0.05;
  music.start(t0 + musicStart);

  // Engine, recording the audio times its controls land on.
  const voice = new EngineVoice(mix, { gated: current }).start(t0);
  const steps = [];
  const set = voice.set.bind(voice);
  voice.set = (s, t, tc) => {
    steps.push(t);
    set(s, t, tc);
  };
  const duck = (t, rpm, throttle, tier) => {
    const r = Math.max(0, Math.min(1, (rpm - 1500) / 6000));
    const k = Math.min(1, r * throttle * 0.8 + tier * 0.25);
    mix.duck.gain.setTargetAtTime(1 - 0.38 * k, t, 0.35);
    mix.musicTone.frequency.setTargetAtTime(MUSIC_TONE.open * Math.pow(MUSIC_TONE.engine / MUSIC_TONE.open, k), t, 0.4);
  };
  let driver = null;
  const box = current ? null : new Gearbox();
  if (current) {
    driver = new EngineDriver(voice, {
      lookahead: 0.07,
      onEvents: (ev, t) => ev.forEach((e) => pool.play(e.type === 'pop' ? 0 : 1, (vm) => playEngineEvents(vm, [e], t), t)),
      onStep: (t, b, c) => duck(t, b.rpm, c.throttle ?? 1, c.boost ?? 0),
    });
  }
  const rain = rainBed(mix);
  rain.set(0.5);
  // Profiling: parts left out of the render (unplugged from the output, so nothing pulls them).
  if (without.includes('music')) mix.music.disconnect();
  if (without.includes('engine')) voice.out.disconnect();

  let game = 0;
  let lastFrame = t0;
  let v = 0;
  let shot = 0;
  let dropped = false;
  const runTimers = (now) => {
    if (current) {
      driver.fill(now);
      music.fill(now);
    } else music.fill(now);
  };
  const runFrame = (now) => {
    const dt = Math.max(0, Math.min(0.05, now - lastFrame));
    lastFrame = now;
    game += dt;
    const c = controls(game);
    const thr = c.throttle ?? 1;
    const tier = c.tier ?? 0;
    const top = tier === 2 ? 1.36 : tier === 1 ? 1.18 : 1;
    let a = thr * 0.26 * (1 - Math.min(1, (v / top) ** 2)) * (v < 0.4 ? 1.25 : 1);
    if (tier) a += tier === 2 ? 0.5 : 0.25;
    if (v > top) a -= (v - top) * 1.4;
    if (!thr) a -= 0.04;
    v = c.neutral ? 0 : Math.max(0, v + a * dt);
    if (!dropped && game >= 2.5) {
      music.drop();
      dropped = true;
    }
    const ctl = { speedNorm: v, throttle: thr, neutral: !!c.neutral, speed: Math.min(1, v * 0.9), boost: tier, skid: c.skid ?? 0, slip: c.slip ?? 0 };
    if (current) {
      driver.input(ctl);
      runTimers(now);
    } else {
      const ev = box.step(dt, ctl);
      ev.forEach((e) => pool.play(1, (vm) => playEngineEvents(vm, [e], now), now));
      voice.set({ rpm: box.rpm, load: thr, boost: box.boost, tier, speed: ctl.speed, skid: ctl.skid, slip: ctl.slip, cut: box.cut }, now);
      duck(now, box.rpm, thr, tier);
    }
    while (shot < SHOTS.length && SHOTS[shot][0] <= game) {
      const [, p, fn] = SHOTS[shot++];
      pool.play(PRIORITY[p], (vm) => fn(vm, car), now);
    }
  };
  return {
    runFrame,
    runTimers,
    music,
    pool,
    steps,
    notes,
    musicStart,
    setPlayhead: (t) => (playhead = t),
  };
}

export async function simulate({ seconds = 24, path = 'current', hitches = true, profile = 'normal', rate = 44100, without } = {}) {
  const SR = rate;
  const QUANTUM = 128 / SR;
  const ac = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const mix = createMixer(ac);
  await mix.samples.ready;
  const current = path !== 'previous';
  const { runFrame, runTimers, pool, steps, notes, musicStart, setPlayhead } = raceAudio(mix, path, { without });

  // Main-thread work, in the order a phone would run it.
  const fr = frames(seconds, { hitches, sizes: HITCHES[profile] });
  const busy = fr.filter(([, d]) => d > FRAME * 1.5);
  const events = fr.map(([s]) => ({ t: s, kind: 'frame' }));
  const tick = current ? 0.02 : 0.025;
  for (let due = 0; due < seconds; due += tick) events.push({ t: released(due, busy), kind: 'timer' });
  const at = new Map();
  for (const e of events) {
    const q = Math.ceil(e.t / QUANTUM) * QUANTUM;
    if (q <= 0 || q >= seconds - 0.1) continue;
    if (!at.has(q)) at.set(q, []);
    at.get(q).push(e.kind);
  }

  for (const [q, kinds] of at) {
    ac.suspend(q).then(() => {
      setPlayhead(q);
      if (kinds.includes('frame')) runFrame(q);
      if (kinds.includes('timer')) runTimers(q);
      ac.resume();
    });
  }

  const t0 = performance.now();
  const buf = await ac.startRendering();
  const ms = performance.now() - t0;

  // Engine: audio time where the controls stopped arriving and the voice just held (more
  // than two control steps without a new one).
  steps.sort((x, y) => x - y);
  let frozen = 0;
  let worst = 0;
  for (let i = 1; i < steps.length; i++) {
    const gap = steps[i] - steps[i - 1] - 2 * sampled.CONTROL_STEP;
    if (gap > 0) {
      frozen += gap;
      worst = Math.max(worst, gap);
    }
  }
  const expected = Math.floor((seconds - 0.15 - musicStart) / MUSIC_INFO.step);
  let peak = 0;
  let bad = 0;
  for (let c = 0; c < 2; c++) {
    for (const x of buf.getChannelData(c)) {
      if (!Number.isFinite(x)) bad++;
      else peak = Math.max(peak, Math.abs(x));
    }
  }
  return {
    path,
    profile,
    hitches: busy.filter(([, d]) => d > 0.05).length,
    hitchMs: Math.round(busy.reduce((s, [, d]) => s + d, 0) * 1000),
    engineFrozenMs: Math.round(frozen * 1000),
    engineWorstFreezeMs: Math.round(worst * 1000),
    musicDropped: Math.max(0, expected - notes.queued),
    longestMs: Math.round(Math.max(...busy.map(([, d]) => d)) * 1000),
    musicLate: notes.late,
    voicesPeak: pool.stats.peak,
    voicesStolen: pool.stats.stolen,
    voicesDropped: pool.stats.dropped,
    renderMs: Math.round(ms),
    peakDb: +(20 * Math.log10(peak + 1e-9)).toFixed(1),
    nonFinite: bad,
  };
}

// Audio-thread cost of the race (no hitches, so both paths run the same score): the best of
// `runs` renders at sample rate `rate`, as a share of one core of this machine. It includes
// the control JS run at each suspend, so it overstates the graph's own cost a little.
// `without` leaves parts out ('music', 'engine') to break the cost down.
export async function cost(path, { seconds = 24, runs = 3, rate = 44100, without } = {}) {
  let best = Infinity;
  for (let i = 0; i < runs; i++) best = Math.min(best, (await simulate({ seconds, path, hitches: false, rate, without })).renderMs);
  return { path, rate, renderMs: best, corePct: +((best / (seconds * 1000)) * 100).toFixed(2) };
}

// Live underrun test: the same race in a real AudioContext for `seconds`, with the main thread
// really blocked through the hitch pattern, and a ballast AudioWorklet burning `ballast` (0..1)
// of every render quantum's time budget to stand in for a phone's slower, busier CPU. Chrome's
// playout stats count the audio the render thread failed to deliver in time: the crackle.
const BALLAST = `registerProcessor('ballast', class extends AudioWorkletProcessor {
  constructor(o) { super(); this.n = o.processorOptions.n; this.x = 0; }
  process() { let x = this.x; for (let i = 0; i < this.n; i++) x += Math.sin(i + x) * 1e-9; this.x = x; return true; }
});`;

function spin(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end);
}

// Ballast loop iterations per millisecond on this machine.
function calibrate() {
  let x = 0;
  let n = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 50) {
    for (let i = 0; i < 1e4; i++) x += Math.sin(i + x) * 1e-9;
    n += 1e4;
  }
  return n / (performance.now() - t0) + x * 0;
}

export async function live({ path = 'current', seconds = 12, profile = 'normal', ballast = 0, latencyHint = 'playback', rate } = {}) {
  const ac = new AudioContext({ latencyHint, sampleRate: rate });
  await ac.resume();
  if (ballast > 0) {
    const n = Math.round(calibrate() * ((128 / ac.sampleRate) * 1000) * ballast);
    await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([BALLAST], { type: 'text/javascript' })));
    new AudioWorkletNode(ac, 'ballast', { processorOptions: { n } }).connect(ac.destination);
  }
  const mix = createMixer(ac);
  await mix.samples.ready;
  const t0 = ac.currentTime + 0.1;
  const race = raceAudio(mix, path, { live: true, t0 });
  const tick = (now) => {
    race.setPlayhead(now);
    race.runTimers(now);
  };
  let clock = null;
  let timer = 0;
  if (path !== 'previous') {
    clock = new AudioClock(ac);
    clock.add({ fill: tick });
  } else timer = setInterval(() => tick(ac.currentTime), 25);

  const stalls = frames(seconds, { sizes: HITCHES[profile] }).filter(([, d]) => d > FRAME * 1.5);
  const before = ac.playoutStats?.toJSON();
  await new Promise((resolve) => {
    const start = performance.now();
    let k = 0;
    const loop = () => {
      const el = (performance.now() - start) / 1000;
      if (el > seconds) return resolve();
      const now = ac.currentTime;
      race.setPlayhead(now);
      race.runFrame(now);
      while (k < stalls.length && stalls[k][0] <= el) spin((stalls[k++][1] - FRAME) * 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const after = ac.playoutStats?.toJSON();
  clock?.halt();
  clearInterval(timer);
  const out = {
    path,
    ballast,
    latencyHint,
    sampleRate: ac.sampleRate,
    baseLatencyMs: Math.round((ac.baseLatency ?? 0) * 1000),
    outputLatencyMs: Math.round((ac.outputLatency ?? 0) * 1000),
    underruns: after ? after.fallbackFramesEvents - before.fallbackFramesEvents : null,
    underrunMs: after ? Math.round(after.fallbackFramesDuration - before.fallbackFramesDuration) : null,
    voicesPeak: race.pool.stats.peak,
  };
  await ac.close();
  return out;
}
