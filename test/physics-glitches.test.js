// The Phase 0 physics and road glitches (C1-C15, PHASE0-AUDIT): one test per fix so none of
// them comes back. The full in-game check is tools/qa/drive.mjs (every stage raced headless,
// glitches counted against the rendered geometry); these run the same physics in node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import './dom-stub.js';
import { Track, RAMP_SIDE, KERB, SHOULDER } from '../src/race/track.js';
import { Vehicle, statsToParams } from '../src/race/vehicle.js';
import { TRAIL } from '../src/race/trails.js';
import { AIDriver } from '../src/race/ai.js';
import { reverseTrackDef } from '../src/race/routes.js';
import { TRACKS, EMERALD_COAST, ALPINE_SUMMIT } from '../src/data/tracks.js';
import { BASE_STATS } from '../src/data/catalog.js';
import { STAGES, TRACK_SEGMENTS } from '../src/data/career.js';
import { mulberry32 } from '../src/race/noise.js';
import { boxContact, pointInBox, collideCars } from '../src/race/contact.js';
import { FixedStep, STEP, MAX_STEPS, LAG } from '../src/race/fixedStep.js';
import { capFlight, PROP_FLIGHT, SmashProps } from '../src/race/props.js';
import { buildRim, RIM_IDS } from '../src/garage/rims.js';
import { buildBridge } from '../src/race/setPieces.js';
import { buildTerrain } from '../src/race/scenery.js';

const params = statsToParams(BASE_STATS);
const both = (def) => {
  const fwd = new Track(def);
  return [fwd, new Track(reverseTrackDef(def, fwd.length))];
};
const routeName = (t) => `${t.def.id ?? t.def.name}${t.def.reversed ? ' (reverse)' : ''}`;
const steady = () => ({ steer: 0, throttle: 1, brake: false, brakePressed: false, nitroTaps: [] });

// Drives AI cars (bold ones take the trail, timid ones keep to the highway) through every
// redwood trail and calls `check(v, prev)` after each step.
function driveTrails(track, check, { seeds = [1, 2, 3], dt = 1 / 60 } = {}) {
  let onTrail = 0;
  for (const t of track.trails) {
    for (const aggression of [1.3, 0.5]) {
      for (const seed of seeds) {
        const v = new Vehicle(track, params);
        v.reset(t.s0 - 80, 0);
        const ai = new AIDriver(v, track, { aggression, skill: 0.97, rand: mulberry32(seed) });
        const ctx = { time: 0, cars: [], props: { items: [] }, racing: true, playerGap: 0, rival: null };
        const steps = Math.ceil((t.s1 - t.s0 + 200) / 25 / dt);
        for (let i = 0; i < steps; i++) {
          ctx.time = i * dt;
          const prev = { x: v.pos.x, y: v.pos.y, z: v.pos.z, vx: v.vel.x, vz: v.vel.y, air: v.airborne, trail: v.trail };
          v.step(dt, ai.update(dt, ctx), ctx.time);
          if (v.trail) onTrail += 1;
          check(v, prev, t);
        }
      }
    }
  }
  return onTrail;
}

// ---- C1: trail fork and merge launches ----

test('C1: every trail runs at the highway height through its fork and merge zones, and eases off it smoothly', () => {
  for (const def of TRACKS) {
    for (const track of both(def)) {
      for (const t of track.trails) {
        for (let i = 0; i < t.n; i++) {
          if (t.s[i] <= t.forkEnd - 8 || t.s[i] >= t.mergeStart + 8) {
            assert.ok(Math.abs(t.py[i] - t.highwayY[i]) < 0.05, `${routeName(track)} ${t.id} ls ${t.s[i].toFixed(0)}: ${t.py[i].toFixed(2)} vs highway ${t.highwayY[i].toFixed(2)}`);
          }
        }
        // No crest or dip sharp enough to throw a car at trail speeds (25-35 m/s): the grade
        // changes by under 2.5 % per metre... well under the 24 m/s² gravity at 30 m/s.
        for (let i = 1; i < t.n - 1; i++) {
          const g0 = (t.py[i] - t.py[i - 1]) / (t.s[i] - t.s[i - 1]);
          const g1 = (t.py[i + 1] - t.py[i]) / (t.s[i + 1] - t.s[i]);
          const bend = Math.abs(g1 - g0) / (t.s[i + 1] - t.s[i - 1]) * 2;
          assert.ok(bend * 30 * 30 < 24, `${routeName(track)} ${t.id} ls ${t.s[i].toFixed(0)}: vertical bend ${bend.toFixed(4)}/m`);
        }
      }
    }
  }
});

