// Career / Adventure mode: 3 chapters (biomes) x 20 stages = 60 launch stages, each with a
// 3-star objective matrix (blueprint 2.4):
//   star 1  finish objective   (finish top 3, beat the par time, reach the score...)
//   star 2  skill objective    (drift 350 m, smash 5 props, 3 s of airtime...)
//   star 3  mastery objective  (beat the target lap / run time, or the gold score)
// Stars are earned independently and kept forever; star 1 unlocks the next stage.
//
// SAVE COMPATIBILITY: the save stores stars as an array indexed by stage order
// (career.stageStars[i] belongs to STAGES[i]). Only ever append stages; never reorder or
// remove them, or existing saves will credit stars to the wrong stage.
//
// Pure data (no browser APIs), so the tests can import it under Node. Target times and
// scores are provisional until each chapter's tracks are tuned.
import { stageCoinReward } from './economy.js';
import { RIVAL_SETS } from './rivals.js';

export const GAME_MODES = {
  Classic: { id: 'Classic', name: 'Classic Expedition', blurb: 'Outrun 5 rivals to the line', solo: false },
  TimeTrial: { id: 'TimeTrial', name: 'Time Trial', blurb: 'Beat the clock; green pylons take 1.0 s off', solo: true },
  DriftTouge: { id: 'DriftTouge', name: 'Drift Touge', blurb: 'Chain drifts to hit the target score', solo: true },
  Elimination: { id: 'Elimination', name: 'Elimination', blurb: 'Last place is out every 20 seconds', solo: false },
  BossDuel: { id: 'BossDuel', name: 'Boss Duel', blurb: '1v1 against the regional champion', solo: false },
};

export const WEATHER = {
  GoldenHour: { id: 'GoldenHour', name: 'Golden Hour' },
  Fog: { id: 'Fog', name: 'Coastal Fog' },
  Rain: { id: 'Rain', name: 'Light Rain' },
  Midday: { id: 'Midday', name: 'Crisp Midday' },
  Dusk: { id: 'Dusk', name: 'Overcast Dusk' },
};

// Stretches of a chapter's track that stages race on. `from`/`to` are lap fractions of the
// track spline; a circuit runs `laps` full laps, a sprint runs from `from` to `to` once.
// `length` is an estimate in metres used to set target times until the track is tuned.
export const TRACK_SEGMENTS = {
  // Chapter 1 · Emerald Coast (src/data/tracks.js EMERALD_COAST, ~2.9 km per lap)
  'ec-coastal-loop': { id: 'ec-coastal-loop', trackId: 'emerald-coast', name: 'Coastal Loop', layout: 'circuit', laps: 2, from: 0, to: 1, length: 5800 },
  'ec-harbour-hotlap': { id: 'ec-harbour-hotlap', trackId: 'emerald-coast', name: 'Harbour Hot Lap', layout: 'circuit', laps: 1, from: 0, to: 1, length: 2900 },
  'ec-lighthouse-sprint': { id: 'ec-lighthouse-sprint', trackId: 'emerald-coast', name: 'Lighthouse Sprint', layout: 'sprint', laps: 1, from: 0, to: 0.45, length: 1300 },
  'ec-cliffside-run': { id: 'ec-cliffside-run', trackId: 'emerald-coast', name: 'Cliffside Run', layout: 'sprint', laps: 1, from: 0.4, to: 0.95, length: 1600 },
  'ec-grand-tour': { id: 'ec-grand-tour', trackId: 'emerald-coast', name: 'Grand Coastal Tour', layout: 'circuit', laps: 3, from: 0, to: 1, length: 8700 },
  // Chapter 2 · Alpine Summit (track planned)
  'as-summit-loop': { id: 'as-summit-loop', trackId: 'alpine-summit', name: 'Summit Loop', layout: 'circuit', laps: 2, from: 0, to: 1, length: 6400 },
  'as-village-sector': { id: 'as-village-sector', trackId: 'alpine-summit', name: 'Cobblestone Village', layout: 'circuit', laps: 1, from: 0, to: 1, length: 3200 },
  'as-hairpin-ascent': { id: 'as-hairpin-ascent', trackId: 'alpine-summit', name: 'Hairpin Ascent', layout: 'sprint', laps: 1, from: 0, to: 0.5, length: 1600 },
  'as-glacier-descent': { id: 'as-glacier-descent', trackId: 'alpine-summit', name: 'Glacier Descent', layout: 'sprint', laps: 1, from: 0.5, to: 1, length: 1600 },
  'as-canyon-pass': { id: 'as-canyon-pass', trackId: 'alpine-summit', name: 'Canyon Pass', layout: 'sprint', laps: 1, from: 0.2, to: 0.8, length: 1900 },
  // Chapter 3 · Neon City (track planned)
  'nc-downtown-loop': { id: 'nc-downtown-loop', trackId: 'neon-city', name: 'Downtown Loop', layout: 'circuit', laps: 2, from: 0, to: 1, length: 6000 },
  'nc-arcade-district': { id: 'nc-arcade-district', trackId: 'neon-city', name: 'Arcade District', layout: 'circuit', laps: 1, from: 0, to: 1, length: 3000 },
  'nc-harbour-bridge': { id: 'nc-harbour-bridge', trackId: 'neon-city', name: 'Harbour Bridge', layout: 'sprint', laps: 1, from: 0, to: 0.5, length: 1500 },
  'nc-skyline-drift': { id: 'nc-skyline-drift', trackId: 'neon-city', name: 'Skyline Switchbacks', layout: 'sprint', laps: 1, from: 0.45, to: 1, length: 1650 },
  'nc-grand-prix': { id: 'nc-grand-prix', trackId: 'neon-city', name: 'Neon Grand Prix', layout: 'circuit', laps: 3, from: 0, to: 1, length: 9000 },
};

