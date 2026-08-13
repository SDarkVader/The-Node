import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/sim/rng.js';
import { runPatternSabotageSim } from '../src/sim/sabotagePatternHarness.js';
import {
  ARSON_DETECTIVE_BONUS_DEFAULT,
  ARSON_P_PER_WITNESS_DEFAULT,
  ARSON_STEPS_DEFAULT,
  attemptArson,
  canAttemptArson,
  resolveArsonTarget,
} from '../src/engine/arson.js';

describe('arson — the absence-gate (housing doc §7.6): both signals must be absent', () => {
  it('cannot attempt while the target is actively working their role, even if also away from home', () => {
    expect(canAttemptArson({ targetActivelyWorkingRole: true, targetPresentAtAbode: false })).toBe(false);
  });

  it('cannot attempt while the target is present at their abode, even if not working their role', () => {
    expect(canAttemptArson({ targetActivelyWorkingRole: false, targetPresentAtAbode: true })).toBe(false);
  });

  it('cannot attempt while both are true', () => {
    expect(canAttemptArson({ targetActivelyWorkingRole: true, targetPresentAtAbode: true })).toBe(false);
  });

  it('can attempt only once both signals are genuinely absent', () => {
    expect(canAttemptArson({ targetActivelyWorkingRole: false, targetPresentAtAbode: false })).toBe(true);
  });
});

describe('arson — target resolution (picked default, not resolved by the design docs)', () => {
  it('targets a role-holder\'s workplace, not their abode', () => {
    expect(resolveArsonTarget({ hasRole: true, workplaceBuildingId: 'shop-1', abodeBuildingId: 'home-1' })).toBe('shop-1');
  });

  it('targets a grifter\'s abode — there is no workplace to target', () => {
    expect(resolveArsonTarget({ hasRole: false, abodeBuildingId: 'home-2' })).toBe('home-2');
  });

  it('the ambiguity is moot when workplace and abode are the same building (§1.1 mixed-use housing)', () => {
    expect(resolveArsonTarget({ hasRole: true, workplaceBuildingId: 'above-shop-1', abodeBuildingId: 'above-shop-1' })).toBe('above-shop-1');
  });
});

describe('attemptArson — a thin wrapper reusing patternSabotageAttempt exactly, no parallel detection math', () => {
  it('a patient attacker can succeed; it is not guaranteed', () => {
    const rng = mulberry32(7);
    let succeeded = false;
    for (let i = 0; i < 200 && !succeeded; i++) {
      succeeded = attemptArson(23, false, rng).succeeded;
    }
    expect(succeeded).toBe(true);
  });

  it('defaults to the shipped calibrated constants when none are passed', () => {
    const rngA = mulberry32(3);
    const rngB = mulberry32(3);
    const withDefaults = attemptArson(23, false, rngA);
    const withExplicit = attemptArson(23, false, rngB, ARSON_STEPS_DEFAULT, ARSON_P_PER_WITNESS_DEFAULT, ARSON_DETECTIVE_BONUS_DEFAULT);
    expect(withDefaults).toEqual(withExplicit);
  });
});

describe('arson success rate: calibrated to the ~30% floor (2026-08-13, user directive — "30% opportunity is enough to take a chance... otherwise it\'s not worth obtaining")', () => {
  // Real, measured regression lock-in via sim/sabotagePatternHarness.ts, run with arson's own
  // constants (sim/arsonCli.ts is the permanent report) — not just a design intent restated.
  // A future change to ARSON_P_PER_WITNESS_DEFAULT that pushes this outside the intended band
  // should fail here, not be caught by accident.
  it('no Detective: success rate lands near the 30% floor, comfortably below sabotage\'s 71.1%', () => {
    let succeeded = 0;
    let total = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = runPatternSabotageSim({
        seed,
        days: 20000,
        stepsRequired: ARSON_STEPS_DEFAULT,
        pPerWitness: ARSON_P_PER_WITNESS_DEFAULT,
        detectiveBonus: ARSON_DETECTIVE_BONUS_DEFAULT,
        detectiveActive: false,
      });
      const post = r.campaigns.filter((c) => c.day >= 2000);
      succeeded += post.filter((c) => c.outcome === 'succeeded').length;
      total += post.length;
    }
    const rate = succeeded / total;
    expect(rate).toBeGreaterThan(0.25);
    expect(rate).toBeLessThan(0.4);
  });

  it('is clearly below sabotage\'s own shipped no-Detective rate — "explicitly the hardest of the three"', () => {
    const arson = runPatternSabotageSim({
      seed: 1,
      days: 20000,
      stepsRequired: ARSON_STEPS_DEFAULT,
      pPerWitness: ARSON_P_PER_WITNESS_DEFAULT,
      detectiveBonus: ARSON_DETECTIVE_BONUS_DEFAULT,
      detectiveActive: false,
    });
    const sabotage = runPatternSabotageSim({ seed: 1, days: 20000, detectiveActive: false });

    const rateOf = (r: typeof arson) => {
      const post = r.campaigns.filter((c) => c.day >= 2000);
      return post.filter((c) => c.outcome === 'succeeded').length / post.length;
    };

    expect(rateOf(arson)).toBeLessThan(rateOf(sabotage));
  });

  it('an active Detective still meaningfully raises the difficulty over the no-Detective case', () => {
    const noDetective = runPatternSabotageSim({
      seed: 1,
      days: 20000,
      stepsRequired: ARSON_STEPS_DEFAULT,
      pPerWitness: ARSON_P_PER_WITNESS_DEFAULT,
      detectiveBonus: ARSON_DETECTIVE_BONUS_DEFAULT,
      detectiveActive: false,
    });
    const withDetective = runPatternSabotageSim({
      seed: 1,
      days: 20000,
      stepsRequired: ARSON_STEPS_DEFAULT,
      pPerWitness: ARSON_P_PER_WITNESS_DEFAULT,
      detectiveBonus: ARSON_DETECTIVE_BONUS_DEFAULT,
      detectiveActive: true,
    });

    const rateOf = (r: typeof noDetective) => {
      const post = r.campaigns.filter((c) => c.day >= 2000);
      return post.filter((c) => c.outcome === 'succeeded').length / post.length;
    };

    expect(rateOf(withDetective)).toBeLessThan(rateOf(noDetective));
  });

  it('still a real, worthwhile opportunity — success rate is not so low it would never be attempted', () => {
    let succeeded = 0;
    let total = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = runPatternSabotageSim({
        seed,
        days: 20000,
        stepsRequired: ARSON_STEPS_DEFAULT,
        pPerWitness: ARSON_P_PER_WITNESS_DEFAULT,
        detectiveBonus: ARSON_DETECTIVE_BONUS_DEFAULT,
        detectiveActive: false,
      });
      const post = r.campaigns.filter((c) => c.day >= 2000);
      succeeded += post.filter((c) => c.outcome === 'succeeded').length;
      total += post.length;
    }
    expect(succeeded / total).toBeGreaterThan(0.2);
  });
});
