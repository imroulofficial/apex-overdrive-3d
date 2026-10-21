import * as THREE from 'three';
import { Track } from './track.js';
import { buildTrackMeshes } from './trackMeshes.js';
import { buildScenery } from './scenery.js';
import { SmashProps } from './props.js';
import { Vehicle, statsToParams, NITRO } from './vehicle.js';
import { AIDriver } from './ai.js';
import { CarFactory } from './raceCars.js';
import { createCar } from '../garage/carModel.js';
import { loadCar } from '../assets/modelLoader.js';
import { ChaseCamera } from './chaseCamera.js';
import { Particles, SpeedLines, softDotTexture } from './effects.js';
import { mulberry32 } from './noise.js';
import { RIVALS, POSITION_REWARD, DRIFT_POINTS_PER_COIN, SMASH_COINS, starsFor } from '../data/rivals.js';
import { raceSfx, createEngineSound } from '../core/audio.js';
import { BASE_STATS as BASE } from '../data/catalog.js';

// One race on a track: owns the 3D scene, the six cars, the race state machine
// (intro → countdown → racing → finished) and reports to the HUD every frame.

const STEP = 1 / 60;
const SMOKE = new THREE.Color(0xe9ebee);
const DUST = new THREE.Color(0xc9b48a);
const SPARK = new THREE.Color(0xffb347);
const PULSE_SPARK = new THREE.Color(0xc062ff);
const COUNTDOWN_STEP = 0.9;
const now = () => performance.now() / 1000;

export class Race {
  constructor(renderer, def, { onFps } = {}) {
    this.renderer = renderer;
    this.def = def;
    this.onFps = onFps;
    this.hud = null;
    this.ready = false;
    this.running = false;
    this.frame = this.frame.bind(this);
    this.resize = this.resize.bind(this);
  }

  // Builds the world once (procedural, a few hundred ms) and pre-compiles its shaders.
  async prepare({ quality, paint, car }) {
    if (this.ready) return;
    const renderer = this.renderer;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(64, 1, 0.3, 3200);
    this.scene.add(this.camera);
    this.track = new Track(this.def);
    this.scenery = buildScenery(this.scene, renderer, this.track, this.def, quality);
    this.scene.add(buildTrackMeshes(this.track, renderer));
    this.props = new SmashProps(this.track, this.def, this.scene);

    // Rivals share the procedural coupe; the player's car comes from the spawner (.glb or procedural).
    this.rivalFactory = new CarFactory(createCar({ paintColor: paint.color, finish: paint.finish, detail: 0.6 }));
    this.factory = new CarFactory(await loadCar(car, { paintColor: paint.color, finish: paint.finish, detail: 0.6 }));
    this.playerCarId = car.id;
    const dot = softDotTexture();
    this.smoke = new Particles(this.scene, { count: 360, texture: dot });
    this.sparks = new Particles(this.scene, { count: 160, additive: true, texture: dot });
    this.speedLines = new SpeedLines(this.camera);
    this.chase = new ChaseCamera(this.camera);

    this.racers = [];
    const player = this.factory.build({ player: true });
    this.racers.push({ id: 'player', name: 'You', color: paint.color, isPlayer: true, visual: player });
    for (const r of RIVALS) {
      this.racers.push({ ...r, isPlayer: false, visual: this.rivalFactory.build({ color: r.color, finish: r.finish }) });
    }
    for (const racer of this.racers) this.scene.add(racer.visual.root);
    this.player = this.racers[0];

    this.shadowState = renderer.shadowMap.enabled;
    window.addEventListener('resize', this.resize);
    this.resize();
    // Place cars so the compile pass sees a representative frame.
    this.reset({ upgrades: { engine: 0, nitro: 0, handling: 0, tires: 0 }, stats: null });
    this.chase.snap(this.player.vehicle);
    await renderer.compileAsync(this.scene, this.camera);
    this.ready = true;
  }

