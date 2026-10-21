import * as THREE from 'three';

// Lightweight GPU particles (tyre smoke, sparks, dust) and the nitro speed-line overlay.

export class Particles {
  constructor(scene, { count = 320, additive = false, texture } = {}) {
    this.count = count;
    this.cursor = 0;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.alpha = new Float32Array(count);
    this.size = new Float32Array(count);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.grow = new Float32Array(count);
    this.startAlpha = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { map: { value: texture }, scale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        attribute float size;
        attribute vec3 color;
        uniform float scale;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vAlpha = alpha;
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          float a = texture2D(map, gl_PointCoord).a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.material = mat;
    scene.add(this.points);
  }

  setViewport(height, fov) {
    this.material.uniforms.scale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }

  emit(x, y, z, vx, vy, vz, { color, size = 0.6, life = 1, grow = 1.5, alpha = 0.5 }) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    color.toArray(this.col, i * 3);
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i] = grow;
    this.startAlpha[i] = alpha;
    this.alpha[i] = alpha;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.geo.attributes.alpha.needsUpdate = true;
  }

  update(dt, gravity = 0) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= gravity * dt;
      const damp = 1 - Math.min(1, dt * 1.6);
      this.vel[i * 3] *= damp;
      this.vel[i * 3 + 2] *= damp;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.startAlpha[i] * k * Math.min(1, (1 - k) * 8 + 0.2);
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = true;
    a.alpha.needsUpdate = true;
    a.size.needsUpdate = true;
    a.color.needsUpdate = true;
  }
}

export function softDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const BLUE = new THREE.Color(0x58b8ff);
const ORANGE = new THREE.Color(0xff8a2a);
const PURPLE = new THREE.Color(0xc062ff);
const WHITE = new THREE.Color(0xeaf4ff);

// Streaks rushing past the camera during nitro, drawn in camera space on top of the scene.
export class SpeedLines {
  constructor(camera, count = 110) {
    this.count = count;
    this.lines = Array.from({ length: count }, () => this.spawn({}, true));
    this.pos = new Float32Array(count * 6);
    this.col = new Float32Array(count * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.LineSegments(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    camera.add(this.mesh);
    this.level = 0;
  }

  spawn(l, initial = false) {
    l.a = Math.random() * Math.PI * 2;
    l.r = 2.2 + Math.random() * 2.6;
    l.z = initial ? -8 - Math.random() * 30 : -30 - Math.random() * 10;
    l.v = 0.8 + Math.random() * 0.6;
    l.hue = Math.random();
    return l;
  }

  update(dt, target, speed, tier) {
    this.level += (target - this.level) * Math.min(1, dt * (target > this.level ? 8 : 3));
    this.mesh.visible = this.level > 0.02;
    if (!this.mesh.visible) return;
    this.material.opacity = this.level * 0.85;
    const len = 1.5 + speed * 0.06 * this.level;
    for (let i = 0; i < this.count; i++) {
      const l = this.lines[i];
      l.z += speed * l.v * dt * 1.4;
      if (l.z > -1.2) this.spawn(l);
      const x = Math.cos(l.a) * l.r;
      const y = Math.sin(l.a) * l.r * 0.62;
      const o = i * 6;
      this.pos[o] = x;
      this.pos[o + 1] = y;
      this.pos[o + 2] = l.z;
      this.pos[o + 3] = x;
      this.pos[o + 4] = y;
      this.pos[o + 5] = l.z - len;
      const c = tier === 2 ? (l.hue < 0.5 ? ORANGE : PURPLE) : l.hue < 0.3 ? WHITE : BLUE;
      c.toArray(this.col, o);
      this.col[o + 3] = 0;
      this.col[o + 4] = 0;
      this.col[o + 5] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// Tyre skid marks: dark rubber strips laid on the road behind sliding or braking wheels.
// One ring buffer of quads in a single mesh (one draw call for every car); each segment
// stores its birth time and fades out in the shader, so old marks never need CPU work.
export class SkidMarks {
  constructor(scene, { segments = 900, width = 0.26, life = 14 } = {}) {
    this.segments = segments;
    this.width = width;
    this.cursor = 0;
    this.pos = new Float32Array(segments * 4 * 3);
    this.born = new Float32Array(segments * 4).fill(-1e6);
    this.alpha = new Float32Array(segments * 4);
    const index = new Uint32Array(segments * 6);
    for (let i = 0; i < segments; i++) {
      const a = i * 4;
      index.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('born', new THREE.BufferAttribute(this.born, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 }, life: { value: life } }]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        attribute float born;
        attribute float alpha;
        uniform float time, life;
        varying float vAlpha;
        void main() {
          float age = time - born;
          vAlpha = alpha * (1.0 - smoothstep(life * 0.6, life, age));
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        #include <fog_pars_fragment>
        void main() {
          if (vAlpha < 0.005) discard;
          gl_FragColor = vec4(0.018, 0.018, 0.02, vAlpha);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'skid-marks';
    scene.add(this.mesh);
    this.time = 0;
    this.dirty = false;
  }

  // Extends the mark of one wheel. `trail` is per-wheel state ({ x, y, z, rx, rz } or null).
  // Returns the new trail state; pass null to lift the wheel (breaks the strip).
  add(trail, x, y, z, rx, rz, strength) {
    const hw = this.width / 2;
    if (trail && Math.hypot(x - trail.x, z - trail.z) < 0.5) return trail;
    if (trail && Math.hypot(x - trail.x, z - trail.z) < 4) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.segments;
      const o = i * 12;
      const p = this.pos;
      p[o] = trail.x - trail.rx * hw; p[o + 1] = trail.y; p[o + 2] = trail.z - trail.rz * hw;
      p[o + 3] = trail.x + trail.rx * hw; p[o + 4] = trail.y; p[o + 5] = trail.z + trail.rz * hw;
      p[o + 6] = x - rx * hw; p[o + 7] = y; p[o + 8] = z - rz * hw;
      p[o + 9] = x + rx * hw; p[o + 10] = y; p[o + 11] = z + rz * hw;
      for (let k = 0; k < 4; k++) {
        this.born[i * 4 + k] = this.time;
        this.alpha[i * 4 + k] = (k < 2 ? trail.a : strength) * 0.75;
      }
      this.dirty = true;
    }
    return { x, y, z, rx, rz, a: strength };
  }

  clear() {
    this.born.fill(-1e6);
    this.geo.attributes.born.needsUpdate = true;
  }

  update(dt) {
    this.time += dt;
    this.material.uniforms.time.value = this.time;
    if (!this.dirty) return;
    this.dirty = false;
    const a = this.geo.attributes;
    a.position.needsUpdate = true;
    a.born.needsUpdate = true;
    a.alpha.needsUpdate = true;
  }
}
