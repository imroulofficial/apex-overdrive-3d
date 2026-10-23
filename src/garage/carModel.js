import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildRim } from './rims.js';
import { createVertexPbrMaterial, describeMaterial, mergePainted, paintVertices } from '../render/vertexPbr.js';

// Aftermarket wheels for the real car models. Every car in the roster is an imported model
// (assets/modelLoader.js) that brings its own wheels as the 'stock' rim; the other five rim
// designs (rims.js) are built here at the model's tyre size: tyre, rim, brake disc and caliper.
// The car faces +X, so a wheel's axle is the z axis.

// Reference car dimensions for code that has no car at hand (camera shots before a model loads).
export const WHEEL_BASE = 1.3; // half wheelbase (x)
export const TRACK = 0.86; // half track width (z)
export const WHEEL_RADIUS = 0.34;
// Rims and tyres are modelled at this radius and scaled to each car's tyre.
const REF_RADIUS = 0.34;

// Level of detail for wheels on track (rival and player cars): keeps an imported race LOD
// with swapped rims under the 10,000-triangle budget (test/car-models.test.js).
export const RACE_DETAIL = 0.5;

function createMaterials() {
  return {
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.08, metalness: 1 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.92, metalness: 0 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.4, metalness: 0.9 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0x9a1020, roughness: 0.35, metalness: 0.2 }),
  };
}

// Merges sibling meshes that share a material and a name into one mesh per parent (a track
// wheel's tyre, spokes, lip and hub become a few meshes instead of dozens).
function mergeSiblings(root) {
  const parents = [];
  root.traverse((o) => {
    if (o.children.some((c) => c.isMesh)) parents.push(o);
  });
  for (const parent of parents) {
    const buckets = new Map();
    for (const child of parent.children) {
      if (!child.isMesh || child.children.length || Array.isArray(child.material) || child.name === 'beam') continue;
      const key = `${child.material.uuid}|${child.name}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(child);
    }
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const mat = meshes[0].material;
      const needsUv = ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'emissiveMap'].some((k) => mat[k]);
      const geos = meshes.map((mesh) => {
        mesh.updateMatrix();
        const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrix);
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!needsUv) g.deleteAttribute('uv');
        else if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        return g;
      });
      const merged = new THREE.Mesh(mergeGeometries(geos), mat);
      merged.name = meshes[0].name;
      merged.userData = { ...meshes[0].userData };
      merged.castShadow = meshes.some((m) => m.castShadow);
      merged.receiveShadow = meshes.some((m) => m.receiveShadow);
      for (const mesh of meshes) parent.remove(mesh);
      parent.add(merged);
    }
  }
}

function tireGeometry(segments = 40, corner = 6) {
  // Rounded tire cross-section revolved around the wheel axis.
  const pts = [];
  const inner = 0.235;
  const outer = REF_RADIUS;
  const half = 0.125;
  const r = 0.05;
  pts.push(new THREE.Vector2(inner, -half));
  for (let i = 0; i <= corner; i++) {
    const a = -Math.PI / 2 + (i / corner) * (Math.PI / 2);
    pts.push(new THREE.Vector2(outer - r + Math.cos(a) * r, -half + r + Math.sin(a) * r));
  }
  for (let i = 0; i <= corner; i++) {
    const a = (i / corner) * (Math.PI / 2);
    pts.push(new THREE.Vector2(outer - r + Math.cos(a) * r, half - r + Math.sin(a) * r));
  }
  pts.push(new THREE.Vector2(inner, half));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.rotateX(Math.PI / 2);
  return geo;
}

// A wheel is a still group (brake disc, caliper) and a spinning group (tyre and rim), both
// scaled from the reference size to the car's tyre radius.
function createWheel(m, side, sharedTire, rimId, scale, detail) {
  const wheel = new THREE.Group();
  const spin = new THREE.Group();
  spin.scale.setScalar(scale);
  wheel.add(spin);
  fillSpin(spin, m, side, sharedTire, rimId, detail);

  // Brake disc and caliper stay still while the wheel spins.
  const still = new THREE.Group();
  still.scale.setScalar(scale);
  wheel.add(still);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.025, Math.max(8, Math.round(32 * detail))), m.disc);
  disc.rotation.x = Math.PI / 2;
  disc.position.z = 0.02 * side;
  still.add(disc);
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.06), m.caliper);
  caliper.name = 'caliper';
  // Hidden behind the rim from most angles: left out of the showroom's floor mirror.
  disc.userData.noReflect = caliper.userData.noReflect = true;
  caliper.position.set(-0.11, 0.11, 0.045 * side);
  caliper.rotation.z = 0.8;
  still.add(caliper);

  return { wheel, spin, side };
}

function fillSpin(spin, m, side, sharedTire, rimId, detail) {
  const tire = new THREE.Mesh(sharedTire, m.tire);
  tire.castShadow = true;
  spin.add(tire);
  for (const part of buildRim(rimId, side, m.chrome, detail)) spin.add(part);
}

// An aftermarket wheel for an imported (.glb) car: the same tyre, rim, disc and caliper as a
// procedural wheel, scaled to `radius`. The loader puts `spin` in the model's spinning group
// in place of the model's own wheel and `still` in its steering pivot. In the showroom each
// group is folded into one vertex-PBR mesh (two draws a wheel); the race keeps plain
// materials so raceCars.js can batch the wheels itself.
let swapMaterials = null;
let swapAtlas = null;
export function createSwapWheel(rimId, side, radius, detail = 1) {
  swapMaterials ??= createMaterials();
  const res = Math.max(8, Math.round((40 * detail) / 4) * 4);
  const w = createWheel(swapMaterials, side, tireGeometry(res, detail < 1 ? 3 : 6), rimId, radius / REF_RADIUS, detail);
  const [spin, still] = w.wheel.children;
  if (detail < 1) mergeSiblings(spin);
  else {
    swapAtlas ??= createVertexPbrMaterial({ envMapIntensity: 1.3 });
    for (const group of [spin, still]) bakeToAtlas(group, swapAtlas);
  }
  // Like the model wheels they stand in for: out of the showroom floor mirror.
  w.wheel.traverse((o) => (o.userData.noReflect = true));
  return { spin, still };
}

// Replaces a group's meshes with one mesh in `atlas`, keeping the group's own transform.
function bakeToAtlas(group, atlas) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const geos = [];
  let shadow = false;
  group.traverse((o) => {
    if (!o.isMesh) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    geos.push(paintVertices(o.geometry.clone().applyMatrix4(m), describeMaterial(o.material)));
    shadow ||= o.castShadow;
  });
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => o.isMesh && o.geometry.dispose());
  }
  const mesh = new THREE.Mesh(mergePainted(geos), atlas);
  mesh.castShadow = shadow;
  group.add(mesh);
}
