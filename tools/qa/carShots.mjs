// Headless screenshots of every car, versionCode 75 (SwiftShader): the garage (Factory Livery,
// a bought paint, a swap rim), a race in Chase by day and night, the car's own cockpit by day
// and night, the door windows down (tapped on the HUD's window button), the live mirror, and
// the low-end GPU on Graphics Auto vs a manually chosen Graphics: High.
//
//   npm run build && node tools/qa/carShots.mjs [--out dir] [--cars id,...] [--only set,...]
//     sets: garage, day, night, lowend, lowhigh
//
// Races are stepped by hand at 30 FPS (r.update; only the last frames are drawn), as
// tools/qa/hudShots.mjs, so every shot is taken at a known race time.
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(arg('out', path.join(root, 'qa-shots/cars')));
const CARS = arg('cars', 'rp1-vanta,kz-kestrel,sv-stallion,rb-ridgeback,ag-aurelia,mz-monza,tm-tempesta,rpx-hyperion').split(',');
const ONLY = arg('only', null)?.split(',');
const SETS = ['garage', 'day', 'night', 'lowend', 'lowhigh'].filter((s) => !ONLY || ONLY.includes(s));
const [W, H, DPR] = [915, 412, 1.5];

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
await mkdir(OUT, { recursive: true });
const server = await preview({ root, preview: { port: 4367, strictPort: false }, logLevel: 'error' });
const url = `${server.resolvedUrls.local[0]}?debug`;
const LOWEND_GPU = () => {
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    const get = C?.prototype.getParameter;
    if (get) C.prototype.getParameter = function (p) { return p === 0x9246 ? 'PowerVR Rogue GE8320' : get.call(this, p); };
  }
};
const report = [];

async function session(car, set, fn) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.setDefaultTimeout(10 * 60 * 1000);
    page.on('pageerror', (e) => console.error(`[${car} ${set}] page error:`, e.message));
    page.on('console', (m) => m.type() === 'error' && console.error(`[${car} ${set}] console:`, m.text().slice(0, 300)));
    if (set === 'lowend' || set === 'lowhigh') await page.addInitScript(LOWEND_GPU);
    await page.goto(url);
    await page.waitForFunction(() => window.__app && window.__garage, null, { timeout: 180000 });
    await page.evaluate(() => {
      const app = window.__app;
      app.ads.maybeShowInterstitial = async () => false;
      app.ads.setBanner = () => {};
      if (app.dialogue) app.dialogue.play = async () => {};
      app.state.settings.showFps = false;
      document.querySelector('#splash')?.classList.add('is-done');
    });
    await fn(page);
  } catch (err) {
    console.error(`[${car} ${set}] failed:`, err.message);
  } finally {
    await browser.close();
  }
}

const shot = async (page, car, name, info = {}) => {
  const file = path.join(OUT, `${car}-${name}.png`);
  await page.screenshot({ path: file });
  report.push({ car, name, ...info });
  console.log(car, name, JSON.stringify(info));
};

// Starts a race on `stage` in `view` and steps it to `at` seconds of race time.
async function race(page, { car, stage, view, quality, manual, at = 5 }) {
  await page.evaluate(async ({ car, stage, view, quality, manual }) => {
    const app = window.__app;
    if (quality) window.__garage.setQuality(quality);
    if (manual) app.state.settings.quality = quality;
    // Own the car for the shot (in memory only; the harness never saves).
    if (!app.state.cars[car]) app.state.cars[car] = JSON.parse(JSON.stringify(app.state.cars[app.state.car]));
    if (!app.state.ownedCars.includes(car)) app.state.ownedCars.push(car);
    app.state.car = car;
    app.state.settings.cameraView = view;
    await app.startRace(app.pickStage(stage));
  }, { car, stage, view, quality, manual });
  await page.waitForTimeout(1200); // the wipe uses wall time
  await page.evaluate((at) => {
    const r = window.__app.race;
    r.stop();
    r.running = true;
    r.autopilot();
    let guard = 0;
    while (r.phase !== 'racing' && guard++ < 900) r.update(1 / 30);
    while (r.raceTime < at && guard++ < 3000) r.update(1 / 30);
    for (let i = 0; i < 3; i++) {
      r.update(1 / 30);
      r.render();
    }
  }, at);
}

const frames = (page, n = 3) =>
  page.evaluate((n) => {
    const r = window.__app.race;
    for (let i = 0; i < n; i++) {
      r.update(1 / 30);
      r.render();
    }
  }, n);

