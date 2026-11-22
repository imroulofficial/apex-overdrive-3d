// Headless race HUD and camera screenshots (SwiftShader): the HUD in the chase view (normal
// and with NITRO lit), the driver view going straight and steering hard left / right, a
// free-look drag in progress, and the HUD on a small phone and a tablet.
//
//   npm run build && node tools/qa/hudShots.mjs [--out dir] [--stage ec-01] [--only name,...]
//     [--lowend]
//
// The race is stepped by hand at 30 FPS (r.update; only the last frames are drawn) so every
// shot is taken at a known race time. The free-look drag is real pointer input on the canvas (page.mouse).
import { preview } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(arg('out', path.join(root, 'qa-shots')));
const STAGE = arg('stage', 'ec-01');
const ONLY = arg('only', null)?.split(',');
const LOWEND = process.argv.includes('--lowend');

// Phone 720x1600 at 2x in landscape is 800x360 CSS px; a common 20:9 phone 915x412; a 10"
// tablet 1280x800.
const SIZES = { phone: [915, 412, 2], small: [800, 360, 2], tablet: [1280, 800, 1.5] };
const SHOTS = [
  { name: '01-hud-chase', size: 'phone', view: 'chase', at: 4 },
  { name: '02-hud-chase-nitro', size: 'phone', view: 'chase', at: 4, nitro: true },
  { name: '03-cockpit-straight', size: 'phone', view: 'cockpit', at: 4, steer: 0 },
  { name: '04-cockpit-hard-left', size: 'phone', view: 'cockpit', at: 4, steer: -1 },
  { name: '05-cockpit-hard-right', size: 'phone', view: 'cockpit', at: 4, steer: 1 },
  { name: '06-free-look-mid-drag', size: 'phone', view: 'chase', at: 4, drag: true },
  { name: '07-hud-small-phone-720x1600', size: 'small', view: 'chase', at: 4 },
  { name: '08-hud-tablet', size: 'tablet', view: 'chase', at: 4 },
  { name: '09-cockpit-small-phone', size: 'small', view: 'cockpit', at: 4 },
  { name: '10-cockpit-tablet', size: 'tablet', view: 'cockpit', at: 4 },
].filter((s) => !ONLY || ONLY.includes(s.name));

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
await mkdir(OUT, { recursive: true });
const server = await preview({ root, preview: { port: 4357, strictPort: false }, logLevel: 'error' });
const url = `${server.resolvedUrls.local[0]}?debug`;

for (const shot of SHOTS) {
  const [w, h, dpr] = SIZES[shot.size];
  // One browser per shot: SwiftShader tabs are not reliable over many races.
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[${shot.name}] page error:`, e.message));
  if (LOWEND) {
    await page.addInitScript(() => {
      for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        const get = C?.prototype.getParameter;
        if (get) C.prototype.getParameter = function (p) { return p === 0x9246 ? 'PowerVR Rogue GE8320' : get.call(this, p); };
      }
    });
  }
  await page.goto(url);
  await page.waitForFunction(() => window.__app && window.__garage, null, { timeout: 120000 });
  await page.evaluate(async ({ stage, view, lowend }) => {
    const app = window.__app;
    app.ads.maybeShowInterstitial = async () => false;
    app.ads.setBanner = () => {};
    if (app.dialogue) app.dialogue.play = async () => {};
    if (!lowend) window.__garage.setQuality('high');
    app.state.settings.cameraView = view;
    app.state.settings.showFps = false;
    await app.startRace(app.pickStage(stage));
  }, { stage: STAGE, view: shot.view, lowend: LOWEND });
  // The race HUD clock and the wipe use wall time: wait for the wipe to leave.
  await page.waitForTimeout(1200);
  await page.evaluate(async ({ at, nitro, steer }) => {
    const r = window.__app.race;
    r.stop();
    r.running = true; // stepped by hand from here, but still a live race (free look allowed)
    r.autopilot();
    // Rendering is what costs on SwiftShader: only the frames just before the shot are drawn.
    const step = (draw = false) => {
      r.update(1 / 30);
      if (draw) r.bloom.render(r.scene, r.camera);
    };
    let guard = 0;
    while (r.phase !== 'racing' && guard++ < 900) step();
    while (r.raceTime < at && guard++ < 2000) step();
    if (nitro) {
      r.player.vehicle.nitro = 100;
      r.player.vehicle.addNitro?.(100);
    }
    if (steer !== undefined) {
      // The player's own input from here: a held steering lock, throttle on.
      r.player.ai = null;
      const held = { steer, throttle: 1, brake: 0, brakePressed: false, nitroTaps: [] };
      r.input.read = () => held;
      for (let i = 0; i < 12; i++) step(i > 9);
    } else if (nitro) {
      const taps = [];
      const ai = r.player.ai;
      const read = ai.update.bind(ai);
      // A blue nitro tap through the vehicle's own input path.
      ai.update = (h, ctx) => {
        const inp = read(h, ctx);
        inp.nitroTaps = taps;
        return inp;
      };
      taps.push(performance.now() / 1000);
      step();
      taps.length = 0;
      for (let i = 0; i < 14; i++) step(i > 11);
    }
  }, shot);
  if (shot.drag) {
    // A real finger-style drag on empty screen (the canvas), held while the frames render.
    await page.mouse.move(w * 0.5, h * 0.42);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(w * 0.5 + i * 22, h * 0.42 + i * 2);
      await page.evaluate(() => {
        const r = window.__app.race;
        for (let k = 0; k < 2; k++) {
          r.update(1 / 30);
          r.bloom.render(r.scene, r.camera);
        }
      });
    }
  }
  const info = await page.evaluate(() => {
    const r = window.__app.race;
    r.bloom.render(r.scene, r.camera);
    const v = r.player.vehicle;
    return { view: r.chase.view, freeYaw: +r.chase.free.yaw.toFixed(3), kmh: Math.round(Math.abs(v.forward) * 3.6), tier: v.tier, steer: r.player.visual.steerInput, rpm: Math.round(r.gearbox.rpm), cockpit: r.cockpitShown, quality: window.__garage.qualityLevel };
  });
  await page.screenshot({ path: path.join(OUT, `${shot.name}.png`) });
  if (shot.drag) await page.mouse.up();
  console.log(shot.name, JSON.stringify(info));
  await browser.close();
}
server.httpServer.close();
