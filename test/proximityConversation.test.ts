import { describe, expect, it } from 'vitest';
import {
  CONTEXT_TAGS,
  INTENTS,
  INTENT_NEIGHBORS,
  TONES,
  TONE_NEIGHBORS,
  composeUtterance,
  degradeForListener,
} from '../src/comms/proximityConversation.js';

describe('proximity conversation — composed, not typed', () => {
  it('rejects anything outside the curated INTENT/TONE/CONTEXT tables', () => {
    expect(() =>
      composeUtterance('wren', 'not-a-real-intent' as never, 'warm', { kind: 'room' }, 0, new Set()),
    ).toThrow();
    expect(() =>
      composeUtterance('wren', 'inform', 'not-a-real-tone' as never, { kind: 'room' }, 0, new Set()),
    ).toThrow();
    expect(() =>
      composeUtterance('wren', 'inform', 'warm', { kind: 'room' }, 0, new Set(), 'not-a-real-tag' as never),
    ).toThrow();
  });

  it('accepts addressing the room generally', () => {
    const u = composeUtterance('wren', 'inform', 'warm', { kind: 'room' }, 0, new Set());
    expect(u.referent).toEqual({ kind: 'room' });
  });

  it('accepts addressing a specific present player', () => {
    const u = composeUtterance('wren', 'ask', 'wry', { kind: 'player', playerId: 'sable' }, 0, new Set(['sable']));
    expect(u.referent).toEqual({ kind: 'player', playerId: 'sable' });
  });

  it('cannot address yourself', () => {
    expect(() =>
      composeUtterance('wren', 'ask', 'wry', { kind: 'player', playerId: 'wren' }, 0, new Set(['wren'])),
    ).toThrow();
  });

  it('cannot address a player who is not physically present — REFERENT is never an absent player', () => {
    expect(() =>
      composeUtterance('wren', 'warn', 'urgent', { kind: 'player', playerId: 'ghost' }, 0, new Set(['sable'])),
    ).toThrow();
  });

  it('CONTEXT is optional', () => {
    const u = composeUtterance('wren', 'affirm', 'playful', { kind: 'room' }, 0, new Set());
    expect(u.context).toBeUndefined();
  });
});

describe('proximity conversation — neighbor table structural integrity', () => {
  it('every INTENT has at least one neighbor, all valid, none self-referencing', () => {
    for (const intent of INTENTS) {
      const neighbors = INTENT_NEIGHBORS[intent];
      expect(neighbors.length).toBeGreaterThan(0);
      for (const n of neighbors) expect(INTENTS).toContain(n);
      expect(neighbors).not.toContain(intent);
    }
  });

  it('every TONE has at least one neighbor, all valid, none self-referencing', () => {
    for (const tone of TONES) {
      const neighbors = TONE_NEIGHBORS[tone];
      expect(neighbors.length).toBeGreaterThan(0);
      for (const n of neighbors) expect(TONES).toContain(n);
      expect(neighbors).not.toContain(tone);
    }
  });
});

describe('proximity conversation — spatial clarity: corruption happens before synthesis', () => {
  it('a listener beyond maxRange hears nothing at all — not even a corrupted version', () => {
    const u = composeUtterance('wren', 'inform', 'warm', { kind: 'room' }, 0, new Set());
    expect(degradeForListener(u, 100, 10, [], () => 0)).toBeNull();
  });

  it('a listener right next to the speaker (distance 0) hears it exactly, regardless of rng', () => {
    const u = composeUtterance('wren', 'inform', 'warm', { kind: 'player', playerId: 'sable' }, 0, new Set(['sable']), 'myPrice');
    // rng() = 0 would force every corruption roll to fire if corruption chance were nonzero;
    // at distance 0, closeness = 1, so corruptionChance = fragility * (1 - 1) = 0 for every slot.
    const heard = degradeForListener(u, 0, 10, ['sable'], () => 0);
    expect(heard).toEqual({ speakerId: 'wren', intent: 'inform', tone: 'warm', referent: { kind: 'player', playerId: 'sable' }, context: 'myPrice', day: 0, clarity: 1 });
  });

  it('at the edge of range, with rng forcing every corruption roll, every fragile slot drifts', () => {
    const u = composeUtterance('wren', 'inform', 'warm', { kind: 'player', playerId: 'sable' }, 0, new Set(['sable']), 'myPrice');
    const heard = degradeForListener(u, 10, 10, ['sable', 'harlan'], () => 0);
    expect(heard).not.toBeNull();
    expect(INTENT_NEIGHBORS.inform).toContain(heard!.intent);
    expect(heard!.intent).not.toBe('inform');
    expect(TONE_NEIGHBORS.warm).toContain(heard!.tone);
    expect(heard!.tone).not.toBe('warm');
    // REFERENT is the most fragile slot and rng always corrupts: drops or distorts.
    expect(heard!.referent).not.toEqual({ kind: 'player', playerId: 'sable' });
    // CONTEXT is the most fragile slot and rng always corrupts: drops to undefined here (rng()<0.5 branch).
    expect(heard!.context).toBeUndefined();
  });

  it('a corrupted REFERENT never resolves to someone who was not actually present', () => {
    const u = composeUtterance('wren', 'inform', 'warm', { kind: 'player', playerId: 'sable' }, 0, new Set(['sable']));
    const heard = degradeForListener(u, 10, 10, ['sable', 'harlan'], () => 0);
    if (heard!.referent.kind === 'player') {
      expect(['sable', 'harlan']).toContain(heard!.referent.playerId);
    }
  });

  it('an utterance with no CONTEXT never gains one through corruption', () => {
    const u = composeUtterance('wren', 'inform', 'warm', { kind: 'room' }, 0, new Set());
    const heard = degradeForListener(u, 10, 10, [], () => 0);
    expect(heard!.context).toBeUndefined();
  });

  it('CONTEXT_TAGS is a non-empty, deduplicated table', () => {
    expect(CONTEXT_TAGS.length).toBeGreaterThan(0);
    expect(new Set(CONTEXT_TAGS).size).toBe(CONTEXT_TAGS.length);
  });
});
