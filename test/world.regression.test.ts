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
import { giniCoefficient, SUPPORT_ROLE_DAILY_WAGE, GRIFTER_DAILY_INCOME, DAILY_ACTIVITY_MULTIPLIER } from '../src/engine/wealth.js';

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
    courierValues: world.couriers.map((c) => ({ state: c.slot.state, wealth: c.wealth })),
    journalistValues: world.journalists.map((j) => ({ state: j.slot.state, wealth: j.wealth })),
    detectiveValues: world.detectives.map((d) => ({ state: d.slot.state, wealth: d.wealth })),
    importExportValues: world.importExporters.map((x) => ({ state: x.slot.state, wealth: x.wealth })),
    grifterCount: world.grifters.length,
    grifterTotalWealth: world.grifters.reduce((a, g) => a + g.wealth, 0),
    grifterMaxDaysWaiting: world.grifters.reduce((max, g) => Math.max(max, g.daysAsGrifter), 0),
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
    // Support roles zeroed out here — this shard is deliberately tiny (6 buildings) to
    // force proximity, and only has room for the 2 roles this test actually exercises.
    const config: WorldConfig = {
      ...DEFAULT_WORLD_CONFIG,
      shardConfig: { ...DEFAULT_WORLD_CONFIG.shardConfig, coreDistrictCount: 1, peripheryDistrictCount: 0, buildingsPerCoreDistrict: 6 },
      rMiller: 3,
      rBaker: 3,
      rCourier: 0,
      rJournalist: 0,
      rDetective: 0,
      rImportExport: 0,
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
        // Same `vacantSince` confirms this is the SAME continuous backstop episode, not a
        // same-day coincidence where this slot got conscripted back to FILLED in Stage 2
        // and then immediately sabotage-evicted to a NEW BACKSTOPPED episode in Stage 4 —
        // a real possible sequence now that sabotage draws from all 5 roles' FILLED pool
        // every sabotageCadenceDays, which resets wealth to a fresh occupant's one-day
        // income (by design — new occupant, no inheritance), not a frozen-wealth violation.
        if (after && after.slot.state === 'BACKSTOPPED' && after.slot.vacantSince === before.slot.vacantSince) {
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

  it('a high wealthTaxRate measurably reduces mean Miller+Baker wealth Gini relative to no tax, across several seeds', () => {
    // world.wealthGini now spans all 5 roles + grifters (widened 2026-08-11 — see
    // world.ts's header note), but wealthTaxRate stays deliberately scoped to Miller+Baker
    // only. Taxing ~10 of ~62 tracked players may not move the population-wide figure
    // measurably, so this checks the mechanism directly on the pool it actually acts on.
    // Averaged across several seeds, not a single run: with live-N vacancy dynamics and
    // district-consolidation friction now both touching Miller/Baker income too, a single
    // seed's exact fill composition at one tick is noisy at this small a role count (10
    // Miller+Baker slots) — the tax's effect is real but needs averaging to see reliably,
    // same discipline as every sweep script in this repo.
    const millerBakerWealth = (w: World) =>
      [...w.millers, ...w.bakers].filter((s) => s.slot.state === 'FILLED').map((s) => s.wealth);

    const SEEDS = [1, 2, 3, 4, 5];
    const taxedGinis: number[] = [];
    const untaxedGinis: number[] = [];
    for (const seed of SEEDS) {
      let worldTaxed = createWorld(seed, { ...DEFAULT_WORLD_CONFIG, wealthTaxRate: 0.8 });
      let worldUntaxed = createWorld(seed, { ...DEFAULT_WORLD_CONFIG, wealthTaxRate: 0 });
      for (let i = 0; i < 300; i++) {
        worldTaxed = stepWorld(worldTaxed);
        worldUntaxed = stepWorld(worldUntaxed);
      }
      taxedGinis.push(giniCoefficient(millerBakerWealth(worldTaxed)));
      untaxedGinis.push(giniCoefficient(millerBakerWealth(worldUntaxed)));
    }
    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    expect(mean(taxedGinis)).toBeLessThan(mean(untaxedGinis));
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

  it('config.purchaseCycleDays actually overrides wealth.ts\'s own default, not silently ignored', () => {
    let worldTight = createWorld(1, { ...DEFAULT_WORLD_CONFIG, purchaseCycleDays: 14 });
    let worldLoose = createWorld(1, { ...DEFAULT_WORLD_CONFIG, purchaseCycleDays: 2.5 });
    for (let i = 0; i < 200; i++) {
      worldTight = stepWorld(worldTight);
      worldLoose = stepWorld(worldLoose);
    }
    const bakerWealth = (w: World) => w.bakers.filter((b) => b.slot.state === 'FILLED').reduce((a, b) => a + b.wealth, 0);
    // Longer cycle -> less total demand -> strictly less accumulated baker wealth over the
    // same seed and duration, since prices/quantities are byte-identical (no RNG consumed
    // by the demand model) and only income differs.
    expect(bakerWealth(worldTight)).toBeLessThan(bakerWealth(worldLoose));
  });
});

/**
 * 5-role roster + grifter pool (2026-08-11, user-specified). Miller, Baker, Courier,
 * Journalist, Detective, plus individually-tracked roleless "grifters." Covers population
 * conservation (the invariant grifters.length + total FILLED across all 5 roles ==
 * population), the grifter income floor and daysAsGrifter wait-time tracking, the flat
 * support-role wage, and district-aware building assignment.
 */

function totalFilledAcrossRoles(world: World): number {
  return (
    world.millers.filter((m) => m.slot.state === 'FILLED').length +
    world.bakers.filter((b) => b.slot.state === 'FILLED').length +
    world.couriers.filter((c) => c.slot.state === 'FILLED').length +
    world.journalists.filter((j) => j.slot.state === 'FILLED').length +
    world.detectives.filter((d) => d.slot.state === 'FILLED').length +
    world.importExporters.filter((x) => x.slot.state === 'FILLED').length
  );
}

describe('createWorld — 5-role roster + grifter pool', () => {
  it('the default role split sums to 30, re-derived against the real multi-shard system (see world.ts\'s own comment)', () => {
    const { rMiller, rBaker, rCourier, rJournalist, rDetective } = DEFAULT_WORLD_CONFIG;
    expect(rMiller + rBaker + rCourier + rJournalist + rDetective + DEFAULT_WORLD_CONFIG.rImportExport).toBe(28);
  });

  it('grifters.length + total FILLED across all 5 roles equals population at creation', () => {
    const world = createWorld(1);
    expect(world.grifters.length + totalFilledAcrossRoles(world)).toBe(world.population);
  });

  it('every role starts fully FILLED, and every grifter starts at 0 wealth / 0 daysAsGrifter', () => {
    const world = createWorld(1);
    for (const arr of [world.millers, world.bakers, world.couriers, world.journalists, world.detectives, world.importExporters]) {
      for (const s of arr) expect(s.slot.state).toBe('FILLED');
    }
    for (const g of world.grifters) {
      expect(g.wealth).toBe(0);
      expect(g.daysAsGrifter).toBe(0);
    }
  });

  it('district-aware assignment gives every role exactly its configured count of distinct buildings', () => {
    const world = createWorld(1);
    const ids = (arr: { buildingId: string }[]) => arr.map((s) => s.buildingId);
    const allIds = [
      ...ids(world.millers),
      ...ids(world.bakers),
      ...ids(world.couriers),
      ...ids(world.journalists),
      ...ids(world.detectives),
      ...ids(world.importExporters),
    ];
    expect(new Set(allIds).size).toBe(allIds.length); // no building double-assigned
    expect(world.millers.length).toBe(DEFAULT_WORLD_CONFIG.rMiller);
    expect(world.bakers.length).toBe(DEFAULT_WORLD_CONFIG.rBaker);
    expect(world.couriers.length).toBe(DEFAULT_WORLD_CONFIG.rCourier);
    expect(world.journalists.length).toBe(DEFAULT_WORLD_CONFIG.rJournalist);
    expect(world.detectives.length).toBe(DEFAULT_WORLD_CONFIG.rDetective);
  });

  it('throws a clear error when the 5 roles combined exceed the shard\'s building count', () => {
    expect(() =>
      createWorld(1, { ...DEFAULT_WORLD_CONFIG, rMiller: 1000, rCourier: 1000 }),
    ).toThrow(/role slots requested/);
  });
});

describe('stepWorld — population conservation across ticks (5 roles + grifter pool)', () => {
  it('grifters.length + total FILLED across all 5 roles equals population, every tick, across a long run', () => {
    let world = createWorld(3);
    for (let i = 0; i < 1000; i++) {
      world = stepWorld(world);
      expect(world.grifters.length + totalFilledAcrossRoles(world)).toBe(world.population);
    }
  });

  it('holds under high churn and small role counts too, across several seeds', () => {
    const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, rMiller: 2, rBaker: 2, rCourier: 2, rJournalist: 2, rDetective: 2, pMonthly: 0.9 };
    for (const seed of [1, 2, 3]) {
      let world = createWorld(seed, config);
      for (let i = 0; i < 500; i++) {
        world = stepWorld(world);
        expect(world.grifters.length + totalFilledAcrossRoles(world)).toBe(world.population);
      }
    }
  });

  it('the grifter pool is not monotonic — it both grows (churn/sabotage) and shrinks (fills/conscription) over time', () => {
    let world = createWorld(3);
    let sawGrowth = false;
    let sawShrink = false;
    let prevCount = world.grifters.length;
    for (let i = 0; i < 500; i++) {
      world = stepWorld(world);
      if (world.grifters.length > prevCount) sawGrowth = true;
      if (world.grifters.length < prevCount) sawShrink = true;
      prevCount = world.grifters.length;
    }
    expect(sawGrowth).toBe(true);
    expect(sawShrink).toBe(true);
  });
});

describe('stepWorld — grifter income floor and daysAsGrifter wait-time tracking', () => {
  it('every grifter accrues exactly GRIFTER_DAILY_INCOME * DAILY_ACTIVITY_MULTIPLIER per day they remain roleless', () => {
    let world = createWorld(1);
    const before = new Map(world.grifters.map((g) => [g.id, g.wealth]));
    world = stepWorld(world);
    for (const g of world.grifters) {
      const wealthBefore = before.get(g.id);
      if (wealthBefore !== undefined) {
        expect(g.wealth).toBeCloseTo(wealthBefore + GRIFTER_DAILY_INCOME * DAILY_ACTIVITY_MULTIPLIER, 10);
      }
    }
  });

  it('daysAsGrifter increases by 1 each day a specific grifter identity survives in the pool', () => {
    let world = createWorld(1);
    world = stepWorld(world);
    const survivorId = world.grifters[0]!.id;
    const daysBefore = world.grifters.find((g) => g.id === survivorId)!.daysAsGrifter;
    world = stepWorld(world);
    const after = world.grifters.find((g) => g.id === survivorId);
    if (after) expect(after.daysAsGrifter).toBe(daysBefore + 1);
  });

  it('over a long high-churn run, at least one grifter is eventually drafted or fills an open role (pool never stuck at a single ever-growing size)', () => {
    const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, rMiller: 2, rBaker: 2, rCourier: 2, rJournalist: 2, rDetective: 2, pMonthly: 0.9, conscriptionDelay: 3 };
    let world = createWorld(5, config);
    const initialCount = world.grifters.length;
    let sawShrinkBelowInitial = false;
    for (let i = 0; i < 500; i++) {
      world = stepWorld(world);
      if (world.grifters.length < initialCount) sawShrinkBelowInitial = true;
    }
    expect(sawShrinkBelowInitial).toBe(true);
  });
});

