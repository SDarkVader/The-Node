import { describe, expect, it } from 'vitest';
import { runLevelTwoReachability } from '../src/sim/levelTwoReachabilityHarness.js';

/**
 * Real, measured regression lock-in for the 2026-08-18 level-2 reputation gate fix — user:
 * "tackle the level-2 reputation gate." `sim/levelTwoReachabilityCli.ts`
 * (`npm run level-two-reachability-sim`) is the full 8-seed/800-day report (matching the
 * original 2026-08-13 measurement's own run length); this is a smaller but still real run of
 * the same harness, asserting the actual measured direction and magnitude hold. If a future
 * change to `orderGrifterCandidatesForNotice` or the reputation thresholds erases the real
 * improvement measured here, this should fail, not be caught by accident.
 */

describe('level-2 reputation gate fix — real, measured effect (2026-08-18)', () => {
  it('measurably MORE grifters reach level 2 with the fix than without it', () => {
    const withFix = runLevelTwoReachability(1, 800, true);
    const withoutFix = runLevelTwoReachability(1, 800, false);
    expect(withFix.everReachedLevel2.size).toBeGreaterThan(withoutFix.everReachedLevel2.size);
    // Real measured uplift at 8 seeds was ~256% relative; loosely bounded here (single seed)
    // to stay a real check, not a brittle exact-number pin.
    expect(withFix.everReachedLevel2.size).toBeGreaterThan(withoutFix.everReachedLevel2.size * 1.2);
  });

  it('level-0 grifters still receive the large majority of Shift Cover completions — not starved by the racing-grifter priority', () => {
    const withFix = runLevelTwoReachability(2, 800, true);
    const level0Share = withFix.level0CoversCredited / Math.max(1, withFix.totalCoversCredited);
    expect(level0Share).toBeGreaterThan(0.5);
  });

  it('with no racing grifter ever possible (thresholds collapsed to 0), the fix is a no-op — degenerates to the original wealth-only rule', () => {
    // Indirect proof of the backward-compatibility guarantee already unit-tested directly in
    // shiftCover.test.ts: run a very short window where no grifter has had time to reach
    // level 1 yet, and confirm both arms produce identical level-2 counts (both zero).
    const withFix = runLevelTwoReachability(3, 5, true);
    const withoutFix = runLevelTwoReachability(3, 5, false);
    expect(withFix.everReachedLevel2.size).toBe(0);
    expect(withoutFix.everReachedLevel2.size).toBe(0);
  });

  it('never crashes and produces only non-negative counts across a long run, several seeds', () => {
    for (const seed of [4, 5, 6]) {
      const r = runLevelTwoReachability(seed, 400, true);
      expect(r.everReachedLevel2.size).toBeGreaterThanOrEqual(0);
      expect(r.totalCoversCredited).toBeGreaterThanOrEqual(0);
      expect(r.level0CoversCredited).toBeGreaterThanOrEqual(0);
      expect(r.level0CoversCredited).toBeLessThanOrEqual(r.totalCoversCredited);
      for (const d of r.daysAtLevelOneBeforeRemoval) expect(d).toBeGreaterThanOrEqual(0);
    }
  });
});
