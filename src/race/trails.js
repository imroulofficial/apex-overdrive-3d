import * as THREE from 'three';
import { VERGE } from './surface.js';

// Red-dirt redwood trails: open polylines that fork off the highway, cut across the inside of a
// bend and rejoin it (track def `trails`). A trail starts on the highway's centre line, as
// wide as the road, then narrows into a single-track dirt lane as it peels away, and widens
// again where it merges back, so the corridor a car can drive is always continuous.
//
// Distances along the trail are its own arc length `ls`; the race measures progress in highway
// metres, so a trail maps `ls` linearly onto the stretch of highway it replaces [s0, s1].
// Shorter than that stretch, it is a shortcut.
//
// Fork and merge zones: where trail and highway still overlap or sit side by side, a car may
// be on either. Inside a zone the car belongs to whichever centre line is closer (race/
// vehicle.js), and only the two outer walls of the Y hold it in.

const SPACING = 2;
export const TRAIL = {
  half: 5.2, // half width of the dirt lane, up to the log fences
  core: 3.6, // packed red dirt; beyond it, loose leaf litter and grass
  funnel: 46, // metres over which the corridor narrows from road width to the lane
  handle: 0.55, // Hermite handle length as a share of the highway stretch it replaces
  gap: 1.5, // clear ground needed between highway rail and trail fence to close the Y
  lateralAccel: 30, // m/s², AI cornering budget on dirt
};

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Trail {
  // spec: { id, name, from, to } as lap fractions of `track` (from < to, no wrap).
  constructor(track, spec) {
    this.track = track;
    this.spec = spec;
    this.id = spec.id;
    this.name = spec.name;
    const L = track.length;
    this.s0 = spec.from * L;
    this.s1 = spec.to * L;
    const A = track.frame(this.s0, {});
    const B = track.frame(this.s1, {});
    const yA = track.roadY(this.s0);
    const yB = track.roadY(this.s1);

    // Centre line: a Hermite curve leaving the highway along its tangent and rejoining it the
    // same way, with handles shorter than the bend's own, so it runs inside the bend (between
    // the highway and the straight chord) and never crosses the road.
    const raw = [];
    const span = this.s1 - this.s0;
    const K = (spec.handle ?? TRAIL.handle) * span;
    const steps = Math.ceil(span / 4);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      const x = h00 * A.x + h10 * K * A.tx + h01 * B.x + h11 * K * B.tx;
      const z = h00 * A.z + h10 * K * A.tz + h01 * B.z + h11 * K * B.tz;
      // Height: the highway's profile near the ends, a straight grade across the middle.
      const b = Math.sin(Math.PI * t) ** 2;
      const ry = track.roadY(this.s0 + span * t);
      raw.push(new THREE.Vector3(x, ry + (yA + (yB - yA) * t - ry) * b, z));
    }
    const curve = new THREE.CatmullRomCurve3(raw, false, 'centripetal');
    const n = Math.max(2, Math.round(curve.getLength() / SPACING) + 1);
    const pts = curve.getSpacedPoints(n - 1);
    this.n = n;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.s = new Float32Array(n);
    this.curv = new Float32Array(n);
    this.vmax = new Float32Array(n);
    this.sep = new Float32Array(n); // signed lateral offset from the highway centre line
    pts.forEach((p, i) => {
      this.px[i] = p.x;
      this.py[i] = p.y;
      this.pz[i] = p.z;
    });
    for (let i = 0; i < n; i++) {
      if (i > 0) this.s[i] = this.s[i - 1] + Math.hypot(this.px[i] - this.px[i - 1], this.py[i] - this.py[i - 1], this.pz[i] - this.pz[i - 1]);
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const dx = this.px[b] - this.px[a];
      const dz = this.pz[b] - this.pz[a];
      const len = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / len;
      this.tz[i] = dz / len;
    }
    this.length = this.s[n - 1];
    this.spacing = this.length / (n - 1);
    const w = 5;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - w);
      const b = Math.min(n - 1, i + w);
      let d = Math.atan2(this.tz[b], this.tx[b]) - Math.atan2(this.tz[a], this.tx[a]);
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.curv[i] = d / Math.max(1e-3, this.s[b] - this.s[a]);
      this.vmax[i] = Math.min(80, Math.sqrt(TRAIL.lateralAccel / Math.max(Math.abs(this.curv[i]), 1e-5)));
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let k = n - 2; k >= 0; k--) this.vmax[k] = Math.min(this.vmax[k], Math.sqrt(this.vmax[k + 1] ** 2 + 2 * 12 * this.spacing));
    }
    // Which side of the highway the trail runs, how far out, and where alongside.
    const pr = {};
    let hint = -1;
    const along = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      track.project(this.px[i], this.pz[i], hint, pr);
      hint = pr.i;
      this.sep[i] = pr.d;
      along[i] = pr.s;
    }
    this.side = Math.sign(this.sep[Math.floor(n / 2)]) || 1;

    // Fork zone ends once the trail's inner fence clears the highway rail; the merge zone
    // starts where it comes back within reach.
    const clear = track.halfWidth + VERGE + TRAIL.gap;
    const apart = (i) => Math.abs(this.sep[i]) - this.halfWidthAt(this.s[i]) >= clear;
    let i0 = 0;
    while (i0 < n - 1 && !apart(i0)) i0++;
    let i1 = n - 1;
    while (i1 > 0 && !apart(i1)) i1--;
    this.forkEnd = this.s[i0];
    this.mergeStart = Math.max(this.forkEnd, this.s[i1]);
    // The same two points in highway metres: the highway rail on the trail's side has a gap
    // from s0 to forkEndS and from mergeStartS to s1 (race/trackMeshes.js).
    this.forkEndS = along[i0];
    this.mergeStartS = Math.max(this.forkEndS, along[i1]);
  }

  // Corridor half width (to the fences): road plus verge where it meets the highway, the dirt
  // lane in between.
  halfWidthAt(ls) {
    const full = this.track.halfWidth + VERGE;
    const k = Math.min(smooth(0, TRAIL.funnel, ls), smooth(this.length, this.length - TRAIL.funnel, ls));
    return full + (TRAIL.half - full) * k;
  }

  wallLimitAt(ls) {
    return this.halfWidthAt(ls) - this.track.carHalfWidth;
  }

  // Highway metres for a distance along the trail, and back.
  mainS(ls) {
    return this.s0 + ((this.s1 - this.s0) * Math.min(this.length, Math.max(0, ls))) / this.length;
  }

  localS(s) {
    return ((s - this.s0) / (this.s1 - this.s0)) * this.length;
  }

  // Is highway position s (already wrapped) on this trail's stretch?
  covers(s) {
    return s >= this.s0 && s <= this.s1;
  }

  // In a fork or merge zone: s in highway metres.
  inZone(s) {
    if (!this.covers(s)) return false;
    const ls = this.localS(s);
    return ls <= this.forkEnd || ls >= this.mergeStart;
  }

  index(ls) {
    const l = Math.min(this.length, Math.max(0, ls));
    let i = Math.min(this.n - 2, Math.floor(l / this.spacing));
    while (i > 0 && this.s[i] > l) i--;
    while (i < this.n - 2 && this.s[i + 1] <= l) i++;
    // One result object, refilled (callers read it at once).
    const out = (this._ix ??= { i: 0, t: 0 });
    out.i = i;
    out.t = (l - this.s[i]) / (this.s[i + 1] - this.s[i] || 1);
    return out;
  }

  frame(ls, out = {}) {
    const { i, t } = this.index(ls);
    const j = i + 1;
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

  roadY(ls) {
    const { i, t } = this.index(ls);
    return this.py[i] + (this.py[i + 1] - this.py[i]) * t;
  }

  heightAt(ls) {
    return this.roadY(ls);
  }

  speedAt(ls) {
    return this.vmax[this.index(ls).i];
  }

  curvatureAt(ls) {
    return this.curv[this.index(ls).i];
  }

  // Projects world (x, z) onto the trail. Fills the same fields as Track.project, plus `ls`
  // (trail metres) and `trail`; `s` is in highway metres.
  project(x, z, hint, out) {
    const n = this.n;
    let best = 0;
    let bestD = Infinity;
    const scan = (a, b) => {
      for (let i = a; i <= b; i++) {
        const dx = this.px[i] - x;
        const dz = this.pz[i] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
    };
    if (hint >= 0 && hint < n) scan(Math.max(0, hint - 14), Math.min(n - 1, hint + 14));
    if (hint < 0 || hint >= n || bestD > 900) scan(0, n - 1);
    let a = Math.min(best, n - 2);
    let t = this.segT(a, x, z);
    if (t < 0 && a > 0) {
      a -= 1;
      t = this.segT(a, x, z);
    }
    const raw = t;
    t = Math.min(1, Math.max(0, t));
    const b = a + 1;
    const sx = this.px[b] - this.px[a];
    const sz = this.pz[b] - this.pz[a];
    const len = Math.hypot(sx, sz) || 1;
    const tx = sx / len;
    const tz = sz / len;
    const cx = this.px[a] + sx * t;
    const cz = this.pz[a] + sz * t;
    // Past either end the lane carries straight on, so overshooting the merge still reads as
    // ahead (callers hand the car back to the highway there).
    out.ls = this.s[a] + (this.s[b] - this.s[a]) * raw;
    out.i = a;
    out.s = this.mainS(out.ls);
    out.tx = tx;
    out.tz = tz;
    out.rx = -tz;
    out.rz = tx;
    out.d = (x - cx) * out.rx + (z - cz) * out.rz;
    out.roadY = this.py[a] + (this.py[b] - this.py[a]) * t;
    out.y = out.roadY;
    out.trail = this;
    return out;
  }

  segT(a, x, z) {
    const b = a + 1;
    const sx = this.px[b] - this.px[a];
    const sz = this.pz[b] - this.pz[a];
    return ((x - this.px[a]) * sx + (z - this.pz[a]) * sz) / (sx * sx + sz * sz || 1);
  }
}
