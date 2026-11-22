import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// The cockpit model (versionCode 73): a detailed cabin built and baked in Blender
// (tools/cockpit/build_cockpit.py, packed by tools/cockpit/pack.mjs) in three files, one per
// quality tier. Only a race loads it (Race.prepare, before the warm-up uploads it to the GPU),
// so the garage never pays for it; the chase and close views keep it hidden.
//
//   high  full-detail mesh, 1024 px colour and normal atlases, ORM, env-map reflections
//   mid   the same mesh with every atlas at half size, no reflections
//   low   low-detail mesh, one 512 px colour atlas per material with the cabin light baked in,
//         unlit (and no live mirror: race/cockpit.js)

export const COCKPIT_TIERS = ['high', 'mid', 'low'];
export const COCKPIT_FILES = { high: 'cockpit_high.glb', mid: 'cockpit_mid.glb', low: 'cockpit_low.glb' };
// One mesh (one draw) each.
export const COCKPIT_PARTS = [
  'cockpit_shell',
  'cockpit_trim',
  'cockpit_wheel',
  'cockpit_wheel_trim',
  'cockpit_hands',
  'cockpit_forearm_l',
  'cockpit_forearm_r',
  'cockpit_needle',
  'cockpit_mirror_glass',
];

// Quality tier from the GPU tier (render/gpuTier.js, the F1 ANR fix) and the race's graphics
// level: a low-end GPU always gets the low tier, High gets high, anything else mid.
export function cockpitTier({ lowEnd = false, quality = 'medium' } = {}) {
  if (lowEnd) return 'low';
  return quality === 'high' ? 'high' : 'mid';
}

let loader = null;
function getLoader() {
  loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

// Named meshes of a parsed file: { tier, parts: { cockpit_shell: Mesh, ... } }.
export function collectParts(scene, tier) {
  const parts = {};
  scene.traverse((o) => {
    if (o.isMesh && COCKPIT_PARTS.includes(o.name)) parts[o.name] = o;
  });
  return { tier, parts };
}

// Parses a cockpit file already in memory (tests, tools).
export function parseCockpitAsset(data, tier) {
  return new Promise((resolve, reject) => getLoader().parse(data, '', (g) => resolve(collectParts(g.scene, tier)), reject));
}

// Loads (once per session) the file for a tier. Resolves null when it cannot be loaded, and the
// cockpit then shows its instruments only, so a missing file never blocks a race.
const cache = new Map();
export function loadCockpitAsset(tier) {
  if (!COCKPIT_FILES[tier]) tier = 'mid';
  if (!cache.has(tier)) {
    const url = `${import.meta.env?.BASE_URL ?? './'}assets/cockpit/${COCKPIT_FILES[tier]}`;
    const t0 = performance.now();
    cache.set(
      tier,
      getLoader()
        .loadAsync(url)
        .then(
          (g) => {
            const asset = collectParts(g.scene, tier);
            asset.loadMs = performance.now() - t0;
            return asset;
          },
          (err) => {
            console.warn('[cockpit] model not loaded', err);
            cache.delete(tier);
            return null;
          }
        )
    );
  }
  return cache.get(tier);
}
