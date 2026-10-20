import * as THREE from 'three';
import { createShowroom, createStudioEnvironment } from './showroom.js';
import { createCar } from './carModel.js';
import { createCameraRig, SHOTS } from './cameraRig.js';
import { PaintTransition } from './carPaint.js';

export const QUALITY = {
  low: { maxPixelRatio: 1, shadows: false, reflections: false, reflectionScale: 0 },
  medium: { maxPixelRatio: 1.5, shadows: true, reflections: true, reflectionScale: 0.35 },
  high: { maxPixelRatio: 2, shadows: true, reflections: true, reflectionScale: 0.5 },
};
const AUTO_ORDER = ['high', 'medium', 'low'];
const TAP_SLOP_PX = 8;

export class Garage {
  constructor(canvas, { paintColor, finish, quality, onTap, onFps }) {
    this.canvas = canvas;
    this.onTap = onTap;
    this.onFps = onFps;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070d);
    this.scene.fog = new THREE.FogExp2(0x05070d, 0.045);
    this.scene.environment = createStudioEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.9;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    this.showroom = createShowroom(this.scene);
    this.car = createCar({ paintColor, finish });
    this.car.group.position.y = 0.06; // on the turntable deck
    this.showroom.turntable.add(this.car.group);
    this.paint = new PaintTransition(this.car.paintMaterial);

    this.rig = createCameraRig(this.camera, canvas);
    this.raycaster = new THREE.Raycaster();

    this.qualityMode = quality;
    this.qualityLevel = quality === 'auto' ? 'high' : quality;
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
    this.last = performance.now();
    this.renderer.setAnimationLoop(this.frame);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
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
    this.qualityLevel = mode === 'auto' ? 'high' : mode;
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

  setPaint(color, finish) {
    this.paint.start(color, finish);
  }

  toggleLights() {
    this.car.setLights(!this.car.lightsOn);
    return this.car.lightsOn;
  }

  snap(name) {
    const shot = typeof name === 'number' ? SHOTS.wheel(name) : SHOTS[name];
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
      if (!down || down.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > TAP_SLOP_PX) return;
      const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = this.raycaster.intersectObject(this.car.group, true).find((h) => h.object.name !== 'beam');
      if (!hit) return;
      const o = hit.object;
      if (o.userData.wheelIndex !== undefined) this.onTap?.({ type: 'wheel', index: o.userData.wheelIndex });
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
    this.renderer.render(this.scene, this.camera);
  }
}
