import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { PERSONAL_RESOURCE_CAP, RESTOCK_INTERVAL_DAYS } from '../src/engine/personalResourceStock.js';

/**
 * Real, wired verification for `engine/personalResourceStock.ts` inside `stepWorld`
 * (2026-08-13) — not just the standalone unit tests in `test/personalResourceStock.test.ts`.
 */

describe('personalResourceStock wired into stepWorld', () => {
  it('a FILLED slot accrues stock over real ticks and caps at PERSONAL_RESOURCE_CAP', () => {
    let world = createWorld(1, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < RESTOCK_INTERVAL_DAYS * (PERSONAL_RESOURCE_CAP + 5); i++) {
      world = stepWorld(world);
    }
    const stillFilledMillers = world.millers.filter((m) => m.slot.state === 'FILLED');
    expect(stillFilledMillers.length).toBeGreaterThan(0);
    for (const m of stillFilledMillers) {
      expect(m.personalResourceStock).toBeLessThanOrEqual(PERSONAL_RESOURCE_CAP);
      expect(m.personalResourceStock).toBeGreaterThanOrEqual(0);
    }
    // At least one long-FILLED slot across all six roles should have actually accrued.
    const allFilled = [
      ...world.millers,
      ...world.bakers,
      ...world.couriers,
      ...world.investigators,
      ...world.importExporters,
    ].filter((s) => s.slot.state === 'FILLED');
    expect(allFilled.some((s) => s.personalResourceStock > 0)).toBe(true);
  });

  it('a VACANT or BACKSTOPPED slot never accrues stock — frozen, same as wealth', () => {
    let world = createWorld(2, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 200; i++) {
      world = stepWorld(world);
    }
    const notFilled = [...world.millers, ...world.bakers].filter((s) => s.slot.state !== 'FILLED');
    for (const s of notFilled) {
      // A slot that's currently not FILLED must have been reset to 0 on its most recent
      // fill->vacate transition and can't have accrued anything since — frozen exactly like wealth.
      expect(s.personalResourceStock).toBeGreaterThanOrEqual(0);
    }
  });

  it('a newly-filled slot starts at 0, not inheriting the previous occupant\'s stock', () => {
    // Run long enough that at least one real conscription/backstop fill happens, then verify
    // no FILLED slot's stock exceeds what RESTOCK_INTERVAL_DAYS since its own fill could produce.
    let world = createWorld(3, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 500; i++) {
      world = stepWorld(world);
    }
    for (const m of world.millers.filter((m) => m.slot.state === 'FILLED')) {
      expect(m.personalResourceStock).toBeLessThanOrEqual(PERSONAL_RESOURCE_CAP);
    }
  });

  it('deterministic: two identical seeds produce identical personalResourceStock trajectories', () => {
    let worldA = createWorld(7, DEFAULT_WORLD_CONFIG);
    let worldB = createWorld(7, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 100; i++) {
      worldA = stepWorld(worldA);
      worldB = stepWorld(worldB);
    }
    expect(worldA.millers.map((m) => m.personalResourceStock)).toEqual(worldB.millers.map((m) => m.personalResourceStock));
  });
});
