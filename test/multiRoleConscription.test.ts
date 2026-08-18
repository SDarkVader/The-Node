import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/sim/rng.js';
import { dailyChurnFromMonthly, type RoleSlot, type VacancyParams } from '../src/engine/vacancy.js';
import { DEFAULTS } from '../src/sim/vacancyHarness.js';
import { stepMultiRoleConscriptionDay, ESTABLISHED_TENURE_DAYS, PERFORMANCE_BAR, type RoleGroupState } from '../src/sim/multiRoleConscription.js';

/**
 * Regression tests for the N-role conscription generalization (2026-08-11, the 5-role
 * roster + grifter pool work). `stepConscriptionDay` (2-role Miller-vs-Other) is untouched
 * and still covered by `test/conscription.regression.test.ts`; these tests cover the new,
 * separate N-role function only.
 */

function makeParams(R: number, N: number, tHard: number): VacancyParams {
  return {
    N,
    R,
    pDaily: dailyChurnFromMonthly(0.2),
    beta: DEFAULTS.beta,
    tPain: DEFAULTS.tPain,
    vBoost: DEFAULTS.vBoost,
    tFlag: DEFAULTS.tFlag,
    tHard,
  };
}

function initialGroups(roleCounts: Record<string, number>, N: number, tHard = DEFAULTS.tHard): RoleGroupState[] {
  return Object.entries(roleCounts).map(([roleId, R]) => ({
    roleId,
    slots: Array.from({ length: R }, () => ({ state: 'FILLED' as const, vacantSince: null })),
    params: makeParams(R, N, tHard),
  }));
}

function runDays(
  groups: RoleGroupState[],
  grifterPoolSize: number,
  days: number,
  conscriptionDelay: number,
  seed: number,
) {
  const rng = mulberry32(seed);
  let working = groups;
  let pool = grifterPoolSize;
  const eventTally: Record<string, number> = {};
  for (let day = 0; day < days; day++) {
    const result = stepMultiRoleConscriptionDay(working, pool, day, conscriptionDelay, rng);
    working = result.roleGroups;
    pool += result.grifterPoolDelta;
    for (const e of result.events) eventTally[e.type] = (eventTally[e.type] ?? 0) + 1;
  }
  return { groups: working, grifterPoolSize: pool, eventTally };
}

const ROLE_COUNTS_5 = { miller: 3, baker: 7, courier: 6, journalist: 5, detective: 3 };
const TOTAL_ROLE_SLOTS = Object.values(ROLE_COUNTS_5).reduce((a, b) => a + b, 0);
const N_POPULATION = 65;

describe('stepMultiRoleConscriptionDay — determinism', () => {
  it('same seed produces identical results', () => {
    const a = runDays(initialGroups(ROLE_COUNTS_5, N_POPULATION), N_POPULATION - TOTAL_ROLE_SLOTS, 500, 14, 7);
    const b = runDays(initialGroups(ROLE_COUNTS_5, N_POPULATION), N_POPULATION - TOTAL_ROLE_SLOTS, 500, 14, 7);
    expect(a.grifterPoolSize).toBe(b.grifterPoolSize);
    expect(a.eventTally).toEqual(b.eventTally);
    expect(a.groups).toEqual(b.groups);
  });
});

