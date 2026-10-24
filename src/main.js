import './ui/style.css';
import { Garage } from './garage/Garage.js';
import { createHud, toast } from './ui/hud.js';
import { createSettings } from './ui/settings.js';
import { createRaceHud } from './ui/raceHud.js';
import { Race } from './race/Race.js';
import { createRaceInput } from './race/input.js';
import { CAMERA_VIEWS, CAMERA_LABELS } from './data/controls.js';
import { createStore } from './ui/store.js';
import { createCloudBadge } from './ui/cloudBadge.js';
import { PAINTS, fxById, DEFAULT_SMOKE, DEFAULT_NITRO } from './data/catalog.js';
import { CARS, carById } from './data/cars.js';
import { EMERALD_COAST, TRACKS } from './data/tracks.js';
import { STAGES, TRACK_SEGMENTS, stageById, chapterById } from './data/career.js';
import { STAR_BONUS } from './data/economy.js';
import { state, save, addCoins, activeCar } from './core/store.js';
import { settleStage, nextStage, chapterStars, claimMilestone, chapterLock } from './core/career.js';
import { duePrologue, dueBefore, dueAfter, markSeen } from './core/story.js';
import { sceneForStage } from './data/story.js';
import { defaultStage, isPlayable, isPractice, stageLabel, stageTag, starIcons } from './ui/stageInfo.js';
import { WorldMap } from './map/WorldMap.js';
import { createMapHud } from './ui/mapHud.js';
import { createBriefing } from './ui/briefing.js';
import { createDialogue } from './ui/dialogue.js';
import { RELEASE } from './config.js';
import { carStats, carLook } from './core/inventory.js';
import { ads, rewardedFallback } from './monetization/ads.js';
import { billing } from './monetization/billing.js';
import { cloud } from './core/cloud.js';
import { suspendAudio, resumeAudio, audioStats, audioLoaded } from './core/audio.js';
import { chestDialog } from './ui/chest.js';
import { onAppStateChange, onBackButton } from './core/platform.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#scene');
const fpsEl = $('#fps');
const currentPaint = () => PAINTS.find((p) => p.id === activeCar().paint) ?? PAINTS[0];
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
// Dev builds (pre-release, or ?debug) can pick any stage; locked ones run as practice.
const DEV = !RELEASE || DEBUG;

// The garage's stage chip offers the furthest unlocked stage ("continue"); it and the world
// map's Continue button open that stage's briefing. Dev shortcuts: ?stage=ec-05, or
// ?mode=TimeTrial for the first stage of that mode (what __app.startRace() races).
function initialStage() {
  const byId = params.get('stage') && stageById(params.get('stage'));
  const byMode = params.get('mode') && STAGES.find((s) => s.gameMode === params.get('mode'));
  const asked = byId || byMode;
  return asked && isPlayable(state, asked, DEV) ? asked : defaultStage(state);
}
let stage = initialStage();
// Stages on a chapter whose track is not built yet race their segment on Emerald Coast.
const trackFor = (s) => TRACKS.find((t) => t.id === TRACK_SEGMENTS[s.trackSegment].trackId) ?? EMERALD_COAST;
const showFps = (fps) => {
  if (!fpsEl.hidden) fpsEl.textContent = `${Math.round(fps)} FPS`;
};

const garage = new Garage(canvas, {
  car: carById(state.car),
  paintColor: currentPaint().color,
  finish: currentPaint().finish,
  look: carLook(state, state.car),
  quality: state.settings.quality,
  onFps: showFps,
});

// 'garage' | 'map' (world map, briefing on top) | 'busy' (transitioning) | 'race'
let mode = 'garage';
let race = null;
let raceStage = null; // the stage the current race was set up for
let raceOpts = {}; // { startNitro } for the current attempt
let lastWinnings = 0;
let lastResult = null; // the finished race whose coins the rewarded ad can double
let pendingScene = null; // a boss victory scene to play back on the map
let celebrate = null; // { stage, newStars, unlocked } to animate on the map

const store = createStore({ onPurchased: () => ads.refreshEntitlements() });
const hud = createHud(garage, { onRaceStart: () => openMap(), onOpenStore: (id) => store.open(id) });
if (DEBUG) window.__garage = garage;

$('#btn-stage').addEventListener('click', () => openMap({ brief: stage }));
function renderStageChip() {
  if (!isPlayable(state, stage, DEV)) stage = defaultStage(state);
  $('#stage-kicker').textContent = `${stageLabel(stage).replace('STAGE ', '')}${isPractice(state, stage) ? ' · PRACTICE' : ''}`;
  $('#stage-name').textContent = TRACK_SEGMENTS[stage.trackSegment].name;
  $('#stage-stars').innerHTML = starIcons(state.career.stageStars[stage.index]);
  $('#btn-stage').dataset.mode = stage.gameMode;
}
renderStageChip();

