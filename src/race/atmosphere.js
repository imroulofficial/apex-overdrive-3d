import * as THREE from 'three';
import { mulberry32 } from './noise.js';

// Weather in motion (blueprint §03): falling rain around the camera, lightning, rain beading
// on the lens, and reflective puddles on a wet road. Sky, sun, fog and sea colours are set by
// scenery.applyWeather; this module owns what moves.
//
// Draw calls: rain 1, puddles 1 (both hidden in the dry). The lens drops are a CSS overlay.

const RAIN_BOX = new THREE.Vector3(70, 34, 70);
const RAIN_COUNT = { low: 900, medium: 1800, high: 2600 };

// Rain: streaks in a box that wraps around the camera, each fixed in world space so driving
// through the rain reads as speed. One LineSegments draw; the GPU does all the motion.
export class Rain {
  constructor(scene, quality = 'medium') {
    const n = RAIN_COUNT[quality] ?? RAIN_COUNT.medium;
    const rand = mulberry32(3);
    const seed = new Float32Array(n * 2 * 3);
    const tip = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = rand();
      const y = rand();
      const z = rand();
      for (let k = 0; k < 2; k++) {
        seed.set([x, y, z], (i * 2 + k) * 3);
        tip[i * 2 + k] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(seed, 3));
    geo.setAttribute('tip', new THREE.BufferAttribute(tip, 1));
    this.uniforms = {
      origin: { value: new THREE.Vector3() },
      box: { value: RAIN_BOX.clone() },
      time: { value: 0 },
      fall: { value: 24 },
      wind: { value: new THREE.Vector2(2.5, -1.2) },
      carVel: { value: new THREE.Vector2() },
      density: { value: 0 },
      color: { value: new THREE.Color(0xc8d4dc) },
      flash: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float tip;
        uniform vec3 origin, box;
        uniform float time, fall, density;
        uniform vec2 wind, carVel;
        varying float vAlpha;
        void main() {
          vec3 vel = vec3(wind.x, -fall, wind.y);
          // World-fixed drops wrapped into a box centred on the camera.
          vec3 p = position * box - vel * time * (0.85 + position.y * 0.3);
          p = origin + mod(p - origin, box) - box * 0.5;
          // Streak length follows the drop's speed relative to the car (motion blur).
          vec3 rel = vel - vec3(carVel.x, 0.0, carVel.y) * 0.55;
          p -= rel * 0.022 * tip;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          // Thin out with distance and drop the streaks a sparse shower does not need.
          float d = length(mv.xyz);
          vAlpha = smoothstep(34.0, 6.0, d) * smoothstep(1.2, 3.0, d) * step(position.x, density + 0.001);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float flash;
        varying float vAlpha;
        void main() {
          if (vAlpha < 0.01) discard;
          gl_FragColor = vec4(color * (1.0 + flash * 3.0), vAlpha * 0.32);
        }`,
    });
    this.mesh = new THREE.LineSegments(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  set(amount) {
    this.uniforms.density.value = Math.min(1, amount);
    this.mesh.visible = amount > 0;
  }

  update(time, camera, car, flash = 0) {
    if (!this.mesh.visible) return;
    const u = this.uniforms;
    u.time.value = time;
    u.origin.value.copy(camera.position);
    u.carVel.value.set(car.vel.x, car.vel.y);
    u.flash.value = flash;
  }
}

// Lightning: a flash every 6-15 s, flickering two or three times over a third of a second,
// then thunder after the light has travelled (343 m/s from a strike 0.4-2.4 km away).
// Pure timing, so the tests can step it.
export class Lightning {
  constructor({ seed = 11, minGap = 6, maxGap = 15 } = {}) {
    this.rand = mulberry32(seed);
    this.minGap = minGap;
    this.maxGap = maxGap;
    this.enabled = false;
    this.reset();
  }

  reset() {
    this.t = 0;
    this.next = 3 + this.rand() * 4;
    this.strike = null;
  }

  // Returns { flash 0..1, thunder: distance in metres | null } for this frame.
  update(dt) {
    this.t += dt;
    let thunder = null;
    if (!this.enabled) return { flash: 0, thunder };
    if (!this.strike && this.t >= this.next) {
      const distance = 400 + this.rand() * 2000;
      const pulses = this.rand() < 0.5 ? 2 : 3;
      this.strike = { at: this.t, distance, pulses, thunderAt: this.t + distance / 343, heard: false, k: 1 - distance / 3200 };
      this.next = this.t + this.minGap + this.rand() * (this.maxGap - this.minGap);
    }
    let flash = 0;
    const s = this.strike;
    if (s) {
      const age = this.t - s.at;
      // Flickers: sharp peaks 0.11 s apart, each decaying fast, the first strongest.
      for (let p = 0; p < s.pulses; p++) {
        const a = age - p * 0.11;
        if (a >= 0) flash = Math.max(flash, Math.exp(-a * 16) * (p ? 0.7 : 1));
      }
      flash *= s.k;
      if (!s.heard && this.t >= s.thunderAt) {
        s.heard = true;
        thunder = s.distance;
      }
      if (s.heard && age > 0.6) this.strike = null;
    }
    return { flash, thunder };
  }
}

// Rain beading and running on the lens: a CSS overlay above the canvas, below the HUD.
export class LensDrops {
  constructor(parent = document.body) {
    this.el = document.createElement('div');
    this.el.className = 'rain-lens';
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.drops = [];
    this.amount = 0;
    this.acc = 0;
  }

  set(amount) {
    this.amount = amount;
    this.el.hidden = amount <= 0;
    if (amount <= 0) this.clear();
  }

  clear() {
    for (const d of this.drops) d.el.remove();
    this.drops.length = 0;
  }

  // speed: m/s; fast driving blows the drops off the lens sideways.
  update(dt, speed) {
    if (this.amount <= 0) return;
    this.acc += dt * this.amount * (speed > 30 ? 1.5 : 4);
    while (this.acc >= 1 && this.drops.length < 14) {
      this.acc -= 1;
      const el = document.createElement('i');
      const size = 6 + Math.random() * 16;
      el.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 85}%;width:${size}px;height:${size * 1.15}px`;
      this.el.appendChild(el);
      this.drops.push({ el, life: 0, max: 0.8 + Math.random() * 1.6, run: 0 });
    }
    if (this.acc >= 1) this.acc = 0;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life += dt;
      d.run += dt * (8 + speed * 0.9);
      const k = d.life / d.max;
      if (k >= 1) {
        d.el.remove();
        this.drops.splice(i, 1);
        continue;
      }
      d.el.style.opacity = String((1 - k) * 0.85);
      d.el.style.transform = `translate(${-d.run * 0.35}px, ${d.run}px)`;
    }
  }

