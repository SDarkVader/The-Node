import { mulberry32 } from './rng.js';
import { createWorld, stepWorld, createDormantWorld, receiveMigrants, type World, type WorldConfig } from '../world/world.js';
import { attemptCrossing, drawTicketProgress } from '../engine/importExport.js';
import { IMPORT_EXPORT_WINDOWS_UTC } from '../engine/dayCycle.js';
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

/**
 * The basic day (2026-08-24, user-specified: "windows of opportunity open twice daily for
 * migration for legal and illegal routing of people and goods"). Reports which of the day's
 * two `dayCycle.ts` windows each migration attempt this tick fell in — real per-window
 * structure, at the same daily-tick granularity `stepMultiShard` already runs at (one call
 * per day, attempts resolved within that call assigned alternately to window 0/1, matching
 * this kernel's "one blended day -> N equal real sub-events" convention rather than
 * fabricating hourly gating the tick model can't yet support). Route resolution itself
 * (attemptCrossing/drawTicketProgress) is unchanged — this only tags and counts, it never
 * alters which attempts happen or how they resolve. */
export interface MigrationWindowReport {
  window: number;
  hourUtc: number;
  attempted: number;
  succeeded: number;
}

function emptyMigrationWindowReport(): MigrationWindowReport[] {
  return IMPORT_EXPORT_WINDOWS_UTC.map(([hourUtc], window) => ({ window, hourUtc, attempted: 0, succeeded: 0 }));
}

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
  /**
   * Per-run override of `MIGRATION_FAILURE_RATE`. Exposed as state (rather than only a
   * module constant) for the same reason `WorldConfig.purchaseCycleDays` is a config
   * field: it is the single controlling lever on this system's equilibrium population
   * (see `sim/multiShardEquilibriumSweep.ts`), so it must be sweepable without editing
   * source. Defaults to `MIGRATION_FAILURE_RATE` when not supplied.
   */
  migrationFailureRate: number;
  /** Use the pre-Import/Export flat failure constant instead of real route resolution —
   *  for A/B comparison only; the route mechanism is the default. */
  useLegacyFlatFailureRate: boolean;
  /** This tick's migration attempts, tagged by which of the day's two Import/Export windows
   *  they fell in. Reset every `stepMultiShard` call — same "report what actually happened
   *  this tick" convention as `world.ts`'s `lastX` fields, not a cumulative log. */
  lastMigrationWindows: MigrationWindowReport[];
}

export function createMultiShardState(
  seed: number,
  config: WorldConfig,
  migrationFailureRate: number = MIGRATION_FAILURE_RATE,
  useLegacyFlatFailureRate = false,
): MultiShardState {
  const rng = mulberry32(seed);
  const registry = createShardRegistry(config.targetPopulation);
  const worlds = new Map<number, World>();
  for (const shard of registry.shards) {
    worlds.set(shard.id, createWorld(seed * 1000 + shard.id + 1, config));
  }
  return {
    registry,
    worlds,
    day: 0,
    rng,
    seed,
    config,
    totalFailedMigrations: 0,
    migrationFailureRate,
    useLegacyFlatFailureRate,
    lastMigrationWindows: emptyMigrationWindowReport(),
  };
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
  const migrationWindows = emptyMigrationWindowReport();
  let attemptIndex = 0;
  for (const { fromShardId, count } of emigrantBatches) {
    for (let i = 0; i < count; i++) {
      // Tags which of the day's two Import/Export windows this attempt falls in — reporting
      // only, alternating in the same order attempts are already processed. Consumes no rng
      // and never affects whether the attempt happens or how it resolves.
      const windowIndex = attemptIndex % migrationWindows.length;
      attemptIndex += 1;
      const destId = chooseMigrationDestination(registry, fromShardId, state.rng);
      if (destId === null) continue; // only one shard exists — nowhere else to go, an honest edge case

      // The source shard already lost this person (stepWorld's own emigration accounting
      // happened before lastEmigrants was reported). A failed crossing means they simply
      // never arrive anywhere — a real cost, not redirected or refunded.
      //
      // Route resolution (2026-08-11) now comes from Import/Export's real mechanism rather
      // than a flat rate: a complete exit ticket travels the legal route without friction,
      // partial postcard progress opens the illegal route and is rolled against a freshly
      // drawn, stateless interception probability. `useLegacyFlatFailureRate` keeps the old
      // constant available for A/B comparison; the emergent rate reproduces it (~0.149 vs
      // 0.15), so existing multi-shard calibration is preserved, not silently moved.
      migrationWindows[windowIndex]!.attempted += 1;
      const crossed = state.useLegacyFlatFailureRate
        ? state.rng() >= state.migrationFailureRate
        : attemptCrossing(drawTicketProgress(state.rng), state.rng);
      if (!crossed) {
        totalFailedMigrations += 1;
        continue;
      }
      migrationWindows[windowIndex]!.succeeded += 1;

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

  return { ...state, registry, worlds, day: state.day + 1, totalFailedMigrations, lastMigrationWindows: migrationWindows };
}

export function totalPopulation(state: MultiShardState): number {
  return [...state.worlds.values()].reduce((sum, w) => sum + w.population, 0);
}
