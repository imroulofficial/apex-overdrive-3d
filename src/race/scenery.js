import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise2D, fbm, mulberry32, smoothstep } from './noise.js';
import { grassTexture, rockTexture } from '../render/textures.js';
import { bothFaces, createVertexPbrMaterial, mergePainted, paintVertices } from '../render/vertexPbr.js';

// Emerald Coast biome: sky, sun, glinting ocean with emerald shallows, layered grass/cliff
// terrain carved around the road, coast redwoods, palms, undergrowth, rocks, a lighthouse
// headland and sailboats. Everything is generated from a fixed seed at load time; no
// textures are downloaded.

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
// Layered ground shader: coastal grass on the flats, triplanar stratified rock on cliff faces
// and steep banks, sand (wet below the tide line) at the shore. Blend weights come from the
// world-space slope and height, broken up by a macro noise so the transitions look natural.
// One program for the terrain, the road embankments and (rock-only) the boulders.
// ---------------------------------------------------------------------------

export function createGroundMaterial({ rockOnly = false } = {}) {
  const grassMap = grassTexture();
  const rockMap = rockTexture();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const uniforms = {
    grassMap: { value: grassMap },
    rockMap: { value: rockMap },
    sandColor: { value: new THREE.Color(0xcdb98c) },
    grassTint: { value: new THREE.Color(0xc4d6a0) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (rockOnly) shader.defines = { ...shader.defines, ROCK_ONLY: '' };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 groundPos = vec4(transformed, 1.0);
        vec3 groundNormal = objectNormal;
        #ifdef USE_INSTANCING
          groundPos = instanceMatrix * groundPos;
          groundNormal = mat3(instanceMatrix) * groundNormal;
        #endif
        vWPos = (modelMatrix * groundPos).xyz;
        vWNormal = normalize(mat3(modelMatrix) * groundNormal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D grassMap;
        uniform sampler2D rockMap;
        uniform vec3 sandColor;
        uniform vec3 grassTint;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        vec3 rockTriplanar(vec3 n, vec3 p) {
          vec3 bw = pow(abs(n), vec3(4.0));
          bw /= (bw.x + bw.y + bw.z);
          return texture2D(rockMap, p.zy * vec2(0.07, 0.11)).rgb * bw.x
            + texture2D(rockMap, p.xz * 0.07).rgb * bw.y
            + texture2D(rockMap, p.xy * vec2(0.07, 0.11)).rgb * bw.z;
        }`
      )
      .replace(
        '#include <map_fragment>',
        `vec3 nW = normalize(vWNormal);
        #ifdef ROCK_ONLY
          diffuseColor.rgb *= rockTriplanar(nW, vWPos) * 1.1;
        #else
          float slope = 1.0 - nW.y;
          vec4 gA = texture2D(grassMap, vWPos.xz * 0.11);
          vec4 gB = texture2D(grassMap, vWPos.xz * 0.013 + 0.37);
          float macro = gB.a;
          vec3 grass = mix(gA.rgb, gB.rgb, 0.35) * grassTint;
          // Golden dry grass vs lush green patches, drier on the high ground.
          grass *= mix(vec3(1.25, 1.08, 0.72), vec3(0.86, 1.06, 0.9), macro);
          grass = mix(grass, grass * vec3(1.3, 1.12, 0.75), smoothstep(45.0, 90.0, vWPos.y) * 0.6);
          float rockW = smoothstep(0.22, 0.4, slope + (macro - 0.5) * 0.16);
          vec3 col = grass;
          if (rockW > 0.001) col = mix(grass, rockTriplanar(nW, vWPos), rockW);
          float sandW = 1.0 - smoothstep(0.8, 3.2, vWPos.y + (macro - 0.5) * 2.5);
          vec3 sand = sandColor * (0.85 + 0.3 * gA.a);
          sand *= mix(0.6, 1.0, smoothstep(-0.6, 0.9, vWPos.y));
          col = mix(col, sand, sandW * (1.0 - rockW * 0.7));
          diffuseColor.rgb *= col;
        #endif`
      );
  };
  mat.customProgramCacheKey = () => (rockOnly ? 'ground-rock' : 'ground');
  return mat;
}

// ---------------------------------------------------------------------------
// Terrain: a height field carved around the road, split into chunks so the renderer can
// frustum-cull the parts behind the camera.
// ---------------------------------------------------------------------------

const TERRAIN = { x0: -1500, x1: 1500, z0: -1300, z1: 700, cell: 10 };
const CHUNK_CELLS = 60;

function buildTerrain(track, def, quality, material) {
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
    // Sea cliffs: the land drops steeply over the last ~20 m before the beach.
    const t = smoothstep(-22, 2, dc);
    const sea = -16 - Math.min(40, Math.max(0, dc) * 0.06) + fbm(detail, x / 35, z / 35, 2) * 5;
    return land + (sea - land) * t;
  };

  const heights = new Float32Array(nx * nz);
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
    }
  }
  // Normals from central differences over the whole grid, so chunk seams stay invisible.
  const normals = new Float32Array(nx * nz * 3);
  const H = (k, j) => heights[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, k))];
  for (let j = 0; j < nz; j++) {
    for (let k = 0; k < nx; k++) {
      const dx = (H(k + 1, j) - H(k - 1, j)) / (2 * cx);
      const dz = (H(k, j + 1) - H(k, j - 1)) / (2 * cz);
      const len = Math.hypot(dx, 1, dz);
      const i = (j * nx + k) * 3;
      normals[i] = -dx / len;
      normals[i + 1] = 1 / len;
      normals[i + 2] = -dz / len;
    }
  }

  const meshes = [];
  for (let j0 = 0; j0 < nz - 1; j0 += CHUNK_CELLS) {
    for (let k0 = 0; k0 < nx - 1; k0 += CHUNK_CELLS) {
      const j1 = Math.min(nz - 1, j0 + CHUNK_CELLS);
      const k1 = Math.min(nx - 1, k0 + CHUNK_CELLS);
      const w = k1 - k0 + 1;
      const hgt = j1 - j0 + 1;
      const pos = new Float32Array(w * hgt * 3);
      const nor = new Float32Array(w * hgt * 3);
      for (let j = j0; j <= j1; j++) {
        for (let k = k0; k <= k1; k++) {
          const o = ((j - j0) * w + (k - k0)) * 3;
          const src = j * nx + k;
          pos[o] = x0 + k * cx;
          pos[o + 1] = heights[src];
          pos[o + 2] = z0 + j * cz;
          nor[o] = normals[src * 3];
          nor[o + 1] = normals[src * 3 + 1];
          nor[o + 2] = normals[src * 3 + 2];
        }
      }
      const index = [];
      for (let j = 0; j < hgt - 1; j++) {
        for (let k = 0; k < w - 1; k++) {
          const a = j * w + k;
          const b = a + 1;
          const c = a + w;
          const d = c + 1;
          index.push(a, c, b, b, c, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setIndex(index);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = 'terrain';
      mesh.receiveShadow = true;
      meshes.push(mesh);
    }
  }

  const sample = (x, z) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / cx));
    const fz = Math.min(nz - 1.001, Math.max(0, (z - z0) / cz));
    const k = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - k;
    const v = fz - j;
    const i = j * nx + k;
    const h = heights[i] * (1 - u) * (1 - v) + heights[i + 1] * u * (1 - v) + heights[i + nx] * (1 - u) * v + heights[i + nx + 1] * u * v;
    return { h, road: dist[i], steep: 1 - normals[i * 3 + 1] };
  };
  return { meshes, sample };
}

