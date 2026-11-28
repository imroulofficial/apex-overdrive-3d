// Cockpit model, versionCode 73: the Blender-built cabin (tools/cockpit/) in three tiers chosen
// from the GPU tier, its budgets (triangles, textures, draw calls, download size), its moving
// parts, and that only a race loads it.
import './dom-stub.js';

globalThis.self ??= globalThis; // GLTFLoader looks for self.URL
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import * as THREE from 'three';
import { ChaseCamera, cockpitEye } from '../src/race/chaseCamera.js';
import { Cockpit, needleAngle, WHEEL_LOCK, HAND_TURN, SPEEDO_MAX, RPM_MAX, RIG } from '../src/race/cockpit.js';
import { COCKPIT_FILES, COCKPIT_PARTS, COCKPIT_TIERS, cockpitTier, parseCockpitAsset } from '../src/race/cockpitAsset.js';

const DT = 1 / 60;
const FILE = (tier) => new URL(`../public/assets/cockpit/${COCKPIT_FILES[tier]}`, import.meta.url);
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// glTF JSON and binary chunk of a .glb.
async function glb(tier) {
  const buf = await readFile(FILE(tier));
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  return { buf, json, bin: buf.subarray(binStart) };
}

// Width and height of a WebP image.
function webpSize(b) {
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WEBP');
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  throw new Error(`unknown WebP chunk ${kind}`);
}

function images(model) {
  const { json, bin } = model;
  return (json.images ?? []).map((img) => {
    const view = json.bufferViews[img.bufferView];
    const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    return { name: img.name, mime: img.mimeType, bytes: view.byteLength, ...webpSize(bytes) };
  });
}

function triangles(model) {
  let n = 0;
  for (const mesh of model.json.meshes) for (const p of mesh.primitives) n += model.json.accessors[p.indices].count / 3;
  return n;
}

// Parsed in node (textures cannot decode here, so materials come without maps; geometry, names
// and node transforms are real).
const assets = {};
for (const tier of COCKPIT_TIERS) {
  const buf = await readFile(FILE(tier));
  const err = console.error;
  console.error = () => {}; // "Couldn't load texture" in node
  assets[tier] = await parseCockpitAsset(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), tier);
  console.error = err;
}

function rig(tier) {
  const cam = new ChaseCamera(new THREE.PerspectiveCamera(64, 2, 0.3, 3000));
  cockpitEye(cam.size, cam.eye);
  const cockpit = new Cockpit({ tier, asset: assets[tier] });
  const car = { pos: new THREE.Vector3(10, 2, 5), heading: 0.4, pitch: 0 };
  return { cam, cockpit, car };
}

const meshesOf = (c) => {
  const list = [];
  c.group.traverse((o) => o.isMesh && list.push(o));
  return list;
};

test('quality tier from the GPU tier: low-end GPU -> low, High -> high, otherwise mid', () => {
  // Low-end: low on Auto (the auto pick may say 'high' for the resolution), high only when
  // the player chose Graphics: High by hand.
  assert.equal(cockpitTier({ lowEnd: true, quality: 'high' }), 'low');
  assert.equal(cockpitTier({ lowEnd: true, quality: 'high', manual: false }), 'low');
  assert.equal(cockpitTier({ lowEnd: true, quality: 'high', manual: true }), 'high');
  assert.equal(cockpitTier({ lowEnd: true, quality: 'medium', manual: true }), 'low');
  assert.equal(cockpitTier({ lowEnd: true, quality: 'low' }), 'low');
  assert.equal(cockpitTier({ lowEnd: false, quality: 'high' }), 'high');
  assert.equal(cockpitTier({ lowEnd: false, quality: 'medium' }), 'mid');
  assert.equal(cockpitTier({ lowEnd: false, quality: 'low' }), 'mid');
  assert.equal(cockpitTier(), 'mid');
  const { cockpit: low } = rig('low');
  const { cockpit: mid } = rig('mid');
  const { cockpit: high } = rig('high');
  assert.equal(low.lowEnd, true);
  // v76: no live mirror on any tier.
  for (const c of [low, mid, high]) {
    assert.equal(c.liveMirror, false);
    assert.equal(c.mirrorTarget, undefined);
  }
  // Materials per tier: unlit on low, Lambert without reflections on mid, PBR with them on high.
  const shell = (c) => meshesOf(c).find((m) => m.name === 'cockpit-shell').material;
  assert.ok(shell(low).isMeshBasicMaterial);
  assert.ok(shell(mid).isMeshLambertMaterial && shell(mid).normalMap !== undefined, 'mid: Lambert, no reflections');
  assert.ok(shell(high).isMeshStandardMaterial && shell(high).envMapIntensity > 0);
  // Every tier's mirrors are dark tinted glass (vertex colours), never a render target.
  for (const c of [low, mid, high]) {
    const glass = meshesOf(c).find((m) => m.name === 'cockpit-mirrors');
    assert.ok(glass.material.vertexColors && !glass.material.map && glass.geometry.attributes.color);
  }
  // Race picks the tier from the same GPU flag the ANR fix (F1) uses.
  return read('../src/race/Race.js').then((race) => {
    assert.match(race, /cockpitTier\(\{ lowEnd: this\.lowEnd, quality, manual \}\)/);
  });
});

