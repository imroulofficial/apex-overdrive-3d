import * as THREE from 'three';

// Culling for a race world built as a few huge batches. Every forest, boulder field and
// building block on a track is one InstancedMesh or one merged Mesh spanning kilometres, so its
// bounding sphere always meets the camera frustum and the GPU draws all of it, behind the
// camera included (~600k triangles a frame on Emerald Coast). After the world is built:
//
//   Static instanced scenery (trees, rocks, boulders): instances are bucketed into CELL-metre
//   cells. Each frame the cells in front of the camera and within their draw distance are
//   packed into the front of the instance buffer; the batch still costs one draw call (none
//   when nothing is in view) and the buffer is only re-uploaded when the visible set changes.
//   A cell's draw distance is where its biggest instance shrinks under ~1.5 px (240x its
//   radius), capped where the fog has swallowed everything.
//
//   Distance LOD: a batch can carry `userData.lod = { geometry, distance }`, a lighter copy of
//   its geometry; cells beyond `distance` are packed into a sibling batch drawn with it.
//
//   Big merged meshes (track verges, villages, city blocks): triangles are regrouped by cell
//   into contiguous index ranges and drawn as chunk meshes (children of the original, so its
//   visibility still applies) that share the original vertex and index buffers. The original
//   moves to a layer no camera renders and keeps its full geometry (reflection bakes draw
//   it whole). Three.js frustum-culls each chunk on its own, in the main and shadow passes.
//
// Only meshes the culler can prove static are touched: instanced batches that still use
// three's frustum culling (every per-frame batch, like props, traffic and wheels, turns it off
// because it moves), and merged meshes with no transform of their own.

const CELL = 160; // metres
// Chunks cost a draw call each, so only heavy meshes are split, and coarsely: a few chunks in
// view instead of the whole mesh, most of it behind the camera.
const CHUNK_CELL = 480; // metres
const CHUNK_MIN_RADIUS = 300; // merged meshes smaller than this are left whole
const CHUNK_MIN_TRIS = 8000;
const CHUNK_MIN_TRIS_EACH = 4000;
const CHUNK_MAX = 8;
const PX_DISTANCE = 240; // draw distance per metre of radius (~1.5 px on a 450 px tall buffer)
const MIN_DISTANCE = 140;
const HIDDEN_LAYER = 31; // never enabled on a camera

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();

const cellKey = (x, z, size = CELL) => `${Math.floor(x / size)},${Math.floor(z / size)}`;

function isIdentity(m) {
  const e = m.elements;
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return e.every((v, i) => Math.abs(v - id[i]) < 1e-6);
}

