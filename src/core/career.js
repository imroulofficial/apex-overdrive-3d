// Career rules over a v2 save (core/saveSchema.js): which stages are open, which stars a
// race earned, what it pays, and milestone chests. Pure functions; callers save afterwards.
import { STAGES, MILESTONES, GAME_MODES, chapterById, describeObjective, fmtTime } from '../data/career.js';
import { STAR_BONUS, finishCoins, skillBonus } from '../data/economy.js';

export const starCount = (mask) => (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);
export const totalStars = (save) => save.career.stageStars.reduce((n, m) => n + starCount(m), 0);
export const chapterStars = (save, chapterId) =>
  STAGES.reduce((n, s) => n + (s.chapterId === chapterId ? starCount(save.career.stageStars[s.index]) : 0), 0);

export function isChapterUnlocked(save, chapterId) {
  const chapter = chapterById(chapterId);
  if (!chapter) return false;
  const first = STAGES.find((s) => s.chapterId === chapterId);
  return first.number <= save.career.unlockedStage && totalStars(save) >= chapter.starGate;
}

export function isStageUnlocked(save, stage) {
  return stage.number <= save.career.unlockedStage && isChapterUnlocked(save, stage.chapterId);
}

// `result` is what a race reports for the player:
//   { finished, position, time, bestLap, driftScore, driftDistance, smashes, airTime, pulses }
export function meetsObjective(o, r) {
  switch (o.type) {
    case 'position':
      return Number.isFinite(r.position) && r.position >= 1 && r.position <= o.max;
    case 'time':
      return Number.isFinite(r.time) && r.time > 0 && r.time < o.seconds;
    case 'lap':
      return Number.isFinite(r.bestLap) && r.bestLap > 0 && r.bestLap < o.seconds;
    case 'driftDistance':
      return (r.driftDistance ?? 0) >= o.meters;
    case 'driftScore':
      return (r.driftScore ?? 0) >= o.points;
    case 'smash':
      return (r.smashes ?? 0) >= o.count;
    case 'airTime':
      return (r.airTime ?? 0) >= o.seconds;
    case 'pulseNitro':
      return (r.pulses ?? 0) >= o.count;
    default:
      return false;
  }
}

// What a run achieved against one objective, for the results screen:
// { label: 'Drift 350 m', value: '412 m', met }.
export function objectiveProgress(o, r) {
  const met = r.finished !== false && meetsObjective(o, r);
  const num = (n) => Math.round(n ?? 0).toLocaleString('en-US');
  let value;
  switch (o.type) {
    case 'position': {
      const p = r.position;
      const suf = ['th', 'st', 'nd', 'rd'][(p % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][p % 100] || 'th';
      value = r.total > 1 && Number.isFinite(p) ? `${p}${suf}` : '—';
      break;
    }
    case 'time':
      value = r.finished === false || !Number.isFinite(r.time) ? 'DNF' : fmtTime(r.time);
      break;
    case 'lap':
      value = Number.isFinite(r.bestLap) ? fmtTime(r.bestLap) : '—';
      break;
    case 'driftDistance':
      value = `${num(r.driftDistance)} m`;
      break;
    case 'driftScore':
      value = num(r.driftScore);
      break;
    case 'smash':
      value = `${num(r.smashes)}`;
      break;
    case 'airTime':
      value = `${(r.airTime ?? 0).toFixed(1)} s`;
      break;
    case 'pulseNitro':
      value = `${num(r.pulses)}`;
      break;
    default:
      value = '';
  }
  return { label: describeObjective(o), value, met };
}

// Stars earned by one run, as a bitmask (bit 0 = star 1). A run that did not finish earns none.
export function evaluateStars(stage, result) {
  if (!result || result.finished === false) return 0;
  return stage.objectives.reduce((mask, o, i) => (meetsObjective(o, result) ? mask | (1 << i) : mask), 0);
}

// Banks a finished run: records stars and bests, unlocks the next stage when star 1 is met,
// and pays the finish reward, the capped drift/air/smash bonus and +250 per first-time star.
// Mutates `save` and returns what happened, for the results screen.
export function settleStage(save, stage, result) {
  const c = save.career;
  const mask = evaluateStars(stage, result);
  const before = c.stageStars[stage.index];
  const fresh = mask & ~before;
  c.stageStars[stage.index] = before | mask;

  const finished = result.finished !== false;
  const solo = GAME_MODES[stage.gameMode].solo;
  const finish = finished ? finishCoins(stage.coinReward, { position: solo ? null : result.position, finishMet: Boolean(mask & 1) }) : 0;
  const skill = skillBonus(result);
  const star = starCount(fresh) * STAR_BONUS;
  const coins = { finish, skill: skill.total, skillParts: skill, star, race: finish + skill.total, total: finish + skill.total + star };
  save.coins += coins.total;

  let unlocked = null;
  if (mask & 1 && stage.number === c.unlockedStage && stage.number < STAGES.length) {
    c.unlockedStage = stage.number + 1;
    unlocked = STAGES[stage.number];
  }

  const best = c.best[stage.stageId] ?? { time: null, score: 0, plays: 0 };
  const newBest = finished && Number.isFinite(result.time) && (best.time === null || result.time < best.time);
  c.best[stage.stageId] = {
    time: newBest ? result.time : best.time,
    score: Math.max(best.score, Math.round(result.driftScore ?? 0)),
    plays: best.plays + 1,
  };

  return {
    stars: mask,
    stageStars: c.stageStars[stage.index],
    newStars: fresh,
    coins,
    unlocked,
    newBest: newBest && best.time !== null,
    milestones: claimableMilestones(save),
  };
}

// Chests whose chapter star threshold is met and that have not been opened yet.
export const claimableMilestones = (save) =>
  MILESTONES.filter((m) => chapterStars(save, m.chapterId) >= m.stars && !save.career.milestones.includes(m.id));

// Opens a milestone chest once: pays its coins and adds its paint to the owned paints.
// Returns the milestone, or null if it is not claimable.
export function claimMilestone(save, id) {
  const m = claimableMilestones(save).find((x) => x.id === id);
  if (!m) return null;
  save.career.milestones.push(m.id);
  save.coins += m.coins;
  if (m.paint && !save.ownedPaints.includes(m.paint)) save.ownedPaints.push(m.paint);
  return m;
}

// The stage after `stage` in career order, or null after the last one.
export const nextStage = (stage) => STAGES[stage.number] ?? null;

// The furthest stage the player can race (the map's "you are here" node).
export function currentStage(save) {
  let pick = STAGES[0];
  for (const s of STAGES) if (isStageUnlocked(save, s)) pick = s;
  return pick;
}

// Why a chapter is still closed, for the map's lock card:
// { stage: the stage to clear first or null, stars: stars still needed (0 when met) }.
export function chapterLock(save, chapterId) {
  const chapter = chapterById(chapterId);
  const first = STAGES.find((s) => s.chapterId === chapterId);
  const prev = STAGES[first.index - 1] ?? null;
  return {
    stage: prev && first.number > save.career.unlockedStage ? prev : null,
    stars: Math.max(0, chapter.starGate - totalStars(save)),
  };
}
