/**
 * Pressure detection (2026-08-12 addendum, §4/§4.1 — "the significant one" failure mode,
 * and the addendum's own #1 "highest value" next action). Gives Detective/Journalist a real
 * signal to read: `docs/DESIGN_ADDENDUM_2026-08-12.md` found that Wall-post frequency and
 * content skew toward the "pressure cluster" of self-states is a genuine, observable pattern
 * — and that nothing in the shipped model reads it, despite it being public by design.
 *
 * WHAT THIS DOES NOT DO, decided deliberately, per `docs/ADVERSARIAL_CONTAINMENT.md`'s
 * resolution of §4.1's open question: this module never identifies a player to anyone. The
 * addendum's own model found that naming a pressure-broadcasting player made a real
 * historical case WORSE, not better (+60% ambient unease, not the hoped-for -60%) — being
 * named confirmed the threat without giving anyone a way to respond to it. A public
 * "pressure alert" naming a player would also be a subtractive reputation mechanic wearing
 * a safety costume, which constraint 6 forbids regardless of intent.
 *
 * Instead, a detected pattern contributes to `districtWeather.ts`'s ambient `tension` field
 * — a new source alongside vacancy/consolidation/sabotage, never a name. What a population
 * gets is a real, computable "something is elevated here," and the actionable recourse is
 * the one thing the same addendum's §9 already proved works mechanically: build trust links.
 * Reused, not reinvented — same discipline as reusing `decay.ts` for diary distortion rather
 * than building a second decay system.
 */

import type { SelfState } from '../comms/grammar.js';
import { IDENTITY_RESOLUTION_THRESHOLD, type IdentityLedger } from './identity.js';

/** The addendum's own cluster — self-states with no informational content beyond signalling
 *  distress/threat, as opposed to the five positive/neutral states. */
export const PRESSURE_CLUSTER_STATES: ReadonlySet<SelfState> = new Set([
  'suspicious',
  'distrustful',
  'uneasy',
  'manipulated',
  'exploited',
]);

/** Bounded FIFO of one author's recent Wall posts (oldest first) — same "keep it bounded"
 *  discipline `districtWeather.ts`'s `weatherHistory` already established, at post-count
 *  granularity rather than day granularity (an author may post at most a few times a day). */
export interface PressureRecord {
  recent: ReadonlyArray<{ day: number; pressure: boolean }>;
}

export function emptyPressureRecord(): PressureRecord {
  return { recent: [] };
}

/** Window length. [ILLUSTRATIVE] */
export const PRESSURE_WINDOW_POSTS = 30;
/** Minimum posts in-window before a skew reading is trusted at all — five posts is too
 *  little signal to act on. [ILLUSTRATIVE — the addendum's own uncalibrated starting figure,
 *  kept as a documented placeholder, not re-derived against real traffic yet]. */
export const PRESSURE_MIN_POSTS = 8;
/** Skew (pressure-cluster posts / total posts in window) at or above which a pattern counts
 *  as detected. [ILLUSTRATIVE — ditto]. */
export const PRESSURE_SKEW_THRESHOLD = 0.7;

/** Pure — returns a new record, the same immutable-update convention every engine module
 *  here follows. */
export function recordPost(record: PressureRecord, day: number, state: SelfState): PressureRecord {
  const next = [...record.recent, { day, pressure: PRESSURE_CLUSTER_STATES.has(state) }];
  return { recent: next.length > PRESSURE_WINDOW_POSTS ? next.slice(next.length - PRESSURE_WINDOW_POSTS) : next };
}

/** Fraction of in-window posts that were pressure-cluster states. 0 with no posts, never NaN. */
export function pressureSkew(record: PressureRecord): number {
  if (record.recent.length === 0) return 0;
  const pressureCount = record.recent.filter((r) => r.pressure).length;
  return pressureCount / record.recent.length;
}

export function isPressureDetected(
  record: PressureRecord,
  minPosts: number = PRESSURE_MIN_POSTS,
  skewThreshold: number = PRESSURE_SKEW_THRESHOLD,
): boolean {
  return record.recent.length >= minPosts && pressureSkew(record) >= skewThreshold;
}

/** How much extra amplification a detected pattern gets from being "known" — the addendum's
 *  §4 finding (2.5x ambient unease from reputation alone, same posting behaviour) reused
 *  qualitatively, not literally: that exact multiplier is explicitly flagged in the addendum
 *  as "an assumption of the model, not a measurement." [ILLUSTRATIVE]. */
export const PRESSURE_KNOWN_AMPLIFICATION = 1.5;

/**
 * What fraction of every observer who has resolved ANYONE (per `identity.ts`) has
 * specifically resolved `subjectId` — a real, already-computed proxy for "how widely known
 * is this player," reusing the identity ledger rather than inventing a second fame tracker.
 * 0 when nobody has resolved anyone yet (nothing to compare against).
 */
export function knownFraction(
  ledger: IdentityLedger,
  subjectId: string,
  threshold: number = IDENTITY_RESOLUTION_THRESHOLD,
): number {
  let totalObservers = 0;
  let resolvedBy = 0;
  for (const [, subjects] of ledger) {
    totalObservers += 1;
    if ((subjects.get(subjectId) ?? 0) >= threshold) resolvedBy += 1;
  }
  return totalObservers === 0 ? 0 : resolvedBy / totalObservers;
}

/**
 * Magnitude of ambient tension one detected pattern contributes — never a name, purely a
 * number, meant to be fed into `districtWeather.ts`'s tension composition for the author's
 * own district. 0 unless the pattern actually clears both the volume and skew bars.
 */
export function pressureContribution(record: PressureRecord, known: number): number {
  if (!isPressureDetected(record)) return 0;
  const skew = pressureSkew(record);
  // How far past the threshold, not just whether it's past — a 0.71 skew barely registers,
  // a 1.00 skew registers fully.
  const base = Math.max(0, Math.min(1, (skew - PRESSURE_SKEW_THRESHOLD) / (1 - PRESSURE_SKEW_THRESHOLD)));
  const amplified = base * (1 + PRESSURE_KNOWN_AMPLIFICATION * Math.max(0, Math.min(1, known)));
  return Math.max(0, Math.min(1, amplified));
}
