import { registerPlugin } from '@capacitor/core';
import { isNative } from '../core/platform.js';

// Meta (Facebook) SDK for app-install and app-open measurement of Meta app ads, nothing else.
// The decision is made natively (android/.../meta/MetaConsentPolicy.java) from the consent
// answer Google UMP stored on the device: at app start (ApexOverdriveApplication, before the
// first screen) and again here, after the UMP check in ads.init() and after the player changes
// their choice in Settings → Ad privacy, so a new or changed choice still applies this session.
// The native side reads UMP itself, so the status passed in by the callers is not needed.
// No purchase or custom event is ever logged from the game. Browser builds do nothing.

const Native = isNative ? registerPlugin('MetaMeasurement') : null;

let queue = Promise.resolve();

async function apply() {
  if (!Native) return;
  try {
    const { enabled, reason } = await Native.sync();
    console.info(`[meta] measurement ${enabled ? 'on' : 'off'} (${reason})`);
  } catch (err) {
    console.warn('[meta] consent sync failed', err);
  }
}

export const metaMeasurement = {
  // Calls run one at a time, so a later choice always wins.
  sync() {
    queue = queue.then(apply);
    return queue;
  },
};
