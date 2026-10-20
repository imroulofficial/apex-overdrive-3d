import { state, save } from '../core/store.js';
import { sfx } from '../core/audio.js';
import { openExternal } from '../core/platform.js';
import { GAME, LEGAL } from '../config.js';

export function createSettings(garage, { onFpsToggle }) {
  const dialog = document.getElementById('settings');
  const qualityButtons = [...dialog.querySelectorAll('[data-quality]')];
  const sound = dialog.querySelector('#opt-sound');
  const fps = dialog.querySelector('#opt-fps');

  dialog.querySelector('#about').textContent =
    `${GAME.title}: ${GAME.subtitle} v${GAME.version} · © ${new Date().getFullYear()} ${GAME.studio}. ` +
    'Plays fully offline. This version collects no personal information.';

  function render() {
    qualityButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.quality === state.settings.quality)));
    sound.checked = state.settings.sound;
    fps.checked = state.settings.showFps;
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
