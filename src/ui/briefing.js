import { CHAPTERS, GAME_MODES, TRACK_SEGMENTS, describeObjective } from '../data/career.js';
import { RELEASED_CARS } from '../data/cars.js';
import { RIVAL_SETS, rivalById } from '../data/rivals.js';
import { BOSS_CAST, sceneForStage } from '../data/story.js';
import { state, save } from '../core/store.js';
import { carStats } from '../core/inventory.js';
import { sfx } from '../core/audio.js';
import { portrait } from './portraits.js';
import { modeIcon, stageLabel, layoutLabel, weatherName, routeName, isPractice, escapeHtml, STAR_ICON } from './stageInfo.js';

// Pre-race stage briefing, opened from a world-map node: track variant, weather, the three
// star objectives, who is on the grid (with the boss card on duels), a quick switch between
// owned cars, and the opt-in rewarded "Fill Nitrous Tank" perk (start at 100% nitro).

// What each mode asks of the car, for the selector's "track demands" hint.
const DEMANDS = {
  Classic: { stat: 'speed', text: 'Long straights: favour Top Speed' },
  TimeTrial: { stat: 'speed', text: 'Beat the clock: favour Top Speed' },
  DriftTouge: { stat: 'handling', text: 'Chain drifts: favour Handling' },
  Elimination: { stat: 'accel', text: 'Recover fast after contact: favour Acceleration' },
  BossDuel: { stat: 'nitro', text: 'Duel for the lead: favour Nitro' },
};
const STATS = [
  ['speed', 'SPD'],
  ['accel', 'ACC'],
  ['handling', 'HND'],
  ['nitro', 'NIT'],
];
const WEATHER_ICONS = {
  GoldenHour: '<circle cx="12" cy="15" r="4.5" /><path d="M3 19.5h18M12 6v2.5M5.6 9.6l1.7 1.7M18.4 9.6l-1.7 1.7" />',
  Fog: '<path d="M4 9h16M2.5 13h15M6 17h15M4 21h11" />',
  Rain: '<path d="M7 14.5a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.6 1.2A3.4 3.4 0 0 1 17 14.5z" /><path d="m8 18-1 3M12 18l-1 3M16 18l-1 3" />',
  Midday: '<circle cx="12" cy="12" r="4.5" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />',
  Dusk: '<path d="M6 17a4 4 0 0 1-.3-8A5.5 5.5 0 0 1 16 9.8 3.6 3.6 0 0 1 16.4 17z" /><path d="M3 21h18" />',
  Storm: '<path d="M7 13.5a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.6 1.2A3.4 3.4 0 0 1 17 13.5z" /><path d="m12.5 13.5-2.5 4h3l-2 4.5" />',
  // Neon City nights: a moon over wet streets, in rain, in smog and in the finale storm.
  NeonNight: '<path d="M15.5 3.5a7 7 0 1 0 5 11.5 6 6 0 0 1-5-11.5z" /><path d="M3 21h7M13 21h8" />',
  NeonRain: '<path d="M14 3a5.5 5.5 0 1 0 5.5 8.5A4.6 4.6 0 0 1 14 3z" /><path d="m7 15-1.2 3M11 15l-1.2 3M15 15l-1.2 3M9 19l-1 2.5M13 19l-1 2.5" />',
  NeonHaze: '<path d="M15 3a5 5 0 1 0 5 7.5A4.2 4.2 0 0 1 15 3z" /><path d="M3 15h14M5 18.5h16M3 22h12" />',
  NeonStorm: '<path d="M7 13.5a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.6 1.2A3.4 3.4 0 0 1 17 13.5z" /><path d="m12.5 13.5-2.5 4h3l-2 4.5" /><path d="M19.5 2.5a2.5 2.5 0 1 0 2 3.8" />',
};
const icon = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const TRACK_ICON = '<path d="M4 20c0-6 4-7 8-7s8-1 8-7" /><path d="M4 20h3M17 6h3" />';
const ROUTE_ICON = '<circle cx="6" cy="6" r="2.2" /><circle cx="18" cy="18" r="2.2" /><path d="M8 6h6a3.5 3.5 0 0 1 0 7h-4a3.5 3.5 0 0 0 0 7h6" />';
const COIN_ICON = '<circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v9M9.8 9.6h3.4a1.4 1.4 0 0 1 0 2.8h-2.4a1.4 1.4 0 0 0 0 2.8h3.4" />';
const DIFFICULTY = (d) => (d >= 0.75 ? 'Elite' : d >= 0.5 ? 'Pro' : 'Rookie');

