import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases';
import { PRODUCTS, RELEASE } from '../config.js';
import { isNative } from '../core/platform.js';
import { state, save, addCoins } from '../core/store.js';
import { CARS } from '../data/cars.js';

// Google Play Billing for the two one-time products (see PRODUCTS in config.js).
//
// Entitlements are derived, never stored loose: `state.purchases.owned` mirrors what Play
// reports (persisted, so the game works offline), sandbox purchases live in their own list,
// and No Ads / unlocked cars are recomputed from both. A purchase's coin bonus is paid once
// per device, tracked in `state.purchases.granted`, so Restore never pays twice.
//
// Sandbox mode simulates the store entirely on-device. It is always on in a desktop
// browser, and on Android it is a Settings toggle in pre-release builds (never in a
// VITE_RELEASE=1 build).

const PURCHASED = '1'; // Play Billing PurchaseState.PURCHASED
const PENDING = '2'; // Play Billing PurchaseState.PENDING
const IDS = Object.keys(PRODUCTS);
const STARTER_CARS = CARS.filter((c) => !c.unlockProduct).map((c) => c.id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const sandboxAvailable = !isNative || !RELEASE;

function createBilling() {
  const listeners = new Set();
  const prices = Object.fromEntries(IDS.map((id) => [id, PRODUCTS[id].price]));
  let storeReady = false;
  let ready = null;

  const sandbox = () => !isNative || (!RELEASE && state.settings.sandboxStore);
  const notify = (event) => listeners.forEach((fn) => fn(event));

  // Recomputes No Ads and unlocked cars from the active purchase lists.
  function applyEntitlements() {
    const p = state.purchases;
    const active = new Set([...p.owned, ...(sandbox() ? p.sandboxOwned : [])]);
    p.noAds = [...active].some((id) => PRODUCTS[id]?.grants.noAds);
    const cars = new Set(STARTER_CARS);
    active.forEach((id) => PRODUCTS[id]?.grants.cars.forEach((c) => cars.add(c)));
    state.ownedCars = [...cars];
    if (!state.ownedCars.includes(state.car)) state.car = STARTER_CARS[0];
  }

  // Pays a product's one-time coin bonus if this device has not paid it yet.
  function payBonus(id) {
    const p = state.purchases;
    if (p.granted.includes(id)) return 0;
    p.granted.push(id);
    addCoins(PRODUCTS[id].grants.coins);
    return PRODUCTS[id].grants.coins;
  }

  function commit(event) {
    applyEntitlements();
    save();
    notify(event);
  }

  // Reads the Play purchase list; acknowledges anything still unacknowledged (Play refunds
  // purchases that are not acknowledged within 3 days). Returns null if the store failed.
  async function queryStore() {
    try {
      const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP });
      const owned = [];
      for (const t of purchases) {
        if (!IDS.includes(t.productIdentifier) || t.purchaseState !== PURCHASED) continue;
        owned.push(t.productIdentifier);
        if (t.isAcknowledged === false && t.purchaseToken) {
          await NativePurchases.acknowledgePurchase({ purchaseToken: t.purchaseToken }).catch((err) =>
            console.warn('[billing] acknowledge failed', err)
          );
        }
      }
      return owned;
    } catch (err) {
      console.warn('[billing] could not read purchases', err);
      return null;
    }
  }

  // Store → local state. Refunded or revoked products disappear from Play's list and lose
  // their entitlement here; coins already paid are kept.
  async function syncFromStore() {
    const owned = await queryStore();
    if (!owned) return { ok: false, restored: [] };
    const before = new Set(state.purchases.owned);
    state.purchases.owned = owned;
    const restored = owned.filter((id) => !before.has(id));
    let coins = 0;
    owned.forEach((id) => (coins += payBonus(id)));
    commit({ type: 'sync', restored, coins });
    return { ok: true, restored, coins };
  }

  async function initStore() {
    try {
      const { isBillingSupported } = await NativePurchases.isBillingSupported();
      if (!isBillingSupported) return;
      storeReady = true;
      NativePurchases.addListener('transactionUpdated', () => syncFromStore());
      const { products } = await NativePurchases.getProducts({ productIdentifiers: IDS, productType: PURCHASE_TYPE.INAPP });
      products.forEach((p) => (prices[p.identifier] = p.priceString));
      notify({ type: 'prices' });
    } catch (err) {
      console.warn('[billing] Play Billing unavailable', err);
    }
    if (storeReady) await syncFromStore();
  }

  return {
    get sandbox() {
      return sandbox();
    },
    sandboxAvailable,
    price: (id) => prices[id],
    owns: (id) => state.purchases.owned.includes(id) || (sandbox() && state.purchases.sandboxOwned.includes(id)),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    init() {
      ready ??= (async () => {
        applyEntitlements();
        save();
        if (isNative) await initStore();
      })();
      return ready;
    },

    // Resolves to { status: 'purchased' | 'pending' | 'cancelled' | 'owned' | 'error', coins?, message? }.
    async purchase(id) {
      await ready;
      if (this.owns(id)) return { status: 'owned' };
      if (sandbox()) {
        await wait(500);
        const p = state.purchases;
        p.sandboxOwned = [...new Set([...p.sandboxOwned, id])];
        const coins = payBonus(id);
        commit({ type: 'purchase', id, coins, sandbox: true });
        return { status: 'purchased', coins };
      }
      if (!storeReady) return { status: 'error', message: 'Google Play is not available on this device.' };
      try {
        const t = await NativePurchases.purchaseProduct({
          productIdentifier: id,
          productType: PURCHASE_TYPE.INAPP,
          isConsumable: false,
          autoAcknowledgePurchases: true,
        });
        if (t.purchaseState === PENDING) return { status: 'pending' };
        if (t.purchaseState && t.purchaseState !== PURCHASED) return { status: 'error', message: 'The purchase did not complete.' };
        state.purchases.owned = [...new Set([...state.purchases.owned, id])];
        const coins = payBonus(id);
        commit({ type: 'purchase', id, coins });
        return { status: 'purchased', coins };
      } catch (err) {
        const message = String(err?.message ?? err);
        if (/cancel/i.test(message)) return { status: 'cancelled' };
        if (/already owned|ITEM_ALREADY_OWNED/i.test(message)) {
          await syncFromStore();
          return { status: 'owned' };
        }
        console.warn('[billing] purchase failed', err);
        return { status: 'error', message: 'The purchase could not be completed. Please try again.' };
      }
    },

    // Settings → Restore Purchases. Resolves to { ok, restored: [ids], coins }.
    async restore() {
      await ready;
      if (sandbox()) {
        commit({ type: 'sync', restored: [], coins: 0 });
        return { ok: true, restored: [...state.purchases.sandboxOwned], coins: 0, sandbox: true };
      }
      if (!storeReady) return { ok: false, restored: [], coins: 0 };
      await NativePurchases.restorePurchases().catch(() => {});
      return syncFromStore();
    },

    // Called when the sandbox toggle flips; re-derives entitlements for the new mode.
    async modeChanged() {
      commit({ type: 'mode' });
      if (!sandbox() && isNative && !storeReady) await initStore();
    },

    resetSandbox() {
      const p = state.purchases;
      p.granted = p.granted.filter((id) => !p.sandboxOwned.includes(id) || p.owned.includes(id));
      p.sandboxOwned = [];
      commit({ type: 'mode' });
    },
  };
}

export const billing = createBilling();
