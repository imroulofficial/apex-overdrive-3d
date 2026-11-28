// versionCode 76: smoothness. Frame pacing and dynamic resolution (render/frameGovernor.js),
// the follow camera's frame-rate independent lag (race/chaseCamera.js lagFollow), cars drawn at
// the frame's own time (race/fixedStep.js blend), the guardrails' adaptive rows
// (race/trackMeshes.js) and the auto-quality judge against the paced rate (race/quality.js).
import './dom-stub.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FrameGovernor, GOVERNOR } from '../src/render/frameGovernor.js';
import { lagFollow, expK, FOLLOW_LAG } from '../src/race/chaseCamera.js';
import { FixedStep, STEP, LAG } from '../src/race/fixedStep.js';
import { RaceQuality } from '../src/race/quality.js';
import { adaptiveRows } from '../src/race/trackMeshes.js';
import { Track } from '../src/race/track.js';
import { TRACKS } from '../src/data/tracks.js';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

// Ticks of a screen at `hz` for `seconds`: how many frames the governor runs.
function run(gov, hz, seconds) {
  let n = 0;
  for (let i = 0; i < hz * seconds; i++) if (gov.shouldRun((i * 1000) / hz)) n++;
  return n;
}

test('pacing: a steady 30 on a 60 Hz screen (every second vsync), 60 on 60, 90 and 120 Hz screens', () => {
  assert.equal(run(new FrameGovernor({ target: 30 }), 60, 10), 300);
  assert.equal(run(new FrameGovernor({ target: 60 }), 60, 10), 600);
  assert.equal(run(new FrameGovernor({ target: 60 }), 120, 10), 600);
  assert.equal(run(new FrameGovernor({ target: 30 }), 120, 10), 300);
  // 90 Hz: 60 is not a whole divisor; the governor runs on 2 of 3 ticks at best and never more
  // than 60 a second.
  assert.ok(run(new FrameGovernor({ target: 60 }), 90, 10) <= 600);
  // The frames it runs are evenly spaced (30 FPS on 60 Hz: always two ticks apart).
  const g = new FrameGovernor({ target: 30 });
  const ran = [];
  for (let i = 0; i < 120; i++) if (g.shouldRun(i * (1000 / 60) + (i % 3) * 0.4)) ran.push(i);
  for (let k = 1; k < ran.length; k++) assert.equal(ran[k] - ran[k - 1], 2);
});

test('dynamic resolution: late frames step the scale down to the floor, calm frames bring it back', () => {
  const g = new FrameGovernor({ target: 60 });
  // A heavy stretch: every frame 22 ms (a miss at 60).
  let changes = 0;
  for (let i = 0; i < 200; i++) if (g.sample(22)) changes++;
  assert.equal(g.scale, GOVERNOR.minScale);
  assert.ok(changes >= 3);
  // Smooth again: back up in small steps, only after calm seconds.
  const before = g.scale;
  for (let i = 0; i < 60 * 2; i++) g.sample(16.7);
  assert.equal(g.scale, before, 'no step up within the calm time');
  for (let i = 0; i < 60 * 40; i++) g.sample(16.7);
  assert.equal(g.scale, 1);
  // A rare late frame (a GC) changes nothing.
  const h = new FrameGovernor({ target: 60 });
  for (let i = 0; i < 600; i++) assert.equal(h.sample(i % 60 === 0 ? 33 : 16.7), false);
  assert.equal(h.scale, 1);
});

test('dynamic resolution: a phone that misses 60 even at the lowest scale settles on a steady 30', () => {
  const g = new FrameGovernor({ target: 60 });
  for (let i = 0; i < 60 * 12 && g.target === 60; i++) g.sample(25);
  assert.equal(g.target, 30);
  assert.equal(g.scale, 1, 'a steady 30 at full scale');
  // At 30 the same phone is fine: nothing changes any more.
  for (let i = 0; i < 300; i++) assert.equal(g.sample(33.3), false);
  // Garbage in (a stall, a pause, the first frame) is ignored.
  assert.equal(g.sample(0), false);
  assert.equal(g.sample(5000), false);
});

test('auto quality judges a race against the rate it was paced at', () => {
  const q = new RaceQuality();
  for (let i = 0; i < 20; i++) q.sample(30, 30);
  assert.equal(q.slow, 0, 'a steady 30 on a low-end GPU is not slow');
  for (let i = 0; i < 20; i++) q.sample(30, 60);
  assert.equal(q.slow, 20, 'a 60 race that ran at 30 is');
  q.sample(24, 30);
  assert.equal(q.slow, 21);
});

