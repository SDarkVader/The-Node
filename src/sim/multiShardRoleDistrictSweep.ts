import { DEFAULT_WORLD_CONFIG, type WorldConfig } from '../world/world.js';
import type { ShardLayoutConfig } from '../engine/space.js';
import { createMultiShardState, stepMultiShard, totalPopulation } from './multiShardHarness.js';
import { FLOUR_PER_BREAD } from '../engine/resources.js';

/**
 * Six-role allocation / district-layout sweep, run through the ACTUAL composed system
 * (2026-08-11, re-run after Import/Export landed). Supersedes the five-role version — that
 * one predated the Import/Export role, so its S=30 conclusion no longer describes what
 * ships (S=32 today).
 *
 * This sweep deliberately answers TWO coupled questions at once, because tuning them
 * separately was already flagged as a stopgap: the role allocation, AND whether the
 * grain -> flour -> bread chain is actually coherent at that allocation. Adding role slots
 * dilutes staffing, which lowers milled flour, which moves the break-even
 * `FLOUR_PER_BREAD` — so a "best" allocation chosen on population metrics alone can quietly
 * leave Bakers baking flour nobody milled. Each candidate therefore reports its own
 * `flourRatio` (flour consumed / flour milled; <= 1.0 is coherent) and the
 * `breakEvenFPB` that WOULD make it coherent, so the constant can be derived from the
 * chosen allocation rather than chased after the fact.
 *
 * "Cleanest and fairest" stays operationalized as before: staffed (per-shard population
 * near target, health high), not wildly unequal (population-wide Gini), not leaving
 * grifters stuck (mean/max days waiting) — now with chain coherence as a hard qualifier
 * rather than an afterthought.
 */

const DAYS = 1500;
const BURN_IN = 300;
const SEEDS = [1, 2];

interface RoleSplit {
  label: string;
  rMiller: number;
  rBaker: number;
  rCourier: number;
  rInvestigator: number;
  rImportExport: number;
}

const ROLE_SPLITS: RoleSplit[] = [
  { label: 'shipped default (S=32)', rMiller: 4, rBaker: 8, rCourier: 8, rInvestigator: 10, rImportExport: 2 },
  { label: 'Miller-heavier, for chain coherence (S=32)', rMiller: 6, rBaker: 8, rCourier: 6, rInvestigator: 9, rImportExport: 3 },
  { label: 'even-ish across five (S=32)', rMiller: 5, rBaker: 6, rCourier: 6, rInvestigator: 11, rImportExport: 4 },
  { label: 'support-heavy (S=32)', rMiller: 3, rBaker: 6, rCourier: 9, rInvestigator: 12, rImportExport: 2 },
  { label: 'fewer Bakers, Miller-led (S=32)', rMiller: 7, rBaker: 6, rCourier: 7, rInvestigator: 9, rImportExport: 3 },
  { label: 'smaller total (S=26)', rMiller: 4, rBaker: 6, rCourier: 6, rInvestigator: 8, rImportExport: 2 },
  { label: 'larger total (S=38)', rMiller: 6, rBaker: 9, rCourier: 9, rInvestigator: 11, rImportExport: 3 },
];

