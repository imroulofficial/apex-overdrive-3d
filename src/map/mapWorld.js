import * as THREE from 'three';
import { CHAPTERS, STAGES } from '../data/career.js';
import { createNoise2D, fbm, mulberry32, smoothstep } from '../race/noise.js';
import { paintVertices, paintVerticesBy, mergePainted, stamp, createVertexPbrMaterial } from '../render/vertexPbr.js';

// The campaign world map's 3D diorama: one low-poly island per chapter laid out west to east
// (Emerald Coast, Alpine Summit, Neon City), each with a road that threads its 20 stage nodes.
// Everything static (terrain, roads, trees, buildings, landmarks) bakes into a single
// vertex-coloured mesh, so the whole world is one draw call plus the node pedestals.
// Procedural and seeded: identical on every device, nothing downloaded.

export const CHAPTER_SPACING = 150;
const HALF_X = 50; // node road span inside an island (local x)
const ISLAND = { rx: 64, rz: 40 };

// Per-chapter look. The map blends between these as the camera pans (WorldMap.js).
export const MOODS = {
  'emerald-coast': { sky: '#9fd6ea', fog: '#9fd6ea', water: '#1b8db0', hemiSky: '#e8f6ff', hemiGround: '#4e6b3a', hemi: 1.35, sun: '#ffe2b0', sunI: 2.4 },
  'alpine-summit': { sky: '#c9dcee', fog: '#c9dcee', water: '#3a6987', hemiSky: '#f4f8ff', hemiGround: '#5b6670', hemi: 1.45, sun: '#fff4e6', sunI: 2.2 },
  'neon-city': { sky: '#170b30', fog: '#170b30', water: '#0b0f2c', hemiSky: '#7a5ce0', hemiGround: '#1c1236', hemi: 1.15, sun: '#b39dff', sunI: 1.0 },
};

const chapterX = (i) => i * CHAPTER_SPACING;

// How high the road sits along a chapter (t = 0..1): Alpine climbs the mountain.
const roadHeight = (chapterId, t) => (chapterId === 'alpine-summit' ? 1.6 + 7.5 * t : chapterId === 'neon-city' ? 1.2 : 1.3);

// World positions of the 60 stage nodes (index = stage.index), on top of their road.
export function nodeLayout() {
  return STAGES.map((s) => {
    const ci = CHAPTERS.findIndex((c) => c.id === s.chapterId);
    const t = (s.chapterStage - 1) / 19;
    const phase = [0.2, 1.4, 2.6][ci];
    const x = chapterX(ci) - HALF_X + 2 * HALF_X * t;
    const z = 13 * Math.sin(t * Math.PI * 2.6 + phase) + 3.5 * Math.sin(t * Math.PI * 7 + ci);
    return new THREE.Vector3(x, roadHeight(s.chapterId, t), z);
  });
}

// ---- Geometry helpers ----

// stampAll() that tolerates an empty placement list (returns null, dropped before merging).
const stampAll = (geo, matrices) => (matrices.length ? stamp(geo, matrices) : null);

function painted(geo, color, pbr = {}) {
  return paintVertices(geo.index ? geo.toNonIndexed() : geo, { roughness: 0.9, ...pbr, color });
}

function at(x, y, z, s = 1, ry = 0, sy = s) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, sy, s));
}

// A flat ribbon along `points` (y from the points), `half` wide, offset sideways by `offset`.
function ribbon(points, half, { offset = 0, lift = 0.12, color, emissive = 0, dash = 0 }) {
  const pos = [];
  const side = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < points.length - 1; i++) {
    if (dash && Math.floor(i / dash) % 2) continue;
    const a = points[i];
    const b = points[i + 1];
    side.subVectors(b, a).setY(0).normalize().cross(up);
    const corner = (p, s) => [p.x + side.x * (offset + s * half), p.y + lift, p.z + side.z * (offset + s * half)];
    const [a1, a2, b1, b2] = [corner(a, -1), corner(a, 1), corner(b, -1), corner(b, 1)];
    pos.push(...a1, ...a2, ...b1, ...a2, ...b2, ...b1); // counter-clockwise seen from above
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return paintVertices(geo, { color, roughness: 0.8, emissive });
}

