import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, mulberry32 } from './noise.js';
import { asphaltTextures } from '../render/textures.js';
import { bothFaces, createVertexPbrMaterial, mergePainted, paintVertices, stamp } from '../render/vertexPbr.js';
import { LAYOUT } from './surface.js';

// Render geometry generated from the race spline: asphalt with a rubbered-in racing line,
// gravel shoulders and grass verges (core/surface.js), raised rumble-strip kerbs, embankment, steel guardrails, lamp posts, chevron
// boards, jump ramps and the start/finish gantry. Untextured trackside hardware (guardrails,
// posts, lamps, gantry) is merged into one vertex-PBR mesh: a single draw call for the lap.

const ROAD_TILE = 40; // metres of road per texture repeat

// Loose gravel and packed dirt: warm stones of mixed sizes over a dusty base, a little darker
// toward the asphalt where cars have scattered it (u = 0 is the road side).
function gravelTexture() {
  const tex = canvasTexture(THREE, 128, 256, (g, w, h) => {
    const rand = mulberry32(11);
    g.fillStyle = '#8a7a62';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4200; i++) {
      const v = 70 + rand() * 110;
      const r = rand() < 0.15 ? 2 + rand() * 2.5 : 0.8 + rand() * 1.4;
      g.fillStyle = `rgba(${v + 18},${v + 6},${v - 12},${0.35 + rand() * 0.5})`;
      g.beginPath();
      g.ellipse(rand() * w, rand() * h, r, r * (0.6 + rand() * 0.4), rand() * 3, 0, Math.PI * 2);
      g.fill();
    }
    const edge = g.createLinearGradient(0, 0, w, 0);
    edge.addColorStop(0, 'rgba(30,26,22,0.35)');
    edge.addColorStop(0.25, 'rgba(30,26,22,0)');
    g.fillStyle = edge;
    g.fillRect(0, 0, w, h);
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

// Stretches of highway (in metres) that have no road of their own: the timber bridge (its
// deck is a set-piece, race/setPieces.js) and, on one side only, the openings where a redwood
// trail forks off or merges back (no rail there).
function gaps(track, side = 0) {
  const out = track.bridge ? [[track.bridge.s0, track.bridge.s1]] : [];
  if (side) {
    for (const t of track.trails) {
      if (t.side !== side) continue;
      out.push([t.s0, t.forkEndS], [t.mergeStartS, t.s1]);
    }
  }
  return out;
}
const inGaps = (list, s) => list.some(([a, b]) => s >= a && s <= b);

// Sample-index ranges [from, to] of the closed loop that avoid the gaps.
function spans(track, list) {
  if (!list.length) return [[0, track.n]];
  const out = [];
  let from = -1;
  for (let k = 0; k <= track.n; k++) {
    const s = k >= track.n ? track.length : track.s[k];
    const open = !inGaps(list, s) && k < track.n;
    if (open && from < 0) from = k;
    if ((!open || k === track.n) && from >= 0) {
      if (k - from >= 1) out.push([from, k]);
      from = -1;
    }
  }
  if (out.length && out[out.length - 1][1] === track.n - 1) out[out.length - 1][1] = track.n;
  return out;
}

const ribbons = (track, cols, list, opts) => {
  const geos = spans(track, list).map(([from, to]) => fixUpNormals(ribbon(track, cols, { ...opts, from, to })));
  return geos.length === 1 ? geos[0] : mergeGeometries(geos);
};

// Rain on the road: `wet` (shared uniform, 0..1) darkens the surface and turns it glossy, so
// it mirrors the sky and the lights through the baked environment map.
// It runs the material's own onBeforeCompile first (vertex PBR, the photo road's overlay) and
// hooks in once albedo and roughness are final: after the colour chunk, before the normals.
export function wettable(material, wet, { darken = 0.45, key }) {
  const own = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    own.call(material, shader, renderer);
    shader.uniforms.uWet = wet;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb *= 1.0 - ${darken.toFixed(3)} * uWet;`);
    if (material.isMeshStandardMaterial) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        'roughnessFactor = mix(roughnessFactor, 0.07 + roughnessFactor * 0.22, uWet);\n#include <normal_fragment_begin>'
      );
    }
  };
  material.customProgramCacheKey = () => `wet-${key}`;
  return material;
}

// Photographic asphalt (a few metres per repeat, from envAssets.js) under the procedural
// overlay: painted lines, rubbered wheel tracks, sealed cracks and patches (and their relief)
// repeat only every ROAD_TILE metres, which hides the photo's short repeat.
function photoRoadMaterial(env, { widthM, maxAniso }) {
  const PHOTO_TILE = 4; // metres per repeat of the asphalt_04 scan
  const map = env.tex.asphalt.clone();
  map.repeat.set(widthM / PHOTO_TILE, ROAD_TILE / PHOTO_TILE);
  // The scan's own normals are too fine to survive mipmapping, which leaves a wet road
  // reflecting flat fog; the procedural relief (40 m tile) keeps the rain glints.
  const { overlay, normalMap } = asphaltTextures({ widthM, tileM: ROAD_TILE, lanes: 3, maxAniso, overlay: true });
  const material = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.86,
    metalness: 0,
    envMapIntensity: 0.6,
  });
  const uniforms = {
    roadMarks: { value: overlay },
    // The scan is a pale, clean grey; real highway asphalt is darker and slightly blue.
    asphaltTint: { value: new THREE.Color(0.48, 0.49, 0.54) },
    paintColor: { value: new THREE.Color(0.78, 0.78, 0.76) },
  };
  // Race.dispose frees textures it finds here (they never sit on the material itself).
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoadUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoadUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D roadMarks;\nuniform vec3 asphaltTint, paintColor;\nvarying vec2 vRoadUv;\nvec4 roadMk;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        roadMk = texture2D(roadMarks, vRoadUv);
        // The scan is fine-grained and soft; stretch its contrast so the aggregate reads.
        diffuseColor.rgb = max(vec3(0.0), (diffuseColor.rgb - 0.22) * 1.5 + 0.22);
        diffuseColor.rgb *= asphaltTint * roadMk.g * 2.0;
        diffuseColor.rgb = mix(diffuseColor.rgb, paintColor, roadMk.r);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(clamp(roughnessFactor + (roadMk.b - 0.5), 0.3, 1.0), 0.55, roadMk.r);`
      );
  };
  return material;
}

