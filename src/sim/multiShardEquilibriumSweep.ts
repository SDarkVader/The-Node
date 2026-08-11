import { DEFAULT_WORLD_CONFIG, type WorldConfig } from '../world/world.js';
import { createMultiShardState, stepMultiShard, totalPopulation, MIGRATION_FAILURE_RATE } from './multiShardHarness.js';

/**
 * What actually sets multi-shard equilibrium population (2026-08-11) — built to answer
 * the standing "population is only ~68% of target" concern, which turned out to be partly
 * a measurement artifact and partly a misreading of what "target" means. Two real findings
 * came out of it, both derived by instrumenting the actual flows rather than by tuning
 * constants until a number looked better.
 *
 * FINDING 1 — the equilibrium is exactly an inflow/outflow balance, and it is verifiable.
 * The ONLY population inflow in the whole system is `arrivalPDaily` per shard per day. The
 * ONLY outflow is a failed cross-shard migration (`migrationFailureRate` — a successful
 * migration conserves population exactly, and every other mechanic, churn/conscription/
 * district-merge, only ever moves people between roles and the grifter pool). So the whole
 * system must settle where:
 *
 *     arrivalPDaily x shardCount  ==  migrationFailureRate x emigrantsPerDay
 *
 * and population lands wherever `migrationValveStep` produces exactly that many emigrants.
 * Measured directly at the shipped defaults: 0.303 arrivals/day vs. 0.295 failures/day —
 * the accounting balances, confirming this is the governing relationship and not a guess.
 *
 * FINDING 2 — a real bifurcation, and the reason "just raise population" is not free.
 * BOTH obvious levers (raise `arrivalPDaily`, or lower `migrationFailureRate`) do raise
 * per-shard population — and both trigger unbounded shard proliferation past a critical
 * point, because a fuller shard satisfies `canOpenNewShard`'s population gate, and every
 * new shard adds its own `arrivalPDaily` inflow, which fills shards further. That is a
 * positive feedback loop on shard count. Measured (3000 days, 3 seeds):
 *
 *   arrivalPDaily 0.10 -> 3 shards | 0.15 -> 7 | 0.20 -> 31 | 0.30 -> 89 | 0.45 -> 100 (cooldown-capped)
 *   failureRate   0.15 -> 3 shards | 0.12 -> 3.3 | 0.10 -> 5.3 | 0.08 -> 10.3 | 0.06 -> 21 | 0.04 -> 42
 *
 * Below roughly `migrationFailureRate` 0.12 the system stops being a bounded world in
 * equilibrium and becomes an ever-growing one. Neither regime is "wrong" — a real game with
 * a growing playerbase *should* add shards — but they are different designs, and the
 * shipped configuration deliberately sits in the bounded one so the simulation has a stable
 * equilibrium to validate against at all.
 *
 * WHY NOTHING WAS RETUNED. At the shipped defaults the system settles at ~54.6 players per
 * shard, evenly across shards (no thin shard hidden in the mean — verified per-shard), with
 * economicHealth ~0.88 and a stable 3-shard registry. The brief's own stated range is
 * 50-80 players per shard, so ~54.6 is genuinely in spec — `targetPopulation=65` is the
 * midpoint of that band, not a floor the system is failing to reach. Tuning
 * `migrationFailureRate` to chase 65 would also be backwards: it is an explicit placeholder
 * for Import/Export's unbuilt legal/illegal route-detection mechanic, so its real value has
 * to come from that design, not from population balancing. This sweep exists so whoever
 * builds Import/Export can see exactly what their chosen detection rate will do to
 * equilibrium population and shard count before they pick it.
 */

