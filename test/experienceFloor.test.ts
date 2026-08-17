import { describe, expect, it } from 'vitest';
import { EXPERIENCE_CAP } from '../src/engine/ecosystem.js';
import {
  EXPERIENCE_FLOOR_MAX_FRACTION,
  EXPERIENCE_FLOOR_PER_SHIFT,
  experienceFloorFromShiftsCovered,
} from '../src/engine/experienceFloor.js';

describe('experienceFloorFromShiftsCovered — grant-only head start, not a shortcut to full parity', () => {
  it('zero prior covers matches the existing experience:0 reset exactly — never worse off', () => {
    expect(experienceFloorFromShiftsCovered(0)).toBe(0);
  });

  it('grows linearly with shifts covered, below the cap', () => {
    expect(experienceFloorFromShiftsCovered(1)).toBeCloseTo(EXPERIENCE_FLOOR_PER_SHIFT, 10);
    expect(experienceFloorFromShiftsCovered(2)).toBeCloseTo(EXPERIENCE_FLOOR_PER_SHIFT * 2, 10);
  });

  it('never exceeds EXPERIENCE_FLOOR_MAX_FRACTION of EXPERIENCE_CAP no matter how many shifts covered', () => {
    const huge = experienceFloorFromShiftsCovered(10_000);
    expect(huge).toBe(EXPERIENCE_CAP * EXPERIENCE_FLOOR_MAX_FRACTION);
  });

  it('the cap is strictly below full EXPERIENCE_CAP — a head start, not parity with a real veteran', () => {
    expect(EXPERIENCE_CAP * EXPERIENCE_FLOOR_MAX_FRACTION).toBeLessThan(EXPERIENCE_CAP);
  });

  it('negative input (defensive) never produces a negative floor', () => {
    expect(experienceFloorFromShiftsCovered(-5)).toBe(0);
  });
});
