import * as THREE from 'three';
import { surfaceMix, blendSurface, dominantSurface, trailMix, deckMix, ICE } from './surface.js';
import { proximityFactor, PROXIMITY } from './modes/rules.js';
import { TRAIL } from './trails.js';
import { wetGrip, PUDDLE } from '../data/weather.js';

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
// `feel` (data/cars.js) gives each car its character on top of the numbers:
//   weight  heavier: slower turn-in and launch, but it carries speed (less rolling drag off
//           the asphalt)
//   power   torque curve exponent in the throttle falloff (1 - (v/top)^power): low pulls hard
//           off the line and fades early, high keeps pulling right up to top speed
//   drift   how readily the tail slides and how loose it stays mid-drift
// The default feel (1, 2, 1) reproduces the Phase 2-12 tuning exactly.
export const DEFAULT_FEEL = { weight: 1, power: 2, drift: 1 };
export function statsToParams({ speed, accel, handling, nitro }, feel = DEFAULT_FEEL) {
  const { weight = 1, power = 2, drift = 1 } = feel ?? DEFAULT_FEEL;
  return {
    topSpeed: 46 + speed * 0.2,
    accel: (11 + accel * 0.06) / Math.sqrt(weight),
    launch: 1.1 + accel * 0.006 + (2 - power) * 0.12,
    power,
    grip: (6 + handling * 0.06) / Math.pow(drift, 0.35),
    steerRate: (1.25 + handling * 0.006) / Math.pow(weight, 0.4),
    yawResponse: 10 / Math.pow(weight, 0.7),
    momentum: 1 / weight,
    driftRate: (1.1 + handling * 0.0065) * Math.pow(drift, 0.3),
    driftGrip: (3.0 + handling * 0.012) / Math.pow(drift, 0.5),
    nitroTime: 0.8 + nitro / 200,
    nitroPower: 0.85 + nitro / 300,
  };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// At a fork the car follows whichever centre line is closer, once it is closer by this much
// (metres), so it does not flicker between two lines that still overlap.
const SWITCH_MARGIN = 0.6;

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
    // Where the car is on the highway and, on a redwood trail, on the trail. `proj` is the one
    // the car is following (same fields either way; `trail` set on a trail).
    this.mainProj = { trail: null };
    this.trailProj = {};
    this.proj = this.mainProj;
    this.trail = null;
    this.zone = null; // the trail whose fork or merge zone the car is in (both walls of the Y)
    this.events = [];
    // Footprint for car-to-car contact: two discs along the car (`offset` metres either side
    // of the centre, `radius` = half the width). Race.js fits it to the car's model.
    this.collider = { offset: 1.15, radius: 1 };
    this.reset(0, 0);
  }

  // Road height `along` metres ahead of the car's centre and `lateral` metres to its right
  // (a point on the car's floor plan, not the road's). The visual suspension (raceCars.js
  // CarVisual) casts its wheel, nose and tail rays with it.
  groundAt(along, lateral = 0) {
    const pr = this.proj;
    const fx = Math.cos(this.heading);
    const fz = -Math.sin(this.heading);
    // The car's right in the ground plane (nose +X, right +Z in car space).
    const rx = -fz;
    const rz = fx;
    const ds = along * (fx * pr.tx + fz * pr.tz) + lateral * (rx * pr.tx + rz * pr.tz);
    if (pr.trail) return pr.trail.heightAt(pr.ls + ds);
    const dd = along * (fx * pr.rx + fz * pr.rz) + lateral * (rx * pr.rx + rz * pr.rz);
    return this.track.heightAt(pr.s + ds, pr.d + dd);
  }

  reset(s, d) {
    const f = this.track.routeFrame(s, {});
    this.pos.set(f.x + f.rx * d, this.track.routeHeight(s, d), f.z + f.rz * d);
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
    this.brake = 0; // pedal 0..1 this step
    this.forward = 0;
    this.wrongWay = 0;
    this.wallScrape = 0;
    this.hint = -1;
    this.trailHint = -1;
    this.trail = f.trail ?? null;
    if (this.trail) this.trailHint = f.i;
    this.puddle = 0;
    this.onWood = false;
    this.locate();
    this.updateSurface();
    this.events.length = 0;
  }

  // Puts the car back on the road at `s`, pointing the right way (the race's safety net for a
  // car stuck on a fence or lost the wrong way). The race tallies carry on: drift distance,
  // the rail bonus, the nitro bar and any events this step already raised.
  recover(s, d) {
    const { driftDistance, proximityScore, nitro } = this;
    const events = this.events.slice();
    this.reset(s, d);
    this.driftDistance = driftDistance;
    this.proximityScore = proximityScore;
    this.nitro = nitro;
    this.events.push(...events);
  }

  // Projects the car onto the highway and, near or on a trail, onto the trail; decides which
  // one it is following. Returns that projection.
  locate() {
    const track = this.track;
    const mp = this.mainProj;
    const tp = this.trailProj;
    const x = this.pos.x;
    const z = this.pos.z;
    this.zone = null;
    this.overlap = false; // the highway projection is fresh too (fork and merge zones)
    let t = this.trail;
    if (t) {
      t.project(x, z, this.trailHint, tp);
      this.trailHint = tp.i;
      if (tp.ls >= t.length || tp.ls <= 0) t = null;
      else if (tp.ls <= t.forkEnd || tp.ls >= t.mergeStart) {
        this.projectMain(tp.s);
        this.overlap = true;
        if (!track.forced) {
          this.zone = t;
          if (Math.abs(mp.d) < Math.abs(tp.d) - SWITCH_MARGIN) t = null;
        }
      }
      if (!t && !this.overlap) this.projectMain(tp.s);
    } else {
      this.projectMain(-1);
      const c = track.trailAt(mp.s);
      if (c && (track.forced || c.inZone(mp.s))) {
        c.project(x, z, Math.round(c.localS(mp.s) / c.spacing), tp);
        this.trailHint = tp.i;
        if (tp.ls > 0 && tp.ls < c.length) {
          this.overlap = true;
          if (track.forced) t = c;
          else {
            this.zone = c;
            if (Math.abs(tp.d) < Math.abs(mp.d) - SWITCH_MARGIN) t = c;
          }
        }
      }
    }
    this.trail = t;
    this.proj = t ? tp : mp;
    return this.proj;
  }

  // Highway projection; `nearS` seeds the search when coming off a trail.
  projectMain(nearS) {
    if (nearS >= 0) this.hint = this.track.index(nearS).i;
    this.track.project(this.pos.x, this.pos.z, this.hint, this.mainProj);
    this.hint = this.mainProj.i;
  }

  get speed() {
    return this.vel.length();
  }

  // Surface under the tyres, then the weather on top: a wet road loses grip, dirt turns to mud,
  // standing water in a puddle drags and slides.
  updateSurface() {
    const track = this.track;
    const pr = this.proj;
    this.onWood = false;
    if (pr.trail) trailMix(track.halfWidth, this.overlap ? this.mainProj.d : null, pr.d, TRAIL.core, this.mix);
    else if (track.onBridge(pr.s)) {
      deckMix(this.mix);
      this.onWood = true;
    } else surfaceMix(track.halfWidth, pr.d, this.mix);
    const S = blendSurface(this.mix, this.surf);
    this.surface = this.onWood ? 'wood' : dominantSurface(this.mix);
    this.puddle = 0;
    if (track.wet > 0) {
      const m = this.mix;
      const wg = wetGrip(track.wet);
      const loose = 1 - 0.08 * track.wet;
      const k = m.asphalt * wg.grip + m.dirt * wg.mud + (m.gravel + m.grass) * loose;
      S.grip *= k;
      S.driftGrip *= m.asphalt * wg.driftGrip + m.dirt * wg.mud + (m.gravel + m.grass) * loose;
      S.steer *= wg.steer;
      if (!pr.trail && !this.onWood && m.asphalt > 0.5) {
        const p = track.puddleAt(pr.s, pr.d);
        if (p > 0.1) {
          this.puddle = p;
          S.grip *= 1 + (PUDDLE.grip - 1) * p;
          S.driftGrip *= 1 + (PUDDLE.grip - 1) * p * 0.5;
          S.steer *= 1 + (PUDDLE.steer - 1) * p;
          S.drag += PUDDLE.drag * p;
        }
      }
    }
    // Black ice on the tarmac.
    if (!pr.trail && !this.onWood && track.iceLevel > 0) {
      const ice = track.iceAt(pr.s) * this.mix.asphalt;
      if (ice > 0) {
        S.grip *= 1 + (ICE.grip - 1) * ice;
        S.driftGrip *= 1 + (ICE.driftGrip - 1) * ice;
        S.steer *= 1 + (ICE.steer - 1) * ice;
        if (ice > 0.3) this.surface = 'ice';
      }
    }
  }

  // Keeps the car inside one wall: `side` +1 = the right of projection p, -1 = the left.
  wall(p, side, limit) {
    const over = p.d * side - limit;
    if (over <= 0) return;
    this.pos.x -= p.rx * side * over;
    this.pos.z -= p.rz * side * over;
    const vn = (this.vel.x * p.rx + this.vel.y * p.rz) * side;
    if (vn > 0) {
      this.vel.x -= p.rx * side * vn * 1.25;
      this.vel.y -= p.rz * side * vn * 1.25;
      const loss = Math.min(0.3, vn * 0.018);
      this.vel.multiplyScalar(1 - loss);
      // Glance off: turn the nose back toward the road direction.
      const roadHeading = Math.atan2(-p.tz, p.tx);
      let diff = roadHeading - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) < Math.PI / 2) this.heading += diff * Math.min(1, 0.04 * vn);
      if (vn > 9 && this.drifting) this.endDrift('wall');
      this.emit('wall', vn);
      this.wallScrape = 0.15;
    }
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

  // input: { steer -1..1 (right +), throttle 0..1, brake 0..1 or bool, brakePressed bool, nitroTaps [] }
  step(dt, input, time) {
    const P = this.params;
    const track = this.track;
    let pr = this.locate();
    this.updateSurface();
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
    // Analog brake (touch pedals) or a bool (keys, AI, the drift button).
    const brake = input.brake === true ? 1 : +input.brake || 0;
    this.brake = brake;

    if (!this.airborne && !this.drifting && input.brakePressed && Math.abs(steer) > 0.25 && vF > 14) {
      this.startDrift(Math.sign(steer));
    }

    if (!this.airborne) {
      // Yaw.
      const auth = Math.min(1, Math.abs(vF) / 8) * (1 - 0.35 * Math.min(1, Math.abs(vF) / P.topSpeed));
      let gripK;
      if (this.drifting) {
        const rel = steer * this.driftDir;
        const target = -this.driftDir * P.driftRate * (0.72 + 0.45 * rel) * (1 + 0.12 * brake);
        this.yawRate += (target - this.yawRate) * Math.min(1, dt * 6);
        if (Math.abs(this.slip) > 0.95) this.yawRate *= 0.85;
        gripK = P.driftGrip * S.driftGrip;
      } else {
        const target = -steer * P.steerRate * S.steer * auth * Math.sign(vF || 1);
        this.yawRate += (target - this.yawRate) * Math.min(1, dt * (P.yawResponse ?? 10));
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
      const throttle = brake > 0 && !this.drifting ? 0 : input.throttle ?? 1;
      let a = 0;
      if (throttle > 0 && vF < top) a += P.accel * throttle * (1 - (Math.max(0, vF) / top) ** (P.power ?? 2)) * (vF < 18 ? P.launch : 1);
      if (vF > top) a -= (vF - top) * 1.4;
      if (this.tier > 0) a += (this.tier === 2 ? NITRO.pulseAccel : NITRO.blueAccel) * P.nitroPower;
      if (this.perfectT > 0) a += PERFECT.accel;
      a -= S.drag * Math.max(0, vF) * (P.momentum ?? 1); // rolling resistance off the asphalt
      this.braking = false;
      if (brake > 0 && !this.drifting) {
        this.braking = vF > 0.5;
        // Brake force follows the pedal; reversing needs it held past halfway.
        a -= vF > 0.5 ? 28 * brake : brake > 0.5 ? 8 : 0; // brake, then reverse slowly
      }
      if (throttle === 0 && !brake) a -= Math.sign(vF) * 2;
      if (this.drifting && brake) a -= 3 * brake; // handbrake drag
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
        this.nearRail = this.proximity ? proximityFactor(pr.d, pr.trail ? pr.trail.wallLimitAt(pr.ls) : track.wallLimit) : 0;
        if (this.nearRail > 0 && q > 0) {
          const bonus = points * PROXIMITY.bonus * this.nearRail;
          this.driftScore += bonus;
          this.proximityScore += bonus;
        }
        const rel = steer * this.driftDir;
        if (rel < -0.35 || (Math.abs(steer) < 0.15 && brake < 0.1)) {
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
    pr = this.locate();

    // Vertical: follow the ground or fly.
    const ground = pr.y;
    this.groundY = ground; // for the contact shadow (raceCars.js)
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

    // Barrier fences. In a fork or merge zone only the two outer walls of the Y hold the car.
    this.wallScrape = Math.max(0, this.wallScrape - dt);
    const zone = this.zone;
    if (zone) {
      this.wall(this.mainProj, -zone.side, track.wallLimit);
      this.wall(this.trailProj, zone.side, zone.wallLimitAt(this.trailProj.ls));
    } else if (this.trail) {
      const limit = this.trail.wallLimitAt(pr.ls);
      this.wall(pr, 1, limit);
      this.wall(pr, -1, limit);
    } else {
      this.wall(pr, 1, track.wallLimit);
      this.wall(pr, -1, track.wallLimit);
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
      const t = pr.trail;
      const front = t ? t.heightAt(pr.ls + 1.3 * fa) : track.heightAt(pr.s + 1.3 * fa, pr.d + 1.3 * fr);
      const back = t ? t.heightAt(pr.ls - 1.3 * fa) : track.heightAt(pr.s - 1.3 * fa, pr.d - 1.3 * fr);
      targetPitch = Math.atan2(front - back, 2.6);
    }
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * (this.airborne ? 3 : 14));
  }
}
