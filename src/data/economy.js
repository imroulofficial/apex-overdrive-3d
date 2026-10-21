// Coin economy, balanced to the blueprint (section 06):
//   sources: stage finish 500-1,500 · first-time star +250 each · drift/air bonus up to +300
//   sinks:   cars 3,000 (Tier D) to 75,000 (Tier A) · upgrades 250 (Lvl 1) to 4,000 (Lvl 5)
//            · paint and rims 500-1,500
// Pure data and arithmetic only (no browser APIs), so the tests can import it under Node.

export const STARTING_COINS = 2500;

// What finishing a stage pays, before bonuses. Each stage has its own coinReward inside this
// band (see stageCoinReward); finishing lower down the order pays a share of it, never less
// than the band's floor.
export const FINISH_REWARD = { min: 500, max: 1500 };
export const PLACE_FACTOR = [1, 0.85, 0.75, 0.65, 0.6, 0.55];

// Paid once per star, the first time that star's objective is met.
export const STAR_BONUS = 250;

// Drift, airtime and prop smashes share one bonus pool, capped per race.
export const SKILL_BONUS_CAP = 300;
export const DRIFT_POINTS_PER_COIN = 80;
export const AIR_COINS_PER_SECOND = 40;
export const SMASH_COINS = 5;

// Coins to buy each upgrade level (index 0 buys Level 1). The same on every car.
export const UPGRADE_COSTS = [250, 500, 1000, 2000, 4000];

const roundTo = (n, step) => Math.round(n / step) * step;

// A stage's finish reward from its place in the 60-stage career: 500 coins on stage 1 rising
// evenly to 1,500 on the last, in 50-coin steps. Boss duels pay the top of the band.
export function stageCoinReward(index, total, { boss = false } = {}) {
  if (boss) return FINISH_REWARD.max;
  const k = total > 1 ? index / (total - 1) : 0;
  return roundTo(FINISH_REWARD.min + (FINISH_REWARD.max - FINISH_REWARD.min) * k, 50);
}

// Finish reward for one run. `position` is null in solo modes (Time Trial, Drift Touge),
// which pay in full when the finish objective is met and the floor otherwise.
export function finishCoins(coinReward, { position = null, finishMet = true } = {}) {
  const factor = position ? PLACE_FACTOR[position - 1] ?? PLACE_FACTOR.at(-1) : finishMet ? 1 : 0;
  return Math.max(FINISH_REWARD.min, Math.round(coinReward * factor));
}

// The drift / airtime / smash bonus for one run, split into its parts and capped as a whole.
export function skillBonus({ driftScore = 0, airTime = 0, smashes = 0 } = {}) {
  const drift = Math.floor(Math.max(0, driftScore) / DRIFT_POINTS_PER_COIN);
  const air = Math.floor(Math.max(0, airTime) * AIR_COINS_PER_SECOND);
  const smash = Math.max(0, smashes) * SMASH_COINS;
  const raw = drift + air + smash;
  const total = Math.min(SKILL_BONUS_CAP, raw);
  return { drift, air, smash, total, capped: raw > total };
}
