/**
 * Identity resolution core-vs-periphery sweep (2026-08-11 addendum's own "report back
 * explicitly on" question, still open as of the 2026-08-12 session that finished the
 * addendum's build order: "does identity resolution produce a meaningful core-vs-periphery
 * difference in how fast players become known, or is the effect too small to feel?").
 * Harness-style module (same split as `multiShardHarness.ts`/`multiShardValidation.ts`):
 * pure, exported, testable functions here; the printing report lives in
 * `identityResolutionReport.ts`, which imports this file rather than duplicating it.
 *
 * WHY A SYNTHETIC POSTING DRIVER, AND WHY IT'S FLAGGED RATHER THAN QUIETLY ADDED. `world.ts`'s
 * `pendingWallPosts` defaults to empty and is cleared every tick — nothing in the shipped
 * kernel ever populates it; every existing comms test injects posts by hand for exactly one
 * tick at a time. Measuring identity resolution over a real multi-day run needs SOME ongoing
 * stream of Wall posts to drive it, and no such driver exists anywhere in this codebase yet
 * (`src/sim/drivers/` only covers market-role decisions, not comms content) — so this file
 * adds one, but strictly as a measurement harness, never wired into `stepWorld` or any shipped
 * path, the same "never shipped, structurally guarded" discipline `src/sim/drivers/`'s own
 * README already states for its own synthetic policies.
 *
 * WHAT'S BEING MEASURED, PRECISELY. `identity.ts`'s own header already predicts the
 * qualitative direction: resolution should be faster in the core because
 * `comms/connections.ts`'s proximity graph is denser there (`coreSpacing=1` vs
 * `peripherySpacing=2` in `space.ts`'s shipped default). This harness measures it: for each
 * FILLED role-holder (a `WallPost` "subject"), the first day ANY observer accumulates
 * `IDENTITY_RESOLUTION_THRESHOLD` real encounters with them, split by whether their building
 * sits in a core or periphery district. `summarizeByClassification` reports the size of the
 * gap, not just its direction — the addendum's own question is about MAGNITUDE, not existence.
 */

import { mulberry32 } from './rng.js';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World, type WorldConfig } from '../world/world.js';
import { resolvedSubjects, IDENTITY_RESOLUTION_THRESHOLD } from '../engine/identity.js';
import { SELF_STATES } from '../comms/grammar.js';
import type { WallPost } from '../comms/grammar.js';
import type { DistrictClassification } from '../engine/space.js';

/**
 * Probability any single FILLED role-holder posts to the Wall on a given day. [ILLUSTRATIVE,
 * measurement-harness-only — not a claim about real player posting behaviour]. Chosen high
 * enough that resolution actually happens within a few dozen days at threshold=5 (a near-zero
 * rate would just measure "nobody posts," not the density effect this harness exists to
 * isolate), not tuned to produce any particular result.
 */
export const SYNTHETIC_POST_PROBABILITY = 0.35;

/**
 * Injects one day's worth of synthetic Wall posts from FILLED role-holders, replacing
 * `world.pendingWallPosts` — mirrors exactly how `test/world.regression.test.ts`'s own comms
 * tests inject posts by hand, just repeated across many days instead of once. Consumes draws
 * from `world.rng` (the same persistent per-world stream every other stage of `stepWorld`
 * already draws from), so a whole sweep run stays deterministic under one seed rather than
 * needing a second RNG stream to reason about.
 */
export function injectSyntheticPosts(world: World, rand: () => number, postProbability: number = SYNTHETIC_POST_PROBABILITY): World {
  const posts: WallPost[] = [];
  let counter = 0;
  for (const arr of [world.millers, world.bakers, world.couriers, world.investigators, world.importExporters]) {
    for (const slot of arr) {
      if (slot.slot.state !== 'FILLED') continue;
      if (rand() >= postProbability) continue;
      const state = SELF_STATES[Math.floor(rand() * SELF_STATES.length)]!;
      posts.push({ id: `synth-${world.tick}-${counter++}`, authorId: slot.buildingId, state, day: world.tick });
    }
  }
  return { ...world, pendingWallPosts: posts };
}

export interface SubjectResolutionResult {
  buildingId: string;
  districtId: string;
  classification: DistrictClassification;
  /** First day ANY observer resolved this subject, or null if never within the run's horizon. */
  firstResolvedDay: number | null;
}

/**
 * Runs a full sweep for one seed: creates a world, injects synthetic Wall posts and steps it
 * `days` times, and reports when (if ever) each FILLED role-holder at day 0 got resolved by
 * at least one real observer. Subjects are fixed at their day-0 role-holder set — a role
 * changing hands mid-run isn't tracked as a new subject, matching every other sweep script's
 * snapshot-based framing rather than trying to be fully general.
 */
export function runIdentityResolutionSweep(
  seed: number,
  days: number,
  config: WorldConfig = DEFAULT_WORLD_CONFIG,
  postProbability: number = SYNTHETIC_POST_PROBABILITY,
): SubjectResolutionResult[] {
  let world = createWorld(seed, config);

  const buildingDistrict = new Map<string, { districtId: string; classification: DistrictClassification }>();
  for (const d of world.shard.districts) {
    for (const b of d.buildings) buildingDistrict.set(b.id, { districtId: d.id, classification: d.classification });
  }

  const subjects = new Set<string>();
  for (const arr of [world.millers, world.bakers, world.couriers, world.investigators, world.importExporters]) {
    for (const slot of arr) if (slot.slot.state === 'FILLED') subjects.add(slot.buildingId);
  }

  const firstResolvedDay = new Map<string, number>();

  for (let i = 0; i < days; i++) {
    world = injectSyntheticPosts(world, world.rng, postProbability);
    world = stepWorld(world);

    if (firstResolvedDay.size === subjects.size) break; // everyone already resolved

    for (const subjectId of subjects) {
      if (firstResolvedDay.has(subjectId)) continue;
      for (const observerId of world.identityLedger.keys()) {
        if (observerId === subjectId) continue;
        if (resolvedSubjects(world.identityLedger, observerId, IDENTITY_RESOLUTION_THRESHOLD).has(subjectId)) {
          firstResolvedDay.set(subjectId, world.tick);
          break;
        }
      }
    }
  }

  return [...subjects].map((buildingId) => {
    const info = buildingDistrict.get(buildingId)!;
    return {
      buildingId,
      districtId: info.districtId,
      classification: info.classification,
      firstResolvedDay: firstResolvedDay.get(buildingId) ?? null,
    };
  });
}

export interface ClassificationSummary {
  count: number;
  resolvedCount: number;
  resolvedFraction: number;
  /** Mean first-resolved day among only those actually resolved within the run — null if none were. */
  meanResolvedDay: number | null;
}

/** Aggregates one classification's slice of a sweep's results — the actual size of the gap, not just its direction. */
export function summarizeByClassification(
  results: readonly SubjectResolutionResult[],
  classification: DistrictClassification,
): ClassificationSummary {
  const subset = results.filter((r) => r.classification === classification);
  const resolved = subset.filter((r) => r.firstResolvedDay !== null);
  const meanResolvedDay = resolved.length ? resolved.reduce((sum, r) => sum + r.firstResolvedDay!, 0) / resolved.length : null;
  return {
    count: subset.length,
    resolvedCount: resolved.length,
    resolvedFraction: subset.length ? resolved.length / subset.length : 0,
    meanResolvedDay,
  };
}
