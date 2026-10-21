import { PAINTS, FINISHES, UPGRADES, upgradeCost } from '../data/catalog.js';
import { PRODUCTS } from '../config.js';
import { RELEASED_CARS, carById } from '../data/cars.js';
import { state, save, subscribe, spendCoins, activeCar } from '../core/store.js';
import { buyUpgrade, carStats, equipPaint, unlockStatus, unlockCar, activeProducts } from '../core/inventory.js';
import { sfx } from '../core/audio.js';
import { billing } from '../monetization/billing.js';
import { cloud } from '../core/cloud.js';

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

export function createHud(garage, { onRaceStart, onOpenStore } = {}) {
  const hud = $('#hud');
  // Paint, upgrades and rims belong to the selected car.
  const equipped = () => activeCar().paint;
  let previewPaint = equipped();
  let shownEquipped = equipped();

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
  const paintById = (id) => PAINTS.find((p) => p.id === id) ?? PAINTS[0];
  // Coin paints are bought once; purchase-exclusive paints follow the Play entitlement.
  const ownsPaint = (p) => (p.product ? state.purchases.paints.includes(p.id) : state.ownedPaints.includes(p.id));
  grid.innerHTML = PAINTS.map(
    (p) => `<button class="swatch${p.product ? ' exclusive' : ''}" data-paint="${p.id}" style="--swatch:${p.color}" aria-label="${p.name}"></button>`
  ).join('');

  function renderPaint() {
    $$('.swatch', grid).forEach((el) => {
      const id = el.dataset.paint;
      el.classList.toggle('is-selected', id === previewPaint);
      el.classList.toggle('is-equipped', id === equipped());
      const lock = el.querySelector('.lock');
      if (ownsPaint(paintById(id))) lock?.remove();
      else if (!lock) el.insertAdjacentHTML('beforeend', `<span class="lock">${LOCK_ICON}</span>`);
    });
    const p = paintById(previewPaint);
    $('#paint-name').textContent = p.name;
    $('#paint-finish').textContent = p.product ? `${FINISHES[p.finish].label} · ${PRODUCTS[p.product].title} exclusive` : FINISHES[p.finish].label;
    const action = $('#paint-action');
    action.classList.toggle('gold', Boolean(p.product) && !ownsPaint(p));
    if (equipped() === p.id) {
      action.textContent = 'Equipped';
      action.disabled = true;
    } else if (ownsPaint(p)) {
      action.textContent = 'Equip';
      action.disabled = false;
    } else if (p.product) {
      action.textContent = `Get · ${billing.price(p.product)}`;
      action.disabled = false;
    } else {
      action.textContent = `Buy · ${fmt(p.price)}`;
      action.disabled = false;
    }
  }

  function revertPreview() {
    if (previewPaint === equipped()) return;
    previewPaint = equipped();
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
    if (p.product && !ownsPaint(p)) {
      onOpenStore?.(p.product);
      return;
    }
    if (!ownsPaint(p)) {
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
    equipPaint(state, state.car, p.id);
    save();
    cloud.syncSoon();
  });

  // ---- Upgrades ----
  const list = $('#upgrade-list');
  function renderUpgrades() {
    list.innerHTML = UPGRADES.map((u) => {
      const level = activeCar().upgrades[u.id];
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
    const res = buyUpgrade(state, state.car, btn.dataset.upgrade);
    if (!res.ok) {
      if (res.reason === 'coins') {
        sfx.deny();
        toast(`You need ${fmt(res.cost - state.coins)} more coins`);
      }
      return;
    }
    sfx.buy();
    garage.rev();
    save();
    cloud.syncSoon();
  });

  // ---- Cars ----
  const carList = $('#car-list');
  function renderCars() {
    carList.innerHTML = RELEASED_CARS.map((c) => {
      const owned = state.ownedCars.includes(c.id);
      const selected = state.car === c.id;
      const lock = owned ? null : unlockStatus(state, c.id, activeProducts(state, { sandbox: billing.sandbox }));
      let action;
      let note = c.class;
      if (selected) action = '<button class="pill-btn" disabled>Selected</button>';
      else if (owned) action = `<button class="pill-btn" data-car="${c.id}">Select</button>`;
      else if (c.unlock.type === 'iap') {
        action = `<button class="pill-btn gold" data-unlock="${c.unlock.product}">${LOCK_ICON}${billing.price(c.unlock.product)}</button>`;
        note = `${PRODUCTS[c.unlock.product].title} exclusive`;
      } else if (lock.reason === 'stars') {
        action = `<button class="pill-btn" disabled>${LOCK_ICON}${c.unlock.stars} ★</button>`;
        note = `Earn ${lock.starsNeeded} more career stars`;
      } else action = `<button class="pill-btn" data-buy-car="${c.id}">${LOCK_ICON}${fmt(lock.price)}</button>`;
      return `<li class="car-item${selected ? ' is-selected' : ''}">
        <span class="tier tier-${c.tier.toLowerCase()}">${c.tier}</span>
        <div><strong>${c.name}</strong><small>${note}</small></div>
        ${action}
      </li>`;
    }).join('');
  }
  carList.addEventListener('click', (e) => {
    const unlock = e.target.closest('[data-unlock]');
    if (unlock) {
      onOpenStore?.(unlock.dataset.unlock);
      return;
    }
    const buy = e.target.closest('[data-buy-car]');
    if (buy) {
      const res = unlockCar(state, buy.dataset.buyCar, activeProducts(state, { sandbox: billing.sandbox }));
      if (!res.ok) {
        sfx.deny();
        if (res.reason === 'coins') toast(`You need ${fmt(res.price - state.coins)} more coins`);
        return;
      }
      sfx.buy();
      toast(`${carById(buy.dataset.buyCar).name} unlocked`);
      save();
      cloud.syncSoon();
      return;
    }
    const btn = e.target.closest('[data-car]');
    if (!btn) return;
    sfx.buy();
    revertPreview();
    state.car = btn.dataset.car;
    save();
    garage.rev();
  });

  // Keeps the turntable in step with the selected car (selection, purchase or revoke).
  function syncCar() {
    if (garage.wantedCarId === state.car) return;
    const p = paintById(equipped());
    previewPaint = shownEquipped = p.id;
    garage.setCar(carById(state.car), { color: p.color, finish: p.finish });
  }

  // ---- Stats ----
  const statsEl = $('#stats');
  const STAT_LABELS = { speed: 'Top Speed', accel: 'Accel', handling: 'Handling', nitro: 'Nitro' };
  function renderStats() {
    const car = carById(state.car);
    $('#car-class').textContent = car.class.toUpperCase();
    $('#car-name').textContent = car.name.toUpperCase();
    const values = carStats(state, car.id);
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
    sfx.lights(); // relay click and an engine throttle stab
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
  $('#btn-race').addEventListener('click', () => {
    revertPreview();
    sfx.rev();
    garage.rev();
    garage.snap('rear');
    setActiveShot('rear');
    onRaceStart?.();
  });

  function renderAll() {
    // The equipped paint changed underneath us (a refunded exclusive paint falls back to the
    // default in billing.applyEntitlements): show it if the player was not previewing another.
    if (equipped() !== shownEquipped && previewPaint === shownEquipped) revertPreview();
    shownEquipped = equipped();
    renderCoins();
    renderPaint();
    renderUpgrades();
    renderCars();
    renderStats();
    syncCar();
  }
  subscribe(renderAll);
  billing.subscribe(renderAll);
  renderAll();

  return {
    show() {
      hud.hidden = false;
    },
    hide() {
      hud.hidden = true;
    },
    // Replays the coin counter from an earlier value (after race winnings are banked).
    animateCoinsFrom(value) {
      shownCoins = value;
      coinEl.textContent = fmt(shownCoins);
      renderCoins();
    },
    // Back from a race: frame the whole car again.
    snapBody() {
      garage.snap('body');
      setActiveShot('body');
    },
    revertPreview,
    // A newer cloud save replaced the device's progress: show its paint and wallet.
    reloadSave() {
      previewPaint = shownEquipped = equipped();
      const p = paintById(previewPaint);
      garage.setPaint(p.color, p.finish);
      renderAll();
    },
  };
}
