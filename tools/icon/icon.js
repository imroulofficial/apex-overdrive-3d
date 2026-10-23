import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { loadCar } from '../../src/assets/modelLoader.js';
import { carById } from '../../src/data/cars.js';

// Renders the launcher icon as one action shot at 1024 px: the Valkyrie GT-R (factory livery)
// mid power-drift on wet asphalt at dusk, low 3/4 front camera with a Dutch tilt, cyan nitro,
// tyre smoke, friction sparks, headlight beams through mist, bloom and a sun lens flare.
//
// The shot is rendered twice: `wide` fills the whole 108 dp adaptive canvas (the background
// layer; launchers crop 18 dp per side), and `tight` frames the same shot to the 72 dp visible
// area for the legacy, round and Play Store icons. The adaptive foreground layer is left
// transparent, since the car, its reflection and the effects belong in one picture.
// window.__icon resolves to { background, foreground, legacy, round, store } data URLs.

const S = 1024;
const DEG = Math.PI / 180;
const rand = (() => {
  let s = 7;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
})();

// Soft round sprite texture (smoke, glows).
function softTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, inner);
  r.addColorStop(1, outer);
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Dusk sky: indigo overhead, magenta band, a hot orange horizon and a low sun.
function sky(sunDir) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uSun: { value: sunDir } },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uSun; varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 top = vec3(0.012, 0.010, 0.05);
        vec3 mid = vec3(0.16, 0.025, 0.14);
        vec3 hor = vec3(0.75, 0.22, 0.07);
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.08, h));
        col = mix(col, top, smoothstep(0.08, 0.4, h));
        col = mix(col, vec3(0.02, 0.02, 0.05), smoothstep(0.0, -0.05, h));
        float d = max(dot(vDir, uSun), 0.0);
        col += vec3(1.0, 0.45, 0.18) * pow(d, 120.0) * 0.9 + vec3(1.0, 0.85, 0.6) * pow(d, 2500.0) * 4.0;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(160, 48, 24), mat);
}

// City skyline silhouette with neon windows on a distant cylinder, facing the camera's view.
function skyline() {
  const c = document.createElement('canvas');
  c.width = 4096;
  c.height = 512;
  const g = c.getContext('2d');
  const neon = ['#ff2bd6', '#2be8ff', '#ff8a2b', '#ffe14a'];
  let x = 0;
  while (x < c.width) {
    const w = 40 + rand() * 120;
    const h = 60 + rand() * rand() * 360;
    g.fillStyle = `rgb(${10 + rand() * 10}, ${6 + rand() * 8}, ${22 + rand() * 18})`;
    g.fillRect(x, c.height - h, w, h);
    for (let y = c.height - h + 10; y < c.height - 8; y += 14) {
      for (let wx = x + 6; wx < x + w - 6; wx += 12) {
        if (rand() < 0.22) {
          g.fillStyle = neon[(rand() * neon.length) | 0];
          g.globalAlpha = 0.5 + rand() * 0.5;
          g.fillRect(wx, y, 5, 6);
          g.globalAlpha = 1;
        }
      }
    }
    if (rand() < 0.25) {
      g.fillStyle = neon[(rand() * neon.length) | 0];
      g.fillRect(x, c.height - h, w, 4);
    }
    x += w + rand() * 6;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(120, 120, 16, 64, 1, true, 0, Math.PI * 2),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.BackSide, fog: false, toneMapped: true, color: 0xb8a8d8 })
  );
  m.position.y = 7.2;
  return m;
}

