// Driving feel, build against build: the same scripted drives through two copies of the
// physics (Vehicle, Track, AI) in node, per player car. Straight-line acceleration and top
// speed, nitro, a lap of every route on the game's own AI line (highway only), and every ramp
// jumped at fixed speeds. Nothing random: two runs of one build give identical numbers.
//
//   node tools/qa/feel.mjs --before /path/to/v73 --after . [--json out.json]
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

const arg = (n, f) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : f);
const ROOTS = { before: path.resolve(arg('before', '.')), after: path.resolve(arg('after', '.')) };
const CAR_IDS = ['rp1-vanta', 'rb-ridgeback', 'mz-monza', 'tm-tempesta'];
const DT = 1 / 60;

async function load(root) {
  const im = (p) => import(path.join(root, p));
  return {
    ...(await im('src/race/track.js')),
    ...(await im('src/race/vehicle.js')),
    ...(await im('src/race/ai.js')),
    ...(await im('src/race/routes.js')),
    ...(await im('src/data/tracks.js')),
    ...(await im('src/data/cars.js')),
    ...(await im('src/race/noise.js')),
  };
}

const ctx = () => ({ time: 0, cars: [], props: { items: [] }, racing: true, playerGap: 0, rival: null });
const kmh = (v) => v * 3.6;

function measure(M, car) {
  const params = M.statsToParams(car.stats, car.feel);
  const out = {};
  // A 25 km ring: no corner the AI would brake for, so it is a straight with steering.
  const ring = { ...M.EMERALD_COAST, id: 'ring', ramps: [], slaloms: [], barricades: [], trails: [], bridge: null, fruitStalls: [], neonSigns: [], seabirds: [], points: Array.from({ length: 64 }, (_, i) => [4000 * Math.cos((i / 64) * Math.PI * 2), 0, 4000 * Math.sin((i / 64) * Math.PI * 2)]) };
  const t = new M.Track(ring);
  const drive = (seconds, nitroAt = -1) => {
    const v = new M.Vehicle(t, params, { passiveNitro: 0 });
    v.reset(10, 0);
    v.nitro = 100;
    const ai = new M.AIDriver(v, t, { aggression: 0, skill: 1, rand: M.mulberry32(1) });
    const c = ctx();
    const marks = {};
    let top = 0;
    for (let i = 0; i < seconds / DT; i++) {
      c.time = i * DT;
      const inp = ai.update(DT, c);
      inp.nitroTaps.length = 0;
      if (nitroAt >= 0 && Math.abs(c.time - nitroAt) < DT / 2) inp.nitroTaps.push(c.time);
      v.step(DT, inp, c.time);
      const s = kmh(v.forward);
      for (const m of [100, 160, 200]) if (s >= m && marks[m] == null) marks[m] = +(c.time).toFixed(2);
      top = Math.max(top, s);
    }
    return { marks, top: +top.toFixed(1) };
  };
  const plain = drive(40);
  out.accel = plain.marks;
  out.topSpeed = plain.top;
  out.nitroTop = drive(40, 30).top;
  // A lap of every route on the AI line (no trails, no nitro), as lap time and top speed.
  out.laps = {};
  for (const def of M.TRACKS) {
    const fwd = new M.Track(def);
    for (const [name, track] of [['fwd', fwd], ['rev', new M.Track(M.reverseTrackDef(def, fwd.length))]]) {
      const v = new M.Vehicle(track, params);
      v.reset(0, 0);
      const ai = new M.AIDriver(v, track, { aggression: 0.3, skill: 0.97, rand: M.mulberry32(7) });
      const c = ctx();
      let dist = 0;
      let last = v.proj.s;
      let i = 0;
      let drift = 0;
      for (; i < 400 / DT && dist < track.length; i++) {
        c.time = i * DT;
        const inp = ai.update(DT, c);
        inp.nitroTaps.length = 0;
        v.step(DT, inp, c.time);
        let ds = v.mainProj.s - last;
        if (ds < -track.length / 2) ds += track.length;
        if (ds > track.length / 2) ds -= track.length;
        dist += ds;
        last = v.mainProj.s;
        if (v.drifting) drift += v.speed * DT;
      }
      out.laps[`${def.id} ${name}`] = { time: +(i * DT).toFixed(2), drift: +drift.toFixed(0) };
    }
  }
  // Every ramp, straight over its middle at 35, 50 and 65 m/s: distance and height.
  out.jumps = {};
  for (const def of M.TRACKS) {
    const fwd = new M.Track(def);
    for (const [name, track] of [['fwd', fwd], ['rev', new M.Track(M.reverseTrackDef(def, fwd.length))]]) {
      track.ramps.forEach((r, k) => {
        for (const speed of [35, 50, 65]) {
          const v = new M.Vehicle(track, params);
          const d = (r.from + r.to) / 2;
          v.reset(r.s0 - 50, d);
          let from = null;
          let h = 0;
          let res = null;
          for (let i = 0; i < 400 && !res; i++) {
            const pr = v.proj;
            const hd = Math.atan2(-pr.tz, pr.tx);
            v.heading = hd;
            v.vel.set(Math.cos(hd) * speed, -Math.sin(hd) * speed);
            v.step(DT, { steer: 0, throttle: 0, brake: false, brakePressed: false, nitroTaps: [] }, i * DT);
            if (v.airborne && !from) from = { x: v.pos.x, z: v.pos.z };
            if (v.airborne) h = Math.max(h, v.pos.y - v.groundY);
            if (from && !v.airborne) res = { dist: +Math.hypot(v.pos.x - from.x, v.pos.z - from.z).toFixed(1), height: +h.toFixed(2) };
          }
          out.jumps[`${def.id} ${name} ramp${k + 1} @${speed}`] = res ?? { dist: 0, height: 0 };
        }
      });
    }
  }
  return out;
}

