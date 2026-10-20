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
  SHARD_COUNT_CAP,
} from '../src/engine/shardRegistry.js';

const TARGET_POPULATION = 65;

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

describe('canOpenNewShard — availability does not depend on population (2026-10-20)', () => {
  // A cap above the default, so the cooldown and stability gates can be exercised in isolation.
  const ROOMY = 10;

  it('opens an alternative for populations stabilised below the old threshold (old rule: mean >= targetPopulation)', () => {
    // The exact case the old gate blocked: shards settle well below targetPopulation (100).
    let registry = createShardRegistry(100);
    registry = setShardPopulation(registry, 0, 62);
    registry = setShardPopulation(registry, 1, 58);
    expect(canOpenNewShard(registry, 0.9, 900)).toBe(true);
  });

  it('even a nearly empty settlement still gets its alternative', () => {
    let registry = createShardRegistry(100);
    registry = setShardPopulation(registry, 0, 3);
    registry = setShardPopulation(registry, 1, 0);
    expect(canOpenNewShard(registry, 0.9, 900)).toBe(true);
  });

  it('opening an alternative raises no population bar for later shards — only the cap and cooldown apply', () => {
    let registry = createShardRegistry(TARGET_POPULATION);
    registry = openNewShard(registry, 0);
    registry = markShardActive(registry, 2);
    registry = setShardPopulation(registry, 2, 5); // a thin new shard: the old rule then refused
    expect(canOpenNewShard(registry, 1.0, SHARD_OPEN_COOLDOWN_DAYS, ROOMY)).toBe(true);
  });

  it('refuses at the cap, whatever the population', () => {
    let registry = createShardRegistry(1000);
    while (registry.shards.length < SHARD_COUNT_CAP) registry = openNewShard(registry, 0);
    expect(canOpenNewShard(registry, 1.0, 10_000)).toBe(false);
  });

  it('refuses when nobody exists anywhere to migrate', () => {
    let registry = createShardRegistry(0);
    expect(canOpenNewShard(registry, 1.0, 1000)).toBe(false);
    registry = setShardPopulation(registry, 0, 1);
    expect(canOpenNewShard(registry, 1.0, 1000)).toBe(true);
  });

  it('refuses when stability is below threshold', () => {
    const registry = createShardRegistry(TARGET_POPULATION);
    expect(canOpenNewShard(registry, SHARD_OPEN_STABILITY_THRESHOLD - 0.1, 1000)).toBe(false);
  });

  it('refuses until the cooldown since the last opening has elapsed, then allows', () => {
    let registry = createShardRegistry(TARGET_POPULATION);
    registry = openNewShard(registry, 100); // lastShardOpenedDay = 100
    expect(canOpenNewShard(registry, 1.0, 100 + SHARD_OPEN_COOLDOWN_DAYS - 1, ROOMY)).toBe(false);
    expect(canOpenNewShard(registry, 1.0, 100 + SHARD_OPEN_COOLDOWN_DAYS, ROOMY)).toBe(true);
  });

  it('the very first extra shard (no lastShardOpenedDay yet) is not blocked by the cooldown', () => {
    const registry = createShardRegistry(TARGET_POPULATION);
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