test('follow camera: the same trail behind a moving car at 60, 30 and uneven frame rates', () => {
  const trail = (dts) => {
    let target = 0;
    let out = 0;
    for (const dt of dts) {
      const next = target + 50 * dt; // 50 m/s
      out = lagFollow(out, target, next, FOLLOW_LAG, dt);
      target = next;
    }
    return target - out;
  };
  const a = trail(Array(600).fill(1 / 60));
  const b = trail(Array(300).fill(1 / 30));
  const c = trail(Array.from({ length: 450 }, (_, i) => (i % 3 ? 1 / 60 : 1 / 30)));
  assert.ok(Math.abs(a - 50 / FOLLOW_LAG) < 1e-6, `steady trail ${a}`);
  assert.ok(Math.abs(a - b) < 1e-6 && Math.abs(a - c) < 1e-6, `${a} ${b} ${c}`);
  // The old easing trailed by a frame-time dependent distance (0.8 m apart at 50 m/s).
  const old = (dt) => (50 * dt * (1 - 12 * dt)) / (12 * dt);
  assert.ok(old(1 / 60) - old(1 / 30) > 0.8);
  // expK: the same share of the way per second whatever the frame time.
  assert.ok(Math.abs((1 - expK(1 / 60, 5)) ** 2 - (1 - expK(1 / 30, 5))) < 1e-12);
});

test('fixed step: cars drawn at the frame\'s own time (blend below 0 while the step is not due yet)', () => {
  const clock = new FixedStep();
  let simTime = 0;
  let clockTime = 0;
  for (let i = 0; i < 2000; i++) {
    const dt = (i % 2 ? 1.2 : 0.8) * STEP + (i % 7) * 0.0003;
    clockTime += dt;
    simTime += clock.frame(dt) * STEP;
    // Drawn time = sim time - blend * STEP: always the clock's time.
    assert.ok(Math.abs(simTime - clock.blend * STEP - clockTime) < 1e-9, `frame ${i}`);
    assert.ok(clock.blend >= -LAG / STEP - 1e-9 && clock.blend <= 1);
  }
});

test('guardrails: adaptive rows stay within 1 cm of the full rail and use far fewer rows', () => {
  for (const def of TRACKS) {
    const track = new Track(def);
    const d = track.fenceOffset;
    const rows = adaptiveRows(track, d, 0, track.n);
    assert.equal(rows[0], 0);
    assert.equal(rows[rows.length - 1], track.n);
    assert.ok(rows.length < track.n * 0.6, `${def.id}: ${rows.length} of ${track.n + 1} rows`);
    const f = {};
    const at = (k) => {
      track.frame(k >= track.n ? track.length : track.s[k], f);
      return [f.x + f.rx * d, f.y, f.z + f.rz * d];
    };
    for (let r = 1; r < rows.length; r++) {
      const A = at(rows[r - 1]);
      const B = at(rows[r]);
      for (let k = rows[r - 1] + 1; k < rows[r]; k++) {
        const C = at(k);
        const ab = B.map((v, i) => v - A[i]);
        const ac = C.map((v, i) => v - A[i]);
        const t = Math.max(0, Math.min(1, ac.reduce((s, v, i) => s + v * ab[i], 0) / ab.reduce((s, v) => s + v * v, 0)));
        const e = Math.hypot(...ac.map((v, i) => v - ab[i] * t));
        assert.ok(e <= 0.0101, `${def.id} row ${k}: ${e.toFixed(4)} m off`);
      }
    }
  }
});

test('race: paced frames, scale changes only while racing, no reallocation for a scale change', async () => {
  const [race, bloom] = await Promise.all([read('../src/race/Race.js'), read('../src/render/bloom.js')]);
  assert.match(race, /if \(!this\.governor\.shouldRun\(nowMs\)\) return;/);
  assert.match(race, /this\.governor\.reset\(\{ target: this\.lowEnd && autoQuality \? 30 : 60, scale: 1 \}\)/);
  assert.match(race, /if \(this\.phase === 'racing' && this\.governor\.sample\(dt \* 1000\)\) this\.applyRenderScale\(\);/);
  // setScale only stores the number; render() sets a viewport and two uniforms.
  const setScale = bloom.slice(bloom.indexOf('  setScale(scale) {'), bloom.indexOf('  setParams('));
  assert.doesNotMatch(setScale, /allocate|dispose|needsUpdate|rebuild/);
  assert.match(bloom, /T\.scene\.viewport\.set\(0, 0, vw, vh\)/);
});
