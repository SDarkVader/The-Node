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
 *   - In 'legacy' mode, balances left behind at a role transition land in `dock`: a slot's
 *     previous occupant's balance, which the refill reset used to wipe, and a grifter's
 *     savings when they take a role. In 'funded' mode these follow the person instead and the
 *     refill forfeit is a safety net that should read 0. A failed crossing's carried holdings
 *     land in the source dock in both modes (see multiShardHarness.ts). The dock is where
 *     "deductions return as nodules" (DESIGN_ADDENDUM_2026-08-11 §5): in 'funded' mode it
 *     pays for each tick's nodules; in 'legacy' mode it only accumulates.
 *
 * Per tick:
 *   (holdingsAfter + accountsAfter) − (holdingsBefore + accountsBefore)
 *     = Σ issued − Σ emigrantHoldings
 * `residual` is the difference between the two sides, and is 0 up to float error.
 *
 * Two modes (`WorldConfig.settlement`):
 *
 * 'legacy' — the economy as it was: every income line is issued by the system, and wealth does
 * not follow a person through a role change (it lands in the dock). Byte-identical to the
 * pre-settlement trajectory; kept for before/after measurement.
 *
 * 'funded' (default, 2026-10-20, user directive: "make wealth follow the person through role
 * changes, and drain the dock back as nodules at a funded rate") — the closed loop of
 * DESIGN_ADDENDUM_2026-08-11 §5:
 *
 *   holdings --upkeep--> dock --pays for nodules--> districtPool --wages--> holdings
 *
 *   - Wealth follows the person through every role change.
 *   - Each tick's nodules are worth WEALTH_PER_NODULE each. That value goes into
 *     `districtPool`, paid out of the dock first; only what the dock can't cover is new
 *     money (issuance line `nodules`). Draining the dock is the RETURN path, not a sink.
 *   - The sink is upkeep: every person pays UPKEEP_RATE of their holdings into the dock each
 *     tick. Proportional, so it can never push anyone below zero (constraint 2). Oracle
 *     entries (net of prizes) are swept into the dock at the end of each tick too.
 *   - Wages are paid out of `districtPool`: the grifter floor first (constraint 2 — any
 *     shortfall is issued as `floorShortfall`, named and reported, never skipped), then role
 *     incomes pro-rata, then Shift Cover and support completion rewards pro-rata from what's
 *     left. Pool balance above DISTRICT_POOL_RESERVE_DAYS of nodule value returns to the dock.
 *
 *   In steady state upkeep refills the dock about as fast as nodules drain it, so new money
 *   (`nodules` + `floorShortfall`) tends to zero and holdings settle where income = upkeep.
 */

/** Wealth each nodule brings into `districtPool`. [CALIBRATED — `npm run settlement-report`
 *  measured legacy issuance / nodules = 2.02, so the funded loop pays roughly what the
 *  economy paid before.] */
export const WEALTH_PER_NODULE = 2.0;
/** Share of holdings each person pays into the dock per tick. [CALIBRATED — chosen so funded
 *  steady-state total holdings match legacy's, keeping the scoreboard's scale: legacy mean
 *  4407, funded at 0.0073 → 4383 (4 seeds × 3000 days, burn-in 500). Holdings scale roughly
 *  with 1/UPKEEP_RATE; see `npm run settlement-report`.] */
export const UPKEEP_RATE = 0.0073;
/** `districtPool` keeps up to this many ticks of nodule value as a wage reserve; anything
 *  above returns to the dock. [ILLUSTRATIVE] */
export const DISTRICT_POOL_RESERVE_DAYS = 7;

export type SettlementMode = 'funded' | 'legacy';
export const SETTLEMENT_MODE_DEFAULT: SettlementMode = 'funded';

/** What each income line paid out. In 'legacy' mode each is also an issuance line; in
 *  'funded' mode they are transfers out of `districtPool`. */
export const PAY_LINES = ['millerBakerIncome', 'completion', 'courierPay', 'supportWage', 'grifterFloor', 'shiftCover'] as const;
export type PayLine = (typeof PAY_LINES)[number];

export const ISSUANCE_LINES = [...PAY_LINES, 'oracleShortfall', 'nodules', 'floorShortfall'] as const;
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
  /** What each income line actually paid out this tick (after any pro-rating). */
  paid: Record<PayLine, number>;
  /** 'funded' only: share of role incomes the pool could cover (1 = paid in full). */
  wageScale: number;
  /** 'funded' only: dock → districtPool to pay for today's nodules. */
  dockToNodules: number;
  /** 'funded' only: holdings → dock as upkeep. */
  upkeepToDock: number;
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

export function emptyPaid(): Record<PayLine, number> {
  return Object.fromEntries(PAY_LINES.map((l) => [l, 0])) as Record<PayLine, number>;
}

export function emptySettlementTick(): SettlementTick {
  return {
    issued: emptyIssuance(),
    paid: emptyPaid(),
    wageScale: 1,
    dockToNodules: 0,
    upkeepToDock: 0,
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
