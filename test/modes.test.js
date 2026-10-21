// Phase 9: game-mode rules (Time Trial clock, Elimination, slipstream, proximity), stage
// courses and the results screen's objective readouts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChronoClock, CHRONO, checkpointCount, EliminationTimer, ELIMINATION, pickEliminated, draftFactor, DRAFT, proximityFactor, PROXIMITY } from '../src/race/modes/rules.js';
import { courseFor, raceFraction, lapIndex } from '../src/race/course.js';
import { STAGES, GAME_MODES, TRACK_SEGMENTS } from '../src/data/career.js';
import { objectiveProgress, evaluateStars, settleStage } from '../src/core/career.js';
import { defaults as newSave } from '../src/core/saveSchema.js';
import { STAR_BONUS } from '../src/data/economy.js';
import { Track } from '../src/race/track.js';
import { Vehicle, statsToParams } from '../src/race/vehicle.js';
import { EMERALD_COAST } from '../src/data/tracks.js';
import { BASE_STATS } from '../src/data/catalog.js';
import { result } from './helpers.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// ---- Time Trial ----

test('chrono clock: the budget is split between the start and each checkpoint', () => {
  const c = new ChronoClock({ budget: 90, checkpoints: 2 });
  near(c.remaining, 30);
  c.tick(20);
  near(c.remaining, 10);
  near(c.checkpoint(), 30);
  near(c.remaining, 40);
  c.checkpoint();
  assert.equal(c.checkpoint(), 0, 'no more gates than were laid out');
  near(c.remaining, 70);
  assert.equal(c.gates, 2);
});

test('chrono clock: a pylon takes 1.0 s off the run time and gives it back to the countdown', () => {
  const c = new ChronoClock({ budget: 60, checkpoints: 0 });
  c.tick(10);
  const before = c.remaining;
  assert.equal(c.pylon(), CHRONO.pylonBonus);
  near(c.time, 10 - CHRONO.pylonBonus);
  near(c.remaining, before + CHRONO.pylonBonus);
  assert.equal(c.pylons, 1);
});

test('chrono clock: runs out, and stops once stopped', () => {
  const c = new ChronoClock({ budget: 20, checkpoints: 1 });
  c.tick(9.9);
  assert.equal(c.expired, false);
  c.tick(0.2);
  assert.equal(c.expired, true);
  assert.equal(c.remaining, 0);
  c.stop();
  const t = c.time;
  c.tick(5);
  assert.equal(c.time, t);
});

test('checkpoint gates scale with the run length', () => {
  assert.equal(checkpointCount(1300), 1);
  assert.equal(checkpointCount(2900), 3);
  assert.ok(checkpointCount(8700) > checkpointCount(2900));
});

// ---- Elimination ----

test('elimination timer fires every interval and counts rounds', () => {
  const t = new EliminationTimer();
  let fired = 0;
  for (let i = 0; i < ELIMINATION.interval * 60 * 3; i++) if (t.tick(1 / 60)) fired += 1;
  assert.equal(fired, 3);
  assert.equal(t.round, 4);
  assert.ok(t.secondsLeft <= ELIMINATION.interval && t.secondsLeft > 0);
});

test('last place is knocked out until one champion remains', () => {
  const field = ['a', 'b', 'c', 'd', 'e', 'player'];
  const out = [];
  let alive = [...field];
  while (alive.length > 1) {
    const gone = pickEliminated(alive);
    out.push([gone, alive.length]); // knocked out in place = field size at that moment
    alive = alive.filter((x) => x !== gone);
  }
  assert.deepEqual(out, [['player', 6], ['e', 5], ['d', 4], ['c', 3], ['b', 2]]);
  assert.equal(pickEliminated(['a']), null, 'the champion is never knocked out');
  // Six cars need five knock-outs: 100 s of racing.
  assert.equal((field.length - 1) * ELIMINATION.interval, 100);
});

// ---- Slipstream and proximity ----

test('slipstream is strongest right behind and fades with distance and offset', () => {
  assert.equal(draftFactor(-5, 0, 40), 0, 'no tow from a car behind');
  assert.equal(draftFactor(DRAFT.range + 1, 0, 40), 0);
  assert.equal(draftFactor(10, DRAFT.width, 40), 0);
  assert.equal(draftFactor(10, 0, DRAFT.minSpeed - 1), 0, 'no tow at low speed');
  assert.ok(draftFactor(5, 0, 40) > draftFactor(20, 0, 40));
  assert.ok(draftFactor(10, 0, 40) > draftFactor(10, 1.5, 40));
  assert.ok(draftFactor(3, 0, 40) <= 1);
});

test('proximity bonus ramps up inside the band next to the rail', () => {
  const wall = 12;
  assert.equal(proximityFactor(0, wall), 0);
  assert.equal(proximityFactor(wall - PROXIMITY.band, wall), 0);
  near(proximityFactor(wall, wall), 1);
  near(proximityFactor(-wall, wall), 1, 1e-9);
  assert.ok(proximityFactor(wall - 0.5, wall) > proximityFactor(wall - 1.5, wall));
});

