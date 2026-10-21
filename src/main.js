import './ui/style.css';
import { Garage } from './garage/Garage.js';
import { createHud, toast } from './ui/hud.js';
import { createSettings } from './ui/settings.js';
import { createRaceHud } from './ui/raceHud.js';
import { Race } from './race/Race.js';
import { createRaceInput } from './race/input.js';
import { PAINTS, UPGRADES, BASE_STATS, STAT_PER_LEVEL } from './data/catalog.js';
import { EMERALD_COAST } from './data/tracks.js';
import { state, save, addCoins } from './core/store.js';
import { suspendAudio, resumeAudio } from './core/audio.js';
import { onAppStateChange, onBackButton } from './core/platform.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#scene');
const fpsEl = $('#fps');
const currentPaint = () => PAINTS.find((p) => p.id === state.paint) ?? PAINTS[0];
const showFps = (fps) => {
  if (!fpsEl.hidden) fpsEl.textContent = `${Math.round(fps)} FPS`;
};

const garage = new Garage(canvas, {
  paintColor: currentPaint().color,
  finish: currentPaint().finish,
  quality: state.settings.quality,
  onFps: showFps,
});

// 'garage' | 'busy' (transitioning) | 'race'
let mode = 'garage';
let race = null;
let lastWinnings = 0;

const hud = createHud(garage, { onRaceStart: () => startRace() });
if (new URLSearchParams(location.search).has('debug')) window.__garage = garage;
const settings = createSettings(garage, {
  onFpsToggle: (on) => (fpsEl.hidden = !on),
});
fpsEl.hidden = !state.settings.showFps;

const raceInput = createRaceInput({ steerPad: $('#rc-steer'), drift: $('#rc-drift'), nitro: $('#rc-nitro') });
const raceHud = createRaceHud({
  onPause: () => pauseRace(),
  onResume: () => resumeRace(),
  onRestart: () => restartRace(),
  onQuit: () => exitToGarage(),
  onGarage: () => exitToGarage(),
  onRaceAgain: () => restartRace(),
});

// ---------------------------------------------------------------------------
// Garage ⇄ track transition (a skewed wipe that covers loading and shader compiles)
// ---------------------------------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const wipe = {
  el: $('#transition'),
  async cover(label) {
    $('#transition-label').textContent = label;
    this.el.style.transition = 'none';
    this.el.className = 'transition';
    this.el.hidden = false;
    void this.el.offsetWidth;
    this.el.style.transition = '';
    this.el.classList.add('cover');
    await wait(520);
    await nextFrame();
  },
  async reveal() {
    this.el.classList.remove('cover');
    this.el.classList.add('leave');
    await wait(520);
    this.el.hidden = true;
    this.el.className = 'transition';
  },
};

function playerStats() {
  const values = { ...BASE_STATS };
  UPGRADES.forEach((u) => (values[u.stat] += state.upgrades[u.id] * STAT_PER_LEVEL));
  for (const k of Object.keys(values)) values[k] = Math.min(100, values[k]);
  return values;
}

function beginRace() {
  race.begin({
    stats: playerStats(),
    paint: currentPaint(),
    input: raceInput,
    hud: raceHud,
    autoQuality: state.settings.quality === 'auto',
    onFinish: bankResult,
  });
}

async function startRace() {
  if (mode !== 'garage') return;
  mode = 'busy';
  await wait(600); // let the rev and the rear-camera swing play
  await wipe.cover(`LOADING ${EMERALD_COAST.name.toUpperCase()}`);
  try {
    if (!race) {
      race = new Race(garage.renderer, EMERALD_COAST, { onFps: showFps });
      await race.prepare({ quality: garage.qualityLevel, paint: currentPaint() });
    }
  } catch (err) {
    console.error(err);
    race = null;
    await wipe.reveal();
    toast('Could not load the track on this device.');
    mode = 'garage';
    return;
  }
  hud.hide();
  garage.stop();
  lastWinnings = 0;
  beginRace();
  mode = 'race';
  await wipe.reveal();
}

// Coins and records are saved the moment the player crosses the line.
function bankResult(result) {
  const rec = state.records[result.trackId] ?? { bestTime: null, stars: 0, races: 0, wins: 0 };
  const best = rec.bestTime === null || result.time < rec.bestTime;
  state.records[result.trackId] = {
    bestTime: best ? result.time : rec.bestTime,
    stars: Math.max(rec.stars, result.stars),
    races: rec.races + 1,
    wins: rec.wins + (result.position === 1 ? 1 : 0),
  };
  addCoins(result.coins.total);
  lastWinnings += result.coins.total;
  save();
  result.best = best && rec.bestTime !== null;
  result.wallet = state.coins;
}

function pauseRace() {
  if (mode !== 'race' || !race || raceHud.resultsOpen || race.phase === 'finished') return;
  race.pause();
  raceHud.openPause();
}

function resumeRace() {
  if (!race) return;
  raceHud.closePause();
  race.resume();
  resumeAudio();
}

async function restartRace() {
  if (mode !== 'race') return;
  mode = 'busy';
  raceHud.closePause();
  await wipe.cover('RESTARTING');
  raceHud.hideResults();
  beginRace();
  mode = 'race';
  await wipe.reveal();
}

async function exitToGarage() {
  if (mode !== 'race') return;
  mode = 'busy';
  raceHud.closePause();
  await wipe.cover('GARAGE');
  race.exit();
  raceHud.hide();
  raceHud.hideResults();
  garage.resize();
  garage.start();
  hud.snapBody();
  hud.show();
  mode = 'garage';
  await wipe.reveal();
  if (lastWinnings > 0) {
    hud.animateCoinsFrom(state.coins - lastWinnings);
    toast(`+${lastWinnings.toLocaleString('en-US')} coins banked`);
    lastWinnings = 0;
  }
}

garage.start();

// Reveal once the first frames (and shader compiles) are done.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    $('#splash').classList.add('is-done');
    hud.show();
    garage.intro();
  })
);

// Stop simulating in the background to save battery; a race pauses itself.
onAppStateChange((active) => {
  if (mode === 'race' && race) {
    if (active) race.start();
    else {
      pauseRace();
      race.stop();
      suspendAudio();
    }
    return;
  }
  if (active) {
    if (mode === 'garage') garage.start();
  } else {
    garage.stop();
    suspendAudio();
  }
});

onBackButton(() => {
  if (settings.isOpen) {
    settings.close();
    return true;
  }
  if (mode === 'busy') return true;
  if (mode === 'race') {
    if (raceHud.resultsOpen || race.phase === 'finished') exitToGarage();
    else if (race.isPaused) resumeRace();
    else pauseRace();
    return true;
  }
  return false;
});

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || mode !== 'race' || !race) return;
  if (race.isPaused) resumeRace();
  else pauseRace();
});

if (new URLSearchParams(location.search).has('debug')) {
  window.__app = { get race() { return race; }, startRace, exitToGarage, state };
}
