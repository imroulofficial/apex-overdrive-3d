// Turns source car models (.glb, usually 20-90 MB Sketchfab or Blender exports) into the two
// files the game loads from public/assets/models/ (see the README there):
//
//   <id>.glb       garage / showroom: full detail up to `garageTris` (150k), WebP textures
//                  up to `textureSize` (2048 px); only meshes over budget are simplified,
//                  with a tight error bound so panels, grilles and lights keep their shape
//   <id>_drive.glb the player's own car on track: interior dropped, textured (1024 px),
//                  simplified to `driveTris` (40k)
//   <id>_race.glb  rival LOD: interior and small parts dropped, simplified to `raceTris`
//                  (< 10k), textures baked into flat colours so raceCars.js folds the whole
//                  car into its vertex-colour atlas and instances the wheels
//
// Both are normalised to the loader conventions (nose +X, roof +Y, wheel_FL/FR/RL/RR nodes,
// a "CarPaint" material) and meshopt-compressed, which three.js decodes offline in plain JS.
//
//   node tools/models/optimize.mjs <source dir>            # every entry in manifest.json
//   node tools/models/optimize.mjs <source dir> tm-tempesta  # only matching ids
//
// The source files are not kept in the repo; manifest.json records where each came from and
// its licence, and CREDITS.md in the output folder is regenerated from it.
//
// Per-car manifest options: `src`, `paint` (material names the game repaints), `headlights` /
// `taillights` (material names), `wheels` ({ FL: node name, ... }) or `wheelParts`
// ({ FL: [node names], ... } for models without wheel nodes), `drop` (regex of parts removed
// from every file: badges, plates, decals), `driveDrop` / `raceDrop` (parts removed from the
// track files), `garageTris` / `driveTris` / `raceTris`, `textureSize`, `raceSimplify`.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { clearNodeParent, compactPrimitive, dedup, getBounds, join, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.join(root, 'public/assets/models');
const manifest = JSON.parse(await fs.readFile(path.join(here, 'manifest.json'), 'utf8'));
const [srcDir, only] = process.argv.slice(2);
if (!srcDir) {
  console.error('usage: node tools/models/optimize.mjs <source dir> [id]');
  process.exit(1);
}

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

// Parts nobody sees from a chase camera at 200 km/h.
const RACE_DROP = /interior|\bint[_\s]|^int_|cockpit|steer|seat|dash|gauge|display|dispaly|pedal|harness|engine|\bled|belt|mirror_in|rim_blur|blur/i;
const WHEEL_KEYS = ['FL', 'FR', 'RL', 'RR'];

const countTris = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      n += (prim.getIndices() ?? prim.getAttribute('POSITION')).getCount() / 3;
    }
  }
  return n;
};

const worldCenter = (node) => {
  const b = getBounds(node);
  return b.min.map((v, i) => (v + b.max[i]) / 2);
};

// Removes nodes (and their subtrees) whose node, mesh or material names match `pattern`.
function dropParts(doc, pattern, keep = new Set()) {
  for (const node of doc.getRoot().listNodes()) {
    if (keep.has(node)) continue;
    const mesh = node.getMesh();
    if (pattern.test(node.getName()) || (mesh && pattern.test(mesh.getName()))) {
      node.dispose();
      continue;
    }
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      if (pattern.test(prim.getMaterial()?.getName() ?? '')) prim.dispose();
    }
    if (!mesh.listPrimitives().length) node.setMesh(null);
  }
}

// Finds the four wheel nodes (manifest names first, then the loader's name patterns).
function findWheels(doc, names = {}, parts = null) {
  if (parts) groupWheelParts(doc, parts);
  const nodes = doc.getRoot().listNodes();
  const patterns = {
    FL: /wheel[\s_.-]*(fl|lf|front[\s_.-]*l(eft)?)\b/i,
    FR: /wheel[\s_.-]*(fr|rf|front[\s_.-]*r(ight)?)\b/i,
    RL: /wheel[\s_.-]*(rl|lr|bl|rear[\s_.-]*l(eft)?)\b/i,
    RR: /wheel[\s_.-]*(rr|br|rear[\s_.-]*r(ight)?)\b/i,
  };
  const wheels = {};
  for (const key of WHEEL_KEYS) {
    wheels[key] = names[key] ? nodes.find((n) => n.getName() === names[key]) : nodes.find((n) => patterns[key].test(n.getName()));
    if (!wheels[key]) throw new Error(`wheel ${key} not found`);
  }
  return wheels;
}

