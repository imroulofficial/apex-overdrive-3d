// Splits a single-mesh model (one welded surface and one baked colour texture, the way AI
// model generators export cars) into the parts the game's car conventions need: four wheels
// that can spin and steer, a paint shell the paint shop can recolour, head / tail lenses and
// the rest of the body. Used by optimize.mjs for manifest entries with `segment`.
//
// The source must have its nose on +Z, roof on +Y and tyres resting on y = 0 (what the
// generators produce). The output keeps those axes; normalise() in optimize.mjs then turns
// the nose to +X from the wheel positions like for any other model.
//
// Wheels are found by their tread: every tread triangle faces away from its axle, so with the
// tyre standing on the ground (centre height = radius) its position and normal give one vote
// for the axle position and radius. The four strongest votes are the four wheels, and every
// triangle inside each tyre's cylinder (tyre, rim, disc, caliper) becomes that wheel.
//
// `segment` manifest options:
//   paint   { hue, hueTol, minSat, maxSat, minVal, maxVal } texture colours that are paint
//           (hue in degrees, saturation / value 0-1); everything else keeps its colour
//   head / tail  false for no lens, or { x: [lo, hi], y: [lo, hi], any } to only look in a
//           box (x = |x| / half width, y = height fraction); `any` skips the colour test
//           (a red car's tail lamps look like its paint), 'unpainted' takes anything but paint
//   wheelPad  extra width added to each side of the tread when cutting the wheel (fraction
//           of the tread width, default 0.15)

import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';

const WHEELS = ['FL', 'FR', 'RL', 'RR'];
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function hsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max > 0 ? d / max : 0, max];
}

export function isPaint(rule, r, g, b) {
  if (!rule) return false;
  const [h, s, v] = hsv(r, g, b);
  if (rule.hue !== undefined) {
    const dh = Math.abs(((h - rule.hue + 540) % 360) - 180);
    if (dh > (rule.hueTol ?? 20)) return false;
  }
  return s >= (rule.minSat ?? 0) && s <= (rule.maxSat ?? 1) && v >= (rule.minVal ?? 0) && v <= (rule.maxVal ?? 1);
}

// Texture sampler over a slightly blurred copy (a texel of noise should not flip a triangle).
async function sampler(image) {
  const { data, info } = await sharp(Buffer.from(image)).removeAlpha().blur(1.2).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  return (u, v, out) => {
    const x = Math.min(w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * h)));
    const i = (y * w + x) * 3;
    out[0] = data[i] / 255;
    out[1] = data[i + 1] / 255;
    out[2] = data[i + 2] / 255;
    return out;
  };
}

