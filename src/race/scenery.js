import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise2D, fbm, mulberry32, smoothstep } from './noise.js';

// Emerald Coast biome: sky, sun, ocean with emerald shallows, cliff terrain carved around the
// road, palms, umbrella pines, cypress, rocks, a lighthouse headland and sailboats.
// Everything is generated from a fixed seed at load time; no textures are downloaded.

const SKY = {
  top: new THREE.Color(0x2f73c9),
  horizon: new THREE.Color(0xcfe3ee),
  sun: new THREE.Color(0xfff2d2),
};
export const FOG_COLOR = SKY.horizon.clone();

function sunDirection(sun) {
  const { azimuth, elevation } = sun;
  return new THREE.Vector3(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth)).normalize();
}

function skyMaterial(sunDir) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: SKY.top },
      horizon: { value: SKY.horizon },
      sunColor: { value: SKY.sun },
      sunDir: { value: sunDir },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top, horizon, sunColor, sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(horizon, top, pow(h, 0.55));
        // Below the horizon the fogged ocean takes over; keep it hazy.
        col = mix(col, horizon * 0.92, smoothstep(0.0, -0.08, d.y));
        float s = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 24.0) * 0.32 + pow(s, 4.0) * 0.08);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function waterNormalMap(size = 128) {
  // Tileable sum of integer-frequency waves, converted to a normal map.
  const h = new Float32Array(size * size);
  const rand = mulberry32(21);
  const waves = Array.from({ length: 10 }, () => ({
    fx: Math.floor(rand() * 7) - 3,
    fy: Math.floor(rand() * 7) - 3,
    a: 0.3 + rand(),
    p: rand() * Math.PI * 2,
  })).filter((w) => w.fx || w.fy);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const w of waves) v += w.a * Math.sin(((w.fx * x + w.fy * y) / size) * Math.PI * 2 + w.p);
      h[y * size + x] = v;
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const d = h[((y + 1) % size) * size + x];
      const nx = (l - r) * 0.5;
      const ny = (u - d) * 0.5;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

const TERRAIN = { x0: -1500, x1: 1500, z0: -1300, z1: 700, cell: 10 };

