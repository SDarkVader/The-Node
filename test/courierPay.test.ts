import { describe, expect, it } from 'vitest';
import { courierRouteDistance, courierDailyPay, COURIER_FEE_PER_DISTANCE_UNIT, COURIER_MIN_ROUTE_DISTANCE } from '../src/engine/courierPay.js';
import { generateShardLayout, DEFAULT_SHARD_CONFIG, distance, type ShardLayoutConfig } from '../src/engine/space.js';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type WorldConfig } from '../src/world/world.js';
import { SUPPORT_ROLE_DAILY_WAGE, DAILY_ACTIVITY_MULTIPLIER } from '../src/engine/wealth.js';

/**
 * Regression tests for Courier pay (2026-08-11 addendum item 6, "distance-indexed,
 * commissioner-funded") — verified in isolation per CLAUDE.md constraint 1, same pattern
 * every other `src/engine/` module's test file uses.
 */

// The shipped DEFAULT_SHARD_CONFIG became a single district 2026-08-13 (real per-district
// population data showed no tradeoff — see space.ts's own header). Distance-variance across
// districts is still real, still-shipped `courierPay.ts` behavior whenever a shard DOES have
// more than one district (e.g. the not-yet-built cascading district-opening feature) — these
// tests verify that with an explicit multi-district config rather than assuming the shipped
// default has one, so they stay meaningful regardless of what ships today.
const MULTI_DISTRICT_TEST_CONFIG: ShardLayoutConfig = {
  ...DEFAULT_SHARD_CONFIG,
  coreDistrictCount: 2,
  peripheryDistrictCount: 4,
  buildingsPerCoreDistrict: 15,
  buildingsPerPeripheryDistrict: 8,
};
const MULTI_DISTRICT_WORLD_CONFIG: WorldConfig = { ...DEFAULT_WORLD_CONFIG, shardConfig: MULTI_DISTRICT_TEST_CONFIG };

describe('courierRouteDistance — station level (2026-08-19)', () => {
  it("matches the real Manhattan distance from the courier's own station to the hub", () => {
    const shard = generateShardLayout(1, DEFAULT_SHARD_CONFIG);
    const b = shard.districts[0]!.buildings.find((x) => distance(x, shard.hubPlot) > 1)!;
    expect(courierRouteDistance(b, shard.hubPlot)).toBe(distance(b, shard.hubPlot));
  });

  it('never bills below COURIER_MIN_ROUTE_DISTANCE — constraint 2, no permanent zero-state', () => {
    // A station ON the hub would otherwise earn exactly nothing forever with no action
    // available to change it. Measured: 1 of 496 generated buildings across 8 seeds lands
    // exactly on centre once the district is centred, so this is a real reachable state,
    // not a defensive hypothetical.
    const hub = { x: 0, y: 0 };
    expect(courierRouteDistance({ x: 0, y: 0 }, hub)).toBe(COURIER_MIN_ROUTE_DISTANCE);
    expect(courierDailyPay(courierRouteDistance({ x: 0, y: 0 }, hub), 1, 1)).toBeGreaterThan(0);
  });

  it('real courier stations inside ONE district still vary in distance — the whole point', () => {
    // This is what makes a "distance-indexed" wage index anything at all under the shipped
    // single-district config. Before 2026-08-19 every courier shared one plaza and so earned
    // an identical amount, which is exactly the bug this replaced.
    const world = createWorld(1, DEFAULT_WORLD_CONFIG);
    const byId = new Map(world.shard.districts.flatMap((d) => d.buildings).map((b) => [b.id, b]));
    const dists = world.couriers.map((c) => courierRouteDistance(byId.get(c.buildingId)!, world.shard.hubPlot));
    expect(new Set(dists).size).toBeGreaterThan(1);
  });

  it('periphery stations sit meaningfully further from the hub than core ones', () => {
    // Real, measured geometry, not asserted in the abstract. Multi-district still exists as a
    // config (cascading district-opening is unbuilt but real), so this stays meaningful.
    const shard = generateShardLayout(1, MULTI_DISTRICT_TEST_CONFIG);
    const meanFor = (classification: string) => {
      const bs = shard.districts.filter((d) => d.classification === classification).flatMap((d) => d.buildings);
      return bs.reduce((s, b) => s + courierRouteDistance(b, shard.hubPlot), 0) / bs.length;
    };
    expect(meanFor('periphery')).toBeGreaterThan(meanFor('core') * 2);
  });
});

