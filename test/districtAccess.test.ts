import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hasShortcutAccess, directNeighbors, effectiveRoute } from '../src/engine/districtAccess.js';
import { generateShardLayout, DEFAULT_SHARD_CONFIG, type ShardLayoutConfig } from '../src/engine/space.js';

/**
 * Regression tests for District Access (2026-08-12, "district barriers" —
 * `docs/VISUAL_FRAMEWORK_2026-08-12.md` §6) — verified in isolation before trusting it, per
 * CLAUDE.md constraint 1. Two of these tests exist specifically to PROVE the two design
 * questions the spec left open, not just assert the happy path: that consolidation state
 * structurally cannot reach this module, and that no player can gate another's access.
 */

// The shipped DEFAULT_SHARD_CONFIG became a single district 2026-08-13 (real per-district
// population data showed no tradeoff — see space.ts's own header), but this whole module is
// about district-TO-district access, which is only exercised with more than one district.
// Every test below uses an explicit multi-district config rather than assuming the shipped
// default has one.
const MULTI_DISTRICT_TEST_CONFIG: ShardLayoutConfig = {
  ...DEFAULT_SHARD_CONFIG,
  coreDistrictCount: 2,
  peripheryDistrictCount: 4,
  buildingsPerCoreDistrict: 15,
  buildingsPerPeripheryDistrict: 8,
};

describe('hasShortcutAccess', () => {
  it('is true only for FILLED', () => {
    expect(hasShortcutAccess('FILLED')).toBe(true);
  });

  it('is false for every other status', () => {
    expect(hasShortcutAccess('VACANT')).toBe(false);
    expect(hasShortcutAccess('BACKSTOPPED')).toBe(false);
    expect(hasShortcutAccess('grifter')).toBe(false);
  });
});

describe('directNeighbors', () => {
  it('returns the real side-street neighbours for a district that has them', () => {
    const shard = generateShardLayout(5, MULTI_DISTRICT_TEST_CONFIG);
    const d = shard.districts[0]!;
    expect(directNeighbors(shard, d.id)).toEqual(d.neighborDistrictIds);
  });

  it('returns an empty array, not a crash, for an unknown districtId', () => {
    const shard = generateShardLayout(5, MULTI_DISTRICT_TEST_CONFIG);
    expect(directNeighbors(shard, 'nonexistent-district')).toEqual([]);
  });
});

describe('effectiveRoute', () => {
  it('is "direct" for staying within the same district, regardless of status', () => {
    const shard = generateShardLayout(9, MULTI_DISTRICT_TEST_CONFIG);
    const d = shard.districts[0]!.id;
    expect(effectiveRoute(shard, d, d, 'grifter')).toBe('direct');
    expect(effectiveRoute(shard, d, d, 'FILLED')).toBe('direct');
  });

  it('is "direct" for a FILLED traveler going to a real side-street neighbour', () => {
    const shard = generateShardLayout(9, MULTI_DISTRICT_TEST_CONFIG);
    const from = shard.districts.find((d) => d.neighborDistrictIds.length > 0)!;
    const to = from.neighborDistrictIds[0]!;
    expect(effectiveRoute(shard, from.id, to, 'FILLED')).toBe('direct');
  });

  it('is "viaHub" for a FILLED traveler going to a district that is NOT a side-street neighbour', () => {
    const shard = generateShardLayout(9, MULTI_DISTRICT_TEST_CONFIG);
    const from = shard.districts[0]!;
    const nonNeighbor = shard.districts.find((d) => d.id !== from.id && !from.neighborDistrictIds.includes(d.id));
    if (!nonNeighbor) return; // fully-connected mesh at this seed/config — nothing to assert
    expect(effectiveRoute(shard, from.id, nonNeighbor.id, 'FILLED')).toBe('viaHub');
  });

  it('is "viaHub" for every non-FILLED status, even to a real side-street neighbour', () => {
    const shard = generateShardLayout(9, MULTI_DISTRICT_TEST_CONFIG);
    const from = shard.districts.find((d) => d.neighborDistrictIds.length > 0)!;
    const to = from.neighborDistrictIds[0]!;
    for (const status of ['VACANT', 'BACKSTOPPED', 'grifter'] as const) {
      expect(effectiveRoute(shard, from.id, to, status)).toBe('viaHub');
    }
  });

  it('never has no route at all — every pair of districts resolves to a real RouteKind', () => {
    const shard = generateShardLayout(17, MULTI_DISTRICT_TEST_CONFIG);
    for (const from of shard.districts) {
      for (const to of shard.districts) {
        const route = effectiveRoute(shard, from.id, to.id, 'grifter');
        expect(['direct', 'viaHub']).toContain(route);
      }
    }
  });
});

describe('the two design questions the spec left open — proved, not just asserted', () => {
  it('CONSOLIDATION STATE CANNOT REACH ACCESS: space.ts has zero import of districtConsolidation.ts', () => {
    // Structural guard, same pattern test/grammar.invariant.test.ts and
    // test/drivers.importGuard.test.ts already use for this class of guarantee. If this
    // ever starts failing because someone wired district health into corridor geometry,
    // that has to be a deliberate, reviewed decision — not something that happens by
    // accident while touching an unrelated part of space.ts.
    const src = readFileSync(new URL('../src/engine/space.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from\s+['"].*districtConsolidation/);
  });

  it('NO PLAYER CAN GATE ANOTHER\'S ACCESS: directNeighbors and effectiveRoute take no per-player identity for any district but the traveler\'s own', () => {
    // The containment proof is really a type-level guarantee — directNeighbors(shard,
    // districtId) has no third parameter for "who else is in this district," and
    // effectiveRoute's only per-player input is the TRAVELER's own status. This test makes
    // that concrete: the route between two districts is identical no matter what the
    // occupancy of every OTHER district in the shard is, because those districts' occupancy
    // was never an input this function could have read in the first place.
    const shard = generateShardLayout(9, MULTI_DISTRICT_TEST_CONFIG);
    const from = shard.districts.find((d) => d.neighborDistrictIds.length > 0)!;
    const to = from.neighborDistrictIds[0]!;

    // "Mutate" every other district's geometry to something wildly different and confirm
    // the route between `from` and `to` is unaffected — there is no field on any OTHER
    // district this computation could have been reading.
    const tamperedShard = {
      ...shard,
      districts: shard.districts.map((d) =>
        d.id === from.id || d.id === to
          ? d
          : { ...d, neighborDistrictIds: [], plazaPlot: { x: 99999, y: 99999 }, radius: 0 },
      ),
    };

    expect(effectiveRoute(tamperedShard, from.id, to, 'FILLED')).toBe(effectiveRoute(shard, from.id, to, 'FILLED'));
    expect(directNeighbors(tamperedShard, from.id)).toEqual(directNeighbors(shard, from.id));
  });
});
