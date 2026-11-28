// versionCode 76: the driver's view of every car's own cabin. The roof and pillars come from a
// clean frame fitted to the car's glass (race/cabinFrame.js), the player body is cut away in
// the greenhouse (raceCars.js cabinClip), the eye sits at a real seat's distance from the wheel,
// and the race world stays loaded in the garage when the phone has the memory (raceKeep.js).
import './dom-stub.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { fitGlass, clipBox, frameGeometry, driverEye, SEAT } from '../src/race/cabinFrame.js';
import { cabinClip, PLAYER_CABIN, clearCabinClip } from '../src/race/raceCars.js';
import { keepRaceInGarage, RACE_KEEP } from '../src/race/raceKeep.js';
import { COCKPIT } from '../src/race/chaseCamera.js';

globalThis.self ??= globalThis;
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

// A coupe's glass: windscreen from (0.7, 0.95) up to (0.25, 1.3), side glass back to -0.6.
function coupe() {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    for (const z of [-0.75, -0.4, 0, 0.4, 0.75]) pts.push(new THREE.Vector3(0.7 - 0.45 * t, 0.95 + 0.35 * t, z * (1 - 0.15 * t)));
  }
  const side = [];
  for (const s of [-1, 1]) for (const x of [-0.6, 0, 0.6]) for (const y of [0.9, 1.25]) side.push(new THREE.Vector3(x, y, s * 0.78));
  return { pts, side };
}

test('cabin frame: fitted to the glass, the body cut only inside the greenhouse', () => {
  const { pts, side } = coupe();
  const fit = fitGlass(pts, side, [-0.3, 1.1, -0.38]);
  assert.ok(Math.abs(fit.xb - 0.7) < 1e-6 && Math.abs(fit.yb - 0.95) < 1e-6, 'windscreen base');
  assert.ok(Math.abs(fit.xt - 0.25) < 0.06 && Math.abs(fit.yt - 1.3) < 1e-6, `windscreen top ${fit.xt}`);
  const box = clipBox(fit);
  // The bonnet (ahead of and below the windscreen base) and the wing mirrors stay.
  assert.ok(!box.containsPoint(new THREE.Vector3(1.2, 0.9, 0)));
  assert.ok(!box.containsPoint(new THREE.Vector3(0.6, 0.94, -0.95)));
  // The roof and the pillars go.
  assert.ok(box.containsPoint(new THREE.Vector3(0, 1.35, 0)));
  assert.ok(box.containsPoint(new THREE.Vector3(0.5, 1.1, -0.7)));
  const g = frameGeometry(fit);
  const n = g.attributes.position.count;
  assert.ok(n > 0 && n / 3 < 800, `${n / 3} triangles`);
  for (const v of g.attributes.position.array) assert.ok(Number.isFinite(v));
  // An open car (no windscreen ahead of the eye) gets no frame.
  assert.equal(fitGlass([new THREE.Vector3(-1, 1, 0)], [], [-0.3, 1, 0]), null);
});

test('driver\'s eye: a real seat\'s distance behind and above the wheel, under the roof', () => {
  const eye = driverEye([-0.2, 1.06, -0.38], [0.18, 0.85, -0.38], 1.25);
  assert.ok(Math.abs(eye[0] - (0.18 - SEAT.behind)) < 1e-9);
  assert.ok(Math.abs(eye[1] - Math.min(0.85 + SEAT.above, 1.25 - SEAT.headroom)) < 1e-9);
  assert.equal(eye[2], -0.38);
  // Never forward or lower than the file's own eye.
  assert.deepEqual(driverEye([-0.9, 1.4, 0], [0.1, 0.8, 0], 2), [-0.9, 1.4, 0]);
  // A real seat's field of view (vertical, degrees): 58 at rest.
  assert.equal(64 + COCKPIT.fov, 58);
});

test('cabin cut: only the materials it is given, a uniform that cuts nothing at rest', () => {
  const m = new THREE.MeshLambertMaterial();
  cabinClip(m);
  cabinClip(m);
  assert.match(m.customProgramCacheKey(), /\|cabin$/);
  assert.doesNotMatch(m.customProgramCacheKey(), /\|cabin\|cabin/);
  const shader = { uniforms: {}, vertexShader: 'void main() {\n#include <project_vertex>\n}', fragmentShader: 'void main() {\n}' };
  m.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /vCabin = \(uCabin \* vec4\(mvPosition\.xyz, 1\.0\)\)\.xyz;/);
  assert.match(shader.fragmentShader, /discard/);
  assert.equal(shader.uniforms.uCabin, PLAYER_CABIN);
  clearCabinClip();
  const p = new THREE.Vector3(0.1, 0.2, -3).applyMatrix4(PLAYER_CABIN.value);
  assert.ok(Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) > 1, 'nothing cut at rest');
});

test('race world kept in the garage when the phone has the memory', async () => {
  const race = { ready: true };
  assert.equal(keepRaceInGarage(race, 4), true);
  assert.equal(keepRaceInGarage(race, undefined), true);
  assert.equal(keepRaceInGarage(race, RACE_KEEP.minMemoryGB - 1), false);
  assert.equal(keepRaceInGarage(null, 8), false);
  const main = await read('../src/main.js');
  assert.match(main, /if \(race && !keepRaceInGarage\(race\)\) \{/);
  assert.match(main, /race\.def !== track \|\| race\.quality !== garage\.qualityLevel \|\| race\.manual !== manual/);
});