test('C1: Trail.weight blends the two roads continuously across the overlap', () => {
  const Trail = new Track(EMERALD_COAST).trails[0].constructor;
  assert.equal(Trail.weight(0, 10), 0);
  assert.equal(Trail.weight(10, 0), 1);
  assert.equal(Trail.weight(5, 5), 0.5);
  let last = Trail.weight(16, 0);
  for (let d = -8; d <= 8; d += 0.05) {
    const w = Trail.weight(Math.abs(d - 8), Math.abs(d + 8));
    assert.ok(Math.abs(w - last) < 0.03, `weight jumps at ${d.toFixed(2)}`);
    last = w;
  }
});

test('C1/C4/C6: through every fork and merge, both ways: no launch off the road, no height snap, no teleport, no corner through a fence', () => {
  for (const track of both(EMERALD_COAST)) {
    const rampAhead = (s) => track.ramps.some((r) => track.delta(r.s0, s) > -20 && track.delta(r.s0, s) < r.length + 6);
    const onTrail = driveTrails(track, (v, p) => {
      const where = `${routeName(track)} s ${v.mainProj.s.toFixed(1)}`;
      if (!p.air && v.airborne) assert.ok(rampAhead(v.mainProj.s), `${where}: took off away from a ramp (vy ${v.vy.toFixed(1)})`);
      if (!p.air && !v.airborne) {
        const run = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
        assert.ok(Math.abs(v.pos.y - p.y) < 0.25 + 0.35 * run, `${where}: grounded height snapped ${(v.pos.y - p.y).toFixed(2)} m`);
      }
      const ex = p.x + p.vx / 60;
      const ez = p.z + p.vz / 60;
      assert.ok(Math.hypot(v.pos.x - ex, v.pos.z - ez) < 1, `${where}: moved ${Math.hypot(v.pos.x - ex, v.pos.z - ez).toFixed(2)} m more than its speed`);
      if (!v.zone && !v.airborne) {
        const pr = v.proj;
        const limit = v.trail ? v.trail.wallLimitAt(pr.ls) : track.wallLimit;
        assert.ok(Math.abs(pr.d) < limit + 0.35, `${where}: ${v.trail ? 'trail' : 'highway'} d ${pr.d.toFixed(2)} past limit ${limit.toFixed(2)}`);
      }
    });
    assert.ok(onTrail > 600, `${routeName(track)}: the bold drivers took the trails`);
  }
});

test('C1: where the trail meets the highway it is the highway surface extended, so the two never sit at different heights', () => {
  for (const track of both(EMERALD_COAST)) {
    const hp = {};
    const f = {};
    for (const t of track.trails) {
      for (let ls = 0; ls <= t.length; ls += 1) {
        // Deep in a zone (the last TRAIL.profileHold metres to its edge let the grade bend).
        if (ls > t.forkEnd - TRAIL.profileHold && ls < t.mergeStart + TRAIL.profileHold) continue;
        t.frame(ls, f);
        for (let d = -t.halfWidthAt(ls); d <= t.halfWidthAt(ls); d += 1) {
          track.project(f.x + f.rx * d, f.z + f.rz * d, -1, hp);
          const main = track.roadY(hp.s);
          const trail = t.surfaceAt(ls, main);
          assert.ok(Math.abs(trail - main) < 0.08, `${routeName(track)} ${t.id} ls ${ls} d ${d}: trail ${trail.toFixed(2)} vs highway ${main.toFixed(2)}`);
        }
      }
      // Past the zones it lets go smoothly: the tie eases from 1 to 0 with no step.
      let last = t.tieAt(0);
      for (let ls = 0; ls <= t.length; ls += 0.5) {
        assert.ok(Math.abs(t.tieAt(ls) - last) < 0.05);
        last = t.tieAt(ls);
      }
    }
  }
});

