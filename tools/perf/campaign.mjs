// Headless run of the whole campaign through the real game flow (main.js): every stage is
// started from the world map, driven to the end by the autopilot and banked, and every fifth
// stage the player goes back to the garage (which frees the track). Checks that each stage
// finishes, that its stars land in the saved game, and that GPU memory comes back down.
//
//   npm run build && node tools/perf/campaign.mjs [--from 0] [--to 60] [--out file.json]
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
const FROM = Number(arg('from', 0));
const TO = Number(arg('to', 60));
const OUT = arg('out', null);

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await preview({ root, preview: { port: 4327, strictPort: false }, logLevel: 'error' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 300 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${server.resolvedUrls.local[0]}?debug`);
await page.waitForFunction(() => window.__app && window.__garage, null, { timeout: 120000 });
await page.evaluate(() => {
  window.__app.ads.maybeShowInterstitial = async () => false;
  window.__garage.setQuality('low');
});

const garageMemory = () => page.evaluate(() => {
  const m = window.__garage.renderer.info.memory;
  return { geometries: m.geometries, textures: m.textures, raceAlive: Boolean(window.__app.race) };
});
const garageStart = await garageMemory();
const rows = [];
for (let i = FROM; i < TO; i++) {
  const row = await page.evaluate(async (i) => {
    const app = window.__app;
    if (app.mode === 'race') await app.exitToMap();
    if (i % 5 === 0 && app.mode === 'map') await app.backToGarage();
    const stage = app.pickStage(i);
    await app.startRace(stage);
    const r = app.race;
    r.stop();
    r.autopilot();
    let steps = 0;
    while (!r.result && steps++ < 30 * 60 * 8) r.update(1 / 30);
    r.bloom.render(r.scene, r.camera);
    const saved = JSON.parse(localStorage.getItem('apex-overdrive.save.v2'));
    const info = r.renderer.info.memory;
    return {
      stage: stage.stageId,
      mode: stage.gameMode,
      reason: r.result?.reason ?? 'no result',
      position: r.result?.position ?? null,
      stars: app.state.career.stageStars[stage.index],
      savedStars: saved?.career?.stageStars?.[stage.index],
      unlocked: app.state.career.unlockedStage,
      simSeconds: Math.round(steps / 30),
      geometries: info.geometries,
      textures: info.textures,
    };
  }, i);
  rows.push(row);
  console.log(JSON.stringify(row));
}
await page.evaluate(async () => {
  const app = window.__app;
  if (app.mode === 'race') await app.exitToMap();
  if (app.mode === 'map') await app.backToGarage();
});
const garage = await garageMemory();
const summary = {
  stages: rows.length,
  withResult: rows.filter((r) => r.reason !== 'no result').length,
  starsMatchSave: rows.every((r) => r.stars === r.savedStars),
  starsTotal: rows.reduce((n, r) => n + ((r.stars & 1) + ((r.stars >> 1) & 1) + ((r.stars >> 2) & 1)), 0),
  pageErrors: errors,
  garageStart,
  garage,
};
console.log('summary', JSON.stringify(summary));
if (OUT) await writeFile(OUT, JSON.stringify({ rows, summary }, null, 2));
await browser.close();
server.httpServer.close();