export function createBriefing({ dev = false, onStart, onClose, onNitroAd, onStory }) {
  const root = document.getElementById('briefing');
  const $ = (id) => document.getElementById(id);
  const nitroBtn = $('brief-nitro');
  let stage = null;
  let perk = 'idle'; // 'idle' | 'loading' | 'armed'

  function renderHead() {
    const c = CHAPTERS.find((x) => x.id === stage.chapterId);
    const seg = TRACK_SEGMENTS[stage.trackSegment];
    root.dataset.mode = stage.gameMode;
    root.dataset.chapter = stage.chapterId;
    $('brief-kicker').innerHTML = `${modeIcon(stage.gameMode)}${stageLabel(stage)}`;
    $('brief-title').textContent = seg.name;
    $('brief-chapter').textContent = `Chapter ${c.number} · ${c.name} · ${GAME_MODES[stage.gameMode].blurb}`;
    $('brief-story').hidden = !sceneForStage(stage.stageId, 'before');
    $('brief-facts').innerHTML = [
      [TRACK_ICON, 'Track', `${seg.name} · ${layoutLabel(stage)}`],
      [ROUTE_ICON, 'Route', routeName(stage)],
      [WEATHER_ICONS[stage.weatherPreset], 'Weather', weatherName(stage)],
      [COIN_ICON, 'Reward', `${stage.coinReward.toLocaleString('en-US')} coins + 250 per new star`],
    ]
      .map(([ic, k, v]) => `<li>${icon(ic)}<small>${k}</small><b>${escapeHtml(v)}</b></li>`)
      .join('');
    const mask = state.career.stageStars[stage.index];
    $('brief-objectives').innerHTML = stage.objectives
      .map((o, i) => `<li class="${(mask >> i) & 1 ? 'met' : ''}">${STAR_ICON}<span>${escapeHtml(describeObjective(o))}</span><small>${['FINISH', 'SKILL', 'MASTERY'][i]}</small></li>`)
      .join('');
  }

  function renderRival() {
    const set = RIVAL_SETS[stage.rivalSet];
    const el = $('brief-rival');
    if (stage.gameMode === 'BossDuel') {
      const boss = rivalById(set.rivals[0]);
      el.className = 'brief-rival boss';
      el.innerHTML = `<div class="br-portrait">${portrait(BOSS_CAST[boss.id], 'shout')}</div>
        <div class="br-text"><small>BOSS DUEL · 1 v 1</small><b>${escapeHtml(boss.name)}</b><span class="br-title">${escapeHtml(boss.title)}</span>
        <q>${escapeHtml(boss.quote ?? '')}</q></div>`;
      return;
    }
    if (!set.rivals.length) {
      el.className = 'brief-rival solo';
      el.innerHTML = `<div class="br-text"><small>SOLO RUN</small><b>${GAME_MODES[stage.gameMode].name}</b><span>${escapeHtml(GAME_MODES[stage.gameMode].blurb)}. No rivals on the road.</span></div>`;
      return;
    }
    el.className = 'brief-rival crew';
    el.innerHTML = `<div class="br-text"><small>RIVAL CREW · ${DIFFICULTY(set.difficulty).toUpperCase()}</small>
      <ul>${set.rivals
        .map((id) => rivalById(id))
        .map((r) => `<li style="--c:${r.color}"><i></i>${escapeHtml(r.name)}</li>`)
        .join('')}</ul></div>`;
  }

  function renderCars() {
    const demand = DEMANDS[stage.gameMode];
    $('brief-demand').textContent = demand.text;
    const owned = RELEASED_CARS.filter((c) => state.ownedCars.includes(c.id));
    $('brief-cars').innerHTML = owned
      .map((c) => {
        const s = carStats(state, c.id);
        const best = owned.length > 1 && owned.every((o) => carStats(state, o.id)[demand.stat] <= s[demand.stat]);
        return `<button class="brief-car${state.car === c.id ? ' is-selected' : ''}" data-car="${c.id}" aria-pressed="${state.car === c.id}">
          <span class="tier tier-${c.tier.toLowerCase()}">${c.tier}</span><strong>${escapeHtml(c.name)}</strong>${best ? '<em>BEST FIT</em>' : ''}
          <ul>${STATS.map(([k, label]) => `<li class="${k === demand.stat ? 'hot' : ''}"><small>${label}</small><i style="--v:${Math.min(100, s[k])}%"></i></li>`).join('')}</ul>
        </button>`;
      })
      .join('');
  }

  function renderPerk() {
    nitroBtn.dataset.state = perk;
    nitroBtn.disabled = perk !== 'idle';
    nitroBtn.querySelector('b').textContent = perk === 'armed' ? 'Nitrous tank full' : perk === 'loading' ? 'Loading ad…' : 'Fill Nitrous Tank';
    nitroBtn.querySelector('small').textContent = perk === 'armed' ? 'You start this race at 100% nitro' : 'Watch an ad · start at 100% nitro';
  }

  function render() {
    renderHead();
    renderRival();
    renderCars();
    renderPerk();
    const practice = isPractice(state, stage);
    $('brief-note').textContent = practice ? (dev ? 'Practice run: this stage is locked, so nothing is saved.' : '') : '';
    $('brief-start').querySelector('span').textContent = practice ? 'PRACTICE' : 'START RACE';
  }

  $('brief-cars').addEventListener('click', (e) => {
    const b = e.target.closest('[data-car]');
    if (!b || state.car === b.dataset.car) return;
    sfx.buy();
    state.car = b.dataset.car;
    save();
    renderCars();
  });
  nitroBtn.addEventListener('click', async () => {
    if (perk !== 'idle') return;
    perk = 'loading';
    renderPerk();
    const outcome = await onNitroAd();
    perk = outcome === 'rewarded' ? 'armed' : 'idle';
    if (perk === 'armed') sfx.buy();
    renderPerk();
  });
  $('brief-start').addEventListener('click', () => {
    if (!stage || perk === 'loading') return;
    sfx.rev();
    onStart(stage, { startNitro: perk === 'armed' });
  });
  $('brief-back').addEventListener('click', () => {
    sfx.tap();
    onClose();
  });
  $('brief-story').addEventListener('click', () => {
    sfx.tap();
    onStory(stage);
  });

  return {
    open(s) {
      // The perk stays armed if the player reopens the same stage before racing it.
      if (s !== stage) perk = 'idle';
      stage = s;
      render();
      root.hidden = false;
      root.classList.remove('is-open');
      void root.offsetWidth;
      root.classList.add('is-open');
      setTimeout(() => $('brief-start').focus({ preventScroll: true }), 50);
    },
    close() {
      root.hidden = true;
    },
    // The armed perk is spent once the race begins.
    consumePerk() {
      const had = perk === 'armed';
      perk = 'idle';
      return had;
    },
    get stage() {
      return stage;
    },
    get isOpen() {
      return !root.hidden;
    },
  };
}
