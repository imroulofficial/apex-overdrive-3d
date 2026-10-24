import * as THREE from 'three';
import { CHAPTERS, STAGES } from '../data/career.js';
import { buildWorld, chapterCenterX, MOODS } from './mapWorld.js';

// The campaign world map: renders the 3D diorama (map/mapWorld.js) with the shared renderer,
// colours the 60 stage pedestals by state, marks the current stage with a beacon, and pans
// with a drag (or the mouse wheel) across the three chapters. The HTML layer on top
// (ui/mapHud.js) places its node buttons with project().

export const MODE_COLORS = { Classic: '#ff2a3a', TimeTrial: '#3dff7a', DriftTouge: '#ffd34d', Elimination: '#ff7a1a', BossDuel: '#c062ff' };
const LOCKED = new THREE.Color('#5d6472');
const TAP_SLOP_PX = 8;
const CAM_OFFSET = new THREE.Vector3(0, 44, 36);
const Z_RANGE = 12;

const lerp = (a, b, k) => a + (b - a) * k;

export class WorldMap {
  constructor(renderer, { onFps } = {}) {
    this.renderer = renderer;
    this.onFps = onFps;
    this.canvas = renderer.domElement;
    this.built = false;
    this.running = false;
    this.listeners = new Set();
    this.target = new THREE.Vector3();
    this.goal = new THREE.Vector3();
    this.velocity = 0;
    this.dragging = null;
    this.time = 0;
    this.frame = this.frame.bind(this);
    this.resize = this.resize.bind(this);
  }

