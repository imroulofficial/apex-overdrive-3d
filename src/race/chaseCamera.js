import * as THREE from 'three';

// Race camera with three views (settings.cameraView, cycled from the HUD camera button only):
//   chase    Dynamic Chase Cam: a damped follow behind the car that lags a little in turns and
//            widens with speed
//   close    Close Follow Cam: the same follow, lower and tighter on the bumper
//   cockpit  Driver View: the driver's eye inside the shared cockpit (race/cockpit.js), always
//            looking straight down the road, with a gentle head lean (HEAD)
// The view never changes by itself: only setView() (the camera button) picks one. Every view
// kicks the FOV on nitro and shakes on impacts. Also drives the pre-race fly-in (which ends
// on the chosen view) and the post-finish orbit.
//
// Free look (race/freeLook.js), Chase and Close only: a finger dragged on empty screen orbits
// the camera round the car without touching the car's input; let go and the view eases back
// behind the car in FREE_LOOK.returnTime seconds. In the cockpit a drag does nothing.
//
// Obstacles: in the follow views the camera is kept on the road side of the barriers. When a
// wall, a cliff or a fence would come between the camera and the car, the camera slides in
// along its line to the car (quickly) and back out once the way is clear (slowly).

import { CAMERA_VIEWS } from '../data/controls.js';