// ---- C2: ramp side slopes, C11/C12 ----

test('C2: every ramp falls away to the road over its side slope, never a vertical step, both ways', () => {
  for (const def of TRACKS) {
    for (const track of both(def)) {
      for (const r of track.ramps) {
        for (const k of [0.25, 0.6, 0.98]) {
          const s = r.s0 + r.length * k;
          let last = track.rampHeight(s, r.from - RAMP_SIDE - 0.5);
          assert.equal(last, 0);
          for (let d = r.from - RAMP_SIDE - 0.5; d <= r.to + RAMP_SIDE + 0.5; d += 0.05) {
            const h = track.rampHeight(s, d);
            assert.ok(Math.abs(h - last) <= (r.height * k * 0.05) / RAMP_SIDE + 1e-6, `${routeName(track)} ramp at ${r.s0.toFixed(0)}: step of ${(h - last).toFixed(2)} m at d ${d.toFixed(2)}`);
            last = h;
          }
          assert.equal(track.rampHeight(s, r.to + RAMP_SIDE + 0.01), 0);
          assert.ok(track.onRampFace(s, (r.from + r.to) / 2));
          assert.ok(!track.onRampFace(s, r.from - RAMP_SIDE / 2));
        }
      }
    }
  }
});

test('C2: a car running up a ramp side slope leaves the lip and falls, never snapping down to the road', () => {
  for (const def of TRACKS) {
    for (const track of both(def)) {
      for (const r of track.ramps) {
        for (const d of [r.from - RAMP_SIDE / 2, r.to + RAMP_SIDE / 2]) {
          for (const speed of [30, 50]) {
            const v = new Vehicle(track, params);
            v.reset(r.s0 - 30, d);
            let worst = 0;
            for (let i = 0; i < 160; i++) {
              const pr = v.proj;
              const hd = Math.atan2(-pr.tz, pr.tx);
              v.heading = hd;
              v.vel.set(Math.cos(hd) * speed, -Math.sin(hd) * speed);
              const y = v.pos.y;
              const air = v.airborne;
              v.step(1 / 60, steady(), i / 60);
              if (!air && !v.airborne) worst = Math.max(worst, y - v.pos.y);
            }
            assert.ok(worst < 0.25, `${routeName(track)} ramp at ${r.s0.toFixed(0)} d ${d.toFixed(2)} @${speed}: grounded drop of ${worst.toFixed(2)} m in one step`);
          }
        }
      }
    }
  }
});

test('C12: the Alpine canyon ramp is lowered for the climb the other way only', () => {
  const [fwd, rev] = both(ALPINE_SUMMIT);
  const canyon = (t) => t.ramps.reduce((a, r) => (r.height > a.height || (r.length === 16 && r.from === -7.1) ? r : a));
  assert.equal(canyon(fwd).height, 2.6);
  assert.equal(canyon(rev).height, 2.2);
  // Met at full speed (68 m/s) on the climb it no longer throws a car up at 15+ m/s.
  const r = canyon(rev);
  const v = new Vehicle(rev, params);
  v.reset(r.s0 - 60, 0);
  let launch = 0;
  for (let i = 0; i < 240 && !launch; i++) {
    v.vel.set(Math.cos(v.heading) * 68, -Math.sin(v.heading) * 68);
    v.step(1 / 60, steady(), i / 60);
    if (v.airborne) launch = v.vy;
  }
  assert.ok(launch > 6 && launch < 14, `launch ${launch.toFixed(1)} m/s`);
});

test('C11: landing impact is the speed into the ground, so a jump onto a falling slope lands softer than it falls', () => {
  const [fwd] = both(ALPINE_SUMMIT);
  const r = fwd.ramps.find((x) => x.height === 2.6);
  const v = new Vehicle(fwd, params);
  v.reset(r.s0 - 60, 0);
  let landed = null;
  let fall = 0;
  for (let i = 0; i < 400 && !landed; i++) {
    v.vel.set(Math.cos(v.heading) * 66, -Math.sin(v.heading) * 66);
    const vy = v.vy;
    v.events.length = 0;
    v.step(1 / 60, steady(), i / 60);
    landed = v.events.find((e) => e.type === 'land');
    if (landed) fall = -vy;
  }
  assert.ok(landed, 'landed');
  assert.ok(fall > 16, `fell at ${fall.toFixed(1)} m/s`);
  assert.ok(landed.value < 16 && landed.value > 8, `impact ${landed.value.toFixed(1)} m/s`);
});

