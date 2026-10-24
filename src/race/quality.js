// Auto quality for the race, decided between races only. Nothing about the renderer changes
// while a race runs: a new pixel ratio reallocates the canvas and every render target, and a
// new bloom level recompiles the composite shader, each a stall of a few hundred milliseconds
// on a phone. (The old in-race stepper counted its own stall as another slow second and set
// off one hitch after another.) A race that ran slow is noted; the next one starts a step
// down, applied before its countdown while the loading wipe still covers the screen.
export class RaceQuality {
  constructor() {
    this.seconds = 0; // racing seconds measured since the last step
    this.slow = 0; // of which under 50 FPS
    this.bloomCap = null; // 'low' or 'off' once bloom has been stepped down
  }

  // Once a second of racing, with that second's frame rate.
  sample(fps) {
    this.seconds += 1;
    if (fps < 50) this.slow += 1;
  }

  // The bloom level to race at, given the player's setting.
  bloomFor(level) {
    if (this.bloomCap === 'off') return 'off';
    if (this.bloomCap === 'low' && level === 'medium') return 'low';
    return level;
  }

  // Before a countdown: after a race that spent most of its time under 50 FPS, drop the wide
  // bloom halo first, then the render resolution (0.25 at a time), then bloom. Returns whether
  // anything changed.
  step(renderer, bloom, onResize) {
    const slow = this.seconds >= 10 && this.slow >= this.seconds * 0.5;
    this.seconds = 0;
    this.slow = 0;
    if (!slow) return false;
    const pr = renderer.getPixelRatio();
    if (bloom.level === 'medium') bloom.setLevel((this.bloomCap = 'low'));
    else if (pr > 1) {
      renderer.setPixelRatio(Math.max(1, pr - 0.25));
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      onResize();
    } else if (bloom.enabled) bloom.setLevel((this.bloomCap = 'off'));
    else return false;
    return true;
  }
}
