// Builds the Google Play listing set from the frames tools/store/render.mjs saved in
// store-listing-assets/.raw, checks every file against the Play Console limits and zips it.
//
//   node tools/store/package.mjs [--out store-listing-assets]
//
//   app-icon-512x512.png          512x512, 32-bit PNG (RGBA), < 1 MB: tools/icon/master.png
//   feature-graphic-1024x500.png  1024x500, 24-bit PNG (no alpha), < 15 MB
//   screenshot-1..8.png           1920x1080 (16:9), 24-bit PNG, < 8 MB each
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const i = process.argv.indexOf('--out');
const OUT = path.resolve(root, i > 0 ? process.argv[i + 1] : 'store-listing-assets');
const RAW = path.join(OUT, '.raw');
const raw = (name) => path.join(RAW, `${name}.png`);

// Which rendered frame becomes which screenshot (picked by eye from the render run).
export const PICKS = {
  'screenshot-1': 'ec3-t13',
  'screenshot-2': 'garage-paint',
  'screenshot-3': 'as3-t10',
  'screenshot-4': 'nc4-3',
  'screenshot-5': 'map-a',
  'screenshot-6': 'gorge3-f0.905-c2',
  'screenshot-7': 'tunnel-f0.53',
  'screenshot-8': null, // briefing + results, composed below
};
const FEATURE = 'feature2-0-c3';

const LIMITS = {
  icon: { w: 512, h: 512, bytes: 1024 * 1024, alpha: true },
  feature: { w: 1024, h: 500, bytes: 15 * 1024 * 1024, alpha: false },
  shot: { w: 1920, h: 1080, bytes: 8 * 1024 * 1024, alpha: false },
};

const png = (img, alpha) => (alpha ? img.ensureAlpha() : img.removeAlpha()).png({ compressionLevel: 9, palette: false });

async function exact(src, w, h) {
  return sharp(src).resize(w, h, { fit: 'cover', kernel: 'lanczos3' });
}

// Shot 8: the pre-race briefing and the 3-star results of the same stage side by side, each
// a real 1920x1080 frame scaled down onto a blurred copy of itself, split on the game's slanted
// edge, with a small caption over each half.
async function briefingAndResults() {
  const W = 1920;
  const H = 1080;
  const cut = 120; // horizontal run of the slant
  const mid = W / 2;
  const BOX = 840; // width of each card, clear of the slant
  const CY = 630; // vertical centre of the cards
  // `panel`: the UI panel's box in the 1920x1080 frame ({ left, top, width, height }).
  const tile = async (name, panel, x) => {
    const w = BOX;
    const h = Math.round((panel.height * BOX) / panel.width);
    const top = Math.round(CY - h / 2);
    const bg = await sharp(raw(name)).resize(W, H).blur(24).modulate({ brightness: 0.45 }).png().toBuffer();
    const fg = await sharp(raw(name)).extract(panel).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
    const shadow = Buffer.from(`<svg width="${W}" height="${H}"><rect x="${x}" y="${top + 14}" width="${w}" height="${h}" fill="#000" opacity=".6"/></svg>`);
    return sharp(bg).composite([{ input: await sharp(shadow).blur(16).png().toBuffer() }, { input: fg, left: x, top }]).png().toBuffer();
  };
  const left = await tile('brief-ec02', { left: 80, top: 22, width: 1762, height: 1034 }, 40);
  const right = await tile('results-a', { left: 298, top: 126, width: 1324, height: 828 }, W - 40 - BOX);
  const mask = Buffer.from(`<svg width="${W}" height="${H}"><polygon points="${mid + cut / 2},0 ${W},0 ${W},${H} ${mid - cut / 2},${H}" fill="#fff"/></svg>`);
  const rightHalf = await sharp(right).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const caption = (x, kicker, title) =>
    `<text x="${x}" y="262" text-anchor="middle" font-family="Inter" font-weight="800" font-size="22" letter-spacing="6" fill="#ff7a1a">${kicker}</text>` +
    `<text x="${x}" y="314" text-anchor="middle" font-family="Inter" font-weight="900" font-style="italic" font-size="44" fill="#f2f4f8">${title}</text>`;
  const overlay = Buffer.from(
    `<svg width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff2a3a"/><stop offset="1" stop-color="#ff7a1a"/></linearGradient></defs>` +
      `<line x1="${mid + cut / 2}" y1="-4" x2="${mid - cut / 2}" y2="${H + 4}" stroke="url(#g)" stroke-width="10"/>` +
      caption(40 + 420, 'STEP 1', 'PRE-RACE BRIEFING') +
      caption(1920 - 40 - 420, 'STEP 2', 'EARN ALL 3 STARS') +
      `</svg>`
  );
  return sharp(left).composite([{ input: rightHalf }, { input: overlay }]);
}

async function verify(file, kind) {
  const lim = LIMITS[kind];
  const meta = await sharp(file).metadata();
  const { size } = await stat(file);
  const ok = meta.format === 'png' && meta.width === lim.w && meta.height === lim.h && size < lim.bytes && meta.hasAlpha === lim.alpha;
  const row = { file: path.basename(file), size: `${meta.width}x${meta.height}`, channels: meta.channels, alpha: meta.hasAlpha, kb: Math.round(size / 1024), limitKb: lim.bytes / 1024, ok };
  console.log(JSON.stringify(row));
  if (!ok) process.exitCode = 1;
  return row;
}

const files = [];
const icon = path.join(OUT, 'app-icon-512x512.png');
await png(sharp(path.join(root, 'tools/icon/master.png')).resize(512, 512, { kernel: 'lanczos3' }), true).toFile(icon);
files.push([icon, 'icon']);

const feature = path.join(OUT, 'feature-graphic-1024x500.png');
await png(await exact(raw(FEATURE), 1024, 500), false).toFile(feature);
files.push([feature, 'feature']);

for (const [name, src] of Object.entries(PICKS)) {
  const file = path.join(OUT, `${name}.png`);
  const img = src ? await exact(raw(src), 1920, 1080) : await briefingAndResults();
  await png(sharp(await img.png().toBuffer()), false).toFile(file);
  files.push([file, 'shot']);
}

for (const [file, kind] of files) await verify(file, kind);

const zip = path.join(path.dirname(OUT), `${path.basename(OUT)}.zip`);
await rm(zip, { force: true });
execFileSync('zip', ['-X', '-j', zip, ...files.map(([f]) => f)]);
console.log(`${path.relative(root, zip)}: ${Math.round((await stat(zip)).size / 1024)} KB`);
