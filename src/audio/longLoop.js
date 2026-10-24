// Long loops, baked once when the samples are decoded. The recorded loops are short (0.45-2 s:
// a steady-pitch slice of a real engine is only that long), and a short loop played for a
// whole race repeats its one seam and its one pattern every 1-2 s, which the ear hears as a
// pulse or a stumble on a steady note. Each one is rebuilt here into a 12 s buffer by
// overlap-adding grains taken from random places in the loop: every splice is placed where the
// two waveforms line up best (the cross-correlation peak in a small search window, as WSOLA
// time-stretching does), and the crossfade keeps the power constant for however alike the
// two sides are, so neither a +3 dB bump (in-phase material under an equal-power fade) nor a
// dip (out-of-phase under a linear one) marks it. The splices fall at irregular times and the
// 12 s buffer closes on itself the same way, so the sound has no period a player can pick out.
// Pitch is untouched: grains are copied, never resampled.

export const LONG_LOOP_SECONDS = 12;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Normalized correlation of a[ai…ai+n) with b[bi…bi+n) (b read circularly), every `step`th sample.
function correlate(a, ai, b, bi, n, step) {
  const m = b.length;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i += step) {
    const x = a[ai + i];
    const y = b[(bi + i) % m];
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

// The offset in [from - range, from + range] whose next `n` samples of `src` best continue
// `tail` (coarse pass every 4th lag, then a fine pass around the best).
function bestSplice(tail, src, from, n, range) {
  const m = src.length;
  let best = from;
  let bestC = -2;
  for (let d = -range; d <= range; d += 4) {
    const c = correlate(tail, 0, src, (from + d + m * 4) % m, n, 2);
    if (c > bestC) [bestC, best] = [c, from + d];
  }
  const coarse = best;
  for (let d = -3; d <= 3; d++) {
    const c = correlate(tail, 0, src, (coarse + d + m * 4) % m, n, 1);
    if (c > bestC) [bestC, best] = [c, coarse + d];
  }
  return { at: (best + m * 4) % m, corr: bestC };
}

// Crossfade gains at position t (0..1) of a splice whose sides correlate by `rho`: linear
// shapes, normalized so a² + b² + 2ρab = 1 (constant power whatever the correlation).
function fadeGains(t, rho) {
  const u = 1 - t;
  const v = t;
  const p = Math.sqrt(Math.max(1e-6, u * u + v * v + 2 * Math.max(-0.5, rho) * u * v));
  return [u / p, v / p];
}

// src: one channel of a seamless loop. Returns a seamless loop about `seconds` long.
export function bakeLongLoop(src, rate, { seconds = LONG_LOOP_SECONDS, seed = 1 } = {}) {
  const m = src.length;
  const rand = mulberry32(seed);
  // Grains a third to two thirds of the loop (0.12-0.6 s), splices 30 ms (shorter on tiny
  // loops), searched over ±12 ms: more than a period of anything this game loops.
  const xf = Math.max(32, Math.min(Math.round(0.03 * rate), Math.floor(m / 8)));
  const range = Math.min(Math.round(0.012 * rate), Math.floor(m / 4));
  const grainMin = Math.max(xf * 3, Math.min(Math.round(0.12 * rate), Math.floor(m / 3)));
  const grainMax = Math.max(grainMin + 1, Math.min(Math.round(0.6 * rate), Math.floor((m * 2) / 3)));
  const want = Math.round(seconds * rate);
  // Room for the closing search past the end.
  const out = new Float32Array(want + grainMax + range * 2 + xf * 2);
  const tail = new Float32Array(xf);
  let read = Math.floor(rand() * m);
  let w = 0;
  // First grain straight in.
  let len = grainMin + Math.floor(rand() * (grainMax - grainMin));
  for (let i = 0; i < len; i++) out[w++] = src[(read + i) % m];
  read = (read + len) % m;
  while (w < want + range + xf) {
    // What the source would have played next (the old side of the splice).
    for (let i = 0; i < xf; i++) tail[i] = src[(read + i) % m];
    // Jump somewhere else in the loop, at least a grain away, lined up with that tail.
    const jump = (read + grainMin + Math.floor(rand() * Math.max(1, m - 2 * grainMin))) % m;
    const { at, corr } = bestSplice(tail, src, jump, xf, range);
    for (let i = 0; i < xf; i++) {
      const [a, b] = fadeGains((i + 0.5) / xf, corr);
      out[w + i] = tail[i] * a + src[(at + i) % m] * b;
    }
    len = grainMin + Math.floor(rand() * (grainMax - grainMin));
    for (let i = xf; i < len; i++) out[w + i] = src[(at + i) % m];
    w += len;
    read = (at + len) % m;
  }
  // Close the loop: find the length near `want` whose continuation best matches the start,
  // then crossfade that continuation over the first samples.
  let end = want;
  let bestC = -2;
  for (let d = -range; d <= range; d += 2) {
    const c = correlate(out, want + d, out, 0, xf, 2);
    if (c > bestC) [bestC, end] = [c, want + d];
  }
  const loop = out.slice(0, end);
  for (let i = 0; i < xf; i++) {
    const [a, b] = fadeGains((i + 0.5) / xf, bestC);
    loop[i] = out[end + i] * a + out[i] * b;
  }
  return loop;
}
