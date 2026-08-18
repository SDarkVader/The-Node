import { runEvictionProtectionComparison, realisticEventFrequency } from './evictionProtectionHarness.js';
import { DEFAULT_WORLD_CONFIG } from '../world/world.js';
import { ESTABLISHED_TENURE_DAYS } from './multiRoleConscription.js';

const DAYS = 3000;
const BURN_IN = 300;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

console.log('Eviction preference (occupantTenure/ESTABLISHED_TENURE_DAYS) — real load verification.\n');

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

console.log(`1. Does conscriptionFromOtherRole actually fire under DEFAULT_WORLD_CONFIG scale (M9 B9 C7 J7 D8 IE6, N=100)?`);
let totalOtherRole = 0;
let totalGrifterSourced = 0;
let totalEventsAll = 0;
for (const seed of SEEDS) {
  const tally = realisticEventFrequency(seed, DAYS);
  totalOtherRole += tally['conscriptionFromOtherRole'] ?? 0;
  totalGrifterSourced += tally['conscriptionFromGrifters'] ?? 0;
  totalEventsAll += Object.values(tally).reduce((a, b) => a + b, 0);
}
console.log(`   conscriptionFromOtherRole events: ${totalOtherRole} (across ${SEEDS.length} seeds x ${DAYS} days)`);
console.log(`   conscriptionFromGrifters events:  ${totalGrifterSourced}`);
console.log(`   -> ${totalOtherRole > 0 ? 'YES, the mechanism the preference touches fires under real load, not dead code.' : 'NO — this event type never fires at this scale; the preference would be inert.'}`);
console.log('');

console.log('2. Real, aggregate protective effect: mean daysInRole across all FILLED slots (all 6 roles), WITH vs WITHOUT the preference.');
let withTail: number[] = [];
let withoutTail: number[] = [];
let withHealthTail: number[] = [];
let withoutHealthTail: number[] = [];
let minAccountedFor = Infinity;
for (const seed of SEEDS) {
  const { withPreference, withoutPreference } = runEvictionProtectionComparison(seed, DAYS, DEFAULT_WORLD_CONFIG);
  withTail.push(...withPreference.meanFilledTenure.slice(BURN_IN).filter((x) => !Number.isNaN(x)));
  withoutTail.push(...withoutPreference.meanFilledTenure.slice(BURN_IN).filter((x) => !Number.isNaN(x)));
  withHealthTail.push(...withPreference.economicHealthSeries.slice(BURN_IN));
  withoutHealthTail.push(...withoutPreference.economicHealthSeries.slice(BURN_IN));
  minAccountedFor = Math.min(minAccountedFor, ...withPreference.totalAccountedFor, ...withoutPreference.totalAccountedFor);
}
const withMean = mean(withTail);
const withoutMean = mean(withoutTail);
console.log(`   steady-state mean daysInRole, WITH preference:    ${withMean.toFixed(2)} days`);
console.log(`   steady-state mean daysInRole, WITHOUT preference:  ${withoutMean.toFixed(2)} days`);
console.log(`   difference: ${(withMean - withoutMean).toFixed(2)} days (${(((withMean - withoutMean) / withoutMean) * 100).toFixed(2)}% relative)`);
console.log(`   ESTABLISHED_TENURE_DAYS = ${ESTABLISHED_TENURE_DAYS} (the threshold below which the preference applies)`);
console.log('');

console.log('3. Stability check: does the preference destabilize the economy or population accounting?');
console.log(`   steady-state mean economicHealth, WITH preference:    ${mean(withHealthTail).toFixed(5)}`);
console.log(`   steady-state mean economicHealth, WITHOUT preference: ${mean(withoutHealthTail).toFixed(5)}`);
console.log(`   difference: ${(mean(withHealthTail) - mean(withoutHealthTail)).toFixed(5)}`);
console.log(`   minimum (grifters + FILLED) ever observed across all runs: ${minAccountedFor} (never negative = no accounting break)`);
