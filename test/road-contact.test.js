// Road contact: the visual suspension (raceCars.js CarVisual.suspend) keeps every tyre and
// every bit of bodywork on or above the road through each track's crests, dips and ramps,
// while the car still sits on its tyres instead of hovering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import './dom-stub.js';
import { Track } from '../src/race/track.js';
import { Vehicle, statsToParams } from '../src/race/vehicle.js';
import { AIDriver } from '../src/race/ai.js';
import { CarVisual } from '../src/race/raceCars.js';
import { reverseTrackDef } from '../src/race/routes.js';
import { TRACKS } from '../src/data/tracks.js';
import { BASE_STATS } from '../src/data/catalog.js';
import { mulberry32 } from '../src/race/noise.js';

// A 4.7 m coupe: what measureChassis() reads off a model.
const chassis = (() => {
  const front = 1.42, rear = -1.38, halfTrack = 0.82;
  return {
    front, rear, halfTrack, length: 4.7, width: 2,
    points: [
      { a: front, l: -halfTrack, c: 0 }, { a: front, l: halfTrack, c: 0 },
      { a: rear, l: -halfTrack, c: 0 }, { a: rear, l: halfTrack, c: 0 },
      { a: 2.3, l: -0.66, c: 0.12 }, { a: 2.3, l: 0.66, c: 0.12 },
      { a: -2.3, l: -0.66, c: 0.16 }, { a: -2.3, l: 0.66, c: 0.16 },
      { a: 0.02, l: 0, c: 0.1 },
    ],
  };
})();

function rig() {
  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);
  const wheels = [0, 1, 2, 3].map((point) => {
    const wheel = new THREE.Group();
    wheel.position.y = 0.33;
    root.add(wheel);
    return { wheel, spin: new THREE.Group(), front: point < 2, rest: 0.33, point };
  });
  const visual = new CarVisual(root, lean, wheels, null, [], new THREE.MeshBasicMaterial(), 0.33);
  visual.chassis = chassis;
  return visual;
}

// How far the lowest point dips under the road (metres, > 0 = clipping), for a pose.
function clip(v, y, pitch, roll) {
  let worst = -Infinity;
  for (const p of chassis.points) {
    const body = y + p.a * Math.sin(pitch) - p.l * Math.sin(roll) + p.c;
    worst = Math.max(worst, v.groundAt(p.a, p.l) - body);
  }
  return worst;
}

for (const def of TRACKS) {
  test(`${def.id}: no tyre or bodywork goes under the road over a lap, both ways`, () => {
    for (const t of [new Track(def), new Track(reverseTrackDef(def, new Track(def).length))]) {
      const v = new Vehicle(t, statsToParams(BASE_STATS), { passiveNitro: 3 });
      v.reset(0, 0);
      const ai = new AIDriver(v, t, { aggression: 0.6, skill: 0.97, rand: mulberry32(7) });
      const ctx = { time: 0, cars: [], props: { items: [] }, racing: true, playerGap: 0, rival: null };
      const visual = rig();
      visual.update(v, 0, 0);
      const h = 1 / 60;
      let worst = 0;
      let before = 0; // the old pose: centre on the road, smoothed physics pitch, no road roll
      let rest = 0;
      let restFrames = 0;
      let dist = 0;
      let last = v.proj.s;
      for (let time = 0; dist < t.length && time < 150; time += h) {
        ctx.time = time;
        v.step(h, ai.update(h, ctx), time);
        visual.update(v, h, time);
        const r = visual.root;
        worst = Math.max(worst, clip(v, r.position.y, r.rotation.z, r.rotation.x));
        before = Math.max(before, clip(v, v.pos.y, v.pitch, 0));
        if (!v.airborne) {
          // On the ground the lowest tyre touches the road.
          const gaps = [0, 1, 2, 3].map((i) => {
            const p = chassis.points[i];
            return r.position.y + p.a * Math.sin(r.rotation.z) - p.l * Math.sin(r.rotation.x) - v.groundAt(p.a, p.l);
          });
          rest += Math.min(...gaps);
          restFrames++;
        }
        let ds = v.proj.s - last;
        if (ds < -t.length / 2) ds += t.length;
        if (ds > t.length / 2) ds -= t.length;
        dist += ds;
        last = v.proj.s;
      }
      const name = `${def.id}${t.def.reversed ? ' reversed' : ''}`;
      assert.ok(dist >= t.length * 0.98, `${name}: lap driven (${dist.toFixed(0)} m)`);
      assert.ok(worst < 1e-3, `${name}: clips ${(worst * 100).toFixed(1)} cm into the road (was ${(before * 100).toFixed(1)} cm)`);
      assert.ok(before > 0.1, `${name}: the old pose did clip (${(before * 100).toFixed(1)} cm), so this lap tests something`);
      assert.ok(rest / restFrames < 0.005, `${name}: floats ${((rest / restFrames) * 100).toFixed(1)} cm on average`);
    }
  });
}
