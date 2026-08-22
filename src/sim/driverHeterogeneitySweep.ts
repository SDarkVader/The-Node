import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World } from '../world/world.js';
import { applyDriverTick } from './playtestDrivers.js';
import { mulberry32 } from './rng.js';

/**
 * Measures whether per-agent driver dispositions (`drivers/heterogeneity.ts`, 2026-08-22)
 * actually change anything, rather than assuming they do. Directly answers the user's own
 * diagnosis: a long run showed a Gini coefficient that "barely moved" and looked like "100%
 * compliance" — the hypothesis is that every agent of a driver strategy sharing one literal
 * set of constants (500 "honest" agents = 500 copies of one coin) is the actual mechanism
 * behind that flatness, not the market maths. This sweep runs the SAME world, SAME seeds,
 * SAME days, with only `applyDriverTick`'s `heterogeneous` option flipped, and reports real
 * numbers for both conditions side by side.
 *
 * Two distinct things are measured, because "the economy is flat" could mean either:
 *   - CROSS-SEED spread at a fixed day: does changing the world's seed produce a
 *     meaningfully different outcome at all, or does every seed converge to the same number?
 *   - WITHIN-RUN day-to-day movement over the back half of a run: once a single run has
 *     settled, does Gini keep drifting day to day, or does it sit dead flat once reached?
 *     This is the one the user's own "barely moved" complaint is actually about.
 *
 * Driver actions are queued via `applyDriverTick` BEFORE each `stepWorld` call, exactly as
 * `playtestDrivers.ts` documents its own calling convention.
 */

const SEEDS = [1, 2, 3, 4, 5];
const DAYS = 3000; // same scale as the Oracle validation's own 3000-day run (see docs/BLUEPRINT.md)
const WITHIN_RUN_WINDOW = 500; // last 500 days of the run, once things have settled

interface RunResult {
  giniAtCheckpoints: number[];
  giniTail: number[]; // one entry per day, last WITHIN_RUN_WINDOW days
}

function runOne(seed: number, heterogeneous: boolean, checkpointDays: number[]): RunResult {
  let world: World = createWorld(seed, DEFAULT_WORLD_CONFIG);
  const driverRng = mulberry32(seed * 97 + 1); // separate stream from world.rng, per playtestDrivers' own contract
  const giniAtCheckpoints: number[] = [];
  const giniTail: number[] = [];
  const checkpointSet = new Set(checkpointDays);

  for (let day = 1; day <= DAYS; day++) {
    const { world: withDrivers } = applyDriverTick(world, driverRng, { heterogeneous });
    world = stepWorld(withDrivers);
    if (checkpointSet.has(day)) giniAtCheckpoints.push(world.wealthGini);
    if (day > DAYS - WITHIN_RUN_WINDOW) giniTail.push(world.wealthGini);
  }

  return { giniAtCheckpoints, giniTail };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function main() {
  const checkpointDays = [500, 1000, 1500, 2000, 2500, 3000];

  console.log(`Driver heterogeneity sweep — seeds ${SEEDS.join(',')}, ${DAYS} days each, both conditions.\n`);

  for (const heterogeneous of [false, true]) {
    const label = heterogeneous ? 'HETEROGENEOUS (per-agent sampled dispositions)' : 'HOMOGENEOUS (today\'s shared constants)';
    console.log(`=== ${label} ===`);

    const results = SEEDS.map((seed) => runOne(seed, heterogeneous, checkpointDays));

    console.log('checkpoint day\tmean Gini (across seeds)\tcross-seed stddev');
    checkpointDays.forEach((day, i) => {
      const atDay = results.map((r) => r.giniAtCheckpoints[i]!);
      console.log(`${day}\t\t${mean(atDay).toFixed(4)}\t\t\t\t${stddev(atDay).toFixed(4)}`);
    });

    const tailStddevs = results.map((r) => stddev(r.giniTail));
    const tailRanges = results.map((r) => Math.max(...r.giniTail) - Math.min(...r.giniTail));
    console.log(
      `\nWithin-run day-to-day movement, last ${WITHIN_RUN_WINDOW} days, averaged across seeds:` +
        `\n  mean per-seed stddev of daily Gini = ${mean(tailStddevs).toFixed(5)}` +
        `\n  mean per-seed (max-min) range      = ${mean(tailRanges).toFixed(5)}`,
    );
    console.log();
  }
}

main();
