// versionCode 75: the eight Blender cars in the game. The model loader's wheel rig (pivots on
// the axle, per-axle rolling radius, uprights that steer but never spin, the steering wheel),
// the lamp patterns, factory colours, glass; the race bake (rival batching, the player's cabin
// parts and door windows); each car's own cockpit (eye, hidden nodes, mirrors per tier, moving
// wheel and hands, windows); the window button; the cockpit effects; and that every save keeps
// what it owns.
import './dom-stub.js';

globalThis.self ??= globalThis; // GLTFLoader looks for self.URL
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { CARS } from '../src/data/cars.js';
import { PAINTS, RIMS } from '../src/data/catalog.js';
import { loadCar, loadCarCockpit, HEAD_PATTERN, TAIL_PATTERN, readMeta, factoryColorOf } from '../src/assets/modelLoader.js';
import { CarFactory, DEFAULT_HIDE_IN_COCKPIT, windowPose, PLAYER_FRONT, FRONT_DRAW } from '../src/race/raceCars.js';
import { CarCockpit, dialKind, dialValue } from '../src/race/carCockpit.js';
import { cockpitTier } from '../src/race/cockpitAsset.js';
import { DoorWindows, WINDOW_TIME } from '../src/race/doorWindows.js';
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
for (const car of CARS) {
  rigs[car.id] = {};
  for (const lod of ['garage', 'drive', 'race']) rigs[car.id][lod] = await quiet(() => loadCar(car, { paintColor: '#c8102e', finish: 'metallic', lod }));
  cockpits[car.id] = await quiet(() => loadCarCockpit(car));
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
    for (const w of p.wheels) assert.ok(w.wheel.children.some((c) => c.isMesh), `${car.id}: still parts on the player's wheel`);
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
    // On track each car has its own lamp materials (brake lights per car).
    const f = new CarFactory(DRIVE(car.id));
    const a = f.build({ color: '#ff0000' });
    const b = f.build({ color: '#00ff00' });
    assert.ok(a.tail && a.head && a.tail !== b.tail);
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
    assert.equal(v.windows.length, 0);
    assert.equal(v.steerPart, null);
    let draws = 0;
    v.root.traverse((o) => o.isMesh && o.visible && draws++);
    assert.ok(draws <= 8, `${car.id} rival draws ${draws}`);
    v.dispose();
    f.dispose();
  }
});

