import * as THREE from 'three';
import { createCarPaint } from './carPaint.js';

// Procedural cars, built so the garage ships with zero downloaded assets: the starter
// coupe ("RP-1 Vanta") and, with the `hyper` aero kit, the RP-X Hyperion. The car faces +X,
// sits on y = 0 and is centered on the origin. External .glb models follow the same
// conventions and expose the same interface (see src/assets/modelLoader.js).

export const WHEEL_BASE = 1.3; // half wheelbase (x)
export const TRACK = 0.86; // half track width (z)
export const WHEEL_RADIUS = 0.34;

// ---------------------------------------------------------------------------
// Lofted surfaces. The body and greenhouse are swept superellipse cross-sections whose
// width/height follow smooth side and plan profiles, which gives continuous automotive
// curvature (and clean reflections) instead of slab-sided extrusions.
// ---------------------------------------------------------------------------

// Smooth y = f(x) through key points (Catmull-Rom, sampled into a lookup table).
function profile(points) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'centripetal');
  const table = curve.getSpacedPoints(400).sort((a, b) => a.x - b.x);
  return (x) => {
    if (x <= table[0].x) return table[0].y;
    if (x >= table[table.length - 1].x) return table[table.length - 1].y;
    let lo = 0;
    let hi = table.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (table[mid].x < x) lo = mid;
      else hi = mid;
    }
    const a = table[lo];
    const b = table[hi];
    return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
  };
}

const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

// Cross-section point for station x at angle theta (0 = +z side, PI/2 = top).
function makeSection({ front, rear, top, bottom, width, nFront, nRear, m, tumble, tuck, flare = () => 1 }) {
  return (x, theta) => {
    const u = x >= 0 ? x / front : -x / rear;
    const n = x >= 0 ? nFront : nRear;
    const plan = Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, u), n)), 1 / n);
    const w = width * plan * flare(x);
    const t = top(x);
    const b = bottom(x);
    const cy = (t + b) / 2;
    const h = (t - b) / 2;
    const sy = spow(Math.sin(theta), 2 / m);
    const cz = spow(Math.cos(theta), 2 / m);
    const narrow = sy > 0 ? 1 - tumble * sy * sy : 1 - tuck * sy * sy;
    return { x, y: cy + h * sy, z: w * cz * narrow, sy };
  };
}

