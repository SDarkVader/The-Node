import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type WorldConfig } from '../src/world/world.js';

/**
 * Regression tests verifying `docs/DESIGN_ADDENDUM_2026-08-13.md`'s central economic claim
 * ("scale district/shard count, not role-slot count, because slot-scaling starves the
 * grifter pool below its floor") against the REAL shipped engine — the addendum's own §3
 * sweep only checked a standalone toy Python formula (`design/node_core_reference.py`,
 * `economic_health = (filled*1.0 + npc*0.4)/S`, a flat single-number model with no
 * districts, no market, no grain chain, and — critically — a STATIC population figure
 * unaffected by slot count). Per CLAUDE.md constraint 1.
 */

const DAYS = 1500;
const BURN_IN = 400;
const SEEDS = [1, 2];

function totalSlots(config: WorldConfig): number {
  return config.rMiller + config.rBaker + config.rCourier + config.rInvestigator + config.rImportExport;
}

function measure(config: WorldConfig, seeds: readonly number[] = SEEDS) {
  let popSum = 0;
  let grifterPctSum = 0;
  let healthSum = 0;
  let flourRatioSum = 0;
  let n = 0;
  for (const seed of seeds) {
    let world = createWorld(seed, config);
    for (let i = 0; i < DAYS; i++) {
      world = stepWorld(world);
      if (i < BURN_IN) continue;
      const grifterPct = world.population > 0 ? world.grifters.length / world.population : 0;
      popSum += world.population;
      grifterPctSum += grifterPct;
      healthSum += world.economicHealth;
      const c = world.resources.cumulative;
      flourRatioSum += c.flourProduced > 0 ? c.flourConsumed / c.flourProduced : 1;
      n++;
    }
  }
  return { meanPop: popSum / n, meanGrifterFraction: grifterPctSum / n, meanHealth: healthSum / n, meanFlourRatio: flourRatioSum / n };
}

describe('population-capacity sweep: does the real engine reproduce the addendum\'s grifter-floor-breach concern when role-slot count scales with population?', () => {
  it('raising targetPopulation alone, with slot count held fixed, does NOT raise sustained single-shard population — the opportunity valve, not the config label, sets capacity', () => {
    // Real finding, not assumed: `targetPopulation` is one input among several to the
    // arrival/migration dynamics, not a population that gets manufactured regardless of
    // whether there are slots to support it. This is exactly why the addendum's toy model
    // (which treats population as simply equal to whatever figure it plugs in) diverges from
    // the real system.
    const baseline = measure({ ...DEFAULT_WORLD_CONFIG, targetPopulation: 65 });
    const higherTargetSameSlots = measure({ ...DEFAULT_WORLD_CONFIG, targetPopulation: 100 });
    expect(Math.abs(higherTargetSameSlots.meanPop - baseline.meanPop)).toBeLessThan(baseline.meanPop * 0.25);
  });

  it('scaling role-slot count up (holding the shipped 5:5:5:5:5:3 ratio) raises sustained population roughly proportionally, via the existing opportunity valve', () => {
    const baseline = measure(DEFAULT_WORLD_CONFIG);
    const scale = 100 / 65;
    const round = (n: number) => Math.max(1, Math.round(n * scale));
    const scaledConfig: WorldConfig = {
      ...DEFAULT_WORLD_CONFIG,
      targetPopulation: 100,
      rMiller: round(DEFAULT_WORLD_CONFIG.rMiller),
      rBaker: round(DEFAULT_WORLD_CONFIG.rBaker),
      rCourier: round(DEFAULT_WORLD_CONFIG.rCourier),
      rInvestigator: round(DEFAULT_WORLD_CONFIG.rInvestigator),
      rImportExport: round(DEFAULT_WORLD_CONFIG.rImportExport),
      shardConfig: {
        ...DEFAULT_WORLD_CONFIG.shardConfig,
        buildingsPerCoreDistrict: Math.round(DEFAULT_WORLD_CONFIG.shardConfig.buildingsPerCoreDistrict * scale),
        buildingsPerPeripheryDistrict: Math.round(DEFAULT_WORLD_CONFIG.shardConfig.buildingsPerPeripheryDistrict * scale),
      },
    };
    const scaled = measure(scaledConfig);
    expect(scaled.meanPop).toBeGreaterThan(baseline.meanPop * 1.3);
  });

  it('grifter fraction does NOT collapse toward the addendum-feared near-zero level when slot count scales up with population, in the real engine', () => {
    // The addendum's own toy-model table shows grifter% crashing to 10% then 4% at S=30/32
    // (a STATIC population assumption: grifters = fixedPop - slots). The real engine's
    // population responds dynamically to slot count (previous test), so grifter FRACTION
    // stays materially healthier than that — checked directly, not assumed from the toy
    // model's numbers.
    const scale = 100 / 65;
    const round = (n: number) => Math.max(1, Math.round(n * scale));
    const scaledConfig: WorldConfig = {
      ...DEFAULT_WORLD_CONFIG,
      targetPopulation: 100,
      rMiller: round(DEFAULT_WORLD_CONFIG.rMiller),
      rBaker: round(DEFAULT_WORLD_CONFIG.rBaker),
      rCourier: round(DEFAULT_WORLD_CONFIG.rCourier),
      rInvestigator: round(DEFAULT_WORLD_CONFIG.rInvestigator),
      rImportExport: round(DEFAULT_WORLD_CONFIG.rImportExport),
      shardConfig: {
        ...DEFAULT_WORLD_CONFIG.shardConfig,
        buildingsPerCoreDistrict: Math.round(DEFAULT_WORLD_CONFIG.shardConfig.buildingsPerCoreDistrict * scale),
        buildingsPerPeripheryDistrict: Math.round(DEFAULT_WORLD_CONFIG.shardConfig.buildingsPerPeripheryDistrict * scale),
      },
    };
    const scaled = measure(scaledConfig);
    expect(scaled.meanGrifterFraction).toBeGreaterThan(0.2); // real measured value ~0.37-0.38, asserting a safe floor below it
  });

  it('scaling slot count up never breaks flour-chain coherence — a real check the toy model has no way to run at all (it has no grain/flour chain)', () => {
    const scale = 100 / 65;
    const round = (n: number) => Math.max(1, Math.round(n * scale));
    const scaledConfig: WorldConfig = {
      ...DEFAULT_WORLD_CONFIG,
      targetPopulation: 100,
      rMiller: round(DEFAULT_WORLD_CONFIG.rMiller),
      rBaker: round(DEFAULT_WORLD_CONFIG.rBaker),
      rCourier: round(DEFAULT_WORLD_CONFIG.rCourier),
      rInvestigator: round(DEFAULT_WORLD_CONFIG.rInvestigator),
      rImportExport: round(DEFAULT_WORLD_CONFIG.rImportExport),
      shardConfig: {
        ...DEFAULT_WORLD_CONFIG.shardConfig,
        buildingsPerCoreDistrict: Math.round(DEFAULT_WORLD_CONFIG.shardConfig.buildingsPerCoreDistrict * scale),
        buildingsPerPeripheryDistrict: Math.round(DEFAULT_WORLD_CONFIG.shardConfig.buildingsPerPeripheryDistrict * scale),
      },
    };
    const scaled = measure(scaledConfig);
    expect(scaled.meanFlourRatio).toBeLessThan(1.05);
  });
});

