// Driver-view screenshots of every car, versionCode 76 (SwiftShader): the car's own cockpit by
// day (Emerald Coast) and by night (Neon City), at a known race time, on one graphics setting.
//
//   npm run build && node tools/qa/cockpitShots.mjs [--root dir] [--out dir] [--cars id,...]
//     [--quality high|medium|low] [--lowend] [--at 5] [--label name]
//
// --lowend reports a low-end GPU (render/gpuTier.js) and leaves Graphics on Auto. Races are
// stepped by hand at 30 FPS (r.update), as tools/qa/carShots.mjs.
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const root = path.resolve(arg('root', path.resolve(here, '../..')));
const OUT = path.resolve(arg('out', path.join(root, 'qa-shots/cockpits')));
const CARS = arg('cars', 'rp1-vanta,kz-kestrel,sv-stallion,rb-ridgeback,ag-aurelia,mz-monza,tm-tempesta,rpx-hyperion').split(',');
const LOWEND = process.argv.includes('--lowend');
const QUALITY = LOWEND ? null : arg('quality', 'medium');
const AT = Number(arg('at', 5));
const LABEL = arg('label', LOWEND ? 'lowend' : QUALITY);
const STAGES = { day: 'ec-01', night: 'nc-01' };
const [W, H, DPR] = [915, 412, 1.5];

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
await mkdir(OUT, { recursive: true });
const server = await preview({ root, preview: { port: 4368, strictPort: false }, logLevel: 'error' });
const url = `${server.resolvedUrls.local[0]}?debug`;
const report = [];

for (const car of CARS) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.setDefaultTimeout(10 * 60 * 1000);
    page.on('pageerror', (e) => console.error(`[${car}] page error:`, e.message));
    if (LOWEND) {
      await page.addInitScript(() => {
        for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
          const get = C?.prototype.getParameter;
          if (get) C.prototype.getParameter = function (p) { return p === 0x9246 ? 'PowerVR Rogue GE8320' : get.call(this, p); };
        }
      });
    }
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
    for (const [time, stage] of Object.entries(STAGES)) {
      await page.evaluate(async ({ car, stage, quality }) => {
        const app = window.__app;
        if (app.mode === 'race') await app.exitToMap();
        if (quality) window.__garage.setQuality(quality);
        if (!app.state.cars[car]) app.state.cars[car] = JSON.parse(JSON.stringify(app.state.cars[app.state.car]));
        if (!app.state.ownedCars.includes(car)) app.state.ownedCars.push(car);
        app.state.car = car;
        app.state.settings.cameraView = 'cockpit';
        await app.startRace(app.pickStage(stage));
      }, { car, stage, quality: QUALITY });
      await page.waitForTimeout(1200); // the wipe uses wall time
      const info = await page.evaluate((at) => {
        const r = window.__app.race;
        r.stop();
        r.running = true;
        r.autopilot();
        let guard = 0;
        while (r.phase !== 'racing' && guard++ < 900) r.update(1 / 30);
        while (r.raceTime < at && guard++ < 3000) r.update(1 / 30);
        for (let i = 0; i < 3; i++) {
          r.update(1 / 30);
          r.render ? r.render() : r.bloom.render(r.scene, r.camera);
        }
        const c = r.cockpit;
        return { tier: c?.tier, cockpit: c?.constructor?.name, quality: window.__garage.qualityLevel, liveMirror: Boolean(c?.liveMirror), shown: r.cockpitShown };
      }, AT);
      const file = path.join(OUT, `${car}-${LABEL}-${time}.png`);
      await page.screenshot({ path: file });
      if (process.argv.includes('--parts')) {
        // Debug: the cabin alone, then the car body alone.
        for (const [part, cabin, body] of [['cabin', true, false], ['body', false, true]]) {
          await page.evaluate(({ cabin, body }) => {
            const r = window.__app.race;
            r.cockpit.group.visible = cabin;
            r.player.visual.root.visible = body;
            r.render();
            r.cockpit.group.visible = true;
            r.player.visual.root.visible = true;
          }, { cabin, body });
          await page.screenshot({ path: file.replace('.png', `-${part}.png`) });
        }
      }
      report.push({ car, time, file: path.basename(file), ...info });
      console.log(car, time, JSON.stringify(info));
    }
  } catch (err) {
    console.error(`[${car}] failed:`, err.message);
  } finally {
    await browser.close();
  }
}
await writeFile(path.join(OUT, `report-${LABEL}.json`), JSON.stringify(report, null, 1));
server.httpServer.close();
