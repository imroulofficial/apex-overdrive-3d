import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyFinish, liveryPaint } from '../garage/carPaint.js';
import { FINISHES } from '../data/catalog.js';
import { backFace, createVertexPbrMaterial, describeMaterial, isFlatMaterial, mergePainted, paintVertices } from '../render/vertexPbr.js';

// Race-ready cars baked from a car rig (a track LOD of a real model, see modelLoader.js). A
// model has dozens of meshes; on track six of them would cost hundreds of draw calls. Here
// every untextured part (trim, carbon, chrome, lenses, liners...) is folded into one
// vertex-coloured "atlas" mesh, paint, glass, textured parts and the lights keep their own
// materials, and the wheels of every car from one factory are a single InstancedMesh. A rival
// costs ~4 draw calls; the player's textured car a few more.
//
// Grounding: car bodies receive the sun's shadow (dark under bridges, trees and overpasses
// like the road around them), every car sits on a soft contact shadow (ContactShadows, one
// instanced draw for the field) and head / tail lights follow the weather's light level. Only
// the player's car casts into the shadow map; rivals rely on their contact shadow.

const ATLAS = Symbol('atlas');
const WHEEL_CAPACITY = 16; // per side: up to 16 cars per factory
function sliceGroups(mesh) {
  const geo = mesh.geometry;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (!Array.isArray(mesh.material) || !geo.groups.length) return [{ geo, mat: mats[0] }];
  return geo.groups.map((g) => {
    const part = new THREE.BufferGeometry();
    for (const name of Object.keys(geo.attributes)) part.setAttribute(name, geo.attributes[name]);
    const src = geo.index.array;
    part.setIndex(Array.from(src.subarray(g.start, g.start + g.count)));
    return { geo: part, mat: mats[g.materialIndex] };
  });
}

// Plain float copy of an attribute. Meshopt-compressed models arrive quantized (normalized
// int16 positions, int8 normals); transforming those in place clamps every vertex to the
// [-1, 1] range of the integer type and shreds the mesh.
function toFloat(attr) {
  const k = attr.itemSize;
  const out = new Float32Array(attr.count * k);
  const get = ['getX', 'getY', 'getZ', 'getW'];
  for (let i = 0; i < attr.count; i++) for (let c = 0; c < k; c++) out[i * k + c] = attr[get[c]](i);
  return new THREE.BufferAttribute(out, k);
}

function normalize(geo, matrix) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    else if (!(g.attributes[name].array instanceof Float32Array) || g.attributes[name].normalized || g.attributes[name].isInterleavedBufferAttribute) g.setAttribute(name, toFloat(g.attributes[name]));
  }
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  g.applyMatrix4(matrix);
  return g;
}

// paintVertices() for a part that may carry baked vertex colours (generated models' rival
// LOD): the material's flat colour multiplies them instead of replacing them.
function paintBaked(g, description) {
  const baked = g.attributes.color;
  paintVertices(g, description);
  if (!baked) return g;
  const col = g.attributes.color;
  for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * baked.getX(i), col.getY(i) * baked.getY(i), col.getZ(i) * baked.getZ(i));
  return g;
}

// Collect meshes under `root` (excluding `skip` subtrees) into one merged mesh per material.
// Parts mapped to ATLAS are painted into vertex attributes and merged under `atlasMaterial`.
function bake(root, relativeTo, skip = () => false, materialMap = (m) => m, atlasMaterial = null) {
  const buckets = new Map();
  const inv = new THREE.Matrix4().copy(relativeTo.matrixWorld).invert();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || o.name === 'beam') return;
    for (let p = o; p && p !== root; p = p.parent) if (skip(p)) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    for (const { geo, mat } of sliceGroups(o)) {
      const target = materialMap(mat);
      if (!target) continue;
      const key = target === ATLAS ? atlasMaterial : target;
      if (!buckets.has(key)) buckets.set(key, []);
      const g = normalize(geo, m);
      if (target === ATLAS) {
        paintBaked(g, describeMaterial(mat));
        buckets.get(key).push(g);
        if (mat.side === THREE.DoubleSide) buckets.get(key).push(backFace(g));
      } else {
        buckets.get(key).push(g);
      }
    }
  });
  return [...buckets].map(([mat, geos]) => {
    const mesh = new THREE.Mesh(mat === atlasMaterial ? mergePainted(geos) : mergeGeometries(geos), mat);
    mesh.castShadow = true;
    return mesh;
  });
}

