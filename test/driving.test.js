// Phase 8: driving feel (drift chains, Perfect Exit, surfaces) and control schemes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DriftChain, COMBO } from '../src/race/driftChain.js';
import { surfaceMix, blendSurface, dominantSurface, SURFACES, LAYOUT } from '../src/race/surface.js';
import { rollFromGravity, tiltToSteer, TILT } from '../src/race/input.js';
import { Track, APEX_WINDOW } from '../src/race/track.js';
import { Vehicle, statsToParams, PERFECT } from '../src/race/vehicle.js';
import { EMERALD_COAST } from '../src/data/tracks.js';
import { BASE_STATS } from '../src/data/catalog.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// ---- Drift chaining ----

test('linking drifts climbs x1.0 -> x1.5 -> x2.0 -> x3.0 and caps there', () => {
  const c = new DriftChain();
  assert.equal(c.start(), null);
  assert.equal(c.multiplier, 1);
  assert.deepEqual(c.end(200), { type: 'bank', points: 200, multiplier: 1 });
  const seen = [];
  for (let i = 0; i < 4; i++) {
    c.update(0.5);
    const up = c.start();
    if (up) seen.push([up.multiplier, up.nitro]);
    c.end(100);
  }
  assert.deepEqual(seen, [[1.5, COMBO.nitroBonus[1]], [2, COMBO.nitroBonus[2]], [3, COMBO.nitroBonus[3]]]);
  assert.equal(c.multiplier, 3);
  assert.equal(c.total, 200 + 150 + 200 + 300 + 300);
});

test('the chain pays out once the link window runs out', () => {
  const c = new DriftChain();
  c.start();
  c.end(300);
  c.update(0.4);
  c.start();
  c.end(300); // x1.5
  assert.equal(c.update(COMBO.linkWindow - 0.01), null);
  assert.ok(c.linkLeft > 0);
  const done = c.update(0.05);
  assert.deepEqual(done, { type: 'chain', total: 300 + 450, links: 2, multiplier: 1.5 });
  assert.equal(c.active, false);
  // A drift after the window starts over at x1.
  c.start();
  assert.equal(c.multiplier, 1);
});

test('one long drift steps the multiplier up too', () => {
  const c = new DriftChain();
  c.start();
  let up = null;
  for (let t = 0; t < COMBO.holdStep + 0.05; t += 0.05) up = c.update(0.05) ?? up;
  assert.equal(up.multiplier, 1.5);
  assert.equal(c.end(1000).points, 1500);
});

test('a twitch does not bank or start a chain; a crash ends the chain early', () => {
  const c = new DriftChain();
  c.start();
  assert.equal(c.end(COMBO.minPoints - 1), null);
  assert.equal(c.active, false);
  c.start();
  c.end(500);
  c.update(0.2);
  c.start();
  assert.deepEqual(c.finish(), { type: 'chain', total: 500, links: 1, multiplier: 1.5 });
  assert.equal(c.finish(), null);
});

// ---- Surfaces ----

test('surface mix follows the car across asphalt, gravel and grass', () => {
  const hw = 9;
  const m = surfaceMix(hw, 0);
  assert.deepEqual([m.asphalt, m.gravel, m.grass], [1, 0, 0]);
  assert.equal(dominantSurface(surfaceMix(hw, -(hw + LAYOUT.gravel / 2 + 0.3))), 'gravel');
  const g = surfaceMix(hw, hw + LAYOUT.gravel + 1.2);
  assert.deepEqual([g.asphalt, g.gravel, g.grass], [0, 0, 1]);
  // Straddling the edge: half on the asphalt, half on the gravel.
  const e = surfaceMix(hw, hw + LAYOUT.edgeLine);
  near(e.asphalt, 0.5);
  near(e.asphalt + e.gravel + e.grass, 1);
});

test('loose surfaces grip less and slow the car', () => {
  const on = (d) => blendSurface(surfaceMix(9, d));
  const asphalt = on(0);
  const gravel = on(9 + LAYOUT.gravel / 2 + 0.3);
  const grass = on(9 + LAYOUT.gravel + 1.5);
  assert.equal(asphalt.grip, 1);
  assert.ok(asphalt.grip > gravel.grip && gravel.grip > grass.grip);
  assert.ok(asphalt.top > gravel.top && gravel.top > grass.top);
  assert.ok(grass.drag > gravel.drag && gravel.drag > 0);
  for (const s of Object.values(SURFACES)) assert.ok(s.driftGrip >= s.grip, s.id);
});

test('the car can reach the grass but not the guardrail', () => {
  const track = new Track(EMERALD_COAST);
  assert.ok(track.wallLimit > track.halfWidth + LAYOUT.gravel);
  assert.ok(track.fenceOffset > track.wallLimit + track.carHalfWidth);
});

