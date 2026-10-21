import { wrapAngle } from './noise.js';

// Waypoint AI. Each driver follows the race spline with a pure-pursuit look-ahead toward a
// chosen lane, slows for corners using the track's speed profile, changes lanes to pass or to
// avoid cars and props ahead, and fires nitro on straights. `aggression` (0..1) shapes how
// often it changes lanes, how close it follows, whether it goes for ramps, and nitro use.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class AIDriver {
  constructor(vehicle, track, { aggression = 0.5, skill = 0.95, laneBias = 0, rand = Math.random } = {}) {
    this.v = vehicle;
    this.track = track;
    this.aggression = aggression;
    this.skill = skill;
    this.laneBias = laneBias;
    this.rand = rand;
    this.input = { steer: 0, throttle: 1, brake: false, brakePressed: false, nitroTaps: [] };
    this.reset();
  }

  reset() {
    this.lane = this.v.proj.d ?? 0;
    this.laneTimer = 1 + this.rand() * 2;
    this.stuck = 0;
    this.nitroCooldown = 4 + this.rand() * 4;
    this.pendingPulse = -1;
    this.rubber = 1;
    this.avoid = 0;
  }

  // ctx: { time, cars: [{ vehicle, progress }], props: SmashProps, leaderGap (m, + = player ahead) }
  update(dt, ctx) {
    const v = this.v;
    const track = this.track;
    const pr = v.proj;
    const input = this.input;
    input.nitroTaps.length = 0;
    input.brakePressed = false;
    const limit = track.halfWidth - 1.6;
    const speed = Math.max(0, v.forward);

    // Lane planning.
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.laneTimer = 2.5 + this.rand() * (5 - this.aggression * 3);
      const k = track.curvatureAt(pr.s + 60);
      // Aggressive drivers favour the inside line of the next corner.
      const inside = Math.abs(k) > 1 / 300 ? Math.sign(k) * limit * 0.6 * this.aggression : 0;
      this.lane = clamp(this.laneBias * limit + inside + (this.rand() - 0.5) * 6, -limit, limit);
    }

    // Ramps: the bold go for them, the cautious steer around partial ones.
    for (const r of track.ramps) {
      const ahead = track.delta(pr.s, r.s0);
      if (ahead < 0 || ahead > 110) continue;
      const centre = (r.from + r.to) / 2;
      const fullWidth = r.to - r.from > track.halfWidth * 1.8;
      if (fullWidth) continue;
      if (this.aggression > 0.55) this.lane = clamp(centre, -limit, limit);
      else if (this.lane > r.from - 1 && this.lane < r.to + 1) {
        this.lane = r.from + track.halfWidth > track.halfWidth - r.to ? clamp(r.from - 2, -limit, limit) : clamp(r.to + 2, -limit, limit);
      }
    }

    // Avoid cars ahead in our lane.
    let target = this.lane;
    let follow = Infinity;
    const gap = 2.8 - this.aggression * 0.6;
    for (const other of ctx.cars) {
      const o = other.vehicle;
      if (o === v) continue;
      const ahead = track.delta(pr.s, o.proj.s);
      if (ahead <= 0 || ahead > 26 + speed * 0.3) continue;
      const lateral = o.proj.d - target;
      if (Math.abs(lateral) > gap) continue;
      // Pass on the side with more room.
      const left = o.proj.d - gap * 1.25;
      const right = o.proj.d + gap * 1.25;
      const leftOk = left > -limit;
      const rightOk = right < limit;
      let pick;
      if (leftOk && rightOk) pick = Math.abs(left - pr.d) < Math.abs(right - pr.d) ? left : right;
      else pick = leftOk ? left : right;
      target = clamp(pick, -limit, limit);
      if (o.forward < speed) follow = Math.min(follow, ahead);
    }

    // Swerve around props unless we enjoy smashing them.
    if (this.aggression < 0.7 && ctx.props) {
      for (const p of ctx.props.items) {
        if (p.state !== 'idle') continue;
        const ahead = track.delta(pr.s, p.s);
        if (ahead <= 2 || ahead > 40) continue;
        if (Math.abs(p.d - target) < 1.8) target = clamp(p.d + (p.d > 0 ? -2.6 : 2.6), -limit, limit);
      }
    }
    this.avoid += (target - this.avoid) * Math.min(1, dt * 2.2);

    // Pure pursuit toward the look-ahead point.
    const look = 9 + speed * 0.5;
    const f = track.frame(pr.s + look, this._f || (this._f = {}));
    const tx = f.x + f.rx * this.avoid - v.pos.x;
    const tz = f.z + f.rz * this.avoid - v.pos.z;
    const desired = Math.atan2(-tz, tx);
    let err = wrapAngle(desired - v.heading);
    if (v.airborne) err *= 0.3;
    input.steer = clamp(-err * 2.6, -1, 1);

    // Speed: corner profile ahead, skill, rubber banding and traffic.
    let profile = Infinity;
    for (let d = 0; d <= 60; d += 10) profile = Math.min(profile, track.speedAt(pr.s + d));
    const gapToPlayer = ctx.playerGap ?? 0; // + means the player is ahead of us
    const band = gapToPlayer > 60 ? 1.06 : gapToPlayer < -160 ? 0.93 : gapToPlayer < -60 ? 0.97 : 1;
    this.rubber += (band - this.rubber) * Math.min(1, dt * 0.5);
    let targetSpeed = Math.min(profile, v.params.topSpeed * 1.2) * this.skill * this.rubber;
    if (follow < 12) targetSpeed = Math.min(targetSpeed, speed - 1);
    // Big heading errors mean we are not making the turn; slow down.
    if (Math.abs(err) > 0.5) targetSpeed = Math.min(targetSpeed, 18);
    input.brake = speed > targetSpeed + 2.5;
    input.throttle = speed < targetSpeed ? 1 : 0.2;

    // Nitro on clear straights.
    this.nitroCooldown -= dt;
    if (this.pendingPulse >= 0 && ctx.time >= this.pendingPulse) {
      input.nitroTaps.push(ctx.time);
      this.pendingPulse = -1;
    }
    if (this.nitroCooldown <= 0 && v.tier === 0 && v.nitro >= 32 && !v.airborne) {
      let straight = true;
      for (let d = 0; d <= 180; d += 30) if (Math.abs(track.curvatureAt(pr.s + d)) > 1 / 260) straight = false;
      if (straight && speed > 25) {
        input.nitroTaps.push(ctx.time);
        if (v.nitro >= 58 && this.rand() < this.aggression) this.pendingPulse = ctx.time + 0.26;
        this.nitroCooldown = 6 + this.rand() * 8 * (1.2 - this.aggression);
      }
    }

    // Unstick after a crash against the fence.
    if (ctx.racing && speed < 2.5) {
      this.stuck += dt;
      if (this.stuck > 2.5) {
        v.reset(pr.s, clamp(pr.d, -4, 4));
        v.nitro = 20;
        this.stuck = 0;
      }
    } else this.stuck = 0;

    return input;
  }
}
