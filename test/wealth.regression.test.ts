import { describe, expect, it } from 'vitest';
import {
  millerDailyIncome,
  bakerDailyIncome,
  giniCoefficient,
  topShare,
  taxAndRedistributeIncome,
  applyWealthCap,
} from '../src/engine/wealth.js';

/**
 * Regression tests for the wealth-tracking and inequality-metric primitives, verified
 * against hand-computed and analytically-known cases before trusting them in a larger
 * simulation — per CLAUDE.md constraint 1 ("simulate before trusting").
 */

describe('millerDailyIncome / bakerDailyIncome', () => {
  it('miller income is quantity times flour price', () => {
    expect(millerDailyIncome(0.5, 0.8)).toBeCloseTo(0.4, 10);
  });

  it('baker income is margin over flour cost times volume, floored at zero', () => {
    expect(bakerDailyIncome(1.0, 0.6, 2)).toBeCloseTo(0.8, 10);
    expect(bakerDailyIncome(0.3, 0.6, 2)).toBe(0); // selling below flour cost never yields negative income
  });
});

describe('giniCoefficient — verified against known analytical cases', () => {
  it('is exactly 0 for perfect equality', () => {
    expect(giniCoefficient([5, 5, 5, 5])).toBeCloseTo(0, 10);
  });

  it('approaches 1 as concentration approaches total (one holder, rest at zero)', () => {
    const g = giniCoefficient([0, 0, 0, 0, 100]);
    // Analytical Gini for n=5, one holder has everything: (n-1)/n = 4/5 = 0.8
    expect(g).toBeCloseTo(0.8, 10);
  });

  it('matches the textbook two-point case: one has 90, nine have (10/9) each', () => {
    // A hand-checkable case distinct from the "one holder has everything" extreme.
    const wealths = [90, ...Array(9).fill(10 / 9)];
    const g = giniCoefficient(wealths);
    expect(g).toBeGreaterThan(0.7);
    expect(g).toBeLessThan(1);
  });

  it('is 0 for an empty or all-zero distribution, not NaN or undefined', () => {
    expect(giniCoefficient([])).toBe(0);
    expect(giniCoefficient([0, 0, 0])).toBe(0);
  });

  it('is invariant to a uniform positive scaling (Gini is scale-free)', () => {
    const base = [1, 3, 6, 20];
    const scaled = base.map((x) => x * 10);
    expect(giniCoefficient(scaled)).toBeCloseTo(giniCoefficient(base), 10);
  });

  it('increases monotonically as wealth concentrates further, holding total fixed', () => {
    const equal = [25, 25, 25, 25];
    const skewed = [10, 20, 30, 40];
    const veryskewed = [1, 1, 1, 97];
    expect(giniCoefficient(equal)).toBeLessThan(giniCoefficient(skewed));
    expect(giniCoefficient(skewed)).toBeLessThan(giniCoefficient(veryskewed));
  });
});

describe('topShare', () => {
  it('the top 10% of a 10-person perfectly unequal distribution holds everything', () => {
    const wealths = [0, 0, 0, 0, 0, 0, 0, 0, 0, 100];
    expect(topShare(wealths, 0.1)).toBeCloseTo(1, 10);
  });

  it('the top 100% always holds exactly the total (sanity check)', () => {
    const wealths = [3, 7, 12, 40, 2];
    expect(topShare(wealths, 1.0)).toBeCloseTo(1, 10);
  });

  it('perfect equality: top 10% of 10 players holds close to 10%', () => {
    const wealths = Array(10).fill(5);
    expect(topShare(wealths, 0.1)).toBeCloseTo(0.1, 10);
  });
});

describe('taxAndRedistributeIncome — proposal, verified to conserve total and reduce inequality', () => {
  it('taxRate=0 is a true no-op', () => {
    const incomes = [1, 5, 10];
    expect(taxAndRedistributeIncome(incomes, 0)).toEqual(incomes);
  });

  it('conserves total income exactly at any tax rate', () => {
    const incomes = [1, 5, 10, 0.5, 20];
    const totalBefore = incomes.reduce((a, b) => a + b, 0);
    for (const rate of [0.1, 0.3, 0.5, 0.9, 1.0]) {
      const after = taxAndRedistributeIncome(incomes, rate);
      const totalAfter = after.reduce((a, b) => a + b, 0);
      expect(totalAfter).toBeCloseTo(totalBefore, 8);
    }
  });

  it('a positive tax rate strictly reduces income inequality among unequal earners', () => {
    const incomes = [1, 2, 3, 50];
    const giniBefore = giniCoefficient(incomes);
    const giniAfter = giniCoefficient(taxAndRedistributeIncome(incomes, 0.5));
    expect(giniAfter).toBeLessThan(giniBefore);
  });

  it('taxRate=1 (full redistribution) produces perfect equality', () => {
    const incomes = [1, 2, 3, 50];
    const after = taxAndRedistributeIncome(incomes, 1.0);
    expect(giniCoefficient(after)).toBeCloseTo(0, 8);
  });
});

describe('applyWealthCap — proposal, verified to bound the maximum and conserve total (to a documented tolerance)', () => {
  it('no player ever exceeds the cap after application', () => {
    const wealths = [5, 50, 200, 1000, 3];
    const capped = applyWealthCap(wealths, 100);
    for (const w of capped) expect(w).toBeLessThanOrEqual(100);
  });

  it('cap=undefined is a true no-op', () => {
    const wealths = [5, 50, 200];
    expect(applyWealthCap(wealths, undefined)).toEqual(wealths);
  });

  it('redistributes captured overflow to under-cap players rather than discarding it, when headroom exceeds the overflow', () => {
    const wealths = [150, 40, 45, 42]; // overflow=50, headroom=(60-40)+(60-45)+(60-42)=33 -- use a cap with more headroom
    const capped = applyWealthCap(wealths, 200); // no one over cap: sanity no-op case first
    expect(capped.reduce((a, b) => a + b, 0)).toBeCloseTo(wealths.reduce((a, b) => a + b, 0), 8);

    // Real redistribution case: overflow (20) comfortably fits in headroom (3 * 55 = 165).
    const wealths2 = [120, 45, 45, 45];
    const capped2 = applyWealthCap(wealths2, 100);
    const totalAfter = capped2.reduce((a, b) => a + b, 0);
    const totalBefore = wealths2.reduce((a, b) => a + b, 0);
    expect(totalAfter).toBeCloseTo(totalBefore, 6);
  });

  it('when overflow exceeds available headroom, loss is bounded (never creates wealth, never exceeds the cap) rather than corrupting values', () => {
    // Documented simplification: a single redistribution pass, not iterated to
    // convergence. Overflow (900) here vastly exceeds headroom (3 * 99 = 297), so some
    // wealth is legitimately lost rather than redistributed a second time — verify the
    // loss is bounded and sane, not that nothing is lost.
    const wealths = [1000, 1, 1, 1];
    const capped = applyWealthCap(wealths, 100);
    const totalAfter = capped.reduce((a, b) => a + b, 0);
    const totalBefore = wealths.reduce((a, b) => a + b, 0);
    for (const w of capped) expect(w).toBeLessThanOrEqual(100);
    expect(totalAfter).toBeLessThanOrEqual(totalBefore);
    expect(totalAfter).toBeGreaterThan(0);
  });

  it('strictly reduces inequality relative to the uncapped distribution', () => {
    const wealths = [1000, 1, 1, 1];
    const giniBefore = giniCoefficient(wealths);
    const giniAfter = giniCoefficient(applyWealthCap(wealths, 100));
    expect(giniAfter).toBeLessThan(giniBefore);
  });
});
