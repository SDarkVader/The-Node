import { runLevelTwoReachability } from './levelTwoReachabilityHarness.js';

const DAYS = 800; // matches the 2026-08-13 measurement's own run length
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

console.log('The level-2 reputation gate ("the level-2 trap") — WITH vs WITHOUT the 2026-08-18 Shift Cover priority fix.\n');

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function summarize(useNewOrdering: boolean) {
  let totalLevel2 = 0;
  let daysAtLevelOne: number[] = [];
  let level0Covers = 0;
  let totalCovers = 0;
  for (const seed of SEEDS) {
    const r = runLevelTwoReachability(seed, DAYS, useNewOrdering);
    totalLevel2 += r.everReachedLevel2.size;
    daysAtLevelOne.push(...r.daysAtLevelOneBeforeRemoval);
    level0Covers += r.level0CoversCredited;
    totalCovers += r.totalCoversCredited;
  }
  return { totalLevel2, meanDaysAtLevelOne: mean(daysAtLevelOne), trapEvents: daysAtLevelOne.length, level0CoverShare: level0Covers / Math.max(1, totalCovers) };
}

const before = summarize(false);
const after = summarize(true);

console.log(`Distinct grifters reaching level 2 (${SEEDS.length} seeds x ${DAYS} days):`);
console.log(`  WITHOUT the fix (original wealth-only Shift Cover order): ${before.totalLevel2}`);
console.log(`  WITH the fix (racing-grifter priority):                   ${after.totalLevel2}`);
console.log(`  change: ${after.totalLevel2 - before.totalLevel2} (${(((after.totalLevel2 - before.totalLevel2) / Math.max(1, before.totalLevel2)) * 100).toFixed(1)}% relative)`);
console.log('');

console.log(`"Trap" events (removed while stuck at level 1, never reaching level 2) and mean days spent at level>=1 first:`);
console.log(`  WITHOUT: ${before.trapEvents} events, mean ${before.meanDaysAtLevelOne.toFixed(2)} days at level 1 before removal`);
console.log(`  WITH:    ${after.trapEvents} events, mean ${after.meanDaysAtLevelOne.toFixed(2)} days at level 1 before removal`);
console.log('');

console.log(`Safety check — share of ALL Shift Cover completions credited to level-0 grifters (never fully starved of practice):`);
console.log(`  WITHOUT: ${(before.level0CoverShare * 100).toFixed(1)}%`);
console.log(`  WITH:    ${(after.level0CoverShare * 100).toFixed(1)}%`);
