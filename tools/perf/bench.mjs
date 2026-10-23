// Headless performance and memory bench for the race (SwiftShader, so absolute frame times
// are only comparable with each other, run to run on the same machine).
//
//   npm run build && node tools/perf/bench.mjs [--stages all|ec-01,as-07,...] [--quality high]
//     [--samples 12] [--cycles 6] [--out file.json]
//
// Per stage: the player's car races on autopilot and every few steps one frame is measured:
// draw calls and triangles of the whole frame (scene + shadow map + bloom passes), the shadow
// pass on its own, the JS time of Race.update and the time to render (GPU-synced).
// Memory: garage -> map -> race -> map -> garage cycles across all three tracks, reading
// renderer.info.memory (live geometries / textures), shader programs and the JS heap after
// each return to the garage.
import { preview } from 'vite';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const STAGES = arg('stages', 'ec-01,ec-10,ec-20,as-01,as-10,as-20,nc-01,nc-10,nc-20');
const CYCLES = Number(arg('cycles', 6));
const SAMPLES = Number(arg('samples', 12));
const OUT = arg('out', null);
// Fixed quality, so the garage's auto quality (SwiftShader is slow) cannot step it down mid-run.
const QUALITY = arg('quality', 'high');

let chromium;
try {
  ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright'));
} catch {
  console.error('Playwright is not installed: npm i --no-save playwright');
  process.exit(1);
}