// Clear-coated paint for rivals: the showroom's flake normal map and iridescence are left
// out (they cost a texture fetch and a lobe each), the lacquer layer and env reflections stay.
// `livery` (the template paint's livery uniforms) keeps a generated model's baked vertex
// colours as shading under the rival's colour.
export function createRivalPaint(color, finish = 'gloss', livery = null) {
  const f = FINISHES[finish] ?? FINISHES.gloss;
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    metalness: f.metalness,
    roughness: Math.max(0.12, f.roughness),
    clearcoat: Math.max(0.6, f.clearcoat),
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.35,
    vertexColors: Boolean(livery),
  });
  if (livery) {
    liveryPaint(mat, { factoryLum: livery.uFactoryLum.value, source: 'vertex' });
    mat.userData.livery.uFactory.value = f.factory ? 1 : 0;
  }
  return mat;
}

function flameTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  // Bright at the nozzle (bottom of the canvas = cone base), fading toward the tip.
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

// Where the car touches the road, measured on its model (car space: nose +X, right +Z, tyres
// on y = 0): the four tyre contact patches, plus points under the nose, the tail and the
// floor with their ground clearance. CarVisual casts a ray down from each of them every frame.
function measureChassis(template, wheelsSrc, box) {
  const xs = wheelsSrc.map((w) => w.position.x);
  const mid = (Math.max(...xs) + Math.min(...xs)) / 2;
  const front = wheelsSrc.filter((w) => w.position.x > mid);
  const rear = wheelsSrc.filter((w) => w.position.x <= mid);
  const avg = (list, f) => list.reduce((n, w) => n + f(w), 0) / Math.max(1, list.length);
  const frontX = front.length ? avg(front, (w) => w.position.x) : 1.3;
  const rearX = rear.length ? avg(rear, (w) => w.position.x) : -1.3;
  const halfTrack = wheelsSrc.length ? avg(wheelsSrc, (w) => Math.abs(w.position.z)) : 0.8;
  const length = box.max.x - box.min.x;
  // Lowest bodywork in three zones: nose overhang, tail overhang and the floor between axles.
  const low = { nose: Infinity, tail: Infinity, floor: Infinity };
  const v = new THREE.Vector3();
  template.group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(template.group.matrixWorld).invert();
  const m = new THREE.Matrix4();
  template.group.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (wheelsSrc.includes(p)) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (v.x > box.max.x - length * 0.12) low.nose = Math.min(low.nose, v.y);
      else if (v.x < box.min.x + length * 0.12) low.tail = Math.min(low.tail, v.y);
      else if (v.x > rearX + 0.3 && v.x < frontX - 0.3 && Math.abs(v.z) < halfTrack * 0.7) low.floor = Math.min(low.floor, v.y);
    }
  });
  const clear = (y, fallback) => (Number.isFinite(y) ? Math.max(0.02, y) : fallback);
  const nose = clear(low.nose, 0.15);
  const tail = clear(low.tail, 0.18);
  const floor = clear(low.floor, 0.12);
  const noseX = box.max.x - 0.05;
  const tailX = box.min.x + 0.05;
  const corner = halfTrack * 0.8;
  return {
    front: frontX,
    rear: rearX,
    halfTrack,
    length,
    width: box.max.z - box.min.z,
    // { a: metres ahead of the centre, l: metres to the right, c: clearance above the road }
    // The first four are the wheels (FL, FR, RL, RR) in that order.
    points: [
      { a: frontX, l: -halfTrack, c: 0 },
      { a: frontX, l: halfTrack, c: 0 },
      { a: rearX, l: -halfTrack, c: 0 },
      { a: rearX, l: halfTrack, c: 0 },
      { a: noseX, l: -corner, c: nose },
      { a: noseX, l: corner, c: nose },
      { a: tailX, l: -corner, c: tail },
      { a: tailX, l: corner, c: tail },
      { a: (frontX + rearX) / 2, l: 0, c: floor },
    ],
  };
}

