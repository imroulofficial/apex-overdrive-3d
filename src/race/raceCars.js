import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyFinish, liveryPaint } from '../garage/carPaint.js';
import { FINISHES } from '../data/catalog.js';
import { createVertexPbrMaterial, describeMaterial, isFlatMaterial, mergePainted, paintVertices } from '../render/vertexPbr.js';

// Race-ready cars baked from a car rig (a track LOD of a real model, see modelLoader.js). A
// model has dozens of meshes; on track six of them would cost hundreds of draw calls. Here
// every untextured part (trim, carbon, chrome, lenses, liners...) is folded into one
// vertex-coloured "atlas" mesh, paint, glass, textured parts and the lights keep their own
// materials, and the wheels of every car from one factory are a single InstancedMesh. A rival
// costs ~4 draw calls; the player's textured car a few more.
//
// v75: a car's glass (clear and tinted, every pane) is one transparent vertex-colour mesh, its
// head and tail lenses one mesh with the lamp levels in uniforms, and the player's cabin
// (interior, driver: their texture's colour baked into the model's vertices, _BAKEDCOLOR) folds
// into the atlas. `lite` factories (the low tier: a low-end GPU on Graphics Auto) go further:
// rivals' paint joins the atlas, the player's car shows 512 px textures without normal maps,
// rims and tyres baked into the atlas, one cabin group and the uprights in the body.
//
// Grounding: car bodies receive the sun's shadow (dark under bridges, trees and overpasses
// like the road around them), every car sits on a soft contact shadow (ContactShadows, one
// instanced draw for the field) and head / tail lights follow the weather's light level. Only
// the player's car casts into the shadow map; rivals rely on their contact shadow.

const ATLAS = Symbol('atlas');
const WHEEL_CAPACITY = 16; // per side: up to 16 cars per factory
function sliceGroups(mesh) {
  const geo = mesh.geometry;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (!Array.isArray(mesh.material) || !geo.groups.length) return [{ geo, mat: mats[0] }];
  return geo.groups.map((g) => {
    const part = new THREE.BufferGeometry();
    for (const name of Object.keys(geo.attributes)) part.setAttribute(name, geo.attributes[name]);
    const src = geo.index.array;
    part.setIndex(Array.from(src.subarray(g.start, g.start + g.count)));
    return { geo: part, mat: mats[g.materialIndex] };
  });
}

// Plain float copy of an attribute. Meshopt-compressed models arrive quantized (normalized
// int16 positions, int8 normals); transforming those in place clamps every vertex to the
// [-1, 1] range of the integer type and shreds the mesh.
function toFloat(attr) {
  const k = attr.itemSize;
  const out = new Float32Array(attr.count * k);
  const get = ['getX', 'getY', 'getZ', 'getW'];
  for (let i = 0; i < attr.count; i++) for (let c = 0; c < k; c++) out[i * k + c] = attr[get[c]](i);
  return new THREE.BufferAttribute(out, k);
}

function normalize(geo, matrix) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'uv', 'color', '_bakedpbr'].includes(name)) g.deleteAttribute(name);
    else if (!(g.attributes[name].array instanceof Float32Array) || g.attributes[name].normalized || g.attributes[name].isInterleavedBufferAttribute) g.setAttribute(name, toFloat(g.attributes[name]));
  }
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  g.applyMatrix4(matrix);
  return g;
}

// paintVertices() for a part that may carry baked vertex colours (generated models' rival
// LOD): the material's flat colour multiplies them instead of replacing them.
function paintBaked(g, description) {
  const baked = g.attributes.color;
  paintVertices(g, description);
  if (!baked) return g;
  const col = g.attributes.color;
  for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * baked.getX(i), col.getY(i) * baked.getY(i), col.getZ(i) * baked.getZ(i));
  return g;
}

// Collect meshes under `root` (excluding `skip` subtrees) into one merged mesh per material.
// Parts mapped to ATLAS are painted into vertex attributes and merged under `atlasMaterial`,
// GLASS into `glassMaterial` (vertex colour with alpha) and LAMP into `lampMaterial`.
// `skip(p)` is asked for each ancestor of a mesh up to `root`: true leaves the mesh out, KEEP
// takes it whatever its further ancestors say. `materialMap(mat, geo)` sees the part's geometry
// (a baked colour lets a textured part join the atlas); `describe(mat)` paints atlas parts.
const KEEP = 'keep';
const GLASS = Symbol('glass');
const LAMP = Symbol('lamp');
function bake(root, relativeTo, skip = () => false, materialMap = (m) => m, atlas = {}, describe = describeMaterial) {
  const { atlasMaterial = null, glassMaterial = null, lampMaterial = null } = atlas;
  const buckets = new Map();
  const inv = new THREE.Matrix4().copy(relativeTo.matrixWorld).invert();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || o.name === 'beam') return;
    for (let p = o; p && p !== root; p = p.parent) {
      const k = skip(p);
      if (k === KEEP) break;
      if (k) return;
    }
    m.multiplyMatrices(inv, o.matrixWorld);
    for (const { geo, mat } of sliceGroups(o)) {
      const target = materialMap(mat, geo);
      if (!target) continue;
      const key = target === ATLAS ? atlasMaterial : target === GLASS ? glassMaterial : target === LAMP ? lampMaterial : target;
      if (!buckets.has(key)) buckets.set(key, []);
      const list = buckets.get(key);
      if (target === ATLAS || target === GLASS || target === LAMP) {
        const g = normalize(withBakedColor(geo, target === ATLAS), m);
        if (target === ATLAS) bakedPbr(paintBaked(g, describe(mat)));
        else if (target === GLASS) paintGlass(g, mat);
        else paintLamp(g, mat);
        // The atlas, glass and lamp materials draw both faces (DoubleSide): a double-sided part
        // needs no mirrored copy of its triangles.
        list.push(g);
      } else {
        const g = normalize(geo, m);
        g.deleteAttribute('_bakedpbr');
        list.push(g);
      }
    }
  });
  return [...buckets].map(([mat, geos]) => {
    const painted = mat === atlasMaterial || mat === glassMaterial;
    const geo = mat === lampMaterial ? mergePainted(geos, ['lamp']) : painted ? mergePainted(geos) : mergeGeometries(geos);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
  });
}

