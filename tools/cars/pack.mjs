// Packs a car's Blender build (tools/cars/build_car.py -> tools/cars/build/<file>/) into the game
// files and measures them against the new-car contract (PHASE0-AUDIT section 2.5):
//
//   <file>.glb          showroom: base + ORM (R AO, G roughness, B metalness) + normal, WebP
//   <file>_drive.glb    player on track: base (AO multiplied in) + normal, WebP
//   <file>_race.glb     rivals: no textures, COLOR_0 = albedo x AO (stripped from CarPaint)
//   <file>_cockpit.glb  cockpit-view parts (wheel with display, hands, inner panel)
//
// Meshes are meshopt-compressed (three.js decodes offline in plain JS). Output goes to
// tools/cars/out/ (nothing is copied into public/ by this script) with stats.json / stats.md.
//
//   node tools/cars/pack.mjs [tm_tempesta]

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.argv[2] ?? 'tm_tempesta';
const BUILD = path.join(here, 'build', FILE);
const OUT = path.join(here, 'out');

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const LODS = [
  { lod: 'showroom', suffix: '', maxTris: 150000, maxBytes: 1.8e6, tex: { base: 2048, orm: 1024, normal: 1024 } },
  { lod: 'drive', suffix: '_drive', maxTris: 40000, maxBytes: 0.65e6, tex: { base: 1024, normal: 512 } },
  { lod: 'race', suffix: '_race', maxTris: 8000, maxBytes: 0.33e6, tex: null },
  { lod: 'cockpit', suffix: '_cockpit', maxTris: 60000, maxBytes: 1.5e6, tex: { base: 1024, orm: 512, normal: 512 } },
];
// Per material, the largest texture size used (smaller atlases stay at their own size).
const QUALITY = { base: 84, orm: 88, normal: 90 };

async function webp(file, size, kind) {
  const meta = await sharp(file).metadata();
  const s = Math.min(size, meta.width);
  return sharp(file)
    .resize(s, s, { kernel: 'lanczos3' })
    .webp({ quality: QUALITY[kind], effort: 6, smartSubsample: kind === 'base' })
    .toBuffer();
}

function trisOf(mesh) {
  let t = 0;
  for (const p of mesh.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  return t;
}

// Open edges after welding positions (cracks a renderer would show), per node mesh.
function openEdges(mesh) {
  const key = new Map();
  let open = 0;
  const count = new Map();
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    const idx = p.getIndices();
    const id = [];
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      const k = v.map((x) => Math.round(x * 1e5)).join(',');
      if (!key.has(k)) key.set(k, key.size);
      id.push(key.get(k));
    }
    const n = idx ? idx.getCount() : pos.getCount();
    for (let t = 0; t < n; t += 3) {
      const tri = [0, 1, 2].map((j) => id[idx ? idx.getScalar(t + j) : t + j]);
      for (let j = 0; j < 3; j++) {
        const a = tri[j], b = tri[(j + 1) % 3];
        if (a === b) continue;
        const e = a < b ? `${a}_${b}` : `${b}_${a}`;
        count.set(e, (count.get(e) ?? 0) + 1);
      }
    }
  }
  for (const c of count.values()) if (c === 1) open++;
  return open;
}

// Tyre roundness: min / max distance from the axis (local z) over the tread vertices.
function roundness(mesh) {
  let rmax = 0;
  const rs = [];
  const v = [0, 0, 0];
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      const r = Math.hypot(v[0], v[1]);
      rs.push([r, v[2]]);
      rmax = Math.max(rmax, r);
    }
  }
  // tread ring: vertices within 4 mm of the max radius; group by angle bins
  const tread = rs.filter(([r]) => r > rmax - 0.004).map(([r]) => r);
  return { radius: rmax, roundness: Math.min(...tread) / rmax };
}