export function buildTrackMeshes(track, renderer, { groundMaterial, env = null } = {}) {
  const group = new THREE.Group();
  group.name = 'track';
  const hw = track.halfWidth;
  const sh = track.shoulder;
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const wet = { value: 0 };
  group.userData.wet = wet;
  const noRoad = gaps(track);

  // Asphalt: albedo with painted lines, tyre-polished wheel tracks, cracks and patches, plus
  // matching normal and roughness maps so the sun glints off the smooth lines.
  // With the photographic assets loaded, a scanned asphalt under the same markings.
  let roadMaterial;
  if (env?.tex.asphalt) {
    roadMaterial = photoRoadMaterial(env, { widthM: hw * 2, maxAniso });
  } else {
    const asphalt = asphaltTextures({ widthM: hw * 2, tileM: ROAD_TILE, lanes: 3, maxAniso });
    roadMaterial = new THREE.MeshStandardMaterial({
      map: asphalt.map,
      normalMap: asphalt.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: asphalt.roughnessMap,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.6,
    });
  }
  const road = new THREE.Mesh(ribbons(track, [[-hw, 0, 0], [0, 0, 0.5], [hw, 0, 1]], noRoad), roadMaterial);
  wettable(road.material, wet, { darken: 0.5, key: env?.tex.asphalt ? 'road-photo' : 'road' });
  road.receiveShadow = true;
  group.add(road);
  group.add(buildRacingLine(track, noRoad, wet));

  // Gravel shoulders, then the grass verge up to the rail and the embankment falling away to
  // the terrain, both in the terrain's layered ground shader (grass on the flat).
  const gv = LAYOUT.gravel;
  // Scanned gravel tiles about every 2 m (u spans the shoulder, v runs 8 m per unit).
  // Urban tracks (Neon City) run concrete hard shoulders instead.
  const urban = Boolean(track.def.urban);
  let gravelMat;
  if (urban) {
    gravelMat = new THREE.MeshStandardMaterial({ map: env?.tex.pavement?.clone() ?? null, roughness: 0.8, color: env?.tex.pavement ? 0x8a8c92 : 0x55585e });
    gravelMat.map?.repeat.set(gv / 3, 2.6);
  } else if (env?.tex.gravel) {
    gravelMat = new THREE.MeshStandardMaterial({ map: env.tex.gravel.clone(), normalMap: env.tex.gravelNormal?.clone() ?? null, roughness: 0.95, color: 0xd8d0c4 });
    for (const t of [gravelMat.map, gravelMat.normalMap]) t?.repeat.set(gv / 2, 4);
  } else {
    gravelMat = new THREE.MeshStandardMaterial({ map: gravelTexture(), roughness: 1 });
  }
  const gravel = wettable(gravelMat, wet, { darken: 0.4, key: urban ? 'pavement' : 'gravel' });
  const shoulders = mergeGeometries([
    ribbons(track, [[hw, 0, 0], [hw + gv, -0.02, 1]], noRoad, { vScale: 8 }),
    ribbons(track, [[-hw - gv, -0.02, 1], [-hw, 0, 0]], noRoad, { vScale: 8 }),
  ]);
  const shoulderMesh = new THREE.Mesh(shoulders, gravel);
  shoulderMesh.receiveShadow = true;
  group.add(shoulderMesh);

  // Urban: the shoulder runs on to the barrier (paved alike) and the biome builds the deck.
  const bank = urban ? mergeGeometries([
    ribbons(track, [[hw + gv, -0.02, 0], [hw + sh + 0.5, -0.02, 1]], noRoad, { vScale: 8 }),
    ribbons(track, [[-hw - sh - 0.5, -0.02, 0], [-hw - gv, -0.02, 1]], noRoad, { vScale: 8 }),
  ]) : mergeGeometries([
    ribbons(track, [[hw + gv, -0.02, 0], [hw + sh, -0.05, 0.2], [hw + sh + 2, -0.6, 0.5], [hw + sh + 6.5, -4.2, 1]], noRoad, { step: 2, vScale: 10 }),
    ribbons(track, [[-hw - sh - 6.5, -4.2, 0], [-hw - sh - 2, -0.6, 0.5], [-hw - sh, -0.05, 0.8], [-hw - gv, -0.02, 1]], noRoad, { step: 2, vScale: 10 }),
  ]);
  const bankMesh = new THREE.Mesh(bank, urban ? gravel : groundMaterial ?? new THREE.MeshLambertMaterial({ color: 0x5f7f3a }));
  bankMesh.receiveShadow = true;
  group.add(bankMesh);

  // Raised red/white rumble strips through the corners: a 7 cm hump with 1 m stripes.
  const kerbGeos = [];
  let start = -1;
  const sharp = (i) => Math.abs(track.curv[i]) > 1 / 150;
  const kerbProfile = (side) => {
    const cols = [[hw - 0.2, 0.0, 0], [hw + 0.05, 0.06, 0.3], [hw + 0.55, 0.07, 0.7], [hw + 0.95, 0.0, 1]];
    return side > 0 ? cols : cols.map(([d, dy, u]) => [-d, dy, 1 - u]).reverse();
  };
  for (let i = 0; i <= track.n; i++) {
    const on = i < track.n && sharp(i) && !inGaps(noRoad, track.s[i]);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const from = Math.max(0, start - 8);
      const to = Math.min(track.n, i + 8);
      for (const side of [1, -1]) kerbGeos.push(fixUpNormals(ribbon(track, kerbProfile(side), { from, to, vScale: 2, lift: 0.015 })));
      start = -1;
    }
  }
  if (kerbGeos.length) {
    const kerbs = new THREE.Mesh(
      mergeGeometries(kerbGeos),
      wettable(new THREE.MeshStandardMaterial({ map: stripeTexture('#c8102e', '#f2f2ee'), roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }), wet, { darken: 0.3, key: 'kerb' })
    );
    kerbs.receiveShadow = true;
    group.add(kerbs);
  }

  const hardware = createVertexPbrMaterial({ envMapIntensity: 0.9 });
  const trackside = urban ? [] : [...buildGuardrails(track)];
  if (!urban && track.def.lampPosts !== false) trackside.push(buildLampPosts(track));
  const start0 = buildStartLine(track);
  trackside.push(start0.steel);
  const side = new THREE.Mesh(mergePainted(trackside), hardware);
  side.name = 'trackside';
  // A whole lap of rail never culls against the shadow camera, so it only receives shadows.
  side.castShadow = false;
  side.receiveShadow = true;
  group.add(side);
  group.add(...start0.meshes);
  group.add(buildDirectional(track));
  return group;
}

