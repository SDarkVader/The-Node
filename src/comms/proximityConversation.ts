import { applyDistortion } from './decay.js';
import { proximityCloseness } from '../engine/space.js';

/**
 * Proximity conversation (`docs/DESIGN_ADDENDUM_2026-08-06.md` — "Proximity conversation —
 * 1:1 and group, in-room and nearby"). Live, addressed, turn-taking conversation between
 * players sharing physical proximity — distinct from Wall/Envelope (asynchronous, no
 * third-party reference). No microphone, ever: a turn is composed from closed slot tables,
 * the same `INTENT x TONE x REFERENT x CONTEXT` combinatorial-not-flat-list principle as
 * `comms/grammar.ts`'s `SELF_STATES`, and rendered through TTS entirely client/infra-side —
 * nothing about audio rendering belongs in this engine module.
 *
 * **Ephemerality is architectural, not a runtime check.** This module deliberately has no
 * store, no `getAlive`, no query-by-day function — unlike Wall/Envelope or the diary, there
 * is nothing here *to* persist. "No GAME mechanic records room conversation, full stop" is
 * enforced by this file simply never providing a persistence API, not by a flag someone
 * could get wrong. A player who wants to relay something heard here later has to route it
 * back through the existing Wall/Envelope grammar (`postToWall`/`sendEnvelope`) — no new
 * relay path is added. Real infrastructure-layer logging (access logs, abuse-report
 * tooling) is a separate, siloed system — `docs/DESIGN_MODERATION_LOGGING_2026-08-13.md` —
 * with zero dependency on or awareness from this module, matching that doc's own §3.
 */

export const INTENTS = ['inform', 'ask', 'warn', 'deflect', 'affirm', 'refuse', 'needle', 'reassure'] as const;
export type Intent = (typeof INTENTS)[number];

export const TONES = ['warm', 'cold', 'wry', 'urgent', 'guarded', 'playful', 'weary'] as const;
export type Tone = (typeof TONES)[number];

/** Ties a turn to existing game state rather than open topic text. [ILLUSTRATIVE] not final. */
export const CONTEXT_TAGS = ['myPrice', 'myVacancyStatus', 'rumourIHeard'] as const;
export type ContextTag = (typeof CONTEXT_TAGS)[number];

export type PlayerId = string;

/**
 * REFERENT — the room generally, or a specific *present* player. Never an absent one: per
 * the design, direct address to someone in the room isn't the same defamation risk as
 * gossiping about a third party who can't answer, since everyone present already knows
 * who's present.
 */
export type Referent = { kind: 'room' } | { kind: 'player'; playerId: PlayerId };

export interface Utterance {
  speakerId: PlayerId;
  intent: Intent;
  tone: Tone;
  referent: Referent;
  context?: ContextTag;
  day: number;
}

function assertMember<T extends string>(value: T, table: readonly T[], label: string): void {
  if (!table.includes(value)) {
    throw new Error(`"${value}" is not a valid ${label} — only the curated template set is permitted`);
  }
}

/**
 * Composes one turn. Throws on anything outside the closed tables (same function-boundary
 * validation as `postToWall`), on addressing yourself (extends `sendEnvelope`'s identical
 * self-target check — not explicitly stated in the design, a reasonable consistent default),
 * and on addressing anyone not in `presentPlayerIds` — REFERENT's whole point is that it can
 * only ever name someone who's actually there.
 */
export function composeUtterance(
  speakerId: PlayerId,
  intent: Intent,
  tone: Tone,
  referent: Referent,
  day: number,
  presentPlayerIds: ReadonlySet<PlayerId>,
  context?: ContextTag,
): Utterance {
  assertMember(intent, INTENTS, 'INTENT');
  assertMember(tone, TONES, 'TONE');
  if (referent.kind === 'player') {
    if (referent.playerId === speakerId) {
      throw new Error('cannot address yourself');
    }
    if (!presentPlayerIds.has(referent.playerId)) {
      throw new Error('REFERENT must be a player physically present in the room — never an absent one');
    }
  }
  if (context !== undefined) {
    assertMember(context, CONTEXT_TAGS, 'CONTEXT tag');
  }
  return { speakerId, intent, tone, referent, context, day };
}

