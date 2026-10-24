import { sampleBank } from './samples.js';

// The shared Web Audio graph. The car (engine, turbo, nitro, tyres, blow-off, exhaust pops)
// plays recorded samples bundled with the app (audio/samples.js); the HUD, race cues, the
// weather beds and the soundtrack are synthesized on the device. Nothing needs the network.
//
//   tyre screech, chirp ─ tyre bus (de-harsh, 12 kHz cut) ─┐
//   engine voice ─┐                                       │
//   race / ui sfx ─┼─ sfx bus ────────────────────────────┴┐
//                  ├─ space (slap delay) ───────────────┤
//   rain, wind, ───┴─ ambience ─ low-pass ──────────────┤
//   thunder
//   music ─ glue comp ─ duck ─ music low-pass ─ music bus ─┼─ master ─ warmth EQ ─ high-pass ─ limiter ─ trim ─ clipper ─ speakers
//
// The background sits behind the car the way a commercial racer mixes it: the ambience bus
// is damped (low-passed) so rain and wind never compete with the engine's top end, and the
// music's low-pass closes as the engine works harder (see core/audio.js), so the car owns the
// upper mids while the soundtrack keeps its weight.
//
// The output stage is built for phone speakers, and the levels are set at the source: every
// voice sums into `master` with headroom to spare, so the dynamics stages stay idle in normal
// play instead of riding the mix (a limiter doing 10 dB of gain reduction on a dense engine
// and tyre mix is itself the distortion people hear). The samples that reach the DAC never
// come near full scale: small Android speaker amps and their DSP crackle well before 0 dBFS.
//
// The mixer accepts any BaseAudioContext, so tools/audio renders the same code offline.

// Soundtrack level under the engine and effects.
export const MUSIC_LEVEL = 0.28;

// Output stage tuning, for phone speakers.
// - highpass (Hz): a 4th-order cut under what a phone speaker can play. Below it a small
//   speaker only moves air it cannot radiate; the energy still swings the cone, overdrives
//   the amplifier and sets off the phone's speaker-protection DSP (the "blown speaker" buzz),
//   and it would make the limiter pump the whole mix.
// - limiter: catches stacks only (pulse nitro over a smash over the music drop). Normal play
//   peaks around -9 dBFS into it and never reaches the threshold.
// - trim takes back DynamicsCompressorNode's automatic make-up gain (about +3.4 dB here), so
//   anything under the threshold passes at master × 0.89 and the limiter's ceiling lands near
//   -6.7 dBFS.
// - knee / ceiling: the safety clipper is linear up to `knee` (-6 dBFS), above the limiter's
//   ceiling, so it only ever rounds off the limiter's overshoot; it never exceeds `ceiling`
//   (about -3 dBFS). It runs 4x oversampled so even that rounding cannot alias.
// Ambience bus (rain, wind, thunder): the low-pass that sets it back in the space.
export const AMBIENCE = { lowpass: 3800, q: 0.55, level: 1 };
// Music low-pass, wide open in menus and closing toward `engine` Hz at full engine load.
export const MUSIC_TONE = { open: 16000, engine: 5200 };

// Mastering EQ on the whole mix, ahead of the output stage: a broad, gentle lift of the
// low-mid body (the 180-250 Hz warmth a phone speaker can still play) and a soft shelf off the
// very top, where recorded air, hiss and squeal tire the ear long before they add detail.
export const MASTER_EQ = { warmth: { freq: 215, q: 0.75, gain: 1.5 }, air: { freq: 9500, gain: -1.5 } };
// Tyre bus (drift screech, scrub, chirp): a small dip in the 3-4 kHz squeal resonance and a
// clean 4th-order Butterworth cut above 12 kHz, so a long drift stays bright but never shrill.
export const TYRE_EQ = { dip: { freq: 3500, q: 1.1, gain: -2 }, highcut: 12000 };

export const OUTPUT = {
  master: 1,
  highpass: 100,
  limiter: { threshold: -6, knee: 0, ratio: 20, attack: 0.002, release: 0.25 },
  trim: 0.6,
  knee: 0.5,
  ceiling: 0.7,
};

function compressor(ac, o) {
  const c = ac.createDynamicsCompressor();
  for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) c[k].value = o[k];
  return c;
}

// Transfer curve for the safety clipper: unity up to `knee`, then a tanh shoulder that never
// exceeds `ceiling`. WaveShaper clamps input beyond ±1 to the curve's ends, so even a wild
// overshoot stays at the ceiling.
export function softClipCurve(knee = OUTPUT.knee, ceiling = OUTPUT.ceiling, n = 1025) {
  const c = new Float32Array(n);
  const room = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= knee ? a : knee + room * Math.tanh((a - knee) / room));
  }
  return c;
}

