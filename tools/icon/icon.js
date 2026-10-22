import * as THREE from 'three';
import { loadCar } from '../../src/assets/modelLoader.js';
import { carById } from '../../src/data/cars.js';
import { createStudioEnvironment } from '../../src/garage/showroom.js';

// Renders the launcher icon layers at 1024 px:
//   background: carbon-fibre weave under a crimson diagonal glow and speed streaks
//   foreground: the Valkyrie GT-R in crimson, low 3/4 front view, with a cyan nitro trail,
//               kept inside the adaptive-icon safe zone (66/108 of the canvas)
// window.__icon resolves to { background, foreground, legacy, round, store } data URLs.

const S = 1024;

function background() {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#07080b';
  g.fillRect(0, 0, S, S);
  // 2x2 twill carbon weave.
  const cell = 14;
  for (let y = 0; y < S; y += cell) {
    for (let x = 0; x < S; x += cell) {
      const k = ((x / cell + Math.floor(y / cell)) >> 1) % 2;
      const grad = k
        ? g.createLinearGradient(x, y, x + cell, y)
        : g.createLinearGradient(x, y, x, y + cell);
      grad.addColorStop(0, '#0c0d11');
      grad.addColorStop(0.5, k ? '#22252c' : '#1a1c22');
      grad.addColorStop(1, '#0c0d11');
      g.fillStyle = grad;
      g.fillRect(x + 1, y + 1, cell - 2, cell - 2);
    }
  }
  // Crimson glow sweeping from the lower left, cyan kiss at the top right.
  let rad = g.createRadialGradient(S * 0.3, S * 0.78, 0, S * 0.3, S * 0.78, S * 0.75);
  rad.addColorStop(0, 'rgba(230, 20, 45, 0.85)');
  rad.addColorStop(0.45, 'rgba(150, 8, 28, 0.45)');
  rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, S, S);
  rad = g.createRadialGradient(S * 0.85, S * 0.15, 0, S * 0.85, S * 0.15, S * 0.5);
  rad.addColorStop(0, 'rgba(0, 220, 255, 0.35)');
  rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, S, S);
  // Diagonal speed streaks.
  g.save();
  g.translate(S / 2, S / 2);
  g.rotate(-0.42);
  for (let i = 0; i < 26; i++) {
    const y = -S * 0.7 + i * 57 + ((i * 37) % 23);
    const len = S * (0.25 + ((i * 53) % 40) / 100);
    const x = -S * 0.8 + ((i * 131) % 700);
    const lg = g.createLinearGradient(x, 0, x + len, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(1, i % 3 === 0 ? 'rgba(80,230,255,0.22)' : 'rgba(255,90,100,0.16)');
    g.fillStyle = lg;
    g.fillRect(x, y, len, 3 + (i % 3) * 2);
  }
  g.restore();
  // Vignette.
  rad = g.createRadialGradient(S / 2, S / 2, S * 0.35, S / 2, S / 2, S * 0.75);
  rad.addColorStop(0, 'rgba(0,0,0,0)');
  rad.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = rad;
  g.fillRect(0, 0, S, S);
  return c;
}

