// Phases 11-12: weather presets, routes (reverse, sprints, Redwood Loop trails), the timber
// bridge, puddles, height fog, lightning, seabirds and the Chapter 1 stage table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/race/track.js';
import { Vehicle, statsToParams } from '../src/race/vehicle.js';
import { TRAIL } from '../src/race/trails.js';
import { reverseTrackDef, generatePuddles, reversePuddles, ROUTES } from '../src/race/routes.js';
import { courseFor } from '../src/race/course.js';
import { Lightning } from '../src/race/atmosphere.js';
import { flushes, SEABIRD } from '../src/race/setPieces.js';
import { heightFogFactor, HEIGHT_FOG } from '../src/render/heightFog.js';
import { WEATHER, wetGrip, PUDDLE, BLOOM_LEVELS, DEFAULT_BLOOM } from '../src/data/weather.js';
import { STAGES, TRACK_SEGMENTS } from '../src/data/career.js';
import { EMERALD_COAST } from '../src/data/tracks.js';
import { BASE_STATS } from '../src/data/catalog.js';

const track = new Track(EMERALD_COAST);
const L = track.length;
const reversed = new Track(reverseTrackDef(EMERALD_COAST, L));
const chapter1 = STAGES.filter((s) => s.stageId.startsWith('ec-'));
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ---- Weather ----

test('the three Emerald Coast weathers and the Storm finale are distinct presets', () => {
  for (const id of ['GoldenHour', 'Fog', 'Rain', 'Storm']) assert.ok(WEATHER[id], id);
  const { GoldenHour: gold, Fog: fog, Rain: rain, Storm: storm } = WEATHER;
  // Golden hour: low warm sun (long shadows), dry road.
  assert.ok(gold.sun.elevation < 0.2 && gold.wet === 0 && gold.rain === 0);
  // Morning fog: the densest mist, no rain.
  assert.ok(fog.fog.density > rain.fog.density && fog.fog.density > gold.fog.density * 4 && fog.rain === 0);
  // Rain wets the road and falls; only the storm has lightning.
  assert.ok(rain.wet >= 0.5 && rain.rain > 0 && !rain.lightning);
  assert.ok(storm.wet === 1 && storm.rain === 1 && storm.lightning);
  for (const w of Object.values(WEATHER)) assert.ok(w.fog.density < HEIGHT_FOG.maxDensity, `${w.id} keeps height fog on`);
});

test('a wet road costs grip, a puddle more, and dirt turns to mud', () => {
  assert.deepEqual(wetGrip(0), { grip: 1, driftGrip: 1, steer: 1, mud: 1 });
  const w = wetGrip(1);
  assert.ok(w.grip < 1 && w.grip > 0.8 && w.mud < w.grip && w.driftGrip > w.grip);
  assert.ok(PUDDLE.grip < w.grip && PUDDLE.drag > 0);
  assert.deepEqual(BLOOM_LEVELS, ['off', 'low', 'medium']);
  assert.ok(BLOOM_LEVELS.includes(DEFAULT_BLOOM));
});

test('height fog pools low: thicker over the sea than on a hill top at the same range', () => {
  const d = WEATHER.Fog.fog.density;
  const sea = heightFogFactor(d, 300, 1, 4);
  const hill = heightFogFactor(d, 300, 60, 60);
  const plain = 1 - Math.exp(-((d * 300) ** 2));
  assert.ok(sea > hill + 0.15, `${sea} vs ${hill}`);
  assert.ok(hill >= plain - 1e-9 && sea <= 1);
  // The garage's dense studio fog is left alone.
  assert.equal(heightFogFactor(0.045, 20, 0, 0), 1 - Math.exp(-((0.045 * 20) ** 2)));
});

// ---- Trails ----