// ---- C3: terrain under the road and trails ----

test('C3: Emerald Coast terrain stays under the highway and every trail inside their corridors', () => {
  const track = new Track(EMERALD_COAST);
  const { sample } = buildTerrain(track, EMERALD_COAST, 'low', new THREE.MeshBasicMaterial());
  const f = {};
  for (let i = 0; i < track.n; i += 2) {
    const s = track.s[i];
    if (track.onBridge(s)) continue; // the gorge is carved out below the bridge
    track.frame(s, f);
    for (let d = -track.halfWidth - track.shoulder; d <= track.halfWidth + track.shoulder; d += 3) {
      const x = f.x + f.rx * d;
      const z = f.z + f.rz * d;
      const h = sample(x, z).h;
      assert.ok(h <= track.heightAt(s, d) + 0.03, `s ${s.toFixed(0)} d ${d}: terrain ${(h - track.heightAt(s, d)).toFixed(2)} m over the road`);
    }
  }
  for (const t of track.trails) {
    for (let ls = 0; ls <= t.length; ls += 2) {
      t.frame(ls, f);
      for (let d = -t.halfWidthAt(ls); d <= t.halfWidthAt(ls); d += 2) {
        const x = f.x + f.rx * d;
        const z = f.z + f.rz * d;
        const top = t.surfaceAt(ls, track.roadY(track.project(x, z, -1, {}).s));
        const h = sample(x, z).h;
        assert.ok(h <= top + 0.03, `${t.id} ls ${ls}: terrain ${(h - top).toFixed(2)} m over the trail`);
      }
    }
  }
});

// ---- C4: AI unstick on a trail ----

test('C4: a car put back on the road while on a trail stays on that trail', () => {
  const track = new Track(EMERALD_COAST);
  const t = track.trails[0];
  const v = new Vehicle(track, params);
  const ls = (t.forkEnd + t.mergeStart) / 2;
  v.reset(t.mainS(ls), 1, t);
  const f = t.frame(ls, {});
  assert.equal(v.trail, t);
  assert.ok(Math.hypot(v.pos.x - (f.x + f.rx), v.pos.z - (f.z + f.rz)) < 0.01);
  assert.ok(Math.abs(v.pos.y - t.heightAt(ls)) < 0.01);
});

// ---- C6: barrier walls ----

test('C6: the wall moves a car back by at most 0.3 m a step and holds a sideways car by its corners', () => {
  const track = new Track(EMERALD_COAST);
  const v = new Vehicle(track, params);
  v.reset(300, 0);
  const p = v.locate();
  // 2 m through the rail: back 0.3 m this step, never a jump.
  v.pos.x += p.rx * (track.wallLimit + 2);
  v.pos.z += p.rz * (track.wallLimit + 2);
  const q = v.locate();
  const before = q.d;
  v.wall(q, 1, track.wallLimit);
  const after = v.locate().d;
  assert.ok(Math.abs(before - after - 0.3) < 0.02, `moved ${(before - after).toFixed(2)} m`);
  // Square across the road: the nose is the reach, so the centre stops a car half-length
  // (2.3 m) inside the rail's line instead of 1 m.
  v.reset(300, 0);
  v.heading += Math.PI / 2;
  const r = v.locate();
  v.pos.x += r.rx * track.wallLimit;
  v.pos.z += r.rz * track.wallLimit;
  for (let i = 0; i < 10; i++) v.wall(v.locate(), 1, track.wallLimit);
  const d = v.locate().d;
  assert.ok(Math.abs(d - (track.wallLimit + track.carHalfWidth - v.size.halfLength)) < 0.05, `centre at ${d.toFixed(2)}`);
});

// ---- C5: car-to-car contact ----

