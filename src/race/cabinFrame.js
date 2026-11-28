import * as THREE from 'three';

// The cabin's frame seen from the driver's seat (versionCode 76): windscreen header, A-pillars,
// headliner, roof rails and B-pillars as one clean mesh, fitted to the car's own glass.
//
// Why: in the driver view the car body round the cabin is the race model (a decimated LOD built
// to be seen from outside). From inside, its roof and pillars showed as broken black wedges:
// thin decimated edges against the sky, and inner faces that only ever get baked shadow. The
// body is now cut away inside the greenhouse (the glass's own box, `clip`: raceCars.js
// cabinClip discards the player body's pixels in it) and this frame draws the roof and pillars
// instead, with the proportions of the car's own windscreen and side glass.
//
// Everything here is in the car model's frame (x forward, y up, z right), from the glass meshes
// of the car's cockpit file. Pure geometry: no materials, no scene.

// Frame shades (linear values: a charcoal headliner, darker pillars; the material is unlit and
// CarCockpit dims it at night).
export const FRAME_SHADES = {
  headliner: [0.05, 0.051, 0.055],
  rail: [0.04, 0.041, 0.044],
  pillar: [0.026, 0.027, 0.029],
  pillarFace: [0.04, 0.041, 0.044],
  header: [0.02, 0.02, 0.022],
};

const PILLAR_DEPTH = 0.1; // A-pillar: back along the side glass
const PILLAR_FACE = 0.055; // A-pillar: the face toward the driver
const HEADER_DROP = 0.06; // windscreen header below the glass's top edge
const RAIL_DROP = 0.05; // roof rails above the side glass
const B_PILLAR = 0.12;

// The glass's shape: windscreen base and top edges, the side glass's top and rear, the roof.
// `pts`: glass vertices (THREE.Vector3, model frame), `side`: the door windows' vertices (may be
// empty), `eye`: the driver's eye [x, y, z]. Null when there is no windscreen to fit (an open
// car: its cockpit file brings whatever frame it has).
export function fitGlass(pts, side, eye) {
  const ex = eye[0];
  const front = pts.filter((p) => p.x > ex + 0.15);
  if (front.length < 8) return null;
  let yt = -Infinity;
  for (const p of front) yt = Math.max(yt, p.y);
  const top = front.filter((p) => p.y > yt - 0.04);
  let xt = -Infinity;
  for (const p of top) xt = Math.max(xt, p.x);
  let zt = 0;
  for (const p of top) if (p.x > xt - 0.12) zt = Math.max(zt, Math.abs(p.z));
  const ahead = front.filter((p) => p.x > xt);
  if (!ahead.length) return null;
  let yb = Infinity;
  for (const p of ahead) yb = Math.min(yb, p.y);
  let xb = -Infinity;
  for (const p of front) if (p.y < yb + 0.05) xb = Math.max(xb, p.x);
  let zb = 0;
  for (const p of front) if (p.y < yb + 0.08 && p.x > xb - 0.25) zb = Math.max(zb, Math.abs(p.z));
  const all = pts.concat(side);
  // Roof: as wide as the glass at its top, back to where the glass ends at roof height.
  let zr = zt;
  let xr = Infinity;
  let zMax = 0;
  let xMin = Infinity;
  let belt = yb;
  for (const p of all) {
    if (p.y > yt - 0.08) {
      zr = Math.max(zr, Math.abs(p.z));
      xr = Math.min(xr, p.x);
    }
    zMax = Math.max(zMax, Math.abs(p.z));
    xMin = Math.min(xMin, p.x);
    belt = Math.min(belt, p.y);
  }
  xr = Math.max(xr, ex - 1.3);
  // The door glass's rear edge (the B-pillar) when there is glass behind it.
  let xB = null;
  if (side.length) {
    let sx = Infinity;
    for (const p of side) sx = Math.min(sx, p.x);
    if (sx - xMin > 0.15) xB = sx;
  }
  return { xb, yb, zb, xt, yt, zt, xr, zr, zMax, xMin, belt, xB };
}

// The box (model frame) the player body is cut away in: the greenhouse above the beltline,
// from the windscreen base back to the end of the glass.
export function clipBox(fit) {
  return new THREE.Box3(
    new THREE.Vector3(fit.xMin - 0.05, Math.min(fit.yb, fit.belt) + 0.015, -(fit.zMax + 0.04)),
    new THREE.Vector3(fit.xb + 0.03, fit.yt + 0.4, fit.zMax + 0.04),
  );
}

