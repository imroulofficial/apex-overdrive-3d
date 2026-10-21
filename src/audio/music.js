import { noiseSource, filter, gain, saturation, midiHz, mulberry32 } from './mixer.js';

// "Coastline Overdrive": the race soundtrack, an original synthwave / electro-rock track
// sequenced and synthesized live (126 BPM, A minor). Sections rotate so a long race never
// hears the same 15 seconds twice in a row:
//   intro → drive → lift → drive (power chords) → break → lift → back to drive …
// A look-ahead scheduler queues notes ~150 ms ahead on the audio clock, so timing stays
// tight even when a frame stalls. tools/audio renders the same code offline.

const BPM = 126;
const STEP = 60 / BPM / 4; // one 16th note
const BAR = STEP * 16;

// One chord per bar. Pad voicings move by step; bass roots sit an octave and more below.
const CHORDS = {
  Am: { root: 33, pad: [57, 60, 64, 69], tones: [57, 60, 64, 69] },
  F: { root: 29, pad: [57, 60, 65, 69], tones: [53, 57, 60, 65] },
  C: { root: 36, pad: [55, 60, 64, 67], tones: [55, 60, 64, 67] },
  G: { root: 31, pad: [55, 59, 62, 67], tones: [55, 59, 62, 67] },
  E: { root: 28, pad: [56, 59, 64, 68], tones: [52, 56, 59, 64] },
};
const PROG = ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'E'];
const ARP = [0, 1, 2, 3, 1, 2, 3, 2, 0, 1, 2, 3, 2, 3, 1, 2];

// Lead hook: [midi or null for a rest, length in 16ths], 16 steps per bar.
const MELODY = [
  [[76, 4], [74, 2], [72, 2], [69, 6], [72, 2]],
  [[72, 4], [74, 2], [76, 2], [77, 4], [76, 4]],
  [[79, 6], [76, 2], [74, 4], [72, 4]],
  [[74, 4], [71, 4], [67, 4], [71, 2], [74, 2]],
  [[76, 4], [81, 4], [79, 2], [76, 2], [74, 4]],
  [[72, 4], [69, 2], [72, 2], [77, 6], [76, 2]],
  [[74, 4], [79, 4], [77, 2], [76, 2], [74, 4]],
  [[71, 4], [76, 4], [80, 6], [null, 2]],
];
const LEAD_AT = new Map();
MELODY.forEach((bar, b) => {
  let s = b * 16;
  for (const [note, len] of bar) {
    if (note !== null) LEAD_AT.set(s, [note, len]);
    s += len;
  }
});

const SECTIONS = {
  intro: { hats: 'soft', bass: 'long', pad: true, arp: 'dark', build: true },
  drive: { kick: true, snare: true, hats: 'full', bass: 'pump', pad: true, arp: 'open', crash: true },
  lift: { kick: true, snare: true, hats: 'full', bass: 'pump', pad: true, arp: 'open', lead: true, power: true, crash: true },
  drive2: { kick: true, snare: true, hats: 'full', bass: 'pump', pad: true, arp: 'open', power: true, crash: true },
  break: { kick: 'half', hats: 'soft', bass: 'long', pad: true, arp: 'dark', build: true },
};
const ORDER = ['intro', 'drive', 'lift', 'drive2', 'break', 'lift'];
const LOOP_FROM = 1;

