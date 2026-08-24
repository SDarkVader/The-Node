import { describe, expect, it } from 'vitest';
import {
  reputationLevelForProgress,
  rolesEligibleFor,
  REPUTATION_LEVEL_THRESHOLDS,
  MAX_REPUTATION_LEVEL,
} from '../src/engine/reputation.js';

/**
 * Regression tests for reputation levels (2026-08-13,
 * docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md §3) — verified in isolation per CLAUDE.md
 * constraint 1, same pattern every other `src/engine/` module's test file uses.
 *
 * Scope: this module computes level/progress only. The voluntary-uptake GATE is not wired
 * into world.ts's role-fill selection yet (see reputation.ts's own header for why — the real
 * fill mechanism doesn't select individual grifters for voluntary fills today), so there's
 * nothing to test at the world-integration level for the gate itself.
 */

describe('reputationLevelForProgress', () => {
  it('is 0 below the first threshold', () => {
    expect(reputationLevelForProgress(0)).toBe(0);
    expect(reputationLevelForProgress(REPUTATION_LEVEL_THRESHOLDS[0]! - 1)).toBe(0);
  });

  it('reaches level 1 exactly at the first threshold, not before', () => {
    expect(reputationLevelForProgress(REPUTATION_LEVEL_THRESHOLDS[0]!)).toBe(1);
  });

  it('reaches level 2 exactly at the second threshold', () => {
    expect(reputationLevelForProgress(REPUTATION_LEVEL_THRESHOLDS[1]!)).toBe(2);
  });

  it('never exceeds MAX_REPUTATION_LEVEL, however large progress gets', () => {
    expect(reputationLevelForProgress(1_000_000)).toBe(MAX_REPUTATION_LEVEL);
  });

  it('is monotonically non-decreasing in progress — more progress never LOWERS a level (constraint 6, additive-only)', () => {
    let lastLevel = 0;
    for (let progress = 0; progress <= 20; progress++) {
      const level = reputationLevelForProgress(progress);
      expect(level).toBeGreaterThanOrEqual(lastLevel);
      lastLevel = level;
    }
  });

  it('is a pure function — same input always gives the same output', () => {
    expect(reputationLevelForProgress(5)).toBe(reputationLevelForProgress(5));
  });
});

describe('rolesEligibleFor', () => {
  it('unlocks nothing at level 0 — a brand-new grifter has no voluntary role yet', () => {
    expect(rolesEligibleFor(0)).toEqual([]);
  });

  it('unlocks exactly the three cooperative roles at level 1, per the measured ~97-100% completion cluster (§3.2)', () => {
    expect(rolesEligibleFor(1)).toEqual(['courier', 'investigator', 'importExport']);
  });

  it('level 2 is ADDITIVE on top of level 1, never a replacement (constraint 6)', () => {
    const level1 = rolesEligibleFor(1);
    const level2 = rolesEligibleFor(2);
    for (const role of level1) {
      expect(level2).toContain(role);
    }
    expect(level2).toContain('miller');
    expect(level2).toContain('baker');
  });

  it('a level above MAX_REPUTATION_LEVEL is treated the same as MAX_REPUTATION_LEVEL — never fewer roles for more reputation', () => {
    expect(rolesEligibleFor(MAX_REPUTATION_LEVEL + 5)).toEqual(rolesEligibleFor(MAX_REPUTATION_LEVEL));
  });

  it('a negative level (should never occur) still returns the empty level-0 set rather than throwing', () => {
    expect(rolesEligibleFor(-1)).toEqual([]);
  });
});
