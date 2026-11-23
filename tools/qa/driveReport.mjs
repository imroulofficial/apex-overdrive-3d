// Before/after table for two tools/qa/drive.mjs runs: every glitch counter (C1-C15) by biome,
// plus the driving-feel numbers per player car (lap times, top speed, clean-road speed, ramp
// jump distances). Markdown to stdout, JSON with --json.
//
//   node tools/qa/driveReport.mjs before.json after.json [--json out.json]
import { readFile, writeFile } from 'node:fs/promises';

const [beforePath, afterPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const load = async (p) => {
  const text = await readFile(p, 'utf8');
  if (p.endsWith('.jsonl')) return { results: text.trim().split('\n').map((l) => JSON.parse(l)) };
  return JSON.parse(text);
};
const runs = { before: await load(beforePath), after: afterPath ? await load(afterPath) : null };

const biomeOf = (stage) => (stage.startsWith('ec') ? 'EC' : stage.startsWith('as') ? 'AS' : 'NC');

// Counters: [label, glitch id, how to read it from one racer's stats].
const sum = (prefix) => (st) => Object.entries(st).filter(([k]) => k.startsWith(prefix)).reduce((n, [, v]) => n + v, 0);
const COUNTERS = [
  ['Height snap while grounded', 'C1', (st) => st.heightSnap ?? 0],
  ['Takeoff away from a ramp', 'C1', (st) => st.offRampTakeoff ?? 0],
  ['High flight (>3 m) without a ramp', 'C1', (st) => st.offRampHighFlight ?? 0],
  ['Big launch (vy > 14 m/s)', 'C2/C12', (st) => st.bigLaunch ?? 0],
  ['Hard landing (> 16 m/s)', 'C11', (st) => st.hardLanding ?? 0],
  ['Hard landing into the ground (> 16 m/s)', 'C11', (st) => st.hardLandingGround ?? 0],
  ['Wheel float/sink > 15 cm on a ramp', 'C2', (st) => (st['wheelFloat:ramp'] ?? 0) + (st['wheelSink:ramp'] ?? 0)],
  ['Wheel float/sink > 15 cm on a trail', 'C1/C3', (st) => (st['wheelFloat:trail'] ?? 0) + (st['wheelSink:trail'] ?? 0)],
  ['Wheel sink > 15 cm into terrain', 'C3', (st) => sum('wheelSink@/terrain')(st) + sum('wheelSink@terrain')(st)],
  ['Wheel float/sink > 5 cm on a kerb', 'C8', (st) => (st['wheelFloat5:kerb'] ?? 0) + (st['wheelSink5:kerb'] ?? 0)],
  ['Wheel float/sink > 5 cm on the verge', 'C8', (st) => (st['wheelFloat5:verge'] ?? 0) + (st['wheelSink5:verge'] ?? 0)],
  ['Wheel float/sink > 15 cm on the bridge', 'C14', (st) => (st['wheelFloat:bridge'] ?? 0) + (st['wheelSink:bridge'] ?? 0)],
  ['Teleport (> 1 m in one step)', 'C4', (st) => st.teleport ?? 0],
  ['Respawn (stuck car put back on the road)', 'C4', (st) => st.respawn ?? 0],
  ['Barrier corner through the fence (> 10 cm)', 'C6', (st) => st.barrier ?? 0],
  ['Car overlap > 15 cm (every 2nd frame)', 'C5', (st) => st.carOverlap ?? 0],
  ['Prop stuck inside a car', 'C7', (st) => st.propInsideCar ?? 0],
];
const MAXES = [
  ['Highest flight (m)', 'C1', (st) => st.flightHeightMax ?? 0],
  ['Largest height snap (m)', 'C1', (st) => st.heightSnapMax ?? 0],
  ['Largest one-step teleport (m)', 'C4', (st) => st.teleportMax ?? 0],
  ['Deepest barrier corner (m)', 'C6', (st) => st.barrierMax ?? 0],
  ['Deepest car overlap (m)', 'C5', (st) => st.carOverlapMax ?? 0],
  ['Hardest landing (m/s)', 'C11', (st) => st.landMax ?? 0],
  ['Hardest landing into the ground (m/s)', 'C11', (st) => st.landGroundMax ?? 0],
];

function tally(run) {
  const out = { counters: {}, maxes: {}, props: {}, outcome: {}, races: 0, failed: 0, errors: 0, feel: {} };
  for (const res of run.results) {
    if (res.failed) {
      out.failed += 1;
      continue;
    }
    out.races += 1;
    out.errors += res.errors?.length ?? 0;
    out.outcome[res.result.reason] = (out.outcome[res.result.reason] ?? 0) + 1;
    const b = biomeOf(res.stage);
    for (const r of res.racers) {
      for (const [label, , f] of COUNTERS) {
        const row = (out.counters[label] ??= { EC: 0, AS: 0, NC: 0 });
        row[b] += f(r.stats);
      }
      for (const [label, , f] of MAXES) {
        const row = (out.maxes[label] ??= { EC: 0, AS: 0, NC: 0 });
        row[b] = Math.max(row[b], f(r.stats));
      }
    }
    const pr = (out.props[b] ??= { maxSpeed: 0, maxHeight: 0 });
    pr.maxSpeed = Math.max(pr.maxSpeed, res.global.propMaxSpeed);
    pr.maxHeight = Math.max(pr.maxHeight, res.global.propMaxHeight);
    // Driving feel: the player's car.
    const p = res.racers.find((r) => r.player);
    const f = (out.feel[res.car] ??= { laps: [], top: [], cleanDist: 0, cleanTime: 0, jumps: {}, finish: [] });
    if (res.result.reason === 'finish' && res.mode === 'Classic') f.finish.push({ stage: res.stage, t: res.raceTime });
    for (const t of p.lapTimes) if (t > 5) f.laps.push({ stage: res.stage, t });
    f.top.push(res.topSpeed);
    f.cleanDist += p.clean.dist;
    f.cleanTime += p.clean.time;
    for (const j of p.jumps) {
      const k = `${res.segment}${res.reverse ? '(rev)' : ''}@${j.s}`;
      (f.jumps[k] ??= []).push(j.dist);
    }
  }
  return out;
}

const T = { before: tally(runs.before), after: runs.after ? tally(runs.after) : null };
const fmt = (v, d = 0) => (typeof v === 'number' ? v.toFixed(d) : '-');
const lines = [];
lines.push(`Races: before ${T.before.races} (${T.before.failed} failed, ${T.before.errors} page errors)` + (T.after ? `, after ${T.after.races} (${T.after.failed} failed, ${T.after.errors} page errors)` : ''));
lines.push(`Outcome before: ${JSON.stringify(T.before.outcome)}` + (T.after ? `; after: ${JSON.stringify(T.after.outcome)}` : ''));
lines.push('');
lines.push('| Glitch | ID | EC before | EC after | AS before | AS after | NC before | NC after | Total before | Total after |');
lines.push('|---|---|---|---|---|---|---|---|---|---|');
for (const [label, id] of COUNTERS) {
  const b = T.before.counters[label] ?? { EC: 0, AS: 0, NC: 0 };
  const a = T.after?.counters[label] ?? { EC: NaN, AS: NaN, NC: NaN };
  const tb = b.EC + b.AS + b.NC;
  const ta = a.EC + a.AS + a.NC;
  lines.push(`| ${label} | ${id} | ${b.EC} | ${fmt(a.EC)} | ${b.AS} | ${fmt(a.AS)} | ${b.NC} | ${fmt(a.NC)} | **${tb}** | **${fmt(ta)}** |`);
}
for (const [label, id] of MAXES) {
  const b = T.before.maxes[label] ?? {};
  const a = T.after?.maxes[label] ?? {};
  lines.push(`| ${label} | ${id} | ${fmt(b.EC, 2)} | ${fmt(a.EC, 2)} | ${fmt(b.AS, 2)} | ${fmt(a.AS, 2)} | ${fmt(b.NC, 2)} | ${fmt(a.NC, 2)} | | |`);
}
for (const k of ['maxSpeed', 'maxHeight']) {
  const b = T.before.props;
  const a = T.after?.props ?? {};
  lines.push(`| Prop flight ${k === 'maxSpeed' ? 'top speed (m/s)' : 'max height (m)'} | C7 | ${fmt(b.EC?.[k], 1)} | ${fmt(a.EC?.[k], 1)} | ${fmt(b.AS?.[k], 1)} | ${fmt(a.AS?.[k], 1)} | ${fmt(b.NC?.[k], 1)} | ${fmt(a.NC?.[k], 1)} | | |`);
}

// Driving feel per player car.
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
lines.push('');
lines.push('| Player car | Avg top speed km/h (before / after) | Clean-road avg speed km/h | Classic finish time, mean s | Laps timed |');
lines.push('|---|---|---|---|---|');
for (const car of Object.keys(T.before.feel)) {
  const b = T.before.feel[car];
  const a = T.after?.feel[car];
  const clean = (f) => (f ? (f.cleanDist / Math.max(1, f.cleanTime)) * 3.6 : NaN);
  lines.push(`| ${car} | ${fmt(avg(b.top), 1)} / ${fmt(a ? avg(a.top) : NaN, 1)} | ${fmt(clean(b), 2)} / ${fmt(clean(a), 2)} | ${fmt(avg(b.finish.map((x) => x.t)), 2)} / ${fmt(a ? avg(a.finish.map((x) => x.t)) : NaN, 2)} | ${b.laps.length} / ${a?.laps.length ?? '-'} |`);
}
lines.push('');
lines.push('| Player car | Ramp | Jumps before / after | Mean jump distance m (before / after) |');
lines.push('|---|---|---|---|');
for (const car of Object.keys(T.before.feel)) {
  const bj = T.before.feel[car].jumps;
  const aj = T.after?.feel[car]?.jumps ?? {};
  // Group by ramp: the s positions jitter by a metre or two between runs.
  const group = (jumps) => {
    const g = {};
    for (const [k, list] of Object.entries(jumps)) {
      const [seg, s] = k.split('@');
      const key = `${seg}@${Math.round(Number(s) / 25) * 25}`;
      (g[key] ??= []).push(...list);
    }
    return g;
  };
  const gb = group(bj);
  const ga = group(aj);
  for (const key of [...new Set([...Object.keys(gb), ...Object.keys(ga)])].sort()) {
    const b = gb[key] ?? [];
    const a = ga[key] ?? [];
    if (b.length + a.length < 2) continue;
    lines.push(`| ${car} | ${key} | ${b.length} / ${a.length} | ${fmt(avg(b), 1)} / ${fmt(avg(a), 1)} |`);
  }
}
console.log(lines.join('\n'));
if (jsonOut) await writeFile(jsonOut, JSON.stringify(T, null, 1));
