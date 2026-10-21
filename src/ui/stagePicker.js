import { STAGES, CHAPTERS, GAME_MODES, TRACK_SEGMENTS } from '../data/career.js';
import { TRACKS } from '../data/tracks.js';
import { state } from '../core/store.js';
import { isStageUnlocked, starCount } from '../core/career.js';
import { sfx } from '../core/audio.js';

// Stage picker: a stand-in for the Phase 10 world map. Lists the career stages by chapter with
// their game mode and stars, filterable by mode. Players see the stages they have unlocked on
// tracks that are built; dev builds (pre-release or ?debug) can open any stage, and run locked
// ones as practice that saves nothing. Stages whose chapter track is not built yet race their
// segment on Emerald Coast.

export const MODE_TAGS = { Classic: 'RACE', TimeTrial: 'TIME', DriftTouge: 'DRIFT', Elimination: 'K.O.', BossDuel: 'BOSS' };

export const trackBuilt = (stage) => TRACKS.some((t) => t.id === TRACK_SEGMENTS[stage.trackSegment].trackId);

// What a player can race from the picker.
export const isPlayable = (save, stage, dev = false) => dev || (trackBuilt(stage) && isStageUnlocked(save, stage));

// The stage the garage offers by default: the furthest unlocked one on a built track.
export function defaultStage(save) {
  let pick = STAGES[0];
  for (const s of STAGES) if (trackBuilt(s) && isStageUnlocked(save, s)) pick = s;
  return pick;
}

const stageTag = (s) => `${s.stageId.slice(0, 2).toUpperCase()}-${String(s.chapterStage).padStart(2, '0')}`;
export const stageLabel = (s) => `STAGE ${stageTag(s)} · ${GAME_MODES[s.gameMode].name.toUpperCase()}`;

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5-4.9-4.5 6.6-.8z" /></svg>';
export const starIcons = (mask) => [0, 1, 2].map((i) => `<i class="${(mask >> i) & 1 ? 'on' : ''}">${STAR}</i>`).join('');

export function createStagePicker({ dev = false, onPick }) {
  const dialog = document.getElementById('stage-picker');
  const list = dialog.querySelector('#stage-list');
  const modes = dialog.querySelector('#stage-modes');
  const note = dialog.querySelector('#stage-detail');
  dialog.querySelector('#stage-dev').hidden = !dev;
  let filter = 'all';
  let current = null;

  modes.innerHTML = [['all', 'All'], ...Object.values(GAME_MODES).map((m) => [m.id, MODE_TAGS[m.id]])]
    .map(([id, label]) => `<button data-mode="${id}" role="radio">${label}</button>`)
    .join('');
  modes.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    sfx.tap();
    filter = b.dataset.mode;
    render();
  });

  list.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-stage]');
    if (!b || b.disabled) return;
    sfx.tap();
    const stage = STAGES[Number(b.dataset.stage)];
    dialog.close();
    onPick(stage);
  });
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());

  function render() {
    for (const b of modes.children) b.setAttribute('aria-checked', String(b.dataset.mode === filter));
    const blurb = filter === 'all' ? '' : GAME_MODES[filter].blurb;
    list.innerHTML = CHAPTERS.map((c) => {
      const stages = STAGES.filter((s) => s.chapterId === c.id && (filter === 'all' || s.gameMode === filter));
      const built = stages.some(trackBuilt);
      if (!stages.length || (!dev && !built)) return '';
      const tiles = stages
        .map((s) => {
          const mask = state.career.stageStars[s.index];
          const open = isPlayable(state, s, dev);
          const locked = !isStageUnlocked(state, s) || !trackBuilt(s);
          const cls = ['stage-tile', `m-${s.gameMode}`, s === current ? 'is-current' : '', locked ? 'locked' : ''].join(' ');
          const name = TRACK_SEGMENTS[s.trackSegment].name;
          return `<button class="${cls}" data-stage="${s.index}" ${open ? '' : 'disabled'} aria-label="Stage ${s.chapterStage}, ${GAME_MODES[s.gameMode].name}, ${name}, ${starCount(mask)} stars${locked ? ', locked' : ''}">
            <b>${String(s.chapterStage).padStart(2, '0')}</b><small>${MODE_TAGS[s.gameMode]}</small><span class="stars">${starIcons(mask)}</span></button>`;
        })
        .join('');
      return `<section><h3>${c.number} · ${c.name}${built ? '' : ' <em>track planned · races on Emerald Coast</em>'}</h3><div class="stage-grid">${tiles}</div></section>`;
    }).join('');
    note.textContent = [blurb && `${blurb}.`, dev ? 'Dev: locked stages run as practice and save nothing.' : ''].filter(Boolean).join(' ');
  }

  return {
    open(stage) {
      current = stage;
      render();
      sfx.tap();
      dialog.showModal();
      list.querySelector('.is-current')?.scrollIntoView({ block: 'nearest' });
    },
    close() {
      if (dialog.open) dialog.close();
    },
    get isOpen() {
      return dialog.open;
    },
  };
}
