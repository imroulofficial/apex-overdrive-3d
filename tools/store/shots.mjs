// The store listing shots: one seeded save and one scripted scene each (see render.mjs).
import path from 'node:path';
import { STAGES, MILESTONES } from '../../src/data/career.js';
import { SCENES } from '../../src/data/story.js';
import { CARS } from '../../src/data/cars.js';

export const FLAGSHIP = 'rpx-hyperion';

// A campaign well under way: Emerald Coast cleared with three stars (its last chest waiting),
// Alpine Summit two thirds done, Neon City just opened. Every car owned, so the garage shows
// the flagship as the player's own.
export function seededSave({ upTo = 'nc-01', car = FLAGSHIP, cameraView = 'chase', paint = 'factory', rim = 'stock', nitroFx = 'blue' } = {}) {
  const last = STAGES.findIndex((s) => s.stageId === upTo);
  const stageStars = STAGES.map((s, i) => (i < last ? (i % 7 === 5 ? 3 : 7) : 0));
  const cars = Object.fromEntries(
    CARS.map((c) => [c.id, { unlockedBy: c.unlock.type === 'starter' ? 'starter' : 'coins', upgrades: { topSpeed: 3, acceleration: 3, handling: 3, nitro: 3 }, paint: 'factory', rim: 'stock', rims: ['stock', 'mesh', 'turbofan', 'blade'], smoke: 'white', nitroFx: 'blue' }])
  );
  cars[car] = { ...cars[car], upgrades: { topSpeed: 5, acceleration: 4, handling: 5, nitro: 5 }, paint, rim, rims: ['stock', 'mesh', 'turbofan', 'blade', 'monoblock'], nitroFx };
  return {
    v: 2,
    coins: 48750,
    car,
    cars,
    ownedPaints: ['factory', 'apex-red', 'midnight', 'arctic', 'carbon', 'volt', 'sunset', 'ultraviolet', 'aqua-pearl'],
    career: {
      unlockedStage: last + 1,
      stageStars,
      best: {},
      milestones: MILESTONES.filter((m) => m.chapterId === 'emerald-coast' && m.stars < 60).map((m) => m.id),
    },
    settings: { quality: 'high', sound: false, music: false, autoAccelerate: true, showFps: false, controls: 'buttons', cameraView, bloom: 'high' },
    purchases: { owned: [], granted: [], noAds: false, paints: [] },
    ads: { crateClaimedAt: 0, racesSinceInterstitial: 0, nextInterstitialAt: 9, lastInterstitialAt: 0, racesFinished: 40 },
    story: { seen: Object.keys(SCENES) },
    savedAt: 1,
    ownedCars: CARS.map((c) => c.id),
  };
}

const shoot = (page, raw, name) => page.screenshot({ path: path.join(raw, `${name}.png`) });

// Starts a stage straight from the garage (debug shortcut), lets the autopilot drive the
// player's car and steps the race by hand at 30 Hz, rendering only the frames that are kept.
// `drift`: the autopilot's corners become handbrake drifts (brake tapped as it turns in, held
// while it steers). `holdBack`: the player lifts until the first rival is that many metres
// ahead of it (so the pack or the boss stays in shot).
async function startStage(page, stageId, { drift = false, holdBack = 0 } = {}) {
  await page.evaluate(async ({ id, drift, holdBack }) => {
    const app = window.__app;
    await app.startRace(id);
    const r = app.race;
    r.stop();
    r.autopilot(0.99);
    const ai = r.player.ai;
    const drive = ai.update.bind(ai);
    const leader = () => r.racers.reduce((a, x) => (!x.isPlayer && !x.out && (!a || x.progress > a.progress) ? x : a), null);
    ai.update = (h, ctx) => {
      const input = drive(h, ctx);
      const v = r.player.vehicle;
      if (holdBack && r.phase === 'racing' && leader().progress < r.player.progress + holdBack) input.throttle = 0.35;
      if (window.__store?.drift) {
        if (!v.drifting && Math.abs(input.steer) > 0.3 && v.speed > 20) {
          input.brakePressed = true;
          input.brake = 0.5;
        } else if (v.drifting) input.brake = Math.abs(input.steer) > 0.12 ? 0.35 : 0;
      }
      return input;
    };
    const step = (n) => {
      for (let i = 0; i < n && !r.result; i++) r.update(1 / 30);
    };
    // Lap fraction of the player's car along the track as built (forward spline).
    const frac = () => (((r.player.vehicle.proj.s / r.track.length) % 1) + 1) % 1;
    window.__store = {
      drift,
      step,
      frac,
      // Steps until `cond` holds (or `max` seconds pass); returns the race clock.
      until(cond, max = 120) {
        const test = new Function('r', 'frac', `return (${cond});`);
        for (let i = 0; i < max * 30 && !r.result; i++) {
          if (test(r, frac())) break;
          r.update(1 / 30);
        }
        return { time: r.raceTime, frac: frac(), phase: r.phase };
      },
      nitro(tier) {
        const v = r.player.vehicle;
        v.nitro = 100;
        v.tier = tier;
        v.boostT = 3;
        v.canPulse = false;
      },
      render() {
        r.bloom.render(r.scene, r.camera);
      },
    };
    let guard = 0;
    while (r.phase !== 'racing' && guard++ < 900) r.update(1 / 30);
  }, { id: stageId, drift, holdBack });
  // The intro card and the GO! animate in wall-clock time: let them clear.
  await page.waitForTimeout(5000);
}