// Builds an indexed grid over (station, angle). `materialOf(x, sy, z)` may split faces into
// material groups (used to cut windows into the greenhouse).
function loft(section, { x0, x1, stations, ring, deform, materialOf }) {
  const positions = [];
  const uvs = [];
  const xs = [];
  for (let i = 0; i < stations; i++) {
    // Cosine spacing packs stations near the nose and tail where curvature is highest.
    const k = 0.5 - 0.5 * Math.cos((Math.PI * i) / (stations - 1));
    xs.push(x0 + (x1 - x0) * k);
  }
  const meta = [];
  xs.forEach((x, i) => {
    for (let j = 0; j < ring; j++) {
      const p = section(x, (j / ring) * Math.PI * 2);
      if (deform) deform(p);
      positions.push(p.x, p.y, p.z);
      uvs.push(i / (stations - 1) * 6, (j / ring) * 3);
      meta.push(p);
    }
  });
  const groups = [[], []];
  for (let i = 0; i < stations - 1; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * ring + j;
      const b = i * ring + ((j + 1) % ring);
      const c = (i + 1) * ring + j;
      const d = (i + 1) * ring + ((j + 1) % ring);
      const pa = meta[a];
      const pd = meta[d];
      const g = materialOf ? materialOf((pa.x + pd.x) / 2, (pa.sy + pd.sy) / 2, (pa.z + pd.z) / 2) : 0;
      groups[g].push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex([...groups[0], ...groups[1]]);
  geo.addGroup(0, groups[0].length, 0);
  if (groups[1].length) geo.addGroup(groups[0].length, groups[1].length, 1);
  geo.computeVertexNormals();
  return geo;
}

const ARCH_RADIUS = 0.45;

const bodySection = makeSection({
  front: 2.3,
  rear: 2.3,
  width: 0.95,
  nFront: 3.2,
  nRear: 7,
  m: 5,
  tumble: 0.12,
  tuck: 0.1,
  top: profile([
    [2.32, 0.4], [2.22, 0.56], [2.0, 0.64], [1.5, 0.73], [1.0, 0.8], [0.6, 0.85],
    [0, 0.87], [-1.0, 0.9], [-1.7, 0.92], [-2.1, 0.91], [-2.32, 0.78],
  ]),
  bottom: profile([[2.32, 0.34], [2.1, 0.25], [1.5, 0.21], [-1.5, 0.21], [-2.1, 0.25], [-2.32, 0.4]]),
  // Muscular hips over the wheels.
  flare: (x) => 1 + 0.035 * Math.exp(-(((x - WHEEL_BASE) / 0.45) ** 2)) + 0.05 * Math.exp(-(((x + WHEEL_BASE) / 0.5) ** 2)),
});

// Pushes body vertices out of the wheel cylinders, which carves the wheel arches.
function carveArches(p) {
  for (const wx of [WHEEL_BASE, -WHEEL_BASE]) {
    const dx = p.x - wx;
    const dy = p.y - WHEEL_RADIUS;
    const d = Math.hypot(dx, dy);
    if (d < ARCH_RADIUS && p.y < 0.75) {
      const k = ARCH_RADIUS / (d || 1e-4);
      p.x = wx + dx * k;
      p.y = WHEEL_RADIUS + dy * k;
    }
  }
}

const cabinSection = makeSection({
  front: 0.95,
  rear: 2.0,
  width: 0.7,
  nFront: 2.6,
  nRear: 2.4,
  m: 3.4,
  tumble: 0.3,
  tuck: 0,
  top: profile([[0.98, 0.82], [0.6, 0.95], [0.0, 1.19], [-0.4, 1.28], [-0.8, 1.27], [-1.2, 1.17], [-1.6, 1.02], [-2.02, 0.88]]),
  bottom: () => 0.74,
});

// Glass (1) vs painted pillars/roof (0) on the greenhouse.
function cabinMaterial(x, sy) {
  if (sy < -0.05) return 0;
  if (sy > 0.8) {
    if (x > 0.02 && x < 0.86) return 1; // windshield
    if (x < -1.02 && x > -1.85) return 1; // fastback rear glass
    return 0; // roof
  }
  if (sy < 0.6 && x > -1.32 && x < 0.5) return 1; // side windows
  return 0;
}

// Position + outward normal on the body surface, used to seat lights and trim.
function surfaceFrame(section, x, theta, deform) {
  const at = (xx, tt) => {
    const p = section(xx, tt);
    if (deform) deform(p);
    return new THREE.Vector3(p.x, p.y, p.z);
  };
  const p = at(x, theta);
  const dx = at(x + 0.01, theta).sub(at(x - 0.01, theta));
  const dt = at(x, theta + 0.01).sub(at(x, theta - 0.01));
  const normal = new THREE.Vector3().crossVectors(dx, dt).normalize();
  return { position: p, normal };
}

function createMaterials(paintColor, finish, kit) {
  const m = {
    paint: createCarPaint(paintColor, finish),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x0a0e14,
      metalness: 0.1,
      roughness: 0.04,
      clearcoat: 1,
      transparent: true,
      opacity: 0.82,
      envMapIntensity: 1.6,
    }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.55, metalness: 0.3 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.3, metalness: 0.6 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.08, metalness: 1 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.22, metalness: 0.95 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.92, metalness: 0 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.4, metalness: 0.9 }),
    caliper: new THREE.MeshStandardMaterial({ color: kit === 'hyper' ? 0xffc21a : 0xe2231a, roughness: 0.35, metalness: 0.2 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x090909, roughness: 0.9 }),
    wellLiner: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.95, side: THREE.DoubleSide }),
    headLens: new THREE.MeshStandardMaterial({ color: 0xdfe8ff, roughness: 0.1, metalness: 0.2, emissive: 0xe8f0ff, emissiveIntensity: 0 }),
    tailLens: new THREE.MeshStandardMaterial({ color: 0x400608, roughness: 0.15, metalness: 0.1, emissive: 0xff1a1a, emissiveIntensity: 0.15 }),
    beam: new THREE.MeshBasicMaterial({
      color: 0xcfe0ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  };
  // Race baking gives every car its own brake-light material; this flag finds it.
  m.tailLens.userData.tailLight = true;
  return m;
}

