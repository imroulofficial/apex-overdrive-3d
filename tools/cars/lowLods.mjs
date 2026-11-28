// Low-end GPU files for the Blender cars (versionCode 75), made from the files the game already
// ships (public/assets/models/), so no Blender run is needed:
//
//   <file>_cockpit_low.glb  the driver-view cabin for the low tier (a low-end GPU on Graphics
//                           Auto): every mesh simplified (<= LOW_COCKPIT_TRIS in all), 512 px
//                           colour atlases, the night glow at 256 px, no normal or ORM maps
//                           (the low tier shades with Lambert and no reflections)
//   <file>_cockpit.glb      (--cap) the high cabin's shell simplified down to HIGH_SHELL_TRIS
//                           where it is over (the Kestrel's was 33k)
//   <file>_drive.glb        the player's car: the cabin parts (interior, driver, steering
//                           wheel, the dash) and the rims and tyres get their texture's colour baked
//                           into a vertex attribute (_BAKEDCOLOR), so race/raceCars.js can fold
//                           them into its vertex-colour atlas (one draw instead of one per
//                           material); the textures stay for the higher tiers' rims and tyres
//
//   node tools/cars/lowLods.mjs [--cars rp1_vanta,...] [--only cockpit,cap,drive]
//
// Idempotent: the low cockpit is rebuilt from the full one, the cap only touches shells over
// budget, and the drive bake overwrites its attribute.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, dequantize, meshopt, normals, prune, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(here, '../../public/assets/models');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const FILES = arg('cars', 'rp1_vanta,kz_kestrel,sv_stallion,rb_ridgeback,ag_aurelia,mz_monza,tm_tempesta,rpx_hyperion').split(',');
const ONLY = arg('only', 'cockpit,cap,drive').split(',');

export const LOW_COCKPIT_TRIS = 14000;
const HIGH_SHELL_TRIS = 18000;
// Share of the low cabin's triangle budget per node (the rest goes to the shell).
const LOW_SHARE = { hands: 2400, cabin_glass: 900, window_L: 260, window_R: 260 };
const LOW_TEX = { Cockpit_base: 512, Cockpit_glow: 256, Gauges_base: 512 };
// Materials whose texture colour is baked into the vertices (any node: the dash's Interior
// parts sit in the body mesh).
const DRIVE_BAKE = /^(Interior|Driver|Rim|Tyre)$/;
// ... and every textured part of the cabin nodes (the steering wheel's Body parts).
const DRIVE_BAKE_NODES = /^(interior|driver|steering_wheel)$/;

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const tris = (prim) => (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
const meshTris = (mesh) => mesh.listPrimitives().reduce((n, p) => n + tris(p), 0);
const docTris = (doc) => doc.getRoot().listMeshes().reduce((n, m) => n + meshTris(m), 0);
const nodeOf = (doc, mesh) => doc.getRoot().listNodes().find((n) => n.getMesh() === mesh);

// Simplifies every primitive of `mesh` (over 200 triangles) toward `target` triangles in all,
// loosening the error bound until it gets there or the bound reaches `maxError` of the mesh's size.
function simplifyMesh(doc, mesh, target, maxError = 0.04) {
  const before = meshTris(mesh);
  if (before <= target) return before;
  for (const error of [0.002, 0.005, 0.01, 0.02, 0.04, 0.08, 0.15, 0.3].filter((e) => e <= maxError)) {
    const ratio = Math.min(1, target / meshTris(mesh));
    for (const prim of mesh.listPrimitives()) {
      if (tris(prim) > 200) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: false });
    }
    if (meshTris(mesh) <= target * 1.05) break;
  }
  return meshTris(mesh);
}