  dispose() {
    this.clear();
    this.el.remove();
  }
}

// Puddles: soft-edged discs on the asphalt, near-mirror smooth so they pick up the sky and the
// coast from the environment map, with rain ripples scrolling across the water normals.
// World-space, so the forward and reversed tracks share one mesh.
export function buildPuddles(track, list, waterNormals) {
  const segs = 18;
  const pos = [];
  const col = [];
  const uv = [];
  const f = {};
  for (const p of list) {
    track.frame(p.s, f);
    const cx = f.x + f.rx * p.d;
    const cz = f.z + f.rz * p.d;
    const y = track.heightAt(p.s, p.d) + 0.03;
    const ring = [];
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      // Stretched along the road (water runs downhill), slightly irregular rim.
      const wob = 1 + 0.18 * Math.sin(a * 3 + p.s) + 0.1 * Math.sin(a * 5 + p.d);
      const ax = Math.cos(a) * 2 * p.r * wob;
      const ad = Math.sin(a) * p.r * wob;
      ring.push([cx + f.tx * ax + f.rx * ad, cz + f.tz * ax + f.rz * ad]);
    }
    for (let k = 0; k < segs; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % segs];
      pos.push(cx, y, cz, a[0], y, a[1], b[0], y, b[1]);
      col.push(1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0);
      uv.push(cx / 6, cz / 6, a[0] / 6, a[1] / 6, b[0] / 6, b[1] / 6);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const normalMap = waterNormals.clone();
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x20262c,
    roughness: 0.04,
    metalness: 0.85,
    normalMap,
    normalScale: new THREE.Vector2(0.12, 0.12),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    envMapIntensity: 1.4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'puddles';
  mesh.renderOrder = 2;
  mesh.receiveShadow = true;
  mesh.visible = false;
  mesh.userData.update = (t, wet) => {
    normalMap.offset.set(t * 0.03, t * 0.05);
    mat.opacity = Math.min(1, wet * 1.2);
    normalMap.rotation = 0;
  };
  return mesh;
}
