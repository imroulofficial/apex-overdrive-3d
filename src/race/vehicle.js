import * as THREE from 'three';
import { surfaceMix, blendSurface, dominantSurface } from './surface.js';
import { proximityFactor, PROXIMITY } from './modes/rules.js';

// Arcade vehicle model. Velocity lives in world space; each step it is split into forward and
// lateral parts relative to the heading. Grip bleeds off the lateral part (fast when gripping,
// slowly while drifting), and speed is preserved through the turn so cornering feels fluid
// rather than draggy. Vertical motion follows the road until it falls away faster than
// gravity (ramp lips), at which point the car flies ballistically until it lands. Grip, top
// speed and rolling drag follow the surface under the car (asphalt, gravel, grass).

export const GRAVITY = 24;
export const NITRO = {
  max: 100,
  blueCost: 25, // Blue Nitro fires from a quarter-full bar (blueprint §Nitro)
  pulseExtra: 25,
  sweetMin: 0.16, // seconds after the first tap
  sweetMax: 0.42,
  blueAccel: 12,
  pulseAccel: 24,
  blueTop: 1.18,
  pulseTop: 1.36,
  blueTime: 1.9,
  pulseTime: 2.3,
};

// Perfect Exit (blueprint §2.3): let go of a drift at a corner's apex for a speed burst.
export const PERFECT = {
  minDrift: 0.6, // seconds of drifting before an exit can be perfect
  kick: 7, // m/s added along the heading at once
  time: 1.2, // seconds of extra pull afterwards
  accel: 10,
  top: 1.1,
  nitro: 8,
};

