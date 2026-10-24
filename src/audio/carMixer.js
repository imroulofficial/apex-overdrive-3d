// Main-thread side of the car mixer (audio/worklet/carMixer.processor.js): loads the
// processor once, hands it every sample it will play, then talks to it in messages only.
//
// At boot (the first sound the game makes) the mixer's single AudioWorkletNode is created and
// wired once to the static buses of audio/mixer.js. When the recorded samples are decoded it
// gets, in one transfer: the engine, tyre, turbo and nitro loops (the 12 s baked versions),
// the noise beds, and every race one-shot rendered to PCM by an OfflineAudioContext from the
// game's own sfx code (audio/sfx.js), so they sound as they always did. The soundtrack follows
// once its file is decoded. From then on a race creates, connects and schedules nothing: each
// frame posts one Float32Array (car state plus the one-shots fired since the last frame).
//
// Where AudioWorklet is missing (or the processor fails) the game keeps the Web Audio graph
// path (audio/engine.js, sfx.js, music.js on audio/clock.js): core/audio.js asks `ready`.
import workletUrl from './worklet/carMixer.processor.js?worker&url';
import { PROCESSOR, OUTPUTS, OUTPUT_CHANNELS, SHOT_TABLE, SHOT_INDEX, CTL, FRAME_EVENTS, FRAME_LENGTH } from './worklet/protocol.js';
import { race, blowOff, nitroIgnite, pop } from './sfx.js';
import { MUSIC_TONE } from './mixer.js';
import { LOOP_SAMPLES } from './samples.js';
import { SOUNDTRACK } from './soundtrack.js';

const BASE = `${import.meta.env?.BASE_URL ?? './'}assets/audio/`;

// How each baked one-shot is made: the sfx code at full level, its loudness-dependent and
// random parts at a representative setting (the mixer scales level and pitch per trigger).
const BAKE = {
  beep: (m, t) => race.beep(m, t),
  go: (m, t) => race.go(m, t),
  nitro: (m, t) => nitroIgnite(m, 1, t),
  pulse: (m, t) => nitroIgnite(m, 2, t),
  empty: (m, t) => race.empty(m, t),
  smash: (m, t) => race.smash(m, false, t),
  smashBig: (m, t) => race.smash(m, true, t),
  // wall / land scale with the impact (k); baked at the strength that reaches full level.
  wall: (m, t) => race.wall(m, 19, t),
  bump: (m, t) => race.bump(m, t),
  land: (m, t) => race.land(m, 17.5, t),
  chirp: (m, t) => race.chirp(m, t),
  driftBank: (m, t) => race.driftBank(m, t),
  combo1: (m, t) => race.combo(m, 1, t),
  combo2: (m, t) => race.combo(m, 2, t),
  combo3: (m, t) => race.combo(m, 3, t),
  perfect: (m, t) => race.perfect(m, t),
  shatterStall: (m, t) => race.shatter(m, 'stall', t),
  shatterNeon: (m, t) => race.shatter(m, 'neon', t),
  lap: (m, t) => race.lap(m, t),
  finish: (m, t) => race.finish(m, t),
  coin: (m, t) => race.coin(m, 0, t),
  pylon: (m, t) => race.pylon(m, t),
  checkpoint: (m, t) => race.checkpoint(m, t),
  tick: (m, t) => race.tick(m, t),
  eliminated: (m, t) => race.eliminated(m, false, t),
  eliminatedBig: (m, t) => race.eliminated(m, true, t),
  thunderNear: (m, t) => race.thunder(m, 0.1, t),
  thunderMid: (m, t) => race.thunder(m, 0.5, t),
  thunderFar: (m, t) => race.thunder(m, 0.9, t),
  bovSoft: (m, t) => blowOff(m, 0.45, t),
  bovMid: (m, t) => blowOff(m, 0.75, t),
  bovHard: (m, t) => blowOff(m, 1.05, t),
  pop1: (m, t) => pop(m, 1, t),
  pop2: (m, t) => pop(m, 2, t),
};

// Channels of the bake: the mixer outputs the one-shots feed (sfx is stereo, for the panned
// ones), in the processor's order.
const BAKE_CHANNELS = ['sfxL', 'sfxR', 'space', 'tyre', 'ambience'];

