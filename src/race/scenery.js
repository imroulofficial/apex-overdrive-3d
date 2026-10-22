import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise2D, fbm, mulberry32, smoothstep } from './noise.js';
import { grassTexture, rockTexture } from '../render/textures.js';
import { bothFaces, createVertexPbrMaterial, mergePainted, paintVertices } from '../render/vertexPbr.js';
import { installHeightFog } from '../render/heightFog.js';
import { fernGeometry, foliageMaterials, NearInstances, palmGeometry as photoPalm, redwoodGeometry as photoRedwood } from './foliage.js';

// Emerald Coast biome: sky, sun, glinting ocean with emerald shallows, layered grass/cliff
// terrain carved around the road (and the redwood trails, and the sea gorge under the timber
// bridge), coast redwoods, palms, undergrowth, rocks, a lighthouse headland and sailboats.
// Everything is placed from a fixed seed at load time. With the bundled CC0 scans loaded
// (render/envAssets.js) the ground, trees, ferns and rocks are photo-textured; without them
// the procedural textures and vertex-coloured meshes below are used.
// Sky, sun, fog, clouds and sea follow the stage's weather preset (applyWeather, below).

const SKY = {
  top: new THREE.Color(0x2f73c9),
  horizon: new THREE.Color(0xcfe3ee),
  sun: new THREE.Color(0xfff2d2),
};
export const FOG_COLOR = SKY.horizon.clone();

export function sunDirection(sun, out = new THREE.Vector3()) {
  const { azimuth, elevation } = sun;
  return out.set(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth)).normalize();
}

