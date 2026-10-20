import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

// The garage showroom: mirror floor, turntable, LED-lit walls and animated spotlights.

function canvasTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Glossy floor tint laid over the mirror: dark in the distance, clearer near the car,
// with faint tile seams so the reflection reads as polished concrete rather than water.
function floorTexture() {
  return canvasTexture(1024, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(18,20,26,0.55)');
    grad.addColorStop(0.45, 'rgba(10,11,15,0.78)');
    grad.addColorStop(1, 'rgba(4,5,8,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(255,255,255,0.035)';
    g.lineWidth = 2;
    const tiles = 16;
    for (let i = 1; i < tiles; i++) {
      const p = (i / tiles) * s;
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, s);
      g.moveTo(0, p);
      g.lineTo(s, p);
      g.stroke();
    }
  });
}

function beamAlphaTexture() {
  return canvasTexture(64, (g, s) => {
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.5, '#555');
    grad.addColorStop(1, '#111');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

// Environment used for reflections on paint and glass: a dark studio with long softbox
// strips. Rendered once through PMREM, entirely offline.
export function createStudioEnvironment(renderer) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(30, 12, 30),
    new THREE.MeshBasicMaterial({ color: 0x07080b, side: THREE.BackSide })
  );
  env.add(room);
  const softbox = (w, h, x, y, z, rx, ry, intensity, color = 0xffffff) => {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    mat.color.multiplyScalar(intensity);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    p.position.set(x, y, z);
    p.rotation.set(rx, ry, 0);
    env.add(p);
  };
  for (const z of [-3, 0, 3]) softbox(18, 0.9, 0, 5.8, z, Math.PI / 2, 0, 6);
  softbox(10, 3, 0, 3, -14.5, 0, 0, 2.2);
  softbox(10, 3, 0, 3, 14.5, 0, Math.PI, 1.6);
  softbox(3, 6, 14.5, 3, 0, 0, -Math.PI / 2, 1.4, 0xffd9c0);
  softbox(3, 6, -14.5, 3, 0, 0, Math.PI / 2, 1.4, 0xc0d8ff);
  softbox(30, 0.25, 0, 0.6, -14.8, 0, 0, 3, 0xff2a2a);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.035);
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

  // Mirror floor + glossy tint on top (the tint also receives the car's shadow).
  const floorSize = 60;
  const mirror = new Reflector(new THREE.CircleGeometry(floorSize / 2, 64), {
    textureWidth: 1024,
    textureHeight: 1024,
    color: 0x8a8f99,
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
  const tint = new THREE.Mesh(new THREE.CircleGeometry(floorSize / 2, 64), tintMat);
  tint.rotation.x = -Math.PI / 2;
  tint.position.y = 0.002;
  tint.receiveShadow = true;
  root.add(tint);

  // Turntable with a glowing edge ring.
  const turntable = new THREE.Group();
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(3.1, 3.15, 0.06, 96),
    new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.25, metalness: 0.8 })
  );
  deck.position.y = 0.03;
  deck.receiveShadow = true;
  turntable.add(deck);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff2a3a });
  ringMat.color.multiplyScalar(2.2);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.13, 0.018, 8, 160), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.062;
  turntable.add(ring);
  root.add(turntable);

  // Back walls with vertical LED strips.
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(18, 18, 12, 64, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.9, side: THREE.BackSide })
  );
  wall.position.y = 6;
  root.add(wall);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  ledMat.color.multiplyScalar(1.6);
  const accentMat = new THREE.MeshBasicMaterial({ color: 0xff2a3a });
  accentMat.color.multiplyScalar(1.8);
  const strips = 18;
  for (let i = 0; i < strips; i++) {
    const a = (i / strips) * Math.PI * 2;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 5.5, 0.08), i % 3 === 0 ? accentMat : ledMat);
    strip.position.set(Math.cos(a) * 17.8, 3.4, Math.sin(a) * 17.8);
    root.add(strip);
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.05, 8, 120), ledMat);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 6.5;
  root.add(halo);

  // Lighting: soft fill, one shadow-casting key spot and two coloured rim spots that sweep.
  const hemi = new THREE.HemisphereLight(0x9fb4ff, 0x120a0a, 0.35);
  root.add(hemi);

  const key = new THREE.SpotLight(0xffffff, 0, 30, 0.42, 0.55, 1.2);
  key.position.set(1.5, 9, 3);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 16;
  root.add(key, key.target);

  const rims = [
    { light: new THREE.SpotLight(0xff3b4a, 0, 26, 0.32, 0.7, 1.3), phase: 0 },
    { light: new THREE.SpotLight(0x4aa8ff, 0, 26, 0.32, 0.7, 1.3), phase: Math.PI },
  ];
  rims.forEach(({ light }) => {
    light.target.position.set(0, 0.5, 0);
    root.add(light, light.target);
  });

  // Visible light shafts for the key light.
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    alphaMap: beamAlphaTexture(),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shaftDir = key.position.clone().normalize();
  const shaftLen = key.position.length();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 3.6, shaftLen, 48, 1, true), beamMat);
  shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), shaftDir);
  shaft.position.copy(key.position).multiplyScalar(0.5);
  root.add(shaft);

  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.45, 0.4, 24),
    new THREE.MeshStandardMaterial({ color: 0x1a1b20, metalness: 0.8, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0 })
  );
  lamp.position.copy(key.position);
  lamp.quaternion.copy(shaft.quaternion);
  root.add(lamp);

  let time = 0;
  let powerUp = 0; // 0..1 intro: lights switch on in sequence

  return {
    turntable,
    mirror,
    setQuality({ reflections, reflectionScale, shadows }, width, height) {
      mirror.visible = reflections;
      tintMat.roughness = reflections ? 0.35 : 0.18;
      tintMat.envMapIntensity = reflections ? 0.25 : 0.9;
      if (reflections) mirror.getRenderTarget().setSize(Math.round(width * reflectionScale), Math.round(height * reflectionScale));
      key.castShadow = shadows;
    },
    update(dt) {
      time += dt;
      powerUp = Math.min(1, powerUp + dt * 0.6);
      const step = (start) => THREE.MathUtils.smoothstep(powerUp, start, start + 0.25);

      key.intensity = 260 * step(0.0) * (0.96 + 0.04 * Math.sin(time * 1.7));
      beamMat.opacity = 0.05 * step(0.0);
      lamp.material.emissiveIntensity = 2 * step(0.0);
      rims.forEach(({ light, phase }, i) => {
        const a = time * 0.25 + phase;
        light.position.set(Math.cos(a) * 7, 5.5, Math.sin(a) * 7);
        light.intensity = 180 * step(0.35 + i * 0.15);
      });
      hemi.intensity = 0.35 * step(0.2);
      ringMat.color.setRGB(1, 0.16, 0.23).multiplyScalar(2.2 * step(0.5) * (0.85 + 0.15 * Math.sin(time * 2.2)));
    },
  };
}
