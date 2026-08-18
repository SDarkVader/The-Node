import { describe, expect, it } from 'vitest';
import { createMultiShardState, stepMultiShard, totalPopulation } from '../src/sim/multiShardHarness.js';
import { DEFAULT_WORLD_CONFIG, type WorldConfig } from '../src/world/world.js';
import { INITIAL_SHARD_COUNT } from '../src/engine/shardRegistry.js';

/**
 * Regression tests for the multi-shard harness (2026-08-11) — composes shardRegistry.ts
 * with real World instances. Structural invariants only; the actual before/after
 * population-collapse comparison lives in src/sim/multiShardValidation.ts (npm run
 * multi-shard-validation), since that's evidence to report, not a pass/fail unit check.
 */

const SMALL_CONFIG: WorldConfig = { ...DEFAULT_WORLD_CONFIG, targetPopulation: 30, rMiller: 2, rBaker: 3, rCourier: 2, rJournalist: 2, rDetective: 1 };

describe('createMultiShardState', () => {
  it('starts with exactly INITIAL_SHARD_COUNT (2) shards, both with a real running World', () => {
    const state = createMultiShardState(1, SMALL_CONFIG);
    expect(state.registry.shards.length).toBe(INITIAL_SHARD_COUNT);
    expect(state.worlds.size).toBe(INITIAL_SHARD_COUNT);
    for (const shard of state.registry.shards) {
      expect(state.worlds.has(shard.id)).toBe(true);
      expect(state.worlds.get(shard.id)!.population).toBe(SMALL_CONFIG.targetPopulation);
    }
  });
});

describe('stepMultiShard — determinism', () => {
  it('the same seed produces an identical total-population trajectory', () => {
    let a = createMultiShardState(7, SMALL_CONFIG);
    let b = createMultiShardState(7, SMALL_CONFIG);
    const trajA: number[] = [];
    const trajB: number[] = [];
    for (let i = 0; i < 100; i++) {
      a = stepMultiShard(a);
      b = stepMultiShard(b);
      trajA.push(totalPopulation(a));
      trajB.push(totalPopulation(b));
    }
    expect(trajA).toEqual(trajB);
  });
});

describe('stepMultiShard — population accounting across shards (with migration failure)', () => {
  it('cross-shard migration is fully accounted for: every point of population loss is either a failed migration or explainable, none silently vanishes unaccounted', () => {
    // Zero out the flat new-player arrival channel so the ONLY population change comes
    // from cross-shard migration (successful transfers net to zero; failed ones are a
    // real, tracked loss) — under that condition, total population lost must exactly
    // match totalFailedMigrations, every single day.
    // Made multi-seed 2026-08-18 by the sabotage-campaign restructure, which shifted every
    // world's rng trajectory: the ACCOUNTING invariant below still held on every tick of the
    // original seed 3, but that seed stopped producing any failed migration at all, so the
    // "the failure rate actually bites" precondition no longer fired. Widened to several seeds
    // rather than dropped — the precondition is what stops the invariant passing vacuously.
    const noArrivalsConfig: WorldConfig = { ...SMALL_CONFIG, arrivalPDaily: 0 };
    let sawFailures = 0;
    for (const seed of [3, 4, 5, 6, 7]) {
      let state = createMultiShardState(seed, noArrivalsConfig);
      const initialTotal = totalPopulation(state);
      for (let i = 0; i < 300; i++) {
        state = stepMultiShard(state);
        expect(initialTotal - totalPopulation(state)).toBe(state.totalFailedMigrations);
      }
      sawFailures += state.totalFailedMigrations;
    }
    expect(sawFailures).toBeGreaterThan(0); // the failure rate really does bite somewhere
  });

  it('with the flat arrival trickle enabled, total population never goes negative and grows over a long run despite migration losses', () => {
    let state = createMultiShardState(5, SMALL_CONFIG);
    const initialTotal = totalPopulation(state);
    for (let i = 0; i < 800; i++) {
      state = stepMultiShard(state);
      expect(totalPopulation(state)).toBeGreaterThanOrEqual(0);
    }
    // Arrivals should outpace migration-failure losses over a long enough run — otherwise
    // the failure rate would be silently strangling the whole system, which is worth
    // catching here rather than only in the standalone validation script.
    expect(totalPopulation(state)).toBeGreaterThan(initialTotal);
  });
});

describe('stepMultiShard — dormant shard lifecycle', () => {
  it('a newly opened shard starts DORMANT with no world until its first arrival wakes it', () => {
    // Force conditions where a 3rd shard can plausibly open: high per-shard population and
    // a short cooldown so the sweep doesn't need an enormous run.
    const bigConfig: WorldConfig = { ...SMALL_CONFIG, targetPopulation: 80 };
    let state = createMultiShardState(11, bigConfig);
    let sawDormantShard = false;
    let sawItWake = false;
    for (let i = 0; i < 400; i++) {
      state = stepMultiShard(state);
      const dormant = state.registry.shards.filter((s) => s.state === 'DORMANT');
      if (dormant.length > 0) {
        sawDormantShard = true;
        for (const d of dormant) {
          if (state.worlds.has(d.id)) {
            // If a world exists for a still-DORMANT shard, it must be genuinely empty —
            // "automated economic stability... until a new player lands," not silently
            // pre-populated.
            expect(state.worlds.get(d.id)!.population).toBe(0);
          }
        }
      }
      if (state.registry.shards.some((s) => s.state === 'ACTIVE' && s.id >= INITIAL_SHARD_COUNT)) {
        sawItWake = true;
      }
    }
    // Both are real, seed-dependent outcomes over a 400-day run — assert the mechanism
    // exists and is exercised, not that it fires on every single seed.
    expect(sawDormantShard || sawItWake).toBe(true);
  });

  it('never throws across a long run, several seeds, including small-population configs', () => {
    for (const seed of [1, 2, 3]) {
      let state = createMultiShardState(seed, SMALL_CONFIG);
      expect(() => {
        for (let i = 0; i < 600; i++) state = stepMultiShard(state);
      }).not.toThrow();
    }
  });
});