export function createMixer(ac) {
  const master = ac.createGain();
  master.gain.value = OUTPUT.master;
  // Fourth-order Butterworth high-pass (two biquads).
  const hp1 = filter(ac, 'highpass', OUTPUT.highpass, 0.5412);
  const hp2 = filter(ac, 'highpass', OUTPUT.highpass, 1.3066);
  const limiter = compressor(ac, OUTPUT.limiter);
  const trim = ac.createGain();
  trim.gain.value = OUTPUT.trim;
  const clipper = ac.createWaveShaper();
  clipper.curve = softClipCurve();
  clipper.oversample = '4x';
  const warmth = filter(ac, 'peaking', MASTER_EQ.warmth.freq, MASTER_EQ.warmth.q);
  warmth.gain.value = MASTER_EQ.warmth.gain;
  const air = filter(ac, 'highshelf', MASTER_EQ.air.freq);
  air.gain.value = MASTER_EQ.air.gain;
  master.connect(warmth).connect(air).connect(hp1).connect(hp2).connect(limiter).connect(trim).connect(clipper).connect(ac.destination);

  const sfx = ac.createGain();
  sfx.connect(master);
  const ui = ac.createGain();
  ui.gain.value = 0.8;
  ui.connect(sfx);

  // A short stereo slap (outdoor reflections) that one-shots can send to.
  const space = ac.createGain();
  space.gain.value = 0.22;
  const dl = ac.createDelay(0.2);
  const dr = ac.createDelay(0.2);
  dl.delayTime.value = 0.067;
  dr.delayTime.value = 0.091;
  const spaceLp = ac.createBiquadFilter();
  spaceLp.type = 'lowpass';
  spaceLp.frequency.value = 3200;
  const merge = ac.createChannelMerger(2);
  space.connect(spaceLp);
  spaceLp.connect(dl).connect(merge, 0, 0);
  spaceLp.connect(dr).connect(merge, 0, 1);
  merge.connect(sfx);

  const tyre = ac.createGain();
  const dip = filter(ac, 'peaking', TYRE_EQ.dip.freq, TYRE_EQ.dip.q);
  dip.gain.value = TYRE_EQ.dip.gain;
  tyre
    .connect(dip)
    .connect(filter(ac, 'lowpass', TYRE_EQ.highcut, 0.5412))
    .connect(filter(ac, 'lowpass', TYRE_EQ.highcut, 1.3066))
    .connect(sfx);

  const ambience = ac.createGain();
  ambience.gain.value = AMBIENCE.level;
  ambience.connect(filter(ac, 'lowpass', AMBIENCE.lowpass, AMBIENCE.q)).connect(sfx);

  const music = ac.createGain();
  music.connect(master);
  const musicTone = filter(ac, 'lowpass', MUSIC_TONE.open, 0.5);
  musicTone.connect(music);
  const duck = ac.createGain();
  duck.connect(musicTone);

  const mix = {
    ac,
    master,
    sfx,
    ui,
    space,
    tyre,
    ambience,
    music,
    musicTone,
    duck,
    noise: noiseBuffer(ac, 2, 1),
    pink: pinkBuffer(ac, 3),
    wobble: wobbleBuffer(ac, 4, 11),
    seams: seamBuffer(ac),
    // Recorded samples, decoded at this context's rate (get() is null until they are ready).
    samples: sampleBank(ac),
    // The output stage, for tools/audio's meters.
    stage: { highpass: hp2, limiter, trim, clipper },
  };
  return mix;
}

// ---------------------------------------------------------------------------
// Buffers and helpers shared by the voices
// ---------------------------------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseBuffer(ac, seconds, seed) {
  const rand = mulberry32(seed);
  const buf = ac.createBuffer(1, Math.round(ac.sampleRate * seconds), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  return buf;
}

// Pink-ish noise (Paul Kellet's filter): fuller wind and airflow than white noise.
function pinkBuffer(ac, seconds) {
  const rand = mulberry32(7);
  const buf = ac.createBuffer(1, Math.round(ac.sampleRate * seconds), ac.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buf;
}

// Smooth random wander in -1..1 (interpolated points at `rate` Hz, seamless loop). Fed into
// AudioParams it gives organic pitch and level drift without a per-frame JS update.
function wobbleBuffer(ac, seconds, rate) {
  const rand = mulberry32(3);
  const n = Math.round(ac.sampleRate * seconds);
  const points = Math.round(seconds * rate);
  const vals = Array.from({ length: points }, () => rand() * 2 - 1);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const x = (i / n) * points;
    const k = Math.floor(x);
    const f = x - k;
    const a = vals[k % points];
    const b = vals[(k + 1) % points];
    const s = f * f * (3 - 2 * f);
    d[i] = a + (b - a) * s;
  }
  return buf;
}

// One second holding one smooth on-off pulse, from -1 to 1: played looping at `rate`, it is a
// gain modulator that opens `rate` times a second (the plank seams on a timber deck).
function seamBuffer(ac) {
  const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.tanh(4 * Math.sin((2 * Math.PI * i) / d.length));
  return buf;
}

const curves = new Map();
// tanh soft-clip curve, cached by drive amount.
export function saturation(drive) {
  const key = drive.toFixed(2);
  if (curves.has(key)) return curves.get(key);
  const n = 2048;
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / norm;
  }
  curves.set(key, c);
  return c;
}

export function noiseSource(mix, { buffer = mix.noise, rate = 1, loop = true } = {}) {
  const src = mix.ac.createBufferSource();
  src.buffer = buffer;
  src.loop = loop;
  src.playbackRate.value = rate;
  return src;
}

export function filter(ac, type, freq, q = 0.707) {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

export function gain(ac, value = 0) {
  const g = ac.createGain();
  g.gain.value = value;
  return g;
}

// Attack/decay envelope on a gain param. Exponential decays read as natural, so the floor is
// tiny but non-zero.
export function envelope(param, t, { attack = 0.004, peak = 1, decay = 0.2, hold = 0 }) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + attack);
  if (hold) param.setValueAtTime(peak, t + attack + hold);
  param.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
  return t + attack + hold + decay;
}

export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