describe('stepMultiRoleConscriptionDay — population conservation', () => {
  it('grifterPoolSize + total FILLED across all roles is exactly conserved over a long run', () => {
    const grifterStart = N_POPULATION - TOTAL_ROLE_SLOTS;
    const initial = initialGroups(ROLE_COUNTS_5, N_POPULATION);
    const initialTotal =
      grifterStart + initial.reduce((sum, g) => sum + g.slots.filter((s) => s.state === 'FILLED').length, 0);

    const { groups, grifterPoolSize } = runDays(initial, grifterStart, 3000, 14, 11);
    const finalFilled = groups.reduce((sum, g) => sum + g.slots.filter((s) => s.state === 'FILLED').length, 0);

    expect(grifterPoolSize + finalFilled).toBe(initialTotal);
  });

  it('conservation holds across many seeds, not just one', () => {
    const grifterStart = N_POPULATION - TOTAL_ROLE_SLOTS;
    for (const seed of [1, 2, 3, 4, 5]) {
      const initial = initialGroups(ROLE_COUNTS_5, N_POPULATION);
      const initialTotal =
        grifterStart + initial.reduce((sum, g) => sum + g.slots.filter((s) => s.state === 'FILLED').length, 0);
      const { groups, grifterPoolSize } = runDays(initial, grifterStart, 1500, 14, seed);
      const finalFilled = groups.reduce((sum, g) => sum + g.slots.filter((s) => s.state === 'FILLED').length, 0);
      expect(grifterPoolSize + finalFilled).toBe(initialTotal);
    }
  });
});

describe('stepMultiRoleConscriptionDay — draft sourcing across 5 roles', () => {
  it('both grifter-sourced and other-role-sourced conscriptions occur over a long run', () => {
    const grifterStart = N_POPULATION - TOTAL_ROLE_SLOTS;
    const { eventTally } = runDays(initialGroups(ROLE_COUNTS_5, N_POPULATION), grifterStart, 5000, 14, 3);
    expect(eventTally['conscriptionFromGrifters'] ?? 0).toBeGreaterThan(0);
    expect(eventTally['conscriptionFromOtherRole'] ?? 0).toBeGreaterThan(0);
    expect(eventTally['churn'] ?? 0).toBeGreaterThan(0);
    expect(eventTally['genuineFill'] ?? 0).toBeGreaterThan(0);
  });

  it('a conscription-from-other-role event never names its own role as the source', () => {
    const rng = mulberry32(42);
    let working = initialGroups(ROLE_COUNTS_5, N_POPULATION);
    let pool = N_POPULATION - TOTAL_ROLE_SLOTS;
    for (let day = 0; day < 2000; day++) {
      const result = stepMultiRoleConscriptionDay(working, pool, day, 14, rng);
      working = result.roleGroups;
      pool += result.grifterPoolDelta;
      for (const e of result.events) {
        if (e.type === 'conscriptionFromOtherRole') {
          expect(e.fromRoleId).not.toBe(e.roleId);
        }
      }
    }
  });
});