// A part's texture colour baked into its vertices (tools/cars/lowLods.mjs, sRGB bytes) as its
// linear vertex colour, for the atlas; without one (or not for the atlas) the part as it is.
function withBakedColor(geo, use) {
  const baked = geo.attributes._bakedcolor;
  if (!baked) return geo;
  const g = geo.clone();
  g.deleteAttribute('_bakedcolor');
  if (!use) {
    g.deleteAttribute('_bakedpbr');
    return g;
  }
  const col = new Float32Array(baked.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < baked.count; i++) {
    c.setRGB(baked.getX(i), baked.getY(i), baked.getZ(i), THREE.SRGBColorSpace);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// The roughness and metalness baked with the colour (_BAKEDPBR), over the material's own.
function bakedPbr(g) {
  const b = g.attributes._bakedpbr;
  if (!b) return g;
  const pbr = g.attributes.pbr;
  for (let i = 0; i < pbr.count; i++) pbr.setXY(i, b.getX(i), b.getY(i));
  g.deleteAttribute('_bakedpbr');
  return g;
}

// Glass, clear or tinted, as vertex colour with its opacity in alpha (one transparent mesh).
function paintGlass(g, mat) {
  paintVertices(g, describeMaterial(mat));
  const rgb = g.attributes.color;
  const col = new Float32Array(rgb.count * 4);
  const a = mat.opacity ?? 1;
  for (let i = 0; i < rgb.count; i++) col.set([rgb.getX(i), rgb.getY(i), rgb.getZ(i), a], i * 4);
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return g;
}

// A lamp lens: its colour, and its glow colour with 0 (head) or 1 (tail) in `lamp`.
function paintLamp(g, mat) {
  paintVertices(g, { ...describeMaterial(mat), emissive: 0 });
  const n = g.attributes.position.count;
  const e = mat.emissive ?? new THREE.Color(0);
  const flag = mat.userData.tailLight ? 1 : 0;
  const lamp = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) lamp.set([e.r, e.g, e.b, flag], i * 4);
  g.setAttribute('lamp', new THREE.BufferAttribute(lamp, 4));
  return g;
}

// Glass the race bakes into one transparent vertex-colour mesh: blended, untextured, not a mirror.
function isGlass(mat) {
  if (!mat?.transparent || mat.isShaderMaterial || mat.name === 'MirrorGlass') return false;
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'emissiveMap']) if (mat[k]) return false;
  return true;
}

// One car's lamp lenses (head and tail, one draw): glow levels in uniforms (CarVisual.update).
function createLampMaterial(side = THREE.DoubleSide) {
  const m = createVertexPbrMaterial({ envMapIntensity: 1.1, emissive: 0xffffff, side });
  const base = m.onBeforeCompile;
  const uniforms = { uHead: { value: 0 }, uTail: { value: 0.5 } };
  m.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 lamp;\nvarying vec4 vLamp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLamp = lamp;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHead;\nuniform float uTail;\nvarying vec4 vLamp;')
      .replace('totalEmissiveRadiance = diffuseColor.rgb * vPbr.z;', 'totalEmissiveRadiance = vLamp.rgb * mix(uHead, uTail, vLamp.a);');
  };
  m.customProgramCacheKey = () => 'vertex-pbr-lamp';
  m.name = 'Lamps';
  m.userData.lamps = uniforms;
  return m;
}

// The low tier's copy of a textured part (Body): colour at 512 px, no ORM or normal map.
const LITE_COLOR = 512;
const LITE_ROUGHNESS = 0.55;
const LITE_METALNESS = 0.25;
function smaller(tex, size, made) {
  const img = tex?.image;
  if (!img || typeof document === 'undefined' || !(img.width > size)) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(img, 0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  for (const k of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'channel', 'magFilter', 'minFilter', 'anisotropy']) t[k] = tex[k];
  t.name = `${tex.name}-lite`;
  made.push(t);
  return t;
}
function liteMaterial(src, made) {
  const m = src.clone();
  m.map = smaller(src.map, LITE_COLOR, made);
  m.side = THREE.FrontSide; // front faces only on the low tier (CarFactory)
  // Roughness and metalness as plain values (a trim-like satin) instead of the ORM map.
  if (m.roughnessMap || m.metalnessMap) {
    m.roughnessMap = m.metalnessMap = null;
    m.roughness = LITE_ROUGHNESS;
    m.metalness = LITE_METALNESS;
  }
  m.aoMap = null;
  m.normalMap = null;
  return m;
}

// Clear-coated paint for rivals: the showroom's flake normal map and iridescence are left
// out (they cost a texture fetch and a lobe each), the lacquer layer and env reflections stay.
// `livery` (the template paint's livery uniforms) keeps a generated model's baked vertex
// colours as shading under the rival's colour.
export function createRivalPaint(color, finish = 'gloss', livery = null) {
  const f = FINISHES[finish] ?? FINISHES.gloss;
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    metalness: f.metalness,
    roughness: Math.max(0.12, f.roughness),
    clearcoat: Math.max(0.6, f.clearcoat),
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.35,
    vertexColors: Boolean(livery),
  });
  if (livery) {
    liveryPaint(mat, { factoryLum: livery.uFactoryLum.value, source: 'vertex' });
    mat.userData.livery.uFactory.value = f.factory ? 1 : 0;
  }
  return mat;
}

function flameTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  // Bright at the nozzle (bottom of the canvas = cone base), fading toward the tip.
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

// Where the car touches the road, measured on its model (car space: nose +X, right +Z, tyres
// on y = 0): the four tyre contact patches, plus points under the nose, the tail and the
// floor with their ground clearance. CarVisual casts a ray down from each of them every frame.
function measureChassis(template, wheelsSrc, box) {
  const xs = wheelsSrc.map((w) => w.position.x);
  const mid = (Math.max(...xs) + Math.min(...xs)) / 2;
  const front = wheelsSrc.filter((w) => w.position.x > mid);
  const rear = wheelsSrc.filter((w) => w.position.x <= mid);
  const avg = (list, f) => list.reduce((n, w) => n + f(w), 0) / Math.max(1, list.length);
  const frontX = front.length ? avg(front, (w) => w.position.x) : 1.3;
  const rearX = rear.length ? avg(rear, (w) => w.position.x) : -1.3;
  const halfTrack = wheelsSrc.length ? avg(wheelsSrc, (w) => Math.abs(w.position.z)) : 0.8;
  const length = box.max.x - box.min.x;
  // Lowest bodywork in three zones: nose overhang, tail overhang and the floor between axles.
  const low = { nose: Infinity, tail: Infinity, floor: Infinity };
  const v = new THREE.Vector3();
  template.group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(template.group.matrixWorld).invert();
  const m = new THREE.Matrix4();
  template.group.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (wheelsSrc.includes(p)) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (v.x > box.max.x - length * 0.12) low.nose = Math.min(low.nose, v.y);
      else if (v.x < box.min.x + length * 0.12) low.tail = Math.min(low.tail, v.y);
      else if (v.x > rearX + 0.3 && v.x < frontX - 0.3 && Math.abs(v.z) < halfTrack * 0.7) low.floor = Math.min(low.floor, v.y);
    }
  });
  const clear = (y, fallback) => (Number.isFinite(y) ? Math.max(0.02, y) : fallback);
  const nose = clear(low.nose, 0.15);
  const tail = clear(low.tail, 0.18);
  const floor = clear(low.floor, 0.12);
  const noseX = box.max.x - 0.05;
  const tailX = box.min.x + 0.05;
  const corner = halfTrack * 0.8;
  return {
    front: frontX,
    rear: rearX,
    halfTrack,
    length,
    width: box.max.z - box.min.z,
    // { a: metres ahead of the centre, l: metres to the right, c: clearance above the road }
    // The first four are the wheels (FL, FR, RL, RR) in that order.
    points: [
      { a: frontX, l: -halfTrack, c: 0 },
      { a: frontX, l: halfTrack, c: 0 },
      { a: rearX, l: -halfTrack, c: 0 },
      { a: rearX, l: halfTrack, c: 0 },
      { a: noseX, l: -corner, c: nose },
      { a: noseX, l: corner, c: nose },
      { a: tailX, l: -corner, c: tail },
      { a: tailX, l: corner, c: tail },
      { a: (frontX + rearX) / 2, l: 0, c: floor },
    ],
  };
}

// Under a wheel's `still` group (upright, disc, caliper: modelLoader.js)?
function inStill(o, wheel) {
  for (let p = o; p && p !== wheel; p = p.parent) if (p.userData.still) return true;
  return false;
}

// Driver-view parts of the player's car (Blender models, extras.apex.hideInCockpit): baked
// apart from the body so the cockpit view can hide them, the door windows so they can slide
// down and the steering wheel so it can turn.
export const DEFAULT_HIDE_IN_COCKPIT = ['interior', 'driver', 'steering_wheel', 'glass', 'window_L', 'window_R'];
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q0 = new THREE.Quaternion();
const _pv = new THREE.Vector3();
const _po = new THREE.Vector3();
const _sv = new THREE.Vector3(1, 1, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);

// A door window's pose at `k` (0 closed .. 1 open) from extras.apex.windows[name]
// ({ closed, open }: position and quaternion of the node in the car frame), as a matrix in that
// frame.
export function windowPose(pose, k, out = new THREE.Matrix4()) {
  const c = pose.closed ?? { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  const o = pose.open;
  _pv.fromArray(c.position).lerp(_po.fromArray(o.position), k);
  _q0.fromArray(c.quaternion);
  _q.fromArray(o.quaternion);
  _q0.slerp(_q, k);
  return out.compose(_pv, _q0, _sv);
}

// Driver view of a car with its own cabin: the player's car is drawn in front of everything
// else, like the cabin (race/cockpit.js DEPTH_FRONT), so a rival that touches or overlaps it
// never shows through the bonnet, the sidepods or the doors. A uniform switches it (no
// recompile when the view changes); the materials get it once, before the warm-up. One switch
// for the one player car (cached template materials keep it from race to race).
export const PLAYER_FRONT = { value: 0 };
export const FRONT_DRAW = 'gl_Position.z = mix(gl_Position.z, mix(-gl_Position.w, gl_Position.z, 0.1), uFront);';
// Every car material from a factory gets it (rivals with a switch that stays 0), so a rival's
// and the player's atlas, glass and lamps share one program each; frontDraw() again with
// PLAYER_FRONT (before the first compile) hands a material to the player's switch.
export function frontDraw(material, uniform = PLAYER_FRONT) {
  if (!material) return;
  material.userData.uFront = uniform;
  if (material.userData.frontDraw) return;
  material.userData.frontDraw = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.uFront = material.userData.uFront;
    shader.vertexShader = `uniform float uFront;\n${shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n  ${FRONT_DRAW}`)}`;
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|front`;
  material.needsUpdate = true;
}

