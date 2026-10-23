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

const BASE = `${import.meta.env?.BASE_URL ?? './'}assets/audio/`;

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

// The bank for a context: get(name) returns the decoded AudioBuffer, or null until it is
// ready (or if its file failed to load); ready resolves once every file is decoded.
export function sampleBank(ac, { base = BASE } = {}) {
  const rate = ac.sampleRate;
  let bank = decoded.get(rate);
  if (bank) return bank;
  const buffers = new Map();
  const ready = fetchFiles(base).then((list) =>
    Promise.all(
      list.map(async ([name, bytes]) => {
        if (!bytes) return;
        try {
          // decodeAudioData detaches the bytes it is given: decode a copy.
          buffers.set(name, await ac.decodeAudioData(bytes.slice(0)));
        } catch (e) {
          console.warn(`audio sample ${name} failed to decode:`, e.message ?? e);
        }
      }),
    ),
  );
  bank = { rate, ready, get: (name) => buffers.get(name) ?? null };
  decoded.set(rate, bank);
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
