import { bakeLongLoop } from './longLoop.js';

// Recorded samples: the engine's RPM layers, tyre screech, turbo, nitro and exhaust sounds,
// cut from CC0 field recordings by tools/audio/samples.mjs (sources and licences in
// public/assets/audio/CREDITS.md). They ship inside the app as 16-bit WAV, so the game still
// needs no network: the files are read from the bundle and decoded once, at the
// AudioContext's own rate (decodeAudioData resamples them to whatever the device runs at).

export const SAMPLE_FILES = {
  engineIdle: 'engine-idle.wav',
  engineLow: 'engine-low.wav',
  engineMid: 'engine-mid.wav',
  engineHigh: 'engine-high.wav',
  engineTop: 'engine-top.wav',
  skidLight: 'skid-light.wav',
  skidHeavy: 'skid-heavy.wav',
  chirp: 'tyre-chirp.wav',
  turboAir: 'turbo-air.wav',
  nitroRush: 'nitro-rush.wav',
  blowOff: 'blow-off.wav',
  whoosh: 'nitro-whoosh.wav',
  pop1: 'exhaust-pop-1.wav',
  pop2: 'exhaust-pop-2.wav',
};

// The loops: each is baked into a 12 s loop with no audible period once decoded
// (audio/longLoop.js). One-shots play as recorded.
export const LOOP_SAMPLES = new Set(['engineIdle', 'engineLow', 'engineMid', 'engineHigh', 'engineTop', 'skidLight', 'skidHeavy', 'turboAir', 'nitroRush']);

const BASE = `${import.meta.env?.BASE_URL ?? './'}assets/audio/`;

// Baking runs in a worker where there is one (a phone takes about half a second per loop),
// on the calling thread otherwise (tests, very old WebViews).
let baker = null;
let bakeId = 0;
const pending = new Map();
function bakeWorker() {
  if (baker !== null) return baker;
  baker = false;
  try {
    if (typeof Worker === 'undefined' || !import.meta.url) return baker;
    const w = new Worker(new URL('./bakeWorker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      pending.get(e.data.id)?.resolve(e.data.data);
      pending.delete(e.data.id);
    };
    w.onerror = () => {
      // Module workers unsupported: every waiting bake falls back to this thread.
      baker = false;
      for (const p of pending.values()) p.fallback();
      pending.clear();
    };
    baker = w;
  } catch {
    baker = false;
  }
  return baker;
}

async function bakeChannel(data, rate, seed) {
  const local = () => bakeLongLoop(data, rate, { seed });
  const w = bakeWorker();
  if (!w) return local();
  return new Promise((resolve) => {
    const id = ++bakeId;
    pending.set(id, { resolve, fallback: () => resolve(local()) });
    // A copy goes over: the decoded buffer stays usable until the long one replaces it.
    w.postMessage({ id, data: data.slice(), rate, seed });
  });
}

// The long version of a decoded loop (mono or stereo).
export async function bakeLoopBuffer(ac, buffer, seed = 1) {
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(await bakeChannel(buffer.getChannelData(c), buffer.sampleRate, seed));
  const n = Math.min(...chans.map((d) => d.length));
  const out = ac.createBuffer(buffer.numberOfChannels, n, buffer.sampleRate);
  chans.forEach((d, c) => out.getChannelData(c).set(d.subarray(0, n)));
  return out;
}

// Raw file bytes, fetched once per page; decoded buffers, once per sample rate. AudioBuffers
// are not tied to the context that decoded them, so every context at the same rate (the
// game's one live context, the preview tool's offline renders) shares them.
let files = null;
const decoded = new Map();

function fetchFiles(base) {
  files ??= Promise.all(
    Object.entries(SAMPLE_FILES).map(async ([name, file]) => {
      try {
        const res = await fetch(base + file);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return [name, await res.arrayBuffer()];
      } catch (e) {
        console.warn(`audio sample ${file} unavailable:`, e.message ?? e);
        return [name, null];
      }
    }),
  );
  return files;
}

// The bank for a context: get(name) returns the decoded AudioBuffer (a loop: its 12 s baked
// version), or null until it is ready (or if its file failed to load); ready resolves once
// every file is decoded and every loop baked. `long: false` keeps the recorded loops as they
// are (tools/audio's before/after renders).
export function sampleBank(ac, { base = BASE, long = true } = {}) {
  const rate = ac.sampleRate;
  const key = `${rate}:${long}`;
  let bank = decoded.get(key);
  if (bank) return bank;
  const buffers = new Map();
  const ready = fetchFiles(base).then((list) =>
    Promise.all(
      list.map(async ([name, bytes]) => {
        if (!bytes) return;
        try {
          // decodeAudioData detaches the bytes it is given: decode a copy.
          const buf = await ac.decodeAudioData(bytes.slice(0));
          buffers.set(name, long && LOOP_SAMPLES.has(name) ? await bakeLoopBuffer(ac, buf, [...LOOP_SAMPLES].indexOf(name) + 1) : buf);
        } catch (e) {
          console.warn(`audio sample ${name} failed to decode:`, e.message ?? e);
        }
      }),
    ),
  );
  bank = { rate, ready, get: (name) => buffers.get(name) ?? null };
  decoded.set(key, bank);
  return bank;
}

// A looping source for a sample that may still be decoding: AudioBufferSourceNode.buffer can be
// assigned once after start(), so a voice built before its samples arrive starts silent and
// comes in as soon as they do.
export function loopSource(mix, name, { rate = 1 } = {}) {
  const src = mix.ac.createBufferSource();
  src.loop = true;
  src.playbackRate.value = rate;
  const buf = mix.samples.get(name);
  if (buf) src.buffer = buf;
  else
    mix.samples.ready.then(() => {
      const b = mix.samples.get(name);
      if (b && !src.buffer) src.buffer = b;
    });
  return src;
}
