// Race camera (versionCodes 71-72): free look never touches the car, the camera eases back
// behind the car within 2 s, touches that start on a control never turn the camera, the chosen
// view persists and nothing but the camera button changes it, the follow never jumps, walls
// pull it in smoothly. v72: three views (Chase, Close, Cockpit), saved hood / driver views
// become cockpit, no free look in the cockpit, and the shared cockpit's wheel, hands, needles,
// gear and shift lights follow the real values (test/cockpit.test.js has the rest).
import './dom-stub.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import * as THREE from 'three';
import { ChaseCamera, FREE_LOOK } from '../src/race/chaseCamera.js';
import { createFreeLook } from '../src/race/freeLook.js';
import { createRaceInput } from '../src/race/input.js';
import { CAMERA_VIEWS, CAMERA_LABELS } from '../src/data/controls.js';
import { normalize, defaults } from '../src/core/saveSchema.js';
import { Track } from '../src/race/track.js';
import { Vehicle, statsToParams } from '../src/race/vehicle.js';
import { EMERALD_COAST } from '../src/data/tracks.js';
import { BASE_STATS } from '../src/data/catalog.js';

const DT = 1 / 60;

// Minimal element: listeners by type, classList, a 200 px box at the origin.
function el(name = 'el') {
  const on = {};
  const node = {
    name,
    on,
    style: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener: (t, f) => (on[t] ??= []).push(f),
    setPointerCapture() {},
    querySelector: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    // Dispatches to this element only: in the page a pointer event goes to the element under
    // the finger (or the one that captured it), never to a sibling.
    fire(t, e = {}) {
      for (const f of on[t] ?? []) f({ preventDefault() {}, pointerId: 1, pointerType: 'touch', button: 0, clientX: 0, clientY: 0, target: node, ...e });
    },
  };
  return node;
}

function rig() {
  globalThis.window ??= { addEventListener() {} };
  const pad = el('steer');
  const nitro = el('nitro');
  const gas = el('gas');
  const brake = el('drift');
  const input = createRaceInput({ steerPad: pad, wheel: el('wheel'), brakes: [brake], nitro, gas, hud: el('hud') });
  input.setEnabled(true);
  const surface = el('canvas');
  const camera = new ChaseCamera(new THREE.PerspectiveCamera(64, 2, 0.3, 3000));
  let active = true;
  const look = createFreeLook({
    surface,
    isActive: () => active,
    onDrag: (dx, dy) => camera.freeLookDrag(dx, dy),
    onRelease: () => camera.freeLookRelease(),
  });
  return { pad, nitro, gas, brake, input, surface, camera, look, setActive: (v) => (active = v) };
}

function carAt(track, s = 120, d = 0) {
  const v = new Vehicle(track, statsToParams(BASE_STATS), { passiveNitro: 0.6, skills: true });
  v.reset(s, d);
  return v;
}

// (Nitro taps carry wall-clock stamps: compare how many.)
const snapshot = (o) => JSON.stringify({ steer: o.steer, throttle: o.throttle, brake: o.brake, brakePressed: o.brakePressed, nitroTaps: o.nitroTaps.length });
const sameTaps = (o, t) => {
  if (o.nitroTaps.length) o.nitroTaps.splice(0, o.nitroTaps.length, ...o.nitroTaps.map(() => t));
  return o;
};

test('free look never changes the car input, even with fingers on steering and nitro', () => {
  const a = rig();
  const b = rig();
  // Both cars: right thumb holding full right lock; on `a` another finger drags empty screen.
  for (const r of [a, b]) r.pad.fire('pointerdown', { pointerId: 1, clientX: 190 });
  const track = new Track(EMERALD_COAST);
  const carA = carAt(track);
  const carB = carAt(track);
  let t = 0;
  for (let i = 0; i < 180; i++) {
    if (i === 20) a.surface.fire('pointerdown', { pointerId: 9, clientX: 400, clientY: 200 });
    if (i > 20 && i < 120) a.surface.fire('pointermove', { pointerId: 9, clientX: 400 + (i - 20) * 6, clientY: 200 + Math.sin(i) * 20 });
    if (i === 60) for (const r of [a, b]) r.nitro.fire('pointerdown', { pointerId: 3 }); // NITRO tap mid-drag
    if (i === 120) a.surface.fire('pointerup', { pointerId: 9 });
    const ia = a.input.read(DT);
    const sa = snapshot(ia);
    const ib = b.input.read(DT);
    assert.equal(sa, snapshot(ib), `frame ${i}: input differs`);
    t += DT;
    carA.step(DT, sameTaps(ia, t), t);
    carB.step(DT, sameTaps(ib, t), t);
  }
  assert.equal(a.input.read(DT).steer, 1, 'the steering finger is still held');
  for (const k of ['x', 'y', 'z']) assert.equal(carA.pos[k], carB.pos[k], `car position ${k}`);
  assert.equal(carA.heading, carB.heading, 'heading');
  assert.equal(carA.speed, carB.speed, 'speed');
  assert.equal(carA.nitro, carB.nitro, 'nitro');
  assert.ok(a.camera.free.yaw !== 0 || a.camera.free.fromYaw !== 0, 'the drag did turn the camera');
});

