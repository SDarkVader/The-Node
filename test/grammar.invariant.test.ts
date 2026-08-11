import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SELF_STATES, TEMPLATES, postToWall, sendEnvelope } from '../src/comms/grammar.js';
import { SHARD_CHARACTERS, CANONICAL_ROLE_TITLES } from '../src/engine/shardIdentity.js';

/**
 * Structural invariants for the constrained grammar, written to survive the vocabulary
 * GROWING (2026-08-11, user-specified: envelopes, voice and the Wall will all get more
 * vocabulary, "using the same structural rules — some things can never be said ... as long
 * as we constrain the vocabulary and the experience tight enough against hard testing").
 *
 * The safety property comes from STRUCTURE, not from scarcity: it is not the count of
 * symbols that makes the channel safe, it is that certain sentence shapes cannot be formed
 * at all. So the vocabulary can expand freely — provided every addition still satisfies the
 * invariants below. These tests are the enforcement mechanism, written against the whole
 * table rather than the current ten entries.
 *
 * THE LOAD-BEARING RULE (2026-08-11, user directive): **no external identification
 * signature**. A message may never carry a referent that RESOLVES to a specific person —
 * not a name, not a handle, not a pronoun aimed at the recipient, not a definite singular
 * description ("the one I met"). This holds no matter how much the sender knows. The only
 * referent the grammar may ever admit is a ROLE, and only once relationship-earned
 * reputation unlocks it; roles are public mechanical facts, individuals are not.
 *
 * Why that specific cut, rather than "be polite":
 *   - It is the mechanical form of standing constraint 4 (personal memory mortal): a private
 *     dossier about another player needs a channel to travel through. Remove the referent
 *     and there is nothing captured in the first place.
 *   - It is what makes constraint 6 (reputation may only grant, never remove) enforceable.
 *     The way you bury someone is by naming them to third parties. No referent, no whisper
 *     campaign — reputation stays first-hand, earned by dealing with someone rather than by
 *     being told about them.
 *   - It closes the direct channel that third-party information travels down, which is the
 *     specific exploit surface documented in docs/ADVERSARIAL_CONTAINMENT.md.
 *
 * Two further rules are load-bearing for containment:
 *   - NO IMPERATIVES: a player must not be able to instruct an ally, so coordination
 *     requires trust rather than command.
 *   - NO INTERROGATIVES: a player must not be able to ask a direct question, so
 *     interrogation must happen by signalling and inference.
 * Both are enforced STRUCTURALLY below (every sentence must open "I ...") rather than by a
 * verb blacklist — a blacklist goes stale the moment the vocabulary grows, which is exactly
 * the failure mode these tests exist to prevent.
 */

// Every role name that exists anywhere — canonical AND every shard's local title. Built from
// the real sources so new roles or new shard characters are covered automatically, rather
// than from a hand-maintained list that silently goes stale.
const ROLE_WORDS = [
  ...Object.values(CANONICAL_ROLE_TITLES),
  ...SHARD_CHARACTERS.flatMap((c) => Object.values(c.roleTitles)),
]
  .flatMap((title) => title.split(/[\s/-]+/))
  .map((w) => w.toLowerCase())
  .filter((w) => w.length > 2);