export class Music {
  constructor(mix) {
    const ac = mix.ac;
    this.mix = mix;
    this.ac = ac;
    this.rand = mulberry32(5);

    this.out = gain(ac, 0);
    this.out.connect(mix.duck);
    // Pause muffles the track rather than stopping it.
    this.tone = filter(ac, 'lowpass', 20000, 0.5);
    const glue = ac.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.ratio.value = 3;
    glue.attack.value = 0.01;
    glue.release.value = 0.2;
    this.bus = gain(ac, 0.9);
    this.bus.connect(glue).connect(this.tone).connect(this.out);

    this.reverbSend = gain(ac, 1);
    const reverb = ac.createConvolver();
    reverb.buffer = impulse(ac, 2.4);
    this.reverbSend.connect(reverb).connect(gain(ac, 0.32)).connect(this.bus);

    // Stereo dotted-eighth echo with a darkening feedback loop.
    this.echo = gain(ac, 1);
    const dl = ac.createDelay(1);
    const dr = ac.createDelay(1);
    dl.delayTime.value = STEP * 3;
    dr.delayTime.value = STEP * 6;
    const fb = gain(ac, 0.3);
    const damp = filter(ac, 'lowpass', 2400);
    const merge = ac.createChannelMerger(2);
    this.echo.connect(dl);
    dl.connect(damp).connect(fb).connect(dl);
    dl.connect(merge, 0, 0);
    dl.connect(dr).connect(merge, 0, 1);
    merge.connect(gain(ac, 0.5)).connect(this.bus);

    this.pulseWave = pulseWave(ac, 0.25);
    this.playing = false;
    this.timer = 0;
    this.v = null;
  }

  // Starts from the intro. `at` schedules on an offline timeline; realtime runs a timer.
  start(at) {
    const ac = this.ac;
    const t = at ?? ac.currentTime + 0.08;
    if (this.v) this.teardown(t);
    this.v = this.buildVoices(t);
    this.playing = true;
    this.order = 0;
    this.step = 0;
    this.nextTime = t + 0.02;
    this.dropPending = false;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.exponentialRampToValueAtTime(1, t + 1.2);
    if (at === undefined) {
      clearInterval(this.timer);
      this.timer = setInterval(() => this.schedule(), 25);
      this.schedule();
    }
  }

