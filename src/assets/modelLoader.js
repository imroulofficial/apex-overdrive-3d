import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createCar, createSwapWheel } from '../garage/carModel.js';
import { createCarPaint } from '../garage/carPaint.js';

// Vehicle spawner. Every car in src/data/cars.js resolves to the same "car rig" interface,
// whether it comes from an external .glb in public/assets/models/ or from the procedural
// builder in carModel.js:
//
//   { group, source, paintMaterial, wheels: [{ wheel, spin }], wheelRadius, exhausts,
//     lightsOn, setLights(on), spinWheels(speed), update(dt),
//     rim, setRim(id), spoiler, setSpoiler(id), door: { anchor, normal, open, toggle(), close() } | null }
//
// A .glb brings its own wheels, wing and doors. Its 'stock' rim is the model's own wheel and
// the other five rim designs swap in procedural wheels (carModel.js createSwapWheel); the wing
// setter only records the choice and `door` is null (no hotspot).
//
// The garage turntable, the paint system and the race baker (raceCars.js) only talk to that
// interface, and vehicle physics never looks at meshes at all, so swapping a procedural car
// for a real model changes nothing else. A missing or broken .glb falls back to the
// procedural car, which keeps the game fully playable offline before any art lands.

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
    console.warn(`[models] ${url} could not be parsed, using the procedural car`, err);
    return null;
  });
  cache.set(url, task);
  return task;
}

const resolveUrl = (path) => (/^(https?:|blob:|data:|\/)/.test(path) ? path : `${BASE}${path}`);

// Returns true when the car's external model is present (does not build anything).
export async function hasExternalModel(def) {
  return Boolean(def.model?.url && (await fetchGltf(resolveUrl(def.model.url))));
}

// Spawns a car rig for a catalog entry. Below full detail (the race) a model's `raceUrl`
// LOD is used when present, else the showroom file; `detail` also scales the procedural car.
export async function loadCar(def, { paintColor, finish, detail = 1, rim, spoiler } = {}) {
  const urls = [detail < 1 && def.model?.raceUrl, def.model?.url].filter(Boolean);
  for (const url of urls) {
    const gltf = await fetchGltf(resolveUrl(url));
    if (!gltf) continue;
    try {
      return adaptGltf(gltf.scene, def, { paintColor, finish, rim, spoiler, url });
    } catch (err) {
      console.warn(`[models] ${url} does not follow the car conventions`, err);
    }
  }
  return createCar({ paintColor, finish, detail, style: def.procedural?.style, rim, spoiler });
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

function adaptGltf(source, def, { paintColor, finish, rim = 'stock', spoiler = 'factory', url }) {
  const opts = def.model;
  const car = new THREE.Group();
  car.name = def.id;

  // Inner group carries the normalisation (orientation, scale, centring), so the rig's own
  // root keeps an identity transform like the procedural car.
  const model = source.clone(true);
  const fit = new THREE.Group();
  fit.add(model);
  car.add(fit);
  if (opts.rotationY) model.rotation.y = opts.rotationY; // turn the nose to +X
  if (opts.scale) model.scale.multiplyScalar(opts.scale);
  car.updateMatrixWorld(true);

  // Scale to the catalog length, then centre on the wheelbase (or bounds) and ground it.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  if (!(size.x > 0)) throw new Error('model has no geometry');
  if (opts.length && !opts.scale) fit.scale.setScalar(opts.length / size.x);
  car.updateMatrixWorld(true);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  fit.position.set(-center.x, -box.min.y, -center.z);
  car.updateMatrixWorld(true);

  // Materials: one shared clear-coat paint replaces every paint material so the garage
  // paint shop works on the model; tail and head lenses get controllable emissives.
  const paint = createCarPaint(paintColor, finish);
  const head = new THREE.MeshStandardMaterial({ color: 0xdfe8ff, roughness: 0.1, emissive: 0xe8f0ff, emissiveIntensity: 0 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x400608, roughness: 0.15, emissive: 0xff1a1a, emissiveIntensity: 0.15 });
  tail.userData.tailLight = true;
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
  });
  if (!paintFound) console.warn(`[models] ${url}: no paint material found; paint changes will not show`);

  // Wheels: re-parent each wheel node under a pivot at its centre so it can spin about the
  // axle (z) and steer about y, exactly like the procedural wheels.
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

  // Aftermarket rims: the model's wheel comes out of the spinning group and a procedural
  // wheel of the same radius goes in; 'stock' puts the model's wheel back.
  const lod = /_race\.glb$/.test(url) ? 0.5 : 1;
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
    spoiler,
    setRim(id) {
      if (id === this.rim) return;
      this.rim = id;
      fitRim(id);
      wheelSpeed = Math.max(wheelSpeed, 10);
    },
    setSpoiler(id) {
      this.spoiler = id;
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
