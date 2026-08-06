import { describe, expect, it } from 'vitest';
import { SELF_STATES, TEMPLATES, postToWall, sendEnvelope, openEnvelope } from '../src/comms/grammar.js';

// A conservative catch for a template someone adds later that violates §3.1. Not a
// full grammar parser — just the structural red flags the brief calls out explicitly.
const SECOND_OR_THIRD_PERSON = /\b(you|your|yours|he|she|they|them|their|theirs|it|its|baker|miller|courier)\b/i;
const PAST_OR_FUTURE_TENSE_HINTS = /\b(was|were|did|had|will|going to|used to)\b/i;

describe('§3.1 — grammar constraint is structural, not a filter', () => {
  it('every template is first-person, present-tense, and names nobody', () => {
    for (const state of SELF_STATES) {
      const text = TEMPLATES[state];
      expect(text).toMatch(/^I /);
      expect(text).not.toMatch(SECOND_OR_THIRD_PERSON);
      expect(text).not.toMatch(PAST_OR_FUTURE_TENSE_HINTS);
    }
  });

  it('postToWall only accepts a curated self-state, not arbitrary text', () => {
    const post = postToWall('player-a', 'isolated', 1);
    expect(post.state).toBe('isolated');
    expect(() => postToWall('player-a', 'this is free text, not a state' as never, 1)).toThrow();
  });

  it('sendEnvelope carries the exact same grammar as the Wall', () => {
    const envelope = sendEnvelope('player-a', 'player-b', 'manipulated', 1);
    expect(TEMPLATES[envelope.state]).toBe(TEMPLATES.manipulated);
    expect(() => sendEnvelope('player-a', 'player-b', 'not a real state' as never, 1)).toThrow();
  });

  it('an envelope cannot be sent to yourself', () => {
    expect(() => sendEnvelope('player-a', 'player-a', 'isolated', 1)).toThrow();
  });

  it('opening an envelope does not change its content, only its opened flag', () => {
    const envelope = sendEnvelope('player-a', 'player-b', 'exploited', 3);
    const opened = openEnvelope(envelope);
    expect(opened.opened).toBe(true);
    expect(opened.state).toBe(envelope.state);
    expect(envelope.opened).toBe(false); // original is untouched (pure function)
  });
});
