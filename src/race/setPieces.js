import * as THREE from 'three';
import { mulberry32, canvasTexture } from './noise.js';
import { paintVertices, mergePainted, createVertexPbrMaterial } from '../render/vertexPbr.js';
import { wettable } from './trackMeshes.js';
import { TRAIL } from './trails.js';
import { VERGE } from './surface.js';

// Emerald Coast set-pieces (blueprint §04 Biome 1): the Tidecutter Gorge timber suspension
// bridge, the waterfall pouring off the gorge head into the sea, seabird flocks on the shore,
// and the red-dirt redwood trails with their log fences. All of it is built in world space from
// the forward track, so the reversed route shares the same meshes.
//
// Draw calls: bridge 1, waterfall 2 (sheet + mist), seabirds 1, trails 2 (dirt + fences),
// forced-route barriers 1 (only on the Redwood Loop).

const up = new THREE.Vector3(0, 1, 0);

// Painted box between two points (a beam, a cable segment, a post), `w` x `h` in section.
function beam(a, b, w, h, pbr) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.BoxGeometry(w, h, len).toNonIndexed();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
  m.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  geo.applyMatrix4(m);
  return paintVertices(geo, pbr);
}

// Vertex-PBR (one batch) that also darkens and glosses in the rain.
function wetAtlas(wet, key) {
  const mat = createVertexPbrMaterial({ envMapIntensity: 0.6 });
  const pbr = mat.onBeforeCompile;
  wettable(mat, wet, { darken: 0.35, key });
  const wetHook = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    wetHook(shader, r);
    pbr(shader, r);
  };
  mat.customProgramCacheKey = () => `vertex-pbr-wet-${key}`;
  return mat;
}