function tireGeometry(segments = 40) {
  // Rounded tire cross-section revolved around the wheel axis.
  const pts = [];
  const inner = 0.235;
  const outer = WHEEL_RADIUS;
  const half = 0.125;
  const r = 0.05;
  pts.push(new THREE.Vector2(inner, -half));
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(outer - r + Math.cos(a) * r, -half + r + Math.sin(a) * r));
  }
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(outer - r + Math.cos(a) * r, half - r + Math.sin(a) * r));
  }
  pts.push(new THREE.Vector2(inner, half));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.rotateX(Math.PI / 2);
  return geo;
}

function createWheel(m, side, sharedTire) {
  const wheel = new THREE.Group();
  const spin = new THREE.Group();
  wheel.add(spin);

  const tire = new THREE.Mesh(sharedTire, m.tire);
  tire.castShadow = true;
  spin.add(tire);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.236, 0.236, 0.22, 32, 1, true), m.rim);
  barrel.rotation.x = Math.PI / 2;
  spin.add(barrel);

  const face = 0.09 * side;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.232, 0.012, 8, 40), m.chrome);
  lip.position.z = face + 0.02 * side;
  spin.add(lip);

  // Five split spokes.
  const spokeGeo = new THREE.BoxGeometry(0.2, 0.034, 0.03);
  spokeGeo.translate(0.11, 0, 0);
  for (let i = 0; i < 10; i++) {
    const spoke = new THREE.Mesh(spokeGeo, m.rim);
    const base = Math.floor(i / 2) * ((Math.PI * 2) / 5);
    spoke.rotation.z = base + (i % 2 === 0 ? -0.09 : 0.09);
    spoke.position.z = face;
    spin.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.05, 20), m.chrome);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = face + 0.01 * side;
  spin.add(hub);

  // Brake disc and caliper stay still while the wheel spins.
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.025, 32), m.disc);
  disc.rotation.x = Math.PI / 2;
  disc.position.z = 0.02 * side;
  wheel.add(disc);
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.06), m.caliper);
  caliper.name = 'caliper';
  caliper.position.set(-0.11, 0.11, 0.045 * side);
  caliper.rotation.z = 0.8;
  wheel.add(caliper);

  return { wheel, spin };
}

// Hypercar aero kit: big rear wing, front canards, roof scoop and side blades.
function addHyperKit(m, add) {
  const wing = add(new THREE.BoxGeometry(0.34, 0.035, 1.78), m.carbon, -2.0, 1.13, 0);
  wing.rotation.z = -0.12;
  add(new THREE.BoxGeometry(0.05, 0.16, 1.78), m.paint, -2.17, 1.17, 0); // gurney flap
  for (const z of [-1, 1]) {
    add(new THREE.BoxGeometry(0.4, 0.2, 0.025), m.carbon, -2.0, 1.15, z * 0.9); // end plates
    const strut = add(new THREE.BoxGeometry(0.07, 0.32, 0.04), m.carbon, -1.98, 0.96, z * 0.42);
    strut.rotation.z = 0.25;
    const canard = add(new THREE.BoxGeometry(0.22, 0.02, 0.16), m.carbon, 2.08, 0.4, z * 0.8);
    canard.rotation.x = z * 0.35;
    canard.rotation.z = 0.18;
    add(new THREE.BoxGeometry(0.9, 0.14, 0.03), m.carbon, -0.75, 0.52, z * 0.935); // side blade
  }
  const scoop = add(new THREE.BoxGeometry(0.42, 0.11, 0.3), m.carbon, -0.55, 1.17, 0);
  scoop.rotation.z = -0.08;
  add(new THREE.BoxGeometry(0.03, 0.08, 0.22), m.trim, -0.33, 1.17, 0); // scoop mouth
  add(new THREE.BoxGeometry(1.1, 0.02, 0.012), m.carbon, -1.35, 1.06, 0); // shark fin
}

