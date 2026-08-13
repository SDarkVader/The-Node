import { runPatternSabotageSim } from './sabotagePatternHarness.js';
import { ARSON_STEPS_DEFAULT, ARSON_P_PER_WITNESS_DEFAULT, ARSON_DETECTIVE_BONUS_DEFAULT } from '../engine/arson.js';

const DAYS = 20000;
const BURN_IN = 2000;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

console.log('Arson — calibrated against the ~30% floor. See docs/BLUEPRINT.md and engine/arson.ts.\n');

function summarize(label: string, detectiveActive: boolean) {
  let totalCampaigns = 0;
  let totalSucceeded = 0;
  let successDays: number[] = [];

  for (const seed of SEEDS) {
    const r = runPatternSabotageSim({
      seed,
      days: DAYS,
      stepsRequired: ARSON_STEPS_DEFAULT,
      pPerWitness: ARSON_P_PER_WITNESS_DEFAULT,
      detectiveBonus: ARSON_DETECTIVE_BONUS_DEFAULT,
      detectiveActive,
    });
    const postBurnIn = r.campaigns.filter((c) => c.day >= BURN_IN);
    totalCampaigns += postBurnIn.length;
    totalSucceeded += postBurnIn.filter((c) => c.outcome === 'succeeded').length;

    let lastSuccessDay = BURN_IN;
    for (const c of postBurnIn) {
      if (c.outcome === 'succeeded') {
        successDays.push(c.day - lastSuccessDay);
        lastSuccessDay = c.day;
      }
    }
  }

  const successRate = totalSucceeded / Math.max(1, totalCampaigns);
  const meanDaysPerSuccess = successDays.length > 0 ? successDays.reduce((a, b) => a + b, 0) / successDays.length : NaN;

  console.log(label);
  console.log(`  campaigns=${totalCampaigns}  succeeded=${(successRate * 100).toFixed(1)}%`);
  console.log(`  mean days between successes: ${meanDaysPerSuccess.toFixed(0)}`);
  console.log('');
}

summarize('No Detective — ambient witnessing only', false);
summarize('With an active Detective investigating the campaign', true);
