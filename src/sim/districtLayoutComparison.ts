import { DEFAULT_WORLD_CONFIG, type WorldConfig } from '../world/world.js';
import type { ShardLayoutConfig } from '../engine/space.js';
import { createMultiShardState, stepMultiShard, totalPopulation } from './multiShardHarness.js';

/**
 * Head-to-head district-layout comparison at the shipped allocation (2026-08-11).
 *
 * The joint grid search (`jointGridSearch.ts`) established that the district axis is
 * monotonic — 3 districts favour health, 11 favour equality, 6 sits between — and shipped
 * 6 as the balance point. This runs the two live candidates (6 vs 11) deeply against each
 * other at longer horizon and more seeds, and, crucially, instruments the MECHANISM rather
 * than only the outcome: how many districts actually trip the consolidation ratchet, and
 * how much of the shard ends up under trade-route friction.
 *
 * That matters because the health/equality tradeoff is not a free parameter — it is a
 * consequence of `districtFilledFraction` averaging over however many role slots a district
 * holds. Smaller districts are individually more volatile, trip the irreversible ratchet
 * more often, and each merge redistributes displaced players faster. Measuring merges
 * directly turns "11 districts is fairer" from an observed correlation into an explained
 * one — and shows what it costs in permanently-degraded districts.
 */

const DAYS = 2500;
const BURN_IN = 500;
const SEEDS = [1, 2, 3];

const LAYOUTS: { label: string; districts: number; shardConfig: ShardLayoutConfig }[] = [
  { label: '6 districts (shipped)', districts: 6, shardConfig: DEFAULT_WORLD_CONFIG.shardConfig },
  {
    label: '11 districts (alternative)',
    districts: 11,
    shardConfig: { ...DEFAULT_WORLD_CONFIG.shardConfig, coreDistrictCount: 3, peripheryDistrictCount: 8, buildingsPerCoreDistrict: 8, buildingsPerPeripheryDistrict: 4 },
  },
];

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a: number[], q: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

function run(shardConfig: ShardLayoutConfig) {
  const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, shardConfig };
  const pops: number[] = [];
  const healths: number[] = [];
  const ginis: number[] = [];
  const top10s: number[] = [];
  const waitMeans: number[] = [];
  const waitP90s: number[] = [];
  const waitMaxes: number[] = [];
  const shardCounts: number[] = [];
  const flourRatios: number[] = [];
  const grainCovers: number[] = [];
  const mergedFractions: number[] = [];
  const consolidatingFractions: number[] = [];

  for (const seed of SEEDS) {
    let state = createMultiShardState(seed, config);
    for (let i = 0; i < DAYS; i++) {
      state = stepMultiShard(state);
      if (i >= BURN_IN) {
        const live = [...state.worlds.values()].filter((w) => w.population > 0);
        if (live.length === 0) continue;
        pops.push(totalPopulation(state) / state.registry.shards.length);
        healths.push(mean(live.map((w) => w.economicHealth)));
        ginis.push(mean(live.map((w) => w.wealthGini)));
        top10s.push(mean(live.map((w) => w.wealthTop10Share)));
        const waits = live.flatMap((w) => w.grifters.map((g) => g.daysAsGrifter));
        waitMeans.push(mean(waits));
        waitP90s.push(pct(waits, 0.9));
        waitMaxes.push(waits.length ? Math.max(...waits) : 0);
        // The mechanism: how much of each shard's geography has tripped the ratchet.
        mergedFractions.push(
          mean(live.map((w) => {
            const hs = Object.values(w.districtHealth);
            return hs.filter((h) => h.state === 'MERGED').length / Math.max(1, hs.length);
          })),
        );
        consolidatingFractions.push(
          mean(live.map((w) => {
            const hs = Object.values(w.districtHealth);
            return hs.filter((h) => h.state === 'CONSOLIDATING').length / Math.max(1, hs.length);
          })),
        );
      }
    }
    shardCounts.push(state.registry.shards.length);
    for (const w of state.worlds.values()) {
      const c = w.resources.cumulative;
      if (c.flourProduced > 0) flourRatios.push(c.flourConsumed / c.flourProduced);
      if (c.grainConsumed > 0) grainCovers.push(c.grainDelivered / c.grainConsumed);
    }
  }

  return {
    pop: mean(pops),
    health: mean(healths),
    gini: mean(ginis),
    top10: mean(top10s),
    waitMean: mean(waitMeans),
    waitP90: mean(waitP90s),
    waitMax: Math.max(...waitMaxes),
    shards: mean(shardCounts),
    flourRatio: mean(flourRatios),
    grainCover: mean(grainCovers),
    mergedPct: mean(mergedFractions) * 100,
    consolidatingPct: mean(consolidatingFractions) * 100,
  };
}

