// Chapter 3 track: Neon City, a 2.9 km night circuit (data shape as in data/tracks.js).
// The city sits on flat ground at y = 0 with the harbour to the south (+z). Most of the lap
// is an elevated freeway on concrete piers (y 12-28 m): the Neon Mile start straight, the
// Eastern Interchange, then the cable-stayed Harbour Bridge over the inlet. The road drops to
// street level through the Arcade District (night-market stalls, underpasses beneath the
// crossing freeways) and climbs back up the Skyline Switchbacks to the line.
// Scenery: race/neonScenery.js (selected by `biome: 'neon'`).

export const NEON_CITY = {
  id: 'neon-city',
  name: 'Neon City',
  biome: 'neon',
  // Concrete hard shoulders and jersey barriers instead of gravel, grass and guardrails; the
  // biome builds its own trackside (race/trackMeshes.js skips the coast furniture).
  urban: true,
  laps: 2,
  width: 18,
  points: [
    [0, 14, -69],
    [192, 14, -83],
    [384, 15, -71],
    [516, 14, -14],
    [554, 12, 92],
    [504, 14, 184],
    [360, 20, 232],
    [180, 26, 246],
    [0, 28, 248],
    [-180, 26, 241],
    [-336, 18, 221],
    [-456, 10, 143],
    [-485, 2, 25],
    [-410, 1, -71],
    [-478, 1, -172],
    [-396, 3, -276],
    [-240, 9, -313],
    [-142, 14, -237],
    [-218, 16, -152],
    [-130, 15, -85],
  ],
  ramps: [
    { at: 0.112, length: 15, height: 1.8, from: -8.6, to: 1.2 },
    { at: 0.598, length: 14, height: 1.6, from: -1.5, to: 8.6 },
  ],
  slaloms: [0.04, 0.33, 0.68, 0.965],
  barricades: [0.15, 0.27, 0.52, 0.71, 0.8, 0.9],
  // Night-market food stalls on the Arcade District kerbs (the fruit-stall breakable).
  fruitStalls: [0.655, 0.7, 0.745, 0.765],
  neonSigns: [0.03, 0.12, 0.18, 0.25, 0.3, 0.55, 0.63, 0.69, 0.74, 0.82, 0.88, 0.935],
  // The harbour: open water south of harbourZ(x), plus the inlet the Harbour Bridge crosses.
  harbourZ: (x) => 318 + 18 * Math.sin(x / 170 + 0.4),
  inlet: { halfWidth: 128, headZ: 150 },
  // Moonlight; the weather preset overrides it.
  sun: { azimuth: 2.3, elevation: 0.7 },

  // ---- Biome 3 set-pieces (race/neonScenery.js) ----
  // Cable-stayed bridge over the inlet (lap fractions), its two H pylons at `pylons`.
  harbourBridge: { from: 0.372, to: 0.497, pylons: [0.405, 0.465], name: 'Harbour Bridge' },
  // Freeways that cross over the circuit: lap fraction of the crossing, angle from the road
  // (radians), clearance above the road (m), lanes each way, and a name for the fascia sign.
  overpasses: [
    { at: 0.08, angle: 1.57, clearance: 9.5, lanes: 2, name: 'Metro Expressway' },
    { at: 0.235, angle: 1.35, clearance: 9, lanes: 2, name: 'Ring Road' },
    { at: 0.668, angle: 1.62, clearance: 8.5, lanes: 3, name: 'Arcade Underpass' },
    { at: 0.722, angle: 1.1, clearance: 15, lanes: 2, name: 'Sky Link' },
    { at: 0.972, angle: 1.45, clearance: 9, lanes: 2, name: 'Harbour Spur' },
  ],
  // Downtown: tower heights peak around these centres (x, z, radius, peak height).
  downtown: [
    [-250, -140, 260, 210],
    [260, 60, 220, 170],
  ],
};
