import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type WorldConfig } from '../world/world.js';
import { giniCoefficient, topShare } from '../engine/wealth.js';

/**
 * Baseline finding + remediation sweep for the wealth-inequality question — data, not a
 * shipped default (matches this repo's existing pattern for the sabotage-pattern and
 * role-ratio proposals). See docs/BLUEPRINT.md's "Wealth inequality" entry for the full
 * writeup and research citations.
 *
 * IMPORTANT INTERPRETIVE CAVEAT, checked below rather than assumed: this is a pure
 * accumulation model — wealth only ever grows (no spending, no decay) except through the
 * remediation mechanisms below. That means Gini measured over a population with staggered
 * "join dates" (churn, conscription, sabotage evictions and re-fills) will tend to rise
 * over time even if everyone's underlying DAILY EARNING RATE were identical, purely
 * because veterans have had more days to accumulate than newcomers. This is a distinct
 * mechanism from the yard-sale literature's proportional-transfer condensation — both can
 * push Gini up, but only one of them means "the market itself favors whoever's already
 * ahead." The report below checks trajectory shape (still climbing vs. plateaued) and
 * separates Miller from Baker to help tell the two apart, rather than reporting one final
 * number and assuming it means condensation.
 */

const SEEDS = [1, 2, 3];

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function runBaseline(days: number, checkpoints: number[]) {
  console.log(`\n=== Baseline (no remediation), ${days} days, seeds ${SEEDS.join(',')} ===`);
  console.log('tick\tmeanGini\tmeanTop10Share\tmeanMillerWealth\tmeanBakerWealth');

  for (const checkpoint of checkpoints) {
    const ginis: number[] = [];
    const top10s: number[] = [];
    const millerWealths: number[] = [];
    const bakerWealths: number[] = [];

    for (const seed of SEEDS) {
      let world = createWorld(seed);
      for (let i = 0; i < checkpoint; i++) world = stepWorld(world);
      ginis.push(world.wealthGini);
      top10s.push(world.wealthTop10Share);
      const filledMillers = world.millers.filter((m) => m.slot.state === 'FILLED');
      const filledBakers = world.bakers.filter((b) => b.slot.state === 'FILLED');
      if (filledMillers.length > 0) millerWealths.push(mean(filledMillers.map((m) => m.wealth)));
      if (filledBakers.length > 0) bakerWealths.push(mean(filledBakers.map((b) => b.wealth)));
    }

    console.log(
      `${checkpoint}\t${mean(ginis).toFixed(3)}\t\t${(mean(top10s) * 100).toFixed(1)}%\t\t${mean(millerWealths).toFixed(2)}\t\t\t${mean(bakerWealths).toFixed(2)}`,
    );
  }
}

function runRemediationSweep(days: number) {
  console.log(`\n=== Remediation sweep, ${days} days, seeds ${SEEDS.join(',')} ===`);
  console.log('mechanism\tmeanGini\tmeanTop10Share\tmeanFinalWealth(combined)');

  const configs: { label: string; overrides: Partial<WorldConfig> }[] = [
    { label: 'baseline (no remediation)', overrides: {} },
    { label: 'daily tax 10%, redistributed', overrides: { wealthTaxRate: 0.1 } },
    { label: 'daily tax 30%, redistributed', overrides: { wealthTaxRate: 0.3 } },
    { label: 'daily tax 50%, redistributed', overrides: { wealthTaxRate: 0.5 } },
    { label: 'daily tax 80%, redistributed', overrides: { wealthTaxRate: 0.8 } },
    { label: 'wealth cap = 20', overrides: { wealthCap: 20 } },
    { label: 'wealth cap = 5', overrides: { wealthCap: 5 } },
    { label: 'tax 30% + cap 20 (combined)', overrides: { wealthTaxRate: 0.3, wealthCap: 20 } },
  ];

  for (const { label, overrides } of configs) {
    const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, ...overrides };
    const ginis: number[] = [];
    const top10s: number[] = [];
    const finalWealths: number[] = [];

    for (const seed of SEEDS) {
      let world = createWorld(seed, config);
      for (let i = 0; i < days; i++) world = stepWorld(world);
      ginis.push(world.wealthGini);
      top10s.push(world.wealthTop10Share);
      const combined = [...world.millers, ...world.bakers].filter((s) => s.slot.state === 'FILLED');
      finalWealths.push(mean(combined.map((s) => s.wealth)));
    }

    console.log(`${label}\t${mean(ginis).toFixed(3)}\t\t${(mean(top10s) * 100).toFixed(1)}%\t\t${mean(finalWealths).toFixed(2)}`);
  }
}

function runWithinRoleBreakdown(days: number) {
  console.log(`\n=== Within-role vs. combined Gini (does inequality come from role or from luck?), ${days} days ===`);
  console.log('seed\tcombinedGini\tmillerOnlyGini\tbakerOnlyGini\tmeanMillerWealth\tmeanBakerWealth\tbakerToMillerRatio');

  for (const seed of SEEDS) {
    let world = createWorld(seed);
    for (let i = 0; i < days; i++) world = stepWorld(world);
    const filledMillers = world.millers.filter((m) => m.slot.state === 'FILLED').map((m) => m.wealth);
    const filledBakers = world.bakers.filter((b) => b.slot.state === 'FILLED').map((b) => b.wealth);
    const combined = [...filledMillers, ...filledBakers];

    const meanMiller = mean(filledMillers);
    const meanBaker = mean(filledBakers);

    console.log(
      `${seed}\t${giniCoefficient(combined).toFixed(3)}\t\t${giniCoefficient(filledMillers).toFixed(3)}\t\t${giniCoefficient(filledBakers).toFixed(3)}\t\t${meanMiller.toFixed(2)}\t\t\t${meanBaker.toFixed(2)}\t\t\t${(meanBaker / meanMiller).toFixed(1)}x`,
    );
  }
}

console.log('Wealth inequality — baseline finding + remediation sweep. Data, not a shipped default.');
console.log('See docs/BLUEPRINT.md\'s "Wealth inequality" entry for citations and the full trail.');

runBaseline(3000, [100, 300, 600, 1200, 2000, 3000]);
runWithinRoleBreakdown(2000);
runRemediationSweep(2000);
