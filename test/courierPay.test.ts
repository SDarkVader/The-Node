import { describe, expect, it } from 'vitest';
import { courierRouteDistance, courierDailyPay, COURIER_FEE_PER_DISTANCE_UNIT } from '../src/engine/courierPay.js';
import { generateShardLayout, DEFAULT_SHARD_CONFIG, distance } from '../src/engine/space.js';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { SUPPORT_ROLE_DAILY_WAGE, DAILY_ACTIVITY_MULTIPLIER } from '../src/engine/wealth.js';

/**
 * Regression tests for Courier pay (2026-08-11 addendum item 6, "distance-indexed,
 * commissioner-funded") — verified in isolation per CLAUDE.md constraint 1, same pattern
 * every other `src/engine/` module's test file uses.
 */

describe('courierRouteDistance', () => {
  it('matches the real Manhattan distance from a district plaza to the shard hub', () => {
    const shard = generateShardLayout(1, DEFAULT_SHARD_CONFIG);
    const d = shard.districts[0]!;
    expect(courierRouteDistance(shard, d.id)).toBe(distance(d.plazaPlot, shard.hubPlot));
  });

  it('returns 0, not a crash, for an unknown districtId', () => {
    const shard = generateShardLayout(1, DEFAULT_SHARD_CONFIG);
    expect(courierRouteDistance(shard, 'nonexistent-district')).toBe(0);
  });

  it('periphery districts sit meaningfully further from the hub than core districts', () => {
    // Real, measured geometry, not asserted in the abstract — this is the actual property
    // the whole mechanic depends on: distance has to vary enough to matter.
    const shard = generateShardLayout(1, DEFAULT_SHARD_CONFIG);
    const core = shard.districts.filter((d) => d.classification === 'core');
    const periphery = shard.districts.filter((d) => d.classification === 'periphery');
    const meanCore = core.reduce((s, d) => s + courierRouteDistance(shard, d.id), 0) / core.length;
    const meanPeriphery = periphery.reduce((s, d) => s + courierRouteDistance(shard, d.id), 0) / periphery.length;
    expect(meanPeriphery).toBeGreaterThan(meanCore * 2);
  });
});

describe('courierDailyPay', () => {
  it('is distance x rate x activity x friction, nothing else', () => {
    expect(courierDailyPay(10, 1, 1, 0.1)).toBeCloseTo(1, 10);
    expect(courierDailyPay(10, 0.7, 1, 0.1)).toBeCloseTo(0.7, 10);
    expect(courierDailyPay(10, 1, 0.5, 0.1)).toBeCloseTo(0.5, 10);
  });

  it('is zero at zero distance, however much activity/friction there is', () => {
    expect(courierDailyPay(0, 1, 1)).toBe(0);
  });

  it('friction can only ever reduce pay, never exceed the friction=1 ceiling', () => {
    const ceiling = courierDailyPay(20, DAILY_ACTIVITY_MULTIPLIER, 1);
    for (const friction of [0, 0.2, 0.5, 0.9, 1]) {
      expect(courierDailyPay(20, DAILY_ACTIVITY_MULTIPLIER, friction)).toBeLessThanOrEqual(ceiling + 1e-12);
    }
  });

  it('defaults to COURIER_FEE_PER_DISTANCE_UNIT when no rate is passed', () => {
    expect(courierDailyPay(20, 1, 1)).toBeCloseTo(20 * COURIER_FEE_PER_DISTANCE_UNIT, 10);
  });
});

describe('Courier pay wired into the world kernel — real distance variance, not a flat wage', () => {
  it('two couriers in different districts earn different amounts on the same day', () => {
    let world = createWorld(1, DEFAULT_WORLD_CONFIG);
    world = stepWorld(world);
    const filled = world.couriers.filter((c) => c.slot.state === 'FILLED');
    const distinctWealths = new Set(filled.map((c) => c.wealth));
    // Not every seed is guaranteed to place couriers in districts with different distances,
    // but the shipped default (2 core + 4 periphery, rCourier=5) reliably does — this is the
    // real, measured behaviour the flat SUPPORT_ROLE_DAILY_WAGE could never produce.
    expect(distinctWealths.size).toBeGreaterThan(1);
  });

  it('mean courier earnings at the shipped default stay in the same order of magnitude as the wage they replaced', () => {
    // Not exact parity (that's not the point of introducing real variance), but the constant
    // was chosen so the average doesn't drift wildly from what SUPPORT_ROLE_DAILY_WAGE paid,
    // per courierPay.ts's own calibration note. A regression here means the constant moved
    // without re-measuring against this precedent.
    const flatBaseline = SUPPORT_ROLE_DAILY_WAGE * DAILY_ACTIVITY_MULTIPLIER;
    for (const seed of [1, 2, 3]) {
      let world = createWorld(seed, DEFAULT_WORLD_CONFIG);
      world = stepWorld(world);
      const filled = world.couriers.filter((c) => c.slot.state === 'FILLED');
      const mean = filled.reduce((s, c) => s + c.wealth, 0) / filled.length;
      expect(mean).toBeGreaterThan(flatBaseline * 0.2);
      expect(mean).toBeLessThan(flatBaseline * 3);
    }
  });

  it('never pays a FILLED courier a negative or non-finite amount, across a long run', () => {
    let world = createWorld(4, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 500; i++) {
      world = stepWorld(world);
      for (const c of world.couriers) {
        if (c.slot.state === 'FILLED') {
          expect(Number.isFinite(c.wealth)).toBe(true);
          expect(c.wealth).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