async function foreground() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(S, S, false);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.environment = createStudioEnvironment(renderer);
  scene.environmentIntensity = 1.2;

  // The Valkyrie GT-R's showroom model; its url is made absolute because this page is not
  // served from the game's base path.
  const def = carById('rpx-hyperion');
  const car = await loadCar({ ...def, model: { ...def.model, url: `/${def.model.url}` } }, { paintColor: '#d0102c', finish: 'metallic' });
  car.setLights(true);
  for (let i = 0; i < 60; i++) car.update(1 / 30);
  car.group.traverse((o) => {
    if (o.name === 'beam') o.visible = false;
  });
  scene.add(car.group);

  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(4, 8, 6);
  const rimCyan = new THREE.DirectionalLight(0x38e0ff, 3.5);
  rimCyan.position.set(-6, 2.5, -4);
  const rimRed = new THREE.DirectionalLight(0xff4050, 0.7);
  rimRed.position.set(-2, 1.5, 7);
  scene.add(key, rimCyan, rimRed, new THREE.HemisphereLight(0x8fb0ff, 0x200a0a, 0.4));

  // Cyan nitro trail: additive cones from the exhausts plus streaks along the flanks.
  const flame = new THREE.MeshBasicMaterial({ color: 0x3ad8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  for (const at of car.exhausts) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 2.2, 16, 1, true).rotateZ(Math.PI / 2).translate(-1.1, 0, 0), flame);
    cone.position.copy(at);
    scene.add(cone);
  }
  const streakMat = new THREE.MeshBasicMaterial({ color: 0x5ae6ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  for (const [y, z, len] of [[0.25, 1.15, 5], [0.55, -1.2, 4.2], [0.95, 1.05, 3.4], [0.15, -0.9, 3.8]]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.05), streakMat);
    s.position.set(-2.4 - len / 2, y, z);
    scene.add(s);
  }
  // Soft cyan underglow.
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 2.8).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: glowTex, color: 0x20c8ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  );
  glow.position.y = 0.01;
  scene.add(glow);

  // Low, aggressive 3/4 front view; the car spans the adaptive-icon safe zone.
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  const target = new THREE.Vector3(0.1, 0.5, 0);
  camera.position.copy(target).add(new THREE.Vector3(6.4, 1.7, 5.6).normalize().multiplyScalar(14.6));
  camera.lookAt(target);
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  const out = document.createElement('canvas');
  out.width = out.height = S;
  out.getContext('2d').drawImage(renderer.domElement, 0, 0);
  return out;
}

function compose(bg, fg, { mask, fgScale = 1 }) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.save();
  g.beginPath();
  if (mask === 'circle') g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  else if (mask === 'rounded') g.roundRect(0, 0, S, S, S * 0.18);
  else g.rect(0, 0, S, S);
  g.clip();
  g.drawImage(bg, 0, 0);
  const d = S * fgScale;
  g.drawImage(fg, (S - d) / 2, (S - d) / 2, d, d);
  g.restore();
  return c;
}

const bg = background();
const fg = await foreground();
const show = (c) => document.body.appendChild(c);
const result = {
  background: bg,
  foreground: fg,
  // Legacy icons show the full layers; adaptive ones crop 18/108 per side, so the legacy
  // and store versions zoom the foreground to the same apparent size.
  legacy: compose(bg, fg, { mask: 'rounded', fgScale: 108 / 72 }),
  round: compose(bg, fg, { mask: 'circle', fgScale: 108 / 72 }),
  store: compose(bg, fg, { mask: 'square', fgScale: 108 / 72 }),
};
Object.values(result).forEach(show);

// Legacy (pre-Android 12) launch splash: black, the hypercar and the wordmark, matching the
// in-game splash. Android 12+ shows the adaptive icon on black instead (styles.xml).
window.__splash = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  const m = Math.min(w, h);
  const glow = g.createRadialGradient(w / 2, h * 0.46, 0, w / 2, h * 0.46, m * 0.6);
  glow.addColorStop(0, 'rgba(120, 10, 24, 0.55)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  const d = m * 0.72;
  g.drawImage(fg, (w - d) / 2, h * 0.44 - d / 2, d, d);
  const size = Math.round(m * 0.075);
  g.font = `italic 900 ${size}px system-ui, 'Segoe UI', Roboto, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const y = h * 0.44 + d * 0.3;
  const apex = 'APEX ';
  const word = 'OVERDRIVE';
  const total = g.measureText(apex + word).width;
  g.textAlign = 'left';
  g.fillStyle = '#ff2a3a';
  g.fillText(apex, w / 2 - total / 2, y);
  g.fillStyle = '#f2f4f8';
  g.fillText(word, w / 2 - total / 2 + g.measureText(apex).width, y);
  g.font = `600 ${Math.round(size * 0.32)}px system-ui, sans-serif`;
  g.fillStyle = '#9aa3b2';
  g.textAlign = 'center';
  g.fillText('R E D   P E N   S T U D I O', w / 2, y + size * 0.95);
  return c.toDataURL('image/png');
};
window.__icon = Object.fromEntries(Object.entries(result).map(([k, c]) => [k, c.toDataURL('image/png')]));
