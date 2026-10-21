import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, mulberry32 } from './noise.js';

// Smashable roadside props. Traffic cones and wooden barricades are instanced for a single
// draw call per type; once hit they become simple rigid bodies that tumble, bounce on the road
// and come to rest, and can be kicked again. Fruit stalls and neon signposts on the shoulder
// shatter instead: the prop disappears and bursts into pooled debris (planks, fruit, glowing
// glass). None of them slow the car down.

const GRAVITY = 22;
const NEON_COLORS = [0xff2bd6, 0x22e8ff, 0xb6ff3a, 0xffb020];
const FRUIT_COLORS = [0xff8a1c, 0xe8261f, 0xffd52e, 0x5fbf2a, 0xff8a1c, 0xb3123d];
const WOOD_COLORS = [0x9a6a3c, 0x7d5530, 0xb07d48];
const AWNING_COLORS = [0xd81e2c, 0xf4f4f4];

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

// Fruit stall, facing the road along +z: trestle table, three crates heaped with fruit and a
// striped awning on two poles.
function stallGeometry() {
  const parts = [];
  const rand = mulberry32(5);
  parts.push(paint(new THREE.BoxGeometry(2.6, 0.1, 1.1).translate(0, 0.85, 0), 0xa87442));
  for (const x of [-1.15, 1.15]) for (const z of [-0.45, 0.45]) parts.push(paint(new THREE.BoxGeometry(0.1, 0.85, 0.1).translate(x, 0.42, z), 0x6d4826));
  for (const x of [-0.85, 0, 0.85]) {
    parts.push(paint(new THREE.BoxGeometry(0.75, 0.28, 0.55).translate(x, 1.04, 0.1), 0x7d5530));
    const fruit = FRUIT_COLORS[Math.floor(rand() * FRUIT_COLORS.length)];
    for (let k = 0; k < 7; k++) {
      const r = 0.1 + rand() * 0.04;
      parts.push(paint(new THREE.IcosahedronGeometry(r, 0).translate(x + (rand() - 0.5) * 0.55, 1.2 + rand() * 0.1, 0.1 + (rand() - 0.5) * 0.35), fruit));
    }
  }
  for (const x of [-1.25, 1.25]) parts.push(paint(new THREE.BoxGeometry(0.07, 2.3, 0.07).translate(x, 1.15, -0.55), 0x3a3d44));
  // Awning: alternating red/white strips sloping down toward the road.
  for (let k = 0; k < 8; k++) {
    const strip = paint(new THREE.BoxGeometry(2.9 / 8, 0.04, 1.5), AWNING_COLORS[k % 2]);
    strip.rotateX(0.32);
    strip.translate(-1.45 + (k + 0.5) * (2.9 / 8), 2.05, 0.05);
    parts.push(strip);
  }
  // The fruit (icosahedra) are not indexed, so drop the index everywhere before merging.
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

// Neon signpost: a steel pole and a dark box frame; the glowing panel is a separate mesh.
function neonPoleGeometry() {
  const parts = [
    paint(new THREE.CylinderGeometry(0.09, 0.12, 3.0, 8).translate(0, 1.5, 0), 0x2b2e35),
    paint(new THREE.BoxGeometry(2.3, 1.15, 0.16).translate(0, 3.45, 0), 0x15161b),
    paint(new THREE.BoxGeometry(0.5, 0.08, 0.5).translate(0, 0.04, 0), 0x2b2e35),
  ];
  return mergeGeometries(parts);
}

function neonGlowGeometry() {
  const front = new THREE.PlaneGeometry(2.1, 0.95).translate(0, 3.45, 0.085);
  const back = new THREE.PlaneGeometry(2.1, 0.95).rotateY(Math.PI).translate(0, 3.45, -0.085);
  return mergeGeometries([front, back]);
}

// White neon tubing on black; each sign tints it with its instance colour.
function neonTexture() {
  return canvasTexture(THREE, 256, 116, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff';
    g.shadowColor = '#fff';
    g.shadowBlur = 10;
    g.lineWidth = 4;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.font = 'italic 900 58px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3;
    g.strokeText('DRIFT', w / 2, h / 2 + 2);
    g.globalAlpha = 0.85;
    g.fillStyle = '#fff';
    g.fillText('DRIFT', w / 2, h / 2 + 2);
  });
}

