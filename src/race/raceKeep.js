// Whether the race world stays loaded while the player is in the garage (versionCode 76).
//
// v75 freed the whole race (track, scenery, cars, textures, compiled shaders) on the way back to
// the garage, so the next Start race from the world map rebuilt all of it behind a long loading
// bar, while Next race (results -> map -> Start race, the race kept) started at once. Keeping
// it costs the race's memory while the garage shows (tools/perf/loading.mjs measures both).
// A phone that reports little memory (navigator.deviceMemory, in GB, rounded down by the
// browser) still frees it: the garage and a whole race world side by side is too much there.
// Another track or another Graphics setting still builds a new race (main.js startRace).
export const RACE_KEEP = { minMemoryGB: 3 };

export function keepRaceInGarage(race, deviceMemory = globalThis.navigator?.deviceMemory) {
  if (!race?.ready) return false;
  // Unknown (WebViews without the API): keep, as the map already does.
  if (!(deviceMemory > 0)) return true;
  return deviceMemory >= RACE_KEEP.minMemoryGB;
}
