import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/sim/rng.js';
import { dailyChurnFromMonthly, type RoleSlot, type VacancyParams } from '../src/engine/vacancy.js';
import { DEFAULTS } from '../src/sim/vacancyHarness.js';
import { stepMultiRoleConscriptionDay, type RoleGroupState } from '../src/sim/multiRoleConscription.js';

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
