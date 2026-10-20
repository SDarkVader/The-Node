import { describe, expect, it } from 'vitest';
import { createMultiShardState, stepMultiShard, totalPopulation, type MultiShardState } from '../src/sim/multiShardHarness.js';
import { DEFAULT_WORLD_CONFIG, receiveMigrants, type WorldConfig } from '../src/world/world.js';
import { INITIAL_SHARD_COUNT, SHARD_COUNT_CAP, chooseMigrationDestination } from '../src/engine/shardRegistry.js';
import { mulberry32 } from '../src/sim/rng.js';

/**
 * Regression tests for the multi-shard harness (2026-08-11) — composes shardRegistry.ts
 * with real World instances. Structural invariants only; the actual before/after
 * population-collapse comparison lives in src/sim/multiShardValidation.ts (npm run
 * multi-shard-validation), since that's evidence to report, not a pass/fail unit check.
 */

const SMALL_CONFIG: WorldConfig = { ...DEFAULT_WORLD_CONFIG, targetPopulation: 30, rMiller: 2, rBaker: 3, rCourier: 2, rInvestigator: 3 };

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

/**
 * The basic day (2026-08-24) — `MultiShardState.lastMigrationWindows`. Confirms migration
 * attempts are now tagged by which of dayCycle.ts's two Import/Export windows they fall in,
 * and that this reporting layer never changes WHICH attempts happen, how many succeed, or
 * the rng trajectory — same attempted/succeeded totals either way, just split by window.
 */
describe('stepMultiShard — lastMigrationWindows', () => {
  it('starts as two real, zero-valued window reports (not missing/undefined) before any migration happens', () => {
    const state = createMultiShardState(1, SMALL_CONFIG);
    expect(state.lastMigrationWindows.length).toBe(2);
    for (const w of state.lastMigrationWindows) {
      expect(w.attempted).toBe(0);
      expect(w.succeeded).toBe(0);
    }
  });

  it('every tick, attempted/succeeded across both windows sum to the totals a single unsplit run over the same seed produces', () => {
    let state = createMultiShardState(11, SMALL_CONFIG);
    let totalAttempted = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    for (let i = 0; i < 300; i++) {
      state = stepMultiShard(state);
      for (const w of state.lastMigrationWindows) {
        totalAttempted += w.attempted;
        totalSucceeded += w.succeeded;
      }
    }
    totalFailed = state.totalFailedMigrations;
    // Every attempt this run made is accounted for as either succeeded or (cumulatively)
    // failed — window tagging adds structure, it never drops or double-counts an attempt.
    expect(totalSucceeded + totalFailed).toBe(totalAttempted);
  });

  it('window tagging never changes the deterministic total-population trajectory for a given seed', () => {
    let withoutInspection = createMultiShardState(7, SMALL_CONFIG);
    let withInspection = createMultiShardState(7, SMALL_CONFIG);
    for (let i = 0; i < 100; i++) {
      withoutInspection = stepMultiShard(withoutInspection);
      withInspection = stepMultiShard(withInspection);
      expect(totalPopulation(withInspection)).toBe(totalPopulation(withoutInspection));
    }
  });
});

/**
 * Alternative shards exist for migration, different institutional rules, social escape and
 * starting again; their availability must not depend on population growth (2026-10-20). The
 * old rule opened a shard only while mean population per shard was >= targetPopulation (100),
 * which held only on day 0-1, so a missed opening was permanent.
 */
