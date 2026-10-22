import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WHEEL_BASE, TRACK, WHEEL_RADIUS } from './carModel.js';

// 360° orbit camera (one-finger drag rotates, pinch zooms) with animated snaps to framed
// shots. Snaps orbit around the car instead of cutting through it. After IDLE_SHOWCASE_S
// without a touch the rig runs the auto-showcase: a slow cinematic orbit, then hard cuts to
// low, high and close angles, each with a slow dolly, until the player touches the screen.

export const IDLE_SHOWCASE_S = 8;

// `at` is the wheel's actual hub position (external models differ from the procedural car).
const wheelShot = (index, at = null, radius = WHEEL_RADIUS) => {
  const x = at ? at.x : index < 2 ? WHEEL_BASE : -WHEEL_BASE;
  const z = at ? at.z : index % 2 === 0 ? TRACK : -TRACK;
  return {
    position: new THREE.Vector3(x + Math.sign(x) * 0.7, 0.5, z + Math.sign(z) * 1.55),
    target: new THREE.Vector3(x, radius, z),
    minDistance: 1.1,
  };
};

const v = (x, y, z) => new THREE.Vector3(x, y, z);

export const SHOTS = {
  body: { position: v(4.6, 1.75, 5.1), target: v(0, 0.55, 0), minDistance: 3.2 },
  front: { position: v(6.0, 1.25, 1.2), target: v(0, 0.55, 0), minDistance: 3.2 },
  rear: { position: v(-5.8, 1.55, -1.6), target: v(0, 0.6, 0), minDistance: 3.2 },
  side: { position: v(0.2, 1.1, 6.4), target: v(0, 0.55, 0), minDistance: 3.2 },
  // Rear three-quarter from above: frames the wing and the tail.
  spoiler: { position: v(-4.6, 2.5, 3.4), target: v(-1.5, 0.75, 0), minDistance: 2.4 },
  // Close on the driver door (the +z side).
  door: { position: v(1.6, 1.55, 4.3), target: v(-0.1, 0.8, 0.5), minDistance: 2.2 },
  wheel: wheelShot,
};

// Garage tabs -> the shot that focuses the part they edit.
export const TAB_SHOTS = { paint: 'body', rims: 0, kit: 'spoiler', stats: 'side', cars: 'body' };

// Cinematic cuts: start and end camera positions (a slow dolly between them) and the target.
const CUTS = [
  { from: v(3.4, 0.32, 2.4), to: v(2.6, 0.36, 3.2), target: v(0.6, 0.45, 0), hold: 5 },
  { from: v(-1.2, 6.2, 3.4), to: v(1.4, 6.0, 3.2), target: v(0, 0.3, 0), hold: 5 },
  { from: v(-4.4, 0.42, -2.6), to: v(-4.0, 0.5, -1.4), target: v(-0.6, 0.55, 0), hold: 5 },
  { from: v(2.3, 0.42, 2.25), to: v(1.75, 0.46, 2.45), target: v(1.3, 0.34, 0.86), hold: 4 },
  { from: v(-3.2, 0.95, 7.2), to: v(3.2, 0.95, 7.2), target: v(0, 0.6, 0), hold: 6 },
];
const ORBIT = { radius: 7.2, height: 1.9, speed: 0.16, hold: 10 };

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutSine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

