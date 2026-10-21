// Renders listening previews of the game's synthesized audio (engine through six gears,
// blow-off, nitro, drift, the race soundtrack, UI and race SFX, a full race mix) with the
// same modules the game plays live, and prints level stats for each clip.
//
//   npm i --no-save playwright && npx playwright install chromium   (once)
//   node tools/audio/render.mjs [clip names…]
//
// Output: tools/audio/out/<clip>.wav
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(here, 'out');

let chromium;
try {
  const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  chromium = pw.chromium ?? pw.default.chromium;
} catch {
  console.error('Playwright is not installed: npm i --no-save playwright && npx playwright install chromium');
  process.exit(1);
}

const server = await createServer({ root, server: { port: 5198, strictPort: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => {
    failed = true;
    console.error('page error:', e.message);
  });
  await page.goto(`http://localhost:${server.config.server.port}/tools/audio/preview.html`);
  await page.waitForFunction(() => window.__audio, null, { timeout: 60000 });
  const names = process.argv.slice(2).length ? process.argv.slice(2) : await page.evaluate(() => window.__audio.names);
  await mkdir(out, { recursive: true });
  for (const name of names) {
    const r = await page.evaluate((n) => window.__audio.render(n), name);
    await writeFile(path.join(out, `${name}.wav`), Buffer.from(r.wav, 'base64'));
    console.log(`${name}: peak ${r.stats.peakDb} dBFS, rms ${r.stats.rmsDb} dBFS, non-finite ${r.stats.nonFinite}, rendered in ${r.ms} ms`);
    for (const line of r.log) console.log(`  ${line}`);
    if (r.stats.nonFinite) failed = true;
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