describe('the addendum\'s cited "validated default" (M3/B7/IE2/C6/J5/D3=26) was stale — the shipped default is now the pop=100 jointGridSearch winner instead, not the addendum\'s numbers either', () => {
  it('districtRoleSweep.ts\'s "current illustrative default" label (the addendum\'s M3/B7/C6/J5/D3) is a swept STARTING candidate, not its recommended winner, and predates Import/Export entirely', () => {
    // districtRoleSweep.ts has no rImportExport field at all in its RoleSplit interface —
    // structurally proving it predates the 6th role, which jointGridSearch.ts (the sweep
    // that actually produced DEFAULT_WORLD_CONFIG, both at pop=65 and now pop=100) was built
    // to include.
    //
    // UPDATED 2026-08-13: this tripwire did its job — DEFAULT_WORLD_CONFIG changed (28->46
    // slots, targetPopulation 65->100), deliberately, per the user's own decision, to the
    // REAL jointGridSearch-at-pop=100 winner (`M9 B9 C7 J7 D8 IE6`, see world.ts's own
    // header for the full trail), NOT to the addendum's stale M3/B7/IE2/C6/J5/D3=26 either.
    // Values below updated to match; this test still exists to catch the NEXT silent change.
    expect(totalSlots(DEFAULT_WORLD_CONFIG)).toBe(46);
    expect(DEFAULT_WORLD_CONFIG.rMiller).toBe(9);
    expect(DEFAULT_WORLD_CONFIG.rBaker).toBe(9);
    expect(DEFAULT_WORLD_CONFIG.rCourier).toBe(7);
    expect(DEFAULT_WORLD_CONFIG.rInvestigator).toBe(15);
    expect(DEFAULT_WORLD_CONFIG.rImportExport).toBe(6);
    expect(DEFAULT_WORLD_CONFIG.targetPopulation).toBe(100);
    // The addendum's cited default (M3 B7 IE2 C6 J5 D3 = 26) still does NOT match the
    // shipped config — recorded as a live, structural tripwire: if DEFAULT_WORLD_CONFIG is
    // ever changed again (to the addendum's numbers or anything else) without a deliberate,
    // reviewed decision, this test's own values above will need updating, which is the
    // point — it can't happen silently.
  });
});