// Direction-dependent furniture, rebuilt for a reversed track: chevrons face oncoming traffic
// and ramps rise in the direction of travel. The track group holds the forward set under the
// name 'directional'; the race swaps in a reversed set for reverse routes.
export function buildDirectional(track) {
  const group = new THREE.Group();
  group.name = 'directional';
  group.add(buildChevrons(track), buildRamps(track));
  return group;
}

// Rubbered-in racing line: dark tyre rubber along the classic outside-inside-outside line.
// The lateral offset is a "Mexican hat" filter of the track curvature: inside at the apex
// (narrow lobe) and outside on entry and exit (wide negative lobe).
function buildRacingLine(track, skip, wet) {
  const n = track.n;
  const hw = track.halfWidth;
  const blur = (src, sigmaM) => {
    const r = Math.ceil((sigmaM * 2.5) / track.spacing);
    const w = [];
    let sum = 0;
    for (let k = -r; k <= r; k++) {
      const v = Math.exp(-0.5 * ((k * track.spacing) / sigmaM) ** 2);
      w.push(v);
      sum += v;
    }
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[(i + k + n) % n] * w[k + r];
      out[i] = acc / sum;
    }
    return out;
  };
  const narrow = blur(track.curv, 14);
  const wide = blur(track.curv, 46);
  const reach = hw - 2.4;
  const offset = new Float32Array(n);
  for (let i = 0; i < n; i++) offset[i] = reach * Math.tanh((narrow[i] * 1.6 - wide[i] * 1.0) * 140);
  const line = blur(offset, 8);

  const pos = [];
  const uv = [];
  const index = [];
  const f = {};
  const halfW = 0.95;
  for (let k = 0; k <= n; k++) {
    const i = k % n;
    const s = k === n ? track.length : track.s[i];
    track.frame(s, f);
    const d = line[i];
    for (const [dd, u] of [[-halfW, 0], [halfW, 1]]) {
      pos.push(f.x + f.rx * (d + dd), f.y + 0.012, f.z + f.rz * (d + dd));
      uv.push(u, s / 6);
    }
    if (k < n && !inGaps(skip, s) && !inGaps(skip, k + 1 >= n ? track.length : track.s[k + 1])) {
      const a = k * 2;
      index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  fixUpNormals(geo);
  const tex = canvasTexture(THREE, 64, 128, (g, w, h) => {
    const rand = mulberry32(3);
    g.clearRect(0, 0, w, h);
    for (let x = 0; x < w; x++) {
      const k = Math.exp(-(((x / w - 0.5) / 0.28) ** 2));
      for (let y = 0; y < h; y++) {
        const a = k * (0.55 + rand() * 0.45);
        g.fillStyle = `rgba(8,8,9,${a.toFixed(3)})`;
        g.fillRect(x, y, 1, 1);
      }
    }
  });
  tex.wrapT = THREE.RepeatWrapping;
  const mesh = new THREE.Mesh(
    geo,
    wettable(new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      roughness: 0.7,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }), wet, { darken: 0.2, key: 'line' })
  );
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.name = 'racing-line';
  return mesh;
}

