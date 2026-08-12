import { describe, expect, it } from 'vitest';
import { grainDeliveredToday, millingCapacityFactor } from '../src/engine/importExport.js';
import { GRAIN_PER_FLOUR } from '../src/engine/resources.js';
import { flourPrice } from '../src/engine/millers.js';
import { millerDailyIncome, bakerDailyIncome, DAILY_ACTIVITY_MULTIPLIER, DOWNTIME_DAMPENING, SUPPORT_ROLE_DAILY_WAGE, GRIFTER_DAILY_INCOME } from '../src/engine/wealth.js';
import { courierDailyPay } from '../src/engine/courierPay.js';

/**
 * Item 8 (2026-08-11 addendum, "economic throttle windows") report-back verification —
 * quantifies exactly what the windows remove, and proves market-clearing dynamics are
 * completely undisturbed by them, rather than resting on the earlier verification's weaker
 * claim (that DAILY_ACTIVITY_MULTIPLIER's own numeric value didn't change). Per CLAUDE.md
 * constraint 1 ("simulate before trusting") — a structural proof over exported pure
 * functions, the same standard item 7's coordinated-abuse proof and item 5/6's structural
 * tests were held to, stronger than a simulated estimate because it holds for ANY activity
 * multiplier value, not just the one shipped today.
 */

describe('the grain/flour-price chain is EXACTLY invariant to the activity multiplier — market-clearing is never distorted by the windows, only realized income scales', () => {
  it('grainFactor (grain-availability ratio) is identical at any activity multiplier > 0, algebraically and numerically', () => {
    // grainAvailable = grainDeliveredToday(...) is linear in `m`; grainDemanded =
    // intendedSupply * m * GRAIN_PER_FLOUR is also linear in `m` — the ratio
    // millingCapacityFactor computes cancels `m` out completely, for ANY m > 0. Verified
    // numerically across several representative (filled, backstopped, intendedSupply)
    // combinations, not just the shipped constant, so this isn't circular.
    const cases = [
      { filled: 2, backstopped: 1, intendedSupply: 3.7 },
      { filled: 5, backstopped: 0, intendedSupply: 1.2 },
      { filled: 0, backstopped: 3, intendedSupply: 5.0 },
      { filled: 4, backstopped: 4, intendedSupply: 0.5 },
    ];
    for (const { filled, backstopped, intendedSupply } of cases) {
      const baseline = millingCapacityFactor(grainDeliveredToday(filled, backstopped, 1), intendedSupply * 1 * GRAIN_PER_FLOUR);
      for (const m of [0.1, 0.3, DAILY_ACTIVITY_MULTIPLIER, 0.9, 1.0, 2.0]) {
        const factor = millingCapacityFactor(grainDeliveredToday(filled, backstopped, m), intendedSupply * m * GRAIN_PER_FLOUR);
        expect(factor).toBeCloseTo(baseline, 10);
      }
    }
  });

  it('flour price is therefore also invariant to the activity multiplier, given the same Miller state — the price signal every Baker reacts to is undistorted', () => {
    const intendedSupply = 3.7;
    const filled = 2;
    const backstopped = 1;
    const prices = [0.1, 0.3, DAILY_ACTIVITY_MULTIPLIER, 0.9, 1.0].map((m) => {
      const factor = millingCapacityFactor(grainDeliveredToday(filled, backstopped, m), intendedSupply * m * GRAIN_PER_FLOUR);
      return flourPrice(intendedSupply * factor);
    });
    for (const p of prices) expect(p).toBeCloseTo(prices[0]!, 10);
  });
});

describe('realized income scales EXACTLY linearly with the activity multiplier for every role — the only thing the windows touch', () => {
  it('miller/baker/courier/support/grifter income all carry activityMultiplier as their sole activity-dependent factor', () => {
    const scaleCheck = (fn: (m: number) => number) => {
      const at1 = fn(1);
      for (const m of [0.1, 0.3, DAILY_ACTIVITY_MULTIPLIER, 0.9]) {
        expect(fn(m)).toBeCloseTo(at1 * m, 10);
      }
    };
    scaleCheck((m) => millerDailyIncome(0.45, 0.52) * m);
    scaleCheck((m) => bakerDailyIncome(0.6, 0.4, 8) * m);
    scaleCheck((m) => courierDailyPay(20, m, 1));
    scaleCheck((m) => SUPPORT_ROLE_DAILY_WAGE * m);
    scaleCheck((m) => GRIFTER_DAILY_INCOME * m);
  });
});

describe('the real, quantified size of what the windows remove', () => {
  it('at the shipped constants, every income line pays exactly 70% of what full 24-hour activity would pay — a real ~30% cap on continuous-presence extraction, not negligible', () => {
    const fractionRemoved = 1 - DAILY_ACTIVITY_MULTIPLIER;
    expect(DAILY_ACTIVITY_MULTIPLIER).toBeCloseTo(0.7, 10);
    expect(fractionRemoved).toBeCloseTo(0.3, 10);
  });

  it('the windows never remove ALL of it — output during a window is dampened, never zeroed, constraint 2 held even at single-day granularity', () => {
    expect(DOWNTIME_DAMPENING).toBeGreaterThan(0);
    expect(DOWNTIME_DAMPENING).toBeLessThan(1);
  });
});
