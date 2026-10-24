// The car mixer: one AudioWorkletProcessor on the real-time audio thread that plays the whole
// race (engine, turbo, nitro, tyres, surfaces, wind, rain, every race one-shot and the
// soundtrack), the way FMOD or Wwise run a vehicle: from PCM held in memory, with its own
// gearbox, mixing loops by phase accumulation into a handful of fixed outputs.
//
// Why: the graph version (audio/engine.js, sfx.js, music.js, driven by audio/clock.js) has the
// main thread feed the audio thread all race long: AudioParam automation for every engine
// layer 60 times a second, a new set of nodes and connections for every one-shot, the music's
// notes and gates. All of it runs on the main thread between frames, and a phone's main thread
// is the one already late. Here a race frame posts one small Float32Array (audio/worklet/
// protocol.js CTL) and nothing else: no node is created, connected or disconnected, no source
// started, no AudioParam touched from the grid to the finish.
//
// Everything is allocated when the PCM arrives; process() allocates nothing.
import { Gearbox, LAYERS, layerLevels, REVS, IDLE, REDLINE, ENGINE_LEVEL, clamp } from '../gearbox.js';
import { PROCESSOR, CTL, FRAME_EVENTS, SHOT_TABLE, SHOT_INDEX, MAX_SHOTS, OUT } from './protocol.js';

const SR = sampleRate;
const BLOCK = 128;
// Per-sample smoothing coefficient for a time constant (seconds).
const k = (tc) => 1 - Math.exp(-1 / (tc * SR));
// Per-block smoothing coefficient (rates and filter frequencies move once per block).
const kb = (tc) => 1 - Math.exp(-BLOCK / (tc * SR));

// ---------------------------------------------------------------------------
// DSP parts
// ---------------------------------------------------------------------------

// Biquad, transposed direct form II, with the Web Audio API's coefficient formulas (so a
// filter here sounds like the BiquadFilterNode it replaces: lowpass / highpass Q in dB).
class Biquad {
  constructor(type, freq, q, gainDb = 0) {
    this.type = type;
    this.q = q;
    this.gainDb = gainDb;
    this.f = -1;
    this.want = freq;
    this.z1 = 0;
    this.z2 = 0;
    this.tune();
  }

  set(freq) {
    this.want = freq;
    this.tune();
  }

