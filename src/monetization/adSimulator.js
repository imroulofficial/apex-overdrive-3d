// Browser stand-in for the AdMob plugin (vite dev / desktop preview). Mirrors the native
// backend's interface so the ad flows can be tested without a device: a fake banner
// strip, a skippable interstitial and a rewarded "video" with a countdown.

const BANNER_HEIGHT = 50;
const REWARD_SECONDS = 3;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function overlay(kind, seconds, closableAfter) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'ad-sim';
    el.innerHTML = `<div class="ad-sim-card">
        <small>TEST AD · ${kind.toUpperCase()}</small>
        <strong>Google AdMob test creative</strong>
        <span class="ad-sim-timer"></span>
        <button class="pill-btn ghost ad-sim-close" disabled>Close</button>
      </div>`;
    document.body.appendChild(el);
    const timer = el.querySelector('.ad-sim-timer');
    const close = el.querySelector('.ad-sim-close');
    const start = performance.now();
    const tick = () => {
      if (!el.isConnected) return;
      const t = (performance.now() - start) / 1000;
      const left = Math.max(0, Math.ceil(seconds - t));
      timer.textContent = left > 0 ? `Reward in ${left}s` : kind === 'rewarded' ? 'Reward earned' : '';
      close.disabled = t < closableAfter;
      requestAnimationFrame(tick);
    };
    tick();
    close.addEventListener('click', () => {
      const watched = (performance.now() - start) / 1000 >= seconds;
      el.remove();
      resolve(watched);
    });
  });
}

// The banner lives in the top layer (a popover) so, like the native one, it floats above
// the modal Settings dialog it is shown with.
function setVisible(el, on) {
  if (el.showPopover) {
    if (on && !el.matches(':popover-open')) el.showPopover();
    if (!on && el.matches(':popover-open')) el.hidePopover();
  } else el.hidden = !on;
}

export function createAdSimulator() {
  let sizeListener = () => {};
  let banner = null;
  return {
    async init() {
      await wait(50);
      return { canRequestAds: true, privacyOptions: false };
    },
    async showPrivacyOptions() {},
    onBannerSize(fn) {
      sizeListener = fn;
    },
    async showBanner(margin) {
      banner = document.createElement('div');
      banner.className = 'ad-sim-banner';
      banner.style.bottom = `${margin}px`;
      banner.textContent = 'Test banner · Google AdMob';
      banner.popover = 'manual';
      document.body.appendChild(banner);
      setVisible(banner, true);
      sizeListener(BANNER_HEIGHT);
    },
    async hideBanner() {
      if (banner) setVisible(banner, false);
      sizeListener(0);
    },
    async resumeBanner() {
      if (banner) setVisible(banner, true);
      sizeListener(BANNER_HEIGHT);
    },
    async removeBanner() {
      banner?.remove();
      banner = null;
      sizeListener(0);
    },
    prepareInterstitial: () => wait(300),
    prepareRewarded: () => wait(300),
    showInterstitial: () => overlay('interstitial', 0, 1),
    showRewarded: () => overlay('rewarded', REWARD_SECONDS, 0),
  };
}
