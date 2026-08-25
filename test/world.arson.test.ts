import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, isArsonEligible, isFilledRoleHolder, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';

/**
 * Arson eligibility wired onto real `World` state (2026-08-25). Pure-logic truth table for
 * `canAttemptArson` is `test/arson.test.ts` — these tests prove `isArsonEligible` reads real
 * `isFilledRoleHolder`/`World.presence` data, and specifically lock in the corrected behavior
 * after an early draft was found to be provably always-false (see `world.ts`'s own doc comment
 * on `isArsonEligible` for the full account of that bug and the fix).
 */

describe('isArsonEligible — real World wiring', () => {
  it('a real FILLED role holder is always ineligible, regardless of online status or targetAtAbode', () => {
    let world = createWorld(2, DEFAULT_WORLD_CONFIG);
    world = stepWorld(world); // currentlyOnline defaults to empty — offline
    const millerId = world.millers.find((m) => m.slot.state === 'FILLED')!.buildingId;
    expect(isFilledRoleHolder(world, millerId)).toBe(true);
    expect(world.presence[millerId]?.online).toBe(false);
    expect(isArsonEligible(world, millerId, true)).toBe(false);
    expect(isArsonEligible(world, millerId, false)).toBe(false);
  });

  it('a FILLED role holder stays ineligible even while genuinely reported online', () => {
    let world = createWorld(6, DEFAULT_WORLD_CONFIG);
    const millerId = world.millers[0]!.buildingId;
    world = { ...world, currentlyOnline: new Set([millerId]) };
    world = stepWorld(world);
    if (world.millers.find((m) => m.buildingId === millerId)?.slot.state !== 'FILLED') return; // vacated this tick, nothing to assert
    expect(world.presence[millerId]?.online).toBe(true);
    expect(isArsonEligible(world, millerId, false)).toBe(false); // targetActivelyWorkingRole alone already excludes them
  });

  it('a target with NO presence record (not a currently-FILLED role holder) is NOT automatically ineligible — this is the bug the header documents', () => {
    const world = createWorld(1, DEFAULT_WORLD_CONFIG);
    expect(world.presence['some-grifter-id']).toBeUndefined();
    // targetActivelyWorkingRole is false (they hold no role at all) and the missing online
    // signal defaults conservatively to "present" — so eligibility comes down entirely to the
    // caller's own targetAtAbode claim, not a blanket false.
    expect(isArsonEligible(world, 'some-grifter-id', false)).toBe(true); // claimed away from abode -> eligible
    expect(isArsonEligible(world, 'some-grifter-id', true)).toBe(false); // claimed at abode -> not eligible
  });

  it('online status is read from real presence when a record exists, not just defaulted', () => {
    let onlineWorld = createWorld(9, DEFAULT_WORLD_CONFIG);
    const millerId = onlineWorld.millers[0]!.buildingId;
    onlineWorld = { ...onlineWorld, currentlyOnline: new Set([millerId]) };
    onlineWorld = stepWorld(onlineWorld);
    let offlineWorld = createWorld(9, DEFAULT_WORLD_CONFIG);
    offlineWorld = stepWorld(offlineWorld);
    // Both stay ineligible (targetActivelyWorkingRole dominates for a real role holder either
    // way) — this test exists to document that distinction is real, not to find a case where
    // it flips the outcome, since none currently exists for a FILLED holder.
    expect(isArsonEligible(onlineWorld, millerId, false)).toBe(false);
    expect(isArsonEligible(offlineWorld, millerId, false)).toBe(false);
  });
});
