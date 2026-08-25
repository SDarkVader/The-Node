import { describe, expect, it } from 'vitest';
import { initialPresence, stepPresenceRecord, stepPresenceLedger, type PresenceRecord } from '../src/engine/presence.js';

/**
 * The presence/session primitive (2026-08-24) — pure-module tests. World-level wiring
 * (byte-identical when unset, reset-on-refill, real-server integration) is
 * `test/world.presence.test.ts` and `test/ws.presence.test.ts`.
 */

describe('initialPresence', () => {
  it('online: true starts at 1 consecutive online day, 0 offline', () => {
    expect(initialPresence(true)).toEqual({ online: true, consecutiveOnlineDays: 1, consecutiveOfflineDays: 0 });
  });

  it('online: false starts at 0 consecutive online days, 1 offline', () => {
    expect(initialPresence(false)).toEqual({ online: false, consecutiveOnlineDays: 0, consecutiveOfflineDays: 1 });
  });
});

describe('stepPresenceRecord', () => {
  it('prev undefined is treated as a fresh occupant — same as initialPresence', () => {
    expect(stepPresenceRecord(undefined, true)).toEqual(initialPresence(true));
    expect(stepPresenceRecord(undefined, false)).toEqual(initialPresence(false));
  });

  it('online streak increments while online, offline streak resets to 0', () => {
    let rec: PresenceRecord | undefined = undefined;
    for (let i = 1; i <= 5; i++) {
      rec = stepPresenceRecord(rec, true);
      expect(rec).toEqual({ online: true, consecutiveOnlineDays: i, consecutiveOfflineDays: 0 });
    }
  });

  it('offline streak increments while offline, online streak resets to 0', () => {
    let rec: PresenceRecord | undefined = undefined;
    for (let i = 1; i <= 5; i++) {
      rec = stepPresenceRecord(rec, false);
      expect(rec).toEqual({ online: false, consecutiveOnlineDays: 0, consecutiveOfflineDays: i });
    }
  });

  it('a transition from online to offline (and back) resets the opposite streak cleanly', () => {
    let rec = stepPresenceRecord(undefined, true);
    rec = stepPresenceRecord(rec, true);
    rec = stepPresenceRecord(rec, true);
    expect(rec).toEqual({ online: true, consecutiveOnlineDays: 3, consecutiveOfflineDays: 0 });

    rec = stepPresenceRecord(rec, false);
    expect(rec).toEqual({ online: false, consecutiveOnlineDays: 0, consecutiveOfflineDays: 1 });

    rec = stepPresenceRecord(rec, true);
    expect(rec).toEqual({ online: true, consecutiveOnlineDays: 1, consecutiveOfflineDays: 0 });
  });
});

describe('stepPresenceLedger', () => {
  it('produces exactly one entry per filled playerId, no more, no less', () => {
    const ledger = stepPresenceLedger({}, new Set(['a', 'b', 'c']), new Set(['a']));
    expect(Object.keys(ledger).sort()).toEqual(['a', 'b', 'c']);
    expect(ledger.a).toEqual({ online: true, consecutiveOnlineDays: 1, consecutiveOfflineDays: 0 });
    expect(ledger.b).toEqual({ online: false, consecutiveOnlineDays: 0, consecutiveOfflineDays: 1 });
  });

  it('carries an existing entry\'s streak forward across ticks', () => {
    let ledger = stepPresenceLedger({}, new Set(['a']), new Set(['a']));
    ledger = stepPresenceLedger(ledger, new Set(['a']), new Set(['a']));
    ledger = stepPresenceLedger(ledger, new Set(['a']), new Set(['a']));
    expect(ledger.a).toEqual({ online: true, consecutiveOnlineDays: 3, consecutiveOfflineDays: 0 });
  });

  it('a playerId no longer in filledPlayerIds has no entry at all — not stale, not zeroed, absent', () => {
    let ledger = stepPresenceLedger({}, new Set(['a', 'b']), new Set(['a', 'b']));
    ledger = stepPresenceLedger(ledger, new Set(['a']), new Set(['a'])); // b's slot vacated
    expect('b' in ledger).toBe(false);
  });

  it('a buildingId that returns to FILLED (new occupant) starts fresh, not inheriting the previous occupant\'s streak', () => {
    let ledger = stepPresenceLedger({}, new Set(['a']), new Set(['a']));
    ledger = stepPresenceLedger(ledger, new Set(['a']), new Set(['a']));
    expect(ledger.a!.consecutiveOnlineDays).toBe(2);

    ledger = stepPresenceLedger(ledger, new Set([]), new Set([])); // slot vacated
    expect('a' in ledger).toBe(false);

    ledger = stepPresenceLedger(ledger, new Set(['a']), new Set([])); // refilled, new occupant currently offline
    expect(ledger.a).toEqual({ online: false, consecutiveOnlineDays: 0, consecutiveOfflineDays: 1 });
  });

  it('an empty filled set produces an empty ledger', () => {
    expect(stepPresenceLedger({ a: { online: true, consecutiveOnlineDays: 9, consecutiveOfflineDays: 0 } }, new Set(), new Set())).toEqual({});
  });
});
