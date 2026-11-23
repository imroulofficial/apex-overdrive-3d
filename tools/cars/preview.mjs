// In-game preview of a pilot car (garage and race, chase and driver view), old vs new.
// Needs the TEMPORARY loader patch (tools/cars/preview-loader.patch, never committed to src/)
// and the packed files copied to public/assets/pilot/:
//
//   git apply tools/cars/preview-loader.patch
//   mkdir -p public/assets/pilot && cp tools/cars/out/tm_tempesta*.glb public/assets/pilot/
//   npm run build && node tools/cars/preview.mjs [--out dir]
//   git checkout src && rm -r public/assets/pilot        # undo
//
// localStorage 'apex.pilot' = 'new' makes the loader take the pilot files for tm-tempesta.
import { preview } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { seededSave } from '../store/shots.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(arg('out', path.join(here, 'build', 'preview')));
const ONLY = arg('only', null)?.split(',');
const CAR = 'tm-tempesta';
const EYE = { x: -0.175, y: 0.9, z: 0 };

const PAINTS = [
  ['red', '#c8102e', 'metallic'],
  ['blue', '#0d2a6b', 'metallic'],
  ['lime', '#9be22d', 'gloss'],
];

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
await mkdir(OUT, { recursive: true });
const server = await preview({ root, preview: { port: 4361, strictPort: false }, logLevel: 'error' });
const url = `${server.resolvedUrls.local[0]}?debug`;

async function open(variant, { view = 'chase', cockpit = false, w = 1280, h = 720 } = {}) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[${variant}] page error:`, e.message));
  const save = seededSave({ car: CAR, cameraView: view, paint: 'apex-red' });
  await page.addInitScript(({ save, variant, eye }) => {
    localStorage.setItem('apex-overdrive.save.v2', JSON.stringify(save));
    localStorage.setItem('apex.pilot', variant);
    if (eye) globalThis.__pilotEye = eye;
  }, { save, variant, eye: cockpit && variant === 'new' ? EYE : null });
  await page.goto(url);
  await page.waitForFunction(() => window.__app && window.__garage, null, { timeout: 180000 });
  return { browser, page };
}

const want = (n) => !ONLY || ONLY.some((o) => n.startsWith(o));

// Garage: three paints with the stock wheel, then a swap rim.
for (const variant of ['old', 'new']) {
  if (!want(`garage-${variant}`)) continue;
  const { browser, page } = await open(variant);
  await page.evaluate(() => {
    const g = window.__garage;
    g.setQuality?.('high');
  });
  await page.waitForTimeout(6000);
  for (const [name, color, finish] of PAINTS) {
    await page.evaluate(({ color, finish }) => window.__garage.setPaint(color, finish), { color, finish });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, `garage-${variant}-${name}.png`) });
    console.log(`garage-${variant}-${name}`);
  }
  await page.evaluate(() => window.__garage.setRim('monoblock'));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, `garage-${variant}-red-swaprim.png`) });
  console.log(`garage-${variant}-swaprim`);
  await browser.close();
}

// Race: Emerald Coast stage 1, autopilot, chase and driver view at 6 s.
for (const variant of ['old', 'new']) {
  for (const view of ['chase', 'cockpit']) {
    const name = `race-${variant}-${view}`;
    if (!want(name)) continue;
    const { browser, page } = await open(variant, { view, cockpit: view === 'cockpit' });
    await page.evaluate(async ({ view, variant, eye }) => {
      const app = window.__app;
      app.ads.maybeShowInterstitial = async () => false;
      app.ads.setBanner = () => {};
      if (app.dialogue) app.dialogue.play = async () => {};
      window.__garage.setQuality('high');
      app.state.settings.cameraView = view;
      app.state.settings.showFps = false;
      if (view === 'cockpit' && variant === 'new') globalThis.__pilotEye = eye;
      await app.startRace(app.pickStage('ec-01'));
    }, { view, variant, eye: EYE });
    await page.waitForTimeout(1200);
    await page.evaluate(async () => {
      const r = window.__app.race;
      r.stop();
      r.running = true;
      r.autopilot();
      let guard = 0;
      while (r.phase !== 'racing' && guard++ < 900) r.update(1 / 30);
    });
    for (const at of [4, 8, 12, 16]) {
      await page.evaluate(async (at) => {
        const r = window.__app.race;
        let guard = 0;
        while (r.raceTime < at && guard++ < 2000) r.update(1 / 30);
        for (let i = 0; i < 3; i++) {
          r.update(1 / 30);
          r.render();
        }
      }, at);
      await page.screenshot({ path: path.join(OUT, `${name}-t${at}.png`) });
    }
    console.log(name);
    await browser.close();
  }
}
server.httpServer.close();
