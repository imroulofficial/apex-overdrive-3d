// Chapter 2 · Alpine Summit: the pass road (hairpins, summit tunnel, glacier, canyon), black
// ice, the snow weathers, the alpine terrain and the stage table for stages 21-40.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/race/track.js';
import { Vehicle, statsToParams } from '../src/race/vehicle.js';
import { AIDriver } from '../src/race/ai.js';
import { ICE } from '../src/race/surface.js';
import { reverseTrackDef, ROUTES } from '../src/race/routes.js';
import { courseFor } from '../src/race/course.js';
import { alpineHeight } from '../src/race/alpineScenery.js';
import { TUNNEL } from '../src/race/alpineSetPieces.js';
import { WEATHER } from '../src/data/weather.js';
import { STAGES, TRACK_SEGMENTS, CHAPTERS } from '../src/data/career.js';
import { TRACKS, ALPINE_SUMMIT } from '../src/data/tracks.js';
import { BASE_STATS } from '../src/data/catalog.js';
import { mulberry32 } from '../src/race/noise.js';

const track = new Track(ALPINE_SUMMIT);
const L = track.length;
const reversed = new Track(reverseTrackDef(ALPINE_SUMMIT, L));
const chapter2 = STAGES.filter((s) => s.chapterId === 'alpine-summit');
const inTunnel = (t, s) => t.def.tunnels.some((x) => s >= x.from * t.length && s <= x.to * t.length);
const onIce = (t, s) => t.iceSpans.some((r) => s >= r.s0 - ICE.ramp && s <= r.s1);

test('the Alpine Summit track is built and races on its own scenery', () => {
  assert.ok(TRACKS.includes(ALPINE_SUMMIT));
  assert.equal(CHAPTERS.find((c) => c.id === 'alpine-summit').trackId, ALPINE_SUMMIT.id);
  assert.equal(ALPINE_SUMMIT.biome, 'alpine');
  assert.ok(L > 3100 && L < 3300, `lap ${L}`);
});

test('the road climbs a stack of hairpins and never runs into itself', () => {
  const hairpins = track.corners.filter((c) => c.radius < 32);
  assert.ok(hairpins.length >= 3, `${hairpins.length} hairpins`);
  // Stretches far apart along the road stay well apart on the ground (no crossings, room for
  // both rails and the rock between the switchback legs).
  let closest = Infinity;
  for (let i = 0; i < track.n; i += 2) {
    for (let j = i + 2; j < track.n; j += 2) {
      const along = Math.min(j - i, track.n - (j - i)) * track.spacing;
      if (along < 130) continue;
      closest = Math.min(closest, Math.hypot(track.px[i] - track.px[j], track.pz[i] - track.pz[j]));
    }
  }
  assert.ok(closest > 2 * track.fenceOffset + 20, `closest ${closest.toFixed(1)} m`);
  // A real climb, at grades a car can take flat out.
  let top = -Infinity;
  let bottom = Infinity;
  for (let i = 0; i < track.n; i++) {
    top = Math.max(top, track.py[i]);
    bottom = Math.min(bottom, track.py[i]);
    const j = (i + 5) % track.n;
    const grade = Math.abs(track.py[j] - track.py[i]) / Math.hypot(track.px[j] - track.px[i], track.pz[j] - track.pz[i]);
    assert.ok(grade < 0.12, `grade ${grade.toFixed(3)} at ${track.s[i].toFixed(0)} m`);
  }
  assert.ok(top - bottom > 80, `climbs ${(top - bottom).toFixed(0)} m`);
});

test('the summit tunnel runs under the ridge at the top of the pass', () => {
  const [t] = ALPINE_SUMMIT.tunnels;
  const natural = alpineHeight(ALPINE_SUMMIT);
  const mid = track.frame(((t.from + t.to) / 2) * L, {});
  const road = track.roadY(((t.from + t.to) / 2) * L);
  assert.ok(natural(mid.x, mid.z) > road + TUNNEL.cover, 'mountain over the bore');
  assert.ok(road >= Math.max(...track.py) - 3, 'at the summit');
  assert.ok(TUNNEL.halfWidth > track.fenceOffset + 0.5, 'rails fit inside the bore');
});

