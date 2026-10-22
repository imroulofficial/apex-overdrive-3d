import * as THREE from 'three';
import { Track } from './track.js';
import { buildTrackMeshes, buildDirectional } from './trackMeshes.js';
import { buildScenery } from './scenery.js';
import { loadEnvAssets } from '../render/envAssets.js';
import { SmashProps } from './props.js';
import { Vehicle, statsToParams, NITRO } from './vehicle.js';
import { DriftChain } from './driftChain.js';
import { AIDriver } from './ai.js';
import { CarFactory, FLAME } from './raceCars.js';
import { createCar, RACE_DETAIL } from '../garage/carModel.js';
import { loadCar } from '../assets/modelLoader.js';
import { ChaseCamera } from './chaseCamera.js';
import { Particles, SkidMarks, SpeedLines, softDotTexture } from './effects.js';
import { mulberry32 } from './noise.js';
import { ModeProps } from './modeProps.js';
import { courseFor, raceFraction } from './course.js';
import { createMode } from './modes/index.js';
import { draftFactor, DRAFT } from './modes/rules.js';
import { SMASH_COINS } from '../data/economy.js';
import { raceSfx, raceMusic, createEngineSound, createRainSound } from '../core/audio.js';
import { BASE_STATS as BASE } from '../data/catalog.js';
import { TRACK_SEGMENTS } from '../data/career.js';
import { WEATHER } from '../data/weather.js';
import { reverseTrackDef, generatePuddles, reversePuddles } from './routes.js';
import { Rain, Lightning, LensDrops, buildPuddles } from './atmosphere.js';
import { buildBridge, buildWaterfall, buildTrails, Seabirds } from './setPieces.js';
import { MobileBloom } from '../render/bloom.js';

// One race on a track: owns the 3D scene, the cars, the race state machine
// (intro → countdown → racing → finished) and reports to the HUD every frame. What kind of
// race it is (who is on the grid, how it ends, extra rules) comes from the stage's game mode
// (race/modes/index.js); the host tracks every car's distance along the stage's course.

