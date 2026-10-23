import * as THREE from 'three';
import { createNoise2D, fbm, mulberry32, smoothstep } from './noise.js';
import { grassTexture, rockTexture } from '../render/textures.js';
import { createVertexPbrMaterial } from '../render/vertexPbr.js';
import { installHeightFog } from '../render/heightFog.js';
import { cloudTexture, oceanMaterial, skyMaterial, skyUniforms, sunDirection, waterNormalMap, FOG_COLOR } from './scenery.js';
import { buildTunnels, buildVillage, buildIce, Snowfall, tunnelShade } from './alpineSetPieces.js';

// Alpine Summit biome (Chapter 2): a lake and a cobblestone village in the valley, meadows and
// pine forest on the lower slopes, scree and cliffs above the tree line, snowfields and a
// glacier under a ring of snow-capped peaks. The snow line, the snow on the pines and the
// falling snow follow the stage's weather (data/weather.js `snowLine`, `snow`).
// Same interface as the Emerald Coast's buildScenery (race/scenery.js), so the race does not
// care which biome it drives through. Everything is placed from fixed seeds at load time.

const TERRAIN = { x0: -1600, x1: 1500, z0: -1500, z1: 1100, cell: 10 };
const CHUNK_CELLS = 60;
const ROAD_BED = 3.6; // the road sits on a bed this far above the carved ground
const DEFAULT_SNOW_LINE = 190; // metres, when the weather does not say
const TREE_LINE = 150;

// The mountains before the road is cut into them. North is -z: the south face rises from the
// lake to the summit ridge (z about -180), falls into the glacier valley behind it and climbs
// the north wall; the flanks rise west of the canyon and east of the pass, and a ring of high
// peaks closes the horizon.
export function alpineHeight(def) {
  const n1 = createNoise2D(23);
  const n2 = createNoise2D(29);
  const n3 = createNoise2D(31);
  const ridged = (x, z) => {
    let s = 0;
    let a = 0.5;
    let f = 1;
    for (let i = 0; i < 5; i++) {
      s += (1 - Math.abs(n1(x * f, z * f))) ** 2 * a;
      f *= 2.07;
      a *= 0.5;
    }
    return s;
  };
  const M = def.massif;
  const V = def.village;
  return (x, z) => {
    let h;
    if (z > 260) h = 4;
    else if (z > -180) h = 4 + smoothstep(260, -180, z) * 165;
    else if (z > -470) h = 169 - smoothstep(-180, -470, z) * 70;
    else h = 99 + smoothstep(-470, -1150, z) * 560;
    h += smoothstep(-330, -850, x) * 380 + smoothstep(260, 950, x) * 330;
    h += smoothstep(800, 1600, Math.hypot(x - M.x, z - M.z)) * 260;
    // Ridges and gullies, bigger the higher the ground.
    h += (ridged(x / 330, z / 330) - 0.42) * (30 + h * 0.6);
    h += fbm(n2, x / 85, z / 85, 3) * 7;
    // The valley floor around the village, and the lake south of it.
    const dv = Math.hypot(x - V.x, (z - V.z) * 0.85);
    const flat = Math.exp(-((dv / 300) ** 2));
    h += (4 + fbm(n3, x / 120, z / 120, 2) * 2 - h) * flat;
    const shore = V.z + 120 + 45 * Math.sin(x / 190 + 1.1) + 20 * Math.sin(x / 61);
    const lake = smoothstep(shore - 25, shore + 45, z);
    h += (def.lakeLevel - 9 - Math.min(20, Math.max(0, z - shore) * 0.05) - h) * lake * (1 - smoothstep(500, 900, Math.abs(x - V.x)));
    return h;
  };
}

// ---------------------------------------------------------------------------
// Ground shader: alpine meadow on the flats (drier with height), triplanar granite on the
// steep ground and above the tree line, snow above the weather's snow line (cliffs shed it),
// a glacier tongue of blue ice under the north wall, wet gravel at the lake shore.
// ---------------------------------------------------------------------------

