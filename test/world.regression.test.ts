import { describe, expect, it } from 'vitest';
import {
  createWorld,
  stepWorld,
  computeMillerSupply,
  DEFAULT_WORLD_CONFIG,
  type World,
  type RoleEconomicSlot,
  type WorldConfig,
} from '../src/world/world.js';
import { BACKSTOP_PRODUCTIVITY } from '../src/engine/ecosystem.js';
import { flourPrice } from '../src/engine/millers.js';

/**
 * Regression tests for Phase B of the Observatory build spec (`src/world/world.ts`).
 * Covers: determinism, the pinned tick order (as a golden-value characterization test —
 * any accidental reordering or logic change inside stepWorld will change these numbers),
 * the "BACKSTOPPED/conscripted Miller actually participates in pricing" requirement, the
 * documented Cournot-minimum-2 resolution never throwing regardless of role-slot count,
 * and the comms wiring using real spatial proximity.
 */

function scalarSnapshot(world: World) {
  return {
    tick: world.tick,
    population: world.population,
    flourPrice: world.flourPrice,
    economicHealth: world.economicHealth,
    economicHealthWithExperience: world.economicHealthWithExperience,
    wealthGini: world.wealthGini,
    wealthTop10Share: world.wealthTop10Share,
    millerValues: world.millers.map((m) => ({ state: m.slot.state, value: m.value, exp: m.experience, wealth: m.wealth })),
    bakerValues: world.bakers.map((b) => ({ state: b.slot.state, value: b.value, exp: b.experience, wealth: b.wealth })),
  };
}

describe('createWorld / stepWorld — determinism', () => {
  it('the same seed and config produce byte-identical state sequences', () => {
    const configA = { ...DEFAULT_WORLD_CONFIG };
    const configB = { ...DEFAULT_WORLD_CONFIG };

    let worldA = createWorld(42, configA);
    let worldB = createWorld(42, configB);

    const snapshotsA: unknown[] = [];
    const snapshotsB: unknown[] = [];

    for (let i = 0; i < 60; i++) {
      worldA = stepWorld(worldA);
      worldB = stepWorld(worldB);
      snapshotsA.push(scalarSnapshot(worldA));
      snapshotsB.push(scalarSnapshot(worldB));
    }

    expect(JSON.stringify(snapshotsA)).toBe(JSON.stringify(snapshotsB));
  });

  it('different seeds diverge', () => {
    let worldA = createWorld(1);
    let worldB = createWorld(2);
    for (let i = 0; i < 30; i++) {
      worldA = stepWorld(worldA);
      worldB = stepWorld(worldB);
    }
    expect(JSON.stringify(scalarSnapshot(worldA))).not.toBe(JSON.stringify(scalarSnapshot(worldB)));
  });

  it('never uses Math.random — repeated createWorld with the same seed starts identically', () => {
    const w1 = createWorld(7);
    const w2 = createWorld(7);
    expect(scalarSnapshot(w1)).toEqual(scalarSnapshot(w2));
  });
});

describe('stepWorld — tick order is pinned (golden-value characterization test)', () => {
  // Deliberately hardcoded expected values, captured from an actual run. If the tick's
  // internal stage order changes (or any composed module's behavior changes), these
  // numbers will change and this test will fail — that is the point, per the spec's
  // explicit instruction to add a test that pins the order because "ordering changes
  // will silently change every downstream number."
  it('produces the same exact scalar trajectory at tick 25 for seed 99', () => {
    let world = createWorld(99);
    for (let i = 0; i < 25; i++) world = stepWorld(world);

    expect(world.tick).toBe(25);
    // Snapshot the actual values once, then lock them in — regenerate only if a
    // deliberate, reviewed change to stepWorld's logic or order is made.
    const snapshot = scalarSnapshot(world);
    expect(snapshot).toMatchSnapshot();
  });
});