test('C5: box contact finds the shallowest face, normal from A to B', () => {
  const c = boxContact(0, 0, 0, 2.3, 1, 4.3, 0, 0, 2.3, 1);
  assert.ok(c);
  assert.ok(Math.abs(c.depth - 0.3) < 1e-9);
  assert.ok(Math.abs(c.nx - 1) < 1e-9 && Math.abs(c.nz) < 1e-9);
  assert.equal(boxContact(0, 0, 0, 2.3, 1, 4.7, 0, 0, 2.3, 1), null);
  // Side by side: 1.8 m apart across, 2 m wide each: 0.2 m deep, normal across.
  const s = boxContact(0, 0, 0, 2.3, 1, 0, 1.8, 0, 2.3, 1);
  assert.ok(Math.abs(s.depth - 0.2) < 1e-9 && Math.abs(Math.abs(s.nz) - 1) < 1e-9);
  // T-bone: B's nose into A's flank.
  const t = boxContact(0, 0, 0, 2.3, 1, 0, 3.1, Math.PI / 2, 2.3, 1);
  assert.ok(Math.abs(t.depth - 0.2) < 1e-9);
  // Contact point: B's nose, 0.2 m into A's flank.
  assert.ok(Math.abs(t.pz - 0.8) < 0.05 && Math.abs(t.px) < 0.05, `contact at (${t.px.toFixed(2)}, ${t.pz.toFixed(2)})`);
});

test('C5: pointInBox reports the nearest side and how deep', () => {
  assert.equal(pointInBox(3, 0, 0, 0, 0, 2.3, 1), null);
  const h = pointInBox(2, 0.2, 0, 0, 0, 2.3, 1);
  assert.ok(Math.abs(h.depth - 0.3) < 1e-9 && h.nx === 1);
  const m = pointInBox(2.5, 0, 0, 0, 0, 2.3, 1, 0.3);
  assert.ok(m && Math.abs(m.depth - 0.1) < 1e-9);
});

test('C5: two cars overlapping are pushed apart along the contact normal, the same every time, without randomness', () => {
  const track = new Track(EMERALD_COAST);
  const pair = () => {
    const a = new Vehicle(track, params);
    const b = new Vehicle(track, params);
    a.reset(400, 0);
    b.reset(400, 1.5); // 0.5 m into each other side by side
    a.vel.set(Math.cos(a.heading) * 40, -Math.sin(a.heading) * 40);
    b.vel.copy(a.vel);
    const toB = { x: b.pos.x - a.pos.x, z: b.pos.z - a.pos.z };
    b.vel.x -= toB.x * 2;
    b.vel.y -= toB.z * 2; // closing at 3 m/s
    return [a, b];
  };
  const random = Math.random;
  Math.random = () => {
    throw new Error('car contact used Math.random');
  };
  try {
    const [a, b] = pair();
    for (let i = 0; i < 3; i++) collideCars(a, b);
    const c = boxContact(a.pos.x, a.pos.z, a.heading, 2.3, 1, b.pos.x, b.pos.z, b.heading, 2.3, 1);
    assert.ok(!c || c.depth < 1e-9, 'apart after the contact');
    const [a2, b2] = pair();
    for (let i = 0; i < 3; i++) collideCars(a2, b2);
    assert.deepEqual([a.pos.x, a.pos.z, a.yawRate, b.vel.x], [a2.pos.x, a2.pos.z, a2.yawRate, b2.vel.x]);
    // Side by side at the centre: no spin from a contact square on.
    assert.ok(Math.abs(a.yawRate) < 0.05 && Math.abs(b.yawRate) < 0.05);
  } finally {
    Math.random = random;
  }
});

test('C5: a deep overlap is resolved at most 0.8 m a step', () => {
  const track = new Track(EMERALD_COAST);
  const a = new Vehicle(track, params);
  const b = new Vehicle(track, params);
  a.reset(400, 0);
  b.reset(400, 0.2);
  const d0 = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
  collideCars(a, b);
  const d1 = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
  assert.ok(d1 - d0 <= 0.8 + 1e-9 && d1 - d0 > 0.5);
});

// ---- C7: props ----

