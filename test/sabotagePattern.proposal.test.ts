import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/sim/rng.js';
import {
  patternLegibility,
  patternStepDetectionProbability,
  patternSabotageAttempt,
  economicHealth,
} from '../src/engine/ecosystem.js';
import { runPatternSabotageSim } from '../src/sim/sabotagePatternHarness.js';

/**
 * Sanity tests for the pattern-based sabotage PROPOSAL (see `ecosystem.ts`'s "Sabotage,
 * pattern-based re-specification" section and docs/BLUEPRINT.md's writeup). These verify
 * the mechanism behaves as designed — near-undetectable single steps, a progressively
 * legible pattern, the shard floor still holding under sustained pressure — per CLAUDE.md
 * constraint 1 ("simulate before trusting"). They do NOT assert this is the shipped
 * default; the proposal's specific numbers (steps required, cadence, detection rates)
 * are explicitly flagged for review, not locked in here.
 */

describe('patternLegibility — grows only as the pattern accumulates', () => {
  it('a single step out of many carries very little legibility', () => {
    expect(patternLegibility(1, 6)).toBeLessThan(0.03);
  });

  it('legibility reaches 1 exactly at completion', () => {
    expect(patternLegibility(6, 6)).toBe(1);
  });

  it('legibility is monotonically increasing in steps completed', () => {
    const values = [1, 2, 3, 4, 5, 6].map((k) => patternLegibility(k, 6));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
  });
});

describe('patternStepDetectionProbability — a single step stays near-undetectable even at a healthy witness count', () => {
  it('step 1 of 6 has low detection probability even at 23 witnesses (the documented healthy-shard count)', () => {
    const p = patternStepDetectionProbability(1, 6, 23, false);
    expect(p).toBeLessThan(0.05);
  });

  it('the final step is far more detectable than the first — the pattern becomes legible, not any single act', () => {
    const first = patternStepDetectionProbability(1, 6, 23, false);
    const last = patternStepDetectionProbability(6, 6, 23, false);
    expect(last).toBeGreaterThan(first * 5);
  });

  it('an active Detective raises detection probability over ambient witnessing alone, at every step', () => {
    for (let k = 1; k <= 6; k++) {
      const ambient = patternStepDetectionProbability(k, 6, 23, false);
      const withDetective = patternStepDetectionProbability(k, 6, 23, true);
      expect(withDetective).toBeGreaterThan(ambient);
    }
  });
});

describe('patternSabotageAttempt — a patient attacker can succeed, it is not guaranteed', () => {
  it('across many seeds, both outcomes occur — neither certain success nor certain failure', () => {
    let succeeded = 0;
    let caught = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const rng = mulberry32(seed);
      const result = patternSabotageAttempt(6, 23, false, rng);
      if (result.succeeded) succeeded++;
      else caught++;
    }
    expect(succeeded).toBeGreaterThan(0);
    expect(caught).toBeGreaterThan(0);
  });
});

describe('runPatternSabotageSim — constraint 2: the shard floor holds under sustained pattern-based attack', () => {
  it('economicHealth never drops anywhere near the BACKSTOP_PRODUCTIVITY floor (0.4), even under 4 concurrent attackers', () => {
    const r = runPatternSabotageSim({ seed: 1, days: 20000, campaignCount: 4 });
    const tail = r.economicHealthSeries.slice(2000);
    const min = Math.min(...tail);
    expect(min).toBeGreaterThan(0.6);
  });

  it('sabotage successes actually occur under sustained pressure (the mechanic is not accidentally non-viable)', () => {
    const r = runPatternSabotageSim({ seed: 1, days: 20000, campaignCount: 4 });
    const successes = r.campaigns.filter((c) => c.outcome === 'succeeded' && c.day >= 2000);
    expect(successes.length).toBeGreaterThan(0);
  });

  it('a Detective measurably raises the catch rate relative to no Detective, over the same seeds', () => {
    let caughtNoDetective = 0;
    let caughtWithDetective = 0;
    let totalNoDetective = 0;
    let totalWithDetective = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const withoutD = runPatternSabotageSim({ seed, days: 20000, campaignCount: 2, detectiveActive: false });
      const withD = runPatternSabotageSim({ seed, days: 20000, campaignCount: 2, detectiveActive: true });
      const wo = withoutD.campaigns.filter((c) => c.day >= 2000);
      const wd = withD.campaigns.filter((c) => c.day >= 2000);
      caughtNoDetective += wo.filter((c) => c.outcome === 'caught').length;
      totalNoDetective += wo.length;
      caughtWithDetective += wd.filter((c) => c.outcome === 'caught').length;
      totalWithDetective += wd.length;
    }
    const rateNoDetective = caughtNoDetective / totalNoDetective;
    const rateWithDetective = caughtWithDetective / totalWithDetective;
    expect(rateWithDetective).toBeGreaterThan(rateNoDetective);
  });
});

describe('sanity: economicHealth itself still floors at BACKSTOP_PRODUCTIVITY regardless of this proposal', () => {
  it('a fully-evicted shard still floors at 0.4, unchanged by anything added here', () => {
    expect(economicHealth(0, 24)).toBeCloseTo(0.4, 5);
  });
});