const BASE_FOV = 64;
// Follow views: distance and height grow with speed (per m/s, up to 70 m/s); `follow` is the
// yaw catch-up rate, `look` how far ahead of the car it aims and at what height.
const FOLLOW = {
  chase: { dist: 6.4, distK: 0.022, height: 2.25, heightK: 0.006, follow: 5.5, ahead: 5, lookY: 1.05, fov: 0 },
  close: { dist: 4.5, distK: 0.012, height: 1.55, heightK: 0.004, follow: 7.5, ahead: 6, lookY: 0.95, fov: 2 },
};
// How the follow yaw trails the car: the travel direction (velocity) takes over from the nose
// between `travelFrom` and `travelTo` m/s forward, by `travel` of the gap (`drift` while
// sliding), and never more than `maxOffset` radians off the nose.
// The follow yaw never turns faster than `maxRate` rad/s (a spinning car does not whip it).
export const FOLLOW_YAW = { travelFrom: 3, travelTo: 12, travel: 0.5, drift: 0.65, driftRate: 3, maxOffset: 0.6, maxRate: 3.5 };
// Driver view: the eye `back` metres behind the nose, `below` under the roof line (within
// `minY`..`maxY` of the car's origin), `side` metres left of the centre line (left-hand drive).
// A small FOV kick, so the cockpit stays put on screen.
export const COCKPIT = { back: 2.2, minX: -0.7, below: 0.3, minY: 0.82, maxY: 1.25, side: -0.36, ahead: 30, drop: 0.9, fov: 6, speedFov: 6, shake: 0.25 };
// The driver's head in the cockpit, in metres in the car's frame, all of it small and eased
// (no motion sickness): braking pitches it forward and down (`brake` m per m/s², up to
// `maxFwd`), accelerating presses it back (`accel`, up to `maxBack`); cornering leans it to
// the outside (`lean` m per m/s² of lateral acceleration, up to `maxLean`); `rate` is how fast
// it follows (1/s). Above `buzzFrom` m/s a light road buzz grows to `buzz` m; nitro adds
// `nitro` per tier; a landing drops the head by up to `land` m and springs back.
export const HEAD = { brake: 0.0028, maxFwd: 0.045, accel: 0.0016, maxBack: 0.02, lean: 0.0022, maxLean: 0.035, rate: 5, buzzFrom: 40, buzz: 0.0025, nitro: 0.0025, land: 0.045 };
// Free look: radians per pixel of drag, the orbit limits (any way round, a little tilt), and
// the time it takes to ease back once released.
export const FREE_LOOK = { yawPerPx: 0.009, pitchPerPx: 0.006, orbitPitch: [-0.25, 0.5], returnTime: 1.2 };
// Obstacle avoidance: stay `margin` metres inside the barrier line; slide in at `pullIn`/s and
// back out at `easeOut`/s; never closer than `minReach` of the full distance. Only the
// horizontal range shrinks: the camera keeps its height, so close in it looks down over the
// roof rather than into the bodywork.
export const OCCLUSION = { margin: 0.6, pullIn: 10, easeOut: 2.2, minReach: 0.1, samples: 4, refine: 4 };

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth01 = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Eye point of the driver view in the car's frame (x forward, y up, z right), from the car's
// measured nose and roof (shared with race/cockpit.js, which builds the cabin round it).
export function cockpitEye(size, out = { x: 0, y: 0, z: 0 }) {
  out.x = Math.max(COCKPIT.minX, size.nose - COCKPIT.back);
  out.y = clamp(size.roof - COCKPIT.below, COCKPIT.minY, COCKPIT.maxY);
  out.z = COCKPIT.side;
  return out;
}

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
    this.size = { nose: 2.2, roof: 1.3 };
    this.t = 0;
    this.track = null; // for keeping the camera off the barriers (setTrack)
    this.reach = 1; // fraction of the follow distance the camera is out at (obstacles)
    this.driftK = 0; // eased 0..1 while the car slides
    this.camSpeed = 0; // eased road speed for the follow distance (a crash does not yank it)
    // Free-look offsets: yaw (+ = look right) and pitch (+ = from higher up / look up).
    this.free = { yaw: 0, pitch: 0, held: false, fromYaw: 0, fromPitch: 0, t: 0 };
    this.eye = { x: 0, y: 0, z: 0 };
    this.ownEye = null;
    // Cockpit head motion (HEAD): offset from the eye, eased accelerations, landing spring.
    this.head = { x: 0, y: 0, z: 0, lon: 0, lat: 0, fwd: 0, yaw: 0, land: 0, landV: 0, air: 0, wasAir: false, t: 0, primed: false };
    this._v = new THREE.Vector3();
    this._l = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._l2 = new THREE.Vector3();
    this._proj = { i: -1 };
  }

  // The view only ever changes here (the camera button / Settings). A view change is the
  // player's own action, so it cuts straight to the new view.
  setView(view, car) {
    this.view = CAMERA_VIEWS.includes(view) ? view : 'chase';
    this.resetFreeLook();
    if (car && this.mode === 'chase') this.snap(car);
  }

  get inCockpit() {
    return this.view === 'cockpit' && this.mode === 'chase';
  }

  setTrack(track) {
    this.track = track;
    this._proj.i = -1;
  }

  // Nose (front-most x) and roof (top y) of the player's car, in metres from its origin.
  setCarSize(nose, roof) {
    if (nose > 0.5) this.size.nose = nose;
    if (roof > 0.5) this.size.roof = roof;
  }

  snap(car) {
    this.yaw = car.heading;
    this.resetHead();
    this.driftK = car.drifting ? 1 : 0;
    this.camSpeed = Math.min(car.speed, 70);
    this.reach = this.clearReach(car, this.idealFor(car, this.pos, this.look));
    this.applyReach(car, this.pos, this.reach);
    this.camY = this.pos.y;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  bump(amount) {
    this.shake = Math.min(1, this.shake + amount);
  }

  // ---- Free look (race/freeLook.js) ----
  // A drag of (dx, dy) pixels round the car (Chase and Close). Never touches the car: only the
  // view offsets move. In the cockpit it does nothing: the driver looks straight ahead.
  freeLookDrag(dx, dy) {
    if (this.view === 'cockpit') return;
    const f = this.free;
    f.held = true;
    const [p0, p1] = FREE_LOOK.orbitPitch;
    f.yaw = clamp(f.yaw + dx * FREE_LOOK.yawPerPx, -Math.PI, Math.PI);
    f.pitch = clamp(f.pitch + dy * FREE_LOOK.pitchPerPx, p0, p1);
  }

  // The finger lifted: ease back behind the car (or to straight ahead) from where it is.
  freeLookRelease() {
    const f = this.free;
    if (!f.held) return;
    f.held = false;
    f.fromYaw = f.yaw;
    f.fromPitch = f.pitch;
    f.t = 0;
  }

  resetFreeLook() {
    const f = this.free;
    f.yaw = f.pitch = f.fromYaw = f.fromPitch = 0;
    f.held = false;
    f.t = 0;
  }

  get freeLooking() {
    return this.free.held || this.free.yaw !== 0 || this.free.pitch !== 0;
  }

  updateFreeLook(dt) {
    const f = this.free;
    if (f.held || (f.yaw === 0 && f.pitch === 0)) return;
    f.t += dt;
    const k = f.t >= FREE_LOOK.returnTime ? 1 : ease(f.t / FREE_LOOK.returnTime);
    f.yaw = k >= 1 ? 0 : f.fromYaw * (1 - k);
    f.pitch = k >= 1 ? 0 : f.fromPitch * (1 - k);
  }

  // ---- Poses ----
  // The follow pose for the current yaw (plus the free-look orbit). Returns the point the
  // camera looks at the car from (its roof line), for the obstacle check.
  idealFor(car, pos, look, view = this.view) {
    if (view === 'cockpit') {
      this.cockpitFor(car, pos, look);
      return null;
    }
    const F = FOLLOW[view] ?? FOLLOW.chase;
    const speed = this.camSpeed;
    const dist = F.dist + speed * F.distK;
    const height = F.height + speed * F.heightK;
    const orbit = this.free.yaw;
    const yaw = this.yaw - orbit;
    // Free-look tilt swings the camera up or down round the car at the same range.
    const range = Math.hypot(dist, height - F.lookY);
    const elev = Math.atan2(height - F.lookY, dist) + this.free.pitch;
    const e = clamp(elev, -0.05, 1.2);
    const fx = Math.cos(yaw);
    const fz = -Math.sin(yaw);
    const flat = Math.cos(e) * range;
    pos.set(car.pos.x - fx * flat, car.pos.y + F.lookY + Math.sin(e) * range, car.pos.z - fz * flat);
    // Looking round, the aim moves from down the road onto the car itself.
    const ahead = F.ahead * (1 - smooth01(0, 0.7, Math.abs(orbit)));
    look.set(car.pos.x + fx * ahead, car.pos.y + F.lookY, car.pos.z + fz * ahead);
    return this._l2.set(car.pos.x, car.pos.y + F.lookY, car.pos.z);
  }

  // The driver's eye (plus the head motion), looking straight down the car's nose; heading
  // and pitch follow the car rigidly, no roll, so the horizon stays level.
  cockpitFor(car, pos, look) {
    const e = this.ownEye ? Object.assign(this.eye, this.ownEye) : cockpitEye(this.size, this.eye);
    const h = this.head;
    this.carPoint(car, e.x + h.x, e.y + h.y, e.z + h.z, pos);
    this.aim(car, pos, look, COCKPIT.ahead, COCKPIT.drop);
  }

  // The car's own driver's eye (extras.apex.eye in the car's frame: x forward, y up, z right),
  // or null for the eye fitted to the model's nose and roof (cockpitEye).
  setOwnEye(eye) {
    this.ownEye = eye ? { x: eye.x, y: eye.y, z: eye.z } : null;
  }

  resetHead() {
    const h = this.head;
    h.x = h.y = h.z = h.lon = h.lat = h.land = h.landV = h.air = 0;
    h.wasAir = false;
    h.primed = false;
  }

  // Head motion from the car's own accelerations (measured here, so it needs nothing from the
  // physics): lean forward under braking, back under power, out in the turns; a light buzz at
  // high speed and on nitro; a dip and spring back on landing. All in metres, all small.
  updateHead(car, dt, boostTier) {
    const h = this.head;
    const H = HEAD;
    const fwd = car.forward ?? car.speed;
    if (!h.primed || dt <= 0) {
      h.fwd = fwd;
      h.yaw = car.heading;
      h.primed = true;
      return;
    }
    const lonA = (fwd - h.fwd) / dt;
    const latA = (fwd * wrapAngle(car.heading - h.yaw)) / dt; // + = turning left
    h.fwd = fwd;
    h.yaw = car.heading;
    // Accelerations are noisy frame to frame (contacts, gear changes): ease them first.
    const k = Math.min(1, dt * 8);
    h.lon += (clamp(lonA, -40, 40) - h.lon) * k;
    h.lat += (clamp(latA, -40, 40) - h.lat) * k;
    const tx = h.lon < 0 ? Math.min(H.maxFwd, -h.lon * H.brake) : -Math.min(H.maxBack, h.lon * H.accel);
    const tz = clamp(h.lat * H.lean, -H.maxLean, H.maxLean); // left turn throws the head right (+z)
    const f = Math.min(1, dt * H.rate);
    h.x += (tx - h.x) * f;
    h.z += (tz - h.z) * f;
    // Landing: a damped spring kicked by how long the car was in the air.
    if (car.airborne) h.air += dt;
    else if (h.wasAir) {
      h.landV -= Math.min(1, h.air * 1.6) * H.land * 14;
      h.air = 0;
    }
    h.wasAir = !!car.airborne;
    h.landV += (-h.land * 120 - h.landV * 14) * dt;
    h.land = clamp(h.land + h.landV * dt, -H.land, H.land * 0.5);
    // Road buzz at speed and on nitro: smooth sines, not random jitter.
    h.t += dt;
    const buzz = H.buzz * smooth01(H.buzzFrom, 75, car.speed) + H.nitro * boostTier;
    const n = Math.sin(h.t * 37.1) * 0.6 + Math.sin(h.t * 23.7 + 1.3) * 0.4;
    h.y = h.land - Math.max(0, h.x) * 0.35 + n * buzz; // braking also dips the head a little
  }

  // Car frame (x forward, y up, z right) -> world, pitching about the car's right axis.
  carPoint(car, x, y, z, out) {
    const cp = Math.cos(car.pitch);
    const sp = Math.sin(car.pitch);
    const ch = Math.cos(car.heading);
    const sh = Math.sin(car.heading);
    const lx = x * cp - y * sp; // forward after pitch
    const ly = x * sp + y * cp;
    return out.set(car.pos.x + ch * lx + sh * z, car.pos.y + ly, car.pos.z - sh * lx + ch * z);
  }

  // Aims `ahead` metres down the car's (pitched) nose, `drop` lower, turned by free look.
  aim(car, pos, look, ahead, drop) {
    const yaw = car.heading - this.free.yaw;
    const pitch = car.pitch + this.free.pitch;
    const cp = Math.cos(pitch);
    look.set(pos.x + Math.cos(yaw) * cp * ahead, pos.y + Math.sin(pitch) * ahead - drop, pos.z - Math.sin(yaw) * cp * ahead);
  }

  // ---- Obstacles ----
  // How far out (0..1 of the line from the car to `pos`) the camera can sit without a barrier
  // between them: the road's barriers stand at track.fenceOffset either side of the centre
  // line, so points past that (less a margin) are behind the wall, the cliff or the fence.
  clearReach(car, from) {
    const track = this.track;
    if (!track || !from) return 1;
    const lim = track.fenceOffset - OCCLUSION.margin;
    const pr = this._proj;
    // A car already off the road (trails, run-off zones) has nothing to measure against.
    if (Math.abs(car.proj?.d ?? 0) > lim || car.zone || car.proj?.trail) return 1;
    const p = this._p;
    const out = (k) => {
      p.lerpVectors(from, this.pos, k);
      track.project(p.x, p.z, pr.i ?? -1, pr);
      return Math.abs(pr.d) > lim;
    };
    let lo = 0;
    let hi = -1;
    for (let i = 1; i <= OCCLUSION.samples; i++) {
      const k = i / OCCLUSION.samples;
      if (out(k)) {
        hi = k;
        break;
      }
      lo = k;
    }
    if (hi < 0) return 1;
    for (let i = 0; i < OCCLUSION.refine; i++) {
      const mid = (lo + hi) / 2;
      if (out(mid)) hi = mid;
      else lo = mid;
    }
    return Math.max(OCCLUSION.minReach, lo);
  }

  // Pulls `pos` in toward the car to `reach` of its horizontal range (height kept).
  applyReach(car, pos, reach) {
    if (reach >= 1 || this.view === 'cockpit') return;
    pos.x = car.pos.x + (pos.x - car.pos.x) * reach;
    pos.z = car.pos.z + (pos.z - car.pos.z) * reach;
  }

  intro(car, duration = 3) {
    this.mode = 'intro';
    this.t = 0;
    this.duration = duration;
    this.car = car;
    this.yaw = car.heading;
    this.resetFreeLook();
  }

  orbit(car) {
    this.mode = 'orbit';
    this.t = 0;
    this.car = car;
    this.resetFreeLook();
  }

  update(dt, car, { boostTier = 0 } = {}) {
    const cam = this.camera;
    this.updateFreeLook(dt);
    // Range and height follow the speed smoothly, so a hit that kills the speed does not pull
    // the camera in with a jolt.
    this.camSpeed += (Math.min(car.speed, 70) - this.camSpeed) * Math.min(1, dt * 2.5);
    if (this.mode === 'intro') {
      // Sweep from a high aerial over the grid down to the chosen view, landing exactly on it
      // so the race starts without a cut.
      this.t = Math.min(1, this.t + dt / this.duration);
      const k = ease(this.t);
      this.yaw = car.heading;
      this.idealFor(car, this.pos, this.look);
      const a = car.heading + Math.PI * 0.85 * (1 - k);
      const r = 6.8 + 26 * (1 - k);
      const sweep = this._v.set(car.pos.x - Math.cos(a) * r, car.pos.y + 2.3 + 18 * (1 - k), car.pos.z + Math.sin(a) * r);
      const land = k * k * k;
      cam.position.copy(sweep).lerp(this.pos, land);
      cam.lookAt(this._l.copy(car.pos).lerp(this.look, k));
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
    } else if (this.view === 'cockpit') {
      this.yaw = car.heading;
      this.updateHead(car, dt, boostTier);
      this.cockpitFor(car, this.pos, this.look);
      cam.position.copy(this.pos);
      this.camY = this.pos.y;
      const speedK = Math.min(1, car.speed / 70);
      const targetFov = BASE_FOV + COCKPIT.fov + speedK * COCKPIT.speedFov + (boostTier === 2 ? 10 : boostTier === 1 ? 5 : 0);
      this.fov += (targetFov - this.fov) * Math.min(1, dt * (targetFov > this.fov ? 6 : 2.5));
      this.applyShake(cam, boostTier, COCKPIT.shake, dt);
      cam.lookAt(this.look);
    } else {
      const F = FOLLOW[this.view] ?? FOLLOW.chase;
      const turn = wrapAngle(this.followYaw(car, dt) - this.yaw) * Math.min(1, dt * F.follow);
      this.yaw += clamp(turn, -FOLLOW_YAW.maxRate * dt, FOLLOW_YAW.maxRate * dt);
      const from = this.idealFor(car, this.pos, this.look);
      // Obstacles: slide in fast, back out slowly, so a wall never pops the view.
      const reach = this.clearReach(car, from);
      this.reach += (reach - this.reach) * Math.min(1, dt * (reach < this.reach ? OCCLUSION.pullIn : OCCLUSION.easeOut));
      this.applyReach(car, this.pos, this.reach);
      // Smooth vertical so jumps feel weighty rather than glued.
      this.camY ??= this.pos.y;
      this.camY += (this.pos.y - this.camY) * Math.min(1, dt * (car.airborne ? 3 : 8));
      // ...but never so far behind that a big jump leaves the camera under the car.
      const floor = car.pos.y + Math.min(F.height * 0.6, (this.pos.y - car.pos.y) * 0.9);
      this.camY = Math.max(this.camY, floor);
      cam.position.lerp(this._v.set(this.pos.x, this.camY, this.pos.z), Math.min(1, dt * 12));
      cam.position.y = Math.max(cam.position.y, floor);
      if (!this.freeLooking) this.look.y = this.look.y * 0.6 + (this.camY - 1.2) * 0.4;
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

  // The yaw the follow views trail toward: the nose at low speed and in reverse, blending
  // smoothly into the direction of travel as the car gets going (more of it in a slide, so a
  // drift shows the car sideways), never more than FOLLOW_YAW.maxOffset off the nose. Every
  // weight is continuous, so no threshold makes the camera jump.
  followYaw(car, dt) {
    const Y = FOLLOW_YAW;
    this.driftK += ((car.drifting ? 1 : 0) - this.driftK) * Math.min(1, dt * Y.driftRate);
    const forward = car.forward ?? car.speed;
    const w = smooth01(Y.travelFrom, Y.travelTo, forward);
    if (w <= 0) return car.heading;
    const travel = Math.atan2(-car.vel.y, car.vel.x);
    const gap = wrapAngle(travel - car.heading);
    const share = Y.travel + (Y.drift - Y.travel) * this.driftK;
    return car.heading + clamp(gap * share * w, -Y.maxOffset, Y.maxOffset);
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