function buildTerrain(track, def, quality) {
  const { x0, x1, z0, z1 } = TERRAIN;
  const cell = quality === 'low' ? 16 : quality === 'medium' ? 12 : TERRAIN.cell;
  const nx = Math.round((x1 - x0) / cell) + 1;
  const nz = Math.round((z1 - z0) / cell) + 1;
  const cx = (x1 - x0) / (nx - 1);
  const cz = (z1 - z0) / (nz - 1);
  const noise = createNoise2D(3);
  const detail = createNoise2D(9);

  // Distance from every vertex to the road (and the road height there), rasterized
  // from the spline samples.
  const dist = new Float32Array(nx * nz).fill(1e6);
  const roadY = new Float32Array(nx * nz);
  const R = 130;
  for (let i = 0; i < track.n; i++) {
    const px = track.px[i];
    const pz = track.pz[i];
    const ia = Math.max(0, Math.floor((px - R - x0) / cx));
    const ib = Math.min(nx - 1, Math.ceil((px + R - x0) / cx));
    const ja = Math.max(0, Math.floor((pz - R - z0) / cz));
    const jb = Math.min(nz - 1, Math.ceil((pz + R - z0) / cz));
    for (let j = ja; j <= jb; j++) {
      const z = z0 + j * cz;
      for (let k = ia; k <= ib; k++) {
        const x = x0 + k * cx;
        const d = Math.hypot(x - px, z - pz);
        const idx = j * nx + k;
        if (d < dist[idx]) {
          dist[idx] = d;
          roadY[idx] = track.py[i];
        }
      }
    }
  }

  const natural = (x, z) => {
    const dc = z - def.coastZ(x); // > 0 out at sea
    const inland = Math.max(0, -dc);
    let land = 16 + fbm(noise, x / 420, z / 420, 4) * 46 + Math.min(70, inland * 0.07) + fbm(detail, x / 60, z / 60, 2) * 3;
    land = Math.max(land, 6);
    const t = smoothstep(-26, 4, dc);
    const sea = -16 - Math.min(40, Math.max(0, dc) * 0.06) + fbm(detail, x / 35, z / 35, 2) * 5;
    return land + (sea - land) * t;
  };

  const heights = new Float32Array(nx * nz);
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let k = 0; k < nx; k++) {
      const idx = j * nx + k;
      const x = x0 + k * cx;
      const z = z0 + j * cz;
      let h = natural(x, z);
      const d = dist[idx];
      if (d < R) {
        const target = roadY[idx] - 3.6;
        const w = smoothstep(16, 58, d);
        // Never let the terrain rise above the road bed close to the road.
        h = target + (h - target) * w;
      }
      heights[idx] = h;
      pos[idx * 3] = x;
      pos[idx * 3 + 1] = h;
      pos[idx * 3 + 2] = z;
    }
  }

  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let k = 0; k < nx - 1; k++) {
      const a = j * nx + k;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      index[p++] = a; index[p++] = c; index[p++] = b;
      index[p++] = b; index[p++] = c; index[p++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();

  // Vertex colours: sand at the waterline, rock on steep faces, grass elsewhere.
  const normals = geo.attributes.normal;
  const colors = new Float32Array(nx * nz * 3);
  const sand = new THREE.Color(0xe0cf9f);
  const rock = new THREE.Color(0x8c8172);
  const rockDark = new THREE.Color(0x5e564c);
  const grass = new THREE.Color(0x6e9d3a);
  const grassDark = new THREE.Color(0x3f6e2b);
  const dry = new THREE.Color(0xa9a85f);
  const c = new THREE.Color();
  for (let i = 0; i < nx * nz; i++) {
    const h = heights[i];
    const steep = 1 - normals.getY(i);
    const x = pos[i * 3];
    const z = pos[i * 3 + 2];
    const n = fbm(detail, x / 45, z / 45, 2) * 0.5 + 0.5;
    c.copy(grassDark).lerp(grass, n);
    c.lerp(dry, smoothstep(45, 90, h) * 0.6);
    if (steep > 0.28) c.copy(rockDark).lerp(rock, n).lerp(c, smoothstep(0.42, 0.28, steep));
    if (h < 2.5) c.lerp(sand, smoothstep(2.5, 0.6, h));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'terrain';

  const sample = (x, z) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / cx));
    const fz = Math.min(nz - 1.001, Math.max(0, (z - z0) / cz));
    const k = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - k;
    const v = fz - j;
    const i = j * nx + k;
    const h = heights[i] * (1 - u) * (1 - v) + heights[i + 1] * u * (1 - v) + heights[i + nx] * (1 - u) * v + heights[i + nx + 1] * u * v;
    return { h, road: dist[i], steep: 1 - normals.getY(i) };
  };
  return { mesh, sample };
}

// ---------------------------------------------------------------------------
// Vegetation, rocks and landmarks
// ---------------------------------------------------------------------------

function palmGeometries() {
  const trunk = new THREE.CylinderGeometry(0.16, 0.28, 8, 6, 6);
  trunk.translate(0, 4, 0);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i);
    tp.setX(i, tp.getX(i) + (y / 8) ** 2 * 1.2); // gentle lean
  }
  trunk.computeVertexNormals();
  const fronds = [];
  for (let i = 0; i < 8; i++) {
    const f = new THREE.PlaneGeometry(4.2, 0.9, 4, 1);
    f.translate(2.1, 0, 0);
    const fp = f.attributes.position;
    for (let k = 0; k < fp.count; k++) {
      const x = fp.getX(k);
      fp.setZ(k, fp.getY(k));
      fp.setY(k, -0.09 * x * x + 0.3 * x);
    }
    f.rotateY((i / 8) * Math.PI * 2 + (i % 2) * 0.2);
    f.translate(1.2, 8, 0);
    fronds.push(f);
  }
  const crown = mergeGeometries(fronds);
  crown.computeVertexNormals();
  return { trunk, crown };
}

