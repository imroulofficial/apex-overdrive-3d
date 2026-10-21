// The shared Web Audio graph. Every sound in the game is synthesized from oscillators, noise
// and buffers rendered on the device, so the game ships no audio files and needs no network.
//
//   engine voice ─┐
//   race / ui sfx ─┼─ sfx bus ──────────────┐
//                  └─ space (slap delay) ───┤
//   music ─ glue comp ─ duck ─ music bus ───┼─ master ─ limiter ─ speakers
//
// The mixer accepts any BaseAudioContext, so tools/audio renders the same code offline.

// Soundtrack level under the engine and effects.
export const MUSIC_LEVEL = 0.38;

export function createMixer(ac) {
  const master = ac.createGain();
  master.gain.value = 0.85;
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 14;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.18;
  master.connect(limiter).connect(ac.destination);

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

  const music = ac.createGain();
  music.connect(master);
  const duck = ac.createGain();
  duck.connect(music);

  const mix = {
    ac,
    master,
    sfx,
    ui,
    space,
    music,
    duck,
    noise: noiseBuffer(ac, 2, 1),
    pink: pinkBuffer(ac, 3),
    wobble: wobbleBuffer(ac, 4, 11),
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
