// Race loading times (v76): how long "Start race" takes on each way into a race, and where the
// time goes. Runs the real menus (window.__app, ?debug) in one page:
//
//   cold        garage -> world map -> Start race (nothing built yet: the first race of a session)
//   next        results -> Next race (world map, the next stage's briefing) -> Start race
//   viaGarage   race -> world map -> garage -> world map -> Start race (the owner's slow case)
//   mapAgain    race -> world map -> Start race on the same stage
//   otherTrack  race -> world map -> Start race on another track (Alpine Summit)
//
// For each: the whole Start race (wipe included), the build steps (Race.loadTimings when the
// world is built), the warm-up (Race.warmUpMs), the JS heap and three's GPU object counts.
//
//   npm run build && node tools/perf/loading.mjs [--root dir] [--lowend] [--out file.json]
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
const LOWEND = process.argv.includes('--lowend');
const OUT = arg('out', null);

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
const server = await preview({ root, preview: { port: 4339, strictPort: false }, logLevel: 'error' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 640, height: 288 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(15 * 60 * 1000);
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
await page.waitForFunction(() => window.__app && window.__garage, null, { timeout: 180000 });
await page.evaluate(() => {
  const app = window.__app;
  app.ads.maybeShowInterstitial = async () => false;
  app.ads.setBanner = () => {};
  if (app.dialogue) app.dialogue.play = async () => {};
  app.briefing.open = app.briefing.open ?? (() => {});
  // Count the shader programs three links (one per new program).
  const gl = window.__garage.renderer.getContext();
  const link = gl.linkProgram.bind(gl);
  window.__links = 0;
  gl.linkProgram = (p) => {
    window.__links++;
    return link(p);
  };
});

const measure = (name, fn) =>
  page.evaluate(
    async ({ name, fn }) => {
      const app = window.__app;
      const r0 = app.race;
      // Steps before "Start race" (menus) are not timed.
      await new Function('app', `return (async () => { ${fn.before ?? ''} })()`)(app);
      window.gc?.();
      const links0 = window.__links;
      const t0 = performance.now();
      await app.startRace(fn.stage);
      const total = performance.now() - t0;
      const r = app.race;
      const info = window.__garage.renderer.info;
      const res = {
        name,
        stage: fn.stage,
        totalMs: Math.round(total),
        rebuilt: r !== r0 || !r0,
        buildSteps: r !== r0 ? r.loadTimings ?? null : null,
        warmUpMs: r.warmUpMs ?? null,
        programsLinked: window.__links - links0,
        heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? null,
      };
      r.stop();
      return res;
    },
    { name, fn },
  );

const flows = [
  ['cold', { before: 'await app.openMap();', stage: 'ec-01' }],
  ['next', { before: "await app.exitToMap({ next: true });", stage: 'ec-02' }],
  ['viaGarage', { before: 'await app.exitToMap(); await app.backToGarage(); await app.openMap();', stage: 'ec-03' }],
  ['mapAgain', { before: 'await app.exitToMap();', stage: 'ec-03' }],
  ['otherTrack', { before: 'await app.exitToMap();', stage: 'as-01' }],
  ['backToFirst', { before: 'await app.exitToMap(); await app.backToGarage(); await app.openMap();', stage: 'ec-01' }],
];
const results = [];
for (const [name, fn] of flows) {
  const res = await measure(name, fn);
  // Garage memory with whatever the race left resident (after a visit to the garage).
  console.log(JSON.stringify(res));
  results.push(res);
}
// The garage with whatever is kept for the next race.
const garage = await page.evaluate(async () => {
  const app = window.__app;
  await app.exitToMap();
  await app.backToGarage();
  window.gc?.();
  await new Promise((r) => setTimeout(r, 500));
  const info = window.__garage.renderer.info;
  return { heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), geometries: info.memory.geometries, textures: info.memory.textures, raceKept: Boolean(app.race) };
});
console.log('garage', JSON.stringify(garage));
if (OUT) await writeFile(OUT, JSON.stringify({ root: path.basename(root), lowend: LOWEND, results, garage }, null, 1));
await browser.close();
server.httpServer.close();