// `starGate`: total career stars needed to enter the chapter (on top of clearing the previous
// chapter's last stage). `pace`: reference average speed (m/s) the target times are built from.
export const CHAPTERS = [
  {
    id: 'emerald-coast',
    number: 1,
    name: 'Emerald Coast',
    subtitle: 'Emerald Coast & Redwood Trails',
    trackId: 'emerald-coast',
    weather: ['GoldenHour', 'Fog', 'Rain'],
    starGate: 0,
    boss: 'boss-tidebreaker',
    pace: 42,
  },
  {
    id: 'alpine-summit',
    number: 2,
    name: 'Alpine Summit',
    subtitle: 'Alpine Summit & Canyon Pass',
    trackId: 'alpine-summit',
    weather: ['Midday', 'Dusk', 'Fog'],
    starGate: 30,
    boss: 'boss-avalanche',
    pace: 46,
  },
  {
    id: 'neon-city',
    number: 3,
    name: 'Neon City',
    subtitle: 'Neon City Nights',
    trackId: 'neon-city',
    weather: ['Dusk', 'Rain', 'Midday'],
    starGate: 75,
    boss: 'boss-voltage',
    pace: 50,
  },
];

// ---- Objectives ----
// Each objective is checked against a race result (see core/career.js meetsObjective):
//   position    finished at or above `max` (1 = win)
//   time        finished in under `seconds`
//   lap         best lap under `seconds`
//   driftDistance  drifted `meters` in total
//   driftScore  banked `points` of drift score
//   smash       smashed `count` props (cones, barricades, green pylons)
//   airTime     `seconds` of total airtime
//   pulseNitro  fired `count` Pulse (perfect) nitros
export const OBJECTIVE_TYPES = ['position', 'time', 'lap', 'driftDistance', 'driftScore', 'smash', 'airTime', 'pulseNitro'];

const top = (max) => ({ type: 'position', max });
const time = (seconds) => ({ type: 'time', seconds: Math.round(seconds * 100) / 100 });
const lap = (seconds) => ({ type: 'lap', seconds: Math.round(seconds * 100) / 100 });
const score = (points) => ({ type: 'driftScore', points: Math.round(points / 50) * 50 });

// Skill objectives as written in the stage tables below.
const SKILLS = {
  drift: (meters) => ({ type: 'driftDistance', meters }),
  smash: (count) => ({ type: 'smash', count }),
  air: (seconds) => ({ type: 'airTime', seconds }),
  pulse: (count) => ({ type: 'pulseNitro', count }),
};