const { rMiller, rBaker, rCourier, rInvestigator, rImportExport } = DEFAULT_WORLD_CONFIG;
console.log('District layout head-to-head, at the shipped allocation.');
console.log(`M${rMiller} B${rBaker} C${rCourier} I${rInvestigator} IE${rImportExport}`);
console.log(`DAYS=${DAYS} BURN_IN=${BURN_IN} SEEDS=${JSON.stringify(SEEDS)} target=${DEFAULT_WORLD_CONFIG.targetPopulation} (brief band 50-80)\n`);

const results = LAYOUTS.map((l) => ({ ...l, r: run(l.shardConfig) }));

const rows: [string, (r: ReturnType<typeof run>) => string][] = [
  ['per-shard population', (r) => r.pop.toFixed(1)],
  ['  % of 65 target', (r) => `${((r.pop / 65) * 100).toFixed(1)}%`],
  ['  inside brief 50-80', (r) => (r.pop >= 50 && r.pop <= 80 ? 'yes' : 'NO')],
  ['economicHealth', (r) => r.health.toFixed(3)],
  ['wealth Gini (lower fairer)', (r) => r.gini.toFixed(3)],
  ['top-10% wealth share', (r) => `${(r.top10 * 100).toFixed(1)}%`],
  ['grifter wait, mean days', (r) => r.waitMean.toFixed(1)],
  ['grifter wait, p90 days', (r) => r.waitP90.toFixed(1)],
  ['grifter wait, worst days', (r) => r.waitMax.toFixed(0)],
  ['shard count', (r) => r.shards.toFixed(1)],
  ['flourRatio (<=1 coherent)', (r) => r.flourRatio.toFixed(3)],
  ['grain cover (>=1 covered)', (r) => r.grainCover.toFixed(2)],
  ['districts MERGED', (r) => `${r.mergedPct.toFixed(1)}%`],
  ['districts CONSOLIDATING', (r) => `${r.consolidatingPct.toFixed(1)}%`],
];

console.log(`${'metric'.padEnd(28)}${results.map((x) => x.label.padStart(26)).join('')}   delta`);
for (const [name, fmt] of rows) {
  const vals = results.map((x) => fmt(x.r));
  console.log(`${name.padEnd(28)}${vals.map((v) => v.padStart(26)).join('')}`);
}

const a = results[0]!.r;
const b = results[1]!.r;
console.log('\n--- 11 districts vs 6, as relative change ---');
const rel = (x: number, y: number) => `${(((y - x) / x) * 100).toFixed(1)}%`;
console.log(`  population   ${rel(a.pop, b.pop).padStart(8)}   health ${rel(a.health, b.health).padStart(8)}`);
console.log(`  gini         ${rel(a.gini, b.gini).padStart(8)}   (negative = fairer)`);
console.log(`  grifter wait ${rel(a.waitMean, b.waitMean).padStart(8)}   (negative = shorter)`);
console.log(`  flourRatio   ${rel(a.flourRatio, b.flourRatio).padStart(8)}   (positive = thinner coherence margin)`);
console.log(`  merged pct   ${a.mergedPct.toFixed(1)}% -> ${b.mergedPct.toFixed(1)}%  (the mechanism behind the tradeoff)`);