// Models without wheel nodes: gathers each wheel's meshes (tyre, rim, disc) under a new node
// at the scene root. clearNodeParent keeps their world transforms.
function groupWheelParts(doc, parts) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const nodes = doc.getRoot().listNodes();
  for (const key of WHEEL_KEYS) {
    const wheel = doc.createNode(`wheel_${key}`);
    scene.addChild(wheel);
    for (const name of parts[key]) {
      const node = nodes.find((n) => n.getName() === name);
      if (!node) throw new Error(`wheel part ${name} not found`);
      clearNodeParent(node);
      wheel.addChild(node);
    }
  }
}

// Wraps the scene in a node that turns the nose to +X (and the car's left to -Z), using the
// wheel positions, and renames wheels / paint to the loader conventions.
function normalise(doc, entry) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const wheels = findWheels(doc, entry.wheels, entry.wheelParts);
  const c = Object.fromEntries(WHEEL_KEYS.map((k) => [k, worldCenter(wheels[k])]));
  const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
  const front = mid(c.FL, c.FR);
  const rear = mid(c.RL, c.RR);
  // A turn of `yaw` about +Y takes the forward vector (fx, fz) onto +X.
  const yaw = Math.atan2(front[2] - rear[2], front[0] - rear[0]);
  const pivot = doc.createNode('car').setRotation([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);
  for (const child of scene.listChildren()) pivot.addChild(child);
  scene.addChild(pivot);
  // Mirrored exports put the left wheels on +Z; the game's wheel order needs left = -Z.
  const leftZ = worldCenter(wheels.FL)[2];
  if (leftZ > 0) console.warn(`  ${entry.id}: left wheels on +Z after turning, check the model`);
  for (const key of WHEEL_KEYS) wheels[key].setName(`wheel_${key}`);
  for (const mat of doc.getRoot().listMaterials()) {
    const name = mat.getName();
    if (entry.paint?.includes(name)) mat.setName(`CarPaint_${name}`);
    else if (!entry.paint && /paint/i.test(name)) mat.setName(name.replace(/paint/i, 'Paint'));
    else if (entry.paint && /paint/i.test(name)) mat.setName(name.replace(/paint/gi, 'pnt'));
    if (entry.headlights?.includes(name)) mat.setName(`headlight_${name}`);
    if (entry.taillights?.includes(name)) mat.setName(`taillight_${name}`);
  }
  return wheels;
}

// Flattens the hierarchy into body parts at the scene root plus four wheel nodes that hold
// their own parts directly, so join() can merge everything that shares a material.
function flattenParts(doc, wheels) {
  const scene = doc.getRoot().listScenes()[0];
  const wheelSet = new Set(Object.values(wheels));
  const wheelOf = (node) => {
    for (let p = node; p; p = p.getParentNode()) if (wheelSet.has(p)) return p;
    return null;
  };
  // A wheel node that carries its own mesh hands it to a child, so join() cannot merge two
  // wheels (siblings at the root) into one mesh and lose their names.
  for (const w of wheelSet) {
    if (!w.getMesh()) continue;
    w.addChild(doc.createNode(`${w.getName()}_part`).setMesh(w.getMesh()));
    w.setMesh(null);
  }
  const meshNodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
  for (const w of wheelSet) clearNodeParent(w);
  for (const node of meshNodes) {
    const wheel = wheelOf(node);
    if (wheel === node) continue;
    clearNodeParent(node);
    if (wheel) {
      // world → wheel-local (wheel nodes now sit at the root, so their matrix is the world one)
      const local = multiply(invert(wheel.getMatrix()), node.getMatrix());
      node.setMatrix(local);
      wheel.addChild(node);
    }
  }
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh() && !wheelSet.has(node) && !node.listChildren().length) node.dispose();
  }
  return scene;
}

// Drops body parts smaller than `minSize` metres-equivalent (fraction of the car's length).
function dropSmall(doc, wheels, fraction) {
  const scene = doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const length = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
  const wheelSet = new Set(Object.values(wheels));
  for (const node of scene.listChildren()) {
    if (wheelSet.has(node) || !node.getMesh()) continue;
    const nb = getBounds(node);
    const size = Math.max(...nb.max.map((v, i) => v - nb.min[i]));
    if (size < length * fraction) node.dispose();
  }
}

