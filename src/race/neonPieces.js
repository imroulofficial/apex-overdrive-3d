import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';
import { paintVertices } from '../render/vertexPbr.js';

// Neon City freeway furniture (race/neonScenery.js puts it in the world): the concrete deck,
// jersey barriers and piers that carry the circuit over the city, LED strips on the barriers,
// street lights, the freeways that cross overhead, the cable-stayed Harbour Bridge, pools of
// light on the wet road, ambient traffic and the player's headlight beam.
//
// Everything concrete shares one textured material and everything that glows or is painted
// metal shares one vertex-PBR atlas (render/vertexPbr.js), so the whole lap of furniture is
// a handful of draw calls. Emissive strengths above 1 feed the bloom pass.

export const NEON = {
  cyan: 0x22e8ff,
  magenta: 0xff2bd6,
  amber: 0xffb020,
  lime: 0xb6ff3a,
  violet: 0x8a5bff,
  white: 0xe8f1ff,
  sodium: 0xffb35a,
  red: 0xff2a2a,
};
const NEON_LIST = [NEON.cyan, NEON.magenta, NEON.amber, NEON.violet, NEON.lime];

// Jersey barrier and deck section (metres, outward from the barrier's road face; up from the
// road). The deck edge sits just past the barrier; the slab is DECK_DEPTH deep.
export const DECK_DEPTH = 1.5;
const JERSEY = [[0, 0], [0.05, 0.08], [0.2, 0.33], [0.3, 0.86]];
const EDGE = 0.75; // deck edge beyond the barrier face
const MIN_CLEAR = 2.4; // below this the deck is a retaining wall down to the street
export const PORTAL_HALF = 26; // overpasses end in a tower this many metres either side
export const PORTAL_GAP = 22; // from the end of the deck to the tower's centre

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

// A path for sweep(): `count` stations with a centre, a right vector and a height.
export function trackPath(track, from = 0, to = track.n, step = 2) {
  const f = {};
  const out = [];
  for (let k = from; k <= to; k += step) {
    const s = k >= track.n ? track.length : track.s[k];
    track.frame(s, f);
    out.push({ s, x: f.x, z: f.z, y: track.roadY(s), rx: f.rx, rz: f.rz, tx: f.tx, tz: f.tz });
  }
  return out;
}

export function linePath(a, dir, y, from, to, step = 4) {
  const out = [];
  const rx = -dir.z;
  const rz = dir.x;
  for (let u = from; u <= to + 1e-6; u += step) out.push({ s: u, x: a.x + dir.x * u, z: a.z + dir.z * u, y, rx, rz, tx: dir.x, tz: dir.z });
  return out;
}