// Wet asphalt: a mirror underneath, a rough asphalt sheet over it whose alpha opens puddles,
// and a lane marking painted into the sheet.
function road() {
  const group = new THREE.Group();
  const mirror = new Reflector(new THREE.PlaneGeometry(400, 400), { textureWidth: 1024, textureHeight: 1024, color: 0x30303a });
  mirror.rotation.x = -Math.PI / 2;
  group.add(mirror);

  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const img = g.createImageData(1024, 1024);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 18 + rand() * 26;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v + 4;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // Puddles: punch soft holes in the alpha so the mirror shows through.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 70; i++) {
    const x = rand() * 1024;
    const y = rand() * 1024;
    const r = 30 + rand() * 120;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(x, y, r * 1.6, r, rand() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  // A global sheen: the whole road is damp.
  const data = g.getImageData(0, 0, 1024, 1024);
  for (let i = 3; i < data.data.length; i += 4) data.data[i] *= 0.88;
  g.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.45 })
  );
  asphalt.position.y = 0.004;
  group.add(asphalt);

  // Dashed centre line along the car's line of travel (32° off its heading, see buildScene).
  const lane = new THREE.Group();
  lane.rotation.y = -32 * DEG;
  group.add(lane);
  const dash = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.4, transparent: true, opacity: 0.55 });
  for (let i = -8; i < 10; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.16).rotateX(-Math.PI / 2), dash);
    m.position.set(i * 5, 0.006, 1.6);
    lane.add(m);
  }
  return group;
}

// A cone of light that fades along its length (headlight beams in the mist).
function beam(length, radius, color, opacity) {
  const geo = new THREE.ConeGeometry(radius, length, 32, 1, true).translate(0, -length / 2, 0).rotateZ(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uLen: { value: length }, uOpacity: { value: opacity } },
    vertexShader: `varying float vX; varying vec3 vN; varying vec3 vView;
      void main() { vX = position.x; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uLen; uniform float uOpacity; varying float vX; varying vec3 vN; varying vec3 vView;
      void main() { float f = 1.0 - clamp(vX / uLen, 0.0, 1.0); float edge = pow(abs(dot(vN, vView)), 1.5);
        gl_FragColor = vec4(uColor, uOpacity * f * f * edge); }`,
  });
  return new THREE.Mesh(geo, mat);
}

