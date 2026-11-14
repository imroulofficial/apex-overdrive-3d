import { registerPlugin } from '@capacitor/core';
import { isNative } from '../core/platform.js';
import { decideMetaMeasurement } from './metaConsent.js';

// Meta (Facebook) SDK for app-install and app-open measurement of Meta app ads, nothing else.
// The SDK is not started at launch (android/app/src/main/AndroidManifest.xml). After the UMP
// consent check in ads.init(), and again after the player changes their choice in
// Settings → Ad privacy, sync() reads the consent the device holds (EU TCF and US GPP), decides with
// metaConsent.js, and tells the local native plugin (MetaMeasurementPlugin.java) to start the
// SDK with automatic app events and advertiser ID on, or to keep or turn them off.
// No purchase or custom event is ever logged from the game. Browser builds do nothing.

const Native = isNative ? registerPlugin('MetaMeasurement') : null;

let queue = Promise.resolve();

async function apply(umpStatus) {
  if (!Native) return;
  try {
    const signals = await Native.getConsentSignals();
    const { allowed } = decideMetaMeasurement({ umpStatus, ...signals });
    await Native.setEnabled({ enabled: allowed });
  } catch (err) {
    console.warn('[meta] consent sync failed', err);
  }
}

export const metaMeasurement = {
  // Calls run one at a time, so a later choice always wins.
  sync(umpStatus) {
    queue = queue.then(() => apply(umpStatus));
    return queue;
  },
};
