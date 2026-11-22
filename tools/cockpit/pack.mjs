// Packs the Blender build (tools/cockpit/build_cockpit.py -> tools/cockpit/build/) into the three
// cockpit files the game loads, one per quality tier (src/race/cockpitAsset.js):
//
//   cockpit_high.glb  full-detail mesh, 1024 px colour and normal atlases, 512 px ORM
//                     (R baked cabin shading, G roughness, B metalness), carbon tile 256 px
//   cockpit_mid.glb   the same mesh, every atlas at half size (512 px, ORM 256 px)
//   cockpit_low.glb   low-detail mesh, one 512 px colour atlas per material with the cabin light
//                     baked in (KHR_materials_unlit), no normal or ORM maps, untextured trim
//
// Materials (one per runtime part family, so each mesh is one draw):
//   cabin   cockpit_shell                         wheel   wheel, hands, forearms
//   trim    cockpit_trim, cockpit_wheel_trim      plain   needle, mirror glass (set at runtime)
//
// Meshes are meshopt-compressed (reorder + quantise; three.js decodes it offline in plain JS),
// textures are WebP (EXT_texture_webp).
//
//   node tools/cockpit/pack.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const BUILD = path.join(here, 'build');
const OUT = path.join(root, 'public/assets/cockpit');

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const TIERS = {
  high: { mesh: 'cockpit_high.glb', atlas: 1024, orm: 512, carbon: 256, lit: false },
  mid: { mesh: 'cockpit_high.glb', atlas: 512, orm: 256, carbon: 256, lit: false },
  low: { mesh: 'cockpit_low.glb', atlas: 512, carbon: 0, lit: true },
};
const FAMILY = {
  cockpit_shell: 'cabin',
  cockpit_wheel: 'wheel',
  cockpit_hands: 'wheel',
  cockpit_forearm_l: 'wheel',
  cockpit_forearm_r: 'wheel',
  cockpit_trim: 'trim',
  cockpit_wheel_trim: 'trim',
  cockpit_needle: 'plain',
  cockpit_mirror_glass: 'plain',
};

async function webp(file, size, { lossless = false, quality = 86 } = {}) {
  return sharp(path.join(BUILD, file))
    .resize(size, size, { kernel: 'lanczos3' })
    .webp(lossless ? { lossless: true } : { quality, alphaQuality: 100, smartSubsample: true, effort: 6 })
    .toBuffer();
}

await fs.mkdir(OUT, { recursive: true });
const report = {};
for (const [tier, t] of Object.entries(TIERS)) {
  const doc = await io.read(path.join(BUILD, t.mesh));
  const rootDef = doc.getRoot();
  const webpExt = doc.createExtension(EXTTextureWebP).setRequired(true);
  void webpExt;
  const tex = async (name, file, size, opts) => doc.createTexture(name).setImage(await webp(file, size, opts)).setMimeType('image/webp');
  const mats = {};
  for (const atlas of ['cabin', 'wheel']) {
    const m = doc.createMaterial(atlas).setDoubleSided(true);
    if (t.lit) {
      const unlit = doc.createExtension(KHRMaterialsUnlit);
      m.setExtension('KHR_materials_unlit', unlit.createUnlit());
      m.setBaseColorTexture(await tex(`${atlas}_lit`, `${atlas}_lit.png`, t.atlas));
    } else {
      m.setBaseColorTexture(await tex(`${atlas}_albedo`, `${atlas}_albedo.png`, t.atlas));
      m.setNormalTexture(await tex(`${atlas}_normal`, `${atlas}_normal.png`, t.atlas, { quality: 92 }));
      const orm = await tex(`${atlas}_orm`, `${atlas}_orm.png`, t.orm, { quality: 90 });
      m.setOcclusionTexture(orm).setMetallicRoughnessTexture(orm).setRoughnessFactor(1).setMetallicFactor(1);
    }
    mats[atlas] = m;
  }
  mats.trim = doc.createMaterial('trim').setBaseColorFactor([0.55, 0.55, 0.55, 1]).setRoughnessFactor(0.4).setMetallicFactor(0.3);
  if (t.carbon) {
    mats.trim.setBaseColorTexture(await tex('carbon_albedo', 'carbon_albedo.png', t.carbon));
    mats.trim.setNormalTexture(await tex('carbon_normal', 'carbon_normal.png', t.carbon, { quality: 92 }));
  }
  mats.plain = doc.createMaterial('plain');
  // Blender numbers repeated mesh names (cockpit_shell.001): the node names are the real ones.
  for (const node of rootDef.listNodes()) {
    const mesh = node.getMesh();
    node.setName(node.getName().replace(/\.\d+$/, ''));
    if (mesh) mesh.setName(node.getName());
  }
  for (const mesh of rootDef.listMeshes()) {
    const fam = FAMILY[mesh.getName()];
    if (!fam) throw new Error(`unknown mesh ${mesh.getName()}`);
    for (const prim of mesh.listPrimitives()) {
      prim.setMaterial(mats[fam]);
    }
  }
  await doc.transform(prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = path.join(OUT, `cockpit_${tier}.glb`);
  await io.write(file, doc);
  const size = (await fs.stat(file)).size;
  let tris = 0;
  for (const mesh of rootDef.listMeshes()) for (const prim of mesh.listPrimitives()) tris += prim.getIndices().getCount() / 3;
  report[tier] = { bytes: size, triangles: tris, textures: rootDef.listTextures().map((x) => x.getName()) };
  console.log(`${tier.padEnd(5)} ${(size / 1024).toFixed(0).padStart(6)} KB  ${tris} triangles  ${rootDef.listTextures().length} textures`);
}
const total = Object.values(report).reduce((a, r) => a + r.bytes, 0);
console.log(`total ${(total / 1048576).toFixed(2)} MB`);
await fs.writeFile(path.join(here, 'pack-report.json'), JSON.stringify(report, null, 1) + '\n');