export const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

export function describeObjective(o) {
  switch (o.type) {
    case 'position':
      return o.max === 1 ? 'Finish 1st' : `Finish Top ${o.max}`;
    case 'time':
      return `Finish under ${fmtTime(o.seconds)}`;
    case 'lap':
      return `Best lap under ${fmtTime(o.seconds)}`;
    case 'driftDistance':
      return `Drift ${o.meters} m`;
    case 'driftScore':
      return `Score ${o.points.toLocaleString('en-US')} drift points`;
    case 'smash':
      return `Smash ${o.count} props`;
    case 'airTime':
      return `${o.seconds} s of airtime`;
    case 'pulseNitro':
      return o.count === 1 ? 'Fire a Pulse Nitro' : `Fire ${o.count} Pulse Nitros`;
    default:
      return o.type;
  }
}

// Finish and mastery objectives follow from the mode, the segment and how far into the
// chapter the stage is (`k`, 0-1): targets tighten by up to 6% across a chapter.
function finishAndMastery(mode, seg, chapter, k) {
  const pace = chapter.pace * (1 + 0.06 * k);
  const run = seg.length / pace; // par time for the whole run
  const lapTime = seg.length / seg.laps / (pace * 1.08);
  const mastery = seg.layout === 'circuit' && seg.laps > 1 ? lap(lapTime) : time(run / 1.08);
  switch (mode) {
    case 'Classic':
      return [top(3), mastery];
    case 'TimeTrial':
      return [time(run * 1.02), time(run / 1.1)];
    case 'DriftTouge':
      return [score(seg.length * 1.6 * (1 + k)), score(seg.length * 3.2 * (1 + k))];
    case 'Elimination':
      return [top(3), top(1)];
    case 'BossDuel':
      return [top(1), mastery];
    default:
      throw new Error(`unknown mode ${mode}`);
  }
}

