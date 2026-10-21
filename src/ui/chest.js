import { PAINTS, FINISHES } from '../data/catalog.js';
import { chapterById } from '../data/career.js';
import { sfx } from '../core/audio.js';
import { escapeHtml } from './stageInfo.js';

// Milestone chest opening: the chest shakes, the lid pops, and its coins and paint count in.
// `claim()` banks the chest and returns the milestone (or null if it could not be opened).

const COIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#ffd34d" stroke="#b07a00" stroke-width="1.5" /><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" fill="none" stroke="#7a5200" stroke-width="1.6" /></svg>';
const CHEST = `<svg class="chest" viewBox="0 0 48 40" aria-hidden="true">
  <path class="chest-body" d="M5 18h38v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
  <path class="chest-band" d="M5 24h38M21 18v20h6V18" />
  <g class="chest-lid"><path d="M5 18c0-9 6-14 19-14s19 5 19 14z" /><path class="chest-band" d="M21 5v13h6V5" /></g>
  <rect class="chest-lock" x="21.5" y="20" width="5" height="6" rx="1" />
</svg>`;

export function chestDialog() {
  const dialog = document.getElementById('chest-dialog');
  const hero = document.getElementById('chest-hero');
  const rewards = document.getElementById('chest-rewards');
  const note = document.getElementById('chest-note');
  const collect = document.getElementById('chest-collect');
  let claim = null;
  let opened = false;

  hero.innerHTML = CHEST;
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());

  collect.addEventListener('click', () => {
    if (opened) {
      dialog.close();
      return;
    }
    const m = claim?.();
    if (!m) {
      dialog.close();
      return;
    }
    opened = true;
    collect.disabled = true;
    hero.classList.add('shake');
    sfx.tap();
    setTimeout(() => {
      hero.classList.remove('shake');
      hero.classList.add('open');
      rewards.classList.add('show');
      sfx.buy();
      note.textContent = m.paint ? 'Equip the new paint from the garage Paint tab.' : '';
      collect.textContent = 'Done';
      collect.disabled = false;
    }, 1400);
  });

  return {
    open(m, claimFn) {
      claim = claimFn;
      opened = false;
      const paint = m.paint ? PAINTS.find((p) => p.id === m.paint) : null;
      document.getElementById('chest-title').textContent = `${chapterById(m.chapterId).name} · ${m.stars}★ chest`;
      rewards.classList.remove('show');
      rewards.innerHTML = [
        `<li>${COIN}+${m.coins.toLocaleString('en-US')} coins</li>`,
        paint ? `<li><i class="swatch-dot" style="--swatch:${paint.color}"></i>${escapeHtml(paint.name)} <small>${FINISHES[paint.finish].label} paint</small></li>` : '',
        m.title ? `<li>Title: ${escapeHtml(m.title)}</li>` : '',
      ].join('');
      hero.classList.remove('open', 'shake');
      note.textContent = '';
      collect.textContent = 'Open chest';
      collect.disabled = false;
      dialog.showModal();
    },
    close() {
      if (dialog.open) dialog.close();
    },
    get isOpen() {
      return dialog.open;
    },
  };
}