export function alpineGroundMaterial(env, shared) {
  const photo = Boolean(env?.tex.grass && env.tex.alpineRock && env.tex.snow);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const uniforms = {
    grassMap: { value: grassTexture() },
    rockMap: { value: photo ? env.tex.alpineRock : rockTexture() },
    photoGrass: { value: photo ? env.tex.grass : null },
    snowMap: { value: photo ? env.tex.snow : null },
    grassTint: { value: new THREE.Color(0x9fb37f) },
    snowLine: shared.snowLine,
    glacier: { value: new THREE.Vector4(160, -820, 260, 420) },
    lakeLevel: { value: 0 },
  };
  // Race.dispose frees textures it finds here (they never sit on the material itself).
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
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
        uniform sampler2D grassMap, rockMap, photoGrass, snowMap;
        uniform vec3 grassTint;
        uniform float snowLine, lakeLevel;
        uniform vec4 glacier;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        vec3 rockTriplanar(vec3 n, vec3 p) {
          vec3 bw = pow(abs(n), vec3(4.0));
          bw /= (bw.x + bw.y + bw.z);
          vec2 sx = p.zy * vec2(0.07, 0.1), sy = p.xz * 0.07, sz = p.xy * vec2(0.07, 0.1);
          vec3 c = texture2D(rockMap, sx).rgb * bw.x + texture2D(rockMap, sy).rgb * bw.y + texture2D(rockMap, sz).rgb * bw.z;
          #ifdef PHOTO_GROUND
            // The scan is a warm brown granite: cool it to the grey of high alpine rock.
            vec3 c2 = texture2D(rockMap, sx * 0.21 + 0.3).rgb * bw.x + texture2D(rockMap, sy * 0.21 + 0.3).rgb * bw.y + texture2D(rockMap, sz * 0.21 + 0.3).rgb * bw.z;
            c = mix(c, c2, 0.45);
            float l = dot(c, vec3(0.3, 0.55, 0.15));
            return mix(vec3(l), c, 0.28) * vec3(0.96, 0.98, 1.03) * 1.7;
          #else
            return c * vec3(0.86, 0.88, 0.92);
          #endif
        }`
      )
      .replace(
        '#include <map_fragment>',
        `vec3 nW = normalize(vWNormal);
        float slope = 1.0 - nW.y;
        vec4 gA = texture2D(grassMap, vWPos.xz * 0.11);
        vec4 gB = texture2D(grassMap, vWPos.xz * 0.013 + 0.37);
        float macro = gB.a;
        #ifdef PHOTO_GROUND
          vec3 pg = mix(texture2D(photoGrass, vWPos.xz * 0.4).rgb, texture2D(photoGrass, vWPos.xz * 0.09 + 0.5).rgb, 0.4);
          vec3 grass = mix(gA.rgb, gB.rgb, 0.35) * grassTint * (dot(pg, vec3(0.3, 0.59, 0.11)) / 0.23);
          grass = mix(grass, pg * 0.85, 0.2);
        #else
          vec3 grass = mix(gA.rgb, gB.rgb, 0.35) * grassTint;
        #endif
        // Lush valley pasture, browner and thinner turf higher up.
        grass *= mix(vec3(0.92, 1.05, 0.9), vec3(1.15, 1.02, 0.78), smoothstep(30.0, 150.0, vWPos.y + (macro - 0.5) * 40.0));
        float rockW = smoothstep(0.2, 0.34, slope + (macro - 0.5) * 0.18);
        rockW = max(rockW, smoothstep(${TREE_LINE.toFixed(1)}, ${(TREE_LINE + 110).toFixed(1)}, vWPos.y + (macro - 0.5) * 70.0) * 0.85);
        vec3 col = mix(grass, rockTriplanar(nW, vWPos), rockW);
        // Snow: above the snow line on anything not too steep to hold it.
        float sn = smoothstep(snowLine - 10.0, snowLine + 16.0, vWPos.y + (macro - 0.5) * 36.0);
        sn *= 1.0 - smoothstep(0.36, 0.56, slope + (gA.a - 0.5) * 0.12);
        #ifdef PHOTO_GROUND
          vec3 snowC = mix(vec3(0.94, 0.96, 0.99), texture2D(snowMap, vWPos.xz * 0.018).rgb * 1.2, 0.3);
        #else
          vec3 snowC = vec3(0.93, 0.95, 0.98) * (0.94 + 0.06 * gA.a);
        #endif
        // The glacier: an ice tongue under the north wall, blue where the snow is blown off.
        float gl = 1.0 - smoothstep(0.65, 1.0, length((vWPos.xz - glacier.xy) / glacier.zw));
        gl *= 1.0 - smoothstep(0.55, 0.75, slope);
        snowC = mix(snowC, vec3(0.62, 0.8, 0.92) * (0.85 + 0.25 * gA.a), gl * smoothstep(0.35, 0.65, macro) * 0.75);
        sn = max(sn, gl);
        col = mix(col, snowC, sn);
        // Wet gravel along the lake shore.
        float shore = 1.0 - smoothstep(0.4, 2.6, vWPos.y - lakeLevel + (macro - 0.5) * 1.5);
        col = mix(col, rockTriplanar(nW, vWPos) * vec3(0.55, 0.55, 0.52), shore * 0.85);
        diffuseColor.rgb *= col;`
      );
  };
  mat.customProgramCacheKey = () => 'alpine-ground' + (photo ? '-photo' : '');
  mat.userData.uniforms = uniforms;
  return mat;
}

// ---------------------------------------------------------------------------
// Terrain: the height field carved around the road, in frustum-culled chunks.
// ---------------------------------------------------------------------------

function buildTerrain(track, def, quality, material) {
  const { x0, x1, z0, z1 } = TERRAIN;
  const cell = quality === 'low' ? 16 : quality === 'medium' ? 12 : TERRAIN.cell;
  const nx = Math.round((x1 - x0) / cell) + 1;
  const nz = Math.round((z1 - z0) / cell) + 1;
  const cx = (x1 - x0) / (nx - 1);
  const cz = (z1 - z0) / (nz - 1);
  const natural = alpineHeight(def);

  // Distance from every vertex to the road and the road bed height there. Under the summit
  // tunnel the ground is carved too: the tunnel's own mound (alpineSetPieces.js) covers it.
  const dist = new Float32Array(nx * nz).fill(1e6);
  const roadY = new Float32Array(nx * nz);
  const R = 120;
  for (let i = 0; i < track.n; i++) {
    const px = track.px[i];
    const pz = track.pz[i];
    const y = track.py[i] - ROAD_BED;
    const ia = Math.max(0, Math.floor((px - R - x0) / cx));
    const ib = Math.min(nx - 1, Math.ceil((px + R - x0) / cx));
    const ja = Math.max(0, Math.floor((pz - R - z0) / cz));
    const jb = Math.min(nz - 1, Math.ceil((pz + R - z0) / cz));
    for (let j = ja; j <= jb; j++) {
      const z = z0 + j * cz;
      for (let k = ia; k <= ib; k++) {
        const d = Math.hypot(x0 + k * cx - px, z - pz);
        const idx = j * nx + k;
        if (d < dist[idx]) {
          dist[idx] = d;
          roadY[idx] = y;
        }
      }
    }
  }

  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let k = 0; k < nx; k++) {
      const idx = j * nx + k;
      let h = natural(x0 + k * cx, z0 + j * cz);
      const d = dist[idx];
      if (d < R) {
        const target = roadY[idx];
        // Cut into the mountain on the uphill side, an embankment on the valley side.
        h = target + (h - target) * smoothstep(14, 50, d);
      }
      heights[idx] = h;
    }
  }
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
          nor.set(normals.subarray(src * 3, src * 3 + 3), o);
        }
      }
      const index = [];
      for (let j = 0; j < hgt - 1; j++) {
        for (let k = 0; k < w - 1; k++) {
          const a = j * w + k;
          index.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
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
  return { meshes, sample, natural, gorge: null };
}

// ---------------------------------------------------------------------------
// The ring of snow-capped peaks beyond the terrain: a polar height field shaded at build time
// (granite below, snow above), fogged like everything else so they fade with the weather.
// ---------------------------------------------------------------------------

function buildPeaks(def) {
  const noise = createNoise2D(41);
  const M = def.massif;
  const segs = 200;
  // The innermost ring sits below the lake, so the water meets the foot of the range.
  const rings = [1350, 1450, 1750, 2050, 2300, 2550, 2800];
  const pos = [];
  const col = [];
  const idx = [];
  const rock = new THREE.Color(0x6b6f78);
  const snow = new THREE.Color(0xf2f5fa);
  const c = new THREE.Color();
  const heightAt = (a, r) => {
    const u = Math.cos(a) * 3.1;
    const v = Math.sin(a) * 3.1;
    let ridge = 0;
    let amp = 0.55;
    let f = 1;
    for (let k = 0; k < 5; k++) {
      ridge += (1 - Math.abs(noise(u * f + r / 900, v * f))) ** 2.2 * amp;
      f *= 2.1;
      amp *= 0.5;
    }
    const lift = smoothstep(1350, 2150, r) * (1 - smoothstep(2350, 2800, r) * 0.55);
    return 260 + ridge * 1250 * lift;
  };
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    for (const r of rings) {
      const h = r < 1400 ? -20 : heightAt(a, r);
      pos.push(M.x + Math.cos(a) * r, h, M.z + Math.sin(a) * r);
      // Snow above about 600 m, broken by noise; the steep faces stay dark.
      const k = smoothstep(560, 760, h + noise(a * 9, r / 300) * 120);
      c.copy(rock).lerp(snow, k);
      col.push(c.r, c.g, c.b);
    }
  }
  const nr = rings.length;
  for (let i = 0; i < segs; i++) {
    for (let r = 0; r < nr - 1; r++) {
      const a = i * nr + r;
      const b = a + nr;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Faces were wound for a viewer inside the ring; make sure the normals point up.
  if (geo.attributes.normal.getY(0) < 0) {
    const ia = geo.index.array;
    for (let t = 0; t < ia.length; t += 3) [ia[t + 1], ia[t + 2]] = [ia[t + 2], ia[t + 1]];
    geo.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'peaks';
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// Pines: a scanned-bark trunk and five tiers of needles (vertex coloured), one instanced draw
// per part. Snow settles on the upward-facing needles above the snow line.
// ---------------------------------------------------------------------------

export function pineGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.38, 6, 6, 1, true).translate(0, 3, 0);
  const uv = trunk.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 3);
  parts.push({ geo: trunk, group: 0 });
  const dark = new THREE.Color(0x14301f);
  const mid = new THREE.Color(0x24482c);
  const tip = new THREE.Color(0x3d6a3e);
  const tiers = 5;
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1);
    const r = 3.1 - k * 2.2;
    const hTier = 3.4 - k * 1.2;
    const y = 2.2 + k * 8.6;
    const cone = new THREE.ConeGeometry(r, hTier, 8, 1, true).translate(0, y + hTier / 2, 0);
    // Droop the rim and twist each tier so the silhouette is ragged.
    const p = cone.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i)) + t * 0.4;
      const rr = Math.hypot(p.getX(i), p.getZ(i));
      if (rr > r * 0.9) {
        const jag = 1 + 0.16 * Math.sin(a * 4 + t);
        p.setX(i, Math.cos(a) * rr * jag);
        p.setZ(i, Math.sin(a) * rr * jag);
        p.setY(i, p.getY(i) - 0.35);
      }
    }
    cone.computeVertexNormals();
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const up = (p.getY(i) - y) / hTier;
      c.copy(dark).lerp(mid, up).lerp(tip, up * up * (0.4 + k * 0.6));
      c.toArray(col, i * 3);
    }
    cone.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push({ geo: cone, group: 1 });
  }
  // Merge by hand: trunk first (group 0, bark), needles after (group 1).
  const flat = parts.map(({ geo, group }) => ({ geo: geo.toNonIndexed(), group }));
  const count = flat.reduce((n, { geo }) => n + geo.attributes.position.count, 0);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const cols = new Float32Array(count * 3).fill(1);
  let o = 0;
  let trunkCount = 0;
  for (const { geo, group } of flat) {
    const n = geo.attributes.position.count;
    pos.set(geo.attributes.position.array, o * 3);
    nor.set(geo.attributes.normal.array, o * 3);
    if (geo.attributes.uv) uvs.set(geo.attributes.uv.array, o * 2);
    if (geo.attributes.color) cols.set(geo.attributes.color.array, o * 3);
    else {
      // Bark: darker toward the ground.
      for (let i = 0; i < n; i++) {
        const k = 0.55 + Math.min(1, geo.attributes.position.getY(i) / 4) * 0.45;
        cols.set([k, k, k], (o + i) * 3);
      }
    }
    if (group === 0) trunkCount += n;
    o += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.addGroup(0, trunkCount, 0);
  g.addGroup(trunkCount, count - trunkCount, 1);
  g.computeBoundingSphere();
  return g;
}

// Needles that whiten on top above the snow line. `shared.snowLine` is the weather's line;
// `shared.snowCover` how much snow sits on the branches (0-1).
function needleMaterial(shared) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.snowLine = shared.snowLine;
    shader.uniforms.snowCover = shared.snowCover;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float snowLine, snowCover;\nvarying float vSnow;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        float upFacing = smoothstep(0.15, 0.6, objectNormal.y);
        vSnow = upFacing * snowCover * smoothstep(snowLine - 60.0, snowLine + 10.0, wp.y);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSnow;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), vSnow);');
  };
  mat.customProgramCacheKey = () => 'alpine-needles';
  return mat;
}

function scatterMatrices(mesh, list) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const color = new THREE.Color();
  list.forEach((t, i) => {
    q.setFromAxisAngle(up, t.rot);
    if (t.tilt) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(t.tilt, 0, t.tilt * 0.6)));
    m.compose(p.set(t.x, t.y, t.z), q, s.set(t.scale, t.scale * (t.stretch ?? 1), t.scale));
    mesh.setMatrixAt(i, m);
    if (t.shade != null) mesh.setColorAt(i, color.setScalar(t.shade));
  });
  mesh.count = list.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function buildForest(def, terrain, quality, track, env, shared) {
  const rand = mulberry32(73);
  const forest = createNoise2D(17);
  const density = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;
  const pines = [];
  const V = def.village;
  const tries = Math.round(40000 * density);
  const max = 1500 * density;
  for (let i = 0; i < tries && pines.length < max; i++) {
    const x = -1200 + rand() * 2300;
    const z = -1100 + rand() * 1700;
    const { h, road, steep } = terrain.sample(x, z);
    if (road < 19 || steep > 0.42 || h < def.lakeLevel + 2) continue;
    // Forest in patches below the tree line, thinning as it climbs; denser near the road.
    const line = TREE_LINE + forest(x / 140, z / 140) * 30;
    if (h > line) continue;
    const patch = forest(x / 260 + 7, z / 260) * 0.5 + 0.5 - smoothstep(line - 50, line, h) * 0.5;
    const near = road < 140 ? 0.25 : 0;
    if (rand() > patch * 0.9 + near) continue;
    // Keep the village square and its meadows open.
    if (Math.hypot(x - V.x, z - V.z) < 140 && rand() < 0.85) continue;
    pines.push({ x, y: h - 0.3, z, rot: rand() * Math.PI * 2, scale: 0.75 + rand() * 0.6, stretch: 0.9 + rand() * 0.35, shade: 0.8 + rand() * 0.35 });
  }
  const bark = new THREE.MeshLambertMaterial({ map: env?.tex.pineBark ?? null, color: env?.tex.pineBark ? 0xffffff : 0x5a4030, vertexColors: true });
  const mesh = new THREE.InstancedMesh(pineGeometry(), [bark, needleMaterial(shared)], pines.length);
  scatterMatrices(mesh, pines);
  mesh.name = 'pines';
  mesh.castShadow = false;
  return mesh;
}

// Granite boulders on the slopes and in the scree above the trees.
function buildBoulders(terrain, env) {
  const boulder = env?.models.boulder;
  const rand = mulberry32(88);
  const items = [];
  for (let i = 0; i < 9000 && items.length < 320; i++) {
    const x = -1200 + rand() * 2300;
    const z = -1100 + rand() * 1700;
    const { h, road, steep } = terrain.sample(x, z);
    if (road < 18 || steep > 0.5 || h < 3) continue;
    // Mostly in the scree, a few in the meadows.
    if (h < 120 && rand() < 0.8) continue;
    const scale = (boulder ? 2.2 : 1.4) + rand() ** 2 * 7;
    items.push({ x, y: h - scale * 0.25, z, rot: rand() * 6.28, scale, stretch: 0.6 + rand() * 0.5, tilt: (rand() - 0.5) * 0.5 });
  }
  let mesh;
  if (boulder) {
    const mat = boulder.material.clone();
    mat.color.setRGB(1.25, 1.27, 1.32);
    mesh = new THREE.InstancedMesh(boulder.geometry, mat, items.length);
  } else {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x7a7e86 }), items.length);
  }
  scatterMatrices(mesh, items);
  mesh.name = 'boulders';
  return mesh;
}

export function buildAlpineScenery(scene, renderer, track, def, quality, env = null) {
  installHeightFog();
  const sunDir = sunDirection(def.sun);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMaterial(skyUniforms(sunDir, cloudTexture())));
  const skyU = sky.material.uniforms;
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.FogExp2(FOG_COLOR.clone(), 0.00034);

  // Lighting budget as on the coast: one shadowed sun following the player plus a hemisphere.
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a5236, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.7);
  sun.position.copy(sunDir).multiplyScalar(120);
  const SHADOW_EXTENT = 22;
  Object.assign(sun.shadow.camera, { left: -SHADOW_EXTENT, right: SHADOW_EXTENT, top: SHADOW_EXTENT, bottom: -SHADOW_EXTENT, near: 40, far: 200 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  sun.shadow.mapSize.set(512, 512);
  sun.castShadow = quality !== 'low';
  scene.add(sun, sun.target);

  // The lake: the coast's ocean shader, calmer, at the lake's level.
  const waterNormals = waterNormalMap();
  // It reaches under the ring of peaks, never out to an open horizon.
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(3400, 1600).rotateX(-Math.PI / 2), oceanMaterial(waterNormals, sunDir));
  lake.position.set(def.massif.x, def.lakeLevel, def.village.z + 500);
  const lakeU = lake.material.uniforms;
  lakeU.normalMap.value = waterNormals;
  lakeU.sunDir.value.copy(sunDir);
  scene.add(lake);

  // Snow line and branch snow, shared by the ground, the pines and the tunnel mound.
  const shared = { snowLine: { value: DEFAULT_SNOW_LINE }, snowCover: { value: 0.3 } };
  const ground = alpineGroundMaterial(env, shared);
  ground.userData.uniforms.lakeLevel.value = def.lakeLevel;
  const atlas = createVertexPbrMaterial({ envMapIntensity: 0.8 });
  const terrain = buildTerrain(track, def, quality, ground);
  scene.add(...terrain.meshes);
  const peaks = buildPeaks(def);
  scene.add(peaks);
  const pines = buildForest(def, terrain, quality, track, env, shared);
  scene.add(pines);
  const boulders = buildBoulders(terrain, env);
  scene.add(boulders);
  const village = buildVillage(track, def, terrain, atlas);
  scene.add(village);
  const tunnels = buildTunnels(track, def, terrain, ground, env);
  if (tunnels) scene.add(tunnels);
  const ice = buildIce(track);
  if (ice) scene.add(ice);
  const snow = new Snowfall(scene, quality);

  const texel = (SHADOW_EXTENT * 2) / 512;
  const lightRot = new THREE.Matrix4();
  const lightInv = new THREE.Matrix4();
  const aimLight = () => {
    lightRot.lookAt(new THREE.Vector3(), sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    lightInv.copy(lightRot).invert();
  };
  aimLight();
  const snapped = new THREE.Vector3();
  const base = { hemi: 1.05, sun: 2.7, sky: new THREE.Color(), flash: 0, shade: 0 };
  const proj = { i: -1 };
  let envLight = 1;
  let envTarget = null;
  let landColor = new THREE.Color(0x6f7a5e);

  const light = () => {
    // Inside the tunnel the sky and the sun are gone: dim both (the hemisphere less, so the
    // tunnel lights still read).
    hemi.intensity = (base.hemi + base.flash * 2.6) * (1 - 0.7 * base.shade);
    sun.intensity = base.sun * (1 - 0.95 * base.shade);
  };

  return {
    sun,
    sunDir,
    sky,
    hemi,
    terrain,
    waterNormals,
    groundMaterial: ground,
    applyWeather(w) {
      sunDirection(w.sun, sunDir);
      aimLight();
      sun.color.setHex(w.sun.color);
      base.sun = w.sun.intensity;
      hemi.color.setHex(w.hemi.sky);
      hemi.groundColor.setHex(w.hemi.ground);
      base.hemi = w.hemi.intensity;
      light();
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
      lakeU.sunDir.value.copy(sunDir);
      lakeU.sunColor.value.setHex(w.sky.sun).multiplyScalar(Math.min(1, w.sun.intensity / 2.2));
      lakeU.deep.value.setHex(w.ocean.deep);
      lakeU.shallow.value.setHex(w.ocean.shallow);
      lakeU.skyTop.value.setHex(w.sky.top);
      lakeU.skyHorizon.value.setHex(w.sky.horizon);
      const snowLine = w.snowLine ?? DEFAULT_SNOW_LINE;
      shared.snowLine.value = snowLine;
      shared.snowCover.value = (w.snow ?? 0) > 0 ? 0.9 : 0.35;
      snow.set(w.snow ?? 0);
      ice?.userData.setLevel(Math.max(def.iceBase ?? 0, w.ice ?? 0), w.snow ?? 0);
      envLight = Math.min(1, 0.35 + w.sun.intensity * 0.2 + w.hemi.intensity * 0.3);
      // What the reflections see of the ground: meadow, or snow when it lies low.
      landColor = new THREE.Color(0x5f7050).lerp(new THREE.Color(0xd9dee6), smoothstep(150, 20, snowLine));
    },
    setFlash(k) {
      if (k === base.flash) return;
      base.flash = k;
      skyU.flash.value = k * 0.9;
      light();
      scene.fog.color.copy(base.sky).lerp(new THREE.Color(0xdfe6ff), k * 0.45);
    },
    update(t, camera) {
      sky.position.copy(camera.position);
      skyU.time.value = t;
      lakeU.time.value = t * 0.5;
      snow.update(t, camera, renderer);
      tunnels?.userData.update(t);
      const shade = tunnelShade(track, camera.position, proj);
      if (Math.abs(shade - base.shade) > 0.01) {
        base.shade = shade;
        light();
      }
    },
    follow(target) {
      snapped.copy(target).applyMatrix4(lightInv);
      snapped.x = Math.round(snapped.x / texel) * texel;
      snapped.y = Math.round(snapped.y / texel) * texel;
      snapped.applyMatrix4(lightRot);
      sun.target.position.copy(snapped);
      sun.position.copy(snapped).addScaledVector(sunDir, 120);
    },
    // Frees the baked cubemap's render target (the race is being thrown away).
    disposeEnvironment() {
      envTarget?.dispose();
      envTarget = null;
    },
    // Reflections of the mountains, baked from unlit proxies (see race/scenery.js).
    bakeEnvironment(at) {
      const envScene = new THREE.Scene();
      envScene.fog = new THREE.Fog(scene.fog.color, 250, 2600 - Math.min(2000, scene.fog.density * 6e5));
      const envSky = new THREE.Mesh(sky.geometry, skyMaterial({ ...skyU, flash: { value: 0 } }));
      envSky.position.copy(at);
      envScene.add(envSky);
      const basic = (color) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(envLight) });
      const water = basic(lakeU.deep.value.clone().lerp(lakeU.shallow.value, 0.4));
      const lakeProxy = new THREE.Mesh(lake.geometry, water);
      lakeProxy.position.copy(lake.position);
      envScene.add(lakeProxy);
      const land = basic(landColor);
      for (const m of terrain.meshes) envScene.add(new THREE.Mesh(m.geometry, land));
      const vc = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(envLight, envLight, envLight) });
      envScene.add(new THREE.Mesh(peaks.geometry, vc));
      const trees = new THREE.InstancedMesh(pines.geometry, vc, pines.count);
      trees.instanceMatrix = pines.instanceMatrix;
      trees.count = pines.count;
      envScene.add(trees);
      envScene.add(new THREE.Mesh(village.geometry, vc));
      const pmrem = new THREE.PMREMGenerator(renderer);
      const rt = pmrem.fromScene(envScene, 0.02, 0.5, 4000, { size: 256, position: at });
      pmrem.dispose();
      envSky.material.dispose();
      for (const m of [water, land, vc]) m.dispose();
      envTarget?.dispose();
      envTarget = rt;
      scene.environment = rt.texture;
      scene.environmentIntensity = 0.85 * envLight;
      return rt.texture;
    },
  };
}