async function buildScene(renderer) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x2a1838, 0.028);
  // Sun low on the horizon, behind and to the left of the car from the camera.
  const sunDir = new THREE.Vector3(-1, 0.035, -0.55).normalize();
  const skyMesh = sky(sunDir);
  scene.add(skyMesh, skyline());

  // Reflections on the paint come from the same dusk sky.
  const envScene = new THREE.Scene();
  envScene.add(sky(sunDir));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 1.0;

  scene.add(road());

  // The car: factory livery, lights on, mid power-drift. Its nose points along +x; it travels
  // along `velocity`, 32° off its heading, so the tail slides out toward the camera side.
  const def = carById('rpx-hyperion');
  const car = await loadCar({ ...def, model: { ...def.model, url: `/${def.model.url}` } }, { paintColor: '#d9dde3', finish: 'factory' });
  car.setLights(true);
  for (let i = 0; i < 60; i++) car.update(1 / 30);
  const heads = [];
  car.group.updateMatrixWorld(true);
  car.group.traverse((o) => {
    if (o.name === 'beam') o.visible = false;
    if (o.isMesh && o.material?.userData?.headLight) heads.push(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()));
  });
  const body = new THREE.Box3().setFromObject(car.group);
  // Counter-steer: front wheels point into the slide.
  for (const w of car.wheels) {
    if (w.wheel.position.x > 0) w.wheel.rotation.y = 18 * DEG;
    w.spin.rotation.z = rand() * 6;
  }
  car.group.rotation.z = -1.5 * DEG; // body roll onto the outside wheels
  scene.add(car.group);
  const yaw = 32 * DEG;
  const velocity = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  const back = velocity.clone().negate();

  // Headlights: emissive lenses (from the model), spot lights on the wet road, beams in the mist.
  const headPts = heads.length >= 2 ? [heads.reduce((a, b) => (a.z < b.z ? a : b)), heads.reduce((a, b) => (a.z > b.z ? a : b))]
    : [new THREE.Vector3(body.max.x - 0.2, 0.62, -0.62), new THREE.Vector3(body.max.x - 0.2, 0.62, 0.62)];
  for (const p of headPts) {
    const b = beam(7, 0.9, 0xe8f2ff, 0.05);
    b.position.copy(p);
    b.rotation.z = -1 * DEG;
    scene.add(b);
    const spot = new THREE.SpotLight(0xfff2e2, 14, 30, 26 * DEG, 0.6, 1.6);
    spot.position.copy(p);
    spot.target.position.copy(p).add(new THREE.Vector3(6, -0.9, 0));
    scene.add(spot, spot.target);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: 0xeef4ff, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.material.color.multiplyScalar(1.6);
    glow.position.copy(p).add(new THREE.Vector3(0.05, 0, 0));
    glow.scale.setScalar(0.32);
    scene.add(glow);
  }

  // Lighting: warm sunset rim from behind, magenta and cyan rims, a soft key from the front.
  const sun = new THREE.DirectionalLight(0xff9a50, 4.2);
  sun.position.copy(sunDir).multiplyScalar(20);
  const rimPink = new THREE.DirectionalLight(0xff3cc8, 3.0);
  rimPink.position.set(-6, 3, 5);
  const rimCyan = new THREE.DirectionalLight(0x3ae6ff, 1.1);
  rimCyan.position.set(-3, 4, -7);
  const key = new THREE.DirectionalLight(0xfff1e0, 1.7);
  key.position.set(8, 6, 6);
  scene.add(sun, rimPink, rimCyan, key, new THREE.HemisphereLight(0x6050a0, 0x100808, 0.45));

  // Cyan nitro: layered additive cones from each exhaust (white core, cyan sheath) plus a glow.
  const additive = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  for (const at of car.exhausts) {
    for (const [len, r, color, op] of [[4.6, 0.3, 0x0a8cff, 0.7], [3.4, 0.18, 0x30e0ff, 0.85], [1.6, 0.07, 0xbffcff, 0.9]]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, len, 20, 1, true).rotateZ(Math.PI / 2).translate(-len / 2, 0, 0), additive(color, op));
      cone.position.copy(at);
      cone.rotation.y = -6 * DEG;
      scene.add(cone);
    }
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: 0x40d8ff, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    g.position.copy(at).add(new THREE.Vector3(-0.4, 0, 0));
    g.scale.setScalar(1.1);
    scene.add(g);
    const pl = new THREE.PointLight(0x30d0ff, 5, 5, 1.8);
    pl.position.copy(at).add(new THREE.Vector3(-0.8, 0.2, 0));
    scene.add(pl);
  }

  // Tyre smoke: billows trailing from the rear tyres back along the line of travel, growing
  // and rising as they fall behind, lit warm on the sun side.
  const smokeTex = softTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
  const rear = car.wheels.filter((w) => w.wheel.position.x < 0).map((w) => w.wheel.getWorldPosition(new THREE.Vector3()));
  for (const p of rear) {
    // The billow wrapped round the spinning tyre itself.
    for (let i = 0; i < 18; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.32, color: new THREE.Color().setHSL(0.68 + rand() * 0.1, 0.1, 0.5 + rand() * 0.15) }));
      s.position.copy(p).addScaledVector(back, 0.3 + rand() * 1.2).add(new THREE.Vector3((rand() - 0.5) * 0.6, 0.15 + rand() * 0.6, (rand() - 0.2) * 1.4));
      s.scale.setScalar(0.7 + rand() * 1.0);
      s.material.rotation = rand() * Math.PI;
      scene.add(s);
    }
    for (let i = 0; i < 46; i++) {
      const t = i / 46;
      const d = 0.3 + t * 6;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.5 * (1 - t * 0.75), color: new THREE.Color().setHSL(0.7 + rand() * 0.1, 0.12, 0.42 + rand() * 0.14) }));
      s.position.copy(p).addScaledVector(back, d).add(new THREE.Vector3((rand() - 0.5) * 0.8 * (0.4 + t), 0.3 + t * 0.7 + rand() * 0.3, (rand() - 0.5) * 1.2 * (0.4 + t)));
      s.scale.setScalar(1.0 + t * 2.6 + rand() * 0.5);
      s.material.rotation = rand() * Math.PI;
      scene.add(s);
    }
  }

  // Friction sparks: hot streaks spraying from the tyre contact patches, back and outward.
  const contacts = car.wheels.map((w) => w.wheel.getWorldPosition(new THREE.Vector3()).setY(0.03));
  const rod = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
  const up = new THREE.Vector3(0, 1, 0);
  for (const p of contacts) {
    const rearWheel = p.x < 0;
    for (let i = 0; i < (rearWheel ? 80 : 26); i++) {
      const dir = back.clone().applyAxisAngle(up, (rand() - 0.5) * 1.1).add(new THREE.Vector3(0, 0.1 + rand() * 0.5, 0)).normalize();
      const len = 0.2 + rand() * 0.7;
      const c = new THREE.Color().setHSL(0.05 + rand() * 0.07, 1, 0.55 + rand() * 0.15).multiplyScalar(4 + rand() * 4);
      const m = new THREE.Mesh(rod, new THREE.MeshBasicMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      m.position.copy(p).addScaledVector(dir, 0.1 + rand() * 0.7);
      m.quaternion.setFromUnitVectors(up, dir);
      m.scale.set(0.007 + rand() * 0.006, len, 0.007 + rand() * 0.006);
      scene.add(m);
    }
  }
  // Ember dots on the tarmac at the sparks' landing points.
  const emberTex = softTexture();
  for (let i = 0; i < 30; i++) {
    const p = contacts[(rand() * contacts.length) | 0].clone().addScaledVector(back, 0.4 + rand() * 2.2).add(new THREE.Vector3(0, 0.02, (rand() - 0.5) * 1.2));
    const e = new THREE.Sprite(new THREE.SpriteMaterial({ map: emberTex, color: 0xff8a2a, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    e.position.copy(p);
    e.scale.setScalar(0.08 + rand() * 0.14);
    scene.add(e);
  }

  return { scene, sunDir, headPts };
}

// Low 3/4 front camera with a Dutch tilt; `visible` is the fraction of the frame that matters
// (1 for the wide 108 dp shot, 72/108 for the tight crop), so both share one composition.
function camera(visible) {
  const fov = 34;
  const cam = new THREE.PerspectiveCamera(2 * Math.atan(Math.tan((fov / 2) * DEG) * visible) / DEG, 1, 0.1, 400);
  const target = new THREE.Vector3(-0.6, 0.75, 0.2);
  cam.position.copy(target).add(new THREE.Vector3(5.6, 0.6, 6.4).normalize().multiplyScalar(13.2 / 1.0));
  cam.lookAt(target);
  cam.rotateZ(-13 * DEG);
  return cam;
}

function render(renderer, scene, cam) {
  const composer = new EffectComposer(renderer);
  composer.setSize(S, S);
  composer.addPass(new RenderPass(scene, cam));
  // Bloom spreads a single NaN/Inf pixel (half-float target) over the whole frame, so the
  // render is sanitised and clamped first.
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0); gl_FragColor = clamp(c, 0.0, 24.0); }',
  }));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(S, S), 0.45, 0.35, 1.0));
  composer.addPass(new OutputPass());
  composer.render();
  composer.render(); // the first frame after compiling can come out empty
  const out = document.createElement('canvas');
  out.width = out.height = S;
  out.getContext('2d').drawImage(renderer.domElement, 0, 0);
  composer.dispose();
  return out;
}

