/**
 * The presence/session primitive (2026-08-24, user-specified: "let's build the presence/
 * session primitive next"). At least five designed mechanics depend on knowing whether a
 * role-holder is currently online — the login-buffer postcard system, Shift Cover, trespass
 * eligibility ("only possible while the owner is absent... offline, or online but physically
 * elsewhere"), arson eligibility ("only possible while the target is neither actively working
 * their role nor online"), and Import/Export automation-if-offline — and until now nothing in
 * the engine tracked it at all (`player.ts` is 22 lines, just an id).
 *
 * GRANULARITY, flagged not silently narrowed — same honesty `dayCycle.ts` and `wealth.ts`
 * already hold themselves to about this kernel's daily-tick resolution: `stepWorld` advances
 * one full day per call, so "online" here means "connected at all on the tick this was
 * observed," not session start/end times or minutes-of-the-day. `consecutiveOnlineDays`/
 * `consecutiveOfflineDays` are daily counters, not hour counters. A mechanic that genuinely
 * needs sub-day resolution (e.g. real-time trespass gating) needs the live server's own
 * wall-clock cadence to exist first (`docs/BLUEPRINT.md` §9) — this module doesn't pretend to
 * solve that.
 *
 * SCOPE: role-holders only (a currently-FILLED slot's `buildingId`), not grifters — the same
 * "no fixed building position, out of scope for any spatially-anchored mechanic" reasoning
 * `world.ts`'s own header already applies to comms. A grifter has nowhere to be trespassed
 * into or absent from.
 *
 * WHO REPORTS "online"? This module is entirely presentation-agnostic about that — it just
 * reconciles a `ReadonlySet<PlayerId>` the caller hands it (see `World.currentlyOnline`,
 * populated by `ws.ts` from real open connections) against the previous tick's ledger. It
 * consumes no rng and touches no other field, so adding it changes nothing about any
 * previously-calibrated economic number.
 */
import type { PlayerId } from './player.js';

export interface PresenceRecord {
  online: boolean;
  /** Consecutive daily ticks observed online, ending today if online, else 0. */
  consecutiveOnlineDays: number;
  /** Consecutive daily ticks observed offline, ending today if offline, else 0. */
  consecutiveOfflineDays: number;
}

/** A never-before-seen player's first observed presence record. */
export function initialPresence(online: boolean): PresenceRecord {
  return online
    ? { online: true, consecutiveOnlineDays: 1, consecutiveOfflineDays: 0 }
    : { online: false, consecutiveOnlineDays: 0, consecutiveOfflineDays: 1 };
}

/** Reconciles one player's record for one more tick. `prev === undefined` is a fresh
 *  role-holder (this tick is a slot that just transitioned into FILLED, or the very first
 *  tick presence was ever observed) — same "a new occupant inherits nothing" reset convention
 *  every other per-slot field in `World` already follows. */
export function stepPresenceRecord(prev: PresenceRecord | undefined, online: boolean): PresenceRecord {
  if (prev === undefined) return initialPresence(online);
  if (online) return { online: true, consecutiveOnlineDays: prev.consecutiveOnlineDays + 1, consecutiveOfflineDays: 0 };
  return { online: false, consecutiveOnlineDays: 0, consecutiveOfflineDays: prev.consecutiveOfflineDays + 1 };
}

/**
 * Reconciles the whole ledger for one tick. Rebuilt from `filledPlayerIds` rather than
 * mutating the previous map in place: any buildingId no longer FILLED is simply absent from
 * the result (there's no player there to have presence, and a future occupant must not
 * inherit a stranger's history — the same reset-on-refill convention `stepPresenceRecord`
 * already applies per-entry, extended to "no entry at all" for a vacated slot).
 */
export function stepPresenceLedger(
  prevLedger: Readonly<Record<PlayerId, PresenceRecord>>,
  filledPlayerIds: ReadonlySet<PlayerId>,
  currentlyOnline: ReadonlySet<PlayerId>,
): Record<PlayerId, PresenceRecord> {
  const next: Record<PlayerId, PresenceRecord> = {};
  for (const playerId of filledPlayerIds) {
    next[playerId] = stepPresenceRecord(prevLedger[playerId], currentlyOnline.has(playerId));
  }
  return next;
}
