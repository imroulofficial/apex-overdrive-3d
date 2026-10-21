// Sound synthesized with WebAudio (UI blips, engine, nitro, impacts), so no audio files or
// network are needed.
import { state } from './store.js';

let ctx = null;
let master = null;

function ensure() {
  if (!state.settings.sound) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ freq, to = freq, type = 'sine', dur = 0.08, gain = 0.5, delay = 0 }) {
  const ac = ensure();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  tap: () => tone({ freq: 880, to: 660, type: 'triangle', dur: 0.06, gain: 0.25 }),
  tab: () => tone({ freq: 520, to: 780, type: 'triangle', dur: 0.09, gain: 0.25 }),
  lights: () => {
    tone({ freq: 1400, to: 1400, type: 'square', dur: 0.03, gain: 0.12 });
    tone({ freq: 1100, to: 1100, type: 'square', dur: 0.03, gain: 0.12, delay: 0.05 });
  },
  buy: () => {
    tone({ freq: 660, to: 990, type: 'triangle', dur: 0.12, gain: 0.3 });
    tone({ freq: 990, to: 1320, type: 'triangle', dur: 0.16, gain: 0.3, delay: 0.1 });
  },
  deny: () => tone({ freq: 220, to: 140, type: 'sawtooth', dur: 0.18, gain: 0.18 }),
  rev: () => {
    tone({ freq: 70, to: 210, type: 'sawtooth', dur: 0.55, gain: 0.35 });
    tone({ freq: 140, to: 420, type: 'square', dur: 0.55, gain: 0.08 });
  },
};

let noiseBuf = null;
function noiseBuffer(ac) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function noise({ dur = 0.3, gain = 0.4, freq = 1200, q = 0.8, type = 'bandpass', to = freq, delay = 0 }) {
  const ac = ensure();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

export const raceSfx = {
  beep: () => tone({ freq: 660, type: 'square', dur: 0.18, gain: 0.18 }),
  go: () => {
    tone({ freq: 1320, type: 'square', dur: 0.45, gain: 0.2 });
    tone({ freq: 990, type: 'triangle', dur: 0.45, gain: 0.2 });
  },
  nitro: () => noise({ dur: 0.7, gain: 0.5, freq: 400, to: 2400, q: 0.7 }),
  pulse: () => {
    noise({ dur: 1.0, gain: 0.7, freq: 250, to: 3200, q: 0.9 });
    tone({ freq: 220, to: 880, type: 'sawtooth', dur: 0.5, gain: 0.18 });
    tone({ freq: 1760, to: 2640, type: 'triangle', dur: 0.25, gain: 0.15, delay: 0.05 });
  },
  empty: () => tone({ freq: 300, to: 200, type: 'square', dur: 0.12, gain: 0.12 }),
  smash: (big) => {
    noise({ dur: big ? 0.35 : 0.18, gain: big ? 0.55 : 0.35, freq: big ? 500 : 1500, to: big ? 150 : 600, q: 1.2 });
    if (big) tone({ freq: 140, to: 60, type: 'triangle', dur: 0.25, gain: 0.3 });
  },
  wall: (k) => noise({ dur: 0.22, gain: Math.min(0.6, 0.15 + k * 0.03), freq: 300, to: 90, q: 1, type: 'lowpass' }),
  bump: () => tone({ freq: 110, to: 55, type: 'sine', dur: 0.18, gain: 0.45 }),
  land: (k) => {
    tone({ freq: 90, to: 40, type: 'sine', dur: 0.25, gain: Math.min(0.6, 0.2 + k * 0.03) });
    noise({ dur: 0.2, gain: 0.25, freq: 400, to: 120, type: 'lowpass' });
  },
  driftBank: () => {
    tone({ freq: 880, to: 1320, type: 'triangle', dur: 0.12, gain: 0.2 });
    tone({ freq: 1320, to: 1760, type: 'triangle', dur: 0.14, gain: 0.2, delay: 0.08 });
  },
  lap: () => {
    tone({ freq: 784, type: 'triangle', dur: 0.15, gain: 0.25 });
    tone({ freq: 1046, type: 'triangle', dur: 0.25, gain: 0.25, delay: 0.14 });
  },
  finish: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.3, gain: 0.25, delay: i * 0.12 }));
    tone({ freq: 1046, to: 1046, type: 'square', dur: 0.6, gain: 0.08, delay: 0.5 });
  },
  coin: (i = 0) => tone({ freq: 1500 + i * 40, to: 2200, type: 'triangle', dur: 0.08, gain: 0.12 }),
};

