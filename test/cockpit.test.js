// Cockpit view, versionCode 72: three camera views (Chase -> Close -> Cockpit, the same three in
// Settings), saved "hood" / "driver" views migrate to "cockpit" with nothing else in the save
// touched, and the shared cockpit: wheel, hands, needles, gear and shift lights follow the real
// values; it draws on top of the world; it stays light; low-end GPUs get no live mirror pass.
// Since versionCode 73 the cockpit is the Blender model (test/cockpit-model.test.js has its
// tiers and budgets); these tests run on its mid and low tiers.
import './dom-stub.js';

globalThis.self ??= globalThis; // GLTFLoader looks for self.URL
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { ChaseCamera, HEAD, cockpitEye } from '../src/race/chaseCamera.js';
import { Cockpit, needleAngle, shiftLit, gearGlyph, WHEEL_LOCK, HAND_TURN, SPEEDO_MAX, RPM_MAX, RPM_RED, SHIFT_LIGHTS, SHIFT_FROM, GLYPH, MIRROR } from '../src/race/cockpit.js';
import { Rain, LensDrops } from '../src/race/atmosphere.js';
import { CAMERA_VIEWS, CAMERA_LABELS } from '../src/data/controls.js';
import { normalize, defaults } from '../src/core/saveSchema.js';
import { COCKPIT_FILES, parseCockpitAsset } from '../src/race/cockpitAsset.js';

const DT = 1 / 60;
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// The model's mid and low tiers (textures cannot decode in node; geometry and names are real).
const assets = {};
for (const tier of ['mid', 'low']) {
  const buf = await readFile(new URL(`../public/assets/cockpit/${COCKPIT_FILES[tier]}`, import.meta.url));
  const err = console.error;
  console.error = () => {};
  assets[tier] = await parseCockpitAsset(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), tier);
  console.error = err;
}
const makeCockpit = (lowEnd = false) => new Cockpit({ lowEnd, asset: assets[lowEnd ? 'low' : 'mid'] });

function cockpitRig(lowEnd = false) {
  const cam = new ChaseCamera(new THREE.PerspectiveCamera(64, 2, 0.3, 3000));
  cockpitEye(cam.size, cam.eye);
  const cockpit = makeCockpit(lowEnd);
  const car = { pos: new THREE.Vector3(10, 2, 5), heading: 0.4, pitch: 0 };
  return { cam, cockpit, car };
}

const meshesOf = (c) => {
  const list = [];
  c.group.traverse((o) => o.isMesh && list.push(o));
  return list;
};

test('only three camera views, cycled by the button and offered in Settings', async () => {
  assert.deepEqual(CAMERA_VIEWS, ['chase', 'close', 'cockpit']);
  assert.deepEqual(Object.keys(CAMERA_LABELS), CAMERA_VIEWS);
  // The HUD button steps through CAMERA_VIEWS in order and wraps.
  const main = await read('../src/main.js');
  assert.match(main, /CAMERA_VIEWS\[\(i \+ 1\) % CAMERA_VIEWS\.length\]/);
  const cycle = [];
  let v = 'chase';
  for (let k = 0; k < 4; k++) {
    cycle.push(v);
    v = CAMERA_VIEWS[(CAMERA_VIEWS.indexOf(v) + 1) % CAMERA_VIEWS.length];
  }
  assert.deepEqual(cycle, ['chase', 'close', 'cockpit', 'chase']);
  // Settings -> Camera: the same three, and three pips on the HUD button.
  const html = await read('../index.html');
  const settings = html.slice(html.indexOf('id="camera-options"'), html.indexOf('</div>', html.indexOf('id="camera-options"')));
  assert.deepEqual([...settings.matchAll(/data-camera="(\w+)"/g)].map((m) => m[1]), CAMERA_VIEWS);
  assert.doesNotMatch(html, /data-camera="hood"/);
  const pips = html.match(/<i class="rh-cam-pips"[^>]*>(.*?)<\/i>/)[1];
  assert.equal(pips.match(/<b><\/b>/g).length, 3);
  const css = await read('../src/ui/style.css');
  assert.doesNotMatch(css, /data-view='hood'/);
  assert.match(css, /data-view='cockpit'\] \.rh-cam-pips b:nth-child\(3\)/);
});

