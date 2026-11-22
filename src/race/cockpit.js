import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Driver view cabin (camera view 'cockpit'): one generic cockpit shared by every car. Built
// round the driver's eye (x forward, y up, z right, in metres from the eye), so it fits any
// car the eye is placed in (race/chaseCamera.js cockpitEye). The car's centre line is 0.36 m
// to the driver's right.
//
//   shell     sculpted dashboard with a hood over the instruments, A-pillars, roof lining,
//             door tops and panels, steering column, mirror housings: one merged,
//             vertex-coloured mesh with a soft-touch grain (one 256 px texture)
//   trim      carbon-weave accents tinted with the car's paint (setPaint): dash and door strips,
//             air vents, dash stitching
//   wheel     3-spoke sports wheel with leather grip and two gloved hands on it (one mesh that
//             turns with the steering), its tinted inserts, badge and paddle shifters (one mesh)
//   forearms  two sleeves from the elbows to the gloves, re-aimed every frame
//   display   the instrument cluster in one draw: backlit speedometer and rev counter faces,
//             a digital speed readout, the gear and a row of shift lights (one 512x320 texture,
//             drawn once; the digits and lights change through uniforms only)
//   needles   speedometer and rev counter needles, glowing
//   mirrors   rear-view and left wing mirror. Mid and high GPUs see a live rear view: one
//             256x96 render, every 2nd frame, no post-processing, 120 m draw distance (the
//             only extra pass, and only while the cockpit shows). A low-end GPU gets a sky
//             gradient instead, and no extra pass.
//   glass     a very faint sheen low on the windscreen (not on a low-end GPU)
//
// Drawn on top: every cockpit material squeezes its depth into the front tenth of the depth
// range (DEPTH_FRONT), so a rival car that touches or overlaps the player's car can never
// show inside the cabin, at no cost (no extra pass, no depth clear). Everything stays in the
// lower quarter of the screen (dash ~72% down) or at its edges (pillars, mirrors), so the road
// ahead stays open. 11 draws (10 on a low-end GPU, all unlit), no shadows, no fog.

export const WHEEL_LOCK = 1.9; // radians the wheel turns at full steering lock
export const WHEEL_RATE = 14; // 1/s: how fast the drawn wheel follows the steering input
export const HAND_TURN = 0.5; // radians the hands turn with the wheel before it slides
export const SPEEDO_MAX = 320; // km/h at the end of the dial
export const RPM_MAX = 8000;
export const RPM_RED = 7600;
// Shift lights: they start to fill at SHIFT_FROM rpm, are all lit at RPM_RED and flash on the
// limiter (SHIFT_FLASH and up).
export const SHIFT_LIGHTS = 10;
export const SHIFT_FROM = 4800;
export const SHIFT_FLASH = 7500;
// Glyphs in the cluster texture's digit strip: 0-9, then N, R and a blank.
export const GLYPH = { N: 10, R: 11, BLANK: 12 };
// The live mirror's render target and how often it renders (every Nth frame).
export const MIRROR = { width: 256, height: 96, every: 2, far: 120, fov: 22 };
const GLYPHS = '0123456789NR ';
const SWEEP = (240 * Math.PI) / 180; // dial sweep, needle from lower-left to lower-right

// Needle angle (radians, clockwise from straight up as the driver sees it) for 0..1 of a dial.
export const needleAngle = (k) => -SWEEP / 2 + SWEEP * Math.min(1.04, Math.max(0, k));

// Shift lights lit (0..SHIFT_LIGHTS, fractional) at an rpm.
export const shiftLit = (rpm) => SHIFT_LIGHTS * Math.min(1, Math.max(0, (rpm - SHIFT_FROM) / (RPM_RED - SHIFT_FROM)));

// Gear glyph for the cluster: N on the grid, R reversing, else 1-6 (the gearbox counts from 0).
export const gearGlyph = (gear, neutral = false, reversing = false) => (neutral ? GLYPH.N : reversing ? GLYPH.R : Math.min(9, gear + 1));