// `detail` scales the loft resolution (1 = showroom; the race uses a lighter mesh).
export function createCar({ paintColor, finish, detail = 1, kit = 'coupe' }) {
  const res = (n) => Math.max(8, Math.round((n * detail) / 4) * 4);
  const m = createMaterials(paintColor, finish, kit);
  const car = new THREE.Group();
  car.name = kit === 'hyper' ? 'hypercar' : 'starter-coupe';

  const body = new THREE.Mesh(
    loft(bodySection, { x0: -2.3, x1: 2.3, stations: res(96), ring: res(64), deform: carveArches }),
    m.paint
  );
  body.name = 'body';
  car.add(body);

  const cabin = new THREE.Mesh(
    loft(cabinSection, { x0: -2.02, x1: 0.98, stations: res(64), ring: res(48), materialOf: cabinMaterial }),
    [m.paint, m.glass]
  );
  cabin.name = 'body';
  car.add(cabin);

  const interior = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.2, 0.86), m.interior);
  interior.position.set(-0.4, 0.88, 0);
  car.add(interior);

  // Dark wheel-well liners so the arches read as openings.
  const linerGeo = new THREE.CylinderGeometry(ARCH_RADIUS - 0.01, ARCH_RADIUS - 0.01, 0.62, 28, 1, true, -Math.PI / 2, Math.PI);
  linerGeo.rotateX(Math.PI / 2);
  for (const x of [WHEEL_BASE, -WHEEL_BASE]) {
    for (const z of [-1, 1]) {
      const liner = new THREE.Mesh(linerGeo, m.wellLiner);
      liner.position.set(x, WHEEL_RADIUS, z * 0.62);
      car.add(liner);
    }
  }

  // Seats a thin part flush on the body surface, facing outward.
  const seat = (mesh, x, theta, lift = 0.004) => {
    const { position, normal } = surfaceFrame(bodySection, x, theta, carveArches);
    mesh.position.copy(position).addScaledVector(normal, lift);
    mesh.lookAt(position.clone().add(normal));
    car.add(mesh);
    return mesh;
  };

  // Aero and trim.
  const add = (geo, mat, x, y, z, name = 'body') => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.name = name;
    car.add(mesh);
    return mesh;
  };
  add(new THREE.BoxGeometry(0.16, 0.07, 0.7), m.trim, 2.21, 0.33, 0); // lower air intake
  add(new THREE.BoxGeometry(0.26, 0.03, 1.2), m.carbon, 2.02, 0.2, 0); // front splitter
  add(new THREE.BoxGeometry(0.4, 0.09, 1.4), m.carbon, -2.02, 0.24, 0); // rear diffuser
  for (const z of [-1, 1]) {
    add(new THREE.BoxGeometry(1.7, 0.06, 0.05), m.carbon, 0, 0.24, z * 0.91); // side skirt
    const mirror = add(new THREE.SphereGeometry(0.09, 16, 10).scale(1.2, 0.7, 1), m.paint, 0.55, 0.9, z * 0.8);
    mirror.rotation.y = -0.25 * z;
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 16).rotateZ(Math.PI / 2), m.chrome, -2.24, 0.32, z * 0.42); // exhaust
  }
  if (kit === 'hyper') addHyperKit(m, add);

  // Lights. Slim LED headlights, wraparound tail lights, real light sources and soft beams.
  const lights = { head: [], tail: [], beams: [] };
  for (const z of [-1, 1]) {
    const side = (theta) => (z > 0 ? theta : Math.PI - theta);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.02), m.headLens);
    lens.name = 'headlight';
    seat(lens, 2.2, side(0.55), 0.004);

    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.02), m.headLens);
    drl.name = 'headlight';
    seat(drl, 2.24, side(0.3), 0.004);

    const spot = new THREE.SpotLight(0xe6efff, 0, 14, 0.5, 0.65, 1.4);
    spot.position.set(2.25, 0.58, z * 0.5);
    spot.target.position.set(7, 0, z * 1.1);
    car.add(spot, spot.target);
    lights.head.push(spot);

    const beamGeo = new THREE.ConeGeometry(0.9, 4.2, 24, 1, true);
    beamGeo.translate(0, -2.1, 0);
    beamGeo.rotateZ(Math.PI / 2 + 0.12);
    const beam = add(beamGeo, m.beam, 2.25, 0.58, z * 0.5, 'beam');
    beam.rotation.y = -0.08 * z;
    lights.beams.push(beam);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.02), m.tailLens);
    tail.name = 'taillight';
    seat(tail, -2.295, side(0.6), 0.004);
  }
  add(new THREE.BoxGeometry(0.02, 0.028, 1.0), m.tailLens, -2.302, 0.74, 0, 'taillight');
  const tailGlow = new THREE.PointLight(0xff2020, 0, 3.5, 2);
  tailGlow.position.set(-2.6, 0.75, 0);
  car.add(tailGlow);
  lights.tail.push(tailGlow);

  // Wheels.
  const tireGeo = tireGeometry(res(40));
  const wheels = [];
  const wheelPositions = [
    [WHEEL_BASE, TRACK],
    [WHEEL_BASE, -TRACK],
    [-WHEEL_BASE, TRACK],
    [-WHEEL_BASE, -TRACK],
  ];
  wheelPositions.forEach(([x, z], index) => {
    const { wheel, spin } = createWheel(m, Math.sign(z), tireGeo);
    wheel.position.set(x, WHEEL_RADIUS, z);
    wheel.traverse((o) => {
      o.userData.wheelIndex = index;
    });
    car.add(wheel);
    wheels.push({ wheel, spin });
  });

  car.traverse((o) => {
    if (o.isMesh && o.name !== 'beam') o.castShadow = true;
  });

  let lightsOn = false;
  let lightLevel = 0;
  let wheelSpeed = 0;

  return {
    group: car,
    source: 'procedural',
    paintMaterial: m.paint,
    wheels,
    wheelRadius: WHEEL_RADIUS,
    // Nitro flame anchors (car space), at the exhaust tips.
    exhausts: [new THREE.Vector3(-2.28, 0.32, -0.42), new THREE.Vector3(-2.28, 0.32, 0.42)],
    get lightsOn() {
      return lightsOn;
    },
    setLights(on) {
      lightsOn = on;
    },
    spinWheels(speed) {
      wheelSpeed = speed;
    },
    update(dt) {
      // Lights fade rather than pop, which reads better on a phone screen.
      const target = lightsOn ? 1 : 0;
      lightLevel += (target - lightLevel) * Math.min(1, dt * 10);
      m.headLens.emissiveIntensity = lightLevel * 3.2;
      m.tailLens.emissiveIntensity = 0.15 + lightLevel * 3.5;
      m.beam.opacity = lightLevel * 0.07;
      lights.head.forEach((l) => (l.intensity = lightLevel * 40));
      lights.tail.forEach((l) => (l.intensity = lightLevel * 4));
      lights.beams.forEach((b) => (b.visible = lightLevel > 0.01));

      wheelSpeed *= Math.pow(0.35, dt);
      if (wheelSpeed > 0.01) wheels.forEach(({ spin }) => (spin.rotation.z -= wheelSpeed * dt));
    },
  };
}
