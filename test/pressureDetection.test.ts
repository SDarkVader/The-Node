import { describe, expect, it } from 'vitest';
import {
  PRESSURE_CLUSTER_STATES,
  emptyPressureRecord,
  recordPost,
  pressureSkew,
  isPressureDetected,
  pressureContribution,
  knownFraction,
  PRESSURE_WINDOW_POSTS,
  PRESSURE_MIN_POSTS,
  PRESSURE_SKEW_THRESHOLD,
} from '../src/engine/pressureDetection.js';
import { emptyIdentityLedger, recordEncounter, IDENTITY_RESOLUTION_THRESHOLD } from '../src/engine/identity.js';
import { SELF_STATES } from '../src/comms/grammar.js';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import type { WallPost } from '../src/comms/grammar.js';

/**
 * Regression tests for Pressure Detection (2026-08-12 addendum, §4) — verified in isolation
 * before trusting it wired into `world.ts`, per CLAUDE.md constraint 1. The load-bearing
 * property throughout: this module NEVER identifies a player — see its own header and
 * ADVERSARIAL_CONTAINMENT.md's resolution of why naming was rejected. Every test here checks
 * a magnitude, never asserts anything is exposed by identity.
 */

describe('PRESSURE_CLUSTER_STATES', () => {
  it('is exactly the five states with no informational content beyond distress/threat', () => {
    expect([...PRESSURE_CLUSTER_STATES].sort()).toEqual(
      ['distrustful', 'exploited', 'manipulated', 'suspicious', 'uneasy'].sort(),
    );
  });

  it('every cluster state is a real, declared self-state — none invented', () => {
    for (const s of PRESSURE_CLUSTER_STATES) {
      expect(SELF_STATES).toContain(s);
    }
  });

  it('the five positive/neutral states are excluded', () => {
    for (const s of ['isolated', 'overwhelmed', 'hopeful', 'secure', 'grateful'] as const) {
      expect(PRESSURE_CLUSTER_STATES.has(s)).toBe(false);
    }
  });
});

describe('recordPost / pressureSkew', () => {
  it('starts at 0 skew with no posts, never NaN', () => {
    expect(pressureSkew(emptyPressureRecord())).toBe(0);
  });

  it('skew is the fraction of in-window posts that were pressure-cluster states', () => {
    let record = emptyPressureRecord();
    record = recordPost(record, 1, 'suspicious'); // pressure
    record = recordPost(record, 2, 'hopeful'); // not
    record = recordPost(record, 3, 'distrustful'); // pressure
    record = recordPost(record, 4, 'grateful'); // not
    expect(pressureSkew(record)).toBeCloseTo(0.5, 10);
  });

  it('bounds the window to PRESSURE_WINDOW_POSTS, dropping the oldest first', () => {
    let record = emptyPressureRecord();
    for (let i = 0; i < PRESSURE_WINDOW_POSTS + 10; i++) {
      record = recordPost(record, i, i < 10 ? 'suspicious' : 'hopeful');
    }
    expect(record.recent.length).toBe(PRESSURE_WINDOW_POSTS);
    // The first 10 pressure-cluster posts should have fallen off the front.
    expect(pressureSkew(record)).toBe(0);
  });

  it('is a pure function — does not mutate the record passed in', () => {
    const before = emptyPressureRecord();
    recordPost(before, 1, 'suspicious');
    expect(before.recent.length).toBe(0);
  });
});

describe('isPressureDetected', () => {
  it('is false below PRESSURE_MIN_POSTS regardless of skew', () => {
    let record = emptyPressureRecord();
    for (let i = 0; i < PRESSURE_MIN_POSTS - 1; i++) record = recordPost(record, i, 'suspicious');
    expect(isPressureDetected(record)).toBe(false);
  });

  it('is false at or above the post minimum if skew is below threshold', () => {
    let record = emptyPressureRecord();
    for (let i = 0; i < PRESSURE_MIN_POSTS; i++) record = recordPost(record, i, i % 2 === 0 ? 'suspicious' : 'hopeful');
    expect(pressureSkew(record)).toBeLessThan(PRESSURE_SKEW_THRESHOLD);
    expect(isPressureDetected(record)).toBe(false);
  });

  it('is true once both the post minimum and skew threshold are cleared', () => {
    let record = emptyPressureRecord();
    for (let i = 0; i < PRESSURE_MIN_POSTS; i++) record = recordPost(record, i, 'suspicious');
    expect(isPressureDetected(record)).toBe(true);
  });
});

