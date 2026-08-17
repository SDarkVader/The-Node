import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World } from '../src/world/world.js';
import { EXPERIENCE_FLOOR_MAX_FRACTION, EXPERIENCE_FLOOR_PER_SHIFT } from '../src/engine/experienceFloor.js';
import { EXPERIENCE_CAP } from '../src/engine/ecosystem.js';

/**
 * Real, wired integration for `engine/experienceFloor.ts` (2026-08-13) — verifies the
 * whole chain against a real `World`, not just the standalone unit tests in
 * `test/experienceFloor.test.ts`: Shift Cover credits a role-specific counter, and a
 * grifter with real prior practice in a role starts that role with a measurable
 * experience head start over an equally-green grifter, when conscripted into it.
 */

function vacateOneMiller(world: World): World {
  const idx = world.millers.findIndex((m) => m.slot.state === 'FILLED');
  if (idx < 0) throw new Error('no FILLED miller to vacate in this fixture');
  const millers = world.millers.map((m, i) => (i === idx ? { ...m, slot: { state: 'VACANT' as const, vacantSince: world.tick } } : m));
  return { ...world, millers };
}

describe('experience floor — wired end-to-end through a real stepWorld run', () => {
  it('Shift Cover credits the SPECIFIC role covered, not just the flat reputationProgress counter', () => {
    let world = createWorld(1, { ...DEFAULT_WORLD_CONFIG, rMiller: 2, targetPopulation: 20 });
    // Force at least one BACKSTOPPED miller so a Shift Cover opportunity exists.
    world = { ...world, millers: world.millers.map((m, i) => (i === 0 ? { ...m, slot: { state: 'BACKSTOPPED' as const, vacantSince: 0 } } : m)) };

    let sawMillerCredit = false;
    for (let day = 0; day < 200 && !sawMillerCredit; day++) {
      world = stepWorld(world);
      sawMillerCredit = world.grifters.some((g) => (g.shiftsCoveredByRole?.miller ?? 0) > 0);
    }
    expect(sawMillerCredit).toBe(true);
  });

  it('a grifter with real prior Miller practice starts measurably ahead of a green grifter, once conscripted into Miller', () => {
    let world = createWorld(2, {
      ...DEFAULT_WORLD_CONFIG,
      rMiller: 2,
      rBaker: 2,
      rCourier: 2,
      rJournalist: 2,
      rDetective: 2,
      rImportExport: 2,
      targetPopulation: 20,
      conscriptionDelay: 1,
    });
    // Give one grifter real, prior Miller-specific practice; everyone else stays green.
    world = { ...world, grifters: world.grifters.map((g, i) => (i === 0 ? { ...g, shiftsCoveredByRole: { miller: 5 } } : g)) };
    const seededGrifterId = world.grifters[0]!.id;

    world = vacateOneMiller(world);
    // Force this exact grifter to be conscripted next: give them the longest wait so the
    // real "lowest level, longest wait" selection picks them deterministically.
    world = { ...world, grifters: world.grifters.map((g) => (g.id === seededGrifterId ? { ...g, daysAsGrifter: 10_000 } : g)) };

    let filledExperience: number | undefined;
    for (let day = 0; day < 60 && filledExperience === undefined; day++) {
      world = stepWorld(world);
      const stillGrifter = world.grifters.some((g) => g.id === seededGrifterId);
      if (!stillGrifter) {
        // The seeded grifter is gone from the pool — find which miller slot picked up the
        // experience floor this same tick (the only one that isn't 0 or EXPERIENCE_CAP-grown).
        const candidate = world.millers.find((m) => m.slot.state === 'FILLED' && m.experience > 0 && m.experience < EXPERIENCE_CAP);
        filledExperience = candidate?.experience;
      }
    }

    expect(filledExperience).toBeDefined();
    expect(filledExperience!).toBeGreaterThan(0);
    expect(filledExperience!).toBeCloseTo(Math.min(EXPERIENCE_CAP * EXPERIENCE_FLOOR_MAX_FRACTION, 5 * EXPERIENCE_FLOOR_PER_SHIFT), 5);
  });

  it('a grifter with no prior practice in the role still starts at exactly 0 — never worse than today', () => {
    let world = createWorld(3, { ...DEFAULT_WORLD_CONFIG, rMiller: 2, targetPopulation: 20, conscriptionDelay: 1 });
    world = vacateOneMiller(world);

    let filledExperience: number | undefined;
    for (let day = 0; day < 60 && filledExperience === undefined; day++) {
      world = stepWorld(world);
      const vacatedSlotStillOpen = world.millers.some((m) => m.slot.state !== 'FILLED');
      if (!vacatedSlotStillOpen) {
        filledExperience = Math.min(...world.millers.map((m) => m.experience));
      }
    }
    expect(filledExperience).toBe(0);
  });
});
