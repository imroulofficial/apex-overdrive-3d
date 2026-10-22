import * as THREE from 'three';

// Race camera with three views (settings.cameraView, cycled from the HUD):
//   chase  Dynamic Chase Cam: trails the car's direction of travel (so a drift shows the car
//          sliding sideways), lifts and widens with speed
//   close  Close Follow Cam: the same follow, lower and tighter on the bumper
//   hood   Hood / Bumper View: locked to the car's heading and pitch just above the bonnet,
//          looking down the road (on the front bumper for a model whose bonnet can't be found)
// Every view kicks the FOV on nitro and shakes on impacts. Also drives the pre-race fly-in
// (always from the chase view) and the post-finish orbit.

import { CAMERA_VIEWS } from '../data/controls.js';

const BASE_FOV = 64;
// Follow views: distance and height grow with speed (per m/s, up to 70 m/s); `follow` is the
// yaw catch-up rate, `look` how far ahead of the car it aims and at what height.
const FOLLOW = {
  chase: { dist: 6.4, distK: 0.022, height: 2.25, heightK: 0.006, follow: 5.5, ahead: 5, lookY: 1.05, fov: 0 },
  close: { dist: 4.5, distK: 0.012, height: 1.55, heightK: 0.004, follow: 7.5, ahead: 6, lookY: 0.95, fov: 2 },
};
// Hood view: `back` metres behind the nose and `lift` above the highest point of the bonnet
// from there forward, aimed `ahead` metres down the road with a wider base FOV for the sense
// of speed. Without a bonnet height it rides on the bumper, `bumper` of the roof line up.
export const HOOD_SPAN = 1.4; // metres of bonnet Race measures, back from the nose
const HOOD = { back: HOOD_SPAN, lift: 0.3, bumper: 0.55, ahead: 30, drop: 0.6, fov: 8, shake: 0.35 };
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
    this.view = 'chase';
    // Player car bounds in its own frame (x forward, y up); Race sets it from the model.
    this.size = { nose: 2.2, roof: 1.3, bonnet: null };
    this.t = 0;
    this._v = new THREE.Vector3();
    this._l = new THREE.Vector3();
  }

  setView(view, car) {
    this.view = CAMERA_VIEWS.includes(view) ? view : 'chase';
    if (car && this.mode === 'chase') this.snap(car);
  }

  // Nose (front-most x), roof (top y) and bonnet height (top y over the front HOOD_SPAN, or
  // null) of the player's car, in metres from its origin.
  setCarSize(nose, roof, bonnet = null) {
    if (nose > 0.5) this.size.nose = nose;
    if (roof > 0.5) this.size.roof = roof;
    this.size.bonnet = bonnet > 0.2 && bonnet < this.size.roof ? bonnet : null;
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

  idealFor(car, pos, look, view = this.view) {
    if (view === 'hood') return this.hoodFor(car, pos, look);
    const F = FOLLOW[view] ?? FOLLOW.chase;
    const speed = Math.min(car.speed, 70);
    const dist = F.dist + speed * F.distK;
    const height = F.height + speed * F.heightK;
    const fx = Math.cos(this.yaw);
    const fz = -Math.sin(this.yaw);
    pos.set(car.pos.x - fx * dist, car.pos.y + height, car.pos.z - fz * dist);
    look.set(car.pos.x + fx * F.ahead, car.pos.y + F.lookY, car.pos.z + fz * F.ahead);
  }

  // On the nose, following heading and pitch rigidly (no roll, so the horizon stays level).
  hoodFor(car, pos, look) {
    const cp = Math.cos(car.pitch);
    const sp = Math.sin(car.pitch);
    const fx = Math.cos(car.heading) * cp;
    const fz = -Math.sin(car.heading) * cp;
    const { nose, roof, bonnet } = this.size;
    const x = bonnet === null ? nose + 0.05 : nose - HOOD.back;
    const y = bonnet === null ? roof * HOOD.bumper : bonnet + HOOD.lift;
    // Car-frame (x forward, y up) -> world, pitching about the car's right axis.
    pos.set(car.pos.x + fx * x - (Math.cos(car.heading) * sp) * y, car.pos.y + sp * x + cp * y, car.pos.z + fz * x + Math.sin(car.heading) * sp * y);
    const a = HOOD.ahead;
    look.set(pos.x + fx * a, pos.y + sp * a - HOOD.drop, pos.z + fz * a);
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
      this.idealFor(car, this.pos, this.look, 'chase');
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
    } else if (this.view === 'hood') {
      this.yaw = car.heading;
      this.hoodFor(car, this.pos, this.look);
      cam.position.copy(this.pos);
      this.camY = this.pos.y;
      const speedK = Math.min(1, car.speed / 70);
      const targetFov = BASE_FOV + HOOD.fov + speedK * 12 + (boostTier === 2 ? 16 : boostTier === 1 ? 7 : 0);
      this.fov += (targetFov - this.fov) * Math.min(1, dt * (targetFov > this.fov ? 6 : 2.5));
      this.applyShake(cam, boostTier, HOOD.shake, dt);
      cam.lookAt(this.look);
    } else {
      const F = FOLLOW[this.view] ?? FOLLOW.chase;
      // Follow the velocity direction more than the nose while sliding.
      let travel = car.heading;
      if (car.speed > 6) travel = Math.atan2(-car.vel.y, car.vel.x);
      let target = car.drifting ? travel + (car.heading - travel) * 0.35 : travel * 0.5 + car.heading * 0.5;
      if (car.forward < -1) target = car.heading;
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * F.follow);
      this.idealFor(car, this.pos, this.look);
      // Smooth vertical so jumps feel weighty rather than glued.
      this.camY += (this.pos.y - this.camY) * Math.min(1, dt * (car.airborne ? 3 : 8));
      // ...but never so far behind that a big jump leaves the camera under the car.
      const floor = car.pos.y + F.height * 0.6;
      this.camY = Math.max(this.camY, floor);
      cam.position.lerp(this._v.set(this.pos.x, this.camY, this.pos.z), Math.min(1, dt * 12));
      cam.position.y = Math.max(cam.position.y, floor);
      this.look.y = this.look.y * 0.6 + (this.camY - 1.2) * 0.4;
      const speedK = Math.min(1, car.speed / 70);
      const targetFov = BASE_FOV + F.fov + speedK * 10 + (boostTier === 2 ? 18 : boostTier === 1 ? 8 : 0);
      this.fov += (targetFov - this.fov) * Math.min(1, dt * (targetFov > this.fov ? 6 : 2.5));
      this.applyShake(cam, boostTier, 1, dt);
      cam.lookAt(this.look);
    }
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  applyShake(cam, boostTier, scale, dt) {
    if (this.shake > 0.001) {
      const s = this.shake * 0.35 * scale;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      this.shake *= Math.pow(0.02, dt);
    }
    if (boostTier === 2) {
      cam.position.x += (Math.random() - 0.5) * 0.05 * scale;
      cam.position.y += (Math.random() - 0.5) * 0.05 * scale;
    }
  }
}
