// Mirrors the v2 checks in firestore.rules so a schema change that the rules would reject
// fails here first. (The rules themselves run in Firestore; see README for the emulator.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrate, toCloudDoc, defaults } from '../src/core/saveSchema.js';
import { settleStage } from '../src/core/career.js';
import { syncOwnedCars, unlockCar } from '../src/core/inventory.js';
import { STAGES } from '../src/data/career.js';
import { v1Save, result } from './helpers.js';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const hasOnly = (obj, keys) => Object.keys(obj).every((k) => keys.includes(k));
const isInt = Number.isInteger;

function rulesAccept(d) {
  const e = d.economy;
  const p = d.progression;
  const g = d.garage;
  return (
    hasOnly(d, ['v', 'updatedAt', 'appVersion', 'economy', 'progression', 'garage']) &&
    d.v === 2 && isInt(d.updatedAt) && typeof d.appVersion === 'string' && d.appVersion.length <= 32 &&
    hasOnly(e, ['coins', 'noAdsPurchased', 'supercarBundlePurchased', 'purchases', 'granted', 'crateClaimedAt']) &&
    isInt(e.coins) && e.coins >= 0 && typeof e.noAdsPurchased === 'boolean' && typeof e.supercarBundlePurchased === 'boolean' &&
    Array.isArray(e.purchases) && e.purchases.length <= 8 && Array.isArray(e.granted) && e.granted.length <= 8 && isInt(e.crateClaimedAt) &&
    hasOnly(p, ['unlockedStage', 'stageStars', 'best', 'milestones']) &&
    isInt(p.unlockedStage) && p.unlockedStage >= 1 && p.unlockedStage <= 120 &&
    Array.isArray(p.stageStars) && p.stageStars.length <= 120 && p.stageStars.every(isInt) &&
    typeof p.best === 'object' && Object.keys(p.best).length <= 120 &&
    Array.isArray(p.milestones) && p.milestones.length <= 32 &&
    hasOnly(g, ['car', 'ownedPaints', 'cars']) && typeof g.car === 'string' && g.car.length <= 32 &&
    Array.isArray(g.ownedPaints) && g.ownedPaints.length <= 64 && typeof g.cars === 'object' && Object.keys(g.cars).length <= 24
  );
}

test('the rules file lists exactly the fields toCloudDoc writes', () => {
  const doc = toCloudDoc(defaults(), '0.7.0');
  const top = rules.match(/validV2\(d\) \{\s*return d\.keys\(\)\.hasOnly\(\[([^\]]+)\]/)[1];
  assert.deepEqual(top.match(/'([^']+)'/g).map((s) => s.slice(1, -1)).sort(), Object.keys(doc).sort());
  for (const [fn, key] of [['validEconomy', 'economy'], ['validProgression', 'progression'], ['validGarage', 'garage']]) {
    const list = rules.match(new RegExp(`${fn}\\(\\w\\) \\{[^}]*?hasOnly\\(\\[([^\\]]+)\\]`))[1];
    assert.deepEqual(list.match(/'([^']+)'/g).map((s) => s.slice(1, -1)).sort(), Object.keys(doc[key]).sort(), key);
  }
});

test('fresh, migrated and late-game saves all pass the rules', () => {
  const fresh = defaults();
  const migrated = migrate(v1Save());
  const late = migrate(v1Save());
  late.coins = 999999;
  late.savedAt = Date.now();
  syncOwnedCars(late, new Set(['supercar_bundle', 'remove_ads']));
  for (const s of STAGES) settleStage(late, s, result({ smashes: 99, driftDistance: 9999, airTime: 99, pulses: 9, time: 1, bestLap: 1, driftScore: 1e6 }));
  late.career.stageStars.forEach((m) => assert.equal(m, 7));
  for (const id of ['kz-kestrel', 'ag-aurelia', 'tm-tempesta']) assert.ok(unlockCar(late, id).ok, id);
  for (const s of [fresh, migrated, late]) {
    const doc = JSON.parse(JSON.stringify(toCloudDoc(s, '0.7.0')));
    assert.ok(rulesAccept(doc), JSON.stringify(doc).slice(0, 200));
    assert.ok(JSON.stringify(doc).length < 20000, 'document stays small');
  }
});
