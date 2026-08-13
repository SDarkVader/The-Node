import { describe, expect, it } from 'vitest';
import { computeEconomicHeat, districtEconomicHeat } from '../src/engine/economicHeat.js';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';

/**
 * Regression tests for Economic Heat (2026-08-11, Design Addendum item 2) — verified in
 * isolation before trusting it as a rendering source, per CLAUDE.md constraint 1.
 */

describe('computeEconomicHeat', () => {
  it('gives every building in the shard an entry, in [0,1]', () => {
    const world = createWorld(1, DEFAULT_WORLD_CONFIG);
    const heat = computeEconomicHeat(world);
    const allBuildingIds = world.shard.districts.flatMap((d) => d.buildings.map((b) => b.id));
    for (const id of allBuildingIds) {
      expect(heat[id]).toBeGreaterThanOrEqual(0);
      expect(heat[id]).toBeLessThanOrEqual(1);
    }
  });

  it('is a pure read: calling it twice on the same world gives identical results, and never mutates world', () => {
    const world = createWorld(2, DEFAULT_WORLD_CONFIG);
    const before = JSON.stringify(world);
    const a = computeEconomicHeat(world);
    const b = computeEconomicHeat(world);
    expect(a).toEqual(b);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('a Miller building\'s heat tracks its own quantity value directly', () => {
    const world = createWorld(3, DEFAULT_WORLD_CONFIG);
    const heat = computeEconomicHeat(world);
    for (const m of world.millers) {
      expect(heat[m.buildingId]).toBeCloseTo(Math.max(0, Math.min(1, m.value)), 10);
    }
  });

  it('a Baker building\'s heat tracks its own price, normalized to the 2.0 ceiling', () => {
    const world = createWorld(4, DEFAULT_WORLD_CONFIG);
    const heat = computeEconomicHeat(world);
    for (const b of world.bakers) {
      expect(heat[b.buildingId]).toBeCloseTo(Math.max(0, Math.min(1, b.value / 2.0)), 10);
    }
  });

  it('a VACANT or BACKSTOPPED slot reads 0 — no occupant, no scarcity pressure to show', () => {
    let world = createWorld(5, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 90; i++) world = stepWorld(world); // enough churn that something is not FILLED
    const heat = computeEconomicHeat(world);
    const nonFilled = [
      ...world.millers.filter((m) => m.slot.state !== 'FILLED'),
      ...world.bakers.filter((b) => b.slot.state !== 'FILLED'),
      ...world.couriers.filter((c) => c.slot.state !== 'FILLED'),
      ...world.journalists.filter((j) => j.slot.state !== 'FILLED'),
      ...world.detectives.filter((d) => d.slot.state !== 'FILLED'),
      ...world.importExporters.filter((x) => x.slot.state !== 'FILLED'),
    ];
    expect(nonFilled.length).toBeGreaterThan(0); // sanity: the run actually produced a non-FILLED slot
    for (const s of nonFilled) {
      expect(heat[s.buildingId]).toBe(0);
    }
  });

  it('a support-role building in a district with degraded friction reads hotter than one in a fully healthy district', () => {
    // Build two worlds that differ ONLY in one district's consolidation state, then compare
    // the same role's heat under otherwise identical conditions.
    let world = createWorld(6, DEFAULT_WORLD_CONFIG);
    const someCourier = world.couriers[0]!;
    const districtId = world.shard.districts.find((d) => d.buildings.some((b) => b.id === someCourier.buildingId))!.id;

    const healthyWorld = world;
    const degradedWorld = {
      ...world,
      districtHealth: {
        ...world.districtHealth,
        [districtId]: { ...world.districtHealth[districtId]!, state: 'CONSOLIDATING' as const, consolidatingSince: world.tick - 5 },
      },
    };

    const healthyHeat = computeEconomicHeat(healthyWorld)[someCourier.buildingId]!;
    const degradedHeat = computeEconomicHeat(degradedWorld)[someCourier.buildingId]!;
    expect(degradedHeat).toBeGreaterThan(healthyHeat);
  });
});

describe('districtEconomicHeat', () => {
  it('every district gets an entry in [0,1]', () => {
    const world = createWorld(7, DEFAULT_WORLD_CONFIG);
    const heat = computeEconomicHeat(world);
    const districtHeat = districtEconomicHeat(world, heat);
    for (const d of world.shard.districts) {
      expect(districtHeat[d.id]).toBeGreaterThanOrEqual(0);
      expect(districtHeat[d.id]).toBeLessThanOrEqual(1);
    }
  });

  it('is the mean of that district\'s own buildings\' heat', () => {
    const world = createWorld(8, DEFAULT_WORLD_CONFIG);
    const heat = computeEconomicHeat(world);
    const districtHeat = districtEconomicHeat(world, heat);
    for (const d of world.shard.districts) {
      if (d.buildings.length === 0) continue;
      const expected = d.buildings.reduce((a, b) => a + (heat[b.id] ?? 0), 0) / d.buildings.length;
      expect(districtHeat[d.id]).toBeCloseTo(expected, 10);
    }
  });
});
