import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/sim/rng.js';
import {
  oracleWinProbability,
  pickPrizeType,
  ORACLE_HEALTH_REFERENCE,
  ORACLE_HEALTH_FLOOR,
  ORACLE_BASE_ODDS_HEALTHY,
  ORACLE_ODDS_FLOOR,
  ORACLE_PRIZE_TABLE,
} from '../src/engine/oracle.js';

/**
 * Regression tests for the Oracle (2026-08-18) — verified in isolation per CLAUDE.md
 * constraint 1, same pattern every other `src/engine/` module's test file uses.
 */

describe('oracleWinProbability', () => {
  it('is at its healthy maximum at or above ORACLE_HEALTH_REFERENCE', () => {
    expect(oracleWinProbability(ORACLE_HEALTH_REFERENCE)).toBeCloseTo(ORACLE_BASE_ODDS_HEALTHY, 10);
    expect(oracleWinProbability(1)).toBeCloseTo(ORACLE_BASE_ODDS_HEALTHY, 10);
  });

  it('never drops below ORACLE_ODDS_FLOOR, however sick the shard — constraint 2, no permanent zero-state', () => {
    expect(oracleWinProbability(ORACLE_HEALTH_FLOOR)).toBeCloseTo(ORACLE_ODDS_FLOOR, 10);
    expect(oracleWinProbability(0)).toBeCloseTo(ORACLE_ODDS_FLOOR, 10);
    expect(oracleWinProbability(-5)).toBeCloseTo(ORACLE_ODDS_FLOOR, 10);
  });

  it('never exceeds ORACLE_BASE_ODDS_HEALTHY even above the reference point', () => {
    expect(oracleWinProbability(2)).toBeLessThanOrEqual(ORACLE_BASE_ODDS_HEALTHY);
  });

  it('is monotonically non-decreasing in health — a sicker shard never gets BETTER odds than a healthier one', () => {
    const samples = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    let prev = -Infinity;
    for (const h of samples) {
      const odds = oracleWinProbability(h);
      expect(odds).toBeGreaterThanOrEqual(prev);
      prev = odds;
    }
  });
});

describe('pickPrizeType', () => {
  it('a grifter never gets the resourceStock prize — they have no personal resource stock to top up', () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 500; i++) {
      expect(pickPrizeType(true, rand)).not.toBe('resourceStock');
    }
  });

  it('a role-holder can receive any of the three prize types over enough draws', () => {
    const rand = mulberry32(2);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(pickPrizeType(false, rand));
    expect(seen).toEqual(new Set(['wealth', 'resourceStock', 'time']));
  });

  it('a grifter can receive both of their eligible prize types over enough draws', () => {
    const rand = mulberry32(3);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(pickPrizeType(true, rand));
    expect(seen).toEqual(new Set(['wealth', 'time']));
  });

  it('never crashes and always returns a value present in ORACLE_PRIZE_TABLE', () => {
    const rand = mulberry32(4);
    const validTypes = new Set(ORACLE_PRIZE_TABLE.map((p) => p.type));
    for (let i = 0; i < 200; i++) {
      expect(validTypes.has(pickPrizeType(i % 2 === 0, rand))).toBe(true);
    }
  });
});
