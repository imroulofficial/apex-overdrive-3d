import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCar, WHEEL_RADIUS } from '../garage/carModel.js';
import { applyFinish } from '../garage/carPaint.js';

// Race-ready cars built from the garage coupe. The showroom model has dozens of meshes and
// real light sources; on track six of them would cost hundreds of draw calls and a heavy
// light loop in every shader. Here the body is baked into one mesh per material, each wheel
// into two spinning meshes, and lights are replaced by emissive lenses.

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

function normalize(geo, matrix) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  g.applyMatrix4(matrix);
  return g;
}

// Collect meshes under `root` (excluding `skip` subtrees) into one merged mesh per material.
function bake(root, relativeTo, skip = () => false, materialMap = (m) => m) {
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
      if (!buckets.has(target)) buckets.set(target, []);
      buckets.get(target).push(normalize(geo, m));
    }
  });
  return [...buckets].map(([mat, geos]) => {
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = true;
    return mesh;
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
  constructor(paintColor, finish) {
    this.template = createCar({ paintColor, finish, detail: 0.6 });
    const t = this.template.group;
    t.updateMatrixWorld(true);
    this.paint = this.template.paintMaterial;
    this.flameTex = flameTexture();
  }

  setPlayerPaint(color, finish) {
    applyFinish(this.paint, color, finish);
  }

  // Builds a car; the player keeps the garage clear-coat paint, rivals get a cheaper standard paint.
  build({ color, finish = 'gloss', player = false }) {
    const t = this.template.group;
    const own = new Map();
    const paint = player
      ? this.paint
      : new THREE.MeshStandardMaterial({
          color,
          metalness: finish === 'metallic' || finish === 'pearl' ? 0.55 : finish === 'chrome' ? 0.95 : 0.1,
          roughness: finish === 'matte' ? 0.6 : 0.25,
          envMapIntensity: 1.2,
        });
    const materialMap = (mat) => {
      if (mat === this.paint) return paint;
      if (mat.name === 'skip') return null;
      // Tail lenses are per car so brake lights can glow independently.
      if (mat.emissive && mat.emissive.r > 0.9 && mat.emissive.g < 0.2) {
        if (!own.has(mat)) own.set(mat, mat.clone());
        return own.get(mat);
      }
      return mat;
    };
    const wheelsSrc = t.children.filter((c) => c.isGroup && c.userData.wheelIndex !== undefined);
    const isWheel = (o) => wheelsSrc.includes(o);

    const root = new THREE.Group(); // position + yaw + pitch
    const body = new THREE.Group(); // roll / squat
    root.add(body);
    bake(t, t, isWheel, materialMap).forEach((mesh) => {
      // One shadow caster per car keeps the shadow pass cheap; the paint shell is the silhouette.
      mesh.castShadow = mesh.material === paint;
      body.add(mesh);
    });
    const tail = [...own.values()][0];

    const wheels = wheelsSrc.map((src, index) => {
      const wheel = new THREE.Group();
      wheel.position.copy(src.position);
      const spin = new THREE.Group();
      wheel.add(spin);
      // Tyre + one metal mesh for rim, spokes, lip, hub and disc (the caliper is dropped).
      const mats = new Map();
      src.traverse((o) => {
        if (!o.isMesh) return;
        const isTire = o.material.roughness > 0.85;
        if (!isTire && o.material.color.r > 0.8 && o.material.color.g < 0.3) return; // caliper
        const key = isTire ? 'tire' : 'metal';
        if (!mats.has(key)) mats.set(key, { mat: isTire ? o.material : null, geos: [] });
        const rel = new THREE.Matrix4().copy(src.matrixWorld).invert().multiply(o.matrixWorld);
        mats.get(key).geos.push(normalize(o.geometry, rel));
        if (!isTire && !mats.get(key).mat) mats.get(key).mat = o.material;
      });
      for (const { mat, geos } of mats.values()) {
        spin.add(new THREE.Mesh(mergeGeometries(geos), mat));
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
    for (const z of [-0.42, 0.42]) {
      const fl = new THREE.Mesh(flameGeo, flameMat);
      fl.position.set(-2.28, 0.32, z);
      fl.visible = false;
      fl.renderOrder = 5;
      body.add(fl);
      flames.push(fl);
    }
    return new CarVisual(root, body, wheels, tail, flames, flameMat);
  }
}

const BLUE = new THREE.Color(0x3aa8ff);
const ORANGE = new THREE.Color(0xff7a1a);
const PURPLE = new THREE.Color(0xb44dff);

export class CarVisual {
  constructor(root, body, wheels, tail, flames, flameMat) {
    this.root = root;
    this.body = body;
    this.wheels = wheels;
    this.tail = tail;
    this.flames = flames;
    this.flameMat = flameMat;
    this.roll = 0;
    this.squat = 0;
    this.steerVis = 0;
    this.lastForward = 0;
    root.rotation.order = 'YZX';
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
    const spinRate = v.forward / WHEEL_RADIUS;
    for (const w of this.wheels) {
      w.spin.rotation.z -= spinRate * dt;
      if (w.front) w.wheel.rotation.y = -this.steerVis * 0.45;
    }

    if (this.tail) this.tail.emissiveIntensity = v.braking ? 3.6 : 0.5;

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
      if (v.tier === 2) this.flameMat.color.copy(ORANGE).lerp(PURPLE, 0.5 + 0.5 * Math.sin(time * 18));
      else this.flameMat.color.copy(BLUE);
    }
  }
}