// Per-corner normals: each corner averages the faces around its vertex that are within
// `crease` of its own face, so panel edges stay sharp and the two sides of a thin shell
// (which share welded vertices) never blend into a dark average. Output is non-indexed.
function creaseNormals(doc, crease = (25 * Math.PI) / 180) {
  const cos = Math.cos(crease);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      if (!pos || !idx) continue;
      const p = pos.getArray();
      const ix = idx.getArray();
      const faces = ix.length / 3;
      const fn = new Float32Array(faces * 3); // area-weighted face normals
      const around = new Map(); // vertex → faces
      for (let f = 0; f < faces; f++) {
        const [a, b, c] = [ix[f * 3] * 3, ix[f * 3 + 1] * 3, ix[f * 3 + 2] * 3];
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        fn[f * 3] = uy * vz - uz * vy;
        fn[f * 3 + 1] = uz * vx - ux * vz;
        fn[f * 3 + 2] = ux * vy - uy * vx;
        for (let k = 0; k < 3; k++) {
          const v = ix[f * 3 + k];
          if (!around.has(v)) around.set(v, []);
          around.get(v).push(f);
        }
      }
      const unit = (f) => {
        const l = Math.hypot(fn[f * 3], fn[f * 3 + 1], fn[f * 3 + 2]) || 1;
        return [fn[f * 3] / l, fn[f * 3 + 1] / l, fn[f * 3 + 2] / l];
      };
      const outPos = new Float32Array(faces * 9);
      const outNor = new Float32Array(faces * 9);
      for (let f = 0; f < faces; f++) {
        const [fx, fy, fz] = unit(f);
        for (let k = 0; k < 3; k++) {
          const v = ix[f * 3 + k];
          let nx = 0, ny = 0, nz = 0;
          for (const g of around.get(v)) {
            const [gx, gy, gz] = unit(g);
            if (fx * gx + fy * gy + fz * gz < cos) continue;
            nx += fn[g * 3];
            ny += fn[g * 3 + 1];
            nz += fn[g * 3 + 2];
          }
          const l = Math.hypot(nx, ny, nz) || 1;
          const o = (f * 3 + k) * 3;
          outPos.set(p.subarray(v * 3, v * 3 + 3), o);
          outNor.set([nx / l, ny / l, nz / l], o);
        }
      }
      const buffer = pos.getBuffer();
      prim.setIndices(null);
      prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(outPos).setBuffer(buffer));
      prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(outNor).setBuffer(buffer));
    }
  }
}

// Vertex-clustering simplification for the race LOD. Car bodies are dozens of separate open
// panels, and edge collapse either opens gaps between them or stalls on their borders;
// clustering welds neighbouring panels together instead.
function sloppyTo(doc, target) {
  const total = countTris(doc);
  if (total <= target) return;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      if (!idx || !pos) continue;
      const want = Math.min(idx.getCount() / 3, Math.max(12, Math.floor(((idx.getCount() / 3) * target) / total))) * 3;
      const [out] = MeshoptSimplifier.simplifySloppy(new Uint32Array(idx.getArray()), new Float32Array(pos.getArray()), 3, null, want, 1);
      if (out.length < 3) {
        prim.dispose();
        continue;
      }
      idx.setArray(out);
      compactPrimitive(prim);
    }
  }
}

// Per-primitive edge collapse for the race LOD: the body gets most of the budget and wheel
// parts (seen edge-on, a few pixels across) a third of their share, so a detailed rim cannot
// starve the body the way one global ratio does.
function collapseTo(doc, target, wheels) {
  const wheelSet = new Set(Object.values(wheels));
  const prims = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    let inWheel = false;
    for (let p = node; p; p = p.getParentNode()) if (wheelSet.has(p)) inWheel = true;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (!idx || !prim.getAttribute('POSITION')) continue;
      prims.push({ prim, tris: idx.getCount() / 3, weight: inWheel ? 1 / 3 : 1 });
    }
  }
  const weighted = prims.reduce((n, p) => n + p.tris * p.weight, 0);
  const scale = Math.min(1, target / weighted);
  for (const { prim, tris, weight } of prims) {
    const want = Math.max(weight < 1 ? 64 : 12, Math.floor(tris * weight * scale)) * 3;
    if (want >= tris * 3) continue;
    const idx = prim.getIndices();
    const pos = prim.getAttribute('POSITION');
    const [out] = MeshoptSimplifier.simplify(new Uint32Array(idx.getArray()), new Float32Array(pos.getArray()), 3, want, 0.05, []);
    if (out.length < 3) {
      prim.dispose();
      continue;
    }
    idx.setArray(out);
    compactPrimitive(prim);
  }
}

