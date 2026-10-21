// Game-facing audio API. The synthesis lives in src/audio/ (mixer, engine, sfx, music); this
// module owns the single AudioContext, applies the Sound / Music settings and keeps the
// call sites simple. No audio files are loaded: everything is generated on the device.
import { state } from './store.js';
import { createMixer, MUSIC_LEVEL } from '../audio/mixer.js';
import { ui, race, nitroIgnite } from '../audio/sfx.js';
import { EngineVoice, Gearbox, playEngineEvents, revEngine } from '../audio/engine.js';
import { Music } from '../audio/music.js';

let mix = null;
let music = null;
let musicWanted = false;

function ensure() {
  if (!state.settings.sound && !state.settings.music) return null;
  if (!mix) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    mix = createMixer(new AC({ latencyHint: 'interactive' }));
    applyAudioSettings();
  }
  if (mix.ac.state === 'suspended') mix.ac.resume();
  return mix;
}

// Runs fn(mix) only when sound effects are on.
const fx = (fn) => (...args) => {
  if (!state.settings.sound) return;
  const m = ensure();
  if (m) fn(m, ...args);
};

// Applies the Sound and Music switches from Settings.
export function applyAudioSettings() {
  if (!mix) return;
  const t = mix.ac.currentTime;
  mix.sfx.gain.setTargetAtTime(state.settings.sound ? 1 : 0, t, 0.05);
  mix.music.gain.setTargetAtTime(state.settings.music ? MUSIC_LEVEL : 0, t, 0.05);
  if (musicWanted && state.settings.music && !music?.playing) startMusic();
  if (!state.settings.music) music?.stop(0.2);
}

export const sfx = {
  tap: fx((m) => ui.tap(m)),
  tab: fx((m) => ui.swipe(m)),
  buy: fx((m) => ui.confirm(m)),
  deny: fx((m) => ui.deny(m)),
  // Headlight toggle: relay click, then an aggressive throttle stab with blow-off.
  lights: fx((m) => {
    ui.relay(m);
    revEngine(m, 'stab');
  }),
  // Race Start: blip and pull.
  rev: fx((m) => revEngine(m, 'double')),
};

export const raceSfx = {
  beep: fx((m) => race.beep(m)),
  go: fx((m) => {
    race.go(m);
    music?.drop();
  }),
  nitro: fx((m) => {
    nitroIgnite(m, 1);
    duckFor(0.55, 1.2);
  }),
  pulse: fx((m) => {
    nitroIgnite(m, 2);
    duckFor(0.4, 1.6);
  }),
  empty: fx((m) => race.empty(m)),
  smash: fx((m, big) => race.smash(m, big)),
  wall: fx((m, k) => race.wall(m, k)),
  bump: fx((m) => race.bump(m)),
  land: fx((m, k) => race.land(m, k)),
  chirp: fx((m) => race.chirp(m)),
  driftBank: fx((m) => race.driftBank(m)),
  lap: fx((m) => race.lap(m)),
  finish: fx((m) => race.finish(m)),
  coin: fx((m, i) => race.coin(m, i)),
};

// ---- Music ----

let duckHold = 0;
let duckHoldLevel = 1;
function duckFor(level, seconds) {
  if (!mix) return;
  duckHoldLevel = level;
  duckHold = mix.ac.currentTime + seconds;
  mix.duck.gain.setTargetAtTime(level, mix.ac.currentTime, 0.04);
}

// Engine intensity 0..1 ducks the soundtrack so the car stays in front of it.
function duckForEngine(intensity) {
  if (!mix) return;
  const t = mix.ac.currentTime;
  const level = t < duckHold ? duckHoldLevel : 1 - 0.38 * intensity;
  mix.duck.gain.setTargetAtTime(level, t, t < duckHold ? 0.04 : 0.35);
}

function startMusic() {
  const m = ensure();
  if (!m || !state.settings.music) return;
  music ??= new Music(m);
  m.duck.gain.setValueAtTime(1, m.ac.currentTime);
  music.start();
}

export const raceMusic = {
  start() {
    musicWanted = true;
    startMusic();
  },
  stop() {
    musicWanted = false;
    music?.stop();
  },
  setPaused(paused) {
    music?.setPaused(paused);
    if (paused && mix) mix.duck.gain.setTargetAtTime(1, mix.ac.currentTime, 0.1);
  },
};

// ---- Player engine ----

// Continuous engine, turbo, airflow, wind and tyre voice for the player's car, driven by a
// six-speed virtual gearbox.
export function createEngineSound() {
  const m = state.settings.sound ? ensure() : null;
  if (!m) return { update() {}, stop() {}, gear: 0 };
  const voice = new EngineVoice(m).start();
  const box = new Gearbox();
  let stopped = false;
  return {
    get gear() {
      return box.gear;
    },
    // dt seconds; speedNorm forward speed / top speed; throttle 0..1; neutral on the grid;
    // speed 0..1 (wind); boost nitro tier 0..2; skid 0..1; slip angle (rad); volume 0..1.
    update({ dt = 1 / 60, speedNorm = 0, throttle = 1, neutral = false, airborne = false, speed = 0, boost = 0, skid = 0, slip = 0, volume = 1 }) {
      if (stopped) return;
      const t = m.ac.currentTime;
      const events = box.step(dt, { speedNorm, throttle, neutral, airborne });
      if (volume > 0) playEngineEvents(m, events, t);
      voice.set({ rpm: box.rpm, load: throttle, boost: box.boost, tier: boost, speed, skid, slip, cut: box.cut, volume }, t);
      const r = Math.max(0, Math.min(1, (box.rpm - 1500) / 6000));
      duckForEngine(volume > 0 ? Math.min(1, r * throttle * 0.8 + boost * 0.25) : 0);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      voice.stop(m.ac.currentTime, 0.25);
    },
  };
}

export function resumeAudio() {
  if (mix && mix.ac.state === 'suspended' && (state.settings.sound || state.settings.music)) mix.ac.resume();
}

export function suspendAudio() {
  if (mix && mix.ac.state === 'running') mix.ac.suspend();
}
