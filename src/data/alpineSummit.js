// Chapter 2 track: the Alpine Summit pass. The road leaves a cobblestone village in the valley,
// climbs a stack of switchback hairpins up the south face, crosses the ridge through a stone
// tunnel at the summit, sweeps down past the glacier on the north side (black ice in the
// shade) and returns to the village through the canyon on the west flank.
//
// The centre line is written as a drive (straights and constant-radius arcs, each with its own
// grade) and sampled into the waypoints the race spline runs through, so the hairpins keep
// their exact radius. Heading 0 is east (+x); a positive arc turns right (toward +z, south).
// Pure data, so the tests can import it under Node.

// The village sits just above the lake, so the valley mist pools around it (render/heightFog.js
// is densest at sea level) while the pass stays above the cloud.
const START = { x: -100, y: 6, z: 300, heading: 0 };

// [kind, length or radius, degrees (arcs), grade]
const DRIVE = [
  // Village main street, then a left turn onto the mountain road.
  ['straight', 200, 0, 0],
  ['arc', 60, -90, 0.02],
  ['straight', 60, 0, 0.06],
  ['arc', 40, -90, 0.05],
  // The switchbacks: four legs across the south face, three hairpins.
  ['straight', 200, 0, 0.085],
  ['arc', 25, 180, 0.05],
  ['straight', 220, 0, 0.085],
  ['arc', 25, -180, 0.05],
  ['straight', 220, 0, 0.085],
  ['arc', 25, 180, 0.05],
  ['straight', 160, 0, 0.07],
  // Up to the pass and through the summit tunnel.
  ['arc', 60, -90, 0.04],
  ['straight', 220, 0, 0.004],
  // The glacier descent: long sweepers in the shade of the north face.
  ['arc', 150, -60, -0.05],
  ['straight', 120, 0, -0.075],
  ['arc', 200, -30, -0.075],
  ['straight', 60, 0, -0.07],
  // Canyon pass: down the west flank through a tight right-left in the gorge, then home.
  ['arc', 60, -90, -0.07],
  ['straight', 150, 0, -0.07],
  ['arc', 70, 35, -0.06],
  ['arc', 70, -35, -0.06],
  ['straight', 406, 0, -0.065],
  ['arc', 110, -90, -0.06],
];

// Samples the drive into waypoints, then bends the last stretch back onto the start line with
// a cubic Hermite (position and heading), easing the height to match.
function drivePoints() {
  const pts = [];
  let { x, y, z, heading: h } = START;
  const push = () => pts.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(z * 100) / 100]);
  push();
  for (const [kind, a, deg, grade] of DRIVE) {
    if (kind === 'straight') {
      const n = Math.max(1, Math.round(a / 20));
      for (let i = 0; i < n; i++) {
        x += Math.cos(h) * (a / n);
        z += Math.sin(h) * (a / n);
        y += grade * (a / n);
        push();
      }
    } else {
      const sweep = (deg * Math.PI) / 180;
      const len = Math.abs(sweep) * a;
      const n = Math.max(2, Math.ceil(Math.max(len / 12, Math.abs(deg) / 15)));
      // Centre of the turn sits to the right (+) or left (-) of travel.
      const side = Math.sign(sweep);
      const cx = x - Math.sin(h) * a * side;
      const cz = z + Math.cos(h) * a * side;
      const a0 = Math.atan2(z - cz, x - cx);
      for (let i = 1; i <= n; i++) {
        const t = a0 + (sweep * i) / n;
        x = cx + Math.cos(t) * a;
        z = cz + Math.sin(t) * a;
        y += grade * (len / n);
        push();
      }
      h += sweep;
    }
  }
  // Close the loop.
  const ex = START.x - x;
  const ez = START.z - z;
  const dist = Math.hypot(ex, ez);
  const m = dist * 1.1;
  const n = Math.max(3, Math.round(dist / 20));
  const y0 = y;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
    const h10 = t ** 3 - 2 * t ** 2 + t;
    const h01 = -2 * t ** 3 + 3 * t ** 2;
    const h11 = t ** 3 - t ** 2;
    const px = h00 * x + h10 * m * Math.cos(h) + h01 * START.x + h11 * m * Math.cos(START.heading);
    const pz = h00 * z + h10 * m * Math.sin(h) + h01 * START.z + h11 * m * Math.sin(START.heading);
    const k = t * t * (3 - 2 * t);
    pts.push([Math.round(px * 100) / 100, Math.round((y0 + (START.y - y0) * k) * 100) / 100, Math.round(pz * 100) / 100]);
  }
  return pts;
}

export const ALPINE_SUMMIT = {
  id: 'alpine-summit',
  name: 'Alpine Summit',
  biome: 'alpine', // race/Race.js picks the scenery builder by this
  laps: 2,
  width: 15, // a narrow mountain road (Emerald Coast is 18 m)
  points: drivePoints(),
  // No highway street lights up here: reflector posts line the road instead.
  lampPosts: false,
  // Jump ramps (lap fractions; lateral span across the road, negative = left of travel).
  ramps: [
    { at: 0.03, length: 13, height: 1.6, from: -7.1, to: 2.5 }, // village bridge hump
    { at: 0.43, length: 14, height: 2.2, from: -7.1, to: 7.1 }, // snow kicker on the top leg
    { at: 0.868, length: 16, height: 2.6, from: -7.1, to: 7.1 }, // canyon straight
  ],
  slaloms: [0.14, 0.33, 0.627, 0.73, 0.95],
  barricades: [0.183, 0.275, 0.37, 0.68, 0.775, 0.915],
  // Black ice: stretches of the glacier descent the sun never reaches (lap fractions). How
  // slick they are follows the weather (race/track.js iceAt); `iceBase` is the least they ever
  // are, even at noon.
  ice: [
    { from: 0.575, to: 0.6 },
    { from: 0.64, to: 0.672 },
    { from: 0.692, to: 0.715 },
  ],
  iceBase: 0.45,
  // The stone tunnel through the ridge at the top of the pass (race/alpineSetPieces.js).
  tunnels: [{ from: 0.494, to: 0.5425, name: 'Summit Tunnel' }],
  // Where the scenery puts things: the village square and the lake south of it, and the centre
  // of the ring of peaks around the pass.
  village: { x: -40, z: 335 },
  lakeLevel: 0,
  massif: { x: -60, z: -120 },
  sun: { azimuth: -0.55, elevation: 0.42 },
};