  // Swaps the player's car between races (garage selection changed). Physics is untouched:
  // the Vehicle keeps simulating and the new visual just follows it.
  async setPlayerCar(car, paint) {
    if (car.id === this.playerCarId) return;
    const old = this.player.visual;
    this.factory = new CarFactory(await loadCar(car, { paintColor: paint.color, finish: paint.finish, detail: 0.6 }));
    this.playerCarId = car.id;
    this.player.visual = this.factory.build({ player: true });
    this.scene.remove(old.root);
    this.scene.add(this.player.visual.root);
    old.root.traverse((o) => o.isMesh && o.geometry.dispose());
    if (this.player.vehicle) this.player.visual.update(this.player.vehicle, 0, 0);
    await this.renderer.compileAsync(this.scene, this.camera);
  }

  resize() {
    if (!this.camera) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const ph = h * this.renderer.getPixelRatio();
    this.smoke.setViewport(ph, this.camera.fov);
    this.sparks.setViewport(ph, this.camera.fov);
  }

  // stats: player's effective stats (0..100) from the garage upgrades.
  reset({ stats }) {
    const track = this.track;
    const L = track.length;
    const rand = mulberry32(Math.floor(Math.random() * 1e9));
    const base = stats ?? BASE;
    // Rivals scale a little with the player's upgrades so races stay close.
    const upgradeBoost = stats ? Math.max(0, (stats.speed + stats.handling + stats.grip + stats.nitro - 200) / 4) * 0.45 : 0;
    const order = [0, 1, 2, 3, 4]; // rival grid order (shuffled)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.racers.forEach((r, idx) => {
      const slot = r.isPlayer ? 5 : order[idx - 1];
      const s = L - 14 - Math.floor(slot / 2) * 11;
      const d = slot % 2 ? 4.2 : -4.2;
      let params;
      if (r.isPlayer) params = statsToParams(base);
      else {
        params = statsToParams({
          speed: BASE.speed + r.stats.speed + upgradeBoost,
          nitro: BASE.nitro + r.stats.nitro + upgradeBoost,
          handling: BASE.handling + r.stats.handling + upgradeBoost,
          grip: BASE.grip + r.stats.grip + upgradeBoost,
        });
      }
      if (!r.vehicle) r.vehicle = new Vehicle(track, params, { passiveNitro: r.isPlayer ? 0.6 : 3.2 });
      r.vehicle.params = params;
      r.vehicle.reset(s, d);
      if (!r.isPlayer) r.ai = new AIDriver(r.vehicle, track, { aggression: r.aggression, skill: r.skill, laneBias: r.laneBias, rand });
      else r.ai = null;
      r.lapsDone = -1;
      r.lastS = r.vehicle.proj.s;
      r.progress = r.vehicle.proj.s - L;
      r.finished = false;
      r.finishTime = 0;
      r.lapStart = 0;
      r.lapTimes = [];
      r.visual.update(r.vehicle, 0, 0);
    });
    this.props.reset();
    this.smoke.clear();
    this.sparks.clear();
    this.time = 0;
    this.raceTime = 0;
    this.stateTime = 0;
    this.phase = 'intro';
    this.driftTotal = 0;
    this.smashes = 0;
    this.bigAirs = 0;
    this.result = null;
    this.lastCountdown = null;
    this.hits = [];
    this.positions = [...this.racers];
  }

  begin({ stats, paint, input, hud, onFinish, autoQuality = false }) {
    this.autoQuality = autoQuality;
    this.input = input;
    this.hud = hud;
    this.onFinish = onFinish;
    this.factory.setPlayerPaint(paint.color, paint.finish);
    this.player.color = paint.color;
    if (this.shadowState !== this.renderer.shadowMap.enabled) {
      this.shadowState = this.renderer.shadowMap.enabled;
      this.scene.traverse((o) => o.material && [].concat(o.material).forEach((m) => (m.needsUpdate = true)));
    }
    this.scenery.sun.castShadow = this.renderer.shadowMap.enabled;
    this.reset({ stats });
    input.setEnabled(false);
    this.chase.intro(this.player.vehicle, 3.2);
    this.engine?.stop();
    this.engine = createEngineSound();
    this.hud.intro(this.def);
    this.start();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.slowSeconds = 0;
    this.renderer.setAnimationLoop(this.frame);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  pause() {
    if (this.phase === 'paused' || !this.running) return;
    this.resumePhase = this.phase;
    this.phase = 'paused';
    this.input.setEnabled(false);
    this.engine?.update({ rpm: 0, gear: 0, speed: 0, load: 0, skid: 0, boost: 0, volume: 0 });
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.phase = this.resumePhase;
    this.last = performance.now();
    this.input.setEnabled(this.phase === 'racing');
  }

  get isPaused() {
    return this.phase === 'paused';
  }

  exit() {
    this.stop();
    this.input?.setEnabled(false);
    this.engine?.stop();
    this.engine = null;
  }

  frame(nowMs) {
    const dt = Math.min(0.05, (nowMs - this.last) / 1000);
    this.last = nowMs;
    this.trackPerformance(dt);
    if (this.phase !== 'paused') this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  trackPerformance(dt) {
    this.fpsAcc += dt;
    this.fpsFrames += 1;
    if (this.fpsAcc < 1) return;
    const fps = this.fpsFrames / this.fpsAcc;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.onFps?.(fps);
    // Auto quality: lower the render resolution if we cannot hold ~60 FPS.
    if (!this.autoQuality) return;
    this.slowSeconds = fps < 50 ? this.slowSeconds + 1 : 0;
    const pr = this.renderer.getPixelRatio();
    if (this.slowSeconds >= 3 && pr > 1) {
      this.renderer.setPixelRatio(Math.max(1, pr - 0.25));
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.resize();
      this.slowSeconds = 0;
    }
  }

  update(dt) {
    this.time += dt;
    this.stateTime += dt;
    const player = this.player.vehicle;

    if (this.phase === 'intro') {
      if (this.chase.mode !== 'intro') this.toPhase('countdown');
    } else if (this.phase === 'countdown') {
      const n = 3 - Math.floor(this.stateTime / COUNTDOWN_STEP);
      if (n !== this.lastCountdown) {
        this.lastCountdown = n;
        if (n > 0) {
          raceSfx.beep();
          this.hud.countdown(String(n));
        } else {
          raceSfx.go();
          this.hud.countdown('GO!');
          this.toPhase('racing');
          this.input.setEnabled(true);
        }
      }
    }

    const simulate = this.phase === 'racing' || this.phase === 'finished';
    const playerInput = this.input.read(dt);
    if (!simulate) {
      playerInput.nitroTaps.length = 0;
    } else {
      this.raceTime += dt;
      const steps = Math.max(1, Math.ceil(dt / STEP));
      const h = dt / steps;
      for (let k = 0; k < steps; k++) this.simStep(h, playerInput, k === 0);
      this.updateLaps();
    }

    // Visuals.
    for (const r of this.racers) {
      if (r.isPlayer) r.visual.steerInput = r.ai ? r.ai.input.steer : playerInput.steer;
      else r.visual.steerInput = r.ai.input.steer;
      r.visual.update(r.vehicle, dt, this.time);
      this.emitEffects(r, dt);
    }
    this.smoke.update(dt, -0.6);
    this.sparks.update(dt, 9);
    this.props.update(dt);
    this.scenery.update(this.time, this.camera);
    this.scenery.follow(player.pos);

    this.chase.update(dt, player, { boostTier: player.tier });
    const lineLevel = player.tier === 2 ? 1 : player.tier === 1 ? 0.5 : 0;
    this.speedLines.update(dt, simulate ? lineLevel : 0, Math.max(20, player.speed), player.tier);

    this.processEvents();
    this.updateEngine(playerInput);
    this.updateHud();

    if (this.phase === 'finished' && !this.resultShown && this.stateTime > 1.6) {
      this.resultShown = true;
      this.hud.results(this.result);
    }
  }

  toPhase(p) {
    this.phase = p;
    this.stateTime = 0;
  }

  simStep(h, playerInput, first) {
    const ctx = {
      time: this.time,
      cars: this.racers,
      props: this.props,
      racing: true,
      playerGap: 0,
    };
    const playerProgress = this.player.progress;
    for (const r of this.racers) {
      let input;
      if (r.ai) {
        ctx.playerGap = r.isPlayer ? 0 : playerProgress - r.progress;
        input = r.ai.update(h, ctx);
      } else {
        input = playerInput;
        if (!first) {
          // Edge events only once per frame.
          input = this._sub || (this._sub = { steer: 0, throttle: 1, brake: false, brakePressed: false, nitroTaps: [] });
          input.steer = playerInput.steer;
          input.brake = playerInput.brake;
        }
      }
      r.vehicle.step(h, input, r.ai ? this.time : now());
    }
    // Car-to-car contact.
    const n = this.racers.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) this.collideCars(this.racers[i].vehicle, this.racers[j].vehicle);
    // Props.
    for (const r of this.racers) {
      const hits = this.props.collide(r.vehicle, this.hits);
      for (const p of hits) {
        const big = p.type === 'panel';
        r.vehicle.vel.multiplyScalar(big ? 0.94 : 0.985);
        if (r.isPlayer) {
          raceSfx.smash(big);
          this.chase.bump(big ? 0.35 : 0.1);
          if (p.first) {
            this.smashes += 1;
            r.vehicle.addNitro(big ? 5 : 2);
            this.hud.callout(`SMASH +${SMASH_COINS}`, 'smash');
          }
        }
      }
    }
  }

  collideCars(a, b) {
    const dx0 = b.pos.x - a.pos.x;
    const dz0 = b.pos.z - a.pos.z;
    if (dx0 * dx0 + dz0 * dz0 > 36 || Math.abs(a.pos.y - b.pos.y) > 1.8) return;
    const offs = [1.15, -1.15];
    for (const oa of offs) {
      for (const ob of offs) {
        const ax = a.pos.x + Math.cos(a.heading) * oa;
        const az = a.pos.z - Math.sin(a.heading) * oa;
        const bx = b.pos.x + Math.cos(b.heading) * ob;
        const bz = b.pos.z - Math.sin(b.heading) * ob;
        let dx = bx - ax;
        let dz = bz - az;
        const d = Math.hypot(dx, dz);
        const minD = 2.0;
        if (d >= minD || d < 1e-4) continue;
        dx /= d;
        dz /= d;
        const pen = (minD - d) / 2;
        a.pos.x -= dx * pen;
        a.pos.z -= dz * pen;
        b.pos.x += dx * pen;
        b.pos.z += dz * pen;
        const rel = (b.vel.x - a.vel.x) * dx + (b.vel.y - a.vel.y) * dz;
        if (rel < 0) {
          const j = (-(1 + 0.3) * rel) / 2;
          a.vel.x -= dx * j;
          a.vel.y -= dz * j;
          b.vel.x += dx * j;
          b.vel.y += dz * j;
          a.yawRate += (Math.random() - 0.5) * j * 0.05;
          b.yawRate += (Math.random() - 0.5) * j * 0.05;
          a.emit('bump', -rel);
          b.emit('bump', -rel);
        }
      }
    }
  }

  updateLaps() {
    const L = this.track.length;
    const laps = this.def.laps;
    for (const r of this.racers) {
      const s = r.vehicle.proj.s;
      const ds = s - r.lastS;
      if (ds < -L / 2) {
        r.lapsDone += 1;
        if (r.lapsDone >= 1) r.lapTimes.push(this.raceTime - r.lapStart);
        r.lapStart = this.raceTime;
        if (r.lapsDone >= laps && !r.finished) this.finishRacer(r);
        else if (r.isPlayer && r.lapsDone === laps - 1 && laps > 1) {
          raceSfx.lap();
          this.hud.callout('FINAL LAP', 'lap');
        }
      } else if (ds > L / 2) {
        r.lapsDone -= 1;
      }
      r.lastS = s;
      r.progress = r.finished ? laps * L + 1e6 - r.finishTime : r.lapsDone * L + s;
    }
    this.positions = [...this.racers].sort((a, b) => b.progress - a.progress);
  }

  finishRacer(r) {
    r.finished = true;
    r.finishTime = this.raceTime;
    r.place = this.racers.filter((x) => x.finished).length;
    if (!r.isPlayer) return;
    // Player crossed the line: autopilot takes over while the camera orbits.
    r.ai = new AIDriver(r.vehicle, this.track, { aggression: 0.2, skill: 0.8 });
    if (r.vehicle.drifting) r.vehicle.endDrift();
    this.input.setEnabled(false);
    this.toPhase('finished');
    this.resultShown = false;
    this.chase.orbit(r.vehicle);
    raceSfx.finish();
    const position = r.place;
    const driftCoins = Math.floor(this.driftTotal / DRIFT_POINTS_PER_COIN);
    const smashCoins = this.smashes * SMASH_COINS;
    const positionCoins = POSITION_REWARD[position - 1] ?? 0;
    this.result = {
      trackId: this.def.id,
      trackName: this.def.name,
      position,
      total: this.racers.length,
      time: r.finishTime,
      bestLap: Math.min(...r.lapTimes),
      driftScore: Math.round(this.driftTotal),
      smashes: this.smashes,
      coins: { position: positionCoins, drift: driftCoins, smash: smashCoins, total: positionCoins + driftCoins + smashCoins },
      stars: starsFor(position),
    };
    this.hud.callout(position === 1 ? 'VICTORY!' : `FINISHED ${ordinal(position)}`, 'finish');
    this.onFinish?.(this.result);
  }

  processEvents() {
    const v = this.player.vehicle;
    for (const e of v.events) {
      switch (e.type) {
        case 'blue':
          raceSfx.nitro();
          this.hud.callout('NITRO', 'blue');
          break;
        case 'pulse':
          raceSfx.pulse();
          this.chase.bump(0.4);
          this.hud.callout('PULSE NITRO!', 'pulse');
          this.hud.flash('pulse');
          break;
        case 'pulseExtend':
          raceSfx.nitro();
          break;
        case 'nitroEmpty':
          raceSfx.empty();
          this.hud.callout('NITRO LOW', 'warn');
          break;
        case 'driftStart':
          this.hud.flash('drift');
          break;
        case 'driftEnd':
          if (e.value > 50) {
            this.driftTotal += e.value;
            raceSfx.driftBank();
            this.hud.driftBank(e.value);
          }
          break;
        case 'wall':
          if (e.value > 3) {
            raceSfx.wall(e.value);
            this.chase.bump(Math.min(0.6, e.value * 0.03));
          }
          break;
        case 'bump':
          if (e.value > 2) {
            raceSfx.bump();
            this.chase.bump(Math.min(0.5, e.value * 0.04));
          }
          break;
        case 'land':
          if (e.value > 4) {
            raceSfx.land(e.value);
            this.chase.bump(Math.min(0.7, e.value * 0.05));
          }
          break;
        case 'air':
          if (e.value > 0.6) {
            v.addNitro(e.value * 14);
            this.bigAirs += 1;
            this.hud.callout(`AIR ${e.value.toFixed(1)}s`, 'air');
          }
          break;
      }
    }
    v.events.length = 0;
    for (const r of this.racers) if (!r.isPlayer) r.vehicle.events.length = 0;
  }

  emitEffects(r, dt) {
    const v = r.vehicle;
    const near = v.pos.distanceToSquared(this.player.vehicle.pos) < 120 * 120;
    if (!near || v.airborne) return;
    const fx = Math.cos(v.heading);
    const fz = -Math.sin(v.heading);
    const slip = Math.abs(v.slip);
    const smoking = (v.drifting && slip > 0.15) || (v.braking && v.speed > 15);
    if (smoking) {
      const rate = v.drifting ? 34 : 14;
      r.smokeAcc = (r.smokeAcc ?? 0) + rate * dt;
      while (r.smokeAcc >= 1) {
        r.smokeAcc -= 1;
        for (const side of [-1, 1]) {
          const x = v.pos.x - fx * 1.3 + -fz * side * 0.86;
          const z = v.pos.z - fz * 1.3 + fx * side * 0.86;
          this.smoke.emit(x, v.pos.y + 0.25, z, v.vel.x * 0.15 + (Math.random() - 0.5) * 2, 0.8 + Math.random(), v.vel.y * 0.15 + (Math.random() - 0.5) * 2, {
            color: SMOKE,
            size: 0.7,
            life: 1.1 + Math.random() * 0.5,
            grow: 2.2,
            alpha: v.drifting ? 0.32 : 0.18,
          });
        }
      }
    }
    if (v.wallScrape > 0 && v.speed > 8) {
      for (let k = 0; k < 3; k++) {
        const side = Math.sign(v.proj.d);
        const x = v.pos.x + v.proj.rx * side * 0.9 + (Math.random() - 0.5) * 2;
        const z = v.pos.z + v.proj.rz * side * 0.9 + (Math.random() - 0.5) * 2;
        this.sparks.emit(x, v.pos.y + 0.4, z, v.vel.x * 0.6 + (Math.random() - 0.5) * 6, 2 + Math.random() * 4, v.vel.y * 0.6 + (Math.random() - 0.5) * 6, {
          color: SPARK,
          size: 0.16,
          life: 0.35 + Math.random() * 0.25,
          grow: -0.2,
          alpha: 1,
        });
      }
    }
    if (v.tier === 2 && r.isPlayer && Math.random() < 0.7) {
      const x = v.pos.x - fx * 2.5;
      const z = v.pos.z - fz * 2.5;
      this.sparks.emit(x, v.pos.y + 0.35, z, v.vel.x * 0.7 + (Math.random() - 0.5) * 3, Math.random() * 2, v.vel.y * 0.7 + (Math.random() - 0.5) * 3, {
        color: Math.random() < 0.5 ? PULSE_SPARK : SPARK,
        size: 0.22,
        life: 0.3,
        grow: -0.3,
        alpha: 0.9,
      });
    }
    if (Math.abs(v.proj.d) > this.track.halfWidth + 0.3 && v.speed > 12 && Math.random() < 0.5) {
      const x = v.pos.x - fx * 1.4;
      const z = v.pos.z - fz * 1.4;
      this.smoke.emit(x, v.pos.y + 0.2, z, v.vel.x * 0.1, 0.6, v.vel.y * 0.1, { color: DUST, size: 0.8, life: 0.8, grow: 2, alpha: 0.25 });
    }
  }

  updateEngine(input) {
    if (!this.engine) return;
    const v = this.player.vehicle;
    const P = v.params;
    const norm = Math.max(0, Math.min(1.35, Math.abs(v.forward) / P.topSpeed));
    const gears = 6;
    const g = Math.min(gears - 1, Math.floor(norm * gears * 0.999));
    let rpm = norm * gears - g;
    let load = this.phase === 'racing' || this.phase === 'finished' ? (input.brake && !v.drifting ? 0.2 : 1) : 0.15;
    if (this.phase === 'countdown' || this.phase === 'intro') {
      // Revving on the grid.
      rpm = 0.25 + 0.2 * Math.max(0, Math.sin(this.time * 3.1)) + (this.phase === 'countdown' ? 0.25 : 0);
      load = 0.4;
    }
    if (v.airborne) rpm = Math.min(1.2, rpm + 0.35);
    this.engine.update({
      rpm: Math.min(1.2, rpm),
      gear: g,
      speed: Math.min(1, v.speed / 70),
      load,
      skid: v.drifting ? Math.min(1, Math.abs(v.slip) * 2) : v.braking && v.speed > 12 ? 0.5 : 0,
      boost: v.tier,
    });
  }

  updateHud() {
    const v = this.player.vehicle;
    const p = this.player;
    const L = this.track.length;
    const laps = this.def.laps;
    const total = laps * L;
    this.hud.update({
      phase: this.phase,
      speed: Math.round(Math.abs(v.forward) * 3.6),
      position: this.positions.indexOf(p) + 1,
      total: this.racers.length,
      lap: Math.min(laps, Math.max(1, p.lapsDone + 1)),
      laps,
      time: p.finished ? p.finishTime : this.raceTime,
      nitro: v.nitro / NITRO.max,
      tier: v.tier,
      sinceTap: v.canPulse ? now() - v.lastTap : -1,
      drifting: v.drifting,
      driftScore: Math.round(v.driftScore),
      wrongWay: v.wrongWay > 1.2,
      racers: this.racers.map((r) => ({
        frac: Math.max(0, Math.min(1, r.finished ? 1 : r.progress / total)),
        color: r.color,
        isPlayer: r.isPlayer,
      })),
    });
  }
}

export function ordinal(n) {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
