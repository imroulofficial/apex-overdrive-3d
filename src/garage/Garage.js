import * as THREE from 'three';
import { createShowroom, createStudioEnvironment, NO_REFLECT } from './showroom.js';
import { createCar } from './carModel.js';
import { loadCar } from '../assets/modelLoader.js';
import { createCameraRig, SHOTS } from './cameraRig.js';
import { PaintTransition } from './carPaint.js';
import { isNative } from '../core/platform.js';

// Mobile budget: the pixel ratio never exceeds 1.5 (a 3x phone would otherwise shade 4x the
// pixels for no visible gain), and the garage's planar mirror (a second full scene render
// every frame) is the only extra pass, kept for High.
export const QUALITY = {
  low: { maxPixelRatio: 1, shadows: false, reflections: false, reflectionScale: 0 },
  medium: { maxPixelRatio: 1.25, shadows: true, reflections: false, reflectionScale: 0 },
  high: { maxPixelRatio: 1.5, shadows: true, reflections: true, reflectionScale: 0.35 },
};
// Auto starts at Medium on phones and tablets, High on desktop; it steps down if FPS sags.
const AUTO_START = isNative || matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
const AUTO_ORDER = ['high', 'medium', 'low'];
const TAP_SLOP_PX = 8;

// Cockpit, brake discs and arch liners stay out of the floor mirror (see showroom.js).
const skipMirror = (root) =>
  root.traverse((o) => {
    if (o.isMesh && (o.userData.noReflect || [].concat(o.material).every((m) => m.name === 'skip'))) o.layers.set(NO_REFLECT);
  });