// Finds the four wheels: { FL: { z, r, x0, x1 }, ... } (source axes: nose +Z, left +X).
export function findTreads(tri, bounds) {
  const { count, cx, cy, cz, nx, ny, nz, area } = tri;
  const length = bounds.max[2] - bounds.min[2];
  const height = bounds.max[1] - bounds.min[1];
  const width = bounds.max[0] - bounds.min[0];
  const zBin = length / 400;
  const rBin = length / 800;
  const rMin = length * 0.04;
  const rMax = length * 0.14;
  const rBins = Math.ceil((rMax - rMin) / rBin) + 1;
  const zBins = 401;
  // One histogram per side (x > 0 is the car's left) and axle (front z > 0).
  const hist = WHEELS.map(() => new Float64Array(zBins * rBins));
  const key = (x, z) => (z > 0 ? 0 : 2) + (x > 0 ? 0 : 1);
  for (let t = 0; t < count; t++) {
    if (cy[t] > height * 0.6 || Math.abs(nx[t]) > 0.4) continue;
    const l = Math.hypot(ny[t], nz[t]);
    const ey = ny[t] / l;
    const ez = nz[t] / l;
    if (ey < -0.9) continue;
    const r = cy[t] / (1 + ey);
    if (r < rMin || r > rMax) continue;
    const zc = cz[t] - r * ez;
    const zi = Math.round((zc - bounds.min[2]) / zBin);
    const ri = Math.round((r - rMin) / rBin);
    if (zi < 0 || zi >= zBins) continue;
    hist[key(cx[t], zc)][zi * rBins + ri] += area[t];
  }
  const found = {};
  WHEELS.forEach((name, k) => {
    const h = hist[k];
    let best = -1;
    let at = 0;
    for (let zi = 1; zi < zBins - 1; zi++) {
      for (let ri = 1; ri < rBins - 1; ri++) {
        let s = 0;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) s += h[(zi + a) * rBins + ri + b];
        if (s > best) [best, at] = [s, zi * rBins + ri];
      }
    }
    const zi = Math.floor(at / rBins);
    const ri = at % rBins;
    found[name] = { z: bounds.min[2] + zi * zBin, r: rMin + ri * rBin, score: best };
  });
  // Tread width: triangles on the found circle facing away from the axle.
  for (const name of WHEELS) {
    const w = found[name];
    const left = name.endsWith('L');
    const xs = [];
    for (let t = 0; t < count; t++) {
      if ((cx[t] > 0) !== left || Math.abs(nx[t]) > 0.4) continue;
      const dy = cy[t] - w.r;
      const dz = cz[t] - w.z;
      const d = Math.hypot(dy, dz);
      if (Math.abs(d - w.r) > w.r * 0.08) continue;
      const l = Math.hypot(ny[t], nz[t]);
      if ((ny[t] * dy + nz[t] * dz) / (l * d) < 0.85) continue;
      xs.push([cx[t], area[t]]);
    }
    // The tread is the dense band of x near the outside of the car; anything else on the
    // circle (a nose cone, a sill) is further in and separated by an empty gap.
    const bin = width / 200;
    const hist = new Map();
    for (const [x, a] of xs) {
      const b = Math.round(x / bin);
      hist.set(b, (hist.get(b) ?? 0) + a);
    }
    let peak = null;
    for (const [b, a] of hist) {
      if (Math.abs(b * bin) < width * 0.25) continue;
      if (!peak || a > hist.get(peak)) peak = b;
    }
    if (peak === null) throw new Error(`segment: no tread found for wheel ${name}`);
    const floor = hist.get(peak) * 0.08;
    const dense = (b) => (hist.get(b) ?? 0) + Math.max(hist.get(b - 1) ?? 0, hist.get(b + 1) ?? 0) * 0.5 > floor;
    let lo = peak;
    let hi = peak;
    while (dense(lo - 1)) lo--;
    while (dense(hi + 1)) hi++;
    w.x0 = (lo - 0.5) * bin;
    w.x1 = (hi + 0.5) * bin;
  }
  return found;
}

function triangleData(pos, nrm, idx) {
  const count = idx.length / 3;
  const f = () => new Float32Array(count);
  const tri = { count, cx: f(), cy: f(), cz: f(), nx: f(), ny: f(), nz: f(), area: f() };
  for (let t = 0; t < count; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    tri.cx[t] = (pos[a] + pos[b] + pos[c]) / 3;
    tri.cy[t] = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3;
    tri.cz[t] = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z);
    tri.area[t] = l / 2;
    // Face normal, flipped toward the vertex normals (generators do not always wind outward).
    if (nrm) {
      const sx = nrm[a] + nrm[b] + nrm[c], sy = nrm[a + 1] + nrm[b + 1] + nrm[c + 1], sz = nrm[a + 2] + nrm[b + 2] + nrm[c + 2];
      if (x * sx + y * sy + z * sz < 0) [x, y, z] = [-x, -y, -z];
    }
    tri.nx[t] = l ? x / l : 0;
    tri.ny[t] = l ? y / l : 1;
    tri.nz[t] = l ? z / l : 0;
  }
  return tri;
}

// Labels: 0 body, 1 paint, 2 headlight, 3 taillight, 4-7 wheels FL FR RL RR.
export const LABELS = ['body', 'paint', 'headlight', 'taillight', ...WHEELS.map((k) => `wheel_${k}`)];