/** Split a template into sentences, keeping only non-empty ones. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const BANNED = {
  // The identification-signature rule, in its lexical form. "people" and other unresolvable
  // plurals are deliberately NOT here: "the people I deal with" points at nobody, so it
  // carries no signature. What is banned is anything that RESOLVES.
  'a pronoun aimed at another person':
    /\b(you|your|yours|yourself|he|him|his|she|her|hers|they|them|their|theirs)\b/i,

  // The sneaky path to identification: a definite singular human noun plus any modifier
  // localises to exactly one player ("the one I met at the mill", "that player").
  'a definite singular description of a person':
    /\b(the|that|this)\s+(one|person|man|woman|guy|girl|player|neighbour|neighbor|stranger|friend|other)\b/i,

  // Out-of-band identifiers: handles, mentions, ids.
  'an out-of-band identifier': /[@#]\w|\bid\s*[:=]/i,

  // A proper noun is a name. "I" is the only capital allowed mid-sentence.
  'a proper noun': /(?<!^)(?<![.!?]\s)\b(?!I\b)[A-Z]\w+/,

  'past or future tense': /\b(was|were|did|had|have|has|will|shall|going to|used to|would|could)\b/i,

  'an explicit question mark': /\?/,

  'a quantity or price': /\d/,

  // Anaphora: a word that only means something in light of an earlier message. "I feel
  // that too" is not a self-state — it is a VOTE on someone else's self-state, and a chain
  // of votes is a whip count built without ever naming anyone. The self-state grammar is
  // safe because messages don't compose; anaphora is exactly how composition sneaks back in.
  'a reference to another message': /\b(too|also|same|likewise|ditto|agreed|agree|as well)\b/i,
};

describe('grammar invariants — must hold as the vocabulary expands', () => {
  it('every sentence in every template opens in the first person', () => {
    // This single rule does the work three blacklists used to do badly. A sentence that must
    // begin "I " cannot be an imperative ("Meet me at the mill"), cannot be an interrogative
    // ("Who do you trade with?"), and cannot open with a third-party subject. It stays true
    // however many verbs the vocabulary later gains, which a verb blacklist would not.
    for (const state of SELF_STATES) {
      const parts = sentences(TEMPLATES[state]);
      expect(parts.length, `template for "${state}" has no sentence`).toBeGreaterThan(0);
      for (const part of parts) {
        expect(part, `sentence in "${state}" is not first-person-initial: "${part}"`).toMatch(/^I[\s']/);
      }
    }
  });

  it('no template opens a clause with a wh-word', () => {
    // "I feel suspicious of what's happening" is a free relative, not a question — legal.
    // "I wonder. Who is milling?" would be a question smuggled into a second sentence.
    for (const state of SELF_STATES) {
      for (const part of sentences(TEMPLATES[state])) {
        expect(part, `sentence in "${state}" opens interrogatively: "${part}"`).not.toMatch(
          /^(who|what|when|where|why|how|which|whose)\b/i,
        );
      }
    }
  });

  for (const [rule, pattern] of Object.entries(BANNED)) {
    it(`no template contains ${rule}`, () => {
      for (const state of SELF_STATES) {
        expect(TEMPLATES[state], `template for "${state}" violates: ${rule}`).not.toMatch(pattern);
      }
    });
  }

  it("no template names any role — canonical or any shard's local title", () => {
    // Covers the gap the original test had: it banned baker/miller/courier by hand, missing
    // journalist, detective, importExport, and all 12 shard characters' local titles
    // (Grinder, Oven-keeper, Legman, Asker, Factor, ...). Derived from source so it cannot go
    // stale when a role or shard character is added.
    //
    // Note this bans role words from the BASE grammar outright. Role-level reference is the
    // one referent the design will ever admit, but it is reputation-gated and does not exist
    // yet; when it ships it must arrive as a separate gated vocabulary with its own
    // cardinality guard, not by loosening this table.
    expect(ROLE_WORDS.length).toBeGreaterThan(20); // sanity: the list really is being built
    for (const state of SELF_STATES) {
      const words = TEMPLATES[state].toLowerCase().split(/\W+/);
      for (const banned of ROLE_WORDS) {
        expect(words, `template for "${state}" names role word "${banned}"`).not.toContain(banned);
      }
    }
  });

  it('every declared state has a template, and every template a state — no orphans', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual([...SELF_STATES].sort());
  });

  it('templates are unique — two states must not read identically', () => {
    const texts = SELF_STATES.map((s) => TEMPLATES[s]);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('the vocabulary is a closed set: a state not in SELF_STATES has no template', () => {
    expect((TEMPLATES as Record<string, string>)['undercut the miller']).toBeUndefined();
  });

  it('a wall post carries no reference to any other message — no reply, no thread, no quote', () => {
    // The lexical anaphora ban above only catches composition attempted IN TEXT. The other
    // way to build a whip count is structural: a replyTo/parentId/threadId field that lets
    // the client render "N people said this in response to X" without a single banned word
    // appearing anywhere. If postToWall or sendEnvelope ever grow such a field, every message
    // becomes addressable and referenceable by every other — this test is what stands between
    // that regression and shipping unnoticed.
    const post = postToWall('author-1', 'hopeful', 1);
    expect(Object.keys(post).sort()).toEqual(['authorId', 'day', 'id', 'state'].sort());
  });

  it('an envelope carries no reference to any other message — no reply, no thread, no quote', () => {
    const env = sendEnvelope('sender-1', 'recipient-1', 'hopeful', 1);
    expect(Object.keys(env).sort()).toEqual(['fromId', 'toId', 'state', 'day', 'id', 'opened'].sort());
  });

  it('source has no reply/thread/quote/parent affordance anywhere in the grammar module', () => {
    // Belt and braces: even if a future field were named something this test's key-list
    // check doesn't anticipate, grep the source for the concept directly.
    const src = readFileSync(new URL('../src/comms/grammar.ts', import.meta.url), 'utf8');
    expect(src, 'grammar.ts must never gain a reply/thread/quote/parent/reference field').not.toMatch(
      /\b(replyTo|reply_to|parentId|parent_id|threadId|thread_id|quotedId|quoted_id|inReplyTo|referenceId)\b/i,
    );
  });
});
