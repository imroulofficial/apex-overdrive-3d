// Phone output stage (clipper curve) and touch steering latency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTPUT, softClipCurve } from '../src/audio/mixer.js';
import { Track } from '../src/race/track.js';
import { Vehicle, statsToParams } from '../src/race/vehicle.js';
import { EMERALD_COAST } from '../src/data/tracks.js';
import { BASE_STATS } from '../src/data/catalog.js';
import { createRaceInput, rampDigital, padToSteer, pedalDepth, PAD } from '../src/race/input.js';

test('safety clipper is unity below the knee and never exceeds the ceiling', () => {
  const c = softClipCurve();
  const n = c.length;
  const at = (x) => c[Math.round(((x + 1) / 2) * (n - 1))];
  for (const x of [-0.5, -0.25, 0, 0.25, 0.5]) assert.ok(Math.abs(at(x) - x) < 2e-3, `linear at ${x}`);
  for (const v of c) assert.ok(Math.abs(v) <= OUTPUT.ceiling + 1e-6);
  assert.ok(at(1) > OUTPUT.ceiling - 0.02, 'full scale lands near the ceiling');
  for (let i = 1; i < n; i++) assert.ok(c[i] >= c[i - 1], 'monotonic');
  assert.ok(20 * Math.log10(OUTPUT.ceiling) < -2, 'ceiling sits below -2 dBFS');
});

// Minimal element: listeners, classList, a 200 px wide box at the origin.
function el() {
  const on = {};
  return {
    on,
    style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener: (t, f) => (on[t] ??= []).push(f),
    setPointerCapture() {},
    querySelector: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    fire(t, e) {
      for (const f of on[t] ?? []) f({ preventDefault() {}, pointerId: 1, clientX: 0, clientY: 0, ...e });
    },
  };
}

function rig() {
  globalThis.window ??= { addEventListener() {} };
  const pad = el();
  const input = createRaceInput({ steerPad: pad, wheel: el(), brakes: [el()], nitro: el(), gas: el(), hud: el() });
  input.setEnabled(true);
  return { pad, input };
}

test('touch steering reaches full lock on the first frame and centres on release', () => {
  const { pad, input } = rig();
  pad.fire('pointerdown', { clientX: 180 });
  assert.equal(input.read(1 / 60).steer, 1);
  pad.fire('pointermove', { clientX: 20 });
  assert.equal(input.read(1 / 60).steer, -1, 'sliding across flips instantly');
  pad.fire('pointerup', {});
  assert.equal(input.read(1 / 60).steer, 0);
});

test('keyboard steering still ramps', () => {
  const s = rampDigital(0, 1, 1 / 60);
  assert.ok(s > 0 && s < 0.2);
});

test('touch pad is analog: gentle near the centre line, full lock across the outer part', () => {
  const { pad, input } = rig();
  pad.fire('pointerdown', { clientX: 103 }); // inside the dead zone
  assert.equal(input.read(1 / 60).steer, 0);
  pad.fire('pointermove', { clientX: 115 });
  const gentle = input.read(1 / 60).steer;
  assert.ok(gentle >= PAD.min && gentle < 0.75, `gentle ${gentle}`);
  pad.fire('pointermove', { clientX: 140 });
  const more = input.read(1 / 60).steer;
  assert.ok(more > gentle && more < 1);
  pad.fire('pointermove', { clientX: 170 });
  assert.equal(input.read(1 / 60).steer, 1);
  for (let u = -1; u <= 1; u += 0.05) assert.ok(Math.abs(padToSteer(u)) <= 1);
  assert.ok(padToSteer(-0.3) === -padToSteer(0.3), 'symmetric');
});

// Pedal elements carry the .pedal class.
function pedal() {
  const p = el();
  p.classList.contains = (c) => c === 'pedal';
  return p;
}

test('GAS pedal feathers: throttle follows how far up the pedal the thumb sits', () => {
  globalThis.window ??= { addEventListener() {} };
  const gas = pedal();
  const input = createRaceInput({ steerPad: el(), wheel: el(), brakes: [el()], nitro: el(), gas, hud: el() });
  input.setScheme('wheel'); // pedal scheme
  input.setEnabled(true);
  gas.fire('pointerdown', { clientY: 195 }); // near the bottom edge: light
  let t = 0;
  for (let i = 0; i < 30; i++) t = input.read(1 / 60).throttle;
  assert.ok(t > 0.3 && t < 0.4, `light ${t}`);
  gas.fire('pointermove', { clientY: 20 }); // top: full
  for (let i = 0; i < 30; i++) t = input.read(1 / 60).throttle;
  assert.equal(t, 1);
  gas.fire('pointermove', { clientY: 140 });
  t = input.read(1 / 60).throttle;
  assert.ok(Math.abs(t - pedalDepth(0.3)) < 1e-9, 'lifting is instant');
  gas.fire('pointerup', {});
  assert.equal(input.read(1 / 60).throttle, 0);
});

test('BRAKE pedal is analog, the DRIFT button is full brake', () => {
  globalThis.window ??= { addEventListener() {} };
  const drift = el();
  const brake = pedal();
  const input = createRaceInput({ steerPad: el(), wheel: el(), brakes: [drift, brake], nitro: el(), gas: el(), hud: el() });
  input.setScheme('tilt');
  input.setEnabled(true);
  brake.fire('pointerdown', { clientY: 170 });
  const r = input.read(1 / 60);
  assert.ok(r.brake > 0.3 && r.brake < 0.7, `part brake ${r.brake}`);
  assert.equal(r.brakePressed, true);
  brake.fire('pointerup', {});
  drift.fire('pointerdown', { clientY: 190 });
  assert.equal(input.read(1 / 60).brake, 1);
});

test('vehicle brake force follows the pedal', () => {
  const track = new Track(EMERALD_COAST);
  const decel = (brake) => {
    const v = new Vehicle(track, statsToParams(BASE_STATS));
    v.reset(200, 0);
    const f = track.frame(200, {});
    v.vel.set(f.tx * 40, f.tz * 40);
    v.heading = Math.atan2(-f.tz, f.tx);
    const before = v.speed;
    for (let i = 0; i < 30; i++) v.step(1 / 60, { steer: 0, throttle: 0, brake, brakePressed: false, nitroTaps: [] }, i / 60);
    return before - v.speed;
  };
  const light = decel(0.3);
  const full = decel(1);
  assert.ok(full > light * 2, `full ${full} light ${light}`);
  assert.ok(Math.abs(decel(true) - full) < 1e-6, 'bool brake = full');
});