// A stand-in mixer on an offline context whose buses land on separate channels.
function bakeMix(ac, live) {
  ac.destination.channelInterpretation = 'discrete';
  const merge = ac.createChannelMerger(BAKE_CHANNELS.length);
  merge.connect(ac.destination);
  const sfx = ac.createGain();
  sfx.channelCount = 2;
  sfx.channelCountMode = 'explicit';
  const split = ac.createChannelSplitter(2);
  sfx.connect(split);
  split.connect(merge, 0, 0);
  split.connect(merge, 1, 1);
  const mono = (ch) => {
    const g = ac.createGain();
    g.channelCount = 1;
    g.channelCountMode = 'explicit';
    g.connect(merge, 0, ch);
    return g;
  };
  // The ui bus sits in the sfx bus at 0.8 (audio/mixer.js).
  const ui = ac.createGain();
  ui.gain.value = 0.8;
  ui.connect(sfx);
  return { ac, sfx, ui, space: mono(2), tyre: mono(3), ambience: mono(4), samples: live.samples, noise: live.noise, pink: live.pink, wobble: live.wobble, seams: live.seams };
}

// Calls every baker once at `at` on `mix` and returns where each one ends.
function layout(mix, gap) {
  const spans = [];
  let t = 0.05;
  for (const meta of SHOT_TABLE) {
    mix.voiceEnd = 0;
    BAKE[meta.name](mix, t);
    const end = Math.max(mix.voiceEnd, t + 0.05);
    spans.push([t, end]);
    t = end + gap;
  }
  return { spans, seconds: t };
}

// Renders every race one-shot to PCM at the context's rate: one offline render, sliced.
export async function bakeShots(live) {
  const rate = live.ac.sampleRate;
  // Pass one, never rendered, finds how long the timeline is (random parts vary a little,
  // hence the gap).
  const probe = layout(bakeMix(new OfflineAudioContext(BAKE_CHANNELS.length, 128, rate), live), 0.4);
  const ac = new OfflineAudioContext(BAKE_CHANNELS.length, Math.ceil((probe.seconds + 1) * rate), rate);
  const mix = bakeMix(ac, live);
  const { spans } = layout(mix, 0.4);
  const buf = await ac.startRendering();
  const chans = BAKE_CHANNELS.map((_, c) => buf.getChannelData(c));
  return spans.map(([t0, t1]) => {
    // From the first sample (sfx.js plays 5 ms after `at`) to the end of the tail.
    const a = Math.floor((t0 + 0.004) * rate);
    const b = Math.min(buf.length, Math.ceil((t1 + 0.02) * rate));
    const shot = { length: b - a };
    BAKE_CHANNELS.forEach((name, c) => {
      const d = chans[c].subarray(a, b);
      let peak = 0;
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
      shot[name] = peak > 1e-5 ? d.slice() : null;
    });
    // Unpanned: one channel serves both sides.
    if (shot.sfxL && shot.sfxR) {
      let same = true;
      for (let i = 0; i < shot.length && same; i++) same = Math.abs(shot.sfxL[i] - shot.sfxR[i]) < 1e-6;
      if (same) shot.sfxR = null;
    }
    if (!shot.sfxL && shot.sfxR) [shot.sfxL, shot.sfxR] = [shot.sfxR, null];
    return shot;
  });
}

// One channel per buffer, as plain samples.
const pcm = (buffer) => (buffer ? buffer.getChannelData(0).slice() : new Float32Array(0));

export class CarMixer {
  // AudioWorklet needs a secure context (the Android build serves https://localhost).
  static supported(ac) {
    return typeof AudioWorkletNode !== 'undefined' && !!ac.audioWorklet && typeof OfflineAudioContext !== 'undefined';
  }

  constructor(mix) {
    this.mix = mix;
    this.ready = false;
    this.musicReady = false;
    this.failed = false;
    this.node = null;
    // The frame message, refilled every race frame.
    this.frame = new Float32Array(FRAME_LENGTH);
    this.events = 0;
    this.driving = false;
    this.lastFrame = 0;
    this.stats = { frames: 0, shots: 0, shotsQueued: 0 };
    let musicDone;
    // Resolves once the soundtrack is in the mixer (or could not be).
    this.musicLoaded = new Promise((resolve) => (musicDone = resolve));
    this.musicDone = musicDone;
    this.loaded = this.load().catch((e) => {
      musicDone();
      this.failed = true;
      this.ready = false;
      console.warn('car mixer unavailable, using the Web Audio graph:', e?.message ?? e);
    });
  }

  async load() {
    const { mix } = this;
    const ac = mix.ac;
    await ac.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ac, PROCESSOR, { numberOfInputs: 0, numberOfOutputs: OUTPUTS.length, outputChannelCount: OUTPUT_CHANNELS });
    node.onprocessorerror = () => {
      this.failed = true;
      this.ready = false;
      console.warn('car mixer stopped, using the Web Audio graph');
    };
    // The only connections it ever makes.
    OUTPUTS.forEach((bus, i) => node.connect(mix[bus], i));
    this.node = node;
    const answered = new Promise((resolve) => {
      node.port.onmessage = (e) => e.data?.type === 'ready' && resolve();
    });

