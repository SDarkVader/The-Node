import { DEFAULT_WORLD_CONFIG, type WorldConfig } from '../world/world.js';
import type { ShardLayoutConfig } from '../engine/space.js';
import { createMultiShardState, stepMultiShard, totalPopulation } from './multiShardHarness.js';

/**
 * Role-slot allocation / district-layout sweep, re-run through the ACTUAL fixed system
 * (2026-08-11) — the original `districtRoleSweep.ts` predates the district-consolidation,
 * shard-registry, and live-N fixes, so its numbers no longer describe what ships. Judging
 * "cleanest and fairest" against a single, isolated shard is also misleading now that the
 * real fix is the multi-shard registry — a single shard alone still collapses by design
 * (see `multiShardValidation.ts`), so this sweeps every candidate through
 * `multiShardHarness.ts` instead, the same composed system that's actually shipped.
 *
 * "Cleanest and fairest" operationalized the same way as before: staffed
 * (meanPerShardPopulation close to targetPopulation), not wildly unequal (population-wide
 * wealthGini), and not leaving grifters stuck for excessive stretches (grifter mean/max
 * days waiting) — now measured across every shard in the registry, not one.
 */

const DAYS = 1500;
const BURN_IN = 300;
const SEEDS = [1, 2];

interface RoleSplit {
  label: string;
  rMiller: number;
  rBaker: number;
  rCourier: number;
  rJournalist: number;
  rDetective: number;
}

const ROLE_SPLITS: RoleSplit[] = [
  { label: 'current illustrative default (S=24)', rMiller: 3, rBaker: 7, rCourier: 6, rJournalist: 5, rDetective: 3 },
  { label: 'even split (S=24)', rMiller: 5, rBaker: 5, rCourier: 5, rJournalist: 5, rDetective: 4 },
  { label: 'Miller/Baker-heavy (S=24)', rMiller: 6, rBaker: 10, rCourier: 3, rJournalist: 3, rDetective: 2 },
  { label: 'support-role-heavy (S=24)', rMiller: 2, rBaker: 4, rCourier: 8, rJournalist: 6, rDetective: 4 },
  { label: 'smaller total, more grifter headroom (S=18)', rMiller: 2, rBaker: 5, rCourier: 5, rJournalist: 4, rDetective: 2 },
  { label: 'larger total, less grifter headroom (S=30)', rMiller: 4, rBaker: 8, rCourier: 8, rJournalist: 7, rDetective: 3 },
];

const FEWER_BIGGER_DISTRICTS: ShardLayoutConfig = {
  ...DEFAULT_WORLD_CONFIG.shardConfig,
  coreDistrictCount: 1,
  peripheryDistrictCount: 2,
  buildingsPerCoreDistrict: 20,
  buildingsPerPeripheryDistrict: 10,
};

interface DistrictLayout {
  label: string;
  shardConfig: ShardLayoutConfig;
}

const DISTRICT_LAYOUTS: DistrictLayout[] = [
  { label: 'default (2 core + 4 periphery, 6 districts, 40 buildings)', shardConfig: DEFAULT_WORLD_CONFIG.shardConfig },
  { label: 'fewer, bigger districts (1 core + 2 periphery, 3 districts, 40 buildings)', shardConfig: FEWER_BIGGER_DISTRICTS },
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
    rJournalist: split.rJournalist,
    rDetective: split.rDetective,
  };

  const perShardPopSamples: number[] = [];
  const healthSamples: number[] = [];
  const giniSamples: number[] = [];
  const grifterWaitMeans: number[] = [];
  const grifterWaitMaxes: number[] = [];
  const finalShardCounts: number[] = [];

  for (const seed of SEEDS) {
    let state = createMultiShardState(seed, config);
    for (let i = 0; i < DAYS; i++) {
      state = stepMultiShard(state);
      if (i >= BURN_IN) {
        const worlds = [...state.worlds.values()].filter((w) => w.population > 0);
        if (worlds.length > 0) {
          perShardPopSamples.push(totalPopulation(state) / state.registry.shards.length);
          healthSamples.push(mean(worlds.map((w) => w.economicHealth)));
          giniSamples.push(mean(worlds.map((w) => w.wealthGini)));
          const waits = worlds.flatMap((w) => w.grifters.map((g) => g.daysAsGrifter));
          grifterWaitMeans.push(mean(waits));
          grifterWaitMaxes.push(waits.length > 0 ? Math.max(...waits) : 0);
        }
      }
    }
    finalShardCounts.push(state.registry.shards.length);
  }

  return {
    meanPerShardPop: mean(perShardPopSamples),
    meanHealth: mean(healthSamples),
    meanGini: mean(giniSamples),
    grifterMeanWait: mean(grifterWaitMeans),
    grifterMaxWait: grifterWaitMaxes.length > 0 ? Math.max(...grifterWaitMaxes) : 0,
    meanFinalShardCount: mean(finalShardCounts),
  };
}

console.log('Role/district sweep — re-run through the ACTUAL multi-shard system (2026-08-11).');
console.log(`DAYS=${DAYS} BURN_IN=${BURN_IN} SEEDS=${JSON.stringify(SEEDS)} targetPopulation=${DEFAULT_WORLD_CONFIG.targetPopulation}\n`);

console.log('=== Role-slot allocation sweep (default shard/district layout) ===\n');
for (const split of ROLE_SPLITS) {
  const r = runCandidate(DEFAULT_WORLD_CONFIG.shardConfig, split);
  console.log(
    `${split.label}\n` +
      `  M=${split.rMiller} B=${split.rBaker} C=${split.rCourier} J=${split.rJournalist} D=${split.rDetective}` +
      ` (S=${split.rMiller + split.rBaker + split.rCourier + split.rJournalist + split.rDetective})\n` +
      `  meanPerShardPop=${r.meanPerShardPop.toFixed(1)}/${DEFAULT_WORLD_CONFIG.targetPopulation}  meanHealth=${r.meanHealth.toFixed(3)}  meanFinalShardCount=${r.meanFinalShardCount.toFixed(2)}\n` +
      `  meanGini(per-shard, all roles+grifters)=${r.meanGini.toFixed(3)}  grifterMeanDaysWaiting=${r.grifterMeanWait.toFixed(1)}  grifterMaxDaysWaiting=${r.grifterMaxWait}\n`,
  );
}

console.log('\n=== District layout sweep (current illustrative role split held fixed) ===\n');
for (const layout of DISTRICT_LAYOUTS) {
  const r = runCandidate(layout.shardConfig, ROLE_SPLITS[0]!);
  console.log(
    `${layout.label}\n` +
      `  meanPerShardPop=${r.meanPerShardPop.toFixed(1)}/${DEFAULT_WORLD_CONFIG.targetPopulation}  meanHealth=${r.meanHealth.toFixed(3)}  meanFinalShardCount=${r.meanFinalShardCount.toFixed(2)}\n` +
      `  meanGini(per-shard, all roles+grifters)=${r.meanGini.toFixed(3)}  grifterMeanDaysWaiting=${r.grifterMeanWait.toFixed(1)}  grifterMaxDaysWaiting=${r.grifterMaxWait}\n`,
  );
}
