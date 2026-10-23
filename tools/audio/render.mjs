// Renders listening previews of the game's synthesized audio (engine through six gears,
// blow-off, nitro, drift, the race soundtrack, UI and race SFX, a full race mix) with the
// same modules the game plays live, and prints level stats for each clip.
//
//   npm i --no-save playwright && npx playwright install chromium   (once)
//   node tools/audio/render.mjs [clip names…]
//   node tools/audio/render.mjs --stall      frame-stall test and audio-thread cost (stall.js)
//   node tools/audio/render.mjs --live       live underrun test in a real AudioContext (stall.js)
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
// The live test needs audio to start without a gesture, and Chrome's playout (underrun) stats.
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-blink-features=AudioContextPlayoutStats'] });
let failed = false;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => {
    failed = true;
    console.error('page error:', e.message);
  });
  await page.goto(`http://localhost:${server.config.server.port}/tools/audio/preview.html`);
  await page.waitForFunction(() => window.__audio, null, { timeout: 60000 });
  if (process.argv.includes('--live')) {
    // Previous: the old graph and control path at the phone's rate with 'balanced'. Current:
    // the Android build's settings. Ballast stands in for the rest of a phone's CPU load.
    for (const ballast of [0.6, 0.75]) {
      for (const [path, latencyHint, rate] of [['previous', 'balanced', 48000], ['current', 'playback', 32000]]) {
        const r = await page.evaluate((a) => window.__audio.live(a), { path, latencyHint, rate, ballast, seconds: 16 });
        console.log(`${path}, ballast ${ballast}: ${r.underruns} underruns (${r.underrunMs} ms of audio missing in 16 s) · ${r.latencyHint} at ${r.sampleRate / 1000} kHz, buffer ${r.baseLatencyMs} ms, output latency ${r.outputLatencyMs} ms · one-shots peak ${r.voicesPeak}`);
      }
    }
    process.exit(0);
  }
  if (process.argv.includes('--stall')) {
    for (const [path, profile] of [['previous', 'normal'], ['current', 'normal'], ['previous', 'heavy'], ['current', 'heavy']]) {
      const r = await page.evaluate((a) => window.__audio.simulate(a), { path, profile });
      console.log(`${path}, ${profile} hitches: ${r.hitches} hitches plus 30 FPS frames (${r.hitchMs} ms of long frames, longest ${r.longestMs} ms)`);
      console.log(`  engine held without controls ${r.engineFrozenMs} ms (worst ${r.engineWorstFreezeMs} ms) · music 16ths dropped ${r.musicDropped}, queued late ${r.musicLate}`);
      console.log(`  one-shots sounding at once: peak ${r.voicesPeak}, stolen ${r.voicesStolen}, dropped ${r.voicesDropped} · peak ${r.peakDb} dBFS, non-finite ${r.nonFinite}`);
      if (r.nonFinite) failed = true;
    }
    // The previous path at the phone's own rate; the current one at the rate the Android
    // build now runs at (core/audio.js ANDROID_RATE) and at desktop rate.
    for (const [path, rate] of [['previous', 48000], ['current', 48000], ['current', 32000]]) {
      const c = await page.evaluate(([p, r]) => window.__audio.cost(p, { rate: r }), [path, rate]);
      console.log(`audio-thread cost, ${path} at ${rate / 1000} kHz: ${c.renderMs} ms to render 24 s (${c.corePct}% of one core here)`);
    }
    process.exit(failed ? 1 : 0);
  }
  const names = process.argv.slice(2).length ? process.argv.slice(2) : await page.evaluate(() => window.__audio.names);
  await mkdir(out, { recursive: true });
  for (const name of names) {
    const r = await page.evaluate((n) => window.__audio.render(n), name);
    await writeFile(path.join(out, `${name}.wav`), Buffer.from(r.wav, 'base64'));
    const s = r.stats;
    console.log(`${name}: peak ${s.peakDb} dBFS, rms ${s.rmsDb} dBFS, non-finite ${s.nonFinite}, rendered in ${r.ms} ms`);
    console.log(`  limiter p99 ${s.limiterMaxDb} dB, busy ${s.limiterBusyPct}% · clipper ${s.clipperPct}% of samples (input peak ${s.clipInDb} dBFS) · <150 Hz ${s.lowPct}% of energy · peak/rms into limiter ${s.limIn} dBFS`);
    for (const line of r.log) console.log(`  ${line}`);
    if (r.stats.nonFinite) failed = true;
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
