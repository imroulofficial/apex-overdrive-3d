import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Photographic CC0 surfaces and props for the race world (public/assets/env/, sources and
// licences in CREDITS.md there, produced by tools/assets/fetch.mjs). They ship inside the app
// and load from the WebView's local origin, so races stay fully offline.
//
// Loaded once and shared by every race. Anything that fails to load comes back null and the
// builders fall back to the procedural textures and meshes they used before, so a missing
// file never blocks a race.

const BASE = `${import.meta.env?.BASE_URL ?? './'}assets/env/`;

// [file, colour data?]. Normal maps stay linear.
export const TEXTURES = {
  asphalt: ['asphalt_diff.webp', true],
  gravel: ['gravel_diff.webp', true],
  gravelNormal: ['gravel_nor_gl.webp', false],
  grass: ['grass_diff.webp', true],
  cliff: ['cliff_diff.webp', true],
  sand: ['sand_diff.webp', true],
  forest: ['forest_diff.webp', true],
  redwoodBark: ['redwood_bark_diff.webp', true],
  palmBark: ['palm_bark_diff.webp', true],
  fronds: ['fronds_rgba.webp', true],
  // Alpine Summit.
  snow: ['snow_diff.webp', true],
  alpineRock: ['alpine_rock_diff.webp', true],
  tunnelStone: ['tunnel_stone_diff.webp', true],
  pineBark: ['pine_bark_diff.webp', true],
  // Neon City: viaducts, barriers and pylons; hard shoulders and pavements.
  concrete: ['concrete_diff.webp', true],
  pavement: ['pavement_diff.webp', true],
};
export const MODELS = { boulder: 'boulder.glb', rock: 'rock.glb' };

// Frond cut-outs in fronds_rgba.webp as [u0, v0, u1, v1], v measured from the top of the
// image (the atlas loads with flipY off, like glTF). Each frond's tip is at v0, its stem at v1.
export const FRONDS = [
  [0.089, 0.111, 0.233, 0.947],
  [0.313, 0.024, 0.454, 0.763],
  [0.714, 0.109, 0.836, 0.895],
  [0.508, 0.027, 0.657, 0.499],
  [0.513, 0.511, 0.628, 0.964],
];

let pending = null;

export function loadEnvAssets(renderer) {
  pending ??= load(renderer);
  return pending;
}

async function load(renderer) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loader = new THREE.TextureLoader();
  const tex = {};
  const models = {};
  const jobs = Object.entries(TEXTURES).map(([key, [file, srgb]]) =>
    loader.loadAsync(BASE + file).then(
      (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = key.startsWith('asphalt') || key.startsWith('gravel') ? aniso : Math.min(4, aniso);
        if (key === 'fronds') {
          t.flipY = false;
          t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        }
        t.userData.shared = true; // kept across tracks (Race.dispose)
        tex[key] = t;
      },
      () => (tex[key] = null)
    )
  );
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  for (const [key, file] of Object.entries(MODELS)) {
    jobs.push(
      gltf.loadAsync(BASE + file).then(
        (g) => (models[key] = extract(g.scene)),
        () => (models[key] = null)
      )
    );
  }
  await Promise.all(jobs);
  return { tex, models };
}

// One float geometry (node transforms baked in, centred on its base) plus a material with the
// model's own textures, ready for an InstancedMesh.
function extract(scene) {
  scene.updateMatrixWorld(true);
  const geos = [];
  let material = null;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    material ??= o.material;
    const g = new THREE.BufferGeometry();
    // Meshopt quantizes positions/normals/uvs to normalized integers; unpack them to floats
    // so the node transform can be applied.
    for (const name of ['position', 'normal', 'uv']) {
      const a = o.geometry.attributes[name];
      if (!a) continue;
      const out = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
      g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
    }
    if (o.geometry.index) g.setIndex(Array.from(o.geometry.index.array));
    g.applyMatrix4(o.matrixWorld);
    geos.push(g);
  });
  if (!geos.length) return null;
  // Lambert like the terrain they sit on: cheaper on phones, and the scans' standard material
  // came out near-black under the race lighting.
  material = new THREE.MeshLambertMaterial({ map: material.map, normalMap: material.normalMap, normalScale: material.normalScale });
  const geometry = geos[0];
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const size = box.getSize(new THREE.Vector3());
  // Unit footprint: the largest horizontal extent becomes 1 m, resting on y = 0.
  const s = 1 / Math.max(size.x, size.z);
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2).scale(s, s, s);
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, material, height: size.y * s };
}
