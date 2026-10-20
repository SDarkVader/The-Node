/**
 * Settlement ledger (2026-10-20, docs/DESIGN_SETTLEMENT_FLOW_BALANCE_2026-10-20.md). Makes the
 * flow-balance invariant real: every change to the total amount of wealth in a shard is either
 * a named issuance line or a named cross-shard movement, and nothing is ever destroyed. What
 * used to vanish now lands in an account:
 *
 *   - Oracle entry costs fund `oraclePool`, and Oracle wealth prizes are paid out of it
 *     (solvent by construction: an entrant pays the entry before they can win, and the
 *     prize never exceeds the entry).
 *   - Wealth-cap overflow that `applyWealthCap` used to discard lands in `districtPool`.
 *   - Balances left behind at a role transition land in `dock`: a slot's previous
 *     occupant's balance, which the refill reset used to wipe, and a grifter's savings when
 *     they take a role (the slot starts at 0 and the grifter record is removed). A failed
 *     crossing's carried holdings land there too (see multiShardHarness.ts). Wealth staying
 *     with the person through a role change is the next behaviour change, deliberately not
 *     made here — this module only stops it vanishing, so trajectories stay byte-identical.
 *     The dock is where "deductions return as nodules" (DESIGN_ADDENDUM_2026-08-11 §5) will
 *     drain from once issuance is funded through it. Until then it only accumulates, and
 *     that is reported, not hidden.
 *
 * Per tick:
 *   (holdingsAfter + accountsAfter) − (holdingsBefore + accountsBefore)
 *     = Σ issued − Σ emigrantHoldings
 * `residual` is the difference between the two sides, and is 0 up to float error.
 *
 * What this does NOT do yet, deliberately: fund issuance from nodules. Every income line is
 * still issued by the system, exactly as before — the ledger names each one so the next step
 * (a per-nodule rate `k` paying wages out of `districtPool`, floor first) can be calibrated
 * from measured magnitudes rather than guessed. Trajectories are unchanged by the ledger itself.
 */

export const ISSUANCE_LINES = [
  'millerBakerIncome',
  'completion',
  'courierPay',
  'supportWage',
  'grifterFloor',
  'shiftCover',
  'oracleShortfall',
] as const;
export type IssuanceLine = (typeof ISSUANCE_LINES)[number];

export interface SettlementAccounts {
  /** Wealth-cap overflow. */
  districtPool: number;
  /** Oracle entry costs, minus wealth prizes paid out. */
  oraclePool: number;
  /** Balances left with nobody to hold them: refill forfeits and failed crossings. */
  dock: number;
}

export interface SettlementTick {
  issued: Record<IssuanceLine, number>;
  /** One entry per emigrant this tick, in emigration order: what they carried out. */
  emigrantHoldings: number[];
  /** What refill resets moved into the dock this tick (part of the dock's increase). */
  forfeitedToDock: number;
  holdingsBefore: number;
  holdingsAfter: number;
  accountsBefore: number;
  accountsAfter: number;
  /** (after − before) − (Σ issued − Σ emigrantHoldings). 0 up to float error. */
  residual: number;
}

export function emptySettlementAccounts(): SettlementAccounts {
  return { districtPool: 0, oraclePool: 0, dock: 0 };
}

export function emptyIssuance(): Record<IssuanceLine, number> {
  return Object.fromEntries(ISSUANCE_LINES.map((l) => [l, 0])) as Record<IssuanceLine, number>;
}

export function emptySettlementTick(): SettlementTick {
  return {
    issued: emptyIssuance(),
    emigrantHoldings: [],
    forfeitedToDock: 0,
    holdingsBefore: 0,
    holdingsAfter: 0,
    accountsBefore: 0,
    accountsAfter: 0,
    residual: 0,
  };
}

export function accountsTotal(a: SettlementAccounts): number {
  return a.districtPool + a.oraclePool + a.dock;
}

/** Every person's wealth, wherever it sits: each role slot in ANY state, plus every grifter. */
export function totalHoldings(groups: readonly (readonly { wealth: number }[])[]): number {
  let total = 0;
  for (const g of groups) for (const s of g) total += s.wealth;
  return total;
}

export function totalIssued(issued: Record<IssuanceLine, number>): number {
  return ISSUANCE_LINES.reduce((sum, l) => sum + issued[l], 0);
}

/** Tolerance for the residual: relative to the magnitude of the balances involved. */
export function settlementTolerance(t: SettlementTick): number {
  return 1e-9 * Math.max(1, t.holdingsAfter + t.accountsAfter + t.holdingsBefore + t.accountsBefore);
}
