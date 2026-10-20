import * as THREE from 'three';

// Race spline: a closed Catmull-Rom loop resampled every ~2 m. All driving queries (lap
// progress, lateral offset, road height, ramps, walls) run against these samples, which keeps
// the physics cheap and independent of render geometry.

const SAMPLE_SPACING = 2;
const LATERAL_ACCEL = 34; // m/s², the AI's cornering budget
const AI_BRAKE = 15; // m/s²
const MAX_PROFILE_SPEED = 90;

export class Track {
  constructor(def) {
    this.def = def;
    this.halfWidth = def.width / 2;
    this.shoulder = 1.4; // concrete shoulder beyond the edge line, still drivable
    this.fenceOffset = this.halfWidth + this.shoulder + 0.4;
    this.carHalfWidth = 1.0;
    this.wallLimit = this.halfWidth + this.shoulder - this.carHalfWidth;

    const curve = new THREE.CatmullRomCurve3(
      def.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      true,
      'centripetal'
    );
    const n = Math.round(curve.getLength() / SAMPLE_SPACING);
    const pts = curve.getSpacedPoints(n);
    pts.pop(); // closed: last point duplicates the first
    this.n = n;

    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.s = new Float32Array(n + 1);
    this.curv = new Float32Array(n);
    this.vmax = new Float32Array(n);

    pts.forEach((p, i) => {
      this.px[i] = p.x;
      this.py[i] = p.y;
      this.pz[i] = p.z;
    });
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.s[i + 1] = this.s[i] + Math.hypot(this.px[j] - this.px[i], this.py[j] - this.py[i], this.pz[j] - this.pz[i]);
      const a = (i - 1 + n) % n;
      const dx = this.px[j] - this.px[a];
      const dz = this.pz[j] - this.pz[a];
      const len = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / len;
      this.tz[i] = dz / len;
    }
    this.length = this.s[n];
    this.spacing = this.length / n;

    // Signed curvature (positive = turning right) over a ±12 m window.
    const w = 6;
    for (let i = 0; i < n; i++) {
      const a = (i - w + n) % n;
      const b = (i + w) % n;
      const angA = Math.atan2(this.tz[a], this.tx[a]);
      const angB = Math.atan2(this.tz[b], this.tx[b]);
      let d = angB - angA;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.curv[i] = d / (2 * w * this.spacing);
    }
    for (let i = 0; i < n; i++) {
      const k = Math.abs(this.curv[i]);
      this.vmax[i] = Math.min(MAX_PROFILE_SPEED, Math.sqrt(LATERAL_ACCEL / Math.max(k, 1e-5)));
    }
    // Braking passes so the profile slows down *before* each corner.
    for (let pass = 0; pass < 2; pass++) {
      for (let k = n - 1; k >= 0; k--) {
        const next = this.vmax[(k + 1) % n];
        this.vmax[k] = Math.min(this.vmax[k], Math.sqrt(next * next + 2 * AI_BRAKE * this.spacing));
      }
    }

    this.ramps = (def.ramps ?? []).map((r) => ({ ...r, s0: r.at * this.length }));
  }

  wrapS(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  // Forward distance from a to b along the loop, in (-L/2, L/2].
  delta(a, b) {
    let d = b - a;
    const L = this.length;
    if (d > L / 2) d -= L;
    else if (d <= -L / 2) d += L;
    return d;
  }

  index(s) {
    const ss = this.wrapS(s);
    let i = Math.min(this.n - 1, Math.floor(ss / this.spacing));
    while (i > 0 && this.s[i] > ss) i--;
    while (i < this.n - 1 && this.s[i + 1] <= ss) i++;
    return { i, t: (ss - this.s[i]) / (this.s[i + 1] - this.s[i] || 1) };
  }

  // Road frame at arc length s: centre, tangent and right vector (horizontal).
  frame(s, out = {}) {
    const { i, t } = this.index(s);
    const j = (i + 1) % this.n;
    out.x = this.px[i] + (this.px[j] - this.px[i]) * t;
    out.y = this.py[i] + (this.py[j] - this.py[i]) * t;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    let tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    let tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    out.tx = tx;
    out.tz = tz;
    out.rx = -tz;
    out.rz = tx;
    out.i = i;
    return out;
  }

  point(s, d, target = new THREE.Vector3()) {
    const f = this.frame(s, this._f || (this._f = {}));
    return target.set(f.x + f.rx * d, this.heightAt(s, d), f.z + f.rz * d);
  }

  curvatureAt(s) {
    return this.curv[this.index(s).i];
  }

  speedAt(s) {
    return this.vmax[this.index(s).i];
  }

  rampHeight(s, d) {
    for (const r of this.ramps) {
      if (d < r.from || d > r.to) continue;
      const ds = this.delta(r.s0, s);
      if (ds >= 0 && ds <= r.length) return r.height * (ds / r.length);
    }
    return 0;
  }

  roadY(s) {
    const { i, t } = this.index(s);
    const j = (i + 1) % this.n;
    return this.py[i] + (this.py[j] - this.py[i]) * t;
  }

  heightAt(s, d) {
    return this.roadY(s) + this.rampHeight(s, d);
  }

  // Projects a world (x, z) onto the track. `hint` is the previous sample index (or -1).
  project(x, z, hint, out) {
    const n = this.n;
    let best = 0;
    let bestD = Infinity;
    if (hint >= 0) {
      for (let k = -14; k <= 14; k++) {
        const i = (hint + k + n) % n;
        const dx = this.px[i] - x;
        const dz = this.pz[i] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
    }
    if (hint < 0 || bestD > 900) {
      for (let i = 0; i < n; i++) {
        const dx = this.px[i] - x;
        const dz = this.pz[i] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
    }
    // Choose the segment on the correct side of the nearest sample.
    let a = best;
    let b = (best + 1) % n;
    let t = this.segT(a, b, x, z);
    if (t < 0) {
      b = a;
      a = (a - 1 + n) % n;
      t = this.segT(a, b, x, z);
    }
    t = Math.min(1, Math.max(0, t));
    const sx = this.px[b] - this.px[a];
    const sz = this.pz[b] - this.pz[a];
    const len = Math.hypot(sx, sz) || 1;
    const tx = sx / len;
    const tz = sz / len;
    const cx = this.px[a] + sx * t;
    const cz = this.pz[a] + sz * t;
    const sb = b === 0 ? this.length : this.s[b];
    out.i = a;
    out.s = this.s[a] + (sb - this.s[a]) * t;
    out.tx = tx;
    out.tz = tz;
    out.rx = -tz;
    out.rz = tx;
    out.d = (x - cx) * out.rx + (z - cz) * out.rz;
    out.roadY = this.py[a] + (this.py[b] - this.py[a]) * t;
    out.y = out.roadY + this.rampHeight(out.s, out.d);
    return out;
  }

  segT(a, b, x, z) {
    const sx = this.px[b] - this.px[a];
    const sz = this.pz[b] - this.pz[a];
    return ((x - this.px[a]) * sx + (z - this.pz[a]) * sz) / (sx * sx + sz * sz || 1);
  }
}