test('every file has every part as one named mesh with one material (one draw each)', () => {
  for (const tier of COCKPIT_TIERS) {
    for (const name of COCKPIT_PARTS) {
      const m = assets[tier].parts[name];
      assert.ok(m?.isMesh, `${tier}: ${name}`);
      assert.ok(!Array.isArray(m.material), `${tier}: ${name} has one material`);
    }
  }
});

test('budgets: triangles, textures, draw calls, download size', async () => {
  const sizes = {};
  for (const tier of COCKPIT_TIERS) {
    const model = await glb(tier);
    sizes[tier] = (await stat(FILE(tier))).size;
    const tris = triangles(model);
    const imgs = images(model);
    const maxPx = Math.max(0, ...imgs.flatMap((i) => [i.w, i.h]));
    if (tier === 'low') {
      assert.ok(tris <= 15000, `low LOD ${tris} triangles <= 15k`);
      assert.ok(maxPx <= 512, `low textures ${maxPx}px <= 512`);
      assert.equal(imgs.length, 2, 'one baked colour atlas per material, nothing else');
      assert.ok(model.json.materials.filter((m) => m.extensions?.KHR_materials_unlit).length >= 2, 'unlit');
      assert.ok(!model.json.materials.some((m) => m.normalTexture || m.occlusionTexture), 'no normal or ORM maps');
    } else {
      assert.ok(tris <= 60000, `${tier} LOD ${tris} triangles <= 60k`);
      assert.ok(maxPx <= (tier === 'high' ? 1024 : 512), `${tier} textures ${maxPx}px`);
      assert.ok(model.json.materials.some((m) => m.normalTexture) && model.json.materials.some((m) => m.occlusionTexture), 'normal and ORM maps');
    }
    for (const i of imgs) assert.equal(i.mime, 'image/webp', `${tier} ${i.name} compressed`);
    assert.ok(model.json.extensionsUsed.includes('EXT_meshopt_compression'), 'meshopt compressed');
    // Few materials: two atlases, the tinted trim, and one plain material set at runtime.
    assert.ok(model.json.materials.length <= 4, `${tier}: ${model.json.materials.length} materials`);
    // Draw calls while the cockpit shows.
    const { cockpit } = rig(tier);
    const { draws } = cockpit.stats();
    assert.ok(draws <= (tier === 'low' ? 11 : 12), `${tier}: ${draws} draws`);
  }
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  assert.ok(total <= 8 * 1048576, `added download ${(total / 1048576).toFixed(2)} MB <= 8 MB`);
  assert.ok(sizes.low < sizes.mid && sizes.mid < sizes.high, 'each tier smaller than the one above');
});

test('the textures are made once, before the race: update() never creates one', () => {
  for (const tier of COCKPIT_TIERS) {
    const { cam, cockpit, car } = rig(tier);
    const textures = () => {
      const s = new Set();
      for (const m of meshesOf(cockpit)) {
        for (const v of [...Object.values(m.material), ...Object.values(m.material.uniforms ?? {}).map((u) => u.value)]) if (v?.isTexture) s.add(v);
      }
      return s;
    };
    const before = textures();
    for (let i = 0; i < 30; i++) cockpit.update(car, cam, DT, Math.sin(i), i * 9, 1000 + i * 200, 3, i / 30);
    assert.deepEqual(textures(), before);
    for (const m of meshesOf(cockpit)) {
      assert.equal(m.castShadow, false);
      assert.equal(m.frustumCulled, false);
    }
  }
});