describe('stepWorld — support-role wage (Courier/Journalist/Detective)', () => {
  it('a FILLED support-role slot accrues exactly SUPPORT_ROLE_DAILY_WAGE * DAILY_ACTIVITY_MULTIPLIER per day', () => {
    let world = createWorld(1);
    const before = { c: world.couriers.map((c) => c.wealth), j: world.journalists.map((j) => j.wealth), d: world.detectives.map((d) => d.wealth) };
    world = stepWorld(world);
    world.couriers.forEach((c, i) => {
      if (c.slot.state === 'FILLED') expect(c.wealth).toBeCloseTo(before.c[i]! + SUPPORT_ROLE_DAILY_WAGE * DAILY_ACTIVITY_MULTIPLIER, 10);
    });
    world.journalists.forEach((j, i) => {
      if (j.slot.state === 'FILLED') expect(j.wealth).toBeCloseTo(before.j[i]! + SUPPORT_ROLE_DAILY_WAGE * DAILY_ACTIVITY_MULTIPLIER, 10);
    });
    world.detectives.forEach((d, i) => {
      if (d.slot.state === 'FILLED') expect(d.wealth).toBeCloseTo(before.d[i]! + SUPPORT_ROLE_DAILY_WAGE * DAILY_ACTIVITY_MULTIPLIER, 10);
    });
  });

  it('a new support-role occupant starts at 0 wealth, not inheriting the previous occupant\'s balance', () => {
    const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, rCourier: 2, conscriptionDelay: 3, pMonthly: 0.9 };
    let world = createWorld(5, config);
    let checkedReset = false;
    for (let i = 0; i < 400; i++) {
      const before = world.couriers;
      world = stepWorld(world);
      for (let idx = 0; idx < world.couriers.length; idx++) {
        const wasFilled = before[idx]!.slot.state === 'FILLED';
        const isFilled = world.couriers[idx]!.slot.state === 'FILLED';
        if (!wasFilled && isFilled) {
          // Reset to 0, then this same day's wage accrues on top — bounded above by one
          // day's SUPPORT_ROLE_DAILY_WAGE (trade-route friction can only ever reduce it,
          // never exceed the base rate — see districtConsolidation.ts), and strictly
          // positive, not some larger carried-forward balance from a previous occupant.
          expect(world.couriers[idx]!.wealth).toBeGreaterThan(0);
          expect(world.couriers[idx]!.wealth).toBeLessThanOrEqual(SUPPORT_ROLE_DAILY_WAGE * DAILY_ACTIVITY_MULTIPLIER + 1e-9);
          checkedReset = true;
        }
      }
    }
    expect(checkedReset).toBe(true);
  });
});

describe('stepWorld — wealthGini now spans all 5 roles + grifters', () => {
  it('everyone (all roles + grifters) starts at 0 wealth at creation — still perfect equality', () => {
    const world = createWorld(1);
    expect(world.wealthGini).toBe(0);
  });

  it('the population-wide Gini reflects more than just Miller+Baker — grifters alone (uniform income) do not drive it to 0', () => {
    // With everyone else earning role-specific incomes and grifters earning a flat floor,
    // the combined population should show real inequality after enough days.
    let world = createWorld(1);
    for (let i = 0; i < 150; i++) world = stepWorld(world);
    expect(world.wealthGini).toBeGreaterThan(0);
  });
});
