// Renders the Google Play store listing images from the live game (headless Chromium with
// SwiftShader, so every pixel is the real renderer, HUD and UI).
//
//   npm run build && node tools/store/render.mjs [--only garage,ec,...] [--out store-listing-assets]
//
// Each shot runs in its own browser (SwiftShader tabs crash after a car swap), with a save
// seeded through addInitScript: the flagship car selected, a campaign in progress. Gameplay is
// rendered at 960x540 CSS px and DPR 2, so the canvas and the HUD are exactly 1920x1080, laid
// out as on a large phone. tools/store/package.mjs then builds the icon, the feature graphic
// and the zip.
import { preview } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SHOTS } from './shots.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(root, arg('out', 'store-listing-assets'));
const RAW = path.join(OUT, '.raw');
const ONLY = arg('only', null)?.split(',');
const done = new Set();

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
await mkdir(RAW, { recursive: true });
const server = await preview({ root, preview: { port: 4337, strictPort: false }, logLevel: 'error' });
const url = server.resolvedUrls.local[0];

// A shot whose run() returns false (e.g. the results run missed a star) is tried again.
for (const shot of SHOTS.flatMap((s) => Array(s.tries ?? 1).fill(s))) {
  if (ONLY && !ONLY.includes(shot.id)) continue;
  if (done.has(shot.id)) continue;
  const t0 = Date.now();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const { width, height } = shot.viewport ?? { width: 960, height: 540 };
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: shot.dpr ?? 2, isMobile: true, hasTouch: true });
    await context.addInitScript(([key, save]) => {
      if (!sessionStorage.getItem('store-seeded')) {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify(save));
        sessionStorage.setItem('store-seeded', '1');
      }
    }, ['apex-overdrive.save.v2', shot.save]);
    const page = await context.newPage();
    page.setDefaultTimeout(30 * 60 * 1000);
    page.on('pageerror', (e) => console.error(`[${shot.id}] page error:`, e.message));
    page.on('console', (m) => m.type() === 'error' && console.error(`[${shot.id}] console:`, m.text()));
    await page.goto(`${url}?debug`);
    await page.waitForFunction(() => window.__app && window.__garage, null, { timeout: 180000, polling: 1000 });
    await page.evaluate(() => {
      const app = window.__app;
      app.ads.maybeShowInterstitial = async () => false;
      app.ads.setBanner = () => {};
      app.dialogue.play = async () => {};
      window.__garage.setQuality('high');
      document.querySelector('#splash')?.classList.add('is-done');
    });
    if ((await shot.run(page, { raw: RAW, out: OUT })) !== false) done.add(shot.id);
    console.log(`${shot.id}: ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (err) {
    console.error(`${shot.id} failed:`, err);
  } finally {
    await browser.close();
  }
}
await server.close();