// 2D lens flare over the render: a warm glare and streak at the sun, ghosts along the line
// through the frame centre, and star glints on the headlights.
function flare(canvas, cam, sunDir, glints) {
  const g = canvas.getContext('2d');
  g.globalCompositeOperation = 'lighter';
  const toScreen = (p) => {
    const v = p.clone().project(cam);
    return { x: (v.x * 0.5 + 0.5) * S, y: (-v.y * 0.5 + 0.5) * S, z: v.z };
  };
  const glow = (x, y, r, color) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  const streak = (x, y, len, thick, color, angle = 0) => {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    const grad = g.createLinearGradient(-len, 0, len, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(-len, -thick / 2, len * 2, thick);
    g.restore();
  };
  const sun = toScreen(cam.position.clone().addScaledVector(sunDir, 100));
  if (sun.z < 1) {
    glow(sun.x, sun.y, S * 0.16, 'rgba(255,130,60,0.28)');
    glow(sun.x, sun.y, S * 0.04, 'rgba(255,230,190,0.75)');
    streak(sun.x, sun.y, S * 0.45, S * 0.008, 'rgba(255,190,120,0.4)', -13 * DEG);
    const cx = S / 2 - sun.x;
    const cy = S / 2 - sun.y;
    for (const [k, r, c] of [[0.55, 0.025, 'rgba(120,255,240,0.12)'], [0.95, 0.05, 'rgba(255,120,220,0.08)'], [1.35, 0.02, 'rgba(255,220,120,0.12)'], [1.7, 0.07, 'rgba(90,160,255,0.06)']]) {
      glow(S / 2 + cx * (k - 1) + cx, S / 2 + cy * (k - 1) + cy, S * r, c);
    }
  }
  for (const p of glints) {
    const s = toScreen(p);
    glow(s.x, s.y, S * 0.035, 'rgba(230,240,255,0.45)');
    streak(s.x, s.y, S * 0.13, S * 0.005, 'rgba(220,235,255,0.65)', -13 * DEG);
    streak(s.x, s.y, S * 0.05, S * 0.004, 'rgba(220,235,255,0.6)', 77 * DEG);
  }
  g.globalCompositeOperation = 'source-over';
  const v = g.createRadialGradient(S / 2, S * 0.55, S * 0.3, S / 2, S * 0.55, S * 0.78);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = v;
  g.fillRect(0, 0, S, S);
}

function mask(src, shape) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.beginPath();
  if (shape === 'circle') g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  else if (shape === 'rounded') g.roundRect(0, 0, S, S, S * 0.18);
  else g.rect(0, 0, S, S);
  g.clip();
  g.drawImage(src, 0, 0);
  return c;
}

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(S, S, false);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
const { scene, sunDir, headPts } = await buildScene(renderer);