// ---- Props (built once, stamped many times) ----

function pine(color, { snow = false } = {}) {
  const trunk = painted(new THREE.CylinderGeometry(0.18, 0.25, 1.2, 5).translate(0, 0.6, 0), '#5a3b24');
  const lower = painted(new THREE.ConeGeometry(1.15, 2.2, 6).translate(0, 1.9, 0), color);
  const upper = painted(new THREE.ConeGeometry(0.8, 1.7, 6).translate(0, 3.0, 0), snow ? '#f2f6fa' : color);
  return mergePainted([trunk, lower, upper]);
}

function roundTree() {
  const trunk = painted(new THREE.CylinderGeometry(0.16, 0.22, 1.4, 5).translate(0, 0.7, 0), '#6b4a2b');
  const crown = painted(new THREE.IcosahedronGeometry(1.2, 0).translate(0, 2.0, 0), '#4f9e3f');
  return mergePainted([trunk, crown]);
}

function house(wall, roof) {
  const body = painted(new THREE.BoxGeometry(2.2, 1.4, 1.8).translate(0, 0.7, 0), wall);
  const top = painted(new THREE.ConeGeometry(1.75, 1.1, 4).rotateY(Math.PI / 4).scale(1, 1, 0.85).translate(0, 1.95, 0), roof);
  return mergePainted([body, top]);
}

function lighthouse() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const r0 = 1.1 - i * 0.12;
    parts.push(painted(new THREE.CylinderGeometry(r0 - 0.12, r0, 1.6, 10).translate(0, 0.8 + i * 1.6, 0), i % 2 ? '#d7262e' : '#f4f1ea'));
  }
  parts.push(painted(new THREE.CylinderGeometry(0.62, 0.62, 0.9, 10).translate(0, 8.45, 0), '#fff2b0', { emissive: 1.6 }));
  parts.push(painted(new THREE.ConeGeometry(0.85, 1.0, 10).translate(0, 9.4, 0), '#26303d'));
  return mergePainted(parts);
}

function chalet() {
  const body = painted(new THREE.BoxGeometry(2.6, 1.6, 2.0).translate(0, 0.8, 0), '#8a5a34');
  const roof = painted(new THREE.BoxGeometry(3.1, 0.25, 2.5).translate(0, 0, 0), '#f2f6fa');
  const r1 = roof.clone().applyMatrix4(new THREE.Matrix4().makeRotationZ(0.55).setPosition(-0.68, 2.05, 0));
  const r2 = roof.clone().applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.55).setPosition(0.68, 2.05, 0));
  const win = painted(new THREE.BoxGeometry(0.5, 0.4, 2.04).translate(0, 0.9, 0), '#ffd27a', { emissive: 1.2 });
  return mergePainted([body, r1, r2, win]);
}

function tower(h, neon) {
  const body = painted(new THREE.BoxGeometry(3, h, 3).translate(0, h / 2, 0), '#2e3150', { roughness: 0.75, metalness: 0 });
  const parts = [body];
  // Lit window bands every few floors, and a neon crown.
  for (let y = 2; y < h - 1; y += 2.6) parts.push(painted(new THREE.BoxGeometry(3.04, 0.22, 3.04).translate(0, y, 0), '#8f7bd8', { emissive: 0.5 }));
  parts.push(painted(new THREE.BoxGeometry(3.12, 0.45, 3.12).translate(0, h - 0.3, 0), neon, { emissive: 2.2 }));
  return mergePainted(parts);
}

function spire(neon) {
  const base = painted(new THREE.CylinderGeometry(1.6, 2.4, 22, 6).translate(0, 11, 0), '#202336', { roughness: 0.35, metalness: 0.4 });
  const ring1 = painted(new THREE.TorusGeometry(1.9, 0.18, 4, 12).rotateX(Math.PI / 2).translate(0, 14, 0), neon, { emissive: 2.4 });
  const ring2 = painted(new THREE.TorusGeometry(1.7, 0.18, 4, 12).rotateX(Math.PI / 2).translate(0, 18, 0), '#00e5ff', { emissive: 2.4 });
  const needle = painted(new THREE.ConeGeometry(0.5, 7, 6).translate(0, 25.5, 0), '#e9edf2', { emissive: 0.6 });
  return mergePainted([base, ring1, ring2, needle]);
}