test('black ice costs grip on the glacier stretches, more in the snow', () => {
  const s = (track.iceSpans[0].s0 + track.iceSpans[0].s1) / 2;
  const grip = (level) => {
    track.iceLevel = level;
    const v = new Vehicle(track, statsToParams(BASE_STATS));
    v.reset(s, 0);
    v.updateSurface();
    return v;
  };
  const dry = grip(0);
  const noon = grip(Math.max(ALPINE_SUMMIT.iceBase, WEATHER.Midday.ice ?? 0));
  const snow = grip(WEATHER.Snowfall.ice);
  const storm = grip(WEATHER.Blizzard.ice);
  track.iceLevel = 0;
  assert.equal(dry.surface, 'asphalt');
  assert.equal(noon.surface, 'ice');
  assert.ok(dry.surf.grip > noon.surf.grip && noon.surf.grip > snow.surf.grip && snow.surf.grip >= storm.surf.grip);
  assert.ok(Math.abs(storm.surf.grip - ICE.grip) < 1e-6);
  // Drifting survives ice better than gripping does.
  assert.ok(storm.surf.driftGrip > storm.surf.grip);
  // The reversed road has its ice in the same places.
  assert.equal(reversed.iceSpans.length, track.iceSpans.length);
  for (const r of track.iceSpans) {
    const p = track.frame((r.s0 + r.s1) / 2, {});
    const q = reversed.frame(L - (r.s0 + r.s1) / 2, {});
    assert.ok(Math.hypot(p.x - q.x, p.z - q.z) < 8);
  }
});

test('an AI driver laps the pass cleanly both ways, even on full ice', () => {
  for (const t of [track, reversed]) {
    t.iceLevel = 1;
    const v = new Vehicle(t, statsToParams(BASE_STATS), { passiveNitro: 0.6 });
    v.reset(0, 0);
    const ai = new AIDriver(v, t, { aggression: 0.6, skill: 0.97, rand: mulberry32(4) });
    const ctx = { time: 0, cars: [], props: { items: [] }, racing: true, playerGap: 0, rival: null };
    const h = 1 / 120;
    let dist = 0;
    let last = v.proj.s;
    let time = 0;
    while (dist < t.length && time < 120) {
      ctx.time = time;
      v.step(h, ai.update(h, ctx), time);
      time += h;
      let ds = v.proj.s - last;
      if (ds < -t.length / 2) ds += t.length;
      if (ds > t.length / 2) ds -= t.length;
      dist += ds;
      last = v.proj.s;
    }
    t.iceLevel = 0;
    assert.ok(dist >= t.length, `${t.def.reversed ? 'reverse' : 'forward'}: ${dist.toFixed(0)} m in ${time.toFixed(0)} s`);
    assert.ok(time < 90, `lap took ${time.toFixed(1)} s`);
  }
});

test('Alpine routes race the distance they say, never starting in the tunnel or on ice', () => {
  const segs = Object.values(TRACK_SEGMENTS).filter((x) => x.trackId === 'alpine-summit');
  assert.ok(segs.length >= 7);
  for (const seg of segs) {
    const t = seg.reverse ? reversed : track;
    const c = courseFor({ stageId: seg.id, trackSegment: seg.id, gameMode: 'Classic' }, t.length);
    assert.ok(Math.abs(c.distance - seg.length) / seg.length < 0.03, `${seg.id}: ${c.distance} vs ${seg.length}`);
    if (seg.layout !== 'circuit') {
      for (const s of [c.startS, t.wrapS(c.startS - 50), c.finishS]) {
        assert.ok(!inTunnel(t, s), `${seg.id} at ${s.toFixed(0)} in the tunnel`);
        assert.ok(!onIce(t, s), `${seg.id} at ${s.toFixed(0)} on ice`);
      }
    }
  }
});

test('Chapter 2 has 20 stages over every route, all five modes and the snow', () => {
  assert.equal(chapter2.length, 20);
  assert.equal(chapter2[0].stageId, 'as-01');
  const routes = new Set(chapter2.map((s) => TRACK_SEGMENTS[s.trackSegment].route));
  for (const r of ['circuit', 'reverse', 'sprint']) assert.ok(routes.has(r) && ROUTES[r], r);
  assert.equal(new Set(chapter2.map((s) => s.gameMode)).size, 5);
  const weathers = new Set(chapter2.map((s) => s.weatherPreset));
  for (const w of ['Midday', 'Dusk', 'MountainFog', 'Snowfall', 'Blizzard']) assert.ok(weathers.has(w), w);
  const boss = chapter2.find((s) => s.stageId === 'as-20');
  assert.equal(boss.gameMode, 'BossDuel');
  assert.equal(boss.weatherPreset, 'Blizzard');
  assert.equal(boss.rivalSet, 'alpine-boss');
});

test('the snow weathers whiten the mountain and the blizzard is the worst of them', () => {
  const { MountainFog: fog, Snowfall: snow, Blizzard: bliz } = WEATHER;
  for (const w of [fog, snow, bliz]) {
    assert.ok(w.snow >= 0 && w.snow <= 1 && w.ice >= 0 && w.ice <= 1);
    assert.ok(w.snowLine > 0 && !w.lightning && w.rain === 0);
  }
  assert.ok(bliz.snow > snow.snow && snow.snow > fog.snow);
  assert.ok(bliz.snowLine < snow.snowLine && snow.snowLine < fog.snowLine);
  assert.ok(bliz.fog.density > snow.fog.density && bliz.pace < snow.pace);
});
