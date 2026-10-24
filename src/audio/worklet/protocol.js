// What the main thread and the audio-thread car mixer (carMixer.processor.js) say to each
// other. Shared by both sides, so it holds no Web Audio and no DOM.

export const PROCESSOR = 'apex-car-mixer';

// The mixer's outputs, each wired once to a bus of the static graph (audio/mixer.js).
export const OUTPUTS = ['sfx', 'space', 'tyre', 'ambience', 'music'];
export const OUTPUT_CHANNELS = [2, 1, 1, 1, 2];
export const OUT = { sfx: 0, space: 1, tyre: 2, ambience: 3, music: 4 };

// One-shot priorities (as audio/voices.js): a dropped or cut-short low one is never missed.
export const PRIORITY = { detail: 0, impact: 1, cue: 2, key: 3 };
// One-shots sounding at once, on top of the continuous beds (engine, rain, music).
export const MAX_SHOTS = 8;

// The race one-shots, baked to PCM once at boot from the game's own sfx code (core/carMixer.js
// renders each entry `variants` times; random parts come out different every time) and
// played from the mixer's voice pool. duck: [music level, seconds] while it plays; drop: the
// soundtrack jumps from its intro into the full track at the next bar.
const { detail, impact, cue, key } = PRIORITY;
export const SHOTS = [
  { name: 'beep', priority: key },
  { name: 'go', priority: key, drop: true },
  { name: 'nitro', priority: key, duck: [0.55, 1.2] },
  { name: 'pulse', priority: key, duck: [0.4, 1.6] },
  { name: 'empty', priority: cue },
  { name: 'smash', priority: impact, variants: 3 },
  { name: 'smashBig', priority: impact, variants: 3 },
  { name: 'wall', priority: impact },
  { name: 'bump', priority: detail },
  { name: 'land', priority: impact },
  { name: 'chirp', priority: detail },
  { name: 'driftBank', priority: cue },
  { name: 'combo1', priority: cue },
  { name: 'combo2', priority: cue },
  { name: 'combo3', priority: cue },
  { name: 'perfect', priority: key, duck: [0.5, 0.9] },
  { name: 'shatterStall', priority: impact, variants: 2 },
  { name: 'shatterNeon', priority: impact, variants: 2 },
  { name: 'lap', priority: key },
  { name: 'finish', priority: key },
  { name: 'coin', priority: detail },
  { name: 'pylon', priority: cue },
  { name: 'checkpoint', priority: cue },
  { name: 'tick', priority: cue },
  { name: 'eliminated', priority: key, duck: [0.45, 1.4] },
  { name: 'eliminatedBig', priority: key, duck: [0.45, 1.4] },
  { name: 'thunderNear', priority: impact, variants: 2 },
  { name: 'thunderMid', priority: impact, variants: 2 },
  { name: 'thunderFar', priority: impact, variants: 2 },
  // The engine's own events, triggered on the audio thread by its gearbox.
  { name: 'bovSoft', priority: impact, strength: 0.45 },
  { name: 'bovMid', priority: impact, strength: 0.75 },
  { name: 'bovHard', priority: impact, strength: 1.05 },
  { name: 'pop1', priority: detail },
  { name: 'pop2', priority: detail },
];

// Index of each shot's first variant in the baked list (variants sit next to each other).
export const SHOT_INDEX = {};
export const SHOT_TABLE = [];
for (const s of SHOTS) {
  SHOT_INDEX[s.name] = SHOT_TABLE.length;
  for (let v = 0; v < (s.variants ?? 1); v++) SHOT_TABLE.push(s);
}

// The one message a race frame sends: the car's state and the one-shots fired since the last
// frame, in one preallocated Float32Array.
export const CTL = {
  speedNorm: 0,
  throttle: 1,
  neutral: 2,
  airborne: 3,
  speed: 4,
  boost: 5,
  skid: 6,
  slip: 7,
  gravel: 8,
  grass: 9,
  wood: 10,
  mps: 11,
  volume: 12,
  hold: 13,
  events: 14,
};
// Up to this many one-shots per frame, each [shot index, gain, rate].
export const FRAME_EVENTS = 8;
export const FRAME_LENGTH = CTL.events + 1 + FRAME_EVENTS * 3;