export class CarFactory {
  // `template` is a car rig from loadCar(); the factory never mutates it.
  // `lite`: the low tier (see the top of this file).
  constructor(template, { lite = false } = {}) {
    this.template = template;
    this.lite = lite;
    this.made = []; // the lite textures this factory made
    template.group.updateMatrixWorld(true);
    this.paint = template.paintMaterial;
    this.flameTex = flameTexture();
    // Both faces (the models' parts are double-sided): half the vertices of a mirrored copy.
    // The low tier (lite) draws front faces only: the parts are closed shells (no open edges in
    // the Blender files), and both faces cost a second raster of every car pixel there.
    const side = lite ? THREE.FrontSide : THREE.DoubleSide;
    this.atlas = createVertexPbrMaterial({ envMapIntensity: 1.1, side });
    // The same shading for the instanced wheels, as its own material: one material drawn both
    // instanced and not makes three.js rebuild its program parameters at every switch, twice
    // a frame per car (garbage the collector then has to clear mid-race).
    this.wheelAtlas = createVertexPbrMaterial({ envMapIntensity: 1.1, side });
    // Every car's glass from this factory: blended vertex colour, its alpha per pane.
    this.glass = createVertexPbrMaterial({ envMapIntensity: 1.1, transparent: true, depthWrite: false, side, forceSinglePass: true });
    this.glass.name = 'Glass';
    this.liteMats = new Map(); // template material -> its lite copy (player, low tier)
    // The driver-view switch of this factory's shared materials: off for rivals' factories,
    // PLAYER_FRONT once frontDrawPlayer() claims the factory for the player.
    this.front = { value: 0 };
    for (const m of [this.atlas, this.wheelAtlas, this.glass]) frontDraw(m, this.front);
    if (lite) this.litePaint();
    // Length and width of the car on the ground, for its contact shadow.
    const box = new THREE.Box3().setFromObject(template.group, true);
    const size = box.getSize(new THREE.Vector3());
    this.footprint = { length: size.x, width: size.z };
    // Left and right wheels are mirror images, so each side gets its own batch.
    const wheelsSrc = template.group.children.filter((c) => c.isGroup && c.userData.wheelIndex !== undefined);
    this.chassis = measureChassis(template, wheelsSrc, box);
    this.wheelBatches = [];
    for (const side of [1, -1]) {
      const src = wheelsSrc.find((w) => Math.sign(w.position.z || 1) === side);
      const mesh = src && this.createWheelBatch(src);
      if (mesh) this.wheelBatches.push({ side, mesh, slots: [] });
    }
    // Instancing only when both sides batch; otherwise every wheel stays a per-car mesh.
    if (this.wheelBatches.length !== 2) this.wheelBatches = [];
  }

  // Meshes the race adds to its scene once (shared by every car from this factory).
  get sharedMeshes() {
    return this.wheelBatches.map((b) => b.mesh);
  }

  // Frees what the factory made (wheel batches, atlas, flame texture); the template belongs
  // to the model loader's cache.
  dispose() {
    for (const { mesh } of this.wheelBatches) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.atlas.dispose();
    this.wheelAtlas.dispose();
    this.glass.dispose();
    for (const m of this.liteMats.values()) m.dispose();
    for (const t of this.made) t.dispose();
    this.flameTex.dispose();
  }

  // The player's car (and this factory's wheel batches) drawn in front in the driver view
  // (switched by PLAYER_FRONT).
  frontDrawPlayer(visual) {
    this.front = PLAYER_FRONT;
    for (const m of [this.atlas, this.wheelAtlas, this.glass]) frontDraw(m);
    for (const root of [visual.root, ...this.sharedMeshes]) {
      root.traverse((o) => {
        if (o.isMesh) for (const m of [].concat(o.material)) frontDraw(m);
      });
    }
    for (const g of visual.mirrorGlass ?? []) frontDraw(g.own);
    if (this.lite) this.cockpitTwins(visual);
  }

  // Low tier, driver view: the player's own body round the cabin (bonnet, wings, pillars) in
  // Lambert twins of its materials instead of the physically based ones, which cost about a
  // third of the frame there (the bonnet fills the windscreen). Same colours and maps; the lamps
  // keep theirs. CarVisual.setCockpitLook() swaps them in and out; the race's warm-up compiles both.
  cockpitTwins(visual) {
    const twins = new Map();
    const twin = (m) => {
      if (!twins.has(m)) {
        const t = new THREE.MeshLambertMaterial({ name: `${m.name}-cockpit`, color: m.color, map: m.map ?? null, vertexColors: m.vertexColors, side: m.side });
        frontDraw(t);
        twins.set(m, t);
      }
      return twins.get(m);
    };
    visual.twins = [];
    visual.root.traverse((o) => {
      if (!o.isMesh || Array.isArray(o.material)) return;
      const m = o.material;
      if (m.transparent || m.userData.lamps || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) return;
      visual.twins.push({ mesh: o, full: m, twin: twin(m) });
    });
    visual.owned = [...(visual.owned ?? []), ...twins.values()];
  }

  setPlayerPaint(color, finish) {
    applyFinish(this.paint, color, finish);
    if (this.lite) this.litePaint();
  }

  // Lite: the player's paint keeps its colour, finish, livery and env reflections, without the
  // flake normal map, clear coat or iridescence (the extra lobes cost a low-end GPU the most).
  litePaint() {
    const p = this.paint;
    p.normalMap = null;
    p.clearcoat = 0;
    p.side = THREE.FrontSide;
    p.iridescence = 0;
    p.needsUpdate = true;
  }

