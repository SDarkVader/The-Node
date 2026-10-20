import { createWorld, createDormantWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World, type WorldConfig } from '../world/world.js';
import { ISSUANCE_LINES, PAY_LINES, totalIssued, totalHoldings, settlementTolerance } from '../engine/settlement.js';
import { createMultiShardState, stepMultiShard, totalPopulation } from './multiShardHarness.js';

/**
 * Settlement report (2026-10-20, docs/DESIGN_SETTLEMENT_FLOW_BALANCE_2026-10-20.md §8).
 * Before/after: 'legacy' (every income issued; wealth lost at role changes) against 'funded'
 * (wealth follows the person; the dock pays for nodules; wages from the district pool; upkeep
 * as the sink). Measured, not assumed — constraint 1.
 */

const DAYS = 3000;
const BURN_IN = 500;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const nodulesOf = (w: World) => w.lastImportExportWindows.reduce((s, e) => s + e.nodulesReceived, 0);
const holdingsOf = (w: World) => totalHoldings([w.millers, w.bakers, w.couriers, w.investigators, w.importExporters, w.grifters]);

function singleShard(config: WorldConfig) {
  const issuedByLine: Record<string, number[]> = Object.fromEntries(ISSUANCE_LINES.map((l) => [l, []]));
  const paidByLine: Record<string, number[]> = Object.fromEntries(PAY_LINES.map((l) => [l, []]));
  const series = { newMoney: [] as number[], paid: [] as number[], holdings: [] as number[], perCapita: [] as number[], nodules: [] as number[], forfeit: [] as number[], upkeep: [] as number[], dockToNodules: [] as number[], dock: [] as number[], pool: [] as number[], health: [] as number[], healthExp: [] as number[], gini: [] as number[], population: [] as number[], wageScale: [] as number[], earlyHoldings: [] as number[], lateHoldings: [] as number[] };
  let ticks = 0, proRatedTicks = 0, floorShortfallTicks = 0, berthTicks = 0, worstResidualRatio = 0;
  for (const seed of SEEDS) {
    let w = createWorld(seed, config);
    for (let day = 0; day < DAYS; day++) {
      w = stepWorld(w);
      const s = w.lastSettlement;
      worstResidualRatio = Math.max(worstResidualRatio, Math.abs(s.residual) / settlementTolerance(s));
      if (day < BURN_IN) continue;
      ticks += 1;
      for (const l of ISSUANCE_LINES) issuedByLine[l]!.push(s.issued[l]);
      for (const l of PAY_LINES) paidByLine[l]!.push(s.paid[l]);
      series.newMoney.push(totalIssued(s.issued));
      series.paid.push(PAY_LINES.reduce((a, l) => a + s.paid[l], 0));
      const h = holdingsOf(w);
      series.holdings.push(h);
      series.perCapita.push(w.population > 0 ? h / w.population : 0);
      if (day < BURN_IN + 300) series.earlyHoldings.push(h);
      if (day >= DAYS - 300) series.lateHoldings.push(h);
      series.nodules.push(nodulesOf(w));
      series.forfeit.push(s.forfeitedToDock);
      series.upkeep.push(s.upkeepToDock);
      series.dockToNodules.push(s.dockToNodules);
      series.dock.push(w.settlement.dock);
      series.pool.push(w.settlement.districtPool);
      series.health.push(w.economicHealth);
      series.healthExp.push(w.economicHealthWithExperience);
      series.gini.push(w.wealthGini);
      series.population.push(w.population);
      series.wageScale.push(s.wageScale);
      if (s.wageScale < 1) proRatedTicks += 1;
      if (s.issued.floorShortfall > 0) floorShortfallTicks += 1;
      if (w.lastStandingBerthsFired > 0) berthTicks += 1;
    }
  }
  return { issuedByLine, paidByLine, series, ticks, proRatedTicks, floorShortfallTicks, berthTicks, worstResidualRatio };
}