// ---- Campaign shell: world map, briefing, story ----
const map = new WorldMap(garage.renderer, { onFps: showFps });
const dialogue = createDialogue();
const chest = chestDialog();
const mapHud = createMapHud(map, {
  dev: DEV,
  onSelect: (s) => openBriefing(s),
  onBack: () => backToGarage(),
  onContinue: (s) => {
    map.focusStage(s);
    openBriefing(s);
  },
  onLocked: (s) => {
    const prev = STAGES[s.index - 1];
    if (prev && s.number > state.career.unlockedStage) return toast(`Earn star 1 on Stage ${stageTag(prev)} to unlock`);
    // Every chapter is built; a closed one is waiting on its star gate.
    const { stars } = chapterLock(state, s.chapterId);
    toast(`Collect ${stars} more ★ to open ${chapterById(s.chapterId).name}`);
  },
  onChest: (m, { ready, opened }) => {
    if (opened) return toast('Chest already opened');
    if (!ready) {
      const have = chapterStars(state, m.chapterId);
      return toast(`Earn ${m.stars - have} more ★ in ${chapterById(m.chapterId).name} to open`);
    }
    chest.open(m, () => {
      const got = claimMilestone(state, m.id);
      if (!got) return null;
      save();
      cloud.syncSoon();
      return got;
    });
  },
});
const briefing = createBriefing({
  dev: DEV,
  onStart: (s, opts) => startRace(s, opts),
  onClose: () => closeBriefing(),
  onStory: (s) => playScene(sceneForStage(s.stageId, 'before')),
  onNitroAd: async () => {
    const outcome = await ads.showRewarded();
    const note = rewardedFallback(outcome, 'Watch the whole ad to fill the tank.');
    if (note) toast(note);
    return outcome;
  },
});

// Plays a story scene (and remembers it on this device). The map banner hides meanwhile and
// comes back afterwards unless `thenBrief` (a briefing opens next).
async function playScene(scene, { thenBrief = false } = {}) {
  if (!scene) return;
  ads.setBanner(false);
  await dialogue.play(scene);
  markSeen(state, scene.id);
  save();
  if (mode === 'map' && !briefing.isOpen && !thenBrief) ads.setBanner(true);
}

async function openBriefing(s) {
  if (mode !== 'map' || briefing.isOpen || dialogue.isOpen) return;
  ads.setBanner(false);
  await playScene(dueBefore(state, s), { thenBrief: true });
  if (mode !== 'map') return ads.setBanner(false);
  briefing.open(s);
}

function closeBriefing() {
  briefing.close();
  if (mode === 'map') ads.setBanner(true);
}

// Garage -> world map. `brief`: open that stage's briefing once the map is up.
async function openMap({ brief = null } = {}) {
  if (mode !== 'garage') return;
  mode = 'busy';
  hud.revertPreview();
  await wipe.cover('WORLD MAP');
  hud.hide();
  garage.stop();
  map.start();
  map.focusStage(brief ?? defaultStage(state), true);
  mapHud.show();
  mode = 'map';
  await wipe.reveal();
  ads.setBanner(true);
  await playScene(duePrologue(state));
  if (brief) openBriefing(brief);
}

async function backToGarage() {
  if (mode !== 'map') return;
  mode = 'busy';
  ads.setBanner(false);
  await wipe.cover('GARAGE');
  briefing.close();
  mapHud.hide();
  map.stop();
  // The track stays loaded while the player is on the map (a retry or the next stage on it
  // starts at once); back in the garage its geometries, textures and targets are freed.
  race?.dispose();
  race = null;
  garage.resize();
  garage.start();
  hud.snapBody();
  hud.show();
  stage = defaultStage(state);
  renderStageChip();
  mode = 'garage';
  await wipe.reveal();
}

const settings = createSettings(garage, {
  onFpsToggle: (on) => (fpsEl.hidden = !on),
  onEntitlementsChanged: () => ads.refreshEntitlements(),
});
fpsEl.hidden = !state.settings.showFps;
createCloudBadge();

// Cloud save milestones (see core/cloud.js). Play purchases and restores that paid out
// upload shortly after; paint and upgrade purchases are wired in the garage HUD.
billing.subscribe((e) => {
  // A purchase that cleared later (pending payments), a restore or a refund changes No Ads.
  if (e.type === 'purchase' || e.type === 'sync') ads.refreshEntitlements();
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
  onQuit: () => exitToMap(),
  onGarage: () => exitToMap(),
  onRaceAgain: () => restartRace(),
  onNext: () => exitToMap({ next: true }),
  onDoubleCoins: () => doubleCoins(),
  onCameraView: () => cycleCameraView(),
});