const stats = [];
await fs.mkdir(OUT, { recursive: true });
for (const L of LODS) {
  const jsonPath = path.join(BUILD, `${FILE}${L.suffix}.json`);
  let info;
  try {
    info = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  } catch {
    console.warn(`skip ${L.lod}: no build`);
    continue;
  }
  const doc = await io.read(info.glb);
  const root = doc.getRoot();
  const webpExt = doc.createExtension(EXTTextureWebP).setRequired(true);

  // Textures per material.
  const texCount = [];
  for (const mat of root.listMaterials()) {
    const files = info.textures?.[mat.getName()];
    if (!files || !L.tex) continue;
    mat.setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(1).setMetallicFactor(1);
    const add = async (kind, size) => {
      const buf = await webp(files[kind], size, kind);
      const t = doc.createTexture(`${mat.getName()}_${kind}`).setImage(buf).setMimeType('image/webp');
      const m = await sharp(buf).metadata();
      texCount.push(`${mat.getName()} ${kind} ${m.width}² (${(buf.length / 1024).toFixed(0)} KB)`);
      return t;
    };
    mat.setBaseColorTexture(await add('base', L.tex.base));
    if (L.tex.orm) {
      const orm = await add('orm', L.tex.orm);
      mat.setMetallicRoughnessTexture(orm);
      mat.setOcclusionTexture(orm);
    } else {
      // drive: AO is in the albedo; roughness/metal from the ORM's average per material
      mat.setRoughnessFactor(mat.getName() === 'Tyre' ? 0.85 : mat.getName() === 'Rim' ? 0.35 : 0.42);
      mat.setMetallicFactor(mat.getName() === 'Rim' ? 0.8 : 0.1);
    }
    mat.setNormalTexture(await add('normal', L.tex.normal));
  }
  if (L.lod === 'race') {
    // CarPaint must not carry vertex colours (the loader would take them as a livery).
    for (const mesh of root.listMeshes())
      for (const p of mesh.listPrimitives()) {
        const m = p.getMaterial()?.getName() ?? '';
        if (!['Body', 'Tyre', 'Rim', 'Driver'].includes(m)) {
          const c = p.getAttribute('COLOR_0');
          if (c) p.setAttribute('COLOR_0', null);
        }
        if (!p.getAttribute('COLOR_0')) p.setAttribute('TEXCOORD_0', null);
      }
    for (const mat of root.listMaterials()) {
      if (['Body', 'Tyre', 'Rim', 'Driver'].includes(mat.getName())) mat.setBaseColorFactor([1, 1, 1, 1]);
    }
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) p.setAttribute('TEXCOORD_0', null);
  }
  if (!texCount.length) webpExt.dispose();

  // Measure before compression.
  let drawn = 0;
  const nodes = [];
  const opens = {};
  const wheels = {};
  for (const node of root.listNodes()) {
    nodes.push(node.getName());
    const mesh = node.getMesh();
    if (!mesh) continue;
    drawn += trisOf(mesh);
    if (!(mesh.getName() in opens)) opens[mesh.getName()] = openEdges(mesh);
    if (/^tyre_/.test(node.getName())) wheels[node.getName()] = roundness(mesh);
  }
  const bounds = getBounds(root.listScenes()[0]);

  await doc.transform(dedup(), prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(OUT, `${FILE}${L.suffix}.glb`);
  await io.write(out, doc);
  const bytes = (await fs.stat(out)).size;
  const openTotal = Object.values(opens).reduce((a, b) => a + b, 0);
  const s = {
    lod: L.lod,
    file: path.basename(out),
    bytes,
    maxBytes: L.maxBytes,
    tris: drawn,
    maxTris: L.maxTris,
    materials: root.listMaterials().map((m) => m.getName()),
    textures: texCount,
    openEdges: openTotal,
    openByMesh: opens,
    wheels,
    bounds: { min: bounds.min.map((v) => +v.toFixed(3)), max: bounds.max.map((v) => +v.toFixed(3)) },
    nodes,
  };
  stats.push(s);
  console.log(
    `${s.file.padEnd(26)} ${(bytes / 1024).toFixed(0).padStart(5)} KB / ${(L.maxBytes / 1024).toFixed(0)}  tris ${drawn} / ${L.maxTris}  open ${openTotal}  mats ${s.materials.length}`,
  );
}
await fs.writeFile(path.join(OUT, `${FILE}-stats.json`), JSON.stringify(stats, null, 1));