export class Garage {
  constructor(canvas, { car, paintColor, finish, look = {}, quality, onTap, onFps, onHotspot, onShowcase }) {
    this.canvas = canvas;
    this.onTap = onTap;
    this.onFps = onFps;
    // Door hotspot screen position each frame: { x, y, visible, open }.
    this.onHotspot = onHotspot;
    this.onShowcase = onShowcase;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1c2552); // under the sky dome
    this.scene.environment = createStudioEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.9;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1200);
    this.showroom = createShowroom(this.scene);
    this.showroom.bindCamera(this.camera);
    // The procedural car shows instantly; setCar() then swaps in an external model if one exists.
    this.car = createCar({ paintColor, finish, style: car.procedural?.style, ...look });
    this.carId = null; // car on the turntable once setCar() resolves
    this.wantedCarId = null; // latest requested car
    this.carToken = 0;
    this.car.group.position.y = 0.06; // on the turntable deck
    skipMirror(this.car.group);
    this.showroom.turntable.add(this.car.group);
    this.paint = new PaintTransition(this.car.paintMaterial);

    this.rig = createCameraRig(this.camera, canvas, { onShowcase: (on) => this.onShowcase?.(on) });
    this.hotspot = { x: 0, y: 0, visible: false, open: false };
    this.tmp = new THREE.Vector3();
    this.tmpN = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();

    this.qualityMode = quality;
    this.qualityLevel = quality === 'auto' ? AUTO_START : quality;
    this.fpsSamples = [];
    this.fpsTimer = 0;
    this.autoSettle = quality === 'auto' ? 0 : Infinity;

    this.bindTap();
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.applyQuality();

    this.last = performance.now();
    this.running = false;
    this.frame = this.frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.rig.controls.enabled = true;
    this.last = performance.now();
    this.renderer.setAnimationLoop(this.frame);
  }

  stop() {
    this.running = false;
    this.rig.controls.enabled = false;
    this.rig.endShowcase(false);
    this.car.door?.close();
    this.renderer.setAnimationLoop(null);
  }

  // Any touch on the garage UI counts as activity (it holds off the idle showcase).
  poke() {
    this.rig.poke();
  }

  intro() {
    this.rig.intro();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const q = QUALITY[this.qualityLevel];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.maxPixelRatio));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole car framed on narrow (portrait) screens.
    this.camera.fov = w / h < 1 ? 58 : 42;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.showroom.setQuality(q, w * pr, h * pr);
  }

  setQuality(mode) {
    this.qualityMode = mode;
    this.autoSettle = mode === 'auto' ? 0 : Infinity;
    this.qualityLevel = mode === 'auto' ? AUTO_START : mode;
    this.applyQuality();
  }

  applyQuality() {
    const q = QUALITY[this.qualityLevel];
    if (this.renderer.shadowMap.enabled !== q.shadows) {
      this.renderer.shadowMap.enabled = q.shadows;
      // Shadow support is compiled into shaders, so materials must rebuild.
      this.scene.traverse((o) => {
        if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true));
      });
    }
    this.resize();
  }

  // Spawns `def` on the turntable (external .glb when present, procedural otherwise).
  async setCar(def, { color, finish, rim, spoiler }) {
    const token = ++this.carToken;
    this.wantedCarId = def.id;
    const rig = await loadCar(def, { paintColor: color, finish, rim, spoiler });
    if (token !== this.carToken) return; // a newer selection won
    const old = this.car;
    this.showroom.turntable.remove(old.group);
    // glTF clones share geometry with the loader cache, so only procedural meshes are freed.
    if (old.source === 'procedural') old.group.traverse((o) => o.isMesh && o.geometry.dispose());
    rig.group.position.y = 0.06;
    skipMirror(rig.group);
    rig.setLights(old.lightsOn);
    this.showroom.turntable.add(rig.group);
    this.car = rig;
    this.carId = def.id;
    this.paint = new PaintTransition(rig.paintMaterial);
  }

  setPaint(color, finish) {
    this.paint.start(color, finish);
  }

  // Rim and rear wing on the turntable car (the race bakes whatever the save says).
  setRim(id) {
    this.car.setRim?.(id);
    skipMirror(this.car.group);
  }

  setSpoiler(id) {
    this.car.setSpoiler?.(id);
  }

  // Opens or shuts the driver door and frames it. Returns the new state (null: no door).
  toggleDoor() {
    const door = this.car.door;
    if (!door) return null;
    const open = door.toggle();
    this.rig.snapTo(open ? SHOTS.door : SHOTS.body, 1.2);
    return open;
  }

  // Projects the door hotspot to the screen, hidden when the door faces away.
  updateHotspot() {
    const door = this.car.door;
    const h = this.hotspot;
    let visible = false;
    if (door && !this.rig.showcasing) {
      const p = this.tmp.copy(door.anchor).applyMatrix4(this.car.group.matrixWorld);
      const n = this.tmpN.copy(door.normal).transformDirection(this.car.group.matrixWorld);
      const toCam = this.camera.position.clone().sub(p).normalize();
      if (n.dot(toCam) > 0.25) {
        p.project(this.camera);
        visible = p.z < 1 && Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95;
        h.x = (p.x * 0.5 + 0.5) * window.innerWidth;
        h.y = (-p.y * 0.5 + 0.5) * window.innerHeight;
      }
    }
    h.visible = visible;
    h.open = Boolean(door?.open);
    this.onHotspot?.(h);
  }

  toggleLights() {
    this.car.setLights(!this.car.lightsOn);
    return this.car.lightsOn;
  }

  snap(name) {
    const shot = typeof name === 'number' ? SHOTS.wheel(name, this.car.wheels[name]?.wheel.position, this.car.wheelRadius) : SHOTS[name];
    if (name !== 'door' && this.car.door?.open) this.car.door.close();
    if (shot) this.rig.snapTo(shot);
  }

  rev() {
    this.car.spinWheels(28);
  }

  bindTap() {
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!this.running || !down || down.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > TAP_SLOP_PX) return;
      const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = this.raycaster.intersectObject(this.car.group, true).find((h) => h.object.name !== 'beam');
      if (!hit) return;
      const o = hit.object;
      if (o.userData.wheelIndex !== undefined) this.onTap?.({ type: 'wheel', index: o.userData.wheelIndex });
      else if (o.name === 'door') this.onTap?.({ type: 'door' });
      else if (o.name === 'headlight' || o.name === 'taillight') this.onTap?.({ type: 'lights' });
      else this.onTap?.({ type: 'body' });
    });
  }

  // Auto quality: if the frame rate stays low, step down a level (high → medium → low).
  trackPerformance(dt) {
    this.fpsTimer += dt;
    this.fpsSamples.push(dt);
    if (this.fpsTimer < 1) return;
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    const fps = 1 / avg;
    this.onFps?.(fps);
    this.fpsSamples.length = 0;
    this.fpsTimer = 0;

    if (this.autoSettle === Infinity) return;
    this.autoSettle += 1;
    if (this.autoSettle < 3) return; // let shaders compile and the intro settle
    if (fps < 48) {
      const next = AUTO_ORDER[AUTO_ORDER.indexOf(this.qualityLevel) + 1];
      if (next) {
        this.qualityLevel = next;
        this.applyQuality();
        this.autoSettle = 0;
        return;
      }
    }
    if (this.autoSettle > 12) this.autoSettle = Infinity; // stable, stop probing
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.trackPerformance(dt);
    this.showroom.update(dt);
    this.car.update(dt);
    this.paint.update(dt);
    this.rig.update(dt);
    this.updateHotspot();
    this.renderer.render(this.scene, this.camera);
  }
}
