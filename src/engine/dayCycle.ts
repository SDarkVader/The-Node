/**
 * The basic day (2026-08-24, user-specified: "we need a basic day before we can have
 * anything more"). Gives the kernel's existing daily-blended economics real intra-day
 * structure — named, UTC-anchored windows that fire twice a day and are reported as real
 * per-window events, instead of being smeared into one blended-per-tick scalar.
 *
 * Two window families, both twice daily, both already implied by existing code but never
 * given real structure until now:
 *
 * 1. OFFLINE windows — `wealth.ts`'s `DAILY_ACTIVITY_MULTIPLIER` already blends exactly
 *    `THROTTLE_WINDOWS_PER_DAY` (2) x `THROTTLE_WINDOW_HOURS` (4) hours of dampened activity
 *    into every flow; that file's own comment names this module as the missing piece
 *    ("a real-time server-clock policy... a separate and later concern... genuinely
 *    unbuildable here until that server exists to have a wall clock at all"). This module
 *    gives those two windows real UTC anchors, reusing wealth.ts's own width/count rather
 *    than re-deriving them, so the blended multiplier and the named windows can never drift
 *    apart into two different numbers.
 *
 * 2. IMPORT/EXPORT windows — "the import/export serves as passage for migration with
 *    different shards. windows of opportunity open twice daily for migration for legal and
 *    illegal routing of people and goods" (2026-08-24, user-specified). `importExport.ts`'s
 *    nodule/grain supply and `attemptCrossing`'s route resolution were both real mechanisms
 *    already, just computed and reported as one blended-per-day number with no visible
 *    window structure — exactly the gap this module closes for reporting purposes.
 *
 * SCOPE, flagged not silently narrowed (2026-08-24 scoping discussion, explicit user
 * decision — "kernel first, server cadence next pass"): this kernel's tick is still one full
 * day; see wealth.ts's own "IMPLEMENTATION SCOPE" note on why finer ticks would invalidate
 * the whole economy's existing calibration. What this module adds is real per-window
 * STRUCTURE and REPORTING at that same daily granularity — splitting one blended daily total
 * into two dated window events, and (in `multiShardHarness.ts`) tagging which of the day's
 * two windows each migration attempt falls in. Actually gating real player connections or
 * actions by the live wall clock is a separate, later piece — the live server's tick cadence
 * is still 2.5s-by-default dev ticks, not real 24h-aligned ones, and there is no session/
 * presence primitive yet for a wall-clock gate to attach to. Deliberately not done here.
 */
import { THROTTLE_WINDOWS_PER_DAY, THROTTLE_WINDOW_HOURS } from './wealth.js';

export const HOURS_PER_DAY = 24;

/** [start, end) in UTC hours, end exclusive. */
export type HourWindow = readonly [number, number];

/**
 * Offline/downtime windows — same count and width `wealth.ts`'s `DAILY_ACTIVITY_MULTIPLIER`
 * already blends into every flow (2 x 4hr). [ILLUSTRATIVE hour placement — the width/count
 * are the calibrated part; the exact anchor hours are a placeholder until the live server
 * actually has a wall clock to schedule against].
 */
export const OFFLINE_WINDOWS_UTC: readonly HourWindow[] = Array.from({ length: THROTTLE_WINDOWS_PER_DAY }, (_, i) => {
  const start = i * (HOURS_PER_DAY / THROTTLE_WINDOWS_PER_DAY);
  return [start, start + THROTTLE_WINDOW_HOURS] as const;
});

/**
 * Import/Export migration windows. Placed to not coincide with an offline window — a
 * crossing attempt shouldn't fall inside the shard's own dampened stretch. [ILLUSTRATIVE
 * hour placement and width — the "twice daily" count is the real spec, the exact hours are
 * not].
 */
export const IMPORT_EXPORT_WINDOWS_PER_DAY = 2;
export const IMPORT_EXPORT_WINDOW_HOURS = 2;
export const IMPORT_EXPORT_WINDOWS_UTC: readonly HourWindow[] = [
  [6, 6 + IMPORT_EXPORT_WINDOW_HOURS],
  [18, 18 + IMPORT_EXPORT_WINDOW_HOURS],
];

function normalizeHour(hourUtc: number): number {
  return ((hourUtc % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
}

export function isHourInWindow(hourUtc: number, window: HourWindow): boolean {
  const h = normalizeHour(hourUtc);
  return h >= window[0] && h < window[1];
}

export function isOfflineHour(hourUtc: number): boolean {
  return OFFLINE_WINDOWS_UTC.some((w) => isHourInWindow(hourUtc, w));
}

export function isImportExportWindowHour(hourUtc: number): boolean {
  return IMPORT_EXPORT_WINDOWS_UTC.some((w) => isHourInWindow(hourUtc, w));
}

/** Real per-window report for one day's Import/Export supply — replaces one blended daily
 *  number with `IMPORT_EXPORT_WINDOWS_UTC.length` dated, equal-share events. The total across
 *  all windows is byte-identical to the single daily figure it replaces; only the structure
 *  and reporting granularity change, the same move `wealth.ts` already made for
 *  `THROTTLE_WINDOWS_PER_DAY`. */
export interface ImportExportWindowEvent {
  window: number;
  hourUtc: number;
  nodulesReceived: number;
  grainDelivered: number;
}

export function importExportWindowEvents(dailyNodules: number, dailyGrain: number): ImportExportWindowEvent[] {
  const n = IMPORT_EXPORT_WINDOWS_UTC.length;
  return IMPORT_EXPORT_WINDOWS_UTC.map(([hourUtc], window) => ({
    window,
    hourUtc,
    nodulesReceived: dailyNodules / n,
    grainDelivered: dailyGrain / n,
  }));
}
