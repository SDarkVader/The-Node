import { createWorld, createDormantWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World, type WorldConfig } from '../world/world.js';
import { ISSUANCE_LINES, totalIssued, settlementTolerance } from '../engine/settlement.js';
import { createMultiShardState, stepMultiShard, totalPopulation } from './multiShardHarness.js';

/**
 * Settlement report (2026-10-20, docs/DESIGN_SETTLEMENT_FLOW_BALANCE_2026-10-20.md §8).
 * Measures, rather than assumes: how big each issuance line really is, how much value the
 * ledger now catches on its way to the dock, how often the standing berth fires, and the
 * implied per-nodule rate `k` that funded issuance would need to match today's income.
 */

const DAYS = 3000;
const BURN_IN = 500;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const nodulesOf = (w: World) => w.lastImportExportWindows.reduce((s, e) => s + e.nodulesReceived, 0);

function singleShard(config: WorldConfig) {
  const perLine: Record<string, number[]> = Object.fromEntries(ISSUANCE_LINES.map((l) => [l, []]));
  const issued: number[] = [];
  const nodules: number[] = [];
  const forfeits: number[] = [];
  const health: number[] = [];
  const gini: number[] = [];
  const population: number[] = [];
  let berthTicks = 0;
  let ticks = 0;
  let worstResidualRatio = 0;
  let finalDock = 0;
  let finalOraclePool = 0;
  for (const seed of SEEDS) {
    let w = createWorld(seed, config);
    for (let day = 0; day < DAYS; day++) {
      w = stepWorld(w);
      const s = w.lastSettlement;
      worstResidualRatio = Math.max(worstResidualRatio, Math.abs(s.residual) / settlementTolerance(s));
      if (day < BURN_IN) continue;
      ticks += 1;
      for (const l of ISSUANCE_LINES) perLine[l]!.push(s.issued[l]);
      issued.push(totalIssued(s.issued));
      nodules.push(nodulesOf(w));
      forfeits.push(s.forfeitedToDock);
      health.push(w.economicHealth);
      gini.push(w.wealthGini);
      population.push(w.population);
      if (w.lastStandingBerthsFired > 0) berthTicks += 1;
    }
    finalDock += w.settlement.dock / SEEDS.length;
    finalOraclePool += w.settlement.oraclePool / SEEDS.length;
  }
  return { perLine, issued, nodules, forfeits, health, gini, population, berthTicks, ticks, worstResidualRatio, finalDock, finalOraclePool };
}

console.log(`Settlement report — ${SEEDS.length} seeds x ${DAYS} days, burn-in ${BURN_IN}, DEFAULT_WORLD_CONFIG.\n`);

const on = singleShard(DEFAULT_WORLD_CONFIG);
const off = singleShard({ ...DEFAULT_WORLD_CONFIG, standingBerths: 0 });

console.log('Invariant: worst |residual| / tolerance across every tick (must be <= 1):');
console.log(`  ${on.worstResidualRatio.toExponential(2)}\n`);

console.log('Issuance per tick, by line (mean, post-burn-in):');
for (const l of ISSUANCE_LINES) console.log(`  ${l.padEnd(18)} ${mean(on.perLine[l]!).toFixed(4)}`);
console.log(`  ${'TOTAL'.padEnd(18)} ${mean(on.issued).toFixed(4)}\n`);

const k = mean(on.issued) / mean(on.nodules);
console.log('Nodule issuance and the implied k:');
console.log(`  mean nodules received per tick:  ${mean(on.nodules).toFixed(4)}`);
console.log(`  implied k (wealth per nodule) for funded issuance to match today's income: ${k.toFixed(4)}\n`);

console.log('Value the ledger now catches instead of destroying:');
console.log(`  forfeited to dock per tick (role-transition balances): ${mean(on.forfeits).toFixed(4)}`);
console.log(`  = ${((mean(on.forfeits) / mean(on.issued)) * 100).toFixed(2)}% of issuance`);
console.log(`  mean dock balance at day ${DAYS}: ${on.finalDock.toFixed(2)}`);
console.log(`  mean Oracle pool at day ${DAYS} (entries minus wealth prizes): ${on.finalOraclePool.toFixed(2)}\n`);

console.log('Standing berth in a populated shard:');
console.log(`  ticks where it fired: ${on.berthTicks} of ${on.ticks} (${((on.berthTicks / on.ticks) * 100).toFixed(3)}%)`);
console.log(`  economicHealth  on ${mean(on.health).toFixed(4)}  off ${mean(off.health).toFixed(4)}`);
console.log(`  wealthGini      on ${mean(on.gini).toFixed(4)}  off ${mean(off.gini).toFixed(4)}`);
console.log(`  population      on ${mean(on.population).toFixed(2)}  off ${mean(off.population).toFixed(2)}\n`);

// A dormant shard is where the all-dark gap was certain: every Import/Export slot VACANT.
const dormantFirstDays = (config: WorldConfig) => {
  const out: number[] = [];
  for (const seed of SEEDS) {
    let w = createDormantWorld(seed, config);
    let n = 0;
    for (let day = 0; day < 10; day++) {
      w = stepWorld(w);
      n += nodulesOf(w);
    }
    out.push(n);
  }
  return mean(out);
};
console.log('Dormant shard, nodules issued over its first 10 days with nobody there:');
console.log(`  berth on ${dormantFirstDays(DEFAULT_WORLD_CONFIG).toFixed(3)}  off ${dormantFirstDays({ ...DEFAULT_WORLD_CONFIG, standingBerths: 0 }).toFixed(3)}\n`);

// Multi-shard: vouchers move real holdings now, and dormant shards issue from day one.
const multi = (config: WorldConfig) => {
  const pops: number[] = [];
  const shardCounts: number[] = [];
  let carried = 0;
  let arrived = 0;
  let toDock = 0;
  for (const seed of [1, 2, 3]) {
    let st = createMultiShardState(seed, config);
    for (let day = 0; day < DAYS; day++) {
      st = stepMultiShard(st);
      carried += st.lastVoucherSettlement.carried;
      arrived += st.lastVoucherSettlement.arrived;
      toDock += st.lastVoucherSettlement.toDock;
      if (day >= BURN_IN) pops.push(totalPopulation(st));
    }
    shardCounts.push(st.worlds.size);
  }
  return { pop: mean(pops), shards: mean(shardCounts), carried, arrived, toDock };
};
const mOn = multi(DEFAULT_WORLD_CONFIG);
const mOff = multi({ ...DEFAULT_WORLD_CONFIG, standingBerths: 0 });
console.log('Multi-shard (3 seeds), standing berth on vs off:');
console.log(`  mean total population  on ${mOn.pop.toFixed(1)}  off ${mOff.pop.toFixed(1)}`);
console.log(`  mean shards with a world  on ${mOn.shards.toFixed(2)}  off ${mOff.shards.toFixed(2)}`);
console.log(`  vouchers: carried ${mOn.carried.toFixed(1)} = arrived ${mOn.arrived.toFixed(1)} + to source dock ${mOn.toDock.toFixed(1)}`);
