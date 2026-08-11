import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/sim/rng.js';
import {
  createShardRegistry,
  canOpenNewShard,
  openNewShard,
  chooseMigrationDestination,
  setShardPopulation,
  markShardActive,
  INITIAL_SHARD_COUNT,
  SHARD_OPEN_COOLDOWN_DAYS,
  SHARD_OPEN_STABILITY_THRESHOLD,
  SHARD_OPEN_MIN_TOTAL_POPULATION,
} from '../src/engine/shardRegistry.js';

/**
 * Regression tests for the shard-registry primitive (2026-08-11) — verified in isolation
 * before src/sim/multiShardHarness.ts composes it with real World instances.
 */

describe('createShardRegistry', () => {
  it('starts with exactly INITIAL_SHARD_COUNT (2) shards, all ACTIVE', () => {
    const registry = createShardRegistry(65);
    expect(registry.shards.length).toBe(INITIAL_SHARD_COUNT);
    for (const s of registry.shards) {
      expect(s.state).toBe('ACTIVE');
      expect(s.population).toBe(65);
    }
  });

  it('assigns ids 0 and 1, nextShardId continues from there', () => {
    const registry = createShardRegistry(65);
    expect(registry.shards.map((s) => s.id)).toEqual([0, 1]);
    expect(registry.nextShardId).toBe(2);
  });
});

describe('canOpenNewShard — all three gates independently required', () => {
  it('refuses when total population is below the minimum, even if "healthy"', () => {
    const registry = createShardRegistry(10); // total 20, well under SHARD_OPEN_MIN_TOTAL_POPULATION
    expect(canOpenNewShard(registry, 1.0, 1000)).toBe(false);
  });

  it('refuses when population is high but stability is below threshold', () => {
    const registry = createShardRegistry(SHARD_OPEN_MIN_TOTAL_POPULATION);
    expect(canOpenNewShard(registry, SHARD_OPEN_STABILITY_THRESHOLD - 0.1, 1000)).toBe(false);
  });

  it('refuses when population and stability are both fine but the cooldown has not elapsed', () => {
    let registry = createShardRegistry(SHARD_OPEN_MIN_TOTAL_POPULATION);
    registry = openNewShard(registry, 100); // lastShardOpenedDay = 100
    expect(canOpenNewShard(registry, 1.0, 100 + SHARD_OPEN_COOLDOWN_DAYS - 1)).toBe(false);
  });

  it('allows opening once population, stability, and cooldown are all satisfied', () => {
    let registry = createShardRegistry(SHARD_OPEN_MIN_TOTAL_POPULATION);
    registry = openNewShard(registry, 100);
    expect(canOpenNewShard(registry, 1.0, 100 + SHARD_OPEN_COOLDOWN_DAYS)).toBe(true);
  });

  it('the very first extra shard (no lastShardOpenedDay yet) is not blocked by the cooldown', () => {
    const registry = createShardRegistry(SHARD_OPEN_MIN_TOTAL_POPULATION);
    expect(canOpenNewShard(registry, 1.0, 0)).toBe(true);
  });
});

describe('openNewShard', () => {
  it('the new shard starts DORMANT, population 0, with a fresh monotonic id', () => {
    const registry = createShardRegistry(65);
    const next = openNewShard(registry, 50);
    expect(next.shards.length).toBe(3);
    const newShard = next.shards[2]!;
    expect(newShard.id).toBe(2);
    expect(newShard.state).toBe('DORMANT');
    expect(newShard.population).toBe(0);
    expect(next.nextShardId).toBe(3);
    expect(next.lastShardOpenedDay).toBe(50);
  });

  it('shard ids only ever increase, never reused, across repeated openings', () => {
    let registry = createShardRegistry(65);
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      registry = openNewShard(registry, i * 100);
      ids.push(registry.shards[registry.shards.length - 1]!.id);
    }
    expect(ids).toEqual([2, 3, 4, 5, 6]);
  });
});

describe('chooseMigrationDestination — never sends anyone somewhere that does not exist', () => {
  it('always returns an id present in the registry, excluding the origin shard', () => {
    const registry = createShardRegistry(65);
    const rng = mulberry32(1);
    for (let i = 0; i < 200; i++) {
      const dest = chooseMigrationDestination(registry, 0, rng);
      expect(dest).not.toBeNull();
      expect(registry.shards.some((s) => s.id === dest)).toBe(true);
      expect(dest).not.toBe(0);
    }
  });

  it('returns null when there is nowhere else to go (single-shard registry)', () => {
    const registry = { shards: [{ id: 0, state: 'ACTIVE' as const, population: 65, openedOnDay: 0 }], nextShardId: 1, lastShardOpenedDay: null };
    const rng = mulberry32(1);
    expect(chooseMigrationDestination(registry, 0, rng)).toBeNull();
  });

  it('prefers a DORMANT shard over any ACTIVE one, so a real arrival wakes it', () => {
    let registry = createShardRegistry(65); // shards 0,1 ACTIVE
    registry = openNewShard(registry, 10); // shard 2 DORMANT
    const rng = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      expect(chooseMigrationDestination(registry, 0, rng)).toBe(2);
    }
  });

  it('spreads across ACTIVE shards toward the lowest population when no DORMANT shard exists', () => {
    let registry = createShardRegistry(65);
    registry = setShardPopulation(registry, 1, 10); // shard 1 much lower than shard 0 (65)
    const rng = mulberry32(1);
    for (let i = 0; i < 20; i++) {
      expect(chooseMigrationDestination(registry, 0, rng)).toBe(1);
    }
  });

  it('is deterministic for a given rng sequence', () => {
    const registry = createShardRegistry(65);
    const a = chooseMigrationDestination(registry, 0, mulberry32(7));
    const b = chooseMigrationDestination(registry, 0, mulberry32(7));
    expect(a).toBe(b);
  });
});

describe('setShardPopulation / markShardActive', () => {
  it('setShardPopulation updates only the targeted shard', () => {
    const registry = createShardRegistry(65);
    const next = setShardPopulation(registry, 0, 40);
    expect(next.shards[0]!.population).toBe(40);
    expect(next.shards[1]!.population).toBe(65);
  });

  it('markShardActive flips a DORMANT shard to ACTIVE without touching others', () => {
    let registry = createShardRegistry(65);
    registry = openNewShard(registry, 10);
    expect(registry.shards[2]!.state).toBe('DORMANT');
    registry = markShardActive(registry, 2);
    expect(registry.shards[2]!.state).toBe('ACTIVE');
    expect(registry.shards[0]!.state).toBe('ACTIVE');
    expect(registry.shards[1]!.state).toBe('ACTIVE');
  });
});
