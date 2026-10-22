import { STAGES, GAME_MODES, TRACK_SEGMENTS, WEATHER } from '../data/career.js';
import { TRACKS } from '../data/tracks.js';
import { ROUTES } from '../race/routes.js';
import { isStageUnlocked } from '../core/career.js';

// Shared stage helpers for the world map, the briefing, the garage stage chip and the results
// screen. Players race the stages they have unlocked on tracks that are built; dev builds
// (pre-release or ?debug) can open any stage and run locked ones as practice that saves
// nothing. Stages whose chapter track is not built yet race their segment on Emerald Coast.

// 24x24 stroke icons per game mode (flag, stopwatch, drift swirl, knock-out, crown).
const MODE_PATHS = {
  Classic: '<path d="M5 21V4" /><path d="M5 4h13l-2.5 4.5L18 13H5" /><path d="M9 4v9M13 4v9M5 8.5h13" opacity=".55" />',
  TimeTrial: '<circle cx="12" cy="13.5" r="7" /><path d="M12 13.5V9.5M10 2.5h4M12 2.5v4M18 6.5l1.5-1.5" />',
  DriftTouge: '<path d="M3.5 17.5c2.5-7 9-9.5 13-6.5 3 2.3 1.8 6.5-1.5 6.3-2.4-.1-3-2.6-1-3.4" /><path d="M3 21h6M14 21h7" opacity=".55" />',
  Elimination: '<circle cx="12" cy="12" r="8.5" /><path d="m8.5 8.5 7 7M15.5 8.5l-7 7" />',
  BossDuel: '<path d="M3.5 18.5h17l-1.8-10-4.7 4-2-6.5-2 6.5-4.7-4z" /><path d="M5 21.5h14" />',
};
export const modeIcon = (mode) => `<svg class="mode-icon" viewBox="0 0 24 24" aria-hidden="true">${MODE_PATHS[mode]}</svg>`;

export const LOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1Zm2 0h6V8a3 3 0 0 0-6 0v2Z"/></svg>';

export const trackBuilt = (stage) => TRACKS.some((t) => t.id === TRACK_SEGMENTS[stage.trackSegment].trackId);

// What a player can race.
export const isPlayable = (save, stage, dev = false) => dev || (trackBuilt(stage) && isStageUnlocked(save, stage));
// A dev run of a stage the player has not unlocked (or whose track is not built) saves nothing.
export const isPractice = (save, stage) => !isStageUnlocked(save, stage) || !trackBuilt(stage);

// The stage the garage offers by default: the furthest unlocked one on a built track.
export function defaultStage(save) {
  let pick = STAGES[0];
  for (const s of STAGES) if (trackBuilt(s) && isStageUnlocked(save, s)) pick = s;
  return pick;
}

export const stageTag = (s) => `${s.stageId.slice(0, 2).toUpperCase()}-${String(s.chapterStage).padStart(2, '0')}`;
export const stageLabel = (s) => `STAGE ${stageTag(s)} · ${GAME_MODES[s.gameMode].name.toUpperCase()}`;

// "2 laps · 5.8 km" or "Sprint · 1.3 km"; Elimination runs until one car is left.
export function layoutLabel(stage) {
  const seg = TRACK_SEGMENTS[stage.trackSegment];
  if (stage.gameMode === 'Elimination') return 'Endless · last car standing';
  const km = `${(seg.length / 1000).toFixed(1)} km`;
  return seg.layout === 'circuit' ? `${seg.laps} lap${seg.laps > 1 ? 's' : ''} · ${km}` : `Sprint · ${km}`;
}
export const weatherName = (stage) => WEATHER[stage.weatherPreset].name;
// "Full Circuit", "Reverse", "Point-to-Point Sprint" or "Redwood Loop" (race/routes.js).
export const routeName = (stage) => ROUTES[TRACK_SEGMENTS[stage.trackSegment].route]?.name ?? ROUTES.circuit.name;

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5-4.9-4.5 6.6-.8z" /></svg>';
export const STAR_ICON = STAR;
export const starIcons = (mask) => [0, 1, 2].map((i) => `<i class="${(mask >> i) & 1 ? 'on' : ''}">${STAR}</i>`).join('');

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
