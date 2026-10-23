// The recorded car audio: the bundled sample files, their licences, the RPM layer map, and
// that the car's voices no longer synthesize tones (the graph itself is exercised by
// tools/audio/render.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_FILES } from '../src/audio/samples.js';
import { EngineVoice, LAYERS, revEngine } from '../src/audio/engine.js';
import { blowOff, crackle, nitroIgnite, race } from '../src/audio/sfx.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public/assets/audio');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tools/audio/samples.json'), 'utf8'));

test('every sample the game loads is bundled as 16-bit mono 48 kHz WAV', () => {
  let total = 0;
  for (const file of Object.values(SAMPLE_FILES)) {
    const b = fs.readFileSync(path.join(dir, file));
    total += b.length;
    assert.equal(b.toString('ascii', 0, 4), 'RIFF', file);
    assert.equal(b.readUInt16LE(22), 1, `${file} channels`);
    assert.equal(b.readUInt32LE(24), 48000, `${file} rate`);
    assert.equal(b.readUInt16LE(34), 16, `${file} bits`);
  }
  assert.ok(total < 2.5e6, `samples add ${(total / 1e6).toFixed(2)} MB to the app`);
});

test('every sample comes from a CC0 source and is credited', () => {
  const credits = fs.readFileSync(path.join(dir, 'CREDITS.md'), 'utf8');
  assert.match(credits, /CC0 1\.0/);
  const made = new Set(manifest.samples.map((s) => `${s.name}.wav`));
  for (const file of Object.values(SAMPLE_FILES)) {
    assert.ok(made.has(file), `${file} is not built by tools/audio/samples.json`);
    assert.ok(credits.includes(`\`${file}\``), `${file} missing from CREDITS.md`);
  }
  for (const s of manifest.samples) {
    const src = manifest.sources[s.source];
    assert.ok(src, `${s.name}: unknown source`);
    assert.match(src.url, /^https:\/\/bigsoundbank\.com\//, `${s.name}: only BigSoundBank (CC0) sources`);
  }
});

test('the RPM layers crossfade at equal power and stay near their recorded speed', () => {
  const smooth = (x) => x * x * (3 - 2 * x);
  const ramp = (r, [a, b]) => smooth(Math.min(1, Math.max(0, (r - a) / (b - a))));
  const weight = (L, rpm) =>
    (L.fadeIn ? Math.sin((ramp(rpm, L.fadeIn) * Math.PI) / 2) : 1) * (L.fadeOut ? Math.cos((ramp(rpm, L.fadeOut) * Math.PI) / 2) : 1);
  for (let rpm = 950; rpm <= 8100; rpm += 25) {
    const ws = LAYERS.map((L) => weight(L, rpm));
    const power = ws.reduce((s, w) => s + w * w, 0);
    assert.ok(Math.abs(power - 1) < 1e-6, `power ${power.toFixed(3)} at ${rpm} rpm`);
    LAYERS.forEach((L, i) => {
      if (ws[i] > 1e-6) {
        const rate = rpm / L.rpm;
        assert.ok(rate > 0.55 && rate < 1.9, `${L.sample} played at ${rate.toFixed(2)}x at ${rpm} rpm`);
      }
    });
  }
  // Neighbouring layers hand over in order.
  for (let i = 1; i < LAYERS.length; i++) assert.deepEqual(LAYERS[i].fadeIn, LAYERS[i - 1].fadeOut);
});

// A stand-in AudioContext that records every node made and refuses oscillators.
function fakeMix() {
  const made = [];
  const param = (value = 0) => ({ value, setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = (kind, extra = {}) => {
    const n = { kind, connect: (d) => d, disconnect() {}, start() {}, stop() {}, ...extra };
    made.push(n);
    return n;
  };
  const buffer = { duration: 1 };
  const ac = {
    currentTime: 0,
    sampleRate: 48000,
    createGain: () => node('gain', { gain: param(1) }),
    createBiquadFilter: () => node('filter', { frequency: param(), Q: param(), gain: param() }),
    createBufferSource: () => node('buffer', { playbackRate: param(1), buffer: null }),
    createStereoPanner: () => node('panner', { pan: param() }),
    createWaveShaper: () => node('shaper'),
    createOscillator: () => {
      throw new Error('the car voice made an OscillatorNode');
    },
  };
  const bus = () => node('bus', { gain: param(1) });
  const samples = { ready: Promise.resolve(), get: () => buffer };
  return { made, mix: { ac, sfx: bus(), space: bus(), ambience: bus(), samples, noise: buffer, pink: buffer, wobble: buffer, seams: buffer } };
}

test('the engine, turbo, nitro, tyre and exhaust sounds play samples, not oscillators', () => {
  const { mix, made } = fakeMix();
  const voice = new EngineVoice(mix).start(0);
  voice.set({ rpm: 5000, load: 1, boost: 0.8, tier: 2, speed: 0.8, skid: 0.9, slip: 0.4, gravel: 0.5, grass: 0.5, wood: 1, mps: 40 }, 0);
  blowOff(mix, 1, 0);
  crackle(mix, 1, 0);
  nitroIgnite(mix, 1, 0);
  nitroIgnite(mix, 2, 0);
  race.chirp(mix, 0);
  revEngine(mix, 'stab', 0);
  assert.ok(made.filter((n) => n.kind === 'buffer').length > 20);
});

test('the AudioContext is opened at the hardware rate, not a fixed one', () => {
  const src = fs.readFileSync(path.join(root, 'src/core/audio.js'), 'utf8');
  const opts = src.match(/for \(const opts of \[(.*)\]\)/);
  assert.ok(opts, 'createContext option list not found');
  assert.doesNotMatch(opts[1], /sampleRate/);
});
