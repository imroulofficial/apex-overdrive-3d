// The Phase 0 glitch audit as a repeatable harness: every career stage raced headless by the
// real game (vite preview + Chromium/SwiftShader, ?debug), the player on autopilot and the
// rivals on the game's own AI, while tools/qa/driveProbe.js counts the glitches (C1-C15)
// frame by frame against the rendered geometry. Run it on two builds and compare with
// tools/qa/driveReport.mjs.
//
//   npm run build && node tools/qa/drive.mjs --out before.json
//   node tools/qa/drive.mjs --cars rp1-vanta --stages 0-19 --workers 2 --out ec.json
//   node tools/qa/drive.mjs --survey --out survey.json      (static road vs physics survey)
//   node tools/qa/drive.mjs --fps --out fps.json            (same race at 120/60/45/30/20/15 Hz)
//
// Math.random is replaced by a seeded generator per race, so a race is repeatable on one build.
import { preview } from 'vite';
import { writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(arg('root', path.resolve(here, '../..')));
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);
const CARS = arg('cars', 'rp1-vanta,tm-tempesta,rb-ridgeback,mz-monza').split(',');
const [S0, S1] = arg('stages', '0-59').split('-').map(Number);
const WORKERS = Number(arg('workers', 3));
const OUT = arg('out', null);
const MAX_SECONDS = Number(arg('max', 400));

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await preview({ root, preview: { port: 4400 + Math.floor(Math.random() * 500), strictPort: false }, logLevel: 'error' });
const url = `${server.resolvedUrls.local[0]}?debug`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function openPage() {
  const page = await (await browser.newContext({ viewport: { width: 480, height: 270 } })).newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.addInitScript(() => {
    let a = 1;
    const next = () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    Math.random = next;
    window.__seed = (s) => (a = s);
  });
  await page.addInitScript({ path: path.join(here, 'driveProbe.js') });
  await page.goto(url);
  await page.waitForFunction(() => window.__app && window.__garage, null, { timeout: 180000, polling: 1000 });
  await page.evaluate(() => {
    window.__app.ads.maybeShowInterstitial = async () => false;
    window.__garage.setQuality('low');
  });
  return page;
}

// One race: returns the probe's report plus the race outcome.
async function race(page, car, i) {
  return page.evaluate(async ({ car, i, maxSteps }) => {
    const app = window.__app;
    if (app.mode === 'race') await app.exitToMap();
    // QA only: own the car for this session (the save on disk is not written by the race).
    if (!app.state.cars[car]) app.state.cars[car] = { ...structuredClone(Object.values(app.state.cars)[0]), unlockedBy: 'coins' };
    app.state.car = car;
    window.__seed(1000 + i);
    const stage = app.pickStage(i);
    await app.startRace(stage);
    const r = app.race;
    r.stop();
    r.autopilot();
    const probe = new window.__probe.Probe(r);
    const dt = 1 / 60;
    let steps = 0;
    const t0 = performance.now();
    while (!r.result && steps++ < maxSteps) {
      r.update(dt);
      probe.after(dt);
    }
    const rep = probe.report();
    return {
      car,
      stage: stage.stageId,
      mode: stage.gameMode,
      segment: stage.trackSegment,
      reverse: !!r.track.def.reversed,
      forced: !!r.track.forced,
      result: r.result ? { reason: r.result.reason, position: r.result.position } : { reason: 'no result' },
      simSeconds: +(steps / 60).toFixed(1),
      topSpeed: +(r.topSpeed ?? 0).toFixed(1),
      raceTime: +r.raceTime.toFixed(2),
      wallMs: Math.round(performance.now() - t0),
      ...rep,
    };
  }, { car, i, maxSteps: MAX_SECONDS * 60 });
}

