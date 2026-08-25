/**
 * The action vocabulary (2026-08-24, user-specified — "let's look at next steps" ->
 * "Action vocabulary"). The inbound pipe (`ws.ts`, 2026-08-19) has always been able to
 * receive `{ action: string, payload: unknown }`, but nothing has ever interpreted one —
 * `stepWorld` doesn't read `pendingActions`, both server paths only ever echo it back for
 * observability. This module is the first real interpretation: three actions, chosen because
 * they're the only mechanics with existing, tested, `stepWorld`-consumed plumbing already —
 * `pendingWallPosts`, `pendingDiaryEntries`, `pendingProximityUtterances`. Every other
 * mechanic either has no player-input slot at all (Miller/Baker's `value` is 100% algorithmic
 * best-response, no parameter for a player choice exists in `stepMillers`/`stepBakers`) or
 * reduces to occupancy/friction with no decision point in the engine (Courier, Investigator,
 * Import/Export, Shift Cover, Oracle entry) — those are bigger, separate design work, not
 * scoped here.
 *
 * DELIBERATELY NOT AN AUTHENTICATION SYSTEM. `ws.ts`'s own header already calls
 * `?player=<id>` binding "a stand-in for real auth, not real auth" for the legacy path; the
 * same caveat applies to whatever binds a connection's claimed identity for these actions.
 * What this module does own is the one thing that IS real regardless of how identity gets
 * bound: `payload` is untrusted input from an untrusted connection, and `parseGameAction` is
 * total — it validates the wire shape and enum membership and returns `null` for anything
 * malformed, the same "never throw on bad input" contract `ws.ts`'s own `parseClientMessage`
 * already holds itself to. Deeper semantic validation (self-reference, an unresolved subject,
 * an absent referent) is deliberately NOT duplicated here — `writeDiaryEntry`/
 * `composeUtterance` already do that and `stepWorld` already reports the outcome via
 * `lastDiaryRejections`/`lastProximityRejections`, so re-checking it here would just be a
 * second, driftable copy of the same rule.
 */
import { SELF_STATES, type SelfState } from '../comms/grammar.js';
import { OBSERVATIONS, READINGS, CONTEXT_TAGS as DIARY_CONTEXT_TAGS, type Observation, type Reading, type ContextTag as DiaryContextTag } from '../engine/diary.js';
import {
  INTENTS,
  TONES,
  CONTEXT_TAGS as PROXIMITY_CONTEXT_TAGS,
  type Intent as ProximityIntent,
  type Tone as ProximityTone,
  type Referent as ProximityReferent,
  type ContextTag as ProximityContextTag,
} from '../comms/proximityConversation.js';
import { isFilledRoleHolder, type World, type PendingDiaryEntry, type PendingProximityUtterance } from '../world/world.js';
import type { WallPost } from '../comms/grammar.js';
import type { PlayerId } from '../engine/player.js';

export type GameAction =
  | { kind: 'wallPost'; state: SelfState }
  | { kind: 'diaryEntry'; subject: PlayerId; observation: Observation; reading: Reading; context?: DiaryContextTag }
  | { kind: 'proximityUtterance'; intent: ProximityIntent; tone: ProximityTone; referent: ProximityReferent; context?: ProximityContextTag };

function isMember<T extends string>(value: unknown, members: readonly T[]): value is T {
  return typeof value === 'string' && (members as readonly string[]).includes(value);
}

function parseReferent(value: unknown): ProximityReferent | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if (r.kind === 'room') return { kind: 'room' };
  if (r.kind === 'player' && typeof r.playerId === 'string' && r.playerId.length > 0) {
    return { kind: 'player', playerId: r.playerId };
  }
  return null;
}

/**
 * Parses one inbound `(action, payload)` pair into a `GameAction`, or `null` for anything
 * malformed. Total — never throws. Unknown `action` strings return `null` rather than being
 * treated as an error condition, the same "not every message is for you" tolerance
 * `parseClientMessage` already has for `type !== 'action'`.
 */
export function parseGameAction(action: string, payload: unknown): GameAction | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;

  switch (action) {
    case 'wallPost': {
      if (!isMember(p.state, SELF_STATES)) return null;
      return { kind: 'wallPost', state: p.state };
    }
    case 'diaryEntry': {
      if (typeof p.subject !== 'string' || p.subject.length === 0) return null;
      if (!isMember(p.observation, OBSERVATIONS)) return null;
      if (!isMember(p.reading, READINGS)) return null;
      if (p.context !== undefined && !isMember(p.context, DIARY_CONTEXT_TAGS)) return null;
      return { kind: 'diaryEntry', subject: p.subject, observation: p.observation, reading: p.reading, context: p.context as DiaryContextTag | undefined };
    }
    case 'proximityUtterance': {
      if (!isMember(p.intent, INTENTS)) return null;
      if (!isMember(p.tone, TONES)) return null;
      const referent = parseReferent(p.referent);
      if (referent === null) return null;
      if (p.context !== undefined && !isMember(p.context, PROXIMITY_CONTEXT_TAGS)) return null;
      return { kind: 'proximityUtterance', intent: p.intent, tone: p.tone, referent, context: p.context as ProximityContextTag | undefined };
    }
    default:
      return null;
  }
}

/**
 * Queues a validated action onto the matching `pendingX` field — the same "caller populates,
 * `stepWorld` consumes and clears" convention `pendingWallPosts`/`pendingDiaryEntries`/
 * `pendingProximityUtterances` already use everywhere else in this codebase (sim drivers,
 * tests). Does NOT call `stepWorld` itself — the caller decides when to step, same as every
 * other queuing site.
 *
 * `authorId` is never taken from `payload` — it comes from the connection's server-bound
 * identity (see `ws.ts`), so a client cannot claim to be someone else by writing a different
 * id into the message body.
 */
export function queueGameAction(world: World, authorId: PlayerId, action: GameAction): World {
  switch (action.kind) {
    case 'wallPost': {
      const post: WallPost = {
        id: `client-${world.tick}-${world.pendingWallPosts.length}`,
        authorId,
        state: action.state,
        day: world.tick,
      };
      return { ...world, pendingWallPosts: [...world.pendingWallPosts, post] };
    }
    case 'diaryEntry': {
      const entry: PendingDiaryEntry = { authorId, subject: action.subject, observation: action.observation, reading: action.reading, context: action.context };
      return { ...world, pendingDiaryEntries: [...world.pendingDiaryEntries, entry] };
    }
    case 'proximityUtterance': {
      const utterance: PendingProximityUtterance = { speakerId: authorId, intent: action.intent, tone: action.tone, referent: action.referent, context: action.context };
      return { ...world, pendingProximityUtterances: [...world.pendingProximityUtterances, utterance] };
    }
  }
}

/**
 * Full pipe for one inbound `(connectionAuthorId, action, payload)` triple: resolves identity
 * (must be a currently-FILLED role holder — see `isFilledRoleHolder`'s header for why),
 * parses the wire payload, and queues it. Returns the world unchanged if either check fails —
 * silently, not an error condition from this module's point of view: an unresolved or
 * malformed action is exactly as valid an outcome as `parseClientMessage` returning `null`
 * for a malformed frame. Callers that want to log/count rejections do so from the return
 * value's own `pendingX` length delta, not from a thrown exception.
 */
export function applyClientAction(world: World, authorId: PlayerId | null, action: string, payload: unknown): World {
  if (authorId === null || !isFilledRoleHolder(world, authorId)) return world;
  const parsed = parseGameAction(action, payload);
  if (parsed === null) return world;
  return queueGameAction(world, authorId, parsed);
}
