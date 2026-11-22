import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Driver view cabin (camera view 'cockpit'): one generic cockpit shared by every car. Built
// round the driver's eye (x forward, y up, z right, in metres from the eye), so it fits any
// car the eye is placed in (race/chaseCamera.js cockpitEye).
//
//   shell    dashboard, instrument cowl, A-pillars, roof header and mirror housings: one
//            merged vertex-coloured mesh, one draw
//   wheel    rim, spokes, hub and the top marker: one merged mesh that turns with the steering
//   cluster  speedometer and rev counter faces (one 512x256 canvas texture, drawn once) and
//            their two needles, driven by the car's real speed and the gearbox's RPM
//   mirrors  rear-view and left wing mirror glass: the race's baked environment map on a
//            mirror-finish material (no extra render pass); flat tinted glass on a low-end GPU
//
// Everything sits in the lower quarter of the screen (dash line ~72% down, wheel rim ~74%) or
// at its edges (pillars, mirrors), so the road ahead stays open. 6 draws, 4-5 materials, no
// shadows. A low-end GPU (render/gpuTier.js) gets fewer segments, unlit colours and a 256x128
// gauge texture.

export const WHEEL_LOCK = 1.9; // radians the wheel turns at full steering lock
export const WHEEL_RATE = 14; // 1/s: how fast the drawn wheel follows the steering input
export const SPEEDO_MAX = 320; // km/h at the end of the dial
export const RPM_MAX = 8000;
export const RPM_RED = 7600;
const SWEEP = (240 * Math.PI) / 180; // dial sweep, needle from lower-left to lower-right

// Needle angle (radians, clockwise from straight up as the driver sees it) for 0..1 of a dial.
export const needleAngle = (k) => -SWEEP / 2 + SWEEP * Math.min(1.04, Math.max(0, k));

const COLORS = {
  dash: 0x1b1e25,
  dashTop: 0x23272f,
  trim: 0x14161b,
  rim: 0x0f1013,
  spoke: 0x3a3e46,
  hub: 0x23262d,
  marker: 0xff7a1a,
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
}

// A box of size (x, y, z) centred at (x, y, z), turned `rz` about z (nose down when < 0).
function box(sx, sy, sz, x, y, z, hex, rz = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rz) g.rotateZ(rz);
  return paint(g.translate(x, y, z), hex);
}

// A square bar of `thick` from a to b.
function bar(a, b, thick, hex) {
  const dir = _p.subVectors(b, a);
  const len = dir.length();
  const g = new THREE.BoxGeometry(thick, len, thick * 1.4);
  _q.setFromUnitVectors(UP, dir.normalize());
  g.applyMatrix4(_m.compose(_a.addVectors(a, b).multiplyScalar(0.5), _q, _s));
  return paint(g, hex);
}

function buildShell() {
  const parts = [
    // Dashboard: a wide slab across the cabin beyond the gauges, its top sloping down toward
    // the windscreen (its far edge is the dash line, ~72% down the screen), and the fascia
    // under the gauges.
    box(0.4, 0.16, 4, 1.02, -0.4, -0.2, COLORS.dash, -0.16),
    box(0.38, 0.015, 3.96, 1.01, -0.322, -0.2, COLORS.dashTop, -0.16),
    box(0.08, 0.3, 0.5, 0.84, -0.6, 0, COLORS.dash),
    // Lower dash across the whole cabin, down past the bottom of the screen.
    box(0.06, 0.8, 4, 0.98, -0.86, -0.2, COLORS.dash),
    // Door panels below the side windows, so a car alongside never shows through the cabin.
    box(1.6, 1.6, 0.05, 0.2, -1.1, -0.78, COLORS.dash),
    box(1.6, 1.6, 0.05, 0.2, -1.1, 1.42, COLORS.dash),
    // Instrument cowl just above the gauges, with its two cheeks.
    box(0.13, 0.025, 0.4, 0.77, -0.232, 0, COLORS.trim, -0.1),
    box(0.1, 0.13, 0.02, 0.79, -0.31, -0.19, COLORS.trim),
    box(0.1, 0.13, 0.02, 0.79, -0.31, 0.19, COLORS.trim),
    // Steering column.
    box(0.28, 0.06, 0.06, 0.7, -0.43, 0, COLORS.trim, 0.35),
    // A-pillars from the dash corners up to the roof, and the roof header.
    bar(new THREE.Vector3(1.1, -0.34, -0.7), new THREE.Vector3(0.4, 0.42, -0.72), 0.05, COLORS.trim),
    bar(new THREE.Vector3(1.1, -0.34, 1.32), new THREE.Vector3(0.4, 0.42, 1.36), 0.05, COLORS.trim),
    box(0.26, 0.1, 2.1, 0.48, 0.45, 0.35, COLORS.trim, -0.4),
    // Rear-view mirror housing and stalk; left wing mirror housing.
    box(0.035, 0.085, 0.27, 0.565, 0.235, 0.3, COLORS.trim),
    box(0.02, 0.13, 0.02, 0.56, 0.33, 0.3, COLORS.trim),
    box(0.06, 0.12, 0.25, 1.06, -0.2, -0.92, COLORS.trim),
  ];
  return mergeGeometries(parts);
}