// Continuous engine + tyre-screech voice for the player's car.
export function createEngineSound() {
  const ac = ensure();
  if (!ac) return { update() {}, stop() {} };
  const out = ac.createGain();
  out.gain.value = 0;
  out.connect(master);

  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  filter.Q.value = 2;
  filter.connect(out);
  const oscA = ac.createOscillator();
  oscA.type = 'sawtooth';
  const oscB = ac.createOscillator();
  oscB.type = 'square';
  const gA = ac.createGain();
  gA.gain.value = 0.5;
  const gB = ac.createGain();
  gB.gain.value = 0.22;
  oscA.connect(gA).connect(filter);
  oscB.connect(gB).connect(filter);

  const skidSrc = ac.createBufferSource();
  skidSrc.buffer = noiseBuffer(ac);
  skidSrc.loop = true;
  const skidF = ac.createBiquadFilter();
  skidF.type = 'bandpass';
  skidF.frequency.value = 2400;
  skidF.Q.value = 4;
  const skidG = ac.createGain();
  skidG.gain.value = 0;
  skidSrc.connect(skidF).connect(skidG).connect(master);

  const windSrc = ac.createBufferSource();
  windSrc.buffer = noiseBuffer(ac);
  windSrc.loop = true;
  const windF = ac.createBiquadFilter();
  windF.type = 'lowpass';
  windF.frequency.value = 500;
  const windG = ac.createGain();
  windG.gain.value = 0;
  windSrc.connect(windF).connect(windG).connect(master);

  const t0 = ac.currentTime;
  oscA.start(t0);
  oscB.start(t0);
  skidSrc.start(t0);
  windSrc.start(t0, 0.3);
  let stopped = false;
  return {
    // rpm 0..1 within the current gear, speed 0..1, load 0..1, skid 0..1, boost 0..2
    update({ rpm, gear, speed, load, skid, boost, volume = 1 }) {
      if (stopped) return;
      const t = ac.currentTime;
      const f = 48 + rpm * 120 + gear * 9 + boost * 12;
      oscA.frequency.setTargetAtTime(f, t, 0.03);
      oscB.frequency.setTargetAtTime(f * 0.5, t, 0.03);
      filter.frequency.setTargetAtTime(500 + load * 1400 + rpm * 900 + boost * 600, t, 0.05);
      out.gain.setTargetAtTime((0.16 + load * 0.14) * volume, t, 0.05);
      skidG.gain.setTargetAtTime(skid * 0.12 * volume, t, 0.05);
      skidF.frequency.setTargetAtTime(1800 + speed * 1600, t, 0.1);
      windG.gain.setTargetAtTime(speed * speed * 0.25 * volume, t, 0.1);
      windF.frequency.setTargetAtTime(300 + speed * 1200, t, 0.1);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const t = ac.currentTime;
      out.gain.setTargetAtTime(0, t, 0.08);
      skidG.gain.setTargetAtTime(0, t, 0.05);
      windG.gain.setTargetAtTime(0, t, 0.08);
      for (const n of [oscA, oscB, skidSrc, windSrc]) n.stop(t + 0.5);
    },
  };
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended' && state.settings.sound) ctx.resume();
}

export function suspendAudio() {
  if (ctx && ctx.state === 'running') ctx.suspend();
}