export class CarFactory {
  // `template` is a car rig from loadCar(); the factory never mutates it.
  constructor(template) {
    this.template = template;
    template.group.updateMatrixWorld(true);
    this.paint = template.paintMaterial;
    this.flameTex = flameTexture();
    this.atlas = createVertexPbrMaterial({ envMapIntensity: 1.1 });
    // Length and width of the car on the ground, for its contact shadow.
    const box = new THREE.Box3().setFromObject(template.group, true);
    const size = box.getSize(new THREE.Vector3());
    this.footprint = { length: size.x, width: size.z };
    // Left and right wheels are mirror images, so each side gets its own batch.
    const wheelsSrc = template.group.children.filter((c) => c.isGroup && c.userData.wheelIndex !== undefined);
    this.chassis = measureChassis(template, wheelsSrc, box);
    this.wheelBatches = [];
    for (const side of [1, -1]) {
      const src = wheelsSrc.find((w) => Math.sign(w.position.z || 1) === side);
      const mesh = src && this.createWheelBatch(src);
      if (mesh) this.wheelBatches.push({ side, mesh, slots: [] });
    }
    // Instancing only when both sides batch; otherwise every wheel stays a per-car mesh.
    if (this.wheelBatches.length !== 2) this.wheelBatches = [];
  }

  // Meshes the race adds to its scene once (shared by every car from this factory).
  get sharedMeshes() {
    return this.wheelBatches.map((b) => b.mesh);
  }

  // Frees what the factory made (wheel batches, atlas, flame texture); the template belongs
  // to the model loader's cache.
  dispose() {
    for (const { mesh } of this.wheelBatches) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.atlas.dispose();
    this.flameTex.dispose();
  }

  setPlayerPaint(color, finish) {
    applyFinish(this.paint, color, finish);
  }

  // One InstancedMesh for every wheel on one side of the cars this factory builds (tyre, rim
  // and disc merged with vertex PBR). Returns null when the wheel uses textures.
  createWheelBatch(src) {
    const geos = [];
    let flat = true;
    src.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
    const m = new THREE.Matrix4();
    src.traverse((o) => {
      if (!o.isMesh || o.name === 'caliper') return;
      m.multiplyMatrices(inv, o.matrixWorld);
      for (const { geo, mat } of sliceGroups(o)) {
        if (!isFlatMaterial(mat)) flat = false;
        const g = normalize(geo, m);
        paintBaked(g, describeMaterial(mat));
        geos.push(g);
        if (mat.side === THREE.DoubleSide) geos.push(backFace(g));
      }
    });
    if (!flat || !geos.length) return null;
    const mesh = new THREE.InstancedMesh(mergePainted(geos), this.atlas, WHEEL_CAPACITY);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    // Wheels move with the cars; the batch bounds would have to be rebuilt every frame.
    mesh.frustumCulled = false;
    mesh.name = 'wheels';
    return mesh;
  }