test('drifting along the rail earns proximity points only in Drift Touge', () => {
  const track = new Track(EMERALD_COAST);
  const run = (proximity) => {
    const v = new Vehicle(track, statsToParams(BASE_STATS), { skills: true });
    v.reset(400, track.wallLimit - 0.6);
    v.proximity = proximity;
    const fx = Math.cos(v.heading);
    const fz = -Math.sin(v.heading);
    v.vel.set(fx * 32, fz * 32);
    const input = { steer: 0.6, throttle: 1, brake: true, brakePressed: true, nitroTaps: [] };
    let score = 0;
    for (let i = 0; i < 40; i++) {
      v.step(1 / 60, input, i / 60);
      input.brakePressed = false;
      score = Math.max(score, v.driftScore);
    }
    return { score, bonus: v.proximityScore };
  };
  const plain = run(false);
  const touge = run(true);
  assert.ok(plain.score > 0, 'the car drifted');
  assert.equal(plain.bonus, 0);
  assert.ok(touge.bonus > 0, 'proximity points were earned');
  assert.ok(touge.score > plain.score);
});

// ---- Courses ----

test('every stage maps to a course on its track', () => {
  const L = 2802;
  for (const s of STAGES) {
    const c = courseFor(s, L);
    const seg = TRACK_SEGMENTS[s.trackSegment];
    assert.equal(c.solo, GAME_MODES[s.gameMode].solo, s.stageId);
    assert.ok(c.startS >= 0 && c.startS < L, s.stageId);
    if (s.gameMode === 'Elimination') {
      assert.equal(c.distance, Infinity, s.stageId);
      assert.equal(c.finishS, null);
    } else if (seg.layout === 'circuit') {
      near(c.distance, seg.laps * L);
      assert.equal(c.laps, seg.laps);
    } else {
      near(c.distance, (seg.to - seg.from) * L, 1e-6);
      near(c.finishS, (seg.to * L) % L, 1e-6);
    }
  }
});

test('course progress and laps', () => {
  const stage = STAGES.find((s) => s.trackSegment === 'ec-cliffside-run');
  const c = courseFor(stage, 1000);
  near(c.startS, 400);
  near(c.distance, 550);
  near(raceFraction(275, c, 1000), 0.5);
  assert.equal(raceFraction(-14, c, 1000), 0);
  assert.equal(lapIndex(-14, 1000), -1);
  assert.equal(lapIndex(1999, 1000), 1);
  const ko = courseFor(STAGES.find((s) => s.gameMode === 'Elimination'), 1000);
  near(raceFraction(1250, ko, 1000), 0.25);
});

// ---- Results ----

test('objective readouts show what the run achieved', () => {
  const r = result({ position: 2, time: 65.4, driftDistance: 412, driftScore: 5120, smashes: 7, airTime: 2.34, pulses: 1 });
  const p = (o) => objectiveProgress(o, r);
  assert.deepEqual(p({ type: 'position', max: 3 }), { label: 'Finish Top 3', value: '2nd', met: true });
  assert.deepEqual(p({ type: 'time', seconds: 65 }), { label: 'Finish under 1:05.00', value: '1:05.40', met: false });
  assert.equal(p({ type: 'driftDistance', meters: 350 }).value, '412 m');
  assert.equal(p({ type: 'driftScore', points: 5000 }).value, '5,120');
  assert.equal(p({ type: 'airTime', seconds: 3 }).value, '2.3 s');
  assert.equal(objectiveProgress({ type: 'time', seconds: 90 }, { ...r, finished: false }).value, 'DNF');
  assert.equal(objectiveProgress({ type: 'position', max: 1 }, { ...r, total: 1 }).value, '—');
});

test('a timed-out Time Trial earns no stars but keeps its skill bonus', () => {
  const save = newSave();
  const stage = STAGES.find((s) => s.gameMode === 'TimeTrial');
  save.career.unlockedStage = stage.number;
  const out = settleStage(save, stage, result({ finished: false, total: 1, position: 1, smashes: 9 }));
  assert.equal(out.stars, 0);
  assert.equal(out.coins.finish, 0);
  assert.ok(out.coins.skill > 0);
  assert.equal(save.career.stageStars[stage.index], 0);
});

test('each mode\'s first star follows its objective, and first-time stars pay once', () => {
  const save = newSave();
  save.career.unlockedStage = 60;
  const byMode = (m) => STAGES.find((s) => s.gameMode === m);
  // Drift Touge: star 1 is the score threshold.
  const touge = byMode('DriftTouge');
  const t1 = touge.objectives[0].points;
  assert.equal(evaluateStars(touge, result({ driftScore: t1 - 1 })) & 1, 0);
  assert.equal(evaluateStars(touge, result({ driftScore: t1 })) & 1, 1);
  // Elimination: top 3 is star 1, champion is star 3.
  const ko = byMode('Elimination');
  assert.equal(evaluateStars(ko, result({ position: 3, smashes: 0, driftDistance: 0, airTime: 0, pulses: 0 })), 0b001);
  assert.equal(evaluateStars(ko, result({ position: 1, smashes: 0, driftDistance: 0, airTime: 0, pulses: 0 })), 0b101);
  // Boss Duel: only a win earns star 1.
  const boss = byMode('BossDuel');
  assert.equal(evaluateStars(boss, result({ position: 2, total: 2 })) & 1, 0);
  const first = settleStage(save, boss, result({ position: 1, total: 2, time: 1, bestLap: 1, driftDistance: 9999 }));
  assert.equal(first.newStars, 0b111);
  assert.equal(first.coins.star, 3 * STAR_BONUS);
  const again = settleStage(save, boss, result({ position: 1, total: 2, time: 1, bestLap: 1, driftDistance: 9999 }));
  assert.equal(again.newStars, 0);
  assert.equal(again.coins.star, 0);
});
