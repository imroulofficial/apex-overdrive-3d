// Studio-wide constants. Legal pages are hosted on GitHub Pages from /docs.
export const GAME = {
  title: 'Apex Overdrive',
  subtitle: '3D Racing',
  studio: 'Red Pen Studio',
  version: '0.3.0',
  appId: 'com.redpenstudio.apexoverdrive',
};

const PAGES_BASE = 'https://imroulofficial.github.io/apex-overdrive-3d';

export const LEGAL = {
  privacyPolicy: `${PAGES_BASE}/privacy-policy.html`,
  termsOfService: `${PAGES_BASE}/terms.html`,
};

export const STARTING_COINS = 2500;

// Pre-launch builds use Google's test ad units and offer the sandbox store toggle.
// A store release is built with VITE_RELEASE=1 (see README), which switches to the
// production ad units below and removes the sandbox toggle from Settings.
export const RELEASE = import.meta.env.VITE_RELEASE === '1';

// Google's published test ad units: always safe to load and click during development.
// https://developers.google.com/admob/android/test-ads
const TEST_AD_UNITS = {
  banner: 'ca-app-pub-3940256099942544/9214589741', // adaptive banner
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
};

// Fill in from the AdMob console before the first store release.
const PRODUCTION_AD_UNITS = {
  banner: import.meta.env.VITE_ADMOB_BANNER ?? '',
  interstitial: import.meta.env.VITE_ADMOB_INTERSTITIAL ?? '',
  rewarded: import.meta.env.VITE_ADMOB_REWARDED ?? '',
};

export const ADS = {
  units: RELEASE ? PRODUCTION_AD_UNITS : TEST_AD_UNITS,
  testing: !RELEASE,
  // An interstitial plays after every 2nd or 3rd finished race (picked at random each time).
  interstitialEvery: [2, 3],
  // Never two interstitials closer together than this, whatever the race count.
  interstitialMinGapMs: 90_000,
  rewardCrateCoins: 500,
  rewardCrateCooldownMs: 24 * 60 * 60 * 1000,
};

// Google Play one-time products. Create both in Play Console as non-consumable
// in-app products with these exact ids; the store's localized price wins over `price`.
export const PRODUCTS = {
  remove_ads: {
    id: 'remove_ads',
    title: 'Remove Ads',
    blurb: 'No more banners or between-race ads, forever. Plus 5,000 bonus coins.',
    price: '$2.99',
    grants: { noAds: true, coins: 5000, cars: [] },
  },
  supercar_bundle: {
    id: 'supercar_bundle',
    title: 'Supercar Bundle',
    blurb: 'Unlock the Tier A RP-X Hyperion, 25,000 coins and No Ads.',
    price: '$6.99',
    grants: { noAds: true, coins: 25000, cars: ['rpx-hyperion'] },
  },
};
