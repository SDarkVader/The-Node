import { runOracleSimulation } from './oracleHarness.js';
import { DEFAULT_WORLD_CONFIG } from '../world/world.js';

const DAYS = 3000;
const BURN_IN = 300;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

console.log('The Oracle — real win rate / prize mix / wealth impact under load (see docs/HANDOVER.md, docs/DESIGN_ORACLE_2026-08-13.md §5).\n');

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

let totalEntrants = 0;
let totalEntered = 0;
let totalWins = 0;
const winsByPrize = { wealth: 0, resourceStock: 0, time: 0 };
let observedWinProbabilities: number[] = [];
let theoreticalWinProbabilities: number[] = [];
let earlyGini: number[] = [];
let lateGini: number[] = [];
let earlyHealth: number[] = [];
let lateHealth: number[] = [];
let earlyPopulation: number[] = [];
let latePopulation: number[] = [];

for (const seed of SEEDS) {
  const result = runOracleSimulation(seed, DAYS, DEFAULT_WORLD_CONFIG);

  for (let day = BURN_IN; day < DAYS; day++) {
    const s = result.statsSeries[day]!;
    totalEntrants += s.entrants;
    totalEntered += s.entered;
    totalWins += s.wins;
    winsByPrize.wealth += s.winsByPrize.wealth;
    winsByPrize.resourceStock += s.winsByPrize.resourceStock;
    winsByPrize.time += s.winsByPrize.time;
    if (s.entered > 0) observedWinProbabilities.push(s.wins / s.entered);
    theoreticalWinProbabilities.push(result.winProbabilitySeries[day]!);
  }

  const firstTail = Math.min(BURN_IN, Math.floor(DAYS * 0.1));
  earlyGini.push(...result.wealthGiniSeries.slice(BURN_IN, BURN_IN + firstTail));
  lateGini.push(...result.wealthGiniSeries.slice(-firstTail));
  earlyHealth.push(...result.economicHealthWithExperienceSeries.slice(BURN_IN, BURN_IN + firstTail));
  lateHealth.push(...result.economicHealthWithExperienceSeries.slice(-firstTail));
  earlyPopulation.push(...result.populationSeries.slice(BURN_IN, BURN_IN + firstTail));
  latePopulation.push(...result.populationSeries.slice(-firstTail));
}

console.log(`Entry funnel (post-burn-in aggregate, ${SEEDS.length} seeds x ${DAYS - BURN_IN} days):`);
console.log(`  chose to participate (entrants): ${totalEntrants}`);
console.log(`  could afford entry (entered):    ${totalEntered} (${((totalEntered / Math.max(1, totalEntrants)) * 100).toFixed(1)}% of entrants)`);
console.log(`  won a prize:                     ${totalWins} (${((totalWins / Math.max(1, totalEntered)) * 100).toFixed(1)}% of entered)`);
console.log('');

console.log('Win rate — observed vs. theoretical (oracleWinProbability on the same pre-tick health):');
console.log(`  mean observed per-tick win rate (entered ticks only): ${(mean(observedWinProbabilities) * 100).toFixed(2)}%`);
console.log(`  mean theoretical win rate (health-linked curve):      ${(mean(theoreticalWinProbabilities) * 100).toFixed(2)}%`);
console.log(`  cf. exit-ticket gamble's own validated flat rate: ~28-30%`);
console.log('');

console.log('Prize mix among wins:');
for (const [type, count] of Object.entries(winsByPrize)) {
  console.log(`  ${type}: ${count} (${((count / Math.max(1, totalWins)) * 100).toFixed(1)}%)`);
}
console.log('');

console.log('No death-spiral check — early vs. late tail, same run (should stay stable, not diverge):');
console.log(`  wealthGini:                    early ${mean(earlyGini).toFixed(4)}  ->  late ${mean(lateGini).toFixed(4)}`);
console.log(`  economicHealthWithExperience:  early ${mean(earlyHealth).toFixed(4)}  ->  late ${mean(lateHealth).toFixed(4)}`);
console.log(`  population:                    early ${mean(earlyPopulation).toFixed(2)}  ->  late ${mean(latePopulation).toFixed(2)}`);
