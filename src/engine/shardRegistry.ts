/**
 * Shard registry (2026-08-11, user-specified). Pure, dependency-free, same style as every
 * other `src/engine/` module. Models the multi-shard lifecycle at the population-count
 * level — a lightweight ledger, not N full economic kernels — so it can be built, tested,
 * and trusted in isolation before `src/sim/multiShardHarness.ts` composes it with real
 * `World` instances.
 *
 * Rules, taken directly from the user's own spec:
 * - The world starts with `INITIAL_SHARD_COUNT` (2) shards, both ACTIVE from day one
 *   ("an original basis of 2 shards").
 * - Shard IDs only ever increase — nothing is ever deleted from the registry, only ever
 *   marked DORMANT. "Only the shard number increases."
 * - Migration destination choice is always bounded to shards that already exist in the
 *   registry — "can't move to somewhere that doesn't exist."
 * - A new shard can open once total population has grown enough AND the existing ACTIVE
 *   shards are healthy/stable enough — "a stability threshold is reached for a healthy
 *   population." Every shard after that needs the same two-part gate again, plus a
 *   cooldown since the last shard opened — "another shard becomes available after a
 *   cooldown."
 * - A newly opened shard starts DORMANT — no population, "automated economic stability"
 *   (mechanically covered, nobody there) — until a real arrival wakes it to ACTIVE. See
 *   `world.ts`'s `createDormantWorld` for how a DORMANT shard's economy is represented
 *   (all role slots VACANT, reusing the existing vacancy/backstop machinery rather than
 *   inventing a second "dormant mode").
 */

export type ShardState = 'ACTIVE' | 'DORMANT';

export interface ShardRecord {
  id: number;
  state: ShardState;
  population: number;
  openedOnDay: number;
}

export interface ShardRegistry {
  shards: ShardRecord[];
  /** Monotonic — the next id to assign. Never reused, even if a shard's population hits 0. */
  nextShardId: number;
  /** Day the most recently opened shard appeared. null before any shard has opened past the
   *  initial 2 — gates the cooldown for the next one. */
  lastShardOpenedDay: number | null;
}

export const INITIAL_SHARD_COUNT = 2;
/** [ILLUSTRATIVE] Minimum days between opening one new shard and the next being eligible. */
export const SHARD_OPEN_COOLDOWN_DAYS = 30;
/** [ILLUSTRATIVE] Mean economicHealth across ACTIVE shards-with-population required before
 *  a new shard is allowed to open — "a healthy population," not merely a large one. */
export const SHARD_OPEN_STABILITY_THRESHOLD = 0.8;
/** [ILLUSTRATIVE] Total population across the whole registry required before a 3rd (or
 *  later) shard is even considered — roughly 2x a single healthy shard's target, so
 *  opening a new one is relieving real pressure, not pre-emptively thinning out shards
 *  that are merely comfortably full. */
export const SHARD_OPEN_MIN_TOTAL_POPULATION = 120;

export function createShardRegistry(initialPopulationPerShard: number, day = 0): ShardRegistry {
  const shards: ShardRecord[] = Array.from({ length: INITIAL_SHARD_COUNT }, (_, i) => ({
    id: i,
    state: 'ACTIVE' as const,
    population: initialPopulationPerShard,
    openedOnDay: day,
  }));
  return { shards, nextShardId: INITIAL_SHARD_COUNT, lastShardOpenedDay: null };
}

/**
 * Whether the registry is eligible to open one more shard today. All three gates are
 * independently required — population growth alone, or stability alone, or cooldown
 * alone, is not sufficient.
 */
export function canOpenNewShard(
  registry: ShardRegistry,
  meanActiveShardHealth: number,
  day: number,
  cooldownDays: number = SHARD_OPEN_COOLDOWN_DAYS,
  stabilityThreshold: number = SHARD_OPEN_STABILITY_THRESHOLD,
  minTotalPopulation: number = SHARD_OPEN_MIN_TOTAL_POPULATION,
): boolean {
  const totalPopulation = registry.shards.reduce((sum, s) => sum + s.population, 0);
  if (totalPopulation < minTotalPopulation) return false;
  if (meanActiveShardHealth < stabilityThreshold) return false;
  if (registry.lastShardOpenedDay !== null && day - registry.lastShardOpenedDay < cooldownDays) return false;
  return true;
}

export function openNewShard(registry: ShardRegistry, day: number): ShardRegistry {
  const record: ShardRecord = { id: registry.nextShardId, state: 'DORMANT', population: 0, openedOnDay: day };
  return {
    shards: [...registry.shards, record],
    nextShardId: registry.nextShardId + 1,
    lastShardOpenedDay: day,
  };
}

/**
 * Migration destination choice — "can't move to somewhere that doesn't exist": always
 * picks among shards actually in the registry (excluding the one being left). Prefers a
 * DORMANT shard when one exists — an empty, automated-stability shard genuinely needs a
 * real arrival to wake it, and this is the mechanism that provides one. Otherwise spreads
 * load toward whichever ACTIVE shard(s) currently have the lowest population, chosen
 * uniformly at random among ties (not the first one found, to avoid a deterministic bias
 * toward low-id shards). Returns null only when there is nowhere else to go (a
 * single-shard registry) — a real, honest edge case, not silently papered over.
 */
export function chooseMigrationDestination(registry: ShardRegistry, excludeShardId: number, rng: () => number): number | null {
  const candidates = registry.shards.filter((s) => s.id !== excludeShardId);
  if (candidates.length === 0) return null;

  const dormant = candidates.filter((s) => s.state === 'DORMANT');
  if (dormant.length > 0) {
    return dormant[Math.floor(rng() * dormant.length)]!.id;
  }

  const minPop = Math.min(...candidates.map((s) => s.population));
  const atMin = candidates.filter((s) => s.population === minPop);
  return atMin[Math.floor(rng() * atMin.length)]!.id;
}

/** Syncs a shard's population from ground truth (its real running `World`, if it has one). */
export function setShardPopulation(registry: ShardRegistry, shardId: number, population: number): ShardRegistry {
  return { ...registry, shards: registry.shards.map((s) => (s.id === shardId ? { ...s, population } : s)) };
}

/** A DORMANT shard wakes to ACTIVE the moment a real arrival lands there. */
export function markShardActive(registry: ShardRegistry, shardId: number): ShardRegistry {
  return { ...registry, shards: registry.shards.map((s) => (s.id === shardId ? { ...s, state: 'ACTIVE' as const } : s)) };
}
