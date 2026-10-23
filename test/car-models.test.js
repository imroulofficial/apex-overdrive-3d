// The real car models in public/assets/models/: one manifest entry per roster car, credited,
// licensed for a commercial app, phone-sized, within the triangle budgets and following the
// loader conventions (four wheel nodes, a paint material).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import './dom-stub.js';
import { CARS } from '../src/data/cars.js';
import { createSwapWheel, RACE_DETAIL } from '../src/garage/carModel.js';
import { RIM_IDS } from '../src/garage/rims.js';

const dir = path.resolve(import.meta.dirname, '../public');
const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../tools/models/manifest.json'), 'utf8'));
const credits = fs.readFileSync(path.join(dir, 'assets/models/CREDITS.md'), 'utf8');

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const triangles = (doc) =>
  doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices() ?? p.getAttribute('POSITION')).getCount() / 3, 0), 0);

test('every roster car is a manifest model and every manifest model is a roster car', () => {
  assert.deepEqual(manifest.cars.map((e) => e.id).sort(), CARS.map((c) => c.id).sort());
  for (const car of CARS) {
    assert.equal(car.model.raceUrl, car.model.url.replace(/\.glb$/, '_race.glb'), car.id);
    assert.equal(car.model.driveUrl, car.model.url.replace(/\.glb$/, '_drive.glb'), car.id);
  }
});

test('imported models are credited, phone-sized and within the triangle budgets', async () => {
  for (const entry of manifest.cars) {
    const car = CARS.find((c) => c.id === entry.id);
    assert.ok(car, `${entry.id} is a roster car`);
    assert.ok(credits.includes(entry.source), `${entry.id} is in CREDITS.md`);
    // A non-commercial or no-derivatives licence is only acceptable with a studio-held grant
    // (`commercialRights`, recorded in CREDITS.md).
    if (!entry.commercialRights) assert.doesNotMatch(entry.license, /-NC|-ND/, `${entry.id} licence allows commercial use`);
    else assert.match(entry.license, /Commercial rights held by Red Pen Studio|owned by Red Pen Studio/, entry.id);
    // Showroom: up to 150k triangles; the player's track model 60k; rivals under 10k.
    for (const [url, maxTris, maxMb] of [[car.model.url, 150000, 10], [car.model.driveUrl, 60000, 3], [car.model.raceUrl, 10000, 0.5]]) {
      const file = path.join(dir, url);
      assert.ok(fs.statSync(file).size < maxMb * 1e6, `${url} under ${maxMb} MB`);
      const doc = await io.read(file);
      assert.ok(triangles(doc) < maxTris, `${url}: ${triangles(doc)} triangles`);
      const names = doc.getRoot().listNodes().map((n) => n.getName());
      for (const w of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']) assert.ok(names.includes(w), `${url} has ${w}`);
      assert.ok(doc.getRoot().listMaterials().some((m) => /paint/i.test(m.getName())), `${url} has a paint material`);
    }
  }
});

// Aftermarket rims on an imported car replace the model's four wheels with procedural ones.
test('imported race LODs stay under 10,000 triangles with every rim', async () => {
  const meshTris = (root) => {
    let n = 0;
    root.traverse((o) => o.isMesh && (n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3));
    return n;
  };
  const swap = Math.max(...RIM_IDS.filter((id) => id !== 'stock').map((id) => {
    const w = createSwapWheel(id, 1, 0.34, RACE_DETAIL);
    return meshTris(w.spin) + meshTris(w.still);
  }));
  for (const entry of manifest.cars) {
    const car = CARS.find((c) => c.id === entry.id);
    const doc = await io.read(path.join(dir, car.model.raceUrl));
    let wheelTris = 0;
    for (const node of doc.getRoot().listNodes().filter((n) => /^wheel_/.test(n.getName()))) {
      node.traverse((n) => {
        for (const p of n.getMesh()?.listPrimitives() ?? []) wheelTris += (p.getIndices() ?? p.getAttribute('POSITION')).getCount() / 3;
      });
    }
    const tris = triangles(doc) - wheelTris + 4 * swap;
    assert.ok(tris < 10000, `${entry.id} with procedural rims: ${tris}`);
  }
});