test('a saved "hood" or "driver" view becomes "cockpit"; nothing else in the save changes', () => {
  for (const old of ['hood', 'driver']) {
    const save = defaults();
    save.coins = 1234;
    save.settings = { ...save.settings, cameraView: old, quality: 'low', sound: false, controls: 'tilt', bloom: 'medium' };
    const before = JSON.parse(JSON.stringify(save));
    const after = normalize(JSON.parse(JSON.stringify(save)));
    assert.equal(after.settings.cameraView, 'cockpit', `${old} -> cockpit`);
    // Everything else is exactly what normalize gives the same save with a valid view.
    const control = normalize({ ...JSON.parse(JSON.stringify(before)), settings: { ...before.settings, cameraView: 'cockpit' } });
    assert.deepEqual(after, control);
    assert.equal(after.coins, 1234);
    assert.equal(after.settings.controls, 'tilt');
    assert.equal(after.settings.bloom, 'medium');
  }
  // Valid views are kept; anything unknown still falls back to chase.
  for (const view of CAMERA_VIEWS) {
    const s = defaults();
    s.settings.cameraView = view;
    assert.equal(normalize(s).settings.cameraView, view);
  }
  const bad = defaults();
  bad.settings.cameraView = 'helicopter';
  assert.equal(normalize(bad).settings.cameraView, 'chase');
});

test('wheel and hands turn smoothly with the steering; forearms stay attached to the gloves', () => {
  const { cam, cockpit, car } = cockpitRig();
  cockpit.update(car, cam, DT, 1, 0, 1000);
  assert.ok(cockpit.wheel.rotation.x > 0 && cockpit.wheel.rotation.x < WHEEL_LOCK * 0.5, 'eases toward the lock');
  for (let i = 0; i < 60; i++) cockpit.update(car, cam, DT, 1, 0, 1000);
  assert.ok(Math.abs(cockpit.wheel.rotation.x - WHEEL_LOCK) < 0.01, 'full right lock');
  assert.equal(cockpit.hands.rotation.x, HAND_TURN, 'hands turn with the rim, then it slides through');
  for (let i = 0; i < 60; i++) cockpit.update(car, cam, DT, -1, 0, 1000);
  assert.ok(Math.abs(cockpit.wheel.rotation.x + WHEEL_LOCK) < 0.01, 'full left lock');
  assert.equal(cockpit.hands.rotation.x, -HAND_TURN);
  for (let i = 0; i < 60; i++) cockpit.update(car, cam, DT, 0.2, 0, 1000);
  assert.ok(Math.abs(cockpit.hands.rotation.x - cockpit.wheel.rotation.x) < 1e-9, 'small inputs: hands and rim together');
  // Each forearm's far end is at its cuff on the turned hands.
  cockpit.group.updateMatrixWorld(true);
  for (const [i, arm] of cockpit.forearms.entries()) {
    const tip = new THREE.Vector3(0, 1, 0).applyMatrix4(arm.matrix);
    assert.ok(Number.isFinite(tip.x + tip.y + tip.z));
    const cuff = new THREE.Vector3(-0.12, 0.02, (i ? 1 : -1) * 0.2).applyMatrix4(cockpit.hands.matrix).applyMatrix4(cockpit.wheelPivot.matrix);
    assert.ok(tip.distanceTo(cuff) < 0.03, `forearm ${i} reaches its glove (${tip.distanceTo(cuff).toFixed(3)} m)`);
  }
  // The cabin sits at the driver's eye in the car's frame.
  const eye = cam.carPoint(car, cam.eye.x, cam.eye.y, cam.eye.z, new THREE.Vector3());
  assert.ok(cockpit.group.position.distanceTo(eye) < 1e-9);
});

