// Hitch profiler: one race driven frame by frame for a fixed stretch of race time, with the
// WebGL context and the JS heap watched on every frame. SwiftShader frame times are not phone
// frame times, so a hitch is judged on what a frame does, not only how long it takes here:
//
//   - shader compiles / program links (a phone stalls 50-500 ms on each),
//   - GPU buffer and texture uploads (bytes per frame) and render-target (re)allocations,
//   - JS heap growth per frame (what the garbage collector will have to clean up),
//   - garbage collections seen (the heap shrinking between two frames),
//   - the frame's own JS time (Race.update) and render time.
//
//   npm run build && node tools/perf/hitch.mjs [--stage ec-01] [--seconds 60] [--quality high]
//     [--out file.json] [--realtime]
//
// --realtime drives the race with the browser's own requestAnimationFrame loop (wall-clock dt,
// the auto-quality checks, the audio metronome) instead of fixed 1/60 s steps.
import { preview } from 'vite';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const STAGES = arg('stage', 'ec-01').split(',');
const SECONDS = Number(arg('seconds', 60));
const QUALITY = arg('quality', 'high');
const OUT = arg('out', null);
const REALTIME = process.argv.includes('--realtime');
// SwiftShader renders every pixel on the CPU: a small buffer keeps a 60 s run to minutes. What
// a frame asks of the driver (compiles, uploads, allocations) does not depend on its size.
const WIDTH = Number(arg('width', 480));
const DPR = Number(arg('dpr', 1));
// Simulated frame rate of the fixed-step run.
const FPS = Number(arg('fps', 60));

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
const server = await preview({ root, preview: { port: 4337, strictPort: false }, logLevel: 'error' });
const browser = await chromium.launch({
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--enable-precise-memory-info', '--js-flags=--expose-gc', '--autoplay-policy=no-user-gesture-required',
  ],
});
// Phone landscape (20:9).
const context = await browser.newContext({ viewport: { width: WIDTH, height: Math.round((WIDTH * 9) / 20) }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (m) => (m.type() === 'error' ? console.error('console:', m.text()) : m.text().startsWith('[hitch]') && console.log(m.text())));
// Web Audio watcher, installed before the game loads: every call the main thread makes into
// the audio graph (node creation, connect / disconnect, source start / stop, AudioParam
// automation and .value writes), counted by kind. Port messages to an AudioWorklet are
// counted apart: they are not graph calls.
await page.addInitScript(() => {
  const a = (window.__webAudio = { create: 0, connect: 0, disconnect: 0, startStop: 0, param: 0, worklet: 0, byName: {} });
  const count = (kind, name) => {
    a[kind]++;
    a.byName[name] = (a.byName[name] ?? 0) + 1;
  };
  const wrap = (proto, name, kind) => {
    const orig = proto?.[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (...args) {
      count(kind, name);
      return orig.apply(this, args);
    };
  };
  const BAC = window.BaseAudioContext?.prototype;
  if (BAC) for (const n of Object.getOwnPropertyNames(BAC)) if (n.startsWith('create')) wrap(BAC, n, 'create');
  wrap(window.AudioNode?.prototype, 'connect', 'connect');
  wrap(window.AudioNode?.prototype, 'disconnect', 'disconnect');
  for (const n of ['start', 'stop']) wrap(window.AudioScheduledSourceNode?.prototype, n, 'startStop');
  const AP = window.AudioParam?.prototype;
  for (const n of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'setValueCurveAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) wrap(AP, n, 'param');
  const value = AP && Object.getOwnPropertyDescriptor(AP, 'value');
  if (value?.set)
    Object.defineProperty(AP, 'value', { ...value, set(v) { count('param', 'value='); value.set.call(this, v); } });
  // Node constructors (new GainNode(ac)) count as creations too.
  for (const n of Object.getOwnPropertyNames(window)) {
    if (!/^[A-Z]\w*Node$/.test(n) || n === 'AudioNode' || !(window[n]?.prototype instanceof (window.AudioNode ?? Object))) continue;
    const C = window[n];
    window[n] = new Proxy(C, { construct(T, args, nt) { count('create', n); return Reflect.construct(T, args, nt); } });
  }
  const port = window.MessagePort?.prototype;
  if (port) {
    const post = port.postMessage;
    port.postMessage = function (...args) {
      a.worklet++;
      return post.apply(this, args);
    };
  }
});
await page.goto(`${server.resolvedUrls.local[0]}?debug`);
await page.waitForFunction(() => window.__app && window.__garage, null, { timeout: 120000 });

// WebGL watcher: counts what each frame asks of the driver.
await page.evaluate((q) => {
  window.__app.ads.maybeShowInterstitial = async () => false;
  window.__app.ads.setBanner = () => {};
  window.__app.dialogue && (window.__app.dialogue.play = async () => {});
  window.__garage.setQuality(q);
  const gl = window.__garage.renderer.getContext();
  const c = { compile: 0, link: 0, uploadBytes: 0, uploads: 0, texUploads: 0, rtAlloc: 0 };
  window.__gl = c;
  const bytes = (d) => (d && d.byteLength) || (typeof d === 'number' ? d : 0);
  const wrap = (name, fn) => {
    const orig = gl[name];
    if (!orig) return;
    gl[name] = function (...a) {
      fn(a);
      return orig.apply(this, a);
    };
  };
  // Which shader, for finding what still compiles mid-race (three names them SHADER_NAME).
  const shaders = (window.__shaders = []);
  wrap('compileShader', (a) => {
    c.compile++;
    const src = gl.getShaderSource(a[0]) || '';
    const name = /#define SHADER_NAME (.*)/.exec(src)?.[1] ?? '?';
    const defs = (src.match(/^#define (USE_\w+|INSTANC\w+|DOUBLE_SIDED|FLAT_SHADED|USE_FOG|FOG_EXP2)/gm) || []).map((d) => d.slice(8));
    const r = window.__app.race;
    shaders.push({ t: r?.raceTime ?? null, phase: r?.phase ?? null, name, defs: defs.join(' ') });
  });
  wrap('linkProgram', () => c.link++);
  wrap('bufferData', (a) => { c.uploads++; c.uploadBytes += bytes(a[1]); });
  wrap('bufferSubData', (a) => {
    c.uploads++;
    // (target, offset, data, srcOffset, length): WebGL2 partial uploads count `length` elements.
    const d = a[2];
    c.uploadBytes += a[4] != null && d?.BYTES_PER_ELEMENT ? a[4] * d.BYTES_PER_ELEMENT : bytes(d);
  });
  for (const n of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'compressedTexImage2D']) wrap(n, () => c.texUploads++);
  for (const n of ['renderbufferStorage', 'renderbufferStorageMultisample', 'texStorage2D']) wrap(n, () => c.rtAlloc++);
}, QUALITY);

async function profile(id) {
  await page.evaluate(async (id) => {
    const app = window.__app;
    if (app.mode === 'race') await app.exitToMap();
    if (app.mode === 'map') await app.backToGarage();
    // A player has heard the garage long before a race: the car mixer is loaded by then.
    const audio = await app.audioLoaded();
    console.log(`[hitch] audio ${JSON.stringify(audio?.carMixer ?? null)}`);
    await app.startRace(app.pickStage(id));
  }, id);
  return page.evaluate(async ({ seconds, realtime, fps }) => {
    const r = window.__app.race;
    const gl = r.renderer.getContext();
    const px = new Uint8Array(4);
    const c = window.__gl;
    const heap = () => performance.memory.usedJSHeapSize;
    r.autopilot();
    const frames = [];
    let prevHeap = heap();
    let gcs = 0;
    const wa = window.__webAudio;
    const calls = () => wa.create + wa.connect + wa.disconnect + wa.startStop + wa.param;
    let lastCalls = calls();
    let racingNames = null;
    const sample = (fn) => {
      const snap = { ...c };
      // Graph calls since the last frame ended: timers, the audio metronome, promises.
      const between = calls() - lastCalls;
      const a0 = calls();
      const w0 = wa.worklet;
      if (!racingNames && (r.phase === 'racing')) racingNames = { ...wa.byName };
      const h0 = heap();
      if (h0 < prevHeap) gcs++;
      const t0 = performance.now();
      fn();
      const t1 = performance.now();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // waits for the GPU
      const t2 = performance.now();
      const h1 = heap();
      prevHeap = h1;
      lastCalls = calls();
      const f = { t: +r.raceTime.toFixed(3), phase: r.phase, ms: +(t2 - t0).toFixed(2), js: +(t1 - t0).toFixed(2), alloc: h1 >= h0 ? h1 - h0 : 0, gc: h1 < h0 };
      if (lastCalls - a0) f.audio = lastCalls - a0;
      if (between) f.audioBetween = between;
      if (wa.worklet - w0) f.port = wa.worklet - w0;
      for (const k of Object.keys(c)) if (c[k] !== snap[k]) f[k] = c[k] - snap[k];
      frames.push(f);
      if (frames.length % 300 === 0) console.log(`[hitch] ${frames.length} frames, race ${f.t.toFixed(1)} s`);
    };
    if (realtime) {
      // The game's own loop, wrapped.
      r.stop();
      const frame = r.frame;
      r.running = true;
      r.last = performance.now();
      await new Promise((done) => {
        r.renderer.setAnimationLoop((now) => {
          sample(() => frame(now));
          if (r.raceTime >= seconds || r.result) {
            r.renderer.setAnimationLoop(null);
            done();
          }
        });
      });
    } else {
      r.stop();
      // Intro and countdown at 60 FPS too: the first racing frames matter.
      let guard = 0;
      while (r.raceTime < seconds && !r.result && guard++ < seconds * fps + 600) {
        sample(() => {
          r.update(1 / fps);
          r.bloom.render(r.scene, r.camera);
        });
      }
    }
    const racing = frames.filter((f) => f.phase === 'racing' || f.phase === 'finished');
    const sum = (k, list = racing) => list.reduce((a, f) => a + (f[k] ?? 0), 0);
    const ms = racing.map((f) => f.ms).sort((a, b) => a - b);
    const pct = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
    return {
      stage: window.__app.stage.stageId,
      frames: frames.length,
      racingFrames: racing.length,
      raceSeconds: +r.raceTime.toFixed(1),
      buffer: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
      pixelRatio: r.renderer.getPixelRatio(),
      racing: {
        compiles: sum('compile'),
        links: sum('link'),
        rtAllocs: sum('rtAlloc'),
        texUploads: sum('texUploads'),
        uploadFrames: racing.filter((f) => f.uploadBytes).length,
        uploadMBPerSecond: +(sum('uploadBytes') / 1048576 / Math.max(1, r.raceTime)).toFixed(2),
        maxUploadKB: +(Math.max(0, ...racing.map((f) => f.uploadBytes ?? 0)) / 1024).toFixed(1),
        allocKBPerFrame: +(sum('alloc') / 1024 / Math.max(1, racing.length)).toFixed(1),
        gcs: racing.filter((f) => f.gc).length,
        msP50: pct(0.5), msP95: pct(0.95), msP99: pct(0.99), msMax: ms[ms.length - 1],
        jsAvg: +(sum('js') / Math.max(1, racing.length)).toFixed(2),
        jsMax: Math.max(...racing.map((f) => f.js)),
        // Main-thread Web Audio graph calls while racing: inside the frame, and from timers
        // between frames; port messages to the audio worklet mixer per frame.
        audioCallsPerFrame: +(sum('audio') / Math.max(1, racing.length)).toFixed(2),
        audioFrames: racing.filter((f) => f.audio).length,
        audioCallsBetweenFrames: sum('audioBetween'),
        portMessagesPerFrame: +(sum('port') / Math.max(1, racing.length)).toFixed(2),
        audioByName: Object.fromEntries(Object.entries(wa.byName).map(([k, v]) => [k, v - (racingNames?.[k] ?? 0)]).filter(([, v]) => v > 0)),
      },
      before: {
        compiles: sum('compile', frames.filter((f) => !racing.includes(f))),
        rtAllocs: sum('rtAlloc', frames.filter((f) => !racing.includes(f))),
      },
      // Shaders compiled once the race was running: each one is a hitch the warm-up missed.
      lateShaders: window.__shaders.filter((x) => x.phase === 'racing' || x.phase === 'finished'),
      frameLog: frames,
    };
  }, { seconds: SECONDS, realtime: REALTIME, fps: FPS });
}

const results = [];
for (const id of STAGES) {
  const res = await profile(id);
  const { frameLog, ...summary } = res;
  console.log(JSON.stringify(summary));
  results.push(res);
}
if (OUT) await writeFile(OUT, JSON.stringify(results, null, 1));
await browser.close();
server.httpServer.close();