const shots = {};
for (const [name, visible] of [['wide', 1], ['tight', 72 / 108]]) {
  const cam = camera(visible);
  await renderer.compileAsync(scene, cam);
  const c = render(renderer, scene, cam);
  flare(c, cam, sunDir, headPts);
  shots[name] = c;
}
const empty = document.createElement('canvas');
empty.width = empty.height = S;

const result = {
  background: shots.wide,
  foreground: empty,
  legacy: mask(shots.tight, 'rounded'),
  round: mask(shots.tight, 'circle'),
  store: mask(shots.tight, 'square'),
};
Object.values(result).forEach((c) => document.body.appendChild(c));

// Legacy (pre-Android 12) launch splash: black, the rounded icon and the wordmark, matching
// the in-game splash. Android 12+ shows the adaptive icon on black instead (styles.xml).
window.__splash = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  const m = Math.min(w, h);
  const glow = g.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, m * 0.6);
  glow.addColorStop(0, 'rgba(150, 30, 90, 0.5)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  const d = m * 0.42;
  g.drawImage(result.legacy, (w - d) / 2, h * 0.42 - d / 2, d, d);
  const size = Math.round(m * 0.075);
  g.font = `italic 900 ${size}px system-ui, 'Segoe UI', Roboto, sans-serif`;
  g.textBaseline = 'middle';
  const y = h * 0.42 + d / 2 + size * 1.1;
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