describe('pressureContribution — magnitude only, never identity', () => {
  it('is 0 when not detected, regardless of known fraction', () => {
    const record = emptyPressureRecord();
    expect(pressureContribution(record, 1)).toBe(0);
  });

  it('scales with how far skew is past the threshold, not just whether it cleared it', () => {
    const barelyPast = (() => {
      let r = emptyPressureRecord();
      // 8 posts, skew just over threshold (0.7): 6 pressure, 2 not = 0.75
      for (let i = 0; i < 6; i++) r = recordPost(r, i, 'suspicious');
      for (let i = 6; i < 8; i++) r = recordPost(r, i, 'hopeful');
      return r;
    })();
    const maxedOut = (() => {
      let r = emptyPressureRecord();
      for (let i = 0; i < 8; i++) r = recordPost(r, i, 'suspicious'); // skew 1.0
      return r;
    })();
    expect(pressureContribution(barelyPast, 0)).toBeGreaterThan(0);
    expect(pressureContribution(maxedOut, 0)).toBeGreaterThan(pressureContribution(barelyPast, 0));
  });

  it('a higher known fraction amplifies the same detected pattern', () => {
    // Skew must land strictly BETWEEN the threshold and 1.0 for this comparison to be
    // meaningful — at skew 1.0, base contribution is already 1.0 and both known=0 and
    // known=1 clamp to the same ceiling, which would make amplification invisible without
    // actually being absent. 6 pressure + 2 not = 0.75, comfortably past 0.7 but not maxed.
    let record = emptyPressureRecord();
    for (let i = 0; i < 6; i++) record = recordPost(record, i, 'suspicious');
    for (let i = 6; i < 8; i++) record = recordPost(record, i, 'hopeful');
    const unknown = pressureContribution(record, 0);
    const known = pressureContribution(record, 1);
    expect(known).toBeGreaterThan(unknown);
  });

  it('never exceeds 1 even at maximum skew and maximum known fraction', () => {
    let record = emptyPressureRecord();
    for (let i = 0; i < PRESSURE_MIN_POSTS; i++) record = recordPost(record, i, 'suspicious');
    expect(pressureContribution(record, 1)).toBeLessThanOrEqual(1);
  });
});

describe('knownFraction', () => {
  it('is 0 when nobody has resolved anyone yet', () => {
    expect(knownFraction(emptyIdentityLedger(), 'wren')).toBe(0);
  });

  it('is the fraction of all observers who have specifically resolved the subject', () => {
    let ledger = emptyIdentityLedger();
    for (let i = 0; i < IDENTITY_RESOLUTION_THRESHOLD; i++) ledger = recordEncounter(ledger, 'a', 'wren');
    ledger = recordEncounter(ledger, 'b', 'sable'); // b has resolved someone, but not wren
    expect(knownFraction(ledger, 'wren')).toBeCloseTo(0.5, 10); // 1 of 2 observers resolved wren
  });
});

describe('integration — pressureLedger is wired into stepWorld and feeds District Weather', () => {
  it('starts empty at world creation', () => {
    const world = createWorld(1, DEFAULT_WORLD_CONFIG);
    expect(Object.keys(world.pressureLedger).length).toBe(0);
  });

  it('grows only from real Wall posts, never spontaneously', () => {
    let world = createWorld(1, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 10; i++) world = stepWorld(world); // no posts queued
    expect(Object.keys(world.pressureLedger).length).toBe(0);
  });

  it('a sustained pressure-cluster poster measurably raises their own district\'s tension relative to a positive poster', () => {
    const negativeAuthor = () => createWorld(3, DEFAULT_WORLD_CONFIG).millers[0]!.buildingId;
    const authorId = negativeAuthor();

    let negativeWorld = createWorld(3, DEFAULT_WORLD_CONFIG);
    let positiveWorld = createWorld(3, DEFAULT_WORLD_CONFIG);
    const authorDistrictId = negativeWorld.shard.districts.find((d) => d.buildings.some((b) => b.id === authorId))!.id;

    for (let day = 0; day < 40; day++) {
      const negPost: WallPost = { id: `n-${day}`, authorId, state: 'suspicious', day };
      const posPost: WallPost = { id: `p-${day}`, authorId, state: 'hopeful', day };
      negativeWorld = stepWorld({ ...negativeWorld, pendingWallPosts: [negPost] });
      positiveWorld = stepWorld({ ...positiveWorld, pendingWallPosts: [posPost] });
    }

    const negTension = negativeWorld.shard.districts.find((d) => d.id === authorDistrictId)!.weatherHistory.at(-1)!.tension;
    const posTension = positiveWorld.shard.districts.find((d) => d.id === authorDistrictId)!.weatherHistory.at(-1)!.tension;
    expect(negTension).toBeGreaterThan(posTension);
  });

  it('never exposes the author id anywhere except the same buildingId-keyed granularity every other per-slot map already uses', () => {
    // Structural check: pressureLedger keys are buildingIds, same as completionStats,
    // identityLedger's inner maps, etc — not a new, separately-named "who is this" channel.
    let world = createWorld(4, DEFAULT_WORLD_CONFIG);
    const authorId = world.millers[0]!.buildingId;
    for (let day = 0; day < PRESSURE_MIN_POSTS; day++) {
      const post: WallPost = { id: `w-${day}`, authorId, state: 'suspicious', day };
      world = stepWorld({ ...world, pendingWallPosts: [post] });
    }
    expect(Object.keys(world.pressureLedger)).toContain(authorId);
  });
});