test('needles, digital speed, gear and shift lights follow the real speed, RPM and gear', () => {
  const { cam, cockpit, car } = cockpitRig();
  const u = cockpit.displayUniforms;
  cockpit.update(car, cam, DT, 0, 0, 0, gearGlyph(0, true));
  assert.equal(cockpit.speedNeedle.rotation.x, needleAngle(0));
  assert.deepEqual(u.digits.value, [GLYPH.N, GLYPH.BLANK, GLYPH.BLANK, 0], 'N on the grid, 0 km/h');
  assert.equal(u.lit.value, 0);
  cockpit.update(car, cam, DT, 0, 160, 4000, gearGlyph(2));
  assert.ok(Math.abs(cockpit.speedNeedle.rotation.x - needleAngle(160 / SPEEDO_MAX)) < 1e-9);
  assert.ok(Math.abs(cockpit.speedNeedle.rotation.x) < 0.01, 'half the dial points straight up');
  assert.ok(Math.abs(cockpit.rpmNeedle.rotation.x - needleAngle(4000 / RPM_MAX)) < 1e-9);
  assert.deepEqual(u.digits.value, [3, 1, 6, 0], 'gear 3, 160 km/h');
  cockpit.update(car, cam, DT, 0, 7.4, 1200, gearGlyph(0, false, true));
  assert.deepEqual(u.digits.value, [GLYPH.R, GLYPH.BLANK, GLYPH.BLANK, 7], 'R reversing, no leading zeros');
  cockpit.update(car, cam, DT, 0, 287, 6200, gearGlyph(5));
  assert.deepEqual(u.digits.value, [6, 2, 8, 7]);
  // Shift lights: none below SHIFT_FROM, filling with RPM, all lit at the red line.
  assert.equal(shiftLit(SHIFT_FROM - 1), 0);
  assert.equal(shiftLit(RPM_RED), SHIFT_LIGHTS);
  let prev = -1;
  for (let rpm = 3000; rpm <= 8000; rpm += 250) {
    cockpit.update(car, cam, DT, 0, 200, rpm, 5);
    assert.ok(u.lit.value >= prev, 'fills as RPM rises');
    assert.equal(u.lit.value, shiftLit(rpm));
    prev = u.lit.value;
  }
  // On the limiter they flash.
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    cockpit.update(car, cam, DT, 0, 250, 7800, 5);
    seen.add(u.flash.value);
  }
  assert.deepEqual([...seen].sort(), [0, 1]);
  cockpit.update(car, cam, DT, 0, 250, 6000, 5);
  assert.equal(u.flash.value, 0);
  // Night and tunnels: the backlight eases up.
  const day = u.glow.value;
  for (let i = 0; i < 120; i++) cockpit.update(car, cam, DT, 0, 100, 3000, 3, 1);
  assert.ok(u.glow.value > 0.9 && day < 0.1, 'gauge backlight glows at night');
});

test('the cockpit draws on top of the world (a rival overlapping the car never shows inside)', async () => {
  for (const lowEnd of [false, true]) {
    const { cockpit } = cockpitRig(lowEnd);
    for (const m of meshesOf(cockpit)) {
      const mat = m.material;
      const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader };
      if (mat.isShaderMaterial) shader.vertexShader = mat.vertexShader;
      else mat.onBeforeCompile(shader);
      assert.match(shader.vertexShader, /gl_Position\.z = mix\(-gl_Position\.w, gl_Position\.z, 0\.1\);/, `${m.name} squeezes its depth to the front`);
      assert.equal(mat.fog, false, `${m.name}: no fog in the cabin`);
      assert.deepEqual(m.layers.mask, 1 << 1, `${m.name} on the cockpit layer only`);
      assert.equal(m.frustumCulled, false);
    }
  }
  // The mapping keeps the near-plane clip distance proportional (no broken triangles) and puts
  // everything in the cabin in front of anything farther than ~0.33 m.
  const near = 0.3;
  const far = 3200;
  const ndc = (d) => (far + near) / (far - near) - (2 * far * near) / ((far - near) * d);
  const squeezed = (d) => -1 + 0.1 * (ndc(d) + 1);
  assert.ok(squeezed(1.6) < ndc(0.34), 'the far end of the cabin is in front of a car 0.34 m away');
  const race = await read('../src/race/Race.js');
  assert.match(race, /this\.camera\.layers\.enable\(1\)/, 'the race camera sees the cockpit layer');
});

