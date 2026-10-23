import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyFinish } from '../garage/carPaint.js';
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
// instanced draw for the field) and head / tail lights follow the weather's light level.

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
    if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    else if (!(g.attributes[name].array instanceof Float32Array) || g.attributes[name].normalized || g.attributes[name].isInterleavedBufferAttribute) g.setAttribute(name, toFloat(g.attributes[name]));
  }
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  g.applyMatrix4(matrix);
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
        paintVertices(g, describeMaterial(mat));
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
export function createRivalPaint(color, finish = 'gloss') {
  const f = FINISHES[finish] ?? FINISHES.gloss;
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: f.metalness,
    roughness: Math.max(0.12, f.roughness),
    clearcoat: Math.max(0.6, f.clearcoat),
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.35,
  });
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

export class CarFactory {
  // `template` is a car rig from loadCar(); the factory never mutates it.
  constructor(template) {
    this.template = template;
    template.group.updateMatrixWorld(true);
    this.paint = template.paintMaterial;
    this.flameTex = flameTexture();
    this.atlas = createVertexPbrMaterial({ envMapIntensity: 1.1 });
    // Length and width of the car on the ground, for its contact shadow.
    const size = new THREE.Box3().setFromObject(template.group).getSize(new THREE.Vector3());
    this.footprint = { length: size.x, width: size.z };
    // Left and right wheels are mirror images, so each side gets its own batch.
    const wheelsSrc = template.group.children.filter((c) => c.isGroup && c.userData.wheelIndex !== undefined);
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
        paintVertices(g, describeMaterial(mat));
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

  // Drops a car's wheels from the batches (its visual is being thrown away).
  release(visual) {
    for (const b of this.wheelBatches) b.slots = b.slots.filter((s) => !visual.wheels.some((w) => w.spin === s));
  }

  // Builds a car; the player keeps the garage clear-coat paint, rivals get a lighter clear-coat.
  build({ color, finish = 'gloss', player = false }) {
    const t = this.template.group;
    const own = new Map();
    const paint = player ? this.paint : createRivalPaint(color, finish);
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

    const root = new THREE.Group(); // position + yaw + pitch
    const body = new THREE.Group(); // roll / squat
    root.add(body);
    bake(t, t, isWheel, materialMap, this.atlas).forEach((mesh) => {
      // One shadow caster per car keeps the shadow pass cheap; the paint shell is the silhouette.
      mesh.castShadow = mesh.material === paint;
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
      body.add(wheel);
      return { wheel, spin, front: index < 2 };
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
    const visual = new CarVisual(root, body, wheels, tail, flames, flameMat, this.template.wheelRadius);
    visual.head = head;
    visual.footprint = this.footprint;
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
  }

  // Nitro trail colour (FX_COLORS entry) for this car's flames; null keeps the stock blue.
  setNitroFx(fx) {
    this.fxColors = fx ? { blue: new THREE.Color(fx.color), a: new THREE.Color(fx.pulse[0]), b: new THREE.Color(fx.pulse[1]) } : null;
  }

  update(v, dt, time) {
    this.root.position.copy(v.pos);
    this.root.rotation.set(0, v.heading, v.pitch);

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