  // Copies every wheel's world transform into the batch. Call once per frame after the cars move.
  syncWheels() {
    for (const { mesh, slots } of this.wheelBatches) {
      for (let i = 0; i < slots.length; i++) {
        slots[i].updateWorldMatrix(true, false);
        mesh.setMatrixAt(i, slots[i].matrixWorld);
      }
      mesh.count = slots.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // Which chassis ray (index into chassis.points) sits under a template wheel.
  wheelPoint(src) {
    const { front, rear } = this.chassis;
    const isFront = Math.abs(src.position.x - front) < Math.abs(src.position.x - rear);
    return (isFront ? 0 : 2) + (src.position.z > 0 ? 1 : 0);
  }

  // Drops a car's wheels from the batches (its visual is being thrown away).
  release(visual) {
    for (const b of this.wheelBatches) b.slots = b.slots.filter((s) => !visual.wheels.some((w) => w.spin === s));
  }

  // Builds a car; the player keeps the garage clear-coat paint, rivals get a lighter clear-coat.
  // `castShadow: false` leaves the car out of the sun's shadow map (its contact shadow stays).
  build({ color, finish = 'gloss', player = false, castShadow = true }) {
    const t = this.template.group;
    const own = new Map();
    const paint = player ? this.paint : createRivalPaint(color, finish, this.paint.userData.livery);
    const materialMap = (mat) => {
      if (mat === this.paint) return paint;
      if (mat.name === 'skip') return null;
      // Tail lenses are per car so brake lights can glow independently.
      if (mat.userData.tailLight || mat.userData.headLight) {
        if (!own.has(mat)) own.set(mat, mat.clone());
        return own.get(mat);
      }
      return isFlatMaterial(mat) ? ATLAS : mat;
    };
    const wheelsSrc = t.children.filter((c) => c.isGroup && c.userData.wheelIndex !== undefined);
    const isWheel = (o) => wheelsSrc.includes(o);

    const root = new THREE.Group(); // position + yaw + pitch + road roll (suspension)
    // Body lean (cornering roll, squat) pivots at axle height, so the sills never swing
    // down into the road; the wheels stay on the root and follow the ground themselves.
    const pivot = this.template.wheelRadius;
    const lean = new THREE.Group();
    lean.position.y = pivot;
    const body = new THREE.Group();
    body.position.y = -pivot;
    lean.add(body);
    root.add(lean);
    bake(t, t, isWheel, materialMap, this.atlas).forEach((mesh) => {
      // One shadow caster per car keeps the shadow pass cheap; the paint shell is the silhouette.
      mesh.castShadow = castShadow && mesh.material === paint;
      // Every opaque part takes the sun's shadow so the car darkens with the road around it.
      mesh.receiveShadow = !mesh.material.transparent;
      body.add(mesh);
    });
    const lights = [...own.values()];
    const tail = lights.find((m) => m.userData.tailLight) ?? null;
    const head = lights.find((m) => m.userData.headLight) ?? null;

    const wheels = wheelsSrc.map((src, index) => {
      const wheel = new THREE.Group();
      wheel.position.copy(src.position);
      const spin = new THREE.Group();
      wheel.add(spin);
      const batch = this.wheelBatches.find((b) => b.side === Math.sign(src.position.z || 1));
      if (batch && batch.slots.length < WHEEL_CAPACITY) {
        batch.slots.push(spin);
      } else {
        // Textured wheels: everything except the caliper spins, one mesh per material.
        const merged = bake(src, src, (o) => o.name === 'caliper');
        merged.forEach((mesh) => {
          mesh.castShadow = false;
          spin.add(mesh);
        });
      }
      root.add(wheel);
      return { wheel, spin, front: index < 2, rest: src.position.y, point: this.wheelPoint(src) };
    });

    // Nitro flames at the exhausts.
    const flameMat = new THREE.MeshBasicMaterial({
      map: this.flameTex,
      color: 0x3aa8ff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const flameGeo = new THREE.ConeGeometry(0.11, 1.1, 10, 1, true);
    flameGeo.rotateZ(Math.PI / 2); // tip points backwards (-x)
    flameGeo.translate(-0.55, 0, 0); // base at the nozzle
    const flames = [];
    for (const at of this.template.exhausts) {
      const fl = new THREE.Mesh(flameGeo, flameMat);
      fl.position.copy(at);
      fl.visible = false;
      fl.renderOrder = 5;
      body.add(fl);
      flames.push(fl);
    }
    const visual = new CarVisual(root, lean, wheels, tail, flames, flameMat, this.template.wheelRadius);
    visual.head = head;
    visual.footprint = this.footprint;
    visual.chassis = this.chassis;
    // Materials made for this car alone (the atlas, wheels and template parts are shared).
    visual.owned = [...lights, flameMat, ...(player ? [] : [paint])];
    return visual;
  }

}

const BLUE = new THREE.Color(0x3aa8ff);
const ORANGE = new THREE.Color(0xff7a1a);
const PURPLE = new THREE.Color(0xb44dff);

// Nitro flame brightness: above 1 the flames feed the bloom pass (race/Race.js sets it while
// bloom is on; without bloom they would only clip to white).
export const FLAME = { hdr: 1 };

// Head and tail lights on track: race/Race.js switches them on for dusk, night, fog, rain and
// snow (the weather's sun intensity), like every driver would.
export const LIGHTS = { on: false };

export class CarVisual {
  constructor(root, body, wheels, tail, flames, flameMat, wheelRadius) {
    this.root = root;
    this.wheelRadius = wheelRadius;
    this.body = body;
    this.wheels = wheels;
    this.tail = tail;
    this.flames = flames;
    this.flameMat = flameMat;
    this.roll = 0;
    this.squat = 0;
    this.nitroFx = null; // { color, pulse: [a, b] } colours, or null for the stock blue
    this.fxColors = null;
    this.steerVis = 0;
    this.lastForward = 0;
    root.rotation.order = 'YZX';
    // Suspension state (see suspend()): ride height, pitch and road roll with their rates.
    this.chassis = null;
    this.ride = { y: 0, vy: 0, pitch: 0, vPitch: 0, roll: 0, vRoll: 0, floor: 0, init: false };
    this.ground = new Float32Array(9);
  }

  // Frees this car's baked geometries and its own materials (call after release()).
  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => o.isMesh && o.geometry.dispose());
    for (const m of this.owned ?? []) m.dispose();
  }

  // Nitro trail colour (FX_COLORS entry) for this car's flames; null keeps the stock blue.
  setNitroFx(fx) {
    this.fxColors = fx ? { blue: new THREE.Color(fx.color), a: new THREE.Color(fx.pulse[0]), b: new THREE.Color(fx.pulse[1]) } : null;
  }

  // Road contact. Rays from the chassis points (four tyre patches, nose, tail and floor; see
  // measureChassis) find the road; the body pitches and rolls to the plane of the tyres on
  // springs, then a hard floor lock lifts it until no tyre and no bodywork is below the road,
  // whatever the springs are doing. Over a crest or into a dip the car settles with damping
  // instead of snapping, and on a ramp lip or a sudden rise it is lifted that same frame, so
  // the chassis never cuts into the asphalt. Wheels drop to the road below them (up to the
  // suspension travel). Physics is unchanged: it still drives the car's centre on the road.
  suspend(v, dt) {
    const ch = this.chassis;
    const r = this.ride;
    const hs = this.ground;
    const pts = ch.points;
    for (let i = 0; i < pts.length; i++) hs[i] = v.groundAt(pts[i].a, pts[i].l);
    let pitch = v.pitch;
    let roll = 0;
    if (!v.airborne) {
      pitch = Math.atan2((hs[0] + hs[1] - hs[2] - hs[3]) / 2, ch.front - ch.rear);
      roll = Math.atan2((hs[0] + hs[2] - hs[1] - hs[3]) / 2, 2 * ch.halfTrack);
    }
    const snap = dt <= 0 || !r.init;
    const h = Math.min(dt, 1 / 20);
    // Damped spring toward `target` (moving at `rate`), integrated implicitly so stiff
    // settings stay stable at 30 FPS: returns the new velocity.
    const spring = (x, vx, target, w, z, rate = 0) => (vx + h * (w * w * (target - x) + 2 * z * w * rate)) / (1 + h * 2 * z * w + h * h * w * w);
    if (snap) {
      r.pitch = pitch;
      r.roll = roll;
      r.vPitch = r.vRoll = 0;
    } else {
      r.vPitch = spring(r.pitch, r.vPitch, pitch, 22, 0.9);
      r.pitch += r.vPitch * h;
      r.vRoll = spring(r.roll, r.vRoll, roll, 22, 0.9);
      r.roll += r.vRoll * h;
    }
    // Floor lock: the lowest ride height at this pitch and roll that keeps every point on or
    // above its own ray hit (clearance included). The body's chassis plane is
    // y + a * sin(pitch) - l * sin(roll) at a point (a ahead, l right).
    const sp = Math.sin(r.pitch);
    const sr = Math.sin(r.roll);
    let floor = -Infinity;
    for (let i = 0; i < pts.length; i++) floor = Math.max(floor, hs[i] - pts[i].c - pts[i].a * sp + pts[i].l * sr);
    // Grounded, the car rests on that floor (following its rate, so a long downhill never
    // leaves it floating behind); in the air it follows the flight.
    const floorRate = snap ? 0 : THREE.MathUtils.clamp((floor - r.floor) / Math.max(dt, 1e-3), -25, 25);
    r.floor = floor;
    const target = v.airborne ? Math.max(v.pos.y, floor) : floor;
    const targetRate = v.airborne ? v.vy : floorRate;
    if (snap) {
      r.y = target;
      r.vy = targetRate;
      r.init = true;
    } else {
      r.vy = spring(r.y, r.vy, target, 30, 1, targetRate);
      r.y += r.vy * h;
    }
    if (r.y < floor) {
      r.y = floor;
      r.vy = Math.max(r.vy, floorRate);
    }
    // Each wheel reaches down to the road under it, within its travel.
    const travel = this.wheelRadius * 0.45;
    for (const w of this.wheels) {
      const p = pts[w.point];
      const gap = r.y + p.a * sp - p.l * sr - hs[w.point];
      w.wheel.position.y = w.rest - THREE.MathUtils.clamp(gap, 0, travel);
    }
    this.root.position.set(v.pos.x, r.y, v.pos.z);
    this.root.rotation.set(r.roll, v.heading, r.pitch);
  }

  update(v, dt, time) {
    if (this.chassis && v.groundAt) this.suspend(v, dt);
    else {
      this.root.position.copy(v.pos);
      this.root.rotation.set(0, v.heading, v.pitch);
    }

    // Body lean into the turn and squat under acceleration.
    const lat = v.airborne ? 0 : v.yawRate * Math.max(0, v.forward);
    const targetRoll = THREE.MathUtils.clamp(lat * 0.0028, -0.07, 0.07);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 6);
    const accel = (v.forward - this.lastForward) / Math.max(dt, 1e-3);
    this.lastForward = v.forward;
    this.squat += (THREE.MathUtils.clamp(accel * 0.0025, -0.04, 0.035) - this.squat) * Math.min(1, dt * 5);
    this.body.rotation.set(this.roll, 0, this.squat);

    const steerTarget = v.drifting ? -v.driftDir * 0.5 : this.steerInput ?? 0;
    this.steerVis += (steerTarget - this.steerVis) * Math.min(1, dt * 12);
    const spinRate = v.forward / this.wheelRadius;
    for (const w of this.wheels) {
      w.spin.rotation.z -= spinRate * dt;
      if (w.front) w.wheel.rotation.y = -this.steerVis * 0.45;
    }

    if (this.tail) this.tail.emissiveIntensity = v.braking ? 3.6 : LIGHTS.on ? 1.4 : 0.5;
    if (this.head) this.head.emissiveIntensity = LIGHTS.on ? 2.6 : 0;

    const on = v.tier > 0;
    for (const fl of this.flames) {
      fl.visible = on;
      if (on) {
        const flicker = 0.75 + Math.sin(time * 70 + fl.position.z * 9) * 0.15 + Math.random() * 0.2;
        const len = v.tier === 2 ? 1.9 : 1.2;
        fl.scale.set(len * flicker, v.tier === 2 ? 1.5 : 1, v.tier === 2 ? 1.5 : 1);
      }
    }
    if (on) {
      const c = this.fxColors;
      if (v.tier === 2) this.flameMat.color.copy(c?.a ?? ORANGE).lerp(c?.b ?? PURPLE, 0.5 + 0.5 * Math.sin(time * 18));
      else this.flameMat.color.copy(c?.blue ?? BLUE);
      this.flameMat.color.multiplyScalar(FLAME.hdr);
    }
  }
}

// Soft contact shadows under every car: one InstancedMesh of dark, blurred ovals on the
// road (multiplied in, never lit), so cars sit on the asphalt instead of floating over it
// where the sun's shadow map is coarse or the car is in shade. Airborne cars shrink and
// fade their shadow with height.
function contactTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.78)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class ContactShadows {
  constructor(capacity = 16) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: contactTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.MultiplyBlending,
      premultipliedAlpha: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      toneMapped: false,
    });
    // Multiply blending reads the colour; turn the texture's alpha into "how dark".
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n\tgl_FragColor = vec4( vec3( 1.0 - gl_FragColor.a ), 1.0 );');
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    this.mesh.name = 'contact-shadows';
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler(0, 0, 0, 'YZX');
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
  }

  // `racers` carry { visual, vehicle }; the shadow lies on the road under each car.
  sync(racers) {
    let n = 0;
    for (const r of racers) {
      const v = r.vehicle;
      const fp = r.visual?.footprint;
      if (!v || !fp || n >= this.mesh.instanceMatrix.count) continue;
      const lift = Math.max(0, v.pos.y - (v.groundY ?? v.pos.y));
      const k = Math.max(0, 1 - lift / 4);
      if (k <= 0) continue;
      this.e.set(0, v.heading, v.pitch);
      this.q.setFromEuler(this.e);
      this.p.set(v.pos.x, v.pos.y - lift + 0.03, v.pos.z);
      this.s.set(fp.length * 1.12 * (0.6 + 0.4 * k), 1, fp.width * 1.25 * (0.6 + 0.4 * k));
      this.mesh.setMatrixAt(n++, this.m.compose(this.p, this.q, this.s));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