// ---------------------------------------------------------------------------
// Vegetation: coast redwoods with layered, drooping foliage tiers, palms on the shore and
// undergrowth along the road. Each species is one geometry with baked vertex colours (bark,
// foliage, ambient occlusion toward the trunk) drawn as one InstancedMesh.
// ---------------------------------------------------------------------------

function colorize(geo, colorAt) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    colorAt(p.getX(i), p.getY(i), p.getZ(i), c, i);
    c.toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

function redwoodGeometry() {
  const rand = mulberry32(57);
  const parts = [];
  const barkA = new THREE.Color(0x5a2e1c);
  const barkB = new THREE.Color(0x8a4a2c);
  const trunk = new THREE.CylinderGeometry(0.32, 0.95, 27, 9, 5);
  trunk.translate(0, 13.5, 0);
  parts.push(
    colorize(trunk, (x, y, z, c) => {
      const a = Math.atan2(z, x);
      const flute = 0.5 + 0.5 * Math.sin(a * 9);
      c.copy(barkA).lerp(barkB, flute * 0.7).multiplyScalar(0.55 + Math.min(1, y / 8) * 0.45);
    })
  );
  // Foliage tiers from 8 m up to the crown: a fan of branch tips on top (lit) and an
  // underside fan (shadowed), so each tier reads as a solid, layered mass of needles.
  const tiers = 8;
  const tipsN = 8;
  // Deep blue-green needles, as on real coast redwoods.
  const needleDark = new THREE.Color(0x0f261a);
  const needleMid = new THREE.Color(0x1c4229);
  const needleLight = new THREE.Color(0x3a6a3e);
  for (let t = 0; t < tiers; t++) {
    // Redwoods carry a tall bare trunk and a narrow, columnar crown of drooping sprays.
    const k = t / (tiers - 1);
    const y = 10.5 + k * 16.5 + (rand() - 0.5) * 1.2;
    const r = (3.3 - k * 2.3) * (0.8 + rand() * 0.4);
    const rot = rand() * Math.PI * 2;
    const top = new THREE.Vector3(0, y + 1.8 - k * 0.6, 0);
    const under = new THREE.Vector3(0, y - 0.5, 0);
    const rim = [];
    for (let i = 0; i < tipsN * 2; i++) {
      const a = rot + (i / (tipsN * 2)) * Math.PI * 2;
      const tip = i % 2 === 0;
      const rr = tip ? r * (0.9 + rand() * 0.25) : r * 0.5;
      const droop = tip ? 1.1 + rand() * 0.9 : 0.1;
      rim.push(new THREE.Vector3(Math.cos(a) * rr, y - droop, Math.sin(a) * rr));
    }
    const pos = [];
    const col = [];
    const push = (v, c) => {
      pos.push(v.x, v.y, v.z);
      col.push(c.r, c.g, c.b);
    };
    const shade = new THREE.Color();
    for (let i = 0; i < rim.length; i++) {
      const a = rim[i];
      const b = rim[(i + 1) % rim.length];
      const light = 0.75 + k * 0.35;
      // Upper fan (counter-clockwise seen from above → faces up).
      push(top, shade.copy(needleMid).lerp(needleLight, 0.4 + k * 0.5).multiplyScalar(light));
      push(b, shade.copy(needleMid).lerp(needleLight, k * 0.6).multiplyScalar(light));
      push(a, shade.copy(needleMid).lerp(needleLight, k * 0.6).multiplyScalar(light));
      // Underside fan: occluded, darker toward the trunk.
      push(under, needleDark.clone().multiplyScalar(0.55));
      push(a, needleDark);
      push(b, needleDark);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    parts.push(g);
  }
  const spire = new THREE.ConeGeometry(0.7, 3.2, 7);
  spire.translate(0, 28.6, 0);
  parts.push(colorize(spire, (x, y, z, c) => c.copy(needleLight).multiplyScalar(0.95)));
  return mergeGeometries(parts.map((g) => {
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
    return g;
  }));
}

function palmGeometry() {
  const trunk = new THREE.CylinderGeometry(0.16, 0.28, 8, 6, 8);
  trunk.translate(0, 4, 0);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i);
    tp.setX(i, tp.getX(i) + (y / 8) ** 2 * 1.2); // gentle lean
  }
  trunk.computeVertexNormals();
  const ringA = new THREE.Color(0x7a5a3c);
  const ringB = new THREE.Color(0x9c7a52);
  const parts = [colorize(trunk, (x, y, z, c) => c.copy(ringA).lerp(ringB, (Math.floor(y * 2.2) % 2) * 0.8))];
  const leafBase = new THREE.Color(0x2c5a22);
  const leafTip = new THREE.Color(0x6d9a3a);
  for (let i = 0; i < 9; i++) {
    const f = new THREE.PlaneGeometry(4.2, 0.9, 5, 1);
    f.translate(2.1, 0, 0);
    const fp = f.attributes.position;
    for (let k = 0; k < fp.count; k++) {
      const x = fp.getX(k);
      fp.setZ(k, fp.getY(k) * (1 - x / 5.2));
      fp.setY(k, -0.1 * x * x + 0.3 * x);
    }
    f.rotateY((i / 9) * Math.PI * 2 + (i % 2) * 0.2);
    f.translate(1.2, 8, 0);
    f.computeVertexNormals();
    for (const side of bothFaces(f)) parts.push(colorize(side, (x, y, z, c) => c.copy(leafBase).lerp(leafTip, Math.min(1, Math.hypot(x - 1.2, z) / 4.4))));
  }
  return mergeGeometries(parts.map((g) => {
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
    return g;
  }));
}

function bushGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const noise = createNoise2D(71);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const k = 1 + noise(v.x * 2.1 + 5, v.z * 2.1 + v.y * 1.7) * 0.28;
    p.setXYZ(i, v.x * k * 1.5, Math.max(-0.2, v.y) * k * 0.95 + 0.25, v.z * k * 1.5);
  }
  g.computeVertexNormals();
  const dark = new THREE.Color(0x1a2f17);
  const light = new THREE.Color(0x56763a);
  return colorize(g, (x, y, z, c) => c.copy(dark).lerp(light, Math.min(1, Math.max(0, (y + 0.1) / 1.3))));
}

function scatter(mesh, transforms, tint = null) {
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
    mesh.setMatrixAt(i, m);
    if (tint) mesh.setColorAt(i, color.setHSL(...tint(t, i)));
  });
  mesh.count = transforms.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function buildVegetation(def, terrain, quality) {
  const group = new THREE.Group();
  const rand = mulberry32(42);
  const density = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;
  const palms = [];
  const redwoods = [];
  const bushes = [];
  const tries = Math.round(30000 * density);
  for (let i = 0; i < tries; i++) {
    const x = -1100 + rand() * 2200;
    const z = -900 + rand() * 1250;
    const { h, road, steep } = terrain.sample(x, z);
    if (h < 3 || road < 17 || steep > 0.3) continue;
    const coastDist = def.coastZ(x) - z;
    const t = { x, y: h - 0.3, z, rot: rand() * Math.PI * 2, scale: 0.8 + rand() * 0.5 };
    if (coastDist < 110) {
      if (rand() < 0.45 && palms.length < 220 * density) palms.push(t);
    } else if (road < 260 && rand() < 0.16) {
      // Groves: thicker near the road where the player sees them, sparse in the distance.
      if (redwoods.length < 420 * density) redwoods.push({ ...t, scale: 0.65 + rand() * 0.5, stretch: 0.85 + rand() * 0.35 });
    } else if (rand() < 0.012 && redwoods.length < 420 * density) {
      redwoods.push({ ...t, scale: 0.6 + rand() * 0.45 });
    }
    if (road < 70 && road > 19 && steep < 0.22 && rand() < 0.25 && bushes.length < 900 * density) {
      bushes.push({ x: x + rand() * 2, y: h - 0.25, z: z + rand() * 2, rot: rand() * 6.28, scale: 0.5 + rand() * 0.8, stretch: 0.7 + rand() * 0.5 });
    }
  }

  const foliage = new THREE.MeshLambertMaterial({ vertexColors: true });
  const tree = new THREE.InstancedMesh(redwoodGeometry(), foliage, redwoods.length);
  scatter(tree, redwoods, (t, i) => [0.0, 0.0, 0.88 + ((i * 0.37) % 1) * 0.3]);
  const palm = new THREE.InstancedMesh(palmGeometry(), foliage, palms.length);
  scatter(palm, palms, (t, i) => [0.0, 0.0, 0.9 + ((i * 0.53) % 1) * 0.2]);
  const bush = new THREE.InstancedMesh(bushGeometry(), foliage, bushes.length);
  scatter(bush, bushes, (t, i) => [0.0, 0.0, 0.8 + ((i * 0.71) % 1) * 0.4]);
  group.add(tree, palm, bush);
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
  const mesh = new THREE.InstancedMesh(geo, createGroundMaterial({ rockOnly: true }), items.length);
  scatter(mesh, items);
  return mesh;
}

