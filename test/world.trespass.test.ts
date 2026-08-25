import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, isTrespassEligible, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';

/**
 * Trespass eligibility wired onto real `World.presence` (2026-08-25). Pure-logic truth table
 * is `test/trespass.test.ts` — these tests prove `isTrespassEligible` reads REAL presence data
 * out of a real, stepped `World`, not a synthetic stand-in.
 */

describe('isTrespassEligible — real World wiring', () => {
  it('a target with no presence record at all (never a FILLED role holder) is never eligible', () => {
    const world = createWorld(1, DEFAULT_WORLD_CONFIG);
    expect(isTrespassEligible(world, 'not-a-real-building', true)).toBe(false);
    expect(isTrespassEligible(world, 'not-a-real-building', false)).toBe(false);
  });

  it('a real FILLED role holder reported offline is eligible regardless of targetAtAbode', () => {
    let world = createWorld(2, DEFAULT_WORLD_CONFIG);
    world = stepWorld(world); // currentlyOnline defaults to empty — everyone offline
    const millerId = world.millers.find((m) => m.slot.state === 'FILLED')!.buildingId;
    expect(world.presence[millerId]?.online).toBe(false);
    expect(isTrespassEligible(world, millerId, true)).toBe(true);
    expect(isTrespassEligible(world, millerId, false)).toBe(true);
  });

  it('a real FILLED role holder reported online is eligible only when reported away from their abode', () => {
    let world = createWorld(3, DEFAULT_WORLD_CONFIG);
    const millerId = world.millers[0]!.buildingId;
    world = { ...world, currentlyOnline: new Set([millerId]) };
    world = stepWorld(world);
    if (world.millers.find((m) => m.buildingId === millerId)?.slot.state !== 'FILLED') return; // vacated this tick — nothing to assert
    expect(world.presence[millerId]?.online).toBe(true);
    expect(isTrespassEligible(world, millerId, true)).toBe(false);
    expect(isTrespassEligible(world, millerId, false)).toBe(true);
  });

  it('eligibility tracks presence across ticks as online/offline actually changes', () => {
    let world = createWorld(4, DEFAULT_WORLD_CONFIG);
    const millerId = world.millers[0]!.buildingId;

    world = { ...world, currentlyOnline: new Set([millerId]) };
    world = stepWorld(world);
    const stillMiller = () => world.millers.find((m) => m.buildingId === millerId)?.slot.state === 'FILLED';
    if (stillMiller()) {
      expect(isTrespassEligible(world, millerId, true)).toBe(false); // online + at abode
    }

    world = { ...world, currentlyOnline: new Set() }; // goes offline
    world = stepWorld(world);
    if (stillMiller()) {
      expect(isTrespassEligible(world, millerId, true)).toBe(true); // offline overrides targetAtAbode
    }
  });
});
