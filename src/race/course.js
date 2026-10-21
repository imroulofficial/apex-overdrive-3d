// Where on a track a stage races (data/career.js TRACK_SEGMENTS): a circuit runs `laps` full
// laps from the start line; a sprint runs once from `from` to `to`. Distances are metres of
// travel along the track spline from the stage's start line. Pure, for the tests.
import { TRACK_SEGMENTS, GAME_MODES } from '../data/career.js';

// trackLength: the built track's spline length. Elimination runs until one car is left, so its
// course never ends by distance.
export function courseFor(stage, trackLength) {
  const seg = TRACK_SEGMENTS[stage.trackSegment];
  if (!seg) throw new Error(`stage ${stage.stageId}: unknown segment ${stage.trackSegment}`);
  const L = trackLength;
  const circuit = seg.layout === 'circuit';
  const span = circuit ? seg.laps : (((seg.to - seg.from) % 1) + 1) % 1 || 1;
  const startS = (((seg.from % 1) + 1) % 1) * L;
  const endless = stage.gameMode === 'Elimination';
  return {
    segmentId: seg.id,
    name: seg.name,
    route: seg.route,
    reverse: Boolean(seg.reverse), // race the reversed spline
    forced: Boolean(seg.forced), // highway closed along the redwood trails
    layout: seg.layout,
    laps: circuit ? seg.laps : 1,
    startS,
    distance: endless ? Infinity : span * L,
    finishS: endless ? null : (startS + span * L) % L,
    endless,
    solo: GAME_MODES[stage.gameMode].solo,
  };
}

// Laps completed for `dist` metres travelled on a circuit (-1 before the start line).
export const lapIndex = (dist, trackLength) => Math.floor(dist / trackLength);

// 0..1 of the race for the progress strip; endless courses show the current lap instead.
export function raceFraction(dist, course, trackLength) {
  if (!Number.isFinite(course.distance)) return (((dist % trackLength) + trackLength) % trackLength) / trackLength;
  return Math.max(0, Math.min(1, dist / course.distance));
}