function pineGeometries() {
  const trunk = new THREE.CylinderGeometry(0.22, 0.34, 6, 6);
  trunk.translate(0, 3, 0);
  const crown = new THREE.IcosahedronGeometry(3.4, 1);
  crown.scale(1.25, 0.5, 1.25);
  crown.translate(0, 6.6, 0);
  return { trunk, crown };
}

function cypressGeometry() {
  const g = new THREE.ConeGeometry(1.3, 9, 7, 3);
  g.translate(0, 4.8, 0);
  return g;
}

function scatter(meshes, transforms) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const color = new THREE.Color();
  transforms.forEach((t, i) => {
    q.setFromAxisAngle(up, t.rot);
    p.set(t.x, t.y, t.z);
    s.set(t.scale, t.scale * (t.stretch ?? 1), t.scale);
    m.compose(p, q, s);
    for (const mesh of meshes) {
      mesh.setMatrixAt(i, m);
      if (mesh.instanceColor !== undefined && t.tint !== undefined) mesh.setColorAt(i, color.setHSL(...t.tint));
    }
  });
  meshes.forEach((mesh) => {
    mesh.count = transforms.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
}

function buildVegetation(def, terrain, quality) {
  const group = new THREE.Group();
  const rand = mulberry32(42);
  const density = quality === 'low' ? 0.5 : quality === 'medium' ? 0.8 : 1;
  const palms = [];
  const pines = [];
  const cypress = [];
  const { x0, x1, z0, z1 } = TERRAIN;
  const tries = Math.round(26000 * density);
  for (let i = 0; i < tries; i++) {
    const x = -1100 + rand() * 2200;
    const z = -900 + rand() * 1250;
    const { h, road, steep } = terrain.sample(x, z);
    if (h < 3 || road < 17 || steep > 0.3) continue;
    const coastDist = def.coastZ(x) - z;
    const t = { x, y: h - 0.2, z, rot: rand() * Math.PI * 2, scale: 0.8 + rand() * 0.55 };
    if (coastDist < 120 && rand() < 0.5) {
      if (palms.length < 260 * density) palms.push(t);
    } else if (road < 300 && rand() < 0.12) {
      // Thicker near the road where the player sees them; sparse in the distance.
      if (rand() < 0.35) cypress.push({ ...t, stretch: 0.9 + rand() * 0.5 });
      else pines.push(t);
    } else if (rand() < 0.01) {
      pines.push(t);
    }
    if (pines.length > 700 * density) break;
  }
  void x0; void x1; void z0; void z1;

  const bark = new THREE.MeshLambertMaterial({ color: 0x7a5a3c });
  const palmLeaf = new THREE.MeshLambertMaterial({ color: 0x4f9a3a, side: THREE.DoubleSide });
  const pineLeaf = new THREE.MeshLambertMaterial({ color: 0x2f5f2a, flatShading: true });
  const cypressLeaf = new THREE.MeshLambertMaterial({ color: 0x24492a, flatShading: true });

  const palm = palmGeometries();
  const palmTrunk = new THREE.InstancedMesh(palm.trunk, bark, palms.length);
  const palmCrown = new THREE.InstancedMesh(palm.crown, palmLeaf, palms.length);
  scatter([palmTrunk, palmCrown], palms);

  const pine = pineGeometries();
  const pineTrunk = new THREE.InstancedMesh(pine.trunk, bark, pines.length);
  const pineCrown = new THREE.InstancedMesh(pine.crown, pineLeaf, pines.length);
  scatter([pineTrunk, pineCrown], pines);

  const cyp = new THREE.InstancedMesh(cypressGeometry(), cypressLeaf, cypress.length);
  scatter([cyp], cypress);

  group.add(palmTrunk, palmCrown, pineTrunk, pineCrown, cyp);
  return group;
}

function buildRocks(def, terrain) {
  const rand = mulberry32(77);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  const noise = createNoise2D(5);
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const k = 1 + noise(v.x * 2 + 3, v.z * 2 + v.y) * 0.25;
    p.setXYZ(i, v.x * k, v.y * k * 0.8, v.z * k);
  }
  geo.computeVertexNormals();
  const items = [];
  for (let i = 0; i < 900 && items.length < 260; i++) {
    const x = -1200 + rand() * 2400;
    const zc = def.coastZ(x);
    const z = zc - 30 + rand() * 70;
    const { h, road } = terrain.sample(x, z);
    if (road < 18 || h > 24 || h < -6) continue;
    items.push({ x, y: h - 0.4, z, rot: rand() * 6.28, scale: 1.5 + rand() * 3.5, stretch: 0.8 + rand() * 0.6 });
  }
  // Sea stacks offshore.
  for (let i = 0; i < 14; i++) {
    const x = -900 + rand() * 1800;
    const z = def.coastZ(x) + 40 + rand() * 160;
    items.push({ x, y: -2, z, rot: rand() * 6.28, scale: 5 + rand() * 8, stretch: 1.4 + rand() * 1.4 });
  }
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x8a8070, flatShading: true }), items.length);
  scatter([mesh], items);
  return mesh;
}

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#c8102e' : '#f4f4f0';
    g.fillRect(0, i * 16, 4, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildLighthouse(def, terrain) {
  const group = new THREE.Group();
  const x = def.lighthouseX;
  const z = def.coastZ(x) - 26;
  const { h } = terrain.sample(x, z);
  group.position.set(x, h - 0.5, z);
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(2.1, 3.1, 22, 20),
    new THREE.MeshLambertMaterial({ map: stripeTexture() })
  );
  tower.position.y = 11;
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.4, 20), new THREE.MeshLambertMaterial({ color: 0x22252b }));
  gallery.position.y = 22.2;
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  lampMat.color.multiplyScalar(2);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.2, 16), lampMat);
  lamp.position.y = 23.5;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2, 16), new THREE.MeshLambertMaterial({ color: 0xb01020 }));
  roof.position.y = 25.6;
  const house = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 6), new THREE.MeshLambertMaterial({ color: 0xf0ece2 }));
  house.position.set(6, 2, 2);
  const houseRoof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 2.4, 4), new THREE.MeshLambertMaterial({ color: 0xa8432b }));
  houseRoof.position.set(6, 5.2, 2);
  houseRoof.rotation.y = Math.PI / 4;
  houseRoof.scale.set(1, 1, 0.78);
  group.add(tower, gallery, lamp, roof, house, houseRoof);
  return group;
}

