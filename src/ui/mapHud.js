import { CHAPTERS, STAGES, GAME_MODES, TRACK_SEGMENTS, milestonesOfChapter } from '../data/career.js';
import { PAINTS } from '../data/catalog.js';
import { rivalById } from '../data/rivals.js';
import { state, subscribe } from '../core/store.js';
import { isStageUnlocked, isChapterUnlocked, chapterStars, totalStars, starCount, chapterLock, claimableMilestones } from '../core/career.js';
import { sfx } from '../core/audio.js';
import { MODE_COLORS } from '../map/WorldMap.js';
import { modeIcon, starIcons, stageTag, trackBuilt, isPlayable, defaultStage, LOCK_ICON, STAR_ICON } from './stageInfo.js';

// The world map's HTML layer: chapter tabs, wallet and star totals, one button per stage
// pinned over its 3D pedestal, the chapter's milestone chest track and a Continue button.

const fmt = (n) => n.toLocaleString('en-US');
const CHEST = `<svg class="chest" viewBox="0 0 48 40" aria-hidden="true">
  <path class="chest-body" d="M5 18h38v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
  <path class="chest-band" d="M5 24h38M21 18v20h6V18" />
  <g class="chest-lid"><path d="M5 18c0-9 6-14 19-14s19 5 19 14z" /><path class="chest-band" d="M21 5v13h6V5" /></g>
  <rect class="chest-lock" x="21.5" y="20" width="5" height="6" rx="1" />
</svg>`;