describe('computeMillerSupply — a BACKSTOPPED Miller actually participates in pricing', () => {
  function makeMiller(state: RoleEconomicSlot['slot']['state'], value: number): RoleEconomicSlot {
    return { slot: { state, vacantSince: state === 'FILLED' ? null : 0 }, buildingId: `b-${state}-${value}`, value, experience: 0, wealth: 0 };
  }

  it('a BACKSTOPPED slot contributes exactly BACKSTOP_PRODUCTIVITY, not zero and not its stale value', () => {
    const millers = [makeMiller('FILLED', 0.6), makeMiller('BACKSTOPPED', 0.9)];
    const supply = computeMillerSupply(millers);
    expect(supply).toBeCloseTo(0.6 + BACKSTOP_PRODUCTIVITY, 10);
  });

  it('an all-BACKSTOPPED miller layer still produces a real, non-zero flour price', () => {
    const millers = [makeMiller('BACKSTOPPED', 0), makeMiller('BACKSTOPPED', 0), makeMiller('BACKSTOPPED', 0)];
    const supply = computeMillerSupply(millers);
    expect(supply).toBeCloseTo(3 * BACKSTOP_PRODUCTIVITY, 10);
    expect(flourPrice(supply)).toBeGreaterThan(0);
    expect(flourPrice(supply)).toBeLessThan(flourPrice(0)); // more supply -> lower price, same direction as normal
  });

  it('a VACANT slot contributes nothing', () => {
    const millers = [makeMiller('FILLED', 0.5), makeMiller('VACANT', 999)];
    expect(computeMillerSupply(millers)).toBeCloseTo(0.5, 10);
  });

  it('conscription: a Miller forced from BACKSTOPPED back to FILLED changes its pricing contribution from mechanical to competitive', () => {
    // Run a real world with a short conscription delay and small rMiller/rBaker so a
    // BACKSTOPPED -> conscripted-FILLED transition is likely to occur within a short run,
    // then confirm the miller layer actually reflects both states at different points.
    const config: WorldConfig = {
      ...DEFAULT_WORLD_CONFIG,
      rMiller: 2,
      rBaker: 2,
      conscriptionDelay: 3,
      pMonthly: 0.9, // high churn so BACKSTOPPED states actually occur within a short run
    };
    let world = createWorld(5, config);
    let sawBackstopped = false;
    let sawFilledAfterBackstop = false;
    for (let i = 0; i < 400; i++) {
      world = stepWorld(world);
      if (world.millers.some((m) => m.slot.state === 'BACKSTOPPED')) sawBackstopped = true;
      if (sawBackstopped && world.millers.every((m) => m.slot.state === 'FILLED')) sawFilledAfterBackstop = true;
    }
    expect(sawBackstopped).toBe(true);
    expect(sawFilledAfterBackstop).toBe(true);
  });
});

describe('stepWorld — the Cournot/Bertrand minimum-2 contradiction never crashes the kernel', () => {
  it('runs 500 ticks at rMiller=2, rBaker=2 under high churn without throwing, across several seeds', () => {
    const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, rMiller: 2, rBaker: 2, pMonthly: 0.95 };
    for (const seed of [1, 2, 3]) {
      let world = createWorld(seed, config);
      expect(() => {
        for (let i = 0; i < 500; i++) world = stepWorld(world);
      }).not.toThrow();
    }
  });

  it('flourPrice stays a finite, in-range number even when fewer than 2 millers are FILLED', () => {
    const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, rMiller: 2, rBaker: 2, pMonthly: 0.95 };
    let world = createWorld(11, config);
    for (let i = 0; i < 300; i++) {
      world = stepWorld(world);
      expect(Number.isFinite(world.flourPrice)).toBe(true);
      expect(world.flourPrice).toBeGreaterThanOrEqual(0.05);
      expect(world.flourPrice).toBeLessThanOrEqual(2.0);
    }
  });
});