async function drive() {
  const jobs = [];
  for (const car of CARS) for (let i = S0; i <= S1; i++) jobs.push({ car, i });
  const results = [];
  let next = 0;
  const worker = async (w) => {
    let page = await openPage();
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        const res = await race(page, job.car, job.i);
        res.errors = page.errors.splice(0);
        results.push(res);
        if (OUT) await appendFile(`${OUT}.jsonl`, `${JSON.stringify(res)}\n`);
        const p = res.racers.find((x) => x.player)?.stats ?? {};
        console.log(`[w${w}] ${job.car} ${res.stage} ${res.mode} ${res.result.reason} ${res.simSeconds}s wall ${(res.wallMs / 1000).toFixed(0)}s snaps ${p.heightSnap ?? 0} offRamp ${p.offRampTakeoff ?? 0} errors ${res.errors.length}`);
      } catch (e) {
        console.log(`[w${w}] ${job.car} stage ${job.i} FAILED ${e.message.split('\n')[0]}`);
        results.push({ car: job.car, stageIndex: job.i, failed: e.message.split('\n')[0] });
        await page.context().close().catch(() => {});
        page = await openPage();
      }
    }
    await page.context().close();
  };
  await Promise.all(Array.from({ length: Math.min(WORKERS, jobs.length) }, (_, w) => worker(w)));
  results.sort((a, b) => (a.car + a.stage).localeCompare(b.car + b.stage));
  return { kind: 'drive', cars: CARS, stages: [S0, S1], results };
}

// Static survey: every route of every track, rendered road vs the height the car is shown at.
async function survey() {
  const page = await openPage();
  const stages = await page.evaluate(() => window.__app.stageIds);
  // One stage per (segment, direction): the probe surveys whatever route that stage loads.
  const picks = await page.evaluate(() => {
    const seen = new Map();
    window.__app.stageIds.forEach((id, i) => {
      const s = window.__app.pickStage(i);
      const key = `${s.trackSegment}`;
      if (!seen.has(key)) seen.set(key, i);
    });
    return [...seen.entries()];
  });
  const out = {};
  for (const [key, i] of picks) {
    const res = await page.evaluate(async (i) => {
      const app = window.__app;
      if (app.mode === 'race') await app.exitToMap();
      const stage = app.pickStage(i);
      await app.startRace(stage);
      const r = app.race;
      r.stop();
      const v = r.player.vehicle;
      const shown = v.visualGroundAt ? (tr, s, d) => tr.heightAt(s, d) + (tr.surfaceOffset ? tr.surfaceOffset(s, d) : 0) : null;
      return { stage: stage.stageId, route: r.track.def.reversed ? 'reverse' : 'forward', zones: window.__probe.survey(r, { groundFn: shown }) };
    }, i);
    out[key] = res;
    console.log(key, JSON.stringify(res.zones));
  }
  await page.context().close();
  return { kind: 'survey', stages: stages.length, routes: out };
}

// Frame-rate independence (C10): the same seeded race at several frame rates.
async function fps() {
  const page = await openPage();
  const rates = [120, 60, 45, 30, 20, 15];
  const out = [];
  for (const stageIndex of [0, 20, 40]) {
    for (const hz of rates) {
      const res = await page.evaluate(async ({ i, hz }) => {
        const app = window.__app;
        if (app.mode === 'race') await app.exitToMap();
        window.__seed(77);
        const stage = app.pickStage(i);
        await app.startRace(stage);
        const r = app.race;
        r.stop();
        r.autopilot();
        const v = r.player.vehicle;
        const dt = 1 / hz;
        let t = 0;
        const marks = [];
        let maxH = 0;
        let takeoffs = 0;
        let air = false;
        while (t < 45 && !r.result) {
          r.update(dt);
          t += dt;
          if (v.airborne) maxH = Math.max(maxH, v.pos.y - (v.groundY ?? v.pos.y));
          if (v.airborne && !air) takeoffs++;
          air = v.airborne;
          if (marks.length < Math.floor(t / 5)) marks.push(+r.player.dist.toFixed(1));
        }
        return { stage: stage.stageId, hz, raceTime: +r.raceTime.toFixed(2), dist: +r.player.dist.toFixed(1), marks, maxH: +maxH.toFixed(2), takeoffs };
      }, { i: stageIndex, hz });
      out.push(res);
      console.log(JSON.stringify(res));
    }
  }
  await page.context().close();
  return { kind: 'fps', rows: out };
}

const t0 = Date.now();
const data = flag('survey') ? await survey() : flag('fps') ? await fps() : await drive();
data.wallSeconds = Math.round((Date.now() - t0) / 1000);
if (OUT) await writeFile(OUT, JSON.stringify(data));
console.log('done in', data.wallSeconds, 's');
await browser.close();
server.httpServer.close();
