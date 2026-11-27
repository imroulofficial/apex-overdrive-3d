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
import { ALL_EXTENSIONS, EXTTextureWebP, KHRTextureTransform } from '@gltf-transform/extensions';
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
  { lod: 'showroom', suffix: '', maxTris: 150000, maxBytes: 1.8e6, tex: { base: 2048, orm: 1024, normal: 1024, paint: 1024, carbon: 512 } },
  { lod: 'drive', suffix: '_drive', maxTris: 40000, maxBytes: 0.65e6, tex: { base: 1024, normal: 512, paint: 512, carbon: 512 } },
  { lod: 'race', suffix: '_race', maxTris: 8000, maxBytes: 0.33e6, tex: null },
  { lod: 'cockpit', suffix: '_cockpit', maxTris: 60000, maxBytes: 1.5e6, tex: { base: 1024, orm: 512, normal: 512, paint: 512, carbon: 512 } },
];
// Per material, the largest texture size used (smaller atlases stay at their own size).
// A closed car's cabin is seen through tinted glass: its atlases are capped per LOD.
// (A cap may also name one texture, e.g. Body_normal.) A closed car's drive file keeps the Body
// ORM (chrome needs its metal map), so its Body normal map drops to 256.
// A remastered car (tools/cars/remaster: the original hyper3d body) has a flat Body normal map
// (its shading is in the transferred vertex normals) over a many-island atlas: 256 is plenty.
const REMASTER = ['rp1_vanta', 'mz_monza', 'rpx_hyperion', 'rb_ridgeback'].includes(FILE);
// Its Body ORM (AO, flat roughness per material) and the cabin seen through the tint go to 256, its Body albedo to 1536 / 768 (drive).
const CAPS = { Interior: REMASTER ? { showroom: 256, drive: 256 } : { showroom: 512, drive: 256 },
  Gauges: { showroom: 512, drive: 256 },
  Body_normal: REMASTER ? { showroom: 256, drive: 128 } : { drive: FILE === 'ag_aurelia' ? 256 : 512 },
  ...(REMASTER ? { Body_orm: { showroom: 256, drive: 256 }, Body_base: { showroom: 1536, drive: 768 } } : {}),
  // the Ridgeback's black paint: its shading map at 768 (the roof rack and bull bar fill the budget)
  ...(FILE === 'rb_ridgeback' ? { CarPaint: { showroom: 768 } } : {}) };
const QUALITY = { base: 84, orm: 88, normal: 90 };

