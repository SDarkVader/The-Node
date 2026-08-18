import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { PERSONAL_RESOURCE_CAP } from '../src/engine/personalResourceStock.js';

/**
 * Real, wired integration for the Oracle (2026-08-18, docs/DESIGN_ORACLE_2026-08-13.md) —
 * verifies the whole chain against a real `World`, not just the standalone pure-function
 * tests in `test/oracle.test.ts`. The population-scale simulation harness/CLI this file's
 * own header used to flag as deferred is now built — `sim/oracleHarness.ts`/`oracleCli.ts`
 * (`npm run oracle-sim`) — and reads `World.lastOracleStats`, the side-channel this file
 * also covers below.
 */

describe('the Oracle — wired end-to-end through a real stepWorld run', () => {
  it('a grifter never ends up with negative wealth from an Oracle entry — the affordability check holds', () => {
    let world = createWorld(3, DEFAULT_WORLD_CONFIG);
    for (let day = 0; day < 200; day++) {
      world = stepWorld(world);
      for (const g of world.grifters) expect(g.wealth).toBeGreaterThanOrEqual(0);
      for (const m of world.millers) if (m.slot.state === 'FILLED') expect(m.wealth).toBeGreaterThanOrEqual(0);
      for (const c of world.couriers) if (c.slot.state === 'FILLED') expect(c.wealth).toBeGreaterThanOrEqual(0);
    }
  });

  it('personalResourceStock never exceeds PERSONAL_RESOURCE_CAP even with the Oracle able to top it up', () => {
    let world = createWorld(4, DEFAULT_WORLD_CONFIG);
    for (let day = 0; day < 300; day++) {
      world = stepWorld(world);
      for (const c of world.couriers) expect(c.personalResourceStock).toBeLessThanOrEqual(PERSONAL_RESOURCE_CAP);
      for (const m of world.millers) expect(m.personalResourceStock).toBeLessThanOrEqual(PERSONAL_RESOURCE_CAP);
    }
  });

  it('a grifter never gains reputationProgress, a role, or any standing from the Oracle — prizes stay economic only', () => {
    // Real, structural check: run a long stretch with churn AND sabotage both disabled
    // (pMonthly: 0, saboteurCount: 0 — sabotage independently creates BACKSTOPPED slots
    // regardless of pMonthly, a real gap an earlier test in this project already found and
    // documented) so no BACKSTOPPED slot ever exists for Shift Cover to notice — isolating
    // the Oracle as the sole remaining daily event touching grifters at all, and proving
    // directly it never touches reputationProgress.
    let world = createWorld(5, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0, saboteurCount: 0 });
    for (let day = 0; day < 300; day++) {
      world = stepWorld(world);
      for (const g of world.grifters) {
        expect(g.reputationProgress ?? 0).toBe(0);
      }
    }
  });

  it('daysInRole can be nudged upward by the Oracle beyond what pure day-by-day tenure alone would produce', () => {
    // Real, positive signal the mechanism actually fires under real load: after a long run,
    // at least one FILLED slot's daysInRole exceeds what it could have reached through pure
    // continuous tenure since its last real fill — only possible via an Oracle 'time' prize
    // adding real days on top.
    let world = createWorld(6, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0 });
    let sawNudge = false;
    for (let day = 0; day < 500 && !sawNudge; day++) {
      const prevMillerDays = world.millers.map((m) => m.daysInRole);
      world = stepWorld(world);
      world.millers.forEach((m, i) => {
        // A slot that was already FILLED both before and after should gain EXACTLY +1 per
        // tick from ordinary tenure alone; more than +1 (capped at ORACLE_TIME_NUDGE_DAYS
        // extra) means the Oracle nudged it.
        if (m.slot.state === 'FILLED' && m.daysInRole > prevMillerDays[i]! + 1) sawNudge = true;
      });
    }
    expect(sawNudge).toBe(true);
  });

  it('lastOracleStats stays internally consistent every tick — entrants >= entered >= wins, winsByPrize sums to wins', () => {
    let world = createWorld(7, DEFAULT_WORLD_CONFIG);
    let sawAnyWin = false;
    for (let day = 0; day < 300; day++) {
      world = stepWorld(world);
      const s = world.lastOracleStats;
      expect(s.entrants).toBeGreaterThanOrEqual(s.entered);
      expect(s.entered).toBeGreaterThanOrEqual(s.wins);
      expect(s.winsByPrize.wealth + s.winsByPrize.resourceStock + s.winsByPrize.time).toBe(s.wins);
      if (s.wins > 0) sawAnyWin = true;
    }
    // Real, positive signal the side-channel actually reports real activity, not just zeros.
    expect(sawAnyWin).toBe(true);
  });

  it('a freshly created World starts with an all-zero lastOracleStats — nothing has happened yet', () => {
    const world = createWorld(8, DEFAULT_WORLD_CONFIG);
    expect(world.lastOracleStats).toEqual({ entrants: 0, entered: 0, wins: 0, winsByPrize: { wealth: 0, resourceStock: 0, time: 0 } });
  });
});