test("the player's car: cabin parts apart for the driver view, door windows and steering wheel move", () => {
  for (const car of CARS) {
    const rig = DRIVE(car.id);
    const f = new CarFactory(rig);
    const v = f.build({ player: true });
    const hide = rig.meta.hideInCockpit ?? DEFAULT_HIDE_IN_COCKPIT;
    const present = hide.filter((n) => rig.group.getObjectByName(n));
    assert.deepEqual(v.cabin.children.map((g) => g.name.replace(/^cabin-/, '')).sort(), [...present].sort(), car.id);
    v.setCabinShown(false);
    assert.equal(v.cabin.visible, false);
    v.setCabinShown(true);
    assert.equal(v.cabin.visible, true);
    // Windows: as many as the design has, closed at 0 and moved at 1.
    const poses = rig.meta.windows || {};
    assert.equal(v.windows.length, Object.values(poses).filter((p) => p?.open && rig.group.getObjectByName(Object.keys(poses).find((k) => poses[k] === p))).length);
    for (const w of v.windows) {
      v.setWindows(0);
      assert.ok(w.group.matrix.equals(new THREE.Matrix4()) || w.group.matrix.elements.every((e, i) => Math.abs(e - new THREE.Matrix4().elements[i]) < 1e-6), `${car.id} closed = rest`);
      v.setWindows(1);
      const drop = new THREE.Vector3().setFromMatrixPosition(w.group.matrix).length();
      assert.ok(drop > 0.05, `${car.id} window moves ${drop.toFixed(3)} m`);
    }
    v.setWindows(0);
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

test('door windows: cars with windows in the design, the Tempesta and windows: false have none', () => {
  for (const car of CARS) {
    const meta = cockpits[car.id].meta;
    const c = new CarCockpit({ source: cockpits[car.id].scene, meta, modelMatrix: DRIVE(car.id).modelMatrix, tier: 'mid' });
    if (meta.windows === false || car.id === 'tm-tempesta') assert.equal(c.windowNodes.length, 0, `${car.id} has no windows`);
    else {
      assert.equal(c.windowNodes.length, 2, `${car.id}: driver and passenger window`);
      const rest = c.windowNodes.map((w) => w.node.matrix.clone());
      c.setWindows(1);
      for (const [i, w] of c.windowNodes.entries()) {
        const open = w.node.matrix.clone();
        assert.ok(!open.equals(rest[i]), `${car.id} window ${w.node.name} opens`);
        assert.ok(open.equals(new THREE.Matrix4().multiplyMatrices(windowPose(w.pose, 1), rest[i])));
      }
      c.setWindows(0);
      c.windowNodes.forEach((w, i) => assert.ok(w.node.matrix.equals(rest[i]), 'closed again'));
    }
    c.dispose();
  }
  // Pose maths: closed is the identity, open the design's offset, halfway in between.
  const pose = { closed: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }, open: { position: [0, -0.3, 0.02], quaternion: [0, 0, 0, 1] } };
  assert.ok(windowPose(pose, 0).equals(new THREE.Matrix4()));
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(windowPose(pose, 0.5)).toArray(), [0, -0.15, 0.01]);
});

test('window state: toggles only in the driver view of a car with windows, eases, resets closed', () => {
  const w = new DoorWindows();
  assert.equal(w.toggle({ cockpitView: false, available: true }), false, 'chase view: no');
  assert.equal(w.toggle({ cockpitView: true, available: false }), false, 'no windows: no');
  assert.equal(w.down, false);
  assert.equal(w.toggle({ cockpitView: true, available: true }), true);
  assert.equal(w.down, true);
  const ks = [];
  for (let t = 0; t < WINDOW_TIME + 0.1; t += 0.1) ks.push(w.step(0.1));
  assert.equal(w.level, 1);
  assert.ok(ks.filter((k) => k !== null).every((k, i, a) => k >= 0 && k <= 1 && (i === 0 || k >= a[i - 1])), 'eases down');
  assert.equal(w.step(0.1), null, 'still once there');
  w.toggle({ cockpitView: true, available: true });
  w.step(0.3);
  assert.ok(w.level < 1 && w.level > 0);
  w.reset();
  assert.equal(w.level, 0);
  assert.equal(w.target, 0);
  assert.equal(w.down, false);
});

test('window button: shown only in the driver view of a car with windows, multi-touch safe, reset each race', async () => {
  const [html, css, hud, main, race] = await Promise.all(['../index.html', '../src/ui/style.css', '../src/ui/raceHud.js', '../src/main.js', '../src/race/Race.js'].map(read));
  assert.match(html, /<button id="rh-win" class="icon-btn glass angled rh-win" aria-label="Windows down" aria-pressed="false">/);
  // Hidden by default; only the cockpit view with windows shows it.
  assert.match(css, /\.rh-win \{ display: none;[^}]*touch-action: none; \}/);
  assert.match(css, /#race-hud\[data-view='cockpit'\]\[data-windows='1'\] \.rh-win \{ display: grid; \}/);
  // pointerdown (works while other fingers hold the pedals), never reaches the controls under it.
  const handler = hud.slice(hud.indexOf("winBtn.addEventListener('pointerdown'"), hud.indexOf('});', hud.indexOf("winBtn.addEventListener('pointerdown'")));
  assert.match(handler, /e\.preventDefault\(\);\s*e\.stopPropagation\(\);/);
  assert.match(handler, /root\.dataset\.view !== 'cockpit' \|\| root\.dataset\.windows !== '1'/);
  assert.match(hud, /setWindows\(available, down = false\) \{\s*root\.dataset\.windows = available \? '1' : '0';/);
  // Every race starts closed, with the button set for the car.
  const begin = main.slice(main.indexOf('raceHud.setNext(null);'), main.indexOf('}', main.indexOf('raceHud.setNext(null);')));
  assert.match(begin, /raceHud\.setWindows\(race\.windowsAvailable, false\)/);
  assert.match(main, /if \(mode !== 'race' \|\| !race\?\.toggleWindows\(\)\) return;/);
  const beginRace = race.slice(race.indexOf('  begin('), race.indexOf('\n  }\n', race.indexOf('  begin(')));
  assert.match(beginRace, /this\.setWindowsNow\(0\)/);
  assert.match(race, /return this\.windows\.toggle\(\{ cockpitView: Boolean\(this\.cockpitShown\), available: this\.windowsAvailable \}\)/);
  // No save change: nothing about windows is stored.
  assert.doesNotMatch(await read('../src/core/saveSchema.js'), /window/i);
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
    assert.ok(s.draws <= 24 && s.triangles <= 60000, `${car.id} cockpit ${JSON.stringify(s)}`);
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
  assert.match(build, /meta\.eye \? new THREE\.Vector3\(\)\.fromArray\(meta\.eye\)\.applyMatrix4\(t\.modelMatrix\)/);
  assert.match(build, /this\.chase\.setOwnEye\(eye\)/);
  assert.match(build, /this\.cockpitFx = \{ speedLines: false, particleNearFade: 2\.8, \.\.\.\(meta\.cockpitFx \?\? \{\}\) \}/);
  // The car's own body stays round the cabin, minus the hidden parts.
  assert.match(race, /setCabinShown\(!shown\)/);
  // The player's car is on its own layer: the race camera sees it, the mirror does not.
  assert.match(race, /this\.camera\.layers\.enable\(2\)/);
  const { scene, meta } = cockpits['sv-stallion'];
  const c = new CarCockpit({ source: scene, meta, modelMatrix: DRIVE('sv-stallion').modelMatrix, tier: 'high' });
  assert.equal(c.mirrorCamera.layers.mask, 1, 'mirror sees the world only');
  c.dispose();
});

test('live mirrors: every MirrorGlass on mid and high; sky on low-end Auto; live again on a manual High', () => {
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
      // Mirror glass in the cabin, or on the body (the Tempesta's pods over the sidepods).
      let onBody = 0;
      DRIVE(car.id).group.traverse((o) => o.isMesh && o.material.name === 'MirrorGlass' && onBody++);
      assert.ok(c.mirrorMeshes.length + onBody >= 1, `${car.id} has mirror glass`);
      if (tier !== 'low') assert.ok(c.bodyMirrorMaterial.map === c.mirrorTarget.texture);
      let glass = 0;
      scene.traverse((o) => o.isMesh && o.material.name === 'MirrorGlass' && glass++);
      assert.equal(c.mirrorMeshes.length, glass, `${car.id}: every MirrorGlass surface`);
      for (const m of c.mirrorMeshes) {
        if (tier === 'low') {
          assert.equal(c.mirrorTarget, undefined);
          assert.ok(m.material.vertexColors && !m.material.map, 'sky gradient');
        } else assert.equal(m.material.map, c.mirrorTarget.texture, `${car.id} ${tier}: live`);
      }
      // Clear glass stays see-through on every tier.
      c.group.traverse((o) => {
        if (o.isMesh && /ClearGlass/i.test(o.material.name)) assert.ok(o.material.transparent && o.material.opacity < 1, `${car.id} ${tier} glass`);
      });
      c.dispose();
    }
  }
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

test("the player's own wing mirrors show the live rear view in the driver view only", async () => {
  const id = 'sv-stallion'; // wing mirror glass on the body
  const f = new CarFactory(DRIVE(id));
  const v = f.build({ player: true });
  assert.ok(v.mirrorGlass.length > 0, 'body MirrorGlass kept apart');
  const { scene, meta } = cockpits[id];
  const live = new CarCockpit({ source: scene, meta, modelMatrix: DRIVE(id).modelMatrix, tier: 'mid' });
  assert.equal(live.bodyMirrorMaterial.map, live.mirrorTarget.texture);
  v.setMirror(live.bodyMirrorMaterial);
  for (const g of v.mirrorGlass) assert.equal(g.mesh.material, live.bodyMirrorMaterial);
  v.setMirror(null);
  for (const g of v.mirrorGlass) assert.equal(g.mesh.material, g.own);
  const low = new CarCockpit({ source: scene, meta, modelMatrix: DRIVE(id).modelMatrix, tier: 'low' });
  assert.equal(low.bodyMirrorMaterial, null, 'low tier: the glass stays as it is');
  // Rivals keep their mirror glass in the atlas.
  const rival = f.build({ color: '#ffffff' });
  assert.equal(rival.mirrorGlass.length, 0);
  const race = await read('../src/race/Race.js');
  assert.match(race, /this\.player\.visual\.setMirror\(shown \? this\.cockpit\.bodyMirrorMaterial : null\)/);
  const warm = race.slice(race.indexOf('  warmUp() {'), race.indexOf('  start() {'));
  assert.match(warm, /visual\.setMirror\(this\.cockpitShown \? null : live\);[\s\S]*r\.compile\(scene, this\.camera\);[\s\S]*r\.render\(scene, this\.camera\);[\s\S]*visual\.setMirror\(this\.cockpitShown \? live : null\);/);
  for (const x of [live, low]) x.dispose();
  for (const x of [v, rival]) x.dispose();
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
    assert.match(m.customProgramCacheKey(), /\|front$/);
  }
  // Rivals never get it.
  const rf = new CarFactory(rigs['tm-tempesta'].race);
  const rival = rf.build({ color: '#00ff00' });
  rival.root.traverse((o) => o.isMesh && [].concat(o.material).forEach((m) => assert.ok(!m.userData.frontDraw)));
  const race = await read('../src/race/Race.js');
  assert.match(race, /PLAYER_FRONT\.value = shown && own \? 1 : 0;/);
  assert.match(race, /this\.factory\.frontDrawPlayer\(player\);\s*PLAYER_FRONT\.value = 0;/);
  for (const x of [v, rival]) x.dispose();
  for (const x of [f, rf]) x.dispose();
});
