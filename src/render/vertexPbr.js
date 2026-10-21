import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// "Atlas" materials for batching: base colour, roughness, metalness and emissive strength
// live in vertex attributes instead of uniforms, so parts that would each need their own
// material (steel, paint, chrome, plastic, glowing lenses...) merge into one mesh and draw
// in a single call. Mobile GPUs are draw-call bound long before they are triangle bound.

// Bakes a flat material description into `geo` as vertex attributes (in place).
export function paintVertices(geo, { color = 0xffffff, roughness = 0.8, metalness = 0, emissive = 0 } = {}) {
  const c = color.isColor ? color : new THREE.Color(color);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const pbr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    pbr[i * 3] = roughness;
    pbr[i * 3 + 1] = metalness;
    pbr[i * 3 + 2] = emissive;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('pbr', new THREE.BufferAttribute(pbr, 3));
  return geo;
}

// Same, with per-vertex colours from a callback (x, y, z, out Color) for gradients and stripes.
export function paintVerticesBy(geo, colorAt, pbr = {}) {
  paintVertices(geo, { ...pbr, color: 0xffffff });
  const p = geo.attributes.position;
  const col = geo.attributes.color;
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    colorAt(p.getX(i), p.getY(i), p.getZ(i), c);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  return geo;
}

// Merges geometries that already carry color + pbr attributes (non-indexed or indexed mix).
export function mergePainted(geos) {
  const keep = ['position', 'normal', 'color', 'pbr'];
  const clean = geos.map((g) => {
    const out = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(out.attributes)) if (!keep.includes(name)) out.deleteAttribute(name);
    if (!out.attributes.normal) out.computeVertexNormals();
    return out;
  });
  return mergeGeometries(clean);
}

// Copy of a non-indexed geometry with reversed winding and normals: the back face of a
// thin or double-sided part, so it can join a single-sided batch.
export function backFace(geo) {
  const g = geo.clone();
  for (const attr of Object.values(g.attributes)) {
    const a = attr.array;
    const k = attr.itemSize;
    for (let t = 0; t < attr.count; t += 3) {
      for (let c = 0; c < k; c++) {
        const i1 = (t + 1) * k + c;
        const i2 = (t + 2) * k + c;
        [a[i1], a[i2]] = [a[i2], a[i1]];
      }
    }
  }
  const n = g.attributes.normal.array;
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
  return g;
}

// Both faces of a (possibly indexed) geometry as non-indexed geometries.
export function bothFaces(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  return [g, backFace(g)];
}

// Copies `geo` (non-indexed, painted) once per matrix into one geometry. Much faster than
// cloning + mergeGeometries for thousands of small parts (posts, lamps).
export function stamp(geo, matrices) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const names = Object.keys(src.attributes);
  const count = src.attributes.position.count;
  const out = new THREE.BufferGeometry();
  const arrays = {};
  for (const name of names) {
    const a = src.attributes[name];
    arrays[name] = new Float32Array(count * a.itemSize * matrices.length);
    out.setAttribute(name, new THREE.BufferAttribute(arrays[name], a.itemSize));
  }
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  matrices.forEach((m, k) => {
    nm.getNormalMatrix(m);
    for (const name of names) {
      const a = src.attributes[name];
      const dst = arrays[name];
      const base = k * count * a.itemSize;
      for (let i = 0; i < count; i++) {
        if (name === 'position' || name === 'normal') {
          v.fromBufferAttribute(a, i);
          if (name === 'position') v.applyMatrix4(m);
          else v.applyMatrix3(nm).normalize();
          dst[base + i * 3] = v.x;
          dst[base + i * 3 + 1] = v.y;
          dst[base + i * 3 + 2] = v.z;
        } else {
          for (let c = 0; c < a.itemSize; c++) dst[base + i * a.itemSize + c] = a.array[i * a.itemSize + c];
        }
      }
    }
  });
  return out;
}

// MeshStandardMaterial that reads colour / roughness / metalness / emissive from vertices.
// `options` are passed to the material (envMapIntensity, side, flatShading...).
export function createVertexPbrMaterial(options = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, emissive: 0xffffff, ...options });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 pbr;\nvarying vec3 vPbr;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPbr;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * vPbr.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * vPbr.y;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = diffuseColor.rgb * vPbr.z;');
  };
  mat.customProgramCacheKey = () => 'vertex-pbr';
  return mat;
}

// True when a material carries nothing but flat values, so it can be folded into an atlas mesh.
export function isFlatMaterial(mat) {
  if (!mat || mat.transparent || mat.isMeshPhysicalMaterial || mat.isShaderMaterial) return false;
  if (!(mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial || mat.isMeshBasicMaterial)) return false;
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap', 'bumpMap']) if (mat[k]) return false;
  return true;
}

// Flat material → paintVertices() description.
export function describeMaterial(mat) {
  const e = mat.emissive ? Math.max(mat.emissive.r, mat.emissive.g, mat.emissive.b) * (mat.emissiveIntensity ?? 1) : 0;
  return {
    color: mat.color ?? new THREE.Color(0xffffff),
    roughness: mat.roughness ?? 0.9,
    metalness: mat.metalness ?? 0,
    emissive: e,
  };
}