function triangleCount(geo) {
  return (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
}

// One static InstancedMesh (plus its far-LOD sibling, if any) split into cells.
class CellBatch {
  constructor(mesh) {
    this.mesh = mesh;
    const n = mesh.count;
    this.total = n;
    this.matrices = mesh.instanceMatrix.array.slice(0, n * 16);
    this.colors = mesh.instanceColor ? mesh.instanceColor.array.slice(0, n * 3) : null;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const local = mesh.geometry.boundingSphere;
    const cells = new Map();
    for (let i = 0; i < n; i++) {
      _m.fromArray(this.matrices, i * 16).premultiply(mesh.matrixWorld).decompose(_p, _q, _s);
      const r = local.radius * Math.max(_s.x, _s.y, _s.z);
      const c = _sphere.center.copy(local.center).applyMatrix4(_m);
      const key = cellKey(c.x, c.z);
      let cell = cells.get(key);
      if (!cell) cells.set(key, (cell = { items: [], box: new THREE.Box3(), maxR: 0, sphere: new THREE.Sphere(), state: 0 }));
      cell.items.push(i);
      cell.box.expandByPoint(_p.copy(c).addScalar(r));
      cell.box.expandByPoint(_p.copy(c).addScalar(-r));
      cell.maxR = Math.max(cell.maxR, r);
    }
    this.cells = [...cells.values()];
    for (const cell of this.cells) {
      cell.box.getBoundingSphere(cell.sphere);
      cell.reach = Math.max(MIN_DISTANCE, cell.maxR * PX_DISTANCE);
    }
    const lod = mesh.userData.lod;
    this.far = null;
    if (lod?.geometry) {
      this.far = new THREE.InstancedMesh(lod.geometry, mesh.material, n);
      this.far.name = `${mesh.name || 'batch'}-far`;
      this.far.castShadow = mesh.castShadow;
      this.far.receiveShadow = mesh.receiveShadow;
      this.far.renderOrder = mesh.renderOrder;
      if (this.colors) this.far.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      this.far.frustumCulled = false;
      this.far.count = 0;
      this.far.position.copy(mesh.position);
      this.far.quaternion.copy(mesh.quaternion);
      this.far.scale.copy(mesh.scale);
      mesh.parent.add(this.far);
      this.lodDistance = lod.distance;
    }
    // Bounds are the visible cells', worked out here; three's own test would see the whole field.
    mesh.frustumCulled = false;
    this.dirty = true;
  }

  // state per cell: 0 hidden, 1 near (full detail), 2 far (LOD). Runs every frame, so it
  // allocates nothing: a changed cell marks the batch dirty instead of building a signature
  // string (a string per cell per batch per frame was ~100 KB of garbage a frame).
  update(cam, frustum, fogLimit) {
    let changed = this.dirty;
    for (const cell of this.cells) {
      const d = cam.distanceTo(cell.sphere.center) - cell.sphere.radius;
      let state = 0;
      if (d < Math.min(cell.reach, fogLimit) && frustum.intersectsSphere(cell.sphere)) state = this.far && d > this.lodDistance ? 2 : 1;
      if (state !== cell.state) changed = true;
      cell.state = state;
    }
    if (!changed) return;
    this.dirty = false;
    this.pack(this.mesh, 1);
    if (this.far) this.pack(this.far, 2);
  }

  pack(target, state) {
    const dst = target.instanceMatrix.array;
    const col = target.instanceColor?.array;
    let n = 0;
    for (const cell of this.cells) {
      if (cell.state !== state) continue;
      // Element copies: a subarray() view per instance would be garbage on every repack.
      const src = this.matrices;
      for (const i of cell.items) {
        const a = i * 16;
        const b = n * 16;
        for (let k = 0; k < 16; k++) dst[b + k] = src[a + k];
        if (col && this.colors) {
          col[n * 3] = this.colors[i * 3];
          col[n * 3 + 1] = this.colors[i * 3 + 1];
          col[n * 3 + 2] = this.colors[i * 3 + 2];
        }
        n++;
      }
    }
    target.count = n;
    target.visible = n > 0;
    // Only the packed front of the buffer goes to the GPU.
    target.instanceMatrix.clearUpdateRanges();
    target.instanceMatrix.addUpdateRange(0, n * 16);
    target.instanceMatrix.needsUpdate = true;
    if (col) {
      target.instanceColor.clearUpdateRanges();
      target.instanceColor.addUpdateRange(0, n * 3);
      target.instanceColor.needsUpdate = true;
    }
  }

  // Every instance back in the batch (reflection bakes copy the batch as it is).
  restore() {
    const m = this.mesh;
    m.instanceMatrix.array.set(this.matrices);
    if (this.colors) m.instanceColor.array.set(this.colors);
    m.count = this.total;
    m.visible = true;
    m.instanceMatrix.clearUpdateRanges();
    m.instanceMatrix.needsUpdate = true;
    if (this.colors) {
      m.instanceColor.clearUpdateRanges();
      m.instanceColor.needsUpdate = true;
    }
    if (this.far) {
      this.far.count = 0;
      this.far.visible = false;
    }
    this.dirty = true;
  }

  dispose() {
    if (!this.far) return;
    this.far.removeFromParent();
    this.far.geometry.dispose();
    this.far.dispose();
  }
}

// Regroups a merged mesh's triangles by cell and hangs one chunk mesh per cell under it.
function chunkMesh(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const index = geo.index ? geo.index.array : null;
  const triCount = triangleCount(geo);
  const vertex = (t, k) => (index ? index[t * 3 + k] : t * 3 + k);
  const cx = new Float32Array(triCount);
  const cz = new Float32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = vertex(t, k);
      cx[t] += pos.getX(v) / 3;
      cz[t] += pos.getZ(v) / 3;
    }
  }
  // Coarser cells until every chunk is worth its draw call (or there are only a few).
  let byCell;
  for (let size = CHUNK_CELL; ; size *= 1.5) {
    byCell = new Map();
    for (let t = 0; t < triCount; t++) {
      const key = cellKey(cx[t], cz[t], size);
      if (!byCell.has(key)) byCell.set(key, []);
      byCell.get(key).push(t);
    }
    if (byCell.size <= Math.min(CHUNK_MAX, triCount / CHUNK_MIN_TRIS_EACH)) break;
  }
  if (byCell.size < 2) return null;
  const big = pos.count > 65535;
  const order = new (big ? Uint32Array : Uint16Array)(triCount * 3);
  const ranges = [];
  let o = 0;
  for (const tris of byCell.values()) {
    const start = o;
    for (const t of tris) for (let k = 0; k < 3; k++) order[o++] = vertex(t, k);
    ranges.push([start, o - start]);
  }
  const sharedIndex = new THREE.BufferAttribute(order, 1);
  // The original keeps every triangle (same order as the chunks, same buffers).
  geo.setIndex(sharedIndex);
  const chunks = ranges.map(([start, count]) => {
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
    g.setIndex(sharedIndex);
    g.setDrawRange(start, count);
    const box = new THREE.Box3();
    for (let i = start; i < start + count; i++) box.expandByPoint(_p.fromBufferAttribute(pos, order[i]));
    g.boundingBox = box;
    g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const chunk = new THREE.Mesh(g, mesh.material);
    chunk.name = `${mesh.name || 'mesh'}-chunk`;
    chunk.castShadow = mesh.castShadow;
    chunk.receiveShadow = mesh.receiveShadow;
    chunk.renderOrder = mesh.renderOrder;
    chunk.layers.mask = mesh.layers.mask;
    chunk.onBeforeRender = mesh.onBeforeRender;
    return chunk;
  });
  // Layers are not inherited: the parent stops drawing, its chunks still do.
  mesh.layers.set(HIDDEN_LAYER);
  mesh.add(...chunks);
  return { mesh, chunks };
}

