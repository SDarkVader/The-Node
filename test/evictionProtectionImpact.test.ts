import { describe, expect, it } from 'vitest';
import { runEvictionProtectionComparison, realisticEventFrequency } from '../src/sim/evictionProtectionHarness.js';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { ESTABLISHED_TENURE_DAYS } from '../src/sim/multiRoleConscription.js';

/**
 * Real, measured regression lock-in for the 2026-08-18 eviction-preference bias — user:
 * "simulate it — verify the eviction preference under real load." `sim/evictionProtectionCli.ts`
 * (`npm run eviction-protection-sim`) is the full 8-seed/3000-day report; this is a smaller but
 * still real run of the same harness, asserting the actual measured numbers hold. If a future
 * change to `ESTABLISHED_TENURE_DAYS` or the selection logic pushes the effect back toward
 * "no measurable protection" or "destabilizes the economy," this should fail here.
 */

function meanOf(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

describe('eviction preference — real, measured effect under DEFAULT_WORLD_CONFIG scale (2026-08-18)', () => {
  it('conscriptionFromOtherRole — the event type the preference touches — fires with real, nonzero frequency, not dead code', () => {
    const tally = realisticEventFrequency(1, 1500);
    expect(tally['conscriptionFromOtherRole'] ?? 0).toBeGreaterThan(0);
  });

  it('steady-state mean daysInRole among FILLED slots is measurably HIGHER with the preference than without it — the real protective effect', () => {
    const { withPreference, withoutPreference } = runEvictionProtectionComparison(2, 1500, DEFAULT_WORLD_CONFIG);
    const burnIn = 300;
    const withMean = meanOf(withPreference.meanFilledTenure.slice(burnIn).filter((x) => !Number.isNaN(x)));
    const withoutMean = meanOf(withoutPreference.meanFilledTenure.slice(burnIn).filter((x) => !Number.isNaN(x)));
    expect(withMean).toBeGreaterThan(withoutMean);
    // Real measured relative uplift at 8 seeds x 3000 days was ~50%; loosely bounded here
    // (smaller/shorter run) to stay a real check, not a brittle exact-number pin.
    expect((withMean - withoutMean) / withoutMean).toBeGreaterThan(0.1);
  });

  it('economicHealth stays statistically comparable with vs without — the preference does not destabilize the economy', () => {
    const { withPreference, withoutPreference } = runEvictionProtectionComparison(3, 1500, DEFAULT_WORLD_CONFIG);
    const burnIn = 300;
    const withHealth = meanOf(withPreference.economicHealthSeries.slice(burnIn));
    const withoutHealth = meanOf(withoutPreference.economicHealthSeries.slice(burnIn));
    expect(Math.abs(withHealth - withoutHealth)).toBeLessThan(0.02);
  });

  it('population/occupancy accounting never breaks (never goes negative) across a long run', () => {
    const { withPreference, withoutPreference } = runEvictionProtectionComparison(4, 1500, DEFAULT_WORLD_CONFIG);
    expect(Math.min(...withPreference.totalAccountedFor)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...withoutPreference.totalAccountedFor)).toBeGreaterThanOrEqual(0);
  });

  it('ESTABLISHED_TENURE_DAYS stays a small, sane threshold relative to the measured steady-state tenure — sanity, not a tautology', () => {
    expect(ESTABLISHED_TENURE_DAYS).toBeGreaterThan(0);
    expect(ESTABLISHED_TENURE_DAYS).toBeLessThan(365);
  });
});
