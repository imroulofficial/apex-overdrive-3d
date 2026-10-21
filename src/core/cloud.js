// Cloud save on Firebase's free Spark plan: anonymous Auth gives every install a player id
// with no sign-up, and Cloud Firestore keeps one small document per player.
//
// The game never waits on the cloud. Progress is saved to the device first (core/store.js)
// and this module only mirrors it, at a few milestones:
//   - launch: read the cloud copy once and adopt it if it is newer than the device's;
//   - back in the garage after a race;
//   - after buying an upgrade, a paint finish or a Play product.
// Each upload is one write of one document (`players/{uid}`, shape in core/saveSchema.js
// toCloudDoc), skipped entirely when nothing
// changed since the last upload, and bursts (several upgrades in a row) collapse into one.
// A player costs about 1 read per launch and a handful of writes per session, far inside
// Spark's 50k reads / 20k writes per day.
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { FirebaseFirestore } from '@capacitor-firebase/firestore';
import { GAME } from '../config.js';
import { isNative } from './platform.js';
import { state, progressOf, applyProgress } from './store.js';
import { SAVE_VERSION, toCloudDoc, fromCloudDoc } from './saveSchema.js';

const COLLECTION = 'players';
const META_KEY = 'apex-overdrive.cloud.v1'; // { uid, uploaded (progress JSON), syncedAt }
const BURST_MS = 4000; // purchases within this window share one write
const MIN_GAP_MS = 15_000; // never two writes closer together than this
const TIMEOUT_MS = 10_000; // Firestore queues writes offline; treat a slow ack as offline

