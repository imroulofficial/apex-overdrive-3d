import { test } from 'node:test';
import assert from 'node:assert/strict';
import './dom-stub.js';
import { createCar, RACE_DETAIL } from '../src/garage/carModel.js';
import { STYLES, shapeFor } from '../src/garage/carShapes.js';
import { RIMS, SPOILERS } from '../src/data/catalog.js';
import { RIM_IDS } from '../src/garage/rims.js';
import { statsToParams, DEFAULT_FEEL } from '../src/race/vehicle.js';
import { BASE_STATS } from '../src/data/catalog.js';
import { CARS } from '../src/data/cars.js';

const paint = { paintColor: '#c8102e', finish: 'metallic' };

// Triangles the race bakes from a car (the 'skip' cockpit and the light beams never go in).
function raceTriangles(rig) {
  let n = 0;
  rig.group.traverse((o) => {
    if (!o.isMesh || o.name === 'beam') return;
    if ([].concat(o.material).every((m) => m.name === 'skip')) return;
    const g = o.geometry;
    n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return n;
}

test('every race mesh stays under the 10,000-triangle mobile budget', () => {
  for (const style of Object.keys(STYLES)) {
    for (const rim of RIM_IDS) {
      for (const spoiler of ['factory', 'swan-neck']) {
        const tris = raceTriangles(createCar({ ...paint, style, rim, spoiler, detail: RACE_DETAIL }));
        assert.ok(tris < 10000, `${style} / ${rim} / ${spoiler}: ${tris}`);
      }
    }
  }
});

test('the six catalog rims all have 3D designs', () => {
  assert.deepEqual(RIMS.map((r) => r.id), RIM_IDS);
  assert.equal(RIM_IDS.length, 6);
});

test('rims and wings swap in place on the turntable car', () => {
  const car = createCar({ ...paint, style: 'gt3' });
  const meshesIn = (root) => {
    let n = 0;
    root.traverse((o) => o.isMesh && n++);
    return n;
  };
  assert.equal(car.rim, 'stock');
  const before = car.wheels[0].spin.children.map((o) => o.geometry.uuid).join();
  car.setRim('turbofan');
  assert.equal(car.rim, 'turbofan');
  assert.notEqual(car.wheels[0].spin.children.map((o) => o.geometry.uuid).join(), before);
  for (const w of car.wheels) w.spin.traverse((o) => o.isMesh && assert.ok(o.userData.wheelIndex >= 0));

  const wing = () => car.group.children.find((o) => o.name === 'spoiler');
  assert.ok(meshesIn(wing()) > 0, 'the GT3 has a factory wing');
  for (const s of SPOILERS) {
    car.setSpoiler(s.id);
    assert.equal(car.spoiler, s.id);
    assert.equal(car.group.children.filter((o) => o.name === 'spoiler').length, 1);
    assert.ok(meshesIn(wing()) > 0, s.id);
  }
  // A style without a factory wing has an empty mount.
  assert.equal(meshesIn(createCar({ ...paint, style: 'coupe' }).group.children.find((o) => o.name === 'spoiler')), 0);
});

test('every car has a driver door that opens on its hinge and shuts again', () => {
  for (const style of Object.keys(STYLES)) {
    const car = createCar({ ...paint, style });
    const door = car.group.getObjectByName('door');
    assert.ok(door?.children.length >= 3, style);
    assert.ok(car.door.anchor.z > 0.5, `${style}: hotspot on the +z side`);
    assert.equal(car.door.toggle(), true);
    for (let i = 0; i < 120; i++) car.update(1 / 30);
    const angle = Math.max(Math.abs(door.rotation.x), Math.abs(door.rotation.y), Math.abs(door.rotation.z));
    assert.ok(angle > 0.9, `${style} opened to ${angle}`);
    car.door.close();
    for (let i = 0; i < 150; i++) car.update(1 / 30);
    assert.ok(Math.abs(door.rotation.y) + Math.abs(door.rotation.z) < 0.01, `${style} shut`);
  }
  assert.equal(shapeFor('wedge').door.type, 'scissor');
  assert.equal(shapeFor('senna').door.type, 'butterfly');
});

test('body styles differ in proportions', () => {
  const dims = (id) => {
    const s = shapeFor(id);
    return [s.length, s.width, s.wheelBase, s.ride, s.cabin.roof, s.hood, s.deck].map((v) => v.toFixed(2)).join();
  };
  const styles = Object.keys(STYLES).filter((id) => id !== 'hyper');
  assert.equal(new Set(styles.map(dims)).size, styles.length);
  assert.ok(shapeFor('rally').ride > 0.1 && shapeFor('rally').wheel > shapeFor('coupe').wheel);
  assert.ok(shapeFor('senna').cabin.roof < shapeFor('hatch').cabin.roof);
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
