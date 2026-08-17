/**
 * Personal per-slot resource stock (2026-08-13). Closes the real gap
 * `docs/DESIGN_FINES_ECONOMY_2026-08-13.md` §1 flagged: `resources.ts` only tracks
 * SHARD-AGGREGATE flows (total flour milled today), not a personal balance any individual
 * role-holder can actually spend or trade toward a crafted item (Key, Firestarter, Theft
 * tool). Same slot/lifecycle convention `wealth` already uses on `RoleEconomicSlot`/
 * `SupportRoleSlot`: accrues while FILLED, resets to 0 the moment a slot gets a new
 * occupant.
 *
 * The cap (5) and refill cadence were independently proposed twice — the fines doc's own
 * "[ILLUSTRATIVE, not yet measured]: caps at a small number (e.g. 5)... refilling slowly
 * (e.g. +1 every few days)" and, separately, external design material's `UNIT_CAP = 5` —
 * real convergent agreement on the cap value, not just one guess. The refill cadence
 * remains genuinely unmeasured; `RESTOCK_INTERVAL_DAYS` is picked and labeled provisional,
 * not derived.
 */

/** [CALIBRATED — provisional, but independently converged on twice] max personal stock per slot. */
export const PERSONAL_RESOURCE_CAP = 5;

/** [CALIBRATED — provisional, not yet measured] days FILLED between each +1 restock. */
export const RESTOCK_INTERVAL_DAYS = 3;

export interface PersonalStockState {
  stock: number;
  daysSinceRestock: number;
}

export function emptyPersonalStock(): PersonalStockState {
  return { stock: 0, daysSinceRestock: 0 };
}

/**
 * One day's step for a FILLED slot's personal stock — pure, deterministic, no rng. Callers
 * only invoke this for slots that are FILLED today; a VACANT/BACKSTOPPED slot's stock
 * simply doesn't change, same as wealth freezing while nobody's there to earn it.
 */
export function stepPersonalStock(state: PersonalStockState): PersonalStockState {
  const daysSinceRestock = state.daysSinceRestock + 1;
  if (daysSinceRestock >= RESTOCK_INTERVAL_DAYS) {
    return { stock: Math.min(PERSONAL_RESOURCE_CAP, state.stock + 1), daysSinceRestock: 0 };
  }
  return { stock: state.stock, daysSinceRestock };
}
