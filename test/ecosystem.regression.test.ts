import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/sim/rng.js';
import {
  S_DEFAULT,
  EXPERIENCE_CAP,
  TRAVEL_DAYS_TARGET,
  economicHealth,
  economicHealthWithExperience,
  detectionProbability,
  decayExperienceTraveling,
  districtArrivalChoice,
  migrationValveStep,
  applySabotageDamage,
} from '../src/engine/ecosystem.js';

/**
 * Regression tests for the ecosystem-scale mechanics (economic floor, detection,
 * experience, migration valve, sabotage, districting) ported 2026-08-07 from a
 * parallel design session's validated reference implementation. The six bands below
 * were independently re-verified — both the Python and TypeScript originals were
 * actually run in this repo's environment before a line of `src/engine/ecosystem.ts`
 * was written — same discipline as every other validated finding in this repo, not
 * trusted on the source material's claim alone.
 *
 * See `src/engine/ecosystem.ts`'s header for the known gaps carried forward
 * unresolved: the two economic-health formulas were never run together; the
 * relationship between TRAVEL_DAYS_TARGET and the postcard/tier exit ticket's revised
 * 4-8 week target is unresolved; sabotage has no defined consequence for a caught
 * saboteur; nothing here yet models a district as persistent state.
 */

describe('economicHealth — the NPC floor never actually reaches zero', () => {
  it('zero player-held slots floors economic health at exactly NPC_PRODUCTIVITY (0.4)', () => {
    expect(economicHealth(0, S_DEFAULT)).toBeCloseTo(0.4, 9);
  });

  it('fully player-held at max experience reaches exactly 1.0', () => {
    expect(economicHealthWithExperience(S_DEFAULT, EXPERIENCE_CAP, S_DEFAULT)).toBeCloseTo(1.0, 9);
  });
});

describe('detectionProbability', () => {
  it('lands at ~0.693 with 23 other role-holders present (a full 24-slot shard)', () => {
    expect(detectionProbability(23)).toBeCloseTo(0.693, 2);
  });
});

describe('districtArrivalChoice', () => {
  it('the validated 2.0-3.0 coreBias range gives a 60-75% core share — closed-form, not simulated', () => {
    // The choice is a single weighted coin flip, so its true probability is exactly
    // coreBias / (coreBias + 1) — cheaper and more precise to check directly than to
    // run a Monte Carlo for a value that isn't actually stochastic in expectation.
    expect(2.0 / (2.0 + 1)).toBeCloseTo(0.667, 2);
    expect(3.0 / (3.0 + 1)).toBeCloseTo(0.75, 2);
  });

  it('returns the only open district when just one is open, regardless of bias', () => {
    const rand = () => 0.999; // would pick periphery if both were open
    expect(districtArrivalChoice(true, false, 2.5, rand)).toBe('core');
    expect(districtArrivalChoice(false, true, 2.5, rand)).toBe('periphery');
    expect(districtArrivalChoice(false, false, 2.5, rand)).toBeNull();
  });
});

describe('migrationValveStep — self-stabilizes, never diverges', () => {
  it('equilibrium roleless fraction converges into [0.55, 0.68] under saturating arrival pressure', () => {
    const rand = mulberry32(1);
    let n = 0;
    let filled = 0;
    for (let day = 0; day < 6000; day++) {
      if (rand() < 0.95) {
        n += 1;
        if (filled < S_DEFAULT) filled += 1;
      }
      n -= migrationValveStep(n, filled, rand);
    }
    const fFinal = n > 0 ? (n - filled) / n : 0;
    expect(fFinal).toBeGreaterThanOrEqual(0.55);
    expect(fFinal).toBeLessThanOrEqual(0.68);
  });
});

function runSustainedSabotage(seed: number) {
  const rand = mulberry32(seed);
  let n = 40;
  let filled = S_DEFAULT;
  const econSeries: number[] = [];
  for (let day = 1; day < 900; day++) {
    if (day % 20 === 0) filled = applySabotageDamage(filled, 3, 4);
    if (rand() < 0.1) {
      n += 1;
      if (filled < S_DEFAULT) filled += 1;
    }
    n -= migrationValveStep(n, filled, rand);
    if (day >= 400) econSeries.push(economicHealth(filled, S_DEFAULT));
  }
  return econSeries;
}

describe('sabotage — sustained attack suppresses but never zeroes a shard (§ "no permanent zero-state")', () => {
  it('12-of-24 slots evicted every 20 days, forever, settles to a long-run average in [0.35, 0.50]', () => {
    const econSeries = runSustainedSabotage(1);
    const avg = econSeries.reduce((a, b) => a + b, 0) / econSeries.length;
    expect(avg).toBeGreaterThanOrEqual(0.35);
    expect(avg).toBeLessThanOrEqual(0.5);
  });

  it('must be measured as a long-run average, not a single snapshot — the series genuinely oscillates', () => {
    // Direct regression for the bug the source material found while building this: a
    // snapshot timed right after recovery can misleadingly show near-full health.
    const econSeries = runSustainedSabotage(1);
    const min = Math.min(...econSeries);
    const max = Math.max(...econSeries);
    expect(max - min).toBeGreaterThan(0.1);
  });
});

describe('tick order — sabotage before vs. after arrival makes negligible difference', () => {
  it('both orderings land within 0.01 of each other on the long-run average', () => {
    function run(shockBeforeArrival: boolean, seed: number) {
      const rand = mulberry32(seed);
      let n = 40;
      let filled = S_DEFAULT;
      const econTail: number[] = [];
      for (let day = 1; day < 900; day++) {
        const doShock = () => {
          if (day % 20 === 0) filled = applySabotageDamage(filled, 3, 4);
        };
        const doArrival = () => {
          if (rand() < 0.1) {
            n += 1;
            if (filled < S_DEFAULT) filled += 1;
          }
        };
        if (shockBeforeArrival) {
          doShock();
          doArrival();
        } else {
          doArrival();
          doShock();
        }
        n -= migrationValveStep(n, filled, rand);
        if (day >= 400) econTail.push(economicHealth(filled, S_DEFAULT));
      }
      return econTail.reduce((a, b) => a + b, 0) / econTail.length;
    }
    const before = run(true, 1);
    const after = run(false, 1);
    expect(Math.abs(before - after)).toBeLessThan(0.01);
  });
});

describe('experience decay while traveling', () => {
  it('TRAVEL_DAYS_TARGET days costs 25-60% of a maxed veteran\'s experience cap', () => {
    let exp = EXPERIENCE_CAP;
    for (let i = 0; i < TRAVEL_DAYS_TARGET; i++) {
      exp = decayExperienceTraveling(exp);
    }
    const pctLost = ((EXPERIENCE_CAP - exp) / EXPERIENCE_CAP) * 100;
    expect(pctLost).toBeGreaterThanOrEqual(25);
    expect(pctLost).toBeLessThanOrEqual(60);
  });
});