// Lighthouse headland: tower, gallery, lamp room, keeper's cottage, in one vertex-PBR mesh.
function buildLighthouse(def, terrain, material) {
  const x = def.lighthouseX;
  const z = def.coastZ(x) - 26;
  const { h } = terrain.sample(x, z);
  const parts = [];
  const bandH = 22 / 6;
  for (let i = 0; i < 6; i++) {
    const r0 = 3.1 - (i / 6) * 1.0;
    const r1 = 3.1 - ((i + 1) / 6) * 1.0;
    const band = new THREE.CylinderGeometry(r1, r0, bandH, 20).translate(0, bandH * (i + 0.5), 0);
    parts.push(paintVertices(band.toNonIndexed(), { color: i % 2 ? 0xc8102e : 0xf2f0ea, roughness: 0.6 }));
  }
  const dark = { color: 0x22252b, roughness: 0.5, metalness: 0.6 };
  parts.push(paintVertices(new THREE.CylinderGeometry(2.9, 2.9, 0.4, 20).translate(0, 22.2, 0).toNonIndexed(), dark));
  parts.push(paintVertices(new THREE.CylinderGeometry(1.6, 1.6, 2.2, 16).translate(0, 23.5, 0).toNonIndexed(), { color: 0xfff2b0, roughness: 0.2, emissive: 1.6 }));
  parts.push(paintVertices(new THREE.ConeGeometry(2.2, 2, 16).translate(0, 25.6, 0).toNonIndexed(), { color: 0xb01020, roughness: 0.5, metalness: 0.3 }));
  parts.push(paintVertices(new THREE.BoxGeometry(8, 4, 6).translate(6, 2, 2).toNonIndexed(), { color: 0xf0ece2, roughness: 0.85 }));
  const roof = new THREE.ConeGeometry(5.6, 2.4, 4).rotateY(Math.PI / 4).scale(1, 1, 0.78).translate(6, 5.2, 2);
  parts.push(paintVertices(roof.toNonIndexed(), { color: 0xa8432b, roughness: 0.8 }));
  const geo = mergePainted(parts).translate(x, h - 0.5, z);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  return mesh;
}