describe('the Wall sits in the middle of the town (2026-08-19 fix)', () => {
  it('the single shipped district is centred on the hub, with buildings on both sides of it', () => {
    // The bug this replaced: hub 6.5-10.5 units off the district centre, and ZERO of ~62
    // buildings west of it, in every seed. Both halves are checked, because "centred" that
    // still leaves every building on one side would not actually be fixed.
    for (const seed of [1, 2, 3, 4, 5]) {
      const shard = generateShardLayout(seed, DEFAULT_SHARD_CONFIG);
      const d = shard.districts[0]!;
      const cx = d.plots.reduce((a, p) => a + p.x, 0) / d.plots.length;
      const cy = d.plots.reduce((a, p) => a + p.y, 0) / d.plots.length;
      expect(Math.abs(cx - shard.hubPlot.x) + Math.abs(cy - shard.hubPlot.y)).toBeLessThan(2);

      const west = d.buildings.filter((b) => b.x < shard.hubPlot.x).length;
      expect(west).toBeGreaterThan(0);
      expect(west).toBeLessThan(d.buildings.length);
    }
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
    let world = createWorld(1, MULTI_DISTRICT_WORLD_CONFIG);
    world = stepWorld(world);
    const filled = world.couriers.filter((c) => c.slot.state === 'FILLED');
    const distinctWealths = new Set(filled.map((c) => c.wealth));
    // Not every seed is guaranteed to place couriers in districts with different distances,
    // but a multi-district shard (2 core + 4 periphery, rCourier=7) reliably does — this is
    // the real, measured behaviour the flat SUPPORT_ROLE_DAILY_WAGE could never produce. The
    // shipped default is a single district as of 2026-08-13 (space.ts's own header) so this
    // now uses an explicit multi-district config rather than assuming the default has one.
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

  it('couriers earn PARITY with their flat-wage support peers, not ~40% of them (2026-08-19)', () => {
    // The bug this locks out: from 2026-08-13 (single district) to 2026-08-19, every courier
    // shared one plaza, so `COURIER_FEE_PER_DISTANCE_UNIT` — calibrated in 2026-08-11's
    // 6-district layout against ~20-unit routes — was being applied to 8-9 unit routes.
    // Couriers earned 0.42-0.47/day against their peers' 1.05, in every single run, and no
    // test compared the two roles so nothing caught it. This one does exactly that.
    const courierGains: number[] = [];
    const peerGains: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const before = createWorld(seed, DEFAULT_WORLD_CONFIG);
      const after = stepWorld(before);
      after.couriers.forEach((c, i) => {
        if (c.slot.state === 'FILLED') courierGains.push(c.wealth - before.couriers[i]!.wealth);
      });
      after.investigators.forEach((inv, i) => {
        if (inv.slot.state === 'FILLED') peerGains.push(inv.wealth - before.investigators[i]!.wealth);
      });
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const ratio = mean(courierGains) / mean(peerGains);
    // Measured at 1.028 when this landed. A band, not a point: the whole design intent is
    // that couriers VARY around their peers' flat wage rather than matching it exactly.
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.3);
  });

  it('station-level pay produces real spread — an edge courier out-earns one beside the Wall', () => {
    // Parity on the mean is only half the fix; if every courier still earned the same amount
    // the mechanic would be a flat wage wearing a distance-shaped hat.
    const before = createWorld(3, DEFAULT_WORLD_CONFIG);
    const after = stepWorld(before);
    const gains = after.couriers
      .map((c, i) => (c.slot.state === 'FILLED' ? c.wealth - before.couriers[i]!.wealth : null))
      .filter((v): v is number => v !== null);
    expect(Math.max(...gains) / Math.min(...gains)).toBeGreaterThan(1.5);
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
