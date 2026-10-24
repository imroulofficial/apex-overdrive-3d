import { noiseSource, filter, gain, envelope, saturation, midiHz } from './mixer.js';

// One-shot sound effects. Each function takes the mixer and an optional start time `at`
// (defaults to now) so the offline preview renderer can place them on a timeline.
// The car's one-shots (blow-off, exhaust pops, nitro, tyre chirp) play recorded samples; the
// HUD and race cues are synthesized.

const now = (mix, at) => (at ?? mix.ac.currentTime) + 0.005;

// Each node reports when it stops, so the voice pool (voices.js) knows when a one-shot ends.
function track(mix, end) {
  if (mix.voiceEnd !== undefined && end > mix.voiceEnd) mix.voiceEnd = end;
}

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
  track(mix, end + 0.05);
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
  track(mix, end + 0.05);
  return g;
}

// A recorded one-shot from the sample bank (audio/samples.js) at playback `rate` and level
// `peak`, from `offset` for `duration` seconds of the sample (to its end by default). Returns
// { src, g, end }, or null while the samples are still decoding (the sound is skipped).
function shot(mix, dest, name, { t, rate = 1, peak = 0.5, offset = 0, duration }) {
  const buf = mix.samples?.get(name);
  if (!buf) return null;
  const ac = mix.ac;
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = gain(ac, peak);
  src.connect(g).connect(dest);
  const len = Math.min(duration ?? Infinity, buf.duration - offset);
  src.start(t, offset, len);
  const end = t + len / rate;
  track(mix, end + 0.02);
  return { src, g, end };
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

  // Driver door on hydraulic struts: the latch pops, the strut hisses and its pump whines
  // through the travel, then a damped thunk as it reaches the stop (a firmer latch on close).
  door(mix, open = true, at) {
    const t = now(mix, at);
    const travel = 0.85;
    burst(mix, mix.ui, { t, type: 'bandpass', freq: open ? 1900 : 1400, q: 3, peak: 0.7, decay: 0.03 });
    tone(mix, mix.ui, { t, type: 'sine', freq: 150, to: 70, peak: 0.3, decay: 0.08 });
    burst(mix, mix.ui, { t: t + 0.04, type: 'bandpass', freq: open ? 3200 : 1300, to: open ? 1100 : 2800, q: 2.2, attack: 0.08, hold: travel * 0.5, peak: 0.24, decay: travel * 0.5, glide: travel });
    const lp = filter(mix.ac, 'lowpass', 900, 2);
    lp.connect(mix.ui);
    tone(mix, lp, { t: t + 0.05, type: 'sawtooth', freq: open ? 120 : 190, to: open ? 210 : 115, glide: travel, attack: 0.1, hold: travel * 0.55, peak: 0.07, decay: travel * 0.35 });
    const end = t + travel + 0.05;
    tone(mix, mix.ui, { t: end, type: 'sine', freq: open ? 95 : 130, to: 50, peak: open ? 0.35 : 0.55, decay: open ? 0.14 : 0.1 });
    burst(mix, mix.ui, { t: end, type: 'lowpass', freq: 700, to: 160, peak: open ? 0.25 : 0.5, decay: 0.12 });
    if (!open) burst(mix, mix.ui, { t: end + 0.01, type: 'bandpass', freq: 2600, q: 4, peak: 0.55, decay: 0.025 });
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

// Turbo blow-off valve: the recorded "pshh" of an air valve venting, then the compressor
// surging ("tu-tu-tu"): chuffs of recorded rushing air, decaying at a slowing rate.
export function blowOff(mix, strength = 1, at) {
  const t = now(mix, at);
  const s = Math.min(1.2, Math.max(0.3, strength));
  const out = panned(mix, 0.15);
  const send = gain(mix.ac, 0.5);
  out.connect(send).connect(mix.space);
  // A harder lift vents more pressure: a longer, slightly lower hiss.
  shot(mix, out, 'blowOff', { t, rate: 1.12 - 0.18 * s, peak: 0.5 * s });
  const flutters = Math.round(3 + s * 3);
  let ft = t + 0.1;
  for (let i = 0; i < flutters; i++) {
    const f = filter(mix.ac, 'bandpass', 1100 - i * 60, 2.2);
    f.connect(out);
    const c = shot(mix, f, 'turboAir', { t: ft, offset: Math.random() * 1.5, duration: 0.05, peak: 0 });
    if (c) envelope(c.g.gain, ft, { attack: 0.005, peak: 2.2 * s * Math.pow(0.72, i), decay: 0.035 });
    ft += 0.042 + i * 0.008;
  }
}

// Exhaust crackle on the overrun: a few recorded pops, each pitched a little differently.
export function crackle(mix, intensity = 1, at) {
  const t = now(mix, at);
  const n = 1 + Math.floor(Math.random() * 3 * intensity);
  let pt = t;
  for (let i = 0; i < n; i++) {
    const a = (0.18 + Math.random() * 0.14) * intensity;
    shot(mix, mix.sfx, Math.random() < 0.5 ? 'pop1' : 'pop2', { t: pt, rate: 0.85 + Math.random() * 0.35, peak: a });
    pt += 0.04 + Math.random() * 0.09;
  }
}

// Nitro ignition: the valve opening (a recorded air burst, pitched down into a thump), a
// whoosh, and the blower roar swelling through a band that sweeps up. Pulse Nitro hits harder,
// reaches higher and sweeps across the stereo field.
export function nitroIgnite(mix, tier = 1, at) {
  const ac = mix.ac;
  const t = now(mix, at);
  const big = tier >= 2;
  shot(mix, mix.sfx, 'blowOff', { t, rate: big ? 0.55 : 0.62, peak: big ? 0.42 : 0.36 });
  const pan = panned(mix, big ? -0.6 : 0);
  if (big) pan.pan.linearRampToValueAtTime(0.6, t + 1.2);
  const whoosh = shot(mix, pan, 'whoosh', { t: t + 0.02, rate: big ? 0.8 : 0.9, peak: big ? 0.55 : 0.45 });
  if (whoosh) whoosh.g.connect(mix.space);

  const band = filter(ac, 'bandpass', 300, 0.9);
  band.frequency.setValueAtTime(300, t);
  band.frequency.exponentialRampToValueAtTime(big ? 3600 : 2600, t + 0.9);
  band.frequency.exponentialRampToValueAtTime(big ? 1800 : 1300, t + 1.8);
  band.connect(pan);
  const rush = shot(mix, band, 'nitroRush', { t, rate: big ? 1.25 : 1.05, offset: Math.random(), duration: 1.85, peak: 0 });
  if (rush) envelope(rush.g.gain, t + 0.03, { attack: 0.12, peak: big ? 1.3 : 1.0, hold: 0.35, decay: 1.2 });
}

export const race = {
  beep(mix, at) {
    const t = now(mix, at);
    const lp = filter(mix.ac, 'lowpass', 2600, 1);
    lp.connect(mix.sfx);
    lp.connect(mix.space);
    tone(mix, lp, { t, type: 'square', freq: midiHz(69), peak: 0.15, hold: 0.12, decay: 0.12 });
    tone(mix, lp, { t, type: 'sine', freq: midiHz(81), peak: 0.12, hold: 0.12, decay: 0.12 });
  },
  go(mix, at) {
    const t = now(mix, at);
    const lp = filter(mix.ac, 'lowpass', 4200, 1);
    lp.connect(mix.sfx);
    lp.connect(mix.space);
    for (const m of [81, 88, 93]) tone(mix, lp, { t, type: 'square', freq: midiHz(m), peak: 0.07, hold: 0.35, decay: 0.35 });
    tone(mix, mix.sfx, { t, type: 'sine', freq: 160, to: 70, peak: 0.25, decay: 0.3 });
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
      burst(mix, mix.sfx, { t, type: 'bandpass', freq: 900, to: 300, q: 0.9, peak: 0.4, decay: 0.28 });
      tone(mix, mix.sfx, { t, type: 'sine', freq: 150, to: 70, peak: 0.32, decay: 0.25 });
      for (let i = 0; i < 4; i++) {
        burst(mix, mix.sfx, { t: t + 0.03 + Math.random() * 0.2, type: 'bandpass', freq: 380 + Math.random() * 500, q: 6, peak: 0.55, decay: 0.06 });
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
    tone(mix, mix.sfx, { t, type: 'sine', freq: 140, to: 65, peak: 0.36 * a, decay: 0.22 });
    burst(mix, mix.sfx, { t, type: 'lowpass', freq: 1400, to: 300, peak: 0.35 * a, decay: 0.25 });
    for (const f of [523, 1187, 1734]) tone(mix, mix.space, { t, type: 'sine', freq: f, peak: 0.1 * a, decay: 0.35 });
    burst(mix, mix.sfx, { t, type: 'bandpass', freq: 3200, q: 2, peak: 0.4 * a, hold: 0.1, decay: 0.15 });
  },
  bump(mix, at) {
    const t = now(mix, at);
    tone(mix, mix.sfx, { t, type: 'sine', freq: 150, to: 70, peak: 0.32, decay: 0.18 });
    burst(mix, mix.sfx, { t, type: 'bandpass', freq: 600, q: 1.2, peak: 0.25, decay: 0.12 });
    tone(mix, mix.sfx, { t, type: 'sine', freq: 780, peak: 0.06, decay: 0.2 });
  },
  land(mix, k, at) {
    const t = now(mix, at);
    const a = Math.min(1, 0.3 + k * 0.04);
    tone(mix, mix.sfx, { t, type: 'sine', freq: 130, to: 55, peak: 0.45 * a, decay: 0.3 });
    burst(mix, mix.sfx, { t, type: 'lowpass', freq: 500, to: 120, peak: 0.4 * a, decay: 0.22 });
    burst(mix, mix.sfx, { t: t + 0.02, type: 'bandpass', freq: 1800, q: 3, peak: 0.4 * a, decay: 0.05 });
  },
  // Tyres biting at drift entry.
  chirp(mix, at) {
    const t = now(mix, at);
    shot(mix, mix.tyre ?? mix.sfx, 'chirp', { t, rate: 0.95 + Math.random() * 0.15, peak: 0.42 });
  },
  driftBank(mix, at) {
    const t = now(mix, at);
    [79, 86, 91].forEach((m, i) => tone(mix, mix.space, { t: t + i * 0.06, type: 'triangle', freq: midiHz(m), peak: 0.16, decay: 0.2 }));
    [79, 86, 91].forEach((m, i) => tone(mix, mix.sfx, { t: t + i * 0.06, type: 'triangle', freq: midiHz(m), peak: 0.14, decay: 0.16 }));
  },
  // Drift combo stepped up: a rising stab, one semitone group higher per level.
  combo(mix, level = 1, at) {
    const t = now(mix, at);
    const root = 74 + level * 4;
    [0, 7, 12].forEach((iv, i) => {
      tone(mix, mix.sfx, { t: t + i * 0.035, type: 'square', freq: midiHz(root + iv), peak: 0.06, decay: 0.16 });
      tone(mix, mix.space, { t: t + i * 0.035, type: 'triangle', freq: midiHz(root + iv + 12), peak: 0.08, decay: 0.22 });
    });
    burst(mix, mix.sfx, { t, type: 'highpass', freq: 5000, peak: 0.12, decay: 0.12 });
  },
  // Perfect Exit: a whoosh that sweeps up under a bright major chord.
  perfect(mix, at) {
    const t = now(mix, at);
    burst(mix, mix.sfx, { t, buffer: mix.pink, type: 'bandpass', freq: 400, to: 3800, q: 1.4, attack: 0.05, peak: 0.9, decay: 0.45, glide: 0.4 });
    tone(mix, mix.sfx, { t, type: 'sine', freq: 120, to: 200, peak: 0.28, decay: 0.3 });
    [84, 88, 91, 96].forEach((m, i) => {
      tone(mix, mix.sfx, { t: t + 0.04 + i * 0.045, type: 'triangle', freq: midiHz(m), peak: 0.13, decay: 0.32 });
      tone(mix, mix.space, { t: t + 0.04 + i * 0.045, type: 'sawtooth', freq: midiHz(m), peak: 0.03, decay: 0.3 });
    });
  },
  // Breakables: a fruit stall caving in (wood crack, thuds of fruit) or a neon sign bursting
  // (glass shatter and an electric fizz).
  shatter(mix, kind = 'stall', at) {
    const t = now(mix, at);
    if (kind === 'neon') {
      burst(mix, mix.sfx, { t, type: 'highpass', freq: 3500, peak: 0.35, decay: 0.35 });
      for (let i = 0; i < 7; i++) {
        tone(mix, mix.space, { t: t + Math.random() * 0.25, type: 'sine', freq: 2500 + Math.random() * 4000, peak: 0.08, decay: 0.12 + Math.random() * 0.2 });
      }
      tone(mix, mix.sfx, { t, type: 'sawtooth', freq: 120, to: 60, peak: 0.12, hold: 0.12, decay: 0.2 });
      burst(mix, mix.sfx, { t: t + 0.02, type: 'bandpass', freq: 6000, q: 3, peak: 0.25, hold: 0.15, decay: 0.1 });
    } else {
      burst(mix, mix.sfx, { t, type: 'bandpass', freq: 1100, to: 350, q: 1.1, peak: 0.45, decay: 0.24 });
      tone(mix, mix.sfx, { t, type: 'sine', freq: 160, to: 70, peak: 0.32, decay: 0.24 });
      for (let i = 0; i < 6; i++) {
        tone(mix, mix.sfx, { t: t + 0.05 + Math.random() * 0.4, type: 'sine', freq: 180 + Math.random() * 120, to: 90, peak: 0.18, decay: 0.08 });
      }
      burst(mix, mix.space, { t, type: 'bandpass', freq: 800, q: 1, peak: 0.3, decay: 0.3 });
    }
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
  // Time Trial pylon: a glassy two-note ping over a short swish (time back on the clock).
  pylon(mix, at) {
    const t = now(mix, at);
    tone(mix, mix.sfx, { t, type: 'triangle', freq: midiHz(88), peak: 0.16, decay: 0.12 });
    tone(mix, mix.sfx, { t: t + 0.06, type: 'triangle', freq: midiHz(95), peak: 0.16, decay: 0.22 });
    tone(mix, mix.space, { t: t + 0.06, type: 'sine', freq: midiHz(107), peak: 0.05, decay: 0.3 });
    burst(mix, mix.sfx, { t, type: 'bandpass', freq: 3000, to: 7000, q: 1.5, peak: 0.25, decay: 0.12 });
  },
  // Checkpoint gate / target reached: a rising major arpeggio.
  checkpoint(mix, at) {
    const t = now(mix, at);
    [72, 76, 79, 84].forEach((m, i) => {
      tone(mix, mix.sfx, { t: t + i * 0.055, type: 'square', freq: midiHz(m), peak: 0.07, decay: 0.16 });
      tone(mix, mix.space, { t: t + i * 0.055, type: 'triangle', freq: midiHz(m + 12), peak: 0.08, decay: 0.25 });
    });
  },
  // Countdown tick for the last seconds of a clock (Time Trial, Elimination).
  tick(mix, at) {
    const t = now(mix, at);
    tone(mix, mix.sfx, { t, type: 'square', freq: midiHz(81), peak: 0.1, decay: 0.07 });
    burst(mix, mix.sfx, { t, type: 'highpass', freq: 6000, peak: 0.12, decay: 0.02 });
  },
  // Elimination: a low blast with crackling debris, then a falling "exit" siren.
  eliminated(mix, big = false, at) {
    const t = now(mix, at);
    const ac = mix.ac;
    const drive = ac.createWaveShaper();
    drive.curve = saturation(1.6);
    drive.oversample = '2x';
    drive.connect(mix.sfx);
    tone(mix, drive, { t, type: 'sine', freq: 150, to: 50, glide: 0.6, peak: big ? 0.24 : 0.2, decay: 0.7 });
    burst(mix, mix.sfx, { t, type: 'lowpass', freq: 1800, to: 200, q: 0.7, peak: big ? 0.3 : 0.25, decay: 0.9, glide: 0.8 });
    burst(mix, mix.space, { t, buffer: mix.pink, type: 'lowpass', freq: 900, to: 220, peak: 0.3, decay: 1.4 });
    for (let i = 0; i < 9; i++) {
      burst(mix, mix.sfx, { t: t + 0.08 + Math.random() * 0.6, type: 'bandpass', freq: 1200 + Math.random() * 3000, q: 4, peak: 0.35, decay: 0.03 });
    }
    tone(mix, mix.sfx, { t: t + 0.25, type: 'sawtooth', freq: midiHz(76), to: midiHz(52), glide: 0.9, peak: 0.06, hold: 0.2, decay: 0.7 });
    tone(mix, mix.space, { t: t + 0.25, type: 'square', freq: midiHz(64), to: midiHz(40), glide: 0.9, peak: 0.04, hold: 0.2, decay: 0.7 });
  },
  coin(mix, i = 0, at) {
    const t = now(mix, at);
    tone(mix, mix.ui, { t, type: 'triangle', freq: 1500 + i * 40, to: 2400, glide: 0.05, peak: 0.12, decay: 0.08 });
  },
  // Thunder: close strikes crack first; every strike rolls on in a long, wandering low rumble.
  thunder(mix, distance = 0.5, at) {
    const t = now(mix, at);
    const near = 1 - Math.min(1, Math.max(0, distance));
    const bed = mix.ambience ?? mix.sfx;
    if (near > 0.4) burst(mix, bed, { t, type: 'highpass', freq: 1800, to: 500, peak: 0.5 * near, decay: 0.35, glide: 0.3 });
    burst(mix, mix.space, { t, buffer: mix.pink, type: 'lowpass', freq: 320 + near * 300, to: 110, q: 0.6, attack: 0.08, peak: 0.6, hold: 0.4, decay: 3.2, glide: 3 });
    for (let i = 0; i < 4; i++) {
      burst(mix, bed, { t: t + 0.2 + Math.random() * 1.8, buffer: mix.pink, type: 'lowpass', freq: 160 + Math.random() * 120, q: 1.5, attack: 0.1, peak: 0.35 + near * 0.2, decay: 0.9 });
    }
  },
};

// Continuous rain hiss (see core/audio.js createRainSound), in the damped ambience bus.
export function rainBed(mix) {
  const ac = mix.ac;
  const out = gain(ac, 0);
  out.connect(mix.ambience ?? mix.sfx);
  const hiss = noiseSource(mix);
  const hp = filter(ac, 'highpass', 1400, 0.5);
  const lp = filter(ac, 'lowpass', 7500, 0.5);
  hiss.connect(hp).connect(lp).connect(out);
  // Heavy drops on the roof: sparse low patter.
  const patter = noiseSource(mix, { buffer: mix.wobble, rate: 23 });
  const pat = filter(ac, 'bandpass', 900, 1.2);
  patter.connect(pat).connect(gain(ac, 0.6)).connect(out);
  hiss.start(ac.currentTime, Math.random());
  patter.start(ac.currentTime, Math.random());
  let level = -1;
  return {
    set(v) {
      if (Math.abs(v - level) < 0.01) return;
      level = v;
      out.gain.setTargetAtTime(v * 0.18, ac.currentTime, 0.4);
    },
    stop() {
      out.gain.setTargetAtTime(0, ac.currentTime, 0.15);
      hiss.stop(ac.currentTime + 0.8);
      patter.stop(ac.currentTime + 0.8);
    },
  };
}
