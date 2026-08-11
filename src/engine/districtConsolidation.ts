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
  /** Smoothed (EMA) filled fraction — the signal the ratchet actually reads. null until the
   *  first observation seeds it. See CONSOLIDATION_EMA_ALPHA for why this is smoothed. */
  emaFilledFraction: number | null;
  /** Consecutive days the SMOOTHED fraction has sat below the tipping point while ACTIVE.
   *  Resets on recovery. See CONSOLIDATION_TRIGGER_DAYS. */
  daysBelowTippingPoint: number;
}

/** A district counts as "underpopulated" once fewer than this fraction of its own role
 *  slots are FILLED. [ILLUSTRATIVE] */
export const DISTRICT_TIPPING_POINT_FILLED_FRACTION = 0.3;
/** 2 weeks — the user's own figure, and a deliberate echo of conscriptionDelay's default. */
export const CONSOLIDATION_GRACE_DAYS = 14;
/** Friction never reaches full inaccessibility — constraint 2, no permanent zero-state. [ILLUSTRATIVE] */
export const CONSOLIDATION_FRICTION_FLOOR = 0.25;
/**
 * Consecutive days a district's SMOOTHED occupancy must sit below the tipping point before
 * the irreversible ratchet engages. [ILLUSTRATIVE — swept against real trajectories]
 *
 * With the EMA signal below, this finally discriminates rather than switching all-or-
 * nothing. Districts merged, by shard condition (3000 days, replayed trajectories):
 *   trigger      3     5     7    10    14    21    30
 *   thin(35)   2/4   1/4   1/4   0/4   0/4   0/4   0/4
 *   v.thin(22) 4/4   4/4   4/4   4/4   3/4   1/4   0/4
 *   collapsing 4/4   4/4   4/4   4/4   4/4   4/4   4/4
 * 21 fires reliably on genuine collapse, occasionally on a very thin shard, and never on a
 * shard whose population actually matches its role slots. 30 would only ever catch total
 * collapse; <=10 fires on shards that are merely churning.
 *
 * Added 2026-08-11 to fix a real defect found by instrumenting the district-layout
 * comparison: with an INSTANTANEOUS trigger, an irreversible ratchet is an absorbing state.
 * Any district that dipped below the threshold for even a single day was permanently
 * doomed, and over a long run every district eventually has one bad day — measured, all 4
 * slot-bearing districts merged by day 500 and stayed merged forever. The mechanic fired
 * once, universally, and then never again: trade-route friction degenerated into a constant
 * tax on the whole shard rather than a signal, and the 2-week grace/draft never triggered
 * again for the rest of the run.
 *
 * This does NOT weaken irreversibility, which is the user's explicit design ("once passed a
 * tipping point can't be reversed"). It makes the trigger mean what that sentence implies:
 * a transient dip is noise, not a tipping point. Once decline is genuinely sustained the
 * ratchet engages exactly as before and still cannot be reversed. 21 days is deliberately
 * longer than CONSOLIDATION_GRACE_DAYS, so a district must be failing for longer than it
 * then gets to recover socially before anything becomes permanent.
 */
export const CONSOLIDATION_TRIGGER_DAYS = 21;

/**
 * Smoothing factor for the district's filled-fraction signal (EMA), ~30-day effective
 * window. [ILLUSTRATIVE]
 *
 * Second correction, 2026-08-11. Requiring N consecutive days below the threshold on the
 * RAW fraction did not work, and the sweep showed exactly why: it was a cliff, not a
 * gradient — at <=14 days every district merged, at 21 none did, and the result was
 * IDENTICAL for healthy and collapsing shards. The trigger discriminated nothing.
 *
 * The metric was at fault, not the threshold. A district's raw filled fraction is a small,
 * lumpy ratio (a 3-slot district reads 0.00 the moment its occupants happen to be between
 * assignments), so ordinary churn drives it below 30% constantly while genuine long-run
 * decline looks no different day to day. Counting consecutive days on a signal that noisy
 * can only ever be all-or-nothing.
 *
 * Smoothing first makes the signal mean what the design intends: a district that is
 * genuinely under-occupied holds a low EMA, while one that is merely churning recovers it.
 * The tipping point and the irreversible ratchet are unchanged — they now just read a
 * signal that can actually tell those two situations apart.
 */
export const CONSOLIDATION_EMA_ALPHA = 2 / 31;

export function districtFilledFraction(filledCount: number, totalSlots: number): number {
  if (totalSlots <= 0) return 1; // no slots to be understaffed about — vacuously healthy
  return filledCount / totalSlots;
}

export function initialDistrictHealth(): DistrictHealth {
  return { state: 'ACTIVE', consolidatingSince: null, emaFilledFraction: null, daysBelowTippingPoint: 0 };
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
  triggerDays: number = CONSOLIDATION_TRIGGER_DAYS,
  emaAlpha: number = CONSOLIDATION_EMA_ALPHA,
): DistrictHealth {
  // Smooth first — the ratchet reads the EMA, never the raw daily fraction.
  const ema =
    health.emaFilledFraction === null
      ? filledFraction
      : health.emaFilledFraction + emaAlpha * (filledFraction - health.emaFilledFraction);

  if (health.state === 'MERGED') return { ...health, emaFilledFraction: ema };

  if (health.state === 'ACTIVE') {
    if (ema < tippingPoint) {
      const days = health.daysBelowTippingPoint + 1;
      if (days >= triggerDays) {
        return { state: 'CONSOLIDATING', consolidatingSince: day, emaFilledFraction: ema, daysBelowTippingPoint: days };
      }
      return { ...health, emaFilledFraction: ema, daysBelowTippingPoint: days };
    }
    // Sustained occupancy recovered before the ratchet engaged — not a tipping point.
    return { ...health, emaFilledFraction: ema, daysBelowTippingPoint: 0 };
  }

  // CONSOLIDATING — counting down regardless of any later recovery in filledFraction.
  const daysSince = day - (health.consolidatingSince ?? day);
  if (daysSince >= graceDays) {
    return { ...health, state: 'MERGED', emaFilledFraction: ema };
  }
  return { ...health, emaFilledFraction: ema };
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