// Column-major 4x4 helpers (gltf-transform matrices).
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
function invert(m) {
  // Affine inverse: transpose-free general 3x3 inverse plus translation.
  const [a, b, c, , d, e, f, , g, h, i, , tx, ty, tz] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det, 0,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det, 0,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det, 0,
    0, 0, 0, 1,
  ];
  inv[12] = -(inv[0] * tx + inv[4] * ty + inv[8] * tz);
  inv[13] = -(inv[1] * tx + inv[5] * ty + inv[9] * tz);
  inv[14] = -(inv[2] * tx + inv[6] * ty + inv[10] * tz);
  return inv;
}

// Edge-collapse simplification (showroom) until the scene is under `target` triangles; the
// allowed error grows a step at a time up to `maxError` of each mesh's radius.
async function simplifyTo(doc, target, maxError = 0.02) {
  let error = Math.min(0.002, maxError);
  for (let i = 0; i < 10 && countTris(doc) > target; i++) {
    const ratio = Math.min(1, (target / countTris(doc)) * 0.95);
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }));
    if (process.env.DEBUG_SIMPLIFY) console.log('   ', error.toFixed(4), countTris(doc));
    error = Math.min(maxError, error * 1.8);
  }
}

// Race LOD: textures become their average colour times the material factor, extensions that
// stop a material from being "flat" (transmission, clearcoat...) are removed.
async function flattenMaterials(doc) {
  const avg = new Map();
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    try {
      const { channels } = await sharp(Buffer.from(img)).stats();
      avg.set(tex, channels.slice(0, 4).map((c) => c.mean / 255));
    } catch {
      avg.set(tex, [1, 1, 1, 1]);
    }
  }
  const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  for (const mat of doc.getRoot().listMaterials()) {
    const base = mat.getBaseColorTexture();
    if (base && avg.has(base)) {
      const [r, g, b] = avg.get(base);
      const f = mat.getBaseColorFactor();
      mat.setBaseColorFactor([f[0] * srgbToLinear(r), f[1] * srgbToLinear(g), f[2] * srgbToLinear(b), f[3]]);
    }
    const mr = mat.getMetallicRoughnessTexture();
    if (mr && avg.has(mr)) {
      const [, g, b] = avg.get(mr);
      mat.setRoughnessFactor(mat.getRoughnessFactor() * g).setMetallicFactor(mat.getMetallicFactor() * b);
    }
    const em = mat.getEmissiveTexture();
    if (em && avg.has(em)) {
      const [r, g, b] = avg.get(em);
      const f = mat.getEmissiveFactor();
      mat.setEmissiveFactor([f[0] * r, f[1] * g, f[2] * b]);
    }
    mat.setBaseColorTexture(null).setMetallicRoughnessTexture(null).setNormalTexture(null);
    mat.setOcclusionTexture(null).setEmissiveTexture(null);
    for (const ext of mat.listExtensions()) {
      // Transmissive glass becomes plain blended, smoked glass (its tint came from the
      // transmission, so the base colour is usually near white).
      if (ext.extensionName === 'KHR_materials_transmission') mat.setAlphaMode('BLEND').setBaseColorFactor([0.03, 0.045, 0.06, 0.7]);
      mat.setExtension(ext.extensionName, null);
    }
    // Alpha-tested decals and grilles have nothing left to cut out.
    if (mat.getAlphaMode() === 'MASK') mat.setAlphaMode('OPAQUE');
  }
  for (const tex of doc.getRoot().listTextures()) tex.dispose();
}

// Textures that only the cabin uses (seen through the glass from the orbit camera) are
// shrunk to `size` up front; the bodywork keeps the full resolution.
const CABIN = /int|cabin|cockpit|cpit|seat|dash|gauge|steer|harness|belt|alcantara|leather|stitch|pedal|lenkrad/i;
async function shrinkCabinTextures(doc, size) {
  for (const tex of doc.getRoot().listTextures()) {
    const mats = tex.listParents().filter((p) => p.propertyType === 'Material');
    if (!mats.length || !mats.every((m) => CABIN.test(m.getName()))) continue;
    const [w, h] = tex.getSize() ?? [0, 0];
    if (Math.max(w, h) <= size) continue;
    const img = await sharp(Buffer.from(tex.getImage())).resize(size, size, { fit: 'inside' }).png().toBuffer();
    tex.setImage(new Uint8Array(img)).setMimeType('image/png');
  }
}

