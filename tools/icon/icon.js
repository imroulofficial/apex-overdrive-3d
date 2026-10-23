import * as THREE from 'three';
import { loadCar } from '../../src/assets/modelLoader.js';
import { carById } from '../../src/data/cars.js';

// Renders the launcher icon at 1024 px: a bright daytime race track streaking past in motion
// blur, the Valkyrie GT-R in crimson metallic coming at a low 3/4 front camera (razor sharp,
// wheels spinning), and APEX / OVERDRIVE action type across the sky.
//
// Three layers are composed in 2D: the sky (gradient + clouds, crisp), the track (a 3D render
// zoom-blurred toward its vanishing point far down the road), and the car (a separate
// transparent 3D render with its contact shadow, averaged over a few wheel angles so only the
// wheels blur). The shot is composed twice: `wide` fills the whole 108 dp adaptive canvas (the
// background layer; launchers crop 18 dp per side) and `tight` frames the visible 72 dp for
// the legacy, round and Play Store icons. The type sits in the 72 dp area of both. The
// adaptive foreground layer is left transparent, since everything belongs in one picture.
// window.__icon resolves to { background, foreground, legacy, round, store } data URLs.

const S = 1024;
const DEG = Math.PI / 180;
const VISIBLE = 72 / 108;
const rand = (() => {
  let s = 11;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
})();

const canvas = (w = S, h = S) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
const texture = (c, repeat) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
};

// ---------------------------------------------------------------------------
// Sky (2D): deep blue overhead to a pale horizon, soft white cumulus in the upper third.
// ---------------------------------------------------------------------------
function paintSky(horizonY) {
  const c = canvas();
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, horizonY);
  grad.addColorStop(0, '#1f6fd6');
  grad.addColorStop(0.55, '#4f9be8');
  grad.addColorStop(1, '#cfe6fb');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  // Clouds: clusters of soft puffs, white on top, faintly blue-grey underneath.
  const puff = (x, y, r, a) => {
    const p = g.createRadialGradient(x, y - r * 0.2, 0, x, y, r);
    p.addColorStop(0, `rgba(255,255,255,${a})`);
    p.addColorStop(0.6, `rgba(250,252,255,${a * 0.75})`);
    p.addColorStop(1, 'rgba(235,242,252,0)');
    g.fillStyle = p;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (const [cx, cy, w] of [[0.16, 0.13, 0.34], [0.62, 0.08, 0.42], [0.9, 0.24, 0.3], [0.38, 0.3, 0.26], [0.05, 0.36, 0.22]]) {
    for (let i = 0; i < 26; i++) {
      const x = (cx + (rand() - 0.5) * w) * S;
      const y = (cy + (rand() - 0.5) * w * 0.22 - Math.abs(rand() - 0.5) * 0.04) * S;
      puff(x, y, (0.035 + rand() * 0.055) * S, 0.55 + rand() * 0.35);
    }
  }
  return c;
}