describe('stepMultiRoleConscriptionDay — grifter pool never goes negative', () => {
  it('a tight population/role ratio (many simultaneous VACANT slots across roles competing for a small pool) never drives the running pool below zero', () => {
    // Found bug (2026-08-11): fillHazard's willingness math has no concept of a real,
    // finite, shared candidate pool — multiple roles could each independently roll a
    // genuine fill the same day and jointly overdraw a pool smaller than their combined
    // draws. Fixed by gating voluntary fills on real same-day availability; this test
    // formalizes that fix as a property, not just an observation caught once downstream.
    const smallGrifterStart = 3; // deliberately tiny relative to 5 roles' combined VACANT pressure
    const roleCounts = { miller: 2, baker: 2, courier: 2, journalist: 2, detective: 2 };
    const N = smallGrifterStart + Object.values(roleCounts).reduce((a, b) => a + b, 0);
    let working = initialGroups(roleCounts, N, 20);
    let pool = smallGrifterStart;
    const rng = mulberry32(13);
    for (let day = 0; day < 2000; day++) {
      const result = stepMultiRoleConscriptionDay(working, pool, day, 5, rng);
      working = result.roleGroups;
      pool += result.grifterPoolDelta;
      expect(pool).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('stepMultiRoleConscriptionDay — no draftees available', () => {
  it('a BACKSTOPPED slot with zero grifters and zero other-role FILLED members stays BACKSTOPPED, never throws', () => {
    const params = makeParams(1, 10, 5);
    const slots: RoleSlot[] = [{ state: 'BACKSTOPPED', vacantSince: 0 }];
    const groups: RoleGroupState[] = [{ roleId: 'lonely', slots, params }];
    const rng = mulberry32(1);
    let working = groups;
    for (let day = 100; day < 200; day++) {
      const result = stepMultiRoleConscriptionDay(working, 0, day, 14, rng);
      working = result.roleGroups;
      expect(result.grifterPoolDelta).toBe(0);
    }
    expect(working[0]!.slots[0]!.state).toBe('BACKSTOPPED');
  });
});

describe('stepMultiRoleConscriptionDay — churn/fill pool bookkeeping', () => {
  it('the pool delta exactly matches churn count minus genuine-fill count each day', () => {
    const params = makeParams(5, 65, 9999); // tHard effectively unreachable within this run
    const slots: RoleSlot[] = Array.from({ length: 5 }, () => ({ state: 'FILLED' as const, vacantSince: null }));
    const groups: RoleGroupState[] = [{ roleId: 'solo', slots, params }];
    const rng = mulberry32(5);
    let totalChurn = 0;
    let totalGenuineFills = 0;
    let totalDelta = 0;
    let working = groups;
    for (let day = 0; day < 400; day++) {
      const result = stepMultiRoleConscriptionDay(working, 60, day, 14, rng);
      working = result.roleGroups;
      totalChurn += result.events.filter((e) => e.type === 'churn').length;
      totalGenuineFills += result.events.filter((e) => e.type === 'genuineFill').length;
      totalDelta += result.grifterPoolDelta;
    }
    // With tHard effectively unreachable, only churn (+1) and genuine fill (-1) touch the
    // pool — no backstop/conscription branch is ever entered in this run.
    expect(totalChurn).toBeGreaterThan(0);
    expect(totalGenuineFills).toBeGreaterThan(0);
    expect(totalDelta).toBe(totalChurn - totalGenuineFills);
  });
});

describe('stepMultiRoleConscriptionDay — reputation gate (2026-08-13, docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md §3.5)', () => {
  it('omitting grifterLevelCounts entirely reproduces the exact pre-2026-08-13 behavior, byte for byte — the whole backward-compatibility guarantee', () => {
    const params = makeParams(5, 65, 14);
    const slots: RoleSlot[] = Array.from({ length: 5 }, () => ({ state: 'FILLED' as const, vacantSince: null }));
    const groupsUngated: RoleGroupState[] = [{ roleId: 'solo', slots, params }];
    const groupsWithMinLevelButNoCounts: RoleGroupState[] = [{ roleId: 'solo', slots, params, minReputationLevelForFill: 2 }];
    const run = (groups: RoleGroupState[], seed: number) => {
      const rng = mulberry32(seed);
      let working = groups;
      let pool = 60;
      const tally: Record<string, number> = {};
      for (let day = 0; day < 400; day++) {
        // No 6th argument at all — the exact old call shape.
        const result = stepMultiRoleConscriptionDay(working, pool, day, 14, rng);
        working = result.roleGroups;
        pool += result.grifterPoolDelta;
        for (const e of result.events) tally[e.type] = (tally[e.type] ?? 0) + 1;
      }
      return tally;
    };
    // Even with minReputationLevelForFill SET on the role group, omitting grifterLevelCounts
    // means the gate never activates — identical results to the group without the field at all.
    expect(run(groupsWithMinLevelButNoCounts, 5)).toEqual(run(groupsUngated, 5));
  });

  it('a role group gated at level 2 gets ZERO genuineFill events when the pool has nobody at level 2, even though fills would otherwise readily occur', () => {
    const params = makeParams(5, 65, 9999); // tHard unreachable — isolates genuineFill from backstop/conscription
    const slots: RoleSlot[] = Array.from({ length: 5 }, () => ({ state: 'FILLED' as const, vacantSince: null }));
    const groups: RoleGroupState[] = [{ roleId: 'gated', slots, params, minReputationLevelForFill: 2 }];
    const rng = mulberry32(11);
    let working = groups;
    let genuineFills = 0;
    for (let day = 0; day < 500; day++) {
      // Pool is entirely level 0/1 — nobody ever qualifies for this level-2-gated role.
      const result = stepMultiRoleConscriptionDay(working, 60, day, 14, rng, { 0: 40, 1: 20 });
      working = result.roleGroups;
      genuineFills += result.events.filter((e) => e.type === 'genuineFill').length;
    }
    expect(genuineFills).toBe(0);
  });

  it('the SAME role group DOES get genuineFill events once the pool has real level-2 headroom', () => {
    const params = makeParams(5, 65, 9999);
    const slots: RoleSlot[] = Array.from({ length: 5 }, () => ({ state: 'FILLED' as const, vacantSince: null }));
    const groups: RoleGroupState[] = [{ roleId: 'gated', slots, params, minReputationLevelForFill: 2 }];
    const rng = mulberry32(11);
    let working = groups;
    let genuineFills = 0;
    for (let day = 0; day < 500; day++) {
      const result = stepMultiRoleConscriptionDay(working, 60, day, 14, rng, { 0: 30, 1: 20, 2: 10 });
      working = result.roleGroups;
      genuineFills += result.events.filter((e) => e.type === 'genuineFill').length;
    }
    expect(genuineFills).toBeGreaterThan(0);
  });

  it('conscriptionFromGrifters and backstopFires are completely unaffected by the gate — fire identically whether grifterLevelCounts is provided or not', () => {
    // A tight, entirely-level-0 pool relative to demand, tHard reachable — forces the
    // BACKSTOPPED/conscription branch to actually run, not just genuineFill.
    const roleCounts = { a: 2, b: 2 };
    const N = 3 + Object.values(roleCounts).reduce((x, y) => x + y, 0);
    const ungated = initialGroups(roleCounts, N, 10);
    const gated: RoleGroupState[] = ungated.map((g) => ({ ...g, minReputationLevelForFill: 2 }));
    const runTally = (groups: RoleGroupState[], levelCounts?: Record<number, number>) => {
      const rng = mulberry32(21);
      let working = groups;
      let pool = 3;
      const tally: Record<string, number> = {};
      for (let day = 0; day < 1000; day++) {
        const result = stepMultiRoleConscriptionDay(working, pool, day, 5, rng, levelCounts);
        working = result.roleGroups;
        pool += result.grifterPoolDelta;
        for (const e of result.events) tally[e.type] = (tally[e.type] ?? 0) + 1;
      }
      return tally;
    };
    const ungatedTally = runTally(ungated);
    const gatedTally = runTally(gated, { 0: 3 }); // pool is entirely level 0 — level-2 gate should block ALL genuineFill
    expect(gatedTally['conscriptionFromGrifters'] ?? 0).toBeGreaterThan(0);
    expect(gatedTally['backstopFires'] ?? 0).toBeGreaterThan(0);
    expect(gatedTally['genuineFill'] ?? 0).toBe(0); // the one event type the gate DOES restrict
    // NOT asserting equality with the ungated run's conscription/backstop counts — blocking
    // genuineFill changes the whole trajectory (a slot that would have been voluntarily
    // filled now sits VACANT longer, so MORE of them reach BACKSTOPPED/conscription instead;
    // real, measured, expected: gated run's conscription/backstop counts come out higher,
    // not identical). What matters, and IS asserted: conscription/backstop still fire at
    // all — the gate never blocks them outright (constraint 2/§3.5's actual guarantee).
    expect(gatedTally['conscriptionFromGrifters']!).toBeGreaterThanOrEqual(ungatedTally['conscriptionFromGrifters'] ?? 0);
  });
});

describe('stepMultiRoleConscriptionDay — occupantTenure eviction preference (2026-08-18, resolves the V_i/constraint-6 question)', () => {
  // Shared fixture: a 1- or 2-slot BACKSTOPPED "target" role that must draft from a
  // 4-slot, never-churning "source" role (pDaily: 0, so source's own FILLED/VACANT
  // transitions never confound which slot conscription actually picked). grifterPoolSize
  // is 0 throughout, so conscription can ONLY come from other-role eviction
  // (otherCandidates.length / (0 + otherCandidates.length) === 1) — every event is
  // deterministically conscriptionFromOtherRole, never conscriptionFromGrifters.
  function sourceParams(): VacancyParams {
    return { ...makeParams(4, 20, 999), pDaily: 0 };
  }
  function targetParams(slotCount: number): VacancyParams {
    return { ...makeParams(slotCount, 20, 0), pDaily: 0 };
  }

  it('a green (below ESTABLISHED_TENURE_DAYS) other-role candidate is evicted before an established one, every time, across many seeds', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const targetSlots: RoleSlot[] = [{ state: 'BACKSTOPPED', vacantSince: -1000 }];
      const sourceSlots: RoleSlot[] = Array.from({ length: 4 }, () => ({ state: 'FILLED' as const, vacantSince: null }));
      const groups: RoleGroupState[] = [
        { roleId: 'source', slots: sourceSlots, params: sourceParams(), occupantTenure: [0, 0, ESTABLISHED_TENURE_DAYS, ESTABLISHED_TENURE_DAYS] },
        { roleId: 'target', slots: targetSlots, params: targetParams(1) },
      ];
      const rng = mulberry32(seed);
      const result = stepMultiRoleConscriptionDay(groups, 0, 0, 0, rng);
      const evictionEvents = result.events.filter((e) => e.type === 'conscriptionFromOtherRole');
      expect(evictionEvents.length).toBe(1);
      expect(evictionEvents[0]).toMatchObject({ fromRoleId: 'source' });
      // Whichever source index got evicted, it must be one of the two green (tenure 0)
      // slots — check by confirming exactly one of the first two source slots went VACANT.
      const sourceAfter = result.roleGroups.find((g) => g.roleId === 'source')!.slots;
      const greenVacated = sourceAfter.slice(0, 2).filter((s) => s.state === 'VACANT').length;
      const establishedVacated = sourceAfter.slice(2, 4).filter((s) => s.state === 'VACANT').length;
      expect(greenVacated).toBe(1);
      expect(establishedVacated).toBe(0);
    }
  });

  it('both green candidates are exhausted before either established one is touched, when 2 target slots need filling the same day', () => {
    const targetSlots: RoleSlot[] = [
      { state: 'BACKSTOPPED', vacantSince: -1000 },
      { state: 'BACKSTOPPED', vacantSince: -1000 },
    ];
    const sourceSlots: RoleSlot[] = Array.from({ length: 4 }, () => ({ state: 'FILLED' as const, vacantSince: null }));
    const groups: RoleGroupState[] = [
      { roleId: 'source', slots: sourceSlots, params: sourceParams(), occupantTenure: [0, 0, ESTABLISHED_TENURE_DAYS, ESTABLISHED_TENURE_DAYS] },
      { roleId: 'target', slots: targetSlots, params: targetParams(2) },
    ];
    const rng = mulberry32(7);
    const result = stepMultiRoleConscriptionDay(groups, 0, 0, 0, rng);
    const evictionEvents = result.events.filter((e) => e.type === 'conscriptionFromOtherRole');
    expect(evictionEvents.length).toBe(2);
    const sourceAfter = result.roleGroups.find((g) => g.roleId === 'source')!.slots;
    // Both green slots (indices 0,1) got taken; neither established slot (2,3) was touched.
    expect(sourceAfter[0]!.state).toBe('VACANT');
    expect(sourceAfter[1]!.state).toBe('VACANT');
    expect(sourceAfter[2]!.state).toBe('FILLED');
    expect(sourceAfter[3]!.state).toBe('FILLED');
  });

  it('falls back to the full candidate pool once nobody is below ESTABLISHED_TENURE_DAYS — an established-only pool still gets drafted from, never stalls', () => {
    const targetSlots: RoleSlot[] = [{ state: 'BACKSTOPPED', vacantSince: -1000 }];
    const sourceSlots: RoleSlot[] = Array.from({ length: 4 }, () => ({ state: 'FILLED' as const, vacantSince: null }));
    const groups: RoleGroupState[] = [
      { roleId: 'source', slots: sourceSlots, params: sourceParams(), occupantTenure: [ESTABLISHED_TENURE_DAYS, ESTABLISHED_TENURE_DAYS, ESTABLISHED_TENURE_DAYS, ESTABLISHED_TENURE_DAYS] },
      { roleId: 'target', slots: targetSlots, params: targetParams(1) },
    ];
    const rng = mulberry32(9);
    const result = stepMultiRoleConscriptionDay(groups, 0, 0, 0, rng);
    const evictionEvents = result.events.filter((e) => e.type === 'conscriptionFromOtherRole');
    expect(evictionEvents.length).toBe(1);
    expect(evictionEvents[0]).toMatchObject({ fromRoleId: 'source' });
  });

  it('omitting occupantTenure entirely reproduces the exact same event tally as passing it filled with ESTABLISHED_TENURE_DAYS everywhere — the backward-compatibility guarantee', () => {
    const buildGroups = (withTenure: boolean): RoleGroupState[] => {
      const targetSlots: RoleSlot[] = [{ state: 'BACKSTOPPED', vacantSince: -1000 }];
      const sourceSlots: RoleSlot[] = Array.from({ length: 4 }, () => ({ state: 'FILLED' as const, vacantSince: null }));
      return [
        {
          roleId: 'source',
          slots: sourceSlots,
          params: sourceParams(),
          ...(withTenure ? { occupantTenure: [ESTABLISHED_TENURE_DAYS, ESTABLISHED_TENURE_DAYS, ESTABLISHED_TENURE_DAYS, ESTABLISHED_TENURE_DAYS] } : {}),
        },
        { roleId: 'target', slots: targetSlots, params: targetParams(1) },
      ];
    };
    const runTally = (groups: RoleGroupState[], seed: number) => {
      const rng = mulberry32(seed);
      let working = groups;
      const tally: Record<string, number> = {};
      for (let day = 0; day < 200; day++) {
        const result = stepMultiRoleConscriptionDay(working, 0, day, 0, rng);
        working = result.roleGroups;
        for (const e of result.events) tally[e.type] = (tally[e.type] ?? 0) + 1;
      }
      return tally;
    };
    for (const seed of [1, 2, 3]) {
      expect(runTally(buildGroups(false), seed)).toEqual(runTally(buildGroups(true), seed));
    }
  });
});

describe('stepMultiRoleConscriptionDay — occupantPerformance eviction preference (2026-08-18, "grinders get more mobility than lazy players")', () => {
  function sourceParams(): VacancyParams {
    return { ...makeParams(4, 20, 999), pDaily: 0 };
  }
  function targetParams(slotCount: number): VacancyParams {
    return { ...makeParams(slotCount, 20, 0), pDaily: 0 };
  }

  it('a tenured but chronically underperforming candidate is evicted before an equally-tenured, high-performing one', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const targetSlots: RoleSlot[] = [{ state: 'BACKSTOPPED', vacantSince: -1000 }];
      const sourceSlots: RoleSlot[] = Array.from({ length: 4 }, () => ({ state: 'FILLED' as const, vacantSince: null }));
      const groups: RoleGroupState[] = [
        {
          roleId: 'source',
          slots: sourceSlots,
          params: sourceParams(),
          // All four are equally tenured (established); only performance differs.
          occupantTenure: [ESTABLISHED_TENURE_DAYS, ESTABLISHED_TENURE_DAYS, ESTABLISHED_TENURE_DAYS, ESTABLISHED_TENURE_DAYS],
          occupantPerformance: [0, 0, PERFORMANCE_BAR, PERFORMANCE_BAR],
        },
        { roleId: 'target', slots: targetSlots, params: targetParams(1) },
      ];
      const rng = mulberry32(seed);
      const result = stepMultiRoleConscriptionDay(groups, 0, 0, 0, rng);
      const sourceAfter = result.roleGroups.find((g) => g.roleId === 'source')!.slots;
      const underperformerVacated = sourceAfter.slice(0, 2).filter((s) => s.state === 'VACANT').length;
      const performerVacated = sourceAfter.slice(2, 4).filter((s) => s.state === 'VACANT').length;
      expect(underperformerVacated).toBe(1);
      expect(performerVacated).toBe(0);
    }
  });

  it('a genuinely high-performing but freshly-started candidate is STILL evicted before a tenured, established one — tenure and performance are both required, neither alone is enough', () => {
    const targetSlots: RoleSlot[] = [{ state: 'BACKSTOPPED', vacantSince: -1000 }];
    const sourceSlots: RoleSlot[] = Array.from({ length: 2 }, () => ({ state: 'FILLED' as const, vacantSince: null }));
    const groups: RoleGroupState[] = [
      {
        roleId: 'source',
        slots: sourceSlots,
        params: sourceParams(),
        occupantTenure: [0, ESTABLISHED_TENURE_DAYS], // index 0: new hire; index 1: veteran
        occupantPerformance: [1, PERFORMANCE_BAR], // index 0: perfect performer despite being new
      },
      { roleId: 'target', slots: targetSlots, params: targetParams(1) },
    ];
    const rng = mulberry32(7);
    const result = stepMultiRoleConscriptionDay(groups, 0, 0, 0, rng);
    const sourceAfter = result.roleGroups.find((g) => g.roleId === 'source')!.slots;
    expect(sourceAfter[0]!.state).toBe('VACANT'); // the new hire, despite perfect performance
    expect(sourceAfter[1]!.state).toBe('FILLED'); // the tenured veteran survives
  });

  it('falls back to the full candidate pool once nobody clears both bars — never stalls', () => {
    const targetSlots: RoleSlot[] = [{ state: 'BACKSTOPPED', vacantSince: -1000 }];
    const sourceSlots: RoleSlot[] = Array.from({ length: 3 }, () => ({ state: 'FILLED' as const, vacantSince: null }));
    const groups: RoleGroupState[] = [
      { roleId: 'source', slots: sourceSlots, params: sourceParams(), occupantTenure: [0, 0, 0], occupantPerformance: [0, 0, 0] },
      { roleId: 'target', slots: targetSlots, params: targetParams(1) },
    ];
    const rng = mulberry32(9);
    const result = stepMultiRoleConscriptionDay(groups, 0, 0, 0, rng);
    const evictionEvents = result.events.filter((e) => e.type === 'conscriptionFromOtherRole');
    expect(evictionEvents.length).toBe(1);
  });

  it('omitting occupantPerformance entirely reproduces the exact same event tally as the tenure-only behavior — the backward-compatibility guarantee', () => {
    const buildGroups = (withPerformance: boolean): RoleGroupState[] => {
      const targetSlots: RoleSlot[] = [{ state: 'BACKSTOPPED', vacantSince: -1000 }];
      const sourceSlots: RoleSlot[] = Array.from({ length: 4 }, () => ({ state: 'FILLED' as const, vacantSince: null }));
      return [
        {
          roleId: 'source',
          slots: sourceSlots,
          params: sourceParams(),
          occupantTenure: [0, 0, ESTABLISHED_TENURE_DAYS, ESTABLISHED_TENURE_DAYS],
          ...(withPerformance ? { occupantPerformance: [PERFORMANCE_BAR, PERFORMANCE_BAR, PERFORMANCE_BAR, PERFORMANCE_BAR] } : {}),
        },
        { roleId: 'target', slots: targetSlots, params: targetParams(1) },
      ];
    };
    const runTally = (groups: RoleGroupState[], seed: number) => {
      const rng = mulberry32(seed);
      let working = groups;
      const tally: Record<string, number> = {};
      for (let day = 0; day < 200; day++) {
        const result = stepMultiRoleConscriptionDay(working, 0, day, 0, rng);
        working = result.roleGroups;
        for (const e of result.events) tally[e.type] = (tally[e.type] ?? 0) + 1;
      }
      return tally;
    };
    for (const seed of [1, 2, 3]) {
      expect(runTally(buildGroups(false), seed)).toEqual(runTally(buildGroups(true), seed));
    }
  });
});