export class SceneCulling {
  constructor(scene) {
    this.scene = scene;
    this.batches = [];
    this.chunked = [];
    this.add(scene);
  }

  // Takes over the static batches and big merged meshes under `root` (built later parts of the
  // world, like a reversed road, are added the same way).
  add(root) {
    root.updateMatrixWorld(true);
    const instanced = [];
    const merged = [];
    root.traverse((o) => {
      if (o.isInstancedMesh) {
        if (o.frustumCulled && o.count >= 8 && !o.userData.noCull) instanced.push(o);
        return;
      }
      if (!o.isMesh || o.isSkinnedMesh || !o.frustumCulled || o.userData.noCull || o.children.length) return;
      const geo = o.geometry;
      if (Array.isArray(o.material) || geo.groups.length > 1 || Object.keys(geo.morphAttributes).length) return;
      if (triangleCount(geo) < CHUNK_MIN_TRIS || !isIdentity(o.matrixWorld)) return;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      if (geo.boundingSphere.radius < CHUNK_MIN_RADIUS) return;
      merged.push(o);
    });
    for (const m of instanced) this.batches.push(new CellBatch(m));
    for (const m of merged) {
      const c = chunkMesh(m);
      if (c) this.chunked.push(c);
    }
  }

  // Per frame, after the camera has moved.
  update(camera) {
    camera.updateMatrixWorld();
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    const fog = this.scene.fog;
    const fogLimit = fog?.isFogExp2 && fog.density > 0 ? 2.3 / fog.density : fog?.far ?? Infinity;
    const at = camera.getWorldPosition(_s);
    for (const b of this.batches) b.update(at, _frustum, fogLimit);
  }

  restoreAll() {
    for (const b of this.batches) b.restore();
  }

  // What is drawn now (QA): instances per batch, chunks in view.
  stats() {
    return {
      batches: this.batches.map((b) => ({ name: b.mesh.name, near: b.mesh.visible ? b.mesh.count : 0, far: b.far?.visible ? b.far.count : 0, total: b.total, cells: b.cells.length })),
      chunked: this.chunked.map((c) => ({ name: c.mesh.name, chunks: c.chunks.length })),
    };
  }

  dispose() {
    for (const b of this.batches) b.dispose();
    // Chunks share the original's buffers (freed once, whichever geometry goes first).
    for (const c of this.chunked) for (const ch of c.chunks) ch.geometry.dispose();
    this.batches = [];
    this.chunked = [];
  }
}
