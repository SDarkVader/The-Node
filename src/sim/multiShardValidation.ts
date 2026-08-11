import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../world/world.js';
import { createMultiShardState, stepMultiShard, totalPopulation } from './multiShardHarness.js';

/**
 * Validates the district-consolidation + shard-registry work against the actual
 * population-collapse finding (docs/BLUEPRINT.md's "5-role roster" entry), rather than
 * assuming the fix works because the design sounds right. "Simulate before trusting"
 * (CLAUDE.md constraint 1) applies to this exactly as much as anything else built.
 *
 * Single-shard baseline: migrationValveStep pushes emigrants out with nowhere real to
 * land — population settles well below targetPopulation. Multi-shard: the SAME per-shard
 * kernel, but emigrants are routed to a real destination shard via the registry instead of
 * vanishing, so TOTAL population across the whole registry is the number that matters.
 */

const DAYS = 3000;
const BURN_IN = 500;
const SEEDS = [1, 2, 3];

function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

console.log('Multi-shard registry validation — real simulated outcomes, not an assumption.');
console.log(`DAYS=${DAYS} BURN_IN=${BURN_IN} SEEDS=${JSON.stringify(SEEDS)}\n`);

console.log('=== Single-shard baseline (the collapse) ===\n');
const singleShardMeans: number[] = [];
for (const seed of SEEDS) {
  let world = createWorld(seed, DEFAULT_WORLD_CONFIG);
  const pops: number[] = [];
  for (let i = 0; i < DAYS; i++) {
    world = stepWorld(world);
    if (i >= BURN_IN) pops.push(world.population);
  }
  const m = mean(pops);
  singleShardMeans.push(m);
  console.log(`  seed=${seed}  meanPopulation=${m.toFixed(1)}  (targetPopulation=${DEFAULT_WORLD_CONFIG.targetPopulation})`);
}
console.log(`  overall mean: ${mean(singleShardMeans).toFixed(1)} / ${DEFAULT_WORLD_CONFIG.targetPopulation}\n`);

console.log('=== Multi-shard registry (this session\'s fix) ===\n');
const multiShardTotalMeans: number[] = [];
const multiShardPerShardMeans: number[] = [];
const finalShardCounts: number[] = [];
for (const seed of SEEDS) {
  let state = createMultiShardState(seed, DEFAULT_WORLD_CONFIG);
  const totals: number[] = [];
  for (let i = 0; i < DAYS; i++) {
    state = stepMultiShard(state);
    if (i >= BURN_IN) totals.push(totalPopulation(state));
  }
  const totalMean = mean(totals);
  const shardCount = state.registry.shards.length;
  multiShardTotalMeans.push(totalMean);
  multiShardPerShardMeans.push(totalMean / shardCount);
  finalShardCounts.push(shardCount);
  console.log(
    `  seed=${seed}  meanTotalPopulation=${totalMean.toFixed(1)}  finalShardCount=${shardCount}` +
      `  meanPerShard=${(totalMean / shardCount).toFixed(1)} / ${DEFAULT_WORLD_CONFIG.targetPopulation}`,
  );
}
console.log(
  `  overall: meanTotalPopulation=${mean(multiShardTotalMeans).toFixed(1)}` +
    `  meanPerShard=${mean(multiShardPerShardMeans).toFixed(1)} / ${DEFAULT_WORLD_CONFIG.targetPopulation}` +
    `  meanFinalShardCount=${mean(finalShardCounts).toFixed(2)}\n`,
);

const singleMean = mean(singleShardMeans);
const perShardMean = mean(multiShardPerShardMeans);
console.log('=== Reading ===\n');
console.log(
  perShardMean > singleMean
    ? `Per-shard population is HIGHER under the registry (${perShardMean.toFixed(1)} vs ${singleMean.toFixed(1)}) — real evidence the fix helps, not assumed.`
    : `Per-shard population is NOT higher under the registry (${perShardMean.toFixed(1)} vs ${singleMean.toFixed(1)}) — reported honestly, not silently hidden. See docs/BLUEPRINT.md for the follow-up reasoning.`,
);
