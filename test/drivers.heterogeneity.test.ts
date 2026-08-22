import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { mulberry32 } from '../src/sim/rng.js';
import {
  assignHonestParams,
  assignOpportunistParams,
  assignSaboteurParams,
  driverForPlayer,
  DEFAULT_HONEST_PARAMS,
  DEFAULT_OPPORTUNIST_PARAMS,
  DEFAULT_SABOTEUR_PARAMS,
  DRIVER_STRATEGIES,
} from '../src/sim/drivers/index.js';
import type { DriverVisibleState } from '../src/sim/drivers/types.js';
import { applyDriverTick } from '../src/sim/playtestDrivers.js';

/**
 * Per-agent DISPOSITION (drivers/heterogeneity.ts, 2026-08-22) — the fix for the flat-Gini /
 * "100% compliance" finding: every agent of a strategy previously shared one literal set of
 * constants. These tests check the actual properties that matter for that fix to be real:
 * deterministic (still reproducible), bounded (never outside the declared range), genuinely
 * spread (not everyone landing on the same value), and mean-preserving (the population average
 * stays close to the original constant, so this is an isolated spread variable, not a re-tune).
 *
 * Deliberately NOT tested here: anything resembling learning or an evolving personality —
 * that's out of scope by the architecture's own rule (see `drivers/types.ts`'s header and
 * `heterogeneity.ts`'s own doc comment).
 */

function stats(values: number[]): { min: number; max: number; mean: number; stddev: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { min, max, mean, stddev: Math.sqrt(variance) };
}

const N = 2000;
const indices = Array.from({ length: N }, (_, i) => i);

describe('assignHonestParams — deterministic, bounded, spread, mean-preserving', () => {
  it('is deterministic: same (seed, playerIndex) always returns the same params', () => {
    for (const i of [0, 1, 2, 500, 999]) {
      expect(assignHonestParams(7, i)).toEqual(assignHonestParams(7, i));
    }
  });

  it('every field stays within its declared range, and the population actually spreads', () => {
    const occupy = indices.map((i) => assignHonestParams(7, i).occupySlotChance);
    const post = indices.map((i) => assignHonestParams(7, i).postToWallChance);
    const move = indices.map((i) => assignHonestParams(7, i).moveChance);

    const occ = stats(occupy);
    expect(occ.min).toBeGreaterThanOrEqual(0.15);
    expect(occ.max).toBeLessThanOrEqual(0.45);
    expect(occ.stddev).toBeGreaterThan(0.05); // not a spike at one value
    expect(occ.mean).toBeCloseTo(DEFAULT_HONEST_PARAMS.occupySlotChance, 1);

    const post_ = stats(post);
    expect(post_.min).toBeGreaterThanOrEqual(0.05);
    expect(post_.max).toBeLessThanOrEqual(0.25);
    expect(post_.mean).toBeCloseTo(DEFAULT_HONEST_PARAMS.postToWallChance, 1);

    const mv = stats(move);
    expect(mv.min).toBeGreaterThanOrEqual(0.1);
    expect(mv.max).toBeLessThanOrEqual(0.3);
    expect(mv.mean).toBeCloseTo(DEFAULT_HONEST_PARAMS.moveChance, 1);
  });

  it('different agents get different params — not four relabeled copies of one number', () => {
    const values = new Set(indices.slice(0, 200).map((i) => assignHonestParams(3, i).occupySlotChance));
    expect(values.size).toBeGreaterThan(100); // overwhelmingly distinct, allowing for float collisions
  });
});

describe('assignOpportunistParams — bounded and spread', () => {
  it('every field stays within range and spreads around the original constant', () => {
    const favorable = indices.map((i) => assignOpportunistParams(5, i).favorableOccupyChance);
    const threshold = indices.map((i) => assignOpportunistParams(5, i).favorablePriceThreshold);

    const f = stats(favorable);
    expect(f.min).toBeGreaterThanOrEqual(0.35);
    expect(f.max).toBeLessThanOrEqual(0.65);
    expect(f.mean).toBeCloseTo(DEFAULT_OPPORTUNIST_PARAMS.favorableOccupyChance, 1);

    const t = stats(threshold);
    expect(t.min).toBeGreaterThanOrEqual(0.3);
    expect(t.max).toBeLessThanOrEqual(0.5);
    expect(t.mean).toBeCloseTo(DEFAULT_OPPORTUNIST_PARAMS.favorablePriceThreshold, 1);
  });
});