// `known` = { wheels, bounds } from an earlier pass skips wheel finding (the body-only pass).
export async function classify(pos, nrm, uv, idx, image, options = {}, known = null) {
  const tri = triangleData(pos, nrm, idx);
  const bounds = known?.bounds ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  if (!known) {
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        bounds.min[k] = Math.min(bounds.min[k], pos[i + k]);
        bounds.max[k] = Math.max(bounds.max[k], pos[i + k]);
      }
    }
  }
  const wheels = known?.wheels ?? findTreads(tri, bounds);
  const sample = await sampler(image);
  const label = new Uint8Array(tri.count);
  const col = [0, 0, 0];
  const acc = [0, 0, 0];
  const length = bounds.max[2] - bounds.min[2];
  const halfWidth = (bounds.max[0] - bounds.min[0]) / 2;
  const height = bounds.max[1] - bounds.min[1];
  // Head / tail lens rule: false = none, else an optional box (x = |x| / half width,
  // y = height fraction) and the colour test unless `any`.
  const lens = (rule, t, colour) => {
    if (rule === false) return false;
    if (rule?.x && (Math.abs(tri.cx[t]) / halfWidth < rule.x[0] || Math.abs(tri.cx[t]) / halfWidth > rule.x[1])) return false;
    if (rule?.y && (tri.cy[t] / height < rule.y[0] || tri.cy[t] / height > rule.y[1])) return false;
    // `any: 'unpainted'` takes every colour except the paint's.
    return rule?.any === 'unpainted' ? !isPaint(options.paint, ...acc) : rule?.any || colour();
  };
  let paintLum = 0;
  let paintArea = 0;
  for (let t = 0; t < tri.count; t++) {
    // Wheels first: everything inside a tyre's cylinder turns with it.
    let wheel = -1;
    if (!known) WHEELS.forEach((name, k) => {
      const w = wheels[name];
      const pad = (w.x1 - w.x0) * (options.wheelPad ?? 0.15);
      if (tri.cx[t] < w.x0 - pad || tri.cx[t] > w.x1 + pad) return;
      if (Math.hypot(tri.cy[t] - w.r, tri.cz[t] - w.z) < w.r * 1.02) wheel = k;
    });
    if (wheel >= 0) {
      label[t] = 4 + wheel;
      continue;
    }
    // Colour: average of the three corners and the centre.
    acc[0] = acc[1] = acc[2] = 0;
    const ia = idx[t * 3], ib = idx[t * 3 + 1], ic = idx[t * 3 + 2];
    const us = [uv[ia * 2], uv[ib * 2], uv[ic * 2]];
    const vs = [uv[ia * 2 + 1], uv[ib * 2 + 1], uv[ic * 2 + 1]];
    const pts = [[us[0], vs[0]], [us[1], vs[1]], [us[2], vs[2]], [(us[0] + us[1] + us[2]) / 3, (vs[0] + vs[1] + vs[2]) / 3]];
    for (const [u, v] of pts) {
      sample(u, v, col);
      acc[0] += col[0] / 4;
      acc[1] += col[1] / 4;
      acc[2] += col[2] / 4;
    }
    const [r, g, b] = acc;
    const along = (tri.cz[t] - bounds.min[2]) / length; // 0 tail, 1 nose
    const [, s, v] = hsv(r, g, b);
    if (lens(options.head, t, () => v > 0.62 && s < 0.25) && along > 0.86 && tri.nz[t] > 0.3 && tri.cy[t] > 0.04 * length) {
      label[t] = 2;
      continue;
    }
    if (lens(options.tail, t, () => r > 0.4 && r > g * 2.2 && r > b * 2.2) && along < 0.14 && tri.nz[t] < -0.3) {
      label[t] = 3;
      continue;
    }
    if (isPaint(options.paint, r, g, b)) {
      label[t] = 1;
      paintLum += (0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)) * tri.area[t];
      paintArea += tri.area[t];
    }
  }
  return { label, wheels, bounds, factoryLum: paintArea ? paintLum / paintArea : 0.5 };
}

