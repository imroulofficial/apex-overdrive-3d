// Triangles per named mesh of a race world (whole lap, before culling), biggest first.
//   npm run build && node tools/perf/sceneTris.mjs [--root dir] [--stage ec-01]
import { preview } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const root = path.resolve(arg('root', path.resolve(here, '../..')));
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
const server = await preview({ root, preview: { port: 4340, strictPort: false }, logLevel: 'error' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 480, height: 216 } })).newPage();
await page.goto(`${server.resolvedUrls.local[0]}?debug`);
await page.waitForFunction(() => window.__app && window.__garage, null, { timeout: 180000 });
for (const stage of arg('stage', 'ec-01').split(',')) {
  const res = await page.evaluate(async (stage) => {
    const app = window.__app;
    app.ads.setBanner = () => {};
    if (app.mode === 'race') await app.exitToMap();
    await app.startRace(stage);
    const r = app.race;
    r.stop();
    r.culling?.restoreAll?.();
    const by = {};
    let total = 0;
    r.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry;
      // A drawRange (culling chunks share one index buffer) counts only its own range; a mesh
      // whose triangles its chunks draw (moved to layer 31) is not drawn itself.
      if (o.layers.mask === 1 << 31 || o.layers.mask === 2 ** 31) return;
      const full = g.index ? g.index.count : g.attributes.position.count;
      const range = Math.min(full - g.drawRange.start, g.drawRange.count);
      const n = (range / 3) * (o.isInstancedMesh ? o.count : 1);
      const mat = [].concat(o.material)[0];
      const key = o.name || `${o.parent?.name || o.parent?.parent?.name || '?'}/${o.isInstancedMesh ? 'inst' : ''}${mat?.name || mat?.type}`;
      by[key] = (by[key] ?? 0) + n;
      total += n;
    });
    return { stage, total: Math.round(total), top: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${Math.round(v)}`) };
  }, stage);
  console.log(JSON.stringify(res));
}
await browser.close();
server.httpServer.close();
