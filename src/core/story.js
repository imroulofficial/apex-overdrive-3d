// Which story scene (data/story.js) is due, over a v2 save. Pure functions; callers save.
import { SCENES, sceneForStage } from '../data/story.js';

export const hasSeen = (save, id) => save.story.seen.includes(id);

export function markSeen(save, id) {
  if (SCENES[id] && !hasSeen(save, id)) save.story.seen.push(id);
}

// The Apex Expedition opening, until it has played once.
export const duePrologue = (save) => (hasSeen(save, 'prologue') ? null : SCENES.prologue);

// The scene to play before a stage's briefing, if it has not played on this device yet.
export function dueBefore(save, stage) {
  const scene = sceneForStage(stage.stageId, 'before');
  return scene && !hasSeen(save, scene.id) ? scene : null;
}

// The scene a run unlocked: a stage's 'after' scene plays the first time its star 1 is earned
// (`newStars` is the settled run's first-time star bitmask).
export function dueAfter(save, stage, newStars) {
  if (!(newStars & 1)) return null;
  const scene = sceneForStage(stage.stageId, 'after');
  return scene && !hasSeen(save, scene.id) ? scene : null;
}