// The frame mesh's geometry (position, normal, color), both faces drawn.
export function frameGeometry(fit) {
  const pos = [];
  const col = [];
  const quad = (a, b, c, d, shade) => {
    for (const p of [a, b, c, a, c, d]) {
      pos.push(p[0], p[1], p[2]);
      col.push(...shade);
    }
  };
  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const { xb, yb, zb, xt, yt, zt, xr, zr, belt, xB } = fit;
  const S = FRAME_SHADES;
  // Headliner: a shallow dome from the header back to the roof's end, edge to edge.
  const NX = 6;
  const NZ = 10;
  const roof = (i, j) => {
    const x = xt - 0.02 + ((xr - xt + 0.02) * i) / NX;
    const u = -1 + (2 * j) / NZ;
    return [x, yt + 0.012 + 0.025 * (1 - u * u), u * (zr + 0.01)];
  };
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NZ; j++) {
      // Lighter toward the middle and the windscreen (the light through the glass).
      const k = 1 - 0.25 * Math.abs(-1 + (2 * (j + 0.5)) / NZ) - 0.12 * (i / NX);
      quad(roof(i, j), roof(i, j + 1), roof(i + 1, j + 1), roof(i + 1, j), S.headliner.map((v) => v * k));
    }
  }
  for (const s of [-1, 1]) {
    // Roof rail: down from the headliner's edge to above the side glass.
    const r0 = [xt - 0.02, yt + 0.012, s * (zr + 0.01)];
    const r1 = [xr, yt + 0.012, s * (zr + 0.01)];
    quad(r0, r1, [xr, yt - RAIL_DROP, s * (zr - 0.01)], [xt - 0.02, yt - RAIL_DROP, s * (zr - 0.01)], S.rail);
    // A-pillar along the windscreen's side edge: a face back along the side glass and a
    // narrower one toward the driver, so it reads as a solid post.
    const base = [xb, yb, s * zb];
    const tip = [xt, yt, s * zt];
    const N = 4;
    for (let i = 0; i < N; i++) {
      const a = lerp(base, tip, i / N);
      const b = lerp(base, tip, (i + 1) / N);
      const back = (p) => [p[0] - PILLAR_DEPTH, p[1], p[2] + s * 0.012];
      const inward = (p) => [p[0] - 0.015, p[1], p[2] - s * PILLAR_FACE];
      quad(a, b, back(b), back(a), S.pillar);
      quad(a, b, inward(b), inward(a), S.pillarFace);
    }
    // Where the pillar meets the roof: the rail's front, down to the pillar's top.
    quad([xt - 0.02, yt + 0.012, s * zt], [xt - 0.02, yt + 0.012, s * (zr + 0.01)], [xt - 0.02 - PILLAR_DEPTH, yt - RAIL_DROP, s * (zr - 0.01)], [xt - PILLAR_DEPTH, yt - RAIL_DROP * 0.5, s * zt], S.pillar);
    // B-pillar: the door glass's rear edge up to the roof rail.
    if (xB !== null) {
      const z = s * (zr - 0.005);
      quad([xB, belt, z], [xB, yt, z], [xB - B_PILLAR, yt, z], [xB - B_PILLAR, belt, z], S.pillar);
      quad([xB, belt, z], [xB, yt, z], [xB, yt, z - s * 0.05], [xB, belt, z - s * 0.05], S.pillarFace);
    }
  }
  // Windscreen header: a lip across the top of the glass, facing the driver.
  const h0 = [xt, yt + 0.02, -zt];
  const h1 = [xt, yt + 0.02, zt];
  quad(h0, h1, [xt - 0.015, yt - HEADER_DROP, zt - 0.02], [xt - 0.015, yt - HEADER_DROP, -zt + 0.02], S.header);
  quad([xt - 0.015, yt - HEADER_DROP, -zt + 0.02], [xt - 0.015, yt - HEADER_DROP, zt - 0.02], [xt - 0.09, yt + 0.012, zt - 0.02], [xt - 0.09, yt + 0.012, -zt + 0.02], S.rail);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// From a cockpit file's scene (`root`, in the car model's frame): the fit, the frame geometry
// and the clip box; null for an open car (no windscreen glass).
export function buildCabinFrame(root, eye) {
  if (!eye) return null;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const glass = [];
  const side = [];
  root.traverse((o) => {
    if (!o.isMesh || !/ClearGlass/i.test(o.material?.name ?? '')) return;
    const out = /^window_/.test(o.name) ? side : glass;
    m.multiplyMatrices(inv, o.matrixWorld);
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m));
  });
  const fit = fitGlass(glass.length ? glass : side, glass.length ? side : [], eye);
  if (!fit) return null;
  return { fit, geometry: frameGeometry(fit), box: clipBox(fit) };
}

// Where the driver's eye sits (model frame), from the cockpit file's eye and its steering
// wheel's centre: a real seat puts the eye about 0.55 m behind the wheel's centre and about
// 0.22 m above it. The cars' files had it 0.36-0.44 m behind (the wheel and the pillars
// filled the view, the bonnet looked short): it moves back to that, and up to that height but
// never closer than 0.12 m to the roof.
export const SEAT = { behind: 0.55, above: 0.22, headroom: 0.13 };
export function driverEye(eye, wheelCentre, roofY = Infinity) {
  if (!eye || !wheelCentre) return eye;
  const x = Math.min(eye[0], wheelCentre[0] - SEAT.behind);
  const y = Math.max(eye[1], Math.min(wheelCentre[1] + SEAT.above, roofY - SEAT.headroom));
  return [x, y, eye[2]];
}
