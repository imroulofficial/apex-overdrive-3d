import { noiseSource, filter, gain, envelope, saturation, midiHz } from './mixer.js';

// One-shot sound effects. Each function takes the mixer and an optional start time `at`
// (defaults to now) so the offline preview renderer can place them on a timeline.

const now = (mix, at) => (at ?? mix.ac.currentTime) + 0.005;

function tone(mix, dest, { t, type = 'sine', freq, to = freq, glide, attack = 0.003, peak = 0.5, decay = 0.15, hold = 0, detune = 0, wave }) {
  const ac = mix.ac;
  const osc = ac.createOscillator();
  if (wave) osc.setPeriodicWave(wave);
  else osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, t);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + (glide ?? attack + hold + decay));
  const g = gain(ac);
  const end = envelope(g.gain, t, { attack, peak, decay, hold });
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(end + 0.05);
  return g;
}

function burst(mix, dest, { t, type = 'bandpass', freq = 1000, to = freq, q = 0.8, attack = 0.002, peak = 0.5, decay = 0.2, hold = 0, glide, buffer, rate = 1 }) {
  const ac = mix.ac;
  const src = noiseSource(mix, { buffer, rate });
  const f = filter(ac, type, freq, q);
  if (to !== freq) f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + (glide ?? attack + hold + decay));
  const g = gain(ac);
  const end = envelope(g.gain, t, { attack, peak, decay, hold });
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 1.5);
  src.stop(end + 0.05);
  return g;
}

function panned(mix, pan, dest = mix.sfx) {
  const p = mix.ac.createStereoPanner();
  p.pan.value = pan;
  p.connect(dest);
  return p;
}

// ---------------------------------------------------------------------------
// HUD and garage: short, glassy, high-tech
// ---------------------------------------------------------------------------

export const ui = {
  // Crisp holographic click: a falling FM ping over a bright tick.
  tap(mix, at) {
    const t = now(mix, at);
    tone(mix, mix.ui, { t, type: 'sine', freq: 2600, to: 1250, glide: 0.05, peak: 0.22, decay: 0.07 });
    tone(mix, mix.ui, { t, type: 'triangle', freq: 5200, to: 3900, glide: 0.03, peak: 0.05, decay: 0.03 });
    burst(mix, mix.ui, { t, type: 'highpass', freq: 6500, q: 0.7, peak: 0.12, decay: 0.018 });
  },

  // Swipe: an airy filter sweep with a rising chirp.
  swipe(mix, at) {
    const t = now(mix, at);
    const p = panned(mix, -0.3, mix.ui);
    p.pan.linearRampToValueAtTime(0.35, t + 0.16);
    burst(mix, p, { t, type: 'bandpass', freq: 700, to: 6200, q: 1.6, attack: 0.05, peak: 0.28, decay: 0.12, glide: 0.16 });
    tone(mix, mix.ui, { t: t + 0.02, type: 'sine', freq: 900, to: 1800, glide: 0.09, peak: 0.08, decay: 0.09 });
  },

  confirm(mix, at) {
    const t = now(mix, at);
    [76, 83, 88].forEach((m, i) => {
      tone(mix, mix.ui, { t: t + i * 0.07, type: 'triangle', freq: midiHz(m), peak: 0.16, decay: 0.28 });
      tone(mix, mix.ui, { t: t + i * 0.07, type: 'sine', freq: midiHz(m + 12), peak: 0.06, decay: 0.2 });
    });
    burst(mix, mix.space, { t, type: 'highpass', freq: 5000, peak: 0.12, attack: 0.02, decay: 0.4 });
  },

  deny(mix, at) {
    const t = now(mix, at);
    for (let i = 0; i < 2; i++) {
      const f = filter(mix.ac, 'lowpass', 900, 4);
      f.connect(mix.ui);
      tone(mix, f, { t: t + i * 0.1, type: 'sawtooth', freq: 155, to: 120, peak: 0.2, decay: 0.08, hold: 0.02 });
    }
  },

  // Relay clunk for the headlight switch (the rev that follows is an engine one-shot).
  relay(mix, at) {
    const t = now(mix, at);
    burst(mix, mix.ui, { t, type: 'bandpass', freq: 2400, q: 3, peak: 0.9, decay: 0.025 });
    tone(mix, mix.ui, { t, type: 'sine', freq: 180, to: 90, peak: 0.25, decay: 0.06 });
    burst(mix, mix.ui, { t: t + 0.05, type: 'bandpass', freq: 3600, q: 4, peak: 0.6, decay: 0.02 });
  },
};

