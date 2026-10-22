import * as THREE from 'three';
import { canvasTexture, mulberry32, smoothstep } from './noise.js';
import { mergePainted, paintVertices, stamp } from '../render/vertexPbr.js';

// Alpine Summit set-pieces: the stone tunnel through the summit ridge, the village and the
// snow poles along the road, the black-ice glaze on the glacier descent, and falling snow.

// ---------------------------------------------------------------------------
// Summit Tunnel: a stone-lined arch over the road, buried under a mound of mountain that
// covers the carved ground above it, with a stone portal wall and a name plate at each end and
// a row of lamps along the crown. The terrain under the mound is carved like any other road
// (race/alpineScenery.js), so nothing of the hillside can show inside the bore.
// ---------------------------------------------------------------------------

export const TUNNEL = { halfWidth: 13, wall: 5.5, crown: 10, floor: -1.4, cover: 14, mound: 62 };

// The bore's cross-section from the right foot, up and over the arch, to the left foot.
function boreProfile() {
  const { halfWidth: W, wall, crown, floor } = TUNNEL;
  const pts = [[W, floor], [W, wall]];
  const n = 14;
  for (let i = 1; i < n; i++) {
    const a = (i / n) * Math.PI;
    pts.push([W * Math.cos(a), wall + (crown - wall) * Math.sin(a)]);
  }
  pts.push([-W, wall], [-W, floor]);
  return pts;
}

function plateTexture(name) {
  return canvasTexture(THREE, 512, 96, (g, w, h) => {
    g.fillStyle = '#1d2a3a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e9edf2';
    g.lineWidth = 6;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#e9edf2';
    g.font = '800 46px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name.toUpperCase(), w / 2, h / 2 + 2);
  });
}

