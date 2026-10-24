// Game-facing audio API. The sound lives in src/audio/ (mixer, engine, sfx, music, samples);
// this module owns the single AudioContext, applies the Sound / Music settings and keeps the
// call sites simple. A race plays through the car mixer (audio/carMixer.js), one
// AudioWorkletProcessor that runs the engine, tyres, surfaces, rain, race one-shots and the
// soundtrack on the audio thread, fed one message per frame; where AudioWorklet is missing
// (or until the mixer has its samples) the same sounds play through the Web Audio graph. The
// car plays recorded samples bundled with the app (public/assets/audio); the HUD, cues and
// soundtrack are synthesized (the race soundtrack ships pre-rendered from that synth for the
// mixer). Nothing is fetched from the network.
import { state } from './store.js';
import { createMixer, MUSIC_LEVEL, MUSIC_TONE } from '../audio/mixer.js';
import { ui, race, nitroIgnite, rainBed } from '../audio/sfx.js';
import { EngineVoice, EngineDriver, playEngineEvents, revEngine } from '../audio/engine.js';
import { Music } from '../audio/music.js';
import { AudioClock } from '../audio/clock.js';
import { VoicePool, PRIORITY } from '../audio/voices.js';
import { CarMixer } from '../audio/carMixer.js';
import { isNative } from './platform.js';

// Android's audio thread has to finish each hardware buffer before the speaker needs it.
// 'interactive' asks for the smallest buffer, which underruns (crackles, "chugs") as soon as
// the GPU or the render loop takes the CPU for a moment. The Android build asks for the
// largest ('playback'): the added latency hides behind the engine's own response, and nothing
// in the game is timed by ear. Android in a browser gets 'balanced'; desktop stays tight.
const ANDROID = /Android/i.test(navigator.userAgent);
const LATENCY = isNative ? 'playback' : ANDROID ? 'balanced' : 'interactive';
// The context runs at the device's own hardware rate (48 kHz on almost every phone, 44.1 kHz
// on some), which is what an AudioContext gets when no sampleRate is asked for. Any other rate
// makes Chrome resample the whole mix on the way to the speaker; the 32 kHz the Android build
// used to ask for also capped the mix at 16 kHz and folded the top of pitched-up loops back
// down as grit. The recorded samples are decoded straight to this rate. The sampled engine
// graph does less work per sample than the old synthesized one did at 32 kHz, so the native
// rate costs no headroom: tools/audio/render.mjs --stall measures both.
// How far ahead of the playhead the engine's automation is queued (see audio/clock.js): any
// frame hitch shorter than this goes unheard. It is also the engine's control latency.
const ENGINE_LOOKAHEAD = isNative || ANDROID ? 0.07 : 0.045;

let mix = null;
let car = null;
let clock = null;
let pool = null;
let music = null;
let musicWanted = false;

function createContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  // Older WebViews reject options they do not support: drop them one at a time.
  for (const opts of [{ latencyHint: LATENCY }, {}]) {
    try {
      return new AC(opts);
    } catch {
      // try the next
    }
  }
  return null;
}

function ensure() {
  if (!state.settings.sound && !state.settings.music) return null;
  if (!mix) {
    const ac = createContext();
    if (!ac) return null;
    mix = createMixer(ac);
    clock = new AudioClock(ac);
    pool = new VoicePool(mix);
    if (CarMixer.supported(ac)) car = new CarMixer(mix);
    applyAudioSettings();
  }
  if (mix.ac.state === 'suspended') mix.ac.resume();
  return mix;
}

// Runs fn(voiceMix, …args) as one pooled one-shot voice, only when sound effects are on.
const fx = (priority, fn) => (...args) => {
  if (!state.settings.sound) return;
  const m = ensure();
  if (m) pool.play(priority, (vm) => fn(vm, ...args));
};

// The car mixer, once it holds its samples (graph path until then, or for good without it).
const onCar = () => (car?.live ? car : null);