  // Builds the diorama once (procedural, a few hundred ms on a phone).
  build() {
    if (this.built) return;
    this.built = true;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color();
    scene.fog = new THREE.Fog(0xffffff, 70, 190);
    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 400);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.3);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.position.set(-40, 80, 50);
    scene.add(this.hemi, this.sun, this.sun.target);

    const world = buildWorld();
    this.world = world;
    this.layout = world.layout;
    scene.add(world.mesh, world.water);

    // Stage pedestals: one instanced hexagon per stage, coloured by mode and state.
    const pedestal = new THREE.CylinderGeometry(1.5, 1.8, 0.7, 6).translate(0, 0.35, 0);
    this.pedestals = new THREE.InstancedMesh(pedestal, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.25 }), STAGES.length);
    // Gold rims under 3-star stages.
    const rim = new THREE.TorusGeometry(1.95, 0.16, 4, 6).rotateX(Math.PI / 2).rotateY(Math.PI / 6).translate(0, 0.12, 0);
    this.rims = new THREE.InstancedMesh(rim, new THREE.MeshStandardMaterial({ color: '#ffd34d', emissive: '#ffb000', emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.8 }), STAGES.length);
    const m = new THREE.Matrix4();
    STAGES.forEach((s, i) => {
      const p = this.layout[i];
      const k = s.gameMode === 'BossDuel' ? 1.45 : 1;
      m.compose(p, new THREE.Quaternion(), new THREE.Vector3(k, k, k));
      this.pedestals.setMatrixAt(i, m);
      this.rims.setMatrixAt(i, m);
      this.pedestals.setColorAt(i, LOCKED);
    });
    scene.add(this.pedestals, this.rims);

    // "You are here": a light beam and a spinning ring over the current stage.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.4, 14, 16, 1, true).translate(0, 7, 0),
      new THREE.MeshBasicMaterial({ color: '#ff5a3a', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
    );
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.4, 0.14, 6, 32).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false })
    );
    ring.position.y = 0.9;
    this.beacon = new THREE.Group();
    this.beacon.add(beam, ring);
    this.beaconRing = ring;
    scene.add(this.beacon);

    this.bindInput();
  }

  // ---- State ----

  // `view(stage)` -> { open, locked, stars (0-3), current } for every stage.
  refresh(view) {
    if (!this.built) return;
    const c = new THREE.Color();
    const m = new THREE.Matrix4();
    STAGES.forEach((s, i) => {
      const v = view(s);
      c.set(MODE_COLORS[s.gameMode]);
      if (v.locked) c.copy(LOCKED);
      this.pedestals.setColorAt(i, c);
      const k = v.stars === 3 ? (s.gameMode === 'BossDuel' ? 1.45 : 1) : 0;
      m.compose(this.layout[i], new THREE.Quaternion(), new THREE.Vector3(k, k, k));
      this.rims.setMatrixAt(i, m);
      if (v.current) this.beacon.position.copy(this.layout[i]);
    });
    this.pedestals.instanceColor.needsUpdate = true;
    this.rims.instanceMatrix.needsUpdate = true;
  }

  // ---- Camera ----

  get bounds() {
    return this.world.bounds;
  }

  focus(pos, instant = false) {
    this.goal.set(THREE.MathUtils.clamp(pos.x, this.bounds.minX, this.bounds.maxX), 0, THREE.MathUtils.clamp(pos.z * 0.6, -Z_RANGE, Z_RANGE));
    this.velocity = 0;
    if (instant) this.target.copy(this.goal);
  }

  focusStage(stage, instant = false) {
    this.build();
    this.focus(this.layout[stage.index], instant);
  }

  focusChapter(chapterId, instant = false) {
    this.build();
    this.focus(new THREE.Vector3(chapterCenterX(chapterId), 0, 0), instant);
  }

  // The chapter whose island is nearest the middle of the view.
  get chapterInView() {
    let best = CHAPTERS[0];
    let d = Infinity;
    for (const c of CHAPTERS) {
      const dx = Math.abs(chapterCenterX(c.id) - this.target.x);
      if (dx < d) {
        d = dx;
        best = c;
      }
    }
    return best;
  }

  // World point -> CSS pixels { x, y, visible }.
  project(p, out = {}) {
    const v = (this._v ??= new THREE.Vector3()).copy(p).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    out.visible = v.z < 1 && out.x > -60 && out.x < window.innerWidth + 60 && out.y > -60 && out.y < window.innerHeight + 60;
    return out;
  }

  nodePosition(stage) {
    return this.layout[stage.index];
  }

  // Called after every camera move (the HUD repositions its buttons).
  onMove(fn) {
    this.listeners.add(fn);
  }

  // ---- Input: drag to pan, with a little inertia ----

  worldPerPixel() {
    const dist = CAM_OFFSET.length();
    const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return h / window.innerHeight;
  }

  bindInput() {
    const el = this.canvas;
    el.addEventListener('pointerdown', (e) => {
      if (!this.running) return;
      this.dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, t: performance.now(), moved: 0 };
      this.velocity = 0;
    });
    el.addEventListener('pointermove', (e) => {
      const d = this.dragging;
      if (!this.running || !d || d.id !== e.pointerId) return;
      const k = this.worldPerPixel();
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x, e.clientY - d.y));
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      const now = performance.now();
      this.velocity = (-dx * k) / Math.max(0.008, (now - d.t) / 1000);
      d.t = now;
      this.target.x = THREE.MathUtils.clamp(this.target.x - dx * k, this.bounds.minX, this.bounds.maxX);
      this.target.z = THREE.MathUtils.clamp(this.target.z - dy * k * 1.3, -Z_RANGE, Z_RANGE);
      this.goal.copy(this.target);
    });
    const end = (e) => {
      const d = this.dragging;
      if (!d || d.id !== e.pointerId) return;
      this.dragging = null;
      if (d.moved < TAP_SLOP_PX || performance.now() - d.t > 120) this.velocity = 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.running) return;
        const k = this.worldPerPixel();
        this.target.x = THREE.MathUtils.clamp(this.target.x + (e.deltaX || e.deltaY) * k, this.bounds.minX, this.bounds.maxX);
        this.goal.copy(this.target);
        this.velocity = 0;
      },
      { passive: true }
    );
  }

  // ---- Loop ----

  start() {
    this.build();
    if (this.running) return;
    this.running = true;
    this.resize();
    window.addEventListener('resize', this.resize);
    this.last = performance.now();
    this.renderer.setAnimationLoop(this.frame);
  }

  stop() {
    this.running = false;
    this.dragging = null;
    window.removeEventListener('resize', this.resize);
    this.renderer.setAnimationLoop(null);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait screens see less of the road: pull the camera back.
    this.camera.fov = w / h < 1 ? 58 : 38;
    this.camera.updateProjectionMatrix();
  }

  // Sky, fog, light and sea colours blend between neighbouring chapter moods.
  applyMood() {
    const x = this.target.x;
    const centers = CHAPTERS.map((c) => chapterCenterX(c.id));
    let i = 0;
    while (i < centers.length - 2 && x > centers[i + 1]) i++;
    const k = THREE.MathUtils.smoothstep(x, lerp(centers[i], centers[i + 1], 0.25), lerp(centers[i], centers[i + 1], 0.75));
    const a = MOODS[CHAPTERS[i].id];
    const b = MOODS[CHAPTERS[i + 1].id];
    const mix = (key, color) => color.set(a[key]).lerp((this._c ??= new THREE.Color()).set(b[key]), k);
    mix('sky', this.scene.background);
    mix('fog', this.scene.fog.color);
    mix('water', this.world.water.material.color);
    mix('hemiSky', this.hemi.color);
    mix('hemiGround', this.hemi.groundColor);
    mix('sun', this.sun.color);
    this.hemi.intensity = lerp(a.hemi, b.hemi, k);
    this.sun.intensity = lerp(a.sunI, b.sunI, k);
  }

  update(dt) {
    this.time += dt;
    if (!this.dragging) {
      if (Math.abs(this.velocity) > 0.5) {
        this.target.x = THREE.MathUtils.clamp(this.target.x + this.velocity * dt, this.bounds.minX, this.bounds.maxX);
        this.velocity *= Math.exp(-dt * 4);
        this.goal.copy(this.target);
      } else {
        this.velocity = 0;
        this.target.lerp(this.goal, 1 - Math.exp(-dt * 5));
      }
    }
    const portrait = this.camera.aspect < 1 ? 1.25 : 1;
    this.camera.position.copy(this.target).addScaledVector(CAM_OFFSET, portrait);
    this.camera.lookAt(this.target.x, 2, this.target.z);
    this.camera.updateMatrixWorld();
    this.applyMood();
    this.beaconRing.rotation.y += dt * 1.6;
    this.beaconRing.position.y = 0.9 + Math.sin(this.time * 3) * 0.25;
    this.beacon.children[0].material.opacity = 0.18 + Math.sin(this.time * 2.4) * 0.06;
    for (const fn of this.listeners) fn();
  }

  frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    this.fpsT = (this.fpsT ?? 0) + dt;
    this.fpsN = (this.fpsN ?? 0) + 1;
    if (this.fpsT >= 1) {
      this.onFps?.(this.fpsN / this.fpsT);
      this.fpsT = this.fpsN = 0;
    }
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
