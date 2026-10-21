import { CAST, CHAPTER_INKS } from '../data/story.js';
import { chapterById } from '../data/career.js';
import { portrait } from './portraits.js';
import { escapeHtml } from './stageInfo.js';
import { sfx } from '../core/audio.js';

// Comic-book story scenes (data/story.js): two portrait slots facing each other, a speech
// balloon that types out, and yellow narration captions. Tap or press a key to finish the
// line, again for the next one; SKIP ends the scene. play() resolves when the scene closes.

const TYPE_CPS = 55;

// Crew on the left; bosses on the right; the rookie answers from the right unless a boss is
// in the scene.
function sidesFor(scene) {
  const who = new Set(scene.lines.map((l) => l.who).filter(Boolean));
  const boss = [...who].some((id) => CAST[id].side === 'right');
  return (id) => (id === 'rookie' ? (boss ? 'left' : 'right') : CAST[id].side);
}

export function createDialogue() {
  const root = document.getElementById('dialogue');
  const slots = { left: root.querySelector('[data-slot="left"]'), right: root.querySelector('[data-slot="right"]') };
  const box = root.querySelector('.dlg-box');
  const nameEl = root.querySelector('#dlg-name');
  const roleEl = root.querySelector('#dlg-role');
  const textEl = root.querySelector('#dlg-text');
  const captionEl = root.querySelector('#dlg-caption');
  const titleEl = root.querySelector('#dlg-title');
  const dots = root.querySelector('#dlg-dots');
  let scene = null;
  let index = 0;
  let typing = 0;
  let typed = 0;
  let full = '';
  let resolve = null;
  let sideOf = null;
  const shown = { left: null, right: null };

  function finish() {
    if (!scene) return;
    cancelAnimationFrame(typing);
    root.classList.remove('is-open');
    root.hidden = true;
    const done = resolve;
    scene = resolve = null;
    done?.();
  }

  function type(target, text) {
    cancelAnimationFrame(typing);
    full = text;
    typed = 0;
    const start = performance.now();
    const step = (now) => {
      typed = Math.min(full.length, Math.floor(((now - start) / 1000) * TYPE_CPS));
      target.textContent = full.slice(0, typed);
      if (typed < full.length) typing = requestAnimationFrame(step);
      else typing = 0;
    };
    typing = requestAnimationFrame(step);
  }

  function show() {
    const line = scene.lines[index];
    dots.innerHTML = scene.lines.map((_, i) => `<i class="${i === index ? 'on' : i < index ? 'past' : ''}"></i>`).join('');
    if (!line.who) {
      root.dataset.mode = 'caption';
      captionEl.hidden = false;
      box.hidden = true;
      for (const side of ['left', 'right']) slots[side].classList.remove('is-active');
      type(captionEl.querySelector('span'), line.text);
      return;
    }
    root.dataset.mode = 'speech';
    captionEl.hidden = true;
    box.hidden = false;
    const c = CAST[line.who];
    const side = sideOf(line.who);
    const key = `${line.who}:${line.mood ?? ''}`;
    if (shown[side] !== key) {
      slots[side].innerHTML = portrait(line.who, line.mood);
      slots[side].classList.remove('pop');
      void slots[side].offsetWidth;
      slots[side].classList.add('pop');
      shown[side] = key;
    }
    slots[side].hidden = false;
    for (const s of ['left', 'right']) slots[s].classList.toggle('is-active', s === side);
    box.dataset.side = side;
    box.dataset.mood = line.mood ?? '';
    box.style.setProperty('--speaker', c.palette.accent);
    nameEl.textContent = c.name;
    roleEl.textContent = c.role;
    type(textEl, line.text);
  }

  function advance() {
    if (!scene) return;
    if (typing) {
      // First tap completes the line.
      cancelAnimationFrame(typing);
      typing = 0;
      (root.dataset.mode === 'caption' ? captionEl.querySelector('span') : textEl).textContent = full;
      return;
    }
    sfx.tap();
    index += 1;
    if (index >= scene.lines.length) finish();
    else show();
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('#dlg-skip')) {
      sfx.tap();
      finish();
      return;
    }
    advance();
  });
  window.addEventListener('keydown', (e) => {
    if (!scene) return;
    if (e.code === 'Escape') finish();
    else if (['Space', 'Enter', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
      advance();
    }
  });

  return {
    play(s) {
      if (scene) finish();
      return new Promise((res) => {
        scene = s;
        resolve = res;
        index = 0;
        sideOf = sidesFor(s);
        shown.left = shown.right = null;
        for (const side of ['left', 'right']) {
          slots[side].innerHTML = '';
          slots[side].hidden = true;
        }
        root.dataset.chapter = s.chapterId;
        root.style.setProperty('--ink', CHAPTER_INKS[s.chapterId] ?? '#ff2a3a');
        const c = chapterById(s.chapterId);
        titleEl.innerHTML = `<small>${s.boss ? 'BOSS ENCOUNTER' : `CHAPTER ${c.number} · ${c.name.toUpperCase()}`}</small>${escapeHtml(s.title)}`;
        root.hidden = false;
        void root.offsetWidth;
        root.classList.add('is-open');
        show();
      });
    },
    skip: finish,
    get isOpen() {
      return Boolean(scene);
    },
  };
}
