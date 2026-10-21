// AI rivals. `aggression` drives lane changes, ramp hunting, prop smashing and nitro use;
// `skill` scales cornering speed; `stats` offset the starter coupe baseline.

// The five Emerald Coast rivals (the crew every Chapter 1 race uses today). The first one's id
// stays 'riptide' from before the Coastal Boss took that name; ids are never shown.
export const RIVALS = [
  { id: 'riptide', name: 'Breakwater', color: '#19b5c4', finish: 'pearl', aggression: 0.85, skill: 0.97, laneBias: -0.3, stats: { speed: 2, accel: 2, handling: 0, nitro: 6 } },
  { id: 'volta', name: 'Volta', color: '#9be22d', finish: 'gloss', aggression: 0.45, skill: 0.95, laneBias: 0.4, stats: { speed: 0, accel: 4, handling: 4, nitro: 0 } },
  { id: 'solaris', name: 'Solaris', color: '#ff6a13', finish: 'metallic', aggression: 0.65, skill: 0.955, laneBias: 0.1, stats: { speed: 4, accel: 0, handling: -2, nitro: 2 } },
  { id: 'noctis', name: 'Noctis', color: '#4a4f57', finish: 'matte', aggression: 0.3, skill: 0.985, laneBias: -0.1, stats: { speed: 1, accel: 6, handling: 6, nitro: -4 } },
  { id: 'monarch', name: 'Monarch', color: '#d4a537', finish: 'chrome', aggression: 0.95, skill: 0.94, laneBias: 0.25, stats: { speed: 6, accel: -2, handling: -4, nitro: 8 } },
];

// Chapter 2 and 3 crews and the three regional bosses (data only until those chapters ship).
export const ALPINE_RIVALS = [
  { id: 'edelweiss', name: 'Edelweiss', color: '#e9edf2', finish: 'pearl', aggression: 0.4, skill: 0.975, laneBias: -0.2, stats: { speed: 6, accel: 4, handling: 8, nitro: 2 } },
  { id: 'granite', name: 'Granite', color: '#6b6f76', finish: 'matte', aggression: 0.9, skill: 0.95, laneBias: 0.3, stats: { speed: 10, accel: 2, handling: 0, nitro: 8 } },
  { id: 'frostbite', name: 'Frostbite', color: '#7fd3ff', finish: 'metallic', aggression: 0.6, skill: 0.965, laneBias: 0, stats: { speed: 8, accel: 6, handling: 4, nitro: 4 } },
  { id: 'cascade', name: 'Cascade', color: '#1f7a5c', finish: 'gloss', aggression: 0.5, skill: 0.98, laneBias: 0.2, stats: { speed: 6, accel: 8, handling: 6, nitro: 2 } },
  { id: 'summit', name: 'Summit', color: '#c8102e', finish: 'metallic', aggression: 0.75, skill: 0.96, laneBias: -0.35, stats: { speed: 9, accel: 4, handling: 2, nitro: 10 } },
];

export const NEON_RIVALS = [
  { id: 'glitch', name: 'Glitch', color: '#ff2bd6', finish: 'pearl', aggression: 0.9, skill: 0.97, laneBias: 0.25, stats: { speed: 14, accel: 10, handling: 6, nitro: 14 } },
  { id: 'kilowatt', name: 'Kilowatt', color: '#f7ff3c', finish: 'gloss', aggression: 0.55, skill: 0.985, laneBias: -0.1, stats: { speed: 12, accel: 14, handling: 10, nitro: 6 } },
  { id: 'synth', name: 'Synth', color: '#00e5ff', finish: 'chrome', aggression: 0.7, skill: 0.975, laneBias: 0.35, stats: { speed: 14, accel: 8, handling: 8, nitro: 12 } },
  { id: 'neonoir', name: 'Neo Noir', color: '#121317', finish: 'gloss', aggression: 0.35, skill: 0.99, laneBias: 0, stats: { speed: 12, accel: 12, handling: 14, nitro: 6 } },
  { id: 'overclock', name: 'Overclock', color: '#5b2bd1', finish: 'pearl', aggression: 0.95, skill: 0.965, laneBias: -0.3, stats: { speed: 16, accel: 8, handling: 4, nitro: 16 } },
];

// Boss ids predate the Phase 10 story names (Riptide, Avalanche, Kage) and stay as they are.
// `quote` is the line the pre-race briefing shows under the boss card.
export const BOSSES = [
  { id: 'boss-tidebreaker', name: 'Riptide', title: 'Coastal Champion', quote: 'The coast road bends to me. You will learn to bend too.', color: '#0d2a6b', finish: 'pearl', aggression: 0.8, skill: 0.99, laneBias: 0, stats: { speed: 10, accel: 8, handling: 8, nitro: 10 } },
  { id: 'boss-avalanche', name: 'Avalanche', title: 'Master of the Pass', quote: 'Up here the mountain decides who finishes. I just help it.', color: '#e9edf2', finish: 'chrome', aggression: 0.9, skill: 0.995, laneBias: 0, stats: { speed: 18, accel: 14, handling: 14, nitro: 16 } },
  { id: 'boss-voltage', name: 'Kage', title: 'Shadow of Neon City', quote: 'You will not see me pass. Nobody ever does.', color: '#ff2bd6', finish: 'founder', aggression: 0.95, skill: 1.0, laneBias: 0, stats: { speed: 26, accel: 20, handling: 20, nitro: 24 } },
];

// Who a stage races against. `difficulty` (0-1) is how hard the set pushes inside its chapter;
// solo modes use the 'solo' set.
export const RIVAL_SETS = {
  solo: { id: 'solo', rivals: [], difficulty: 0 },
  'coast-rookie': { id: 'coast-rookie', rivals: RIVALS.map((r) => r.id), difficulty: 0.2 },
  'coast-pro': { id: 'coast-pro', rivals: RIVALS.map((r) => r.id), difficulty: 0.6 },
  'coast-boss': { id: 'coast-boss', rivals: ['boss-tidebreaker'], difficulty: 1 },
  'alpine-club': { id: 'alpine-club', rivals: ALPINE_RIVALS.map((r) => r.id), difficulty: 0.3 },
  'alpine-pro': { id: 'alpine-pro', rivals: ALPINE_RIVALS.map((r) => r.id), difficulty: 0.7 },
  'alpine-boss': { id: 'alpine-boss', rivals: ['boss-avalanche'], difficulty: 1 },
  'neon-syndicate': { id: 'neon-syndicate', rivals: NEON_RIVALS.map((r) => r.id), difficulty: 0.4 },
  'neon-elite': { id: 'neon-elite', rivals: NEON_RIVALS.map((r) => r.id), difficulty: 0.8 },
  'neon-boss': { id: 'neon-boss', rivals: ['boss-voltage'], difficulty: 1 },
};

export const ALL_RIVALS = [...RIVALS, ...ALPINE_RIVALS, ...NEON_RIVALS, ...BOSSES];
export const rivalById = (id) => ALL_RIVALS.find((r) => r.id === id);
