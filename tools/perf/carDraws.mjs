// Per-frame draw breakdown (v75): every draw call of one race frame, grouped by owner (the
// player's car, rivals, wheel batches, scenery), with the player car's textures.
//   npm run build && node tools/perf/carDraws.mjs [--car id] [--lowend] [--quality q] [--view v] [--root dir]
import { preview } from 'vite';
import path from 'node:path';
const arg = (n, f) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : f; };
const root = path.resolve(arg('root', '/home/user/v75'));
const LOWEND = process.argv.includes('--lowend');
const CAR = arg('car', 'sv-stallion'); const VIEW = arg('view', 'chase'); const Q = arg('quality', null);
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
const server = await preview({ root, preview: { port: 4390, strictPort: false }, logLevel: 'error' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 })).newPage();
if (LOWEND) await page.addInitScript(() => { for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) { const get = C?.prototype.getParameter; if (get) C.prototype.getParameter = function (p) { return p === 0x9246 ? 'PowerVR Rogue GE8320' : get.call(this, p); }; } });
await page.goto(`${server.resolvedUrls.local[0]}?debug`);
await page.waitForFunction(() => window.__app && window.__garage, null, { timeout: 120000 });
const res = await page.evaluate(async ({ car, view, q }) => {
  const app = window.__app;
  app.ads.maybeShowInterstitial = async () => false; app.ads.setBanner = () => {};
  if (app.dialogue) app.dialogue.play = async () => {};
  if (q) window.__garage.setQuality(q);
  if (!app.state.cars[car]) app.state.cars[car] = JSON.parse(JSON.stringify(app.state.cars[app.state.car]));
  if (!app.state.ownedCars.includes(car)) app.state.ownedCars.push(car);
  app.state.car = car; app.state.settings.cameraView = view;
  await app.startRace(app.pickStage('ec-01'));
  const r = app.race; r.stop(); r.running = true; r.autopilot();
  let g = 0; while (r.phase !== 'racing' && g++ < 900) r.update(1 / 30);
  for (let i = 0; i < 60; i++) r.update(1 / 30);
  r.render();
  const R = r.renderer; const orig = R.renderBufferDirect.bind(R);
  const rows = [];
  const owner = (o) => { const chain = []; let p = o; while (p) { chain.push(p.name || p.type); p = p.parent; } return chain.reverse().slice(1, 4).join('/'); };
  R.renderBufferDirect = function (cam, scene, geo, mat, obj, grp) {
    const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3 * (obj.count ?? 1);
    rows.push({ tgt: R.getRenderTarget()?.texture?.name || (R.getRenderTarget() ? 'rt' : 'screen'), owner: owner(obj), name: obj.name, mat: mat.name || mat.type, tris: Math.round(tris), player: (() => { let p = obj; while (p) { if (p === r.player.visual.root) return true; p = p.parent; } return false; })() });
    return orig(cam, scene, geo, mat, obj, grp);
  };
  r.update(1 / 60); r.render();
  R.renderBufferDirect = orig;
  const texs = [];
  r.player.visual.root.traverse((o) => { if (!o.isMesh) return; for (const m of [].concat(o.material)) for (const v of Object.values(m)) if (v?.isTexture) texs.push(`${m.name}.${v.name} ${v.image?.width}x${v.image?.height}`); });
  return { tier: r.cockpit?.tier, quality: window.__garage.qualityLevel, rows, texs: [...new Set(texs)] };
}, { car: CAR, view: VIEW, q: Q });
const by = {};
for (const x of res.rows) { const k = `${x.tgt} | ${x.player ? 'PLAYER ' : ''}${x.owner}`; by[k] ??= { n: 0, tris: 0, names: new Set() }; by[k].n++; by[k].tris += x.tris; by[k].names.add(`${x.name}:${x.mat}`); }
console.log('tier', res.tier, 'quality', res.quality, 'draws', res.rows.length);
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].n - a[1].n)) console.log(String(v.n).padStart(4), String(v.tris).padStart(8), k, [...v.names].slice(0, 12).join(' '));
for (const x of res.rows) if (x.player || /Group\/Group\/Group|wheels/.test(x.owner)) console.log('  ', x.player ? 'P' : 'R', x.owner, x.name, x.mat, x.tris);
console.log('player textures:', res.texs.join(', '));
await browser.close(); server.httpServer.close();
