import { describe, expect, it } from 'vitest';
import { ORACLE_ENTRY_COST, oracleWinProbability } from '../src/engine/oracle.js';
import {
  emptyOracleOpportunityState,
  expireOracleOpportunity,
  oracleOpportunityEscrow,
  ORACLE_VOUCHER_VALID_DAYS,
  resolveSocietyOracleEntry,
  type OracleOpportunityState,
  type SocietyOracleEntryInput,
} from '../src/engine/oracleOpportunities.js';
import { PERSONAL_RESOURCE_CAP } from '../src/engine/personalResourceStock.js';
import { mulberry32 } from '../src/sim/rng.js';

function input(overrides: Partial<SocietyOracleEntryInput> = {}): SocietyOracleEntryInput {
  return {
    actorId: 'baker-a', day: 1, mode: 'enter', economicHealthWithExperience: 0.96,
    wealth: 1, oraclePool: 0, isGrifter: false, personalResourceStock: 0,
    state: emptyOracleOpportunityState(), rand: () => 0.99, ...overrides,
  };
}

function rolls(...values: number[]): { rand: () => number; count: () => number } {
  let count = 0;
  return { rand: () => {
    const value = values[count++];
    if (value === undefined) throw new Error('Unexpected additional random draw');
    return value;
  }, count: () => count };
}

function winVoucher(overrides: Partial<SocietyOracleEntryInput> = {}) {
  const random = rolls(0.01, 0.99);
  const result = resolveSocietyOracleEntry(input({ ...overrides, rand: random.rand }));
  expect(result.prize).toBe('entryVoucher');
  expect(random.count()).toBe(2);
  return result;
}

