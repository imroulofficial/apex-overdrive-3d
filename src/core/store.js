// Offline save data. Everything lives on-device in localStorage (persisted by the
// Android WebView); there is no account and no server sync.
import { STARTING_COINS } from '../config.js';

const KEY = 'apex-overdrive.save.v1';

const defaults = () => ({
  coins: STARTING_COINS,
  paint: 'apex-red',
  ownedPaints: ['apex-red', 'midnight', 'arctic', 'carbon'],
  upgrades: { engine: 0, nitro: 0, handling: 0, tires: 0 },
  settings: { quality: 'auto', sound: true, showFps: false },
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const data = JSON.parse(raw);
    const base = defaults();
    return {
      ...base,
      ...data,
      upgrades: { ...base.upgrades, ...data.upgrades },
      settings: { ...base.settings, ...data.settings },
    };
  } catch {
    return defaults();
  }
}

const listeners = new Set();
export const state = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode); progress stays in memory for this session.
  }
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function spendCoins(amount) {
  if (state.coins < amount) return false;
  state.coins -= amount;
  return true;
}
