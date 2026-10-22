import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The garage showroom (blueprint 4.4): an architectural pavilion on a cliff top, its glass
// façade looking over the ocean at sunset. Inside: a polished epoxy floor (a planar mirror on
// High, glossy env reflections below that), a turntable, a slatted timber wall and a ceiling
// of warm recessed spotlights. Outside: a vertex-coloured sky dome, a low sun, cloud streaks,
// headlands and an ocean with a moving sun glitter path.
//
// Lighting is one shadow-casting directional key (the spotlight cluster above the turntable,
// 512² map), one unshadowed low sun from the sea for warm rim light, and a hemisphere fill.
// The spotlight pools and beams are additive decals, not real lights. Everything is built
// once from primitives and canvas textures; nothing is downloaded.

// Where the sun sits: low over the sea, behind the car in the garage's hero shot.
export const SUN_DIR = new THREE.Vector3(-0.72, 0.075, -0.69).normalize();
const ROOM_R = 14; // glass façade and back wall radius
const CEILING = 5.6;
const SPOTS_R = 4.2;
// The façade spans this arc (radians either side of the sun's azimuth); the wall is the rest.
const SUN_AZ = Math.atan2(SUN_DIR.z, SUN_DIR.x);
const GLASS_HALF = 1.95;

// Layer for objects the floor mirror skips (floor decals, things below the floor plane,
// the cockpit): the main camera sees layers 0 and 1, the mirror's camera only layer 0.
// That keeps the High-quality reflection pass (a second scene render) inside the budget.
export const NO_REFLECT = 1;
const noReflect = (...objs) => objs.forEach((o) => o.traverse((c) => c.layers.set(NO_REFLECT)));

const SKY = {
  zenith: new THREE.Color(0x1c2552),
  high: new THREE.Color(0x5a4b8c),
  low: new THREE.Color(0xe0708a),
  horizon: new THREE.Color(0xffa25c),
  glow: new THREE.Color(0xffd696),
  sea: new THREE.Color(0x2a2140),
};

function canvasTexture(w, h, draw, srgb = true) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Sunset sky colour for a direction (shared by the visible dome and the reflection bake).
function skyColor(d, out) {
  const e = d.y;
  if (e < 0) return out.copy(SKY.sea).lerp(SKY.horizon, Math.max(0, 1 + e * 12) * 0.35);
  if (e < 0.06) out.copy(SKY.horizon).lerp(SKY.low, e / 0.06);
  else if (e < 0.3) out.copy(SKY.low).lerp(SKY.high, (e - 0.06) / 0.24);
  else out.copy(SKY.high).lerp(SKY.zenith, Math.min(1, (e - 0.3) / 0.5));
  const toSun = Math.max(0, d.x * SUN_DIR.x + d.z * SUN_DIR.z + d.y * SUN_DIR.y);
  out.lerp(SKY.glow, Math.pow(toSun, 6) * 0.85 * (1 - Math.min(1, e * 2.5)));
  return out;
}

function skyDome(radius, detail = 48) {
  const geo = new THREE.SphereGeometry(radius, detail, detail / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const d = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    skyColor(d, c).toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }));
}

// Distant headlands either side of the sun, fading into the haze.
function headlands(radius) {
  const geos = [];
  const ridge = (az0, az1, peak, seed) => {
    const steps = 28;
    const positions = [];
    const colors = [];
    const top = new THREE.Color(0x3a2b4f);
    const base = new THREE.Color(0xc46a6a);
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const az = az0 + (az1 - az0) * k;
      const h = peak * Math.sin(Math.PI * k) * (0.75 + 0.25 * Math.sin(k * 17 + seed)) + 0.4;
      const x = Math.cos(az) * radius;
      const z = Math.sin(az) * radius;
      positions.push(x, -8.4, z, x, -8.4 + h, z);
      base.toArray(colors, colors.length);
      top.toArray(colors, colors.length);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const idx = [];
    for (let i = 0; i < steps; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2, a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    geo.setIndex(idx);
    geos.push(geo);
  };
  ridge(SUN_AZ - 0.95, SUN_AZ - 0.38, 14, 1);
  ridge(SUN_AZ + 0.3, SUN_AZ + 0.72, 9, 4);
  ridge(SUN_AZ + 0.62, SUN_AZ + 1.25, 17, 7);
  return new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false }));
}