// Car stats (0-100, the four garage bars) -> physics. Lateral grip follows handling.
export function statsToParams({ speed, accel, handling, nitro }) {
  return {
    topSpeed: 46 + speed * 0.2,
    accel: 11 + accel * 0.06,
    launch: 1.1 + accel * 0.006,
    grip: 6 + handling * 0.06,
    steerRate: 1.25 + handling * 0.006,
    driftRate: 1.1 + handling * 0.0065,
    driftGrip: 3.0 + handling * 0.012,
    nitroTime: 0.8 + nitro / 200,
    nitroPower: 0.85 + nitro / 300,
  };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Vehicle {
  // skills: the player's car, which can earn Perfect Exits.
  constructor(track, params, { passiveNitro = 1.2, skills = false } = {}) {
    this.track = track;
    this.params = params;
    this.passiveNitro = passiveNitro;
    this.skills = skills;
    this.mix = {};
    this.surf = {};
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2(); // (x, z)
    this.proj = {};
    this.events = [];
    this.reset(0, 0);
  }

  reset(s, d) {
    const f = this.track.frame(s, {});
    this.pos.set(f.x + f.rx * d, this.track.heightAt(s, d), f.z + f.rz * d);
    this.heading = Math.atan2(-f.tz, f.tx);
    this.vel.set(0, 0);
    this.vy = 0;
    this.yawRate = 0;
    this.airborne = false;
    this.airTime = 0;
    this.pitch = 0;
    this.drifting = false;
    this.driftDir = 0;
    this.driftTime = 0;
    this.driftScore = 0; // current combo
    this.driftExitTimer = 0;
    this.driftDistance = 0; // metres travelled while drifting, whole race
    this.proximityScore = 0; // Drift Touge: extra points earned drifting close to the rail
    this.nearRail = 0;
    this.releaseS = -1; // where the player began letting go of the drift
    this.perfectT = 0;
    this.slip = 0;
    this.nitro = 35;
    this.tier = 0;
    this.boostT = 0;
    this.lastTap = -10;
    this.canPulse = false;
    this.braking = false;
    this.forward = 0;
    this.wrongWay = 0;
    this.wallScrape = 0;
    this.hint = -1;
    this.track.project(this.pos.x, this.pos.z, -1, this.proj);
    this.hint = this.proj.i;
    this.updateSurface(this.proj.d);
    this.events.length = 0;
  }

  get speed() {
    return this.vel.length();
  }

  updateSurface(d) {
    surfaceMix(this.track.halfWidth, d, this.mix);
    blendSurface(this.mix, this.surf);
    this.surface = dominantSurface(this.mix);
  }

  // Letting go of the drift now would land a Perfect Exit (HUD hint).
  get apexReady() {
    return this.skills && this.drifting && this.driftTime >= PERFECT.minDrift && !!this.track.apexAt(this.proj.s, this.driftDir);
  }

  emit(type, value = 0) {
    this.events.push({ type, value });
  }

  addNitro(v) {
    this.nitro = Math.min(NITRO.max, this.nitro + v);
  }

  tapNitro(time) {
    const since = time - this.lastTap;
    if (this.tier === 1 && this.canPulse && since >= NITRO.sweetMin && since <= NITRO.sweetMax) {
      this.canPulse = false;
      this.lastTap = time;
      if (this.nitro < NITRO.pulseExtra) {
        this.emit('nitroEmpty');
        return;
      }
      this.nitro -= NITRO.pulseExtra;
      this.tier = 2;
      this.boostT = NITRO.pulseTime * this.params.nitroTime;
      // Explosive kick along the heading.
      this.vel.x += Math.cos(this.heading) * 6;
      this.vel.y -= Math.sin(this.heading) * 6;
      this.emit('pulse');
      return;
    }
    if (this.tier > 0 && since < NITRO.sweetMin) return; // finger bounce
    if (this.nitro < NITRO.blueCost) {
      this.emit('nitroEmpty');
      return;
    }
    this.nitro -= NITRO.blueCost;
    this.lastTap = time;
    if (this.tier === 0) {
      this.tier = 1;
      this.boostT = NITRO.blueTime * this.params.nitroTime;
      this.canPulse = true;
      this.emit('blue');
    } else {
      this.boostT += NITRO.blueTime * 0.65 * this.params.nitroTime;
      this.canPulse = this.tier === 1;
      this.emit(this.tier === 2 ? 'pulseExtend' : 'blue');
    }
  }

  startDrift(dir) {
    this.drifting = true;
    this.driftDir = dir;
    this.driftTime = 0;
    this.driftScore = 0;
    this.driftExitTimer = 0;
    this.releaseS = -1;
    // Snappy entry: kick the tail out.
    this.yawRate = -dir * this.params.driftRate * 1.1;
    this.heading -= dir * 0.1;
    this.emit('driftStart', dir);
  }

  // reason: 'release' (the driver let go), 'slow', 'air', 'wall' or 'forced'.
  endDrift(reason = 'forced') {
    if (!this.drifting) return;
    this.drifting = false;
    this.nearRail = 0;
    const t = this.driftTime;
    let kick = t > 0.8 ? Math.min(6, 2 + t * 1.4) : 0;
    const at = this.releaseS >= 0 ? this.releaseS : this.proj.s;
    const perfect = reason === 'release' && this.skills && t >= PERFECT.minDrift && this.track.apexAt(at, this.driftDir);
    if (perfect) {
      kick += PERFECT.kick;
      this.perfectT = PERFECT.time;
      this.addNitro(PERFECT.nitro);
    }
    if (kick) {
      this.vel.x += Math.cos(this.heading) * kick;
      this.vel.y -= Math.sin(this.heading) * kick;
    }
    this.emit('driftEnd', Math.round(this.driftScore));
    if (perfect) this.emit('perfectExit', perfect.radius);
    this.driftScore = 0;
  }

  // input: { steer -1..1 (right +), throttle 0..1, brake bool, brakePressed bool, nitroTaps [] }
  step(dt, input, time) {
    const P = this.params;
    const track = this.track;
    const pr = track.project(this.pos.x, this.pos.z, this.hint, this.proj);
    this.hint = pr.i;
    this.updateSurface(pr.d);
    const S = this.surf;
    if (this.perfectT > 0) this.perfectT = Math.max(0, this.perfectT - dt);

    for (const t of input.nitroTaps) this.tapNitro(t);
    if (this.boostT > 0) {
      this.boostT -= dt;
      if (this.boostT <= 0) {
        this.boostT = 0;
        this.tier = 0;
        this.canPulse = false;
      }
    }
    this.addNitro(this.passiveNitro * dt);

    let fx = Math.cos(this.heading);
    let fz = -Math.sin(this.heading);
    let vF = this.vel.x * fx + this.vel.y * fz;
    const steer = input.steer;

    if (!this.airborne && !this.drifting && input.brakePressed && Math.abs(steer) > 0.25 && vF > 14) {
      this.startDrift(Math.sign(steer));
    }

    if (!this.airborne) {
      // Yaw.
      const auth = Math.min(1, Math.abs(vF) / 8) * (1 - 0.35 * Math.min(1, Math.abs(vF) / P.topSpeed));
      let gripK;
      if (this.drifting) {
        const rel = steer * this.driftDir;
        const target = -this.driftDir * P.driftRate * (0.72 + 0.45 * rel) * (input.brake ? 1.12 : 1);
        this.yawRate += (target - this.yawRate) * Math.min(1, dt * 6);
        if (Math.abs(this.slip) > 0.95) this.yawRate *= 0.85;
        gripK = P.driftGrip * S.driftGrip;
      } else {
        const target = -steer * P.steerRate * S.steer * auth * Math.sign(vF || 1);
        this.yawRate += (target - this.yawRate) * Math.min(1, dt * 10);
        gripK = P.grip * S.grip;
      }
      // Loose surfaces tug the car about a little.
      if (S.jitter > 0) this.yawRate += Math.sin(time * 17.3 + this.pos.x * 0.7) * Math.sin(time * 6.1 + this.pos.z) * S.jitter * Math.min(1, Math.abs(vF) / 30) * dt * 6;
      this.heading += this.yawRate * dt;
      fx = Math.cos(this.heading);
      fz = -Math.sin(this.heading);
      const rx = -fz;
      const rz = fx;
      vF = this.vel.x * fx + this.vel.y * fz;
      let vR = this.vel.x * rx + this.vel.y * rz;

      // Longitudinal.
      const topMul = (this.tier === 2 ? NITRO.pulseTop : this.tier === 1 ? NITRO.blueTop : 1) * (this.perfectT > 0 ? PERFECT.top : 1);
      const top = P.topSpeed * topMul * S.top;
      const throttle = input.brake && !this.drifting ? 0 : input.throttle ?? 1;
      let a = 0;
      if (throttle > 0 && vF < top) a += P.accel * throttle * (1 - (Math.max(0, vF) / top) ** 2) * (vF < 18 ? P.launch : 1);
      if (vF > top) a -= (vF - top) * 1.4;
      if (this.tier > 0) a += (this.tier === 2 ? NITRO.pulseAccel : NITRO.blueAccel) * P.nitroPower;
      if (this.perfectT > 0) a += PERFECT.accel;
      a -= S.drag * Math.max(0, vF); // rolling resistance off the asphalt
      this.braking = false;
      if (input.brake && !this.drifting) {
        this.braking = vF > 0.5;
        a -= vF > 0.5 ? 28 : 8; // brake, then reverse slowly
      }
      if (throttle === 0 && !input.brake) a -= Math.sign(vF) * 2;
      if (this.drifting && input.brake) a -= 3; // handbrake drag
      vF += a * dt;
      if (vF < -10) vF = -10;

      // Lateral grip. Speed is preserved through the turn: the lateral loss becomes a
      // rotation of the velocity rather than drag (minus a little tyre scrub).
      const vR0 = vR;
      vR *= Math.exp(-gripK * dt);
      let mag = Math.hypot(vF, vR);
      if (vF > 2 && mag > 1e-3) {
        const scrub = this.drifting ? 0.1 : 0.015 * Math.abs(this.yawRate);
        const k = (Math.hypot(vF, vR0) * (1 - scrub * dt)) / mag;
        vF *= k;
        vR *= k;
        mag *= k;
      }
      this.vel.set(vF * fx + vR * rx, vF * fz + vR * rz);
      this.slip = mag > 3 ? Math.atan2(vR, Math.abs(vF)) : 0;
      this.forward = vF;

      if (this.drifting) {
        this.driftTime += dt;
        this.driftDistance += mag * dt;
        const q = clamp((Math.abs(this.slip) - 0.12) / 0.4, 0, 1) * clamp(mag / 35, 0, 1.4);
        this.addNitro(q * 13 * dt);
        const points = q * mag * dt * 12;
        this.driftScore += points;
        // Drift Touge (`proximity` on): hugging the guardrail pays extra.
        this.nearRail = this.proximity ? proximityFactor(pr.d, track.wallLimit) : 0;
        if (this.nearRail > 0 && q > 0) {
          const bonus = points * PROXIMITY.bonus * this.nearRail;
          this.driftScore += bonus;
          this.proximityScore += bonus;
        }
        const rel = steer * this.driftDir;
        if (rel < -0.35 || (Math.abs(steer) < 0.15 && !input.brake)) {
          if (this.driftExitTimer === 0) this.releaseS = pr.s;
          this.driftExitTimer += dt;
        } else {
          this.driftExitTimer = 0;
          this.releaseS = -1;
        }
        if (this.driftExitTimer > 0.28) this.endDrift('release');
        else if (vF < 10) this.endDrift('slow');
      }
    } else {
      // In the air: keep momentum, a little air control.
      this.yawRate += (-steer * 0.5 - this.yawRate) * Math.min(1, dt * 3);
      this.heading += this.yawRate * dt;
      this.vel.multiplyScalar(1 - 0.02 * dt);
      fx = Math.cos(this.heading);
      fz = -Math.sin(this.heading);
      this.forward = this.vel.x * fx + this.vel.y * fz;
      this.braking = false;
    }

    // Integrate horizontal motion.
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;
    track.project(this.pos.x, this.pos.z, this.hint, pr);
    this.hint = pr.i;

    // Vertical: follow the ground or fly.
    const ground = pr.y;
    if (!this.airborne) {
      const predicted = this.pos.y + this.vy * dt - 0.5 * GRAVITY * dt * dt;
      if (ground < predicted - 0.03 && this.vy > 1) {
        this.airborne = true;
        this.airTime = 0;
        if (this.drifting) this.endDrift('air');
        this.emit('takeoff', this.vy);
      } else {
        this.vy = clamp((ground - this.pos.y) / dt, -30, 30);
        this.pos.y = ground;
      }
    }
    if (this.airborne) {
      this.airTime += dt;
      this.vy -= GRAVITY * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= ground) {
        const impact = -this.vy;
        this.pos.y = ground;
        this.vy = 0;
        this.airborne = false;
        this.emit('land', impact);
        if (this.airTime > 0.45) this.emit('air', this.airTime);
      }
    }

    // Barrier fences.
    this.wallScrape = Math.max(0, this.wallScrape - dt);
    const limit = track.wallLimit;
    if (Math.abs(pr.d) > limit) {
      const side = Math.sign(pr.d);
      const pen = Math.abs(pr.d) - limit;
      this.pos.x -= pr.rx * side * pen;
      this.pos.z -= pr.rz * side * pen;
      const vn = (this.vel.x * pr.rx + this.vel.y * pr.rz) * side;
      if (vn > 0) {
        this.vel.x -= pr.rx * side * vn * 1.25;
        this.vel.y -= pr.rz * side * vn * 1.25;
        const loss = Math.min(0.3, vn * 0.018);
        this.vel.multiplyScalar(1 - loss);
        // Glance off: turn the nose back toward the road direction.
        const roadHeading = Math.atan2(-pr.tz, pr.tx);
        let diff = roadHeading - this.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(diff) < Math.PI / 2) this.heading += diff * Math.min(1, 0.04 * vn);
        if (vn > 9 && this.drifting) this.endDrift('wall');
        this.emit('wall', vn);
        this.wallScrape = 0.15;
      }
    }

    // Wrong way?
    const along = fx * pr.tx + fz * pr.tz;
    this.wrongWay = along < -0.3 && this.speed > 4 ? this.wrongWay + dt : 0;

    // Visual pitch from the ground under the axles, or the flight path in the air.
    let targetPitch;
    if (this.airborne) {
      targetPitch = clamp(Math.atan2(this.vy, Math.max(10, this.speed)) * 0.7, -0.35, 0.35);
    } else {
      const fa = fx * pr.tx + fz * pr.tz;
      const fr = fx * pr.rx + fz * pr.rz;
      const front = track.heightAt(pr.s + 1.3 * fa, pr.d + 1.3 * fr);
      const back = track.heightAt(pr.s - 1.3 * fa, pr.d - 1.3 * fr);
      targetPitch = Math.atan2(front - back, 2.6);
    }
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * (this.airborne ? 3 : 14));
  }
}