test('free look rotates only the camera round the car in Chase and Close; a drag in the cockpit does nothing', () => {
  const { surface, camera } = rig();
  surface.fire('pointerdown', { pointerId: 4, clientX: 300, clientY: 100 });
  surface.fire('pointermove', { pointerId: 4, clientX: 360, clientY: 130 });
  assert.ok(camera.free.yaw > 0, 'drag right looks right');
  assert.ok(camera.free.pitch > 0 && camera.free.pitch <= FREE_LOOK.orbitPitch[1], 'tilt limited');
  surface.fire('pointermove', { pointerId: 4, clientX: 3000, clientY: 2000 });
  assert.ok(camera.free.yaw <= Math.PI && camera.free.pitch <= FREE_LOOK.orbitPitch[1]);
  surface.fire('pointerup', { pointerId: 4 });
  for (const view of ['close', 'chase']) {
    camera.setView(view);
    surface.fire('pointerdown', { pointerId: 6, clientX: 300, clientY: 100 });
    surface.fire('pointermove', { pointerId: 6, clientX: 420, clientY: 100 });
    assert.ok(camera.free.yaw > 0, `${view}: free look still works`);
    surface.fire('pointerup', { pointerId: 6 });
  }
  camera.setView('cockpit');
  surface.fire('pointerdown', { pointerId: 5, clientX: 300, clientY: 100 });
  surface.fire('pointermove', { pointerId: 5, clientX: 5000, clientY: 900 });
  assert.equal(camera.free.yaw, 0, 'no head turn in the cockpit');
  assert.equal(camera.free.pitch, 0);
  assert.equal(camera.freeLooking, false);
  surface.fire('pointerup', { pointerId: 5 });
  assert.equal(camera.view, 'cockpit');
});

test('dragging in the cockpit changes nothing: camera pose, car and input are untouched', () => {
  const track = new Track(EMERALD_COAST);
  const poses = [];
  const inputs = [];
  const cars = [];
  for (const drag of [false, true]) {
    const { surface, camera, input, pad, gas } = rig();
    const car = carAt(track);
    camera.setTrack(track);
    camera.setView('cockpit', car);
    gas.fire('pointerdown', { pointerId: 1, clientX: 50, clientY: 50 });
    pad.fire('pointerdown', { pointerId: 2, clientX: 150, clientY: 100 });
    let t = 0;
    for (let i = 0; i < 90; i++) {
      if (drag && i === 10) surface.fire('pointerdown', { pointerId: 9, clientX: 400, clientY: 200 });
      if (drag && i > 10 && i < 70) surface.fire('pointermove', { pointerId: 9, clientX: 400 + i * 25, clientY: 200 - i * 4 });
      if (drag && i === 70) surface.fire('pointerup', { pointerId: 9 });
      const inp = input.read(DT);
      inputs.push(snapshot(inp));
      t += DT;
      car.step(DT, inp, t);
      camera.update(DT, car);
      poses.push(camera.camera.position.toArray().map((v) => v.toFixed(6)).join(',') + camera.look.toArray().map((v) => v.toFixed(6)).join(','));
    }
    cars.push([car.pos.x, car.pos.z, car.heading, car.speed].map((v) => v.toFixed(9)).join(','));
  }
  const half = poses.length / 2;
  assert.deepEqual(poses.slice(half), poses.slice(0, half), 'the camera did not move');
  assert.deepEqual(inputs.slice(half), inputs.slice(0, half), 'the input did not change');
  assert.equal(cars[1], cars[0], 'the car did not change');
});

test('Race only allows free look in Chase and Close', async () => {
  const src = await readFile(new URL('../src/race/Race.js', import.meta.url), 'utf8');
  const allowed = src.slice(src.indexOf('  get freeLookAllowed() {'), src.indexOf('  freeLookDrag(dx, dy) {'));
  assert.match(allowed, /this\.chase\.view !== 'cockpit'/);
});

