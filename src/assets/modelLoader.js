import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createSwapWheel } from '../garage/carModel.js';
import { createCarPaint } from '../garage/carPaint.js';

// Vehicle spawner. Every car in src/data/cars.js is a real model in public/assets/models/
// (three files per car, see the README there), turned into one "car rig" interface:
//
//   { group, source, paintMaterial, wheels: [{ wheel, spin }], wheelRadius, exhausts,
//     lightsOn, setLights(on), spinWheels(speed), update(dt), rim, setRim(id), door: null }
//
// A model brings its own wheels, aero and lights. Its 'stock' rim is the model's own wheel and
// the other five rim designs swap in wheels built at the model's tyre size
// (carModel.js createSwapWheel).
//
// The garage turntable, the paint system and the race baker (raceCars.js) only talk to that
// interface, and vehicle physics never looks at meshes at all.

const BASE = import.meta.env.BASE_URL ?? './';
// Same order as carModel.js: front then rear, +z (the car's right side, nose at +X) first.
const WHEEL_KEYS = ['FR', 'FL', 'RR', 'RL'];
const WHEEL_PATTERNS = {
  FL: /wheel[\s_.-]*(fl|lf|front[\s_.-]*l(eft)?)\b/i,
  FR: /wheel[\s_.-]*(fr|rf|front[\s_.-]*r(ight)?)\b/i,
  RL: /wheel[\s_.-]*(rl|lr|bl|rear[\s_.-]*l(eft)?|back[\s_.-]*l(eft)?)\b/i,
  RR: /wheel[\s_.-]*(rr|br|rear[\s_.-]*r(ight)?|back[\s_.-]*r(ight)?)\b/i,
};
const PAINT_PATTERN = /paint|carbody|body[\s_.-]*col/i;
const HEAD_PATTERN = /head[\s_.-]*l(ight|amp)|\bdrl\b/i;
const TAIL_PATTERN = /tail[\s_.-]*l(ight|amp)|brake[\s_.-]*l(ight|amp)/i;
const EXHAUST_PATTERN = /exhaust|muffler|tailpipe/i;

let loader = null;
function getLoader() {
  if (loader) return loader;
  loader = new GLTFLoader();
  // DRACOLoader references its decoder files via import.meta.url, so Vite bundles them and
  // compressed models decode offline. Meshopt's decoder is plain JS and needs no files.
  loader.setDRACOLoader(new DRACOLoader());
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

// Parsed glTF scenes per URL (null = known missing). Each spawn clones the cached scene.
const cache = new Map();

async function fetchGltf(url) {
  if (cache.has(url)) return cache.get(url);
  const task = (async () => {
    let res;
    try {
      res = await fetch(url);
    } catch {
      return null;
    }
    // Dev servers answer unknown paths with index.html; treat that as "not there yet".
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || type.includes('text/html')) return null;
    const buffer = await res.arrayBuffer();
    const dir = url.slice(0, url.lastIndexOf('/') + 1);
    return getLoader().parseAsync(buffer, dir);
  })().catch((err) => {
    console.warn(`[models] ${url} could not be parsed`, err);
    return null;
  });
  cache.set(url, task);
  return task;
}

const resolveUrl = (path) => (/^(https?:|blob:|data:|\/)/.test(path) ? path : `${BASE}${path}`);

// Model files per level of detail: the showroom, the player's own car on track, and rivals.
const LOD_URL = { garage: 'url', drive: 'driveUrl', race: 'raceUrl' };

// Drops a car's parsed `lod` model from the cache (its CPU copy of geometry and textures).
// The garage does this for the car leaving the turntable: showroom models are the heavy ones
// (up to 10 MB each), and browsing the roster would otherwise keep every one of them.
export function evictModel(def, lod = 'garage') {
  const url = def.model?.[LOD_URL[lod]];
  if (url) cache.delete(resolveUrl(url));
}

// Spawns a car rig for a catalog entry at `lod` ('garage' | 'drive' | 'race'). A missing LOD
// file falls back to the next more detailed one; a car with no loadable file at all throws.
export async function loadCar(def, { paintColor, finish, lod = 'garage', rim } = {}) {
  const order = ['race', 'drive', 'garage'];
  const urls = order.slice(order.indexOf(lod)).map((k) => def.model?.[LOD_URL[k]]).filter(Boolean);
  for (const url of urls) {
    const gltf = await fetchGltf(resolveUrl(url));
    if (!gltf) continue;
    try {
      return adaptGltf(gltf.scene, def, { paintColor, finish, rim, url });
    } catch (err) {
      console.warn(`[models] ${url} does not follow the car conventions`, err);
    }
  }
  throw new Error(`[models] no model could be loaded for ${def.id}`);
}

