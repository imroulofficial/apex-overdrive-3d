import * as THREE from 'three';

// Third-person chase camera: trails the car's direction of travel (so a drift shows the car
// sliding sideways), lifts and widens with speed, kicks the FOV on nitro and shakes on impacts.
// Also drives the pre-race fly-in and the post-finish orbit.

const BASE_FOV = 64;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.fov = BASE_FOV;
    this.shake = 0;
    this.mode = 'chase';
    this.t = 0;
    this._v = new THREE.Vector3();
    this._l = new THREE.Vector3();
  }

  snap(car) {
    this.yaw = car.heading;
    this.idealFor(car, this.pos, this.look);
    this.camY = this.pos.y;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  bump(amount) {
    this.shake = Math.min(1, this.shake + amount);
  }

  idealFor(car, pos, look) {
    const speed = car.speed;
    const dist = 6.4 + Math.min(speed, 70) * 0.022;
    const height = 2.25 + Math.min(speed, 70) * 0.006;
    const fx = Math.cos(this.yaw);
    const fz = -Math.sin(this.yaw);
    pos.set(car.pos.x - fx * dist, car.pos.y + height, car.pos.z - fz * dist);
    look.set(car.pos.x + fx * 5, car.pos.y + 1.05, car.pos.z + fz * 5);
  }

  intro(car, duration = 3) {
    this.mode = 'intro';
    this.t = 0;
    this.duration = duration;
    this.car = car;
    this.yaw = car.heading;
  }

  orbit(car) {
    this.mode = 'orbit';
    this.t = 0;
    this.car = car;
  }

  update(dt, car, { boostTier = 0 } = {}) {
    const cam = this.camera;
    if (this.mode === 'intro') {
      // Sweep from a high aerial over the grid down to the chase position.
      this.t = Math.min(1, this.t + dt / this.duration);
      const k = ease(this.t);
      this.yaw = car.heading;
      this.idealFor(car, this.pos, this.look);
      const a = car.heading + Math.PI * 0.85 * (1 - k);
      const r = 6.8 + 26 * (1 - k);
      const start = this._v.set(car.pos.x - Math.cos(a) * r, car.pos.y + 2.3 + 18 * (1 - k), car.pos.z + Math.sin(a) * r);
      cam.position.copy(start);
      cam.lookAt(this._l.copy(this.look).lerp(car.pos, 1 - k));
      this.camY = cam.position.y;
      this.fov = BASE_FOV;
      if (this.t >= 1) {
        this.mode = 'chase';
        this.snap(car);
      }
    } else if (this.mode === 'orbit') {
      this.t += dt;
      const a = car.heading + Math.PI * 0.6 + this.t * 0.35;
      const r = 8.5;
      cam.position.set(car.pos.x + Math.cos(a) * r, car.pos.y + 2.6, car.pos.z - Math.sin(a) * r);
      cam.lookAt(this._l.set(car.pos.x, car.pos.y + 0.8, car.pos.z));
      this.fov += (54 - this.fov) * Math.min(1, dt * 2);
    } else {
      // Follow the velocity direction more than the nose while sliding.
      let travel = car.heading;
      if (car.speed > 6) travel = Math.atan2(-car.vel.y, car.vel.x);
      let target = car.drifting ? travel + (car.heading - travel) * 0.35 : travel * 0.5 + car.heading * 0.5;
      if (car.forward < -1) target = car.heading;
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 5.5);
      this.idealFor(car, this.pos, this.look);
      // Smooth vertical so jumps feel weighty rather than glued.
      this.camY += (this.pos.y - this.camY) * Math.min(1, dt * (car.airborne ? 3 : 8));
      cam.position.lerp(this._v.set(this.pos.x, this.camY, this.pos.z), Math.min(1, dt * 12));
      this.look.y = this.look.y * 0.6 + (this.camY - 1.2) * 0.4;
      const speedK = Math.min(1, car.speed / 70);
      const targetFov = BASE_FOV + speedK * 10 + (boostTier === 2 ? 18 : boostTier === 1 ? 8 : 0);
      this.fov += (targetFov - this.fov) * Math.min(1, dt * (targetFov > this.fov ? 6 : 2.5));
      if (this.shake > 0.001) {
        const s = this.shake * 0.35;
        cam.position.x += (Math.random() - 0.5) * s;
        cam.position.y += (Math.random() - 0.5) * s;
        this.shake *= Math.pow(0.02, dt);
      }
      if (boostTier === 2) {
        cam.position.x += (Math.random() - 0.5) * 0.05;
        cam.position.y += (Math.random() - 0.5) * 0.05;
      }
      cam.lookAt(this.look);
    }
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
