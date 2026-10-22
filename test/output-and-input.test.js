// Phone output stage (clipper curve) and touch steering latency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTPUT, softClipCurve } from '../src/audio/mixer.js';
import { createRaceInput, rampDigital } from '../src/race/input.js';

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
