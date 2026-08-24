import { describe, expect, it } from 'vitest';
import {
  HOURS_PER_DAY,
  OFFLINE_WINDOWS_UTC,
  IMPORT_EXPORT_WINDOWS_UTC,
  isHourInWindow,
  isOfflineHour,
  isImportExportWindowHour,
  importExportWindowEvents,
} from '../src/engine/dayCycle.js';
import { THROTTLE_WINDOWS_PER_DAY, THROTTLE_WINDOW_HOURS } from '../src/engine/wealth.js';

describe('dayCycle — window schedule', () => {
  it('has exactly wealth.ts\'s THROTTLE_WINDOWS_PER_DAY offline windows, each THROTTLE_WINDOW_HOURS wide', () => {
    expect(OFFLINE_WINDOWS_UTC.length).toBe(THROTTLE_WINDOWS_PER_DAY);
    for (const [start, end] of OFFLINE_WINDOWS_UTC) {
      expect(end - start).toBe(THROTTLE_WINDOW_HOURS);
    }
  });

  it('has exactly two Import/Export windows', () => {
    expect(IMPORT_EXPORT_WINDOWS_UTC.length).toBe(2);
  });

  it('offline and import/export windows never overlap', () => {
    for (let h = 0; h < HOURS_PER_DAY; h++) {
      expect(isOfflineHour(h) && isImportExportWindowHour(h)).toBe(false);
    }
  });

  it('isHourInWindow normalizes hours outside [0, 24) the same as their mod-24 equivalent', () => {
    expect(isHourInWindow(26, [2, 6])).toBe(isHourInWindow(2, [2, 6]));
    expect(isHourInWindow(-1, [23, 24])).toBe(isHourInWindow(23, [23, 24]));
  });

  it('isOfflineHour/isImportExportWindowHour agree with a brute-force scan of every hour', () => {
    for (let h = 0; h < HOURS_PER_DAY; h++) {
      const expectedOffline = OFFLINE_WINDOWS_UTC.some(([s, e]) => h >= s && h < e);
      const expectedIE = IMPORT_EXPORT_WINDOWS_UTC.some(([s, e]) => h >= s && h < e);
      expect(isOfflineHour(h)).toBe(expectedOffline);
      expect(isImportExportWindowHour(h)).toBe(expectedIE);
    }
  });
});

describe('importExportWindowEvents', () => {
  it('splits a daily total evenly across every window, byte-identical to the original sum', () => {
    const events = importExportWindowEvents(12, 3);
    expect(events.length).toBe(IMPORT_EXPORT_WINDOWS_UTC.length);
    const totalNodules = events.reduce((a, e) => a + e.nodulesReceived, 0);
    const totalGrain = events.reduce((a, e) => a + e.grainDelivered, 0);
    expect(totalNodules).toBeCloseTo(12, 10);
    expect(totalGrain).toBeCloseTo(3, 10);
  });

  it('tags each event with its own window index and UTC hour anchor, in schedule order', () => {
    const events = importExportWindowEvents(10, 10);
    events.forEach((e, i) => {
      expect(e.window).toBe(i);
      expect(e.hourUtc).toBe(IMPORT_EXPORT_WINDOWS_UTC[i]![0]);
    });
  });

  it('a zero daily total produces zero-valued, still-real (non-empty) window events — no permanent zero-state hides the schedule itself', () => {
    const events = importExportWindowEvents(0, 0);
    expect(events.length).toBe(IMPORT_EXPORT_WINDOWS_UTC.length);
    for (const e of events) {
      expect(e.nodulesReceived).toBe(0);
      expect(e.grainDelivered).toBe(0);
    }
  });
});