async function webp(file, size, kind) {
  const meta = await sharp(file).metadata();
  const s = Math.min(size, meta.width);
  let img = sharp(file).resize(s, s, { kernel: 'lanczos3' });
  // Carbon: the bake gives clear-coat roughness (~0.1). Without a clear-coat lobe three.js
  // turns that into a mirror of the environment (green verges in the race), so lift it.
  if (kind === 'orm-carbon') img = img.removeAlpha().linear([1, 0.8, 1], [0, 56, 0]);
  return img
    .webp({ quality: QUALITY[kind] ?? QUALITY.orm, effort: 6, smartSubsample: kind === 'base' })
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
  const tex = async (name, file, size, kind) => {
    const mname = name.split('_')[0];
    size = Math.min(size, CAPS[name]?.[L.lod] ?? CAPS[mname]?.[L.lod] ?? size);
    const buf = await webp(file, size, kind);
    const t = doc.createTexture(name).setImage(buf).setMimeType('image/webp');
    const m = await sharp(buf).metadata();
    texCount.push(`${name} ${m.width}² (${(buf.length / 1024).toFixed(0)} KB)`);
    return t;
  };
  for (const mat of root.listMaterials()) {
    const name = mat.getName();
    const files = info.textures?.[name];
    if (!files || !L.tex) continue;
    if (name === 'CarPaint') {
      // Factory livery map: the game's paint keeps it as a shading layer (carPaint.js
      // liveryPaint: texel luminance / factoryLum), and the Factory finish shows it as is.
      mat.setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(await tex('CarPaint_base', files.base, L.tex.paint, 'base'));
      mat.setExtras({ ...mat.getExtras(), factoryLum: files.factoryLum });
      continue;
    }
    if (name === 'Gauges') {
      // dial atlas (generated, not baked); glows faintly so the instruments read at night
      const t = await tex('Gauges_base', files.base, 1024, 'base');
      mat.setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(t).setRoughnessFactor(0.35).setMetallicFactor(0);
      // the cockpit's own dials are backlit (warm white) so they read clearly at night
      mat.setEmissiveTexture(t).setEmissiveFactor(L.lod === 'cockpit' ? [1.0, 0.86, 0.66] : [0.35, 0.33, 0.30]);
      continue;
    }
    if (files.weave_base) {
      // Carbon: tiling twill on TEXCOORD_1 (metres / weaveTile), baked AO + roughness on UV 0.
      mat.setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(1).setMetallicFactor(1);
      mat.setBaseColorTexture(await tex('Carbon_weave', files.weave_base, 512, 'base'));
      mat.getBaseColorTextureInfo().setTexCoord(1);
      mat.setNormalTexture(await tex('Carbon_weave_normal', files.weave_normal, 512, 'normal'));
      mat.getNormalTextureInfo().setTexCoord(1);
      mat.setNormalScale(0.45);
      const orm = await tex('Carbon_orm', files.orm, L.tex.carbon, 'orm-carbon');
      mat.setMetallicRoughnessTexture(orm);
      mat.setOcclusionTexture(orm);
      continue;
    }
    mat.setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(1).setMetallicFactor(1);
    mat.setBaseColorTexture(await tex(`${name}_base`, files.base, L.tex.base, 'base'));
    if (L.tex.orm || (files.useOrm && !(L.lod === 'drive' && name === 'Interior'))) {
      const orm = await tex(`${name}_orm`, files.orm, L.tex.orm ?? L.tex.normal, 'orm');
      mat.setMetallicRoughnessTexture(orm);
      mat.setOcclusionTexture(orm);
    } else {
      // drive: AO is in the albedo; roughness/metal from the ORM's average per material
      mat.setRoughnessFactor(name === 'Tyre' ? 0.85 : name === 'Rim' ? 0.32 : 0.45);
      mat.setMetallicFactor(name === 'Rim' ? 0.85 : 0.05);
    }
    mat.setNormalTexture(await tex(`${name}_normal`, files.normal, L.tex.normal, 'normal'));
    if (files.glow) {
      // baked night light (dash glow from the instruments, a little ambient): emissive map
      mat.setEmissiveTexture(await tex(`${name}_glow`, files.glow, 512, 'base')).setEmissiveFactor([1, 1, 1]);
    }
  }
  if (L.lod === 'race') {
    // CarPaint must not carry vertex colours (the loader would take them as a livery).
    for (const mesh of root.listMeshes())
      for (const p of mesh.listPrimitives()) {
        const m = p.getMaterial()?.getName() ?? '';
        if (!['Body', 'Tyre', 'Rim', 'Driver', 'Carbon', 'Interior'].includes(m)) {
          const c = p.getAttribute('COLOR_0');
          if (c) p.setAttribute('COLOR_0', null);
        }
        if (!p.getAttribute('COLOR_0')) p.setAttribute('TEXCOORD_0', null);
      }
    for (const mat of root.listMaterials()) {
      if (['Body', 'Tyre', 'Rim', 'Driver', 'Carbon', 'Interior'].includes(mat.getName())) mat.setBaseColorFactor([1, 1, 1, 1]);
    }
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) p.setAttribute('TEXCOORD_0', null);
  }
  // TEXCOORD_1 (weave) only where a texture reads it.
  for (const mesh of root.listMeshes())
    for (const p of mesh.listPrimitives()) {
      const m = p.getMaterial();
      if (!(m?.getBaseColorTextureInfo()?.getTexCoord() === 1 && m.getBaseColorTexture())) p.setAttribute('TEXCOORD_1', null);
    }
  // Weave UVs are in tiles (metres / weaveTile), far outside 0..1, so meshopt would leave them
  // as float32. Shift by whole tiles (the weave repeats) and divide by K into 0..1, then scale
  // back with KHR_texture_transform: 16-bit UVs at < 1/200 of a tile error.
  {
    let lo = Infinity, hi = -Infinity;
    const uv1 = [];
    for (const mesh of root.listMeshes())
      for (const p of mesh.listPrimitives()) {
        const a = p.getAttribute('TEXCOORD_1');
        if (!a || uv1.some((x) => x === a)) continue;
        uv1.push(a);
        const arr = a.getArray();
        for (let i = 0; i < arr.length; i++) (lo = Math.min(lo, arr[i]), hi = Math.max(hi, arr[i]));
      }
    if (uv1.length) {
      const m0 = Math.floor(lo);
      const K = Math.ceil(hi - m0);
      for (const a of uv1) a.setArray(Float32Array.from(a.getArray(), (v) => (v - m0) / K));
      const tt = doc.createExtension(KHRTextureTransform);
      for (const mat of root.listMaterials())
        for (const info of [mat.getBaseColorTextureInfo(), mat.getNormalTextureInfo()])
          if (info && info.getTexCoord() === 1)
            info.setExtension('KHR_texture_transform', tt.createTransform().setScale([K, K]).setTexCoord(1));
      console.log(`  weave uv: ${K} tiles -> 0..1`);
    }
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

  await doc.transform(dedup(), prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
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