const result = {};
for (const [k, root] of Object.entries(ROOTS)) {
  const M = await load(root);
  result[k] = {};
  for (const id of CAR_IDS) result[k][id] = measure(M, M.CARS.find((c) => c.id === id));
}

const rows = [];
const cmp = (a, b) => `${a ?? '-'} / ${b ?? '-'}`;
rows.push('| Car | 0-100 km/h s | 0-160 | 0-200 | Top speed km/h | Top with nitro |');
rows.push('|---|---|---|---|---|---|');
for (const id of CAR_IDS) {
  const b = result.before[id];
  const a = result.after[id];
  rows.push(`| ${id} | ${cmp(b.accel[100], a.accel[100])} | ${cmp(b.accel[160], a.accel[160])} | ${cmp(b.accel[200], a.accel[200])} | ${cmp(b.topSpeed, a.topSpeed)} | ${cmp(b.nitroTop, a.nitroTop)} |`);
}
rows.push('');
rows.push(`| Route | ${CAR_IDS.map((c) => `${c} lap s (before / after)`).join(' | ')} |`);
rows.push(`|---|${CAR_IDS.map(() => '---').join('|')}|`);
for (const route of Object.keys(result.before[CAR_IDS[0]].laps)) {
  rows.push(`| ${route} | ${CAR_IDS.map((c) => cmp(result.before[c].laps[route].time, result.after[c].laps[route].time)).join(' | ')} |`);
}
rows.push('');
rows.push(`| Ramp jump (vanta) | distance m (before / after) | height m (before / after) |`);
rows.push('|---|---|---|');
let maxDiff = 0;
for (const key of Object.keys(result.before['rp1-vanta'].jumps)) {
  const b = result.before['rp1-vanta'].jumps[key];
  const a = result.after['rp1-vanta'].jumps[key];
  rows.push(`| ${key} | ${cmp(b.dist, a.dist)} | ${cmp(b.height, a.height)} |`);
}
for (const id of CAR_IDS) {
  for (const key of Object.keys(result.before[id].jumps)) {
    if (key.startsWith('alpine-summit rev ramp3')) continue; // lowered on purpose (C12)
    maxDiff = Math.max(maxDiff, Math.abs(result.before[id].jumps[key].dist - result.after[id].jumps[key].dist));
  }
}
rows.push('');
rows.push(`Largest jump distance change on an unchanged ramp, all cars: ${maxDiff.toFixed(1)} m`);
console.log(rows.join('\n'));
const json = arg('json', null);
if (json) await writeFile(json, JSON.stringify(result, null, 1));
