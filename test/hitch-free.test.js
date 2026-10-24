// Hitch-free racing: the long engine and tyre loops have no audible period, and nothing in
// the race loop changes the renderer (pixel ratio, render targets, shader defines) once a
// race is under way.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeLongLoop, LONG_LOOP_SECONDS } from '../src/audio/longLoop.js';
import { SAMPLE_FILES } from '../src/audio/samples.js';
import { RaceQuality } from '../src/race/quality.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RATE = 48000;

function readWav(file) {
  const b = fs.readFileSync(path.join(root, 'public/assets/audio', file));
  let o = 12;
  while (b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4);
  const n = b.readUInt32LE(o + 4) / 2;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = b.readInt16LE(o + 8 + i * 2) / 32768;
  return y;
}

// Level in dB over 25 ms windows (12.5 ms hop) of `y` played as a loop for `seconds`.
function envelope(y, seconds) {
  const n = Math.round(seconds * RATE);
  const w = Math.round(0.025 * RATE);
  const out = [];
  for (let i = 0; i + w <= n; i += w >> 1) {
    let s = 0;
    for (let k = 0; k < w; k++) s += y[(i + k) % y.length] ** 2;
    out.push(10 * Math.log10(s / w + 1e-12));
  }
  return out;
}

const sd = (e) => {
  const m = e.reduce((a, b) => a + b, 0) / e.length;
  return Math.sqrt(e.reduce((a, b) => a + (b - m) ** 2, 0) / e.length);
};

// Correlation of the level envelope with itself one `period` (seconds) later: 1 is a loop
// that repeats exactly, 0 no repetition at that period.
function periodicity(e, period) {
  const lag = Math.round(period / 0.0125);
  const m = e.reduce((a, b) => a + b, 0) / e.length;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i + lag < e.length; i++) {
    const a = e[i] - m;
    const b = e[i + lag] - m;
    ab += a * b;
    aa += a * a;
    bb += b * b;
  }
  return ab / Math.sqrt(aa * bb);
}

const LOOPS = ['engineIdle', 'engineLow', 'engineMid', 'engineHigh', 'engineTop', 'skidLight', 'skidHeavy', 'turboAir', 'nitroRush'];

test('every recorded loop is baked into a 12 s loop with no period at its old length', () => {
  for (const name of LOOPS) {
    const y = readWav(SAMPLE_FILES[name]);
    const long = bakeLongLoop(y, RATE, { seed: 3 });
    const secs = long.length / RATE;
    assert.ok(Math.abs(secs - LONG_LOOP_SECONDS) < 0.05, `${name}: ${secs.toFixed(2)} s`);
    const span = secs * 2;
    const before = envelope(y, span);
    const after = envelope(long, span);
    // The short loop repeats exactly; the long one does not at that period.
    assert.ok(periodicity(before, y.length / RATE) > 0.95, `${name}: reference loop`);
    assert.ok(periodicity(after, y.length / RATE) < 0.5, `${name}: period ${(y.length / RATE).toFixed(2)} s still shows (${periodicity(after, y.length / RATE).toFixed(2)})`);
    // No level bumps or dips at the splices: the level wanders no more than the recording's.
    assert.ok(sd(after) < sd(before) + 0.3, `${name}: level sd ${sd(before).toFixed(2)} -> ${sd(after).toFixed(2)} dB`);
    // And it closes on itself without a click.
    let maxStep = 0;
    for (let i = 1; i < y.length; i++) maxStep = Math.max(maxStep, Math.abs(y[i] - y[i - 1]));
    assert.ok(Math.abs(long[0] - long[long.length - 1]) <= maxStep, `${name}: seam step`);
  }
});

