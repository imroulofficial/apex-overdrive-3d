// Cockpit cost, versionCode 73: one race per run, the camera in the asked view, then N frames
// drawn one by one and measured: draw calls and triangles of the whole frame (live mirror,
// scene, bloom), render time (GPU-synced, SwiftShader so only comparable run to run), the
// cockpit's own draws/triangles, the GPU memory its textures and render target take, the race
// preparation time and (v73) the cockpit model's load time.
//
//   npm run build && node tools/perf/cockpit.mjs [--view cockpit|chase] [--lowend] [--frames 40]
//     [--stage ec-01] [--quality high] [--root dir]   (--root: another checkout's built dist)
//     [--car id]   race this car (v75: each car has its own cockpit)
//     [--manual-high]  with --lowend: the player chose Graphics: High by hand (full cabin, live mirror)
//     [--switch]   start in Chase, then switch to the cockpit mid-race and report what that
//                  switch made the GPU do (new shader programs, textures, geometries)
import { preview } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const root = path.resolve(arg('root', path.resolve(here, '../..')));
const VIEW = arg('view', 'cockpit');
const LOWEND = process.argv.includes('--lowend');
const FRAMES = Number(arg('frames', 40));
const STAGE = arg('stage', 'ec-01');
const QUALITY = arg('quality', 'high');
const SWITCH = process.argv.includes('--switch');
const CAR = arg('car', null);
const MANUAL_HIGH = process.argv.includes('--manual-high');

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
const server = await preview({ root, preview: { port: 4377, strictPort: false }, logLevel: 'error' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 })).newPage();
if (LOWEND) {
  await page.addInitScript(() => {
    for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      const get = C?.prototype.getParameter;
      if (get) C.prototype.getParameter = function (p) { return p === 0x9246 ? 'PowerVR Rogue GE8320' : get.call(this, p); };
    }
  });
}
page.on('console', (m) => m.text().startsWith('[') && console.log(m.text()));
await page.goto(`${server.resolvedUrls.local[0]}?debug`);
await page.waitForFunction(() => window.__app && window.__garage, null, { timeout: 120000 });
const result = await page.evaluate(
  async ({ view, lowend, frames, stage, quality, doSwitch, car, manualHigh }) => {
    const app = window.__app;
    app.ads.maybeShowInterstitial = async () => false;
    app.ads.setBanner = () => {};
    if (app.dialogue) app.dialogue.play = async () => {};
    if (!lowend) window.__garage.setQuality(quality);
    if (manualHigh) {
      app.state.settings.quality = 'high';
      window.__garage.setQuality('high');
    }
    if (car) {
      // Own the car for the run (in memory only).
      if (!app.state.cars[car]) app.state.cars[car] = JSON.parse(JSON.stringify(app.state.cars[app.state.car]));
      if (!app.state.ownedCars.includes(car)) app.state.ownedCars.push(car);
      app.state.car = car;
    }
    app.state.settings.cameraView = view;
    const t0 = performance.now();
    await app.startRace(app.pickStage(stage));
    const prepareMs = performance.now() - t0;
    const r = window.__app.race;
    // What the GPU had once the race was prepared (warm-up done): anything added after it is a
    // mid-race compile or upload.
    const mem0 = { programs: r.renderer.info.programs.length, textures: r.renderer.info.memory.textures, geometries: r.renderer.info.memory.geometries };
    r.stop();
    r.running = true;
    r.autopilot();
    let guard = 0;
    while (r.phase !== 'racing' && guard++ < 900) r.update(1 / 30);
    for (let i = 0; i < 60; i++) r.update(1 / 30);
    const renderer = r.renderer;
    // N frames drawn one by one: render time (GPU-synced), draw calls, triangles.
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    function measure() {
      renderer.info.autoReset = false;
      const out = [];
      for (let i = 0; i < frames; i++) {
        r.update(1 / 60);
        renderer.info.reset();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const a = performance.now();
        r.render();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        out.push({ ms: performance.now() - a, calls: renderer.info.render.calls, tris: renderer.info.render.triangles });
      }
      renderer.info.autoReset = true;
      return out;
    }
    const summary = (rows) => {
      const ms = rows.map((x) => x.ms).sort((a, b) => a - b);
      const avg = (k) => rows.reduce((t, x) => t + x[k], 0) / rows.length;
      return { frameMsMedian: +ms[ms.length >> 1].toFixed(1), drawCalls: Math.round(avg('calls')), triangles: Math.round(avg('tris')) };
    };
    let switched = null;
    let chaseFrames = null;
    if (doSwitch) {
      for (let i = 0; i < 3; i++) {
        r.update(1 / 30);
        r.render();
      }
      chaseFrames = summary(measure());
      const names = new Set(renderer.info.programs.map((p) => p.cacheKey));
      const before = { programs: renderer.info.programs.length, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries };
      r.chase.setView('cockpit');
      for (let i = 0; i < 20; i++) {
        r.update(1 / 30);
        r.render();
      }
      const after = { programs: renderer.info.programs.length, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries };
      const added = renderer.info.programs.filter((p) => !names.has(p.cacheKey)).map((p) => `${p.name} ${p.cacheKey}`);
      switched = { added, cockpitShown: r.cockpitShown, newPrograms: after.programs - before.programs, newTextures: after.textures - before.textures, newGeometries: after.geometries - before.geometries };
    }
    const rows = measure();
    // The cockpit on its own: its meshes, and the GPU memory of its textures.
    const c = r.cockpit;
    let draws = 0;
    let tris = 0;
    const textures = new Set();
    c.group.traverse((o) => {
      if (!o.isMesh) return;
      draws++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      for (const v of [...Object.values(o.material), ...Object.values(o.material.uniforms ?? {}).map((u) => u.value)]) if (v?.isTexture) textures.add(v);
    });
    // The race's sky map (scene.environment) is shared with every car and the road, not the cabin's.
    textures.delete(r.scene.environment);
    // The player's car on track (its own textures, v75) apart from the cockpit's.
    const carTextures = new Set();
    r.player.visual.root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) for (const v of Object.values(m)) if (v?.isTexture) carTextures.add(v);
    });
    const texMB = (set) => {
      let b = 0;
      for (const t of set) {
        const img = t.image ?? {};
        const w = img.width ?? t.source?.data?.width ?? 0;
        const h = img.height ?? t.source?.data?.height ?? 0;
        b += w * h * 4 * (t.generateMipmaps === false ? 1 : 4 / 3);
      }
      return +(b / 1048576).toFixed(2);
    };
    let texBytes = 0;
    const texList = [];
    for (const t of textures) {
      const img = t.image ?? {};
      const w = img.width ?? t.source?.data?.width ?? 0;
      const h = img.height ?? t.source?.data?.height ?? 0;
      const mips = t.isRenderTargetTexture || t.generateMipmaps === false ? 1 : 4 / 3;
      const bytes = w * h * 4 * mips + (t.isRenderTargetTexture ? w * h * 4 : 0); // + depth
      texBytes += bytes;
      texList.push(`${t.name || (t.isRenderTargetTexture ? 'mirror' : 'tex')} ${w}x${h}`);
    }
    const avg = (k) => rows.reduce((s, x) => s + x[k], 0) / rows.length;
    const sorted = rows.map((x) => x.ms).sort((a, b) => a - b);
    return {
      car: window.__app.state.car,
      sinceWarmUp: { programs: renderer.info.programs.length - mem0.programs, textures: renderer.info.memory.textures - mem0.textures, geometries: renderer.info.memory.geometries - mem0.geometries },
      view,
      lowend,
      manualHigh,
      switched,
      chase: chaseFrames,
      tier: c.tier ?? (c.lowEnd ? 'low(v72)' : 'v72'),
      cockpitShown: r.cockpitShown,
      prepareMs: Math.round(prepareMs),
      cockpitLoadMs: c.asset?.loadMs != null ? Math.round(c.asset.loadMs) : null,
      frameMs: +avg('ms').toFixed(1),
      frameMsMedian: +sorted[sorted.length >> 1].toFixed(1),
      drawCalls: Math.round(avg('calls')),
      triangles: Math.round(avg('tris')),
      cockpitDraws: draws,
      cockpitTriangles: Math.round(tris),
      cockpitTextureMB: +(texBytes / 1048576).toFixed(2),
      textures: texList,
      carTextureMB: texMB(carTextures),
      gpuTextures: renderer.info.memory.textures,
      programs: renderer.info.programs?.length,
    };
  },
  { view: SWITCH ? 'chase' : VIEW, lowend: LOWEND, frames: FRAMES, stage: STAGE, quality: QUALITY, doSwitch: SWITCH, car: CAR, manualHigh: MANUAL_HIGH }
);
console.log(JSON.stringify(result));
await browser.close();
server.httpServer.close();
