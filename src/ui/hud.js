import { PAINTS, FINISHES, UPGRADES, RIMS, FX_COLORS, upgradeCost } from '../data/catalog.js';
import { MILESTONES, chapterById } from '../data/career.js';
import { PRODUCTS } from '../config.js';
import { RELEASED_CARS, TIERS, carById } from '../data/cars.js';
import { TAB_SHOTS } from '../garage/cameraRig.js';
import { state, save, subscribe, spendCoins, activeCar } from '../core/store.js';
import { buyUpgrade, buyRim, equipFx, carStats, equipPaint, unlockStatus, unlockCar, activeProducts, ownsPaint as ownsPaintIn } from '../core/inventory.js';
import { sfx } from '../core/audio.js';
import { billing } from '../monetization/billing.js';
import { cloud } from '../core/cloud.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmt = (n) => n.toLocaleString('en-US');

const LOCK_ICON = '<svg viewBox="0 0 24 24"><path d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1Zm2 0h6V8a3 3 0 0 0-6 0v2Z"/></svg>';

// Small front-view drawings of the six rim designs for the Rims tab.
function rimIcon(id) {
  const spokes = (n, w, len = 34, off = 0) =>
    Array.from({ length: n }, (_, i) => `<rect x="50" y="${50 - w / 2}" width="${len}" height="${w}" transform="rotate(${off + (360 / n) * i} 50 50)" />`).join('');
  const body = {
    stock: spokes(5, 5, 34, -6) + spokes(5, 5, 34, 6),
    mesh: spokes(20, 2, 34, 9),
    turbofan: `<circle cx="50" cy="50" r="33" class="rim-fill" />${spokes(12, 4, 30, 0)}`,
    blade: spokes(10, 3.5, 35, 4),
    monoblock: spokes(6, 11, 33),
    'carbon-aero': `<circle cx="50" cy="50" r="36" class="rim-carbon" />${spokes(5, 3, 10, 18).replace(/x="50"/g, 'x="74"')}`,
  }[id];
  return `<svg class="rim-icon rim-${id}" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" class="rim-tyre" /><circle cx="50" cy="50" r="38" class="rim-lip" />${body}<circle cx="50" cy="50" r="7" class="rim-hub" /></svg>`;
}

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
      if (tab.dataset.tab !== 'rims') revertRim();
      if (tab.dataset.tab !== 'cars') endPeek();
      // Each tab frames the part it edits.
      const shot = TAB_SHOTS[tab.dataset.tab];
      if (shot !== undefined) {
        garage.snap(shot);
        setActiveShot(typeof shot === 'number' ? 'wheels' : shot);
      }
    })
  );

  // ---- Paint ----
  const grid = $('#paint-grid');
  const paintById = (id) => PAINTS.find((p) => p.id === id) ?? PAINTS[0];
  // Coin paints are bought once; purchase-exclusive paints follow the Play entitlement.
  const ownsPaint = (p) => ownsPaintIn(state, p);
  grid.innerHTML = PAINTS.map(
    (p) => `<button class="swatch${p.product ? ' exclusive' : ''}${p.milestone ? ' chest-paint' : ''}" data-paint="${p.id}" style="--swatch:${p.color}" aria-label="${p.name}"></button>`
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
    const chest = p.milestone && MILESTONES.find((m) => m.id === p.milestone);
    $('#paint-finish').textContent = p.product
      ? `${FINISHES[p.finish].label} · ${PRODUCTS[p.product].title} exclusive`
      : chest
        ? `${FINISHES[p.finish].label} · ${chapterById(chest.chapterId).name} ${chest.stars}★ chest`
        : FINISHES[p.finish].label;
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
    } else if (chest) {
      // Chest paints are never sold: they come out of world-map milestone chests.
      action.textContent = `${chest.stars}★ chest`;
      action.disabled = true;
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
    if (p.milestone && !ownsPaint(p)) return;
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

  // ---- Rims (bought per car; the turntable previews before you buy) ----
  const rimGrid = $('#rim-grid');
  let previewRim = activeCar().rim;
  const rimById = (id) => RIMS.find((r) => r.id === id) ?? RIMS[0];
  rimGrid.innerHTML = RIMS.map((r) => `<button class="rim-card" data-rim="${r.id}" aria-label="${r.name}">${rimIcon(r.id)}<span>${r.name}</span></button>`).join('');
  function renderRims() {
    const entry = activeCar();
    $$('.rim-card', rimGrid).forEach((el) => {
      const id = el.dataset.rim;
      el.classList.toggle('is-selected', id === previewRim);
      el.classList.toggle('is-equipped', id === entry.rim);
      el.classList.toggle('is-locked', !entry.rims.includes(id));
    });
    const r = rimById(previewRim);
    $('#rim-name').textContent = r.name;
    $('#rim-note').textContent = entry.rims.includes(r.id) ? 'Owned on this car' : `${fmt(r.price)} coins · this car`;
    const action = $('#rim-action');
    if (entry.rim === r.id) {
      action.textContent = 'Equipped';
      action.disabled = true;
    } else {
      action.textContent = entry.rims.includes(r.id) ? 'Equip' : `Buy · ${fmt(r.price)}`;
      action.disabled = false;
    }
  }
  function revertRim() {
    if (previewRim === activeCar().rim) return;
    previewRim = activeCar().rim;
    garage.setRim(previewRim);
    renderRims();
  }
  rimGrid.addEventListener('click', (e) => {
    const el = e.target.closest('.rim-card');
    if (!el) return;
    sfx.tap();
    previewRim = el.dataset.rim;
    garage.setRim(previewRim);
    garage.snap(TAB_SHOTS.rims);
    renderRims();
  });
  $('#rim-action').addEventListener('click', () => {
    const owned = activeCar().rims.includes(previewRim);
    const res = buyRim(state, state.car, previewRim);
    if (!res.ok) {
      sfx.deny();
      if (res.reason === 'coins') toast(`You need ${fmt(res.cost - state.coins)} more coins`);
      return;
    }
    if (owned) sfx.tap();
    else {
      sfx.buy();
      toast(`${rimById(previewRim).name} fitted`);
    }
    garage.rev();
    save();
    cloud.syncSoon();
  });

  // ---- Kit: tyre smoke and nitro trail colours (free, per car) ----
  function renderKit() {
    const entry = activeCar();
    for (const row of [$('#fx-smoke'), $('#fx-nitro')]) {
      const current = entry[row.dataset.slot];
      row.innerHTML = FX_COLORS.map(
        (f) => `<button class="fx-swatch${f.id === current ? ' is-selected' : ''}" data-fx="${f.id}" style="--swatch:${f.color}" aria-label="${f.name}"><span>${f.name}</span></button>`
      ).join('');
    }
  }
  for (const row of [$('#fx-smoke'), $('#fx-nitro')]) {
    row.addEventListener('click', (e) => {
      const el = e.target.closest('[data-fx]');
      if (!el || !equipFx(state, state.car, row.dataset.slot, el.dataset.fx)) return;
      sfx.tap();
      if (row.dataset.slot === 'nitroFx') sfx.rev();
      toast(`${row.dataset.slot === 'smoke' ? 'Tyre smoke' : 'Nitro trail'}: ${FX_COLORS.find((f) => f.id === el.dataset.fx).name}`, 1400);
      save();
      cloud.syncSoon();
    });
  }

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
    let tierShown = null;
    carList.innerHTML = RELEASED_CARS.map((c) => {
      const header = c.tier === tierShown ? '' : `<li class="tier-head"><span class="tier tier-${c.tier.toLowerCase()}">${c.tier}</span>${TIERS[c.tier].name}</li>`;
      tierShown = c.tier;
      const owned = state.ownedCars.includes(c.id);
      const selected = state.car === c.id;
      const lock = owned ? null : unlockStatus(state, c.id, activeProducts(state));
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
      return `${header}<li class="car-item${selected ? ' is-selected' : ''}">
        <button class="car-peek" data-peek="${c.id}" aria-label="Preview ${c.name}"><strong>${c.name}</strong><small>${note}</small></button>
        ${action}
      </li>`;
    }).join('');
  }
  carList.addEventListener('click', (e) => {
    const peek = e.target.closest('[data-peek]');
    if (peek) {
      // Owned cars are selected; any other car rolls onto the turntable as a preview.
      const id = peek.dataset.peek;
      if (state.ownedCars.includes(id) && id !== state.car) {
        e.target.closest('.car-item').querySelector('[data-car]')?.click();
      } else if (id !== garage.wantedCarId) {
        sfx.tap();
        previewCar(id);
      }
      return;
    }
    const unlock = e.target.closest('[data-unlock]');
    if (unlock) {
      onOpenStore?.(unlock.dataset.unlock);
      return;
    }
    const buy = e.target.closest('[data-buy-car]');
    if (buy) {
      const res = unlockCar(state, buy.dataset.buyCar, activeProducts(state));
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
  let peeking = null; // a car the player does not own, shown on the turntable
  function syncCar() {
    if (peeking) return;
    const entry = activeCar();
    const p = paintById(equipped());
    if (garage.wantedCarId === state.car) {
      // Same car: keep its rim in step (a cloud reload can change it).
      if (previewRim === shownRim && entry.rim !== shownRim) garage.setRim((previewRim = entry.rim));
      shownRim = entry.rim;
      return;
    }
    previewPaint = shownEquipped = p.id;
    previewRim = shownRim = entry.rim;
    garage.setCar(carById(state.car), { color: p.color, finish: p.finish, rim: entry.rim });
  }
  let shownRim = activeCar().rim;
  function previewCar(id) {
    peeking = id === state.car ? null : id;
    const p = paintById(equipped());
    garage.setCar(carById(id), { color: p.color, finish: p.finish });
    renderStats();
    garage.snap('body');
    setActiveShot('body');
  }
  function endPeek() {
    if (!peeking) return;
    peeking = null;
    syncCar();
    renderStats();
  }

  // ---- Stats ----
  const statsEl = $('#stats');
  const STAT_LABELS = { speed: 'Top Speed', accel: 'Accel', handling: 'Handling', nitro: 'Nitro' };
  function renderStats() {
    const car = carById(peeking ?? state.car);
    $('#car-class').textContent = (peeking ? `${car.class} · preview` : car.class).toUpperCase();
    $('#car-name').textContent = car.name.toUpperCase();
    const values = carStats(state, car.id);
    renderFeel(car);
    statsEl.innerHTML = Object.entries(STAT_LABELS)
      .map(([key, label]) => {
        const v = Math.round(Math.min(100, values[key]));
        return `<li class="stat"><span>${label}</span><div class="bar"><i style="--v:${v}%"></i></div><b>${v}</b></li>`;
      })
      .join('');
  }

  // How the car drives, from its feel profile (data/cars.js).
  function renderFeel(car) {
    const f = car.feel ?? { weight: 1, power: 2, drift: 1 };
    const kg = Math.round((1250 * f.weight) / 10) * 10;
    const band = f.power < 1.7 ? 'Low-end torque' : f.power < 2.35 ? 'Flat torque' : f.power < 2.9 ? 'High-rev pull' : 'Pulls to redline';
    const tail = f.drift > 1.2 ? 'Loose tail' : f.drift < 0.92 ? 'Planted' : 'Neutral';
    $('#car-feel').innerHTML = [['Weight', `${fmt(kg)} kg`], ['Power', band], ['Balance', tail]].map(([k, v]) => `<li><small>${k}</small><b>${v}</b></li>`).join('');
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

  // Driver door: the hotspot follows the handle on screen.
  const hotspot = $('#door-hotspot');
  function toggleDoor() {
    const open = garage.toggleDoor();
    if (open === null) return;
    sfx.door(open);
    hotspot.setAttribute('aria-label', open ? 'Close the driver door' : 'Open the driver door');
    setActiveShot(open ? null : 'body');
  }
  hotspot.addEventListener('click', toggleDoor);
  garage.onHotspot = (h) => {
    if (hud.hidden || !h.visible) {
      if (!hotspot.hidden) hotspot.hidden = true;
      return;
    }
    hotspot.hidden = false;
    hotspot.classList.toggle('is-open', h.open);
    hotspot.style.transform = `translate(${Math.round(h.x)}px, ${Math.round(h.y)}px)`;
  };

  // Auto-showcase: the HUD fades back while the camera tours the car; any touch restores it.
  garage.onShowcase = (on) => hud.classList.toggle('showcase', on);
  window.addEventListener('pointerdown', () => garage.poke(), { capture: true });

  // Taps on the car itself.
  garage.onTap = (hit) => {
    if (hit.type === 'lights') toggleLights();
    else if (hit.type === 'door') toggleDoor();
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
    revertRim();
    endPeek();
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
    if (peeking && state.ownedCars.includes(peeking)) peeking = null; // just bought it
    renderPaint();
    renderRims();
    renderKit();
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
    revertPreview() {
      revertPreview();
      revertRim();
      endPeek();
    },
    // A newer cloud save replaced the device's progress: show its paint and wallet.
    reloadSave() {
      previewRim = shownRim;
      previewPaint = shownEquipped = equipped();
      const p = paintById(previewPaint);
      garage.setPaint(p.color, p.finish);
      renderAll();
    },
  };
}
