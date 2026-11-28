// versionCode 75: the eight Blender cars in the game. The model loader's wheel rig (pivots on
// the axle, per-axle rolling radius, uprights that steer but never spin, the steering wheel),
// the lamp patterns, factory colours, glass; the race bake (rival batching, the player's cabin
// parts); each car's own cockpit (eye, hidden nodes, dark tinted mirror glass, moving wheel and
// hands); v76: no window button (windows always closed) and no live mirror; the cockpit
// effects; and that every save keeps what it owns.
import './dom-stub.js';

globalThis.self ??= globalThis; // GLTFLoader looks for self.URL
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { CARS } from '../src/data/cars.js';
import { PAINTS, RIMS } from '../src/data/catalog.js';
import { loadCar, loadCarCockpit, HEAD_PATTERN, TAIL_PATTERN, readMeta, factoryColorOf } from '../src/assets/modelLoader.js';
import { CarFactory, DEFAULT_HIDE_IN_COCKPIT, PLAYER_FRONT, FRONT_DRAW } from '../src/race/raceCars.js';
import { CarCockpit, dialKind, dialValue } from '../src/race/carCockpit.js';
import { cockpitTier } from '../src/race/cockpitAsset.js';
import { Particles } from '../src/race/effects.js';
import { createCarPaint, shownPaintColor, applyFinish } from '../src/garage/carPaint.js';
import { migrate, normalize, SAVE_VERSION } from '../src/core/saveSchema.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const PUBLIC = new URL('../public/', import.meta.url);

