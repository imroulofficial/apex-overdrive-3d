// Firestore rules check against real v1 and v2 save documents. Kept out of the game's own
// dependencies: cd tools/rules-test && npm install && npm test (Java 11+ for the emulator).

import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { migrate, toCloudDoc, defaults } from '../../src/core/saveSchema.js';
import { settleStage } from '../../src/core/career.js';
import { STAGES } from '../../src/data/career.js';
import { v1Save, result } from '../../test/helpers.js';

// emulators:exec sets FIRESTORE_EMULATOR_HOST (host:port).
const [emulatorHost, emulatorPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-apex', firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: emulatorHost, port: Number(emulatorPort) } });
const db = env.authenticatedContext('alice').firestore();
const other = env.authenticatedContext('bob').firestore();
const ref = doc(db, 'players/alice');
const v1doc = { v: 1, save: JSON.stringify({ coins: 5 }), updatedAt: 1, appVersion: '0.6.0' };
const late = migrate(v1Save());
for (const s of STAGES) settleStage(late, s, result({ smashes: 99, time: 1, bestLap: 1, driftScore: 1e6, driftDistance: 1e4, airTime: 99, pulses: 9 }));
let n = 0;
const check = async (name, p) => { await p; n++; console.log('ok', name); };
await check('v1 create (old app) allowed', assertSucceeds(setDoc(ref, v1doc)));
await check('v1 -> v2 upgrade allowed', assertSucceeds(setDoc(ref, toCloudDoc(migrate(v1Save()), '0.7.0'))));
await check('v2 -> v1 downgrade refused', assertFails(setDoc(ref, v1doc)));
await check('v2 late-game save allowed', assertSucceeds(setDoc(ref, toCloudDoc(late, '0.7.0'))));
await check('v2 fresh save allowed', assertSucceeds(setDoc(ref, toCloudDoc(defaults(), '0.7.0'))));
await check('own read allowed', assertSucceeds(getDoc(ref)));
await check('other player read refused', assertFails(getDoc(doc(other, 'players/alice'))));
await check('other player write refused', assertFails(setDoc(doc(other, 'players/alice'), toCloudDoc(defaults(), '0.7.0'))));
const bad = (mut) => { const d = JSON.parse(JSON.stringify(toCloudDoc(defaults(), '0.7.0'))); mut(d); return d; };
await check('extra top-level field refused', assertFails(setDoc(ref, bad((d) => (d.cheat = 1)))));
await check('negative coins refused', assertFails(setDoc(ref, bad((d) => (d.economy.coins = -1)))));
await check('fractional coins refused', assertFails(setDoc(ref, bad((d) => (d.economy.coins = 1.5)))));
await check('unlockedStage 0 refused', assertFails(setDoc(ref, bad((d) => (d.progression.unlockedStage = 0)))));
await check('huge stageStars refused', assertFails(setDoc(ref, bad((d) => (d.progression.stageStars = Array(200).fill(7))))));
await check('unknown schema v3 refused', assertFails(setDoc(ref, bad((d) => (d.v = 3)))));
await check('missing garage refused', assertFails(setDoc(ref, bad((d) => delete d.garage))));
console.log(`${n} rules checks passed`);
await env.cleanup();
process.exit(0);
