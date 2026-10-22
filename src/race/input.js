// Driving input: three touch control schemes (Settings → Controls) plus the keyboard.
//
//   touch  Touch Drive (default): a steering pad split into left/right halves, so a thumb can
//          slide across without lifting. Auto-accelerate applies.
//   tilt   Tilt-to-Steer: roll the phone like a wheel. Gravity from the accelerometer gives the
//          absolute angle and the gyroscope's rate keeps it quick and steady (a complementary
//          filter); GAS and BRAKE pedals on screen.
//   wheel  Virtual Steering Wheel: an analog rotary wheel on the left that springs back to
//          centre when released; pedals on the right.
//
// The drift button doubles as the brake (Tilt also gets a big BRAKE pedal on the left). Nitro
// taps are timestamped so the vehicle can judge the double-tap sweet spot. Pedal schemes, or
// Auto-accelerate off, show the GAS pedal and make W / Up the throttle instead of nitro.

import { CONTROL_SCHEMES } from '../data/controls.js';

export { CONTROL_SCHEMES };
const now = () => performance.now() / 1000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const DEG = Math.PI / 180;

export const TILT = { full: 24 * DEG, deadzone: 1.5 * DEG, gyroWeight: 0.92, slew: 14 }; // slew: steer units/s
export const WHEEL = { lock: 120, full: 95, returnRate: 9 }; // degrees; spring-back per second

// Roll of the screen's horizontal axis away from level, in radians (+ = turned clockwise, i.e.
// steering right), from accelerationIncludingGravity in device axes and the screen rotation
// (screen.orientation.angle, degrees). Android reports the upward reaction to gravity; iOS the
// opposite, so `flip` = -1 there.
export function rollFromGravity({ x, y, z }, screenAngle, flip = 1) {
  const a = screenAngle * DEG;
  const sx = (x * Math.cos(a) - y * Math.sin(a)) * flip;
  const g = Math.hypot(x, y, z) || 9.81;
  return Math.asin(clamp(-sx / g, -1, 1));
}

// Tilt angle -> steering -1..1 with a small dead zone around level.
export function tiltToSteer(angle) {
  const m = Math.max(0, Math.abs(angle) - TILT.deadzone) / (TILT.full - TILT.deadzone);
  return Math.sign(angle) * Math.min(1, m);
}

// Keyboard steering eases toward full lock (faster back through centre) so a tap is a nudge.
export function rampDigital(steer, target, dt) {
  const reversing = target !== 0 && Math.sign(target) !== Math.sign(steer) && steer !== 0;
  const rate = target === 0 ? 8 : reversing ? 12 : 5.5;
  const d = target - steer;
  return steer + Math.sign(d) * Math.min(Math.abs(d), rate * dt);
}

const IOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

// Device motion: tilt angle with a gyro-assisted complementary filter.
function createTilt() {
  const t = { angle: 0, have: false, last: 0, listening: false };
  const onMotion = (e) => {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null) return;
    const screenAngle = screen.orientation?.angle ?? window.orientation ?? 90;
    const acc = rollFromGravity(g, screenAngle, IOS ? -1 : 1);
    const ts = e.timeStamp / 1000;
    const dt = clamp(ts - t.last, 0, 0.1);
    t.last = ts;
    const rate = e.rotationRate?.alpha; // deg/s about the screen normal, anticlockwise +
    if (t.have && rate != null && dt > 0) {
      const k = TILT.gyroWeight;
      t.angle = k * (t.angle - rate * DEG * dt) + (1 - k) * acc;
    } else {
      t.angle = acc;
    }
    t.have = true;
  };
  return {
    get available() {
      return t.have;
    },
    get steer() {
      return t.have ? tiltToSteer(t.angle) : 0;
    },
    start() {
      if (t.listening || typeof window === 'undefined') return;
      t.listening = true;
      window.addEventListener('devicemotion', onMotion);
    },
    stop() {
      if (!t.listening) return;
      t.listening = false;
      window.removeEventListener('devicemotion', onMotion);
    },
  };
}

// iOS 13+ gates motion sensors behind a prompt that must come from a tap; Android (Capacitor's
// WebView and Chrome) needs no permission. Resolves true when tilt can be used.
export async function requestTiltPermission() {
  const DME = typeof window !== 'undefined' ? window.DeviceMotionEvent : undefined;
  if (!DME) return false;
  if (typeof DME.requestPermission !== 'function') return true;
  try {
    return (await DME.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

// Waits briefly for a devicemotion reading: desktops and some tablets have no sensor.
export function probeTilt(ms = 900) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.DeviceMotionEvent) return resolve(false);
    const done = (ok) => {
      window.removeEventListener('devicemotion', on);
      clearTimeout(timer);
      resolve(ok);
    };
    const on = (e) => e.accelerationIncludingGravity?.x != null && done(true);
    const timer = setTimeout(() => done(false), ms);
    window.addEventListener('devicemotion', on);
  });
}

