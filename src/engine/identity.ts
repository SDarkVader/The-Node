/**
 * Identity resolution trigger (2026-08-11, Design Addendum item 1 — "the Silhouette
 * Shield"). `player.ts`'s `isKnown()` was a binary lookup with no rule for what populates
 * an observer's known-set — this gives it one, plus deterministic procedural faces for
 * players once resolved. `isKnown()` itself is untouched: its own test file already documents
 * the right contract ("not symmetric by construction — only reflects the observer's own
 * set"); what was missing was a real answer to what goes INTO that set, not its shape.
 *
 * Per-pair, asymmetric-capable, and driven only by real ledger events — never a timer, a
 * purchase, or a manual toggle — per the addendum's explicit instruction.
 *
 * WHICH REAL EVENT FEEDS IT (flagged, not silently decided): the addendum offers two
 * triggers — "verified trade history... (a threshold number of completed transactions)," or
 * "an established relationship already recorded in existing state." No per-player buyer/
 * seller transaction ledger exists anywhere in this build — the market layer
 * (`millers.ts`/`bakers.ts`/`wealth.ts`) is aggregate (a Baker "serves N customers" as a
 * count, never specific player ids), and building one from scratch here would be exactly the
 * "new subsystem" the addendum says is a sign an item has been misread. So this uses the
 * second, already-available trigger: rumour hearing. `world.ts`'s `RumourEventLite` (`heardBy`
 * heard something FROM `heardFrom`) is real, per-tick, already-recorded state, and — unlike
 * proximity co-presence, which is symmetric by definition and so cannot produce asymmetric
 * resolution on its own — genuinely directional: the hearer learns something about the
 * source; the source does not automatically learn who heard. Once item 6 gives Couriers a
 * real commissioner-tagged delivery record, that would be a more literally "trade" signal and
 * a natural second feed into this same ledger — not built here, flagged rather than
 * anticipated.
 *
 * Preserves the addendum's density-gradient consequence for free: rumour propagation already
 * runs over `comms/connections.ts`'s proximity graph, which is denser in core districts
 * (`space.ts`'s `coreSpacing` vs `peripherySpacing`) — so resolution naturally happens faster
 * in the core without a second mechanic computing that on purpose.
 */

import { mulberry32 } from '../sim/rng.js';
import type { PlayerId } from './player.js';

/** Directional per-observer encounter counts: observer -> subject -> count. Asymmetric by
 *  construction — recording A's encounter with B never touches B's own map. */
export type IdentityLedger = ReadonlyMap<PlayerId, ReadonlyMap<PlayerId, number>>;

export function emptyIdentityLedger(): IdentityLedger {
  return new Map();
}

/** Completed real-encounter threshold before a subject resolves from silhouette to full
 *  identity. [ILLUSTRATIVE] */
export const IDENTITY_RESOLUTION_THRESHOLD = 5;

/**
 * Records one directional real event: `observerId` became aware of `subjectId` (e.g. heard a
 * rumour FROM them). Pure — returns a new ledger, the same immutable-update convention every
 * other engine module in this repo follows. A no-op self-encounter (`observerId === subjectId`)
 * is rejected rather than silently accepted — a player cannot need to "resolve" themselves.
 */
export function recordEncounter(ledger: IdentityLedger, observerId: PlayerId, subjectId: PlayerId): IdentityLedger {
  if (observerId === subjectId) return ledger;
  const next = new Map(ledger);
  const observerCounts = new Map(next.get(observerId) ?? []);
  observerCounts.set(subjectId, (observerCounts.get(subjectId) ?? 0) + 1);
  next.set(observerId, observerCounts);
  return next;
}

/** How many real encounters `observerId` has recorded with `subjectId` so far. */
export function encounterCount(ledger: IdentityLedger, observerId: PlayerId, subjectId: PlayerId): number {
  return ledger.get(observerId)?.get(subjectId) ?? 0;
}

/**
 * Every subject `observerId` has resolved (crossed the threshold) so far — the known-set
 * `player.ts`'s `isKnown(subject, knownByObserver)` expects an observer to supply. `isKnown`
 * itself stays a pure lookup; this is what now derives its input instead of leaving "who's in
 * the set" undecided, per-pair, asymmetrically, from real accumulated events.
 */
export function resolvedSubjects(
  ledger: IdentityLedger,
  observerId: PlayerId,
  threshold: number = IDENTITY_RESOLUTION_THRESHOLD,
): ReadonlySet<PlayerId> {
  const counts = ledger.get(observerId);
  if (!counts) return new Set();
  const resolved = new Set<PlayerId>();
  for (const [subject, count] of counts) {
    if (count >= threshold) resolved.add(subject);
  }
  return resolved;
}

// ---- Deterministic procedural faces ----------------------------------------------------

/** Cosmetic-only face parameters — which shapes/hairstyles/marks these indices actually draw
 *  is the renderer's concern, not this module's; this only guarantees the same id always
 *  produces the same numbers for every observer who has resolved them. */
export interface ProceduralFace {
  hue: number; // 0-359
  skinTone: number; // 0-1
  faceShape: number; // 0 to FACE_SHAPE_COUNT-1
  hairStyle: number; // 0 to HAIR_STYLE_COUNT-1
  markCount: number; // 0 to MARK_COUNT_MAX-1 — freckles/marks/etc, purely cosmetic variety
}

export const FACE_SHAPE_COUNT = 5;
export const HAIR_STYLE_COUNT = 8;
export const MARK_COUNT_MAX = 4;

/** FNV-1a — small, dependency-free, deterministic string hash, used only to turn a string
 *  player id into the numeric seed `mulberry32` (every deterministic PRNG in this repo)
 *  actually takes. Not itself a PRNG or a security primitive. */
function hashPlayerId(id: PlayerId): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic procedural face for `playerId`. Same id always produces the same face for
 * every observer who has resolved them — no art pipeline, no uploaded images, no
 * user-configurable appearance (explicitly rejected in the addendum: configurability is a
 * combinatorial identity-management problem the design does not want). Seeded purely from
 * the id via `mulberry32`, the same PRNG every other deterministic system in this repo
 * already uses, not a bespoke generator.
 */
export function generateFace(playerId: PlayerId): ProceduralFace {
  const rand = mulberry32(hashPlayerId(playerId));
  return {
    hue: Math.floor(rand() * 360),
    skinTone: rand(),
    faceShape: Math.floor(rand() * FACE_SHAPE_COUNT),
    hairStyle: Math.floor(rand() * HAIR_STYLE_COUNT),
    markCount: Math.floor(rand() * MARK_COUNT_MAX),
  };
}
