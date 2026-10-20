import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';

// Smashable roadside props (traffic cones and wooden barricades). They are instanced for a
// single draw call per type; once hit they become simple rigid bodies that tumble, bounce on
// the road and come to rest, and can be kicked again.

const GRAVITY = 22;

function paint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function coneGeometry() {
  const body = new THREE.ConeGeometry(0.24, 0.72, 14, 4, true);
  body.translate(0, 0.42, 0);
  const pos = body.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const orange = new THREE.Color(0xff5a12);
  const white = new THREE.Color(0xf4f4f4);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    (y > 0.4 && y < 0.62 ? white : orange).toArray(col, i * 3);
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  body.deleteAttribute('uv');
  const base = paint(new THREE.BoxGeometry(0.56, 0.06, 0.56).translate(0, 0.03, 0), 0x1b1b1d);
  return mergeGeometries([body, base]);
}

function barricadeGeometry() {
  const parts = [];
  const wood = 0x9a6a3c;
  for (const x of [-1.15, 1.15]) parts.push(paint(new THREE.BoxGeometry(0.14, 1.2, 0.14).translate(x, 0.6, 0), 0x6d4826));
  for (const y of [0.35, 0.7]) parts.push(paint(new THREE.BoxGeometry(2.5, 0.22, 0.06).translate(0, y, 0), wood));
  // Red/white warning board on top.
  for (let k = 0; k < 6; k++) {
    parts.push(paint(new THREE.BoxGeometry(2.5 / 6, 0.26, 0.07).translate(-1.25 + (k + 0.5) * (2.5 / 6), 1.02, 0), k % 2 ? 0xf4f4f4 : 0xd81e2c));
  }
  const brace = paint(new THREE.BoxGeometry(2.4, 0.12, 0.05), 0x7d5530);
  brace.rotateZ(0.32);
  brace.translate(0, 0.55, -0.05);
  parts.push(brace);
  return mergeGeometries(parts);
}

