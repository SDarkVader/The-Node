import { runIdentityResolutionSweep, summarizeByClassification, SYNTHETIC_POST_PROBABILITY } from './identityResolutionHarness.js';

/**
 * Answers the 2026-08-11 Design Addendum's own "report back explicitly on" question: does
 * identity resolution produce a meaningful core-vs-periphery difference in how fast players
 * become known, or is the effect too small to feel? Data, not a shipped default — see
 * `identityResolutionHarness.ts`'s header for the synthetic Wall-posting driver this measures
 * against, and why it's flagged as measurement-only.
 */

const DAYS = 120;
const SEEDS = [1, 2, 3, 4, 5];

console.log(`Identity resolution: core vs periphery, ${DAYS} days, synthetic post probability ${SYNTHETIC_POST_PROBABILITY}.\n`);
console.log('seed\tcore n\tcore resolved\tcore meanDay\tperiphery n\tperiphery resolved\tperiphery meanDay');

const coreMeans: number[] = [];
const peripheryMeans: number[] = [];

for (const seed of SEEDS) {
  const results = runIdentityResolutionSweep(seed, DAYS);
  const core = summarizeByClassification(results, 'core');
  const periphery = summarizeByClassification(results, 'periphery');
  if (core.meanResolvedDay !== null) coreMeans.push(core.meanResolvedDay);
  if (periphery.meanResolvedDay !== null) peripheryMeans.push(periphery.meanResolvedDay);
  console.log(
    `${seed}\t${core.count}\t${core.resolvedCount} (${(core.resolvedFraction * 100).toFixed(0)}%)\t${core.meanResolvedDay?.toFixed(1) ?? 'n/a'}` +
      `\t\t${periphery.count}\t${periphery.resolvedCount} (${(periphery.resolvedFraction * 100).toFixed(0)}%)\t\t\t${periphery.meanResolvedDay?.toFixed(1) ?? 'n/a'}`,
  );
}

const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
const coreMean = mean(coreMeans);
const peripheryMean = mean(peripheryMeans);

const gapPct = ((peripheryMean - coreMean) / coreMean) * 100;
console.log(`\nAveraged across ${SEEDS.length} seeds: core meanDay=${coreMean.toFixed(1)}, periphery meanDay=${peripheryMean.toFixed(1)}.`);
console.log(`Periphery subjects take ${gapPct.toFixed(0)}% longer to resolve than core subjects, on average.`);
console.log(
  Math.abs(gapPct) < 10
    ? '\nAs of 2026-08-13 (targetPopulation=100, DEFAULT_SHARD_CONFIG building counts scaled up alongside it) this gap\n' +
        'is gone — the ~35% gap measured 2026-08-12 at the pop=65 config did not survive the building-count scaling.\n' +
        'coreSpacing/peripherySpacing (the actual density knob) were not part of that re-derivation, only building\n' +
        'COUNT scaled, which apparently raised absolute density in both classifications and closed most of the\n' +
        'relative gap between them. Flagged, not silently accepted — see test/identityResolutionHarness.test.ts.'
    : '\nNoisy per-seed (one seed out of five can reverse the direction — see the per-seed table above), but the\n' +
        'multi-seed average confirms identity.ts\'s own prediction: the density gradient (coreSpacing vs\n' +
        'peripherySpacing) produces a real, not-too-small-to-feel gap in how fast a role-holder becomes known,\n' +
        'not just a directional tendency.',
);
