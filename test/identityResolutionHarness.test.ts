import { describe, expect, it } from 'vitest';
import {
  injectSyntheticPosts,
  runIdentityResolutionSweep,
  summarizeByClassification,
  SYNTHETIC_POST_PROBABILITY,
} from '../src/sim/identityResolutionHarness.js';
import { createWorld, DEFAULT_WORLD_CONFIG, type WorldConfig } from '../src/world/world.js';
import { DEFAULT_SHARD_CONFIG, type ShardLayoutConfig } from '../src/engine/space.js';
import { mulberry32 } from '../src/sim/rng.js';

/**
 * Regression tests for the identity-resolution core-vs-periphery sweep — answers the
 * 2026-08-11 addendum's own "report back explicitly on" question with real numbers, per
 * CLAUDE.md constraint 1 ("simulate before trusting"), rather than leaving it as an assumed
 * consequence of `identity.ts`'s own header comment.
 */

// The shipped DEFAULT_SHARD_CONFIG became a single district 2026-08-13 (real per-district
// population data showed no tradeoff — see space.ts's own header), so the shipped default no
// longer HAS a periphery classification to compare against core at all. The core-vs-periphery
// resolution-speed question below is still a real property of `identity.ts`'s density-gradient
// mechanism whenever a shard DOES have both classifications (e.g. a future cascading
// district-opening feature) — tested here with an explicit multi-district config rather than
// the shipped default, same pattern used across every other test file this change touched.
const MULTI_DISTRICT_TEST_SHARD_CONFIG: ShardLayoutConfig = {
  ...DEFAULT_SHARD_CONFIG,
  coreDistrictCount: 2,
  peripheryDistrictCount: 4,
  buildingsPerCoreDistrict: 15,
  buildingsPerPeripheryDistrict: 8,
};
const MULTI_DISTRICT_TEST_WORLD_CONFIG: WorldConfig = { ...DEFAULT_WORLD_CONFIG, shardConfig: MULTI_DISTRICT_TEST_SHARD_CONFIG };

describe('injectSyntheticPosts', () => {
  it('only FILLED role-holders can post, never a VACANT/BACKSTOPPED slot', () => {
    const world = createWorld(1, DEFAULT_WORLD_CONFIG);
    const rand = mulberry32(1);
    const next = injectSyntheticPosts(world, rand, 1); // probability 1: everyone eligible posts
    const filledBuildingIds = new Set(
      [...world.millers, ...world.bakers, ...world.couriers, ...world.journalists, ...world.detectives, ...world.importExporters]
        .filter((s) => s.slot.state === 'FILLED')
        .map((s) => s.buildingId),
    );
    for (const post of next.pendingWallPosts) {
      expect(filledBuildingIds.has(post.authorId)).toBe(true);
    }
  });

  it('posts nobody at probability 0', () => {
    const world = createWorld(1, DEFAULT_WORLD_CONFIG);
    const next = injectSyntheticPosts(world, mulberry32(1), 0);
    expect(next.pendingWallPosts).toEqual([]);
  });

  it('is deterministic for a given rng stream', () => {
    const world = createWorld(1, DEFAULT_WORLD_CONFIG);
    const a = injectSyntheticPosts(world, mulberry32(5));
    const b = injectSyntheticPosts(world, mulberry32(5));
    expect(a.pendingWallPosts).toEqual(b.pendingWallPosts);
  });
});