    await mix.samples.ready;
    const shots = await bakeShots(mix);
    const loops = {};
    for (const name of LOOP_SAMPLES) loops[name] = pcm(mix.samples.get(name));
    const beds = { noise: pcm(mix.noise), pink: pcm(mix.pink), wobble: pcm(mix.wobble), seams: pcm(mix.seams) };
    const transfer = [...Object.values(loops), ...Object.values(beds)].map((d) => d.buffer);
    for (const s of shots) for (const k of BAKE_CHANNELS) if (s[k]) transfer.push(s[k].buffer);
    node.port.postMessage({ type: 'load', loops, ...beds, shots, musicTone: MUSIC_TONE }, transfer);
    await answered;
    if (this.failed) return this.musicDone();
    this.ready = true;
    this.loadMusic().then(this.musicDone);
  }

  async loadMusic() {
    try {
      const res = await fetch(BASE + SOUNDTRACK.file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await this.mix.ac.decodeAudioData(await res.arrayBuffer());
      // 16-bit in the mixer: half the memory of the decoded floats, far below what a phone
      // speaker can show.
      const int16 = (c) => {
        const d = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1));
        const o = new Int16Array(d.length);
        for (let i = 0; i < d.length; i++) o[i] = Math.max(-32767, Math.min(32767, Math.round(d[i] * 32767)));
        return o;
      };
      const left = int16(0);
      const right = int16(1);
      const { gain, start, drop, loopStart, loopEnd, rho, bar } = SOUNDTRACK;
      this.node.port.postMessage({ type: 'music-data', left, right, gain: (gain * 32768) / 32767, start, drop, loopStart, loopEnd, rho, bar }, [left.buffer, right.buffer]);
      this.musicReady = true;
    } catch (e) {
      console.warn('soundtrack unavailable for the car mixer:', e?.message ?? e);
    }
  }

  get live() {
    return this.ready && !this.failed;
  }

  post(m) {
    this.node.port.postMessage(m);
  }

  // A race one-shot by name (protocol.js SHOTS), `variant` picked at random if it has several.
  // During a race it rides on the next frame's message; otherwise it goes at once.
  shot(name, gain = 1, rate = 1) {
    const meta = SHOT_TABLE[SHOT_INDEX[name]];
    if (!meta) return;
    const id = SHOT_INDEX[name] + Math.floor(Math.random() * (meta.variants ?? 1));
    this.stats.shots++;
    if (this.driving && this.events < FRAME_EVENTS && performance.now() - this.lastFrame < 100) {
      const o = CTL.events + 1 + this.events * 3;
      this.frame[o] = id;
      this.frame[o + 1] = gain;
      this.frame[o + 2] = rate;
      this.events++;
      this.stats.shotsQueued++;
      return;
    }
    this.post({ type: 'shot', id, gain, rate });
  }

  // ---- The race engine ----

  startEngine() {
    this.driving = true;
    this.events = 0;
    this.post({ type: 'engine', on: true });
  }

  // The car's state for this frame (the controls object core/audio.js documents), with the
  // queued one-shots: the race's one message to the audio thread.
  sendFrame(c) {
    const f = this.frame;
    f[CTL.speedNorm] = c.speedNorm ?? 0;
    f[CTL.throttle] = c.throttle ?? 1;
    f[CTL.neutral] = c.neutral ? 1 : 0;
    f[CTL.airborne] = c.airborne ? 1 : 0;
    f[CTL.speed] = c.speed ?? 0;
    f[CTL.boost] = c.boost ?? 0;
    f[CTL.skid] = c.skid ?? 0;
    f[CTL.slip] = c.slip ?? 0;
    f[CTL.gravel] = c.gravel ?? 0;
    f[CTL.grass] = c.grass ?? 0;
    f[CTL.wood] = c.wood ?? 0;
    f[CTL.mps] = c.mps ?? 0;
    f[CTL.volume] = c.volume ?? 1;
    f[CTL.hold] = c.dt === 0 ? 1 : 0;
    f[CTL.events] = this.events;
    this.node.port.postMessage(f);
    this.events = 0;
    this.lastFrame = performance.now();
    this.stats.frames++;
  }

  stopEngine(fade = 0.25) {
    // Shots still queued go out with the engine's last frame.
    if (this.events) this.flush();
    this.driving = false;
    this.post({ type: 'engine', on: false, fade });
  }

  flush() {
    const f = this.frame;
    for (let i = 0; i < this.events; i++) {
      const o = CTL.events + 1 + i * 3;
      this.post({ type: 'shot', id: f[o], gain: f[o + 1], rate: f[o + 2] });
    }
    this.events = 0;
  }

  // Garage throttle stab or the race-start blip (audio/gearbox.js REVS).
  rev(kind) {
    this.post({ type: 'rev', kind });
  }

  rain(level, stop = false) {
    this.post({ type: 'rain', level, stop });
  }

  music(cmd) {
    this.post({ type: 'music', cmd });
  }
}