// ---------------------------------------------------------------------------
// glTF → car rig
// ---------------------------------------------------------------------------

function findNode(root, name, pattern) {
  let hit = null;
  root.traverse((o) => {
    if (hit) return;
    if (name ? o.name === name : pattern.test(o.name)) hit = o;
  });
  return hit;
}

// The paint's flake normal map tiles over the mesh UVs, which are livery unwraps of very
// different scales between models (the Stallion's made flakes centimetres wide). Paint
// meshes get box-projected UVs in metres instead, so every car sparkles at the same grain.
const FLAKE_UV_PER_METRE = 0.25;
function flakeUv(mesh) {
  const geo = mesh.geometry;
  if (geo.userData.flakeUv) return;
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).multiplyScalar(FLAKE_UV_PER_METRE);
    if (nrm) n.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix);
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const [u, v] = ax >= ay && ax >= az ? [p.z, p.y] : ay >= az ? [p.x, p.z] : [p.x, p.y];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.userData.flakeUv = true;
}

function adaptGltf(source, def, { paintColor, finish, rim = 'stock', url }) {
  const opts = def.model;
  const car = new THREE.Group();
  car.name = def.id;

  // Inner group carries the normalisation (orientation, scale, centring), so the rig's own
  // root keeps an identity transform.
  const model = source.clone(true);
  const fit = new THREE.Group();
  fit.add(model);
  car.add(fit);
  if (opts.rotationY) model.rotation.y = opts.rotationY; // turn the nose to +X
  if (opts.scale) model.scale.multiplyScalar(opts.scale);
  car.updateMatrixWorld(true);

  // Scale to the catalog length, then centre on the wheelbase (or bounds) and ground it.
  // Precise bounds: a rotated node's transformed bounding box pokes below its real
  // geometry (the Stallion's tilted calipers lifted the whole car off the floor).
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  if (!(size.x > 0)) throw new Error('model has no geometry');
  if (opts.length && !opts.scale) fit.scale.setScalar(opts.length / size.x);
  car.updateMatrixWorld(true);
  box.setFromObject(model, true);
  const center = box.getCenter(new THREE.Vector3());
  fit.position.set(-center.x, -box.min.y, -center.z);
  car.updateMatrixWorld(true);

  // Materials: one shared clear-coat paint replaces every paint material so the garage
  // paint shop works on the model; tail and head lenses get controllable emissives.
  const paint = createCarPaint(paintColor, finish);
  const head = new THREE.MeshStandardMaterial({ color: 0xdfe8ff, roughness: 0.1, emissive: 0xe8f0ff, emissiveIntensity: 0 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x400608, roughness: 0.15, emissive: 0xff1a1a, emissiveIntensity: 0.15 });
  tail.userData.tailLight = true;
  head.userData.headLight = true;
  const paintNames = opts.paintMaterials ?? null;
  let paintFound = false;
  const part = new THREE.Box3();
  const partSize = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.receiveShadow = false;
    // Small parts stay out of the showroom floor reflection (see Garage.js), which renders
    // the whole car a second time, and out of the shadow map: the body's shadow covers them.
    // Wheels get their shadow back below (one mesh each).
    part.setFromObject(o).getSize(partSize);
    const small = Math.max(partSize.x, partSize.y, partSize.z) < size.x * fit.scale.x * 0.3;
    o.castShadow = !small;
    if (small) o.userData.noReflect = true;
    const swap = (mat) => {
      const name = mat?.name ?? '';
      // Transmission makes three.js render the whole scene again into a transmission target
      // every frame; tinted blended glass looks the same on a car window.
      if (mat?.transmission > 0) {
        mat.transmission = 0;
        mat.transparent = true;
        mat.opacity = Math.min(mat.opacity, 0.45);
        mat.depthWrite = false;
      }
      if (paintNames ? paintNames.includes(name) : PAINT_PATTERN.test(name)) {
        paintFound = true;
        return paint;
      }
      if (TAIL_PATTERN.test(name) || TAIL_PATTERN.test(o.name)) {
        o.name = 'taillight';
        return tail;
      }
      if (HEAD_PATTERN.test(name) || HEAD_PATTERN.test(o.name)) {
        o.name = 'headlight';
        return head;
      }
      return mat;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    if (o.material === paint) flakeUv(o);
  });
  if (!paintFound) console.warn(`[models] ${url}: no paint material found; paint changes will not show`);

  // Wheels: re-parent each wheel node under a pivot at its centre so it can spin about the
  // axle (z) and steer about y.
  const wheels = [];
  let wheelRadius = 0.34;
  WHEEL_KEYS.forEach((key, index) => {
    const node = findNode(model, opts.wheels?.[key], WHEEL_PATTERNS[key]);
    if (!node) throw new Error(`wheel node ${key} not found`);
    const wb = new THREE.Box3().setFromObject(node);
    const wheel = new THREE.Group();
    wb.getCenter(wheel.position);
    car.add(wheel);
    const spin = new THREE.Group();
    wheel.add(spin);
    wheel.updateMatrixWorld(true);
    spin.attach(node);
    // The wheel's biggest mesh (the tyre) keeps its contact shadow.
    let biggest = null;
    let biggestSize = 0;
    node.traverse((o) => {
      if (!o.isMesh) return;
      const s = part.setFromObject(o).getSize(partSize).length();
      if (s > biggestSize) [biggest, biggestSize] = [o, s];
    });
    if (biggest) biggest.castShadow = true;
    wheel.traverse((o) => (o.userData.wheelIndex = index));
    wheels.push({ wheel, spin, stock: node, swap: null });
    if (index === 0) wheelRadius = wb.getSize(new THREE.Vector3()).y / 2;
  });

  // Aftermarket rims: the model's wheel comes out of the spinning group and a rim of the
  // same radius goes in; 'stock' puts the model's wheel back.
  const lod = /_(race|drive)\.glb$/.test(url) ? 0.5 : 1;
  const fitRim = (id) => {
    wheels.forEach((w, index) => {
      if (w.swap) {
        w.spin.remove(w.swap.spin);
        w.wheel.remove(w.swap.still);
        for (const part of [w.swap.spin, w.swap.still]) part.traverse((o) => o.isMesh && o.geometry.dispose());
        w.swap = null;
      }
      if (id === 'stock') {
        if (!w.stock.parent) w.spin.add(w.stock);
        return;
      }
      w.spin.remove(w.stock);
      w.swap = createSwapWheel(id, Math.sign(w.wheel.position.z) || 1, wheelRadius, lod);
      // Seat the swap wheel in the same frame as the model's (spin group is still unrotated
      // in its own frame; only spin.rotation.z ever changes).
      w.spin.add(w.swap.spin);
      w.wheel.add(w.swap.still);
      w.wheel.traverse((o) => (o.userData.wheelIndex = index));
    });
  };
  if (rim !== 'stock') fitRim(rim);

  // Nitro flames come out of nodes named "exhaust…", else the middle of the rear bumper.
  car.updateMatrixWorld(true);
  box.setFromObject(model);
  const exhausts = [];
  model.traverse((o) => {
    if (EXHAUST_PATTERN.test(o.name) && !o.children.some((c) => EXHAUST_PATTERN.test(c.name))) {
      const b = new THREE.Box3().setFromObject(o);
      exhausts.push(new THREE.Vector3(b.min.x - 0.04, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2));
    }
  });
  if (!exhausts.length) {
    for (const z of [-0.42, 0.42]) exhausts.push(new THREE.Vector3(box.min.x - 0.04, 0.32, z));
  }

  let lightsOn = false;
  let lightLevel = 0;
  let wheelSpeed = 0;
  return {
    group: car,
    source: 'gltf',
    paintMaterial: paint,
    wheels,
    wheelRadius,
    exhausts,
    rim,
    setRim(id) {
      if (id === this.rim) return;
      this.rim = id;
      fitRim(id);
      wheelSpeed = Math.max(wheelSpeed, 10);
    },
    door: null,
    get lightsOn() {
      return lightsOn;
    },
    setLights(on) {
      lightsOn = on;
    },
    spinWheels(speed) {
      wheelSpeed = speed;
    },
    update(dt) {
      lightLevel += ((lightsOn ? 1 : 0) - lightLevel) * Math.min(1, dt * 10);
      head.emissiveIntensity = lightLevel * 3.2;
      tail.emissiveIntensity = 0.15 + lightLevel * 3.5;
      wheelSpeed *= Math.pow(0.35, dt);
      if (wheelSpeed > 0.01) wheels.forEach(({ spin }) => (spin.rotation.z -= wheelSpeed * dt));
    },
  };
}
