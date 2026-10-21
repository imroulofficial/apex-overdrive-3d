import * as THREE from 'three';
import { canvasTexture } from './noise.js';

// Track furniture that only some game modes use: start / finish arches for point-to-point
// sprints, Time Trial checkpoint gates, and the floating green time pylons. Built once per
// race and re-laid for each stage.

const GATE_STYLE = {
  start: { title: 'START', sub: 'APEX OVERDRIVE', glow: '#ffffff', checker: true },
  finish: { title: 'FINISH', sub: 'APEX OVERDRIVE', glow: '#ffffff', checker: true },
  checkpoint: { title: 'CHECKPOINT', sub: '+ TIME', glow: '#22e8ff', checker: false },
};
const PYLON_CAPACITY = 96;
const PYLON_GREEN = new THREE.Color(0x3dff7a);

function bannerTexture({ title, sub, glow, checker }) {
  return canvasTexture(THREE, 512, 64, (g, w, h) => {
    g.fillStyle = '#07090c';
    g.fillRect(0, 0, w, h);
    if (checker) {
      const sq = 16;
      for (const x0 of [0, w - 64]) for (let x = 0; x < 64; x += sq) for (let y = 0; y < h; y += sq) {
        g.fillStyle = (x / sq + y / sq) % 2 ? '#111' : '#f4f4f4';
        g.fillRect(x0 + x, y, sq, sq);
      }
    } else {
      g.fillStyle = glow;
      for (const x0 of [14, w - 50]) for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(x0 + k * 12, 16);
        g.lineTo(x0 + k * 12 + 10, 32);
        g.lineTo(x0 + k * 12, 48);
        g.lineTo(x0 + k * 12 + 5, 48);
        g.lineTo(x0 + k * 12 + 15, 32);
        g.lineTo(x0 + k * 12 + 5, 16);
        g.fill();
      }
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = glow;
    g.shadowBlur = 12;
    g.fillStyle = glow;
    g.font = 'italic 900 38px system-ui, sans-serif';
    g.fillText(title, w / 2, h / 2 - 4);
    g.shadowBlur = 0;
    g.globalAlpha = 0.7;
    g.font = '700 11px system-ui, sans-serif';
    g.fillText(sub, w / 2, h - 8);
  });
}