// Tileable cloud density (alpha): periodic value-noise fBm, so the sky never shows a seam.
export function cloudTexture(size = 256) {
  const rand = mulberry32(404);
  const octaves = [4, 8, 16, 32, 64].map((p, k) => ({ p, a: 0.5 ** k, v: Float32Array.from({ length: p * p }, () => rand()) }));
  const sm = (t) => t * t * (3 - 2 * t);
  const sample = (o, x, y) => {
    const fx = (x / size) * o.p;
    const fy = (y / size) * o.p;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const u = sm(fx - x0);
    const w = sm(fy - y0);
    const at = (i, j) => o.v[((j + o.p) % o.p) * o.p + ((i + o.p) % o.p)];
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * u;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * u;
    return a + (b - a) * w;
  };
  const data = new Uint8Array(size * size * 4);
  const norm = octaves.reduce((n, o) => n + o.a, 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const o of octaves) v += sample(o, x, y) * o.a;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round((v / norm) * 255);
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

export function skyUniforms(sunDir, clouds) {
  return {
    top: { value: SKY.top.clone() },
    horizon: { value: SKY.horizon.clone() },
    sunColor: { value: SKY.sun.clone() },
    sunDir: { value: sunDir },
    glow: { value: 0.32 },
    flash: { value: 0 },
    clouds: { value: clouds },
    cover: { value: 0.3 },
    cloudLit: { value: new THREE.Color(0xffffff) },
    cloudShade: { value: new THREE.Color(0x8a96a6) },
    time: { value: 0 },
  };
}

export function skyMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top, horizon, sunColor, sunDir, cloudLit, cloudShade;
      uniform float glow, flash, cover, time;
      uniform sampler2D clouds;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(horizon, top, pow(h, 0.55));
        // Below the horizon the fogged ocean takes over; keep it hazy.
        col = mix(col, horizon * 0.92, smoothstep(0.0, -0.08, d.y));
        float s = max(dot(d, sunDir), 0.0);
        // Disc, halo, and a wide glow that pools along the horizon on a low sun.
        col += sunColor * (pow(s, 900.0) * 3.0 * smoothstep(0.08, 0.3, glow) + pow(s, 24.0) * 0.32 * glow * 3.0 + pow(s, 4.0) * 0.25 * glow * (1.0 - h));
        // A cloud deck: two scales of the tiling density, drifting with the wind, lit on the
        // side facing the sun, thinning toward the horizon haze.
        if (d.y > 0.0 && cover > 0.01) {
          vec2 uv = d.xz / (d.y + 0.12);
          float c = texture2D(clouds, uv * 0.18 + vec2(time * 0.004, time * 0.0015)).a * 0.65
            + texture2D(clouds, uv * 0.47 - vec2(time * 0.006, 0.0)).a * 0.35;
          float k = smoothstep(1.0 - cover - 0.12, 1.0 - cover + 0.28, c) * smoothstep(0.0, 0.22, d.y);
          vec3 cc = mix(cloudShade, cloudLit, clamp(pow(s, 3.0) * 0.6 + c * 0.5, 0.0, 1.0));
          col = mix(col, cc, k * 0.92);
        }
        col += vec3(0.85, 0.9, 1.0) * flash;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function waterNormalMap(size = 128) {
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

export function createGroundMaterial({ rockOnly = false, env = null } = {}) {
  // Procedural grass always supplies the macro variation (alpha: lush vs dry patches); with
  // the photo assets loaded, scanned grass, cliff and sand provide the detail.
  const grassMap = grassTexture();
  const photo = Boolean(env?.tex.grass && env.tex.cliff && env.tex.sand);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const uniforms = {
    grassMap: { value: grassMap },
    rockMap: { value: photo ? env.tex.cliff : rockTexture() },
    photoGrass: { value: photo ? env.tex.grass : null },
    photoSand: { value: photo ? env.tex.sand : null },
    sandColor: { value: new THREE.Color(0xcdb98c) },
    grassTint: { value: new THREE.Color(0xc4d6a0) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (rockOnly) shader.defines = { ...shader.defines, ROCK_ONLY: '' };
    if (photo) shader.defines = { ...shader.defines, PHOTO_GROUND: '' };
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
        uniform sampler2D photoGrass;
        uniform sampler2D photoSand;
        uniform vec3 sandColor;
        uniform vec3 grassTint;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        vec3 rockTriplanar(vec3 n, vec3 p) {
          vec3 bw = pow(abs(n), vec3(4.0));
          bw /= (bw.x + bw.y + bw.z);
          #ifdef PHOTO_GROUND
            // Scanned sedimentary cliff (about 1.8 m): 9 m strata across, plus a coarser
            // sample to break up the repeat; cooled to the coast's grey-brown stone.
            vec2 sx = p.zy * vec2(0.11, 0.16), sy = p.xz * 0.11, sz = p.xy * vec2(0.11, 0.16);
            vec3 c = texture2D(rockMap, sx).rgb * bw.x + texture2D(rockMap, sy).rgb * bw.y + texture2D(rockMap, sz).rgb * bw.z;
            vec3 c2 = texture2D(rockMap, sx * 0.23 + 0.31).rgb * bw.x + texture2D(rockMap, sy * 0.23 + 0.31).rgb * bw.y + texture2D(rockMap, sz * 0.23 + 0.31).rgb * bw.z;
            c = mix(c, c2, 0.4);
            float l = dot(c, vec3(0.3, 0.55, 0.15));
            return mix(vec3(l), c, 0.45) * vec3(1.02, 0.98, 0.94) * 1.15;
          #else
            return texture2D(rockMap, p.zy * vec2(0.07, 0.11)).rgb * bw.x
              + texture2D(rockMap, p.xz * 0.07).rgb * bw.y
              + texture2D(rockMap, p.xy * vec2(0.07, 0.11)).rgb * bw.z;
          #endif
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
          #ifdef PHOTO_GROUND
            // Scanned grass at two scales (2.5 m and 11 m) so no repeat lines up. The scan is a
            // dry, tan meadow: its light and shade carry the detail, the procedural greens the
            // colour, with a quarter of the scan's own colour for the dry stalks.
            vec3 pg = mix(texture2D(photoGrass, vWPos.xz * 0.4).rgb, texture2D(photoGrass, vWPos.xz * 0.09 + 0.5).rgb, 0.4);
            vec3 grass = mix(gA.rgb, gB.rgb, 0.35) * grassTint * (dot(pg, vec3(0.3, 0.59, 0.11)) / 0.23);
            grass = mix(grass, pg * 0.9, 0.25);
          #else
            vec3 grass = mix(gA.rgb, gB.rgb, 0.35) * grassTint;
          #endif
          // Golden dry grass vs lush green patches, drier on the high ground.
          grass *= mix(vec3(1.25, 1.08, 0.72), vec3(0.86, 1.06, 0.9), macro);
          grass = mix(grass, grass * vec3(1.3, 1.12, 0.75), smoothstep(45.0, 90.0, vWPos.y) * 0.6);
          float rockW = smoothstep(0.22, 0.4, slope + (macro - 0.5) * 0.16);
          vec3 col = grass;
          if (rockW > 0.001) col = mix(grass, rockTriplanar(nW, vWPos), rockW);
          float sandW = 1.0 - smoothstep(0.8, 3.2, vWPos.y + (macro - 0.5) * 2.5);
          #ifdef PHOTO_GROUND
            vec3 sand = texture2D(photoSand, vWPos.xz * 0.12).rgb * 1.25;
          #else
            vec3 sand = sandColor * (0.85 + 0.3 * gA.a);
          #endif
          sand *= mix(0.6, 1.0, smoothstep(-0.6, 0.9, vWPos.y));
          col = mix(col, sand, sandW * (1.0 - rockW * 0.7));
          diffuseColor.rgb *= col;
        #endif`
      );
  };
  mat.customProgramCacheKey = () => (rockOnly ? 'ground-rock' : 'ground') + (photo ? '-photo' : '');
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

  // Distance from every vertex to the road (and the road bed height there), rasterized from
  // the spline samples. The highway sits on a 3.6 m embankment; the redwood trails run flush
  // with the forest floor (their samples join in once they leave the highway's width).
  const dist = new Float32Array(nx * nz).fill(1e6);
  const roadY = new Float32Array(nx * nz);
  const R = 130;
  const raster = (px, pz, y) => {
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
          roadY[idx] = y;
        }
      }
    }
  };
  for (let i = 0; i < track.n; i++) raster(track.px[i], track.pz[i], track.py[i] - 3.6);
  for (const t of track.trails) {
    for (let i = 0; i < t.n; i += 2) if (Math.abs(t.sep[i]) > track.halfWidth) raster(t.px[i], t.pz[i], t.py[i] - 0.45);
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

  const gorge = seaGorge(track, def);
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let k = 0; k < nx; k++) {
      const idx = j * nx + k;
      const x = x0 + k * cx;
      const z = z0 + j * cz;
      let h = natural(x, z);
      const d = dist[idx];
      if (d < R) {
        const target = roadY[idx];
        const w = smoothstep(16, 58, d);
        // Never let the terrain rise above the road bed close to the road.
        h = target + (h - target) * w;
      }
      if (gorge) h = gorge.carve(x, z, h);
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
  return { meshes, sample, natural, gorge };
}

// The sea gorge under the timber bridge: a narrow inlet cut into the cliffs, running inland
// across the road from the sea to a head wall (where the waterfall pours in). Local frame:
// u along the gorge (+ toward the sea), v across it (along the road).
function seaGorge(track, def) {
  if (!track.bridge || !def.gorge) return null;
  const g = def.gorge;
  const sMid = (track.bridge.s0 + track.bridge.s1) / 2;
  const f = track.frame(sMid, {});
  // Toward the sea: the side of the road the coast is on.
  const sea = Math.sign(def.coastZ(f.x) - f.z) * Math.sign(f.rz) || 1;
  const ux = f.rx * sea;
  const uz = f.rz * sea;
  const floor = -7;
  const local = (x, z) => ({ u: (x - f.x) * ux + (z - f.z) * uz, v: (x - f.x) * f.tx + (z - f.z) * f.tz });
  const halfWidth = (u) => (u >= 0 ? g.width / 2 + u * 0.25 : g.width / 2 + (u / g.inland) * (g.width / 2 - 9));
  return {
    x: f.x,
    z: f.z,
    ux,
    uz,
    tx: f.tx,
    tz: f.tz,
    floor,
    width: g.width,
    inland: g.inland,
    headHeight: g.headHeight,
    roadY: track.roadY(sMid),
    halfWidth,
    local,
    carve(x, z, h) {
      const { u, v } = local(x, z);
      if (u < -g.inland - 30 || Math.abs(v) > g.width + 40) return h;
      const hw = halfWidth(Math.max(u, -g.inland));
      const across = smoothstep(hw, hw + 9, Math.abs(v));
      const head = smoothstep(-g.inland, -g.inland - 14, u);
      const t = Math.max(across, head);
      return Math.min(h, floor + (h - floor) * t);
    },
  };
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

function buildVegetation(def, terrain, quality, track, env) {
  const group = new THREE.Group();
  const rand = mulberry32(42);
  const density = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;
  const palms = [];
  const redwoods = [];
  const bushes = [];
  // Dense groves walling in the redwood trails: big trees just beyond the log fences, ferns and
  // undergrowth at their feet, never encroaching on the highway.
  const pr = {};
  for (const t of track.trails) {
    for (let ls = t.forkEnd; ls < t.mergeStart; ls += 6 / density) {
      const f = t.frame(ls, {});
      for (const side of [-1, 1]) {
        if (rand() < 0.15) continue;
        const off = side * (t.halfWidthAt(ls) + 2.2 + rand() * 7);
        const x = f.x + f.rx * off + (rand() - 0.5) * 2;
        const z = f.z + f.rz * off + (rand() - 0.5) * 2;
        track.project(x, z, -1, pr);
        if (Math.abs(pr.d) < track.fenceOffset + 6) continue;
        const { h } = terrain.sample(x, z);
        if (h < 3) continue;
        redwoods.push({ x, y: h - 0.3, z, rot: rand() * Math.PI * 2, scale: 0.75 + rand() * 0.55, stretch: 0.9 + rand() * 0.35 });
        if (rand() < 0.6) bushes.push({ x: x - f.rx * side * 1.8, y: h - 0.25, z: z - f.rz * side * 1.8, rot: rand() * 6.28, scale: 0.5 + rand() * 0.6, stretch: 0.6 + rand() * 0.4 });
      }
    }
  }
  const groveCount = redwoods.length;
  const tries = Math.round(30000 * density);
  for (let i = 0; i < tries; i++) {
    const x = -1100 + rand() * 2200;
    const z = -900 + rand() * 1250;
    const { h, road, steep } = terrain.sample(x, z);
    if (h < 3 || road < 19 || steep > 0.3) continue;
    const coastDist = def.coastZ(x) - z;
    const t = { x, y: h - 0.3, z, rot: rand() * Math.PI * 2, scale: 0.8 + rand() * 0.5 };
    if (coastDist < 110) {
      if (rand() < 0.45 && palms.length < 220 * density) palms.push(t);
    } else if (road < 260 && rand() < 0.16) {
      // Groves: thicker near the road where the player sees them, sparse in the distance.
      if (redwoods.length - groveCount < 420 * density) redwoods.push({ ...t, scale: 0.65 + rand() * 0.5, stretch: 0.85 + rand() * 0.35 });
    } else if (rand() < 0.012 && redwoods.length - groveCount < 420 * density) {
      redwoods.push({ ...t, scale: 0.6 + rand() * 0.45 });
    }
    if (road < 70 && road > 20 && steep < 0.22 && rand() < 0.25 && bushes.length < 1000 * density) {
      bushes.push({ x: x + rand() * 2, y: h - 0.25, z: z + rand() * 2, rot: rand() * 6.28, scale: 0.5 + rand() * 0.8, stretch: 0.7 + rand() * 0.5 });
    }
  }

  const photo = env && foliageMaterials(env);
  if (photo) {
    // Scanned bark and frond cards: trunks and leaves are two draw calls per species, and the
    // ferns only exist near the camera.
    const tree = new THREE.InstancedMesh(photoRedwood(), [photo.redwoodBark, photo.fronds], redwoods.length);
    scatter(tree, redwoods, (t, i) => [0.0, 0.0, 0.88 + ((i * 0.37) % 1) * 0.3]);
    const palm = new THREE.InstancedMesh(photoPalm(), [photo.palmBark, photo.fronds], palms.length);
    scatter(palm, palms, (t, i) => [0.0, 0.0, 0.9 + ((i * 0.53) % 1) * 0.2]);
    const ferns = bushes.map((b) => ({ ...b, scale: b.scale * 1.5, stretch: 0.8 + (b.stretch - 0.6) * 0.5 }));
    const fern = new THREE.InstancedMesh(fernGeometry(), photo.fronds, ferns.length);
    fern.name = 'ferns';
    group.userData.near = [new NearInstances(fern, ferns, 170)];
    group.add(tree, palm, fern);
    return group;
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

function buildRocks(def, terrain, env) {
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
    if (road < 20 || h > 24 || h < -6) continue;
    items.push({ x, y: h - 0.4, z, rot: rand() * 6.28, scale: 1.5 + rand() * 3.5, stretch: 0.8 + rand() * 0.6 });
  }
  // Sea stacks offshore.
  for (let i = 0; i < 14; i++) {
    const x = -900 + rand() * 1800;
    const z = def.coastZ(x) + 40 + rand() * 160;
    items.push({ x, y: -2, z, rot: rand() * 6.28, scale: 5 + rand() * 8, stretch: 1.4 + rand() * 1.4 });
  }
  const boulder = env?.models.boulder;
  if (boulder) {
    // Scanned boulder (1 m footprint, flat base): twice the old rock's radius, sunk a little,
    // and stretched up into sea stacks offshore. Random tilt hides that they are one rock.
    const placed = items.map((t) => ({ ...t, scale: t.scale * 2, stretch: (t.stretch * 0.8) / boulder.height, y: t.y - t.scale * 0.25, tilt: (rand() - 0.5) * 0.5 }));
    // Lift the scan a little to sit with the sunlit terrain.
    boulder.material.color.setRGB(1.2, 1.17, 1.15);
    const mesh = new THREE.InstancedMesh(boulder.geometry, boulder.material, placed.length);
    placed.forEach((t, i) => mesh.setMatrixAt(i, rockMatrix(t)));
    mesh.computeBoundingSphere();
    mesh.name = 'boulders';
    const group = new THREE.Group();
    group.add(mesh);
    const roadside = env.models.rock && roadsideRocks(terrain, env.models.rock, rand);
    if (roadside) {
      group.add(roadside.mesh);
      group.userData.near = [roadside.near];
    }
    return group;
  }
  const mesh = new THREE.InstancedMesh(geo, createGroundMaterial({ rockOnly: true }), items.length);
  scatter(mesh, items);
  return mesh;
}

function rockMatrix(t) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(t.tilt ?? 0, t.rot, (t.tilt ?? 0) * 0.7, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.scale, t.scale * (t.stretch ?? 1), t.scale));
}

// Scanned rocks half-buried in the grass beyond the verges, drawn only near the camera.
function roadsideRocks(terrain, rock, rand) {
  const items = [];
  for (let i = 0; i < 6000 && items.length < 420; i++) {
    const x = -1100 + rand() * 2200;
    const z = -900 + rand() * 1250;
    const { h, road, steep } = terrain.sample(x, z);
    if (road < 17 || road > 70 || h < 2 || steep > 0.35) continue;
    const scale = 0.6 + rand() ** 2 * 2.6;
    items.push({ x, y: h - 0.2 - scale * rock.height * 0.3, z, rot: rand() * 6.28, scale, stretch: 0.8 + rand() * 0.5, tilt: (rand() - 0.5) * 0.6 });
  }
  rock.material.color.setRGB(1.3, 1.25, 1.2);
  const mesh = new THREE.InstancedMesh(rock.geometry, rock.material, items.length);
  mesh.name = 'roadside-rocks';
  return { mesh, near: new NearInstances(mesh, items, 220, rockMatrix) };
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
export function oceanMaterial(normalMap, sunDir) {
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

export function buildScenery(scene, renderer, track, def, quality, env = null) {
  installHeightFog();
  const sunDir = sunDirection(def.sun);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMaterial(skyUniforms(sunDir, cloudTexture())));
  const skyU = sky.material.uniforms;
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
  // Exponential fog with low-lying mist (render/heightFog.js); colour and density per weather.
  scene.fog = new THREE.FogExp2(FOG_COLOR.clone(), 0.00034);

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
  const oceanU = ocean.material.uniforms;
  oceanU.normalMap.value = waterNormals;
  oceanU.sunDir.value.copy(sunDir);
  ocean.frustumCulled = false;
  scene.add(ocean);
  scene.add(buildShallows(def));

  const ground = createGroundMaterial({ env });
  const atlas = createVertexPbrMaterial({ envMapIntensity: 0.8 });
  const terrain = buildTerrain(track, def, quality, ground);
  scene.add(...terrain.meshes);
  const vegetation = buildVegetation(def, terrain, quality, track, env);
  scene.add(vegetation);
  const rocks = buildRocks(def, terrain, env);
  scene.add(rocks);
  // Small props drawn only near the camera, re-packed as it moves.
  const near = [...(vegetation.userData.near ?? []), ...(rocks.userData.near ?? [])];
  const lighthouse = buildLighthouse(def, terrain, atlas);
  scene.add(lighthouse);
  const boats = buildBoats(def, atlas);
  scene.add(boats);
  const mountains = buildMountains();
  scene.add(mountains);

  // Shadow-map texel snapping: moving the shadow camera in whole texels stops the shadow
  // edges from crawling as the player drives.
  const texel = (SHADOW_EXTENT * 2) / 512;
  const lightRot = new THREE.Matrix4();
  const lightInv = new THREE.Matrix4();
  const aimLight = () => {
    lightRot.lookAt(new THREE.Vector3(), sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    lightInv.copy(lightRot).invert();
  };
  aimLight();
  const snapped = new THREE.Vector3();
  const base = { hemi: 1.05, sky: new THREE.Color(), flash: 0 };
  let envLight = 1;
  let envTarget = null;

  return {
    sun,
    sunDir,
    sky,
    hemi,
    terrain,
    waterNormals,
    groundMaterial: ground,
    // Sky, sun, ambient, fog, clouds and sea for a weather preset (data/weather.js).
    applyWeather(w) {
      sunDirection(w.sun, sunDir);
      aimLight();
      sun.color.setHex(w.sun.color);
      sun.intensity = w.sun.intensity;
      hemi.color.setHex(w.hemi.sky);
      hemi.groundColor.setHex(w.hemi.ground);
      hemi.intensity = base.hemi = w.hemi.intensity;
      skyU.top.value.setHex(w.sky.top);
      skyU.horizon.value.setHex(w.sky.horizon);
      skyU.sunColor.value.setHex(w.sky.sun);
      skyU.glow.value = w.sky.glow;
      skyU.cover.value = w.clouds.cover;
      skyU.cloudLit.value.setHex(w.clouds.lit);
      skyU.cloudShade.value.setHex(w.clouds.shade);
      scene.fog.color.setHex(w.fog.color);
      scene.fog.density = w.fog.density;
      base.sky.setHex(w.fog.color);
      oceanU.sunDir.value.copy(sunDir);
      oceanU.sunColor.value.setHex(w.sky.sun).multiplyScalar(Math.min(1, w.sun.intensity / 2.2));
      oceanU.deep.value.setHex(w.ocean.deep);
      oceanU.shallow.value.setHex(w.ocean.shallow);
      oceanU.skyTop.value.setHex(w.sky.top);
      oceanU.skyHorizon.value.setHex(w.sky.horizon);
      mountains.material.color.setHex(w.mountains);
      envLight = Math.min(1, 0.35 + w.sun.intensity * 0.2 + w.hemi.intensity * 0.3);
    },
    // Lightning: 0..1 brightens the sky, the ambient light and the fog for a moment.
    setFlash(k) {
      if (k === base.flash) return;
      base.flash = k;
      skyU.flash.value = k * 0.9;
      hemi.intensity = base.hemi + k * 2.6;
      scene.fog.color.copy(base.sky).lerp(new THREE.Color(0xdfe6ff), k * 0.45);
    },
    update(t, camera) {
      sky.position.copy(camera.position);
      for (const n of near) n.update(camera.position);
      skyU.time.value = t;
      oceanU.time.value = t;
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
    // Renders the track world into a prefiltered cubemap: cars, glass and puddles then reflect
    // the real coast, sky and sun instead of a generic studio. Re-baked whenever the weather
    // changes. The bake uses unlit proxies of the same geometry (pre-lit colours), which is
    // cheap and keeps the half-float target free of specular hot spots.
    bakeEnvironment(at) {
      const env = new THREE.Scene();
      // Linear haze for the reflections: the height-fog chunks (render/heightFog.js) produce
      // NaNs in the PMREM cube passes, which blacken every lit material.
      env.fog = new THREE.Fog(scene.fog.color, 250, 2600 - Math.min(2000, scene.fog.density * 6e5));
      const envSky = new THREE.Mesh(sky.geometry, skyMaterial({ ...skyU, flash: { value: 0 } }));
      envSky.position.copy(at);
      env.add(envSky);
      const basic = (color) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(envLight) });
      env.add(new THREE.Mesh(ocean.geometry, basic(oceanU.deep.value.clone().lerp(oceanU.shallow.value, 0.4))));
      const land = basic(0x587a3c);
      for (const m of terrain.meshes) env.add(new THREE.Mesh(m.geometry, land));
      const leaves = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(envLight, envLight, envLight) });
      // Textured (photo) vegetation keeps its maps and cut-outs in the reflections.
      const unlit = new Map();
      const proxy = (mat) => {
        if (!mat.map) return leaves;
        if (!unlit.has(mat)) unlit.set(mat, new THREE.MeshBasicMaterial({ map: mat.map, alphaTest: mat.alphaTest, side: mat.side, vertexColors: true, color: leaves.color }));
        return unlit.get(mat);
      };
      for (const m of vegetation.children) {
        if (m.name === 'ferns') continue; // near-only props, invisible from a reflection probe
        const copy = new THREE.InstancedMesh(m.geometry, Array.isArray(m.material) ? m.material.map(proxy) : proxy(m.material), m.count);
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
      land.dispose();
      leaves.dispose();
      for (const mat of unlit.values()) mat.dispose();
      envTarget?.dispose();
      envTarget = rt;
      scene.environment = rt.texture;
      scene.environmentIntensity = 0.85 * envLight;
      return rt.texture;
    },
  };
}
