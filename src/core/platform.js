// Thin wrapper over Capacitor so the same build runs in a desktop browser during development.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

export const isNative = Capacitor.isNativePlatform();

export async function openExternal(url) {
  if (isNative) {
    await Browser.open({ url, presentationStyle: 'popover' });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

// Calls handler(active) when the app moves between foreground and background.
export function onAppStateChange(handler) {
  document.addEventListener('visibilitychange', () => handler(!document.hidden));
  if (isNative) App.addListener('appStateChange', ({ isActive }) => handler(isActive));
}

// Android back button: handler returns true when it consumed the press (e.g. closed a dialog).
export function onBackButton(handler) {
  if (!isNative) return;
  App.addListener('backButton', () => {
    if (!handler()) App.minimizeApp();
  });
}