function buildWheel(lowEnd) {
  const R = 0.18;
  const rim = new THREE.TorusGeometry(R, 0.022, lowEnd ? 5 : 8, lowEnd ? 24 : 40);
  rim.rotateY(Math.PI / 2); // into the wheel's plane (y up, z right), facing the driver
  const parts = [
    paint(rim, COLORS.rim),
    box(0.03, 0.035, 0.14, 0, -0.02, -0.1, COLORS.spoke),
    box(0.03, 0.035, 0.14, 0, -0.02, 0.1, COLORS.spoke),
    box(0.03, 0.13, 0.045, 0, -0.115, 0, COLORS.spoke),
    paint(new THREE.CylinderGeometry(0.055, 0.06, 0.05, lowEnd ? 10 : 18).rotateZ(Math.PI / 2), COLORS.hub),
    // The orange top-centre marker shows how far the wheel is turned.
    box(0.05, 0.03, 0.05, 0, R, 0, COLORS.marker),
  ];
  return mergeGeometries(parts);
}

// Speedometer (left) and rev counter (right) faces, drawn once.
function gaugeTexture(lowEnd) {
  const W = lowEnd ? 256 : 512;
  const H = W / 2;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const s = W / 512;
  g.fillStyle = '#07080b';
  g.fillRect(0, 0, W, H);
  // step: labelled divisions; ticks: minor ticks per division.
  const dial = (cx, max, step, ticks, label, red) => {
    const cy = 128 * s;
    const r = 112 * s;
    g.fillStyle = '#0d0f14';
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 3 * s;
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.stroke();
    // Canvas angles: 0 = right, clockwise; the needle's 0 is straight up.
    const at = (k) => needleAngle(k) - Math.PI / 2;
    if (red != null) {
      g.strokeStyle = '#ff3030';
      g.lineWidth = 10 * s;
      g.beginPath();
      g.arc(cx, cy, r - 12 * s, at(red / max), at(1));
      g.stroke();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `italic 900 ${Math.round(24 * s)}px system-ui, sans-serif`;
    for (let v = 0; v <= max + 1e-6; v += step / ticks) {
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const a = at(v / max);
      const r0 = r - (major ? 24 : 14) * s;
      g.strokeStyle = major ? '#ffffff' : 'rgba(255,255,255,0.55)';
      g.lineWidth = (major ? 4 : 2) * s;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * (r - 5 * s), cy + Math.sin(a) * (r - 5 * s));
      g.stroke();
      if (major) {
        g.fillStyle = '#e8eef8';
        const rt = r - 44 * s;
        g.fillText(String(Math.round(label(v))), cx + Math.cos(a) * rt, cy + Math.sin(a) * rt);
      }
    }
    g.font = `800 ${Math.round(14 * s)}px system-ui, sans-serif`;
    g.fillStyle = 'rgba(200,215,235,0.7)';
    g.fillText(max === SPEEDO_MAX ? 'KM/H' : 'x1000 RPM', cx, cy + 58 * s);
  };
  dial(128 * s, SPEEDO_MAX, 80, 4, (v) => v, null);
  dial(384 * s, RPM_MAX, 2000, 4, (v) => v / 1000, RPM_RED);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;
  tex.generateMipmaps = !lowEnd;
  if (lowEnd) tex.minFilter = THREE.LinearFilter;
  return tex;
}

