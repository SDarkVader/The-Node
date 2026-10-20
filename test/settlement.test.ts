import { describe, expect, it } from 'vitest';
import { createWorld, createDormantWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World, type WorldConfig } from '../src/world/world.js';
import { applyStandingBerths } from '../src/engine/importExport.js';
import { settlementTolerance, totalIssued } from '../src/engine/settlement.js';
import { createMultiShardState, stepMultiShard, systemValue } from '../src/sim/multiShardHarness.js';
import type { RoleSlot } from '../src/engine/vacancy.js';

/**
 * Settlement ledger and standing berths (2026-10-20,
 * docs/DESIGN_SETTLEMENT_FLOW_BALANCE_2026-10-20.md). The invariant: every change to a
 * shard's total (holdings + accounts) is a named issuance line or an emigrant's carried
 * holdings — nothing is destroyed. Import/Export is never fully VACANT.
 */

function runChecking(world: World, ticks: number, check: (w: World) => void): World {
  let w = world;
  for (let i = 0; i < ticks; i++) {
    w = stepWorld(w);
    check(w);
  }
  return w;
}

const expectBalanced = (w: World) => {
  expect(Math.abs(w.lastSettlement.residual)).toBeLessThanOrEqual(settlementTolerance(w.lastSettlement));
};

describe('applyStandingBerths — pure rule', () => {
  const vacant = (since: number): RoleSlot => ({ state: 'VACANT', vacantSince: since });
  const filled: RoleSlot = { state: 'FILLED', vacantSince: null };

  it('lights exactly one berth when every slot is VACANT, keeping vacantSince', () => {
    const r = applyStandingBerths([vacant(4), vacant(5), vacant(6)], 1);
    expect(r.fired).toBe(1);
    expect(r.slots.map((s) => s.state)).toEqual(['BACKSTOPPED', 'VACANT', 'VACANT']);
    expect(r.slots[0]!.vacantSince).toBe(4);
  });

  it('does nothing when enough slots are already FILLED or BACKSTOPPED', () => {
    expect(applyStandingBerths([filled, vacant(1)], 1).fired).toBe(0);
    expect(applyStandingBerths([{ state: 'BACKSTOPPED', vacantSince: 2 }, vacant(1)], 1).fired).toBe(0);
  });

  it('tops up to minBerths, never past the slot count, and 0 disables it', () => {
    expect(applyStandingBerths([filled, vacant(1), vacant(1)], 2).fired).toBe(1);
    expect(applyStandingBerths([vacant(1), vacant(1)], 5).fired).toBe(2);
    expect(applyStandingBerths([vacant(1), vacant(1)], 0).fired).toBe(0);
  });
});

describe('settlement ledger — the flow-balance invariant holds every tick', () => {
  it('shipped config, several seeds, 1000 ticks', () => {
    for (const seed of [1, 2, 3]) runChecking(createWorld(seed), 1000, expectBalanced);
  });

  it('with the wealth tax and cap proposals switched on (their redistribution and overflow are accounted for)', () => {
    const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, wealthTaxRate: 0.2, wealthCap: 5 };
    let sawCapOverflow = false;
    runChecking(createWorld(4, config), 1000, (w) => {
      expectBalanced(w);
      if (w.settlement.districtPool > 0) sawCapOverflow = true;
    });
    expect(sawCapOverflow).toBe(true);
  });

  it('under high churn and small role counts', () => {
    const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, rMiller: 2, rBaker: 2, rCourier: 2, rInvestigator: 4, pMonthly: 0.9 };
    runChecking(createWorld(5, config), 800, expectBalanced);
  });

  it('in legacy settlement mode too', () => {
    runChecking(createWorld(2, { ...DEFAULT_WORLD_CONFIG, settlement: 'legacy' }), 1000, expectBalanced);
  });

  it('every issuance line is non-negative, and the totals actually move', () => {
    let issuedEver = 0;
    runChecking(createWorld(6), 300, (w) => {
      for (const v of Object.values(w.lastSettlement.issued)) expect(v).toBeGreaterThanOrEqual(0);
      issuedEver += totalIssued(w.lastSettlement.issued);
    });
    expect(issuedEver).toBeGreaterThan(0);
  });
});