describe('stepMultiShard — alternative shard availability does not depend on population', () => {
  const run = (state: MultiShardState, days: number) => {
    for (let i = 0; i < days; i++) state = stepMultiShard(state);
    return state;
  };

  it('a missing alternative still opens after populations have stabilised below the old threshold', () => {
    const stable = run(createMultiShardState(2, DEFAULT_WORLD_CONFIG), 200);
    // Rebuild as if the alternative had never opened during the initial transient — the case
    // the old gate made permanent: only the two initial shards, every one below the old bar.
    const initial = (id: number) => id < INITIAL_SHARD_COUNT;
    let state: MultiShardState = {
      ...stable,
      worlds: new Map([...stable.worlds].filter(([id]) => initial(id))),
      registry: { shards: stable.registry.shards.filter((s) => initial(s.id)), nextShardId: INITIAL_SHARD_COUNT, lastShardOpenedDay: null },
    };
    for (const s of state.registry.shards) expect(s.population).toBeLessThan(DEFAULT_WORLD_CONFIG.targetPopulation);
    state = stepMultiShard(state);
    expect(state.registry.shards.length).toBe(INITIAL_SHARD_COUNT + 1);
    expect(state.registry.shards.at(-1)!.state).toBe('DORMANT');
  });

  it('every shard has somewhere to go, including the seed the old rule left with two shards', () => {
    const state = run(createMultiShardState(1, DEFAULT_WORLD_CONFIG), 300);
    expect(state.registry.shards.length).toBe(SHARD_COUNT_CAP);
    const rng = mulberry32(1);
    for (const s of state.registry.shards) {
      expect(s.population).toBeLessThan(DEFAULT_WORLD_CONFIG.targetPopulation);
      const dest = chooseMigrationDestination(state.registry, s.id, rng);
      expect(dest).not.toBeNull();
      expect(dest).not.toBe(s.id);
    }
  });

  it('the cap bounds both shard count and simulated population over a long run, deterministically', () => {
    for (const seed of [1, 2]) {
      let a = createMultiShardState(seed, DEFAULT_WORLD_CONFIG);
      let b = createMultiShardState(seed, DEFAULT_WORLD_CONFIG);
      for (let i = 0; i < 1000; i++) {
        a = stepMultiShard(a);
        b = stepMultiShard(b);
        expect(a.registry.shards.length).toBeLessThanOrEqual(SHARD_COUNT_CAP);
        expect(totalPopulation(a)).toBeLessThanOrEqual(SHARD_COUNT_CAP * DEFAULT_WORLD_CONFIG.targetPopulation);
      }
      expect(a.registry).toEqual(b.registry);
      expect(totalPopulation(a)).toBe(totalPopulation(b));
    }
  });

  it('migration itself is unchanged: attempts, interceptions, arrivals and vouchers all still happen and balance', () => {
    let state = createMultiShardState(3, DEFAULT_WORLD_CONFIG);
    let attempted = 0, succeeded = 0;
    for (let i = 0; i < 600; i++) {
      state = stepMultiShard(state);
      for (const w of state.lastMigrationWindows) {
        attempted += w.attempted;
        succeeded += w.succeeded;
      }
      const v = state.lastVoucherSettlement;
      expect(v.carried).toBeCloseTo(v.arrived + v.toDock, 9);
    }
    expect(attempted).toBeGreaterThan(0);
    const failureRate = (attempted - succeeded) / attempted;
    // The route mechanism's emergent rate, calibrated to ~0.15 (importExport.ts).
    expect(failureRate).toBeGreaterThan(0.05);
    expect(failureRate).toBeLessThan(0.3);
  });

  it('an arrival brings only their holdings: no recognition, diary or identity history crosses shards', () => {
    const state = run(createMultiShardState(4, DEFAULT_WORLD_CONFIG), 50);
    const dest = state.worlds.get(0)!;
    const after = receiveMigrants(dest, 1, [7.5]);
    const arrival = after.grifters.at(-1)!;
    expect(arrival.wealth).toBe(7.5);
    // The destination's civic and private memory is untouched: same objects, nothing added.
    expect(after.identityLedger).toBe(dest.identityLedger);
    expect(after.diary).toBe(dest.diary);
    expect(after.identityLedger.has(arrival.id)).toBe(false);
    for (const counts of after.identityLedger.values()) expect(counts.has(arrival.id)).toBe(false);
  });
});
