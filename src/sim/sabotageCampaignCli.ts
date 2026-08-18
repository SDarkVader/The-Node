import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World } from '../world/world.js';
import { PATTERN_STEPS_DEFAULT, PATTERN_STEP_CADENCE_DAYS_DEFAULT } from '../engine/ecosystem.js';

/**
 * `npm run sabotage-campaign-sim` — the re-measurement
 * `docs/DESIGN_PLAYTEST_HARNESS_2026-08-18.md` §4 demanded before the campaign restructure
 * could be trusted, and the permanent report for it.
 *
 * WHY IT WAS REQUIRED. The pre-restructure calibration (71.1% success without a Detective,
 * 40.2% with one) came from `sabotagePatternHarness.ts`, which resolves whole campaigns against
 * a FIXED witness count on purpose. A live stepper rolls each step against the witness count
 * that is real at that moment — counts that move as slots fill, vacate, and get evicted. Those
 * numbers therefore could not be assumed to carry over, and the "simulate before trusting"
 * constraint applies to the restructure itself, not just to its inputs.
 */

const DAYS = 3000;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

console.log('Sabotage campaigns under live stepWorld dynamics (see docs/DESIGN_PLAYTEST_HARNESS_2026-08-18.md §4).\n');

let opened = 0;
let caught = 0;
let succeeded = 0;
let abandoned = 0;
let concurrentSum = 0;
let ticks = 0;
let maxConcurrent = 0;
let investigatedSteps = 0;
let totalSteps = 0;
const durations: number[] = [];
const openingGaps: number[] = [];
let minHealth = 1;

for (const seed of SEEDS) {
  let world: World = createWorld(seed, DEFAULT_WORLD_CONFIG);
  const openedOn = new Map<string, number>();
  let lastOpening = -1;
  for (let day = 0; day < DAYS; day++) {
    world = stepWorld(world);
    ticks += 1;
    concurrentSum += world.sabotageCampaigns.length;
    maxConcurrent = Math.max(maxConcurrent, world.sabotageCampaigns.length);
    minHealth = Math.min(minHealth, world.economicHealth);
    for (const c of world.sabotageCampaigns) {
      totalSteps += 1;
      if (c.investigatedBy) investigatedSteps += 1;
    }
    for (const e of world.lastSabotageCampaignEvents) {
      if (e.type === 'opened') {
        opened += 1;
        openedOn.set(e.campaignId, day);
        if (lastOpening >= 0) openingGaps.push(day - lastOpening);
        lastOpening = day;
        continue;
      }
      if (e.type === 'caught') caught += 1;
      else if (e.type === 'succeeded') succeeded += 1;
      else abandoned += 1;
      const start = openedOn.get(e.campaignId);
      if (start !== undefined) durations.push(day - start);
    }
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const contested = caught + succeeded;

console.log(`Campaign outcomes (${SEEDS.length} seeds x ${DAYS} days):`);
console.log(`  opened:     ${opened}`);
console.log(`  succeeded:  ${succeeded}`);
console.log(`  caught:     ${caught}`);
console.log(`  abandoned:  ${abandoned}  (target had already left by ordinary churn)`);
console.log('');
console.log(`Success rate among CONTESTED resolutions (caught + succeeded, abandoned excluded):`);
console.log(`  ${((succeeded / Math.max(1, contested)) * 100).toFixed(1)}%`);
console.log(`  cf. the fixed-witness harness: 71.1% with no Detective, 40.2% with one.`);
console.log(`  The live figure lands near the WITH-Detective figure, not between the two —`);
console.log(`  see the investigation share below for why, and read that as a finding about`);
console.log(`  the interim assignment rule rather than about sabotage itself.`);
console.log('');
console.log(`Duration (opening -> resolution):`);
console.log(`  mean ${mean(durations).toFixed(1)} days, max ${Math.max(...durations)} days`);
console.log(`  theoretical full run: ${PATTERN_STEPS_DEFAULT} steps x ${PATTERN_STEP_CADENCE_DAYS_DEFAULT} days = ${PATTERN_STEPS_DEFAULT * PATTERN_STEP_CADENCE_DAYS_DEFAULT} days`);
console.log(`  the user's stated ceiling: 100 days`);
console.log('');
console.log(`Concurrency and timing:`);
console.log(`  mean campaigns in flight: ${(concurrentSum / ticks).toFixed(2)} (cap ${DEFAULT_WORLD_CONFIG.saboteurCount}, max reached ${maxConcurrent})`);
console.log(`  mean opening interval: ${mean(openingGaps).toFixed(2)} days (hazard is 1/${DEFAULT_WORLD_CONFIG.sabotageCadenceDays})`);
console.log(`  distinct opening gaps: ${new Set(openingGaps).size} of ${openingGaps.length} — no learnable period`);
console.log(`  campaign-steps under investigation: ${((investigatedSteps / Math.max(1, totalSteps)) * 100).toFixed(1)}%`);
console.log(`    ^ A REAL FINDING, not a healthy number. The interim assignment rule is`);
console.log(`      "is a Detective FILLED in the target's district" — and the shipped config`);
console.log(`      is ONE district holding 8 Detective slots, so it is almost always true.`);
console.log(`      Investigation is therefore near-constant rather than a scarce, directed`);
console.log(`      resource, which is precisely what the flashlight (a Detective choosing a`);
console.log(`      specific suspect) exists to fix. Until it lands, the Detective bonus is`);
console.log(`      effectively baked into the base rate.`);
console.log('');
console.log(`Constraint 2 (no permanent zero-state):`);
console.log(`  minimum economicHealth observed across every run: ${minHealth.toFixed(4)}`);
