import { describe, expect, it } from 'vitest';
import {
  distance,
  plotsWithin,
  occupantsWithin,
  districtOf,
  districtPlotDensity,
  generateShardLayout,
  proximityCloseness,
  placeArrival,
  districtHousingCapacity,
  chooseHousingDistrict,
  HOUSING_FLOORS_PER_BUILDING,
  HOUSING_RESIDENTS_PER_FLOOR,
  DEFAULT_SHARD_CONFIG,
  DISTRICT_SIDE_STREET_NEIGHBOR_COUNT,
  type Shard,
  type PlayerPosition,
  type ShardLayoutConfig,
} from '../src/engine/space.js';

/**
 * Regression tests for Phase A of the Observatory build spec (`space.ts`). Per the spec:
 * layout determinism under a fixed seed, distance symmetry and triangle inequality,
 * occupancy queries against hand-computed ground truth, and a regression test proving the
 * density gradient actually exists (core measurably denser than periphery).
 */

// The shipped DEFAULT_SHARD_CONFIG became a single district 2026-08-13 (real per-district
// population data showed no tradeoff — see space.ts's own header). Side streets, the core/
// periphery density gradient, and same-classification arrival spreading are all still real,
// still-shipped mechanisms that must work correctly whenever a shard DOES have multiple
// districts — these tests verify that with an explicit multi-district config rather than
// assuming the shipped default has one.
const MULTI_DISTRICT_TEST_CONFIG: ShardLayoutConfig = {
  ...DEFAULT_SHARD_CONFIG,
  coreDistrictCount: 2,
  peripheryDistrictCount: 4,
  buildingsPerCoreDistrict: 15,
  buildingsPerPeripheryDistrict: 8,
};

