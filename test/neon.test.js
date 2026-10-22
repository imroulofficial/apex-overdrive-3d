// Chapter 3 · Neon City: the night circuit, its overpasses and bridge, the stage table, the
// night weather and the Grand Finale story beats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/race/track.js';
import { reverseTrackDef, generatePuddles } from '../src/race/routes.js';
import { courseFor } from '../src/race/course.js';
import { planOverpasses, DECK_DEPTH } from '../src/race/neonPieces.js';
import { WEATHER } from '../src/data/weather.js';
import { STAGES, TRACK_SEGMENTS, chapterById } from '../src/data/career.js';
import { TRACKS } from '../src/data/tracks.js';
import { NEON_CITY } from '../src/data/neonCity.js';
import { SCENES, sceneForStage } from '../src/data/story.js';

const track = new Track(NEON_CITY);
const L = track.length;
const reversed = new Track(reverseTrackDef(NEON_CITY, L));
const chapter3 = STAGES.filter((s) => s.chapterId === 'neon-city');

test('Neon City is a built track with its own biome', () => {
  assert.ok(TRACKS.includes(NEON_CITY));
  assert.equal(NEON_CITY.id, chapterById('neon-city').trackId);
  assert.equal(NEON_CITY.biome, 'neon');
  assert.ok(L > 2800 && L < 3100, `${L} m`);
});

test('the circuit flies over the city, drops to street level and crosses the harbour', () => {
  const ys = Array.from(track.py);
  assert.ok(Math.max(...ys) > 25, 'Harbour Bridge deck');
  assert.ok(Math.min(...ys) < 2, 'Arcade District at street level');
  // Grades stay drivable.
  for (let i = 0; i < track.n; i += 5) {
    const j = (i + 5) % track.n;
    const run = (track.s[i + 5] ?? L) - track.s[i];
    assert.ok(Math.abs(track.py[j] - track.py[i]) / run < 0.09, `grade at ${track.s[i]}`);
  }
  // Water under the bridge's main span, land at the start line.
  const hb = NEON_CITY.harbourBridge;
  const mid = track.frame(((hb.from + hb.to) / 2) * L, {});
  const inWater = (x, z) => z > NEON_CITY.harbourZ(x) || (Math.abs(x) < NEON_CITY.inlet.halfWidth && z > NEON_CITY.inlet.headZ);
  assert.ok(inWater(mid.x, mid.z));
  const start = track.frame(0, {});
  assert.ok(!inWater(start.x, start.z));
});

test('overpasses clear the circuit and never cut through it', () => {
  const plans = planOverpasses(track, NEON_CITY);
  assert.equal(plans.length, NEON_CITY.overpasses.length);
  const pr = {};
  for (const o of plans) {
    assert.ok(o.deckTop - DECK_DEPTH - track.roadY(o.s0) >= 8, `${o.name} clearance`);
    assert.ok(o.to - o.from >= 120, `${o.name} span`);
    for (let u = o.from; u <= o.to; u += 4) {
      const x = o.center.x + o.dir.x * u;
      const z = o.center.z + o.dir.z * u;
      track.project(x, z, -1, pr);
      if (Math.abs(pr.d) > track.fenceOffset + o.half + 2) continue;
      // Wherever the deck is over the road it is well above it.
      assert.ok(o.deckTop - DECK_DEPTH - track.roadY(pr.s) > 6, `${o.name} at u=${u}`);
    }
  }
});

test('Chapter 3 stage segments race the distance they claim', () => {
  for (const seg of Object.values(TRACK_SEGMENTS).filter((x) => x.trackId === 'neon-city')) {
    const t = seg.reverse ? reversed : track;
    const c = courseFor({ stageId: seg.id, trackSegment: seg.id, gameMode: 'Classic' }, t.length);
    assert.ok(Math.abs(c.distance - seg.length) / seg.length < 0.03, `${seg.id}: ${c.distance} vs ${seg.length}`);
    // Sprint grids (50 m back) never sit on a jump ramp.
    if (seg.layout === 'sprint') {
      for (const s of [c.startS, t.wrapS(c.startS - 50)]) {
        for (const r of t.ramps) assert.ok(Math.abs(t.delta(r.s0, s)) > r.length + 10, `${seg.id} grid on a ramp`);
      }
    }
  }
});

test('Chapter 3: 20 night stages over every route, mode and night weather', () => {
  assert.equal(chapter3.length, 20);
  assert.deepEqual(chapter3.map((s) => s.stageId), Array.from({ length: 20 }, (_, i) => `nc-${String(i + 1).padStart(2, '0')}`));
  assert.deepEqual(chapter3.map((s) => s.number), Array.from({ length: 20 }, (_, i) => 41 + i));
  const routes = new Set(chapter3.map((s) => TRACK_SEGMENTS[s.trackSegment].route));
  assert.deepEqual([...routes].sort(), ['circuit', 'reverse', 'sprint']);
  assert.equal(new Set(chapter3.map((s) => s.gameMode)).size, 5);
  const weathers = new Set(chapter3.map((s) => s.weatherPreset));
  assert.deepEqual([...weathers].sort(), ['NeonHaze', 'NeonNight', 'NeonRain', 'NeonStorm']);
  for (const s of chapter3) assert.equal(TRACK_SEGMENTS[s.trackSegment].trackId, 'neon-city');
});

test('stage 60 is the Grand Finale against Kage in the thunderstorm', () => {
  const s = chapter3.at(-1);
  assert.equal(s.stageId, 'nc-20');
  assert.equal(s.gameMode, 'BossDuel');
  assert.equal(s.rivalSet, 'neon-boss');
  assert.equal(s.weatherPreset, 'NeonStorm');
  assert.equal(s.trackSegment, 'nc-grand-prix');
  assert.equal(WEATHER.NeonStorm.lightning, true);
  assert.ok(sceneForStage('nc-20', 'before')?.boss);
  assert.ok(sceneForStage('nc-20', 'after'));
  assert.ok(sceneForStage('nc-15', 'before'));
  assert.ok(SCENES['nc-20-after'].lines.some((l) => l.who === 'kage'));
});

test('night presets are wet and dark, with neon bloom', () => {
  for (const id of ['NeonNight', 'NeonRain', 'NeonHaze', 'NeonStorm']) {
    const w = WEATHER[id];
    assert.ok(w.sun.intensity < 0.7, `${id} moonlight`);
    assert.ok(w.wet > 0, `${id} wet`);
    assert.ok(w.bloom.threshold < 0.8, `${id} bloom`);
  }
  // Wet enough for standing water on the night circuit.
  const list = generatePuddles(track);
  assert.ok(list.length >= 15);
  for (const p of list) assert.ok(Math.abs(p.d) + p.r < track.halfWidth);
});
