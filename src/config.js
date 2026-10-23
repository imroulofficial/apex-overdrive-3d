// Studio-wide constants. Legal pages are hosted on GitHub Pages from /docs.
// Vite replaces import.meta.env at build time; under plain Node (the tests) it is undefined.
const env = import.meta.env ?? {};
export const GAME = {
  title: 'Apex Overdrive',
  subtitle: '3D Racing',
  studio: 'Red Pen Studio',
  version: '1.0.0',
  appId: 'com.redpenstudio.apexoverdrive',
};

const PAGES_BASE = 'https://imroulofficial.github.io/apex-overdrive-3d';

export const LEGAL = {
  privacyPolicy: `${PAGES_BASE}/privacy-policy.html`,
  termsOfService: `${PAGES_BASE}/terms.html`,
};

export { STARTING_COINS } from './data/economy.js';

// The Google Play build is made with `npm run build:release` (Vite mode "release", which
// sets VITE_RELEASE=1 from .env.release) and serves the live AdMob units below. Every other
// build (dev server, plain `npm run build`, debug installs) serves Google's test units, so
// nobody on the team can ever click a live ad (AdMob invalid-traffic policy).
export const RELEASE = env.VITE_RELEASE === '1';

// Google's published test ad units: always safe to load and click during development.
// https://developers.google.com/admob/android/test-ads
export const TEST_AD_UNITS = Object.freeze({
  banner: 'ca-app-pub-3940256099942544/9214589741', // adaptive banner
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
});

// Live Red Pen Studio ad units from the AdMob console (app ca-app-pub-1848535996024012~6089611565,
// set in android/app/src/main/AndroidManifest.xml). Ad unit ids are public identifiers.
export const ADMOB_APP_ID = 'ca-app-pub-1848535996024012~6089611565';
export const PRODUCTION_AD_UNITS = Object.freeze({
  banner: 'ca-app-pub-1848535996024012/3147879768',
  interstitial: 'ca-app-pub-1848535996024012/1044546325',
  rewarded: 'ca-app-pub-1848535996024012/1767223174',
});

export const ADS = {
  units: RELEASE ? PRODUCTION_AD_UNITS : TEST_AD_UNITS,
  testing: !RELEASE,
  // Blueprint ad rules: the first 3 finished races are protected, then an interstitial plays
  // after every 2nd or 3rd finished race (picked at random each time).
  interstitialGraceRaces: 3,
  interstitialEvery: [2, 3],
  // Never two full-screen ads closer together than this (3 minutes), whatever the race count.
  interstitialMinGapMs: 180_000,
  rewardCrateCoins: 500,
  rewardCrateCooldownMs: 24 * 60 * 60 * 1000,
};

// Google Play one-time products. Create both in Play Console as non-consumable
// in-app products with these exact ids; the store's localized price wins over `price`.
export const PRODUCTS = {
  remove_ads: {
    id: 'remove_ads',
    title: 'No Ads Pack',
    blurb: 'No more banners or between-race ads, forever. Plus 5,000 coins and the exclusive Red Pen Studio Founder iridescent paint.',
    price: '$2.99',
    grants: { noAds: true, coins: 5000, cars: [], paints: ['founder'] },
  },
  supercar_bundle: {
    id: 'supercar_bundle',
    title: 'Supercar Bundle',
    blurb: 'Unlock the Tier A Valkyrie GT-R hypercar, 25,000 coins and No Ads.',
    price: '$6.99',
    grants: { noAds: true, coins: 25000, cars: ['rpx-hyperion'], paints: [] },
  },
};