// ---------------------------------------------------------------------------
// Tidecutter Gorge Bridge: a plank deck on timber stringers, hung from two hemp-and-steel main
// cables strung between timber portal towers at each end, with rope handrails.
// ---------------------------------------------------------------------------
export function buildBridge(track, wet) {
  if (!track.bridge) return null;
  const { s0, s1 } = track.bridge;
  const rand = mulberry32(21);
  const parts = [];
  const W = track.fenceOffset + 0.5; // deck half width
  const plank = { color: 0x9a7350, roughness: 0.82 };
  const timber = { color: 0x5e3f27, roughness: 0.9 };
  const rope = { color: 0x8b7355, roughness: 0.95 };
  const steel = { color: 0x50555c, roughness: 0.5, metalness: 0.7 };
  const f = {};
  const at = (s, d, dy = 0) => {
    track.frame(s, f);
    return new THREE.Vector3(f.x + f.rx * d, track.roadY(s) + dy, f.z + f.rz * d);
  };

  // Deck planks across the road, 0.42 m wide with a finger gap, each a slightly different tone.
  const tone = new THREE.Color();
  for (let s = s0 - 1; s < s1 + 1; s += 0.47) {
    tone.setHex(plank.color).multiplyScalar(0.78 + rand() * 0.34);
    const c0 = at(s, 0, -0.06);
    const c1 = at(s + 0.42, 0, -0.06);
    const mid = c0.clone().lerp(c1, 0.5);
    track.frame(s + 0.21, f);
    const geo = new THREE.BoxGeometry(W * 2, 0.12, 0.42).toNonIndexed();
    const q = new THREE.Quaternion().setFromAxisAngle(up, Math.atan2(-f.tz, f.tx) + Math.PI / 2);
    // Follow the road's grade.
    const pitch = Math.atan2(c1.y - c0.y, 0.42);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitch));
    geo.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    parts.push(paintVertices(geo, { ...plank, color: tone.clone() }));
  }
  // Stringers and cross beams under the deck.
  for (let s = s0 - 1; s < s1 + 1; s += 2) {
    const e = Math.min(s + 2, s1 + 1);
    for (const d of [-W + 0.4, -W / 3, W / 3, W - 0.4]) parts.push(beam(at(s, d, -0.35), at(e, d, -0.35), 0.35, 0.45, timber));
  }
  for (let s = s0; s <= s1; s += 3) parts.push(beam(at(s, -W - 0.2, -0.7), at(s, W + 0.2, -0.7), 0.3, 0.35, timber));

  // Portal towers: two legs per end, braced, with a lintel high over the road.
  const towerH = 15;
  const towers = [s0 - 2.5, s1 + 2.5];
  for (const s of towers) {
    for (const side of [-1, 1]) {
      const d = side * (W + 0.7);
      parts.push(beam(at(s, d, -14), at(s, d, towerH), 0.9, 0.9, timber));
      // Diagonal brace back to the cliff.
      parts.push(beam(at(s, d, -12), at(s, d, 2), 0.35, 0.35, timber));
    }
    parts.push(beam(at(s, -W - 1.2, towerH - 0.6), at(s, W + 1.2, towerH - 0.6), 0.7, 0.9, timber));
    parts.push(beam(at(s, -W - 1.2, 8.8), at(s, W + 1.2, 8.8), 0.5, 0.6, timber));
    // X bracing between the two lintels.
    parts.push(beam(at(s, -W - 0.7, 8.8), at(s, W + 0.7, towerH - 0.6), 0.22, 0.22, timber));
    parts.push(beam(at(s, W + 0.7, 8.8), at(s, -W - 0.7, towerH - 0.6), 0.22, 0.22, timber));
  }

  // Main cables: a parabola between the tower tops, dipping to 1.6 m above the deck at
  // midspan, plus backstays to anchor blocks on the cliffs. Hangers every 2.5 m.
  const span = towers[1] - towers[0];
  const cableY = (s) => {
    const u = (s - towers[0]) / span;
    return 1.6 + (towerH - 0.3 - 1.6) * (2 * u - 1) ** 2;
  };
  for (const side of [-1, 1]) {
    const d = side * (W + 0.7);
    const steps = 24;
    let prev = at(towers[0], d, cableY(towers[0]));
    for (let k = 1; k <= steps; k++) {
      const s = towers[0] + (span * k) / steps;
      const p = at(s, d, cableY(s));
      parts.push(beam(prev, p, 0.16, 0.16, steel));
      prev = p;
    }
    parts.push(beam(at(towers[0], d, towerH - 0.3), at(towers[0] - 14, d * 1.3, -1.5), 0.16, 0.16, steel));
    parts.push(beam(at(towers[1], d, towerH - 0.3), at(towers[1] + 14, d * 1.3, -1.5), 0.16, 0.16, steel));
    for (const s of [towers[0] - 14, towers[1] + 14]) parts.push(beam(at(s, d * 1.3, -2.2), at(s, d * 1.3, -0.6), 1.4, 1.2, { color: 0x77736c, roughness: 0.95 }));
    for (let s = towers[0] + 2.5; s < towers[1] - 1; s += 2.5) {
      const h = cableY(s);
      if (h < 1.3) continue;
      parts.push(beam(at(s, d, 0), at(s, d, h), 0.05, 0.05, rope));
    }
    // Handrail: timber posts and two rope rails at the deck edge.
    const rd = side * (W - 0.15);
    for (let s = s0 - 1; s <= s1 + 1; s += 2.5) parts.push(beam(at(s, rd, 0), at(s, rd, 1.15), 0.16, 0.16, timber));
    for (let s = s0 - 1; s < s1 + 1; s += 2.5) {
      const e = Math.min(s1 + 1, s + 2.5);
      parts.push(beam(at(s, rd, 1.1), at(e, rd, 1.1), 0.1, 0.12, timber));
      parts.push(beam(at(s, rd, 0.6), at(e, rd, 0.55), 0.06, 0.06, rope));
    }
  }
  const mesh = new THREE.Mesh(mergePainted(parts), wetAtlas(wet, 'bridge'));
  mesh.name = 'bridge';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Waterfall off the gorge head: a curved sheet of falling water (scrolling streaks, white where
// it breaks), a plunge pool of foam and a drifting mist cloud at the bottom.
// ---------------------------------------------------------------------------
export function buildWaterfall(gorge, sampleHeight) {
  if (!gorge) return null;
  const group = new THREE.Group();
  group.name = 'waterfall';
  const { ux, uz, tx, tz } = gorge;
  const P = (u, v, y) => new THREE.Vector3(gorge.x + ux * u + tx * v, y, gorge.z + uz * u + tz * v);
  const lipU = -gorge.inland - 12;
  const top = Math.max(12, sampleHeight(P(lipU - 4, 0, 0).x, P(lipU - 4, 0, 0).z) - 0.6);
  const width = 9;
  // Sheet: rows from the lip down to the sea, bulging out from the wall as it falls.
  const rows = 14;
  const cols = 6;
  const pos = [];
  const uv = [];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const y = top + (-0.5 - top) * t;
    const u = lipU + 2 + 13 * Math.sqrt(t) + t * 1.5;
    for (let c = 0; c <= cols; c++) {
      const k = c / cols;
      const v = (k - 0.5) * width * (1 + t * 0.35);
      const p = P(u, v, y);
      pos.push(p.x, p.y, p.z);
      uv.push(k, t);
    }
  }
  const index = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      index.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 }, height: { value: top } }]);
  const sheet = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      fog: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform float time, height;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        void main() {
          // Streaks falling faster as they drop (v^2 parametrisation of free fall).
          float fall = vUv.y * vUv.y * height * 0.35 - time * 2.6;
          float n = noise(vec2(vUv.x * 26.0, fall)) * 0.6 + noise(vec2(vUv.x * 61.0, fall * 2.3)) * 0.4;
          float edge = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
          float breakUp = smoothstep(0.55, 1.0, vUv.y);
          vec3 water = mix(vec3(0.55, 0.7, 0.74), vec3(0.95, 0.98, 1.0), clamp(n * 0.8 + breakUp * 0.6, 0.0, 1.0));
          float a = edge * mix(0.55, 0.92, n) * (1.0 - smoothstep(0.96, 1.0, vUv.y) * 0.6);
          gl_FragColor = vec4(water * 1.15, a);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    })
  );
  sheet.renderOrder = 3;
  group.add(sheet);

  // Mist and foam at the plunge: soft points cycling up and out in the shader.
  const count = 70;
  const rand = mulberry32(5);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) seeds.set([rand(), rand(), rand()], i * 3);
  const base = P(lipU + 16, 0, 0.4);
  const mgeo = new THREE.BufferGeometry();
  mgeo.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
  const mist = new THREE.Points(
    mgeo,
    new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, base: { value: base }, axisU: { value: new THREE.Vector3(ux, 0, uz) }, axisV: { value: new THREE.Vector3(tx, 0, tz) }, scale: { value: 500 } },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float time, scale;
        uniform vec3 base, axisU, axisV;
        varying float vA;
        void main() {
          float life = fract(position.z + time * (0.12 + position.x * 0.08));
          vec3 p = base + axisV * (position.x - 0.5) * (8.0 + life * 10.0) + axisU * life * (3.0 + position.y * 9.0);
          p.y += life * (4.0 + position.y * 8.0);
          vA = sin(life * 3.14159) * 0.32;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (3.0 + life * 6.0) * scale / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(c)) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.93, 0.96, 0.98), a);
        }`,
    })
  );
  mist.frustumCulled = false;
  mist.renderOrder = 4;
  group.add(mist);
  group.userData = {
    top,
    base,
    update(t) {
      uniforms.time.value = t;
      mist.material.uniforms.time.value = t;
    },
    setViewport(height, fov) {
      mist.material.uniforms.scale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    },
  };
  return group;
}

// ---------------------------------------------------------------------------
// Seabirds: gulls loafing on the cliff tops beside the road. Drive past fast and close and the
// flock bursts up and away, wheels out over the sea, and settles again a while later.
// ---------------------------------------------------------------------------
export const SEABIRD = {
  perFlock: 14,
  radius: 35, // m from the flock centre
  speed: 18, // m/s the car must be doing
  settle: 22, // s before a scattered flock lands again (once the car is gone)
};

// Pure trigger rule (tests): does a car at (dx, dz) from the flock, doing `speed` m/s, flush it?
export function flushes(dx, dz, speed) {
  return speed > SEABIRD.speed && dx * dx + dz * dz < SEABIRD.radius * SEABIRD.radius;
}

function birdGeometry() {
  // Body along +x (the bird's heading), wings out along ±z. `wing` = 0 body, 1 wing root..tip.
  const pos = [];
  const col = [];
  const wing = [];
  const tri = (a, b, c, color, w) => {
    pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) col.push(...color);
    wing.push(...w);
  };
  const white = [0.95, 0.95, 0.93];
  const grey = [0.62, 0.66, 0.7];
  const tip = [0.12, 0.12, 0.14];
  // Body: a slim double cone.
  const n = [0.42, 0, 0];
  const t = [-0.38, 0.02, 0];
  const ring = [[0, 0.12, 0], [0, 0, 0.1], [0, -0.1, 0], [0, 0, -0.1]];
  for (let k = 0; k < 4; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % 4];
    tri(n, a, b, white, [0, 0, 0]);
    tri(t, b, a, white, [0, 0, 0]);
  }
  // Wings: inner panel grey, outer panel with black tips; both faces.
  for (const side of [-1, 1]) {
    const r0 = [0.12, 0.02, 0];
    const r1 = [-0.12, 0.02, 0];
    const m0 = [0.06, 0.02, side * 0.5];
    const m1 = [-0.16, 0.02, side * 0.48];
    const tp = [-0.12, 0.02, side * 0.95];
    for (const flip of [false, true]) {
      const f = (a, b, c, color, w) => (flip ? tri(a, c, b, color, [w[0], w[2], w[1]]) : tri(a, b, c, color, w));
      f(r0, m0, r1, grey, [0, 0.5, 0]);
      f(r1, m0, m1, grey, [0, 0.5, 0.5]);
      f(m0, tp, m1, tip, [0.5, 1, 0.5]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('wing', new THREE.Float32BufferAttribute(wing, 1));
  geo.computeVertexNormals();
  return geo;
}

export class Seabirds {
  constructor(track, def, sampleHeight) {
    const rand = mulberry32(77);
    this.flocks = (def.seabirds ?? []).map((spec) => {
      const s = spec.at * track.length;
      const f = track.frame(s, {});
      const d = spec.side * (track.fenceOffset + 5);
      const cx = f.x + f.rx * d;
      const cz = f.z + f.rz * d;
      const birds = [];
      for (let i = 0; i < SEABIRD.perFlock; i++) {
        const a = rand() * Math.PI * 2;
        const r = 1 + rand() * 6;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        const y = Math.max(0.2, sampleHeight(x, z)) + 0.32; // standing, clear of the grass
        birds.push({
          home: new THREE.Vector3(x, y, z),
          homeYaw: rand() * Math.PI * 2,
          pos: new THREE.Vector3(x, y, z),
          vel: new THREE.Vector3(),
          yaw: 0,
          phase: rand() * 10,
          delay: rand() * 0.35,
          climb: 5 + rand() * 4,
        });
      }
      // Away from the road, toward the sea side.
      return { x: cx, z: cz, out: new THREE.Vector2(f.rx * spec.side, f.rz * spec.side), birds, state: 'rest', t: 0 };
    });
    const total = Math.max(1, this.flocks.length * SEABIRD.perFlock);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const flap = new Float32Array(total * 2);
    this.flap = new THREE.InstancedBufferAttribute(flap, 2).setUsage(THREE.DynamicDrawUsage);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float wing;\nattribute vec2 flap;\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          // flap.x: wing beat phase rate (0 = gliding); flap.y: spread (0 folded at rest, 1 open).
          float beat = sin(uTime * flap.x * 6.2832 + float(gl_InstanceID) * 1.7);
          transformed.z *= mix(1.0, mix(0.14, 1.0, flap.y), step(0.001, wing));
          transformed.y += wing * mix(0.06, beat * 0.42, flap.y) * (0.4 + 0.6 * step(0.01, flap.x));
          transformed.x -= wing * (1.0 - flap.y) * 0.26;`
        );
    };
    mat.customProgramCacheKey = () => 'seabird';
    this.time = { value: 0 };
    const geo = birdGeometry();
    geo.setAttribute('flap', this.flap);
    this.mesh = new THREE.InstancedMesh(geo, mat, total);
    this.mesh.name = 'seabirds';
    this.mesh.count = this.flocks.length * SEABIRD.perFlock;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._one = new THREE.Vector3(1, 1, 1).multiplyScalar(1.5);
    this.scattered = 0; // flocks flushed this race (QA / tests)
    this.reset();
  }

  reset() {
    for (const fl of this.flocks) {
      fl.state = 'rest';
      fl.t = 0;
      for (const b of fl.birds) {
        b.pos.copy(b.home);
        b.vel.set(0, 0, 0);
        b.yaw = b.homeYaw;
      }
    }
    this.scattered = 0;
    this.update(0, 0, null, 0);
  }

  // car: the player's vehicle (pos, speed) or null.
  update(dt, time, car, speed) {
    this.time.value = time;
    let slot = 0;
    for (const fl of this.flocks) {
      fl.t += dt;
      if (car) {
        const dx = car.pos.x - fl.x;
        const dz = car.pos.z - fl.z;
        if (fl.state === 'rest' && flushes(dx, dz, speed)) {
          fl.state = 'flight';
          fl.t = 0;
          this.scattered += 1;
          this.onScatter?.(fl);
          for (const b of fl.birds) {
            // Up and away from the car, fanning out toward the sea.
            const ax = b.pos.x - car.pos.x;
            const az = b.pos.z - car.pos.z;
            const l = Math.hypot(ax, az) || 1;
            b.vel.set((ax / l) * 4 + fl.out.x * 6 + (Math.random() - 0.5) * 3, b.climb, (az / l) * 4 + fl.out.y * 6 + (Math.random() - 0.5) * 3);
          }
        } else if (fl.state === 'flight' && fl.t > SEABIRD.settle && dx * dx + dz * dz > 180 * 180) {
          fl.state = 'rest';
          for (const b of fl.birds) {
            b.pos.copy(b.home);
            b.vel.set(0, 0, 0);
            b.yaw = b.homeYaw;
          }
        }
      }
      for (const b of fl.birds) {
        let beat = 0;
        let spread = 0;
        if (fl.state === 'flight') {
          const age = fl.t - b.delay;
          if (age > 0) {
            // Burst of flapping, then wheeling glides out over the sea, climbing slowly.
            const k = Math.min(1, age / 2.5);
            b.vel.y += (1.2 - b.vel.y) * Math.min(1, dt * 0.8 * k);
            const turn = 0.35 * dt * k;
            const vx = b.vel.x;
            b.vel.x = vx * Math.cos(turn) - b.vel.z * Math.sin(turn);
            b.vel.z = vx * Math.sin(turn) + b.vel.z * Math.cos(turn);
            b.pos.addScaledVector(b.vel, dt);
            b.yaw = Math.atan2(-b.vel.z, b.vel.x);
            spread = 1;
            beat = age < 2.2 ? 4.2 : Math.sin(age * 0.7 + b.phase) > 0.3 ? 2.6 : 0;
          }
        } else {
          // Resting: an occasional hop and stretch.
          const hop = Math.max(0, Math.sin(time * 0.9 + b.phase * 3) - 0.97) * 30;
          b.pos.y = b.home.y + hop * 0.06;
        }
        this._q.setFromAxisAngle(up, b.yaw);
        this._m.compose(b.pos, this._q, this._one);
        this.mesh.setMatrixAt(slot, this._m);
        this.flap.setXY(slot, beat, spread);
        slot++;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.flap.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Redwood trails: packed red dirt with tyre ruts fading into leaf litter at the edges, split-log
// fences on posts, and (Redwood Loop only) water-filled barriers closing the highway along the
// inner line of each fork and merge.
// ---------------------------------------------------------------------------
function dirtTexture() {
  const tex = canvasTexture(THREE, 128, 256, (g, w, h) => {
    const rand = mulberry32(31);
    g.fillStyle = '#c9c2bb';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const v = 150 + rand() * 105;
      g.fillStyle = `rgba(${v},${v * 0.95},${v * 0.9},${0.25 + rand() * 0.35})`;
      const s = 1 + rand() * 3;
      g.fillRect(rand() * w, rand() * h, s, s);
    }
    // Two tyre ruts.
    for (const x of [0.3, 0.7]) {
      const grd = g.createLinearGradient(w * (x - 0.08), 0, w * (x + 0.08), 0);
      grd.addColorStop(0, 'rgba(90,70,60,0)');
      grd.addColorStop(0.5, 'rgba(90,70,60,0.35)');
      grd.addColorStop(1, 'rgba(90,70,60,0)');
      g.fillStyle = grd;
      g.fillRect(w * (x - 0.08), 0, w * 0.16, h);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function buildTrails(track, wet) {
  if (!track.trails.length) return null;
  const group = new THREE.Group();
  group.name = 'trails';
  const dirt = new THREE.Color(0xa24a28);
  const litter = new THREE.Color(0x4a3a22);
  const pos = [];
  const col = [];
  const uv = [];
  const index = [];
  const fence = [];
  const barriers = [];
  const timber = { color: 0x6a4a30, roughness: 0.92 };
  const pr = {};
  const onHighway = (x, z, hint) => {
    track.project(x, z, hint, pr);
    return Math.abs(pr.d) < track.halfWidth + VERGE - 0.2;
  };
  for (const t of track.trails) {
    const base = pos.length / 3;
    // Across the lane: litter fringe, dirt edge, packed core, dirt edge, litter fringe.
    const cols = [[-1.25, litter, 0], [-1, dirt, 0.12], [-TRAIL.core / TRAIL.half, dirt, 0.3], [TRAIL.core / TRAIL.half, dirt, 0.7], [1, dirt, 0.88], [1.25, litter, 1]];
    const rows = Math.ceil(t.length / 2);
    const c = new THREE.Color();
    for (let r = 0; r <= rows; r++) {
      const ls = (r / rows) * t.length;
      const f = t.frame(ls, {});
      const hw = t.halfWidthAt(ls);
      const y = t.roadY(ls) - 0.035;
      for (const [k, color, u] of cols) {
        const d = k * hw;
        pos.push(f.x + f.rx * d, y - (Math.abs(k) > 1 ? 0.12 : 0), f.z + f.rz * d);
        c.copy(color).multiplyScalar(Math.abs(k) > 0.5 && Math.abs(k) <= 1 ? 0.85 : 1);
        col.push(c.r, c.g, c.b);
        uv.push(u, ls / 8);
      }
    }
    const nc = cols.length;
    for (let r = 0; r < rows; r++) {
      for (let j = 0; j < nc - 1; j++) {
        const a = base + r * nc + j;
        const b = a + nc;
        index.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    // Fences: posts every 3 m, a split-log rail between them. Where the fence line runs over
    // the highway (the inner side of the fork and merge) a barrier stands instead, only on the
    // Redwood Loop.
    for (const side of [-1, 1]) {
      let prev = null;
      let hint = -1;
      for (let ls = 0; ls <= t.length; ls += 3) {
        const f = t.frame(ls, {});
        const d = side * (t.halfWidthAt(ls) + 0.3);
        const x = f.x + f.rx * d;
        const z = f.z + f.rz * d;
        const y = t.roadY(ls);
        const road = onHighway(x, z, hint);
        hint = pr.i;
        const p = new THREE.Vector3(x, y, z);
        if (road) {
          barriers.push({ p, yaw: Math.atan2(-f.tz, f.tx) });
          prev = null;
          continue;
        }
        fence.push(beam(p.clone().setY(y - 0.4), p.clone().setY(y + 1.05), 0.2, 0.2, timber));
        if (prev) fence.push(beam(prev.clone().setY(prev.y + 0.82), p.clone().setY(y + 0.82), 0.18, 0.22, timber));
        if (prev) fence.push(beam(prev.clone().setY(prev.y + 0.4), p.clone().setY(y + 0.4), 0.16, 0.18, timber));
        prev = p;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const dirtMat = wettable(new THREE.MeshStandardMaterial({ map: dirtTexture(), vertexColors: true, roughness: 0.95 }), wet, { darken: 0.4, key: 'dirt' });
  const road = new THREE.Mesh(geo, dirtMat);
  road.name = 'trail-dirt';
  road.receiveShadow = true;
  group.add(road);
  if (fence.length) {
    const fences = new THREE.Mesh(mergePainted(fence), wetAtlas(wet, 'fence'));
    fences.name = 'trail-fences';
    fences.castShadow = true;
    fences.receiveShadow = true;
    group.add(fences);
  }
  // Barriers: alternating red / white water-filled blocks.
  if (barriers.length) {
    const block = new THREE.BoxGeometry(0.6, 0.95, 1.95).translate(0, 0.475, 0).toNonIndexed();
    const geos = barriers.map(({ p, yaw }, i) => {
      const g = block.clone().applyMatrix4(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(up, yaw), new THREE.Vector3(1, 1, 1)));
      return paintVertices(g, { color: i % 2 ? 0xf2f2f0 : 0xd8382c, roughness: 0.5 });
    });
    const mesh = new THREE.Mesh(mergePainted(geos), createVertexPbrMaterial());
    mesh.name = 'trail-barriers';
    mesh.castShadow = true;
    mesh.visible = false;
    group.add(mesh);
    group.userData.barriers = mesh;
  }
  return group;
}
