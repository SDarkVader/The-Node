import { mulberry32 } from './rng.js';
import { createWorld, stepWorld, createDormantWorld, receiveMigrants, type World, type WorldConfig } from '../world/world.js';
import {
  createShardRegistry,
  canOpenNewShard,
  openNewShard,
  chooseMigrationDestination,
  setShardPopulation,
  markShardActive,
  type ShardRegistry,
} from '../engine/shardRegistry.js';

/**
 * Multi-shard harness (2026-08-11) — composes `shardRegistry.ts` (the lifecycle ledger)
 * with real `World` instances, the same "harness composes pure engine primitives" layering
 * every other harness in this repo already uses. This is the piece that turns `stepWorld`'s
 * newly-exposed `lastEmigrants` into a real, bounded destination instead of a number that
 * silently vanished from the simulation — directly answering the population-collapse
 * finding (`docs/BLUEPRINT.md`'s "5-role roster" entry): `migrationValveStep` was pushing
 * people OUT of a shard with nowhere real to land, an inherently unstable one-way valve.
 *
 * Each ACTIVE-or-populated shard runs its own full `World` kernel independently; a shard
 * that has never received anyone (freshly opened, still DORMANT, no world yet) truly costs
 * nothing to represent — it's just a registry row until its first arrival.
 *
 * MIGRATION IS NOT GUARANTEED TO SUCCEED (2026-08-11, user-corrected): an inter-shard move
 * isn't risk-free — it's the same territory as the not-yet-built Import/Export legal/
 * illegal shard-movement mechanic (postcard/tier-gated legal routes vs. detection-gated
 * illegal ones). Until that's actually designed, `MIGRATION_FAILURE_RATE` stands in as a
 * flat, illustrative placeholder cost: some fraction of attempted migrations simply fail —
 * lost from the source shard, never arriving anywhere — rather than every attempt being a
 * certain, free transfer. `N` (the live population feeding `vacancyParamsFor` in
 * `world.ts`) already reflects each shard's own real, current headcount rather than a
 * static target; this failure rate is the migration-specific piece of "N shouldn't be
 * flat" on top of that. [ILLUSTRATIVE] — to be replaced by Import/Export's real
 * route-detection math once that system is designed, not left as a permanent guess.
 */
export const MIGRATION_FAILURE_RATE = 0.15;

export interface MultiShardState {
  registry: ShardRegistry;
  worlds: Map<number, World>;
  day: number;
  rng: () => number;
  seed: number;
  config: WorldConfig;
  /** Cumulative count of migration attempts that failed (lost, arrived nowhere) — for
   *  observability/reporting, not used by the simulation itself. */
  totalFailedMigrations: number;
}

export function createMultiShardState(seed: number, config: WorldConfig): MultiShardState {
  const rng = mulberry32(seed);
  const registry = createShardRegistry(config.targetPopulation);
  const worlds = new Map<number, World>();
  for (const shard of registry.shards) {
    worlds.set(shard.id, createWorld(seed * 1000 + shard.id + 1, config));
  }
  return { registry, worlds, day: 0, rng, seed, config, totalFailedMigrations: 0 };
}

/**
 * One day across every shard. Steps each shard's own kernel, routes that shard's real
 * emigrants (if any) to a destination chosen from the registry — never an abstract pool —
 * lazily materializing a DORMANT shard's first `World` on its first arrival, then checks
 * whether population + stability + cooldown together justify opening one more shard.
 */
export function stepMultiShard(state: MultiShardState): MultiShardState {
  let registry = state.registry;
  const worlds = new Map(state.worlds);
  const emigrantBatches: { fromShardId: number; count: number }[] = [];

  for (const shardId of [...worlds.keys()]) {
    const stepped = stepWorld(worlds.get(shardId)!);
    worlds.set(shardId, stepped);
    registry = setShardPopulation(registry, shardId, stepped.population);
    if (stepped.lastEmigrants > 0) emigrantBatches.push({ fromShardId: shardId, count: stepped.lastEmigrants });
  }

  let totalFailedMigrations = state.totalFailedMigrations;
  for (const { fromShardId, count } of emigrantBatches) {
    for (let i = 0; i < count; i++) {
      const destId = chooseMigrationDestination(registry, fromShardId, state.rng);
      if (destId === null) continue; // only one shard exists — nowhere else to go, an honest edge case

      // The source shard already lost this person (stepWorld's own emigration accounting
      // happened before lastEmigrants was reported). A failed migration means they simply
      // never arrive anywhere — a real cost, not redirected or refunded.
      if (state.rng() < MIGRATION_FAILURE_RATE) {
        totalFailedMigrations += 1;
        continue;
      }

      const destRecord = registry.shards.find((s) => s.id === destId);
      const wasDormant = destRecord?.state === 'DORMANT';
      if (!worlds.has(destId)) {
        worlds.set(destId, createDormantWorld(state.seed * 1000 + destId + 1, state.config));
      }
      const dest = receiveMigrants(worlds.get(destId)!, 1);
      worlds.set(destId, dest);
      if (wasDormant) registry = markShardActive(registry, destId);
      registry = setShardPopulation(registry, destId, dest.population);
    }
  }

  const populatedWorlds = [...worlds.values()].filter((w) => w.population > 0);
  const meanHealth = populatedWorlds.length > 0 ? populatedWorlds.reduce((sum, w) => sum + w.economicHealth, 0) / populatedWorlds.length : 0;
  if (canOpenNewShard(registry, meanHealth, state.day, state.config.targetPopulation)) {
    registry = openNewShard(registry, state.day);
  }

  return { ...state, registry, worlds, day: state.day + 1, totalFailedMigrations };
}

export function totalPopulation(state: MultiShardState): number {
  return [...state.worlds.values()].reduce((sum, w) => sum + w.population, 0);
}