  // One InstancedMesh for every wheel on one side of the cars this factory builds (tyre, rim
  // and disc merged with vertex PBR). Returns null when the wheel uses textures.
  createWheelBatch(src) {
    const geos = [];
    let flat = true;
    src.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
    const m = new THREE.Matrix4();
    src.traverse((o) => {
      if (!o.isMesh || o.name === 'caliper' || inStill(o, src)) return;
      m.multiplyMatrices(inv, o.matrixWorld);
      for (const { geo, mat } of sliceGroups(o)) {
        if (!isFlatMaterial(mat)) flat = false;
        const g = normalize(geo, m);
        paintBaked(g, describeMaterial(mat));
        geos.push(g);
      }
    });
    if (!flat || !geos.length) return null;
    const mesh = new THREE.InstancedMesh(mergePainted(geos), this.wheelAtlas, WHEEL_CAPACITY);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    // Wheels move with the cars; the batch bounds would have to be rebuilt every frame.
    mesh.frustumCulled = false;
    mesh.name = 'wheels';
    return mesh;
  }

  // Copies every wheel's world transform into the batch. Call once per frame after the cars move.
  syncWheels() {
    for (const { mesh, slots } of this.wheelBatches) {
      for (let i = 0; i < slots.length; i++) {
        slots[i].updateWorldMatrix(true, false);
        mesh.setMatrixAt(i, slots[i].matrixWorld);
      }
      mesh.count = slots.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // Which chassis ray (index into chassis.points) sits under a template wheel.
  wheelPoint(src) {
    const { front, rear } = this.chassis;
    const isFront = Math.abs(src.position.x - front) < Math.abs(src.position.x - rear);
    return (isFront ? 0 : 2) + (src.position.z > 0 ? 1 : 0);
  }

  // Drops a car's wheels from the batches (its visual is being thrown away).
  release(visual) {
    for (const b of this.wheelBatches) b.slots = b.slots.filter((s) => !visual.wheels.some((w) => w.spin === s));
  }

  // Builds a car; the player keeps the garage clear-coat paint, rivals get a lighter clear-coat.
  // `castShadow: false` leaves the car out of the sun's shadow map (its contact shadow stays).
  build({ color, finish = 'gloss', player = false, castShadow = true }) {
    const t = this.template.group;
    const lite = this.lite;
    const own = new Map();
    // Lite rivals: the paint joins the atlas (no clear coat), so the whole car is one opaque draw.
    const paint = player ? this.paint : createRivalPaint(color, finish, this.paint.userData.livery);
    const paintInAtlas = lite && !player;
    const lamps = createLampMaterial(this.atlas.side);
    frontDraw(lamps, this.front);
    const atlas = { atlasMaterial: this.atlas, glassMaterial: this.glass, lampMaterial: lamps };
    const describe = (m) => (m === this.paint ? describeMaterial(paint) : describeMaterial(m));
    // `baked`: this part may use its baked texture colour (cabin parts; lite rims and tyres).
    // `wheel`: a lite player's wheel part (painted rims join its atlas mesh).
    const mapFor = (baked, wheel = false) => (mat, geo) => {
      if (mat === this.paint) return paintInAtlas || wheel ? ATLAS : paint;
      if (mat.name === 'skip') return null;
      // Head and tail lenses: one mesh per car so its brake lights glow on their own; the
      // player's mirror glass stays apart so the driver view can show the live rear view in it.
      if (mat.userData.tailLight || mat.userData.headLight) return LAMP;
      // (Lite: no live mirror on the low tier, so it joins the atlas.)
      if (player && !lite && mat.name === 'MirrorGlass') {
        if (!own.has(mat)) own.set(mat, mat.clone());
        return own.get(mat);
      }
      if (isGlass(mat)) return GLASS;
      if (isFlatMaterial(mat) || (baked && geo?.attributes._bakedcolor)) return ATLAS;
      if (lite && player && !mat.transparent) {
        if (!this.liteMats.has(mat)) this.liteMats.set(mat, liteMaterial(mat, this.made));
        return this.liteMats.get(mat);
      }
      return mat;
    };
    // Parts with a baked colour (cabin and dash: tools/cars/lowLods.mjs) join the atlas; rims and
    // tyres only on lite cars.
    const materialMap = mapFor(true);
    const wheelsSrc = t.children.filter((c) => c.isGroup && c.userData.wheelIndex !== undefined);
    const isWheel = (o) => wheelsSrc.includes(o);
    // The player's driver-view parts (see DEFAULT_HIDE_IN_COCKPIT) come out of the body bake.
    const meta = this.template.meta;
    const cabinNames = player && meta ? new Set(meta.hideInCockpit ?? DEFAULT_HIDE_IN_COCKPIT) : new Set();
    const cabinNodes = [];
    if (cabinNames.size) t.traverse((o) => cabinNames.has(o.name) && !cabinNodes.some((n) => isAncestor(n, o)) && cabinNodes.push(o));
    const isCabin = (o) => cabinNodes.includes(o);
    // Rivals (and the lite player) keep the uprights, discs and calipers in the body (one draw,
    // no steering); the player's steer with the front wheels.
    const stillInBody = !player || lite;
    const bodySkip = (p) => (stillInBody && p.userData.still ? KEEP : isWheel(p) || isCabin(p));

    const root = new THREE.Group(); // position + yaw + pitch + road roll (suspension)
    // Body lean (cornering roll, squat) pivots at axle height, so the sills never swing
    // down into the road; the wheels stay on the root and follow the ground themselves.
    const pivot = this.template.wheelRadius;
    const lean = new THREE.Group();
    lean.position.y = pivot;
    const body = new THREE.Group();
    body.position.y = -pivot;
    lean.add(body);
    root.add(lean);
    bake(t, t, bodySkip, materialMap, atlas, describe).forEach((mesh) => {
      // One shadow caster per car keeps the shadow pass cheap; the paint shell is the silhouette.
      mesh.castShadow = castShadow && (mesh.material === paint || (paintInAtlas && mesh.material === this.atlas));
      // Every opaque part takes the sun's shadow so the car darkens with the road around it.
      mesh.receiveShadow = !mesh.material.transparent;
      body.add(mesh);
    });
    // Cabin parts under the body. The door windows and the steering wheel move, through a
    // matrix in the rig frame (model frame pose, conjugated by the model matrix), so each is a
    // group of its own; every other cabin part (interior, driver, glass) bakes into one group.
    // Lite: the steering wheel and the door windows join them (no turning wheel; the windows
    // only open in the driver view, where the cockpit model draws its own).
    const cabin = new THREE.Group();
    cabin.name = 'cabin';
    body.add(cabin);
    const windows = [];
    let steer = null;
    const M = this.template.modelMatrix ?? new THREE.Matrix4();
    const Minv = new THREE.Matrix4().copy(M).invert();
    const moving = lite ? [] : cabinNodes.filter((n) => meta?.windows?.[n.name]?.open || n.name === 'steering_wheel');
    const resting = cabinNodes.filter((n) => !moving.includes(n));
    const addCabin = (name, meshes) => {
      const group = new THREE.Group();
      group.name = `cabin-${name}`;
      for (const mesh of meshes) {
        mesh.castShadow = false;
        mesh.receiveShadow = !mesh.material.transparent;
        group.add(mesh);
      }
      cabin.add(group);
      return group;
    };
    if (resting.length) addCabin('parts', bake(t, t, (p) => (resting.includes(p) ? KEEP : p.parent === t), materialMap, atlas, describe));
    for (const node of moving) {
      const group = addCabin(node.name, bake(node, t, () => false, materialMap, atlas, describe));
      const pose = meta?.windows?.[node.name];
      if (pose?.open) {
        group.matrixAutoUpdate = false;
        windows.push({ group, pose, M, Minv });
      } else {
        // Turns about its own local x (the column).
        const S = new THREE.Matrix4().copy(t.matrixWorld).invert().multiply(node.matrixWorld);
        group.matrixAutoUpdate = false;
        steer = { group, S, Sinv: new THREE.Matrix4().copy(S).invert() };
      }
    }
    const mirrorGlass = [];
    body.traverse((o) => o.isMesh && o.material.name === 'MirrorGlass' && mirrorGlass.push({ mesh: o, own: o.material }));

    const wheelMap = mapFor(true, lite);
    const wheels = wheelsSrc.map((src, index) => {
      const wheel = new THREE.Group();
      wheel.position.copy(src.position);
      const spin = new THREE.Group();
      wheel.add(spin);
      const batch = this.wheelBatches.find((b) => b.side === Math.sign(src.position.z || 1));
      if (batch && batch.slots.length < WHEEL_CAPACITY) {
        batch.slots.push(spin);
      } else {
        // Textured wheels: everything except the caliper spins; rim and tyre (their baked
        // colours) in one atlas mesh.
        const merged = bake(src, src, (o) => o.name === 'caliper' || o.userData.still, wheelMap, atlas, describe);
        merged.forEach((mesh) => {
          mesh.castShadow = false;
          spin.add(mesh);
        });
      }
      // The player's upright, disc and caliper: on the wheel, steering, not spinning.
      const still = player && !lite && src.children.find((c) => c.userData.still);
      if (still) {
        bake(still, src, () => false, materialMap, atlas, describe).forEach((mesh) => {
          mesh.castShadow = false;
          wheel.add(mesh);
        });
      }
      root.add(wheel);
      const radius = this.template.wheels?.find((w) => w.wheel === src)?.radius ?? this.template.wheelRadius;
      return { wheel, spin, radius, front: index < 2, rest: src.position.y, point: this.wheelPoint(src) };
    });

    // Nitro flames at the exhausts.
    const flameMat = new THREE.MeshBasicMaterial({
      map: this.flameTex,
      color: 0x3aa8ff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const flameGeo = new THREE.ConeGeometry(0.11, 1.1, 10, 1, true);
    flameGeo.rotateZ(Math.PI / 2); // tip points backwards (-x)
    flameGeo.translate(-0.55, 0, 0); // base at the nozzle
    const flames = [];
    for (const at of this.template.exhausts) {
      const fl = new THREE.Mesh(flameGeo, flameMat);
      fl.position.copy(at);
      fl.visible = false;
      fl.renderOrder = 5;
      body.add(fl);
      flames.push(fl);
    }
    const visual = new CarVisual(root, lean, wheels, null, flames, flameMat, this.template.wheelRadius);
    let hasLamps = false;
    root.traverse((o) => o.isMesh && o.material === lamps && (hasLamps = true));
    visual.lamps = hasLamps ? lamps.userData.lamps : null;
    visual.cabin = cabin;
    visual.windows = windows;
    visual.steerPart = steer;
    visual.mirrorGlass = mirrorGlass;
    visual.footprint = this.footprint;
    visual.chassis = this.chassis;
    // Materials made for this car alone (the atlas, glass, wheels and template parts are shared).
    visual.owned = [...own.values(), lamps, flameMat, ...(player ? [] : [paint])];
    return visual;
  }

}

// Radians the model's steering wheel turns at full lock (as the cockpit's: race/cockpit.js).
const STEER_WHEEL_LOCK = 1.9;
const isAncestor = (a, o) => {
  for (let p = o.parent; p; p = p.parent) if (p === a) return true;
  return false;
};

const BLUE = new THREE.Color(0x3aa8ff);
const ORANGE = new THREE.Color(0xff7a1a);
const PURPLE = new THREE.Color(0xb44dff);

// Nitro flame brightness: above 1 the flames feed the bloom pass (race/Race.js sets it while
// bloom is on; without bloom they would only clip to white).
export const FLAME = { hdr: 1 };

// Head and tail lights on track: race/Race.js switches them on for dusk, night, fog, rain and
// snow (the weather's sun intensity), like every driver would.
export const LIGHTS = { on: false };

// Damped spring toward `target` (moving at `rate`) over step h, integrated implicitly so stiff
// settings stay stable at 30 FPS: returns the new velocity.
const spring = (h, x, vx, target, w, z, rate = 0) => (vx + h * (w * w * (target - x) + 2 * z * w * rate)) / (1 + h * 2 * z * w + h * h * w * w);

export class CarVisual {
  constructor(root, body, wheels, tail, flames, flameMat, wheelRadius) {
    this.root = root;
    this.wheelRadius = wheelRadius;
    this.body = body;
    this.wheels = wheels;
    this.tail = tail;
    this.flames = flames;
    this.flameMat = flameMat;
    this.lamps = null; // { uHead, uTail } of the car's lamp lenses (one mesh)
    this.head = null;
    this.roll = 0;
    this.squat = 0;
    this.nitroFx = null; // { color, pulse: [a, b] } colours, or null for the stock blue
    this.fxColors = null;
    this.steerVis = 0;
    this.lastForward = 0;
    root.rotation.order = 'YZX';
    // Suspension state (see suspend()): ride height, pitch and road roll with their rates.
    this.chassis = null;
    this.ride = { y: 0, vy: 0, pitch: 0, vPitch: 0, roll: 0, vRoll: 0, floor: 0, init: false };
    this.ground = new Float32Array(9);
  }

  // Frees this car's baked geometries and its own materials (call after release()).
  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => o.isMesh && o.geometry.dispose());
    for (const m of this.owned ?? []) m.dispose();
  }

  // Driver view: the car's own interior, driver, glass, door windows and steering wheel hide
  // (the cockpit model draws the cabin instead); the rest of the body stays.
  setCabinShown(on) {
    if (this.cabin) this.cabin.visible = on;
  }

  // The body's own mirror glass (wing mirrors of the player's car): the live rear view while
  // the driver view shows (`material`, race/carCockpit.js bodyMirrorMaterial), else its own
  // dark glass. Both materials are on the car from the warm-up on, so a switch compiles nothing.
  // Low tier: the cheap Lambert twins of the body's materials in the driver view (CarFactory.cockpitTwins).
  setCockpitLook(on) {
    for (const t of this.twins ?? []) {
      if (on) t.twin.color.copy(t.full.color);
      t.mesh.material = on ? t.twin : t.full;
    }
  }

  setMirror(material) {
    for (const g of this.mirrorGlass ?? []) g.mesh.material = material ?? g.own;
  }

  // Door windows 0 (closed) .. 1 (fully down), extras.apex.windows poses.
  setWindows(k) {
    for (const w of this.windows ?? []) w.group.matrix.multiplyMatrices(w.M, windowPose(w.pose, k, _m)).multiply(w.Minv);
  }

  // Nitro trail colour (FX_COLORS entry) for this car's flames; null keeps the stock blue.
  setNitroFx(fx) {
    this.fxColors = fx ? { blue: new THREE.Color(fx.color), a: new THREE.Color(fx.pulse[0]), b: new THREE.Color(fx.pulse[1]) } : null;
  }

  // Road contact. Rays from the chassis points (four tyre patches, nose, tail and floor; see
  // measureChassis) find the road; the body pitches and rolls to the plane of the tyres on
  // springs, then a hard floor lock lifts it until no tyre and no bodywork is below the road,
  // whatever the springs are doing. Over a crest or into a dip the car settles with damping
  // instead of snapping, and on a ramp lip or a sudden rise it is lifted that same frame, so
  // the chassis never cuts into the asphalt. Wheels drop to the road below them (up to the
  // suspension travel). Physics is unchanged: it still drives the car's centre on the road.
  suspend(v, dt) {
    const ch = this.chassis;
    const r = this.ride;
    const hs = this.ground;
    const pts = ch.points;
    for (let i = 0; i < pts.length; i++) hs[i] = v.visualGroundAt ? v.visualGroundAt(pts[i].a, pts[i].l) : v.groundAt(pts[i].a, pts[i].l);
    let pitch = v.pitch;
    let roll = 0;
    if (!v.airborne) {
      pitch = Math.atan2((hs[0] + hs[1] - hs[2] - hs[3]) / 2, ch.front - ch.rear);
      roll = Math.atan2((hs[0] + hs[2] - hs[1] - hs[3]) / 2, 2 * ch.halfTrack);
    }
    const snap = dt <= 0 || !r.init;
    const h = Math.min(dt, 1 / 20);
    if (snap) {
      r.pitch = pitch;
      r.roll = roll;
      r.vPitch = r.vRoll = 0;
    } else {
      r.vPitch = spring(h, r.pitch, r.vPitch, pitch, 22, 0.9);
      r.pitch += r.vPitch * h;
      r.vRoll = spring(h, r.roll, r.vRoll, roll, 22, 0.9);
      r.roll += r.vRoll * h;
    }
    // Floor lock: the lowest ride height at this pitch and roll that keeps every point on or
    // above its own ray hit (clearance included). The body's chassis plane is
    // y + a * sin(pitch) - l * sin(roll) at a point (a ahead, l right).
    const sp = Math.sin(r.pitch);
    const sr = Math.sin(r.roll);
    let floor = -Infinity;
    for (let i = 0; i < pts.length; i++) floor = Math.max(floor, hs[i] - pts[i].c - pts[i].a * sp + pts[i].l * sr);
    // Grounded, the car rests on that floor (following its rate, so a long downhill never
    // leaves it floating behind); in the air it follows the flight.
    const floorRate = snap ? 0 : THREE.MathUtils.clamp((floor - r.floor) / Math.max(dt, 1e-3), -25, 25);
    r.floor = floor;
    const target = v.airborne ? Math.max(v.pos.y, floor) : floor;
    const targetRate = v.airborne ? v.vy : floorRate;
    if (snap) {
      r.y = target;
      r.vy = targetRate;
      r.init = true;
    } else {
      r.vy = spring(h, r.y, r.vy, target, 30, 1, targetRate);
      r.y += r.vy * h;
    }
    if (r.y < floor) {
      r.y = floor;
      r.vy = Math.max(r.vy, floorRate);
    }
    // Each wheel reaches down to the road under it, within its travel.
    const travel = this.wheelRadius * 0.45;
    for (const w of this.wheels) {
      const p = pts[w.point];
      const gap = r.y + p.a * sp - p.l * sr - hs[w.point];
      w.wheel.position.y = w.rest - THREE.MathUtils.clamp(gap, 0, travel);
    }
    this.root.position.set(v.pos.x, r.y, v.pos.z);
    this.root.rotation.set(r.roll, v.heading, r.pitch);
  }

  update(v, dt, time) {
    if (this.chassis && v.groundAt) this.suspend(v, dt);
    else {
      this.root.position.copy(v.pos);
      this.root.rotation.set(0, v.heading, v.pitch);
    }

    // Body lean into the turn and squat under acceleration.
    const lat = v.airborne ? 0 : v.yawRate * Math.max(0, v.forward);
    const targetRoll = THREE.MathUtils.clamp(lat * 0.0028, -0.07, 0.07);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 6);
    const accel = (v.forward - this.lastForward) / Math.max(dt, 1e-3);
    this.lastForward = v.forward;
    this.squat += (THREE.MathUtils.clamp(accel * 0.0025, -0.04, 0.035) - this.squat) * Math.min(1, dt * 5);
    this.body.rotation.set(this.roll, 0, this.squat);

    const steerTarget = v.drifting ? -v.driftDir * 0.5 : this.steerInput ?? 0;
    this.steerVis += (steerTarget - this.steerVis) * Math.min(1, dt * 12);
    for (const w of this.wheels) {
      // Each axle rolls at its own rate (a bigger rear tyre turns slower).
      w.spin.rotation.z -= (v.forward / (w.radius || this.wheelRadius)) * dt;
      if (w.front) w.wheel.rotation.y = -this.steerVis * 0.45;
    }
    // The car's own steering wheel (seen through the glass in the follow views).
    const sp = this.steerPart;
    if (sp) {
      const a = (this.steerInput ?? 0) * STEER_WHEEL_LOCK;
      sp.group.matrix.multiplyMatrices(sp.S, _m.makeRotationAxis(X_AXIS, a)).multiply(sp.Sinv);
    }

    const tailLevel = v.braking ? 3.6 : LIGHTS.on ? 1.4 : 0.5;
    const headLevel = LIGHTS.on ? 2.6 : 0;
    if (this.lamps) {
      this.lamps.uTail.value = tailLevel;
      this.lamps.uHead.value = headLevel;
    }
    if (this.tail) this.tail.emissiveIntensity = tailLevel;
    if (this.head) this.head.emissiveIntensity = headLevel;

    const on = v.tier > 0;
    for (const fl of this.flames) {
      fl.visible = on;
      if (on) {
        const flicker = 0.75 + Math.sin(time * 70 + fl.position.z * 9) * 0.15 + Math.random() * 0.2;
        const len = v.tier === 2 ? 1.9 : 1.2;
        fl.scale.set(len * flicker, v.tier === 2 ? 1.5 : 1, v.tier === 2 ? 1.5 : 1);
      }
    }
    if (on) {
      const c = this.fxColors;
      if (v.tier === 2) this.flameMat.color.copy(c?.a ?? ORANGE).lerp(c?.b ?? PURPLE, 0.5 + 0.5 * Math.sin(time * 18));
      else this.flameMat.color.copy(c?.blue ?? BLUE);
      this.flameMat.color.multiplyScalar(FLAME.hdr);
    }
  }
}

// Soft contact shadows under every car: one InstancedMesh of dark, blurred ovals on the
// road (multiplied in, never lit), so cars sit on the asphalt instead of floating over it
// where the sun's shadow map is coarse or the car is in shade. Airborne cars shrink and
// fade their shadow with height.
function contactTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.78)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class ContactShadows {
  constructor(capacity = 16) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: contactTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.MultiplyBlending,
      premultipliedAlpha: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      toneMapped: false,
    });
    // Multiply blending reads the colour; turn the texture's alpha into "how dark".
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n\tgl_FragColor = vec4( vec3( 1.0 - gl_FragColor.a ), 1.0 );');
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    this.mesh.name = 'contact-shadows';
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler(0, 0, 0, 'YZX');
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
  }

  // `racers` carry { visual, vehicle }; the shadow lies on the road under each car.
  sync(racers) {
    let n = 0;
    for (const r of racers) {
      const v = r.vehicle;
      const fp = r.visual?.footprint;
      if (!v || !fp || n >= this.mesh.instanceMatrix.count) continue;
      const lift = Math.max(0, v.pos.y - (v.groundY ?? v.pos.y));
      const k = Math.max(0, 1 - lift / 4);
      if (k <= 0) continue;
      this.e.set(0, v.heading, v.pitch);
      this.q.setFromEuler(this.e);
      this.p.set(v.pos.x, v.pos.y - lift + 0.03, v.pos.z);
      this.s.set(fp.length * 1.12 * (0.6 + 0.4 * k), 1, fp.width * 1.25 * (0.6 + 0.4 * k));
      this.mesh.setMatrixAt(n++, this.m.compose(this.p, this.q, this.s));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
