import { describe, expect, it } from 'vitest';
import {
  injectSyntheticPosts,
  runIdentityResolutionSweep,
  summarizeByClassification,
  SYNTHETIC_POST_PROBABILITY,
} from '../src/sim/identityResolutionHarness.js';
import { createWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { mulberry32 } from '../src/sim/rng.js';

/**
 * Regression tests for the identity-resolution core-vs-periphery sweep — answers the
 * 2026-08-11 addendum's own "report back explicitly on" question with real numbers, per
 * CLAUDE.md constraint 1 ("simulate before trusting"), rather than leaving it as an assumed
 * consequence of `identity.ts`'s own header comment.
 */

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
  it('averaged across seeds, periphery subjects take measurably longer to resolve than core subjects — a real, not-too-small-to-feel effect', () => {
    // Per-seed direction is noisy (identity.ts's own header predicts the DIRECTION, not that
    // every single seed obeys it) — one seed out of five measured during development actually
    // reversed. The honest claim this test encodes is the multi-seed AVERAGE, which is what
    // "meaningful, not just directional" actually means. See identityResolutionReport.ts for
    // the full per-seed breakdown this summarizes.
    const seeds = [1, 2, 3, 4, 5];
    const coreMeans: number[] = [];
    const peripheryMeans: number[] = [];
    for (const seed of seeds) {
      const results = runIdentityResolutionSweep(seed, 120);
      const core = summarizeByClassification(results, 'core');
      const periphery = summarizeByClassification(results, 'periphery');
      if (core.meanResolvedDay !== null) coreMeans.push(core.meanResolvedDay);
      if (periphery.meanResolvedDay !== null) peripheryMeans.push(periphery.meanResolvedDay);
    }
    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const coreMean = mean(coreMeans);
    const peripheryMean = mean(peripheryMeans);

    // Measured (2026-08-12, this exact sweep): core ~30.1 days, periphery ~40.5 days — a real
    // ~35% gap. Asserts a materially smaller margin (15%) than what was actually measured, so
    // this stays a genuine hard filter against the gap disappearing or reversing on average,
    // without being so tight that ordinary simulation noise trips it.
    expect(peripheryMean).toBeGreaterThan(coreMean * 1.15);
  });

  it('the effect is on SPEED, not final reach — given enough time, resolution rates converge regardless of density', () => {
    // Answers the other half of "meaningful, or too small to feel": if periphery role-holders
    // simply never became known regardless of horizon, that would be a much larger problem
    // (a structural exclusion, not a pacing difference) — constraint 2/6 territory. Confirms
    // it is not: given a long enough run, periphery resolution catches up to near-total too.
    const seeds = [1, 2, 3];
    for (const seed of seeds) {
      const results = runIdentityResolutionSweep(seed, 250);
      const periphery = summarizeByClassification(results, 'periphery');
      expect(periphery.resolvedFraction).toBeGreaterThan(0.85);
    }
  });
});