// Sailboats: one merged mesh that bobs as a whole.
function buildBoats(def, material) {
  const rand = mulberry32(31);
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const hull = new THREE.CylinderGeometry(0.01, 1.4, 7, 4, 1).rotateZ(Math.PI / 2).scale(1, 0.45, 1);
    const sailShape = new THREE.Shape();
    sailShape.moveTo(0, 0);
    sailShape.lineTo(0, 9);
    sailShape.lineTo(4, 0.5);
    sailShape.closePath();
    const sail = new THREE.ShapeGeometry(sailShape).translate(-1.5, 0.6, 0);
    const x = -800 + rand() * 1600;
    const m = new THREE.Matrix4().makeRotationY(rand() * Math.PI * 2).setPosition(x, 0.3, def.coastZ(x) + 140 + rand() * 500);
    parts.push(paintVertices(hull.toNonIndexed().applyMatrix4(m), { color: 0xf6f6f2, roughness: 0.4 }));
    for (const g of bothFaces(sail.applyMatrix4(m))) parts.push(paintVertices(g, { color: 0xffffff, roughness: 0.9 }));
  }
  const mesh = new THREE.Mesh(mergePainted(parts), material);
  mesh.userData.update = (t) => {
    mesh.position.y = Math.sin(t * 0.9) * 0.22;
  };
  return mesh;
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
    [-4, 0.7],
    [30, 0.5],
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