const DISTRICT_LAYOUTS: { label: string; shardConfig: ShardLayoutConfig }[] = [
  { label: 'default (2 core + 4 periphery, 6 districts)', shardConfig: DEFAULT_WORLD_CONFIG.shardConfig },
  {
    label: 'fewer, bigger districts (3 districts)',
    shardConfig: { ...DEFAULT_WORLD_CONFIG.shardConfig, coreDistrictCount: 1, peripheryDistrictCount: 2, buildingsPerCoreDistrict: 24, buildingsPerPeripheryDistrict: 12 },
  },
  {
    label: 'more, smaller districts (11 districts)',
    shardConfig: { ...DEFAULT_WORLD_CONFIG.shardConfig, coreDistrictCount: 3, peripheryDistrictCount: 8, buildingsPerCoreDistrict: 8, buildingsPerPeripheryDistrict: 4 },
  },
];

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function runCandidate(shardConfig: ShardLayoutConfig, split: RoleSplit) {
  const config: WorldConfig = {
    ...DEFAULT_WORLD_CONFIG,
    shardConfig,
    rMiller: split.rMiller,
    rBaker: split.rBaker,
    rCourier: split.rCourier,
    rInvestigator: split.rInvestigator,
    rImportExport: split.rImportExport,
  };

  const pops: number[] = [];
  const healths: number[] = [];
  const ginis: number[] = [];
  const waitMeans: number[] = [];
  const waitMaxes: number[] = [];
  const shardCounts: number[] = [];
  const flourRatios: number[] = [];
  const breakEvens: number[] = [];
  const grainCover: number[] = [];

  for (const seed of SEEDS) {
    let state = createMultiShardState(seed, config);
    for (let i = 0; i < DAYS; i++) {
      state = stepMultiShard(state);
      if (i >= BURN_IN) {
        const live = [...state.worlds.values()].filter((w) => w.population > 0);
        if (live.length > 0) {
          pops.push(totalPopulation(state) / state.registry.shards.length);
          healths.push(mean(live.map((w) => w.economicHealth)));
          ginis.push(mean(live.map((w) => w.wealthGini)));
          const waits = live.flatMap((w) => w.grifters.map((g) => g.daysAsGrifter));
          waitMeans.push(mean(waits));
          waitMaxes.push(waits.length ? Math.max(...waits) : 0);
        }
      }
    }
    shardCounts.push(state.registry.shards.length);
    for (const w of state.worlds.values()) {
      const c = w.resources.cumulative;
      if (c.flourProduced > 0) {
        flourRatios.push(c.flourConsumed / c.flourProduced);
        breakEvens.push((c.flourProduced / c.breadProduced) || 0);
      }
      if (c.grainConsumed > 0) grainCover.push(c.grainDelivered / c.grainConsumed);
    }
  }

  return {
    perShardPop: mean(pops),
    health: mean(healths),
    gini: mean(ginis),
    waitMean: mean(waitMeans),
    waitMax: waitMaxes.length ? Math.max(...waitMaxes) : 0,
    shards: mean(shardCounts),
    flourRatio: mean(flourRatios),
    breakEvenFPB: mean(breakEvens),
    grainCover: mean(grainCover),
  };
}

console.log('Six-role allocation + district sweep, through the real multi-shard system.');
console.log(`DAYS=${DAYS} BURN_IN=${BURN_IN} SEEDS=${JSON.stringify(SEEDS)} target=${DEFAULT_WORLD_CONFIG.targetPopulation} (brief band 50-80)`);
console.log(`shipped FLOUR_PER_BREAD=${FLOUR_PER_BREAD} — "breakEvenFPB" is the value that would make each candidate exactly coherent\n`);

console.log('=== Role allocation (default district layout) ===\n');
console.log('candidate                                        S   pop/65  health  shards   gini  waitMean  waitMax  flourRatio  breakEvenFPB  grainCover');
for (const sp of ROLE_SPLITS) {
  const S = sp.rMiller + sp.rBaker + sp.rCourier + sp.rInvestigator + sp.rImportExport;
  const r = runCandidate(DEFAULT_WORLD_CONFIG.shardConfig, sp);
  const coherent = r.flourRatio <= 1.0 ? ' ' : '!';
  console.log(
    `${sp.label.padEnd(45)} ${String(S).padStart(3)}  ${r.perShardPop.toFixed(1).padStart(6)}  ${r.health.toFixed(3)}  ` +
      `${r.shards.toFixed(1).padStart(6)}  ${r.gini.toFixed(3)}  ${r.waitMean.toFixed(1).padStart(8)}  ${String(r.waitMax).padStart(7)}  ` +
      `${r.flourRatio.toFixed(3).padStart(10)}${coherent}  ${r.breakEvenFPB.toFixed(3).padStart(12)}  ${r.grainCover.toFixed(2).padStart(10)}`,
  );
  console.log(`${''.padEnd(45)}      M=${sp.rMiller} B=${sp.rBaker} C=${sp.rCourier} I=${sp.rInvestigator} IE=${sp.rImportExport}`);
}

console.log('\n=== District layout (shipped role split held fixed) ===\n');
console.log('layout                                          pop/65  health  shards   gini  waitMean  waitMax  flourRatio');
for (const lay of DISTRICT_LAYOUTS) {
  const r = runCandidate(lay.shardConfig, ROLE_SPLITS[0]!);
  console.log(
    `${lay.label.padEnd(45)} ${r.perShardPop.toFixed(1).padStart(6)}  ${r.health.toFixed(3)}  ${r.shards.toFixed(1).padStart(6)}  ` +
      `${r.gini.toFixed(3)}  ${r.waitMean.toFixed(1).padStart(8)}  ${String(r.waitMax).padStart(7)}  ${r.flourRatio.toFixed(3).padStart(10)}`,
  );
}

console.log(
  '\nflourRatio = flour consumed / flour milled; <= 1.000 is coherent, "!" marks a candidate\n' +
    'baking flour nobody milled. grainCover = grain delivered / grain drawn; >= 1.00 means\n' +
    'Import/Export actually covers the Millers. See docs/BLUEPRINT.md for the reading.',
);
