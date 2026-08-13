import type { Utterance } from '../comms/proximityConversation.js';

/**
 * Infrastructure-layer moderation logging for proximity conversation
 * (`docs/DESIGN_MODERATION_LOGGING_2026-08-13.md`). Lives under `src/infra/`, deliberately
 * separate from `src/engine/`, `src/world/`, and `src/comms/` — the design doc's own §3
 * requires the simulation kernel to have zero dependency on or awareness of this service;
 * putting it in its own top-level directory makes that boundary a directory-structure fact,
 * not just a convention someone could quietly violate. `test/moderationLog.importGuard.test.ts`
 * enforces it the same way `test/drivers.importGuard.test.ts` already enforces the synthetic-
 * driver boundary.
 *
 * Minimum viable footprint (design doc §2): five structured fields, never the rendered TTS
 * audio (synthesis is deterministic, so storing it is pure data-minimization risk for zero
 * benefit — anyone can regenerate the exact clip from the structured selection alone). This
 * module never generates or touches audio in any form.
 *
 * The actual backend technology, hosting, encryption-at-rest, and data-residency choices are
 * explicitly out of scope (design doc §7) — this is the structured-event shape and the
 * retention rule, not a production logging service. `InMemorySink` is a reference
 * implementation for tests and local wiring, not a claim about how this would actually be
 * hosted.
 */

export interface GrammarPayload {
  intent: Utterance['intent'];
  tone: Utterance['tone'];
  referent: Utterance['referent'];
  context: Utterance['context'];
}

export interface ModerationLogEntry {
  id: string;
  /** Event timestamp — the server's own day-tick, matching every other infra clock in this repo. */
  timestamp: number;
  actorId: string;
  targetIds: readonly string[];
  grammarPayload: GrammarPayload;
  spatialCoordinates: { x: number; y: number };
  /** Set once, by a user report or an automated classifier — never by this module itself. */
  flagged: boolean;
  /** The day `flagged` was set; undefined until it is. Drives Dispute Archive retention (§4). */
  flaggedOnDay?: number;
}

/**
 * Converts a composed `Utterance` into the log entry shape — pure, no side effects, no
 * audio. `targetIds` is derived from REFERENT: a room-directed turn has no specific target,
 * an addressed one names exactly the one present player it was addressed to.
 */
export function captureProximityConversationEvent(
  utterance: Utterance,
  speakerPosition: { x: number; y: number },
  id: string,
): ModerationLogEntry {
  const targetIds = utterance.referent.kind === 'player' ? [utterance.referent.playerId] : [];
  return {
    id,
    timestamp: utterance.day,
    actorId: utterance.speakerId,
    targetIds,
    grammarPayload: {
      intent: utterance.intent,
      tone: utterance.tone,
      referent: utterance.referent,
      context: utterance.context,
    },
    spatialCoordinates: { ...speakerPosition },
    flagged: false,
  };
}

export interface ModerationLogSink {
  record(entry: ModerationLogEntry): void;
  entries(): readonly ModerationLogEntry[];
  /** Marks an entry flagged (by report or classifier) — moves it onto Dispute Archive retention. */
  flag(id: string, day: number): void;
  /** Removes entries whose retention has lapsed. See `pruneModerationLog` for the actual rule. */
  prune(currentDay: number): void;
}

/** [CALIBRATED — provisional] design doc §4 Tier 1: unflagged logs, rolling TTL. */
export const UNFLAGGED_RETENTION_DAYS = 30;

/** [CALIBRATED — provisional] design doc §4 Tier 2: DSA Article 20's ≥6-month appeal minimum, from the day flagged. */
export const DISPUTE_ARCHIVE_RETENTION_DAYS = 183;

/**
 * The bifurcated retention rule itself, factored out so both `InMemorySink` and any future
 * real backend apply the identical policy: an unflagged entry ages out at
 * `UNFLAGGED_RETENTION_DAYS`; a flagged entry survives until `DISPUTE_ARCHIVE_RETENTION_DAYS`
 * past the day it was flagged, not the day it was created — "retained for the duration of the
 * investigation plus the appeal window," approximated here as a fixed floor from the flag date
 * since "duration of investigation" isn't a thing this repo can model.
 */
export function isExpired(entry: ModerationLogEntry, currentDay: number): boolean {
  if (entry.flagged) {
    return currentDay - (entry.flaggedOnDay ?? entry.timestamp) >= DISPUTE_ARCHIVE_RETENTION_DAYS;
  }
  return currentDay - entry.timestamp >= UNFLAGGED_RETENTION_DAYS;
}

/** Reference sink for tests and local wiring — not a production backend (see file header). */
export function createInMemorySink(): ModerationLogSink {
  let store: ModerationLogEntry[] = [];
  return {
    record(entry) {
      store = [...store, entry];
    },
    entries() {
      return store;
    },
    flag(id, day) {
      store = store.map((e) => (e.id === id ? { ...e, flagged: true, flaggedOnDay: day } : e));
    },
    prune(currentDay) {
      store = store.filter((e) => !isExpired(e, currentDay));
    },
  };
}