export function buildTunnels(track, def, terrain, groundMaterial, env) {
  if (!def.tunnels?.length) return null;
  const group = new THREE.Group();
  group.name = 'tunnels';
  const profile = boreProfile();
  const lengths = [0];
  for (let i = 1; i < profile.length; i++) lengths.push(lengths[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  const bore = { pos: [], uv: [], idx: [] };
  const mound = { pos: [], idx: [] };
  const wall = { pos: [], uv: [] };
  const lamps = [];
  const plates = [];
  const f = {};
  const T = TUNNEL;

  for (const tn of def.tunnels) {
    const s0 = tn.from * track.length;
    const s1 = tn.to * track.length;
    const rows = Math.ceil((s1 - s0) / 4);
    // Bore: profile swept along the road.
    const base = bore.pos.length / 3;
    for (let r = 0; r <= rows; r++) {
      const s = s0 + ((s1 - s0) * r) / rows;
      track.frame(s, f);
      const y0 = track.roadY(s);
      profile.forEach(([d, y], k) => {
        bore.pos.push(f.x + f.rx * d, y0 + y, f.z + f.rz * d);
        bore.uv.push(lengths[k] / 3.5, s / 3.5);
      });
    }
    const c = profile.length;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < c - 1; k++) {
        const a = base + r * c + k;
        bore.idx.push(a, a + c, a + 1, a + 1, a + c, a + c + 1);
      }
    }
    // Mound over it: at least `cover` metres of rock over the road, falling away to meet the
    // carved hillside on either side.
    const mBase = mound.pos.length / 3;
    const cols = [];
    for (let d = -T.mound; d <= T.mound + 0.01; d += 5) cols.push(d);
    const moundY = (s, d, x, z) => Math.max(terrain.sample(x, z).h + 0.35, track.roadY(s) + T.cover - Math.max(0, Math.abs(d) - 16) * 0.85);
    const tops = [[], []];
    for (let r = 0; r <= rows; r++) {
      const s = s0 + ((s1 - s0) * r) / rows;
      track.frame(s, f);
      for (const d of cols) {
        const x = f.x + f.rx * d;
        const z = f.z + f.rz * d;
        const y = moundY(s, d, x, z);
        mound.pos.push(x, y, z);
        if (r === 0) tops[0].push([d, y]);
        if (r === rows) tops[1].push([d, y]);
      }
    }
    const mc = cols.length;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < mc - 1; k++) {
        const a = mBase + r * mc + k;
        mound.idx.push(a, a + 1, a + mc, a + 1, a + mc + 1, a + mc);
      }
    }
    // Portal walls: the mound's cross-section down to below the road, with the bore cut out.
    for (const [end, s, out] of [[0, s0, -1], [1, s1, 1]]) {
      track.frame(s, f);
      const y0 = track.roadY(s);
      const shape = new THREE.Shape();
      const top = tops[end];
      shape.moveTo(top[0][0], -4);
      for (const [d, y] of top) shape.lineTo(d, y - y0);
      shape.lineTo(top[top.length - 1][0], -4);
      shape.closePath();
      const hole = new THREE.Path();
      profile.forEach(([d, y], k) => (k ? hole.lineTo(d, y) : hole.moveTo(d, y)));
      hole.closePath();
      shape.holes.push(hole);
      const g = new THREE.ShapeGeometry(shape, 6).toNonIndexed();
      const p = g.attributes.position;
      const push = 0.15 * out; // just outside the bore's end
      for (let i = 0; i < p.count; i++) {
        const d = p.getX(i);
        const y = p.getY(i);
        wall.pos.push(f.x + f.rx * d + f.tx * push, y0 + y, f.z + f.rz * d + f.tz * push);
        wall.uv.push(d / 3.5, y / 3.5);
      }
      // Name plate over the arch, facing the approaching car.
      const plate = new THREE.PlaneGeometry(9, 1.7).translate(0, T.crown + 1.6, 0);
      plate.rotateY(Math.atan2(f.tx * out, f.tz * out));
      plate.translate(f.x + f.tx * (push + 0.1 * out), y0, f.z + f.tz * (push + 0.1 * out));
      plates.push(plate);
    }
    // Lamps every 12 m on both sides of the crown.
    for (let s = s0 + 6; s < s1 - 3; s += 12) {
      track.frame(s, f);
      const y0 = track.roadY(s);
      const yaw = Math.atan2(f.tx, f.tz);
      for (const d of [-4.2, 4.2]) {
        const y = T.wall + (T.crown - T.wall) * Math.sqrt(Math.max(0, 1 - (d / T.halfWidth) ** 2)) - 0.12;
        lamps.push(new THREE.Matrix4().makeRotationY(yaw).setPosition(f.x + f.rx * d, y0 + y, f.z + f.rz * d));
      }
    }
  }

  const stoneMap = env?.tex.tunnelStone ?? null;
  const stone = new THREE.MeshLambertMaterial({ map: stoneMap, color: stoneMap ? 0xb8b4ae : 0x7d7a74, side: THREE.DoubleSide });
  const boreGeo = new THREE.BufferGeometry();
  boreGeo.setAttribute('position', new THREE.Float32BufferAttribute(bore.pos, 3));
  boreGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bore.uv, 2));
  boreGeo.setIndex(bore.idx);
  boreGeo.computeVertexNormals();
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wall.pos, 3));
  wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wall.uv, 2));
  wallGeo.computeVertexNormals();
  // Bore and portals share the stone: one draw.
  const stoneMesh = new THREE.Mesh(mergeStone(boreGeo, wallGeo), stone);
  stoneMesh.name = 'tunnel-stone';
  stoneMesh.castShadow = true;
  stoneMesh.receiveShadow = true;
  group.add(stoneMesh);

  const moundGeo = new THREE.BufferGeometry();
  moundGeo.setAttribute('position', new THREE.Float32BufferAttribute(mound.pos, 3));
  moundGeo.setIndex(mound.idx);
  moundGeo.computeVertexNormals();
  if (moundGeo.attributes.normal.getY(0) < 0) {
    const ia = moundGeo.index.array;
    for (let t = 0; t < ia.length; t += 3) [ia[t + 1], ia[t + 2]] = [ia[t + 2], ia[t + 1]];
    moundGeo.computeVertexNormals();
  }
  const moundMesh = new THREE.Mesh(moundGeo, groundMaterial);
  moundMesh.name = 'tunnel-mound';
  moundMesh.receiveShadow = true;
  group.add(moundMesh);

  // Sodium lamps: bright enough to bloom.
  const lampGeo = stamp(paintVertices(new THREE.BoxGeometry(0.5, 0.12, 1.6).toNonIndexed(), { color: 0xffd9a0 }), lamps);
  const lampMesh = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  lampMesh.name = 'tunnel-lamps';
  group.add(lampMesh);
  const plateGeo = mergeUv(plates);
  const plateMesh = new THREE.Mesh(plateGeo, new THREE.MeshBasicMaterial({ map: plateTexture(def.tunnels[0].name), side: THREE.DoubleSide }));
  group.add(plateMesh);
  group.userData.update = () => {};
  return group;
}