// Galvanised W-beam guardrails on both sides, on posts every 4 m. Returns painted geometries.
function buildGuardrails(track) {
  const steel = { color: 0xaab1b8, roughness: 0.38, metalness: 0.85 };
  const post = { color: 0x6b7178, roughness: 0.6, metalness: 0.7 };
  // W-beam cross-section: (outward offset from the road-side face, height above the road).
  const profile = [[0, 0.44], [0.07, 0.5], [0.025, 0.6], [0.07, 0.7], [0, 0.77]];
  const out = [];
  for (const side of [1, -1]) {
    const cols = profile.map(([o, y], k) => [side * (track.fenceOffset + o), y - 0.15, k / (profile.length - 1)]);
    for (const [from, to] of spans(track, gaps(track, side))) {
      const rail = ribbon(track, cols, { vScale: 4, from, to });
      for (const g of bothFaces(rail)) out.push(paintVertices(g, steel));
    }
  }
  const postGeo = paintVertices(new THREE.BoxGeometry(0.12, 0.95, 0.16).translate(0, 0.32, 0).toNonIndexed(), post);
  const matrices = [];
  const spacing = 4;
  const count = Math.floor(track.length / spacing);
  const a = new THREE.Vector3();
  const f = {};
  for (const side of [1, -1]) {
    const skip = gaps(track, side);
    for (let k = 0; k < count; k++) {
      const s = k * spacing;
      if (inGaps(skip, s)) continue;
      track.frame(s, f);
      const d = side * (track.fenceOffset + 0.12);
      a.set(f.x + f.rx * d, track.roadY(s) - 0.15, f.z + f.rz * d);
      matrices.push(new THREE.Matrix4().makeRotationY(Math.atan2(-f.tz, f.tx)).setPosition(a));
    }
  }
  out.push(stamp(postGeo, matrices));
  return out;
}