const server = await preview({ root, preview: { port: 4317, strictPort: false }, logLevel: 'error' });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
// A mid-range Android phone in landscape: 2400x1080 panel at DPR 3.
const context = await browser.newContext({ viewport: { width: 800, height: 360 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.__app && window.__garage, null, { timeout: 120000 });

// Instruments the shared renderer: frame totals across every render() call, and the shadow pass.
await page.evaluate(() => {
  const R = window.__garage.renderer;
  const acc = { calls: 0, tris: 0, shadowCalls: 0, shadowTris: 0 };
  window.__perf = acc;
  const render = R.render.bind(R);
  R.render = (scene, camera) => {
    render(scene, camera);
    acc.calls += R.info.render.calls;
    acc.tris += R.info.render.triangles;
  };
  const shadow = R.shadowMap.render.bind(R.shadowMap);
  R.shadowMap.render = (...a) => {
    const c = R.info.render.calls;
    const t = R.info.render.triangles;
    shadow(...a);
    acc.shadowCalls += R.info.render.calls - c;
    acc.shadowTris += R.info.render.triangles - t;
  };
  window.__app.ads.maybeShowInterstitial = async () => false;
  window.__app.ads.setBanner = () => {};
});
await page.evaluate((q) => window.__garage.setQuality(q), QUALITY);

const ids = STAGES === 'all' ? await page.evaluate(() => window.__app.stageIds) : STAGES.split(',');

async function enterStage(id) {
  await page.evaluate(async (id) => {
    const app = window.__app;
    if (app.mode === 'race') await app.exitToMap();
    if (app.mode === 'map') await app.backToGarage();
    await app.startRace(app.pickStage(id));
  }, id);
}

const stages = [];
for (const id of ids) {
  await enterStage(id);
  const res = await page.evaluate(async ({ samples }) => {
    const app = window.__app;
    const r = app.race;
    const R = r.renderer;
    const gl = R.getContext();
    const px = new Uint8Array(4);
    r.stop();
    r.autopilot();
    let guard = 0;
    while (r.phase !== 'racing' && guard++ < 600) r.update(1 / 30);
    const acc = window.__perf;
    const frames = [];
    for (let i = 0; i < samples && !r.result; i++) {
      for (let k = 0; k < 20 && !r.result; k++) r.update(1 / 30);
      const t0 = performance.now();
      r.update(1 / 60);
      const t1 = performance.now();
      acc.calls = acc.tris = acc.shadowCalls = acc.shadowTris = 0;
      r.bloom.render(r.scene, r.camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t2 = performance.now();
      frames.push({ calls: acc.calls, tris: acc.tris, shadowCalls: acc.shadowCalls, shadowTris: acc.shadowTris, update: t1 - t0, render: t2 - t1 });
    }
    const avg = (k) => frames.reduce((a, f) => a + f[k], 0) / Math.max(1, frames.length);
    const max = (k) => Math.max(...frames.map((f) => f[k]));
    return {
      stage: app.stage.stageId,
      mode: app.stage.gameMode,
      frames: frames.length,
      pixelRatio: R.getPixelRatio(),
      drawBuffer: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
      calls: Math.round(avg('calls')),
      callsMax: max('calls'),
      tris: Math.round(avg('tris')),
      shadowCalls: Math.round(avg('shadowCalls')),
      shadowTris: Math.round(avg('shadowTris')),
      chunked: r.culling ? r.culling.stats().chunked.map((c) => `${c.name}:${c.chunks}`).join(' ') : null,
      updateMs: +avg('update').toFixed(2),
      renderMs: +avg('render').toFixed(1),
    };
  }, { samples: SAMPLES });
  stages.push(res);
  console.log(JSON.stringify(res));
}

// Memory across race -> garage cycles, alternating tracks.
const cycleStages = ['ec-01', 'as-02', 'nc-03'];
const memory = [];
const snapshot = async (label) => {
  const m = await page.evaluate(async () => {
    window.gc?.();
    await new Promise((r) => setTimeout(r, 50));
    window.gc?.();
    const R = window.__garage.renderer;
    return {
      mode: window.__app.mode,
      geometries: R.info.memory.geometries,
      textures: R.info.memory.textures,
      programs: R.info.programs?.length ?? 0,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      raceAlive: Boolean(window.__app.race?.scene),
    };
  });
  m.label = label;
  memory.push(m);
  console.log(JSON.stringify(m));
};
await page.evaluate(async () => {
  const app = window.__app;
  if (app.mode === 'race') await app.exitToMap();
  if (app.mode === 'map') await app.backToGarage();
});
await snapshot('garage (start)');
for (let c = 0; c < CYCLES; c++) {
  const id = cycleStages[c % cycleStages.length];
  await enterStage(id);
  await page.evaluate(async () => {
    const r = window.__app.race;
    r.stop();
    r.autopilot();
    for (let i = 0; i < 300; i++) r.update(1 / 30);
    r.bloom.render(r.scene, r.camera);
  });
  await snapshot(`in race ${id}`);
  await page.evaluate(async () => {
    const app = window.__app;
    await app.exitToMap();
    await app.backToGarage();
    await new Promise((r) => setTimeout(r, 300));
  });
  await snapshot(`garage after ${id}`);
}

// Browsing the roster in the garage: every car on the turntable once, then the first again.
const carIds = await page.evaluate(() => window.__app.carIds ?? null);
if (carIds) {
  for (const id of [...carIds, carIds[0]]) {
    await page.evaluate(async (id) => {
      const app = window.__app;
      await app.showCar(id);
      await new Promise((r) => setTimeout(r, 400));
    }, id);
    await snapshot(`garage showing ${id}`);
  }
}

const summary = {
  avgCalls: Math.round(stages.reduce((a, s) => a + s.calls, 0) / stages.length),
  maxCalls: Math.max(...stages.map((s) => s.callsMax)),
  avgTris: Math.round(stages.reduce((a, s) => a + s.tris, 0) / stages.length),
  avgShadowCalls: Math.round(stages.reduce((a, s) => a + s.shadowCalls, 0) / stages.length),
  avgUpdateMs: +(stages.reduce((a, s) => a + s.updateMs, 0) / stages.length).toFixed(2),
  avgRenderMs: +(stages.reduce((a, s) => a + s.renderMs, 0) / stages.length).toFixed(1),
};
console.log('summary', JSON.stringify(summary));
if (OUT) await writeFile(OUT, JSON.stringify({ stages, memory, summary }, null, 2));
await browser.close();
server.httpServer.close();
