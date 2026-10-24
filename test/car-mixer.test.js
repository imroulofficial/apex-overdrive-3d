// The audio-thread car mixer (src/audio/worklet/carMixer.processor.js), run under node with
// stand-ins for the AudioWorklet globals. What a race needs from it: loops that never seam at
// any pitch, surfaces and gears that only move numbers, a fixed one-shot pool, the soundtrack's
// drop and loop, and a process() that allocates nothing (garbage collection on the audio
// thread is a glitch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { GCProfiler } from 'node:v8';
import { SHOTS, SHOT_TABLE, SHOT_INDEX, CTL, FRAME_LENGTH, MAX_SHOTS, OUTPUT_CHANNELS, PROCESSOR } from '../src/audio/worklet/protocol.js';
import { LOOP_SAMPLES } from '../src/audio/samples.js';
import fs from 'node:fs';

const SR = 48000;
globalThis.sampleRate = SR;
const registered = {};
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { onmessage: null, sent: [], postMessage(m) { this.sent.push(m); } };
  }
};
globalThis.registerProcessor = (name, cls) => (registered[name] = cls);
const { Loop } = await import('../src/audio/worklet/carMixer.processor.js');

const sine = (n, cycles) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * cycles * i) / n));
const noise = (n, seed = 1) => {
  let a = seed;
  return Float32Array.from({ length: n }, () => ((a = (a * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1);
};

// A mixer loaded with stand-in PCM: sine loops, noise beds, a short burst per one-shot.
function mixer() {
  const P = registered[PROCESSOR];
  const p = new P();
  const loops = {};
  for (const name of LOOP_SAMPLES) loops[name] = sine(4800, 40);
  const shots = SHOT_TABLE.map(() => ({ length: 2400, sfxL: sine(2400, 20), sfxR: null, space: sine(2400, 20), tyre: null, ambience: null }));
  p.message({ type: 'load', loops, noise: noise(SR), pink: noise(SR, 7), wobble: sine(SR, 3), seams: sine(SR, 1), shots, musicTone: { open: 16000, engine: 5200 } });
  const outs = OUTPUT_CHANNELS.map((c) => Array.from({ length: c }, () => new Float32Array(128)));
  const chans = outs.flat();
  const inputs = [];
  p.run = (blocks = 1) => {
    for (let b = 0; b < blocks; b++) {
      for (let c = 0; c < chans.length; c++) chans[c].fill(0);
      p.process(inputs, outs);
    }
    return outs;
  };
  p.ctlFrame = (c, events = []) => {
    const f = new Float32Array(FRAME_LENGTH);
    for (const [k, v] of Object.entries(c)) f[CTL[k]] = v;
    f[CTL.events] = events.length;
    events.forEach(([id, gain, rate], i) => f.set([id, gain, rate], CTL.events + 1 + i * 3));
    p.message(f);
  };
  return p;
}

const sounding = (p) => p.voices.filter((v) => v.on && !v.fading).length;

test('a loop played by phase never seams, at any rate, however often it wraps', () => {
  // 40 whole cycles in 4800 samples: a seamless loop. Swept from 0.55x to 1.9x for 4 s it
  // wraps every 50-180 ms. Against the ideal sine at the same running phase, the only error
  // is linear interpolation's (at most w^2/8); a seam would be far bigger, right at a wrap.
  const n = 4800;
  const loop = new Loop(sine(n, 40), 0.55);
  loop.ph = 0;
  let phase = 0;
  let worst = 0;
  let worstAtWrap = 0;
  let wraps = 0;
  const w = (2 * Math.PI * 40) / n;
  for (let i = 0; i < SR * 4; i++) {
    loop.rate = 0.55 + (1.35 * i) / (SR * 4);
    const before = loop.ph;
    const x = loop.next();
    const wrapped = loop.ph < before;
    if (wrapped) wraps++;
    const err = Math.abs(x - Math.sin(w * phase));
    worst = Math.max(worst, err);
    if (wrapped) worstAtWrap = Math.max(worstAtWrap, err);
    phase += loop.rate;
  }
  assert.ok(wraps > 40, `${wraps} wraps`);
  assert.ok(worst <= (w * w) / 8 + 1e-6, `worst error ${worst.toExponential(2)}`);
  assert.ok(worstAtWrap <= (w * w) / 8 + 1e-6, `worst error at a wrap ${worstAtWrap.toExponential(2)}`);
});

test('driving onto grass and gravel only moves gains; nothing switches', () => {
  const p = mixer();
  p.message({ type: 'engine', on: true });
  p.ctlFrame({ speedNorm: 0.5, throttle: 1, speed: 0.6, volume: 1, mps: 30 });
  p.run(200);
  const e = p.engine;
  assert.ok(e.gravelG.idle && e.grassG.idle);
  p.ctlFrame({ speedNorm: 0.5, throttle: 1, speed: 0.6, volume: 1, mps: 30, gravel: 1 });
  // The gravel level glides in sample by sample: no step bigger than its time constant allows.
  let last = e.gravelG.v;
  let biggest = 0;
  for (let b = 0; b < 100; b++) {
    p.run();
    biggest = Math.max(biggest, e.gravelG.v - last);
    last = e.gravelG.v;
  }
  assert.ok(last > 0.05, `gravel level ${last}`);
  assert.ok(biggest < last * 0.25, 'no jump');
  p.ctlFrame({ speedNorm: 0.5, throttle: 1, speed: 0.6, volume: 1, mps: 30, grass: 1 });
  p.run(300);
  assert.ok(e.grassG.v > 0.1 && e.gravelG.v < 1e-3);
});

test('the gearbox runs on the audio thread: shifts, blow-off and crackle with no frames at all', () => {
  const p = mixer();
  p.message({ type: 'engine', on: true });
  p.ctlFrame({ speedNorm: 0, throttle: 1, volume: 1 });
  // One frame, then nothing: the engine keeps running (a stalled main thread holds the
  // controls, it does not stop the sound or the gearbox).
  p.run(375); // 1 s
  assert.ok(p.box.rpm > 3000, `revving to ${Math.round(p.box.rpm)} rpm off the line`);
  p.ctlFrame({ speedNorm: 0.7, throttle: 1, volume: 1 });
  p.run(750);
  assert.ok(p.box.gear >= 2, `in gear ${p.box.gear + 1}`);
  p.ctlFrame({ speedNorm: 0.7, throttle: 0, volume: 1 });
  p.run(400);
  const ids = new Set(p.voices.filter((v) => v.seq).map((v) => SHOT_TABLE.indexOf(SHOT_TABLE.find((s) => v.shot === p.shots[SHOT_TABLE.indexOf(s)]))));
  assert.ok(p.seq > 0, 'blow-off / crackle played');
  assert.ok(ids.size > 0);
});

test(`at most ${MAX_SHOTS} one-shots sound at once; the least important gives way`, () => {
  const p = mixer();
  const impact = SHOT_INDEX.smash;
  for (let i = 0; i < MAX_SHOTS + 2; i++) p.trigger(impact, 1, 1, 0);
  assert.equal(sounding(p), MAX_SHOTS);
  const before = p.seq;
  p.trigger(SHOT_INDEX.bump, 1, 1, 0); // detail: loses to eight impacts
  assert.equal(p.seq, before);
  p.trigger(SHOT_INDEX.lap, 1, 1, 0); // key: replaces the oldest impact, which fades out
  assert.equal(p.seq, before + 1);
  assert.equal(sounding(p), MAX_SHOTS);
  assert.ok(p.voices.some((v) => v.on && v.fading));
  p.run(40);
  assert.equal(p.voices.filter((v) => v.on).length, 0, 'all done');
});

test('one-shots fired in a frame ride in its message', () => {
  const p = mixer();
  p.message({ type: 'engine', on: true });
  p.ctlFrame({ throttle: 1, volume: 1 }, [[SHOT_INDEX.smash, 1, 1], [SHOT_INDEX.coin, 0.5, 1.2]]);
  assert.equal(sounding(p), 2);
  const coin = p.voices.find((v) => v.on && Math.abs(v.rate - 1.2) < 1e-6);
  assert.ok(coin && Math.abs(coin.gain - 0.5) < 1e-6);
});

test('the soundtrack: the intro runs into the loop, the green light drops on the next bar, the loop comes round', () => {
  const p = mixer();
  const n = SR * 10;
  // Each sample holds its own position, so the read head can be followed.
  const left = Int16Array.from({ length: n }, (_, i) => i % 32768);
  p.message({ type: 'music-data', left, right: left, gain: 1, start: 0, drop: 4, loopStart: 4.2, loopEnd: 9.2, rho: 0.4, bar: 0.5 });
  p.message({ type: 'music', cmd: 'start' });
  p.run(Math.ceil((1.1 * SR) / 128));
  const m = p.music;
  assert.ok(m.inIntro);
  p.trigger(SHOT_INDEX.go, 1, 1, 0);
  assert.equal(m.drop, 1.5 * SR, 'next bar');
  p.run(Math.ceil((0.45 * SR) / 128));
  assert.ok(!m.inIntro);
  assert.ok(m.pos >= 4 * SR && m.pos < 4.1 * SR, 'jumped to the full track');
  p.run(Math.ceil((5.3 * SR) / 128));
  assert.ok(m.pos >= 4.2 * SR && m.pos < 5 * SR, `came round (${m.pos / SR} s)`);
  p.message({ type: 'music', cmd: 'stop' });
  p.run(Math.ceil((2 * SR) / 128));
  assert.equal(p.musicOn, false);
});

test('a race block allocates nothing: no garbage collection on the audio thread', () => {
  const p = mixer();
  p.message({ type: 'engine', on: true });
  p.message({ type: 'rain', level: 0.6 });
  const left = new Int16Array(SR * 4).fill(1000);
  p.message({ type: 'music-data', left, right: left, gain: 1, start: 0, drop: 1, loopStart: 1, loopEnd: 3, rho: 0.4, bar: 0.5 });
  p.message({ type: 'music', cmd: 'start' });
  // Everything sounding: gears, drift, gravel, grass, the deck, nitro, one-shots, rain, music.
  p.ctlFrame({ speedNorm: 0.8, throttle: 1, speed: 0.8, boost: 2, skid: 0.9, slip: 0.4, gravel: 0.5, grass: 0.5, wood: 1, mps: 40, volume: 1 });
  const smash = SHOT_INDEX.smash;
  const warm = () => {
    for (let b = 0; b < 4000; b++) {
      if (b % 50 === 0) p.trigger(smash, 1, 1, 0);
      p.run();
    }
  };
  warm();
  warm();
  // A collection can still land in the window for reasons outside process() (the compiler
  // finishing in the background, the rest of the test run): one clean window of 40000 blocks
  // (107 s of audio) in three shows that process() itself makes no garbage.
  const counts = [];
  for (let attempt = 0; attempt < 3 && counts.at(-1) !== 0; attempt++) {
    const profiler = new GCProfiler();
    profiler.start();
    for (let i = 0; i < 10; i++) warm();
    counts.push(profiler.stop().statistics.length);
  }
  assert.equal(counts.at(-1), 0, `collections per 40000 blocks: ${counts.join(', ')}`);
});

test('every race one-shot has a baker, and the processor is self-contained', () => {
  const src = fs.readFileSync(new URL('../src/audio/carMixer.js', import.meta.url), 'utf8');
  const bake = src.slice(src.indexOf('const BAKE = {'), src.indexOf('};', src.indexOf('const BAKE = {')));
  for (const s of SHOTS) assert.match(bake, new RegExp(`\\n  ${s.name}: `), s.name);
  // The worklet scope has no DOM, no fetch and no Web Audio nodes.
  const proc = fs.readFileSync(new URL('../src/audio/worklet/carMixer.processor.js', import.meta.url), 'utf8');
  assert.doesNotMatch(proc, /\b(window|document|fetch|AudioContext|createGain|connect\()/);
  for (const dep of [...proc.matchAll(/from '([^']+)'/g)].map((m) => m[1])) {
    const file = fs.readFileSync(new URL(dep, new URL('../src/audio/worklet/', import.meta.url)), 'utf8');
    assert.doesNotMatch(file, /^import /m, `${dep} imports nothing`);
  }
});