function buildBoats(def) {
  const group = new THREE.Group();
  const rand = mulberry32(31);
  const hull = new THREE.CylinderGeometry(0.01, 1.4, 7, 4, 1);
  hull.rotateZ(Math.PI / 2);
  hull.scale(1, 0.45, 1);
  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 0);
  sailShape.lineTo(0, 9);
  sailShape.lineTo(4, 0.5);
  sailShape.closePath();
  const sail = new THREE.ShapeGeometry(sailShape);
  const hullMat = new THREE.MeshLambertMaterial({ color: 0xf6f6f2 });
  const sailMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const boats = [];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Group();
    const hm = new THREE.Mesh(hull, hullMat);
    const sm = new THREE.Mesh(sail, sailMat);
    sm.position.set(-1.5, 0.6, 0);
    b.add(hm, sm);
    const x = -800 + rand() * 1600;
    b.position.set(x, 0.3, def.coastZ(x) + 140 + rand() * 500);
    b.rotation.y = rand() * Math.PI * 2;
    b.userData.phase = rand() * 6.28;
    group.add(b);
    boats.push(b);
  }
  group.userData.update = (t) => {
    for (const b of boats) {
      b.position.y = 0.3 + Math.sin(t * 0.9 + b.userData.phase) * 0.25;
      b.rotation.z = Math.sin(t * 0.7 + b.userData.phase) * 0.06;
    }
  };
  return group;
}