function billboard(color) {
  const post = painted(new THREE.BoxGeometry(0.3, 4, 0.3).translate(0, 2, 0), '#2a2d3c');
  const sign = painted(new THREE.BoxGeometry(4, 1.8, 0.2).translate(0, 4.6, 0), color, { emissive: 2.0 });
  return mergePainted([post, sign]);
}

function summitFlag() {
  const pole = painted(new THREE.CylinderGeometry(0.08, 0.08, 4, 5).translate(0, 2, 0), '#d9dde3');
  const flag = painted(new THREE.BoxGeometry(1.6, 1, 0.05).translate(0.8, 3.4, 0), '#c8102e', { emissive: 0.3 });
  return mergePainted([pole, flag]);
}

// ---- Islands ----

// Distance from (x, z) to the polyline and the road height there.
function nearestRoad(road, x, z) {
  let best = Infinity;
  let y = 0;
  for (let i = 0; i < road.length; i += 2) {
    const p = road[i];
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < best) {
      best = d;
      y = p.y;
    }
  }
  return { d: Math.sqrt(best), y };
}

function islandHeight(chapter, noise, lx, lz) {
  const n = fbm(noise, lx * 0.045, lz * 0.045, 4);
  if (chapter.id === 'neon-city') {
    // A squared-off reclaimed city block with a sea wall.
    const e = Math.max(Math.abs(lx) / ISLAND.rx, Math.abs(lz) / ISLAND.rz);
    const m = 1 - smoothstep(0.9, 1.0, e + n * 0.03);
    return -3 + m * 4.2;
  }
  const e = (lx / ISLAND.rx) ** 2 + (lz / ISLAND.rz) ** 2;
  const m = 1 - smoothstep(0.55, 1.0, e + n * 0.25);
  if (chapter.id === 'alpine-summit') {
    const north = smoothstep(4, -26, lz); // peaks along the back of the island
    const ridge = Math.abs(fbm(noise, lx * 0.06 + 9, lz * 0.06, 3));
    return -3 + m * (4 + north * (10 + 16 * ridge) + 2.5 * n + smoothstep(-40, 50, lx) * 4);
  }
  const hills = smoothstep(0, -28, lz) * (3 + 4 * (n + 0.5));
  return -3 + m * (4.3 + hills + 1.2 * n);
}

function terrainColor(chapter, h, n, lx, lz, out) {
  if (h < 0.6) return out.set(chapter.id === 'neon-city' ? '#2b2f3f' : '#e6d29b'); // shore
  if (chapter.id === 'neon-city') {
    const street = Math.abs(((lx + 200) % 12) - 6) < 0.8 || Math.abs(((lz + 200) % 12) - 6) < 0.8;
    return out.set(street ? '#2c3047' : '#171a26');
  }
  if (chapter.id === 'alpine-summit') {
    if (h > 13 + n * 3) return out.set('#f4f7fb');
    if (h > 9) return out.set('#7f8792');
    return out.set(n > 0.05 ? '#6d9b52' : '#5c8a47');
  }
  if (h > 6) return out.set('#2f6b36'); // redwood hills
  return out.set(n > 0.08 ? '#4fa246' : '#62b350');
}