// The loader fetches './assets/models/…' (Vite's base); here that is the public folder.
globalThis.fetch = async (url) => {
  const buf = await readFile(new URL(String(url).replace(/^\.\//, ''), PUBLIC));
  return {
    ok: true,
    headers: { get: () => 'model/gltf-binary' },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};

// Textures cannot decode in node ("Couldn't load texture"): geometry, names, transforms,
// materials and extras are real.
async function quiet(fn) {
  const [err, warn] = [console.error, console.warn];
  console.error = console.warn = () => {};
  try {
    return await fn();
  } finally {
    [console.error, console.warn] = [err, warn];
  }
}

const rigs = {};
const cockpits = {};
const lowCockpits = {};
for (const car of CARS) {
  rigs[car.id] = {};
  for (const lod of ['garage', 'drive', 'race']) rigs[car.id][lod] = await quiet(() => loadCar(car, { paintColor: '#c8102e', finish: 'metallic', lod }));
  cockpits[car.id] = await quiet(() => loadCarCockpit(car));
  lowCockpits[car.id] = await quiet(() => loadCarCockpit(car, { tier: 'low' }));
}
const DRIVE = (id) => rigs[id].drive;
const box = (o) => new THREE.Box3().setFromObject(o, true);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('every car loads all three LODs and its own cockpit, with the design data', () => {
  for (const car of CARS) {
    for (const lod of ['garage', 'drive', 'race']) {
      const rig = rigs[car.id][lod];
      assert.equal(rig.source, 'gltf', `${car.id} ${lod}`);
      assert.equal(rig.meta?.id, car.id, `${car.id} ${lod} carries extras.apex`);
      assert.equal(rig.wheels.length, 4);
    }
    assert.ok(cockpits[car.id], `${car.id} has a cockpit file`);
    assert.equal(car.model.cockpitUrl, car.model.url.replace(/\.glb$/, '_cockpit.glb'));
    assert.equal(cockpits[car.id].meta.id, car.id);
    assert.equal(cockpits[car.id].meta.eye.length, 3);
  }
});

test('the car list is the v74 list: ids, names, tiers, stats, prices and unlocks unchanged', async () => {
  const v74 = JSON.parse(await read('./fixtures/cars-v74.json'));
  const now = JSON.parse(JSON.stringify(CARS.map(({ model, ...c }) => ({ ...c, model: { url: model.url, driveUrl: model.driveUrl, raceUrl: model.raceUrl, length: model.length } }))));
  assert.deepEqual(now, v74);
});

test('wheels pivot on the axle: a spinning tyre stays where it is, at its own radius above the road', () => {
  for (const car of CARS) {
    for (const lod of ['garage', 'drive', 'race']) {
      const rig = rigs[car.id][lod];
      rig.group.updateMatrixWorld(true);
      for (const [i, w] of rig.wheels.entries()) {
        const tyre = box(w.stock);
        const before = tyre.getCenter(new THREE.Vector3());
        w.spin.rotation.z = Math.PI / 2;
        rig.group.updateMatrixWorld(true);
        const after = box(w.stock).getCenter(new THREE.Vector3());
        w.spin.rotation.z = 0;
        rig.group.updateMatrixWorld(true);
        // A rim offset or lettering puts the bounds' centre a little off the axle; a pivot off
        // the axle swings the whole wheel by that offset times 1.4.
        assert.ok(before.distanceTo(after) < 0.012, `${car.id} ${lod} wheel ${i}: ${before.distanceTo(after).toFixed(4)} m`);
        // The pivot is at axle height: the tyre's radius above the ground (y = 0).
        near(w.wheel.position.y, w.radius, 0.025, `${car.id} ${lod} wheel ${i} axle height`);
      }
      // Front pair ahead of the rear pair by the wheelbase.
      const scale = rig.modelMatrix.getMaxScaleOnAxis();
      near(rig.wheels[0].wheel.position.x - rig.wheels[2].wheel.position.x, rig.meta.wheelbase * scale, 0.02, `${car.id} ${lod} wheelbase`);
    }
  }
});

test('per-axle rolling radius from extras.apex.wheelRadius: each axle spins at its own rate', () => {
  for (const car of CARS) {
    const rig = rigs[car.id].garage;
    const scale = rig.modelMatrix.getMaxScaleOnAxis();
    const { front, rear } = rig.meta.wheelRadius;
    near(rig.wheels[0].radius, front * scale, 1e-6, `${car.id} front radius`);
    near(rig.wheels[2].radius, rear * scale, 1e-6, `${car.id} rear radius`);
    // Garage turntable roll.
    const z0 = rig.wheels.map((w) => w.spin.rotation.z);
    rig.spinWheels(10);
    rig.update(0.05);
    const d = rig.wheels.map((w, i) => w.spin.rotation.z - z0[i]);
    near(d[2] / d[0], front / rear, 1e-6, `${car.id} rear/front spin`);
    // On track (CarVisual): the ground speed over each wheel's own radius.
    const f = new CarFactory(DRIVE(car.id));
    const v = f.build({ player: true });
    const vz0 = v.wheels.map((w) => w.spin.rotation.z);
    v.update({ pos: new THREE.Vector3(), heading: 0, pitch: 0, forward: 20, yawRate: 0, airborne: false, drifting: false }, 0.1, 0);
    const dv = v.wheels.map((w, i) => w.spin.rotation.z - vz0[i]);
    near(dv[0], (-20 * 0.1) / v.wheels[0].radius, 1e-9, `${car.id} track front spin`);
    near(dv[2], (-20 * 0.1) / v.wheels[2].radius, 1e-9, `${car.id} track rear spin`);
    v.dispose();
    f.dispose();
  }
});

test('calipers, discs and uprights steer with the wheel and never spin', () => {
  for (const car of CARS) {
    const rig = rigs[car.id].garage;
    for (const [i, w] of rig.wheels.entries()) {
      assert.ok(w.still, `${car.id} wheel ${i} has its upright`);
      assert.equal(w.still.parent, w.wheel, 'on the steering pivot');
      let inSpin = false;
      w.spin.traverse((o) => o.userData.still && (inSpin = true));
      assert.ok(!inSpin, 'not in the spinning group');
      rig.group.updateMatrixWorld(true);
      const at = w.still.children[0].getWorldPosition(new THREE.Vector3());
      w.spin.rotation.z += 1.3;
      rig.group.updateMatrixWorld(true);
      assert.ok(w.still.children[0].getWorldPosition(new THREE.Vector3()).distanceTo(at) < 1e-9, 'spinning leaves it');
      w.spin.rotation.z -= 1.3;
    }
    // Player on track: the upright is baked onto the wheel pivot (steers), not its spin group.
    const f = new CarFactory(DRIVE(car.id));
    const p = f.build({ player: true });
    // (Medium/high: merged into the car's one atlas draw, following the wheel pivot as a part.)
    const merged = p.root.children.find((c) => c.name === 'parts-atlas');
    assert.ok(merged, `${car.id}: player's atlas parts merged into one draw`);
    for (const w of p.wheels) {
      assert.ok(merged.userData.partGroups.includes(w.wheel), `${car.id}: still parts follow the steering pivot`);
      // (Node decodes no textures, so its wheels are flat and batch instead.)
      if (!f.wheelBatches.length) assert.ok(merged.userData.partGroups.includes(w.spin), `${car.id}: rim and tyre follow the spin group`);
    }
    const idx = merged.geometry.attributes.part;
    assert.ok(idx && new Set(idx.array).size === merged.userData.partGroups.length, 'every part has triangles');
    p.dispose();
    f.dispose();
  }
});

test('aftermarket rims take the upright out and put it back with the stock wheel', () => {
  const rim = RIMS.find((r) => r.id !== 'stock').id;
  for (const car of CARS) {
    const rig = rigs[car.id].drive;
    rig.setRim(rim);
    for (const w of rig.wheels) {
      assert.equal(w.still.parent, null);
      assert.equal(w.stock.parent, null);
      assert.ok(w.swap, `${car.id}: swap wheel fitted`);
    }
    rig.setRim('stock');
    for (const w of rig.wheels) {
      assert.equal(w.still.parent, w.wheel);
      assert.equal(w.stock.parent, w.spin);
      assert.equal(w.swap, null);
    }
  }
});

test('lamp lenses: headlight_lens and taillight_lens glow with the lights and brakes', () => {
  for (const name of ['headlight_lens', 'Headlight Lens', 'headlight', 'head_lamp']) assert.match(name, HEAD_PATTERN);
  for (const name of ['taillight_lens', 'tail_light', 'brake_light', 'rain_light']) assert.match(name, TAIL_PATTERN);
  assert.doesNotMatch('window_L', HEAD_PATTERN);
  assert.doesNotMatch('glass', TAIL_PATTERN);
  for (const car of CARS) {
    for (const lod of ['garage', 'drive', 'race']) {
      const kinds = { head: 0, tail: 0 };
      rigs[car.id][lod].group.traverse((o) => {
        if (!o.isMesh) return;
        if (o.material.userData.headLight) kinds.head++;
        if (o.material.userData.tailLight) kinds.tail++;
      });
      assert.ok(kinds.head > 0 && kinds.tail > 0, `${car.id} ${lod} lamps: ${JSON.stringify(kinds)}`);
    }
    // On track each car's head and tail lenses are one mesh with its own glow levels (brake
    // lights per car).
    const f = new CarFactory(DRIVE(car.id));
    const a = f.build({ color: '#ff0000' });
    const b = f.build({ color: '#00ff00' });
    assert.ok(a.lamps && b.lamps && a.lamps !== b.lamps, car.id);
    let lampMeshes = 0;
    a.root.traverse((o) => o.isMesh && o.material.name === 'Lamps' && lampMeshes++);
    assert.equal(lampMeshes, 1, `${car.id}: one lamp mesh`);
    const drive = (braking) => ({ pos: new THREE.Vector3(), heading: 0, pitch: 0, forward: 20, yawRate: 0, airborne: false, drifting: false, braking });
    a.update(drive(true), 1 / 30, 0);
    b.update(drive(false), 1 / 30, 0);
    assert.ok(a.lamps.uTail.value > b.lamps.uTail.value, `${car.id}: brake lights`);
    for (const v of [a, b]) v.dispose();
    f.dispose();
  }
});

test('the Factory Livery shows each car in its own colour (never the grey swatch)', () => {
  const swatch = PAINTS.find((p) => p.id === 'factory');
  for (const car of CARS) {
    const rig = rigs[car.id].garage;
    const own = factoryColorOf(rig.meta);
    assert.ok(own, `${car.id} has extras.apex.factoryPaint`);
    assert.notEqual(own.getHexString(), swatch.color.slice(1));
    assert.ok(rig.factoryColor.equals(own));
    assert.ok(rig.paintMaterial.userData.factoryColor.equals(own));
    assert.equal(shownPaintColor(rig.paintMaterial, swatch.color, 'factory'), `#${own.getHexString()}`);
    applyFinish(rig.paintMaterial, swatch.color, 'factory');
    assert.equal(rig.paintMaterial.color.getHexString(), own.getHexString());
    // Any other paint shows as bought.
    applyFinish(rig.paintMaterial, '#123456', 'metallic');
    assert.equal(rig.paintMaterial.color.getHexString(), '123456');
    assert.equal(shownPaintColor(rig.paintMaterial, '#123456', 'metallic'), '#123456');
  }
  // A model without design data keeps the catalog colour.
  const plain = createCarPaint(swatch.color, 'factory');
  assert.equal(plain.color.getHexString(), swatch.color.slice(1));
  assert.equal(readMeta(new THREE.Group()), null);
});

test('glass keeps its alpha so the interior shows through', () => {
  for (const car of CARS) {
    let glass = 0;
    rigs[car.id].garage.group.traverse((o) => {
      if (o.isMesh && /glass/i.test(o.material.name) && !/mirror/i.test(o.material.name)) {
        glass++;
        assert.ok(o.material.transparent && o.material.opacity < 1, `${car.id} ${o.material.name} see-through`);
      }
    });
    assert.ok(glass > 0, `${car.id} has glass`);
  }
});

test('rival race LODs bake into the shared atlas with batched wheels; rivals have no cabin parts', () => {
  for (const car of CARS) {
    const f = new CarFactory(rigs[car.id].race);
    assert.equal(f.wheelBatches.length, 2, `${car.id}: both wheel sides instanced`);
    const v = f.build({ color: '#3366ff' });
    assert.equal(v.cabin.children.length, 0);
    assert.equal(v.steerPart, null);
    let draws = 0;
    v.root.traverse((o) => o.isMesh && o.visible && draws++);
    assert.ok(draws <= 8, `${car.id} rival draws ${draws}`);
    v.dispose();
    f.dispose();
  }
});

test("the player's car: cabin parts apart for the driver view, the steering wheel moves, windows stay closed", () => {
  for (const car of CARS) {
    const rig = DRIVE(car.id);
    const f = new CarFactory(rig);
    const v = f.build({ player: true });
    const hide = rig.meta.hideInCockpit ?? DEFAULT_HIDE_IN_COCKPIT;
    const present = hide.filter((n) => rig.group.getObjectByName(n));
    // The steering wheel is a group of its own; every other cabin part (the closed door windows
    // too, v76) bakes into one group ('parts').
    const moving = present.filter((n) => n === 'steering_wheel');
    const expected = [...moving, ...(present.length > moving.length ? ['parts'] : [])];
    assert.deepEqual(v.cabin.children.map((g) => g.name.replace(/^cabin-/, '')).sort(), expected.sort(), car.id);
    v.setCabinShown(false);
    assert.equal(v.cabin.visible, false);
    v.setCabinShown(true);
    assert.equal(v.cabin.visible, true);
    // The steering wheel turns about its column with the steering input.
    if (rig.group.getObjectByName('steering_wheel')) {
      assert.ok(v.steerPart, `${car.id} steering wheel part`);
      v.steerInput = 1;
      const m0 = v.steerPart.group.matrix.clone();
      for (let i = 0; i < 30; i++) v.update({ pos: new THREE.Vector3(), heading: 0, pitch: 0, forward: 5, yawRate: 0, airborne: false, drifting: false }, 1 / 30, 0);
      assert.ok(!v.steerPart.group.matrix.equals(m0), `${car.id} steering wheel turns`);
    }
    v.dispose();
    f.dispose();
  }
});

test('v76: no window button; the door windows are always closed and their glass stays clear', async () => {
  const [html, css, hud, main, race] = await Promise.all(['../index.html', '../src/ui/style.css', '../src/ui/raceHud.js', '../src/main.js', '../src/race/Race.js'].map(read));
  for (const src of [html, css, hud, main]) assert.doesNotMatch(src, /rh-win|setWindows|toggleWindows|onWindows/);
  assert.doesNotMatch(race, /setWindows|DoorWindows|toggleWindows|windowsAvailable/);
  for (const car of CARS) {
    const { scene, meta } = cockpits[car.id];
    const rest = new Map();
    scene.traverse((o) => rest.set(o.name, o.matrix.clone()));
    const c = new CarCockpit({ source: scene, meta, modelMatrix: DRIVE(car.id).modelMatrix, tier: 'mid' });
    assert.equal(c.setWindows, undefined);
    // Window glass where the design had it: where it was modelled (closed) and see-through.
    for (const name of Object.keys(meta.windows || {})) {
      const node = c.group.getObjectByName(name);
      if (!node) continue;
      assert.ok(node.matrix.equals(rest.get(name)), `${car.id} ${name} closed`);
      node.traverse((o) => {
        if (o.isMesh && o.material.transparent) assert.ok(o.material.opacity < 1, `${car.id} ${name} clear`);
      });
    }
    c.dispose();
  }
});

test('own cockpit: eye from extras.apex.eye, hidden car nodes, steering wheel and hands turn, dials live', () => {
  for (const car of CARS) {
    const { scene, meta } = cockpits[car.id];
    const rig = DRIVE(car.id);
    const c = new CarCockpit({ source: scene, meta, modelMatrix: rig.modelMatrix, tier: 'mid' });
    // Everything on the cockpit layer, drawn on top.
    c.group.traverse((o) => assert.equal(o.layers.mask, 2, `${car.id} ${o.name} on layer 1`));
    assert.ok(c.wheel, `${car.id} steering wheel`);
    assert.ok(c.hands, `${car.id} hands`);
    const fake = { heading: 0.3, pitch: 0 };
    const chase = { carPoint: (_car, _x, _y, _z, out) => out.set(0, 0, 0) };
    const q0 = c.wheel.quaternion.clone();
    for (let i = 0; i < 60; i++) c.update(fake, chase, 1 / 60, 1, 120, 6000);
    assert.ok(c.wheel.quaternion.angleTo(q0) > 0.5, `${car.id} wheel turns`);
    assert.ok(c.hands.quaternion.angleTo(q0) > 0.2, `${car.id} hands turn`);
    // Dials (extras.apex.gauges, faces in the Gauges material) follow speed and revs. The
    // Tempesta has no dials: its readout is on the wheel.
    let faces = false;
    scene.traverse((o) => o.isMesh && o.material.name === 'Gauges' && (faces = true));
    if (!faces) {
      assert.equal(car.id, 'tm-tempesta');
      c.dispose();
      continue;
    }
    assert.ok(c.dials.length >= 2, `${car.id} gauges in the design`);
    const n = c.gaugeUniforms.uNeedle.value;
    c.dials.forEach((d, i) => assert.equal(n.getComponent(i), dialValue(d, 120, 6000)));
    assert.ok(c.dials.some((d) => d.kind === 'speed') && c.dials.some((d) => d.kind === 'rpm'), car.id);
    // The cabin's baked night light: a little by day, all of it at night (glow 1).
    assert.ok(c.glowMaterials.length >= 1, `${car.id} cabin night light`);
    c.update(fake, chase, 1, 0, 0, 0, undefined, 0);
    for (const g of c.glowMaterials) assert.ok(Math.abs(g.m.emissiveIntensity - g.full * 0.3) < 0.02, `${car.id} day glow`);
    for (let i = 0; i < 30; i++) c.update(fake, chase, 1, 0, 0, 0, undefined, 1);
    for (const g of c.glowMaterials) assert.ok(Math.abs(g.m.emissiveIntensity - g.full) < 0.01, `${car.id} night glow`);
    // Budget per car: draws and triangles of the cabin.
    const s = c.stats();
    assert.ok(s.draws <= 24 && s.triangles <= 45000, `${car.id} cockpit ${JSON.stringify(s)}`);
    // The car hides the parts the cockpit draws itself.
    const hide = rig.meta.hideInCockpit ?? DEFAULT_HIDE_IN_COCKPIT;
    assert.ok(hide.includes('steering_wheel') && hide.includes('driver'));
    c.dispose();
  }
  assert.equal(dialKind('km/h'), 'speed');
  assert.equal(dialKind('RPM x1000'), 'rpm');
  assert.equal(dialKind('kW'), 'rpm');
  assert.equal(dialKind('oil'), 'aux');
});

test('race: own cockpit first, shared cabin only as the fallback; eye, cabin hiding and effects', async () => {
  const race = await read('../src/race/Race.js');
  const build = race.slice(race.indexOf('  async buildCockpit('), race.indexOf('\n  }\n', race.indexOf('  async buildCockpit(')));
  assert.match(build, /if \(own\) \{[\s\S]*new CarCockpit\([\s\S]*\} else \{[\s\S]*new Cockpit\(/);
  // v76: the file's eye moved to a real seat's distance from the wheel (CarCockpit.eye, cabinFrame.js driverEye).
  assert.match(build, /this\.cockpit\.eye \? new THREE\.Vector3\(\)\.fromArray\(this\.cockpit\.eye\)\.applyMatrix4\(t\.modelMatrix\)/);
  assert.match(build, /this\.chase\.setOwnEye\(eye\)/);
  assert.match(build, /this\.cockpitFx = \{ speedLines: false, particleNearFade: 2\.8, \.\.\.\(meta\.cockpitFx \?\? \{\}\) \}/);
  // The car's own body stays round the cabin, minus the hidden parts.
  assert.match(race, /setCabinShown\(!shown\)/);
  // The player's car is on its own layer: the race camera sees it.
  assert.match(race, /this\.camera\.layers\.enable\(2\)/);
});

test('v76 mirrors: dark tinted glass on every tier, no render target, no mirror pass; tier rule unchanged', async () => {
  // The tier rule (the GPU detection itself is unchanged).
  assert.equal(cockpitTier({ lowEnd: false, quality: 'high' }), 'high');
  assert.equal(cockpitTier({ lowEnd: false, quality: 'medium' }), 'mid');
  assert.equal(cockpitTier({ lowEnd: true, quality: 'high', manual: false }), 'low');
  assert.equal(cockpitTier({ lowEnd: true, quality: 'medium', manual: true }), 'low');
  assert.equal(cockpitTier({ lowEnd: true, quality: 'low', manual: true }), 'low');
  assert.equal(cockpitTier({ lowEnd: true, quality: 'high', manual: true }), 'high');
  for (const car of CARS) {
    const { scene, meta } = cockpits[car.id];
    for (const tier of ['low', 'mid', 'high']) {
      const c = new CarCockpit({ source: scene, meta, modelMatrix: DRIVE(car.id).modelMatrix, tier });
      assert.equal(c.liveMirror, false);
      assert.equal(c.mirrorTarget, undefined);
      assert.equal(c.renderMirror, undefined);
      assert.equal(c.bodyMirrorMaterial, undefined);
      let glass = 0;
      scene.traverse((o) => o.isMesh && o.material.name === 'MirrorGlass' && glass++);
      assert.equal(c.mirrorMeshes.length, glass, `${car.id}: every MirrorGlass surface`);
      for (const m of c.mirrorMeshes) {
        assert.ok(m.material.vertexColors && !m.material.map && !m.material.transparent, `${car.id} ${tier}: tinted glass`);
        const col = m.geometry.attributes.color;
        for (let i = 0; i < col.count; i++) assert.ok(Math.max(col.getX(i), col.getY(i), col.getZ(i)) < 0.06, `${car.id}: dark`);
      }
      // Clear glass stays see-through on every tier.
      c.group.traverse((o) => {
        if (o.isMesh && /ClearGlass/i.test(o.material.name)) assert.ok(o.material.transparent && o.material.opacity < 1, `${car.id} ${tier} glass`);
      });
      c.dispose();
    }
  }
  const race = await read('../src/race/Race.js');
  assert.doesNotMatch(race, /renderMirror|bodyMirrorMaterial|setMirror/);
});

test('cockpit effects: no speed lines in the cabin; smoke and sparks fade out near the eye', async () => {
  const p = new Particles(new THREE.Scene(), { count: 8 });
  assert.equal(p.material.uniforms.nearFade.value, 0, 'off outside the cockpit');
  p.setNearFade(2.8);
  assert.equal(p.material.uniforms.nearFade.value, 2.8);
  // The fade is a uniform in the one program: switching views never compiles a shader.
  assert.match(p.material.vertexShader, /smoothstep\(nearFade \* 0\.45, nearFade, -mv\.z\)/);
  const race = await read('../src/race/Race.js');
  assert.match(race, /const lines = this\.cockpitShown && this\.cockpitFx && !this\.cockpitFx\.speedLines \? 0 : lineLevel;/);
  assert.match(race, /for \(const p of \[this\.smoke, this\.sparks\]\) p\.setNearFade\(fade\)/);
  for (const car of CARS) {
    const fx = cockpits[car.id].meta.cockpitFx;
    if (fx) {
      assert.equal(fx.speedLines, false, car.id);
      assert.ok(fx.particleNearFade > 1, car.id);
    }
  }
});

test('old saves load unchanged: owned cars, paints, rims and the selected car', () => {
  const rims = RIMS.map((r) => r.id);
  const paints = PAINTS.map((p) => p.id);
  const save = migrate(null);
  save.coins = 123456;
  save.ownedPaints = paints.slice(0, 6);
  for (const [i, car] of CARS.entries()) {
    save.cars[car.id] = {
      unlockedBy: i ? 'coins' : 'starter',
      upgrades: { topSpeed: 3, acceleration: 2, handling: 1, nitro: 4 },
      paint: paints[i % paints.length],
      rim: rims[i % rims.length],
      rims: [...new Set(['stock', rims[i % rims.length]])],
      spoiler: 'factory',
      spoilers: ['factory'],
      smoke: save.cars['rp1-vanta']?.smoke ?? 'white',
      nitroFx: save.cars['rp1-vanta']?.nitroFx ?? 'blue',
    };
  }
  save.ownedCars = CARS.map((c) => c.id);
  save.car = 'tm-tempesta';
  const stored = JSON.parse(JSON.stringify(save));
  const loaded = migrate(JSON.parse(JSON.stringify(stored)));
  assert.equal(loaded.v, SAVE_VERSION);
  assert.equal(loaded.car, 'tm-tempesta');
  assert.equal(loaded.coins, 123456);
  assert.deepEqual(loaded.ownedPaints, stored.ownedPaints);
  assert.deepEqual(Object.keys(loaded.cars).sort(), CARS.map((c) => c.id).sort());
  assert.deepEqual([...loaded.ownedCars].sort(), CARS.map((c) => c.id).sort());
  for (const car of CARS) {
    const [a, b] = [loaded.cars[car.id], stored.cars[car.id]];
    assert.equal(a.paint, b.paint, car.id);
    assert.equal(a.rim, b.rim, car.id);
    assert.deepEqual(a.rims, b.rims, car.id);
    assert.deepEqual(a.upgrades, b.upgrades, car.id);
    assert.equal(a.unlockedBy, b.unlockedBy, car.id);
  }
  assert.deepEqual(normalize(loaded), loaded, 'stable on the next load');
});

test("the player's own wing mirrors keep their own glass in the atlas (v76: no live rear view)", () => {
  const f = new CarFactory(DRIVE('sv-stallion'));
  const v = f.build({ player: true });
  assert.equal(v.mirrorGlass, undefined);
  assert.equal(v.setMirror, undefined);
  v.dispose();
  f.dispose();
});

test("driver view: the player's car draws in front (no rival shows through it), switched without a recompile", async () => {
  const rig = DRIVE('tm-tempesta'); // the open car: its bodywork is all round the driver
  const f = new CarFactory(rig);
  const v = f.build({ player: true });
  f.frontDrawPlayer(v);
  const mats = new Set();
  for (const root of [v.root, ...f.sharedMeshes]) root.traverse((o) => o.isMesh && [].concat(o.material).forEach((m) => mats.add(m)));
  assert.ok(mats.size > 3);
  for (const m of mats) {
    assert.equal(m.userData.frontDraw, true, m.name);
    const shader = { uniforms: {}, vertexShader: '#include <project_vertex>', fragmentShader: '' };
    m.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uFront, PLAYER_FRONT);
    assert.ok(shader.vertexShader.includes(FRONT_DRAW));
    assert.match(m.customProgramCacheKey(), /\|front(\||$)/);
  }
  // Rivals share the same program (one program per material kind) but their switch stays at 0, so they never draw in front.
  const rf = new CarFactory(rigs['tm-tempesta'].race);
  const rival = rf.build({ color: '#00ff00' });
  rival.root.traverse((o) => o.isMesh && [].concat(o.material).forEach((m) => {
    if (!m.userData.frontDraw) return;
    const shader = { uniforms: {}, vertexShader: '#include <project_vertex>', fragmentShader: '' };
    m.onBeforeCompile(shader);
    assert.notEqual(shader.uniforms.uFront, PLAYER_FRONT, m.name);
    assert.equal(shader.uniforms.uFront.value, 0, m.name);
  }));
  const race = await read('../src/race/Race.js');
  assert.match(race, /PLAYER_FRONT\.value = shown && own \? 1 : 0;/);
  assert.match(race, /this\.factory\.frontDrawPlayer\(player\);\s*PLAYER_FRONT\.value = 0;/);
  for (const x of [v, rival]) x.dispose();
  for (const x of [f, rf]) x.dispose();
});

// Pixel size of a WebP image (VP8, VP8L or VP8X header).
function webpSize(b) {
  const tag = String.fromCharCode(...b.subarray(12, 16));
  if (tag === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (tag === 'VP8L') {
    const v = b.readUInt32LE(21);
    return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1];
  }
  return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
}
async function glbImages(file) {
  const b = await readFile(new URL(`assets/models/${file}`, PUBLIC));
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + len).toString());
  const bin = b.subarray(20 + len + 8);
  return (j.images ?? []).map((im) => {
    const v = j.bufferViews[im.bufferView];
    const [w, h] = webpSize(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
    return { name: im.name, w, h };
  });
}

test('low tier cockpit: a light file per car (<= 15k triangles, 512 px, <= 4 MB of textures, no normal maps)', async () => {
  for (const car of CARS) {
    const low = lowCockpits[car.id];
    assert.ok(low?.url.endsWith('_cockpit_low.glb'), `${car.id} loads its light cabin on the low tier`);
    assert.equal(car.model.cockpitLowUrl, car.model.url.replace(/\.glb$/, '_cockpit_low.glb'));
    assert.equal(low.meta.id, car.id, 'same design data');
    const c = new CarCockpit({ source: low.scene, meta: low.meta, modelMatrix: DRIVE(car.id).modelMatrix, tier: 'low' });
    const s = c.stats();
    assert.ok(s.triangles <= 15000, `${car.id} low cockpit ${JSON.stringify(s)}`);
    let normalMaps = 0;
    c.group.traverse((o) => o.isMesh && o.material.normalMap && normalMaps++);
    assert.equal(normalMaps, 0, `${car.id}: no normal maps`);
    // The same moving parts as the full cabin.
    assert.equal(Boolean(c.wheel), Boolean(cockpits[car.id].scene.getObjectByName('steering_wheel')), car.id);
    const images = await glbImages(car.model.cockpitLowUrl.replace(/^assets\/models\//, ''));
    let bytes = 0;
    for (const im of images) {
      assert.ok(im.w <= 512 && im.h <= 512, `${car.id} ${im.name} ${im.w}x${im.h}`);
      bytes += im.w * im.h * 4 * (4 / 3);
    }
    assert.ok(bytes <= 4 * 1048576, `${car.id} low cockpit textures ${(bytes / 1048576).toFixed(2)} MB`);
    c.dispose();
  }
  // Other tiers keep the full cabin.
  assert.ok((await quiet(() => loadCarCockpit(CARS[0], { tier: 'high' }))).url.endsWith('_cockpit.glb'));
});

test('lite cars (low tier): rivals one opaque draw, the player at 512 px with its cabin, rims and tyres in the atlas', () => {
  for (const car of CARS) {
    const rival = new CarFactory(rigs[car.id].race, { lite: true });
    const r = rival.build({ color: '#3366ff' });
    const mats = new Set();
    r.root.traverse((o) => o.isMesh && mats.add(o.material.name || o.material.type));
    // Atlas (paint included), glass and lamps; the wheels are the factory's shared batches.
    let draws = 0;
    r.root.traverse((o) => o.isMesh && o.visible && draws++);
    assert.ok(draws <= 3, `${car.id} lite rival draws ${draws}: ${[...mats]}`);
    let physical = 0;
    r.root.traverse((o) => o.isMesh && o.material.isMeshPhysicalMaterial && physical++);
    assert.equal(physical, 0, `${car.id}: lite rival paint in the atlas`);
    r.dispose();
    rival.dispose();

    const f = new CarFactory(DRIVE(car.id), { lite: true });
    const p = f.build({ player: true });
    let pDraws = 0;
    let tris = 0;
    p.root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      pDraws++;
      tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      assert.ok(!o.material.normalMap, `${car.id} ${o.material.name || o.material.type}: no normal map on the low tier`);
    });
    assert.ok(pDraws <= 11, `${car.id} lite player draws ${pDraws}`);
    assert.ok(tris <= 40000, `${car.id} lite player triangles ${tris}`);
    // One cabin group (the driver view still hides it), no moving parts, no live-mirror glass.
    assert.deepEqual(p.cabin.children.map((g) => g.name), ['cabin-parts']);
    assert.equal(p.steerPart, null);
    // A wheel is at most one draw (rim and tyre in the atlas; none of its own when the factory
    // batches flat wheels) and the uprights ride in the body.
    for (const w of p.wheels) {
      let n = 0;
      w.spin.traverse((o) => o.isMesh && n++);
      assert.ok(n <= 1, `${car.id} lite wheel draws ${n}`);
      assert.equal(w.wheel.children.filter((c) => c.isMesh).length, 0);
    }
    p.dispose();
    f.dispose();
  }
});

test('every tier: one glass mesh and one lamp mesh per car; the cabin and dash in the atlas', () => {
  for (const car of CARS) {
    const f = new CarFactory(rigs[car.id].race);
    const r = f.build({ color: '#ffffff' });
    const count = (root, name) => {
      let n = 0;
      root.traverse((o) => o.isMesh && o.material.name === name && n++);
      return n;
    };
    assert.ok(count(r.root, 'Glass') <= 1 && count(r.root, 'Lamps') === 1, car.id);
    // Glass keeps its alpha (per vertex) and draws in one pass, both faces.
    r.root.traverse((o) => {
      if (!o.isMesh || o.material.name !== 'Glass') return;
      assert.ok(o.material.transparent && o.material.forceSinglePass && o.material.side === THREE.FrontSide);
      const a = o.geometry.attributes.color;
      assert.equal(a.itemSize, 4);
      let clear = false;
      for (let i = 0; i < a.count; i++) if (a.getW(i) < 1) clear = true;
      assert.ok(clear, `${car.id} glass alpha`);
    });
    r.dispose();
    f.dispose();
    // The player's cabin (interior, driver) has no textured material left: baked colours.
    const pf = new CarFactory(DRIVE(car.id));
    const p = pf.build({ player: true });
    const parts = p.cabin.getObjectByName('cabin-parts');
    parts?.traverse((o) => o.isMesh && assert.ok(!o.material.map, `${car.id} cabin ${o.material.name} uses the atlas`));
    p.dispose();
    pf.dispose();
  }
});

test('medium/high player car: atlas and glass parts in one draw each, moving parts follow their groups', () => {
  const f = new CarFactory(DRIVE('sv-stallion'));
  const p = f.build({ player: true });
  const atlas = p.root.children.find((c) => c.name === 'parts-atlas');
  // v76: the closed door windows bake with the cabin, so the glass may already be one mesh.
  const glass = p.root.children.find((c) => c.name === 'parts-Glass');
  assert.ok(atlas, 'one atlas mesh');
  let separate = 0;
  let glassMeshes = 0;
  p.root.traverse((o) => o.isMesh && o !== atlas && o.material === atlas.material && separate++);
  p.root.traverse((o) => o.isMesh && o.material === f.glass && glassMeshes++);
  assert.equal(separate, 0, 'no atlas part left on its own');
  assert.ok(glass ? glassMeshes === 1 : glassMeshes <= 1, `glass in one draw (${glassMeshes})`);
  const parts = atlas.material.userData.uParts.value;
  const steer = p.steerPart.group;
  assert.ok(atlas.userData.partGroups.includes(steer), 'the steering wheel turns inside the merged mesh');
  // At rest every part matrix is the identity; turning the front wheel moves only its parts.
  p.root.updateMatrixWorld(true);
  atlas.onBeforeRender();
  for (let i = 0; i < atlas.userData.partGroups.length; i++) assert.ok(parts[i].equals(new THREE.Matrix4()) || parts[i].elements.every((v, k) => Math.abs(v - new THREE.Matrix4().elements[k]) < 1e-6));
  const front = p.wheels[0].wheel;
  front.rotation.y = 0.4;
  p.root.updateMatrixWorld(true);
  atlas.onBeforeRender();
  const i = atlas.userData.partGroups.indexOf(front);
  assert.ok(Math.abs(parts[i].elements[0] - Math.cos(0.4)) < 1e-6, 'its matrix turns with the pivot');
  // The driver view collapses the cabin's parts.
  p.setCabinShown(false);
  p.root.updateMatrixWorld(true);
  atlas.onBeforeRender();
  const c = atlas.userData.partGroups.findIndex((g) => g.name === 'cabin-parts');
  assert.ok(c >= 0 && parts[c].elements.slice(0, 12).every((v) => Math.abs(v) < 1e-9), 'hidden cabin collapses');
  p.dispose();
  f.dispose();
});

test('medium tier cockpit: its own file per car (the full mesh, lit; <= 1024 px, under 8 MB on the GPU with the display and mirror)', async () => {
  for (const car of CARS) {
    const mid = await quiet(() => loadCarCockpit(car, { tier: 'mid' }));
    assert.ok(mid?.url.endsWith('_cockpit_mid.glb'), `${car.id} loads its medium cabin`);
    const imgs = await glbImages(mid.url.split('/').pop());
    assert.ok(imgs.every((i) => i.w <= 1024 && i.h <= 1024), `${car.id}: 1024 px at most`);
    // GPU bytes with mipmaps, plus the half-size cluster display (256 x 160) and the mirror target.
    const mb = (imgs.reduce((n, i) => n + (i.w * i.h * 16) / 3, 0) + 256 * 160 * 4 * (4 / 3) + 256 * 96 * 8) / 1048576;
    assert.ok(mb <= 8, `${car.id}: ${mb.toFixed(2)} MB`);
    assert.ok(!imgs.some((i) => /_orm$/.test(i.name ?? '')), 'no ORM map (Lambert)');
    let tris = 0;
    mid.scene.traverse((o) => o.isMesh && (tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3));
    const full = await quiet(() => loadCarCockpit(car, { tier: 'high' }));
    let fullTris = 0;
    full.scene.traverse((o) => o.isMesh && (fullTris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3));
    assert.equal(tris, fullTris, 'the same mesh as the approved cabin');
  }
});

test('car parts draw front faces only on every tier (no second raster of the bodywork)', () => {
  for (const lite of [false, true]) {
    const f = new CarFactory(DRIVE('sv-stallion'), { lite });
    for (const v of [f.build({ player: true }), f.build({ color: '#ff0000' })]) {
      v.root.traverse((o) => {
        if (!o.isMesh || o.material.blending === THREE.AdditiveBlending) return; // nitro flames
        assert.equal(o.material.side, THREE.FrontSide, `${lite ? 'lite' : 'full'} ${o.name || o.material.name}`);
      });
      v.dispose();
    }
    f.dispose();
  }
});
