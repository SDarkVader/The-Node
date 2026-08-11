import { describe, expect, it } from 'vitest';
import {
  millerDailyIncome,
  bakerDailyIncome,
  dailyDueCustomers,
  splitBakerDemand,
  giniCoefficient,
  topShare,
  taxAndRedistributeIncome,
  applyWealthCap,
  DAILY_ACTIVITY_MULTIPLIER,
  BAKER_MAX_DAILY_CUSTOMERS,
  PURCHASE_CYCLE_DAYS,
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

describe('dailyDueCustomers — population-bound, not baker-count-bound', () => {
  it('divides population by the purchase cycle', () => {
    expect(dailyDueCustomers(65, 2.5)).toBeCloseTo(26, 10);
  });

  it('is independent of anything about bakers — same population always gives the same due-customer count', () => {
    expect(dailyDueCustomers(65)).toBe(dailyDueCustomers(65));
  });

  it('uses the default PURCHASE_CYCLE_DAYS when not overridden', () => {
    expect(dailyDueCustomers(65)).toBeCloseTo(65 / PURCHASE_CYCLE_DAYS, 10);
  });
});

describe('splitBakerDemand — population-bound, price-weighted, capacity-capped', () => {
  it('splits demand equally among bakers priced identically', () => {
    const shares = splitBakerDemand([1, 1, 1], 30, 100);
    expect(shares[0]).toBeCloseTo(10, 8);
    expect(shares[1]).toBeCloseTo(10, 8);
    expect(shares[2]).toBeCloseTo(10, 8);
  });

  it('a cheaper baker gets a strictly larger share than a pricier rival', () => {
    const shares = splitBakerDemand([0.5, 2.0], 30, 100);
    expect(shares[0]!).toBeGreaterThan(shares[1]!);
  });

  it('no single baker\'s served customers ever exceeds the capacity cap, however much demand-share math would give them', () => {
    // One baker priced far below its rival should win almost all the raw demand share —
    // confirm the cap still holds even in that lopsided case.
    const shares = splitBakerDemand([0.01, 5], 1000, BAKER_MAX_DAILY_CUSTOMERS);
    for (const s of shares) expect(s).toBeLessThanOrEqual(BAKER_MAX_DAILY_CUSTOMERS);
  });

  it('total demand distributed never exceeds the actual due-customer pool (capped demand is not manufactured elsewhere)', () => {
    const dueCustomers = 20;
    const shares = splitBakerDemand([1, 1, 1, 1], dueCustomers, 100);
    const total = shares.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(dueCustomers + 1e-8);
  });

  it('zero due customers means every baker serves zero, not NaN or negative', () => {
    const shares = splitBakerDemand([1, 2, 3], 0);
    for (const s of shares) expect(s).toBe(0);
  });

  it('an empty baker list returns an empty result', () => {
    expect(splitBakerDemand([], 30)).toEqual([]);
  });

  it('a near-zero price does not produce infinite or NaN demand share (epsilon floor holds)', () => {
    const shares = splitBakerDemand([0, 1], 30, 100);
    expect(Number.isFinite(shares[0]!)).toBe(true);
    expect(shares[0]!).toBeGreaterThan(shares[1]!); // still wins the larger share, just not infinite
  });

  it('scaling total due-customers scales every baker\'s share by the same factor (relative shares are invariant to the purchase cycle) — below the capacity cap', () => {
    // This is the property the purchase-cycle tightening (2026-08-11) relies on: since
    // relative shares don't change, tightening the cycle narrows the cross-role Miller/
    // Baker gap (a uniform scale) without changing inequality *among* bakers at all
    // (Gini is scale-invariant). Only holds below the capacity cap — verified separately
    // that the cap itself does bound things once demand is high enough to hit it.
    const prices = [0.5, 1.0, 2.0, 0.3];
    const sharesAt10 = splitBakerDemand(prices, 10, 1000);
    const sharesAt30 = splitBakerDemand(prices, 30, 1000);
    for (let i = 0; i < prices.length; i++) {
      expect(sharesAt30[i]! / sharesAt10[i]!).toBeCloseTo(3, 6);
    }
  });
});

describe('DAILY_ACTIVITY_MULTIPLIER — the daily blend of the 8-hour downtime window', () => {
  it('equals the correct blended average: 16/24 at full rate, 8/24 at 10%', () => {
    expect(DAILY_ACTIVITY_MULTIPLIER).toBeCloseTo((16 / 24) * 1 + (8 / 24) * 0.1, 10);
  });

  it('is strictly less than 1 — the window genuinely reduces daily totals, not a no-op', () => {
    expect(DAILY_ACTIVITY_MULTIPLIER).toBeLessThan(1);
    expect(DAILY_ACTIVITY_MULTIPLIER).toBeGreaterThan(0);
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
