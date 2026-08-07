import { describe, expect, it } from 'vitest';
import { addEntry, createPrivateStore, getAlive } from '../src/engine/privateStore.js';

describe('PrivateStore — rolling per-entry silent expiry', () => {
  it('an entry is alive strictly within its TTL window', () => {
    const store = createPrivateStore<string>();
    addEntry(store, 'wren', 'undercut my price', 0);
    expect(getAlive(store, 'wren', 29, 30)).toEqual(['undercut my price']);
  });

  it('an entry silently disappears at its TTL boundary — no fade, just gone', () => {
    const store = createPrivateStore<string>();
    addEntry(store, 'wren', 'undercut my price', 0);
    expect(getAlive(store, 'wren', 30, 30)).toEqual([]);
  });

  it('each entry ages out on its own clock — oldest first, not a whole-subject wipe', () => {
    const store = createPrivateStore<string>();
    addEntry(store, 'wren', 'day 0 entry', 0);
    addEntry(store, 'wren', 'day 10 entry', 10);
    // At day 30, the day-0 entry (age 30) has expired but the day-10 entry (age 20) hasn't.
    expect(getAlive(store, 'wren', 30, 30)).toEqual(['day 10 entry']);
  });

  it('entries are private per owner — one player\'s entries never leak into another\'s read', () => {
    const store = createPrivateStore<string>();
    addEntry(store, 'wren', 'about sable', 0);
    addEntry(store, 'sable', 'about wren', 0);
    expect(getAlive(store, 'wren', 5, 30)).toEqual(['about sable']);
    expect(getAlive(store, 'sable', 5, 30)).toEqual(['about wren']);
  });

  it('reading with no entries for a player returns empty, not an error', () => {
    const store = createPrivateStore<string>();
    expect(getAlive(store, 'ghost', 0, 30)).toEqual([]);
  });

  it('expired entries are actually dropped from the store, not just filtered on read', () => {
    const store = createPrivateStore<string>();
    addEntry(store, 'wren', 'stale', 0);
    addEntry(store, 'wren', 'fresh', 25);
    getAlive(store, 'wren', 30, 30); // triggers the drop as a read side effect
    // A later read at a day where 'stale' would have re-qualified if it weren't dropped
    // (it can't — TTL only counts up — but this also asserts the internal list actually
    // shrank, not just that the filtered *result* was correct).
    expect(store.get('wren')?.length).toBe(1);
  });
});
