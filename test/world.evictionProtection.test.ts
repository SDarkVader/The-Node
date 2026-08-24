import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World } from '../src/world/world.js';
import { ESTABLISHED_TENURE_DAYS } from '../src/sim/multiRoleConscription.js';
import { TYPICAL_COMPLETION_RATIO, type CompletionStats } from '../src/engine/roleCompletion.js';

/**
 * Real, wired integration for the `occupantTenure`/`ESTABLISHED_TENURE_DAYS`
 * eviction-preference bias (2026-08-18) — the buildable alternative offered instead of the
 * rejected `V_i` shield (see docs/DEVLOG.md's matching entry: constraint 6 forbids a shield
 * that requires reputation to fall, and even a grant-only permanent version threatens
 * constraint 2 over a shard's lifetime — so this is PREFERENCE, not immunity, and it must be
 * demonstrated against the real `World` kernel, not just the pure `multiRoleConscription.ts`
 * unit tests in `test/multiRoleConscription.test.ts`).
 */

describe('daysInRole — tracked correctly through a real stepWorld run', () => {
  it('starts at ESTABLISHED_TENURE_DAYS for every FILLED slot at world creation ("start maxed, established shard")', () => {
    const world = createWorld(1);
    for (const m of world.millers) expect(m.daysInRole).toBe(ESTABLISHED_TENURE_DAYS);
    for (const b of world.bakers) expect(b.daysInRole).toBe(ESTABLISHED_TENURE_DAYS);
    for (const c of world.couriers) expect(c.daysInRole).toBe(ESTABLISHED_TENURE_DAYS);
  });

  it('increments by 1 per day while FILLED and stays frozen while not FILLED', () => {
    let world = createWorld(2, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0 });
    const before = world.millers.map((m) => m.daysInRole);
    world = stepWorld(world);
    world.millers.forEach((m, i) => {
      if (m.slot.state === 'FILLED') expect(m.daysInRole).toBe(before[i]! + 1);
    });
  });

  it('resets to 0 the moment a slot transitions into FILLED via conscription', () => {
    let world = createWorld(3, { ...DEFAULT_WORLD_CONFIG, rMiller: 2, targetPopulation: 20, conscriptionDelay: 1 });
    const idx = world.millers.findIndex((m) => m.slot.state === 'FILLED');
    world = { ...world, millers: world.millers.map((m, i) => (i === idx ? { ...m, slot: { state: 'BACKSTOPPED' as const, vacantSince: world.tick - 100_000 } } : m)) };

    let sawReset = false;
    for (let day = 0; day < 60 && !sawReset; day++) {
      world = stepWorld(world);
      if (world.millers[idx]!.slot.state === 'FILLED' && world.millers[idx]!.daysInRole === 0) sawReset = true;
    }
    expect(sawReset).toBe(true);
  });
});

describe('conscriptionFromOtherRole eviction preference — real World, established occupant protected while green candidates exist', () => {
  function establishedProtectionFixture(seed: number): World {
    let world = createWorld(seed, {
      ...DEFAULT_WORLD_CONFIG,
      rMiller: 1,
      rBaker: 1,
      rCourier: 2,
      rInvestigator: 2, // 2026-08-22: merged Journalist+Detective — same total slot count (2) as before
      rImportExport: 1,
      targetPopulation: 7, // exactly totalRoleSlots -> zero grifters, forcing every
      // conscription event to be conscriptionFromOtherRole, never conscriptionFromGrifters
      pMonthly: 0, // nobody churns out on their own — the only vacancy is the one forced below
      conscriptionDelay: 0,
    });
    expect(world.grifters.length).toBe(0);

    // One established occupant (courier[0]) against an otherwise entirely green cast of
    // other-role candidates (baker, courier[1], investigator[0], investigator[1], importExport).
    const established = ESTABLISHED_TENURE_DAYS * 3;
    world = {
      ...world,
      couriers: world.couriers.map((c, i) => (i === 0 ? { ...c, daysInRole: established } : { ...c, daysInRole: 0 })),
      bakers: world.bakers.map((b) => ({ ...b, daysInRole: 0 })),
      investigators: world.investigators.map((i) => ({ ...i, daysInRole: 0 })),
      importExporters: world.importExporters.map((x) => ({ ...x, daysInRole: 0 })),
      // Force the Miller slot straight into BACKSTOPPED, deep enough in the past that
      // conscription fires on the very first tick regardless of tHard/conscriptionDelay.
      millers: world.millers.map((m) => ({ ...m, slot: { state: 'BACKSTOPPED' as const, vacantSince: world.tick - 1_000_000 } })),
    };
    return world;
  }

  it('the established courier is never the one evicted, across many seeds', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const before = establishedProtectionFixture(seed);
      const after = stepWorld(before);

      // The BACKSTOPPED miller must have been genuinely conscripted-filled this same tick —
      // otherwise this fixture isn't exercising the eviction path at all and the test proves
      // nothing.
      expect(after.millers[0]!.slot.state).toBe('FILLED');

      // The established courier survived — still FILLED, tenure untouched by this tick's
      // reset-on-eviction (it may have grown by +1 from the ordinary daily increment).
      expect(after.couriers[0]!.slot.state).toBe('FILLED');
      expect(after.couriers[0]!.daysInRole).toBeGreaterThanOrEqual(ESTABLISHED_TENURE_DAYS * 3);
    }
  });

  it('exactly one of the green candidates was evicted to cover the miller slot', () => {
    const before = establishedProtectionFixture(11);
    const after = stepWorld(before);

    const greenCandidates = [
      after.bakers[0]!.slot.state,
      after.couriers[1]!.slot.state,
      after.investigators[0]!.slot.state,
      after.investigators[1]!.slot.state,
      after.importExporters[0]!.slot.state,
    ];
    const vacatedCount = greenCandidates.filter((s) => s !== 'FILLED').length;
    expect(vacatedCount).toBe(1);
  });
});

