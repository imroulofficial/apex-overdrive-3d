import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, CHAPTERS, TRACK_SEGMENTS, GAME_MODES, WEATHER, MILESTONES, MAX_STARS, OBJECTIVE_TYPES, stageById, describeObjective } from '../src/data/career.js';
import { RIVAL_SETS, rivalById } from '../src/data/rivals.js';
import { FINISH_REWARD } from '../src/data/economy.js';

test('60 launch stages across 3 chapters of 15-20 stages', () => {
  assert.equal(STAGES.length, 60);
  assert.deepEqual(CHAPTERS.map((c) => c.name), ['Emerald Coast', 'Alpine Summit', 'Neon City']);
  for (const c of CHAPTERS) {
    const n = STAGES.filter((s) => s.chapterId === c.id).length;
    assert.ok(n >= 15 && n <= 20, `${c.id} has ${n} stages`);
  }
  assert.equal(MAX_STARS, 180);
});

test('stage ids, indices and numbers are unique and ordered', () => {
  assert.equal(new Set(STAGES.map((s) => s.stageId)).size, STAGES.length);
  STAGES.forEach((s, i) => {
    assert.equal(s.index, i);
    assert.equal(s.number, i + 1);
    assert.equal(stageById(s.stageId), s);
  });
  assert.equal(STAGES[0].stageId, 'ec-01');
  assert.equal(STAGES[20].stageId, 'as-01');
  assert.equal(STAGES[59].stageId, 'nc-20');
});

test('every stage defines the full stage model', () => {
  for (const s of STAGES) {
    for (const key of ['stageId', 'chapterId', 'trackSegment', 'gameMode', 'weatherPreset', 'rivalSet', 'coinReward', 'objectives']) {
      assert.ok(s[key] !== undefined, `${s.stageId} missing ${key}`);
    }
    assert.ok(TRACK_SEGMENTS[s.trackSegment], `${s.stageId} segment`);
    assert.equal(TRACK_SEGMENTS[s.trackSegment].trackId, CHAPTERS.find((c) => c.id === s.chapterId).trackId);
    assert.ok(GAME_MODES[s.gameMode]);
    assert.ok(WEATHER[s.weatherPreset]);
    assert.ok(RIVAL_SETS[s.rivalSet]);
    for (const id of RIVAL_SETS[s.rivalSet].rivals) assert.ok(rivalById(id), `rival ${id}`);
  }
});

test('all five modes and every weather preset are used', () => {
  assert.deepEqual(new Set(STAGES.map((s) => s.gameMode)), new Set(['Classic', 'TimeTrial', 'DriftTouge', 'Elimination', 'BossDuel']));
  assert.deepEqual(new Set(STAGES.map((s) => s.weatherPreset)), new Set(Object.keys(WEATHER)));
});

test('each chapter ends in a boss duel against its regional boss', () => {
  for (const c of CHAPTERS) {
    const stages = STAGES.filter((s) => s.chapterId === c.id);
    const last = stages.at(-1);
    assert.equal(last.gameMode, 'BossDuel');
    assert.deepEqual(RIVAL_SETS[last.rivalSet].rivals, [c.boss]);
    assert.equal(stages.filter((s) => s.gameMode === 'BossDuel').length, 1);
  }
});

test('3-star matrix: finish, skill, mastery', () => {
  const finish = new Set(['position', 'time', 'driftScore']);
  const skill = new Set(['driftDistance', 'smash', 'airTime', 'pulseNitro']);
  const mastery = new Set(['time', 'lap', 'driftScore', 'position']);
  for (const s of STAGES) {
    assert.equal(s.objectives.length, 3);
    const [a, b, c] = s.objectives;
    assert.ok(finish.has(a.type), `${s.stageId} star 1 ${a.type}`);
    assert.ok(skill.has(b.type), `${s.stageId} star 2 ${b.type}`);
    assert.ok(mastery.has(c.type), `${s.stageId} star 3 ${c.type}`);
    for (const o of s.objectives) {
      assert.ok(OBJECTIVE_TYPES.includes(o.type));
      assert.ok(describeObjective(o).length > 3);
      const value = o.max ?? o.seconds ?? o.meters ?? o.points ?? o.count;
      assert.ok(Number.isFinite(value) && value > 0, `${s.stageId} ${o.type} target`);
    }
    // Mastery is always at least as hard as the finish objective of the same kind.
    if (a.type === c.type && a.type === 'time') assert.ok(c.seconds < a.seconds);
    if (a.type === c.type && a.type === 'driftScore') assert.ok(c.points > a.points);
    if (a.type === c.type && a.type === 'position') assert.ok(c.max <= a.max);
  }
});

test('objective descriptions read like the blueprint', () => {
  assert.equal(describeObjective({ type: 'position', max: 3 }), 'Finish Top 3');
  assert.equal(describeObjective({ type: 'driftDistance', meters: 350 }), 'Drift 350 m');
  assert.equal(describeObjective({ type: 'smash', count: 5 }), 'Smash 5 props');
  assert.equal(describeObjective({ type: 'time', seconds: 95 }), 'Finish under 1:35.00');
});

test('coin rewards sit in the 500-1,500 band and rise through the career', () => {
  for (const s of STAGES) assert.ok(s.coinReward >= FINISH_REWARD.min && s.coinReward <= FINISH_REWARD.max, `${s.stageId} ${s.coinReward}`);
  assert.equal(STAGES[0].coinReward, 500);
  assert.equal(STAGES.at(-1).coinReward, 1500);
  const regular = STAGES.filter((s) => s.gameMode !== 'BossDuel');
  for (let i = 1; i < regular.length; i++) assert.ok(regular[i].coinReward >= regular[i - 1].coinReward);
});

test('solo modes race nobody, race modes have rivals', () => {
  for (const s of STAGES) {
    const n = RIVAL_SETS[s.rivalSet].rivals.length;
    if (GAME_MODES[s.gameMode].solo) assert.equal(n, 0);
    else assert.ok(n >= 1);
  }
});

test('chapter star gates are reachable from earlier chapters', () => {
  let available = 0;
  for (const c of CHAPTERS) {
    assert.ok(c.starGate <= available, `${c.id} gate ${c.starGate} > ${available}`);
    available += STAGES.filter((s) => s.chapterId === c.id).length * 3;
  }
});

test('milestone chests: four per chapter, ordered, unique and reachable', () => {
  assert.equal(new Set(MILESTONES.map((m) => m.id)).size, MILESTONES.length);
  for (const c of CHAPTERS) {
    const chests = MILESTONES.filter((m) => m.chapterId === c.id);
    const max = STAGES.filter((s) => s.chapterId === c.id).length * 3;
    assert.deepEqual(chests.map((m) => m.stars), [15, 30, 45, 60]);
    for (let i = 1; i < chests.length; i++) assert.ok(chests[i].coins > chests[i - 1].coins);
    assert.ok(chests.at(-1).stars <= max);
  }
  assert.ok(MAX_STARS >= 180);
});
