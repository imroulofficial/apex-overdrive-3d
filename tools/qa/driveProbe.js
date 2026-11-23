// In-page probe for tools/qa/drive.mjs (loaded with addInitScript, no imports). It reads the
// running race after every physics frame and counts the glitches of the Phase 0 audit
// (C1-C15) against the geometry that is actually rendered: rays are cast down onto the road,
// ramp, trail, terrain and bridge meshes through a triangle grid built once per race.
//
// Everything is measured the same way on every build, so a before/after pair of runs is a fair
// comparison. Counters are per racer; "samples" are physics frames (wheel rays every 3rd).
(() => {
  const CELL = 4;
  const GROUND = new Set(['ramps', 'terrain', 'trail-dirt', 'bridge', 'ground', 'concrete', 'racing-line', 'kerbs', 'road', 'shoulders', 'bank']);
  const SKIP = new Set(['trackside', 'trail-fences', 'trail-barriers', 'tunnel-stone', 'tunnel-mound', 'tunnel-lamps', 'village', 'black-ice', 'puddles', 'skid-marks', 'contact-shadows', 'mode-props', 'wheels', 'cockpit', 'towers', 'neon', 'billboards', 'skyline', 'light-pools', 'traffic', 'headlights', 'light-trail', 'peaks', 'pines', 'boulders', 'roadside-rocks', 'ferns', 'seabirds', 'waterfall']);

  // ---- ground mesh grid ---------------------------------------------------------------------
  function visible(o) {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }
  function tagOf(o) {
    let name = o.name;
    let group = '';
    for (let p = o.parent; p; p = p.parent) {
      if (p.name && !group) group = p.name;
    }
    if (!name) name = o.material?.name || o.material?.type || 'mesh';
    return `${group}/${name}`;
  }
  function wanted(o) {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return false;
    // Hidden sets are not ground: on a reversed route the forward ramps and chevrons stay in
    // the scene, invisible (Race.useRoute).
    if (!visible(o)) return false;
    for (let p = o; p; p = p.parent) if (SKIP.has(p.name)) return false;
    if (GROUND.has(o.name)) return true;
    // Unnamed parts of the road group (asphalt, shoulders, bank, kerbs) and the directional set.
    for (let p = o.parent; p; p = p.parent) if (p.name === 'track' || p.name === 'directional' || p.name === 'trails') return true;
    return false;
  }
  function buildGrid(scene) {
    const cells = new Map();
    const tris = [];
    const tags = [];
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      if (!wanted(o)) return;
      const tagIndex = tags.length;
      tags.push({ tag: tagOf(o), mesh: o });
      const g = o.geometry;
      const pos = g.attributes.position;
      if (!pos) return;
      const e = o.matrixWorld.elements;
      const n = pos.count;
      const wx = new Float64Array(n);
      const wy = new Float64Array(n);
      const wz = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        wx[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
        wy[i] = e[1] * x + e[5] * y + e[9] * z + e[13];
        wz[i] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      const idx = g.index ? g.index.array : null;
      const count = idx ? idx.length : n;
      for (let t = 0; t + 2 < count; t += 3) {
        const a = idx ? idx[t] : t;
        const b = idx ? idx[t + 1] : t + 1;
        const c = idx ? idx[t + 2] : t + 2;
        const ti = tris.length;
        tris.push([wx[a], wy[a], wz[a], wx[b], wy[b], wz[b], wx[c], wy[c], wz[c], tagIndex]);
        const x0 = Math.floor(Math.min(wx[a], wx[b], wx[c]) / CELL);
        const x1 = Math.floor(Math.max(wx[a], wx[b], wx[c]) / CELL);
        const z0 = Math.floor(Math.min(wz[a], wz[b], wz[c]) / CELL);
        const z1 = Math.floor(Math.max(wz[a], wz[b], wz[c]) / CELL);
        if ((x1 - x0 + 1) * (z1 - z0 + 1) > 400) continue; // vertical or degenerate sliver
        for (let gx = x0; gx <= x1; gx++) {
          for (let gz = z0; gz <= z1; gz++) {
            const k = gx * 100003 + gz;
            let list = cells.get(k);
            if (!list) cells.set(k, (list = []));
            list.push(ti);
          }
        }
      }
    });
    return { cells, tris, tags };
  }
  // Highest rendered ground at (x, z) between y0 (above) and y1 (below): { y, tag } or null.
  function castDown(grid, x, z, y0, y1) {
    const list = grid.cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!list) return null;
    let best = -Infinity;
    let tag = -1;
    for (const ti of list) {
      const t = grid.tris[ti];
      const ax = t[0], ay = t[1], az = t[2], bx = t[3], by = t[4], bz = t[5], cx = t[6], cy = t[7], cz = t[8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const y = u * ay + v * by + w * cy;
      if (y > y0 || y < y1) continue;
      if (y > best) {
        best = y;
        tag = t[9];
      }
    }
    return tag < 0 ? null : { y: best, tag: grid.tags[tag].tag };
  }

  // ---- geometry helpers -----------------------------------------------------------------------
  function dims(r) {
    const ch = r.visual.chassis;
    return ch ? { hl: ch.length / 2, hw: ch.width / 2 } : { hl: 2.3, hw: 1.0 };
  }
  function corners(v, d) {
    const fx = Math.cos(v.heading);
    const fz = -Math.sin(v.heading);
    const rx = -fz;
    const rz = fx;
    const out = [];
    for (const a of [d.hl, -d.hl]) for (const l of [d.hw, -d.hw]) out.push([v.pos.x + fx * a + rx * l, v.pos.z + fz * a + rz * l]);
    return out;
  }
  // Penetration depth of two oriented boxes on the ground (0 when apart), separating axis test.
  function obbDepth(a, da, b, db) {
    const axes = [];
    for (const v of [a, b]) {
      const fx = Math.cos(v.heading);
      const fz = -Math.sin(v.heading);
      axes.push([fx, fz], [-fz, fx]);
    }
    let depth = Infinity;
    const ca = corners(a, da);
    const cb = corners(b, db);
    for (const [ax, az] of axes) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, z] of ca) {
        const p = x * ax + z * az;
        a0 = Math.min(a0, p);
        a1 = Math.max(a1, p);
      }
      for (const [x, z] of cb) {
        const p = x * ax + z * az;
        b0 = Math.min(b0, p);
        b1 = Math.max(b1, p);
      }
      const o = Math.min(a1, b1) - Math.max(a0, b0);
      if (o <= 0) return 0;
      depth = Math.min(depth, o);
    }
    return depth;
  }
  function insideBox(v, d, x, z, margin) {
    const fx = Math.cos(v.heading);
    const fz = -Math.sin(v.heading);
    const dx = x - v.pos.x;
    const dz = z - v.pos.z;
    const a = dx * fx + dz * fz;
    const l = dx * -fz + dz * fx;
    return Math.abs(a) < d.hl - margin && Math.abs(l) < d.hw - margin;
  }

  const inc = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);
  const max = (o, k, v) => (o[k] = Math.max(o[k] ?? -Infinity, v));

  // ---- the probe -------------------------------------------------------------------------------
  class Probe {
    constructor(race, { wheelEvery = 3, shots = false } = {}) {
      this.race = race;
      this.track = race.track;
      this.grid = buildGrid(race.scene);
      this.wheelEvery = wheelEvery;
      this.frame = 0;
      this.racers = new Map();
      this.global = { propMaxSpeed: 0, propMaxHeight: 0, propInside: 0 };
      this.propIn = new Map();
      this.spotCount = {};
      this.spots = []; // glitch locations for screenshots: { kind, s, x, y, z, heading, racer }
      this.shots = shots;
      for (const r of race.racers) {
        this.racers.set(r, {
          car: r.isPlayer ? 'player' : r.car ?? r.carId ?? r.id,
          id: r.id,
          prev: null,
          stats: { frames: 0 },
          jump: null,
          jumps: [],
          clean: { dist: 0, time: 0 },
        });
      }
    }

    near(kind, r, extra = {}) {
      const n = (this.spotCount[kind] = (this.spotCount[kind] ?? 0) + 1);
      if (n > 12 && n % 50 !== 0) return;
      const v = r.vehicle;
      this.spots.push({ kind, racer: r.id, t: +this.race.raceTime.toFixed(2), s: +v.proj.s.toFixed(1), d: +v.proj.d.toFixed(2), x: v.pos.x, y: v.pos.y, z: v.pos.z, heading: v.heading, ...extra });
    }

    // Lateral fence line at highway position s on side `side` (null where the rail is open).
    fenceAt(s, side) {
      const tr = this.track;
      for (const t of tr.trails) {
        if (side !== t.side) continue;
        if (tr.forced && s >= t.s0 && s <= t.s1) return null;
        if (s >= t.s0 - 1 && s <= t.forkEndS + 1) return null;
        if (s >= t.mergeStartS - 1 && s <= t.s1 + 1) return null;
      }
      return tr.fenceOffset;
    }

    clean(s) {
      const tr = this.track;
      for (const r of tr.ramps) {
        const ds = tr.delta(r.s0, s);
        if (ds > -40 && ds < r.length + 90) return false;
      }
      for (const t of tr.trails) if (s > t.s0 - 30 && s < t.s1 + 30) return false;
      if (tr.bridge && s > tr.bridge.s0 - 20 && s < tr.bridge.s1 + 20) return false;
      return true;
    }

    rampNear(s) {
      const tr = this.track;
      for (const r of tr.ramps) {
        const ds = tr.delta(r.s0, s);
        if (ds > -3 && ds < r.length + 4) return r;
      }
      return null;
    }

    zoneOf(v, pr) {
      const tr = this.track;
      if (v.trail || v.zone) return 'trail';
      const ad = Math.abs(pr.d);
      const hw = tr.halfWidth;
      const ramp = this.rampNear(pr.s);
      if (ramp) return 'ramp';
      if (tr.onBridge(pr.s)) return 'bridge';
      if (ad > hw - 0.4 && ad < hw + 1.1 && Math.abs(tr.curvatureAt(pr.s)) > 1 / 170) return 'kerb';
      if (ad > hw + 0.4) return 'verge';
      return 'road';
    }

    after(dt) {
      const race = this.race;
      this.frame += 1;
      this.track = race.track;
      const tr = this.track;
      const active = race.racers.filter((r) => !r.out);
      for (const r of active) {
        const st = this.racers.get(r);
        if (!st) continue;
        const v = r.vehicle;
        const S = st.stats;
        S.frames += 1;
        const p = st.prev;
        const speed = Math.hypot(v.vel.x, v.vel.y);
        if (p) {
          // Takeoff / landing / flight.
          if (!p.air && v.airborne) {
            const vy = v.vy + 24 * dt;
            inc(S, 'takeoffs');
            const ramp = this.rampNear(v.proj.s) ?? this.rampNear(p.s);
            if (!ramp) {
              inc(S, 'offRampTakeoff');
              this.near('offRampTakeoff', r, { vy: +vy.toFixed(1) });
            }
            if (vy > 14) {
              inc(S, 'bigLaunch');
              this.near('bigLaunch', r, { vy: +vy.toFixed(1) });
            }
            st.jump = { x: v.pos.x, z: v.pos.z, s: v.proj.s, ramp: !!ramp, maxH: 0, vy };
          }
          if (v.airborne && st.jump) st.jump.maxH = Math.max(st.jump.maxH, v.pos.y - (v.groundY ?? v.pos.y));
          if (p.air && !v.airborne) {
            const impact = -(p.vy - 24 * dt);
            if (impact > 16) {
              inc(S, 'hardLanding');
              this.near('hardLanding', r, { impact: +impact.toFixed(1) });
            }
            max(S, 'landMax', impact);
            // The same landing measured against the ground: speed into the surface, which a
            // slope falling away under the car takes some of.
            const into = impact + ((v.groundY ?? v.pos.y) - (p.groundY ?? p.y)) / dt;
            if (into > 16) inc(S, 'hardLandingGround');
            max(S, 'landGroundMax', into);
            if (st.jump) {
              const j = st.jump;
              const dist = Math.hypot(v.pos.x - j.x, v.pos.z - j.z);
              max(S, 'flightHeightMax', j.maxH);
              if (j.ramp) st.jumps.push({ s: Math.round(j.s), dist: +dist.toFixed(1), h: +j.maxH.toFixed(2), vy: +j.vy.toFixed(1) });
              else if (j.maxH > 3) {
                inc(S, 'offRampHighFlight');
              }
              st.jump = null;
            }
          }
          // Height snap while grounded (C1): a one-step jump in road height.
          if (!p.air && !v.airborne) {
            const step = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
            const dy = Math.abs(v.pos.y - p.y);
            if (dy > 0.25 + 0.35 * step) {
              inc(S, 'heightSnap');
              max(S, 'heightSnapMax', dy);
              this.near('heightSnap', r, { dy: +dy.toFixed(2) });
            }
          }
          // Teleport (C4): moved far more than the velocity carried it.
          const ex = p.x + p.vx * dt;
          const ez = p.z + p.vz * dt;
          const jumpH = Math.hypot(v.pos.x - ex, v.pos.z - ez);
          // A car put back on the road (the player's BACK ON TRACK, an AI unsticking itself)
          // stops dead where it lands: that is a respawn, counted on its own.
          const recovered = speed === 0;
          if (jumpH > 1.0 && recovered) {
            inc(S, 'respawn');
            this.near('respawn', r, { m: +jumpH.toFixed(2), trail: v.trail?.id ?? null, ptrail: p.trail ?? null });
          } else if (jumpH > 1.0) {
            inc(S, 'teleport');
            max(S, 'teleportMax', jumpH);
            this.near('teleport', r, { m: +jumpH.toFixed(2), px: +p.x.toFixed(2), pz: +p.z.toFixed(2), trail: v.trail?.id ?? null, ptrail: p.trail ?? null, zone: !!v.zone, speed: +speed.toFixed(1) });
          }
          max(S, 'lateralCorrectionMax', jumpH);
        }
        // Barrier corners (C6).
        if (!v.airborne) {
          const d = dims(r);
          let worst = 0;
          const pr = (this._pr ??= {});
          for (const [x, z] of corners(v, d)) {
            if (v.trail && !v.zone) {
              const t = v.trail;
              t.project(x, z, v.trailHint, pr);
              if (pr.ls <= 0 || pr.ls >= t.length) continue;
              const mp = (this._mp ??= {});
              tr.project(x, z, v.hint, mp);
              if (Math.abs(mp.d) < tr.halfWidth + 4.0 - 0.2) continue; // over the highway: no fence there
              worst = Math.max(worst, Math.abs(pr.d) - (t.halfWidthAt(pr.ls) + 0.3));
            } else if (!v.zone) {
              tr.project(x, z, v.hint, pr);
              const f = this.fenceAt(pr.s, Math.sign(pr.d));
              if (f == null) continue;
              worst = Math.max(worst, Math.abs(pr.d) - f);
            }
          }
          if (worst > 0.1) {
            inc(S, 'barrier');
            max(S, 'barrierMax', worst);
            if (worst > 0.3) this.near('barrier', r, { m: +worst.toFixed(2) });
          }
        }
        // Wheels on the rendered ground (C1/C2/C3/C8/C14).
        if (!v.airborne && this.frame % this.wheelEvery === 0 && r.visual.wheels?.length) {
          const vis = r.visual;
          vis.root.updateMatrixWorld(true);
          const zone = this.zoneOf(v, v.proj);
          const rad = vis.wheelRadius ?? 0.35;
          const w3 = (this._w3 ??= new vis.root.position.constructor());
          for (const w of vis.wheels) {
            w.wheel.getWorldPosition(w3);
            const bottom = w3.y - rad;
            const hit = castDown(this.grid, w3.x, w3.z, bottom + 1.6, bottom - 3);
            if (!hit) continue;
            const gap = bottom - hit.y;
            inc(S, 'wheelSamples');
            const kind = gap > 0.15 ? 'wheelFloat' : gap < -0.15 ? 'wheelSink' : null;
            const fine = gap > 0.05 ? 'wheelFloat5' : gap < -0.05 ? 'wheelSink5' : null;
            if (fine) inc(S, `${fine}:${zone}`);
            if (kind) {
              inc(S, `${kind}:${zone}`);
              inc(S, `${kind}@${hit.tag}`);
              max(S, `${kind}Max:${zone}`, Math.abs(gap));
              if (Math.abs(gap) > 0.35) this.near(`${kind}:${zone}`, r, { m: +gap.toFixed(2), mesh: hit.tag });
            }
          }
        }
        // Driving feel on clean road (no ramp, trail or bridge nearby).
        if (r.isPlayer && race.phase === 'racing' && !v.trail && this.clean(v.proj.s)) {
          st.clean.dist += speed * dt;
          st.clean.time += dt;
        }
        st.prev = { x: v.pos.x, y: v.pos.y, z: v.pos.z, vx: v.vel.x, vz: v.vel.y, vy: v.vy, air: v.airborne, s: v.proj.s, groundY: v.groundY, trail: v.trail?.id ?? null };
      }

      // Car-to-car overlap (C5), every 2nd frame.
      if (this.frame % 2 === 0) {
        for (let i = 0; i < active.length; i++) {
          for (let j = i + 1; j < active.length; j++) {
            const a = active[i];
            const b = active[j];
            if (Math.abs(a.vehicle.pos.y - b.vehicle.pos.y) > 1.5) continue;
            const dx = a.vehicle.pos.x - b.vehicle.pos.x;
            const dz = a.vehicle.pos.z - b.vehicle.pos.z;
            if (dx * dx + dz * dz > 49) continue;
            const depth = obbDepth(a.vehicle, dims(a), b.vehicle, dims(b));
            if (depth > 0.15) {
              const S = this.racers.get(a).stats;
              inc(S, 'carOverlap');
              max(S, 'carOverlapMax', depth);
              if (depth > 0.5) this.near('carOverlap', a, { m: +depth.toFixed(2), other: b.id });
            }
          }
        }
      }

      // Props (C7): inside a car, and how fast and high they fly.
      const props = race.props?.items ?? [];
      for (const p of props) {
        if (!p.pos || p.state === 'broken') continue;
        if (p.state === 'flying') {
          this.global.propMaxSpeed = Math.max(this.global.propMaxSpeed, p.vel.length());
          const g = race.props.groundAt ? race.props.groundAt(p) : p.home?.y ?? 0;
          this.global.propMaxHeight = Math.max(this.global.propMaxHeight, p.pos.y - g);
        }
        for (const r of active) {
          const v = r.vehicle;
          if (p.pos.y < v.pos.y - 0.3 || p.pos.y > v.pos.y + 1.3) continue;
          const dx = p.pos.x - v.pos.x;
          const dz = p.pos.z - v.pos.z;
          if (dx * dx + dz * dz > 16) {
            this.propIn.delete(`${p.s}:${p.d}:${r.id}`);
            continue;
          }
          const key = `${p.s}:${p.d}:${r.id}`;
          const inside = insideBox(v, dims(r), p.pos.x, p.pos.z, 0.15);
          const was = this.propIn.get(key) ?? 0;
          // Inside for more than 3 frames in a row counts as stuck in the car.
          const now = inside ? was + 1 : 0;
          this.propIn.set(key, now);
          if (now === 4) {
            this.global.propInside += 1;
            inc(this.racers.get(r).stats, 'propInsideCar');
            this.near('propInsideCar', r, { type: p.type });
          }
        }
      }
    }

    report() {
      const racers = [];
      for (const [r, st] of this.racers) {
        racers.push({ id: st.id, car: st.car, player: r.isPlayer, stats: st.stats, jumps: st.jumps, clean: st.clean, lapTimes: r.lapTimes ?? [] });
      }
      return { racers, global: this.global, spots: this.spots };
    }
  }

  // Static survey of the rendered road against the height the car is shown at (C2/C3/C8/C14):
  // samples across the drivable width every `step` metres along the route.
  function survey(race, { step = 1, lat = 0.5, groundFn = null } = {}) {
    const tr = race.track;
    const grid = buildGrid(race.scene);
    const out = {};
    const add = (zone, gap, tag) => {
      const z = (out[zone] ??= { n: 0, sum: 0, over5: 0, over10: 0, max: 0, maxAt: null, tags: {} });
      z.n += 1;
      z.sum += Math.abs(gap);
      if (Math.abs(gap) > 0.05) z.over5 += 1;
      if (Math.abs(gap) > 0.1) {
        z.over10 += 1;
        z.tags[tag] = (z.tags[tag] ?? 0) + 1;
      }
      if (Math.abs(gap) > Math.abs(z.max)) {
        z.max = gap;
        z.maxAt = null;
      }
    };
    const pt = {};
    const hw = tr.halfWidth;
    const limit = tr.wallLimit + 1;
    for (let s = 0; s < tr.length; s += step) {
      tr.frame(s, pt);
      const curvy = Math.abs(tr.curvatureAt(s)) > 1 / 170;
      for (let d = -limit; d <= limit + 1e-6; d += lat) {
        const x = pt.x + pt.rx * d;
        const z = pt.z + pt.rz * d;
        const shown = groundFn ? groundFn(tr, s, d) : tr.heightAt(s, d);
        const hit = castDown(grid, x, z, shown + 1.5, shown - 3);
        if (!hit) continue;
        const gap = shown - hit.y; // > 0: the car would float above the rendered surface
        const ad = Math.abs(d);
        let zone = 'road';
        if (tr.trails.some((t) => s >= t.s0 - 2 && s <= t.s1 + 2 && Math.sign(d) === t.side && ad > hw)) continue; // trail side
        if (tr.ramps.some((r) => { const ds = tr.delta(r.s0, s); return ds > -1 && ds < r.length + 1; })) zone = 'ramp';
        else if (tr.onBridge(s)) zone = 'bridge';
        else if (ad > hw - 0.3 && ad < hw + 1.0 && curvy) zone = 'kerb';
        else if (ad > hw + 0.3) zone = 'verge';
        if (hit.tag.includes('terrain') && gap < -0.05) zone = 'terrainOverRoad';
        add(zone, gap, hit.tag);
      }
    }
    for (const z of Object.values(out)) {
      z.mean = +(z.sum / Math.max(1, z.n)).toFixed(4);
      delete z.sum;
      z.max = +z.max.toFixed(3);
    }
    return out;
  }

  window.__probe = { Probe, buildGrid, castDown, survey, obbDepth };
})();
