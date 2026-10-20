import { PAINTS, FINISHES, UPGRADES, upgradeCost, BASE_STATS, STAT_PER_LEVEL } from '../data/catalog.js';
import { state, save, subscribe, spendCoins } from '../core/store.js';
import { sfx } from '../core/audio.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmt = (n) => n.toLocaleString('en-US');

const LOCK_ICON = '<svg viewBox="0 0 24 24"><path d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1Zm2 0h6V8a3 3 0 0 0-6 0v2Z"/></svg>';

let toastTimer = 0;
export function toast(message, ms = 2400) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth; // restart the entrance animation
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function createHud(garage) {
  const hud = $('#hud');
  let previewPaint = state.paint;

  // ---- Coins ----
  const coinEl = $('#coin-count');
  let shownCoins = state.coins;
  coinEl.textContent = fmt(shownCoins);
  function renderCoins() {
    if (shownCoins === state.coins) return;
    const from = shownCoins;
    const to = state.coins;
    const start = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - start) / 450);
      shownCoins = Math.round(from + (to - from) * k);
      coinEl.textContent = fmt(shownCoins);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const pill = coinEl.parentElement;
    pill.classList.remove('bump');
    void pill.offsetWidth;
    pill.classList.add('bump');
  }

  // ---- Tabs ----
  $$('.tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      sfx.tab();
      $$('.tab').forEach((t) => {
        const active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      });
      $$('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
      if (tab.dataset.tab !== 'paint') revertPreview();
    })
  );

  // ---- Paint ----
  const grid = $('#paint-grid');
  grid.innerHTML = PAINTS.map(
    (p) => `<button class="swatch" data-paint="${p.id}" style="--swatch:${p.color}" aria-label="${p.name}">
      ${state.ownedPaints.includes(p.id) ? '' : `<span class="lock">${LOCK_ICON}</span>`}</button>`
  ).join('');
  const paintById = (id) => PAINTS.find((p) => p.id === id) ?? PAINTS[0];

  function renderPaint() {
    $$('.swatch', grid).forEach((el) => {
      const id = el.dataset.paint;
      el.classList.toggle('is-selected', id === previewPaint);
      el.classList.toggle('is-equipped', id === state.paint);
      if (state.ownedPaints.includes(id)) el.querySelector('.lock')?.remove();
    });
    const p = paintById(previewPaint);
    $('#paint-name').textContent = p.name;
    $('#paint-finish').textContent = FINISHES[p.finish].label;
    const action = $('#paint-action');
    if (state.paint === p.id) {
      action.textContent = 'Equipped';
      action.disabled = true;
    } else if (state.ownedPaints.includes(p.id)) {
      action.textContent = 'Equip';
      action.disabled = false;
    } else {
      action.textContent = `Buy · ${fmt(p.price)}`;
      action.disabled = false;
    }
  }

  function revertPreview() {
    if (previewPaint === state.paint) return;
    previewPaint = state.paint;
    const p = paintById(previewPaint);
    garage.setPaint(p.color, p.finish);
    renderPaint();
  }

  grid.addEventListener('click', (e) => {
    const el = e.target.closest('.swatch');
    if (!el) return;
    sfx.tap();
    previewPaint = el.dataset.paint;
    const p = paintById(previewPaint);
    garage.setPaint(p.color, p.finish);
    renderPaint();
  });

  $('#paint-action').addEventListener('click', () => {
    const p = paintById(previewPaint);
    if (!state.ownedPaints.includes(p.id)) {
      if (!spendCoins(p.price)) {
        sfx.deny();
        toast(`You need ${fmt(p.price - state.coins)} more coins`);
        return;
      }
      state.ownedPaints.push(p.id);
      sfx.buy();
      toast(`${p.name} unlocked`);
    } else {
      sfx.tap();
    }
    state.paint = p.id;
    save();
  });

  // ---- Upgrades ----
  const list = $('#upgrade-list');
  function renderUpgrades() {
    list.innerHTML = UPGRADES.map((u) => {
      const level = state.upgrades[u.id];
      const maxed = level >= u.maxLevel;
      const cost = upgradeCost(u, level);
      const pips = Array.from({ length: u.maxLevel }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
      return `<li class="upgrade">
        <strong>${u.name}</strong>
        <div class="pips" aria-label="Level ${level} of ${u.maxLevel}">${pips}</div>
        <small>${u.blurb}</small>
        <button class="pill-btn" data-upgrade="${u.id}" ${maxed ? 'disabled' : ''}>${maxed ? 'Max' : fmt(cost)}</button>
      </li>`;
    }).join('');
  }
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-upgrade]');
    if (!btn) return;
    const u = UPGRADES.find((x) => x.id === btn.dataset.upgrade);
    const level = state.upgrades[u.id];
    if (level >= u.maxLevel) return;
    const cost = upgradeCost(u, level);
    if (!spendCoins(cost)) {
      sfx.deny();
      toast(`You need ${fmt(cost - state.coins)} more coins`);
      return;
    }
    state.upgrades[u.id] = level + 1;
    sfx.buy();
    garage.rev();
    save();
  });

  // ---- Stats ----
  const statsEl = $('#stats');
  const STAT_LABELS = { speed: 'Speed', nitro: 'Nitro', handling: 'Handling', grip: 'Grip' };
  function renderStats() {
    const values = { ...BASE_STATS };
    UPGRADES.forEach((u) => (values[u.stat] += state.upgrades[u.id] * STAT_PER_LEVEL));
    statsEl.innerHTML = Object.entries(STAT_LABELS)
      .map(([key, label]) => {
        const v = Math.min(100, values[key]);
        return `<li class="stat"><span>${label}</span><div class="bar"><i style="--v:${v}%"></i></div><b>${v}</b></li>`;
      })
      .join('');
  }

  // ---- Camera bar ----
  let wheelCursor = 0;
  const setActiveShot = (shot) => $$('.cam-btn[data-shot]').forEach((b) => b.classList.toggle('is-active', b.dataset.shot === shot));
  $$('.cam-btn[data-shot]').forEach((btn) =>
    btn.addEventListener('click', () => {
      sfx.tap();
      const shot = btn.dataset.shot;
      if (shot === 'wheels') {
        // Repeated taps cycle through all four wheels.
        const wasActive = btn.classList.contains('is-active');
        if (wasActive) wheelCursor = (wheelCursor + 1) % 4;
        garage.snap(wheelCursor);
      } else {
        garage.snap(shot);
      }
      setActiveShot(shot);
    })
  );

  const lightsBtn = $('#btn-lights');
  function toggleLights() {
    sfx.lights();
    const on = garage.toggleLights();
    lightsBtn.setAttribute('aria-pressed', String(on));
  }
  lightsBtn.addEventListener('click', toggleLights);

  // Taps on the car itself.
  garage.onTap = (hit) => {
    if (hit.type === 'lights') toggleLights();
    else if (hit.type === 'wheel') {
      sfx.tap();
      wheelCursor = hit.index;
      garage.snap(hit.index);
      setActiveShot('wheels');
    } else {
      sfx.tap();
      garage.snap('body');
      setActiveShot('body');
    }
  };

  // ---- Race start ----
  const countdown = $('#countdown');
  let racing = false;
  $('#btn-race').addEventListener('click', () => {
    if (racing) return;
    racing = true;
    revertPreview();
    sfx.rev();
    garage.rev();
    garage.snap('rear');
    setActiveShot('rear');
    hud.style.opacity = '0.25';
    countdown.hidden = false;
    let n = 3;
    const step = () => {
      if (n === 0) {
        countdown.hidden = true;
        hud.style.opacity = '';
        racing = false;
        toast('Tracks unlock in the next update. Keep tuning your coupe!', 3200);
        return;
      }
      countdown.innerHTML = `<span>${n}</span>`;
      sfx.tap();
      n -= 1;
      setTimeout(step, 700);
    };
    step();
  });

  function renderAll() {
    renderCoins();
    renderPaint();
    renderUpgrades();
    renderStats();
  }
  subscribe(renderAll);
  renderAll();

  return {
    show() {
      hud.hidden = false;
    },
    revertPreview,
  };
}
