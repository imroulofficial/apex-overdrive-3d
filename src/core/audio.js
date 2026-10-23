// Game-facing audio API. The synthesis lives in src/audio/ (mixer, engine, sfx, music); this
// module owns the single AudioContext, applies the Sound / Music settings and keeps the
// call sites simple. No audio files are loaded: everything is generated on the device.
import { state } from './store.js';
import { createMixer, MUSIC_LEVEL, MUSIC_TONE } from '../audio/mixer.js';
import { ui, race, nitroIgnite, rainBed } from '../audio/sfx.js';
import { EngineVoice, EngineDriver, playEngineEvents, revEngine } from '../audio/engine.js';
import { Music } from '../audio/music.js';
import { AudioClock } from '../audio/clock.js';
import { VoicePool, PRIORITY } from '../audio/voices.js';
import { isNative } from './platform.js';

// Android's audio thread has to finish each hardware buffer before the speaker needs it.
// 'interactive' asks for the smallest buffer, which underruns (crackles, "chugs") as soon as
// the GPU or the render loop takes the CPU for a moment. The Android build asks for the
// largest ('playback'): the added latency hides behind the engine's own response, and nothing
// in the game is timed by ear. Android in a browser gets 'balanced'; desktop stays tight.
const ANDROID = /Android/i.test(navigator.userAgent);
const LATENCY = isNative ? 'playback' : ANDROID ? 'balanced' : 'interactive';
// Every voice is synthesized, so the audio thread's work scales with the sample rate. On
// Android the graph runs at 32 kHz (Chrome resamples to the hardware's 48 kHz on the way
// out): about a third less work per buffer, and the 16 kHz bandwidth is still more than a
// phone speaker plays. tools/audio/render.mjs --stall measures the difference.
export const ANDROID_RATE = 32000;
const RATE = isNative || ANDROID ? ANDROID_RATE : undefined;
// How far ahead of the playhead the engine's automation is queued (see audio/clock.js): any
// frame hitch shorter than this goes unheard. It is also the engine's control latency.
const ENGINE_LOOKAHEAD = isNative || ANDROID ? 0.07 : 0.045;

let mix = null;
let clock = null;
let pool = null;
let music = null;
let musicWanted = false;

function createContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  // Older WebViews reject options they do not support: drop them one at a time.
  for (const opts of [{ latencyHint: LATENCY, sampleRate: RATE }, { latencyHint: LATENCY }, {}]) {
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
  if (musicWanted && state.settings.music && !music?.playing) startMusic();
  if (!state.settings.music && music) {
    music.stop(0.2);
    clock.remove(music);
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
    revEngine(mix, 'stab');
  }),
  // Driver door: hydraulic strut open / close.
  door: fx(cue, (m, open) => ui.door(m, open)),
  // Race Start: blip and pull.
  rev: () => {
    if (state.settings.sound && ensure()) revEngine(mix, 'double');
  },
};

export const raceSfx = {
  beep: fx(key, (m) => race.beep(m)),
  go: fx(key, (m) => {
    race.go(m);
    music?.drop();
  }),
  nitro: fx(key, (m) => {
    nitroIgnite(m, 1);
    duckFor(0.55, 1.2);
  }),
  pulse: fx(key, (m) => {
    nitroIgnite(m, 2);
    duckFor(0.4, 1.6);
  }),
  empty: fx(cue, (m) => race.empty(m)),
  smash: fx(impact, spaced('smash', 0.06, (m, big) => race.smash(m, big))),
  wall: fx(impact, spaced('wall', 0.09, (m, k) => race.wall(m, k))),
  bump: fx(detail, spaced('bump', 0.08, (m) => race.bump(m))),
  land: fx(impact, spaced('land', 0.12, (m, k) => race.land(m, k))),
  chirp: fx(detail, (m) => race.chirp(m)),
  driftBank: fx(cue, (m) => race.driftBank(m)),
  combo: fx(cue, (m, level) => race.combo(m, level)),
  perfect: fx(key, (m) => {
    race.perfect(m);
    duckFor(0.5, 0.9);
  }),
  shatter: fx(impact, spaced('shatter', 0.06, (m, kind) => race.shatter(m, kind))),
  lap: fx(key, (m) => race.lap(m)),
  finish: fx(key, (m) => race.finish(m)),
  coin: fx(detail, (m, i) => race.coin(m, i)),
  pylon: fx(cue, (m) => race.pylon(m)),
  checkpoint: fx(cue, (m) => race.checkpoint(m)),
  tick: fx(cue, (m) => race.tick(m)),
  eliminated: fx(key, (m, big) => {
    race.eliminated(m, big);
    duckFor(0.45, 1.4);
  }),
  // Storm: a crack (close strikes) and a long rolling rumble; `distance` 0 (overhead)..1.
  thunder: fx(impact, (m, distance) => race.thunder(m, distance)),
};

// ---- Weather ambience ----

// Rain on the car and the road: a soft high hiss whose level follows the rain (0..1).
export function createRainSound() {
  const m = state.settings.sound ? ensure() : null;
  if (!m) return { set() {}, stop() {} };
  return rainBed(m);
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

function startMusic() {
  const m = ensure();
  if (!m || !state.settings.music) return;
  music ??= new Music(m, { gated: true });
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
    music?.stop();
    if (music) clock.remove(music);
  },
  setPaused(paused) {
    music?.setPaused(paused);
    if (paused && mix) {
      mix.duck.gain.setTargetAtTime(1, mix.ac.currentTime, 0.1);
      duckLevel = 1;
    }
  },
};

// ---- Player engine ----

// Continuous engine, turbo, airflow, wind and tyre voice for the player's car, driven by a
// six-speed virtual gearbox that runs on the audio clock (audio/engine.js EngineDriver).
export function createEngineSound() {
  const m = state.settings.sound ? ensure() : null;
  if (!m) return { update() {}, stop() {}, gear: 0 };
  const voice = new EngineVoice(m, { gated: true }).start();
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
    get gear() {
      return driver.box.gear;
    },
    // Called every race frame with the car's state. speedNorm forward speed / top speed;
    // throttle 0..1; neutral on the grid; speed 0..1 (wind); boost nitro tier 0..2; skid 0..1;
    // slip angle (rad); gravel / grass 0..1 share of the tyres off the asphalt; wood 0..1 on
    // the bridge deck, mps road speed (m/s); volume 0..1. dt 0 holds the gearbox (paused).
    // Frame time is not used otherwise: the gearbox steps on the audio clock.
    update(controls) {
      if (stopped) return;
      driver.input({ ...controls, hold: controls.dt === 0 });
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
  };
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