test('moving parts follow the real values: wheel and gloved hands, needles, forearms', () => {
  for (const tier of COCKPIT_TIERS) {
    const { cam, cockpit, car } = rig(tier);
    // The wheel, hands, needles and forearms are the model's own meshes.
    const names = (o) => o.children.map((c) => c.name);
    assert.ok(names(cockpit.wheel).includes('cockpit-wheel-grip'));
    assert.ok(names(cockpit.hands).includes('cockpit-hands'));
    assert.ok(names(cockpit.speedNeedle).includes('cockpit-needle'));
    assert.equal(cockpit.speedNeedle.children[0].geometry, assets[tier].parts.cockpit_needle.geometry);
    for (let i = 0; i < 90; i++) cockpit.update(car, cam, DT, 1, 200, 6000, 4);
    assert.ok(Math.abs(cockpit.wheel.rotation.x - WHEEL_LOCK) < 0.01, `${tier}: wheel at full lock`);
    assert.equal(cockpit.hands.rotation.x, HAND_TURN);
    assert.ok(Math.abs(cockpit.speedNeedle.rotation.x - needleAngle(200 / SPEEDO_MAX)) < 1e-9);
    assert.ok(Math.abs(cockpit.rpmNeedle.rotation.x - needleAngle(6000 / RPM_MAX)) < 1e-9);
    assert.deepEqual(cockpit.displayUniforms.digits.value, [4, 2, 0, 0]);
    // The sleeve's far end reaches the glove's gauntlet wherever the hands are.
    cockpit.group.updateMatrixWorld(true);
    for (const [i, arm] of cockpit.forearms.entries()) {
      const tip = new THREE.Vector3(0, 1, 0).applyMatrix4(arm.matrix);
      const cuff = new THREE.Vector3(-0.12, 0.02, (i ? 1 : -1) * 0.1914).applyMatrix4(cockpit.hands.matrix).applyMatrix4(cockpit.wheelPivot.matrix);
      assert.ok(tip.distanceTo(cuff) < 0.005, `${tier} forearm ${i} reaches its glove`);
    }
  }
});

test('the model fits the rig: gloves on the rim, needles on their pivots, sleeves unit length', () => {
  const { parts } = assets.high;
  const box = (name) => {
    const m = parts[name];
    m.updateMatrix();
    return new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position).applyMatrix4(m.matrix);
  };
  // Hands (wheel frame): one on each side, round the rim at ten to two.
  const hands = box('cockpit_hands');
  assert.ok(hands.min.z < -0.15 && hands.max.z > 0.15, 'both hands');
  assert.ok(hands.max.y > 0.08 && hands.min.y > -0.1, 'at ten to two, above the spokes');
  const wheel = box('cockpit_wheel');
  assert.ok(Math.abs(wheel.max.z - 0.18) < 0.02 && Math.abs(wheel.max.y - 0.18) < 0.02, 'rim radius ~0.165 m');
  // Needle: pivot at its origin, pointing up the dial.
  const needle = box('cockpit_needle');
  assert.ok(needle.min.y < 0 && needle.max.y > 0.05 && Math.abs(needle.max.z) < 0.006);
  // Sleeves run from the elbow (origin) one unit along +y; the game stretches them.
  for (const name of ['cockpit_forearm_l', 'cockpit_forearm_r']) {
    const b = box(name);
    assert.ok(Math.abs(b.min.y) < 0.01 && Math.abs(b.max.y - 1) < 0.01, `${name} unit length`);
  }
  // The cabin stays out of the road ahead: nothing above the dash in the middle of the screen
  // except the rear-view mirror up at the roof.
  const shell = parts.cockpit_shell;
  shell.updateMatrix();
  const p = new THREE.Vector3();
  const pos = shell.geometry.attributes.position;
  let blocking = 0;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(shell.matrix);
    if (p.x <= 0.3) continue;
    const up = p.y / p.x; // tangent of the angle above the eye line
    const side = p.z / p.x;
    if (up > -0.2 && up < 0.3 && Math.abs(side - 0.15) < 0.5) blocking++;
  }
  assert.equal(blocking, 0, 'road ahead open');
  assert.deepEqual(RIG.wheelPivot, [0.56, -0.44, 0]);
});

test('only a race loads the model, before its warm-up; the garage never does', async () => {
  const race = await read('../src/race/Race.js');
  const prepare = race.slice(race.indexOf('  async prepare('), race.indexOf('  warmUp() {'));
  // The car's own cockpit loads with the car; the shared one is only a fallback (a car with
  // no cockpit file), both before the warm-up.
  assert.match(prepare, /const cockpitJob = loadCarCockpit\(car, \{ tier: this\.cockpitTier \}\)/);
  assert.match(prepare, /await this\.buildCockpit\(car, cockpitJob\)[\s\S]*\n  \}\n/);
  const build = race.slice(race.indexOf('  async buildCockpit('), race.indexOf('\n  }\n', race.indexOf('  async buildCockpit(')));
  assert.match(build, /new CarCockpit\(/);
  assert.match(build, /new Cockpit\(\{ lowEnd: this\.lowEnd, tier: this\.cockpitTier, asset: await loadCockpitAsset\(this\.cockpitTier\) \}\)/);
  assert.ok(race.indexOf('await this.buildCockpit(car, cockpitJob)') < race.indexOf('  warmUp() {'));
  for (const f of ['../src/main.js', '../src/garage/Garage.js', '../src/garage/showroom.js']) {
    assert.doesNotMatch(await read(f), /cockpitAsset|assets\/cockpit/, `${f} does not load the cockpit`);
  }
  // The warm-up draws every hidden object (the cockpit too) and uploads every texture.
  const warm = race.slice(race.indexOf('  warmUp() {'), race.indexOf('  start() {'));
  assert.match(warm, /r\.initTexture\(t\)/);
  assert.match(warm, /r\.compile\(scene, this\.camera\)/);
});
