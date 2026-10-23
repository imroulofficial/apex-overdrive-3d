import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SceneCulling } from '../src/render/culling.js';

// A 2 km field of small rocks and one merged "verge" mesh along the x axis.
function world() {
  const scene = new THREE.Scene();
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial(), 400);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 400; i++) rocks.setMatrixAt(i, m.makeTranslation(-1000 + (i % 40) * 50, 0, -100 + Math.floor(i / 40) * 20));
  rocks.computeBoundingSphere();
  scene.add(rocks);
  const strips = [];
  for (let x = -1000; x < 1000; x += 10) strips.push(new THREE.PlaneGeometry(10, 4, 6, 6).rotateX(-Math.PI / 2).translate(x + 5, 0, 30));
  const merged = new THREE.Mesh(mergeAll(strips), new THREE.MeshBasicMaterial());
  merged.name = 'verge';
  scene.add(merged);
  return { scene, rocks, merged };
}

function mergeAll(geos) {
  const pos = [];
  const index = [];
  for (const g of geos) {
    const base = pos.length / 3;
    pos.push(...g.attributes.position.array);
    index.push(...Array.from(g.index.array, (i) => i + base));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(index);
  return out;
}

const camera = () => {
  const cam = new THREE.PerspectiveCamera(64, 2, 0.3, 3200);
  cam.position.set(-900, 5, 0);
  cam.lookAt(-800, 5, 0); // looking along +x from the west end
  cam.updateMatrixWorld();
  return cam;
};

test('instanced scenery behind the camera or past its draw distance is not drawn', () => {
  const { scene, rocks } = world();
  const culling = new SceneCulling(scene);
  culling.update(camera());
  assert.ok(rocks.count > 0 && rocks.count < 120, `drew ${rocks.count} of 400 rocks`);
  // Every packed instance is a real one, in front of the camera and within reach.
  const p = new THREE.Vector3();
  const m = new THREE.Matrix4();
  for (let i = 0; i < rocks.count; i++) {
    p.setFromMatrixPosition(rocks.getMatrixAt(i, m));
    assert.ok(p.x > -1000 && p.x - -900 < 900, `rock at ${p.x}`);
  }
  // Facing away from the whole field: nothing at all (no draw call).
  const away = camera();
  away.position.set(-1400, 5, 0);
  away.lookAt(-1500, 5, 0);
  away.updateMatrixWorld();
  culling.update(away);
  assert.equal(rocks.visible, false);
  // Reflection bakes get every instance back.
  culling.restoreAll();
  assert.equal(rocks.count, 400);
});

test('big merged meshes become chunks that share the original buffers and keep every triangle', () => {
  const { scene, merged } = world();
  const before = merged.geometry.index.count;
  const position = merged.geometry.attributes.position;
  new SceneCulling(scene);
  const chunks = merged.children;
  assert.ok(chunks.length >= 2 && chunks.length <= 8, `${chunks.length} chunks`);
  assert.equal(chunks.reduce((n, c) => n + c.geometry.drawRange.count, 0), before);
  for (const c of chunks) {
    assert.equal(c.geometry.attributes.position, position);
    assert.equal(c.geometry.index, merged.geometry.index);
    assert.ok(c.geometry.boundingSphere.radius < merged.geometry.boundingSphere.radius);
  }
  // The original no longer draws itself (its chunks do), but keeps the whole geometry.
  assert.equal(merged.layers.test(new THREE.Camera().layers), false);
  assert.equal(merged.geometry.index.count, before);
});

test('a far LOD takes the distant cells', () => {
  const { scene, rocks } = world();
  rocks.userData.lod = { geometry: new THREE.TetrahedronGeometry(1), distance: 60 };
  const culling = new SceneCulling(scene);
  culling.update(camera());
  const far = scene.children.find((o) => o.name.endsWith('-far'));
  assert.ok(far, 'far batch added');
  assert.ok(rocks.count > 0 && far.count > 0, `near ${rocks.count}, far ${far.count}`);
  culling.dispose();
  assert.equal(far.parent, null);
});
