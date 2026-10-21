import { state, save } from '../core/store.js';
import { sfx } from '../core/audio.js';
import { openExternal } from '../core/platform.js';
import { GAME, LEGAL, PRODUCTS } from '../config.js';
import { billing } from '../monetization/billing.js';
import { ads } from '../monetization/ads.js';
import { toast } from './hud.js';

export function createSettings(garage, { onFpsToggle, onEntitlementsChanged, onCrateReset }) {
  const dialog = document.getElementById('settings');
  const qualityButtons = [...dialog.querySelectorAll('[data-quality]')];
  const sound = dialog.querySelector('#opt-sound');
  const fps = dialog.querySelector('#opt-fps');

  dialog.querySelector('#about').textContent =
    `${GAME.title}: ${GAME.subtitle} v${GAME.version} · © ${new Date().getFullYear()} ${GAME.studio}. ` +
    'Plays fully offline. Ads are served by Google AdMob and purchases are processed by Google Play; ' +
    'see the Privacy Policy for what they collect.';

  // ---- Purchases ----
  const restoreBtn = dialog.querySelector('#btn-restore');
  restoreBtn.addEventListener('click', async () => {
    sfx.tap();
    restoreBtn.disabled = true;
    restoreBtn.textContent = 'Restoring…';
    const result = await billing.restore();
    restoreBtn.disabled = false;
    restoreBtn.textContent = 'Restore purchases';
    if (!result.ok) {
      toast('Could not reach Google Play. Check your connection and try again.');
      return;
    }
    const owned = Object.keys(PRODUCTS).filter((id) => billing.owns(id));
    toast(owned.length ? `Restored: ${owned.map((id) => PRODUCTS[id].title).join(', ')}` : 'No purchases to restore on this account.', 3200);
    onEntitlementsChanged?.();
  });

  const privacyRow = dialog.querySelector('#row-ad-privacy');
  dialog.querySelector('#btn-ad-privacy').addEventListener('click', () => ads.showPrivacyOptions());

  // ---- Developer tools (pre-release builds only) ----
  const devTools = dialog.querySelector('#dev-tools');
  const sandbox = dialog.querySelector('#opt-sandbox');
  devTools.hidden = !billing.sandboxAvailable;
  sandbox.addEventListener('change', async () => {
    state.settings.sandboxStore = sandbox.checked;
    save();
    await billing.modeChanged();
    onEntitlementsChanged?.();
    toast(sandbox.checked ? 'Sandbox store on: purchases are simulated' : 'Sandbox store off: purchases go through Google Play');
  });
  dialog.querySelector('#btn-sandbox-reset').addEventListener('click', () => {
    billing.resetSandbox();
    onEntitlementsChanged?.();
    toast('Sandbox purchases cleared');
  });
  dialog.querySelector('#btn-crate-reset').addEventListener('click', () => {
    onCrateReset?.();
    toast('Reward crate is ready again');
  });

  function render() {
    qualityButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.quality === state.settings.quality)));
    sound.checked = state.settings.sound;
    fps.checked = state.settings.showFps;
    // In the browser the store is always simulated, so the toggle shows on and locked.
    sandbox.checked = billing.sandbox;
    sandbox.disabled = billing.sandbox && !state.settings.sandboxStore;
    privacyRow.hidden = !ads.privacyOptionsRequired;
  }

  qualityButtons.forEach((btn) =>
    btn.addEventListener('click', () => {
      state.settings.quality = btn.dataset.quality;
      garage.setQuality(state.settings.quality);
      save();
      render();
      sfx.tap();
    })
  );
  sound.addEventListener('change', () => {
    state.settings.sound = sound.checked;
    save();
    sfx.tap();
  });
  fps.addEventListener('change', () => {
    state.settings.showFps = fps.checked;
    save();
    onFpsToggle(fps.checked);
  });

  dialog.querySelector('#link-privacy').addEventListener('click', () => openExternal(LEGAL.privacyPolicy));
  dialog.querySelector('#link-terms').addEventListener('click', () => openExternal(LEGAL.termsOfService));
  dialog.querySelector('[data-close]').addEventListener('click', () => close());
  // Tap outside the panel closes it.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) close();
    }
  });

  function open() {
    render();
    sfx.tap();
    dialog.showModal();
  }
  function close() {
    if (dialog.open) dialog.close();
  }

  document.getElementById('btn-settings').addEventListener('click', open);

  return {
    open,
    close,
    get isOpen() {
      return dialog.open;
    },
  };
}