// Glass made of hundreds of loose pieces (the remastered cars' cut panels) cannot simplify: its
// pieces share no vertices. Welds a primitive by position alone (0.5 mm), without its normals,
// which normals() rebuilds afterwards.
function weldByPosition(doc, prim) {
  const pos = prim.getAttribute('POSITION');
  const idx = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: pos.getCount() }, (_, i) => i);
  const keys = new Map();
  const out = [];
  const remap = new Uint32Array(pos.getCount());
  const p = [0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, p);
    const key = p.map((c) => Math.round(c / 5e-4)).join(',');
    if (!keys.has(key)) {
      keys.set(key, out.length / 3);
      out.push(...p);
    }
    remap[i] = keys.get(key);
  }
  for (const s of prim.listSemantics()) if (s !== 'POSITION') prim.setAttribute(s, null);
  pos.setArray(new Float32Array(out));
  const tri = [];
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [remap[idx[i]], remap[idx[i + 1]], remap[idx[i + 2]]];
    if (a !== b && b !== c && a !== c) tri.push(a, b, c);
  }
  const indices = prim.getIndices() ?? doc.createAccessor().setType('SCALAR').setBuffer(pos.getBuffer());
  indices.setArray(new Uint32Array(tri));
  prim.setIndices(indices);
}

async function resizeTexture(tex, size) {
  const img = await sharp(Buffer.from(tex.getImage())).resize(size, size, { kernel: 'lanczos3' }).webp({ quality: 86, effort: 6 }).toBuffer();
  tex.setImage(new Uint8Array(img)).setMimeType('image/webp');
}

async function lowCockpit(file) {
  const src = path.join(DIR, `${file}_cockpit.glb`);
  const doc = await io.read(src);
  await doc.transform(dequantize(), weld());
  const before = docTris(doc);
  const meshes = doc.getRoot().listMeshes();
  const named = (mesh) => nodeOf(doc, mesh)?.getName() ?? '';
  let fixed = 0;
  const isGlass = (mesh) => /glass|window/.test(named(mesh));
  for (const mesh of meshes.filter(isGlass)) for (const prim of mesh.listPrimitives()) weldByPosition(doc, prim);
  for (const mesh of meshes) {
    const share = LOW_SHARE[named(mesh)];
    // Glass is clear and thin: its shape may move a little more than the dash's.
    if (share) fixed += simplifyMesh(doc, mesh, share, isGlass(mesh) ? 0.3 : 0.04);
  }
  // Everything else (the shell and its small parts) shares what is left, by size.
  const rest = meshes.filter((m) => !LOW_SHARE[named(m)]);
  const restTris = rest.reduce((n, m) => n + meshTris(m), 0);
  const budget = LOW_COCKPIT_TRIS - fixed;
  for (const mesh of rest) simplifyMesh(doc, mesh, Math.floor((budget * meshTris(mesh)) / restTris));
  await doc.transform(normals({ overwrite: false }), weld());
  // Textures: colour 512 px, glow 256 px, no normal or ORM maps.
  doc.createExtension(EXTTextureWebP).setRequired(true);
  for (const mat of doc.getRoot().listMaterials()) {
    if (mat.getNormalTexture()) mat.setNormalTexture(null);
    if (mat.getMetallicRoughnessTexture()) mat.setMetallicRoughnessTexture(null).setRoughnessFactor(0.75).setMetallicFactor(0);
    if (mat.getOcclusionTexture()) mat.setOcclusionTexture(null);
  }
  for (const tex of doc.getRoot().listTextures()) {
    const size = LOW_TEX[tex.getName()];
    if (size) await resizeTexture(tex, size);
  }
  await doc.transform(prune({ keepAttributes: true }), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const out = path.join(DIR, `${file}_cockpit_low.glb`);
  await io.write(out, doc);
  const texBytes = doc.getRoot().listTextures().reduce((n, t) => n + t.getImage().byteLength, 0);
  console.log(`${file}_cockpit_low.glb  ${before} -> ${docTris(doc)} tris, ${doc.getRoot().listTextures().map((t) => t.getName()).join(' ')} (${texBytes >> 10} KB), ${(await fs.stat(out)).size >> 10} KB`);
}

async function capCockpit(file) {
  const src = path.join(DIR, `${file}_cockpit.glb`);
  const doc = await io.read(src);
  const shell = doc.getRoot().listMeshes().find((m) => nodeOf(doc, m)?.getName() === 'cockpit_shell');
  if (!shell || meshTris(shell) <= HIGH_SHELL_TRIS) return console.log(`${file}_cockpit.glb  shell ${shell ? meshTris(shell) : '-'} tris: unchanged`);
  const before = docTris(doc);
  await doc.transform(dequantize(), weld());
  simplifyMesh(doc, shell, HIGH_SHELL_TRIS);
  await doc.transform(prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await io.write(src, doc);
  console.log(`${file}_cockpit.glb  ${before} -> ${docTris(doc)} tris (shell ${meshTris(shell)}), ${(await fs.stat(src)).size >> 10} KB`);
}

// sRGB 8-bit -> linear.
const LIN = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

const toSrgb8 = (c) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.min(1, c), 1 / 2.4) - 0.055));