test('both redwood trails fork off and rejoin the highway as shortcuts', () => {
  assert.equal(track.trails.length, 2);
  for (const t of track.trails) {
    assert.ok(t.length < t.s1 - t.s0, `${t.id} is shorter than the highway it cuts`);
    assert.ok(t.forkEnd > 0 && t.forkEnd < t.mergeStart && t.mergeStart < t.length);
    assert.ok(t.forkEndS > t.s0 && t.forkEndS < t.mergeStartS && t.mergeStartS < t.s1);
    // Ends sit on the highway centre line; the middle is well clear of the road.
    assert.ok(Math.abs(t.sep[0]) < 0.5 && Math.abs(t.sep[t.n - 1]) < 0.5);
    const mid = Math.abs(t.sep[Math.floor(t.n / 2)]);
    assert.ok(mid > track.halfWidth + TRAIL.half + 1.5, `${t.id} middle ${mid}`);
    // It never crosses to the other side of the highway.
    for (let i = 0; i < t.n; i++) assert.ok(t.sep[i] * t.side > -0.5, `${t.id} crosses at ${i}`);
    // Trail metres map monotonically onto highway metres.
    assert.equal(t.mainS(0), t.s0);
    assert.ok(Math.abs(t.mainS(t.length) - t.s1) < 1e-6);
    assert.ok(t.mainS(t.length / 2) > t.s0 && t.mainS(t.length / 2) < t.s1);
    // The corridor funnels from road width down to the dirt lane.
    assert.ok(t.halfWidthAt(0) > t.halfWidthAt(t.length / 2));
    assert.ok(Math.abs(t.halfWidthAt(t.length / 2) - TRAIL.half) < 1e-6);
  }
});

test('the Redwood Loop forces cars onto the trail; an open highway lets them choose', () => {
  const t = track.trails[0];
  const sMid = t.mainS(t.length / 2);
  track.forced = true;
  const f = track.routeFrame(sMid, {});
  assert.equal(f.trail, t);
  const v = new Vehicle(track, statsToParams(BASE_STATS));
  v.reset(t.s0 + 20, 0);
  assert.equal(v.trail, t);
  track.forced = false;
  assert.equal(track.routeFrame(sMid, {}).trail, null);
  const w = new Vehicle(track, statsToParams(BASE_STATS));
  w.reset(sMid, 0);
  assert.equal(w.trail, null);
});

test('dirt grips less than asphalt and kicks up as its own surface', () => {
  track.forced = true;
  const t = track.trails[1];
  const v = new Vehicle(track, statsToParams(BASE_STATS));
  v.reset(t.mainS(t.length / 2), 0);
  v.updateSurface();
  assert.ok(v.mix.dirt > 0.9, `dirt ${v.mix.dirt}`);
  assert.equal(v.surface, 'dirt');
  track.forced = false;
});

// ---- Reverse route ----

test('the reversed road runs through the same places the other way', () => {
  assert.ok(Math.abs(reversed.length - L) / L < 0.01, `${reversed.length} vs ${L}`);
  const a = track.frame(0, {});
  const b = reversed.frame(0, {});
  assert.ok(dist2(a, b) < 1, 'same start line');
  assert.ok(a.tx * b.tx + a.tz * b.tz < -0.99, 'facing the other way');
  for (const f of [0.1, 0.37, 0.62, 0.9]) {
    const p = track.frame(f * L, {});
    const q = reversed.frame((1 - f) * reversed.length, {});
    assert.ok(dist2(p, q) < 6, `fraction ${f}: ${dist2(p, q)} m apart`);
  }
  // The bridge and the trails are the same stretches of road, and the trails the same lanes.
  assert.ok(reversed.bridge && Math.abs(reversed.bridge.s1 - reversed.bridge.s0 - (track.bridge.s1 - track.bridge.s0)) < 2);
  for (let k = 0; k < 2; k++) {
    const t = track.trails[k];
    const r = reversed.trails.find((x) => Math.abs(x.length - t.length) < 5);
    assert.ok(r, `reversed ${t.id}`);
    const mid = t.frame(t.length / 2, {});
    const rmid = r.frame(r.length / 2, {});
    assert.ok(dist2(mid, rmid) < 4);
    assert.equal(r.side, -t.side);
  }
  // Ramps still rise in the direction of travel.
  for (const r of reversed.ramps) assert.ok(reversed.rampHeight(r.s0 + r.length * 0.9, (r.from + r.to) / 2) > reversed.rampHeight(r.s0 + r.length * 0.1, (r.from + r.to) / 2));
});

// ---- Bridge and puddles ----

test('the gorge bridge deck rides as timber', () => {
  assert.ok(track.bridge.s1 - track.bridge.s0 > 50);
  const v = new Vehicle(track, statsToParams(BASE_STATS));
  v.reset((track.bridge.s0 + track.bridge.s1) / 2, 0);
  v.updateSurface();
  assert.equal(v.onWood, true);
  assert.equal(v.surface, 'wood');
});

