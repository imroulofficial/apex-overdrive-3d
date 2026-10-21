// Touch + keyboard driving input. Steering is a single pad split into left/right halves, so a
// thumb can slide across without lifting. The drift button doubles as the brake; nitro taps
// are timestamped so the vehicle can judge the double-tap sweet spot. With Auto-accelerate off
// (Settings), a GAS pedal appears and W / Up become the throttle instead of nitro.

const now = () => performance.now() / 1000;

export function createRaceInput({ steerPad, drift, nitro, gas, hud }) {
  const pointers = new Map();
  const keys = new Set();
  const st = { touchLeft: false, touchRight: false, touchBrake: false, touchGas: false, brakePressed: false, taps: [], steer: 0, throttle: 0, enabled: false, auto: true };
  const out = { steer: 0, throttle: 1, brake: false, brakePressed: false, nitroTaps: [] };

  const sideOf = (e) => {
    const r = steerPad.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? -1 : 1;
  };
  const refresh = () => {
    const sides = [...pointers.values()];
    st.touchLeft = sides.includes(-1);
    st.touchRight = sides.includes(1);
    steerPad.classList.toggle('left-on', st.touchLeft);
    steerPad.classList.toggle('right-on', st.touchRight);
  };
  steerPad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    steerPad.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, sideOf(e));
    refresh();
  });
  steerPad.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const side = sideOf(e);
    if (side !== pointers.get(e.pointerId)) {
      pointers.set(e.pointerId, side);
      refresh();
    }
  });
  const release = (e) => {
    if (pointers.delete(e.pointerId)) refresh();
  };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => steerPad.addEventListener(t, release));

  const brakeDown = () => {
    if (!st.touchBrake) st.brakePressed = true;
    st.touchBrake = true;
    drift.classList.add('is-pressed');
  };
  const brakeUp = () => {
    st.touchBrake = false;
    drift.classList.remove('is-pressed');
  };
  drift.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    drift.setPointerCapture(e.pointerId);
    brakeDown();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => drift.addEventListener(t, brakeUp));

  const gasUp = () => {
    st.touchGas = false;
    gas.classList.remove('is-pressed');
  };
  gas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    gas.setPointerCapture(e.pointerId);
    st.touchGas = true;
    gas.classList.add('is-pressed');
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => gas.addEventListener(t, gasUp));

  const tap = () => {
    if (!st.enabled) return;
    st.taps.push(now());
    nitro.classList.remove('is-pressed');
    void nitro.offsetWidth;
    nitro.classList.add('is-pressed');
  };
  nitro.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    tap();
  });

  const KEY_LEFT = ['ArrowLeft', 'KeyA'];
  const KEY_RIGHT = ['ArrowRight', 'KeyD'];
  const KEY_BRAKE = ['Space', 'ArrowDown', 'KeyS'];
  const KEY_GAS = ['ArrowUp', 'KeyW'];
  const KEY_NITRO = ['KeyN', 'ShiftLeft', 'ShiftRight'];
  const isNitroKey = (code) => KEY_NITRO.includes(code) || (st.auto && KEY_GAS.includes(code));
  window.addEventListener('keydown', (e) => {
    if (!st.enabled) return;
    if ([...KEY_LEFT, ...KEY_RIGHT, ...KEY_BRAKE, ...KEY_GAS, ...KEY_NITRO].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (KEY_BRAKE.includes(e.code)) st.brakePressed = true;
    if (isNitroKey(e.code)) tap();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  const anyKey = (list) => list.some((k) => keys.has(k));

  return {
    get steerValue() {
      return st.steer;
    },
    setEnabled(on) {
      st.enabled = on;
      if (!on) this.reset();
    },
    // Auto-accelerate on (default) or off: off shows the GAS pedal.
    setAutoAccelerate(on) {
      st.auto = on;
      hud.classList.toggle('manual-throttle', !on);
    },
    reset() {
      pointers.clear();
      keys.clear();
      refresh();
      brakeUp();
      gasUp();
      st.throttle = 0;
      st.taps.length = 0;
      st.brakePressed = false;
      st.steer = 0;
    },
    // Smoothed input for this frame. Edge events (brake press, nitro taps) are consumed.
    read(dt) {
      const left = st.touchLeft || anyKey(KEY_LEFT);
      const right = st.touchRight || anyKey(KEY_RIGHT);
      const target = (right ? 1 : 0) - (left ? 1 : 0);
      const reversing = target !== 0 && Math.sign(target) !== Math.sign(st.steer) && st.steer !== 0;
      const rate = target === 0 ? 8 : reversing ? 12 : 5.5;
      const d = target - st.steer;
      st.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
      out.steer = st.enabled ? st.steer : 0;
      out.brake = st.enabled && (st.touchBrake || anyKey(KEY_BRAKE));
      // The pedal eases in and snaps off, like a throttle body.
      const pedal = st.auto || st.touchGas || anyKey(KEY_GAS) ? 1 : 0;
      st.throttle = pedal ? Math.min(1, st.throttle + dt * 6) : 0;
      out.throttle = st.enabled ? st.throttle : 0;
      out.brakePressed = st.enabled && st.brakePressed;
      st.brakePressed = false;
      out.nitroTaps.length = 0;
      if (st.enabled) out.nitroTaps.push(...st.taps);
      st.taps.length = 0;
      return out;
    },
  };
}
