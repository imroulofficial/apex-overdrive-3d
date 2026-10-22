import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import './dom-stub.js';
import { createSwapWheel } from '../src/garage/carModel.js';
import { RIMS } from '../src/data/catalog.js';
import { RIM_IDS } from '../src/garage/rims.js';
import { statsToParams, DEFAULT_FEEL } from '../src/race/vehicle.js';
import { BASE_STATS } from '../src/data/catalog.js';
import { CARS } from '../src/data/cars.js';

test('the six catalog rims all have 3D designs', () => {
  assert.deepEqual(RIMS.map((r) => r.id), RIM_IDS);
  assert.equal(RIM_IDS.length, 6);
});

test('aftermarket rims build at any tyre size, with a spinning and a still part', () => {
  for (const id of RIM_IDS.filter((r) => r !== 'stock')) {
    for (const radius of [0.3, 0.36]) {
      const w = createSwapWheel(id, 1, radius);
      let meshes = 0;
      w.spin.traverse((o) => o.isMesh && meshes++);
      assert.ok(meshes > 0, id);
      assert.ok(w.still.children.length > 0, id);
    }
  }
});

// The lofted procedural car bodies were removed in 0.14.0: every car is a real model now.
test('no procedural car bodies remain in the game code', () => {
  const src = path.resolve(import.meta.dirname, '../src');
  assert.ok(!fs.existsSync(path.join(src, 'garage/carShapes.js')));
  const files = fs.readdirSync(src, { recursive: true }).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const text = fs.readFileSync(path.join(src, f), 'utf8');
    assert.doesNotMatch(text, /\bcreateCar\(|carShapes|procedural\.style/, f);
  }
});

test('handling feel: the default reproduces the old tuning; weight and torque curves change it', () => {
  const legacy = statsToParams(BASE_STATS);
  const same = statsToParams(BASE_STATS, DEFAULT_FEEL);
  assert.deepEqual(same, legacy);
  assert.equal(legacy.power, 2);
  assert.equal(legacy.yawResponse, 10);
  const muscle = statsToParams(BASE_STATS, CARS.find((c) => c.id === 'sv-stallion').feel);
  const senna = statsToParams(BASE_STATS, CARS.find((c) => c.id === 'tm-tempesta').feel);
  // The heavy muscle car turns in slower but launches with its low-end torque and carries speed.
  assert.ok(muscle.yawResponse < legacy.yawResponse && muscle.steerRate < legacy.steerRate);
  assert.ok(muscle.launch > legacy.launch && muscle.momentum < 1);
  // The light track hypercar pulls to the limiter and grips harder.
  assert.ok(senna.power > 2.5 && senna.grip > legacy.grip && senna.driftGrip > legacy.driftGrip);
  // Torque curve: at 80% of top speed a high-power-exponent car still pulls much harder.
  const pull = (p) => 1 - 0.8 ** p.power;
  assert.ok(pull(senna) > pull(muscle) * 1.3);
});