// ---------------------------------------------------------------------------
// Race one-shots
// ---------------------------------------------------------------------------

// Turbo blow-off valve: the sharp "pshh" of the valve venting, then the compressor
// surging ("tu-tu-tu") as the pressure collapses.
export function blowOff(mix, strength = 1, at) {
  const t = now(mix, at);
  const s = Math.min(1.2, Math.max(0.3, strength));
  const out = panned(mix, 0.15);
  const send = gain(mix.ac, 0.5);
  out.connect(send).connect(mix.space);
  burst(mix, out, { t, type: 'highpass', freq: 2400, to: 1500, q: 0.6, attack: 0.004, peak: 0.42 * s, decay: 0.3 * s + 0.08, glide: 0.3 });
  burst(mix, out, { t, type: 'bandpass', freq: 5200, to: 3000, q: 1.2, attack: 0.003, peak: 0.3 * s, decay: 0.16 });
  // Flutter: decaying chuffs at a slowing rate.
  const flutters = Math.round(3 + s * 3);
  let ft = t + 0.1;
  for (let i = 0; i < flutters; i++) {
    const a = 1.4 * s * Math.pow(0.72, i);
    burst(mix, out, { t: ft, type: 'bandpass', freq: 1100 - i * 60, q: 2.2, attack: 0.005, peak: a, decay: 0.035 });
    tone(mix, out, { t: ft, type: 'sine', freq: 210, to: 150, peak: a * 0.1, decay: 0.03 });
    ft += 0.042 + i * 0.008;
  }
}

// Exhaust crackle on the overrun: a few sharp pops with a low thud.
export function crackle(mix, intensity = 1, at) {
  const t = now(mix, at);
  const n = 1 + Math.floor(Math.random() * 3 * intensity);
  let pt = t;
  for (let i = 0; i < n; i++) {
    const a = (0.2 + Math.random() * 0.2) * intensity;
    burst(mix, mix.sfx, { t: pt, type: 'bandpass', freq: 900 + Math.random() * 1600, q: 1.1, attack: 0.001, peak: a * 2, decay: 0.03 + Math.random() * 0.03 });
    tone(mix, mix.sfx, { t: pt, type: 'sine', freq: 95, to: 55, peak: a * 0.5, decay: 0.05 });
    pt += 0.04 + Math.random() * 0.09;
  }
}

// Nitro ignition: a sub-bass thump, then a howling rush of air. Pulse Nitro hits harder,
// adds a rising jet tone and sweeps across the stereo field.
export function nitroIgnite(mix, tier = 1, at) {
  const ac = mix.ac;
  const t = now(mix, at);
  const big = tier >= 2;
  const drive = ac.createWaveShaper();
  drive.curve = saturation(big ? 3 : 2.2);
  drive.connect(mix.sfx);
  tone(mix, drive, { t, type: 'sine', freq: big ? 150 : 130, to: big ? 30 : 38, glide: 0.4, attack: 0.002, peak: big ? 0.95 : 0.8, decay: big ? 0.6 : 0.42 });
  tone(mix, drive, { t, type: 'triangle', freq: 75, to: 32, glide: 0.3, peak: 0.35, decay: 0.3 });
  burst(mix, mix.sfx, { t, type: 'highpass', freq: 2800, peak: 0.5, decay: 0.03 });
  burst(mix, mix.sfx, { t, type: 'lowpass', freq: 600, to: 120, peak: 0.45, decay: 0.2 });

  // Whoosh: pink noise through a widening band that sweeps up.
  const pan = panned(mix, big ? -0.6 : 0);
  if (big) pan.pan.linearRampToValueAtTime(0.6, t + 1.2);
  const whoosh = burst(mix, pan, { t: t + 0.02, buffer: mix.pink, type: 'bandpass', freq: 260, to: big ? 3600 : 2600, q: 0.9, attack: 0.09, peak: big ? 0.9 : 0.7, hold: 0.25, decay: big ? 1.1 : 0.85, glide: 0.9 });
  whoosh.connect(mix.space);

  // Howl: two resonant bands give the air a vowel-like whistle, with a little vibrato.
  for (const [f0, f1, q, a] of [
    [420, 1250, 11, 3.2],
    [640, 1900, 14, 2.2],
  ]) {
    const src = noiseSource(mix);
    const f = filter(ac, 'bandpass', f0, q);
    f.frequency.exponentialRampToValueAtTime(f1 * (big ? 1.3 : 1), t + 0.8);
    f.frequency.exponentialRampToValueAtTime(f1 * 0.7, t + 1.7);
    const vib = ac.createOscillator();
    vib.frequency.value = 5.5;
    const vibDepth = gain(ac, f1 * 0.03);
    vib.connect(vibDepth).connect(f.frequency);
    const g = gain(ac);
    envelope(g.gain, t + 0.05, { attack: 0.15, peak: a * (big ? 1.2 : 1), hold: 0.4, decay: 1.0 });
    src.connect(f).connect(g).connect(pan);
    src.start(t, Math.random());
    vib.start(t);
    src.stop(t + 1.8);
    vib.stop(t + 1.8);
  }
  if (big) {
    // Jet spool: detuned saws rising through a closing filter.
    const lp = filter(ac, 'lowpass', 900, 6);
    lp.frequency.exponentialRampToValueAtTime(3800, t + 0.6);
    lp.frequency.exponentialRampToValueAtTime(1200, t + 1.4);
    lp.connect(pan);
    for (const d of [-14, 14]) tone(mix, lp, { t, type: 'sawtooth', freq: 180, to: 720, glide: 0.7, attack: 0.06, peak: 0.14, hold: 0.3, decay: 0.8, detune: d });
    tone(mix, mix.sfx, { t: t + 0.05, type: 'sine', freq: 70, to: 26, glide: 0.8, peak: 0.6, decay: 0.8 });
  }
}

