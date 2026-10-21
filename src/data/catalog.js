// Garage catalog: paint finishes and performance upgrades.
// Prices are in soft currency (coins) earned offline; nothing here requires a server.

export const FINISHES = {
  metallic: { label: 'Metallic', metalness: 0.65, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.03, flake: 0.35, iridescence: 0 },
  gloss: { label: 'Gloss', metalness: 0.05, roughness: 0.22, clearcoat: 1.0, clearcoatRoughness: 0.02, flake: 0.0, iridescence: 0 },
  pearl: { label: 'Pearl', metalness: 0.45, roughness: 0.28, clearcoat: 1.0, clearcoatRoughness: 0.04, flake: 0.25, iridescence: 0.85 },
  matte: { label: 'Matte', metalness: 0.2, roughness: 0.62, clearcoat: 0.0, clearcoatRoughness: 1.0, flake: 0.0, iridescence: 0 },
  chrome: { label: 'Chrome', metalness: 1.0, roughness: 0.08, clearcoat: 0.6, clearcoatRoughness: 0.05, flake: 0.0, iridescence: 0 },
  // Thin-film colour shift over a heavy metallic flake: crimson head-on, violet and gold at grazing angles.
  founder: { label: 'Iridescent Metallic', metalness: 0.8, roughness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.02, flake: 0.5, iridescence: 1.0 },
};

export const PAINTS = [
  { id: 'apex-red', name: 'Apex Red', color: '#c8102e', finish: 'metallic', price: 0 },
  { id: 'midnight', name: 'Midnight Blue', color: '#0d2a6b', finish: 'metallic', price: 0 },
  { id: 'arctic', name: 'Arctic White', color: '#e9edf2', finish: 'gloss', price: 0 },
  { id: 'carbon', name: 'Carbon Black', color: '#121317', finish: 'gloss', price: 0 },
  { id: 'volt', name: 'Volt Lime', color: '#9be22d', finish: 'gloss', price: 400 },
  { id: 'sunset', name: 'Sunset Orange', color: '#ff6a13', finish: 'metallic', price: 400 },
  { id: 'stealth', name: 'Stealth Grey', color: '#4a4f57', finish: 'matte', price: 600 },
  { id: 'ultraviolet', name: 'Ultraviolet', color: '#5b2bd1', finish: 'pearl', price: 900 },
  { id: 'aqua-pearl', name: 'Aqua Pearl', color: '#19b5c4', finish: 'pearl', price: 900 },
  { id: 'liquid-gold', name: 'Liquid Gold', color: '#d4a537', finish: 'chrome', price: 1500 },
  // Never sold for coins: granted by the No Ads Pack (see PRODUCTS in config.js).
  { id: 'founder', name: 'Red Pen Studio Founder', color: '#b3122f', finish: 'founder', price: 0, product: 'remove_ads' },
];

export const UPGRADES = [
  { id: 'engine', name: 'Engine', blurb: 'Top speed and acceleration', stat: 'speed', maxLevel: 5, baseCost: 300 },
  { id: 'nitro', name: 'Nitro', blurb: 'Boost duration and power', stat: 'nitro', maxLevel: 5, baseCost: 350 },
  { id: 'handling', name: 'Handling', blurb: 'Steering and drift control', stat: 'handling', maxLevel: 5, baseCost: 250 },
  { id: 'tires', name: 'Tires', blurb: 'Grip and launch', stat: 'grip', maxLevel: 5, baseCost: 200 },
];

export const upgradeCost = (upgrade, level) => Math.round(upgrade.baseCost * Math.pow(1.6, level));

// Starter coupe baseline stats (0-100) plus per-level gains.
export const BASE_STATS = { speed: 52, nitro: 40, handling: 58, grip: 50 };
export const STAT_PER_LEVEL = 9;