// ---- Perfect Exit ----

test('corners are found on the Emerald Coast with an apex inside each', () => {
  const track = new Track(EMERALD_COAST);
  assert.ok(track.corners.length >= 6, `${track.corners.length} corners`);
  for (const c of track.corners) {
    assert.ok(c.radius < 200);
    assert.ok([1, -1].includes(c.dir));
    assert.equal(track.apexAt(c.apexS, c.dir), c);
    assert.equal(track.apexAt(c.apexS, -c.dir), null);
    assert.equal(track.apexAt(c.apexS + APEX_WINDOW.after + 30, c.dir)?.apexS === c.apexS, false);
  }
});

function driftAt(track, corner, s) {
  const v = new Vehicle(track, statsToParams(BASE_STATS), { skills: true });
  v.reset(s, 0);
  const f = track.frame(s, {});
  v.vel.set(f.tx * 30, f.tz * 30);
  v.drifting = true;
  v.driftDir = corner.dir;
  v.driftTime = 1.2;
  v.driftScore = 400;
  v.releaseS = s;
  return v;
}

test('releasing a drift at the apex fires a Perfect Exit burst', () => {
  const track = new Track(EMERALD_COAST);
  const c = track.corners[2];
  const v = driftAt(track, c, c.apexS);
  assert.ok(v.apexReady);
  const before = v.speed;
  const nitro = v.nitro;
  v.endDrift('release');
  assert.ok(v.events.some((e) => e.type === 'perfectExit'));
  assert.ok(v.speed - before > PERFECT.kick);
  assert.equal(v.perfectT, PERFECT.time);
  assert.equal(v.nitro, nitro + PERFECT.nitro);
});

test('no Perfect Exit away from the apex, when forced out, or for rivals', () => {
  const track = new Track(EMERALD_COAST);
  const c = track.corners[2];
  const early = driftAt(track, c, track.wrapS(c.apexS - APEX_WINDOW.before - 15));
  early.endDrift('release');
  assert.ok(!early.events.some((e) => e.type === 'perfectExit'));
  const wall = driftAt(track, c, c.apexS);
  wall.endDrift('wall');
  assert.ok(!wall.events.some((e) => e.type === 'perfectExit'));
  const rival = driftAt(track, c, c.apexS);
  rival.skills = false;
  rival.endDrift('release');
  assert.ok(!rival.events.some((e) => e.type === 'perfectExit'));
});

// ---- Tilt steering ----

test('tilt roll from gravity in both landscape orientations', () => {
  const g = 9.81;
  const level = { x: 0, y: 0, z: g }; // flat on a table
  near(rollFromGravity(level, 90), 0);
  // Landscape (screen angle 90): the device's +y points left. Turning the phone clockwise by
  // 20 degrees tips the up vector toward the screen's left.
  const a = (20 * Math.PI) / 180;
  const cw90 = { x: g * Math.cos(a), y: g * Math.sin(a), z: 0 };
  near(rollFromGravity(cw90, 90), a, 1e-9);
  // The other landscape (270) mirrors the device axes.
  const cw270 = { x: -g * Math.cos(a), y: -g * Math.sin(a), z: 0 };
  near(rollFromGravity(cw270, 270), a, 1e-9);
  // iOS reports gravity with the opposite sign.
  near(rollFromGravity({ x: -cw90.x, y: -cw90.y, z: 0 }, 90, -1), a, 1e-9);
});

test('tilt steering has a dead zone and saturates at full lock', () => {
  assert.equal(tiltToSteer(0), 0);
  assert.equal(tiltToSteer(TILT.deadzone * 0.9), 0);
  assert.equal(tiltToSteer(TILT.full * 2), 1);
  assert.equal(tiltToSteer(-TILT.full), -1);
  const half = tiltToSteer((TILT.full + TILT.deadzone) / 2);
  near(half, 0.5, 1e-9);
});

test('recovery puts a lost car back on the road facing forward and keeps its race tallies', () => {
  const track = new Track(EMERALD_COAST);
  const v = new Vehicle(track, statsToParams(BASE_STATS), { skills: true });
  v.reset(400, 0);
  const forward = v.heading;
  // Spun round, pushed into the fence, with drift distance and nitro already earned.
  v.heading += Math.PI;
  v.pos.x += 30;
  v.driftDistance = 512;
  v.proximityScore = 90;
  v.nitro = 64;
  v.recover(400, 2);
  near(Math.cos(v.heading - forward), 1, 1e-9);
  assert.equal(v.speed, 0);
  assert.equal(v.driftDistance, 512);
  assert.equal(v.proximityScore, 90);
  assert.equal(v.nitro, 64);
  assert.ok(Math.abs(v.proj.d - 2) < 0.5, `back on the road (d = ${v.proj.d.toFixed(2)})`);
});