export const race = {
  beep(mix, at) {
    const t = now(mix, at);
    const lp = filter(mix.ac, 'lowpass', 2600, 1);
    lp.connect(mix.sfx);
    lp.connect(mix.space);
    tone(mix, lp, { t, type: 'square', freq: midiHz(69), peak: 0.22, hold: 0.12, decay: 0.12 });
    tone(mix, lp, { t, type: 'sine', freq: midiHz(81), peak: 0.12, hold: 0.12, decay: 0.12 });
  },
  go(mix, at) {
    const t = now(mix, at);
    const lp = filter(mix.ac, 'lowpass', 4200, 1);
    lp.connect(mix.sfx);
    lp.connect(mix.space);
    for (const m of [81, 88, 93]) tone(mix, lp, { t, type: 'square', freq: midiHz(m), peak: 0.12, hold: 0.35, decay: 0.35 });
    tone(mix, mix.sfx, { t, type: 'sine', freq: 120, to: 50, peak: 0.5, decay: 0.3 });
  },
  empty(mix, at) {
    const t = now(mix, at);
    tone(mix, mix.sfx, { t, type: 'square', freq: 330, to: 220, peak: 0.1, decay: 0.12 });
    burst(mix, mix.sfx, { t, type: 'bandpass', freq: 1800, to: 600, q: 2, peak: 0.4, decay: 0.15 });
  },
  // Plastic cone (small) or wooden barricade (big).
  smash(mix, big, at) {
    const t = now(mix, at);
    if (big) {
      burst(mix, mix.sfx, { t, type: 'bandpass', freq: 900, to: 300, q: 0.9, peak: 0.6, decay: 0.28 });
      tone(mix, mix.sfx, { t, type: 'sine', freq: 110, to: 48, peak: 0.6, decay: 0.25 });
      for (let i = 0; i < 4; i++) {
        burst(mix, mix.sfx, { t: t + 0.03 + Math.random() * 0.2, type: 'bandpass', freq: 380 + Math.random() * 500, q: 6, peak: 1.0, decay: 0.06 });
      }
      burst(mix, mix.space, { t, type: 'bandpass', freq: 700, q: 1, peak: 0.3, decay: 0.3 });
    } else {
      tone(mix, mix.sfx, { t, type: 'triangle', freq: 640, to: 420, peak: 0.25, decay: 0.12 });
      burst(mix, mix.sfx, { t, type: 'bandpass', freq: 2200, q: 1.5, peak: 0.35, decay: 0.07 });
      for (let i = 0; i < 3; i++) {
        burst(mix, mix.sfx, { t: t + 0.08 + Math.random() * 0.3, type: 'bandpass', freq: 1500 + Math.random() * 2500, q: 5, peak: 0.45, decay: 0.03 });
      }
    }
  },
  // Barrier contact: a body thud, a metallic ring and grinding grit.
  wall(mix, k, at) {
    const t = now(mix, at);
    const a = Math.min(1, 0.25 + k * 0.04);
    tone(mix, mix.sfx, { t, type: 'sine', freq: 95, to: 45, peak: 0.7 * a, decay: 0.22 });
    burst(mix, mix.sfx, { t, type: 'lowpass', freq: 1400, to: 300, peak: 0.55 * a, decay: 0.25 });
    for (const f of [523, 1187, 1734]) tone(mix, mix.space, { t, type: 'sine', freq: f, peak: 0.1 * a, decay: 0.35 });
    burst(mix, mix.sfx, { t, type: 'bandpass', freq: 3200, q: 2, peak: 0.6 * a, hold: 0.1, decay: 0.15 });
  },
  bump(mix, at) {
    const t = now(mix, at);
    tone(mix, mix.sfx, { t, type: 'sine', freq: 120, to: 55, peak: 0.55, decay: 0.18 });
    burst(mix, mix.sfx, { t, type: 'bandpass', freq: 600, q: 1.2, peak: 0.35, decay: 0.12 });
    tone(mix, mix.sfx, { t, type: 'sine', freq: 780, peak: 0.06, decay: 0.2 });
  },
  land(mix, k, at) {
    const t = now(mix, at);
    const a = Math.min(1, 0.3 + k * 0.04);
    tone(mix, mix.sfx, { t, type: 'sine', freq: 80, to: 34, peak: 0.85 * a, decay: 0.3 });
    burst(mix, mix.sfx, { t, type: 'lowpass', freq: 500, to: 120, peak: 0.4 * a, decay: 0.22 });
    burst(mix, mix.sfx, { t: t + 0.02, type: 'bandpass', freq: 1800, q: 3, peak: 0.4 * a, decay: 0.05 });
  },
  // Tyres biting at drift entry.
  chirp(mix, at) {
    const t = now(mix, at);
    burst(mix, mix.sfx, { t, type: 'bandpass', freq: 1500, to: 1100, q: 9, peak: 2.2, decay: 0.12 });
  },
  driftBank(mix, at) {
    const t = now(mix, at);
    [79, 86, 91].forEach((m, i) => tone(mix, mix.space, { t: t + i * 0.06, type: 'triangle', freq: midiHz(m), peak: 0.16, decay: 0.2 }));
    [79, 86, 91].forEach((m, i) => tone(mix, mix.sfx, { t: t + i * 0.06, type: 'triangle', freq: midiHz(m), peak: 0.14, decay: 0.16 }));
  },
  lap(mix, at) {
    const t = now(mix, at);
    [76, 81, 88].forEach((m, i) => tone(mix, mix.space, { t: t + i * 0.12, type: 'square', freq: midiHz(m), peak: 0.07, decay: 0.25 }));
    [76, 81, 88].forEach((m, i) => tone(mix, mix.sfx, { t: t + i * 0.12, type: 'triangle', freq: midiHz(m), peak: 0.18, decay: 0.25 }));
  },
  finish(mix, at) {
    const t = now(mix, at);
    [69, 72, 76, 81].forEach((m, i) => {
      tone(mix, mix.sfx, { t: t + i * 0.11, type: 'triangle', freq: midiHz(m), peak: 0.2, decay: 0.35 });
      tone(mix, mix.space, { t: t + i * 0.11, type: 'square', freq: midiHz(m + 12), peak: 0.04, decay: 0.3 });
    });
    for (const m of [81, 85, 88]) tone(mix, mix.sfx, { t: t + 0.45, type: 'sawtooth', freq: midiHz(m), peak: 0.06, hold: 0.4, decay: 0.8 });
    burst(mix, mix.space, { t: t + 0.45, buffer: mix.pink, type: 'highpass', freq: 4000, attack: 0.3, peak: 0.2, decay: 1.2 });
  },
  coin(mix, i = 0, at) {
    const t = now(mix, at);
    tone(mix, mix.ui, { t, type: 'triangle', freq: 1500 + i * 40, to: 2400, glide: 0.05, peak: 0.12, decay: 0.08 });
  },
};
