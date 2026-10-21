import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, CHAPTERS, MILESTONES, stageById } from '../src/data/career.js';
import { PAINTS } from '../src/data/catalog.js';
import { BOSSES, ALL_RIVALS, RIVAL_SETS, rivalById } from '../src/data/rivals.js';
import { CAST, SCENES, BOSS_CAST, sceneForStage } from '../src/data/story.js';
import { defaults, normalize, progressOf, migrate } from '../src/core/saveSchema.js';
import { claimMilestone, nextStage, currentStage, chapterLock, settleStage } from '../src/core/career.js';
import { duePrologue, dueBefore, dueAfter, markSeen } from '../src/core/story.js';
import { nodeLayout } from '../src/map/mapWorld.js';
import { v1Save, result } from './helpers.js';

// ---- Milestone chest paints ----

test('chest paints are never sold, never owned by default, and each chest names a real paint', () => {
  const chestPaints = PAINTS.filter((p) => p.milestone);
  assert.equal(chestPaints.length, 6);
  for (const p of chestPaints) {
    assert.equal(p.price, 0);
    assert.equal(p.product, undefined);
    assert.equal(MILESTONES.find((m) => m.id === p.milestone)?.paint, p.id);
  }
  for (const m of MILESTONES.filter((x) => x.paint)) assert.ok(PAINTS.some((p) => p.id === m.paint));
  const fresh = defaults();
  for (const p of chestPaints) assert.ok(!fresh.ownedPaints.includes(p.id));
  assert.ok(!migrate(v1Save()).ownedPaints.some((id) => chestPaints.some((p) => p.id === id)));
});

test('opening a 30-star chest pays coins and adds its paint once', () => {
  const save = defaults();
  save.career.stageStars.fill(7, 0, 10); // 30 Emerald Coast stars
  assert.equal(claimMilestone(save, 'ec-15').paint, null);
  const coins = save.coins;
  const m = claimMilestone(save, 'ec-30');
  assert.equal(m.paint, 'tidal-teal');
  assert.equal(save.coins, coins + m.coins);
  assert.ok(save.ownedPaints.includes('tidal-teal'));
  assert.equal(claimMilestone(save, 'ec-30'), null);
  assert.equal(save.ownedPaints.filter((id) => id === 'tidal-teal').length, 1);
  // The paint and the claim survive a reload and travel with the cloud progress.
  const again = normalize(JSON.parse(JSON.stringify(save)));
  assert.ok(again.ownedPaints.includes('tidal-teal'));
  assert.deepEqual(again.career.milestones, ['ec-15', 'ec-30']);
  assert.ok(progressOf(again).garage.ownedPaints.includes('tidal-teal'));
});

test('chest ids fit the Firestore rules (milestones list <= 32, paints <= 64)', () => {
  assert.ok(MILESTONES.length <= 32);
  assert.ok(PAINTS.length <= 64);
});

// ---- Bosses and cast ----

test('the three bosses are Riptide, Avalanche and Kage, with story portraits', () => {
  assert.deepEqual(BOSSES.map((b) => b.name), ['Riptide', 'Avalanche', 'Kage']);
  for (const b of BOSSES) {
    assert.ok(CAST[BOSS_CAST[b.id]], `${b.id} has a cast entry`);
    assert.equal(CAST[BOSS_CAST[b.id]].name, b.name);
    assert.ok(b.quote && b.title);
  }
  // Boss duels race the chapter's boss, and the names on the grid are unique.
  for (const c of CHAPTERS) {
    const duel = STAGES.find((s) => s.chapterId === c.id && s.gameMode === 'BossDuel');
    assert.deepEqual(RIVAL_SETS[duel.rivalSet].rivals, [c.boss]);
  }
  assert.equal(new Set(ALL_RIVALS.map((r) => r.name)).size, ALL_RIVALS.length);
  assert.equal(rivalById('riptide').name, 'Breakwater');
});

// ---- Story scenes ----