// Vertex shader line that pulls a cockpit vertex into the front tenth of the depth range,
// keeping the cabin's own depth order. It is linear in clip space (every vertex's distance to
// the near plane shrinks by the same factor), so triangles that reach behind the camera (the
// door panels) are still clipped exactly where they were.
const DEPTH_FRONT = 'gl_Position.z = mix(-gl_Position.w, gl_Position.z, 0.1);';
function inFront(material) {
  material.onBeforeCompile = drawOnTop;
  material.fog = false;
  return material;
}
function drawOnTop(shader) {
  shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${DEPTH_FRONT}`);
}

const COLORS = {
  dash: 0x26282d,
  dashTop: 0x1c1e22,
  dashLow: 0x202226,
  fabric: 0x3b3d43,
  roof: 0x44464c,
  door: 0x2a2c31,
  doorTop: 0x313338,
  column: 0x1d1f23,
  housing: 0x1e2024,
  leather: 0x1b1a19,
  spoke: 0x2c2e33,
  hub: 0x202226,
  glove: 0x222428,
  knuckle: 0x3d4149,
  cuff: 0x5a5f69,
  sleeve: 0x41454e,
  vent: 0x141519,
  slat: 0x0d0e10,
  white: 0xffffff,
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Every part carries position, normal, uv and colour, so the parts of a mesh merge into one.
function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = _c.set(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

// Texture coordinates in metres (divided by `scale`) from the two axes across each face, so a
// weave keeps one size on every part whatever its shape.
function metricUv(geo, scale) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    const [a, b] = ax >= ay && ax >= az ? [p.getZ(i), p.getY(i)] : ay >= az ? [p.getZ(i), p.getX(i)] : [p.getX(i), p.getY(i)];
    uv.setXY(i, a / scale, b / scale);
  }
  return geo;
}

// A box of size (sx, sy, sz) centred at (x, y, z), turned `rz` about z (nose down when < 0).
function box(sx, sy, sz, x, y, z, hex, rz = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rz) g.rotateZ(rz);
  return paint(g.translate(x, y, z), hex);
}

// A tapered round bar from a (radius r0) to b (radius r1).
function limb(a, b, r0, r1, segs, hex) {
  const dir = _p.subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1);
  _q.setFromUnitVectors(UP, dir.normalize());
  g.applyMatrix4(_m.compose(_a.addVectors(a, b).multiplyScalar(0.5), _q, _s));
  return paint(g, hex);
}

function ball(r, x, y, z, hex, segs = 8, sx = 1, sy = 1, sz = 1) {
  return paint(new THREE.SphereGeometry(r, segs, Math.max(4, segs >> 1)).scale(sx, sy, sz).translate(x, y, z), hex);
}

// A grid surface: point(u, v, out) for u, v in 0..1, nu x nv quads, uv in metres / `uvScale`.
function surface(nu, nv, point, hex, uvScale = 0.25) {
  const pos = [];
  const uv = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      point(i / nu, j / nv, p);
      pos.push(p.x, p.y, p.z);
      uv.push(p.z / uvScale, (p.x + p.y) / uvScale);
    }
  }
  const index = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      index.push(a, a + nu + 1, a + 1, a + 1, a + nu + 1, a + nu + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return paint(g, hex);
}

// An elliptical tube along a quadratic curve a -> c (bent toward `ctrl`): radii `across`
// (in the x-y plane) and `deep` (along z), each tapering from the first value to the second.
function curvedBar(a, ctrl, c, across, deep, steps, segs, hex) {
  const curve = new THREE.QuadraticBezierCurve3(a, ctrl, c);
  const t0 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const b = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);
  return surface(
    segs,
    steps,
    (u, v, out) => {
      curve.getPoint(v, out);
      curve.getTangent(v, t0);
      n.crossVectors(t0, zAxis).normalize();
      b.crossVectors(t0, n).normalize();
      const ang = u * Math.PI * 2;
      const ra = across[0] + (across[1] - across[0]) * v;
      const rb = deep[0] + (deep[1] - deep[0]) * v;
      out.addScaledVector(n, Math.cos(ang) * ra).addScaledVector(b, Math.sin(ang) * rb);
    },
    hex
  );
}

// ---- Shell: dashboard, instrument hood, pillars, roof, doors, column ----

const DASH_Z = [-0.84, 1.54]; // cabin width, door to door
const HOOD_Z = 0.24; // half-width of the hood over the instruments

// Dashboard cross-section (x forward, y up), from the windscreen to below the screen.
const DASH_PROFILE = new THREE.CatmullRomCurve3(
  [v3(1.16, -0.315, 0), v3(1.02, -0.305, 0), v3(0.9, -0.318, 0), v3(0.845, -0.345, 0), v3(0.815, -0.4, 0), v3(0.805, -0.6, 0), v3(0.8, -1.05, 0)],
  false,
  'centripetal'
);
const DASH_LIP = 3 / 6; // where the lip (and its stitching) sits along the profile
const VENTS = [0.25, 0.47, -0.62]; // air vents on the dash face: centre pair and driver's left

function buildShell(lowEnd) {
  const nu = lowEnd ? 18 : 40;
  const nv = lowEnd ? 8 : 16;
  const parts = [];
  // Dashboard: a soft rolled top falling over a lip into the dash face.
  parts.push(
    surface(nu, nv, (u, v, out) => {
      DASH_PROFILE.getPoint(v, out);
      out.z = DASH_Z[0] + (DASH_Z[1] - DASH_Z[0]) * u;
    }, COLORS.dash)
  );
  // Darker top near the glass (cuts the windscreen reflection on real cars).
  parts.push(
    surface(nu, 2, (u, v, out) => {
      DASH_PROFILE.getPoint(v * 0.22, out);
      out.y += 0.002;
      out.z = DASH_Z[0] + (DASH_Z[1] - DASH_Z[0]) * u;
    }, COLORS.dashTop)
  );
  // Hood over the instruments: rises out of the dash top, rounded at the sides, its brow lip
  // just above the top of the dials.
  const hood = new THREE.CatmullRomCurve3([v3(0.98, -0.306, 0), v3(0.9, -0.255, 0), v3(0.84, -0.231, 0), v3(0.808, -0.229, 0), v3(0.796, -0.239, 0)], false, 'centripetal');
  const flat = new THREE.Vector3();
  parts.push(
    surface(lowEnd ? 10 : 22, lowEnd ? 5 : 10, (u, v, out) => {
      const z = (u * 2 - 1) * HOOD_Z;
      const h = Math.sqrt(Math.max(0, 1 - (z / HOOD_Z) ** 4)); // flat top, rounded sides
      hood.getPoint(v, out);
      flat.set(0.98 - 0.12 * v, -0.309, 0);
      out.lerpVectors(flat, out, h);
      out.z = z;
    }, COLORS.dash)
  );
  // Lower dash under the face and both door panels, closing the cabin past the screen edges.
  parts.push(box(0.04, 0.6, DASH_Z[1] - DASH_Z[0], 0.81, -1.2, (DASH_Z[0] + DASH_Z[1]) / 2, COLORS.dashLow));
  for (const z of [DASH_Z[0] + 0.02, DASH_Z[1] - 0.02]) {
    const inward = z < 0 ? 1 : -1;
    parts.push(box(1.75, 1.25, 0.03, 0.25, -0.95, z, COLORS.door));
    // Rounded door top (the window sill) and the armrest bulge below it.
    parts.push(limb(v3(-0.6, -0.315, z + inward * 0.01), v3(1.12, -0.335, z + inward * 0.01), 0.045, 0.045, lowEnd ? 6 : 10, COLORS.doorTop));
    parts.push(limb(v3(-0.5, -0.56, z + inward * 0.035), v3(0.55, -0.56, z + inward * 0.035), 0.05, 0.05, lowEnd ? 6 : 10, COLORS.fabric));
  }
  // A-pillars: tapered and gently bowed, wider at the dash.
  const pillar = (z0, z1, out) =>
    curvedBar(v3(1.14, -0.32, z0), v3(0.9, 0.07, z0 + out), v3(0.53, 0.36, z1), [0.06, 0.04], [0.04, 0.03], lowEnd ? 6 : 12, lowEnd ? 6 : 10, COLORS.fabric);
  parts.push(pillar(-0.71, -0.74, -0.02), pillar(1.37, 1.4, 0.02));
  // Roof header across the top of the windscreen and the roof lining behind it.
  parts.push(limb(v3(0.52, 0.37, -0.76), v3(0.52, 0.37, 1.42), 0.06, 0.06, lowEnd ? 6 : 12, COLORS.roof));
  parts.push(
    surface(4, 3, (u, v, out) => {
      out.set(0.52 - 1.3 * v, 0.42 + 0.05 * Math.sin(v * Math.PI), DASH_Z[0] + (DASH_Z[1] - DASH_Z[0]) * u);
    }, COLORS.roof)
  );
  // Air vents: a dark recess with three slats each.
  for (const z of VENTS) {
    parts.push(box(0.012, 0.052, 0.094, 0.806, -0.402, z, COLORS.vent));
    for (let i = -1; i <= 1; i++) parts.push(box(0.03, 0.005, 0.09, 0.796, -0.402 + i * 0.015, z, COLORS.slat, -0.25));
  }
  // Steering column and its shroud.
  parts.push(limb(v3(0.82, -0.56, 0), v3(0.6, -0.455, 0), 0.04, 0.032, lowEnd ? 6 : 10, COLORS.column));
  parts.push(box(0.1, 0.07, 0.11, 0.75, -0.52, 0, COLORS.column, 0.48));
  // Rear-view mirror housing and stalk; left wing mirror housing on its arm.
  parts.push(box(0.03, 0.08, 0.26, 0.565, 0.235, 0.33, COLORS.housing));
  parts.push(ball(0.04, 0.578, 0.235, 0.2, COLORS.housing, 8, 0.4, 1, 0.5), ball(0.04, 0.578, 0.235, 0.46, COLORS.housing, 8, 0.4, 1, 0.5));
  parts.push(limb(v3(0.56, 0.28, 0.33), v3(0.53, 0.36, 0.33), 0.012, 0.012, 6, COLORS.housing));
  parts.push(box(0.07, 0.12, 0.25, 1.07, -0.2, -0.93, COLORS.housing));
  parts.push(limb(v3(1.06, -0.25, -0.82), v3(1.08, -0.26, -0.86), 0.02, 0.02, 6, COLORS.housing));
  return mergeGeometries(parts);
}

// ---- Trim: tinted carbon accents ----

function buildTrim(lowEnd) {
  const parts = [];
  // Strip across the dash face under the instruments.
  parts.push(box(0.01, 0.022, DASH_Z[1] - DASH_Z[0] - 0.08, 0.807, -0.475, (DASH_Z[0] + DASH_Z[1]) / 2, COLORS.white));
  // Door strips.
  for (const z of [DASH_Z[0] + 0.045, DASH_Z[1] - 0.045]) parts.push(box(1.3, 0.02, 0.01, 0.3, -0.43, z, COLORS.white));
  // Thin tinted rings round the air vents.
  for (const z of VENTS) {
    parts.push(box(0.006, 0.006, 0.1, 0.8, -0.375, z, COLORS.white), box(0.006, 0.006, 0.1, 0.8, -0.429, z, COLORS.white));
    parts.push(box(0.006, 0.06, 0.006, 0.8, -0.402, z - 0.05, COLORS.white), box(0.006, 0.06, 0.006, 0.8, -0.402, z + 0.05, COLORS.white));
  }
  // Stitching along the dash lip (not on a low-end GPU).
  if (!lowEnd) {
    const lip = DASH_PROFILE.getPoint(DASH_LIP, new THREE.Vector3());
    for (let z = DASH_Z[0] + 0.05; z < DASH_Z[1] - 0.05; z += 0.03) {
      if (Math.abs(z) < HOOD_Z + 0.02) continue; // under the hood
      parts.push(box(0.004, 0.004, 0.014, lip.x - 0.004, lip.y + 0.003, z, COLORS.white));
    }
  }
  return metricUv(mergeGeometries(parts), 0.025);
}

// ---- Wheel, its trim and the gloved hands ----

const RIM_R = 0.165;
const GRIP_Y = 0.07; // hands at ten to two

// Gloved hand gripping the rim at 9 o'clock (side -1) or 3 o'clock (side 1), wheel frame.
function hand(side, lowEnd) {
  const z = side * Math.sqrt(RIM_R * RIM_R - GRIP_Y * GRIP_Y);
  const parts = [];
  // The fist wrapped round the rim, a little toward the driver.
  parts.push(paint(new THREE.CapsuleGeometry(0.033, 0.045, lowEnd ? 2 : 4, lowEnd ? 6 : 10).scale(1, 1, 0.92).translate(-0.006, GRIP_Y, z + side * 0.004), COLORS.glove));
  if (!lowEnd) {
    // Knuckles on the outside of the rim.
    for (let i = 0; i < 4; i++) parts.push(ball(0.012, -0.012, GRIP_Y + 0.027 - i * 0.018, z + side * 0.026, COLORS.knuckle, 6));
    // Thumb lying along the rim toward the spoke.
    parts.push(paint(new THREE.CapsuleGeometry(0.011, 0.035, 2, 6).rotateX(Math.PI / 2).translate(-0.024, GRIP_Y - 0.006, z - side * 0.035), COLORS.glove));
  }
  // Back of the hand and the cuff, toward the driver.
  parts.push(limb(v3(-0.02, GRIP_Y - 0.005, z + side * 0.008), v3(-0.07, GRIP_Y - 0.03, z + side * 0.03), 0.03, 0.033, lowEnd ? 6 : 10, COLORS.glove));
  parts.push(limb(v3(-0.07, GRIP_Y - 0.03, z + side * 0.03), v3(-0.12, GRIP_Y - 0.05, z + side * 0.042), 0.036, 0.038, lowEnd ? 6 : 10, COLORS.cuff));
  return parts;
}
// Where each forearm meets its cuff, in the wheel's frame.
const WRIST = [-1, 1].map((side) => v3(-0.12, GRIP_Y - 0.05, side * (Math.sqrt(RIM_R * RIM_R - GRIP_Y * GRIP_Y) + 0.042)));

function buildWheel(lowEnd) {
  const rim = new THREE.TorusGeometry(RIM_R, 0.024, lowEnd ? 6 : 12, lowEnd ? 28 : 56);
  rim.rotateY(Math.PI / 2); // into the wheel's plane (y up, z right), facing the driver
  const parts = [paint(rim, COLORS.leather)];
  // Three spokes: 3, 9 and 6 o'clock.
  parts.push(box(0.022, 0.042, 0.12, 0.004, -0.008, -0.09, COLORS.spoke), box(0.022, 0.042, 0.12, 0.004, -0.008, 0.09, COLORS.spoke));
  parts.push(box(0.022, 0.11, 0.05, 0.004, -0.105, 0, COLORS.spoke));
  parts.push(paint(new THREE.CylinderGeometry(0.052, 0.058, 0.045, lowEnd ? 10 : 20).rotateZ(Math.PI / 2), COLORS.hub));
  return mergeGeometries(parts);
}

const buildHands = (lowEnd) => mergeGeometries([...hand(-1, lowEnd), ...hand(1, lowEnd)]);

function buildWheelTrim(lowEnd) {
  const parts = [];
  // Top-centre stripe on the rim.
  const arc = 0.22;
  const stripe = new THREE.TorusGeometry(RIM_R, 0.0248, lowEnd ? 6 : 10, 8, arc);
  stripe.rotateZ(Math.PI / 2 - arc / 2).rotateY(Math.PI / 2);
  parts.push(paint(stripe, COLORS.white));
  // Spoke inserts.
  parts.push(box(0.004, 0.014, 0.09, -0.009, -0.004, -0.095, COLORS.white), box(0.004, 0.014, 0.09, -0.009, -0.004, 0.095, COLORS.white));
  parts.push(box(0.004, 0.07, 0.012, -0.009, -0.11, 0, COLORS.white));
  // Generic hexagonal badge on the hub.
  parts.push(paint(new THREE.CylinderGeometry(0.02, 0.02, 0.006, 6).rotateZ(Math.PI / 2).rotateX(Math.PI / 6).translate(-0.024, 0, 0), COLORS.white));
  // Paddle shifters behind the wheel, either side of the hub.
  for (const side of [-1, 1]) parts.push(box(0.006, 0.085, 0.07, 0.035, 0.02, side * 0.12, COLORS.white, 0));
  return metricUv(mergeGeometries(parts), 0.025);
}

// ---- Textures, created once ----

// Soft-touch grain for the shell: fine mottled noise round white, multiplied by the vertex
// colours.
function grainTexture() {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  g.fillStyle = '#f0f0f0';
  g.fillRect(0, 0, S, S);
  const img = g.getImageData?.(0, 0, S, S);
  if (img?.data) {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 214 + rnd() * 41;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Carbon weave for the trim: 2x2 twill of light and dark diagonal tows, tinted by the paint.
function carbonTexture() {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  const n = 8;
  const c = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = (i + j) % 2;
      const grad = g.createLinearGradient?.(i * c, j * c, (i + 1) * c, (j + 1) * c);
      if (grad) {
        grad.addColorStop(0, k ? '#6a6a6a' : '#3c3c3c');
        grad.addColorStop(0.5, k ? '#b4b4b4' : '#5a5a5a');
        grad.addColorStop(1, k ? '#6a6a6a' : '#3c3c3c');
        g.fillStyle = grad;
      }
      g.fillRect(i * c, j * c, c, c);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Cluster layout in face pixels (the face is 512 x 256 of the texture, 0.34 m x 0.17 m).
const FACE_W = 0.34;
const FACE_H = 0.17;
const DIAL_R = 92;
const DIAL_L = 104;
const DIAL_R_X = 408;
const DIAL_Y = 150;
const GLYPH_W = 39;
const STRIP_Y = 256; // digit strip below the face, 64 px tall
// The digital panel (gear over speed) sits high, above the wheel rim; the dials below show
// through the wheel's opening and over its rim.
const DIGITS = [
  { x: 256, y: 56, w: 36, h: 54 }, // gear
  { x: 234, y: 104, w: 20, h: 30 }, // speed: hundreds, tens, units
  { x: 256, y: 104, w: 20, h: 30 },
  { x: 278, y: 104, w: 20, h: 30 },
];
const LED = { x0: 139, pitch: 26, y: 15, size: 16 };

// Speedometer and rev counter faces (backlit markings), the digital panel between them and the
// digit strip, drawn once.
function clusterTexture(lowEnd) {
  const s = lowEnd ? 0.5 : 1;
  const W = 512 * s;
  const H = 320 * s;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.scale?.(s, s);
  g.fillStyle = '#050608';
  g.fillRect(0, 0, 512, 320);
  const glow = (color, blur) => {
    g.shadowColor = color;
    g.shadowBlur = blur * s;
  };
  // step: labelled divisions; ticks: minor ticks per division.
  const dial = (cx, max, step, ticks, label, red, unit) => {
    const cy = DIAL_Y;
    const r = DIAL_R;
    const rg = g.createRadialGradient?.(cx, cy, r * 0.2, cx, cy, r);
    if (rg) {
      rg.addColorStop(0, '#11141b');
      rg.addColorStop(1, '#07080b');
      g.fillStyle = rg;
    }
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    glow('rgba(0,0,0,0)', 0);
    g.lineWidth = 4;
    g.strokeStyle = '#8d96a6';
    g.stroke();
    // Canvas angles: 0 = right, clockwise; the needle's 0 is straight up.
    const at = (k) => needleAngle(k) - Math.PI / 2;
    if (red != null) {
      glow('#ff2a2a', 8);
      g.strokeStyle = '#ff3030';
      g.lineWidth = 8;
      g.beginPath();
      g.arc(cx, cy, r - 10, at(red / max), at(1));
      g.stroke();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'italic 800 19px system-ui, sans-serif';
    glow('rgba(140,200,255,0.9)', 6);
    for (let v = 0; v <= max + 1e-6; v += step / ticks) {
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const a = at(v / max);
      const r0 = r - (major ? 20 : 12);
      g.strokeStyle = major ? '#f2f7ff' : 'rgba(220,235,255,0.6)';
      g.lineWidth = major ? 3.5 : 1.8;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * (r - 5), cy + Math.sin(a) * (r - 5));
      g.stroke();
      if (major) {
        g.fillStyle = '#e8f1ff';
        const rt = r - 34;
        g.fillText(String(Math.round(label(v))), cx + Math.cos(a) * rt, cy + Math.sin(a) * rt);
      }
    }
    glow('rgba(0,0,0,0)', 0);
    g.font = '700 11px system-ui, sans-serif';
    g.fillStyle = 'rgba(190,210,235,0.75)';
    g.fillText(unit, cx, cy + 46);
    // Hub cap the needle turns on.
    g.fillStyle = '#2a2f38';
    g.beginPath();
    g.arc(cx, cy, 9, 0, Math.PI * 2);
    g.fill();
  };
  dial(DIAL_L, SPEEDO_MAX, 40, 4, (v) => v, null, 'KM/H');
  dial(DIAL_R_X, RPM_MAX, 1000, 4, (v) => v / 1000, RPM_RED, 'x1000 RPM');
  // Digital panel between the dials: gear on top, speed below.
  g.fillStyle = '#000000';
  g.strokeStyle = 'rgba(120,190,255,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect ? g.roundRect(212, 26, 88, 100, 10) : g.rect(212, 26, 88, 100);
  g.fill();
  g.stroke();
  g.font = '700 9px system-ui, sans-serif';
  g.fillStyle = 'rgba(160,200,240,0.7)';
  g.textAlign = 'center';
  g.fillText('KM/H', 256, 122);
  // Shift-light bezel.
  g.fillStyle = '#0b0d11';
  g.fillRect(LED.x0 - 14, 0, LED.pitch * (SHIFT_LIGHTS - 1) + 28, 25);
  // Digit strip: white glyphs on black, one GLYPH_W cell each.
  g.fillStyle = '#000000';
  g.fillRect(0, STRIP_Y, 512, 64);
  g.font = 'italic 900 54px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  for (let i = 0; i < GLYPHS.length; i++) g.fillText(GLYPHS[i], i * GLYPH_W + GLYPH_W / 2, STRIP_Y + 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;
  tex.generateMipmaps = !lowEnd;
  if (lowEnd) tex.minFilter = THREE.LinearFilter;
  return tex;
}

// The whole cluster in one mesh: the face quad, four digit quads and the shift lights. `slot`
// picks what each vertex is: -1 face, 0-3 a digit (gear, then speed), 10+ a shift light.
function buildDisplay() {
  const pos = [];
  const uv = [];
  const cell = [];
  const slot = [];
  const k = FACE_W / 512;
  const quad = (cx, cy, w, h, sl, u0, v0, u1, v1) => {
    const z0 = (cx - w / 2 - 256) * k;
    const z1 = (cx + w / 2 - 256) * k;
    const y0 = (128 - (cy + h / 2)) * k;
    const y1 = (128 - (cy - h / 2)) * k;
    const x = sl < 0 ? 0 : -0.0015; // digits and lights just in front of the face
    const corners = [
      [z0, y0, u0, v0, 0, 0],
      [z1, y0, u1, v0, 1, 0],
      [z1, y1, u1, v1, 1, 1],
      [z0, y0, u0, v0, 0, 0],
      [z1, y1, u1, v1, 1, 1],
      [z0, y1, u0, v1, 0, 1],
    ];
    for (const [z, y, u, v, cu, cv] of corners) {
      pos.push(x, y, z);
      uv.push(u, v);
      cell.push(cu, cv);
      slot.push(sl);
    }
  };
  // Face: the top 256 rows of the texture (uv v runs bottom-up: 1 - 256/320 .. 1).
  quad(256, 128, 512, 256, -1, 0, 1 - 256 / 320, 1, 1);
  DIGITS.forEach((d, i) => quad(d.x, d.y, d.w, d.h, i, 0, 0, 0, 0));
  for (let i = 0; i < SHIFT_LIGHTS; i++) quad(LED.x0 + i * LED.pitch, LED.y, LED.size, LED.size, 10 + i, 0, 0, 0, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('cell', new THREE.Float32BufferAttribute(cell, 2));
  g.setAttribute('slot', new THREE.Float32BufferAttribute(slot, 1));
  return g;
}

function displayMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      digits: { value: [GLYPH.N, GLYPH.BLANK, GLYPH.BLANK, 0] },
      lit: { value: 0 },
      flash: { value: 0 },
      glow: { value: 0 },
    },
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute vec2 cell;
      attribute float slot;
      uniform float digits[4];
      uniform float lit, flash;
      varying vec2 vUv, vCell;
      varying vec3 vTint;
      varying float vKind;
      void main() {
        vUv = uv;
        vCell = cell;
        vTint = vec3(1.0);
        vKind = 0.0;
        if (slot >= 0.0 && slot < 4.0) {
          // A digit: its glyph's cell in the strip under the face.
          float gl = slot < 0.5 ? digits[0] : slot < 1.5 ? digits[1] : slot < 2.5 ? digits[2] : digits[3];
          vUv = vec2((gl + cell.x) * ${(GLYPH_W / 512).toFixed(6)}, mix(0.0, ${(64 / 320).toFixed(6)}, cell.y));
          vTint = slot < 0.5 ? vec3(1.0, 0.78, 0.42) : vec3(0.72, 0.93, 1.0);
          vKind = 1.0;
        } else if (slot >= 10.0) {
          float i = slot - 10.0;
          vTint = i < 4.0 ? vec3(0.2, 1.0, 0.35) : i < 7.0 ? vec3(1.0, 0.75, 0.1) : vec3(1.0, 0.15, 0.12);
          // On the limiter every light flashes blue.
          if (flash > 0.5) vTint = vec3(0.25, 0.55, 1.0);
          else if (i >= lit) vTint *= 0.1;
          vKind = 2.0;
        }
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        ${DEPTH_FRONT}
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float glow;
      varying vec2 vUv, vCell;
      varying vec3 vTint;
      varying float vKind;
      void main() {
        vec3 c;
        float back = 0.9 + glow * 0.9; // backlight: brighter at night and in tunnels (blooms)
        if (vKind > 1.5) {
          float d = length(vCell - 0.5) * 2.0;
          c = mix(vec3(0.02), vTint * (1.2 + glow), smoothstep(1.0, 0.6, d));
        } else {
          c = texture2D(map, vUv).rgb * back;
          if (vKind > 0.5) c *= vTint * 1.15;
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Mirror glass quads (rear-view, then left wing). uv: the rear-view shows the whole live view,
// mirrored; the wing mirror its left-rear part (the right of the rearward camera's image).
function buildMirrorGlass(lowEnd) {
  const rear = new THREE.PlaneGeometry(0.235, 0.068).rotateY(-Math.PI / 2).translate(0.548, 0.235, 0.33);
  const wing = new THREE.PlaneGeometry(0.21, 0.1).rotateY(-Math.PI / 2).translate(1.033, -0.2, -0.93);
  // PlaneGeometry turned to face -x: uv.x 0 is on the driver's left. The rearward camera sees
  // the car's left on the right of its image, so each glass reads its image right to left.
  const setU = (g, u0, u1) => {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) < 0.5 ? u0 : u1);
  };
  setU(rear, 1, 0);
  setU(wing, 1, 0.62);
  const parts = [rear, wing];
  if (lowEnd) {
    // Sky gradient: light at the top of each glass, road grey at the bottom.
    for (const g of parts) {
      const p = g.attributes.position;
      const col = new Float32Array(p.count * 3);
      const top = new THREE.Color(0xa9bfd3);
      const low = new THREE.Color(0x4b545e);
      g.computeBoundingBox();
      const { min, max } = g.boundingBox;
      for (let i = 0; i < p.count; i++) {
        _c.copy(low).lerp(top, (p.getY(i) - min.y) / Math.max(1e-6, max.y - min.y));
        col.set([_c.r, _c.g, _c.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
  }
  return mergeGeometries(parts);
}

// Windscreen sheen: transparent, brightest along the bottom of the glass, gone by halfway up.
function buildGlass() {
  const g = new THREE.BufferGeometry();
  const a = [1.135, -0.31];
  const b = [0.54, 0.34];
  const zl = [-0.69, -0.72];
  const zr = [1.35, 1.38];
  const pos = [];
  const col = [];
  const rows = [0, 0.25, 0.55];
  const alpha = [0.11, 0.04, 0];
  for (let r = 0; r < rows.length; r++) {
    const t = rows[r];
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    pos.push(x, y, zl[0] + (zl[1] - zl[0]) * t, x, y, zr[0] + (zr[1] - zr[0]) * t);
    col.push(0.85, 0.9, 1, alpha[r], 0.85, 0.9, 1, alpha[r]);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex([0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5]);
  return g;
}

export class Cockpit {
  // lowEnd: the simple version (render/gpuTier.js): unlit, fewer segments, no stitching, no
  // windscreen sheen, a sky gradient in the mirrors instead of the live rear view.
  constructor({ lowEnd = false } = {}) {
    this.lowEnd = lowEnd;
    this.liveMirror = !lowEnd;
    const group = (this.group = new THREE.Group());
    group.name = 'cockpit';
    group.rotation.order = 'YZX';
    group.visible = false;
    group.userData.noCull = true;

    this.textures = [];
    const grain = lowEnd ? null : this.keep(grainTexture());
    const solid = inFront(
      lowEnd
        ? new THREE.MeshBasicMaterial({ vertexColors: true })
        : // A faint self-light keeps the cabin's shapes readable at night and in tunnels.
          new THREE.MeshLambertMaterial({ vertexColors: true, map: grain, side: THREE.DoubleSide, emissive: 0x0d0f13 })
    );
    this.trimMaterial = inFront(
      lowEnd
        ? new THREE.MeshBasicMaterial({ color: 0x888888 })
        : new THREE.MeshStandardMaterial({ color: 0x888888, map: this.keep(carbonTexture()), metalness: 0.45, roughness: 0.38 })
    );
    const add = (parent, geo, mat, name) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      parent.add(m);
      return m;
    };
    add(group, buildShell(lowEnd), solid, 'cockpit-shell');
    add(group, buildTrim(lowEnd), this.trimMaterial, 'cockpit-trim');

    // Steering wheel: tilted back like a real column, turning about its own axis with the
    // hands on it.
    this.wheelPivot = new THREE.Group();
    this.wheelPivot.position.set(0.56, -0.44, 0);
    this.wheelPivot.rotation.z = -0.35;
    this.wheel = new THREE.Group();
    this.wheel.name = 'cockpit-wheel';
    add(this.wheel, buildWheel(lowEnd), solid, 'cockpit-wheel-grip');
    add(this.wheel, buildWheelTrim(lowEnd), this.trimMaterial, 'cockpit-wheel-trim');
    this.wheelPivot.add(this.wheel);
    // The hands turn with the rim up to HAND_TURN, then let it slide through their grip (so
    // an arm never swings across the instruments at full lock).
    this.hands = add(this.wheelPivot, buildHands(lowEnd), solid, 'cockpit-hands');
    group.add(this.wheelPivot);
    // Forearms: from fixed elbows to the cuffs on the turning wheel.
    const arm = new THREE.CylinderGeometry(0.033, 0.042, 1, lowEnd ? 6 : 10, 1).translate(0, 0.5, 0);
    this.elbows = [v3(0.16, -0.64, -0.44), v3(0.16, -0.64, 0.44)];
    this.forearms = this.elbows.map((e, i) => {
      const m = add(group, paint(arm.clone(), COLORS.sleeve), solid, `cockpit-forearm-${i ? 'right' : 'left'}`);
      m.position.copy(e);
      return m;
    });

    // Instrument cluster: the face turned toward the eye under the hood, needles in front.
    const cluster = new THREE.Group();
    cluster.position.set(0.785, -0.32, 0);
    cluster.rotation.z = -0.42;
    this.display = add(cluster, buildDisplay(), displayMaterial(this.keep(clusterTexture(lowEnd))), 'cockpit-display');
    this.displayUniforms = this.display.material.uniforms;
    this.needleMaterial = inFront(new THREE.MeshBasicMaterial({ color: 0xff4a1a, toneMapped: false }));
    const needleGeo = new THREE.BoxGeometry(0.0028, 0.062, 0.004).translate(0, 0.022, 0);
    const k = FACE_W / 512;
    const needle = (px) => {
      const m = add(cluster, needleGeo, this.needleMaterial, 'cockpit-needle');
      m.position.set(-0.004, (128 - DIAL_Y) * k, (px - 256) * k);
      return m;
    };
    this.speedNeedle = needle(DIAL_L);
    this.rpmNeedle = needle(DIAL_R_X);
    group.add(cluster);

    // Mirrors.
    if (this.liveMirror) {
      this.mirrorTarget = new THREE.WebGLRenderTarget(MIRROR.width, MIRROR.height, { depthBuffer: true, samples: 0 });
      this.mirrorTarget.texture.name = 'cockpit-mirror';
      this.mirrorCamera = new THREE.PerspectiveCamera(MIRROR.fov, MIRROR.width / MIRROR.height, 0.5, MIRROR.far);
      this.mirrorCamera.layers.set(0); // the world, never the cabin
      this.mirrorFrame = 0;
    }
    const glassMat = inFront(this.liveMirror ? new THREE.MeshBasicMaterial({ map: this.mirrorTarget.texture }) : new THREE.MeshBasicMaterial({ vertexColors: true }));
    add(group, buildMirrorGlass(lowEnd), glassMat, 'cockpit-mirrors');
    if (!lowEnd) {
      const sheen = inFront(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      add(group, buildGlass(), sheen, 'cockpit-glass').renderOrder = 1;
    }

    group.traverse((o) => {
      o.frustumCulled = false; // always in front of the eye; no bounds to test
      o.castShadow = false;
      o.receiveShadow = false;
      if (o.isMesh && o.renderOrder === 0) o.renderOrder = -1; // opaque cabin first (less fill)
      o.layers.set(1); // the race camera sees layer 1 too; mirrors and reflection bakes do not
    });
    this.steer = 0;
    this.wheelAngle = 0;
    this.kmh = 0;
    this.rpm = 0;
    this.gear = GLYPH.N;
    this.lit = 0;
    this.glow = 0;
    this.time = 0;
    this.setPaint(0x8a8f99);
  }

  keep(tex) {
    this.textures.push(tex);
    return tex;
  }

  setVisible(on) {
    this.group.visible = on;
  }

  // Trim accents take the car's paint, a little toned down so dark and loud paints both work.
  setPaint(color) {
    this.trimMaterial.color.set(color).lerp(_c.set(0x8a8f99), 0.4);
    if (this.lowEnd) this.trimMaterial.color.multiplyScalar(0.5); // unlit: keep it from glaring
  }

  // Places the cabin at the driver's eye (from the camera rig, `chase.carPoint` + `eye`), turns
  // the wheel, hands and needles, and sets the digital readout and shift lights.
  //   steer -1..1, kmh road speed, rpm from the gearbox, gear a cluster glyph (gearGlyph),
  //   glow 0..1 backlight boost (night, tunnels)
  update(car, chase, dt, steer, kmh, rpm, gear = GLYPH.N, glow = 0) {
    const g = this.group;
    const e = chase.eye;
    chase.carPoint(car, e.x, e.y, e.z, g.position);
    g.rotation.set(0, car.heading, car.pitch);
    this.time += dt;
    this.wheelAngle += (steer * WHEEL_LOCK - this.wheelAngle) * Math.min(1, dt * WHEEL_RATE);
    this.wheel.rotation.x = this.wheelAngle;
    this.hands.rotation.x = Math.max(-HAND_TURN, Math.min(HAND_TURN, this.wheelAngle));
    this.aimForearms();
    this.kmh = kmh;
    this.rpm = rpm;
    this.speedNeedle.rotation.x = needleAngle(kmh / SPEEDO_MAX);
    this.rpmNeedle.rotation.x = needleAngle(rpm / RPM_MAX);
    // Digital readout: speed without leading zeros, then the gear.
    const u = this.displayUniforms;
    const v = Math.min(999, Math.max(0, Math.round(kmh)));
    const d = u.digits.value;
    d[0] = gear;
    d[1] = v >= 100 ? Math.floor(v / 100) : GLYPH.BLANK;
    d[2] = v >= 10 ? Math.floor(v / 10) % 10 : GLYPH.BLANK;
    d[3] = v % 10;
    this.gear = gear;
    this.lit = shiftLit(rpm);
    u.lit.value = this.lit;
    u.flash.value = rpm >= SHIFT_FLASH && Math.sin(this.time * 50) > 0 ? 1 : 0;
    this.glow += (glow - this.glow) * Math.min(1, dt * 3);
    u.glow.value = this.glow;
    this.needleMaterial.color.setRGB(1, 0.3, 0.1).multiplyScalar(1.2 + this.glow * 1.6);
  }

  // Each forearm from its elbow to its cuff on the turned wheel.
  aimForearms() {
    this.wheelPivot.updateMatrix();
    this.hands.updateMatrix();
    for (let i = 0; i < 2; i++) {
      const wrist = _a.copy(WRIST[i]).applyMatrix4(this.hands.matrix).applyMatrix4(this.wheelPivot.matrix);
      const arm = this.forearms[i];
      const dir = _b.subVectors(wrist, this.elbows[i]);
      const len = dir.length();
      arm.quaternion.setFromUnitVectors(UP, dir.multiplyScalar(1 / len));
      arm.scale.set(1, len, 1);
    }
  }

  // The live rear view (mid and high GPUs, cockpit showing): one low-resolution render of the
  // world behind the car every MIRROR.every frames, no post-processing, a short draw
  // distance, reusing the sun's shadow map. `force` renders now (the warm-up).
  renderMirror(renderer, scene, force = false) {
    if (!this.liveMirror || (!force && !this.group.visible)) return false;
    if (!force && this.mirrorFrame++ % MIRROR.every !== 0) return false;
    const cam = this.mirrorCamera;
    const g = this.group;
    g.updateMatrixWorld();
    // From the rear-view mirror, looking back down the car (a little down, to see the road).
    cam.position.set(0.3, 0.12, 0.33).applyMatrix4(g.matrixWorld);
    _p.set(-20, -1.6, 0.33).applyMatrix4(g.matrixWorld);
    cam.lookAt(_p);
    cam.updateMatrixWorld();
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.mirrorTarget);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    renderer.shadowMap.autoUpdate = shadows;
    return true;
  }

  dispose() {
    this.mirrorTarget?.dispose();
  }
}
