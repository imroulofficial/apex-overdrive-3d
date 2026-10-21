import * as THREE from 'three';
import { mulberry32 } from '../race/noise.js';

// Procedural, tileable surface textures generated once at load (no downloads): asphalt with
// a matching normal + roughness map, coastal grass and layered cliff rock. Everything is
// computed into typed arrays, so it is deterministic and costs a few tens of ms.

// Periodic value noise: tiles every `period` lattice cells.
function periodicNoise(seed, period) {
  const rand = mulberry32(seed);
  const lattice = new Float32Array(period * period);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const at = (x, y) => lattice[(((y % period) + period) % period) * period + (((x % period) + period) % period)];
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// Tileable fBm over a w×h texture; `cells` is the base lattice size in texels.
function tileFbm(seed, w, h, cells, octaves = 4) {
  const layers = [];
  for (let o = 0; o < octaves; o++) {
    const c = Math.max(1, Math.round(cells / 2 ** o));
    layers.push({ noise: periodicNoise(seed + o * 101, Math.round(w / c)), c, ny: Math.round(h / c) / Math.round(w / c), amp: 0.5 ** o });
  }
  const total = layers.reduce((a, l) => a + l.amp, 0);
  return (x, y) => {
    let s = 0;
    for (const l of layers) s += l.noise(x / l.c, y / l.c) * l.amp;
    return s / total;
  };
}

function dataTexture(data, w, h, { srgb = false, repeat = true } = {}) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Height field → tangent-space normal map (wrapping at the edges).
function normalsFromHeight(height, w, h, strength) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = height[y * w + ((x - 1 + w) % w)];
      const r = height[y * w + ((x + 1) % w)];
      const u = height[((y - 1 + h) % h) * w + x];
      const d = height[((y + 1) % h) * w + x];
      const nx = (l - r) * strength;
      const ny = (d - u) * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      out[i] = (nx / len * 0.5 + 0.5) * 255;
      out[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      out[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Asphalt. u runs across the road (0 = left edge, 1 = right edge of a `widthM` road) and
// v along it (`tileM` metres per repeat). Painted edge lines and dashed lane dividers are
// part of the texture; tyre-polished wheel tracks are darker and smoother.
// ---------------------------------------------------------------------------
export function asphaltTextures({ widthM = 18, tileM = 40, lanes = 3, w = 512, h = 1024, maxAniso = 4 } = {}) {
  const rand = mulberry32(17);
  const blotch = tileFbm(23, w, h, 128, 4);
  const grain = tileFbm(29, w, h, 4, 2);
  const n = w * h;
  const albedo = new Uint8Array(n * 4);
  const rough = new Uint8Array(n * 4);
  const height = new Float32Array(n);
  const mPerU = widthM / w;
  const mPerV = tileM / h;

  // Crack network: random walks, mostly longitudinal, drawn into a mask.
  const crack = new Float32Array(n);
  for (let k = 0; k < 26; k++) {
    let x = rand() * w;
    let y = rand() * h;
    let a = Math.PI / 2 + (rand() - 0.5) * 1.2;
    const len = 60 + rand() * 220;
    for (let i = 0; i < len; i++) {
      a += (rand() - 0.5) * 0.5;
      x += Math.cos(a);
      y += Math.sin(a);
      const xi = ((Math.round(x) % w) + w) % w;
      const yi = ((Math.round(y) % h) + h) % h;
      crack[yi * w + xi] = Math.max(crack[yi * w + xi], 0.6 + rand() * 0.4);
    }
  }
  // Repair patches: darker, fresher rectangles of asphalt.
  const patches = Array.from({ length: 5 }, () => ({ x: rand() * w, y: rand() * h, pw: 30 + rand() * 90, ph: 60 + rand() * 220 }));

  const laneW = 1 / lanes;
  const line = (u, centre, halfWidthM) => {
    const d = Math.abs(u - centre) * widthM;
    return 1 - Math.min(1, Math.max(0, (d - halfWidthM) / 0.03));
  };

  for (let y = 0; y < h; y++) {
    const vm = y * mPerV;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const u = (x + 0.5) / w;
      const g = grain(x, y);
      const b = blotch(x, y);
      // Aggregate: speckled stones in a dark binder.
      const stone = rand();
      let v = 0.07 + (b - 0.5) * 0.03 + (g - 0.5) * 0.025 + (stone > 0.86 ? (stone - 0.86) * 0.55 : 0) - (stone < 0.05 ? 0.02 : 0);
      let r = 0.9;
      let hgt = g * 0.6 + (stone > 0.86 ? 0.5 : 0);
      for (const p of patches) {
        const dx = Math.abs(((x - p.x + w * 1.5) % w) - w / 2);
        const dy = Math.abs(((y - p.y + h * 1.5) % h) - h / 2);
        if (dx < p.pw / 2 && dy < p.ph / 2) {
          v -= 0.015;
          hgt += 0.15;
        }
      }
      // Wheel tracks: two per lane, polished and darkened by rubber.
      const inLane = (u % laneW) / laneW;
      const laneM = inLane * laneW * widthM;
      const laneWm = laneW * widthM;
      for (const t of [laneWm * 0.3, laneWm * 0.7]) {
        const k = Math.exp(-(((laneM - t) / 0.45) ** 2));
        v -= k * 0.018;
        r -= k * 0.16;
        hgt -= k * 0.25;
      }
      // Cracks (sealed with dark bitumen).
      const c = crack[i];
      if (c > 0) {
        v -= c * 0.035;
        hgt -= c * 0.8;
        r -= 0.2 * c;
      }
      // Paint: solid edge lines 0.35 m in from each edge, dashed lane dividers (4 m on, 6 m off).
      let paint = Math.max(line(u, 0.35 / widthM, 0.09), line(u, 1 - 0.35 / widthM, 0.09));
      for (let k = 1; k < lanes; k++) {
        if (vm % 10 < 4) paint = Math.max(paint, line(u, k * laneW, 0.07));
      }
      if (paint > 0) {
        const worn = Math.min(1, Math.max(0, 0.75 + (g - 0.5) * 1.6 - (stone > 0.9 ? 0.4 : 0)));
        const a = paint * worn;
        v = v + (0.72 - v) * a;
        r = r + (0.55 - r) * a;
        hgt += a * 0.6;
      }
      const lin = Math.max(0, Math.min(1, v));
      const s8 = Math.round(Math.pow(lin, 1 / 2.2) * 255);
      albedo[i * 4] = s8;
      albedo[i * 4 + 1] = s8;
      albedo[i * 4 + 2] = Math.min(255, s8 + 3);
      albedo[i * 4 + 3] = 255;
      rough[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, r)) * 255);
      rough[i * 4 + 3] = 255;
      height[i] = hgt;
    }
  }
  const map = dataTexture(albedo, w, h, { srgb: true });
  const normalMap = dataTexture(normalsFromHeight(height, w, h, 1.6), w, h);
  const roughnessMap = dataTexture(rough, w, h);
  for (const t of [map, normalMap, roughnessMap]) t.anisotropy = maxAniso;
  return { map, normalMap, roughnessMap };
}