// Ocean: two scrolling normal-map octaves, Fresnel blend from deep water to the reflected sky
// and a tight specular sun glint plus a broad glare streak. A single cheap shader, no
// reflection render pass.
function oceanMaterial(normalMap, sunDir) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        normalMap: { value: null },
        time: { value: 0 },
        sunDir: { value: new THREE.Vector3() },
        sunColor: { value: new THREE.Color(0xfff1d6) },
        deep: { value: new THREE.Color(0x07344f) },
        shallow: { value: new THREE.Color(0x0f6f86) },
        skyTop: { value: SKY.top.clone() },
        skyHorizon: { value: SKY.horizon.clone() },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D normalMap;
      uniform float time;
      uniform vec3 sunDir, sunColor, deep, shallow, skyTop, skyHorizon;
      varying vec3 vWPos;
      #include <fog_pars_fragment>
      void main() {
        vec3 V = cameraPosition - vWPos;
        float dist = length(V);
        V /= dist;
        vec2 p = vWPos.xz;
        vec3 n1 = texture2D(normalMap, p / 42.0 + time * vec2(0.011, 0.006)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(normalMap, p / 13.0 - time * vec2(0.017, 0.021)).xyz * 2.0 - 1.0;
        // Calm the ripples with distance so the far sea does not shimmer.
        float strength = mix(0.55, 0.12, smoothstep(60.0, 900.0, dist));
        vec3 n = normalize(vec3((n1.x + n2.x * 0.6) * strength, 1.0, (n1.y + n2.y * 0.6) * strength));
        float ndv = max(dot(n, V), 0.0);
        float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 R = reflect(-V, n);
        vec3 sky = mix(skyHorizon, skyTop, pow(max(R.y, 0.0), 0.55));
        vec3 body = mix(shallow, deep, smoothstep(0.0, 0.6, ndv));
        vec3 col = mix(body, sky, fresnel);
        float s = max(dot(R, sunDir), 0.0);
        col += sunColor * (pow(s, 900.0) * 9.0 + pow(s, 90.0) * 0.9 + pow(s, 12.0) * 0.06);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

export function buildScenery(scene, renderer, track, def, quality) {
  const sunDir = sunDirection(def.sun);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMaterial(sunDir));
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.Fog(FOG_COLOR, 280, 1900);

  // Lighting budget: exactly one directional sun (512² shadow map that follows the player)
  // plus a hemisphere ambient. Reflections come from a baked environment cubemap.
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a5236, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.7);
  sun.position.copy(sunDir).multiplyScalar(120);
  const SHADOW_EXTENT = 22;
  sun.shadow.camera.left = -SHADOW_EXTENT;
  sun.shadow.camera.right = SHADOW_EXTENT;
  sun.shadow.camera.top = SHADOW_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_EXTENT;
  sun.shadow.camera.near = 40;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  sun.shadow.mapSize.set(512, 512);
  sun.castShadow = quality !== 'low';
  scene.add(sun, sun.target);

  const waterNormals = waterNormalMap();
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), oceanMaterial(waterNormals, sunDir));
  ocean.material.uniforms.normalMap.value = waterNormals;
  ocean.material.uniforms.sunDir.value.copy(sunDir);
  ocean.frustumCulled = false;
  scene.add(ocean);
  scene.add(buildShallows(def));

  const ground = createGroundMaterial();
  const atlas = createVertexPbrMaterial({ envMapIntensity: 0.8 });
  const terrain = buildTerrain(track, def, quality, ground);
  scene.add(...terrain.meshes);
  const vegetation = buildVegetation(def, terrain, quality);
  scene.add(vegetation);
  scene.add(buildRocks(def, terrain));
  const lighthouse = buildLighthouse(def, terrain, atlas);
  scene.add(lighthouse);
  const boats = buildBoats(def, atlas);
  scene.add(boats);
  scene.add(buildMountains());

  // Shadow-map texel snapping: moving the shadow camera in whole texels stops the shadow
  // edges from crawling as the player drives.
  const texel = (SHADOW_EXTENT * 2) / 512;
  const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(), sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
  const lightInv = lightRot.clone().invert();
  const snapped = new THREE.Vector3();

  return {
    sun,
    sunDir,
    sky,
    terrain,
    groundMaterial: ground,
    update(t, camera) {
      sky.position.copy(camera.position);
      ocean.material.uniforms.time.value = t;
      boats.userData.update(t);
    },
    // Keep the shadow frustum centred on the player.
    follow(target) {
      snapped.copy(target).applyMatrix4(lightInv);
      snapped.x = Math.round(snapped.x / texel) * texel;
      snapped.y = Math.round(snapped.y / texel) * texel;
      snapped.applyMatrix4(lightRot);
      sun.target.position.copy(snapped);
      sun.position.copy(snapped).addScaledVector(sunDir, 120);
    },
    // Renders the track world into a prefiltered cubemap once: cars and glass then reflect
    // the real coast, sky and sun instead of a generic studio. The bake uses unlit proxies of
    // the same geometry (pre-lit colours), which is cheap and keeps the half-float target
    // free of specular hot spots.
    bakeEnvironment(at) {
      const env = new THREE.Scene();
      env.fog = scene.fog;
      const envSky = new THREE.Mesh(sky.geometry, skyMaterial(sunDir));
      envSky.position.copy(at);
      env.add(envSky);
      const basic = (color) => new THREE.MeshBasicMaterial({ color });
      env.add(new THREE.Mesh(ocean.geometry, basic(0x0b4a68)));
      const land = basic(0x587a3c);
      for (const m of terrain.meshes) env.add(new THREE.Mesh(m.geometry, land));
      const leaves = new THREE.MeshBasicMaterial({ vertexColors: true });
      for (const m of vegetation.children) {
        const copy = new THREE.InstancedMesh(m.geometry, leaves, m.count);
        copy.instanceMatrix = m.instanceMatrix;
        copy.instanceColor = m.instanceColor;
        copy.count = m.count;
        env.add(copy);
      }
      env.add(new THREE.Mesh(lighthouse.geometry, leaves));
      const pmrem = new THREE.PMREMGenerator(renderer);
      const rt = pmrem.fromScene(env, 0.02, 0.5, 4000, { size: 256, position: at });
      pmrem.dispose();
      envSky.material.dispose();
      scene.environment?.dispose?.();
      scene.environment = rt.texture;
      scene.environmentIntensity = 0.85;
      return rt.texture;
    },
  };
}
