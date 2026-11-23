// Before/after screenshots of the Phase 0 glitch spots (C1-C15) from the real game, headless
// (vite preview + Chromium/SwiftShader, ?debug). Run it on two builds into two folders:
//
//   node tools/qa/glitchShots.mjs --root /path/to/v73 --out shots/before
//   node tools/qa/glitchShots.mjs --out shots/after [--only c1-sawmill-launch,...]
//
// Each shot starts a stage, puts the player's car (and a rival, for the contact shots) where
// the glitch was, steps the race by hand and points the camera at the spot.
import { preview } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback);
const root = path.resolve(arg('root', path.resolve(here, '../..')));
const OUT = path.resolve(arg('out', 'qa-shots'));
const ONLY = arg('only', null)?.split(',');

// stage: index into the career (0 = ec-01, the Emerald Coast circuit; 5 = ec-06 reversed).
// place: the player's car { s, d, turn (radians off the road), speed, frames, drive (keep it
// on the road at that lane and speed every frame) }. cam / look: { s, d, h } in road space,
// or look 'car'.
const SHOTS = [
  { name: 'c1-sawmill-launch', stage: 0, place: { s: 1100, d: -6, speed: 42, frames: 92, drive: true }, cam: { ds: -16, d: 20, h: 6 }, look: 'car', note: 'v73: thrown 22 m up at the Sawmill fork' },
  { name: 'c1-sawmill-fork-joint', stage: 0, place: { s: 1060, d: 0 }, cam: { s: 1105, d: 2, h: 3.2 }, look: { s: 1135, d: -12, h: 0 } },
  { name: 'c1-redwood-reverse-fork', stage: 5, place: { s: 1600, d: 0 }, cam: { s: 1650, d: -2, h: 3.2 }, look: { s: 1680, d: 9, h: 0 } },
  { name: 'c3-grass-over-road', stage: 0, place: { s: 1450, d: 0 }, cam: { s: 1545, d: -2, h: 1.6 }, look: { s: 1572, d: 3, h: 0 } },
  { name: 'c2-ramp-side', stage: 0, place: { s: 120, d: 0 }, cam: { s: 244, d: -9.5, h: 1.3 }, look: { s: 248, d: 0, h: 0.6 } },
  { name: 'c2-ramp-side-alpine', stage: 20, place: { s: 2700, d: 0 }, cam: { s: 2785, d: -9, h: 1.4 }, look: { s: 2788, d: 0, h: 1 } },
  { name: 'c14-bridge-deck', stage: 0, place: { s: 2400, d: 0 }, cam: { s: 2515, d: -9, h: 1.1 }, look: { s: 2530, d: 4, h: 0 } },
  { name: 'c8-wheel-on-kerb', stage: 0, kerb: true, place: { d: 8.6 }, cam: { ds: 3.5, d: 13, h: 0.7 }, look: 'car' },
  { name: 'c6-sideways-at-the-rail', stage: 0, place: { s: 400, d: 9.5, turn: 1.2, speed: 9, out: true, frames: 24 }, cam: { s: 392, d: 4, h: 7 }, look: 'car' },
  { name: 'c5-t-bone', stage: 0, place: { s: 420, d: 0, frames: 2 }, rival: { ds: 0, d: 3.2, turn: Math.PI / 2 }, cam: { s: 412, d: -6, h: 6 }, look: 'car' },
  { name: 'c15-turbofan-rim', stage: 0, rim: 'turbofan', place: { s: 60, d: 0 }, cam: { ds: 1.6, d: -2.6, h: 0.45 }, look: 'wheel' },
].filter((s) => !ONLY || ONLY.includes(s.name));

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
await mkdir(OUT, { recursive: true });
const server = await preview({ root, preview: { port: 4700 + Math.floor(Math.random() * 200), strictPort: false }, logLevel: 'error' });
const url = `${server.resolvedUrls.local[0]}?debug`;