export function createRaceInput({ steerPad, wheel, brakes, nitro, gas, hud }) {
  const pointers = new Map();
  const keys = new Set();
  const st = {
    touchLeft: false,
    touchRight: false,
    brakesDown: new Set(),
    touchGas: false,
    brakePressed: false,
    taps: [],
    steer: 0,
    throttle: 0,
    enabled: false,
    auto: true,
    scheme: 'touch',
  };
  const out = { steer: 0, throttle: 1, brake: false, brakePressed: false, nitroTaps: [] };
  const tilt = createTilt();
  const manual = () => st.scheme !== 'touch' || !st.auto;

  // ---- Touch Drive pad ----
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

  // ---- Virtual steering wheel ----
  // Dragging around the hub turns it by the change in the finger's angle, so it can be grabbed
  // anywhere; let go and it springs back to centre.
  const wh = { angle: 0, pointer: null, last: 0, cx: 0, cy: 0, shown: null };
  const fingerAngle = (e) => Math.atan2(e.clientY - wh.cy, e.clientX - wh.cx) / DEG;
  const wheelRim = wheel.querySelector('.rc-wheel-rim') ?? wheel;
  wheel.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (wh.pointer !== null) return;
    wheel.setPointerCapture(e.pointerId);
    const r = wheel.getBoundingClientRect();
    wh.cx = r.left + r.width / 2;
    wh.cy = r.top + r.height / 2;
    wh.pointer = e.pointerId;
    wh.last = fingerAngle(e);
    wheel.classList.add('is-held');
  });
  wheel.addEventListener('pointermove', (e) => {
    if (e.pointerId !== wh.pointer) return;
    const a = fingerAngle(e);
    let d = a - wh.last;
    d = ((d + 540) % 360) - 180; // shortest way round
    wh.last = a;
    wh.angle = clamp(wh.angle + d, -WHEEL.lock, WHEEL.lock);
  });
  const wheelUp = (e) => {
    if (e && e.pointerId !== wh.pointer) return;
    wh.pointer = null;
    wheel.classList.remove('is-held');
  };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => wheel.addEventListener(t, wheelUp));

  // ---- Pedals and buttons ----
  const brakeDown = (btn) => {
    if (!st.brakesDown.size) st.brakePressed = true;
    st.brakesDown.add(btn);
    btn.classList.add('is-pressed');
  };
  const brakeUp = (btn) => {
    st.brakesDown.delete(btn);
    btn.classList.remove('is-pressed');
  };
  for (const btn of brakes) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      brakeDown(btn);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => btn.addEventListener(t, () => brakeUp(btn)));
  }

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

  // ---- Keyboard (any scheme) ----
  const KEY_LEFT = ['ArrowLeft', 'KeyA'];
  const KEY_RIGHT = ['ArrowRight', 'KeyD'];
  const KEY_BRAKE = ['Space', 'ArrowDown', 'KeyS'];
  const KEY_GAS = ['ArrowUp', 'KeyW'];
  const KEY_NITRO = ['KeyN', 'ShiftLeft', 'ShiftRight'];
  const isNitroKey = (code) => KEY_NITRO.includes(code) || (!manual() && KEY_GAS.includes(code));
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
  const applyHudClasses = () => {
    for (const s of CONTROL_SCHEMES) hud.classList.toggle(`ctl-${s}`, st.scheme === s);
    hud.classList.toggle('manual-throttle', manual());
  };
  applyHudClasses();

  return {
    get steerValue() {
      return st.steer;
    },
    get scheme() {
      return st.scheme;
    },
    get tiltAvailable() {
      return tilt.available;
    },
    setEnabled(on) {
      st.enabled = on;
      if (!on) this.reset();
    },
    // Auto-accelerate on (default) or off: off shows the GAS pedal (Touch Drive only; the
    // pedal schemes always drive with the GAS pedal).
    setAutoAccelerate(on) {
      st.auto = on;
      applyHudClasses();
    },
    setScheme(scheme) {
      st.scheme = CONTROL_SCHEMES.includes(scheme) ? scheme : 'touch';
      if (st.scheme === 'tilt') tilt.start();
      else tilt.stop();
      applyHudClasses();
      this.reset();
    },
    reset() {
      pointers.clear();
      keys.clear();
      refresh();
      for (const b of brakes) brakeUp(b);
      gasUp();
      wheelUp();
      wh.angle = 0;
      st.throttle = 0;
      st.taps.length = 0;
      st.brakePressed = false;
      st.steer = 0;
    },
    // Input for this frame. Edge events (brake press, nitro taps) are consumed.
    read(dt) {
      const keyLeft = anyKey(KEY_LEFT);
      const keyRight = anyKey(KEY_RIGHT);
      // Wheel springs back once let go.
      if (wh.pointer === null && wh.angle !== 0) {
        wh.angle *= Math.exp(-WHEEL.returnRate * dt);
        if (Math.abs(wh.angle) < 0.5) wh.angle = 0;
      }
      const shown = Math.round(wh.angle);
      if (shown !== wh.shown) {
        wh.shown = shown;
        wheelRim.style.transform = `rotate(${shown}deg)`;
      }

      // Touch is applied the frame it arrives: the pad and the wheel are direct, with no
      // smoothing between the finger and the front wheels (the car's own yaw response is the
      // only easing). Tilt keeps a fast slew to hide sensor jitter; keys still ramp, since a
      // keyboard has no half-press.
      if (keyLeft || keyRight) {
        st.steer = rampDigital(st.steer, (keyRight ? 1 : 0) - (keyLeft ? 1 : 0), dt);
      } else if (st.scheme === 'tilt' && tilt.available) {
        const d = tilt.steer - st.steer;
        st.steer += Math.sign(d) * Math.min(Math.abs(d), TILT.slew * dt);
      } else if (st.scheme === 'wheel') {
        st.steer = clamp(wh.angle / WHEEL.full, -1, 1);
      } else {
        st.steer = (st.touchRight ? 1 : 0) - (st.touchLeft ? 1 : 0);
      }
      out.steer = st.enabled ? st.steer : 0;
      out.brake = st.enabled && (st.brakesDown.size > 0 || anyKey(KEY_BRAKE));
      // The pedal eases in and snaps off, like a throttle body.
      const pedal = !manual() || st.touchGas || anyKey(KEY_GAS) ? 1 : 0;
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
