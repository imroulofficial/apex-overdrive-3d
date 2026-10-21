// Offline save data. localStorage (persisted by the Android WebView) is the source of
// truth and every save is instant and local. src/core/cloud.js mirrors the progress part
// of it (see progressOf) to Cloud Firestore at a few milestones. The schema, the v1 -> v2
// migration and the cloud shape live in core/saveSchema.js.
import { migrate, progressOf as progressOfSave, applyProgress as applyProgressTo } from './saveSchema.js';
import { carById } from '../data/cars.js';

const KEY = 'apex-overdrive.save.v2';
// Phase 1-6 saves. Read once to migrate, then left in place untouched as a fallback copy.
const V1_KEY = 'apex-overdrive.save.v1';

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function load() {
  return migrate(read(KEY) ?? read(V1_KEY));
}

const listeners = new Set();
export const state = load();

export const progressOf = (s = state) => progressOfSave(s);
let lastProgress = JSON.stringify(progressOf());

// Replaces this device's progress with a cloud copy (see saveSchema.applyProgress).
export function applyProgress(p, savedAt) {
  applyProgressTo(state, p, savedAt);
  lastProgress = JSON.stringify(progressOf());
  save();
}

export function save() {
  const progress = JSON.stringify(progressOf());
  if (progress !== lastProgress) {
    lastProgress = progress;
    state.savedAt = Date.now();
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode); progress stays in memory for this session.
  }
  listeners.forEach((fn) => fn(state));
}
// A migrated v1 save is written out as v2 straight away (savedAt is kept, so the cloud copy
// is not treated as older than it is).
if (!read(KEY)) save();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function addCoins(amount) {
  state.coins += Math.max(0, Math.round(amount));
}

export function spendCoins(amount) {
  if (state.coins < amount) return false;
  state.coins -= amount;
  return true;
}

// The selected car's own progression entry (upgrades, paint, rims) and definition.
export const activeCar = () => state.cars[state.car];
export const activeCarDef = () => carById(state.car);
