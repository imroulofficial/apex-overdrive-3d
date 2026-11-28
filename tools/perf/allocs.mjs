// Per-frame JS allocations while racing (v76): where the garbage that makes the collector run
// mid-race comes from. A race driven frame by frame (r.update + r.render at a fixed step, as
// tools/perf/hitch.mjs) under the DevTools sampling heap profiler; reports the allocation
// sites (function, file:line) by bytes per frame, and the bytes per frame in all.
//
//   node tools/perf/allocs.mjs [--root dir] [--view chase|cockpit] [--lowend]
//     [--quality medium] [--seconds 15] [--fps 30] [--top 25] [--out file.json]
import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const root = path.resolve(arg('root', path.resolve(here, '../..')));
const VIEW = arg('view', 'chase');
const LOWEND = process.argv.includes('--lowend');
const QUALITY = LOWEND ? null : arg('quality', 'medium');
const SECONDS = Number(arg('seconds', 15));
const FPS = Number(arg('fps', 30));
const TOP = Number(arg('top', 25));
const OUT = arg('out', null);

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
// The dev server (unminified modules): allocation sites keep their own names and lines.
const server = await createServer({ root, server: { port: 4341, strictPort: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 480, height: 216 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(10 * 60 * 1000);
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
await page.evaluate(async ({ view, quality }) => {
  const app = window.__app;
  app.ads.maybeShowInterstitial = async () => false;
  app.ads.setBanner = () => {};
  if (app.dialogue) app.dialogue.play = async () => {};
  app.state.settings.cameraView = view;
  if (quality) window.__garage.setQuality(quality);
  await app.startRace(app.pickStage('ec-01'));
  const r = app.race;
  r.stop();
  r.autopilot();
  let guard = 0;
  while (r.phase !== 'racing' && guard++ < 2000) {
    r.update(1 / 60);
    r.render();
  }
  // A few seconds in before measuring (first-lap one-offs out of the way).
  for (let i = 0; i < 120; i++) {
    r.update(1 / 60);
    r.render();
  }
}, { view: VIEW, quality: QUALITY });

const cdp = await context.newCDPSession(page);
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.collectGarbage');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
const frames = await page.evaluate(({ seconds, fps }) => {
  const r = window.__app.race;
  let n = 0;
  const end = r.raceTime + seconds;
  while (r.raceTime < end && !r.result && n < seconds * fps * 2) {
    r.update(1 / fps);
    r.render();
    n++;
  }
  return n;
}, { seconds: SECONDS, fps: FPS });
const { profile } = await cdp.send('HeapProfiler.stopSampling');

// Self bytes per allocation site (function @ url:line), from the sampled call tree.
const sites = new Map();
let total = 0;
const walk = (node, stack) => {
  const cf = node.callFrame;
  const name = `${cf.functionName || '(anon)'} @ ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
  const self = node.selfSize;
  total += self;
  if (self > 0) {
    const caller = stack.slice(-3).reverse().join(' <- ');
    const key = name;
    const s = sites.get(key) ?? { bytes: 0, callers: new Map() };
    s.bytes += self;
    s.callers.set(caller, (s.callers.get(caller) ?? 0) + self);
    sites.set(key, s);
  }
  for (const c of node.children) walk(c, [...stack, name]);
};
walk(profile.head, []);
const top = [...sites.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, TOP).map(([site, s]) => ({
  site,
  bytesPerFrame: Math.round(s.bytes / frames),
  callers: [...s.callers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c, b]) => `${Math.round(b / frames)} B: ${c}`),
}));
const summary = { root: path.basename(root), view: VIEW, lowend: LOWEND, quality: QUALITY, frames, kbPerFrame: +(total / 1024 / frames).toFixed(1), top };
console.log(JSON.stringify(summary, null, 1));
if (OUT) await writeFile(OUT, JSON.stringify(summary, null, 1));
await browser.close();
await server.close();
