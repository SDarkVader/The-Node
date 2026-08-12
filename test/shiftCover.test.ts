import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/sim/rng.js';
import { shiftCoverPay, shiftCoverNoticedIndices, SHIFT_COVER_FRACTION } from '../src/engine/shiftCover.js';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type WorldConfig } from '../src/world/world.js';

/**
 * Regression tests for Shift Cover (2026-08-11 addendum item 7) — verified in isolation per
 * CLAUDE.md constraint 1, same pattern every other `src/engine/` module's test file uses.
 */

describe('shiftCoverPay', () => {
  it('is exactly SHIFT_COVER_FRACTION of the reference wage', () => {
    expect(shiftCoverPay(10)).toBeCloseTo(10 * SHIFT_COVER_FRACTION, 10);
    expect(shiftCoverPay(10, 0.25)).toBeCloseTo(2.5, 10);
  });

  it('is strictly less than the reference wage for every positive input — the entire "worse than holding the role properly" guarantee, structural not measured', () => {
    for (const wage of [0.01, 0.5, 1, 2.2, 33.25, 1000]) {
      expect(shiftCoverPay(wage)).toBeLessThan(wage);
    }
  });

  it('is zero at zero reference wage, and never negative for a negative one', () => {
    expect(shiftCoverPay(0)).toBe(0);
    expect(shiftCoverPay(-5)).toBe(0);
  });

  it('THE COORDINATED-ABUSE PROOF, WITH NUMBERS (addendum item 7\'s own instruction): substituting Shift Cover for genuine occupancy loses money on every single day, not just on average — holds for ANY pattern of alternation, because it is a per-day inequality, not a simulated outcome', () => {
    // Real numbers, not the abstract argument alone: at the shipped fraction, a player who
    // alternates self-created gaps to farm Shift Cover instead of just holding the role earns
    // 40% of the honest wage, forfeiting 60% of it, every day, forever — worse than doing
    // nothing differently at all. No amount of alternation timing changes this, because the
    // inequality (fraction < 1) applies identically to every single day covered.
    const genuineWage = 2.2; // a representative Baker daily wage, per wealth.ts's own header
    const shiftCoverWage = shiftCoverPay(genuineWage);
    const forfeited = genuineWage - shiftCoverWage;
    expect(shiftCoverWage).toBeCloseTo(0.88, 10);
    expect(forfeited).toBeCloseTo(1.32, 10);
    expect(forfeited / genuineWage).toBeCloseTo(1 - SHIFT_COVER_FRACTION, 10);
  });
});

describe('shiftCoverNoticedIndices', () => {
  it('never returns more indices than there are BACKSTOPPED opportunities', () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      expect(shiftCoverNoticedIndices(5, 100, rand).length).toBeLessThanOrEqual(5);
    }
  });

  it('never returns more indices than there are grifters available', () => {
    const rand = mulberry32(2);
    for (let i = 0; i < 50; i++) {
      expect(shiftCoverNoticedIndices(100, 3, rand).length).toBeLessThanOrEqual(3);
    }
  });

  it('returns indices only within [0, backstoppedCount)', () => {
    const rand = mulberry32(3);
    const noticed = shiftCoverNoticedIndices(10, 10, rand);
    for (const idx of noticed) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(10);
    }
  });

  it('returns nothing when there are no BACKSTOPPED opportunities or no grifters', () => {
    const rand = mulberry32(4);
    expect(shiftCoverNoticedIndices(0, 10, rand)).toEqual([]);
    expect(shiftCoverNoticedIndices(10, 0, rand)).toEqual([]);
  });

  it('at a high notice probability, most opportunities get noticed (real distribution, not just a bound)', () => {
    const rand = mulberry32(5);
    const noticed = shiftCoverNoticedIndices(1000, 1000, rand, 0.9);
    expect(noticed.length).toBeGreaterThan(800);
  });
});

describe('Shift Cover wired into the world kernel', () => {
  it('a grifter can end a day with more wealth than GRIFTER_DAILY_INCOME alone would explain, once a BACKSTOPPED slot exists', () => {
    // Force real BACKSTOPPED slots quickly with high churn and a short backstop-eligibility
    // window, then run long enough that Shift Cover's probabilistic notice draw should fire
    // at least once across many days.
    const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, pMonthly: 0.95, vacancy: { tFlag: 1, tHard: 1 } };
    let world = createWorld(7, config);
    let sawExtra = false;
    for (let i = 0; i < 300 && !sawExtra; i++) {
      const before = world.grifters;
      world = stepWorld(world);
      for (const g of world.grifters) {
        const prior = before.find((b) => b.id === g.id);
        if (prior) {
          // GRIFTER_DAILY_INCOME * DAILY_ACTIVITY_MULTIPLIER is the floor every grifter gets
          // every day regardless; anything meaningfully above that one-day delta is Shift
          // Cover having paid out.
          const delta = g.wealth - prior.wealth;
          if (delta > 0.4) sawExtra = true;
        }
      }
    }
    expect(sawExtra).toBe(true);
  });

  it('never pays a grifter a negative or non-finite amount, across a long run', () => {
    let world = createWorld(8, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 500; i++) {
      world = stepWorld(world);
      for (const g of world.grifters) {
        expect(Number.isFinite(g.wealth)).toBe(true);
        expect(g.wealth).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const run = () => {
      let w = createWorld(9, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0.95 });
      for (let i = 0; i < 150; i++) w = stepWorld(w);
      return w.grifters.map((g) => g.wealth);
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
