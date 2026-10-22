// Downloads the CC0 environment assets listed in manifest.json from Poly Haven, shrinks them
// for phones and writes them into public/assets/env/ (bundled with the app, nothing is
// fetched at runtime). Re-run after editing the manifest:
//
//   node tools/assets/fetch.mjs            # download (cached) + process everything
//   node tools/assets/fetch.mjs rock_07    # only the entries whose id matches
//
// Textures become WebP (albedo in sRGB, normal/roughness linear); models become .glb with
// meshopt-compressed, simplified geometry and WebP textures. CREDITS.md is regenerated from
// the Poly Haven API so every file keeps its source, author and licence.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.join(root, 'public/assets/env');
const CACHE = path.join(here, 'cache');
const API = 'https://api.polyhaven.com';
const manifest = JSON.parse(await fs.readFile(path.join(here, 'manifest.json'), 'utf8'));
const only = process.argv[2];

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'apex-overdrive-asset-fetch' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function download(url, file) {
  try {
    await fs.access(file);
    return file;
  } catch {}
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

// Poly Haven names maps inconsistently ('Diffuse' vs 'diff', 'Rough' vs 'rough').
function pickMap(files, name) {
  const want = { diff: ['diff', 'Diffuse'], nor_gl: ['nor_gl'], rough: ['rough', 'Rough'], alpha: ['alpha', 'Alpha'] };
  for (const [key, entry] of Object.entries(files)) {
    const base = key.replace(/^.*_(?=[^_]+$)/, '');
    if ((want[name] ?? [name]).some((w) => key === w || key.endsWith(`_${w}`) || base === w)) return entry;
  }
  throw new Error(`no ${name} map in ${Object.keys(files).join(', ')}`);
}

async function processTexture(entry) {
  const files = await getJson(`${API}/files/${entry.id}`);
  const out = [];
  for (const [map, size] of Object.entries(entry.maps)) {
    const src = pickMap(files, map === 'rgba' ? `${entry.prefix ?? ''}diff` : `${entry.prefix ?? ''}${map}`)['1k'].jpg;
    const file = await download(src.url, path.join(CACHE, entry.id, path.basename(src.url)));
    let img = sharp(file).resize(size, size, { kernel: 'lanczos3' });
    if (map === 'rgba') {
      // sharp joins channels before resizing, so both halves are resized to raw pixels first.
      const alpha = pickMap(files, `${entry.prefix ?? ''}alpha`)['1k'].jpg;
      const aFile = await download(alpha.url, path.join(CACHE, entry.id, path.basename(alpha.url)));
      const rgb = await img.removeAlpha().raw().toBuffer();
      const a = await sharp(aFile).resize(size, size, { kernel: 'lanczos3' }).greyscale().raw().toBuffer();
      img = sharp(rgb, { raw: { width: size, height: size, channels: 3 } }).joinChannel(a, { raw: { width: size, height: size, channels: 1 } });
    } else if (map === 'rough') {
      img = img.greyscale();
    }
    const name = `${entry.key}_${map}.webp`;
    // Normal maps compress badly at low quality (banding in the sun glints).
    const quality = map === 'nor_gl' ? 90 : 82;
    await img.webp({ quality, alphaQuality: 90, effort: 6, smartSubsample: true }).toFile(path.join(OUT, name));
    out.push(name);
  }
  return out;
}

async function processModel(entry) {
  const files = await getJson(`${API}/files/${entry.id}`);
  const g = files.gltf['1k'].gltf;
  const dir = path.join(CACHE, entry.id);
  const gltfFile = await download(g.url, path.join(dir, path.basename(g.url)));
  for (const [rel, inc] of Object.entries(g.include)) await download(inc.url, path.join(dir, rel));

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(gltfFile);
  for (const mat of doc.getRoot().listMaterials()) {
    // Phones get albedo + normal only; roughness is a constant (the ARM maps would double the
    // texture memory for a barely visible difference on small instanced props).
    mat.setMetallicRoughnessTexture(null).setOcclusionTexture(null).setMetallicFactor(0).setRoughnessFactor(entry.roughness ?? 0.9);
  }
  const before = triangles(doc);
  await doc.transform(
    flatten(),
    join(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: entry.ratio, error: entry.error ?? 0.02 }),
    prune(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [entry.texture, entry.texture], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' })
  );
  const name = `${entry.key}.glb`;
  await io.write(path.join(OUT, name), doc);
  console.log(`  ${entry.id}: ${before} -> ${triangles(doc)} triangles`);
  return [name];
}

function triangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) n += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
  }
  return n;
}

await fs.mkdir(OUT, { recursive: true });
const credits = [];
for (const entry of [...manifest.textures.map((e) => ({ ...e, kind: 'texture' })), ...manifest.models.map((e) => ({ ...e, kind: 'model' }))]) {
  const info = await getJson(`${API}/info/${entry.id}`);
  credits.push({ entry, info });
  if (only && !entry.id.includes(only) && !entry.key.includes(only)) continue;
  console.log(`${entry.kind} ${entry.id}`);
  const written = entry.kind === 'texture' ? await processTexture(entry) : await processModel(entry);
  for (const f of written) {
    const { size } = await fs.stat(path.join(OUT, f));
    console.log(`  ${f} ${(size / 1024).toFixed(0)} KB`);
  }
}

const rows = credits.map(({ entry, info }) => {
  const authors = Object.keys(info.authors ?? {}).join(', ');
  const kind = info.type === 2 ? 'model' : 'texture'; // Poly Haven asset type of the source
  const files = entry.kind === 'model' ? `\`${entry.key}.glb\`` : Object.keys(entry.maps).map((m) => `\`${entry.key}_${m}.webp\``).join(' ');
  return `| ${files} | [${info.name}](https://polyhaven.com/a/${entry.id}) (${kind}) | ${authors} | ${entry.use} |`;
});
await fs.writeFile(
  path.join(OUT, 'CREDITS.md'),
  `# Environment assets: sources and licences

Generated by \`node tools/assets/fetch.mjs\` from \`tools/assets/manifest.json\`. Do not edit by hand.

Every file here comes from [Poly Haven](https://polyhaven.com) and is released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain, no attribution
required; credited anyway). Files were resized, re-encoded as WebP and, for models, simplified
and meshopt-compressed by the script. They are bundled into the app, so nothing downloads at runtime.

| File(s) | Source | Author(s) | Used for |
| --- | --- | --- | --- |
${rows.join('\n')}
`
);
console.log('wrote CREDITS.md');
