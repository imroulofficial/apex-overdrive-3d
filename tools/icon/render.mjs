// Renders the Android launcher icons from tools/icon/icon.html and writes every density.
//
//   npm i --no-save playwright && npx playwright install chromium   (once)
//   node tools/icon/render.mjs
//
// Output: android/app/src/main/res/mipmap-*/ic_launcher{,_round,_foreground,_background}.png,
// the legacy splash.png in every drawable-* folder,
// and tools/icon/out/ (1024 px masters + the 512 px Play Store icon).
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const res = path.join(root, 'android/app/src/main/res');

let chromium;
try {
  ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright'));
} catch {
  console.error('Playwright is not installed: npm i --no-save playwright && npx playwright install chromium');
  process.exit(1);
}

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const server = await createServer({ root, server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = `http://localhost:${server.config.server.port}/tools/icon/icon.html`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__icon, null, { timeout: 180000 });
  // Downscale in the page (successive halving keeps the edges crisp) and return PNG bytes.
  const sizes = {};
  for (const [name, k] of Object.entries(DENSITIES)) {
    sizes[name] = { layer: Math.round(108 * k), legacy: Math.round(48 * k) };
  }
  const images = await page.evaluate(async (sizes) => {
    const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
    const src = {};
    for (const [k, v] of Object.entries(window.__icon)) src[k] = await load(v);
    const scale = (img, size) => {
      let cur = img;
      let w = img.width;
      while (w / 2 >= size) {
        w = Math.round(w / 2);
        const c = document.createElement('canvas');
        c.width = c.height = w;
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(cur, 0, 0, w, w);
        cur = c;
      }
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(cur, 0, 0, size, size);
      return c.toDataURL('image/png');
    };
    const out = { masters: window.__icon, store: scale(src.store, 512), mipmaps: {} };
    for (const [d, s] of Object.entries(sizes)) {
      out.mipmaps[d] = {
        ic_launcher_foreground: scale(src.foreground, s.layer),
        ic_launcher_background: scale(src.background, s.layer),
        ic_launcher: scale(src.legacy, s.legacy),
        ic_launcher_round: scale(src.round, s.legacy),
      };
    }
    return out;
  }, sizes);
  const png = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');
  const SPLASH = {
    drawable: [480, 320],
    'drawable-land-mdpi': [480, 320],
    'drawable-land-hdpi': [800, 480],
    'drawable-land-xhdpi': [1280, 720],
    'drawable-land-xxhdpi': [1600, 960],
    'drawable-land-xxxhdpi': [1920, 1280],
    'drawable-port-mdpi': [320, 480],
    'drawable-port-hdpi': [480, 800],
    'drawable-port-xhdpi': [720, 1280],
    'drawable-port-xxhdpi': [960, 1600],
    'drawable-port-xxxhdpi': [1280, 1920],
  };
  for (const [dir, [w, h]] of Object.entries(SPLASH)) {
    const data = await page.evaluate(([w, h]) => window.__splash(w, h), [w, h]);
    await writeFile(path.join(res, dir, 'splash.png'), png(data));
  }
  for (const [d, files] of Object.entries(images.mipmaps)) {
    const dir = path.join(res, `mipmap-${d}`);
    await mkdir(dir, { recursive: true });
    for (const [name, data] of Object.entries(files)) await writeFile(path.join(dir, `${name}.png`), png(data));
  }
  const out = path.join(here, 'out');
  await mkdir(out, { recursive: true });
  for (const [name, data] of Object.entries(images.masters)) await writeFile(path.join(out, `${name}-1024.png`), png(data));
  await writeFile(path.join(out, 'play-store-512.png'), png(images.store));
  console.log('Icons written to', res);
} finally {
  await browser.close();
  await server.close();
}