function buildMountains() {
  // Distant hazy ridge to the north so the horizon never shows the terrain's edge.
  const noise = createNoise2D(13);
  const segs = 140;
  const pos = [];
  const idx = [];
  const color = FOG_COLOR.clone().lerp(new THREE.Color(0x6f8aa0), 0.45);
  for (let i = 0; i <= segs; i++) {
    const a = Math.PI * 0.9 + (i / segs) * Math.PI * 1.2; // north arc
    const r = 2600;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r * 0.85 - 200;
    const h = 120 + (fbm(noise, i / 12, 0.5, 4) * 0.5 + 0.5) * 380;
    pos.push(x, -20, z, x, h, z);
    if (i < segs) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ color, fog: false, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

function buildShallows(def) {
  // Emerald band over the shelf, fading out to deep blue water.
  const pos = [];
  const col = [];
  const idx = [];
  const rows = [
    [-30, 0.0],
    [-4, 0.75],
    [30, 0.55],
    [110, 0],
  ];
  const segs = 300;
  const tint = new THREE.Color(0x19c4a6);
  for (let i = 0; i <= segs; i++) {
    const x = -1500 + (i / segs) * 3000;
    const zc = def.coastZ(x);
    for (const [dz, a] of rows) {
      pos.push(x, 0.08, zc + dz);
      col.push(tint.r, tint.g, tint.b, a);
    }
    if (i < segs) {
      for (let r = 0; r < rows.length - 1; r++) {
        const a = i * rows.length + r;
        const b = a + rows.length;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide })
  );
  mesh.renderOrder = 1;
  return mesh;
}

export function buildScenery(scene, renderer, track, def, quality) {
  const sunDir = sunDirection(def.sun);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMaterial(sunDir));
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.Fog(FOG_COLOR, 260, 1900);

  // Image-based lighting from the same sky, rendered once.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial(sunDir));
  envScene.add(envSky);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 24), new THREE.MeshBasicMaterial({ color: 0x3c5a3a }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -6;
  envScene.add(ground);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.7;
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x52633a, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
  sun.position.copy(sunDir).multiplyScalar(120);
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 34;
  sun.shadow.camera.bottom = -34;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  const mapSize = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.castShadow = quality !== 'low';
  scene.add(sun, sun.target);

  const waterNormals = waterNormalMap();
  waterNormals.repeat.set(220, 220);
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0x0d5f86,
      roughness: 0.16,
      metalness: 0.05,
      normalMap: waterNormals,
      normalScale: new THREE.Vector2(0.45, 0.45),
      envMapIntensity: 1.1,
    })
  );
  ocean.position.set(0, 0, 0);
  scene.add(ocean);
  scene.add(buildShallows(def));

  const terrain = buildTerrain(track, def, quality);
  scene.add(terrain.mesh);
  scene.add(buildVegetation(def, terrain, quality));
  scene.add(buildRocks(def, terrain));
  scene.add(buildLighthouse(def, terrain));
  const boats = buildBoats(def);
  scene.add(boats);
  scene.add(buildMountains());

  return {
    sun,
    sunDir,
    sky,
    terrain,
    update(t, camera) {
      sky.position.copy(camera.position);
      waterNormals.offset.set(t * 0.012, t * 0.007);
      boats.userData.update(t);
    },
    // Keep the shadow frustum centred on the player.
    follow(target) {
      sun.target.position.copy(target);
      sun.position.copy(target).addScaledVector(sunDir, 120);
    },
  };
}