// Kinds of file built per car (see the header): suffix, triangle budget, texture size.
const KINDS = {
  garage: { suffix: '', tris: (e) => e.garageTris ?? 150000, texture: (e) => e.textureSize ?? 2048, maxError: 0.008 },
  drive: { suffix: '_drive', tris: (e) => e.driveTris ?? 40000, texture: () => 1024, maxError: 0.02 },
  race: { suffix: '_race', tris: (e) => e.raceTris ?? 9000 },
};

async function build(entry, kind) {
  const spec = KINDS[kind];
  const doc = await io.read(path.join(srcDir, entry.src));
  if (entry.drop) dropParts(doc, new RegExp(entry.drop, 'i'));
  const wheels = normalise(doc, entry);
  const keepWheels = new Set(Object.values(wheels));
  if (kind === 'drive') dropParts(doc, entry.driveDrop ? new RegExp(entry.driveDrop, 'i') : RACE_DROP, keepWheels);
  if (kind === 'race') {
    dropParts(doc, entry.raceDrop ? new RegExp(entry.raceDrop, 'i') : RACE_DROP, keepWheels);
    await flattenMaterials(doc);
  }
  flattenParts(doc, wheels);
  if (kind === 'race') dropSmall(doc, wheels, entry.raceMinPart ?? 0.04);
  // Joining parts that share a material cuts draw calls and lets the simplifier work on
  // whole panels instead of hundreds of tiny pieces.
  if (kind === 'race') {
    // Untextured, so UV and normal seams would only stop the simplifier; normals come back
    // afterwards from creaseNormals().
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        for (const sem of prim.listSemantics()) if (sem !== 'POSITION') prim.setAttribute(sem, null);
      }
    }
  }
  await doc.transform(dedup(), prune(), join({ keepNamed: false }), weld());
  // Clustering suits bodies built from many open panels; models with closed, welded panels
  // keep their shape better with edge collapse (manifest `raceSimplify: "collapse"`).
  if (kind === 'race' && entry.raceSimplify !== 'collapse') sloppyTo(doc, spec.tris(entry));
  else if (kind === 'race') collapseTo(doc, spec.tris(entry), wheels);
  else await simplifyTo(doc, spec.tris(entry), spec.maxError);
  if (kind === 'race') creaseNormals(doc);
  await doc.transform(prune());
  if (spec.texture) {
    // Colour maps keep the full size (that is where badges-free liveries, grilles and lights
    // live); normal / roughness / occlusion maps read the same at half resolution.
    const size = spec.texture(entry);
    const half = Math.max(512, size / 2);
    await shrinkCabinTextures(doc, half);
    await doc.transform(
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [half, half], quality: 85, effort: 6, slots: /^(?!baseColorTexture|emissiveTexture).*$/ }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 85, effort: 6 }),
    );
  }
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = path.join(OUT, `${entry.id.replace(/-/g, '_')}${spec.suffix}.glb`);
  await io.write(file, doc);
  const draws = doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0);
  const { size } = await fs.stat(file);
  return { file: path.relative(root, file), tris: countTris(doc), draws, mb: +(size / 1e6).toFixed(2) };
}

const report = [];
for (const entry of manifest.cars) {
  if (only && !entry.id.includes(only)) continue;
  console.log(`${entry.id} ← ${entry.src}`);
  for (const kind of Object.keys(KINDS)) {
    const r = await build(entry, kind);
    console.log(`  ${kind}: ${r.tris} tris, ${r.draws} primitives, ${r.mb} MB → ${r.file}`);
    report.push({ id: entry.id, kind, ...r });
  }
}

// Credits for every car in the manifest (not only the ones rebuilt this run).
const lines = ['# Car model credits', '', 'Generated by `tools/models/optimize.mjs` from `tools/models/manifest.json`. The files here are', 'simplified, re-textured and compressed versions of the originals.', ''];
for (const e of manifest.cars) {
  const f = e.id.replace(/-/g, '_');
  lines.push(`- **${e.id}** (\`${f}.glb\`, \`${f}_drive.glb\`, \`${f}_race.glb\`): "${e.title}" by ${e.author}, ${e.license}. Source: ${e.source}. Changes: ${e.changes ?? 'badges and plates removed, simplified where over budget, textures resized to WebP, meshopt-compressed, rival LOD baked to flat colours'}.`);
}
await fs.writeFile(path.join(OUT, 'CREDITS.md'), `${lines.join('\n')}\n`);
console.table(report);