function mergeStone(a, b) {
  const g = a.toNonIndexed();
  const pos = new Float32Array([...g.attributes.position.array, ...b.attributes.position.array]);
  const nor = new Float32Array([...g.attributes.normal.array, ...b.attributes.normal.array]);
  const uv = new Float32Array([...g.attributes.uv.array, ...b.attributes.uv.array]);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

function mergeUv(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const cat = (name) => {
    const arrays = parts.map((g) => g.attributes[name].array);
    const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of arrays) {
      out.set(a, o);
      o += a.length;
    }
    return out;
  };
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(cat('position'), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(cat('normal'), 3));
  out.setAttribute('uv', new THREE.BufferAttribute(cat('uv'), 2));
  return out;
}

// 0..1: how deep inside a tunnel the camera is (dims the sun and the sky light there).
// `proj` is reused between frames (its `i` keeps the projection search local).
export function tunnelShade(track, cam, proj) {
  const tunnels = track.def.tunnels;
  if (!tunnels?.length) return 0;
  track.project(cam.x, cam.z, proj.i ?? -1, proj);
  if (Math.abs(proj.d) > TUNNEL.halfWidth || cam.y > proj.roadY + TUNNEL.crown) return 0;
  const L = track.length;
  let k = 0;
  for (const t of tunnels) {
    const s0 = t.from * L;
    const s1 = t.to * L;
    k = Math.max(k, smoothstep(s0 - 4, s0 + 22, proj.s) * (1 - smoothstep(s1 - 22, s1 + 4, proj.s)));
  }
  return k;
}

// ---------------------------------------------------------------------------
// The village (timber chalets on whitewashed stone, snow on the roofs, a chapel with an onion
// dome) and striped snow poles along the mountain road: one vertex-PBR mesh, one draw.
// ---------------------------------------------------------------------------