describe('settlement ledger — nothing is destroyed', () => {
  it('the Oracle pool is never short: entries always cover wealth prizes', () => {
    runChecking(createWorld(7), 1500, (w) => {
      expect(w.lastSettlement.issued.oracleShortfall).toBe(0);
      expect(w.settlement.oraclePool).toBeGreaterThanOrEqual(0);
    });
  });

  it('legacy: balances a refill would have wiped land in the dock instead, and the dock only ever grows by forfeits in a single shard', () => {
    let forfeitedTotal = 0;
    const end = runChecking(createWorld(8, { ...DEFAULT_WORLD_CONFIG, settlement: 'legacy', pMonthly: 0.6 }), 1000, (w) => {
      forfeitedTotal += w.lastSettlement.forfeitedToDock;
    });
    expect(forfeitedTotal).toBeGreaterThan(0);
    expect(end.settlement.dock).toBeCloseTo(forfeitedTotal, 9);
  });

  it('every emigrant is reported with what they carried, one entry each', () => {
    let emigrants = 0;
    runChecking(createWorld(9), 1500, (w) => {
      expect(w.lastSettlement.emigrantHoldings.length).toBe(w.lastEmigrants);
      emigrants += w.lastEmigrants;
    });
    expect(emigrants).toBeGreaterThan(0);
  });
});

describe('funded settlement — wealth follows the person, the dock pays for nodules, upkeep is the sink', () => {
  const HIGH_CHURN: WorldConfig = { ...DEFAULT_WORLD_CONFIG, rMiller: 2, rBaker: 2, rCourier: 2, rInvestigator: 4, pMonthly: 0.9, conscriptionDelay: 3 };

  it('no balance is ever left behind at a role change: nothing is forfeited, even under heavy churn', () => {
    // Every departure (churn, conscription, sabotage, consolidation, emigration) takes the
    // balance with the person, so a slot is always empty when it's refilled — a new occupant
    // never inherits anyone else's balance, and nobody's savings vanish on taking a role.
    for (const seed of [1, 2, 3]) {
      runChecking(createWorld(seed, HIGH_CHURN), 800, (w) => {
        expect(w.lastSettlement.forfeitedToDock).toBe(0);
        expectBalanced(w);
      });
    }
  });

  it('a grifter who takes a role keeps their savings', () => {
    let checked = false;
    let w = createWorld(5, HIGH_CHURN);
    for (let i = 0; i < 400 && !checked; i++) {
      const before = w;
      w = stepWorld(w);
      const leftIds = before.grifters.filter((g) => !w.grifters.some((x) => x.id === g.id));
      const savings = leftIds.reduce((s, g) => s + g.wealth, 0);
      if (leftIds.length > 0 && savings > 1 && w.lastEmigrants === 0) {
        // Their savings are still in the shard: holdings + accounts moved only by what the
        // ledger says, and nothing went to the dock as a forfeit.
        expect(w.lastSettlement.forfeitedToDock).toBe(0);
        expectBalanced(w);
        checked = true;
      }
    }
    expect(checked).toBe(true);
  });

  it('upkeep never pushes anyone below zero, and the dock actually pays for nodules', () => {
    let drained = 0;
    runChecking(createWorld(6), 1000, (w) => {
      for (const s of [...w.millers, ...w.bakers, ...w.couriers, ...w.investigators, ...w.importExporters, ...w.grifters]) {
        expect(s.wealth).toBeGreaterThanOrEqual(0);
      }
      expect(w.lastSettlement.upkeepToDock).toBeGreaterThanOrEqual(0);
      drained += w.lastSettlement.dockToNodules;
    });
    expect(drained).toBeGreaterThan(0);
  });

  it('new money falls far below legacy once the loop is running', () => {
    const steadyIssuance = (config: WorldConfig) => {
      let w = createWorld(3, config);
      let total = 0;
      for (let i = 0; i < 1500; i++) {
        w = stepWorld(w);
        if (i >= 500) total += totalIssued(w.lastSettlement.issued);
      }
      return total / 1000;
    };
    const funded = steadyIssuance(DEFAULT_WORLD_CONFIG);
    const legacy = steadyIssuance({ ...DEFAULT_WORLD_CONFIG, settlement: 'legacy' });
    expect(funded).toBeLessThan(legacy * 0.25);
  });

  it('when the pool is starved, the grifter floor is still paid in full — the shortfall is named, never skipped', () => {
    // One Import/Export slot: nodule value can't cover the wage bill, so wages pro-rate.
    const starved: WorldConfig = { ...DEFAULT_WORLD_CONFIG, rImportExport: 1 };
    let sawProRating = false;
    runChecking(createWorld(4, starved), 600, (w) => {
      const s = w.lastSettlement;
      expect(s.wageScale).toBeLessThanOrEqual(1);
      if (s.wageScale < 1) sawProRating = true;
      // The floor is paid in full every tick; any part the pool couldn't cover is issued
      // as floorShortfall, which can never exceed the floor itself.
      expect(s.issued.floorShortfall).toBeGreaterThanOrEqual(0);
      expect(s.issued.floorShortfall).toBeLessThanOrEqual(s.paid.grifterFloor + 1e-9);
      expectBalanced(w);
    });
    expect(sawProRating).toBe(true);
  });

  it('the Oracle pool is swept to the dock every tick, so it never accumulates', () => {
    runChecking(createWorld(7), 500, (w) => expect(w.settlement.oraclePool).toBe(0));
  });
});

