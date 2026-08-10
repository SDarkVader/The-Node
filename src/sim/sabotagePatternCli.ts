import { runPatternSabotageSim } from './sabotagePatternHarness.js';
import { tailMean } from './ecosystemHarness.js';

const DAYS = 20000;
const BURN_IN = 2000;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

console.log('Pattern-based sabotage PROPOSAL — not the shipped default. See docs/BLUEPRINT.md.\n');

function summarize(label: string, detectiveActive: boolean, campaignCount = 1) {
  let totalCampaigns = 0;
  let totalCaught = 0;
  let totalSucceeded = 0;
  let successDays: number[] = [];
  let healthSum = 0;
  let healthCount = 0;
  let healthMin = 1;

  for (const seed of SEEDS) {
    const r = runPatternSabotageSim({ seed, days: DAYS, detectiveActive, campaignCount });
    const postBurnIn = r.campaigns.filter((c) => c.day >= BURN_IN);
    totalCampaigns += postBurnIn.length;
    totalCaught += postBurnIn.filter((c) => c.outcome === 'caught').length;
    totalSucceeded += postBurnIn.filter((c) => c.outcome === 'succeeded').length;

    let lastSuccessDay = BURN_IN;
    for (const c of postBurnIn) {
      if (c.outcome === 'succeeded') {
        successDays.push(c.day - lastSuccessDay);
        lastSuccessDay = c.day;
      }
    }

    const tailSeries = r.economicHealthSeries.slice(BURN_IN);
    healthSum += tailMean(r.economicHealthSeries, BURN_IN) * tailSeries.length;
    healthCount += tailSeries.length;
    healthMin = Math.min(healthMin, Math.min(...tailSeries));
  }

  const catchRate = totalCaught / Math.max(1, totalCampaigns);
  const successRate = totalSucceeded / Math.max(1, totalCampaigns);
  const meanDaysPerSuccess = successDays.length > 0 ? successDays.reduce((a, b) => a + b, 0) / successDays.length : NaN;
  const meanHealth = healthSum / healthCount;

  console.log(`${label}`);
  console.log(`  campaigns=${totalCampaigns}  caught=${(catchRate * 100).toFixed(1)}%  succeeded=${(successRate * 100).toFixed(1)}%`);
  console.log(`  mean days between successes (attacker time investment): ${meanDaysPerSuccess.toFixed(0)}`);
  console.log(`  mean economicHealth (tail): ${meanHealth.toFixed(3)}  min economicHealth (tail): ${healthMin.toFixed(3)}`);
  console.log('');
}

summarize('No Detective — ambient witnessing only, N=50, S=24, healthy shard, 1 attacker', false);
summarize('With an active Detective investigating the campaign, 1 attacker', true);
summarize('Constraint-2 stress test: 4 concurrent attackers, no Detective', false, 4);
summarize('Constraint-2 stress test: 4 concurrent attackers, with a Detective', true, 4);
