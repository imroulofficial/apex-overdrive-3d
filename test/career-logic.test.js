import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../src/core/saveSchema.js';
import { settleStage, evaluateStars, meetsObjective, totalStars, isStageUnlocked, isChapterUnlocked, claimMilestone, claimableMilestones, starCount } from '../src/core/career.js';
import { STAGES, CHAPTERS } from '../src/data/career.js';
import { result } from './helpers.js';

const ec01 = STAGES[0];

test('stars are independent objectives stored as a bitmask', () => {
  const [finish, skill, mastery] = ec01.objectives;
  assert.equal(finish.type, 'position');
  assert.equal(evaluateStars(ec01, result({ position: 2, smashes: 0, bestLap: 999 })), 0b001);
  assert.equal(evaluateStars(ec01, result({ position: 5, smashes: skill.count, bestLap: 999 })), 0b010);
  assert.equal(evaluateStars(ec01, result({ position: 1, smashes: skill.count, bestLap: mastery.seconds - 1 })), 0b111);
  assert.equal(evaluateStars(ec01, result({ finished: false })), 0);
  assert.equal(starCount(0b101), 2);
});

test('objective checks', () => {
  assert.ok(meetsObjective({ type: 'position', max: 3 }, { position: 3 }));
  assert.ok(!meetsObjective({ type: 'position', max: 3 }, { position: 4 }));
  assert.ok(meetsObjective({ type: 'time', seconds: 95 }, { time: 94.99 }));
  assert.ok(!meetsObjective({ type: 'time', seconds: 95 }, { time: 95 }));
  assert.ok(!meetsObjective({ type: 'lap', seconds: 60 }, { bestLap: Infinity }));
  assert.ok(meetsObjective({ type: 'driftDistance', meters: 350 }, { driftDistance: 350 }));
  assert.ok(meetsObjective({ type: 'airTime', seconds: 3 }, { airTime: 3.2 }));
  assert.ok(meetsObjective({ type: 'pulseNitro', count: 2 }, { pulses: 2 }));
  assert.ok(!meetsObjective({ type: 'unknown' }, {}));
});

test('settling a stage pays finish + capped skill bonus + 250 per first-time star', () => {
  const save = defaults();
  const coins0 = save.coins;
  const [, skill, mastery] = ec01.objectives;
  const r = result({ position: 1, smashes: skill.count, bestLap: mastery.seconds - 1, driftScore: 99999, airTime: 30 });
  const out = settleStage(save, ec01, r);
  assert.equal(out.stars, 0b111);
  assert.equal(out.newStars, 0b111);
  assert.equal(out.coins.finish, ec01.coinReward);
  assert.equal(out.coins.skill, 300);
  assert.equal(out.coins.star, 750);
  assert.equal(out.coins.total, ec01.coinReward + 300 + 750);
  assert.equal(save.coins, coins0 + out.coins.total);
  assert.equal(save.career.stageStars[0], 7);

  // Replaying pays no star bonus again.
  const again = settleStage(save, ec01, r);
  assert.equal(again.newStars, 0);
  assert.equal(again.coins.star, 0);
  assert.equal(save.career.best['ec-01'].plays, 2);
});

test('a later run that adds one star pays only that star', () => {
  const save = defaults();
  settleStage(save, ec01, result({ position: 2, smashes: 0, bestLap: 999 }));
  assert.equal(save.career.stageStars[0], 0b001);
  const out = settleStage(save, ec01, result({ position: 6, smashes: 20, bestLap: 999 }));
  assert.equal(out.newStars, 0b010);
  assert.equal(out.coins.star, 250);
  assert.equal(save.career.stageStars[0], 0b011);
});

test('star 1 unlocks the next stage; skill stars alone do not', () => {
  const save = defaults();
  assert.ok(isStageUnlocked(save, STAGES[0]));
  assert.ok(!isStageUnlocked(save, STAGES[1]));
  settleStage(save, ec01, result({ position: 6, smashes: 20 }));
  assert.equal(save.career.unlockedStage, 1);
  const out = settleStage(save, ec01, result({ position: 3 }));
  assert.equal(out.unlocked.stageId, 'ec-02');
  assert.equal(save.career.unlockedStage, 2);
  assert.ok(isStageUnlocked(save, STAGES[1]));
  // Replaying stage 1 never moves the frontier again.
  settleStage(save, ec01, result());
  assert.equal(save.career.unlockedStage, 2);
});

test('chapter star gates hold back chapters 2 and 3', () => {
  const save = defaults();
  save.career.unlockedStage = 21; // chapter 1 boss beaten
  save.career.stageStars.fill(1, 0, 20); // 20 stars
  assert.ok(!isChapterUnlocked(save, 'alpine-summit'));
  assert.ok(!isStageUnlocked(save, STAGES[20]));
  save.career.stageStars.fill(3, 0, 15); // +15 stars = 35
  assert.equal(totalStars(save), 35);
  assert.ok(totalStars(save) >= CHAPTERS[1].starGate);
  assert.ok(isStageUnlocked(save, STAGES[20]));
  assert.ok(!isChapterUnlocked(save, 'neon-city'));
});

test('solo stages pay the full reward when the finish objective is met', () => {
  const tt = STAGES.find((s) => s.gameMode === 'TimeTrial');
  const save = defaults();
  const fast = settleStage(save, tt, result({ position: 1, total: 1, time: tt.objectives[0].seconds - 1 }));
  assert.equal(fast.coins.finish, tt.coinReward);
  const slow = settleStage(save, tt, result({ position: 1, total: 1, time: tt.objectives[0].seconds + 30 }));
  assert.equal(slow.coins.finish, 500);
});

test('the last stage never unlocks past 60', () => {
  const save = defaults();
  save.career.unlockedStage = 60;
  const last = STAGES[59];
  const out = settleStage(save, last, result({ position: 1 }));
  assert.equal(out.unlocked, null);
  assert.equal(save.career.unlockedStage, 60);
});

test('milestone chests are claimed once, per chapter', () => {
  const save = defaults();
  assert.equal(claimableMilestones(save).length, 0);
  save.career.stageStars.fill(7, 0, 5); // 15 Emerald Coast stars
  assert.deepEqual(claimableMilestones(save).map((m) => m.id), ['ec-15']);
  const coins = save.coins;
  assert.equal(claimMilestone(save, 'ec-15').coins, 1000);
  assert.equal(save.coins, coins + 1000);
  assert.equal(claimMilestone(save, 'ec-15'), null);
  assert.equal(claimMilestone(save, 'ec-30'), null);
  // Stars in another chapter do not count toward Emerald Coast chests.
  save.career.stageStars.fill(7, 20, 25);
  assert.deepEqual(claimableMilestones(save).map((m) => m.id), ['as-15']);
  assert.deepEqual(save.career.milestones, ['ec-15']);
});