function chalet(rand) {
  const w = 8 + rand() * 3.5; // along the gable (x)
  const dpt = 7 + rand() * 2.5;
  const ground = 3 + rand() * 0.6;
  const upper = 2.6 + rand() * 1.4;
  const roofH = 2.4 + rand() * 1.2;
  const plaster = { color: rand() < 0.3 ? 0xe9e0cf : 0xf2efe8, roughness: 0.9 };
  const timber = { color: [0x7a4a28, 0x8c5a32, 0x5e3a22][Math.floor(rand() * 3)], roughness: 0.8 };
  const roof = { color: 0x3b3a3e, roughness: 0.7 };
  const snow = { color: 0xf4f7fb, roughness: 0.6 };
  const glass = { color: 0x2a2f38, roughness: 0.15, metalness: 0.2, emissive: 0.0 };
  const lit = { color: 0xffc77a, roughness: 0.4, emissive: 0.9 };
  const parts = [];
  parts.push(paintVertices(new THREE.BoxGeometry(w, ground, dpt).translate(0, ground / 2 - 0.5, 0).toNonIndexed(), plaster));
  parts.push(paintVertices(new THREE.BoxGeometry(w, upper, dpt).translate(0, ground - 0.5 + upper / 2, 0).toNonIndexed(), timber));
  // Gable ends: triangular prisms under the roof.
  const eaves = ground - 0.5 + upper;
  const gable = new THREE.BufferGeometry();
  const hw = w / 2;
  const hd = dpt / 2;
  const tri = [
    [-hw, eaves, hd], [hw, eaves, hd], [0, eaves + roofH, hd],
    [hw, eaves, -hd], [-hw, eaves, -hd], [0, eaves + roofH, -hd],
  ];
  gable.setAttribute('position', new THREE.Float32BufferAttribute(tri.flat(), 3));
  gable.computeVertexNormals();
  parts.push(paintVertices(gable, timber));
  // Roof slopes with a deep overhang, and a cap of snow on each.
  const over = 1.2;
  const slope = Math.hypot(hw + over, roofH + over * (roofH / hw));
  for (const side of [-1, 1]) {
    const ang = Math.atan2(roofH, hw);
    const panel = new THREE.BoxGeometry(slope, 0.3, dpt + over * 2).translate(side * (slope / 2), 0, 0);
    panel.rotateZ(side * -ang);
    panel.translate(0, eaves + roofH + 0.15, 0);
    parts.push(paintVertices(panel.toNonIndexed(), roof));
    const cap = new THREE.BoxGeometry(slope * 0.92, 0.28, dpt + over * 1.6).translate(side * (slope * 0.48), 0.28, 0);
    cap.rotateZ(side * -ang);
    cap.translate(0, eaves + roofH + 0.15, 0);
    parts.push(paintVertices(cap.toNonIndexed(), snow));
  }
  // Balcony across the front gable, windows with shutters, some lit.
  parts.push(paintVertices(new THREE.BoxGeometry(w * 0.85, 0.18, 1.3).translate(0, ground - 0.4, hd + 0.65).toNonIndexed(), timber));
  parts.push(paintVertices(new THREE.BoxGeometry(w * 0.85, 0.9, 0.08).translate(0, ground + 0.05, hd + 1.28).toNonIndexed(), timber));
  for (const x of [-hw * 0.5, hw * 0.5]) {
    for (const [y, z] of [[ground * 0.5 - 0.3, hd + 0.03], [ground + upper * 0.45, hd + 0.03], [ground * 0.5 - 0.3, -hd - 0.03]]) {
      parts.push(paintVertices(new THREE.BoxGeometry(1.1, 1.2, 0.08).translate(x, y, z).toNonIndexed(), rand() < 0.35 ? lit : glass));
      for (const sx of [-0.85, 0.85]) parts.push(paintVertices(new THREE.BoxGeometry(0.5, 1.25, 0.06).translate(x + sx, y, z + Math.sign(z) * 0.02).toNonIndexed(), { color: 0x2f5a3a, roughness: 0.8 }));
    }
  }
  // Chimney.
  parts.push(paintVertices(new THREE.BoxGeometry(0.8, 2.2, 0.8).translate(hw * 0.35, eaves + roofH * 0.8, -hd * 0.3).toNonIndexed(), { color: 0x8a8580, roughness: 0.9 }));
  return { geo: mergePainted(parts), depth: dpt };
}

function chapel() {
  const parts = [];
  const white = { color: 0xf3f0ea, roughness: 0.9 };
  parts.push(paintVertices(new THREE.BoxGeometry(9, 7, 15).translate(0, 3.5, 0).toNonIndexed(), white));
  const roof = new THREE.CylinderGeometry(0.1, 7, 4, 4, 1).rotateY(Math.PI / 4).scale(0.95, 1, 1.55).translate(0, 9, 0);
  parts.push(paintVertices(roof.toNonIndexed(), { color: 0x4a3a36, roughness: 0.7 }));
  parts.push(paintVertices(new THREE.BoxGeometry(4, 16, 4).translate(0, 8, -8.5).toNonIndexed(), white));
  parts.push(paintVertices(new THREE.CylinderGeometry(2.4, 2.4, 0.5, 12).translate(0, 16.2, -8.5).toNonIndexed(), { color: 0x6a3c24, roughness: 0.6 }));
  const dome = new THREE.SphereGeometry(2.3, 12, 8).scale(1, 1.25, 1).translate(0, 18.2, -8.5);
  parts.push(paintVertices(dome.toNonIndexed(), { color: 0x2c6a4a, roughness: 0.5, metalness: 0.4 }));
  parts.push(paintVertices(new THREE.ConeGeometry(0.7, 4, 8).translate(0, 22.6, -8.5).toNonIndexed(), { color: 0x2c6a4a, roughness: 0.5, metalness: 0.4 }));
  parts.push(paintVertices(new THREE.CylinderGeometry(1, 1, 0.12, 16).rotateX(Math.PI / 2).translate(0, 13.5, -6.45).toNonIndexed(), { color: 0xd8b04a, roughness: 0.3, metalness: 0.8 }));
  return mergePainted(parts);
}