// Steps until `cond`, optionally fires nitro (1 blue, 2 pulse) for the last `lead` seconds,
// renders and saves the frame.
// `burst`: a perfect-exit spark shower a few frames before the shot. `camera`: a fixed
// camera in the car's frame ({ ahead, side, up, look, fov }) instead of the chase camera.
// `quiet`: clears the callout stack before the shot.
async function capture(page, raw, name, { cond = 'true', max = 120, nitro = 0, lead = 0.8, view = null, burst = false, camera = null, hud = true, quiet = false } = {}) {
  const info = await page.evaluate(({ cond, max, nitro, lead, view, burst, camera, hud, quiet }) => {
    const s = window.__store;
    const r = window.__app.race;
    if (view) r.setCameraView(view);
    document.querySelector('#race-hud').style.visibility = hud ? '' : 'hidden';
    const res = s.until(cond, max);
    const frames = Math.max(nitro ? lead * 30 : 0, burst ? 4 : 0);
    for (let i = 0; i < frames; i++) {
      if (nitro) s.nitro(nitro);
      if (burst && i === frames - 4) r.perfectBurst(r.player.vehicle);
      s.step(1);
    }
    if (camera) {
      const v = r.player.vehicle;
      const fx = Math.cos(v.heading);
      const fz = -Math.sin(v.heading);
      const c = r.camera;
      c.position.set(v.pos.x + fx * camera.ahead - fz * camera.side, v.pos.y + camera.up, v.pos.z + fz * camera.ahead + fx * camera.side);
      c.lookAt(v.pos.x + fx * (camera.look ?? 0), v.pos.y + (camera.lookUp ?? 0.6), v.pos.z + fz * (camera.look ?? 0));
      if (camera.fov) c.fov = camera.fov;
      c.updateProjectionMatrix();
      r.culling.update(c);
    }
    // `quiet`: drop the stacked callouts so the frame is not covered in text.
    if (quiet) document.querySelector('#rh-callouts').replaceChildren();
    s.render();
    return { ...res, pos: r.positions.indexOf(r.player) + 1, speed: Math.round(r.player.vehicle.speed * 3.6) };
  }, { cond, max, nitro, lead, view, burst, camera, hud, quiet });
  await page.waitForTimeout(250);
  await shoot(page, raw, name);
  console.log(`  ${name}`, JSON.stringify(info));
  return info;
}