test('C7: a struck prop flies at most 40 m/s along the ground and 9 m/s up', () => {
  const v = capFlight({ x: 80, y: 30, z: 0 });
  assert.ok(Math.abs(Math.hypot(v.x, v.z) - PROP_FLIGHT.maxSpeed) < 1e-9);
  assert.equal(v.y, PROP_FLIGHT.maxRise);
  const slow = capFlight({ x: 3, y: 2, z: 4 });
  assert.deepEqual([slow.x, slow.y, slow.z], [3, 2, 4]);
});

test('C7: driving through a slalom at full speed leaves no cone inside the car and none flying off faster than the cap', () => {
  const track = new Track(EMERALD_COAST);
  const props = new SmashProps(track, EMERALD_COAST, new THREE.Scene());
  const v = new Vehicle(track, params);
  const slalom = EMERALD_COAST.slaloms[0] * track.length;
  const hits = [];
  for (const d of [-3, 0, 3]) {
    v.reset(slalom - 40, d);
    props.reset();
    let inside = 0;
    for (let i = 0; i < 180; i++) {
      v.vel.set(Math.cos(v.heading) * 62, -Math.sin(v.heading) * 62);
      v.step(1 / 60, steady(), i / 60);
      props.collide(v, hits);
      props.update(1 / 60);
      let any = false;
      for (const p of props.items) {
        if (p.state === 'broken') continue;
        if (Math.hypot(p.vel.x, p.vel.z) > PROP_FLIGHT.maxSpeed + 1e-6) assert.fail(`prop at ${Math.hypot(p.vel.x, p.vel.z).toFixed(1)} m/s`);
        if (pointInBox(p.pos.x, p.pos.z, v.pos.x, v.pos.z, v.heading, v.size.halfLength, v.size.halfWidth) && Math.abs(p.pos.y - v.pos.y) < 1.2) any = true;
      }
      inside = any ? inside + 1 : 0;
      assert.ok(inside < 4, `lane ${d}: a prop stayed inside the car for ${inside} steps`);
    }
  }
});

// ---- C8: kerbs and verges ----

test('C8: the drawn ground the wheels sit on includes the kerb hump and the verge drop, and nothing on ramps or the bridge', () => {
  const track = new Track(EMERALD_COAST);
  assert.ok(track.kerbSpans.length > 4, 'kerbs on the corners');
  const k = track.kerbSpans[0];
  const s = (k.s0 + k.s1) / 2;
  const hw = track.halfWidth;
  const top = track.surfaceOffset(s, hw + 0.3);
  assert.ok(top > 0.05 && top < 0.09, `kerb top ${top.toFixed(3)}`);
  assert.ok(Math.abs(track.surfaceOffset(s, hw + KERB.profile[0][0] - 0.05)) < 0.005, 'road surface inside the kerb');
  const straight = track.ramps[0].s0 - 60;
  assert.equal(track.surfaceOffset(straight, hw + track.shoulder), SHOULDER.vergeDrop);
  assert.ok(Math.abs(track.surfaceOffset(straight, hw + SHOULDER.gravel) - SHOULDER.gravelDrop) < 1e-9);
  const r = track.ramps[1];
  assert.equal(track.surfaceOffset(r.s0 + 4, 0), 0);
  const v = new Vehicle(track, params);
  v.reset(s, hw - 1.5);
  const visual = v.visualGroundAt(0, 0);
  const physics = v.groundAt(0, 0);
  assert.ok(Math.abs(visual - physics - track.surfaceOffset(v.proj.s, v.proj.d)) < 0.01);
});

// ---- C14: bridge deck ----

test('C14: the bridge deck is closed: no plank gaps, and its edge is level with the road', () => {
  const track = new Track(EMERALD_COAST);
  const bridge = buildBridge(track, false);
  bridge.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const f = {};
  const deck = [];
  bridge.traverse((o) => o.isMesh && deck.push(o));
  const { s0, s1 } = track.bridge;
  for (let s = s0 + 1; s < s1 - 1; s += 0.35) {
    for (const d of [-(track.fenceOffset - 0.3), -4, 0, 4, track.fenceOffset - 0.3]) {
      track.frame(s, f);
      const x = f.x + f.rx * d;
      const z = f.z + f.rz * d;
      ray.set(new THREE.Vector3(x, track.roadY(s) + 3, z), down);
      const hit = ray.intersectObjects(deck, false)[0];
      assert.ok(hit, `s ${s.toFixed(1)} d ${d}: no deck under the wheel`);
      assert.ok(Math.abs(hit.point.y - track.roadY(s)) < 0.08, `s ${s.toFixed(1)} d ${d}: deck ${(hit.point.y - track.roadY(s)).toFixed(2)} m off the road height`);
    }
  }
});