// A race one-shot: on the car mixer as baked shot `name` at gain(…args) and rate(…args),
// otherwise the graph version. Spacing (below) applies to both.
const rfx = (priority, name, fn, { gain, rate, gap, variant } = {}) => {
  const graph = fx(priority, gap ? spaced(name, gap, fn) : fn);
  return (...args) => {
    if (!state.settings.sound) return;
    const c = ensure() && onCar();
    if (!c) return graph(...args);
    if (gap) {
      const t = mix.ac.currentTime;
      if (t - (lastHit.get(name) ?? -1) < gap) return;
      lastHit.set(name, t);
    }
    c.shot(variant ? variant(...args) : name, gain ? gain(...args) : 1, rate ? rate(...args) : 1);
  };
};

// Impacts can fire on consecutive physics steps (a cone field, grinding a rail). Stacked
// copies only add level and nodes, so each one is held off briefly after it plays.
const lastHit = new Map();
const spaced = (name, gap, fn) => (m, ...args) => {
  const t = m.ac.currentTime;
  if (t - (lastHit.get(name) ?? -1) < gap) return;
  lastHit.set(name, t);
  fn(m, ...args);
};

// Applies the Sound and Music switches from Settings.
export function applyAudioSettings() {
  if (!mix) return;
  const t = mix.ac.currentTime;
  mix.sfx.gain.setTargetAtTime(state.settings.sound ? 1 : 0, t, 0.05);
  mix.music.gain.setTargetAtTime(state.settings.music ? MUSIC_LEVEL : 0, t, 0.05);
  if (musicWanted && state.settings.music && !music?.playing && !carMusic) startMusic();
  if (!state.settings.music) {
    if (music) {
      music.stop(0.2);
      clock.remove(music);
    }
    if (carMusic) {
      car.music('stop');
      carMusic = false;
    }
  }
}

const { detail, impact, cue, key } = PRIORITY;

export const sfx = {
  tap: fx(cue, (m) => ui.tap(m)),
  tab: fx(cue, (m) => ui.swipe(m)),
  buy: fx(key, (m) => ui.confirm(m)),
  deny: fx(cue, (m) => ui.deny(m)),
  // Headlight toggle: relay click, then an aggressive throttle stab with blow-off. The rev is
  // a whole engine voice of its own (one at a time), outside the one-shot pool.
  lights: fx(cue, (m) => {
    ui.relay(m);
    if (onCar()) car.rev('stab');
    else revEngine(mix, 'stab');
  }),
  // Driver door: hydraulic strut open / close.
  door: fx(cue, (m, open) => ui.door(m, open)),
  // Race Start: blip and pull.
  rev: () => {
    if (!state.settings.sound || !ensure()) return;
    if (onCar()) car.rev('double');
    else revEngine(mix, 'double');
  },
};

// Thunder by distance (0 overhead .. 1): the nearest of three baked strikes.
const thunderShot = (d) => (d < 0.35 ? 'thunderNear' : d < 0.7 ? 'thunderMid' : 'thunderFar');

export const raceSfx = {
  beep: rfx(key, 'beep', (m) => race.beep(m)),
  go: rfx(key, 'go', (m) => {
    race.go(m);
    music?.drop();
  }),
  nitro: rfx(key, 'nitro', (m) => {
    nitroIgnite(m, 1);
    duckFor(0.55, 1.2);
  }),
  pulse: rfx(key, 'pulse', (m) => {
    nitroIgnite(m, 2);
    duckFor(0.4, 1.6);
  }),
  empty: rfx(cue, 'empty', (m) => race.empty(m)),
  smash: rfx(impact, 'smash', (m, big) => race.smash(m, big), { gap: 0.06, variant: (big) => (big ? 'smashBig' : 'smash') }),
  wall: rfx(impact, 'wall', (m, k) => race.wall(m, k), { gap: 0.09, gain: (k) => Math.min(1, 0.25 + k * 0.04) }),
  bump: rfx(detail, 'bump', (m) => race.bump(m), { gap: 0.08 }),
  land: rfx(impact, 'land', (m, k) => race.land(m, k), { gap: 0.12, gain: (k) => Math.min(1, 0.3 + k * 0.04) }),
  chirp: rfx(detail, 'chirp', (m) => race.chirp(m), { rate: () => 0.95 + Math.random() * 0.1 }),
  driftBank: rfx(cue, 'driftBank', (m) => race.driftBank(m)),
  combo: rfx(cue, 'combo', (m, level) => race.combo(m, level), { variant: (level = 1) => `combo${Math.max(1, Math.min(3, level))}` }),
  perfect: rfx(key, 'perfect', (m) => {
    race.perfect(m);
    duckFor(0.5, 0.9);
  }),
  shatter: rfx(impact, 'shatter', (m, kind) => race.shatter(m, kind), { gap: 0.06, variant: (kind) => (kind === 'neon' ? 'shatterNeon' : 'shatterStall') }),
  lap: rfx(key, 'lap', (m) => race.lap(m)),
  finish: rfx(key, 'finish', (m) => race.finish(m)),
  coin: rfx(detail, 'coin', (m, i) => race.coin(m, i), { rate: (i = 0) => (1500 + i * 40) / 1500 }),
  pylon: rfx(cue, 'pylon', (m) => race.pylon(m)),
  checkpoint: rfx(cue, 'checkpoint', (m) => race.checkpoint(m)),
  tick: rfx(cue, 'tick', (m) => race.tick(m)),
  eliminated: rfx(key, 'eliminated', (m, big) => {
    race.eliminated(m, big);
    duckFor(0.45, 1.4);
  }, { variant: (big) => (big ? 'eliminatedBig' : 'eliminated') }),
  // Storm: a crack (close strikes) and a long rolling rumble; `distance` 0 (overhead)..1.
  thunder: rfx(impact, 'thunder', (m, distance) => race.thunder(m, distance), { variant: (d = 0.5) => thunderShot(d) }),
};

