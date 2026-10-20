// The five Emerald Coast rivals. `aggression` drives lane changes, ramp hunting, prop smashing
// and nitro use; `skill` scales cornering speed; `stats` offset the starter coupe baseline.
export const RIVALS = [
  { id: 'riptide', name: 'Riptide', color: '#19b5c4', finish: 'pearl', aggression: 0.85, skill: 0.97, laneBias: -0.3, stats: { speed: 2, nitro: 6, handling: 0, grip: 2 } },
  { id: 'volta', name: 'Volta', color: '#9be22d', finish: 'gloss', aggression: 0.45, skill: 0.95, laneBias: 0.4, stats: { speed: 0, nitro: 0, handling: 4, grip: 4 } },
  { id: 'solaris', name: 'Solaris', color: '#ff6a13', finish: 'metallic', aggression: 0.65, skill: 0.955, laneBias: 0.1, stats: { speed: 4, nitro: 2, handling: -2, grip: 0 } },
  { id: 'noctis', name: 'Noctis', color: '#4a4f57', finish: 'matte', aggression: 0.3, skill: 0.985, laneBias: -0.1, stats: { speed: 1, nitro: -4, handling: 6, grip: 6 } },
  { id: 'monarch', name: 'Monarch', color: '#d4a537', finish: 'chrome', aggression: 0.95, skill: 0.94, laneBias: 0.25, stats: { speed: 6, nitro: 8, handling: -4, grip: -2 } },
];

// Race rewards in coins by finishing position (1st..6th), plus bonuses.
export const POSITION_REWARD = [1200, 800, 600, 400, 300, 200];
export const DRIFT_POINTS_PER_COIN = 80;
export const SMASH_COINS = 5;
export const starsFor = (position) => (position === 1 ? 3 : position <= 3 ? 2 : 1);