// One vertex per distinct position + UV, triangles wound outward. Generators split vertices
// on normals all over the surface, which leaves the simplifier stuck at ~100k triangles.
function weldSurface(prim) {
  const P = prim.getAttribute('POSITION').getArray();
  const N = prim.getAttribute('NORMAL')?.getArray();
  const T = prim.getAttribute('TEXCOORD_0').getArray();
  const I = prim.getIndices().getArray();
  const map = new Map();
  const remap = new Uint32Array(P.length / 3);
  const pos = [];
  const uv = [];
  for (let v = 0; v < remap.length; v++) {
    const key = `${P[v * 3]},${P[v * 3 + 1]},${P[v * 3 + 2]},${T[v * 2]},${T[v * 2 + 1]}`;
    let o = map.get(key);
    if (o === undefined) {
      o = map.size;
      map.set(key, o);
      pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      uv.push(T[v * 2], T[v * 2 + 1]);
    }
    remap[v] = o;
  }
  // Winding: flip every triangle if most of them disagree with the exported normals.
  let agree = 0;
  if (N) {
    for (let f = 0; f < I.length; f += 3) {
      const [a, b, c] = [I[f] * 3, I[f + 1] * 3, I[f + 2] * 3];
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const d = (uy * vz - uz * vy) * (N[a] + N[b] + N[c]) + (uz * vx - ux * vz) * (N[a + 1] + N[b + 1] + N[c + 1]) + (ux * vy - uy * vx) * (N[a + 2] + N[b + 2] + N[c + 2]);
      agree += d >= 0 ? 1 : -1;
    }
  }
  const idx = new Uint32Array(I.length);
  for (let f = 0; f < I.length; f += 3) {
    idx[f] = remap[I[f]];
    idx[f + 1] = remap[agree < 0 ? I[f + 2] : I[f + 1]];
    idx[f + 2] = remap[agree < 0 ? I[f + 1] : I[f + 2]];
  }
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx };
}

// Area-weighted vertex normals shared by every vertex at the same position, so UV seams do
// not show as shading lines.
function smoothNormals(pos, idx) {
  const byPos = new Map();
  const group = new Uint32Array(pos.length / 3);
  for (let v = 0; v < group.length; v++) {
    const key = `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}`;
    let g = byPos.get(key);
    if (g === undefined) byPos.set(key, (g = byPos.size));
    group[v] = g;
  }
  const acc = new Float64Array(byPos.size * 3);
  for (let f = 0; f < idx.length; f += 3) {
    const [a, b, c] = [idx[f] * 3, idx[f + 1] * 3, idx[f + 2] * 3];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const v of [idx[f], idx[f + 1], idx[f + 2]]) for (let k = 0; k < 3; k++) acc[group[v] * 3 + k] += n[k];
  }
  const out = new Float32Array(pos.length);
  for (let v = 0; v < group.length; v++) {
    const g = group[v] * 3;
    const l = Math.hypot(acc[g], acc[g + 1], acc[g + 2]) || 1;
    out[v * 3] = acc[g] / l;
    out[v * 3 + 1] = acc[g + 1] / l;
    out[v * 3 + 2] = acc[g + 2] / l;
  }
  return out;
}

