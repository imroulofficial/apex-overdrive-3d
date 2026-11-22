// Low-end GPU handling (ANR fixes, versionCode 69). On weak phone GPUs the WebView's GPU work
// can hold Android's UI thread for seconds (shader links, 2x-resolution frames), which Play
// reports as "Input dispatching timed out" ANRs. On those GPUs, and only while the player
// leaves Graphics on Auto, the game starts at Low, races without bloom and creates its WebGL
// context without MSAA. Any choice the player makes in Settings wins. When the GPU name
// cannot be read, nothing changes.
//
// The level Auto steps down to is also remembered on this device (localStorage, outside the
// save and never sent to the cloud), so later launches start there instead of re-probing
// from Medium and recompiling every shader a few seconds in.

// GPUs treated as low-end: every PowerVR (Imagination), ARM Mali-T7xx, T8xx, G31, G51, G52 and
// G57, and Qualcomm Adreno 3xx, 4xx and 505-512.
const LOW_END = [
  /PowerVR|Imagination|\bIMG\b/i,
  /Mali-T[78]\d\d\b/i,
  /Mali-G(31|51|52|57)\b/i,
];

const ADRENO = /Adreno\D{0,8}(\d{3})\b/i;

// true: low-end, false: anything else, null: no name to go on.
export function isLowEndGpu(name) {
  if (typeof name !== 'string' || !name.trim()) return null;
  if (LOW_END.some((re) => re.test(name))) return true;
  const adreno = ADRENO.exec(name);
  if (adreno) {
    const n = Number(adreno[1]);
    return (n >= 300 && n < 500) || (n >= 505 && n <= 512);
  }
  return false;
}

// The unmasked GPU name, from a throwaway context so the game's own canvas keeps its
// attributes free. Null when the browser does not expose it.
export function readGpuName() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof name === 'string' && name ? name : null;
  } catch {
    return null;
  }
}

export function detectGpu() {
  const name = readGpuName();
  return { name, lowEnd: isLowEndGpu(name) === true };
}

export const AUTO_LEVELS = ['high', 'medium', 'low'];
const AUTO_LEVEL_KEY = 'apex-overdrive.autoQuality';
const BLOOM_CHOSEN_KEY = 'apex-overdrive.bloomChosen';

function readLocal(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the next launch simply probes again.
  }
}

// The level Auto starts at: the lowest of its usual start, the level it stepped down to on an
// earlier launch, and Low on a low-end GPU.
export function autoStartLevel({ start, remembered = null, lowEnd = false }) {
  const candidates = [start, AUTO_LEVELS.includes(remembered) ? remembered : start, lowEnd ? 'low' : start];
  return candidates.reduce((a, b) => (AUTO_LEVELS.indexOf(b) > AUTO_LEVELS.indexOf(a) ? b : a));
}

export const rememberedAutoLevel = () => readLocal(AUTO_LEVEL_KEY);
export const rememberAutoLevel = (level) => AUTO_LEVELS.includes(level) && writeLocal(AUTO_LEVEL_KEY, level);

// Settings → Bloom pressed on this device: from then on the saved bloom setting is the
// player's own choice, even when it equals the default.
export const bloomChosen = () => readLocal(BLOOM_CHOSEN_KEY) === '1';
export const markBloomChosen = () => writeLocal(BLOOM_CHOSEN_KEY, '1');

// The bloom level a race uses. Off on a low-end GPU while Graphics is on Auto and the bloom
// setting is still the untouched default; otherwise exactly the setting.
export function raceBloom({ bloom, quality, lowEnd, chosen, defaultBloom }) {
  if (lowEnd && quality === 'auto' && !chosen && bloom === defaultBloom) return 'off';
  return bloom;
}
