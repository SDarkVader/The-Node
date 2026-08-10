import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type WorldConfig } from '../world/world.js';

/**
 * Data for a decision this project has explicitly NOT made — not a recommendation.
 *
 * The Phase B population-drain finding (docs/BLUEPRINT.md's "Phase B" entry) traced a
 * bug in this file's own first-draft default to an inconsistency with ecosystem.ts's
 * S_DEFAULT=24, and fixed that inconsistency. It did NOT resolve the separately-flagged,
 * still-open question of what the real role-slot-to-population ratio should be once a
 * revised role roster exists (docs/HANDOVER.md: "a revised role roster needs to specify
 * how many distinct roles exist per shard... how many slots per role... what fraction of N
 * those slots are meant to occupy"). That is explicitly the user's own decision, not
 * something to silently pick a "final" number for here.
 *
 * What this script does instead: runs the real, composed kernel across a range of
 * candidate (rMiller, rBaker, targetPopulation) combinations and reports where population
 * and economic health actually settle for each — real simulated outcomes, not a guess, so
 * that decision can be made by looking at consequences rather than picking a ratio in the
 * abstract. Does not change DEFAULT_WORLD_CONFIG or recommend one row over another.
 */

const DAYS = 2000;
const BURN_IN = 400;
const SEEDS = [1, 2, 3];

interface Candidate {
  label: string;
  rMiller: number;
  rBaker: number;
  targetPopulation: number;
}

const CANDIDATES: Candidate[] = [
  { label: 'current default (S=24 of N=65, ~63% roleless)', rMiller: 8, rBaker: 16, targetPopulation: 65 },
  { label: 'this file\'s own original first-draft mistake, for comparison (S=8 of N=65, ~88% roleless)', rMiller: 3, rBaker: 5, targetPopulation: 65 },
  { label: 'brief\'s literal §1.5 ~1/3 role-holding (rejected 2026-08-07 by the user — kept only as a reference point)', rMiller: 8, rBaker: 14, targetPopulation: 65 },
  { label: 'a denser role-holding shard (S=32 of N=65, ~51% roleless)', rMiller: 12, rBaker: 20, targetPopulation: 65 },
  { label: 'S=24 at the brief\'s lower population bound (N=50, ~52% roleless)', rMiller: 8, rBaker: 16, targetPopulation: 50 },
  { label: 'S=24 at the brief\'s upper population bound (N=80, ~70% roleless)', rMiller: 8, rBaker: 16, targetPopulation: 80 },
];

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

console.log('Role-ratio sweep — real simulated outcomes, not a recommendation. See this file\'s header comment.\n');
console.log('label\tmeanPop\tpopRange\tmeanHealth\tminHealth\tmeanFlour');

for (const candidate of CANDIDATES) {
  const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, rMiller: candidate.rMiller, rBaker: candidate.rBaker, targetPopulation: candidate.targetPopulation };

  const allPops: number[] = [];
  const allHealth: number[] = [];
  const allFlour: number[] = [];

  for (const seed of SEEDS) {
    let world = createWorld(seed, config);
    for (let i = 0; i < DAYS; i++) {
      world = stepWorld(world);
      if (i >= BURN_IN) {
        allPops.push(world.population);
        allHealth.push(world.economicHealth);
        allFlour.push(world.flourPrice);
      }
    }
  }

  console.log(
    `${candidate.label}\n  meanPop=${mean(allPops).toFixed(1)} range=${Math.min(...allPops)}-${Math.max(...allPops)}  meanHealth=${mean(allHealth).toFixed(3)} minHealth=${Math.min(...allHealth).toFixed(3)}  meanFlour=${mean(allFlour).toFixed(3)}`,
  );
}

console.log(
  '\nNot a recommendation — this only shows what each ratio actually does once run for real.\n' +
    'The Observatory (Phase E, not built yet) is where this becomes something you can watch\n' +
    'happen rather than read as a table.',
);
