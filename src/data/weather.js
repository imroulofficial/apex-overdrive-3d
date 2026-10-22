// Weather presets (blueprint §03 Atmosphere). Each stage names one; the race applies its sky,
// sun, fog, ocean tint, wet road, rain, lightning and bloom when the stage is set up
// (race/atmosphere.js). Pure data, so the tests can import it under Node.
//
// Colours are sRGB hex. `sun.azimuth` is radians from +z (the sea, south) toward +x;
// `elevation` radians above the horizon. `fog.density` drives both the distance haze and the
// low-lying mist that pools over the sea and in the hollows (render/heightFog.js).
// `wet` (0-1) darkens and glosses the asphalt, opens reflective puddles and costs tyre grip;
// `rain` (0-1) is the density of falling rain; `pace` scales the stage's target times.
// `clouds.cover` (0-1) is how much of the sky the cloud deck hides, lit / shade its colours.

export const WEATHER = {
  GoldenHour: {
    id: 'GoldenHour',
    name: 'Golden Hour Sunset',
    short: 'Golden Hour',
    sun: { azimuth: -1.02, elevation: 0.13, color: 0xffb46a, intensity: 3.1 },
    hemi: { sky: 0xffd9b0, ground: 0x5a4430, intensity: 0.85 },
    sky: { top: 0x3d5f9c, horizon: 0xffb27a, sun: 0xffc27f, glow: 0.55 },
    clouds: { cover: 0.34, lit: 0xffc08a, shade: 0x8a6a86 },
    fog: { color: 0xe7b48c, density: 0.00042 },
    ocean: { deep: 0x10324d, shallow: 0x2a6f78 },
    mountains: 0x9b7f86,
    exposure: 1.0,
    wet: 0,
    rain: 0,
    lightning: false,
    bloom: { threshold: 0.95, strength: 0.6 },
    pace: 1,
  },
  Fog: {
    id: 'Fog',
    name: 'Morning Coastal Fog',
    short: 'Coastal Fog',
    sun: { azimuth: 0.6, elevation: 0.38, color: 0xdfe8ee, intensity: 1.15 },
    hemi: { sky: 0xd9e6ee, ground: 0x56614f, intensity: 1.35 },
    sky: { top: 0x8ea6b6, horizon: 0xc9d4da, sun: 0xf2f4ee, glow: 0.25 },
    clouds: { cover: 0.75, lit: 0xe4eaee, shade: 0xa9b5bd },
    fog: { color: 0xc3ced4, density: 0.0021 },
    ocean: { deep: 0x22404f, shallow: 0x4b7480 },
    mountains: 0xb4c0c6,
    exposure: 1.05,
    wet: 0.25,
    rain: 0,
    lightning: false,
    bloom: { threshold: 1.05, strength: 0.4 },
    pace: 0.98,
  },
  Rain: {
    id: 'Rain',
    name: 'Light Tropical Rain',
    short: 'Tropical Rain',
    sun: { azimuth: -0.4, elevation: 0.5, color: 0xcfd8de, intensity: 0.9 },
    hemi: { sky: 0xb7c6cf, ground: 0x3f4a3a, intensity: 1.15 },
    sky: { top: 0x5d6d78, horizon: 0xa8b4ba, sun: 0xe6ecef, glow: 0.12 },
    clouds: { cover: 0.85, lit: 0xb9c3ca, shade: 0x6b7680 },
    fog: { color: 0x9eabb2, density: 0.0011 },
    ocean: { deep: 0x163543, shallow: 0x356672 },
    mountains: 0x8d9aa2,
    exposure: 1.08,
    wet: 0.85,
    rain: 0.5,
    lightning: false,
    bloom: { threshold: 0.9, strength: 0.55 },
    pace: 0.96,
  },
  // Stage 20 finale: a squall off the sea, lightning and the road running with water.
  Storm: {
    id: 'Storm',
    name: 'Coastal Storm',
    short: 'Storm',
    sun: { azimuth: -0.2, elevation: 0.62, color: 0xa9b6c4, intensity: 0.45 },
    hemi: { sky: 0x7e8ea0, ground: 0x2a2f2a, intensity: 0.95 },
    sky: { top: 0x252c36, horizon: 0x5c6670, sun: 0xb8c4d0, glow: 0.05 },
    clouds: { cover: 0.96, lit: 0x6f7b88, shade: 0x262c34 },
    fog: { color: 0x515b64, density: 0.0016 },
    ocean: { deep: 0x0b1b25, shallow: 0x1f3d47 },
    mountains: 0x434c55,
    exposure: 1.15,
    wet: 1,
    rain: 1,
    lightning: true,
    bloom: { threshold: 0.8, strength: 0.75 },
    pace: 0.94,
  },
  // Chapters 2 and 3 (their stages race on Emerald Coast until those tracks ship).
  Midday: {
    id: 'Midday',
    name: 'Crisp Midday',
    short: 'Midday',
    sun: { azimuth: -0.55, elevation: 0.42, color: 0xfff0d6, intensity: 2.7 },
    hemi: { sky: 0xcfe6ff, ground: 0x5a5236, intensity: 1.05 },
    sky: { top: 0x2f73c9, horizon: 0xcfe3ee, sun: 0xfff2d2, glow: 0.32 },
    clouds: { cover: 0.22, lit: 0xffffff, shade: 0xb4c2d2 },
    fog: { color: 0xcfe3ee, density: 0.00034 },
    ocean: { deep: 0x07344f, shallow: 0x0f6f86 },
    mountains: 0x9fb4c4,
    exposure: 1.05,
    wet: 0,
    rain: 0,
    lightning: false,
    bloom: { threshold: 1.1, strength: 0.4 },
    pace: 1,
  },
  Dusk: {
    id: 'Dusk',
    name: 'Overcast Dusk',
    short: 'Dusk',
    sun: { azimuth: -1.2, elevation: 0.08, color: 0xff8a6a, intensity: 1.5 },
    hemi: { sky: 0x9d8fb4, ground: 0x3a3236, intensity: 0.9 },
    sky: { top: 0x2c2f55, horizon: 0xc98a8a, sun: 0xff9a7a, glow: 0.35 },
    clouds: { cover: 0.6, lit: 0xf0a090, shade: 0x4d4466 },
    fog: { color: 0xa98a96, density: 0.0007 },
    ocean: { deep: 0x10223b, shallow: 0x2f4f66 },
    mountains: 0x6d6280,
    exposure: 1.1,
    wet: 0.2,
    rain: 0,
    lightning: false,
    bloom: { threshold: 0.85, strength: 0.6 },
    pace: 0.99,
  },
  // Chapter 2 · Alpine Summit. Extra fields the mountain reads: `snow` (0-1) is falling snow,
  // `ice` (0-1) how slick the black-ice stretches are (the track's own minimum still applies),
  // `snowLine` the height (m) above which the ground lies under snow.
  MountainFog: {
    id: 'MountainFog',
    name: 'Cloud on the Pass',
    short: 'Mountain Cloud',
    sun: { azimuth: 0.4, elevation: 0.45, color: 0xe6eef4, intensity: 1.2 },
    hemi: { sky: 0xdde6ee, ground: 0x5a6068, intensity: 1.35 },
    sky: { top: 0x93a6b8, horizon: 0xd2dbe2, sun: 0xf4f6f6, glow: 0.2 },
    clouds: { cover: 0.8, lit: 0xe8edf1, shade: 0xa7b3bd },
    fog: { color: 0xc8d2da, density: 0.0019 },
    ocean: { deep: 0x1e3a48, shallow: 0x46707c },
    mountains: 0xc0cbd3,
    exposure: 1.05,
    wet: 0.3,
    rain: 0,
    lightning: false,
    bloom: { threshold: 1.05, strength: 0.4 },
    pace: 0.98,
    snow: 0,
    ice: 0.6,
    snowLine: 140,
  },
  Snowfall: {
    id: 'Snowfall',
    name: 'Fresh Snowfall',
    short: 'Snowfall',
    sun: { azimuth: -0.3, elevation: 0.4, color: 0xe8f0ff, intensity: 1.0 },
    hemi: { sky: 0xe4ecf6, ground: 0x7d8590, intensity: 1.4 },
    sky: { top: 0x7f91a8, horizon: 0xdfe6ee, sun: 0xf6f8ff, glow: 0.15 },
    clouds: { cover: 0.9, lit: 0xeef2f6, shade: 0x9aa6b4 },
    fog: { color: 0xd6dee6, density: 0.0012 },
    ocean: { deep: 0x1a3442, shallow: 0x3f6672 },
    mountains: 0xd2dae2,
    exposure: 1.0,
    wet: 0.2,
    rain: 0,
    lightning: false,
    bloom: { threshold: 1.0, strength: 0.45 },
    pace: 0.96,
    snow: 0.55,
    ice: 0.8,
    snowLine: 22,
  },
  // Stage 40 finale: a blizzard over the pass for the duel with Avalanche.
  Blizzard: {
    id: 'Blizzard',
    name: 'Summit Blizzard',
    short: 'Blizzard',
    sun: { azimuth: -0.6, elevation: 0.55, color: 0xc4d2e4, intensity: 0.6 },
    hemi: { sky: 0xb9c6d6, ground: 0x5e6670, intensity: 1.25 },
    sky: { top: 0x58677a, horizon: 0xaeb9c6, sun: 0xd6e0ec, glow: 0.06 },
    clouds: { cover: 0.97, lit: 0xb8c3cf, shade: 0x5d6876 },
    fog: { color: 0xa9b5c2, density: 0.0024 },
    ocean: { deep: 0x122633, shallow: 0x2f4f5c },
    mountains: 0x9ba7b4,
    exposure: 1.12,
    wet: 0.3,
    rain: 0,
    lightning: false,
    bloom: { threshold: 0.9, strength: 0.55 },
    pace: 0.93,
    snow: 1,
    ice: 1,
    snowLine: 6,
  },
};

export const WEATHER_IDS = Object.keys(WEATHER);

// Tyre grip on a wet road (multipliers on the surface's own coefficients). Standing water in a
// puddle costs more and drags at the tyres. Dirt turns to slick mud in the rain.
export function wetGrip(wet) {
  const w = Math.max(0, Math.min(1, wet));
  return {
    grip: 1 - 0.16 * w,
    driftGrip: 1 - 0.1 * w,
    steer: 1 - 0.05 * w,
    mud: 1 - 0.22 * w,
  };
}

export const PUDDLE = { grip: 0.62, drag: 0.12, steer: 0.86 };

// Bloom quality levels (Settings): 'off' renders straight to the screen; 'low' blurs the
// bright pass at quarter resolution; 'medium' at half resolution plus a quarter-resolution
// halo (render/bloom.js).
export const BLOOM_LEVELS = ['off', 'low', 'medium'];
export const DEFAULT_BLOOM = 'low';