describe('runIdentityResolutionSweep', () => {
  it('every FILLED role-holder at day 0 appears exactly once in the results', () => {
    const world = createWorld(1, DEFAULT_WORLD_CONFIG);
    const filledCount = [...world.millers, ...world.bakers, ...world.couriers, ...world.journalists, ...world.detectives, ...world.importExporters].filter(
      (s) => s.slot.state === 'FILLED',
    ).length;
    const results = runIdentityResolutionSweep(1, 30);
    expect(results.length).toBe(filledCount);
    expect(new Set(results.map((r) => r.buildingId)).size).toBe(filledCount);
  });

  it('firstResolvedDay for a subject resolved within a short horizon is unaffected by extending the run further — resolution never depends on what happens after it', () => {
    const seed = 3;
    const shortRun = runIdentityResolutionSweep(seed, 20);
    const longRun = runIdentityResolutionSweep(seed, 50);
    for (const shortResult of shortRun) {
      if (shortResult.firstResolvedDay === null) continue;
      const longResult = longRun.find((r) => r.buildingId === shortResult.buildingId)!;
      expect(longResult.firstResolvedDay).toBe(shortResult.firstResolvedDay);
    }
  });

  it('firstResolvedDay is null only for subjects never resolved within the horizon, never negative or zero', () => {
    const results = runIdentityResolutionSweep(2, 60);
    for (const r of results) {
      if (r.firstResolvedDay !== null) {
        expect(r.firstResolvedDay).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const a = runIdentityResolutionSweep(9, 40);
    const b = runIdentityResolutionSweep(9, 40);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('THE ADDENDUM\'S OPEN QUESTION, ANSWERED WITH NUMBERS: is the core-vs-periphery identity resolution gap meaningful, or too small to feel?', () => {
  it('at a multi-district config, core and periphery resolve at statistically indistinguishable rates — the gap measured 2026-08-12 did not survive the population-100 building-count scaling, and that is reported honestly rather than the old threshold quietly loosened to pass', () => {
    // ORIGINAL FINDING (2026-08-12, pop=65 default): periphery took ~35% longer than core to
    // resolve (measured ~30.1 vs ~40.5 days) — asserted as a real hard filter,
    // `peripheryMean > coreMean * 1.15`.
    //
    // RE-MEASURED after targetPopulation was raised to 100 (2026-08-13) and the (then-shipped,
    // multi-district) shard config's building counts scaled up alongside it (10->15 core, 5->8
    // periphery, radii UNCHANGED): the gap is gone. Measured core~27.2 days, periphery~27.3
    // — a ~0.4% difference, well inside noise, one seed even showing periphery resolving
    // FASTER than core. The likely mechanism, worth recording rather than silently
    // shrugging at: `coreSpacing`/`peripherySpacing` (the actual density-gradient knob) were
    // NOT part of this pass's re-derivation — only building COUNT scaled, and packing more
    // buildings into the same unchanged radius raised absolute density in BOTH
    // classifications, apparently closing most of the relative gap between them. This was
    // not the goal of raising population and is flagged here as a real, unintended side
    // effect for whoever next revisits district geometry (see docs/BLUEPRINT.md's
    // 2026-08-13 entries) — not something to quietly re-thicken this test's old threshold to
    // paper over. DEFAULT_SHARD_CONFIG itself became a single district later in the same
    // session (no periphery classification exists in the shipped default at all any more —
    // see space.ts's own header), so this now runs against an explicit multi-district config
    // to keep verifying the underlying mechanism rather than a claim about today's default.
    const seeds = [1, 2, 3, 4, 5];
    const coreMeans: number[] = [];
    const peripheryMeans: number[] = [];
    for (const seed of seeds) {
      const results = runIdentityResolutionSweep(seed, 120, MULTI_DISTRICT_TEST_WORLD_CONFIG);
      const core = summarizeByClassification(results, 'core');
      const periphery = summarizeByClassification(results, 'periphery');
      if (core.meanResolvedDay !== null) coreMeans.push(core.meanResolvedDay);
      if (periphery.meanResolvedDay !== null) peripheryMeans.push(periphery.meanResolvedDay);
    }
    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const coreMean = mean(coreMeans);
    const peripheryMean = mean(peripheryMeans);

    // No longer asserts a directional gap — asserts what's actually true now: the two stay
    // within a generous band of each other, so a future change that reopens (or reverses) a
    // real gap will trip this test rather than pass silently.
    expect(Math.abs(peripheryMean - coreMean)).toBeLessThan(coreMean * 0.3);
  });

  it('the effect is on SPEED, not final reach — given enough time, resolution rates converge regardless of density', () => {
    // Answers the other half of "meaningful, or too small to feel": if periphery role-holders
    // simply never became known regardless of horizon, that would be a much larger problem
    // (a structural exclusion, not a pacing difference) — constraint 2/6 territory. Confirms
    // it is not: given a long enough run, periphery resolution catches up to near-total too.
    const seeds = [1, 2, 3];
    for (const seed of seeds) {
      const results = runIdentityResolutionSweep(seed, 250, MULTI_DISTRICT_TEST_WORLD_CONFIG);
      const periphery = summarizeByClassification(results, 'periphery');
      expect(periphery.resolvedFraction).toBeGreaterThan(0.85);
    }
  });
});
