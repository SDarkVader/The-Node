import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type WorldConfig } from '../world/world.js';
import type { ShardLayoutConfig } from '../engine/space.js';

/**
 * Data for a decision the user asked to be derived, not guessed — same discipline as
 * `roleRatioSweep.ts` before it. The user specified the roster (Miller, Baker, Courier,
 * Journalist, Detective, plus roleless "grifters" drafted into any open role) and asked
 * for the role-slot allocation and district count to come from simulated consequences:
 * "consider the distribution please to derive role numbers and number of districts with
 * the cleanest and fairest economic reality for our game. test test test."
 *
 * This does NOT change `DEFAULT_WORLD_CONFIG` — it reports what each candidate actually
 * does when run through the real, composed kernel (`world.ts`, already covered by its own
 * population-conservation and mechanism tests), so a final choice can be made from evidence.
 * "Cleanest and fairest" is operationalized as: staffed (`economicHealth` near 1), not
 * wildly unequal (`wealthGini` across the whole population, not just Miller+Baker — the
 * scope this task widened it to), and not leaving grifters stuck for excessive stretches
 * (`grifterMeanDaysWaiting`/`grifterMaxDaysWaiting` — the direct metric the user asked for:
 * "the effect of grifters being under the minimum income floor until they obtain a role").
 */

const DAYS = 2000;
const BURN_IN = 400;
const SEEDS = [1, 2, 3];

// 2026-08-22: Journalist+Detective merged into Investigator (see world.ts's header). This
// sweep predates the fixes noted in README/BLUEPRINT and already needs re-running against
// the current kernel — rInvestigator below is simply the old rJournalist+rDetective SUM per
// candidate, kept mechanical rather than re-deriving these historical splits.
interface RoleSplit {
  label: string;
  rMiller: number;
  rBaker: number;
  rCourier: number;
  rInvestigator: number;
}

const ROLE_SPLITS: RoleSplit[] = [
  { label: 'current illustrative default (S=24)', rMiller: 3, rBaker: 7, rCourier: 6, rInvestigator: 8 },
  { label: 'even split (S=24)', rMiller: 5, rBaker: 5, rCourier: 5, rInvestigator: 9 },
  { label: 'Miller/Baker-heavy, closer to the old 2-role ratio (S=24)', rMiller: 6, rBaker: 10, rCourier: 3, rInvestigator: 5 },
  { label: 'support-role-heavy (S=24)', rMiller: 2, rBaker: 4, rCourier: 8, rInvestigator: 10 },
  { label: 'smaller total, more grifter headroom (S=18)', rMiller: 2, rBaker: 5, rCourier: 5, rInvestigator: 6 },
  { label: 'larger total, less grifter headroom (S=30)', rMiller: 4, rBaker: 8, rCourier: 8, rInvestigator: 10 },
];

interface DistrictLayout {
  label: string;
  shardConfig: ShardLayoutConfig;
}

const DISTRICT_LAYOUTS: DistrictLayout[] = [
  {
    label: 'default (2 core + 4 periphery, 6 districts, 40 buildings)',
    shardConfig: DEFAULT_WORLD_CONFIG.shardConfig,
  },
  {
    label: 'fewer, bigger districts (1 core + 2 periphery, 3 districts, 40 buildings)',
    shardConfig: { ...DEFAULT_WORLD_CONFIG.shardConfig, coreDistrictCount: 1, peripheryDistrictCount: 2, buildingsPerCoreDistrict: 20, buildingsPerPeripheryDistrict: 10 },
  },
  {
    label: 'more, smaller districts (3 core + 8 periphery, 11 districts, 42 buildings)',
    shardConfig: { ...DEFAULT_WORLD_CONFIG.shardConfig, coreDistrictCount: 3, peripheryDistrictCount: 8, buildingsPerCoreDistrict: 6, buildingsPerPeripheryDistrict: 3 },
  },
];

