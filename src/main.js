import './ui/style.css';
import { Garage } from './garage/Garage.js';
import { createHud } from './ui/hud.js';
import { createSettings } from './ui/settings.js';
import { PAINTS } from './data/catalog.js';
import { state } from './core/store.js';
import { suspendAudio } from './core/audio.js';
import { onAppStateChange, onBackButton } from './core/platform.js';

const canvas = document.getElementById('scene');
const fpsEl = document.getElementById('fps');
const paint = PAINTS.find((p) => p.id === state.paint) ?? PAINTS[0];

const garage = new Garage(canvas, {
  paintColor: paint.color,
  finish: paint.finish,
  quality: state.settings.quality,
  onFps: (fps) => {
    if (!fpsEl.hidden) fpsEl.textContent = `${Math.round(fps)} FPS`;
  },
});

const hud = createHud(garage);
if (new URLSearchParams(location.search).has('debug')) window.__garage = garage;
const settings = createSettings(garage, {
  onFpsToggle: (on) => (fpsEl.hidden = !on),
});
fpsEl.hidden = !state.settings.showFps;

garage.start();

// Reveal once the first frames (and shader compiles) are done.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    document.getElementById('splash').classList.add('is-done');
    hud.show();
    garage.intro();
  })
);

// Stop rendering in the background to save battery.
onAppStateChange((active) => {
  if (active) garage.start();
  else {
    garage.stop();
    suspendAudio();
  }
});

onBackButton(() => {
  if (settings.isOpen) {
    settings.close();
    return true;
  }
  return false;
});