// Coastal grass: blades of several greens over soil; alpha holds large-scale lush/dry variation.
export function grassTexture(size = 256) {
  const rand = mulberry32(41);
  const fine = tileFbm(43, size, size, 8, 3);
  const mid = tileFbm(47, size, size, 64, 3);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = (i / size) | 0;
    const f = fine(x, y);
    const m = mid(x, y);
    const blade = rand();
    const lush = Math.min(1, Math.max(0, (m - 0.3) * 2.2));
    // Linear-ish albedo, written as sRGB below.
    let r = 0.21 + (1 - lush) * 0.15 + (f - 0.5) * 0.09;
    let g = 0.33 + lush * 0.05 + (f - 0.5) * 0.11;
    let b = 0.11 + (f - 0.5) * 0.05;
    if (blade > 0.82) {
      const k = (blade - 0.82) * 2.5;
      r += k * 0.12;
      g += k * 0.16;
      b += k * 0.03;
    } else if (blade < 0.08) {
      r *= 0.6;
      g *= 0.6;
      b *= 0.6;
    }
    data[i * 4] = Math.round(Math.min(1, r) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, g) * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, b) * 255);
    data[i * 4 + 3] = Math.round(m * 255);
  }
  return dataTexture(data, size, size, { srgb: true });
}

// Sedimentary cliff rock: horizontal strata (v), cracks and lichen-free weathered greys.
export function rockTexture(size = 256) {
  const fine = tileFbm(53, size, size, 6, 3);
  const big = tileFbm(59, size, size, 48, 4);
  const strataNoise = periodicNoise(61, 8);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = (i / size) | 0;
    const f = fine(x, y);
    const bg = big(x, y);
    const warp = (bg - 0.5) * 28;
    const band = Math.sin(((y + warp) / size) * Math.PI * 2 * 7) * 0.5 + 0.5;
    const s = strataNoise(((y + warp) / size) * 8, 0.5);
    let v = 0.36 + (band - 0.5) * 0.1 + (s - 0.5) * 0.14 + (f - 0.5) * 0.16;
    const crevice = Math.max(0, 1 - Math.abs(band - 0.5) * 30) * 0.12;
    v -= crevice;
    const warm = 0.03 + (s - 0.5) * 0.04;
    data[i * 4] = Math.round(Math.max(0, Math.min(1, v + warm)) * 255);
    data[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, v)) * 255);
    data[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, v - warm * 0.8)) * 255);
    data[i * 4 + 3] = Math.round(f * 255);
  }
  return dataTexture(data, size, size, { srgb: true });
}
