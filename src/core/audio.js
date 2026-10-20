// UI sound effects synthesized with WebAudio, so no audio files or network are needed.
// Recorded engine/race audio will be bundled under public/audio in a later phase.
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

export function suspendAudio() {
  if (ctx && ctx.state === 'running') ctx.suspend();
}