// ---- C15: rims ----

test('C15: rim spokes and blades turn only about the axle; any twist is in the geometry', () => {
  for (const id of RIM_IDS) {
    for (const side of [1, -1]) {
      const rim = new THREE.Group().add(...buildRim(id, side, new THREE.MeshStandardMaterial(), 1));
      rim.traverse((o) => {
        if (!o.isMesh || o.rotation.z === 0) return;
        assert.equal(o.rotation.x, 0, `${id}: a spoke rotated about x`);
        assert.equal(o.rotation.y, 0, `${id}: a spoke rotated about y`);
      });
    }
  }
});

// ---- C10: fixed physics step ----

test('C10: the same number of 1/60 s steps per second at any frame rate from 120 to 15 fps', () => {
  for (const hz of [120, 60, 45, 30, 20, 15, 10]) {
    const clock = new FixedStep();
    let steps = 0;
    for (let i = 0; i < hz * 10; i++) {
      const n = clock.frame(1 / hz);
      assert.ok(n <= MAX_STEPS);
      steps += n;
      // v76: down to -LAG / STEP (drawn a little ahead along the last step) while no step was due.
      assert.ok(clock.blend >= -LAG / STEP - 1e-9 && clock.blend <= 1);
    }
    assert.ok(Math.abs(steps - 600) <= 1, `${hz} fps: ${steps} steps in 10 s`);
  }
  // A 60 Hz screen with jittery frame times still steps exactly once a frame.
  const clock = new FixedStep();
  for (let i = 0; i < 600; i++) assert.equal(clock.frame(i % 2 ? STEP * 1.2 : STEP * 0.8), 1);
});

test('C10: a car covers the same ground and jumps the same height at 120, 60, 30 and 15 fps', () => {
  const track = new Track(EMERALD_COAST);
  const r = track.ramps[1];
  const run = (hz) => {
    const v = new Vehicle(track, params);
    v.reset(r.s0 - 120, 0);
    const clock = new FixedStep();
    let maxH = 0;
    let steps = 0;
    while (steps < 360) {
      for (let k = clock.frame(1 / hz); k > 0 && steps < 360; k--) {
        v.step(STEP, steady(), steps * STEP);
        steps += 1;
        if (v.airborne) maxH = Math.max(maxH, v.pos.y - v.groundY);
      }
    }
    return { x: v.pos.x, z: v.pos.z, maxH };
  };
  const ref = run(60);
  for (const hz of [120, 30, 15]) {
    const o = run(hz);
    // The physics never sees the frame rate: identical, not just close.
    assert.deepEqual(o, ref, `${hz} fps`);
  }
});

// ---- C13: the Skyline Descent clock ----

test('C13: the Skyline Descent Time Trial asks for a pace the switchbacks allow', () => {
  const seg = TRACK_SEGMENTS['nc-skyline-descent'];
  const tt = STAGES.find((s) => s.gameMode === 'TimeTrial' && s.trackSegment === 'nc-skyline-descent');
  const star1 = Math.max(...tt.objectives.filter((o) => o.type === 'time').map((o) => o.seconds));
  // Rivals and the autopilot take 29-32 s for it in a race; the old 22.3 s target needed
  // 50 m/s average down the hairpins and ran out before the first checkpoint in every car.
  assert.ok(seg.length / star1 < 36, `needs ${(seg.length / star1).toFixed(1)} m/s`);
  assert.ok(star1 > 30 && star1 < 36, `star-1 ${star1.toFixed(2)} s`);
  // The rest of Neon City keeps its highway pace.
  const harbour = STAGES.find((s) => s.gameMode === 'TimeTrial' && s.trackSegment === 'nc-harbour-bridge');
  assert.equal(TRACK_SEGMENTS['nc-harbour-bridge'].pace, undefined);
  assert.ok(harbour.objectives[0].seconds < 25);
});