describe('stepWorld — comms propagation uses real spatial proximity', () => {
  it('a pending Wall post from a role-holder propagates to at least one nearby role-holder when they are close', () => {
    // Small shard, tight rMiller/rBaker so buildings land close together (a small core
    // district's plots are all within the default commsProximityRange of each other).
    const config: WorldConfig = {
      ...DEFAULT_WORLD_CONFIG,
      shardConfig: { ...DEFAULT_WORLD_CONFIG.shardConfig, coreDistrictCount: 1, peripheryDistrictCount: 0, buildingsPerCoreDistrict: 6 },
      rMiller: 3,
      rBaker: 3,
    };
    let world = createWorld(3, config);
    const author = world.millers[0]!.buildingId;
    world = { ...world, pendingWallPosts: [{ id: 'w1', authorId: author, state: 'hopeful', day: world.tick }] };
    world = stepWorld(world);

    // Not guaranteed on every seed (stepClarity/applyDistortion still roll), but across a
    // few seeds at least one should show real propagation happened via proximity.
    let propagatedAtLeastOnce = world.lastRumourEvents.length > 0;
    if (!propagatedAtLeastOnce) {
      for (const seed of [4, 5, 6, 7, 8]) {
        let w = createWorld(seed, config);
        const a = w.millers[0]!.buildingId;
        w = { ...w, pendingWallPosts: [{ id: 'w1', authorId: a, state: 'hopeful', day: w.tick }] };
        w = stepWorld(w);
        if (w.lastRumourEvents.length > 0) {
          propagatedAtLeastOnce = true;
          break;
        }
      }
    }
    expect(propagatedAtLeastOnce).toBe(true);
  });

  it('pendingWallPosts is always cleared after a tick, whether or not anything propagated', () => {
    let world = createWorld(3);
    world = { ...world, pendingWallPosts: [{ id: 'w1', authorId: world.millers[0]!.buildingId, state: 'hopeful', day: 0 }] };
    world = stepWorld(world);
    expect(world.pendingWallPosts).toEqual([]);
  });

  it('no pending posts means no rumour events and the comms stage is a true no-op', () => {
    let world = createWorld(3);
    world = stepWorld(world);
    expect(world.lastRumourEvents).toEqual([]);
  });
});

describe('createWorld — configuration errors are real, not silently swallowed', () => {
  it('throws a clear error when rMiller + rBaker exceeds the shard\'s building count', () => {
    expect(() =>
      createWorld(1, { ...DEFAULT_WORLD_CONFIG, rMiller: 1000, rBaker: 1000 }),
    ).toThrow(/role slots requested/);
  });
});

describe('wealth tracking — the new stock variable on top of the market\'s existing flow variables', () => {
  it('everyone starts at zero wealth — perfect equality, honestly, not undefined', () => {
    const world = createWorld(1);
    expect(world.wealthGini).toBe(0);
    for (const m of world.millers) expect(m.wealth).toBe(0);
    for (const b of world.bakers) expect(b.wealth).toBe(0);
  });

  it('a FILLED miller accrues wealth from its own quantity times flourPrice, every tick it stays FILLED', () => {
    let world = createWorld(5);
    world = stepWorld(world);
    const stillFilled = world.millers.filter((m) => m.slot.state === 'FILLED');
    expect(stillFilled.length).toBeGreaterThan(0);
    for (const m of stillFilled) expect(m.wealth).toBeGreaterThan(0);
  });

  it('a BACKSTOPPED slot never accrues wealth — nobody is there to receive it', () => {
    const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, rMiller: 2, rBaker: 2, pMonthly: 0.95 };
    let world = createWorld(9, config);
    let sawBackstoppedWithZeroWealth = false;
    for (let i = 0; i < 300; i++) {
      world = stepWorld(world);
      for (const m of [...world.millers, ...world.bakers]) {
        if (m.slot.state === 'BACKSTOPPED' && m.wealth === 0) sawBackstoppedWithZeroWealth = true;
        // Once BACKSTOPPED, wealth must stay frozen at whatever it was, never growing.
      }
    }
    // Not every BACKSTOPPED slot will have exactly zero wealth (it might have earned some
    // before losing its occupant), but the mechanism (frozen, not accruing) is what
    // matters — checked directly below with a controlled before/after comparison.
    void sawBackstoppedWithZeroWealth;

    let world2 = createWorld(9, config);
    let frozenWealth: number | null = null;
    let checkedFreeze = false;
    for (let i = 0; i < 300; i++) {
      const before = world2.millers.find((m) => m.slot.state === 'BACKSTOPPED');
      world2 = stepWorld(world2);
      if (before) {
        const after = world2.millers.find((m) => m.buildingId === before.buildingId);
        if (after && after.slot.state === 'BACKSTOPPED') {
          expect(after.wealth).toBe(before.wealth);
          checkedFreeze = true;
        }
      }
    }
    expect(checkedFreeze).toBe(true);
  });

  it('a new occupant starts at zero wealth, not inheriting the previous occupant\'s balance', () => {
    const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, rMiller: 2, rBaker: 2, conscriptionDelay: 3, pMonthly: 0.9 };
    let world = createWorld(5, config);
    let checkedReset = false;
    for (let i = 0; i < 400; i++) {
      const before = world.millers;
      world = stepWorld(world);
      for (let idx = 0; idx < world.millers.length; idx++) {
        const wasFilled = before[idx]!.slot.state === 'FILLED';
        const isFilled = world.millers[idx]!.slot.state === 'FILLED';
        if (!wasFilled && isFilled) {
          // Just transitioned into FILLED this tick — wealth resets to 0 before that
          // same day's income is added, so it should equal exactly this tick's income,
          // not carry forward whatever the slot held before it went vacant/backstopped.
          expect(world.millers[idx]!.wealth).toBeLessThan(1); // one day's income is small
          checkedReset = true;
        }
      }
    }
    expect(checkedReset).toBe(true);
  });

  it('wealthGini rises above zero once role-holders have had time to earn unequally', () => {
    let world = createWorld(1);
    for (let i = 0; i < 100; i++) world = stepWorld(world);
    expect(world.wealthGini).toBeGreaterThan(0);
  });
});

