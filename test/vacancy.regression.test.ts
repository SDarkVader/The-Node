import { describe, expect, it } from 'vitest';
import { runVacancySim, DEFAULTS } from '../src/sim/vacancyHarness.js';

/**
 * Regression tests for the Phase 2 vacancy engine (§2.1-2.5).
 *
 * The brief's literal [CALIBRATED — provisional] constants (beta=0.0008, t_hard=14) do
 * NOT reproduce its own §2.4 targets (voluntary:backstop ratio ~1.2:1 at N=50, ~2.8:1 at
 * N=80; starved fraction 1-2%) — proved via a hazard-function-independent bound
 * (starved_fraction >= backstopShare(ratio) * t_hard * pDaily) showing the two targets
 * are structurally incompatible at t_hard=14, then confirmed by sweeping beta and t_hard
 * independently (neither alone can hit both). Recalibrated 2026-08-07 via a joint
 * (beta, t_hard) grid search to beta=0.03, t_hard=3 (see DEFAULTS in vacancyHarness.ts) —
 * this pair hits both targets simultaneously across N=50/60/80, with BACKSTOPPED time
 * landing lower than before, not the NPC-dominance tradeoff a recovery-hazard-only fix
 * required. See docs/BLUEPRINT.md "Open deviations" for the full numeric trail.
 */

const DAYS_PER_YEAR = 365;
const SEEDS = [1, 2, 3, 4, 5];

function longRun(N: number, days = DAYS_PER_YEAR * 20, backstoppedRecoveryHazard?: number) {
  let voluntaryFills = 0;
  let genuineVoluntaryFills = 0;
  let backstopRecoveries = 0;
  let backstopFires = 0;
  let vacantSlotDays = 0;
  let backstoppedSlotDays = 0;
  let totalSlotDays = 0;
  let gapDays: number[] = [];

  for (const seed of SEEDS) {
    const r = runVacancySim({ N, R: 3, pMonthly: 0.2, days, seed, backstoppedRecoveryHazard });
    voluntaryFills += r.voluntaryFills;
    genuineVoluntaryFills += r.genuineVoluntaryFills;
    backstopRecoveries += r.backstopRecoveries;
    backstopFires += r.backstopFires;
    vacantSlotDays += r.vacantSlotDays;
    backstoppedSlotDays += r.backstoppedSlotDays;
    totalSlotDays += r.totalSlotDays;
    gapDays = gapDays.concat(r.gapDays);
  }

  return {
    voluntaryFills,
    genuineVoluntaryFills,
    backstopRecoveries,
    backstopFires,
    vacantSlotDays,
    backstoppedSlotDays,
    totalSlotDays,
    gapDays,
  };
}

describe('§2.1-2.3 — structural guarantees of the vacancy semi-Markov process', () => {
  it('no vacancy gap ever exceeds t_hard — the backstop is a genuine bound', () => {
    const { gapDays } = longRun(50);
    expect(gapDays.length).toBeGreaterThan(100);
    for (const gap of gapDays) {
      expect(gap).toBeLessThanOrEqual(DEFAULTS.tHard);
    }
  });

  it('both voluntary fills and backstop fires actually occur over a long run', () => {
    // Neither mechanism is accidentally disabled or the only path — matches "no
    // permanent zero-state": the system doesn't collapse into pure-backstop or
    // pure-voluntary at this parameterization.
    const { voluntaryFills, backstopFires } = longRun(50);
    expect(voluntaryFills).toBeGreaterThan(0);
    expect(backstopFires).toBeGreaterThan(0);
  });

  it('starved (VACANT) fraction reaches a stable steady state, not a monotonic drift', () => {
    // Split a long run in half and compare — a healthy "49-51" system should hover in a
    // stable band, not trend toward 0% (comfortable) or 100% (collapse) over time.
    const days = DAYS_PER_YEAR * 20;
    const half = Math.floor(days / 2);
    let firstHalfVacant = 0;
    let secondHalfVacant = 0;
    let firstHalfSlotDays = 0;
    let secondHalfSlotDays = 0;

    for (const seed of SEEDS) {
      const first = runVacancySim({ N: 50, R: 3, pMonthly: 0.2, days: half, seed });
      const full = runVacancySim({ N: 50, R: 3, pMonthly: 0.2, days, seed });
      firstHalfVacant += first.vacantSlotDays;
      firstHalfSlotDays += first.totalSlotDays;
      secondHalfVacant += full.vacantSlotDays - first.vacantSlotDays;
      secondHalfSlotDays += full.totalSlotDays - first.totalSlotDays;
    }

    const firstFraction = firstHalfVacant / firstHalfSlotDays;
    const secondFraction = secondHalfVacant / secondHalfSlotDays;
    expect(Math.abs(firstFraction - secondFraction)).toBeLessThan(0.03);
  });
});