test('a baked loop keeps the pitch of its source', () => {
  // A steady 128 Hz engine-like tone (harmonics and a little noise) as a 0.5 s loop.
  const n = RATE / 2;
  const y = new Float32Array(n);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    y[i] = 0.3 * Math.sin(2 * Math.PI * 128 * t) + 0.15 * Math.sin(2 * Math.PI * 256 * t + 1) + 0.08 * Math.sin(2 * Math.PI * 384 * t + 2) + 0.02 * rand();
  }
  const long = bakeLongLoop(y, RATE, { seed: 1 });
  // The fundamental of 50 ms windows all through the baked loop, by autocorrelation.
  const f0 = (a, at) => {
    const w = Math.round(0.05 * RATE);
    const lo = Math.round(RATE / 300);
    const cs = [];
    for (let lag = lo; lag <= Math.round(RATE / 60); lag++) {
      let c = 0;
      for (let i = 0; i < w; i++) c += a[at + i] * a[at + i + lag];
      cs.push(c);
    }
    // The first peak near the strongest (not a multiple of the period).
    const max = Math.max(...cs);
    const k = cs.findIndex((c, i) => c >= 0.9 * max && c >= (cs[i - 1] ?? -Infinity) && c >= (cs[i + 1] ?? -Infinity));
    return RATE / (lo + k);
  };
  for (let at = 0; at + RATE * 0.1 < long.length; at += Math.round(RATE * 0.37)) {
    const f = f0(long, at);
    assert.ok(Math.abs(f - 128) < 2, `${f.toFixed(1)} Hz at ${(at / RATE).toFixed(2)} s`);
  }
});

test('auto quality never touches the renderer during a race, and steps between races', () => {
  globalThis.window ??= { innerWidth: 800, innerHeight: 360 };
  const calls = [];
  const renderer = { getPixelRatio: () => 2, setPixelRatio: (v) => calls.push(['pixelRatio', v]), setSize: () => calls.push(['size']) };
  const bloom = { level: 'medium', enabled: true, setLevel: (l) => ((bloom.level = l), calls.push(['bloom', l])) };
  const q = new RaceQuality();
  // A whole race at 25 FPS: far too slow, and RaceQuality only counts (it holds no renderer).
  for (let i = 0; i < 60; i++) q.sample(25);
  assert.deepEqual(calls, []);
  // Before the next countdown: the halo goes first, and stays off for later races.
  assert.equal(q.step(renderer, bloom, () => calls.push(['resize'])), true);
  assert.deepEqual(calls, [['bloom', 'low']]);
  assert.equal(q.bloomFor('medium'), 'low');
  // Another slow race: the resolution, by a quarter.
  calls.length = 0;
  for (let i = 0; i < 60; i++) q.sample(30);
  q.step(renderer, bloom, () => calls.push(['resize']));
  assert.deepEqual(calls, [['pixelRatio', 1.75], ['size'], ['resize']]);
  // A race that held its frame rate (or was too short to judge) changes nothing.
  calls.length = 0;
  for (let i = 0; i < 60; i++) q.sample(60);
  assert.equal(q.step(renderer, bloom, () => {}), false);
  for (let i = 0; i < 5; i++) q.sample(20);
  assert.equal(q.step(renderer, bloom, () => {}), false);
  assert.deepEqual(calls, []);
});

test('the race calls auto quality only from begin(), never from its frame loop', () => {
  const src = fs.readFileSync(path.join(root, 'src/race/Race.js'), 'utf8');
  const body = (name) => {
    const i = src.indexOf(`\n  ${name}(`);
    const j = src.indexOf('\n  }\n', i);
    return src.slice(i, j);
  };
  for (const fn of ['frame', 'trackPerformance', 'update']) {
    assert.doesNotMatch(body(fn), /setPixelRatio|setSize|setLevel|tuner\.step|setFxaa/, fn);
  }
  assert.match(body('begin'), /tuner\.step/);
  assert.match(body('begin'), /this\.warmUp\(\)/);
});

test('instanced shadow casters get their own depth materials, split by instance colours', async () => {
  const THREE = await import('three');
  const { unifyProgramStates } = await import('../src/render/programStates.js');
  const scene = new THREE.Scene();
  const geo = new THREE.BoxGeometry();
  const mat = new THREE.MeshStandardMaterial();
  const plain = new THREE.InstancedMesh(geo, mat, 4);
  const tinted = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial(), 4);
  tinted.setColorAt(0, new THREE.Color(1, 0, 0));
  const single = new THREE.Mesh(geo, mat);
  const quiet = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial(), 4);
  for (const o of [plain, tinted, single]) o.castShadow = true;
  scene.add(plain, tinted, single, quiet);
  unifyProgramStates(scene);
  assert.ok(plain.customDepthMaterial?.isMeshDepthMaterial);
  assert.ok(tinted.customDepthMaterial?.isMeshDepthMaterial);
  assert.notEqual(plain.customDepthMaterial, tinted.customDepthMaterial);
  assert.equal(single.customDepthMaterial, undefined);
  assert.equal(quiet.customDepthMaterial, undefined);
});
