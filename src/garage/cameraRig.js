import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WHEEL_BASE, TRACK, WHEEL_RADIUS } from './carModel.js';

// 360° orbit camera (one-finger drag rotates, pinch zooms) with animated snaps to
// framed shots. Snaps orbit around the car instead of cutting through it.

const IDLE_AUTO_ROTATE_S = 7;

const wheelShot = (index) => {
  const x = index < 2 ? WHEEL_BASE : -WHEEL_BASE;
  const z = index % 2 === 0 ? TRACK : -TRACK;
  return {
    position: new THREE.Vector3(x + Math.sign(x) * 0.7, 0.5, z + Math.sign(z) * 1.55),
    target: new THREE.Vector3(x, WHEEL_RADIUS, z),
    minDistance: 1.1,
  };
};

export const SHOTS = {
  body: { position: new THREE.Vector3(4.6, 1.75, 5.1), target: new THREE.Vector3(0, 0.55, 0), minDistance: 3.2 },
  front: { position: new THREE.Vector3(6.0, 1.25, 1.2), target: new THREE.Vector3(0, 0.55, 0), minDistance: 3.2 },
  rear: { position: new THREE.Vector3(-5.8, 1.55, -1.6), target: new THREE.Vector3(0, 0.6, 0), minDistance: 3.2 },
  side: { position: new THREE.Vector3(0.2, 1.1, 6.4), target: new THREE.Vector3(0, 0.55, 0), minDistance: 3.2 },
  wheel: wheelShot,
};

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createCameraRig(camera, domElement) {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.9;
  controls.minDistance = SHOTS.body.minDistance;
  controls.maxDistance = 10;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.autoRotateSpeed = 0.6;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

  camera.position.copy(SHOTS.body.position).multiplyScalar(1.6);
  controls.target.copy(SHOTS.body.target);
  controls.update();

  let idle = 0;
  let tween = null;

  const markActive = () => {
    idle = 0;
    controls.autoRotate = false;
  };
  controls.addEventListener('start', () => {
    markActive();
    tween = null;
  });

  const sph = (v) => new THREE.Spherical().setFromVector3(v);

  function snapTo(shot, duration = 1.1) {
    markActive();
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
    controls.minDistance = Math.min(controls.minDistance, shot.minDistance);
  }

  const tmp = new THREE.Spherical();
  return {
    controls,
    snapTo,
    // Slow push-in from the intro framing.
    intro() {
      snapTo(SHOTS.body, 2.4);
    },
    update(dt) {
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
          tween = null;
        }
        idle = 0;
      } else {
        idle += dt;
        if (idle > IDLE_AUTO_ROTATE_S) controls.autoRotate = true;
      }
      controls.update(dt);
    },
  };
}