describe('standing berths — Import/Export is never fully dark', () => {
  const lit = (w: World) => w.importExporters.filter((x) => x.slot.state !== 'VACANT').length;
  const nodulesToday = (w: World) => w.lastImportExportWindows.reduce((s, e) => s + e.nodulesReceived, 0);

  it('at least one Import/Export slot is FILLED or BACKSTOPPED at the end of every tick, under heavy churn', () => {
    const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, rImportExport: 2, pMonthly: 0.95 };
    for (const seed of [1, 2, 3]) {
      runChecking(createWorld(seed, config), 800, (w) => {
        expect(lit(w)).toBeGreaterThanOrEqual(1);
        expect(nodulesToday(w)).toBeGreaterThan(0);
      });
    }
  });

  it('a dormant shard issues nodules from its very first tick (it used to issue 0 until the backstop fired)', () => {
    const w = stepWorld(createDormantWorld(11, DEFAULT_WORLD_CONFIG));
    expect(w.lastStandingBerthsFired).toBeGreaterThanOrEqual(1);
    expect(nodulesToday(w)).toBeGreaterThan(0);
  });

  it('standingBerths: 0 restores the old all-dark gap', () => {
    const w = stepWorld(createDormantWorld(11, { ...DEFAULT_WORLD_CONFIG, standingBerths: 0 }));
    expect(w.lastStandingBerthsFired).toBe(0);
    expect(nodulesToday(w)).toBe(0);
  });
});

describe('transit vouchers — the system-wide total changes only by issuance', () => {
  it('across every shard, through migration, failed crossings and dormant shards opening', () => {
    let state = createMultiShardState(3, DEFAULT_WORLD_CONFIG);
    let sawArrival = false;
    let sawDock = false;
    for (let day = 0; day < 1500; day++) {
      const before = systemValue(state);
      state = stepMultiShard(state);
      const issuedToday = [...state.worlds.values()].reduce((s, w) => s + totalIssued(w.lastSettlement.issued), 0);
      const v = state.lastVoucherSettlement;
      expect(v.carried).toBeCloseTo(v.arrived + v.toDock, 9);
      if (v.arrived > 0) sawArrival = true;
      if (v.toDock > 0) sawDock = true;
      const after = systemValue(state);
      expect(Math.abs(after - before - issuedToday)).toBeLessThanOrEqual(1e-9 * Math.max(1, after));
    }
    expect(sawArrival).toBe(true);
    expect(sawDock).toBe(true);
  });
});
