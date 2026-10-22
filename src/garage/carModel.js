import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCarPaint } from './carPaint.js';
import { shapeFor } from './carShapes.js';
import { buildRim } from './rims.js';

// Procedural cars, built so the garage ships with zero downloaded assets. All twelve launch
// cars come from one lofted construction driven by a body style (carShapes.js): body and
// greenhouse sections swept along side profiles, arches carved around the wheels, a driver
// door cut out of the same surface so it can open, then the style's aero kit, a rear wing
// (factory or aftermarket) and one of six rim designs (rims.js). The car faces +X, sits on
// y = 0 and is centred on the origin. External .glb models follow the same conventions and
// expose the same interface (see src/assets/modelLoader.js).

// The RP-1 Vanta's dimensions, kept as the reference for code that has no car at hand.
export const WHEEL_BASE = 1.3; // half wheelbase (x)
export const TRACK = 0.86; // half track width (z)
export const WHEEL_RADIUS = 0.34;
// Rims and tyres are modelled at this radius and scaled to each car's tyre.
const REF_RADIUS = 0.34;

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

// Builds an indexed grid over (station, angle). `classify(x, sy, z)` sorts each face into a
// material (0 paint, 1 glass) and, with `door: true`, onto the driver door panel, which comes
// back as its own geometry sharing the same vertices. Faces fully inside a carved wheel arch
// are dropped, which opens the arch.
function loft(section, { x0, x1, stations, ring, deform, classify }) {
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
      uvs.push((i / (stations - 1)) * 6, (j / ring) * 3);
      meta.push(p);
    }
  });
  // [main paint, main glass, door paint, door glass]
  const groups = [[], [], [], []];
  for (let i = 0; i < stations - 1; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * ring + j;
      const b = i * ring + ((j + 1) % ring);
      const c = (i + 1) * ring + j;
      const d = (i + 1) * ring + ((j + 1) % ring);
      const pa = meta[a];
      const pd = meta[d];
      const pb = meta[b];
      const pc = meta[c];
      const f = classify ? classify((pa.x + pd.x) / 2, (pa.sy + pd.sy) / 2, (pa.z + pd.z) / 2) : { mat: 0 };
      // Faces whose every corner was pushed onto a wheel cylinder would skin over the wheel.
      if (f.skip || (pa.carved && pb.carved && pc.carved && pd.carved)) continue;
      groups[f.mat + (f.door ? 2 : 0)].push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // Normals over the whole surface first, so the door panel shades seamlessly when shut.
  geo.setIndex(groups.flat());
  geo.computeVertexNormals();
  const withGroups = (g, list) => {
    g.setIndex(list.flat());
    let start = 0;
    list.forEach((idx, mat) => {
      if (idx.length) g.addGroup(start, idx.length, mat);
      start += idx.length;
    });
    return g;
  };
  withGroups(geo, [groups[0], groups[1]]);
  let door = null;
  if (groups[2].length || groups[3].length) {
    door = new THREE.BufferGeometry();
    for (const name of ['position', 'uv', 'normal']) door.setAttribute(name, geo.attributes[name]);
    withGroups(door, [groups[2], groups[3]]);
  }
  return { geo, door };
}