function pylonGeometry() {
  // A tall eight-sided marker with a white crown, standing on a thin base ring.
  const body = new THREE.CylinderGeometry(0.22, 0.34, 1.5, 8, 1).translate(0, 0.95, 0).toNonIndexed();
  const crown = new THREE.CylinderGeometry(0.26, 0.22, 0.22, 8, 1).translate(0, 1.81, 0).toNonIndexed();
  const ring = new THREE.TorusGeometry(0.5, 0.05, 4, 16).rotateX(Math.PI / 2).translate(0, 0.12, 0).toNonIndexed();
  const parts = [
    [body, 0x3dff7a],
    [crown, 0xf4fff6],
    [ring, 0x9dffbf],
  ];
  const c = new THREE.Color();
  const geos = parts.map(([g, color]) => {
    c.set(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    return g;
  });
  const merged = new THREE.BufferGeometry();
  const total = geos.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return merged;
}

export class ModeProps {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.root = new THREE.Group();
    this.root.name = 'mode-props';
    scene.add(this.root);

    const span = (track.fenceOffset + 1) * 2;
    const steel = [];
    for (const side of [-1, 1]) steel.push(new THREE.BoxGeometry(0.6, 7.2, 0.6).translate(0, 3.6, (side * span) / 2).toNonIndexed());
    steel.push(new THREE.BoxGeometry(0.7, 1.6, span + 0.6).translate(0, 6.6, 0).toNonIndexed());
    this.frameGeo = mergeSimple(steel);
    this.frameMat = new THREE.MeshLambertMaterial({ color: 0x2b2e35 });
    const boards = [];
    for (const side of [-1, 1]) {
      const b = new THREE.PlaneGeometry(span, span / 8).toNonIndexed();
      b.rotateY((side * Math.PI) / 2);
      b.translate(side * 0.37, 6.6, 0);
      boards.push(b);
    }
    this.bannerGeo = mergeSimple(boards, true);
    this.bannerMats = {};
    for (const [kind, style] of Object.entries(GATE_STYLE)) {
      this.bannerMats[kind] = new THREE.MeshBasicMaterial({ map: bannerTexture(style), toneMapped: false, color: 0xffffff });
    }
    this.gates = [];

    this.pylonMesh = new THREE.InstancedMesh(pylonGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), PYLON_CAPACITY);
    this.pylonMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pylonMesh.frustumCulled = false;
    this.pylonMesh.count = 0;
    this.root.add(this.pylonMesh);
    this.pylons = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._one = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
  }

  // gates: [{ s, kind: 'start' | 'finish' | 'checkpoint' }]
  setGates(list) {
    for (const g of this.gates) this.root.remove(g.group);
    const f = {};
    this.gates = list.map(({ s, kind }) => {
      const group = new THREE.Group();
      const steel = new THREE.Mesh(this.frameGeo, this.frameMat);
      steel.castShadow = true;
      const mat = this.bannerMats[kind].clone();
      const banner = new THREE.Mesh(this.bannerGeo, mat);
      group.add(steel, banner);
      this.track.frame(this.track.wrapS(s), f);
      group.position.set(f.x, this.track.roadY(this.track.wrapS(s)), f.z);
      group.rotation.y = Math.atan2(-f.tz, f.tx);
      this.root.add(group);
      return { s, kind, group, mat, passed: false };
    });
  }

  // A checkpoint the player drove through dims to show it is used.
  passGate(i) {
    const g = this.gates[i];
    if (!g || g.passed) return;
    g.passed = true;
    g.mat.color.setRGB(0.35, 0.45, 0.5);
  }

  // pylons: [{ s, d }] on the racing line.
  setPylons(list) {
    this.pylons = list.slice(0, PYLON_CAPACITY).map(({ s, d }, i) => {
      const s0 = this.track.wrapS(s);
      const f = this.track.frame(s0, {});
      return {
        s: s0,
        d,
        slot: i,
        phase: i * 0.7,
        pos: new THREE.Vector3(f.x + f.rx * d, this.track.heightAt(s0, d), f.z + f.rz * d),
        taken: false,
      };
    });
    this.pylonMesh.count = this.pylons.length;
    this.update(0, 0);
  }

  clear() {
    this.setGates([]);
    this.setPylons([]);
  }

  resetPylons() {
    for (const p of this.pylons) p.taken = false;
    for (const g of this.gates) {
      g.passed = false;
      g.mat.color.setRGB(1, 1, 1);
    }
  }

  // Returns the pylon the car just touched, or null.
  collidePylon(vehicle) {
    const pr = vehicle.proj;
    const L = this.track.length;
    for (const p of this.pylons) {
      if (p.taken) continue;
      let ds = Math.abs(p.s - pr.s);
      if (ds > L / 2) ds = L - ds;
      if (ds > 2.4 || Math.abs(p.d - pr.d) > 1.7 || vehicle.pos.y > p.pos.y + 3) continue;
      p.taken = true;
      return p;
    }
    return null;
  }

  update(dt, time) {
    if (!this.pylons.length) return;
    for (const p of this.pylons) {
      if (p.taken) this._m.makeScale(0, 0, 0);
      else {
        this._q.setFromAxisAngle(this._up, time * 1.6 + p.phase);
        this._v.copy(p.pos);
        this._v.y += 0.25 + Math.sin(time * 3 + p.phase) * 0.18;
        this._m.compose(this._v, this._q, this._one);
      }
      this.pylonMesh.setMatrixAt(p.slot, this._m);
    }
    this.pylonMesh.instanceMatrix.needsUpdate = true;
  }

  get pylonColor() {
    return PYLON_GREEN;
  }
}

// Concatenates non-indexed geometries (position, normal, and uv when asked).
function mergeSimple(geos, withUv = false) {
  const names = withUv ? ['position', 'normal', 'uv'] : ['position', 'normal'];
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = geos[0].attributes[name].itemSize;
    const total = geos.reduce((n, g) => n + g.attributes[name].count, 0);
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of geos) {
      arr.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

// Pylons along the optimal line: one every `spacing` metres, swinging to the inside of each
// corner (where the curvature ahead points) and back to the middle on the straights. Ramps and
// gates keep a clear run-up.
export function racingLinePylons(track, { startS, distance, spacing, avoid = [] }) {
  const out = [];
  const limit = track.halfWidth - 2.2;
  for (let along = spacing * 0.7; along < distance - 40; along += spacing) {
    const s0 = startS + along;
    if (track.ramps.some((r) => {
      const ds = track.delta(r.s0, track.wrapS(s0));
      return ds > -45 && ds < 30;
    })) continue;
    if (avoid.some((a) => Math.abs(track.delta(track.wrapS(a), track.wrapS(s0))) < 18)) continue;
    let kSum = 0;
    for (let ds = -10; ds <= 40; ds += 10) kSum += track.curvatureAt(track.wrapS(s0 + ds));
    const kAvg = kSum / 6;
    const d = Math.sign(kAvg) * Math.min(limit, Math.abs(kAvg) * 650);
    out.push({ s: track.wrapS(s0), d });
  }
  return out;
}