function buildIsland(chapter, ci, rand) {
  const noise = createNoise2D(101 + ci * 37);
  const cx = chapterX(ci);
  const nodes = nodeLayout().filter((_, i) => STAGES[i].chapterId === chapter.id);
  const curve = new THREE.CatmullRomCurve3(nodes, false, 'centripetal');
  const road = curve.getPoints(320);
  // The road runs a little past the first and last nodes.
  const parts = [];

  // Terrain: flattened under the road, faceted like a board-game diorama.
  const geo = new THREE.PlaneGeometry(ISLAND.rx * 2 + 30, ISLAND.rz * 2 + 30, 96, 64).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const heights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    let h = islandHeight(chapter, noise, lx, lz);
    const r = nearestRoad(road, cx + lx, lz);
    const k = smoothstep(2.2, 7.5, r.d);
    h = (r.y - 0.05) * (1 - k) + h * k;
    heights[i] = h;
    pos.setY(i, h);
  }
  geo.translate(cx, 0, 0);
  geo.computeVertexNormals();
  parts.push(
    paintVerticesBy(
      geo.toNonIndexed(),
      (x, y, z, out) => terrainColor(chapter, y, fbm(noise, (x - cx) * 0.2, z * 0.2, 2), x - cx, z, out),
      { roughness: 0.95 }
    )
  );

  // Road, kerbs and centre line.
  const neon = chapter.id === 'neon-city';
  parts.push(ribbon(road, 1.5, { color: neon ? '#24263a' : '#30333b' }));
  parts.push(ribbon(road, 0.18, { offset: 1.55, lift: 0.14, color: neon ? '#00e5ff' : '#f2f2f2', emissive: neon ? 1.6 : 0 }));
  parts.push(ribbon(road, 0.18, { offset: -1.55, lift: 0.14, color: neon ? '#ff2bd6' : '#f2f2f2', emissive: neon ? 1.6 : 0 }));
  parts.push(ribbon(road, 0.12, { lift: 0.15, color: neon ? '#f7ff3c' : '#ffd34d', emissive: neon ? 1.2 : 0.2, dash: 3 }));

  // Scatter props on land, clear of the road and the nodes.
  const heightAt = (lx, lz) => {
    const ix = Math.round(((lx + ISLAND.rx + 15) / (ISLAND.rx * 2 + 30)) * 96);
    const iz = Math.round(((lz + ISLAND.rz + 15) / (ISLAND.rz * 2 + 30)) * 64);
    return heights[Math.min(64, Math.max(0, iz)) * 97 + Math.min(96, Math.max(0, ix))];
  };
  const scatter = (count, minRoad, test, place) => {
    for (let tries = 0, n = 0; n < count && tries < count * 12; tries++) {
      const lx = (rand() * 2 - 1) * ISLAND.rx;
      const lz = (rand() * 2 - 1) * ISLAND.rz;
      const h = heightAt(lx, lz);
      if (h < 0.9 || nearestRoad(road, cx + lx, lz).d < minRoad || !test(h, lx, lz)) continue;
      place(cx + lx, h, lz);
      n++;
    }
  };

  if (chapter.id === 'emerald-coast') {
    const pines = [];
    const rounds = [];
    scatter(170, 4.5, (h) => h > 1.4, (x, y, z) => (z < -8 ? pines : rounds).push(at(x, y - 0.1, z, 0.75 + rand() * 0.7, rand() * 6)));
    parts.push(stampAll(pine('#2f7a3a'), pines), stampAll(roundTree(), rounds));
    const houses = [];
    scatter(14, 5, (h, lx, lz) => lz > 0 && h < 4, (x, y, z) => houses.push(at(x, y - 0.05, z, 0.9, rand() * 6)));
    parts.push(stampAll(house('#f1e6d2', '#c8452f'), houses));
    const last = nodes.at(-1);
    parts.push(stampAll(lighthouse(), [at(last.x + 7, heightAt(last.x + 7 - cx, last.z - 7) - 0.1, last.z - 7, 1)]));
  } else if (chapter.id === 'alpine-summit') {
    const pines = [];
    scatter(240, 4, (h) => h > 1.2 && h < 12, (x, y, z) => pines.push(at(x, y - 0.1, z, 0.7 + rand() * 0.6, rand() * 6)));
    parts.push(stampAll(pine('#245c3a', { snow: true }), pines));
    const chalets = [];
    scatter(10, 5, (h, lx) => h < 7 && lx < 10, (x, y, z) => chalets.push(at(x, y - 0.05, z, 0.85, rand() * 6)));
    parts.push(stampAll(chalet(), chalets));
    // A flag on the highest point.
    let top = { h: 0, x: 0, z: 0 };
    for (let i = 0; i < 400; i++) {
      const lx = (rand() * 2 - 1) * ISLAND.rx * 0.8;
      const lz = -rand() * ISLAND.rz * 0.8;
      const h = heightAt(lx, lz);
      if (h > top.h) top = { h, x: lx, z: lz };
    }
    parts.push(stampAll(summitFlag(), [at(cx + top.x, top.h - 0.2, top.z, 1.2)]));
  } else {
    const neons = ['#ff2bd6', '#00e5ff', '#f7ff3c', '#7a5cff'];
    const groups = neons.map(() => ({}));
    // City blocks on a 12 m grid, taller away from the road.
    for (let gx = -ISLAND.rx + 6; gx < ISLAND.rx - 4; gx += 6) {
      for (let gz = -ISLAND.rz + 6; gz < ISLAND.rz - 4; gz += 6) {
        const r = nearestRoad(road, cx + gx, gz);
        if (r.d < 5 || rand() < 0.4) continue;
        // Low near the road (the camera looks down over it), taller towards the back.
        const h = 2.5 + rand() * (2 + Math.min(12, (r.d - 5) * 0.8)) * (gz < 0 ? 1.4 : 0.8);
        const k = Math.floor(rand() * neons.length);
        const bucket = Math.round(h / 3) * 3;
        (groups[k][bucket] ??= []).push(at(cx + gx + (rand() - 0.5), 1.15, gz + (rand() - 0.5), 1, Math.floor(rand() * 4) * (Math.PI / 2)));
      }
    }
    groups.forEach((byHeight, k) => {
      for (const [h, mats] of Object.entries(byHeight)) parts.push(stampAll(tower(Number(h), neons[k]), mats));
    });
    const boards = [];
    scatter(14, 3, () => true, (x, y, z) => boards.push(at(x, y, z, 1, rand() * 6)));
    parts.push(stampAll(billboard('#ff2bd6'), boards.slice(0, 7)), stampAll(billboard('#00e5ff'), boards.slice(7)));
    const last = nodes.at(-1);
    parts.push(stampAll(spire('#ff2bd6'), [at(last.x + 8, 1.1, last.z - 9, 1)]));
  }

  return { parts, road };
}

