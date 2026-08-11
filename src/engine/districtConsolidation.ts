/**
 * District consolidation (2026-08-11, user-specified — direct answer to the
 * population-collapse finding in docs/BLUEPRINT.md's "5-role roster" entry). Pure,
 * dependency-free, same style as every other `src/engine/` module.
 *
 * Trigger direction, stated precisely because it's easy to get backwards: consolidation
 * fires on UNDERpopulation, not overcrowding — "in the case of under population, once
 * passed a tipping point can't be reversed" (user's own words). A district whose FILLED
 * role-slot fraction drops below `DISTRICT_TIPPING_POINT_FILLED_FRACTION` starts a
 * `CONSOLIDATION_GRACE_DAYS`-day countdown (14 days — a deliberate echo of the existing
 * `conscriptionDelay` default) before merging permanently. The ratchet is one-way by
 * design: once CONSOLIDATING or MERGED, a later recovery in `filledFraction` does not
 * revert the state. This is the mechanism; `world.ts` is where it gets wired to real
 * districts, role-slot eviction, and the "excess players get 2 weeks to pick a role or be
 * drafted" consequence.
 *
 * Trade-route friction (`consolidationFrictionMultiplier`) is the "cracks forming"
 * visibility the user asked for: access degrades smoothly across the grace period, not as
 * a silent flip at the deadline, so decline is felt and can be reacted to before it's
 * forced. Never reaches zero (constraint 2, no permanent zero-state) — floors at
 * `CONSOLIDATION_FRICTION_FLOOR`.
 */

export type DistrictConsolidationStateName = 'ACTIVE' | 'CONSOLIDATING' | 'MERGED';

export interface DistrictHealth {
  state: DistrictConsolidationStateName;
  /** Day the district first crossed the tipping point into CONSOLIDATING. null while ACTIVE. */
  consolidatingSince: number | null;
}

/** A district counts as "underpopulated" once fewer than this fraction of its own role
 *  slots are FILLED. [ILLUSTRATIVE] */
export const DISTRICT_TIPPING_POINT_FILLED_FRACTION = 0.3;
/** 2 weeks — the user's own figure, and a deliberate echo of conscriptionDelay's default. */
export const CONSOLIDATION_GRACE_DAYS = 14;
/** Friction never reaches full inaccessibility — constraint 2, no permanent zero-state. [ILLUSTRATIVE] */
export const CONSOLIDATION_FRICTION_FLOOR = 0.25;

export function districtFilledFraction(filledCount: number, totalSlots: number): number {
  if (totalSlots <= 0) return 1; // no slots to be understaffed about — vacuously healthy
  return filledCount / totalSlots;
}

export function initialDistrictHealth(): DistrictHealth {
  return { state: 'ACTIVE', consolidatingSince: null };
}

/**
 * One day's transition for a single district. Irreversible once triggered: ACTIVE can
 * move to CONSOLIDATING; CONSOLIDATING can only move forward to MERGED, never back to
 * ACTIVE even if `filledFraction` recovers mid-countdown; MERGED is terminal.
 */
export function stepDistrictHealth(
  health: DistrictHealth,
  filledFraction: number,
  day: number,
  tippingPoint: number = DISTRICT_TIPPING_POINT_FILLED_FRACTION,
  graceDays: number = CONSOLIDATION_GRACE_DAYS,
): DistrictHealth {
  if (health.state === 'MERGED') return health;

  if (health.state === 'ACTIVE') {
    if (filledFraction < tippingPoint) {
      return { state: 'CONSOLIDATING', consolidatingSince: day };
    }
    return health;
  }

  // CONSOLIDATING — counting down regardless of any later recovery in filledFraction.
  const daysSince = day - (health.consolidatingSince ?? day);
  if (daysSince >= graceDays) {
    return { state: 'MERGED', consolidatingSince: health.consolidatingSince };
  }
  return health;
}

/**
 * Service-access friction multiplier — 1.0 is full access (ACTIVE). Ramps linearly down
 * across the grace period once CONSOLIDATING, reaching `CONSOLIDATION_FRICTION_FLOOR` at
 * the deadline; stays at the floor once MERGED (its role-slots are gone, but the district
 * record itself persists as a permanently-degraded, not deleted, entry — see world.ts).
 */
export function consolidationFrictionMultiplier(
  health: DistrictHealth,
  day: number,
  graceDays: number = CONSOLIDATION_GRACE_DAYS,
  frictionFloor: number = CONSOLIDATION_FRICTION_FLOOR,
): number {
  if (health.state === 'ACTIVE') return 1;
  if (health.state === 'MERGED') return frictionFloor;
  const daysSince = day - (health.consolidatingSince ?? day);
  const progress = Math.min(1, daysSince / graceDays);
  return 1 - progress * (1 - frictionFloor);
}
