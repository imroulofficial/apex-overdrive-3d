import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishCoins, skillBonus, stageCoinReward, STAR_BONUS, SKILL_BONUS_CAP, UPGRADE_COSTS, FINISH_REWARD } from '../src/data/economy.js';
import { UPGRADES, upgradeCost, RIMS, PAINTS } from '../src/data/catalog.js';

test('finish reward stays within 500-1,500 for every place', () => {
  for (const reward of [500, 1000, 1500]) {
    for (let p = 1; p <= 6; p++) {
      const c = finishCoins(reward, { position: p });
      assert.ok(c >= FINISH_REWARD.min && c <= FINISH_REWARD.max, `${reward} P${p} = ${c}`);
    }
  }
  assert.equal(finishCoins(1500, { position: 1 }), 1500);
  assert.equal(finishCoins(1000, { position: 2 }), 850);
  assert.equal(finishCoins(500, { position: 6 }), 500);
});

test('solo modes pay in full when the finish objective is met', () => {
  assert.equal(finishCoins(1200, { finishMet: true }), 1200);
  assert.equal(finishCoins(1200, { finishMet: false }), 500);
});

test('first-time star bonus is +250', () => {
  assert.equal(STAR_BONUS, 250);
});

test('drift + airtime + smash bonus is capped at 300 per race', () => {
  assert.equal(SKILL_BONUS_CAP, 300);
  const small = skillBonus({ driftScore: 800, airTime: 1.5, smashes: 4 });
  assert.deepEqual(small, { drift: 10, air: 60, smash: 20, total: 90, capped: false });
  const big = skillBonus({ driftScore: 50000, airTime: 20, smashes: 40 });
  assert.equal(big.total, 300);
  assert.equal(big.capped, true);
  assert.equal(skillBonus({}).total, 0);
  assert.equal(skillBonus({ driftScore: -5 }).total, 0);
});

test('stage rewards go 500 -> 1,500 in 50-coin steps, bosses pay 1,500', () => {
  assert.equal(stageCoinReward(0, 60), 500);
  assert.equal(stageCoinReward(59, 60), 1500);
  assert.equal(stageCoinReward(30, 60) % 50, 0);
  assert.equal(stageCoinReward(3, 60, { boss: true }), 1500);
});

test('upgrades cost 250 (Lvl 1) to 4,000 (Lvl 5)', () => {
  assert.deepEqual(UPGRADE_COSTS, [250, 500, 1000, 2000, 4000]);
  assert.deepEqual(UPGRADES.map((u) => u.id), ['topSpeed', 'acceleration', 'handling', 'nitro']);
  for (const u of UPGRADES) {
    assert.equal(u.maxLevel, 5);
    assert.equal(upgradeCost(u, 0), 250);
    assert.equal(upgradeCost(u, 4), 4000);
    assert.equal(upgradeCost(u, 5), Infinity);
  }
});

test('paint and rims cost 500-1,500 (or are free stock items)', () => {
  assert.equal(RIMS.length, 6);
  for (const item of [...RIMS, ...PAINTS]) assert.ok(item.price === 0 || (item.price >= 500 && item.price <= 1500), `${item.id} ${item.price}`);
});
