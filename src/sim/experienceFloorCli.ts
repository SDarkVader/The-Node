import { runExperienceFloorComparison } from './experienceFloorHarness.js';
import { DEFAULT_WORLD_CONFIG } from '../world/world.js';
import { EXPERIENCE_CAP } from '../engine/ecosystem.js';

const DAYS = 3000;
const BURN_IN = 300;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

console.log('Experience floor — real dip size, with vs without (see docs/HANDOVER.md).\n');

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

let withFloorTail: number[] = [];
let withoutFloorTail: number[] = [];
let withFloorFills: number[] = [];
let withoutFloorFills: number[] = [];
let withFloorHealthTail: number[] = [];
let withoutFloorHealthTail: number[] = [];

for (const seed of SEEDS) {
  const { withFloor, withoutFloor } = runExperienceFloorComparison(seed, DAYS, DEFAULT_WORLD_CONFIG);
  withFloorTail.push(...(withFloor.meanFilledExperience.slice(BURN_IN).filter((x): x is number => x !== undefined)));
  withoutFloorTail.push(...(withoutFloor.meanFilledExperience.slice(BURN_IN).filter((x): x is number => x !== undefined)));
  withFloorFills.push(...withFloor.fillFloorValues);
  withoutFloorFills.push(...withoutFloor.fillFloorValues);
  withFloorHealthTail.push(...withFloor.economicHealthWithExperienceSeries.slice(BURN_IN));
  withoutFloorHealthTail.push(...withoutFloor.economicHealthWithExperienceSeries.slice(BURN_IN));
}

const nonZeroFloorFills = withFloorFills.filter((v) => v > 0);

console.log(`Fill events measured (post-burn-in aggregate, ${SEEDS.length} seeds x ${DAYS} days):`);
console.log(`  total Miller/Baker fills: ${withFloorFills.length}`);
console.log(`  fills that landed a NON-ZERO floor: ${nonZeroFloorFills.length} (${((nonZeroFloorFills.length / Math.max(1, withFloorFills.length)) * 100).toFixed(1)}% of all fills)`);
console.log(`  mean starting experience, WITH floor: ${mean(withFloorFills).toFixed(4)} (of EXPERIENCE_CAP=${EXPERIENCE_CAP})`);
console.log(`  mean starting experience, WITHOUT floor: ${mean(withoutFloorFills).toFixed(4)}`);
console.log(`  mean starting experience among the fills that DID get a floor: ${mean(nonZeroFloorFills).toFixed(4)}`);
console.log('');

console.log('Steady-state mean Miller+Baker experience (FILLED slots, tail average):');
console.log(`  WITH floor:    ${mean(withFloorTail).toFixed(5)}`);
console.log(`  WITHOUT floor: ${mean(withoutFloorTail).toFixed(5)}`);
console.log(`  difference: ${(mean(withFloorTail) - mean(withoutFloorTail)).toFixed(5)} (${(((mean(withFloorTail) - mean(withoutFloorTail)) / mean(withoutFloorTail)) * 100).toFixed(2)}% relative)`);
console.log('');

console.log('Steady-state mean economicHealthWithExperience (tail average):');
console.log(`  WITH floor:    ${mean(withFloorHealthTail).toFixed(5)}`);
console.log(`  WITHOUT floor: ${mean(withoutFloorHealthTail).toFixed(5)}`);
console.log(`  difference: ${(mean(withFloorHealthTail) - mean(withoutFloorHealthTail)).toFixed(5)}`);
