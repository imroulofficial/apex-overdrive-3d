// Motion trace (v76): one race driven frame by frame with a phone-like frame clock, recording on
// every frame where the player's car is drawn, where the camera is, and where the car (and in
// the driver view the cabin, the bonnet and the steering wheel) sits in the camera's own frame,
// which is what the eye sees. A smooth picture needs all of these to move smoothly in time:
//
//   jitter  how far each frame's position is off the straight line between the frames before
//           and after it, at that frame's own time (cm). Steady motion scores ~0; a car drawn
//           at the wrong instant or a camera that lags by a frame-time-dependent amount shows
//           up as a spike.
//
//   npm run build && node tools/perf/trace.mjs [--root dir] [--stage ec-01] [--seconds 30]
//     [--view chase|cockpit] [--clock 60|30|mixed] [--car id] [--lowend] [--out file.json]
//
// Clocks: '60' is a 60 Hz screen (16.7 ms frames with +-1.5 ms timestamp jitter and a dropped
// frame now and then), '30' a low-end phone at 30 FPS (33.3 ms +-2 ms, an occasional 50 ms
// frame), 'mixed' a phone that misses 60 now and then (16.7 and 33.3 ms frames mixed).
// The clock is seeded, so two builds see the very same frame times.
import { preview } from 'vite';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const root = path.resolve(arg('root', path.resolve(here, '../..')));
const STAGE = arg('stage', 'ec-01');
const SECONDS = Number(arg('seconds', 30));
const VIEW = arg('view', 'chase');
const CLOCK = arg('clock', '60');
const CAR = arg('car', null);
const LOWEND = process.argv.includes('--lowend');
const OUT = arg('out', null);

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
const server = await preview({ root, preview: { port: 4338, strictPort: false }, logLevel: 'error' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 480, height: 216 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
if (LOWEND) {
  await page.addInitScript(() => {
    for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      const get = C?.prototype.getParameter;
      if (get) C.prototype.getParameter = function (p) { return p === 0x9246 ? 'PowerVR Rogue GE8320' : get.call(this, p); };
    }
  });
}
await page.goto(`${server.resolvedUrls.local[0]}?debug`);
await page.waitForFunction(() => window.__app && window.__garage, null, { timeout: 120000 });

const result = await page.evaluate(async ({ stage, seconds, view, clock, car }) => {
  const app = window.__app;
  app.ads.maybeShowInterstitial = async () => false;
  app.ads.setBanner = () => {};
  if (app.dialogue) app.dialogue.play = async () => {};
  app.state.settings.cameraView = view;
  if (car) {
    if (!app.state.cars[car]) app.state.cars[car] = JSON.parse(JSON.stringify(app.state.cars[app.state.car]));
    if (!app.state.ownedCars.includes(car)) app.state.ownedCars.push(car);
    app.state.car = car;
  }
  await app.startRace(app.pickStage(stage));
  const r = app.race;
  r.stop();
  r.autopilot();
  // Seeded frame clock.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let n = 0;
  const nextDt = () => {
    n++;
    if (clock === '30') return (n % 97 === 0 ? 50 : 33.333 + (rnd() - 0.5) * 4) / 1000;
    if (clock === 'mixed') return (rnd() < 0.3 ? 33.333 : 16.667) / 1000;
    return (n % 71 === 0 ? 33.333 : 16.667 + (rnd() - 0.5) * 3) / 1000;
  };
  const THREE = { Vector3: r.camera.position.constructor };
  const cam = r.camera;
  const v3 = () => new THREE.Vector3();
  const tmp = v3();
  const rel = (obj) => {
    obj.getWorldPosition(tmp);
    return tmp.applyMatrix4(cam.matrixWorldInverse).toArray();
  };
  const frames = [];
  let t = 0;
  let guard = 0;
  while (r.raceTime < seconds && !r.result && guard++ < seconds * 70 + 1000) {
    const dt = nextDt();
    r.update(dt);
    t += dt;
    if (r.phase !== 'racing') continue;
    cam.updateMatrixWorld();
    const vis = r.player.visual.root;
    vis.updateMatrixWorld(true);
    const f = { t, dt, speed: r.player.vehicle.speed, fx: r.chase.shake > 0.001 || r.player.vehicle.tier === 2 ? 1 : 0, car: vis.getWorldPosition(v3()).toArray(), cam: cam.position.toArray(), carInCam: rel(vis) };
    if (r.cockpitShown) {
      r.cockpit.group.updateMatrixWorld(true);
      f.cabinInCam = rel(r.cockpit.group);
      if (r.cockpit.wheel) f.wheelInCam = rel(r.cockpit.wheel);
      // A point on the bonnet (the car body seen through the windscreen): 1.5 m ahead of the
      // eye, at the body's own transform.
      const body = r.player.visual.body ?? vis;
      const p = body.localToWorld(new THREE.Vector3(1.5, 0.9, 0));
      f.bonnetInCam = p.applyMatrix4(cam.matrixWorldInverse).toArray();
      f.bonnetInCabin = r.cockpit.group.worldToLocal(body.localToWorld(new THREE.Vector3(1.5, 0.9, 0))).toArray();
    }
    frames.push(f);
  }
  return { stage: app.stage.stageId, view: app.state.settings.cameraView, cockpitShown: r.cockpitShown, frames };
}, { stage: STAGE, seconds: SECONDS, view: VIEW, clock: CLOCK, car: CAR });

// Jitter of a series of 3D points against their own frame times (cm).
function jitter(frames, key, skip = null) {
  const out = [];
  for (let i = 1; i < frames.length - 1; i++) {
    const a = frames[i - 1][key];
    const b = frames[i][key];
    const c = frames[i + 1][key];
    if (!a || !b || !c) continue;
    if (skip && (skip(frames[i - 1]) || skip(frames[i]) || skip(frames[i + 1]))) continue;
    const k = (frames[i].t - frames[i - 1].t) / (frames[i + 1].t - frames[i - 1].t);
    let e = 0;
    for (let j = 0; j < 3; j++) e += (b[j] - (a[j] + (c[j] - a[j]) * k)) ** 2;
    out.push(Math.sqrt(e) * 100);
  }
  out.sort((x, y) => x - y);
  if (!out.length) return null;
  const p = (q) => +out[Math.min(out.length - 1, Math.floor(q * out.length))].toFixed(2);
  return { avg: +(out.reduce((s, x) => s + x, 0) / out.length).toFixed(2), p50: p(0.5), p95: p(0.95), p99: p(0.99), max: +out[out.length - 1].toFixed(2), over2cm: out.filter((x) => x > 2).length, n: out.length };
}
// How much the position of one thing in another's frame wanders (cm, max - min per axis).
function spread(frames, key) {
  const pts = frames.map((f) => f[key]).filter(Boolean);
  if (!pts.length) return null;
  return [0, 1, 2].map((j) => +((Math.max(...pts.map((p) => p[j])) - Math.min(...pts.map((p) => p[j]))) * 100).toFixed(2));
}
const F = result.frames;
const summary = {
  root: path.basename(root),
  stage: result.stage,
  view: result.view,
  clock: CLOCK,
  lowend: LOWEND,
  frames: F.length,
  avgSpeed: +(F.reduce((s, f) => s + f.speed, 0) / Math.max(1, F.length)).toFixed(1),
  carWorld: jitter(F, 'car'),
  camWorld: jitter(F, 'cam'),
  carInCamera: jitter(F, 'carInCam'),
  // The same without the frames the camera shakes on purpose (an impact, nitro tier 2).
  carInCameraNoShake: jitter(F, 'carInCam', (f) => f.fx),
  shakeFrames: F.filter((f) => f.fx).length,
  ...(F.some((f) => f.cabinInCam) && {
    cabinInCamera: jitter(F, 'cabinInCam'),
    wheelInCamera: jitter(F, 'wheelInCam'),
    bonnetInCamera: jitter(F, 'bonnetInCam'),
    bonnetInCabinSpreadCm: spread(F, 'bonnetInCabin'),
  }),
};
console.log(JSON.stringify(summary));
if (OUT) await writeFile(OUT, JSON.stringify({ summary, frames: F }, null, 0));
await browser.close();
server.httpServer.close();
