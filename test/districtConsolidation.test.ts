import { describe, expect, it } from 'vitest';
import {
  CONSOLIDATION_TRIGGER_DAYS,
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

  it('engages only on sustained decline, and records when it did', () => {
    // The ratchet reads a smoothed signal, so it engages once occupancy has genuinely
    // stayed low — not on the first bad day (which previously made MERGED an absorbing
    // state that swallowed every district within ~500 days).
    let health = initialDistrictHealth();
    let day = 0;
    while (health.state === 'ACTIVE' && day < 500) health = stepDistrictHealth(health, 0.1, day++);
    expect(health.state).toBe('CONSOLIDATING');
    expect(health.consolidatingSince).toBe(day - 1);
    expect(health.daysBelowTippingPoint).toBeGreaterThanOrEqual(CONSOLIDATION_TRIGGER_DAYS);
  });

  it('never reverts to ACTIVE even if filledFraction fully recovers mid-countdown', () => {
    let health = initialDistrictHealth();
    for (let i = 0; i < CONSOLIDATION_TRIGGER_DAYS; i++) health = stepDistrictHealth(health, 0.1, i);
    expect(health.state).toBe('CONSOLIDATING');
    // Full recovery right after the ratchet engages — must NOT undo it.
    for (let day = CONSOLIDATION_TRIGGER_DAYS; day < CONSOLIDATION_TRIGGER_DAYS + CONSOLIDATION_GRACE_DAYS - 1; day++) {
      health = stepDistrictHealth(health, 1.0, day);
      expect(health.state).toBe('CONSOLIDATING');
    }
  });

  it('becomes MERGED exactly after CONSOLIDATION_GRACE_DAYS have passed, and stays MERGED forever after', () => {
    let health = initialDistrictHealth();
    for (let i = 0; i < CONSOLIDATION_TRIGGER_DAYS; i++) health = stepDistrictHealth(health, 0.0, i);
    expect(health.state).toBe('CONSOLIDATING');
    const t0 = CONSOLIDATION_TRIGGER_DAYS - 1; // consolidatingSince
    for (let day = t0 + 1; day < t0 + CONSOLIDATION_GRACE_DAYS; day++) {
      health = stepDistrictHealth(health, 1.0, day); // recovery ignored, still counting down
      expect(health.state).toBe('CONSOLIDATING');
    }
    health = stepDistrictHealth(health, 1.0, t0 + CONSOLIDATION_GRACE_DAYS);
    expect(health.state).toBe('MERGED');
    // Terminal — even wildly different inputs afterward never move it.
    for (let day = t0 + CONSOLIDATION_GRACE_DAYS + 1; day < t0 + CONSOLIDATION_GRACE_DAYS + 50; day++) {
      health = stepDistrictHealth(health, 1.0, day);
      expect(health.state).toBe('MERGED');
    }
  });
});

describe('stepDistrictHealth — the smoothed signal, and MERGED not being an absorbing state', () => {
  it('ordinary churn noise cannot doom a district — brief dips leave the EMA above the tipping point', () => {
    // Regression for a real defect: with a RAW instantaneous fraction, any single bad day
    // engaged an irreversible ratchet, so every district merged within ~500 days and the
    // mechanic then never fired again. A district cycling around healthy occupancy with
    // occasional empty days must stay ACTIVE indefinitely.
    let health = initialDistrictHealth();
    for (let day = 0; day < 2000; day++) {
      const fraction = day % 7 === 0 ? 0.0 : 0.9; // one empty day a week, otherwise well staffed
      health = stepDistrictHealth(health, fraction, day);
    }
    expect(health.state).toBe('ACTIVE');
  });

  it('genuine sustained under-occupancy still engages the ratchet', () => {
    let health = initialDistrictHealth();
    let day = 0;
    while (health.state === 'ACTIVE' && day < 2000) health = stepDistrictHealth(health, 0.05, day++);
    expect(health.state).toBe('CONSOLIDATING');
  });

  it('discriminates a thin-but-viable district from a genuinely failing one', () => {
    const drive = (fraction: number) => {
      let h = initialDistrictHealth();
      for (let day = 0; day < 1500; day++) h = stepDistrictHealth(h, fraction, day);
      return h.state;
    };
    expect(drive(0.5)).toBe('ACTIVE'); // comfortably above the tipping point
    expect(drive(0.35)).toBe('ACTIVE'); // thin, but viable — must NOT be doomed
    expect(drive(0.1)).toBe('MERGED'); // genuinely failing
  });

  it('the EMA is seeded by the first observation, not assumed healthy or empty', () => {
    const h = stepDistrictHealth(initialDistrictHealth(), 0.42, 0);
    expect(h.emaFilledFraction).toBeCloseTo(0.42, 10);
  });
});

describe('consolidationFrictionMultiplier — the visible "cracks forming"', () => {
  it('is exactly 1 (full access) while ACTIVE', () => {
    expect(consolidationFrictionMultiplier(initialDistrictHealth(), 5)).toBe(1);
  });

  it('ramps down linearly across the grace period once CONSOLIDATING', () => {
    const startHealth = { state: 'CONSOLIDATING' as const, consolidatingSince: 0, daysBelowTippingPoint: 21, emaFilledFraction: 0 };
    const mid = consolidationFrictionMultiplier(startHealth, CONSOLIDATION_GRACE_DAYS / 2);
    const early = consolidationFrictionMultiplier(startHealth, 1);
    const late = consolidationFrictionMultiplier(startHealth, CONSOLIDATION_GRACE_DAYS - 1);
    expect(early).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(late);
    expect(early).toBeLessThan(1);
  });

  it('never drops below the floor, even mid-countdown or once MERGED', () => {
    const consolidating = { state: 'CONSOLIDATING' as const, consolidatingSince: 0, daysBelowTippingPoint: 21, emaFilledFraction: 0 };
    expect(consolidationFrictionMultiplier(consolidating, CONSOLIDATION_GRACE_DAYS)).toBeCloseTo(CONSOLIDATION_FRICTION_FLOOR, 10);
    const merged = { state: 'MERGED' as const, consolidatingSince: 0, daysBelowTippingPoint: 21, emaFilledFraction: 0 };
    expect(consolidationFrictionMultiplier(merged, 999)).toBe(CONSOLIDATION_FRICTION_FLOOR);
  });

  it('the floor is strictly positive — no permanent zero-access, constraint 2', () => {
    expect(CONSOLIDATION_FRICTION_FLOOR).toBeGreaterThan(0);
  });
});