export class SmashProps {
  constructor(track, def, scene) {
    this.track = track;
    this.items = [];
    const rand = mulberry32(99);
    const hw = track.halfWidth;

    const addCone = (s, d) => this.items.push({ type: 'cone', s: track.wrapS(s), d, radius: 0.32 });
    const addPanel = (s, d) => this.items.push({ type: 'panel', s: track.wrapS(s), d, radius: 0.3, half: 1.2 });

    for (const f of def.slaloms ?? []) {
      const s0 = f * track.length;
      for (let k = 0; k < 9; k++) addCone(s0 + k * 7, (k % 2 ? 1 : -1) * 3.2 + (rand() - 0.5) * 0.4);
      for (let k = 0; k < 4; k++) {
        addCone(s0 - 8 + k * 1.5, -hw + 0.9);
        addCone(s0 - 8 + k * 1.5, hw - 0.9);
      }
    }
    for (const f of def.barricades ?? []) {
      const s0 = f * track.length;
      const k = track.curvatureAt(s0 + 20);
      const side = k === 0 ? (rand() < 0.5 ? -1 : 1) : -Math.sign(k); // corner outside
      for (let j = 0; j < 5; j++) addPanel(s0 + j * 2.6, side * (hw - 0.4));
      for (let j = 0; j < 3; j++) addCone(s0 - 4 - j * 2, side * (hw - 1.2 - j * 0.9));
    }
    // Cones flanking each ramp entrance.
    for (const r of track.ramps) {
      addCone(r.s0 - 1.5, r.from - 0.7);
      addCone(r.s0 - 1.5, r.to + 0.7);
    }

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const cones = this.items.filter((p) => p.type === 'cone');
    const panels = this.items.filter((p) => p.type === 'panel');
    this.coneMesh = new THREE.InstancedMesh(coneGeometry(), mat, cones.length);
    this.panelMesh = new THREE.InstancedMesh(barricadeGeometry(), mat, panels.length);
    for (const mesh of [this.coneMesh, this.panelMesh]) {
      mesh.castShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    cones.forEach((p, i) => ((p.mesh = this.coneMesh), (p.slot = i)));
    panels.forEach((p, i) => ((p.mesh = this.panelMesh), (p.slot = i)));

    const f = {};
    for (const p of this.items) {
      track.frame(p.s, f);
      p.home = new THREE.Vector3(f.x + f.rx * p.d, track.heightAt(p.s, p.d), f.z + f.rz * p.d);
      p.homeQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-f.tz, f.tx));
      p.axis = new THREE.Vector2(f.tx, f.tz);
      p.pos = new THREE.Vector3();
      p.vel = new THREE.Vector3();
      p.quat = new THREE.Quaternion();
      p.spin = new THREE.Vector3();
      p.hint = f.i;
      p.proj = {};
    }
    this._m = new THREE.Matrix4();
    this._one = new THREE.Vector3(1, 1, 1);
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this.reset();
  }

  reset() {
    for (const p of this.items) {
      p.state = 'idle';
      p.pos.copy(p.home);
      p.quat.copy(p.homeQuat);
      p.vel.set(0, 0, 0);
      p.spin.set(0, 0, 0);
      p.cool = 0;
      p.hit = false;
      this.write(p);
    }
    this.coneMesh.instanceMatrix.needsUpdate = true;
    this.panelMesh.instanceMatrix.needsUpdate = true;
  }

  write(p) {
    this._m.compose(p.pos, p.quat, this._one);
    p.mesh.setMatrixAt(p.slot, this._m);
  }

  // Returns the props this car hit this step (each prop at most once per hit).
  collide(car, hits) {
    hits.length = 0;
    const L = this.track.length;
    for (const p of this.items) {
      if (p.cool > 0) continue;
      let ds = Math.abs(p.s - car.proj.s);
      if (ds > L / 2) ds = L - ds;
      if (p.state === 'idle' && ds > 8) continue;
      if (p.state !== 'idle' && p.pos.distanceToSquared(car.pos) > 64) continue;
      if (p.pos.y > car.pos.y + 1.6 || p.pos.y < car.pos.y - 1.5) continue;
      // Car as two circles along its heading.
      let hit = false;
      for (const off of [1.2, -1.2]) {
        const cx = car.pos.x + Math.cos(car.heading) * off;
        const cz = car.pos.z - Math.sin(car.heading) * off;
        let dx = p.pos.x - cx;
        let dz = p.pos.z - cz;
        if (p.type === 'panel' && p.state === 'idle') {
          const t = Math.max(-p.half, Math.min(p.half, dx * p.axis.x + dz * p.axis.y));
          dx -= p.axis.x * t;
          dz -= p.axis.y * t;
        }
        if (dx * dx + dz * dz < (1.0 + p.radius) ** 2) hit = true;
      }
      if (!hit) continue;
      this.launch(p, car);
      hits.push(p);
    }
    return hits;
  }

  launch(p, car) {
    const first = !p.hit;
    p.hit = true;
    p.state = 'flying';
    p.cool = 0.25;
    const vx = car.vel.x;
    const vz = car.vel.y;
    const speed = Math.hypot(vx, vz);
    let ox = p.pos.x - car.pos.x;
    let oz = p.pos.z - car.pos.z;
    const ol = Math.hypot(ox, oz) || 1;
    ox /= ol;
    oz /= ol;
    const k = p.type === 'cone' ? 1.15 : 0.85;
    const r = Math.random;
    p.vel.set(vx * k + ox * 4, (p.type === 'cone' ? 4 : 2.5) + speed * (p.type === 'cone' ? 0.12 : 0.07) + r() * 2, vz * k + oz * 4);
    const spin = p.type === 'cone' ? 12 : 5;
    p.spin.set((r() - 0.5) * spin, (r() - 0.5) * spin, (r() - 0.5) * spin);
    p.first = first;
  }

  groundAt(p) {
    const pr = this.track.project(p.pos.x, p.pos.z, p.hint, p.proj);
    p.hint = pr.i;
    const edge = this.track.halfWidth + this.track.shoulder;
    const ad = Math.abs(pr.d);
    if (ad <= edge) return pr.y;
    return pr.roadY - Math.min(4.2, (ad - edge) * 0.6);
  }

  update(dt) {
    let dirty = false;
    for (const p of this.items) {
      if (p.cool > 0) p.cool -= dt;
      if (p.state !== 'flying') continue;
      dirty = true;
      p.vel.y -= GRAVITY * dt;
      p.pos.addScaledVector(p.vel, dt);
      const w = p.spin.length();
      if (w > 1e-3) {
        this._v.copy(p.spin).divideScalar(w);
        this._q.setFromAxisAngle(this._v, w * dt);
        p.quat.premultiply(this._q);
      }
      const ground = this.groundAt(p) + 0.05;
      if (p.pos.y < ground) {
        p.pos.y = ground;
        p.vel.y = Math.abs(p.vel.y) * 0.3;
        p.vel.x *= 0.62;
        p.vel.z *= 0.62;
        p.spin.multiplyScalar(0.6);
        if (p.vel.lengthSq() < 1.5) {
          p.state = 'rest';
          p.vel.set(0, 0, 0);
        }
      }
      this.write(p);
    }
    if (dirty) {
      this.coneMesh.instanceMatrix.needsUpdate = true;
      this.panelMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
