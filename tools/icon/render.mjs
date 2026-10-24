// Generates every icon asset from the studio's master icon (tools/icon/master.png, square).
//
//   node tools/icon/render.mjs [path/to/master.png]
//
// Output:
//   public/assets/icon/play-store-512.png        Play Store listing icon (also the web splash logo)
//   tools/icon/out/play-store-512.png            same, kept with the tooling
//   android/app/src/main/res/mipmap-<density>/
//     ic_launcher.png                            legacy icon, 48 dp, rounded corners
//     ic_launcher_round.png                      legacy round icon, 48 dp
//     ic_launcher_foreground.png                 adaptive foreground, 108 dp: the art in the
//                                                visible 72 dp centre, transparent margin
//     ic_launcher_background.png                 adaptive background, 108 dp: the art enlarged
//                                                and blurred, so masks and parallax never show
//                                                an edge around the foreground
//   android/app/src/main/res/drawable*/splash.png  legacy (pre-Android 12) launch splash: the
//                                                rounded icon on black with the studio line.
//                                                Android 12+ shows the adaptive icon instead.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const res = path.join(root, 'android/app/src/main/res');
const master = path.resolve(process.argv[2] ?? path.join(here, 'master.png'));

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
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

const meta = await sharp(master).metadata();
if (meta.width !== meta.height) throw new Error(`master icon must be square, got ${meta.width}x${meta.height}`);
if (meta.width < 512) throw new Error(`master icon must be at least 512 px, got ${meta.width}`);

const resized = (size) => sharp(master).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
const maskSvg = (size, shape) =>
  Buffer.from(
    shape === 'circle'
      ? `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`
      : `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.18}"/></svg>`
  );
const masked = async (size, shape) =>
  sharp(await resized(size)).composite([{ input: maskSvg(size, shape), blend: 'dest-in' }]).png().toBuffer();

// Play Store: a plain square (Play rounds the corners itself).
const store = await resized(512);
await sharp(store).toFile(path.join(root, 'public/assets/icon/play-store-512.png'));
await mkdir(path.join(here, 'out'), { recursive: true });
await sharp(store).toFile(path.join(here, 'out/play-store-512.png'));

for (const [density, k] of Object.entries(DENSITIES)) {
  const dir = path.join(res, `mipmap-${density}`);
  await mkdir(dir, { recursive: true });
  const legacy = Math.round(48 * k);
  const layer = Math.round(108 * k);
  const visible = Math.round(72 * k);
  await sharp(await masked(legacy, 'rounded')).toFile(path.join(dir, 'ic_launcher.png'));
  await sharp(await masked(legacy, 'circle')).toFile(path.join(dir, 'ic_launcher_round.png'));
  const inset = Math.round((layer - visible) / 2);
  await sharp({ create: { width: layer, height: layer, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await resized(visible), left: inset, top: inset }])
    .png()
    .toFile(path.join(dir, 'ic_launcher_foreground.png'));
  await sharp(master)
    .resize(layer, layer, { kernel: 'lanczos3' })
    .blur(Math.max(1, layer * 0.03))
    .modulate({ brightness: 0.9 })
    .png()
    .toFile(path.join(dir, 'ic_launcher_background.png'));
}

for (const [dir, [w, h]] of Object.entries(SPLASH)) {
  const m = Math.min(w, h);
  const d = Math.round(m * 0.5);
  const cy = Math.round(h * 0.45);
  const studio = Math.round(m * 0.028);
  const overlay = Buffer.from(`<svg width="${w}" height="${h}">
    <defs><radialGradient id="g" cx="50%" cy="${(cy / h) * 100}%" r="${(m * 0.6) / Math.max(w, h) * 100}%">
      <stop offset="0" stop-color="#780a18" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <text x="${w / 2}" y="${cy + d / 2 + m * 0.08}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="600"
      font-size="${studio}" letter-spacing="${studio * 0.5}" fill="#9aa3b2">RED PEN STUDIO</text></svg>`);
  await sharp({ create: { width: w, height: h, channels: 3, background: '#000' } })
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: await masked(d, 'rounded'), left: Math.round((w - d) / 2), top: cy - Math.round(d / 2) },
    ])
    .png()
    .toFile(path.join(res, dir, 'splash.png'));
}

console.log(`Icons written from ${path.relative(root, master)}`);