async function bakeDrive(file) {
  const src = path.join(DIR, `${file}_drive.glb`);
  const doc = await io.read(src);
  for (const p of doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())) p.setAttribute('_BAKEDCOLOR', null);
  await doc.transform(dequantize());
  const images = new Map();
  const pixels = async (tex) => {
    if (!images.has(tex)) {
      const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      images.set(tex, { data, w: info.width, h: info.height });
    }
    return images.get(tex);
  };
  let baked = 0;
  const cabinMeshes = new Set(doc.getRoot().listNodes().filter((n) => DRIVE_BAKE_NODES.test(n.getName()) && n.getMesh()).map((n) => n.getMesh()));
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!DRIVE_BAKE.test(mat?.getName() ?? '') && !cabinMeshes.has(mesh)) continue;
      const tex = mat?.getBaseColorTexture();
      const uv = prim.getAttribute('TEXCOORD_0');
      if (!tex || !uv) continue;
      const img = await pixels(tex);
      const f = mat.getBaseColorFactor();
      const n = uv.getCount();
      // sRGB-encoded bytes (VEC4: glTF vertex attributes align to 4 bytes); the loader reads
      // them back as linear colour (raceCars.js bakedColor).
      const out = new Uint8Array(n * 4);
      const t = [0, 0];
      for (let i = 0; i < n; i++) {
        uv.getElement(i, t);
        // Box-filtered sample (5 taps over ~1/64 of the image) so a vertex never lands on a
        // single stray texel.
        let r = 0, g = 0, b = 0;
        for (const [du, dv] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const u = t[0] + du / 128;
          const v = t[1] + dv / 128;
          const x = Math.min(img.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * img.w)));
          const y = Math.min(img.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * img.h)));
          const k = (y * img.w + x) * 3;
          r += LIN[img.data[k]];
          g += LIN[img.data[k + 1]];
          b += LIN[img.data[k + 2]];
        }
        out[i * 4] = toSrgb8((r / 5) * f[0]);
        out[i * 4 + 1] = toSrgb8((g / 5) * f[1]);
        out[i * 4 + 2] = toSrgb8((b / 5) * f[2]);
        out[i * 4 + 3] = 255;
      }
      const attr = doc.createAccessor().setType('VEC4').setBuffer(uv.getBuffer()).setNormalized(true);
      attr.setArray(out);
      prim.setAttribute('_BAKEDCOLOR', attr);
      baked += n;
    }
  }
  await doc.transform(prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await io.write(src, doc);
  console.log(`${file}_drive.glb  baked colours on ${baked} vertices, ${(await fs.stat(src)).size >> 10} KB`);
}

for (const file of FILES) {
  if (ONLY.includes('cap')) await capCockpit(file);
  if (ONLY.includes('cockpit')) await lowCockpit(file);
  if (ONLY.includes('drive')) await bakeDrive(file);
}
