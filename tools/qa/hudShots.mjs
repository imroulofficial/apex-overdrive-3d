// Headless race camera screenshots (SwiftShader), versionCodes 72-73: the cockpit going straight,
// steering hard left / right, at night, in the rain, with a rival car overlapping the player's,
// on a low-end GPU, on a small phone and a tablet; and Chase and Close for comparison.
//
//   npm run build && node tools/qa/hudShots.mjs [--out dir] [--stage ec-01] [--only name,...]
//     [--lowend]   (every shot as a low-end GPU; one shot below is always low-end)
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
  { name: '01-cockpit-straight', size: 'phone', view: 'cockpit', at: 6, steer: 0 },
  { name: '02-cockpit-hard-left', size: 'phone', view: 'cockpit', at: 6, steer: -1 },
  { name: '03-cockpit-hard-right', size: 'phone', view: 'cockpit', at: 6, steer: 1 },
  { name: '04-cockpit-night', size: 'phone', view: 'cockpit', at: 6, stage: 'nc-01' },
  { name: '05-cockpit-rain', size: 'phone', view: 'cockpit', at: 6, stage: 'ec-09' },
  { name: '06-cockpit-rival-alongside', size: 'phone', view: 'cockpit', at: 6, rival: true },
  { name: '07-cockpit-lowend', size: 'phone', view: 'cockpit', at: 6, lowend: true },
  { name: '08-cockpit-small-phone-720x1600', size: 'small', view: 'cockpit', at: 6 },
  { name: '09-cockpit-tablet', size: 'tablet', view: 'cockpit', at: 6 },
  { name: '10-chase', size: 'phone', view: 'chase', at: 6 },
  { name: '11-close', size: 'phone', view: 'close', at: 9 },
  { name: '12-chase-free-look-mid-drag', size: 'phone', view: 'chase', at: 6, drag: true },
  // versionCode 73: close-ups of the model (the camera narrowed onto a part after the frame).
  { name: '13-wheel-and-hands-closeup', size: 'phone', view: 'cockpit', at: 6, steer: 0.35, zoom: 'wheel' },
  { name: '14-instrument-cluster-closeup', size: 'phone', view: 'cockpit', at: 6, zoom: 'cluster' },
  { name: '15-cockpit-mid-tier', size: 'phone', view: 'cockpit', at: 6, quality: 'medium' },
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
  const lowend = LOWEND || !!shot.lowend;
  if (lowend) {
    await page.addInitScript(() => {
      for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        const get = C?.prototype.getParameter;
        if (get) C.prototype.getParameter = function (p) { return p === 0x9246 ? 'PowerVR Rogue GE8320' : get.call(this, p); };
      }
    });
  }
  await page.goto(url);
  await page.waitForFunction(() => window.__app && window.__garage, null, { timeout: 120000 });
  await page.evaluate(async ({ stage, view, lowend, quality }) => {
    const app = window.__app;
    app.ads.maybeShowInterstitial = async () => false;
    app.ads.setBanner = () => {};
    if (app.dialogue) app.dialogue.play = async () => {};
    if (!lowend) window.__garage.setQuality(quality ?? 'high');
    app.state.settings.cameraView = view;
    app.state.settings.showFps = false;
    await app.startRace(app.pickStage(stage));
  }, { stage: shot.stage ?? STAGE, view: shot.view, lowend, quality: shot.quality });
  // The race HUD clock and the wipe use wall time: wait for the wipe to leave.
  await page.waitForTimeout(1200);
  await page.evaluate(async ({ at, nitro, steer, rival }) => {
    const r = window.__app.race;
    r.stop();
    r.running = true; // stepped by hand from here, but still a live race (free look allowed)
    r.autopilot();
    // Rendering is what costs on SwiftShader: only the frames just before the shot are drawn.
    const step = (draw = false) => {
      r.update(1 / 30);
      if (draw) r.render();
    };
    let guard = 0;
    while (r.phase !== 'racing' && guard++ < 900) step();
    while (r.raceTime < at && guard++ < 2000) step();
    if (nitro) {
      r.player.vehicle.nitro = 100;
      r.player.vehicle.addNitro?.(100);
    }
    if (rival) {
      // A rival pressed into the player's right side, overlapping the cabin.
      const v = r.player.vehicle;
      const other = r.racers.find((x) => !x.isPlayer);
      const pin = () => {
        const o = other.vehicle;
        const rz = Math.cos(v.heading);
        const rx = Math.sin(v.heading);
        o.pos.set(v.pos.x + rx * 1.15 + Math.cos(v.heading) * 0.6, v.pos.y, v.pos.z + rz * 1.15 - Math.sin(v.heading) * 0.6);
        o.heading = v.heading;
        o.vel.copy(v.vel);
      };
      for (let i = 0; i < 12; i++) {
        pin();
        step(i > 9);
      }
    } else if (steer !== undefined) {
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
          r.render();
        }
      });
    }
  }
  const info = await page.evaluate((zoom) => {
    const r = window.__app.race;
    if (zoom) {
      // Narrow the driver's camera onto the wheel or the cluster (the eye stays where it is).
      const c = r.cockpit;
      const THREE_V = r.camera.position.constructor;
      const target = new THREE_V();
      (zoom === 'wheel' ? c.wheelPivot : c.display).getWorldPosition(target);
      r.camera.lookAt(target);
      r.camera.fov = zoom === 'wheel' ? 30 : 17;
      r.camera.updateProjectionMatrix();
    }
    r.render();
    const v = r.player.vehicle;
    const c = r.cockpit;
    return { view: r.chase.view, freeYaw: +r.chase.free.yaw.toFixed(3), kmh: Math.round(Math.abs(v.forward) * 3.6), steer: +(r.player.visual.steerInput ?? 0).toFixed(2), rpm: Math.round(r.gearbox.rpm), gear: c.gear, lit: +c.lit.toFixed(1), glow: +c.glow.toFixed(2), cockpit: r.cockpitShown, lowEnd: c.lowEnd, liveMirror: c.liveMirror, rain: r.weather.rain, quality: window.__garage.qualityLevel, tier: c.tier };
  }, shot.zoom ?? null);
  await page.screenshot({ path: path.join(OUT, `${shot.name}.png`) });
  if (shot.drag) await page.mouse.up();
  console.log(shot.name, JSON.stringify(info));
  await browser.close();
}
server.httpServer.close();