function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function runCandidate(shardConfig: ShardLayoutConfig, split: RoleSplit) {
  const config: WorldConfig = {
    ...DEFAULT_WORLD_CONFIG,
    shardConfig,
    rMiller: split.rMiller,
    rBaker: split.rBaker,
    rCourier: split.rCourier,
    rInvestigator: split.rInvestigator,
  };

  const allPops: number[] = [];
  const allHealth: number[] = [];
  const finalMillerWealth: number[] = [];
  const finalBakerWealth: number[] = [];
  const finalSupportWealth: number[] = [];
  const finalGini: number[] = [];
  const finalGrifterMeanWait: number[] = [];
  const finalGrifterMaxWait: number[] = [];

  for (const seed of SEEDS) {
    let world = createWorld(seed, config);
    for (let i = 0; i < DAYS; i++) {
      world = stepWorld(world);
      if (i >= BURN_IN) {
        allPops.push(world.population);
        allHealth.push(world.economicHealth);
      }
    }
    const millerFilled = world.millers.filter((m) => m.slot.state === 'FILLED');
    const bakerFilled = world.bakers.filter((b) => b.slot.state === 'FILLED');
    const supportFilled = [...world.couriers, ...world.investigators].filter((s) => s.slot.state === 'FILLED');
    finalMillerWealth.push(mean(millerFilled.map((m) => m.wealth)));
    finalBakerWealth.push(mean(bakerFilled.map((b) => b.wealth)));
    finalSupportWealth.push(mean(supportFilled.map((s) => s.wealth)));
    finalGini.push(world.wealthGini);
    const waits = world.grifters.map((g) => g.daysAsGrifter);
    finalGrifterMeanWait.push(mean(waits));
    finalGrifterMaxWait.push(waits.length > 0 ? Math.max(...waits) : 0);
  }

  return {
    meanPop: mean(allPops),
    meanHealth: mean(allHealth),
    minHealth: Math.min(...allHealth),
    meanMillerWealth: mean(finalMillerWealth),
    meanBakerWealth: mean(finalBakerWealth),
    meanSupportWealth: mean(finalSupportWealth),
    bakerToMillerRatio: mean(finalMillerWealth) > 0 ? mean(finalBakerWealth) / mean(finalMillerWealth) : NaN,
    meanGini: mean(finalGini),
    grifterMeanWait: mean(finalGrifterMeanWait),
    grifterMaxWait: Math.max(...finalGrifterMaxWait),
  };
}

console.log('District/role-count sweep — real simulated outcomes, not a recommendation.');
console.log('See this file\'s header comment. DAYS=' + DAYS + ' BURN_IN=' + BURN_IN + ' SEEDS=' + JSON.stringify(SEEDS) + '\n');

console.log('=== Role-slot allocation sweep (default shard/district layout) ===\n');
for (const split of ROLE_SPLITS) {
  const r = runCandidate(DEFAULT_WORLD_CONFIG.shardConfig, split);
  console.log(
    `${split.label}\n` +
      `  M=${split.rMiller} B=${split.rBaker} C=${split.rCourier} I=${split.rInvestigator}` +
      ` (S=${split.rMiller + split.rBaker + split.rCourier + split.rInvestigator})\n` +
      `  meanPop=${r.meanPop.toFixed(1)}  meanHealth=${r.meanHealth.toFixed(3)}  minHealth=${r.minHealth.toFixed(3)}\n` +
      `  meanWealth: miller=${r.meanMillerWealth.toFixed(2)} baker=${r.meanBakerWealth.toFixed(2)} support=${r.meanSupportWealth.toFixed(2)} bakerToMillerRatio=${r.bakerToMillerRatio.toFixed(2)}x\n` +
      `  meanGini(all roles+grifters)=${r.meanGini.toFixed(3)}  grifterMeanDaysWaiting=${r.grifterMeanWait.toFixed(1)}  grifterMaxDaysWaiting=${r.grifterMaxWait}\n`,
  );
}

console.log('\n=== District layout sweep (current illustrative role split held fixed) ===\n');
for (const layout of DISTRICT_LAYOUTS) {
  const r = runCandidate(layout.shardConfig, ROLE_SPLITS[0]!);
  console.log(
    `${layout.label}\n` +
      `  meanPop=${r.meanPop.toFixed(1)}  meanHealth=${r.meanHealth.toFixed(3)}  minHealth=${r.minHealth.toFixed(3)}\n` +
      `  meanGini(all roles+grifters)=${r.meanGini.toFixed(3)}  grifterMeanDaysWaiting=${r.grifterMeanWait.toFixed(1)}  grifterMaxDaysWaiting=${r.grifterMaxWait}\n`,
  );
}

console.log(
  'Not a final recommendation by itself — see docs/BLUEPRINT.md\'s "5-role roster" entry for\n' +
    'the reading of these numbers and what default was actually set from them.',
);