const state = (page) =>
  page.evaluate(() => {
    const r = window.__app.race;
    const c = r.cockpit;
    const hud = document.querySelector('#race-hud');
    const btn = document.querySelector('#rh-win');
    return {
      view: r.chase.view,
      cockpit: c?.constructor?.name,
      tier: c?.tier,
      liveMirror: c?.liveMirror,
      quality: window.__garage.qualityLevel,
      windows: +r.windows.level.toFixed(2),
      button: btn ? getComputedStyle(btn).display !== 'none' : null,
      pressed: btn?.getAttribute('aria-pressed'),
      hudWindows: hud?.dataset.windows,
    };
  });

for (const car of CARS) {
  for (const set of SETS) {
    await session(car, set, async (page) => {
      if (set === 'garage') {
        await page.evaluate(() => window.__garage.setQuality('high'));
        for (const [name, paint, rim] of [['garage-factory', 'factory', 'stock'], ['garage-paint', 'apex-red', 'stock'], ['garage-rim', 'apex-red', 'turbofan']]) {
          await page.evaluate(async ({ car, paint, rim }) => {
            const g = window.__garage;
            await window.__app.showCar(car);
            const [color, finish] = { factory: ['#d9dde3', 'factory'], 'apex-red': ['#c8102e', 'metallic'] }[paint];
            g.setPaint(color, finish);
            g.setRim(rim);
          }, { car, paint, rim });
          // The paint fades over (PaintTransition): wait until it has landed.
          await page.waitForTimeout(3000);
          await page.waitForFunction(() => { const p = window.__garage.paint; return !p || p.t === undefined || p.t >= 1; }, null, { timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(1500);
          const info = await page.evaluate(() => ({ colour: `#${window.__garage.car.paintMaterial.color.getHexString()}`, rim: window.__garage.car.rim }));
          await shot(page, car, name, info);
        }
      } else if (set === 'day') {
        await race(page, { car, stage: 'ec-01', view: 'cockpit', quality: 'high' });
        await shot(page, car, 'cockpit-day', await state(page));
        // The window button, tapped like a finger, then the windows animate down.
        const btn = page.locator('#rh-win');
        if (await btn.isVisible()) {
          await btn.tap();
          await frames(page, 40);
          await shot(page, car, 'window-open', await state(page));
          await btn.tap();
          await frames(page, 40);
        } else report.push({ car, name: 'window-open', skipped: 'no window button (car without door windows)', ...(await state(page)) });
        // The live mirror up close: the driver's camera narrowed onto the middle mirror.
        await page.evaluate(() => {
          const r = window.__app.race;
          const c = r.cockpit;
          const inner = c.group.children[0]?.children[0];
          const target = c.mirrorAt.clone().applyMatrix4(inner?.matrixWorld ?? c.group.matrixWorld);
          r.camera.lookAt(target);
          r.camera.fov = 24;
          r.camera.updateProjectionMatrix();
          c.renderMirror?.(r.renderer, r.scene, true);
          r.renderer.render(r.scene, r.camera);
        });
        await shot(page, car, 'mirror', await state(page));
        // Back to Chase through the HUD's own camera key.
        for (let i = 0; i < 3 && (await page.evaluate(() => window.__app.state.settings.cameraView)) !== 'chase'; i++) await page.keyboard.press('KeyC');
        await frames(page, 30);
        await shot(page, car, 'chase-day', await state(page));
      } else if (set === 'night') {
        await race(page, { car, stage: 'nc-01', view: 'cockpit', quality: 'high' });
        await shot(page, car, 'cockpit-night', await state(page));
        for (let i = 0; i < 3 && (await page.evaluate(() => window.__app.state.settings.cameraView)) !== 'chase'; i++) await page.keyboard.press('KeyC');
        await frames(page, 30);
        await shot(page, car, 'chase-night', await state(page));
      } else if (set === 'lowend') {
        await race(page, { car, stage: 'ec-01', view: 'cockpit' });
        await shot(page, car, 'lowend-auto', await state(page));
        for (let i = 0; i < 3 && (await page.evaluate(() => window.__app.state.settings.cameraView)) !== 'chase'; i++) await page.keyboard.press('KeyC');
        await frames(page, 30);
        await shot(page, car, 'lowend-chase', await state(page));
      } else if (set === 'lowhigh') {
        await race(page, { car, stage: 'ec-01', view: 'cockpit', quality: 'high', manual: true });
        await shot(page, car, 'lowend-graphics-high', await state(page));
      }
    });
  }
}
await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
server.httpServer.close();