// ---- Weather ambience ----

// Rain on the car and the road: a soft high hiss whose level follows the rain (0..1).
export function createRainSound() {
  const m = state.settings.sound ? ensure() : null;
  if (!m) return { set() {}, stop() {} };
  const c = onCar();
  if (!c) return rainBed(m);
  let level = -1;
  return {
    set(v) {
      if (Math.abs(v - level) < 0.01) return;
      level = v;
      c.rain(v);
    },
    stop() {
      c.rain(0, true);
    },
  };
}

// ---- Music ----

let duckHold = 0;
let duckHoldLevel = 1;
function duckFor(level, seconds) {
  if (!mix) return;
  duckHoldLevel = level;
  duckHold = mix.ac.currentTime + seconds;
  duckLevel = level;
  mix.duck.gain.setTargetAtTime(level, mix.ac.currentTime, 0.04);
}

// Engine intensity 0..1 at audio time t ducks the soundtrack and closes its low-pass, so the
// car stays in front of it. Only changes of a few percent are scheduled.
let duckLevel = -1;
let toneLevel = -1;
function duckForEngine(intensity, t) {
  if (!mix) return;
  const held = t < duckHold;
  const level = held ? duckHoldLevel : 1 - 0.38 * intensity;
  if (Math.abs(level - duckLevel) > 0.01) {
    duckLevel = level;
    mix.duck.gain.setTargetAtTime(level, t, held ? 0.04 : 0.35);
  }
  const tone = MUSIC_TONE.open * Math.pow(MUSIC_TONE.engine / MUSIC_TONE.open, intensity);
  if (Math.abs(tone - toneLevel) > toneLevel * 0.03) {
    toneLevel = tone;
    mix.musicTone.frequency.setTargetAtTime(tone, t, 0.4);
  }
}

// The soundtrack plays on the car mixer when it has it (pre-rendered from audio/music.js),
// with its ducking and tone done there too.
let carMusic = false;

function startMusic() {
  const m = ensure();
  if (!m || !state.settings.music) return;
  const c = onCar();
  if (c?.musicReady) {
    c.music('start');
    carMusic = true;
    return;
  }
  // The graph soundtrack stays plugged in for the whole race: no gate rewires it mid-race.
  music ??= new Music(m, { gated: false });
  const t = m.ac.currentTime;
  m.duck.gain.setValueAtTime(1, t);
  m.musicTone.frequency.setValueAtTime(MUSIC_TONE.open, t);
  duckLevel = toneLevel = -1;
  music.start();
  clock.add(music);
}

export const raceMusic = {
  start() {
    musicWanted = true;
    startMusic();
  },
  stop() {
    musicWanted = false;
    if (carMusic) {
      car.music('stop');
      carMusic = false;
    }
    music?.stop();
    if (music) clock.remove(music);
  },
  setPaused(paused) {
    if (carMusic) car.music(paused ? 'pause' : 'resume');
    music?.setPaused(paused);
    if (paused && mix) {
      mix.duck.gain.setTargetAtTime(1, mix.ac.currentTime, 0.1);
      duckLevel = 1;
    }
  },
};