export function createCameraRig(camera, domElement, { onShowcase } = {}) {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.9;
  controls.minDistance = SHOTS.body.minDistance;
  controls.maxDistance = 10;
  controls.minPolarAngle = 0.25;
  const MAX_POLAR = Math.PI / 2 - 0.04;
  controls.maxPolarAngle = MAX_POLAR;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

  camera.position.copy(SHOTS.body.position).multiplyScalar(1.6);
  controls.target.copy(SHOTS.body.target);
  controls.update();

  // Idle time runs on the wall clock: frame dt is clamped, so a slow device would otherwise
  // wait far longer than IDLE_SHOWCASE_S.
  let lastActive = performance.now();
  let tween = null;
  // Showcase state: null, or { step, t, theta } where step -1 is the orbit and 0.. the cuts.
  let show = null;
  const showTarget = new THREE.Vector3();

  function endShowcase(reframe = true) {
    if (!show) return;
    show = null;
    controls.target.copy(showTarget);
    onShowcase?.(false);
    if (reframe) snapTo(SHOTS.body, 1.4);
  }

  const markActive = () => {
    lastActive = performance.now();
    endShowcase();
  };
  let dragging = false;
  controls.addEventListener('start', () => {
    const wasShowing = Boolean(show);
    dragging = true;
    markActive();
    if (!wasShowing) tween = null;
  });
  controls.addEventListener('end', () => {
    dragging = false;
    lastActive = performance.now();
  });

  const sph = (p) => new THREE.Spherical().setFromVector3(p);

  function snapTo(shot, duration = 1.1) {
    lastActive = performance.now();
    if (show) {
      show = null;
      controls.target.copy(showTarget);
      onShowcase?.(false);
    }
    const fromSph = sph(camera.position.clone().sub(shot.target));
    const toSph = sph(shot.position.clone().sub(shot.target));
    // Take the short way around.
    let dTheta = toSph.theta - fromSph.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    tween = {
      t: 0,
      duration,
      fromSph,
      toSph,
      dTheta,
      fromTarget: controls.target.clone(),
      toTarget: shot.target.clone(),
      minDistance: shot.minDistance,
    };
    // Cinematic angles can sit closer or lower than the orbit limits allow: relax them for
    // the move so the controls never clamp it mid-flight.
    controls.minDistance = Math.min(controls.minDistance, shot.minDistance, fromSph.radius);
    controls.maxPolarAngle = Math.max(MAX_POLAR, fromSph.phi + 0.01);
  }

  function startShowcase() {
    tween = null;
    const off = camera.position.clone().sub(controls.target);
    show = { step: -1, t: 0, theta: Math.atan2(off.x, off.z), radius: off.setY(0).length(), height: camera.position.y };
    showTarget.copy(controls.target);
    onShowcase?.(true);
  }

  // Drives the camera while the showcase runs (the orbit controls stay out of it).
  function updateShowcase(dt) {
    show.t += dt;
    if (show.step < 0) {
      // Ease into the orbit radius and height, then circle slowly.
      const k = easeInOutCubic(Math.min(1, show.t / 3));
      show.theta += ORBIT.speed * dt * (0.3 + 0.7 * k);
      showTarget.lerp(SHOTS.body.target, Math.min(1, dt * 1.5));
      const r = THREE.MathUtils.lerp(show.radius, ORBIT.radius, k);
      const y = THREE.MathUtils.lerp(show.height, ORBIT.height, k);
      camera.position.set(Math.sin(show.theta) * r, y, Math.cos(show.theta) * r).add(new THREE.Vector3(showTarget.x, 0, showTarget.z));
      if (show.t > ORBIT.hold) {
        show.step = 0;
        show.t = 0;
      }
    } else {
      const cut = CUTS[show.step];
      const k = easeInOutSine(Math.min(1, show.t / cut.hold));
      camera.position.lerpVectors(cut.from, cut.to, k);
      showTarget.copy(cut.target);
      if (show.t > cut.hold) {
        show.t = 0;
        show.step += 1;
        if (show.step >= CUTS.length) {
          // Back to the orbit, picking up from the hero side.
          show.step = -1;
          show.theta = Math.atan2(SHOTS.body.position.x, SHOTS.body.position.z);
          show.radius = ORBIT.radius;
          show.height = ORBIT.height;
        }
      }
    }
    camera.lookAt(showTarget);
  }

  const tmp = new THREE.Spherical();
  return {
    controls,
    snapTo,
    poke: markActive,
    endShowcase,
    get showcasing() {
      return Boolean(show);
    },
    // Slow push-in from the intro framing.
    intro() {
      snapTo(SHOTS.body, 2.4);
    },
    update(dt) {
      if (show) {
        updateShowcase(dt);
        return;
      }
      if (tween) {
        tween.t = Math.min(1, tween.t + dt / tween.duration);
        const k = easeInOutCubic(tween.t);
        controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
        tmp.radius = THREE.MathUtils.lerp(tween.fromSph.radius, tween.toSph.radius, k);
        tmp.phi = THREE.MathUtils.lerp(tween.fromSph.phi, tween.toSph.phi, k);
        tmp.theta = tween.fromSph.theta + tween.dTheta * k;
        camera.position.setFromSpherical(tmp).add(controls.target);
        if (tween.t >= 1) {
          controls.minDistance = tween.minDistance;
          controls.maxPolarAngle = MAX_POLAR;
          tween = null;
        }
        lastActive = performance.now();
      } else if (controls.enabled && !dragging && performance.now() - lastActive > IDLE_SHOWCASE_S * 1000) {
        startShowcase();
        return;
      }
      controls.update(dt);
    },
  };
}