test('puddles collect on the road, clear of the bridge, ramps and trail forks', () => {
  const list = generatePuddles(track);
  assert.ok(list.length >= 15, `${list.length} puddles`);
  for (const p of list) {
    assert.ok(!track.onBridge(p.s));
    assert.ok(Math.abs(p.d) + p.r < track.halfWidth);
    for (const r of track.ramps) assert.ok(Math.abs(track.delta(r.s0, p.s)) > r.length);
  }
  track.setPuddles(list);
  track.wet = 1;
  const p = list[0];
  assert.ok(track.puddleAt(p.s, p.d) > 0);
  assert.equal(track.puddleAt(p.s, p.d + p.r * 1.5), 0);
  // Mirrored for the reversed road: the same spots in world space.
  const rev = reversePuddles(list, reversed.length);
  const a = track.frame(p.s, {});
  const b = reversed.frame(rev[0].s, {});
  const pa = { x: a.x + a.rx * p.d, z: a.z + a.rz * p.d };
  const pb = { x: b.x + b.rx * rev[0].d, z: b.z + b.rz * rev[0].d };
  assert.ok(dist2(pa, pb) < 6, `${dist2(pa, pb)}`);
  track.setPuddles([]);
  track.wet = 0;
});

// ---- Lightning and seabirds ----

test('storm lightning flickers and the thunder follows at the speed of sound', () => {
  const l = new Lightning({ seed: 3 });
  l.enabled = true;
  let first = null;
  let thunder = null;
  let peak = 0;
  for (let t = 0; t < 30 && !thunder; t += 1 / 60) {
    const e = l.update(1 / 60);
    if (e.flash > 0.05 && first === null) first = t;
    peak = Math.max(peak, e.flash);
    if (e.thunder) thunder = { t, d: e.thunder };
  }
  assert.ok(first !== null && thunder, 'a strike and its thunder within 30 s');
  assert.ok(peak > 0.2 && peak <= 1);
  assert.ok(Math.abs(thunder.t - first - thunder.d / 343) < 0.1);
  const off = new Lightning();
  for (let k = 0; k < 600; k++) assert.equal(off.update(0.05).flash, 0);
});

test('seabirds scatter only for a fast car close by', () => {
  assert.ok(flushes(10, 5, SEABIRD.speed + 5));
  assert.ok(!flushes(10, 5, SEABIRD.speed - 5));
  assert.ok(!flushes(SEABIRD.radius + 1, 0, 60));
  assert.equal(EMERALD_COAST.seabirds.length, 4);
});

// ---- Chapter 1 ----

test('Chapter 1 has 20 stages over every route type and all five modes', () => {
  assert.equal(chapter1.length, 20);
  const routes = new Set(chapter1.map((s) => TRACK_SEGMENTS[s.trackSegment].route));
  assert.deepEqual([...routes].sort(), Object.keys(ROUTES).sort());
  const modes = new Set(chapter1.map((s) => s.gameMode));
  assert.equal(modes.size, 5);
  const weathers = new Set(chapter1.map((s) => s.weatherPreset));
  for (const w of ['GoldenHour', 'Fog', 'Rain', 'Storm']) assert.ok(weathers.has(w), w);
});

test('stage 20 is the stormy Boss Duel finale', () => {
  const s = chapter1.find((x) => x.stageId === 'ec-20');
  assert.equal(s.gameMode, 'BossDuel');
  assert.equal(s.weatherPreset, 'Storm');
  assert.equal(s.rivalSet, 'coast-boss');
});

test('route segments race the distance their layout says, from a clean start', () => {
  for (const seg of Object.values(TRACK_SEGMENTS).filter((x) => x.trackId === 'emerald-coast' && x.route)) {
    const t = seg.reverse ? reversed : track;
    const stage = { stageId: seg.id, trackSegment: seg.id, gameMode: 'Classic' };
    const c = courseFor(stage, t.length);
    // Progress counts highway metres; the Redwood Loop's trails make the drive itself shorter.
    if (seg.forced) assert.ok(seg.length < c.distance * 0.97, `${seg.id} drives shorter than its highway`);
    else if (seg.length) assert.ok(Math.abs(c.distance - seg.length) / seg.length < 0.06, `${seg.id}: ${c.distance} vs ${seg.length}`);
    // Sprints never start (grid included) or finish on a trail's stretch or on the bridge.
    if (seg.layout !== 'circuit') {
      for (const s of [c.startS, t.wrapS(c.startS - 50), c.finishS]) {
        assert.ok(!t.trails.some((x) => x.covers(s)), `${seg.id} at ${s} on a trail`);
        assert.ok(!t.onBridge(s), `${seg.id} on the bridge`);
      }
    }
    assert.equal(c.reverse, Boolean(seg.reverse));
    assert.equal(c.forced, seg.route === 'redwood');
  }
});