// Feature graphic title, in the game's own brand style (red APEX, white OVERDRIVE, heavy
// italic), laid over the rendered frame inside the page so it is drawn at full resolution.
async function titleCard(page) {
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.id = 'store-title';
    el.innerHTML = `
      <div class="t-main"><span class="t-apex">APEX</span> <span class="t-od">OVERDRIVE</span></div>
      <div class="t-sub"><i></i>3D RACING<i></i></div>`;
    const css = document.createElement('style');
    css.textContent = `
      #store-title { position: fixed; inset: 0; z-index: 99999; pointer-events: none; display: flex; flex-direction: column;
        align-items: center; justify-content: flex-start; padding-top: 44px; font-family: Inter, system-ui, sans-serif;
        background: radial-gradient(ellipse 46% 34% at 50% 24%, rgba(6,4,18,.62), rgba(6,4,18,0) 100%); }
      #store-title .t-main { font-weight: 900; font-style: italic; font-size: 76px; line-height: 1; letter-spacing: .01em;
        filter: drop-shadow(0 4px 0 rgba(0,0,0,.55)) drop-shadow(0 0 22px rgba(0,0,0,.6)); white-space: nowrap; }
      #store-title .t-apex { background: linear-gradient(180deg, #ff5a3a 0%, #ff2a3a 55%, #c4102a 100%); -webkit-background-clip: text; color: transparent; }
      #store-title .t-od { background: linear-gradient(180deg, #ffffff 0%, #f2f4f8 55%, #b9c6d8 100%); -webkit-background-clip: text; color: transparent; }
      #store-title .t-sub { margin-top: 10px; display: flex; align-items: center; gap: 14px; font-weight: 800; font-style: italic;
        font-size: 24px; letter-spacing: .42em; padding-left: .42em; color: #7ff3ff;
        text-shadow: 0 0 12px rgba(60,220,255,.85), 0 0 26px rgba(170,80,255,.7), 0 2px 0 rgba(0,0,0,.6); }
      #store-title .t-sub i { display: block; width: 64px; height: 3px; background: linear-gradient(90deg, rgba(127,243,255,0), #7ff3ff 60%, #c070ff); box-shadow: 0 0 10px #4fe3ff; }
      #store-title .t-sub i:last-child { transform: scaleX(-1); }`;
    document.head.append(css);
    document.body.append(el);
  });
}