test('touches that start on a control never rotate the camera', () => {
  const { pad, nitro, gas, brake, surface, camera, input } = rig();
  // Fingers on every control, sliding around: the canvas never hears of them.
  for (const [i, c] of [pad, nitro, gas, brake].entries()) {
    c.fire('pointerdown', { pointerId: 10 + i, clientX: 50, clientY: 50 });
    for (let k = 0; k < 20; k++) c.fire('pointermove', { pointerId: 10 + i, clientX: 50 + k * 30, clientY: 50 + k * 10 });
  }
  input.read(DT);
  assert.equal(camera.free.yaw, 0);
  assert.equal(camera.free.pitch, 0);
  // Even if one of those pointers' moves reached the canvas, it is not the free-look finger.
  surface.fire('pointermove', { pointerId: 10, clientX: 900, clientY: 300 });
  assert.equal(camera.free.yaw, 0);
  // An event that bubbled up from a child of the canvas (a control) is ignored too.
  surface.fire('pointerdown', { pointerId: 20, clientX: 10, clientY: 10, target: nitro });
  surface.fire('pointermove', { pointerId: 20, clientX: 500, clientY: 10, target: nitro });
  assert.equal(camera.free.yaw, 0);
  // Not while paused or before the countdown.
  const r = rig();
  r.setActive(false);
  r.surface.fire('pointerdown', { pointerId: 30, clientX: 10, clientY: 10 });
  r.surface.fire('pointermove', { pointerId: 30, clientX: 500, clientY: 10 });
  assert.equal(r.camera.free.yaw, 0);
});

test('the camera eases back behind the car within 2 s of the finger lifting', () => {
  const track = new Track(EMERALD_COAST);
  for (const view of ['chase', 'close']) {
    const { surface, camera } = rig();
    const car = carAt(track);
    car.forward = 30;
    car.vel.x = Math.cos(car.heading) * 30;
    car.vel.y = -Math.sin(car.heading) * 30;
    camera.setTrack(track);
    camera.setView(view, car);
    camera.snap(car);
    const behind = camera.camera.position.clone();
    surface.fire('pointerdown', { pointerId: 2, clientX: 100, clientY: 100 });
    surface.fire('pointermove', { pointerId: 2, clientX: 700, clientY: 60 });
    for (let i = 0; i < 30; i++) camera.update(DT, car);
    const away = camera.camera.position.distanceTo(behind);
    assert.ok(away > 2, `${view}: the camera orbited (${away.toFixed(2)} m)`);
    surface.fire('pointerup', { pointerId: 2 });
    const start = Math.abs(camera.free.yaw);
    let t = 0;
    let prev = start;
    while (camera.freeLooking && t < 3) {
      camera.update(DT, car);
      t += DT;
      const y = Math.abs(camera.free.yaw);
      assert.ok(y <= prev + 1e-9, 'returns monotonically');
      assert.ok(prev - y < 0.15, 'no snap back');
      prev = y;
    }
    assert.ok(t <= 2, `${view}: back behind the car after ${t.toFixed(2)} s`);
    assert.ok(t >= 1, `${view}: eases back, not instantly (${t.toFixed(2)} s)`);
    for (let i = 0; i < 30; i++) camera.update(DT, car);
    assert.ok(camera.camera.position.distanceTo(behind) < 0.25, `${view}: settled behind the car`);
  }
});

