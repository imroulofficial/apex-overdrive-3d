import { cloud } from '../core/cloud.js';
import { sfx } from '../core/audio.js';
import { toast } from './hud.js';

// Garage top bar: a small cloud that says whether progress has reached Firestore.
const LABELS = {
  synced: 'Saved to Cloud',
  syncing: 'Syncing…',
  pending: 'Sync pending',
  offline: 'Offline',
  local: 'Saved on device',
};

function ago(ms) {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function createCloudBadge() {
  const badge = document.getElementById('cloud-badge');
  const label = document.getElementById('cloud-label');

  const view = () => (cloud.status === 'pending' && !navigator.onLine ? 'offline' : cloud.status);
  function render() {
    const state = view();
    badge.dataset.state = state;
    label.textContent = LABELS[state];
    badge.setAttribute('aria-label', `Cloud save: ${LABELS[state]}`);
  }

  badge.addEventListener('click', () => {
    sfx.tap();
    const state = view();
    if (state === 'synced') toast(`Progress saved to the cloud ${ago(cloud.lastSyncedAt || Date.now())}.`);
    else if (state === 'syncing') toast('Saving your progress to the cloud…');
    else if (state === 'offline') toast('Offline: progress is saved on this device and uploads when you reconnect.', 3200);
    else if (state === 'pending') {
      toast('Progress is saved on this device. Uploading to the cloud…');
      cloud.syncNow();
    } else toast('Progress is saved on this device.');
  });

  cloud.subscribe(render);
  window.addEventListener('online', render);
  window.addEventListener('offline', render);
  render();
}