function snowPole() {
  const parts = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const h = 2.2 / n;
    parts.push(paintVertices(new THREE.BoxGeometry(0.09, h, 0.09).translate(0, h * (i + 0.5), 0).toNonIndexed(), { color: i % 2 ? 0xf2f2ee : 0xd8262e, roughness: 0.5 }));
  }
  parts.push(paintVertices(new THREE.BoxGeometry(0.1, 0.12, 0.1).translate(0, 1.9, 0.01).toNonIndexed(), { color: 0xffa21a, roughness: 0.3, emissive: 0.4 }));
  return mergePainted(parts);
}

export function buildVillage(track, def, terrain, material) {
  const rand = mulberry32(61);
  const geos = [];
  const f = {};
  const pr = {};
  const placed = [];
  const free = (x, z, r) => placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + r);
  // Chalets on both sides of the village street and the run in to it.
  for (let s = -260; s < 250; s += 13) {
    for (const side of [-1, 1]) {
      if (rand() < 0.3) continue;
      track.frame(track.wrapS(s), f);
      const { geo, depth } = chalet(rand);
      const off = side * (track.fenceOffset + 6 + depth / 2 + rand() * 9);
      const x = f.x + f.rx * off;
      const z = f.z + f.rz * off;
      track.project(x, z, -1, pr);
      if (Math.abs(pr.d) < track.fenceOffset + 4 + depth / 2) continue;
      const { h, steep } = terrain.sample(x, z);
      if (steep > 0.3 || h < def.lakeLevel + 1.5 || !free(x, z, 7)) continue;
      placed.push({ x, z, r: 7 });
      // Gable end toward the road.
      const yaw = Math.atan2(-f.rx * side, -f.rz * side) + (rand() - 0.5) * 0.3;
      geos.push(geo.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, h, z)));
    }
  }
  // The chapel on the square.
  {
    const { x, z } = def.village;
    const { h } = terrain.sample(x, z);
    track.project(x, z, -1, pr);
    if (Math.abs(pr.d) > track.fenceOffset + 10) geos.push(chapel().applyMatrix4(new THREE.Matrix4().makeRotationY(0.4).setPosition(x, h, z)));
  }
  // Snow poles along the mountain road, outside the rails (not in the village or the tunnels).
  const pole = snowPole();
  const mats = [];
  const L = track.length;
  const inTunnel = (s) => (def.tunnels ?? []).some((t) => s > t.from * L - 6 && s < t.to * L + 6);
  for (let s = 260; s < L - 120; s += 28) {
    if (inTunnel(s)) continue;
    track.frame(s, f);
    for (const side of [-1, 1]) {
      const d = side * (track.fenceOffset + 0.45);
      mats.push(new THREE.Matrix4().makeRotationY(Math.atan2(f.tx, f.tz)).setPosition(f.x + f.rx * d, track.roadY(s) - 0.1, f.z + f.rz * d));
    }
  }
  geos.push(stamp(pole, mats));
  const mesh = new THREE.Mesh(mergePainted(geos), material);
  mesh.name = 'village';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Black ice: a glassy glaze over the road on the iced stretches. Its sheen follows how slick
// the ice is today; under fresh snow it frosts over white.
// ---------------------------------------------------------------------------