describe('conscriptionFromOtherRole eviction preference — real World, tenure alone is not enough, real performance also has to hold up (2026-08-18)', () => {
  it('a tenured but chronically underperforming courier is evicted before an equally-tenured, genuinely productive one', () => {
    let world = createWorld(21, {
      ...DEFAULT_WORLD_CONFIG,
      rMiller: 1,
      rBaker: 1,
      rCourier: 2,
      rInvestigator: 2, // 2026-08-22: merged Journalist+Detective — same total slot count (2) as before
      rImportExport: 1,
      targetPopulation: 7,
      pMonthly: 0,
      conscriptionDelay: 0,
    });
    expect(world.grifters.length).toBe(0);

    // Both couriers are equally, fully established by tenure. Only their real completion
    // history differs: courier[0] has a career of near-total failure; courier[1] performs
    // exactly at the role's own typical rate.
    const poorStats: CompletionStats = { attempts: 100, completions: 1 };
    const typicalStatsFor = (role: keyof typeof TYPICAL_COMPLETION_RATIO): CompletionStats => ({
      attempts: 100,
      completions: Math.round(TYPICAL_COMPLETION_RATIO[role] * 100),
    });
    world = {
      ...world,
      couriers: world.couriers.map((c) => ({ ...c, daysInRole: ESTABLISHED_TENURE_DAYS * 3 })),
      completionStats: {
        ...world.completionStats,
        [world.couriers[0]!.buildingId]: poorStats,
        [world.couriers[1]!.buildingId]: typicalStatsFor('courier'),
        // Every OTHER other-role candidate is made FULLY established (tenure AND real
        // typical performance) so the eviction pool contains exactly one candidate —
        // courier[0] — rather than a random pick among several green ones. That isolates
        // the performance check specifically; it is not what this test is measuring.
        [world.bakers[0]!.buildingId]: typicalStatsFor('baker'),
        [world.investigators[0]!.buildingId]: typicalStatsFor('investigator'),
        [world.investigators[1]!.buildingId]: typicalStatsFor('investigator'),
        [world.importExporters[0]!.buildingId]: typicalStatsFor('importExport'),
      },
      bakers: world.bakers.map((b) => ({ ...b, daysInRole: ESTABLISHED_TENURE_DAYS * 3 })),
      investigators: world.investigators.map((i) => ({ ...i, daysInRole: ESTABLISHED_TENURE_DAYS * 3 })),
      importExporters: world.importExporters.map((x) => ({ ...x, daysInRole: ESTABLISHED_TENURE_DAYS * 3 })),
      millers: world.millers.map((m) => ({ ...m, slot: { state: 'BACKSTOPPED' as const, vacantSince: world.tick - 1_000_000 } })),
    };

    const after = stepWorld(world);
    expect(after.millers[0]!.slot.state).toBe('FILLED');
    // The chronically underperforming courier loses their slot despite equal tenure...
    expect(after.couriers[0]!.slot.state).toBe('VACANT');
    // ...while the genuinely productive one, at equal tenure, keeps theirs.
    expect(after.couriers[1]!.slot.state).toBe('FILLED');
  });
});