export function createMapHud(map, { dev = false, onSelect, onBack, onContinue, onChest, onLocked }) {
  const root = document.getElementById('map-hud');
  const nodesEl = document.getElementById('map-nodes');
  const tabs = document.getElementById('map-chapters');
  const lockEl = document.getElementById('map-lock');
  const pos = {};
  let chapter = null;

  // ---- Chapter tabs ----
  tabs.innerHTML = CHAPTERS.map((c) => `<button role="tab" data-chapter="${c.id}"><b>${c.number}</b><span>${c.name}</span></button>`).join('');
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-chapter]');
    if (!b) return;
    sfx.tab();
    map.focusChapter(b.dataset.chapter);
  });

  // ---- Stage nodes ----
  nodesEl.innerHTML = STAGES.map((s) => {
    const boss = s.gameMode === 'BossDuel';
    const bossName = boss ? rivalById(CHAPTERS.find((c) => c.id === s.chapterId).boss).name : '';
    return `<button class="map-node m-${s.gameMode}${boss ? ' boss' : ''}" data-stage="${s.index}" style="--mode:${MODE_COLORS[s.gameMode]}">
      <span class="mn-disc"></span><b class="mn-num">${String(s.chapterStage).padStart(2, '0')}</b>
      <span class="mn-stars"></span>${boss ? `<em class="mn-boss">${bossName}</em>` : ''}</button>`;
  }).join('');
  const nodeEls = [...nodesEl.children];

  nodesEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-stage]');
    if (!b) return;
    const stage = STAGES[Number(b.dataset.stage)];
    if (!isPlayable(state, stage, dev)) {
      sfx.deny();
      onLocked?.(stage);
      return;
    }
    sfx.tap();
    map.focusStage(stage);
    onSelect(stage);
  });

  function view(s) {
    const unlocked = isStageUnlocked(state, s);
    return { locked: !unlocked || !trackBuilt(s), stars: starCount(state.career.stageStars[s.index]), current: s === defaultStage(state) };
  }

  function renderNodes() {
    const cur = defaultStage(state);
    STAGES.forEach((s, i) => {
      const el = nodeEls[i];
      const v = view(s);
      el.classList.toggle('locked', v.locked);
      el.classList.toggle('current', s === cur);
      el.classList.toggle('perfect', v.stars === 3);
      el.querySelector('.mn-disc').innerHTML = v.locked && !isStageUnlocked(state, s) ? LOCK_ICON : modeIcon(s.gameMode);
      el.querySelector('.mn-stars').innerHTML = starIcons(state.career.stageStars[s.index]);
      const seg = TRACK_SEGMENTS[s.trackSegment].name;
      el.setAttribute('aria-label', `Stage ${stageTag(s)}, ${GAME_MODES[s.gameMode].name}, ${seg}, ${v.stars} stars${v.locked ? ', locked' : ''}`);
    });
    map.refresh(view);
  }

  // Pin each button over its pedestal (called every map frame).
  function place() {
    for (let i = 0; i < nodeEls.length; i++) {
      const p = map.project(map.nodePosition(STAGES[i]), (pos[i] ??= {}));
      const el = nodeEls[i];
      if (!p.visible) {
        if (!el.hidden) el.hidden = true;
        continue;
      }
      if (el.hidden) el.hidden = false;
      el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
      el.style.zIndex = String(Math.round(p.y));
    }
    const c = map.chapterInView;
    if (c !== chapter) {
      chapter = c;
      renderChapter();
    }
  }
  map.onMove(place);

  // ---- Chapter: title, tabs, lock card, chest track ----
  function renderChapter() {
    const c = chapter ?? CHAPTERS[0];
    root.dataset.chapter = c.id;
    document.getElementById('map-chapter-name').textContent = `${c.number} · ${c.name}`;
    document.getElementById('map-chapter-sub').textContent = c.subtitle;
    for (const b of tabs.children) {
      const open = isChapterUnlocked(state, b.dataset.chapter);
      b.setAttribute('aria-selected', String(b.dataset.chapter === c.id));
      b.classList.toggle('locked', !open);
    }
    renderLock(c);
    renderChests(c);
  }

  function renderLock(c) {
    const open = isChapterUnlocked(state, c.id);
    const built = STAGES.some((s) => s.chapterId === c.id && trackBuilt(s));
    if (open && built) {
      lockEl.hidden = true;
      return;
    }
    const lock = chapterLock(state, c.id);
    const needs = [];
    if (lock.stage) needs.push(`Earn star 1 on Stage ${stageTag(lock.stage)}`);
    if (lock.stars) needs.push(`Collect ${lock.stars} more ★ (${totalStars(state)} / ${c.starGate})`);
    const body = !open ? needs.join(' and ') : 'This region\'s track is still being built. Its stages open in a coming update.';
    lockEl.innerHTML = `${LOCK_ICON}<div><small>CHAPTER ${c.number} · ${open ? 'COMING SOON' : 'LOCKED'}</small><b>${c.name}</b><span>${body}${dev ? '<br><em>Dev build: stages run as practice and save nothing.</em>' : ''}</span></div>`;
    lockEl.hidden = false;
  }

  function renderChests(c) {
    const stars = chapterStars(state, c.id);
    const max = STAGES.filter((s) => s.chapterId === c.id).length * 3;
    document.getElementById('chest-count').innerHTML = `${STAR_ICON}${stars} <small>/ ${max}</small>`;
    document.getElementById('chest-fill').style.width = `${(stars / max) * 100}%`;
    const ready = new Set(claimableMilestones(state).map((m) => m.id));
    document.getElementById('chest-marks').innerHTML = milestonesOfChapter(c.id)
      .map((m) => {
        const opened = state.career.milestones.includes(m.id);
        const cls = opened ? 'opened' : ready.has(m.id) ? 'ready' : '';
        const paint = m.paint ? PAINTS.find((p) => p.id === m.paint) : null;
        const label = `${m.stars} star chest: ${fmt(m.coins)} coins${paint ? ` and ${paint.name} paint` : ''}${opened ? ', opened' : ready.has(m.id) ? ', ready to open' : ''}`;
        return `<button class="chest-mark ${cls}" data-chest="${m.id}" style="--at:${(m.stars / max) * 100}%" aria-label="${label}">${CHEST}<small>${m.stars}★</small></button>`;
      })
      .join('');
  }

  document.getElementById('chest-marks').addEventListener('click', (e) => {
    const b = e.target.closest('[data-chest]');
    if (!b) return;
    if (!b.classList.contains('ready')) {
      sfx.deny();
      const m = milestonesOfChapter(chapter.id).find((x) => x.id === b.dataset.chest);
      onChest(m, { ready: false, opened: b.classList.contains('opened') });
      return;
    }
    sfx.tap();
    onChest(milestonesOfChapter(chapter.id).find((x) => x.id === b.dataset.chest), { ready: true });
  });

  // ---- Wallet, totals, continue ----
  function renderTotals() {
    document.getElementById('map-coins').textContent = fmt(state.coins);
    document.getElementById('map-stars').textContent = `${totalStars(state)} / ${STAGES.length * 3}`;
    const cur = defaultStage(state);
    document.getElementById('map-continue-label').textContent = `STAGE ${stageTag(cur)}`;
    const ready = claimableMilestones(state).length;
    root.classList.toggle('chests-ready', ready > 0);
  }

  document.getElementById('map-back').addEventListener('click', () => {
    sfx.tap();
    onBack();
  });
  document.getElementById('map-continue').addEventListener('click', () => {
    sfx.tap();
    onContinue(defaultStage(state));
  });

  function renderAll() {
    if (root.hidden) return;
    renderNodes();
    renderTotals();
    renderChapter();
  }
  subscribe(renderAll);

  return {
    show() {
      root.hidden = false;
      renderAll();
    },
    hide() {
      root.hidden = true;
    },
    get visible() {
      return !root.hidden;
    },
    render: renderAll,
    // A run just earned new stars on `stage` (and maybe opened the next one): pop them.
    celebrate(stage, newStars, unlocked) {
      const el = nodeEls[stage.index];
      if (newStars) {
        el.classList.remove('celebrate');
        void el.offsetWidth;
        el.classList.add('celebrate');
      }
      if (unlocked) {
        const next = nodeEls[unlocked.index];
        next.classList.remove('unlocking');
        void next.offsetWidth;
        next.classList.add('unlocking');
      }
    },
  };
}
