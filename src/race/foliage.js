import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';
import { FRONDS } from '../render/envAssets.js';

// Textured vegetation for the Emerald Coast, built from the photographic CC0 assets in
// render/envAssets.js: scanned bark on the trunks and alpha-tested frond cards cut from one
// shared atlas (a scanned fern) for redwood sprays, palm leaves and ferns. All foliage shares
// one material, so each species costs one draw call for its trunks and one for its leaves.
//
// Geometries carry position, normal, uv and colour (baked shading and tint); trees have two
// groups: 0 = trunk (bark), 1 = foliage (fronds).

export function foliageMaterials(env) {
  const { redwoodBark, palmBark, fronds } = env.tex;
  if (!redwoodBark || !palmBark || !fronds) return null;
  const bark = (map) => new THREE.MeshLambertMaterial({ map, vertexColors: true });
  return {
    redwoodBark: bark(redwoodBark),
    palmBark: bark(palmBark),
    fronds: frondMaterial(fronds),
  };
}

// Alpha-tested rather than blended: no sorting, and cut-outs write depth. Mipmapping averages
// the thin leaflets away into the background, so a distant crown would thin out to nothing;
// the alpha is boosted with the mip level (from the uv derivatives) to keep it solid.
function frondMaterial(map) {
  const mat = new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      // Both faces of a card use its (crown-shaped) normal; the default flip for back faces
      // would leave every card seen from its back side in shadow.
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
      .replace(
      '#include <alphatest_fragment>',
      `vec2 frondTexel = vMapUv * 512.0;
      float frondLod = max(0.0, 0.5 * log2(max(dot(dFdx(frondTexel), dFdx(frondTexel)), dot(dFdy(frondTexel), dFdy(frondTexel)))));
      diffuseColor.a *= 1.0 + frondLod * 0.45;
      #include <alphatest_fragment>`
      );
  };
  mat.customProgramCacheKey = () => 'fronds';
  return mat;
}

const keep = (g) => {
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
  return g.index ? g.toNonIndexed() : g;
};

// A bark-mapped trunk: `around` texture repeats around it, one repeat every `tileM` up it.
function trunk(geo, height, { around, tileM, shade }) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * (height / tileM));
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = shade(p.getY(i));
    col.set([k, k, k], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return keep(geo);
}

// One frond card bent along its length. `path(t)` gives the spine point at t in 0..1 (stem to
// tip), `side` the unit vector across the card, `width` its full width in metres.
function frondCard(path, side, width, frond, tint, segments = 3) {
  const [u0, v0, u1, v1] = frond;
  const pos = [];
  const uv = [];
  const col = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    path(t, p);
    // Fronds taper; keep a little width at the tip so the cut-out does the shaping.
    const w = width * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, t * 1.2 + 0.1)));
    for (const s of [-0.5, 0.5]) {
      pos.push(p.x + side.x * w * s, p.y + side.y * w * s, p.z + side.z * w * s);
      uv.push(s < 0 ? u0 : u1, v1 + (v0 - v1) * t);
      // Darker toward the stem, where the crown shades itself.
      const k = 0.7 + 0.3 * t;
      col.push(tint.r * k, tint.g * k, tint.b * k);
    }
  }
  const index = [];
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // Light the cards like the crown they belong to (facing up/out), not by their own facing,
  // so both sides of a double-sided card shade the same.
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    const x = pos[i * 3] * 0.35;
    const z = pos[i * 3 + 2] * 0.35;
    const v = new THREE.Vector3(x, 1, z).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return g.toNonIndexed();
}

function twoGroups(bark, leaves) {
  return mergeGeometries([mergeGeometries(bark), mergeGeometries(leaves)], true);
}

