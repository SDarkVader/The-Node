import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/sim/rng.js';
import { shiftCoverPay, shiftCoverNoticedIndices, orderGrifterCandidatesForNotice, SHIFT_COVER_FRACTION } from '../src/engine/shiftCover.js';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type WorldConfig } from '../src/world/world.js';
import { reputationLevelForProgress, REPUTATION_LEVEL_THRESHOLDS } from '../src/engine/reputation.js';

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

describe('orderGrifterCandidatesForNotice — the level-2 gate fix (2026-08-18)', () => {
  it('a grifter racing toward level 2 (exactly level 1) is preferred over a level-0 grifter with lower wealth', () => {
    const grifters = [
      { wealth: 0, reputationProgress: 0 }, // level 0, poorest — old rule would pick this first
      { wealth: 100, reputationProgress: REPUTATION_LEVEL_THRESHOLDS[0]! }, // level 1, racing, richer
    ];
    const order = orderGrifterCandidatesForNotice(grifters);
    expect(order[0]).toBe(1);
  });

  it('among several racing grifters, whoever is closest to the level-2 threshold goes first', () => {
    const grifters = [
      { wealth: 0, reputationProgress: REPUTATION_LEVEL_THRESHOLDS[0]! }, // just reached level 1
      { wealth: 0, reputationProgress: REPUTATION_LEVEL_THRESHOLDS[1]! - 1 }, // one tick from level 2
    ];
    const order = orderGrifterCandidatesForNotice(grifters);
    expect(order[0]).toBe(1);
  });

  it('a grifter who already reached level 2 is NOT preferred — the preference is scoped to exactly level 1, not "any progress"', () => {
    const grifters = [
      { wealth: 100, reputationProgress: 0 }, // level 0, wealthy
      { wealth: 0, reputationProgress: REPUTATION_LEVEL_THRESHOLDS[1]! }, // level 2 already, poor
    ];
    // Neither is racing (level 0 and level 2 both fall outside "exactly level 1"), so this
    // degenerates to the plain wealth rule: the poorer grifter (index 1) goes first regardless
    // of already being level 2 — the racing preference gives it no special treatment either way.
    const order = orderGrifterCandidatesForNotice(grifters);
    expect(order[0]).toBe(1);
  });

  it('omitting reputationProgress entirely (undefined, reads as 0/level 0) never crashes and behaves as level 0', () => {
    const grifters = [{ wealth: 5 }, { wealth: 1, reputationProgress: REPUTATION_LEVEL_THRESHOLDS[0]! }];
    const order = orderGrifterCandidatesForNotice(grifters);
    expect(order[0]).toBe(1); // the racing (level 1) grifter still goes first
  });

  it('with NO racing grifter among the candidates, the ordering is byte-identical to the original plain wealth-ascending rule — the backward-compatibility guarantee', () => {
    const grifters = [
      { wealth: 5, reputationProgress: 0 },
      { wealth: 1, reputationProgress: 0 },
      { wealth: 3, reputationProgress: REPUTATION_LEVEL_THRESHOLDS[1]! }, // level 2, not racing
    ];
    const originalRule = grifters
      .map((g, i) => ({ i, wealth: g.wealth }))
      .sort((a, b) => a.wealth - b.wealth || a.i - b.i)
      .map((o) => o.i);
    expect(orderGrifterCandidatesForNotice(grifters)).toEqual(originalRule);
  });

  it('is a total ordering of every candidate index, never drops or duplicates one', () => {
    const grifters = Array.from({ length: 20 }, (_, i) => ({ wealth: (i * 7) % 13, reputationProgress: i % 8 }));
    const order = orderGrifterCandidatesForNotice(grifters);
    expect([...order].sort((a, b) => a - b)).toEqual(grifters.map((_, i) => i));
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

describe('Shift Cover -> reputation progress (2026-08-13, docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md §3.3)', () => {
  it('at least one grifter accrues reputation progress over a long run at high churn (real Shift Cover opportunities)', () => {
    // High pMonthly -> more churn -> more BACKSTOPPED slots -> more real Shift Cover
    // opportunities, same technique the existing "sawExtra" wealth test above uses.
    let world = createWorld(8, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0.95 });
    for (let i = 0; i < 500; i++) world = stepWorld(world);
    expect(world.grifters.some((g) => (g.reputationProgress ?? 0) > 0)).toBe(true);
  });

  it('reputation progress only ever increases — never decremented by anything, matching wealth staying non-negative above (constraint 6, additive-only)', () => {
    let world = createWorld(8, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0.95 });
    const priorById = new Map<string, number>();
    for (let i = 0; i < 300; i++) {
      world = stepWorld(world);
      for (const g of world.grifters) {
        const prior = priorById.get(g.id);
        const current = g.reputationProgress ?? 0;
        if (prior !== undefined) expect(current).toBeGreaterThanOrEqual(prior);
        priorById.set(g.id, current);
      }
    }
  });

  it('reputationProgress is always a non-negative integer bounded by ticks elapsed — never more than one tick could have earned', () => {
    // NOT "zero churn -> zero progress": sabotage eviction independently creates BACKSTOPPED
    // slots regardless of pMonthly (found running this test — a real, honest correction, not
    // a bug: pMonthly=0 measurably still produced progress=1 for some grifter). The real,
    // defensible invariant is a bound, not an absolute zero.
    let world = createWorld(1, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0 });
    for (let day = 1; day <= 50; day++) {
      world = stepWorld(world);
      for (const g of world.grifters) {
        const progress = g.reputationProgress ?? 0;
        expect(Number.isInteger(progress)).toBe(true);
        expect(progress).toBeGreaterThanOrEqual(0);
        expect(progress).toBeLessThanOrEqual(day);
      }
    }
  });

  it('real grifters reach level 1 AND level 2 over a long run — the calibration this session found and fixed (level 2 was empirically unreachable at the original illustrative threshold of 8)', () => {
    // Tracks progress every tick, not just a final snapshot — a snapshot alone undercounts,
    // since a grifter who accrues enough progress to matter is often the same grifter who
    // then gets genuinely conscripted into a role and leaves the pool (the mechanic working
    // as intended). Real measurement (1000 days, 3 seeds, 3 churn rates, see reputation.ts's
    // own header) found max progress ever observed topped out at 7 — level 1 (threshold 3)
    // was robustly reached, level 2 (originally 8) never was. This test locks in that level 2
    // is reachable at the corrected threshold, so a future silent threshold change that makes
    // it unreachable again fails loudly here rather than being caught by accident.
    let world = createWorld(2, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0.6 });
    let sawLevel1 = false;
    let sawLevel2 = false;
    for (let day = 0; day < 1000; day++) {
      world = stepWorld(world);
      for (const g of world.grifters) {
        const level = reputationLevelForProgress(g.reputationProgress ?? 0);
        if (level >= 1) sawLevel1 = true;
        if (level >= 2) sawLevel2 = true;
      }
    }
    expect(sawLevel1).toBe(true);
    expect(sawLevel2).toBe(true);
    // Sanity-checks the thresholds themselves stay a real rising bar, not silently flattened.
    expect(REPUTATION_LEVEL_THRESHOLDS[1]!).toBeGreaterThan(REPUTATION_LEVEL_THRESHOLDS[0]!);
  });
});