// Pool of short-lived instanced fragments (planks, fruit, glass). The oldest piece is reused
// when the pool is full.
class Debris {
  constructor(scene, geometry, material, count) {
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = material.type !== 'MeshBasicMaterial';
    this.pieces = Array.from({ length: count }, () => ({
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      spin: new THREE.Vector3(),
      life: 0,
      size: 1,
      hint: -1,
      proj: {},
    }));
    this.next = 0;
    this.live = 0;
    this._c = new THREE.Color();
    this._m = new THREE.Matrix4();
    this._s = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, this._c.set(0xffffff));
    this.clear();
    scene.add(this.mesh);
  }

  clear() {
    this._m.makeScale(0, 0, 0);
    for (let i = 0; i < this.pieces.length; i++) {
      this.pieces[i].life = 0;
      this.mesh.setMatrixAt(i, this._m);
    }
    this.live = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  spawn(pos, vel, color, size, hint) {
    const i = this.next;
    this.next = (this.next + 1) % this.pieces.length;
    const p = this.pieces[i];
    const r = Math.random;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.quat.set(r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    p.spin.set((r() - 0.5) * 16, (r() - 0.5) * 16, (r() - 0.5) * 16);
    p.life = 2.6 + r() * 1.2;
    p.size = size;
    p.hint = hint;
    this.mesh.setColorAt(i, this._c.set(color));
    this.mesh.instanceColor.needsUpdate = true;
    this.live = Math.min(this.pieces.length, this.live + 1);
  }

  update(dt, groundAt) {
    if (!this.live) return;
    let live = 0;
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.mesh.setMatrixAt(i, this._m.makeScale(0, 0, 0));
        continue;
      }
      live += 1;
      p.vel.y -= GRAVITY * dt;
      p.pos.addScaledVector(p.vel, dt);
      const w = p.spin.length();
      if (w > 1e-3) {
        this._v.copy(p.spin).divideScalar(w);
        this._q.setFromAxisAngle(this._v, w * dt);
        p.quat.premultiply(this._q);
      }
      const ground = groundAt(p) + 0.04;
      if (p.pos.y < ground) {
        p.pos.y = ground;
        p.vel.y = Math.abs(p.vel.y) * 0.35;
        p.vel.x *= 0.55;
        p.vel.z *= 0.55;
        p.spin.multiplyScalar(0.5);
      }
      const k = p.size * Math.min(1, p.life / 0.5); // shrink away at the end
      this._m.compose(p.pos, p.quat, this._s.set(k, k, k));
      this.mesh.setMatrixAt(i, this._m);
    }
    this.live = live;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class SmashProps {
  constructor(track, def, scene) {
    this.track = track;
    this.items = [];
    const rand = mulberry32(99);
    const hw = track.halfWidth;

    const addCone = (s, d) => this.items.push({ type: 'cone', s: track.wrapS(s), d, radius: 0.32 });
    const addPanel = (s, d) => this.items.push({ type: 'panel', s: track.wrapS(s), d, radius: 0.3, half: 1.2 });
    const addStall = (s, d) => this.items.push({ type: 'stall', s: track.wrapS(s), d, radius: 0.6, half: 1.3, breaks: true });
    const addNeon = (s, d) => this.items.push({ type: 'neon', s: track.wrapS(s), d, radius: 0.35, breaks: true });

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
    // Fruit stalls on the gravel shoulder of the straights, and neon signposts on the outside
    // of corner entries: clip the shoulder to smash them.
    for (const f of def.fruitStalls ?? []) addStall(f * track.length, (rand() < 0.5 ? -1 : 1) * (hw + 2.0));
    for (const f of def.neonSigns ?? []) {
      const s0 = f * track.length;
      const k = track.curvatureAt(s0 + 25);
      addNeon(s0, (k === 0 ? 1 : -Math.sign(k)) * (hw + 1.2));
    }

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const glow = new THREE.MeshBasicMaterial({ map: neonTexture(), toneMapped: false });
    const instanced = (geo, material, list, shadow = true) => {
      const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
      mesh.count = list.length;
      mesh.castShadow = shadow;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
      list.forEach((p, i) => ((p.meshes = p.meshes ?? []).push(mesh), (p.slot = i)));
      return mesh;
    };
    const byType = (t) => this.items.filter((p) => p.type === t);
    const neons = byType('neon');
    this.meshes = [
      instanced(coneGeometry(), mat, byType('cone')),
      instanced(barricadeGeometry(), mat, byType('panel')),
      instanced(stallGeometry(), mat, byType('stall')),
      instanced(neonPoleGeometry(), mat, neons),
    ];
    const glowMesh = instanced(neonGlowGeometry(), glow, neons, false);
    this.meshes.push(glowMesh);
    neons.forEach((p, i) => {
      p.glow = new THREE.Color(NEON_COLORS[i % NEON_COLORS.length]);
      glowMesh.setColorAt(i, p.glow);
    });

    this.planks = new Debris(scene, paint(new THREE.BoxGeometry(0.5, 0.06, 0.16), 0xffffff), mat, 120);
    this.fruit = new Debris(scene, paint(new THREE.IcosahedronGeometry(0.13, 0), 0xffffff), mat, 140);
    this.shards = new Debris(scene, new THREE.TetrahedronGeometry(0.13), new THREE.MeshBasicMaterial({ toneMapped: false }), 90);

    const f = {};
    const up = new THREE.Vector3(0, 1, 0);
    const bx = new THREE.Vector3();
    const bz = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    for (const p of this.items) {
      track.frame(p.s, f);
      p.home = new THREE.Vector3(f.x + f.rx * p.d, track.heightAt(p.s, p.d), f.z + f.rz * p.d);
      if (p.breaks) {
        // Face the road: local +z points back toward the centre line.
        const side = Math.sign(p.d) || 1;
        bx.set(f.tx, 0, f.tz).multiplyScalar(side);
        bz.set(f.rx, 0, f.rz).multiplyScalar(-side);
        p.homeQuat = new THREE.Quaternion().setFromRotationMatrix(basis.makeBasis(bx, up, bz));
      } else {
        p.homeQuat = new THREE.Quaternion().setFromAxisAngle(up, Math.atan2(-f.tz, f.tx));
      }
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
    this._zero = new THREE.Vector3(0, 0, 0);
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
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
    this.planks.clear();
    this.fruit.clear();
    this.shards.clear();
  }

  write(p) {
    this._m.compose(p.pos, p.quat, p.state === 'broken' ? this._zero : this._one);
    for (const mesh of p.meshes) mesh.setMatrixAt(p.slot, this._m);
  }

  // Returns the props this car hit this step (each prop at most once per hit).
  collide(car, hits) {
    hits.length = 0;
    const L = this.track.length;
    for (const p of this.items) {
      if (p.cool > 0 || p.state === 'broken') continue;
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
        if (p.half && p.state === 'idle') {
          const t = Math.max(-p.half, Math.min(p.half, dx * p.axis.x + dz * p.axis.y));
          dx -= p.axis.x * t;
          dz -= p.axis.y * t;
        }
        if (dx * dx + dz * dz < (1.0 + p.radius) ** 2) hit = true;
      }
      if (!hit) continue;
      if (p.breaks) this.shatter(p, car);
      else this.launch(p, car);
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

  // The prop vanishes and bursts into debris thrown along with the car.
  shatter(p, car) {
    p.first = true;
    p.hit = true;
    p.state = 'broken';
    this.write(p);
    for (const m of p.meshes) m.instanceMatrix.needsUpdate = true;
    const r = Math.random;
    const v = this._v;
    const at = this._at || (this._at = new THREE.Vector3());
    const hint = this.track.project(p.home.x, p.home.z, -1, {}).i;
    const burst = (pool, n, height, spread, colorAt, size = 1) => {
      for (let k = 0; k < n; k++) {
        at.copy(p.home);
        at.y += height * (0.3 + r() * 0.8);
        at.x += (r() - 0.5) * spread;
        at.z += (r() - 0.5) * spread;
        v.set(car.vel.x * (0.5 + r() * 0.6) + (r() - 0.5) * 9, 3 + r() * 6, car.vel.y * (0.5 + r() * 0.6) + (r() - 0.5) * 9);
        pool.spawn(at, v, colorAt(k), size * (0.7 + r() * 0.6), hint);
      }
    };
    if (p.type === 'stall') {
      burst(this.planks, 12, 1.4, 2.4, (k) => (k < 5 ? AWNING_COLORS[k % 2] : WOOD_COLORS[k % 3]), 1.2);
      burst(this.fruit, 22, 1.2, 2.0, (k) => FRUIT_COLORS[k % FRUIT_COLORS.length]);
    } else {
      burst(this.shards, 18, 3.6, 1.8, () => p.glow);
      burst(this.planks, 4, 3.4, 1.4, () => 0x15161b, 1.3);
    }
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
    if (dirty) for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
    const ground = this._ground || (this._ground = (piece) => this.groundAt(piece));
    this.planks.update(dt, ground);
    this.fruit.update(dt, ground);
    this.shards.update(dt, ground);
  }
}
