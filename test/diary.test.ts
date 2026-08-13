import { describe, expect, it } from 'vitest';
import {
  CONTEXT_TAGS,
  DIARY_RETENTION_DAYS,
  OBSERVATIONS,
  OBSERVATION_NEIGHBORS,
  READINGS,
  READING_NEIGHBORS,
  createDiaryStore,
  readDiary,
  writeDiaryEntry,
} from '../src/engine/diary.js';

describe('diary — structural table integrity', () => {
  it('every OBSERVATION has at least one neighbor, and every neighbor is itself a valid OBSERVATION', () => {
    for (const obs of OBSERVATIONS) {
      const neighbors = OBSERVATION_NEIGHBORS[obs];
      expect(neighbors.length).toBeGreaterThan(0);
      for (const n of neighbors) {
        expect(OBSERVATIONS).toContain(n);
      }
      expect(neighbors).not.toContain(obs); // distortion must actually change the value
    }
  });

  it('every READING has at least one neighbor, and every neighbor is itself a valid READING', () => {
    for (const reading of READINGS) {
      const neighbors = READING_NEIGHBORS[reading];
      expect(neighbors.length).toBeGreaterThan(0);
      for (const n of neighbors) {
        expect(READINGS).toContain(n);
      }
      expect(neighbors).not.toContain(reading);
    }
  });
});

describe('diary — composed, not typed: creation is gated', () => {
  it('cannot write an entry about yourself', () => {
    const store = createDiaryStore();
    expect(() =>
      writeDiaryEntry(store, 'wren', 'wren', 'undercutMyPrice', 'seemsCalculating', 0, new Set(['wren']), undefined),
    ).toThrow();
  });

  it('cannot write an entry about an unresolved subject — SUBJECT ties to fog-of-recognition', () => {
    const store = createDiaryStore();
    expect(() =>
      writeDiaryEntry(store, 'wren', 'sable', 'undercutMyPrice', 'seemsCalculating', 0, new Set(), undefined),
    ).toThrow();
  });

  it('writing about a known subject succeeds and is readable back the same day, unchanged', () => {
    const store = createDiaryStore();
    writeDiaryEntry(store, 'wren', 'sable', 'undercutMyPrice', 'seemsCalculating', 0, new Set(['sable']), 'trade');
    const entries = readDiary(store, 'wren', 0, () => 0.99); // rng near 1: distortion never fires anyway at 0 elapsed days
    expect(entries).toEqual([{ subject: 'sable', observation: 'undercutMyPrice', reading: 'seemsCalculating', context: 'trade' }]);
  });

  it('CONTEXT is optional', () => {
    const store = createDiaryStore();
    writeDiaryEntry(store, 'wren', 'sable', 'soughtMeOut', 'seemsTrustworthy', 0, new Set(['sable']));
    const [entry] = readDiary(store, 'wren', 0, () => 0.99);
    expect(entry!.context).toBeUndefined();
  });
});

describe('diary — daily distortion (corrected 2026-08-13): mechanical memory, not a transcript', () => {
  it('SUBJECT and CONTEXT never distort, even when OBSERVATION/READING do', () => {
    const store = createDiaryStore();
    writeDiaryEntry(store, 'wren', 'sable', 'undercutMyPrice', 'seemsCalculating', 0, new Set(['sable']), 'trade');
    // rng() = 0 always fires distortion (0 < any positive distortionRate)
    const [entry] = readDiary(store, 'wren', 1, () => 0);
    expect(entry!.subject).toBe('sable');
    expect(entry!.context).toBe('trade');
    expect(OBSERVATION_NEIGHBORS.undercutMyPrice).toContain(entry!.observation);
    expect(entry!.observation).not.toBe('undercutMyPrice');
    expect(READING_NEIGHBORS.seemsCalculating).toContain(entry!.reading);
    expect(entry!.reading).not.toBe('seemsCalculating');
  });

  it('an entry read on the same day it was written never distorts, regardless of rng', () => {
    const store = createDiaryStore();
    writeDiaryEntry(store, 'wren', 'sable', 'undercutMyPrice', 'seemsCalculating', 5, new Set(['sable']));
    const [entry] = readDiary(store, 'wren', 5, () => 0);
    expect(entry!.observation).toBe('undercutMyPrice');
    expect(entry!.reading).toBe('seemsCalculating');
  });

  it('a re-read on the same later day does not roll again — distortion is once per elapsed day, not per read', () => {
    const store = createDiaryStore();
    writeDiaryEntry(store, 'wren', 'sable', 'undercutMyPrice', 'seemsCalculating', 0, new Set(['sable']));
    let calls = 0;
    const rng = () => {
      calls += 1;
      return 0; // always distorts, deterministically to the first neighbor
    };
    const first = readDiary(store, 'wren', 1, rng);
    const callsAfterFirstRead = calls;
    const second = readDiary(store, 'wren', 1, rng);
    expect(second).toEqual(first);
    expect(calls).toBe(callsAfterFirstRead); // no additional rng draws on the same-day re-read
  });
});

describe("diary — retention (corrected 2026-08-13): ~2 days, \"yesterday's\" memory, not ~30", () => {
  it('an entry is alive strictly within the retention window', () => {
    const store = createDiaryStore();
    writeDiaryEntry(store, 'wren', 'sable', 'undercutMyPrice', 'seemsCalculating', 0, new Set(['sable']));
    expect(readDiary(store, 'wren', DIARY_RETENTION_DAYS - 1, () => 0.99)).toHaveLength(1);
  });

  it('an entry silently disappears at the retention boundary — no fade, just gone from the set', () => {
    const store = createDiaryStore();
    writeDiaryEntry(store, 'wren', 'sable', 'undercutMyPrice', 'seemsCalculating', 0, new Set(['sable']));
    expect(readDiary(store, 'wren', DIARY_RETENTION_DAYS, () => 0.99)).toEqual([]);
  });

  it('the shipped retention window is drastically shorter than the old ~30-day figure', () => {
    // Locks in the 2026-08-13 correction as a real regression, not just design intent.
    expect(DIARY_RETENTION_DAYS).toBeLessThanOrEqual(3);
  });
});

describe("diary — CONTEXT tags are a closed table too, matching proximity conversation's own", () => {
  it('is a non-empty, deduplicated table', () => {
    expect(CONTEXT_TAGS.length).toBeGreaterThan(0);
    expect(new Set(CONTEXT_TAGS).size).toBe(CONTEXT_TAGS.length);
  });
});