// Extrudes a cross-section along a path into a non-indexed geometry with flat normals facing
// out of the section (the profile winds clockwise seen along the path) and UVs in metres / 4.
// profile(station) -> [[d, dy], ...] (d along the right vector, dy above the station height).
export function sweep(path, profile) {
  const pos = [];
  const uv = [];
  const P = (st, d, dy) => [st.x + st.rx * d, st.y + dy, st.z + st.rz * d];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const want = new THREE.Vector3();
  for (let i = 0; i < path.length - 1; i++) {
    const s0 = path[i];
    const s1 = path[i + 1];
    const p0 = profile(s0);
    const p1 = profile(s1);
    let u0 = 0;
    for (let k = 0; k < p0.length - 1; k++) {
      const du = Math.hypot(p0[k + 1][0] - p0[k][0], p0[k + 1][1] - p0[k][1]);
      const A = P(s0, ...p0[k]);
      const B = P(s0, ...p0[k + 1]);
      const C = P(s1, ...p1[k]);
      const D = P(s1, ...p1[k + 1]);
      // Outward: the segment direction turned 90 degrees counter-clockwise in (right, up).
      const sd = p0[k + 1][0] - p0[k][0];
      const sh = p0[k + 1][1] - p0[k][1];
      want.set(s0.rx * -sh, sd, s0.rz * -sh);
      n.crossVectors(b.fromArray(B).sub(a.fromArray(A)), c.fromArray(C).sub(a));
      const flip = n.dot(want) < 0;
      const v0 = s0.s / 4;
      const v1 = s1.s / 4;
      const ua = u0 / 4;
      const ub = (u0 + du) / 4;
      const tri = (q, r, t, uq, ur, ut) => {
        if (flip) {
          pos.push(...q, ...t, ...r);
          uv.push(...uq, ...ut, ...ur);
        } else {
          pos.push(...q, ...r, ...t);
          uv.push(...uq, ...ur, ...ut);
        }
      };
      tri(A, B, C, [ua, v0], [ub, v0], [ua, v1]);
      tri(B, D, C, [ub, v0], [ub, v1], [ua, v1]);
      u0 += du;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

// Box mapping in metres / 4 for concrete parts (piers, pylons, beams).
export function boxUV(geo, scale = 4) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const p = g.attributes.position;
  const nrm = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    const az = Math.abs(nrm.getZ(i));
    let u;
    let v;
    if (ay >= ax && ay >= az) [u, v] = [p.getX(i), p.getZ(i)];
    else if (ax >= az) [u, v] = [p.getZ(i), p.getY(i)];
    else [u, v] = [p.getX(i), p.getY(i)];
    uv[i * 2] = u / scale;
    uv[i * 2 + 1] = v / scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// An oriented box between two points (a beam, a cable, a pole), `w` wide and `h` deep.
function beam(a, b, w, h) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, len, h).toNonIndexed();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

// A box with its base centred at (x, y, z), rotated `yaw` about +y.
function block(x, y, z, w, h, d, yaw = 0) {
  return new THREE.BoxGeometry(w, h, d).toNonIndexed().translate(0, h / 2, 0).rotateY(yaw).translate(x, y, z);
}

const painted = (geo, pbr) => {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal'].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  return paintVertices(g, pbr);
};

const clean = (geo) => {
  for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
  return geo;
};

// ---------------------------------------------------------------------------
// Freeway: deck, barriers, piers, LED strips and street lights along the circuit
// ---------------------------------------------------------------------------

// Stations of the track with the ground height under them.
function stations(track, ground, step = 2) {
  return trackPath(track, 0, track.n, step).map((st) => ({ ...st, g: ground(st.x, st.z) }));
}

// Sections of the lap (in metres) where the deck is a bridge span: no piers there.
const inSpans = (spans, s) => spans.some(([a, b]) => s > a && s < b);

export function buildFreeway(track, def, ground) {
  const fo = track.fenceOffset;
  const W = fo + EDGE;
  const L = track.length;
  const bridge = def.harbourBridge ? [def.harbourBridge.from * L, def.harbourBridge.to * L] : null;
  const pylonS = (def.harbourBridge?.pylons ?? []).map((f) => f * L);
  const onBridge = (s) => bridge && s >= bridge[0] && s <= bridge[1];
  const path = stations(track, ground, 2);

  // One continuous section: right barrier, deck edge, fascia, slab underside, then the left
  // side back up to the left barrier's road face.
  const bottom = (st) => {
    const clear = st.y - st.g;
    return clear < MIN_CLEAR + DECK_DEPTH ? st.g - st.y - 0.3 : -DECK_DEPTH;
  };
  const section = (st) => {
    const bot = bottom(st);
    const R = JERSEY.map(([d, h]) => [fo + d, h]);
    const Lf = JERSEY.map(([d, h]) => [-fo - d, h]).reverse();
    return [...R, [W, 0.86], [W, bot], [-W, bot], [-W, 0.86], ...Lf];
  };
  const parts = [sweep(path, section)];

  // Piers: a hammerhead pier every 30 m where the deck flies, two columns each side of a
  // pylon on the bridge, none across the cable-stayed main span.
  const span = bridge ? [[pylonS[0] - 6, pylonS[1] + 6], [bridge[0] + 30, pylonS[0] - 40], [pylonS[1] + 40, bridge[1] - 30]] : [];
  const f = {};
  for (let s = 10; s < L; s += 30) {
    if (inSpans(span, s)) continue;
    track.frame(s, f);
    const y = track.roadY(s);
    const g = ground(f.x, f.z);
    if (y - g < MIN_CLEAR + DECK_DEPTH + 0.5) continue;
    const yaw = Math.atan2(-f.tz, f.tx);
    const top = y - DECK_DEPTH;
    const base = Math.min(g, 0) - 2;
    parts.push(block(f.x, base, f.z, 2.4, top - 1.6 - base, 3.2, yaw));
    // Hammerhead cap under the slab.
    const cap = new THREE.BoxGeometry(2.8, 1.6, W * 1.5).toNonIndexed().translate(0, top - 0.8, 0).rotateY(yaw);
    parts.push(cap.translate(f.x, 0, f.z));
  }
  const concreteGeo = mergeGeometries(parts.map((p) => clean(boxUV(p))));

  // LED strips along the top of each barrier (cyan left, magenta right; white on the bridge).
  const lit = [];
  const ledProfile = (side) => () => {
    const d = side * (fo + 0.31);
    return side > 0 ? [[d - 0.02, 0.76], [d - 0.02, 0.84]] : [[d + 0.02, 0.84], [d + 0.02, 0.76]];
  };
  // Runs of stations on and off the bridge (consecutive runs share their end station).
  const runs = [];
  for (const st of path) {
    const b = onBridge(st.s);
    if (!runs.length || runs.at(-1).bridge !== b) {
      const prev = runs.at(-1)?.list.at(-1);
      runs.push({ bridge: b, list: prev ? [prev] : [] });
    }
    runs.at(-1).list.push(st);
  }
  for (const side of [1, -1]) {
    for (const run of runs) {
      if (run.list.length < 2) continue;
      const color = run.bridge ? NEON.white : side > 0 ? NEON.magenta : NEON.cyan;
      lit.push(painted(sweep(run.list, ledProfile(side)), { color, roughness: 0.4, emissive: run.bridge ? 2.2 : 2.8 }));
    }
  }

  // Street lights: tall LED poles on the barrier every 38 m, alternating sides, arms over the
  // lanes. None on the bridge (its cables light it) or right under an overpass.
  const lamps = [];
  const metal = { color: 0x3a3f48, roughness: 0.45, metalness: 0.8 };
  const pole = painted(new THREE.CylinderGeometry(0.11, 0.16, 10, 8).translate(0, 5, 0), metal);
  const arm = painted(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6).rotateZ(Math.PI / 2).translate(-1.6, 9.85, 0), metal);
  const head = painted(new THREE.BoxGeometry(1.1, 0.18, 0.42).translate(-3.2, 9.8, 0), { color: 0x24272d, roughness: 0.4, metalness: 0.6 });
  const lens = painted(new THREE.BoxGeometry(0.95, 0.04, 0.32).translate(-3.2, 9.7, 0), { color: NEON.white, roughness: 0.2, emissive: 4 });
  const lampGeo = mergeGeometries([pole, arm, head, lens]);
  const pools = [];
  const under = (s) => (def.overpasses ?? []).some((o) => Math.abs(track.delta(o.at * L, s)) < 22);
  let k = 0;
  for (let s = 24; s < L - 10; s += 38, k++) {
    if (onBridge(s) || under(s)) continue;
    const side = k % 2 ? 1 : -1;
    track.frame(s, f);
    const d = side * (fo + 0.15);
    const yaw = Math.atan2(-side * f.rz, side * f.rx);
    const y = track.roadY(s) + 0.86;
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(f.x + f.rx * d, y, f.z + f.rz * d);
    lamps.push(lampGeo.clone().applyMatrix4(m));
    // Street-level stretches (the Arcade District) burn sodium orange.
    const low = track.roadY(s) - ground(f.x, f.z) < 4;
    pools.push({ s, d: side * (fo - 3.2), r: 8.5, color: low ? NEON.sodium : 0xbfd6ff, k: low ? 0.95 : 0.8 });
  }
  lit.push(...lamps);
  return { concrete: concreteGeo, neon: lit, pools };
}

// ---------------------------------------------------------------------------
// Overpasses: straight freeways crossing above the circuit, ending in portal towers
// ---------------------------------------------------------------------------

export function planOverpasses(track, def) {
  const L = track.length;
  const f = {};
  const pr = {};
  const clearOf = track.fenceOffset + 9;
  return (def.overpasses ?? []).map((o, i) => {
    const s0 = o.at * L;
    track.frame(s0, f);
    const c = Math.cos(o.angle);
    const sn = Math.sin(o.angle);
    const dir = new THREE.Vector3(f.tx * c - f.rx * sn, 0, f.tz * c - f.rz * sn).normalize();
    const half = o.lanes * 3.6 + 1.2;
    const deckTop = track.roadY(s0) + o.clearance + DECK_DEPTH;
    // Run out each way until the deck would meet the circuit again (or 300 m). The deck ends
    // in a portal tower (PORTAL_HALF square, centred PORTAL_GAP past the end), which must
    // stand clear of the circuit.
    const reach = (sign) => {
      let best = 60;
      for (let u = 26; u < 300; u += 4) {
        const x = f.x + dir.x * u * sign;
        const z = f.z + dir.z * u * sign;
        track.project(x, z, -1, pr);
        if (Math.abs(pr.d) < clearOf + half && Math.abs(track.roadY(pr.s) - deckTop) < 12 && Math.abs(track.delta(pr.s, s0)) > 60) break;
        const px = f.x + dir.x * (u + PORTAL_GAP) * sign;
        const pz = f.z + dir.z * (u + PORTAL_GAP) * sign;
        track.project(px, pz, -1, pr);
        if (u >= 60 && Math.abs(pr.d) > PORTAL_HALF * 1.42 + track.fenceOffset + 4) best = u;
      }
      return best;
    };
    const a = reach(-1);
    const b = reach(1);
    return { ...o, index: i, s0, center: new THREE.Vector3(f.x, 0, f.z), dir, half, deckTop, from: -a, to: b };
  });
}

export function buildOverpasses(track, plans, ground, { neon: neonOut, concrete: concreteOut, pools }) {
  const pr = {};
  for (const o of plans) {
    const path = linePath(o.center, o.dir, o.deckTop, o.from, o.to, 4);
    const fo = o.half;
    const W = fo + EDGE;
    const section = () => {
      const R = JERSEY.map(([d, h]) => [fo + d, h]);
      const Lf = JERSEY.map(([d, h]) => [-fo - d, h]).reverse();
      // Road surface on top so the deck is solid seen from the elevated circuit.
      return [...R, [W, 0.86], [W, -DECK_DEPTH], [-W, -DECK_DEPTH], [-W, 0.86], ...Lf, [fo, 0]];
    };
    concreteOut.push(clean(sweep(path, section)));
    // Twin-column piers every 36 m, clear of the circuit below.
    for (let u = o.from + 10; u < o.to - 6; u += 36) {
      const x = o.center.x + o.dir.x * u;
      const z = o.center.z + o.dir.z * u;
      track.project(x, z, -1, pr);
      if (Math.abs(pr.d) < track.fenceOffset + W + 3 && track.roadY(pr.s) < o.deckTop) continue;
      const g = ground(x, z);
      const yaw = Math.atan2(-o.dir.z, o.dir.x);
      for (const side of [-1, 1]) {
        const cx = x - o.dir.z * side * fo * 0.55;
        const cz = z + o.dir.x * side * fo * 0.55;
        concreteOut.push(clean(boxUV(block(cx, Math.min(g, 0) - 2, cz, 1.8, o.deckTop - DECK_DEPTH - Math.min(g, 0) + 2, 1.8, yaw))));
      }
      concreteOut.push(clean(boxUV(new THREE.BoxGeometry(2.2, 1.4, W * 2).toNonIndexed().rotateY(yaw).translate(x, o.deckTop - DECK_DEPTH - 0.7, z))));
    }
    // Neon fascia band along both deck edges and a row of light bars under the deck where it
    // crosses the circuit.
    const color = NEON_LIST[o.index % NEON_LIST.length];
    for (const side of [1, -1]) {
      const band = (st) => (side > 0 ? [[W + 0.03, -0.55], [W + 0.03, -0.25]] : [[-W - 0.03, -0.25], [-W - 0.03, -0.55]]);
      neonOut.push(painted(sweep(path, band), { color, roughness: 0.4, emissive: 3.2 }));
    }
    for (let u = -10; u <= 10; u += 5) {
      for (const side of [-1, 1]) {
        const x = o.center.x + o.dir.x * u - o.dir.z * side * fo * 0.4;
        const z = o.center.z + o.dir.z * u + o.dir.x * side * fo * 0.4;
        const yaw = Math.atan2(-o.dir.z, o.dir.x);
        neonOut.push(painted(new THREE.BoxGeometry(2.2, 0.08, 0.3).rotateY(yaw).translate(x, o.deckTop - DECK_DEPTH - 0.05, z), { color: NEON.white, emissive: 4 }));
      }
    }
    // Light pools on the circuit under the deck.
    for (const ds of [-9, 0, 9]) pools.push({ s: track.wrapS(o.s0 + ds), d: 0, r: 10, color, k: 0.6 });
  }
}

// ---------------------------------------------------------------------------
// The Harbour Bridge: two H pylons and fans of LED-lit stay cables
// ---------------------------------------------------------------------------

export function buildHarbourBridge(track, def, { concrete: concreteOut, neon: neonOut }) {
  const hb = def.harbourBridge;
  if (!hb) return;
  const L = track.length;
  const W = track.fenceOffset + EDGE;
  const f = {};
  const cableLit = { color: 0xcfeeff, roughness: 0.3, emissive: 1.25 };
  for (const pf of hb.pylons) {
    const s = pf * L;
    track.frame(s, f);
    const y = track.roadY(s);
    const legs = [];
    const top = y + 64;
    for (const side of [1, -1]) {
      const d = side * (W + 2.2);
      const bx = f.x + f.rx * d;
      const bz = f.z + f.rz * d;
      // Legs lean in slightly toward the top.
      const tx = f.x + f.rx * side * (W + 0.6);
      const tz = f.z + f.rz * side * (W + 0.6);
      const a = new THREE.Vector3(bx, -4, bz);
      const b = new THREE.Vector3(tx, top, tz);
      concreteOut.push(clean(boxUV(beam(a, b, 3.4, 3.0))));
      legs.push({ side, a, b });
      // Uplight stripe on the leg's road face.
      const ia = a.clone().addScaledVector(new THREE.Vector3(f.rx, 0, f.rz), -side * 1.75);
      const ib = b.clone().addScaledVector(new THREE.Vector3(f.rx, 0, f.rz), -side * 1.75);
      ia.y = y + 2;
      neonOut.push(painted(beam(ia, ib, 0.25, 0.25), { color: NEON.magenta, roughness: 0.4, emissive: 2.6 }));
      // Aviation warning light.
      neonOut.push(painted(block(tx, top, tz, 1.2, 0.9, 1.2), { color: NEON.red, emissive: 6 }));
    }
    // Cross beams: one under the deck, two above it.
    const lerpLeg = (leg, yy) => leg.a.clone().lerp(leg.b, (yy - leg.a.y) / (leg.b.y - leg.a.y));
    for (const yy of [y - DECK_DEPTH - 1.2, y + 38, top - 2]) {
      const p = lerpLeg(legs[0], yy);
      const q = lerpLeg(legs[1], yy);
      concreteOut.push(clean(boxUV(beam(p, q, 2.4, 2.6))));
    }
    // Stay cables: fans from the upper legs down to the deck edges, both ways along the road.
    for (const leg of legs) {
      for (let j = 1; j <= 10; j++) {
        const anchorY = top - 4 - j * 2.2;
        const from = lerpLeg(leg, anchorY);
        for (const dir of [1, -1]) {
          const sd = s + dir * (10 + j * 11.5);
          track.frame(sd, f);
          const d = leg.side * (W - 0.2);
          const to = new THREE.Vector3(f.x + f.rx * d, track.roadY(sd) + 0.9, f.z + f.rz * d);
          neonOut.push(painted(beam(from, to, 0.1, 0.1), cableLit));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pools of light on the road: additive decals that follow the road surface. They brighten
// on a wet road, where real lamps would smear into long reflections.
// ---------------------------------------------------------------------------

function poolTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const v = Math.pow(1 - r, 2.2);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function buildLightPools(track, pools) {
  const pos = [];
  const col = [];
  const uv = [];
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const N = 4;
  for (const pl of pools) {
    c.set(pl.color).multiplyScalar(pl.k ?? 1);
    const grid = [];
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const s = track.wrapS(pl.s + (i / N - 0.5) * 2 * pl.r);
        const d = Math.max(-track.fenceOffset, Math.min(track.fenceOffset, pl.d + (j / N - 0.5) * 2 * pl.r));
        track.point(s, d, p);
        grid.push([p.x, p.y + 0.05, p.z, j / N, i / N]);
      }
    }
    const at = (i, j) => grid[i * (N + 1) + j];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        for (const v of [at(i, j), at(i + 1, j), at(i, j + 1), at(i, j + 1), at(i + 1, j), at(i + 1, j + 1)]) {
          pos.push(v[0], v[1], v[2]);
          uv.push(v[3], v[4]);
          col.push(c.r, c.g, c.b);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.MeshBasicMaterial({
    map: poolTexture(),
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'light-pools';
  mesh.renderOrder = 2;
  return mesh;
}

// ---------------------------------------------------------------------------
// Ambient traffic: instanced cars with head- and tail-lights cruising the overpasses and the
// avenues below. Purely visual; it never meets the race.
// ---------------------------------------------------------------------------

function trafficCarGeometry() {
  const body = { color: 0x1a1d24, roughness: 0.35, metalness: 0.6 };
  return mergeGeometries([
    painted(new THREE.BoxGeometry(4.3, 0.75, 1.8).translate(0, 0.55, 0), body),
    painted(new THREE.BoxGeometry(2.3, 0.6, 1.6).translate(-0.3, 1.2, 0), { color: 0x0c0e12, roughness: 0.15, metalness: 0.2 }),
    painted(new THREE.BoxGeometry(0.06, 0.18, 0.4).translate(2.16, 0.62, 0.6), { color: 0xffffff, emissive: 6 }),
    painted(new THREE.BoxGeometry(0.06, 0.18, 0.4).translate(2.16, 0.62, -0.6), { color: 0xffffff, emissive: 6 }),
    painted(new THREE.BoxGeometry(0.06, 0.16, 1.5).translate(-2.16, 0.7, 0), { color: 0xff1a1a, emissive: 4 }),
  ]);
}

export class Traffic {
  // lanes: [{ a: Vector3 start, dir: Vector3 unit, length, y, offset (m to the right) }]
  constructor(lanes, material, { seed = 5, density = 1 / 55 } = {}) {
    const rand = mulberry32(seed);
    this.cars = [];
    for (const lane of lanes) {
      const n = Math.max(1, Math.round(lane.length * density));
      const speed = 17 + rand() * 12;
      for (let i = 0; i < n; i++) this.cars.push({ lane, speed: speed * (0.9 + rand() * 0.2), phase: rand() * lane.length });
    }
    this.mesh = new THREE.InstancedMesh(trafficCarGeometry(), material, Math.max(1, this.cars.length));
    this.mesh.count = this.cars.length;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'traffic';
    this.m = new THREE.Matrix4();
    this.update(0);
  }

  update(t) {
    const m = this.m;
    this.cars.forEach((c, i) => {
      const { lane } = c;
      const u = (c.phase + c.speed * t) % lane.length;
      const x = lane.a.x + lane.dir.x * u - lane.dir.z * lane.offset;
      const z = lane.a.z + lane.dir.z * u + lane.dir.x * lane.offset;
      m.makeRotationY(Math.atan2(-lane.dir.z, lane.dir.x)).setPosition(x, lane.y, z);
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export function overpassLanes(plans) {
  const lanes = [];
  for (const o of plans) {
    const length = o.to - o.from;
    for (let k = 0; k < o.lanes; k++) {
      const off = 1.9 + k * 3.6;
      const a = o.center.clone().addScaledVector(o.dir, o.from);
      lanes.push({ a, dir: o.dir.clone(), length, y: o.deckTop, offset: off });
      const b = o.center.clone().addScaledVector(o.dir, o.to);
      lanes.push({ a: b, dir: o.dir.clone().negate(), length, y: o.deckTop, offset: off });
    }
  }
  return lanes;
}

// ---------------------------------------------------------------------------
// The player's headlights: a soft beam of light laid on the road ahead of the car.
// ---------------------------------------------------------------------------

function beamTexture() {
  const w = 64;
  const h = 128;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = y / (h - 1); // 0 at the bumper, 1 far ahead
      const spread = 0.18 + v * 0.32;
      const ax = Math.abs((x + 0.5) / w - 0.5) / spread;
      const along = Math.min(1, Math.max(0, v - 0.04) * 3.2) * Math.pow(1 - v, 1.2);
      const k = Math.max(0, 1 - ax * ax) * along;
      const i = (y * w + x) * 4;
      data[i] = Math.round(k * 255);
      data[i + 1] = Math.round(k * 250);
      data[i + 2] = Math.round(k * 235);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export class Headlights {
  constructor() {
    const geo = new THREE.PlaneGeometry(10, 30).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2).translate(17, 0, 0);
    const mat = new THREE.MeshBasicMaterial({
      map: beamTexture(),
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'headlights';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  update(car) {
    if (!car?.pos) return;
    this.mesh.visible = !car.airborne;
    this.mesh.position.set(car.pos.x, car.pos.y + 0.06, car.pos.z);
    this.mesh.rotation.set(0, car.heading, 0);
  }
}


// ---------------------------------------------------------------------------
// Kage's light trail: a magenta ribbon at tail-light height that streams behind the Chapter 3
// boss for the last couple of seconds of its line ("you will not see me pass").
// ---------------------------------------------------------------------------

export class LightTrail {
  constructor(color = NEON.magenta, { points = 32, every = 0.03, width = 0.22, height = 0.62 } = {}) {
    this.points = points;
    this.every = every;
    this.height = height;
    this.width = width;
    this.trail = [];
    this.clock = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(points * 2 * 3);
    this.alpha = new Float32Array(points * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const index = [];
    for (let i = 0; i < points - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(index);
    const c = new THREE.Color(color).multiplyScalar(1.5);
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: c } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vA;
        void main() {
          vA = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        varying float vA;
        void main() { gl_FragColor = vec4(color * vA, 1.0); }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'light-trail';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  clear() {
    this.trail.length = 0;
    this.mesh.visible = false;
  }

  // car: a Vehicle (pos, heading, speed) or null to hide.
  update(dt, car) {
    if (!car) return this.clear();
    const p = car.pos;
    const last = this.trail[0];
    if (last && (Math.hypot(p.x - last.x, p.z - last.z) > 30 || dt <= 0)) this.clear();
    this.clock += dt;
    if (!this.trail.length || this.clock >= this.every) {
      this.clock = 0;
      // Behind the rear axle, across the car.
      const fx = Math.cos(car.heading);
      const fz = -Math.sin(car.heading);
      this.trail.unshift({ x: p.x - fx * 2.1, y: p.y + this.height, z: p.z - fz * 2.1, rx: -fz, rz: fx });
      if (this.trail.length > this.points) this.trail.length = this.points;
    }
    const n = this.trail.length;
    this.mesh.visible = n > 1 && car.speed > 8;
    for (let i = 0; i < this.points; i++) {
      const t = this.trail[Math.min(i, n - 1)];
      const k = i / (this.points - 1);
      const w = this.width * (1 - k * 0.7);
      for (let side = 0; side < 2; side++) {
        const j = (i * 2 + side) * 3;
        const sgn = side ? 1 : -1;
        // A thin upright ribbon: edge-on from behind it reads as a streak of light.
        this.pos[j] = t.x;
        this.pos[j + 1] = t.y + w * sgn * 0.5;
        this.pos[j + 2] = t.z;
        this.alpha[i * 2 + side] = i < n ? Math.pow(1 - k, 2.2) * 0.85 : 0;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
  }
}
