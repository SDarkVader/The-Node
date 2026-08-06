import { describe, expect, it } from 'vitest';
import { runVacancySim } from '../src/sim/vacancyHarness.js';

/**
 * Regression tests for the Phase 2 vacancy engine (§2.1-2.5). Unlike Phase 1's
 * market.regression.test.ts, these do NOT assert the brief's §2.4 numeric targets
 * (voluntary:backstop ratio 1.2:1-2.8:1, starved fraction 1-2%) — a faithful
 * implementation of the brief's literal equations and stated [CALIBRATED — provisional]
 * constants (beta=0.0008, T_pain=14, v_boost=3.0) does not reproduce those numbers; see
 * docs/BLUEPRINT.md "Open deviations" for the verified finding. What's encoded here are
 * the structural properties that ARE true of this implementation and worth protecting
 * across refactors.
 */

const DAYS_PER_YEAR = 365;
const SEEDS = [1, 2, 3, 4, 5];

function longRun(N: number, days = DAYS_PER_YEAR * 20) {
  let voluntaryFills = 0;
  let backstopFires = 0;
  let vacantSlotDays = 0;
  let backstoppedSlotDays = 0;
  let totalSlotDays = 0;
  let gapDays: number[] = [];

  for (const seed of SEEDS) {
    const r = runVacancySim({ N, R: 3, pMonthly: 0.2, days, seed });
    voluntaryFills += r.voluntaryFills;
    backstopFires += r.backstopFires;
    vacantSlotDays += r.vacantSlotDays;
    backstoppedSlotDays += r.backstoppedSlotDays;
    totalSlotDays += r.totalSlotDays;
    gapDays = gapDays.concat(r.gapDays);
  }

  return { voluntaryFills, backstopFires, vacantSlotDays, backstoppedSlotDays, totalSlotDays, gapDays };
}

describe('§2.1-2.3 — structural guarantees of the vacancy semi-Markov process', () => {
  it('no vacancy gap ever exceeds t_hard — the backstop is a genuine bound', () => {
    const { gapDays } = longRun(50);
    expect(gapDays.length).toBeGreaterThan(100);
    for (const gap of gapDays) {
      expect(gap).toBeLessThanOrEqual(14);
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

describe('§2.5 — NPC fallback (BACKSTOPPED) is a real, distinct state', () => {
  it('a slot spends measurable time in BACKSTOPPED, separate from VACANT', () => {
    const { backstoppedSlotDays } = longRun(50);
    expect(backstoppedSlotDays).toBeGreaterThan(0);
  });
});
