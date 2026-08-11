import { describe, expect, it } from 'vitest';
import {
  stepDistrictHealth,
  initialDistrictHealth,
  districtFilledFraction,
  consolidationFrictionMultiplier,
  DISTRICT_TIPPING_POINT_FILLED_FRACTION,
  CONSOLIDATION_GRACE_DAYS,
  CONSOLIDATION_FRICTION_FLOOR,
} from '../src/engine/districtConsolidation.js';

/**
 * Regression tests for the district-consolidation primitive (2026-08-11) — verified in
 * isolation before trusting it in a larger simulation, per CLAUDE.md constraint 1.
 */

describe('districtFilledFraction', () => {
  it('is the simple filled/total ratio', () => {
    expect(districtFilledFraction(3, 10)).toBeCloseTo(0.3, 10);
  });

  it('reads as vacuously healthy (1) when a district has no role slots at all', () => {
    expect(districtFilledFraction(0, 0)).toBe(1);
  });
});

describe('stepDistrictHealth — irreversible ratchet', () => {
  it('stays ACTIVE while filledFraction is at or above the tipping point', () => {
    let health = initialDistrictHealth();
    for (let day = 0; day < 100; day++) {
      health = stepDistrictHealth(health, DISTRICT_TIPPING_POINT_FILLED_FRACTION + 0.1, day);
    }
    expect(health.state).toBe('ACTIVE');
  });

  it('crosses into CONSOLIDATING the day filledFraction drops below the tipping point', () => {
    let health = initialDistrictHealth();
    health = stepDistrictHealth(health, 0.9, 0);
    expect(health.state).toBe('ACTIVE');
    health = stepDistrictHealth(health, 0.1, 1);
    expect(health.state).toBe('CONSOLIDATING');
    expect(health.consolidatingSince).toBe(1);
  });

  it('never reverts to ACTIVE even if filledFraction fully recovers mid-countdown', () => {
    let health = initialDistrictHealth();
    health = stepDistrictHealth(health, 0.1, 0); // triggers CONSOLIDATING
    expect(health.state).toBe('CONSOLIDATING');
    // Full recovery the very next day — should NOT undo the ratchet.
    for (let day = 1; day < CONSOLIDATION_GRACE_DAYS - 1; day++) {
      health = stepDistrictHealth(health, 1.0, day);
      expect(health.state).toBe('CONSOLIDATING');
    }
  });

  it('becomes MERGED exactly after CONSOLIDATION_GRACE_DAYS have passed, and stays MERGED forever after', () => {
    let health = initialDistrictHealth();
    health = stepDistrictHealth(health, 0.0, 0); // triggers CONSOLIDATING on day 0
    for (let day = 1; day < CONSOLIDATION_GRACE_DAYS; day++) {
      health = stepDistrictHealth(health, 1.0, day); // recovery ignored, still counting down
      expect(health.state).toBe('CONSOLIDATING');
    }
    health = stepDistrictHealth(health, 1.0, CONSOLIDATION_GRACE_DAYS);
    expect(health.state).toBe('MERGED');
    // Terminal — even wildly different inputs afterward never move it.
    for (let day = CONSOLIDATION_GRACE_DAYS + 1; day < CONSOLIDATION_GRACE_DAYS + 50; day++) {
      health = stepDistrictHealth(health, 1.0, day);
      expect(health.state).toBe('MERGED');
    }
  });
});

describe('consolidationFrictionMultiplier — the visible "cracks forming"', () => {
  it('is exactly 1 (full access) while ACTIVE', () => {
    expect(consolidationFrictionMultiplier(initialDistrictHealth(), 5)).toBe(1);
  });

  it('ramps down linearly across the grace period once CONSOLIDATING', () => {
    const startHealth = { state: 'CONSOLIDATING' as const, consolidatingSince: 0 };
    const mid = consolidationFrictionMultiplier(startHealth, CONSOLIDATION_GRACE_DAYS / 2);
    const early = consolidationFrictionMultiplier(startHealth, 1);
    const late = consolidationFrictionMultiplier(startHealth, CONSOLIDATION_GRACE_DAYS - 1);
    expect(early).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(late);
    expect(early).toBeLessThan(1);
  });

  it('never drops below the floor, even mid-countdown or once MERGED', () => {
    const consolidating = { state: 'CONSOLIDATING' as const, consolidatingSince: 0 };
    expect(consolidationFrictionMultiplier(consolidating, CONSOLIDATION_GRACE_DAYS)).toBeCloseTo(CONSOLIDATION_FRICTION_FLOOR, 10);
    const merged = { state: 'MERGED' as const, consolidatingSince: 0 };
    expect(consolidationFrictionMultiplier(merged, 999)).toBe(CONSOLIDATION_FRICTION_FLOOR);
  });

  it('the floor is strictly positive — no permanent zero-access, constraint 2', () => {
    expect(CONSOLIDATION_FRICTION_FLOOR).toBeGreaterThan(0);
  });
});
