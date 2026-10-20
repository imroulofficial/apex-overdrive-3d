import * as THREE from 'three';
import { FINISHES } from '../data/catalog.js';

// Procedural metallic-flake normal map: random per-texel normals give the sparkle
// under the clear coat that sells a real automotive paint.
function createFlakeNormalMap(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = Math.random() * 2 - 1;
    const y = Math.random() * 2 - 1;
    const z = 1.4;
    const len = Math.hypot(x, y, z);
    data[i * 4] = ((x / len) * 0.5 + 0.5) * 255;
    data[i * 4 + 1] = ((y / len) * 0.5 + 0.5) * 255;
    data[i * 4 + 2] = ((z / len) * 0.5 + 0.5) * 255;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function createCarPaint(color = '#c8102e', finish = 'metallic') {
  const material = new THREE.MeshPhysicalMaterial({
    color,
    normalMap: createFlakeNormalMap(),
    envMapIntensity: 1.25,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [180, 620],
  });
  applyFinish(material, color, finish);
  return material;
}

export function applyFinish(material, color, finish) {
  const f = FINISHES[finish] ?? FINISHES.metallic;
  material.color.set(color);
  material.metalness = f.metalness;
  material.roughness = f.roughness;
  material.clearcoat = f.clearcoat;
  material.clearcoatRoughness = f.clearcoatRoughness;
  material.iridescence = f.iridescence;
  material.normalScale.setScalar(f.flake);
  material.needsUpdate = true;
}

// Smoothly blends the paint toward a new color/finish (called each frame by the garage).
export class PaintTransition {
  constructor(material) {
    this.material = material;
    this.from = new THREE.Color();
    this.to = new THREE.Color();
    this.t = 1;
  }

  start(color, finish) {
    this.from.copy(this.material.color);
    applyFinish(this.material, color, finish);
    this.to.set(color);
    this.material.color.copy(this.from);
    this.t = 0;
  }

  update(dt) {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt * 2.5);
    const k = 1 - Math.pow(1 - this.t, 3);
    this.material.color.lerpColors(this.from, this.to, k);
  }
}