// Body and greenhouse sections, arch carving and window/door classification for a style.
function buildSections(shape) {
  const P = shape.profiles;
  const { wheelBase: wb, wheel: wr, archRadius: ar } = shape;
  const body = makeSection({
    front: shape.front - 0.02,
    rear: shape.rear - 0.02,
    width: shape.width,
    nFront: shape.nFront,
    nRear: shape.nRear,
    m: shape.m,
    tumble: shape.tumble,
    tuck: shape.tuck,
    top: profile(P.top),
    bottom: profile(P.bottom),
    // Muscular hips over the wheels.
    flare: (x) => 1 + shape.flareFront * Math.exp(-(((x - wb) / 0.45) ** 2)) + shape.flareRear * Math.exp(-(((x + wb) / 0.5) ** 2)),
  });
  const archLimit = shape.belt + shape.ride - 0.12;
  // Fenders: where the hood or deck sits lower than the arch, the outer part of the top
  // surface swells smoothly over the wheel (sports-car fender peaks) instead of the arch
  // poking through it.
  const topAt = profile(P.top);
  const fenders = [wb, -wb].map((wx) => ({ wx, need: Math.max(0, wr + ar + 0.05 - topAt(wx)) })).filter((f) => f.need > 0);
  // Pushes body vertices out of the wheel cylinders, which carves the wheel arches.
  const carve = (p) => {
    if (p.sy > 0) {
      for (const f of fenders) {
        const along = Math.exp(-(((p.x - f.wx) / 0.62) ** 2));
        const out = THREE.MathUtils.smoothstep(Math.abs(p.z) / shape.width, 0.3, 0.82);
        p.y += f.need * along * out * Math.min(1, p.sy * 1.6);
      }
    }
    // Only the outer part of the body is carved (where the tyres are); the hood, deck and
    // floor between the wheels keep their own shape, blending over the inner 20 cm.
    const t = THREE.MathUtils.smoothstep(Math.abs(p.z), shape.track - 0.42, shape.track - 0.22);
    if (t <= 0) return;
    for (const wx of [wb, -wb]) {
      const dx = p.x - wx;
      const dy = p.y - wr;
      const d = Math.hypot(dx, dy);
      if (d < ar && p.y < archLimit) {
        const k = ar / (d || 1e-4);
        p.x += (wx + dx * k - p.x) * t;
        p.y += (wr + dy * k - p.y) * t;
        p.carved = t >= 1;
      }
    }
  };
  const c = shape.cabin;
  const cabin = makeSection({
    front: c.front - 0.03,
    rear: -c.tail - 0.02,
    width: c.width,
    nFront: c.nFront,
    nRear: c.nRear,
    m: c.m,
    tumble: c.tumble,
    tuck: 0,
    top: profile(P.cabinTop),
    bottom: () => P.cabinBase,
  });
  const { windshield, rearGlass, side } = shape.windows;
  const door = shape.door;
  const inDoor = (x) => x < door.front && x > door.rear;
  const bodyClass = (x, sy, z) => ({ mat: 0, door: z > shape.width * 0.55 && sy > -0.62 && sy < 0.9 && inDoor(x) });
  // Glass (1) vs painted pillars/roof (0) on the greenhouse.
  const cabinClass = (x, sy, z) => {
    let mat = 0;
    if (sy >= -0.05) {
      if (sy > 0.8) {
        if (x > windshield[0] && x < windshield[1]) mat = 1;
        else if (x > rearGlass[0] && x < rearGlass[1]) mat = 1;
      } else if (sy < c.sideTop && x > side[0] && x < side[1]) mat = 1;
    }
    return { mat, door: z > 0.2 && sy < c.sideTop + 0.04 && inDoor(x) };
  };
  return { body, cabin, carve, bodyClass, cabinClass };
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

// Merges sibling meshes that share a material and a name (the name drives tap picking) into
// one mesh per parent: the showroom car drops from ~100 draw calls to ~30 while wheels,
// lights and paint keep working exactly as before.
function mergeSiblings(root) {
  const parents = [];
  root.traverse((o) => {
    if (o.children.some((c) => c.isMesh)) parents.push(o);
  });
  for (const parent of parents) {
    const buckets = new Map();
    for (const child of parent.children) {
      if (!child.isMesh || child.children.length || Array.isArray(child.material) || child.name === 'beam') continue;
      const key = `${child.material.uuid}|${child.name}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(child);
    }
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const mat = meshes[0].material;
      const needsUv = ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'emissiveMap'].some((k) => mat[k]);
      const geos = meshes.map((mesh) => {
        mesh.updateMatrix();
        const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrix);
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!needsUv) g.deleteAttribute('uv');
        else if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        return g;
      });
      const merged = new THREE.Mesh(mergeGeometries(geos), mat);
      merged.name = meshes[0].name;
      merged.userData = { ...meshes[0].userData };
      merged.castShadow = meshes.some((m) => m.castShadow);
      merged.receiveShadow = meshes.some((m) => m.receiveShadow);
      for (const mesh of meshes) parent.remove(mesh);
      parent.add(merged);
    }
  }
}

// Soft elliptical falloff for the fake headlight / tail-light spill on the floor.
function lightPoolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.45, '#777');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function createMaterials(paintColor, finish, shape) {
  const m = {
    paint: createCarPaint(paintColor, finish),
    // Smoked, slightly blue-tinted glass: dark enough to hide the cabin, glossy enough to
    // carry crisp env reflections across the canopy.
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x0b1420,
      metalness: 0.2,
      roughness: 0.02,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      transparent: true,
      opacity: 0.88,
      envMapIntensity: 2.2,
    }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.55, metalness: 0.3 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.3, metalness: 0.6 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.08, metalness: 1 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.92, metalness: 0 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.4, metalness: 0.9 }),
    caliper: new THREE.MeshStandardMaterial({ color: shape.caliper, roughness: 0.35, metalness: 0.2 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x090909, roughness: 0.9 }),
    wellLiner: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.95, side: THREE.DoubleSide }),
    headLens: new THREE.MeshStandardMaterial({ color: 0xdfe8ff, roughness: 0.1, metalness: 0.2, emissive: 0xe8f0ff, emissiveIntensity: 0 }),
    tailLens: new THREE.MeshStandardMaterial({ color: 0x2a0406, roughness: 0.15, metalness: 0.1, emissive: 0xff1a1a, emissiveIntensity: 0.6 }),
    beam: new THREE.MeshBasicMaterial({
      color: 0xcfe0ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    // Cockpit seen through the open door: garage only ('skip' keeps it out of race bakes).
    cockpit: new THREE.MeshStandardMaterial({ name: 'skip', color: 0x141416, roughness: 0.85, side: THREE.BackSide }),
    seat: new THREE.MeshStandardMaterial({ name: 'skip', color: 0x1b1b1f, roughness: 0.7 }),
    stitch: new THREE.MeshStandardMaterial({ name: 'skip', color: 0xc8102e, roughness: 0.5 }),
    doorCard: new THREE.MeshStandardMaterial({ name: 'skip', color: 0x1a1a1d, roughness: 0.8, side: THREE.BackSide }),
  };
  // Race baking gives every car its own brake-light material; this flag finds it.
  m.tailLens.userData.tailLight = true;
  return m;
}

function tireGeometry(segments = 40, corner = 6) {
  // Rounded tire cross-section revolved around the wheel axis.
  const pts = [];
  const inner = 0.235;
  const outer = REF_RADIUS;
  const half = 0.125;
  const r = 0.05;
  pts.push(new THREE.Vector2(inner, -half));
  for (let i = 0; i <= corner; i++) {
    const a = -Math.PI / 2 + (i / corner) * (Math.PI / 2);
    pts.push(new THREE.Vector2(outer - r + Math.cos(a) * r, -half + r + Math.sin(a) * r));
  }
  for (let i = 0; i <= corner; i++) {
    const a = (i / corner) * (Math.PI / 2);
    pts.push(new THREE.Vector2(outer - r + Math.cos(a) * r, half - r + Math.sin(a) * r));
  }
  pts.push(new THREE.Vector2(inner, half));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.rotateX(Math.PI / 2);
  return geo;
}

// A wheel is a still group (brake disc, caliper) and a spinning group (tyre and rim), both
// scaled from the reference size to the car's tyre radius.
function createWheel(m, side, sharedTire, rimId, scale, detail) {
  const wheel = new THREE.Group();
  const spin = new THREE.Group();
  spin.scale.setScalar(scale);
  wheel.add(spin);
  fillSpin(spin, m, side, sharedTire, rimId, detail);

  // Brake disc and caliper stay still while the wheel spins.
  const still = new THREE.Group();
  still.scale.setScalar(scale);
  wheel.add(still);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.025, Math.max(8, Math.round(32 * detail))), m.disc);
  disc.rotation.x = Math.PI / 2;
  disc.position.z = 0.02 * side;
  still.add(disc);
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.06), m.caliper);
  caliper.name = 'caliper';
  // Hidden behind the rim from most angles: left out of the showroom's floor mirror.
  disc.userData.noReflect = caliper.userData.noReflect = true;
  caliper.position.set(-0.11, 0.11, 0.045 * side);
  caliper.rotation.z = 0.8;
  still.add(caliper);

  return { wheel, spin, side };
}

function fillSpin(spin, m, side, sharedTire, rimId, detail) {
  const tire = new THREE.Mesh(sharedTire, m.tire);
  tire.castShadow = true;
  spin.add(tire);
  for (const part of buildRim(rimId, side, m.chrome, detail)) spin.add(part);
}

// ---------------------------------------------------------------------------
// Aero kits and rear wings
// ---------------------------------------------------------------------------

// Style kits: parts every car of that style wears. `k` has the materials, the shape, the
// body's top profile and helpers to add a part or seat one flush on the body.
const KITS = {
  // Valkyrie GT-R: front canards, roof scoop, side blades and a shark fin.
  hyper(k) {
    const { m, add, s } = k;
    const c = s.cabin;
    for (const z of [-1, 1]) {
      const canard = add(new THREE.BoxGeometry(0.22, 0.02, 0.16), m.carbon, s.front - 0.24, s.nose + s.ride, z * 0.8);
      canard.rotation.x = z * 0.35;
      canard.rotation.z = 0.18;
      add(new THREE.BoxGeometry(0.9, 0.14, 0.03), m.carbon, -0.75, s.sill + s.ride + 0.31, z * (s.width - 0.015)); // side blade
    }
    const scoop = add(new THREE.BoxGeometry(0.42, 0.11, 0.3), m.carbon, c.roofEnd + 0.65, c.roof + s.ride - 0.11, 0);
    scoop.rotation.z = -0.08;
    add(new THREE.BoxGeometry(0.03, 0.08, 0.22), m.trim, c.roofEnd + 0.87, c.roof + s.ride - 0.11, 0); // scoop mouth
    add(new THREE.BoxGeometry(1.1, 0.02, 0.012), m.carbon, c.roofEnd - 0.15, c.roof + s.ride - 0.22, 0); // shark fin
  },
  // Front canards (cab-forward hypercars, whose doors leave no room for side blades).
  canards(k) {
    const { m, add, s } = k;
    for (const z of [-1, 1]) {
      const canard = add(new THREE.BoxGeometry(0.24, 0.02, 0.18), m.carbon, s.front - 0.22, s.nose + s.ride + 0.02, z * (s.width - 0.16));
      canard.rotation.x = z * 0.3;
      canard.rotation.z = 0.2;
    }
  },
  // Dark intakes on the rear quarters, just behind the doors.
  vents(k) {
    const { m, seatOn, s } = k;
    for (const z of [-1, 1]) {
      const theta = z > 0 ? 0.12 : Math.PI - 0.12;
      seatOn(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.03), m.trim), s.door.rear - 0.2, theta, 0.006);
    }
  },
  // Wide carbon splitter with end plates and diffuser fins.
  splitter(k) {
    const { m, add, s } = k;
    const y = s.sill + s.ride;
    add(new THREE.BoxGeometry(0.3, 0.025, s.width * 1.5), m.carbon, s.front - 0.3, y - 0.02, 0);
    for (const z of [-1, 1]) add(new THREE.BoxGeometry(0.26, 0.09, 0.02), m.carbon, s.front - 0.32, y + 0.025, z * s.width * 0.75);
    for (const z of [-0.45, -0.15, 0.15, 0.45]) add(new THREE.BoxGeometry(0.42, 0.12, 0.015), m.carbon, -s.rear + 0.28, y + 0.04, z);
  },
  // Raised bonnet scoop.
  scoop(k) {
    const { m, add, s, top } = k;
    const x = s.front - 0.32 + (s.cowlX - s.front + 0.32) * 0.45;
    const y = top(x);
    const scoop = add(new THREE.BoxGeometry(0.52, 0.07, 0.46), m.paint, x, y, 0);
    scoop.rotation.z = Math.atan2(top(x - 0.2) - top(x + 0.2), 0.4) * -1;
    add(new THREE.BoxGeometry(0.03, 0.05, 0.38), m.trim, x + 0.26, y + 0.04, 0);
  },
  // Shark fin along the engine cover.
  fin(k) {
    const { m, add, s, top } = k;
    const x = s.cabin.roofEnd - 0.35;
    add(new THREE.BoxGeometry(0.9, 0.08, 0.012), m.carbon, x, top(x) + 0.06, 0);
  },
  // Rally: roof rails, a four-lamp light pod, skid plate and mud flaps.
  rally(k) {
    const { m, add, s } = k;
    const c = s.cabin;
    // Along the flat of the roof only.
    const len = c.roofFront - c.roofEnd - 0.8;
    for (const z of [-1, 1]) add(new THREE.BoxGeometry(len, 0.035, 0.035), m.trim, (c.roofFront + c.roofEnd) / 2 - 0.2, c.roof + s.ride + 0.01, z * c.width * 0.6);
    for (const z of [-0.45, -0.15, 0.15, 0.45]) {
      const housing = add(new THREE.CylinderGeometry(0.075, 0.08, 0.06, 18).rotateZ(Math.PI / 2), m.trim, s.front - 0.02, s.nose + s.ride + 0.1, z);
      housing.name = 'body';
      const lens = add(new THREE.CylinderGeometry(0.062, 0.062, 0.012, 18).rotateZ(Math.PI / 2), m.headLens, s.front + 0.014, s.nose + s.ride + 0.1, z, 'headlight');
      lens.name = 'headlight';
    }
    add(new THREE.BoxGeometry(0.03, 0.05, 1.0), m.trim, s.front - 0.02, s.nose + s.ride + 0.1, 0); // light bar
    add(new THREE.BoxGeometry(0.7, 0.025, 0.8), m.chrome, s.front - 0.4, s.sill + s.ride - 0.03, 0); // skid plate
    // Mud flaps behind the rear wheels.
    for (const z of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.2, 0.26), m.trim, -s.wheelBase - s.archRadius - 0.02, 0.17, z * s.track);
  },
  // Muscle: chin spoiler and rear-quarter scoops.
  muscle(k) {
    const { m, add, seatOn, s } = k;
    add(new THREE.BoxGeometry(0.22, 0.03, s.width * 1.7), m.trim, s.front - 0.16, s.nose + s.ride - 0.12, 0);
    for (const z of [-1, 1]) {
      const theta = z > 0 ? 0.18 : Math.PI - 0.18;
      seatOn(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.03), m.trim), -s.wheelBase + 0.62, theta, 0.006);
    }
  },
};

// Rear wings, mounted at the style's wing mount (deck, or the roof's trailing edge on hatches).
function buildWing(type, s, m, surface) {
  const g = new THREE.Group();
  g.name = 'spoiler';
  if (!type) return g;
  const { x, roof } = s.wingMount;
  // Sit on the actual surface under the mount (the profiles curve away from the nominal heights).
  const y = roof ? surface.cabinTop(x) : surface.top(x);
  const span = roof ? s.cabin.width * 2.05 : s.width * 1.8;
  const part = (w, h, d, mat, px, py, pz, rz = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(px, py, pz);
    mesh.rotation.z = rz;
    mesh.name = 'body';
    g.add(mesh);
    return mesh;
  };
  if (type === 'ducktail') {
    part(0.15, 0.045, span * 0.86, m.paint, x + (roof ? -0.02 : 0.16), y + 0.03, 0, 0.42);
  } else if (type === 'roof') {
    part(0.36, 0.03, span, m.paint, x - 0.08, y + 0.05, 0, -0.06);
    for (const z of [-1, 1]) part(0.32, 0.1, 0.02, m.paint, x - 0.06, y + 0.02, z * span * 0.5);
  } else if (type === 'deck') {
    part(0.3, 0.025, span, m.carbon, x + 0.05, y + 0.1, 0, -0.08);
    for (const z of [-0.3, 0.3]) part(0.22, 0.09, 0.02, m.carbon, x + 0.05, y + 0.05, z * span);
  } else if (type === 'hyper') {
    // The Valkyrie GT-R's original wing.
    part(0.34, 0.035, 1.78, m.carbon, x, y + 0.21, 0, -0.12);
    part(0.05, 0.16, 1.78, m.paint, x - 0.17, y + 0.25, 0); // gurney flap
    for (const z of [-1, 1]) {
      part(0.4, 0.2, 0.025, m.carbon, x, y + 0.23, z * 0.9); // end plates
      part(0.07, 0.32, 0.04, m.carbon, x + 0.02, y + 0.04, z * 0.42, 0.25);
    }
  } else {
    // GT wing on pedestal struts, or a swan-neck wing hung from struts that curl over the top.
    const swan = type === 'swan-neck';
    const h = (roof ? 0.12 : swan ? 0.36 : 0.26) + 0.02;
    const chord = swan ? 0.4 : 0.32;
    part(chord, 0.035, span * (swan ? 1.04 : 1), m.carbon, x, y + h, 0, swan ? -0.14 : -0.1);
    part(0.03, 0.06, span * (swan ? 1.04 : 1), m.carbon, x - chord / 2, y + h + 0.03, 0); // gurney
    for (const z of [-1, 1]) {
      part(chord + 0.08, swan ? 0.24 : 0.18, 0.02, m.carbon, x, y + h, z * span * (swan ? 0.52 : 0.5));
      if (swan) {
        part(0.05, h + 0.06, 0.03, m.carbon, x + 0.12, y + h / 2 + 0.03, z * 0.34, 0.3);
        part(0.14, 0.03, 0.03, m.carbon, x + 0.02, y + h + 0.05, z * 0.34);
      } else {
        part(0.06, h, 0.03, m.carbon, x + 0.02, y + h / 2, z * 0.38);
      }
    }
  }
  return g;
}

// Spring for the hydraulic door struts: a little under-damped, so the door settles with a
// soft overshoot instead of stopping dead.
const DOOR = { stiffness: 16, damping: 7, swing: 1.05, scissor: 1.2, butterfly: 1.0 };

// Car-space door handle and the hinge the panel turns on, from the door panel's vertices.
function doorFrame(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index.array;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < idx.length; i++) box.expandByPoint(v.fromBufferAttribute(pos, idx[i]));
  return box;
}

// Level of detail for race cars: keeps every car's race mesh under the 10,000-triangle
// mobile budget (test/roster.test.js checks each style with its heaviest rim and wing).
export const RACE_DETAIL = 0.5;

// `detail` scales the loft resolution (1 = showroom; the race uses RACE_DETAIL). `style`
// picks the body (carShapes.js; `kit` is the old name), `rim` one of the six rim designs and
// `spoiler` the rear wing ('factory' keeps the style's own).
export function createCar({ paintColor, finish, detail = 1, style, kit, rim = 'stock', spoiler = 'factory' }) {
  const s = shapeFor(style ?? kit ?? 'coupe');
  const res = (n) => Math.max(8, Math.round((n * detail) / 4) * 4);
  const m = createMaterials(paintColor, finish, s);
  const sec = buildSections(s);
  const car = new THREE.Group();
  car.name = s.id;

  const body = loft(sec.body, { x0: -(s.rear - 0.02), x1: s.front - 0.02, stations: res(96), ring: res(64), deform: sec.carve, classify: sec.bodyClass });
  const bodyMesh = new THREE.Mesh(body.geo, m.paint);
  bodyMesh.name = 'body';
  car.add(bodyMesh);

  const c = s.cabin;
  const cabin = loft(sec.cabin, { x0: c.tail, x1: c.front, stations: res(64), ring: res(48), classify: sec.cabinClass });
  const cabinMesh = new THREE.Mesh(cabin.geo, [m.paint, m.glass]);
  cabinMesh.name = 'body';
  car.add(cabinMesh);

  const interior = new THREE.Mesh(new THREE.BoxGeometry(Math.min(1.5, c.front - c.tail - 1.2), 0.2, c.width * 1.22), m.interior);
  interior.position.set((c.front + c.tail) / 2 + 0.1, c.base + s.ride + 0.14, 0);
  car.add(interior);

  // Dark wheel-well liners so the arches read as openings: from inboard of the tyre out to
  // the body side, wrapped over the top and down the front and back of the wheel.
  const linerIn = s.track - 0.55;
  for (const x of [s.wheelBase, -s.wheelBase]) {
    // Stop at the body side where it is narrowest across the arch, so no liner pokes out.
    const side = (xx) => sec.body(xx, 0).z;
    const linerOut = Math.min(side(x - s.archRadius * 0.7), side(x), side(x + s.archRadius * 0.7)) - 0.01;
    const linerGeo = new THREE.CylinderGeometry(s.archRadius - 0.01, s.archRadius - 0.01, linerOut - linerIn, res(28) / 2, 1, true, -Math.PI * 0.6, Math.PI * 1.2);
    linerGeo.rotateX(Math.PI / 2);
    for (const z of [-1, 1]) {
      const liner = new THREE.Mesh(linerGeo, m.wellLiner);
      liner.userData.noReflect = true;
      liner.position.set(x, s.wheel, (z * (linerIn + linerOut)) / 2);
      car.add(liner);
    }
  }

  // Seats a thin part flush on the body surface, facing outward.
  const seatOn = (mesh, x, theta, lift = 0.004, parent = car) => {
    const { position, normal } = surfaceFrame(sec.body, x, theta, sec.carve);
    mesh.position.copy(position).addScaledVector(normal, lift);
    mesh.lookAt(position.clone().add(normal));
    parent.add(mesh);
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
  const y0 = s.ride;
  add(new THREE.BoxGeometry(0.16, 0.07, 0.7), m.trim, s.front - 0.11, s.nose + y0 - 0.07, 0); // lower air intake
  add(new THREE.BoxGeometry(0.26, 0.03, 1.2), m.carbon, s.front - 0.3, s.sill + y0 - 0.01, 0); // front splitter
  add(new THREE.BoxGeometry(0.4, 0.09, 1.4), m.carbon, -s.rear + 0.3, s.sill + y0 + 0.03, 0); // rear diffuser
  const exhaustX = s.exhaust.x ?? -s.rear + 0.06;
  const ex = s.exhaust;
  const exhaustZ = ex.count === 1 ? [ex.spread] : ex.count === 3 ? [-ex.spread, 0, ex.spread] : ex.count === 4 ? [-ex.spread, -ex.spread + 0.13, ex.spread - 0.13, ex.spread] : [-ex.spread, ex.spread];
  for (const z of exhaustZ) add(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 16).rotateZ(Math.PI / 2), m.chrome, exhaustX, ex.y + y0, z);
  for (const z of [-1, 1]) {
    add(new THREE.BoxGeometry(Math.max(0.6, 2 * (s.wheelBase - 0.45)), 0.06, 0.05), m.carbon, 0, s.sill + y0 + 0.03, z * (s.width - 0.04)); // side skirt
    const mirror = add(new THREE.SphereGeometry(0.09, 16, 10).scale(1.2, 0.7, 1), m.paint, c.front - 0.43, c.base + y0 + 0.14, z * (c.width + 0.07));
    mirror.rotation.y = -0.25 * z;
    add(new THREE.BoxGeometry(0.06, 0.025, 0.14), m.trim, c.front - 0.41, c.base + y0 + 0.12, z * (c.width - 0.02)); // mirror stalk
  }
  const top = profile(s.profiles.top);
  for (const name of s.kit) KITS[name]?.({ m, add, seatOn, s, top });

  // Lights. Slim LED headlights, wraparound tail lights, soft beams and light pools on the
  // floor. No real light sources: every dynamic light adds a loop to every shader in the
  // scene, so the pools fake the spill with one additive decal each.
  const lights = { pools: [], beams: [] };
  for (const z of [-1, 1]) {
    const side = (theta) => (z > 0 ? theta : Math.PI - theta);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.02), m.headLens);
    lens.name = 'headlight';
    seatOn(lens, s.front - 0.12, side(0.55), 0.004);

    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.02), m.headLens);
    drl.name = 'headlight';
    seatOn(drl, s.front - 0.08, side(0.3), 0.004);

    const beamGeo = new THREE.ConeGeometry(0.9, 4.2, 24, 1, true);
    beamGeo.translate(0, -2.1, 0);
    beamGeo.rotateZ(Math.PI / 2 + 0.12);
    const beam = add(beamGeo, m.beam, s.front - 0.07, s.nose + y0 + 0.18, z * 0.5, 'beam');
    beam.rotation.y = -0.08 * z;
    lights.beams.push(beam);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.02), m.tailLens);
    tail.name = 'taillight';
    seatOn(tail, -s.rear + 0.025, side(0.6), 0.004);
  }
  add(new THREE.BoxGeometry(0.02, 0.028, 1.0), m.tailLens, -s.rear + 0.018, s.tail + y0 - 0.04, 0, 'taillight');
  const poolTex = lightPoolTexture();
  for (const [x, len, width, color] of [[s.front + 2.9, 6.4, 3.6, 0xdfe9ff], [-s.rear - 0.7, 1.8, 2.2, 0xff2a2a]]) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      alphaMap: poolTex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const pool = add(new THREE.PlaneGeometry(len, width).rotateX(-Math.PI / 2), mat, x, 0.012, 0, 'beam');
    pool.visible = false;
    lights.pools.push(pool);
  }

  // Driver door (the +z side, facing the garage's hero shot): the panel cut out of the body
  // and greenhouse lofts, hung on a hinge at its leading edge, with the cockpit behind it.
  const door = new THREE.Group();
  door.name = 'door';
  const doorBox = doorFrame(body.door);
  const lift = s.door.type !== 'swing';
  const hinge = new THREE.Vector3(doorBox.max.x, lift ? doorBox.max.y : (doorBox.min.y + doorBox.max.y) / 2, doorBox.max.z - 0.03);
  door.position.copy(hinge);
  car.add(door);
  const hung = (geo, mat) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(hinge).negate();
    mesh.name = 'door';
    door.add(mesh);
    return mesh;
  };
  hung(body.door, m.paint);
  if (cabin.door) hung(cabin.door, [m.paint, m.glass]);
  hung(body.door, m.doorCard).castShadow = false;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.026, 0.022), m.chrome);
  handle.name = 'door';
  const handleX = s.door.rear + 0.24;
  const handleFrame = surfaceFrame(sec.body, handleX, 0.36, sec.carve);
  seatOn(handle, handleX, 0.36, 0.008, door);
  handle.position.sub(hinge);
  // The tap hotspot sits on the handle; the garage projects it to the screen.
  const doorAnchor = handleFrame.position.clone().addScaledVector(handleFrame.normal, 0.06);

  // Cockpit tub, seats and wheel (visible only with the door open; never baked for the race).
  const doorLen = s.door.front - s.door.rear;
  const midX = (s.door.front + s.door.rear) / 2;
  // Below the body's top line along the whole opening, so it never shows through the hood.
  const tubTop = Math.min(top(s.door.front + 0.05), top(s.door.rear - 0.05), s.belt + y0) - 0.03;
  const tubH = tubTop - (s.sill + y0 + 0.02);
  const tub = add(new THREE.BoxGeometry(doorLen + 0.1, tubH, (s.width - 0.08) * 2), m.cockpit, midX, s.sill + y0 + 0.02 + tubH / 2, 0);
  tub.castShadow = false;
  for (const z of [-0.36, 0.36]) {
    add(new THREE.BoxGeometry(0.5, 0.1, 0.42), m.seat, midX - 0.12, s.sill + y0 + 0.18, z);
    const back = add(new THREE.BoxGeometry(0.11, 0.58, 0.42), m.seat, midX - 0.42, s.sill + y0 + 0.46, z);
    back.rotation.z = -0.18;
    add(new THREE.BoxGeometry(0.115, 0.5, 0.06), m.stitch, midX - 0.42, s.sill + y0 + 0.46, z).rotation.z = -0.18;
  }
  const wheelRing = add(new THREE.TorusGeometry(0.15, 0.018, 8, 24), m.seat, Math.min(s.door.front - 0.12, c.front - 0.6), c.base + y0 + 0.08, 0.36);
  wheelRing.rotation.y = Math.PI / 2;
  wheelRing.rotation.x = 0.4;

  // Rear wing ('factory' keeps the style's own).
  let spoilerId = spoiler;
  const surface = { top, cabinTop: profile(s.profiles.cabinTop) };
  let wing = buildWing(spoiler === 'factory' ? s.wing : spoiler, s, m, surface);
  car.add(wing);

  // Wheels.
  const tireGeo = tireGeometry(res(40), detail < 1 ? 3 : 6);
  const scale = s.wheel / REF_RADIUS;
  const wheels = [];
  const wheelPositions = [
    [s.wheelBase, s.track],
    [s.wheelBase, -s.track],
    [-s.wheelBase, s.track],
    [-s.wheelBase, -s.track],
  ];
  wheelPositions.forEach(([x, z], index) => {
    const w = createWheel(m, Math.sign(z), tireGeo, rim, scale, detail);
    w.wheel.position.set(x, s.wheel, z);
    car.add(w.wheel);
    wheels.push(w);
  });
  const tagWheels = () =>
    wheels.forEach(({ wheel }, index) =>
      wheel.traverse((o) => {
        o.userData.wheelIndex = index;
      })
    );
  tagWheels();

  const castShadows = (root) =>
    root.traverse((o) => {
      if (o.isMesh && o.name !== 'beam' && o.castShadow !== false && o.material?.name !== 'skip') o.castShadow = true;
    });
  castShadows(car);
  for (const o of [tub]) o.castShadow = false;
  mergeSiblings(car);

  let rimId = rim;
  let lightsOn = false;
  let lightLevel = 0;
  let wheelSpeed = 0;
  let doorTarget = 0;
  let doorK = 0;
  let doorV = 0;
  let wingK = 1;

  const disposeTree = (root) => root.traverse((o) => o.isMesh && o.geometry !== tireGeo && o.geometry.dispose());

  return {
    group: car,
    source: 'procedural',
    style: s.id,
    shape: s,
    paintMaterial: m.paint,
    wheels,
    wheelRadius: s.wheel,
    // Nitro flame anchors (car space), at the exhaust tips.
    exhausts: exhaustZ.map((z) => new THREE.Vector3(exhaustX - 0.04, ex.y + y0, z)),
    get lightsOn() {
      return lightsOn;
    },
    setLights(on) {
      lightsOn = on;
    },
    spinWheels(speed) {
      wheelSpeed = speed;
    },
    get rim() {
      return rimId;
    },
    // Swaps every wheel's rim in place.
    setRim(id) {
      if (id === rimId) return;
      rimId = id;
      for (const w of wheels) {
        const old = [...w.spin.children];
        old.forEach((o) => {
          w.spin.remove(o);
          if (o.geometry !== tireGeo) o.geometry.dispose();
        });
        fillSpin(w.spin, m, w.side, tireGeo, id, detail);
        castShadows(w.spin);
        mergeSiblings(w.spin);
      }
      tagWheels();
      wheelSpeed = Math.max(wheelSpeed, 10);
    },
    get spoiler() {
      return spoilerId;
    },
    // Bolts a different rear wing on; it rises into place.
    setSpoiler(id) {
      if (id === spoilerId) return;
      spoilerId = id;
      car.remove(wing);
      disposeTree(wing);
      wing = buildWing(id === 'factory' ? s.wing : id, s, m, surface);
      castShadows(wing);
      mergeSiblings(wing);
      car.add(wing);
      wingK = 0;
    },
    // Driver door: car-space hotspot position and outward normal, and the open state.
    door: {
      anchor: doorAnchor,
      normal: handleFrame.normal.clone(),
      type: s.door.type,
      get open() {
        return doorTarget === 1;
      },
      toggle() {
        doorTarget = doorTarget ? 0 : 1;
        return doorTarget === 1;
      },
      close() {
        doorTarget = 0;
      },
    },
    update(dt) {
      // Lights fade rather than pop, which reads better on a phone screen.
      const target = lightsOn ? 1 : 0;
      lightLevel += (target - lightLevel) * Math.min(1, dt * 10);
      m.headLens.emissiveIntensity = lightLevel * 3.2;
      m.tailLens.emissiveIntensity = 0.6 + lightLevel * 3;
      m.beam.opacity = lightLevel * 0.07;
      lights.pools.forEach((p, i) => {
        p.visible = lightLevel > 0.01;
        p.material.opacity = lightLevel * (i === 0 ? 0.55 : 0.35);
      });
      lights.beams.forEach((b) => (b.visible = lightLevel > 0.01));

      wheelSpeed *= Math.pow(0.35, dt);
      if (wheelSpeed > 0.01) wheels.forEach(({ spin }) => (spin.rotation.z -= wheelSpeed * dt));

      // Door on its hydraulic strut.
      if (doorTarget !== doorK || Math.abs(doorV) > 1e-4) {
        const h = Math.min(dt, 1 / 30);
        doorV += (DOOR.stiffness * (doorTarget - doorK) - DOOR.damping * doorV) * h;
        doorK += doorV * h;
        if (Math.abs(doorTarget - doorK) < 1e-4 && Math.abs(doorV) < 1e-3) {
          doorK = doorTarget;
          doorV = 0;
        }
        const k = Math.max(-0.05, doorK);
        if (s.door.type === 'scissor') door.rotation.set(0, 0, -DOOR.scissor * k);
        else if (s.door.type === 'butterfly') door.rotation.set(-0.42 * k, 0.25 * k, -DOOR.butterfly * k);
        else door.rotation.set(0, DOOR.swing * k, 0);
      }

      // A new wing rises out of the deck.
      if (wingK < 1) {
        wingK = Math.min(1, wingK + dt * 2.2);
        const e = 1 - Math.pow(1 - wingK, 3);
        wing.scale.set(1, Math.max(0.01, e), 1);
        wing.position.y = (1 - e) * -0.08;
      }
    },
  };
}