test('every scene line has a known speaker, and triggers point at real stages', () => {
  for (const scene of Object.values(SCENES)) {
    assert.ok(scene.lines.length >= 3, scene.id);
    assert.ok(CHAPTERS.some((c) => c.id === scene.chapterId), scene.id);
    for (const l of scene.lines) {
      assert.ok(l.who === null || CAST[l.who], `${scene.id}: ${l.who}`);
      assert.ok(l.text.length > 0 && l.text.length <= 160, `${scene.id}: line too long for the balloon`);
    }
    if (scene.trigger !== 'prologue') {
      assert.ok(stageById(scene.trigger.stage), scene.id);
      assert.ok(['before', 'after'].includes(scene.trigger.when));
    }
  }
  assert.ok(SCENES.prologue.lines.some((l) => l.who === 'elena'));
  assert.ok(SCENES.prologue.lines.some((l) => l.who === 'rookie'));
});

test('every boss duel has an intro and a victory scene with its boss', () => {
  for (const s of STAGES.filter((x) => x.gameMode === 'BossDuel')) {
    const boss = BOSS_CAST[RIVAL_SETS[s.rivalSet].rivals[0]];
    for (const when of ['before', 'after']) {
      const scene = sceneForStage(s.stageId, when);
      assert.ok(scene, `${s.stageId} ${when}`);
      assert.ok(scene.lines.some((l) => l.who === boss), `${s.stageId} ${when} features ${boss}`);
    }
  }
  // Chapters 2 and 3 open with a scene on their first stage.
  assert.ok(sceneForStage('as-01'));
  assert.ok(sceneForStage('nc-01'));
});

test('scenes play once per device: prologue, before-stage and boss victory', () => {
  const save = defaults();
  assert.equal(duePrologue(save).id, 'prologue');
  markSeen(save, 'prologue');
  assert.equal(duePrologue(save), null);
  assert.equal(dueBefore(save, stageById('ec-01')), null);
  assert.equal(dueBefore(save, stageById('ec-20')).id, 'ec-20');
  markSeen(save, 'ec-20');
  markSeen(save, 'ec-20');
  assert.equal(dueBefore(save, stageById('ec-20')), null);
  assert.deepEqual(save.story.seen, ['prologue', 'ec-20']);
  // The victory scene needs a first-time star 1.
  assert.equal(dueAfter(save, stageById('ec-20'), 0b110), null);
  assert.equal(dueAfter(save, stageById('ec-20'), 0b001).id, 'ec-20-after');
  assert.equal(dueAfter(save, stageById('ec-19'), 0b001), null);
});

test('story progress is per device: normalized, never part of the cloud progress', () => {
  const s = normalize({ v: 2, story: { seen: ['prologue', 'bogus', 'prologue', 7] } });
  assert.deepEqual(s.story.seen, ['prologue']);
  assert.deepEqual(normalize({ v: 2 }).story.seen, []);
  assert.equal(JSON.stringify(progressOf(s)).includes('prologue'), false);
});

// ---- Campaign flow helpers ----

test('next stage, current stage and chapter locks follow the career', () => {
  const save = defaults();
  assert.equal(nextStage(STAGES[0]), STAGES[1]);
  assert.equal(nextStage(STAGES.at(-1)), null);
  assert.equal(currentStage(save), STAGES[0]);
  settleStage(save, STAGES[0], result({ position: 1 }));
  assert.equal(currentStage(save), STAGES[1]);
  const lock = chapterLock(save, 'alpine-summit');
  assert.equal(lock.stage.stageId, 'ec-20');
  assert.equal(lock.stars, 30 - 3);
  assert.deepEqual(chapterLock(save, 'emerald-coast'), { stage: null, stars: 0 });
});

// ---- World map layout ----

test('world map nodes: 60, west to east, spaced apart and above the sea', () => {
  const nodes = nodeLayout();
  assert.equal(nodes.length, STAGES.length);
  for (let i = 1; i < nodes.length; i++) {
    assert.ok(nodes[i].x > nodes[i - 1].x, `node ${i} east of ${i - 1}`);
    if (STAGES[i].chapterId === STAGES[i - 1].chapterId) assert.ok(nodes[i].distanceTo(nodes[i - 1]) > 4.5, `nodes ${i - 1}/${i} overlap`);
  }
  for (const n of nodes) assert.ok(n.y > 0.5);
});
