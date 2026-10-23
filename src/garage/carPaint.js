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
    envMapIntensity: 1.5,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [180, 620],
  });
  applyFinish(material, color, finish);
  return material;
}

// Paint over a model's own baked livery (cars whose paint shell carries the colour texture,
// see tools/models/segment.mjs). The shell's texture, or its vertex colours on the rival LOD,
// becomes a shading layer: panel gaps, vents and baked occlusion keep showing under any paint
// colour (texel luminance / the factory paint's luminance), and the Factory Livery finish
// (uFactory = 1) shows the texture's own colours. `source` is 'map' or 'vertex'.
export function liveryPaint(material, { factoryLum = 0.5, source = 'map' } = {}) {
  const uniforms = { uFactory: { value: 0 }, uFactoryLum: { value: Math.max(0.02, factoryLum) } };
  material.userData.livery = uniforms;
  material.userData.uniforms = { ...material.userData.uniforms, ...uniforms };
  const chunk = source === 'map' ? '#include <map_fragment>' : '#include <color_fragment>';
  const read = source === 'map' ? 'texture2D( map, vMapUv ).rgb' : 'vColor.rgb';
  const guard = source === 'map' ? 'USE_MAP' : 'USE_COLOR';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFactory;\nuniform float uFactoryLum;')
      .replace(
        chunk,
        `#ifdef ${guard}
	vec3 livery = ${read};
	float liveryShade = clamp( dot( livery, vec3( 0.2126, 0.7152, 0.0722 ) ) / uFactoryLum, 0.0, 1.6 );
	diffuseColor.rgb = mix( diffuseColor.rgb * liveryShade, livery, uFactory );
#endif`
      );
  };
  material.customProgramCacheKey = () => `livery-${source}`;
  material.needsUpdate = true;
  return material;
}

export function applyFinish(material, color, finish) {
  const f = FINISHES[finish] ?? FINISHES.metallic;
  if (material.userData.livery) material.userData.livery.uFactory.value = f.factory ? 1 : 0;
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
    this.factoryFrom = this.material.userData.livery?.uFactory.value ?? 0;
    applyFinish(this.material, color, finish);
    this.factoryTo = this.material.userData.livery?.uFactory.value ?? 0;
    this.to.set(color);
    this.material.color.copy(this.from);
    this.t = 0;
  }

  update(dt) {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt * 2.5);
    const k = 1 - Math.pow(1 - this.t, 3);
    this.material.color.lerpColors(this.from, this.to, k);
    if (this.material.userData.livery) this.material.userData.livery.uFactory.value = this.factoryFrom + (this.factoryTo - this.factoryFrom) * k;
  }
}