// Rebuilds the document: the source mesh node becomes a "body" node (body / paint / lens
// primitives) plus four wheel nodes whose origin is their axle.
export async function segmentDocument(doc, options = {}, budget = {}) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const meshNodes = root.listNodes().filter((n) => n.getMesh());
  if (meshNodes.length !== 1 || meshNodes[0].getMesh().listPrimitives().length !== 1) throw new Error('segment: expected one mesh with one primitive');
  const node = meshNodes[0];
  const prim = node.getMesh().listPrimitives()[0];
  const srcMat = prim.getMaterial();
  // Generators export the baked colour as an emissive texture over a black base.
  const texture = srcMat.getBaseColorTexture() ?? srcMat.getEmissiveTexture();
  if (!texture) throw new Error('segment: no colour texture');
  const welded = weldSurface(prim);
  const { pos, uv } = welded;
  let { idx } = welded;
  let nrm = smoothNormals(pos, idx);
  const image = texture.getImage();
  // Pass 1 finds the wheels on the full surface. Body and wheels are then simplified apart
  // (a wheel is its own mesh, so nothing can crack between them), and pass 2 sorts the
  // simplified body's triangles into paint, lenses and the rest.
  const first = await classify(pos, nrm, uv, idx, image, options);
  const { wheels, bounds } = first;
  const pick = (test) => {
    const out = [];
    for (let f = 0; f < first.label.length; f++) if (test(first.label[f])) out.push(idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]);
    return new Uint32Array(out);
  };
  // Plain edge collapse: with the generator's split normals gone (weldSurface), only real UV
  // seams are left to protect and the budgets are reached at a small error.
  const reduce = (list, target) => {
    if (!target || list.length / 3 <= target) return list;
    let out = list;
    const maxError = budget.maxError ?? 0.02;
    for (let error = 0.001; ; error = Math.min(maxError, error * 1.6)) {
      [out] = MeshoptSimplifier.simplify(list, pos, 3, target * 3, error, []);
      if (out.length / 3 <= target || error >= maxError) break;
    }
    if (out.length / 3 > target * 1.05) out = MeshoptSimplifier.simplifySloppy(list, pos, 3, null, target * 3, 1)[0];
    return out;
  };
  const bodyIdx = reduce(pick((l) => l < 4), budget.bodyTris);
  const wheelLists = WHEELS.map((_, k) => reduce(pick((l) => l === 4 + k), budget.wheelTris));
  // Normals of what is left, smoothed across UV seams (shared positions).
  const kept = new Uint32Array(bodyIdx.length + wheelLists.reduce((n, l) => n + l.length, 0));
  let at = 0;
  for (const l of [bodyIdx, ...wheelLists]) {
    kept.set(l, at);
    at += l.length;
  }
  nrm = smoothNormals(pos, kept);
  idx = null;
  const second = await classify(pos, nrm, uv, bodyIdx, image, options, { wheels, bounds });
  const parts = [[0], [1], [2], [3]].map(([l]) => ({ list: bodyIdx, label: second.label, keep: l }));
  const factoryLum = second.factoryLum;
  const counts = [...parts.map((p) => p.label.reduce((n, x) => n + (x === p.keep), 0)), ...wheelLists.map((l) => l.length / 3)];

  const buffer = root.listBuffers()[0];
  const material = (name, roughness, metalness = 0) =>
    doc.createMaterial(name).setBaseColorTexture(texture).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(roughness).setMetallicFactor(metalness);
  const mats = [
    material('Body', 0.5),
    material('CarPaint', 0.3).setExtras({ factoryLum }),
    material('headlight_lens', 0.1),
    material('taillight_lens', 0.15),
    ...WHEELS.map(() => null),
  ];
  const wheelMat = material('Wheel', 0.7);

  const build = (list, label, keep, offset = [0, 0, 0]) => {
    const remap = new Map();
    const p = [], n = [], t = [], ix = [];
    for (let f = 0; f < list.length / 3; f++) {
      if (label && label[f] !== keep) continue;
      for (let k = 0; k < 3; k++) {
        const v = list[f * 3 + k];
        let o = remap.get(v);
        if (o === undefined) {
          o = remap.size;
          remap.set(v, o);
          p.push(pos[v * 3] - offset[0], pos[v * 3 + 1] - offset[1], pos[v * 3 + 2] - offset[2]);
          n.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
          t.push(uv[v * 2], uv[v * 2 + 1]);
        }
        ix.push(o);
      }
    }
    if (!ix.length) return null;
    const out = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(t)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(n)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(ix)).setBuffer(buffer));
    return out;
  };

  const bodyMesh = doc.createMesh('body');
  parts.forEach(({ list, label, keep }) => {
    const p = build(list, label, keep);
    if (p) bodyMesh.addPrimitive(p.setMaterial(mats[keep]));
  });
  const body = doc.createNode('body').setMesh(bodyMesh);
  scene.addChild(body);
  WHEELS.forEach((name, k) => {
    const w = wheels[name];
    const centre = [(w.x0 + w.x1) / 2, w.r, w.z];
    const p = build(wheelLists[k], null, 0, centre);
    if (!p) throw new Error(`segment: wheel ${name} is empty`);
    const mesh = doc.createMesh(`wheel_${name}`).addPrimitive(p.setMaterial(wheelMat));
    scene.addChild(doc.createNode(`wheel_${name}`).setTranslation(centre).setMesh(mesh));
  });
  node.dispose();
  prim.dispose();
  srcMat.dispose();
  return { wheels, bounds, factoryLum, counts };
}
