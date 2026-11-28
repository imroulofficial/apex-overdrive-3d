// Door windows in the driver view (versionCode 75): the race HUD's window button lowers and
// raises the driver's and passenger's windows of a car that has them (extras.apex.windows).
// Race state only: every race starts with them closed and nothing is saved.

// Seconds the windows take to go fully down or up.
export const WINDOW_TIME = 1.1;

export class DoorWindows {
  constructor() {
    this.target = 0; // 0 closed, 1 open
    this.level = 0; // where they are now (linear)
  }

  get down() {
    return this.target > 0.5;
  }

  // The button: only in the driver view of a car with windows.
  toggle({ cockpitView, available }) {
    if (!cockpitView || !available) return false;
    this.target = this.down ? 0 : 1;
    return true;
  }

  // Straight to `k` (race start, car change).
  reset(k = 0) {
    this.target = this.level = k;
    return k;
  }

  // Moves toward the target; returns the eased pose (0..1) to show, or null when still.
  step(dt) {
    if (this.level === this.target) return null;
    const d = dt / WINDOW_TIME;
    this.level = this.target > this.level ? Math.min(this.target, this.level + d) : Math.max(this.target, this.level - d);
    const k = this.level;
    return k * k * (3 - 2 * k);
  }
}
