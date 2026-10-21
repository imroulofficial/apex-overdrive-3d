// Drift chaining (blueprint §2.2). Linking drifts back to back, or holding one long drift,
// climbs the combo multiplier x1.0 → x1.5 → x2.0 → x3.0. Each drift banks its points at the
// multiplier it reached; the chain total pays out once no new drift starts within the link
// window. Every step up also tops up the nitro bar.

export const COMBO = {
  multipliers: [1, 1.5, 2, 3],
  nitroBonus: [0, 6, 9, 14], // nitro (of 100) granted on reaching each level
  linkWindow: 1.6, // seconds after a drift ends to start the next one and keep the chain
  holdStep: 2.5, // seconds of one unbroken drift that also count as a link
  minPoints: 40, // a drift worth less than this (a twitch) neither banks nor links
};
const TOP = COMBO.multipliers.length - 1;

export class DriftChain {
  constructor() {
    this.reset();
  }

  reset() {
    this.level = 0;
    this.links = 0; // drifts banked in this chain
    this.total = 0; // banked points in this chain, multipliers applied
    this.active = false;
    this.drifting = false;
    this.gap = 0; // seconds since the last drift ended
    this.hold = 0;
  }

  get multiplier() {
    return COMBO.multipliers[this.level];
  }

  // Seconds left to link the next drift (0..1 of the window), or 0 when not waiting.
  get linkLeft() {
    return this.active && !this.drifting ? Math.max(0, 1 - this.gap / COMBO.linkWindow) : 0;
  }

  // A drift started. Returns a level-up event when it linked onto a live chain.
  start() {
    this.drifting = true;
    this.hold = 0;
    if (this.active && this.links > 0 && this.gap <= COMBO.linkWindow) return this.stepUp();
    this.level = 0;
    this.links = 0;
    this.total = 0;
    this.active = true;
    return null;
  }

  stepUp() {
    if (this.level >= TOP) return null;
    this.level += 1;
    return { type: 'level', level: this.level, multiplier: this.multiplier, nitro: COMBO.nitroBonus[this.level] };
  }

  // Per frame. Returns a level-up event (long drift) or the finished chain once the link
  // window runs out: { type: 'chain', total, links, multiplier }.
  update(dt) {
    if (!this.active) return null;
    if (this.drifting) {
      this.hold += dt;
      if (this.hold >= COMBO.holdStep) {
        this.hold -= COMBO.holdStep;
        return this.stepUp();
      }
      return null;
    }
    this.gap += dt;
    return this.gap > COMBO.linkWindow ? this.finish() : null;
  }

  // The drift ended with `points` raw drift score. Returns { type: 'bank', points, multiplier }.
  end(points) {
    if (!this.drifting) return null;
    this.drifting = false;
    this.gap = 0;
    if (points < COMBO.minPoints) {
      if (this.links === 0) this.reset();
      return null;
    }
    const banked = Math.round(points * this.multiplier);
    this.total += banked;
    this.links += 1;
    return { type: 'bank', points: banked, multiplier: this.multiplier };
  }

  // Ends the chain now (a hard crash, the finish line). Returns the chain or null.
  finish() {
    if (!this.active) return null;
    const out = this.links > 0 ? { type: 'chain', total: this.total, links: this.links, multiplier: this.multiplier } : null;
    this.reset();
    return out;
  }
}