// HUD camera toggle: chase -> close follow -> hood, remembered per device.
function applyCameraView(announce = false) {
  const view = state.settings.cameraView;
  race?.setCameraView(view);
  raceHud.setCameraView(view, CAMERA_LABELS[view], announce);
}
function cycleCameraView() {
  if (mode !== 'race' || !race) return;
  const i = CAMERA_VIEWS.indexOf(state.settings.cameraView);
  state.settings.cameraView = CAMERA_VIEWS[(i + 1) % CAMERA_VIEWS.length];
  save();
  applyCameraView(true);
}

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
const playerFx = () => ({ smoke: fxById(activeCar().smoke, DEFAULT_SMOKE), nitro: fxById(activeCar().nitroFx, DEFAULT_NITRO) });

function beginRace() {
  raceInput.setAutoAccelerate(state.settings.autoAccelerate);
  raceInput.setScheme(state.settings.controls);
  applyCameraView();
  race.begin({
    earnedStars: state.career.stageStars[raceStage.index],
    stats: playerStats(),
    paint: currentPaint(),
    fx: playerFx(),
    input: raceInput,
    hud: raceHud,
    autoQuality: state.settings.quality === 'auto',
    bloom: state.settings.bloom,
    onFinish: bankResult,
    startNitro: Boolean(raceOpts.startNitro),
  });
  raceHud.setNext(null);
}

// From the briefing (or, in debug, straight from the garage). `startNitro` is the rewarded
// Fill Nitrous Tank perk, spent on this attempt (a pause-menu restart keeps it).
async function startRace(s = stage, { startNitro = false } = {}) {
  if (mode !== 'garage' && mode !== 'map') return;
  const from = mode;
  mode = 'busy';
  stage = s;
  if (from === 'garage') await wait(600); // let the rev and the rear-camera swing play
  ads.setBanner(false);
  const track = trackFor(s);
  await wipe.cover(`LOADING ${TRACK_SEGMENTS[s.trackSegment].name.toUpperCase()}`);
  try {
    // Switching tracks builds a new Race and frees the old one's GPU resources.
    if (!race || race.def !== track) {
      race?.dispose();
      race = null;
      race = new Race(garage.renderer, track, { onFps: showFps });
      await race.prepare({ quality: garage.qualityLevel, paint: currentPaint(), car: carById(state.car), look: carLook(state, state.car), stage: s });
    } else {
      await race.setPlayerCar(carById(state.car), currentPaint(), carLook(state, state.car));
      if (race.stage !== s) await race.setStage(s);
    }
    raceStage = s;
  } catch (err) {
    console.error(err);
    race = null;
    await wipe.reveal();
    toast('Could not load the track on this device.');
    mode = from;
    if (from === 'map' && !briefing.isOpen) ads.setBanner(true);
    return;
  }
  raceOpts = { startNitro };
  briefing.consumePerk();
  hud.hide();
  briefing.close();
  mapHud.hide();
  map.stop();
  garage.stop();
  lastWinnings = 0;
  pendingScene = null;
  beginRace();
  mode = 'race';
  await wipe.reveal();
}

// Coins, stars and bests are saved the moment the run ends. A practice run (a locked stage
// opened from the dev picker) is judged on a throwaway copy of the save and pays nothing.
function bankResult(result) {
  const s = raceStage;
  const practice = isPractice(state, s);
  const target = practice ? structuredClone(state) : state;
  const settled = settleStage(target, s, result);
  result.coins = settled.coins;
  result.stars = settled.stars;
  result.newStars = settled.newStars;
  result.stageStars = settled.stageStars;
  result.starBonus = STAR_BONUS;
  result.objectives = s.objectives;
  result.best = settled.newBest;
  result.practice = practice;
  result.stageLabel = `${stageLabel(s)} · `;
  const next = nextStage(s);
  if (practice) {
    lastResult = null;
    result.wallet = state.coins;
    if (DEV && next) raceHud.setNext(`Next · ${stageTag(next)}`);
    return;
  }
  pendingScene = dueAfter(state, s, settled.newStars) ?? pendingScene;
  celebrate = { stage: s, newStars: settled.newStars, unlocked: settled.unlocked };
  lastWinnings += settled.coins.total;
  // The rewarded 2x pays the race coins again (finish + skill), not the one-time star bonus.
  lastResult = { coins: settled.coins.race, doubled: false };
  ads.noteRaceFinished();
  save();
  result.wallet = state.coins;
  if (settled.unlocked) toast(`Stage ${stageTag(settled.unlocked)} unlocked`);
  if (next && isPlayable(state, next, DEV)) raceHud.setNext(`Next · ${stageTag(next)}`);
}

