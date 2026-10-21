import './ui/style.css';
import { Garage } from './garage/Garage.js';
import { createHud, toast } from './ui/hud.js';
import { createSettings } from './ui/settings.js';
import { createRaceHud } from './ui/raceHud.js';
import { Race } from './race/Race.js';
import { createRaceInput } from './race/input.js';
import { createStore } from './ui/store.js';
import { createCloudBadge } from './ui/cloudBadge.js';
import { PAINTS } from './data/catalog.js';
import { carById } from './data/cars.js';
import { EMERALD_COAST } from './data/tracks.js';
import { STAGES } from './data/career.js';
import { state, save, addCoins, activeCar } from './core/store.js';
import { settleStage } from './core/career.js';
import { carStats } from './core/inventory.js';
import { ads } from './monetization/ads.js';
import { billing } from './monetization/billing.js';
import { cloud } from './core/cloud.js';
import { suspendAudio, resumeAudio } from './core/audio.js';
import { onAppStateChange, onBackButton } from './core/platform.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#scene');
const fpsEl = $('#fps');
const currentPaint = () => PAINTS.find((p) => p.id === activeCar().paint) ?? PAINTS[0];
// Until the stage map lands, every race is career stage 1 (Classic, Coastal Loop, 2 laps).
const CURRENT_STAGE = STAGES[0];
const showFps = (fps) => {
  if (!fpsEl.hidden) fpsEl.textContent = `${Math.round(fps)} FPS`;
};

const garage = new Garage(canvas, {
  car: carById(state.car),
  paintColor: currentPaint().color,
  finish: currentPaint().finish,
  quality: state.settings.quality,
  onFps: showFps,
});

// 'garage' | 'busy' (transitioning) | 'race'
let mode = 'garage';
let race = null;
let lastWinnings = 0;
let lastResult = null; // the finished race whose coins the rewarded ad can double

const store = createStore({ onPurchased: () => ads.refreshEntitlements() });
const hud = createHud(garage, { onRaceStart: () => startRace(), onOpenStore: (id) => store.open(id) });
if (new URLSearchParams(location.search).has('debug')) window.__garage = garage;
const settings = createSettings(garage, {
  onFpsToggle: (on) => (fpsEl.hidden = !on),
  onEntitlementsChanged: () => ads.refreshEntitlements(),
  onCrateReset: () => store.resetCrate(),
});
fpsEl.hidden = !state.settings.showFps;
createCloudBadge();

// Cloud save milestones (see core/cloud.js). Play purchases and restores that paid out
// upload shortly after; paint and upgrade purchases are wired in the garage HUD.
billing.subscribe((e) => {
  if (e.type === 'purchase' || (e.type === 'sync' && (e.restored.length || e.coins))) cloud.syncSoon();
});
cloud.subscribe((_, { restored } = {}) => {
  if (!restored) return;
  billing.refresh();
  ads.refreshEntitlements();
  hud.reloadSave();
  toast('Cloud save restored');
});

const raceInput = createRaceInput({
  steerPad: $('#rc-steer'),
  wheel: $('#rc-wheel'),
  brakes: [$('#rc-drift'), $('#rc-brake')],
  nitro: $('#rc-nitro'),
  gas: $('#rc-gas'),
  hud: $('#race-hud'),
});
const raceHud = createRaceHud({
  onPause: () => pauseRace(),
  onResume: () => resumeRace(),
  onRestart: () => restartRace(),
  onQuit: () => exitToGarage(),
  onGarage: () => exitToGarage(),
  onRaceAgain: () => restartRace(),
  onDoubleCoins: () => doubleCoins(),
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

const playerStats = () => carStats(state, state.car);

function beginRace() {
  raceInput.setAutoAccelerate(state.settings.autoAccelerate);
  raceInput.setScheme(state.settings.controls);
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
      await race.prepare({ quality: garage.qualityLevel, paint: currentPaint(), car: carById(state.car) });
    } else {
      await race.setPlayerCar(carById(state.car), currentPaint());
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
  ads.setBanner(false);
  garage.stop();
  lastWinnings = 0;
  beginRace();
  mode = 'race';
  await wipe.reveal();
}

// Coins, stars and bests are saved the moment the player crosses the line.
function bankResult(result) {
  const settled = settleStage(state, CURRENT_STAGE, result);
  lastWinnings += settled.coins.total;
  // The rewarded 2x pays the race coins again (finish + skill), not the one-time star bonus.
  lastResult = { coins: settled.coins.race, doubled: false };
  ads.noteRaceFinished();
  save();
  result.coins = settled.coins;
  result.stars = settled.stars;
  result.objectives = CURRENT_STAGE.objectives;
  result.best = settled.newBest;
  result.wallet = state.coins;
}

// Results screen: a rewarded video pays the race's coins a second time.
async function doubleCoins() {
  if (!lastResult || lastResult.doubled || mode !== 'race') return;
  const res = lastResult;
  raceHud.setDoubleState('loading');
  const outcome = await ads.showRewarded();
  if (outcome !== 'rewarded') {
    raceHud.setDoubleState('ready');
    if (outcome === 'unavailable') toast('No ad available right now. Try again in a moment.');
    return;
  }
  res.doubled = true;
  addCoins(res.coins);
  lastWinnings += res.coins;
  save();
  raceHud.setDoubleState('done', { bonus: res.coins, wallet: state.coins });
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
  lastResult = null;
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
  lastResult = null;
  // After the first 3 races, every 2-3 finished races an interstitial plays here, behind the
  // wipe (never within 3 minutes of another full-screen ad).
  await ads.maybeShowInterstitial();
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
  cloud.syncNow();
}

garage.start();

// Reveal once the first frames (and shader compiles) are done.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    $('#splash').classList.add('is-done');
    hud.show();
    garage.intro();
    // Monetization starts after the first frame so it never delays the garage reveal.
    billing.init().then(() => ads.refreshEntitlements());
    // The banner only shows while Settings is open (blueprint: never in the garage or a race).
    ads.init();
    // Fetches the cloud save (adopted if newer than this device's), then uploads if needed.
    cloud.init();
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
  if (store.isOpen) {
    store.close();
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
  window.__app = { get race() { return race; }, startRace, exitToGarage, state, ads, billing, store, cloud };
}
