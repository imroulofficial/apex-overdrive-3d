import {
  AdMob,
  AdmobConsentStatus,
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
  InterstitialAdPluginEvents,
  MaxAdContentRating,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import { ADS } from '../config.js';
import { isNative } from '../core/platform.js';
import { state, save } from '../core/store.js';
import { suspendAudio, resumeAudio } from '../core/audio.js';
import { createAdSimulator } from './adSimulator.js';

// Google AdMob, placed by the blueprint's rules: a bottom banner only while Settings is open
// (never in the 3D garage or a race), an interstitial on the way back to the garage after
// every 2-3 finished races once the first 3 races are done and never within 3 minutes of
// another full-screen ad, and opt-in rewarded videos. Banner and interstitial respect the
// No Ads entitlement; rewarded ads stay available because the player asks for them.
//
// In a desktop browser (vite dev) the same calls drive an on-page simulator, so every ad
// flow can be exercised without a device.

const LOAD_TIMEOUT_MS = 8000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const timeout = (p, ms) => Promise.race([p, wait(ms).then(() => Promise.reject(new Error('timeout')))]);

function createAdMobBackend() {
  const listeners = new Map();
  return {
    async init() {
      // UMP consent (GDPR / US state privacy). Ads load only once Google says we may.
      let info = { canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' };
      try {
        info = await AdMob.requestConsentInfo({ tagForUnderAgeOfConsent: false });
        if (info.status === AdmobConsentStatus.REQUIRED && info.isConsentFormAvailable) {
          info = await AdMob.showConsentForm();
        }
      } catch (err) {
        console.warn('[ads] consent check failed', err);
      }
      await AdMob.initialize({
        initializeForTesting: ADS.testing,
        // Audience is 13+ and not child-directed; cap ad content at Teen.
        tagForChildDirectedTreatment: false,
        tagForUnderAgeOfConsent: false,
        maxAdContentRating: MaxAdContentRating.Teen,
      });
      return {
        canRequestAds: info.canRequestAds !== false,
        // The plugin does not export this enum at runtime, so compare the raw value.
        privacyOptions: info.privacyOptionsRequirementStatus === 'REQUIRED',
      };
    },
    showPrivacyOptions: () => AdMob.showPrivacyOptionsForm(),
    onBannerSize(fn) {
      AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => fn(size?.height ?? 0));
    },
    showBanner: (margin) =>
      AdMob.showBanner({
        adId: ADS.units.banner,
        adSize: BannerAdSize.ADAPTIVE_BANNER,
        position: BannerAdPosition.BOTTOM_CENTER,
        margin,
        isTesting: ADS.testing,
      }),
    hideBanner: () => AdMob.hideBanner(),
    resumeBanner: () => AdMob.resumeBanner(),
    removeBanner: () => AdMob.removeBanner(),
    prepareInterstitial: () => AdMob.prepareInterstitial({ adId: ADS.units.interstitial, isTesting: ADS.testing, immersiveMode: true }),
    prepareRewarded: () => AdMob.prepareRewardVideoAd({ adId: ADS.units.rewarded, isTesting: ADS.testing, immersiveMode: true }),
    // Resolves when the interstitial closes (or fails to show).
    showInterstitial() {
      return new Promise((resolve) => {
        const done = once(resolve);
        listenOnce(listeners, InterstitialAdPluginEvents.Dismissed, done);
        listenOnce(listeners, InterstitialAdPluginEvents.FailedToShow, done);
        AdMob.showInterstitial().catch(done);
      });
    },
    // Resolves true if the player earned the reward, once the ad has closed.
    showRewarded() {
      return new Promise((resolve) => {
        let earned = false;
        const done = once(() => resolve(earned));
        listenOnce(listeners, RewardAdPluginEvents.Rewarded, () => (earned = true));
        listenOnce(listeners, RewardAdPluginEvents.Dismissed, done);
        listenOnce(listeners, RewardAdPluginEvents.FailedToShow, done);
        AdMob.showRewardVideoAd().catch(done);
      });
    },
  };
}

function once(fn) {
  let called = false;
  return (...args) => {
    if (called) return;
    called = true;
    fn(...args);
  };
}

// Plugin listeners are global; keep exactly one live handler per event for the current ad.
function listenOnce(registry, event, fn) {
  registry.get(event)?.remove();
  AdMob.addListener(event, fn).then((h) => registry.set(event, h));
}

function createAdService() {
  const backend = isNative ? createAdMobBackend() : createAdSimulator();
  let ready = null;
  let canRequestAds = false;
  let privacyOptions = false;
  let bannerWanted = false;
  let bannerShown = false;
  let bannerCreated = false;
  let bannerHeight = 0;
  let bannerMargin = 0;
  const loaded = { interstitial: null, rewarded: null }; // pending/settled load promises
  let lastFullscreenAt = 0;

  const enabled = (unit) => canRequestAds && Boolean(ADS.units[unit]);
  const noAds = () => state.purchases.noAds;

  function setBannerSpace(px) {
    document.documentElement.style.setProperty('--banner-h', `${Math.round(px)}px`);
  }

  // The banner floats above the WebView, so lift it clear of the gesture bar and tell the
  // layout its height (Settings moves up to stay clear of it).
  function safeBottomInset() {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;bottom:0;height:var(--sab);visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
    const h = probe.offsetHeight;
    probe.remove();
    return h;
  }

  function preload(kind) {
    if (!enabled(kind) || (kind === 'interstitial' && noAds())) return null;
    if (loaded[kind]) return loaded[kind];
    const task = (kind === 'interstitial' ? backend.prepareInterstitial() : backend.prepareRewarded()).then(
      () => true,
      (err) => {
        console.warn(`[ads] ${kind} failed to load`, err);
        loaded[kind] = null; // allow a retry later
        return false;
      }
    );
    loaded[kind] = task;
    return task;
  }

  // Banner calls run one at a time, each against the latest wish. Without the queue a hide
  // that arrives while the native banner is still being created (the map opening and a race
  // starting a moment later) would run first, and the banner would then appear in the race.
  let bannerQueue = Promise.resolve();
  function syncBanner() {
    bannerQueue = bannerQueue.then(applyBanner);
    return bannerQueue;
  }

  async function applyBanner() {
    const want = bannerWanted && !noAds() && enabled('banner');
    if (want === bannerShown) return;
    bannerShown = want;
    try {
      if (want) {
        if (bannerCreated) await backend.resumeBanner();
        else {
          bannerMargin = safeBottomInset();
          await backend.showBanner(bannerMargin);
          bannerCreated = true;
        }
        if (bannerHeight) setBannerSpace(bannerHeight + bannerMargin);
      } else {
        setBannerSpace(0);
        if (noAds()) {
          await backend.removeBanner();
          bannerCreated = false;
        } else await backend.hideBanner();
      }
    } catch (err) {
      console.warn('[ads] banner', err);
      bannerShown = false;
      setBannerSpace(0);
    }
  }

  async function fullscreen(show) {
    suspendAudio();
    try {
      return await show();
    } finally {
      lastFullscreenAt = Date.now();
      resumeAudio();
    }
  }

  return {
    init() {
      ready ??= (async () => {
        try {
          ({ canRequestAds, privacyOptions } = await backend.init());
        } catch (err) {
          console.warn('[ads] AdMob failed to initialise; continuing without ads', err);
          canRequestAds = false;
        }
        backend.onBannerSize((h) => {
          bannerHeight = h;
          if (bannerShown) setBannerSpace(h > 0 ? h + bannerMargin : 0);
        });
        preload('rewarded');
        preload('interstitial');
        await syncBanner();
      })();
      return ready;
    },

    get privacyOptionsRequired() {
      return privacyOptions;
    },
    async showPrivacyOptions() {
      await backend.showPrivacyOptions();
    },

    // Settings open: true. Garage and racing: false.
    async setBanner(visible) {
      bannerWanted = visible;
      await ready;
      await syncBanner();
    },

    // Call after No Ads is granted or revoked.
    async refreshEntitlements() {
      await ready;
      await syncBanner();
      if (!noAds()) preload('interstitial');
    },

    // Counts a finished race toward the grace period and the next interstitial.
    noteRaceFinished() {
      state.ads.racesFinished += 1;
      state.ads.racesSinceInterstitial += 1;
      save();
    },

    // During the race → garage wipe. Resolves once the ad (if any) has been closed.
    async maybeShowInterstitial() {
      await ready;
      const a = state.ads;
      if (noAds() || !enabled('interstitial')) return false;
      if (a.racesFinished <= ADS.interstitialGraceRaces) return false;
      if (a.racesSinceInterstitial < a.nextInterstitialAt) return false;
      // The cooldown survives restarts: the last interstitial's time is saved.
      // A saved time in the future (the device clock was moved back) does not block ads forever.
      if (a.lastInterstitialAt > Date.now()) a.lastInterstitialAt = 0;
      if (Date.now() - Math.max(lastFullscreenAt, a.lastInterstitialAt) < ADS.interstitialMinGapMs) return false;
      const ok = await Promise.race([preload('interstitial'), wait(1200).then(() => false)]);
      if (!ok) return false; // not ready; try again after the next race
      loaded.interstitial = null;
      await fullscreen(() => backend.showInterstitial());
      const [lo, hi] = ADS.interstitialEvery;
      a.racesSinceInterstitial = 0;
      a.nextInterstitialAt = lo + Math.floor(Math.random() * (hi - lo + 1));
      a.lastInterstitialAt = Date.now();
      save();
      preload('interstitial');
      return true;
    },

    // Plays a rewarded video. Resolves to 'rewarded', 'skipped' or 'unavailable'.
    async showRewarded() {
      await ready;
      if (!enabled('rewarded') || offline()) return 'unavailable';
      let ok = false;
      try {
        ok = await timeout(preload('rewarded'), LOAD_TIMEOUT_MS);
      } catch {
        ok = false;
      }
      if (!ok) return 'unavailable';
      loaded.rewarded = null;
      const earned = await fullscreen(() => backend.showRewarded());
      preload('rewarded');
      return earned ? 'rewarded' : 'skipped';
    },
  };
}

export const ads = createAdService();

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// What to tell the player when a rewarded ad paid nothing ('unavailable': offline or no fill;
// 'skipped': closed early, with `skipped` as the text). Null after a reward.
export function rewardedFallback(outcome, skipped) {
  if (outcome === 'unavailable') return offline() ? "You're offline. Connect to the internet to watch an ad." : 'No ad available right now. Try again in a moment.';
  if (outcome === 'skipped') return skipped;
  return null;
}
