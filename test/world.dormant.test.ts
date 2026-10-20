import { describe, expect, it } from 'vitest';
import { createDormantWorld, receiveMigrants, stepWorld, DEFAULT_WORLD_CONFIG, type World } from '../src/world/world.js';
import { economicHealth } from '../src/engine/ecosystem.js';

/**
 * `createDormantWorld` (2026-10-20). A dormant shard is "automated economic stability until a
 * new player lands" — population 0, every role slot VACANT so the ordinary vacancy timers
 * backstop it. Written to check a suspected bug found while designing the settlement ledger
 * (`docs/DESIGN_SETTLEMENT_FLOW_BALANCE_2026-10-20.md` §3.1): Import/Export was never vacated,
 * leaving FILLED slots in a shard with nobody in it, and `totalRoleSlots` omitted
 * `rImportExport`.
 */

function totalFilled(world: World): number {
  return [world.millers, world.bakers, world.couriers, world.investigators, world.importExporters]
    .flat()
    .filter((s) => s.slot.state === 'FILLED').length;
}

const TOTAL_ROLE_SLOTS =
  DEFAULT_WORLD_CONFIG.rMiller +
  DEFAULT_WORLD_CONFIG.rBaker +
  DEFAULT_WORLD_CONFIG.rCourier +
  DEFAULT_WORLD_CONFIG.rInvestigator +
  DEFAULT_WORLD_CONFIG.rImportExport;

describe('createDormantWorld — every role slot, Import/Export included, starts VACANT', () => {
  it('no Import/Export slot is FILLED in an empty shard', () => {
    const world = createDormantWorld(7, DEFAULT_WORLD_CONFIG);
    expect(world.importExporters.length).toBe(DEFAULT_WORLD_CONFIG.rImportExport);
    for (const x of world.importExporters) expect(x.slot.state).toBe('VACANT');
  });

  it('population conservation holds at creation: grifters + FILLED == population == 0', () => {
    const world = createDormantWorld(7, DEFAULT_WORLD_CONFIG);
    expect(world.population).toBe(0);
    expect(world.grifters.length + totalFilled(world)).toBe(world.population);
  });

  it('economicHealth uses the full 5-role slot count, same denominator stepWorld uses', () => {
    const world = createDormantWorld(7, DEFAULT_WORLD_CONFIG);
    expect(world.economicHealth).toBe(economicHealth(0, TOTAL_ROLE_SLOTS));
  });
});

describe('createDormantWorld — population conservation once stepped', () => {
  it('holds every tick with no arrivals, and nothing is ever FILLED by nobody', () => {
    let world = createDormantWorld(7, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 60; i++) {
      world = stepWorld(world);
      expect(world.grifters.length + totalFilled(world)).toBe(world.population);
    }
  });

  it('holds every tick after migrants arrive, across several seeds', () => {
    for (const seed of [1, 2, 3]) {
      let world = receiveMigrants(createDormantWorld(seed, DEFAULT_WORLD_CONFIG), 5);
      expect(world.grifters.length + totalFilled(world)).toBe(world.population);
      for (let i = 0; i < 300; i++) {
        world = stepWorld(world);
        expect(world.grifters.length + totalFilled(world)).toBe(world.population);
      }
    }
  });
});