describe('generateShardLayout — determinism', () => {
  it('the same seed and config always produce a byte-identical shard', () => {
    const a = generateShardLayout(42, DEFAULT_SHARD_CONFIG);
    const b = generateShardLayout(42, DEFAULT_SHARD_CONFIG);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds produce different layouts', () => {
    const a = generateShardLayout(1, DEFAULT_SHARD_CONFIG);
    const b = generateShardLayout(2, DEFAULT_SHARD_CONFIG);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('exposes hubPlot at the origin — the point every district corridor connects back to and none owns', () => {
    // Real value, not a magic implicit convention — see VISUAL_FRAMEWORK_2026-08-12.md §1:
    // this is where the Wall (the visual brief's shard-wide landmark) belongs.
    const shard = generateShardLayout(7);
    expect(shard.hubPlot).toEqual({ x: 0, y: 0 });
  });

  it('hubPlot is identical across every seed and config — one fixed shard-wide point', () => {
    expect(generateShardLayout(1).hubPlot).toEqual(generateShardLayout(999).hubPlot);
  });

  it('every district has at least DISTRICT_SIDE_STREET_NEIGHBOR_COUNT side-street neighbours, given enough other districts to choose from', () => {
    const shard = generateShardLayout(7, MULTI_DISTRICT_TEST_CONFIG);
    for (const d of shard.districts) {
      expect(d.neighborDistrictIds.length).toBeGreaterThanOrEqual(DISTRICT_SIDE_STREET_NEIGHBOR_COUNT);
    }
  });

  it('the side-street mesh is symmetric — if A lists B, B lists A', () => {
    const shard = generateShardLayout(11);
    for (const a of shard.districts) {
      for (const bId of a.neighborDistrictIds) {
        const b = shard.districts.find((d) => d.id === bId)!;
        expect(b.neighborDistrictIds).toContain(a.id);
      }
    }
  });

  it('no district lists itself as a neighbour', () => {
    const shard = generateShardLayout(13);
    for (const d of shard.districts) {
      expect(d.neighborDistrictIds).not.toContain(d.id);
    }
  });

  it('a single-district shard has no side streets, and generation does not throw', () => {
    const shard = generateShardLayout(1, { ...DEFAULT_SHARD_CONFIG, coreDistrictCount: 1, peripheryDistrictCount: 0 });
    expect(shard.districts.length).toBe(1);
    expect(shard.districts[0]!.neighborDistrictIds).toEqual([]);
  });

  it('side-street generation is deterministic under a fixed seed, same as everything else in this module', () => {
    const a = generateShardLayout(42, DEFAULT_SHARD_CONFIG);
    const b = generateShardLayout(42, DEFAULT_SHARD_CONFIG);
    expect(a.districts.map((d) => d.neighborDistrictIds)).toEqual(b.districts.map((d) => d.neighborDistrictIds));
  });

  it('side streets never collide with an existing plot — no two plots share a coordinate, mesh included', () => {
    // Same invariant the pre-existing "no two plots" test already checks for hub corridors —
    // re-run against a shard whose side-street mesh is real (default multi-district config)
    // to prove the new corridor pass doesn't reintroduce the exact bug that test guards.
    const shard = generateShardLayout(23, DEFAULT_SHARD_CONFIG);
    const seen = new Set<string>();
    for (const district of shard.districts) {
      for (const plot of district.plots) {
        const key = `${plot.x},${plot.y}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('every district has exactly one plaza plot', () => {
    const shard = generateShardLayout(7);
    for (const district of shard.districts) {
      const plazas = district.plots.filter((p) => p.kind === 'plaza');
      expect(plazas.length).toBe(1);
      expect(plazas[0]!.x).toBe(district.plazaPlot.x);
      expect(plazas[0]!.y).toBe(district.plazaPlot.y);
    }
  });

  it('no two plots in the whole shard share a coordinate', () => {
    const shard = generateShardLayout(7);
    const seen = new Set<string>();
    for (const district of shard.districts) {
      for (const plot of district.plots) {
        const key = `${plot.x},${plot.y}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('building count per district matches config, capped by available street plots', () => {
    const shard = generateShardLayout(7);
    for (const district of shard.districts) {
      const expected =
        district.classification === 'core'
          ? DEFAULT_SHARD_CONFIG.buildingsPerCoreDistrict
          : DEFAULT_SHARD_CONFIG.buildingsPerPeripheryDistrict;
      expect(district.buildings.length).toBeLessThanOrEqual(expected);
      expect(district.buildings.length).toBeGreaterThan(0);
    }
  });
});

describe('distance — a proper metric', () => {
  it('is symmetric', () => {
    const a = { x: 3, y: -2 };
    const b = { x: -5, y: 7 };
    expect(distance(a, b)).toBe(distance(b, a));
  });

  it('satisfies the triangle inequality across many random point triples', () => {
    let seed = 1;
    const rand = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 200; i++) {
      const a = { x: Math.floor(rand() * 40) - 20, y: Math.floor(rand() * 40) - 20 };
      const b = { x: Math.floor(rand() * 40) - 20, y: Math.floor(rand() * 40) - 20 };
      const c = { x: Math.floor(rand() * 40) - 20, y: Math.floor(rand() * 40) - 20 };
      expect(distance(a, c)).toBeLessThanOrEqual(distance(a, b) + distance(b, c));
    }
  });

  it('is zero exactly when the two points coincide', () => {
    expect(distance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
    expect(distance({ x: 5, y: 5 }, { x: 5, y: 6 })).toBeGreaterThan(0);
  });
});

describe('occupantsWithin / plotsWithin — hand-computed ground truth', () => {
  // A tiny, hand-built shard: one district, plaza at (0,0), plus four plots at exactly
  // distance 1, 2, 3, 5 from the plaza, so the expected within-radius set is computable
  // by hand rather than trusted from the generator.
  const shard: Shard = {
    id: 'test-shard',
    seed: 0,
    hubPlot: { x: 0, y: 0 },
    districts: [
      {
        id: 'core-0',
        classification: 'core',
        radius: 6,
        plazaPlot: { x: 0, y: 0 },
        plots: [
          { x: 0, y: 0, districtId: 'core-0', kind: 'plaza' },
          { x: 1, y: 0, districtId: 'core-0', kind: 'street' }, // distance 1
          { x: 1, y: 1, districtId: 'core-0', kind: 'street' }, // distance 2
          { x: 2, y: 1, districtId: 'core-0', kind: 'street' }, // distance 3
          { x: 3, y: 2, districtId: 'core-0', kind: 'street' }, // distance 5
        ],
        buildings: [],
        population: 0,
        economicHealthHistory: [],
        detectionHistory: [],
        weatherHistory: [],
        neighborDistrictIds: [],
      },
    ],
  };

  const centre = { x: 0, y: 0 };

  it('plotsWithin returns exactly the plots at or under the given radius', () => {
    const within2 = plotsWithin(shard, centre, 2);
    const coords = within2.map((p) => `${p.x},${p.y}`).sort();
    expect(coords).toEqual(['0,0', '1,0', '1,1'].sort());
  });

  it('plotsWithin at radius 0 returns only the centre plot', () => {
    const within0 = plotsWithin(shard, centre, 0);
    expect(within0.map((p) => `${p.x},${p.y}`)).toEqual(['0,0']);
  });

  it('plotsWithin at a large radius returns every plot', () => {
    const withinAll = plotsWithin(shard, centre, 100);
    expect(withinAll.length).toBe(5);
  });

  const occupants: PlayerPosition[] = [
    { playerId: 'at-plaza', x: 0, y: 0 },
    { playerId: 'dist-1', x: 1, y: 0 },
    { playerId: 'dist-3', x: 2, y: 1 },
    { playerId: 'dist-5', x: 3, y: 2 },
    { playerId: 'far-away', x: 20, y: 20 },
  ];

  it('occupantsWithin returns exactly the hand-computed set at radius 3', () => {
    const result = occupantsWithin(shard, occupants, centre, 3).sort();
    expect(result).toEqual(['at-plaza', 'dist-1', 'dist-3'].sort());
  });

  it('occupantsWithin excludes everyone when radius is negative-equivalent (0 and nobody else present)', () => {
    const result = occupantsWithin(shard, occupants, centre, 0);
    expect(result).toEqual(['at-plaza']);
  });

  it('districtOf reads the plot\'s own district id directly', () => {
    expect(districtOf(shard.districts[0]!.plots[1]!)).toBe('core-0');
  });
});

describe('districtPlotDensity — the visual brief\'s density gradient actually exists', () => {
  it('core districts are measurably denser than periphery districts', () => {
    const shard = generateShardLayout(11, MULTI_DISTRICT_TEST_CONFIG);
    const coreDensities = shard.districts.filter((d) => d.classification === 'core').map(districtPlotDensity);
    const peripheryDensities = shard.districts
      .filter((d) => d.classification === 'periphery')
      .map(districtPlotDensity);

    const meanCore = coreDensities.reduce((a, b) => a + b, 0) / coreDensities.length;
    const meanPeriphery = peripheryDensities.reduce((a, b) => a + b, 0) / peripheryDensities.length;

    expect(meanCore).toBeGreaterThan(meanPeriphery);
    // Not just barely greater — coreSpacing=1 vs peripherySpacing=2 should produce a real gap.
    expect(meanCore).toBeGreaterThan(meanPeriphery * 1.5);
  });

  it('holds across multiple seeds, not just one lucky layout', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const shard = generateShardLayout(seed, MULTI_DISTRICT_TEST_CONFIG);
      const meanCore =
        shard.districts.filter((d) => d.classification === 'core').map(districtPlotDensity).reduce((a, b) => a + b, 0) /
        shard.districts.filter((d) => d.classification === 'core').length;
      const meanPeriphery =
        shard.districts
          .filter((d) => d.classification === 'periphery')
          .map(districtPlotDensity)
          .reduce((a, b) => a + b, 0) / shard.districts.filter((d) => d.classification === 'periphery').length;
      expect(meanCore).toBeGreaterThan(meanPeriphery);
    }
  });
});

describe('proximityCloseness — the real-distance wiring point for decay.ts / connections.ts', () => {
  it('is 1 at distance 0', () => {
    expect(proximityCloseness(0, 10)).toBe(1);
  });

  it('decreases monotonically as distance grows', () => {
    const values = [0, 2, 4, 6, 8].map((d) => proximityCloseness(d, 10)!);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeLessThan(values[i - 1]!);
    }
  });

  it('is null beyond maxRange — proximity-based closeness does not exist past that range', () => {
    expect(proximityCloseness(11, 10)).toBeNull();
  });

  it('never returns exactly 0 within range, since ConnectionGraph.connect rejects a zero weight', () => {
    expect(proximityCloseness(9.9, 10)).toBeGreaterThan(0);
  });
});

describe('placeArrival — closes districtArrivalChoice()\'s "nothing persists" gap', () => {
  it('increments the chosen district\'s population and places the arrival at its plaza', () => {
    const shard = generateShardLayout(3);
    const coreDistrict = shard.districts.find((d) => d.classification === 'core')!;
    const before = coreDistrict.population;

    const result = placeArrival(shard, 'core');
    expect(result).not.toBeNull();

    const updatedDistrict = result!.shard.districts.find((d) => d.id === result!.districtId)!;
    expect(updatedDistrict.population).toBe(before + 1);
    expect(result!.plot).toEqual(updatedDistrict.plazaPlot);
  });

  it('does not mutate the shard passed in — pure, like every other function here', () => {
    const shard = generateShardLayout(3);
    const before = JSON.stringify(shard);
    placeArrival(shard, 'core');
    expect(JSON.stringify(shard)).toBe(before);
  });

  it('spreads repeated arrivals across same-classification districts by lowest population', () => {
    let shard = generateShardLayout(3, MULTI_DISTRICT_TEST_CONFIG);
    const peripheryCount = shard.districts.filter((d) => d.classification === 'periphery').length;
    expect(peripheryCount).toBeGreaterThan(1);

    for (let i = 0; i < peripheryCount; i++) {
      const result = placeArrival(shard, 'periphery')!;
      shard = result.shard;
    }

    const populations = shard.districts.filter((d) => d.classification === 'periphery').map((d) => d.population);
    // One arrival each, spread out — no district should have received two before every
    // periphery district had at least one.
    expect(Math.max(...populations)).toBe(1);
  });

  it('returns null when no district of the requested classification exists', () => {
    const emptyShard: Shard = { id: 'x', seed: 0, districts: [], hubPlot: { x: 0, y: 0 } };
    expect(placeArrival(emptyShard, 'core')).toBeNull();
  });
});

describe('districtHousingCapacity — every building carries housing, independent of role slot', () => {
  it('equals building count x floors x residents-per-floor', () => {
    const shard = generateShardLayout(1, DEFAULT_SHARD_CONFIG);
    const d = shard.districts[0]!;
    expect(districtHousingCapacity(d)).toBe(d.buildings.length * HOUSING_FLOORS_PER_BUILDING * HOUSING_RESIDENTS_PER_FLOOR);
  });

  it('is 0 for a district with no buildings', () => {
    const emptyDistrict = { ...generateShardLayout(1, DEFAULT_SHARD_CONFIG).districts[0]!, buildings: [] };
    expect(districtHousingCapacity(emptyDistrict)).toBe(0);
  });

  it('does not depend on roleSlotRef — a Home-only (unassigned) building counts the same as a role-bearing one', () => {
    const shard = generateShardLayout(1, DEFAULT_SHARD_CONFIG);
    const d = shard.districts[0]!;
    const withoutRoles = { ...d, buildings: d.buildings.map((b) => ({ ...b, roleSlotRef: null })) };
    expect(districtHousingCapacity(withoutRoles)).toBe(districtHousingCapacity(d));
  });
});

describe('chooseHousingDistrict — spreads residents by housing headroom, never fails on a nonempty shard', () => {
  it('picks the district with the most headroom when counts differ', () => {
    const shard = generateShardLayout(1, MULTI_DISTRICT_TEST_CONFIG);
    const [a, b] = shard.districts;
    const capacityA = districtHousingCapacity(a!);
    // Fill every other district to near-capacity so `a` is unambiguously the most-headroom pick.
    const counts: Record<string, number> = {};
    for (const d of shard.districts) counts[d.id] = districtHousingCapacity(d) - 1;
    counts[a!.id] = 0;
    expect(chooseHousingDistrict(shard, counts)).toBe(a!.id);
    void b;
  });

  it('returns undefined only for a shard with zero districts', () => {
    const emptyShard: Shard = { id: 'x', seed: 0, districts: [], hubPlot: { x: 0, y: 0 } };
    expect(chooseHousingDistrict(emptyShard, {})).toBeUndefined();
  });

  it('still returns a real district id when every district is technically over capacity — never blocks (constraint 2)', () => {
    const shard = generateShardLayout(1, DEFAULT_SHARD_CONFIG);
    const counts: Record<string, number> = {};
    for (const d of shard.districts) counts[d.id] = districtHousingCapacity(d) + 1000;
    const chosen = chooseHousingDistrict(shard, counts);
    expect(shard.districts.some((d) => d.id === chosen)).toBe(true);
  });
});