const STEP = 1 / 60;
const SMOKE = new THREE.Color(0xe9ebee);
// The player's car is rebuilt when its body, rim or wing changes.
const lookKey = (car, look) => `${car.id}|${look.rim ?? 'stock'}|${look.spoiler ?? 'factory'}`;
const DUST = new THREE.Color(0xc9b48a);
const GRASS_BITS = new THREE.Color(0x8a9a52);
const SPARK = new THREE.Color(0xffb347);
const PULSE_SPARK = new THREE.Color(0xc062ff);
const PERFECT_SPARK = new THREE.Color(0x7dffe0);
const COUNTDOWN_STEP = 0.9;
const FIRE = new THREE.Color(0xff5a1a);
const EMBER = new THREE.Color(0xffc23a);
const SOOT = new THREE.Color(0x2a2b30);
const RED_DIRT = new THREE.Color(0xb4532c);
const SPRAY = new THREE.Color(0xd9e0e4);
const COAST_INPUT = { steer: 0, throttle: 0, brake: false, brakePressed: false, nitroTaps: [] };
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
  // `look` is the player's rim and rear wing ({ rim, spoiler }, from inventory.carLook).
  async prepare({ quality, paint, car, look = {}, stage }) {
    if (this.ready) return;
    const renderer = this.renderer;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(64, 1, 0.3, 3200);
    this.scene.add(this.camera);
    this.track = new Track(this.def);
    // Route variations: the reversed road is built the first time a stage needs it.
    this.tracks = { forward: this.track, reverse: null };
    // Bundled CC0 scans (road, ground, bark, fronds, rocks); loaded once per session.
    const env = await loadEnvAssets(renderer);
    this.scenery = buildScenery(this.scene, renderer, this.track, this.def, quality, env);
    const meshes = buildTrackMeshes(this.track, renderer, { groundMaterial: this.scenery.groundMaterial, env });
    this.scene.add(meshes);
    this.wet = meshes.userData.wet; // shared rain uniform: asphalt, kerbs, bridge, trails
    this.directional = { forward: meshes.getObjectByName('directional'), reverse: null };
    this.props = new SmashProps(this.track, this.def, this.scene);
    this.propSets = { forward: this.props, reverse: null };
    this.modeProps = new ModeProps(this.scene, this.track);

    // Biome set-pieces.
    const ground = (x, z) => this.scenery.terrain.sample(x, z).h;
    this.setPieces = [buildBridge(this.track, this.wet), buildWaterfall(this.scenery.terrain.gorge, ground), buildTrails(this.track, this.wet, env)].filter(Boolean);
    this.scene.add(...this.setPieces);
    this.waterfall = this.setPieces.find((o) => o.name === 'waterfall') ?? null;
    this.trailBarriers = this.setPieces.find((o) => o.name === 'trails')?.userData.barriers ?? null;
    this.seabirds = new Seabirds(this.track, this.def, ground);
    if (this.seabirds.flocks.length) this.scene.add(this.seabirds.mesh);

    // Weather in motion.
    this.puddleList = generatePuddles(this.track);
    this.puddles = buildPuddles(this.track, this.puddleList, this.scenery.waterNormals);
    this.scene.add(this.puddles);
    this.rain = new Rain(this.scene, quality);
    this.lightning = new Lightning();
    this.lens = new LensDrops();
    this.bloom = new MobileBloom(renderer);
    this.weather = null;

    // Rivals share the procedural coupe; the player's car comes from the spawner (.glb or procedural).
    this.rivalFactory = new CarFactory(createCar({ paintColor: paint.color, finish: paint.finish, detail: RACE_DETAIL }));
    this.factory = new CarFactory(await loadCar(car, { paintColor: paint.color, finish: paint.finish, detail: RACE_DETAIL, ...look }));
    this.playerCarKey = lookKey(car, look);
    this.playerFeel = car.feel;
    for (const f of [this.rivalFactory, this.factory]) this.scene.add(...f.sharedMeshes);
    this.skids = new SkidMarks(this.scene);
    const dot = softDotTexture();
    this.smoke = new Particles(this.scene, { count: 360, texture: dot });
    this.sparks = new Particles(this.scene, { count: 160, additive: true, texture: dot });
    this.speedLines = new SpeedLines(this.camera);
    this.chase = new ChaseCamera(this.camera);

    const player = this.factory.build({ player: true });
    this.player = { id: 'player', name: 'You', color: paint.color, isPlayer: true, visual: player };
    this.scene.add(player.root);
    this.racers = [this.player];
    this.pool = new Map(); // rival id -> racer, built on demand per stage
    await this.setStage(stage, { compile: false });

    this.shadowState = renderer.shadowMap.enabled;
    window.addEventListener('resize', this.resize);
    this.resize();
    // Place cars so the compile pass sees a representative frame.
    this.reset({ stats: null });
    this.chase.snap(this.player.vehicle);
    await renderer.compileAsync(this.scene, this.camera);
    this.ready = true;
  }

  // Puts a career stage on the track: its course, its game mode and its rivals. Rivals the
  // stage does not use are thrown away; new ones are baked from the shared coupe.
  async setStage(stage, { compile = true } = {}) {
    this.stage = stage;
    const seg = TRACK_SEGMENTS[stage.trackSegment];
    this.useRoute(Boolean(seg?.reverse), Boolean(seg?.forced));
    this.course = courseFor(stage, this.track.length);
    this.applyWeather(WEATHER[stage.weatherPreset] ?? WEATHER.Midday);
    this.mode = createMode(stage, this);
    const rivals = this.mode.rivals;
    const keep = new Set(rivals.map((r) => r.id));
    for (const [id, r] of this.pool) {
      if (keep.has(id)) continue;
      this.rivalFactory.release(r.visual);
      this.scene.remove(r.visual.root);
      r.visual.root.traverse((o) => o.isMesh && o.geometry.dispose());
      this.pool.delete(id);
    }
    for (const r of rivals) {
      if (this.pool.has(r.id)) continue;
      const racer = { ...r, isPlayer: false, visual: this.rivalFactory.build({ color: r.color, finish: r.finish }) };
      this.scene.add(racer.visual.root);
      this.pool.set(r.id, racer);
    }
    this.racers = [this.player, ...rivals.map((r) => this.pool.get(r.id))];
    this.mode.layout();
    // Compile whatever this stage shows for the first time (new rivals, the reversed road,
    // rain, puddles, barriers); programs already built are skipped quickly.
    if (compile) {
      this.reset({ stats: null });
      await this.renderer.compileAsync(this.scene, this.camera);
    }
  }

  // Switches between the forward and the reversed road, and opens or closes the highway along
  // the redwood trails.
  useRoute(reverse, forced) {
    const key = reverse ? 'reverse' : 'forward';
    if (reverse && !this.tracks.reverse) {
      const def = reverseTrackDef(this.def, this.tracks.forward.length);
      const t = new Track(def);
      t.setPuddles(reversePuddles(this.puddleList, t.length));
      this.tracks.reverse = t;
      this.directional.reverse = buildDirectional(t);
      this.scene.add(this.directional.reverse);
      this.propSets.reverse = new SmashProps(t, def, this.scene);
    }
    this.track = this.tracks[key];
    this.track.forced = forced;
    for (const k of ['forward', 'reverse']) {
      if (this.directional[k]) this.directional[k].visible = k === key;
      this.propSets[k]?.setVisible(k === key);
    }
    this.props = this.propSets[key];
    this.modeProps.track = this.track;
    for (const r of this.pool?.values() ?? []) if (r.vehicle) r.vehicle.track = this.track;
    if (this.player?.vehicle) this.player.vehicle.track = this.track;
    if (this.trailBarriers) this.trailBarriers.visible = forced;
  }

  // Sky, light, fog, sea, wet road, puddles, rain, lightning and bloom for a weather preset.
  applyWeather(w) {
    if (this.weather === w) return;
    this.weather = w;
    this.scenery.applyWeather(w);
    this.wet.value = w.wet;
    // Standing water only once the road is properly wet.
    const puddles = w.wet >= 0.5;
    this.puddles.visible = puddles;
    const fwd = this.tracks.forward;
    fwd.setPuddles(puddles ? this.puddleList : []);
    this.tracks.reverse?.setPuddles(puddles ? reversePuddles(this.puddleList, this.tracks.reverse.length) : []);
    for (const t of Object.values(this.tracks)) if (t) t.wet = w.wet;
    this.rain.set(w.rain);
    this.lightning.enabled = w.lightning;
    this.lightning.reset();
    this.scenery.setFlash(0);
    this.bloom.setParams(w.bloom);
    // Cars, glass and puddles reflect the coast under this sky: bake it into the environment
    // cubemap from just above the start line (proxies only, so no car reflects itself).
    const f = fwd.frame(0, {});
    this.scenery.bakeEnvironment(new THREE.Vector3(f.x, fwd.roadY(0) + 6, f.z));
  }

  // Swaps the player's car between races (garage selection changed). Physics is untouched:
  // the Vehicle keeps simulating and the new visual just follows it.
  async setPlayerCar(car, paint, look = {}) {
    this.playerFeel = car.feel;
    if (lookKey(car, look) === this.playerCarKey) return;
    const old = this.player.visual;
    const oldFactory = this.factory;
    this.factory = new CarFactory(await loadCar(car, { paintColor: paint.color, finish: paint.finish, detail: RACE_DETAIL, ...look }));
    this.playerCarKey = lookKey(car, look);
    this.player.visual = this.factory.build({ player: true });
    this.scene.remove(old.root, ...oldFactory.sharedMeshes);
    this.scene.add(this.player.visual.root, ...this.factory.sharedMeshes);
    old.root.traverse((o) => o.isMesh && o.geometry.dispose());
    oldFactory.sharedMeshes.forEach((m) => m.geometry.dispose());
    if (this.player.vehicle) this.player.visual.update(this.player.vehicle, 0, 0);
    this.factory.syncWheels();
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
    this.waterfall?.userData.setViewport(ph, this.camera.fov);
    this.bloom?.resize();
  }

  // stats: player's effective stats (0..100) from the garage upgrades.
  reset({ stats }) {
    const track = this.track;
    const course = this.course;
    const mode = this.mode;
    const rand = mulberry32(Math.floor(Math.random() * 1e9));
    const base = stats ?? BASE;
    // Rivals scale a little with the player's upgrades so races stay close, and with how hard
    // the stage's rival set pushes.
    const upgradeBoost = stats ? Math.max(0, (stats.speed + stats.accel + stats.handling + stats.nitro - 200) / 4) * 0.45 : 0;
    const boost = upgradeBoost + mode.difficulty * 4;
    const rivals = this.racers.filter((r) => !r.isPlayer);
    const order = rivals.map((_, i) => i); // rival grid order (shuffled)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const duel = mode.id === 'BossDuel';
    this.racers.forEach((r) => {
      const slot = mode.gridSlot(r, r.isPlayer ? -1 : order[rivals.indexOf(r)]);
      const back = 14 + Math.max(0, Math.floor(slot / 2)) * 11;
      const s = track.wrapS(course.startS - back);
      const d = slot < 0 ? 0 : slot % 2 ? 4.2 : -4.2;
      let params;
      if (r.isPlayer) params = statsToParams(base, this.playerFeel);
      else {
        params = statsToParams({
          speed: BASE.speed + r.stats.speed + boost,
          nitro: BASE.nitro + r.stats.nitro + boost,
          handling: BASE.handling + r.stats.handling + boost,
          accel: BASE.accel + r.stats.accel + boost,
        });
      }
      if (!r.vehicle) r.vehicle = new Vehicle(track, params, { passiveNitro: r.isPlayer ? 0.6 : 3.2, skills: r.isPlayer });
      r.vehicle.params = params;
      r.vehicle.reset(s, d);
      r.vehicle.proximity = false;
      if (!r.isPlayer) r.ai = new AIDriver(r.vehicle, track, { aggression: r.aggression, skill: Math.min(1, r.skill + mode.difficulty * 0.01), laneBias: r.laneBias, rand, duel });
      else r.ai = null;
      r.dist = -back; // metres along the course from the start line
      r.lastS = r.vehicle.proj.s;
      r.lapsDone = -1;
      r.progress = r.dist;
      r.finished = false;
      r.out = false;
      r.place = 0;
      r.finishTime = 0;
      r.lapStart = 0;
      r.lapTimes = [];
      r.draft = 0;
      r.visual.root.scale.setScalar(1);
      r.visual.update(r.vehicle, 0, 0);
      r.skidTrails = [null, null];
    });
    this.syncWheels();
    this.props.reset();
    this.seabirds.reset();
    this.lightning.reset();
    this.scenery.setFlash(0);
    this.skids.clear();
    this.smoke.clear();
    this.sparks.clear();
    this.time = 0;
    this.raceTime = 0;
    this.stateTime = 0;
    this.phase = 'intro';
    this.driftTotal = 0;
    this.chain ??= new DriftChain();
    this.chain.reset();
    this.bestCombo = 1;
    this.perfects = 0;
    this.smashes = 0;
    this.bigAirs = 0;
    this.airTotal = 0;
    this.pulses = 0;
    this.topSpeed = 0;
    this.result = null;
    this.lastCountdown = null;
    this.hits = [];
    this.positions = [...this.racers];
    mode.start();
  }

  // earnedStars: the stage's stars already held, for the intro card's objective list.
  // `startNitro`: the briefing's rewarded "Fill Nitrous Tank" perk (100% nitro on the grid).
  // `fx`: the player's tyre smoke and nitro trail colours ({ smoke, nitro } FX_COLORS entries).
  begin({ stats, paint, fx = null, input, hud, onFinish, autoQuality = false, earnedStars = 0, startNitro = false, bloom = 'low' }) {
    this.autoQuality = autoQuality;
    this.bloom.setLevel(bloom);
    FLAME.hdr = this.bloom.enabled ? 2.6 : 1;
    // Each weather preset has its own exposure on top of the renderer's (restored on exit).
    this.baseExposure ??= this.renderer.toneMappingExposure;
    this.renderer.toneMappingExposure = this.baseExposure * this.weather.exposure;
    this.input = input;
    this.hud = hud;
    this.onFinish = onFinish;
    this.factory.setPlayerPaint(paint.color, paint.finish);
    this.player.color = paint.color;
    this.playerSmoke = fx?.smoke ? new THREE.Color(fx.smoke.color) : SMOKE;
    this.player.visual.setNitroFx(fx?.nitro ?? null);
    if (this.shadowState !== this.renderer.shadowMap.enabled) {
      this.shadowState = this.renderer.shadowMap.enabled;
      this.scene.traverse((o) => o.material && [].concat(o.material).forEach((m) => (m.needsUpdate = true)));
    }
    this.scenery.sun.castShadow = this.renderer.shadowMap.enabled;
    this.reset({ stats });
    if (startNitro) this.player.vehicle.nitro = NITRO.max;
    input.setEnabled(false);
    this.chase.intro(this.player.vehicle, 3.2);
    this.engine?.stop();
    this.engine = createEngineSound();
    this.rainSound?.stop();
    this.rainSound = this.weather.rain > 0 ? createRainSound() : null;
    this.rainSound?.set(this.weather.rain);
    this.lens.set(this.weather.rain);
    raceMusic.start();
    this.hud.intro(this.mode.intro(), this.course, { objectives: this.stage.objectives, earned: earnedStars });
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
    this.engine?.update({ dt: 0, throttle: 0, volume: 0 });
    this.rainSound?.set(0);
    raceMusic.setPaused(true);
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.phase = this.resumePhase;
    this.rainSound?.set(this.weather.rain);
    raceMusic.setPaused(false);
    this.last = performance.now();
    this.input.setEnabled(this.phase === 'racing');
  }

  // QA (?debug): let the AI drive the player's car.
  autopilot(skill = 0.97) {
    this.player.ai = new AIDriver(this.player.vehicle, this.track, { aggression: 0.6, skill });
  }

  get isPaused() {
    return this.phase === 'paused';
  }

  exit() {
    this.stop();
    this.input?.setEnabled(false);
    this.engine?.stop();
    this.engine = null;
    this.rainSound?.stop();
    this.rainSound = null;
    this.lens.set(0);
    this.bloom.dispose();
    if (this.baseExposure != null) this.renderer.toneMappingExposure = this.baseExposure;
    this.renderer.setRenderTarget(null);
    raceMusic.stop();
  }

  frame(nowMs) {
    const dt = Math.min(0.05, (nowMs - this.last) / 1000);
    this.last = nowMs;
    this.trackPerformance(dt);
    if (this.phase !== 'paused') this.update(dt);
    this.bloom.render(this.scene, this.camera);
  }

  trackPerformance(dt) {
    this.fpsAcc += dt;
    this.fpsFrames += 1;
    if (this.fpsAcc < 1) return;
    const fps = this.fpsFrames / this.fpsAcc;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.onFps?.(fps);
    // Auto quality: if we cannot hold ~60 FPS, drop the wide bloom halo first, then the
    // render resolution, then bloom altogether.
    if (!this.autoQuality) return;
    this.slowSeconds = fps < 50 ? this.slowSeconds + 1 : 0;
    if (this.slowSeconds < 3) return;
    this.slowSeconds = 0;
    const pr = this.renderer.getPixelRatio();
    if (this.bloom.level === 'medium') this.bloom.setLevel('low');
    else if (pr > 1) {
      this.renderer.setPixelRatio(Math.max(1, pr - 0.25));
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.resize();
    } else if (this.bloom.enabled) {
      this.bloom.setLevel('off');
      FLAME.hdr = 1;
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
      this.updateProgress();
      this.onChain(this.chain.update(dt));
      if (this.phase === 'racing') this.mode.update(dt);
    }

    // Visuals.
    for (const r of this.racers) {
      if (r.out && !r.isPlayer) continue;
      if (r.isPlayer) r.visual.steerInput = r.ai ? r.ai.input.steer : r.out ? 0 : playerInput.steer;
      else r.visual.steerInput = r.ai.input.steer;
      r.visual.update(r.vehicle, dt, this.time);
      this.emitEffects(r, dt);
    }
    this.syncWheels();
    this.skids.update(dt);
    this.smoke.update(dt, -0.6);
    this.sparks.update(dt, 9);
    this.props.update(dt);
    this.modeProps.update(dt, this.time);
    this.scenery.update(this.time, this.camera);
    this.scenery.follow(player.pos);
    this.updateAtmosphere(dt, player, simulate);

    this.chase.update(dt, player, { boostTier: player.tier });
    const lineLevel = player.tier === 2 ? 1 : player.tier === 1 ? 0.5 : 0;
    this.speedLines.update(dt, simulate ? lineLevel : 0, Math.max(20, player.speed), player.tier);

    this.processEvents();
    this.updateEngine(playerInput, dt);
    this.updateHud();

    if (this.phase === 'finished' && !this.resultShown && this.stateTime > 1.6) {
      this.resultShown = true;
      this.hud.results(this.result);
    }
  }

  // Lightning and thunder, rain around the camera and on the lens, puddle ripples, the
  // waterfall, and the seabirds (which only scatter for a car that is racing).
  updateAtmosphere(dt, player, racing) {
    const { flash, thunder } = this.lightning.update(dt);
    this.scenery.setFlash(flash);
    this.bloom.flash = flash * 0.8;
    if (thunder) raceSfx.thunder(thunder);
    this.rain.update(this.time, this.camera, player, flash);
    this.lens.update(dt, player.speed);
    if (this.puddles.visible) this.puddles.userData.update(this.time, this.weather.wet);
    this.waterfall?.userData.update(this.time);
    this.seabirds.update(dt, this.time, racing ? player : null, player.speed);
  }

  syncWheels() {
    this.factory.syncWheels();
    this.rivalFactory.syncWheels();
  }

  toPhase(p) {
    this.phase = p;
    this.stateTime = 0;
  }

  simStep(h, playerInput, first) {
    const active = this.active;
    const ctx = {
      time: this.time,
      cars: active,
      props: this.props,
      racing: true,
      playerGap: 0,
      rival: this.player.out ? null : this.player.vehicle,
    };
    const playerProgress = this.player.progress;
    for (const r of active) {
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
          input.throttle = playerInput.throttle;
          input.brake = playerInput.brake;
        }
      }
      r.vehicle.step(h, input, r.ai ? this.time : now());
    }
    // A knocked-out player coasts to a stop under the camera.
    if (this.player.out) this.player.vehicle.step(h, COAST_INPUT, this.time);
    this.applyDraft(active, h);
    // Car-to-car contact.
    const n = active.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) this.collideCars(active[i].vehicle, active[j].vehicle);
    // Props scatter without slowing anyone down; the player earns a little nitro for each.
    for (const r of active) {
      const hits = this.props.collide(r.vehicle, this.hits);
      for (const p of hits) {
        const big = p.type !== 'cone';
        if (p.type === 'neon' && p.first) this.sparkBurst(p.pos, p.glow);
        if (r.isPlayer) {
          if (p.type === 'stall' || p.type === 'neon') raceSfx.shatter(p.type);
          else raceSfx.smash(big);
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

  // Cars still in the race (Elimination knocks them out one by one).
  get active() {
    return this.racers.filter((r) => !r.out);
  }

  // Slipstream: a car tucked in behind another gets extra pull along its heading.
  applyDraft(active, h) {
    const strength = this.mode.draft;
    for (const r of active) {
      r.draft = 0;
      if (!strength || r.vehicle.airborne) continue;
      const v = r.vehicle;
      let best = 0;
      for (const o of active) {
        if (o === r) continue;
        const ahead = this.track.delta(v.proj.s, o.vehicle.proj.s);
        best = Math.max(best, draftFactor(ahead, o.vehicle.proj.d - v.proj.d, v.speed));
      }
      if (!best) continue;
      r.draft = best;
      const a = DRAFT.accel * strength * best * h;
      v.vel.x += Math.cos(v.heading) * a;
      v.vel.y -= Math.sin(v.heading) * a;
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

  // Distance along the course for every car, laps, the finish line and the running order.
  updateProgress() {
    const L = this.track.length;
    const course = this.course;
    for (const r of this.racers) {
      const s = r.vehicle.proj.s;
      if (r.out) {
        r.lastS = s;
        continue;
      }
      let ds = s - r.lastS;
      if (ds < -L / 2) ds += L;
      else if (ds > L / 2) ds -= L;
      r.lastS = s;
      r.dist += ds;
      if (!r.finished) {
        const lap = Math.floor(r.dist / L);
        if (lap > r.lapsDone) {
          if (lap >= 1 && course.layout === 'circuit') r.lapTimes.push(this.raceTime - r.lapStart);
          r.lapsDone = lap;
          r.lapStart = this.raceTime;
          if (r.isPlayer && course.layout === 'circuit' && !course.endless && lap === course.laps - 1 && course.laps > 1) {
            raceSfx.lap();
            this.hud.callout('FINAL LAP', 'lap');
          }
        }
        if (r.dist >= course.distance) this.finishRacer(r);
      }
      r.progress = r.finished ? course.distance + 1e6 - r.finishTime : r.dist;
    }
    if (this.phase === 'racing') this.topSpeed = Math.max(this.topSpeed, Math.abs(this.player.vehicle.forward) * 3.6);
    // Running order: cars still racing by distance, then the knocked-out ones by where they went out.
    this.positions = [...this.racers].sort((a, b) => (a.out !== b.out ? (a.out ? 1 : -1) : a.out ? a.place - b.place : b.progress - a.progress));
  }

  finishRacer(r) {
    r.finished = true;
    r.finishTime = this.raceTime;
    r.place = this.racers.filter((x) => x.finished).length;
    if (r.lapTimes.length === 0 || this.course.layout !== 'circuit') r.lapTimes.push(this.raceTime - r.lapStart);
    if (r.isPlayer) this.endRun({ finished: true, reason: 'finish', position: r.place });
  }

  // Knocks a car out of the race (Elimination): a fireball, then it is gone.
  eliminate(r) {
    if (r.out) return;
    const alive = this.active.length;
    r.out = true;
    r.place = alive;
    const v = r.vehicle;
    this.explode(v.pos, r.isPlayer);
    raceSfx.eliminated(r.isPlayer);
    const near = v.pos.distanceTo(this.player.vehicle.pos);
    this.chase.bump(Math.max(0.1, 0.8 - near / 120));
    this.hud.flash('elim');
    if (r.isPlayer) {
      this.endRun({ finished: true, reason: 'eliminated', position: alive });
      return;
    }
    r.visual.root.scale.setScalar(1e-4);
    this.hud.callout(`${r.name.toUpperCase()} ELIMINATED`, 'elim');
    if (alive - 1 === 1 && !this.player.out && this.phase === 'racing') this.endRun({ finished: true, reason: 'champion', position: 1 });
  }

  explode(pos, big) {
    for (let k = 0; k < (big ? 70 : 50); k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 12;
      this.sparks.emit(pos.x, pos.y + 0.8, pos.z, Math.cos(a) * sp, 3 + Math.random() * 10, Math.sin(a) * sp, {
        color: Math.random() < 0.5 ? FIRE : EMBER,
        size: 0.35 + Math.random() * 0.3,
        life: 0.5 + Math.random() * 0.6,
        grow: -0.2,
        alpha: 1,
      });
    }
    for (let k = 0; k < 26; k++) {
      this.smoke.emit(pos.x + (Math.random() - 0.5) * 2, pos.y + 0.6, pos.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4, {
        color: k < 8 ? FIRE : SOOT,
        size: 1.4,
        life: 1.2 + Math.random() * 0.8,
        grow: 3.2,
        alpha: k < 8 ? 0.7 : 0.5,
      });
    }
  }

  // Sparks for mode pickups (Time Trial pylons).
  burst(pos, color, n = 20) {
    for (let k = 0; k < n; k++) {
      this.sparks.emit(pos.x, pos.y + 1 + Math.random(), pos.z, (Math.random() - 0.5) * 8, 2 + Math.random() * 5, (Math.random() - 0.5) * 8, {
        color,
        size: 0.22,
        life: 0.4 + Math.random() * 0.35,
        grow: -0.3,
        alpha: 1,
      });
    }
  }

  // The player's run is over: they crossed the line, ran out of time, or were knocked out.
  endRun({ finished = true, reason = 'finish', position = null }) {
    if (this.result) return;
    const r = this.player;
    if (!r.finished) {
      r.finished = finished;
      r.finishTime = this.raceTime;
    }
    r.done = true;
    // Autopilot takes over while the camera orbits (a knocked-out car just coasts).
    if (!r.out) r.ai = new AIDriver(r.vehicle, this.track, { aggression: 0.2, skill: 0.8 });
    // Bank a drift or chain still running as the run ends.
    if (r.vehicle.drifting) r.vehicle.endDrift();
    this.processEvents();
    this.onChain(this.chain.finish());
    this.input.setEnabled(false);
    this.toPhase('finished');
    this.resultShown = false;
    this.chase.orbit(r.vehicle);
    if (reason === 'finish' || reason === 'champion') raceSfx.finish();
    else if (reason === 'timeout') raceSfx.empty();
    const place = position ?? this.positions.indexOf(r) + 1;
    const laps = r.lapTimes.filter((t) => t > 0);
    // Raw run metrics; coins and stars are worked out by the career (core/career.js) when
    // main.js banks the result.
    this.result = {
      stageId: this.stage.stageId,
      mode: this.mode.id,
      reason,
      trackId: this.def.id,
      trackName: this.course.name,
      finished,
      position: place,
      total: this.racers.length,
      time: Math.round(this.raceTime * 1000) / 1000,
      bestLap: laps.length ? Math.min(...laps) : null,
      driftScore: Math.round(this.driftTotal),
      driftDistance: Math.round(r.vehicle.driftDistance),
      airTime: Math.round(this.airTotal * 10) / 10,
      pulses: this.pulses,
      smashes: this.smashes,
      perfectExits: this.perfects,
      bestCombo: this.bestCombo,
      topSpeed: Math.round(this.topSpeed),
    };
    this.mode.finalize(this.result);
    this.result.view = this.mode.view(this.result);
    this.hud.callout(this.mode.finishCallout(this.result), reason === 'finish' || reason === 'champion' ? 'finish' : 'over');
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
          this.pulses += 1;
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
          raceSfx.chirp();
          this.hud.flash('drift');
          this.onChain(this.chain.start());
          break;
        case 'driftEnd':
          this.onChain(this.chain.end(e.value));
          break;
        case 'perfectExit':
          this.perfects += 1;
          raceSfx.perfect();
          this.chase.bump(0.3);
          this.hud.callout('PERFECT!', 'perfect');
          this.hud.flash('perfect');
          this.perfectBurst(v);
          break;
        case 'wall':
          if (e.value > 3) {
            raceSfx.wall(e.value);
            this.chase.bump(Math.min(0.6, e.value * 0.03));
          }
          // A hard hit ends the drift chain early: what is banked pays out, no more links.
          if (e.value > 9) this.onChain(this.chain.finish());
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
          this.airTotal += e.value;
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

  // Drift chain events (core/driftChain.js) -> nitro, score, HUD and sound.
  onChain(e) {
    if (!e) return;
    const v = this.player.vehicle;
    if (e.type === 'level') {
      v.addNitro(e.nitro);
      this.bestCombo = Math.max(this.bestCombo, e.multiplier);
      raceSfx.combo(e.level);
      this.hud.comboUp(e.multiplier, e.nitro);
    } else if (e.type === 'bank') {
      raceSfx.driftBank();
    } else if (e.type === 'chain') {
      this.driftTotal += e.total;
      this.hud.driftBank(e.total, e.links > 1 ? e.multiplier : 0);
    }
  }

  perfectBurst(v) {
    const fx = Math.cos(v.heading);
    const fz = -Math.sin(v.heading);
    for (let k = 0; k < 26; k++) {
      const side = (Math.random() - 0.5) * 2;
      this.sparks.emit(v.pos.x - fx * 2.2 - fz * side, v.pos.y + 0.4, v.pos.z - fz * 2.2 + fx * side, v.vel.x * 0.5 - fx * 6 + (Math.random() - 0.5) * 8, 1 + Math.random() * 3, v.vel.y * 0.5 - fz * 6 + (Math.random() - 0.5) * 8, {
        color: Math.random() < 0.6 ? PERFECT_SPARK : SPARK,
        size: 0.24,
        life: 0.45 + Math.random() * 0.3,
        grow: -0.3,
        alpha: 1,
      });
    }
  }

  // Neon tube glass: a shower of coloured sparks.
  sparkBurst(pos, color) {
    for (let k = 0; k < 30; k++) {
      this.sparks.emit(pos.x, pos.y + 2 + Math.random() * 1.2, pos.z, (Math.random() - 0.5) * 9, 1 + Math.random() * 5, (Math.random() - 0.5) * 9, {
        color: Math.random() < 0.7 ? color : SPARK,
        size: 0.2,
        life: 0.4 + Math.random() * 0.4,
        grow: -0.3,
        alpha: 1,
      });
    }
  }

  emitEffects(r, dt) {
    const v = r.vehicle;
    const near = v.pos.distanceToSquared(this.player.vehicle.pos) < 120 * 120;
    if (!near || v.airborne) {
      r.skidTrails = [null, null];
      return;
    }
    const fx = Math.cos(v.heading);
    const fz = -Math.sin(v.heading);
    const slip = Math.abs(v.slip);
    const smoking = (v.drifting && slip > 0.15) || (v.braking && v.speed > 15);
    // Rubber on the road from both rear tyres while sliding or braking hard on the asphalt.
    const onRoad = v.mix.asphalt > 0.5;
    const marking = onRoad && ((v.drifting && slip > 0.08) || (v.braking && v.speed > 10));
    const strength = v.drifting ? Math.min(1, 0.45 + slip * 1.2) : 0.5;
    for (let k = 0; k < 2; k++) {
      if (!marking) {
        r.skidTrails[k] = null;
        continue;
      }
      const side = k ? 1 : -1;
      const x = v.pos.x - fx * 1.3 + -fz * side * 0.82;
      const z = v.pos.z - fz * 1.3 + fx * side * 0.82;
      r.skidTrails[k] = this.skids.add(r.skidTrails[k], x, v.pos.y + 0.02, z, -fz, fx, strength);
    }
    if (smoking) {
      const rate = v.drifting ? 34 : 14;
      r.smokeAcc = (r.smokeAcc ?? 0) + rate * dt;
      while (r.smokeAcc >= 1) {
        r.smokeAcc -= 1;
        for (const side of [-1, 1]) {
          const x = v.pos.x - fx * 1.3 + -fz * side * 0.86;
          const z = v.pos.z - fz * 1.3 + fx * side * 0.86;
          this.smoke.emit(x, v.pos.y + 0.25, z, v.vel.x * 0.15 + (Math.random() - 0.5) * 2, 0.8 + Math.random(), v.vel.y * 0.15 + (Math.random() - 0.5) * 2, {
            color: r.isPlayer ? this.playerSmoke ?? SMOKE : SMOKE,
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
    // Red dirt kicked up off the redwood trails (mud, in the rain, stays low and heavy).
    const dirt = v.mix.dirt ?? 0;
    if (dirt > 0.2 && v.speed > 6 && Math.random() < Math.min(1, dirt * (v.drifting ? 2.2 : 1.3))) {
      const mud = this.track.wet > 0.5;
      for (const side of [-1, 1]) {
        const x = v.pos.x - fx * 1.4 + -fz * side * 0.8;
        const z = v.pos.z - fz * 1.4 + fx * side * 0.8;
        this.smoke.emit(x, v.pos.y + 0.2, z, v.vel.x * 0.15 + (Math.random() - 0.5) * 2, mud ? 0.4 : 1 + Math.random(), v.vel.y * 0.15 + (Math.random() - 0.5) * 2, {
          color: RED_DIRT,
          size: mud ? 0.5 : 0.85,
          life: mud ? 0.5 : 1.1,
          grow: mud ? 0.6 : 2.6,
          alpha: mud ? 0.55 : v.drifting ? 0.5 : 0.36,
        });
      }
    }
    // Spray off a wet road: a fine mist behind the rear tyres, a burst through a puddle.
    const wet = this.track.wet;
    if (wet > 0.3 && v.speed > 14 && v.mix.asphalt > 0.4 && Math.random() < wet * (v.puddle ? 1 : 0.55)) {
      const k = v.puddle ? 1.6 : 1;
      for (const side of [-1, 1]) {
        const x = v.pos.x - fx * 1.6 + -fz * side * 0.85;
        const z = v.pos.z - fz * 1.6 + fx * side * 0.85;
        this.smoke.emit(x, v.pos.y + 0.2, z, v.vel.x * 0.6 + -fz * side * 1.5 * k, 0.6 * k + Math.random() * 0.6, v.vel.y * 0.6 + fx * side * 1.5 * k, {
          color: SPRAY,
          size: 0.4 * k,
          life: 0.4,
          grow: 1.4,
          alpha: (v.puddle ? 0.28 : 0.12) * wet,
        });
      }
    }
    // Loose surfaces: a gravel dust plume, or torn-up turf off the grass.
    const loose = v.mix.gravel + v.mix.grass;
    if (loose > 0.1 && v.speed > 8 && Math.random() < Math.min(1, loose * (v.drifting ? 1.6 : 0.9))) {
      const grass = v.mix.grass > v.mix.gravel;
      const x = v.pos.x - fx * 1.4;
      const z = v.pos.z - fz * 1.4;
      if (grass) this.smoke.emit(x, v.pos.y + 0.2, z, v.vel.x * 0.2, 1.2, v.vel.y * 0.2, { color: GRASS_BITS, size: 0.45, life: 0.6, grow: 0.6, alpha: 0.5 });
      else this.smoke.emit(x, v.pos.y + 0.2, z, v.vel.x * 0.1, 0.6, v.vel.y * 0.1, { color: DUST, size: 0.9, life: 1.0, grow: 2.4, alpha: v.drifting ? 0.4 : 0.28 });
    }
  }

  updateEngine(input, dt) {
    if (!this.engine) return;
    const v = this.player.vehicle;
    const grid = this.phase === 'intro' || this.phase === 'countdown';
    let throttle;
    if (grid) {
      // Blipping the throttle on the grid during the countdown.
      throttle = this.phase === 'countdown' && Math.sin(this.time * 7.3) > 0.4 ? 0.62 : this.phase === 'countdown' ? 0.16 : 0;
    } else {
      const drv = this.player.ai ? this.player.ai.input : input;
      throttle = drv.brake && !v.drifting ? 0 : drv.throttle ?? 1;
    }
    this.engine.update({
      dt,
      speedNorm: Math.max(0, v.forward) / v.params.topSpeed,
      throttle,
      neutral: grid,
      airborne: v.airborne,
      speed: Math.min(1, v.speed / 70),
      boost: v.tier,
      // Tyres squeal on the asphalt only; off it they crunch and swish instead.
      skid: (v.drifting ? Math.min(1, Math.abs(v.slip) * 2) : v.braking && v.speed > 12 ? 0.5 : 0) * v.mix.asphalt,
      slip: v.slip ?? 0,
      gravel: v.airborne ? 0 : v.mix.gravel,
      grass: v.airborne ? 0 : v.mix.grass,
      // Hollow tyre roll over the bridge planks.
      wood: !v.airborne && v.onWood ? 1 : 0,
      mps: v.speed,
    });
  }

  updateHud() {
    const v = this.player.vehicle;
    const p = this.player;
    const L = this.track.length;
    const course = this.course;
    let lapText;
    if (course.endless) lapText = `LAP ${Math.max(1, p.lapsDone + 1)}`;
    else if (course.layout === 'circuit') lapText = `LAP ${Math.min(course.laps, Math.max(1, p.lapsDone + 1))}/${course.laps}`;
    else lapText = `SPRINT ${Math.round(raceFraction(p.dist, course, L) * 100)}%`;
    this.hud.update({
      phase: this.phase,
      speed: Math.round(Math.abs(v.forward) * 3.6),
      position: this.positions.indexOf(p) + 1,
      total: this.racers.length,
      solo: course.solo,
      lapText,
      time: p.finished || p.done ? p.finishTime : this.raceTime,
      nitro: v.nitro / NITRO.max,
      tier: v.tier,
      sinceTap: v.canPulse ? now() - v.lastTap : -1,
      drifting: v.drifting,
      driftScore: Math.round(v.driftScore * this.chain.multiplier),
      combo: this.chain.multiplier,
      chainTotal: this.chain.total,
      linkLeft: this.chain.linkLeft,
      apexReady: v.apexReady,
      surface: v.surface,
      wrongWay: v.wrongWay > 1.2,
      draft: this.phase === 'racing' && p.draft > 0.2,
      panel: this.mode.panel(),
      racers: this.racers.map((r) => ({
        frac: r.finished ? 1 : raceFraction(r.dist, course, L),
        color: r.color,
        isPlayer: r.isPlayer,
        out: r.out,
      })),
    });
  }
}

export function ordinal(n) {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
