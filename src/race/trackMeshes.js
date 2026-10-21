import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, mulberry32 } from './noise.js';

// Render geometry generated from the race spline: asphalt, shoulders, kerbs, embankment,
// wooden barrier fences, chevron boards, jump ramps and the start/finish gantry.

const ROAD_TILE = 40; // metres of road per texture repeat

function roadTexture(maxAniso) {
  const tex = canvasTexture(THREE, 256, 512, (g, w, h) => {
    const rand = mulberry32(7);
    g.fillStyle = '#3a3d42';
    g.fillRect(0, 0, w, h);
    // Aggregate speckle.
    for (let i = 0; i < 9000; i++) {
      const v = 40 + rand() * 50;
      g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + rand() * 0.4})`;
      g.fillRect(rand() * w, rand() * h, 1 + rand() * 1.5, 1 + rand() * 1.5);
    }
    // Darker tyre-worn lines in each lane.
    g.fillStyle = 'rgba(15,16,18,0.18)';
    for (const lane of [1 / 6, 3 / 6, 5 / 6]) {
      for (const off of [-0.055, 0.055]) g.fillRect((lane + off) * w - 6, 0, 12, h);
    }
    // Edge lines and dashed lane dividers.
    g.fillStyle = '#f2f2ee';
    g.fillRect(w * 0.012, 0, 4, h);
    g.fillRect(w * 0.988 - 4, 0, 4, h);
    for (const lane of [1 / 3, 2 / 3]) {
      for (let k = 0; k < 2; k++) g.fillRect(lane * w - 2, k * (h / 2), 4, h / 4);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

function concreteTexture() {
  const tex = canvasTexture(THREE, 64, 256, (g, w, h) => {
    const rand = mulberry32(11);
    g.fillStyle = '#8f8c86';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      const v = 110 + rand() * 60;
      g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.35)`;
      g.fillRect(rand() * w, rand() * h, 1.5, 1.5);
    }
    g.fillStyle = 'rgba(40,40,40,0.35)';
    g.fillRect(0, h - 2, w, 2);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function stripeTexture(a, b, n = 2) {
  const tex = canvasTexture(THREE, 16, 64, (g, w, h) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? b : a;
      g.fillRect(0, (i * h) / n, w, h / n);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function woodTexture() {
  const tex = canvasTexture(THREE, 128, 32, (g, w, h) => {
    const rand = mulberry32(5);
    g.fillStyle = '#8a5a32';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(${60 + rand() * 30},${35 + rand() * 20},15,${0.25 + rand() * 0.3})`;
      g.lineWidth = 1;
      g.beginPath();
      const y = rand() * h;
      g.moveTo(0, y);
      g.bezierCurveTo(w * 0.3, y + rand() * 4 - 2, w * 0.7, y + rand() * 4 - 2, w, y + rand() * 3 - 1.5);
      g.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function chevronTexture() {
  return canvasTexture(THREE, 128, 64, (g, w, h) => {
    g.fillStyle = '#d81e2c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    for (const x of [18, 58]) {
      g.beginPath();
      g.moveTo(x, 8);
      g.lineTo(x + 26, h / 2);
      g.lineTo(x, h - 8);
      g.lineTo(x + 14, h - 8);
      g.lineTo(x + 40, h / 2);
      g.lineTo(x + 14, 8);
      g.closePath();
      g.fill();
    }
  });
}

function rampTexture() {
  const tex = canvasTexture(THREE, 128, 128, (g, w, h) => {
    g.fillStyle = '#f5c400';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#16171a';
    for (let i = -2; i < 4; i++) {
      g.beginPath();
      g.moveTo(0, i * 48 + 20);
      g.lineTo(w / 2, i * 48 - 10);
      g.lineTo(w, i * 48 + 20);
      g.lineTo(w, i * 48 + 40);
      g.lineTo(w / 2, i * 48 + 10);
      g.lineTo(0, i * 48 + 40);
      g.closePath();
      g.fill();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function bannerTexture(title, subtitle) {
  return canvasTexture(THREE, 1024, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#c8102e');
    grad.addColorStop(1, '#ff6a13');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const sq = 16;
    for (let x = 0; x < w; x += sq) {
      for (let y = 0; y < 2; y++) {
        g.fillStyle = (x / sq + y) % 2 ? '#111' : '#fff';
        g.fillRect(x, y * sq, sq, sq);
        g.fillRect(x, h - (y + 1) * sq, sq, sq);
      }
    }
    g.fillStyle = '#fff';
    g.font = 'italic 900 52px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(title, w / 2, h / 2 - 2);
    g.font = '700 16px system-ui, sans-serif';
    g.fillText(subtitle, w - 130, h / 2 + 2);
  });
}

// A strip that follows the track between lateral offsets, sampled every `step` samples.
// `cols` is a list of [d, dy, u] across the strip.
function ribbon(track, cols, { from = 0, to = track.n, step = 1, vScale = ROAD_TILE, lift = 0 } = {}) {
  const pos = [];
  const uv = [];
  const rows = [];
  for (let k = from; k <= to; k += step) rows.push(Math.min(k, to));
  if (rows[rows.length - 1] !== to) rows.push(to);
  const f = {};
  for (const k of rows) {
    const s = k >= track.n ? track.length : track.s[k];
    track.frame(s, f);
    for (const [d, dy, u] of cols) {
      pos.push(f.x + f.rx * d, f.y + dy + lift, f.z + f.rz * d);
      uv.push(u, s / vScale);
    }
  }
  const index = [];
  const c = cols.length;
  for (let r = 0; r < rows.length - 1; r++) {
    for (let j = 0; j < c - 1; j++) {
      const a = r * c + j;
      const b = a + c;
      // Winding so faces point up when d increases to the right of travel.
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

function fixUpNormals(geo) {
  // Flip winding if the strip came out facing down.
  const n = geo.attributes.normal;
  if (n.count && n.getY(0) < 0) {
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    geo.computeVertexNormals();
  }
  return geo;
}

export function buildTrackMeshes(track, renderer) {
  const group = new THREE.Group();
  group.name = 'track';
  const hw = track.halfWidth;
  const sh = track.shoulder;
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // Asphalt.
  const road = new THREE.Mesh(
    fixUpNormals(ribbon(track, [[-hw, 0, 0], [0, 0, 0.5], [hw, 0, 1]])),
    new THREE.MeshStandardMaterial({ map: roadTexture(maxAniso), roughness: 0.88, metalness: 0 })
  );
  road.receiveShadow = true;
  group.add(road);

  // Shoulders and grassy embankment falling away to the terrain.
  const concrete = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95 });
  const shoulders = mergeGeometries([
    fixUpNormals(ribbon(track, [[hw, 0, 0], [hw + sh, 0, 1]], { vScale: 8 })),
    fixUpNormals(ribbon(track, [[-hw - sh, 0, 0], [-hw, 0, 1]], { vScale: 8 })),
  ]);
  const shoulderMesh = new THREE.Mesh(shoulders, concrete);
  shoulderMesh.receiveShadow = true;
  group.add(shoulderMesh);

  const bank = mergeGeometries([
    fixUpNormals(ribbon(track, [[hw + sh, 0, 0], [hw + sh + 2.5, -0.6, 0.5], [hw + sh + 9, -4.2, 1]], { step: 2, vScale: 10 })),
    fixUpNormals(ribbon(track, [[-hw - sh - 9, -4.2, 0], [-hw - sh - 2.5, -0.6, 0.5], [-hw - sh, 0, 1]], { step: 2, vScale: 10 })),
  ]);
  group.add(new THREE.Mesh(bank, new THREE.MeshLambertMaterial({ color: 0x5f7f3a })));

  // Red/white kerbs through the corners.
  const kerbGeos = [];
  let start = -1;
  const sharp = (i) => Math.abs(track.curv[i]) > 1 / 150;
  for (let i = 0; i <= track.n; i++) {
    const on = i < track.n && sharp(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const from = Math.max(0, start - 8);
      const to = Math.min(track.n, i + 8);
      kerbGeos.push(fixUpNormals(ribbon(track, [[hw - 0.15, 0.02, 0], [hw + 0.9, 0.02, 1]], { from, to, vScale: 4 })));
      kerbGeos.push(fixUpNormals(ribbon(track, [[-hw - 0.9, 0.02, 0], [-hw + 0.15, 0.02, 1]], { from, to, vScale: 4 })));
      start = -1;
    }
  }
  if (kerbGeos.length) {
    const kerbs = new THREE.Mesh(
      mergeGeometries(kerbGeos),
      new THREE.MeshStandardMaterial({ map: stripeTexture('#d81e2c', '#f4f4f4'), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 })
    );
    kerbs.receiveShadow = true;
    group.add(kerbs);
  }

  group.add(buildFences(track));
  group.add(buildChevrons(track));
  group.add(buildRamps(track));
  group.add(buildStartLine(track));
  return group;
}

function buildFences(track) {
  const group = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ map: woodTexture() });
  const spacing = 3.2;
  const count = Math.floor(track.length / spacing);
  const postGeo = new THREE.BoxGeometry(0.2, 1.25, 0.2);
  postGeo.translate(0, 0.42, 0);
  const railGeo = new THREE.BoxGeometry(1, 0.2, 0.07);
  const posts = new THREE.InstancedMesh(postGeo, wood, count * 2);
  const rails = new THREE.InstancedMesh(railGeo, wood, count * 4);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YZX');
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  let pi = 0;
  let ri = 0;
  for (const side of [-1, 1]) {
    const d = side * track.fenceOffset;
    for (let k = 0; k < count; k++) {
      track.point(k * spacing, d, a);
      a.y = track.roadY(k * spacing) - 0.15;
      track.point((k + 1) * spacing, d, b);
      b.y = track.roadY((k + 1) * spacing) - 0.15;
      m.makeTranslation(a.x, a.y, a.z);
      posts.setMatrixAt(pi++, m);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      e.set(0, Math.atan2(-dz, dx), Math.atan2(b.y - a.y, len));
      q.setFromEuler(e);
      for (const h of [0.35, 0.82]) {
        p.set((a.x + b.x) / 2, (a.y + b.y) / 2 + h, (a.z + b.z) / 2);
        sc.set(Math.hypot(len, b.y - a.y) + 0.05, 1, 1);
        m.compose(p, q, sc);
        rails.setMatrixAt(ri++, m);
      }
    }
  }
  posts.count = pi;
  rails.count = ri;
  group.add(posts, rails);
  return group;
}

function buildChevrons(track) {
  const geo = new THREE.PlaneGeometry(1.8, 0.9);
  geo.translate(0, 1.3, 0);
  const mat = new THREE.MeshLambertMaterial({ map: chevronTexture(), side: THREE.DoubleSide });
  const placements = [];
  // Boards on the outside of every tight corner, facing approaching traffic.
  for (let i = 0; i < track.n; i += 9) {
    const k = track.curv[i];
    if (Math.abs(k) < 1 / 95) continue;
    placements.push({ s: track.s[i], dir: Math.sign(k) });
  }
  const mesh = new THREE.InstancedMesh(geo, mat, placements.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const f = {};
  placements.forEach(({ s, dir }, idx) => {
    track.frame(s, f);
    const d = -dir * (track.fenceOffset + 0.35);
    p.set(f.x + f.rx * d, track.roadY(s) - 0.1, f.z + f.rz * d);
    // Plane faces +z by default; turn it to face back down the road.
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-f.tx, -f.tz));
    m.compose(p, q, new THREE.Vector3(dir, 1, 1));
    mesh.setMatrixAt(idx, m);
  });
  return mesh;
}

function buildRamps(track) {
  const group = new THREE.Group();
  const top = new THREE.MeshStandardMaterial({ map: rampTexture(), roughness: 0.6, metalness: 0.1 });
  const side = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.7, metalness: 0.4 });
  const a = new THREE.Vector3();
  for (const r of track.ramps) {
    const pos = [];
    const uv = [];
    const groups = [];
    const quad = (p0, p1, p2, p3, uvs) => {
      pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
      uv.push(...uvs[0], ...uvs[1], ...uvs[2], ...uvs[0], ...uvs[2], ...uvs[3]);
    };
    const steps = Math.ceil(r.length);
    const pt = (ds, d, onTop) => {
      const s = r.s0 + ds;
      track.point(s, d, a);
      a.y = track.roadY(s) + (onTop ? (r.height * ds) / r.length : 0) + 0.015;
      return [a.x, a.y, a.z];
    };
    const width = r.to - r.from;
    const topStart = 0;
    for (let k = 0; k < steps; k++) {
      const s0 = (k / steps) * r.length;
      const s1 = ((k + 1) / steps) * r.length;
      quad(pt(s0, r.from, true), pt(s0, r.to, true), pt(s1, r.to, true), pt(s1, r.from, true), [
        [0, s0 / 4], [width / 4, s0 / 4], [width / 4, s1 / 4], [0, s1 / 4],
      ]);
    }
    groups.push([topStart, pos.length / 3]);
    const sideStart = pos.length / 3;
    for (let k = 0; k < steps; k++) {
      const s0 = (k / steps) * r.length;
      const s1 = ((k + 1) / steps) * r.length;
      const zero = [[0, 0], [0, 0], [0, 0], [0, 0]];
      quad(pt(s0, r.from, false), pt(s1, r.from, false), pt(s1, r.from, true), pt(s0, r.from, true), zero);
      quad(pt(s0, r.to, true), pt(s1, r.to, true), pt(s1, r.to, false), pt(s0, r.to, false), zero);
    }
    const L = r.length;
    quad(pt(L, r.from, false), pt(L, r.to, false), pt(L, r.to, true), pt(L, r.from, true), [[0, 0], [0, 0], [0, 0], [0, 0]]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.addGroup(groups[0][0], groups[0][1], 0);
    geo.addGroup(sideStart, pos.length / 3 - sideStart, 1);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, [top, side]);
    mesh.material.forEach((mm) => (mm.side = THREE.DoubleSide));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

function buildStartLine(track) {
  const group = new THREE.Group();
  const hw = track.halfWidth;
  const checker = canvasTexture(THREE, 256, 32, (g, w, h) => {
    const sq = 16;
    for (let x = 0; x < w; x += sq) for (let y = 0; y < h; y += sq) {
      g.fillStyle = (x / sq + y / sq) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(x, y, sq, sq);
    }
  });
  const lineGeo = new THREE.BufferGeometry();
  const f = {};
  const pos = [];
  for (const [ds, d] of [[-1.2, -hw], [-1.2, hw], [1.2, hw], [1.2, -hw]]) {
    track.frame(track.wrapS(ds), f);
    pos.push(f.x + f.rx * d, track.roadY(track.wrapS(ds)) + 0.02, f.z + f.rz * d);
  }
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lineGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  lineGeo.setIndex([0, 2, 1, 0, 3, 2]);
  lineGeo.computeVertexNormals();
  if (lineGeo.attributes.normal.getY(0) < 0) lineGeo.setIndex([0, 1, 2, 0, 2, 3]);
  lineGeo.computeVertexNormals();
  const line = new THREE.Mesh(lineGeo, new THREE.MeshStandardMaterial({ map: checker, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
  line.receiveShadow = true;
  group.add(line);

  // Gantry over the line.
  track.frame(0, f);
  const y = track.roadY(0);
  const gantry = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.4, metalness: 0.8 });
  const span = (track.fenceOffset + 1) * 2;
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8.4, 0.7), steel);
    pillar.position.set(0, 4.2, side * span / 2);
    pillar.castShadow = true;
    gantry.add(pillar);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.9, span + 0.7), steel);
  beam.position.y = 7.6;
  gantry.add(beam);
  const banner = bannerTexture('APEX OVERDRIVE', 'EMERALD COAST');
  const bannerMat = new THREE.MeshBasicMaterial({ map: banner, toneMapped: false });
  for (const side of [-1, 1]) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(span, span / 8), bannerMat);
    board.position.set(side * 0.42, 7.6, 0);
    board.rotation.y = side * Math.PI / 2;
    gantry.add(board);
  }
  // Gantry local +x points along the track.
  gantry.position.set(f.x, y, f.z);
  gantry.rotation.y = Math.atan2(-f.tz, f.tx);
  group.add(gantry);
  return group;
}