  stop(fade = 0.8) {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    const t = this.ac.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, fade / 4);
    this.teardown(t + fade * 1.5);
  }

  teardown(t) {
    for (const s of this.v.sources) s.stop(t);
    this.v = null;
  }

  // Jump from the intro into the full track at the next bar (the green light).
  drop() {
    if (ORDER[this.order] === 'intro') this.dropPending = true;
  }

  setPaused(paused) {
    const t = this.ac.currentTime;
    this.tone.frequency.setTargetAtTime(paused ? 650 : 20000, t, 0.12);
    this.bus.gain.setTargetAtTime(paused ? 0.6 : 0.9, t, 0.12);
  }

  // Queues every 16th that starts before `until`.
  schedule(until = this.ac.currentTime + 0.15) {
    if (!this.playing) return;
    if (this.nextTime < this.ac.currentTime - 0.05) this.nextTime = this.ac.currentTime + 0.02; // stalled tab
    while (this.nextTime < until) {
      this.play(SECTIONS[ORDER[this.order]], this.step, this.nextTime);
      this.nextTime += STEP;
      this.step += 1;
      const barEnd = this.step % 16 === 0;
      if (this.step >= 128 || (barEnd && this.dropPending)) {
        this.step = 0;
        this.dropPending = false;
        this.order = this.order + 1 >= ORDER.length ? LOOP_FROM : this.order + 1;
      }
    }
  }

  play(sec, s, t) {
    const bar = Math.floor(s / 16);
    const p = s % 16;
    const chord = CHORDS[PROG[bar]];
    const last = bar === 7;

    // Drums.
    if ((sec.kick === true && p % 4 === 0) || (sec.kick === 'half' && p === 0) || (sec.build && last && p % 4 === 0)) this.kick(t);
    if (sec.snare && (p === 4 || p === 12)) this.snare(t, 1);
    if (sec.hats === 'full') this.hat(t, p % 4 === 2 ? 0.9 : p % 2 ? 0.35 : 0.55, p % 4 === 2);
    else if (sec.hats === 'soft' && p % 2 === 0) this.hat(t, p % 4 === 2 ? 0.45 : 0.25, false);
    if (sec.crash && bar === 0 && p === 0) this.crash(t);
    if (sec.build && last) {
      if (p >= 8) this.snare(t, 0.3 + (p - 8) * 0.08);
      if (p === 0) this.riser(t, BAR);
    }
    if (!sec.build && last && p === 14) this.snare(t, 0.7);

    // Bass.
    if (sec.bass === 'pump' && p % 2 === 0) this.bass(t, chord.root + (p % 4 === 2 ? 12 : 0), STEP * 1.6, p % 4 === 0 ? 1 : 0.8);
    else if (sec.bass === 'long' && p === 0) this.bass(t, chord.root, BAR * 0.95, 0.8);

    if (sec.pad && p === 0) this.pad(t, chord.pad, BAR, sec.arp === 'dark' ? 900 : 1700, bar % 2);
    if (sec.arp) this.arp(t, chord.tones[ARP[p]] + 12, sec.arp === 'dark' ? 1100 : 3200, p % 4 === 0 ? 1 : 0.7);
    if (sec.lead && LEAD_AT.has(s)) {
      const [note, len] = LEAD_AT.get(s);
      this.lead(t, note, len * STEP);
    }
    if (sec.power && p % 2 === 0 && p !== 6 && p !== 14) this.power(t, chord.root + 12, p === 0 ? STEP * 3.5 : STEP * 0.9, p === 0 ? 1 : 0.7);
  }

  // ---- Voices ----
  // Every instrument is a persistent synth voice whose pitch, filter and level are automated
  // per note, so playing the track creates no nodes at all (cheap on phones). Envelopes use
  // setTargetAtTime, which chains smoothly from wherever the previous note left off.

  buildVoices(t) {
    const ac = this.ac;
    const sources = [];
    const osc = (type, freq = 110, wave) => {
      const o = ac.createOscillator();
      if (wave) o.setPeriodicWave(wave);
      else o.type = type;
      o.frequency.value = freq;
      sources.push(o);
      return o;
    };
    const v = { sources };

    // Sidechain pump: everything melodic dips under each kick.
    v.pump = gain(ac, 1);
    v.pump.connect(this.bus);
    const drums = gain(ac, 0.9);
    drums.connect(this.bus);

    // Kick: a sine with a pitch drop plus a short click.
    v.kick = osc('sine', 44);
    v.kickG = gain(ac);
    v.kick.connect(v.kickG).connect(drums);
    v.click = osc('triangle', 180);
    v.clickG = gain(ac);
    v.click.connect(v.clickG).connect(drums);

    // One shared noise source feeds snare, hats, crash and riser through their own filters.
    const noise = noiseSource(this.mix);
    sources.push(noise);
    const tap = (type, freq, q, dest, send) => {
      const f = filter(ac, type, freq, q);
      const g = gain(ac);
      noise.connect(f).connect(g).connect(dest);
      if (send) g.connect(gain(ac, send)).connect(this.reverbSend);
      return { f, g };
    };
    v.snareBody = tap('bandpass', 1900, 0.7, drums, 0.6);
    v.snareSnap = tap('highpass', 5200, 0.7, drums);
    v.snareTone = osc('triangle', 190);
    v.snareToneG = gain(ac);
    v.snareTone.connect(v.snareToneG).connect(drums);
    const hatPan = ac.createStereoPanner();
    hatPan.pan.value = 0.25;
    hatPan.connect(drums);
    v.hat = tap('highpass', 7600, 0.8, hatPan);
    v.crash = tap('highpass', 4200, 0.7, drums, 1);
    v.riser = tap('bandpass', 400, 2, this.bus, 1);

    // Bass: two detuned saws and a sine sub through a resonant low-pass.
    v.bassF = filter(ac, 'lowpass', 260, 5);
    v.bassG = gain(ac);
    v.bassF.connect(v.bassG).connect(v.pump);
    v.bassOsc = [-7, 7].map((d) => {
      const o = osc('sawtooth');
      o.detune.value = d;
      o.connect(v.bassF);
      return o;
    });
    v.sub = osc('sine');
    v.sub.connect(gain(ac, 0.5)).connect(v.bassG);

    // Pad: two banks of four saws that alternate bars, so one releases as the next swells.
    v.pads = [0, 1].map(() => {
      const f = filter(ac, 'lowpass', 900, 1.5);
      const g = gain(ac);
      f.connect(g);
      g.connect(v.pump);
      g.connect(gain(ac, 0.7)).connect(this.reverbSend);
      const oscs = [0, 1, 2, 3].map((i) => {
        const o = osc('sawtooth');
        o.detune.value = (i % 2 ? 9 : -9) + (this.rand() - 0.5) * 4;
        o.connect(f);
        return o;
      });
      return { f, g, oscs };
    });

    // Arp: a 25% pulse with a plucky filter.
    v.arp = osc(null, 440, this.pulseWave);
    v.arpF = filter(ac, 'lowpass', 1100, 2);
    v.arpG = gain(ac);
    const arpPan = ac.createStereoPanner();
    arpPan.pan.value = -0.2;
    v.arp.connect(v.arpF).connect(v.arpG).connect(arpPan);
    arpPan.connect(v.pump);
    arpPan.connect(gain(ac, 0.45)).connect(this.echo);

    // Lead: detuned saws with delayed vibrato, into the echo and the hall.
    v.leadF = filter(ac, 'lowpass', 3400, 1.2);
    v.leadG = gain(ac);
    v.leadF.connect(v.leadG);
    v.leadG.connect(v.pump);
    v.leadG.connect(gain(ac, 0.5)).connect(this.echo);
    v.leadG.connect(gain(ac, 0.4)).connect(this.reverbSend);
    const vib = osc('sine', 5.6);
    v.vibDepth = gain(ac, 0);
    vib.connect(v.vibDepth);
    v.lead = [-8, 8].map((d) => {
      const o = osc('sawtooth');
      o.detune.value = d;
      v.vibDepth.connect(o.detune);
      o.connect(v.leadF);
      return o;
    });

    // Power chord (root, fifth, octave) through heavy drive: the electro-rock guitar.
    const drive = ac.createWaveShaper();
    drive.curve = saturation(7);
    const lp = filter(ac, 'lowpass', 3000, 0.9);
    const scoop = filter(ac, 'peaking', 750, 1);
    scoop.gain.value = -5;
    v.powerG = gain(ac);
    const powerPan = ac.createStereoPanner();
    powerPan.pan.value = 0.3;
    drive.connect(lp).connect(scoop).connect(v.powerG).connect(powerPan).connect(v.pump);
    v.power = [
      [0, -6],
      [7, 6],
      [12, -3],
    ].map(([iv, d]) => {
      const o = osc('sawtooth');
      o.detune.value = d;
      o.connect(drive);
      return { o, iv };
    });

    for (const s of sources) s.start(t, s.buffer ? this.rand() : undefined);
    return v;
  }

  kick(t) {
    const v = this.v;
    v.kick.frequency.setValueAtTime(155, t);
    v.kick.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    hit(v.kickG.gain, t, 1, 0.09);
    v.click.frequency.setValueAtTime(1400, t);
    v.click.frequency.exponentialRampToValueAtTime(180, t + 0.012);
    hit(v.clickG.gain, t, 0.35, 0.004);
    v.pump.gain.setValueAtTime(0.38, t);
    v.pump.gain.linearRampToValueAtTime(1, t + 0.21);
  }

  snare(t, k) {
    const v = this.v;
    hit(v.snareBody.g.gain, t, 0.55 * k, 0.05);
    hit(v.snareSnap.g.gain, t, 0.3 * k, 0.025);
    v.snareTone.frequency.setValueAtTime(210, t);
    v.snareTone.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    hit(v.snareToneG.gain, t, 0.45 * k, 0.03);
  }

  hat(t, k, open) {
    hit(this.v.hat.g.gain, t, 0.16 * k, open ? 0.06 : 0.012);
  }

  crash(t) {
    hit(this.v.crash.g.gain, t, 0.22, 0.45);
  }

  riser(t, dur) {
    const { f, g } = this.v.riser;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
  }

  bass(t, note, dur, k) {
    const v = this.v;
    const f = midiHz(note);
    for (const o of v.bassOsc) o.frequency.setValueAtTime(f, t);
    v.sub.frequency.setValueAtTime(f, t);
    v.bassF.frequency.setValueAtTime(1900, t);
    v.bassF.frequency.setTargetAtTime(260, t, 0.05);
    const g = v.bassG.gain;
    g.setTargetAtTime(0.42 * k, t, 0.002);
    g.setTargetAtTime(0.25 * k, t + 0.015, 0.08);
    g.setTargetAtTime(0, t + dur, 0.025);
  }

  pad(t, notes, dur, cutoff, bank) {
    const { f, g, oscs } = this.v.pads[bank];
    notes.forEach((m, i) => oscs[i].frequency.setValueAtTime(midiHz(m), t));
    f.frequency.setValueAtTime(cutoff * 0.6, t);
    f.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.6);
    g.gain.setTargetAtTime(0.09, t, 0.08);
    g.gain.setTargetAtTime(0, t + dur - 0.05, 0.12);
  }

  arp(t, note, cutoff, k) {
    const v = this.v;
    v.arp.frequency.setValueAtTime(midiHz(note), t);
    v.arpF.frequency.setValueAtTime(cutoff, t);
    v.arpF.frequency.setTargetAtTime(cutoff * 0.35, t, 0.04);
    hit(v.arpG.gain, t, 0.11 * k, 0.04);
  }

  lead(t, note, dur) {
    const v = this.v;
    // A touch of portamento between notes.
    for (const o of v.lead) o.frequency.setTargetAtTime(midiHz(note), t, 0.012);
    const g = v.leadG.gain;
    g.setTargetAtTime(0.14, t, 0.004);
    g.setTargetAtTime(0.1, t + 0.02, 0.1);
    g.setTargetAtTime(0, t + dur - 0.03, 0.035);
    v.vibDepth.gain.setValueAtTime(0, t);
    v.vibDepth.gain.linearRampToValueAtTime(dur > 0.4 ? 12 : 0, t + Math.min(dur, 0.5));
  }

  power(t, root, dur, k) {
    const v = this.v;
    for (const { o, iv } of v.power) o.frequency.setValueAtTime(midiHz(root + iv), t);
    const g = v.powerG.gain;
    g.setTargetAtTime(0.075 * k, t, 0.002);
    g.setTargetAtTime(0, t + dur * 0.55, dur * 0.18 + 0.01);
  }
}

// A percussive hit on a persistent voice: snap up to `peak`, then decay with time constant tc.
function hit(param, t, peak, tc) {
  param.setTargetAtTime(peak, t, 0.0015);
  param.setTargetAtTime(0, t + 0.006, tc);
}

// Stereo hall impulse: decaying noise, darker as it tails off.
function impulse(ac, seconds) {
  const n = Math.round(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, n, ac.sampleRate);
  const rand = mulberry32(9);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      const a = 0.25 + 0.7 * k; // more smoothing (darker) later in the tail
      lp += (rand() * 2 - 1 - lp) * (1 - a);
      d[i] = lp * Math.pow(1 - k, 2.6) * (i < ac.sampleRate * 0.012 ? i / (ac.sampleRate * 0.012) : 1);
    }
  }
  return buf;
}

// Band-limited pulse wave (duty 0..1) for the arp.
function pulseWave(ac, duty) {
  const N = 48;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let k = 1; k < N; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return ac.createPeriodicWave(real, imag);
}

export const MUSIC_INFO = { bpm: BPM, bar: BAR, step: STEP };