// ---- Player engine ----

// Continuous engine, turbo, airflow, wind and tyre voice for the player's car, driven by a
// six-speed virtual gearbox that runs on the audio clock (audio/engine.js EngineDriver). Its
// recorded layers come in as soon as the samples finish decoding (they start loading with the
// first sound the game makes, long before a race).
export function createEngineSound() {
  const m = state.settings.sound ? ensure() : null;
  if (!m) return { update() {}, stop() {} };
  const c = onCar();
  if (c) {
    // The gearbox, the layers, blow-off and crackle all run on the audio thread; a frame
    // hands over the car's state (and the one-shots it fired) in one message.
    c.startEngine();
    let stopped = false;
    return {
      update(controls) {
        if (!stopped && c.live) c.sendFrame(controls);
      },
      stop() {
        if (stopped) return;
        stopped = true;
        c.stopEngine(0.25);
      },
    };
  }
  // Every layer stays plugged in from the grid to the finish: the RPM loops, tyres, turbo and
  // surfaces play continuously and only their gains and rates move. Unplugging idle layers
  // saved about 3% of a desktop core (tools/audio/render.mjs --gates) but rewired the graph
  // at every gear's crossfade; the race now never connects or disconnects an engine node.
  const voice = new EngineVoice(m, { gated: false }).start();
  const driver = new EngineDriver(voice, {
    lookahead: ENGINE_LOOKAHEAD,
    // Blow-off and crackle are pooled one-shots like any other.
    onEvents: (events, t) => {
      for (const e of events) pool.play(e.type === 'pop' ? detail : impact, (vm) => playEngineEvents(vm, [e], t), t);
    },
    onStep: (t, box, c) => {
      const r = Math.max(0, Math.min(1, (box.rpm - 1500) / 6000));
      const volume = c.volume ?? 1;
      duckForEngine(volume > 0 ? Math.min(1, r * (c.throttle ?? 1) * 0.8 + (c.boost ?? 0) * 0.25) : 0, t);
    },
  });
  clock.add(driver);
  let stopped = false;
  return {
    // Called every race frame with the car's state. speedNorm forward speed / top speed;
    // throttle 0..1; neutral on the grid; speed 0..1 (wind); boost nitro tier 0..2; skid 0..1;
    // slip angle (rad); gravel / grass 0..1 share of the tyres off the asphalt; wood 0..1 on
    // the bridge deck, mps road speed (m/s); volume 0..1. dt 0 holds the gearbox (paused).
    // Frame time is not used otherwise: the gearbox steps on the audio clock.
    update(controls) {
      if (stopped) return;
      // (The race hands the same object over every frame: no copy per frame.)
      controls.hold = controls.dt === 0;
      driver.input(controls);
      clock.tick();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clock.remove(driver);
      voice.stop(m.ac.currentTime + ENGINE_LOOKAHEAD, 0.25);
    },
  };
}

// Live meters for the debug overlay and QA: one-shots sounding, pool counters, buffer sizes.
export function audioStats() {
  if (!mix) return null;
  const ac = mix.ac;
  return {
    state: ac.state,
    latencyHint: LATENCY,
    sampleRate: ac.sampleRate,
    baseLatency: ac.baseLatency ?? null,
    outputLatency: ac.outputLatency ?? null,
    voices: pool.active(),
    ...pool.stats,
    carMixer: car ? { live: car.live, music: car.musicReady, failed: car.failed, ...car.stats } : null,
  };
}

// Opens the audio context (if sound is on) and resolves once the car mixer has its samples,
// one-shots and soundtrack, or has given up (QA: a race started after it runs on the mixer).
export async function audioLoaded() {
  ensure();
  await car?.loaded;
  await car?.musicLoaded;
  return audioStats();
}

export function resumeAudio() {
  if (mix && mix.ac.state === 'suspended' && (state.settings.sound || state.settings.music)) {
    mix.ac.resume();
    clock.run();
  }
}

export function suspendAudio() {
  if (mix && mix.ac.state === 'running') {
    mix.ac.suspend();
    clock.halt();
  }
}