test('the chosen view persists in the save and never changes by itself', async () => {
  assert.deepEqual(CAMERA_VIEWS, ['chase', 'close', 'cockpit']);
  assert.equal(CAMERA_LABELS.cockpit, 'Cockpit view');
  const s = defaults();
  s.settings.cameraView = 'cockpit';
  assert.equal(normalize(JSON.parse(JSON.stringify(s))).settings.cameraView, 'cockpit', 'remembered across launches');

  // Every situation a race throws at the camera: intro fly-in, launch, top speed, drifting,
  // reversing, a jump, a crash shake, a recovery teleport, free look. The view stays put.
  const track = new Track(EMERALD_COAST);
  for (const view of CAMERA_VIEWS) {
    const camera = new ChaseCamera(new THREE.PerspectiveCamera(64, 2, 0.3, 3000));
    camera.setTrack(track);
    const car = carAt(track);
    camera.setView(view, car);
    camera.intro(car, 1);
    let t = 0;
    const input = { steer: 0, throttle: 1, brake: 0, brakePressed: false, nitroTaps: [] };
    for (let i = 0; i < 900; i++) {
      input.steer = i > 300 && i < 420 ? 1 : 0;
      input.brake = i > 330 && i < 380 ? 1 : 0;
      input.throttle = i > 600 && i < 700 ? 0 : 1;
      if (i === 450) camera.bump(0.8);
      if (i === 500) camera.freeLookDrag(300, 40);
      if (i === 520) camera.freeLookRelease();
      if (i === 650) {
        car.recover(car.proj.s + 30, 2);
      }
      if (i === 700) car.airborne = true;
      t += DT;
      if (camera.mode === 'chase') car.step(DT, input, t);
      camera.update(DT, car, { boostTier: i > 200 && i < 260 ? 2 : 0 });
      assert.equal(camera.view, view, `frame ${i}`);
    }
    assert.equal(camera.mode, 'chase', 'the intro hands over to the chosen view');
  }

  // Only the camera button path calls setView / setCameraView.
  const files = await readdir(new URL('../src/', import.meta.url), { recursive: true });
  const hits = [];
  for (const f of files.filter((f) => f.endsWith('.js'))) {
    const src = await readFile(new URL(`../src/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\.(setView|setCameraView)\(/g)) hits.push(`${f}:${m[1]}`);
  }
  assert.deepEqual(hits.sort(), ['main.js:setCameraView', 'main.js:setCameraView', 'race/Race.js:setView'].sort());
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /function applyCameraView[\s\S]*?race\?\.setCameraView\(view\)/);
  const race = await readFile(new URL('../src/race/Race.js', import.meta.url), 'utf8');
  const recovery = race.slice(race.indexOf('  watchPlayer(dt, input) {'), race.indexOf('  updateAtmosphere('));
  assert.match(recovery, /BACK ON TRACK/);
  assert.doesNotMatch(recovery, /chase\.snap/, 'a recovery does not cut the camera');
});

test('the follow never jumps: launch, reverse, drift on/off and speed thresholds are smooth', () => {
  const track = new Track(EMERALD_COAST);
  const camera = new ChaseCamera(new THREE.PerspectiveCamera(64, 2, 0.3, 3000));
  camera.setTrack(track);
  const car = carAt(track, 200, 0);
  camera.setView('chase', car);
  camera.snap(car);
  const input = { steer: 0, throttle: 1, brake: 0, brakePressed: false, nitroTaps: [] };
  const prev = camera.camera.position.clone();
  const prevYaw = { v: camera.yaw };
  let t = 0;
  let worst = 0;
  let worstYaw = 0;
  let worstAt = -1;
  for (let i = 0; i < 1200; i++) {
    // Launch, slide into a drift and out, brake to a stop, reverse, go forward again.
    input.steer = i > 200 && i < 360 ? (i < 280 ? 1 : -1) : 0;
    input.brake = (i > 230 && i < 260) || (i > 500 && i < 800) ? 1 : 0;
    input.throttle = i > 500 && i < 800 ? 0 : 1;
    t += DT;
    car.step(DT, input, t);
    camera.update(DT, car);
    const p = camera.camera.position;
    // Movement beyond what the car itself did this frame.
    const carStep = car.speed * DT + 0.02;
    const extra = p.distanceTo(prev) - carStep;
    if (extra > worst) worstAt = i;
    worst = Math.max(worst, extra);
    worstYaw = Math.max(worstYaw, Math.abs(Math.atan2(Math.sin(camera.yaw - prevYaw.v), Math.cos(camera.yaw - prevYaw.v))));
    prev.copy(p);
    prevYaw.v = camera.yaw;
  }
  assert.ok(worst < 0.35, `largest extra camera move in a frame ${worst.toFixed(3)} m (frame ${worstAt})`);
  assert.ok(worstYaw < 0.08, `largest yaw step in a frame ${worstYaw.toFixed(3)} rad`);
});

test('a wall between the camera and the car pulls the camera in smoothly, never through it', () => {
  const track = new Track(EMERALD_COAST);
  const camera = new ChaseCamera(new THREE.PerspectiveCamera(64, 2, 0.3, 3000));
  camera.setTrack(track);
  // A car hard against the left barrier, turned 70 degrees away from it to the right: straight
  // behind it the camera would be out past the barrier.
  const car = carAt(track, 300, -(track.wallLimit - 0.2));
  car.heading -= 1.2;
  car.forward = 5;
  car.vel.x = Math.cos(car.heading) * 5;
  car.vel.y = -Math.sin(car.heading) * 5;
  camera.setView('chase', car);
  camera.yaw = car.heading;
  const proj = { i: -1 };
  let prev = null;
  for (let i = 0; i < 120; i++) {
    camera.update(DT, car);
    const p = camera.camera.position;
    track.project(p.x, p.z, proj.i, proj);
    assert.ok(Math.abs(proj.d) <= track.fenceOffset + 0.05, `frame ${i}: camera ${proj.d.toFixed(2)} m from centre, barrier at ${track.fenceOffset.toFixed(2)}`);
    if (prev) assert.ok(p.distanceTo(prev) < 0.6, `frame ${i}: no jump (${p.distanceTo(prev).toFixed(2)} m)`);
    prev = p.clone();
  }
  assert.ok(camera.reach < 1, 'the camera came in closer');
  // The way clears (car turned back along the road): the camera eases back out, not at once.
  car.heading += 1.2;
  camera.update(DT, car);
  const r1 = camera.reach;
  assert.ok(r1 < 0.98, 'eases out rather than popping back');
  for (let i = 0; i < 240; i++) camera.update(DT, car);
  assert.ok(camera.reach > 0.97, 'back out to full distance');
});