  // Moves the filter to the frequency in `want`. (The hot path sets the field and calls this:
  // a number passed to a call that is not inlined gets boxed, and that garbage is a glitch.)
  tune() {
    const f = Math.min(Math.max(this.want, 10), SR * 0.49);
    if (Math.abs(f - this.f) < 0.05) return;
    this.f = f;
    const w = (2 * Math.PI * f) / SR;
    const cs = Math.cos(w);
    const sn = Math.sin(w);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let a0 = 1;
    let a1 = 0;
    let a2 = 0;
    if (this.type === 'lowpass' || this.type === 'highpass') {
      const alpha = sn / (2 * Math.pow(10, this.q / 20));
      if (this.type === 'lowpass') {
        b1 = 1 - cs;
        b0 = b2 = b1 / 2;
      } else {
        b1 = -(1 + cs);
        b0 = b2 = (1 + cs) / 2;
      }
      a0 = 1 + alpha;
      a1 = -2 * cs;
      a2 = 1 - alpha;
    } else if (this.type === 'bandpass') {
      const alpha = sn / (2 * this.q);
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cs;
      a2 = 1 - alpha;
    } else {
      // peaking
      const A = Math.pow(10, this.gainDb / 40);
      const alpha = sn / (2 * this.q);
      b0 = 1 + alpha * A;
      b1 = -2 * cs;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cs;
      a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  // Filters buf[0…n) in place. (The block forms keep every sample inside one loop: a call
  // that returns a number per sample boxes it, and that garbage is a glitch here.)
  process(buf, n) {
    const { b0, b1, b2, a1, a2 } = this;
    let z1 = this.z1;
    let z2 = this.z2;
    for (let i = 0; i < n; i++) {
      const x = buf[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      buf[i] = y;
    }
    this.z1 = z1;
    this.z2 = z2;
  }

  reset() {
    this.z1 = this.z2 = 0;
  }
}

// A looping read head over a PCM buffer: a fractional phase that wraps by subtraction, read
// with linear interpolation. The buffer's last sample runs into its first, so a seamless loop
// stays seamless at any rate, forever.
class Loop {
  constructor(data, rate = 1) {
    this.d = data;
    this.n = data ? data.length : 0;
    this.ph = this.n ? Math.random() * this.n : 0;
    this.rate = rate;
  }

  next() {
    const d = this.d;
    const n = this.n;
    if (!n) return 0;
    let ph = this.ph;
    const i = ph | 0;
    const f = ph - i;
    const a = d[i];
    const b = d[i + 1 < n ? i + 1 : 0];
    ph += this.rate;
    if (ph >= n) ph -= n;
    this.ph = ph;
    return a + (b - a) * f;
  }

  // Writes the next n samples into out.
  fill(out, n) {
    const d = this.d;
    const len = this.n;
    if (!len) {
      out.fill(0, 0, n);
      return;
    }
    const rate = this.rate;
    let ph = this.ph;
    for (let k = 0; k < n; k++) {
      const i = ph | 0;
      const f = ph - i;
      const a = d[i];
      out[k] = a + (d[i + 1 < len ? i + 1 : 0] - a) * f;
      ph += rate;
      if (ph >= len) ph -= len;
    }
    this.ph = ph;
  }

  // Moves on without reading (a silent layer keeps its place in the loop).
  skip(samples) {
    if (!this.n) return;
    this.ph = (this.ph + this.rate * samples) % this.n;
  }
}

// A value that glides toward a target with a time constant, sample by sample.
class Smooth {
  constructor(v = 0) {
    this.v = v;
    this.t = v;
    this.k = k(0.035);
  }

  to(t, tc) {
    this.t = t;
    this.k = k(tc);
  }

  // to() with the coefficient worked out already (K).
  toK(t, c) {
    this.t = t;
    this.k = c;
  }

  next() {
    this.v += (this.t - this.v) * this.k;
    return this.v;
  }

  // buf[i] *= the gliding value, sample by sample.
  mul(buf, n) {
    let v = this.v;
    const t = this.t;
    const c = this.k;
    for (let i = 0; i < n; i++) {
      v += (t - v) * c;
      buf[i] *= v;
    }
    this.v = v;
  }

  // dst[i] += src[i] × the gliding value.
  mulAdd(src, dst, n) {
    let v = this.v;
    const t = this.t;
    const c = this.k;
    for (let i = 0; i < n; i++) {
      v += (t - v) * c;
      dst[i] += src[i] * v;
    }
    this.v = v;
  }

  // out[i] = the gliding value.
  fill(out, n) {
    let v = this.v;
    const t = this.t;
    const c = this.k;
    for (let i = 0; i < n; i++) {
      v += (t - v) * c;
      out[i] = v;
    }
    this.v = v;
  }

  // Whether it is, and will stay, silent.
  get idle() {
    return this.t === 0 && this.v < 1e-5;
  }

  snap() {
    this.v = this.t;
  }
}

// The engine's time constants, as per-sample (K) and per-block (KB) coefficients, worked out
// once: the block code only multiplies (a helper returning a number per call boxes it).
const TCS = { t02: 0.02, t035: 0.035, t04: 0.04, t05: 0.05, t06: 0.06, t08: 0.08, t09: 0.09, t1: 0.1, t15: 0.15, t2: 0.2 };
const K = {};
const KB = {};
for (const [name, tc] of Object.entries(TCS)) {
  K[name] = k(tc);
  KB[name] = kb(tc);
}

// ---------------------------------------------------------------------------
// Engine: the RPM loops and everything else the car makes continuously
// ---------------------------------------------------------------------------

// The engine voice of audio/engine.js EngineVoice, sample for sample: the same layers, levels,
// filters and time constants, set from the same voice state.
class EngineDsp {
  constructor(bank) {
    const L = (name, rate) => new Loop(bank.loops[name], rate);
    this.layers = LAYERS.map((layer) => ({ L: layer, loop: L(layer.sample), g: new Smooth(), active: false }));
    this.rough = new Loop(bank.wobble, 2.5);
    this.body = new Smooth(0.8);
    this.tone = new Biquad('lowpass', 4000, 0.6);
    this.weight = new Biquad('peaking', 200, 0.7, 2.5);
    this.toneF = 4000;
    // Turbo.
    this.air = L('turboAir');
    this.whistleBp = new Biquad('bandpass', 2400, 9);
    this.whistleF = 2400;
    this.whistle = new Smooth();
    this.spoolHp = new Biquad('highpass', 2600, 0.7);
    this.spoolF = 2600;
    this.spoolLp = new Biquad('lowpass', 12000, 0.7);
    this.spool = new Smooth();
    // Nitro airflow.
    this.rush = L('nitroRush');
    this.rushRate = 1;
    this.rushBp = new Biquad('bandpass', 1100, 0.8);
    this.rushF = 1100;
    this.rushG = new Smooth();
    // Wind.
    this.wind = new Loop(bank.pink);
    this.windLp = new Biquad('lowpass', 400, 0.5);
    this.windF = 400;
    this.windG = new Smooth();
    // Tyres.
    this.skids = [L('skidLight'), L('skidHeavy')];
    this.skidMix = [new Smooth(1), new Smooth()];
    this.skidRate = 1;
    this.skidG = new Smooth();
    // Gravel: chopped bright grit over a low rumble.
    this.grit = new Loop(bank.noise);
    this.gritHp = new Biquad('highpass', 900, 0.7);
    this.chop = new Loop(bank.wobble, 7);
    this.rumble = new Loop(bank.pink);
    this.rumbleLp = new Biquad('lowpass', 160, 0.9);
    this.rumbleF = 160;
    this.gravelG = new Smooth();
    // Grass: a soft swishing hiss.
    this.swish = new Loop(bank.wobble, 1.6);
    this.grass = new Loop(bank.pink);
    this.grassLp = new Biquad('lowpass', 900, 0.5);
    this.grassF = 900;
    this.grassG = new Smooth();
    // Timber deck: plank-seam knocks over the boom of the span.
    this.knock = new Loop(bank.pink);
    this.woodBp = new Biquad('bandpass', 210, 2.2);
    this.woodF = 210;
    this.seams = new Loop(bank.seams, 8);
    this.seamRate = 8;
    this.boom = new Loop(bank.pink);
    this.boomLp = new Biquad('lowpass', 95, 7);
    this.woodG = new Smooth();
    this.out = new Smooth();
    // Scratch blocks.
    this.lv = new Float32Array(BLOCK);
    this.eng = new Float32Array(BLOCK);
    this.dry = new Float32Array(BLOCK);
    this.wet = new Float32Array(BLOCK);
    this.a = new Float32Array(BLOCK);
    this.b = new Float32Array(BLOCK);
    this.c = new Float32Array(BLOCK);
    // The whole voice fades in and out as one (start / stop).
    this.level = new Smooth(0);
    this.on = false;
    this.layerLv = new Float64Array(LAYERS.length);
    this.layerIn = new Float64Array(1);
  }

  start() {
    this.on = true;
    this.level.to(1, 0.01);
    this.level.snap();
  }

  stop(fade = 0.25) {
    this.on = false;
    this.level.to(0, fade / 3);
  }

  get silent() {
    return !this.on && this.level.v < 1e-5;
  }

  // The voice state of one block (EngineVoice.set): targets for every level, rate and filter.
  // fast: the garage rev's quicker 20 ms glide instead of 35 ms.
  set(s, fast = false) {
    const { rpm, load, boost, tier, speed, skid, slip, cut, gravel, grass, wood, mps, volume } = s;
    const r = Math.min(1.1, Math.max(0, (rpm - IDLE) / (REDLINE - IDLE)));
    const kc = fast ? K.t02 : K.t035;
    const bc = fast ? KB.t02 : KB.t035;
    const lv = this.layerLv;
    this.layerIn[0] = rpm;
    layerLevels(this.layerIn, lv);
    for (let i = 0; i < this.layers.length; i++) {
      const ly = this.layers[i];
      // A layer out of its range keeps its last pitch while silent.
      if (lv[i] > 0) ly.loop.rate += (rpm / ly.L.rpm - ly.loop.rate) * bc;
      ly.g.t = lv[i];
      ly.g.k = kc;
    }
    this.toneF += (1100 + load * 2200 + r * 3200 + tier * 800 - this.toneF) * bc;
    this.tone.want = this.toneF;
    this.tone.tune();
    this.body.t = 0.55 + 0.45 * load;
    this.body.k = kc;
    this.whistleF += (1800 + boost * 3400 - this.whistleF) * bc;
    this.whistleBp.want = this.whistleF;
    this.whistleBp.tune();
    this.whistle.t = 0.5 * boost * boost * (1 - 0.5 * r);
    this.whistle.k = kc;
    this.spoolF += (2200 + boost * 2400 - this.spoolF) * bc;
    this.spoolHp.want = this.spoolF;
    this.spoolHp.tune();
    this.spool.t = 0.09 * boost * boost;
    this.spool.k = kc;
    this.rushG.t = tier ? 0.32 + 0.16 * tier : 0;
    this.rushG.k = tier ? kc : K.t2;
    if (tier) this.rush.rate += (0.9 + 0.12 * tier + speed * 0.15 - this.rush.rate) * KB.t2;
    this.rushF += (800 + tier * 500 + speed * 700 - this.rushF) * KB.t2;
    this.rushBp.want = this.rushF;
    this.rushBp.tune();
    this.windG.t = speed * speed * 0.26;
    this.windG.k = K.t15;
    this.windF += (280 + speed * 1600 - this.windF) * KB.t15;
    this.windLp.want = this.windF;
    this.windLp.tune();
    const hard = Math.min(1, Math.max(0, (skid - 0.35) / 0.5));
    this.skidMix[0].t = Math.cos((hard * Math.PI) / 2);
    this.skidMix[0].k = K.t08;
    this.skidMix[1].t = Math.sin((hard * Math.PI) / 2);
    this.skidMix[1].k = K.t08;
    if (skid > 0) {
      const pitch = 0.88 + Math.min(1, Math.abs(slip) * 1.6) * 0.3 + speed * 0.08;
      this.skids[0].rate += (pitch - this.skids[0].rate) * KB.t06;
      this.skids[1].rate += (pitch - this.skids[1].rate) * KB.t06;
    }
    this.skidG.t = skid * 0.3 * volume;
    this.skidG.k = skid > 0 ? K.t04 : K.t09;
    const roll = Math.min(1, speed * 2.2) * (1 + Math.min(1, Math.abs(slip) * 2));
    this.gravelG.t = gravel * roll * 0.1 * volume;
    this.gravelG.k = K.t05;
    this.rumbleF += (90 + speed * 220 - this.rumbleF) * KB.t1;
    this.rumbleLp.want = this.rumbleF;
    this.rumbleLp.tune();
    this.grassG.t = grass * roll * 0.34 * volume;
    this.grassG.k = K.t08;
    this.grassF += (500 + speed * 1400 - this.grassF) * KB.t1;
    this.grassLp.want = this.grassF;
    this.grassLp.tune();
    this.woodG.t = wood * Math.min(1, speed * 3) * 0.18 * volume;
    this.woodG.k = K.t04;
    this.seams.rate += (Math.max(4, mps / 0.6) - this.seams.rate) * KB.t05;
    this.woodF += (180 + speed * 140 - this.woodF) * KB.t1;
    this.woodBp.want = this.woodF;
    this.woodBp.tune();
    this.out.t = volume * ENGINE_LEVEL * (0.62 + 0.38 * load) * (0.8 + 0.4 * Math.min(1, r)) * (1 - 0.55 * cut);
    this.out.k = cut ? K.t02 : kc;
  }

  // Adds n samples of the voice into the output channels.
  render(n, sfxL, sfxR, space, tyre, amb) {
    // Which parts are sounding this block: the rest only move their read heads on.
    const layers = this.layers;
    for (let j = 0; j < layers.length; j++) layers[j].active = !layers[j].g.idle;
    const turbo = !this.whistle.idle || !this.spool.idle;
    const rush = !this.rushG.idle;
    const wind = !this.windG.idle;
    const skid = !this.skidG.idle;
    const gravel = !this.gravelG.idle;
    const grass = !this.grassG.idle;
    const wood = !this.woodG.idle;
    const { lv, eng, dry, wet, a, b, c } = this;
    this.level.fill(lv, n);

    // Combustion: the RPM layers, the body level (with its slow wander), tone and weight.
    eng.fill(0, 0, n);
    for (let j = 0; j < layers.length; j++) {
      const ly = layers[j];
      if (!ly.active) continue;
      ly.loop.fill(a, n);
      ly.g.mulAdd(a, eng, n);
    }
    this.rough.fill(a, n);
    this.body.fill(b, n);
    for (let i = 0; i < n; i++) eng[i] *= b[i] + a[i] * 0.05;
    this.tone.process(eng, n);
    this.weight.process(eng, n);
    // Turbo whistle and spool hiss, inside the engine's level.
    if (turbo) {
      this.air.fill(a, n);
      b.set(a);
      this.whistleBp.process(a, n);
      this.whistle.mulAdd(a, eng, n);
      this.spoolHp.process(b, n);
      this.spoolLp.process(b, n);
      this.spool.mulAdd(b, eng, n);
    }
    this.out.mul(eng, n);
    for (let i = 0; i < n; i++) {
      const o = eng[i] * lv[i];
      dry[i] = o;
      wet[i] = o * 0.2;
    }
    if (rush) {
      this.rush.fill(a, n);
      this.rushBp.process(a, n);
      this.rushG.mul(a, n);
      for (let i = 0; i < n; i++) dry[i] += a[i] * lv[i];
    }
    if (gravel) {
      this.grit.fill(a, n);
      this.gritHp.process(a, n);
      this.chop.fill(b, n);
      this.rumble.fill(c, n);
      this.rumbleLp.process(c, n);
      for (let i = 0; i < n; i++) a[i] = a[i] * (0.55 + b[i] * 0.6) + c[i] * 2.2;
      this.gravelG.mul(a, n);
      for (let i = 0; i < n; i++) dry[i] += a[i] * lv[i];
    }
    if (grass) {
      this.grass.fill(a, n);
      this.grassLp.process(a, n);
      this.swish.fill(b, n);
      for (let i = 0; i < n; i++) a[i] *= 0.6 + b[i] * 0.4;
      this.grassG.mul(a, n);
      for (let i = 0; i < n; i++) dry[i] += a[i] * lv[i];
    }
    if (wood) {
      this.knock.fill(a, n);
      this.woodBp.process(a, n);
      this.seams.fill(b, n);
      this.boom.fill(c, n);
      this.boomLp.process(c, n);
      for (let i = 0; i < n; i++) a[i] = a[i] * (0.5 + b[i] * 0.5) * 5 + c[i] * 2.6;
      this.woodG.mul(a, n);
      for (let i = 0; i < n; i++) {
        const w = a[i] * lv[i];
        dry[i] += w;
        wet[i] += w * 0.4;
      }
    }
    if (skid) {
      this.skids[0].fill(a, n);
      this.skidMix[0].mul(a, n);
      this.skids[1].fill(b, n);
      this.skidMix[1].mulAdd(b, a, n);
      this.skidG.mul(a, n);
      for (let i = 0; i < n; i++) {
        const t = a[i] * lv[i];
        tyre[i] += t;
        wet[i] += t * 0.35;
      }
    }
    if (wind) {
      this.wind.fill(a, n);
      this.windLp.process(a, n);
      this.windG.mul(a, n);
      for (let i = 0; i < n; i++) amb[i] += a[i] * lv[i];
    }
    for (let i = 0; i < n; i++) {
      sfxL[i] += dry[i];
      sfxR[i] += dry[i];
      space[i] += wet[i];
    }
    // Parts that sat out keep their place, and settle their levels, as if they had played.
    for (let j = 0; j < layers.length; j++) if (!layers[j].active) idleStep(layers[j].g, layers[j].loop, n);
    if (!turbo) {
      this.air.skip(n);
      settle(this.whistle, this.spool);
      this.whistleBp.reset();
      this.spoolHp.reset();
      this.spoolLp.reset();
    }
    if (!rush) idleStep(this.rushG, this.rush, n, this.rushBp);
    if (!wind) idleStep(this.windG, this.wind, n, this.windLp);
    if (!skid) {
      this.skids[0].skip(n);
      this.skids[1].skip(n);
      settle(this.skidG, this.skidMix[0], this.skidMix[1]);
    }
    if (!gravel) {
      this.grit.skip(n);
      this.chop.skip(n);
      this.rumble.skip(n);
      settle(this.gravelG);
      this.gritHp.reset();
      this.rumbleLp.reset();
    }
    if (!grass) {
      this.swish.skip(n);
      idleStep(this.grassG, this.grass, n, this.grassLp);
    }
    if (!wood) {
      this.knock.skip(n);
      this.seams.skip(n);
      idleStep(this.woodG, this.boom, n, this.woodBp);
      this.boomLp.reset();
    }
  }
}

function settle(a, b, c) {
  a.snap();
  b?.snap();
  c?.snap();
}

function idleStep(g, loop, n, filter) {
  g.snap();
  loop.skip(n);
  filter?.reset();
}

// ---------------------------------------------------------------------------
// The processor
// ---------------------------------------------------------------------------

class CarMixer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.ctl = new Float32Array(CTL.events + 1 + FRAME_EVENTS * 3);
    this.ctl[CTL.volume] = 1;
    this.ctl[CTL.neutral] = 1;
    // The voice state handed to EngineDsp.set, refilled every block.
    this.vs = { rpm: IDLE, load: 0, boost: 0, tier: 0, speed: 0, skid: 0, slip: 0, cut: 0, gravel: 0, grass: 0, wood: 0, mps: 0, volume: 1 };
    this.dt = BLOCK / SR;
    // The gearbox's inputs, refilled every block.
    this.boxIn = { speedNorm: 0, throttle: 0, neutral: true, airborne: false, dt: this.dt };
    this.revIn = { speedNorm: 0, throttle: 0, neutral: true, airborne: false, dt: this.dt };
    this.port.onmessage = (e) => this.message(e.data);
  }

  message(m) {
    if (m instanceof Float32Array) {
      this.frame(m);
      return;
    }
    switch (m.type) {
      case 'load':
        this.load(m);
        break;
      case 'music-data':
        this.loadMusic(m);
        break;
      case 'engine':
        if (!this.ready) break;
        if (m.on) {
          this.box.reset();
          this.ctl.fill(0);
          this.ctl[CTL.volume] = 1;
          this.ctl[CTL.neutral] = 1;
          this.engine.start();
        } else this.engine.stop(m.fade ?? 0.25);
        break;
      case 'rev':
        if (this.ready) this.startRev(m.kind);
        break;
      case 'shot':
        if (this.ready) this.trigger(m.id, m.gain ?? 1, m.rate ?? 1, 0);
        break;
      case 'rain':
        if (!this.ready) break;
        this.rainOn = this.rainOn || m.level > 0;
        this.rainG.to(m.level * 0.18, m.stop ? 0.15 : 0.4);
        if (m.stop) this.rainStopping = true;
        else this.rainStopping = false;
        break;
      case 'music':
        this.musicCommand(m.cmd);
        break;
    }
  }

  // ---- Data, once ----

  load({ loops, noise, pink, wobble, seams, shots, musicTone }) {
    this.musicTone = musicTone;
    this.bank = { loops, noise, pink, wobble, seams };
    this.box = new Gearbox();
    this.engine = new EngineDsp(this.bank);
    // The garage rev: a second engine voice with its own gearbox and a scripted pedal.
    this.rev = new EngineDsp(this.bank);
    this.revBox = new Gearbox();
    this.revVs = { rpm: IDLE, load: 0, boost: 0, tier: 0, speed: 0, skid: 0, slip: 0, cut: 0, gravel: 0, grass: 0, wood: 0, mps: 0, volume: 1.15 };
    this.revScript = null;
    this.revT = 0;
    // One-shot PCM: per shot { length, sfxL, sfxR, space, tyre, ambience } (null: silent).
    this.shots = shots;
    // Voice pool: MAX_SHOTS sounding, plus room for stolen ones fading out.
    this.voices = Array.from({ length: MAX_SHOTS + 4 }, () => ({ on: false, shot: null, pos: 0, rate: 1, gain: 1, wait: 0, priority: 0, seq: 0, fade: 1, fading: false }));
    this.seq = 0;
    this.stealK = Math.exp(-1 / (0.012 * SR));
    // Overrun crackle queued from the gearbox (pop shots with their delays).
    // Rain: white hiss band-passed between 1.4 and 7.5 kHz, and sparse low patter.
    this.rainHiss = new Loop(noise);
    this.rainHp = new Biquad('highpass', 1400, 0.5);
    this.rainLp = new Biquad('lowpass', 7500, 0.5);
    this.rainPatter = new Loop(wobble, 23);
    this.rainBp = new Biquad('bandpass', 900, 1.2);
    this.rainG = new Smooth();
    this.rainA = new Float32Array(BLOCK);
    this.rainB = new Float32Array(BLOCK);
    this.rainOn = false;
    this.rainStopping = false;
    // Soundtrack state (its PCM arrives separately).
    this.music = null;
    this.musicOn = false;
    this.musicEnv = 0;
    this.musicStop = false;
    this.musicGrow = Math.pow(1e4, 1 / (1.2 * SR));
    this.musicFall = k(0.2);
    this.pauseG = new Smooth(1);
    this.pauseF = 20000;
    this.pauseL = new Biquad('lowpass', 20000, 0.5);
    this.pauseR = new Biquad('lowpass', 20000, 0.5);
    this.duck = new Smooth(1);
    this.duckUntil = -1;
    this.duckLevel = 1;
    this.toneF = musicTone.open;
    this.toneL = new Biquad('lowpass', 16000, 0.5);
    this.toneR = new Biquad('lowpass', 16000, 0.5);
    this.musL = new Float32Array(BLOCK);
    this.musR = new Float32Array(BLOCK);
    this.musG = new Float32Array(BLOCK);
    this.time = 0;
    this.ready = true;
    // JIT warm-up: for the first seconds the DSP runs on a silent stand-in engine with every
    // part sounding, so the compiler has optimized it long before the first race (in the
    // interpreter a block takes many times longer, and a race's first seconds would underrun).
    this.warmEngine = new EngineDsp(this.bank);
    this.warmEngine.start();
    this.warmBox = new Gearbox();
    this.warmIn = { speedNorm: 0.6, throttle: 1, neutral: false, airborne: false, dt: this.dt };
    this.warmVs = { rpm: 4000, load: 1, boost: 0.8, tier: 2, speed: 0.7, skid: 0.8, slip: 0.4, cut: 0, gravel: 0.5, grass: 0.5, wood: 1, mps: 40, volume: 1 };
    this.warmOut = Array.from({ length: 5 }, () => new Float32Array(BLOCK));
    this.warmLeft = Math.round((4 * SR) / BLOCK);
    this.port.postMessage({ type: 'ready' });
  }

  // The soundtrack's PCM (16-bit, at this context's rate) and its layout in seconds.
  loadMusic({ left, right, gain, start, drop, loopStart, loopEnd, rho, bar }) {
    const at = (sec) => Math.round(sec * SR);
    const n = Math.min(left.length, right.length);
    const xf = at(0.06);
    this.music = { left, right, gain, rho, cut: false, start: start * SR, dropTo: at(drop), loopStart: at(loopStart), loopEnd: Math.min(at(loopEnd), n - xf - 1), bar: bar * SR, xf, pos: 0, inIntro: true, drop: -1, xpos: -1, xn: 0 };
  }

  // ---- Controls ----

  frame(m) {
    if (!this.ready) return;
    const c = this.ctl;
    for (let i = 0; i < CTL.events; i++) c[i] = m[i];
    const n = Math.min(FRAME_EVENTS, m[CTL.events] | 0);
    for (let i = 0; i < n; i++) {
      const o = CTL.events + 1 + i * 3;
      this.trigger(m[o] | 0, m[o + 1], m[o + 2], 0);
    }
  }

  // Plays baked shot `id` at `gain` and `rate`, `wait` samples from now.
  trigger(id, gain, rate, wait) {
    const shot = this.shots[id];
    const meta = SHOT_TABLE[id];
    if (!shot || !meta || gain <= 0) return;
    const priority = meta.priority;
    let sounding = 0;
    let victim = null;
    const voices = this.voices;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      if (!v.on || v.fading) continue;
      sounding++;
      if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.seq < victim.seq)) victim = v;
    }
    if (sounding >= MAX_SHOTS) {
      if (victim.priority > priority) return;
      victim.fading = true;
    }
    let slot = null;
    for (let i = 0; i < voices.length; i++) if (!voices[i].on) slot = voices[i];
    if (!slot) {
      // Every slot busy fading: cut the quietest at once.
      for (let i = 0; i < voices.length; i++) {
        const v = voices[i];
        if (v.fading && (!slot || v.fade < slot.fade)) slot = v;
      }
      if (!slot) return;
    }
    slot.on = true;
    slot.fading = false;
    slot.fade = 1;
    slot.shot = shot;
    slot.pos = 0;
    slot.rate = rate > 0 ? rate : 1;
    slot.gain = gain;
    slot.wait = wait;
    slot.priority = priority;
    slot.seq = ++this.seq;
    if (meta.duck) this.duckFor(meta.duck[0], meta.duck[1]);
    if (meta.drop) this.dropMusic();
  }

  // The gearbox's events: blow-off (on a lift, or with an upshift under boost) and crackle.
  engineEvents(events) {
    for (let k = 0; k < events.length; k++) {
      const e = events[k];
      const bov = e.type === 'bov' ? e.strength : e.type === 'upshift' ? e.bov : 0;
      if (bov) {
        const s = clamp(bov, 0.3, 1.2);
        const id = s < 0.6 ? SHOT_INDEX.bovSoft : s < 0.9 ? SHOT_INDEX.bovMid : SHOT_INDEX.bovHard;
        this.trigger(id, s / SHOT_TABLE[id].strength, 1, 0);
      } else if (e.type === 'pop') {
        const n = 1 + Math.floor(Math.random() * 3 * e.intensity);
        let wait = 0;
        for (let i = 0; i < n; i++) {
          const a = (0.18 + Math.random() * 0.14) * e.intensity;
          this.trigger(Math.random() < 0.5 ? SHOT_INDEX.pop1 : SHOT_INDEX.pop2, a, 0.85 + Math.random() * 0.35, wait);
          wait += Math.round((0.04 + Math.random() * 0.09) * SR);
        }
      }
    }
  }

  startRev(kind) {
    this.revScript = REVS[kind] ?? REVS.stab;
    this.revT = 0;
    this.revBox.reset();
    this.rev.start();
  }

  duckFor(level, seconds) {
    this.duckLevel = level;
    this.duckUntil = this.time + seconds;
    this.duck.to(level, 0.04);
  }

  // ---- Soundtrack ----

  musicCommand(cmd) {
    if (!this.ready) return;
    const m = this.music;
    if (cmd === 'start') {
      if (!m) return;
      m.pos = 0;
      m.inIntro = true;
      m.drop = -1;
      m.xpos = -1;
      this.musicOn = true;
      this.musicStop = false;
      this.musicEnv = 1e-4;
      this.pauseG.to(1, 0.12);
      this.pauseG.snap();
      this.pauseF = 20000;
      this.duck.to(1, 0.04);
      this.duck.snap();
      this.toneF = this.musicTone.open;
    } else if (cmd === 'stop') this.musicStop = true;
    else if (cmd === 'pause') {
      this.pauseG.to(0.6 / 0.9, 0.12);
      this.pauseF = 650;
      this.duck.to(1, 0.1);
      this.duckUntil = -1;
    } else if (cmd === 'resume') {
      this.pauseG.to(1, 0.12);
      this.pauseF = 20000;
    }
  }

  // The green light: from the intro into the full track at the next bar.
  dropMusic() {
    const m = this.music;
    if (!m || !this.musicOn || !m.inIntro || m.drop >= 0) return;
    m.drop = Math.round(m.start + Math.ceil((m.pos + 1 - m.start) / m.bar) * m.bar);
  }

  // Jump the read head to `to`, crossfading from where it was (the old side reads on into
  // the music that follows it: the file holds a margin past the loop's end for this).
  // cut: the new side starts at full level (the green light's downbeat keeps its punch) and
  // only the old one fades; otherwise a constant-power crossfade for sides alike by m.rho.
  jump(m, to, cut) {
    m.xpos = m.pos;
    m.xn = 0;
    m.pos = to;
    m.cut = cut;
  }

  renderMusic(n, outL, outR) {
    const m = this.music;
    if (!m || !this.musicOn) return;
    const { left, right } = m;
    const XF = m.xf;
    const L = this.musL;
    const R = this.musR;
    const G = this.musG;
    // Engine-led ducking and tone (core/audio.js duckForEngine), and the pause muffle.
    this.pauseL.set(this.pauseF + (this.pauseL.f - this.pauseF) * (1 - kb(0.12)));
    this.pauseR.set(this.pauseL.f);
    this.toneL.set(this.toneF);
    this.toneR.set(this.toneF);
    const s = m.gain / 32768;
    let env = this.musicEnv;
    const stopping = this.musicStop;
    const fall = this.musicFall;
    const grow = this.musicGrow;
    for (let i = 0; i < n; i++) {
      // Envelope: an exponential rise from silence over 1.2 s; a 0.2 s fall on stop.
      if (stopping) env -= env * fall;
      else if (env < 1) env = Math.min(1, env * grow);
      G[i] = env;
      // The intro runs on into the loop (they were rendered as one), or jumps there at the
      // bar a drop asked for; the loop's end comes back round to its start.
      if (m.inIntro) {
        if (m.pos === m.drop && m.drop < m.dropTo) this.jump(m, m.dropTo, true);
        if (m.pos >= m.dropTo) m.inIntro = false;
      } else if (m.pos >= m.loopEnd) this.jump(m, m.loopStart + (m.pos - m.loopEnd), false);
      let l = left[m.pos];
      let r = right[m.pos];
      if (m.xpos >= 0) {
        const v = (m.xn + 0.5) / XF;
        const u = 1 - v;
        if (m.cut) {
          l += left[m.xpos] * u;
          r += right[m.xpos] * u;
        } else {
          // Constant power for partly alike sides (the same notes, free-running oscillators).
          const p = 1 / Math.sqrt(u * u + v * v + 2 * m.rho * u * v);
          l = (l * v + left[m.xpos] * u) * p;
          r = (r * v + right[m.xpos] * u) * p;
        }
        m.xpos++;
        if (++m.xn >= XF) m.xpos = -1;
      }
      m.pos++;
      L[i] = l * s;
      R[i] = r * s;
    }
    this.musicEnv = env;
    this.toneL.process(L, n);
    this.toneR.process(R, n);
    this.pauseL.process(L, n);
    this.pauseR.process(R, n);
    this.pauseG.mul(G, n);
    this.duck.mul(G, n);
    for (let i = 0; i < n; i++) {
      outL[i] += L[i] * G[i];
      outR[i] += R[i] * G[i];
    }
    if (stopping && env < 1e-4) {
      this.musicOn = false;
      this.pauseL.reset();
      this.pauseR.reset();
      this.toneL.reset();
      this.toneR.reset();
    }
  }

  // ---- One-shots ----

  renderShots(n, sfxL, sfxR, space, tyre, amb) {
    const sk = this.stealK;
    const voices = this.voices;
    for (let k = 0; k < voices.length; k++) {
      const v = voices[k];
      if (!v.on) continue;
      const sh = v.shot;
      const len = sh.length;
      const L = sh.sfxL;
      const R = sh.sfxR ?? L;
      const S = sh.space;
      const T = sh.tyre;
      const A = sh.ambience;
      for (let i = 0; i < n; i++) {
        if (v.wait > 0) {
          v.wait--;
          continue;
        }
        const p = v.pos;
        const j = p | 0;
        if (j >= len - 1) {
          v.on = false;
          break;
        }
        const f = p - j;
        let g = v.gain;
        if (v.fading) {
          v.fade *= sk;
          g *= v.fade;
          if (v.fade < 1e-3) {
            v.on = false;
            break;
          }
        }
        if (L) {
          sfxL[i] += (L[j] + (L[j + 1] - L[j]) * f) * g;
          sfxR[i] += (R[j] + (R[j + 1] - R[j]) * f) * g;
        }
        if (S) space[i] += (S[j] + (S[j + 1] - S[j]) * f) * g;
        if (T) tyre[i] += (T[j] + (T[j + 1] - T[j]) * f) * g;
        if (A) amb[i] += (A[j] + (A[j + 1] - A[j]) * f) * g;
        v.pos = p + v.rate;
      }
    }
  }

  // ---- Rain ----

  renderRain(n, amb) {
    if (!this.rainOn) return;
    const a = this.rainA;
    const b = this.rainB;
    this.rainHiss.fill(a, n);
    this.rainHp.process(a, n);
    this.rainLp.process(a, n);
    this.rainPatter.fill(b, n);
    this.rainBp.process(b, n);
    for (let i = 0; i < n; i++) a[i] += b[i] * 0.6;
    this.rainG.mulAdd(a, amb, n);
    if (this.rainStopping && this.rainG.idle) {
      this.rainOn = false;
      this.rainStopping = false;
      this.rainHp.reset();
      this.rainLp.reset();
      this.rainBp.reset();
    }
  }

  // ---- The block ----

  warm() {
    this.warmLeft--;
    const o = this.warmOut;
    this.warmBox.run(this.warmIn);
    const v = this.warmVs;
    // Sweeps the revs so every layer and crossfade gets compiled.
    v.rpm = 1000 + ((this.warmLeft * 37) % 6800);
    this.warmEngine.set(v);
    this.warmEngine.render(BLOCK, o[0], o[1], o[2], o[3], o[4]);
  }

  process(inputs, outputs) {
    if (!this.ready) return true;
    if (this.warmLeft > 0) this.warm();
    const out = outputs;
    const sfxL = out[OUT.sfx][0];
    const sfxR = out[OUT.sfx][1] ?? sfxL;
    const space = out[OUT.space][0];
    const tyre = out[OUT.tyre][0];
    const amb = out[OUT.ambience][0];
    const musL = out[OUT.music][0];
    const musR = out[OUT.music][1] ?? musL;
    const n = sfxL.length;
    this.time += n / SR;

    // The race engine: one gearbox step per block, on the audio clock.
    const eng = this.engine;
    let intensity = 0;
    if (!eng.silent) {
      const c = this.ctl;
      const box = this.box;
      const throttle = c[CTL.throttle];
      const volume = c[CTL.volume];
      const bi = this.boxIn;
      bi.speedNorm = c[CTL.speedNorm];
      bi.throttle = throttle;
      bi.neutral = c[CTL.neutral] > 0;
      bi.airborne = c[CTL.airborne] > 0;
      bi.dt = c[CTL.hold] ? 0 : this.dt;
      const events = box.run(bi);
      if (eng.on && volume > 0 && events.length) this.engineEvents(events);
      const v = this.vs;
      v.rpm = box.rpm;
      v.load = throttle;
      v.boost = box.boost;
      v.tier = c[CTL.boost];
      v.speed = c[CTL.speed];
      v.skid = c[CTL.skid];
      v.slip = c[CTL.slip];
      v.cut = box.cut;
      v.gravel = c[CTL.gravel];
      v.grass = c[CTL.grass];
      v.wood = c[CTL.wood];
      v.mps = c[CTL.mps];
      v.volume = volume;
      eng.set(v);
      eng.render(n, sfxL, sfxR, space, tyre, amb);
      if (eng.on && volume > 0) {
        const r = Math.min(1, Math.max(0, (box.rpm - 1500) / 6000));
        intensity = Math.min(1, r * throttle * 0.8 + v.tier * 0.25);
      }
    }

    // The garage rev.
    const rev = this.rev;
    if (!rev.silent) {
      const sc = this.revScript;
      if (rev.on && sc) {
        const th = sc.throttle(this.revT);
        this.revIn.throttle = th;
        const events = this.revBox.run(this.revIn);
        if (events.length) this.engineEvents(events);
        const v = this.revVs;
        v.rpm = this.revBox.rpm;
        v.load = 0.35 + 0.65 * th;
        v.boost = this.revBox.boost;
        v.cut = this.revBox.cut;
        rev.set(v, true);
        this.revT += this.dt;
        if (this.revT >= sc.duration) rev.stop(0.35);
      }
      rev.render(n, sfxL, sfxR, space, tyre, amb);
    }

    // The soundtrack follows the engine: ducked under load, its top closing as it works.
    if (this.musicOn) {
      if (this.time >= this.duckUntil) {
        const level = 1 - 0.38 * intensity;
        if (Math.abs(level - this.duck.t) > 0.01) this.duck.to(level, 0.35);
      }
      const { open, engine } = this.musicTone;
      const tone = open * Math.pow(engine / open, intensity);
      this.toneF += (tone - this.toneF) * kb(0.4);
      this.renderMusic(n, musL, musR);
    }

    this.renderShots(n, sfxL, sfxR, space, tyre, amb);
    this.renderRain(n, amb);
    return true;
  }
}

registerProcessor(PROCESSOR, CarMixer);

// For the unit tests (test/car-mixer.test.js), which run this file under node with stand-ins
// for the worklet globals.
export { Loop, Biquad, Smooth, EngineDsp, CarMixer };