// Desktop browser builds talk to Firebase through the JS SDK, which needs a web app config.
// Without one (the usual case) the browser just saves on the device.
const WEB_CONFIG = import.meta.env.VITE_FIREBASE_API_KEY
  ? {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'apex-overdrive',
      authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'apex-overdrive'}.firebaseapp.com`,
    }
  : null;

const timeout = (promise, ms = TIMEOUT_MS) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
const online = () => navigator.onLine !== false;

function readMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY)) ?? {};
  } catch {
    return {};
  }
}

function createCloud() {
  const listeners = new Set();
  const meta = readMeta();
  // 'local'   cloud save unavailable in this build (browser without a Firebase config)
  // 'syncing' talking to Firestore
  // 'synced'  the cloud copy matches this device
  // 'pending' changes saved on the device, not uploaded yet (offline or a failed write)
  let uid = meta.uid ?? null;
  let ready = null;
  let inFlight = null;
  let burstTimer = 0;
  let lastWriteAt = 0;
  let again = false;
  // The cloud copy was written by a newer app version (a higher schema): never overwrite it
  // from here; this device keeps saving locally until the app is updated.
  let cloudAhead = false;

  const enabled = isNative || !!WEB_CONFIG;
  const progressJson = () => JSON.stringify(progressOf(state));
  const dirty = () => progressJson() !== meta.uploaded;
  const docRef = () => `${COLLECTION}/${uid}`;
  let status = !enabled ? 'local' : dirty() ? 'pending' : 'synced';

  function setStatus(next) {
    if (next === status) return;
    status = next;
    listeners.forEach((fn) => fn(status));
  }
  function writeMeta() {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch {
      // Storage unavailable: the next launch simply uploads once more.
    }
  }

  async function signIn() {
    if (!isNative) {
      const { initializeApp, getApps } = await import('firebase/app');
      if (!getApps().length) initializeApp(WEB_CONFIG);
    }
    const { user } = await FirebaseAuthentication.getCurrentUser();
    if (user) return user.uid;
    const result = await FirebaseAuthentication.signInAnonymously();
    return result.user.uid;
  }

  // Adopts the cloud copy if it was saved after this device's progress last changed.
  // A v1 document (Phase 4-6 apps) is migrated to v2 on the way in, and the next push
  // replaces it with a v2 document.
  async function pull() {
    const { snapshot } = await timeout(FirebaseFirestore.getDocument({ reference: docRef() }));
    const doc = fromCloudDoc(snapshot?.data);
    if (!doc) return false;
    if (doc.newer) {
      cloudAhead = true;
      console.warn(`[cloud] cloud save is schema v${doc.v}; this app writes v${SAVE_VERSION}, so uploads are paused`);
      return false;
    }
    if (!(doc.updatedAt > (state.savedAt ?? 0))) {
      // Device is newer (or equal); remember what the cloud holds so equal saves skip a write.
      if (doc.updatedAt === state.savedAt && doc.v === SAVE_VERSION) meta.uploaded = JSON.stringify(doc.progress);
      return false;
    }
    applyProgress(doc.progress, doc.updatedAt);
    meta.uploaded = progressJson();
    meta.syncedAt = Date.now();
    writeMeta();
    return true;
  }

  async function push() {
    const save = progressJson();
    if (save === meta.uploaded || cloudAhead) return;
    lastWriteAt = Date.now();
    // setDocument replaces the whole document, so a v1 `save` string never lingers.
    await timeout(FirebaseFirestore.setDocument({ reference: docRef(), data: toCloudDoc(state, GAME.version) }));
    meta.uploaded = save;
    meta.syncedAt = Date.now();
    writeMeta();
  }

  async function upload() {
    if (!online()) return setStatus(dirty() ? 'pending' : 'synced');
    if (!uid) await init();
    if (!uid) return;
    if (!dirty()) return setStatus('synced');
    setStatus('syncing');
    await push();
    setStatus(dirty() ? 'pending' : 'synced');
  }

  // One upload at a time; a request made while one is running queues exactly one more.
  // (The reset lives in .finally so it always runs after inFlight is assigned, even when
  // upload() returns without awaiting anything.)
  function run() {
    if (inFlight) {
      again = true;
      return inFlight;
    }
    inFlight = upload()
      .catch((err) => {
        console.warn('[cloud] sync failed', err);
        setStatus('pending');
      })
      .finally(() => {
        inFlight = null;
        if (again) {
          again = false;
          schedule(BURST_MS);
        }
      });
    return inFlight;
  }

  function schedule(delay) {
    clearTimeout(burstTimer);
    const wait = Math.max(delay, lastWriteAt + MIN_GAP_MS - Date.now());
    burstTimer = setTimeout(run, wait);
  }

  async function init() {
    ready ??= (async () => {
      if (!enabled) return setStatus('local');
      if (!online()) return setStatus(dirty() ? 'pending' : 'synced');
      setStatus('syncing');
      try {
        uid = await timeout(signIn());
        if (uid !== meta.uid) {
          // A new player id (fresh install or cleared data) has never been uploaded to.
          meta.uid = uid;
          meta.uploaded = undefined;
          writeMeta();
        }
        const restored = await pull();
        if (restored) {
          setStatus('synced');
          listeners.forEach((fn) => fn(status, { restored: true }));
        }
        await push();
        setStatus(dirty() ? 'pending' : 'synced');
        if (dirty()) schedule(BURST_MS);
      } catch (err) {
        console.warn('[cloud] launch sync failed', err);
        setStatus('pending');
        ready = null; // try the launch steps again when the network comes back
      }
    })();
    return ready;
  }

  if (enabled) {
    window.addEventListener('online', () => (uid ? dirty() && schedule(0) : init()));
    window.addEventListener('offline', () => {
      if (status === 'syncing' || dirty()) setStatus('pending');
    });
  }

  return {
    get status() {
      return status;
    },
    get enabled() {
      return enabled;
    },
    get playerId() {
      return uid;
    },
    get lastSyncedAt() {
      return meta.syncedAt ?? 0;
    },
    // Calls fn(status, { restored }) on every status change, and once with restored: true
    // when launch adopted a newer cloud save.
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    init,
    // Milestone: back in the garage after a race. Uploads right away (rate limit permitting).
    syncNow() {
      if (!enabled) return;
      if (!dirty()) return setStatus(uid ? 'synced' : status);
      setStatus('pending');
      schedule(0);
    },
    // Milestone: a purchase. Waits briefly so a run of purchases becomes one write.
    syncSoon() {
      if (!enabled || !dirty()) return;
      setStatus('pending');
      schedule(BURST_MS);
    },
  };
}

export const cloud = createCloud();