// [mode, segment, weather, rivalSet, [skill, amount]]
const CHAPTER_STAGES = {
  'emerald-coast': [
    ['Classic', 'ec-coastal-loop', 'GoldenHour', 'coast-rookie', ['smash', 5]],
    ['Classic', 'ec-lighthouse-sprint', 'GoldenHour', 'coast-rookie', ['drift', 200]],
    ['TimeTrial', 'ec-harbour-hotlap', 'GoldenHour', 'solo', ['smash', 4]],
    ['Classic', 'ec-cliffside-run', 'Fog', 'coast-rookie', ['air', 2]],
    ['DriftTouge', 'ec-cliffside-run', 'GoldenHour', 'solo', ['drift', 350]],
    ['Classic', 'ec-coastal-loop', 'Fog', 'coast-rookie', ['pulse', 1]],
    ['Elimination', 'ec-coastal-loop', 'GoldenHour', 'coast-rookie', ['smash', 8]],
    ['TimeTrial', 'ec-lighthouse-sprint', 'Rain', 'solo', ['air', 3]],
    ['Classic', 'ec-harbour-hotlap', 'Rain', 'coast-pro', ['drift', 300]],
    ['DriftTouge', 'ec-lighthouse-sprint', 'Fog', 'solo', ['smash', 6]],
    ['Classic', 'ec-cliffside-run', 'GoldenHour', 'coast-pro', ['pulse', 2]],
    ['Elimination', 'ec-harbour-hotlap', 'Rain', 'coast-pro', ['drift', 350]],
    ['TimeTrial', 'ec-cliffside-run', 'Fog', 'solo', ['smash', 8]],
    ['Classic', 'ec-coastal-loop', 'Rain', 'coast-pro', ['air', 4]],
    ['DriftTouge', 'ec-harbour-hotlap', 'Rain', 'solo', ['drift', 450]],
    ['Classic', 'ec-lighthouse-sprint', 'Fog', 'coast-pro', ['smash', 10]],
    ['Elimination', 'ec-coastal-loop', 'Fog', 'coast-pro', ['pulse', 2]],
    ['TimeTrial', 'ec-coastal-loop', 'GoldenHour', 'solo', ['drift', 400]],
    ['Classic', 'ec-grand-tour', 'GoldenHour', 'coast-pro', ['air', 5]],
    ['BossDuel', 'ec-grand-tour', 'Rain', 'coast-boss', ['drift', 500]],
  ],
  'alpine-summit': [
    ['Classic', 'as-summit-loop', 'Midday', 'alpine-club', ['drift', 350]],
    ['TimeTrial', 'as-hairpin-ascent', 'Midday', 'solo', ['smash', 5]],
    ['DriftTouge', 'as-glacier-descent', 'Midday', 'solo', ['drift', 400]],
    ['Classic', 'as-canyon-pass', 'Dusk', 'alpine-club', ['air', 3]],
    ['Elimination', 'as-village-sector', 'Midday', 'alpine-club', ['smash', 8]],
    ['Classic', 'as-hairpin-ascent', 'Fog', 'alpine-club', ['pulse', 2]],
    ['DriftTouge', 'as-canyon-pass', 'Dusk', 'solo', ['air', 3]],
    ['TimeTrial', 'as-summit-loop', 'Midday', 'solo', ['drift', 450]],
    ['Classic', 'as-glacier-descent', 'Fog', 'alpine-club', ['smash', 10]],
    ['Elimination', 'as-summit-loop', 'Dusk', 'alpine-pro', ['drift', 500]],
    ['Classic', 'as-village-sector', 'Midday', 'alpine-pro', ['air', 4]],
    ['DriftTouge', 'as-hairpin-ascent', 'Fog', 'solo', ['drift', 550]],
    ['TimeTrial', 'as-canyon-pass', 'Dusk', 'solo', ['smash', 10]],
    ['Classic', 'as-summit-loop', 'Fog', 'alpine-pro', ['pulse', 3]],
    ['Elimination', 'as-canyon-pass', 'Midday', 'alpine-pro', ['air', 5]],
    ['DriftTouge', 'as-glacier-descent', 'Dusk', 'solo', ['smash', 8]],
    ['Classic', 'as-hairpin-ascent', 'Midday', 'alpine-pro', ['drift', 600]],
    ['TimeTrial', 'as-village-sector', 'Fog', 'solo', ['pulse', 2]],
    ['Classic', 'as-summit-loop', 'Dusk', 'alpine-pro', ['smash', 12]],
    ['BossDuel', 'as-summit-loop', 'Fog', 'alpine-boss', ['drift', 700]],
  ],
  'neon-city': [
    ['Classic', 'nc-downtown-loop', 'Dusk', 'neon-syndicate', ['smash', 8]],
    ['DriftTouge', 'nc-skyline-drift', 'Dusk', 'solo', ['drift', 500]],
    ['TimeTrial', 'nc-harbour-bridge', 'Rain', 'solo', ['air', 3]],
    ['Classic', 'nc-arcade-district', 'Rain', 'neon-syndicate', ['pulse', 2]],
    ['Elimination', 'nc-downtown-loop', 'Dusk', 'neon-syndicate', ['drift', 550]],
    ['Classic', 'nc-harbour-bridge', 'Midday', 'neon-syndicate', ['smash', 10]],
    ['DriftTouge', 'nc-arcade-district', 'Rain', 'solo', ['air', 4]],
    ['TimeTrial', 'nc-skyline-drift', 'Dusk', 'solo', ['drift', 600]],
    ['Classic', 'nc-downtown-loop', 'Rain', 'neon-syndicate', ['air', 5]],
    ['Elimination', 'nc-arcade-district', 'Dusk', 'neon-elite', ['smash', 12]],
    ['Classic', 'nc-skyline-drift', 'Midday', 'neon-elite', ['drift', 650]],
    ['DriftTouge', 'nc-harbour-bridge', 'Dusk', 'solo', ['pulse', 3]],
    ['TimeTrial', 'nc-downtown-loop', 'Rain', 'solo', ['smash', 12]],
    ['Classic', 'nc-arcade-district', 'Dusk', 'neon-elite', ['pulse', 3]],
    ['Elimination', 'nc-downtown-loop', 'Rain', 'neon-elite', ['air', 6]],
    ['DriftTouge', 'nc-skyline-drift', 'Rain', 'solo', ['drift', 750]],
    ['Classic', 'nc-harbour-bridge', 'Dusk', 'neon-elite', ['smash', 14]],
    ['TimeTrial', 'nc-grand-prix', 'Midday', 'solo', ['drift', 800]],
    ['Classic', 'nc-grand-prix', 'Rain', 'neon-elite', ['air', 6]],
    ['BossDuel', 'nc-grand-prix', 'Dusk', 'neon-boss', ['drift', 900]],
  ],
};