// Coastal highway street lights: a pole with an arm over the road every 70 m, alternating sides.
function buildLampPosts(track) {
  const metal = { color: 0x50555c, roughness: 0.45, metalness: 0.8 };
  const parts = [];
  const pole = new THREE.CylinderGeometry(0.09, 0.13, 8.6, 8).translate(0, 4.3, 0);
  parts.push(paintVertices(pole.toNonIndexed(), metal));
  const arm = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6).rotateZ(Math.PI / 2).translate(-1.2, 8.45, 0);
  parts.push(paintVertices(arm.toNonIndexed(), metal));
  const head = new THREE.BoxGeometry(0.75, 0.16, 0.32).translate(-2.45, 8.4, 0);
  parts.push(paintVertices(head.toNonIndexed(), { color: 0x2c3036, roughness: 0.4, metalness: 0.6 }));
  const lens = new THREE.BoxGeometry(0.6, 0.03, 0.24).translate(-2.45, 8.31, 0);
  parts.push(paintVertices(lens.toNonIndexed(), { color: 0xfff1d0, roughness: 0.2, metalness: 0, emissive: 0.35 }));
  const base = new THREE.CylinderGeometry(0.22, 0.26, 0.5, 8).translate(0, 0.25, 0);
  parts.push(paintVertices(base.toNonIndexed(), { color: 0x8a8d90, roughness: 0.9, metalness: 0 }));
  const lamp = mergePainted(parts);

  const matrices = [];
  const f = {};
  const spacing = 70;
  const count = Math.floor(track.length / spacing);
  for (let k = 0; k < count; k++) {
    const s = k * spacing + 20;
    const side = k % 2 ? 1 : -1;
    if (inGaps(gaps(track, side), s)) continue;
    track.frame(s, f);
    const d = side * (track.fenceOffset + 0.9);
    // Local -x (the arm) points across the road, toward the centre line.
    const yaw = Math.atan2(-side * f.rz, side * f.rx);
    matrices.push(new THREE.Matrix4().makeRotationY(yaw).setPosition(f.x + f.rx * d, track.roadY(s) - 0.15, f.z + f.rz * d));
  }
  return stamp(lamp, matrices);
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
    if (inGaps(gaps(track, -Math.sign(k)), track.s[i])) continue;
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