describe('optional society Oracle opportunities', () => {
  it('backs a temporary prize with the real entry and redeems it once without personal wealth', () => {
    const awarded = winVoucher();
    expect(awarded.wealth).toBeCloseTo(1 - ORACLE_ENTRY_COST);
    expect(awarded.oraclePool).toBe(0);
    expect(awarded.state.voucher).toEqual({ kind: 'oracleEntry', ownerId: 'baker-a', awardedDay: 1,
      availableDay: 2, expiresAfterDay: 1 + ORACLE_VOUCHER_VALID_DAYS, escrow: ORACLE_ENTRY_COST });
    expect(oracleOpportunityEscrow([awarded.state])).toBe(ORACLE_ENTRY_COST);

    const random = rolls(0.99);
    const redeemed = resolveSocietyOracleEntry(input({ day: 2, mode: 'redeem', wealth: 0,
      state: awarded.state, oraclePool: awarded.oraclePool, rand: random.rand }));
    expect(redeemed.status).toBe('entered');
    expect(redeemed.fundedBy).toBe('voucher');
    expect(redeemed.won).toBe(false);
    expect(redeemed.wealth).toBe(0);
    expect(redeemed.oraclePool).toBe(ORACLE_ENTRY_COST);
    expect(redeemed.state.voucher).toBeNull();
    expect(random.count()).toBe(1);
    const repeat = resolveSocietyOracleEntry(input({ day: 2, mode: 'redeem', state: redeemed.state,
      oraclePool: redeemed.oraclePool, rand: random.rand }));
    expect(repeat.status).toBe('alreadyEntered');
    expect(random.count()).toBe(1);
  });

  it('expires without requiring participation and returns all unused escrow to the pool', () => {
    const awarded = winVoucher();
    const lastValid = expireOracleOpportunity(awarded.state, 'baker-a', 4, 0);
    expect(lastValid.state.voucher).not.toBeNull();
    expect(lastValid.expiredEscrow).toBe(0);
    const expired = expireOracleOpportunity(lastValid.state, 'baker-a', 5, 0);
    expect(expired.state.voucher).toBeNull();
    expect(expired.oraclePool).toBe(ORACLE_ENTRY_COST);
    expect(expired.expiredEscrow).toBe(ORACLE_ENTRY_COST);
    expect(expireOracleOpportunity(expired.state, 'baker-a', 6, expired.oraclePool).oraclePool).toBe(ORACLE_ENTRY_COST);
    expect(awarded.state.voucher).not.toBeNull();
  });

  it('does not silently charge wealth on redemption or spend a voucher on paid entry', () => {
    const noDraw = rolls();
    const absent = resolveSocietyOracleEntry(input({ mode: 'redeem', rand: noDraw.rand }));
    expect(absent.status).toBe('noVoucher');
    expect(absent.wealth).toBe(1);
    const awarded = winVoucher();
    const cannotPay = resolveSocietyOracleEntry(input({ day: 2, mode: 'enter', wealth: 0,
      state: awarded.state, rand: noDraw.rand }));
    expect(cannotPay.status).toBe('unaffordable');
    expect(cannotPay.state.voucher).toEqual(awarded.state.voucher);
    expect(noDraw.count()).toBe(0);
  });

  it('cannot stack or renew a held voucher by buying another entry', () => {
    const awarded = winVoucher();
    const random = rolls(0, 0.99);
    const another = resolveSocietyOracleEntry(input({ day: 2, state: awarded.state,
      oraclePool: awarded.oraclePool, wealth: awarded.wealth, rand: random.rand }));
    expect(another.prize).toBe('wealth');
    expect(another.prizeAmount).toBe(ORACLE_ENTRY_COST);
    expect(another.state.voucher).toEqual(awarded.state.voucher);
    expect(another.wealth).toBeCloseTo(awarded.wealth);
    expect(oracleOpportunityEscrow([another.state])).toBe(ORACLE_ENTRY_COST);
  });

  it('retains the exact health-linked win threshold for both payment methods', () => {
    const awarded = winVoucher();
    for (const health of [0, 0.5, 0.77, 0.96, 1]) {
      const probability = oracleWinProbability(health);
      for (const mode of ['enter', 'redeem'] as const) {
        const atThreshold = rolls(probability);
        const lost = resolveSocietyOracleEntry(input({ day: 2, mode, state: awarded.state,
          economicHealthWithExperience: health, rand: atThreshold.rand }));
        expect(lost.winProbability).toBe(probability);
        expect(lost.won).toBe(false);
        expect(atThreshold.count()).toBe(1);
        const belowThreshold = rolls(probability - 1e-8, 0);
        const won = resolveSocietyOracleEntry(input({ day: 2, mode, state: awarded.state,
          economicHealthWithExperience: health, rand: belowThreshold.rand }));
        expect(won.won).toBe(true);
        expect(belowThreshold.count()).toBe(2);
      }
    }
  });

  it('limits prizes to the current role stock and cap, with no stock prize for roleless inhabitants', () => {
    const stockWin = rolls(0, 0.5);
    const role = resolveSocietyOracleEntry(input({ personalResourceStock: PERSONAL_RESOURCE_CAP - 0.25,
      rand: stockWin.rand }));
    expect(role.prize).toBe('resourceStock');
    expect(role.prizeAmount).toBe(0.25);
    expect(role.personalResourceStock).toBe(PERSONAL_RESOURCE_CAP);
    const random = mulberry32(44);
    for (let day = 1; day <= 100; day++) {
      const roleless = resolveSocietyOracleEntry(input({ actorId: 'roleless', day,
        isGrifter: true, personalResourceStock: undefined, rand: random }));
      expect(roleless.prize).not.toBe('resourceStock');
      expect(roleless.personalResourceStock).toBeUndefined();
    }
  });

  it('rejects voucher transfer, rewound days, malformed balances and invalid RNG without mutating inputs', () => {
    const awarded = winVoucher();
    Object.freeze(awarded.state.voucher);
    Object.freeze(awarded.state);
    expect(() => resolveSocietyOracleEntry(input({ actorId: 'someone-else', day: 2,
      mode: 'redeem', state: awarded.state }))).toThrow(/transferred/);
    expect(() => resolveSocietyOracleEntry(input({ day: 0, state: awarded.state }))).toThrow(/backwards/);
    for (const bad of [NaN, Infinity, -1]) {
      expect(() => resolveSocietyOracleEntry(input({ wealth: bad }))).toThrow();
      expect(() => resolveSocietyOracleEntry(input({ oraclePool: bad }))).toThrow();
    }
    for (const bad of [NaN, Infinity, -1, 1]) {
      expect(() => resolveSocietyOracleEntry(input({ state: awarded.state, day: 2,
        rand: () => bad }))).toThrow(/random draw/);
    }
    expect(awarded.state.voucher?.escrow).toBe(ORACLE_ENTRY_COST);
    expect(awarded.state.lastEnteredDay).toBe(1);
  });

  it('is deterministic, identity-agnostic and conserves wealth including escrow over population draws', () => {
    const run = () => {
      const population = Array.from({ length: 64 }, (_, i) => ({
        id: `person-${i}`, wealth: 100, stock: i % 2 === 0 ? 0 : undefined,
        state: emptyOracleOpportunityState(),
      }));
      const random = mulberry32(20261025);
      let oraclePool = 0;
      let entered = 0;
      let wins = 0;
      let expectedWins = 0;
      let vouchersRedeemed = 0;
      let vouchersExpired = 0;
      for (let day = 1; day <= 80; day++) {
        const health = day % 20 < 10 ? 0.96 : 0.55;
        for (const [i, person] of population.entries()) {
          const expired = expireOracleOpportunity(person.state, person.id, day, oraclePool);
          person.state = expired.state;
          oraclePool = expired.oraclePool;
          vouchersExpired += expired.expiredEscrow > 0 ? 1 : 0;
          // A deterministic abstention policy uses no draw from the Oracle's stream.
          if ((day + i) % 3 === 0 || (i % 7 === 0 && day % 8 < 5)) continue;
          const mode = person.state.voucher ? 'redeem' : 'enter';
          const result = resolveSocietyOracleEntry(input({ actorId: person.id, day, mode,
            economicHealthWithExperience: health, wealth: person.wealth, oraclePool,
            isGrifter: person.stock === undefined, personalResourceStock: person.stock,
            state: person.state, rand: random }));
          person.wealth = result.wealth;
          person.stock = result.personalResourceStock;
          person.state = result.state;
          oraclePool = result.oraclePool;
          expect(person.wealth).toBeGreaterThanOrEqual(0);
          expect(oraclePool).toBeGreaterThanOrEqual(-1e-10);
          if (person.stock !== undefined) expect(person.stock).toBeLessThanOrEqual(PERSONAL_RESOURCE_CAP);
          if (result.status === 'entered') {
            entered++;
            expectedWins += result.winProbability;
            wins += result.won ? 1 : 0;
            vouchersRedeemed += result.fundedBy === 'voucher' ? 1 : 0;
          }
        }
        const wealth = population.reduce((sum, p) => sum + p.wealth, 0);
        const escrow = oracleOpportunityEscrow(population.map((p) => p.state));
        expect(wealth + oraclePool + escrow).toBeCloseTo(64 * 100, 8);
      }
      return { population, oraclePool, entered, wins, expectedWins, vouchersRedeemed, vouchersExpired };
    };
    const first = run();
    expect(run()).toEqual(first);
    expect(first.entered).toBeGreaterThan(2500);
    expect(first.vouchersRedeemed).toBeGreaterThan(0);
    expect(first.vouchersExpired).toBeGreaterThan(0);
    // Named balance check, not a quality grade: observed wins within five binomial SDs.
    expect(Math.abs(first.wins - first.expectedWins)).toBeLessThan(5 * Math.sqrt(first.expectedWins));

    const same = (actorId: string) => resolveSocietyOracleEntry(input({ actorId, rand: mulberry32(9) }));
    const a = same('a');
    const b = same('b');
    expect({ ...a, state: undefined }).toEqual({ ...b, state: undefined });
  });
});