// Dotted ferry routes across the water between islands.
function seaRoutes(layout) {
  const parts = [];
  for (let ci = 0; ci < CHAPTERS.length - 1; ci++) {
    const a = layout[STAGES.findLastIndex((s) => s.chapterId === CHAPTERS[ci].id)];
    const b = layout[STAGES.findIndex((s) => s.chapterId === CHAPTERS[ci + 1].id)];
    const pts = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(a.x + 4, 0.05, a.z),
      new THREE.Vector3((a.x + b.x) / 2, 0.05, (a.z + b.z) / 2 + 22),
      new THREE.Vector3(b.x - 4, 0.05, b.z)
    ).getPoints(90);
    parts.push(ribbon(pts, 0.35, { lift: 0.05, color: '#ffffff', emissive: 0.5, dash: 2 }));
  }
  return parts;
}

export function buildWorld() {
  const rand = mulberry32(2026);
  const layout = nodeLayout();
  const parts = [];
  const roads = {};
  CHAPTERS.forEach((c, ci) => {
    const island = buildIsland(c, ci, rand);
    parts.push(...island.parts);
    roads[c.id] = island.road;
  });
  parts.push(...seaRoutes(layout));
  const geo = mergePainted(parts.filter(Boolean));
  const mesh = new THREE.Mesh(geo, createVertexPbrMaterial({ flatShading: true }));
  mesh.name = 'world';
  mesh.matrixAutoUpdate = false;

  // Sea: one big plane; its colour follows the chapter mood.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 600).rotateX(-Math.PI / 2).translate(chapterX(1), 0, 0),
    new THREE.MeshStandardMaterial({ color: MOODS['emerald-coast'].water, roughness: 0.25, metalness: 0.15 })
  );
  water.name = 'water';
  return { mesh, water, layout, roads, bounds: { minX: -HALF_X - 8, maxX: chapterX(CHAPTERS.length - 1) + HALF_X + 8 } };
}

export const chapterCenterX = (chapterId) => chapterX(CHAPTERS.findIndex((c) => c.id === chapterId));