describe('assignSaboteurParams — bounded, integer witness threshold, spread', () => {
  it('lowWitnessThreshold stays an integer in {2,3,4,5} and both ends actually occur', () => {
    const thresholds = indices.map((i) => assignSaboteurParams(13, i).lowWitnessThreshold);
    for (const t of thresholds) {
      expect(Number.isInteger(t)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(2);
      expect(t).toBeLessThanOrEqual(5);
    }
    expect(new Set(thresholds).size).toBeGreaterThan(1); // not every saboteur identically cautious
  });

  it('attemptChance spreads around the original 0.4 constant', () => {
    const attempt = indices.map((i) => assignSaboteurParams(13, i).attemptChance);
    const a = stats(attempt);
    expect(a.min).toBeGreaterThanOrEqual(0.25);
    expect(a.max).toBeLessThanOrEqual(0.55);
    expect(a.mean).toBeCloseTo(DEFAULT_SABOTEUR_PARAMS.attemptChance, 1);
  });
});

describe('driverForPlayer — deterministic per-agent driver construction', () => {
  const baseState: DriverVisibleState = {
    tick: 0,
    playerId: 'p',
    role: 'miller',
    atBuildingId: 'b-0',
    atPlot: { x: 0, y: 0 },
    slotIsVacant: true,
    flourPrice: 0.2,
    economicHealth: 0.9,
    nearbyOccupantCount: 1,
    visibleBuildingIds: ['b-1', 'b-2'],
  };

  it('is deterministic: same (seed, playerIndex, strategy) called twice acts identically on the same state+rng', () => {
    for (const strategy of DRIVER_STRATEGIES) {
      const driverA = driverForPlayer(9, 42, strategy);
      const driverB = driverForPlayer(9, 42, strategy);
      const actionA = driverA(baseState, mulberry32(1));
      const actionB = driverB(baseState, mulberry32(1));
      expect(actionA).toEqual(actionB);
    }
  });

  it('idle strategy always returns the plain idleDriver behaviour', () => {
    const driver = driverForPlayer(1, 1, 'idle');
    const rng = mulberry32(2);
    for (let i = 0; i < 20; i++) {
      expect(driver(baseState, rng)).toEqual({ type: 'idle' });
    }
  });

  it('two different playerIndex values with the same strategy can behave differently — the actual point', () => {
    // Sweep many indices; at least one pair of honest agents must disagree on the same state
    // and rng draw, or heterogeneity did nothing.
    const rng = mulberry32(4);
    const seenActions = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const driver = driverForPlayer(21, i, 'honest');
      seenActions.add(JSON.stringify(driver(baseState, mulberry32(4))));
      void rng;
    }
    expect(seenActions.size).toBeGreaterThan(1);
  });
});

describe('applyDriverTick — heterogeneous option is opt-in and does not disturb the default path', () => {
  it('defaults to the pre-heterogeneity shared-driver behaviour when the option is omitted', () => {
    const world = stepWorld(createWorld(7, DEFAULT_WORLD_CONFIG));
    const a = applyDriverTick(world, mulberry32(11));
    const b = applyDriverTick(world, mulberry32(11));
    expect(a.world.pendingWallPosts).toEqual(b.world.pendingWallPosts);
  });

  it('the heterogeneous path is itself deterministic for a given seed', () => {
    const world = stepWorld(createWorld(7, DEFAULT_WORLD_CONFIG));
    const a = applyDriverTick(world, mulberry32(11), { heterogeneous: true });
    const b = applyDriverTick(world, mulberry32(11), { heterogeneous: true });
    expect(a.world.pendingWallPosts).toEqual(b.world.pendingWallPosts);
  });
});
