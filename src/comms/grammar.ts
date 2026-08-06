/**
 * Shared grammar constraint for the City Wall (public) and Envelopes (private), §3.1.
 * Structural, not moderated: content is drawn from a fixed first-person/present-tense
 * template set, so harassment vocabulary is unavailable by construction rather than
 * caught after the fact. Wall and Envelope share this exact type — the brief is explicit
 * that audience size is the only functional difference between the two channels.
 */

export const SELF_STATES = [
  'isolated',
  'manipulated',
  'distrustful',
  'exploited',
  'suspicious',
  'uneasy',
  'overwhelmed',
  'hopeful',
  'secure',
  'grateful',
] as const;

export type SelfState = (typeof SELF_STATES)[number];

/**
 * Every entry is a first-person, present-tense, zero-third-party statement — never
 * naming another player or role. Adding an entry that violates this is a design error;
 * test/grammar.test.ts asserts the whole table structurally, not just spot-checks it.
 */
export const TEMPLATES: Record<SelfState, string> = {
  isolated: 'I feel isolated.',
  manipulated: 'I feel manipulated.',
  distrustful: "I don't trust the people I deal with right now.",
  exploited: 'I feel exploited.',
  suspicious: "I feel suspicious of what's happening around me.",
  uneasy: 'I feel uneasy.',
  overwhelmed: 'I feel overwhelmed.',
  hopeful: 'I feel hopeful about where things are heading.',
  secure: 'I feel secure right now.',
  grateful: 'I feel grateful.',
};

function assertValidState(state: SelfState): void {
  if (!(state in TEMPLATES)) {
    throw new Error(`"${state}" is not a valid self-state — only the curated template set is permitted`);
  }
}

export interface WallPost {
  id: string;
  authorId: string;
  state: SelfState;
  day: number;
}

export interface Envelope {
  id: string;
  fromId: string;
  toId: string;
  state: SelfState;
  day: number;
  opened: boolean;
}

let nextId = 0;
function freshId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

/** Public post to the City Wall — visible to the whole node, attributed by username only. */
export function postToWall(authorId: string, state: SelfState, day: number): WallPost {
  assertValidState(state);
  return { id: freshId('wall'), authorId, state, day };
}

/** Private, asynchronous message — same grammar as the Wall, audience is one recipient. */
export function sendEnvelope(fromId: string, toId: string, state: SelfState, day: number): Envelope {
  assertValidState(state);
  if (fromId === toId) {
    throw new Error('cannot send an envelope to yourself');
  }
  return { id: freshId('env'), fromId, toId, state, day, opened: false };
}

export function openEnvelope(envelope: Envelope): Envelope {
  return { ...envelope, opened: true };
}
