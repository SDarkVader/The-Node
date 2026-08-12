/**
 * District access (2026-08-12, user-specified — "some barriers restricting flow of movement
 * between districts, so those who can move are able to and others have to use the main
 * plaza"). Pure, dependency-thin: reads `space.ts`'s side-street mesh
 * (`District.neighborDistrictIds`, generated once at shard creation) and one boolean about
 * the traveling player, nothing else. See `docs/VISUAL_FRAMEWORK_2026-08-12.md` §6 for the
 * full design reasoning; this is that spec's implementation, not a new design pass.
 *
 * WHO GETS THE SHORTCUT, and why this closes the containment question the spec flagged as
 * open: a FILLED role-holder has a real building and standing in their own district — the
 * exact asymmetry `world.ts`'s own header already draws for an unrelated reason ("grifters
 * have no fixed position... not part of the proximity graph"), extended to a second system
 * rather than invented fresh. Side streets themselves are static geometry, generated once at
 * shard creation from district coordinates alone (`space.ts` has zero dependency on anything
 * role- or player-related) — no player action, reputation, or standing can add, remove, or
 * gate a specific OTHER player's access to a specific corridor. The only thing that varies
 * per traveler is whether THEY currently hold a FILLED role — self-directed (get a role, get
 * the access), never a decision some other player makes on their behalf. That closes the
 * flagged worry about a well-connected role-holder controlling access for someone else:
 * there is no mechanism by which they could, structurally, not just by policy.
 * `test/districtAccess.test.ts` proves this rather than asserting it.
 *
 * WHY CONSOLIDATION STATE DOES NOT AFFECT ACCESS, decided here rather than left open: a
 * CONSOLIDATING or MERGED district's role-holders already pay the trade-route friction
 * penalty (`districtConsolidation.ts`) on their income. Also revoking shortcut access would
 * double-penalize a district already struggling, cutting against "the floor protects
 * everyone" the same way any second, compounding penalty does. Enforced structurally, not
 * just by convention: `space.ts` has no dependency on `districtConsolidation.ts` at all, so
 * district health has no path to reach corridor geometry even by accident — wiring it in
 * would have to be a deliberate, separate decision.
 *
 * The baseline never moves: every district is always reachable via the hub (`Shard.hubPlot`),
 * for everyone, regardless of role status — constraint 2, no permanent zero-state. A
 * shortcut is a grant on top of that floor, never a substitute for it.
 */

import type { Shard, DistrictId } from './space.js';

export type RouteKind = 'direct' | 'viaHub';

/** The same three-state vocabulary `vacancy.ts`'s `RoleSlot.state` already uses, plus
 *  `'grifter'` for a roleless player (who has no slot at all) — so a caller can pass real
 *  state straight through without translating it into something bespoke to this module. */
export type TravelerStatus = 'FILLED' | 'VACANT' | 'BACKSTOPPED' | 'grifter';

/** Whether a traveler currently qualifies for direct side-street access. Only a FILLED
 *  role-slot occupant has real standing in a district; a VACANT or BACKSTOPPED slot has
 *  nobody real behind it, and a grifter has no building at all — see this file's header for
 *  why this is the only distinction drawn, and why it is not (and cannot be) about who the
 *  destination district "lets in". */
export function hasShortcutAccess(status: TravelerStatus): boolean {
  return status === 'FILLED';
}

/** Every district this one connects to directly via a side street — pure geometry, identical
 *  for every traveler regardless of who's asking (see header). Empty for a district with no
 *  side streets (e.g. a single-district shard) rather than throwing — the hub route still
 *  works either way. Empty, not undefined, for an unknown districtId too — a caller checking
 *  reachability from a district that doesn't exist gets "no shortcuts", not a crash. */
export function directNeighbors(shard: Shard, districtId: DistrictId): readonly DistrictId[] {
  return shard.districts.find((d) => d.id === districtId)?.neighborDistrictIds ?? [];
}

/**
 * Which kind of route a traveler actually gets between two districts. Never "blocked" — the
 * hub route is the floor and always resolves (constraint 2). `'direct'` only when the
 * traveler has shortcut access AND the destination is a real side-street neighbour of the
 * origin; every other case, including travel to/from a district with no side streets at all,
 * or staying within the same district, falls back to `'viaHub'` — except the trivial same-
 * district case, which needs no route at all and reads as `'direct'` (already there).
 */
export function effectiveRoute(
  shard: Shard,
  fromDistrictId: DistrictId,
  toDistrictId: DistrictId,
  travelerStatus: TravelerStatus,
): RouteKind {
  if (fromDistrictId === toDistrictId) return 'direct';
  if (!hasShortcutAccess(travelerStatus)) return 'viaHub';
  return directNeighbors(shard, fromDistrictId).includes(toDistrictId) ? 'direct' : 'viaHub';
}