/**
 * Plausible-adjacent drift targets — same semantically-adjacent-not-noise discipline as the
 * rumour mill's `DISTORTION_NEIGHBORS`. [CALIBRATED — provisional] illustrative, not tuned.
 */
export const INTENT_NEIGHBORS: Record<Intent, readonly Intent[]> = {
  inform: ['ask', 'affirm'],
  ask: ['inform', 'needle'],
  warn: ['needle', 'deflect'],
  deflect: ['refuse', 'warn'],
  affirm: ['reassure', 'inform'],
  refuse: ['deflect', 'needle'],
  needle: ['warn', 'ask'],
  reassure: ['affirm', 'deflect'],
};

/** [CALIBRATED — provisional] illustrative, not tuned. */
export const TONE_NEIGHBORS: Record<Tone, readonly Tone[]> = {
  warm: ['playful', 'weary'],
  cold: ['guarded', 'weary'],
  wry: ['playful', 'guarded'],
  urgent: ['cold', 'weary'],
  guarded: ['cold', 'wry'],
  playful: ['warm', 'wry'],
  weary: ['cold', 'urgent'],
};

/**
 * Per-slot susceptibility to distance-driven corruption. TONE and INTENT survive longest —
 * "you can usually tell someone's warning you and how urgently, even at range" — while
 * REFERENT and CONTEXT, the specific information-dense slots, drop or distort first.
 * [CALIBRATED — provisional] the design's own [OPEN] flags this exact curve as untuned.
 */
export const SLOT_FRAGILITY = {
  intent: 0.3,
  tone: 0.25,
  referent: 0.7,
  context: 0.85,
} as const;

export interface HeardUtterance {
  speakerId: PlayerId;
  intent: Intent;
  tone: Tone;
  referent: Referent;
  context?: ContextTag;
  day: number;
  /** 0 (barely audible) .. 1 (right next to the speaker) — informational, not itself corruptible. */
  clarity: number;
}

/**
 * Degrades an utterance for one listener based on physical distance — reusing
 * `space.ts`'s `proximityCloseness` (already built as the wiring point for exactly this,
 * per its own doc comment) to feed the rumour mill's `applyDistortion` primitive, driven by
 * distance instead of graph hops. Corruption happens BEFORE synthesis: the caller only ever
 * receives an already-degraded `HeardUtterance`, matching the design's "no clean signal sent
 * to a distant listener to turn down or recover" — there is nothing to recover, by
 * construction. Returns null when the listener is beyond `maxRange`: out of range hears
 * nothing at all, not even a corrupted version.
 */
export function degradeForListener(
  utterance: Utterance,
  distanceToListener: number,
  maxRange: number,
  presentPlayerIds: readonly PlayerId[],
  rng: () => number,
): HeardUtterance | null {
  const closeness = proximityCloseness(distanceToListener, maxRange);
  if (closeness === null) return null;

  const corruptionChance = (fragility: number) => Math.min(1, fragility * (1 - closeness));

  const { value: intent } = applyDistortion(
    utterance.intent,
    { distortionRate: corruptionChance(SLOT_FRAGILITY.intent), neighbors: INTENT_NEIGHBORS },
    rng,
  );
  const { value: tone } = applyDistortion(
    utterance.tone,
    { distortionRate: corruptionChance(SLOT_FRAGILITY.tone), neighbors: TONE_NEIGHBORS },
    rng,
  );

  let referent = utterance.referent;
  if (rng() < corruptionChance(SLOT_FRAGILITY.referent)) {
    const others = presentPlayerIds.filter((id) => !(referent.kind === 'player' && id === referent.playerId));
    referent = others.length > 0 && rng() < 0.5 ? { kind: 'player', playerId: others[Math.floor(rng() * others.length)]! } : { kind: 'room' };
  }

  let context = utterance.context;
  if (context !== undefined && rng() < corruptionChance(SLOT_FRAGILITY.context)) {
    context = rng() < 0.5 ? undefined : CONTEXT_TAGS[Math.floor(rng() * CONTEXT_TAGS.length)];
  }

  return { speakerId: utterance.speakerId, intent, tone, referent, context, day: utterance.day, clarity: closeness };
}
