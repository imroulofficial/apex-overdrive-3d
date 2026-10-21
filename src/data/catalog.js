// Garage catalog: paint finishes, rims and performance upgrades.
// Prices are in soft currency (coins) earned offline; nothing here requires a server.
import { UPGRADE_COSTS } from './economy.js';

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
  { id: 'volt', name: 'Volt Lime', color: '#9be22d', finish: 'gloss', price: 500 },
  { id: 'sunset', name: 'Sunset Orange', color: '#ff6a13', finish: 'metallic', price: 500 },
  { id: 'stealth', name: 'Stealth Grey', color: '#4a4f57', finish: 'matte', price: 600 },
  { id: 'ultraviolet', name: 'Ultraviolet', color: '#5b2bd1', finish: 'pearl', price: 900 },
  { id: 'aqua-pearl', name: 'Aqua Pearl', color: '#19b5c4', finish: 'pearl', price: 900 },
  { id: 'liquid-gold', name: 'Liquid Gold', color: '#d4a537', finish: 'chrome', price: 1500 },
  // Never sold for coins: granted by the No Ads Pack (see PRODUCTS in config.js).
  { id: 'founder', name: 'Red Pen Studio Founder', color: '#b3122f', finish: 'founder', price: 0, product: 'remove_ads' },
];

// Every car has its own levels (0 = stock, 1-5 bought with coins), stored per car in the
// save (see core/saveSchema.js). `stat` is the car stat (0-100) each level raises.
export const UPGRADES = [
  { id: 'topSpeed', name: 'Top Speed', blurb: 'Maximum velocity on long straights', stat: 'speed', maxLevel: 5 },
  { id: 'acceleration', name: 'Acceleration', blurb: 'Launch and recovery after a hit', stat: 'accel', maxLevel: 5 },
  { id: 'handling', name: 'Handling', blurb: 'Cornering, grip and drift control', stat: 'handling', maxLevel: 5 },
  { id: 'nitro', name: 'Nitro', blurb: 'Boost duration and shockwave power', stat: 'nitro', maxLevel: 5 },
];

// Cost of the next level for a car currently at `level` (0-4).
export const upgradeCost = (upgrade, level) => UPGRADE_COSTS[level] ?? Infinity;

// Six rim designs, bought per car (the 3D wheels arrive with the garage finish phase).
export const RIMS = [
  { id: 'stock', name: 'Stock Split-5', price: 0 },
  { id: 'mesh', name: 'Classic Mesh', price: 500 },
  { id: 'turbofan', name: 'Turbofan', price: 750 },
  { id: 'blade', name: 'Twin Blade', price: 1000 },
  { id: 'monoblock', name: 'Forged Monoblock', price: 1250 },
  { id: 'carbon-aero', name: 'Carbon Aero', price: 1500 },
];

// Starter coupe baseline stats (0-100) plus per-level gains. The four stats match the four
// garage bars: top speed, acceleration, handling and nitro.
export const BASE_STATS = { speed: 52, accel: 52, handling: 58, nitro: 40 };
export const STAT_PER_LEVEL = 9;