const STAGE_TOTAL = Object.values(CHAPTER_STAGES).reduce((n, rows) => n + rows.length, 0);

function buildStages() {
  const stages = [];
  for (const chapter of CHAPTERS) {
    const rows = CHAPTER_STAGES[chapter.id];
    rows.forEach(([mode, segmentId, weather, rivalSet, [skill, amount]], i) => {
      const index = stages.length;
      const seg = TRACK_SEGMENTS[segmentId];
      const k = rows.length > 1 ? i / (rows.length - 1) : 0;
      const [finish, mastery] = finishAndMastery(mode, seg, chapter, k);
      stages.push({
        stageId: `${chapter.id.split('-').map((w) => w[0]).join('')}-${String(i + 1).padStart(2, '0')}`,
        index, // position in career.stageStars
        number: index + 1, // 1-60, what career.unlockedStage counts
        chapterId: chapter.id,
        chapterStage: i + 1,
        trackSegment: segmentId,
        gameMode: mode,
        weatherPreset: weather,
        rivalSet,
        coinReward: stageCoinReward(index, STAGE_TOTAL, { boss: mode === 'BossDuel' }),
        objectives: [finish, SKILLS[skill](amount), mastery],
      });
    });
  }
  return stages;
}

export const STAGES = buildStages();
export const stageById = (id) => STAGES.find((s) => s.stageId === id);
export const stageByNumber = (n) => STAGES[n - 1];
export const chapterById = (id) => CHAPTERS.find((c) => c.id === id);
export const stagesOfChapter = (id) => STAGES.filter((s) => s.chapterId === id);
export const MAX_STARS = STAGES.length * 3;

// Milestone reward chests on the world map: four per chapter, opened once each when that
// chapter's stars reach `stars` (of 60). Every chest pays coins; the 30 and 60 star chests
// also hold a paint that is never sold (see PAINTS in data/catalog.js).
// Ids are stored in career.milestones (saved and synced): never rename one.
const CHEST_COINS = { 15: 1000, 30: 1500, 45: 2500, 60: 4000 };
const CHEST_PAINTS = {
  'ec-30': 'tidal-teal',
  'ec-60': 'riptide-wave',
  'as-30': 'glacier-frost',
  'as-60': 'avalanche-white',
  'nc-30': 'neon-magenta',
  'nc-60': 'kage-shadow',
};
export const MILESTONES = CHAPTERS.flatMap((c, ci) =>
  [15, 30, 45, 60].map((stars) => {
    const id = `${c.id.split('-').map((w) => w[0]).join('')}-${stars}`;
    // Later chapters pay a little more: x1, x1.5, x2.
    return { id, chapterId: c.id, stars, coins: CHEST_COINS[stars] * (1 + ci * 0.5), paint: CHEST_PAINTS[id] ?? null };
  })
);
MILESTONES.at(-1).title = 'Apex Expedition Champion';
export const milestonesOfChapter = (id) => MILESTONES.filter((m) => m.chapterId === id);

// Sanity checks that would otherwise only show up as a broken save.
for (const s of STAGES) {
  if (!RIVAL_SETS[s.rivalSet]) throw new Error(`stage ${s.stageId}: unknown rival set ${s.rivalSet}`);
  if (GAME_MODES[s.gameMode].solo !== (s.rivalSet === 'solo')) throw new Error(`stage ${s.stageId}: rival set does not fit ${s.gameMode}`);
}
