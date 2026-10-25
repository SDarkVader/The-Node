/**
 * Opt-in, explicit participation for the agent society. The legacy daily Oracle and its
 * RNG stream are unchanged. Society prizes use the existing weighted table, substituting
 * an expiring prepaid entry for the legacy permanent tenure nudge.
 *
 * A voucher is a claim on actual reserved wealth, not another currency. Its escrow must
 * be included in the society's accounts; it moves back to oraclePool on redemption or
 * expiry. The same health-linked draw then runs, with no guaranteed outcome or role grant.
 */
import {
  ORACLE_ENTRY_COST,
  ORACLE_RESOURCE_STOCK_PRIZE_AMOUNT,
  ORACLE_WEALTH_PRIZE_AMOUNT,
  oracleWinProbability,
  pickPrizeType,
} from './oracle.js';
import { PERSONAL_RESOURCE_CAP } from './personalResourceStock.js';

/** Provisional, owner-authorised temporary-opportunity duration: next three days. */
export const ORACLE_VOUCHER_VALID_DAYS = 3;

export interface OracleEntryVoucher {
  kind: 'oracleEntry';
  ownerId: string;
  awardedDay: number;
  availableDay: number;
  /** Inclusive. The voucher expires before entries on the following day. */
  expiresAfterDay: number;
  escrow: number;
}

export interface OracleOpportunityState {
  lastEnteredDay: number | null;
  /** At most one voucher per person; it is personal and cannot be transferred. */
  voucher: OracleEntryVoucher | null;
}

export type SocietyOraclePrize = 'wealth' | 'resourceStock' | 'entryVoucher';

export interface SocietyOracleEntryInput {
  actorId: string;
  day: number;
  /** Explicit intent: redemption never falls back to charging personal wealth. */
  mode: 'enter' | 'redeem';
  economicHealthWithExperience: number;
  wealth: number;
  oraclePool: number;
  isGrifter: boolean;
  /** Absent for roleless inhabitants. Only the inhabitant's current role stock is eligible. */
  personalResourceStock?: number;
  state: OracleOpportunityState;
  rand: () => number;
}

export interface SocietyOracleEntryResult {
  state: OracleOpportunityState;
  wealth: number;
  oraclePool: number;
  personalResourceStock?: number;
  status: 'entered' | 'alreadyEntered' | 'unaffordable' | 'noVoucher' | 'voucherNotAvailable';
  won: boolean;
  prize: SocietyOraclePrize | null;
  prizeAmount: number;
  fundedBy: 'wealth' | 'voucher' | null;
  winProbability: number;
  expiredEscrow: number;
}

/** Public rules contain no private holdings or hidden decisions. */
export const SOCIETY_ORACLE_RULES = Object.freeze({
  entryCost: ORACLE_ENTRY_COST,
  maxEntriesPerDay: 1,
  voucherValidDays: ORACLE_VOUCHER_VALID_DAYS,
  maxVouchersHeld: 1,
  wealthPrize: ORACLE_WEALTH_PRIZE_AMOUNT,
  resourceStockPrize: ORACLE_RESOURCE_STOCK_PRIZE_AMOUNT,
  personalResourceCap: PERSONAL_RESOURCE_CAP,
  description: 'Participation is optional. The public health-linked chance applies equally to everyone. '
    + 'A win selects one equally weighted eligible prize: wealth, current-role resource stock '
    + '(role holders only), or a prepaid Oracle entry valid on the next three days. '
    + 'A prepaid entry pays the ordinary entry cost and has the same chance of losing. '
    + 'Vouchers cannot be traded, stacked, or used twice; unused escrow returns to the pool on expiry. '
    + 'A voucher prize while one is held pays the bounded wealth prize instead and never extends its expiry. '
    + 'No prize grants a role, reputation, permanent tenure, or eligibility exemption.',
});

export function emptyOracleOpportunityState(): OracleOpportunityState {
  return { lastEnteredDay: null, voucher: null };
}

function nonnegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid Oracle ${name}`);
}

function validDay(day: number): void {
  if (!Number.isSafeInteger(day) || day < 0 || day > Number.MAX_SAFE_INTEGER - ORACLE_VOUCHER_VALID_DAYS) {
    throw new RangeError('Invalid Oracle day');
  }
}

function validateState(state: OracleOpportunityState, actorId: string, day: number): void {
  validDay(day);
  if (!actorId || typeof actorId !== 'string') throw new TypeError('Invalid Oracle actor');
  if (state.lastEnteredDay !== null) {
    validDay(state.lastEnteredDay);
    if (state.lastEnteredDay > day) throw new RangeError('Oracle day cannot move backwards');
  }
  const voucher = state.voucher;
  if (!voucher) return;
  validDay(voucher.awardedDay);
  validDay(voucher.availableDay);
  validDay(voucher.expiresAfterDay);
  if (voucher.kind !== 'oracleEntry' || voucher.ownerId !== actorId
    || voucher.escrow !== ORACLE_ENTRY_COST
    || voucher.availableDay !== voucher.awardedDay + 1
    || voucher.expiresAfterDay !== voucher.awardedDay + ORACLE_VOUCHER_VALID_DAYS
    || voucher.awardedDay > day
    || state.lastEnteredDay === null || state.lastEnteredDay < voucher.awardedDay) {
    throw new RangeError('Invalid or transferred Oracle voucher');
  }
}

/** Runs without RNG and without charging anyone, including on days they abstain. */
export function expireOracleOpportunity(
  state: OracleOpportunityState,
  actorId: string,
  day: number,
  oraclePool: number,
): { state: OracleOpportunityState; oraclePool: number; expiredEscrow: number } {
  validateState(state, actorId, day);
  nonnegativeFinite(oraclePool, 'pool');
  if (state.voucher && day > state.voucher.expiresAfterDay) {
    return {
      state: { ...state, voucher: null },
      oraclePool: oraclePool + state.voucher.escrow,
      expiredEscrow: state.voucher.escrow,
    };
  }
  return { state: { ...state, voucher: state.voucher ? { ...state.voucher } : null }, oraclePool, expiredEscrow: 0 };
}

/** Wealth held outside oraclePool to back outstanding vouchers. Include it in accounting. */
export function oracleOpportunityEscrow(states: readonly OracleOpportunityState[]): number {
  let total = 0;
  for (const state of states) {
    if (!state.voucher) continue;
    if (state.voucher.escrow !== ORACLE_ENTRY_COST) throw new RangeError('Invalid Oracle escrow');
    total += state.voucher.escrow;
  }
  return total;
}

/**
 * Executes an inhabitant's chosen entry, not a probability of choosing to enter. Call once
 * the ordinary legal-action validator has accepted the action. Ineligible/duplicate entries
 * consume zero random draws. Valid entries consume one win draw and winners one prize draw.
 * All inputs are immutable; malformed state or RNG output throws before a result is committed.
 */
export function resolveSocietyOracleEntry(input: SocietyOracleEntryInput): SocietyOracleEntryResult {
  const { actorId, day, state, isGrifter } = input;
  if (input.mode !== 'enter' && input.mode !== 'redeem') throw new TypeError('Invalid Oracle participation mode');
  nonnegativeFinite(input.wealth, 'wealth');
  nonnegativeFinite(input.oraclePool, 'pool');
  if (!Number.isFinite(input.economicHealthWithExperience)) throw new RangeError('Invalid Oracle health');
  if (!isGrifter && input.personalResourceStock === undefined) throw new RangeError('Role holder has no Oracle stock account');
  if (input.personalResourceStock !== undefined) {
    nonnegativeFinite(input.personalResourceStock, 'resource stock');
    if (input.personalResourceStock > PERSONAL_RESOURCE_CAP) throw new RangeError('Oracle stock exceeds cap');
  }
  const expired = expireOracleOpportunity(state, actorId, day, input.oraclePool);
  const result: SocietyOracleEntryResult = {
    ...expired,
    wealth: input.wealth,
    ...(input.personalResourceStock === undefined ? {} : { personalResourceStock: input.personalResourceStock }),
    status: 'entered', won: false, prize: null, prizeAmount: 0, fundedBy: null,
    winProbability: oracleWinProbability(input.economicHealthWithExperience),
  };
  if (result.state.lastEnteredDay === day) return { ...result, status: 'alreadyEntered' };
  const voucher = result.state.voucher;
  const redeem = input.mode === 'redeem';
  if (redeem && voucher === null) return { ...result, status: 'noVoucher' };
  if (redeem && voucher !== null && day < voucher.availableDay) return { ...result, status: 'voucherNotAvailable' };
  if (!redeem && result.wealth < ORACLE_ENTRY_COST) return { ...result, status: 'unaffordable' };

  if (redeem) {
    result.oraclePool += voucher!.escrow;
    result.state.voucher = null;
    result.fundedBy = 'voucher';
  } else {
    result.wealth -= ORACLE_ENTRY_COST;
    result.oraclePool += ORACLE_ENTRY_COST;
    result.fundedBy = 'wealth';
  }
  result.state.lastEnteredDay = day;
  const checkedRand = () => {
    const roll = input.rand();
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError('Invalid Oracle random draw');
    return roll;
  };
  if (checkedRand() >= result.winProbability) return result;
  result.won = true;
  const prize = pickPrizeType(isGrifter, checkedRand);
  if (prize === 'wealth' || (prize === 'time' && result.state.voucher !== null)) {
    // The entry arrived first, and this bounded prize never exceeds it.
    result.oraclePool -= ORACLE_WEALTH_PRIZE_AMOUNT;
    result.wealth += ORACLE_WEALTH_PRIZE_AMOUNT;
    result.prize = 'wealth';
    result.prizeAmount = ORACLE_WEALTH_PRIZE_AMOUNT;
  } else if (prize === 'resourceStock') {
    const stock = result.personalResourceStock!;
    result.personalResourceStock = Math.min(PERSONAL_RESOURCE_CAP, stock + ORACLE_RESOURCE_STOCK_PRIZE_AMOUNT);
    result.prize = 'resourceStock';
    result.prizeAmount = result.personalResourceStock - stock;
  } else {
    result.oraclePool -= ORACLE_ENTRY_COST;
    result.state.voucher = {
      kind: 'oracleEntry', ownerId: actorId, awardedDay: day, availableDay: day + 1,
      expiresAfterDay: day + ORACLE_VOUCHER_VALID_DAYS, escrow: ORACLE_ENTRY_COST,
    };
    result.prize = 'entryVoucher';
    result.prizeAmount = ORACLE_ENTRY_COST;
  }
  return result;
}