test('light: few draws, textures made once, simplest version on low-end GPUs', () => {
  const full = makeCockpit();
  const low = makeCockpit(true);
  for (const [c, maxDraws] of [[full, 12], [low, 11]]) {
    const meshes = meshesOf(c);
    assert.ok(meshes.length <= maxDraws, `${meshes.length} draws`);
    const textures = new Set();
    for (const m of meshes) {
      for (const v of Object.values(m.material)) if (v?.isTexture) textures.add(v);
      for (const u of Object.values(m.material.uniforms ?? {})) if (u.value?.isTexture) textures.add(u.value);
      assert.equal(m.castShadow, false);
      assert.equal(m.receiveShadow, false);
    }
    // The cluster face is the only texture drawn in code, within 512 px.
    for (const t of textures) if (t.image?.width) assert.ok(t.image.width <= 512 && t.image.height <= 512, `texture ${t.image.width}x${t.image.height} within 512 px`);
    // All of them are made in the constructor; update() never makes another.
    const before = textures.size;
    const cam = new ChaseCamera(new THREE.PerspectiveCamera(64, 2, 0.3, 3000));
    for (let i = 0; i < 30; i++) c.update({ pos: new THREE.Vector3(), heading: 0, pitch: 0 }, cam, DT, Math.sin(i), i * 9, 1000 + i * 200, 3, i / 30);
    const after = new Set();
    for (const m of meshesOf(c)) for (const v of [...Object.values(m.material), ...Object.values(m.material.uniforms ?? {}).map((u) => u.value)]) if (v?.isTexture) after.add(v);
    assert.equal(after.size, before);
  }
  // Low-end: unlit (Basic, or the cluster's own unlit shader), no windscreen sheen.
  for (const m of meshesOf(low)) assert.ok(m.material.isMeshBasicMaterial || m.material.isShaderMaterial, `${m.name}: unlit on low-end`);
  assert.ok(!meshesOf(low).some((m) => m.name === 'cockpit-glass'));
  assert.ok(meshesOf(full).some((m) => m.name === 'cockpit-glass'));
  const tris = (c) => c.stats().triangles;
  assert.ok(tris(low) < tris(full) * 0.35, `low-end has fewer details (${tris(low)} vs ${tris(full)} triangles)`);
});

test('live mirror: one small render every 2nd frame on mid/high GPUs, never on low-end', () => {
  const renders = [];
  const fakeRenderer = (log) => ({
    shadowMap: { autoUpdate: true },
    target: null,
    getRenderTarget() {
      return this.target;
    },
    setRenderTarget(t) {
      this.target = t;
    },
    render(scene, camera) {
      log.push({ target: this.target, camera, shadows: this.shadowMap.autoUpdate });
    },
  });
  const scene = new THREE.Scene();
  // Low-end: no target, no camera, no render, even when forced (the warm-up).
  const low = makeCockpit(true);
  const lowLog = [];
  assert.equal(low.liveMirror, false);
  assert.equal(low.mirrorTarget, undefined);
  low.setVisible(true);
  for (let i = 0; i < 10; i++) low.renderMirror(fakeRenderer(lowLog), scene);
  low.renderMirror(fakeRenderer(lowLog), scene, true);
  assert.equal(lowLog.length, 0, 'no live mirror pass on low-end');
  const glass = meshesOf(low).find((m) => m.name === 'cockpit-mirrors');
  assert.ok(glass.material.vertexColors && !glass.material.map, 'low-end mirrors show a sky gradient');

  const full = makeCockpit();
  const r = fakeRenderer(renders);
  assert.equal(full.mirrorTarget.width, MIRROR.width);
  assert.equal(full.mirrorTarget.height, MIRROR.height);
  assert.ok(MIRROR.width <= 256 && MIRROR.height <= 128, 'low resolution');
  full.renderMirror(r, scene);
  assert.equal(renders.length, 0, 'nothing while the cockpit is hidden');
  full.setVisible(true);
  for (let i = 0; i < 10; i++) full.renderMirror(r, scene);
  assert.equal(renders.length, 10 / MIRROR.every, 'every 2nd frame');
  for (const e of renders) {
    assert.equal(e.target, full.mirrorTarget);
    assert.equal(e.shadows, false, 'reuses the shadow map');
    assert.equal(e.camera.far, MIRROR.far, 'limited draw distance');
    assert.equal(e.camera.layers.test(full.group.children[0].layers), false, 'never draws the cabin');
  }
  assert.equal(r.target, null, 'back to the main target');
  assert.equal(r.shadowMap.autoUpdate, true);
});

