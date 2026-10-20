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
 * - Alternative shards exist to offer migration, different institutional rules, social
 *   escape and starting again — their availability does NOT depend on population growth
 *   (2026-10-20, user directive; this replaced an earlier mean-population gate, see
 *   `canOpenNewShard`). A new shard opens while the registry is below `SHARD_COUNT_CAP`, the
 *   existing populated shards are healthy/stable enough, and the cooldown since the last
 *   opening has passed — "another shard becomes available after a cooldown."
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
/**
 * [ILLUSTRATIVE] The most shards the registry will hold: the two initial shards plus one
 * alternative. Population-independent by design (2026-10-20): the previous rule opened a
 * shard only while mean population per populated shard was >= `targetPopulation` (100).
 * Shards start at 100 and settle near 85 within days, so that gate could only pass on day 0-1
 * — after that no alternative shard could ever appear, and whether one existed at all was a
 * seed-dependent knife edge.
 *
 * Why a cap rather than no bound: every materialised shard runs its own arrival process, so
 * an unbounded opening rule grows simulated population with shard count. Measured, not
 * assumed (8 seeds): opening whenever no DORMANT shard was on offer reached 31 shards and
 * ~1,080 people in 1,000 days, against ~250 people in 3 shards today; the original flat
 * total-population gate once reached 102 shards in 3,000 days. Raising the cap is a design
 * decision about how many places exist, not about how many people there are.
 */
export const SHARD_COUNT_CAP = 3;

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
 * Whether the registry may open one more shard today. Gates, each independently required:
 * room under `maxShards`, someone exists to migrate (at least one populated shard), the
 * populated shards are stable, and the cooldown since the last opening has passed. How many
 * people there are plays no part — an alternative shard's existence must not depend on
 * population growth (see `SHARD_COUNT_CAP`). Pure; consumes no rng, so replay is unaffected.
 */
export function canOpenNewShard(
  registry: ShardRegistry,
  meanActiveShardHealth: number,
  day: number,
  maxShards: number = SHARD_COUNT_CAP,
  cooldownDays: number = SHARD_OPEN_COOLDOWN_DAYS,
  stabilityThreshold: number = SHARD_OPEN_STABILITY_THRESHOLD,
): boolean {
  if (registry.shards.length >= maxShards) return false;
  if (!registry.shards.some((s) => s.population > 0)) return false;
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