describe('§2.4 — qualitative trend preserved even though exact targets are not', () => {
  it('voluntary:backstop ratio increases with N, matching the brief\'s claimed direction', () => {
    const at50 = longRun(50);
    const at80 = longRun(80);
    const ratio50 = at50.voluntaryFills / at50.backstopFires;
    const ratio80 = at80.voluntaryFills / at80.backstopFires;
    expect(ratio80).toBeGreaterThan(ratio50);
  });
});

describe('§2.4 — recalibrated (beta=0.03, t_hard=3) hits the brief\'s own numeric targets', () => {
  it('voluntary:backstop ratio lands within range of the brief\'s targets at N=50 and N=80', () => {
    const at50 = longRun(50);
    const at80 = longRun(80);
    const ratio50 = at50.genuineVoluntaryFills / at50.backstopFires;
    const ratio80 = at80.genuineVoluntaryFills / at80.backstopFires;
    // Brief: ~1.2:1 at N=50, ~2.8:1 at N=80. Generous band — this is a calibration
    // target, not an exact physical law, and single-seed noise is real even at 20 years.
    expect(ratio50).toBeGreaterThan(0.8);
    expect(ratio50).toBeLessThan(1.7);
    expect(ratio80).toBeGreaterThan(2.0);
    expect(ratio80).toBeLessThan(3.6);
  });

  it('starved (VACANT-only) fraction lands within the brief\'s 1-2% band at N=50 and N=80', () => {
    const at50 = longRun(50);
    const at80 = longRun(80);
    const starved50 = at50.vacantSlotDays / at50.totalSlotDays;
    const starved80 = at80.vacantSlotDays / at80.totalSlotDays;
    // A little headroom above the literal 1-2% — same reasoning as the ratio band above.
    expect(starved50).toBeGreaterThan(0.005);
    expect(starved50).toBeLessThan(0.03);
    expect(starved80).toBeGreaterThan(0.005);
    expect(starved80).toBeLessThan(0.03);
  });

  it('BACKSTOPPED time stays low — recalibration did not reintroduce NPC dominance', () => {
    // The failure mode this must NOT reproduce: closing the ratio gap via recovery hazard
    // alone previously required 79-86% BACKSTOPPED time. This should stay near the low
    // single digits, well under the 10% conscription already guarantees for Miller.
    const r = longRun(50);
    const backstoppedFraction = r.backstoppedSlotDays / r.totalSlotDays;
    expect(backstoppedFraction).toBeLessThan(0.02);
  });
});

describe('§2.5 — NPC fallback (BACKSTOPPED) is a real, distinct state', () => {
  it('a slot spends measurable time in BACKSTOPPED, separate from VACANT', () => {
    const { backstoppedSlotDays } = longRun(50);
    expect(backstoppedSlotDays).toBeGreaterThan(0);
  });
});

describe('genuine vs. recovery fill split (found 2026-08-07: the un-split ratio was inflated)', () => {
  it('genuineVoluntaryFills + backstopRecoveries always sums to voluntaryFills', () => {
    const r = longRun(50);
    expect(r.genuineVoluntaryFills + r.backstopRecoveries).toBe(r.voluntaryFills);
  });

  it('the corrected ratio (genuine fills / backstop fires) is closer to the brief\'s stated target than the inflated one', () => {
    // Every backstopFires eventually produces one backstopRecoveries in this model, so
    // the un-split ratio is systematically inflated by roughly +1. Brief's target at
    // N=50 is ~1.2:1 — the corrected ratio should land measurably closer to that than
    // the inflated (voluntaryFills-based) ratio does.
    const r = longRun(50);
    const inflatedRatio = r.voluntaryFills / r.backstopFires;
    const correctedRatio = r.genuineVoluntaryFills / r.backstopFires;
    const target = 1.2;
    expect(Math.abs(correctedRatio - target)).toBeLessThan(Math.abs(inflatedRatio - target));
  });

  it('the backstoppedRecoveryHazard override changes backstopped-time but barely moves the corrected ratio', () => {
    // Recovery hazard is the dominant lever on how much time is spent BACKSTOPPED, but
    // it's a downstream consequence, not a cause, of the genuine-fill-vs-backstop-fire
    // balance — that's what makes the ratio inflation bug (not beta, not recovery rate)
    // the actual primary driver of the original §2.4 ratio mismatch.
    const slow = longRun(50, DAYS_PER_YEAR * 20, 0.001);
    const fast = longRun(50, DAYS_PER_YEAR * 20, 0.5);

    const slowBackstoppedFraction = slow.backstoppedSlotDays / slow.totalSlotDays;
    const fastBackstoppedFraction = fast.backstoppedSlotDays / fast.totalSlotDays;
    expect(slowBackstoppedFraction).toBeGreaterThan(fastBackstoppedFraction * 3);

    const slowRatio = slow.genuineVoluntaryFills / slow.backstopFires;
    const fastRatio = fast.genuineVoluntaryFills / fast.backstopFires;
    expect(Math.abs(slowRatio - fastRatio)).toBeLessThan(0.5);
  });
});