const DAYS = 3000;
const BURN_IN = 500;
const SEEDS = [1, 2, 3];
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function run(failureRate: number, config: WorldConfig = DEFAULT_WORLD_CONFIG) {
  const pops: number[] = [];
  const healths: number[] = [];
  const shardCounts: number[] = [];
  const minShardPops: number[] = [];
  const arrivalRates: number[] = [];
  const failureRates: number[] = [];

  for (const seed of SEEDS) {
    let state = createMultiShardState(seed, config, failureRate);
    let arrivals = 0;
    for (let i = 1; i <= DAYS; i++) {
      state = stepMultiShard(state);
      arrivals += [...state.worlds.values()].reduce((s, w) => s + w.lastNewArrivals, 0);
      if (i >= BURN_IN) {
        const live = [...state.worlds.values()].filter((w) => w.population > 0);
        pops.push(totalPopulation(state) / state.registry.shards.length);
        healths.push(mean(live.map((w) => w.economicHealth)));
      }
    }
    shardCounts.push(state.registry.shards.length);
    minShardPops.push(Math.min(...[...state.worlds.values()].map((w) => w.population)));
    arrivalRates.push(arrivals / DAYS);
    failureRates.push(state.totalFailedMigrations / DAYS);
  }

  return {
    perShardPop: mean(pops),
    health: mean(healths),
    shards: mean(shardCounts),
    minShardPop: mean(minShardPops),
    arrivalsPerDay: mean(arrivalRates),
    failuresPerDay: mean(failureRates),
  };
}

console.log('Multi-shard equilibrium — what actually sets per-shard population.');
console.log(`DAYS=${DAYS} BURN_IN=${BURN_IN} SEEDS=${JSON.stringify(SEEDS)} target=${DEFAULT_WORLD_CONFIG.targetPopulation} (brief's range: 50-80)\n`);

console.log('=== migrationFailureRate sweep (arrivalPDaily held at the shipped 0.10) ===\n');
console.log('failRate  perShardPop  %target  inBriefBand  health  shards  minShardPop  arrivals/day  failures/day');
for (const rate of [0.15, 0.12, 0.1, 0.08, 0.06, 0.04]) {
  const r = run(rate);
  const inBand = r.perShardPop >= 50 && r.perShardPop <= 80 ? 'yes' : 'no';
  console.log(
    `${rate.toFixed(2).padStart(7)}  ${r.perShardPop.toFixed(1).padStart(10)}  ${((r.perShardPop / DEFAULT_WORLD_CONFIG.targetPopulation) * 100).toFixed(0).padStart(6)}%  ` +
      `${inBand.padStart(10)}  ${r.health.toFixed(3)}  ${r.shards.toFixed(1).padStart(5)}  ${r.minShardPop.toFixed(1).padStart(10)}  ` +
      `${r.arrivalsPerDay.toFixed(3).padStart(11)}  ${r.failuresPerDay.toFixed(3).padStart(11)}`,
  );
}

console.log('\n=== arrivalPDaily sweep (migrationFailureRate held at the shipped default) ===\n');
console.log('arrivalP  perShardPop  %target  inBriefBand  health  shards  arrivals/day  failures/day');
for (const arrivalPDaily of [0.1, 0.15, 0.2, 0.3]) {
  const r = run(MIGRATION_FAILURE_RATE, { ...DEFAULT_WORLD_CONFIG, arrivalPDaily });
  const inBand = r.perShardPop >= 50 && r.perShardPop <= 80 ? 'yes' : 'no';
  console.log(
    `${arrivalPDaily.toFixed(2).padStart(7)}  ${r.perShardPop.toFixed(1).padStart(10)}  ${((r.perShardPop / DEFAULT_WORLD_CONFIG.targetPopulation) * 100).toFixed(0).padStart(6)}%  ` +
      `${inBand.padStart(10)}  ${r.health.toFixed(3)}  ${r.shards.toFixed(1).padStart(5)}  ` +
      `${r.arrivalsPerDay.toFixed(3).padStart(11)}  ${r.failuresPerDay.toFixed(3).padStart(11)}`,
  );
}

console.log(
  '\nReading: arrivals/day and failures/day matching confirms the inflow/outflow balance is\n' +
    'what sets equilibrium. Shard count rising steeply as either lever is pushed is the\n' +
    'bifurcation into an unbounded-growth regime. See this file\'s header and\n' +
    "docs/BLUEPRINT.md's \"Multi-shard equilibrium\" entry for why nothing was retuned.",
);