export const SHOTS = [
  {
    id: 'garage',
    save: seededSave(),
    async run(page, { raw }) {
      await page.waitForTimeout(4000);
      await shoot(page, raw, 'garage-a');
      for (const tab of ['paint', 'rims']) {
        await page.click(`.tab[data-tab="${tab}"]`);
        await page.waitForTimeout(3000);
        await shoot(page, raw, `garage-${tab}`);
      }
    },
  },
  {
    id: 'ec',
    save: seededSave(),
    async run(page, { raw }) {
      await startStage(page, 'ec-01', { drift: true, holdBack: 8 });
      for (const t of [7, 8, 9, 10, 11, 13]) await capture(page, raw, `ec3-t${t}`, { cond: `r.raceTime >= ${t}`, burst: t % 2 === 1, quiet: true });
    },
  },
  {
    id: 'alpine',
    save: seededSave(),
    async run(page, { raw }) {
      await startStage(page, 'as-14', { drift: true, holdBack: 10 });
      for (const t of [7, 8, 9, 10, 11, 12, 14, 16]) await capture(page, raw, `as3-t${t}`, { cond: `r.raceTime >= ${t}`, burst: t % 2 === 0, quiet: true });
    },
  },
  {
    id: 'neon',
    save: seededSave(),
    async run(page, { raw }) {
      await startStage(page, 'nc-20', { holdBack: 4 });
      const gap = (lo, hi) => `(() => { const k = r.racers.find((x) => !x.isPlayer); const g = k.progress - r.player.progress; return r.raceTime > 4 && g > ${lo} && g < ${hi}; })()`;
      for (const [k, [lo, hi]] of [[3, 9], [1, 4], [3, 9], [1, 4], [5, 12]].entries()) await capture(page, raw, `nc4-${k}`, { cond: gap(lo, hi), max: 20, nitro: 2, lead: 0.12, quiet: true });
    },
  },
  {
    id: 'gorge',
    save: seededSave(),
    async run(page, { raw }) {
      await startStage(page, 'ec-05', { drift: true });
      const cams = [
        { ahead: -4, side: 14, up: 5, look: 8, fov: 55 },
        { ahead: -8, side: 18, up: 7, look: 10, fov: 55 },
        { ahead: 2, side: 12, up: 3, look: 4, fov: 58 },
        { ahead: -14, side: 26, up: 10, look: 14, fov: 50 },
      ];
      for (const f of [0.898, 0.905]) {
        await capture(page, raw, `gorge3-f${f}`, { cond: `frac >= ${f}`, quiet: true });
        for (const [k, camera] of cams.entries()) await capture(page, raw, `gorge3-f${f}-c${k}`, { camera, hud: false });
      }
    },
  },
  {
    id: 'tunnel',
    save: seededSave({ cameraView: 'hood' }),
    async run(page, { raw }) {
      await startStage(page, 'as-01');
      for (const f of [0.51, 0.52, 0.53]) await capture(page, raw, `tunnel-f${f}`, { cond: `frac >= ${f} && frac < 0.7`, nitro: 1, lead: 0.4 });
    },
  },
  {
    id: 'map',
    save: seededSave({ upTo: 'as-12' }),
    async run(page, { raw }) {
      await page.evaluate(() => window.__app.openMap());
      await page.waitForTimeout(8000);
      await shoot(page, raw, 'map-a');
      await page.evaluate(() => window.__app.map.focusChapter('emerald-coast'));
      await page.waitForTimeout(8000);
      await shoot(page, raw, 'map-c');
    },
  },
  {
    // The briefing of the stage the results shot clears (same save), for shot 8.
    id: 'brief',
    save: { ...seededSave({ upTo: 'nc-01' }), career: { ...seededSave({ upTo: 'nc-01' }).career, stageStars: seededSave({ upTo: 'nc-01' }).career.stageStars.map((v, i) => (i === 1 ? 0 : v)) } },
    async run(page, { raw }) {
      await page.evaluate(() => window.__app.openMap({ brief: window.__app.pickStage('ec-02') }));
      await page.waitForTimeout(9000);
      await shoot(page, raw, 'brief-ec02');
    },
  },
  {
    id: 'feature',
    viewport: { width: 1024, height: 500 },
    save: seededSave({ nitroFx: 'blue' }),
    async run(page, { raw }) {
      await startStage(page, 'ec-01', { drift: true });
      await titleCard(page);
      const cams = [
        { ahead: 6.5, side: 4.5, up: 1.0, look: 0, lookUp: 1.9, fov: 42 },
        { ahead: 6.5, side: -4.5, up: 1.0, look: 0, lookUp: 1.9, fov: 42 },
        { ahead: 3, side: 7, up: 1.2, look: -0.5, lookUp: 2.0, fov: 44 },
        { ahead: 3, side: -7, up: 1.2, look: -0.5, lookUp: 2.0, fov: 44 },
      ];
      for (let k = 0; k < 4; k++) {
        await page.evaluate(() => window.__store.until('r.player.vehicle.drifting && Math.abs(r.player.vehicle.slip) > 0.3', 60));
        for (const [c, camera] of cams.entries()) await capture(page, raw, `feature2-${k}-c${c}`, { cond: 'true', nitro: 1, lead: 0.1, burst: true, camera, hud: false });
        await page.evaluate(() => window.__store.step(60));
      }
    },
  },
  {
    id: 'results',
    tries: 4,
    // Stage 2 never cleared before, so every star lands as new (+250 chips).
    save: { ...seededSave({ upTo: 'nc-01' }), career: { ...seededSave({ upTo: 'nc-01' }).career, stageStars: seededSave({ upTo: 'nc-01' }).career.stageStars.map((v, i) => (i === 1 ? 0 : v)) } },
    async run(page, { raw }) {
      await startStage(page, 'ec-02', { drift: true });
      const res = await page.evaluate(() => {
        const r = window.__app.race;
        window.__store.until('!!r.result', 400);
        // Past the finish (the store helpers stop at a result): coast to the results panel.
        for (let i = 0; i < 30 * 4 && !r.resultShown; i++) r.update(1 / 30);
        window.__store.render();
        return { stars: r.result?.stars, pos: r.result?.position };
      });
      console.log('  results', JSON.stringify(res));
      await page.waitForTimeout(6000);
      await shoot(page, raw, res.stars === 7 ? 'results-a' : `results-${res.stars}-stars`);
      return res.stars === 7;
    },
  },
];