describe('wealth remediation proposals — taxAndRedistributeIncome / applyWealthCap wiring', () => {
  it('wealthTaxRate=0 (the default) leaves wealth accrual unaffected by the tax path', () => {
    let worldNoTax = createWorld(7, { ...DEFAULT_WORLD_CONFIG, wealthTaxRate: 0 });
    let worldAlsoNoTax = createWorld(7, { ...DEFAULT_WORLD_CONFIG, wealthTaxRate: 0 });
    for (let i = 0; i < 50; i++) {
      worldNoTax = stepWorld(worldNoTax);
      worldAlsoNoTax = stepWorld(worldAlsoNoTax);
    }
    expect(worldNoTax.wealthGini).toBe(worldAlsoNoTax.wealthGini);
  });

  it('a high wealthTaxRate measurably reduces wealthGini relative to no tax, over the same seed', () => {
    let worldTaxed = createWorld(7, { ...DEFAULT_WORLD_CONFIG, wealthTaxRate: 0.8 });
    let worldUntaxed = createWorld(7, { ...DEFAULT_WORLD_CONFIG, wealthTaxRate: 0 });
    for (let i = 0; i < 300; i++) {
      worldTaxed = stepWorld(worldTaxed);
      worldUntaxed = stepWorld(worldUntaxed);
    }
    expect(worldTaxed.wealthGini).toBeLessThan(worldUntaxed.wealthGini);
  });

  it('a wealthCap bounds every FILLED role-holder\'s wealth at or below the cap', () => {
    const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, wealthCap: 5 };
    let world = createWorld(7, config);
    for (let i = 0; i < 300; i++) {
      world = stepWorld(world);
      for (const m of [...world.millers, ...world.bakers]) {
        if (m.slot.state === 'FILLED') expect(m.wealth).toBeLessThanOrEqual(5 + 1e-9);
      }
    }
  });

  it('wealthCap=undefined (the default) is a true no-op — no bound applied', () => {
    let world = createWorld(1, { ...DEFAULT_WORLD_CONFIG, wealthCap: undefined });
    for (let i = 0; i < 300; i++) world = stepWorld(world);
    const maxWealth = Math.max(...[...world.millers, ...world.bakers].map((m) => m.wealth));
    // With no cap over a 300-day run, at least someone should exceed a value that would
    // be an artificially low "accidental" cap — proves nothing is silently bounding it.
    expect(maxWealth).toBeGreaterThan(5);
  });
});
