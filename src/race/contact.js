// Contact between oriented boxes on the ground plane: cars are boxes of their model's real
// length and width (Vehicle.size), so corners touch where the bodywork does. Pure geometry,
// no allocation per call (one result object, refilled): it runs for every pair of cars every
// physics step.

// A box: centre (x, z), heading h (nose along (cos h, -sin h) like Vehicle), half length hl,
// half width hw.

const out = { depth: 0, nx: 0, nz: 0, px: 0, pz: 0 };
const AXES = new Float64Array(8);
const CORNERS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function radius(h, hl, hw, nx, nz) {
  const fx = Math.cos(h);
  const fz = -Math.sin(h);
  return hl * Math.abs(fx * nx + fz * nz) + hw * Math.abs(-fz * nx + fx * nz);
}

// Deepest point of box (x, z, h, hl, hw) along direction (dx, dz): the corner (or the middle of
// the edge when two corners tie) furthest that way. Writes px, pz.
function support(x, z, h, hl, hw, dx, dz) {
  const fx = Math.cos(h);
  const fz = -Math.sin(h);
  const rx = -fz;
  const rz = fx;
  let best = -Infinity;
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (const [a, l] of CORNERS) {
    const cx = x + fx * hl * a + rx * hw * l;
    const cz = z + fz * hl * a + rz * hw * l;
    const p = cx * dx + cz * dz;
    if (p > best + 0.02) {
      best = p;
      sx = cx;
      sz = cz;
      n = 1;
    } else if (p > best - 0.02) {
      sx += cx;
      sz += cz;
      n += 1;
      best = Math.max(best, p);
    }
  }
  out.px = sx / n;
  out.pz = sz / n;
}

// Separating-axis test of boxes A and B. Returns null when apart, else (one shared object)
// { depth, nx, nz } with the unit normal pointing from A to B, and (px, pz) the contact point.
export function boxContact(ax, az, ah, ahl, ahw, bx, bz, bh, bhl, bhw) {
  AXES[0] = Math.cos(ah);
  AXES[1] = -Math.sin(ah);
  AXES[2] = -AXES[1];
  AXES[3] = AXES[0];
  AXES[4] = Math.cos(bh);
  AXES[5] = -Math.sin(bh);
  AXES[6] = -AXES[5];
  AXES[7] = AXES[4];
  const dx = bx - ax;
  const dz = bz - az;
  let depth = Infinity;
  let nx = 0;
  let nz = 0;
  let fromA = true;
  for (let k = 0; k < 4; k++) {
    const ux = AXES[2 * k];
    const uz = AXES[2 * k + 1];
    const c = dx * ux + dz * uz;
    const o = radius(ah, ahl, ahw, ux, uz) + radius(bh, bhl, bhw, ux, uz) - Math.abs(c);
    if (o <= 0) return null;
    // Prefer A's axes on a near tie, so the result does not flicker between faces.
    if (o < depth - 1e-6) {
      depth = o;
      const s = c < 0 ? -1 : 1;
      nx = ux * s;
      nz = uz * s;
      fromA = k < 2;
    }
  }
  // Contact point: the other box's deepest corner into the face that separates them least.
  if (fromA) support(bx, bz, bh, bhl, bhw, -nx, -nz);
  else support(ax, az, ah, ahl, ahw, nx, nz);
  out.depth = depth;
  out.nx = nx;
  out.nz = nz;
  return out;
}

// Is the point (x, z) inside the box, grown by `margin` (metres)? Returns how far inside it
// is along the box's nearest side (> 0 inside), and that side's outward normal in nx, nz.
const inside = { depth: 0, nx: 0, nz: 0 };
export function pointInBox(x, z, bx, bz, bh, bhl, bhw, margin = 0) {
  const fx = Math.cos(bh);
  const fz = -Math.sin(bh);
  const dx = x - bx;
  const dz = z - bz;
  const a = dx * fx + dz * fz;
  const l = dx * -fz + dz * fx;
  const da = bhl + margin - Math.abs(a);
  const dl = bhw + margin - Math.abs(l);
  if (da <= 0 || dl <= 0) return null;
  if (da < dl) {
    const s = a < 0 ? -1 : 1;
    inside.nx = fx * s;
    inside.nz = fz * s;
    inside.depth = da;
  } else {
    const s = l < 0 ? -1 : 1;
    inside.nx = -fz * s;
    inside.nz = fx * s;
    inside.depth = dl;
  }
  return inside;
}

// Car contact: bounce, how much a hit off-centre spins a car (rad/s per N·m-ish unit of
// impulse x lever), the most it can turn one, and the most overlap resolved per step.
export const CONTACT = { restitution: 0.3, spin: 0.012, maxSpin: 0.9, maxPush: 0.8 };
const clampSpin = (w) => Math.max(-CONTACT.maxSpin, Math.min(CONTACT.maxSpin, w));

// Two cars (Vehicles) touching: pushed apart along the face they overlap least through, by
// the overlap (at most maxPush a step), a bounce along that normal, and a turn from where the
// hit lands on each body. Boxes of each car's real size (Vehicle.size); no randomness, so a
// race replays the same and two cars can't end a step inside each other (C5).
export function collideCars(a, b) {
  const dx0 = b.pos.x - a.pos.x;
  const dz0 = b.pos.z - a.pos.z;
  const reach = a.size.halfLength + b.size.halfLength;
  if (dx0 * dx0 + dz0 * dz0 > reach * reach || Math.abs(a.pos.y - b.pos.y) > 1.8) return;
  const c = boxContact(a.pos.x, a.pos.z, a.heading, a.size.halfLength, a.size.halfWidth, b.pos.x, b.pos.z, b.heading, b.size.halfLength, b.size.halfWidth);
  if (!c) return;
  const { nx, nz, px, pz } = c;
  const half = Math.min(c.depth, CONTACT.maxPush) / 2;
  a.pos.x -= nx * half;
  a.pos.z -= nz * half;
  b.pos.x += nx * half;
  b.pos.z += nz * half;
  const rel = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * nz;
  if (rel >= 0) return;
  const j = (-(1 + CONTACT.restitution) * rel) / 2;
  a.vel.x -= nx * j;
  a.vel.y -= nz * j;
  b.vel.x += nx * j;
  b.vel.y += nz * j;
  // Torque about each centre from the impulse at the contact point (y up: r.z F.x - r.x F.z).
  const ta = (pz - a.pos.z) * -nx * j - (px - a.pos.x) * -nz * j;
  const tb = (pz - b.pos.z) * nx * j - (px - b.pos.x) * nz * j;
  a.yawRate += clampSpin(ta * CONTACT.spin);
  b.yawRate += clampSpin(tb * CONTACT.spin);
  a.emit('bump', -rel);
  b.emit('bump', -rel);
}
