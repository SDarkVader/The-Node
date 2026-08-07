/**
 * Minimal player identity primitive (scoped 2026-08-07, see docs/BLUEPRINT.md
 * "Architecture scoped ahead of schedule"). Deliberately thin — a session-scoped id is
 * enough to unblock targeted networking and the binary identity-resolution decision.
 * Real accounts/auth are a separate, later concern, not decided here.
 */

export type PlayerId = string;

export type KnownState = 'known' | 'unknown';

/**
 * Binary identity resolution (brief §7, scoped 2026-08-07): an observer either has a
 * subject fully resolved, or doesn't — no gradual/partial state. What causes a player to
 * become known (proximity? repeated interaction?) is Phase 4 fog-of-recognition design,
 * not decided here — this only fixes the shape of the answer once that rule exists.
 */
export function isKnown(subject: PlayerId, knownByObserver: ReadonlySet<PlayerId>): KnownState {
  return knownByObserver.has(subject) ? 'known' : 'unknown';
}