const f = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(2)}%`;

console.log(`Settlement report — legacy vs funded. ${SEEDS.length} seeds x ${DAYS} days, burn-in ${BURN_IN}, DEFAULT_WORLD_CONFIG.\n`);
const L = singleShard({ ...DEFAULT_WORLD_CONFIG, settlement: 'legacy' });
const F = singleShard(DEFAULT_WORLD_CONFIG);

console.log('Invariant — worst |residual| / tolerance (must be <= 1):');
console.log(`  legacy ${L.worstResidualRatio.toExponential(2)}   funded ${F.worstResidualRatio.toExponential(2)}\n`);

const row = (label: string, a: number, b: number, d = 4) => console.log(`  ${label.padEnd(34)} ${f(a, d).padStart(12)} ${f(b, d).padStart(12)}`);
console.log(`  ${''.padEnd(34)} ${'legacy'.padStart(12)} ${'funded'.padStart(12)}`);
console.log('Money');
row('new money per tick (all issuance)', mean(L.series.newMoney), mean(F.series.newMoney));
row('income paid per tick', mean(L.series.paid), mean(F.series.paid));
row('lost at role changes per tick', mean(L.series.forfeit), mean(F.series.forfeit));
row('upkeep to dock per tick', mean(L.series.upkeep), mean(F.series.upkeep));
row('dock -> nodules per tick', mean(L.series.dockToNodules), mean(F.series.dockToNodules));
row('mean dock balance', mean(L.series.dock), mean(F.series.dock), 1);
row('mean district pool balance', mean(L.series.pool), mean(F.series.pool), 1);
console.log('Holdings');
row('total holdings (mean)', mean(L.series.holdings), mean(F.series.holdings), 1);
row('holdings per person (mean)', mean(L.series.perCapita), mean(F.series.perCapita), 2);
row('total holdings, first 300 post-burn', mean(L.series.earlyHoldings), mean(F.series.earlyHoldings), 1);
row('total holdings, last 300', mean(L.series.lateHoldings), mean(F.series.lateHoldings), 1);
row('wealthGini', mean(L.series.gini), mean(F.series.gini));
console.log('Economy');
row('economicHealth', mean(L.series.health), mean(F.series.health));
row('economicHealthWithExperience', mean(L.series.healthExp), mean(F.series.healthExp));
row('population', mean(L.series.population), mean(F.series.population), 2);
row('nodules per tick', mean(L.series.nodules), mean(F.series.nodules));
console.log('Funded-only pressure signals');
console.log(`  wages pro-rated (scale < 1): ${F.proRatedTicks} of ${F.ticks} ticks (${pct(F.proRatedTicks, F.ticks)}), mean scale ${f(mean(F.series.wageScale))}, min ${f(Math.min(...F.series.wageScale))}`);
console.log(`  floor shortfall issued:      ${F.floorShortfallTicks} of ${F.ticks} ticks (${pct(F.floorShortfallTicks, F.ticks)})`);
console.log(`  standing berth fired:        ${F.berthTicks} of ${F.ticks} ticks\n`);

console.log('New money by line, per tick (funded: wage lines are pool transfers, so 0 here):');
for (const l of ISSUANCE_LINES) row(l, mean(L.issuedByLine[l]!), mean(F.issuedByLine[l]!));
console.log('Paid by line, per tick:');
for (const l of PAY_LINES) row(l, mean(L.paidByLine[l]!), mean(F.paidByLine[l]!));
console.log('');

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
console.log('Dormant shard, nodules over its first 10 days with nobody there:');
console.log(`  standing berth on ${f(dormantFirstDays(DEFAULT_WORLD_CONFIG), 3)}  off ${f(dormantFirstDays({ ...DEFAULT_WORLD_CONFIG, standingBerths: 0 }), 3)}\n`);

// Per seed, not only a mean: whether a third shard opens is decided in the first day or two
// (canOpenNewShard needs mean population >= target, which only holds before shards settle
// near ~62), so one seed missing it moves an average a lot without saying anything about
// the economy.
const multiSeed = (config: WorldConfig, seed: number) => {
  let st = createMultiShardState(seed, config);
  let popSum = 0, n = 0, carried = 0, arrived = 0, toDock = 0;
  for (let day = 0; day < DAYS; day++) {
    st = stepMultiShard(st);
    carried += st.lastVoucherSettlement.carried;
    arrived += st.lastVoucherSettlement.arrived;
    toDock += st.lastVoucherSettlement.toDock;
    if (day >= BURN_IN) {
      popSum += totalPopulation(st);
      n += 1;
    }
  }
  return { pop: popSum / n, shards: st.worlds.size, carried, arrived, toDock };
};
console.log(`Multi-shard, per seed (${DAYS} days):`);
const vouchers = { legacy: { carried: 0, arrived: 0, toDock: 0 }, funded: { carried: 0, arrived: 0, toDock: 0 } };
for (const seed of SEEDS) {
  const l = multiSeed({ ...DEFAULT_WORLD_CONFIG, settlement: 'legacy' }, seed);
  const fu = multiSeed(DEFAULT_WORLD_CONFIG, seed);
  for (const [k, r] of [['legacy', l], ['funded', fu]] as const) {
    vouchers[k].carried += r.carried;
    vouchers[k].arrived += r.arrived;
    vouchers[k].toDock += r.toDock;
  }
  console.log(`  seed ${seed}: legacy population ${f(l.pop, 1)} in ${l.shards} shards   funded population ${f(fu.pop, 1)} in ${fu.shards} shards`);
}
for (const k of ['legacy', 'funded'] as const) {
  const v = vouchers[k];
  console.log(`  vouchers ${k}: carried ${f(v.carried, 1)} = arrived ${f(v.arrived, 1)} + to source dock ${f(v.toDock, 1)}`);
}
