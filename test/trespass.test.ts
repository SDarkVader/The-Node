import { describe, expect, it } from 'vitest';
import { canAttemptTrespass, type TrespassEligibility } from '../src/engine/trespass.js';

/**
 * Trespass eligibility (2026-08-25) — the absence-gate precondition
 * (`docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7.1). Pure-module tests only; World-level
 * wiring onto real `World.presence` is `test/world.trespass.test.ts`.
 */

describe('canAttemptTrespass', () => {
  it('offline is always eligible, regardless of targetAtAbode', () => {
    expect(canAttemptTrespass({ targetOnline: false, targetAtAbode: true })).toBe(true);
    expect(canAttemptTrespass({ targetOnline: false, targetAtAbode: false })).toBe(true);
  });

  it('online and at abode is NOT eligible — the only ineligible case', () => {
    expect(canAttemptTrespass({ targetOnline: true, targetAtAbode: true })).toBe(false);
  });

  it('online but elsewhere IS eligible', () => {
    expect(canAttemptTrespass({ targetOnline: true, targetAtAbode: false })).toBe(true);
  });

  it('every (targetOnline, targetAtAbode) combination matches the truth table exactly', () => {
    const table: [TrespassEligibility, boolean][] = [
      [{ targetOnline: false, targetAtAbode: false }, true],
      [{ targetOnline: false, targetAtAbode: true }, true],
      [{ targetOnline: true, targetAtAbode: false }, true],
      [{ targetOnline: true, targetAtAbode: true }, false],
    ];
    for (const [input, expected] of table) {
      expect(canAttemptTrespass(input)).toBe(expected);
    }
  });
});
