import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, migrate, progressOf, applyProgress } from '../src/core/saveSchema.js';
import { settleStage, nextStage, totalStars, isStageUnlocked, chapterStars } from '../src/core/career.js';
import { STAGES, CHAPTERS, MAX_STARS } from '../src/data/career.js';
import { result } from './helpers.js';

// A run that meets every objective of `stage` (all three stars).
function perfectRun(stage) {
  const r = result({ position: 1, time: 1e6, bestLap: 1e6, driftScore: 0, driftDistance: 0, airTime: 0, pulses: 0, smashes: 0 });
  for (const o of stage.objectives) {
    if (o.type === 'time') r.time = Math.min(r.time, o.seconds - 1);
    if (o.type === 'lap') r.bestLap = Math.min(r.bestLap, o.seconds - 1);
    if (o.type === 'driftDistance') r.driftDistance = Math.max(r.driftDistance, o.meters);
    if (o.type === 'driftScore') r.driftScore = Math.max(r.driftScore, o.points);
    if (o.type === 'smash') r.smashes = Math.max(r.smashes, o.count);
    if (o.type === 'airTime') r.airTime = Math.max(r.airTime, o.seconds);
    if (o.type === 'pulseNitro') r.pulses = Math.max(r.pulses, o.count);
  }
  return r;
}

// What the game does between races: save to localStorage and read it back on the next launch.
const reload = (save) => migrate(JSON.parse(JSON.stringify(save)));

test('a full campaign: stages 1 to 60 unlock in order and every star survives a reload', () => {
  let save = defaults();
  let stage = STAGES[0];
  let played = 0;
  while (stage) {
    assert.ok(isStageUnlocked(save, stage), `${stage.stageId} should be open after ${played} stages`);
    const out = settleStage(save, stage, perfectRun(stage));
    assert.equal(out.stars, 0b111, `${stage.stageId} three stars`);
    save = reload(save);
    assert.equal(save.career.stageStars[stage.index], 0b111, `${stage.stageId} stars after reload`);
    played += 1;
    stage = nextStage(stage);
  }
  assert.equal(played, STAGES.length);
  assert.equal(STAGES.length, 60);
  assert.equal(totalStars(save), MAX_STARS);
  assert.equal(save.career.unlockedStage, 60);
  for (const c of CHAPTERS) assert.equal(chapterStars(save, c.id), 60);
});

test('a worse replay never takes stars away, and stars only ever add up', () => {
  let save = defaults();
  for (const stage of STAGES.slice(0, 5)) {
    settleStage(save, stage, perfectRun(stage));
    save = reload(save);
  }
  const before = [...save.career.stageStars];
  for (const stage of STAGES.slice(0, 5)) {
    const out = settleStage(save, stage, result({ finished: false }));
    assert.equal(out.newStars, 0);
    settleStage(save, stage, result({ position: 6, time: 1e6, bestLap: 1e6, driftScore: 0, driftDistance: 0, airTime: 0, pulses: 0, smashes: 0 }));
    save = reload(save);
  }
  assert.deepEqual(save.career.stageStars, before);
  assert.equal(save.career.unlockedStage, 6);
});

test('stars round-trip through the cloud copy unchanged', () => {
  const save = defaults();
  for (const stage of STAGES.slice(0, 25)) settleStage(save, stage, perfectRun(stage));
  const other = defaults();
  applyProgress(other, JSON.parse(JSON.stringify(progressOf(save))), Date.now());
  assert.deepEqual(other.career.stageStars, save.career.stageStars);
  assert.equal(other.career.unlockedStage, save.career.unlockedStage);
});
