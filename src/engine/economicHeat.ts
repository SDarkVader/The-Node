/**
 * Economic Heat (2026-08-11, Design Addendum item 2) — pure presentation over data that
 * already exists in `millers.ts`/`bakers.ts`/`districtConsolidation.ts`. No new game logic,
 * no new hidden modifiers, and deliberately NOT stored on `World` or computed inside
 * `stepWorld` — this is a read-only projection a renderer (or a report script) calls against
 * a `World` snapshot, the same relationship `sim/resourceReport.ts` already has with
 * `World.resources`. Adding nothing to `stepWorld` means it cannot affect determinism, tick
 * order, or any existing test in this repo — the safest way to satisfy "pure rendering."
 *
 * Purpose, in the addendum's own words: "a player should be able to *read* scarcity from the
 * plaza rather than computing it from numbers." So `heat` (0 cool/calm .. 1 warm/tense — the
 * same scale District Weather's `tension` uses, deliberately, since both feed the same visual
 * contract) tracks economic PRESSURE, not raw throughput: a thriving, fully-supplied station
 * reads cool; a scarce or friction-degraded one reads hot. This is the station-level
 * complement to District Weather's district-level ambient signal (item 0/3) — different
 * granularity and a different source (market state here, vacancy/consolidation/sabotage
 * there), not a duplicate of it.
 *
 * Per-role source, all already-persisted `World` fields, nothing recomputed twice:
 *   - Miller: own `value` (Cournot quantity, already clipped to [0.01,1] by `millers.ts`) —
 *     "station-level output visibility," literally.
 *   - Baker: own `value` (Bertrand price, already clipped to [0,2] by `bakers.ts`) normalized
 *     against that same ceiling — a Baker pricing near the ceiling is a scarce, hot station.
 *   - Courier/Journalist/Detective/Import-Export: `1 - consolidationFrictionMultiplier` for
 *     the building's own district — these four roles have no differentiated per-slot market
 *     value (see `world.ts`'s header — flagged, not this module's problem to solve), but
 *     trade-route friction already IS a real, existing, per-district degradation signal
 *     (`districtConsolidation.ts`), so a support-role station in a struggling district reads
 *     hot exactly where the game already knows something is wrong.
 *   - VACANT/BACKSTOPPED slots read 0 (cool) — nobody there to generate scarcity pressure —
 *     the same "missing reads as absent, not negative" convention `districtWeather.ts` uses.
 */

import { consolidationFrictionMultiplier, type DistrictHealth } from './districtConsolidation.js';
import type { Shard } from './space.js';
import type { World, RoleEconomicSlot, SupportRoleSlot } from '../world/world.js';

/** Baker price ceiling `bakers.ts` clips to — the normalization reference, not a re-derivation. */
const BAKER_PRICE_CEILING = 2.0;

/** buildingId -> heat in [0,1]. Every building in `world.shard` has an entry. */
export type EconomicHeatField = Readonly<Record<string, number>>;

function buildingDistrictMap(shard: Shard): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of shard.districts) {
    for (const b of d.buildings) map.set(b.id, d.id);
  }
  return map;
}

function supportRoleHeat(
  slot: SupportRoleSlot,
  buildingDistrictId: Map<string, string>,
  districtHealth: Readonly<Record<string, DistrictHealth>>,
  day: number,
): number {
  if (slot.slot.state !== 'FILLED') return 0;
  const districtId = buildingDistrictId.get(slot.buildingId);
  const health = districtId ? districtHealth[districtId] : undefined;
  if (!health) return 0;
  return 1 - consolidationFrictionMultiplier(health, day);
}

function marketRoleHeat(slot: RoleEconomicSlot, ceiling: number): number {
  if (slot.slot.state !== 'FILLED') return 0;
  return Math.max(0, Math.min(1, slot.value / ceiling));
}

/**
 * Per-building heat for the whole shard, computed fresh from `world`'s own current state —
 * a pure projection, safe to call every render frame or report tick without mutating or
 * threading anything back into the simulation.
 */
export function computeEconomicHeat(world: World): EconomicHeatField {
  const buildingDistrictId = buildingDistrictMap(world.shard);
  const field: Record<string, number> = {};

  // Every building gets an entry, including ones with no role assigned at all — a renderer
  // shouldn't need to know a building's role before it can look up its heat. Role-bearing
  // buildings below overwrite this default.
  for (const d of world.shard.districts) {
    for (const b of d.buildings) field[b.id] = 0;
  }

  for (const m of world.millers) field[m.buildingId] = marketRoleHeat(m, 1); // value already in [0.01,1]
  for (const b of world.bakers) field[b.buildingId] = marketRoleHeat(b, BAKER_PRICE_CEILING);
  for (const c of world.couriers) field[c.buildingId] = supportRoleHeat(c, buildingDistrictId, world.districtHealth, world.tick);
  for (const j of world.journalists) field[j.buildingId] = supportRoleHeat(j, buildingDistrictId, world.districtHealth, world.tick);
  for (const d of world.detectives) field[d.buildingId] = supportRoleHeat(d, buildingDistrictId, world.districtHealth, world.tick);
  for (const x of world.importExporters) field[x.buildingId] = supportRoleHeat(x, buildingDistrictId, world.districtHealth, world.tick);

  return field;
}

/**
 * District-level "plaza" reading — the addendum's "foot traffic density" framing — as the
 * mean heat of that district's own buildings. A district with no role-bearing buildings at
 * all (shouldn't happen in the shipped config, but not assumed away) reads 0, not NaN.
 */
export function districtEconomicHeat(world: World, heat: EconomicHeatField): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const d of world.shard.districts) {
    if (d.buildings.length === 0) {
      result[d.id] = 0;
      continue;
    }
    const values = d.buildings.map((b) => heat[b.id] ?? 0);
    result[d.id] = values.reduce((a, v) => a + v, 0) / values.length;
  }
  return result;
}