export class Cockpit {
  // envMap: the race's baked environment (mirror glass); lowEnd: the simple version.
  constructor({ lowEnd = false, envMap = null } = {}) {
    this.lowEnd = lowEnd;
    const group = (this.group = new THREE.Group());
    group.name = 'cockpit';
    group.rotation.order = 'YZX';
    group.visible = false;
    group.userData.noCull = true;

    const solid = lowEnd
      ? new THREE.MeshBasicMaterial({ vertexColors: true })
      : new THREE.MeshLambertMaterial({ vertexColors: true });
    const shell = new THREE.Mesh(buildShell(), solid);
    shell.name = 'cockpit-shell';
    group.add(shell);

    // Steering wheel: tilted back like a real column, turning about its own axis.
    this.wheelPivot = new THREE.Group();
    this.wheelPivot.position.set(0.56, -0.37, 0);
    this.wheelPivot.rotation.z = -0.35;
    this.wheel = new THREE.Mesh(buildWheel(lowEnd), solid);
    this.wheel.name = 'cockpit-wheel';
    this.wheelPivot.add(this.wheel);
    group.add(this.wheelPivot);

    // Gauges: the face plane turned toward the eye, needles just in front of it.
    const cluster = new THREE.Group();
    cluster.position.set(0.78, -0.35, 0);
    cluster.rotation.z = -0.42;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.17).rotateY(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: gaugeTexture(lowEnd), toneMapped: false })
    );
    face.name = 'cockpit-gauges';
    cluster.add(face);
    const needleMat = new THREE.MeshBasicMaterial({ color: 0xff4a1a, toneMapped: false });
    const needleGeo = new THREE.BoxGeometry(0.003, 0.066, 0.005).translate(0, 0.025, 0);
    const needle = (z) => {
      const pivot = new THREE.Mesh(needleGeo, needleMat);
      pivot.position.set(-0.005, 0, z);
      cluster.add(pivot);
      return pivot;
    };
    this.speedNeedle = needle(-0.085);
    this.rpmNeedle = needle(0.085);
    group.add(cluster);

    // Mirror glass: rear-view (centre, high) and the left wing mirror.
    const glass = lowEnd
      ? new THREE.MeshBasicMaterial({ color: 0x5d6f82 })
      : new THREE.MeshStandardMaterial({ color: 0xc8d4e0, metalness: 1, roughness: 0.08, envMap });
    const mirrors = mergeGeometries([
      new THREE.PlaneGeometry(0.25, 0.07).rotateY(-Math.PI / 2).translate(0.545, 0.235, 0.3),
      new THREE.PlaneGeometry(0.21, 0.1).rotateY(-Math.PI / 2).translate(1.028, -0.2, -0.92),
    ]);
    const mirror = new THREE.Mesh(mirrors, glass);
    mirror.name = 'cockpit-mirrors';
    group.add(mirror);

    group.traverse((o) => {
      o.frustumCulled = false; // always in front of the eye; no bounds to test
      o.castShadow = false;
      o.receiveShadow = false;
      o.renderOrder = -1; // drawn first: the dash hides the road under it (less fill)
    });
    this.steer = 0;
    this.wheelAngle = 0;
    this.kmh = 0;
    this.rpm = 0;
  }

  setVisible(on) {
    this.group.visible = on;
  }

  // Places the cabin at the driver's eye (from the camera rig, `chase.carPoint` + `eye`) and
  // turns the wheel and needles. steer -1..1, kmh road speed, rpm from the gearbox.
  update(car, chase, dt, steer, kmh, rpm) {
    const g = this.group;
    const e = chase.eye;
    chase.carPoint(car, e.x, e.y, e.z, g.position);
    g.rotation.set(0, car.heading, car.pitch);
    this.wheelAngle += (steer * WHEEL_LOCK - this.wheelAngle) * Math.min(1, dt * WHEEL_RATE);
    this.wheel.rotation.x = this.wheelAngle;
    this.kmh = kmh;
    this.rpm = rpm;
    this.speedNeedle.rotation.x = needleAngle(kmh / SPEEDO_MAX);
    this.rpmNeedle.rotation.x = needleAngle(rpm / RPM_MAX);
  }
}
