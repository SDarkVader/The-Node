import { runCombinedEconomySim, tailMean } from './ecosystemHarness.js';

const DAYS = 2000;
const BURN_IN = 400;
const SEEDS = [1, 2, 3, 4, 5];

console.log('The two economic-health formulas, run together on one real trajectory (not validated in isolation).\n');

console.log('N\tehBaseline\tehWithExperience\tgap');
for (const [label, sabotageMode] of [
  ['baseline (no sabotage)', 'none'],
  ['fixed-success sabotage (original test\'s assumption: 3/3 always succeed)', 'fixed-success'],
  ['detection-driven sabotage (real sabotageAttempt() roll)', 'detection-driven'],
] as const) {
  let ehSum = 0;
  let ehExpSum = 0;
  for (const seed of SEEDS) {
    const r = runCombinedEconomySim({ seed, days: DAYS, sabotageMode });
    ehSum += tailMean(r.economicHealthSeries, BURN_IN);
    ehExpSum += tailMean(r.economicHealthWithExperienceSeries, BURN_IN);
  }
  const eh = ehSum / SEEDS.length;
  const ehExp = ehExpSum / SEEDS.length;
  console.log(`${label}\t${eh.toFixed(3)}\t\t${ehExp.toFixed(3)}\t\t\t${(ehExp - eh).toFixed(3)}`);
}

console.log('\nDetection-driven sabotage success rate at realistic witness counts:');
for (const seed of SEEDS) {
  const r = runCombinedEconomySim({ seed, days: DAYS, sabotageMode: 'detection-driven' });
  const rounds = r.sabotageRounds.filter((round) => round.day >= BURN_IN);
  const meanWitnesses = rounds.reduce((a, b) => a + b.witnesses, 0) / rounds.length;
  const meanSuccess = rounds.reduce((a, b) => a + b.successCount, 0) / rounds.length;
  console.log(`  seed=${seed}  avgWitnesses=${meanWitnesses.toFixed(1)}  avgSuccess/round=${meanSuccess.toFixed(2)}/3`);
}