// Results screen: a rewarded video pays the race's coins a second time.
async function doubleCoins() {
  if (!lastResult || lastResult.doubled || mode !== 'race') return;
  const res = lastResult;
  raceHud.setDoubleState('loading');
  const outcome = await ads.showRewarded();
  if (outcome !== 'rewarded') {
    raceHud.setDoubleState('ready');
    const note = rewardedFallback(outcome, 'Watch the whole ad to double your coins.');
    if (note) toast(note);
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
  // The nitro perk covers a restart from the pause menu, not another run after the finish.
  if (raceHud.resultsOpen || race.phase === 'finished') raceOpts = {};
  raceHud.closePause();
  await wipe.cover('RESTARTING');
  raceHud.hideResults();
  lastResult = null;
  beginRace();
  mode = 'race';
  await wipe.reveal();
}

// Race -> world map, with the stage's new stars (and any unlock) animated on its node.
// `next`: open the following stage's briefing straight away.
async function exitToMap({ next = false } = {}) {
  if (mode !== 'race') return;
  mode = 'busy';
  // Only a finished race (the results screen) leads to an interstitial; quitting from the
  // pause menu never does.
  const finished = raceHud.resultsOpen || race.phase === 'finished';
  raceHud.closePause();
  await wipe.cover('WORLD MAP');
  race.exit();
  raceHud.hide();
  raceHud.hideResults();
  lastResult = null;
  raceOpts = {};
  // After the first 3 races, every 2-3 finished races an interstitial plays here, behind the
  // wipe (never within 3 minutes of another full-screen ad).
  if (finished) await ads.maybeShowInterstitial();
  const played = raceStage;
  const following = next ? nextStage(played) : null;
  map.start();
  map.focusStage(following ?? played, true);
  mapHud.show();
  mode = 'map';
  await wipe.reveal();
  if (celebrate) {
    mapHud.celebrate(celebrate.stage, celebrate.newStars, celebrate.unlocked);
    celebrate = null;
  }
  if (lastWinnings > 0) {
    toast(`+${lastWinnings.toLocaleString('en-US')} coins banked`);
    lastWinnings = 0;
  }
  cloud.syncNow();
  if (pendingScene) {
    const scene = pendingScene;
    pendingScene = null;
    await playScene(scene);
  }
  if (following && isPlayable(state, following, DEV)) openBriefing(following);
  else ads.setBanner(true);
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
    if (mode !== 'race') resumeAudio();
  } else {
    garage.stop();
    suspendAudio();
  }
});

onBackButton(() => {
  if (dialogue.isOpen) {
    dialogue.skip();
    return true;
  }
  if (chest.isOpen) {
    chest.close();
    return true;
  }
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
    if (raceHud.resultsOpen || race.phase === 'finished') exitToMap();
    else if (race.isPaused) resumeRace();
    else pauseRace();
    return true;
  }
  if (mode === 'map') {
    if (briefing.isOpen) closeBriefing();
    else backToGarage();
    return true;
  }
  return false;
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && mode === 'map' && briefing.isOpen && !dialogue.isOpen) closeBriefing();
  if (e.code !== 'Escape' || mode !== 'race' || !race) return;
  if (race.isPaused) resumeRace();
  else pauseRace();
});

if (DEBUG) {
  window.__app = {
    get race() { return race; },
    get stage() { return stage; },
    get mode() { return mode; },
    pickStage(id) {
      stage = typeof id === 'string' ? stageById(id) : STAGES[id];
      renderStageChip();
      return stage;
    },
    startRace: (s, opts) => startRace(typeof s === 'string' ? stageById(s) : s ?? stage, opts),
    openMap, backToGarage, exitToMap,
    openBriefing: (id) => openBriefing(typeof id === 'string' ? stageById(id) : id),
    map, mapHud, briefing, dialogue, chest, state, ads, billing, store, cloud,
    // Audio meters, and a promise for the car mixer holding everything it plays.
    audio: audioStats,
    audioLoaded,
    stageIds: STAGES.map((s) => s.stageId),
    carIds: CARS.map((c) => c.id),
    // Puts a car on the turntable (QA only: the save is not touched).
    showCar: (id) => garage.setCar(carById(id), { color: currentPaint().color, finish: currentPaint().finish, rim: 'stock' }),
  };
}