// Coast redwood: a tall fluted trunk and a narrow crown of drooping sprays in tiers. Each
// tier has a ring of near-flat sprays (seen from below and above) and a ring of steeper ones
// (seen from the road), so the crown reads as a solid mass from any angle.
export function redwoodGeometry() {
  const rand = mulberry32(57);
  const height = 27;
  const stem = new THREE.CylinderGeometry(0.32, 0.95, height, 9, 5).translate(0, height / 2, 0);
  const bark = [trunk(stem, height, { around: 3, tileM: 2.6, shade: (y) => 0.55 + Math.min(1, y / 8) * 0.45 })];
  const leaves = [];
  const tint = new THREE.Color(0.4, 0.6, 0.46);
  const tiers = 8;
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1);
    const y = 9 + k * 18 + (rand() - 0.5) * 1.2;
    const reach = (3.8 - k * 2.6) * (0.85 + rand() * 0.3);
    const cards = 6 - Math.round(k * 2);
    const rot = rand() * Math.PI * 2;
    const c = tint.clone().multiplyScalar(0.72 + k * 0.4);
    for (let i = 0; i < cards * 2; i++) {
      const steep = i >= cards;
      const a = rot + (i / cards) * Math.PI * 2 + (steep ? Math.PI / cards : 0) + (rand() - 0.5) * 0.4;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const len = reach * (steep ? 0.75 : 1) * (0.85 + rand() * 0.3);
      const droop = (steep ? 1.6 : 0.9) + rand() * 0.8;
      const lift = 0.3 + rand() * 0.3;
      const roll = steep ? 1.25 + (rand() - 0.5) * 0.4 : (rand() - 0.5) * 0.7;
      const side = new THREE.Vector3(-dir.z, 0, dir.x).applyAxisAngle(dir, roll);
      leaves.push(
        frondCard(
          (s, out) => out.set(dir.x * len * s, y + lift * s - droop * s * s, dir.z * len * s).addScaledVector(dir, 0.2),
          side,
          1.7 + len * 0.35,
          FRONDS[(t + i) % FRONDS.length],
          c.clone().multiplyScalar(steep ? 0.9 : 1),
          2
        )
      );
    }
  }
  // Leader at the top: crossed upright sprays.
  for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
    const sideV = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    leaves.push(frondCard((s, out) => out.set(0, 25.5 + s * 4.5, 0), sideV, 1.5, FRONDS[1], tint.clone().multiplyScalar(1.1)));
  }
  return twoGroups(bark, leaves);
}

// Coastal palm: a leaning ringed trunk and an arching crown of feather-leaf fronds.
export function palmGeometry() {
  const rand = mulberry32(91);
  const stem = new THREE.CylinderGeometry(0.16, 0.28, 8, 7, 8).translate(0, 4, 0);
  const tp = stem.attributes.position;
  const lean = (y) => (y / 8) ** 2 * 1.2;
  for (let i = 0; i < tp.count; i++) tp.setX(i, tp.getX(i) + lean(tp.getY(i)));
  stem.computeVertexNormals();
  const bark = [trunk(stem, 8, { around: 1, tileM: 1.3, shade: (y) => 0.7 + Math.min(1, y / 6) * 0.3 })];
  const leaves = [];
  const tint = new THREE.Color(0.7, 0.92, 0.58);
  const top = new THREE.Vector3(lean(8), 7.95, 0);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rand() * 0.3;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const len = 3.6 + rand() * 1.2;
    const rise = 0.6 + rand() * 0.8;
    const fall = 2.2 + rand() * 1.2;
    const side = new THREE.Vector3(-dir.z, 0.15, dir.x).normalize();
    leaves.push(
      frondCard(
        (s, out) => out.copy(top).addScaledVector(dir, len * s).setY(top.y + rise * s * 2 - fall * s * s),
        side,
        1.4,
        FRONDS[i % FRONDS.length],
        tint.clone().multiplyScalar(0.85 + rand() * 0.3),
        5
      )
    );
  }
  return twoGroups(bark, leaves);
}

// A fern clump: fronds springing from one crown, arching up and out. One group (fronds).
export function fernGeometry() {
  const rand = mulberry32(73);
  const parts = [];
  const tint = new THREE.Color(0.72, 0.95, 0.66);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.5;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const len = 1 + rand() * 0.5;
    const up = 0.7 + rand() * 0.4;
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    parts.push(
      frondCard(
        (s, out) => out.set(dir.x * len * s, up * s * 1.6 - up * s * s * 1.1, dir.z * len * s),
        side,
        0.42,
        FRONDS[i % FRONDS.length],
        tint.clone().multiplyScalar(0.8 + rand() * 0.35)
      )
    );
  }
  return mergeGeometries(parts);
}

// Instances drawn only near the camera (small props that would be sub-pixel further out).
// The visible set is re-packed when the camera has moved a few metres, not every frame.
export class NearInstances {
  constructor(mesh, transforms, radius, toMatrix = matrixFor) {
    this.mesh = mesh;
    this.radius2 = radius * radius;
    this.items = transforms.map((t) => ({ x: t.x, z: t.z, m: toMatrix(t) }));
    this.last = new THREE.Vector3(1e9, 0, 0);
    mesh.count = 0;
    // The set changes as the camera moves; cull per mesh against the whole area instead.
    mesh.frustumCulled = false;
  }

  update(at) {
    if ((at.x - this.last.x) ** 2 + (at.z - this.last.z) ** 2 < 36) return;
    this.last.copy(at);
    let n = 0;
    for (const it of this.items) {
      if ((it.x - at.x) ** 2 + (it.z - at.z) ** 2 > this.radius2) continue;
      this.mesh.setMatrixAt(n++, it.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const q = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
function matrixFor(t) {
  q.setFromAxisAngle(up, t.rot);
  return new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.scale, t.scale * (t.stretch ?? 1), t.scale));
}
