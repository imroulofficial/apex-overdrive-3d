import { ADS, PRODUCTS } from '../config.js';
import { state, save, addCoins } from '../core/store.js';
import { sfx } from '../core/audio.js';
import { ads } from '../monetization/ads.js';
import { billing } from '../monetization/billing.js';
import { toast } from './hud.js';

// Garage monetization UI: the Store dialog (Play one-time products) and the daily
// "Free 500 coins" reward crate in the top bar.

const $ = (sel, root = document) => root.querySelector(sel);
const fmt = (n) => n.toLocaleString('en-US');

const OFFER_ART = {
  remove_ads: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M4 4l16 16"/></svg>',
  supercar_bundle: '<svg viewBox="0 0 24 24"><path d="M2 15l2-4 5-2h6l4 3 3 1v3H2z"/><circle cx="7" cy="16.5" r="2"/><circle cx="17" cy="16.5" r="2"/></svg>',
};

export function createStore({ onPurchased } = {}) {
  const dialog = $('#store');
  const list = $('#offers');
  const sandboxBadge = $('#store-sandbox');
  let busy = null;

  function render() {
    sandboxBadge.hidden = !billing.sandbox;
    list.innerHTML = Object.values(PRODUCTS)
      .map((p) => {
        const owned = billing.owns(p.id);
        const label = busy === p.id ? 'Processing…' : owned ? 'Owned' : billing.price(p.id);
        return `<li class="offer" data-offer="${p.id}">
          <span class="offer-art" aria-hidden="true">${OFFER_ART[p.id] ?? ''}</span>
          <div class="offer-text"><strong>${p.title}</strong><small>${p.blurb}</small></div>
          <button class="pill-btn${owned ? '' : ' gold'}" data-buy="${p.id}" ${owned || busy ? 'disabled' : ''}>${label}</button>
        </li>`;
      })
      .join('');
  }

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-buy]');
    if (!btn || busy) return;
    const id = btn.dataset.buy;
    sfx.tap();
    busy = id;
    render();
    const result = await billing.purchase(id);
    busy = null;
    render();
    switch (result.status) {
      case 'purchased':
        sfx.buy();
        toast(`${PRODUCTS[id].title} unlocked${result.coins ? ` · +${fmt(result.coins)} coins` : ''}`, 3200);
        onPurchased?.(id, result);
        break;
      case 'owned':
        toast('You already own this. It has been restored.');
        onPurchased?.(id, result);
        break;
      case 'pending':
        toast('Payment pending. Your items unlock as soon as Google Play confirms it.', 4000);
        break;
      case 'cancelled':
        break;
      default:
        sfx.deny();
        toast(result.message ?? 'Purchase failed.');
    }
  });

  billing.subscribe(() => {
    if (dialog.open) render();
    renderCrate();
  });

  dialog.querySelector('[data-close]').addEventListener('click', () => close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });

  function open(highlight) {
    render();
    sfx.tap();
    if (!dialog.open) dialog.showModal();
    if (highlight) {
      const el = list.querySelector(`[data-offer="${highlight}"]`);
      el?.classList.add('flash');
      el?.scrollIntoView({ block: 'nearest' });
    }
  }
  function close() {
    if (dialog.open) dialog.close();
  }
  $('#btn-store').addEventListener('click', () => open());

  // ---- Reward crate: one rewarded video for 500 coins, once per 24 hours ----
  const crate = $('#btn-crate');
  const crateLabel = $('#crate-label');
  const crateSub = $('#crate-sub');
  let crateBusy = false;
  const crateLeft = () => Math.max(0, state.ads.crateClaimedAt + ADS.rewardCrateCooldownMs - Date.now());

  function renderCrate() {
    const left = crateLeft();
    crate.classList.toggle('ready', left === 0 && !crateBusy);
    crate.setAttribute('aria-disabled', String(left > 0 || crateBusy));
    crateLabel.textContent = `FREE ${fmt(ADS.rewardCrateCoins)}`;
    if (crateBusy) crateSub.textContent = 'Loading ad…';
    else if (left === 0) crateSub.textContent = 'Watch ad';
    else {
      const s = Math.ceil(left / 1000);
      const hh = Math.floor(s / 3600);
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      crateSub.textContent = `${hh}:${mm}:${ss}`;
    }
  }

  crate.addEventListener('click', async () => {
    if (crateBusy) return;
    if (crateLeft() > 0) {
      sfx.deny();
      toast('Next free crate unlocks when the timer runs out.');
      return;
    }
    sfx.tap();
    crateBusy = true;
    renderCrate();
    const outcome = await ads.showRewarded();
    crateBusy = false;
    if (outcome === 'rewarded') {
      state.ads.crateClaimedAt = Date.now();
      addCoins(ADS.rewardCrateCoins);
      save();
      sfx.buy();
      toast(`+${fmt(ADS.rewardCrateCoins)} coins from the crate!`);
    } else if (outcome === 'unavailable') {
      toast('No ad available right now. Try again in a moment.');
    } else {
      toast('Watch the whole ad to open the crate.');
    }
    renderCrate();
  });
  setInterval(() => {
    if (!crate.closest('[hidden]')) renderCrate();
  }, 1000);
  renderCrate();

  return {
    open,
    close,
    get isOpen() {
      return dialog.open;
    },
    resetCrate() {
      state.ads.crateClaimedAt = 0;
      save();
      renderCrate();
    },
  };
}