for (const shot of SHOTS) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', (e) => console.error(`[${shot.name}]`, e.message));
  await page.addInitScript(() => {
    let a = 7;
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__app && window.__garage, null, { timeout: 180000, polling: 1000 });
  const note = await page.evaluate(async (shot) => {
    const app = window.__app;
    app.ads.maybeShowInterstitial = async () => false;
    window.__garage.setQuality('high');
    if (shot.rim) {
      const id = app.state.car;
      app.state.cars[id] = { ...app.state.cars[id], rim: shot.rim };
    }
    await app.startRace(app.pickStage(shot.stage));
    const r = app.race;
    r.stop();
    r.autopilot();
    let guard = 0;
    while (r.phase !== 'racing' && guard++ < 900) r.update(1 / 30);
    const t = r.track;
    const v = r.player.vehicle;
    const p = shot.place;
    const s0 = shot.kerb ? (t.kerbSpans ? (t.kerbSpans[0].s0 + t.kerbSpans[0].s1) / 2 : 506) : p.s; // v73 has no kerbSpans: same corner
    const d0 = shot.kerb ? t.halfWidth - 0.4 : p.d;
    // Everyone else out of the way (a rival is brought back for the contact shot).
    for (const o of r.racers) if (o !== r.player) o.vehicle.reset(t.wrapS(s0 + 300), 0);
    v.reset(s0, d0);
    v.heading += p.turn ?? 0;
    const f = {};
    const lane = () => {
      const pr = v.mainProj ?? v.proj;
      const hd = Math.atan2(-pr.tz, pr.tx) + (p.turn ?? 0);
      v.heading = hd;
      if (p.out) {
        // Sliding sideways into the rail on the right.
        v.vel.set(pr.rx * p.speed, pr.rz * p.speed);
      } else v.vel.set(Math.cos(hd) * (p.speed ?? 0), -Math.sin(hd) * (p.speed ?? 0));
    };
    if (shot.rival) {
      const o = r.racers.find((x) => x !== r.player);
      o.vehicle.reset(s0 + shot.rival.ds, shot.rival.d);
      o.vehicle.heading += shot.rival.turn;
      o.vehicle.vel.set(0, 0);
      o.out = false;
    }
    for (let i = 0; i < (p.frames ?? 12); i++) {
      if (p.drive || p.out || !p.speed) lane();
      r.update(1 / 60);
    }
    // Camera.
    const at = (q) => {
      const s = q.ds != null ? (v.mainProj ?? v.proj).s + q.ds : q.s;
      t.frame(t.wrapS(s), f);
      return [f.x + f.rx * q.d, t.roadY(t.wrapS(s)) + q.h, f.z + f.rz * q.d];
    };
    const cam = r.camera;
    cam.position.set(...at(shot.cam));
    if (shot.look === 'car') cam.lookAt(v.pos.x, v.pos.y + 0.6, v.pos.z);
    else if (shot.look === 'wheel') {
      const fx = Math.cos(v.heading);
      const fz = -Math.sin(v.heading);
      // The front wheel on the car's left: nose (fx, fz), right (-fz, fx).
      cam.lookAt(v.pos.x + fx * 1.4 + fz * 0.85, v.pos.y + 0.33, v.pos.z + fz * 1.4 - fx * 0.85);
    } else cam.lookAt(...at(shot.look));
    cam.fov = shot.look === 'wheel' ? 30 : 55;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    r.culling?.update(cam);
    r.render();
    const canvas = r.renderer.domElement;
    canvas.id = 'glitch-shot';
    // The HUD, touch controls and stage banner off: just the 3D view.
    for (const el of document.querySelectorAll('body *')) if (el !== canvas && !el.contains(canvas)) el.style.visibility = 'hidden';
    const air = v.airborne ? ` airborne ${(v.pos.y - v.groundY).toFixed(1)} m` : '';
    return `s ${(v.mainProj ?? v.proj).s.toFixed(0)} d ${(v.mainProj ?? v.proj).d.toFixed(2)}${air}`;
  }, shot);
  await page.locator('#glitch-shot').screenshot({ path: path.join(OUT, `${shot.name}.png`) });
  console.log(shot.name, note, shot.note ?? '');
  await browser.close();
}
server.httpServer.close();
