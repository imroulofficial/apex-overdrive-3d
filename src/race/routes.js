// Route variations on one track (blueprint §03): the full circuit, the same road driven in
// reverse, point-to-point sprints over part of it, and the Redwood Loop, which closes the
// highway along every redwood trail. Pure geometry helpers, so the tests can import them.
import { mulberry32 } from './noise.js';

export const ROUTES = {
  circuit: { id: 'circuit', name: 'Full Circuit' },
  reverse: { id: 'reverse', name: 'Reverse' },
  sprint: { id: 'sprint', name: 'Point-to-Point Sprint' },
  redwood: { id: 'redwood', name: 'Redwood Loop' },
};

const flip = (f) => (((1 - f) % 1) + 1) % 1;

// The same road driven the other way. Lap fractions on the reversed spline mirror the forward
// ones (f -> 1 - f, same start line); lateral offsets swap sides. Ramps are rebuilt to rise in
// the new direction of travel, so `length` (the forward spline length in metres) is needed.
export function reverseTrackDef(def, length) {
  const [first, ...rest] = def.points;
  const span = (r) => ({ ...r, from: flip(r.to), to: flip(r.from) || 1 });
  return {
    ...def,
    reversed: true,
    points: [first, ...rest.reverse()],
    ramps: (def.ramps ?? []).map((r) => ({ ...r, at: flip(r.at + r.length / length), from: -r.to, to: -r.from })),
    // A slalom runs 56 m from its first cone: start it where the forward one ends.
    slaloms: (def.slaloms ?? []).map((f) => flip(f + 56 / length)),
    barricades: (def.barricades ?? []).map(flip),
    fruitStalls: (def.fruitStalls ?? []).map(flip),
    neonSigns: (def.neonSigns ?? []).map(flip),
    seabirds: (def.seabirds ?? []).map((b) => ({ ...b, at: flip(b.at), side: -b.side })),
    bridge: def.bridge ? span(def.bridge) : null,
    trails: (def.trails ?? []).map(span),
    ice: (def.ice ?? []).map(span),
    tunnels: (def.tunnels ?? []).map(span),
  };
}

// Puddles where rain collects: in the dips of the road and at random along the straights,
// never on the bridge deck, a ramp or a trail fork. [{ s, d, r }] in `track` metres.
export function generatePuddles(track, { seed = 7, spacing = 55 } = {}) {
  const rand = mulberry32(seed);
  const out = [];
  const hw = track.halfWidth;
  const blocked = (s) =>
    track.onBridge(s) ||
    track.ramps.some((r) => Math.abs(track.delta(r.s0, s)) < r.length + 12) ||
    track.trails.some((t) => s > t.s0 - 10 && s < t.s0 + t.forkEnd + 10) ||
    track.trails.some((t) => s > t.mainS(t.mergeStart) - 10 && s < t.s1 + 10) ||
    track.wrapS(s) < 20 ||
    track.wrapS(s) > track.length - 20;
  for (let s = spacing * 0.5; s < track.length - spacing * 0.5; s += spacing * (0.6 + rand() * 0.8)) {
    // Water runs to the low point: favour local dips in the road profile.
    const dip = track.roadY(s) < Math.min(track.roadY(s - 25), track.roadY(s + 25));
    if (!dip && rand() < 0.45) continue;
    if (blocked(s)) continue;
    const r = 1.1 + rand() * 1.7;
    const d = (rand() * 2 - 1) * (hw - r - 0.6);
    out.push({ s, d, r });
  }
  return out;
}

// Puddles for the reversed track sit in the same places.
export const reversePuddles = (list, length) => list.map((p) => ({ ...p, s: (length - p.s) % length, d: -p.d }));
