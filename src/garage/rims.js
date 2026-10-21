import * as THREE from 'three';

// The six rim designs (catalog RIMS), built at the reference tyre size (0.34 m radius,
// 0.236 m barrel); carModel.js scales the whole wheel to each car's tyre. Every design is a
// few shared primitives so the race baker folds it into the instanced wheel batch.
//
// `side` is +1 for the car's right wheels and -1 for the left: the face sits at z = 0.09 * side.

const FACE = 0.09;

function finishes() {
  return {
    silver: new THREE.MeshStandardMaterial({ color: 0xc3c8cf, roughness: 0.16, metalness: 1, envMapIntensity: 1.4 }),
    champagne: new THREE.MeshStandardMaterial({ color: 0xcdb98c, roughness: 0.2, metalness: 1, envMapIntensity: 1.3 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.38, metalness: 0.15 }),
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.22, metalness: 1, envMapIntensity: 1.3 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.24, metalness: 1, envMapIntensity: 1.3 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.28, metalness: 0.55 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xe0162b, roughness: 0.3, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.6, metalness: 0.2 }),
  };
}

let shared = null;
const mats = () => (shared ??= finishes());

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// Spokes radiating from the hub: `make(i)` returns one spoke geometry pointing along +x.
function radial(count, geo, mat, side, { offset = 0, z = FACE, twist = 0 } = {}) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.z = offset + (i / count) * Math.PI * 2;
    mesh.rotation.x = twist * side;
    mesh.position.z = z * side;
    out.push(mesh);
  }
  return out;
}

// Segment counts scale with the car's level of detail (1 = showroom, ~0.5 = race).
let detail = 1;
const seg = (n) => Math.max(6, Math.round(n * detail));

function hub(mat, side, r = 0.055) {
  const h = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.005, 0.05, seg(20)), mat);
  h.rotation.x = Math.PI / 2;
  h.position.z = (FACE + 0.01) * side;
  return h;
}

function lip(mat, side, r = 0.232, tube = 0.012) {
  const l = new THREE.Mesh(new THREE.TorusGeometry(r, tube, detail < 1 ? 4 : 8, seg(40)), mat);
  l.position.z = (FACE + 0.02) * side;
  return l;
}

function barrel(mat) {
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.236, 0.236, 0.22, seg(32), 1, true), mat);
  b.rotation.x = Math.PI / 2;
  return b;
}

// Tapered spoke from the hub to the rim as a flat extrusion (wide at the rim).
function taperedSpoke(inner, outer, length, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(0, -inner / 2);
  shape.lineTo(length, -outer / 2);
  shape.lineTo(length, outer / 2);
  shape.lineTo(0, inner / 2);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0.04, 0, -depth / 2);
  return geo;
}

const BUILDERS = {
  // Five split spokes, polished silver (the original wheel).
  stock(side, chrome) {
    const m = mats();
    const spoke = box(0.2, 0.034, 0.03).translate(0.11, 0, 0);
    const parts = [barrel(m.silver), lip(chrome, side), hub(chrome, side)];
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(spoke, m.silver);
      s.rotation.z = Math.floor(i / 2) * ((Math.PI * 2) / 5) + (i % 2 === 0 ? -0.09 : 0.09);
      s.position.z = FACE * side;
      parts.push(s);
    }
    return parts;
  },
  // Cross-laced classic mesh in champagne gold with a polished lip.
  mesh(side, chrome) {
    const m = mats();
    const spoke = box(0.19, 0.012, 0.016).translate(0.115, 0, 0);
    const parts = [barrel(m.champagne), lip(chrome, side, 0.232, 0.016), hub(m.champagne, side, 0.065)];
    for (let i = 0; i < 20; i++) {
      const s = new THREE.Mesh(spoke, m.champagne);
      s.rotation.z = (i / 20) * Math.PI * 2 + (i % 2 ? 0.32 : -0.32);
      s.position.z = (FACE - (i % 2) * 0.012) * side;
      parts.push(s);
    }
    return parts;
  },
  // Satin-white disc with twelve angled turbofan blades.
  turbofan(side, chrome) {
    const m = mats();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.012, seg(32)), m.white);
    disc.rotation.x = Math.PI / 2;
    disc.position.z = (FACE - 0.012) * side;
    return [
      barrel(m.white),
      disc,
      lip(m.dark, side, 0.226, 0.014),
      hub(chrome, side, 0.06),
      ...radial(12, box(0.15, 0.03, 0.022).translate(0.13, 0, 0), m.white, side, { twist: 0.55 }),
    ];
  },
  // Five long twin blades in gunmetal, each pair swept forward.
  blade(side, chrome) {
    const m = mats();
    const blade = box(0.21, 0.022, 0.03).translate(0.115, 0, 0);
    const parts = [barrel(m.gunmetal), lip(chrome, side), hub(m.gunmetal, side)];
    for (let i = 0; i < 5; i++) {
      for (const k of [-1, 1]) {
        const b = new THREE.Mesh(blade, m.gunmetal);
        b.rotation.z = (i / 5) * Math.PI * 2 + k * 0.17 + 0.12;
        b.position.z = FACE * side;
        parts.push(b);
      }
    }
    return parts;
  },
  // Six thick tapered forged spokes in bronze.
  monoblock(side) {
    const m = mats();
    return [
      barrel(m.bronze),
      lip(m.bronze, side, 0.23, 0.016),
      hub(m.bronze, side, 0.07),
      ...radial(6, taperedSpoke(0.05, 0.085, 0.165, 0.045), m.bronze, side),
    ];
  },
  // Closed carbon aero disc with five cooling slots and a red accent ring.
  'carbon-aero'(side) {
    const m = mats();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.226, 0.226, 0.03, seg(36)), m.carbon);
    disc.rotation.x = Math.PI / 2;
    disc.position.z = (FACE - 0.005) * side;
    return [
      barrel(m.carbon),
      disc,
      lip(m.accent, side, 0.2, 0.008),
      hub(m.accent, side, 0.05),
      ...radial(5, box(0.07, 0.022, 0.012).translate(0.15, 0, 0), m.dark, side, { z: FACE + 0.012, offset: 0.3 }),
    ];
  },
};

export const RIM_IDS = Object.keys(BUILDERS);

// Meshes for one rim face (barrel, spokes, lip and hub) at the reference size.
export function buildRim(rimId, side, chrome, lod = 1) {
  detail = lod;
  return (BUILDERS[rimId] ?? BUILDERS.stock)(side, chrome);
}
