// Fixed-step physics clock (C10). Every physics step is exactly STEP long whatever the frame
// rate, up to MAX_STEPS a frame (real time down to 10 fps; below that the game slows rather
// than spiral). A step runs once the simulation is more than LAG behind the clock, so a 60 Hz
// screen with jittery frame times still steps once a frame. Between steps the cars are drawn
// part of the way back to their previous pose (`blend`), so motion stays smooth at any rate.
export const STEP = 1 / 60;
export const MAX_STEPS = 6;
export const LAG = 0.3 * STEP;

export class FixedStep {
  constructor() {
    this.lead = 0; // seconds the simulation is ahead of the clock (< 0: behind)
  }

  reset() {
    this.lead = 0;
  }

  // A frame of `dt` seconds went by: how many steps to run now.
  frame(dt) {
    this.lead -= dt;
    let n = 0;
    while (this.lead < -LAG && n < MAX_STEPS) {
      this.lead += STEP;
      n += 1;
    }
    if (this.lead < -LAG) this.lead = 0; // far behind (a stall): let the time go
    return n;
  }

  // How far back toward the pose before the last step the cars are drawn (0..1).
  get blend() {
    return Math.min(1, Math.max(0, this.lead / STEP));
  }
}