test('Race: mirror only while the cockpit shows, warmed up before the race, speed lines outside', async () => {
  const race = await read('../src/race/Race.js');
  const render = race.slice(race.indexOf('  render() {'), race.indexOf('  trackPerformance('));
  assert.match(render, /if \(this\.cockpitShown\) this\.cockpit\.renderMirror\(this\.renderer, this\.scene\)/);
  const warm = race.slice(race.indexOf('  warmUp() {'), race.indexOf('  start() {'));
  assert.match(warm, /this\.cockpit\.renderMirror\(r, scene, true\)/);
  const upd = race.slice(race.indexOf('  updateCockpit(dt, input) {'), race.indexOf('  updateEngine('));
  assert.match(upd, /this\.lens\.setGlass\(shown\)/);
  assert.match(upd, /this\.rain\.setCabin\(shown\)/);
  assert.match(upd, /this\.speedLines\.material\.depthTest = shown/);
  assert.match(upd, /gearGlyph\(this\.gearbox\.gear/);
});

test('rain in the cockpit: drops on the windscreen, no streaks falling inside the cabin', () => {
  const scene = new THREE.Scene();
  const rain = new Rain(scene, 'low');
  const near = rain.uniforms.near.value;
  assert.ok(near.x <= 1.2);
  rain.setCabin(true);
  assert.ok(near.x >= 2.2, `streaks start past the windscreen (${near.x} m)`);
  rain.setCabin(false);
  assert.equal(near.x, 1.2);
  const classes = new Set();
  const parent = { appendChild() {} };
  globalThis.document.createElement ??= () => ({});
  const lens = new LensDrops(parent);
  lens.el.classList = { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) };
  lens.setGlass(true);
  assert.ok(classes.has('windscreen'));
  lens.setGlass(false);
  assert.ok(!classes.has('windscreen'));
});

test('cockpit head motion is gentle: braking, cornering, landing and nitro stay within a few cm', () => {
  const camera = new ChaseCamera(new THREE.PerspectiveCamera(64, 2, 0.3, 3000));
  camera.setView('cockpit');
  camera.mode = 'chase';
  const car = { pos: new THREE.Vector3(), heading: 0, pitch: 0, speed: 70, forward: 70, vel: new THREE.Vector2(70, 0), airborne: false };
  let maxX = 0;
  let maxZ = 0;
  let maxY = 0;
  let prev = null;
  let maxStep = 0;
  for (let i = 0; i < 600; i++) {
    if (i < 120) car.forward = car.speed = Math.max(5, car.forward - 35 * DT); // hard braking
    else if (i < 240) car.heading += 1.2 * DT; // hard corner
    else if (i < 260) car.airborne = true; // a jump
    else car.airborne = false;
    camera.update(DT, car, { boostTier: i > 300 && i < 400 ? 2 : 0 });
    const h = camera.head;
    maxX = Math.max(maxX, Math.abs(h.x));
    maxY = Math.max(maxY, Math.abs(h.y));
    maxZ = Math.max(maxZ, Math.abs(h.z));
    if (prev) maxStep = Math.max(maxStep, Math.hypot(h.x - prev.x, h.y - prev.y, h.z - prev.z));
    prev = { x: h.x, y: h.y, z: h.z };
  }
  assert.ok(maxX > 0.01, 'leans under braking');
  assert.ok(maxZ > 0.005, 'leans in the turn');
  assert.ok(maxX <= HEAD.maxFwd + 1e-9 && maxZ <= HEAD.maxLean + 1e-9, `limited (${maxX.toFixed(3)}, ${maxZ.toFixed(3)})`);
  assert.ok(maxY <= HEAD.land + 0.02, `landing dip limited (${maxY.toFixed(3)})`);
  assert.ok(maxStep < 0.01, `no jolts (${maxStep.toFixed(4)} m per frame)`);
  // It never turns the view: the camera still looks straight down the nose.
  assert.equal(camera.free.yaw, 0);
});