// Ocean with a moving glitter path toward the sun (one cheap shader, no reflections pass).
function ocean() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      sunDir: { value: SUN_DIR },
      deep: { value: new THREE.Color(0x15183a) },
      far: { value: new THREE.Color(0xc86a7a) },
      glint: { value: new THREE.Color(0xffd9a0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform vec3 sunDir, deep, far, glint;
      varying vec3 vWorld;
      void main() {
        vec3 v = normalize(vWorld - cameraPosition);
        vec2 p = vWorld.xz;
        // Wave normal from a few travelling sines.
        float a = sin(p.x * 0.21 + time * 0.9) + sin(p.y * 0.17 - time * 0.7) * 0.8 + sin((p.x + p.y) * 0.53 + time * 1.7) * 0.4;
        float b = cos(p.y * 0.23 + time * 0.8) + cos((p.x - p.y) * 0.41 - time * 1.3) * 0.6;
        vec3 n = normalize(vec3(a * 0.05, 1.0, b * 0.05));
        vec3 r = reflect(v, n);
        float fres = pow(1.0 - max(0.0, -v.y), 5.0);
        vec3 col = mix(deep, far, clamp(fres * 1.2, 0.0, 1.0));
        float spec = pow(max(dot(r, sunDir), 0.0), 380.0) * 5.0 + pow(max(dot(r, sunDir), 0.0), 24.0) * 0.35;
        col += glint * spec;
        gl_FragColor = vec4(col, 1.0);
      }`,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), mat);
  mesh.position.y = -8.5;
  return mesh;
}

// Sun disc and cloud streaks: two additive billboards sharing the sky.
function sunAndClouds() {
  const group = new THREE.Group();
  const sunTex = canvasTexture(128, 128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,246,220,1)');
    grad.addColorStop(0.12, 'rgba(255,224,160,1)');
    grad.addColorStop(0.2, 'rgba(255,170,90,0.55)');
    grad.addColorStop(1, 'rgba(255,120,60,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  const sun = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 34),
    new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false })
  );
  sun.position.copy(SUN_DIR).multiplyScalar(150);
  sun.lookAt(0, 0, 0);
  group.add(sun);

  const cloudTex = canvasTexture(256, 64, (g, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = (i / 26) * w + Math.random() * 10;
      const y = h * (0.35 + Math.random() * 0.3);
      const grad = g.createRadialGradient(x, y, 0, x, y, 30 + Math.random() * 20);
      grad.addColorStop(0, 'rgba(255,190,170,0.5)');
      grad.addColorStop(1, 'rgba(255,190,170,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
  });
  const geos = [];
  for (const [dAz, elev, w, h] of [[-0.35, 0.12, 120, 14], [0.22, 0.07, 90, 9], [0.55, 0.2, 140, 18], [-0.7, 0.24, 110, 16], [0.05, 0.3, 160, 20]]) {
    const az = SUN_AZ + dAz;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    const g = new THREE.PlaneGeometry(w, h);
    const m = new THREE.Matrix4().lookAt(dir.clone().multiplyScalar(140), new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    m.setPosition(dir.multiplyScalar(140));
    geos.push(g.applyMatrix4(m));
  }
  const clouds = new THREE.Mesh(
    mergeGeometries(geos),
    new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide })
  );
  group.add(clouds);
  return group;
}

// Polished epoxy: warm charcoal with a soft mottle, clearer near the car.
function floorTexture() {
  return canvasTexture(1024, 1024, (g, s) => {
    g.fillStyle = '#17130f';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const r = 8 + Math.random() * 40;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const l = Math.random() < 0.5 ? '40,33,26' : '10,8,7';
      grad.addColorStop(0, `rgba(${l},0.18)`);
      grad.addColorStop(1, `rgba(${l},0)`);
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const grad = g.createRadialGradient(s / 2, s / 2, s * 0.06, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    // Alpha: the mirror shows through more near the car.
    const img = g.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const d = Math.hypot(x - s / 2, y - s / 2) / (s / 2);
        img.data[(y * s + x) * 4 + 3] = Math.round(255 * Math.min(1, 0.5 + d * 0.38));
      }
    }
    g.putImageData(img, 0, 0);
  });
}

// Vertical timber slats for the back wall.
function slatTexture() {
  const tex = canvasTexture(512, 64, (g, w, h) => {
    const slats = 16;
    for (let i = 0; i < slats; i++) {
      const x = (i / slats) * w;
      const tone = 70 + Math.random() * 20;
      g.fillStyle = `rgb(${tone + 30},${tone},${tone - 30})`;
      g.fillRect(x, 0, w / slats - 6, h);
      g.fillStyle = '#120c08';
      g.fillRect(x + w / slats - 6, 0, 6, h);
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(5, 1);
  return tex;
}

function glowTexture(stops) {
  return canvasTexture(128, 128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    stops.forEach(([k, c]) => grad.addColorStop(k, c));
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }, false);
}

function beamAlphaTexture() {
  return canvasTexture(64, 64, (g, s) => {
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.5, '#555');
    grad.addColorStop(1, '#111');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }, false);
}

// Spotlight positions: one over the car's centre and a ring around it.
const SPOTS = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2) * SPOTS_R, Math.sin((i / 8) * Math.PI * 2) * SPOTS_R])];

// Environment for reflections on paint and glass, baked once through PMREM from unlit
// proxies (a lit bake into the half-float target goes black on some GPUs): the sunset sky,
// the sea, the ceiling's warm spotlights and a couple of long ceiling light strips.
export function createStudioEnvironment(renderer) {
  const env = new THREE.Scene();
  env.add(skyDome(30, 32));
  const sea = new THREE.Mesh(new THREE.CircleGeometry(30, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x281f3c }));
  sea.position.y = -4;
  env.add(sea);
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(ROOM_R, ROOM_R, CEILING, 32, 1, true, -SUN_AZ + Math.PI / 2 + GLASS_HALF, Math.PI * 2 - GLASS_HALF * 2),
    new THREE.MeshBasicMaterial({ color: 0x2a1d14, side: THREE.BackSide })
  );
  wall.position.y = CEILING / 2;
  env.add(wall);
  const ceiling = new THREE.Mesh(new THREE.CircleGeometry(ROOM_R, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0e0b09 }));
  ceiling.position.y = CEILING;
  env.add(ceiling);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ROOM_R, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0c0a08 }));
  floor.position.y = -0.01;
  env.add(floor);
  const lamp = (w, h, x, z, intensity, color = 0xffd2a0) => {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    mat.color.multiplyScalar(intensity);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(Math.PI / 2), mat);
    p.position.set(x, CEILING - 0.05, z);
    env.add(p);
  };
  for (const [x, z] of SPOTS) lamp(0.7, 0.7, x, z, 6);
  lamp(16, 0.5, 0, -2.6, 2.2);
  lamp(16, 0.5, 0, 2.6, 2.2);
  // The sun itself, so clear-coat picks up a hot highlight toward the sea.
  const sun = new THREE.Mesh(new THREE.CircleGeometry(2.2, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(8) }));
  sun.position.copy(SUN_DIR).multiplyScalar(26);
  sun.lookAt(0, 0, 0);
  env.add(sun);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.03);
  pmrem.dispose();
  env.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
  return target.texture;
}

export function createShowroom(scene) {
  const root = new THREE.Group();
  scene.add(root);

  // ---- Outside: sky, sun, clouds, headlands, ocean, terrace ----
  const outside = new THREE.Group();
  outside.add(skyDome(400), sunAndClouds(), headlands(260));
  const sea = ocean();
  outside.add(sea);
  const terrace = new THREE.Mesh(
    new THREE.RingGeometry(ROOM_R, ROOM_R + 7, 64, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x8a7563, roughness: 0.8 })
  );
  terrace.position.y = -0.03;
  outside.add(terrace);
  const balustrade = new THREE.Mesh(
    new THREE.TorusGeometry(ROOM_R + 6.8, 0.04, 6, 96).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1c1a19, metalness: 0.8, roughness: 0.35 })
  );
  balustrade.position.y = 1.0;
  outside.add(balustrade);
  root.add(outside);
  noReflect(sea, terrace, balustrade);

  // ---- Floor: mirror + epoxy tint on top (the tint also receives the car's shadow) ----
  const mirror = new Reflector(new THREE.CircleGeometry(ROOM_R, 64), {
    textureWidth: 1024,
    textureHeight: 1024,
    color: 0x9a8f86,
    clipBias: 0.003,
  });
  mirror.rotation.x = -Math.PI / 2;
  root.add(mirror);

  const tintMat = new THREE.MeshStandardMaterial({
    map: floorTexture(),
    transparent: true,
    roughness: 0.35,
    metalness: 0.0,
    envMapIntensity: 0.25,
  });
  const tint = new THREE.Mesh(new THREE.CircleGeometry(ROOM_R, 64), tintMat);
  tint.rotation.x = -Math.PI / 2;
  tint.position.y = 0.002;
  tint.receiveShadow = true;
  root.add(tint);
  noReflect(tint);

  // ---- Turntable with a glowing edge ring ----
  const turntable = new THREE.Group();
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(3.1, 3.15, 0.06, 96),
    new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 0.22, metalness: 0.85 })
  );
  deck.position.y = 0.03;
  deck.receiveShadow = true;
  turntable.add(deck);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff2a3a });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.13, 0.018, 8, 160), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.062;
  turntable.add(ring);
  root.add(turntable);

  // ---- Architecture: glass façade toward the sea, slatted timber wall behind ----
  // Three.js cylinders start at +z and run toward +x; map the sun's azimuth to that.
  const glassStart = -SUN_AZ + Math.PI / 2 - GLASS_HALF;
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(ROOM_R - 0.05, ROOM_R - 0.05, CEILING, 64, 1, true, glassStart, GLASS_HALF * 2),
    new THREE.MeshStandardMaterial({ color: 0x8fa6b8, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.08, envMapIntensity: 1.2, side: THREE.DoubleSide, depthWrite: false })
  );
  glass.position.y = CEILING / 2;
  glass.renderOrder = 3;
  root.add(glass);

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x15130f, metalness: 0.7, roughness: 0.4 });
  const frames = [];
  const mullions = 15;
  for (let i = 0; i <= mullions; i++) {
    const a = glassStart + (i / mullions) * GLASS_HALF * 2;
    // CylinderGeometry angle a sits at (sin a, cos a) in (x, z).
    frames.push(new THREE.BoxGeometry(0.09, CEILING, 0.14).rotateY(a).translate(Math.sin(a) * ROOM_R, CEILING / 2, Math.cos(a) * ROOM_R));
  }
  for (const y of [0.04, CEILING - 0.1]) {
    frames.push(new THREE.CylinderGeometry(ROOM_R, ROOM_R, 0.16, 64, 1, true, glassStart, GLASS_HALF * 2).translate(0, y, 0));
  }
  root.add(new THREE.Mesh(mergeGeometries(frames.map((g) => (g.index ? g.toNonIndexed() : g))), frameMat));

  const wallStart = glassStart + GLASS_HALF * 2;
  const wallLen = Math.PI * 2 - GLASS_HALF * 2;
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(ROOM_R, ROOM_R, CEILING, 48, 1, true, wallStart, wallLen),
    new THREE.MeshStandardMaterial({ map: slatTexture(), color: 0xb08a68, roughness: 0.75, side: THREE.BackSide })
  );
  wall.position.y = CEILING / 2;
  root.add(wall);
  // Warm LED coves along the wall's base and top.
  const coveMat = new THREE.MeshBasicMaterial({ color: 0xffb070, toneMapped: false });
  const coves = [0.12, CEILING - 0.25].map((y) => new THREE.CylinderGeometry(ROOM_R - 0.08, ROOM_R - 0.08, 0.05, 48, 1, true, wallStart, wallLen).translate(0, y, 0));
  root.add(new THREE.Mesh(mergeGeometries(coves), coveMat));

  // ---- Ceiling: dark slab, a cove ring and recessed warm spotlights ----
  const ceiling = new THREE.Mesh(
    new THREE.CircleGeometry(ROOM_R, 64).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.9 })
  );
  ceiling.position.y = CEILING;
  root.add(ceiling);
  const fixtureMat = new THREE.MeshBasicMaterial({ color: 0xffd9a8, toneMapped: false });
  const fixtures = [];
  for (const [x, z] of SPOTS) fixtures.push(new THREE.CircleGeometry(0.22, 20).rotateX(Math.PI / 2).translate(x, CEILING - 0.01, z));
  fixtures.push(new THREE.TorusGeometry(SPOTS_R + 1.6, 0.03, 4, 96).rotateX(Math.PI / 2).translate(0, CEILING - 0.02, 0));
  root.add(new THREE.Mesh(mergeGeometries(fixtures.map((g) => g.toNonIndexed())), fixtureMat));

  // Light shafts and floor pools from every spotlight (one mesh each, shared fades).
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffd2a0,
    alphaMap: beamAlphaTexture(),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beams = SPOTS.map(([x, z], i) =>
    new THREE.CylinderGeometry(0.2, i === 0 ? 2.6 : 1.5, CEILING, 24, 1, true).translate(x * 0.92, CEILING / 2, z * 0.92)
  );
  const shafts = new THREE.Mesh(mergeGeometries(beams), beamMat);
  root.add(shafts);

  const poolTex = glowTexture([[0, '#fff'], [0.5, '#6a6a6a'], [1, '#000']]);
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0xffc58a,
    alphaMap: poolTex,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const pools = new THREE.Mesh(
    mergeGeometries(SPOTS.map(([x, z], i) => new THREE.PlaneGeometry(i === 0 ? 9 : 3.6, i === 0 ? 9 : 3.6).rotateX(-Math.PI / 2).translate(x * 0.85, 0.004, z * 0.85))),
    poolMat
  );
  pools.renderOrder = 2;
  root.add(pools);
  noReflect(pools);
  // Sunset light spilling across the floor from the façade.
  const spillMat = new THREE.MeshBasicMaterial({
    color: 0xff9a55,
    alphaMap: poolTex,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(16, 7).rotateX(-Math.PI / 2), spillMat);
  spill.position.set(SUN_DIR.x * 7, 0.005, SUN_DIR.z * 7);
  spill.rotation.y = -Math.atan2(SUN_DIR.z, SUN_DIR.x) + Math.PI / 2;
  spill.renderOrder = 2;
  root.add(spill);
  noReflect(spill);

  // ---- Lighting ----
  const hemi = new THREE.HemisphereLight(0xffc8a8, 0x2a1a14, 0.45);
  root.add(hemi);

  const key = new THREE.DirectionalLight(0xffe4c4, 0);
  key.position.set(1.2, 9, 2.4);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.left = -3.4;
  key.shadow.camera.right = 3.4;
  key.shadow.camera.top = 3.4;
  key.shadow.camera.bottom = -3.4;
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 16;
  root.add(key, key.target);

  // Low sun through the glass: a warm rim on the car's sea side (no shadow map).
  const sunLight = new THREE.DirectionalLight(0xff9450, 0);
  sunLight.position.copy(SUN_DIR).multiplyScalar(20);
  root.add(sunLight);

  let time = 0;
  let powerUp = 0; // 0..1 intro: lights switch on in sequence

  return {
    turntable,
    mirror,
    // Gives the mirror's camera (cloned from `camera`) only the reflected layer.
    bindCamera(camera) {
      camera.layers.enable(NO_REFLECT);
      mirror.getReflectionCamera(camera).layers.set(0);
    },
    setQuality({ reflections, reflectionScale, shadows }, width, height) {
      mirror.visible = reflections;
      // Without the mirror the epoxy is opaque and relies on the env map for its gloss.
      if (tintMat.transparent !== reflections) {
        tintMat.transparent = reflections;
        tintMat.needsUpdate = true;
      }
      tintMat.roughness = reflections ? 0.35 : 0.14;
      tintMat.envMapIntensity = reflections ? 0.25 : 0.85;
      if (reflections) mirror.getRenderTarget().setSize(Math.round(width * reflectionScale), Math.round(height * reflectionScale));
      key.castShadow = shadows;
    },
    update(dt) {
      time += dt;
      powerUp = Math.min(1, powerUp + dt * 0.6);
      const step = (start) => THREE.MathUtils.smoothstep(powerUp, start, start + 0.25);
      sea.material.uniforms.time.value = time;

      key.intensity = 2.6 * step(0.0);
      sunLight.intensity = 1.5;
      poolMat.opacity = 0.2 * step(0.0);
      beamMat.opacity = 0.035 * step(0.05);
      fixtureMat.color.setRGB(1, 0.85, 0.66).multiplyScalar(0.25 + 2.2 * step(0.0));
      spillMat.opacity = 0.12;
      hemi.intensity = 0.25 + 0.2 * step(0.2);
      coveMat.color.setRGB(1, 0.69, 0.44).multiplyScalar(0.2 + 1.3 * step(0.4));
      ringMat.color.setRGB(1, 0.16, 0.23).multiplyScalar(2.2 * step(0.5) * (0.85 + 0.15 * Math.sin(time * 2.2)));
    },
  };
}