function iceTexture() {
  const tex = canvasTexture(THREE, 128, 256, (g, w, h) => {
    const rand = mulberry32(5);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = 10 + rand() * 34;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.5 + rand() * 0.4})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      for (const dy of [-h, 0, h]) {
        g.beginPath();
        g.ellipse(x, y + dy, r * 0.7, r, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Fine cracks.
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      let x = rand() * w;
      let y = rand() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (rand() - 0.5) * 30;
        y += (rand() - 0.5) * 30;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function buildIce(track) {
  if (!track.iceSpans?.length) return null;
  const hw = track.halfWidth - 0.4;
  const pos = [];
  const uv = [];
  const idx = [];
  const f = {};
  for (const { s0, s1 } of track.iceSpans) {
    const base = pos.length / 3;
    const rows = Math.ceil((s1 - s0) / 2);
    for (let r = 0; r <= rows; r++) {
      const s = s0 + ((s1 - s0) * r) / rows;
      track.frame(s, f);
      const y = track.roadY(s) + 0.025;
      for (const [d, u] of [[-hw, 0], [0, 0.5], [hw, 1]]) {
        pos.push(f.x + f.rx * d, y, f.z + f.rz * d);
        uv.push(u, (s - s0) / 14);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < 2; k++) {
        const a = base + r * 3 + k;
        idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (geo.attributes.normal.getY(0) < 0) {
    const ia = geo.index.array;
    for (let t = 0; t < ia.length; t += 3) [ia[t + 1], ia[t + 2]] = [ia[t + 2], ia[t + 1]];
    geo.computeVertexNormals();
  }
  const mat = new THREE.MeshStandardMaterial({
    color: 0xc4dcf2,
    alphaMap: iceTexture(),
    transparent: true,
    opacity: 0.4,
    roughness: 0.06,
    metalness: 0,
    envMapIntensity: 1.4,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'black-ice';
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;
  const glaze = new THREE.Color(0xc4dcf2);
  const frost = new THREE.Color(0xf7faff);
  mesh.userData.setLevel = (level, snow) => {
    mesh.visible = level > 0;
    mat.opacity = 0.1 + 0.32 * level;
    mat.color.copy(glaze).lerp(frost, Math.min(1, snow));
    mat.roughness = 0.06 + 0.5 * Math.min(1, snow);
  };
  return mesh;
}

// ---------------------------------------------------------------------------
// Falling snow: soft flakes in a box that wraps around the camera, drifting on the wind and
// swaying as they fall. One Points draw; hidden when nothing is falling.
// ---------------------------------------------------------------------------

const SNOW_BOX = new THREE.Vector3(60, 30, 60);
const SNOW_COUNT = { low: 900, medium: 1700, high: 2500 };

export class Snowfall {
  constructor(scene, quality = 'medium') {
    const n = SNOW_COUNT[quality] ?? SNOW_COUNT.medium;
    const rand = mulberry32(8);
    const seed = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      seed.set([rand(), rand(), rand()], i * 3);
      phase[i] = rand() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(seed, 3));
    geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    this.uniforms = {
      origin: { value: new THREE.Vector3() },
      box: { value: SNOW_BOX.clone() },
      time: { value: 0 },
      fall: { value: 2 },
      wind: { value: new THREE.Vector2(1, -0.5) },
      density: { value: 0 },
      pxScale: { value: 400 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float phase;
        uniform vec3 origin, box;
        uniform float time, fall, density, pxScale;
        uniform vec2 wind;
        varying float vAlpha;
        void main() {
          float speed = 0.75 + position.z * 0.5;
          vec3 p = position * box - vec3(wind.x, -fall, wind.y) * time * speed;
          p.x += sin(time * 1.3 + phase) * 0.6;
          p.z += cos(time * 1.1 + phase * 1.7) * 0.6;
          p = origin + mod(p - origin, box) - box * 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vAlpha = smoothstep(30.0, 8.0, d) * smoothstep(0.6, 2.0, d) * step(position.x, density + 0.001);
          gl_PointSize = clamp(0.09 * pxScale / max(d, 0.5), 1.0, 14.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, r) * vAlpha;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vec3(0.97, 0.98, 1.0), a * 0.85);
        }`,
    });
    this.mesh = new THREE.Points(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.size = new THREE.Vector2();
  }

  set(amount) {
    const a = Math.min(1, amount);
    const u = this.uniforms;
    u.density.value = a;
    // Heavier snow falls faster and blows sideways.
    u.fall.value = 1.6 + a * 2.2;
    u.wind.value.set(1 + a * 7, -(0.5 + a * 3));
    this.mesh.visible = a > 0;
  }

  update(time, camera, renderer) {
    if (!this.mesh.visible) return;
    const u = this.uniforms;
    u.time.value = time;
    u.origin.value.copy(camera.position);
    // Pixels per metre at 1 m: half the drawing buffer height over tan(fov / 2).
    const h = renderer ? renderer.getDrawingBufferSize(this.size).y : window.innerHeight;
    u.pxScale.value = h / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  }
}