// The same sky as a dome for paint reflections (bright horizon, darker tarmac below).
function skyDome() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(200, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vDir; void main() {
        float h = vDir.y;
        vec3 sky = mix(vec3(0.72, 0.85, 0.98), vec3(0.12, 0.42, 0.85), smoothstep(0.0, 0.6, h));
        vec3 ground = mix(vec3(0.22, 0.24, 0.26), vec3(0.06, 0.06, 0.07), smoothstep(0.0, -0.4, h));
        vec3 col = h > 0.0 ? sky : ground;
        col += vec3(1.0, 0.95, 0.85) * pow(max(dot(vDir, normalize(vec3(0.4, 0.6, 0.7))), 0.0), 200.0) * 6.0;
        gl_FragColor = vec4(col, 1.0); }`,
    })
  );
}

// ---------------------------------------------------------------------------
// Track (3D): tarmac, kerbs, grass, concrete walls with coloured panels, catch fence,
// a grandstand, trees and hills. The road runs along x; the car drives toward +x.
// ---------------------------------------------------------------------------
function tarmacTexture() {
  const c = canvas(512, 512);
  const g = c.getContext('2d');
  const img = g.createImageData(512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 46 + rand() * 30;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v + 3;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return texture(c, [60, 4]);
}

function stripes(colors, n = 8, w = 256, h = 32) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length];
    g.fillRect((i * w) / n, 0, w / n + 1, h);
  }
  return c;
}

function track() {
  const group = new THREE.Group();
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  const half = 7;
  add(new THREE.PlaneGeometry(600, half * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tarmacTexture(), roughness: 0.85 }), -200, 0, 0);
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
  for (const z of [-half + 0.35, half - 0.35]) add(new THREE.PlaneGeometry(600, 0.22).rotateX(-Math.PI / 2), white, -200, 0.005, z);
  for (let i = -60; i < 4; i++) add(new THREE.PlaneGeometry(3, 0.18).rotateX(-Math.PI / 2), white, i * 7, 0.005, 0);
  // Red and white kerbs.
  const kerbTex = texture(stripes(['#d61a1a', '#f4f4f4'], 2, 64, 8), [150, 1]);
  for (const z of [-half - 0.6, half + 0.6]) add(new THREE.BoxGeometry(600, 0.08, 1.2), new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.55 }), -200, 0.04, z);
  // Grass verges.
  const grass = new THREE.MeshStandardMaterial({ color: 0x4f9a35, roughness: 1 });
  for (const s of [-1, 1]) add(new THREE.PlaneGeometry(600, 40).rotateX(-Math.PI / 2), grass, -200, -0.01, s * (half + 21));
  // Concrete walls with coloured panels, catch fence above the far one.
  const wallTex = texture(stripes(['#1d5fd0', '#f5f5f5', '#e0262b', '#f5f5f5', '#ffc61a', '#f5f5f5'], 6, 384, 32), [50, 1]);
  const wall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7 });
  for (const z of [-half - 5, half + 6]) add(new THREE.BoxGeometry(600, 1.1, 0.4), wall, -200, 0.55, z);
  const post = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.6, roughness: 0.4 });
  for (let i = -80; i < 6; i++) add(new THREE.BoxGeometry(0.1, 3.2, 0.1), post, i * 4, 2.7, -half - 5);
  const fence = new THREE.MeshStandardMaterial({ color: 0xb8c2cc, transparent: true, opacity: 0.25, roughness: 0.6, side: THREE.DoubleSide });
  add(new THREE.PlaneGeometry(600, 3), fence, -200, 2.7, -half - 5);
  // Grandstand on the far side: stepped tiers dotted with crowd colours, roof on pillars.
  const crowd = canvas(512, 128);
  const cg = crowd.getContext('2d');
  cg.fillStyle = '#5b6470';
  cg.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 2600; i++) {
    cg.fillStyle = `hsl(${rand() * 360}, ${40 + rand() * 50}%, ${40 + rand() * 40}%)`;
    cg.fillRect(rand() * 512, rand() * 128, 2, 2);
  }
  const stand = new THREE.MeshStandardMaterial({ map: texture(crowd, [8, 1]), roughness: 0.9 });
  for (let t = 0; t < 6; t++) add(new THREE.BoxGeometry(160, 1.2, 2), stand, -150, 1 + t * 1.2, -half - 22 - t * 2);
  add(new THREE.BoxGeometry(160, 0.4, 14), new THREE.MeshStandardMaterial({ color: 0xf4f6f8, emissive: 0x8a96a4, roughness: 0.5 }), -150, 9.5, -half - 27);
  for (let i = 0; i < 12; i++) add(new THREE.BoxGeometry(0.4, 9, 0.4), post, -225 + i * 14, 4.5, -half - 33);
  // Trees behind the near wall and beyond the stand, hills on the horizon.
  const leaf = [0x2f6f2a, 0x3d8433, 0x285c24].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
  for (let i = 0; i < 70; i++) {
    const near = i < 40;
    const x = near ? -260 + rand() * 280 : -90 + rand() * 80;
    const z = near ? half + 12 + rand() * 18 : -half - 30 - rand() * 25;
    const r = 1.6 + rand() * 2.2;
    add(new THREE.SphereGeometry(r, 10, 8), leaf[i % 3], x, r * 1.4 + 1, z);
    add(new THREE.CylinderGeometry(0.2, 0.25, 2), new THREE.MeshStandardMaterial({ color: 0x5a3f2a }), x, 1, z);
  }
  const hill = new THREE.MeshStandardMaterial({ color: 0x7fa8a0, roughness: 1 });
  for (let i = 0; i < 8; i++) {
    const m = add(new THREE.SphereGeometry(40 + rand() * 30, 16, 8), hill, -330 + rand() * 40, -18, -160 + i * 45);
    m.scale.y = 0.6;
  }
  return group;
}

// ---------------------------------------------------------------------------
// Camera: low 3/4 front, looking up a little so the car fills the lower 60% and the sky the
// top. `visible` 1 frames the whole 108 dp canvas, VISIBLE the 72 dp crop of the same shot.
// ---------------------------------------------------------------------------
function camera(visible) {
  const fov = 44;
  const cam = new THREE.PerspectiveCamera(2 * Math.atan(Math.tan((fov / 2) * DEG) * visible) / DEG, 1, 0.1, 800);
  cam.position.set(6.6, 0.85, 3.9);
  cam.lookAt(new THREE.Vector3(0.85, 1.5, 0.45));
  return cam;
}

// Zoom blur toward the vanishing point: the frame redrawn slightly scaled about it many times.
function zoomBlur(src, vx, vy, amount, steps = 28) {
  const out = canvas();
  const g = out.getContext('2d');
  g.drawImage(src, 0, 0);
  for (let i = 1; i <= steps; i++) {
    const k = 1 + (amount * i) / steps;
    g.globalAlpha = 1 / (i + 1);
    g.setTransform(k, 0, 0, k, vx * (1 - k), vy * (1 - k));
    g.drawImage(src, 0, 0);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  return out;
}

// ---------------------------------------------------------------------------
// Type: APEX (clean, heavy, letter-spaced) over a huge italic OVERDRIVE with a thick outline
// and drop shadow. Drawn in the 72 dp frame; `scale` maps it into the wider adaptive frame.
// ---------------------------------------------------------------------------
const FONT = "'Inter', 'Inter Display', 'Arial Black', system-ui, sans-serif";
function drawType(g, scale = 1) {
  g.save();
  g.translate(S / 2, S / 2);
  g.scale(scale, scale);
  g.translate(-S / 2, -S / 2);
  g.lineJoin = 'round';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';

  // OVERDRIVE: fitted to 84% of the width (clear of round masks), skewed past the italic.
  let size = 220;
  g.font = `italic 900 ${size}px ${FONT}`;
  size *= (S * 0.84) / g.measureText('OVERDRIVE').width;
  const y2 = S * 0.385;
  g.save();
  g.translate(S / 2, y2);
  g.transform(1, 0, -0.12, 1, 0, 0);
  g.font = `italic 900 ${size}px ${FONT}`;
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = size * 0.12;
  g.shadowOffsetY = size * 0.07;
  g.lineWidth = size * 0.16;
  g.strokeStyle = '#0b0c10';
  g.strokeText('OVERDRIVE', 0, 0);
  g.shadowColor = 'transparent';
  const fill = g.createLinearGradient(0, -size * 0.75, 0, 0);
  fill.addColorStop(0, '#ffffff');
  fill.addColorStop(0.55, '#f1f3f6');
  fill.addColorStop(1, '#c9ced6');
  g.fillStyle = fill;
  g.fillText('OVERDRIVE', 0, 0);
  g.restore();

  // APEX: brand red, letter-spaced, with the same dark outline.
  const a = size * 0.92;
  g.save();
  g.translate(S / 2, y2 - size * 0.86);
  g.transform(1, 0, -0.12, 1, 0, 0);
  g.font = `italic 900 ${a}px ${FONT}`;
  g.letterSpacing = `${a * 0.06}px`;
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = a * 0.1;
  g.shadowOffsetY = a * 0.06;
  g.lineWidth = a * 0.15;
  g.strokeStyle = '#0b0c10';
  g.strokeText('APEX', 0, 0);
  g.shadowColor = 'transparent';
  const red = g.createLinearGradient(0, -a * 0.75, 0, 0);
  red.addColorStop(0, '#ff4a4a');
  red.addColorStop(1, '#c80f1c');
  g.fillStyle = red;
  g.fillText('APEX', 0, 0);
  g.restore();
  g.restore();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(S, S, false);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);

const envScene = new THREE.Scene();
envScene.add(skyDome());
const env = new THREE.PMREMGenerator(renderer).fromScene(envScene, 0.02).texture;

const sunDir = new THREE.Vector3(4, 7, 6).normalize();
const lights = () => {
  const sun = new THREE.DirectionalLight(0xfff4e2, 3.2);
  sun.position.copy(sunDir).multiplyScalar(30);
  return [sun, new THREE.HemisphereLight(0xbfdcff, 0x3a4a2a, 0.9)];
};

const trackScene = new THREE.Scene();
trackScene.environment = env;
trackScene.environmentIntensity = 0.7;
trackScene.fog = new THREE.Fog(0xcfe0f2, 120, 420);
trackScene.add(track(), ...lights());

const carScene = new THREE.Scene();
carScene.environment = env;
carScene.environmentIntensity = 1.25;
const def = carById('rpx-hyperion');
const car = await loadCar({ ...def, model: { ...def.model, url: `/${def.model.url}` } }, { paintColor: '#c00a1c', finish: 'gloss' });
car.setLights(true);
for (let i = 0; i < 60; i++) car.update(1 / 30);
car.group.traverse((o) => {
  if (o.name === 'beam') o.visible = false;
  if (o.isMesh) o.castShadow = true;
});
car.group.rotation.y = 6 * DEG; // nose turned slightly toward the camera
carScene.add(car.group);
const [sun, hemi] = lights();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 60 });
sun.shadow.radius = 4;
const rim = new THREE.DirectionalLight(0xffffff, 1.4);
rim.position.set(-6, 3, -4);
carScene.add(sun, hemi, rim);
const catcher = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.55 }));
catcher.receiveShadow = true;
carScene.add(catcher);
// Soft ambient contact shadow under the body.
const blob = canvas(128, 128);
const bg = blob.getContext('2d');
const br = bg.createRadialGradient(64, 64, 0, 64, 64, 64);
br.addColorStop(0, 'rgba(0,0,0,0.75)');
br.addColorStop(1, 'rgba(0,0,0,0)');
bg.fillStyle = br;
bg.fillRect(0, 0, 128, 128);
const contact = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: texture(blob), transparent: true, depthWrite: false }));
contact.position.y = 0.01;
contact.rotation.y = car.group.rotation.y;
carScene.add(contact);

function snapshot() {
  const c = canvas();
  c.getContext('2d').drawImage(renderer.domElement, 0, 0);
  return c;
}

async function shot(visible) {
  const cam = camera(visible);
  // Vanishing point far down the road, for the track's zoom blur.
  cam.updateMatrixWorld();
  const vp = new THREE.Vector3(-400, 0, 0).project(cam);
  const vx = (vp.x * 0.5 + 0.5) * S;
  const vy = (-vp.y * 0.5 + 0.5) * S;
  await renderer.compileAsync(trackScene, cam);
  renderer.render(trackScene, cam);
  renderer.render(trackScene, cam);
  // Only the track blurs (its render is transparent where the sky shows); the sky stays crisp.
  const blurred = paintSky(vy);
  blurred.getContext('2d').drawImage(zoomBlur(snapshot(), vx, vy, 0.22), 0, 0);

  // The car, sharp, averaged over a few wheel angles so the wheels read as spinning.
  await renderer.compileAsync(carScene, cam);
  const carLayer = canvas();
  const cg = carLayer.getContext('2d');
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    car.wheels.forEach(({ spin }) => (spin.rotation.z = -i * 0.07));
    renderer.render(carScene, cam);
    cg.globalAlpha = 1 / (i + 1);
    cg.drawImage(snapshot(), 0, 0);
  }

  const out = canvas();
  const g = out.getContext('2d');
  g.drawImage(blurred, 0, 0);
  g.drawImage(carLayer, 0, 0);
  // Gentle vignette to hold the eye on the car and type.
  const v = g.createRadialGradient(S / 2, S * 0.55, S * 0.35, S / 2, S * 0.55, S * 0.8);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = v;
  g.fillRect(0, 0, S, S);
  drawType(g, visible === 1 ? VISIBLE : 1);
  return out;
}

function mask(src, shape) {
  const c = canvas();
  const g = c.getContext('2d');
  g.beginPath();
  if (shape === 'circle') g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  else if (shape === 'rounded') g.roundRect(0, 0, S, S, S * 0.18);
  else g.rect(0, 0, S, S);
  g.clip();
  g.drawImage(src, 0, 0);
  return c;
}

await document.fonts.load(`italic 900 100px ${FONT}`);
const wide = await shot(1);
const tight = await shot(VISIBLE);

const result = {
  background: wide,
  foreground: canvas(),
  legacy: mask(tight, 'rounded'),
  round: mask(tight, 'circle'),
  store: mask(tight, 'square'),
};
Object.values(result).forEach((c) => document.body.appendChild(c));

// Legacy (pre-Android 12) launch splash: black with the rounded icon and the studio line.
// Android 12+ shows the adaptive icon on black instead (styles.xml).
window.__splash = (w, h) => {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  const m = Math.min(w, h);
  const glow = g.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, m * 0.6);
  glow.addColorStop(0, 'rgba(120, 10, 24, 0.5)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  const d = m * 0.56;
  g.drawImage(result.legacy, (w - d) / 2, h * 0.45 - d / 2, d, d);
  g.font = `600 ${Math.round(m * 0.026)}px system-ui, sans-serif`;
  g.fillStyle = '#9aa3b2';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('R E D   P E N   S T U D I O', w / 2, h * 0.45 + d / 2 + m * 0.07);
  return c.toDataURL('image/png');
};
window.__icon = Object.fromEntries(Object.entries(result).map(([k, c]) => [k, c.toDataURL('image/png')]));
