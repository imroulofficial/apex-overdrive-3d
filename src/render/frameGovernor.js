// Race frame pacing and dynamic resolution (v76).
//
// Pacing: the race runs at a steady TARGET rate instead of "as fast as it can". A frame is only
// started once a whole frame interval has passed (less a little slack for the vsync clock), so
// a phone that cannot hold 60 shows an even 30 (every second vsync) instead of a mix of 16 and
// 33 ms frames, and a 90/120 Hz screen gets an even 60.
//   - low-end GPU on Graphics: Auto -> 30 FPS from the start
//   - everything else -> 60 FPS, dropping to 30 for the rest of the race only if it still
//     misses frames at the lowest render scale for a few seconds
//
// Dynamic resolution: when frames come late, the 3D scene renders a little smaller (render
// scale 1 -> 0.7 in small steps) and the composite pass stretches it back to the screen, before
// frames are dropped; when there is room again it climbs back. Only a viewport and a uniform
// change (render/bloom.js setScale): no shader compile, no texture or render-target allocation.
//
// Pure logic (no DOM, no WebGL): tests drive it with made-up frame times.
export const GOVERNOR = {
  slackMs: 3, // a vsync tick arrives up to this early and still counts as a whole interval
  late: 1.25, // a frame interval over late x the target interval is a miss
  window: 0.5, // seconds between scale decisions
  down: 0.08, // scale step down after a window with too many misses
  up: 0.04, // scale step up after `calm` seconds without a miss
  minScale: 0.7,
  missShare: 0.15, // share of missed frames in a window that steps the scale down
  calm: 3,
  hold: 1, // seconds after a step down before the next decision
  give60: 3, // seconds of misses at the lowest scale before 60 -> 30
};

export class FrameGovernor {
  constructor({ target = 60, scale = 1 } = {}) {
    this.reset({ target, scale });
  }

  reset({ target = this.target ?? 60, scale = 1 } = {}) {
    this.target = target;
    this.scale = Math.max(GOVERNOR.minScale, Math.min(1, scale));
    this.lastRun = null;
    this.frames = 0;
    this.misses = 0;
    this.windowTime = 0;
    this.calmTime = 0;
    this.holdTime = 0;
    this.strained = 0; // seconds missing frames at the lowest scale
    this.changes = 0;
  }

  get intervalMs() {
    return 1000 / this.target;
  }

  // A requestAnimationFrame tick at `nowMs`: whether to run a frame now.
  shouldRun(nowMs) {
    if (this.lastRun === null || nowMs - this.lastRun >= this.intervalMs - GOVERNOR.slackMs || nowMs < this.lastRun) {
      this.lastRun = nowMs;
      return true;
    }
    return false;
  }

  // After a frame ran: `dtMs` since the frame before it ran. Returns true when the render scale
  // changed (the caller applies `scale`).
  sample(dtMs) {
    if (!(dtMs > 0) || dtMs > 1000) return false; // paused, a stall or the first frame
    const s = dtMs / 1000;
    this.frames += 1;
    const miss = dtMs > this.intervalMs * GOVERNOR.late;
    if (miss) this.misses += 1;
    this.windowTime += s;
    this.calmTime = miss ? 0 : this.calmTime + s;
    this.holdTime = Math.max(0, this.holdTime - s);
    if (this.windowTime < GOVERNOR.window) return false;
    const share = this.misses / Math.max(1, this.frames);
    const span = this.windowTime;
    this.windowTime = 0;
    this.frames = 0;
    this.misses = 0;
    if (share > GOVERNOR.missShare) {
      if (this.scale > GOVERNOR.minScale + 1e-6) {
        if (this.holdTime > 0) return false;
        this.scale = Math.max(GOVERNOR.minScale, +(this.scale - GOVERNOR.down).toFixed(3));
        this.holdTime = GOVERNOR.hold;
        this.changes += 1;
        return true;
      }
      this.strained += span;
      if (this.target > 30 && this.strained >= GOVERNOR.give60) {
        // Even the lowest scale misses 60: a steady 30 at full scale looks better than a
        // stuttering 40-50.
        this.target = 30;
        this.strained = 0;
        this.scale = 1;
        this.holdTime = GOVERNOR.hold;
        this.changes += 1;
        return true;
      }
      return false;
    }
    this.strained = 0;
    if (this.calmTime >= GOVERNOR.calm && this.scale < 1) {
      this.scale = Math.min(1, +(this.scale + GOVERNOR.up).toFixed(3));
      this.calmTime = 0;
      this.changes += 1;
      return true;
    }
    return false;
  }
}
