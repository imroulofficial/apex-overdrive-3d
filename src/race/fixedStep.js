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

  // How far back toward the pose before the last step the cars are drawn: 0..1 while the
  // simulation is ahead of the clock. While it is up to LAG behind (no step was due yet) the
  // value goes below 0 (down to -LAG / STEP) and the cars are drawn that much further along
  // their last step, so every frame shows the cars exactly where they are at that frame's
  // time (v76: clamping at 0 drew them up to 5 ms late on some frames, a visible jerk).
  get blend() {
    return Math.min(1, Math.max(-LAG / STEP, this.lead / STEP));
  }
}