// All jump ramps in one mesh: hazard-striped tops and steel sides (2 draw calls in total).
function buildRamps(track) {
  const top = new THREE.MeshStandardMaterial({ map: rampTexture(), roughness: 0.6, metalness: 0.1 });
  const side = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.7, metalness: 0.4 });
  const a = new THREE.Vector3();
  const tops = { pos: [], uv: [] };
  const sides = { pos: [], uv: [] };
  const quad = (out, p0, p1, p2, p3, uvs) => {
    out.pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    out.uv.push(...uvs[0], ...uvs[1], ...uvs[2], ...uvs[0], ...uvs[2], ...uvs[3]);
  };
  const zero = [[0, 0], [0, 0], [0, 0], [0, 0]];
  for (const r of track.ramps) {
    const steps = Math.ceil(r.length);
    const pt = (ds, d, onTop) => {
      const s = r.s0 + ds;
      track.point(s, d, a);
      a.y = track.roadY(s) + (onTop ? (r.height * ds) / r.length : 0) + 0.015;
      return [a.x, a.y, a.z];
    };
    const width = r.to - r.from;
    for (let k = 0; k < steps; k++) {
      const s0 = (k / steps) * r.length;
      const s1 = ((k + 1) / steps) * r.length;
      quad(tops, pt(s0, r.from, true), pt(s0, r.to, true), pt(s1, r.to, true), pt(s1, r.from, true), [
        [0, s0 / 4], [width / 4, s0 / 4], [width / 4, s1 / 4], [0, s1 / 4],
      ]);
      quad(sides, pt(s0, r.from, false), pt(s1, r.from, false), pt(s1, r.from, true), pt(s0, r.from, true), zero);
      quad(sides, pt(s0, r.to, true), pt(s1, r.to, true), pt(s1, r.to, false), pt(s0, r.to, false), zero);
    }
    const L = r.length;
    quad(sides, pt(L, r.from, false), pt(L, r.to, false), pt(L, r.to, true), pt(L, r.from, true), zero);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...tops.pos, ...sides.pos], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([...tops.uv, ...sides.uv], 2));
  const nTop = tops.pos.length / 3;
  geo.addGroup(0, nTop, 0);
  geo.addGroup(nTop, sides.pos.length / 3, 1);
  geo.computeVertexNormals();
  top.side = side.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, [top, side]);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'ramps';
  return mesh;
}

// Chequered line on the road and the start gantry. The gantry steel is returned as painted
// geometry for the trackside batch; the line and the banner keep their textures.
function buildStartLine(track) {
  const meshes = [];
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
  meshes.push(line);

  // Gantry over the line; its local +x points along the track.
  track.frame(0, f);
  const y = track.roadY(0);
  const frame = new THREE.Matrix4().makeRotationY(Math.atan2(-f.tz, f.tx)).setPosition(f.x, y, f.z);
  const steel = { color: 0x2b2e35, roughness: 0.4, metalness: 0.8 };
  const span = (track.fenceOffset + 1) * 2;
  const parts = [];
  for (const side of [-1, 1]) parts.push(paintVertices(new THREE.BoxGeometry(0.7, 8.4, 0.7).translate(0, 4.2, (side * span) / 2).toNonIndexed(), steel));
  parts.push(paintVertices(new THREE.BoxGeometry(0.8, 1.9, span + 0.7).translate(0, 7.6, 0).toNonIndexed(), steel));
  const gantry = mergePainted(parts).applyMatrix4(frame);

  const banner = bannerTexture('APEX OVERDRIVE', (track.def.name ?? 'Emerald Coast').toUpperCase());
  const boards = [];
  for (const side of [-1, 1]) {
    const board = new THREE.PlaneGeometry(span, span / 8);
    board.rotateY((side * Math.PI) / 2);
    board.translate(side * 0.42, 7.6, 0);
    boards.push(board);
  }
  const boardMesh = new THREE.Mesh(mergeGeometries(boards).applyMatrix4(frame), new THREE.MeshBasicMaterial({ map: banner, toneMapped: false }));
  meshes.push(boardMesh);
  return { steel: gantry, meshes };
}
