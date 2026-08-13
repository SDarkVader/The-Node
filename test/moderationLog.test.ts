import { describe, expect, it } from 'vitest';
import { composeUtterance } from '../src/comms/proximityConversation.js';
import {
  DISPUTE_ARCHIVE_RETENTION_DAYS,
  UNFLAGGED_RETENTION_DAYS,
  captureProximityConversationEvent,
  createInMemorySink,
  isExpired,
} from '../src/infra/moderationLog.js';

describe('moderation log — minimum viable footprint, no audio ever', () => {
  it('captures exactly the five design-doc fields, nothing else, from a real Utterance', () => {
    const u = composeUtterance('wren', 'warn', 'urgent', { kind: 'player', playerId: 'sable' }, 4, new Set(['sable']), 'myPrice');
    const entry = captureProximityConversationEvent(u, { x: 3, y: 7 }, 'evt-1');
    expect(entry).toEqual({
      id: 'evt-1',
      timestamp: 4,
      actorId: 'wren',
      targetIds: ['sable'],
      grammarPayload: { intent: 'warn', tone: 'urgent', referent: { kind: 'player', playerId: 'sable' }, context: 'myPrice' },
      spatialCoordinates: { x: 3, y: 7 },
      flagged: false,
    });
  });

  it('a room-directed turn has no specific target', () => {
    const u = composeUtterance('wren', 'inform', 'warm', { kind: 'room' }, 0, new Set());
    const entry = captureProximityConversationEvent(u, { x: 0, y: 0 }, 'evt-2');
    expect(entry.targetIds).toEqual([]);
  });

  it('never contains an audio field of any kind — the payload is structured data only', () => {
    const u = composeUtterance('wren', 'inform', 'warm', { kind: 'room' }, 0, new Set());
    const entry = captureProximityConversationEvent(u, { x: 0, y: 0 }, 'evt-3');
    expect(Object.keys(entry)).not.toContain('audio');
    expect(Object.keys(entry)).not.toContain('audioUrl');
    expect(Object.keys(entry.grammarPayload)).toEqual(['intent', 'tone', 'referent', 'context']);
  });
});

describe('moderation log — bifurcated retention (design doc §4)', () => {
  it('an unflagged entry survives right up to the 30-day boundary, then expires', () => {
    const u = composeUtterance('wren', 'inform', 'warm', { kind: 'room' }, 0, new Set());
    const entry = captureProximityConversationEvent(u, { x: 0, y: 0 }, 'evt-4');
    expect(isExpired(entry, UNFLAGGED_RETENTION_DAYS - 1)).toBe(false);
    expect(isExpired(entry, UNFLAGGED_RETENTION_DAYS)).toBe(true);
  });

  it('flagging an entry keeps it alive well past the unflagged TTL', () => {
    const sink = createInMemorySink();
    const u = composeUtterance('wren', 'inform', 'warm', { kind: 'room' }, 0, new Set());
    sink.record(captureProximityConversationEvent(u, { x: 0, y: 0 }, 'evt-5'));
    sink.flag('evt-5', 5);
    sink.prune(UNFLAGGED_RETENTION_DAYS + 1); // would have expired an unflagged entry
    expect(sink.entries().map((e) => e.id)).toEqual(['evt-5']);
  });

  it('a flagged entry still expires eventually, at the Dispute Archive floor from the day it was flagged', () => {
    const sink = createInMemorySink();
    const u = composeUtterance('wren', 'inform', 'warm', { kind: 'room' }, 0, new Set());
    sink.record(captureProximityConversationEvent(u, { x: 0, y: 0 }, 'evt-6'));
    sink.flag('evt-6', 5);
    sink.prune(5 + DISPUTE_ARCHIVE_RETENTION_DAYS - 1);
    expect(sink.entries()).toHaveLength(1);
    sink.prune(5 + DISPUTE_ARCHIVE_RETENTION_DAYS);
    expect(sink.entries()).toHaveLength(0);
  });

  it('prune only removes what has actually expired, never a live entry', () => {
    const sink = createInMemorySink();
    const u1 = composeUtterance('wren', 'inform', 'warm', { kind: 'room' }, 0, new Set());
    const u2 = composeUtterance('sable', 'ask', 'wry', { kind: 'room' }, 10, new Set());
    sink.record(captureProximityConversationEvent(u1, { x: 0, y: 0 }, 'evt-old'));
    sink.record(captureProximityConversationEvent(u2, { x: 0, y: 0 }, 'evt-new'));
    sink.prune(UNFLAGGED_RETENTION_DAYS);
    expect(sink.entries().map((e) => e.id)).toEqual(['evt-new']);
  });
});
